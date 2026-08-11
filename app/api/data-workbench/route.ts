import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSessionError, assertSameOrigin, requireAppSession } from "../../../db/account-security";
import { getCloudStateAccess } from "../../../db/cloud-state";
import { HOSPITAL_METRIC_CATALOG_VERSION } from "../../hospital-metric-catalog";
import {
  metricTemplateRegistry,
  registeredMetricTemplateVersions,
  resolveMetricTemplate,
} from "../../metric-template-registry";
import {
  boundedJson,
  canAdvanceImport,
  canAdvancePublish,
  containsSensitiveConnectorMaterial,
  dataWorkbenchPermissions,
  isPlainRecord,
  isPublishStatus,
  isSafeCredentialReference,
  normalizeConnectorEndpoint,
  safeIdentifier,
  type DataWorkbenchPermission,
} from "../../../db/data-workbench-contract";
import {
  activeFieldDefinitionIdsInHospital,
  activeMetricDefinitionIdsInHospital,
  connectorInHospital,
  datasetInHospital,
  examEventInHospital,
  fieldDefinitionInHospital,
  hasOpenBlockingIssues,
  importInHospital,
  isDataWorkbenchResource,
  listDataWorkbenchResource,
  mappingInHospital,
  metricDefinitionInHospital,
  metricDefinitionsByCodesVersionInHospital,
  publishInHospital,
  qualityIssueInHospital,
  recipeInHospital,
  visualizationDefinitionInHospital,
  writeDataLineage,
  type DataWorkbenchResource,
} from "../../../db/data-workbench";
import {
  createDatasetSnapshot,
  deletePipelineObject,
  recordsToNdjson,
  sha256Hex,
  snapshotInHospital,
  snapshotRecords,
  stableStringify,
} from "../../../db/data-workbench-pipeline";
import {
  applyFieldMapping,
  expandExamActivityForPublish,
  executeCleaningRules,
  normalizeFieldMapping,
  type CleaningRuleContract,
} from "../../../db/data-workbench-transform";
import { groupReconciliationRows, reconciliationValuesEqual } from "../../../db/data-workbench-reconciliation";
import { containsDirectPatientIdentifiers, redactDirectPatientIdentifiers } from "../../../db/data-workbench-privacy";
import {
  buildHospitalMetricTemplateRows,
  hospitalMetricActivationIssues,
  parseHospitalMetricTemplateMetadata,
  planHospitalMetricTemplateImport,
} from "../../../db/data-workbench-metric-template";
import {
  dataCleaningRecipes,
  dataCleaningRules,
  auditLogs,
  dataDatasetSnapshots,
  dataExamEventBodyParts,
  dataExamEvents,
  dataFieldDefinitions,
  dataFieldMappings,
  dataImportJobs,
  dataLineageEvents,
  dataMetricDefinitions,
  dataPipelineIdempotency,
  dataPipelineRecords,
  dataPublishVersions,
  dataQualityIssues,
  dataSourceConnectors,
  dataRecordIssues,
  dataReconciliationConfigs,
  dataReconciliationDifferences,
  dataReconciliationRuns,
  dataReviewEvents,
  dataVisualizationDefinitions,
  rawDatasets,
} from "../../../db/schema";

export const dynamic = "force-dynamic";

type Access = NonNullable<Awaited<ReturnType<typeof getCloudStateAccess>>>;
type Payload = Record<string, unknown> & { action?: string; hospitalId?: string };

const connectorSourceTypes = new Set(["HIS", "PACS", "RIS", "LIS", "HRP", "CMMS", "IoT", "file", "manual", "other"]);
const transportTypes = new Set(["HL7", "DICOM", "FHIR", "REST", "SFTP", "database", "file", "manual", "other"]);
const connectorStatuses = new Set(["draft", "active", "disabled", "error"]);
const ingestionModes = new Set(["api", "file", "manual"]);
const configStatuses = new Set(["draft", "active", "retired"]);
const issueSeverities = new Set(["info", "warning", "blocker"]);
const issueStatuses = new Set(["open", "acknowledged", "resolved", "waived"]);
const fieldDataTypes = new Set(["string", "integer", "decimal", "boolean", "date", "datetime", "code", "json"]);
const metricAggregations = new Set(["sum", "avg", "min", "max", "count", "distinct_count", "ratio", "custom"]);
const cleaningRuleTypes = new Set(["trim", "upper", "lower", "default", "number", "required", "regex", "enum", "replace", "deduplicate"]);
// 所有已登记模板（基线 + 全面监测）的目录编码都必须走激活专用动作，不允许绕过。
const hospitalMetricCatalogCodes = new Set(
  Object.values(metricTemplateRegistry).flatMap((template) => template.catalog.map((item) => item.code)),
);

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("D1 binding") || message.includes("no such table")) {
    return Response.json({ error: "data_workbench_store_unavailable" }, { status: 503 });
  }
  console.error(JSON.stringify({ scope: "data-workbench", error: message }));
  return Response.json({ error: "data_workbench_operation_failed" }, { status: 500 });
}

function hospitalIdentifier(value: unknown) {
  return safeIdentifier(value, 128);
}

function textValue(value: unknown, maxLength: number, required = true) {
  if (value === undefined || value === null) return required ? null : "";
  if (typeof value !== "string") return null;
  const text = value.trim();
  if ((required && !text) || text.length > maxLength) return null;
  return text;
}

function nonNegativeInteger(value: unknown, fallback = 0) {
  if (value === undefined) return fallback;
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function enumValue(value: unknown, allowed: Set<string>) {
  return typeof value === "string" && allowed.has(value) ? value : null;
}

function hasFullHospitalScope(access: Access) {
  return access.dataScope === "platform" || access.dataScope === "hospital";
}

function may(access: Access, permission: DataWorkbenchPermission) {
  return access.platformAdmin || access.permissions.has(permission);
}

function mayReadWorkbench(access: Access) {
  return access.platformAdmin || dataWorkbenchPermissions.some((permission) => access.permissions.has(permission));
}

function mayReadWorkbenchResource(access: Access, resource: DataWorkbenchResource) {
  if (access.platformAdmin) return true;
  const any = (...permissions: DataWorkbenchPermission[]) => permissions.some((permission) => access.permissions.has(permission));
  if (resource === "imports") return any("data.ingest", "data.clean", "data.review");
  if (["datasets", "records", "snapshots"].includes(resource)) return any("data.ingest", "data.clean");
  if (resource === "quarantine") return any("data.clean", "data.review");
  if (["reviews", "lineage"].includes(resource)) return any("data.review", "data.publish");
  if (["publishes", "publishedRecords"].includes(resource)) return any("data.clean", "data.review", "data.publish");
  if (resource === "connectors") return access.permissions.has("connector.manage");
  return mayReadWorkbench(access);
}

const redactSensitive = redactDirectPatientIdentifiers;

function requirePermission(access: Access, permission: DataWorkbenchPermission) {
  return may(access, permission)
    ? null
    : Response.json({ error: "permission_denied", permission }, { status: 403 });
}

function jsonValue(value: unknown, fallback: unknown, maxBytes = 100_000) {
  const normalized = value === undefined ? fallback : value;
  return boundedJson(normalized, maxBytes);
}

function stringArray(value: unknown, maxItems = 1000) {
  if (!Array.isArray(value) || !value.length || value.length > maxItems) return null;
  const values = value.map((item) => safeIdentifier(item, 160));
  return values.some((item) => !item) ? null : [...new Set(values)];
}

function optionalIdentifierArray(value: unknown, maxItems = 1000) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const values = value.map((item) => safeIdentifier(item, 160));
  return values.some((item) => !item) ? null : [...new Set(values)];
}

function metadataPermission(status: string): DataWorkbenchPermission {
  return status === "active" ? "data.review" : status === "retired" ? "data.publish" : "data.clean";
}

async function accessFor(userEmail: string, hospitalId: string) {
  const access = await getCloudStateAccess(userEmail, hospitalId);
  if (!access) return { response: Response.json({ error: "permission_denied" }, { status: 403 }) } as const;
  if (!hasFullHospitalScope(access)) {
    // Raw imports and reconciliation can span departments and may contain
    // sensitive source metadata. Keep the entire workbench fail-closed for
    // department/self scopes until row-level ownership exists on every layer.
    return { response: Response.json({ error: "hospital_scope_required" }, { status: 403 }) } as const;
  }
  return { access } as const;
}

async function lineage(hospitalId: string, accountId: string, input: Omit<Parameters<typeof writeDataLineage>[0], "hospitalId" | "accountId">) {
  await writeDataLineage({ hospitalId, accountId, ...input });
}

async function idempotencyState(hospitalId: string, action: string, key: string, payload: Payload) {
  const db = await getDb();
  const requestSha256 = await sha256Hex(stableStringify(payload));
  const [existing] = await db.select().from(dataPipelineIdempotency).where(and(
    eq(dataPipelineIdempotency.hospitalId, hospitalId),
    eq(dataPipelineIdempotency.action, action),
    eq(dataPipelineIdempotency.idempotencyKey, key),
  )).limit(1);
  if (existing && existing.requestSha256 !== requestSha256) return { conflict: true as const };
  if (existing) return { existing, response: JSON.parse(existing.responseJson) as unknown, requestSha256 };
  return { requestSha256 };
}

async function saveIdempotency(input: { hospitalId: string; action: string; key: string; requestSha256: string; resourceType: string; resourceId: string; response: unknown }) {
  const db = await getDb();
  await db.insert(dataPipelineIdempotency).values({
    hospitalId: input.hospitalId, action: input.action, idempotencyKey: input.key, requestSha256: input.requestSha256,
    resourceType: input.resourceType, resourceId: input.resourceId, responseJson: JSON.stringify(input.response),
  });
}

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try {
    user = await requireAppSession(request);
  } catch (error) {
    return appSessionError(error);
  }
  const url = new URL(request.url);
  const hospitalId = hospitalIdentifier(url.searchParams.get("hospitalId"));
  const resource = url.searchParams.get("resource");
  const requestedLimit = Number(url.searchParams.get("limit") ?? 100);
  const requestedOffset = Number(url.searchParams.get("offset") ?? 0);
  const rawImportId = url.searchParams.get("importId") ?? "";
  const rawSnapshotId = url.searchParams.get("snapshotId") ?? "";
  const importId = rawImportId ? safeIdentifier(rawImportId, 180) : "";
  const snapshotId = rawSnapshotId ? safeIdentifier(rawSnapshotId, 180) : "";
  if (
    !hospitalId
    || !isDataWorkbenchResource(resource)
    || !Number.isSafeInteger(requestedLimit)
    || requestedLimit < 1
    || !Number.isSafeInteger(requestedOffset)
    || requestedOffset < 0
    || (rawImportId && !importId)
    || (rawSnapshotId && !snapshotId)
  ) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const limit = Math.min(requestedLimit, 500);
  const offset = Math.min(requestedOffset, 1_000_000);
  try {
    const authorized = await accessFor(user.email, hospitalId);
    if ("response" in authorized) return authorized.response;
    if (!mayReadWorkbenchResource(authorized.access, resource)) return Response.json({ error: "permission_denied" }, { status: 403 });
    const data = await listDataWorkbenchResource(hospitalId, resource, { limit, offset, importId, snapshotId });
    const sensitiveRead = ["records", "quarantine", "datasets", "snapshots"].includes(resource);
    if (sensitiveRead) {
      const db = await getDb();
      await db.insert(auditLogs).values({
        hospitalId, actorAccountId: authorized.access.account.id, action: resource === "quarantine" && url.searchParams.get("format") === "csv" ? "download_quarantine_error_export" : "read_data_workbench_sensitive_resource",
        resourceType: resource, resourceId: snapshotId || importId || hospitalId, result: "allowed", detail: `limit=${limit}; offset=${offset}; importId=${importId}; snapshotId=${snapshotId}; masked=true`,
      });
    }
    if (resource === "quarantine" && url.searchParams.get("format") === "csv") {
      const rows = Array.isArray(data) ? data.filter(isPlainRecord) : [];
      const fields = ["issueId", "snapshotId", "recordId", "sourceRowNumber", "fieldName", "severity", "status", "message"];
      const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
      const csv = "\uFEFF" + [fields.join(","), ...rows.map((row) => fields.map((field) => escape((row as Record<string, unknown>)[field])).join(","))].join("\r\n");
      return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="quarantine-errors-${hospitalId}.csv"`, "Cache-Control": "private, no-store" } });
    }
    const responseData = sensitiveRead ? redactSensitive(data) : data;
    return Response.json({
      data: responseData,
      pagination: {
        limit,
        offset,
        count: Array.isArray(responseData) ? responseData.length : 0,
        nextOffset: Array.isArray(responseData) && responseData.length === limit ? offset + limit : null,
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
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
  let payload: Payload;
  try {
    const raw = await request.json();
    if (!isPlainRecord(raw)) return Response.json({ error: "invalid_json" }, { status: 400 });
    payload = raw as Payload;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const hospitalId = hospitalIdentifier(payload.hospitalId);
  if (!hospitalId || typeof payload.action !== "string") {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    const authorized = await accessFor(user.email, hospitalId);
    if ("response" in authorized) return authorized.response;
    const access = authorized.access;
    const db = await getDb();
    const now = new Date().toISOString();

    if (payload.action === "create_connector" || payload.action === "update_connector") {
      const denied = requirePermission(access, "connector.manage");
      if (denied) return denied;
      const metadata = payload.metadata ?? {};
      if (!isPlainRecord(metadata) || containsSensitiveConnectorMaterial(metadata)) {
        return Response.json({ error: "inline_credentials_forbidden" }, { status: 400 });
      }
      const metadataJson = jsonValue(metadata, {}, 50_000);
      const endpoint = normalizeConnectorEndpoint(payload.endpoint);
      const credentialRef = payload.credentialRef === undefined || payload.credentialRef === ""
        ? ""
        : isSafeCredentialReference(payload.credentialRef) ? payload.credentialRef : null;
      const code = safeIdentifier(payload.code, 80);
      const name = textValue(payload.name, 120);
      const sourceType = enumValue(payload.sourceType, connectorSourceTypes);
      const transportType = enumValue(payload.transportType, transportTypes);
      const status = enumValue(payload.status ?? "draft", connectorStatuses);
      if (!metadataJson || endpoint === null || credentialRef === null || !code || !name || !sourceType || !transportType || !status) {
        return Response.json({ error: "invalid_connector" }, { status: 400 });
      }
      if (payload.action === "create_connector") {
        const id = `connector-${crypto.randomUUID()}`;
        const [row] = await db.insert(dataSourceConnectors).values({
          id, hospitalId, code, name, sourceType: sourceType as typeof dataSourceConnectors.$inferInsert.sourceType,
          transportType: transportType as typeof dataSourceConnectors.$inferInsert.transportType,
          endpoint, credentialRef, metadataJson, status: status as typeof dataSourceConnectors.$inferInsert.status,
          createdByAccountId: access.account.id, updatedByAccountId: access.account.id,
        }).returning();
        await lineage(hospitalId, access.account.id, { action: "connector_created", resourceType: "connector", resourceId: id, toStatus: status });
        return Response.json({ data: row }, { status: 201 });
      }
      const id = safeIdentifier(payload.id, 180);
      const revision = nonNegativeInteger(payload.revision);
      if (!id || !revision || !await connectorInHospital(hospitalId, id)) return Response.json({ error: "connector_not_found" }, { status: 404 });
      const [row] = await db.update(dataSourceConnectors).set({
        code, name, sourceType: sourceType as typeof dataSourceConnectors.$inferInsert.sourceType,
        transportType: transportType as typeof dataSourceConnectors.$inferInsert.transportType,
        endpoint, credentialRef, metadataJson, status: status as typeof dataSourceConnectors.$inferInsert.status,
        revision: sql`${dataSourceConnectors.revision} + 1`, updatedByAccountId: access.account.id, updatedAt: now,
      }).where(and(eq(dataSourceConnectors.id, id), eq(dataSourceConnectors.hospitalId, hospitalId), eq(dataSourceConnectors.revision, revision))).returning();
      if (!row) return Response.json({ error: "revision_conflict" }, { status: 409 });
      await lineage(hospitalId, access.account.id, { action: "connector_updated", resourceType: "connector", resourceId: id, toStatus: status });
      return Response.json({ data: row });
    }

    if (payload.action === "create_import") {
      const denied = requirePermission(access, "data.ingest");
      if (denied) return denied;
      const dataDomain = safeIdentifier(payload.dataDomain, 100);
      const ingestionMode = enumValue(payload.ingestionMode, ingestionModes);
      const connectorId = payload.connectorId ? safeIdentifier(payload.connectorId, 180) : "";
      const fileName = textValue(payload.fileName, 255, false);
      const objectKey = textValue(payload.objectKey, 500, false);
      const sha256 = payload.sha256 === undefined || payload.sha256 === "" ? "" : textValue(payload.sha256, 64);
      if (!dataDomain || !ingestionMode || fileName === null || objectKey === null || sha256 === null || (sha256 && !/^[a-f0-9]{64}$/i.test(sha256))) {
        return Response.json({ error: "invalid_import" }, { status: 400 });
      }
      if (connectorId && !await connectorInHospital(hospitalId, connectorId)) return Response.json({ error: "connector_not_found" }, { status: 404 });
      const id = `import-${crypto.randomUUID()}`;
      const [row] = await db.insert(dataImportJobs).values({
        id, hospitalId, connectorId: connectorId || null, dataDomain,
        ingestionMode: ingestionMode as typeof dataImportJobs.$inferInsert.ingestionMode,
        fileName: fileName ?? "", objectKey: objectKey ?? "", sha256: sha256 ?? "", createdByAccountId: access.account.id,
      }).returning();
      await lineage(hospitalId, access.account.id, { action: "import_created", resourceType: "import", resourceId: id, toStatus: "uploading", importJobId: id });
      return Response.json({ data: row }, { status: 201 });
    }

    if (payload.action === "advance_import") {
      const id = safeIdentifier(payload.id, 180);
      const toStatus = typeof payload.status === "string" ? payload.status : "";
      const current = id ? await importInHospital(hospitalId, id) : null;
      if (!current) return Response.json({ error: "import_not_found" }, { status: 404 });
      if (!canAdvanceImport(current.status, toStatus)) return Response.json({ error: "invalid_status_transition" }, { status: 409 });
      const permission: DataWorkbenchPermission = toStatus === "ready" ? "data.review" : toStatus === "published" ? "data.publish" : "data.ingest";
      const denied = requirePermission(access, permission);
      if (denied) return denied;
      if (toStatus === "ready" && await hasOpenBlockingIssues(hospitalId, [id])) {
        return Response.json({ error: "blocking_quality_issues" }, { status: 409 });
      }
      let serverCounts: { rowCount: number; acceptedCount: number; rejectedCount: number } | null = null;
      let reviewedSnapshot: typeof dataDatasetSnapshots.$inferSelect | null = null;
      let reviewBreakGlass = false;
      let breakGlassReason = "";
      if (toStatus === "ready") {
        [reviewedSnapshot] = await db.select().from(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, id), eq(dataDatasetSnapshots.layer, "curated"), eq(dataDatasetSnapshots.status, "ready"))).orderBy(desc(dataDatasetSnapshots.version)).limit(1);
        if (!reviewedSnapshot) return Response.json({ error: "curated_snapshot_not_ready" }, { status: 409 });
        const records = await snapshotRecords(hospitalId, reviewedSnapshot.id, ["valid", "quarantined"]);
        const blockers = await db.select({ id: dataRecordIssues.id }).from(dataRecordIssues).where(and(eq(dataRecordIssues.hospitalId, hospitalId), eq(dataRecordIssues.snapshotId, reviewedSnapshot.id), eq(dataRecordIssues.status, "open"), eq(dataRecordIssues.severity, "blocker"))).limit(1);
        if (blockers.length || records.some((record) => record.status === "quarantined")) return Response.json({ error: "curated_snapshot_has_blockers" }, { status: 409 });
        const selfReview = current.createdByAccountId === access.account.id || reviewedSnapshot.createdByAccountId === access.account.id;
        breakGlassReason = textValue(payload.breakGlassReason, 1000, false) ?? "";
        reviewBreakGlass = selfReview;
        if (selfReview && !(access.platformAdmin && breakGlassReason.length >= 20)) return Response.json({ error: "self_review_forbidden" }, { status: 409 });
        serverCounts = { rowCount: records.length, acceptedCount: records.length, rejectedCount: 0 };
      }
      const rowCount = serverCounts?.rowCount ?? nonNegativeInteger(payload.rowCount, current.rowCount);
      const acceptedCount = serverCounts?.acceptedCount ?? nonNegativeInteger(payload.acceptedCount, current.acceptedCount);
      const rejectedCount = serverCounts?.rejectedCount ?? nonNegativeInteger(payload.rejectedCount, current.rejectedCount);
      const errorCode = textValue(payload.errorCode, 120, false);
      if (rowCount === null || acceptedCount === null || rejectedCount === null || errorCode === null || acceptedCount + rejectedCount > rowCount) {
        return Response.json({ error: "invalid_import_counts" }, { status: 400 });
      }
      const revision = nonNegativeInteger(payload.revision);
      if (!revision) return Response.json({ error: "revision_required" }, { status: 400 });
      const [row] = await db.update(dataImportJobs).set({
        status: toStatus, rowCount, acceptedCount, rejectedCount, errorCode,
        reviewedByAccountId: toStatus === "ready" ? access.account.id : current.reviewedByAccountId,
        revision: sql`${dataImportJobs.revision} + 1`, updatedAt: now,
      }).where(and(eq(dataImportJobs.id, id), eq(dataImportJobs.hospitalId, hospitalId), eq(dataImportJobs.revision, revision))).returning();
      if (!row) return Response.json({ error: "revision_conflict" }, { status: 409 });
      if (toStatus === "ready") await db.insert(dataReviewEvents).values({ hospitalId, resourceType: "import", resourceId: id, decision: reviewBreakGlass ? "break_glass" : "approve", actorAccountId: access.account.id, comment: "导入批次质量复核通过", breakGlassReason: reviewBreakGlass ? breakGlassReason : "" });
      await lineage(hospitalId, access.account.id, { action: "import_status_changed", resourceType: "import", resourceId: id, fromStatus: current.status, toStatus, importJobId: id });
      return Response.json({ data: row });
    }

    if (payload.action === "register_raw_dataset") {
      const denied = requirePermission(access, "data.ingest");
      if (denied) return denied;
      const importJobId = safeIdentifier(payload.importJobId, 180);
      const importJob = importJobId ? await importInHospital(hospitalId, importJobId) : null;
      if (!importJob) return Response.json({ error: "import_not_found" }, { status: 404 });
      const objectKey = textValue(payload.objectKey, 500, false);
      const contentType = textValue(payload.contentType ?? "application/octet-stream", 120);
      const sizeBytes = nonNegativeInteger(payload.sizeBytes);
      const rowCount = nonNegativeInteger(payload.rowCount);
      const sha256 = textValue(payload.sha256, 64);
      const schemaJson = jsonValue(payload.schema, {}, 200_000);
      const profileJson = jsonValue(payload.profile, {}, 200_000);
      const retentionUntil = payload.retentionUntil === undefined || payload.retentionUntil === "" ? null : textValue(payload.retentionUntil, 40);
      if (objectKey === null || !contentType || sizeBytes === null || rowCount === null || !sha256 || !/^[a-f0-9]{64}$/i.test(sha256) || !schemaJson || !profileJson) {
        return Response.json({ error: "invalid_dataset_metadata" }, { status: 400 });
      }
      const id = `dataset-${crypto.randomUUID()}`;
      const [row] = await db.insert(rawDatasets).values({
        id, hospitalId, importJobId, connectorId: importJob.connectorId, objectKey: objectKey ?? "",
        contentType, sizeBytes, sha256, rowCount, schemaJson, profileJson, retentionUntil,
        createdByAccountId: access.account.id,
      }).returning();
      await lineage(hospitalId, access.account.id, { action: "raw_dataset_registered", resourceType: "raw_dataset", resourceId: id, importJobId, detailJson: JSON.stringify({ sha256, rowCount }) });
      return Response.json({ data: row }, { status: 201 });
    }

    if (payload.action === "create_mapping" || payload.action === "update_mapping") {
      const denied = requirePermission(access, "data.clean");
      if (denied) return denied;
      const connectorId = payload.connectorId ? safeIdentifier(payload.connectorId, 180) : "";
      const dataDomain = safeIdentifier(payload.dataDomain, 100);
      const name = textValue(payload.name, 120);
      const version = nonNegativeInteger(payload.version, 1);
      const status = enumValue(payload.status ?? "draft", configStatuses);
      const mappingJson = jsonValue(payload.mapping, null, 250_000);
      if (!dataDomain || !name || !version || !status || !mappingJson || (connectorId && !await connectorInHospital(hospitalId, connectorId))) {
        return Response.json({ error: "invalid_mapping" }, { status: 400 });
      }
      if (payload.action === "create_mapping") {
        const id = `mapping-${crypto.randomUUID()}`;
        const [row] = await db.insert(dataFieldMappings).values({
          id, hospitalId, connectorId: connectorId || null, dataDomain, name, version, mappingJson,
          status: status as typeof dataFieldMappings.$inferInsert.status,
          createdByAccountId: access.account.id, updatedByAccountId: access.account.id,
        }).returning();
        await lineage(hospitalId, access.account.id, { action: "mapping_created", resourceType: "mapping", resourceId: id, mappingVersion: `${name}@${version}` });
        return Response.json({ data: row }, { status: 201 });
      }
      const id = safeIdentifier(payload.id, 180);
      const current = id ? await mappingInHospital(hospitalId, id) : null;
      if (!current) return Response.json({ error: "mapping_not_found" }, { status: 404 });
      if (current.status !== "draft") return Response.json({ error: "active_mapping_is_immutable" }, { status: 409 });
      const [mappingReference] = await db.select({ id: dataDatasetSnapshots.id }).from(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.mappingId, id))).limit(1);
      if (mappingReference) return Response.json({ error: "mapping_is_referenced_create_new_version" }, { status: 409 });
      const [row] = await db.update(dataFieldMappings).set({
        connectorId: connectorId || null, dataDomain, name, version, mappingJson,
        status: status as typeof dataFieldMappings.$inferInsert.status,
        updatedByAccountId: access.account.id, updatedAt: now,
      }).where(and(eq(dataFieldMappings.id, id), eq(dataFieldMappings.hospitalId, hospitalId))).returning();
      await lineage(hospitalId, access.account.id, { action: "mapping_updated", resourceType: "mapping", resourceId: id, mappingVersion: `${name}@${version}` });
      return Response.json({ data: row });
    }

    if (payload.action === "save_field_definition") {
      const status = enumValue(payload.status ?? "draft", configStatuses);
      if (!status) return Response.json({ error: "invalid_field_definition" }, { status: 400 });
      const denied = requirePermission(access, metadataPermission(status));
      if (denied) return denied;
      const id = payload.id ? safeIdentifier(payload.id, 180) : "";
      const current = id ? await fieldDefinitionInHospital(hospitalId, id) : null;
      if (id && !current) return Response.json({ error: "field_definition_not_found" }, { status: 404 });
      if (current && current.status !== "draft") return Response.json({ error: "active_definition_is_immutable" }, { status: 409 });
      const code = safeIdentifier(payload.code, 120);
      const name = textValue(payload.name, 160);
      const dataType = enumValue(payload.dataType, fieldDataTypes);
      const unit = textValue(payload.unit, 80, false);
      const description = textValue(payload.description, 1000, false);
      const version = nonNegativeInteger(payload.version, 1);
      const dictionaryJson = jsonValue(payload.dictionary, {}, 150_000);
      const validationJson = jsonValue(payload.validation, {}, 150_000);
      if (!code || !name || !dataType || unit === null || description === null || !version || !dictionaryJson || !validationJson) {
        return Response.json({ error: "invalid_field_definition" }, { status: 400 });
      }
      const resourceId = id || `field-${crypto.randomUUID()}`;
      const values = {
        code, name, dataType: dataType as typeof dataFieldDefinitions.$inferInsert.dataType,
        unit: unit ?? "", description: description ?? "", version, dictionaryJson, validationJson,
        status: status as typeof dataFieldDefinitions.$inferInsert.status,
        updatedByAccountId: access.account.id, updatedAt: now,
      };
      const [row] = current
        ? await db.update(dataFieldDefinitions).set(values).where(and(eq(dataFieldDefinitions.id, resourceId), eq(dataFieldDefinitions.hospitalId, hospitalId))).returning()
        : await db.insert(dataFieldDefinitions).values({ ...values, id: resourceId, hospitalId, createdByAccountId: access.account.id }).returning();
      await lineage(hospitalId, access.account.id, { action: current ? "field_definition_updated" : "field_definition_created", resourceType: "field_definition", resourceId, toStatus: status, detailJson: JSON.stringify({ code, version }) });
      return Response.json({ data: row }, { status: current ? 200 : 201 });
    }

    if (payload.action === "import_hospital_metric_template") {
      const denied = requirePermission(access, "data.clean");
      if (denied) return denied;
      const templateVersion = payload.templateVersion === undefined
        ? HOSPITAL_METRIC_CATALOG_VERSION
        : textValue(payload.templateVersion, 120);
      const registeredTemplate = templateVersion ? resolveMetricTemplate(templateVersion) : null;
      if (!templateVersion || !registeredTemplate) {
        return Response.json({ error: "unsupported_hospital_metric_template_version" }, { status: 400 });
      }
      const expected = buildHospitalMetricTemplateRows(registeredTemplate.catalog, templateVersion);
      if (expected.length !== registeredTemplate.expectedCount) throw new Error("invalid_hospital_metric_catalog_size");
      const version = expected[0]?.version ?? 0;
      const existing = await metricDefinitionsByCodesVersionInHospital(
        hospitalId,
        expected.map((row) => row.code),
        version,
      );
      const plan = planHospitalMetricTemplateImport(expected, existing);
      const auditDetail = {
        templateVersion,
        metricVersion: version,
        requested: expected.length,
        created: plan.created.map((row) => row.code),
        skipped: plan.skipped,
        conflicts: plan.conflicts,
      };
      if (plan.conflicts.length) {
        await lineage(hospitalId, access.account.id, {
          action: "hospital_metric_template_conflict",
          resourceType: "hospital_metric_template",
          resourceId: templateVersion,
          detailJson: JSON.stringify(auditDetail),
        });
        return Response.json({ error: "hospital_metric_template_conflict", data: auditDetail }, { status: 409 });
      }
      if (plan.created.length) {
        const metricValues = plan.created.map((row) => ({
          ...row,
          id: `metric-${crypto.randomUUID()}`,
          hospitalId,
          createdByAccountId: access.account.id,
          updatedByAccountId: access.account.id,
          createdAt: now,
          updatedAt: now,
        }));
        try {
          await db.batch([
            db.insert(dataMetricDefinitions).values(metricValues),
            db.insert(dataLineageEvents).values({
              hospitalId,
              actorAccountId: access.account.id,
              action: "hospital_metric_template_imported",
              resourceType: "hospital_metric_template",
              resourceId: templateVersion,
              fromStatus: "",
              toStatus: "draft",
              detailJson: JSON.stringify(auditDetail),
            }),
          ] as const);
        } catch (error) {
          // A concurrent request can win the hospital+code+version unique-key
          // race after the first read. Re-read and classify instead of
          // overwriting, treating only an identical completed catalog as an
          // idempotent retry. Any partial or different state remains a failure.
          const racedExisting = await metricDefinitionsByCodesVersionInHospital(
            hospitalId,
            expected.map((row) => row.code),
            version,
          );
          const racedPlan = planHospitalMetricTemplateImport(expected, racedExisting);
          const racedDetail = {
            templateVersion,
            metricVersion: version,
            requested: expected.length,
            created: [],
            skipped: racedPlan.skipped,
            conflicts: racedPlan.conflicts,
          };
          if (racedPlan.conflicts.length) {
            await lineage(hospitalId, access.account.id, {
              action: "hospital_metric_template_conflict",
              resourceType: "hospital_metric_template",
              resourceId: templateVersion,
              detailJson: JSON.stringify(racedDetail),
            });
            return Response.json({ error: "hospital_metric_template_conflict", data: racedDetail }, { status: 409 });
          }
          if (!racedPlan.created.length) {
            await lineage(hospitalId, access.account.id, {
              action: "hospital_metric_template_imported",
              resourceType: "hospital_metric_template",
              resourceId: templateVersion,
              toStatus: "draft",
              detailJson: JSON.stringify(racedDetail),
            });
            return Response.json({ data: racedDetail }, { status: 200 });
          }
          throw error;
        }
      } else {
        await lineage(hospitalId, access.account.id, {
          action: "hospital_metric_template_imported",
          resourceType: "hospital_metric_template",
          resourceId: templateVersion,
          toStatus: "draft",
          detailJson: JSON.stringify(auditDetail),
        });
      }
      return Response.json({ data: auditDetail }, { status: plan.created.length ? 201 : 200 });
    }

    if (payload.action === "activate_hospital_metric_definition") {
      const denied = requirePermission(access, "data.review");
      if (denied) return denied;
      const id = safeIdentifier(payload.id, 180);
      if (!id) return Response.json({ error: "invalid_metric_definition" }, { status: 400 });
      const current = await metricDefinitionInHospital(hospitalId, id);
      if (!current) return Response.json({ error: "metric_definition_not_found" }, { status: 404 });
      const sourceFieldIds = optionalIdentifierArray(payload.sourceFieldDefinitionIds, 200);
      const dependencyMetricIds = optionalIdentifierArray(payload.dependencyMetricDefinitionIds, 100);
      if (!sourceFieldIds || !dependencyMetricIds || dependencyMetricIds.includes(id)) {
        return Response.json({ error: "invalid_metric_activation_bindings" }, { status: 400 });
      }
      const issues = hospitalMetricActivationIssues(
        current,
        { sourceFieldIds, dependencyMetricIds },
        registeredMetricTemplateVersions,
      );
      if (issues.length) {
        return Response.json({ error: "metric_activation_blocked", issues }, { status: 409 });
      }
      const [activeFields, activeDependencies] = await Promise.all([
        activeFieldDefinitionIdsInHospital(hospitalId, sourceFieldIds),
        activeMetricDefinitionIdsInHospital(hospitalId, dependencyMetricIds),
      ]);
      const activeFieldSet = new Set(activeFields.map((row) => row.id));
      const activeDependencySet = new Set(activeDependencies.map((row) => row.id));
      const missingSourceFieldIds = sourceFieldIds.filter((fieldId) => !activeFieldSet.has(fieldId));
      const missingDependencyMetricIds = dependencyMetricIds.filter((metricId) => !activeDependencySet.has(metricId));
      if (missingSourceFieldIds.length || missingDependencyMetricIds.length) {
        return Response.json({
          error: "metric_activation_dependencies_not_active",
          missingSourceFieldIds,
          missingDependencyMetricIds,
        }, { status: 409 });
      }
      const [row] = await db.update(dataMetricDefinitions).set({
        status: "active",
        updatedByAccountId: access.account.id,
        updatedAt: now,
      }).where(and(
        eq(dataMetricDefinitions.id, id),
        eq(dataMetricDefinitions.hospitalId, hospitalId),
        eq(dataMetricDefinitions.status, "draft"),
      )).returning();
      if (!row) return Response.json({ error: "metric_definition_activation_conflict" }, { status: 409 });
      await lineage(hospitalId, access.account.id, {
        action: "hospital_metric_definition_activated",
        resourceType: "metric_definition",
        resourceId: id,
        fromStatus: "draft",
        toStatus: "active",
        detailJson: JSON.stringify({
          code: row.code,
          version: row.version,
          sourceFieldDefinitionIds: sourceFieldIds,
          dependencyMetricDefinitionIds: dependencyMetricIds,
        }),
      });
      return Response.json({ data: row });
    }

    if (payload.action === "save_metric_definition") {
      const status = enumValue(payload.status ?? "draft", configStatuses);
      if (!status) return Response.json({ error: "invalid_metric_definition" }, { status: 400 });
      const denied = requirePermission(access, metadataPermission(status));
      if (denied) return denied;
      const id = payload.id ? safeIdentifier(payload.id, 180) : "";
      const current = id ? await metricDefinitionInHospital(hospitalId, id) : null;
      if (id && !current) return Response.json({ error: "metric_definition_not_found" }, { status: 404 });
      if (current && current.status !== "draft") return Response.json({ error: "active_definition_is_immutable" }, { status: 409 });
      if (current && status === "active" && (
        hospitalMetricCatalogCodes.has(current.code)
        || parseHospitalMetricTemplateMetadata(current.description)
      )) {
        return Response.json({ error: "hospital_metric_template_requires_activation_action" }, { status: 409 });
      }
      const code = safeIdentifier(payload.code, 120);
      const name = textValue(payload.name, 160);
      const formula = textValue(payload.formula, 4000);
      const aggregation = enumValue(payload.aggregation, metricAggregations);
      const numerator = textValue(payload.numerator, 2000, false);
      const denominator = textValue(payload.denominator, 2000, false);
      const dimensions = Array.isArray(payload.dimensions) ? payload.dimensions.map((item) => safeIdentifier(item, 120)) : null;
      const sourceFieldRefs = Array.isArray(payload.sourceFieldRefs) ? payload.sourceFieldRefs.map((item) => safeIdentifier(item, 180)) : null;
      const dimensionsJson = dimensions && !dimensions.some((item) => !item) ? jsonValue(dimensions, []) : null;
      const sourceFieldRefsJson = sourceFieldRefs && !sourceFieldRefs.some((item) => !item) ? jsonValue(sourceFieldRefs, []) : null;
      const unit = textValue(payload.unit, 80, false);
      const description = textValue(payload.description, 1000, false);
      const version = nonNegativeInteger(payload.version, 1);
      if (!code || !name || !formula || !aggregation || numerator === null || denominator === null || !dimensionsJson || !sourceFieldRefsJson || unit === null || description === null || !version) {
        return Response.json({ error: "invalid_metric_definition" }, { status: 400 });
      }
      if (status === "active" && (
        hospitalMetricCatalogCodes.has(code)
        || parseHospitalMetricTemplateMetadata(description ?? "")
      )) {
        return Response.json({ error: "hospital_metric_template_requires_activation_action" }, { status: 409 });
      }
      const resourceId = id || `metric-${crypto.randomUUID()}`;
      const values = {
        code, name, formula, aggregation: aggregation as typeof dataMetricDefinitions.$inferInsert.aggregation,
        numerator: numerator ?? "", denominator: denominator ?? "", dimensionsJson, sourceFieldRefsJson,
        unit: unit ?? "", description: description ?? "", version,
        status: status as typeof dataMetricDefinitions.$inferInsert.status,
        updatedByAccountId: access.account.id, updatedAt: now,
      };
      const [row] = current
        ? await db.update(dataMetricDefinitions).set(values).where(and(eq(dataMetricDefinitions.id, resourceId), eq(dataMetricDefinitions.hospitalId, hospitalId))).returning()
        : await db.insert(dataMetricDefinitions).values({ ...values, id: resourceId, hospitalId, createdByAccountId: access.account.id }).returning();
      await lineage(hospitalId, access.account.id, { action: current ? "metric_definition_updated" : "metric_definition_created", resourceType: "metric_definition", resourceId, toStatus: status, detailJson: JSON.stringify({ code, version, sourceFieldRefs }) });
      return Response.json({ data: row }, { status: current ? 200 : 201 });
    }

    if (payload.action === "save_visualization_definition") {
      const status = enumValue(payload.status ?? "draft", configStatuses);
      if (!status) return Response.json({ error: "invalid_visualization_definition" }, { status: 400 });
      const denied = requirePermission(access, metadataPermission(status));
      if (denied) return denied;
      const id = payload.id ? safeIdentifier(payload.id, 180) : "";
      const current = id ? await visualizationDefinitionInHospital(hospitalId, id) : null;
      if (id && !current) return Response.json({ error: "visualization_definition_not_found" }, { status: 404 });
      if (current && current.status !== "draft") return Response.json({ error: "active_definition_is_immutable" }, { status: 409 });
      const metricId = safeIdentifier(payload.metricId, 180);
      const metric = metricId ? await metricDefinitionInHospital(hospitalId, metricId) : null;
      if (!metric) return Response.json({ error: "metric_definition_not_found" }, { status: 404 });
      if (status === "active" && metric.status !== "active") return Response.json({ error: "visualization_metric_not_active" }, { status: 409 });
      const code = safeIdentifier(payload.code, 120);
      const name = textValue(payload.name, 160);
      const chartType = typeof payload.chartType === "string" ? payload.chartType.trim().toLowerCase() : "";
      const dimension = payload.dimension ? safeIdentifier(payload.dimension, 120) : "";
      const seriesJson = jsonValue(payload.series, [], 120_000);
      const sortJson = jsonValue(payload.sort, {}, 40_000);
      const configJson = jsonValue(payload.config, {}, 200_000);
      const limit = nonNegativeInteger(payload.limit, 20);
      const version = nonNegativeInteger(payload.version, 1);
      const chartTypes = new Set(["kpi", "table", "bar", "line", "pie", "scatter", "heatmap"]);
      const metricFields = new Set([
        ...JSON.parse(metric.dimensionsJson) as string[], ...JSON.parse(metric.sourceFieldRefsJson) as string[], metric.code,
      ]);
      const seriesValue = Array.isArray(payload.series) ? payload.series : [];
      const seriesFields = seriesValue.map((item) => typeof item === "string" ? item : isPlainRecord(item) && typeof item.field === "string" ? item.field : "").filter(Boolean);
      if (!code || !name || !chartTypes.has(chartType) || (dimension && !metricFields.has(dimension)) || seriesFields.some((field) => !metricFields.has(field)) || !seriesJson || !sortJson || !configJson || !limit || limit > 1000 || !version) {
        return Response.json({ error: "invalid_visualization_definition" }, { status: 400 });
      }
      const resourceId = id || `visual-${crypto.randomUUID()}`;
      const values = {
        code, name, metricId, chartType, dimension, seriesJson, sortJson, configJson, limit, version,
        status: status as typeof dataVisualizationDefinitions.$inferInsert.status,
        updatedByAccountId: access.account.id, updatedAt: now,
      };
      const [row] = current
        ? await db.update(dataVisualizationDefinitions).set(values).where(and(eq(dataVisualizationDefinitions.id, resourceId), eq(dataVisualizationDefinitions.hospitalId, hospitalId))).returning()
        : await db.insert(dataVisualizationDefinitions).values({ ...values, id: resourceId, hospitalId, createdByAccountId: access.account.id }).returning();
      await lineage(hospitalId, access.account.id, { action: current ? "visualization_definition_updated" : "visualization_definition_created", resourceType: "visualization_definition", resourceId, toStatus: status, detailJson: JSON.stringify({ code, version, metricId }) });
      return Response.json({ data: row }, { status: current ? 200 : 201 });
    }

    if (payload.action === "save_exam_event") {
      const denied = requirePermission(access, "data.ingest");
      if (denied) return denied;
      const id = payload.id ? safeIdentifier(payload.id, 180) : "";
      const current = id ? await examEventInHospital(hospitalId, id) : null;
      if (id && !current) return Response.json({ error: "exam_event_not_found" }, { status: 404 });
      const importJobId = payload.importJobId ? safeIdentifier(payload.importJobId, 180) : "";
      if (importJobId && !await importInHospital(hospitalId, importJobId)) return Response.json({ error: "import_not_found" }, { status: 404 });
      const sourceEventKey = safeIdentifier(payload.sourceEventKey, 180);
      const deviceKey = safeIdentifier(payload.deviceKey, 180);
      const encounterKey = payload.encounterKey ? safeIdentifier(payload.encounterKey, 180) : "";
      const patientKey = payload.patientKey ? safeIdentifier(payload.patientKey, 180) : "";
      const occurredAt = textValue(payload.occurredAt, 40);
      const revenueCents = nonNegativeInteger(payload.revenueCents);
      const metadata = payload.metadata ?? {};
      const metadataJson = !containsDirectPatientIdentifiers(metadata) ? jsonValue(metadata, {}, 80_000) : null;
      if (!sourceEventKey || !deviceKey || !occurredAt || revenueCents === null || !metadataJson || !Array.isArray(payload.bodyParts) || !payload.bodyParts.length || payload.bodyParts.length > 50) {
        return Response.json({ error: "invalid_exam_event" }, { status: 400 });
      }
      const bodyParts = payload.bodyParts.map((item, index) => {
        if (!isPlainRecord(item)) return null;
        const bodyPartCode = safeIdentifier(item.code, 80);
        const bodyPartName = textValue(item.name, 120);
        const sequence = nonNegativeInteger(item.sequence, index + 1);
        const weight = typeof item.weight === "number" && Number.isFinite(item.weight) && item.weight > 0 && item.weight <= 1 ? item.weight : null;
        return bodyPartCode && bodyPartName && sequence !== null && weight !== null
          ? { bodyPartCode, bodyPartName, sequence, weight, isPrimary: item.isPrimary === true }
          : null;
      });
      const validParts = bodyParts.filter((part): part is NonNullable<typeof part> => Boolean(part));
      const weightSum = validParts.reduce((sum, part) => sum + part.weight, 0);
      if (validParts.length !== bodyParts.length || new Set(validParts.map((part) => part.bodyPartCode)).size !== validParts.length || validParts.filter((part) => part.isPrimary).length !== 1 || Math.abs(weightSum - 1) > 0.000001) {
        return Response.json({ error: "invalid_body_part_allocation" }, { status: 400 });
      }
      const resourceId = id || `exam-${crypto.randomUUID()}`;
      const values = { importJobId: importJobId || null, sourceEventKey, deviceKey, encounterKey, patientKey, occurredAt, revenueCents, metadataJson, updatedAt: now };
      const [row] = current
        ? await db.update(dataExamEvents).set(values).where(and(eq(dataExamEvents.id, resourceId), eq(dataExamEvents.hospitalId, hospitalId))).returning()
        : await db.insert(dataExamEvents).values({ ...values, id: resourceId, hospitalId, createdByAccountId: access.account.id }).returning();
      if (current) await db.delete(dataExamEventBodyParts).where(and(eq(dataExamEventBodyParts.hospitalId, hospitalId), eq(dataExamEventBodyParts.examEventId, resourceId)));
      for (const part of validParts) {
        await db.insert(dataExamEventBodyParts).values({ id: `bodypart-${crypto.randomUUID()}`, hospitalId, examEventId: resourceId, ...part });
      }
      await lineage(hospitalId, access.account.id, { action: current ? "exam_event_updated" : "exam_event_created", resourceType: "exam_event", resourceId, importJobId: importJobId || null, detailJson: JSON.stringify({ sourceEventKey, bodyPartCount: validParts.length, allocationWeight: weightSum }) });
      return Response.json({ data: { ...row, bodyParts: validParts } }, { status: current ? 200 : 201 });
    }

    if (payload.action === "create_recipe" || payload.action === "update_recipe") {
      const denied = requirePermission(access, "data.clean");
      if (denied) return denied;
      const dataDomain = safeIdentifier(payload.dataDomain, 100);
      const name = textValue(payload.name, 120);
      const description = textValue(payload.description, 1000, false);
      const version = nonNegativeInteger(payload.version, 1);
      const status = enumValue(payload.status ?? "draft", configStatuses);
      if (!dataDomain || !name || description === null || !version || !status || !Array.isArray(payload.rules) || payload.rules.length > 200) {
        return Response.json({ error: "invalid_recipe" }, { status: 400 });
      }
      const rules = payload.rules.map((item, index) => {
        if (!isPlainRecord(item)) return null;
        const ruleType = safeIdentifier(item.ruleType, 80);
        const fieldName = item.fieldName === undefined ? "" : safeIdentifier(item.fieldName, 160);
        const configJson = jsonValue(item.config, {}, 50_000);
        const sequence = nonNegativeInteger(item.sequence, index + 1);
        return ruleType && cleaningRuleTypes.has(ruleType) && configJson && sequence !== null
          ? { ruleType, fieldName, configJson, sequence, enabled: item.enabled !== false }
          : null;
      });
      if (rules.some((rule) => !rule) || new Set(rules.map((rule) => rule?.sequence)).size !== rules.length) {
        return Response.json({ error: "invalid_cleaning_rules" }, { status: 400 });
      }
      let id: string;
      if (payload.action === "create_recipe") {
        id = `recipe-${crypto.randomUUID()}`;
        await db.insert(dataCleaningRecipes).values({
          id, hospitalId, dataDomain, name, description: description ?? "", version,
          status: status as typeof dataCleaningRecipes.$inferInsert.status,
          createdByAccountId: access.account.id, updatedByAccountId: access.account.id,
        });
      } else {
        id = safeIdentifier(payload.id, 180);
        const current = id ? await recipeInHospital(hospitalId, id) : null;
        if (!current) return Response.json({ error: "recipe_not_found" }, { status: 404 });
        if (current.status !== "draft") return Response.json({ error: "active_recipe_is_immutable" }, { status: 409 });
        const [recipeReference] = await db.select({ id: dataDatasetSnapshots.id }).from(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.recipeId, id))).limit(1);
        if (recipeReference) return Response.json({ error: "recipe_is_referenced_create_new_version" }, { status: 409 });
        await db.update(dataCleaningRecipes).set({
          dataDomain, name, description: description ?? "", version,
          status: status as typeof dataCleaningRecipes.$inferInsert.status,
          updatedByAccountId: access.account.id, updatedAt: now,
        }).where(and(eq(dataCleaningRecipes.id, id), eq(dataCleaningRecipes.hospitalId, hospitalId)));
        await db.delete(dataCleaningRules).where(and(eq(dataCleaningRules.hospitalId, hospitalId), eq(dataCleaningRules.recipeId, id)));
      }
      for (const rule of rules) {
        if (!rule) continue;
        await db.insert(dataCleaningRules).values({ id: `rule-${crypto.randomUUID()}`, hospitalId, recipeId: id, ...rule });
      }
      const row = await recipeInHospital(hospitalId, id);
      await lineage(hospitalId, access.account.id, { action: payload.action === "create_recipe" ? "recipe_created" : "recipe_updated", resourceType: "recipe", resourceId: id, ruleVersion: `${name}@${version}` });
      return Response.json({ data: row }, { status: payload.action === "create_recipe" ? 201 : 200 });
    }

    if (payload.action === "apply_mapping") {
      const denied = requirePermission(access, "data.clean");
      if (denied) return denied;
      const importId = safeIdentifier(payload.importId, 180);
      const mappingId = safeIdentifier(payload.mappingId, 180);
      const importJob = importId ? await importInHospital(hospitalId, importId) : null;
      const mapping = mappingId ? await mappingInHospital(hospitalId, mappingId) : null;
      if (!importJob) return Response.json({ error: "import_not_found" }, { status: 404 });
      if (!mapping) return Response.json({ error: "mapping_not_found" }, { status: 404 });
      if (importJob.status !== "pending_mapping") return Response.json({ error: "import_state_conflict" }, { status: 409 });
      const mappingContentSha256 = await sha256Hex(stableStringify({ mappingJson: JSON.parse(mapping.mappingJson), version: mapping.version, name: mapping.name }));
      const idempotencyKey = safeIdentifier(payload.idempotencyKey, 180) || `mapping-${importId}-${mappingId}-${mappingContentSha256.slice(0, 20)}`;
      const state = await idempotencyState(hospitalId, payload.action, idempotencyKey, { ...payload, mappingContentSha256 });
      if ("conflict" in state) return Response.json({ error: "idempotency_key_conflict" }, { status: 409 });
      if ("existing" in state) return Response.json(state.response);
      const [rawSnapshot] = await db.select().from(dataDatasetSnapshots).where(and(
        eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, importId),
        eq(dataDatasetSnapshots.layer, "raw"), eq(dataDatasetSnapshots.status, "ready"),
      )).orderBy(desc(dataDatasetSnapshots.version)).limit(1);
      if (!rawSnapshot) return Response.json({ error: "raw_snapshot_not_ready" }, { status: 409 });
      const mappingFields = normalizeFieldMapping(JSON.parse(mapping.mappingJson));
      if (!mappingFields.length) return Response.json({ error: "mapping_has_no_fields" }, { status: 409 });
      const rawRows = await snapshotRecords(hospitalId, rawSnapshot.id, ["valid"]);
      if (rawRows.length !== rawSnapshot.rowCount) return Response.json({ error: "raw_snapshot_row_count_mismatch" }, { status: 409 });
      const profile = JSON.parse(rawSnapshot.profileJson) as Record<string, unknown>;
      const templateCode = typeof profile.templateCode === "string" ? profile.templateCode : importJob.businessTemplateCode;
      const recordTypeByTemplate: Record<string, string> = {
        device_master: "device", exam_activity: "exam", billing_revenue: "billing", cost_detail: "cost_detail",
        maintenance: "maintenance", utilization: "utilization", quality_safety: "quality", target_budget: "metric",
      };
      const mapped = applyFieldMapping(rawRows.map((row) => row.record), mappingFields, templateCode).map((record) => ({
        ...record,
        recordType: record.recordType ?? recordTypeByTemplate[templateCode] ?? "metric",
      }));
      const [latest] = await db.select({ version: dataDatasetSnapshots.version }).from(dataDatasetSnapshots).where(and(
        eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, importId), eq(dataDatasetSnapshots.layer, "staging"),
      )).orderBy(desc(dataDatasetSnapshots.version)).limit(1);
      const snapshot = await createDatasetSnapshot({
        hospitalId, accountId: access.account.id, importJobId: importId, layer: "staging", version: (latest?.version ?? 0) + 1,
        parentSnapshotId: rawSnapshot.id, mappingId: mapping.id, mappingVersion: `${mapping.name}@${mapping.version}`,
        templateCode, dataDomain: importJob.dataDomain, headers: [...new Set(mapped.flatMap((record) => Object.keys(record).filter((key) => key !== "_lineage")))],
        profile: { templateCode, dataDomain: importJob.dataDomain, sourceSnapshotId: rawSnapshot.id, requiredFields: Array.isArray(profile.requiredFields) ? profile.requiredFields : [], mappingContentSha256, mapping: mappingFields },
        records: mapped.map((record, index) => ({ sourceRowNumber: rawRows[index].sourceRowNumber, sourceRecordId: rawRows[index].sourceRecordId, record })),
      });
      const response = { data: { snapshot, impact: { inputRows: rawRows.length, outputRows: mapped.length, mappedFields: mappingFields.length, before: rawRows.slice(0, 5).map((row) => row.record), after: mapped.slice(0, 5) } } };
      const [advancedImport] = await db.update(dataImportJobs).set({ status: "validating", updatedAt: now, revision: sql`${dataImportJobs.revision} + 1` }).where(and(eq(dataImportJobs.id, importId), eq(dataImportJobs.hospitalId, hospitalId), eq(dataImportJobs.status, "pending_mapping"))).returning({ id: dataImportJobs.id });
      if (!advancedImport) {
        await db.delete(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.id, snapshot.id))).catch(() => undefined);
        await deletePipelineObject(snapshot.objectKey).catch(() => undefined);
        return Response.json({ error: "import_state_conflict" }, { status: 409 });
      }
      await saveIdempotency({ hospitalId, action: payload.action, key: idempotencyKey, requestSha256: state.requestSha256, resourceType: "snapshot", resourceId: snapshot.id, response });
      await lineage(hospitalId, access.account.id, { action: "mapping_applied", resourceType: "snapshot", resourceId: snapshot.id, importJobId: importId, fromStatus: "raw", toStatus: "staging", mappingVersion: `${mapping.name}@${mapping.version}`, detailJson: JSON.stringify(response.data.impact) });
      return Response.json(response, { status: 201 });
    }

    if (payload.action === "run_cleaning") {
      const denied = requirePermission(access, "data.clean");
      if (denied) return denied;
      const importId = safeIdentifier(payload.importId, 180);
      const recipeId = safeIdentifier(payload.recipeId, 180);
      const importJob = importId ? await importInHospital(hospitalId, importId) : null;
      const recipe = recipeId ? await recipeInHospital(hospitalId, recipeId) : null;
      if (!importJob) return Response.json({ error: "import_not_found" }, { status: 404 });
      if (!recipe) return Response.json({ error: "recipe_not_found" }, { status: 404 });
      if (importJob.status !== "validating") return Response.json({ error: "import_state_conflict" }, { status: 409 });
      const storedRules = await db.select().from(dataCleaningRules).where(and(eq(dataCleaningRules.hospitalId, hospitalId), eq(dataCleaningRules.recipeId, recipeId))).orderBy(dataCleaningRules.sequence);
      const ruleContentSha256 = await sha256Hex(stableStringify({ recipe: { id: recipe.id, name: recipe.name, version: recipe.version }, rules: storedRules.map((rule) => ({ sequence: rule.sequence, ruleType: rule.ruleType, fieldName: rule.fieldName, configJson: rule.configJson, enabled: rule.enabled })) }));
      const idempotencyKey = safeIdentifier(payload.idempotencyKey, 180) || `clean-${importId}-${recipeId}-${ruleContentSha256.slice(0, 20)}`;
      const state = await idempotencyState(hospitalId, payload.action, idempotencyKey, { ...payload, ruleContentSha256 });
      if ("conflict" in state) return Response.json({ error: "idempotency_key_conflict" }, { status: 409 });
      if ("existing" in state) return Response.json(state.response);
      const [staging] = await db.select().from(dataDatasetSnapshots).where(and(
        eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, importId),
        eq(dataDatasetSnapshots.layer, "staging"), eq(dataDatasetSnapshots.status, "ready"),
      )).orderBy(desc(dataDatasetSnapshots.version)).limit(1);
      if (!staging) return Response.json({ error: "staging_snapshot_not_ready" }, { status: 409 });
      const inputRows = await snapshotRecords(hospitalId, staging.id, ["valid"]);
      const rules: CleaningRuleContract[] = storedRules.map((rule) => ({ id: rule.id, sequence: rule.sequence, ruleType: rule.ruleType, fieldName: rule.fieldName, config: JSON.parse(rule.configJson), enabled: rule.enabled }));
      const stagingProfile = JSON.parse(staging.profileJson) as Record<string, unknown>;
      const requiredFields = Array.isArray(stagingProfile.requiredFields)
        ? stagingProfile.requiredFields.filter((field): field is string => typeof field === "string")
        : [];
      const transformed = executeCleaningRules(inputRows.map((row) => row.record), rules, requiredFields);
      const issuesByRow = new Map<number, typeof transformed.issues>();
      for (const issue of transformed.issues) issuesByRow.set(issue.recordIndex, [...(issuesByRow.get(issue.recordIndex) ?? []), issue]);
      const [latest] = await db.select({ version: dataDatasetSnapshots.version }).from(dataDatasetSnapshots).where(and(
        eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, importId), eq(dataDatasetSnapshots.layer, "curated"),
      )).orderBy(desc(dataDatasetSnapshots.version)).limit(1);
      const templateCode = typeof stagingProfile.templateCode === "string" ? stagingProfile.templateCode : importJob.businessTemplateCode;
      const snapshot = await createDatasetSnapshot({
        hospitalId, accountId: access.account.id, importJobId: importId, layer: "curated", version: (latest?.version ?? 0) + 1,
        parentSnapshotId: staging.id, mappingId: staging.mappingId, recipeId: recipe.id,
        mappingVersion: staging.mappingVersion, ruleVersion: `${recipe.name}@${recipe.version}`,
        templateCode, dataDomain: importJob.dataDomain,
        headers: [...new Set(transformed.records.flatMap((record) => Object.keys(record).filter((key) => key !== "_lineage")))],
        profile: { templateCode, dataDomain: importJob.dataDomain, requiredFields, impacts: transformed.impacts, issueCount: transformed.issues.length, ruleContentSha256, rules },
        records: transformed.records.map((record, index) => ({
          sourceRowNumber: inputRows[index].sourceRowNumber, sourceRecordId: inputRows[index].sourceRecordId, record,
          status: (issuesByRow.get(index) ?? []).some((issue) => issue.severity === "blocker") ? "quarantined" : "valid",
          errorCount: (issuesByRow.get(index) ?? []).length,
        })),
      });
      const persistedRows = await db.select().from(dataPipelineRecords).where(and(eq(dataPipelineRecords.hospitalId, hospitalId), eq(dataPipelineRecords.snapshotId, snapshot.id))).orderBy(dataPipelineRecords.sourceRowNumber);
      for (const issue of transformed.issues) {
        const record = persistedRows[issue.recordIndex];
        if (!record) continue;
        await db.insert(dataRecordIssues).values({
          id: `record-issue-${crypto.randomUUID()}`, hospitalId, snapshotId: snapshot.id, recordId: record.id,
          fieldName: issue.fieldName, ruleCode: issue.ruleCode, severity: issue.severity, message: issue.message,
          beforeJson: JSON.stringify(issue.before ?? null), afterJson: JSON.stringify(issue.after ?? null),
        });
      }
      const quarantinedCount = persistedRows.filter((row) => row.status === "quarantined").length;
      const response = { data: { snapshot, impact: { steps: transformed.impacts, inputRows: inputRows.length, validRows: inputRows.length - quarantinedCount, quarantinedRows: quarantinedCount, issueCount: transformed.issues.length } } };
      const [advancedImport] = await db.update(dataImportJobs).set({ status: "pending_review", acceptedCount: inputRows.length - quarantinedCount, rejectedCount: quarantinedCount, updatedAt: now, revision: sql`${dataImportJobs.revision} + 1` }).where(and(eq(dataImportJobs.id, importId), eq(dataImportJobs.hospitalId, hospitalId), eq(dataImportJobs.status, "validating"))).returning({ id: dataImportJobs.id });
      if (!advancedImport) {
        await db.delete(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.id, snapshot.id))).catch(() => undefined);
        await deletePipelineObject(snapshot.objectKey).catch(() => undefined);
        return Response.json({ error: "import_state_conflict" }, { status: 409 });
      }
      await saveIdempotency({ hospitalId, action: payload.action, key: idempotencyKey, requestSha256: state.requestSha256, resourceType: "snapshot", resourceId: snapshot.id, response });
      await lineage(hospitalId, access.account.id, { action: "cleaning_completed", resourceType: "snapshot", resourceId: snapshot.id, importJobId: importId, fromStatus: "staging", toStatus: "curated", mappingVersion: staging.mappingVersion, ruleVersion: `${recipe.name}@${recipe.version}`, detailJson: JSON.stringify(response.data.impact) });
      return Response.json(response, { status: 201 });
    }

    if (payload.action === "repair_quarantine") {
      const denied = requirePermission(access, "data.clean");
      if (denied) return denied;
      const snapshotId = safeIdentifier(payload.snapshotId, 180);
      const rowId = safeIdentifier(payload.rowId, 180);
      const revision = nonNegativeInteger(payload.baseRevision);
      const comment = textValue(payload.comment, 1000);
      if (!snapshotId || !rowId || !revision || !comment || !isPlainRecord(payload.patch) || containsDirectPatientIdentifiers(payload.patch)) return Response.json({ error: "invalid_quarantine_repair" }, { status: 400 });
      const snapshot = await snapshotInHospital(hospitalId, snapshotId);
      if (!snapshot || snapshot.layer !== "curated" || snapshot.status !== "ready") return Response.json({ error: "curated_snapshot_not_found" }, { status: 404 });
      const repairImport = snapshot.importJobId ? await importInHospital(hospitalId, snapshot.importJobId) : null;
      if (!repairImport || repairImport.status !== "pending_review") return Response.json({ error: "import_state_conflict" }, { status: 409 });
      const [latestReadySnapshot] = snapshot.importJobId ? await db.select({ id: dataDatasetSnapshots.id }).from(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, snapshot.importJobId), eq(dataDatasetSnapshots.layer, "curated"), eq(dataDatasetSnapshots.status, "ready"))).orderBy(desc(dataDatasetSnapshots.version)).limit(1) : [];
      if (!latestReadySnapshot || latestReadySnapshot.id !== snapshot.id) return Response.json({ error: "stale_curated_snapshot" }, { status: 409 });
      const [record] = await db.select().from(dataPipelineRecords).where(and(eq(dataPipelineRecords.hospitalId, hospitalId), eq(dataPipelineRecords.snapshotId, snapshotId), eq(dataPipelineRecords.id, rowId))).limit(1);
      if (!record) return Response.json({ error: "quarantine_record_not_found" }, { status: 404 });
      if (record.revision !== revision) return Response.json({ error: "revision_conflict" }, { status: 409 });
      const before = JSON.parse(record.recordJson) as Record<string, unknown>;
      const patched: Record<string, unknown> = { ...before, ...payload.patch, _lineage: before._lineage };
      const snapshotProfile = JSON.parse(snapshot.profileJson) as Record<string, unknown>;
      const requiredFields = Array.isArray(snapshotProfile.requiredFields) ? snapshotProfile.requiredFields.filter((field): field is string => typeof field === "string") : [];
      const frozenRules = Array.isArray(snapshotProfile.rules) ? snapshotProfile.rules.filter(isPlainRecord).map((rule) => ({ id: String(rule.id ?? ""), sequence: Number(rule.sequence ?? 0), ruleType: String(rule.ruleType ?? ""), fieldName: String(rule.fieldName ?? ""), config: isPlainRecord(rule.config) ? rule.config : {}, enabled: rule.enabled !== false })) : [];
      const checked = executeCleaningRules([patched], frozenRules, requiredFields);
      const after = checked.records[0] ?? patched;
      const valid = !checked.issues.some((issue) => issue.severity === "blocker") && !containsDirectPatientIdentifiers(after);
      const oldRows = await snapshotRecords(hospitalId, snapshot.id, ["valid", "quarantined", "excluded"]);
      const oldOpenIssues = await db.select().from(dataRecordIssues).where(and(eq(dataRecordIssues.hospitalId, hospitalId), eq(dataRecordIssues.snapshotId, snapshot.id), eq(dataRecordIssues.status, "open")));
      const [latest] = await db.select({ version: dataDatasetSnapshots.version }).from(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), snapshot.importJobId ? eq(dataDatasetSnapshots.importJobId, snapshot.importJobId) : isNull(dataDatasetSnapshots.importJobId), eq(dataDatasetSnapshots.layer, "curated"))).orderBy(desc(dataDatasetSnapshots.version)).limit(1);
      const corrected = await createDatasetSnapshot({
        hospitalId, accountId: access.account.id, importJobId: snapshot.importJobId, layer: "curated", version: (latest?.version ?? snapshot.version) + 1,
        parentSnapshotId: snapshot.id, mappingId: snapshot.mappingId, recipeId: snapshot.recipeId, mappingVersion: snapshot.mappingVersion, ruleVersion: snapshot.ruleVersion,
        templateCode: typeof snapshotProfile.templateCode === "string" ? snapshotProfile.templateCode : "generic", dataDomain: typeof snapshotProfile.dataDomain === "string" ? snapshotProfile.dataDomain : "generic",
        headers: JSON.parse(snapshot.headersJson), profile: { ...snapshotProfile, correctionOfSnapshotId: snapshot.id, correctionComment: comment },
        records: oldRows.map((row) => ({ sourceRowNumber: row.sourceRowNumber, sourceRecordId: row.sourceRecordId, record: row.id === rowId ? after : row.record, status: row.id === rowId ? valid ? "valid" : "quarantined" : row.status, errorCount: row.id === rowId ? checked.issues.length : row.errorCount })),
      });
      const [claimedParent] = await db.update(dataDatasetSnapshots).set({ status: "superseded" }).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.id, snapshot.id), eq(dataDatasetSnapshots.status, "ready"))).returning({ id: dataDatasetSnapshots.id });
      if (!claimedParent) {
        await db.delete(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.id, corrected.id))).catch(() => undefined);
        await deletePipelineObject(corrected.objectKey).catch(() => undefined);
        return Response.json({ error: "repair_state_conflict_retry" }, { status: 409 });
      }
      const correctedRows = await db.select().from(dataPipelineRecords).where(and(eq(dataPipelineRecords.hospitalId, hospitalId), eq(dataPipelineRecords.snapshotId, corrected.id)));
      const oldRowById = new Map(oldRows.map((row) => [row.id, row]));
      const correctedBySource = new Map(correctedRows.map((row) => [row.sourceRecordId, row]));
      const updated = correctedBySource.get(record.sourceRecordId);
      try {
        for (const issue of oldOpenIssues.filter((item) => item.recordId !== rowId)) {
          const oldRow = oldRowById.get(issue.recordId);
          const nextRow = oldRow ? correctedBySource.get(oldRow.sourceRecordId) : null;
          if (!nextRow) continue;
          await db.insert(dataRecordIssues).values({ id: `record-issue-${crypto.randomUUID()}`, hospitalId, snapshotId: corrected.id, recordId: nextRow.id, fieldName: issue.fieldName, ruleCode: issue.ruleCode, severity: issue.severity, message: issue.message, beforeJson: issue.beforeJson, afterJson: issue.afterJson });
        }
        if (updated) for (const issue of checked.issues) await db.insert(dataRecordIssues).values({ id: `record-issue-${crypto.randomUUID()}`, hospitalId, snapshotId: corrected.id, recordId: updated.id, fieldName: issue.fieldName, ruleCode: issue.ruleCode, severity: issue.severity, message: issue.message, beforeJson: JSON.stringify(issue.before ?? null), afterJson: JSON.stringify(issue.after ?? null) });
        await db.update(dataRecordIssues).set({ status: "resolved", resolutionComment: `已由更正快照 ${corrected.id} 取代：${comment}`, resolvedByAccountId: access.account.id, resolvedAt: now, updatedAt: now }).where(and(eq(dataRecordIssues.hospitalId, hospitalId), eq(dataRecordIssues.snapshotId, snapshot.id), eq(dataRecordIssues.status, "open")));
      } catch {
        await db.update(dataDatasetSnapshots).set({ status: "ready" }).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.id, snapshot.id), eq(dataDatasetSnapshots.status, "superseded"))).catch(() => undefined);
        await db.delete(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.id, corrected.id))).catch(() => undefined);
        await deletePipelineObject(corrected.objectKey).catch(() => undefined);
        return Response.json({ error: "quarantine_repair_persistence_failed" }, { status: 500 });
      }
      const nextHash = await sha256Hex(stableStringify(after));
      await lineage(hospitalId, access.account.id, { action: "quarantine_record_repaired", resourceType: "snapshot", resourceId: corrected.id, datasetVersion: corrected.id, detailJson: JSON.stringify({ comment, parentSnapshotId: snapshot.id, sourceRecordId: record.sourceRecordId, beforeHash: record.recordSha256, afterHash: nextHash, valid }) });
      return Response.json({ data: { snapshot: corrected, row: updated ? { ...updated, record: redactSensitive(after) } : null, valid, issues: checked.issues } }, { status: 201 });
    }

    if (payload.action === "create_reconciliation_config" || payload.action === "update_reconciliation_config") {
      const denied = requirePermission(access, "data.clean");
      if (denied) return denied;
      const name = textValue(payload.name, 160);
      const leftKeyFields = stringArray(payload.leftKeyFields, 20);
      const rightKeyFields = stringArray(payload.rightKeyFields, 20);
      const compareFields = optionalIdentifierArray(payload.compareFields, 100);
      const toleranceJson = jsonValue(payload.tolerance, {}, 20_000);
      const status = enumValue(payload.status ?? "draft", configStatuses);
      const version = nonNegativeInteger(payload.version, 1);
      if (!name || !leftKeyFields || !rightKeyFields || !compareFields || !toleranceJson || !status || !version || leftKeyFields.length !== rightKeyFields.length) return Response.json({ error: "invalid_reconciliation_config" }, { status: 400 });
      const id = payload.action === "create_reconciliation_config" ? `recon-config-${crypto.randomUUID()}` : safeIdentifier(payload.id, 180);
      const [existing] = payload.action === "update_reconciliation_config" ? await db.select().from(dataReconciliationConfigs).where(and(eq(dataReconciliationConfigs.id, id), eq(dataReconciliationConfigs.hospitalId, hospitalId))).limit(1) : [];
      if (payload.action === "update_reconciliation_config" && !existing) return Response.json({ error: "reconciliation_config_not_found" }, { status: 404 });
      const values = { name, leftKeyFieldsJson: JSON.stringify(leftKeyFields), rightKeyFieldsJson: JSON.stringify(rightKeyFields), compareFieldsJson: JSON.stringify(compareFields), toleranceJson, status: status as typeof dataReconciliationConfigs.$inferInsert.status, version, updatedByAccountId: access.account.id, updatedAt: now };
      const [row] = existing
        ? await db.update(dataReconciliationConfigs).set(values).where(and(eq(dataReconciliationConfigs.id, id), eq(dataReconciliationConfigs.hospitalId, hospitalId))).returning()
        : await db.insert(dataReconciliationConfigs).values({ ...values, id, hospitalId, createdByAccountId: access.account.id }).returning();
      return Response.json({ data: row }, { status: existing ? 200 : 201 });
    }

    if (payload.action === "run_reconciliation") {
      const denied = requirePermission(access, "data.clean");
      if (denied) return denied;
      const configId = safeIdentifier(payload.configId, 180);
      const leftSnapshotId = safeIdentifier(payload.leftSnapshotId, 180);
      const rightSnapshotId = safeIdentifier(payload.rightSnapshotId, 180);
      const idempotencyKey = safeIdentifier(payload.idempotencyKey, 180) || `reconcile-${configId}-${leftSnapshotId}-${rightSnapshotId}`;
      const [config] = await db.select().from(dataReconciliationConfigs).where(and(eq(dataReconciliationConfigs.id, configId), eq(dataReconciliationConfigs.hospitalId, hospitalId))).limit(1);
      const leftSnapshot = await snapshotInHospital(hospitalId, leftSnapshotId);
      const rightSnapshot = await snapshotInHospital(hospitalId, rightSnapshotId);
      if (!config) return Response.json({ error: "reconciliation_config_not_found" }, { status: 404 });
      if (leftSnapshotId === rightSnapshotId) return Response.json({ error: "reconciliation_snapshots_must_differ" }, { status: 400 });
      if (!leftSnapshot || !rightSnapshot || !["ready", "published"].includes(leftSnapshot.status) || !["ready", "published"].includes(rightSnapshot.status)) return Response.json({ error: "reconciliation_snapshot_not_ready" }, { status: 409 });
      const [existing] = await db.select().from(dataReconciliationRuns).where(and(eq(dataReconciliationRuns.hospitalId, hospitalId), eq(dataReconciliationRuns.idempotencyKey, idempotencyKey))).limit(1);
      if (existing) return Response.json({ data: existing });
      const leftFields = JSON.parse(config.leftKeyFieldsJson) as string[];
      const rightFields = JSON.parse(config.rightKeyFieldsJson) as string[];
      const compareFields = JSON.parse(config.compareFieldsJson) as string[];
      const [leftRows, rightRows] = await Promise.all([snapshotRecords(hospitalId, leftSnapshotId, ["valid"]), snapshotRecords(hospitalId, rightSnapshotId, ["valid"])]);
      let leftGroups: ReturnType<typeof groupReconciliationRows<typeof leftRows[number]>>;
      let rightGroups: ReturnType<typeof groupReconciliationRows<typeof rightRows[number]>>;
      try { leftGroups = groupReconciliationRows(leftRows, leftFields); rightGroups = groupReconciliationRows(rightRows, rightFields); }
      catch { return Response.json({ error: "reconciliation_blank_key" }, { status: 409 }); }
      const leftMap = new Map([...leftGroups].map(([key, rows]) => [key, rows[0]]));
      const rightMap = new Map([...rightGroups].map(([key, rows]) => [key, rows[0]]));
      const tolerance = JSON.parse(config.toleranceJson) as Record<string, unknown>;
      const valuesEqual = (field: string, left: unknown, right: unknown) => {
        const rule = isPlainRecord(tolerance[field]) ? tolerance[field] as Record<string, unknown> : isPlainRecord(tolerance.default) ? tolerance.default as Record<string, unknown> : {};
        if (typeof left === "number" && typeof right === "number") {
          const absolute = typeof rule.absolute === "number" && rule.absolute >= 0 ? rule.absolute : 0;
          const relative = typeof rule.relative === "number" && rule.relative >= 0 ? rule.relative : 0;
          return reconciliationValuesEqual(left, right, { absolute, relative });
        }
        return reconciliationValuesEqual(left, right, rule);
      };
      const keys = new Set([...leftMap.keys(), ...rightMap.keys()]);
      const differences: Array<{ matchKey: string; differenceType: "left_only" | "right_only" | "value_mismatch"; fieldName: string; leftRecordId: string | null; rightRecordId: string | null; leftValue: unknown; rightValue: unknown }> = [];
      let matchedCount = 0;
      for (const key of keys) {
        const duplicateLeft = leftGroups.get(key) ?? [];
        const duplicateRight = rightGroups.get(key) ?? [];
        if (duplicateLeft.length > 1 || duplicateRight.length > 1) {
          differences.push({ matchKey: key, differenceType: "value_mismatch", fieldName: "__duplicate_key", leftRecordId: duplicateLeft[0]?.id ?? null, rightRecordId: duplicateRight[0]?.id ?? null, leftValue: duplicateLeft.map((row) => row.id), rightValue: duplicateRight.map((row) => row.id) });
          continue;
        }
        const left = leftMap.get(key); const right = rightMap.get(key);
        if (!left) differences.push({ matchKey: key, differenceType: "right_only", fieldName: "", leftRecordId: null, rightRecordId: right?.id ?? null, leftValue: null, rightValue: right?.record ?? null });
        else if (!right) differences.push({ matchKey: key, differenceType: "left_only", fieldName: "", leftRecordId: left.id, rightRecordId: null, leftValue: left.record, rightValue: null });
        else {
          let mismatch = false;
          for (const field of compareFields) if (!valuesEqual(field, left.record[field], right.record[field])) {
            mismatch = true; differences.push({ matchKey: key, differenceType: "value_mismatch", fieldName: field, leftRecordId: left.id, rightRecordId: right.id, leftValue: left.record[field], rightValue: right.record[field] });
          }
          if (!mismatch) matchedCount += 1;
        }
        if (differences.length > 20_000) return Response.json({ error: "reconciliation_difference_limit_exceeded" }, { status: 413 });
      }
      const runId = `recon-${crypto.randomUUID()}`;
      await db.insert(dataReconciliationRuns).values({ id: runId, hospitalId, configId, leftSnapshotId, rightSnapshotId, status: "running", idempotencyKey, createdByAccountId: access.account.id });
      for (let offset = 0; offset < differences.length; offset += 50) {
        const statements = differences.slice(offset, offset + 50).map((difference) => db.insert(dataReconciliationDifferences).values({
          id: `recon-diff-${crypto.randomUUID()}`, hospitalId, runId, matchKey: difference.matchKey, differenceType: difference.differenceType,
          fieldName: difference.fieldName, leftRecordId: difference.leftRecordId, rightRecordId: difference.rightRecordId,
          leftValueJson: JSON.stringify(difference.leftValue ?? null), rightValueJson: JSON.stringify(difference.rightValue ?? null),
        }));
        if (statements.length) await db.batch([statements[0], ...statements.slice(1)]);
      }
      const counts = { matchedCount, leftOnlyCount: differences.filter((item) => item.differenceType === "left_only").length, rightOnlyCount: differences.filter((item) => item.differenceType === "right_only").length, mismatchCount: differences.filter((item) => item.differenceType === "value_mismatch" && item.fieldName !== "__duplicate_key").length, duplicateKeyCount: differences.filter((item) => item.fieldName === "__duplicate_key").length };
      const [run] = await db.update(dataReconciliationRuns).set({ status: "completed", ...counts, completedAt: now }).where(and(eq(dataReconciliationRuns.id, runId), eq(dataReconciliationRuns.hospitalId, hospitalId))).returning();
      await lineage(hospitalId, access.account.id, { action: "reconciliation_completed", resourceType: "reconciliation", resourceId: runId, detailJson: JSON.stringify(counts) });
      return Response.json({ data: { run, differences: differences.slice(0, 200) } }, { status: 201 });
    }

    if (payload.action === "create_quality_issue" || payload.action === "update_quality_issue") {
      const targetStatus = typeof payload.status === "string" ? payload.status : "open";
      const permission: DataWorkbenchPermission = targetStatus === "waived" ? "data.review" : "data.clean";
      const denied = requirePermission(access, permission);
      if (denied) return denied;
      if (payload.action === "create_quality_issue") {
        const importJobId = payload.importJobId ? safeIdentifier(payload.importJobId, 180) : "";
        const rawDatasetId = payload.rawDatasetId ? safeIdentifier(payload.rawDatasetId, 180) : "";
        if (importJobId && !await importInHospital(hospitalId, importJobId)) return Response.json({ error: "import_not_found" }, { status: 404 });
        if (rawDatasetId && !await datasetInHospital(hospitalId, rawDatasetId)) return Response.json({ error: "dataset_not_found" }, { status: 404 });
        const ruleCode = safeIdentifier(payload.ruleCode, 120);
        const fieldName = payload.fieldName ? safeIdentifier(payload.fieldName, 160) : "";
        const severity = enumValue(payload.severity, issueSeverities);
        const message = textValue(payload.message, 1000);
        const affectedRows = nonNegativeInteger(payload.affectedRows);
        const sampleJson = jsonValue(payload.sample, [], 40_000);
        if (!ruleCode || !severity || !message || affectedRows === null || !sampleJson) return Response.json({ error: "invalid_quality_issue" }, { status: 400 });
        const id = `quality-${crypto.randomUUID()}`;
        const [row] = await db.insert(dataQualityIssues).values({
          id, hospitalId, importJobId: importJobId || null, rawDatasetId: rawDatasetId || null,
          ruleCode, fieldName, severity: severity as typeof dataQualityIssues.$inferInsert.severity,
          affectedRows, message, sampleJson,
        }).returning();
        await lineage(hospitalId, access.account.id, { action: "quality_issue_created", resourceType: "quality_issue", resourceId: id, toStatus: "open", importJobId: importJobId || null });
        return Response.json({ data: row }, { status: 201 });
      }
      const id = safeIdentifier(payload.id, 180);
      const current = id ? await qualityIssueInHospital(hospitalId, id) : null;
      const status = enumValue(payload.status, issueStatuses);
      const comment = textValue(payload.comment, 1000, false);
      if (!current) return Response.json({ error: "quality_issue_not_found" }, { status: 404 });
      if (!status || comment === null) return Response.json({ error: "invalid_quality_resolution" }, { status: 400 });
      const resolved = status === "resolved" || status === "waived";
      const [row] = await db.update(dataQualityIssues).set({
        status: status as typeof dataQualityIssues.$inferInsert.status,
        resolutionComment: comment ?? "", resolvedByAccountId: resolved ? access.account.id : null,
        resolvedAt: resolved ? now : null, updatedAt: now,
      }).where(and(eq(dataQualityIssues.id, id), eq(dataQualityIssues.hospitalId, hospitalId))).returning();
      await lineage(hospitalId, access.account.id, { action: "quality_issue_status_changed", resourceType: "quality_issue", resourceId: id, fromStatus: current.status, toStatus: status, importJobId: current.importJobId });
      return Response.json({ data: row });
    }

    if (payload.action === "create_publish") {
      const denied = requirePermission(access, "data.clean");
      if (denied) return denied;
      const requestedSnapshotIds = payload.curatedSnapshotIds !== undefined
        ? optionalIdentifierArray(payload.curatedSnapshotIds, 100)
        : payload.curatedSnapshotId ? [safeIdentifier(payload.curatedSnapshotId, 180)].filter(Boolean) : null;
      if (!requestedSnapshotIds?.length) return Response.json({ error: "curated_snapshots_required" }, { status: 400 });
      const metricDefinitionIds = optionalIdentifierArray(payload.metricDefinitionIds, 200);
      const visualizationDefinitionIds = optionalIdentifierArray(payload.visualizationDefinitionIds, 200);
      if (!metricDefinitionIds?.length || !visualizationDefinitionIds?.length) return Response.json({ error: "active_metric_and_visualization_definitions_required" }, { status: 400 });
      const snapshots = await db.select().from(dataDatasetSnapshots).where(and(
        eq(dataDatasetSnapshots.hospitalId, hospitalId), inArray(dataDatasetSnapshots.id, requestedSnapshotIds),
        eq(dataDatasetSnapshots.layer, "curated"), eq(dataDatasetSnapshots.status, "ready"),
      ));
      if (snapshots.length !== requestedSnapshotIds.length) return Response.json({ error: "curated_snapshot_not_ready" }, { status: 409 });
      const sourceImportIds = [...new Set(snapshots.map((snapshot) => snapshot.importJobId).filter((id): id is string => Boolean(id)))];
      if (!sourceImportIds.length) return Response.json({ error: "source_imports_required" }, { status: 409 });
      const readyImports = await db.select({ id: dataImportJobs.id }).from(dataImportJobs).where(and(eq(dataImportJobs.hospitalId, hospitalId), inArray(dataImportJobs.id, sourceImportIds), eq(dataImportJobs.status, "ready")));
      if (readyImports.length !== sourceImportIds.length) return Response.json({ error: "source_imports_not_ready" }, { status: 409 });
      if (await hasOpenBlockingIssues(hospitalId, sourceImportIds)) return Response.json({ error: "blocking_quality_issues" }, { status: 409 });
      const openRecordBlockers = await db.select({ id: dataRecordIssues.id }).from(dataRecordIssues).where(and(
        eq(dataRecordIssues.hospitalId, hospitalId), inArray(dataRecordIssues.snapshotId, requestedSnapshotIds),
        eq(dataRecordIssues.status, "open"), eq(dataRecordIssues.severity, "blocker"),
      )).limit(1);
      if (openRecordBlockers.length) return Response.json({ error: "blocking_record_issues" }, { status: 409 });

      let reconciliationGovernance: Record<string, unknown> = { required: requestedSnapshotIds.length > 1, passedRunIds: [], waived: false };
      if (requestedSnapshotIds.length > 1) {
        const runs = await db.select().from(dataReconciliationRuns).where(and(
          eq(dataReconciliationRuns.hospitalId, hospitalId),
          inArray(dataReconciliationRuns.leftSnapshotId, requestedSnapshotIds),
          inArray(dataReconciliationRuns.rightSnapshotId, requestedSnapshotIds),
        )).orderBy(desc(dataReconciliationRuns.createdAt));
        const pairKey = (left: string, right: string) => [left, right].sort().join("\u0000");
        const latestByPair = new Map<string, typeof runs[number]>();
        for (const run of runs) if (!latestByPair.has(pairKey(run.leftSnapshotId, run.rightSnapshotId))) latestByPair.set(pairKey(run.leftSnapshotId, run.rightSnapshotId), run);
        const latestRuns = [...latestByPair.values()];
        const duplicateRuns = latestRuns.length ? await db.select({ runId: dataReconciliationDifferences.runId }).from(dataReconciliationDifferences).where(and(eq(dataReconciliationDifferences.hospitalId, hospitalId), inArray(dataReconciliationDifferences.runId, latestRuns.map((run) => run.id)), eq(dataReconciliationDifferences.fieldName, "__duplicate_key"))) : [];
        const duplicateRunIds = new Set(duplicateRuns.map((item) => item.runId));
        const passed = latestRuns.filter((run) => run.status === "completed" && run.leftOnlyCount === 0 && run.rightOnlyCount === 0 && run.mismatchCount === 0 && !duplicateRunIds.has(run.id));
        const graph = new Map(requestedSnapshotIds.map((id) => [id, new Set<string>()]));
        for (const run of passed) { graph.get(run.leftSnapshotId)?.add(run.rightSnapshotId); graph.get(run.rightSnapshotId)?.add(run.leftSnapshotId); }
        const visited = new Set<string>(); const queue = [requestedSnapshotIds[0]];
        while (queue.length) { const next = queue.shift(); if (!next || visited.has(next)) continue; visited.add(next); graph.get(next)?.forEach((neighbor) => queue.push(neighbor)); }
        const gatePassed = visited.size === requestedSnapshotIds.length;
        const waiverReason = textValue(payload.reconciliationWaiverReason, 1000, false) ?? "";
        const waived = !gatePassed && may(access, "data.review") && waiverReason.length >= 20;
        if (!gatePassed && !waived) return Response.json({ error: "reconciliation_gate_failed", detail: "多快照发布需由当前无差异对账结果连通覆盖；data.review 可用不少于20字的 reconciliationWaiverReason 显式豁免。" }, { status: 409 });
        reconciliationGovernance = { required: true, passedRunIds: passed.map((run) => run.id), waived, waiverReason: waived ? waiverReason : "" };
      }

      const metrics = metricDefinitionIds.length ? await db.select().from(dataMetricDefinitions).where(and(
        eq(dataMetricDefinitions.hospitalId, hospitalId), inArray(dataMetricDefinitions.id, metricDefinitionIds), eq(dataMetricDefinitions.status, "active"),
      )) : [];
      if (metrics.length !== metricDefinitionIds.length) return Response.json({ error: "metric_definitions_not_active" }, { status: 409 });
      const visualizations = visualizationDefinitionIds.length ? await db.select().from(dataVisualizationDefinitions).where(and(
        eq(dataVisualizationDefinitions.hospitalId, hospitalId), inArray(dataVisualizationDefinitions.id, visualizationDefinitionIds), eq(dataVisualizationDefinitions.status, "active"),
      )) : [];
      if (visualizations.length !== visualizationDefinitionIds.length) return Response.json({ error: "visualization_definitions_not_active" }, { status: 409 });
      const selectedMetricIds = new Set(metrics.map((metric) => metric.id));
      if (visualizations.some((visualization) => !selectedMetricIds.has(visualization.metricId))) return Response.json({ error: "visualization_metric_not_selected" }, { status: 409 });

      const allocationRules = new Set(["equal_by_body_part", "weighted_by_body_part", "primary_body_part"]);
      const allocationRule = typeof payload.allocationRule === "string" && allocationRules.has(payload.allocationRule) ? payload.allocationRule as "equal_by_body_part" | "weighted_by_body_part" | "primary_body_part" : "equal_by_body_part";
      let rowCount = 0;
      const sourceDescriptors = [];
      for (const snapshot of snapshots) {
        const [latestCurated] = snapshot.importJobId ? await db.select({ id: dataDatasetSnapshots.id }).from(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, snapshot.importJobId), eq(dataDatasetSnapshots.layer, "curated"), eq(dataDatasetSnapshots.status, "ready"))).orderBy(desc(dataDatasetSnapshots.version)).limit(1) : [];
        if (!latestCurated || latestCurated.id !== snapshot.id) return Response.json({ error: "stale_curated_snapshot" }, { status: 409 });
        const validRows = await snapshotRecords(hospitalId, snapshot.id, ["valid"]);
        const allRows = await snapshotRecords(hospitalId, snapshot.id, ["valid", "quarantined", "excluded"]);
        if (await sha256Hex(recordsToNdjson(allRows.map((row) => row.record))) !== snapshot.sha256) return Response.json({ error: "curated_snapshot_integrity_failed" }, { status: 409 });
        const profile = JSON.parse(snapshot.profileJson) as Record<string, unknown>;
        let publishRows: Array<Record<string, unknown>>;
        try { publishRows = profile.templateCode === "exam_activity" ? expandExamActivityForPublish(validRows.map((row) => row.record), allocationRule) : validRows.map((row) => row.record); }
        catch (error) { return Response.json({ error: "exam_activity_conflict", detail: error instanceof Error ? error.message : "invalid_exam_activity" }, { status: 409 }); }
        rowCount += publishRows.length;
        sourceDescriptors.push({
          snapshotId: snapshot.id, importJobId: snapshot.importJobId, dataDomain: profile.dataDomain ?? "",
          templateCode: profile.templateCode ?? "", sha256: snapshot.sha256, rowCount: validRows.length,
          mappingId: snapshot.mappingId, mappingVersion: snapshot.mappingVersion, recipeId: snapshot.recipeId, ruleVersion: snapshot.ruleVersion,
        });
      }
      if (!rowCount) return Response.json({ error: "empty_publish_snapshot" }, { status: 409 });
      const correctionOfId = payload.correctionOfId ? safeIdentifier(payload.correctionOfId, 180) : "";
      const correction = correctionOfId ? await publishInHospital(hospitalId, correctionOfId) : null;
      if (correctionOfId && !correction) return Response.json({ error: "correction_publish_not_found" }, { status: 404 });
      const seriesId = (correction?.seriesId ?? safeIdentifier(payload.seriesId, 180)) || "hospital-current-supply";
      const [latestVersion] = await db.select({ version: dataPublishVersions.version }).from(dataPublishVersions).where(and(
        eq(dataPublishVersions.hospitalId, hospitalId), eq(dataPublishVersions.seriesId, seriesId),
      )).orderBy(desc(dataPublishVersions.version)).limit(1);
      const version = (latestVersion?.version ?? 0) + 1;
      const idempotencyKey = safeIdentifier(payload.idempotencyKey, 180) || "";
      const dataDomains = [...new Set(sourceDescriptors.map((source) => String(source.dataDomain)).filter(Boolean))];
      const normalizedReconciliationGovernance = { ...reconciliationGovernance, passedRunIds: Array.isArray(reconciliationGovernance.passedRunIds) ? [...reconciliationGovernance.passedRunIds].map(String).sort() : [] };
      const publishIntent = { seriesId, correctionOfId: correctionOfId || null, snapshotIds: [...requestedSnapshotIds].sort(), metricDefinitionIds: [...metricDefinitionIds].sort(), visualizationDefinitionIds: [...visualizationDefinitionIds].sort(), allocationRule, reconciliationGovernance: normalizedReconciliationGovernance };
      if (idempotencyKey) {
        const [existing] = await db.select().from(dataPublishVersions).where(and(eq(dataPublishVersions.hospitalId, hospitalId), eq(dataPublishVersions.idempotencyKey, idempotencyKey))).limit(1);
        if (existing) {
          const existingManifest = JSON.parse(existing.manifestJson) as Record<string, unknown>;
          const existingSource = isPlainRecord(existingManifest.source) && Array.isArray(existingManifest.source.snapshots) ? existingManifest.source.snapshots : [];
          const existingDefinitions = isPlainRecord(existingManifest.definitions) ? existingManifest.definitions : {};
          const existingTransform = isPlainRecord(existingManifest.transform) ? existingManifest.transform : {};
          const existingGovernance = isPlainRecord(existingManifest.governance) && isPlainRecord(existingManifest.governance.reconciliation) ? existingManifest.governance.reconciliation : { required: false, passedRunIds: [], waived: false };
          const existingIntent = { seriesId: existing.seriesId, correctionOfId: existing.correctionOfId, snapshotIds: existingSource.map((item) => isPlainRecord(item) ? item.snapshotId : null).filter(Boolean).map(String).sort(), metricDefinitionIds: Array.isArray(existingDefinitions.metricDefinitionIds) ? existingDefinitions.metricDefinitionIds.map(String).sort() : [], visualizationDefinitionIds: Array.isArray(existingDefinitions.visualizationDefinitionIds) ? existingDefinitions.visualizationDefinitionIds.map(String).sort() : [], allocationRule: existingTransform.allocationRule ?? "equal_by_body_part", reconciliationGovernance: { ...existingGovernance, passedRunIds: Array.isArray(existingGovernance.passedRunIds) ? existingGovernance.passedRunIds.map(String).sort() : [] } };
          return stableStringify(existingIntent) === stableStringify(publishIntent)
            ? Response.json({ data: existing, manifest: existingManifest })
            : Response.json({ error: "idempotency_key_conflict" }, { status: 409 });
        }
      }
      const manifest = {
        schemaVersion: 1,
        kind: "composite_dataset",
        source: { importIds: sourceImportIds, snapshots: sourceDescriptors, domains: dataDomains },
        definitions: {
          metricDefinitionIds,
          visualizationDefinitionIds,
          metrics: metrics.map((metric) => ({ id: metric.id, code: metric.code, version: metric.version })),
          visualizations: visualizations.map((visualization) => ({ id: visualization.id, code: visualization.code, version: visualization.version, metricId: visualization.metricId })),
        },
        transform: { mappingVersion: sourceDescriptors.map((source) => source.mappingVersion).filter(Boolean).join(","), ruleVersion: sourceDescriptors.map((source) => source.ruleVersion).filter(Boolean).join(","), allocationRule },
        governance: { reconciliation: reconciliationGovernance },
        dataset: { rowCount, snapshotId: null, sha256: null, objectKey: null },
      };
      const id = `publish-${crypto.randomUUID()}`;
      let row: typeof dataPublishVersions.$inferSelect;
      try {
        [row] = await db.insert(dataPublishVersions).values({
          id, hospitalId, seriesId, version, dataDomain: dataDomains.length === 1 ? dataDomains[0] : "composite",
          sourceImportIdsJson: JSON.stringify(sourceImportIds), manifestJson: stableStringify(manifest), rowCount,
          mappingVersion: sourceDescriptors.map((source) => source.mappingVersion).filter(Boolean).join(","),
          ruleVersion: sourceDescriptors.map((source) => source.ruleVersion).filter(Boolean).join(","),
          curatedSnapshotId: snapshots.length === 1 ? snapshots[0].id : null,
          correctionOfId: correctionOfId || null, idempotencyKey, createdByAccountId: access.account.id,
        }).returning();
      } catch {
        if (idempotencyKey) {
          const [raced] = await db.select().from(dataPublishVersions).where(and(eq(dataPublishVersions.hospitalId, hospitalId), eq(dataPublishVersions.idempotencyKey, idempotencyKey))).limit(1);
          if (raced) {
            const racedManifest = JSON.parse(raced.manifestJson) as Record<string, unknown>;
            const racedSource = isPlainRecord(racedManifest.source) && Array.isArray(racedManifest.source.snapshots) ? racedManifest.source.snapshots : [];
            const racedDefinitions = isPlainRecord(racedManifest.definitions) ? racedManifest.definitions : {};
            const racedTransform = isPlainRecord(racedManifest.transform) ? racedManifest.transform : {};
            const racedGovernance = isPlainRecord(racedManifest.governance) && isPlainRecord(racedManifest.governance.reconciliation) ? racedManifest.governance.reconciliation : { required: false, passedRunIds: [], waived: false };
            const racedIntent = { seriesId: raced.seriesId, correctionOfId: raced.correctionOfId, snapshotIds: racedSource.map((item) => isPlainRecord(item) ? item.snapshotId : null).filter(Boolean).map(String).sort(), metricDefinitionIds: Array.isArray(racedDefinitions.metricDefinitionIds) ? racedDefinitions.metricDefinitionIds.map(String).sort() : [], visualizationDefinitionIds: Array.isArray(racedDefinitions.visualizationDefinitionIds) ? racedDefinitions.visualizationDefinitionIds.map(String).sort() : [], allocationRule: racedTransform.allocationRule ?? "equal_by_body_part", reconciliationGovernance: { ...racedGovernance, passedRunIds: Array.isArray(racedGovernance.passedRunIds) ? racedGovernance.passedRunIds.map(String).sort() : [] } };
            return stableStringify(racedIntent) === stableStringify(publishIntent)
              ? Response.json({ data: raced, manifest: racedManifest })
              : Response.json({ error: "idempotency_key_conflict" }, { status: 409 });
          }
        }
        return Response.json({ error: "publish_version_conflict_retry" }, { status: 409 });
      }
      await db.insert(dataReviewEvents).values({ hospitalId, resourceType: "publish", resourceId: id, decision: "submit", actorAccountId: access.account.id, comment: "发布草稿已创建" });
      if (reconciliationGovernance.waived === true) await db.insert(dataReviewEvents).values({ hospitalId, resourceType: "publish", resourceId: id, decision: "waive", actorAccountId: access.account.id, comment: "多文件对账门禁已显式豁免", breakGlassReason: String(reconciliationGovernance.waiverReason ?? "") });
      await lineage(hospitalId, access.account.id, { action: "publish_version_created", resourceType: "publish", resourceId: id, toStatus: "draft", datasetVersion: `${seriesId}@${version}`, mappingVersion: row.mappingVersion, ruleVersion: row.ruleVersion, detailJson: stableStringify({ sourceDescriptors, metricDefinitionIds, visualizationDefinitionIds }) });
      return Response.json({ data: row, manifest }, { status: 201 });
    }

    if (payload.action === "advance_publish") {
      const id = safeIdentifier(payload.id, 180);
      const current = id ? await publishInHospital(hospitalId, id) : null;
      const toStatus = typeof payload.status === "string" && isPublishStatus(payload.status) ? payload.status : "";
      if (!current) return Response.json({ error: "publish_version_not_found" }, { status: 404 });
      if (!toStatus || !canAdvancePublish(current.status, toStatus)) return Response.json({ error: "invalid_status_transition" }, { status: 409 });
      const permission: DataWorkbenchPermission = ["approved", "rejected"].includes(toStatus) ? "data.review" : ["published", "withdrawn", "superseded"].includes(toStatus) ? "data.publish" : "data.clean";
      const denied = requirePermission(access, permission);
      if (denied) return denied;
      const comment = textValue(payload.comment, 1000, false);
      const breakGlassReason = textValue(payload.breakGlassReason, 1000, false);
      if (comment === null || breakGlassReason === null) return Response.json({ error: "invalid_comment" }, { status: 400 });
      const reviewDecision = ["approved", "rejected"].includes(toStatus);
      const selfReview = reviewDecision && current.createdByAccountId === access.account.id;
      if (selfReview && !(access.platformAdmin && (breakGlassReason?.length ?? 0) >= 20)) {
        return Response.json({ error: "self_review_forbidden", detail: "创建人不能审核自己的发布；平台管理员紧急处理时必须填写不少于20字的 breakGlassReason。" }, { status: 409 });
      }
      const sourceImportIds = JSON.parse(current.sourceImportIdsJson) as unknown;
      if (!Array.isArray(sourceImportIds) || sourceImportIds.some((value) => typeof value !== "string")) return Response.json({ error: "invalid_source_manifest" }, { status: 409 });

      let publishedSnapshot: Awaited<ReturnType<typeof createDatasetSnapshot>> | null = null;
      let nextManifest = JSON.parse(current.manifestJson) as Record<string, unknown>;
      if (toStatus === "published") {
        const source = isPlainRecord(nextManifest.source) ? nextManifest.source : null;
        const sourceSnapshots = source && Array.isArray(source.snapshots) ? source.snapshots : [];
        const transform = isPlainRecord(nextManifest.transform) ? nextManifest.transform : {};
        const frozenAllocationRule = typeof transform.allocationRule === "string" && ["equal_by_body_part", "weighted_by_body_part", "primary_body_part"].includes(transform.allocationRule) ? transform.allocationRule as "equal_by_body_part" | "weighted_by_body_part" | "primary_body_part" : "equal_by_body_part";
        const sourceSnapshotIds = sourceSnapshots.map((item) => isPlainRecord(item) ? safeIdentifier(item.snapshotId, 180) : "").filter(Boolean);
        if (!sourceSnapshotIds.length) return Response.json({ error: "invalid_source_manifest" }, { status: 409 });
        if (!current.rollbackOfId) {
          const imports = await db.select({ id: dataImportJobs.id, status: dataImportJobs.status }).from(dataImportJobs).where(and(eq(dataImportJobs.hospitalId, hospitalId), inArray(dataImportJobs.id, sourceImportIds)));
          if (imports.length !== sourceImportIds.length || imports.some((item) => !["ready", "published"].includes(item.status))) return Response.json({ error: "source_imports_not_ready" }, { status: 409 });
          if (await hasOpenBlockingIssues(hospitalId, sourceImportIds)) return Response.json({ error: "blocking_quality_issues" }, { status: 409 });
        }
        const sourceRows: Array<{ sourceRowNumber: number; sourceRecordId: string; record: Record<string, unknown> }> = [];
        const rollbackMetadata = isPlainRecord(nextManifest.rollback) ? nextManifest.rollback : null;
        const restoreSnapshotId = rollbackMetadata ? safeIdentifier(rollbackMetadata.restoreFromPublishedSnapshotId, 180) : "";
        if (current.rollbackOfId) {
          const restoreSnapshot = restoreSnapshotId ? await snapshotInHospital(hospitalId, restoreSnapshotId) : null;
          if (!restoreSnapshot || restoreSnapshot.layer !== "published" || !["published", "superseded"].includes(restoreSnapshot.status)) return Response.json({ error: "rollback_snapshot_missing" }, { status: 409 });
          const restoreRows = await snapshotRecords(hospitalId, restoreSnapshot.id, ["valid"]);
          if (await sha256Hex(recordsToNdjson(restoreRows.map((row) => row.record))) !== restoreSnapshot.sha256) return Response.json({ error: "rollback_snapshot_integrity_failed" }, { status: 409 });
          for (const row of restoreRows) {
            if (containsDirectPatientIdentifiers(row.record)) return Response.json({ error: "published_data_contains_direct_identifier" }, { status: 409 });
            sourceRows.push({ sourceRowNumber: sourceRows.length + 1, sourceRecordId: row.sourceRecordId, record: row.record });
          }
        } else for (const snapshotId of sourceSnapshotIds) {
          const snapshot = await snapshotInHospital(hospitalId, snapshotId);
          if (!snapshot || snapshot.layer !== "curated" || snapshot.status !== "ready") return Response.json({ error: "curated_snapshot_not_ready" }, { status: 409 });
          const [latestCurated] = snapshot.importJobId ? await db.select({ id: dataDatasetSnapshots.id }).from(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, snapshot.importJobId), eq(dataDatasetSnapshots.layer, "curated"), eq(dataDatasetSnapshots.status, "ready"))).orderBy(desc(dataDatasetSnapshots.version)).limit(1) : [];
          if (!current.rollbackOfId && (!latestCurated || latestCurated.id !== snapshot.id)) return Response.json({ error: "stale_curated_snapshot" }, { status: 409 });
          const open = await db.select({ id: dataRecordIssues.id }).from(dataRecordIssues).where(and(eq(dataRecordIssues.hospitalId, hospitalId), eq(dataRecordIssues.snapshotId, snapshotId), eq(dataRecordIssues.status, "open"), eq(dataRecordIssues.severity, "blocker"))).limit(1);
          if (open.length) return Response.json({ error: "blocking_record_issues" }, { status: 409 });
          const rows = await snapshotRecords(hospitalId, snapshotId, ["valid"]);
          const allRows = await snapshotRecords(hospitalId, snapshotId, ["valid", "quarantined", "excluded"]);
          if (await sha256Hex(recordsToNdjson(allRows.map((row) => row.record))) !== snapshot.sha256) return Response.json({ error: "curated_snapshot_integrity_failed" }, { status: 409 });
          const snapshotProfile = JSON.parse(snapshot.profileJson) as Record<string, unknown>;
          let publishRecords: Array<Record<string, unknown>>;
          try { publishRecords = snapshotProfile.templateCode === "exam_activity" ? expandExamActivityForPublish(rows.map((row) => row.record), frozenAllocationRule) : rows.map((row) => row.record); }
          catch (error) { return Response.json({ error: "exam_activity_conflict", detail: error instanceof Error ? error.message : "invalid_exam_activity" }, { status: 409 }); }
          for (const record of publishRecords) {
            const canonicalRecord = { ...record, templateCode: record.templateCode ?? snapshotProfile.templateCode ?? "generic", dataDomain: record.dataDomain ?? snapshotProfile.dataDomain ?? "generic" };
            if (containsDirectPatientIdentifiers(canonicalRecord)) return Response.json({ error: "published_data_contains_direct_identifier" }, { status: 409 });
            const sourceRecordId = isPlainRecord(record._lineage) && typeof record._lineage.sourceRecordId === "string" ? record._lineage.sourceRecordId : `derived:${sourceRows.length + 1}`;
            sourceRows.push({ sourceRowNumber: sourceRows.length + 1, sourceRecordId, record: canonicalRecord });
          }
        }
        if (!sourceRows.length || sourceRows.length !== current.rowCount) return Response.json({ error: "publish_row_count_changed" }, { status: 409 });
        const definitions = isPlainRecord(nextManifest.definitions) ? nextManifest.definitions : null;
        const metricIds = definitions && Array.isArray(definitions.metrics) ? definitions.metrics.map((item) => isPlainRecord(item) ? safeIdentifier(item.id, 180) : "").filter(Boolean) : [];
        const visualizationIds = definitions && Array.isArray(definitions.visualizations) ? definitions.visualizations.map((item) => isPlainRecord(item) ? safeIdentifier(item.id, 180) : "").filter(Boolean) : [];
        const activeMetrics = metricIds.length ? await db.select().from(dataMetricDefinitions).where(and(eq(dataMetricDefinitions.hospitalId, hospitalId), inArray(dataMetricDefinitions.id, metricIds), eq(dataMetricDefinitions.status, "active"))) : [];
        const activeVisualizations = visualizationIds.length ? await db.select().from(dataVisualizationDefinitions).where(and(eq(dataVisualizationDefinitions.hospitalId, hospitalId), inArray(dataVisualizationDefinitions.id, visualizationIds), eq(dataVisualizationDefinitions.status, "active"))) : [];
        if (activeMetrics.length !== metricIds.length || activeVisualizations.length !== visualizationIds.length) return Response.json({ error: "frozen_definitions_not_active" }, { status: 409 });
        const selectedMetricIds = new Set(activeMetrics.map((metric) => metric.id));
        if (activeVisualizations.some((visualization) => !selectedMetricIds.has(visualization.metricId))) return Response.json({ error: "visualization_metric_not_selected" }, { status: 409 });
        publishedSnapshot = await createDatasetSnapshot({
          hospitalId, accountId: access.account.id, layer: "published", version: current.version,
          templateCode: "composite", dataDomain: current.dataDomain, headers: [...new Set(sourceRows.flatMap((row) => Object.keys(row.record).filter((key) => key !== "_lineage")))],
          profile: { sourceSnapshotIds, sourceImportIds, seriesId: current.seriesId, publishId: current.id, schema: "canonical-dotted-fields-v1" },
          mappingVersion: current.mappingVersion, ruleVersion: current.ruleVersion, records: sourceRows,
        });
        nextManifest = { ...nextManifest, dataset: { snapshotId: publishedSnapshot.id, sha256: publishedSnapshot.sha256, rowCount: publishedSnapshot.rowCount, objectKey: publishedSnapshot.objectKey }, lineage: { publishedAt: now, publishedByAccountId: access.account.id } };
      }
      const publishUpdate = db.update(dataPublishVersions).set({
        status: toStatus, manifestJson: stableStringify(nextManifest),
        publishedSnapshotId: publishedSnapshot?.id ?? current.publishedSnapshotId,
        snapshotSha256: publishedSnapshot?.sha256 ?? current.snapshotSha256,
        rowCount: publishedSnapshot?.rowCount ?? current.rowCount,
        reviewComment: comment ?? current.reviewComment,
        reviewedByAccountId: reviewDecision ? access.account.id : current.reviewedByAccountId,
        reviewedAt: reviewDecision ? now : current.reviewedAt,
        publishedByAccountId: toStatus === "published" ? access.account.id : current.publishedByAccountId,
        publishedAt: toStatus === "published" ? now : current.publishedAt, updatedAt: now,
      }).where(and(eq(dataPublishVersions.id, id), eq(dataPublishVersions.hospitalId, hospitalId), eq(dataPublishVersions.status, current.status))).returning();
      let row: typeof dataPublishVersions.$inferSelect | undefined;
      try {
        if (toStatus === "published") {
          const results = await db.batch([
            db.update(dataPublishVersions).set({ status: "superseded", updatedAt: now }).where(and(eq(dataPublishVersions.hospitalId, hospitalId), eq(dataPublishVersions.seriesId, current.seriesId), eq(dataPublishVersions.status, "published"), sql`${dataPublishVersions.id} <> ${id}`, sql`EXISTS (SELECT 1 FROM data_publish_versions AS candidate WHERE candidate.id = ${id} AND candidate.hospital_id = ${hospitalId} AND candidate.status = ${current.status})`)),
            db.update(dataImportJobs).set({ status: "published", updatedAt: now }).where(and(eq(dataImportJobs.hospitalId, hospitalId), inArray(dataImportJobs.id, sourceImportIds), eq(dataImportJobs.status, "ready"), sql`EXISTS (SELECT 1 FROM data_publish_versions AS candidate WHERE candidate.id = ${id} AND candidate.hospital_id = ${hospitalId} AND candidate.status = ${current.status})`)),
            publishUpdate,
            db.insert(dataLineageEvents).select(db.select({
              hospitalId: sql<string>`${hospitalId}`.as("hospital_id"), actorAccountId: sql<string>`${access.account.id}`.as("actor_account_id"),
              action: sql<string>`'publish_status_changed'`.as("action"), resourceType: sql<string>`'publish'`.as("resource_type"), resourceId: sql<string>`${id}`.as("resource_id"),
              fromStatus: sql<string>`${current.status}`.as("from_status"), toStatus: sql<string>`'published'`.as("to_status"), importJobId: sql<string | null>`NULL`.as("import_job_id"),
              datasetVersion: sql<string>`${`${current.seriesId}@${current.version}`}`.as("dataset_version"), mappingVersion: sql<string>`${current.mappingVersion}`.as("mapping_version"),
              ruleVersion: sql<string>`${current.ruleVersion}`.as("rule_version"), detailJson: sql<string>`${stableStringify({ sourceImportIds })}`.as("detail_json"),
            }).from(dataPublishVersions).where(and(eq(dataPublishVersions.id, id), eq(dataPublishVersions.hospitalId, hospitalId), eq(dataPublishVersions.status, "published"), eq(dataPublishVersions.publishedAt, now)))),
          ]);
          row = results[2][0];
        } else [row] = await publishUpdate;
      } catch {
        if (publishedSnapshot) {
          await db.delete(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.id, publishedSnapshot.id))).catch(() => undefined);
          await deletePipelineObject(publishedSnapshot.objectKey).catch(() => undefined);
        }
        return Response.json({ error: "publish_state_conflict_retry" }, { status: 409 });
      }
      if (!row) {
        if (publishedSnapshot) {
          await db.delete(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.id, publishedSnapshot.id))).catch(() => undefined);
          await deletePipelineObject(publishedSnapshot.objectKey).catch(() => undefined);
        }
        return Response.json({ error: "status_conflict" }, { status: 409 });
      }
      if (reviewDecision) await db.insert(dataReviewEvents).values({ hospitalId, resourceType: "publish", resourceId: id, decision: selfReview ? "break_glass" : toStatus === "approved" ? "approve" : "reject", actorAccountId: access.account.id, comment: comment ?? "", breakGlassReason: selfReview ? breakGlassReason ?? "" : "" });
      if (toStatus !== "published") await lineage(hospitalId, access.account.id, { action: selfReview ? "publish_break_glass" : "publish_status_changed", resourceType: "publish", resourceId: id, fromStatus: current.status, toStatus, datasetVersion: `${current.seriesId}@${current.version}`, mappingVersion: current.mappingVersion, ruleVersion: current.ruleVersion, detailJson: stableStringify({ sourceImportIds, breakGlass: selfReview, breakGlassReason: selfReview ? breakGlassReason : "" }) });
      return Response.json({ data: row, manifest: nextManifest });
    }

    if (payload.action === "rollback_publish") {
      const denied = requirePermission(access, "data.publish");
      if (denied) return denied;
      const targetId = safeIdentifier(payload.targetPublishId, 180);
      const target = targetId ? await publishInHospital(hospitalId, targetId) : null;
      const reason = textValue(payload.comment, 1000);
      if (!target || !target.publishedSnapshotId || !["published", "superseded"].includes(target.status)) return Response.json({ error: "rollback_target_not_found" }, { status: 404 });
      if (!reason) return Response.json({ error: "rollback_reason_required" }, { status: 400 });
      const targetSnapshot = await snapshotInHospital(hospitalId, target.publishedSnapshotId);
      if (!targetSnapshot) return Response.json({ error: "rollback_snapshot_missing" }, { status: 409 });
      const idempotencyKey = safeIdentifier(payload.idempotencyKey, 180) || "";
      if (idempotencyKey) {
        const [existing] = await db.select().from(dataPublishVersions).where(and(eq(dataPublishVersions.hospitalId, hospitalId), eq(dataPublishVersions.idempotencyKey, idempotencyKey))).limit(1);
        if (existing) return existing.rollbackOfId === target.id && existing.reviewComment === reason
          ? Response.json({ data: existing, manifest: JSON.parse(existing.manifestJson) })
          : Response.json({ error: "idempotency_key_conflict" }, { status: 409 });
      }
      const [latest] = await db.select({ version: dataPublishVersions.version }).from(dataPublishVersions).where(and(eq(dataPublishVersions.hospitalId, hospitalId), eq(dataPublishVersions.seriesId, target.seriesId))).orderBy(desc(dataPublishVersions.version)).limit(1);
      const version = (latest?.version ?? target.version) + 1;
      const id = `publish-${crypto.randomUUID()}`;
      const targetManifest = JSON.parse(target.manifestJson) as Record<string, unknown>;
      const manifest = { ...targetManifest, dataset: { snapshotId: null, sha256: null, rowCount: target.rowCount, objectKey: null }, rollback: { rollbackOfId: target.id, restoreFromPublishedSnapshotId: targetSnapshot.id, reason, status: "pending_independent_review" }, lineage: null };
      let row: typeof dataPublishVersions.$inferSelect;
      try { [row] = await db.insert(dataPublishVersions).values({ id, hospitalId, seriesId: target.seriesId, version, dataDomain: target.dataDomain, status: "draft", sourceImportIdsJson: target.sourceImportIdsJson, manifestJson: stableStringify(manifest), rowCount: target.rowCount, mappingVersion: target.mappingVersion, ruleVersion: target.ruleVersion, curatedSnapshotId: target.curatedSnapshotId, rollbackOfId: target.id, idempotencyKey, reviewComment: reason, createdByAccountId: access.account.id }).returning(); }
      catch { return Response.json({ error: "rollback_version_conflict_retry" }, { status: 409 }); }
      await db.insert(dataReviewEvents).values({ hospitalId, resourceType: "publish", resourceId: id, decision: "submit", actorAccountId: access.account.id, comment: `回滚申请：${reason}` });
      await lineage(hospitalId, access.account.id, { action: "publish_rollback_requested", resourceType: "publish", resourceId: id, fromStatus: target.status, toStatus: "draft", datasetVersion: `${target.seriesId}@${version}`, detailJson: stableStringify({ rollbackOfId: target.id, restoreFromPublishedSnapshotId: targetSnapshot.id, reason }) });
      return Response.json({ data: row, manifest }, { status: 201 });
    }

    return Response.json({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
