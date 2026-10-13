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

  console.log('\nREGRESS PASS');
}

main()
  .catch(e => { console.error(`\n✗ 失败于「${step}」\n`, e); process.exitCode = 1; })
  .finally(() => { if (server) server.kill(); fs.rmSync(DATA_DIR, { recursive: true, force: true }); });
