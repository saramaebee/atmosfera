#!/usr/bin/env bun
/**
 * Bias-safe one-at-a-time text labeller for the eval set.
 *
 *   bun src/train/label.ts \
 *     [--queue PATH]   # input JSONL with {text,...} rows (default: .cache/corpus.jsonl)
 *     [--out PATH]     # output JSONL, appended one row per label (default: .cache/labelled.jsonl)
 *     [--state PATH]   # resume state (default: .cache/label-state.json)
 *     [--seed N]       # shuffle seed (default: 1)
 *     [--limit N]      # cap queue size after shuffle
 *
 * Rules baked in:
 *   - This file deliberately never imports `loadDefaultModel` or anything from
 *     classify.ts. The labeller must not be biased by, or accidentally surface,
 *     model output. Model-vs-human review lives in audit.ts.
 *   - Queue rows may carry a `lang` field (e.g. corpus.jsonl from Tatoeba).
 *     `parseQueueLine` strips it so ground-truth never anchors the labeller.
 *   - Order is shuffled with a fixed seed — same seed reproduces the same
 *     ordering across resumes, anti-anchoring on adjacent similar texts.
 */

import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { preprocess } from '../preprocess';

const HERE = dirname(new URL(import.meta.url).pathname);
const CACHE_DIR = resolve(HERE, '.cache');

// Labels exposed to the human. Keys deliberately one keystroke each.
//   e=English, s=Spanish, m=mixed (en+es code-switch), o=other lang, u=unknown.
// Plus `k` to skip a row (defer) and `q` to quit (saves state).
export const LABEL_KEYS = {
  e: 'en',
  s: 'es',
  m: 'mixed',
  o: 'other',
  u: 'unknown',
} as const;
export type LabelKey = keyof typeof LABEL_KEYS;
export type Label = (typeof LABEL_KEYS)[LabelKey];

export interface LabelledRow {
  text: string;
  expected: Label;
  ts: string;
}

export interface QueueRow {
  text: string;
}

export type Bucket = 'short' | 'medium' | 'long';

interface Args {
  queue: string;
  out: string;
  state: string;
  seed: number;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    queue: resolve(CACHE_DIR, 'corpus.jsonl'),
    out: resolve(CACHE_DIR, 'labelled.jsonl'),
    state: resolve(CACHE_DIR, 'label-state.json'),
    seed: 1,
    limit: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--queue') args.queue = resolve(argv[++i]);
    else if (a === '--out') args.out = resolve(argv[++i]);
    else if (a === '--state') args.state = resolve(argv[++i]);
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

// --- Pure helpers (covered by label.test.ts) -------------------------------

// Mulberry32: tiny seedable PRNG. Used for queue shuffling so resumes produce
// the same order under the same --seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleSeeded<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// Buckets align with the stratification target in issue #23
// (~50 short, ~75 medium, ~50 long).
export function bucketOf(text: string): Bucket {
  const n = preprocess(text).length;
  if (n < 20) return 'short';
  if (n < 50) return 'medium';
  return 'long';
}

// Parse one JSONL line into a queue row. Deliberately drops `lang` / `expected`
// fields — the labeller must not see ground-truth or prior labels at prompt time.
export function parseQueueLine(line: string): QueueRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const text = (obj as { text?: unknown }).text;
  if (typeof text !== 'string' || text.length === 0) return null;
  return { text };
}

export function parseLabelledLine(line: string): LabelledRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Partial<LabelledRow>;
    if (typeof obj.text === 'string' && typeof obj.expected === 'string') {
      return { text: obj.text, expected: obj.expected as Label, ts: obj.ts ?? '' };
    }
  } catch {
    /* ignore malformed lines */
  }
  return null;
}

export function alreadyLabelledTexts(jsonl: string): Set<string> {
  const set = new Set<string>();
  for (const line of jsonl.split('\n')) {
    const row = parseLabelledLine(line);
    if (row) set.add(row.text);
  }
  return set;
}

export interface Coverage {
  short: { labelled: number; total: number };
  medium: { labelled: number; total: number };
  long: { labelled: number; total: number };
}

export function computeCoverage(queue: readonly QueueRow[], labelled: Set<string>): Coverage {
  const cov: Coverage = {
    short: { labelled: 0, total: 0 },
    medium: { labelled: 0, total: 0 },
    long: { labelled: 0, total: 0 },
  };
  for (const row of queue) {
    const b = bucketOf(row.text);
    cov[b].total++;
    if (labelled.has(row.text)) cov[b].labelled++;
  }
  return cov;
}

// FNV-1a over text contents. Used purely to warn if the queue file changed
// between sessions — seed-based ordering would otherwise be silently incoherent.
export function hashQueue(queue: readonly QueueRow[]): string {
  let h = 2166136261 >>> 0;
  for (const row of queue) {
    for (let i = 0; i < row.text.length; i++) {
      h ^= row.text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x0a;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `${h.toString(16).padStart(8, '0')}:${queue.length}`;
}

// --- I/O -------------------------------------------------------------------

async function loadQueue(path: string, limit: number | null): Promise<QueueRow[]> {
  const raw = await readFile(path, 'utf8');
  const rows: QueueRow[] = [];
  for (const line of raw.split('\n')) {
    const row = parseQueueLine(line);
    if (row) rows.push(row);
  }
  // Dedupe by exact text — labelling the same string twice is wasted effort.
  const seen = new Set<string>();
  const deduped: QueueRow[] = [];
  for (const row of rows) {
    if (seen.has(row.text)) continue;
    seen.add(row.text);
    deduped.push(row);
  }
  return limit != null ? deduped.slice(0, limit) : deduped;
}

async function loadLabelled(path: string): Promise<Set<string>> {
  if (!existsSync(path)) return new Set();
  const raw = await readFile(path, 'utf8');
  return alreadyLabelledTexts(raw);
}

interface State {
  seed: number;
  queueHash: string;
  skipped: string[];
}

async function loadState(path: string): Promise<State | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as State;
  } catch {
    return null;
  }
}

async function saveState(path: string, state: State) {
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

// --- Terminal interaction --------------------------------------------------

function formatCoverage(cov: Coverage): string {
  return (
    `${cov.short.labelled}/${cov.short.total} short  ` +
    `${cov.medium.labelled}/${cov.medium.total} medium  ` +
    `${cov.long.labelled}/${cov.long.total} long`
  );
}

function renderPrompt(text: string, index: number, total: number, cov: Coverage): string {
  return [
    '',
    `── row ${index + 1} / ${total}  (${formatCoverage(cov)}) ──`,
    text,
    '',
    '[e]nglish  [s]panish  [m]ixed  [o]ther  [u]nknown   [k]skip   [q]uit',
  ].join('\n');
}

// Read a single keypress from stdin in raw mode. Resolves with the lowercase
// char, or 'CTRL_C' for Ctrl+C (treated as quit).
function readOneKey(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return Promise.reject(new Error('label.ts requires an interactive TTY (stdin is not a TTY).'));
  }
  return new Promise((resolveKey) => {
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (chunk: Buffer) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      const b = chunk[0] ?? 0;
      if (b === 3) resolveKey('CTRL_C');
      else resolveKey(String.fromCharCode(b).toLowerCase());
    };
    stdin.on('data', onData);
  });
}

// --- Main ------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(dirname(args.out), { recursive: true });
  await mkdir(dirname(args.state), { recursive: true });

  if (!existsSync(args.queue)) {
    console.error(`[label] queue file not found: ${args.queue}`);
    console.error('Run `bun src/train/build-corpus.ts` first or pass --queue PATH.');
    process.exit(1);
  }

  const rawQueue = await loadQueue(args.queue, args.limit);
  const queue = shuffleSeeded(rawQueue, args.seed);
  const queueHash = hashQueue(queue);

  const priorState = await loadState(args.state);
  if (priorState && priorState.queueHash !== queueHash) {
    console.error('[label] queue or seed changed since last run — refusing to resume.');
    console.error(`  prior: ${priorState.queueHash} (seed ${priorState.seed})`);
    console.error(`  now:   ${queueHash} (seed ${args.seed})`);
    console.error('Delete the state file or pass --state PATH to start a new session.');
    process.exit(1);
  }
  const skipped = new Set(priorState?.skipped ?? []);
  const labelled = await loadLabelled(args.out);

  console.log(`[label] queue=${queue.length} labelled=${labelled.size} skipped=${skipped.size}`);
  console.log(`[label] seed=${args.seed}  out=${args.out}`);

  let cov = computeCoverage(queue, labelled);

  for (let i = 0; i < queue.length; i++) {
    const row = queue[i];
    if (!row) continue;
    if (labelled.has(row.text) || skipped.has(row.text)) continue;

    console.log(renderPrompt(row.text, i, queue.length, cov));
    const key = await readOneKey();

    if (key === 'q' || key === 'CTRL_C') {
      await saveState(args.state, { seed: args.seed, queueHash, skipped: Array.from(skipped) });
      console.log('\n[label] bye — state saved.');
      return;
    }
    if (key === 'k') {
      skipped.add(row.text);
      await saveState(args.state, { seed: args.seed, queueHash, skipped: Array.from(skipped) });
      continue;
    }

    if (!(key in LABEL_KEYS)) {
      console.log(`[label] '${key}' is not a label. Try: e s m o u k q`);
      i--; // re-prompt the same row
      continue;
    }
    const expected = LABEL_KEYS[key as LabelKey];
    const labelledRow: LabelledRow = { text: row.text, expected, ts: new Date().toISOString() };
    await appendFile(args.out, `${JSON.stringify(labelledRow)}\n`);
    labelled.add(row.text);
    cov = computeCoverage(queue, labelled);
  }

  console.log(`\n[label] queue exhausted — ${labelled.size} labels in ${args.out}`);
}

if (import.meta.main) {
  await main();
}
