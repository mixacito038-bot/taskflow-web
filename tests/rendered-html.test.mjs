import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

function assertAppSessionProtected(source, routeName) {
  assert.match(source, /\brequireAppSession\b/, `${routeName} must require an application session`);
  assert.match(source, /await requireAppSession\(request\)/, `${routeName} must validate the current request session`);
  assert.match(source, /\bappSessionError\b/, `${routeName} must return the shared application-session error contract`);
  assert.doesNotMatch(source, /\bgetChatGPTUser\b/, `${routeName} must not authorize business access from SSO identity alone`);
  assert.doesNotMatch(source, /from ["'][^"']*chatgpt-auth["']/, `${routeName} must not import the SSO gateway directly`);
}

function assertSameOriginProtected(source, routeName) {
  assert.match(source, /\bassertSameOrigin\b/, `${routeName} must import the shared same-origin guard`);
  assert.match(source, /assertSameOrigin\(request\)/, `${routeName} must reject cross-origin state changes`);
}

async function render({ authenticated = true } = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: {
        accept: "text/html",
        ...(authenticated ? {
          "oai-authenticated-user-email": "admin@yonghong-medical.cn",
          "oai-authenticated-user-full-name": encodeURIComponent("设备管理员"),
          "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
        } : {}),
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders a default-deny boundary before hospital permissions resolve", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /勇虹医疗 · 设备效益管理平台/);
  assert.match(html, /正在检查系统会话/);
  assert.match(html, /应用会话确认完成前不会加载医院业务数据/);
  assert.match(html, /设备管理员/);
  const renderedBody = html.slice(html.indexOf("<body"), html.indexOf('<script id="_R_">'));
  assert.doesNotMatch(renderedBody, /设备台账|成本填报|医院与权限|消息中心|角色视角/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("offers a trusted sign-in flow to anonymous visitors", async () => {
  const response = await render({ authenticated: false });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /登录<!-- -->勇虹医疗 · 设备效益管理平台|登录勇虹医疗 · 设备效益管理平台/);
  assert.match(html, /登录账号|账号密码/);
  assert.match(html, /进入演示环境/);
  assert.doesNotMatch(html, /signin-with-chatgpt|统一身份/);
});

test("uses one release brand across the product, security issuer, metadata and operator docs", async () => {
  const releaseFiles = await Promise.all([
    "../app/brand.ts",
    "../app/layout.tsx",
    "../app/page.tsx",
    "../app/LoginScreen.tsx",
    "../app/AccountCenter.tsx",
    "../app/EquipmentPlatform.tsx",
    "../app/BenefitReportCenter.tsx",
    "../app/benefit-report-export.ts",
    "../db/account-security.ts",
    "../README.md",
    "../DEMO-RUNBOOK.md",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const releaseText = releaseFiles.join("\n");
  const retiredChineseBrand = new RegExp(["衡效", "智舱"].join(""));
  const retiredEnglishBrand = new RegExp(["Hengxiao", " Zhicang"].join(""), "i");

  assert.doesNotMatch(releaseText, retiredChineseBrand);
  assert.doesNotMatch(releaseText, retiredEnglishBrand);
  assert.match(releaseText, /勇虹医疗 · 设备效益管理平台/);
  assert.match(releaseText, /export const PRODUCT_FULL_NAME = `\$\{COMPANY_NAME\} · \$\{PRODUCT_NAME\}`/);
  assert.match(releaseText, /const MFA_ISSUER = PRODUCT_FULL_NAME/);
});

test("ships the configurable dashboard and editable admin surfaces", async () => {
  const [component, improvement, reportCenter, reportModel, reportCatalog, reportExport, reportGovernance, reportRoute, accessComponent, accessData, tenantRoute, schema, styles, data, insightViews, definitions, notificationCenter, accountCenter, loginScreen, notifications, page, layout, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ImprovementCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/BenefitReportCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/benefit-report-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/report-template-catalog.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/benefit-report-export.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/report-governance.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/benefit-reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/AccessControlCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/access-control-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tenant-context/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/mock-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/InsightViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/metric-definitions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/NotificationCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/LoginScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/notification-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(component, /function EquipmentManagement/);
  assert.match(component, /function CostManagement/);
  assert.match(component, /function LayoutConfiguration/);
  assert.match(component, /function DataSourceManagement/);
  assert.match(component, /addLabor/);
  assert.match(component, /addConsumable/);
  assert.match(component, /saveFixedCosts/);
  assert.match(component, /dropModule/);
  assert.match(component, /const demoMode = !viewer\.authenticated/);
  assert.match(component, /function useDemoState/);
  assert.match(component, /if \(!enabled\) return/);
  assert.match(component, /window\.localStorage/);
  assert.doesNotMatch(component, /function usePersistentState/);
  assert.match(component, /BenefitReportCenter/);
  assert.match(component, /BenefitAnalysisStudio/);
  assert.match(component, /采集与分析/);
  assert.match(component, /生成效益报告/);
  assert.match(component, /openDeviceDetail/);
  assert.match(component, /SingleEquipmentDetail/);
  assert.match(component, /MetricGovernanceCenter/);
  assert.match(component, /equip-benefit-content-zoom/);
  assert.match(component, /缩小页面/);
  assert.match(component, /放大页面/);
  assert.match(component, /ImprovementCenter/);
  assert.match(component, /AccessControlCenter/);
  assert.match(component, /NotificationCenter/);
  assert.match(component, /AccountCenter/);
  assert.match(component, /LoginScreen/);
  assert.match(component, /openNotificationTarget/);
  assert.match(component, /signout-with-chatgpt/);
  assert.match(component, /equip-benefit-devices-by-hospital-v1/);
  assert.match(component, /api\/tenant-context/);
  assert.match(component, /account_not_provisioned|sessionState === "denied"/);
  assert.match(component, /sessionState === "loading"/);
  assert.match(component, /report\.manage/);
  assert.match(component, /report\.review/);
  assert.match(component, /report\.approve/);

  assert.match(reportCenter, /报告预览/);
  assert.match(reportCenter, /模板库/);
  assert.match(reportCenter, /本次报告配置/);
  assert.match(reportCenter, /数据质检/);
  assert.match(reportCenter, /流程与版本/);
  assert.match(reportCenter, /字段与数据/);
  assert.match(reportCenter, /保存草稿/);
  assert.match(reportCenter, /提交复核/);
  assert.match(reportCenter, /正式签发/);
  assert.match(reportCenter, /保存医院方案/);
  assert.match(reportCenter, /设为本院默认/);
  assert.match(reportCenter, /配置数据映射/);
  assert.match(reportCenter, /usesFrozenReportSnapshot/);
  assert.match(reportCenter, /报告冻结快照缺失/);
  assert.match(reportCenter, /supportsPeriod/);
  assert.match(reportCenter, /受控补录责任人/);
  assert.match(reportCenter, /导出预览版/);
  assert.match(reportCenter, /导出明细 CSV/);
  assert.match(reportCenter, /最低纳入原值/);
  assert.match(reportModel, /reportFieldDomains/);
  assert.match(reportModel, /"hospital" \| "category" \| "device"/);
  assert.match(reportModel, /non_personnel/);
  assert.match(reportModel, /normalizeBenefitReportConfig/);
  assert.match(reportModel, /requiredSourceRequirementIds/);
  assert.match(reportModel, /manualDataEvidence/);
  assert.match(reportModel, /质量与社会效益/);
  assert.match(reportModel, /问题清单/);
  assert.match(reportCatalog, /综合效益评价/);
  assert.match(reportCatalog, /运营绩效评价/);
  assert.match(reportCatalog, /单机深度分析/);
  assert.match(reportCatalog, /医疗设备绩效分析-模版\.pdf/);
  assert.match(reportCatalog, /costScope: "non_personnel"/);
  assert.match(reportCatalog, /sourceRequirementCatalog/);
  assert.match(reportCatalog, /fieldPackCatalog/);
  assert.match(reportCatalog, /export function granularityForPeriod/);
  assert.ok(reportCatalog.includes("if (/^\\d{4}年(?:[1-9]|1[0-2])月$/.test(normalized))"));
  assert.match(reportCatalog, /return null/);
  assert.match(reportExport, /Packer\.toBlob/);
  assert.match(reportExport, /指标定义与计算公式/);
  assert.match(reportExport, /periodCostParts/);
  assert.match(reportExport, /受控补录：责任人/);
  assert.match(reportExport, /Arial Unicode MS/);
  assert.match(reportExport, /未签发预览版/);
  assert.match(reportExport, /SHA-256/);
  assert.match(reportGovernance, /buildReportQuality/);
  assert.match(reportGovernance, /安全合规/);
  assert.match(reportGovernance, /当前条件没有匹配设备/);
  assert.match(reportGovernance, /template-required-sources/);
  assert.match(reportGovernance, /utilization-rule/);
  assert.match(reportGovernance, /manualDocumentationMissing/);
  assertAppSessionProtected(reportRoute, "benefit-reports API");
  assert.match(reportRoute, /report\.manage/);
  assert.match(reportRoute, /report\.review/);
  assert.match(reportRoute, /report\.approve/);
  assert.match(reportRoute, /separation_of_duties/);
  assert.match(reportRoute, /quality_gate_failed/);
  assert.match(reportRoute, /templateIsDefault/);
  assert.match(reportRoute, /template_too_large/);
  assert.match(reportRoute, /usesFrozenSnapshot/);
  assert.match(reportRoute, /buildAuthoritativeReport/);
  assert.match(reportRoute, /hospitalCloudResources/);
  assert.match(reportRoute, /storedSnapshotQuality/);
  assert.match(reportRoute, /unsupported_report_period/);
  assert.match(reportRoute, /mayReadHospitalReports/);
  assert.match(reportRoute, /hasFullHospitalDataScope/);
  assert.match(reportRoute, /report_scope_exceeds_access/);
  assert.match(reportRoute, /granularityForPeriod/);

  assert.match(accessComponent, /医院配置/);
  assert.match(accessComponent, /角色与权限/);
  assert.match(accessComponent, /审计与复核策略/);
  assert.match(accessComponent, /保存医院/);
  assert.match(accessComponent, /保存成员/);
  assert.match(accessComponent, /保存角色/);
  assert.doesNotMatch(accessComponent, /真正的安全边界在服务端|security-boundary-note/);
  assert.doesNotMatch(styles, /security-boundary-note/);
  assert.match(accessData, /role-platform-admin/);
  assert.match(accessData, /role-clinical/);
  assertAppSessionProtected(tenantRoute, "tenant-context API");
  assert.match(tenantRoute, /hospitalMemberships/);
  assert.match(tenantRoute, /account_not_provisioned/);
  assert.match(tenantRoute, /getBootstrapAdminEmail/);
  assert.match(tenantRoute, /update_hospital/);
  assert.match(tenantRoute, /update_member_status/);
  assert.match(tenantRoute, /save_role/);
  assert.match(tenantRoute, /save_audit_policy/);
  assert.match(tenantRoute, /department_scope_required/);
  assert.match(tenantRoute, /validUntil/);
  assert.match(schema, /hospital_id/);
  assert.match(schema, /role_permissions/);
  assert.match(schema, /audit_logs/);
  assert.match(schema, /audit_policies/);
  assert.match(schema, /benefit_reports/);
  assert.match(schema, /report_templates/);
  assert.match(schema, /report_templates_one_default_per_hospital/);
  assert.match(schema, /report_events/);
  assert.match(styles, /hospital-config-list/);
  assert.match(styles, /permission-selector/);
  assert.match(styles, /--content-zoom-max, 3200px/);
  assert.match(styles, /clamp\(22px, 1\.45vw, 36px\)/);
  assert.doesNotMatch(styles, /font-size:\s*(?:7|8|9|10|11)px/);
  assert.match(styles, /\.modal-backdrop\.access-modal/);
  assert.match(styles, /\.access-modal \.access-dialog-body input/);
  assert.match(styles, /@media \(min-width: 1900px\)/);
  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /report-preview-layout/);
  assert.match(styles, /report-section-list/);
  assert.match(styles, /platform-template-grid/);
  assert.match(styles, /template-source-mapping-grid/);

  assert.match(improvement, /需求—产能周监测/);
  assert.match(improvement, /单机效益情景测算/);
  assert.match(improvement, /管理行动闭环/);
  assert.match(improvement, /全生命周期资源配置建议/);
  assert.match(improvement, /actions: ImprovementAction\[\]/);
  assert.match(improvement, /setActions: Dispatch<SetStateAction<ImprovementAction\[\]>>/);
  assert.match(improvement, /ImprovementCenter\(\{ devices, actions, setActions/);
  assert.doesNotMatch(improvement, /equip-benefit-improvement-actions-v1|localStorage/);
  assert.match(improvement, /大型医用设备绩效专项审计/);
  assert.match(improvement, /WHO 设备台账与维护信息系统/);
  assert.match(improvement, /NHS CT 需求—产能改进/);

  assert.match(data, /mri-01/);
  assert.match(data, /robot-01/);
  assert.match(data, /bio-01/);
  assert.match(data, /initialModules/);
  assert.match(data, /人工/);
  assert.match(data, /耗材/);
  assert.match(data, /dimensions/);
  assert.match(data, /quality/);
  assert.match(data, /reliability/);
  assert.match(data, /workforce/);
  assert.match(data, /维修保养文件/);

  assert.match(insightViews, /function SingleEquipmentDetail/);
  assert.match(insightViews, /关键值来源与计算血缘/);
  assert.match(insightViews, /指标字典/);
  assert.match(insightViews, /患者旅程/);
  assert.match(insightViews, /function WorkforcePerformancePanel/);
  assert.match(insightViews, /科室绩效与质控/);

  assert.match(definitions, /现金贡献/);
  assert.match(definitions, /次\/1000运行小时/);
  assert.match(definitions, /信息部集成；财务\/医务复核/);

  assert.match(notificationCenter, /工作提醒与系统消息/);
  assert.match(notificationCenter, /全部标为已读/);
  assert.match(accountCenter, /登录与安全/);
  assert.match(accountCenter, /消息接收偏好/);
  assert.match(loginScreen, /登录账号/);
  assert.match(loginScreen, /登录不等于获得业务权限/);
  assert.match(notifications, /手术机器人进入效益预警区间/);

  assert.match(page, /<EquipmentPlatform/);
  assert.match(page, /viewer=/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(packageJson, /"lucide-react"/);
  assert.match(packageJson, /"recharts"/);
  assert.match(packageJson, /"docx"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.match(hosting, /"d1": "DB"/);

  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});

test("requires an application session and provides real TOTP account security", async () => {
  const [
    component,
    loginScreen,
    accountCenter,
    appSessionRoute,
    accountSecurityRoute,
    accountSecurity,
    schema,
    migration,
    packageJson,
    benefitReportRoute,
    tenantRoute,
    cloudRoute,
    artifactRoute,
    healthRoute,
  ] = await Promise.all([
    readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/LoginScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/AccountCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/app-session/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account-security/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/account-security.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_milky_rocket_racer.sql", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/api/benefit-reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tenant-context/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cloud-state/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/report-artifacts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/system-health/route.ts", import.meta.url), "utf8"),
  ]);

  // SSO identity is only the first layer. Every business API must require the
  // independent application session rather than authorize getChatGPTUser directly.
  for (const [routeName, route] of [
    ["benefit-reports API", benefitReportRoute],
    ["tenant-context API", tenantRoute],
    ["cloud-state API", cloudRoute],
    ["report-artifacts API", artifactRoute],
    ["system-health API", healthRoute],
  ]) {
    assertAppSessionProtected(route, routeName);
  }
  for (const [routeName, route] of [
    ["benefit-reports API", benefitReportRoute],
    ["tenant-context API", tenantRoute],
    ["cloud-state API", cloudRoute],
    ["report-artifacts API", artifactRoute],
  ]) {
    assertSameOriginProtected(route, routeName);
  }

  // The session boundary supports explicit creation, lock, unlock, revocation and password login.
  for (const sessionAction of ["status", "start", "unlock", "lock", "revoke", "revoke_all", "password_login", "change_password"]) {
    assert.match(appSessionRoute, new RegExp(`"${sessionAction}"`), `AppSessionAction includes ${sessionAction}`);
  }
  assert.match(appSessionRoute, /assertSameOrigin\(request\)/);
  assert.match(appSessionRoute, /if \(action === "start"\) return await startSession/);
  assert.match(appSessionRoute, /if \(action === "unlock"\) return await unlockSession/);
  assert.match(appSessionRoute, /lockAppSession\(request\)/);
  assert.match(appSessionRoute, /revokeCurrentAppSession\(request\)/);
  assert.match(appSessionRoute, /revokeAllAppSessions\(request\)/);
  assert.match(appSessionRoute, /verifyMfaFactor/);
  assert.match(appSessionRoute, /appSessionCookie\(issued\.rawToken\)/);
  assert.match(appSessionRoute, /clearAppSessionCookie\(\)/);
  assert.match(appSessionRoute, /"Cache-Control": "no-store"/);

  assert.match(accountSecurity, /export const APP_SESSION_COOKIE = "__Host-yh_app_session"/);
  assert.match(accountSecurity, /APP_SESSION_IDLE_SECONDS = 8 \* 60 \* 60/);
  assert.match(accountSecurity, /APP_SESSION_ABSOLUTE_SECONDS = 24 \* 60 \* 60/);
  assert.match(accountSecurity, /tokenHash = await sha256Hex\(rawToken\)/);
  assert.match(accountSecurity, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(accountSecurity, /export async function requireAppSession/);
  assert.match(accountSecurity, /"app_session_locked"/);
  assert.match(accountSecurity, /"app_session_expired"/);
  assert.match(accountSecurity, /"app_session_required"/);

  // Account security itself is behind an active application session and uses
  // same-origin mutation checks; it cannot be reached with SSO headers alone.
  assertAppSessionProtected(accountSecurityRoute, "account-security API");
  assert.match(accountSecurityRoute, /assertSameOrigin\(request\)/);
  assert.match(accountSecurityRoute, /payload\.action === "begin"/);
  assert.match(accountSecurityRoute, /beginMfaEnrollment/);
  assert.match(accountSecurityRoute, /payload\.action === "cancel"/);
  assert.match(accountSecurityRoute, /cancelMfaEnrollment/);
  assert.match(accountSecurityRoute, /payload\.action === "confirm"/);
  assert.match(accountSecurityRoute, /confirmMfaEnrollment/);
  assert.match(accountSecurityRoute, /recoveryCodes: confirmed\.recoveryCodes/);
  assert.match(accountSecurityRoute, /payload\.action === "disable"/);
  assert.match(accountSecurityRoute, /verifyMfaFactor/);
  assert.match(accountSecurityRoute, /withNoStore\(appSessionError\(error\)\)/);

  // TOTP secrets are encrypted, codes are replay-protected and rate-limited,
  // and recovery codes are stored as one-time hashes rather than plaintext.
  assert.match(accountSecurity, /otpauth:\/\/totp\//);
  assert.match(accountSecurity, /algorithm=SHA1&digits=\$\{TOTP_DIGITS\}&period=\$\{TOTP_PERIOD_SECONDS\}/);
  assert.match(accountSecurity, /\{ name: "AES-GCM", iv \}/);
  assert.match(accountSecurity, /MFA_TOTP_ENCRYPTION_KEY/);
  assert.match(accountSecurity, /lt\(accountMfaSettings\.lastTotpCounter, matchedCounter\)/);
  assert.match(accountSecurity, /mfa_code_replayed/);
  assert.match(accountSecurity, /MFA_LOCK_THRESHOLD = 5/);
  assert.match(accountSecurity, /MFA_LOCK_MS = 15 \* 60 \* 1000/);
  assert.match(accountSecurity, /failedAttempts: sql<number>`\$\{accountMfaSettings\.failedAttempts\} \+ 1`/);
  assert.match(accountSecurity, /if \(!cancelled\)/);
  assert.match(accountSecurity, /await db\.batch\(\[/);
  assert.match(accountSecurity, /export async function cancelMfaEnrollment/);
  assert.match(accountSecurity, /mfa_cancel/);
  assert.match(accountSecurity, /secretCiphertext: null/);
  assert.match(accountSecurity, /secretIv: null/);
  assert.match(accountSecurity, /codeHash: await sha256Hex\(normalizeRecoveryCode\(code\)\)/);
  assert.match(accountSecurity, /isNull\(accountRecoveryCodes\.usedAt\)/);
  assert.match(accountSecurity, /set\(\{ usedAt: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(accountSecurity, /constantTimeEqual\(expected, code\)/);

  assert.match(schema, /export const appSessions/);
  assert.match(schema, /export const accountMfaSettings/);
  assert.match(schema, /export const accountRecoveryCodes/);
  assert.match(migration, /CREATE TABLE `app_sessions`/);
  assert.match(migration, /CREATE TABLE `account_mfa_settings`/);
  assert.match(migration, /CREATE TABLE `account_recovery_codes`/);

  // The account center creates the QR image from the one-time otpauth URI and
  // requires users to save server-issued one-time recovery codes.
  assert.match(packageJson, /"qrcode"/);
  assert.match(accountCenter, /import QRCode from "qrcode"/);
  assert.match(accountCenter, /QRCode\.toDataURL\(nextEnrollment\.otpauthUri/);
  assert.match(accountCenter, /alt="身份验证器绑定二维码"/);
  assert.match(accountCenter, /action: "cancel"/);
  assert.match(accountCenter, /临时密钥已清除/);
  assert.match(accountCenter, /保存一次性恢复码/);
  assert.match(accountCenter, /recoveryCodes\.map/);
  assert.match(accountCenter, /每枚恢复码只能使用一次/);
  assert.match(accountCenter, /服务端只保存其校验摘要/);
  assert.doesNotMatch(accountCenter, /当前会话 · macOS|上次会话 · Web|上海 · 刚刚|上海 · 2026/);
  assert.match(accountCenter, /不根据浏览器猜测城市、系统或历史设备/);

  // The UI exposes all three states and keeps SSO switching separate from
  // entering or unlocking the application session.
  assert.match(loginScreen, /export type LoginMode = "signin" \| "session-required" \| "locked"/);
  assert.match(loginScreen, /viewer\?: ViewerIdentity/);
  assert.match(loginScreen, /mfaEnabled\?: boolean/);
  assert.match(loginScreen, /viewer\.email/);
  assert.match(loginScreen, /登录身份已核验/);
  assert.match(loginScreen, /应用会话已锁定/);
  assert.match(loginScreen, /6 位验证码或恢复码/);
  assert.match(loginScreen, /进入平台/);
  assert.match(loginScreen, /切换登录账号/);
  assert.match(loginScreen, /onSwitchAccount/);
  assert.match(loginScreen, /onPasswordLogin/);
  assert.doesNotMatch(loginScreen, /QRCode|toDataURL|<canvas/);

  assert.match(component, /type ApplicationSessionState = "checking" \| "required" \| "locked" \| "active" \| "error" \| "demo"/);
  assert.match(component, /fetch\("\/api\/app-session"/);
  assert.match(component, /action: applicationSessionState === "locked" \? "unlock" : "start"/);
  assert.match(component, /mode=\{applicationSessionState === "locked" \? "locked" : "session-required"\}/);
  assert.match(component, /onContinue=\{continueApplicationSession\}/);
  assert.match(component, /onSwitchAccount=\{switchUnifiedIdentity\}/);
  assert.match(component, /applicationSessionState !== "active"/);
});

test("provides a role-based guide with clickable hospital workflows", async () => {
  const [component, guide, styles] = await Promise.all([
    readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/GuideCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /id: "guide", label: "使用指南"/);
  assert.match(component, /aria-label="打开使用指南"/);
  assert.match(component, /guide-entry-strip/);
  assert.match(component, /<GuideCenter/);
  assert.match(guide, /院领导/);
  assert.match(guide, /设备科/);
  assert.match(guide, /财务运营/);
  assert.match(guide, /科室负责人/);
  assert.match(guide, /信息科/);
  assert.match(guide, /平台管理员/);
  assert.match(guide, /医疗设备效益分析月度闭环流程图/);
  assert.match(guide, /5 分钟讲清楚系统价值/);
  assert.match(guide, /这里是配置与记录快照，不等于本月已经完成采集、对账、复核或签发/);
  assert.match(guide, /不在本平台保存患者身份和实时生理参数/);
  assert.match(styles, /\.guide-monthly-flow/);
  assert.match(styles, /\.guide-route-grid/);
  assert.match(styles, /\.guide-page-grid/);
  assert.match(styles, /\.guide-demo-route/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.guide-route-grid, \.guide-page-grid, \.guide-monthly-flow/);
});

test("uses hospital-scoped D1 state and account-scoped preferences for authenticated sessions", async () => {
  const [component, cloudTypes, cloudStore, cloudRoute, schema, migration, hosting] = await Promise.all([
    readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/cloud-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cloud-state/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_little_excalibur.sql", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  // Browser storage remains available only to the explicitly anonymous demo path.
  assert.match(component, /const demoMode = !viewer\.authenticated/);
  assert.match(component, /useDemoState<[^>]+>\([^,]+,[^,]+, demoMode\)/);
  assert.match(component, /if \(!enabled\) return/);
  assert.match(component, /window\.localStorage\.getItem/);
  assert.match(component, /window\.localStorage\.setItem/);

  // Authenticated users hydrate and persist all mutable product resources through the cloud API.
  assert.match(component, /api\/cloud-state\?hospitalId=/);
  assert.match(component, /action: "bootstrap"/);
  assert.match(component, /method: "PUT"/);
  assert.match(component, /baseRevision/);
  assert.match(component, /requestCloudResource/);
  assert.match(component, /action: "save_preferences"/);
  assert.match(component, /sessionState !== "verified" \|\| !cloudHydrated/);
  assert.match(component, /persistCloudResource\("devices"/);
  assert.match(component, /persistCloudResource\("costEntries"/);
  assert.match(component, /persistCloudResource\("improvementActions"/);
  assert.match(component, /persistCloudResource\("modules"/);
  assert.match(component, /persistCloudResource\("dataSources"/);
  assert.match(component, /persistCloudResource\("analysisProfiles"/);
  assert.match(component, /云端数据已同步/);

  assert.match(cloudTypes, /"devices"/);
  assert.match(cloudTypes, /"costEntries"/);
  assert.match(cloudTypes, /"notifications"/);
  assert.match(cloudTypes, /"improvementActions"/);
  assert.match(cloudTypes, /"modules"/);
  assert.match(cloudTypes, /"dataSources"/);
  assert.match(cloudTypes, /"analysisProfiles"/);
  assert.match(cloudTypes, /readNotificationIds\?: string\[\]/);

  // RBAC is enforced server-side for every shared resource.
  assert.match(cloudStore, /devices: "equipment\.manage"/);
  assert.match(cloudStore, /costEntries: "cost\.manage"/);
  assert.match(cloudStore, /notifications: "member\.manage"/);
  assert.match(cloudStore, /improvementActions: "improvement\.manage"/);
  assert.match(cloudStore, /modules: "member\.manage"/);
  assert.match(cloudStore, /dataSources: "source\.manage"/);
  assert.match(cloudStore, /analysisProfiles: "source\.manage"/);
  assert.match(cloudStore, /export function mayReadCloudResource/);
  assert.match(cloudStore, /\.map\(\(department\) => department\.trim\(\)\)/);
  assert.match(cloudStore, /\.filter\(Boolean\)/);
  assertAppSessionProtected(cloudRoute, "cloud-state API");
  assert.match(cloudRoute, /mayReadCloudResource/);
  assert.match(cloudRoute, /mayWriteCloudResource/);
  assert.match(cloudRoute, /permission_denied/);
  assert.match(cloudRoute, /scoped_snapshot_write_denied/);

  // Reads and writes are constrained by hospital membership and server-side data scope.
  assert.match(cloudStore, /eq\(hospitalMemberships\.hospitalId, hospitalId\)/);
  assert.match(cloudStore, /eq\(hospitals\.status, "active"\)/);
  assert.match(cloudStore, /validUntil/);
  assert.match(cloudStore, /dataScope/);
  assert.match(cloudStore, /departmentScope/);
  assert.match(cloudRoute, /eq\(hospitalCloudResources\.hospitalId, hospitalId\)/);
  assert.match(cloudRoute, /function applyDataScope/);
  assert.match(cloudRoute, /access\.dataScope === "self"/);
  assert.match(cloudRoute, /const departments = access\.departmentScope/);
  assert.match(cloudRoute, /departmentScope\.includes\(candidate\)/);
  assert.doesNotMatch(cloudRoute, /candidate\.includes\(department\)/);
  assert.match(cloudRoute, /dataSources: \[\]/);
  assert.match(cloudRoute, /analysisProfiles: \[\]/);
  assert.match(cloudRoute, /function hasFullResourceWriteScope/);
  assert.match(cloudRoute, /const preferenceUpdates:/);
  assert.match(cloudRoute, /set: preferenceUpdates/);
  assert.match(component, /cloudWriteQueues/);
  assert.match(component, /cloudWriteVersions/);
  assert.match(component, /cloudDirtyKeys/);
  assert.match(component, /cloudRevisions/);
  assert.match(component, /mayInitializeHospital/);

  // Notification bodies are hospital-shared, while read state is stored per account.
  assert.match(cloudRoute, /delete notification\.read/);
  assert.match(cloudRoute, /accountCloudPreferences\.accountId/);
  assert.match(cloudRoute, /readNotificationIdsJson/);
  assert.match(component, /readNotificationIds\.includes\(item\.id\)/);
  assert.match(component, /updateReadNotificationIds/);

  // Bootstrap is idempotent and the migration creates the hospital/account persistence boundary.
  assert.match(cloudRoute, /bootstrapResource/);
  assert.match(cloudRoute, /onConflictDoNothing/);
  assert.match(schema, /hospitalCloudResources/);
  assert.match(schema, /accountCloudPreferences/);
  assert.match(migration, /CREATE TABLE `hospital_cloud_resources`/);
  assert.match(migration, /PRIMARY KEY\(`hospital_id`, `resource`\)/);
  assert.match(migration, /CREATE TABLE `account_cloud_preferences`/);
  assert.match(migration, /`account_id` text PRIMARY KEY/);
  assert.match(migration, /`read_notification_ids_json` text/);
  assert.match(hosting, /"d1": "DB"/);
});

test("rejects stale cloud resource writes with atomic optimistic concurrency control", async () => {
  const [component, cloudTypes, cloudStore, cloudRoute, schema, migration] = await Promise.all([
    readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cloud-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/cloud-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cloud-state/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0004_rare_robbie_robertson.sql", import.meta.url), "utf8"),
  ]);

  // Every GET exposes a complete revision map. Existing rows created before
  // this migration start at revision 1; resources that do not exist use 0.
  assert.match(cloudTypes, /export type CloudResourceRevisions = Record<CloudResource, number>/);
  assert.match(cloudTypes, /revisions: CloudResourceRevisions/);
  assert.match(cloudStore, /emptyResourceRevisions/);
  assert.match(cloudStore, /\[resource, 0\]/);
  assert.match(cloudStore, /normalizeResourceRevision/);
  assert.match(cloudRoute, /revisions\[row\.resource\] = normalizeResourceRevision\(row\.revision\)/);
  assert.match(schema, /revision: integer\("revision"\)\.notNull\(\)\.default\(1\)/);
  assert.equal(
    migration.trim(),
    "ALTER TABLE `hospital_cloud_resources` ADD `revision` integer DEFAULT 1 NOT NULL;",
  );

  // PUT, PATCH, and the legacy POST action all share the same precondition.
  assert.match(cloudTypes, /baseRevision: number/);
  assert.match(cloudRoute, /export async function PUT\(request: Request\)/);
  assert.match(cloudRoute, /export async function PATCH\(request: Request\)/);
  assert.match(cloudRoute, /error: "base_revision_required"/);
  assert.match(cloudRoute, /\{ status: 428 \}/);
  assert.match(cloudRoute, /payload\.action === "save_resource"[\s\S]*return writeRevisionedResource\(hospitalId, payload, access\)/);

  // The update itself is one conditional SQL statement. A stale revision
  // updates zero rows and therefore cannot overwrite the current value.
  assert.match(cloudRoute, /eq\(hospitalCloudResources\.revision, baseRevision\)/);
  assert.match(cloudRoute, /revision: sql<number>`\$\{hospitalCloudResources\.revision\} \+ 1`/);
  assert.match(cloudRoute, /onConflictDoNothing\(\)\.returning\(\{ revision: hospitalCloudResources\.revision \}\)/);
  assert.match(cloudRoute, /error: "revision_conflict"/);
  assert.match(cloudRoute, /expectedRevision: payload\.baseRevision/);
  assert.match(cloudRoute, /currentRevision: currentState\.revisions\[payload\.resource\]/);
  assert.match(cloudRoute, /currentValue: currentState\.shared\[payload\.resource\]/);
  assert.match(cloudRoute, /\{ status: 409 \}/);

  // Bootstrap remains insert-only, while former bulk snapshot/delete paths
  // cannot bypass per-resource revision checks.
  const bootstrapStart = cloudRoute.indexOf("async function bootstrapResource");
  const casStart = cloudRoute.indexOf("async function compareAndSwapResource");
  assert.ok(bootstrapStart >= 0 && casStart > bootstrapStart);
  const bootstrapImplementation = cloudRoute.slice(bootstrapStart, casStart);
  assert.match(bootstrapImplementation, /onConflictDoNothing/);
  assert.doesNotMatch(bootstrapImplementation, /onConflictDoUpdate/);
  assert.match(cloudRoute, /error: "bulk_snapshot_write_disabled"/);
  assert.match(cloudRoute, /error: "resource_delete_disabled"/);

  // The client sends its latest revision and never resolves a conflict silently.
  assert.match(component, /cloudRevisions\.current\[hospitalId\]\?\.\[resource\]/);
  assert.match(component, /setCloudConflict/);
  assert.match(component, /系统没有自动覆盖任何一方/);
  assert.match(component, /采用云端版本/);
  assert.match(component, /保留并上传本机版本/);
  assert.match(component, /下载本机副本/);
});

test("provides configurable category-specific collection, quality, and benefit rules", async () => {
  const [studio, profiles, reportCenter, reportModel, definitions, styles, cloudRoute, healthRoute, governance, reportExport] = await Promise.all([
    readFile(new URL("../app/BenefitAnalysisStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/benefit-analysis-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/BenefitReportCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/benefit-report-model.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/metric-definitions.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cloud-state/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/system-health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/report-governance.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/benefit-report-export.ts", import.meta.url), "utf8"),
  ]);

  // Device classes do not share one generic utilization model.
  assert.match(profiles, /放射\/放疗\/核医学/);
  assert.match(profiles, /超声/);
  assert.match(profiles, /内镜/);
  assert.match(profiles, /手术室共享设备/);
  assert.match(profiles, /生命支持/);
  assert.match(profiles, /检验/);
  assert.match(profiles, /Excel 标准模板/);
  assert.match(profiles, /CSV 明细文件/);
  assert.match(profiles, /JSON 批量数据/);
  assert.match(profiles, /受控人工补充/);
  assert.match(profiles, /plannedServiceHoursPerMonth/);
  assert.match(profiles, /allocationCountWeight/);
  assert.match(profiles, /allocationTimeWeight/);

  // Rules are editable, validated, and explicit about evidence/privacy boundaries.
  assert.match(studio, /采集方案/);
  assert.match(studio, /质量与对账/);
  assert.match(studio, /分析口径/);
  assert.match(studio, /分摊权重合计必须为 100%/);
  assert.match(studio, /云端分析事件不得采集直接身份字段/);
  assert.match(studio, /仅为规则演示，不代表真实接入/);
  assert.match(studio, /设备实际完成工作量－有效收费工作量/);
  assert.match(studio, /净现值 NPV/);
  assert.match(studio, /盈亏平衡工作量/);
  assert.match(studio, /analysis-ingestion-flow/);
  assert.match(studio, /label: "来源"/);
  assert.match(studio, /label: "事件"/);
  assert.match(studio, /label: "质检"/);
  assert.match(studio, /label: "对账"/);
  assert.match(studio, /label: "指标"/);
  assert.match(studio, /配置待办/);
  assert.match(studio, /不冒充后台已执行修复/);
  assert.doesNotMatch(studio, /样例任务 23 条/);
  assert.match(studio, /data-label="下一步"/);
  assert.match(styles, /analysis-collection-layout/);
  assert.match(styles, /modal-backdrop\.analysis-modal/);
  assert.match(styles, /100dvh/);
  assert.match(styles, /analysis-responsive-table td::before/);
  assert.match(styles, /@media \(max-width: 390px\)/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /overflow-x: clip/);

  // The new configuration is hospital-scoped in D1 and feeds the report's actual source readiness.
  assert.match(cloudRoute, /analysisProfiles: 200/);
  assert.match(healthRoute, /analysisProfiles: "采集分析配置"/);
  assert.match(reportCenter, /dataSources: DataSource\[\]/);
  assert.match(reportCenter, /analysisProfiles: BenefitAnalysisProfile\[\]/);
  assert.match(reportModel, /dataSources: DataSource\[\] = defaultDataSources/);
  assert.match(reportModel, /analysisProfileCoverage/);
  assert.match(governance, /id: "collection-profiles"/);
  assert.match(governance, /analysisProfiles: model\.analysisProfiles/);
  assert.match(reportExport, /采集、设备绑定与对账规则快照/);
  assert.match(definitions, /平均故障间隔 MTBF/);
  assert.match(definitions, /设备事件匹配率/);
  assert.match(definitions, /收费对账差异率/);
  assert.match(definitions, /必填字段完整率/);
});

test("prevents reserved platform administrator role escalation", async () => {
  const [tenantRoute, cloudStore, reportRoute] = await Promise.all([
    readFile(new URL("../app/api/tenant-context/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/cloud-state.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/benefit-reports/route.ts", import.meta.url), "utf8"),
  ]);

  // Platform authority is tied to the immutable built-in role id, not a user-editable role code.
  assert.match(tenantRoute, /const PLATFORM_ADMIN_ROLE_ID = "role-platform-admin"/);
  assert.match(tenantRoute, /membership\.roleId === PLATFORM_ADMIN_ROLE_ID/);
  assert.match(tenantRoute, /actorContext\.memberships\.some\(\(membership\) => membership\.roleId === PLATFORM_ADMIN_ROLE_ID\)/);
  assert.match(cloudStore, /membership\.roleId === PLATFORM_ADMIN_ROLE_ID/);
  assert.doesNotMatch(cloudStore, /membership\.roleCode === "platform_admin"/);
  assert.match(reportRoute, /getCloudStateAccess\(email, hospitalId\)/);

  // The same reserved-code check executes before both update and create branches.
  const saveRoleStart = tenantRoute.indexOf('if (payload.action === "save_role")');
  const updateBranch = tenantRoute.indexOf("if (roleId) {", saveRoleStart);
  const reservedCheck = tenantRoute.indexOf("RESERVED_ROLE_CODES.has(roleCode", saveRoleStart);
  const immutablePlatformRoleCheck = tenantRoute.indexOf("roleId === PLATFORM_ADMIN_ROLE_ID", saveRoleStart);
  assert.ok(saveRoleStart >= 0);
  assert.ok(reservedCheck > saveRoleStart && reservedCheck < updateBranch);
  assert.ok(immutablePlatformRoleCheck > saveRoleStart && immutablePlatformRoleCheck < updateBranch);
  assert.match(tenantRoute.slice(saveRoleStart, updateBranch), /reserved_role_code/);
  assert.match(tenantRoute.slice(saveRoleStart, updateBranch), /role_not_editable/);
});

test("enforces one default report template per hospital", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0006_lethal_scream.sql", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /report_templates_one_default_per_hospital/);
  assert.match(migration, /ROW_NUMBER\(\) OVER/);
  assert.match(migration, /PARTITION BY `hospital_id`/);
  assert.match(migration, /CREATE UNIQUE INDEX `report_templates_one_default_per_hospital`/);
});

test("stores report artifacts in hospital-scoped R2 with validated metadata", async () => {
  const [reportCenter, reportRoute, artifactRoute, schema, migration, hosting] = await Promise.all([
    readFile(new URL("../app/BenefitReportCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/benefit-reports/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/report-artifacts/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0003_little_excalibur.sql", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(reportCenter, /api\/report-artifacts/);
  assert.match(reportCenter, /FormData/);
  assertAppSessionProtected(artifactRoute, "report-artifacts API");
  assert.match(artifactRoute, /getCloudStateAccess/);
  assert.match(artifactRoute, /permissions\.has\("report\.export"\)/);
  assert.match(artifactRoute, /access\.dataScope !== "platform" && access\.dataScope !== "hospital"/);
  assert.match(artifactRoute, /REPORT_FILES/);
  assert.match(hosting, /"r2": "REPORT_FILES"/);

  // Uploads accept only the two generated report formats and enforce a bounded payload.
  assert.match(artifactRoute, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(artifactRoute, /"text\/csv"/);
  assert.match(artifactRoute, /maximumArtifactBytes = 12 \* 1024 \* 1024/);
  assert.match(artifactRoute, /file\.size <= 0 \|\| file\.size > maximumArtifactBytes/);
  assert.match(artifactRoute, /crypto\.subtle\.digest\("SHA-256", bytes\)/);
  assert.match(artifactRoute, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(artifactRoute, /hash_mismatch/);
  assert.match(artifactRoute, /!reportId/);
  assert.match(artifactRoute, /hasExpectedSignature/);
  assert.match(artifactRoute, /report\.status !== "issued"/);
  assert.match(artifactRoute, /issued_artifact_permission_denied/);
  assert.match(artifactRoute, /fileName\.endsWith\("-已签发\.csv"\)/);
  assert.match(artifactRoute, /issued_artifact_conflict/);

  // Submission is the freeze boundary; reviewers, approvers and issued exports
  // all reconstruct the same immutable snapshot instead of current device data.
  assert.match(reportRoute, /snapshotJson: usesFrozenSnapshot\(report\.status\) \? parseJson\(report\.snapshotJson, null\) : null/);
  assert.match(reportCenter, /function frozenModelForReport/);
  assert.match(reportCenter, /frozenModelForReport\(currentReport, hospital, liveModel\)/);
  assert.match(reportCenter, /已提交报告的冻结快照缺失或损坏/);
  assert.match(reportCenter, /reportNumber\(hospital, linkedReport\).*V\$\{linkedReport\.version\}/s);
  assert.match(reportCenter, /演示模式不会写入云端/);
  assert.match(reportCenter, /预览文件不进入正式云档案/);

  // Artifact lookup, report lookup and R2 keys all include the active hospital.
  assert.match(artifactRoute, /eq\(reportArtifacts\.hospitalId, hospitalId\)/);
  assert.match(artifactRoute, /eq\(benefitReports\.hospitalId, hospitalId\)/);
  assert.match(artifactRoute, /reports\/\$\{hospitalId\}\/\$\{reportId\}\//);
  assert.match(artifactRoute, /permission_denied/);
  assert.match(artifactRoute, /artifact_not_found/);

  // D1 stores searchable metadata; R2 stores bytes and is cleaned up if metadata persistence fails.
  assert.match(schema, /export const reportArtifacts/);
  assert.match(schema, /fileKey: text\("file_key"\)\.notNull\(\)/);
  assert.match(schema, /sha256: text\("sha256"\)\.notNull\(\)/);
  assert.match(artifactRoute, /bucket\.put\(fileKey, bytes/);
  assert.match(artifactRoute, /await db\.batch\(/);
  assert.match(artifactRoute, /deleteObjectWithRetry/);
  assert.match(artifactRoute, /await bucket\.delete\(fileKey\)/);
  assert.match(migration, /CREATE TABLE `report_artifacts`/);
  assert.match(migration, /FOREIGN KEY \(`hospital_id`\) REFERENCES `hospitals`/);
  assert.match(migration, /CREATE UNIQUE INDEX `report_artifacts_file_key_unique`/);
});

test("provides an administrator-only cloud operations and backup center", async () => {
  const [component, operations, healthRoute, styles, globalStyles, runbook, readme] = await Promise.all([
    readFile(new URL("../app/EquipmentPlatform.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/CloudOperationsCenter.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/system-health/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/CloudOperationsCenter.module.css", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../DEMO-RUNBOOK.md", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(component, /CloudOperationsCenter/);
  assert.match(component, /id: "operations", label: "云端运维"/);
  assert.match(component, /permissions: \["member\.manage"\]/);
  assert.match(component, /sidebar-hospital-switcher/);
  assert.match(component, /移动端当前医院/);
  assert.match(operations, /云端运维与演示自检/);
  assert.match(operations, /运行云端自检/);
  assert.match(operations, /下载医院备份/);
  assert.match(operations, /api\/system-health/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(globalStyles, /\.sidebar-hospital-switcher/);

  assertAppSessionProtected(healthRoute, "system-health API");
  assert.match(healthRoute, /requireHospitalAdministrator/);
  assert.match(healthRoute, /access\.permissions\.has\("member\.manage"\)/);
  assert.match(healthRoute, /eq\(hospitalCloudResources\.hospitalId, hospitalId\)/);
  assert.match(healthRoute, /REPORT_FILES/);
  assert.match(healthRoute, /bucket\.head/);
  assert.match(healthRoute, /maximumBackupBytes = 20 \* 1024 \* 1024/);
  assert.match(healthRoute, /withoutSensitiveValues/);
  assert.match(healthRoute, /sensitiveKeyPattern/);
  assert.match(healthRoute, /x-backup-sha256/);
  assert.match(healthRoute, /download_hospital_backup/);
  assert.match(healthRoute, /cache-control": "private, no-store"/);

  assert.match(readme, /正式账号/);
  assert.match(readme, /云端 D1/);
  assert.match(readme, /匿名演示/);
  assert.match(runbook, /演示前一天/);
  assert.match(runbook, /建议的 12 分钟演示脚本/);
  assert.match(runbook, /禁止录入患者个人信息/);
});
