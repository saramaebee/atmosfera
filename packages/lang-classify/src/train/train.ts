#!/usr/bin/env bun
/**
 * Train the Multinomial Naive Bayes language model. Reads a corpus (default:
 * the bundled seed corpus; override with --source jsonl --path X.jsonl), writes
 * `src/models/default.json`.
 *
 * NB the algorithm and feature set match `classify.ts` exactly — adding a
 * feature family there requires re-running this script so the model JSON
 * carries the new vocab.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { extractFeatures } from '../features';
import { type LangModel, MODEL_VERSION } from '../model';
import { preprocess } from '../preprocess';
import { type CorpusRow, FIRST_CLASS_LANGS, OTHER_SUBCLASSES, toTopLevelClass } from './types';

const HERE = dirname(new URL(import.meta.url).pathname);
const PKG_ROOT = resolve(HERE, '..', '..');

interface Args {
  source: 'seed' | 'jsonl';
  path?: string;
  out: string;
  // Drop features whose document frequency (count of training docs containing
  // them, across all classes) is below this. Keeps the model JSON small and
  // prunes one-off noise n-grams.
  minDocFreq: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    source: 'seed',
    out: resolve(PKG_ROOT, 'src', 'models', 'default.json'),
    minDocFreq: 3,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i] as Args['source'];
    else if (a === '--path') args.path = argv[++i];
    else if (a === '--out') args.out = resolve(argv[++i]);
    else if (a === '--min-df') args.minDocFreq = Number(argv[++i]);
  }
  return args;
}

async function loadCorpus(args: Args): Promise<CorpusRow[]> {
  if (args.source === 'seed') {
    const seedPath = resolve(PKG_ROOT, 'src', 'models', 'seed-corpus.json');
    const raw = await readFile(seedPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const rows: CorpusRow[] = [];
    for (const [lang, samples] of Object.entries(parsed)) {
      for (const text of samples) rows.push({ lang, text, source: 'seed' });
    }
    return rows;
  }
  if (args.source === 'jsonl') {
    if (!args.path) throw new Error('--path required for --source jsonl');
    const raw = await readFile(args.path, 'utf8');
    const rows: CorpusRow[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const r = JSON.parse(trimmed) as CorpusRow;
      if (r.lang && r.text) rows.push(r);
    }
    return rows;
  }
  throw new Error(`unknown source: ${args.source}`);
}

function train(rows: CorpusRow[], minDocFreq: number): LangModel {
  // Top-level classes: the first-class languages plus 'other'.
  const classes = [...FIRST_CLASS_LANGS, 'other'];
  const classIdx = new Map<string, number>();
  classes.forEach((c, i) => classIdx.set(c, i));

  // Stage 1: document frequency across all docs (for pruning).
  const docFreq = new Map<string, number>();
  // Stage 2: per-class feature totals + per-class doc counts.
  const perClassFeatureCount: Map<string, number>[] = classes.map(() => new Map());
  const perClassDocCount = new Array<number>(classes.length).fill(0);
  // Per-class total feature mass (for the denominator of the MNB likelihood).
  const perClassMass = new Array<number>(classes.length).fill(0);

  for (const row of rows) {
    const cleaned = preprocess(row.text);
    if (!cleaned) continue;
    const cls = toTopLevelClass(row.lang);
    const cIdx = classIdx.get(cls);
    if (cIdx === undefined) continue;
    const feats = extractFeatures(cleaned);
    if (feats.size === 0) continue;
    perClassDocCount[cIdx]++;
    const seenInDoc = new Set<string>();
    for (const [f, count] of feats) {
      const m = perClassFeatureCount[cIdx];
      m.set(f, (m.get(f) ?? 0) + count);
      perClassMass[cIdx] += count;
      if (!seenInDoc.has(f)) {
        docFreq.set(f, (docFreq.get(f) ?? 0) + 1);
        seenInDoc.add(f);
      }
    }
  }

  // Prune low-DF features.
  const vocab: string[] = [];
  for (const [feat, df] of docFreq) {
    if (df >= minDocFreq) vocab.push(feat);
  }
  vocab.sort();
  const vocabIdx = new Map<string, number>();
  vocab.forEach((v, i) => vocabIdx.set(v, i));

  // Compute per-class log-likelihood with add-1 (Laplace) smoothing:
  //   logLL[c][i] = log( (count(feat_i, c) + 1) / (mass(c) + |V|) )
  const V = vocab.length;
  const logLikelihood: number[][] = classes.map((_, cIdx) => {
    const denom = Math.log(perClassMass[cIdx] + V);
    const row = new Array<number>(V);
    const counts = perClassFeatureCount[cIdx];
    for (let i = 0; i < V; i++) {
      const c = counts.get(vocab[i]) ?? 0;
      row[i] = Math.log(c + 1) - denom;
    }
    return row;
  });

  // Log priors: smoothed class priors (proportional to doc counts, +1 smoothing
  // so an empty class doesn't blow up).
  const totalDocs = perClassDocCount.reduce((a, b) => a + b, 0);
  const logPrior = perClassDocCount.map((d) => Math.log((d + 1) / (totalDocs + classes.length)));

  // Track what fell into 'other' so the runtime can label them.
  const subclassesIn = { other: [...OTHER_SUBCLASSES] };

  return {
    version: MODEL_VERSION,
    classes,
    subclassesIn,
    vocab,
    logPrior,
    logLikelihood,
    meta: {
      trainedAt: new Date().toISOString(),
      docCounts: Object.fromEntries(classes.map((c, i) => [c, perClassDocCount[i]])),
      vocabSize: V,
      minDocFreq,
      source: 'mnb-add1',
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = await loadCorpus(args);
  console.log(`[train] loaded ${rows.length} rows from ${args.source}`);
  const model = train(rows, args.minDocFreq);
  console.log(`[train] vocab=${model.vocab.length} classes=${model.classes.join(',')}`);
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(model));
  console.log(`[train] wrote ${args.out} (${(await readFile(args.out)).length} bytes)`);
}

if (import.meta.main) {
  await main();
}

export { train, loadCorpus };
