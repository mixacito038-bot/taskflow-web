'use strict';
const fp = require('fastify-plugin');
const { getDb } = require('../db/connection');
const { E } = require('./error');

/* 鉴权：Bearer JWT（30min）；文件/导出类 GET 额外接受 httpOnly Cookie sid（30d JWT）。
   每次请求都回库取用户（角色/科室/禁用状态以库为准，禁用即时生效 → 401 KICKED）。 */
module.exports = fp(async function authPlugin(app, opts) {
  const cfg = opts.cfg;
  await app.register(require('@fastify/jwt'), { secret: cfg.jwtSecret, sign: { expiresIn: cfg.accessTtl } });
  await app.register(require('@fastify/cookie'));

  function loadUser(id) {
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) return null;
    const deptIds = db.prepare('SELECT dept_id FROM user_depts WHERE user_id = ? ORDER BY dept_id').all(u.id).map(r => r.dept_id);
    return { id: u.id, username: u.username, displayName: u.display_name, role: u.role,
      status: u.status, mustChange: !!u.must_change, deptIds };
  }
  app.decorate('loadUser', loadUser);

  function attach(req, payload) {
    const user = loadUser(+payload.sub);
    if (!user) throw E.unauthorized();
    if (user.status !== 'on') throw E.kicked(401);
    req.user = user;
  }

  /* 仅 Bearer */
  app.decorate('auth', async req => {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw E.unauthorized();
    let payload;
    try { payload = app.jwt.verify(h.slice(7)); } catch { throw E.unauthorized(); }
    attach(req, payload);
  });

  /* Bearer 或 Cookie sid（<img>/下载类 GET 用） */
  app.decorate('authAny', async req => {
    const h = req.headers.authorization || '';
    let token = h.startsWith('Bearer ') ? h.slice(7) : (req.cookies && req.cookies[cfg.cookieName]);
    if (!token) throw E.unauthorized();
    let payload;
    try { payload = app.jwt.verify(token); } catch { throw E.unauthorized(); }
    attach(req, payload);
  });

  app.decorate('requireRole', (...roles) => async req => {
    if (!roles.includes(req.user.role)) throw E.forbidden();
  });

  /* 数据范围：equip/admin 全院(null)，其余按 user_depts */
  app.decorate('visibleDeptIds', user =>
    (user.role === 'equip' || user.role === 'admin') ? null : user.deptIds);

  app.decorate('assertDeptScope', (user, deptId) => {
    if (user.role === 'equip' || user.role === 'admin') return;
    if (!user.deptIds.includes(+deptId)) throw E.forbidden('无权访问该科室');
  });
});
