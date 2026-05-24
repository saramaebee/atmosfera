#!/usr/bin/env bun
/**
 * Post-labelling audit: surface rows where the shipped model disagrees with
 * the human label. Run this AFTER finishing a session in label.ts.
 *
 *   bun src/train/audit.ts [--in PATH]   # default: .cache/labelled.jsonl
 *
 * This file lives alongside label.ts but as a separate entry — label.ts must
 * never import a model, so the model-loading code is fenced off here.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { classifyText } from '../classify';
import { loadDefaultModel } from '../index';
import { parseLabelledLine } from './label';

const HERE = dirname(new URL(import.meta.url).pathname);
const CACHE_DIR = resolve(HERE, '.cache');

interface Args {
  in: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { in: resolve(CACHE_DIR, 'labelled.jsonl') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') args.in = resolve(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await readFile(args.in, 'utf8');
  const model = loadDefaultModel();

  let total = 0;
  const disagreements: Array<{
    text: string;
    expected: string;
    got: string;
    confidence: number;
  }> = [];

  for (const line of raw.split('\n')) {
    const row = parseLabelledLine(line);
    if (!row) continue;
    total++;
    const result = classifyText(row.text, model);
    if (result.label !== row.expected) {
      disagreements.push({
        text: row.text,
        expected: row.expected,
        got: result.label,
        confidence: result.confidence,
      });
    }
  }

  if (total === 0) {
    console.log(`[audit] no labelled rows found in ${args.in}`);
    return;
  }

  const agree = total - disagreements.length;
  console.log('');
  console.log(`Audit: ${agree}/${total} agree (${((agree / total) * 100).toFixed(1)}%)`);
  console.log(`Disagreements: ${disagreements.length}`);
  console.log('');
  for (const d of disagreements) {
    console.log(
      `  human=${d.expected} model=${d.got} (${(d.confidence * 100).toFixed(0)}%) — ${d.text.slice(0, 100)}`,
    );
  }
}

if (import.meta.main) {
  await main();
}
