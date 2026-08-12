# 腾讯云部署方案（TencentOS Server 4 · x86_64 · Docker 统一打包）

本方案把平台打成**单个 Docker 镜像**：Node 22 服务壳直接运行现有构建产物，数据库用容器卷里的 SQLite（`/data/platform.sqlite`），报告与数据文件存 `/data/r2`。单机即可运行完整系统（登录、权限、数据准备中心、正式发布、报告导出全部可用），已在容器内完成登录→示范发布→重启持久化的全链路验证。

> 定位：试点/院内单机部署。后续如需 MySQL/COS/多副本，见文末"演进路径"。
>
> **中国大陆院内部署请直接看 [`部署手册-腾讯云-中国区.md`](./部署手册-腾讯云-中国区.md)**：
> 那份手册按"上传源码包即可运行"组织，含备案/安全组/国内镜像源/时区/证书等本地化事项，
> 并提供免 Docker 的 systemd 安装脚本。本文档保留 Docker 路线的细节说明。

## 一、服务器准备（TencentOS Server 4）

```bash
# 安装 Docker（TencentOS 4 兼容 el9 源）
dnf install -y dnf-utils
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

# 腾讯云 CVM 建议配置镜像加速（拉取基础镜像更快）
cat > /etc/docker/daemon.json <<'EOF'
{ "registry-mirrors": ["https://mirror.ccs.tencentyun.com"] }
EOF
systemctl restart docker
```

安全组/防火墙：仅放行 22（SSH）与 443（HTTPS，经 nginx）；**不要**把 8911 端口对公网开放（compose 已绑定 127.0.0.1）。

## 二、获取源码并构建

```bash
git clone <仓库地址> yonghong-platform && cd yonghong-platform
# 构建产物需要 Node >= 22.13（服务器上装一次即可，仅构建用）
dnf install -y nodejs22 || (curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - && dnf install -y nodejs)
npm ci && npm run build

# 打镜像
docker build -f Dockerfile.tencent -t yonghong-platform:latest .
```

也可以在任意一台可上网的机器构建后 `docker save yonghong-platform:latest | gzip > yonghong.tar.gz`，
再 `scp` 到服务器 `docker load < yonghong.tar.gz`（内网/离线场景）。仓库提供
`bash scripts/package-tencent-release.sh` 一键完成 构建→打镜像→导出 tar.gz。

## 三、配置并启动

```bash
cp .env.tencent.docker.example .env
vi .env      # 设置引导管理员账号/密码、入口口令、MFA 密钥
docker compose -f docker-compose.tencent.yml up -d
docker compose -f docker-compose.tencent.yml ps   # STATUS 应为 healthy
curl http://127.0.0.1:8911/healthz               # {"ok":true}
```

首次使用：
1. 浏览器打开站点，用 `.env` 里的引导管理员账号密码登录（系统强制修改初始密码）；
2. 「医院与权限」为团队成员分配医院、角色（可按左侧菜单勾选）与登录账号；
3. 品牌区 4 秒内连击 3 次 + 入口口令进入数据准备中心，可"一键载入示范数据并正式发布"，或直接上传医院真实 Excel 走 导入→映射→清洗→复核→发布。

## 四、HTTPS（正式使用必须）

平台会话 Cookie 使用 `__Host-` 安全前缀，**浏览器要求 HTTPS**。试用阶段可在 `.env` 里设
`APP_SESSION_ALLOW_INSECURE=1`（服务壳自动把会话 Cookie 降级为普通 Cookie，仅限内网 IP 直连）；
正式使用请配好 HTTPS 后**删除该行**并 `docker compose up -d` 重启。

```bash
dnf install -y nginx certbot python3-certbot-nginx
# 参考仓库 tencent-cloud/nginx.conf.example，将 server_name 指向你的域名，
# proxy_pass http://127.0.0.1:8911; 并保留 X-Forwarded-* 头
certbot --nginx -d your.domain.cn
```

## 五、日常运维

| 操作 | 命令 |
|---|---|
| 查看日志 | `docker compose -f docker-compose.tencent.yml logs -f --tail=200` |
| 升级发布 | `git pull && npm ci && npm run build && docker compose -f docker-compose.tencent.yml up -d --build` |
| 数据备份 | `docker exec yonghong-platform-platform-1 node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/platform.sqlite').exec(\"VACUUM INTO '/data/backup-'||strftime('%Y%m%d%H%M','now')||'.sqlite'\")"` 之后 `docker cp` 出容器；`/data/r2` 目录整体拷贝即可 |
| 恢复 | 停容器 → 用备份覆盖卷内 `platform.sqlite` 与 `r2/` → 启动 |
| 健康检查 | `curl http://127.0.0.1:8911/healthz`；compose 自带 HEALTHCHECK，异常自动重启（restart: unless-stopped） |

数据卷 `yonghong-data` 是唯一有状态资产，纳入服务器快照/备份策略即可。

## 六、环境变量一览

| 变量 | 说明 |
|---|---|
| `BOOTSTRAP_ADMIN_EMAIL` / `USERNAME` / `PASSWORD` | 冷启动引导首个平台管理员（首登强制改密） |
| `DATA_WORKBENCH_ENTRY_PASSWORD` | 数据准备中心隐藏入口口令（默认 yonghong） |
| `APP_SESSION_ALLOW_INSECURE` | 仅内网 HTTP 试用置 1；HTTPS 后删除 |
| `PORT` / `HOST` / `DATA_DIR` | 服务端口/监听地址/数据目录（默认 8911 / 0.0.0.0 / /data） |

## 七、演进路径（当前为试点形态）

- **SQLite → TencentDB MySQL**：需要把 drizzle 迁移转 MySQL 方言并替换驱动，适合多副本/高并发阶段；单院试点 SQLite（WAL 模式）足够。
- **磁盘 → COS**：`server-node/r2-disk.mjs` 是唯一对接点，替换为 COS SDK 适配器即可，接口只有 put/get/head/delete/list 五个方法。
- **横向扩容**：当前会话与数据都在单机；扩容前先完成 MySQL/COS 迁移。
- 等保/审计要求参照 `tencent-cloud/README.md` 与迁移包文档执行。
