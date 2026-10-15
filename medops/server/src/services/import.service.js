'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { getDb } = require('../db/connection');
const expirySvc = require('./expiry.service');
const { E } = require('../plugins/error');
const fs = require('fs');
const fileSvc = require('./file.service');
const P = require('./period.service');
const { normDeviceStatus, onOff, STATUS_TEXT } = require('./device-status');

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
// 后台台账上显示的是「维修中 / 已停用 / 已报废」，照着抄进 Excel 也认
Object.assign(STATUS_MAP, { '维修中': 'repair', '已停用': 'retired', '已报废': 'scrapped' });
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
      /* 留空：新设备默认「在用」；已有设备「本次不改动」（与有效期两列同一语义）。
         以前已有设备留空也写成在用：只想改个位置的重导入，会把报废的设备悄悄改回在用 */
      let status;
      if (statusRaw) {
        status = STATUS_MAP[statusRaw];
        if (!status) { errors.push({ row: n, message: `状态「${statusRaw}」无法识别，只能填：${STATUS_WORDS}（留空：新设备默认在用，已有设备不改动）` }); continue; }
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
          status = COALESCE(?, status), expiry_date = COALESCE(?, expiry_date), remind_days = COALESCE(?, remind_days),
          updated_at = ? WHERE id = ?`)
          .run(deptId, catName, name, model, location, status || null,
            expiry === undefined ? null : expiry, remind === undefined ? null : remind,
            nowIso(), old.id);
        updated++;
      } else {
        db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, model, location, status,
          expiry_date, remind_days, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(deptId, catName, code, name, model, location, status || 'in_use',
            expiry || '', remind || 0, nowIso(), nowIso());
        created++;
      }
    }
  })();
  return { created, updated, errors };
}

/* 科室 xlsx 导入：按「科室名称」新增或更新（列：科室名称 / 编码 / 排序 / 状态）。
   编码、排序、状态留空 = 已有科室本次不改动（与设备导入同一语义）；新科室：编码空、排序 0、启用。 */
const DEPT_STATUS = { 启用: 'on', 停用: 'off', 已停用: 'off' };
async function importDepts(buffer) {
  const db = getDb();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw E.badInput('无法解析 xlsx 文件'); }
  const ws = wb.worksheets[0];
  if (!ws) throw E.badInput('xlsx 中没有工作表');
  let created = 0, updated = 0;
  const errors = [];
  const rows = [];
  ws.eachRow((row, n) => { if (n > 1) rows.push([row, n]); });
  const seen = new Map(); // 同一个文件里科室名称重复
  db.transaction(() => {
    for (const [row, n] of rows) {
      const [name, codeRaw, sortRaw, statusRaw] = [1, 2, 3, 4].map(i => cellStr(row, i));
      if (!name && !codeRaw && !sortRaw && !statusRaw) continue; // 空行
      if (!name) { errors.push({ row: n, message: '科室名称不能为空' }); continue; }
      if (seen.has(name)) { errors.push({ row: n, message: `与第 ${seen.get(name)} 行的科室名称重复，本行未导入` }); continue; }
      seen.set(name, n);
      let sort;
      if (sortRaw) {
        const v = Number(sortRaw);
        if (!Number.isInteger(v) || Math.abs(v) > 1e6) { errors.push({ row: n, message: `排序「${sortRaw}」应为整数；本行未导入` }); continue; }
        sort = v;
      }
      let status;
      if (statusRaw) {
        status = DEPT_STATUS[statusRaw];
        if (!status) { errors.push({ row: n, message: `状态「${statusRaw}」只能填：启用 / 停用（留空：新科室默认启用，已有科室不改动）` }); continue; }
      }
      const code = CLEAR_WORDS.has(codeRaw) ? '' : codeRaw || undefined;
      const old = db.prepare('SELECT id FROM depts WHERE name = ?').get(name);
      if (old) {
        db.prepare('UPDATE depts SET code = COALESCE(?, code), sort = COALESCE(?, sort), status = COALESCE(?, status) WHERE id = ?')
          .run(code ?? null, sort ?? null, status || null, old.id);
        updated++;
      } else {
        db.prepare('INSERT INTO depts (name, code, sort, status, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(name, code || '', sort ?? 0, status || 'on', nowIso());
        created++;
      }
    }
  })();
  return { created, updated, errors };
}

/* 历史数据导入：旧版 H5 导出的 JSON（{depts,devices,members,users,records,weeksigns,monthsigns}），
   或照这个格式手工整理的数据。账号密码一律重置为随机值 + 首次登录改密。

   原则：
   · 能导的尽量导，导不了的逐条说明原因——一条坏数据不能让整单失败（以前缺个设备编码就整单 500）。
     每一条单独一个保存点，出错只回滚它自己。
   · 会破坏现行规则的不导：今天以后的记录、还没结束的周 / 月的签字。它们一进库就锁住本周 / 本月，
     巡检员后面几天再也录不进去（旧版 H5 允许签当月月签，手工编的测试数据也常带这种签字）。
   · 已结束的周期里不符合签字规则的（周签缺日签、月签缺周签）是历史事实，照原样导入，但逐条提示怎么更正。
   · 状态写法（active / 停用 / 报废 …）按同义词换算；认不出的提示，不再一律当成「在用」——
     以前「报废」「inactive」的设备导进来全变成在用，又出现在手机端巡检清单里。
   · 巡检人、日签人关联到账号，周签人关联到签字人名单：改名同步、手机端「我的签字记录」才认得出。
   dryRun：完整走一遍、最后整体回滚，不写任何数据和文件（后台「先检查」用）。
   返回 { imported:{各类条数}, passwords:{账号:新密码}, errors:[跳过的], warnings:[导入了但要留意的], dryRun } */
function importLegacy(data, { dryRun = false } = {}) {
  const db = getDb();
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw E.badInput('导入数据必须是 JSON 对象');
  const today = P.today();
  const errors = [], warnings = [];
  const skip = (where, message) => errors.push({ where, message });
  const warn = (where, message) => warnings.push({ where, message });
  const counts = { depts: 0, devices: 0, members: 0, users: 0, records: 0, weeksigns: 0, monthsigns: 0 };
  const passwords = {}; // username → 新随机密码（返回给管理员）
  const deptMap = new Map(), deptNames = new Map(), deviceMap = new Map(), userMap = new Map(); // 旧 id → 新 id
  const list = k => (Array.isArray(data[k]) ? data[k] : []);
  const str = v => (v == null ? '' : String(v).trim());
  const idOf = v => String(v == null ? '' : v);
  const intOr = (v, f) => (v !== '' && v != null && Number.isInteger(Number(v)) ? Number(v) : f);
  const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && P.fmt(P.D(s)) === s;
  // 旧数据没带时间时用上海时间（库里约定的格式）
  const at = v => (typeof v === 'string' && v.trim() ? v.trim() : P.stamp());
  const dn = deptOld => deptNames.get(idOf(deptOld)) || `科室id=${idOf(deptOld)}`;
  /* 签字所属科室不在导入数据里：同类合并成一条，免得几百条记录刷屏 */
  const missDept = new Map();
  const noDept = (kind, deptOld) => { const k = `${kind}|${idOf(deptOld)}`; missDept.set(k, (missDept.get(k) || 0) + 1); };

  const saved = []; // 已落盘的签名图路径：整单或单条回滚时一并删掉，免得留下孤儿文件
  const unlink = abs => { try { fs.unlinkSync(abs); } catch { /* 已不存在 */ } };
  /* 签名图：成功返回 { id }，失败返回 { err } 由调用方决定是跳过签字还是跳过整条 */
  const signFile = sign => {
    if (!sign || typeof sign !== 'object') return { err: '没有签字' };
    if (!sign.dataUrl) return { err: '签名缺少图片（dataUrl）' };
    try {
      if (dryRun) {
        const buf = fileSvc.checkSignature(sign.dataUrl);
        const id = crypto.randomUUID(); // 占位，整单回滚时一起撤销
        db.prepare(`INSERT INTO files (id, kind, rel_path, mime, size, sha256, created_at)
          VALUES (?, 'signature', 'dry-run', 'image/png', ?, '', ?)`).run(id, buf.length, nowIso());
        return { id };
      }
      const f = fileSvc.saveSignature(sign.dataUrl);
      saved.push(f.abs);
      return { id: f.id };
    } catch (e) { return { err: `签名图无效（${e.message}）` }; }
  };
  /* 每条一个保存点 */
  const each = (items, whereOf, fn) => {
    for (const x of items) {
      if (!x || typeof x !== 'object' || Array.isArray(x)) { skip(whereOf({}), '不是有效的数据项，已跳过'); continue; }
      const mark = saved.length;
      try { db.transaction(() => fn(x))(); } catch (e) {
        saved.splice(mark).forEach(unlink);
        skip(whereOf(x), `导入出错，已跳过：${e.message}`);
      }
    }
  };
  /* 显示名 → 账号（全库唯一时才认，同名多人不乱关联） */
  const userByName = (name, roles) => {
    if (!name) return null;
    const rows = db.prepare(`SELECT id FROM users WHERE display_name = ? AND role IN (${roles.map(() => '?').join(',')})`).all(name, ...roles);
    return rows.length === 1 ? rows[0].id : null;
  };
  const displayOf = id => (db.prepare('SELECT display_name FROM users WHERE id = ?').get(id) || {}).display_name || '';

  const DONE = new Error('dry-run');
  try { db.transaction(() => {
    /* ---------- 科室 ---------- */
    each(list('depts'), d => `科室 ${str(d.name) || `id=${idOf(d.id)}`}`, d => {
      const name = str(d.name);
      if (!name) { skip(`科室 id=${idOf(d.id)}`, '缺少科室名称，已跳过（属于它的设备、记录也会跳过）'); return; }
      const old = db.prepare('SELECT id FROM depts WHERE name = ?').get(name);
      let id = old && old.id;
      if (!id) {
        id = db.prepare('INSERT INTO depts (name, code, sort, status, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(name, str(d.code), intOr(d.sort, 0), onOff(d.status != null ? d.status : (d.active === false ? 'off' : null)), nowIso()).lastInsertRowid;
        counts.depts++;
      }
      deptMap.set(idOf(d.id), id);
      deptNames.set(idOf(d.id), name);
    });

    /* ---------- 设备 ---------- */
    const conv = new Map(); // 「原写法→系统值」计数，汇总成一条提示
    let uncategorized = 0;
    each(list('devices'), v => `设备 ${str(v.code) || str(v.name) || '(没有编码)'}`, v => {
      const code = str(v.code);
      const where = `设备 ${code || str(v.name) || '(没有编码)'}`;
      if (!code) { skip(where, '缺少设备编码（code），已跳过'); return; }
      const deptId = deptMap.get(idOf(v.deptId));
      if (!deptId) { skip(where, `所属科室（deptId=${idOf(v.deptId)}）不在导入数据里，已跳过`); return; }
      const old = db.prepare('SELECT id, status FROM devices WHERE code = ?').get(code);
      const raw = v.status != null ? v.status : (v.active === false ? 'retired' : v.active === true ? 'in_use' : null);
      let status = normDeviceStatus(raw);
      if (status === null) {
        status = old ? old.status : 'in_use';
        warn(where, old ? `状态「${raw}」认不出，保持系统里原来的「${STATUS_TEXT[old.status] || old.status}」`
          : `状态「${raw}」认不出，已按「在用」导入，请到设备台账核对`);
      } else if (status === '') status = old ? old.status : 'in_use';
      else if (String(raw) !== status) { const k = `「${raw}」→ ${STATUS_TEXT[status]}`; conv.set(k, (conv.get(k) || 0) + 1); }
      // 有效期：给了才处理；格式不对只提示、不导入这一项
      const ex = {};
      if (str(v.expiryDate)) {
        const d = str(v.expiryDate);
        if (expirySvc.isDate(d) && expirySvc.inRange(d)) ex.date = d;
        else warn(where, `有效期「${d}」不是有效日期（应为 2027-03-15 这样的完整年月日），这一项没有导入`);
      }
      if (str(v.remindDays)) {
        const n = Number(v.remindDays);
        if (Number.isInteger(n) && n >= 0 && n <= 365) ex.days = n;
        else warn(where, `提醒提前天数「${v.remindDays}」应为 0～365 的整数，这一项没有导入`);
      }
      if (v.expiryNote != null) ex.note = str(v.expiryNote).slice(0, 60);
      const cat = str(v.catName != null ? v.catName : v.category);
      if (old) {
        /* 已有的设备：只改 JSON 里给了值的项。没给的不动——以前品类、状态没写就被改成空 / 在用，
           管理员事后改好的又被重新导入冲掉 */
        db.prepare(`UPDATE devices SET dept_id = ?, cat_name = COALESCE(?, cat_name), name = COALESCE(?, name),
          model = COALESCE(?, model), location = COALESCE(?, location), status = ?,
          expiry_date = COALESCE(?, expiry_date), expiry_note = COALESCE(?, expiry_note), remind_days = COALESCE(?, remind_days),
          updated_at = ? WHERE id = ?`)
          .run(deptId, cat || null, str(v.name) || null, str(v.model) || null, str(v.location) || null, status,
            ex.date ?? null, ex.note ?? null, ex.days ?? null, nowIso(), old.id);
        deviceMap.set(idOf(v.id), old.id);
      } else {
        if (!cat) uncategorized++;
        if (!str(v.name)) warn(where, '没有设备名称，已用编码代替');
        const id = db.prepare(`INSERT INTO devices (dept_id, cat_name, code, name, model, location, status, sort,
          expiry_date, expiry_note, remind_days, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(deptId, cat || '未分类', code, str(v.name) || code, str(v.model), str(v.location), status, intOr(v.sort, 0),
            ex.date || '', ex.note || '', ex.days || 0, nowIso(), nowIso()).lastInsertRowid;
        deviceMap.set(idOf(v.id), id);
        counts.devices++;
      }
    });
    if (conv.size) warn('设备状态', `按常见写法换算：${[...conv].map(([k, n]) => `${k} ${n} 台`).join('；')}`);
    if (uncategorized) warn('设备品类', `${uncategorized} 台设备没有品类，已记为「未分类」，可在设备台账里改成实际品类`);

    /* ---------- 签字人名单 ---------- */
    each(list('members'), m => `签字人 ${str(m.name) || '(没有姓名)'}`, m => {
      const name = str(m.name);
      const where = `签字人 ${name || '(没有姓名)'}`;
      if (!name) { skip(where, '缺少姓名，已跳过'); return; }
      const deptId = deptMap.get(idOf(m.deptId));
      if (!deptId) { skip(where, `所属科室（deptId=${idOf(m.deptId)}）不在导入数据里，已跳过`); return; }
      db.prepare(`INSERT INTO members (dept_id, name, title, status, sort) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(dept_id, name) DO UPDATE SET title = excluded.title, status = excluded.status`)
        .run(deptId, name, str(m.title), onOff(m.status != null ? m.status : (m.active === false ? 'off' : null)), intOr(m.sort, 0));
      counts.members++;
    });

    /* ---------- 账号 ---------- */
    const ROLE_WORDS = { inspector: 'inspector', 巡检员: 'inspector', 巡检: 'inspector', dept: 'dept', nurse: 'dept',
      护士长: 'dept', equip: 'equip', 设备科: 'equip', admin: 'admin', 管理员: 'admin', 超级管理员: 'admin', 系统管理员: 'admin' };
    each(list('users'), u => `账号 ${str(u.username) || str(u.displayName) || '(没有账号名)'}`, u => {
      const username = str(u.username);
      const where = `账号 ${username || str(u.displayName) || '(没有账号名)'}`;
      if (!username) { skip(where, '缺少登录账号名（username），已跳过'); return; }
      const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (exist) {
        userMap.set(idOf(u.id), exist.id); // 同一个人：历史记录仍关联到系统里这个账号
        skip(where, '系统里已有这个账号，已跳过（原账号不改动，这个人的历史记录会关联到它）');
        return;
      }
      const rawRole = str(u.role);
      let role = ROLE_WORDS[rawRole.toLowerCase()] || ROLE_WORDS[rawRole];
      if (!role) { role = 'inspector'; warn(where, `角色「${rawRole || '空'}」认不出，已按「巡检员」导入，请到账号管理核对`); }
      const olds = Array.isArray(u.deptIds) ? u.deptIds : (u.deptId != null ? [u.deptId] : []);
      const nds = [...new Set(olds.map(od => deptMap.get(idOf(od))).filter(Boolean))];
      if (role === 'dept' && nds.length !== 1) { skip(where, '护士长账号必须恰好属于 1 个科室，已跳过'); return; }
      if (role === 'inspector' && !nds.length) warn(where, '巡检员没有分配科室，登录后看不到任何科室，请到账号管理分配');
      const pwd = crypto.randomBytes(6).toString('base64url');
      const id = db.prepare(`INSERT INTO users (username, password_hash, display_name, role, status, must_change, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(username, dryRun ? '-' : bcrypt.hashSync(pwd, 10), str(u.displayName) || username, role,
          onOff(u.status != null ? u.status : (u.active === false ? 'off' : null)), nowIso(), nowIso()).lastInsertRowid;
      for (const nd of nds) db.prepare('INSERT OR IGNORE INTO user_depts (user_id, dept_id) VALUES (?, ?)').run(id, nd);
      userMap.set(idOf(u.id), id);
      if (!dryRun) passwords[username] = pwd;
      counts.users++;
    });

    /* ---------- 日巡检记录 ---------- */
    const unknownDev = new Map(); // 科室旧 id → { days, items, ids }：结果对应不上设备的，按科室合并成一条提示
    const existed = new Map();    // 科室旧 id → { n, min, max }：系统里已有记录的日子
    const insItem = db.prepare('INSERT OR IGNORE INTO record_items (record_id, device_id, result, note) VALUES (?, ?, ?, ?)');
    each(list('records'), r => `日巡检 ${dn(r.deptId)} ${str(r.date)}`, r => {
      const date = str(r.date);
      const where = `日巡检 ${dn(r.deptId)} ${date}`;
      const deptId = deptMap.get(idOf(r.deptId));
      if (!deptId) { noDept('records', r.deptId); return; }
      if (!isDay(date)) { skip(where, '日期不正确，已跳过'); return; }
      if (date > today) { skip(where, `日期在今天（${today}）之后，不能提前录入，已跳过`); return; }
      if (db.prepare('SELECT 1 FROM records WHERE dept_id = ? AND date = ?').get(deptId, date)) {
        // 重复导入时会有很多条，按科室合并成一条
        const e = existed.get(idOf(r.deptId)) || { n: 0, min: date, max: date };
        e.n++; if (date < e.min) e.min = date; if (date > e.max) e.max = date;
        existed.set(idOf(r.deptId), e);
        return;
      }
      const inspId = userMap.get(idOf(r.inspectorId)) || userByName(str(r.inspectorName), ['inspector']) || null;
      const inspName = str(r.inspectorName) || (inspId ? displayOf(inspId) : '');
      let sf = null, signName = null, signUser = null;
      if (r.sign) {
        const s = signFile(r.sign);
        if (s.err) warn(where, `${s.err}，这一天按「未日签」导入`);
        else {
          sf = s.id;
          signName = str(r.sign.name) || inspName || '巡检员';
          // 日签人就是巡检员本人：签字名与巡检人一致时关联到同一账号（与迁移 004 的回填规则相同）
          signUser = inspId && (signName === inspName || signName === displayOf(inspId)) ? inspId : userByName(signName, ['inspector']);
        }
      }
      const rid = db.prepare(`INSERT INTO records (dept_id, date, inspector_id, inspector_name, sign_name, sign_title,
        sign_opinion, sign_file_id, sign_user_id, sign_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(deptId, date, inspId, inspName, signName, sf ? str(r.sign.title) || '巡检员' : null, sf ? str(r.sign.opinion) : null,
          sf, sf ? signUser : null, sf ? at(r.sign.at) : null, at(r.createdAt), at(r.updatedAt || r.createdAt)).lastInsertRowid;
      const notes = r.notes && typeof r.notes === 'object' ? r.notes : {};
      let bad = 0;
      const u = unknownDev.get(idOf(r.deptId)) || { days: 0, items: 0, ids: new Set() };
      for (const [devOld, res] of Object.entries(r.checks && typeof r.checks === 'object' ? r.checks : {})) {
        const dev = deviceMap.get(String(devOld));
        if (dev && (res === 'ok' || res === 'ng')) insItem.run(rid, dev, res, res === 'ng' ? str(notes[devOld]).slice(0, 200) : '');
        else { bad++; u.ids.add(dev ? `${devOld}（结果「${res}」）` : devOld); }
      }
      if (bad) { u.days++; u.items += bad; unknownDev.set(idOf(r.deptId), u); }
      counts.records++;
    });

    for (const [deptOld, e] of existed) {
      skip(`日巡检 ${dn(deptOld)}`, `${e.n} 天系统里已有记录（${e.min}${e.max !== e.min ? ` ～ ${e.max}` : ''}），已跳过，原记录不改动`);
    }
    for (const [deptOld, u] of unknownDev) {
      const ids = [...u.ids];
      warn(`日巡检 ${dn(deptOld)}`, `${u.days} 天的记录里共有 ${u.items} 项结果对应不上设备（设备 id：${ids.slice(0, 5).join('、')}${ids.length > 5 ? ` 等 ${ids.length} 个` : ''}），`
        + '这些项已忽略：设备不在导入数据里，或结果不是 ok / ng');
    }

    /* ---------- 周签 ---------- */
    const weeks = [];
    each(list('weeksigns'), w => `周签 ${dn(w.deptId)} ${str(w.week || w.weekStart)} 起`, w => {
      const week = str(w.week || w.weekStart);
      const where = `周签 ${dn(w.deptId)} ${week} 起`;
      const deptId = deptMap.get(idOf(w.deptId));
      if (!deptId) { noDept('weeksigns', w.deptId); return; }
      if (!isDay(week) || P.wkOf(week) !== week) { skip(where, '周签的周必须是周一日期，已跳过'); return; }
      const sunday = P.addDay(week, 6);
      if (sunday > today) {
        skip(where, `这一周到 ${sunday} 才结束，不能提前周签，已跳过（导进来会锁住这一周，巡检员后面几天就录不进去了）`);
        return;
      }
      if (db.prepare('SELECT 1 FROM week_signs WHERE dept_id = ? AND week_start = ?').get(deptId, week)) {
        skip(where, '系统里这一周已有周签，已跳过'); return;
      }
      const s = signFile(w.sign);
      if (s.err) { skip(where, `${s.err}，周签没有导入`); return; }
      const name = str(w.sign.name);
      const member = db.prepare('SELECT id FROM members WHERE dept_id = ? AND name = ?').get(deptId, name);
      const st = weekStat(db, deptId, week, w.stat);
      db.prepare(`INSERT INTO week_signs (dept_id, week_start, sign_name, sign_title, sign_opinion, sign_file_id,
        stat_checked, stat_ng, stat_days, sign_member_id, sign_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(deptId, week, name, str(w.sign.title), str(w.sign.opinion), s.id, st.checked, st.ng, st.days,
          member ? member.id : null, at(w.sign.at));
      weeks.push({ deptId, week, where });
      counts.weeksigns++;
    });

    /* ---------- 月签 ---------- */
    const months = [];
    each(list('monthsigns'), m => `月签 ${dn(m.deptId)} ${str(m.month)}`, m => {
      const month = str(m.month);
      const where = `月签 ${dn(m.deptId)} ${month}`;
      const deptId = deptMap.get(idOf(m.deptId));
      if (!deptId) { noDept('monthsigns', m.deptId); return; }
      if (!P.isMonth(month)) { skip(where, '月份不正确，已跳过'); return; }
      const end = P.monthSpan(month).to;
      if (end > today) {
        skip(where, `这个月的最后一周到 ${end} 才结束，不能提前月签，已跳过（导进来会锁住整个月，巡检员就录不进去了）`);
        return;
      }
      if (db.prepare('SELECT 1 FROM month_signs WHERE dept_id = ? AND month = ?').get(deptId, month)) {
        skip(where, '系统里这个月已有月签，已跳过'); return;
      }
      const s = signFile(m.sign);
      if (s.err) { skip(where, `${s.err}，月签没有导入`); return; }
      const name = str(m.sign.name);
      const st = monthStat(db, deptId, month, m.stat);
      db.prepare(`INSERT INTO month_signs (dept_id, month, sign_name, sign_title, sign_opinion, sign_file_id,
        stat_checked, stat_ng, stat_weeks, signed_by, sign_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(deptId, month, name, str(m.sign.title), str(m.sign.opinion), s.id, st.checked, st.ng, st.weeks,
          userByName(name, ['equip', 'admin']), at(m.sign.at));
      months.push({ deptId, month, where });
      counts.monthsigns++;
    });

    const KIND = { records: '日巡检记录', weeksigns: '周签', monthsigns: '月签' };
    for (const [k, n] of missDept) {
      const [kind, deptOld] = k.split('|');
      skip(KIND[kind], `${n} 条的所属科室（deptId=${deptOld}）不在导入数据里，已跳过`);
    }

    /* 已结束周期里不符合签字规则的：照原样导入，逐条提示（同「数据体检」的规则） */
    for (const x of weeks) {
      const days = P.wkDays(x.week);
      const signed = new Set(db.prepare(`SELECT date FROM records WHERE dept_id = ? AND date >= ? AND date <= ?
        AND sign_at IS NOT NULL`).all(x.deptId, days[0], days[6]).map(r => r.date));
      const miss = days.filter(d => !signed.has(d));
      if (miss.length) {
        warn(x.where, `这一周有 ${miss.length} 天没有日签（${miss.map(d => d.slice(5)).join('、')}），按规则还不能周签。`
          + '已照原样导入；要更正：后台「周签 / 月签」里作废这个周签，补齐日签后重新周签');
      }
    }
    for (const x of months) {
      const signedW = new Set(db.prepare('SELECT week_start FROM week_signs WHERE dept_id = ?').all(x.deptId).map(r => r.week_start));
      const miss = P.wksOfMonth(x.month).filter(w => !signedW.has(w));
      if (miss.length) {
        warn(x.where, `这个月有 ${miss.length} 周没有周签（${miss.map(w => w.slice(5) + ' 起').join('、')}），按规则还不能月签。`
          + '已照原样导入；要更正：作废这个月签，补齐周签后重新月签');
      }
    }
    if (dryRun) throw DONE; // 先检查：整单回滚
  })(); } catch (e) {
    saved.forEach(unlink);
    if (e !== DONE) throw e;
  }
  return { imported: counts, passwords, errors, warnings, dryRun: !!dryRun };
}

/* 导入的周签 / 月签没带统计（手工编的数据常见）时，按库里的记录现算；带了就用签字当时的快照 */
const num = v => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.trunc(Number(v)) : 0);
function itemStats(db, deptId, from, to) {
  const r = db.prepare(`SELECT COUNT(*) AS checked, SUM(i.result = 'ng') AS ng FROM record_items i
    JOIN records r ON r.id = i.record_id WHERE r.dept_id = ? AND r.date >= ? AND r.date <= ?`).get(deptId, from, to);
  return { checked: r.checked || 0, ng: r.ng || 0 };
}
function weekStat(db, deptId, week, stat) {
  if (stat && typeof stat === 'object') return { checked: num(stat.checked), ng: num(stat.ng), days: num(stat.days) };
  const sun = P.addDay(week, 6);
  const days = db.prepare('SELECT COUNT(*) AS c FROM records WHERE dept_id = ? AND date >= ? AND date <= ? AND sign_at IS NOT NULL')
    .get(deptId, week, sun).c;
  return { ...itemStats(db, deptId, week, sun), days };
}
function monthStat(db, deptId, month, stat) {
  if (stat && typeof stat === 'object') return { checked: num(stat.checked), ng: num(stat.ng), weeks: num(stat.weeks) };
  const span = P.monthSpan(month);
  const wks = P.wksOfMonth(month);
  const weeks = db.prepare(`SELECT COUNT(*) AS c FROM week_signs WHERE dept_id = ? AND week_start IN (${wks.map(() => '?').join(',')})`)
    .get(deptId, ...wks).c;
  return { ...itemStats(db, deptId, span.from, span.to), weeks };
}

module.exports = { importDevices, importDepts, importLegacy };
