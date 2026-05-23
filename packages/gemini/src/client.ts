import {
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
  type SafetySetting,
  type Schema,
} from '@google/genai';
import type { z } from 'zod';
import {
  BlockedBySafetyError,
  type SafetyPolicy,
  evaluateSafetyRatings,
  probabilityRank,
} from './safety';

export const DEFAULT_MODEL = 'gemini-2.5-flash';

const clientCache = new Map<string, GoogleGenAI>();

function getClient(apiKey: string): GoogleGenAI {
  let c = clientCache.get(apiKey);
  if (!c) {
    c = new GoogleGenAI({ apiKey });
    clientCache.set(apiKey, c);
  }
  return c;
}

export interface GenerateTextParams {
  apiKey: string;
  prompt: string;
  model?: string;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Gemini 2.5 burns output tokens on thinking by default. 0 disables. */
  thinkingBudget?: number;
  safetySettings?: SafetySetting[];
}

export async function generateText({
  apiKey,
  prompt,
  model = DEFAULT_MODEL,
  systemInstruction,
  temperature,
  maxOutputTokens,
  thinkingBudget,
  safetySettings,
}: GenerateTextParams): Promise<string> {
  const response = await getClient(apiKey).models.generateContent({
    model,
    contents: prompt,
    config: {
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
      ...(safetySettings ? { safetySettings } : {}),
    },
  });

  const text = response.text;
  if (!text) throw new Error('Gemini returned no text');
  return text.trim();
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  return JSON.parse(raw);
}

export interface JsonCallParams<T> {
  apiKey: string;
  systemInstruction: string;
  prompt: string;
  schema: z.ZodType<T>;
  responseSchema: Schema;
  model?: string;
  temperature?: number;
}

export async function generateJson<T>({
  apiKey,
  systemInstruction,
  prompt,
  schema,
  responseSchema,
  model = DEFAULT_MODEL,
  temperature = 0.7,
}: JsonCallParams<T>): Promise<T> {
  const response = await getClient(apiKey).models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction,
      temperature,
      responseMimeType: 'application/json',
      responseSchema,
    },
  });

  const text = response.text ?? '';
  if (!text) throw new Error('Gemini returned empty response');
  const parsed = extractJson(text);
  return schema.parse(parsed);
}

export interface ToolHandler {
  name: string;
  declaration: FunctionDeclaration;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ToolLoopParams {
  apiKey: string;
  systemInstruction: string;
  initialPrompt: string;
  tools: ToolHandler[];
  maxIterations: number;
  model?: string;
  temperature?: number;
  safetySettings?: SafetySetting[];
  /** Applied to the final response's safetyRatings — throws BlockedBySafetyError if exceeded. */
  safetyPolicy?: SafetyPolicy;
  /** Gemini 2.5 burns output tokens on thinking by default. 0 disables. */
  thinkingBudget?: number;
  /**
   * Soft floor on tool calls. When the model tries to finish (emits text with
   * no function calls) and we haven't hit this floor yet, the loop injects a
   * "you still have budget — make another concrete tool call" nudge and
   * continues. Bounded by `maxIterations` either way. 0 = no floor.
   */
  minToolCalls?: number;
}

export interface ToolLoopResult {
  finalText: string;
  iterations: number;
  toolCalls: { name: string; args: Record<string, unknown>; result: unknown }[];
}

function checkGeminiBlock(response: GenerateContentResponse): void {
  const candidate = response.candidates?.[0];
  if (!candidate || candidate.finishReason !== 'SAFETY') return;
  const ratings = candidate.safetyRatings ?? [];
  let worst = ratings[0];
  let worstRank = -1;
  for (const r of ratings) {
    const rank = probabilityRank(r.probability ?? undefined);
    if (rank > worstRank) {
      worst = r;
      worstRank = rank;
    }
  }
  if (!worst) return;
  throw new BlockedBySafetyError(worst.category!, worst.probability!, 'gemini');
}

export async function runToolLoop({
  apiKey,
  systemInstruction,
  initialPrompt,
  tools,
  maxIterations,
  model = DEFAULT_MODEL,
  temperature = 0.8,
  safetySettings,
  safetyPolicy,
  thinkingBudget,
  minToolCalls = 0,
}: ToolLoopParams): Promise<ToolLoopResult> {
  const toolMap = new Map(tools.map((t) => [t.name, t]));
  const declarations = tools.map((t) => t.declaration);

  const contents: Content[] = [{ role: 'user', parts: [{ text: initialPrompt }] }];
  const toolCalls: ToolLoopResult['toolCalls'] = [];

  for (let iter = 0; iter < maxIterations; iter++) {
    const response = await getClient(apiKey).models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        temperature,
        tools: [{ functionDeclarations: declarations }],
        ...(safetySettings ? { safetySettings } : {}),
        ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
      },
    });

    const parts: Part[] = response.candidates?.[0]?.content?.parts ?? [];
    const functionCalls = parts.filter(
      (p): p is Part & { functionCall: NonNullable<Part['functionCall']> } =>
        Boolean(p.functionCall),
    );

    if (functionCalls.length === 0) {
      checkGeminiBlock(response);
      if (safetyPolicy) {
        evaluateSafetyRatings(response.candidates?.[0]?.safetyRatings, safetyPolicy);
      }
      // Min-tool-calls soft floor: if the model wants to finish but hasn't
      // gathered enough evidence yet, push it back into tool use. We only
      // nudge when we still have iterations left to spend.
      const remaining = maxIterations - iter - 1;
      if (toolCalls.length < minToolCalls && remaining > 0) {
        contents.push({ role: 'model', parts });
        contents.push({
          role: 'user',
          parts: [
            {
              text: `You have ${remaining} tool call${remaining === 1 ? '' : 's'} of budget left and have only made ${toolCalls.length} so far (minimum: ${minToolCalls}). Don't write the final answer yet — make another concrete tool call to dig into a different angle or surface a specific quote. Avoid repeating searches you already ran.`,
            },
          ],
        });
        continue;
      }
      const finalText = response.text ?? '';
      if (!finalText.trim()) {
        const finishReason = response.candidates?.[0]?.finishReason ?? 'UNKNOWN';
        throw new Error(`Gemini returned empty response (finishReason=${finishReason}).`);
      }
      return { finalText, iterations: iter + 1, toolCalls };
    }

    contents.push({ role: 'model', parts });

    const responseParts: Part[] = [];
    for (const part of functionCalls) {
      const call = part.functionCall;
      const name = call.name ?? '';
      const args = (call.args ?? {}) as Record<string, unknown>;
      const tool = toolMap.get(name);
      let result: unknown;
      if (!tool) {
        result = { error: `Unknown tool: ${name}` };
      } else {
        try {
          result = await tool.handler(args);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      toolCalls.push({ name, args, result });
      responseParts.push({
        functionResponse: { name, response: { result } },
      });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  // Iteration cap hit — force a final synthesis without tools.
  contents.push({
    role: 'user',
    parts: [
      {
        text: 'Tool-use budget exhausted. Produce your final answer now using only the evidence already gathered.',
      },
    ],
  });

  const finalResponse = await getClient(apiKey).models.generateContent({
    model,
    contents,
    config: {
      systemInstruction,
      temperature,
      ...(safetySettings ? { safetySettings } : {}),
      ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}),
    },
  });

  checkGeminiBlock(finalResponse);
  if (safetyPolicy) {
    evaluateSafetyRatings(finalResponse.candidates?.[0]?.safetyRatings, safetyPolicy);
  }

  const finalText = finalResponse.text ?? '';
  if (!finalText.trim()) {
    const finishReason = finalResponse.candidates?.[0]?.finishReason ?? 'UNKNOWN';
    throw new Error(`Gemini returned empty final response (finishReason=${finishReason}).`);
  }

  return { finalText, iterations: maxIterations, toolCalls };
}
