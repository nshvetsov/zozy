declare module "snowball-stemmers" {
  interface Stemmer {
    stem(word: string): string;
  }

  interface SnowballFactory {
    newStemmer(language: string): Stemmer;
    algorithms(): string[];
  }

  const snowballFactory: SnowballFactory;
  export default snowballFactory;
}
