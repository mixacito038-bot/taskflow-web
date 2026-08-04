# 急救设备巡检系统 · 接口契约 v1

> 本文档是 server / admin / h5 / ams-shim / deploy 五个组件的**唯一对齐基准**。
> 实现与本文冲突时，以本文为准；发现本文有误，先改本文再改代码。

## 0. 总原则

- 前缀 `/api`，JSON over HTTPS。鉴权：`Authorization: Bearer <accessToken>`。
- **所有 id 在 JSON 中一律为字符串**（服务端内部为 SQLite 整数自增，出入口转换），避免 H5 端 `'12' !== 12` 类错误。
- **响应形状对齐 H5 现有数据结构**（H5 视图层不改，只换 API 对象内部实现）。
- 业务日期（今天/周一/月份）**只信服务端**，按 `Asia/Shanghai` 计算。周=周一日期 `YYYY-MM-DD`；月=`YYYY-MM`。
  - 周归属算法与 H5 完全一致（从 H5 369–381 行逐行移植）：
    - `wkOf(d)`＝d 所在周的周一；
    - `wksOfMonth(m)`＝周一落在 m 月内的周，且仅返回已开始（周一 ≤ 今天）的周。
- 错误统一 `{error:{code,message,retryAfter?}}`，HTTP 状态码语义化。code 枚举：
  `BAD_INPUT` `UNAUTHORIZED` `KICKED`(账号被禁用) `FROZEN`(登录冻结,423) `PROBE_COOLDOWN`(设备枚举冷却,429)
  `FORBIDDEN` `NOT_FOUND` `LOCKED`(已签锁定) `NOT_READY`(前一级未签齐) `EARLY`(周期未开始) `CONFLICT` `RATE_LIMITED`。
- 登录成功同时下发 httpOnly Cookie `sid`（SameSite=Lax, path=/api），**仅用于 `<img>`/下载类 GET**
  （`/api/files/*`、`/api/export/*`、`/api/ams/files/*` 同时接受 Bearer 或 Cookie；其余端点只认 Bearer）。
- 角色：`inspector`(巡检员,可多科室) / `dept`(护士长,单科室) / `equip`(设备科,全院) / `admin`(超管)。
  `equip`、`admin` 可用管理后台；数据范围过滤在**服务端**执行。

## 1. 认证

### POST /api/auth/login（匿名）
Header `X-Device-Id: <客户端UUID>`（H5/admin 首次生成后存 localStorage）。
Body `{username, password}`。
校验顺序：① 设备+IP 枚举冷却（2 分钟窗口失败≥8 → 429 PROBE_COOLDOWN，不区分账号是否存在）
② 账号不存在 → 401 UNAUTHORIZED（文案与密码错相同："账号或密码不正确"）
③ 冻结中 → 423 FROZEN + retryAfter 秒 ④ 已禁用 → 403 KICKED("您的账户已被禁用，请联系设备科")
⑤ bcrypt 失败 → 计数+1，满 5 次冻结 5/10/15…分钟递增（轮次不封顶），返回 401（若此次触发冻结返回 423）
⑥ 成功 → 清零计数，返回：
```json
{ "accessToken":"<jwt 30min>", "refreshToken":"<random 43ch>", 
  "user":{"id","username","displayName","role","deptId","deptIds":["..."],"mustChange":false} }
```
JWT payload: `{sub, role, deptIds, dn}`。refreshToken 30 天，服务端只存 sha256。

### POST /api/auth/refresh（匿名）
Body `{refreshToken}` + Header X-Device-Id。轮换：旧 token 吊销、发新对（响应同 login）。
已吊销 token 被重放 → 吊销该用户该设备全部 token，401。**H5"一键登录"即存 refreshToken**（不再存密码）。

### POST /api/auth/logout（登录）— 吊销当前 refreshToken（body 传）+ 清 cookie。
### GET /api/auth/login-state?username=（匿名，限流 10/min/IP）
→ `{frozen:bool, retryAfter?:sec, disabled:bool}`。仅当该 X-Device-Id 曾成功登录过该账号才返回真实
`disabled`；否则 disabled 恒为 false（防枚举）。frozen 可如实返回。
### GET /api/auth/me（登录）→ user 对象（同 login.user）。禁用账号返回 401 KICKED。
### POST /api/auth/change-password（登录）Body `{oldPassword,newPassword≥6}`。
### GET /api/time（登录）→ `{now:"YYYY-MM-DD HH:mm", date:"YYYY-MM-DD", week:"YYYY-MM-DD", month:"YYYY-MM"}`
H5 启动后所有 today()/wkOf(today())/moOf(today()) 用它（S.date/S.week/S.month 初始化 + 每次进入首页刷新）。

## 2. 巡检业务（H5 主用；管理后台读共用）

数据形状（与 H5 localStorage 结构一致，仅 sign.dataUrl → sign.url）：
```
dept   {id,name,code,sort,status:'on'|'off'}
device {id,deptId,catName,code,name,model,location,status:'in_use'|...}
member {id,deptId,name,title,status:'on'}
record {id,deptId,date,checks:{[deviceId]:'ok'|'ng'},notes:{[deviceId]:string},
        sign:null|{name,title,url,opinion,at},inspectorId,inspectorName,createdAt,updatedAt}
weeksign  {id,deptId,week,sign:{name,title,url,opinion,at},stat:{checked,ng,days},at}
monthsign {id,deptId,month,sign:{...同上},stat:{checked,ng,weeks},at}
```
`sign.url` 形如 `/api/files/<fileId>`（H5 的 `<img src>` 直接可用，靠 Cookie 鉴权）。

| 端点 | 角色/范围 | 说明 |
|---|---|---|
| GET /api/depts | 登录；按角色过滤 | inspector→deptIds，dept→本科室，equip/admin→全部（含 status，前端自行忽略 off） |
| GET /api/depts/:id | 登录+范围 | 单科室 |
| GET /api/devices?deptId= | 登录+范围 | 该科室设备（品类/台数由前端从列表计算） |
| GET /api/members?deptId= | 登录+范围 | 签字人名单 |
| GET /api/records?deptId=&from=&to= | 登录+范围 | deptId 可省（inspector=其全部科室）；含 sign 但不含图片体 |
| GET /api/records/:deptId/:date | 登录+范围 | 无记录返回 404 |
| PUT /api/records/:deptId/:date | inspector+范围 | Body `{checks,notes}` 整体覆盖。拒绝：date>今天(EARLY)、该日已签(LOCKED)、该日所在周已周签(LOCKED)、所在月已月签(LOCKED) |
| POST /api/records/:deptId/:date/sign | inspector+范围 | Body `{name,title,opinion,dataUrl}`。校验同上+PNG magic bytes+解码≤1MB。落盘后返回完整 record |
| GET /api/weeksigns?deptId=&from=&to= | 登录+范围 | from/to 匹配 week 字段 |
| POST /api/weeksigns/:deptId/:week/sign | dept+范围 | 校验：week 是周一(BAD_INPUT)；week+6 ≤ 今天，即该周已结束才能签？——**不**：与 H5 一致，该周所有**已过去和今天**的日期都已日签即可签（周中不可签未来，见 H5 weekState 615-628 行以源码为准）；(dept,week) 未签过(LOCKED)。stat 服务端重算 |
| POST /api/monthsigns/:deptId/:month/sign | equip | 校验：wksOfMonth(month) 非空且每周均已周签(NOT_READY)；月未签过(LOCKED)。Body 同 sign |
| GET /api/monthsigns?deptId=&year= | 登录+范围 | |
| GET /api/files/:id | 登录(Bearer或Cookie)+范围 | 流式 PNG，ETag=sha256，Cache-Control: private,max-age=86400 |

**周签就绪判定（从 H5 移植，实施时打开 H5 615–628 行逐行对照）**：该周 7 天中所有「日期 ≤ 今天」的天，
该科室都存在已签(sign 非空)的 record 才 ready；未开始的周(周一>今天) → EARLY。

## 3. 管理后台（equip/admin；标注 admin 的仅 admin）

| 端点 | 说明 |
|---|---|
| GET/POST /api/admin/users; PATCH /api/admin/users/:id | 建号/改 displayName/role/deptIds/status。**status→off 时吊销其全部 refreshToken**。POST body `{username,password,displayName,role,deptIds:[]}` |
| POST /api/admin/users/:id/reset-password | → `{password:"一次性初始密码"}`，置 mustChange |
| GET/POST/PATCH /api/admin/depts[/:id] | 有记录的科室禁删（改 status:off）；DELETE 仅无记录时 |
| GET/POST/PATCH/DELETE /api/admin/devices[/:id] | 台账维护 |
| GET /api/admin/devices/import-template | 下载 xlsx 模板（列：科室名称/设备品类/设备编码/设备名称/型号/位置/状态） |
| POST /api/admin/devices/import | multipart xlsx≤5MB，**按 code upsert**，科室名不存在→该行报错不自动建。→ `{created,updated,errors:[{row,message}]}` |
| GET/POST/PATCH/DELETE /api/admin/members[/:id] | 签字人名单 |
| POST /api/admin/signs/void (admin) | Body `{type:'day'|'week'|'month',deptId,key,reason}`。作废签字（记录退回未签态），写审计 |
| POST /api/admin/import/legacy (admin) | Body = H5 导出的 `{depts,devices,members,users,records,weeksigns,monthsigns}` JSON，事务导入（users 密码重置为随机+mustChange） |
| GET /api/admin/audit?from=&to= | 审计日志 |

## 4. 统计与导出（equip/admin；dept 可查本科室 stats）

| 端点 | 说明 |
|---|---|
| GET /api/stats/unsigned | → `{days:[{deptId,date}...最近7天未日签], weeks:[{deptId,week}上周及更早未周签], months:[{deptId,month}上月未月签]}` |
| GET /api/stats/completion?month=&deptId= | 按科室：应巡天数/已日签天数/巡检台次/异常台次/周签进度/月签状态 |
| GET /api/stats/ng?from=&to=&deptId= | 异常明细：[{date,deptId,deptName,deviceCode,deviceName,catName,note,inspectorName}] |
| GET /api/stats/signatures?month= | 各科室签字人 × 日/周/月签次数 |
| GET /api/export/monthly.xlsx?deptId=&month= | exceljs 生成：设备×日期矩阵(✓/✗/空) + 异常清单 + 三级签名图(嵌图) 。Content-Disposition attachment |
| GET /api/export/ng.xlsx?from=&to= | 异常清单表 |

## 5. 资产系统云同步网关（equip/admin 账号）

| 端点 | 说明 |
|---|---|
| GET /api/ams/snapshot | → `{seq, keys:{"ams:assets":{value:"<原样JSON串>",version:3}, ...}}` |
| POST /api/ams/push | Body `{deviceId, changes:[{key,value:string|null,baseVersion:int}]}`（null=removeItem）。事务逐 key：baseVersion 匹配→写入 version+1 →`{key,ok:true,newVersion}`；不匹配→`{key,ok:false,conflict:{value,version}}` 不写入。每次写入旧值进 history（每 key 留 20 版） |
| GET /api/ams/changes?since=seq | → `{seq, keys:{...变更}, files:[{id,sha256,size,deleted,seq}]}` |
| GET /api/ams/files/manifest | 全量文件清单 |
| GET/PUT/DELETE /api/ams/files/:id | 二进制体 + Header `X-Ams-Meta`(JSON,去掉 dataUrl 的记录) ；PUT ≤20MB 幂等；DELETE 置墓碑 |
| PUT /api/ams/presence | Body `{deviceId}` → `{others:[{deviceId,lastSeen}]}`（内存表，5min 过期） |

同步 key 白名单（shim 只拦这些前缀，**排除** `ams:session` `ams:ui:*` `ams:_ts` `ams:_lastBackup` `ams:migrated:*`）：
sites/areas/assets/movements/inventories/users/roles/approvals/cats/catCodes/otherCats/otherCatCodes/
otherAssets/depreCfg/locations/tags/changelog。

## 6. 服务端技术栈与目录（server 组件）

Fastify v4 + better-sqlite3(WAL) + bcryptjs + @fastify/jwt + @fastify/cookie + @fastify/rate-limit +
@fastify/multipart + @fastify/helmet + exceljs + node-cron。监听 `0.0.0.0:3000`。
环境变量：`DATA_DIR`(默认 ../data) `JWT_SECRET`(必填) `TZ=Asia/Shanghai`(代码不依赖，仅日志)。
目录：`src/index.js` `src/config.js` `src/db/{connection,migrate}.js` `src/db/migrations/*.sql`
`src/plugins/{auth,error}.js` `src/routes/*.routes.js`
`src/services/{auth,period,record,file,export,import,stats,ams}.service.js`
`src/scripts/{create-admin,backup}.js`。健康检查 `GET /api/health` → `{ok:true}`（匿名）。
限流：全局 300/min/IP；login+login-state 10/min/IP；export 20/min/用户。
备份：node-cron 每日 02:30 `VACUUM INTO DATA_DIR/backups/app-YYYYMMDD.db` + tar files/，保留 30 天。

## 7. 静态路径规划（nginx / deploy 组件）

```
/            → landing 统一入口页
/xunjian/    → medops/h5（巡检 H5）
/admin/      → medops/admin/dist（巡检管理后台，SPA fallback 到 index.html）
/pandian/    → medops/ams/dist（资产系统注入版：index.html + shim.js + app.bundle.js）
/api/        → 反代 api:3000（client_max_body_size 25m; proxy_read_timeout 120s）
```
证书 Let's Encrypt webroot（certbot 容器自动续期）；80→443 跳转；HSTS max-age=15552000。
缓存：/admin/assets/* 一年 immutable；所有 .html 与 /pandian/app.bundle.js no-cache+ETag。
