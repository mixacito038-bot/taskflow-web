'use strict';
/* 资产盘点数据还原（只动资产盘点系统的数据，巡检数据不动）。
   给服务器上用：bash /opt/medops/deploy/tencent/manage.sh ams-restore
     → 列出最近的改动、标出最像误操作的那次 → 输入编号 → 看还原前后各有多少条 → 输入 yes
     → 自动先做一份完整备份 → 还原。
   直接运行：
     node src/scripts/ams-restore.js                 列出最近的改动（只读）
     node src/scripts/ams-restore.js --suggest       只输出最像误操作的那次的编号（没有则输出空）
     node src/scripts/ams-restore.js --show N        还原到第 N 次改动之前会是什么样（只读）
     node src/scripts/ams-restore.js --to N --yes    真正还原
     加 --keep-later：这次之后的改动保留（覆盖前的找回来，覆盖之后新加、新改的照样留着）
     node src/scripts/ams-restore.js --count-later N  第 N 次之后还有几次改动
   编号从新到旧：1 = 最近一次。 */
const cfg = require('../config');
const { initDb } = require('../db/connection');
const R = require('../services/ams-restore.service');

initDb(cfg.dataDir);
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const sh = iso => new Date(Date.parse(iso) + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' '); // 北京时间
const num = c => (c == null ? '?' : String(c));

const evs = R.listEvents();
const toIdx = n => evs.length - n;            // 编号（1 = 最近）→ 下标
const toNo = i => evs.length - i;
const sus = R.suspectIndex(evs);

if (args.includes('--suggest')) {
  console.log(sus >= 0 ? String(toNo(sus)) : '');
  process.exit(0);
}

/* 一次改动的样子：哪台电脑、改了哪几份、主要几份数据前后各多少条 */
function describe(e) {
  const names = [...new Set(e.keys.map(R.labelOf))];
  const what = e.keys.length >= 4 ? `一次改了 ${e.keys.length} 份（${names.slice(0, 4).join('、')}…）` : names.join('、');
  const counts = R.SUMMARY_KEYS.filter(k => e.keys.includes(k)).map(k => {
    const b = R.countOf((e.before.get(k) || {}).value), a = R.countOf((e.after.get(k) || {}).value);
    return `${R.labelOf(k)} ${num(b)} → ${num(a)}`;
  }).join('、');
  const who = R.isRestore(e.dev) ? '（服务器上的还原操作）' : `电脑 ${String(e.dev || '?').slice(0, 8)}${e.user ? ' · 账号 ' + e.user : ''}`;
  return { what, counts, who };
}

const keepLater = args.includes('--keep-later');
const showN = opt('--show'), toN = opt('--to'), laterN = opt('--count-later');
if (showN == null && toN == null && laterN == null) {
  if (!evs.length) { console.log('服务器上还没有资产盘点数据的改动记录。'); process.exit(0); }
  console.log('资产盘点数据最近的改动（新的在前；到这里还没有改动任何数据）：\n');
  // 全部列出（最多 60 条）；标出来的那次一定列出来
  const shown = Math.max(Math.min(evs.length, 60), sus >= 0 ? toNo(sus) : 0);
  for (let k = 1; k <= shown; k++) {
    const i = toIdx(k), e = evs[i], d = describe(e);
    console.log(`  [${k}] ${sh(e.start)}  ${d.who}${i === sus ? '    ← 最像误操作的就是这次' : ''}`);
    console.log(`       ${d.what}${d.counts ? '；' + d.counts : ''}`);
  }
  if (evs.length > shown) console.log(`  ……更早的还有 ${evs.length - shown} 次`);
  console.log('\n说明：每份数据服务器只保留最近 20 个版本；「→」前后是那次改动前、后各有多少条。');
  process.exit(0);
}

const raw = showN != null ? showN : toN != null ? toN : laterN;
const n = Number(raw);
if (!Number.isInteger(n) || n < 1 || n > evs.length) { console.log(`✗ 编号「${raw}」不对，应在 1～${evs.length} 之间。`); process.exit(2); }
const idx = toIdx(n);
if (laterN != null) { console.log(String(evs.length - 1 - idx)); process.exit(0); }

const ST = { recovered: '找回', keptNew: '保留之后新加的', keptChanged: '保留之后改过的', dropped: '去掉覆盖时带进来、之后没人动过的', deletedLater: '之后删掉的照删' };
function printPlan(p) {
  const e = p.event, d = describe(e);
  console.log(`还原到第 ${n} 次改动之前（${sh(e.start)} 之前；那次是 ${d.who}，${d.what}${d.counts ? '；' + d.counts : ''}）` +
    (p.keepLater ? `，保留这次之后的 ${p.later} 次改动` : '') + '：\n');
  for (const s of p.summary) {
    if (!s.now && !s.restored) continue;
    console.log(`  ${s.label.padEnd(5, '　')}  现在 ${num(s.now).padStart(5)} 条  →  还原后 ${num(s.restored).padStart(5)} 条`);
  }
  if (p.keepLater) {
    const lines = R.SUMMARY_KEYS.filter(k => p.stats[k]).map(k => {
      const st = p.stats[k];
      const parts = Object.keys(ST).filter(x => st[x]).map(x => `${ST[x]} ${st[x]} 条`);
      return parts.length ? `  ${R.labelOf(k)}：${parts.join('，')}` : '';
    }).filter(Boolean);
    if (lines.length) console.log('\n' + lines.join('\n'));
    if (p.newDups.length) console.log(`\n  ⚠ 还原后有 ${p.newDups.length} 个资产编号重复（多半是覆盖之后又录了一遍）：${p.newDups.slice(0, 10).join('、')}${p.newDups.length > 10 ? ' 等' : ''}\n    还原后在资产盘点「数据健康」里能看到，删掉多余的那条即可。`);
  } else if (p.later) {
    console.log(`\n  ⚠ 这次之后还有 ${p.later} 次改动，会一起撤销。`);
  }
  if (p.unknown.length) console.log(`  ⚠ ${p.unknown.map(R.labelOf).join('、')}：那个时间以前的版本已超出 20 版历史，保持现在的样子不动。`);
  if (p.filesDeleted) console.log(`  ⚠ 这次之后有 ${p.filesDeleted} 个附件被删除，附件不在版本历史里，需要从整机备份找回（这里不处理）。`);
  if (!p.changes.length) console.log('\n  数据已经是那时的样子，不需要还原。');
}

if (showN != null) {
  printPlan(R.plan(idx, undefined, { keepLater }));
  process.exit(0);
}
if (!args.includes('--yes')) { console.log('真正还原要加 --yes'); process.exit(2); }
try {
  const r = R.apply(idx, undefined, { keepLater });
  printPlan(r);
  if (r.written) {
    console.log(`\n✓ 已还原 ${r.written} 份数据。`);
    console.log('  打开着的资产盘点页面 30 秒内会自动刷新成还原后的数据；关着的下次打开即可。');
    console.log('  如果哪台电脑弹出「数据不一致」，选「使用云端数据」。');
  }
} catch (e) {
  console.log(`✗ ${e.message}`);
  process.exit(1);
}
