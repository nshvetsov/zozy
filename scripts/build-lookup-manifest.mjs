import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dbPath = resolve("data", "lookup.sqlite");
const manifestPath = resolve("data", "lookup.manifest.json");

async function sha256File(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectHash);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

async function build() {
  if (!existsSync(dbPath)) {
    throw new Error(`lookup.sqlite not found: ${dbPath}`);
  }
  const stat = statSync(dbPath);
  const sha256 = await sha256File(dbPath);
  const version = `${stat.mtimeMs}-${stat.size}-${sha256.slice(0, 12)}`;
  const manifest = {
    version,
    size: stat.size,
    sha256,
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    file: "lookup.sqlite",
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`Built lookup manifest: ${manifestPath}`);
}

void build();
