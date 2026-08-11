import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSessionError, assertSameOrigin, requireAppSession } from "../../../db/account-security";
import { getCloudStateAccess } from "../../../db/cloud-state";
import {
  accounts,
  auditLogs,
  benefitReports,
  hospitalCloudResources,
  hospitals,
  reportEvents,
  reportTemplates,
} from "../../../db/schema";
import type { Hospital } from "../../access-control-data";
import type { BenefitAnalysisProfile } from "../../benefit-analysis-config";
import {
  buildBenefitReportModel,
  normalizeBenefitReportConfig,
  type BenefitReportConfig,
  type BenefitReportModel,
  type ReportScope,
} from "../../benefit-report-model";
import { buildReportQuality, buildReportSnapshot, type ReportQualityResult } from "../../report-governance";
import {
  getPlatformTemplate,
  granularityForPeriod,
  templateCategories,
  type TemplatePeriodGranularity,
} from "../../report-template-catalog";
import type { DataSource, Device } from "../../mock-data";

type ReportAction = "save_report" | "submit_report" | "review_report" | "issue_report" | "create_version" | "save_template" | "log_export";

type ReportPayload = {
  action?: ReportAction;
  hospitalId?: string;
  reportId?: string;
  seriesId?: string;
  config?: Record<string, unknown>;
  snapshot?: Record<string, unknown>;
  qualityScore?: number;
  blockingCount?: number;
  warningCount?: number;
  warningAcknowledged?: boolean;
  decision?: "approve" | "reject";
  comment?: string;
  templateName?: string;
  templateDescription?: string;
  templateIsDefault?: boolean;
  exportFormat?: "docx" | "csv";
  artifactHash?: string;
  fileName?: string;
};

function parseJson<T>(value: string, fallback: T) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  if (message.includes("D1 binding") || message.includes("no such table")) {
    return Response.json({ error: "report_store_unavailable" }, { status: 503 });
  }
  return Response.json({ error: "report_operation_failed" }, { status: 500 });
}

async function reportAccess(email: string, hospitalId: string) {
  // Reuse the common hospital boundary so inactive hospitals, expired
  // memberships and the immutable platform-admin role are enforced
  // identically for reports, cloud state and stored files.
  const access = await getCloudStateAccess(email, hospitalId);
  if (!access) return null;
  return {
    account: access.account,
    platformAdmin: access.platformAdmin,
    permissions: access.permissions,
    dataScope: access.dataScope,
    departmentScope: access.departmentScope,
  };
}

type ReportAccess = NonNullable<Awaited<ReturnType<typeof reportAccess>>>;
type StoredReport = typeof benefitReports.$inferSelect;

function may(access: ReportAccess, permission: string) {
  return access.platformAdmin || access.permissions.has(permission);
}

function hasAnyReportPermission(access: ReportAccess) {
  return ["report.manage", "report.review", "report.approve", "report.export"]
    .some((permission) => may(access, permission));
}

function hasFullHospitalDataScope(access: ReportAccess) {
  return access.dataScope === "platform" || access.dataScope === "hospital";
}

function mayReadHospitalReports(access: ReportAccess) {
  // The current ledger and approval workflow are hospital-level records.
  // Department/self-scoped report access stays fail-closed until reports carry
  // a canonical department ownership key across ledger, artifacts and events.
  return hasFullHospitalDataScope(access) && hasAnyReportPermission(access);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deviceVisibleToAccess(device: Record<string, unknown>, access: ReportAccess) {
  if (hasFullHospitalDataScope(access)) return true;
  if (access.dataScope === "self") {
    return [
      device.accountId,
      device.ownerAccountId,
      device.createdByAccountId,
      device.ownerEmail,
      device.email,
    ].some((candidate) => candidate === access.account.id || candidate === access.account.email);
  }
  const department = typeof device.department === "string" ? device.department.trim() : "";
  return Boolean(department) && access.departmentScope.includes(department);
}

function scopeDevicesForAccess(devices: Device[], access: ReportAccess) {
  return hasFullHospitalDataScope(access)
    ? devices
    : devices.filter((device) => deviceVisibleToAccess(device as unknown as Record<string, unknown>, access));
}

function reportVisibleToAccess(report: StoredReport, access: ReportAccess) {
  if (hasFullHospitalDataScope(access)) return true;
  const snapshot = parseJson<unknown>(report.snapshotJson, null);
  if (!isRecord(snapshot) || !Array.isArray(snapshot.rows) || !snapshot.rows.length) return false;
  return snapshot.rows.every((row) => (
    isRecord(row)
    && isRecord(row.device)
    && deviceVisibleToAccess(row.device, access)
  ));
}

function usesFrozenSnapshot(status: string) {
  return status === "pending_review" || status === "approved" || status === "issued";
}

function trustedReportConfig(value: Record<string, unknown>) {
  const config = normalizeBenefitReportConfig(value as Partial<BenefitReportConfig>);
  const platformTemplate = getPlatformTemplate(config.template.baseCode ?? config.template.code);
  if (!platformTemplate) return { error: "unknown_report_template" as const };
  const granularity = granularityForPeriod(config.period);
  if (!granularity || !platformTemplate.supportedPeriods.includes(granularity)) {
    return { error: "unsupported_report_period" as const };
  }
  if (!platformTemplate.supportedScopes.includes(config.scope)) {
    return { error: "unsupported_report_scope" as const };
  }
  const category = templateCategories.find((item) => item.id === platformTemplate.categoryId);
  const periodLabels: Record<TemplatePeriodGranularity, string> = {
    month: "月度",
    quarter: "季度",
    half_year: "半年度",
    year: "年度",
  };
  return {
    config: normalizeBenefitReportConfig({
      ...config,
      template: {
        ...config.template,
        code: platformTemplate.code,
        baseCode: config.template.origin === "hospital" ? platformTemplate.code : config.template.baseCode,
        category: platformTemplate.categoryId,
        categoryLabel: category?.name ?? config.template.categoryLabel,
        sourceDocument: platformTemplate.referenceDocument?.name ?? config.template.sourceDocument,
        fieldPackIds: [...platformTemplate.fieldPackIds],
        sourceRequirementIds: platformTemplate.sourceRequirements.map((item) => item.sourceId),
        requiredSourceRequirementIds: platformTemplate.sourceRequirements
          .filter((item) => item.criticality === "required")
          .map((item) => item.sourceId),
        supportedScopes: [...platformTemplate.supportedScopes] as ReportScope[],
        supportedPeriods: platformTemplate.supportedPeriods.map((item) => periodLabels[item]),
      },
    }),
  };
}

async function buildAuthoritativeReport(
  hospitalId: string,
  rawConfig: Record<string, unknown>,
  access: ReportAccess,
) {
  const validated = trustedReportConfig(rawConfig);
  if ("error" in validated) return validated;
  if (!hasFullHospitalDataScope(access) && validated.config.scope === "hospital") {
    return { error: "report_scope_exceeds_access" as const };
  }
  const db = await getDb();
  const [hospitalRow] = await db.select().from(hospitals).where(eq(hospitals.id, hospitalId)).limit(1);
  if (!hospitalRow || hospitalRow.status !== "active") return { error: "hospital_not_available" as const };
  const resources = await db.select({
    resource: hospitalCloudResources.resource,
    valueJson: hospitalCloudResources.valueJson,
  }).from(hospitalCloudResources).where(and(
    eq(hospitalCloudResources.hospitalId, hospitalId),
    inArray(hospitalCloudResources.resource, ["devices", "dataSources", "analysisProfiles"]),
  ));
  const resourceValue = new Map(resources.map((resource) => [resource.resource, resource.valueJson]));
  const allDevices = parseJson<Device[]>(resourceValue.get("devices") ?? "[]", []);
  const devices = scopeDevicesForAccess(allDevices, access);
  if (
    validated.config.scope === "device"
    && !devices.some((device) => device.id === validated.config.deviceId)
  ) {
    return { error: "report_scope_exceeds_access" as const };
  }
  const dataSources = parseJson<DataSource[]>(resourceValue.get("dataSources") ?? "[]", []);
  const analysisProfiles = parseJson<BenefitAnalysisProfile[]>(resourceValue.get("analysisProfiles") ?? "[]", []);
  const hospital: Hospital = {
    id: hospitalRow.id,
    code: hospitalRow.code,
    name: hospitalRow.name,
    shortName: hospitalRow.shortName,
    level: hospitalRow.level,
    region: hospitalRow.region,
    status: "运行中",
    tenantKey: hospitalRow.code,
    dataCompleteness: devices.length ? 100 : 0,
    connectedSources: dataSources.filter((source) => source.status === "已连接").length,
  };
  const model = buildBenefitReportModel(devices, hospital, validated.config, dataSources, analysisProfiles);
  const quality = buildReportQuality(model);
  const snapshot = buildReportSnapshot(model, quality);
  return { config: validated.config, quality, snapshot };
}

function storedSnapshotQuality(
  value: unknown,
  hospitalId: string,
  expectedPeriod: string,
  expectedScope: string,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const hospital = snapshot.hospital;
  const config = snapshot.config;
  const quality = snapshot.quality;
  if (!hospital || typeof hospital !== "object" || Array.isArray(hospital)) return null;
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  if (!quality || typeof quality !== "object" || Array.isArray(quality)) return null;
  const hospitalRecord = hospital as Record<string, unknown>;
  const qualityRecord = quality as Record<string, unknown>;
  const configRecord = config as Record<string, unknown>;
  if (hospitalRecord.id !== hospitalId || configRecord.period !== expectedPeriod || configRecord.scope !== expectedScope) return null;
  const validatedConfig = trustedReportConfig(configRecord);
  if ("error" in validatedConfig) return null;
  const requiredArrays = ["rows", "scoreRows", "issues", "dataSources", "analysisProfiles"] as const;
  if (requiredArrays.some((key) => !Array.isArray(snapshot[key]))) return null;
  if (!snapshot.totals || typeof snapshot.totals !== "object" || Array.isArray(snapshot.totals)) return null;
  if (!snapshot.sourceCoverage || typeof snapshot.sourceCoverage !== "object" || Array.isArray(snapshot.sourceCoverage)) return null;
  if (!snapshot.analysisProfileCoverage || typeof snapshot.analysisProfileCoverage !== "object" || Array.isArray(snapshot.analysisProfileCoverage)) return null;
  if (!Array.isArray(qualityRecord.checks)) return null;
  const checks = qualityRecord.checks.filter((check): check is Record<string, unknown> => Boolean(check) && typeof check === "object" && !Array.isArray(check));
  const requiredCheckIds = [
    "metadata",
    "scope",
    "identity",
    "safety",
    "finance",
    "insight-lineage",
    "sources",
    "template-required-sources",
    "utilization-rule",
    "collection-profiles",
    "operations",
    "chapters",
  ];
  if (requiredCheckIds.some((id) => !checks.some((check) => check.id === id))) return null;
  const blockers = checks.filter((check) => check.level === "blocker").length;
  const warnings = checks.filter((check) => check.level === "warning").length;
  const passed = checks.filter((check) => check.level === "passed").length;
  let recomputedQuality: ReportQualityResult;
  try {
    recomputedQuality = buildReportQuality({
      ...snapshot,
      config: validatedConfig.config,
    } as unknown as BenefitReportModel);
  } catch {
    return null;
  }
  if (
    qualityRecord.blockers !== blockers
    || qualityRecord.warnings !== warnings
    || qualityRecord.passed !== passed
    || blockers !== recomputedQuality.blockers
    || warnings !== recomputedQuality.warnings
    || passed !== recomputedQuality.passed
    || typeof qualityRecord.score !== "number"
    || !Number.isFinite(qualityRecord.score)
    || qualityRecord.score !== recomputedQuality.score
  ) return null;
  return recomputedQuality;
}

async function writeEvent(hospitalId: string, reportId: string | null, actorAccountId: string, action: string, detail: string) {
  const db = await getDb();
  await db.insert(reportEvents).values({ hospitalId, reportId, actorAccountId, action, detail });
  await db.insert(auditLogs).values({ hospitalId, actorAccountId, action, resourceType: "benefit_report", resourceId: reportId ?? hospitalId, result: "allowed", detail });
}

async function ledger(hospitalId: string, access: ReportAccess) {
  const db = await getDb();
  const reportRows = await db.select().from(benefitReports).where(eq(benefitReports.hospitalId, hospitalId)).orderBy(desc(benefitReports.updatedAt)).limit(100);
  const reports = reportRows.filter((report) => reportVisibleToAccess(report, access));
  const visibleReportIds = new Set(reports.map((report) => report.id));
  const templates = await db.select().from(reportTemplates).where(eq(reportTemplates.hospitalId, hospitalId)).orderBy(desc(reportTemplates.updatedAt));
  const eventRows = await db.select().from(reportEvents).where(eq(reportEvents.hospitalId, hospitalId)).orderBy(desc(reportEvents.createdAt)).limit(100);
  const events = hasFullHospitalDataScope(access)
    ? eventRows
    : eventRows.filter((event) => Boolean(event.reportId && visibleReportIds.has(event.reportId)));
  const accountIds = [...new Set([
    ...reports.flatMap((report) => [report.createdByAccountId, report.reviewedByAccountId, report.approvedByAccountId]),
    ...events.map((event) => event.actorAccountId),
  ].filter((id): id is string => Boolean(id)))];
  const people = accountIds.length ? await db.select({ id: accounts.id, name: accounts.displayName }).from(accounts).where(inArray(accounts.id, accountIds)) : [];
  const personName = new Map(people.map((person) => [person.id, person.name]));
  return {
    reports: reports.map((report) => ({
      id: report.id,
      hospitalId: report.hospitalId,
      seriesId: report.seriesId,
      version: report.version,
      status: report.status,
      title: report.title,
      period: report.period,
      scope: report.scope,
      config: parseJson(report.configJson, {}),
      // Submission is the freeze boundary. Reviewers, approvers and the final
      // issuer must all receive the exact snapshot saved before submission.
      snapshotJson: usesFrozenSnapshot(report.status) ? parseJson(report.snapshotJson, null) : null,
      qualityScore: report.qualityScore,
      blockingCount: report.blockingCount,
      warningCount: report.warningCount,
      warningAcknowledged: report.warningAcknowledged,
      reviewComment: report.reviewComment,
      createdBy: personName.get(report.createdByAccountId) ?? "未知成员",
      reviewedBy: report.reviewedByAccountId ? personName.get(report.reviewedByAccountId) ?? "未知成员" : "",
      approvedBy: report.approvedByAccountId ? personName.get(report.approvedByAccountId) ?? "未知成员" : "",
      submittedAt: report.submittedAt,
      reviewedAt: report.reviewedAt,
      issuedAt: report.issuedAt,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    })),
    templates: templates.map((template) => ({
      id: template.id,
      hospitalId: template.hospitalId,
      name: template.name,
      description: template.description,
      config: parseJson(template.configJson, {}),
      isDefault: template.isDefault,
      updatedAt: template.updatedAt,
    })),
    events: events.map((event) => ({
      id: event.id,
      reportId: event.reportId,
      actor: event.actorAccountId ? personName.get(event.actorAccountId) ?? "未知成员" : "系统",
      action: event.action,
      detail: event.detail,
      createdAt: event.createdAt,
    })),
  };
}

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try {
    user = await requireAppSession(request);
  } catch (error) {
    return appSessionError(error);
  }
  const hospitalId = new URL(request.url).searchParams.get("hospitalId")?.trim() ?? "";
  if (!hospitalId) return Response.json({ error: "hospital_required" }, { status: 400 });
  try {
    const access = await reportAccess(user.email, hospitalId);
    if (!access || !mayReadHospitalReports(access)) return Response.json({ error: "permission_denied" }, { status: 403 });
    return Response.json(await ledger(hospitalId, access));
  } catch (error) {
    return errorResponse(error);
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
  let payload: ReportPayload;
  try {
    payload = await request.json() as ReportPayload;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const hospitalId = payload.hospitalId?.trim() ?? "";
  if (!hospitalId || !payload.action) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const access = await reportAccess(user.email, hospitalId);
    if (!access || !mayReadHospitalReports(access)) return Response.json({ error: "permission_denied" }, { status: 403 });
    const db = await getDb();
    const now = new Date().toISOString();

    if (payload.action === "save_report") {
      if (!may(access, "report.manage")) return Response.json({ error: "permission_denied" }, { status: 403 });
      const authoritative = await buildAuthoritativeReport(hospitalId, payload.config ?? {}, access);
      if ("error" in authoritative) return Response.json({ error: authoritative.error }, { status: 400 });
      if (!("quality" in authoritative) || !("snapshot" in authoritative)) {
        return Response.json({ error: "report_build_failed" }, { status: 500 });
      }
      const { config, quality, snapshot } = authoritative;
      const title = config.title.trim();
      const period = config.period.trim();
      const scope = config.scope as (typeof benefitReports.$inferInsert)["scope"];
      const snapshotJson = JSON.stringify(snapshot);
      if (!title || !period || snapshotJson.length > 900_000) return Response.json({ error: "invalid_report" }, { status: 400 });
      let reportId = payload.reportId?.trim() ?? "";
      if (reportId) {
        const [existing] = await db.select().from(benefitReports).where(and(eq(benefitReports.id, reportId), eq(benefitReports.hospitalId, hospitalId))).limit(1);
        if (!existing) return Response.json({ error: "report_not_found" }, { status: 404 });
        if (existing.status !== "draft") return Response.json({ error: "immutable_report" }, { status: 409 });
        await db.update(benefitReports).set({
          title,
          period,
          scope,
          configJson: JSON.stringify(config),
          snapshotJson,
          qualityScore: quality.score,
          blockingCount: quality.blockers,
          warningCount: quality.warnings,
          warningAcknowledged: Boolean(payload.warningAcknowledged),
          updatedAt: now,
        }).where(eq(benefitReports.id, reportId));
        await writeEvent(hospitalId, reportId, access.account.id, "save_report", "更新报告草稿");
      } else {
        const seriesId = payload.seriesId?.trim() || `report-series-${crypto.randomUUID()}`;
        const [latest] = await db.select({ version: benefitReports.version }).from(benefitReports).where(and(eq(benefitReports.hospitalId, hospitalId), eq(benefitReports.seriesId, seriesId))).orderBy(desc(benefitReports.version)).limit(1);
        reportId = `report-${crypto.randomUUID()}`;
        await db.insert(benefitReports).values({
          id: reportId,
          hospitalId,
          seriesId,
          version: (latest?.version ?? 0) + 1,
          status: "draft",
          title,
          period,
          scope,
          configJson: JSON.stringify(config),
          snapshotJson,
          qualityScore: quality.score,
          blockingCount: quality.blockers,
          warningCount: quality.warnings,
          warningAcknowledged: Boolean(payload.warningAcknowledged),
          createdByAccountId: access.account.id,
          updatedAt: now,
        });
        await writeEvent(hospitalId, reportId, access.account.id, "create_report", "创建报告草稿 V1");
      }
      return Response.json({ reportId, ledger: await ledger(hospitalId, access) }, { status: payload.reportId ? 200 : 201 });
    }

    if (payload.action === "submit_report") {
      if (!may(access, "report.manage")) return Response.json({ error: "permission_denied" }, { status: 403 });
      const reportId = payload.reportId?.trim() ?? "";
      const [report] = await db.select().from(benefitReports).where(and(eq(benefitReports.id, reportId), eq(benefitReports.hospitalId, hospitalId))).limit(1);
      if (!report) return Response.json({ error: "report_not_found" }, { status: 404 });
      if (report.status !== "draft") return Response.json({ error: "invalid_transition" }, { status: 409 });
      const snapshotQuality = storedSnapshotQuality(parseJson<unknown>(report.snapshotJson, null), hospitalId, report.period, report.scope);
      if (!snapshotQuality) return Response.json({ error: "invalid_report_snapshot" }, { status: 409 });
      if (
        report.blockingCount !== snapshotQuality.blockers
        || report.warningCount !== snapshotQuality.warnings
      ) return Response.json({ error: "invalid_report_snapshot" }, { status: 409 });
      if (snapshotQuality.blockers > 0 || (snapshotQuality.warnings > 0 && !report.warningAcknowledged)) return Response.json({ error: "quality_gate_failed" }, { status: 409 });
      await db.update(benefitReports).set({ status: "pending_review", submittedAt: now, updatedAt: now }).where(eq(benefitReports.id, reportId));
      await writeEvent(hospitalId, reportId, access.account.id, "submit_report", "提交财务 / 运营复核");
      return Response.json({ ledger: await ledger(hospitalId, access) });
    }

    if (payload.action === "review_report") {
      if (!may(access, "report.review")) return Response.json({ error: "permission_denied" }, { status: 403 });
      const reportId = payload.reportId?.trim() ?? "";
      const [report] = await db.select().from(benefitReports).where(and(eq(benefitReports.id, reportId), eq(benefitReports.hospitalId, hospitalId))).limit(1);
      if (!report) return Response.json({ error: "report_not_found" }, { status: 404 });
      if (report.status !== "pending_review") return Response.json({ error: "invalid_transition" }, { status: 409 });
      const snapshotQuality = storedSnapshotQuality(parseJson<unknown>(report.snapshotJson, null), hospitalId, report.period, report.scope);
      if (!snapshotQuality) return Response.json({ error: "invalid_report_snapshot" }, { status: 409 });
      if (snapshotQuality.blockers > 0 || (snapshotQuality.warnings > 0 && !report.warningAcknowledged)) return Response.json({ error: "quality_gate_failed" }, { status: 409 });
      if (report.createdByAccountId === access.account.id) return Response.json({ error: "separation_of_duties" }, { status: 409 });
      if (payload.decision !== "approve" && payload.decision !== "reject") return Response.json({ error: "decision_required" }, { status: 400 });
      const comment = payload.comment?.trim() ?? "";
      if (payload.decision === "reject" && !comment) return Response.json({ error: "comment_required" }, { status: 400 });
      await db.update(benefitReports).set({ status: payload.decision === "approve" ? "approved" : "rejected", reviewedByAccountId: access.account.id, reviewComment: comment, reviewedAt: now, updatedAt: now }).where(eq(benefitReports.id, reportId));
      await writeEvent(hospitalId, reportId, access.account.id, payload.decision === "approve" ? "approve_report" : "reject_report", comment || "复核通过");
      return Response.json({ ledger: await ledger(hospitalId, access) });
    }

    if (payload.action === "issue_report") {
      if (!may(access, "report.approve")) return Response.json({ error: "permission_denied" }, { status: 403 });
      const reportId = payload.reportId?.trim() ?? "";
      const [report] = await db.select().from(benefitReports).where(and(eq(benefitReports.id, reportId), eq(benefitReports.hospitalId, hospitalId))).limit(1);
      if (!report) return Response.json({ error: "report_not_found" }, { status: 404 });
      if (report.status !== "approved") return Response.json({ error: "invalid_transition" }, { status: 409 });
      const snapshotQuality = storedSnapshotQuality(parseJson<unknown>(report.snapshotJson, null), hospitalId, report.period, report.scope);
      if (!snapshotQuality) return Response.json({ error: "invalid_report_snapshot" }, { status: 409 });
      if (snapshotQuality.blockers > 0 || (snapshotQuality.warnings > 0 && !report.warningAcknowledged)) return Response.json({ error: "quality_gate_failed" }, { status: 409 });
      if (report.createdByAccountId === access.account.id || report.reviewedByAccountId === access.account.id) return Response.json({ error: "separation_of_duties" }, { status: 409 });
      await db.update(benefitReports).set({ status: "issued", approvedByAccountId: access.account.id, issuedAt: now, updatedAt: now }).where(eq(benefitReports.id, reportId));
      await writeEvent(hospitalId, reportId, access.account.id, "issue_report", "签发正式报告并冻结快照");
      return Response.json({ ledger: await ledger(hospitalId, access) });
    }

    if (payload.action === "create_version") {
      if (!may(access, "report.manage")) return Response.json({ error: "permission_denied" }, { status: 403 });
      const reportId = payload.reportId?.trim() ?? "";
      const [base] = await db.select().from(benefitReports).where(and(eq(benefitReports.id, reportId), eq(benefitReports.hospitalId, hospitalId))).limit(1);
      if (!base) return Response.json({ error: "report_not_found" }, { status: 404 });
      if (base.status === "draft") return Response.json({ error: "draft_already_editable" }, { status: 409 });
      const [latest] = await db.select({ version: benefitReports.version }).from(benefitReports).where(and(
        eq(benefitReports.hospitalId, hospitalId),
        eq(benefitReports.seriesId, base.seriesId),
      )).orderBy(desc(benefitReports.version)).limit(1);
      const nextId = `report-${crypto.randomUUID()}`;
      const nextVersion = (latest?.version ?? base.version) + 1;
      await db.insert(benefitReports).values({
        id: nextId,
        hospitalId,
        seriesId: base.seriesId,
        version: nextVersion,
        status: "draft",
        title: base.title,
        period: base.period,
        scope: base.scope,
        configJson: base.configJson,
        snapshotJson: base.snapshotJson,
        qualityScore: base.qualityScore,
        blockingCount: base.blockingCount,
        warningCount: base.warningCount,
        warningAcknowledged: false,
        createdByAccountId: access.account.id,
        reviewComment: "",
        updatedAt: now,
      });
      await writeEvent(hospitalId, nextId, access.account.id, "create_version", `基于 V${base.version} 创建 V${nextVersion}`);
      return Response.json({ reportId: nextId, ledger: await ledger(hospitalId, access) }, { status: 201 });
    }

    if (payload.action === "save_template") {
      if (!may(access, "report.manage")) return Response.json({ error: "permission_denied" }, { status: 403 });
      const name = payload.templateName?.trim() ?? "";
      if (!name || !payload.config) return Response.json({ error: "invalid_template" }, { status: 400 });
      const validatedTemplate = trustedReportConfig(payload.config);
      if ("error" in validatedTemplate) return Response.json({ error: validatedTemplate.error }, { status: 400 });
      const configJson = JSON.stringify(validatedTemplate.config);
      if (configJson.length > 100_000) return Response.json({ error: "template_too_large" }, { status: 400 });
      const [existing] = await db.select({ isDefault: reportTemplates.isDefault })
        .from(reportTemplates)
        .where(and(eq(reportTemplates.hospitalId, hospitalId), eq(reportTemplates.name, name)))
        .limit(1);
      // Omitted keeps an existing template's default state for older clients;
      // an explicit false removes it, while new templates default to false.
      const isDefault = payload.templateIsDefault ?? existing?.isDefault ?? false;
      if (isDefault) {
        await db.update(reportTemplates)
          .set({ isDefault: false, updatedAt: now })
          .where(eq(reportTemplates.hospitalId, hospitalId));
      }
      const templateId = `template-${crypto.randomUUID()}`;
      await db.insert(reportTemplates).values({ id: templateId, hospitalId, name, description: payload.templateDescription?.trim() ?? "", configJson, isDefault, createdByAccountId: access.account.id, updatedAt: now })
        .onConflictDoUpdate({ target: [reportTemplates.hospitalId, reportTemplates.name], set: { description: payload.templateDescription?.trim() ?? "", configJson, isDefault, createdByAccountId: access.account.id, updatedAt: now } });
      const auditDetail = isDefault
        ? `保存并设为医院默认模板：${name}`
        : payload.templateIsDefault === false && existing?.isDefault
          ? `保存医院模板并取消默认：${name}`
          : `保存医院模板：${name}`;
      await writeEvent(hospitalId, null, access.account.id, "save_template", auditDetail);
      return Response.json({ ledger: await ledger(hospitalId, access) });
    }

    if (payload.action === "log_export") {
      if (!may(access, "report.export")) return Response.json({ error: "permission_denied" }, { status: 403 });
      const reportId = payload.reportId?.trim() || null;
      if (reportId) {
        const [report] = await db.select({ id: benefitReports.id }).from(benefitReports).where(and(eq(benefitReports.id, reportId), eq(benefitReports.hospitalId, hospitalId))).limit(1);
        if (!report) return Response.json({ error: "report_not_found" }, { status: 404 });
      }
      const hash = payload.artifactHash?.replace(/[^a-f0-9]/gi, "").slice(0, 64) ?? "";
      const fileName = payload.fileName?.replace(/[\r\n]/g, " ").slice(0, 180) ?? "";
      await writeEvent(hospitalId, reportId, access.account.id, "export_report", `导出 ${payload.exportFormat === "csv" ? "CSV 明细" : "Word 报告"}${fileName ? `：${fileName}` : ""}${hash ? ` · SHA-256 ${hash}` : ""}`);
      return Response.json({ ledger: await ledger(hospitalId, access) });
    }

    return Response.json({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
