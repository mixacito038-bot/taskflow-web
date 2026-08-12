import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../db/schema.ts";

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
  constructor(database) {
    this.database = database;
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

function bytesFrom(value) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  return new Uint8Array(value.slice(0));
}

export class FakeR2Bucket {
  #objects = new Map();

  async put(key, value, options = {}) {
    const bytes = bytesFrom(value);
    this.#objects.set(key, {
      bytes,
      customMetadata: { ...(options.customMetadata ?? {}) },
      httpMetadata: { ...(options.httpMetadata ?? {}) },
    });
    return { key, size: bytes.byteLength };
  }

  async get(key) {
    const stored = this.#objects.get(key);
    if (!stored) return null;
    const bytes = new Uint8Array(stored.bytes);
    return {
      body: new Blob([bytes]).stream(),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      customMetadata: { ...stored.customMetadata },
    };
  }

  async head(key) {
    const stored = this.#objects.get(key);
    return stored ? { key, size: stored.bytes.byteLength, customMetadata: { ...stored.customMetadata } } : null;
  }

  async delete(key) {
    this.#objects.delete(key);
  }

  tamper(key, value) {
    const stored = this.#objects.get(key);
    if (!stored) throw new Error(`missing fake R2 object: ${key}`);
    stored.bytes = bytesFrom(value);
  }

  has(key) {
    return this.#objects.has(key);
  }
}

export async function createMigratedTestDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  const migrationsDirectory = new URL("../../drizzle/", import.meta.url);
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const migrationFile of migrationFiles) {
    const migration = await readFile(new URL(migrationFile, migrationsDirectory), "utf8");
    sqlite.exec(migration.replaceAll("--> statement-breakpoint", ""));
  }
  const d1 = new SqliteD1Database(sqlite);
  return { sqlite, d1, db: drizzle(d1, { schema }) };
}
