'use strict';
const { E } = require('../plugins/error');
const statsSvc = require('../services/stats.service');
const expirySvc = require('../services/expiry.service');
const P = require('../services/period.service');

/* 统计：equip/admin 全院；dept 仅本科室；inspector 无权 */
module.exports = async function statsRoutes(app) {
  const guard = [app.auth, app.requireRole('dept', 'equip', 'admin')];
  const scope = user => app.visibleDeptIds(user); // dept → 本科室，equip/admin → null(全院)

  app.get('/api/stats/unsigned', { preHandler: guard }, async req =>
    statsSvc.unsigned(scope(req.user)));

  /* 有效期提醒：过期 + 临期设备清单。
     与 unsigned 不同，巡检员也要能看本科室的（抢救设备过期他第一个碰到），
     所以这里不用 guard 而是全角色可访问，数据范围仍按 visibleDeptIds 收窄。 */
  app.get('/api/stats/expiry', { preHandler: [app.auth] }, async req => {
    const all = req.query.all === '1';                 // all=1 返回全部已设有效期的（管理页用）
    const deptId = req.query.deptId ? +req.query.deptId : null;
    if (deptId != null) app.assertDeptScope(req.user, deptId);
    const ids = deptId != null ? [deptId] : app.visibleDeptIds(req.user);
    return expirySvc.list(ids, { onlyAlert: !all });
  });

  app.get('/api/stats/expiry/summary', { preHandler: [app.auth] }, async req =>
    expirySvc.summary(app.visibleDeptIds(req.user)));

  app.get('/api/stats/completion', { preHandler: guard }, async req => {
    const month = req.query.month || P.moOf(P.today());
    if (!/^\d{4}-\d{2}$/.test(month)) throw E.badInput('month 格式必须是 YYYY-MM');
    const deptId = req.query.deptId ? +req.query.deptId : null;
    if (deptId != null) app.assertDeptScope(req.user, deptId);
    return statsSvc.completion(scope(req.user), month, deptId);
  });

  app.get('/api/stats/ng', { preHandler: guard }, async req => {
    const { from, to } = req.query;
    const deptId = req.query.deptId ? +req.query.deptId : null;
    if (deptId != null) app.assertDeptScope(req.user, deptId);
    return statsSvc.ngList(scope(req.user), { from, to, deptId });
  });

  app.get('/api/stats/signatures', { preHandler: guard }, async req => {
    const month = req.query.month || P.moOf(P.today());
    if (!/^\d{4}-\d{2}$/.test(month)) throw E.badInput('month 格式必须是 YYYY-MM');
    return statsSvc.signatures(scope(req.user), month);
  });
};
