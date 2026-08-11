import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  derivePasswordHash,
  normalizeUsername,
  validatePasswordStrength,
  validateUsername,
} from "../db/password-auth.ts";
import { menuCatalog, menuVisibleForPermissions, togglePermissionsForMenu } from "../app/menu-catalog.ts";

test("username and password policies reject weak or malformed input", () => {
  assert.deepEqual(validateUsername("zhang.san"), []);
  assert.deepEqual(validateUsername("YH-Admin"), []);
  assert.ok(validateUsername("1abc").length, "must start with a letter");
  assert.ok(validateUsername("ab").length, "too short");
  assert.ok(validateUsername("含中文").length, "non-ascii rejected");
  assert.equal(normalizeUsername("  YH.Admin "), "yh.admin");

  assert.deepEqual(validatePasswordStrength("yh2026abc"), []);
  assert.ok(validatePasswordStrength("short1").length, "too short");
  assert.ok(validatePasswordStrength("onlyletters").length, "needs a digit");
  assert.ok(validatePasswordStrength("12345678").length, "needs a letter");
  assert.ok(validatePasswordStrength("with space1a").length, "no whitespace");
});

test("password hashing is deterministic per salt and differs across salts", async () => {
  const first = await derivePasswordHash("yh2026abc", "00112233445566778899aabbccddeeff", 1000);
  const again = await derivePasswordHash("yh2026abc", "00112233445566778899aabbccddeeff", 1000);
  const otherSalt = await derivePasswordHash("yh2026abc", "ffeeddccbbaa99887766554433221100", 1000);
  const otherPassword = await derivePasswordHash("yh2026abd", "00112233445566778899aabbccddeeff", 1000);
  assert.equal(first, again);
  assert.notEqual(first, otherSalt);
  assert.notEqual(first, otherPassword);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test("menu catalog toggling grants and revokes permissions without breaking shared menus", () => {
  const grantable = new Set(menuCatalog.flatMap((menu) => [...menu.permissions]));
  const cockpit = menuCatalog.find((menu) => menu.id === "cockpit");
  const analysis = menuCatalog.find((menu) => menu.id === "analysis");
  const workbench = menuCatalog.find((menu) => menu.id === "workbench");
  assert.ok(cockpit && analysis && workbench);

  let permissions = togglePermissionsForMenu([], cockpit, true, grantable);
  assert.deepEqual(permissions, ["dashboard.view"]);
  permissions = togglePermissionsForMenu(permissions, analysis, true, grantable);
  assert.ok(permissions.includes("source.manage"));

  // 取消“采集与分析”不应移除“效益驾驶舱”仍需要的 dashboard.view。
  permissions = togglePermissionsForMenu(permissions, analysis, false, grantable);
  assert.ok(permissions.includes("dashboard.view"));
  assert.ok(menuVisibleForPermissions(cockpit, new Set(permissions)));

  permissions = togglePermissionsForMenu(permissions, workbench, true, grantable);
  for (const code of ["connector.manage", "data.ingest", "data.clean", "data.review", "data.publish"]) {
    assert.ok(permissions.includes(code), `workbench grants ${code}`);
  }
  permissions = togglePermissionsForMenu(permissions, workbench, false, grantable);
  assert.ok(!permissions.includes("data.publish"));

  // 无权授予的权限不能通过勾选获得。
  const limited = togglePermissionsForMenu([], workbench, true, new Set(["data.ingest"]));
  assert.deepEqual(limited, ["data.ingest"]);
});

test("schema and migration cover self-hosted credential storage", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0011_password_accounts.sql", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /"account_credentials"/);
  assert.match(schema, /auth_method/);
  assert.match(migration, /CREATE TABLE `account_credentials`/);
  assert.match(migration, /account_credentials_username_unique/);
  assert.match(migration, /ALTER TABLE `app_sessions` ADD `auth_method`/);
});

test("app-session route exposes password login and change-password behind same-origin checks", async () => {
  const route = await readFile(new URL("../app/api/app-session/route.ts", import.meta.url), "utf8");
  assert.match(route, /password_login/);
  assert.match(route, /change_password/);
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /verifyPasswordLogin/);
  assert.match(route, /maybeBootstrapAdminCredential/);
  assert.match(route, /issueAppSession\(account, account\.email, request, "password"\)/);
  assert.match(route, /mfa_required/);
});

test("password sessions bypass the SSO header dependency in session inspection", async () => {
  const security = await readFile(new URL("../db/account-security.ts", import.meta.url), "utf8");
  assert.match(security, /authMethod === "password"/);
  assert.match(security, /settleSessionLifecycle/);
  const identity = await readFile(new URL("../app/server-identity.ts", import.meta.url), "utf8");
  assert.match(identity, /inspectAppSession/);
  assert.match(identity, /getChatGPTUser/);
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /resolveViewerIdentity/);
});

test("tenant context supports admin credential assignment with escalation guard", async () => {
  const route = await readFile(new URL("../app/api/tenant-context/route.ts", import.meta.url), "utf8");
  assert.match(route, /set_member_credential/);
  assert.match(route, /upsertAccountCredential/);
  assert.match(route, /role_escalation_denied/);
  assert.match(route, /accountCredentials/);
});

test("login screen and access console expose the password account surfaces", async () => {
  const [login, access] = await Promise.all([
    readFile(new URL("../app/LoginScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AccessControlCenter.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(login, /onPasswordLogin/);
  assert.match(login, /登录账号/);
  assert.match(login, /unlockWithPassword/);
  assert.match(access, /set_member_credential/);
  assert.match(access, /menuCatalog/);
  assert.match(access, /togglePermissionsForMenu/);
  assert.match(access, /左侧菜单可见性/);
});
