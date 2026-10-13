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

  /* 退出不要求 access token 有效：access 过期（30 分钟）后退出，也要能把 refreshToken 吊销掉；
     凭 refreshToken 本身吊销它是安全的（拿着它的人本来就能用它） */
  app.post('/api/auth/logout', async (req, reply) => {
    authSvc.logout(req, req.body || {});
    reply.clearCookie(cfg.cookieName, { path: '/api' });
    return { ok: true };
  });

  /* 限流按「设备+IP」计：全院共用一个出口 IP，按 IP 每分钟 10 次的话，几个人同时打开登录页
     就被限住，冻结/禁用提示随之消失 */
  app.get('/api/auth/login-state', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute',
      keyGenerator: req => `${String(req.headers['x-device-id'] || '').slice(0, 64)}|${req.ip}` } }
  }, async req => authSvc.loginState(req, (req.query || {}).username));

  app.get('/api/auth/me', { preHandler: [app.authLite] }, async req => authSvc.userJson(req.user));

  app.post('/api/auth/change-password', {
    preHandler: [app.authLite],
    config: { rateLimit: { max: cfg.rl.login, timeWindow: '1 minute' } }
  }, async req => {
    authSvc.changePassword(req, req.user.id, req.body || {});
    return { ok: true };
  });

  /* 业务时钟：H5 的 today()/wkOf/moOf 一律以此为准 */
  app.get('/api/time', { preHandler: [app.authLite] }, async () => {
    const n = P.shNow();
    // epochMs：前端据此算出与本机时钟的偏差，让页面上的服务器时间按秒走动（不必每秒请求）
    return { now: `${n.date} ${n.time}`, date: n.date, week: P.wkOf(n.date), month: P.moOf(n.date), epochMs: Date.now() };
  });
};
