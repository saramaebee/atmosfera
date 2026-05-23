#!/usr/bin/env bun
/**
 * Build a larger corpus by downloading Tatoeba's per-language sentence dumps.
 * Output: a JSONL file at `src/train/.cache/corpus.jsonl` consumable by
 * `train.ts --source jsonl --path …`.
 *
 *   bun src/train/build-corpus.ts [--max-per-lang N] [--out PATH]
 *
 * Tatoeba publishes per-language exports as `.tsv.bz2`. We shell out to bzcat
 * (POSIX standard, present on macOS + Linux + WSL) rather than pulling a JS
 * decompressor dep. Files land in .cache/ which is gitignored.
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const HERE = dirname(new URL(import.meta.url).pathname);
const CACHE_DIR = resolve(HERE, '.cache');

// Tatoeba ISO 639-3 codes for each language we care about.
const TATOEBA_CODES: Record<string, string> = {
  en: 'eng',
  es: 'spa',
  pt: 'por',
  fr: 'fra',
  it: 'ita',
  de: 'deu',
  ca: 'cat',
  gl: 'glg',
  ro: 'ron',
  nl: 'nld',
};

interface Args {
  maxPerLang: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    maxPerLang: 50_000,
    out: resolve(CACHE_DIR, 'corpus.jsonl'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-per-lang') args.maxPerLang = Number(argv[++i]);
    else if (a === '--out') args.out = resolve(argv[++i]);
  }
  return args;
}

async function downloadAndExtract(lang: string, code: string): Promise<string[]> {
  const url = `https://downloads.tatoeba.org/exports/per_language/${code}/${code}_sentences.tsv.bz2`;
  console.log(`[corpus] downloading ${lang} (${code}) from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed for ${lang}: ${res.status}`);
  const bz2 = new Uint8Array(await res.arrayBuffer());
  // bzcat reads bz2 on stdin, writes plain on stdout.
  const proc = spawn('bzcat', [], { stdio: ['pipe', 'pipe', 'inherit'] });
  proc.stdin.end(bz2);
  const chunks: Buffer[] = [];
  for await (const chunk of proc.stdout) chunks.push(chunk as Buffer);
  const tsv = Buffer.concat(chunks).toString('utf8');
  const lines = tsv.split('\n');
  const texts: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split('\t');
    // Tatoeba format: id<TAB>lang<TAB>text
    const text = parts[2];
    if (text) texts.push(text);
  }
  return texts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(CACHE_DIR, { recursive: true });
  const outLines: string[] = [];
  for (const [lang, code] of Object.entries(TATOEBA_CODES)) {
    try {
      const texts = await downloadAndExtract(lang, code);
      const sampled = texts.slice(0, args.maxPerLang);
      console.log(`[corpus] ${lang}: ${sampled.length} sentences`);
      for (const text of sampled) {
        outLines.push(JSON.stringify({ lang, text, source: 'tatoeba' }));
      }
    } catch (err) {
      console.error(`[corpus] skipping ${lang}:`, err);
    }
  }
  await writeFile(args.out, outLines.join('\n'));
  console.log(`[corpus] wrote ${outLines.length} rows → ${args.out}`);
}

if (import.meta.main) {
  await main();
}
