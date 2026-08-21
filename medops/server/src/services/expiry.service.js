'use strict';
/* =========================================================================
   设备有效期提醒
   场景：除颤电极片、急救药品、氧气瓶等有保质期。急救设备最怕的不是坏，
        是抢救时拿出来才发现过期，所以要在到期前主动提醒。
   约定：expiry_date 为 YYYY-MM-DD（Asia/Shanghai 自然日）；空串 = 该设备不适用。
        remind_days 为到期前几天开始提醒，0 表示用默认 30 天。
        "今天"一律由调用方按服务端 Asia/Shanghai 传入，保持纯函数便于单测。
   ========================================================================= */

const { getDb } = require('../db/connection');
const P = require('./period.service');

const DEFAULT_REMIND_DAYS = 30;
/* 状态优先级：过期 > 临期 > 正常。数值大的更紧急，用于排序与汇总 */
const LEVEL = { expired: 2, soon: 1, ok: 0, none: -1 };

/* 两个 YYYY-MM-DD 相差天数（b - a）。用 UTC 正午避开夏令时/时区偏移 */
function daysBetween(a, b) {
  const t = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12);
  return Math.round((t(b) - t(a)) / 86400000);
}

const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !isNaN(Date.parse(s + 'T00:00:00Z'))
  && String(new Date(s + 'T00:00:00Z').getUTCDate()).padStart(2, '0') === s.slice(8, 10);

/* 单台设备的有效期状态（纯函数，单测直接调用）
   返回 { level, days, remindDays }：
     level=none   未设置有效期，不参与提醒
     level=expired 已过期（days 为负，表示过期天数取负值）
     level=soon    临期（0 <= days <= remindDays）
     level=ok      尚早 */
function statusOf(device, today) {
  const exp = device && device.expiry_date;
  if (!exp || !isDate(exp)) return { level: 'none', days: null, remindDays: null };
  const remindDays = +device.remind_days > 0 ? +device.remind_days : DEFAULT_REMIND_DAYS;
  const days = daysBetween(today, exp);         // >0 还剩几天；=0 今天到期；<0 已过期
  if (days < 0) return { level: 'expired', days, remindDays };
  if (days <= remindDays) return { level: 'soon', days, remindDays };
  return { level: 'ok', days, remindDays };
}

const deviceRow = (v, today) => {
  const st = statusOf(v, today);
  return {
    deviceId: String(v.id), deptId: String(v.dept_id), deptName: v.dept_name || '',
    code: v.code, name: v.name, catName: v.cat_name, location: v.location,
    expiryDate: v.expiry_date, expiryNote: v.expiry_note,
    level: st.level, days: st.days, remindDays: st.remindDays
  };
};

/* 有效期清单。deptIds=null 表示全院（设备科/管理员）
   onlyAlert=true 时只返回过期+临期（首页提醒用），false 返回全部已设有效期的（管理页用） */
function list(deptIds, { onlyAlert = true, today = P.today() } = {}) {
  const db = getDb();
  const scoped = Array.isArray(deptIds) && deptIds.length;
  const rows = db.prepare(`
    SELECT v.*, d.name AS dept_name FROM devices v JOIN depts d ON d.id = v.dept_id
    WHERE v.expiry_date <> '' AND v.status = 'in_use' AND d.status = 'on'
    ${scoped ? `AND v.dept_id IN (${deptIds.map(() => '?').join(',')})` : ''}
  `).all(...(scoped ? deptIds : []));

  const out = rows.map(v => deviceRow(v, today)).filter(r => r.level !== 'none');
  const kept = onlyAlert ? out.filter(r => r.level === 'expired' || r.level === 'soon') : out;
  /* 越紧急越靠前；同级按剩余天数升序，再按科室、编码稳定排序 */
  kept.sort((a, b) =>
    LEVEL[b.level] - LEVEL[a.level] || a.days - b.days ||
    a.deptName.localeCompare(b.deptName, 'zh') || a.code.localeCompare(b.code));
  return kept;
}

/* 汇总计数，给首页角标用 */
function summary(deptIds, today = P.today()) {
  const all = list(deptIds, { onlyAlert: true, today });
  return {
    expired: all.filter(r => r.level === 'expired').length,
    soon: all.filter(r => r.level === 'soon').length,
    total: all.length
  };
}

module.exports = { statusOf, list, summary, daysBetween, isDate, DEFAULT_REMIND_DAYS, LEVEL };
