import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { DictionarySqlite } from "./sqliteDictionary";

let sqlModule: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;

function loadSqlJs() {
  if (!sqlModule) {
    sqlModule = initSqlJs({
      locateFile: (file: string) => (file.endsWith(".wasm") ? wasmUrl : wasmUrl),
    });
  }
  return sqlModule;
}

export async function createDictionaryFromBuffer(data: ArrayBuffer | Uint8Array): Promise<DictionarySqlite> {
  const SQL = await loadSqlJs();
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const db = new SQL.Database(u8);
  return new DictionarySqlite(db);
}

export type { DictionarySqlite, CyrillicSqliteLookup } from "./sqliteDictionary";
