'use strict';
/* 端到端冒烟：起服务(:3100, 临时 DATA_DIR) → 建号建数据 → 三级签字全链路 →
   导出/统计/ams/登录冻结/枚举冷却。全部通过输出 SMOKE PASS。
   用法：node scripts/smoke.js */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert/strict');
const P = require('../src/services/period.service');

const PORT = 3100;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'medops-smoke-'));
const ENV = {
  ...process.env, PORT: String(PORT), DATA_DIR, JWT_SECRET: 'smoke-secret',
  RL_GLOBAL: '100000', RL_LOGIN: '100000', LOG_LEVEL: 'silent'
};
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let server = null;
let step = '';
const ok = m => console.log('  ✓', m);

async function api(method, url, { token, body, headers = {}, raw, device } = {}) {
  const h = { 'x-device-id': device || 'smoke-dev-1', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) { payload = body; h['content-type'] = h['content-type'] || 'application/octet-stream'; }
    else { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  }
  const res = await fetch(BASE + url, { method, headers: h, body: payload, redirect: 'manual' });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}
const expectErr = (r, status, code) => {
  assert.equal(r.status, status, `期望 ${status} 实得 ${r.status}: ${r.text}`);
  assert.equal(r.json.error.code, code, `期望 ${code} 实得 ${JSON.stringify(r.json)}`);
};
const expectOk = r => assert.ok(r.status >= 200 && r.status < 300, `期望 2xx 实得 ${r.status}: ${r.text}`);

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('服务 15s 内未就绪');
}

async function main() {
  step = '初始化';
  execFileSync('node', ['src/scripts/create-admin.js', 'admin', 'admin123'], { cwd: ROOT, env: ENV });
  server = spawn('node', ['src/index.js'], { cwd: ROOT, env: ENV, stdio: ['ignore', 'inherit', 'inherit'] });
  await waitUp();
  ok('服务已启动 :' + PORT);

  step = 'admin 登录';
  let r = await api('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  expectOk(r);
  assert.equal(r.json.user.role, 'admin');
  assert.equal(typeof r.json.user.id, 'string');
  assert.equal(r.json.refreshToken.length, 43);
  const admin = r.json.accessToken;
  const adminRefresh = r.json.refreshToken;
  const sid = /(?:^|, )sid=([^;]+)/.exec(r.headers.get('set-cookie') || '');
  assert.ok(sid, '登录应下发 sid Cookie');
  ok('admin 登录 + sid Cookie');

  step = 'refresh 轮换与重放吊销';
  r = await api('POST', '/api/auth/refresh', { body: { refreshToken: adminRefresh } });
  expectOk(r);
  const admin2 = r.json.accessToken, refresh2 = r.json.refreshToken;
  r = await api('POST', '/api/auth/refresh', { body: { refreshToken: adminRefresh } }); // 重放旧 token
  expectErr(r, 401, 'UNAUTHORIZED');
  r = await api('POST', '/api/auth/refresh', { body: { refreshToken: refresh2 } }); // 该设备全部已吊销
  expectErr(r, 401, 'UNAUTHORIZED');
  ok('refresh 轮换 + 重放触发全部吊销');

  step = '建科室/设备/账号';
  r = await api('POST', '/api/admin/depts', { token: admin, body: { name: '急诊科', code: 'JZ', sort: 1 } });
  expectOk(r);
  const deptId = r.json.id;
  r = await api('POST', '/api/admin/devices', { token: admin, body: { deptId, catName: '除颤仪', code: 'JZ-CD-001', name: '除颤监护仪', model: 'XD-100', location: '抢救室' } });
  expectOk(r);
  const dev1 = r.json.id;
  r = await api('POST', '/api/admin/devices', { token: admin, body: { deptId, catName: '呼吸机', code: 'JZ-HX-001', name: '转运呼吸机', model: 'HX-20', location: '抢救室' } });
  expectOk(r);
  const dev2 = r.json.id;
  r = await api('POST', '/api/admin/members', { token: admin, body: { deptId, name: '王护士长', title: '护士长' } });
  expectOk(r);
  for (const [u, role] of [['insp01', 'inspector'], ['dept01', 'dept'], ['equip01', 'equip']]) {
    r = await api('POST', '/api/admin/users', { token: admin, body: { username: u, password: 'pass123', displayName: u, role, deptIds: role === 'equip' ? [] : [deptId] } });
    expectOk(r);
  }
  ok('科室/2 设备/签字人/3 账号');

  step = '三种角色登录';
  const login = async u => {
    const x = await api('POST', '/api/auth/login', { body: { username: u, password: 'pass123' } });
    expectOk(x);
    return x.json.accessToken;
  };
  const insp = await login('insp01');
  const dept = await login('dept01');
  const equip = await login('equip01');

  step = '服务端时间';
  r = await api('GET', '/api/time', { token: insp });
  expectOk(r);
  const today = r.json.date, week = r.json.week, month = r.json.month;
  assert.equal(week, P.wkOf(today));
  ok(`/api/time today=${today} week=${week}`);

  step = 'PUT checks + 日签(今天)';
  const putDay = async d => {
    const x = await api('PUT', `/api/records/${deptId}/${d}`, { token: insp,
      body: { checks: { [dev1]: 'ok', [dev2]: 'ng' }, notes: { [dev2]: '气路漏气' } } });
    expectOk(x);
    return x;
  };
  const signDay = async d => {
    const x = await api('POST', `/api/records/${deptId}/${d}/sign`, { token: insp,
      body: { name: '李巡检', title: '技师', opinion: '设备正常', dataUrl: PNG } });
    expectOk(x);
    assert.ok(x.json.sign && x.json.sign.url.startsWith('/api/files/'));
    return x;
  };
  r = await putDay(today);
  assert.deepEqual(r.json.checks, { [dev1]: 'ok', [dev2]: 'ng' });
  const signed = await signDay(today);
  const signUrl = signed.json.sign.url;
  // 已签后再 PUT → LOCKED；未来日期 → EARLY
  expectErr(await api('PUT', `/api/records/${deptId}/${today}`, { token: insp, body: { checks: {} } }), 409, 'LOCKED');
  expectErr(await api('PUT', `/api/records/${deptId}/${P.addDay(today, 1)}`, { token: insp, body: { checks: {} } }), 400, 'EARLY');
  ok('日签 + LOCKED/EARLY 校验');

  step = '签名图下载（Bearer + Cookie 双鉴权）';
  r = await api('GET', signUrl, { token: insp, raw: true });
  assert.equal(r.status, 200);
  const png = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  r = await api('GET', signUrl, { headers: { cookie: `sid=${sid[1]}` }, raw: true });
  assert.equal(r.status, 200, 'Cookie sid 应可下载签名图');
  r = await api('GET', signUrl, { raw: true });
  assert.equal(r.status, 401, '无凭证应 401');
  ok('签名图 Bearer/Cookie 双通道，PNG 魔数正确');

  step = '周签 NOT_READY（本周未签齐时）';
  const weekSignBody = { name: '王护士长', title: '护士长', opinion: '本周正常', dataUrl: PNG };
  if (today !== week) { // 非周一：本周还有已过日期未日签
    expectErr(await api('POST', `/api/weeksigns/${deptId}/${week}/sign`, { token: dept, body: weekSignBody }), 409, 'NOT_READY');
    ok('周签在日签未齐时 NOT_READY');
  } else ok('今天是周一，跳过 NOT_READY 分支');
  // inspector 无权周签
  expectErr(await api('POST', `/api/weeksigns/${deptId}/${week}/sign`, { token: insp, body: weekSignBody }), 403, 'FORBIDDEN');

  step = '补齐本周已过日期的日签';
  for (let d = week; d < today; d = P.addDay(d, 1)) { await putDay(d); await signDay(d); }
  ok('本周已过日期全部日签');

  step = '月签 NOT_READY（本周尚未周签）';
  const monthSignBody = { name: '赵设备科', title: '工程师', opinion: '当月合格', dataUrl: PNG };
  expectErr(await api('POST', `/api/monthsigns/${deptId}/${month}/sign`, { token: equip, body: monthSignBody }), 409, 'NOT_READY');
  ok('本月存在未周签的已开始周 → NOT_READY');

  step = '周签走通';
  r = await api('POST', `/api/weeksigns/${deptId}/${week}/sign`, { token: dept, body: weekSignBody });
  expectOk(r);
  assert.equal(r.json.stat.days, P.wkDays(week).filter(d => d <= today).length);
  expectErr(await api('POST', `/api/weeksigns/${deptId}/${week}/sign`, { token: dept, body: weekSignBody }), 409, 'LOCKED');
  // 周签后该周日期 PUT 锁定
  expectErr(await api('PUT', `/api/records/${deptId}/${week}`, { token: insp, body: { checks: {} } }), 409, 'LOCKED');
  ok('周签 + 重复 LOCKED + 周内记录锁定');

  step = '构造整月数据走通月签';
  // 找最近一个「所有周都已结束」的月份（周一 ≤ today-7 才算结束周）
  let M = P.prevMonth(month);
  const allEnded = m => P.wksOfMonth(m, today).every(w => P.addDay(w, 6) < today);
  while (!allEnded(M) || !P.wksOfMonth(M, today).length) M = P.prevMonth(M);
  for (const w of P.wksOfMonth(M, today)) {
    for (const d of P.wkDays(w)) { await putDay(d); await signDay(d); }
    r = await api('POST', `/api/weeksigns/${deptId}/${w}/sign`, { token: dept, body: weekSignBody });
    expectOk(r);
  }
  r = await api('POST', `/api/monthsigns/${deptId}/${M}/sign`, { token: equip, body: monthSignBody });
  expectOk(r);
  assert.equal(r.json.stat.weeks, P.wksOfMonth(M, today).length);
  expectErr(await api('POST', `/api/monthsigns/${deptId}/${M}/sign`, { token: equip, body: monthSignBody }), 409, 'LOCKED');
  ok(`月签走通（${M}，${P.wksOfMonth(M, today).length} 周）`);

  step = '导出 monthly.xlsx';
  r = await api('GET', `/api/export/monthly.xlsx?deptId=${deptId}&month=${M}`, { token: equip, raw: true });
  assert.equal(r.status, 200);
  const xlsx = Buffer.from(await r.arrayBuffer());
  assert.ok(xlsx.length > 1000, 'xlsx 非空');
  assert.equal(xlsx.subarray(0, 2).toString('latin1'), 'PK', 'xlsx 应是 zip(PK) 魔数');
  ok(`monthly.xlsx ${xlsx.length} bytes，PK 魔数正确`);

  step = 'stats 四端点';
  for (const url of ['/api/stats/unsigned', `/api/stats/completion?month=${M}`,
    `/api/stats/ng?from=${M}-01&to=${M}-31`, `/api/stats/signatures?month=${M}`]) {
    r = await api('GET', url, { token: equip });
    expectOk(r);
  }
  r = await api('GET', `/api/stats/completion?month=${M}&deptId=${deptId}`, { token: equip });
  assert.equal(r.json[0].monthSigned, true);
  assert.ok(r.json[0].ng > 0);
  r = await api('GET', `/api/stats/ng?from=${M}-01&to=${M}-31`, { token: equip });
  assert.ok(r.json.length > 0 && r.json[0].note === '气路漏气');
  expectErr(await api('GET', '/api/stats/unsigned', { token: insp }), 403, 'FORBIDDEN');
  ok('stats unsigned/completion/ng/signatures');

  step = 'ams 网关';
  r = await api('GET', '/api/ams/snapshot', { token: equip });
  expectOk(r);
  assert.deepEqual(r.json.keys, {});
  r = await api('POST', '/api/ams/push', { token: equip,
    body: { deviceId: 'pc-1', changes: [{ key: 'ams:assets', value: '[{"id":1}]', baseVersion: 0 }] } });
  expectOk(r);
  assert.equal(r.json.results[0].ok, true);
  assert.equal(r.json.results[0].newVersion, 1);
  // 乐观锁冲突
  r = await api('POST', '/api/ams/push', { token: equip,
    body: { deviceId: 'pc-2', changes: [{ key: 'ams:assets', value: '[]', baseVersion: 0 }] } });
  assert.equal(r.json.results[0].ok, false);
  assert.equal(r.json.results[0].conflict.version, 1);
  assert.equal(r.json.results[0].conflict.value, '[{"id":1}]');
  // 白名单外 key 拒绝
  r = await api('POST', '/api/ams/push', { token: equip,
    body: { deviceId: 'pc-1', changes: [{ key: 'ams:session', value: 'x', baseVersion: 0 }] } });
  assert.equal(r.json.results[0].ok, false);
  r = await api('GET', '/api/ams/changes?since=0', { token: equip });
  assert.ok(r.json.keys['ams:assets']);
  assert.equal(r.json.keys['ams:assets'].version, 1);
  // 附件 PUT/GET/DELETE
  const bin = Buffer.from('ams-file-content');
  const metaAscii = JSON.stringify({ assetId: 'a1', name: '照片' })
    .replace(/[\u0080-\uffff]/g, ch => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  r = await api('PUT', '/api/ams/files/f1', { token: equip, body: bin, headers: { 'x-ams-meta': metaAscii } });
  expectOk(r);
  const seqAfterPut = r.json.seq;
  r = await api('PUT', '/api/ams/files/f1', { token: equip, body: bin,
    headers: { 'x-ams-meta': JSON.stringify({ assetId: 'a1' }) } }); // 幂等重传不推进 seq
  assert.equal(r.json.seq, seqAfterPut);
  r = await api('GET', '/api/ams/files/f1', { token: equip, raw: true });
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(await r.arrayBuffer()).toString(), 'ams-file-content');
  r = await api('GET', '/api/ams/files/manifest', { token: equip });
  assert.equal(r.json.length, 1);
  r = await api('DELETE', '/api/ams/files/f1', { token: equip });
  expectOk(r);
  r = await api('GET', '/api/ams/files/f1', { token: equip, raw: true });
  assert.equal(r.status, 404, '墓碑后应 404');
  // presence
  r = await api('PUT', '/api/ams/presence', { token: equip, body: { deviceId: 'pc-1' } });
  assert.deepEqual(r.json.others, []);
  r = await api('PUT', '/api/ams/presence', { token: equip, body: { deviceId: 'pc-2' } });
  assert.equal(r.json.others[0].deviceId, 'pc-1');
  // inspector 无权访问 ams
  expectErr(await api('GET', '/api/ams/snapshot', { token: insp }), 403, 'FORBIDDEN');
  ok('ams snapshot/push/冲突/白名单/changes/附件/presence');

  step = '登录冻结（连错 5 次 → 423）';
  for (let i = 1; i <= 4; i++) {
    expectErr(await api('POST', '/api/auth/login', { body: { username: 'insp01', password: 'wrong' } }), 401, 'UNAUTHORIZED');
  }
  r = await api('POST', '/api/auth/login', { body: { username: 'insp01', password: 'wrong' } });
  expectErr(r, 423, 'FROZEN');
  assert.ok(r.json.error.retryAfter > 0);
  // 冻结中即使密码正确也 423
  expectErr(await api('POST', '/api/auth/login', { body: { username: 'insp01', password: 'pass123' } }), 423, 'FROZEN');
  // login-state 如实返回 frozen
  r = await api('GET', '/api/auth/login-state?username=insp01');
  assert.equal(r.json.frozen, true);
  ok('第 5 次错误密码触发 FROZEN，login-state.frozen=true');

  step = '枚举冷却（不存在账号连打 → 429）';
  let last = null;
  for (let i = 0; i < 8; i++) {
    last = await api('POST', '/api/auth/login', { body: { username: `ghost${i}`, password: 'x' }, device: 'smoke-probe' });
  }
  expectErr(last, 429, 'PROBE_COOLDOWN');
  assert.ok(last.json.error.retryAfter > 0);
  ok('枚举冷却 PROBE_COOLDOWN 429');

  console.log('\nSMOKE PASS  （数据目录：' + DATA_DIR + '）');
}

main()
  .then(() => { server && server.kill(); process.exit(0); })
  .catch(e => {
    console.error(`\nSMOKE FAIL @ ${step}`);
    console.error(e);
    server && server.kill();
    process.exit(1);
  });
