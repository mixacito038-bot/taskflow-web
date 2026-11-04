'use strict';
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const cfg = require('./config');
const { initDb } = require('./db/connection');
const { migrate } = require('./db/migrate');
const fileSvc = require('./services/file.service');

if (!cfg.jwtSecret) {
  console.error('缺少环境变量 JWT_SECRET');
  process.exit(1);
}

const db = initDb(cfg.dataDir);
migrate(db);
fileSvc.initFiles(cfg.dataDir);
fs.mkdirSync(path.join(cfg.dataDir, 'files'), { recursive: true });

async function build() {
  const app = require('fastify')({
    logger: { level: process.env.LOG_LEVEL || 'info' },
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: cfg.trustProxy
  });

  await app.register(require('@fastify/helmet'), { contentSecurityPolicy: false });
  await app.register(require('./plugins/error'));
  /* 全局限流按「设备 + IP」计：医院整栋楼共用一个出口 IP，按 IP 计的话，一台手机请求多了，
     全院所有手机、电脑都一起被挡（2026-11 设备科手机首页曾因此显示「请求过于频繁」）。
     没带设备号的请求仍按 IP 计。登录 / 改密码在路由上单独按 IP 限流，不受这里影响。 */
  await app.register(require('@fastify/rate-limit'), {
    global: true, max: cfg.rl.global, timeWindow: '1 minute',
    keyGenerator: req => {
      const dev = String(req.headers['x-device-id'] || '').slice(0, 64);
      return dev ? `${dev}|${req.ip}` : req.ip;
    },
    /* 必须带上 statusCode：@fastify/rate-limit 会把这个对象当作 error 抛给 setErrorHandler，
       不带 statusCode 的话 error 插件识别不出来，会当成未知异常返回 500——
       实测触发限流时客户端收到的是「服务器内部错误」而不是「请求过于频繁」。 */
    errorResponseBuilder: (req, ctx) => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: '请求过于频繁', retryAfter: Math.ceil((ctx.ttl || 0) / 1000) }
    })
  });
  /* 同一个出口 IP 的总量上限（每分钟 RL_IP 次，0 = 不限）：上面按设备计，脚本不停换设备号狂刷时靠这里兜住 */
  if (cfg.rl.ip > 0) {
    const hits = new Map(); let win = Date.now();
    app.addHook('onRequest', async (req, reply) => {
      if (!req.url.startsWith('/api/') || req.url.startsWith('/api/health')) return;
      const now = Date.now();
      if (now - win >= 60000) { hits.clear(); win = now; }
      const n = (hits.get(req.ip) || 0) + 1;
      hits.set(req.ip, n);
      if (n > cfg.rl.ip) {
        const s = Math.max(1, Math.ceil((win + 60000 - now) / 1000));
        reply.header('retry-after', String(s));
        throw app.E.rateLimited(s);
      }
    });
  }
  await app.register(require('./plugins/auth'), { cfg });

  app.get('/api/health', { config: { rateLimit: false } }, async () => ({ ok: true }));

  await app.register(require('./routes/auth.routes'), { cfg });
  await app.register(require('./routes/insp.routes'));
  await app.register(require('./routes/admin.routes'));
  await app.register(require('./routes/stats.routes'));
  await app.register(require('./routes/export.routes'), { cfg });
  await app.register(require('./routes/ams.routes'));

  return app;
}

build().then(app => {
  /* 每日 02:30 备份：VACUUM INTO + tar files/，保留 30 天 */
  cron.schedule('30 2 * * *', () => {
    try { require('./scripts/backup').runBackup(cfg.dataDir); }
    catch (e) { app.log.error(e, '定时备份失败'); }
  }, { timezone: 'Asia/Shanghai' });

  app.listen({ host: cfg.host, port: cfg.port })
    .catch(err => { app.log.error(err); process.exit(1); });
}).catch(err => { console.error(err); process.exit(1); });
