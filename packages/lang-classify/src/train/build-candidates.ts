#!/usr/bin/env bun
/**
 * Build a stratified labelling queue from a corpus JSONL.
 *
 *   build-corpus.ts  →  .cache/corpus.jsonl
 *   build-candidates.ts  →  .cache/candidates.jsonl   (this script)
 *   label.ts --queue .cache/candidates.jsonl
 *
 * Each row is bucketed by preprocessed length (short / medium / long) and by
 * the shipped model's confidence (low / high). Low-confidence cells are
 * over-sampled because that's where new training signal lives: rows the
 * current classifier is least sure about.
 *
 *   bun src/train/build-candidates.ts \
 *     [--in PATH]                  # default: .cache/corpus.jsonl
 *     [--out PATH]                 # default: .cache/candidates.jsonl
 *     [--seed N]                   # default: 1
 *     [--low-conf-threshold N]     # default: 0.7
 *     [--targets short-low=60,medium-low=80,...]
 *
 * Output rows are `{ text }` only — `lang` and any other source fields are
 * stripped here for the same anti-anchoring reason `label.ts` strips them.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { classifyText, type ClassifyResult } from '../classify';
import { loadDefaultModel } from '../index';
import { type Bucket, bucketOf, parseQueueLine, type QueueRow, shuffleSeeded } from './label';

const HERE = dirname(new URL(import.meta.url).pathname);
const CACHE_DIR = resolve(HERE, '.cache');

export type Band = 'low' | 'high';
export type Cell = `${Bucket}-${Band}`;

export const CELLS: readonly Cell[] = [
  'short-low',
  'short-high',
  'medium-low',
  'medium-high',
  'long-low',
  'long-high',
] as const;

// Default per-cell targets. Low-confidence cells are over-sampled deliberately;
// the shipped model abstains or hedges most on short and ambiguous text, and
// that's exactly where labelled examples move the needle.
export const DEFAULT_TARGETS: Record<Cell, number> = {
  'short-low': 60,
  'short-high': 20,
  'medium-low': 80,
  'medium-high': 30,
  'long-low': 40,
  'long-high': 20,
};

export const DEFAULT_LOW_CONF_THRESHOLD = 0.7;

interface Args {
  in: string;
  out: string;
  seed: number;
  lowConfThreshold: number;
  targetsOverride: Partial<Record<Cell, number>>;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    in: resolve(CACHE_DIR, 'corpus.jsonl'),
    out: resolve(CACHE_DIR, 'candidates.jsonl'),
    seed: 1,
    lowConfThreshold: DEFAULT_LOW_CONF_THRESHOLD,
    targetsOverride: {},
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in') args.in = resolve(argv[++i]);
    else if (a === '--out') args.out = resolve(argv[++i]);
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--low-conf-threshold') args.lowConfThreshold = Number(argv[++i]);
    else if (a === '--targets') args.targetsOverride = parseTargets(argv[++i] ?? '');
  }
  return args;
}

// --- Pure helpers (covered by build-candidates.test.ts) --------------------

function isCell(s: string): s is Cell {
  return (CELLS as readonly string[]).includes(s);
}

export function parseTargets(s: string): Partial<Record<Cell, number>> {
  const out: Partial<Record<Cell, number>> = {};
  for (const part of s.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) throw new Error(`bad --targets entry (missing '='): ${trimmed}`);
    const key = trimmed.slice(0, eq).trim();
    const n = Number(trimmed.slice(eq + 1).trim());
    if (!isCell(key)) throw new Error(`bad --targets cell name: ${key}`);
    if (!Number.isFinite(n) || n < 0) throw new Error(`bad --targets count for ${key}: ${n}`);
    out[key] = n;
  }
  return out;
}

export function assignBand(result: ClassifyResult, threshold: number): Band {
  if (result.abstainReason) return 'low';
  if (result.confidence < threshold) return 'low';
  return 'high';
}

export interface ClassifiedRow {
  text: string;
  bucket: Bucket;
  band: Band;
}

export interface StratifyResult {
  selected: { text: string; cell: Cell }[];
  underfilled: { cell: Cell; want: number; got: number }[];
  cellCounts: Record<Cell, number>;
}

export function stratify(
  rows: readonly ClassifiedRow[],
  targets: Record<Cell, number>,
  seed: number,
): StratifyResult {
  const byCell = new Map<Cell, ClassifiedRow[]>();
  for (const cell of CELLS) byCell.set(cell, []);
  for (const row of rows) {
    const cell: Cell = `${row.bucket}-${row.band}`;
    byCell.get(cell)?.push(row);
  }

  const selected: { text: string; cell: Cell }[] = [];
  const underfilled: { cell: Cell; want: number; got: number }[] = [];
  const cellCounts: Record<Cell, number> = {
    'short-low': 0,
    'short-high': 0,
    'medium-low': 0,
    'medium-high': 0,
    'long-low': 0,
    'long-high': 0,
  };

  // Step the seed per cell so different cells shuffle differently but the
  // overall result remains deterministic for a given input + seed.
  let cellSeed = seed >>> 0;
  for (const cell of CELLS) {
    const want = targets[cell];
    const pool = byCell.get(cell) ?? [];
    const shuffled = shuffleSeeded(pool, cellSeed);
    const take = Math.min(want, shuffled.length);
    for (let i = 0; i < take; i++) {
      const row = shuffled[i];
      if (row) selected.push({ text: row.text, cell });
    }
    cellCounts[cell] = take;
    if (take < want) underfilled.push({ cell, want, got: take });
    cellSeed = (cellSeed + 1) >>> 0;
  }

  return { selected, underfilled, cellCounts };
}

export function classifyRows(rows: readonly QueueRow[], threshold: number): ClassifiedRow[] {
  const model = loadDefaultModel();
  return rows.map((r) => {
    const result = classifyText(r.text, model);
    return {
      text: r.text,
      bucket: bucketOf(r.text),
      band: assignBand(result, threshold),
    };
  });
}

// --- I/O -------------------------------------------------------------------

async function loadCorpus(path: string): Promise<QueueRow[]> {
  const raw = await readFile(path, 'utf8');
  const rows: QueueRow[] = [];
  const seen = new Set<string>();
  for (const line of raw.split('\n')) {
    const row = parseQueueLine(line);
    if (!row) continue;
    if (seen.has(row.text)) continue;
    seen.add(row.text);
    rows.push(row);
  }
  return rows;
}

// --- Main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(dirname(args.out), { recursive: true });

  if (!existsSync(args.in)) {
    console.error(`[candidates] input not found: ${args.in}`);
    console.error('Run `bun src/train/build-corpus.ts` first or pass --in PATH.');
    process.exit(1);
  }

  const rows = await loadCorpus(args.in);
  console.log(`[candidates] read ${rows.length} unique rows from ${args.in}`);

  const classified = classifyRows(rows, args.lowConfThreshold);
  const targets: Record<Cell, number> = { ...DEFAULT_TARGETS, ...args.targetsOverride };

  const { selected, underfilled, cellCounts } = stratify(classified, targets, args.seed);

  for (const cell of CELLS) {
    console.log(`[candidates] ${cell}: ${cellCounts[cell]} / target ${targets[cell]}`);
  }
  for (const u of underfilled) {
    console.warn(`[candidates] cell ${u.cell} under-filled: wanted ${u.want}, got ${u.got}`);
  }

  const out = selected.map((s) => JSON.stringify({ text: s.text })).join('\n');
  await writeFile(args.out, out);
  console.log(`[candidates] wrote ${selected.length} rows → ${args.out}`);
}

if (import.meta.main) {
  await main();
}
