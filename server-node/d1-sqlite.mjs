import { DatabaseSync } from "node:sqlite";

// D1 → 本地 SQLite 适配：与 Cloudflare D1 客户端接口对齐
// （prepare/bind/all/raw/first/run、batch、exec），供构建产物直接使用。
function d1Result(results, changes = 0, lastRowId = 0) {
  return {
    success: true,
    results,
    meta: {
      duration: 0,
      changes,
      last_row_id: lastRowId,
      rows_read: results.length,
      rows_written: changes,
      changed_db: changes > 0,
      size_after: 0,
    },
  };
}

class SqliteD1PreparedStatement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new SqliteD1PreparedStatement(this.database, this.sql, params);
  }

  async all() {
    const statement = this.database.prepare(this.sql);
    const results = statement.all(...this.params);
    return d1Result(results);
  }

  async raw() {
    const statement = this.database.prepare(this.sql);
    // 必须按位置取值：join 查询里会出现同名列（如两个 id），
    // 按列名取值会让后出现的列覆盖前一个，导致字段串位（曾把角色 id 当成医院 id）。
    if (typeof statement.setReturnArrays === "function") {
      statement.setReturnArrays(true);
      return statement.all(...this.params);
    }
    const results = statement.all(...this.params);
    const columns = statement.columns().map((column) => column.name);
    return results.map((row) => columns.map((column) => row[column]));
  }

  async first(column) {
    const { results } = await this.all();
    const first = results[0] ?? null;
    return column && first ? first[column] ?? null : first;
  }

  async run() {
    const statement = this.database.prepare(this.sql);
    const result = statement.run(...this.params);
    return d1Result([], Number(result.changes), Number(result.lastInsertRowid));
  }
}

export class SqliteD1Database {
  constructor(filePath) {
    this.database = new DatabaseSync(filePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.filePath = filePath;
  }

  prepare(sql) {
    return new SqliteD1PreparedStatement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql) {
    this.database.exec(sql);
    return { count: 1, duration: 0 };
  }
}
