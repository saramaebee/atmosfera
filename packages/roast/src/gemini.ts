import { GoogleGenAI } from '@google/genai';
import { temperatureForTone } from './prompts';
import type { Tone } from './types';

let cachedClient: GoogleGenAI | null = null;
let cachedClientKey: string | null = null;

function getClient(apiKey: string): GoogleGenAI {
  if (cachedClient && cachedClientKey === apiKey) return cachedClient;
  cachedClient = new GoogleGenAI({ apiKey });
  cachedClientKey = apiKey;
  return cachedClient;
}

const MODEL = 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = 1500;

export async function generateRoast(apiKey: string, prompt: string, tone: Tone): Promise<string> {
  const client = getClient(apiKey);
  const response = await client.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      temperature: temperatureForTone(tone),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Gemini 2.5 Flash burns output tokens on a "thinking" phase by default.
      // For short witty text this drops output mid-sentence. Disable thinking.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text;
  if (!text) throw new Error('Gemini returned no text');
  return text.trim();
}
