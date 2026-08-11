import { BenefitReportConfig, BenefitReportModel, ReportScope } from "./benefit-report-model";
import { sourceRequirementCatalog } from "./report-template-catalog";

export type ReportWorkflowStatus = "draft" | "pending_review" | "approved" | "issued" | "rejected";
export type ReportQualityLevel = "blocker" | "warning" | "passed";

export type ReportQualityCheck = {
  id: string;
  domain: string;
  label: string;
  detail: string;
  level: ReportQualityLevel;
};

export type ReportQualityResult = {
  score: number;
  blockers: number;
  warnings: number;
  passed: number;
  checks: ReportQualityCheck[];
};

export type ReportRecord = {
  id: string;
  hospitalId: string;
  seriesId: string;
  version: number;
  status: ReportWorkflowStatus;
  title: string;
  period: string;
  scope: ReportScope;
  config: BenefitReportConfig;
  qualityScore: number;
  blockingCount: number;
  warningCount: number;
  warningAcknowledged: boolean;
  reviewComment: string;
  createdBy: string;
  reviewedBy: string;
  approvedBy: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportTemplate = {
  id: string;
  hospitalId: string;
  name: string;
  description: string;
  config: BenefitReportConfig;
  isDefault: boolean;
  updatedAt: string;
};

export type ReportEvent = {
  id: number | string;
  reportId: string | null;
  actor: string;
  action: string;
  detail: string;
  createdAt: string;
};

export const reportStatusMeta: Record<ReportWorkflowStatus, { label: string; note: string }> = {
  draft: { label: "草稿", note: "编制人可继续修改" },
  pending_review: { label: "待复核", note: "内容已冻结，等待财务或运营复核" },
  approved: { label: "已复核", note: "冻结版本等待院领导签发" },
  issued: { label: "已签发", note: "冻结版本已纳入正式台账" },
  rejected: { label: "已退回", note: "按意见生成新版本修改" },
};

function valuePresent(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function sourceRequirementState(model: BenefitReportModel, sourceId: string) {
  const rule = sourceRequirementCatalog.find((requirement) => requirement.id === sourceId);
  if (!rule) return { id: sourceId, label: sourceId, status: "待配置" as const };
  const source = model.dataSources.find((candidate) => {
    const haystack = `${candidate.name} ${candidate.category} ${candidate.fields}`.toLowerCase();
    return rule.matchKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
  });
  const fileLabel: Record<string, string> = {
    his_billing: "收入与业务量文件",
    finance_hrp: "财务成本文件",
    device_runtime: "设备运行事件文件",
    cmms_eam: "工单与维修保养文件",
    spd_material: "耗材与试剂文件",
  };
  return {
    id: sourceId,
    label: fileLabel[sourceId] ?? rule.name,
    status: model.publishedFileCoverage.mode === "published"
      ? model.publishedFileCoverage.statusByRequirement[sourceId] ? "已连接" : "待配置"
      : source?.status ?? "待配置",
  };
}

export function buildReportQuality(model: BenefitReportModel): ReportQualityResult {
  const checks: ReportQualityCheck[] = [];
  const add = (check: ReportQualityCheck) => checks.push(check);
  const config = model.config;
  const missingMetadata = [
    ["报告标题", config.title],
    ["编制部门", config.preparedBy],
    ["编制人", config.compiler],
    ["审核人 / 部门", config.reviewer],
    ["报告日期", config.issueDate],
  ].filter(([, value]) => !valuePresent(value)).map(([label]) => label);
  add({
    id: "metadata",
    domain: "报告责任链",
    label: missingMetadata.length ? "报告责任信息不完整" : "报告责任信息完整",
    detail: missingMetadata.length ? `缺少：${missingMetadata.join("、")}` : `${config.compiler} 编制，${config.reviewer} 复核`,
    level: missingMetadata.length ? "blocker" : "passed",
  });

  add({
    id: "scope",
    domain: "分析范围",
    label: model.rows.length ? "已识别分析对象" : "当前条件没有匹配设备",
    detail: model.rows.length ? `共纳入 ${model.rows.length} 台（套）设备` : "请降低最低原值、切换范围或选择有效设备；系统不会自动替换为其他设备。",
    level: model.rows.length ? "passed" : "blocker",
  });

  const identityMissing = model.rows.filter(({ device }) => ![device.assetCode, device.name, device.model, device.department, device.enabledDate].every(valuePresent));
  add({
    id: "identity",
    domain: "一物一档",
    label: identityMissing.length ? "设备唯一标识或归属不完整" : "设备主标识可追溯",
    detail: identityMissing.length ? `${identityMissing.length} 台设备缺少资产编号、型号、科室或启用日期` : "资产编号、型号、科室和启用日期均已覆盖",
    level: identityMissing.length ? "blocker" : "passed",
  });

  const safetyMissing = model.rows.filter(({ device }) => !valuePresent(device.licenseNumber) || !valuePresent(device.maintenanceStatus));
  add({
    id: "safety",
    domain: "安全合规",
    label: safetyMissing.length ? "存在安全合规硬门槛" : "配置许可与维保状态完整",
    detail: safetyMissing.length ? `${safetyMissing.map(({ device }) => device.shortName).join("、")} 缺少配置许可或维保状态` : "安全合规作为独立门槛，不参与经济指标加权抵消",
    level: safetyMissing.length ? "blocker" : "passed",
  });

  const financialInvalid = model.rows.filter(({ device, revenue, cost }) => !Number.isFinite(device.investment) || device.investment <= 0 || !Number.isFinite(revenue) || !Number.isFinite(cost));
  add({
    id: "finance",
    domain: "财务口径",
    label: financialInvalid.length ? "核心财务数据不可计算" : "核心财务数据可计算",
    detail: financialInvalid.length ? `${financialInvalid.length} 台设备缺少原值、收入或${model.costLabel}` : `原值、收入、${model.costLabel}和结余均已生成`,
    level: financialInvalid.length ? "blocker" : "passed",
  });

  const missingInsights = model.rows.filter((row) => !row.hasInsight);
  add({
    id: "insight-lineage",
    domain: "指标归属",
    label: missingInsights.length ? "存在未采集的设备运行指标" : "运行指标与设备身份匹配",
    detail: missingInsights.length ? `${missingInsights.map(({ device }) => device.shortName).join("、")} 尚无独立质量、效率与保障数据，不能沿用其他设备示例值` : "每台纳入设备均有对应的质量、效率和保障指标",
    level: missingInsights.length ? "blocker" : "passed",
  });

  const publishedDataset = model.publishedDataset;
  const publishedSnapshotValid = Boolean(
    publishedDataset
    && publishedDataset.version > 0
    && publishedDataset.rowCount > 0
    && /^[a-f0-9]{64}$/i.test(publishedDataset.snapshotSha256)
    && publishedDataset.snapshotId.trim()
    && publishedDataset.publicationId.trim(),
  );
  const formalPublicationRequired = model.dataBoundary.published > 0 || Boolean(publishedDataset);
  add({
    id: "published-snapshot",
    domain: "发布快照",
    label: !formalPublicationRequired
      ? "当前为演示或未发布数据"
      : publishedSnapshotValid && model.dataBoundary.readyForFormalConclusion
        ? "正式结论已绑定不可变发布快照"
        : "正式结论缺少完整发布证据",
    detail: !formalPublicationRequired
      ? "正式提交前必须切换到已发布文件版本。"
      : publishedSnapshotValid
        ? `发布 ${publishedDataset!.seriesId}@${publishedDataset!.version} · Snapshot ${publishedDataset!.snapshotId} · SHA-256 ${publishedDataset!.snapshotSha256}`
        : "发布版本、快照 ID、64 位 SHA-256、行数或逐设备洞察不完整，不能形成正式结论。",
    level: !formalPublicationRequired ? "warning" : publishedSnapshotValid && model.dataBoundary.readyForFormalConclusion ? "passed" : "blocker",
  });

  const disconnected = model.publishedFileCoverage.mode === "published"
    ? model.publishedFileCoverage.missingIds.length
    : model.sourceCoverage.pending + model.sourceCoverage.manual;
  const connectedFileCount = model.publishedFileCoverage.mode === "published"
    ? model.publishedFileCoverage.readyIds.length
    : model.sourceCoverage.connected;
  add({
    id: "sources",
    domain: "数据血缘",
    label: disconnected ? "仍有人工或待发布文件" : "所需文件均已发布",
    detail: disconnected
      ? model.publishedFileCoverage.mode === "published"
        ? `${model.publishedFileCoverage.missingIds.length} 类模板文件尚未进入当前发布集合；签发前需补齐并重新发布。`
        : `${model.sourceCoverage.pending} 类待准备，${model.sourceCoverage.manual} 类人工文件；签发前需确认取数截止时间与调整原因`
      : `${connectedFileCount} 类文件已形成发布快照`,
    level: disconnected ? "warning" : "passed",
  });

  const requiredSourceStates = model.config.template.requiredSourceRequirementIds
    .map((sourceId) => sourceRequirementState(model, sourceId));
  const unresolvedRequiredSources = requiredSourceStates.filter((source) => source.status !== "已连接");
  const manualRequiredSources = unresolvedRequiredSources.filter((source) => source.status === "人工填报");
  const pendingRequiredSources = unresolvedRequiredSources.filter((source) => source.status === "待配置");
  const manualDocumentationMissing = model.config.commonRules.missingValuePolicy === "manual_with_reason"
    && unresolvedRequiredSources.length > 0
    && ![
      model.config.commonRules.manualDataOwner,
      model.config.commonRules.manualDataReason,
      model.config.commonRules.manualDataEvidence,
    ].every(valuePresent);
  const requiredSourceLevel: ReportQualityLevel = unresolvedRequiredSources.length
    ? model.config.commonRules.missingValuePolicy === "block" || manualDocumentationMissing ? "blocker" : "warning"
    : "passed";
  const requiredSourcePolicyNote = model.config.commonRules.missingValuePolicy === "block"
    ? "当前模板采用“缺失即阻断”，完成文件准备与发布前不能提交。"
    : model.config.commonRules.missingValuePolicy === "manual_with_reason"
      ? manualDocumentationMissing
        ? "受控补录缺少责任人、原因或佐证，补齐前不能提交。"
        : `受控补录责任人：${model.config.commonRules.manualDataOwner}；原因与佐证已记录并将随快照冻结。`
      : "当前模板允许预警披露，复核人需确认缺失影响。";
  add({
    id: "template-required-sources",
    domain: "模板必需来源",
    label: unresolvedRequiredSources.length
      ? `${unresolvedRequiredSources.length} 类模板必需文件尚未发布`
      : "模板必需文件均已发布",
    detail: unresolvedRequiredSources.length
      ? [
        pendingRequiredSources.length ? `待配置：${pendingRequiredSources.map((source) => source.label).join("、")}` : "",
        manualRequiredSources.length ? `人工填报：${manualRequiredSources.map((source) => source.label).join("、")}` : "",
        requiredSourcePolicyNote,
      ].filter(Boolean).join("；")
      : `${requiredSourceStates.length} 类必需文件均匹配到本院已发布快照。`,
    level: requiredSourceLevel,
  });

  const standardHours = model.config.commonRules.standardServiceHoursPerDay;
  const invalidStandardHours = !Number.isFinite(standardHours) || standardHours <= 0 || standardHours > 24;
  const utilizationMismatches = invalidStandardHours
    ? []
    : model.rows.filter(({ device, insight, hasInsight }) => {
      if (!hasInsight) return false;
      const calculatedUtilization = Math.min(100, insight.activeHours / standardHours * 100);
      return Math.abs(calculatedUtilization - device.utilization) > 15;
    });
  add({
    id: "utilization-rule",
    domain: "使用率口径",
    label: invalidStandardHours
      ? "标准服务时长无效"
      : utilizationMismatches.length
        ? "设备使用率与公共分母存在显著差异"
        : "使用率分母与运行数据相互印证",
    detail: invalidStandardHours
      ? "标准服务时长必须大于 0 且不超过 24 小时/日。"
      : utilizationMismatches.length
        ? `按 ${standardHours} 小时/日复算后，${utilizationMismatches.map(({ device }) => device.shortName).join("、")} 与台账使用率相差超过 15 个百分点，需确认排班分母或事件时长。`
        : `已按 ${standardHours} 小时/日复核有效工作时长与使用率，未发现超过 15 个百分点的口径差异。`,
    level: invalidStandardHours ? "blocker" : utilizationMismatches.length ? "warning" : "passed",
  });

  const profileCoverage = model.analysisProfileCoverage;
  const profileLevel: ReportQualityLevel = profileCoverage.missing.length
    ? "blocker"
    : profileCoverage.pending ? "warning" : "passed";
  add({
    id: "collection-profiles",
    domain: "采集口径",
    label: profileCoverage.missing.length
      ? "存在未配置采集规则的设备品类"
      : profileCoverage.pending
        ? "采集规则尚未全部启用"
        : "采集、绑定与对账规则已冻结",
    detail: profileCoverage.missing.length
      ? `缺少：${profileCoverage.missing.join("、")}；不得用其他品类的规则替代。`
      : profileCoverage.pending
        ? `${profileCoverage.enabled}/${profileCoverage.total} 个相关品类已启用，未启用规则需在签发前说明取数方式。`
        : `${profileCoverage.enabled} 个相关品类均已配置设备身份绑定、质量阈值、使用率分母和收费对账容差。`,
    level: profileLevel,
  });

  const operationalRisks = model.rows.filter(({ device, insight, hasInsight }) => device.status !== "运行良好" || (hasInsight && (insight.availabilityRate < 95 || insight.pmCompletionRate < 95)));
  add({
    id: "operations",
    domain: "运行风险",
    label: operationalRisks.length ? "存在需在结论中披露的运行风险" : "设备运行指标达到管理线",
    detail: operationalRisks.length ? `${operationalRisks.map(({ device }) => device.shortName).join("、")} 存在低效益、低可用率或 PM 风险` : "状态、可用率和 PM 完成率未触发预警",
    level: operationalRisks.length ? "warning" : "passed",
  });

  add({
    id: "chapters",
    domain: "报告结构",
    label: config.sections.length ? "报告章节已配置" : "未选择报告章节",
    detail: config.sections.length ? `已选择 ${config.sections.length} 个章节` : "至少选择一个章节才能提交或导出",
    level: config.sections.length ? "passed" : "blocker",
  });

  const blockers = checks.filter((check) => check.level === "blocker").length;
  const warnings = checks.filter((check) => check.level === "warning").length;
  const passed = checks.filter((check) => check.level === "passed").length;
  return { score: Math.max(0, 100 - blockers * 20 - warnings * 5), blockers, warnings, passed, checks };
}

export function buildReportSnapshot(model: BenefitReportModel, quality: ReportQualityResult) {
  return {
    generatedAt: new Date().toISOString(),
    hospital: { id: model.hospital.id, code: model.hospital.code, name: model.hospital.name },
    config: model.config,
    quality,
    totals: model.totals,
    costLabel: model.costLabel,
    scoreRows: model.scoreRows,
    overallScore: model.overallScore,
    grade: model.grade,
    issues: model.issues,
    keyFindings: model.keyFindings,
    recommendations: model.recommendations,
    dimensions: model.dimensions,
    rows: model.rows.map(({ device, insight, revenue, cost, net, payback, score, grade }) => ({
      device,
      insight,
      revenue,
      cost,
      net,
      payback,
      score,
      grade,
    })),
    sourceCoverage: model.sourceCoverage,
    publishedFileCoverage: model.publishedFileCoverage,
    dataSources: model.dataSources,
    analysisProfileCoverage: model.analysisProfileCoverage,
    analysisProfiles: model.analysisProfiles,
    publishedDataset: model.publishedDataset,
    definitionReferences: model.definitionReferences,
    dataBoundary: model.dataBoundary,
  };
}
