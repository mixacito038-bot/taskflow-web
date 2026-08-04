'use strict';
const { E } = require('../plugins/error');
const statsSvc = require('../services/stats.service');
const P = require('../services/period.service');

/* 统计：equip/admin 全院；dept 仅本科室；inspector 无权 */
module.exports = async function statsRoutes(app) {
  const guard = [app.auth, app.requireRole('dept', 'equip', 'admin')];
  const scope = user => app.visibleDeptIds(user); // dept → 本科室，equip/admin → null(全院)

  app.get('/api/stats/unsigned', { preHandler: guard }, async req =>
    statsSvc.unsigned(scope(req.user)));

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
