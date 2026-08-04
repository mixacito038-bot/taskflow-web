'use strict';
const authSvc = require('../services/auth.service');
const P = require('../services/period.service');

module.exports = async function authRoutes(app, opts) {
  const cfg = opts.cfg;
  const cookieOpts = {
    httpOnly: true, sameSite: 'lax', path: '/api',
    maxAge: cfg.refreshDays * 86400, secure: 'auto'
  };
  const sendTokens = (reply, out) => {
    reply.setCookie(cfg.cookieName, out.sid, cookieOpts);
    return { accessToken: out.accessToken, refreshToken: out.refreshToken, user: out.user };
  };

  app.post('/api/auth/login', {
    config: { rateLimit: { max: cfg.rl.login, timeWindow: '1 minute' } }
  }, async (req, reply) => sendTokens(reply, authSvc.login(app, req, req.body || {})));

  app.post('/api/auth/refresh', async (req, reply) =>
    sendTokens(reply, authSvc.refresh(app, req, req.body || {})));

  app.post('/api/auth/logout', { preHandler: [app.auth] }, async (req, reply) => {
    authSvc.logout(req, req.body || {});
    reply.clearCookie(cfg.cookieName, { path: '/api' });
    return { ok: true };
  });

  app.get('/api/auth/login-state', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async req => authSvc.loginState(req, (req.query || {}).username));

  app.get('/api/auth/me', { preHandler: [app.auth] }, async req => authSvc.userJson(req.user));

  app.post('/api/auth/change-password', { preHandler: [app.auth] }, async req => {
    authSvc.changePassword(req.user.id, req.body || {});
    return { ok: true };
  });

  /* 业务时钟：H5 的 today()/wkOf/moOf 一律以此为准 */
  app.get('/api/time', { preHandler: [app.auth] }, async () => {
    const n = P.shNow();
    return { now: `${n.date} ${n.time}`, date: n.date, week: P.wkOf(n.date), month: P.moOf(n.date) };
  });
};
