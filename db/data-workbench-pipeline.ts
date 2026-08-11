import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./index";
import {
  dataDatasetSnapshots,
  dataPipelineRecords,
  dataPublishVersions,
} from "./schema";
import { freezeSnapshotLineage } from "./data-workbench-lineage";

export type R2ObjectBodyLike = {
  body: ReadableStream<Uint8Array>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  customMetadata?: Record<string, string>;
};

export type R2ObjectMetadataLike = { key: string; size: number; customMetadata?: Record<string, string> };

export type DataPipelineBucket = {
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: {
    httpMetadata?: { contentType?: string; contentDisposition?: string };
    customMetadata?: Record<string, string>;
  }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head?(key: string): Promise<R2ObjectMetadataLike | null>;
  delete(key: string): Promise<void>;
};

export type DataPipelineRuntime = {
  db?: Awaited<ReturnType<typeof getDb>>;
  bucket?: DataPipelineBucket;
};

async function pipelineDb(runtime?: DataPipelineRuntime) {
  return runtime?.db ?? getDb();
}

async function pipelineBucket(runtime?: DataPipelineRuntime) {
  return runtime?.bucket ?? getDataPipelineBucket();
}

export async function getDataPipelineBucket() {
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as { REPORT_FILES?: DataPipelineBucket };
  if (!runtimeEnv.REPORT_FILES) throw new Error("R2 binding REPORT_FILES is unavailable");
  return runtimeEnv.REPORT_FILES;
}

export function safeFileName(value: string) {
  return value.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 180);
}

export async function sha256Hex(value: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value instanceof Uint8Array ? value : new Uint8Array(value);
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]));
  }
  return value;
}

export function stableStringify(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function recordsToNdjson(records: Array<Record<string, unknown>>) {
  return records.map((record) => stableStringify(record)).join("\n") + (records.length ? "\n" : "");
}

export async function storeImmutableObject(input: {
  hospitalId: string;
  category: "original" | "raw" | "staging" | "curated" | "published" | "errors";
  resourceId: string;
  extension: string;
  contentType: string;
  body: ArrayBuffer | Uint8Array | string;
  sha256?: string;
  customMetadata?: Record<string, string>;
}, runtime?: DataPipelineRuntime) {
  const sha256 = input.sha256 ?? await sha256Hex(input.body);
  const objectKey = `data/${input.hospitalId}/${input.category}/${sha256.slice(0, 2)}/${input.resourceId}-${sha256}.${input.extension}`;
  const bucket = await pipelineBucket(runtime);
  const existing = bucket.head ? await bucket.head(objectKey) : null;
  if (existing) {
    if (existing.customMetadata?.sha256 && existing.customMetadata.sha256 !== sha256) throw new Error("immutable_object_hash_conflict");
    return { objectKey, sha256, sizeBytes: existing.size, created: false };
  }
  const sizeBytes = typeof input.body === "string"
    ? new TextEncoder().encode(input.body).byteLength
    : input.body instanceof Uint8Array ? input.body.byteLength : input.body.byteLength;
  await bucket.put(objectKey, input.body, {
    httpMetadata: { contentType: input.contentType },
    customMetadata: { hospitalId: input.hospitalId, sha256, category: input.category, ...input.customMetadata },
  });
  return { objectKey, sha256, sizeBytes, created: true };
}

export async function deletePipelineObject(objectKey: string, runtime?: DataPipelineRuntime) {
  const bucket = await pipelineBucket(runtime);
  let error: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await bucket.delete(objectKey);
      return;
    } catch (caught) {
      error = caught;
    }
  }
  throw error;
}

export type SnapshotRecordInput = {
  sourceRowNumber: number;
  sourceRecordId: string;
  record: Record<string, unknown>;
  status?: "valid" | "quarantined" | "excluded";
  errorCount?: number;
};

export async function createDatasetSnapshot(input: {
  hospitalId: string;
  accountId: string;
  importJobId?: string | null;
  layer: "raw" | "staging" | "curated" | "published";
  version: number;
  parentSnapshotId?: string | null;
  mappingId?: string | null;
  recipeId?: string | null;
  mappingVersion?: string;
  ruleVersion?: string;
  templateCode: string;
  dataDomain: string;
  headers: string[];
  profile: Record<string, unknown>;
  records: SnapshotRecordInput[];
  rawSnapshotId?: string;
}, runtime?: DataPipelineRuntime) {
  const snapshotId = `snapshot-${crypto.randomUUID()}`;
  const canonicalRecords = input.records.map((item) => ({
    ...item.record,
    _lineage: freezeSnapshotLineage({ existing: item.record._lineage, importJobId: input.importJobId, rawSnapshotId: input.rawSnapshotId, layer: input.layer, snapshotId, sourceRowNumber: item.sourceRowNumber, sourceRecordId: item.sourceRecordId }),
  }));
  const ndjson = recordsToNdjson(canonicalRecords);
  const stored = await storeImmutableObject({
    hospitalId: input.hospitalId,
    category: input.layer,
    resourceId: snapshotId,
    extension: "ndjson",
    contentType: "application/x-ndjson",
    body: ndjson,
    customMetadata: { snapshotId, layer: input.layer, templateCode: input.templateCode, dataDomain: input.dataDomain },
  }, runtime);
  const db = await pipelineDb(runtime);
  try {
    await db.insert(dataDatasetSnapshots).values({
      id: snapshotId,
      hospitalId: input.hospitalId,
      importJobId: input.importJobId ?? null,
      layer: input.layer,
      version: input.version,
      status: "building",
      objectKey: stored.objectKey,
      sha256: stored.sha256,
      sizeBytes: stored.sizeBytes,
      rowCount: input.records.length,
      headersJson: JSON.stringify(input.headers),
      profileJson: JSON.stringify({ ...input.profile, templateCode: input.templateCode, dataDomain: input.dataDomain }),
      parentSnapshotId: input.parentSnapshotId ?? null,
      mappingId: input.mappingId ?? null,
      recipeId: input.recipeId ?? null,
      mappingVersion: input.mappingVersion ?? "",
      ruleVersion: input.ruleVersion ?? "",
      createdByAccountId: input.accountId,
    });
    for (let offset = 0; offset < input.records.length; offset += 50) {
      const chunk = input.records.slice(offset, offset + 50);
      const values = await Promise.all(chunk.map(async (item, index) => {
        const canonical = canonicalRecords[offset + index];
        return {
          id: `record-${crypto.randomUUID()}`,
          hospitalId: input.hospitalId,
          snapshotId,
          sourceRowNumber: item.sourceRowNumber,
          sourceRecordId: item.sourceRecordId,
          recordJson: stableStringify(canonical),
          recordSha256: await sha256Hex(stableStringify(canonical)),
          status: item.status ?? "valid",
          errorCount: item.errorCount ?? 0,
          updatedByAccountId: input.accountId,
        };
      }));
      const [first, ...rest] = values;
      if (!first) continue;
      await db.batch([
        db.insert(dataPipelineRecords).values(first),
        ...rest.map((value) => db.insert(dataPipelineRecords).values(value)),
      ]);
    }
    await db.update(dataDatasetSnapshots).set({ status: input.layer === "published" ? "published" : "ready" }).where(and(
      eq(dataDatasetSnapshots.id, snapshotId), eq(dataDatasetSnapshots.hospitalId, input.hospitalId), eq(dataDatasetSnapshots.status, "building"),
    ));
  } catch (error) {
    await db.update(dataDatasetSnapshots).set({ status: "failed" }).where(and(eq(dataDatasetSnapshots.id, snapshotId), eq(dataDatasetSnapshots.hospitalId, input.hospitalId))).catch(() => undefined);
    if (stored.created) await deletePipelineObject(stored.objectKey, runtime).catch(() => undefined);
    throw error;
  }
  return { id: snapshotId, ...stored, rowCount: input.records.length, layer: input.layer, status: input.layer === "published" ? "published" : "ready" };
}

export async function snapshotInHospital(hospitalId: string, snapshotId: string, runtime?: DataPipelineRuntime) {
  const db = await pipelineDb(runtime);
  const [snapshot] = await db.select().from(dataDatasetSnapshots).where(and(
    eq(dataDatasetSnapshots.hospitalId, hospitalId), eq(dataDatasetSnapshots.id, snapshotId),
  )).limit(1);
  return snapshot ?? null;
}

export async function snapshotRecords(hospitalId: string, snapshotId: string, statuses: Array<"valid" | "quarantined" | "excluded"> = ["valid", "quarantined"], runtime?: DataPipelineRuntime) {
  const db = await pipelineDb(runtime);
  const rows = await db.select().from(dataPipelineRecords).where(and(
    eq(dataPipelineRecords.hospitalId, hospitalId),
    eq(dataPipelineRecords.snapshotId, snapshotId),
    inArray(dataPipelineRecords.status, statuses),
  )).orderBy(dataPipelineRecords.sourceRowNumber);
  return rows.map((row) => ({ ...row, record: JSON.parse(row.recordJson) as Record<string, unknown> }));
}

export type PublishedSelector = { hospitalId: string; seriesId?: string; version?: number; publishId?: string };

export type PublishedDatasetManifest = {
  publish: { id: string; seriesId: string; version: number; status: string; mappingVersion: string; ruleVersion: string; publishedAt: string | null; correctionOfId: string | null; rollbackOfId: string | null };
  snapshot: { id: string; objectKey: string; sha256: string; rowCount: number; mappingVersion: string; ruleVersion: string; profile: Record<string, unknown> };
  manifest: Record<string, unknown>;
};

export async function getPublishedDatasetManifest(selector: PublishedSelector, runtime?: DataPipelineRuntime): Promise<PublishedDatasetManifest | null> {
  const db = await pipelineDb(runtime);
  if (!selector.publishId && !selector.seriesId && selector.version === undefined) {
    const preferred = await getPublishedDatasetManifest({ ...selector, seriesId: "hospital-current-supply" }, runtime);
    if (preferred) return preferred;
  }
  const filters = [eq(dataPublishVersions.hospitalId, selector.hospitalId)];
  if (selector.publishId) filters.push(eq(dataPublishVersions.id, selector.publishId));
  else {
    if (selector.seriesId) filters.push(eq(dataPublishVersions.seriesId, selector.seriesId));
    if (selector.version !== undefined) filters.push(eq(dataPublishVersions.version, selector.version));
    else filters.push(eq(dataPublishVersions.status, "published"));
  }
  const [publish] = await db.select().from(dataPublishVersions).where(and(...filters)).orderBy(desc(dataPublishVersions.version)).limit(1);
  if (!publish || !publish.publishedSnapshotId) return null;
  const snapshot = await snapshotInHospital(selector.hospitalId, publish.publishedSnapshotId, runtime);
  if (!snapshot || !["published", "superseded", "withdrawn"].includes(snapshot.status)) return null;
  return {
    publish: {
      id: publish.id, seriesId: publish.seriesId, version: publish.version, status: publish.status,
      mappingVersion: publish.mappingVersion, ruleVersion: publish.ruleVersion, publishedAt: publish.publishedAt,
      correctionOfId: publish.correctionOfId, rollbackOfId: publish.rollbackOfId,
    },
    snapshot: {
      id: snapshot.id, objectKey: snapshot.objectKey, sha256: snapshot.sha256, rowCount: snapshot.rowCount,
      mappingVersion: snapshot.mappingVersion, ruleVersion: snapshot.ruleVersion, profile: JSON.parse(snapshot.profileJson),
    },
    manifest: JSON.parse(publish.manifestJson) as Record<string, unknown>,
  };
}

export async function readPublishedSnapshot(selector: PublishedSelector, runtime?: DataPipelineRuntime) {
  const result = await getPublishedDatasetManifest(selector, runtime);
  if (!result) return null;
  const object = await (await pipelineBucket(runtime)).get(result.snapshot.objectKey);
  if (!object) throw new Error("published_snapshot_object_missing");
  const bytes = object.arrayBuffer ? await object.arrayBuffer() : await new Response(object.body).arrayBuffer();
  const actualSha = await sha256Hex(bytes);
  if (actualSha !== result.snapshot.sha256) throw new Error("published_snapshot_hash_mismatch");
  const text = new TextDecoder().decode(bytes);
  const records = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  if (records.length !== result.snapshot.rowCount) throw new Error("published_snapshot_row_count_mismatch");
  return { ...result, records };
}

export async function getCurrentPublishedDatasetSet(input: { hospitalId: string }, runtime?: DataPipelineRuntime) {
  const db = await pipelineDb(runtime);
  const rows = await db.select().from(dataPublishVersions).where(and(
    eq(dataPublishVersions.hospitalId, input.hospitalId),
    eq(dataPublishVersions.status, "published"),
  )).orderBy(desc(dataPublishVersions.version), desc(dataPublishVersions.publishedAt));
  const primary = rows.find((row) => row.seriesId === "hospital-current-supply" && Boolean(row.publishedSnapshotId));
  const selected = (primary ? [primary] : [...new Map(rows.map((row) => [row.seriesId, row])).values()])
    .filter((row) => Boolean(row.publishedSnapshotId));
  const sources = [];
  for (const publish of selected) {
    const snapshot = publish.publishedSnapshotId ? await snapshotInHospital(input.hospitalId, publish.publishedSnapshotId, runtime) : null;
    if (!snapshot || snapshot.status !== "published") continue;
    sources.push({
      dataDomain: publish.dataDomain,
      publish: { id: publish.id, seriesId: publish.seriesId, version: publish.version, status: publish.status, mappingVersion: publish.mappingVersion, ruleVersion: publish.ruleVersion, correctionOfId: publish.correctionOfId, rollbackOfId: publish.rollbackOfId, publishedAt: publish.publishedAt },
      snapshot: { id: snapshot.id, objectKey: snapshot.objectKey, sha256: snapshot.sha256, rowCount: snapshot.rowCount, profile: JSON.parse(snapshot.profileJson) },
      manifest: JSON.parse(publish.manifestJson) as Record<string, unknown>,
    });
  }
  const supplyHash = await sha256Hex(stableStringify(sources.map((source) => ({
    dataDomain: source.dataDomain,
    seriesId: source.publish.seriesId,
    version: source.publish.version,
    snapshotId: source.snapshot.id,
    sha256: source.snapshot.sha256,
    rowCount: source.snapshot.rowCount,
  }))));
  return { hospitalId: input.hospitalId, supplyHash, sourceCount: sources.length, rowCount: sources.reduce((sum, source) => sum + source.snapshot.rowCount, 0), sources };
}

export async function readCurrentPublishedDatasetSet(input: { hospitalId: string }, runtime?: DataPipelineRuntime) {
  const set = await getCurrentPublishedDatasetSet(input, runtime);
  const sources = [];
  for (const source of set.sources) {
    const object = await (await pipelineBucket(runtime)).get(source.snapshot.objectKey);
    if (!object) throw new Error("published_snapshot_object_missing");
    const bytes = object.arrayBuffer ? await object.arrayBuffer() : await new Response(object.body).arrayBuffer();
    if (await sha256Hex(bytes) !== source.snapshot.sha256) throw new Error("published_snapshot_hash_mismatch");
    const records = new TextDecoder().decode(bytes).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    if (records.length !== source.snapshot.rowCount) throw new Error("published_snapshot_row_count_mismatch");
    sources.push({ ...source, records });
  }
  return { ...set, sources };
}
