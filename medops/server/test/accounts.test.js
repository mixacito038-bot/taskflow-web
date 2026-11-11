'use strict';
/* 账号：改登录账号（判重不分大小写、不能有空格）、删除（确认规则 + 用过的不能删）、Excel 批量导入（模板 + 整表校验）。
   起一个真实的后端进程测。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const PORT = 3293;
const BASE = `http://127.0.0.1:${PORT}`;
let server, admin, deptA, deptB;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
const ENV = { ...process.env, DATA_DIR: dir, JWT_SECRET: 'acc-test', PORT: String(PORT),
  RL_GLOBAL: '100000', RL_LOGIN: '100000', RL_IP: '0', LOG_LEVEL: 'silent' };

async function api(method, url, { token, body, form } = {}) {
  const h = { 'x-device-id': 'acc-dev' };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const res = await fetch(BASE + url, { method, headers: h, body: payload });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString()); } catch { /* 文件 */ }
  return { status: res.status, json, buf };
}
const login = async (username, password) => (await api('POST', '/api/auth/login', { body: { username, password } }));
const mk = async (username, role, deptIds = [], password = 'pass123') =>
  api('POST', '/api/admin/users', { token: admin, body: { username, password, displayName: username, role, deptIds } });

async function xlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('账号导入');
  ws.addRow(['登录账号', '姓名', '角色', '科室', '初始密码', '状态']);
  rows.forEach(r => ws.addRow(r));
  const fd = new FormData();
  fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'a.xlsx');
  return fd;
}
const upload = async rows => api('POST', '/api/admin/users/import', { token: admin, form: await xlsx(rows) });
const users = async () => (await api('GET', '/api/admin/users', { token: admin })).json;

test.before(async () => {
  execFileSync('node', ['src/scripts/create-admin.js', 'admin', 'admin123'], { cwd: ROOT, env: ENV });
  server = spawn('node', ['src/index.js'], { cwd: ROOT, stdio: 'ignore', env: ENV });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  admin = (await login('admin', 'admin123')).json.accessToken;
  deptA = (await api('POST', '/api/admin/depts', { token: admin, body: { name: '急诊科' } })).json.id;
  deptB = (await api('POST', '/api/admin/depts', { token: admin, body: { name: '9西急救仪器（1）' } })).json.id;
});
test.after(() => { if (server) server.kill(); });

test('新建：账号判重不分大小写、不能有空格', async () => {
  assert.equal((await mk('zhoupu01', 'inspector', [deptA])).status, 200);
  const dup = await mk('ZHOUPU01', 'inspector', [deptA]);
  assert.equal(dup.status, 409);
  assert.match(dup.json.error.message, /已被/);
  assert.equal((await mk('zhou pu', 'inspector', [deptA])).status, 400);
  assert.equal((await mk('   ', 'inspector', [deptA])).status, 400);
});

test('编辑：可以改登录账号，判重、用新账号登录、旧账号登录不了', async () => {
  const a = (await mk('old_name', 'inspector', [deptA])).json;
  await mk('taken', 'inspector', [deptA]);
  const conflict = await api('PATCH', `/api/admin/users/${a.id}`, { token: admin, body: { username: 'Taken' } });
  assert.equal(conflict.status, 409, '和别的账号重复（不分大小写）');
  assert.equal((await api('PATCH', `/api/admin/users/${a.id}`, { token: admin, body: { username: 'new name' } })).status, 400);
  // 先登录一次拿到 refreshToken：改账号名后登录状态应保留
  const before = (await login('old_name', 'pass123')).json;
  const ok = await api('PATCH', `/api/admin/users/${a.id}`, { token: admin, body: { username: '  new_name ', displayName: '新名字' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.username, 'new_name');
  assert.equal(ok.json.displayName, '新名字');
  assert.equal((await login('old_name', 'pass123')).status, 401, '旧账号名登录不了');
  assert.equal((await login('new_name', 'pass123')).status, 200, '新账号名、原密码能登录');
  const r = await api('POST', '/api/auth/refresh', { body: { refreshToken: before.refreshToken } });
  assert.equal(r.status, 200, '改名前的登录状态还在');
  assert.equal(r.json.user.username, 'new_name', '刷新后拿到新账号名（手机端据此更新「记住的账号」）');
  // 只改大小写也算改名，不算和自己重复
  assert.equal((await api('PATCH', `/api/admin/users/${a.id}`, { token: admin, body: { username: 'New_Name' } })).json.username, 'New_Name');
  // 设备科不能改管理员账号
  const equip = (await mk('equip_x', 'equip')).json;
  const et = (await login('equip_x', 'pass123')).json.accessToken;
  const adminId = (await users()).find(u => u.username === 'admin').id;
  assert.equal((await api('PATCH', `/api/admin/users/${adminId}`, { token: et, body: { username: 'admin2' } })).status, 403);
  assert.ok(equip.id);
});

test('删除：确认规则；用过的账号不能删，可以停用', async () => {
  const x = (await mk('del_me', 'inspector', [deptA])).json;
  const tok = (await login('del_me', 'pass123')).json;
  assert.equal((await api('DELETE', `/api/admin/users/${x.id}`, { token: admin })).status, 200);
  assert.ok(!(await users()).some(u => u.username === 'del_me'));
  assert.equal((await api('GET', '/api/time', { token: tok.accessToken })).status, 401, '删了以后原来的登录立即失效');
  assert.equal((await api('POST', '/api/auth/refresh', { body: { refreshToken: tok.refreshToken } })).status, 401);
  assert.equal((await api('DELETE', `/api/admin/users/${x.id}`, { token: admin })).status, 404, '重复删除');
  // 删了以后同名账号可以重新建
  assert.equal((await mk('del_me', 'inspector', [deptA])).status, 200);

  // 不能删自己；设备科不能删管理员
  const adminId = (await users()).find(u => u.username === 'admin').id;
  assert.equal((await api('DELETE', `/api/admin/users/${adminId}`, { token: admin })).status, 400);
  await mk('equip_y', 'equip');
  const et = (await login('equip_y', 'pass123')).json.accessToken;
  assert.equal((await api('DELETE', `/api/admin/users/${adminId}`, { token: et })).status, 403);

  // 有巡检记录的账号：409，原因写清楚；停用照常
  const dev = (await api('POST', '/api/admin/devices', { token: admin, body: { deptId: deptA, catName: '除颤仪', code: 'JZ-1', name: '除颤仪' } })).json.id;
  const u = (await mk('used_insp', 'inspector', [deptA])).json;
  const ut = (await login('used_insp', 'pass123')).json.accessToken;
  const today = (await api('GET', '/api/time', { token: ut })).json.date;
  assert.equal((await api('PUT', `/api/records/${deptA}/${today}`, { token: ut, body: { checks: { [dev]: 'ok' } } })).status, 200);
  const blocked = await api('DELETE', `/api/admin/users/${u.id}`, { token: admin });
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error.message, /停用/);
  assert.equal((await api('PATCH', `/api/admin/users/${u.id}`, { token: admin, body: { status: 'off' } })).json.status, 'off');
});

test('导入模板能下载，是 xlsx，第 1 张表是表头', async () => {
  const r = await api('GET', '/api/admin/users/import-template', { token: admin });
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.buf);
  assert.deepEqual(wb.worksheets[0].getRow(1).values.slice(1), ['登录账号', '姓名', '角色', '科室', '初始密码', '状态']);
  assert.ok(wb.worksheets[1].name.includes('说明'));
});

test('导入：有一行不对就整表不导入，逐行说明', async () => {
  const n0 = (await users()).length;
  const r = await upload([
    ['imp_ok', '正常', '巡检员', '急诊科', '', ''],
    ['IMP_OK', '表内重复', '巡检员', '急诊科', '', ''],
    ['zhoupu01', '和系统重复', '巡检员', '急诊科', '', ''],
    ['has space', '有空格', '巡检员', '急诊科', '', ''],
    ['imp_r', '角色不对', '主任', '急诊科', '', ''],
    ['imp_adm', '管理员', '超级管理员', '', '', ''],
    ['imp_d', '科室不存在', '巡检员', '不存在科', '', ''],
    ['imp_n', '护士长两个科室', '护士长', '急诊科、9西急救仪器（1）', '', ''],
    ['imp_n2', '护士长没科室', '护士长', '', '', ''],
    ['imp_i', '巡检员没科室', '巡检员', '', '', ''],
    ['imp_p', '密码太短', '巡检员', '急诊科', '123', ''],
    ['imp_s', '状态不对', '巡检员', '急诊科', '', '正常'],
    ['', '没账号', '巡检员', '急诊科', '', ''],
    ['imp_nm', '', '巡检员', '急诊科', '', ''],
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.json.created, 0);
  const msg = Object.fromEntries(r.json.errors.map(e => [e.row, e.message]));
  assert.match(msg[3], /和第 2 行重复/);
  assert.match(msg[4], /已经有了/);
  assert.match(msg[5], /空格/);
  assert.match(msg[6], /不认识/);
  assert.match(msg[7], /超级管理员不能批量导入/);
  assert.match(msg[8], /系统里没有/);
  assert.match(msg[9], /只能填 1 个/);
  assert.match(msg[10], /护士长要填/);
  assert.match(msg[11], /至少要填 1 个科室/);
  assert.match(msg[12], /至少 6 位/);
  assert.match(msg[13], /状态/);
  assert.match(msg[14], /登录账号不能为空/);
  assert.match(msg[15], /姓名不能为空/);
  assert.ok(!msg[2], '第 2 行本身没问题');
  assert.equal((await users()).length, n0, '一个都没导入');
});

test('导入：全部通过才导入；随机密码、首次登录必须改密；科室名容忍空格和全角括号', async () => {
  const r = await upload([
    ['imp_a', '张三', '巡检员', '急诊科，9西急救仪器(1)', '', ''],
    ['imp_b', '李四', '护士长', ' 急诊科 ', 'Abc12345', '启用'],
    ['imp_c', '王五', '设备科', '急诊科', '', '停用'],
    [],
  ]);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.created, 3);
  assert.deepEqual(r.json.errors, []);
  const a = r.json.accounts.find(x => x.username === 'imp_a');
  assert.ok(a.generated && a.password.length >= 8);
  assert.deepEqual(a.depts, ['急诊科', '9西急救仪器（1）']);
  assert.equal(r.json.accounts.find(x => x.username === 'imp_b').password, 'Abc12345');
  assert.ok(r.json.warnings.some(w => w.row === 4 && /全院/.test(w.message)), '设备科填了科室：提示已忽略');
  const list = await users();
  const ua = list.find(u => u.username === 'imp_a');
  assert.equal(ua.role, 'inspector');
  assert.equal(ua.mustChange, true);
  assert.deepEqual(ua.deptIds.sort(), [deptA, deptB].sort());
  assert.equal(list.find(u => u.username === 'imp_c').status, 'off');
  const l = await login('imp_a', a.password);
  assert.equal(l.status, 200);
  assert.equal(l.json.user.mustChange, true);
  // 同一张表再导一次：全部报「已经有了」，不会重复新增
  const again = await upload([['imp_a', '张三', '巡检员', '急诊科', '', '']]);
  assert.equal(again.json.created, 0);
  assert.match(again.json.errors[0].message, /已经有了/);
});

test('导入：空表、坏文件给出提示', async () => {
  const empty = await upload([]);
  assert.equal(empty.json.created, 0);
  assert.match(empty.json.errors[0].message, /没有账号/);
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('not a xlsx')]), 'a.xlsx');
  const bad = await api('POST', '/api/admin/users/import', { token: admin, form: fd });
  assert.equal(bad.status, 400);
});
