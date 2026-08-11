# 腾讯云迁移说明

本目录是“勇虹医疗 · 设备效益管理平台”源码导出后的腾讯云迁移说明。原始源码、前端页面、数据库模型、迁移脚本和构建产物均已保留。

数据准备中心、Excel/CSV/JSON 文件导入、医院指标模板、迁移 0007—0010、COS 适配边界和上线配置详见 [`DATA-PREPARATION-CENTER.md`](./DATA-PREPARATION-CENTER.md)。当前产品范围不包含 HIS、PACS 等在线接口执行器。

## 当前交付状态

- 原始源码已从 Sites 源码仓库完整导出。
- `npm run build` 已通过。
- 当前全量 99 项自动测试全部通过，包含真实 SQLite/R2 生命周期、文件导入、数据治理、多部位检查、医院指标口径、正式数据边界、响应式布局和产品闭环。
- `dist/client` 是浏览器端页面资源备份；它依赖服务端渲染和 API，不能单独作为完整系统运行。
- 当前服务端仍使用 Cloudflare Workers、D1、R2 和 ChatGPT/Sites 登录头，不能原样作为腾讯云生产系统启动。

## 推荐的腾讯云目标架构

| 当前组件 | 腾讯云目标 | 迁移工作 |
| --- | --- | --- |
| Sites / Cloudflare Worker | CVM Linux + Docker + Node.js，前置 Nginx；需要高可用时增加 CLB | 把 Worker 入口改为标准 Node.js 服务入口 |
| D1 / SQLite | TencentDB for MySQL 8.0 | 将 Drizzle 的 `sqlite-core`/D1 驱动改为 `mysql-core`/MySQL 驱动，并转换迁移 SQL |
| R2 | 对象存储 COS 私有存储桶 | 将 R2 的 `put/get/head/delete/list` 适配为 COS SDK 调用 |
| ChatGPT/Sites 认证头 | 医院统一身份、企业微信/OIDC，或自有账号体系 | 重建登录、退出、回调和可信用户身份来源；保留现有医院成员、角色和权限校验 |
| Sites 环境变量 | CVM/Docker 环境变量或腾讯云凭据管理 | 重新配置数据库、COS、会话与身份认证密钥 |
| Sites HTTPS | CLB HTTPS 或 Nginx HTTPS | 绑定自有域名和证书，只开放 80/443 |

生产环境建议让 CVM 与 TencentDB MySQL 位于同一地域、同一 VPC，数据库只走内网；COS 存储桶保持私有，报告下载由服务端鉴权后返回。

## 源码中需要改造的位置

1. `db/index.ts`：当前直接加载 `cloudflare:workers` 的 D1 绑定。
2. `db/schema.ts`：当前使用 Drizzle SQLite 模型。
3. `drizzle/*.sql`：当前是 SQLite/D1 迁移脚本，只能作为 MySQL 转换依据。
4. `app/api/report-artifacts/route.ts`：当前直接使用 R2 Bucket API。
5. `app/api/system-health/route.ts`：云端自检与备份页面使用 D1/R2 名称和接口。
6. `app/chatgpt-auth.ts`、`app/LoginScreen.tsx`：当前依赖 Sites 提供的 ChatGPT 登录路径和身份请求头。
7. `worker/index.ts`、`vite.config.ts`：当前构建目标是 Cloudflare Worker。

前端业务组件、驾驶舱、设备台账、成本填报、报告中心、权限页面和大部分 API 业务规则都可以继续复用。

## 上线前的硬性检查

- 不要把 `.env`、数据库密码、COS SecretKey 或会话密钥提交到代码仓库。
- 在每次互联网开放前运行 `npm audit --omit=dev`、复核安全公告并完成回归；不要把本次构建通过等同于未来依赖版本始终安全。
- 用脱敏数据完成 D1 到 MySQL 的迁移演练，并核对记录数、唯一索引、外键和报告文件校验值。
- 完成 HTTPS、最小权限 CAM、数据库自动备份、COS 版本控制/生命周期、日志留存、告警和恢复演练。
- 当前系统是演示原型，不得直接录入患者姓名、证件号、病历号、影像等个人健康信息。真实医院使用前需完成医院内部审批、等保和数据安全评估。

## 建议的实施顺序

1. 先在腾讯云开通测试环境：1 台 CVM、1 个 TencentDB MySQL 测试实例、1 个私有 COS 存储桶。
2. 完成数据库与对象存储适配，再迁移脱敏的文件导入、快照、质量、对账和发布版本数据。
3. 接入医院认可的统一身份认证，并验证医院/角色/科室范围。
4. 以 Docker 方式部署 Node.js 服务，Nginx 或 CLB 提供 HTTPS。
5. 完成安全检查和备份恢复演练后，再切换正式域名。

## 腾讯云官方参考

- CVM 与 Docker：https://cloud.tencent.com/document/product/213/46000
- 云数据库 MySQL：https://cloud.tencent.com/document/product/236/
- CVM 连接 MySQL：https://cloud.tencent.com/document/product/236/3130/
- COS 产品与 SDK：https://cloud.tencent.com/document/product/436/6222
- COS Node.js SDK：https://cloud.tencent.com/document/product/436/8629
- CLB HTTPS：https://cloud.tencent.com/document/product/214/36385
