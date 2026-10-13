'use strict';
/* 回归测试：覆盖 2026-10 用户实测报出的问题，每个场景都按「业务规则」断言。
   起服务(:3110, 临时 DATA_DIR) → 造数据 → 逐项验证。全部通过输出 REGRESS PASS。
   用法：node scripts/regress.js

   覆盖：
   1. 改名同步：科室名 / 巡检员账号名 / 签字人名单姓名 / 设备科账号名，改名后
      记录、周签、月签、异常清单、签字人工作量、月报导出全部显示新名字
   2. 签字人身份由服务端认定：日签/月签取登录账号，周签必须是本科室名单内的在用成员
   3. 作废必须自上而下：周签还在时不能作废其中一天的日签；月签还在时不能作废其中的周签
   4. 有签字历史的签字人可以从名单删除，历史签字按签字当时的名字显示 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const ExcelJS = require('exceljs');
const P = require('../src/services/period.service');

const PORT = 3110;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'medops-regress-'));
const ENV = { ...process.env, PORT: String(PORT), DATA_DIR, JWT_SECRET: 'regress-secret',
  RL_GLOBAL: '100000', RL_LOGIN: '100000', LOG_LEVEL: 'silent' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let server = null;
let step = '';
const ok = m => console.log('  ✓', m);

async function api(method, url, { token, body, raw } = {}) {
  const h = { 'x-device-id': 'regress-dev' };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (raw) return res;
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text };
}
const okj = (r, msg) => { assert.ok(r.status >= 200 && r.status < 300, `${msg || step}：期望成功，实际 ${r.status} ${r.text}`); return r.json; };
const errj = (r, status, code, msg) => {
  assert.equal(r.status, status, `${msg || step}：期望 ${status}，实际 ${r.status} ${r.text}`);
  assert.equal(r.json && r.json.error && r.json.error.code, code, `${msg || step}：期望 ${code}，实际 ${r.text}`);
  return r.json.error;
};

async function startServer() {
  require('child_process').execFileSync('node', ['src/scripts/create-admin.js', 'admin', 'Admin@123'],
    { cwd: ROOT, env: ENV, stdio: 'ignore' });
  server = spawn('node', ['src/index.js'], { cwd: ROOT, env: ENV, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; server.stderr.on('data', d => { err += d; });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('服务没起来：' + err);
}

async function xlsxRows(res, sheetName) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const out = [];
  wb.getWorksheet(sheetName).eachRow(r => out.push(r.values.slice(1).map(v => (v == null ? '' : String(v)))));
  return out;
}

async function main() {
  await startServer();
  ok(`服务已启动 :${PORT}`);
  const login = async (u, p = 'Pass@123') => okj(await api('POST', '/api/auth/login', { body: { username: u, password: p } }), `登录 ${u}`).accessToken;
  const A = await login('admin', 'Admin@123');
  const today = okj(await api('GET', '/api/time', { token: A })).date;

  step = '造数据';
  const dept = okj(await api('POST', '/api/admin/depts', { token: A, body: { name: '科室2' } }));
  const dev1 = okj(await api('POST', '/api/admin/devices', { token: A, body: { deptId: dept.id, catName: '生命监护类', code: 'LD-001', name: '心电监护仪' } }));
  const dev2 = okj(await api('POST', '/api/admin/devices', { token: A, body: { deptId: dept.id, catName: '生命监护类', code: 'LD-002', name: '心电监护仪' } }));
  const member = okj(await api('POST', '/api/admin/members', { token: A, body: { deptId: dept.id, name: '科室2', title: '' } }));
  const insp = okj(await api('POST', '/api/admin/users', { token: A, body: { username: 'pjt', password: 'Pass@123', displayName: '潘金婷', role: 'inspector', deptIds: [dept.id] } }));
  okj(await api('POST', '/api/admin/users', { token: A, body: { username: 'hn2', password: 'Pass@123', displayName: '科室2', role: 'dept', deptIds: [dept.id] } }));
  const equip = okj(await api('POST', '/api/admin/users', { token: A, body: { username: 'sbk', password: 'Pass@123', displayName: '设备科', role: 'equip', deptIds: [] } }));
  const I = await login('pjt'), N = await login('hn2'), Q = await login('sbk');
  ok('科室2 / 2 台设备 / 签字人「科室2」/ 巡检员潘金婷 / 护士长账号 / 设备科账号');

  // 找最近一个「全部周都已结束」的月份，整月走完三级签字
  let M = P.prevMonth(P.moOf(today));
  while (!P.wksOfMonth(M).every(w => P.addDay(w, 6) < today)) M = P.prevMonth(M);
  const wks = P.wksOfMonth(M);
  const day = async d => {
    okj(await api('PUT', `/api/records/${dept.id}/${d}`, { token: I, body: { checks: { [dev1.id]: 'ok', [dev2.id]: 'ng' }, notes: { [dev2.id]: '电池不蓄电' } } }), `巡检 ${d}`);
    okj(await api('POST', `/api/records/${dept.id}/${d}/sign`, { token: I, body: { name: '随便写', title: '巡检员', dataUrl: PNG } }), `日签 ${d}`);
  };
  for (const w of wks) {
    for (const d of P.wkDays(w)) await day(d);
    okj(await api('POST', `/api/weeksigns/${dept.id}/${w}/sign`, { token: N, body: { memberId: member.id, dataUrl: PNG } }), `周签 ${w}`);
  }
  okj(await api('POST', `/api/monthsigns/${dept.id}/${M}/sign`, { token: Q, body: { name: '随便写', dataUrl: PNG } }), `月签 ${M}`);
  ok(`${M} 整月（${wks.length} 周）日签→周签→月签走通`);

  step = '签字人身份由服务端认定';
  let rec = okj(await api('GET', `/api/records/${dept.id}/${wks[0]}`, { token: A }));
  assert.equal(rec.sign.name, '潘金婷', '日签人应为登录的巡检员本人，不能用前端传的「随便写」');
  let ms = okj(await api('GET', `/api/monthsigns?deptId=${dept.id}`, { token: A }));
  assert.equal(ms[0].sign.name, '设备科', '月签人应为登录的设备科账号');
  ok('日签人 = 登录巡检员（忽略前端传的名字）；月签人 = 登录设备科账号');

  const thisWeek = P.wkOf(today), lastWeek = P.addDay(thisWeek, -7);
  if (!wks.includes(lastWeek)) {
    for (const d of P.wkDays(lastWeek)) await day(d);
    errj(await api('POST', `/api/weeksigns/${dept.id}/${lastWeek}/sign`, { token: N, body: { name: '路人甲', dataUrl: PNG } }), 400, 'BAD_INPUT', '名单外的人周签');
    errj(await api('POST', `/api/weeksigns/${dept.id}/${lastWeek}/sign`, { token: N, body: { dataUrl: PNG } }), 400, 'BAD_INPUT', '不选签字人周签');
    const off = okj(await api('POST', '/api/admin/members', { token: A, body: { deptId: dept.id, name: '已离职', title: '护士长' } }));
    okj(await api('PATCH', `/api/admin/members/${off.id}`, { token: A, body: { name: '已离职', title: '护士长', status: 'off', sort: 0 } }));
    errj(await api('POST', `/api/weeksigns/${dept.id}/${lastWeek}/sign`, { token: N, body: { memberId: off.id, dataUrl: PNG } }), 400, 'BAD_INPUT', '停用的签字人周签');
    ok('周签：名单外的人 / 未选签字人 / 已停用的签字人 → 全部拒绝');
  } else ok('上周与月签用例重叠，跳过名单校验分支（其余用例已覆盖）');

  step = '改名同步';
  okj(await api('PATCH', `/api/admin/depts/${dept.id}`, { token: A, body: { name: '六东护理抢救室' } }), '改科室名');
  okj(await api('PATCH', `/api/admin/users/${insp.id}`, { token: A, body: { displayName: '潘金婷（护师）' } }), '改巡检员显示名');
  okj(await api('PATCH', `/api/admin/members/${member.id}`, { token: A, body: { name: '王护士长', title: '护士长', status: 'on', sort: 0 } }), '改签字人姓名');
  okj(await api('PATCH', `/api/admin/users/${equip.id}`, { token: A, body: { displayName: '设备科·杨潇' } }), '改设备科显示名');

  rec = okj(await api('GET', `/api/records/${dept.id}/${wks[0]}`, { token: A }));
  assert.equal(rec.inspectorName, '潘金婷（护师）', '巡检记录的巡检人应显示新名字');
  assert.equal(rec.sign.name, '潘金婷（护师）', '日签人应显示新名字');
  const recs = okj(await api('GET', `/api/records?deptId=${dept.id}&from=${M}-01&to=${M}-31`, { token: A }));
  assert.ok(recs.every(x => x.inspectorName === '潘金婷（护师）' && x.sign.name === '潘金婷（护师）'), '记录列表应全部显示新名字');
  const ws = okj(await api('GET', `/api/weeksigns?deptId=${dept.id}&from=${wks[0]}&to=${wks[wks.length - 1]}`, { token: A }));
  assert.ok(ws.length === wks.length && ws.every(x => x.sign.name === '王护士长' && x.sign.title === '护士长'), '周签人应显示签字人名单里的新名字');
  ms = okj(await api('GET', `/api/monthsigns?deptId=${dept.id}`, { token: A }));
  assert.equal(ms[0].sign.name, '设备科·杨潇', '月签人应显示新名字');
  const depts = okj(await api('GET', '/api/depts', { token: A }));
  assert.equal(depts.find(d => d.id === dept.id).name, '六东护理抢救室');
  const ng = okj(await api('GET', `/api/stats/ng?from=${M}-01&to=${M}-31`, { token: A }));
  assert.ok(ng.length > 0 && ng.every(x => x.deptName === '六东护理抢救室' && x.inspectorName === '潘金婷（护师）'), '异常清单的科室、巡检人应显示新名字');
  const sg = okj(await api('GET', `/api/stats/signatures?month=${M}`, { token: A })).filter(x => x.deptId === dept.id);
  const byName = Object.fromEntries(sg.map(x => [x.name, x]));
  assert.deepEqual(Object.keys(byName).sort(), ['潘金婷（护师）', '王护士长', '设备科·杨潇'].sort(), '签字人工作量：改名后每人仍只有一行、显示新名字');
  // 日签按日期所在的自然月计数（与月报、完成率口径一致）；最后一周可能跨到下个月
  const daysInM = wks.flatMap(w => P.wkDays(w)).filter(d => P.moOf(d) === M).length;
  assert.equal(byName['潘金婷（护师）'].daySigns, daysInM);
  assert.equal(byName['王护士长'].weekSigns, wks.length);
  assert.equal(byName['设备科·杨潇'].monthSigns, 1);
  assert.ok(sg.every(x => x.deptName === '六东护理抢救室'));
  const comp = okj(await api('GET', `/api/stats/completion?month=${M}`, { token: A })).find(x => x.deptId === dept.id);
  assert.equal(comp.deptName, '六东护理抢救室');
  ok('记录 / 周签 / 月签 / 异常清单 / 签字人工作量 / 完成率：全部显示新名字，且改名不会把同一人拆成两行');

  step = '月报导出显示新名字';
  let res = await api('GET', `/api/export/monthly.xlsx?deptId=${dept.id}&month=${M}`, { token: Q, raw: true });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  const load = async name => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    const out = []; wb.getWorksheet(name).eachRow(r => out.push(r.values.slice(1).map(v => (v == null ? '' : String(v))))); return out; };
  const title = (await load('巡检记录'))[0][0];
  assert.ok(title.includes('六东护理抢救室'), '月报标题应为新科室名：' + title);
  const signRows = await load('签字');
  assert.ok(signRows.filter(r => r[0] === '日签').every(r => r[2] === '潘金婷（护师）'), '月报日签人应为新名字');
  assert.ok(signRows.filter(r => r[0] === '周签').every(r => r[2] === '王护士长'), '月报周签人应为新名字');
  assert.ok(signRows.filter(r => r[0] === '月签').every(r => r[2] === '设备科·杨潇'), '月报月签人应为新名字');
  assert.ok((await load('异常清单')).slice(1).every(r => r[5] === '潘金婷（护师）'), '月报异常清单巡检员应为新名字');
  res = await api('GET', `/api/export/ng.xlsx?from=${M}-01&to=${M}-31`, { token: Q, raw: true });
  const ngRows = await xlsxRows(res, '异常清单');
  assert.ok(ngRows.slice(1).every(r => r[1] === '六东护理抢救室' && r[6] === '潘金婷（护师）'), '异常清单导出应为新名字');
  ok('月报（标题/日周月签字人/异常清单）与异常清单导出：全部是新名字');

  step = '作废必须自上而下';
  const w0 = wks[0];
  errj(await api('POST', '/api/admin/signs/void', { token: A, body: { type: 'day', deptId: dept.id, key: w0, reason: '测试' } }), 409, 'LOCKED', '周签还在时作废日签');
  errj(await api('POST', '/api/admin/signs/void', { token: A, body: { type: 'week', deptId: dept.id, key: w0, reason: '测试' } }), 409, 'LOCKED', '月签还在时作废周签');
  okj(await api('POST', '/api/admin/signs/void', { token: A, body: { type: 'month', deptId: dept.id, key: M, reason: '测试' } }), '作废月签');
  okj(await api('POST', '/api/admin/signs/void', { token: A, body: { type: 'week', deptId: dept.id, key: w0, reason: '测试' } }), '作废周签');
  okj(await api('POST', '/api/admin/signs/void', { token: A, body: { type: 'day', deptId: dept.id, key: w0, reason: '测试' } }), '作废日签');
  // 作废后可以重新补签，链条可以重新走通
  okj(await api('POST', `/api/records/${dept.id}/${w0}/sign`, { token: I, body: { dataUrl: PNG } }), '作废后重新日签');
  okj(await api('POST', `/api/weeksigns/${dept.id}/${w0}/sign`, { token: N, body: { memberId: member.id, dataUrl: PNG } }), '作废后重新周签');
  okj(await api('POST', `/api/monthsigns/${dept.id}/${M}/sign`, { token: Q, body: { dataUrl: PNG } }), '作废后重新月签');
  ok('周签在→不能作废日签；月签在→不能作废周签；自上而下作废后可完整重签');

  step = '删除有签字历史的签字人';
  const dup = okj(await api('POST', '/api/admin/members', { token: A, body: { deptId: dept.id, name: '李护士长', title: '护士长' } }));
  errj(await api('PATCH', `/api/admin/members/${dup.id}`, { token: A, body: { name: '王护士长' } }), 409, 'CONFLICT', '改成同科室已有的姓名');
  ok('签字人改成同科室已有的姓名 → 409 提示重名（以前是 500）');
  okj(await api('DELETE', `/api/admin/members/${member.id}`, { token: A }), '删除签字人（有签字历史）');
  const ws2 = okj(await api('GET', `/api/weeksigns?deptId=${dept.id}&from=${wks[0]}&to=${wks[wks.length - 1]}`, { token: A }));
  assert.ok(ws2.every(x => x.sign.name === '王护士长'), '签字人删除后，历史周签应显示其最新姓名（不是早已改掉的旧名「科室2」）');
  ok('有签字历史的签字人可以删除；历史周签显示其最新姓名');

  step = '账号管理：设备科不能越权';
  errj(await api('POST', '/api/admin/users', { token: Q, body: { username: 'evil', password: 'Pass@123', displayName: 'x', role: 'admin', deptIds: [] } }), 403, 'FORBIDDEN', '设备科新建管理员');
  errj(await api('PATCH', `/api/admin/users/${equip.id}`, { token: Q, body: { role: 'admin' } }), 403, 'FORBIDDEN', '设备科把自己改成管理员');
  const adminRow = okj(await api('GET', '/api/admin/users', { token: A })).find(u => u.username === 'admin');
  errj(await api('PATCH', `/api/admin/users/${adminRow.id}`, { token: Q, body: { status: 'off' } }), 403, 'FORBIDDEN', '设备科停用管理员');
  errj(await api('POST', `/api/admin/users/${adminRow.id}/reset-password`, { token: Q }), 403, 'FORBIDDEN', '设备科重置管理员密码');
  okj(await api('POST', '/api/admin/users', { token: Q, body: { username: 'insp2', password: 'Pass@123', displayName: '新巡检员', role: 'inspector', deptIds: [dept.id] } }), '设备科新建巡检员（允许）');
  ok('设备科：建管理员 / 自升管理员 / 改管理员 / 重置管理员密码 → 403；管理巡检员账号照常可用');

  step = '账号管理：校验与防自锁';
  errj(await api('PATCH', `/api/admin/users/${adminRow.id}`, { token: A, body: { status: 'off' } }), 400, 'BAD_INPUT', '管理员停用自己');
  errj(await api('PATCH', `/api/admin/users/${adminRow.id}`, { token: A, body: { role: 'equip' } }), 400, 'BAD_INPUT', '管理员改自己的角色');
  const d2 = okj(await api('POST', '/api/admin/depts', { token: A, body: { name: '  急诊科  ' } }));
  assert.equal(d2.name, '急诊科', '科室名首尾空格应去掉');
  const hn = okj(await api('GET', '/api/admin/users', { token: A })).find(u => u.username === 'hn2');
  errj(await api('PATCH', `/api/admin/users/${hn.id}`, { token: A, body: { deptIds: [dept.id, d2.id] } }), 400, 'BAD_INPUT', '护士长改成 2 个科室');
  errj(await api('PATCH', `/api/admin/users/${insp.id}`, { token: A, body: { role: 'dept', deptIds: [] } }), 400, 'BAD_INPUT', '改成护士长但不给科室');
  errj(await api('PATCH', `/api/admin/users/${insp.id}`, { token: A, body: { displayName: '   ' } }), 400, 'BAD_INPUT', '显示名改成空白');
  errj(await api('PATCH', `/api/admin/depts/${dept.id}`, { token: A, body: { name: '  ' } }), 400, 'BAD_INPUT', '科室名改成空白');
  errj(await api('POST', '/api/admin/users', { token: A, body: { username: 'ghost', password: 'Pass@123', role: 'inspector', deptIds: [999999] } }), 400, 'BAD_INPUT', '指定不存在的科室');
  ok('不能停用自己/改自己角色；护士长必须恰好 1 个科室；空白名称、不存在的科室 → 400');

  step = '重置密码后旧会话失效';
  const lr = okj(await api('POST', '/api/auth/login', { body: { username: 'insp2', password: 'Pass@123' } }));
  const insp2 = okj(await api('GET', '/api/admin/users', { token: A })).find(u => u.username === 'insp2');
  const np = okj(await api('POST', `/api/admin/users/${insp2.id}/reset-password`, { token: A }), '重置密码').password;
  errj(await api('POST', '/api/auth/refresh', { body: { refreshToken: lr.refreshToken } }), 401, 'UNAUTHORIZED', '重置密码后用旧 refreshToken 续期');
  okj(await api('POST', '/api/auth/login', { body: { username: 'insp2', password: np } }), '用新密码登录');
  ok('重置密码后，旧的登录续期被拒，新密码可登录');

  step = '跨月的周：月签只锁归属本月的周，不锁上月最后一周里的日子';
  // 找一个已经完全结束、且 1 号不是周一（月初几天属于上个月最后一周）的月份
  let X = P.prevMonth(P.moOf(today));
  while (!(P.monthSpan(X).to < today && P.wkOf(`${X}-01`) !== `${X}-01`)) X = P.prevMonth(X);
  const k3 = okj(await api('POST', '/api/admin/depts', { token: A, body: { name: '科室3' } }));
  const k3dev = okj(await api('POST', '/api/admin/devices', { token: A, body: { deptId: k3.id, catName: '除颤类', code: 'K3-001', name: '除颤仪' } }));
  const k3m = okj(await api('POST', '/api/admin/members', { token: A, body: { deptId: k3.id, name: '张三', title: '护士长' } }));
  okj(await api('POST', '/api/admin/users', { token: A, body: { username: 'insp3', password: 'Pass@123', displayName: '巡检员三', role: 'inspector', deptIds: [k3.id] } }));
  okj(await api('POST', '/api/admin/users', { token: A, body: { username: 'hn3', password: 'Pass@123', displayName: '护士长三', role: 'dept', deptIds: [k3.id] } }));
  const I3 = await login('insp3'), N3 = await login('hn3');
  const day3 = async (d, r = 'ok') => {
    okj(await api('PUT', `/api/records/${k3.id}/${d}`, { token: I3, body: { checks: { [k3dev.id]: r }, notes: r === 'ng' ? { [k3dev.id]: '电量低' } : {} } }), `科室3 巡检 ${d}`);
    okj(await api('POST', `/api/records/${k3.id}/${d}/sign`, { token: I3, body: { dataUrl: PNG } }), `科室3 日签 ${d}`);
  };
  const wksX = P.wksOfMonth(X);
  let wkChecked = 0;
  for (const w of wksX) {
    for (const d of P.wkDays(w)) await day3(d, d === P.addDay(w, 2) ? 'ng' : 'ok');
    wkChecked += okj(await api('POST', `/api/weeksigns/${k3.id}/${w}/sign`, { token: N3, body: { memberId: k3m.id, dataUrl: PNG } }), `科室3 周签 ${w}`).stat.checked;
  }
  const msX = okj(await api('POST', `/api/monthsigns/${k3.id}/${X}/sign`, { token: Q, body: { dataUrl: PNG } }), `科室3 月签 ${X}`);
  assert.equal(msX.stat.checked, wkChecked, `月签台次 ${msX.stat.checked} 应等于各周周签台次之和 ${wkChecked}`);
  assert.equal(msX.stat.ng, wksX.length);
  ok(`${X} 月签的台次（${msX.stat.checked}）= 各周周签之和；统计范围是 ${P.monthSpan(X).from} ～ ${P.monthSpan(X).to}`);

  const spillWeek = P.wkOf(`${X}-01`);                  // 上个月最后一周，月初几天落在 X 月
  const spillDays = P.wkDays(spillWeek);
  for (const d of spillDays.filter(d => P.moOf(d) === X)) {
    okj(await api('PUT', `/api/records/${k3.id}/${d}`, { token: I3, body: { checks: { [k3dev.id]: 'ok' } } }), `${X} 已月签后补录 ${d}`);
  }
  for (const d of spillDays) await day3(d);
  okj(await api('POST', `/api/weeksigns/${k3.id}/${spillWeek}/sign`, { token: N3, body: { memberId: k3m.id, dataUrl: PNG } }), `周签上月最后一周 ${spillWeek}`);
  ok(`${X} 已月签，${spillWeek} 起那一周（属 ${P.moOf(spillWeek)}）里落在 ${X} 的日子仍可补录、整周可以周签（旧版被锁死）`);
  const tail = P.wkDays(wksX[wksX.length - 1]).filter(d => P.moOf(d) !== X);
  for (const d of tail) {
    errj(await api('PUT', `/api/records/${k3.id}/${d}`, { token: I3, body: { checks: { [k3dev.id]: 'ok' } } }), 409, 'LOCKED', `${X} 最后一周落在下月的 ${d}`);
  }
  if (tail.length) {
    errj(await api('POST', '/api/admin/signs/void', { token: A, body: { type: 'week', deptId: k3.id, key: wksX[wksX.length - 1], reason: '测试' } }), 409, 'LOCKED', '作废月签覆盖的最后一周');
    ok(`${X} 最后一周延伸到下月的 ${tail[0].slice(5)}～${tail[tail.length - 1].slice(5)} 由 ${X} 的月签锁定`);
  }

  step = '未签提醒：更早的月份也要提醒';
  const un = okj(await api('GET', '/api/stats/unsigned', { token: Q }));
  assert.ok(un.months.some(x => x.deptId === k3.id && x.month === P.moOf(spillWeek)),
    `${P.moOf(spillWeek)} 有记录、已结束、没月签，应出现在未签提醒里：${JSON.stringify(un.months)}`);
  assert.ok(!un.months.some(x => x.deptId === k3.id && x.month === X), '已月签的月份不应提醒');
  ok(`${P.moOf(spillWeek)}（不止上个月）未月签也会出现在首页提醒里`);

  step = '周签列表：起始日不是周一也不漏周';
  const wed = P.addDay(wksX[0], 2);
  const wl = okj(await api('GET', `/api/weeksigns?deptId=${k3.id}&from=${wed}&to=${wksX[0]}`, { token: A }));
  assert.equal(wl.length, 1, `从周三 ${wed} 查，应包含 ${wksX[0]} 那一周`);
  ok('周签查询从周三开始也包含当周');

  step = '月份参数校验';
  errj(await api('GET', `/api/stats/completion?month=2026-13`, { token: Q }), 400, 'BAD_INPUT', 'completion 2026-13');
  errj(await api('GET', `/api/stats/signatures?month=2026-00`, { token: Q }), 400, 'BAD_INPUT', 'signatures 2026-00');
  errj(await api('GET', `/api/export/monthly.xlsx?deptId=${k3.id}&month=2026-13`, { token: Q }), 400, 'BAD_INPUT', '导出 2026-13');
  errj(await api('POST', `/api/monthsigns/${k3.id}/2026-13/sign`, { token: Q, body: { dataUrl: PNG } }), 400, 'BAD_INPUT', '月签 2026-13');
  ok('2026-13 / 2026-00 → 400（以前返回 200 空报表或「这个月还没开始」）');

  step = '异常清单导出带科室条件、中文文件名';
  res = await api('GET', `/api/export/ng.xlsx?from=${P.monthSpan(X).from}&to=${P.monthSpan(X).to}&deptId=${k3.id}`, { token: Q, raw: true });
  assert.equal(res.status, 200);
  const cd = res.headers.get('content-disposition');
  const ngK3 = await xlsxRows(res, '异常清单');
  assert.ok(ngK3.length > 1 && ngK3.slice(1).every(r => r[1] === '科室3'), '只应导出科室3 的异常：' + JSON.stringify(ngK3.slice(0, 3)));
  assert.ok(decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(cd)[1]).startsWith('异常清单_科室3_'), cd);
  res = await api('GET', `/api/export/monthly.xlsx?deptId=${k3.id}&month=${X}`, { token: Q, raw: true });
  assert.equal(decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition'))[1]), `巡检月报_科室3_${X}.xlsx`);
  ok('异常清单导出只含所选科室；文件名为「巡检月报_科室3_月份.xlsx」这样的中文名');

  step = '设备调拨不改写历史月报';
  const before = await xlsxRows(await api('GET', `/api/export/monthly.xlsx?deptId=${dept.id}&month=${M}`, { token: Q, raw: true }), '巡检记录');
  const rowOf = (rows, code) => rows.find(r => r[0] === code);
  assert.ok(rowOf(before, 'LD-002'), '调拨前月报应有 LD-002');
  okj(await api('PATCH', `/api/admin/devices/${dev2.id}`, { token: A, body: { deptId: d2.id } }), '把 LD-002 调拨到急诊科');
  const after = await xlsxRows(await api('GET', `/api/export/monthly.xlsx?deptId=${dept.id}&month=${M}`, { token: Q, raw: true }), '巡检记录');
  const r2 = rowOf(after, 'LD-002');
  assert.ok(r2, '调拨后原科室历史月报仍应有 LD-002 这一行');
  assert.deepEqual(r2.slice(3), rowOf(before, 'LD-002').slice(3), 'LD-002 的 ✓/✗ 应原样保留');
  assert.ok(r2[1].includes('现属急诊科'), '应注明设备现属科室：' + r2[1]);
  const icu = await xlsxRows(await api('GET', `/api/export/monthly.xlsx?deptId=${d2.id}&month=${M}`, { token: Q, raw: true }), '巡检记录');
  assert.ok(!rowOf(icu, 'LD-002'), '调入科室的历史月报不应凭空多出一整行空白');
  okj(await api('PATCH', `/api/admin/devices/${dev2.id}`, { token: A, body: { deptId: dept.id } }), '调回');
  ok('设备调拨后：原科室历史月报保留该设备整行（注明现属科室），调入科室历史月报不出空行');

  step = '停用科室：历史统计保留、不能再录入、不再提醒';
  okj(await api('PATCH', `/api/admin/depts/${k3.id}`, { token: A, body: { status: 'off' } }), '停用科室3');
  const compX = okj(await api('GET', `/api/stats/completion?month=${X}`, { token: Q }));
  assert.ok(compX.find(x => x.deptId === k3.id && x.deptStatus === 'off' && x.monthSigned), `停用后 ${X} 的完成率里仍应有科室3`);
  assert.ok(okj(await api('GET', `/api/stats/signatures?month=${X}`, { token: Q })).some(x => x.deptId === k3.id), '签字人工作量仍应有科室3');
  errj(await api('PUT', `/api/records/${k3.id}/${today}`, { token: I3, body: { checks: { [k3dev.id]: 'ok' } } }), 400, 'BAD_INPUT', '停用科室录入巡检');
  const un2 = okj(await api('GET', '/api/stats/unsigned', { token: Q }));
  assert.ok(![...un2.days, ...un2.weeks, ...un2.months].some(x => x.deptId === k3.id), '停用科室不应再出现在未签提醒里');
  okj(await api('PATCH', `/api/admin/devices/${k3dev.id}`, { token: A, body: { expiryDate: P.addDay(today, -3) } }), '设置已过期');
  const exp = okj(await api('GET', '/api/stats/expiry', { token: Q })).find(x => x.code === 'K3-001');
  assert.ok(exp && exp.level === 'expired' && exp.deptName === '科室3（已停用）', '停用科室里在用的过期设备仍要提醒：' + JSON.stringify(exp));
  okj(await api('PATCH', `/api/admin/depts/${k3.id}`, { token: A, body: { status: 'on' } }), '重新启用');
  ok('停用科室：历史完成率/工作量照常显示；不能再录入；不再出现在未签提醒；过期设备仍提醒（注明已停用）');

  step = '新建科室不误报缺签';
  const kf = okj(await api('POST', '/api/admin/depts', { token: A, body: { name: '康复科' } }));
  let un3 = okj(await api('GET', '/api/stats/unsigned', { token: Q }));
  assert.ok(!un3.days.some(x => x.deptId === kf.id), '今天新建的科室不应有「前 7 天未日签」');
  okj(await api('POST', '/api/admin/devices', { token: A, body: { deptId: kf.id, catName: '监护类', code: 'KF-001', name: '监护仪' } }));
  un3 = okj(await api('GET', '/api/stats/unsigned', { token: Q }));
  assert.ok(!un3.days.some(x => x.deptId === kf.id), '加了设备也不应追溯建科室之前的日子');
  const compK = okj(await api('GET', `/api/stats/completion?month=${P.moOf(today)}&deptId=${kf.id}`, { token: Q }))[0];
  assert.equal(compK.dueDays, 1, '今天新建的科室本月应巡天数应为 1（今天）');
  ok('今天新建的科室：不追溯前 7 天缺签；本月应巡天数从建科室当天算');

  /* ======================= 登录与会话安全 ======================= */
  const raw = async (method, url, { device = 'regress-dev', headers = {}, body } = {}) => {
    const h = device ? { 'x-device-id': device, ...headers } : { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    const r = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  const loginAs = (u, p, device, headers) => raw('POST', '/api/auth/login', { device, headers, body: { username: u, password: p } });
  const sidOf = r => (/(?:^|, )sid=([^;]+)/.exec(r.headers.get('set-cookie') || '') || [])[1];
  const Database = require('better-sqlite3');
  const sql = new Database(path.join(DATA_DIR, 'app.db'));
  sql.pragma('busy_timeout = 5000');

  step = '登录冷却按「设备+IP」：全院共用出口 IP 时不连坐';
  okj(await api('POST', '/api/admin/users', { token: A, body: { username: 'nurseB', password: 'Pass@123', displayName: '护士B', role: 'inspector', deptIds: [k3.id] } }));
  const NAT = { 'x-forwarded-for': '203.0.113.7' };
  for (const [dev, n] of [['phone-A', 3], ['phone-C', 3], ['phone-D', 2]]) {
    for (let i = 0; i < n; i++) errj(await loginAs('insp3', 'wrong-pw', dev, NAT), 401, 'UNAUTHORIZED', `${dev} 输错`);
    // 每台设备各自输错几次后，换回正确密码登录，避免把 insp3 冻结
    if (dev !== 'phone-D') okj(await loginAs('insp3', 'Pass@123', dev, NAT), `${dev} 正确登录`);
  }
  okj(await loginAs('nurseB', 'Pass@123', 'phone-B', NAT), '同一出口 IP 下另一台手机正常登录');
  okj(await loginAs('admin', 'Admin@123', 'office-pc', NAT), '同一出口 IP 下管理员正常登录');
  ok('同一出口 IP 下 3 台手机共输错 8 次，其他手机和管理员照常登录（旧版全院 429）');

  step = '登录成功不清空本设备的失败计数';
  for (let i = 0; i < 7; i++) errj(await loginAs(`ghost${i}`, 'x', 'probe-pc', NAT), 401, 'UNAUTHORIZED', '不存在的账号');
  okj(await loginAs('nurseB', 'Pass@123', 'probe-pc', NAT), '中途用自己的账号登录一次');
  errj(await loginAs('ghost7', 'x', 'probe-pc', NAT), 401, 'UNAUTHORIZED', '第 8 次失败');
  errj(await loginAs('ghost8', 'x', 'probe-pc', NAT), 429, 'PROBE_COOLDOWN', '第 9 次应被冷却');
  ok('同一设备失败 7 次 → 登一次自己的号 → 再失败 1 次即冷却（旧版登录成功就清零，可无限试）');

  step = '只信一层代理：伪造的 X-Forwarded-For 前缀不算数';
  okj(await loginAs('nurseB', 'Pass@123', 'xff-pc', { 'x-forwarded-for': '6.6.6.6, 198.51.100.9' }));
  const lastLogin = okj(await api('GET', '/api/admin/audit', { token: A })).find(a => a.action === 'login');
  assert.equal(lastLogin.ip, '198.51.100.9', '应取代理追加的最后一项，实际：' + lastLogin.ip);
  ok('X-Forwarded-For「伪造, 真实」→ 记录的是代理追加的真实地址');

  step = 'refreshToken 被盗用';
  let L1 = okj(await loginAs('nurseB', 'Pass@123', 'legit-phone'));
  errj(await raw('POST', '/api/auth/refresh', { device: 'thief-pc', body: { refreshToken: L1.refreshToken } }), 401, 'UNAUTHORIZED', '换设备号来换 token');
  errj(await raw('POST', '/api/auth/refresh', { device: 'legit-phone', body: { refreshToken: L1.refreshToken } }), 401, 'UNAUTHORIZED', '被盗用后这组 token 已吊销');
  L1 = okj(await loginAs('nurseB', 'Pass@123', 'legit-phone'));
  const stolen = okj(await raw('POST', '/api/auth/refresh', { device: 'legit-phone', body: { refreshToken: L1.refreshToken } }), '盗用者伪造同一设备号先换走');
  errj(await raw('POST', '/api/auth/refresh', { device: 'legit-phone', body: { refreshToken: L1.refreshToken } }), 401, 'UNAUTHORIZED', '正主重放旧 token');
  errj(await raw('POST', '/api/auth/refresh', { device: 'legit-phone', body: { refreshToken: stolen.refreshToken } }), 401, 'UNAUTHORIZED', '盗用者换出来的新 token 应一并作废');
  // 登录时没带设备号的会话：轮换出来的新 token 也必须留在原来那一组里，重放时才能一起作废
  const L0 = okj(await loginAs('nurseB', 'Pass@123', ''));
  const L0b = okj(await raw('POST', '/api/auth/refresh', { device: 'some-pc', body: { refreshToken: L0.refreshToken } }));
  errj(await raw('POST', '/api/auth/refresh', { device: '', body: { refreshToken: L0.refreshToken } }), 401, 'UNAUTHORIZED', '重放');
  errj(await raw('POST', '/api/auth/refresh', { device: 'some-pc', body: { refreshToken: L0b.refreshToken } }), 401, 'UNAUTHORIZED', '同组新 token 应一并作废');
  ok('换设备号续期 → 拒绝并吊销；正主重放旧 token → 盗用者换出的新 token 一并作废（旧版盗用者会话一直有效）');

  step = 'sid Cookie 退出后失效';
  const L2 = await loginAs('insp3', 'Pass@123', 'sid-phone');
  const sid3 = sidOf(L2);
  const k3rec = okj(await api('GET', `/api/records/${k3.id}/${wksX[0]}`, { token: A }));
  assert.equal((await raw('GET', k3rec.sign.url, { device: 'sid-phone', headers: { cookie: `sid=${sid3}` } })).status, 200, '登录中 sid 可看签名图');
  errj(await raw('PUT', `/api/records/${k3.id}/${today}`, { device: 'sid-phone', headers: { authorization: `Bearer ${sid3}` }, body: { checks: {} } }), 401, 'UNAUTHORIZED', 'sid 当 Bearer 写记录');
  okj(await raw('POST', '/api/auth/logout', { device: 'sid-phone', body: { refreshToken: L2.json.refreshToken } }), '退出（不带 access token 也能退出）');
  assert.equal((await raw('GET', k3rec.sign.url, { device: 'sid-phone', headers: { cookie: `sid=${sid3}` } })).status, 401, '退出后 sid 应失效');
  ok('sid 不能当 Bearer 写数据；退出登录后 sid 立即失效（旧版 30 天内一直可用）');

  step = '自己改密码：其他设备的登录失效，当前设备保持登录';
  const onA = okj(await loginAs('nurseB', 'Pass@123', 'pw-phone-A'));
  const onB = okj(await loginAs('nurseB', 'Pass@123', 'pw-phone-B'));
  errj(await raw('POST', '/api/auth/change-password', { device: 'pw-phone-A', headers: { authorization: `Bearer ${onA.accessToken}` }, body: { oldPassword: 'Pass@123', newPassword: 'Pass@123' } }), 400, 'BAD_INPUT', '新旧密码相同');
  okj(await raw('POST', '/api/auth/change-password', { device: 'pw-phone-A', headers: { authorization: `Bearer ${onA.accessToken}` }, body: { oldPassword: 'Pass@123', newPassword: 'New@1234' } }), '在 A 上改密');
  errj(await raw('POST', '/api/auth/refresh', { device: 'pw-phone-B', body: { refreshToken: onB.refreshToken } }), 401, 'UNAUTHORIZED', 'B 的旧登录续期');
  okj(await raw('POST', '/api/auth/refresh', { device: 'pw-phone-A', body: { refreshToken: onA.refreshToken } }), 'A 继续使用');
  ok('改密后其他设备的旧登录不能再续期，改密的这台设备不用重新登录');

  step = '重置密码后必须先改密（服务端强制）';
  const nb = okj(await api('GET', '/api/admin/users', { token: A })).find(u => u.username === 'nurseB');
  const tmp = okj(await api('POST', `/api/admin/users/${nb.id}/reset-password`, { token: A })).password;
  const T = okj(await loginAs('nurseB', tmp, 'mc-phone'));
  assert.equal(T.user.mustChange, true);
  const auth = { authorization: `Bearer ${T.accessToken}` };
  errj(await raw('PUT', `/api/records/${k3.id}/${today}`, { device: 'mc-phone', headers: auth, body: { checks: {} } }), 403, 'MUST_CHANGE_PASSWORD', '未改密就录入');
  errj(await raw('GET', '/api/depts', { device: 'mc-phone', headers: auth }), 403, 'MUST_CHANGE_PASSWORD', '未改密就查科室');
  okj(await raw('GET', '/api/auth/me', { device: 'mc-phone', headers: auth }), '未改密可以取自己的信息');
  okj(await raw('GET', '/api/time', { device: 'mc-phone', headers: auth }), '未改密可以取服务器时间');
  okj(await raw('POST', '/api/auth/change-password', { device: 'mc-phone', headers: auth, body: { oldPassword: tmp, newPassword: 'Mine@2026' } }), '改密');
  okj(await raw('GET', '/api/depts', { device: 'mc-phone', headers: auth }), '改密后照常使用');
  ok('临时密码登录后：除「我的信息/改密/时间/退出」外一律 403，改完密码立即恢复（旧版前端可绕过）');

  step = '停用账号续期提示「已禁用」，不记虚假重放';
  const D1 = okj(await loginAs('nurseB', 'Mine@2026', 'off-phone'));
  okj(await api('PATCH', `/api/admin/users/${nb.id}`, { token: A, body: { status: 'off' } }));
  const lastAudit = Math.max(...okj(await api('GET', '/api/admin/audit', { token: A })).map(a => +a.id));
  errj(await raw('POST', '/api/auth/refresh', { device: 'off-phone', body: { refreshToken: D1.refreshToken } }), 401, 'KICKED', '停用后续期');
  assert.ok(!okj(await api('GET', '/api/admin/audit', { token: A })).some(a => +a.id > lastAudit && a.action === 'refresh_replay'), '不应记重放');
  okj(await api('PATCH', `/api/admin/users/${nb.id}`, { token: A, body: { status: 'on' } }));
  ok('停用账号续期 → 401 KICKED（提示已禁用），不再写一条虚假的重放审计');

  step = '冻结：可见、可解冻、登录成功后轮次清零';
  for (let i = 0; i < 4; i++) errj(await loginAs('nurseB', 'bad', 'fz-phone'), 401, 'UNAUTHORIZED');
  let fz = await loginAs('nurseB', 'bad', 'fz-phone');
  errj(fz, 423, 'FROZEN'); assert.equal(fz.json.error.retryAfter, 300);
  let row = okj(await api('GET', '/api/admin/users', { token: Q })).find(u => u.username === 'nurseB');
  assert.ok(row.frozenUntil && row.frozenSec > 0, '账号列表应显示冻结状态');
  errj(await api('POST', `/api/admin/users/${adminRow.id}/unfreeze`, { token: Q }), 403, 'FORBIDDEN', '设备科解冻管理员');
  row = okj(await api('POST', `/api/admin/users/${nb.id}/unfreeze`, { token: Q }), '设备科解冻巡检员');
  assert.equal(row.frozenUntil, null);
  okj(await loginAs('nurseB', 'Mine@2026', 'fz-phone'), '解冻后用原密码登录');
  // 模拟「冻结自然到期」：把冻结时间改到过去，但保留冻结轮次
  for (let i = 0; i < 5; i++) await loginAs('nurseB', 'bad', 'fz-phone2');
  sql.prepare("UPDATE users SET frozen_until = '2000-01-01T00:00:00.000Z' WHERE username = 'nurseB'").run();
  assert.equal(sql.prepare("SELECT freeze_level FROM users WHERE username = 'nurseB'").get().freeze_level, 1);
  okj(await loginAs('nurseB', 'Mine@2026', 'fz-phone3'), '冻结到期后正确登录');
  for (let i = 0; i < 4; i++) await loginAs('nurseB', 'bad', 'fz-phone4');
  fz = await loginAs('nurseB', 'bad', 'fz-phone4');
  assert.equal(fz.json.error.retryAfter, 300, '登录成功后再冻结应从 5 分钟重新算，实际 ' + fz.json.error.retryAfter);
  ok('账号列表显示冻结；设备科可解冻巡检员、不能解冻管理员；本人登录成功后冻结时长从 5 分钟重新算');

  step = '服务器上重置管理员密码：旧登录全部失效';
  const adm = okj(await loginAs('admin', 'Admin@123', 'adm-pc'));
  require('child_process').execFileSync('node', ['src/scripts/create-admin.js', 'admin', 'Reset@2026'], { cwd: ROOT, env: ENV, stdio: 'ignore' });
  errj(await raw('POST', '/api/auth/refresh', { device: 'adm-pc', body: { refreshToken: adm.refreshToken } }), 401, 'UNAUTHORIZED', '重置前的登录续期');
  okj(await loginAs('admin', 'Reset@2026', 'adm-pc'), '新密码登录');
  ok('manage.sh 重置管理员 → 之前的登录全部失效，新密码可登录');

  /* ======================= 输入校验与杂项 ======================= */
  step = '设备状态只认四个值';
  errj(await api('POST', '/api/admin/devices', { token: A, body: { deptId: k3.id, catName: '药品', code: 'DRUG-1', name: '肾上腺素', status: '正常', expiryDate: P.addDay(today, -12) } }), 400, 'BAD_INPUT', '状态写「正常」');
  errj(await api('PATCH', `/api/admin/devices/${k3dev.id}`, { token: A, body: { status: 'abc' } }), 400, 'BAD_INPUT', '改成未知状态');
  errj(await api('PATCH', `/api/admin/devices/${k3dev.id}`, { token: A, body: { code: '  ' } }), 400, 'BAD_INPUT', '编码改成空白');
  ok('设备状态写「正常」等未知值 → 400（以前入库后从巡检清单和有效期提醒里消失）；编码不能改成空白');

  step = '导入：状态留空不改动已有设备';
  okj(await api('PATCH', `/api/admin/devices/${k3dev.id}`, { token: A, body: { status: 'scrapped' } }), '先报废');
  {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('设备导入');
    ws.addRow(['科室名称', '设备品类', '设备编码', '设备名称', '型号', '位置', '状态', '有效期', '提醒提前天数']);
    ws.addRow(['科室3', '除颤类', 'K3-001', '除颤仪', '', '抢救室2', '', '', '']);
    ws.addRow(['科室3', '除颤类', 'K3-NEW', '新除颤仪', '', '抢救室2', '', '', '']);
    const fd = new FormData();
    fd.append('file', new Blob([await wb.xlsx.writeBuffer()]), 'devices.xlsx');
    const r = await fetch(BASE + '/api/admin/devices/import', { method: 'POST', headers: { authorization: `Bearer ${A}`, 'x-device-id': 'regress-dev' }, body: fd });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    assert.deepEqual([out.created, out.updated, out.errors.length], [1, 1, 0], JSON.stringify(out));
  }
  const devs3 = okj(await api('GET', `/api/admin/devices?deptId=${k3.id}`, { token: A }));
  assert.equal(devs3.find(d => d.code === 'K3-001').status, 'scrapped', '已报废设备导入时状态留空，应保持报废');
  assert.equal(devs3.find(d => d.code === 'K3-001').location, '抢救室2');
  assert.equal(devs3.find(d => d.code === 'K3-NEW').status, 'in_use', '新设备状态留空默认在用');
  okj(await api('PATCH', `/api/admin/devices/${k3dev.id}`, { token: A, body: { status: 'in_use' } }));
  ok('重导入只改位置、状态留空：已报废的仍是报废（以前被改回在用）；新设备默认在用');

  step = '巡检勾选的输入校验';
  for (const bad of [{ '02': 'ok' }, { '2.0': 'ok' }, { [k3dev.id]: 'ok', ['0' + k3dev.id]: 'ok' }]) {
    errj(await api('PUT', `/api/records/${k3.id}/${today}`, { token: I3, body: { checks: bad } }), 400, 'BAD_INPUT', '非规范设备 id：' + JSON.stringify(bad));
  }
  const huge = {}; for (let i = 1; i <= 40000; i++) huge[i] = 'ok';
  errj(await api('PUT', `/api/records/${k3.id}/${today}`, { token: I3, body: { checks: huge } }), 400, 'BAD_INPUT', '4 万个勾选');
  ok('「02」「2.0」这类设备 id、超大勾选 → 400（以前 500）');

  step = '排序号与名称校验';
  errj(await api('PATCH', `/api/admin/depts/${k3.id}`, { token: A, body: { sort: 'abc' } }), 400, 'BAD_INPUT', '科室排序 abc');
  errj(await api('PATCH', `/api/admin/devices/${k3dev.id}`, { token: A, body: { sort: 'abc' } }), 400, 'BAD_INPUT', '设备排序 abc');
  errj(await api('PATCH', `/api/admin/members/${k3m.id}`, { token: A, body: { sort: 'abc' } }), 400, 'BAD_INPUT', '签字人排序 abc');
  errj(await api('PATCH', `/api/admin/members/${k3m.id}`, { token: A, body: { deptId: d2.id } }), 400, 'BAD_INPUT', '签字人改科室');
  ok('排序号非整数 → 400（以前 500）；签字人改科室明确提示不支持（以前静默不生效）');

  step = '作废：原因不能是空白、审计留下原签字、时间格式统一、签名图范围';
  const vd = spillDays[0];
  errj(await api('POST', '/api/admin/signs/void', { token: A, body: { type: 'week', deptId: k3.id, key: spillWeek, reason: '   ' } }), 400, 'BAD_INPUT', '空白原因');
  const vrec = okj(await api('GET', `/api/records/${k3.id}/${vd}`, { token: A }));
  okj(await api('POST', '/api/admin/signs/void', { token: A, body: { type: 'week', deptId: k3.id, key: spillWeek, reason: '测试作废' } }));
  okj(await api('POST', '/api/admin/signs/void', { token: A, body: { type: 'day', deptId: k3.id, key: vd, reason: '测试作废' } }));
  const voidLog = okj(await api('GET', '/api/admin/audit', { token: A })).filter(a => a.action === 'sign_void').slice(0, 2);
  assert.ok(voidLog.every(a => a.detail.includes('原签字：') && a.detail.includes('签名图=')), '作废审计应记下原签字：' + JSON.stringify(voidLog));
  const voided = okj(await api('GET', `/api/records/${k3.id}/${vd}`, { token: A }));
  assert.match(voided.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '作废后 updatedAt 应是上海时间格式：' + voided.updatedAt);
  okj(await api('POST', '/api/admin/users', { token: A, body: { username: 'outsider', password: 'Pass@123', displayName: '外科室巡检员', role: 'inspector', deptIds: [d2.id] } }));
  const O = await login('outsider');
  assert.equal((await api('GET', vrec.sign.url, { token: O, raw: true })).status, 404, '别科室的人看作废后的签名图应 404');
  assert.equal((await api('GET', vrec.sign.url, { token: Q, raw: true })).status, 200, '设备科可以查看作废的签名图（核对用）');
  ok('作废原因不能只填空格；审计里留有原签字人/时间/签名图；作废后的签名图别科室看不到');

  step = '审计日志按上海日期筛选';
  sql.prepare("INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (NULL, 'probe_tz', '', '', '2026-10-12T16:30:00.000Z')").run();
  const day13 = okj(await api('GET', '/api/admin/audit?from=2026-10-13&to=2026-10-13', { token: A }));
  const day12 = okj(await api('GET', '/api/admin/audit?from=2026-10-12&to=2026-10-12', { token: A }));
  assert.ok(day13.some(a => a.action === 'probe_tz'), '上海 10-13 00:30 的操作应在 10-13 查到');
  assert.ok(!day12.some(a => a.action === 'probe_tz'), '不应落到 10-12');
  ok('凌晨 00:30（上海）的操作按当天日期能查到（以前落到前一天）');

  step = '删除科室：有签字/护士长时给出明确提示';
  const leg = okj(await api('POST', '/api/admin/import/legacy', { token: A, body: {
    depts: [{ id: 'x1', name: '导入科室' }],
    weeksigns: [{ deptId: 'x1', week: P.addDay(wksX[0], -7), sign: { name: '某人', dataUrl: PNG } }, { deptId: 'x1', week: P.addDay(wksX[0], -5), sign: { name: '某人', dataUrl: PNG } }],
    records: [{ deptId: 'x1', date: '2026-02-30', checks: {} }],
    monthsigns: [{ deptId: 'x1', month: '2026-13', sign: { name: '某人', dataUrl: PNG } }],
    users: [{ username: 'legacy-hn', role: 'dept', deptIds: [] }]
  } }));
  assert.equal(leg.imported.weeksigns, 1, '非周一的周签应被跳过');
  assert.ok(leg.errors.length >= 4, '非法日期/非周一/非法月份/护士长无科室都应报错：' + JSON.stringify(leg.errors));
  const impDept = okj(await api('GET', '/api/admin/depts', { token: A })).find(d => d.name === '导入科室');
  errj(await api('DELETE', `/api/admin/depts/${impDept.id}`, { token: A }), 409, 'CONFLICT', '有周签无记录的科室删除');
  const hd = okj(await api('POST', '/api/admin/depts', { token: A, body: { name: '待删科室' } }));
  okj(await api('POST', '/api/admin/users', { token: A, body: { username: 'hn-del', password: 'Pass@123', displayName: '待删护士长', role: 'dept', deptIds: [hd.id] } }));
  errj(await api('DELETE', `/api/admin/depts/${hd.id}`, { token: A }), 409, 'CONFLICT', '有护士长的科室删除');
  ok('历史导入校验日期/周一/月份/护士长科室数；删除科室：有签字 → 409（以前 500），有护士长 → 409 提示先处理账号');
  sql.close();

  console.log('\nREGRESS PASS');
}

main()
  .catch(e => { console.error(`\n✗ 失败于「${step}」\n`, e); process.exitCode = 1; })
  .finally(() => { if (server) server.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });
