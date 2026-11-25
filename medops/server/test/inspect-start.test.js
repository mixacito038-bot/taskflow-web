'use strict';
/* 巡检起算日：设备早就录进系统、真正开始巡检是后来某个周一。设成那天以后：
   - 这天以前的日子、周、月不再提醒（后台首页、手机端），不算缺签（统计应巡天数、周签进度）
   - 起算日所在月的月签只要求起算日所在周及以后的周签；整个月都在起算日以前的仍按原规则
   - 只有设备科能改，必须是周一、不晚于本周；改动记操作日志；清空恢复原样
   起一个真实的后端进程测。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const P = require('../src/services/period.service');

const ROOT = path.join(__dirname, '..');
const PORT = 3296;
const BASE = `http://127.0.0.1:${PORT}`;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
let server, admin, nurse, insp, dept, dev, member, today;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'istart-'));
const ENV = { ...process.env, DATA_DIR: dir, JWT_SECRET: 'istart-test', PORT: String(PORT),
  RL_GLOBAL: '100000', RL_LOGIN: '100000', RL_IP: '0', LOG_LEVEL: 'silent' };

async function api(method, url, { token, body } = {}) {
  const h = { 'x-device-id': 'istart-dev' };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* 空 */ }
  return { status: res.status, json };
}
const ok = (r, msg) => { assert.ok(r.status === 200, `${msg || ''} 期望 200，实际 ${r.status} ${JSON.stringify(r.json)}`); return r.json; };
const login = async (u, p) => ok(await api('POST', '/api/auth/login', { body: { username: u, password: p } })).accessToken;
const setStart = (date, token = admin) => api('PUT', '/api/admin/settings/inspect-start', { token, body: { date } });
const signDay = async date => {
  ok(await api('PUT', `/api/records/${dept}/${date}`, { token: insp, body: { checks: { [dev]: 'ok' } } }), date);
  ok(await api('POST', `/api/records/${dept}/${date}/sign`, { token: insp, body: { opinion: '正常', dataUrl: PNG } }), date);
};
const unsigned = async () => ok(await api('GET', '/api/stats/unsigned', { token: admin }));

/* 最近一个「各周都已结束」的月（月签能签的最近一个月），以及它前一个月 */
let M, PREV, wks;

test.before(async () => {
  execFileSync('node', ['src/scripts/create-admin.js', 'admin', 'admin123'], { cwd: ROOT, env: ENV });
  server = spawn('node', ['src/index.js'], { cwd: ROOT, stdio: 'ignore', env: ENV });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  admin = await login('admin', 'admin123');
  dept = ok(await api('POST', '/api/admin/depts', { token: admin, body: { name: '急诊科' } })).id;
  dev = ok(await api('POST', '/api/admin/devices', { token: admin, body: { deptId: dept, catName: '除颤仪', code: 'JZ-1', name: '除颤仪' } })).id;
  member = ok(await api('POST', '/api/admin/members', { token: admin, body: { deptId: dept, name: '王护士长', title: '护士长' } })).id;
  for (const [u, role] of [['xj01', 'inspector'], ['hsz01', 'dept']]) {
    ok(await api('POST', '/api/admin/users', { token: admin, body: { username: u, password: 'pass123', displayName: u, role, deptIds: [dept] } }));
  }
  insp = await login('xj01', 'pass123');
  nurse = await login('hsz01', 'pass123');
  today = ok(await api('GET', '/api/time', { token: admin })).date;
  M = P.moOf(today);
  while (!P.wksOfMonth(M).every(w => P.addDay(w, 6) < today)) M = P.prevMonth(M);
  PREV = P.prevMonth(M);
  wks = P.wksOfMonth(M);
  // 很早以前补录过一天（科室起算日因此提前到那天）：前一个月第一周的周一
  await signDay(P.wksOfMonth(PREV)[0]);
  // M 的最后两周 14 天全部日签，并由护士长周签
  for (const w of wks.slice(-2)) {
    for (const d of P.wkDays(w)) await signDay(d);
    ok(await api('POST', `/api/weeksigns/${dept}/${w}/sign`, { token: nurse, body: { memberId: member, opinion: '本周正常', dataUrl: PNG } }), w);
  }
});
test.after(() => { if (server) server.kill(); });

test('requiredWeeks：起算日所在周及以后；整个月在起算日以前的仍要全部周', () => {
  const m = '2026-11';
  assert.deepEqual(P.wksOfMonth(m), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  assert.deepEqual(P.requiredWeeks(m, '2026-11-23'), ['2026-11-23', '2026-11-30']);
  assert.deepEqual(P.requiredWeeks(m, null), P.wksOfMonth(m));
  assert.deepEqual(P.requiredWeeks('2026-10', '2026-11-23'), P.wksOfMonth('2026-10'), '整个月都在起算日以前：原规则');
  assert.deepEqual(P.requiredWeeks('2026-12', '2026-11-23'), P.wksOfMonth('2026-12'));
  assert.deepEqual(P.requiredWeeks(m, '2026-11-25'), ['2026-11-23', '2026-11-30'], '起算日不是周一（科室周中新建）：所在周起');
});

test('设置：默认不限；护士长不能改；必须是周一、不晚于本周、真实日期', async () => {
  assert.deepEqual(ok(await api('GET', '/api/admin/settings', { token: nurse })), { inspectStart: null });
  assert.equal((await setStart(P.wkOf(today), nurse)).status, 403);
  assert.equal((await setStart(P.wkOf(today), insp)).status, 403);
  let r = await setStart(P.addDay(P.wkOf(today), 2));
  assert.equal(r.status, 400); assert.match(r.json.error.message, /周一/);
  r = await setStart(P.addDay(P.wkOf(today), 7));
  assert.equal(r.status, 400); assert.match(r.json.error.message, /不能晚于本周/);
  r = await setStart('2026-02-30');
  assert.equal(r.status, 400);
  r = await setStart('abc');
  assert.equal(r.status, 400);
  assert.deepEqual(ok(await api('GET', '/api/admin/settings', { token: admin })), { inspectStart: null }, '失败的不改动');
});

test('月签：没设起算日时要 M 的全部周；起算日设到倒数第二周后只要后两周', async () => {
  const sign = () => api('POST', `/api/monthsigns/${dept}/${M}/sign`, { token: admin, body: { opinion: '合格', dataUrl: PNG } });
  let r = await sign();
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.error.code, 'NOT_READY');
  const ms0 = ok(await api('GET', `/api/stats/month-states?months=${M}`, { token: admin }))[0];
  assert.equal(ms0.ready, false);
  assert.equal(ms0.weeks.length, wks.length);

  const start = wks[wks.length - 2];
  assert.deepEqual(ok(await setStart(start)), { inspectStart: start });
  // 统计、月度状态、科室起算日都跟着变
  const d = ok(await api('GET', `/api/depts/${dept}`, { token: admin }));
  assert.equal(d.startDate, start);
  const ms = ok(await api('GET', `/api/stats/month-states?months=${M}`, { token: admin }))[0];
  assert.deepEqual(ms.weeks, wks.slice(-2));
  assert.deepEqual(ms.allWeeks, wks);
  assert.equal(ms.ready, true);
  assert.equal(ms.dsign, 14);
  assert.equal(ms.dueDays, 14);
  const comp = ok(await api('GET', `/api/stats/completion?month=${M}`, { token: admin }))[0];
  assert.equal(comp.weekTotal, 2);
  assert.equal(comp.weekSigned, 2);
  assert.ok(comp.dueDays <= 14 && comp.signedDays <= comp.dueDays, JSON.stringify(comp));

  const out = ok(await sign());
  assert.equal(out.stat.weeks, 2);
  // 体检脚本用同一规则：这个月签不算违规
  const chk = execFileSync('node', ['src/scripts/check-signs.js'], { cwd: ROOT, env: ENV }).toString();
  assert.ok(!chk.includes(`✗ 月签 · 急诊科 · ${M}`), chk);
});

test('整个月都在起算日以前：仍要全部周（补签以前的月份不放宽）', async () => {
  const r = await api('POST', `/api/monthsigns/${dept}/${PREV}/sign`, { token: admin, body: { opinion: '合格', dataUrl: PNG } });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'NOT_READY');
});

test('提醒：起算日以前的日子、周、月都不提醒；清空后恢复', async () => {
  const start = P.wkOf(today);
  ok(await setStart(start));
  let u = await unsigned();
  assert.ok(u.days.every(x => x.date >= start), JSON.stringify(u.days));
  assert.ok(u.weeks.every(x => x.week >= start), JSON.stringify(u.weeks));
  assert.deepEqual(u.months, [], '整月都在起算日以前的月不提醒');
  assert.equal(ok(await api('GET', `/api/depts/${dept}`, { token: insp })).startDate, start, '手机端拿到的科室起算日');
  // 看以前的月份（整月都在起算日以前）：照实统计，签过的天数不被抹成 0
  const pc = ok(await api('GET', `/api/stats/completion?month=${PREV}`, { token: admin }))[0];
  assert.ok(pc.signedDays >= 1 && pc.dueDays >= pc.signedDays, '以前月份的统计照实显示：' + JSON.stringify(pc));
  const pm = ok(await api('GET', `/api/stats/month-states?months=${PREV}`, { token: admin }))[0];
  assert.ok(pm.dsign >= 1 && pm.dueDays >= 28, '以前月份的月度状态照实显示：' + JSON.stringify({ dsign: pm.dsign, dueDays: pm.dueDays }));
  assert.equal(pm.weeks.length, pm.allWeeks.length, '以前月份仍要全部周');

  ok(await setStart(''));
  assert.deepEqual(ok(await api('GET', '/api/admin/settings', { token: admin })), { inspectStart: null });
  u = await unsigned();
  assert.ok(u.weeks.some(x => x.week < start), '清空后以前缺的周签又提醒了：' + JSON.stringify(u.weeks));
  assert.ok(u.months.some(x => x.month === PREV), '前一个月缺月签又提醒了：' + JSON.stringify(u.months));
});

test('操作日志：记下谁改的、改前改后', async () => {
  const log = ok(await api('GET', '/api/admin/oplog?size=0&module=%E7%B3%BB%E7%BB%9F', { token: admin }));
  const rows = log.items.filter(x => x.op === '修改巡检起算日');
  assert.ok(rows.length >= 3, JSON.stringify(rows.map(x => x.summary)));
  assert.ok(rows.every(x => x.username === 'admin'));
  assert.ok(rows.some(x => x.changes.some(c => c.f === '巡检起算日' && c.to === '（不限）')));
});
