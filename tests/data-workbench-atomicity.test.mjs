import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("0010 keeps one active publication per hospital series and rejects a second", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE data_publish_versions (
    id TEXT PRIMARY KEY, hospital_id TEXT NOT NULL, series_id TEXT NOT NULL,
    version INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  db.exec(`INSERT INTO data_publish_versions(id,hospital_id,series_id,version,status) VALUES
    ('p1','h1','hospital-current-supply',1,'published'),
    ('p2','h1','hospital-current-supply',2,'published')`);
  const migration = await readFile(new URL("../drizzle/0010_publish_series_atomicity.sql", import.meta.url), "utf8");
  db.exec(migration.replaceAll("--> statement-breakpoint", ""));
  assert.equal(db.prepare("SELECT count(*) AS count FROM data_publish_versions WHERE status='published'").get().count, 1);
  assert.equal(db.prepare("SELECT id FROM data_publish_versions WHERE status='published'").get().id, "p2");
  assert.throws(() => db.exec("INSERT INTO data_publish_versions(id,hospital_id,series_id,version,status) VALUES ('p3','h1','hospital-current-supply',3,'published')"), /UNIQUE/);
  db.close();
});
