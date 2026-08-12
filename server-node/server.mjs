import { createServer } from "node:http";
import { promises as fs, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { SqliteD1Database } from "./d1-sqlite.mjs";
import { DiskR2Bucket } from "./r2-disk.mjs";
import { applyMigrations } from "./migrate.mjs";

// 勇虹医疗设备效益管理平台 · 腾讯云/自托管 Node 服务壳。
// 直接运行 Cloudflare Worker 构建产物：D1→SQLite、R2→本地磁盘、
// 静态资源由本进程直出。必须通过 `node --import ./server-node/register-loader.mjs`
// 启动，以便把 "cloudflare:workers" 指向本地绑定。

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST_SERVER = path.join(ROOT, "dist", "server", "index.js");
const CLIENT_DIR = path.join(ROOT, "dist", "client");
const MIGRATIONS_DIR = path.join(ROOT, "drizzle");

const PORT = Number(process.env.PORT ?? 8911);
const HOST = process.env.HOST ?? "0.0.0.0";
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, "data"));
// 未启用 HTTPS 时把 __Host- 前缀会话 Cookie 翻译为普通 Cookie（浏览器要求
// __Host- 必须 Secure+HTTPS）。生产环境应经 nginx 提供 HTTPS 并保持此项关闭。
const ALLOW_INSECURE_COOKIE = process.env.APP_SESSION_ALLOW_INSECURE === "1";
const HOST_COOKIE = "__Host-yh_app_session";
const PLAIN_COOKIE = "yh_app_session";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

if (!existsSync(DIST_SERVER)) {
  console.error("未找到构建产物 dist/server/index.js；请先执行 npm run build。");
  process.exit(1);
}

mkdirSync(DATA_DIR, { recursive: true });
const database = new SqliteD1Database(path.join(DATA_DIR, "platform.sqlite"));
const { executed, total } = applyMigrations(database.database, MIGRATIONS_DIR);
console.log(`[migrate] 迁移共 ${total} 个，本次新应用 ${executed.length} 个${executed.length ? `：${executed.join(", ")}` : ""}`);

const passthroughEnvKeys = [
  "BOOTSTRAP_ADMIN_EMAIL",
  "BOOTSTRAP_ADMIN_USERNAME",
  "BOOTSTRAP_ADMIN_PASSWORD",
  "DATA_WORKBENCH_ENTRY_PASSWORD",
  "MFA_TOTP_ENCRYPTION_KEY",
];
const workerEnv = {
  DB: database,
  REPORT_FILES: new DiskR2Bucket(path.join(DATA_DIR, "r2")),
};
for (const key of passthroughEnvKeys) {
  if (process.env[key]) workerEnv[key] = process.env[key];
}
globalThis.__YH_WORKER_ENV__ = workerEnv;

const worker = (await import(DIST_SERVER)).default;
if (typeof worker?.fetch !== "function") {
  console.error("dist/server/index.js 未导出 fetch 处理器。");
  process.exit(1);
}

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

async function tryServeStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const decoded = decodeURIComponent(pathname);
  const candidate = path.normalize(path.join(CLIENT_DIR, decoded));
  if (!candidate.startsWith(CLIENT_DIR + path.sep) && candidate !== CLIENT_DIR) return false;
  let stat;
  try {
    stat = await fs.stat(candidate);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  const contentType = CONTENT_TYPES[path.extname(candidate).toLowerCase()] ?? "application/octet-stream";
  const immutable = decoded.startsWith("/assets/");
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": stat.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=300",
    "x-content-type-options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
  } else {
    const bytes = await fs.readFile(candidate);
    res.end(bytes);
  }
  return true;
}

function inboundHeaders(req) {
  const headers = new Headers();
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index];
    let value = req.rawHeaders[index + 1];
    if (ALLOW_INSECURE_COOKIE && name.toLowerCase() === "cookie") {
      value = value.replaceAll(`${PLAIN_COOKIE}=`, `${HOST_COOKIE}=`);
    }
    try {
      headers.append(name, value);
    } catch {
      // 忽略非法头，避免单个坏头拖垮请求。
    }
  }
  return headers;
}

function outboundSetCookie(value) {
  if (!ALLOW_INSECURE_COOKIE) return value;
  if (!value.startsWith(`${HOST_COOKIE}=`)) return value;
  return value
    .replace(`${HOST_COOKIE}=`, `${PLAIN_COOKIE}=`)
    .replace(/;\s*Secure/i, "");
}

// nginx 终结 TLS 后，到达本进程的仍是明文 HTTP：若按 http 构造请求 URL，
// 浏览器发来的 Origin: https://域名 会与之不符，同源校验直接 403 origin_mismatch，
// 表现为"配好 HTTPS 后反而登录不上"。因此需要采信反向代理的转发头。
// 只有当对端是回环/内网地址（即请求确实来自本机或院内网关的反向代理）时才采信，
// 公网直连伪造的 X-Forwarded-* 一律忽略。
const TRUSTED_PROXY_PEER = /^(?:127\.|::1$|::ffff:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|f[cd])/i;

function fromTrustedProxy(req) {
  const peer = req.socket?.remoteAddress ?? "";
  return TRUSTED_PROXY_PEER.test(peer);
}

function requestOriginBase(req) {
  const trusted = fromTrustedProxy(req);
  const forwardedProto = trusted ? String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() : "";
  const forwardedHost = trusted ? String(req.headers["x-forwarded-host"] ?? "").split(",")[0].trim() : "";
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : "http";
  const host = forwardedHost || req.headers.host || `127.0.0.1:${PORT}`;
  return `${protocol}://${host}`;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", requestOriginBase(req));

    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname.startsWith("/_vinext/image")) {
      // 平台使用原生 <img>，未启用图像优化服务。
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("image optimizer disabled");
      return;
    }
    if (await tryServeStatic(req, res, url.pathname)) return;

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(url, {
      method: req.method,
      headers: inboundHeaders(req),
      body: hasBody ? Readable.toWeb(req) : undefined,
      duplex: hasBody ? "half" : undefined,
      redirect: "manual",
    });
    const response = await worker.fetch(request, workerEnv, executionContext);

    const headers = {};
    const setCookies = [];
    response.headers.forEach((value, name) => {
      if (name.toLowerCase() === "set-cookie") return;
      headers[name] = value;
    });
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      setCookies.push(outboundSetCookie(cookie));
    }
    res.writeHead(response.status, { ...headers, ...(setCookies.length ? { "set-cookie": setCookies } : {}) });
    if (response.body) {
      Readable.fromWeb(response.body).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("[server] 请求处理失败：", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ error: "internal_server_error" }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`勇虹设备效益管理平台已启动：http://${HOST}:${PORT}`);
  console.log(`数据目录：${DATA_DIR}（SQLite + 报告/数据文件）`);
  if (ALLOW_INSECURE_COOKIE) {
    console.log("警告：APP_SESSION_ALLOW_INSECURE=1 已开启（仅限内网试用）；生产环境请经 nginx 启用 HTTPS 并关闭此项。");
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`收到 ${signal}，正在停止服务…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
