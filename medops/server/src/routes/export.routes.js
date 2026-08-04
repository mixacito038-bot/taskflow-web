'use strict';
const { E } = require('../plugins/error');
const exportSvc = require('../services/export.service');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/* 导出：equip/admin；Bearer 或 Cookie（供 <a> 直接下载）；限流 20/min/用户 */
module.exports = async function exportRoutes(app, opts) {
  const cfg = opts.cfg;
  const guard = [app.authAny, app.requireRole('equip', 'admin')];
  const rl = {
    rateLimit: {
      max: cfg.rl.export, timeWindow: '1 minute',
      keyGenerator: req => req.headers.authorization || (req.headers.cookie || req.ip)
    }
  };

  app.get('/api/export/monthly.xlsx', { preHandler: guard, config: rl }, async (req, reply) => {
    const { deptId, month } = req.query;
    if (!deptId || !month) throw E.badInput('deptId 与 month 必填');
    const buf = await exportSvc.monthlyXlsx(+deptId, month);
    reply.header('Content-Disposition', `attachment; filename="monthly-${deptId}-${month}.xlsx"`).type(XLSX_MIME);
    return reply.send(buf);
  });

  app.get('/api/export/ng.xlsx', { preHandler: guard, config: rl }, async (req, reply) => {
    const { from, to } = req.query;
    const buf = await exportSvc.ngXlsx(null, { from, to });
    reply.header('Content-Disposition', `attachment; filename="ng-${from || 'all'}-${to || 'all'}.xlsx"`).type(XLSX_MIME);
    return reply.send(buf);
  });
};
