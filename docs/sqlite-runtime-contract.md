# SQLite Runtime Contract

## Purpose

This contract defines how `artifacts/runtime/lookup.sqlite` must be treated in
the production GitHub Pages repository.

- SQLite is the only required runtime source of truth.
- JSON files are optional QA/debug artifacts and must not be required by
  runtime search logic.
- Exact lookup uses normalized forms in `headwords.headword_norm`.

## Scope

Included:

- runtime DB structure
- table/field semantics
- indexing and query expectations
- invariants required for stable cross-dictionary search

Excluded:

- PDF parsing or OCR logic
- dictionary extraction tuning
- schema redesign without explicit migration plan

## Source Artifacts (Normative)

Use these files as the baseline for implementation in another repository:

- `docs/orfoepic_sqlite_migration.md`
- `scripts/build_orfoepic_sqlite.py`
- `scripts/build_orfoepic_index.py`
- `scripts/batch_lookup_sqlite.py`
- `artifacts/compound_markup/runtime_manifest.json`

## Runtime Database Location

- Primary runtime asset: `artifacts/runtime/lookup.sqlite`

## Schema

### `dictionaries`

- `id INTEGER PRIMARY KEY`
- `code TEXT NOT NULL UNIQUE` - stable dictionary code
- `title TEXT NOT NULL` - display title

### `entries`

- `id INTEGER PRIMARY KEY` - global entry id across all dictionaries
- `dictionary_id INTEGER NOT NULL`
- `source_pdf TEXT NOT NULL`
- `page_start INTEGER NOT NULL`
- `page_end INTEGER NOT NULL`
- `entry_text_clean TEXT NOT NULL`
- `warnings_json TEXT NOT NULL`

Constraint:

- `FOREIGN KEY(dictionary_id) REFERENCES dictionaries(id)`

### `headwords`

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `entry_id INTEGER NOT NULL`
- `dictionary_id INTEGER NOT NULL`
- `headword_display TEXT NOT NULL`
- `headword_norm TEXT NOT NULL`

Constraints:

- `FOREIGN KEY(entry_id) REFERENCES entries(id)`
- `FOREIGN KEY(dictionary_id) REFERENCES dictionaries(id)`

### `compound_components`

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `component_norm TEXT NOT NULL UNIQUE`
- `evidence_count INTEGER NOT NULL`
- `evidence_types_json TEXT NOT NULL`
- `source_dictionaries_json TEXT NOT NULL`

### `compound_markup`

- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `headword_norm TEXT NOT NULL`
- `component_id INTEGER NOT NULL`
- `remainder_norm TEXT NOT NULL`
- `confidence TEXT NOT NULL`
- `reason TEXT NOT NULL`
- `source_dictionaries_json TEXT NOT NULL`
- `component_evidence_count INTEGER NOT NULL`

Constraint:

- `FOREIGN KEY(component_id) REFERENCES compound_components(id)`

## Indexes

- `idx_entries_dictionary_id` on `entries(dictionary_id)`
- `idx_headwords_norm` on `headwords(headword_norm)`
- `idx_headwords_entry_id` on `headwords(entry_id)`
- `idx_headwords_dictionary_id` on `headwords(dictionary_id)`
- `idx_compound_components_norm` on `compound_components(component_norm)`
- `idx_compound_markup_headword_norm` on `compound_markup(headword_norm)`
- `idx_compound_markup_component_id` on `compound_markup(component_id)`

## Required Invariants

- `entries.id` is global, not per-dictionary.
- one input word may map to multiple rows across dictionaries.
- compound tables are additive metadata; they do not replace exact lookup.
- runtime logic must be compatible with current normalization contract.

## Runtime Role Separation

- Required in production:
  - `lookup.sqlite`
- Optional for QA/debug only:
  - expanded templates/reports/manifests in `artifacts/*`

