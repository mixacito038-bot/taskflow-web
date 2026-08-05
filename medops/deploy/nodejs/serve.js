'use strict';
/* 生产级 Node 启动器（无需 Docker）
 *
 * 一个对外进程：监听 0.0.0.0:PORT，静态文件直出 + /api 反代到内部后端子进程。
 * 与试跑版 local/start.js 的差别：
 *   · 后端子进程崩溃自动重启（指数退避，稳定运行 60s 后重置）
 *   · 后端重启期间对 /api 返回 503 而不是把连接打挂
 *   · 结构化日志（launchd 会收进日志文件）
 *   · 静态资源缓存头；只读校验，防目录穿越
 *   · 优雅退出：先停子进程再退出，避免 SQLite 写一半
 *
 * 环境变量：PORT(默认 8080) DATA_DIR JWT_SECRET_FILE
 * 由 setup.sh 生成的 launchd 服务负责拉起本文件；也可手动 `node serve.js` 前台运行。
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const HERE = __dirname;                                   // medops/deploy/nodejs
const MEDOPS = path.resolve(HERE, '..', '..');            // medops
const SERVER_DIR = path.join(MEDOPS, 'server');

/* config.env：改端口改这里，然后重启服务即可（KEY=VALUE，# 开头为注释） */
const CONF_FILE = path.join(HERE, 'config.env');
if (fs.existsSync(CONF_FILE)) {
  for (const line of fs.readFileSync(CONF_FILE, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PORT = +(process.env.PORT || 8080);
const API_PORT = +(process.env.API_PORT || 3111);         // 只监听 127.0.0.1，不对外
const DATA_DIR = process.env.DATA_DIR || path.resolve(MEDOPS, '..', 'data');
const SECRET_FILE = process.env.JWT_SECRET_FILE || path.join(DATA_DIR, '.jwt-secret');

const log = (lvl, msg) => {
  const t = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  console.log(`[${t}] [${lvl}] ${msg}`);
};

if (!fs.existsSync(SECRET_FILE)) {
  log('FATAL', `找不到密钥文件 ${SECRET_FILE}，请先运行 setup.sh`);
  process.exit(1);
}
const JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
if (!JWT_SECRET) { log('FATAL', '密钥文件为空，请删除后重新运行 setup.sh'); process.exit(1); }

/* ---------------- 后端子进程守护 ---------------- */
let child = null;
let stopping = false;
let backoff = 1000;                 // 崩溃重启退避：1s 起，最大 30s
let startedAt = 0;
let apiReady = false;

function startApi() {
  if (stopping) return;
  const env = { ...process.env, PORT: String(API_PORT), HOST: '127.0.0.1',
    DATA_DIR, JWT_SECRET, TZ: 'Asia/Shanghai' };
  child = spawn(process.execPath, ['src/index.js'], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  startedAt = Date.now();
  apiReady = false;

  const relay = pfx => buf => String(buf).split('\n').filter(Boolean).forEach(l => log(pfx, l));
  child.stdout.on('data', relay('API'));
  child.stderr.on('data', relay('API!'));

  child.on('exit', (code, sig) => {
    apiReady = false;
    if (stopping) return;
    const alive = Date.now() - startedAt;
    if (alive > 60000) backoff = 1000;                     // 稳定跑过 1 分钟，退避归零
    log('WARN', `后端进程退出（code=${code} signal=${sig}），${backoff / 1000}s 后重启`);
    setTimeout(startApi, backoff);
    backoff = Math.min(backoff * 2, 30000);
  });
  child.on('error', e => log('ERROR', '拉起后端失败：' + e.message));
  probeApi();
}

let probeTimer = null;
function probeApi() {
  if (probeTimer) clearInterval(probeTimer);      // 上一轮探测若还在跑，先收掉，避免多轮叠加
  const t = setInterval(() => {
    if (stopping || !child || probeTimer !== t) return clearInterval(t);
    const q = http.get({ host: '127.0.0.1', port: API_PORT, path: '/api/health', timeout: 1500 }, r => {
      r.resume();
      if (r.statusCode === 200 && !apiReady) { apiReady = true; log('INFO', '后端已就绪'); clearInterval(t); }
    });
    q.on('error', () => {});
    q.on('timeout', () => q.destroy());
  }, 1000);
  t.unref && t.unref();
}

/* ---------------- 静态服务 + /api 反代 ---------------- */
const MOUNTS = [                                           // 前缀 → 目录（顺序即优先级）
  ['/xunjian/', path.join(MEDOPS, 'h5')],
  ['/admin/', path.join(MEDOPS, 'admin', 'dist')],
  ['/pandian/', path.join(MEDOPS, 'ams', 'dist')],
  ['/', path.join(MEDOPS, 'deploy', 'landing')]
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function sendFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  // 带内容哈希的构建产物长期缓存，其余一律 no-cache（靠 ETag 走 304）
  const hashed = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(file.replace(/\\/g, '/'));
  const st = fs.statSync(file);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': st.size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'last-modified': st.mtime.toUTCString()
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); }
  catch { res.writeHead(400); return res.end('bad request'); }

  /* --- /api 反代 --- */
  if (url.startsWith('/api/')) {
    if (!apiReady) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '5' });
      return res.end(JSON.stringify({ error: { code: 'STARTING', message: '服务正在启动，请几秒后重试' } }));
    }
    const p = http.request(
      { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers },
      pr => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
    p.on('error', e => {
      log('WARN', `反代失败 ${req.method} ${req.url}：${e.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: { code: 'BAD_GATEWAY', message: '后端暂时不可用' } }));
      } else res.destroy();
    });
    req.pipe(p);
    return;
  }

  /* --- 静态文件 --- */
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    if (url === prefix.slice(0, -1)) {                     // /admin → /admin/
      res.writeHead(302, { location: prefix }); return res.end();
    }
    const rel = url.slice(prefix.length);
    let file = path.join(dir, rel);
    if (path.relative(dir, file).startsWith('..')) {       // 目录穿越防护
      res.writeHead(403); return res.end('forbidden');
    }
    if (!rel || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    if (!fs.existsSync(file)) continue;                    // 落到下一个挂载点
    try { return sendFile(res, file); }
    catch (e) { log('ERROR', `读取 ${file} 失败：${e.message}`); res.writeHead(500); return res.end('server error'); }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') log('FATAL', `端口 ${PORT} 已被占用。改端口：在 config.env 里设置 PORT= 后重启服务`);
  else if (e.code === 'EACCES') log('FATAL', `没有权限监听端口 ${PORT}。1024 以下端口需要 root，建议改用 8080`);
  else log('FATAL', '监听失败：' + e.message);
  process.exit(1);
});

/* ---------------- 优雅退出 ---------------- */
function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log('INFO', `收到 ${sig}，正在停止…`);
  server.close();
  if (child) { child.kill('SIGTERM'); setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000); }
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', e => { log('ERROR', '未捕获异常：' + (e && e.stack || e)); });

/* ---------------- 启动 ---------------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
log('INFO', `数据目录 ${DATA_DIR}`);
startApi();
server.listen(PORT, '0.0.0.0', () => log('INFO', `网页服务已监听 0.0.0.0:${PORT}`));
