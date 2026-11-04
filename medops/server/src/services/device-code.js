'use strict';
/* 设备编码、序列号里的「/」表示「没有」：有的设备没有编码 / 序列号，可以多台都填「/」；
   其他的值一台设备一个，全院不能重复。
     · 编码区分大小写（与以前一致；数据库里有唯一索引兜底，见迁移 007）
     · 序列号不区分大小写：铭牌上抄下来的 sn123 和 SN123 是同一台
     · 序列号还可以留空（= 还没录），留空的也不判重
   「无」「-」「、」「／」等写法一律按「/」处理：Excel 台账里这几种都常见（中文输入法下按 / 键
   打出来的是「、」），不归一的话，第二台写「无」的设备就会被当成编码重复拒收。 */
const NONE = '/';
const NONE_WORDS = new Set(['/', '／', '、', '\\', '无', '没有', '暂无', '不适用', '-', '－', '—', '–', 'n/a']);

/* 去首尾空白（含全角空格）；表示「没有」的写法统一成「/」 */
function normNone(v) {
  const t = String(v == null ? '' : v).trim();
  return NONE_WORDS.has(t.toLowerCase()) ? NONE : t;
}
/* 真正的编码 / 序列号（要判重的）：不是空、不是「/」 */
const isReal = v => !!v && v !== NONE;
/* 给人看的设备称呼：有编码「JZ-CD-001 除颤仪」，没有编码只说名称 */
const devLabel = v => (isReal(v.code) ? `${v.code} ${v.name}` : v.name);

const OWNER_SQL = `SELECT v.id, v.code, v.name, v.serial, v.status, v.dept_id, p.name AS dept_name
  FROM devices v LEFT JOIN depts p ON p.id = v.dept_id`;
/* 占用这个编码 / 序列号的设备（exceptId：排除自己） */
const codeOwner = (db, code, exceptId = 0) =>
  db.prepare(`${OWNER_SQL} WHERE v.code = ? AND v.id <> ? LIMIT 1`).get(code, exceptId) || null;
const serialOwner = (db, serial, exceptId = 0) =>
  db.prepare(`${OWNER_SQL} WHERE v.serial = ? COLLATE NOCASE AND v.id <> ? ORDER BY v.id LIMIT 1`).get(serial, exceptId) || null;

const where = o => `${o.dept_name || '其他科室'}「${devLabel(o)}」`;
const codeTaken = o => `设备编码「${o.code}」已被${where(o)}使用，编码不能重复；没有编码的填「/」`;
const serialTaken = (serial, o) => `序列号「${serial}」已是${where(o)}的序列号，序列号不能重复；没有序列号的填「/」或留空`;

/* 列表排序：有编码的在前（按编码），没有编码的在后（按名称）。
   名称按字符编码比，和数据库 ORDER BY 一致——后台台账、手机端、月报里的顺序都一样 */
const SQL_ORDER = (t = '') => `${t}code = '/', ${t}code, ${t}name`;
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const byCode = (a, b) => (a.code === NONE) - (b.code === NONE) || a.code.localeCompare(b.code) || cmp(String(a.name), String(b.name));

module.exports = { NONE, NONE_WORDS, normNone, isReal, devLabel, codeOwner, serialOwner, codeTaken, serialTaken, SQL_ORDER, byCode };
