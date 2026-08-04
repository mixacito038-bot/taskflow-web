'use strict';
const fs = require('fs');
const { E } = require('../plugins/error');
const amsSvc = require('../services/ams.service');

/* 资产系统云同步网关：equip/admin 账号；files GET 双鉴权（Bearer 或 Cookie） */
module.exports = async function amsRoutes(app) {
  const guard = [app.auth, app.requireRole('equip', 'admin')];
  const guardAny = [app.authAny, app.requireRole('equip', 'admin')];

  /* 本插件作用域内：非 JSON 请求体一律按 buffer 收（附件 PUT 用） */
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 },
    (req, body, done) => done(null, body));

  app.get('/api/ams/snapshot', { preHandler: guard }, async () => amsSvc.snapshot());

  app.post('/api/ams/push', { preHandler: guard, bodyLimit: 25 * 1024 * 1024 }, async req =>
    amsSvc.push(req.user, req.body || {}));

  app.get('/api/ams/changes', { preHandler: guard }, async req =>
    amsSvc.changes((req.query || {}).since));

  app.get('/api/ams/files/manifest', { preHandler: guardAny }, async () => amsSvc.manifest());

  app.get('/api/ams/files/:id', { preHandler: guardAny }, async (req, reply) => {
    const f = amsSvc.getAmsFile(req.params.id);
    if (!f || !fs.existsSync(f.abs)) throw E.notFound('文件不存在');
    reply.header('X-Ams-Meta', amsSvc.jsonAscii(amsSvc.safeJson(f.meta || '{}')))
      .header('ETag', `"${f.sha256}"`)
      .header('Cache-Control', 'private, max-age=86400')
      .type(f.mime || 'application/octet-stream');
    if (req.headers['if-none-match'] === `"${f.sha256}"`) return reply.code(304).send();
    return reply.send(fs.createReadStream(f.abs));
  });

  app.put('/api/ams/files/:id', { preHandler: guard, bodyLimit: 20 * 1024 * 1024 }, async req => {
    if (!Buffer.isBuffer(req.body)) throw E.badInput('请求体必须是二进制内容（application/octet-stream）');
    return amsSvc.putAmsFile(req.params.id, req.body, req.headers['x-ams-meta'], req.headers['content-type']);
  });

  app.delete('/api/ams/files/:id', { preHandler: guard }, async req =>
    amsSvc.deleteAmsFile(req.params.id));

  app.put('/api/ams/presence', { preHandler: guard }, async req =>
    amsSvc.touchPresence((req.body || {}).deviceId));
};
