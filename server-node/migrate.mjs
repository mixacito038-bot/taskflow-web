import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// 顺序应用 drizzle/*.sql 前向迁移，带追踪表、可重复执行。
// `--> statement-breakpoint` 以 `--` 开头，是合法 SQL 行注释，无需剥离。
export function applyMigrations(database, migrationsDir) {
  database.exec(`CREATE TABLE IF NOT EXISTS node_deploy_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied = new Set(
    database.prepare("SELECT name FROM node_deploy_migrations").all().map((row) => row.name),
  );
  const files = readdirSync(migrationsDir)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const executed = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), "utf8");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(sql);
      database.prepare("INSERT INTO node_deploy_migrations (name) VALUES (?)").run(file);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`迁移 ${file} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
    executed.push(file);
  }
  return { executed, total: files.length };
}
