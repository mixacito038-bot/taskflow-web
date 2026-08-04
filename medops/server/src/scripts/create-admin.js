'use strict';
/* 创建/重置超管账号
   用法：node src/scripts/create-admin.js [username] [password]
   不带参数时交互式询问；DATA_DIR 与服务保持一致 */
const readline = require('readline');
const bcrypt = require('bcryptjs');
const cfg = require('../config');
const { initDb } = require('../db/connection');
const { migrate } = require('../db/migrate');

function ask(q, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, ans => { rl.close(); resolve(ans.trim()); });
    if (hidden && rl.output) rl._writeToOutput = () => {};
  });
}

async function main() {
  const db = initDb(cfg.dataDir);
  migrate(db);
  let [, , username, password] = process.argv;
  if (!username) username = await ask('管理员账号: ');
  if (!password) password = await ask('管理员密码: ', true);
  if (!username || !password || password.length < 6) {
    console.error('账号必填，密码至少 6 位');
    process.exit(1);
  }
  const now = new Date().toISOString();
  const hash = bcrypt.hashSync(password, 10);
  const old = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (old) {
    db.prepare(`UPDATE users SET password_hash = ?, role = 'admin', status = 'on',
      fail_count = 0, freeze_level = 0, frozen_until = NULL, updated_at = ? WHERE id = ?`)
      .run(hash, now, old.id);
    console.log(`已重置管理员 ${username} (id=${old.id})`);
  } else {
    const id = db.prepare(`INSERT INTO users (username, password_hash, display_name, role, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', ?, ?)`).run(username, hash, '系统管理员', now, now).lastInsertRowid;
    console.log(`已创建管理员 ${username} (id=${id})`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
