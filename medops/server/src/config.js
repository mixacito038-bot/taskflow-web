'use strict';
const path = require('path');

const serverRoot = path.resolve(__dirname, '..');

/* 环境变量集中读取；限流阈值可用 RL_* 覆盖（联调/冒烟用），默认值即契约值 */
module.exports = {
  port: +(process.env.PORT || 3000),
  host: '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(serverRoot, '..', 'data')),
  jwtSecret: process.env.JWT_SECRET || '',
  accessTtl: '30m',
  refreshDays: 30,
  cookieName: 'sid',
  /* 信任几层反向代理（nginx / serve.js / start.js 都是一层）。req.ip 取 X-Forwarded-For 里
     由代理追加的那一项，客户端自己伪造的前几项不算数。
     ⚠ 旧版 trustProxy=true 信任整条 X-Forwarded-For：客户端带一个假 IP 就能绕过登录冷却和限流。
     前面再加了一层代理（如 CDN、另一台 nginx）时，用 TRUST_PROXY=2 之类调整。 */
  trustProxy: (() => {
    const v = process.env.TRUST_PROXY;
    if (v == null || v === '') return 1;
    if (/^\d+$/.test(v)) return +v;
    if (v === 'true' || v === 'false') return v === 'true';
    return v; // 逗号分隔的代理 IP / 网段
  })(),
  /* 网络层限流（按 IP，每分钟）。
     ⚠ 医院整栋楼通常共用一个出口 IP，在服务端看来全院就是"一个人"，
     所以阈值必须按"全院同时在线"来定，不能按单人。
     早先 login=10 是按单人估的，交接班时几十号人同时登录会被大面积误挡。

     真正拦撞库的不是这里，而是 auth.service 里的两道账号级防护：
       · 同一账号连错 5 次 → 冻结 5/10/15… 分钟（递增）
       · 同一设备+IP 两分钟内失败 8 次 → 枚举冷却
     这里只负责别让人拿脚本把 CPU 打满，所以可以放宽。 */
  rl: {
    global: +(process.env.RL_GLOBAL || 1200),   // 全院同时刷新首页也够
    login: +(process.env.RL_LOGIN || 60),       // 交接班几十人同时登录不会被挡
    export: +(process.env.RL_EXPORT || 20)      // 导出很重，维持原值
  }
};
