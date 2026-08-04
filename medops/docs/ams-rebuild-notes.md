# 资产盘点系统 v1.10.6 模块地图（重建/核对底稿）

- 原件：`medops/ams/original/pandian-v1.10.6.html`（1.38MB 单文件，勿改动）
- 美化参照稿：会话 scratchpad `ams-ref/`（20 个切片 + index.md，切片首注释标注 bundle-pretty.js 行区间；bundle-pretty.js = 原件第 3 个 script 美化+中文解码稿，25494 行，其中 L8599–25380 为业务代码）
- 技术栈：React 18.3.1 + react-dom（production build）、lucide-react 0.383.0、PapaParse 5.5.3（bundle 内）、SheetJS xlsx 0.18.5（独立 `<script>` 挂 `window.XLSX`）、Tailwind 预编译 CSS（`<style>` 内联）。无路由库、无状态库：单 App 组件 + useState + localStorage。
- 品牌文案：「勇鸿资产 · 企业级IT资产生命周期平台」，logo 为内嵌 base64 PNG（压缩名 `Qo`）。
- 挂载：`createRoot(#root).render(<hd/>)`；`hd` = App 根组件；`qg` = 全局 style（暗色覆盖 + 打印 CSS）。
- 种子数据：第 2 个 `<script>` 的 `window.__SEED__`，含 `ams:sites`(12 部门)、`ams:assets`(157)、`ams:movements`(157)、`ams:inventories`(0)；仅当 localStorage 无 `ams:assets` 时写入（函数 `ng`）。

## 1. 导航结构（`hd` 内数组 `Dl`，唯一路由真源）

页面切换即 `useState("dash")`（无 URL 路由，刷新回首页）。`Dl.filter(项 => H.can(perm) 或 perms.some(can))` 后套导航自定义（`ams:ui:navCustom` 的 order/hidden/color，`_NavCustomizer` 编辑）渲染侧栏；移动端为抽屉复用同一份 JSX。

| key | 菜单名 | 权限点 | 根组件(压缩名) | 推断名 |
|---|---|---|---|---|
| dash | 首页总览 | dashboard.view | `hg` | Dashboard |
| lifecycle | 生命周期 | dashboard.view | `LifeDash` | 生命周期分析 |
| map | 资产地图 | assets.view | `AssetMap` | 楼层平面资产地图 |
| health | 数据健康 | assets.view（badge=高危问题数） | `DataHealthCenter` | 数据健康中心 |
| assets | 电脑台账 | assets.view | `xg` | AssetsPage |
| others | 其他资产 | assets.view | `Cg` | OtherAssetsPage |
| archive | 归档/报废 | archive.view | `wg` | ArchivePage |
| activity | 流转动态 | dashboard.view | `mg` | ActivityPage |
| changelog | 修改日志 | assets.view | `Clg` | ChangelogPage |
| inventory | 盘点任务 | inventory.view（badge=进行中任务数） | `Sg`(+`Ng`核对页) | InventoryPage |
| approvals | 资产审批 | perms:[approval.submit, approval.approve]（badge=待审批数，仅审批人可见） | `vg` | ApprovalsPage |
| sites | 设置管理 | settings.sites | `Fg` | SettingsPage |
| users | 权限管理 | settings.users | `Bg` | UsersRolesPage |

未登录渲染 `pg`（登录页）。`sites`/`users` 渲染处再次 `H.can(...)` 双重校验。顶栏全局搜索框输入后回车/点击跳 `assets` 页并作为 `externalQ` 传入。

## 2. 页面职责 / 主要子组件 / 存储

约定：业务数组全部由 `hd` 统一加载（`yr(V.*)`）并以 props 下发，写回用 `hd` 传入的 persist 回调（内部 `Yt(V.*, 数据)`）。下表"直接存储"指组件内部直接碰 localStorage/IndexedDB 的 key。

| 组件 | 职责一句话 | 主要子组件 | 直接存储 |
|---|---|---|---|
| `pg` 登录 | 用户名+密码（`Ko` 哈希比对）、强制首登改密、登录页即可连接数据文件 | `Ns`(密码框) | 无（session 由 hd 写） |
| `hg` 首页 | 统计卡+状态分布+最近流转+进行中盘点提醒，含三个跳转回调 | `Zo/pm/bt` | 无 |
| `LifeDash` 生命周期 | 按购置年份/使用年限/保修状态/折旧净值(`_depNet`)透视电脑资产 | — | 读 ams:depreCfg(经 `_depCfg`) |
| `AssetMap` 资产地图 | 楼栋→楼层→房间三级建模、资产落位、热力/平面图、SVG/PNG/XLSX 导出 | 内部 prompt/confirm 小弹窗 | 读写 ams:locations |
| `DataHealthCenter` 数据健康 | 规则集 `buildHealthIssues` 按高中低分级展示并定位跳转 | — | 读 ams:changelog、ams:_lastBackup |
| `xg` 电脑台账 | 核心 CRUD：筛选/列显隐/分页、CSV+XLSX 导入、CSV 导出、批量六操作、打印 | `gg`(表单) `hm`(详情) `kg`(流转) `Pg`(签收表) `xm`(确认表) `zg/Ag`(批量部门/流转) `_BatchRetireForm` `_BatchDisposeModal(+Print)` `_TagBatchForm/_TagScanModal` `Vcp`(复制) | 读写 ams:ui:assetCols、写 ams:changelog(经 `logCL`)、读 ams:locations(经 `_locLabel`) |
| `gg` 资产表单 | 由 31 字段表 `Pl` 驱动渲染，自动编号 `cd`+前缀表 `dd`，combo 字段用历史值联想 | `Xinp` | 无 |
| `hm` 资产详情 | 信息卡+时间线+附件+留言+发起流转按钮 | `LifeTimeline` | IndexedDB `Fl`(ams-files) 附件 |
| `Cg` 其他资产 | 非电脑资产台账（多"使用区域 area"维度），CSV 导入导出 | `Ig`(表单) | 无 |
| `wg` 归档/报废 | 报废资产列表、还原（清 dispose\* 字段+logCL）、处置登记与处置单打印 | `_DisposeModal/_DisposePrint` | 写 ams:changelog |
| `mg` 流转动态 | 全量流转/操作日志筛选浏览，XLSX 导出 | — | 读 ams:locations |
| `Clg` 修改日志 | 展示 `logCL` 的逐字段 diff 日志，筛选+XLSX 导出 | `Vcp` | 读写 ams:changelog |
| `Sg` 盘点任务 | 任务列表/进度/暂停继续/提前终止/删除/标记完成、打印 | `bg`(发起) `Ng`(核对页) `xm`(确认表) `im`(全选条) | 读写 ams:ui:invF:\*、invPg:\* |
| `Ng` 盘点核对 | 逐资产 在位/缺失/异常/维修 + 差异原因多选 + 备注 + 批量在位 + 打印 | `xm` | 读写 ams:ui:pageSize:invDetail:\* |
| `vg` 资产审批 | 待办/我的/全部三 tab、勾选批量通过/驳回、撤回自己的申请 | `yg`(发起申请) `Lg`(审批单详情) | 无（执行逻辑在 hd 的 `Wt/Xe`） |
| `Fg` 设置管理 | 部门/区域/分类及编码维护、数据文件连接、备份导出/恢复/对比、全量 Excel、清空业务数据、折旧配置 | `Tg`(部门资产概览) `DepCfg` | 写 V 多 key（wipe 回调由 hd 传入） |
| `DepCfg` 折旧配置 | 按分类维护 使用年限/残值率 覆盖默认表 `_depLifeDef` | — | 读写 ams:depreCfg |
| `Bg` 权限管理 | 用户/角色两 tab CRUD、停启用、重置密码、防删最后一个超管 | `Dg`(重置密码) `Mg`(用户表单) `Eg`(角色表单) | 无 |
| `BackupCompare`/`Og` | 当前数据 vs 备份 JSON 差异对比 / 恢复预览（合并 or 覆盖） | `diffBackups/normalizeBackupData` | Og 应用时直接写全部 ams:\* |

## 3. 全局 state 形态（`hd`，全部 useState，无 useReducer）

```
e/t        当前页 key("dash")        a/l   loading(true)
o/n  sites 部门[]                    s/i   areas 区域[]
d/m  assets 电脑资产[]               g/p   movements 流转[]
v/I  inventories 盘点任务[]          L/N   approvals 审批[]
O/c  otherAssets 其他资产[]          u/x   users[]        b/C  roles[]
f/h  上次同步时间串                  Dv/qv dataVersion 计数器
S/w  session userId                  D/B   移动端抽屉开关
_navCfg{order,hidden,color} + _navEdit/_navDraft   导航自定义
T/M  顶栏全局搜索词(→xg externalQ)   E/y   cats 电脑分类[]
F/G  数据文件状态{mode:local|file|prompt, name}     Z/le 刷新动画
Q/R  toast 文本                      re/fe 对话框对象
pe/ne 暗色主题                       Ue/at 待恢复备份     CmpBk 备份对比开关
```

派生（useMemo/表达式）：`H` 当前用户权限对象；`Fa/ea` 按 scope 过滤的资产；`Wa` scope 部门；`Vt` scope 其他资产；`_hiCnt` 健康高危数；`pa` 待审批数。

关键回调：
- persist 系列（set state + `Yt`）：`He(assets) pt(movements) ba(sites) z(areas) J(inv) K(users) me(roles) Ke(approvals) fa(otherAssets)`
- `he` 追加一条流转；`Pe` 追加操作日志（movement type:"log"，经 `Bt.log`/`Al` 供任意组件调用）
- 审批：`Na`(提交，单号 SP-YYYYMMDD-NNN)、`Wt`(裁决并执行资产变更)、`se`(撤回)、`Xe`(批量裁决)
- `ke` 全量重载；`ve` 手动刷新；storage 事件跨窗口同步（防抖 300ms，忽略 ams:ui:\*/session/_ts）
- 数据文件：`Se`(连接/新建) `$e`(换文件) `ze`(断开) `qe`(导出备份 JSON) `yt`(全量 Excel) `Me/et`(恢复备份读取/应用)

## 4. 存储层 API 面

Key 表 `V`（10-store.js）：
`ams:sites areas assets movements inventories users roles approvals catCodes cats otherCats otherCatCodes otherAssets depreCfg locations tags session`

表外 key：`ams:changelog`（修改日志，上限 2000 条）、`ams:_ts`（写时间戳，跨窗口/文件冲突判定）、`ams:_lastBackup`、`ams:migrated:pageSize20|pageSize10|areas`（一次性迁移标记）、`ams:ui:*`。

- 读 `yr(key)` / 写 `Yt(key,val)`：写后 bump `ams:_ts`、触发数据文件防抖保存 `ld()`、ams:\* 总量 >4MB 弹一次配额告警。
- 数据文件模式（File System Access API，仅 Chrome/Edge）：句柄存 IndexedDB `ams-fs`/kv/"handle"；`Ms` 把 `dm()` 全量快照写 JSON 文件（防抖 800ms）；启动 `ag` 自动重连（权限未授予返回 "prompt"；对比文件 `_savedAt` vs 本地 `ams:_ts`，本地更新则不覆盖）；`rg/lg/og` 连接/换文件/断开，句柄失效自动清理重选。
- 备份：`dm()` 导出全部 V key（除 session）+ changelog + `_app`/`_savedAt` 头；`tg(obj)` 恢复（changelog 走 `mergeCL` 合并）；`Og` 恢复预览支持"合并/覆盖"。
- 附件：IndexedDB `ams-files`/files（keyPath:id, index byAsset），`eg` 先 canvas 压图 ≤1600px JPEG q0.8。
- ui 偏好 key：`theme navCustom assetCols pageSize pageSize:{assets,activity,approvals,others,inv} pageSize:invDetail:* invF:* invPg:*`（`Yo` 分页 hook 统一负责 pageSize/页码持久化）。
- 各业务 key 读写归属：**读集中在 hd 的 `ke`**（8 key Promise.all）+ 同步读分类区域（`dg/sd/Bs/ud/dd`）；**写集中走 hd 下发的 persist 回调**。组件直写例外：locations→AssetMap；changelog→logCL/Clg/wipe；depreCfg→DepCfg；tags→标记字典 `_tagSave`；cats/catCodes/otherCats/otherCatCodes→Fg 与 hd 的 `j`；session→hd 登录登出；全 key→Og/tg/wipe。

## 5. 核心数据模型（record 形态，重建时的字段基准）

- **资产 asset**（`Pl` 31 字段 + 系统字段）：`{id:"as..", createdAt, seq, code, fixedAssetCode, deptAssetCode, historyCode, category, model, name, brand, qty, sn, spec, status: in_use|in_stock|repair|retired, siteId, holder, title, phone, location, os, office, receiveDate, purchaseDate, lastMaintain, warrantyEnd, price, usefulLife, residualRate, vendor, checkMei:是|否, reset:是|否, recorder, remark, remark2, roomId?, tags?:[名], disposeType?/disposeAmount?/disposeDate?/disposeTo?/disposeRemark?/disposeNo?/disposeAt?/disposeBy?}`
- **流转 movement**：`{id:"mv..", createdAt, assetId, assetCode, type: inbound|receipt|assign|transfer|return|repair|retire|dispose|log, fromSite, fromHolder, toHolder, toSite, date, operator, remark, comments?:[{text,by,at}]}`；type:"log" 时另有 `action` 字段（操作日志与流转同表）。
- **盘点任务 inventory**：`{id:"iv..", docNo:"PD-YYYYMM-NNN", createdAt, status: open|paused|done|terminated, kind: dept|area, name, period: mid|year, siteIds:[]|areaIds:[], mode: live|snapshot, snap: null|[资产快照], results:{ [assetId]: {state: present|missing|abnormal|repair, note, diff(差异原因、来自 om 表), checkedAt} }}`
- **审批 approval**：`{id:"ap..", no:"SP-YYYYMMDD-NNN", type: assign|transfer|retire, assetId, assetCode, status: pending|approved|rejected|cancelled, applicant, applicantId, appliedAt, reason, payload:{toHolder,toSite,date,remark}, approver?, approvedAt?, opinion?, timeline:[{action,by,at,note}]}`
- **用户 user**：`{id:"user_..", username, displayName, pwd:Ko(明文), roleId, active, mustChange}`；**角色 role**：`{id:"role_..", name, builtin, perms:[权限key], siteScope:"all"|[siteId]}`
- **部门 site / 区域 area**：`{id, name, code}`；**其他资产 otherAsset**：`{id, name, code, category, siteId, areaId, hospital(旧字段), qty, remark}`
- **位置 locations**：`[{id, name, floors:[{id, name, rooms:[{id, name, gx, gy, gw, gh}]}]}]`，资产以 `roomId` 落位
- **修改日志 changelog**：`{id:"cl..", at, type: asset_create|asset_edit, code, actor, before:资产快照|null, after:资产快照|null}`（`logCL` 写入、`mergeCL` 按 id 去重合并、上限 2000）
- **标记 tag**：内置 `TAGP` 6 个（建议报废/待确认/待分配/借用中/已寄回/全新）+ `ams:tags` 自定义 `{name, color}`；`_tagScan` 从备注关键词识别
- **备份文件**：`{_app, _savedAt, "ams:sites":[...], ..., "ams:changelog":[...]}`（即 `dm()` 输出，数据文件与手动备份同格式）

## 6. 权限系统

权限点表 `zs`（15 个，含 group/label/desc，desc 写到按钮粒度，`Eg` 角色表单按 group 分组勾选）：

| group | 权限点 |
|---|---|
| 概览 | dashboard.view |
| 资产台账 | assets.view / assets.edit(录入·编辑·导入·附件) / assets.move(流转分发) / assets.export |
| 归档 | archive.view |
| 盘点 | inventory.view / inventory.check(核对操作) / inventory.manage(发起·暂停·终止·删除·完成) |
| 打印 | print(确认表/签收表/盘点打印) |
| 资产审批 | approval.submit / approval.approve |
| 系统设置 | settings.sites(设置管理页) / settings.users(权限管理页) |

- 内置角色 `sg`：超级管理员(全部, builtin)、资产管理员(除 settings.users)、部门管理员(view+move+盘点view/check+print+approval.submit, siteScope=[])、查看者(只读+approval.submit)。内置用户 `ig`：admin/admin123（`Ko` imul 哈希，mustChange 强制改密）。
- 用户上下文 `H`（hd useMemo）：`{user, role, perms:Set, scopeAll, scopeIds, name, can(k), inScope(siteId)}`；数据范围统一在 hd 先过滤再下发（`ea/Wa/Vt/Fa`），页面内再用 can 控制按钮。
- `can` 调用分布（次数）：approval.approve×11、assets.edit×10、inventory.manage×8、print×7、inventory.check×5、assets.move×3、assets.export×2、其余各×1；`inScope`×11。
- 迁移 `pd` 会给存量角色补新增权限点（仿照：给 role_asset 补 approval.\*，给 dept/viewer 补 approval.submit）——新增权限点时必须同步在这里补丁，否则老库角色缺权限。

## 7. 复用基础 UI 清单（15-ui-primitives.js 为主）

| 压缩名 | 是什么 | 特征 Tailwind |
|---|---|---|
| `X` | 按钮，variant: primary/soft/ghost/danger/dark | `rounded-full px-4 py-2 text-sm`，primary=`bg-[#2F6BFF]`+投影 |
| `it` | 弹窗骨架（标题+X 关闭+Esc） | `fixed inset-0 z-50 bg-zinc-900/40 backdrop-blur-sm` + `rounded-3xl bg-white shadow-2xl`，wide=max-w-3xl |
| `Bl` | 确认/错误对话框（承接全局 `$`错误 与 `Dt`确认） | `z-[60] max-w-sm rounded-3xl`，TriangleAlert 图标 |
| toast | 全局 toast（`Re`/hd 内 `ue`，2.2s 自消） | `fixed bottom-6 z-[70] rounded-full bg-zinc-900/90 text-white` |
| `ce` / `be` | 表单字段 / 筛选字段（label 包子元素） | label `text-xs text-zinc-500`，be 默认 `w-44` |
| `U` | 输入框公共 class 字符串常量 | `rounded-xl bg-zinc-100 focus:ring-[#2F6BFF]` |
| `Cr` | 筛选栏容器（Enter 触发查询 + 查询/重置按钮） | `rounded-3xl bg-white p-4 shadow-[0_6px_24px_-12px_...]` |
| `Yo`/`en` | 分页 hook / 分页条（每页 10~300/全部，全部上限 1000 条，页码省略号） | — |
| `nm` | 卡片内"加载更多/收起" | `rounded-full ring-1`，accent 可选 violet |
| `Zo`/`pm`/`mm` | 通用徽章 / 实心状态徽章 / 圆点+文字状态 | 配色来自字典 `Mt` |
| `bt` | 空态占位 | `py-6 text-zinc-400` + CircleSlash |
| `Ns`/`Xinp`/`Vcp` | 密码框(可见切换) / 带清空按钮输入 / 编号点击复制 | Vcp 配 `<style>` 里 `.vcp-*` |
| `im` | 全选/全不选条 | `rounded-full bg-zinc-100 text-[11px]` |
| `gm` | 打印 Portal（动态建 `#print-root` 挂到 body） | — |
| `_NavCustomizer` | 侧栏自定义弹窗（排序/隐藏/8 色突出显示） | — |
| 字典 | `Mt`资产状态 `ja`流转类型 `fm`盘点结果 `om`差异原因×11 `Va`任务状态 `zl/$o`审批类型/状态 `TAGP`标记 | label+cls 成对，重建时先建字典 |

全局桥 `Bt = {toast, dialog, log}`：hd 挂载时注入实现，任意深度组件经 `Re/$(错误)/Dt(确认)/Al(日志)` 调用，无需 context。

## 8. 三大专项实现要点

打印（4 套模板，全部走 `gm` Portal + `qg` 打印 CSS）
- `qg` 注入 `@media print`：隐藏 `#root`、只渲染 `#print-root .print-area`（根治空白页/串页）、`@page` A4 + `@bottom-center` "第 x 页/共 y 页"、`thead{display:table-header-group}`、行/签字区 `break-inside:avoid`；暗色主题下打印区强制白底。
- 模板：`Pg` 签收表（先填收件信息 → 单号 `YH-QS-{资产code}-{yyyymmdd}`，打印即 `window.print`，同时记 movement type:receipt）；`xm` 台账/盘点确认表（部门/区域/全部/勾选部分行，xg、Sg、Ng 三处复用，打印动作记 `Al` 日志）；`_DisposePrint` 处置单；`_BatchDisposePrint` 批量处置单。

Excel/CSV
- 导入：`xg` 支持 CSV（`Fs.default.parse`，即 Papa，BOM 兼容）与 XLSX（`XLSX.read(ArrayBuffer)` → aoa），按 `Pl` 中文列名映射字段，重复编号可跳过/更新；`Cg` 其他资产 CSV 导入。
- 导出：CSV = BOM + `Fs.default.unparse` + `Xo` 下载；全量 Excel（`Fg` → hd `yt`）为手拼 SpreadsheetML `.xls` **五工作表**（电脑台账/其他资产/流转记录/审批记录/盘点任务，含处置与标记列）；`mg`/`Clg` 用 `XLSX.utils` 导 `.xlsx` 单表；`AssetMap` 导 4 表（概览/楼栋楼层分布/房间明细/资产位置清单）。
- `Xo(文件名, 内容, mime)`：Blob+a.download，失败降级 data: URI。

资产地图 SVG
- 数据模型见第 5 节 locations；`_locLabel`（模块级缓存 `_locCache`，storage 变更时失效）供台账/流转页显示"楼/层/房"。
- 视图：网格卡片 vs 平面布局（编辑模式拖拽房间格子改 gx/gy/gw/gh），按房间资产数密度着色（5 档色阶），搜索定位高亮，未分配资产侧栏（无 roomId 或 roomId 失效）。
- 导出：`_buildPlanSVG` 纯字符串拼 `<svg>`（背景+标题+房间 rect+名称+数量+密度图例）→ 直接下 SVG，或 Image+canvas 转 PNG。

## 9. 「急救医疗设备」新菜单集成挂点

零代码方案（先评估）：若只需分类管理，直接在 设置管理→其他资产分类 加「急救医疗设备」（进 `ams:otherCats`，编码进 `ams:otherCatCodes`），用现有 `Cg` 页面即可；区域筛选、CSV 导入导出、区域盘点（盘 otherAssets）、全量导出全部自动复用。

独立菜单方案（改 5 处，均有现成模式可抄）：
1. **权限点**：`10-store.js` 的 `zs` 追加 `{k:"emergency.view", label, group:"急救设备", desc}`（需编辑再加 `emergency.edit`）；`pd()` 给存量角色补权限（仿 approval.submit 补丁写法）；内置角色 `sg` 默认集按需加。
2. **存储 key**：`V` 加 `emAssets:"ams:emAssets"`；`dm/tg` 走 `Object.values(V)` 自动进备份，无需另改；`Fg` 的 wipe、hd 的 `yt` Excel 导出按需追加该表。
3. **App state**：`hd` 加一组 useState + `ke` 的 Promise.all 加 `yr(V.emAssets)` + persist 回调（完全仿 otherAssets 的 `O/c/fa` 三件套）+ scope 派生（仿 `Vt`）。
4. **导航**：`Dl` 数组插入 `{k:"emergency", label:"急救医疗设备", icon:(lucide Activity=Rr 或另引 Stethoscope), perm:"emergency.view"}` —— 权限过滤、自定义导航、移动端抽屉自动生效。
5. **页面组件+路由**：以 `Cg`+`Ig`（含区域维度、CSV 导入导出）为模板复制改字段（建议：设备名称/型号/SN/存放点/负责人/检查周期/上次检查日/效期/状态）；`hd` main 区加 `Y==="emergency" && <EmergencyPage .../>` 分支。若要巡检打卡，仿 `bg` 把盘点 kind 扩展一种。

注意：数据健康 `buildHealthIssues`、盘点 `bg/Ng`、审批流默认不感知新 key，需要哪个能力再单独接入；种子可加进 `window.__SEED__`（仅首启生效）。

## 10. 行为细节备忘（重建易漏点）

- id 生成 `ft(前缀)`：`前缀 + Date.now().toString(36) + 随机4位`；前缀约定 st/area/as/mv/iv/ap/cl/user/role/tg。
- 单号格式：盘点 `PD-YYYYMM-NNN`（`md`，无 docNo 时由 id 哈希兜底）、审批 `SP-YYYYMMDD-NNN`、签收 `YH-QS-{code}-{yyyymmdd}`。
- 时间：`Oe()`=ISO 日期、`Ye()`=zh-CN 本地时间串（记录均存字符串，无时区处理）。
- 折旧：直线法，`净值 = max(price - price*(1-残值率)*min(已用年/年限,1), price*残值率)`；年限优先级 资产.usefulLife > depreCfg.life[分类] > 默认表；残值率同理默认 5%。
- 备份提醒：非文件模式且有资产且距上次备份 ≥14 天，登录后 1.8s toast 提醒（7s）。
- 审批执行：通过时才改资产（retire→status=retired；assign/transfer→改 holder/siteId+status=in_use）并写 movement `审批单 {no} 通过`；资产已报废/不存在时强制走驳回。
- 盘点：mode=snapshot 在创建时固化资产快照（snap），live 模式实时取台账；区域盘点对象是 otherAssets、部门盘点排除 retired。
- 多窗口：storage 事件触发 `ke` 重载 + toast「已同步其他窗口的改动」；数据文件写入防抖 800ms。
- 密码：`Ko` 为 imul 双 hash（非加密强度）；重置密码后 mustChange=true，登录页强制改密。
- 修改日志只覆盖资产的创建/编辑（`logCL`），流转/审批/盘点动作走 movement type:"log"（`Pe`/`Al`）。

## 11. 重建工作量评估

| 模块 | 量级 | 说明 |
|---|---|---|
| 存储层+字典+权限基建（10-store 切片） | 大 | 数据文件模式/迁移/备份/折旧/字典多，逻辑密度最高，是其他一切的地基 |
| App 壳 `hd`（导航/权限/审批执行/多窗口同步） | 大 | 约 1000 行，全局装配点，审批执行逻辑内嵌 |
| 电脑台账 `xg` + 表单 `gg` + 详情 `hm` | 大 | 导入导出/批量六操作/列设置/附件，交互最密集 |
| 资产地图 `AssetMap` | 大 | 约 1550 行，三级位置建模+拖拽布局+SVG 导出，独立性强可后置 |
| 盘点 `Sg/bg/Ng` | 中大 | 两种盘点类型+快照/实时两模式+核对流+打印 |
| 设置管理 `Fg` + 打印 `xm/Pg` | 中大 | 功能杂但每块模式统一 |
| 审批 `vg/yg/Lg` | 中 | UI 三件套，执行逻辑复用 hd |
| 数据健康+备份对比（96 切片） | 中 | 规则集清晰、纯函数为主，好测 |
| 归档 `wg`、其他资产 `Cg/Ig`、流转 `mg`、修改日志 `Clg` | 中 | 同一"筛选+表格+分页+导出"模式复制 |
| 基础 UI（15 切片）、登录 `pg`、`LifeDash`、首页 `hg`、处置/标记弹窗族 | 小 | 单文件独立、模式简单 |

建议重建顺序：10-store → 15-ui → hd 壳(先只挂 2-3 页) → xg/gg/hm → 盘点 → 审批 → 其余页面 → 地图/健康/备份对比。
