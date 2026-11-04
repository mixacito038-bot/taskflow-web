'use strict';
/* 限流：按「设备 + IP」计，一台设备超限不连累同一出口 IP 下的其他设备；整个 IP 另有总量上限；
   登录仍按 IP 计（换设备号绕不开）；健康检查不计数。起一个真实的后端进程，限流值调小来测。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3291;
const BASE = `http://127.0.0.1:${PORT}`;
let server;

test.before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-'));
  server = spawn('node', ['src/index.js'], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, DATA_DIR: dir, JWT_SECRET: 'rl-test', PORT: String(PORT),
      RL_GLOBAL: '5', RL_IP: '12', RL_LOGIN: '3', LOG_LEVEL: 'silent' }
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('后端没有起来');
});
test.after(() => { if (server) server.kill(); });

const get = dev => fetch(BASE + '/api/time', { headers: dev ? { 'x-device-id': dev } : {} });
const login = dev => fetch(BASE + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-device-id': dev },
  body: JSON.stringify({ username: 'nobody', password: 'x' })
});

test('按设备计、登录按 IP 计、整个 IP 有总上限', async () => {
  // 设备 A：每分钟 5 次（没登录也计数），第 6 次 429，带 retryAfter
  for (let i = 0; i < 5; i++) assert.equal((await get('dev-A')).status, 401);
  const r6 = await get('dev-A');
  assert.equal(r6.status, 429);
  const b6 = await r6.json();
  assert.equal(b6.error.code, 'RATE_LIMITED');
  assert.ok(b6.error.retryAfter > 0 && b6.error.retryAfter <= 60);
  // 同一个 IP 下的设备 B 不受影响（以前按 IP 计，这里会被一起挡住）
  assert.equal((await get('dev-B')).status, 401, '设备 B 照常');
  // 登录按 IP：换 3 个设备号各登 1 次后，第 4 个设备号也被挡（设备号换着来绕不开）
  for (const d of ['L1', 'L2', 'L3']) assert.notEqual((await login(d)).status, 429);
  assert.equal((await login('L4')).status, 429, '登录按 IP 限流');
  // 到这里这个 IP 已经 6 + 1 + 4 = 11 次；第 12 次还行，第 13 次触发整个 IP 的上限
  assert.equal((await get('dev-C')).status, 401);
  const over = await get('dev-D');
  assert.equal(over.status, 429, '整个 IP 超过总上限');
  assert.equal((await over.json()).error.code, 'RATE_LIMITED');
  assert.ok(+over.headers.get('retry-after') > 0);
  // 健康检查不计数、不受限
  for (let i = 0; i < 3; i++) assert.equal((await fetch(BASE + '/api/health')).status, 200);
});
