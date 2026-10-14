# 急救设备巡检系统 · 接口契约 v1

> 本文档是 server / admin / h5 / ams-shim / deploy 五个组件的**唯一对齐基准**。
> 实现与本文冲突时，以本文为准；发现本文有误，先改本文再改代码。

## 0. 总原则

- 前缀 `/api`，JSON over HTTPS。鉴权：`Authorization: Bearer <accessToken>`。
- **所有 id 在 JSON 中一律为字符串**（服务端内部为 SQLite 整数自增，出入口转换），避免 H5 端 `'12' !== 12` 类错误。
- **响应形状对齐 H5 现有数据结构**（H5 视图层不改，只换 API 对象内部实现）。
- 业务日期（今天/周一/月份）**只信服务端**，按 `Asia/Shanghai` 计算。周=周一日期 `YYYY-MM-DD`；月=`YYYY-MM`。
  - 周归属算法（服务端 `period.service.js` 与 H5 同名函数保持一致）：
    - `wkOf(d)`＝d 所在周的周一；
    - `wksOfMonth(m)`＝周一落在 m 月内的**全部**周（月签就绪、周签进度分母都用全部周；
      旧版只取「已开始的周」，月初签完第一周就能把整月签掉并锁死，已废弃）；
    - `signMonthOf(d)`＝`moOf(wkOf(d))`：一天的记录归哪个月的月签管，看它所在的周归哪个月
      （例：2026-08-01 属于 07-27 那一周 → 归 7 月；2026-09-02 属于 08-31 那一周 → 归 8 月）；
    - `monthSpan(m)`＝月签覆盖范围：第一周周一 ～ 最后一周周日（首尾可能跨到上月末、下月初）。
  - **签字规则**：可以补签过去的日期，不能提前签；签字即锁定；作废必须自上而下（先月签、再周签、再日签）。
- 错误统一 `{error:{code,message,retryAfter?}}`，HTTP 状态码语义化。code 枚举：
  `BAD_INPUT` `UNAUTHORIZED` `KICKED`(账号被禁用) `FROZEN`(登录冻结,423) `PROBE_COOLDOWN`(设备枚举冷却,429)
  `FORBIDDEN` `MUST_CHANGE_PASSWORD`(密码被重置后未改,403) `NOT_FOUND` `LOCKED`(已签锁定) `NOT_READY`(前一级未签齐)
  `EARLY`(周期未开始/未结束) `CONFLICT` `RATE_LIMITED`。
- 登录成功同时下发 httpOnly Cookie `sid`（SameSite=Lax, path=/api），**仅用于 `<img>`/下载类 GET**
  （`/api/files/*`、`/api/export/*`、`/api/ams/files/*` 同时接受 Bearer 或 Cookie；其余端点只认 Bearer）。
  sid 的 JWT 带 `typ:'sid'` 与签发设备号：拿 sid 当 Bearer 一律 401；签发它的设备已没有有效登录
  （退出、被吊销、停用、重置密码）时 sid 随之失效。
- 待改密（`mustChange`，管理员重置密码后）：除 `/auth/me`、`/auth/change-password`、`/auth/logout`、`/time`
  外的接口一律 403 `MUST_CHANGE_PASSWORD`。
- 服务端只信一层反向代理（`TRUST_PROXY`，默认 1）：`req.ip` 取代理追加的那一项 X-Forwarded-For。
- 角色：`inspector`(巡检员,可多科室) / `dept`(护士长,单科室) / `equip`(设备科,全院) / `admin`(超管)。
  `equip`、`admin` 可用管理后台；数据范围过滤在**服务端**执行。

## 1. 认证

### POST /api/auth/login（匿名）
Header `X-Device-Id: <客户端UUID>`（H5/admin 首次生成后存 localStorage）。
Body `{username, password}`。
校验顺序：① 设备+IP 枚举冷却（同一「设备+IP」2 分钟窗口失败≥8 → 429 PROBE_COOLDOWN，不区分账号是否存在；
另有同一 IP 失败≥60 的宽上限，只拦脚本换设备号。医院共用出口 IP，不能单按 IP 计）
② 账号不存在 → 401 UNAUTHORIZED（文案与密码错相同："账号或密码不正确"）
③ 冻结中 → 423 FROZEN + retryAfter 秒 ④ 已禁用 → 403 KICKED("您的账户已被禁用，请联系设备科")
⑤ bcrypt 失败 → 计数+1，满 5 次冻结 5/10/15…分钟递增（轮次不封顶），返回 401（若此次触发冻结返回 423）
⑥ 成功 → 清零该账号失败计数与冻结轮次（**不清**设备+IP 的失败计数），返回：
```json
{ "accessToken":"<jwt 30min>", "refreshToken":"<random 43ch>", 
  "user":{"id","username","displayName","role","deptId","deptIds":["..."],"mustChange":false} }
```
JWT payload: `{sub, role, deptIds, dn}`。refreshToken 30 天，服务端只存 sha256。

### POST /api/auth/refresh（匿名）
Body `{refreshToken}` + Header X-Device-Id。轮换：旧 token 吊销、发新对（响应同 login），新 token **沿用原设备号**。
先判账号状态：已停用 → 401 KICKED。已吊销 token 被重放 → 吊销该用户该设备全部 token，401。
请求头设备号与签发设备不一致 → 按盗用处理，吊销该组并 401。**H5"一键登录"即存 refreshToken**（不再存密码）。

### POST /api/auth/logout（匿名即可）— 吊销 body 里的 refreshToken + 清 cookie（access 过期后也能退出）。
H5：勾了「记住此账号」的退出时不吊销（留给一键登录）；移除记住的账号时再吊销。
### GET /api/auth/login-state?username=（匿名，限流 30/min/「设备+IP」）
→ `{frozen:bool, retryAfter?:sec, disabled:bool}`。仅当该 X-Device-Id 曾成功登录过该账号才返回真实
`disabled`；否则 disabled 恒为 false（防枚举）。frozen 可如实返回。
### GET /api/auth/me（登录）→ user 对象（同 login.user）。禁用账号返回 401 KICKED。
### POST /api/auth/change-password（登录，待改密也可调）Body `{oldPassword,newPassword 6–64 位，不能与原密码相同}`。
成功后清 mustChange；该用户**其它设备**的 refreshToken 全部吊销，当前设备保持登录。
### GET /api/time（登录）→ `{now:"YYYY-MM-DD HH:mm", date:"YYYY-MM-DD", week:"YYYY-MM-DD", month:"YYYY-MM"}`
H5 启动后所有 today()/wkOf(today())/moOf(today()) 用它（S.date/S.week/S.month 初始化 + 每次进入首页刷新）。

## 2. 巡检业务（H5 主用；管理后台读共用）

数据形状（与 H5 localStorage 结构一致，仅 sign.dataUrl → sign.url）：
```
dept   {id,name,code,sort,status:'on'|'off',startDate}   # startDate：应巡起算日（建科室日与最早记录取早）
device {id,deptId,catName,code,name,model,location,status:'in_use'|...}
        # 有效期三字段 expiryDate/expiryNote/remindDays 只由 /api/admin/devices 返回，
        # H5 侧的 GET /api/devices 不含（H5 的有效期数据走 /api/stats/expiry）
member {id,deptId,name,title,status:'on'}
record {id,deptId,date,checks:{[deviceId]:'ok'|'ng'},notes:{[deviceId]:string},
        sign:null|{name,title,url,opinion,at,userId},inspectorId,inspectorName,createdAt,updatedAt}
        # 名字一律显示当前名（按账号 / 签字人名单 ID 关联），关联对象删除后显示签字当时的快照
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
| PUT /api/records/:deptId/:date | inspector+范围 | Body `{checks,notes}` 整体覆盖。拒绝：date>今天(EARLY)、该日已签(LOCKED)、该日所在周已周签(LOCKED)、`signMonthOf(date)` 已月签(LOCKED)、科室已停用(BAD_INPUT)。checks 键须为规范正整数、≤2000 个；只能勾本科室**在用**设备，或这条记录里本来就勾过的设备（当天被调拨/停用的，早上做过的保留） |
| POST /api/records/:deptId/:date/sign | inspector+范围 | Body `{dataUrl,opinion}`。签字人 = 登录的巡检员本人（不信前端传的姓名）。校验同上+PNG magic bytes+解码≤1MB。落盘后返回完整 record |
| GET /api/weeksigns?deptId=&from=&to= | 登录+范围 | from/to 匹配 week 字段；from 不是周一时对齐到所在周周一 |
| POST /api/weeksigns/:deptId/:week/sign | dept+范围 | Body `{memberId,dataUrl,opinion}`，签字人必须是本科室签字人名单里的在用成员。校验：week 是周一(BAD_INPUT)；周一 > 今天(EARLY)；该周**周一到周日 7 天全部已日签**才能签——有已到却没日签的天 → NOT_READY（指明日期），还有没到的天 → EARLY（所以最早在周日签完当天）；(dept,week) 未签过(LOCKED)。stat 服务端重算 |
| POST /api/monthsigns/:deptId/:month/sign | equip/admin | 签字人 = 登录账号。校验：月份 01–12；`wksOfMonth(month)` **全部**周都已周签——有该签未签的周 → NOT_READY，最后一周还没结束 → EARLY；月未签过(LOCKED)。stat 按 `monthSpan(month)` 统计（= 各周之和） |
| GET /api/monthsigns?deptId=&year= | 登录+范围 | |
| GET /api/files/:id | 登录(Bearer或Cookie)+范围 | 流式 PNG，ETag=sha256，Cache-Control: private,max-age=86400 |

**就绪判定**（`period.service.js` 的 weekState/monthState，H5 同名函数同一规则）：
周签 = 该周 7 天都有已签 record；月签 = 归属该月的全部周都有周签。
⚠ 旧版周签只看「已到的天」（周一签完当天就能签本周）、月签只看「已开始的周」，都属于提前签，已废弃。

## 3. 管理后台（equip/admin；标注 admin 的仅 admin）

| 端点 | 说明 |
|---|---|
| GET/POST /api/admin/users; PATCH /api/admin/users/:id | 建号/改 displayName/role/deptIds/status。**status→off 时吊销其全部 refreshToken**。POST body `{username,password,displayName,role,deptIds:[]}`。护士长恰好 1 个科室（PATCH 按最终角色+科室校验）。管理员账号的创建/修改/重置/解冻、授予管理员角色仅 admin 可做；不能停用自己、不能改自己的角色；至少保留 1 个启用的管理员。列表返回 `frozenUntil`/`frozenSec` |
| POST /api/admin/users/:id/reset-password | → `{password:"一次性初始密码"}`，置 mustChange，清冻结，吊销其全部 refreshToken |
| POST /api/admin/users/:id/unfreeze | 解除密码连错冻结（不改密码），冻结轮次清零 |
| GET/POST/PATCH /api/admin/depts[/:id] | 有巡检或签字记录的科室禁删（改 status:off）；有护士长账号属于它时也禁删（先处理账号）。停用科室：不能再录入巡检/日签；历史统计、导出照常；在用的过期设备照常提醒 |
| GET/POST/PATCH/DELETE /api/admin/devices[/:id] | 台账维护。有效期入参 `{expiryDate,expiryNote,remindDays}`：日期须为真实存在的 `YYYY-MM-DD`（空串=不适用）且年份 ∈ [1970, 今年+30]（挡两位年份误输入与 2026→2062 手滑），remindDays 为 0～365 的整数，非法→400 BAD_INPUT。DELETE depts 时若本科室设备被任何巡检记录引用→409（设备可跨科室调拨，不能只看本科室有无 records）。status 只能是 in_use/repair/retired/scrapped，其它值 400（报错里带上原值）。DELETE devices：被巡检记录引用→409 CONFLICT，message 写明记录天数、最近日期，并提示改为停用/报废（作废签字不删巡检记录）；删除成功记审计 device_delete |
| GET /api/admin/devices/import-template | 下载 xlsx 模板（列：科室名称/设备品类/设备编码/设备名称/型号/位置/状态/有效期/提醒提前天数） |
| POST /api/admin/devices/import | multipart xlsx≤5MB，**按 code upsert**，科室名不存在→该行报错不自动建。→ `{created,updated,errors:[{row,message}]}`。有效期两列的写入语义：**列不存在或该格留空 = 本次不改动**（老 7 列模板重导入不会清空已录到期日），填「无/-/清空」= 清空，填日期 = 覆盖。日期必须年月日填全（不做 `new Date()` 宽松兜底），状态须命中白名单否则整行报错 |
| GET/POST/PATCH/DELETE /api/admin/members[/:id] | 签字人名单。同科室重名 → 409；不能改科室（400）；改名后历史周签显示新名 |
| POST /api/admin/signs/void (admin) | Body `{type:'day'|'week'|'month',deptId,key,reason}`。作废签字（记录退回未签态）。**必须自上而下**：周签在时不能作废其中的日签，月签在时不能作废其中的周签（409 LOCKED）。reason 去空白后不能为空。审计记下原签字人、时间、签名图、统计 |
| POST /api/admin/import/legacy (admin) | Body = H5 导出的 `{depts,devices,members,users,records,weeksigns,monthsigns}` JSON，事务导入（users 密码重置为随机+mustChange） |
| GET /api/admin/audit?from=&to= | 审计日志 |

## 4. 统计与导出（equip/admin；dept 可查本科室 stats）

| 端点 | 说明 |
|---|---|
| GET /api/stats/unsigned | → `{days:[{deptId,date}...最近7天未日签，不早于科室起算日，无在用设备的科室不算], weeks:[{deptId,week}上周及更早未周签，最多 12 周], months:[{deptId,month}最后一周已结束、覆盖范围内有记录、未月签的月，最多 12 个月]}`。只含启用中的科室 |
| GET /api/stats/completion?month=&deptId= | 按科室：应巡天数（从科室起算日算）/已日签天数/巡检台次/异常台次/周签进度（分母=全部周）/月签状态/deptStatus。全院范围含「该月有记录」的停用科室 |
| GET /api/stats/ng?from=&to=&deptId=&sign= | 异常明细：[{date,deptId,deptName,deviceCode,deviceName,catName,deviceStatus,note,inspectorName,signed,signVoided}]。列出巡检员记下的全部 ng 结果（作废日签不删结果）；signed=当天是否已日签，signVoided=未签且这天的日签被作废过（据审计 sign_void）；deviceStatus=设备现在的状态。sign 可选 signed/unsigned 只看已日签/未日签，其它值 400；日期须为 YYYY-MM-DD |
| GET /api/stats/signatures?month= | 各科室签字人 × 日/周/月签次数 |
| GET /api/stats/expiry?all=&deptId= | 有效期清单：`[{deviceId,deptId,deptName,code,name,catName,location,expiryDate,expiryNote,level,days,remindDays}]`。level ∈ expired/soon/ok；默认只回 expired+soon，`all=1` 回全部已设有效期的。按紧急度→剩余天数→科室→编码排序。全角色可访问（巡检员也要看到本科室），范围由 visibleDeptIds 收窄 |
| GET /api/stats/expiry/summary | → `{expired,soon,total}`，首页角标用 |
| GET /api/export/monthly.xlsx?deptId=&month= | exceljs 生成：设备×日期矩阵(✓/✗/空) + 异常清单 + 三级签名图(嵌图)。矩阵设备行 = 该月在本科室实际巡检过的设备（调走的注明现属科室）∪ 本科室当前在用、该月前已建档、且该月没在别的科室被巡检的设备。文件名 `巡检月报_科室_月份.xlsx`（filename*） |
| GET /api/export/ng.xlsx?from=&to=&deptId=&sign= | 异常清单表，deptId、sign 可选（同 /api/stats/ng）；末两列「当日签字」「设备现状」 |

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
限流（网络层，按 IP，阈值按「全院共用出口 IP」定）：全局 1200/min；login 60/min；login-state 30/min/「设备+IP」；export 20/min/用户。
真正防撞库的是账号冻结（连错 5 次）与「设备+IP」枚举冷却。
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
