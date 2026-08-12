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
  assert.match(dockerfile, /FROM node:22/);
  assert.match(dockerfile, /HEALTHCHECK/);
  assert.match(dockerfile, /register-loader\.mjs/);
  assert.match(compose, /127\.0\.0\.1:3000:3000/);
  assert.match(compose, /yonghong-data:\/data/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(envExample, /BOOTSTRAP_ADMIN_USERNAME/);
  assert.match(doc, /TencentOS Server 4/);
  assert.match(doc, /APP_SESSION_ALLOW_INSECURE/);
});
