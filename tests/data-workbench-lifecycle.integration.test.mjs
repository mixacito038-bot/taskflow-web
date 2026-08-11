import assert from "node:assert/strict";
import test from "node:test";

import { and, eq } from "drizzle-orm";

import { buildPublishedPayload, normalizePublishedDefinitions } from "../app/published-data-server-model.ts";
import { listDataWorkbenchResource } from "../db/data-workbench.ts";
import { parseFileDataset } from "../db/data-workbench-file-parser.ts";
import {
  createDatasetSnapshot,
  readCurrentPublishedDatasetSet,
  readPublishedSnapshot,
  recordsToNdjson,
  sha256Hex,
  snapshotRecords,
  storeImmutableObject,
} from "../db/data-workbench-pipeline.ts";
import { applyFieldMapping, executeCleaningRules, normalizeFieldMapping } from "../db/data-workbench-transform.ts";
import {
  dataCleaningRecipes,
  dataCleaningRules,
  dataDatasetSnapshots,
  dataFieldMappings,
  dataImportJobs,
  dataLineageEvents,
  dataMetricDefinitions,
  dataPipelineRecords,
  dataPublishVersions,
  dataReviewEvents,
  dataVisualizationDefinitions,
  rawDatasets,
} from "../db/schema.ts";
import { createMigratedTestDatabase, FakeR2Bucket } from "./helpers/sqlite-d1-r2.mjs";

const hospitalId = "hospital-lifecycle";
const accountId = "account-lifecycle";
const reviewerId = "account-reviewer";
const seriesId = "hospital-current-supply";

const template = {
  code: "device_master",
  dataDomain: "device",
  requiredFields: ["deviceId", "deviceName"],
  aliases: {
    设备编号: "deviceId",
    设备名称: "deviceName",
    科室: "department",
    投资额: "investment",
  },
};

const mappingFields = normalizeFieldMapping({
  fields: [
    { source: "deviceId", target: "deviceId", transform: "trim" },
    { source: "deviceName", target: "deviceName" },
    { source: "department", target: "department", transform: "trim" },
    { source: "investment", target: "investment" },
  ],
});

const cleaningRules = [
  { id: "rule-trim-name", sequence: 1, ruleType: "trim", fieldName: "deviceName", config: {}, enabled: true },
  { id: "rule-number-investment", sequence: 2, ruleType: "number", fieldName: "investment", config: {}, enabled: true },
  { id: "rule-unique-device", sequence: 3, ruleType: "deduplicate", fieldName: "deviceId", config: { keyFields: ["deviceId"] }, enabled: true },
];

async function objectText(bucket, key) {
  const object = await bucket.get(key);
  assert.ok(object, `expected object ${key}`);
  return new TextDecoder().decode(await object.arrayBuffer());
}

function publishManifest(snapshot, metricId, visualizationId, extra = {}) {
  return {
    source: { snapshots: [{ snapshotId: snapshot.id }] },
    definitions: {
      metrics: [{ id: metricId, code: "investment", version: 1 }],
      visualizations: [{ id: visualizationId, code: "investment_bar", version: 1, metricId }],
    },
    transform: { allocationRule: "equal_by_body_part" },
    dataset: {
      snapshotId: snapshot.id,
      sha256: snapshot.sha256,
      rowCount: snapshot.rowCount,
      objectKey: snapshot.objectKey,
    },
    ...extra,
  };
}

test("真实迁移与对象存储贯穿导入、映射、清洗、复核、发布、更正和回滚", async (t) => {
  const { sqlite, db } = await createMigratedTestDatabase();
  t.after(() => sqlite.close());
  const bucket = new FakeR2Bucket();
  const runtime = { db, bucket };

  sqlite.exec(`
    INSERT INTO hospitals(id, code, name, short_name) VALUES
      ('${hospitalId}', 'LIFE', '生命周期测试医院', '测试医院');
    INSERT INTO accounts(id, email, display_name) VALUES
      ('${accountId}', 'creator@example.test', '创建人'),
      ('${reviewerId}', 'reviewer@example.test', '复核人');
  `);

  await db.insert(dataFieldMappings).values({
    id: "mapping-device-v1", hospitalId, dataDomain: "device", name: "设备字段映射", version: 1,
    mappingJson: JSON.stringify({ fields: mappingFields }), status: "active",
    createdByAccountId: accountId, updatedByAccountId: accountId,
  });
  await db.insert(dataCleaningRecipes).values({
    id: "recipe-device-v1", hospitalId, dataDomain: "device", name: "设备清洗规则", version: 1, status: "active",
    createdByAccountId: accountId, updatedByAccountId: accountId,
  });
  await db.insert(dataCleaningRules).values(cleaningRules.map((rule) => ({
    id: rule.id, hospitalId, recipeId: "recipe-device-v1", sequence: rule.sequence,
    ruleType: rule.ruleType, fieldName: rule.fieldName, configJson: JSON.stringify(rule.config), enabled: rule.enabled,
  })));

  const ingest = async ({ importId, fileName, csv }) => {
    const bytes = new TextEncoder().encode(csv);
    const parsed = await parseFileDataset(bytes, { fileName }, template);
    assert.equal(parsed.parseMode, "server_csv");
    assert.equal(parsed.records.length, 3);

    const original = await storeImmutableObject({
      hospitalId, category: "original", resourceId: importId, extension: "csv", contentType: "text/csv", body: bytes,
      customMetadata: { importId },
    }, runtime);
    await db.insert(dataImportJobs).values({
      id: importId, hospitalId, dataDomain: "device", ingestionMode: "file", fileName,
      objectKey: original.objectKey, sha256: original.sha256, status: "pending_mapping", rowCount: parsed.records.length,
      businessTemplateCode: template.code, selectedSheet: parsed.selectedSheet, headerRow: parsed.headerRow,
      parserConfigJson: JSON.stringify({ headers: parsed.headers }), idempotencyKey: `idem-${importId}`,
      createdByAccountId: accountId,
    });
    const raw = await createDatasetSnapshot({
      hospitalId, accountId, importJobId: importId, layer: "raw", version: 1,
      templateCode: template.code, dataDomain: "device", headers: parsed.headers,
      profile: { templateCode: template.code, dataDomain: "device", requiredFields: template.requiredFields },
      records: parsed.records.map((record, index) => ({ sourceRowNumber: index + 2, sourceRecordId: `${importId}:${index + 2}`, record })),
    }, runtime);
    await db.insert(rawDatasets).values({
      id: `dataset-${importId}`, hospitalId, importJobId: importId, objectKey: raw.objectKey,
      contentType: "application/x-ndjson", sizeBytes: raw.sizeBytes, sha256: raw.sha256,
      rowCount: raw.rowCount, schemaJson: JSON.stringify({ headers: parsed.headers }), profileJson: JSON.stringify(parsed.profile),
      createdByAccountId: accountId,
    });
    await db.insert(dataLineageEvents).values({
      hospitalId, actorAccountId: accountId, action: "file_imported", resourceType: "snapshot", resourceId: raw.id,
      toStatus: "raw", importJobId: importId, datasetVersion: raw.id,
    });

    const rawRows = await snapshotRecords(hospitalId, raw.id, ["valid"], runtime);
    const mapped = applyFieldMapping(rawRows.map((row) => row.record), mappingFields, template.code)
      .map((record) => ({ ...record, recordType: "device", dataDomain: "device" }));
    const staging = await createDatasetSnapshot({
      hospitalId, accountId, importJobId: importId, layer: "staging", version: 1, parentSnapshotId: raw.id,
      mappingId: "mapping-device-v1", mappingVersion: "设备字段映射@1",
      templateCode: template.code, dataDomain: "device", headers: Object.keys(mapped[0]),
      profile: { templateCode: template.code, dataDomain: "device", requiredFields: template.requiredFields },
      records: mapped.map((record, index) => ({ sourceRowNumber: rawRows[index].sourceRowNumber, sourceRecordId: rawRows[index].sourceRecordId, record })),
    }, runtime);
    await db.update(dataImportJobs).set({ status: "validating", revision: 2 }).where(eq(dataImportJobs.id, importId));
    await db.insert(dataLineageEvents).values({
      hospitalId, actorAccountId: accountId, action: "mapping_applied", resourceType: "snapshot", resourceId: staging.id,
      fromStatus: "raw", toStatus: "staging", importJobId: importId, datasetVersion: staging.id, mappingVersion: "设备字段映射@1",
    });

    const stagingRows = await snapshotRecords(hospitalId, staging.id, ["valid"], runtime);
    const cleaned = executeCleaningRules(stagingRows.map((row) => row.record), cleaningRules, template.requiredFields);
    assert.deepEqual(cleaned.issues, []);
    const curated = await createDatasetSnapshot({
      hospitalId, accountId, importJobId: importId, layer: "curated", version: 1, parentSnapshotId: staging.id,
      mappingId: "mapping-device-v1", recipeId: "recipe-device-v1", mappingVersion: "设备字段映射@1", ruleVersion: "设备清洗规则@1",
      templateCode: template.code, dataDomain: "device", headers: Object.keys(cleaned.records[0]),
      profile: { templateCode: template.code, dataDomain: "device", requiredFields: template.requiredFields, impacts: cleaned.impacts },
      records: cleaned.records.map((record, index) => ({ sourceRowNumber: stagingRows[index].sourceRowNumber, sourceRecordId: stagingRows[index].sourceRecordId, record })),
    }, runtime);
    await db.update(dataImportJobs).set({ status: "pending_review", acceptedCount: 3, rejectedCount: 0, revision: 3 }).where(eq(dataImportJobs.id, importId));
    await db.insert(dataReviewEvents).values({
      hospitalId, resourceType: "import", resourceId: importId, decision: "approve", actorAccountId: reviewerId,
      comment: "独立复核通过",
    });
    await db.update(dataImportJobs).set({ status: "ready", reviewedByAccountId: reviewerId, revision: 4 }).where(eq(dataImportJobs.id, importId));
    await db.insert(dataLineageEvents).values({
      hospitalId, actorAccountId: reviewerId, action: "cleaning_completed_and_reviewed", resourceType: "snapshot", resourceId: curated.id,
      fromStatus: "staging", toStatus: "curated", importJobId: importId, datasetVersion: curated.id,
      mappingVersion: "设备字段映射@1", ruleVersion: "设备清洗规则@1",
    });
    return { importId, parsed, original, raw, staging, curated };
  };

  const originalCsv = "\uFEFF设备编号,设备名称,科室,投资额\n D-001 , CT 一号 ,影像科,\"1,000\"\nD-002,DR 一号,影像科,500\nD-003,超声一号,超声科,300\n";
  const first = await ingest({ importId: "import-original", fileName: "设备原始.csv", csv: originalCsv });

  const originalBytes = await objectText(bucket, first.original.objectKey);
  const deduplicatedOriginal = await storeImmutableObject({
    hospitalId, category: "original", resourceId: first.importId, extension: "csv", contentType: "text/csv",
    body: "不会覆盖已有对象", sha256: first.original.sha256,
  }, runtime);
  assert.equal(deduplicatedOriginal.created, false);
  assert.equal(await objectText(bucket, first.original.objectKey), originalBytes);

  const rawPage = await listDataWorkbenchResource(hospitalId, "records", { snapshotId: first.raw.id, limit: 2, offset: 1 }, db);
  assert.deepEqual(rawPage.map((row) => row.sourceRowNumber), [3, 4]);
  assert.equal((await listDataWorkbenchResource(hospitalId, "records", { snapshotId: "missing", limit: 10 }, db)).length, 0);
  const importSnapshots = await listDataWorkbenchResource(hospitalId, "snapshots", { importId: first.importId, limit: 10 }, db);
  assert.deepEqual(new Set(importSnapshots.map((snapshot) => snapshot.layer)), new Set(["raw", "staging", "curated"]));

  const curatedRows = await snapshotRecords(hospitalId, first.curated.id, ["valid"], runtime);
  assert.equal(curatedRows[0].record.deviceId, "D-001");
  assert.equal(curatedRows[0].record.deviceName, "CT 一号");
  assert.equal(curatedRows[0].record.investment, 1000);
  assert.equal(curatedRows[0].record._lineage.rawSnapshotId, first.raw.id);
  for (const row of curatedRows) assert.equal(await sha256Hex(row.recordJson), row.recordSha256);

  const metricId = "metric-investment-v1";
  const visualizationId = "visual-investment-v1";
  await db.insert(dataMetricDefinitions).values({
    id: metricId, hospitalId, code: "investment", name: "设备投资额", formula: "SUM(investment)", aggregation: "sum",
    dimensionsJson: "[\"department\"]", sourceFieldRefsJson: "[\"investment\"]", unit: "元", status: "active", version: 1,
    createdByAccountId: accountId, updatedByAccountId: reviewerId,
  });
  await db.insert(dataVisualizationDefinitions).values({
    id: visualizationId, hospitalId, code: "investment_bar", name: "科室投资额", metricId,
    chartType: "bar", dimension: "department", sortJson: "{\"direction\":\"desc\"}", status: "active", version: 1,
    createdByAccountId: accountId, updatedByAccountId: reviewerId,
  });

  const createPublishedSnapshot = async (sourceRows, version) => createDatasetSnapshot({
    hospitalId, accountId, layer: "published", version, mappingVersion: "设备字段映射@1", ruleVersion: "设备清洗规则@1",
    templateCode: "composite", dataDomain: "device", headers: Object.keys(sourceRows[0].record),
    profile: { seriesId, schema: "canonical-dotted-fields-v1" },
    records: sourceRows.map((row, index) => ({ sourceRowNumber: index + 1, sourceRecordId: row.sourceRecordId, record: row.record })),
  }, runtime);

  const publishedOne = await createPublishedSnapshot(curatedRows, 1);
  const manifestOne = publishManifest(publishedOne, metricId, visualizationId);
  await db.insert(dataPublishVersions).values({
    id: "publish-v1", hospitalId, seriesId, version: 1, dataDomain: "device", status: "published",
    sourceImportIdsJson: JSON.stringify([first.importId]), manifestJson: JSON.stringify(manifestOne), rowCount: publishedOne.rowCount,
    mappingVersion: "设备字段映射@1", ruleVersion: "设备清洗规则@1", curatedSnapshotId: first.curated.id,
    publishedSnapshotId: publishedOne.id, snapshotSha256: publishedOne.sha256, idempotencyKey: "publish-v1",
    createdByAccountId: accountId, reviewedByAccountId: reviewerId, publishedByAccountId: reviewerId,
    reviewedAt: "2026-08-11T01:00:00.000Z", publishedAt: "2026-08-11T01:00:01.000Z",
  });
  await db.update(dataImportJobs).set({ status: "published", revision: 5 }).where(eq(dataImportJobs.id, first.importId));
  await db.insert(dataLineageEvents).values({
    hospitalId, actorAccountId: reviewerId, action: "publish_status_changed", resourceType: "publish", resourceId: "publish-v1",
    fromStatus: "approved", toStatus: "published", datasetVersion: `${seriesId}@1`, mappingVersion: "设备字段映射@1", ruleVersion: "设备清洗规则@1",
  });

  const metricRows = await db.select().from(dataMetricDefinitions).where(eq(dataMetricDefinitions.id, metricId));
  const visualizationRows = await db.select().from(dataVisualizationDefinitions).where(eq(dataVisualizationDefinitions.id, visualizationId));
  const normalizedDefinitions = normalizePublishedDefinitions(metricRows, visualizationRows);
  const supplyOne = await readCurrentPublishedDatasetSet({ hospitalId }, runtime);
  const payloadOne = buildPublishedPayload({ hospitalId, supplyHash: supplyOne.supplyHash, sources: supplyOne.sources, ...normalizedDefinitions });
  assert.equal(payloadOne.publication.id, "publish-v1");
  assert.equal(payloadOne.publication.snapshotSha256, publishedOne.sha256);
  assert.equal(payloadOne.rows[0].deviceName, "CT 一号");

  const correctionCsv = originalCsv.replace(" CT 一号 ", " CT 一号（更正） ");
  const correction = await ingest({ importId: "import-correction", fileName: "设备更正.csv", csv: correctionCsv });
  const correctionRows = await snapshotRecords(hospitalId, correction.curated.id, ["valid"], runtime);
  const publishedTwo = await createPublishedSnapshot(correctionRows, 2);
  const manifestTwo = publishManifest(publishedTwo, metricId, visualizationId, { correction: { correctionOfId: "publish-v1" } });
  await db.batch([
    db.update(dataPublishVersions).set({ status: "superseded" }).where(and(eq(dataPublishVersions.id, "publish-v1"), eq(dataPublishVersions.status, "published"))),
    db.update(dataDatasetSnapshots).set({ status: "superseded" }).where(eq(dataDatasetSnapshots.id, publishedOne.id)),
    db.insert(dataPublishVersions).values({
      id: "publish-v2", hospitalId, seriesId, version: 2, dataDomain: "device", status: "published",
      sourceImportIdsJson: JSON.stringify([correction.importId]), manifestJson: JSON.stringify(manifestTwo), rowCount: publishedTwo.rowCount,
      mappingVersion: "设备字段映射@1", ruleVersion: "设备清洗规则@1", curatedSnapshotId: correction.curated.id,
      publishedSnapshotId: publishedTwo.id, snapshotSha256: publishedTwo.sha256, correctionOfId: "publish-v1", idempotencyKey: "publish-v2",
      createdByAccountId: accountId, reviewedByAccountId: reviewerId, publishedByAccountId: reviewerId,
      reviewedAt: "2026-08-11T02:00:00.000Z", publishedAt: "2026-08-11T02:00:01.000Z",
    }),
  ]);
  await db.update(dataImportJobs).set({ status: "published", revision: 5 }).where(eq(dataImportJobs.id, correction.importId));
  await db.insert(dataLineageEvents).values({
    hospitalId, actorAccountId: reviewerId, action: "publish_correction_published", resourceType: "publish", resourceId: "publish-v2",
    fromStatus: "approved", toStatus: "published", datasetVersion: `${seriesId}@2`, detailJson: JSON.stringify({ correctionOfId: "publish-v1" }),
  });

  const supplyTwo = await readCurrentPublishedDatasetSet({ hospitalId }, runtime);
  assert.notEqual(supplyTwo.supplyHash, supplyOne.supplyHash);
  assert.equal(supplyTwo.sources[0].publish.correctionOfId, "publish-v1");
  assert.equal(supplyTwo.sources[0].records[0].deviceName, "CT 一号（更正）");
  const immutableOldPublish = await readPublishedSnapshot({ hospitalId, publishId: "publish-v1" }, runtime);
  assert.equal(immutableOldPublish.records[0].deviceName, "CT 一号");
  assert.equal(await sha256Hex(recordsToNdjson(immutableOldPublish.records)), publishedOne.sha256);

  const rollbackSource = immutableOldPublish.records.map((record, index) => ({
    sourceRowNumber: index + 1,
    sourceRecordId: record._lineage.sourceRecordId,
    record,
  }));
  const publishedThree = await createPublishedSnapshot(rollbackSource, 3);
  assert.equal(publishedThree.sha256, publishedOne.sha256, "rollback must reproduce the frozen target bytes");
  const manifestThree = publishManifest(publishedThree, metricId, visualizationId, {
    rollback: { rollbackOfId: "publish-v1", restoreFromPublishedSnapshotId: publishedOne.id },
  });
  await db.batch([
    db.update(dataPublishVersions).set({ status: "superseded" }).where(and(eq(dataPublishVersions.id, "publish-v2"), eq(dataPublishVersions.status, "published"))),
    db.update(dataDatasetSnapshots).set({ status: "superseded" }).where(eq(dataDatasetSnapshots.id, publishedTwo.id)),
    db.insert(dataPublishVersions).values({
      id: "publish-v3", hospitalId, seriesId, version: 3, dataDomain: "device", status: "published",
      sourceImportIdsJson: JSON.stringify([first.importId]), manifestJson: JSON.stringify(manifestThree), rowCount: publishedThree.rowCount,
      mappingVersion: "设备字段映射@1", ruleVersion: "设备清洗规则@1", curatedSnapshotId: first.curated.id,
      publishedSnapshotId: publishedThree.id, snapshotSha256: publishedThree.sha256, rollbackOfId: "publish-v1", idempotencyKey: "publish-v3",
      reviewComment: "恢复首个已发布快照", createdByAccountId: accountId, reviewedByAccountId: reviewerId, publishedByAccountId: reviewerId,
      reviewedAt: "2026-08-11T03:00:00.000Z", publishedAt: "2026-08-11T03:00:01.000Z",
    }),
  ]);
  await db.insert(dataReviewEvents).values({
    hospitalId, resourceType: "publish", resourceId: "publish-v3", decision: "rollback", actorAccountId: reviewerId,
    comment: "独立复核后恢复首个已发布版本",
  });
  await db.insert(dataLineageEvents).values({
    hospitalId, actorAccountId: reviewerId, action: "publish_rollback_completed", resourceType: "publish", resourceId: "publish-v3",
    fromStatus: "approved", toStatus: "published", datasetVersion: `${seriesId}@3`, detailJson: JSON.stringify({ rollbackOfId: "publish-v1" }),
  });

  const supplyThree = await readCurrentPublishedDatasetSet({ hospitalId }, runtime);
  assert.notEqual(supplyThree.supplyHash, supplyTwo.supplyHash);
  assert.equal(supplyThree.sources[0].publish.rollbackOfId, "publish-v1");
  assert.equal(supplyThree.sources[0].records[0].deviceName, "CT 一号");
  assert.equal((await db.select().from(dataPublishVersions).where(and(eq(dataPublishVersions.hospitalId, hospitalId), eq(dataPublishVersions.status, "published")))).length, 1);
  await assert.rejects(db.insert(dataPublishVersions).values({
    id: "publish-illegal-second-active", hospitalId, seriesId, version: 4, dataDomain: "device", status: "published",
    sourceImportIdsJson: "[]", manifestJson: "{}", createdByAccountId: accountId,
  }), (error) => /UNIQUE/.test(String(error?.cause?.message ?? error?.message)));

  const lineage = await db.select().from(dataLineageEvents).where(eq(dataLineageEvents.hospitalId, hospitalId));
  assert.ok(lineage.some((event) => event.action === "mapping_applied"));
  assert.ok(lineage.some((event) => event.action === "cleaning_completed_and_reviewed"));
  assert.ok(lineage.some((event) => event.action === "publish_correction_published"));
  assert.ok(lineage.some((event) => event.action === "publish_rollback_completed"));
  const reviews = await db.select().from(dataReviewEvents).where(eq(dataReviewEvents.hospitalId, hospitalId));
  assert.equal(reviews.filter((event) => event.resourceType === "import" && event.decision === "approve").length, 2);
  assert.equal(reviews.filter((event) => event.decision === "rollback").length, 1);

  bucket.tamper(publishedThree.objectKey, "tampered published bytes");
  await assert.rejects(readCurrentPublishedDatasetSet({ hospitalId }, runtime), /published_snapshot_hash_mismatch/);

  const persistedRecords = await db.select().from(dataPipelineRecords).where(eq(dataPipelineRecords.hospitalId, hospitalId));
  assert.ok(persistedRecords.length >= 21, "every snapshot layer should persist row-level records");
  assert.equal(bucket.has(first.raw.objectKey), true);
  assert.equal(bucket.has(first.staging.objectKey), true);
  assert.equal(bucket.has(first.curated.objectKey), true);
  assert.equal(bucket.has(publishedOne.objectKey), true);
});
