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
import * as menuCatalogModule from "../app/menu-catalog.ts";
import { menuCatalog, menuVisibleForPermissions } from "../app/menu-catalog.ts";

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

/**
 * 这一组原来测的是 togglePermissionsForMenu / canHideMenu：角色弹窗里「勾菜单」和「勾权限」
 * 两套复选框互相驱动，于是必须保证勾一个菜单会连带授予权限、取消时又不能误删还被别的菜单
 * 需要的权限，还得靠 canHideMenu 把「共享权限导致取消不掉」的死复选框标出来。
 *
 * 现在菜单侧的复选框整个删掉了，可勾的只剩权限一处，菜单是算出来的只读结果。上面那些真问题
 * 没有消失，只是换了形式——它们全都归结成一句话：**左侧菜单可见性必须是权限集合的纯函数**。
 * 下面按这个新契约重写，守的还是同一批退化。
 */
const visibleMenuIds = (codes) =>
  menuCatalog.filter((menu) => menuVisibleForPermissions(menu, new Set(codes))).map((menu) => menu.id);

test("左侧菜单可见性是权限集合的纯函数，不存在第二处菜单状态", () => {
  // 一条权限都没勾 → 左侧一个菜单都不该有。防的是「菜单自己有默认开关、和权限无关地冒出来」。
  assert.deepEqual(visibleMenuIds([]), []);

  // 只勾 dashboard.view，效益驾驶舱和效益分析同时亮：这正是老 canHideMenu 描述的共享现象。
  // 过去它被做成弹窗里一个勾了也取消不掉的死复选框，现在它只是权限算出来的连带结果，
  // 断言在这里钉死：共享权限的连带可见性必须真实发生，而不是被某处「菜单开关」盖掉。
  assert.deepEqual(visibleMenuIds(["dashboard.view"]), ["cockpit", "analysis"]);

  // 同一权限集合算多次、换传入顺序算，结果必须完全一致。
  // 防的是有人把可见性算法改回「依赖上一次勾选状态」的有状态实现。
  assert.deepEqual(visibleMenuIds(["dashboard.view"]), visibleMenuIds(["dashboard.view"]));
  assert.deepEqual(visibleMenuIds(["source.manage", "dashboard.view"]), visibleMenuIds(["dashboard.view", "source.manage"]));

  // 撤掉 source.manage 只关掉「指标字典」，仍由 dashboard.view 撑着的驾驶舱/效益分析不受牵连。
  // 这是老实现最容易出错的地方（反推权限时把共享权限一起删了），换成纯函数后必须自然成立。
  assert.deepEqual(visibleMenuIds(["dashboard.view", "source.manage"]), ["cockpit", "analysis", "sources"]);
  assert.deepEqual(visibleMenuIds(["dashboard.view"]), ["cockpit", "analysis"]);

  // 数据准备中心是「任一 data.* 即可见」：四条职责分离的权限各自单独给也要能进得去，
  // 否则数据导入岗拿到 data.ingest 却看不到入口。
  for (const code of ["data.ingest", "data.clean", "data.review", "data.publish"]) {
    assert.deepEqual(visibleMenuIds([code]), ["workbench"], `${code} 单独授予时应能看到数据准备中心`);
  }

  // 不认识的权限编码不能凭空点亮任何菜单（打错字的自定义角色不该意外获得入口）。
  assert.deepEqual(visibleMenuIds(["not.a.real.permission"]), []);
});

test("菜单目录只导出可见性计算，勾菜单反推权限的那套已连根删除", () => {
  // togglePermissionsForMenu / canHideMenu 只为「菜单复选框」而存在。留着它们等于给
  // 第二套真相来源留了接口，早晚有人再把菜单复选框接回去。
  for (const removed of ["togglePermissionsForMenu", "canHideMenu"]) {
    assert.ok(!Object.keys(menuCatalogModule).includes(removed), `${removed} 应随菜单复选框一并删除，不留可复活的接口`);
  }
  assert.ok(Object.keys(menuCatalogModule).includes("menuCatalog"));
  assert.ok(Object.keys(menuCatalogModule).includes("menuVisibleForPermissions"));
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

  // 角色配置弹窗只保留「功能权限」一处复选框，菜单由权限实时算出来只读展示。
  // 防的是回到「勾菜单」和「勾权限」两套复选框互相驱动：一套控件两个真相来源，
  // 用户先撞上的是自己点不动的死复选框（共享权限的菜单取消勾选也隐藏不掉）。
  assert.match(access, /menuCatalog/);
  assert.match(access, /menuVisibleForPermissions/);
  assert.doesNotMatch(access, /togglePermissionsForMenu|canHideMenu/, "菜单复选框已删除，不应再引用勾菜单反推权限的函数");
  assert.equal((access.match(/type="checkbox"/g) ?? []).length, 1, "整个医院与权限控制台只应剩下「功能权限」这一处复选框");
  // 只读结果区必须还在：否则勾权限的人看不到自己给出去的是哪些左侧入口。
  assert.match(access, /勾选结果/);
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
