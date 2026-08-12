import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { normalizeAssetCodePrefix } from "../../device-ledger-fields";
import { appSessionError, assertSameOrigin, requireAppSession } from "../../../db/account-security";
import { getBootstrapAdminEmail, getDb } from "../../../db";
import { resolveSsoAccount } from "../../../db/account-access";
import { PasswordAuthError, passwordAuthError, upsertAccountCredential } from "../../../db/password-auth";
import {
  accountCredentials,
  accounts,
  auditPolicies,
  auditLogs,
  hospitalMemberships,
  hospitals,
  permissions,
  rolePermissions,
  roles,
} from "../../../db/schema";

const hospitalSeeds = [
  { id: "hosp-central", code: "HOSP-001", name: "勇虹示范中心医院", shortName: "中心医院", level: "三级甲等", category: "综合医院", assetCodePrefix: "YHZX", region: "总院区" },
  { id: "hosp-east", code: "HOSP-002", name: "勇虹示范东院", shortName: "东院", level: "三级乙等", category: "综合医院", assetCodePrefix: "YHDY", region: "东院区" },
  { id: "hosp-specialty", code: "HOSP-003", name: "勇虹示范专科医院", shortName: "专科医院", level: "三级（未定等）", category: "专科医院", assetCodePrefix: "YHZK", region: "专科院区" },
] as const;

const permissionSeeds = [
  ["dashboard.view", "驾驶舱", "查看效益驾驶舱", "low"],
  ["equipment.manage", "设备台账", "维护设备主数据", "high"],
  ["cost.manage", "成本填报", "维护财务成本", "high"],
  ["improvement.manage", "运营改进", "维护改进行动", "medium"],
  ["report.manage", "报告治理", "编制和提交效益报告", "medium"],
  ["report.review", "报告治理", "复核报告数据和结论", "high"],
  ["report.approve", "报告治理", "签发医院正式报告", "high"],
  ["report.export", "报表导出", "导出医院经营数据", "high"],
  ["source.manage", "数据治理", "维护来源文件与指标口径", "high"],
  ["connector.manage", "数据治理", "维护文件来源配置", "high"],
  ["data.ingest", "数据治理", "创建文件导入批次", "medium"],
  ["data.clean", "数据治理", "执行字段映射、清洗与隔离修复", "medium"],
  ["data.review", "数据治理", "复核数据质量与业务对账", "high"],
  ["data.publish", "数据治理", "发布或更正正式数据版本", "high"],
  ["hospital.manage", "医院配置", "创建和停用医院租户", "high"],
  ["member.manage", "用户权限", "维护成员和角色", "high"],
  ["audit.view", "审计日志", "查看授权与操作日志", "medium"],
] as const;

const roleSeeds = [
  { id: "role-platform-admin", code: "platform_admin", name: "平台超级管理员", description: "管理医院租户和平台安全", dataScope: "platform" as const },
  { id: "role-hospital-admin", code: "hospital_admin", name: "医院管理员", description: "管理本医院组织与权限", dataScope: "hospital" as const },
  { id: "role-leadership", code: "leadership", name: "院领导", description: "查看院级经营与改进结果", dataScope: "hospital" as const },
  { id: "role-equipment", code: "equipment_manager", name: "医学装备管理员", description: "管理设备和保障业务", dataScope: "hospital" as const },
  { id: "role-finance", code: "finance_manager", name: "财务成本管理员", description: "管理收入成本与效益口径", dataScope: "hospital" as const },
  { id: "role-clinical", code: "clinical_manager", name: "临床科室负责人", description: "管理授权科室设备", dataScope: "department" as const },
  { id: "role-auditor", code: "auditor", name: "审计只读", description: "查看分析与审计记录", dataScope: "hospital" as const },
] as const;

const PLATFORM_ADMIN_ROLE_ID = "role-platform-admin";
const RESERVED_ROLE_CODES = new Set(roleSeeds.map((role) => role.code));

const rolePermissionMap: Record<string, string[]> = {
  "role-platform-admin": permissionSeeds.map(([code]) => code),
  "role-hospital-admin": permissionSeeds.map(([code]) => code).filter((code) => code !== "hospital.manage"),
  "role-leadership": ["dashboard.view", "improvement.manage", "report.approve", "report.export", "data.publish", "audit.view"],
  "role-equipment": ["dashboard.view", "equipment.manage", "improvement.manage", "report.manage", "report.export", "source.manage", "connector.manage", "data.ingest", "data.clean", "data.review", "audit.view"],
  "role-finance": ["dashboard.view", "cost.manage", "report.manage", "report.review", "report.export", "source.manage", "data.review", "audit.view"],
  "role-clinical": ["dashboard.view", "improvement.manage"],
  "role-auditor": ["dashboard.view", "report.export", "source.manage", "audit.view"],
};

async function ensureBaseCatalog() {
  const db = await getDb();
  for (const hospital of hospitalSeeds) {
    await db.insert(hospitals).values(hospital).onConflictDoNothing();
    await db.insert(auditPolicies).values({ hospitalId: hospital.id }).onConflictDoNothing();
  }
  for (const [code, module, name, risk] of permissionSeeds) {
    await db.insert(permissions).values({ code, module, name, risk }).onConflictDoNothing();
  }
  for (const role of roleSeeds) {
    await db.insert(roles).values({ ...role, hospitalId: null, builtin: true }).onConflictDoNothing();
  }
  for (const [roleId, permissionCodes] of Object.entries(rolePermissionMap)) {
    for (const permissionCode of permissionCodes) {
      await db.insert(rolePermissions).values({ roleId, permissionCode }).onConflictDoNothing();
    }
  }
}

const dataScopeLabels = {
  platform: "平台全部医院",
  hospital: "本医院全部",
  department: "指定科室",
  self: "本人负责设备",
} as const;

async function accessConfigurationCatalog(manageHospitalIds: string[], auditHospitalIds: string[], includePlatformAudit: boolean) {
  const db = await getDb();
  const roleRows = manageHospitalIds.length
    ? await db.select().from(roles).where(or(isNull(roles.hospitalId), inArray(roles.hospitalId, manageHospitalIds)))
    : [];
  const roleIds = roleRows.map((role) => role.id);
  const roleGrants = roleIds.length ? await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds)) : [];
  const grantsByRole = roleGrants.reduce<Record<string, string[]>>((result, grant) => {
    (result[grant.roleId] ??= []).push(grant.permissionCode);
    return result;
  }, {});
  const memberRows = manageHospitalIds.length ? await db
    .select({
      id: hospitalMemberships.id,
      name: accounts.displayName,
      email: accounts.email,
      hospitalId: hospitalMemberships.hospitalId,
      roleId: hospitalMemberships.roleId,
      departmentScope: hospitalMemberships.departmentScope,
      status: hospitalMemberships.status,
      lastLogin: accounts.lastLoginAt,
      username: accountCredentials.username,
      mustChangePassword: accountCredentials.mustChangePassword,
    })
    .from(hospitalMemberships)
    .innerJoin(accounts, eq(hospitalMemberships.accountId, accounts.id))
    .leftJoin(accountCredentials, eq(accountCredentials.accountId, accounts.id))
    .where(inArray(hospitalMemberships.hospitalId, manageHospitalIds)) : [];
  const memberCounts = memberRows.reduce<Record<string, number>>((result, member) => {
    result[member.roleId] = (result[member.roleId] ?? 0) + 1;
    return result;
  }, {});
  const policyRows = auditHospitalIds.length ? await db.select().from(auditPolicies).where(inArray(auditPolicies.hospitalId, auditHospitalIds)) : [];
  const auditRows = auditHospitalIds.length ? await db
    .select({
      time: auditLogs.createdAt,
      actor: accounts.displayName,
      hospital: hospitals.shortName,
      action: auditLogs.action,
      target: auditLogs.detail,
      result: auditLogs.result,
    })
    .from(auditLogs)
    .leftJoin(accounts, eq(auditLogs.actorAccountId, accounts.id))
    .leftJoin(hospitals, eq(auditLogs.hospitalId, hospitals.id))
    .where(includePlatformAudit ? or(isNull(auditLogs.hospitalId), inArray(auditLogs.hospitalId, auditHospitalIds)) : inArray(auditLogs.hospitalId, auditHospitalIds))
    .orderBy(desc(auditLogs.createdAt))
    .limit(100) : [];
  return {
    roles: roleRows.map((role) => ({
      id: role.id,
      hospitalId: role.hospitalId,
      name: role.name,
      code: role.code,
      description: role.description,
      dataScope: dataScopeLabels[role.dataScope],
      memberCount: memberCounts[role.id] ?? 0,
      builtIn: role.builtin,
      permissions: grantsByRole[role.id] ?? [],
    })),
    members: memberRows.map((member) => ({
      ...member,
      departmentScope: JSON.parse(member.departmentScope || "[]") as string[],
      status: member.status === "active" ? "正常" : member.status === "pending" ? "待激活" : "已停用",
      lastLogin: member.lastLogin ? new Date(member.lastLogin).toLocaleString("zh-CN", { hour12: false }) : "尚未登录",
    })),
    auditPolicies: Object.fromEntries(policyRows.map((policy) => [policy.hospitalId, policy])),
    auditEvents: auditRows.map((event) => ({
      time: event.time,
      actor: event.actor ?? "系统",
      hospital: event.hospital ?? "全平台",
      action: event.action,
      target: event.target || "—",
      result: event.result === "allowed" ? "成功" : "已拒绝",
    })),
  };
}

async function currentAccountContext(email: string, displayName: string) {
  const db = await getDb();
  const account = await resolveSsoAccount({ email, displayName });
  if (!account || account.status !== "active") return null;

  const [existingMembership] = await db.select({ id: hospitalMemberships.id })
    .from(hospitalMemberships)
    .where(eq(hospitalMemberships.accountId, account.id))
    .limit(1);
  const bootstrapAdminEmail = await getBootstrapAdminEmail();
  if (!existingMembership && bootstrapAdminEmail && account.email === bootstrapAdminEmail) {
    for (const hospital of hospitalSeeds) {
      await db.insert(hospitalMemberships).values({
        id: `membership-${crypto.randomUUID()}`,
        accountId: account.id,
        hospitalId: hospital.id,
        roleId: "role-platform-admin",
        departmentScope: "[]",
        status: "active",
      }).onConflictDoNothing();
    }
    await db.insert(auditLogs).values({ actorAccountId: account.id, action: "bootstrap_owner", resourceType: "platform", resourceId: "default", result: "allowed", detail: "首个已认证访问者初始化为平台管理员" });
  }

  const activationTime = new Date().toISOString();
  await db.update(hospitalMemberships).set({ status: "active", updatedAt: activationTime }).where(and(
    eq(hospitalMemberships.accountId, account.id),
    eq(hospitalMemberships.status, "pending"),
    or(isNull(hospitalMemberships.validUntil), gte(hospitalMemberships.validUntil, activationTime)),
  ));
  const memberships = await db
    .select({
      membershipId: hospitalMemberships.id,
      hospitalId: hospitals.id,
      hospitalCode: hospitals.code,
      hospitalName: hospitals.name,
      hospitalShortName: hospitals.shortName,
      hospitalLevel: hospitals.level,
      hospitalCategory: hospitals.category,
      hospitalAssetCodePrefix: hospitals.assetCodePrefix,
      hospitalRegion: hospitals.region,
      roleId: roles.id,
      roleCode: roles.code,
      roleName: roles.name,
      dataScope: roles.dataScope,
      departmentScope: hospitalMemberships.departmentScope,
    })
    .from(hospitalMemberships)
    .innerJoin(hospitals, eq(hospitalMemberships.hospitalId, hospitals.id))
    .innerJoin(roles, eq(hospitalMemberships.roleId, roles.id))
    .where(and(eq(hospitalMemberships.accountId, account.id), eq(hospitalMemberships.status, "active"), eq(hospitals.status, "active")));

  if (!memberships.length) return null;

  const roleIds = [...new Set(memberships.map((membership) => membership.roleId))];
  const granted = roleIds.length
    ? await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, roleIds))
    : [];
  const permissionByRole = granted.reduce<Record<string, string[]>>((result, item) => {
    (result[item.roleId] ??= []).push(item.permissionCode);
    return result;
  }, {});

  return {
    account: { id: account.id, email: account.email, displayName: account.displayName },
    memberships: memberships.map((membership) => ({
      ...membership,
      departmentScope: JSON.parse(membership.departmentScope || "[]") as string[],
      permissions: permissionByRole[membership.roleId] ?? [],
    })),
  };
}

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("D1 binding") || message.includes("no such table")) {
    return Response.json({ error: "tenant_store_unavailable" }, { status: 503 });
  }
  return Response.json({ error: "tenant_context_failed" }, { status: 500 });
}

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try {
    user = await requireAppSession(request);
  } catch (error) {
    return appSessionError(error);
  }
  try {
    await ensureBaseCatalog();
    const context = await currentAccountContext(user.email, user.displayName);
    if (!context) {
      const db = await getDb();
      await db.insert(auditLogs).values({ action: "tenant_context", resourceType: "account", resourceId: user.email.toLowerCase(), result: "denied", detail: "账号未配置医院成员关系或已停用" });
      return Response.json({ error: "account_not_provisioned" }, { status: 403 });
    }
    const platformAdmin = context.memberships.some((membership) => membership.roleId === PLATFORM_ADMIN_ROLE_ID);
    const manageHospitalIds = context.memberships.filter((membership) => platformAdmin || membership.permissions.includes("member.manage")).map((membership) => membership.hospitalId);
    const auditHospitalIds = context.memberships.filter((membership) => platformAdmin || membership.permissions.includes("audit.view") || membership.permissions.includes("member.manage")).map((membership) => membership.hospitalId);
    const catalog = await accessConfigurationCatalog(manageHospitalIds, auditHospitalIds, platformAdmin);
    return Response.json({ ...context, accessCatalog: catalog });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    return appSessionError(error);
  }
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try {
    user = await requireAppSession(request);
  } catch (error) {
    return appSessionError(error);
  }
  try {
    await ensureBaseCatalog();
    const actorContext = await currentAccountContext(user.email, user.displayName);
    if (!actorContext) return Response.json({ error: "account_not_provisioned" }, { status: 403 });
    const payload = await request.json() as {
      action?: "invite_member" | "create_hospital" | "update_hospital" | "update_member_status" | "save_role" | "save_audit_policy" | "set_member_credential";
      hospitalId?: string;
      email?: string;
      displayName?: string;
      username?: string;
      password?: string;
      roleId?: string;
      departmentScope?: string[];
      code?: string;
      name?: string;
      shortName?: string;
      level?: string;
      category?: string;
      assetCodePrefix?: string;
      region?: string;
      status?: "active" | "disabled" | "pending";
      roleCode?: string;
      roleName?: string;
      roleDescription?: string;
      dataScope?: "platform" | "hospital" | "department" | "self";
      permissionCodes?: string[];
      retentionDays?: number;
      reviewCycleMonths?: number;
      invitationExpiryDays?: number;
      denialAlertThreshold?: number;
      exportFormat?: "csv" | "xlsx";
    };
    const actorIsPlatformAdmin = actorContext.memberships.some((membership) => membership.roleId === PLATFORM_ADMIN_ROLE_ID);
    const db = await getDb();

    if (payload.action === "invite_member") {
      const hospitalId = payload.hospitalId?.trim() ?? "";
      const email = payload.email?.trim().toLowerCase() ?? "";
      const displayName = payload.displayName?.trim() ?? "";
      const roleId = payload.roleId?.trim() ?? "";
      const actorMayManage = actorIsPlatformAdmin || actorContext.memberships.some((membership) => membership.hospitalId === hospitalId && membership.permissions.includes("member.manage"));
      if (!actorMayManage) return Response.json({ error: "permission_denied" }, { status: 403 });
      if (!hospitalId || !email.includes("@") || !displayName || !roleId) return Response.json({ error: "invalid_member" }, { status: 400 });
      if (email === actorContext.account.email) return Response.json({ error: "self_assignment_denied" }, { status: 400 });
      const [hospital] = await db.select().from(hospitals).where(and(eq(hospitals.id, hospitalId), eq(hospitals.status, "active"))).limit(1);
      const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
      if (!hospital || !role || (role.hospitalId && role.hospitalId !== hospitalId) || (role.id === PLATFORM_ADMIN_ROLE_ID && !actorIsPlatformAdmin)) return Response.json({ error: "invalid_scope" }, { status: 400 });
      if (role.dataScope === "department" && !(payload.departmentScope ?? []).length) return Response.json({ error: "department_scope_required" }, { status: 400 });
      if (!actorIsPlatformAdmin) {
        const actorMembership = actorContext.memberships.find((membership) => membership.hospitalId === hospitalId);
        const actorPermissions = new Set(actorMembership?.permissions ?? []);
        const targetRolePermissions = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, role.id));
        if (targetRolePermissions.some((permission) => !actorPermissions.has(permission.permissionCode))) return Response.json({ error: "role_escalation_denied" }, { status: 403 });
      }

      await db.insert(accounts).values({ id: `acct-${crypto.randomUUID()}`, email, displayName, status: "active" })
        .onConflictDoUpdate({ target: accounts.email, set: { displayName, ...(actorIsPlatformAdmin ? { status: "active" as const } : {}), updatedAt: new Date().toISOString() } });
      const [targetAccount] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
      const [existingMembership] = await db.select().from(hospitalMemberships).where(and(eq(hospitalMemberships.accountId, targetAccount.id), eq(hospitalMemberships.hospitalId, hospitalId))).limit(1);
      const [policy] = await db.select().from(auditPolicies).where(eq(auditPolicies.hospitalId, hospitalId)).limit(1);
      const validUntil = new Date(Date.now() + (policy?.invitationExpiryDays ?? 7) * 86_400_000).toISOString();
      if (existingMembership) {
        await db.update(hospitalMemberships).set({ roleId, departmentScope: JSON.stringify(payload.departmentScope ?? []), updatedAt: new Date().toISOString() }).where(eq(hospitalMemberships.id, existingMembership.id));
      } else {
        await db.insert(hospitalMemberships).values({ id: `membership-${crypto.randomUUID()}`, accountId: targetAccount.id, hospitalId, roleId, departmentScope: JSON.stringify(payload.departmentScope ?? []), status: "pending", validUntil });
      }
      await db.insert(auditLogs).values({ hospitalId, actorAccountId: actorContext.account.id, action: "invite_member", resourceType: "account", resourceId: targetAccount.id, result: "allowed", detail: `${role.code}:${email}` });
      return Response.json({ member: { email, displayName, hospitalId, roleId, status: existingMembership?.status ?? "pending", validUntil: existingMembership?.validUntil ?? validUntil } }, { status: existingMembership ? 200 : 201 });
    }

    if (payload.action === "create_hospital") {
      if (!actorIsPlatformAdmin) return Response.json({ error: "permission_denied" }, { status: 403 });
      const code = payload.code?.trim().toUpperCase() ?? "";
      const name = payload.name?.trim() ?? "";
      if (!code || !name) return Response.json({ error: "invalid_hospital" }, { status: 400 });
      const hospitalId = `hosp-${crypto.randomUUID()}`;
      const [hospital] = await db.insert(hospitals).values({ id: hospitalId, code, name, shortName: payload.shortName?.trim() || name, level: payload.level?.trim() || "未定级", category: payload.category?.trim() || "未设置", assetCodePrefix: normalizeAssetCodePrefix(payload.assetCodePrefix ?? ""), region: payload.region?.trim() || "未设置", status: "active" }).returning();
      await db.insert(auditPolicies).values({ hospitalId }).onConflictDoNothing();
      await db.insert(hospitalMemberships).values({ id: `membership-${crypto.randomUUID()}`, accountId: actorContext.account.id, hospitalId, roleId: "role-platform-admin", departmentScope: "[]", status: "active" });
      await db.insert(auditLogs).values({ hospitalId, actorAccountId: actorContext.account.id, action: "create_hospital", resourceType: "hospital", resourceId: hospitalId, result: "allowed", detail: code });
      return Response.json({ hospital }, { status: 201 });
    }

    if (payload.action === "update_hospital") {
      if (!actorIsPlatformAdmin) return Response.json({ error: "permission_denied" }, { status: 403 });
      const hospitalId = payload.hospitalId?.trim() ?? "";
      const name = payload.name?.trim() ?? "";
      if (!hospitalId || !name) return Response.json({ error: "invalid_hospital" }, { status: 400 });
      const [hospital] = await db.update(hospitals).set({
        name,
        shortName: payload.shortName?.trim() || name,
        level: payload.level?.trim() || "未定级",
        category: payload.category?.trim() || "未设置",
        assetCodePrefix: normalizeAssetCodePrefix(payload.assetCodePrefix ?? ""),
        region: payload.region?.trim() || "未设置",
        status: payload.status === "disabled" ? "disabled" : "active",
        updatedAt: new Date().toISOString(),
      }).where(eq(hospitals.id, hospitalId)).returning();
      if (!hospital) return Response.json({ error: "hospital_not_found" }, { status: 404 });
      await db.insert(auditLogs).values({ hospitalId, actorAccountId: actorContext.account.id, action: "update_hospital", resourceType: "hospital", resourceId: hospitalId, result: "allowed", detail: `${hospital.code}:${hospital.status}` });
      return Response.json({ hospital });
    }

    if (payload.action === "update_member_status") {
      const hospitalId = payload.hospitalId?.trim() ?? "";
      const email = payload.email?.trim().toLowerCase() ?? "";
      const actorMayManage = actorIsPlatformAdmin || actorContext.memberships.some((membership) => membership.hospitalId === hospitalId && membership.permissions.includes("member.manage"));
      if (!actorMayManage) return Response.json({ error: "permission_denied" }, { status: 403 });
      const [targetAccount] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
      if (!targetAccount || targetAccount.id === actorContext.account.id) return Response.json({ error: "invalid_member" }, { status: 400 });
      const [targetMembership] = await db.select().from(hospitalMemberships).where(and(eq(hospitalMemberships.accountId, targetAccount.id), eq(hospitalMemberships.hospitalId, hospitalId))).limit(1);
      if (!targetMembership) return Response.json({ error: "membership_not_found" }, { status: 404 });
      if (!actorIsPlatformAdmin) {
        const actorMembership = actorContext.memberships.find((membership) => membership.hospitalId === hospitalId);
        const actorPermissions = new Set(actorMembership?.permissions ?? []);
        const targetRolePermissions = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, targetMembership.roleId));
        if (targetRolePermissions.some((permission) => !actorPermissions.has(permission.permissionCode))) return Response.json({ error: "role_escalation_denied" }, { status: 403 });
      }
      const status = payload.status === "active" ? "active" : payload.status === "pending" ? "pending" : "disabled";
      await db.update(hospitalMemberships).set({ status, updatedAt: new Date().toISOString() }).where(eq(hospitalMemberships.id, targetMembership.id));
      await db.insert(auditLogs).values({ hospitalId, actorAccountId: actorContext.account.id, action: "update_member_status", resourceType: "account", resourceId: targetAccount.id, result: "allowed", detail: `${email}:${status}` });
      return Response.json({ member: { email, hospitalId, status } });
    }

    if (payload.action === "save_role") {
      const hospitalId = payload.hospitalId?.trim() ?? "";
      const actorMayManage = actorIsPlatformAdmin || actorContext.memberships.some((membership) => membership.hospitalId === hospitalId && membership.permissions.includes("member.manage"));
      if (!actorMayManage) return Response.json({ error: "permission_denied" }, { status: 403 });
      const roleCode = payload.roleCode?.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_") ?? "";
      const roleName = payload.roleName?.trim() ?? "";
      const dataScope = payload.dataScope ?? "hospital";
      const allowedPermissions = new Set(permissionSeeds.map(([code]) => code));
      const permissionCodes = [...new Set(payload.permissionCodes ?? [])].filter((code) => allowedPermissions.has(code as typeof permissionSeeds[number][0]));
      if (!hospitalId || !roleCode || !roleName || !permissionCodes.length) return Response.json({ error: "invalid_role" }, { status: 400 });
      let roleId = payload.roleId?.trim() ?? "";
      if (roleId === PLATFORM_ADMIN_ROLE_ID) return Response.json({ error: "role_not_editable" }, { status: 400 });
      if (RESERVED_ROLE_CODES.has(roleCode as typeof roleSeeds[number]["code"])) {
        return Response.json({ error: "reserved_role_code" }, { status: 400 });
      }
      if (!actorIsPlatformAdmin) {
        const actorMembership = actorContext.memberships.find((membership) => membership.hospitalId === hospitalId);
        const actorPermissions = new Set(actorMembership?.permissions ?? []);
        if (permissionCodes.some((permission) => !actorPermissions.has(permission))) return Response.json({ error: "role_escalation_denied" }, { status: 403 });
      }
      if (roleId) {
        const [existingRole] = await db.select().from(roles).where(and(eq(roles.id, roleId), eq(roles.hospitalId, hospitalId), eq(roles.builtin, false))).limit(1);
        if (!existingRole) return Response.json({ error: "role_not_editable" }, { status: 400 });
        await db.update(roles).set({ code: roleCode, name: roleName, description: payload.roleDescription?.trim() || "", dataScope }).where(eq(roles.id, roleId));
      } else {
        roleId = `role-${crypto.randomUUID()}`;
        await db.insert(roles).values({ id: roleId, hospitalId, code: roleCode, name: roleName, description: payload.roleDescription?.trim() || "", dataScope, builtin: false });
      }
      await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      for (const permissionCode of permissionCodes) await db.insert(rolePermissions).values({ roleId, permissionCode });
      await db.insert(auditLogs).values({ hospitalId, actorAccountId: actorContext.account.id, action: "save_role", resourceType: "role", resourceId: roleId, result: "allowed", detail: `${roleCode}:${permissionCodes.join(",")}` });
      return Response.json({ role: { id: roleId, hospitalId, code: roleCode, name: roleName, description: payload.roleDescription?.trim() || "", dataScope: dataScopeLabels[dataScope], builtin: false, permissions: permissionCodes } });
    }

    if (payload.action === "set_member_credential") {
      const hospitalId = payload.hospitalId?.trim() ?? "";
      const email = payload.email?.trim().toLowerCase() ?? "";
      const username = payload.username?.trim() ?? "";
      const password = payload.password ?? "";
      const actorMayManage = actorIsPlatformAdmin || actorContext.memberships.some((membership) => membership.hospitalId === hospitalId && membership.permissions.includes("member.manage"));
      if (!actorMayManage) return Response.json({ error: "permission_denied" }, { status: 403 });
      if (!hospitalId || !email || !username || !password) return Response.json({ error: "invalid_credential_request" }, { status: 400 });
      const [targetAccount] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
      if (!targetAccount) return Response.json({ error: "invalid_member" }, { status: 400 });
      const [targetMembership] = await db.select().from(hospitalMemberships).where(and(eq(hospitalMemberships.accountId, targetAccount.id), eq(hospitalMemberships.hospitalId, hospitalId))).limit(1);
      if (!targetMembership) return Response.json({ error: "membership_not_found" }, { status: 404 });
      // 重置他人密码等同接管账号：目标角色权限超出操作者时按越权拒绝。
      if (!actorIsPlatformAdmin && targetAccount.id !== actorContext.account.id) {
        const actorMembership = actorContext.memberships.find((membership) => membership.hospitalId === hospitalId);
        const actorPermissions = new Set(actorMembership?.permissions ?? []);
        const targetRolePermissions = await db.select().from(rolePermissions).where(eq(rolePermissions.roleId, targetMembership.roleId));
        if (targetRolePermissions.some((permission) => !actorPermissions.has(permission.permissionCode))) return Response.json({ error: "role_escalation_denied" }, { status: 403 });
      }
      const credential = await upsertAccountCredential({
        accountId: targetAccount.id,
        username,
        password,
        mustChangePassword: targetAccount.id !== actorContext.account.id,
      });
      await db.insert(auditLogs).values({ hospitalId, actorAccountId: actorContext.account.id, action: "set_member_credential", resourceType: "account", resourceId: targetAccount.id, result: "allowed", detail: `${email}→${credential.username}` });
      return Response.json({ credential: { email, username: credential.username, mustChangePassword: targetAccount.id !== actorContext.account.id } });
    }

    if (payload.action === "save_audit_policy") {
      const hospitalId = payload.hospitalId?.trim() ?? "";
      const actorMayManage = actorIsPlatformAdmin || actorContext.memberships.some((membership) => membership.hospitalId === hospitalId && membership.permissions.includes("member.manage"));
      if (!actorMayManage) return Response.json({ error: "permission_denied" }, { status: 403 });
      const policy = {
        hospitalId,
        retentionDays: Math.min(3650, Math.max(90, Number(payload.retentionDays) || 365)),
        reviewCycleMonths: Math.min(12, Math.max(1, Number(payload.reviewCycleMonths) || 3)),
        invitationExpiryDays: Math.min(30, Math.max(1, Number(payload.invitationExpiryDays) || 7)),
        denialAlertThreshold: Math.min(100, Math.max(1, Number(payload.denialAlertThreshold) || 5)),
        exportFormat: payload.exportFormat === "xlsx" ? "xlsx" as const : "csv" as const,
        updatedAt: new Date().toISOString(),
      };
      await db.insert(auditPolicies).values(policy).onConflictDoUpdate({ target: auditPolicies.hospitalId, set: policy });
      await db.insert(auditLogs).values({ hospitalId, actorAccountId: actorContext.account.id, action: "save_audit_policy", resourceType: "audit_policy", resourceId: hospitalId, result: "allowed", detail: `${policy.retentionDays}d/${policy.reviewCycleMonths}m` });
      return Response.json({ policy });
    }

    return Response.json({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    if (error instanceof PasswordAuthError) return passwordAuthError(error);
    return routeError(error);
  }
}
