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
  rl: {
    global: +(process.env.RL_GLOBAL || 300),
    login: +(process.env.RL_LOGIN || 10),
    export: +(process.env.RL_EXPORT || 20)
  }
};
