# FinSightIQ — Research Methodology

**Status:** Stub — written before data collection begins (Phase 1, Week 2)
**Author:** Anurag Shah
**Last updated:** [28/05/2026]

---

## 1. Research Questions

- **RQ2:** Does sentence-boundary chunking outperform fixed-size chunking on
  regulatory contradiction detection F1 for financial documents?
- **RQ3:** Does hybrid retrieval (vector + BM25) outperform vector-only retrieval
  on Precision@5 for financial compliance queries?
- **RQ5:** Does prompt structure (chain-of-thought vs. direct classification)
  affect contradiction detection F1 on financial document pairs?

## 2. Datasets

| Dataset | Source | Use |
|---|---|---|
| FinNLI | Public academic dataset | Retrieval eval ground truth |
| ObliQA | Public academic dataset | Regulatory QA eval |
| SEBI Circulars | sebi.gov.in (public) | Regulatory corpus for contradiction detection |
| RBI Master Directions | rbi.org.in (public) | Regulatory corpus |
| SEC 10-K / 10-Q | EDGAR public API | Earnings filing corpus |

**No real internal financial institution data is used at any point.**

## 3. Ground Truth Construction

A contradiction pair is valid ground truth if:
- It exists between two documents in the same collection
- The `contradiction_type` is agreed upon by at least 2 independent labelers
- It is not a version-difference stale reference

Labeling is done via the FinSightIQ annotations interface.

## 4. What Counts as a Valid Financial Contradiction

A contradiction is a case where two documents present legally or numerically
incompatible positions on the same obligation, metric, defined term, or permitted
action — such that acting on one document would violate the other.

Not a contradiction:
- Document referencing an older regulatory version → that is a stale reference
- Two documents in unrelated regulatory domains with no overlapping obligations
- One document being silent on a topic addressed by another

## 5. Evaluation Metrics

| Metric | Used for |
|---|---|
| F1 | Contradiction detection (RQ2, RQ5) |
| Precision@k | Retrieval quality (RQ3) |
| Recall@k | Retrieval completeness (RQ3) |
| MRR | Mean reciprocal rank — retrieval ranking quality |

## 6. Dataset Size Limitation ⚠️

**Applies to RQ2, RQ3, RQ5.**

The corpus achievable within an internship timeline is not representative of
production-scale regulatory volumes. All F1 and Precision@k figures in this
project carry this limitation and must be reported with corpus size
(document count, chunk count) alongside the metric value.

## 7. Prompt Versioning

Every benchmark run is tied to a `prompt_version_id` from the `prompt_templates`
table. Changing the prompt mid-project requires a new version row — results from
different versions are never aggregated. This guarantee is enforced at the
schema level: `benchmark_runs.prompt_version_id` is a direct FK column.

---

## 8. Ground-Truth Labeling Safety

Generate candidate pairs once, label `ground-truth/candidate_pairs.csv`, then
import the completed file:

```bash
cd backend
npm run label:pairs
npm run import:ground-truth
```

`npm run label:pairs` refuses to overwrite an existing candidate CSV. Use the
following command only when intentionally discarding that file and regenerating
it from the current collection:

```bash
npm run label:pairs:regenerate
```

Imports are idempotent: the database keeps one row for each document pair and
label polarity. CSV files above 50 MB are rejected before parsing.

---

*Sections 8–12 (results, analysis, conclusions) to be completed in Phase 4
once benchmark data has been collected and validated.*
