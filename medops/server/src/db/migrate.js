'use strict';
const path = require('path');
const fs = require('fs');

/* 按文件名序执行 migrations/*.sql，已执行的记入 schema_migrations 跳过。每个文件一个事务。

   第一行写了「-- migrate: foreign_keys=off」的迁移（重建表用，见 007）：
   外键检查只能在事务外开关，所以先关掉；事务里执行完，做一次外键检查——
   出现了执行前没有的外键问题就整个回滚；最后恢复原来的设置（出错也恢复）。 */
function migrate(db, dir = path.join(__dirname, 'migrations')) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  const mark = db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)');
  const fkProblems = () => db.pragma('foreign_key_check').map(r => JSON.stringify(r));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const fkOff = /^--\s*migrate:\s*foreign_keys\s*=\s*off\b/.test(sql);
    const fkWasOn = fkOff && db.pragma('foreign_keys', { simple: true }) === 1;
    if (fkOff) db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        const before = fkOff ? new Set(fkProblems()) : null;
        db.exec(sql);
        if (fkOff) {
          const added = fkProblems().filter(r => !before.has(r));
          if (added.length) throw new Error(`迁移 ${f} 执行后外键检查不通过（${added.length} 处，如 ${added[0]}），已整体回滚`);
        }
        mark.run(f, new Date().toISOString());
      })();
    } finally {
      if (fkWasOn) db.pragma('foreign_keys = ON');
    }
  }
}

module.exports = { migrate };
