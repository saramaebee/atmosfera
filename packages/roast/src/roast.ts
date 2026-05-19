import type { ClimateCube } from '@atmosfera/climate';
import type { City } from '@atmosfera/db';
import { getCachedRoast, putCachedRoast } from './cache';
import { extractContrast, extractFingerprint } from './fingerprint';
import { generateRoast } from './gemini';
import { buildContrastPrompt, buildSinglePrompt } from './prompts';
import { RoastApiKeyMissingError, type RoastOptions } from './types';

export interface RoastInput extends RoastOptions {
  /** AI Studio / Vertex API key. If undefined, the call throws RoastApiKeyMissingError on cache miss. */
  apiKey: string | undefined;
}

export async function getRoast(opts: RoastInput, city: City, cube: ClimateCube): Promise<string> {
  const cubes = [cube];
  const cached = getCachedRoast(opts, cubes, false);
  if (cached) return cached;

  if (!opts.apiKey) throw new RoastApiKeyMissingError();

  const fp = extractFingerprint(city, cube);
  const prompt = buildSinglePrompt(opts, fp);
  const text = await generateRoast(opts.apiKey, prompt, opts.tone);
  putCachedRoast(text, opts, cubes, false);
  return text;
}

export async function getContrastRoast(
  opts: RoastInput,
  cityA: City,
  cubeA: ClimateCube,
  cityB: City,
  cubeB: ClimateCube,
): Promise<string> {
  const cubes = [cubeA, cubeB];
  const cached = getCachedRoast(opts, cubes, true);
  if (cached) return cached;

  if (!opts.apiKey) throw new RoastApiKeyMissingError();

  const fpA = extractFingerprint(cityA, cubeA);
  const fpB = extractFingerprint(cityB, cubeB);
  const contrast = extractContrast(fpA, fpB);
  const prompt = buildContrastPrompt(opts, fpA, fpB, contrast);
  const text = await generateRoast(opts.apiKey, prompt, opts.tone);
  putCachedRoast(text, opts, cubes, true);
  return text;
}
