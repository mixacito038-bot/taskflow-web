'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let db = null;

/* 打开 DATA_DIR/app.db（WAL），进程内单例 */
function initDb(dataDir) {
  if (db) return db;
  fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, 'app.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function getDb() {
  if (!db) throw new Error('db 未初始化：先调用 initDb(dataDir)');
  return db;
}

module.exports = { initDb, getDb };
