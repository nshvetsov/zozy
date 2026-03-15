import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const src = resolve(root, "data");
const dest = resolve(root, "dist", "data");

if (!existsSync(src)) {
  console.error("Data directory not found:", src);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("Copied data to dist/data");
