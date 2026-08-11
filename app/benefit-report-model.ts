import { Hospital } from "./access-control-data";
import {
  initialBenefitAnalysisProfiles,
  type BenefitAnalysisProfile,
  type BenefitDeviceCategory,
} from "./benefit-analysis-config";
import { dataSources as defaultDataSources, DataSource, Device, totalCost } from "./mock-data";
import {
  dimensionMeta,
  hasInsightFor,
  insightFor,
  METRIC_DEFINITION_VERSION,
  VISUALIZATION_DEFINITION_VERSION,
  type DeviceInsight,
} from "./metric-definitions";
import {
  emptyPublishedDataView,
  type ExamAllocationRule,
  type PublishedDataView,
  type PublishedDatasetView,
  type PublishedDataStatus,
  type PublicationResolution,
  type PublishedValue,
} from "./published-data";
import { HOSPITAL_METRIC_CATALOG_VERSION } from "./hospital-metric-catalog";

export type ReportScope = "hospital" | "category" | "device";
export type ReportSectionId = "summary" | "scope" | "inventory" | "economic" | "efficiency" | "quality" | "social" | "lifecycle" | "evaluation" | "issues" | "conclusion" | "appendix";
export type ReportCostScope = "full" | "non_personnel";
export type ReportTemplateOrigin = "platform" | "hospital" | "imported";
export type ReportTemplateStatus = "draft" | "validated" | "published" | "retired";
export type ReportTemplateProfile = {
  code: string;
  name: string;
  category: string;
  categoryLabel: string;
  version: string;
  origin: ReportTemplateOrigin;
  status: ReportTemplateStatus;
  baseCode?: string;
  sourceDocument?: string;
  fieldPackIds: string[];
  sourceRequirementIds: string[];
  requiredSourceRequirementIds: string[];
  supportedScopes: ReportScope[];
  supportedPeriods: string[];
  applicableDeviceCategories: string[];
};
export type ReportCommonRules = {
  amountUnit: "万元";
  currency: "CNY";
  standardServiceHoursPerDay: number;
  dataCutoffDay: number;
  missingValuePolicy: "block" | "warn" | "manual_with_reason";
  manualDataOwner: string;
  manualDataReason: string;
  manualDataEvidence: string;
  metricDefinitionVersion: string;
  visualizationVersion: string;
  allocationRule: ExamAllocationRule;
  hospitalMetricTemplateVersion?: string;
};

export type BenefitReportConfig = {
  title: string;
  period: string;
  scope: ReportScope;
  deviceId: string;
  deviceCategory: string;
  preparedBy: string;
  compiler: string;
  reviewer: string;
  issueDate: string;
  minimumInvestment: number;
  goodUtilization: number;
  warningPaybackYears: number;
  costScope: ReportCostScope;
  template: ReportTemplateProfile;
  commonRules: ReportCommonRules;
  sections: ReportSectionId[];
};

export type ReportIssue = {
  device: string;
  type: string;
  evidence: string;
  cause: string;
  owner: string;
  due: string;
  priority: "高" | "中" | "低";
};

// New publication metadata stays optional on the compatibility type so older
// frozen report snapshots remain readable. Freshly built rows always populate it.
export type BenefitReportRow = {
  device: Device;
  insight: DeviceInsight;
  revenue: number;
  cost: number;
  net: number;
  payback: number | null;
  score: number;
  grade: string;
  hasInsight?: boolean;
  publication?: PublicationResolution;
  dataStatus?: PublishedDataStatus;
  publishedFacts?: {
    device: PublishedValue<Device>;
    insight: PublishedValue<DeviceInsight>;
  };
};

export const reportSections: Array<{ id: ReportSectionId; label: string; note: string }> = [
  { id: "summary", label: "报告摘要", note: "重点发现、问题与建议" },
  { id: "scope", label: "范围与数据来源", note: "纳入标准、发布文件与口径" },
  { id: "inventory", label: "设备基本情况", note: "主数据、配置证与运行档案" },
  { id: "economic", label: "经济效益", note: "收入、全成本、结余、ROI 与漏费" },
  { id: "efficiency", label: "使用效率", note: "开机、负荷、时长与峰谷" },
  { id: "quality", label: "质量安全与保障", note: "质控、故障、PM、MTTR 与 MTBF" },
  { id: "social", label: "社会效益", note: "可及性、临床能力、教学与应急" },
  { id: "lifecycle", label: "配置与全生命周期", note: "LCC、更新、处置和购置论证" },
  { id: "evaluation", label: "综合评价", note: "五维评分、评级和四象限" },
  { id: "issues", label: "问题清单", note: "原因、责任科室和整改时限" },
  { id: "conclusion", label: "结论与建议", note: "分类施策和管理机制" },
  { id: "appendix", label: "指标与口径附录", note: "公式、来源和评分规则" },
];

export const reportFieldDomains = [
  { domain: "设备主数据", fields: 18, covered: 14, source: "资产台账 / 设备档案", additions: "厂家、序列号、资金来源、配置证、地点、折旧年限" },
  { domain: "收入与漏费", fields: 14, covered: 9, source: "收入与业务量发布文件", additions: "带动收入、实际与收费工作量、差异原因、支付结构" },
  { domain: "全成本", fields: 10, covered: 10, source: "成本与耗材发布文件", additions: "维修与维保拆分、信息化与管理分摊" },
  { domain: "使用效率", fields: 13, covered: 11, source: "运行时长与业务事件文件", additions: "负荷饱和度、连续闲置、分类专项指标" },
  { domain: "质量与社会效益", fields: 12, covered: 8, source: "质控 / 预约 / 科研台账", additions: "新技术、外转减少、应急、科研教学" },
  { domain: "保障与生命周期", fields: 15, covered: 12, source: "工单、维修保养与资产文件", additions: "MTBF、计量质控、LCC、更新预算与处置意见" },
  { domain: "治理与整改", fields: 9, covered: 7, source: "平台配置 / 审计日志", additions: "编制审核、公式版本、整改状态和复评结果" },
];

function ratioForPeriod(period: string) {
  if (/年度|全年/.test(period)) return 1;
  if (/半年/.test(period)) return 0.5;
  if (/季度/.test(period)) return 0.25;
  if (/\d{4}年\d{1,2}月/.test(period) || /月度/.test(period)) return 1 / 12;
  return 0.5;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function analysisCategoryForDevice(device: Device): BenefitDeviceCategory | null {
  const value = `${device.category} ${device.name} ${device.shortName}`;
  if (/放射|放疗|核医学|磁共振|CT|加速器/i.test(value)) return "放射/放疗/核医学";
  if (/超声/i.test(value)) return "超声";
  if (/内镜|腔镜/i.test(value)) return "内镜";
  if (/手术|机器人/i.test(value)) return "手术室共享设备";
  if (/呼吸机|监护|生命支持|麻醉机/i.test(value)) return "生命支持";
  if (/检验|生化|免疫|流水线/i.test(value)) return "检验";
  return null;
}

export function gradeForScore(score: number) {
  if (score >= 85) return "优";
  if (score >= 70) return "良";
  if (score >= 60) return "一般";
  return "差";
}

export function createDefaultReportConfig(period = "2026年上半年"): BenefitReportConfig {
  return {
    title: "大型医疗设备效益分析报告",
    period,
    scope: "hospital",
    deviceId: "",
    deviceCategory: "",
    preparedBy: "医学装备管理部",
    compiler: "设备效益分析专员",
    reviewer: "财务部 / 运营管理部",
    issueDate: "2026-07-22",
    minimumInvestment: 100,
    goodUtilization: 70,
    warningPaybackYears: 8,
    costScope: "full",
    template: {
      code: "YH-COMPREHENSIVE-001",
      name: "医疗设备全维度综合效益分析",
      category: "comprehensive_benefit",
      categoryLabel: "综合效益评价",
      version: "2.0",
      origin: "platform",
      status: "published",
      sourceDocument: "医疗设备效益分析报告-全维度模板",
      fieldPackIds: ["basic_identity", "asset_configuration", "operational_efficiency", "revenue_cost", "investment_return", "monthly_trend", "quality_social", "lifecycle_assurance", "governance_audit"],
      sourceRequirementIds: ["asset_master", "his_billing", "finance_hrp", "device_runtime", "cmms_eam", "spd_material", "quality_clinical", "manual_supplement"],
      requiredSourceRequirementIds: ["asset_master", "his_billing", "finance_hrp", "cmms_eam", "quality_clinical"],
      supportedScopes: ["hospital", "category", "device"],
      supportedPeriods: ["季度", "半年度", "年度"],
      applicableDeviceCategories: [],
    },
    commonRules: {
      amountUnit: "万元",
      currency: "CNY",
      standardServiceHoursPerDay: 8,
      dataCutoffDay: 10,
      missingValuePolicy: "manual_with_reason",
      manualDataOwner: "医学装备管理部 / 信息中心",
      manualDataReason: "部分业务文件尚未准备，本期按责任部门复核后的台账受控补录",
      manualDataEvidence: "发布文件对账记录与人工补录附件",
      metricDefinitionVersion: METRIC_DEFINITION_VERSION,
      visualizationVersion: VISUALIZATION_DEFINITION_VERSION,
      allocationRule: "equal_by_body_part",
      hospitalMetricTemplateVersion: HOSPITAL_METRIC_CATALOG_VERSION,
    },
    sections: reportSections.map((section) => section.id),
  };
}

export function normalizeBenefitReportConfig(
  value: Partial<BenefitReportConfig> | null | undefined,
  period = "2026年上半年",
): BenefitReportConfig {
  const fallback = createDefaultReportConfig(value?.period || period);
  const scopes: ReportScope[] = ["hospital", "category", "device"];
  const sections = Array.isArray(value?.sections)
    ? value.sections.filter((section): section is ReportSectionId => reportSections.some((item) => item.id === section))
    : fallback.sections;
  return {
    ...fallback,
    ...value,
    scope: scopes.includes(value?.scope as ReportScope) ? value!.scope as ReportScope : fallback.scope,
    deviceId: value?.deviceId ?? "",
    deviceCategory: value?.deviceCategory ?? "",
    costScope: value?.costScope === "non_personnel" ? "non_personnel" : "full",
    template: { ...fallback.template, ...(value?.template ?? {}) },
    commonRules: { ...fallback.commonRules, ...(value?.commonRules ?? {}) },
    sections,
  };
}

export function buildBenefitReportModel(
  devices: Device[],
  hospital: Hospital,
  config: BenefitReportConfig,
  dataSources: DataSource[] = defaultDataSources,
  analysisProfiles: BenefitAnalysisProfile[] = initialBenefitAnalysisProfiles,
  publishedData: PublishedDataView | PublishedDatasetView = emptyPublishedDataView,
) {
  const publishedDataset = "evidenceView" in publishedData ? publishedData : null;
  const publishedEvidence: PublishedDataView = publishedDataset
    ? publishedDataset.evidenceView
    : publishedData as PublishedDataView;
  const normalizedConfig = normalizeBenefitReportConfig(config);
  const scoped = normalizedConfig.scope === "device"
    ? devices.filter((device) => device.id === normalizedConfig.deviceId)
    : normalizedConfig.scope === "category"
      ? devices.filter((device) => device.category === normalizedConfig.deviceCategory && device.investment >= normalizedConfig.minimumInvestment)
      : devices.filter((device) => device.investment >= normalizedConfig.minimumInvestment);
  const selectedDevices = scoped;
  const analysisCategories = [...new Set(
    selectedDevices
      .map(analysisCategoryForDevice)
      .filter((category): category is BenefitDeviceCategory => Boolean(category)),
  )];
  const relevantAnalysisProfiles = analysisCategories
    .map((category) => analysisProfiles.find((profile) => profile.category === category))
    .filter((profile): profile is BenefitAnalysisProfile => Boolean(profile))
    .map((profile) => ({
      ...profile,
      collectionMethods: [...profile.collectionMethods],
      sourceSystems: [...profile.sourceSystems],
      eventFields: [...profile.eventFields],
    }));
  const missingAnalysisCategories = analysisCategories.filter(
    (category) => !relevantAnalysisProfiles.some((profile) => profile.category === category),
  );
  const enabledAnalysisProfiles = relevantAnalysisProfiles.filter((profile) => profile.status === "已启用");
  const pendingAnalysisProfiles = relevantAnalysisProfiles.filter((profile) => profile.status !== "已启用");
  const legacyAnalysisProfileCoverage = {
    categories: analysisCategories,
    total: analysisCategories.length,
    matched: relevantAnalysisProfiles.length,
    enabled: enabledAnalysisProfiles.length,
    pending: pendingAnalysisProfiles.length,
    missing: missingAnalysisCategories,
    readyPercent: analysisCategories.length
      ? enabledAnalysisProfiles.length / analysisCategories.length * 100
      : 0,
  };
  const publishedDefinitionsReady = Boolean(
    publishedDataset?.publication
    && publishedDataset.rows.length
    && publishedDataset.metricDefinitions.length
    && publishedDataset.visualizationDefinitions.length
    && publishedDataset.rows.every((row) => row._lineage?.sourceRecordId),
  );
  const analysisProfileCoverage = publishedDataset ? {
    categories: analysisCategories,
    total: analysisCategories.length || 1,
    matched: publishedDefinitionsReady ? analysisCategories.length || 1 : 0,
    enabled: publishedDefinitionsReady ? analysisCategories.length || 1 : 0,
    pending: publishedDefinitionsReady ? 0 : analysisCategories.length || 1,
    missing: publishedDefinitionsReady ? [] : analysisCategories.length ? analysisCategories : ["已发布指标/展示定义"],
    readyPercent: publishedDefinitionsReady ? 100 : 0,
  } : legacyAnalysisProfileCoverage;

  const publishedTemplateFacts = new Set(publishedDataset?.rows.flatMap((row) => [row.templateCode, row.dataDomain])
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim().toLowerCase()) ?? []);
  const publishedRecordTypes = new Set(publishedDataset?.rows.map((row) => String(row.recordType ?? "").toLowerCase()) ?? []);
  const hasPublishedTemplate = (...codes: string[]) => codes.some((code) => publishedTemplateFacts.has(code));
  const hasPublishedType = (...types: string[]) => types.some((type) => publishedRecordTypes.has(type));
  const hasConsumableCost = publishedDataset?.rows.some((row) => (row.recordType === "cost_detail" || row.recordType === "cost")
    && typeof row.costType === "string"
    && /耗材|试剂|consumable/i.test(row.costType)) ?? false;
  const hasUtilizationFact = publishedDataset?.rows.some((row) => row.recordType === "utilization"
    || (row.recordType === "metric" && typeof row.metricCode === "string" && /utilization|active_hours|scheduled_hours/i.test(row.metricCode))) ?? false;
  const publishedFileStatus: Record<string, boolean> = {
    asset_master: hasPublishedTemplate("device_master") || hasPublishedType("device"),
    his_billing: hasPublishedTemplate("exam_activity", "billing_revenue") || hasPublishedType("exam", "revenue", "billing"),
    finance_hrp: hasPublishedTemplate("cost_detail", "target_budget") || hasPublishedType("cost", "cost_detail", "target"),
    device_runtime: hasPublishedTemplate("utilization") || hasUtilizationFact,
    cmms_eam: hasPublishedTemplate("maintenance") || hasPublishedType("maintenance"),
    quality_clinical: hasPublishedTemplate("quality_safety") || hasPublishedType("quality"),
    spd_material: hasConsumableCost,
    manual_supplement: hasPublishedTemplate("manual_supplement"),
  };
  const requiredPublishedFileIds = normalizedConfig.template.sourceRequirementIds;
  const publishedFileCoverage = {
    mode: publishedDataset ? "published" as const : "legacy" as const,
    statusByRequirement: publishedFileStatus,
    readyIds: publishedDataset ? requiredPublishedFileIds.filter((id) => publishedFileStatus[id]) : [],
    missingIds: publishedDataset ? requiredPublishedFileIds.filter((id) => !publishedFileStatus[id]) : [],
    total: requiredPublishedFileIds.length,
  };
  const ratio = ratioForPeriod(normalizedConfig.period);
  const costLabel = normalizedConfig.costScope === "non_personnel" ? "非人员成本" : "全成本";
  const rows = selectedDevices.map((device) => {
    const datasetInsight = publishedDataset?.insights[device.id];
    const hasInsight = publishedDataset ? Boolean(datasetInsight) : hasInsightFor(device.id);
    const baseInsight = datasetInsight ?? (publishedDataset ? insightFor(`published-missing:${device.id}`) : insightFor(device.id));
    const publication = publishedEvidence.resolve(device.id, !publishedDataset && hasInsight, {
      metricDefinitionVersion: normalizedConfig.commonRules.metricDefinitionVersion,
      visualizationVersion: normalizedConfig.commonRules.visualizationVersion,
      allocationRule: normalizedConfig.commonRules.allocationRule,
    });
    const insight = hasInsight && publication.status === "published"
      ? { ...baseInsight, dataStatus: "published" as const }
      : baseInsight;
    const revenue = device.revenue * ratio;
    const costBase = normalizedConfig.costScope === "non_personnel"
      ? totalCost(device) - device.cost.labor
      : totalCost(device);
    const cost = costBase * ratio;
    const net = revenue - cost;
    const annualizedNet = ratio ? net / ratio : net;
    const payback = annualizedNet > 0 ? device.investment / annualizedNet : null;
    const score = hasInsight ? average(Object.values(insight.scores)) : Number.NaN;
    return {
      device,
      insight,
      hasInsight,
      publication,
      dataStatus: publication.status,
      publishedFacts: {
        device: publishedEvidence.value(publication, device),
        insight: hasInsight
          ? publishedEvidence.value(publication, insight)
          : { status: "unavailable" as const, value: null, usableForFormalConclusion: false },
      },
      revenue,
      cost,
      net,
      payback,
      score,
      grade: hasInsight ? gradeForScore(score) : "数据缺失",
    };
  });
  const investment = rows.reduce((sum, row) => sum + row.device.investment, 0);
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  const net = revenue - cost;
  const serviceVolume = rows.reduce((sum, row) => sum + Math.round(row.device.serviceVolume * ratio), 0);
  const avgUtilization = average(rows.map((row) => row.device.utilization));
  const rowsWithInsight = rows.filter((row) => row.hasInsight);
  const avgAvailability = average(rowsWithInsight.map((row) => row.insight.availabilityRate));
  const avgPm = average(rowsWithInsight.map((row) => row.insight.pmCompletionRate));
  const economic = average(rowsWithInsight.map((row) => row.insight.scores.economic));
  const efficiency = average(rowsWithInsight.map((row) => row.insight.scores.efficiency));
  const social = average(rowsWithInsight.map((row) => average([row.insight.scores.quality, row.insight.scores.experience])));
  const quality = average(rowsWithInsight.map((row) => average([row.insight.scores.quality, row.insight.scores.reliability])));
  const configuration = average(rowsWithInsight.map((row) => average([row.insight.scores.efficiency, row.insight.scores.reliability])));
  const scoreRows = [
    { label: "经济效益", weight: 35, score: economic },
    { label: "使用效率", weight: 25, score: efficiency },
    { label: "社会效益", weight: 20, score: social },
    { label: "质量安全", weight: 10, score: quality },
    { label: "配置合理性", weight: 10, score: configuration },
  ].map((item) => ({ ...item, weighted: item.score * item.weight / 100 }));
  const overallScore = scoreRows.reduce((sum, item) => sum + item.weighted, 0);
  const issues: ReportIssue[] = [];
  rows.forEach((row) => {
    if (!row.publication.usableForFormalConclusion) return;
    if (row.net < 0) issues.push({ device: row.device.shortName, type: "结余为负", evidence: `${normalizedConfig.period}收入低于${costLabel}，结余 ${row.net.toFixed(1)} 万元`, cause: "业务量、定价与成本结构需联合复核", owner: row.device.department, due: "2026-09-30", priority: "高" });
    if (row.device.utilization < normalizedConfig.goodUtilization) issues.push({ device: row.device.shortName, type: "低使用率", evidence: `使用率 ${row.device.utilization.toFixed(1)}%，低于 ${normalizedConfig.goodUtilization}% 管理线`, cause: "排班、临床路径或设备共享机制不足", owner: row.device.department, due: "2026-08-31", priority: row.device.utilization < 40 ? "高" : "中" });
    if (row.payback && row.payback > normalizedConfig.warningPaybackYears) issues.push({ device: row.device.shortName, type: "回本延期", evidence: `静态回收期约 ${row.payback.toFixed(1)} 年`, cause: "单位产出不足或现金运营成本偏高", owner: `${row.device.department} / 财务部`, due: "2026-09-15", priority: "中" });
    if (row.hasInsight && (row.insight.availabilityRate < 95 || row.insight.pmCompletionRate < 95)) issues.push({ device: row.device.shortName, type: "设备保障", evidence: `可用率 ${row.insight.availabilityRate.toFixed(1)}%，PM完成率 ${row.insight.pmCompletionRate.toFixed(1)}%`, cause: "故障与预防性维护计划需复核", owner: "医学装备管理部", due: "2026-08-15", priority: "中" });
  });
  const publishedStatusRows = rows.filter((row) => row.dataStatus === "published");
  const publishedRows = rows.filter((row) => row.publication.usableForFormalConclusion);
  const publishedRowsWithInsight = publishedRows.filter((row) => row.hasInsight);
  const formalInvestment = publishedRows.reduce((sum, row) => sum + row.device.investment, 0);
  const formalRevenue = publishedRows.reduce((sum, row) => sum + row.revenue, 0);
  const formalCost = publishedRows.reduce((sum, row) => sum + row.cost, 0);
  const formalNet = formalRevenue - formalCost;
  const formalServiceVolume = publishedRows.reduce((sum, row) => sum + Math.round(row.device.serviceVolume * ratio), 0);
  const formalAvgUtilization = publishedRows.length ? average(publishedRows.map((row) => row.device.utilization)) : null;
  const formalAvgAvailability = publishedRowsWithInsight.length ? average(publishedRowsWithInsight.map((row) => row.insight.availabilityRate)) : null;
  const formalAvgPm = publishedRowsWithInsight.length ? average(publishedRowsWithInsight.map((row) => row.insight.pmCompletionRate)) : null;
  const formalTotals = publishedRows.length ? {
    investment: formalInvestment,
    revenue: formalRevenue,
    cost: formalCost,
    net: formalNet,
    serviceVolume: formalServiceVolume,
    avgUtilization: formalAvgUtilization,
    avgAvailability: formalAvgAvailability,
    avgPm: formalAvgPm,
    margin: formalRevenue ? formalNet / formalRevenue * 100 : 0,
  } : {
    investment: null,
    revenue: null,
    cost: null,
    net: null,
    serviceVolume: null,
    avgUtilization: null,
    avgAvailability: null,
    avgPm: null,
    margin: null,
  };
  const formalRankedRevenue = [...publishedRows].sort((a, b) => b.revenue - a.revenue);
  const formalTopContribution = formalRevenue
    ? formalRankedRevenue.slice(0, Math.min(3, formalRankedRevenue.length)).reduce((sum, row) => sum + row.revenue, 0) / formalRevenue * 100
    : 0;
  const formalKeyFindings: string[] = [];
  if (publishedRows.length) {
    formalKeyFindings.push(`${publishedRows.length} 组已发布设备事实纳入正式分析，${normalizedConfig.period}收入 ${formalRevenue.toFixed(1)} 万元、${costLabel} ${formalCost.toFixed(1)} 万元、结余 ${formalNet.toFixed(1)} 万元。`);
    formalKeyFindings.push(`${formalRankedRevenue.slice(0, 3).map((row) => row.device.shortName).join("、")}贡献已发布收入 ${formalTopContribution.toFixed(1)}%。`);
  }
  if (publishedRowsWithInsight.length) {
    formalKeyFindings.push(`${publishedRowsWithInsight.length} 组设备具备已发布运行洞察，平均设备可用率 ${formalAvgAvailability!.toFixed(1)}%，PM 完成率 ${formalAvgPm!.toFixed(1)}%。`);
  }
  const demoCount = rows.filter((row) => row.dataStatus === "demo").length;
  const unavailableCount = rows.filter((row) => row.dataStatus === "unavailable").length;
  const definitionVersionMismatch = rows.filter((row) => row.publication.blockingReason === "definition_version_mismatch").length;
  const publishedMissingInsight = publishedRows.filter((row) => !row.hasInsight).length;
  if (formalKeyFindings.length && (demoCount || unavailableCount)) {
    formalKeyFindings.push(`另有 ${demoCount} 组示例数据、${unavailableCount} 组不可用数据，均未进入正式结论。`);
  }
  if (formalKeyFindings.length && publishedMissingInsight) {
    formalKeyFindings.push(`${publishedMissingInsight} 组已发布设备事实缺少独立运行洞察，未生成可用率、PM 或综合评分结论。`);
  }
  if (formalKeyFindings.length && definitionVersionMismatch) {
    formalKeyFindings.push(`${definitionVersionMismatch} 组已发布事实的指标、可视化或分摊规则版本不一致，未进入正式结论。`);
  }
  const keyFindings = formalKeyFindings.length
    ? formalKeyFindings
    : definitionVersionMismatch
      ? [`当前 ${definitionVersionMismatch} 组已发布事实与报告冻结的指标、可视化或分摊规则版本不一致，不生成正式结论。`]
      : demoCount
      ? [`当前 ${demoCount} 组设备仅有示例数据，不可形成正式结论；请完成真实数据发布后重新生成报告。`]
      : [`当前范围没有已发布设备事实，${unavailableCount} 组设备数据不可用，不生成数值性正式结论。`];
  const recommendations = [
    `对使用率低于 ${normalizedConfig.goodUtilization}% 或结余为负的设备建立月度整改与复评机制。`,
    "建立已发布业务量文件与收入文件对账，差异分类为免费复查、绿色通道、退费和疑似漏费。",
    "将使用率、现金贡献、回本进度、可用率和 PM 完成率纳入科室经营与设备管理联席复核。",
  ];
  const sourceCoverage = {
    total: dataSources.length,
    connected: dataSources.filter((source) => source.status === "已连接").length,
    manual: dataSources.filter((source) => source.status === "人工填报").length,
    pending: dataSources.filter((source) => source.status === "待配置").length,
  };
  const dataBoundary = {
    total: rows.length,
    published: publishedStatusRows.length,
    formalPublished: publishedRows.length,
    demo: demoCount,
    unavailable: unavailableCount,
    publishedMissingInsight,
    definitionVersionMismatch,
    formalConclusionEligible: publishedRowsWithInsight.length,
    readyForFormalConclusion: rows.length > 0
      && publishedRows.length === rows.length
      && publishedRowsWithInsight.length === publishedRows.length,
  };
  const definitionReferences = {
    metricDefinitionVersion: normalizedConfig.commonRules.metricDefinitionVersion,
    visualizationVersion: normalizedConfig.commonRules.visualizationVersion,
    allocationRule: normalizedConfig.commonRules.allocationRule,
  };
  return {
    hospital,
    config: normalizedConfig,
    costLabel,
    ratio,
    rows: rows as BenefitReportRow[],
    totals: { investment, revenue, cost, net, serviceVolume, avgUtilization, avgAvailability, avgPm, margin: revenue ? net / revenue * 100 : 0 },
    formalTotals,
    scoreRows,
    overallScore,
    grade: gradeForScore(overallScore),
    issues,
    keyFindings,
    formalKeyFindings,
    dataBoundary,
    definitionReferences,
    publishedDataset: publishedDataset?.publication ? {
      publicationId: publishedDataset.publication.id,
      seriesId: publishedDataset.publication.seriesId,
      version: publishedDataset.publication.version,
      snapshotId: publishedDataset.publication.snapshotId,
      snapshotSha256: publishedDataset.publication.snapshotSha256,
      rowCount: publishedDataset.publication.rowCount,
      mappingVersion: publishedDataset.publication.mappingVersion,
      ruleVersion: publishedDataset.publication.ruleVersion,
      publishedAt: publishedDataset.publication.publishedAt,
      correctionOfId: publishedDataset.publication.correctionOfId,
      rollbackOfId: publishedDataset.publication.rollbackOfId,
    } : null,
    recommendations,
    sourceCoverage,
    publishedFileCoverage,
    dataSources,
    analysisProfiles: relevantAnalysisProfiles,
    analysisProfileCoverage,
    dimensions: dimensionMeta,
  };
}

export type BenefitReportModel = ReturnType<typeof buildBenefitReportModel>;
