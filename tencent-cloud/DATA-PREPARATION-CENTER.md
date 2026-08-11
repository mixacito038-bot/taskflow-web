# 数据准备中心：腾讯云部署与数据接入说明

本文只描述当前源码已经具备的能力，以及迁移到腾讯云仍需完成的适配。它不是“开箱即用的腾讯云安装手册”。

## 1. 当前运行形态与腾讯云目标

| 项目 | 当前源码事实 | 腾讯云目标 / 尚需工作 |
| --- | --- | --- |
| 服务进程 | `package.json` 要求 Node.js `>=22.13.0`，`npm run build` 使用 vinext 构建 Cloudflare Worker/RSC 产物 | 采用 CVM/TKE 上的 Node.js 22 LTS 服务并由 Nginx/CLB 终止 HTTPS；标准 Node 服务入口和容器镜像尚未实现 |
| 数据库 | `db/index.ts` 使用 `drizzle-orm/d1`，运行时要求 Cloudflare `DB` D1 绑定；模型与 SQL 是 SQLite 方言 | 如采用 TencentDB for MySQL 8.0，需把 Drizzle 驱动、schema 和全部迁移转换为 MySQL 方言并完成迁移演练；当前 `DATABASE_URL` 尚未被源码读取 |
| 文件存储 | 原始文件、Raw/Staging/Curated/Published 不可变快照和正式报告均调用 Cloudflare R2 的 `REPORT_FILES` binding | 需要把统一对象存储适配层改为 COS；当前 `COS_BUCKET`、SecretId/SecretKey 尚未被源码读取 |
| 登录与会话 | 应用会话、医院成员、角色和权限存入 D1；身份入口仍依赖当前 Sites/Cloudflare 环境 | 需要接入医院认可的 OIDC/统一身份，并保留现有医院范围和权限判定；示例 OIDC 环境变量尚未接线 |

因此，在完成 Node、MySQL、COS 和身份适配前，不能把当前 `dist/client` 当成完整静态站点发布，也不能声称源码已经能直接连接 TencentDB 或 COS。

## 2. 数据准备中心现有后端能力

产品当前只采用 Excel、CSV、JSON 文件作为数据入口，不包含 HIS、PACS 或其他在线接口执行器。主接口为 `POST /api/data-workbench`，文件上传入口为 `POST /api/data-workbench/import-file`。所有写操作先执行同源校验、应用会话校验、医院成员/平台管理员校验，并要求医院或平台级数据范围。主要权限为：

- `data.ingest`：上传并解析文件，创建导入批次、原始数据集和不可变 Raw 快照。
- `data.clean`：维护映射、清洗规则、字段/指标元数据，以及导入医院指标模板。
- `data.review`：审核数据、业务对账和单条激活医院指标。
- `data.publish`：发布、更正或创建回滚草稿；正式切换仍须四眼审核。

源码仍保留早期连接器元数据表和兼容权限编码，但数据准备中心不展示、不执行连接器，也不会主动访问外部医疗系统。

### 医院 20 项指标模板

批量导入请求：

```json
{
  "action": "import_hospital_metric_template",
  "hospitalId": "hospital-id",
  "templateVersion": "HOSPITAL-BASELINE-2026.08.11.1"
}
```

服务端只接受源码内置版本，要求 `data.clean`，以当前医院的 `code + version` 幂等创建 20 条 `draft`。完全相同的记录返回 `skipped`；同键内容不同返回 `409 hospital_metric_template_conflict`，不覆盖，也不会在有冲突时部分创建。公式、分子、分母、单位、维度和来源分别保存，定义、依据成熟度、readiness、decision 等扩展信息保存在版本化 JSON 描述信封中。导入不会自动激活。

单条激活请求：

```json
{
  "action": "activate_hospital_metric_definition",
  "hospitalId": "hospital-id",
  "id": "metric-id",
  "sourceFieldDefinitionIds": ["active-field-definition-id"],
  "dependencyMetricDefinitionIds": []
}
```

激活要求 `data.review`，仅接受当前内置版本的 `draft` 模板；`deferred` 指标不能激活，且至少需要一个来源字段或依赖指标绑定。绑定对象必须属于同一医院并已是 `active`。通用保存动作不能绕过该检查直接激活模板。成功、重复、冲突和激活均写入数据 lineage；模板插入与成功审计使用同一数据库 batch。

## 3. XLSX 与对象上传的真实边界

`POST /api/data-workbench/import-file` 当前具备：

- 接受 `multipart/form-data` 的 `hospitalId` 与 `.xlsx`、`.csv` 或 `.json` 文件；
- 要求医院/平台范围和 `data.ingest`；
- 限制 25 MB；XLSX 拒绝旧 `.xls`、宏、外部链接、嵌入对象和异常压缩包，公式不执行且不采信缓存值；
- CSV 真实执行所选分隔符；JSON 接受数组、`{ rows }` 或 `{ data }`，嵌套值确定性序列化；
- `inspectOnly=true` 只返回工作表/表头/预览/画像/告警，不落库；正式提交在服务端重新解析并计算 SHA-256；
- 正式提交以内容寻址方式把原件写入 R2，创建导入批次、全量 Raw NDJSON 快照、D1 行级记录、数据集元数据和 lineage，随后进入 `pending_mapping`；
- 幂等键同时冻结文件 hash 和解析选项；同键异内容或异配置返回冲突，不覆盖既有批次。

映射、清洗、隔离修复会继续生成不可变 Staging/Curated 快照；发布把所选最新 Curated 组合为不可变 Published NDJSON，并冻结指标、展示、分摊、来源行和 hash。更正产生同一 series 的新版本；回滚只创建引用历史 Published 快照的新草稿，仍须复核和发布，不能即时覆盖当前版本。

`POST /api/report-artifacts` 是另一个用途不同的接口：它只接收已签发报告的 DOCX/CSV，校验医院权限、报告状态、文件名、大小、签名和 SHA-256，然后写入 R2 `REPORT_FILES`；原始业务文件只能走受控导入接口。

腾讯云上线前应新增一个真实的 COS 原始数据上传流程，至少满足：

1. 服务端鉴权后签发短时、限定 bucket/key/content-type/size 的预签名请求，或由 Node 服务端流式上传；
2. key 固定在医院隔离前缀下，例如 `raw/{hospitalId}/{importId}/...`，禁止客户端提交任意跨医院 key；
3. 复用当前内容寻址 key、SHA-256、大小校验与不可变语义；COS 适配后必须以 `HEAD`/下载复核证明对象存在且内容一致；
4. COS 桶保持私有，启用服务端加密、版本控制、生命周期和审计日志；
5. 下载始终再次检查医院范围和权限，不直接暴露永久公网 URL。

这些是把现有 R2 对象链迁移到 COS 的部署待办；当前仓库尚未实现 COS SDK 适配。

## 4. 密钥与遗留连接器兼容边界

在线连接器不在当前产品范围。为兼容早期元数据，遗留连接器 API 仍会拒绝 metadata 中疑似密码、token、SecretKey 等内联材料，也拒绝带 userinfo、query 或 fragment 的 endpoint；`credentialRef` 只接受以下形式：

- `secret://...`
- `tencent-sm://...`
- `vault://...`

这只是安全引用格式校验；当前没有实现 `tencent-sm://` 的腾讯云凭据管理系统解析器。上线时应使用 CVM/TKE 角色和最小权限 CAM，确需静态凭据时放入腾讯云凭据管理系统，不写数据库明文、不写镜像、不提交 `.env`。日志只记录引用标识，不记录解析后的秘密。

MFA TOTP 秘钥在数据库内用 AES-GCM 加密，当前运行时必须提供 32 字节的 `MFA_TOTP_ENCRYPTION_KEY`（64 位十六进制或等价 base64url）。换环境时必须安全迁移同一把密钥，否则已有 MFA 秘钥无法解密；轮换方案需先开发和演练。

## 5. 迁移 0007—0010

相关脚本都是 SQLite/D1 SQL，不能直接在 MySQL 执行：

- `drizzle/0007_data_workbench.sql`：数据连接、导入批次、原始数据集、映射、清洗规则、质量问题、发布版本和 lineage，并增加数据工作台权限。
- `drizzle/0008_metadata_contracts.sql`：检查事实与多部位关系、字段定义、指标定义、可视化定义及其唯一索引/外键。
- `drizzle/0009_file_pipeline.sql`：业务模板、不可变快照、行级记录、隔离区、对账、审核、发布 manifest 和幂等治理。
- `drizzle/0010_publish_series_atomicity.sql`：保证每个医院、每条发布 series 同时只有一个当前 Published 版本。

当前 D1 新环境必须按迁移日志顺序执行 `0000` 至 `0010`，不能只执行后四个脚本。迁移 MySQL 时至少要逐项转换并验证：

- SQLite `text/integer/real` 到合适的 MySQL 类型；
- `CURRENT_TIMESTAMP`、布尔值、自动递增主键和外键行为；
- `hospital_id + code + version` 等唯一键；
- 0008 中“每次检查只能有一个主部位”的 SQLite 部分唯一索引。MySQL 不能原样使用该 `WHERE` 索引，需要生成列、约束或事务校验替代；
- `INSERT OR IGNORE` 权限种子语句改为 MySQL 幂等写法；
- JSON 文本列的字符集、长度和校验策略。

迁移验收应比对各表行数、每医院行数、孤儿外键、唯一键冲突、状态分布、SHA-256、lineage 数量，并对 20 项模板重复导入和单条激活做一次回归。

## 6. 上线前必填配置

### 当前 Cloudflare 版本实际读取

- `DB`：D1 binding；缺失时数据库 API 返回不可用。
- `REPORT_FILES`：R2 binding；缺失时原始文件、数据快照、Published 正式供数和报告文件接口均不可用。
- `MFA_TOTP_ENCRYPTION_KEY`：32 字节 MFA 加密密钥。
- `BOOTSTRAP_ADMIN_EMAIL`：首个管理员邮箱；应在初始化后限制其使用和变更流程。

Worker 入口还依赖静态资源/图片相关 binding；具体以构建和部署配置为准。

### 腾讯云 Node 目标配置（适配完成后才生效）

- `NODE_ENV`、`PORT`、`APP_BASE_URL`
- TencentDB 内网 `DATABASE_URL` 和连接池/超时/TLS 配置
- COS region、私有 bucket、key 前缀；优先实例角色，避免长期 SecretId/SecretKey
- `MFA_TOTP_ENCRYPTION_KEY`
- 应用会话密钥、可信代理与 Cookie 域配置
- OIDC issuer、client ID、client secret、回调 URL
- `BOOTSTRAP_ADMIN_EMAIL`
- 日志脱敏、告警、备份、跨可用区和恢复目标配置

当前 `tencent-cloud/.env.tencent.example` 是目标规划模板，其中大部分变量尚未被源码读取。配置完成不等于适配完成，必须以健康检查、数据库读写、COS 上传下载和权限回归的实际结果验收。

## 7. 上线验收清单

- Node 服务可在非 Cloudflare 运行时启动，优雅关闭并通过健康检查。
- MySQL 迁移在空库和脱敏备份恢复两条路径均成功。
- 医院 A 的账号无法读取、绑定或激活医院 B 的字段/指标/对象。
- Excel、CSV、JSON 的预检不落库；正式提交写入内容一致的原件、Raw 快照、记录数和 SHA-256。
- 20 项模板首次导入创建 20 项，重复导入全部 skipped，篡改同键内容返回 conflict。
- 映射、清洗、隔离修复、对账、四眼复核、发布、更正和回滚在新环境完整走通；历史版本 hash 与行数复核一致。
- `deferred`、缺少 active 来源绑定、依赖其他医院对象的指标均无法激活。
- COS 原始数据与报告两类前缀、权限和生命周期彼此隔离。
- 数据库/COS 凭据不出现在源码、镜像层、API 响应或日志中。
- 完成 HTTPS、CAM 最小权限、数据库备份、COS 版本控制、日志留存和恢复演练。
- 未完成医院审批、等保和数据安全评估前，不导入真实个人健康信息。
