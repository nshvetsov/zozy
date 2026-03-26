# Runtime Acceptance (GitHub Pages)

## Objective

Define release gates for production use of SQLite-backed dictionary search.

## Mandatory Documents In Target Repository

The implementation repository must contain (or explicitly merge into equivalent
existing docs):

- `docs/sqlite-runtime-contract.md`
- `docs/normalization-contract.md`
- `docs/search-contract.md`
- `docs/word-verification-contract.md`
- `docs/runtime-acceptance.md`

If equivalent files already exist (`README`, `docs/architecture.md`,
`docs/search.md`), content may be merged, but contract sections must remain
discoverable.

## Acceptance Criteria

### A. Runtime Source of Truth

- app search uses only `lookup.sqlite` as required runtime data
- JSON sidecars are not required for runtime query path

### B. Normalization Parity

- frontend/runtime normalization produces same output as reference contract
- parity tests cover accents, `ё/е`, lookalike Latin letters, punctuation, and
  repeated spaces

### C. Exact Lookup Correctness

- exact matching uses `headwords.headword_norm`
- one input word returns all exact hits across all dictionaries
- result enrichment via `entries` and `dictionaries` is correct

### D. Batch Lookup Correctness

- batch input size 10-50 works reliably
- response groups by original input words in deterministic order
- dedup by normalized form does not alter final per-input result correctness

### E. Compound Layer Correctness

- compound layer is additive only
- `exact_match` is never replaced by compound-only status
- `compound_related_match` is used only when exact hit is absent

### F. Production Smoke

- DB can be loaded in GitHub Pages runtime environment
- no critical runtime errors in the search path
- response time is acceptable for standard batch usage

## Release Checklist

- contracts updated and reviewed
- normalization parity tests green
- exact + batch + compound classification tests green
- smoke test green in production-like static hosting setup
- release notes describe any behavior change in search/verification semantics

