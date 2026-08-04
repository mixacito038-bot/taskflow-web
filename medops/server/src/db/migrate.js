'use strict';
const path = require('path');
const fs = require('fs');

/* 按文件名序执行 migrations/*.sql，已执行的记入 schema_migrations 跳过 */
function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  const mark = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      mark.run(f, new Date().toISOString());
    })();
  }
}

module.exports = { migrate };
