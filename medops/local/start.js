'use strict';
/* 本地试跑一键启动器 —— 只需装 Node.js 18+，不需要 Docker、不需要域名。
 *
 *   node local/start.js
 *
 * 它会：① 首次自动装后端依赖 ② 生成本地密钥 ③ 建管理员 admin/admin123
 *       ④ 起后端(:3000) ⑤ 起静态服务(:8080，代理 /api 到后端) ⑥ 打印访问地址
 * 数据存在 medops/data-local/，删掉该目录即可从零重来。
 * 端口被占用时：PORT=3001 WEB_PORT=8081 node local/start.js
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data-local');
const API_PORT = +(process.env.PORT || 3000);
const WEB_PORT = +(process.env.WEB_PORT || 8080);
const IS_WIN = process.platform === 'win32';

const log = m => console.log(m);
const step = m => console.log('\n▸ ' + m);
const die = m => { console.error('\n✗ ' + m + '\n'); process.exit(1); };

/* ---------- 0. 环境自检 ---------- */
const major = +process.versions.node.split('.')[0];
if (major < 18) die(`Node.js 版本过低（当前 ${process.version}），请安装 18 或更高版本：https://nodejs.org/`);

for (const p of [path.join(SERVER, 'package.json'), path.join(ROOT, 'h5', 'index.html')]) {
  if (!fs.existsSync(p)) die(`找不到 ${p}\n请在解压后的 medops 目录里运行：node local/start.js`);
}

/* ---------- 1. 依赖 ---------- */
if (!fs.existsSync(path.join(SERVER, 'node_modules'))) {
  step('首次运行，正在安装后端依赖（需要联网，约 1～3 分钟）…');
  const r = spawnSync('npm', ['install', '--omit=dev'], { cwd: SERVER, stdio: 'inherit', shell: IS_WIN });
  if (r.status !== 0) {
    die('依赖安装失败。常见原因：\n' +
        '  · 没联网或公司网络限制 → 换个网络重试\n' +
        '  · npm 太慢 → 先执行：npm config set registry https://registry.npmmirror.com\n' +
        '  · better-sqlite3 编译失败 → 改用 Docker 方式，见《本地试跑指南.md》');
  }
} else {
  log('✓ 后端依赖已就绪');
}

/* ---------- 2. 本地密钥 ---------- */
fs.mkdirSync(DATA, { recursive: true });
const secretFile = path.join(DATA, '.jwt-secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'));
const JWT_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
const ENV = { ...process.env, DATA_DIR: DATA, JWT_SECRET, PORT: String(API_PORT), TZ: 'Asia/Shanghai' };

/* ---------- 3. 管理员账号 ---------- */
if (!fs.existsSync(path.join(DATA, 'app.db'))) {
  step('初始化数据库并创建管理员 admin / admin123 …');
  const r = spawnSync('node', ['src/scripts/create-admin.js', 'admin', 'admin123'],
    { cwd: SERVER, env: ENV, stdio: 'inherit' });
  if (r.status !== 0) die('创建管理员失败，请把上方报错发给我');
} else {
  log('✓ 数据库已存在（如需从零重来，删除 ' + DATA + ' 后重跑）');
}

/* ---------- 4. 后端 ---------- */
step(`启动后端服务 :${API_PORT} …`);
const api = spawn('node', ['src/index.js'], { cwd: SERVER, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
let apiLog = '';
api.stdout.on('data', d => { apiLog += d; });
api.stderr.on('data', d => { apiLog += d; });
api.on('exit', code => {
  if (code !== 0 && code !== null) {
    console.error('\n✗ 后端退出，日志如下：\n' + apiLog.slice(-2000));
    if (/EADDRINUSE/.test(apiLog)) console.error(`\n提示：${API_PORT} 端口被占用，改用：PORT=3001 WEB_PORT=8081 node local/start.js`);
    process.exit(1);
  }
});

/* ---------- 5. 静态服务 + /api 反代（等效生产环境的 nginx） ---------- */
const MOUNTS = [                                  // 前缀 → 目录（顺序即匹配优先级）
  ['/xunjian/', path.join(ROOT, 'h5'), 'index.html'],
  ['/admin/', path.join(ROOT, 'admin', 'dist'), 'index.html'],
  ['/pandian/', path.join(ROOT, 'ams', 'dist'), 'index.html'],
  ['/', path.join(ROOT, 'deploy', 'landing'), 'index.html']
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json'
};

const web = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  if (url.startsWith('/api/')) {                  // 反代到后端
    const p = http.request(
      { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers },
      pr => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
    p.on('error', () => { res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('后端未就绪'); });
    req.pipe(p);
    return;
  }

  for (const [prefix, dir, fallback] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    if (url === prefix.slice(0, -1)) {             // /admin → /admin/
      res.writeHead(302, { location: prefix }); res.end(); return;
    }
    const rel = url.slice(prefix.length) || fallback;
    let file = path.join(dir, rel);
    if (!file.startsWith(dir)) { res.writeHead(403); res.end(); return; }   // 目录穿越保护
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, fallback);
    if (!fs.existsSync(file)) continue;            // 落到下一个挂载点
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404');
});

/* ---------- 6. 等后端就绪后提示 ---------- */
async function waitApi() {
  for (let i = 0; i < 80; i++) {
    try {
      const ok = await new Promise(r => {
        const q = http.get({ host: '127.0.0.1', port: API_PORT, path: '/api/health', timeout: 1000 },
          resp => { resp.resume(); r(resp.statusCode === 200); });
        q.on('error', () => r(false)); q.on('timeout', () => { q.destroy(); r(false); });
      });
      if (ok) return true;
    } catch { /* 继续等 */ }
    await new Promise(r => setTimeout(r, 250));
  }
  return false;
}

web.listen(WEB_PORT, async () => {
  const ok = await waitApi();
  if (!ok) {
    console.error('\n✗ 后端 20 秒内没起来，日志如下：\n' + apiLog.slice(-2000));
    process.exit(1);
  }
  const base = `http://localhost:${WEB_PORT}`;
  log('\n' + '='.repeat(58));
  log('  ✓ 系统已启动，用浏览器打开下面任意地址');
  log('='.repeat(58));
  log(`  入口页        ${base}/`);
  log(`  巡检 H5       ${base}/xunjian/      （手机端页面，可用浏览器手机模式看）`);
  log(`  管理后台      ${base}/admin/`);
  log(`  资产盘点      ${base}/pandian/`);
  log('');
  log('  管理员账号    admin / admin123   （仅本地试跑；正式部署由安装脚本让你自己设密码）');
  log(`  数据目录      ${DATA}`);
  log('');
  log('  停止：在本窗口按 Ctrl + C');
  log('='.repeat(58) + '\n');
});

const bye = () => { try { api.kill(); } catch { /* 已退出 */ } process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
