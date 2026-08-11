# 当前 Sites 构建产物（仅迁移参考）

本目录中的 `dist/` 来自源码提交 `14902fe4d4b1533d56014469d762a3f273f90b08`，已通过当前 Sites/Cloudflare Worker 构建。

它不能直接作为腾讯云 Node/CVM/PM2/容器服务启动：

- `dist/server/index.js` 导出 Worker `fetch`，不监听 HTTP 端口；
- 服务端仍依赖 `cloudflare:workers`、D1 与 R2 bindings；
- `dist/client` 没有独立 `index.html`，并依赖 SSR、登录和 API；
- `dist/server/wrangler.json` 是 Cloudflare 配置，不是腾讯云配置。

保留本目录的目的，是供腾讯适配开发时比对静态资源、路由和迁移副本。腾讯云生产产物必须在 Node/MySQL/COS/OIDC 适配完成后重新构建和验收。
