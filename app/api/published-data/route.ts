import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSessionError, requireAppSession } from "../../../db/account-security";
import { getCloudStateAccess } from "../../../db/cloud-state";
import { safeIdentifier } from "../../../db/data-workbench-contract";
import { readCurrentPublishedDatasetSet, readPublishedSnapshot, sha256Hex, stableStringify } from "../../../db/data-workbench-pipeline";
import { dataMetricDefinitions, dataVisualizationDefinitions } from "../../../db/schema";
import { filterPublishedRecordsByDepartment } from "../../../db/data-workbench-department-scope";
import {
  buildPublishedPayload,
  normalizePublishedDefinitions,
  publishedDefinitionContractMatches,
  publishedDefinitionIds,
  type PublishedSource,
} from "../../published-data-server-model";

export const dynamic = "force-dynamic";

const readPermissions = new Set([
  "dashboard.view",
  "improvement.manage",
  "report.manage",
  "report.review",
  "report.approve",
  "report.export",
]);

function noStore(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, { ...init, headers: { ...init.headers, "Cache-Control": "private, no-store" } });
}

function operationError(error: unknown) {
  const message = error instanceof Error ? error.message : "unexpected_error";
  if (message.includes("published_snapshot_")) return noStore({ error: "published_snapshot_integrity_failed" }, { status: 409 });
  if (message.includes("published_definition_contract_")) return noStore({ error: message }, { status: 409 });
  if (message.includes("D1 binding") || message.includes("R2 binding") || message.includes("no such table")) {
    return noStore({ error: "published_data_store_unavailable" }, { status: 503 });
  }
  console.error(JSON.stringify({ scope: "published-data", error: message }));
  return noStore({ error: "published_data_load_failed" }, { status: 500 });
}

function positiveVersion(value: string | null) {
  if (value === null) return undefined;
  const version = Number(value);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

function mayRead(access: NonNullable<Awaited<ReturnType<typeof getCloudStateAccess>>>) {
  return access.platformAdmin || [...readPermissions].some((permission) => access.permissions.has(permission));
}

function hasHospitalScope(access: NonNullable<Awaited<ReturnType<typeof getCloudStateAccess>>>) {
  return access.dataScope === "platform" || access.dataScope === "hospital";
}

async function loadDefinitions(hospitalId: string, sources: readonly PublishedSource[]) {
  const ids = publishedDefinitionIds(sources);
  if (!ids.metricDefinitionIds.length || !ids.visualizationDefinitionIds.length) {
    throw new Error("published_definition_contract_missing");
  }
  const db = await getDb();
  const metricRows = ids.metricDefinitionIds.length
    ? await db.select().from(dataMetricDefinitions).where(and(
      eq(dataMetricDefinitions.hospitalId, hospitalId),
      inArray(dataMetricDefinitions.id, ids.metricDefinitionIds),
    ))
    : [];
  const visualizationRows = ids.visualizationDefinitionIds.length
    ? await db.select().from(dataVisualizationDefinitions).where(and(
      eq(dataVisualizationDefinitions.hospitalId, hospitalId),
      inArray(dataVisualizationDefinitions.id, ids.visualizationDefinitionIds),
    ))
    : [];
  if (metricRows.length !== ids.metricDefinitionIds.length || visualizationRows.length !== ids.visualizationDefinitionIds.length) {
    throw new Error("published_definition_contract_missing");
  }
  if (!publishedDefinitionContractMatches(ids, metricRows, visualizationRows)) throw new Error("published_definition_contract_drift");
  const normalized = normalizePublishedDefinitions(metricRows, visualizationRows);
  if (normalized.metricDefinitions.length !== metricRows.length || normalized.visualizationDefinitions.length !== visualizationRows.length) {
    throw new Error("published_definition_contract_invalid");
  }
  return normalized;
}

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try {
    user = await requireAppSession(request);
  } catch (error) {
    return appSessionError(error);
  }

  const params = new URL(request.url).searchParams;
  const hospitalId = safeIdentifier(params.get("hospitalId"), 128);
  const seriesId = params.has("seriesId") ? safeIdentifier(params.get("seriesId"), 160) : undefined;
  const publishId = params.has("publishId") ? safeIdentifier(params.get("publishId"), 160) : undefined;
  const version = positiveVersion(params.get("version"));
  if (!hospitalId || (params.has("seriesId") && !seriesId) || (params.has("publishId") && !publishId) || version === null) {
    return noStore({ error: "invalid_published_data_selector" }, { status: 400 });
  }
  if (version !== undefined && !seriesId) return noStore({ error: "series_required_for_version" }, { status: 400 });
  if (publishId && (seriesId || version !== undefined)) return noStore({ error: "ambiguous_published_data_selector" }, { status: 400 });

  try {
    const access = await getCloudStateAccess(user.email, hospitalId);
    if (!access || !mayRead(access)) return noStore({ error: "permission_denied" }, { status: 403 });
    if (!hasHospitalScope(access) && access.dataScope !== "department") return noStore({ error: "hospital_or_department_scope_required" }, { status: 403 });
    if (access.dataScope === "department" && !access.departmentScope.length) return noStore({ error: "department_scope_required" }, { status: 403 });

    let sources: PublishedSource[];
    let supplyHash: string;
    if (publishId || seriesId || version !== undefined) {
      const selected = await readPublishedSnapshot({ hospitalId, publishId, seriesId, version });
      if (!selected || (selected.publish.status !== "published" && selected.publish.status !== "superseded")) {
        return noStore({ data: buildPublishedPayload({ hospitalId, supplyHash: "", sources: [], metricDefinitions: [], visualizationDefinitions: [] }) });
      }
      sources = [selected as PublishedSource];
      supplyHash = selected.snapshot.sha256;
    } else {
      const current = await readCurrentPublishedDatasetSet({ hospitalId });
      sources = current.sources as PublishedSource[];
      supplyHash = current.supplyHash;
    }
    if (access.dataScope === "department") {
      const allowed = new Set(access.departmentScope);
      sources = sources.map((source) => {
        const records = filterPublishedRecordsByDepartment(source.records, [...allowed]);
        return { ...source, snapshot: { ...source.snapshot, rowCount: records.length }, records };
      }).filter((source) => source.records.length > 0);
      supplyHash = await sha256Hex(stableStringify({ base: supplyHash, departments: [...allowed].sort(), sources: sources.map((source) => ({ publishId: source.publish.id, records: source.records })) }));
    }
    const definitions = sources.length
      ? await loadDefinitions(hospitalId, sources)
      : { metricDefinitions: [], visualizationDefinitions: [] };
    const payload = buildPublishedPayload({ hospitalId, supplyHash, sources, ...definitions });
    const etag = `"${await sha256Hex(stableStringify({ publication: payload.publication, definitions }))}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-store" } });
    }
    return noStore({ data: payload }, { headers: { ETag: etag } });
  } catch (error) {
    return operationError(error);
  }
}
