# Normalization Contract

## Goal

Guarantee that user input normalization in production search is identical to
normalization used when dictionary headwords were stored in SQLite.

## Normative Function

Reference implementation:

- `scripts/build_orfoepic_index.py` -> `normalize_for_search()`

Any production implementation (JS/TS/Python/etc.) must be behavior-compatible.

## Required Steps (Strict Order)

1. Unicode NFC normalization.
2. Lowercase conversion.
3. Latin-to-Cyrillic lookalike translation.
4. Remove accent marks (`\u0300`, `\u0301`).
5. Replace `ё` with `е`.
6. Remove every character outside `[а-я0-9\- ]`.
7. Collapse repeated spaces and trim.

## Reference Mapping (Latin Lookalikes)

The translation table must include at least:

- `a -> а`
- `b -> в`
- `c -> с`
- `e -> е`
- `h -> н`
- `k -> к`
- `m -> м`
- `o -> о`
- `p -> р`
- `t -> т`
- `x -> х`
- `y -> у`

## Compatibility Rules

- Do not introduce an alternative normalization algorithm by default.
- If a change is proposed, add an A/B compatibility test suite against the
  current output of `normalize_for_search()`.
- A change is accepted only if it is explicitly approved and migration impact is
  documented.

## Production Requirements

- Every lookup path (single-word and batch) must normalize input first.
- Matching must use normalized values only (`headword_norm`).
- Raw input must still be preserved for output display and grouping.

## Minimal Parity Test Set

The target repository should include parity tests for:

- accented input (`а̀`, `а́`)
- `ё`/`е` equivalence
- mixed Latin/Cyrillic lookalikes
- punctuation/noise stripping
- repeated whitespace normalization

