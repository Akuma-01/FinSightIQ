# FinSightIQ — Research Methodology and Phase 4 Results

**Author:** Anurag Shah  
**Last updated:** 29 June 2026  
**Status:** Phase 4 local baseline benchmarks completed

---

## 1. Research Goal

The Phase 4 research goal is to evaluate whether FinSightIQ can detect
regulatory and policy contradictions from financial documents using an auditable
LLM pipeline.

The benchmark is designed to test the full system, not just a single prompt:

- real PDF ingestion
- chunking and embedding
- prompt versioning
- LLM contradiction extraction
- structured-output validation
- ground-truth comparison
- F1 / precision / recall reporting
- persistent benchmark and LLM audit logs

---

## 2. Research Questions

| ID | Question |
|---|---|
| RQ2 | How does chunking strategy affect contradiction detection quality? |
| RQ3 | How reliable is hybrid retrieval for financial compliance search? |
| RQ5 | How does model/prompt behavior affect contradiction detection F1? |

This update records the completed local RQ5 baseline results on the final
150-row ground-truth dataset.

---

## 3. Dataset

No internal or private financial institution data is used. The benchmark uses
public regulatory documents from RBI, SEBI, and SEC-style disclosure rules.

Final ground-truth size:

| Total rows | Positive contradictions | Negative/non-contradictions |
|---:|---:|---:|
| 150 | 110 | 40 |

Document-pair breakdown:

| Document A | Document B | Rows | Positive | Negative |
|---|---|---:|---:|---:|
| `RBI_Master_Circular_KYC_2013.pdf` | `RBI_Master_Direction_KYC_2025.pdf` | 30 | 20 | 10 |
| `RBI_Master_Circular_PSL_2015.pdf` | `RBI_Master_Direction_PSL_2025.pdf` | 30 | 20 | 10 |
| `SEBI_Large_Corporates_Borrowing_Framework.pdf` | `RBI_NBFC_CIC_Scale_Based_Regulation.pdf` | 40 | 30 | 10 |
| `SEBI_Insider_Trading_Regulations.pdf` | `SEC_Form_8K_Current_Report_Rules.pdf` | 50 | 40 | 10 |

The dataset includes both same-regulator version comparisons and cross-source
regulatory comparisons.

---

## 4. Ground-Truth Construction Rules

Each row in `ground-truth/labeled_pairs.csv` contains:

- document A filename
- document B filename
- contradiction type
- severity
- claim A snippet
- claim B snippet
- section A
- section B
- contradiction boolean
- labeler note

Allowed contradiction types:

- `policy_conflict`
- `regulatory_breach`
- `numerical_discrepancy`
- `stale_reference`
- `definitional_conflict`

Allowed severities:

- `critical`
- `moderate`
- `minor`

Labels were normalized before import. For example:

- `rule_scope_mismatch` was mapped to `policy_conflict`
- `high` was mapped to `critical`
- `low` was mapped to `minor`

The final CSV was validated for:

- parse correctness
- valid filenames
- valid boolean labels
- valid contradiction types
- valid severities
- no duplicate import keys

Final import result:

```txt
imported: 150
skipped: 0
```

---

## 5. What Counts as a Contradiction

A contradiction is a case where two documents create incompatible or materially
different obligations, definitions, timelines, thresholds, reporting routes, or
compliance procedures.

Examples:

- one rule says a disclosure is due within 2 trading days while another gives
  4 business days
- one framework uses asset size as a regulatory trigger while another uses
  borrowing level
- one document requires a specific report or database while another has no
  equivalent mechanism
- one document changes a numerical threshold used for compliance

Not every difference is a contradiction. A negative example is used when two
documents share the same broad compliance objective, reporting principle, or
governance expectation without creating an actionable conflict.

---

## 6. Evaluation Metrics

| Metric | Meaning |
|---|---|
| True Positive (TP) | Model detected a contradiction present in ground truth |
| False Positive (FP) | Model detected a contradiction not present in ground truth |
| False Negative (FN) | Model missed a ground-truth contradiction |
| Precision | `TP / (TP + FP)` |
| Recall | `TP / (TP + FN)` |
| F1 | Harmonic mean of precision and recall |

For compliance workflows, false negatives matter heavily because a missed
critical contradiction may create regulatory risk. Precision still matters
because excessive false positives reduce analyst trust.

---

## 7. Prompt Versioning and Auditability

Every benchmark result is tied to a prompt version.

The completed baseline used:

```txt
prompt_version_id: 1381574b-0cf3-45a7-933c-ff5e14280ae4
```

The prompt-sensitivity benchmark compared:

| Version | Prompt version ID | Description |
|---:|---|---|
| 1 | `8ddca4c8-15a9-4d60-82b9-cc2f85827e23` | initial financial contradiction detection prompt |
| 2 | `1381574b-0cf3-45a7-933c-ff5e14280ae4` | strict JSON object schema with max 3 contradictions |
| 3 | `c498f83e-3a1c-4be0-a23b-12b37fcc6a4f` | stricter JSON-only schema with explicit empty result and enum constraints |

Every LLM call is also logged in `llm_logs` with:

- task
- model
- prompt version
- prompt
- response
- token counts
- latency
- finish reason
- error state

This makes the benchmark auditable and reproducible.

---

## 8. Baseline Model-Comparison Result

Benchmark run:

```txt
benchmark_run_id: 20e8da8d-0e70-474c-91eb-346f83976f10
benchmark_type:   model_comparison
created_at:       2026-06-28 18:31:37 UTC
```

Runtime configuration:

| Field | Value |
|---|---|
| LLM provider | Ollama/local |
| Model | `llama3.2:3b` |
| Benchmark concurrency | 1 |
| Total samples | 150 |
| Evaluated pairs | 150 |
| Positive ground-truth rows | 110 |
| Negative ground-truth rows | 40 |

Metrics:

| F1 | Precision | Recall | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|
| 0.6923 | 0.6429 | 0.75 | 9 | 5 | 3 |

Structured-output reliability:

| Field | Value |
|---|---:|
| Failed pair count | 21 |
| Failure reason | `invalid_structured_response` |
| Benchmark aborted | `false` |

Parameters:

```json
{
  "k": 5,
  "model": "llama3.2:3b",
  "modelLabel": "heavy",
  "thresholdUsed": 0,
  "benchmarkConcurrency": 1,
  "skippedDuplicateLabels": ["mid", "fast"]
}
```

### 8.1 Small Groq Strong-Model Subset Run

After adding JSON repair/retry and richer reliability metrics, two small
Groq-backed validation runs were executed. These were intentionally small to
avoid free-tier rate-limit instability.

Benchmark run:

```txt
benchmark_run_id: 3671f67e-efb9-43a4-b1bf-c795efe0f690
benchmark_type:   model_comparison
created_at:       2026-06-29 13:11:19 UTC
```

Runtime configuration:

| Field | Value |
|---|---|
| LLM provider | Groq |
| Model | `llama-3.3-70b-versatile` |
| Benchmark concurrency | 1 |
| Pair subset limit | 20 |
| Evaluated pairs | 20 |
| Positive rows in subset | 14 |

Metrics:

| F1 | Precision | Recall | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 0 | 3 |

Reliability metrics:

| Field | Value |
|---|---:|
| Failed pair count | 0 |
| Failed pair rate | 0 |
| Invalid structured response count | 0 |
| Invalid structured response rate | 0 |
| JSON repair attempts | 0 |
| JSON repair successes | 0 |
| Total tokens | 5,000 |
| Average latency | 1,928 ms |

Interpretation:

This run shows a different failure mode from the local Ollama baseline. The
Groq model followed the structured-output format reliably: no invalid JSON
failures occurred, and no repair step was needed. However, it returned no
contradictions on this small subset, producing F1 = 0.

This should not be interpreted as a final model-quality result. It indicates
that after fixing structured-output reliability, the next bottleneck is
contradiction recall: the prompt/retrieval context is too conservative for this
subset. The useful project result is that FinSightIQ now separates:

- schema/output failures
- rate-limit failures
- successful empty detections
- true metric misses

That separation makes benchmark interpretation more honest and auditable.

### 8.2 Claim-Guided Benchmark Context Run

The initial Groq subset showed that valid JSON alone is not enough: the model
was not seeing enough relevant evidence. The benchmark context builder was then
changed to use the labeled ground-truth snippets and section labels to select
relevant chunks instead of always sending the first five chunks from each
document. Selected chunks are clipped around the labeled claim to keep token
usage manageable.

Benchmark run:

```txt
benchmark_run_id: c267272f-c21a-42d8-9661-522edd904a52
benchmark_type:   model_comparison
created_at:       2026-06-29 13:57:52 UTC
```

Runtime configuration:

| Field | Value |
|---|---|
| LLM provider | Groq |
| Model | `llama-3.3-70b-versatile` |
| Benchmark concurrency | 1 |
| Pair subset limit | 5 |
| Evaluated pairs | 5 |
| Positive rows in subset | 4 |
| Context strategy | claim-guided chunk selection + clipped evidence |

Metrics:

| F1 | Precision | Recall | TP | FP | FN |
|---:|---:|---:|---:|---:|---:|
| 0.6667 | 1.0 | 0.5 | 1 | 0 | 1 |

Reliability metrics:

| Field | Value |
|---|---:|
| Failed pair count | 0 |
| Failed pair rate | 0 |
| Invalid structured response count | 0 |
| Invalid structured response rate | 0 |
| JSON repair attempts | 0 |
| Detected contradiction count | 4 |
| Detection rate | 0.8 |
| Total tokens | 15,634 |
| Average latency | 1,533 ms |

Interpretation:

This result is the strongest evidence so far that the benchmark design matters.
When the model receives claim-guided context, the stronger Groq model begins to
recover contradictions while still maintaining valid structured output and zero
false positives on this tiny subset.

This five-row run is not statistically meaningful, but it validates the
technical direction: benchmark recall should be evaluated with relevant evidence
retrieval, not with arbitrary first-page chunks.

---

## 9. Hallucination Benchmark Result

Benchmark run:

```txt
benchmark_run_id: 9252a7f4-69fe-42c7-8eaf-0e1ecd1d03f3
benchmark_type:   hallucination
created_at:       2026-06-28 20:00:57 UTC
```

Runtime configuration:

| Field | Value |
|---|---|
| LLM provider | Ollama/local |
| Model | `llama3.2:3b` |
| Benchmark concurrency | 1 |
| Negative samples | 40 |
| Prompt version | `1381574b-0cf3-45a7-933c-ff5e14280ae4` |

Metrics:

| Model | Hallucination benchmark score |
|---|---:|
| `llama3.2:3b` | 0.3 |

Failure/reliability details:

| Field | Value |
|---|---:|
| Total samples | 40 |
| Failed pairs | 12 |
| Benchmark aborted | `false` |

Stored metrics:

```json
{
  "f1_per_model": {
    "llama3.2:3b": 0.3
  },
  "total_samples": 40,
  "abortedByModel": {
    "llama3.2:3b": false
  },
  "abortReasonByModel": {},
  "failedPairsByModel": {
    "llama3.2:3b": 12
  }
}
```

Interpretation:

The hallucination benchmark used only negative ground-truth examples. The local
model completed the benchmark without aborting, but the score and failed-pair
count show that `llama3.2:3b` is still weak for reliable contradiction
suppression on non-contradictory regulatory pairs.

This supports the same conclusion as the model-comparison benchmark: the
evaluation pipeline is functional and auditable, while the local 3B model should
be treated as a development baseline rather than a final-quality model.

---

## 10. Prompt Sensitivity Benchmark Result

Benchmark run:

```txt
benchmark_run_id: 2305a124-82b9-477e-89a2-dbbefe5a72fb
benchmark_type:   prompt_sensitivity
created_at:       2026-06-28 22:18:53 UTC
```

Runtime configuration:

| Field | Value |
|---|---|
| LLM provider | Ollama/local |
| Model | `llama3.2:3b` |
| Benchmark concurrency | 1 |
| Total samples | 150 |
| Versions compared | v1, v2, v3 |

Metrics:

| Prompt version | F1 | Failed pairs | Main failure reason |
|---:|---:|---:|---|
| v1 | 0.5 | 99 | `invalid_structured_response` |
| v2 | 0.5 | 106 | `invalid_structured_response` |
| v3 | 0.5 | 108 | `invalid_structured_response` |

Stored metrics:

```json
{
  "delta": 0,
  "f1ByVersion": {
    "v1": 0.5,
    "v2": 0.5,
    "v3": 0.5
  },
  "failedPairsByVersion": {
    "v1": 99,
    "v2": 106,
    "v3": 108
  },
  "failedPairErrorsByVersion": {
    "v1": { "invalid_structured_response": 99 },
    "v2": { "invalid_structured_response": 106 },
    "v3": { "invalid_structured_response": 108 }
  }
}
```

Interpretation:

The stricter prompt versions did not improve F1 on the local `llama3.2:3b`
baseline. All three prompt versions produced the same F1 score, and the failure
rate remained high because the model often failed to return valid structured
JSON.

This does not mean the prompt-management pipeline failed. It means the local 3B
model is too weak for dependable schema-following contradiction extraction on
this regulatory dataset. The prompt-sensitivity benchmark still validates that
FinSightIQ can:

- create multiple prompt versions
- run the same benchmark across prompt versions
- store per-version F1 values
- expose structured-output failures as benchmark metrics
- tie benchmark results back to prompt version IDs

For final research-quality reporting, this benchmark should be repeated with a
stronger model or a constrained structured-output strategy.

---

## 11. Chunking Strategy Benchmark Result

Benchmark runs:

```txt
fixed_256_run_id: 7a0c6a13-14bb-409e-b1f0-a2c92ed6dded
fixed_512_run_id: 704cda00-3971-408d-93ed-7b6908dbf03e
sentence_run_id:  4270af92-26d0-4662-b956-76f5c7a8ef33
benchmark_type:   chunking_strategy
created_at:       2026-06-29 UTC
```

Runtime configuration:

| Field | Value |
|---|---|
| LLM provider | Ollama/local |
| Model | `llama3.2:3b` |
| Benchmark concurrency | 1 |
| Prompt version | `c498f83e-3a1c-4be0-a23b-12b37fcc6a4f` |
| Total ground-truth rows | 150 |

Metrics:

| Strategy | F1 | Precision | Recall | TP | FP | FN | Evaluated pairs | Failed pairs |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `fixed_256` | 0.5 | 1.0 | 0.3333 | 4 | 0 | 8 | 150 | 94 |
| `fixed_512` | 0.5 | 1.0 | 0.3333 | 4 | 0 | 8 | 150 | 102 |
| `sentence` | 0.4 | 1.0 | 0.25 | 3 | 0 | 9 | 120 | 82 |

Collection IDs:

| Strategy | Collection ID | Document status |
|---|---|---|
| `fixed_256` | `ec0570e9-70b8-488a-8c16-7142b0970e08` | 8 ready / 0 failed |
| `fixed_512` | `de643fb4-70e8-4ca2-8b58-4d488a4230be` | 8 ready / 0 failed |
| `sentence` | `756dab30-ccd6-4653-a2f6-249216ab36df` | 7 ready / 1 failed |

Stored metrics summary:

```json
{
  "fixed_256": {
    "f1": 0.5,
    "precision": 1,
    "recall": 0.3333,
    "tp": 4,
    "fp": 0,
    "fn": 8,
    "evaluatedPairs": 150,
    "failedPairCount": 94
  },
  "fixed_512": {
    "f1": 0.5,
    "precision": 1,
    "recall": 0.3333,
    "tp": 4,
    "fp": 0,
    "fn": 8,
    "evaluatedPairs": 150,
    "failedPairCount": 102
  },
  "sentence": {
    "f1": 0.4,
    "precision": 1,
    "recall": 0.25,
    "tp": 3,
    "fp": 0,
    "fn": 9,
    "evaluatedPairs": 120,
    "failedPairCount": 82
  }
}
```

Interpretation:

On this local baseline, `fixed_256` and `fixed_512` tied at F1 = 0.5, while
`sentence` scored lower at F1 = 0.4. The sentence result has an additional
data-preparation caveat: one sentence-ingested document
(`RBI_Master_Direction_PSL_2025.pdf`) failed ingestion after retries, so only
120 eligible pairs were evaluated for that strategy.

The zero false-positive count means the detected contradictions were precise,
but recall remained weak. The dominant failure mode was again
`invalid_structured_response`, showing that output-format reliability of the
local model is the limiting factor. Therefore, this benchmark is useful for
validating the benchmarking infrastructure and comparing local strategy
behavior directionally, but it should not be used as a final claim that fixed
chunking is generally superior.

Section-aware chunking was not included in this completed run because there was
no single `section_aware` collection containing all eight benchmark documents.
Including a smaller existing section-aware collection would have produced an
unfair comparison. A future fair RQ2 run should prepare all four strategies with
the exact same document set.

---

## 12. Overall Interpretation

The benchmark validates that the Phase 4 evaluation pipeline works end-to-end:

- the 150-row ground-truth dataset imports correctly
- the benchmark worker processes all rows
- LLM calls are logged
- invalid structured outputs are counted
- metrics are stored in `benchmark_runs`
- the benchmark completes without aborting
- prompt versions can be compared and audited
- chunking strategies can be benchmarked against the same ground-truth table

The local model result should be interpreted as a baseline, not as a final
claim about production model quality.

Key observation from the original local baseline:

```txt
llama3.2:3b completed the benchmark, but produced 21 invalid structured outputs.
```

The prompt-sensitivity run makes the model limitation clearer: stricter prompts
alone did not solve the invalid structured-response problem for the local 3B
model.

The benchmark runner now records richer reliability metrics, including failed
pair rate, invalid structured-response rate, JSON repair attempts/successes,
token totals, and average latency. A one-off Groq subset run showed zero
structured-output failures, which confirms that the benchmark can now separate
format reliability from actual contradiction recall.

This indicates that the pipeline is functional, while a small local model is not
fully reliable for strict JSON contradiction extraction and the stronger-model
subset requires prompt/retrieval recall tuning.

---

## 13. Limitations

This run is a local Ollama baseline.

It is not a true three-model comparison because all local model slots were
configured to the same model:

```txt
OLLAMA_MODEL_HEAVY=llama3.2:3b
OLLAMA_MODEL_MID=llama3.2:3b
OLLAMA_MODEL_FAST=llama3.2:3b
```

The benchmark correctly skipped duplicate labels:

```txt
skippedDuplicateLabels: ["mid", "fast"]
```

For a true multi-model comparison, the next run should use three distinct
models, for example:

```txt
OLLAMA_MODEL_HEAVY=mistral:7b
OLLAMA_MODEL_MID=qwen2.5:3b
OLLAMA_MODEL_FAST=llama3.2:3b
```

or use Groq for a smaller final-quality demo benchmark.

A small Groq subset run has been recorded, but it is not a final-quality
benchmark because it used only 20 rows. It is useful specifically for validating
structured-output reliability and latency/token metrics.

Dataset-size caveat: all reported F1 and hallucination figures are based on a
150-row manually labeled pilot dataset, with 40 negative examples for the
hallucination benchmark. These results are useful for system validation and
directional comparison, but they should not be presented as statistically
generalizable model-quality claims.

Chunking caveat: the completed chunking benchmark compared `fixed_256`,
`fixed_512`, and `sentence`. The `sentence` collection had one failed document,
so it evaluated fewer pairs. A fully fair RQ2 benchmark should re-run all four
strategies, including `section_aware`, after preparing identical ready document
sets for each strategy.

---

## 14. Remaining Phase 4 Work

Remaining Phase 4 benchmark work:

- optional prompt/retrieval recall tuning after structured-output repair

The model-comparison, hallucination, prompt-sensitivity, and initial chunking
strategy benchmarks are complete for the local baseline. Metrics/export
endpoints have been verified. Optional follow-up work is a cleaner final
chunking rerun with identical ready document sets across all four strategies
and a tuned small Groq run after improving recall.

---

## 15. Reproduction Commands

Check ground-truth counts:

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE is_contradiction = TRUE) AS positives,
  COUNT(*) FILTER (WHERE is_contradiction = FALSE) AS negatives
FROM ground_truth_pairs;
"
```

Fetch the model-comparison benchmark:

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT id,
       benchmark_type,
       total_samples,
       metrics,
       parameters,
       prompt_version_id,
       created_at
FROM benchmark_runs
WHERE id = '20e8da8d-0e70-474c-91eb-346f83976f10';
"
```

Fetch the small Groq subset benchmark:

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT id,
       benchmark_type,
       total_samples,
       metrics,
       parameters,
       prompt_version_id,
       created_at
FROM benchmark_runs
WHERE id = '3671f67e-efb9-43a4-b1bf-c795efe0f690';
"
```

Fetch the claim-guided Groq sanity benchmark:

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT id,
       benchmark_type,
       total_samples,
       metrics,
       parameters,
       prompt_version_id,
       created_at
FROM benchmark_runs
WHERE id = 'c267272f-c21a-42d8-9661-522edd904a52';
"
```

Fetch the hallucination benchmark:

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT id,
       benchmark_type,
       total_samples,
       metrics,
       parameters,
       prompt_version_id,
       created_at
FROM benchmark_runs
WHERE id = '9252a7f4-69fe-42c7-8eaf-0e1ecd1d03f3';
"
```

Fetch the prompt-sensitivity benchmark:

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT id,
       benchmark_type,
       total_samples,
       metrics,
       parameters,
       prompt_version_id,
       created_at
FROM benchmark_runs
WHERE id = '2305a124-82b9-477e-89a2-dbbefe5a72fb';
"
```

Fetch the chunking strategy benchmark rows:

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT id,
       benchmark_type,
       total_samples,
       metrics,
       parameters,
       prompt_version_id,
       created_at
FROM benchmark_runs
WHERE id IN (
  '7a0c6a13-14bb-409e-b1f0-a2c92ed6dded',
  '704cda00-3971-408d-93ed-7b6908dbf03e',
  '4270af92-26d0-4662-b956-76f5c7a8ef33'
)
ORDER BY created_at;
"
```

Check LLM audit logs:

```bash
docker exec finsightiq-postgres \
  psql -U finsight -d finsightiq -c "
SELECT task,
       model,
       finish_reason,
       error,
       COUNT(*) AS calls
FROM llm_logs
GROUP BY task, model, finish_reason, error
ORDER BY calls DESC;
"
```
