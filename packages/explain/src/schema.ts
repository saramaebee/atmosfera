import { type Schema, Type } from '@google/genai';
import { z } from 'zod';

export const ExplainPointSchema = z.object({
  heading: z.string().min(1).max(80),
  body: z.string().min(1).max(800),
});

export const ExplainResponseSchema = z.object({
  targetLanguage: z.enum(['english', 'spanish', 'mixed', 'other']),
  oneLineSummary: z.string().min(1).max(220),
  points: z.array(ExplainPointSchema).min(1).max(4),
  nativeContextSources: z.array(z.string()).max(8).default([]),
});

export type ExplainResponse = z.infer<typeof ExplainResponseSchema>;

/**
 * Gemini's structured-output schema for the same shape. Drop nullable/optional
 * features Gemini's schema dialect doesn't support; we still validate with zod
 * downstream so anything missing is caught.
 */
export const ExplainResponseGeminiSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    targetLanguage: {
      type: Type.STRING,
      enum: ['english', 'spanish', 'mixed', 'other'],
    },
    oneLineSummary: { type: Type.STRING },
    points: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          heading: { type: Type.STRING },
          body: { type: Type.STRING },
        },
        required: ['heading', 'body'],
      },
    },
    nativeContextSources: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ['targetLanguage', 'oneLineSummary', 'points', 'nativeContextSources'],
};
