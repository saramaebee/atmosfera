# @atmosfera/lang-classify

Multinomial Naive Bayes classifier that tags short text as `en`, `es`, `other`, `mixed`, or `unknown`. Used by the bot's `/checklang` command and as input to the language-aware roast pipeline.

The shipped model lives at `src/models/default.json`; the regression suite that gates it lives at `src/models/eval-set.json`. Confidence thresholds and the mixed-language stopword override are defined in `src/classify.ts`.

## Training pipeline

The training/eval flow is four bun scripts run from the package root:

```bash
# 1. Download Tatoeba dumps → .cache/corpus.jsonl
bun run build:corpus

# 2. Stratify the corpus into a labelling queue → .cache/candidates.jsonl
#    Length × confidence buckets; over-samples low-confidence rows where
#    the current model is least sure (that's where new signal lives).
bun run build:candidates

# 3. Hand-label the queue, one keystroke per row → .cache/labelled.jsonl
bun run label

# 4. Compare human labels to the shipped model, surface disagreements
bun run audit
```

`bun run evaluate` runs the eval-set regression at any point; `bun run train --source jsonl --path <path>` rebuilds the model from a JSONL corpus.

## Data-source privacy policy

The committed eval set (`src/models/eval-set.json`) and any training data checked into this repository are sourced **exclusively** from public-domain corpora (Tatoeba) and from synthesized text we generate ourselves. Real Discord message text from `messages_recent` is **never** committed — not verbatim, not anonymized, not paraphrased.

If a labelling pass ever needs real-message signal (e.g. to capture short, slangy, code-switching register the formal Tatoeba data lacks), both the candidate queue and the labelled output must stay inside `packages/lang-classify/src/train/.cache/`, which is gitignored. CI publishes accuracy numbers against the public eval set; it does not publish text.

This policy holds even though the message-ingestion path already filters out roast-opt-out users and bots: the rationale is that short personal-register text is potentially identifying even with author IDs and mentions stripped, and the cost of leakage is asymmetric against the modest accuracy gain from committing real text. The decision and rationale are recorded in issue #22.
