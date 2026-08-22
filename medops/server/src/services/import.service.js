'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { getDb } = require('../db/connection');
const expirySvc = require('./expiry.service');
const { E } = require('../plugins/error');
const fileSvc = require('./file.service');

const nowIso = () => new Date().toISOString();

/* Excel 有效期单元格归一化。
   只接受完整年月日：2027-03-15 / 2027/3/15 / 2027.3.15（正则两端锚定，多打少打一位都算错）。
   刻意不用 new Date(v) 兜底 —— V8 会把 '2027' 解析成 2027-01-01、把 '2027-03' 解析成 3 月 1 号，
   药品有效期常只印到年月，静默编一个日期出来比报错危险得多。
   返回 YYYY-MM-DD；空返回空串；无法解析返回 null（调用方据此报错）。 */
function normExpiryCell(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return '';
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v);
  if (!m) return null;
  const iso = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return expirySvc.isDate(iso) ? iso : null;
}

const STATUS_MAP = { '在用': 'in_use', '维修': 'repair', '停用': 'retired', '报废': 'scrapped' };
const STATUS_WORDS = Object.keys(STATUS_MAP).join(' / ');
/* 明确表达"把这一格清空"，否则留空一律按"本次不改动"处理（见 importDevices 注释） */
const CLEAR_WORDS = new Set(['无', '-', '—', '/', '清空', '不适用']);

/* ExcelJS 的 cell.value 有多种形态，逐一归一成字符串：
     Date        —— 日期格式的单元格。ExcelJS 按 UTC 基准构造（(serial-25569)*86400000），
                     所以必须用 getUTC* 取值；用本地取值器会在负偏移时区整体早一天。
     {richText}  —— 单元格里有一部分字被加粗/改色（医院台账里很常见）
     {formula}   —— 公式单元格，取 result
     {text}      —— 超链接单元格
   漏掉任何一种都会落到 String(v) 变成 "[object Object]" 并被当成合法编码/名称写进库。 */
function cellVal(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => (t && t.text) || '').join('').trim();
    if (v.result !== undefined) return cellVal(v.result);
    if (v.text != null) return String(v.text).trim();
    return '';
  }
  return String(v).trim();
}
const cellStr = (row, i) => cellVal(row.getCell(i).value);

/* 按表头文字找列号，找不到返回 0（= 该列不存在）。
   位置兜底是为了兼容表头被改过的老文件；有效期两列一定要走表头判断，
   因为"列不存在"和"列留空"必须区分开（见 importDevices）。 */
function findCol(hdr, re, fallback) {
  const n = Math.max(hdr.cellCount || 0, fallback || 0);
  for (let i = 1; i <= n; i++) if (re.test(cellStr(hdr, i))) return i;
  return 0;
}

/* 设备 xlsx 导入：按 code upsert；科室名不存在 → 该行报错不自动建。

   有效期两列的写入语义（这里很容易出安全事故，故写死规则）：
     · 文件里没有这两列（老的 7 列模板）  → 完全不碰库里已有的有效期，只更新其它字段
     · 有这两列但该行留空                → 同样不碰（"我这次只想改位置"是最常见的重导入意图）
     · 填了「无 / - / 清空」              → 明确清空
     · 填了日期                          → 覆盖
   反过来做（留空即清空）会让任何一次常规重导入静默抹掉全院的急救耗材到期日，
   而界面只报"更新 N 台"，没人会发现。 */
async function importDevices(buffer) {
  const db = getDb();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw E.badInput('无法解析 xlsx 文件'); }
  const ws = wb.worksheets[0];
  if (!ws) throw E.badInput('xlsx 中没有工作表');
  let created = 0, updated = 0;
  const errors = [];
  const deptByName = new Map(db.prepare('SELECT id, name FROM depts').all().map(d => [d.name, d.id]));

  const hdr = ws.getRow(1);
  const iExpiry = findCol(hdr, /有效期|到期/, 8);
  const iRemind = findCol(hdr, /提醒/, 9);

  const rows = [];
  ws.eachRow((row, n) => { if (n > 1) rows.push([row, n]); });
  db.transaction(() => {
    for (const [row, n] of rows) {
      const [deptName, catName, code, name, model, location, statusRaw] =
        [1, 2, 3, 4, 5, 6, 7].map(i => cellStr(row, i));
      if (!deptName && !code && !name) continue; // 空行
      if (!deptName || !catName || !code || !name) { errors.push({ row: n, message: '科室名称/设备品类/设备编码/设备名称不能为空' }); continue; }
      const deptId = deptByName.get(deptName);
      if (!deptId) { errors.push({ row: n, message: `科室「${deptName}」不存在` }); continue; }
      /* 状态必须是模板列出的四个词之一。写成「正常」「使用中」这类同义词若原样入库，
         设备会照常出现在台账里，却被有效期提醒和巡检清单永久排除，过期了没人知道 */
      let status = 'in_use';
      if (statusRaw) {
        status = STATUS_MAP[statusRaw];
        if (!status) { errors.push({ row: n, message: `状态「${statusRaw}」无法识别，只能填：${STATUS_WORDS}（留空默认在用）` }); continue; }
      }

      /* undefined = 本次不改动该列 */
      let expiry, remind;
      if (iExpiry) {
        const raw = cellStr(row, iExpiry);
        if (CLEAR_WORDS.has(raw)) expiry = '';
        else if (raw) {
          expiry = normExpiryCell(raw);
          if (expiry === null) { errors.push({ row: n, message: `有效期「${raw}」不是有效日期，应为 2027-03-15 这样的完整年月日；本行未导入` }); continue; }
          if (!expirySvc.inRange(expiry)) { errors.push({ row: n, message: `有效期「${raw}」的年份不合常理（应在 ${expirySvc.MIN_YEAR} 年至今后 ${expirySvc.MAX_AHEAD_YEARS} 年之间），请检查是否录错年份` }); continue; }
        }
      }
      if (iRemind) {
        const raw = cellStr(row, iRemind);
        if (CLEAR_WORDS.has(raw)) remind = 0;
        else if (raw) {
          const num = Number(raw);
          remind = Math.trunc(num);
          if (!Number.isFinite(num) || !Number.isInteger(num) || remind < 0 || remind > 365) {
            errors.push({ row: n, message: `提醒提前天数「${raw}」应为 0～365 的整数；本行未导入` }); continue;
          }
        }
      }

      const old = db.prepare('SELECT id FROM devices WHERE code = ?').get(code);
      if (old) {
        /* COALESCE 的参数为 null 时保留原值 —— 对应上面 undefined = 不改动 */
        db.prepare(`UPDATE devices SET dept_id = ?, cat_name = ?, name = ?, model = ?, location = ?,
          status = ?, expiry_date = COALESCE(?, expiry_date), remind_days = COALESCE(?, remind_days),
          updated_at = ? WHERE id = ?`)
          .run(deptId, catName, name, model, location, status,
            expiry === undefined ? null : expiry, remind === undefined ? null : remind,
            nowIso(), old.id);
        updated++;
      } else {
        db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, model, location, status,
          expiry_date, remind_days, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(deptId, catName, code, name, model, location, status,
            expiry || '', remind || 0, nowIso(), nowIso());
        created++;
      }
    }
  })();
  return { created, updated, errors };
}

/* H5 导出 JSON 事务导入（users 密码重置为随机 + mustChange） */
function importLegacy(data) {
  const db = getDb();
  if (!data || typeof data !== 'object') throw E.badInput('导入数据必须是 JSON 对象');
  const errors = [];
  const counts = { depts: 0, devices: 0, members: 0, users: 0, records: 0, weeksigns: 0, monthsigns: 0 };
  const passwords = {}; // username → 新随机密码（返回给管理员）
  const deptMap = new Map();   // 旧 id → 新 id
  const deviceMap = new Map();

  const saveSign = (sign, where) => {
    if (!sign) return null;
    if (!sign.dataUrl) { errors.push({ where, message: '签名缺少 dataUrl，已跳过该签字' }); return null; }
    try { return fileSvc.saveSignature(sign.dataUrl); }
    catch (e) { errors.push({ where, message: `签名图无效：${e.message}` }); return null; }
  };

  db.transaction(() => {
    for (const d of data.depts || []) {
      const old = db.prepare('SELECT id FROM depts WHERE name = ?').get(d.name);
      let id;
      if (old) id = old.id;
      else {
        id = db.prepare('INSERT INTO depts (name, code, sort, status, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(d.name, d.code || '', d.sort || 0, d.status === 'off' ? 'off' : 'on', nowIso()).lastInsertRowid;
        counts.depts++;
      }
      deptMap.set(String(d.id), id);
    }
    for (const v of data.devices || []) {
      const deptId = deptMap.get(String(v.deptId));
      if (!deptId) { errors.push({ where: `device ${v.code}`, message: '找不到所属科室' }); continue; }
      const old = db.prepare('SELECT id FROM devices WHERE code = ?').get(v.code);
      let id;
      if (old) {
        db.prepare('UPDATE devices SET dept_id = ?, cat_name = ?, name = ?, model = ?, location = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(deptId, v.catName || '', v.name || '', v.model || '', v.location || '', v.status || 'in_use', nowIso(), old.id);
        id = old.id;
      } else {
        id = db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, model, location, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(deptId, v.catName || '', v.code, v.name || '', v.model || '', v.location || '', v.status || 'in_use', nowIso(), nowIso()).lastInsertRowid;
        counts.devices++;
      }
      deviceMap.set(String(v.id), id);
    }
    for (const m of data.members || []) {
      const deptId = deptMap.get(String(m.deptId));
      if (!deptId) continue;
      db.prepare(`INSERT INTO members (dept_id, name, title, status, sort) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(dept_id, name) DO UPDATE SET title = excluded.title, status = excluded.status`)
        .run(deptId, m.name, m.title || '', m.status === 'off' ? 'off' : 'on', m.sort || 0);
      counts.members++;
    }
    for (const u of data.users || []) {
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u.username)) {
        errors.push({ where: `user ${u.username}`, message: '账号已存在，已跳过' }); continue;
      }
      const pwd = crypto.randomBytes(6).toString('base64url');
      const id = db.prepare(`INSERT INTO users (username, password_hash, display_name, role, status, must_change, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(u.username, bcrypt.hashSync(pwd, 10), u.displayName || u.username,
          ['inspector', 'dept', 'equip', 'admin'].includes(u.role) ? u.role : 'inspector',
          u.status === 'off' ? 'off' : 'on', nowIso(), nowIso()).lastInsertRowid;
      for (const od of (u.deptIds || (u.deptId != null ? [u.deptId] : []))) {
        const nd = deptMap.get(String(od));
        if (nd) db.prepare('INSERT OR IGNORE INTO user_depts (user_id, dept_id) VALUES (?, ?)').run(id, nd);
      }
      passwords[u.username] = pwd;
      counts.users++;
    }
    for (const r of data.records || []) {
      const deptId = deptMap.get(String(r.deptId));
      if (!deptId) continue;
      if (db.prepare('SELECT 1 FROM records WHERE dept_id = ? AND date = ?').get(deptId, r.date)) {
        errors.push({ where: `record ${r.deptId}/${r.date}`, message: '记录已存在，已跳过' }); continue;
      }
      const sf = saveSign(r.sign, `record ${r.date}`);
      const rid = db.prepare(`INSERT INTO records (dept_id, date, inspector_name, sign_name, sign_title,
        sign_opinion, sign_file_id, sign_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(deptId, r.date, r.inspectorName || '',
          sf ? r.sign.name : null, sf ? (r.sign.title || '') : null, sf ? (r.sign.opinion || '') : null,
          sf ? sf.id : null, sf ? (r.sign.at || nowIso()) : null,
          r.createdAt || nowIso(), r.updatedAt || nowIso()).lastInsertRowid;
      const ins = db.prepare('INSERT OR IGNORE INTO record_items (record_id, device_id, result, note) VALUES (?, ?, ?, ?)');
      for (const [devOld, res] of Object.entries(r.checks || {})) {
        const dev = deviceMap.get(String(devOld));
        if (dev && (res === 'ok' || res === 'ng')) ins.run(rid, dev, res, String((r.notes || {})[devOld] || ''));
      }
      counts.records++;
    }
    for (const w of data.weeksigns || []) {
      const deptId = deptMap.get(String(w.deptId));
      if (!deptId) continue;
      if (db.prepare('SELECT 1 FROM week_signs WHERE dept_id = ? AND week_start = ?').get(deptId, w.week)) continue;
      const sf = saveSign(w.sign, `weeksign ${w.week}`);
      if (!sf) continue; // 周签签名图必填
      db.prepare(`INSERT INTO week_signs (dept_id, week_start, sign_name, sign_title, sign_opinion, sign_file_id,
        stat_checked, stat_ng, stat_days, sign_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(deptId, w.week, w.sign.name, w.sign.title || '', w.sign.opinion || '', sf.id,
          (w.stat || {}).checked || 0, (w.stat || {}).ng || 0, (w.stat || {}).days || 0, w.sign.at || nowIso());
      counts.weeksigns++;
    }
    for (const m of data.monthsigns || []) {
      const deptId = deptMap.get(String(m.deptId));
      if (!deptId) continue;
      if (db.prepare('SELECT 1 FROM month_signs WHERE dept_id = ? AND month = ?').get(deptId, m.month)) continue;
      const sf = saveSign(m.sign, `monthsign ${m.month}`);
      if (!sf) continue;
      db.prepare(`INSERT INTO month_signs (dept_id, month, sign_name, sign_title, sign_opinion, sign_file_id,
        stat_checked, stat_ng, stat_weeks, sign_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(deptId, m.month, m.sign.name, m.sign.title || '', m.sign.opinion || '', sf.id,
          (m.stat || {}).checked || 0, (m.stat || {}).ng || 0, (m.stat || {}).weeks || 0, m.sign.at || nowIso());
      counts.monthsigns++;
    }
  })();
  return { imported: counts, passwords, errors };
}

module.exports = { importDevices, importLegacy };
