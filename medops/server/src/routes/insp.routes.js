'use strict';
const fs = require('fs');
const { getDb } = require('../db/connection');
const { E } = require('../plugins/error');
const recSvc = require('../services/record.service');
const fileSvc = require('../services/file.service');

const deptJson = d => ({ id: String(d.id), name: d.name, code: d.code, sort: d.sort, status: d.status });
const deviceJson = v => ({ id: String(v.id), deptId: String(v.dept_id), catName: v.cat_name,
  code: v.code, name: v.name, model: v.model, location: v.location, status: v.status, sort: v.sort });
const memberJson = m => ({ id: String(m.id), deptId: String(m.dept_id), name: m.name, title: m.title,
  status: m.status, sort: m.sort });

module.exports = async function inspRoutes(app) {
  const db = () => getDb();

  /* ---------- 基础数据（按角色过滤范围） ---------- */
  app.get('/api/depts', { preHandler: [app.auth] }, async req => {
    const ids = app.visibleDeptIds(req.user);
    if (ids == null) return db().prepare('SELECT * FROM depts ORDER BY sort, id').all().map(deptJson);
    if (!ids.length) return [];
    return db().prepare(`SELECT * FROM depts WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY sort, id`)
      .all(...ids).map(deptJson);
  });

  app.get('/api/depts/:id', { preHandler: [app.auth] }, async req => {
    app.assertDeptScope(req.user, +req.params.id);
    const d = db().prepare('SELECT * FROM depts WHERE id = ?').get(+req.params.id);
    if (!d) throw E.notFound('科室不存在');
    return deptJson(d);
  });

  app.get('/api/devices', { preHandler: [app.auth] }, async req => {
    const deptId = +(req.query.deptId || 0);
    if (!deptId) throw E.badInput('缺少 deptId');
    app.assertDeptScope(req.user, deptId);
    return db().prepare('SELECT * FROM devices WHERE dept_id = ? ORDER BY sort, code').all(deptId).map(deviceJson);
  });

  app.get('/api/members', { preHandler: [app.auth] }, async req => {
    const deptId = +(req.query.deptId || 0);
    if (!deptId) throw E.badInput('缺少 deptId');
    app.assertDeptScope(req.user, deptId);
    return db().prepare('SELECT * FROM members WHERE dept_id = ? ORDER BY sort, id').all(deptId).map(memberJson);
  });

  /* ---------- 日巡检记录 ---------- */
  app.get('/api/records', { preHandler: [app.auth] }, async req => {
    const { deptId, from, to } = req.query;
    if (deptId) {
      app.assertDeptScope(req.user, +deptId);
      return recSvc.listRecords({ deptId: +deptId, from, to });
    }
    return recSvc.listRecords({ deptIds: app.visibleDeptIds(req.user), from, to });
  });

  app.get('/api/records/:deptId/:date', { preHandler: [app.auth] }, async req => {
    app.assertDeptScope(req.user, +req.params.deptId);
    const r = recSvc.getRecord(+req.params.deptId, req.params.date);
    if (!r) throw E.notFound('该日无巡检记录');
    return r;
  });

  app.put('/api/records/:deptId/:date', {
    preHandler: [app.auth, app.requireRole('inspector')]
  }, async req => {
    app.assertDeptScope(req.user, +req.params.deptId);
    return recSvc.putRecord(req.user, +req.params.deptId, req.params.date, req.body || {});
  });

  app.post('/api/records/:deptId/:date/sign', {
    preHandler: [app.auth, app.requireRole('inspector')]
  }, async req => {
    app.assertDeptScope(req.user, +req.params.deptId);
    return recSvc.signRecord(req.user, +req.params.deptId, req.params.date, req.body || {});
  });

  /* ---------- 周签 ---------- */
  app.get('/api/weeksigns', { preHandler: [app.auth] }, async req => {
    const { deptId, from, to } = req.query;
    if (deptId) {
      app.assertDeptScope(req.user, +deptId);
      return recSvc.listWeekSigns({ deptId: +deptId, from, to });
    }
    return recSvc.listWeekSigns({ deptIds: app.visibleDeptIds(req.user), from, to });
  });

  app.post('/api/weeksigns/:deptId/:week/sign', {
    preHandler: [app.auth, app.requireRole('dept')]
  }, async req => {
    app.assertDeptScope(req.user, +req.params.deptId);
    return recSvc.signWeek(req.user, +req.params.deptId, req.params.week, req.body || {});
  });

  /* ---------- 月签 ---------- */
  app.get('/api/monthsigns', { preHandler: [app.auth] }, async req => {
    const { deptId, year } = req.query;
    if (deptId) {
      app.assertDeptScope(req.user, +deptId);
      return recSvc.listMonthSigns({ deptId: +deptId, year });
    }
    return recSvc.listMonthSigns({ deptIds: app.visibleDeptIds(req.user), year });
  });

  app.post('/api/monthsigns/:deptId/:month/sign', {
    preHandler: [app.auth, app.requireRole('equip', 'admin')]
  }, async req => recSvc.signMonth(req.user, +req.params.deptId, req.params.month, req.body || {}));

  /* ---------- 签名图（Bearer 或 Cookie；范围校验） ---------- */
  app.get('/api/files/:id', { preHandler: [app.authAny] }, async (req, reply) => {
    const f = fileSvc.getFile(req.params.id);
    if (!f || !fs.existsSync(f.abs)) throw E.notFound('文件不存在');
    const deptId = fileSvc.fileDeptId(f.id);
    if (deptId != null) app.assertDeptScope(req.user, deptId);
    const etag = `"${f.sha256}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, max-age=86400');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    reply.type(f.mime);
    return reply.send(fs.createReadStream(f.abs));
  });
};
