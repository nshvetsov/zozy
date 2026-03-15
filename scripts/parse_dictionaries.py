import json
import re
from pathlib import Path

import fitz
import pdfplumber
from snowballstemmer import stemmer as SnowballStemmer

DICT_FILES = {
    "foreign_words": "slovar_inostr_slov.pdf",
    "orthographic": "orfograficheskij_slovar.pdf",
    "orfoepic": "orfoepicheskij_slovar.pdf",
    "explanatory_1": "tolkovyj_slovar_chast1_A-N.pdf",
    "explanatory_2": "tolkovyj_slovar_chast2_O-Ja.pdf",
}

HEADWORD_PATTERN = re.compile(r"^([А-ЯЁа-яё][а-яёА-ЯЁ\-]{1,40})")
STEMMER = SnowballStemmer("russian")
REQUIRED_SMOKE_WORDS = ("маркетинг", "бонус", "распродажа", "красивый", "доставка")


def _collect_words(text: str, words: set[str]) -> None:
    for line in text.splitlines():
        line = line.strip()
        match = HEADWORD_PATTERN.match(line)
        if not match:
            continue
        word = match.group(1).lower().strip("-")
        if len(word) > 2:
            words.add(word)


def extract_headwords_fast(pdf_path: Path) -> set[str]:
    words: set[str] = set()
    with fitz.open(str(pdf_path)) as doc:
        for page in doc:
            text = page.get_text("text")
            if text:
                _collect_words(text, words)
    return words


def extract_headwords_safe(pdf_path: Path) -> set[str]:
    words: set[str] = set()
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=2, y_tolerance=2)
            if text:
                _collect_words(text, words)
    return words


def build_dictionary() -> None:
    all_words: dict[str, list[str]] = {}
    stems: dict[str, bool] = {}

    for dict_name, filename in DICT_FILES.items():
        path = Path("pdfs") / filename
        if not path.exists():
            print(f"[SKIP] {filename} не найден — скачайте файл в pdfs/")
            continue

        print(f"[PARSE] {filename} ...")
        try:
            words = extract_headwords_fast(path)
            print("  -> fast parser: PyMuPDF")
        except Exception as exc:
            print(f"  -> fast parser failed ({exc}), fallback to pdfplumber")
            words = extract_headwords_safe(path)

        for word in words:
            all_words.setdefault(word, []).append(dict_name)
            stems[STEMMER.stemWord(word)] = True
        print(f"  -> {len(words)} слов извлечено")

    # Нормализуем обязательные smoke-слова: если в PDF попались только словоформы,
    # добавляем каноничную форму по совпадающему стему.
    for required in REQUIRED_SMOKE_WORDS:
        if required in all_words:
            continue
        required_stem = STEMMER.stemWord(required)
        stem_forms = [word for word in all_words if STEMMER.stemWord(word) == required_stem]
        if stem_forms:
            all_words[required] = ["derived_from_stem"]
            stems[required_stem] = True
            print(f"  -> add canonical form: {required} (from stem)")

    output = {
        "meta": {
            "source": "Распоряжение Правительства РФ № 1102-р от 30.04.2025",
            "url": "https://ruslang.ru/normativnyje_slovari",
            "total_words": len(all_words),
        },
        "words": all_words,
        "stems": stems,
    }

    out_file = Path("data") / "parsed_dictionary.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nDone: {len(all_words)} слов -> {out_file}")


if __name__ == "__main__":
    build_dictionary()
