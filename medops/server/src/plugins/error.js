'use strict';
const fp = require('fastify-plugin');

/* 业务错误：statusCode + 契约 code 枚举 */
class ApiErr extends Error {
  constructor(statusCode, code, message, retryAfter) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    if (retryAfter != null) this.retryAfter = retryAfter;
  }
}
const E = {
  badInput: m => new ApiErr(400, 'BAD_INPUT', m || '参数不正确'),
  unauthorized: m => new ApiErr(401, 'UNAUTHORIZED', m || '未登录或登录已过期'),
  kicked: (status, m) => new ApiErr(status, 'KICKED', m || '您的账户已被禁用，请联系设备科'),
  frozen: retryAfter => new ApiErr(423, 'FROZEN', '密码连续错误，账号已临时冻结', retryAfter),
  probe: retryAfter => new ApiErr(429, 'PROBE_COOLDOWN', '尝试过于频繁，请稍后再试', retryAfter),
  forbidden: m => new ApiErr(403, 'FORBIDDEN', m || '无权访问'),
  notFound: m => new ApiErr(404, 'NOT_FOUND', m || '数据不存在'),
  locked: m => new ApiErr(409, 'LOCKED', m || '已签字锁定'),
  notReady: m => new ApiErr(409, 'NOT_READY', m || '上一级签字未完成'),
  early: m => new ApiErr(400, 'EARLY', m || '周期未开始，不能提前操作'),
  conflict: m => new ApiErr(409, 'CONFLICT', m || '数据冲突'),
  rateLimited: retryAfter => new ApiErr(429, 'RATE_LIMITED', '请求过于频繁', retryAfter)
};

module.exports = fp(async function errorPlugin(app) {
  app.decorate('ApiErr', ApiErr);
  app.decorate('E', E);

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiErr) {
      const body = { error: { code: err.code, message: err.message } };
      if (err.retryAfter != null) body.error.retryAfter = err.retryAfter;
      return reply.code(err.statusCode).send(body);
    }
    if (err.validation) {
      return reply.code(400).send({ error: { code: 'BAD_INPUT', message: err.message } });
    }
    if (err.statusCode === 429) { // @fastify/rate-limit
      // errorResponseBuilder 已经把结构化 body 放在 err.error 里，原样透出（含 retryAfter）
      const body = err.error && err.error.code
        ? { error: err.error }
        : { error: { code: 'RATE_LIMITED', message: '请求过于频繁' } };
      return reply.code(429).send(body);
    }
    if (err.statusCode === 413) {
      return reply.code(413).send({ error: { code: 'BAD_INPUT', message: '请求体过大' } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: 'BAD_INPUT', message: err.message } });
    }
    req.log.error(err);
    reply.code(500).send({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
  });
});
module.exports.ApiErr = ApiErr;
module.exports.E = E;
