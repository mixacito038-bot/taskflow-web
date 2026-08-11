export type PublishedDataStatus = "published" | "demo" | "unavailable";
export type ExamAllocationRule = "equal_by_body_part" | "weighted_by_body_part" | "primary_body_part";

export type FormalDefinitionReference = {
  metricDefinitionVersion: string;
  visualizationVersion: string;
  allocationRule: ExamAllocationRule;
};

export type PublicationEvidence = FormalDefinitionReference & {
  deviceId: string;
  publishedAt: string;
  revision: string;
  sourceRecordIds: readonly string[];
};

export type PublicationResolution = {
  deviceId: string;
  status: PublishedDataStatus;
  usableForFormalConclusion: boolean;
  evidence: PublicationEvidence | null;
  blockingReason: "definition_version_mismatch" | null;
};

export type PublishedValue<T> = {
  status: PublishedDataStatus;
  value: T | null;
  usableForFormalConclusion: boolean;
};

export type PublishedDataView = {
  resolve: (
    deviceId: string,
    hasDemoData: boolean,
    expectedDefinitions?: FormalDefinitionReference,
  ) => PublicationResolution;
  value: <T>(resolution: PublicationResolution, value: T) => PublishedValue<T>;
  records: Readonly<Record<string, PublicationEvidence>>;
};

function validEvidence(record: PublicationEvidence) {
  return Boolean(
    record.deviceId.trim()
    && record.publishedAt.trim()
    && record.revision.trim()
    && record.metricDefinitionVersion.trim()
    && record.visualizationVersion.trim()
    && record.allocationRule
    && record.sourceRecordIds.length
    && record.sourceRecordIds.every((sourceId) => sourceId.trim()),
  );
}

export function createPublishedDataView(
  evidenceRecords: PublicationEvidence[] = [],
): PublishedDataView {
  const records = Object.freeze(Object.fromEntries(
    evidenceRecords
      .filter(validEvidence)
      .map((record) => [record.deviceId, Object.freeze({
        ...record,
        sourceRecordIds: Object.freeze([...record.sourceRecordIds]),
      })]),
  )) as Readonly<Record<string, PublicationEvidence>>;

  const resolve = (
    deviceId: string,
    hasDemoData: boolean,
    expectedDefinitions?: FormalDefinitionReference,
  ): PublicationResolution => {
    const evidence = records[deviceId] ?? null;
    if (evidence) {
      const versionMatches = !expectedDefinitions || (
        evidence.metricDefinitionVersion === expectedDefinitions.metricDefinitionVersion
        && evidence.visualizationVersion === expectedDefinitions.visualizationVersion
        && evidence.allocationRule === expectedDefinitions.allocationRule
      );
      return {
        deviceId,
        status: "published",
        usableForFormalConclusion: versionMatches,
        evidence,
        blockingReason: versionMatches ? null : "definition_version_mismatch",
      };
    }
    if (hasDemoData) {
      return { deviceId, status: "demo", usableForFormalConclusion: false, evidence: null, blockingReason: null };
    }
    return { deviceId, status: "unavailable", usableForFormalConclusion: false, evidence: null, blockingReason: null };
  };

  return {
    records,
    resolve,
    value<T>(resolution: PublicationResolution, value: T): PublishedValue<T> {
      return {
        status: resolution.status,
        value: resolution.status === "unavailable" ? null : value,
        usableForFormalConclusion: resolution.usableForFormalConclusion,
      };
    },
  };
}

export const emptyPublishedDataView = createPublishedDataView();

export type ExamBodyPartSourceRow = {
  examId: string;
  bodyPart: string;
  examRevenue: number;
  examCost: number;
  allocationWeight?: number;
  isPrimary?: boolean;
};

export type AllocatedExamBodyPart = {
  examId: string;
  bodyPart: string;
  allocationRule: ExamAllocationRule;
  allocationRatio: number;
  allocatedRevenue: number;
  allocatedCost: number;
};

function examBodyPartKey(examId: string, bodyPart: string) {
  return `${examId.trim()}\u0000${bodyPart.trim()}`;
}

export function distinctExamCount(rows: ExamBodyPartSourceRow[]) {
  return new Set(rows.map((row) => row.examId.trim()).filter(Boolean)).size;
}

export function distinctExamBodyPartCount(rows: ExamBodyPartSourceRow[]) {
  return new Set(rows
    .filter((row) => row.examId.trim() && row.bodyPart.trim())
    .map((row) => examBodyPartKey(row.examId, row.bodyPart))).size;
}

export function allocateExamBodyParts(
  rows: ExamBodyPartSourceRow[],
  allocationRule: ExamAllocationRule,
): AllocatedExamBodyPart[] {
  const exams = new Map<string, Map<string, ExamBodyPartSourceRow>>();
  rows.forEach((row) => {
    const examId = row.examId.trim();
    const bodyPart = row.bodyPart.trim();
    if (!examId || !bodyPart) throw new Error("examId and bodyPart are required");
    if (![row.examRevenue, row.examCost].every(Number.isFinite)) throw new Error(`invalid exam amount: ${examId}`);
    const parts = exams.get(examId) ?? new Map<string, ExamBodyPartSourceRow>();
    const existing = parts.get(bodyPart);
    if (existing && (
      existing.examRevenue !== row.examRevenue
      || existing.examCost !== row.examCost
      || existing.allocationWeight !== row.allocationWeight
      || Boolean(existing.isPrimary) !== Boolean(row.isPrimary)
    )) {
      throw new Error(`conflicting exam bodyPart fact: ${examId}/${bodyPart}`);
    }
    parts.set(bodyPart, existing ?? { ...row, examId, bodyPart });
    exams.set(examId, parts);
  });

  return [...exams.entries()].flatMap(([examId, partMap]) => {
    const parts = [...partMap.values()];
    const [{ examRevenue, examCost }] = parts;
    if (parts.some((part) => part.examRevenue !== examRevenue || part.examCost !== examCost)) {
      throw new Error(`conflicting exam amount: ${examId}`);
    }

    let weights: number[];
    if (allocationRule === "equal_by_body_part") {
      weights = parts.map(() => 1);
    } else if (allocationRule === "weighted_by_body_part") {
      weights = parts.map((part) => part.allocationWeight ?? Number.NaN);
      if (weights.some((weight) => !Number.isFinite(weight) || weight <= 0)) {
        throw new Error(`positive allocationWeight required: ${examId}`);
      }
    } else {
      const primaryIndexes = parts.flatMap((part, index) => part.isPrimary ? [index] : []);
      if (primaryIndexes.length !== 1) throw new Error(`exactly one primary bodyPart required: ${examId}`);
      weights = parts.map((_, index) => index === primaryIndexes[0] ? 1 : 0);
    }

    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
    return parts.map((part, index) => {
      const allocationRatio = weights[index] / weightTotal;
      return {
        examId,
        bodyPart: part.bodyPart,
        allocationRule,
        allocationRatio,
        allocatedRevenue: examRevenue * allocationRatio,
        allocatedCost: examCost * allocationRatio,
      };
    });
  });
}

export type PublishedSourceLineage = {
  importJobId: string;
  rawSnapshotId: string;
  sourceRowNumber: number;
  sourceRecordId: string;
};

export type PublishedDatasetRow = Record<string, unknown> & {
  recordType?: "device" | "exam" | "metric" | "billing" | "revenue" | "cost_detail" | "cost" | "utilization" | "maintenance" | "quality" | "target" | string;
  deviceId?: string;
  examId?: string;
  bodyPart?: string;
  device?: unknown;
  insight?: unknown;
  metricValues?: Record<string, number>;
  _lineage: PublishedSourceLineage;
};

export type PublishedDatasetPublication = {
  id: string;
  hospitalId: string;
  seriesId: string;
  version: number;
  status: "published" | "superseded";
  snapshotId: string;
  snapshotSha256: string;
  rowCount: number;
  mappingVersion: string;
  ruleVersion: string;
  metricDefinitionVersion: string;
  visualizationVersion: string;
  allocationRule: ExamAllocationRule;
  publishedAt: string;
  correctionOfId: string | null;
  rollbackOfId: string | null;
};

export type PublishedMetricDefinition = {
  id: string;
  code: string;
  name: string;
  formula: string;
  aggregation: "sum" | "avg" | "min" | "max" | "count" | "distinct_count" | "ratio" | "custom";
  numerator: string;
  denominator: string;
  dimensions: string[];
  sourceFieldRefs: string[];
  unit: string;
  version: number;
};

export type PublishedChartType = "kpi" | "table" | "bar" | "line" | "pie" | "scatter" | "heatmap";

export type PublishedVisualizationDefinition = {
  id: string;
  code: string;
  name: string;
  metricDefinitionId: string;
  metricCode: string;
  chartType: PublishedChartType;
  dimension: string;
  series: string;
  sort: "asc" | "desc" | "none";
  limit: number;
  version: number;
};

export type PublishedDatasetPayload = {
  mode: "formal" | "demo";
  publication: PublishedDatasetPublication | null;
  rows: PublishedDatasetRow[];
  metricDefinitions: PublishedMetricDefinition[];
  visualizationDefinitions: PublishedVisualizationDefinition[];
};

export type PublishedAnalyticsPoint = {
  label: string;
  value: number;
  secondary?: number;
  group?: string;
};

export type PublishedMetricTrace = {
  metricCode: string;
  metricDefinitionId: string;
  metricDefinitionVersion: number;
  publicationId: string;
  publishSeriesId: string;
  publishVersion: number;
  snapshotId: string;
  snapshotSha256: string;
  mappingVersion: string;
  ruleVersion: string;
  sourceRows: PublishedSourceLineage[];
};

export type PublishedExamAudit = {
  distinctExamCount: number;
  distinctExamBodyPartCount: number;
  sourceRevenue: number;
  allocatedRevenue: number;
  sourceCost: number;
  allocatedCost: number;
  balanced: boolean;
};

export type PublishedFinancialMonth = {
  period: string;
  month: string;
  revenue: number;
  cost: number;
  costByType: Partial<Record<keyof Device["cost"], number>>;
};

export type PublishedFinancialMonths = {
  months: PublishedFinancialMonth[];
  completeTimeGrain: boolean;
  missingTimeFactCount: number;
};

export type PublishedDatasetView = {
  status: PublishedDataStatus;
  publication: PublishedDatasetPublication | null;
  rows: readonly PublishedDatasetRow[];
  devices: readonly Device[];
  insights: Readonly<Record<string, DeviceInsight>>;
  metricDefinitions: readonly PublishedMetricDefinition[];
  visualizationDefinitions: readonly PublishedVisualizationDefinition[];
  analytics: Readonly<Record<string, readonly PublishedAnalyticsPoint[]>>;
  analyticsErrors: Readonly<Record<string, string>>;
  traces: Readonly<Record<string, PublishedMetricTrace>>;
  examAudit: PublishedExamAudit | null;
  evidenceView: PublishedDataView;
};

function plainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validLineage(value: unknown): value is PublishedSourceLineage {
  return plainRecord(value)
    && typeof value.importJobId === "string" && Boolean(value.importJobId.trim())
    && typeof value.rawSnapshotId === "string" && Boolean(value.rawSnapshotId.trim())
    && Number.isSafeInteger(value.sourceRowNumber) && Number(value.sourceRowNumber) > 0
    && typeof value.sourceRecordId === "string" && Boolean(value.sourceRecordId.trim());
}

function validDevice(value: unknown): value is Device {
  if (!plainRecord(value) || !plainRecord(value.cost)) return false;
  const cost = value.cost;
  const textFields = ["id", "assetCode", "name", "shortName", "model", "department", "enabledDate", "serviceUnit", "status"];
  const numericFields = ["investment", "quantity", "serviceVolume", "revenue", "utilization", "planPayback", "forecastPayback"];
  const costFields = ["labor", "consumables", "depreciation", "maintenance", "energy", "space", "indirect"];
  return textFields.every((field) => typeof value[field] === "string" && Boolean(String(value[field]).trim()))
    && numericFields.every((field) => typeof value[field] === "number" && Number.isFinite(value[field]))
    && costFields.every((field) => typeof cost[field] === "number" && Number.isFinite(cost[field]));
}

function firstText(records: readonly PublishedDatasetRow[], fields: string[]) {
  for (const record of records) {
    for (const field of fields) {
      const value = record[field];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

function firstNumber(records: readonly PublishedDatasetRow[], fields: string[]) {
  for (const record of records) {
    for (const field of fields) {
      const value = record[field];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return null;
}

function metricNumber(records: readonly PublishedDatasetRow[], codes: string[]) {
  for (const record of records) {
    if (record.recordType !== "metric" || typeof record.metricCode !== "string" || !codes.includes(record.metricCode)) continue;
    if (typeof record.value === "number" && Number.isFinite(record.value)) return record.value;
  }
  return null;
}

function canonicalNumber(records: readonly PublishedDatasetRow[], fields: string[], metricCodes: string[] = []) {
  // Exam rows carry per-exam revenue/cost. They must never be mistaken for a
  // device-level total; derive those totals by DISTINCT examId below instead.
  return firstNumber(records.filter((record) => record.recordType !== "exam"), fields) ?? metricNumber(records, metricCodes);
}

function billingRevenue(records: readonly PublishedDatasetRow[]) {
  const billingRows = records.filter((record) => record.recordType === "billing" || record.recordType === "revenue");
  if (!billingRows.length) return null;
  const byFact = new Map<string, number>();
  for (const row of billingRows) {
    const amount = rowField(row, "amount");
    const refund = rowField(row, "refundAmount") ?? 0;
    if (amount === null) continue;
    const key = `source:${row._lineage.sourceRecordId}`;
    const value = amount - refund;
    const existing = byFact.get(key);
    if (existing !== undefined && existing !== value) return null;
    byFact.set(key, value);
  }
  return byFact.size ? [...byFact.values()].reduce((sum, value) => sum + value, 0) : null;
}

const costTypeAliases: Record<keyof Device["cost"], readonly string[]> = {
  labor: ["labor", "人工", "人工成本"],
  consumables: ["consumables", "耗材", "试剂", "耗材成本"],
  depreciation: ["depreciation", "折旧", "折旧成本"],
  maintenance: ["maintenance", "维修", "维保", "维修维保"],
  energy: ["energy", "能耗", "水电气"],
  space: ["space", "空间", "房屋"],
  indirect: ["indirect", "间接", "管理", "管理分摊"],
};

function normalizedCostType(value: unknown): keyof Device["cost"] | null {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (Object.keys(costTypeAliases) as Array<keyof Device["cost"]>)
    .find((key) => costTypeAliases[key].some((alias) => alias.toLowerCase() === candidate)) ?? null;
}

function costDetailTotals(records: readonly PublishedDatasetRow[]) {
  const totals = Object.fromEntries(Object.keys(costTypeAliases).map((key) => [key, null])) as Record<keyof Device["cost"], number | null>;
  for (const key of Object.keys(costTypeAliases) as Array<keyof Device["cost"]>) {
    const matching = records.filter((row) => {
      const costType = typeof row.costType === "string" ? row.costType.trim().toLowerCase() : "";
      return (row.recordType === "cost_detail" || row.recordType === "cost") && costTypeAliases[key].some((alias) => alias.toLowerCase() === costType);
    });
    const values = matching.map((row) => rowField(row, "amount") ?? rowField(row, "costAmount")).filter((value): value is number => value !== null);
    if (values.length) totals[key] = values.reduce((sum, value) => sum + value, 0);
  }
  return totals;
}

function monthPeriod(row: PublishedDatasetRow) {
  const value = [row.occurredAt, row.period, row.statDate].find((candidate) => typeof candidate === "string" && candidate.trim());
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/年(\d{1,2})月?/, (_, month: string) => `-${month.padStart(2, "0")}`);
  const match = normalized.match(/^(\d{4})-(\d{1,2})/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}`;
}

export function aggregatePublishedFinancialMonths(
  rows: readonly PublishedDatasetRow[],
  deviceIds: readonly string[],
): PublishedFinancialMonths {
  const selectedDevices = new Set(deviceIds);
  const deviceByExam = new Map<string, string | null>();
  rows.forEach((row) => {
    const examId = typeof row.examId === "string" ? row.examId.trim() : "";
    const deviceId = typeof row.deviceId === "string" ? row.deviceId.trim() : "";
    if (!examId || !deviceId) return;
    const existing = deviceByExam.get(examId);
    deviceByExam.set(examId, existing === undefined || existing === deviceId ? deviceId : null);
  });
  const scoped = rows.filter((row) => {
    const examId = typeof row.examId === "string" ? row.examId.trim() : "";
    if (examId && deviceByExam.get(examId) === null) return false;
    const deviceId = typeof row.deviceId === "string" && row.deviceId.trim() ? row.deviceId.trim() : examId ? deviceByExam.get(examId) : "";
    return typeof deviceId === "string" && selectedDevices.has(deviceId);
  });
  const billingFacts = scoped.filter((row) => row.recordType === "billing" || row.recordType === "revenue");
  const revenueFacts = billingFacts.length ? billingFacts : scoped.filter((row) => row.recordType === "exam");
  const explicitCostFacts = scoped.filter((row) => row.recordType === "cost_detail" || row.recordType === "cost");
  const costFacts = explicitCostFacts.length ? explicitCostFacts : scoped.filter((row) => row.recordType === "exam");
  const relevantFacts = [...revenueFacts, ...costFacts];
  const missingTimeFactCount = relevantFacts.filter((row) => !monthPeriod(row)).length;
  const months = new Map<string, PublishedFinancialMonth>();
  const revenueKeys = new Map<string, number>();
  const costKeys = new Map<string, number>();
  let conflictingDuplicate = false;
  const ensureMonth = (period: string) => months.get(period) ?? {
    period,
    month: `${Number(period.slice(5))}月`,
    revenue: 0,
    cost: 0,
    costByType: {},
  };
  revenueFacts.forEach((row) => {
    const period = monthPeriod(row);
    if (!period) return;
    const amount = row.recordType === "exam"
      ? rowField(row, "examRevenue") ?? rowField(row, "revenue")
      : rowField(row, "amount") !== null ? rowField(row, "amount")! - (rowField(row, "refundAmount") ?? 0) : rowField(row, "revenue");
    if (amount === null) return;
    const key = row.recordType === "exam" && typeof row.examId === "string"
      ? `${period}:exam:${row.examId.trim()}`
      : `${period}:source:${row._lineage.sourceRecordId}`;
    const existing = revenueKeys.get(key);
    if (existing !== undefined) {
      if (existing !== amount) conflictingDuplicate = true;
      return;
    }
    revenueKeys.set(key, amount);
    const month = ensureMonth(period);
    month.revenue += amount;
    months.set(period, month);
  });
  costFacts.forEach((row) => {
    const period = monthPeriod(row);
    if (!period) return;
    const amount = row.recordType === "exam"
      ? rowField(row, "examCost") ?? rowField(row, "cost")
      : rowField(row, "amount") ?? rowField(row, "costAmount");
    if (amount === null) return;
    const key = row.recordType === "exam" && typeof row.examId === "string"
      ? `${period}:exam:${row.examId.trim()}`
      : `${period}:source:${row._lineage.sourceRecordId}`;
    const existing = costKeys.get(key);
    if (existing !== undefined) {
      if (existing !== amount) conflictingDuplicate = true;
      return;
    }
    costKeys.set(key, amount);
    const month = ensureMonth(period);
    month.cost += amount;
    const costType = normalizedCostType(row.costType);
    if (costType) month.costByType[costType] = (month.costByType[costType] ?? 0) + amount;
    months.set(period, month);
  });
  return {
    months: [...months.values()].sort((left, right) => left.period.localeCompare(right.period)),
    completeTimeGrain: Boolean(relevantFacts.length) && missingTimeFactCount === 0 && !conflictingDuplicate,
    missingTimeFactCount,
  };
}

function flatDeviceFor(deviceId: string, records: readonly PublishedDatasetRow[]): Device | null {
  const masters = records.filter((row) => row.recordType === "device");
  if (!masters.length) return null;
  const name = firstText(masters, ["deviceName", "name"]);
  const assetCode = firstText(masters, ["assetCode"]);
  const model = firstText(masters, ["model"]);
  const department = firstText(masters, ["department"]);
  const enabledDate = firstText(masters, ["enabledDate"]);
  const serviceUnit = firstText(masters, ["serviceUnit"]);
  const status = firstText(masters, ["status"]);
  const investment = canonicalNumber(records, ["investment"], ["investment"]);
  const quantity = canonicalNumber(records, ["quantity"], ["quantity"]);
  const planPayback = canonicalNumber(records, ["planPayback"], ["plan_payback"]);
  const forecastPayback = canonicalNumber(records, ["forecastPayback"], ["forecast_payback"]);
  const revenue = canonicalNumber(records, ["revenue"], ["revenue", "hospital.device.net_direct_revenue"]);
  let utilization = canonicalNumber(records, ["utilization"], ["utilization", "hospital.device.time_utilization_rate"]);
  let serviceVolume = canonicalNumber(records, ["serviceVolume"], ["service_volume", "hospital.device.exam_count"]);
  let derivedRevenue = revenue ?? billingRevenue(records);
  const examFacts = records.filter((row) => row.recordType === "exam" && typeof row.examId === "string");
  if (serviceVolume === null && examFacts.length) serviceVolume = new Set(examFacts.map((row) => row.examId)).size;
  if (derivedRevenue === null && examFacts.length) {
    const byExam = new Map<string, number>();
    for (const exam of examFacts) {
      const value = typeof exam.revenue === "number" && Number.isFinite(exam.revenue) ? exam.revenue : null;
      if (value === null) continue;
      const existing = byExam.get(String(exam.examId));
      if (existing !== undefined && existing !== value) return null;
      byExam.set(String(exam.examId), value);
    }
    if (byExam.size) derivedRevenue = [...byExam.values()].reduce((sum, value) => sum + value, 0);
  }
  if (utilization === null) {
    const activeHours = canonicalNumber(records, ["activeHours"], ["active_hours"]);
    const scheduledHours = canonicalNumber(records, ["scheduledHours", "availableHours"], ["scheduled_hours", "available_hours"]);
    if (activeHours !== null && scheduledHours !== null && scheduledHours > 0) utilization = activeHours / scheduledHours * 100;
  }
  const costDetails = costDetailTotals(records);
  const cost = {
    labor: canonicalNumber(records, ["costLabor", "laborCost"], ["cost.labor"]) ?? costDetails.labor,
    consumables: canonicalNumber(records, ["costConsumables", "consumablesCost"], ["cost.consumables"]) ?? costDetails.consumables,
    depreciation: canonicalNumber(records, ["costDepreciation", "depreciationCost"], ["cost.depreciation"]) ?? costDetails.depreciation,
    maintenance: canonicalNumber(records, ["costMaintenance", "maintenanceCost"], ["cost.maintenance"]) ?? costDetails.maintenance,
    energy: canonicalNumber(records, ["costEnergy", "energyCost"], ["cost.energy"]) ?? costDetails.energy,
    space: canonicalNumber(records, ["costSpace", "spaceCost"], ["cost.space"]) ?? costDetails.space,
    indirect: canonicalNumber(records, ["costIndirect", "indirectCost"], ["cost.indirect"]) ?? costDetails.indirect,
  };
  if (
    !name || !assetCode || !model || !department || !enabledDate || !serviceUnit
    || !["运行良好", "需要关注", "效益预警"].includes(status ?? "")
    || [investment, quantity, serviceVolume, derivedRevenue, utilization, planPayback, forecastPayback, ...Object.values(cost)].some((value) => value === null)
  ) return null;
  return {
    id: deviceId,
    assetCode,
    name,
    shortName: firstText(masters, ["shortName"]) ?? name,
    model,
    category: firstText(masters, ["category"]) ?? undefined,
    manufacturer: firstText(masters, ["manufacturer"]) ?? undefined,
    serialNumber: firstText(masters, ["serialNumber"]) ?? undefined,
    department,
    location: firstText(masters, ["location"]) ?? undefined,
    enabledDate,
    fundingSource: firstText(masters, ["fundingSource"]) ?? undefined,
    usefulLifeYears: canonicalNumber(records, ["usefulLifeYears"], ["useful_life_years"]) ?? undefined,
    depreciationMethod: firstText(masters, ["depreciationMethod"]) ?? undefined,
    licenseNumber: firstText(masters, ["licenseNumber"]) ?? undefined,
    maintenanceStatus: firstText(masters, ["maintenanceStatus"]) ?? undefined,
    monitoringStatus: firstText(masters, ["monitoringStatus"]) ?? undefined,
    investment: investment!,
    quantity: quantity!,
    serviceVolume: serviceVolume!,
    serviceUnit,
    revenue: derivedRevenue!,
    utilization: utilization!,
    planPayback: planPayback!,
    forecastPayback: forecastPayback!,
    status: status as Device["status"],
    cost: Object.fromEntries(Object.entries(cost).map(([key, value]) => [key, value!])) as Device["cost"],
  };
}

function devicesFromRows(rows: readonly PublishedDatasetRow[]) {
  const byDevice = new Map<string, PublishedDatasetRow[]>();
  const deviceByExam = new Map<string, string | null>();
  rows.forEach((row) => {
    const examId = typeof row.examId === "string" ? row.examId.trim() : "";
    const deviceId = typeof row.deviceId === "string" ? row.deviceId.trim() : "";
    if (!examId || !deviceId) return;
    const existing = deviceByExam.get(examId);
    deviceByExam.set(examId, existing === undefined || existing === deviceId ? deviceId : null);
  });
  rows.forEach((row) => {
    const directDeviceId = typeof row.deviceId === "string" ? row.deviceId.trim() : "";
    const examId = typeof row.examId === "string" ? row.examId.trim() : "";
    if (examId && deviceByExam.get(examId) === null) return;
    const deviceId = directDeviceId || (examId ? deviceByExam.get(examId) ?? "" : "");
    if (deviceId) byDevice.set(deviceId, [...(byDevice.get(deviceId) ?? []), row]);
  });
  return [...byDevice.entries()].flatMap(([deviceId, records]) => {
    const nested = records.find((row) => validDevice(row.device));
    const normalized = nested && validDevice(nested.device) ? nested.device : flatDeviceFor(deviceId, records);
    return normalized ? [Object.freeze({ ...normalized, cost: { ...normalized.cost } })] : [];
  });
}

function validInsight(value: unknown): value is DeviceInsight {
  if (!plainRecord(value) || typeof value.deviceId !== "string" || !plainRecord(value.scores)) return false;
  const scores = value.scores;
  const scoreKeys = ["economic", "efficiency", "quality", "experience", "reliability"];
  const numericKeys = [
    "standardWorkload", "activeHours", "uptimeRate", "loadRate", "idleRate", "peakShare", "positiveRate",
    "enhancementRate", "reportQualityRate", "repeatRate", "appointmentWaitDays", "onSiteWaitMinutes", "reportHours",
    "totalJourneyHours", "satisfaction", "availabilityRate", "failuresPer1000Hours", "downtimeHours", "mttrHours",
    "pmCompletionRate", "pmPassRate", "peerRank", "peerCount",
  ];
  return scoreKeys.every((key) => typeof scores[key] === "number" && Number.isFinite(scores[key]))
    && numericKeys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]))
    && Array.isArray(value.monthly) && Array.isArray(value.patientSources) && Array.isArray(value.actions);
}

function flatInsightFor(deviceId: string, records: readonly PublishedDatasetRow[], status: PublishedDataStatus): DeviceInsight | null {
  const scoreKeys = ["economic", "efficiency", "quality", "experience", "reliability"] as const;
  const scores = Object.fromEntries(scoreKeys.map((key) => [key, canonicalNumber(records, [`${key}Score`, `score_${key}`], [`score.${key}`, `score_${key}`])])) as Record<typeof scoreKeys[number], number | null>;
  const numericKeys = [
    "standardWorkload", "activeHours", "uptimeRate", "loadRate", "idleRate", "peakShare", "positiveRate",
    "enhancementRate", "reportQualityRate", "repeatRate", "appointmentWaitDays", "onSiteWaitMinutes", "reportHours",
    "totalJourneyHours", "satisfaction", "availabilityRate", "failuresPer1000Hours", "downtimeHours", "mttrHours",
    "pmCompletionRate", "pmPassRate", "peerRank", "peerCount",
  ] as const;
  const values = Object.fromEntries(numericKeys.map((key) => [key, canonicalNumber(records, [key], [key])])) as Record<typeof numericKeys[number], number | null>;
  if ([...Object.values(scores), ...Object.values(values)].some((value) => value === null)) return null;
  return {
    deviceId,
    dataStatus: status,
    scores: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, value!])) as DeviceInsight["scores"],
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value!])),
    monthly: [],
    patientSources: [],
    actions: [],
  } as unknown as DeviceInsight;
}

function rowField(row: PublishedDatasetRow, field: string) {
  if (row.metricValues && typeof row.metricValues[field] === "number") return row.metricValues[field];
  if (row.recordType === "metric" && row.metricCode === field && typeof row.value === "number" && Number.isFinite(row.value)) return row.value;
  const value = row[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metricInputField(definition: PublishedMetricDefinition) {
  return definition.sourceFieldRefs.find((field) => /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(field)) ?? definition.code;
}

function examDistinctValues(rows: readonly PublishedDatasetRow[], field: string) {
  const byExam = new Map<string, number>();
  for (const row of rows) {
    if (row.recordType !== "exam" || typeof row.examId !== "string" || !row.examId.trim()) continue;
    const value = rowField(row, field);
    if (value === null) continue;
    const examId = row.examId.trim();
    const existing = byExam.get(examId);
    if (existing !== undefined && existing !== value) return { values: [] as number[], conflict: true };
    byExam.set(examId, value);
  }
  return { values: [...byExam.values()], conflict: false };
}

function aggregationValues(rows: readonly PublishedDatasetRow[], definition: PublishedMetricDefinition, field: string) {
  const explicitMetricValues = rows
    .filter((row) => row.recordType === "metric" && row.metricCode === definition.code)
    .map((row) => rowField(row, definition.code))
    .filter((value): value is number => value !== null);
  if (explicitMetricValues.length) return { values: explicitMetricValues, conflict: false };
  const deviceValues = rows
    .filter((row) => row.recordType === "device")
    .map((row) => rowField(row, field))
    .filter((value): value is number => value !== null);
  if (deviceValues.length) return { values: deviceValues, conflict: false };
  return examDistinctValues(rows, field);
}

function ratioFieldValues(rows: readonly PublishedDatasetRow[], field: string) {
  const nonExamValues = rows
    .filter((row) => row.recordType !== "exam")
    .map((row) => rowField(row, field))
    .filter((value): value is number => value !== null);
  return nonExamValues.length ? { values: nonExamValues, conflict: false } : examDistinctValues(rows, field);
}

function groupAnalyticsRows(
  rows: readonly PublishedDatasetRow[],
  definition: PublishedMetricDefinition,
  visualization: PublishedVisualizationDefinition,
): { points: PublishedAnalyticsPoint[]; error: string | null } {
  const dimension = visualization.dimension;
  const groups = new Map<string, PublishedDatasetRow[]>();
  rows.forEach((row) => {
    const labelValue = dimension ? row[dimension] : "全部";
    const label = labelValue === undefined || labelValue === null || labelValue === "" ? "未标注" : String(labelValue);
    groups.set(label, [...(groups.get(label) ?? []), row]);
  });
  const field = metricInputField(definition);
  let error: string | null = null;
  const rawPoints = [...groups.entries()].flatMap(([label, groupRows]) => {
    const aggregated = aggregationValues(groupRows, definition, field);
    const values = aggregated.values;
    let value: number | null = 0;
    if (aggregated.conflict) {
      error = "conflicting_exam_amount";
      value = null;
    }
    else if (definition.aggregation === "count") value = groupRows.length;
    else if (definition.aggregation === "distinct_count") {
      const distinctField = /examid/i.test(definition.formula) ? "examId" : field;
      value = new Set(groupRows.map((row) => row[distinctField]).filter((item) => item !== undefined && item !== null && item !== "")).size;
    } else if (["sum", "avg", "min", "max"].includes(definition.aggregation) && !values.length) {
      error = "metric_inputs_unavailable";
      value = null;
    } else if (values.length && definition.aggregation === "avg") value = values.reduce((sum, item) => sum + item, 0) / values.length;
    else if (values.length && definition.aggregation === "min") value = Math.min(...values);
    else if (values.length && definition.aggregation === "max") value = Math.max(...values);
    else if (definition.aggregation === "ratio") {
      const numeratorField = /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(definition.numerator) ? definition.numerator : "";
      const denominatorField = /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(definition.denominator) ? definition.denominator : "";
      const numeratorValues = numeratorField ? ratioFieldValues(groupRows, numeratorField) : { values: [], conflict: true };
      const denominatorValues = denominatorField ? ratioFieldValues(groupRows, denominatorField) : { values: [], conflict: true };
      const numerator = numeratorValues.values.reduce((sum, item) => sum + item, 0);
      const denominator = denominatorValues.values.reduce((sum, item) => sum + item, 0);
      if (numeratorValues.conflict || denominatorValues.conflict || !numeratorValues.values.length || !denominatorValues.values.length || denominator === 0) {
        error = "ratio_inputs_unavailable";
        value = null;
      } else {
        value = numerator / denominator;
      }
    } else if (definition.aggregation === "custom") {
      const publishedValues = groupRows
        .filter((row) => row.recordType === "metric" && row.metricCode === definition.code)
        .map((row) => rowField(row, definition.code))
        .filter((item): item is number => item !== null);
      if (publishedValues.length !== 1) {
        error = "custom_metric_requires_single_published_value";
        value = null;
      } else {
        value = publishedValues[0];
      }
    } else value = values.reduce((sum, item) => sum + item, 0);
    if (value === null) return [];
    const secondary = visualization.series
      ? groupRows.map((row) => rowField(row, visualization.series)).filter((item): item is number => item !== null).reduce((sum, item) => sum + item, 0)
      : undefined;
    return { label, value, ...(secondary === undefined ? {} : { secondary }) };
  });
  const sorted = visualization.sort === "none"
    ? rawPoints
    : [...rawPoints].sort((left, right) => visualization.sort === "asc" ? left.value - right.value : right.value - left.value);
  return { points: sorted.slice(0, Math.max(1, visualization.limit)), error };
}

function examAudit(rows: readonly PublishedDatasetRow[], allocationRule: ExamAllocationRule): PublishedExamAudit | null {
  const examRows = rows.flatMap((row) => {
    if (typeof row.examId !== "string" || typeof row.bodyPart !== "string") return [];
    const examRevenue = rowField(row, "examRevenue") ?? rowField(row, "revenue");
    const examCost = rowField(row, "examCost") ?? rowField(row, "cost");
    if (examRevenue === null || examCost === null) return [];
    return [{
      examId: row.examId,
      bodyPart: row.bodyPart,
      examRevenue,
      examCost,
      allocationWeight: rowField(row, "allocationWeight") ?? undefined,
      isPrimary: row.isPrimary === true,
    }];
  });
  if (!examRows.length) return null;
  const allocated = allocateExamBodyParts(examRows, allocationRule);
  const uniqueExams = new Map<string, { revenue: number; cost: number }>();
  examRows.forEach((row) => uniqueExams.set(row.examId.trim(), { revenue: row.examRevenue, cost: row.examCost }));
  const sourceRevenue = [...uniqueExams.values()].reduce((sum, item) => sum + item.revenue, 0);
  const sourceCost = [...uniqueExams.values()].reduce((sum, item) => sum + item.cost, 0);
  const allocatedRevenue = allocated.reduce((sum, item) => sum + item.allocatedRevenue, 0);
  const allocatedCost = allocated.reduce((sum, item) => sum + item.allocatedCost, 0);
  return {
    distinctExamCount: distinctExamCount(examRows),
    distinctExamBodyPartCount: distinctExamBodyPartCount(examRows),
    sourceRevenue,
    allocatedRevenue,
    sourceCost,
    allocatedCost,
    balanced: Math.abs(sourceRevenue - allocatedRevenue) < 0.000001 && Math.abs(sourceCost - allocatedCost) < 0.000001,
  };
}

export function createPublishedDatasetView(payload: PublishedDatasetPayload): PublishedDatasetView {
  const publication = payload.publication;
  const formal = payload.mode === "formal";
  const validRows = payload.rows.filter((row) => validLineage(row._lineage));
  const status: PublishedDataStatus = formal ? publication ? "published" : "unavailable" : "demo";
  const devices = devicesFromRows(validRows);
  const deviceMap = new Map(devices.map((device) => [device.id, device]));
  const insights = Object.freeze(Object.fromEntries([...deviceMap.keys()].flatMap((deviceId) => {
    const deviceRows = validRows.filter((row) => row.deviceId === deviceId || (validInsight(row.insight) && row.insight.deviceId === deviceId));
    const nested = deviceRows.find((row) => validInsight(row.insight));
    const normalized = nested && validInsight(nested.insight)
      ? { ...nested.insight, dataStatus: status }
      : flatInsightFor(deviceId, deviceRows, status);
    return normalized ? [[deviceId, Object.freeze(normalized)]] : [];
  }))) as Readonly<Record<string, DeviceInsight>>;
  const evidenceRecords: PublicationEvidence[] = publication ? [...deviceMap.keys()].map((deviceId) => ({
    deviceId,
    publishedAt: publication.publishedAt,
    revision: `${publication.seriesId}@${publication.version}`,
    metricDefinitionVersion: publication.metricDefinitionVersion,
    visualizationVersion: publication.visualizationVersion,
    allocationRule: publication.allocationRule,
    sourceRecordIds: validRows.filter((row) => row.deviceId === deviceId || (validDevice(row.device) && row.device.id === deviceId)).map((row) => row._lineage.sourceRecordId),
  })).filter((record) => record.sourceRecordIds.length) : [];
  const analytics: Record<string, readonly PublishedAnalyticsPoint[]> = {};
  const analyticsErrors: Record<string, string> = {};
  const traces: Record<string, PublishedMetricTrace> = {};
  if (publication) {
    payload.visualizationDefinitions.forEach((visualization) => {
      const metric = payload.metricDefinitions.find((definition) => definition.id === visualization.metricDefinitionId || definition.code === visualization.metricCode);
      if (!metric) return;
      const result = groupAnalyticsRows(validRows, metric, visualization);
      analytics[visualization.id] = Object.freeze(result.points);
      if (result.error) analyticsErrors[visualization.id] = result.error;
      traces[visualization.id] = Object.freeze({
        metricCode: metric.code,
        metricDefinitionId: metric.id,
        metricDefinitionVersion: metric.version,
        publicationId: publication.id,
        publishSeriesId: publication.seriesId,
        publishVersion: publication.version,
        snapshotId: publication.snapshotId,
        snapshotSha256: publication.snapshotSha256,
        mappingVersion: publication.mappingVersion,
        ruleVersion: publication.ruleVersion,
        sourceRows: validRows.map((row) => row._lineage),
      });
    });
  }
  return {
    status,
    publication,
    rows: Object.freeze(validRows),
    devices: Object.freeze([...deviceMap.values()]),
    insights,
    metricDefinitions: Object.freeze([...payload.metricDefinitions]),
    visualizationDefinitions: Object.freeze([...payload.visualizationDefinitions]),
    analytics: Object.freeze(analytics),
    analyticsErrors: Object.freeze(analyticsErrors),
    traces: Object.freeze(traces),
    examAudit: publication ? examAudit(validRows, publication.allocationRule) : null,
    evidenceView: createPublishedDataView(evidenceRecords),
  };
}

export const emptyPublishedDatasetView = createPublishedDatasetView({
  mode: "formal",
  publication: null,
  rows: [],
  metricDefinitions: [],
  visualizationDefinitions: [],
});
import type { Device } from "./mock-data";
import type { DeviceInsight } from "./metric-definitions";
