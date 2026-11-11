'use strict';
/* 账号：登录账号名的规则、判重、删除前检查，以及 Excel 批量导入（模板 + 导入）。
   新建、修改、导入三处共用同一套规则，避免一处能存进去、另一处又不认。 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');

const nowIso = () => new Date().toISOString();
const USERNAME_MAX = 32;
const NAME_MAX = 50;
const MAX_ROWS = 500;

/* 登录账号名：去掉首尾空白后不能为空、中间不能有空格（手机上很难看出来，登录时总对不上）、最多 32 个字。
   返回错误原因（字符串）或 null。 */
function usernameProblem(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return '登录账号不能为空';
  if (/\s/.test(t)) return '登录账号里不能有空格';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(t)) return '登录账号里有看不见的特殊字符，请重新输入';
  if (t.length > USERNAME_MAX) return `登录账号最多 ${USERNAME_MAX} 个字`;
  return null;
}
function normUsername(v) {
  const why = usernameProblem(v);
  if (why) throw E.badInput(why);
  return String(v).trim();
}
/* 判重不分大小写：Zhoupu01 和 zhoupu01 在手机上几乎分不出来，不能并存。
   exceptId：修改账号时排除它自己。返回占用它的账号（{id, username, display_name}）或 undefined */
function usernameTaken(db, username, exceptId = 0) {
  return db.prepare('SELECT id, username, display_name FROM users WHERE username = ? COLLATE NOCASE AND id <> ?')
    .get(username, exceptId);
}
function takenMessage(u) {
  return `登录账号「${u.username}」已被「${u.display_name}」使用（不区分大小写），请换一个`;
}

/* 账号能不能删：能删返回 null，不能删返回原因。
   只有「还有效的签字」挡住删除：日签、周签、月签都按账号 id 记着是谁签的，账号删了就追溯不到人。
   签字被作废以后（日签字段清空、周签/月签行删除）就不再挡；只勾选、没签字的巡检记录也不挡——
   删除时把这些记录的巡检人关联置空，页面和导出照常显示记录里保存的当时姓名（records.inspector_name）。 */
function deleteBlock(db, id) {
  const day = db.prepare(`SELECT COUNT(*) AS c FROM records WHERE sign_at IS NOT NULL
    AND (sign_user_id = ? OR (sign_user_id IS NULL AND inspector_id = ?))`).get(id, id).c;
  const week = db.prepare('SELECT COUNT(*) AS c FROM week_signs WHERE signed_by = ?').get(id).c;
  const month = db.prepare('SELECT COUNT(*) AS c FROM month_signs WHERE signed_by = ?').get(id).c;
  const parts = [day && `日签 ${day} 条`, week && `周签 ${week} 条`, month && `月签 ${month} 条`].filter(Boolean);
  if (!parts.length) return null;
  return `这个账号还有有效的签字（${parts.join('、')}），删除后这些签字就查不到是谁签的，不能删除。` +
    '确实签错的，先在「周签 / 月签」或「巡检记录」里作废（作废自上而下：月签 → 周签 → 日签），再来删除；不再使用请改为「停用」';
}
/* 删除账号前：解开只勾选未签字的巡检记录里的巡检人关联（外键），姓名快照刷新成账号当前的姓名
   （页面平时显示的就是当前姓名，删掉以后也保持一致，不会变回勾选那天的旧名字） */
function detachRecords(db, id) {
  const u = db.prepare('SELECT display_name FROM users WHERE id = ?').get(id);
  return db.prepare('UPDATE records SET inspector_id = NULL, inspector_name = ? WHERE inspector_id = ?')
    .run(u ? u.display_name : null, id).changes;
}

/* ---------- Excel 批量导入 ---------- */
const ROLE_WORDS = {
  '巡检员': 'inspector', 'inspector': 'inspector',
  '护士长': 'dept', '科室': 'dept', '科室账号': 'dept', 'dept': 'dept',
  '设备科': 'equip', 'equip': 'equip',
};
const ADMIN_WORDS = new Set(['超级管理员', '管理员', 'admin']);
const STATUS_WORDS = { '启用': 'on', '在用': 'on', 'on': 'on', '停用': 'off', '禁用': 'off', 'off': 'off' };
const TPL_HEADER = ['登录账号', '姓名', '角色', '科室', '初始密码', '状态'];
const TPL_WIDTHS = [16, 12, 10, 40, 14, 8];

async function templateXlsx() {
  const db = getDb();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('账号导入');
  ws.addRow(TPL_HEADER).font = { bold: true };
  TPL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  // 账号、密码整列设成文本：001 这类账号开头的 0 不会被 Excel 吃掉
  ws.getColumn(1).numFmt = '@';
  ws.getColumn(5).numFmt = '@';

  const demo = wb.addWorksheet('填写说明（勿改此表）');
  demo.addRow(TPL_HEADER).font = { bold: true };
  TPL_WIDTHS.forEach((w, i) => { demo.getColumn(i + 1).width = w; });
  const names = db.prepare("SELECT name FROM depts WHERE status = 'on' ORDER BY sort, id LIMIT 3").all().map(r => r.name);
  const [d1 = '急诊科', d2 = '重症医学科'] = names;
  demo.addRow(['zhangsan', '张三', '巡检员', `${d1}、${d2}`, '', '启用']);
  demo.addRow(['jz_hsz', '李四', '护士长', d1, 'Abc123456', '启用']);
  demo.addRow(['sbk_wang', '王五', '设备科', '', '', '启用']);
  demo.addRow([]);
  [
    '说明：请把账号填进第 1 张表「账号导入」，本表仅供参照，导入时不会被读取。',
    '「登录账号」必填，不能有空格，最多 32 个字；不能和系统里已有的账号重复（不区分大小写），表里也不能有两行相同。',
    '「姓名」必填。',
    '「角色」只能填：巡检员 / 护士长 / 设备科。超级管理员不能批量导入，请在页面上单独新建。',
    '「科室」要和「科室管理」里的名称完全一致：巡检员可以填多个，用顿号「、」或逗号隔开；护士长只能填 1 个；设备科管全院，不用填。',
    '「初始密码」选填，至少 6 位；留空由系统随机生成。导入完成后会列出全部账号和初始密码，第一次登录必须改密码。',
    '「状态」选填：启用 / 停用，留空为启用。',
    '只要有一行不符合要求，整张表都不会导入：按提示改好后重新导入即可，不会出现一半导进去、一半没导的情况。',
    '这里只能新增账号；已有账号要改名、改科室，请在「账号管理」里点「编辑」。',
  ].forEach(t => demo.addRow([t]));
  if (names.length) {
    demo.addRow([]);
    demo.addRow(['系统里现有的科室（照抄名称即可）：']);
    db.prepare("SELECT name FROM depts WHERE status = 'on' ORDER BY sort, id").all().forEach(r => demo.addRow(['', '', '', r.name]));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ExcelJS 单元格值 → 字符串（富文本、公式、超链接、数字都要处理，否则会变成 [object Object]） */
function cellVal(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => (t && t.text) || '').join('').trim();
    if (v.result !== undefined) return cellVal(v.result);
    if (v.text != null) return String(v.text).trim();
    return '';
  }
  return String(v).trim();
}
/* 科室名称比较时忽略空格、全角半角括号的差别（「9西急救仪器（1）」和「9西急救仪器(1)」算同一个） */
const looseName = s => String(s).replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').toLowerCase();

/* 解析并校验整张表。返回 { rows:[{row, username, displayName, role, deptIds, deptNames, password, status}], errors:[{row,message}], warnings } */
function checkRows(db, ws) {
  const errors = [], warnings = [], rows = [];
  const hdr = ws.getRow(1);
  const col = (re, fb) => {
    for (let i = 1; i <= Math.max(hdr.cellCount || 0, 6); i++) if (re.test(cellVal(hdr.getCell(i).value))) return i;
    return fb;
  };
  const C = { user: col(/账号/, 1), name: col(/姓名/, 2), role: col(/角色/, 3), dept: col(/科室/, 4), pwd: col(/密码/, 5), status: col(/状态/, 6) };
  const depts = db.prepare('SELECT id, name, status FROM depts').all();
  const byName = new Map(depts.map(d => [d.name, d]));
  const byLoose = new Map();
  for (const d of depts) { const k = looseName(d.name); byLoose.set(k, byLoose.has(k) ? null : d); } // null = 有两个科室只差空格/括号，不能模糊对应
  const seen = new Map(); // 小写账号 → 行号
  let count = 0;
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = i => cellVal(row.getCell(i).value);
    const raw = { user: get(C.user), name: get(C.name), role: get(C.role), dept: get(C.dept), pwd: get(C.pwd), status: get(C.status) };
    if (!Object.values(raw).some(Boolean)) return; // 空行
    count++;
    if (count > MAX_ROWS) { if (count === MAX_ROWS + 1) errors.push({ row: n, message: `一次最多导入 ${MAX_ROWS} 个账号，请分成几张表` }); return; }
    const bad = [];
    const why = usernameProblem(raw.user);
    let username = raw.user;
    if (why) bad.push(why);
    else {
      const k = username.toLowerCase();
      if (seen.has(k)) bad.push(`登录账号「${username}」和第 ${seen.get(k)} 行重复`);
      else seen.set(k, n);
      const t = usernameTaken(db, username);
      if (t) bad.push(`登录账号「${username}」系统里已经有了（${t.display_name}）`);
    }
    if (!raw.name) bad.push('姓名不能为空');
    else if (raw.name.length > NAME_MAX) bad.push(`姓名最多 ${NAME_MAX} 个字`);
    let role = null;
    if (!raw.role) bad.push('角色不能为空，填：巡检员 / 护士长 / 设备科');
    else if (ADMIN_WORDS.has(raw.role.toLowerCase())) bad.push('超级管理员不能批量导入，请在页面上单独新建');
    else if (!(role = ROLE_WORDS[raw.role.toLowerCase()])) bad.push(`角色「${raw.role}」系统不认识，只能填：巡检员 / 护士长 / 设备科`);
    const deptIds = [], deptNames = [];
    const parts = raw.dept.split(/[、，,；;\n\r]+/).map(s => s.trim()).filter(Boolean);
    if (role === 'equip') {
      if (parts.length) warnings.push({ row: n, message: `设备科管全院，填写的科室「${raw.dept}」已忽略` });
    } else if (role) {
      for (const p of parts) {
        const d = byName.get(p) || byLoose.get(looseName(p));
        if (!d) { bad.push(`科室「${p}」系统里没有，名称要和「科室管理」里完全一致`); continue; }
        if (deptIds.includes(d.id)) continue;
        deptIds.push(d.id); deptNames.push(d.name);
        if (d.status === 'off') warnings.push({ row: n, message: `科室「${d.name}」已停用，账号照常导入，但手机上暂时看不到这个科室` });
      }
      if (role === 'inspector' && !parts.length) bad.push('巡检员至少要填 1 个科室');
      if (role === 'dept' && parts.length !== 1) bad.push(parts.length ? '护士长只能填 1 个科室' : '护士长要填所属科室');
    }
    if (raw.pwd && raw.pwd.length < 6) bad.push('初始密码至少 6 位（留空则由系统随机生成）');
    else if (raw.pwd.length > 64) bad.push('初始密码最多 64 位');
    let status = 'on';
    if (raw.status && !(status = STATUS_WORDS[raw.status.toLowerCase()])) bad.push(`状态「${raw.status}」只能填：启用 / 停用（留空为启用）`);
    if (bad.length) { errors.push({ row: n, message: bad.join('；') }); return; }
    rows.push({ row: n, username, displayName: raw.name, role, deptIds, deptNames, password: raw.pwd, status });
  });
  if (!count && !errors.length) errors.push({ row: '-', message: '表里没有账号：请填在第 1 张表「账号导入」里，第 1 行是表头' });
  return { rows, errors, warnings };
}

/* 导入：整张表先全部检查，有任何一行不对就一个都不导入（errors 非空、created=0）；
   全部通过才在一个事务里新增。初始密码留空的随机生成；导入的账号第一次登录必须改密码。
   返回 { created, errors, warnings, accounts:[{username, displayName, role, depts, password, generated, status}] } */
async function importAccounts(buffer) {
  const db = getDb();
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw E.badInput('无法解析 xlsx 文件，请用模板另存为 .xlsx 后再导入'); }
  const ws = wb.worksheets[0];
  if (!ws) throw E.badInput('xlsx 中没有工作表');
  const { rows, errors, warnings } = checkRows(db, ws);
  if (errors.length) return { created: 0, errors, warnings, accounts: [] };
  /* 先在事务外算好密码哈希：bcrypt 每个约 0.1 秒，几百个账号放在事务里同步算会把服务卡住一分钟；
     异步算期间会让出，其他人的请求照常处理 */
  for (const r of rows) {
    r.generated = !r.password;
    r.pwd = r.password || crypto.randomBytes(6).toString('base64url');
    r.hash = await bcrypt.hash(r.pwd, 10);
  }
  const accounts = [];
  db.transaction(() => {
    const ins = db.prepare(`INSERT INTO users (username, password_hash, display_name, role, status, must_change, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)`);
    const link = db.prepare('INSERT OR IGNORE INTO user_depts (user_id, dept_id) VALUES (?, ?)');
    for (const r of rows) {
      // 事务里再查一次：两个人同时导入同一批账号时，第二个不会撞 UNIQUE 变成 500
      const t = usernameTaken(db, r.username);
      if (t) throw E.conflict(`第 ${r.row} 行：${takenMessage(t)}；整张表都没有导入`);
      const now = nowIso();
      const uid = ins.run(r.username, r.hash, r.displayName, r.role, r.status, now, now).lastInsertRowid;
      for (const d of r.deptIds) link.run(uid, d);
      accounts.push({ row: r.row, username: r.username, displayName: r.displayName, role: r.role,
        depts: r.deptNames, password: r.pwd, generated: r.generated, status: r.status });
    }
  })();
  return { created: accounts.length, errors: [], warnings, accounts };
}

module.exports = { usernameProblem, normUsername, usernameTaken, takenMessage, deleteBlock, detachRecords, templateXlsx, importAccounts, USERNAME_MAX };
