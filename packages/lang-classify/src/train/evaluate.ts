#!/usr/bin/env bun
/**
 * Evaluate `src/models/default.json` against the committed eval set.
 * Prints per-label confusion and per-length-bucket accuracy.
 *
 *   bun src/train/evaluate.ts
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { classifyText } from '../classify';
import { type LangModel, assertModel } from '../model';

const HERE = dirname(new URL(import.meta.url).pathname);
const PKG_ROOT = resolve(HERE, '..', '..');

interface EvalRow {
  text: string;
  expected: string;
}

async function main() {
  const modelPath = resolve(PKG_ROOT, 'src', 'models', 'default.json');
  const evalPath = resolve(PKG_ROOT, 'src', 'models', 'eval-set.json');
  const model = JSON.parse(await readFile(modelPath, 'utf8')) as unknown;
  assertModel(model);
  const evalSet = JSON.parse(await readFile(evalPath, 'utf8')) as { rows: EvalRow[] };

  const confusion = new Map<string, Map<string, number>>(); // expected → predicted → count
  const byBucket = { short: { ok: 0, total: 0 }, long: { ok: 0, total: 0 } };
  let correct = 0;
  const mismatches: Array<{ text: string; expected: string; got: string; confidence: number }> = [];

  for (const row of evalSet.rows) {
    const result = classifyText(row.text, model as LangModel);
    const got = result.label;
    const ok = got === row.expected;
    if (ok) correct++;
    else
      mismatches.push({
        text: row.text,
        expected: row.expected,
        got,
        confidence: result.confidence,
      });

    const bucket = result.lengthAfterClean < 20 ? 'short' : 'long';
    byBucket[bucket].total++;
    if (ok) byBucket[bucket].ok++;

    const inner = confusion.get(row.expected) ?? new Map<string, number>();
    inner.set(got, (inner.get(got) ?? 0) + 1);
    confusion.set(row.expected, inner);
  }

  const total = evalSet.rows.length;
  console.log('');
  console.log(`Overall: ${correct}/${total} = ${((correct / total) * 100).toFixed(1)}%`);
  console.log(`Short (<20 chars after clean): ${byBucket.short.ok}/${byBucket.short.total}`);
  console.log(`Long  (>=20 chars after clean): ${byBucket.long.ok}/${byBucket.long.total}`);
  console.log('');
  console.log('Confusion (rows = expected, cols = predicted):');
  const labels = Array.from(
    new Set([
      ...Array.from(confusion.keys()),
      ...Array.from(confusion.values()).flatMap((m) => Array.from(m.keys())),
    ]),
  ).sort();
  const header = `${'exp\\got'.padEnd(10)}${labels.map((l) => l.padStart(8)).join('')}`;
  console.log(header);
  for (const exp of labels) {
    const row = confusion.get(exp) ?? new Map();
    const cells = labels.map((l) => String(row.get(l) ?? 0).padStart(8));
    console.log(`${exp.padEnd(10)}${cells.join('')}`);
  }
  console.log('');
  if (mismatches.length > 0) {
    console.log(`Mismatches (${mismatches.length}):`);
    for (const m of mismatches) {
      console.log(
        `  expected=${m.expected} got=${m.got} (${(m.confidence * 100).toFixed(0)}%) — ${m.text.slice(0, 80)}`,
      );
    }
  }
}

if (import.meta.main) {
  await main();
}
