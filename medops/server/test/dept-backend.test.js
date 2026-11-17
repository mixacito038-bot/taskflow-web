'use strict';
/* 科室后台：护士长账号登录电脑后台，只看、只管本科室。
   - 本科室：设备增删改查 / 批量 / 导入、签字人增删改、巡检记录、周签月签、统计、导出 都能用
   - 别的科室：读写一律 403，列表里看不到；导入时别科室的行、编码对上别科室设备的行被拒
   - 账号、科室、作废签字、操作日志、历史导入 仍只给设备科
   起一个真实的后端进程测。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const ExcelJS = require('exceljs');

const ROOT = path.join(__dirname, '..');
const PORT = 3295;
const BASE = `http://127.0.0.1:${PORT}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let server, admin, nurse, insp, deptA, deptB, devA, devB, today;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deptbk-'));
const ENV = { ...process.env, DATA_DIR: dir, JWT_SECRET: 'deptbk-test', PORT: String(PORT),
  RL_GLOBAL: '100000', RL_LOGIN: '100000', RL_IP: '0', RL_EXPORT: '100000', LOG_LEVEL: 'silent' };

async function api(method, url, { token, body, form } = {}) {
  const h = { 'x-device-id': 'deptbk-dev' };
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
const ok = (r, msg) => { assert.ok(r.status === 200, `${msg || ''} 期望 200，实际 ${r.status} ${JSON.stringify(r.json)}`); return r.json; };
const no = (r, msg) => assert.equal(r.status, 403, `${msg || ''} 期望 403，实际 ${r.status} ${JSON.stringify(r.json)}`);

async function devicesXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('设备导入');
  ws.addRow(['科室名称', '设备品类', '设备编码', '设备名称', '型号', '位置', '状态', '有效期', '提醒提前天数', '序列号']);
  rows.forEach(r => ws.addRow(r));
  const fd = new FormData();
  fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'd.xlsx');
  return fd;
}

test.before(async () => {
  execFileSync('node', ['src/scripts/create-admin.js', 'admin', 'admin123'], { cwd: ROOT, env: ENV });
  server = spawn('node', ['src/index.js'], { cwd: ROOT, stdio: 'ignore', env: ENV });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  admin = ok(await login('admin', 'admin123')).accessToken;
  deptA = ok(await api('POST', '/api/admin/depts', { token: admin, body: { name: '急诊科' } })).id;
  deptB = ok(await api('POST', '/api/admin/depts', { token: admin, body: { name: '重症医学科' } })).id;
  devA = ok(await api('POST', '/api/admin/devices', { token: admin,
    body: { deptId: deptA, catName: '除颤仪', code: 'JZ-001', name: '除颤监护仪', serial: 'SN-A1' } })).id;
  devB = ok(await api('POST', '/api/admin/devices', { token: admin,
    body: { deptId: deptB, catName: '呼吸机', code: 'ICU-001', name: '有创呼吸机', serial: 'SN-B1' } })).id;
  ok(await api('POST', '/api/admin/members', { token: admin, body: { deptId: deptB, name: '别科室签字人' } }));
  for (const [u, role, d] of [['hsz01', 'dept', [deptA]], ['xj01', 'inspector', [deptA]], ['xj02', 'inspector', [deptB]]]) {
    ok(await api('POST', '/api/admin/users', { token: admin, body: { username: u, password: 'pass123', displayName: u, role, deptIds: d } }));
  }
  nurse = ok(await login('hsz01', 'pass123')).accessToken;
  insp = ok(await login('xj01', 'pass123')).accessToken;
  today = ok(await api('GET', '/api/time', { token: admin })).date;
  // 两个科室今天各有一条签好的巡检记录（别科室的用来测看不到）
  const insp2 = ok(await login('xj02', 'pass123')).accessToken;
  for (const [t, d, v] of [[insp, deptA, devA], [insp2, deptB, devB]]) {
    ok(await api('PUT', `/api/records/${d}/${today}`, { token: t, body: { checks: { [v]: 'ng' }, notes: { [v]: '电池鼓包' } } }));
    ok(await api('POST', `/api/records/${d}/${today}/sign`, { token: t, body: { name: '巡检员', title: '护士', opinion: '有异常', dataUrl: PNG } }));
  }
});
test.after(() => { if (server) server.kill(); });

test('护士长：/api/depts 只返回本科室', async () => {
  const list = ok(await api('GET', '/api/depts', { token: nurse }));
  assert.deepEqual(list.map(d => String(d.id)), [String(deptA)]);
});

test('护士长：设备台账只看得到本科室；按别的科室查 403', async () => {
  const list = ok(await api('GET', '/api/admin/devices', { token: nurse }));
  assert.deepEqual(list.map(d => String(d.id)), [String(devA)]);
  no(await api('GET', `/api/admin/devices?deptId=${deptB}`, { token: nurse }));
  assert.equal(ok(await api('GET', `/api/admin/devices?deptId=${deptA}`, { token: nurse })).length, 1);
});

test('护士长：本科室设备能增、改（含有效期）、删；别科室的一律 403', async () => {
  const d = ok(await api('POST', '/api/admin/devices', { token: nurse,
    body: { deptId: deptA, catName: '吸引器', code: 'JZ-002', name: '电动吸引器', expiryDate: '2027-01-31', remindDays: 15 } }));
  const after = ok(await api('PATCH', `/api/admin/devices/${d.id}`, { token: nurse, body: { location: '抢救室', expiryDate: '2027-02-28' } }));
  assert.equal(after.location, '抢救室');
  assert.equal(after.expiryDate, '2027-02-28');
  ok(await api('DELETE', `/api/admin/devices/${d.id}`, { token: nurse }));

  no(await api('POST', '/api/admin/devices', { token: nurse, body: { deptId: deptB, catName: '呼吸机', code: 'X-1', name: '偷偷加的' } }), '给别科室加设备');
  no(await api('PATCH', `/api/admin/devices/${devB}`, { token: nurse, body: { name: '改别人的' } }), '改别科室设备');
  no(await api('DELETE', `/api/admin/devices/${devB}`, { token: nurse }), '删别科室设备');
  no(await api('PATCH', `/api/admin/devices/${devA}`, { token: nurse, body: { deptId: deptB } }), '把本科室设备调到别科室');
  no(await api('POST', '/api/admin/devices/batch', { token: nurse, body: { ids: [devA, devB], action: 'status', status: 'retired' } }), '批量里夹带别科室设备');
  // 上面这些都没改动到
  const b = ok(await api('GET', `/api/admin/devices?deptId=${deptB}`, { token: admin }))[0];
  assert.equal(b.name, '有创呼吸机');
  assert.equal(b.status, 'in_use');
  const a = ok(await api('GET', `/api/admin/devices?deptId=${deptA}`, { token: admin })).find(x => String(x.id) === String(devA));
  assert.equal(String(a.deptId), String(deptA));
  assert.equal(a.status, 'in_use');
  // 只含本科室设备的批量可以
  const x = ok(await api('POST', '/api/admin/devices', { token: nurse, body: { deptId: deptA, catName: '监护仪', code: 'JZ-003', name: '监护仪' } }));
  const res = ok(await api('POST', '/api/admin/devices/batch', { token: nurse, body: { ids: [x.id], action: 'status', status: 'retired' } }));
  assert.equal(res.updated.length, 1);
});

test('护士长：导入只认本科室的行；编码 / 序列号对上别科室设备的行被拒', async () => {
  const tpl = await api('GET', '/api/admin/devices/import-template', { token: nurse });
  assert.equal(tpl.status, 200);
  const form = await devicesXlsx([
    ['急诊科', '简易呼吸器', 'JZ-010', '简易呼吸器（成人）', '', '抢救室', '在用', '', '', ''],
    ['重症医学科', '呼吸机', 'ICU-099', '别科室的设备', '', '', '在用', '', '', ''],
    ['急诊科', '呼吸机', 'ICU-001', '借编码改走别科室设备', '', '', '在用', '', '', ''],
    ['急诊科', '呼吸机', '/', '借序列号改走别科室设备', '', '', '在用', '', '', 'SN-B1'],
  ]);
  const out = ok(await api('POST', '/api/admin/devices/import', { token: nurse, form }));
  assert.equal(out.created, 1, JSON.stringify(out));
  assert.equal(out.updated, 0, JSON.stringify(out));
  assert.equal(out.errors.length, 3, JSON.stringify(out));
  assert.match(out.errors.find(e => e.row === 3).message, /不是本科室/);
  assert.match(out.errors.find(e => e.row === 4).message, /重症医学科/);
  assert.match(out.errors.find(e => e.row === 5).message, /重症医学科/);
  const b = ok(await api('GET', `/api/admin/devices?deptId=${deptB}`, { token: admin }));
  assert.deepEqual(b.map(v => v.name), ['有创呼吸机'], '别科室的设备一台没动');
  // 设备科导入不受限制
  const out2 = ok(await api('POST', '/api/admin/devices/import', { token: admin, form: await devicesXlsx([
    ['重症医学科', '呼吸机', 'ICU-002', '无创呼吸机', '', '', '在用', '', '', ''],
  ]) }));
  assert.equal(out2.created, 1);
});

test('护士长：签字人名单只管本科室', async () => {
  const m = ok(await api('POST', '/api/admin/members', { token: nurse, body: { deptId: deptA, name: '王护士', title: '护士' } }));
  ok(await api('PATCH', `/api/admin/members/${m.id}`, { token: nurse, body: { title: '主管护师' } }));
  const list = ok(await api('GET', '/api/admin/members', { token: nurse }));
  assert.ok(list.every(x => String(x.deptId) === String(deptA)), '看不到别科室的签字人');
  assert.ok(list.some(x => x.name === '王护士'));
  const other = ok(await api('GET', `/api/admin/members?deptId=${deptB}`, { token: admin }))[0];
  no(await api('GET', `/api/admin/members?deptId=${deptB}`, { token: nurse }));
  no(await api('POST', '/api/admin/members', { token: nurse, body: { deptId: deptB, name: '加到别科室' } }));
  no(await api('PATCH', `/api/admin/members/${other.id}`, { token: nurse, body: { title: '改别人的' } }));
  no(await api('DELETE', `/api/admin/members/${other.id}`, { token: nurse }));
  ok(await api('DELETE', `/api/admin/members/${m.id}`, { token: nurse }));
});

test('护士长：巡检记录、异常清单、统计只含本科室；别科室的记录 403', async () => {
  const recs = ok(await api('GET', `/api/records?from=${today}&to=${today}`, { token: nurse }));
  assert.ok(recs.length >= 1);
  assert.ok(recs.every(r => String(r.deptId) === String(deptA)));
  const rec = ok(await api('GET', `/api/records/${deptA}/${today}`, { token: nurse }));
  assert.equal(rec.deviceInfo[String(devA)].code, 'JZ-001', '明细里带上设备编码名称');
  no(await api('GET', `/api/records/${deptB}/${today}`, { token: nurse }));
  no(await api('GET', `/api/records?deptId=${deptB}&from=${today}&to=${today}`, { token: nurse }));

  const ng = ok(await api('GET', `/api/stats/ng?from=${today}&to=${today}`, { token: nurse }));
  assert.equal(ng.length, 1);
  assert.equal(String(ng[0].deptId), String(deptA));
  no(await api('GET', `/api/stats/ng?deptId=${deptB}`, { token: nurse }));
  const month = today.slice(0, 7);
  const comp = ok(await api('GET', `/api/stats/completion?month=${month}`, { token: nurse }));
  assert.ok(comp.every(r => String(r.deptId) === String(deptA)), JSON.stringify(comp));
  no(await api('GET', `/api/stats/completion?month=${month}&deptId=${deptB}`, { token: nurse }));
  ok(await api('GET', '/api/stats/unsigned', { token: nurse }));
  ok(await api('GET', `/api/stats/signatures?month=${month}`, { token: nurse }));
  ok(await api('GET', '/api/weeksigns', { token: nurse }));
  ok(await api('GET', '/api/monthsigns', { token: nurse }));
  no(await api('GET', `/api/weeksigns?deptId=${deptB}`, { token: nurse }));
});

test('护士长：导出月报、异常清单只能本科室', async () => {
  const month = today.slice(0, 7);
  const m = await api('GET', `/api/export/monthly.xlsx?deptId=${deptA}&month=${month}`, { token: nurse });
  assert.equal(m.status, 200);
  no(await api('GET', `/api/export/monthly.xlsx?deptId=${deptB}&month=${month}`, { token: nurse }));
  no(await api('GET', `/api/export/ng.xlsx?deptId=${deptB}`, { token: nurse }));
  // 不指定科室：表里只有本科室的异常
  const r = await api('GET', `/api/export/ng.xlsx?from=${today}&to=${today}`, { token: nurse });
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.buf);
  const ws = wb.worksheets[0];
  const depts = [];
  ws.eachRow((row, i) => { if (i > 1 && row.getCell(2).value) depts.push(row.getCell(2).value); });
  assert.deepEqual(depts, ['急诊科']);
});

test('护士长：账号、科室、作废签字、操作日志、历史导入 仍然不行', async () => {
  no(await api('GET', '/api/admin/users', { token: nurse }));
  no(await api('POST', '/api/admin/users', { token: nurse, body: { username: 'x1', password: 'pass123', displayName: 'x', role: 'inspector', deptIds: [deptA] } }));
  no(await api('GET', '/api/admin/depts', { token: nurse }));
  no(await api('POST', '/api/admin/depts', { token: nurse, body: { name: '新科室' } }));
  no(await api('POST', '/api/admin/signs/void', { token: nurse, body: { type: 'day', deptId: deptA, key: today, reason: '测试' } }));
  no(await api('GET', '/api/admin/oplog', { token: nurse }));
  no(await api('GET', '/api/admin/oplog/export.xlsx', { token: nurse }));
  no(await api('POST', '/api/admin/import/legacy?dryRun=1', { token: nurse, body: {} }));
  no(await api('GET', '/api/ams/snapshot', { token: nurse }));
  // 日签还在（没被作废）
  assert.ok(ok(await api('GET', `/api/records/${deptA}/${today}`, { token: nurse })).sign);
});

test('巡检员：电脑后台的接口一个都不行', async () => {
  no(await api('GET', '/api/admin/devices', { token: insp }));
  no(await api('POST', '/api/admin/devices', { token: insp, body: { deptId: deptA, catName: 'a', code: 'Z-1', name: 'b' } }));
  no(await api('GET', '/api/admin/members', { token: insp }));
  no(await api('GET', `/api/export/monthly.xlsx?deptId=${deptA}&month=${today.slice(0, 7)}`, { token: insp }));
});

test('操作日志：护士长的改动记在他名下，设备科能看到', async () => {
  const log = ok(await api('GET', '/api/admin/oplog?module=设备&size=0', { token: admin }));
  const mine = log.items.filter(x => x.username === 'hsz01');
  assert.ok(mine.some(x => x.op === '新增'), JSON.stringify(mine.map(x => x.op)));
  assert.ok(mine.some(x => x.op === '修改'));
  assert.ok(mine.some(x => x.op === '批量导入'));
  assert.ok(mine.every(x => x.userRole === 'dept'));
});
