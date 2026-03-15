import snowballFactory from "snowball-stemmers";

const russianStemmer = snowballFactory.newStemmer("russian");

export function russianStem(word: string): string {
  return russianStemmer.stem(word.toLowerCase());
}
