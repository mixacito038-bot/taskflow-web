import { and, eq } from "drizzle-orm";
import {
  buildSampleDataCsv,
  buildSampleDataRows,
  SAMPLE_DATA_PACKAGE_VERSION,
} from "../app/sample-data-package";
import { FILE_BUSINESS_TEMPLATES } from "../app/data-workbench-model";
import {
  createDatasetSnapshot,
  snapshotRecords,
  storeImmutableObject,
  type DataPipelineRuntime,
} from "./data-workbench-pipeline";
import {
  dataImportJobs,
  dataLineageEvents,
  dataMetricDefinitions,
  dataPublishVersions,
  dataReviewEvents,
  dataVisualizationDefinitions,
  rawDatasets,
} from "./schema";

/**
 * 示范数据一键正式发布：把示范数据包中的核心业务文件按真实治理链路
 * （原始对象 → raw → staging → curated → published）落库，并创建
 * `hospital-current-supply` 供数版本，使新部署的医院在正式模式下立即
 * 有可追溯的示范数据可看。
 *
 * 边界：
 * - 医院已存在任何已发布供数版本时拒绝执行（sample_publish_conflict），绝不覆盖真实数据；
 * - 所有导入批次、血缘与发布清单都带“示范数据包”标识与版本号；
 * - 金额沿用示范数据包的万元口径；派生的设备级汇总字段在清单中声明为 derivedFields；
 * - 全部内部主键按医院隔离，同院上次失败的残留批次会在重试前清理后重放。
 */

const SAMPLE_SERIES_ID = "hospital-current-supply";
const SAMPLE_MAPPING_VERSION = `示范数据映射@${SAMPLE_DATA_PACKAGE_VERSION}`;
const SAMPLE_RULE_VERSION = `示范数据规则@${SAMPLE_DATA_PACKAGE_VERSION}`;
const SAMPLE_TEMPLATE_CODES = [
  "device_master",
  "exam_activity",
  "billing_revenue",
  "cost_detail",
  "utilization",
] as const;

const MONEY_FIELDS: Record<string, readonly string[]> = {
  device_master: ["investment"],
  exam_activity: ["examRevenue", "examCost"],
  billing_revenue: ["amount", "refundAmount"],
  cost_detail: ["amount"],
  utilization: [],
};

const NUMERIC_FIELDS: Record<string, readonly string[]> = {
  device_master: ["quantity", "planPayback", "forecastPayback"],
  exam_activity: ["allocationWeight"],
  billing_revenue: [],
  cost_detail: [],
  utilization: ["scheduledMinutes", "poweredMinutes", "activeMinutes", "downtimeMinutes", "examCount"],
};

const RECORD_TYPES: Record<string, string> = {
  device_master: "device",
  exam_activity: "exam",
  billing_revenue: "billing",
  cost_detail: "cost_detail",
  utilization: "utilization",
};

const COST_TYPE_KEYS: Record<string, "labor" | "consumables" | "depreciation" | "maintenance" | "energy"> = {
  人工: "labor",
  人工成本: "labor",
  耗材: "consumables",
  耗材成本: "consumables",
  折旧: "depreciation",
  折旧成本: "depreciation",
  维保: "maintenance",
  维修: "maintenance",
  维修维保: "maintenance",
  能耗: "energy",
  水电气: "energy",
};

export class SamplePublishError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = "SamplePublishError";
    this.code = code;
    this.status = status;
  }
}

type PublisherInput = {
  db: NonNullable<DataPipelineRuntime["db"]>;
  bucket: NonNullable<DataPipelineRuntime["bucket"]>;
  hospitalId: string;
  accountId: string;
};

type PublishedRecord = Record<string, unknown>;

/** 示范数据包金额字段已统一为万元，这里只做数值化，不再二次换算。 */
function toMoney(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 10000) / 10000 : null;
}

function toNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRecord(templateCode: string, row: Readonly<Record<string, string>>): PublishedRecord {
  const record: PublishedRecord = { ...row };
  record.recordType = RECORD_TYPES[templateCode];
  record.dataDomain = FILE_BUSINESS_TEMPLATES.find((template) => template.code === templateCode)?.dataDomain ?? templateCode;
  for (const field of MONEY_FIELDS[templateCode] ?? []) {
    if (row[field] !== undefined && row[field] !== "") {
      const converted = toMoney(row[field]);
      if (converted !== null) record[field] = converted;
    }
  }
  for (const field of NUMERIC_FIELDS[templateCode] ?? []) {
    if (row[field] !== undefined && row[field] !== "") {
      const converted = toNumber(row[field]);
      if (converted !== null) record[field] = converted;
    }
  }
  return record;
}

/**
 * 设备级派生汇总：利用率（分钟口径）、收费净额、检查人次与七类成本（万元）。
 * 直接写在设备主记录上（canonical 字段），保证前台设备档案完整可算；
 * 明细行仍随发布快照保留，期间趋势按明细聚合。
 */
function enrichDeviceRecords(recordsByTemplate: Map<string, PublishedRecord[]>): { derivedFields: string[] } {
  const devices = recordsByTemplate.get("device_master") ?? [];
  const exams = recordsByTemplate.get("exam_activity") ?? [];
  const billing = recordsByTemplate.get("billing_revenue") ?? [];
  const costs = recordsByTemplate.get("cost_detail") ?? [];
  const utilization = recordsByTemplate.get("utilization") ?? [];

  const deviceByExam = new Map<string, string>();
  for (const exam of exams) {
    if (typeof exam.examId === "string" && typeof exam.deviceId === "string") {
      deviceByExam.set(exam.examId, exam.deviceId);
    }
  }

  for (const device of devices) {
    const deviceId = String(device.deviceId ?? "");
    const deviceExams = exams.filter((row) => row.deviceId === deviceId && typeof row.examId === "string");
    const sampledExamCount = new Set(deviceExams.map((row) => String(row.examId))).size;

    let sampledRevenue = 0;
    for (const row of billing) {
      const rowDevice = typeof row.deviceId === "string" && row.deviceId
        ? row.deviceId
        : typeof row.examId === "string" ? deviceByExam.get(row.examId) ?? "" : "";
      if (rowDevice !== deviceId) continue;
      const amount = typeof row.amount === "number" ? row.amount : 0;
      const refund = typeof row.refundAmount === "number" ? row.refundAmount : 0;
      sampledRevenue += amount - refund;
    }

    let scheduled = 0;
    let active = 0;
    let annualExamCount = 0;
    for (const row of utilization) {
      if (row.deviceId !== deviceId) continue;
      scheduled += typeof row.scheduledMinutes === "number" ? row.scheduledMinutes : 0;
      active += typeof row.activeMinutes === "number" ? row.activeMinutes : 0;
      annualExamCount += typeof row.examCount === "number" ? row.examCount : 0;
    }
    device.utilization = scheduled > 0 ? Math.round((active / scheduled) * 1000) / 10 : 0;

    // 检查与收费明细是逐月抽样（每设备每月数条真实事实行），工作量与成本则是全年全量：
    // 因此设备年收入 = 抽样收费均价 × 利用表全年检查人次，口径写入发布清单 sample.revenueBasis。
    // 无检查事实的设备（检验流水线、呼吸机等）如实归零，绝不编造。
    device.serviceVolume = annualExamCount > 0 ? annualExamCount : sampledExamCount;
    const revenue = sampledExamCount > 0 && annualExamCount > 0
      ? (sampledRevenue / sampledExamCount) * annualExamCount
      : sampledRevenue;
    device.revenue = Math.round(revenue * 10000) / 10000;

    const costTotals = { labor: 0, consumables: 0, depreciation: 0, maintenance: 0, energy: 0 };
    for (const row of costs) {
      if (row.deviceId !== deviceId) continue;
      const key = COST_TYPE_KEYS[String(row.costType ?? "").trim()];
      if (!key) continue;
      costTotals[key] += typeof row.amount === "number" ? row.amount : 0;
    }
    const directCost = costTotals.labor + costTotals.consumables + costTotals.depreciation + costTotals.maintenance + costTotals.energy;
    device.costLabor = Math.round(costTotals.labor * 100) / 100;
    device.costConsumables = Math.round(costTotals.consumables * 100) / 100;
    device.costDepreciation = Math.round(costTotals.depreciation * 100) / 100;
    device.costMaintenance = Math.round(costTotals.maintenance * 100) / 100;
    device.costEnergy = Math.round(costTotals.energy * 100) / 100;
    // 空间与间接成本示范口径：按可控直接成本 2% / 3% 分摊，真实上线由财务口径替换。
    device.costSpace = Math.round(directCost * 2) / 100;
    device.costIndirect = Math.round(directCost * 3) / 100;

    const totalCost = directCost + (device.costSpace as number) + (device.costIndirect as number);
    const net = (device.revenue as number) - totalCost;
    const utilizationValue = device.utilization as number;
    device.status = net < 0 ? "效益预警" : utilizationValue < 55 ? "需要关注" : "运行良好";
  }
  return {
    derivedFields: ["serviceVolume", "revenue", "utilization", "costLabor", "costConsumables", "costDepreciation", "costMaintenance", "costEnergy", "costSpace", "costIndirect", "status"],
  };
}

/**
 * 一键示范发布由同一个平台管理员完成导入、复核与发布，绕过了正式链路的
 * 职责分离门禁（创建人不得复核/发布自己的批次）。这属于显式破例，必须像
 * 人工破例一样留痕：复核事件记 break_glass + 理由，血缘事件标 breakGlass，
 * 发布清单写入 governance，审计时一眼可辨，不能伪装成正常的双人复核。
 */
const SAMPLE_BREAK_GLASS_REASON = "示范数据包一键发布：由平台管理员单人完成导入、复核与发布，绕过职责分离门禁；数据为脱敏虚构口径，仅用于演示与链路验收，不得作为正式经营结论。";

export type SamplePublishSummary = {
  seriesId: string;
  publishId: string;
  version: number;
  files: Array<{ templateCode: string; fileName: string; rowCount: number; importId: string }>;
  publishedRowCount: number;
  sampleVersion: string;
};

export async function publishSampleDataset({ db, bucket, hospitalId, accountId }: PublisherInput): Promise<SamplePublishSummary> {
  const runtime: DataPipelineRuntime = { db, bucket };

  const [existingPublish] = await db.select({ id: dataPublishVersions.id })
    .from(dataPublishVersions)
    .where(and(eq(dataPublishVersions.hospitalId, hospitalId), eq(dataPublishVersions.status, "published")))
    .limit(1);
  if (existingPublish) throw new SamplePublishError("sample_publish_conflict", 409);

  // 上次执行中途失败会留下同院的示范批次（无已发布版本）；先清理再重放，
  // rawDatasets 通过 importJobId 外键级联删除，R2 对象内容寻址天然幂等无需处理。
  const staleImportIds = SAMPLE_TEMPLATE_CODES.map((templateCode) => `import-sample-${hospitalId}-${templateCode}`);
  for (const staleId of staleImportIds) {
    await db.delete(dataImportJobs).where(and(
      eq(dataImportJobs.hospitalId, hospitalId),
      eq(dataImportJobs.id, staleId),
    ));
  }
  await db.delete(dataPublishVersions).where(and(
    eq(dataPublishVersions.hospitalId, hospitalId),
    eq(dataPublishVersions.id, `publish-sample-${hospitalId}-${SAMPLE_DATA_PACKAGE_VERSION.replaceAll(".", "-")}`),
  ));

  const now = new Date().toISOString();
  const files: SamplePublishSummary["files"] = [];
  const sourceImportIds: string[] = [];
  const sourceSnapshotIds: string[] = [];
  const sourceDescriptors: Array<{ snapshotId: string; importId: string; templateCode: string; rowCount: number }> = [];
  const recordsByTemplate = new Map<string, PublishedRecord[]>();
  const curatedByTemplate = new Map<string, { snapshotId: string; importId: string }>();

  for (const templateCode of SAMPLE_TEMPLATE_CODES) {
    const template = FILE_BUSINESS_TEMPLATES.find((item) => item.code === templateCode);
    if (!template) throw new SamplePublishError("sample_template_missing", 500);
    const file = buildSampleDataCsv(templateCode);
    const rows = buildSampleDataRows(templateCode);
    const importId = `import-sample-${hospitalId}-${templateCode}`;
    const bytes = new TextEncoder().encode(file.csv);

    const original = await storeImmutableObject({
      hospitalId,
      category: "original",
      resourceId: importId,
      extension: "csv",
      contentType: "text/csv",
      body: bytes,
      customMetadata: { importId, sample: SAMPLE_DATA_PACKAGE_VERSION },
    }, runtime);

    await db.insert(dataImportJobs).values({
      id: importId,
      hospitalId,
      dataDomain: template.dataDomain,
      ingestionMode: "file",
      fileName: file.fileName,
      objectKey: original.objectKey,
      sha256: original.sha256,
      status: "pending_mapping",
      rowCount: rows.length,
      businessTemplateCode: templateCode,
      parserConfigJson: JSON.stringify({ source: "sample-data-package", version: SAMPLE_DATA_PACKAGE_VERSION }),
      idempotencyKey: `sample-${templateCode}-${SAMPLE_DATA_PACKAGE_VERSION}`,
      createdByAccountId: accountId,
    });

    const raw = await createDatasetSnapshot({
      hospitalId,
      accountId,
      importJobId: importId,
      layer: "raw",
      version: 1,
      templateCode,
      dataDomain: template.dataDomain,
      headers: Object.keys(rows[0] ?? {}),
      profile: { templateCode, dataDomain: template.dataDomain, requiredFields: template.requiredFields, sample: SAMPLE_DATA_PACKAGE_VERSION },
      records: rows.map((record, index) => ({ sourceRowNumber: index + 2, sourceRecordId: `${importId}:${index + 2}`, record })),
    }, runtime);
    await db.insert(rawDatasets).values({
      id: `dataset-${importId}`,
      hospitalId,
      importJobId: importId,
      objectKey: raw.objectKey,
      contentType: "application/x-ndjson",
      sizeBytes: raw.sizeBytes,
      sha256: raw.sha256,
      rowCount: raw.rowCount,
      schemaJson: JSON.stringify({ headers: Object.keys(rows[0] ?? {}) }),
      profileJson: JSON.stringify({ sample: SAMPLE_DATA_PACKAGE_VERSION }),
      createdByAccountId: accountId,
    });
    await db.insert(dataLineageEvents).values({
      hospitalId,
      actorAccountId: accountId,
      action: "file_imported",
      resourceType: "snapshot",
      resourceId: raw.id,
      toStatus: "raw",
      importJobId: importId,
      datasetVersion: raw.id,
      detailJson: JSON.stringify({ sample: SAMPLE_DATA_PACKAGE_VERSION }),
    });

    const rawRows = await snapshotRecords(hospitalId, raw.id, ["valid"], runtime);
    const normalized = rawRows.map((row) => normalizeRecord(templateCode, row.record as Record<string, string>));
    const curated = await createDatasetSnapshot({
      hospitalId,
      accountId,
      importJobId: importId,
      layer: "curated",
      version: 1,
      parentSnapshotId: raw.id,
      mappingVersion: SAMPLE_MAPPING_VERSION,
      ruleVersion: SAMPLE_RULE_VERSION,
      templateCode,
      dataDomain: template.dataDomain,
      headers: Object.keys(normalized[0] ?? {}),
      profile: { templateCode, dataDomain: template.dataDomain, requiredFields: template.requiredFields, sample: SAMPLE_DATA_PACKAGE_VERSION, moneyUnit: "万元" },
      records: normalized.map((record, index) => ({ sourceRowNumber: rawRows[index].sourceRowNumber, sourceRecordId: rawRows[index].sourceRecordId, record })),
    }, runtime);

    await db.update(dataImportJobs).set({ status: "pending_review", acceptedCount: rows.length, rejectedCount: 0, revision: 2 }).where(eq(dataImportJobs.id, importId));
    await db.insert(dataReviewEvents).values({
      hospitalId,
      resourceType: "import",
      resourceId: importId,
      decision: "break_glass",
      actorAccountId: accountId,
      comment: "示范数据包自动复核（标识为示范口径）",
      breakGlassReason: SAMPLE_BREAK_GLASS_REASON,
    });
    await db.update(dataImportJobs).set({ status: "ready", reviewedByAccountId: accountId, revision: 3 }).where(eq(dataImportJobs.id, importId));
    await db.insert(dataLineageEvents).values({
      hospitalId,
      actorAccountId: accountId,
      action: "cleaning_completed_and_reviewed",
      resourceType: "snapshot",
      resourceId: curated.id,
      fromStatus: "raw",
      toStatus: "curated",
      importJobId: importId,
      datasetVersion: curated.id,
      mappingVersion: SAMPLE_MAPPING_VERSION,
      ruleVersion: SAMPLE_RULE_VERSION,
    });

    files.push({ templateCode, fileName: file.fileName, rowCount: rows.length, importId });
    sourceImportIds.push(importId);
    sourceSnapshotIds.push(curated.id);
    sourceDescriptors.push({ snapshotId: curated.id, importId, templateCode, rowCount: rows.length });
    curatedByTemplate.set(templateCode, { snapshotId: curated.id, importId });
    recordsByTemplate.set(templateCode, normalized);
  }

  const { derivedFields } = enrichDeviceRecords(recordsByTemplate);

  const publishId = `publish-sample-${hospitalId}-${SAMPLE_DATA_PACKAGE_VERSION.replaceAll(".", "-")}`;
  const publishedRecords: Array<{ sourceRowNumber: number; sourceRecordId: string; record: PublishedRecord }> = [];
  let rowNumber = 0;
  for (const templateCode of SAMPLE_TEMPLATE_CODES) {
    const records = recordsByTemplate.get(templateCode) ?? [];
    const source = curatedByTemplate.get(templateCode);
    records.forEach((record, index) => {
      rowNumber += 1;
      publishedRecords.push({
        sourceRowNumber: rowNumber,
        sourceRecordId: `${source?.importId ?? templateCode}:${index + 2}`,
        record,
      });
    });
  }

  const published = await createDatasetSnapshot({
    hospitalId,
    accountId,
    layer: "published",
    version: 1,
    mappingVersion: SAMPLE_MAPPING_VERSION,
    ruleVersion: SAMPLE_RULE_VERSION,
    templateCode: "composite",
    dataDomain: "composite",
    headers: [...new Set(publishedRecords.flatMap((row) => Object.keys(row.record)))],
    profile: {
      seriesId: SAMPLE_SERIES_ID,
      publishId,
      schema: "canonical-dotted-fields-v1",
      sourceSnapshotIds,
      sourceImportIds,
      sample: SAMPLE_DATA_PACKAGE_VERSION,
    },
    records: publishedRecords,
  }, runtime);

  const metricId = `metric-sample-revenue-${hospitalId}`;
  const visualizationId = `visual-sample-revenue-${hospitalId}`;
  // 重放场景下这两条定义可能已存在：先删后插，保证与本次发布清单一致。
  await db.delete(dataVisualizationDefinitions).where(and(
    eq(dataVisualizationDefinitions.hospitalId, hospitalId),
    eq(dataVisualizationDefinitions.id, visualizationId),
  ));
  await db.delete(dataMetricDefinitions).where(and(
    eq(dataMetricDefinitions.hospitalId, hospitalId),
    eq(dataMetricDefinitions.id, metricId),
  ));
  await db.insert(dataMetricDefinitions).values({
    id: metricId,
    hospitalId,
    code: "sample_device_revenue",
    name: "示范设备收费净额",
    formula: "SUM(revenue)",
    aggregation: "sum",
    dimensionsJson: JSON.stringify(["department"]),
    sourceFieldRefsJson: JSON.stringify(["revenue"]),
    unit: "万元",
    status: "active",
    version: 1,
    createdByAccountId: accountId,
    updatedByAccountId: accountId,
  });
  await db.insert(dataVisualizationDefinitions).values({
    id: visualizationId,
    hospitalId,
    code: "sample_device_revenue_bar",
    name: "科室收费净额（示范）",
    metricId,
    chartType: "bar",
    dimension: "department",
    sortJson: JSON.stringify({ direction: "desc" }),
    status: "active",
    version: 1,
    createdByAccountId: accountId,
    updatedByAccountId: accountId,
  });

  const manifest = {
    source: { snapshots: sourceDescriptors.map((descriptor) => ({ snapshotId: descriptor.snapshotId })), sourceDescriptors },
    definitions: {
      metrics: [{ id: metricId, code: "sample_device_revenue", version: 1 }],
      visualizations: [{ id: visualizationId, code: "sample_device_revenue_bar", version: 1, metricId }],
      metricDefinitionIds: [metricId],
      visualizationDefinitionIds: [visualizationId],
    },
    transform: { allocationRule: "equal_by_body_part" },
    governance: {
      selfReview: true,
      breakGlass: true,
      breakGlassReason: SAMPLE_BREAK_GLASS_REASON,
      createdByAccountId: accountId,
      reviewedByAccountId: accountId,
      publishedByAccountId: accountId,
    },
    dataset: {
      snapshotId: published.id,
      sha256: published.sha256,
      rowCount: published.rowCount,
      objectKey: published.objectKey,
    },
    sample: {
      version: SAMPLE_DATA_PACKAGE_VERSION,
      moneyUnit: "万元",
      derivedFields,
      costAllocationBasis: "空间成本按可控直接成本 2%、间接成本按 3% 示范分摊，正式上线由财务口径替换",
      revenueBasis: "抽样收费均价（金额 − 退费金额）× 利用表全年检查人次；收费明细为逐月抽样事实，工作量与成本为全年全量",
      note: "示范数据包一键发布：数值为脱敏虚构数据，仅用于演示与验证链路。",
    },
  };

  await db.insert(dataPublishVersions).values({
    id: publishId,
    hospitalId,
    seriesId: SAMPLE_SERIES_ID,
    version: 1,
    dataDomain: "composite",
    status: "published",
    sourceImportIdsJson: JSON.stringify(sourceImportIds),
    manifestJson: JSON.stringify(manifest),
    rowCount: published.rowCount,
    mappingVersion: SAMPLE_MAPPING_VERSION,
    ruleVersion: SAMPLE_RULE_VERSION,
    curatedSnapshotId: sourceSnapshotIds[0],
    publishedSnapshotId: published.id,
    snapshotSha256: published.sha256,
    idempotencyKey: publishId,
    createdByAccountId: accountId,
    reviewedByAccountId: accountId,
    publishedByAccountId: accountId,
    reviewedAt: now,
    publishedAt: now,
  });
  for (const importId of sourceImportIds) {
    await db.update(dataImportJobs).set({ status: "published", revision: 4 }).where(eq(dataImportJobs.id, importId));
  }
  await db.insert(dataReviewEvents).values({
    hospitalId,
    resourceType: "publish",
    resourceId: publishId,
    decision: "break_glass",
    actorAccountId: accountId,
    comment: "示范数据包一键发布：创建人=复核人=发布人",
    breakGlassReason: SAMPLE_BREAK_GLASS_REASON,
  });
  await db.insert(dataLineageEvents).values({
    hospitalId,
    actorAccountId: accountId,
    action: "publish_break_glass",
    resourceType: "publish",
    resourceId: publishId,
    toStatus: "published",
    datasetVersion: `${SAMPLE_SERIES_ID}@1`,
    mappingVersion: SAMPLE_MAPPING_VERSION,
    ruleVersion: SAMPLE_RULE_VERSION,
    detailJson: JSON.stringify({ breakGlass: true, breakGlassReason: SAMPLE_BREAK_GLASS_REASON, sample: SAMPLE_DATA_PACKAGE_VERSION }),
  });
  await db.insert(dataLineageEvents).values({
    hospitalId,
    actorAccountId: accountId,
    action: "sample_dataset_published",
    resourceType: "publish",
    resourceId: publishId,
    toStatus: "published",
    datasetVersion: `${SAMPLE_SERIES_ID}@1`,
    mappingVersion: SAMPLE_MAPPING_VERSION,
    ruleVersion: SAMPLE_RULE_VERSION,
    detailJson: JSON.stringify({ sample: SAMPLE_DATA_PACKAGE_VERSION, breakGlass: true, files }),
  });

  return {
    seriesId: SAMPLE_SERIES_ID,
    publishId,
    version: 1,
    files,
    publishedRowCount: published.rowCount,
    sampleVersion: SAMPLE_DATA_PACKAGE_VERSION,
  };
}
