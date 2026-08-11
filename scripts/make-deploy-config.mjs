#!/usr/bin/env node
/**
 * 基于构建产物 dist/server/wrangler.json 生成独立部署配置 wrangler.deploy.json。
 * 用法：node scripts/make-deploy-config.mjs <workerName> <d1Name> <d1DatabaseId> <r2BucketName>
 * 环境变量（可选，注入为 Worker vars；生产环境建议改用 wrangler secret put）：
 *   BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD
 *   DATA_WORKBENCH_ENTRY_PASSWORD / MFA_TOTP_ENCRYPTION_KEY
 */
import { readFileSync, writeFileSync } from "node:fs";

const [workerName, d1Name, d1DatabaseId, r2BucketName] = process.argv.slice(2);
if (!workerName || !d1Name || !d1DatabaseId || !r2BucketName) {
  console.error("用法：node scripts/make-deploy-config.mjs <workerName> <d1Name> <d1DatabaseId> <r2BucketName>");
  process.exit(1);
}

const basePath = new URL("../dist/server/wrangler.json", import.meta.url);
const config = JSON.parse(readFileSync(basePath, "utf8"));

config.name = workerName;
config.topLevelName = workerName;
config.d1_databases = [{
  binding: "DB",
  database_name: d1Name,
  database_id: d1DatabaseId,
  // 相对生成的配置文件（dist/server/）定位仓库根的 drizzle 迁移目录。
  migrations_dir: "../../drizzle",
}];
config.r2_buckets = [{ binding: "REPORT_FILES", bucket_name: r2BucketName }];
config.assets = { directory: "../client", binding: "ASSETS" };

const vars = { ...(config.vars ?? {}) };
for (const key of [
  "BOOTSTRAP_ADMIN_EMAIL",
  "BOOTSTRAP_ADMIN_USERNAME",
  "BOOTSTRAP_ADMIN_PASSWORD",
  "DATA_WORKBENCH_ENTRY_PASSWORD",
  "MFA_TOTP_ENCRYPTION_KEY",
]) {
  const value = process.env[key];
  if (value) vars[key] = value;
}
config.vars = vars;

const outPath = new URL("../dist/server/wrangler.deploy.json", import.meta.url);
writeFileSync(outPath, JSON.stringify(config, null, 2));
console.log(`已生成 ${outPath.pathname}`);
console.log(`Worker: ${workerName} · D1: ${d1Name} (${d1DatabaseId}) · R2: ${r2BucketName}`);
console.log(`注入 vars: ${Object.keys(vars).join(", ") || "无"}`);
