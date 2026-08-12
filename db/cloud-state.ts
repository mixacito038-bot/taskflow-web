import { and, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "./index";
import {
  accounts,
  hospitalMemberships,
  hospitals,
  rolePermissions,
  roles,
} from "./schema";

export const cloudResourceNames = [
  "devices",
  "costEntries",
  "improvementActions",
  "modules",
  "dataSources",
  "analysisProfiles",
  "ledgerFields",
  "metricDictionary",
  "metricCategories",
  "deviceReports",
  "reportFields",
  "chartTemplates",
  "metricCockpit",
] as const;

export type CloudResourceName = (typeof cloudResourceNames)[number];

export type CloudSharedState = Record<CloudResourceName, unknown[]>;
export type CloudResourceRevisions = Record<CloudResourceName, number>;

export type CloudPreferences = {
  theme: "clinical" | "teal" | "midnight";
  density: "comfortable" | "compact";
  contentZoom: number;
  activeHospitalId: string;
  department: string;
  period: string;
  perspective: "管理层" | "设备科" | "临床科室";
};

const PLATFORM_ADMIN_ROLE_ID = "role-platform-admin";

const resourcePermission: Record<CloudResourceName, string> = {
  devices: "equipment.manage",
  costEntries: "cost.manage",
  improvementActions: "improvement.manage",
  modules: "member.manage",
  dataSources: "source.manage",
  analysisProfiles: "source.manage",
  // 台账列定义决定设备台账长什么样，跟着设备台账的管理权限走
  ledgerFields: "equipment.manage",
  // 指标口径属于文件/口径治理范畴，跟着数据源管理权限走
  metricDictionary: "source.manage",
  metricCategories: "source.manage",
  // 填报记录与填报字段都属于成本/业务量填报职责
  deviceReports: "cost.manage",
  reportFields: "cost.manage",
  // 图表模板与字典驾驶舱配置跟着驾驶舱配置权限走（与 modules 一致）
  chartTemplates: "member.manage",
  metricCockpit: "member.manage",
};

const resourceReadPermissions: Record<CloudResourceName, readonly string[]> = {
  devices: ["dashboard.view", "equipment.manage", "improvement.manage", "report.manage", "report.review", "report.approve", "report.export"],
  costEntries: ["cost.manage"],
  improvementActions: ["improvement.manage"],
  modules: ["dashboard.view", "member.manage"],
  dataSources: ["source.manage", "report.manage", "report.review", "report.approve", "report.export"],
  analysisProfiles: ["source.manage", "report.manage", "report.review", "report.approve", "report.export"],
  // 能看设备台账的都要能读列定义，否则表格会缺列
  ledgerFields: ["dashboard.view", "equipment.manage", "improvement.manage", "report.manage", "report.review", "report.approve", "report.export"],
  // 指标字典是全院公开口径，能看分析页面的都要能读，否则表格会缺行
  metricDictionary: ["dashboard.view", "source.manage", "report.manage", "report.review", "report.approve", "report.export"],
  metricCategories: ["dashboard.view", "source.manage", "report.manage", "report.review", "report.approve", "report.export"],
  // 字典驾驶舱要用填报数据算数，能看驾驶舱的都要能读，否则看板全是空卡
  deviceReports: ["dashboard.view", "cost.manage", "improvement.manage", "report.manage", "report.review", "report.approve", "report.export"],
  reportFields: ["dashboard.view", "cost.manage", "improvement.manage", "report.manage", "report.review", "report.approve", "report.export"],
  chartTemplates: ["dashboard.view", "member.manage"],
  metricCockpit: ["dashboard.view", "member.manage"],
};

export function emptySharedState(): CloudSharedState {
  return {
    devices: [],
    costEntries: [],
    improvementActions: [],
    ledgerFields: [],
    metricDictionary: [],
    metricCategories: [],
    modules: [],
    dataSources: [],
    analysisProfiles: [],
    deviceReports: [],
    reportFields: [],
    chartTemplates: [],
    metricCockpit: [],
  };
}

export function emptyResourceRevisions(): CloudResourceRevisions {
  return Object.fromEntries(cloudResourceNames.map((resource) => [resource, 0])) as CloudResourceRevisions;
}

export function normalizeResourceRevision(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 1 ? Number(value) : 1;
}

export function defaultCloudPreferences(hospitalId: string): CloudPreferences {
  return {
    theme: "clinical",
    density: "comfortable",
    contentZoom: 1.1,
    activeHospitalId: hospitalId,
    department: "全部科室",
    period: "2026年度",
    perspective: "管理层",
  };
}

export function parseStoredJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function getCloudStateAccess(email: string, hospitalId: string) {
  const db = await getDb();
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.email, email.trim().toLowerCase()))
    .limit(1);
  if (!account || account.status !== "active") return null;

  const now = new Date().toISOString();
  const memberships = await db
    .select({
      hospitalId: hospitalMemberships.hospitalId,
      roleId: hospitalMemberships.roleId,
      roleCode: roles.code,
      dataScope: roles.dataScope,
      departmentScope: hospitalMemberships.departmentScope,
    })
    .from(hospitalMemberships)
    .innerJoin(roles, eq(hospitalMemberships.roleId, roles.id))
    .innerJoin(hospitals, eq(hospitalMemberships.hospitalId, hospitals.id))
    .where(and(
      eq(hospitalMemberships.accountId, account.id),
      eq(hospitalMemberships.status, "active"),
      eq(hospitals.status, "active"),
      or(isNull(hospitalMemberships.validUntil), gte(hospitalMemberships.validUntil, now)),
    ));

  // Platform authority is bound to the immutable built-in role id. Custom
  // role codes are editable and must never be treated as a trust boundary.
  const platformAdmin = memberships.some((membership) => membership.roleId === PLATFORM_ADMIN_ROLE_ID);
  const scopedMembership = memberships.find((membership) => membership.hospitalId === hospitalId);
  if (!platformAdmin && !scopedMembership) return null;

  if (platformAdmin && !scopedMembership) {
    const [hospital] = await db
      .select({ id: hospitals.id })
      .from(hospitals)
      .where(and(eq(hospitals.id, hospitalId), eq(hospitals.status, "active")))
      .limit(1);
    if (!hospital) return null;
  }

  const scopedRoleIds = platformAdmin
    ? [...new Set(memberships.map((membership) => membership.roleId))]
    : scopedMembership ? [scopedMembership.roleId] : [];
  const grants = scopedRoleIds.length
    ? await db.select().from(rolePermissions).where(inArray(rolePermissions.roleId, scopedRoleIds))
    : [];

  const rawDepartmentScope = parseStoredJson<unknown>(scopedMembership?.departmentScope, []);
  const departmentScope = Array.isArray(rawDepartmentScope)
    ? [...new Set(rawDepartmentScope
      .filter((department): department is string => typeof department === "string")
      .map((department) => department.trim())
      .filter(Boolean))]
    : [];
  return {
    account,
    platformAdmin,
    permissions: new Set(grants.map((grant) => grant.permissionCode)),
    dataScope: platformAdmin ? "platform" as const : (scopedMembership?.dataScope ?? "self"),
    departmentScope: platformAdmin ? [] : departmentScope,
  };
}

export function mayReadCloudResource(
  access: NonNullable<Awaited<ReturnType<typeof getCloudStateAccess>>>,
  resource: CloudResourceName,
) {
  return access.platformAdmin || resourceReadPermissions[resource]
    .some((permission) => access.permissions.has(permission));
}

export function mayWriteCloudResource(
  access: NonNullable<Awaited<ReturnType<typeof getCloudStateAccess>>>,
  resource: CloudResourceName,
) {
  return access.platformAdmin || access.permissions.has(resourcePermission[resource]);
}

export function mayBootstrapCloudState(
  access: NonNullable<Awaited<ReturnType<typeof getCloudStateAccess>>>,
) {
  return access.platformAdmin || access.permissions.has("member.manage");
}

export async function mayUseHospital(accountId: string, hospitalId: string, platformAdmin: boolean) {
  const db = await getDb();
  const now = new Date().toISOString();
  const [hospital] = await db
    .select({ id: hospitals.id })
    .from(hospitals)
    .where(and(eq(hospitals.id, hospitalId), eq(hospitals.status, "active")))
    .limit(1);
  if (!hospital) return false;
  if (platformAdmin) return true;
  const [membership] = await db
    .select({ id: hospitalMemberships.id })
    .from(hospitalMemberships)
    .where(and(
      eq(hospitalMemberships.accountId, accountId),
      eq(hospitalMemberships.hospitalId, hospitalId),
      eq(hospitalMemberships.status, "active"),
      or(isNull(hospitalMemberships.validUntil), gte(hospitalMemberships.validUntil, now)),
    ))
    .limit(1);
  return Boolean(membership);
}
