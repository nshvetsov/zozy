# Search Contract

## Purpose

Define stable runtime behavior for dictionary search over `lookup.sqlite` on
GitHub Pages.

## Search Layers

### Layer 1 (Required): Exact Normalized Lookup

- Normalize every input word using `normalization-contract.md`.
- Query `headwords.headword_norm`.
- Return all matches across all dictionaries.

### Layer 2 (Required): Batch Lookup

- Accept a list of words (recommended batch size: 10-50).
- Preserve input order in response.
- Group matches by original input word.
- Deduplicate DB request set by normalized form before querying.

### Layer 3 (Optional Enrichment): Compound-Aware Signal

- Use `compound_markup` and `compound_components` as metadata enrichment.
- Never replace or hide exact lookup results.
- Report compound evidence as a distinct result category.

## Canonical Query Behavior

Equivalent to current reference script logic:

- Build `(input_word, normalized_word)` pairs.
- Build unique normalized set.
- Query with `WHERE h.headword_norm IN (...)`.
- Join:
  - `headwords h`
  - `entries e ON e.id = h.entry_id`
  - `dictionaries d ON d.id = h.dictionary_id`
- Order: `h.headword_norm, d.code, e.id`

## Output Contract (Minimal)

For each input word:

- `input_word`
- `normalized_word`
- `matches[]`

Each exact match item:

- `dictionary_code`
- `dictionary_title`
- `entry_id`
- `headword_display`
- `page_start`
- `page_end`
- `entry_text_clean`

Optional enrichment field:

- `compound_matches[]` (if present, separate from exact `matches[]`)

## Non-Negotiable Rules

- Exact and compound results must be logically separated.
- No runtime dependency on JSON sidecar files.
- No partial fallback that bypasses normalization.
- Cross-dictionary results must be complete (not first-hit only).

