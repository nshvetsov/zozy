declare module "sql.js" {
  export interface BindParams {
    [key: string]: string | number | Uint8Array | null;
  }

  export interface Statement {
    bind(values?: unknown[] | BindParams): boolean;
    step(): boolean;
    get(): SqlValue[];
    getColumnNames(): string[];
    free(): boolean;
    reset(): void;
  }

  export type SqlValue = string | number | Uint8Array | null;

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: unknown[] | BindParams): Database;
    exec(sql: string, params?: unknown[] | BindParams): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  export interface QueryExecResult {
    columns: string[];
    values: SqlValue[][];
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  function initSqlJs(moduleConfig?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
  export default initSqlJs;
}
