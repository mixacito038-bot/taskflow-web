# 项目长期约定（Claude 每次会话开始时会读这个文件）

用户是上海市浦东新区周浦医院设备科的杨潇，非技术人员，用中文沟通。

## 急救设备巡检系统（medops）线上环境

- 服务器：腾讯云，公网 IP **49.234.179.153**，root 登录（SSH 22 端口）
- 代码目录：`/opt/medops`（内容 = 仓库里的 `medops/` 目录）
- 数据目录：`/opt/medops-data`（SQLite 数据库、签名图、每日 02:30 自动备份），升级不动它
- 运维入口：`/opt/medops/deploy/tencent/manage.sh`（状态 / 日志 / 备份 / 恢复 / 升级 / 体检 / 重置管理员 / 改端口）
- 对外地址：`https://xunjian.youhukang.com`（443 端口；`/xunjian/` 手机端、`/admin/` 管理后台、`/pandian/` 资产盘点）
- 同一台机器还跑着别人的服务（8910/8911、flowdesk 等）：只动 medops 项目自己的容器，不要做影响全机的操作

## 发布更新的固定做法（用户明确要求）

用户只想「电脑上一条 scp 上传 + 服务器上执行一条命令」，不要再让他逐条执行 unzip / cp / docker 等命令。

1. 改动全部提交后，在会话里生成一键升级包：
   `bash medops/deploy/release/build-release.sh <输出目录>`
   得到一个自带代码的 `medops-upgrade-<版本>.sh`，用 SendUserFile 发给用户。
   默认只带程序（后端、手机端、管理后台、manage.sh），不带 nginx 配置、docker-compose、资产盘点；
   确实要一起更新时把相对 `medops/` 的路径加在命令后面。
2. 回复里只给两步：
   - 电脑上上传（文件下载后在「下载」文件夹）：
     - Windows（PowerShell）：`scp "$HOME\Downloads\medops-upgrade-<版本>.sh" root@49.234.179.153:/root/`
     - Mac（终端）：`scp ~/Downloads/medops-upgrade-<版本>.sh root@49.234.179.153:/root/`
   - 服务器上执行一次：`bash /root/medops-upgrade-<版本>.sh`
3. 升级包自动完成：检查环境与包完整性 → 备份数据 → 备份旧代码 → 覆盖新代码 → 重建启动 →
   健康检查（不通过自动回退）→ 签字数据体检 → 打印总结（含数据备份下载命令、一键回退命令）。
4. 发布前先在会话里跑完测试：`medops/server` 下 `npm test`、`node scripts/smoke.js`、`node scripts/regress.js`。

## 开发约定

- 开发分支：`claude/emergency-equipment-inspection-deploy-mtxetj`（除非用户另行指定）
- 业务规则以 `medops/docs/api-contract.md` 为准：可以补签过去、不能提前签；周签要 7 天日签齐；
  月签要该月（周一在本月的）全部周签齐；签字即锁定；作废自上而下。
- 管理后台改了源码要重新构建并提交 `medops/admin/dist`（服务器直接用构建产物，不在服务器上构建前端）。
