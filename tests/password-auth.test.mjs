import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  credentialLockActive,
  derivePasswordHash,
  nextCredentialFailureState,
  normalizeUsername,
  PASSWORD_LOCK_MS,
  PASSWORD_LOCK_THRESHOLD,
  validatePasswordStrength,
  validateUsername,
} from "../db/password-auth.ts";
import { canHideMenu, menuCatalog, menuVisibleForPermissions, togglePermissionsForMenu } from "../app/menu-catalog.ts";

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

  // 取消“效益分析”不应移除“效益驾驶舱”仍需要的 dashboard.view。
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

test("canHideMenu flags dead checkboxes when a menu's permissions are shared", () => {
  const grantable = new Set(menuCatalog.flatMap((menu) => [...menu.permissions]));
  const cockpit = menuCatalog.find((menu) => menu.id === "cockpit");
  const analysis = menuCatalog.find((menu) => menu.id === "analysis");
  const workbench = menuCatalog.find((menu) => menu.id === "workbench");
  assert.ok(cockpit && analysis && workbench);

  // 未勾选的菜单本就不可见，无需隐藏。
  assert.equal(canHideMenu("cockpit", []), true);

  // 独占权限的菜单，取消勾选确实能让它隐藏。
  const workbenchOnly = togglePermissionsForMenu([], workbench, true, grantable);
  assert.equal(canHideMenu("workbench", workbenchOnly), true);

  // 效益驾驶舱与效益分析共享 dashboard.view：取消驾驶舱无法使其隐藏 → 受共享约束的死复选框。
  let shared = togglePermissionsForMenu([], cockpit, true, grantable);
  shared = togglePermissionsForMenu(shared, analysis, true, grantable);
  assert.equal(canHideMenu("cockpit", shared), false);

  // 未知菜单按可隐藏处理，避免阻断交互。
  assert.equal(canHideMenu("does-not-exist", shared), true);
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
  // 二次验证已下线：密码登录成功后直接建立会话，不再有第二道验证分支
  assert.doesNotMatch(route, /mfa_required|totpCode|recoveryCode/);
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

test("credential failure lockout counts up, locks at the threshold and resets the counter", () => {
  const now = Date.parse("2026-08-12T00:00:00.000Z");

  // 阈值之前只累加失败次数，不锁定。
  for (let attempt = 1; attempt < PASSWORD_LOCK_THRESHOLD; attempt += 1) {
    const state = nextCredentialFailureState(attempt - 1, now);
    assert.equal(state.failedAttempts, attempt, `第 ${attempt} 次失败应累加计数`);
    assert.equal(state.lockedUntil, null, `第 ${attempt} 次失败不应锁定`);
    assert.equal(credentialLockActive(state.lockedUntil, now), false);
  }

  // 达到阈值时锁定 PASSWORD_LOCK_MS，并把计数清零，锁定期内判定为激活。
  const locked = nextCredentialFailureState(PASSWORD_LOCK_THRESHOLD - 1, now);
  assert.equal(locked.failedAttempts, 0);
  assert.equal(locked.lockedUntil, new Date(now + PASSWORD_LOCK_MS).toISOString());
  assert.equal(credentialLockActive(locked.lockedUntil, now), true);
  assert.equal(credentialLockActive(locked.lockedUntil, now + PASSWORD_LOCK_MS - 1), true);

  // 锁定到期后不再判定为激活；null 永远视为未锁定。
  assert.equal(credentialLockActive(locked.lockedUntil, now + PASSWORD_LOCK_MS), false);
  assert.equal(credentialLockActive(locked.lockedUntil, now + PASSWORD_LOCK_MS + 1), false);
  assert.equal(credentialLockActive(null, now), false);
});

test("change-password reuses the shared login lockout so session holders cannot brute force", async () => {
  const source = await readFile(new URL("../db/password-auth.ts", import.meta.url), "utf8");
  const changeStart = source.indexOf("export async function changeAccountPassword");
  const changeBody = source.slice(changeStart, source.indexOf("export async function", changeStart + 1));
  assert.ok(changeStart >= 0, "changeAccountPassword must exist");
  // 改密路径复用共用锁定判定并在失败时累加/锁定，而不再是裸抛 invalid_credentials。
  assert.match(changeBody, /credentialLockActive\(credential\.lockedUntil, now\)/);
  assert.match(changeBody, /nextCredentialFailureState\(credential\.failedAttempts, now\)/);
  assert.match(changeBody, /new PasswordAuthError\("credential_locked", 423, lock\.lockedUntil\)/);
});

test("password login writes a denied security audit on failure and workbench entry is rate limited", async () => {
  const [appSessionRoute, entryRoute] = await Promise.all([
    readFile(new URL("../app/api/app-session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workbench-entry/route.ts", import.meta.url), "utf8"),
  ]);

  // 问题 20：密码登录失败/锁定也要写 denied 审计（脱敏用户名）。
  const passwordLoginStart = appSessionRoute.indexOf("async function passwordLogin");
  const passwordLoginBody = appSessionRoute.slice(passwordLoginStart, appSessionRoute.indexOf("async function", passwordLoginStart + 1));
  assert.ok(passwordLoginStart >= 0, "passwordLogin must exist");
  assert.match(passwordLoginBody, /writeSecurityAudit\(""?, "password_login", "denied"/);
  assert.match(appSessionRoute, /function maskUsername/);

  // 问题 24：口令入口端点带进程内限速，超限返回 429 rate_limited。
  assert.match(entryRoute, /status: 429/);
  assert.match(entryRoute, /"rate_limited"/);
  assert.match(entryRoute, /cf-connecting-ip/);
  assert.match(entryRoute, /RATE_LIMIT_MAX_FAILURES/);
});
