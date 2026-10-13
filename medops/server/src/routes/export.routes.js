'use strict';
const { E } = require('../plugins/error');
const exportSvc = require('../services/export.service');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const { getDb } = require('../db/connection');
/* 中文文件名：filename* 放在前面（RFC 5987，浏览器与后台下载函数都优先认它），filename 留 ASCII 兜底 */
const disposition = (ascii, zh) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(zh)}; filename="${ascii}"`;
const deptName = id => { const d = getDb().prepare('SELECT name FROM depts WHERE id = ?').get(+id); return d ? d.name : String(id); };

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
    reply.header('Content-Disposition', disposition(`monthly-${+deptId}-${month}.xlsx`, `巡检月报_${deptName(deptId)}_${month}.xlsx`)).type(XLSX_MIME);
    return reply.send(buf);
  });

  app.get('/api/export/ng.xlsx', { preHandler: guard, config: rl }, async (req, reply) => {
    const { from, to } = req.query;
    for (const v of [from, to]) if (v && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw E.badInput('日期格式应为 YYYY-MM-DD');
    const deptId = req.query.deptId ? +req.query.deptId : null;
    if (deptId != null && !getDb().prepare('SELECT 1 FROM depts WHERE id = ?').get(deptId)) throw E.notFound('科室不存在');
    const buf = await exportSvc.ngXlsx(null, { from, to, deptId });
    const span = `${from || '全部'}_${to || '全部'}`;
    reply.header('Content-Disposition', disposition(`ng-${deptId || 'all'}-${from || 'all'}-${to || 'all'}.xlsx`,
      `异常清单_${deptId != null ? deptName(deptId) + '_' : ''}${span}.xlsx`)).type(XLSX_MIME);
    return reply.send(buf);
  });
};
