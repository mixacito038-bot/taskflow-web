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
    trustProxy: true
  });

  await app.register(require('@fastify/helmet'), { contentSecurityPolicy: false });
  await app.register(require('./plugins/error'));
  await app.register(require('@fastify/rate-limit'), {
    global: true, max: cfg.rl.global, timeWindow: '1 minute',
    errorResponseBuilder: () => ({ error: { code: 'RATE_LIMITED', message: '请求过于频繁' } })
  });
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
