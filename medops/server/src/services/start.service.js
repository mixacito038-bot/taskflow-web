'use strict';
/* 「应巡」从哪天算起。
   - 巡检起算日（系统设置 inspect_start）：设备科在后台设一次，例如设备早就录进去了、真正开始巡检是 11 月 23 日，
     这天以前的不再提醒、不算缺签。空 = 不限。
   - 科室起算日：建科室那天；导入过更早的历史记录的，从最早一条记录算起。
   两者取晚的那个，就是这个科室的起算日（/api/depts 的 startDate，手机端、后台、统计、月签判定都用它）。 */
const { getDb } = require('../db/connection');
const P = require('./period.service');

function getSetting(key) {
  try {
    const r = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return r && r.value ? r.value : null;
  } catch (e) {
    // 还没执行迁移 009 的库（例如在新后端启动前单独跑体检脚本）：当作没设置
    if (/no such table/.test(e.message)) return null;
    throw e;
  }
}
function setSetting(key, value, userId) {
  getDb().prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
    .run(key, value || null, new Date().toISOString(), userId ?? null);
}

/* 巡检起算日（YYYY-MM-DD，周一）或 null */
function inspectStart() {
  const v = getSetting('inspect_start');
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/* 校验要设的起算日：空串 = 清除；否则必须是真实日期、周一、不晚于本周周一 */
function checkInspectStart(v) {
  const s = String(v ?? '').trim();
  if (!s) return { ok: true, value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || P.fmt(P.D(s)) !== s) return { ok: false, message: '日期格式应为 YYYY-MM-DD，且是真实存在的日期' };
  if (P.wkOf(s) !== s) return { ok: false, message: `起算日要选周一（周签按周一到周日算）；${s} 所在周的周一是 ${P.wkOf(s)}` };
  if (s > P.wkOf(P.today())) return { ok: false, message: '起算日不能晚于本周周一' };
  if (s < '2000-01-01') return { ok: false, message: '起算日太早了，请检查年份' };
  return { ok: true, value: s };
}

/* 科室自己的起算日：建科室那天；导入过更早的历史记录的，从最早一条记录算起。
   旧版不看起点：今天新建的科室，首页立刻多出「前 7 天未日签」7 条提醒。 */
function ownStart(d) {
  const first = getDb().prepare('SELECT MIN(date) AS d FROM records WHERE dept_id = ?').get(d.id).d;
  const created = P.shDateOf(d.created_at);
  return first && first < created ? first : created;
}
/* 这个科室实际的起算日 = 科室起算日、巡检起算日取晚的 */
function deptStart(d, g = inspectStart()) {
  const own = ownStart(d);
  return g && g > own ? g : own;
}

module.exports = { getSetting, setSetting, inspectStart, checkInspectStart, ownStart, deptStart };
