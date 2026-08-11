# 部署到 Cloudflare（免费试用站点）

本项目原生目标就是 Cloudflare Workers + D1 + R2（原先托管的 Sites 平台即基于此），因此这是**最快、免费**的可访问试用部署路径。免费额度（Workers 10 万请求/日、D1 500 万行读/日、R2 10GB）对演示和试点绰绰有余。

## 一、你需要做的（约 5 分钟）

1. 注册/登录 [dash.cloudflare.com](https://dash.cloudflare.com)（免费计划即可）。
2. 右上角头像 → **My Profile → API Tokens → Create Token**，选 **Edit Cloudflare Workers** 模板，并在权限里追加：
   - Account · **D1** · Edit
   - Account · **Workers R2 Storage** · Edit
3. 复制生成的 Token；账户 ID 在任意域名/Workers 概览页右侧（Account ID）。

把这两个值交给执行部署的人（或 CI）即可，Token 可随时在面板吊销。

## 二、一键部署

```bash
export CLOUDFLARE_API_TOKEN=...        # 上面创建的 Token
export CLOUDFLARE_ACCOUNT_ID=...       # 账户 ID（Token 仅属一个账号时可省略）

# 冷启动首个平台管理员（强烈建议首次部署时设置）
export BOOTSTRAP_ADMIN_EMAIL=admin@example.com
export BOOTSTRAP_ADMIN_USERNAME=yh.admin
export BOOTSTRAP_ADMIN_PASSWORD='一个强密码A1'
export MFA_TOTP_ENCRYPTION_KEY=$(openssl rand -hex 32)

bash scripts/deploy-cloudflare.sh
```

脚本会自动完成：构建 → 创建/复用 D1 与 R2 → 应用全部数据库迁移（带追踪、可重复执行）→ 部署 Worker，输出一个 `https://<worker>.workers.dev` 访问地址。

## 三、部署后首次使用

1. 打开站点，用 `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` 登录（系统强制修改初始密码）。
2. 「医院与权限」中为团队成员分配医院、角色和登录账号。
3. 品牌区三连击 + 入口口令进入数据准备中心，用「一键载入示范数据并正式发布」让正式模式立即有数据（或上传真实 Excel 走完整流程）。

## 四、注意事项

- workers.dev 地址是公网可访问的；业务数据受登录与权限保护，演示模式仅含虚构数据。需要更强门禁可在面板开启 Cloudflare Access（免费 50 席）。
- `scripts/make-deploy-config.mjs` 生成的 `dist/server/wrangler.deploy.json` 在 `dist/`（已 gitignore），凭据不会进入仓库；长期运行建议把口令类变量改为 `wrangler secret put`。
- 重复执行部署脚本即为升级发布；数据库迁移通过 wrangler 的 `d1_migrations` 表追踪，不会重复应用。
- 正式医院试点仍应按《腾讯云迁移包》文档部署到院方认可的境内环境；本路径定位是**试用/演示站点**。
