'use strict';
/* 操作日志：后台增删改、登录成败、签字、作废、导出都留日志；改前改后、操作人快照；分页与筛选。起一个真实的后端进程测。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3294;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oplog-'));
const ENV = { ...process.env, DATA_DIR: dir, JWT_SECRET: 'oplog-test', PORT: String(PORT),
  RL_GLOBAL: '100000', RL_LOGIN: '100000', RL_IP: '0', LOG_LEVEL: 'silent' };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let server, admin;

async function api(method, url, { token, body, referer } = {}) {
  const h = { 'x-device-id': 'oplog-dev', 'user-agent': 'oplog-test-agent' };
  if (token) h.authorization = `Bearer ${token}`;
  if (referer) h.referer = referer;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString()); } catch { /* 文件 */ }
  return { status: res.status, json, buf };
}
const login = (u, p, referer) => api('POST', '/api/auth/login', { body: { username: u, password: p }, referer });
const logs = async (qs = '') => (await api('GET', '/api/admin/oplog?size=0' + qs, { token: admin })).json;
const latest = async (op, qs = '') => (await logs(qs)).items.find(x => x.op === op);

test.before(async () => {
  execFileSync('node', ['src/scripts/create-admin.js', 'admin', 'admin123'], { cwd: ROOT, env: ENV });
  server = spawn('node', ['src/index.js'], { cwd: ROOT, stdio: 'ignore', env: ENV });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  admin = (await login('admin', 'admin123', 'https://x/admin/users')).json.accessToken;
});
test.after(() => { if (server) server.kill(); });

test('登录成功、失败都记，含端、IP、设备；密码不进日志', async () => {
  assert.equal((await login('admin', 'wrong-secret-pw', 'https://x/xunjian/')).status, 401);
  assert.equal((await login('nobody', 'x')).status, 401);
  const all = await logs('&module=登录');
  const ok = all.items.find(x => x.op === '登录');
  assert.equal(ok.username, 'admin');
  assert.match(ok.summary, /管理后台登录成功/);
  assert.equal(ok.device, 'oplog-dev');
  assert.equal(ok.ua, 'oplog-test-agent');
  const bad = all.items.filter(x => x.op === '登录失败');
  assert.equal(bad.length, 2);
  assert.ok(bad.every(x => x.result === 'fail'));
  assert.ok(bad.some(x => /手机端登录失败：密码不正确/.test(x.summary)));
  assert.ok(bad.some(x => /系统里没有/.test(x.target)));
  assert.ok(!JSON.stringify(all).includes('wrong-secret-pw'), '日志里不能出现密码');
});

test('账号、科室、设备、签字人：增删改都记，改前改后清楚', async () => {
  const d = (await api('POST', '/api/admin/depts', { token: admin, body: { name: '急诊科' } })).json;
  const d2 = (await api('POST', '/api/admin/depts', { token: admin, body: { name: '重症医学科' } })).json;
  await api('PATCH', `/api/admin/depts/${d.id}`, { token: admin, body: { code: 'JZ', sort: 3 } });
  let e = await latest('修改', '&module=科室');
  assert.equal(e.target, '科室 急诊科');
  assert.deepEqual(e.changes.map(c => c.f).sort(), ['排序', '编码']);
  assert.ok(e.changes.some(c => c.f === '编码' && c.from === '（空）' && c.to === 'JZ'));

  const u = (await api('POST', '/api/admin/users', { token: admin, body: { username: 'zs', password: 'pass123', displayName: '张三', role: 'inspector', deptIds: [d.id] } })).json;
  e = await latest('新增', '&module=账号');
  assert.match(e.target, /zs（张三）/);
  assert.match(e.summary, /巡检员，科室 急诊科/);
  await api('PATCH', `/api/admin/users/${u.id}`, { token: admin, body: { username: 'zhangsan', deptIds: [d.id, d2.id] } });
  e = await latest('修改', '&module=账号');
  assert.ok(e.changes.some(c => c.f === '登录账号' && c.from === 'zs' && c.to === 'zhangsan'));
  assert.ok(e.changes.some(c => c.f === '科室' && c.to === '急诊科、重症医学科'));
  await api('PATCH', `/api/admin/users/${u.id}`, { token: admin, body: { status: 'off' } });
  e = await latest('停用', '&module=账号');
  assert.match(e.summary, /停用账号/);
  // 没改任何东西：不记
  const n = (await logs()).total;
  await api('PATCH', `/api/admin/users/${u.id}`, { token: admin, body: { displayName: '张三' } });
  assert.equal((await logs()).total, n, '没有改动不记日志');

  const v = (await api('POST', '/api/admin/devices', { token: admin, body: { deptId: d.id, catName: '除颤仪', code: 'JZ-1', name: '除颤仪' } })).json;
  await api('PATCH', `/api/admin/devices/${v.id}`, { token: admin, body: { deptId: d2.id, status: 'repair' } });
  e = await latest('调拨', '&module=设备');
  assert.match(e.summary, /急诊科 → 重症医学科/);
  assert.ok(e.changes.some(c => c.f === '状态' && c.from === '在用' && c.to === '维修中'));
  await api('DELETE', `/api/admin/devices/${v.id}`, { token: admin });
  e = await latest('删除', '&module=设备');
  assert.equal(e.target, '设备 JZ-1 除颤仪');

  const m = (await api('POST', '/api/admin/members', { token: admin, body: { deptId: d.id, name: '王护士长', title: '护士长' } })).json;
  await api('PATCH', `/api/admin/members/${m.id}`, { token: admin, body: { name: '王芳' } });
  e = await latest('修改', '&module=签字人');
  assert.ok(e.changes.some(c => c.f === '姓名' && c.from === '王护士长' && c.to === '王芳'));
  await api('DELETE', `/api/admin/members/${m.id}`, { token: admin });
  assert.ok(await latest('删除', '&module=签字人'));

  await api('DELETE', `/api/admin/users/${u.id}`, { token: admin });
  e = await latest('删除', '&module=账号');
  assert.match(e.target, /zhangsan（张三）/);
  assert.ok(e.changes.some(c => c.f === '登录账号' && c.from === 'zhangsan'));
});

test('日签、作废：谁签的、谁作废的、原因、原签字人都在', async () => {
  const d = (await api('POST', '/api/admin/depts', { token: admin, body: { name: '儿科' } })).json;
  const v = (await api('POST', '/api/admin/devices', { token: admin, body: { deptId: d.id, catName: '监护仪', code: 'EK-1', name: '监护仪' } })).json;
  await api('POST', '/api/admin/users', { token: admin, body: { username: 'ek01', password: 'pass123', displayName: '李四', role: 'inspector', deptIds: [d.id] } });
  const t = (await login('ek01', 'pass123', 'https://x/xunjian/')).json.accessToken;
  const today = (await api('GET', '/api/time', { token: t })).json.date;
  await api('PUT', `/api/records/${d.id}/${today}`, { token: t, body: { checks: { [v.id]: 'ng' }, notes: { [v.id]: '开不了机' } } });
  assert.equal((await api('POST', `/api/records/${d.id}/${today}/sign`, { token: t, body: { name: '李四', dataUrl: PNG } })).status, 200);
  let e = await latest('日签');
  assert.equal(e.username, 'ek01');
  assert.equal(e.target, `儿科 · ${today} 日签`);
  assert.match(e.summary, /勾选 1 台，其中异常 1 台/);
  assert.equal((await api('POST', '/api/admin/signs/void', { token: admin, body: { type: 'day', deptId: d.id, key: today, reason: '误签' } })).status, 200);
  e = await latest('作废');
  assert.equal(e.username, 'admin');
  assert.match(e.summary, /原因：误签/);
  assert.match(e.summary, /原签字人：李四/);
  assert.match(e.detail, /^type=day /, '原始信息格式不变（统计作废次数依赖它）');
});

test('导出也记；列表分页、筛选、关键词；导出 Excel', async () => {
  const d = (await api('GET', '/api/admin/depts', { token: admin })).json[0];
  const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
  assert.equal((await api('GET', `/api/export/monthly.xlsx?deptId=${d.id}&month=${month}`, { token: admin })).status, 200);
  assert.ok(await latest('导出月报'));
  const p1 = (await api('GET', '/api/admin/oplog?size=10&page=1', { token: admin })).json;
  const p2 = (await api('GET', '/api/admin/oplog?size=10&page=2', { token: admin })).json;
  assert.equal(p1.items.length, 10);
  assert.ok(p1.total > 20);
  assert.equal(p2.page, 2);
  assert.ok(+p1.items[9].id > +p2.items[0].id, '按时间倒序、第 2 页接着第 1 页');
  const kw = (await api('GET', '/api/admin/oplog?size=0&q=' + encodeURIComponent('王芳'), { token: admin })).json;
  assert.ok(kw.items.length >= 1 && kw.items.every(x => JSON.stringify(x).includes('王芳')));
  const fail = (await api('GET', '/api/admin/oplog?size=0&result=fail', { token: admin })).json;
  assert.ok(fail.items.length >= 2 && fail.items.every(x => x.result === 'fail'));
  const meta = (await api('GET', '/api/admin/oplog/meta', { token: admin })).json;
  assert.ok(meta.modules.includes('账号') && meta.ops.some(o => o.op === '作废') && meta.users.some(u => u.username === 'ek01'));
  const x = await api('GET', '/api/admin/oplog/export.xlsx?from=2020-01-01', { token: admin });
  assert.equal(x.status, 200);
  assert.equal(x.buf.slice(0, 2).toString(), 'PK');
  assert.ok(await latest('导出操作日志'));
  // 巡检员看不到操作日志
  const t = (await login('ek01', 'pass123')).json.accessToken;
  assert.equal((await api('GET', '/api/admin/oplog', { token: t })).status, 403);
});
