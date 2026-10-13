'use strict';
const fp = require('fastify-plugin');
const { getDb } = require('../db/connection');
const { E } = require('./error');

/* 鉴权：Bearer JWT（30min）；文件/导出类 GET 额外接受 httpOnly Cookie sid（30d JWT）。
   每次请求都回库取用户（角色/科室/禁用状态以库为准，禁用即时生效 → 401 KICKED）。
   - sid 只能从 Cookie 来、只能用在 authAny 的接口上；拿 sid 当 Bearer 一律拒绝
     （旧版 sid 是 30 天有效的通用凭证，退出登录后还能拿它写记录）。
   - sid 还要求签发它的那台设备仍有有效登录：退出、重置密码、停用后立即失效。
   - 管理员重置密码后（mustChange），除了 me / 改密 / 退出 / 时间，其它接口一律 403，
     强制先改密（旧版只在后台前端拦，地址栏直接打开页面即可绕过）。 */
module.exports = fp(async function authPlugin(app, opts) {
  const cfg = opts.cfg;
  await app.register(require('@fastify/jwt'), { secret: cfg.jwtSecret, sign: { expiresIn: cfg.accessTtl } });
  await app.register(require('@fastify/cookie'));
  const authSvc = require('../services/auth.service');

  function loadUser(id) {
    const db = getDb();
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!u) return null;
    const deptIds = db.prepare('SELECT dept_id FROM user_depts WHERE user_id = ? ORDER BY dept_id').all(u.id).map(r => r.dept_id);
    return { id: u.id, username: u.username, displayName: u.display_name, role: u.role,
      status: u.status, mustChange: !!u.must_change, deptIds };
  }
  app.decorate('loadUser', loadUser);

  function attach(req, payload, allowMustChange) {
    const user = loadUser(+payload.sub);
    if (!user) throw E.unauthorized();
    if (user.status !== 'on') throw E.kicked(401);
    if (user.mustChange && !allowMustChange) throw E.mustChange();
    req.user = user;
  }
  function verifyBearer(req) {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    let payload;
    try { payload = app.jwt.verify(h.slice(7)); } catch { throw E.unauthorized(); }
    if (payload.typ === 'sid') throw E.unauthorized();
    return payload;
  }

  /* 仅 Bearer */
  app.decorate('auth', async req => {
    const payload = verifyBearer(req);
    if (!payload) throw E.unauthorized();
    attach(req, payload, false);
  });
  /* 仅 Bearer，且允许「待改密」状态（me / 改密 / 退出 / 时间） */
  app.decorate('authLite', async req => {
    const payload = verifyBearer(req);
    if (!payload) throw E.unauthorized();
    attach(req, payload, true);
  });

  /* Bearer 或 Cookie sid（<img>/下载类 GET 用） */
  app.decorate('authAny', async req => {
    const bearer = verifyBearer(req);
    if (bearer) return attach(req, bearer, false);
    const token = req.cookies && req.cookies[cfg.cookieName];
    if (!token) throw E.unauthorized();
    let payload;
    try { payload = app.jwt.verify(token); } catch { throw E.unauthorized(); }
    if (payload.typ !== 'sid' || !authSvc.hasActiveSession(+payload.sub, payload.did)) throw E.unauthorized();
    attach(req, payload, false);
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
