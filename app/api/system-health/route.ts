import { desc, eq, sql } from "drizzle-orm";
import { appSessionError, requireAppSession } from "../../../db/account-security";
import { cloudResourceNames, getCloudStateAccess, parseStoredJson } from "../../../db/cloud-state";
import { getDb } from "../../../db";
import {
  auditLogs,
  auditPolicies,
  benefitReports,
  hospitalCloudResources,
  hospitalMemberships,
  hospitals,
  reportArtifacts,
  reportEvents,
  reportTemplates,
  roles,
} from "../../../db/schema";

export const dynamic = "force-dynamic";

type R2ObjectMetadataLike = {
  key: string;
  size: number;
};

type R2BucketLike = {
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects: R2ObjectMetadataLike[] }>;
  head(key: string): Promise<R2ObjectMetadataLike | null>;
};

type HealthStatus = "pass" | "warning" | "fail" | "pending";

const resourceLabels = {
  devices: "设备台账",
  costEntries: "成本记录",
  notifications: "医院消息",
  improvementActions: "改进行动",
  modules: "驾驶舱布局",
  dataSources: "数据源配置",
  analysisProfiles: "采集分析配置",
} as const;

const sensitiveKeyPattern = /(?:password|passwd|pwd|secret|token|authorization|api[_-]?key|credential|private[_-]?key|client[_-]?secret|access[_-]?key|connection[_-]?string|cookie)/i;
const maximumBackupBytes = 20 * 1024 * 1024;
const textEncoder = new TextEncoder();

function validateHospitalId(value: string | null) {
  const hospitalId = value?.trim() ?? "";
  return /^[a-zA-Z0-9_-]{1,128}$/.test(hospitalId) ? hospitalId : "";
}

function utf8Bytes(value: string) {
  return textEncoder.encode(value).byteLength;
}

function toCount(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function latestTimestamp(...values: Array<string | null | undefined>) {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function redactText(value: string) {
  return value
    .replace(/(https?:\/\/)[^:@/\s]+:[^@/\s]+@/gi, "$1[credentials-removed]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [removed]")
    .replace(/\b([A-Z0-9._%+-])[A-Z0-9._%+-]*@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi, "$1***@$2");
}

function withoutSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSensitiveValues);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !sensitiveKeyPattern.test(key))
        .map(([key, item]) => [key, withoutSensitiveValues(item)]),
    );
  }
  return typeof value === "string" ? redactText(value) : value;
}

async function getReportBucket() {
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as { REPORT_FILES?: R2BucketLike };
  if (!runtimeEnv.REPORT_FILES) throw new Error("R2 binding REPORT_FILES is unavailable");
  return runtimeEnv.REPORT_FILES;
}

async function requireHospitalAdministrator(email: string, hospitalId: string) {
  const access = await getCloudStateAccess(email, hospitalId);
  if (!access || (!access.platformAdmin && !access.permissions.has("member.manage"))) return null;
  return access;
}

async function collectHospitalOverview(hospitalId: string) {
  const db = await getDb();
  const [
    hospitalRows,
    resourceRows,
    reportAggregateRows,
    reportStatusRows,
    artifactAggregateRows,
    artifactSampleRows,
    templateAggregateRows,
    eventAggregateRows,
    auditAggregateRows,
    membershipAggregateRows,
  ] = await Promise.all([
    db.select({
      id: hospitals.id,
      code: hospitals.code,
      name: hospitals.name,
      shortName: hospitals.shortName,
      level: hospitals.level,
      region: hospitals.region,
      status: hospitals.status,
      updatedAt: hospitals.updatedAt,
    }).from(hospitals).where(eq(hospitals.id, hospitalId)).limit(1),
    db.select({
      resource: hospitalCloudResources.resource,
      valueJson: hospitalCloudResources.valueJson,
      schemaVersion: hospitalCloudResources.schemaVersion,
      updatedAt: hospitalCloudResources.updatedAt,
    }).from(hospitalCloudResources).where(eq(hospitalCloudResources.hospitalId, hospitalId)),
    db.select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(
        length(cast(${benefitReports.title} as blob))
        + length(cast(${benefitReports.period} as blob))
        + length(cast(${benefitReports.configJson} as blob))
        + length(cast(${benefitReports.snapshotJson} as blob))
        + length(cast(${benefitReports.reviewComment} as blob))
      ), 0)`,
      latestAt: sql<string | null>`max(${benefitReports.updatedAt})`,
      issued: sql<number>`coalesce(sum(case when ${benefitReports.status} = 'issued' then 1 else 0 end), 0)`,
    }).from(benefitReports).where(eq(benefitReports.hospitalId, hospitalId)),
    db.select({
      status: benefitReports.status,
      count: sql<number>`count(*)`,
    }).from(benefitReports)
      .where(eq(benefitReports.hospitalId, hospitalId))
      .groupBy(benefitReports.status),
    db.select({
      count: sql<number>`count(*)`,
      metadataBytes: sql<number>`coalesce(sum(
        length(cast(${reportArtifacts.fileName} as blob))
        + length(cast(${reportArtifacts.contentType} as blob))
        + length(cast(${reportArtifacts.sha256} as blob))
      ), 0)`,
      fileBytes: sql<number>`coalesce(sum(${reportArtifacts.sizeBytes}), 0)`,
      latestAt: sql<string | null>`max(${reportArtifacts.createdAt})`,
    }).from(reportArtifacts).where(eq(reportArtifacts.hospitalId, hospitalId)),
    db.select({
      fileKey: reportArtifacts.fileKey,
      sizeBytes: reportArtifacts.sizeBytes,
    }).from(reportArtifacts)
      .where(eq(reportArtifacts.hospitalId, hospitalId))
      .orderBy(desc(reportArtifacts.createdAt))
      .limit(5),
    db.select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(
        length(cast(${reportTemplates.name} as blob))
        + length(cast(${reportTemplates.description} as blob))
        + length(cast(${reportTemplates.configJson} as blob))
      ), 0)`,
      latestAt: sql<string | null>`max(${reportTemplates.updatedAt})`,
    }).from(reportTemplates).where(eq(reportTemplates.hospitalId, hospitalId)),
    db.select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(
        length(cast(${reportEvents.action} as blob))
        + length(cast(${reportEvents.detail} as blob))
      ), 0)`,
      latestAt: sql<string | null>`max(${reportEvents.createdAt})`,
    }).from(reportEvents).where(eq(reportEvents.hospitalId, hospitalId)),
    db.select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(
        length(cast(${auditLogs.action} as blob))
        + length(cast(${auditLogs.resourceType} as blob))
        + length(cast(${auditLogs.resourceId} as blob))
        + length(cast(${auditLogs.detail} as blob))
      ), 0)`,
      latestAt: sql<string | null>`max(${auditLogs.createdAt})`,
    }).from(auditLogs).where(eq(auditLogs.hospitalId, hospitalId)),
    db.select({
      count: sql<number>`count(*)`,
      latestAt: sql<string | null>`max(${hospitalMemberships.updatedAt})`,
    }).from(hospitalMemberships).where(eq(hospitalMemberships.hospitalId, hospitalId)),
  ]);

  const hospital = hospitalRows[0];
  if (!hospital || hospital.status !== "active") return null;

  const resources = cloudResourceNames.map((resource) => {
    const row = resourceRows.find((item) => item.resource === resource);
    const items = row ? parseStoredJson<unknown[]>(row.valueJson, []) : [];
    return {
      resource,
      label: resourceLabels[resource],
      recordCount: Array.isArray(items) ? items.length : 0,
      estimatedBytes: row ? utf8Bytes(row.valueJson) : 0,
      schemaVersion: row?.schemaVersion ?? null,
      updatedAt: row?.updatedAt ?? null,
      initialized: Boolean(row),
    };
  });

  const reportAggregate = reportAggregateRows[0];
  const artifactAggregate = artifactAggregateRows[0];
  const templateAggregate = templateAggregateRows[0];
  const eventAggregate = eventAggregateRows[0];
  const auditAggregate = auditAggregateRows[0];
  const membershipAggregate = membershipAggregateRows[0];
  const cloudResourceBytes = resources.reduce((sum, resource) => sum + resource.estimatedBytes, 0);
  const cloudResourceRecords = resources.reduce((sum, resource) => sum + resource.recordCount, 0);
  const reportCount = toCount(reportAggregate?.count);
  const artifactCount = toCount(artifactAggregate?.count);
  const templateCount = toCount(templateAggregate?.count);
  const eventCount = toCount(eventAggregate?.count);
  const auditCount = toCount(auditAggregate?.count);
  const membershipCount = toCount(membershipAggregate?.count);
  const estimatedD1Bytes = cloudResourceBytes
    + toCount(reportAggregate?.bytes)
    + toCount(artifactAggregate?.metadataBytes)
    + toCount(templateAggregate?.bytes)
    + toCount(eventAggregate?.bytes)
    + toCount(auditAggregate?.bytes);
  const latestSyncAt = latestTimestamp(
    ...resources.map((resource) => resource.updatedAt),
    reportAggregate?.latestAt,
    artifactAggregate?.latestAt,
    templateAggregate?.latestAt,
    eventAggregate?.latestAt,
    auditAggregate?.latestAt,
    membershipAggregate?.latestAt,
  );

  return {
    hospital,
    resources,
    artifactSampleRows,
    totals: {
      recordCount: cloudResourceRecords + reportCount + artifactCount + templateCount + eventCount + auditCount + membershipCount,
      estimatedD1Bytes,
      artifactCount,
      artifactBytes: toCount(artifactAggregate?.fileBytes),
      reportCount,
      issuedReportCount: toCount(reportAggregate?.issued),
      templateCount,
      eventCount,
      auditCount,
      membershipCount,
    },
    reportStatuses: Object.fromEntries(reportStatusRows.map((row) => [row.status, toCount(row.count)])),
    latestSyncAt,
  };
}

async function inspectObjectStorage(
  hospitalId: string,
  artifactRows: Array<{ fileKey: string; sizeBytes: number }>,
) {
  try {
    const bucket = await getReportBucket();
    await bucket.list({ prefix: `reports/${hospitalId}/`, limit: 1 });
    const sampled = await Promise.all(artifactRows.map(async (artifact) => {
      const object = await bucket.head(artifact.fileKey);
      return {
        found: Boolean(object),
        sizeMatches: Boolean(object) && object?.size === artifact.sizeBytes,
      };
    }));
    const missing = sampled.filter((item) => !item.found).length;
    const mismatched = sampled.filter((item) => item.found && !item.sizeMatches).length;
    const status: HealthStatus = missing || mismatched ? "fail" : "pass";
    return {
      status,
      checkedObjects: sampled.length,
      missingObjects: missing,
      mismatchedObjects: mismatched,
      message: sampled.length
        ? status === "pass"
          ? `对象存储可读，抽检 ${sampled.length} 份报告文件均与台账一致`
          : `抽检发现 ${missing} 份文件缺失、${mismatched} 份容量不一致`
        : "对象存储连接正常，当前医院暂无报告文件",
    };
  } catch {
    return {
      status: "fail" as const,
      checkedObjects: 0,
      missingObjects: 0,
      mismatchedObjects: 0,
      message: "对象存储暂不可读，请检查 Sites 的 REPORT_FILES 绑定",
    };
  }
}

function healthChecklist(
  overview: NonNullable<Awaited<ReturnType<typeof collectHospitalOverview>>>,
  storage: Awaited<ReturnType<typeof inspectObjectStorage>> | null,
) {
  const initializedResources = overview.resources.filter((resource) => resource.initialized).length;
  const deviceCount = overview.resources.find((resource) => resource.resource === "devices")?.recordCount ?? 0;
  const latestSyncAge = overview.latestSyncAt
    ? Date.now() - new Date(overview.latestSyncAt).getTime()
    : Number.POSITIVE_INFINITY;
  const checks: Array<{ id: string; label: string; status: HealthStatus; detail: string }> = [
    {
      id: "access",
      label: "医院访问边界",
      status: "pass",
      detail: "当前账号已通过服务端管理员权限与医院范围校验",
    },
    {
      id: "d1",
      label: "云数据库",
      status: "pass",
      detail: `D1 查询正常，已统计 ${overview.totals.recordCount} 条医院业务记录`,
    },
    {
      id: "resources",
      label: "业务资源初始化",
      status: initializedResources === cloudResourceNames.length ? "pass" : "warning",
      detail: `${initializedResources}/${cloudResourceNames.length} 类云端资源已初始化`,
    },
    {
      id: "devices",
      label: "演示业务数据",
      status: deviceCount > 0 ? "pass" : "warning",
      detail: deviceCount > 0 ? `设备台账已有 ${deviceCount} 条记录` : "设备台账为空，现场演示前请先初始化数据",
    },
    {
      id: "sync",
      label: "最近云端同步",
      status: latestSyncAge <= 7 * 24 * 60 * 60 * 1000 ? "pass" : "warning",
      detail: overview.latestSyncAt ? `最近写入 ${overview.latestSyncAt}` : "尚无云端写入时间",
    },
    {
      id: "reports",
      label: "正式报告证据",
      status: overview.totals.issuedReportCount === 0
        ? "warning"
        : overview.totals.artifactCount > 0 ? "pass" : "warning",
      detail: overview.totals.issuedReportCount === 0
        ? "当前尚无已签发报告，演示审批流程时可先准备一份"
        : `${overview.totals.issuedReportCount} 份已签发报告，${overview.totals.artifactCount} 个云端文件`,
    },
    {
      id: "r2",
      label: "报告文件存储",
      status: storage?.status ?? "pending",
      detail: storage?.message ?? "点击“运行云端自检”后验证 R2 文件可读性",
    },
  ];

  const overall: HealthStatus = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "pending")
      ? "pending"
      : checks.some((check) => check.status === "warning") ? "warning" : "pass";
  return { overall, checks };
}

async function buildHospitalBackup(
  hospitalId: string,
  overview: NonNullable<Awaited<ReturnType<typeof collectHospitalOverview>>>,
) {
  const db = await getDb();
  const [
    resourceRows,
    reportRows,
    templateRows,
    eventRows,
    artifactRows,
    policyRows,
    auditRows,
    membershipRows,
  ] = await Promise.all([
    db.select({
      resource: hospitalCloudResources.resource,
      valueJson: hospitalCloudResources.valueJson,
      schemaVersion: hospitalCloudResources.schemaVersion,
      updatedAt: hospitalCloudResources.updatedAt,
    }).from(hospitalCloudResources).where(eq(hospitalCloudResources.hospitalId, hospitalId)),
    db.select({
      id: benefitReports.id,
      seriesId: benefitReports.seriesId,
      version: benefitReports.version,
      status: benefitReports.status,
      title: benefitReports.title,
      period: benefitReports.period,
      scope: benefitReports.scope,
      configJson: benefitReports.configJson,
      snapshotJson: benefitReports.snapshotJson,
      qualityScore: benefitReports.qualityScore,
      blockingCount: benefitReports.blockingCount,
      warningCount: benefitReports.warningCount,
      warningAcknowledged: benefitReports.warningAcknowledged,
      reviewComment: benefitReports.reviewComment,
      submittedAt: benefitReports.submittedAt,
      reviewedAt: benefitReports.reviewedAt,
      issuedAt: benefitReports.issuedAt,
      createdAt: benefitReports.createdAt,
      updatedAt: benefitReports.updatedAt,
    }).from(benefitReports).where(eq(benefitReports.hospitalId, hospitalId)),
    db.select({
      id: reportTemplates.id,
      name: reportTemplates.name,
      description: reportTemplates.description,
      configJson: reportTemplates.configJson,
      isDefault: reportTemplates.isDefault,
      createdAt: reportTemplates.createdAt,
      updatedAt: reportTemplates.updatedAt,
    }).from(reportTemplates).where(eq(reportTemplates.hospitalId, hospitalId)),
    db.select({
      id: reportEvents.id,
      reportId: reportEvents.reportId,
      action: reportEvents.action,
      detail: reportEvents.detail,
      createdAt: reportEvents.createdAt,
    }).from(reportEvents).where(eq(reportEvents.hospitalId, hospitalId)),
    db.select({
      id: reportArtifacts.id,
      reportId: reportArtifacts.reportId,
      fileName: reportArtifacts.fileName,
      contentType: reportArtifacts.contentType,
      sizeBytes: reportArtifacts.sizeBytes,
      sha256: reportArtifacts.sha256,
      createdAt: reportArtifacts.createdAt,
    }).from(reportArtifacts).where(eq(reportArtifacts.hospitalId, hospitalId)),
    db.select().from(auditPolicies).where(eq(auditPolicies.hospitalId, hospitalId)).limit(1),
    db.select({
      id: auditLogs.id,
      action: auditLogs.action,
      resourceType: auditLogs.resourceType,
      resourceId: auditLogs.resourceId,
      result: auditLogs.result,
      detail: auditLogs.detail,
      createdAt: auditLogs.createdAt,
    }).from(auditLogs)
      .where(eq(auditLogs.hospitalId, hospitalId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(2_000),
    db.select({
      roleCode: roles.code,
      roleName: roles.name,
      status: hospitalMemberships.status,
      count: sql<number>`count(*)`,
    }).from(hospitalMemberships)
      .innerJoin(roles, eq(hospitalMemberships.roleId, roles.id))
      .where(eq(hospitalMemberships.hospitalId, hospitalId))
      .groupBy(roles.code, roles.name, hospitalMemberships.status),
  ]);

  const backup = {
    format: "yonghong-hospital-cloud-backup",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: "hospital_business_data",
    hospital: overview.hospital,
    integrity: {
      recordCount: overview.totals.recordCount,
      estimatedD1Bytes: overview.totals.estimatedD1Bytes,
      reportFileCount: overview.totals.artifactCount,
      reportFileBytes: overview.totals.artifactBytes,
    },
    cloudResources: Object.fromEntries(resourceRows.map((row) => [
      row.resource,
      {
        schemaVersion: row.schemaVersion,
        updatedAt: row.updatedAt,
        records: withoutSensitiveValues(parseStoredJson<unknown[]>(row.valueJson, [])),
      },
    ])),
    reports: reportRows.map((row) => ({
      ...row,
      configJson: withoutSensitiveValues(parseStoredJson<unknown>(row.configJson, {})),
      snapshotJson: withoutSensitiveValues(parseStoredJson<unknown>(row.snapshotJson, {})),
      reviewComment: redactText(row.reviewComment),
    })),
    reportTemplates: templateRows.map((row) => ({
      ...row,
      configJson: withoutSensitiveValues(parseStoredJson<unknown>(row.configJson, {})),
    })),
    reportEvents: eventRows.map((row) => ({ ...row, detail: redactText(row.detail) })),
    reportArtifacts: artifactRows,
    auditPolicy: policyRows[0] ?? null,
    auditTrail: auditRows.map((row) => ({ ...row, detail: redactText(row.detail) })),
    accessSummary: membershipRows.map((row) => ({ ...row, count: toCount(row.count) })),
    exclusions: [
      "登录凭据、令牌、密钥和连接字符串",
      "账号个人偏好及成员邮箱",
      "R2 文件二进制内容（reportArtifacts 仅含文件名、容量与校验值）",
    ],
  };
  const json = JSON.stringify(withoutSensitiveValues(backup), null, 2);
  if (utf8Bytes(json) > maximumBackupBytes) {
    return { error: "backup_too_large" as const };
  }
  return { json };
}

function routeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("D1 binding") || message.includes("no such table")) {
    return Response.json({ error: "health_store_unavailable" }, { status: 503 });
  }
  return Response.json({ error: "health_check_failed" }, { status: 500 });
}

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try {
    user = await requireAppSession(request);
  } catch (error) {
    return appSessionError(error);
  }
  const url = new URL(request.url);
  const hospitalId = validateHospitalId(url.searchParams.get("hospitalId"));
  if (!hospitalId) return Response.json({ error: "hospital_required" }, { status: 400 });

  try {
    const access = await requireHospitalAdministrator(user.email, hospitalId);
    if (!access) return Response.json({ error: "permission_denied" }, { status: 403 });
    const overview = await collectHospitalOverview(hospitalId);
    if (!overview) return Response.json({ error: "hospital_not_found" }, { status: 404 });

    if (url.searchParams.get("download") === "backup") {
      const backup = await buildHospitalBackup(hospitalId, overview);
      if ("error" in backup) return Response.json({ error: backup.error }, { status: 413 });
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(backup.json))))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const fileName = `${overview.hospital.code}-cloud-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const db = await getDb();
      await db.insert(auditLogs).values({
        hospitalId,
        actorAccountId: access.account.id,
        action: "download_hospital_backup",
        resourceType: "cloud_backup",
        resourceId: hospitalId,
        result: "allowed",
        detail: `${overview.totals.recordCount} records · SHA-256 ${sha256}`,
      });
      return new Response(backup.json, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${fileName}"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          "x-backup-sha256": sha256,
        },
      });
    }

    const runStorageCheck = url.searchParams.get("check") === "1";
    const storage = runStorageCheck
      ? await inspectObjectStorage(hospitalId, overview.artifactSampleRows)
      : null;
    const health = healthChecklist(overview, storage);
    return Response.json({
      checkedAt: new Date().toISOString(),
      hospital: overview.hospital,
      access: {
        status: "authorized",
        role: access.platformAdmin ? "平台管理员" : "医院管理员",
        dataScope: access.dataScope,
      },
      totals: overview.totals,
      resources: overview.resources,
      reportStatuses: overview.reportStatuses,
      latestSyncAt: overview.latestSyncAt,
      health: {
        performed: runStorageCheck,
        ...health,
        storage,
      },
    }, {
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
