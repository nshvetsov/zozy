import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

export interface LookupManifest {
  version: string;
  size: number;
  sha256?: string;
  updatedAt?: string;
  file?: string;
}

export interface LookupProgress {
  phase: "manifest" | "download" | "load" | "ready";
  loaded?: number;
  total?: number;
  message?: string;
}

const CACHE_NAME = "lookup-sqlite-cache-v1";
const VERSION_KEY = "lookup_sqlite_version";

let sqlRuntimePromise: Promise<SqlJsStatic> | null = null;
let dbPromise: Promise<Database> | null = null;
let activeDbVersion = "";

function baseUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
}

async function getSqlRuntime(): Promise<SqlJsStatic> {
  if (!sqlRuntimePromise) {
    sqlRuntimePromise = initSqlJs({
      locateFile: () => wasmUrl,
    });
  }
  return sqlRuntimePromise;
}

async function fetchManifest(): Promise<LookupManifest> {
  const response = await fetch(baseUrl("data/lookup.manifest.json"), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`LOOKUP_MANIFEST_FETCH_FAILED:${response.status}`);
  }
  return (await response.json()) as LookupManifest;
}

async function readWithProgress(
  response: Response,
  onProgress?: (progress: LookupProgress) => void,
): Promise<Uint8Array> {
  const total = Number(response.headers.get("content-length") || 0);
  if (!response.body) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.length;
      onProgress?.({ phase: "download", loaded, total, message: "Загрузка словарной базы..." });
    }
  }
  const result = new Uint8Array(loaded);
  let offset = 0;
  chunks.forEach((chunk) => {
    result.set(chunk, offset);
    offset += chunk.length;
  });
  return result;
}

async function fetchAndCacheDb(
  version: string,
  onProgress?: (progress: LookupProgress) => void,
): Promise<Uint8Array> {
  const dbUrl = baseUrl(`data/lookup.sqlite?v=${encodeURIComponent(version)}`);
  const response = await fetch(dbUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`LOOKUP_DB_FETCH_FAILED:${response.status}`);
  }
  const bytes = await readWithProgress(response, onProgress);
  const cache = await caches.open(CACHE_NAME);
  const cacheBytes = new Uint8Array(bytes.length);
  cacheBytes.set(bytes);
  await cache.put(dbUrl, new Response(new Blob([cacheBytes])));
  return bytes;
}

async function readCachedDb(version: string): Promise<Uint8Array | null> {
  const dbUrl = baseUrl(`data/lookup.sqlite?v=${encodeURIComponent(version)}`);
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(dbUrl);
  if (!cached) return null;
  return new Uint8Array(await cached.arrayBuffer());
}

async function loadDbBytes(
  manifest: LookupManifest,
  forceRefresh = false,
  onProgress?: (progress: LookupProgress) => void,
): Promise<Uint8Array> {
  const storedVersion = localStorage.getItem(VERSION_KEY);
  if (!forceRefresh && storedVersion === manifest.version) {
    const cached = await readCachedDb(manifest.version);
    if (cached) return cached;
  }
  const bytes = await fetchAndCacheDb(manifest.version, onProgress);
  localStorage.setItem(VERSION_KEY, manifest.version);
  return bytes;
}

export async function ensureLookupDb(options?: {
  forceRefresh?: boolean;
  onProgress?: (progress: LookupProgress) => void;
}): Promise<{ db: Database; manifest: LookupManifest; versionChanged: boolean }> {
  const forceRefresh = options?.forceRefresh ?? false;
  const onProgress = options?.onProgress;
  onProgress?.({ phase: "manifest", message: "Проверка версии словарной базы..." });
  const manifest = await fetchManifest();
  const versionChanged = manifest.version !== activeDbVersion;
  if (!dbPromise || forceRefresh || versionChanged) {
    dbPromise = (async () => {
      const sql = await getSqlRuntime();
      onProgress?.({ phase: "load", message: "Подготовка словарной базы..." });
      const bytes = await loadDbBytes(manifest, forceRefresh, onProgress);
      const db = new sql.Database(bytes);
      activeDbVersion = manifest.version;
      onProgress?.({ phase: "ready", message: "Словарная база готова." });
      return db;
    })();
  }
  const db = await dbPromise;
  return { db, manifest, versionChanged };
}

export function getLookupDbVersion(): string {
  return activeDbVersion;
}
