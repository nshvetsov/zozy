# Word Verification Contract

## Purpose

Define how to verify a user-provided word list against runtime SQLite data.

## Input

- One word or a list of words from UI/API.

## Processing Pipeline

1. Normalize each input word (strictly by `normalization-contract.md`).
2. Run exact lookup on `headwords.headword_norm`.
3. Optionally run compound metadata lookup:
   - `compound_markup.headword_norm`
   - join to `compound_components` by `component_id`
4. Build a classification per input word.

## Classification Model

Every input word must receive one of:

- `exact_match` - there is at least one exact row in `headwords`.
- `compound_related_match` - no exact hit, but compound evidence exists.
- `no_match` - neither exact nor compound evidence found.

If exact hit exists, classification must remain `exact_match` even when compound
evidence also exists.

## Response Shape (Recommended)

Per input word:

- `input_word`
- `normalized_word`
- `status` (`exact_match` | `compound_related_match` | `no_match`)
- `matches[]` for exact hits
- `compound_matches[]` for compound evidence (optional)

Each compound match should include:

- `component_norm`
- `remainder_norm`
- `confidence`
- `reason`
- `source_dictionaries` (if available from stored JSON fields)

## Verification Guarantees

- deterministic results for same input and same DB file
- normalization parity with build pipeline
- no downgrade from `exact_match` to compound-only status
- no hiding of multi-dictionary exact matches

## Typical Uses

- spell list verification
- editorial quality checks
- word presence checks before publishing or moderation rules

