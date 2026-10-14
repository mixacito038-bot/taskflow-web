'use strict';
/* 数据体检：找出不符合规则的存量数据（多半是旧版本留下的）。只读，不改任何数据。
   用法（服务器上）：cd /opt/medops/deploy/tencent && bash manage.sh 体检
   ① 签字：周签要求那一周 7 天都已日签；月签要求周一在该月的各周都已周签。
      发现问题后，在管理后台「周签 / 月签」里按「先作废月签、再作废周签」的顺序作废，再按正常流程补签。
   ② 设备：状态必须是 在用 / 维修中 / 已停用 / 已报废 之一。别的值（旧数据导入留下的）
      手机端巡检清单不显示、有效期不提醒；升级时常见写法（如 active）已自动改好，剩下的要人工选。 */
const cfg = require('../config');
const { initDb } = require('../db/connection');
const P = require('../services/period.service');

const db = initDb(cfg.dataDir);
const name = id => (db.prepare('SELECT name FROM depts WHERE id = ?').get(id) || {}).name || `科室#${id}`;
const short = d => d.slice(5);
let n = 0;

for (const w of db.prepare('SELECT * FROM week_signs ORDER BY week_start, dept_id').all()) {
  const days = P.wkDays(w.week_start);
  const signed = new Set(db.prepare(`SELECT date FROM records WHERE dept_id = ? AND date >= ? AND date <= ?
    AND sign_at IS NOT NULL`).all(w.dept_id, days[0], days[6]).map(r => r.date));
  const miss = days.filter(d => !signed.has(d));
  if (!miss.length) continue;
  n++;
  console.log(`✗ 周签 · ${name(w.dept_id)} · ${w.week_start} 起的一周（${w.sign_name}，${w.sign_at} 签）`);
  console.log(`    这一周有 ${miss.length} 天没有日签：${miss.map(short).join('、')}`);
}

for (const m of db.prepare('SELECT * FROM month_signs ORDER BY month, dept_id').all()) {
  const signed = new Set(db.prepare('SELECT week_start FROM week_signs WHERE dept_id = ?').all(m.dept_id).map(r => r.week_start));
  const miss = P.wksOfMonth(m.month).filter(w => !signed.has(w));
  if (!miss.length) continue;
  n++;
  console.log(`✗ 月签 · ${name(m.dept_id)} · ${m.month}（${m.sign_name}，${m.sign_at} 签）`);
  console.log(`    这个月有 ${miss.length} 周没有周签：${miss.map(w => short(w) + ' 起').join('、')}`);
}

/* 周签签字人没关联上签字人名单：多半是升级前在名单里改过名（旧版改名不同步），
   这些周签会一直显示签字当时的旧名字。不是错误，只提示怎么关联。 */
const orphan = db.prepare(`SELECT w.dept_id, w.sign_name, COUNT(*) AS c, MIN(w.week_start) AS first
  FROM week_signs w LEFT JOIN members m ON m.id = w.sign_member_id
  WHERE m.id IS NULL GROUP BY w.dept_id, w.sign_name ORDER BY w.dept_id`).all();
if (orphan.length) {
  console.log('\nℹ 下面这些周签的签字人没有关联到「签字人名单」，会一直显示签字当时的名字：');
  for (const o of orphan) console.log(`    ${name(o.dept_id)} · 签字人「${o.sign_name}」· ${o.c} 次周签（最早 ${o.first} 起）`);
  console.log('  如果这个人还在名单里、只是升级前改过名：在后台「签字人名单」里先把名字改回上面这个、保存，');
  console.log('  再改成现在的名字、保存，历史周签就会关联上并显示新名字。人已经删掉的不用管。');
}

/* 设备状态：只认四个值，别的值手机端不列出、有效期不提醒（以前后台还把 on 显示成「在用」，看不出问题） */
const badDev = db.prepare(`SELECT dept_id, code, name, status FROM devices
  WHERE status NOT IN ('in_use', 'repair', 'retired', 'scrapped') ORDER BY dept_id, code`).all();
if (badDev.length) {
  console.log(`✗ 设备状态无效 · ${badDev.length} 台：手机端巡检清单里没有它们，有效期也不会提醒`);
  for (const v of badDev) console.log(`    ${name(v.dept_id)} · ${v.code} ${v.name} · 状态「${v.status}」`);
}
const uncat = db.prepare("SELECT COUNT(*) AS c FROM devices WHERE cat_name = '未分类'").get().c;
if (uncat) {
  console.log(`\nℹ 有 ${uncat} 台设备的品类是「未分类」（旧数据没有品类，升级时自动补上的）。`);
  console.log('  手机端按品类分组显示，可在后台「设备台账」里点「编辑」改成实际品类（如：除颤仪、心电监护仪）。');
}

if (!n && !badDev.length) {
  console.log('\n✓ 所有周签、月签都符合规则；设备状态都正常');
}
if (n) {
  console.log(`\n签字共 ${n} 处。处理办法：管理员登录后台 →「周签 / 月签」，找到上面这些点「作废」`);
  console.log('（有月签的先作废月签，再作废周签），原因写「升级前规则漏洞导致的提前签字」，然后按正常流程补签。');
  console.log('提前签的周签不作废的话，这一周后面几天的巡检会因为「已周签锁定」录不进去。');
}
if (badDev.length) {
  console.log(`\n设备状态共 ${badDev.length} 台。处理办法：后台「设备台账」里这些设备的状态标着红色「状态无效」，`);
  console.log('点「编辑」，在「状态」里选 在用 / 维修中 / 已停用 / 已报废，保存即可。');
}
