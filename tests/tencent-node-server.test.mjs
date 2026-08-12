import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("腾讯云 Node 服务壳把 cloudflare:workers 指向本地绑定并翻译安全 Cookie", async () => {
  const [hooks, shim, server] = await Promise.all([
    readFile(new URL("../server-node/loader-hooks.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server-node/cloudflare-workers-shim.mjs", import.meta.url), "utf8"),
    readFile(new URL("../server-node/server.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(hooks, /cloudflare:workers/);
  assert.match(shim, /__YH_WORKER_ENV__/);
  assert.match(server, /SqliteD1Database/);
  assert.match(server, /DiskR2Bucket/);
  assert.match(server, /applyMigrations/);
  assert.match(server, /__Host-yh_app_session/);
  assert.match(server, /APP_SESSION_ALLOW_INSECURE/);
  assert.match(server, /\/healthz/);
  // 静态目录防路径穿越
  assert.match(server, /startsWith\(CLIENT_DIR/);
});

test("D1 SQLite 适配实现平台使用的完整接口并开启 WAL 与外键", async () => {
  const adapter = await readFile(new URL("../server-node/d1-sqlite.mjs", import.meta.url), "utf8");
  for (const member of ["prepare", "bind", "all", "raw", "first", "run", "batch", "exec"]) {
    assert.match(adapter, new RegExp(`${member}\\(`), `D1 接口 ${member} 存在`);
  }
  assert.match(adapter, /journal_mode = WAL/);
  assert.match(adapter, /foreign_keys = ON/);
});

test("磁盘 R2 适配覆盖 put/get/head/delete/list 且对象键哈希分桶", async () => {
  const bucket = await readFile(new URL("../server-node/r2-disk.mjs", import.meta.url), "utf8");
  for (const member of ["async put", "async get", "async head", "async delete", "async list"]) {
    assert.match(bucket, new RegExp(member));
  }
  assert.match(bucket, /sha256/);
  assert.match(bucket, /customMetadata/);
});

test("Docker 交付物齐备且编排不暴露公网端口", async () => {
  const [dockerfile, compose, envExample, doc] = await Promise.all([
    readFile(new URL("../Dockerfile.tencent", import.meta.url), "utf8"),
    readFile(new URL("../docker-compose.tencent.yml", import.meta.url), "utf8"),
    readFile(new URL("../.env.tencent.docker.example", import.meta.url), "utf8"),
    readFile(new URL("../docs/DEPLOY-TENCENT-DOCKER.md", import.meta.url), "utf8"),
  ]);
  assert.match(dockerfile, /ARG BASE_IMAGE=node:22/);
  assert.match(dockerfile, /FROM \$\{BASE_IMAGE\}/);
  // 中国大陆：容器默认 UTC 会让"今天/本月"在 0—8 点整体错一天
  assert.match(dockerfile, /TZ=Asia\/Shanghai/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /register-loader\.mjs/);
  assert.match(compose, /127\.0\.0\.1:8911:8911/);
  assert.match(compose, /yonghong-data:\/data/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /TZ: "\$\{TZ:-Asia\/Shanghai\}"/);
  assert.match(envExample, /TZ=Asia\/Shanghai/);
  assert.match(envExample, /BOOTSTRAP_ADMIN_USERNAME/);
  assert.match(doc, /TencentOS Server 4/);
  assert.match(doc, /APP_SESSION_ALLOW_INSECURE/);
});

test("服务壳在 nginx 终结 HTTPS 时按转发头构造来源，且只采信内网对端", async () => {
  const server = await readFile(new URL("../server-node/server.mjs", import.meta.url), "utf8");
  // 不采信转发头会让 Origin(https) 与请求 URL(http) 不符，配好 HTTPS 后反而登录不上。
  assert.match(server, /x-forwarded-proto/);
  assert.match(server, /x-forwarded-host/);
  assert.match(server, /function requestOriginBase/);
  assert.match(server, /new URL\(req\.url \?\? "\/", requestOriginBase\(req\)\)/);
  // 公网直连伪造的 X-Forwarded-* 必须忽略：只认回环/内网对端。
  assert.match(server, /TRUSTED_PROXY_PEER/);
  assert.match(server, /req\.socket\?\.remoteAddress/);
  assert.doesNotMatch(server, /new URL\(req\.url \?\? "\/", `http:\/\/\$\{req\.headers\.host/);
});

test("中国区部署交付物齐备：国内镜像源、nginx、systemd 与源码打包脚本", async () => {
  const [npmrc, nginx, unit, unitEnv, packer] = await Promise.all([
    readFile(new URL("../.npmrc.china.example", import.meta.url), "utf8"),
    readFile(new URL("../tencent-cloud/nginx.conf.example", import.meta.url), "utf8"),
    readFile(new URL("../deploy/yonghong-platform.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/yonghong-platform.env.example", import.meta.url), "utf8"),
    readFile(new URL("../scripts/package-source-release.sh", import.meta.url), "utf8"),
  ]);
  assert.match(npmrc, /registry\.npmmirror\.com/);
  // 反代必须透传协议头，否则平台判定不了 HTTPS
  assert.match(nginx, /X-Forwarded-Proto \$scheme/);
  // 医院 Excel 导入需要放开上传体积
  assert.match(nginx, /client_max_body_size/);
  assert.match(nginx, /ICP 备案/);
  assert.match(unit, /TZ=Asia\/Shanghai/);
  assert.match(unit, /register-loader\.mjs/);
  assert.match(unitEnv, /BOOTSTRAP_ADMIN_USERNAME/);
  // 源码包必须自带构建产物：院内服务器可能完全没有外网
  assert.match(packer, /dist/);
  assert.match(packer, /server-node/);
  assert.match(packer, /drizzle/);
});

test("单机试用路径：默认 IP 直连可用，--behind-nginx 才收回本机", async () => {
  const [installer, reset, quickstart] = await Promise.all([
    readFile(new URL("../deploy/install-tencentos.sh", import.meta.url), "utf8"),
    readFile(new URL("../deploy/reset-data.sh", import.meta.url), "utf8"),
    readFile(new URL("../docs/单机试用-快速开始.md", import.meta.url), "utf8"),
  ]);
  // 默认试用模式：监听所有网卡，浏览器用 IP:端口 直接访问，不需要域名和证书
  assert.match(installer, /MODE=trial/);
  assert.match(installer, /HOST=0\.0\.0\.0/);
  assert.match(installer, /--behind-nginx/);
  // 正式模式必须收回到本机并去掉不安全 Cookie 开关
  assert.match(installer, /HOST=127\.0\.0\.1/);
  assert.match(installer, /\/APP_SESSION_ALLOW_INSECURE\/d/);
  // unit 里的 node 路径按实际安装位置改写，不写死 /usr/bin/node
  assert.match(installer, /ExecStart=\$\{NODE_BIN\}/);
  // 安全组提示要给到，否则用户只会看到"打不开"
  assert.match(installer, /安全组/);
  // 反复试功能要能一键清空
  assert.match(reset, /platform\.sqlite/);
  assert.match(reset, /systemctl stop/);
  assert.match(reset, /read -r answer/);
  assert.match(quickstart, /http:\/\/49\.234\.179\.153:8911/);
  assert.match(quickstart, /scp .*root@49\.234\.179\.153/);
  // 单一目录树：删 /opt/yonghong 即卸载干净
  assert.match(quickstart, /\/opt\/yonghong\/src/);
  assert.match(installer, /ROOT=\/opt\/yonghong/);
  assert.match(installer, /PORT:-8911/);
  assert.match(quickstart, /reset-data\.sh/);
});
