'use strict';
/* 清空巡检数据，只保留原始管理员账号 admin（账号、密码、它的登录状态都不动）。
   给服务器上用：bash /opt/medops/deploy/tencent/manage.sh reset-data
     → 先列出会清空什么 → 输入 yes 确认 → 自动先做一份完整备份 → 再清空。
   直接运行本脚本：不带参数只列出（只读）；带 --yes 才真正清空。

   清空：科室、设备、签字人名单、admin 以外的全部账号、日巡检记录、周签、月签、签名图、操作日志、登录限流记录。
   不动：admin 账号；资产盘点系统（/pandian/）的数据；数据库结构；每日自动备份（data/backups）。
   ⚠ 不重置编号计数器：清空后新建的科室、设备、记录编号接着往后排，不会和清空前的重复——
     手机上残留的旧草稿、旧缓存对不上任何新科室，不会把旧数据串进来。 */
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const { initDb } = require('../db/connection');

const KEEP = 'admin';
const yes = process.argv.includes('--yes');
const db = initDb(cfg.dataDir);

/* 先确认 admin 能用：清空后只剩它，它要是不存在 / 被停用 / 不是超级管理员，就谁都进不了后台了 */
const admin = db.prepare('SELECT id, role, status, display_name FROM users WHERE username = ?').get(KEEP);
if (!admin || admin.role !== 'admin' || admin.status !== 'on') {
  console.log(!admin ? '✗ 找不到原始管理员账号 admin。'
    : `✗ admin 账号现在${admin.status !== 'on' ? '被停用了' : '不是超级管理员'}。`);
  console.log('  清空后只剩这一个账号，为免谁都登录不了，本次没有改动任何数据。');
  console.log('  请先执行「bash manage.sh reset-admin」，账号名填 admin、设好密码，再来清空。');
  process.exit(2);
}

const count = sql => db.prepare(sql).get().c;
const plan = [
  ['科室', count('SELECT COUNT(*) AS c FROM depts')],
  ['设备', count('SELECT COUNT(*) AS c FROM devices')],
  ['签字人名单', count('SELECT COUNT(*) AS c FROM members')],
  ['其他账号', db.prepare('SELECT COUNT(*) AS c FROM users WHERE username <> ?').get(KEEP).c],
  ['日巡检记录', count('SELECT COUNT(*) AS c FROM records')],
  ['周签', count('SELECT COUNT(*) AS c FROM week_signs')],
  ['月签', count('SELECT COUNT(*) AS c FROM month_signs')],
  ['签名图', count('SELECT COUNT(*) AS c FROM files')],
  ['操作日志', count('SELECT COUNT(*) AS c FROM audit_log')]
];

console.log(yes ? '正在清空以下数据：' : '将清空以下数据：');
for (const [k, n] of plan) console.log(`  ${k.padEnd(10, '　')} ${n}`);
console.log('保留：admin 账号（密码不变）；资产盘点系统的数据；每日自动备份');
if (!yes) {
  console.log('\n（到这里还没有改动任何数据）');
  process.exit(0);
}

// 签名图的文件路径先记下来：数据库清空成功后再删文件；数据库那步失败的话文件一个不动
const files = db.prepare('SELECT rel_path FROM files').all().map(f => f.rel_path);
db.transaction(() => {
  // 顺序按外键依赖：先删引用别人的
  db.exec(`DELETE FROM record_items; DELETE FROM records; DELETE FROM week_signs; DELETE FROM month_signs;
    DELETE FROM members; DELETE FROM devices; DELETE FROM user_depts; DELETE FROM depts;`);
  // 账号删了，它的登录令牌、登录过的设备记录随外键一起删掉（ON DELETE CASCADE）
  db.prepare('DELETE FROM users WHERE username <> ?').run(KEEP);
  db.exec('DELETE FROM files; DELETE FROM auth_throttle; DELETE FROM audit_log;');
  // 只留一条：谁、什么时候、清空了多少
  const detail = plan.map(([k, n]) => `${k}=${n}`).join(' ');
  // 数据库升级过（有操作日志的新列）就把模块、说明一起写上，操作日志页上看得懂；老库照旧只写基本列
  if (db.prepare("SELECT 1 FROM pragma_table_info('audit_log') WHERE name = 'module'").get()) {
    db.prepare(`INSERT INTO audit_log (user_id, action, detail, ip, created_at, username, user_name, user_role, module, op, target, summary, result)
      VALUES (?, 'data_reset', ?, 'manage.sh', ?, ?, ?, ?, '系统', '清空数据', '全部巡检数据', ?, 'ok')`)
      .run(admin.id, detail, new Date().toISOString(), KEEP, admin.display_name || KEEP, admin.role,
        `在服务器上执行 manage.sh reset-data 清空数据，只保留 ${KEEP}。清空前：${plan.map(([k, n]) => `${k} ${n}`).join('、')}`);
  } else {
    db.prepare(`INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?, 'data_reset', ?, 'manage.sh', ?)`)
      .run(admin.id, detail, new Date().toISOString());
  }
})();

let removed = 0;
const filesDir = path.join(cfg.dataDir, 'files');
for (const rel of files) {
  try { fs.unlinkSync(path.join(filesDir, rel)); removed++; } catch { /* 文件本来就不在 */ }
}
// 签名图目录整个清掉（资产盘点的附件在 files/ams，不动）
fs.rmSync(path.join(filesDir, 'signatures'), { recursive: true, force: true });

console.log(`\n✓ 清空完成（签名图文件删除 ${removed} 个）。现在只剩 admin 账号。`);
