import { and, desc, eq, isNull, or } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSessionError, assertSameOrigin, requireAppSession } from "../../../../db/account-security";
import { getCloudStateAccess } from "../../../../db/cloud-state";
import {
  FileDatasetParseError,
  MAX_IMPORT_FILE_BYTES,
  detectImportType,
  parseFileDataset,
  type BusinessTemplateContract,
} from "../../../../db/data-workbench-file-parser";
import {
  createDatasetSnapshot,
  deletePipelineObject,
  safeFileName,
  sha256Hex,
  storeImmutableObject,
} from "../../../../db/data-workbench-pipeline";
import {
  dataBusinessTemplates,
  dataDatasetSnapshots,
  dataImportJobs,
  dataLineageEvents,
  rawDatasets,
} from "../../../../db/schema";

export const dynamic = "force-dynamic";

const MAX_MULTIPART_OVERHEAD = 1024 * 1024;
const allowedContentTypes: Record<string, Set<string>> = {
  xlsx: new Set(["", "application/octet-stream", "application/zip", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]),
  csv: new Set(["", "application/octet-stream", "text/plain", "text/csv", "application/csv"]),
  json: new Set(["", "application/octet-stream", "text/plain", "application/json"]),
};

function jsonError(code: string, status: number, detail: string) {
  return Response.json({ error: code, detail }, { status, headers: { "Cache-Control": "no-store" } });
}

function safeId(value: FormDataEntryValue | string | null, max = 128) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length <= max && /^[a-zA-Z0-9_.:@/-]+$/.test(normalized) ? normalized : "";
}

function positiveInteger(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function parseStored<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

async function loadTemplate(hospitalId: string, code: string): Promise<BusinessTemplateContract | null> {
  if (code === "generic") return { code, dataDomain: "generic", requiredFields: [], aliases: {} };
  const db = await getDb();
  const rows = await db.select().from(dataBusinessTemplates).where(and(
    eq(dataBusinessTemplates.code, code),
    eq(dataBusinessTemplates.status, "active"),
    or(eq(dataBusinessTemplates.hospitalId, hospitalId), isNull(dataBusinessTemplates.hospitalId)),
  )).orderBy(desc(dataBusinessTemplates.hospitalId), desc(dataBusinessTemplates.version)).limit(2);
  const row = rows.find((item) => item.hospitalId === hospitalId) ?? rows[0];
  return row ? {
    code: row.code,
    dataDomain: row.dataDomain,
    requiredFields: parseStored<string[]>(row.requiredFieldsJson, []),
    aliases: parseStored<Record<string, string>>(row.aliasesJson, {}),
  } : null;
}

function extensionFor(type: "xlsx" | "csv" | "json") { return type; }

function contentTypeFor(type: "xlsx" | "csv" | "json") {
  if (type === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (type === "csv") return "text/csv; charset=utf-8";
  return "application/json; charset=utf-8";
}

export async function POST(request: Request) {
  try { assertSameOrigin(request); } catch (error) { return appSessionError(error); }
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try { user = await requireAppSession(request); } catch (error) { return appSessionError(error); }

  const requestContentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!requestContentType.includes("multipart/form-data")) return jsonError("multipart_form_required", 415, "请使用 multipart/form-data 上传 Excel、CSV 或 JSON 文件。");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMPORT_FILE_BYTES + MAX_MULTIPART_OVERHEAD) return jsonError("import_file_too_large", 413, "文件超过 25MB 限制。");

  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError("invalid_multipart_form", 400, "无法读取上传表单。"); }
  const hospitalId = safeId(form.get("hospitalId"));
  const file = form.get("file");
  if (!hospitalId || !(file instanceof File)) return jsonError("invalid_upload_request", 400, "hospitalId 与 file 为必填项。");
  const fileType = detectImportType(file.name);
  if (!fileType) return jsonError(file.name.toLowerCase().endsWith(".xls") ? "legacy_xls_not_supported" : "unsupported_import_file", 415, "仅支持 .xlsx、.csv、.json；旧 .xls 请另存为 .xlsx。");
  if (file.size <= 0 || file.size > MAX_IMPORT_FILE_BYTES) return jsonError("import_file_size_invalid", 413, "文件为空或超过 25MB 限制。");
  const suppliedContentType = file.type.trim().toLowerCase();
  if (!allowedContentTypes[fileType].has(suppliedContentType)) return jsonError("import_content_type_invalid", 415, "文件扩展名与内容类型不匹配。");

  let access: Awaited<ReturnType<typeof getCloudStateAccess>>;
  try { access = await getCloudStateAccess(user.email, hospitalId); } catch { return jsonError("data_workbench_store_unavailable", 503, "数据服务暂不可用。"); }
  if (!access) return jsonError("permission_denied", 403, "当前账号无权访问该医院。");
  if (!(access.dataScope === "hospital" || access.dataScope === "platform")) return jsonError("hospital_scope_required", 403, "文件导入需要医院全院数据范围。");
  if (!(access.platformAdmin || access.permissions.has("data.ingest"))) return jsonError("permission_denied", 403, "缺少 data.ingest 权限。");

  const templateCode = safeId(form.get("businessTemplateCode")) || "generic";
  const template = await loadTemplate(hospitalId, templateCode);
  if (!template) return jsonError("business_template_not_found", 404, "业务模板不存在或未启用。");
  const sheetNameValue = form.get("sheetName");
  const sheetName = typeof sheetNameValue === "string" ? sheetNameValue.trim().slice(0, 120) : "";
  const inspectOnly = form.get("inspectOnly") === "true";
  const headerRow = positiveInteger(form.get("headerRow"));
  if (headerRow === null) return jsonError("invalid_header_row", 400, "headerRow 必须为正整数。");

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_IMPORT_FILE_BYTES) return jsonError("import_file_size_mismatch", 409, "服务端读取容量与上传元数据不一致。");
  const sha256 = await sha256Hex(bytes);
  const parserOptions = {
    templateCode,
    sheetName,
    headerRow: headerRow ?? 1,
    delimiter: typeof form.get("delimiter") === "string" ? String(form.get("delimiter")) : ",",
    dateFormat: typeof form.get("dateFormat") === "string" ? String(form.get("dateFormat")) : "",
    numberFormat: typeof form.get("numberFormat") === "string" ? String(form.get("numberFormat")) : "",
  };
  const parserOptionsHash = await sha256Hex(JSON.stringify(parserOptions));
  const idempotencyKey = safeId(form.get("idempotencyKey") || request.headers.get("idempotency-key"), 180) || `file-${sha256.slice(0, 32)}-${parserOptionsHash.slice(0, 24)}`;
  const db = await getDb();
  const [existing] = await db.select().from(dataImportJobs).where(and(eq(dataImportJobs.hospitalId, hospitalId), eq(dataImportJobs.idempotencyKey, idempotencyKey))).limit(1);
  if (existing && !inspectOnly) {
    if (existing.sha256 !== sha256) return jsonError("idempotency_key_conflict", 409, "同一幂等键对应了不同文件。");
    const [dataset] = await db.select().from(rawDatasets).where(and(eq(rawDatasets.hospitalId, hospitalId), eq(rawDatasets.importJobId, existing.id))).limit(1);
    const [snapshot] = await db.select().from(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, existing.id), eq(dataDatasetSnapshots.layer, "raw"))).limit(1);
    const parserConfig = parseStored<Record<string, unknown>>(existing.parserConfigJson, {});
    const existingOptions = parserConfig.parserOptions;
    if (!existingOptions || JSON.stringify(existingOptions) !== JSON.stringify(parserOptions)) {
      return jsonError("idempotency_key_conflict", 409, "同一幂等键对应了不同的 Sheet、表头或模板解析选项。");
    }
    return Response.json({ data: { import: existing, dataset, snapshot, workbook: parserConfig, fileName: existing.fileName, contentType: suppliedContentType || contentTypeFor(fileType), sizeBytes: file.size, sha256, parseMode: `server_${fileType}` } }, { headers: { "Cache-Control": "private, no-store" } });
  }

  let parsed;
  try {
    parsed = await parseFileDataset(bytes, { fileName: file.name, sheetName: sheetName || undefined, headerRow, delimiter: parserOptions.delimiter, dateFormat: parserOptions.dateFormat, numberFormat: parserOptions.numberFormat }, template);
  } catch (error) {
    if (error instanceof FileDatasetParseError) return jsonError(error.code, error.status, "服务器无法安全解析该文件，请检查格式、Sheet、表头和资源限制。");
    return jsonError("import_parse_failed", 422, "服务器无法解析该文件。");
  }

  if (inspectOnly) return Response.json({ data: {
    workbook: { sheets: parsed.sheets, selectedSheet: parsed.selectedSheet, headerRow: parsed.headerRow, headers: parsed.headers, previewRows: parsed.previewRows, rowCount: parsed.records.length, profile: parsed.profile, warnings: parsed.warnings },
    fileName: safeFileName(file.name), contentType: suppliedContentType || contentTypeFor(fileType), sizeBytes: bytes.byteLength, sha256, parseMode: parsed.parseMode, inspectOnly: true,
  } }, { headers: { "Cache-Control": "private, no-store" } });

  const importId = `import-${crypto.randomUUID()}`;
  const original = await storeImmutableObject({
    hospitalId, category: "original", resourceId: "file", extension: extensionFor(fileType),
    contentType: contentTypeFor(fileType), body: bytes, sha256,
    customMetadata: { importId, originalFileName: safeFileName(file.name), templateCode },
  });
  let rawSnapshot: Awaited<ReturnType<typeof createDatasetSnapshot>> | null = null;
  try {
    await db.insert(dataImportJobs).values({
      id: importId, hospitalId, connectorId: null, dataDomain: template.dataDomain, ingestionMode: "file",
      fileName: safeFileName(file.name), objectKey: original.objectKey, sha256, status: "uploading",
      rowCount: parsed.records.length, acceptedCount: 0, rejectedCount: 0,
      businessTemplateCode: template.code, selectedSheet: parsed.selectedSheet, headerRow: parsed.headerRow,
      parserConfigJson: JSON.stringify({ sheets: parsed.sheets, selectedSheet: parsed.selectedSheet, headerRow: parsed.headerRow, headers: parsed.headers, previewRows: parsed.previewRows, rowCount: parsed.records.length, profile: parsed.profile, warnings: parsed.warnings, parserOptions }),
      idempotencyKey, createdByAccountId: access.account.id,
    });
    rawSnapshot = await createDatasetSnapshot({
      hospitalId, accountId: access.account.id, importJobId: importId, layer: "raw", version: 1,
      templateCode: template.code, dataDomain: template.dataDomain, headers: parsed.headers, profile: { ...parsed.profile, requiredFields: template.requiredFields },
      records: parsed.records.map((record, index) => ({ sourceRowNumber: parsed.headerRow + index + 1, sourceRecordId: `${sha256}:${parsed.headerRow + index + 1}`, record })),
    });
    const datasetId = `dataset-${crypto.randomUUID()}`;
    await db.batch([
      db.insert(rawDatasets).values({
        id: datasetId, hospitalId, importJobId: importId, connectorId: null, objectKey: rawSnapshot.objectKey,
        contentType: "application/x-ndjson", sizeBytes: rawSnapshot.sizeBytes, sha256: rawSnapshot.sha256,
        rowCount: rawSnapshot.rowCount, schemaJson: JSON.stringify({ headers: parsed.headers, templateCode: template.code, dataDomain: template.dataDomain }),
        profileJson: JSON.stringify(parsed.profile), createdByAccountId: access.account.id,
      }),
      db.update(dataImportJobs).set({ status: "pending_mapping", revision: 2, updatedAt: new Date().toISOString() }).where(and(eq(dataImportJobs.id, importId), eq(dataImportJobs.hospitalId, hospitalId))),
      db.insert(dataLineageEvents).values({ hospitalId, actorAccountId: access.account.id, action: "file_imported", resourceType: "import", resourceId: importId, toStatus: "pending_mapping", importJobId: importId, datasetVersion: rawSnapshot.id, detailJson: JSON.stringify({ originalObjectKey: original.objectKey, rawObjectKey: rawSnapshot.objectKey, sha256, rowCount: rawSnapshot.rowCount, templateCode: template.code }) }),
    ]);
    const [importRow] = await db.select().from(dataImportJobs).where(eq(dataImportJobs.id, importId)).limit(1);
    const [dataset] = await db.select().from(rawDatasets).where(eq(rawDatasets.importJobId, importId)).limit(1);
    return Response.json({ data: {
      import: importRow, dataset, snapshot: rawSnapshot,
      workbook: { sheets: parsed.sheets, selectedSheet: parsed.selectedSheet, headerRow: parsed.headerRow, headers: parsed.headers, previewRows: parsed.previewRows, rowCount: parsed.records.length, profile: parsed.profile, warnings: parsed.warnings },
      fileName: safeFileName(file.name), contentType: suppliedContentType || contentTypeFor(fileType), sizeBytes: bytes.byteLength, sha256, parseMode: parsed.parseMode,
    } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (rawSnapshot) await deletePipelineObject(rawSnapshot.objectKey).catch(() => undefined);
    // The original object is content-addressed and may be shared by another
    // parser configuration. An unreferenced immutable object is left for R2
    // lifecycle garbage collection instead of risking deletion of shared data.
    await db.delete(dataDatasetSnapshots).where(and(eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.importJobId, importId))).catch(() => undefined);
    await db.delete(dataImportJobs).where(and(eq(dataImportJobs.id, importId), eq(dataImportJobs.hospitalId, hospitalId))).catch(() => undefined);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE") || message.includes("unique")) return jsonError("import_conflict", 409, "相同文件或幂等请求已存在。");
    return jsonError("import_persistence_failed", 500, "文件已解析但持久化失败，未产生可见批次。");
  }
}
