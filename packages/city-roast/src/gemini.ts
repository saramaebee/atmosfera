import { generateText } from '@atmosfera/gemini';
import { temperatureForTone } from './prompts';
import type { Tone } from './types';

const MAX_OUTPUT_TOKENS = 1500;

export async function generateRoast(apiKey: string, prompt: string, tone: Tone): Promise<string> {
  return generateText({
    apiKey,
    prompt,
    temperature: temperatureForTone(tone),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    // Gemini 2.5 Flash burns output tokens on a "thinking" phase by default.
    // For short witty text this drops output mid-sentence. Disable thinking.
    thinkingBudget: 0,
  });
}
