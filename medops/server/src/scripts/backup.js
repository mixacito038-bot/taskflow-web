'use strict';
/* 备份：VACUUM INTO DATA_DIR/backups/app-YYYYMMDD.db + tar 打包 files/，保留 30 天
   可独立运行：node src/scripts/backup.js */
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const KEEP_DAYS = 30;

function ymd() {
  const p = {};
  for (const it of new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date())) p[it.type] = it.value;
  return `${p.year}${p.month}${p.day}`;
}

function runBackup(dataDir) {
  const backups = path.join(dataDir, 'backups');
  fs.mkdirSync(backups, { recursive: true });
  const tag = ymd();

  // 1) 数据库：VACUUM INTO（独立打开，避免持有服务连接状态）
  const target = path.join(backups, `app-${tag}.db`);
  if (fs.existsSync(target)) fs.unlinkSync(target);
  const db = new Database(path.join(dataDir, 'app.db'));
  try { db.prepare('VACUUM INTO ?').run(target); } finally { db.close(); }

  // 2) 文件目录打包
  const filesDir = path.join(dataDir, 'files');
  if (fs.existsSync(filesDir)) {
    execFileSync('tar', ['czf', path.join(backups, `files-${tag}.tar.gz`), '-C', dataDir, 'files']);
  }

  // 3) 清理 30 天前
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  for (const f of fs.readdirSync(backups)) {
    const m = /^(?:app|files)-(\d{8})\./.exec(f);
    if (!m) continue;
    const t = Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T00:00:00Z`);
    if (t < cutoff) fs.unlinkSync(path.join(backups, f));
  }
  return { db: target };
}

if (require.main === module) {
  const cfg = require('../config');
  const out = runBackup(cfg.dataDir);
  console.log('备份完成:', out.db);
}

module.exports = { runBackup };
