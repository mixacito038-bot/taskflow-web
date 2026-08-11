"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BadgeCheck,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  ClipboardCheck,
  Database,
  Download,
  FileCheck2,
  FileClock,
  FileText,
  History,
  ListChecks,
  RefreshCcw,
  Save,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TableProperties,
  UserCheck,
  XCircle,
} from "lucide-react";
import { Hospital } from "./access-control-data";
import {
  BenefitReportModel,
  BenefitReportConfig,
  buildBenefitReportModel,
  createDefaultReportConfig,
  normalizeBenefitReportConfig,
  reportFieldDomains,
  reportSections,
  ReportSectionId,
} from "./benefit-report-model";
import type { BenefitAnalysisProfile } from "./benefit-analysis-config";
import { exportBenefitReportDocx } from "./benefit-report-export";
import { DataSource, Device } from "./mock-data";
import {
  buildReportQuality,
  buildReportSnapshot,
  ReportEvent,
  ReportQualityResult,
  ReportRecord,
  reportStatusMeta,
  ReportTemplate,
  ReportWorkflowStatus,
} from "./report-governance";
import {
  buildPlatformTemplateConfig,
  fieldPackCatalog,
  granularityForPeriod,
  getPlatformTemplate,
  platformReportTemplates,
  resolveMonthlyReportPeriod,
  sourceRequirementCatalog,
  templateCategories,
  type PlatformReportTemplate,
  type ReportTemplateCategoryId,
  type TemplateSourceRequirementId,
} from "./report-template-catalog";
import { HOSPITAL_METRIC_CATALOG_VERSION, hospitalMetricCatalog } from "./hospital-metric-catalog";
import type { PublishedDatasetView } from "./published-data";
import styles from "./BenefitReportCenter.module.css";

type ReportTab = "preview" | "templates" | "config" | "quality" | "ledger" | "fields";
type FrozenReportSnapshot = {
  generatedAt?: string;
  hospital: Pick<Hospital, "id" | "code" | "name">;
  config: BenefitReportConfig;
  quality?: ReportQualityResult;
  totals: BenefitReportModel["totals"];
  scoreRows: BenefitReportModel["scoreRows"];
  overallScore: number;
  grade: string;
  issues: BenefitReportModel["issues"];
  keyFindings?: BenefitReportModel["keyFindings"];
  recommendations?: BenefitReportModel["recommendations"];
  dimensions?: BenefitReportModel["dimensions"];
  rows: BenefitReportModel["rows"];
  sourceCoverage: BenefitReportModel["sourceCoverage"];
  publishedFileCoverage?: BenefitReportModel["publishedFileCoverage"];
  costLabel?: string;
  dataSources: BenefitReportModel["dataSources"];
  analysisProfileCoverage?: BenefitReportModel["analysisProfileCoverage"];
  analysisProfiles?: BenefitReportModel["analysisProfiles"];
  publishedDataset?: BenefitReportModel["publishedDataset"];
  definitionReferences?: BenefitReportModel["definitionReferences"];
  dataBoundary?: BenefitReportModel["dataBoundary"];
};
type ReportRecordWithSnapshot = ReportRecord & { snapshotJson?: FrozenReportSnapshot | null };
type LedgerResponse = { reports: ReportRecordWithSnapshot[]; templates: ReportTemplate[]; events: ReportEvent[] };
type ReportArtifact = {
  id: string;
  reportId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
};
type CloudArtifactStoreResult = "stored" | "demo" | "unsaved" | "draft" | "issued_restricted";

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });
const templateScopeLabels = { hospital: "全院", category: "设备品类", device: "单台设备" } as const;
const templatePeriodLabels = { month: "月", quarter: "季", half_year: "半年", year: "年" } as const;
const reportPeriodOptions = ["2026年6月", "2026年第二季度", "2026年上半年", "2026年度"];

function periodCapability(period: string) {
  const labels = { month: "月度", quarter: "季度", half_year: "半年度", year: "年度" } as const;
  const granularity = granularityForPeriod(period);
  return granularity ? labels[granularity] : null;
}

function supportsPeriod(config: BenefitReportConfig, period: string) {
  const capability = periodCapability(period);
  return Boolean(capability && config.template.supportedPeriods.includes(capability));
}

function displayTime(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function displayFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function scopeLabel(config: BenefitReportConfig, rows: BenefitReportModel["rows"]) {
  if (config.scope === "hospital") return "全院重点设备";
  if (config.scope === "category") return `设备品类：${config.deviceCategory || "未指定"}`;
  return `单台设备：${rows[0]?.device.name ?? "未指定"}`;
}

function keepRuntimeValues(next: BenefitReportConfig, current: BenefitReportConfig) {
  const supportedScope = next.template.supportedScopes.includes(current.scope);
  return normalizeBenefitReportConfig({
    ...next,
    period: supportsPeriod(next, current.period) ? current.period : next.period,
    scope: supportedScope ? current.scope : next.scope,
    deviceId: current.deviceId,
    deviceCategory: current.deviceCategory,
    compiler: current.compiler,
    reviewer: current.reviewer,
    issueDate: current.issueDate,
  }, current.period);
}

function nextHospitalTemplateVersion(version: string) {
  const match = version.match(/^(\d+)\.(\d+)$/);
  return match ? `${match[1]}.${Number(match[2]) + 1}` : "1.0";
}

function applyPublicationRules(
  value: BenefitReportConfig,
  publication: PublishedDatasetView["publication"] | undefined,
): BenefitReportConfig {
  if (!publication || (
    value.commonRules.metricDefinitionVersion === publication.metricDefinitionVersion
    && value.commonRules.visualizationVersion === publication.visualizationVersion
    && value.commonRules.allocationRule === publication.allocationRule
  )) return value;
  return {
    ...value,
    commonRules: {
      ...value.commonRules,
      metricDefinitionVersion: publication.metricDefinitionVersion,
      visualizationVersion: publication.visualizationVersion,
      allocationRule: publication.allocationRule,
    },
  };
}

function supportsMonthlyHospitalReport(config: BenefitReportConfig) {
  return config.template.supportedPeriods.includes("月度") && config.template.supportedScopes.includes("hospital");
}

/** 月度模板选择：本院默认 → 平台综合效益 → 本院首个已启用 → 平台首个月度模板；仅接受支持“月度 + 全院”的模板。 */
function resolveMonthlyReportTemplate(hospitalTemplates: ReportTemplate[], targetPeriod: string) {
  const hospitalDefault = hospitalTemplates.find((template) => template.isDefault);
  if (hospitalDefault) {
    const candidate = normalizeBenefitReportConfig(hospitalDefault.config, targetPeriod);
    if (supportsMonthlyHospitalReport(candidate)) return { config: candidate, sourceLabel: `本院默认模板“${hospitalDefault.name}”` };
  }
  const comprehensive = platformReportTemplates.find((template) => template.categoryId === "comprehensive_benefit" && template.supportedPeriods.includes("month") && template.supportedScopes.includes("hospital"));
  if (comprehensive) return { config: buildPlatformTemplateConfig(comprehensive, targetPeriod), sourceLabel: `平台模板“${comprehensive.name}”` };
  const firstEnabled = hospitalTemplates
    .map((template) => ({ template, config: normalizeBenefitReportConfig(template.config, targetPeriod) }))
    .find((item) => supportsMonthlyHospitalReport(item.config));
  if (firstEnabled) return { config: firstEnabled.config, sourceLabel: `本院模板“${firstEnabled.template.name}”` };
  const monthlyPlatform = platformReportTemplates.find((template) => template.status === "active" && template.supportedPeriods.includes("month") && template.supportedScopes.includes("hospital"));
  if (monthlyPlatform) return { config: buildPlatformTemplateConfig(monthlyPlatform, targetPeriod), sourceLabel: `平台模板“${monthlyPlatform.name}”` };
  return null;
}

function workflowStep(status: ReportWorkflowStatus | "unsaved") {
  if (status === "unsaved" || status === "draft" || status === "rejected") return 0;
  if (status === "pending_review") return 1;
  if (status === "approved") return 2;
  return 3;
}

function workflowErrorMessage(code: string) {
  return ({
    permission_denied: "当前医院角色没有执行此操作的权限",
    quality_gate_failed: "数据质量门禁未通过，请先处理阻断项并确认预警",
    separation_of_duties: "职责分离校验未通过：编制、复核和签发不能由同一账号完成",
    invalid_transition: "报告状态已经变化，请刷新台账后重试",
    immutable_report: "已提交的版本已冻结，请新建修订版本",
    comment_required: "退回报告时必须填写复核意见",
    report_store_unavailable: "报告服务暂不可用，请稍后重试",
    template_too_large: "模板配置过大，请精简配置后再保存",
    unknown_report_template: "模板尚未进入平台受控目录，暂不能保存或提交",
    unsupported_report_period: "当前模板不支持所选报告期间",
    unsupported_report_scope: "当前模板不支持所选分析范围",
    report_scope_exceeds_access: "当前账号的数据范围不足，不能生成或操作包含其他科室设备的报告",
    invalid_report_snapshot: "报告冻结快照校验失败，请重新保存草稿后再提交",
    hospital_not_available: "当前医院不可用或已停用",
  } as Record<string, string>)[code] ?? "报告操作失败，请稍后重试";
}

function reportNumber(hospital: Hospital, report: ReportRecord) {
  const suffix = report.seriesId.split("-").filter(Boolean).at(-1)?.slice(-8).toUpperCase() || "REPORT";
  return `${hospital.code}-${suffix}`;
}

function frozenModelForReport(
  report: ReportRecordWithSnapshot,
  hospital: Hospital,
  fallback: BenefitReportModel,
) {
  const snapshot = report.snapshotJson;
  if (
    !snapshot?.hospital
    || !snapshot.config
    || !snapshot.totals
    || !Array.isArray(snapshot.rows)
    || !Array.isArray(snapshot.scoreRows)
    || !Array.isArray(snapshot.issues)
    || !Array.isArray(snapshot.dataSources)
    || !Number.isFinite(snapshot.overallScore)
  ) return null;

  const frozenConfig = normalizeBenefitReportConfig(snapshot.config);
  const frozenCostLabel = frozenConfig.costScope === "non_personnel" ? "非人员成本" : "全成本";
  const rankedRevenue = [...snapshot.rows].sort((left, right) => right.revenue - left.revenue);
  const topContribution = snapshot.totals.revenue
    ? rankedRevenue.slice(0, Math.min(3, rankedRevenue.length)).reduce((sum, row) => sum + row.revenue, 0) / snapshot.totals.revenue * 100
    : 0;
  const keyFindings = [
    `${snapshot.rows.length} 组设备纳入分析，${frozenConfig.period}收入 ${snapshot.totals.revenue.toFixed(1)} 万元、${frozenCostLabel} ${snapshot.totals.cost.toFixed(1)} 万元、结余 ${snapshot.totals.net.toFixed(1)} 万元。`,
    `${rankedRevenue.slice(0, 3).map((row) => row.device.shortName).join("、")}贡献收入 ${topContribution.toFixed(1)}%，是本期主要产出设备。`,
    `平均使用率 ${snapshot.totals.avgUtilization.toFixed(1)}%，平均设备可用率 ${snapshot.totals.avgAvailability.toFixed(1)}%，PM 完成率 ${snapshot.totals.avgPm.toFixed(1)}%。`,
  ];
  const recommendations = [
    `对使用率低于 ${frozenConfig.goodUtilization}% 或结余为负的设备建立月度整改与复评机制。`,
    "建立已发布业务量文件与收入文件对账，差异分类为免费复查、绿色通道、退费和疑似漏费。",
    "将使用率、现金贡献、回本进度、可用率和 PM 完成率纳入科室经营与设备管理联席复核。",
  ];
  return {
    ...fallback,
    hospital: { ...hospital, ...snapshot.hospital },
    config: frozenConfig,
    costLabel: snapshot.costLabel ?? frozenCostLabel,
    rows: snapshot.rows,
    totals: snapshot.totals,
    scoreRows: snapshot.scoreRows,
    overallScore: snapshot.overallScore,
    grade: snapshot.grade,
    issues: snapshot.issues,
    keyFindings: Array.isArray(snapshot.keyFindings) ? snapshot.keyFindings : keyFindings,
    recommendations: Array.isArray(snapshot.recommendations) ? snapshot.recommendations : recommendations,
    sourceCoverage: snapshot.sourceCoverage,
    publishedFileCoverage: snapshot.publishedFileCoverage ?? fallback.publishedFileCoverage,
    dataSources: snapshot.dataSources,
    analysisProfileCoverage: snapshot.analysisProfileCoverage ?? fallback.analysisProfileCoverage,
    analysisProfiles: snapshot.analysisProfiles ?? fallback.analysisProfiles,
    dimensions: snapshot.dimensions ?? fallback.dimensions,
    publishedDataset: snapshot.publishedDataset ?? null,
    definitionReferences: snapshot.definitionReferences ?? fallback.definitionReferences,
    dataBoundary: snapshot.dataBoundary ?? fallback.dataBoundary,
  } satisfies BenefitReportModel;
}

function frozenPublishedReportSnapshot(model: BenefitReportModel, quality: ReportQualityResult) {
  return {
    ...buildReportSnapshot(model, quality),
    publishedDataset: model.publishedDataset,
    definitionReferences: model.definitionReferences,
    dataBoundary: model.dataBoundary,
  };
}

function createDemoLedger(
  hospital: Hospital,
  config: BenefitReportConfig,
  devices: Device[],
  dataSources: DataSource[],
  analysisProfiles: BenefitAnalysisProfile[],
): LedgerResponse {
  const issuedConfig = { ...config, period: "2025年度", issueDate: "2026-03-18" };
  const issuedModel = buildBenefitReportModel(devices, hospital, issuedConfig, dataSources, analysisProfiles);
  const issuedQuality = buildReportQuality(issuedModel);
  return {
    reports: [{
      id: `demo-issued-${hospital.id}`,
      hospitalId: hospital.id,
      seriesId: `demo-series-${hospital.id}`,
      version: 1,
      status: "issued",
      title: issuedConfig.title,
      period: issuedConfig.period,
      scope: issuedConfig.scope,
      config: issuedConfig,
      snapshotJson: buildReportSnapshot(issuedModel, issuedQuality),
      qualityScore: issuedQuality.score,
      blockingCount: issuedQuality.blockers,
      warningCount: issuedQuality.warnings,
      warningAcknowledged: true,
      reviewComment: "财务口径与设备台账已完成交叉复核。",
      createdBy: "周宁",
      reviewedBy: "林晓",
      approvedBy: "陈敏",
      submittedAt: "2026-03-15T09:20:00.000Z",
      reviewedAt: "2026-03-16T08:40:00.000Z",
      issuedAt: "2026-03-18T02:10:00.000Z",
      createdAt: "2026-03-14T03:00:00.000Z",
      updatedAt: "2026-03-18T02:10:00.000Z",
    }],
    templates: [{ id: `demo-template-${hospital.id}`, hospitalId: hospital.id, name: "全院大型设备年度评价", description: "医院默认模板，覆盖经济、效率、质量、安全和生命周期。", config, isDefault: true, updatedAt: "2026-06-30T08:00:00.000Z" }],
    events: [
      { id: "demo-event-3", reportId: `demo-issued-${hospital.id}`, actor: "陈敏", action: "issue_report", detail: "签发正式报告并冻结快照", createdAt: "2026-03-18T02:10:00.000Z" },
      { id: "demo-event-2", reportId: `demo-issued-${hospital.id}`, actor: "林晓", action: "approve_report", detail: "财务口径与设备台账已完成交叉复核", createdAt: "2026-03-16T08:40:00.000Z" },
      { id: "demo-event-1", reportId: `demo-issued-${hospital.id}`, actor: "周宁", action: "submit_report", detail: "提交财务 / 运营复核", createdAt: "2026-03-15T09:20:00.000Z" },
    ],
  };
}

function normalizeLedgerResponse(ledger: LedgerResponse): LedgerResponse {
  return {
    ...ledger,
    reports: ledger.reports.map((report) => ({
      ...report,
      config: normalizeBenefitReportConfig(report.config),
      snapshotJson: report.snapshotJson
        ? { ...report.snapshotJson, config: normalizeBenefitReportConfig(report.snapshotJson.config) }
        : report.snapshotJson,
    })),
    templates: ledger.templates.map((template) => ({
      ...template,
      config: normalizeBenefitReportConfig(template.config),
    })),
  };
}

export default function BenefitReportCenter({
  devices,
  dataSources,
  analysisProfiles,
  hospital,
  period,
  onPeriodChange,
  canManage,
  canReview,
  canApprove,
  canExport,
  serverPersistence,
  viewerName,
  onOpenEquipment,
  onOpenSources,
  notify,
  publishedData,
}: {
  devices: Device[];
  dataSources: DataSource[];
  analysisProfiles: BenefitAnalysisProfile[];
  hospital: Hospital;
  period: string;
  onPeriodChange: (period: string) => void;
  canManage: boolean;
  canReview: boolean;
  canApprove: boolean;
  canExport: boolean;
  serverPersistence: boolean;
  viewerName: string;
  onOpenEquipment?: () => void;
  onOpenSources?: () => void;
  notify: (message: string) => void;
  publishedData?: PublishedDatasetView;
}) {
  const [tab, setTab] = useState<ReportTab>("preview");
  const [config, setConfig] = useState<BenefitReportConfig>(() => createDefaultReportConfig(period === "2026年度" ? "2026年上半年" : period));
  const [initialLedger] = useState(() => createDemoLedger(
    hospital,
    createDefaultReportConfig(period === "2026年度" ? "2026年上半年" : period),
    devices,
    dataSources,
    analysisProfiles,
  ));
  const [reports, setReports] = useState<ReportRecordWithSnapshot[]>(serverPersistence ? [] : initialLedger.reports);
  const [templates, setTemplates] = useState<ReportTemplate[]>(serverPersistence ? [] : initialLedger.templates);
  const [events, setEvents] = useState<ReportEvent[]>(serverPersistence ? [] : initialLedger.events);
  const [artifacts, setArtifacts] = useState<ReportArtifact[]>([]);
  const [currentReportId, setCurrentReportId] = useState("");
  const [warningAcknowledged, setWarningAcknowledged] = useState(false);
  const [reviewComment, setReviewComment] = useState("");
  const [templateName, setTemplateName] = useState("全维度管理模板");
  const [templateDescription, setTemplateDescription] = useState("基于平台模板并结合本院口径形成的适配方案");
  const [templateAsDefault, setTemplateAsDefault] = useState(false);
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState<"all" | ReportTemplateCategoryId>("all");
  const [busyAction, setBusyAction] = useState("");
  const [ledgerLoading, setLedgerLoading] = useState(serverPersistence);
  const [artifactLoading, setArtifactLoading] = useState(serverPersistence && canExport);
  const [exporting, setExporting] = useState(false);
  const defaultAppliedHospital = useRef("");

  const reportConfig = useMemo(
    () => applyPublicationRules(config, publishedData?.publication),
    [config, publishedData?.publication],
  );

  const liveModel = useMemo(
    () => buildBenefitReportModel(devices, hospital, reportConfig, dataSources, analysisProfiles, publishedData),
    [analysisProfiles, dataSources, devices, hospital, publishedData, reportConfig],
  );
  const currentReport = reports.find((report) => report.id === currentReportId) ?? null;
  const usesFrozenReportSnapshot = Boolean(
    currentReport && ["pending_review", "approved", "issued"].includes(currentReport.status),
  );
  const frozenSnapshotModel = usesFrozenReportSnapshot && currentReport
    ? frozenModelForReport(currentReport, hospital, liveModel)
    : null;
  const snapshotUnavailable = usesFrozenReportSnapshot && !frozenSnapshotModel;
  const model = frozenSnapshotModel ?? liveModel;
  const liveQuality = useMemo(() => buildReportQuality(liveModel), [liveModel]);
  const quality = usesFrozenReportSnapshot && currentReport?.snapshotJson?.quality
    ? currentReport.snapshotJson.quality
    : liveQuality;
  const currentStatus = currentReport?.status ?? "unsaved";
  const currentStep = workflowStep(currentStatus);
  const editable = canManage && (!currentReport || currentReport.status === "draft");
  const totalFields = reportFieldDomains.reduce((sum, item) => sum + item.fields, 0);
  const coveredFields = reportFieldDomains.reduce((sum, item) => sum + item.covered, 0);
  const completeness = totalFields ? coveredFields / totalFields * 100 : 0;
  const deviceCategories = useMemo(
    () => [...new Set(devices.map((device) => device.category).filter((value): value is string => Boolean(value)))],
    [devices],
  );
  const activePlatformTemplate = useMemo(
    () => getPlatformTemplate(config.template.baseCode ?? config.template.code),
    [config.template.baseCode, config.template.code],
  );
  const hospitalDefaultTemplate = templates.find((template) => template.isDefault) ?? null;
  const filteredPlatformTemplates = useMemo(
    () => platformReportTemplates.filter((template) => templateCategoryFilter === "all" || template.categoryId === templateCategoryFilter),
    [templateCategoryFilter],
  );
  const monthlyTargetPeriod = useMemo(() => resolveMonthlyReportPeriod(new Date(), reportPeriodOptions), []);

  function sourceMatch(sourceId: TemplateSourceRequirementId) {
    const requirement = sourceRequirementCatalog.find((item) => item.id === sourceId);
    if (!requirement) return null;
    const match = dataSources.find((source) => {
      const haystack = `${source.name} ${source.category} ${source.fields}`.toLowerCase();
      return requirement.matchKeywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
    });
    return { requirement, match };
  }

  function requirementFileLabel(sourceId: TemplateSourceRequirementId, fallback: string) {
    return ({
      his_billing: "收入与业务量文件",
      finance_hrp: "财务成本文件",
      device_runtime: "设备运行事件文件",
      cmms_eam: "工单与维修保养文件",
      spd_material: "耗材与试剂文件",
    } as Partial<Record<TemplateSourceRequirementId, string>>)[sourceId] ?? fallback;
  }

  const activeSourceReadiness = activePlatformTemplate
    ? activePlatformTemplate.sourceRequirements.reduce((summary, item) => {
      const match = sourceMatch(item.sourceId)?.match;
      summary.total += 1;
      if (model.publishedFileCoverage.mode === "published" && model.publishedFileCoverage.statusByRequirement[item.sourceId]) summary.ready += 1;
      else if (model.publishedFileCoverage.mode !== "published" && match?.status === "已连接") summary.ready += 1;
      else if (match?.status === "人工填报") summary.manual += 1;
      else summary.pending += 1;
      return summary;
    }, { total: 0, ready: 0, manual: 0, pending: 0 })
    : { total: 0, ready: 0, manual: 0, pending: 0 };

  useEffect(() => {
    if (!serverPersistence) return;
    let cancelled = false;
    fetch(`/api/benefit-reports?hospitalId=${encodeURIComponent(hospital.id)}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "ledger_failed");
        return response.json() as Promise<LedgerResponse>;
      })
      .then((rawLedger) => {
        if (cancelled) return;
        const ledger = normalizeLedgerResponse(rawLedger);
        setReports(ledger.reports);
        setTemplates(ledger.templates);
        setEvents(ledger.events);
        const hospitalDefault = ledger.templates.find((template) => template.isDefault);
        if (hospitalDefault && defaultAppliedHospital.current !== hospital.id) {
          defaultAppliedHospital.current = hospital.id;
          setConfig((current) => keepRuntimeValues(hospitalDefault.config, current));
          setTemplateName(hospitalDefault.name);
          setTemplateDescription(hospitalDefault.description);
          setTemplateAsDefault(true);
        }
      })
      .catch(() => { if (!cancelled) notify("报告台账加载失败，当前页面仍可预览但无法提交"); })
      .finally(() => { if (!cancelled) setLedgerLoading(false); });
    return () => { cancelled = true; };
  }, [hospital.id, notify, serverPersistence]);

  useEffect(() => {
    if (!serverPersistence || !canExport) return;
    let cancelled = false;
    fetch(`/api/report-artifacts?hospitalId=${encodeURIComponent(hospital.id)}`, { headers: { accept: "application/json" } })
      .then(async (response) => {
        const result = await response.json() as { artifacts?: ReportArtifact[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "artifact_list_failed");
        return result.artifacts ?? [];
      })
      .then((rows) => { if (!cancelled) setArtifacts(rows); })
      .catch(() => { if (!cancelled) notify("云端报告文件台账加载失败，可稍后重试"); })
      .finally(() => { if (!cancelled) setArtifactLoading(false); });
    return () => { cancelled = true; };
  }, [canExport, hospital.id, notify, serverPersistence]);

  function applyLedger(ledger: LedgerResponse) {
    const normalized = normalizeLedgerResponse(ledger);
    setReports(normalized.reports);
    setTemplates(normalized.templates);
    setEvents(normalized.events);
  }

  async function callReportApi(payload: Record<string, unknown>) {
    const response = await fetch("/api/benefit-reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, hospitalId: hospital.id }) });
    const result = await response.json() as { error?: string; reportId?: string; ledger?: LedgerResponse };
    if (!response.ok) throw new Error(result.error ?? "report_operation_failed");
    if (result.ledger) applyLedger(result.ledger);
    return result;
  }

  function addDemoEvent(reportId: string | null, action: string, detail: string) {
    setEvents((current) => [{ id: `demo-${Date.now()}-${Math.random()}`, reportId, actor: viewerName, action, detail, createdAt: new Date().toISOString() }, ...current]);
  }

  async function saveDraft(silent = false, draftConfig?: BenefitReportConfig) {
    if (!canManage) { notify("当前角色没有报告编制权限"); return null; }
    const baseReport = draftConfig ? null : currentReport;
    if (!draftConfig && currentReport && currentReport.status !== "draft") { notify("已提交版本不可覆盖，请先新建修订版本"); return null; }
    setBusyAction("save");
    try {
      const effectiveConfig = draftConfig ? applyPublicationRules(draftConfig, publishedData?.publication) : reportConfig;
      const effectiveModel = draftConfig
        ? buildBenefitReportModel(devices, hospital, effectiveConfig, dataSources, analysisProfiles, publishedData)
        : model;
      const effectiveQuality = draftConfig ? buildReportQuality(effectiveModel) : quality;
      const acknowledged = draftConfig ? false : warningAcknowledged;
      const snapshot = frozenPublishedReportSnapshot(effectiveModel, effectiveQuality);
      if (serverPersistence) {
        const result = await callReportApi({ action: "save_report", reportId: baseReport?.id, seriesId: baseReport?.seriesId, config: effectiveConfig, snapshot, qualityScore: effectiveQuality.score, blockingCount: effectiveQuality.blockers, warningCount: effectiveQuality.warnings, warningAcknowledged: acknowledged });
        if (result.reportId) setCurrentReportId(result.reportId);
        if (!silent) notify("报告草稿已保存到医院台账");
        return result.reportId ?? baseReport?.id ?? null;
      }
      const now = new Date().toISOString();
      const reportId = baseReport?.id ?? `demo-report-${Date.now()}`;
      const seriesId = baseReport?.seriesId ?? `demo-series-${Date.now()}`;
      const next: ReportRecordWithSnapshot = {
        id: reportId,
        hospitalId: hospital.id,
        seriesId,
        version: baseReport?.version ?? 1,
        status: "draft",
        title: effectiveConfig.title,
        period: effectiveConfig.period,
        scope: effectiveConfig.scope,
        config: effectiveConfig,
        snapshotJson: snapshot,
        qualityScore: effectiveQuality.score,
        blockingCount: effectiveQuality.blockers,
        warningCount: effectiveQuality.warnings,
        warningAcknowledged: acknowledged,
        reviewComment: "",
        createdBy: baseReport?.createdBy ?? viewerName,
        reviewedBy: "",
        approvedBy: "",
        submittedAt: null,
        reviewedAt: null,
        issuedAt: null,
        createdAt: baseReport?.createdAt ?? now,
        updatedAt: now,
      };
      setReports((current) => [next, ...current.filter((report) => report.id !== reportId)]);
      setCurrentReportId(reportId);
      addDemoEvent(reportId, baseReport ? "save_report" : "create_report", baseReport ? "更新报告草稿" : "创建报告草稿 V1");
      if (!silent) notify("演示草稿已保存；正式登录后会写入医院服务端台账");
      return reportId;
    } catch (error) {
      notify(workflowErrorMessage(error instanceof Error ? error.message : ""));
      return null;
    } finally {
      setBusyAction("");
    }
  }

  async function submitReport() {
    if (quality.blockers) { setTab("quality"); notify(`仍有 ${quality.blockers} 项阻断问题，暂不能提交`); return; }
    if (quality.warnings && !warningAcknowledged) { setTab("quality"); notify("请先确认已复核数据预警"); return; }
    const reportId = await saveDraft(true);
    if (!reportId) return;
    setBusyAction("submit");
    try {
      if (serverPersistence) await callReportApi({ action: "submit_report", reportId });
      else {
        const now = new Date().toISOString();
        setReports((current) => current.map((report) => report.id === reportId ? { ...report, status: "pending_review", submittedAt: now, updatedAt: now, warningAcknowledged } : report));
        addDemoEvent(reportId, "submit_report", "提交财务 / 运营复核");
      }
      notify("报告已提交复核，当前版本内容已冻结");
    } catch (error) {
      notify(workflowErrorMessage(error instanceof Error ? error.message : ""));
    } finally { setBusyAction(""); }
  }

  async function reviewReport(decision: "approve" | "reject") {
    if (!currentReport || currentReport.status !== "pending_review") return;
    if (snapshotUnavailable) { notify("冻结快照缺失，已阻止复核，请联系管理员核验报告版本"); return; }
    if (decision === "reject" && !reviewComment.trim()) { notify("退回时请填写复核意见"); return; }
    setBusyAction(decision);
    try {
      if (serverPersistence) await callReportApi({ action: "review_report", reportId: currentReport.id, decision, comment: reviewComment });
      else {
        const now = new Date().toISOString();
        setReports((current) => current.map((report) => report.id === currentReport.id ? { ...report, status: decision === "approve" ? "approved" : "rejected", reviewedBy: viewerName, reviewComment: reviewComment || "复核通过", reviewedAt: now, updatedAt: now } : report));
        addDemoEvent(currentReport.id, decision === "approve" ? "approve_report" : "reject_report", reviewComment || "复核通过");
      }
      setReviewComment("");
      notify(decision === "approve" ? "复核通过，报告已进入待签发" : "报告已退回，编制人可创建新版本修改");
    } catch (error) {
      notify(workflowErrorMessage(error instanceof Error ? error.message : ""));
    } finally { setBusyAction(""); }
  }

  async function issueReport() {
    if (!currentReport || currentReport.status !== "approved") return;
    if (snapshotUnavailable) { notify("冻结快照缺失，已阻止签发，请联系管理员核验报告版本"); return; }
    setBusyAction("issue");
    try {
      if (serverPersistence) await callReportApi({ action: "issue_report", reportId: currentReport.id });
      else {
        const now = new Date().toISOString();
        setReports((current) => current.map((report) => report.id === currentReport.id ? { ...report, status: "issued", approvedBy: viewerName, issuedAt: now, updatedAt: now } : report));
        addDemoEvent(currentReport.id, "issue_report", "签发正式报告并冻结快照");
      }
      notify("报告已正式签发并冻结快照");
    } catch (error) {
      notify(workflowErrorMessage(error instanceof Error ? error.message : ""));
    } finally { setBusyAction(""); }
  }

  async function createVersion() {
    if (!currentReport || currentReport.status === "draft") return;
    setBusyAction("version");
    try {
      if (serverPersistence) {
        const result = await callReportApi({ action: "create_version", reportId: currentReport.id });
        const next = result.ledger?.reports.find((report) => report.id === result.reportId);
        if (next && result.reportId) { setCurrentReportId(result.reportId); setConfig(next.config); }
      } else {
        const version = Math.max(...reports.filter((report) => report.seriesId === currentReport.seriesId).map((report) => report.version), currentReport.version) + 1;
        const now = new Date().toISOString();
        const next: ReportRecord = { ...currentReport, id: `demo-report-${Date.now()}`, version, status: "draft", config: currentReport.config, warningAcknowledged: false, reviewComment: "", createdBy: viewerName, reviewedBy: "", approvedBy: "", submittedAt: null, reviewedAt: null, issuedAt: null, createdAt: now, updatedAt: now };
        setReports((current) => [next, ...current]);
        setCurrentReportId(next.id);
        setConfig(next.config);
        addDemoEvent(next.id, "create_version", `基于 V${currentReport.version} 创建 V${version}`);
      }
      setWarningAcknowledged(false);
      notify("已创建可编辑的新版本，旧版本保持不变");
    } catch (error) {
      notify(workflowErrorMessage(error instanceof Error ? error.message : ""));
    } finally { setBusyAction(""); }
  }

  async function persistHospitalTemplate(
    name: string,
    description: string,
    templateConfig: BenefitReportConfig,
    isDefault: boolean,
  ) {
    if (!canManage) { notify("当前角色没有模板配置权限"); return false; }
    if (!name.trim()) { notify("请填写模板名称"); return false; }
    setBusyAction("template");
    try {
      if (serverPersistence) {
        await callReportApi({
          action: "save_template",
          templateName: name.trim(),
          templateDescription: description.trim(),
          templateIsDefault: isDefault,
          config: templateConfig,
        });
      }
      else {
        const next: ReportTemplate = { id: `demo-template-${Date.now()}`, hospitalId: hospital.id, name: name.trim(), description: description.trim(), config: templateConfig, isDefault, updatedAt: new Date().toISOString() };
        setTemplates((current) => [
          next,
          ...current
            .filter((template) => template.name !== name.trim())
            .map((template) => isDefault ? { ...template, isDefault: false } : template),
        ]);
        addDemoEvent(null, "save_template", `${isDefault ? "保存并设为默认" : "保存"}医院模板：${name.trim()}`);
      }
      notify(isDefault ? `已为${hospital.shortName}设为默认模板` : `已启用到${hospital.shortName}`);
      return true;
    } catch (error) {
      notify(workflowErrorMessage(error instanceof Error ? error.message : ""));
      return false;
    } finally { setBusyAction(""); }
  }

  async function saveTemplate() {
    const name = templateName.trim();
    const base = normalizeBenefitReportConfig(config);
    const templateConfig = normalizeBenefitReportConfig({
      ...base,
      deviceId: "",
      compiler: "",
      issueDate: "",
      template: {
        ...base.template,
        name,
        origin: "hospital",
        status: "published",
        version: base.template.origin === "hospital" ? nextHospitalTemplateVersion(base.template.version) : base.template.version,
        baseCode: base.template.origin === "platform" ? base.template.code : base.template.baseCode,
      },
    });
    const saved = await persistHospitalTemplate(name, templateDescription, templateConfig, templateAsDefault);
    if (saved) setConfig((current) => keepRuntimeValues(templateConfig, current));
  }

  function applyTemplate(template: ReportTemplate) {
    if (!editable) return notify("当前版本已冻结，请先创建新版本");
    setConfig((current) => {
      const merged = keepRuntimeValues(normalizeBenefitReportConfig(template.config), current);
      return {
        ...merged,
        deviceId: merged.scope === "device" ? merged.deviceId || devices[0]?.id || "" : merged.deviceId,
        deviceCategory: merged.scope === "category" ? merged.deviceCategory || deviceCategories[0] || "" : merged.deviceCategory,
      };
    });
    setTemplateName(template.name);
    setTemplateDescription(template.description);
    setTemplateAsDefault(template.isDefault);
    notify(`已应用模板“${template.name}”`);
  }

  function applyPlatformTemplate(template: PlatformReportTemplate) {
    if (!editable) return notify("当前版本已冻结，请先创建新版本");
    const next = buildPlatformTemplateConfig(template, config.period);
    setConfig((current) => {
      const merged = keepRuntimeValues(next, current);
      return {
        ...merged,
        deviceId: merged.scope === "device" ? merged.deviceId || devices[0]?.id || "" : merged.deviceId,
        deviceCategory: merged.scope === "category" ? merged.deviceCategory || deviceCategories[0] || "" : merged.deviceCategory,
      };
    });
    setTemplateName(`${template.shortName}（${hospital.shortName}）`);
    setTemplateDescription(`继承平台“${template.name}”V${template.version}，按${hospital.name}口径启用`);
    setTab("config");
    notify(`已将“${template.name}”应用到本次报告，请确认范围、成本口径和公共规则`);
  }

  async function adoptPlatformTemplate(template: PlatformReportTemplate, isDefault: boolean) {
    const platformConfig = buildPlatformTemplateConfig(template, config.period);
    const hospitalTemplateName = `${template.shortName}（${hospital.shortName}）`;
    const hospitalConfig = normalizeBenefitReportConfig({
      ...platformConfig,
      deviceId: "",
      deviceCategory: "",
      compiler: "",
      issueDate: "",
      template: {
        ...platformConfig.template,
        name: hospitalTemplateName,
        origin: "hospital",
        baseCode: template.code,
      },
    });
    const saved = await persistHospitalTemplate(
      hospitalTemplateName,
      `继承平台“${template.name}”V${template.version}；${template.selectionGuidance}`,
      hospitalConfig,
      isDefault,
    );
    if (saved && isDefault && editable) {
      setConfig((current) => {
        const merged = keepRuntimeValues(hospitalConfig, current);
        return {
          ...merged,
          deviceId: merged.scope === "device" ? merged.deviceId || devices[0]?.id || "" : merged.deviceId,
          deviceCategory: merged.scope === "category" ? merged.deviceCategory || deviceCategories[0] || "" : merged.deviceCategory,
        };
      });
    }
  }

  async function setHospitalDefault(template: ReportTemplate) {
    await persistHospitalTemplate(template.name, template.description, normalizeBenefitReportConfig(template.config), true);
  }

  function openReport(report: ReportRecord) {
    setCurrentReportId(report.id);
    setConfig(normalizeBenefitReportConfig(report.config));
    setWarningAcknowledged(report.warningAcknowledged);
    setReviewComment(report.reviewComment);
    setTab("preview");
  }

  async function generateMonthlyReport() {
    if (!canManage) { notify("当前角色没有报告编制权限"); return; }
    if (busyAction) return;
    const targetPeriod = resolveMonthlyReportPeriod(new Date(), reportPeriodOptions);
    const resolved = resolveMonthlyReportTemplate(templates, targetPeriod);
    if (!resolved) { notify("当前没有支持“月度 + 全院”的模板，请先在模板库启用运营绩效等月度模板"); return; }
    const existingDraft = reports.find((report) => report.status === "draft" && report.period === targetPeriod && report.config.template.code === resolved.config.template.code);
    if (existingDraft) { openReport(existingDraft); notify("已存在本期草稿，已为你打开"); return; }
    const draftConfig = normalizeBenefitReportConfig({
      ...resolved.config,
      title: `${hospital.shortName} ${targetPeriod} 设备效益月报`,
      period: targetPeriod,
      scope: "hospital",
      deviceId: "",
    }, targetPeriod);
    setConfig(draftConfig);
    setCurrentReportId("");
    setWarningAcknowledged(false);
    setReviewComment("");
    onPeriodChange(targetPeriod);
    setTab("config");
    const reportId = await saveDraft(true, draftConfig);
    if (reportId) notify(`已按${resolved.sourceLabel}生成 ${targetPeriod} 全院月报草稿，下一步：数据质检 → 提交复核 → 院级签发`);
  }

  async function logExport(format: "docx" | "csv", artifactHash = "", fileName = "") {
    if (serverPersistence) {
      try { await callReportApi({ action: "log_export", reportId: currentReport?.id, exportFormat: format, artifactHash, fileName }); }
      catch { notify("文件已生成，但导出留痕写入失败"); }
    } else addDemoEvent(currentReport?.id ?? null, "export_report", `导出 ${format === "csv" ? "CSV 明细" : "Word 报告"}`);
  }

  async function storeCloudArtifact(blob: Blob, fileName: string, sha256: string): Promise<CloudArtifactStoreResult> {
    if (!serverPersistence) return "demo";
    if (!currentReport?.id) return "unsaved";
    if (currentReport.status !== "issued") return "draft";
    if (!canApprove) return "issued_restricted";
    const contentType = fileName.endsWith(".csv")
      ? "text/csv"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const form = new FormData();
    form.append("hospitalId", hospital.id);
    form.append("reportId", currentReport.id);
    form.append("sha256", sha256);
    form.append("file", blob.type === contentType ? blob : new Blob([blob], { type: contentType }), fileName);
    const response = await fetch("/api/report-artifacts", { method: "POST", body: form });
    const result = await response.json() as { artifact?: ReportArtifact; error?: string };
    if (!response.ok || !result.artifact) throw new Error(result.error ?? "artifact_store_failed");
    setArtifacts((current) => [result.artifact!, ...current.filter((item) => item.id !== result.artifact!.id)]);
    return "stored";
  }

  function notifyArchiveResult(result: CloudArtifactStoreResult, label: string, issued: boolean) {
    if (result === "stored") {
      notify(issued ? `${label}已导出并归档为云端正式件` : `${label}已导出并归档到云端`);
    } else if (result === "demo") {
      notify(`${label}已下载；演示模式不会写入云端`);
    } else if (result === "unsaved") {
      notify(`${label}已下载；保存报告后才能归档到云端`);
    } else if (result === "draft") {
      notify(`${label}已下载；预览文件不进入正式云档案，签发后由签发角色归档`);
    } else {
      notify(`${label}已下载；正式件仅允许签发角色归档，未覆盖云端文件`);
    }
  }

  function updateConfig<K extends keyof BenefitReportConfig>(key: K, value: BenefitReportConfig[K]) {
    setConfig((current) => ({ ...current, [key]: value }));
  }

  function updateCommonRule<K extends keyof BenefitReportConfig["commonRules"]>(
    key: K,
    value: BenefitReportConfig["commonRules"][K],
  ) {
    setConfig((current) => ({ ...current, commonRules: { ...current.commonRules, [key]: value } }));
  }

  function updateScope(scope: BenefitReportConfig["scope"]) {
    setConfig((current) => ({
      ...current,
      scope,
      deviceId: scope === "device" ? current.deviceId || devices[0]?.id || "" : current.deviceId,
      deviceCategory: scope === "category" ? current.deviceCategory || deviceCategories[0] || "" : current.deviceCategory,
    }));
  }

  function toggleSection(id: ReportSectionId) {
    setConfig((current) => ({
      ...current,
      sections: current.sections.includes(id) ? current.sections.filter((section) => section !== id) : [...current.sections, id],
    }));
  }

  async function exportWord() {
    if (!canExport) return notify("当前角色没有报表导出权限");
    const issued = currentReport?.status === "issued";
    if (snapshotUnavailable) return notify("已提交报告的冻结快照缺失或损坏，已阻止导出，请联系管理员核验");
    const exportModel = model;
    if (!usesFrozenReportSnapshot && quality.blockers) { setTab("quality"); return notify("存在数据质量阻断项，暂不能导出"); }
    const frozenQualityScore = currentReport?.snapshotJson?.quality?.score;
    const exportQualityScore = usesFrozenReportSnapshot && Number.isFinite(frozenQualityScore)
      ? Number(frozenQualityScore)
      : quality.score;
    setExporting(true);
    try {
      const artifact = await exportBenefitReportDocx(exportModel, { statusLabel: currentReport ? reportStatusMeta[currentReport.status].label : "未保存", reportNumber: currentReport ? reportNumber(hospital, currentReport) : "尚未编号", version: currentReport?.version ?? 1, qualityScore: exportQualityScore, reviewedBy: currentReport?.reviewedBy, approvedBy: currentReport?.approvedBy, issuedAt: currentReport?.issuedAt });
      await logExport("docx", artifact.sha256, artifact.fileName);
      try {
        const archiveResult = await storeCloudArtifact(artifact.blob, artifact.fileName, artifact.sha256);
        notifyArchiveResult(archiveResult, issued ? "正式签发版" : "未签发预览版", issued);
      } catch (error) {
        notify(error instanceof Error && error.message === "issued_artifact_conflict"
          ? "正式签发版已下载；云端已存在该版本的不同正式件，已阻止覆盖"
          : "文件已下载，但云端归档失败，请联网后重新导出");
      }
    } catch (error) {
      notify(error instanceof Error ? `报告导出失败：${error.message}` : "报告导出失败");
    } finally {
      setExporting(false);
    }
  }

  async function exportDetailCsv() {
    if (!canExport) return notify("当前角色没有报表导出权限");
    const issued = currentReport?.status === "issued";
    if (snapshotUnavailable) return notify("已提交报告的冻结快照缺失或损坏，已阻止导出明细，请联系管理员核验");
    const exportModel = model;
    if (!usesFrozenReportSnapshot && quality.blockers) { setTab("quality"); return notify("存在数据质量阻断项，暂不能导出"); }
    const header = ["医院", "期间", "资产编号", "设备名称", "类别", "科室", "原值(万元)", "收入(万元)", `${exportModel.costLabel}(万元)`, "结余(万元)", "使用率", "可用率", "PM完成率", "综合评分", "评级"];
    const rows = exportModel.rows.map((row) => [exportModel.hospital.name, exportModel.config.period, row.device.assetCode, row.device.name, row.device.category ?? "未配置", row.device.department, row.device.investment, row.revenue.toFixed(1), row.cost.toFixed(1), row.net.toFixed(1), `${row.device.utilization}%`, row.hasInsight ? `${row.insight.availabilityRate}%` : "数据缺失", row.hasInsight ? `${row.insight.pmCompletionRate}%` : "数据缺失", row.hasInsight ? row.score.toFixed(1) : "数据缺失", row.grade]);
    const csv = [header, ...rows].map((row) => row.map((cell) => { const value = String(cell); const safe = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value; return `"${safe.replaceAll('"', '""')}"`; }).join(",")).join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const fileName = `${exportModel.hospital.shortName}-${exportModel.config.period}-设备效益明细${currentReport ? `-${reportNumber(hospital, currentReport)}-V${currentReport.version}-${reportStatusMeta[currentReport.status].label}` : "-未保存预览"}.csv`;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
    await logExport("csv", sha256, fileName);
    try {
      const archiveResult = await storeCloudArtifact(blob, fileName, sha256);
      notifyArchiveResult(archiveResult, "设备效益明细", issued);
    } catch (error) {
      notify(error instanceof Error && error.message === "issued_artifact_conflict"
        ? "CSV 已下载；云端已存在该版本的不同正式明细，已阻止覆盖"
        : "CSV 已下载，但云端归档失败，请联网后重新导出");
    }
  }

  return (
    <>
      <div className="page-heading report-page-heading">
        <div><div className="eyebrow"><FileCheck2 size={15} />医院级正式报告</div><h1>效益分析报告</h1><p>从数据质检、编制复核到院级签发形成完整证据链；正式版本冻结快照，导出与操作全程留痕。</p></div>
        <div className="heading-actions">{canManage ? <button className="secondary-button" disabled={!editable || busyAction === "save"} onClick={() => saveDraft()}><Save size={17} />{busyAction === "save" ? "保存中…" : "保存草稿"}</button> : null}<button className="secondary-button" onClick={() => setTab("templates")}><Archive size={17} />选择模板</button><button className="primary-button" disabled={exporting || !canExport} onClick={exportWord}><Download size={17} />{exporting ? "正在生成…" : currentReport?.status === "issued" ? "导出正式版" : "导出预览版"}</button></div>
      </div>

      {canManage ? (
        <section className={styles.monthlyLauncher} aria-label="一键月度报告">
          <div className={styles.monthlyAction}>
            <span><CalendarClock size={21} /></span>
            <div>
              <strong>一键生成月度报告</strong>
              <small>目标期间 {monthlyTargetPeriod} · 自动选用本院默认或月度模板，按全院范围生成草稿并直接进入编制</small>
            </div>
            <button className="primary-button" disabled={Boolean(busyAction)} onClick={generateMonthlyReport}><CalendarClock size={16} />一键生成月度报告</button>
          </div>
          <div className={styles.monthlyRhythm}>
            <Clock3 size={16} />
            <span><strong>月报节奏</strong><small>建议每月 5 日前完成上月报告，签发后自动归档。</small></span>
          </div>
        </section>
      ) : null}

      <section className="report-template-context" aria-label="当前医院与模板方案">
        <div><span>当前医院</span><strong>{hospital.name}</strong><small>{hospital.level} · {hospitalDefaultTemplate ? "已配置本院默认模板" : "使用平台模板，本院尚未设默认"}</small></div>
        <div><span>当前模板</span><strong>{config.template.name} <i>V{config.template.version}</i></strong><small>{config.template.categoryLabel} · {config.template.origin === "hospital" ? "医院适配" : "平台公共"}</small></div>
        <div><span>核心口径</span><strong>{model.costLabel}</strong><small>{scopeLabel(config, model.rows)} · {config.commonRules.standardServiceHoursPerDay} 小时/日</small></div>
        <div><span>数据准备度</span><strong>{activeSourceReadiness.ready}/{activeSourceReadiness.total || config.template.sourceRequirementIds.length}</strong><small>{activeSourceReadiness.pending} 待配置 · {activeSourceReadiness.manual} 人工来源</small></div>
        <button className="secondary-button" onClick={() => setTab("templates")}><Settings2 size={15} />查看方案</button>
      </section>

      <section className="report-command-bar" aria-label="报告生成条件">
        <label><span>报告期间</span><select disabled={!editable} value={config.period} onChange={(event) => { updateConfig("period", event.target.value); onPeriodChange(event.target.value); }}>{reportPeriodOptions.map((option) => <option disabled={!supportsPeriod(config, option)} key={option}>{option}</option>)}</select></label>
        <label><span>生成范围</span><select disabled={!editable} value={config.scope} onChange={(event) => updateScope(event.target.value as BenefitReportConfig["scope"])}><option value="hospital" disabled={!config.template.supportedScopes.includes("hospital")}>全院重点设备</option><option value="category" disabled={!config.template.supportedScopes.includes("category")}>同品类设备</option><option value="device" disabled={!config.template.supportedScopes.includes("device")}>单台设备</option></select></label>
        {config.scope === "category" ? <label className="report-device-filter"><span>设备品类</span><select disabled={!editable} value={config.deviceCategory || deviceCategories[0] || ""} onChange={(event) => updateConfig("deviceCategory", event.target.value)}>{deviceCategories.map((category) => <option value={category} key={category}>{category}</option>)}</select></label> : null}
        {config.scope === "device" ? <label className="report-device-filter"><span>分析设备</span><select disabled={!editable} value={config.deviceId || devices[0]?.id || ""} onChange={(event) => updateConfig("deviceId", event.target.value)}>{devices.map((device) => <option value={device.id} key={device.id}>{device.shortName}</option>)}</select></label> : null}
        <div className={`report-version ${quality.blockers ? "blocked" : "ready"}`}><i /><span>{currentReport ? `报告 V${currentReport.version} · ${reportStatusMeta[currentReport.status].label}` : "新报告 · 尚未保存"}</span><small>{quality.blockers ? `${quality.blockers} 项阻断 · ${quality.warnings} 项预警` : `质量 ${quality.score} 分 · ${quality.warnings} 项预警`}</small></div>
      </section>

      {snapshotUnavailable ? <section className="report-empty-scope"><CircleAlert size={24} /><div><strong>报告冻结快照缺失</strong><p>系统已阻止复核、签发和导出，避免使用当前设备数据替代已提交版本。请联系管理员核验报告存储。</p></div></section> : null}

      <section className="report-workflow-bar" aria-label="报告审批流程">
        <div className="report-workflow-identity"><span className={`report-status-badge status-${currentStatus}`}>{currentReport ? reportStatusMeta[currentReport.status].label : "未保存"}</span><div><strong>{currentReport ? `${hospital.code}-${currentReport.seriesId.slice(-8).toUpperCase()} · V${currentReport.version}` : "保存后自动生成报告编号"}</strong><small>{currentReport ? reportStatusMeta[currentReport.status].note : serverPersistence ? "将保存至当前医院服务端台账" : "演示模式仅保存在当前会话"}</small></div></div>
        <ol>{["编制草稿", "财务 / 运营复核", "院级待签发", "正式签发"].map((label, index) => <li className={index < currentStep ? "complete" : index === currentStep ? "active" : ""} key={label}><i>{index < currentStep ? <Check size={13} /> : index + 1}</i><span>{label}</span></li>)}</ol>
        <div className="report-workflow-actions">
          {canManage && (!currentReport || currentReport.status === "draft") ? <button className="primary-button" disabled={Boolean(busyAction)} onClick={submitReport}><Send size={15} />提交复核</button> : null}
          {canApprove && currentReport?.status === "approved" ? <button className="primary-button" disabled={Boolean(busyAction)} onClick={issueReport}><BadgeCheck size={15} />正式签发</button> : null}
          {canManage && currentReport && currentReport.status !== "draft" ? <button className="secondary-button" disabled={Boolean(busyAction)} onClick={createVersion}><RefreshCcw size={15} />新建修订版</button> : null}
          <button className="secondary-button" onClick={() => setTab("ledger")}><History size={15} />查看台账</button>
        </div>
      </section>

      {canReview && currentReport?.status === "pending_review" ? <section className="report-review-strip"><div><UserCheck size={18} /><span><strong>复核处理</strong><small>核对财务口径、数据截止时间与异常调整；退回时必须填写原因。</small></span></div><textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="填写复核意见；通过时可选，退回时必填" /><div><button className="secondary-button danger-button" disabled={Boolean(busyAction)} onClick={() => reviewReport("reject")}><XCircle size={15} />退回修改</button><button className="primary-button" disabled={Boolean(busyAction)} onClick={() => reviewReport("approve")}><UserCheck size={15} />复核通过</button></div></section> : null}

      <div className="report-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}><BookOpen size={16} />报告预览</button>
        <button role="tab" aria-selected={tab === "templates"} className={tab === "templates" ? "active" : ""} onClick={() => setTab("templates")}><Archive size={16} />模板库</button>
        <button role="tab" aria-selected={tab === "config"} className={tab === "config" ? "active" : ""} onClick={() => setTab("config")}><SlidersHorizontal size={16} />本次报告配置</button>
        <button role="tab" aria-selected={tab === "quality"} className={tab === "quality" ? "active" : ""} onClick={() => setTab("quality")}><ListChecks size={16} />数据质检{quality.blockers ? <i className="report-tab-count">{quality.blockers}</i> : null}</button>
        <button role="tab" aria-selected={tab === "ledger"} className={tab === "ledger" ? "active" : ""} onClick={() => setTab("ledger")}><History size={16} />流程与版本</button>
        <button role="tab" aria-selected={tab === "fields"} className={tab === "fields" ? "active" : ""} onClick={() => setTab("fields")}><TableProperties size={16} />字段与数据</button>
      </div>

      {tab === "preview" ? (
        <div className="report-preview-layout">
          <aside className="report-outline panel">
            <header><span><FileText size={18} /></span><div><strong>报告目录</strong><small>已选 {config.sections.length} / {reportSections.length} 个章节</small></div></header>
            <nav>{reportSections.map((section, index) => <button key={section.id} disabled={!config.sections.includes(section.id)} onClick={() => document.getElementById(`report-${section.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}><i>{index + 1}</i><span><strong>{section.label}</strong><small>{config.sections.includes(section.id) ? "已纳入" : "未纳入"}</small></span>{config.sections.includes(section.id) ? <Check size={14} /> : null}</button>)}</nav>
            <footer><button className="secondary-button" onClick={exportDetailCsv}><Download size={15} />导出明细 CSV</button></footer>
          </aside>

          <div className="report-paper">
            <header className="report-cover-mini">
              <span>勇虹医疗 · 设备效益管理平台</span>
              <h2>{config.title}</h2>
              <p>{hospital.name} · {config.period} · {scopeLabel(config, model.rows)} · {config.template.categoryLabel} V{config.template.version}</p>
              <div><span>编制部门<strong>{config.preparedBy || "待填写"}</strong></span><span>报告日期<strong>{config.issueDate || "待填写"}</strong></span><i className={`status-${currentStatus}`}>{currentReport ? reportStatusMeta[currentReport.status].label : "未保存"}</i></div>
            </header>

            {!model.rows.length ? <section className="report-empty-scope"><CircleAlert size={24} /><div><strong>当前条件没有匹配设备</strong><p>系统已停止生成内容，不会用其他设备替代。请调整最低纳入原值、切换单台范围或补充设备台账。</p></div><button className="secondary-button" onClick={() => setTab("config")}>调整条件</button></section> : null}

            <section className="report-status-grid">
              <div><span>纳入设备</span><strong>{model.rows.length}</strong><small>组 / 台（套）</small></div>
              <div><span>期间收入</span><strong>{number.format(model.totals.revenue)}</strong><small>万元</small></div>
              <div><span>期间结余</span><strong className={model.totals.net >= 0 ? "positive" : "negative"}>{number.format(model.totals.net)}</strong><small>万元</small></div>
              <div><span>综合评分</span><strong>{model.overallScore.toFixed(1)}</strong><small>{model.grade} · 五维评价</small></div>
            </section>

            {config.sections.includes("summary") ? <section className="report-paper-section" id="report-summary"><h3>一、报告摘要</h3><div className="report-findings"><article><strong>重点发现</strong>{model.keyFindings.map((item) => <p key={item}><CheckCircle2 size={15} />{item}</p>)}</article><article className="warning"><strong>管理问题</strong>{model.issues.slice(0, 3).map((issue) => <p key={`${issue.device}-${issue.type}`}><CircleAlert size={15} />{issue.device}：{issue.type}</p>)}</article></div></section> : null}

            {config.sections.includes("scope") ? (
              <section className="report-paper-section" id="report-scope">
                <h3>二、范围与数据来源</h3>
                <div className="report-scope-note"><strong>分析口径</strong><span>{scopeLabel(config, model.rows)}；原值不低于 {config.minimumInvestment} 万元</span><span>成本口径：{model.costLabel}</span><span>报告期间：{config.period}</span><span>采集规则：{model.analysisProfileCoverage.enabled}/{model.analysisProfileCoverage.total} 个相关品类已启用</span></div>
                <div className="report-table-wrap"><table className="report-table"><thead><tr><th>数据来源</th><th>主要字段</th><th>状态</th></tr></thead><tbody>{model.dataSources.slice(0, 6).map((source) => <tr key={source.name}><td><strong>{source.name}</strong><small>{source.category}</small></td><td>{source.fields}</td><td>{source.status}</td></tr>)}</tbody></table></div>
              </section>
            ) : null}

            {config.sections.includes("inventory") ? (
              <section className="report-paper-section" id="report-inventory">
                <h3>三、设备基本情况</h3>
                <div className="report-table-wrap"><table className="report-table"><thead><tr><th>设备</th><th>类别 / 厂家</th><th>资产编号 / SN</th><th>科室 / 地点</th><th>启用日期</th><th>原值</th></tr></thead><tbody>{model.rows.map((row) => <tr key={row.device.id}><td><strong>{row.device.shortName}</strong><small>{row.device.model}</small></td><td>{row.device.category ?? "未配置"}<small>{row.device.manufacturer ?? "未配置"}</small></td><td>{row.device.assetCode}<small>{row.device.serialNumber ?? "未配置"}</small></td><td>{row.device.department}<small>{row.device.location ?? "未配置"}</small></td><td>{row.device.enabledDate}</td><td>{row.device.investment.toFixed(1)}万</td></tr>)}</tbody></table></div>
              </section>
            ) : null}

            {config.sections.includes("economic") ? <section className="report-paper-section" id="report-economic"><h3>四、经济效益与回收</h3><div className="report-table-wrap"><table className="report-table"><thead><tr><th>设备</th><th>收入</th><th>{model.costLabel}</th><th>结余</th><th>使用率</th><th>回收期</th></tr></thead><tbody>{model.rows.map((row) => <tr key={row.device.id}><td><strong>{row.device.shortName}</strong><small>{row.device.department}</small></td><td>{row.revenue.toFixed(1)}万</td><td>{row.cost.toFixed(1)}万</td><td className={row.net >= 0 ? "positive" : "negative"}>{row.net.toFixed(1)}万</td><td>{row.device.utilization}%</td><td>{row.payback ? `${row.payback.toFixed(1)}年` : "不可回收"}</td></tr>)}</tbody></table></div></section> : null}

            {config.sections.includes("efficiency") ? (
              <section className="report-paper-section" id="report-efficiency">
                <h3>五、使用效率分析</h3>
                <div className="report-table-wrap"><table className="report-table"><thead><tr><th>设备</th><th>使用率</th><th>开机率</th><th>负荷率</th><th>有效时长</th><th>预约 / 现场等待</th></tr></thead><tbody>{model.rows.map((row) => <tr key={row.device.id}><td>{row.device.shortName}</td><td>{row.device.utilization}%</td><td>{row.hasInsight ? `${row.insight.uptimeRate}%` : "数据缺失"}</td><td>{row.hasInsight ? `${row.insight.loadRate}%` : "数据缺失"}</td><td>{row.hasInsight ? `${row.insight.activeHours}小时/日` : "数据缺失"}</td><td>{row.hasInsight ? `${row.insight.appointmentWaitDays}天 / ${row.insight.onSiteWaitMinutes}分钟` : "数据缺失"}</td></tr>)}</tbody></table></div>
              </section>
            ) : null}

            {config.sections.includes("quality") ? (
              <section className="report-paper-section" id="report-quality">
                <h3>六、质量安全与设备保障</h3>
                <div className="report-reliability-summary"><span><ShieldCheck size={17} />设备可用率<strong>{model.dataBoundary.formalConclusionEligible ? `${model.totals.avgAvailability.toFixed(1)}%` : "数据缺失"}</strong></span><span><ClipboardCheck size={17} />PM完成率<strong>{model.dataBoundary.formalConclusionEligible ? `${model.totals.avgPm.toFixed(1)}%` : "数据缺失"}</strong></span><span><Database size={17} />平均使用率<strong>{model.totals.avgUtilization.toFixed(1)}%</strong></span></div>
                <div className="report-table-wrap"><table className="report-table"><thead><tr><th>设备</th><th>质控合格率</th><th>可用率</th><th>故障率</th><th>停机</th><th>MTTR</th></tr></thead><tbody>{model.rows.map((row) => <tr key={row.device.id}><td>{row.device.shortName}</td><td>{row.hasInsight ? `${row.insight.reportQualityRate}%` : "数据缺失"}</td><td>{row.hasInsight ? `${row.insight.availabilityRate}%` : "数据缺失"}</td><td>{row.hasInsight ? `${row.insight.failuresPer1000Hours}次/千小时` : "数据缺失"}</td><td>{row.hasInsight ? `${row.insight.downtimeHours}小时` : "数据缺失"}</td><td>{row.hasInsight ? `${row.insight.mttrHours}小时` : "数据缺失"}</td></tr>)}</tbody></table></div>
              </section>
            ) : null}

            {config.sections.includes("social") ? (
              <section className="report-paper-section" id="report-social"><h3>七、社会效益</h3><div className="report-note-list"><p><strong>服务可及性</strong>通过预约等待、现场等待、服务人次与跨院转诊变化评价。</p><p><strong>临床能力</strong>记录新增技术、新项目、复杂病例支持及 DRG/DIP 病组贡献。</p><p><strong>教学与应急</strong>记录科研课题、培训带教、应急调配和重大保障等非财务产出。</p></div></section>
            ) : null}

            {config.sections.includes("lifecycle") ? (
              <section className="report-paper-section" id="report-lifecycle"><h3>八、配置与全生命周期</h3><div className="report-table-wrap"><table className="report-table"><thead><tr><th>设备</th><th>资金来源</th><th>预计年限</th><th>折旧方法</th><th>维保 / 监测状态</th><th>配置建议</th></tr></thead><tbody>{model.rows.map((row) => <tr key={row.device.id}><td>{row.device.shortName}</td><td>{row.device.fundingSource ?? "未配置"}</td><td>{row.device.usefulLifeYears ?? "未配置"}年</td><td>{row.device.depreciationMethod ?? "未配置"}</td><td>{row.device.maintenanceStatus ?? "未配置"}<small>{row.device.monitoringStatus ?? "未配置"}</small></td><td>{row.device.utilization >= 80 ? "保障运行，跟踪扩容阈值" : row.net < 0 ? "限期整改，评估调配或处置" : "优化共享，半年后复评"}</td></tr>)}</tbody></table></div></section>
            ) : null}

            {config.sections.includes("evaluation") ? <section className="report-paper-section" id="report-evaluation"><h3>九、综合评价</h3><div className="report-dimension-grid">{model.scoreRows.map((item) => <div key={item.label}><span>{item.label}<strong>{item.score.toFixed(0)}</strong></span><i><b style={{ width: `${item.score}%` }} /></i><small>权重 {item.weight}% · 加权 {item.weighted.toFixed(1)}</small></div>)}</div></section> : null}

            {config.sections.includes("issues") ? <section className="report-paper-section" id="report-issues"><h3>十、问题清单与整改计划</h3><div className="report-table-wrap"><table className="report-table issue-table"><thead><tr><th>设备</th><th>问题</th><th>具体表现</th><th>责任部门</th><th>时限</th></tr></thead><tbody>{model.issues.map((issue) => <tr key={`${issue.device}-${issue.type}`}><td>{issue.device}</td><td><span className={`report-priority priority-${issue.priority}`}>{issue.priority}</span>{issue.type}</td><td>{issue.evidence}</td><td>{issue.owner}</td><td>{issue.due}</td></tr>)}</tbody></table></div></section> : null}

            {config.sections.includes("conclusion") ? <section className="report-paper-section report-conclusion" id="report-conclusion"><h3>十一、结论与建议</h3>{model.recommendations.map((item, index) => <p key={item}><i>{index + 1}</i>{item}</p>)}<footer><span>编制：{config.compiler || "—"}</span><span>审核：{config.reviewer || "—"}</span></footer></section> : null}

            {config.sections.includes("appendix") ? (
              <section className="report-paper-section" id="report-appendix">
                <h3>十二、指标与口径附录</h3>
                <div className="report-version-banner"><ShieldCheck size={16} /><span>医院指标模板：{config.commonRules.hospitalMetricTemplateVersion ?? HOSPITAL_METRIC_CATALOG_VERSION}<small>与报告一同冻结，历史报告不随之后的口径修改而漂移。</small></span></div>
                <h4>字段覆盖情况</h4>
                <div className="report-table-wrap"><table className="report-table"><thead><tr><th>数据域</th><th>字段数</th><th>已覆盖</th><th>首选来源</th><th>待补内容</th></tr></thead><tbody>{reportFieldDomains.map((item) => <tr key={item.domain}><td>{item.domain}</td><td>{item.fields}</td><td>{item.covered}</td><td>{item.source}</td><td>{item.additions}</td></tr>)}</tbody></table></div>
                <h4>医院关注指标口径快照</h4>
                <div className="report-table-wrap"><table className="report-table"><thead><tr><th>原表</th><th>指标</th><th>公式 / 分母</th><th>状态</th><th>口径控制</th></tr></thead><tbody>{hospitalMetricCatalog.map((metric) => <tr key={metric.code}><td>{metric.sourceItem}</td><td><strong>{metric.name}</strong><small>{metric.code}</small></td><td><code>{metric.formula}</code><small>分母：{metric.denominator}</small></td><td>{metric.readiness === "ready" ? "首批核心" : metric.readiness === "configure" ? "配置后启用" : "暂缓展示"}<small>{metric.evidence === "direct" ? "资料直接依据" : metric.evidence === "partial" ? "部分相关依据" : metric.evidence === "industry" ? "行业补充依据" : "依据待补"}</small></td><td>{metric.validation}</td></tr>)}</tbody></table></div>
                <h4>采集、设备绑定与对账规则快照</h4>
                <div className="report-table-wrap"><table className="report-table"><thead><tr><th>设备品类</th><th>状态</th><th>设备身份绑定</th><th>质量与对账阈值</th><th>使用率分母</th></tr></thead><tbody>{model.analysisProfiles.map((profile) => <tr key={profile.id}><td><strong>{profile.category}</strong><small>{profile.sourceSystems.join("、")}</small></td><td>{profile.status}<small>{profile.effectiveDate}</small></td><td>{profile.deviceIdentityBinding}</td><td>完整率≥{profile.completenessThreshold}%<small>绑定率≥{profile.bindingRateThreshold}% · 差异≤{profile.reconciliationTolerance}%</small></td><td>{profile.utilizationDenominator}</td></tr>)}</tbody></table></div>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "templates" ? (
        <div className="report-template-center">
          <section className="panel template-current-plan">
            <div>
              <span className="eyebrow"><Archive size={15} />当前生效方案</span>
              <h2>{hospital.name}使用“{config.template.categoryLabel}”</h2>
              <p>{config.template.name} V{config.template.version} · {config.template.origin === "hospital" ? "医院适配方案" : "平台公共方案"} · {model.costLabel}</p>
            </div>
            <dl>
              <div><dt>分析对象</dt><dd>{config.template.supportedScopes.map((item) => templateScopeLabels[item]).join("、")}</dd></div>
              <div><dt>支持周期</dt><dd>{config.template.supportedPeriods.join("、")}</dd></div>
              <div><dt>逻辑数据包</dt><dd>{config.template.sourceRequirementIds.length} 类</dd></div>
              <div><dt>本院默认</dt><dd>{hospitalDefaultTemplate?.name ?? "尚未指定"}</dd></div>
            </dl>
            {onOpenSources ? <button className="secondary-button" onClick={onOpenSources}><Database size={15} />配置数据映射</button> : null}
          </section>

          <section className="panel template-governance-note">
            <div><ShieldCheck size={20} /><span><strong>模板治理规则</strong><small>平台模板定义公共章节、字段包和计算口径；医院只保存本地覆盖项与默认分配；本次报告再填写期间、设备和责任人。新增 PDF / Word 先形成待确认草案，试算通过后才启用。</small></span></div>
            <div className="template-inheritance-flow"><span>平台公共底座</span><i>→</i><span>模板分类方案</span><i>→</i><span>医院适配与默认</span><i>→</i><span>报告实例快照</span></div>
          </section>

          <section className="template-filter-bar" aria-label="模板分类筛选">
            <div><strong>按报告用途分类</strong><small>医院等级、设备品类和数据成熟度作为适用条件，不直接复制成模板。</small></div>
            <nav><button className={templateCategoryFilter === "all" ? "active" : ""} onClick={() => setTemplateCategoryFilter("all")}>全部</button>{templateCategories.map((category) => <button className={templateCategoryFilter === category.id ? "active" : ""} key={category.id} onClick={() => setTemplateCategoryFilter(category.id)}>{category.name}</button>)}</nav>
          </section>

          <div className="platform-template-grid">
            {!filteredPlatformTemplates.length ? <div className="panel template-empty-catalog"><Archive size={28} /><strong>该分类尚无已发布模板</strong><p>后续新增 PDF / Word 会先进入该分类的待确认草案，完成字段、公式、数据来源和试算校验后再发布。</p></div> : null}
            {filteredPlatformTemplates.map((template) => {
              const category = templateCategories.find((item) => item.id === template.categoryId);
              const matches = template.sourceRequirements.map((item) => {
                const matched = sourceMatch(item.sourceId);
                return { ...item, requirement: matched?.requirement, match: matched?.match };
              });
              const ready = matches.filter((item) => model.publishedFileCoverage.mode === "published" ? model.publishedFileCoverage.statusByRequirement[item.sourceId] : item.match?.status === "已连接").length;
              const requiredMissing = matches.filter((item) => item.criticality === "required" && !(model.publishedFileCoverage.mode === "published" ? model.publishedFileCoverage.statusByRequirement[item.sourceId] : item.match?.status === "已连接")).length;
              const isCurrent = activePlatformTemplate?.code === template.code;
              return (
                <article className={`platform-template-card ${isCurrent ? "current" : ""}`} key={template.id}>
                  <header><span>{category?.name ?? "未分类"}</span><i>{template.status === "active" ? "已发布" : "待验证"}</i></header>
                  <div className="template-card-title"><div><h3>{template.name}</h3><p>{template.code} · V{template.version}</p></div>{isCurrent ? <b><Check size={13} />当前</b> : null}</div>
                  <p className="template-card-summary">{template.summary}</p>
                  <div className="template-card-tags">
                    <span>{template.supportedScopes.map((item) => templateScopeLabels[item]).join(" / ")}</span>
                    <span>{template.supportedPeriods.map((item) => templatePeriodLabels[item]).join(" / ")}</span>
                    <span>{template.costScope === "non_personnel" ? "非人员成本" : "全成本"}</span>
                  </div>
                  <div className="template-readiness">
                    <div><span>本院数据准备度</span><strong>{ready}/{matches.length}</strong></div>
                    <i><b style={{ width: `${matches.length ? ready / matches.length * 100 : 0}%` }} /></i>
                    <small>{requiredMissing ? `${requiredMissing} 个必需文件包尚未发布，启用前需确认映射或受控补录。` : "必需文件包已有发布快照，仍需核对字段口径。"}</small>
                  </div>
                  {template.referenceDocument ? <div className="template-reference"><FileText size={15} /><span><strong>{template.referenceDocument.name}</strong><small>{template.referenceDocument.note}</small></span></div> : null}
                  <footer>
                    <button className="secondary-button" disabled={!editable} onClick={() => applyPlatformTemplate(template)}>应用到本次</button>
                    {canManage ? <button className="secondary-button" disabled={busyAction === "template"} onClick={() => adoptPlatformTemplate(template, false)}>启用到本院</button> : null}
                    {canManage ? <button className="primary-button" disabled={busyAction === "template"} onClick={() => adoptPlatformTemplate(template, true)}>设为本院默认</button> : null}
                  </footer>
                </article>
              );
            })}
          </div>

          <section className="panel hospital-template-assignments">
            <div className="panel-heading"><div><h3>本院已启用方案</h3><p>这里明确记录“哪家医院用哪个分类和版本”；默认方案会用于该医院新建报告。</p></div><span className="page-badge"><Archive size={15} />{templates.length} 个方案</span></div>
            {templates.length ? <div className="hospital-template-table">
              {templates.map((template) => <article key={template.id}><div><strong>{template.name}{template.isDefault ? <i>本院默认</i> : null}</strong><small>{template.config.template.categoryLabel} · V{template.config.template.version} · {template.config.costScope === "non_personnel" ? "非人员成本" : "全成本"}</small></div><p>{template.description || "医院适配配置"}</p><span>{displayTime(template.updatedAt)}</span><div><button className="secondary-button compact-button" disabled={!editable} onClick={() => applyTemplate(template)}>应用</button>{canManage && !template.isDefault ? <button className="secondary-button compact-button" disabled={busyAction === "template"} onClick={() => setHospitalDefault(template)}>设默认</button> : null}</div></article>)}
            </div> : <div className="report-ledger-empty compact"><Archive size={25} /><strong>本院尚未启用模板</strong><p>从上方平台模板选择“启用到本院”或“设为本院默认”。</p></div>}
          </section>
        </div>
      ) : null}

      {tab === "config" ? (
        <div className="report-config-layout">
          <section className="panel report-config-card">
            <div className="panel-heading"><div><h3>报告基本信息</h3><p>这些信息会进入 Word 封面和签发区。</p></div><FileText size={20} /></div>
            <fieldset className="report-config-fields" disabled={!editable}><label>报告标题<input value={config.title} onChange={(event) => updateConfig("title", event.target.value)} /></label><label>编制部门<input value={config.preparedBy} onChange={(event) => updateConfig("preparedBy", event.target.value)} /></label><label>编制人<input value={config.compiler} onChange={(event) => updateConfig("compiler", event.target.value)} /></label><label>审核人 / 部门<input value={config.reviewer} onChange={(event) => updateConfig("reviewer", event.target.value)} /></label><label>报告日期<input type="date" value={config.issueDate} onChange={(event) => updateConfig("issueDate", event.target.value)} /></label></fieldset>
          </section>
          <section className="panel report-config-card report-common-config">
            <div className="panel-heading"><div><h3>公共口径与计算规则</h3><p>同一模板类别共同继承；医院适配时可在授权范围内覆盖。</p></div><Settings2 size={20} /></div>
            <div className="template-config-origin"><span>{config.template.categoryLabel}</span><strong>{config.template.name} V{config.template.version}</strong><small>{config.template.sourceDocument || "平台公共配置"} · {config.template.origin === "hospital" ? "医院适配" : "平台继承"}</small></div>
            <fieldset className="report-config-fields" disabled={!editable}>
              <label>成本核算口径<select value={config.costScope} onChange={(event) => updateConfig("costScope", event.target.value as BenefitReportConfig["costScope"])}><option value="full">全成本（含人工）</option><option value="non_personnel">非人员成本</option></select></label>
              <label>使用率复核标准时长（小时/日）<input type="number" min="1" max="24" value={config.commonRules.standardServiceHoursPerDay} onChange={(event) => updateCommonRule("standardServiceHoursPerDay", Number(event.target.value))} /></label>
              <label>月度数据截止日<input type="number" min="1" max="28" value={config.commonRules.dataCutoffDay} onChange={(event) => updateCommonRule("dataCutoffDay", Number(event.target.value))} /></label>
              <label>缺失值处理<select value={config.commonRules.missingValuePolicy} onChange={(event) => updateCommonRule("missingValuePolicy", event.target.value as BenefitReportConfig["commonRules"]["missingValuePolicy"])}><option value="block">缺失即阻断</option><option value="warn">允许预警披露</option><option value="manual_with_reason">说明原因后受控补录</option></select></label>
              {config.commonRules.missingValuePolicy === "manual_with_reason" ? <>
                <label>受控补录责任人<input value={config.commonRules.manualDataOwner} onChange={(event) => updateCommonRule("manualDataOwner", event.target.value)} /></label>
                <label>受控补录原因<input value={config.commonRules.manualDataReason} onChange={(event) => updateCommonRule("manualDataReason", event.target.value)} /></label>
                <label>佐证材料说明<input value={config.commonRules.manualDataEvidence} onChange={(event) => updateCommonRule("manualDataEvidence", event.target.value)} /></label>
              </> : null}
            </fieldset>
          </section>
          <section className="panel report-config-card">
            <div className="panel-heading"><div><h3>分析阈值</h3><p>阈值同时影响纳入范围、问题识别与评价建议。</p></div><SlidersHorizontal size={20} /></div>
            <fieldset className="report-config-fields" disabled={!editable}><label>最低纳入原值（万元）<input type="number" min="0" value={config.minimumInvestment} onChange={(event) => updateConfig("minimumInvestment", Number(event.target.value))} /></label><label>良好使用率管理线（%）<input type="number" min="0" max="100" value={config.goodUtilization} onChange={(event) => updateConfig("goodUtilization", Number(event.target.value))} /></label><label>回本年限预警线（年）<input type="number" min="1" value={config.warningPaybackYears} onChange={(event) => updateConfig("warningPaybackYears", Number(event.target.value))} /></label></fieldset>
            <div className="report-formula-note"><CircleAlert size={16} />会计结余用于经营评价；回收期应优先使用现金贡献，正式出具前需由财务复核。</div>
          </section>
          <section className="panel report-section-config">
            <div className="panel-heading"><div><h3>报告章节</h3><p>按本次汇报对象选择需要生成的章节。</p></div><span className="chart-note">已选 {config.sections.length} 项</span></div>
            <div className="report-section-list">{reportSections.map((section) => <label className={config.sections.includes(section.id) ? "checked" : ""} key={section.id}><input type="checkbox" disabled={!editable} checked={config.sections.includes(section.id)} onChange={() => toggleSection(section.id)} /><span><strong>{section.label}</strong><small>{section.id === "economic" ? `收入、${model.costLabel}、结余、ROI 与漏费` : section.note}</small></span><Check size={16} /></label>)}</div>
          </section>
          <section className="panel report-template-config">
            <div className="panel-heading"><div><h3>保存为医院适配方案</h3><p>保存模板分类、公共口径、章节、阈值与数据要求；不带本次设备、编制人和报告日期。</p></div><Archive size={20} /></div>
            <div className="report-template-save">
              <label>方案名称<input disabled={!editable} value={templateName} onChange={(event) => setTemplateName(event.target.value)} /></label>
              <label>适配说明<input disabled={!editable} value={templateDescription} onChange={(event) => setTemplateDescription(event.target.value)} /></label>
              <label className="template-default-check"><input type="checkbox" disabled={!editable} checked={templateAsDefault} onChange={(event) => setTemplateAsDefault(event.target.checked)} /><span>设为 {hospital.shortName} 新建报告的默认模板</span></label>
              <button className="primary-button" disabled={!editable || busyAction === "template"} onClick={saveTemplate}><Save size={16} />保存医院方案</button>
            </div>
            <div className="report-template-list">{templates.length ? templates.map((template) => <article key={template.id}><div><strong>{template.name}{template.isDefault ? <i>本院默认</i> : null}</strong><small>{template.config.template.categoryLabel} · V{template.config.template.version} · {displayTime(template.updatedAt)}</small></div><button className="secondary-button" disabled={!editable} onClick={() => applyTemplate(template)}>应用</button></article>) : <p>尚未保存医院适配方案，可先到“模板库”启用平台模板。</p>}</div>
          </section>
        </div>
      ) : null}

      {tab === "quality" ? (
        <div className="report-quality-layout">
          <section className="report-quality-score panel"><div className={`quality-score-ring ${quality.blockers ? "blocked" : "ready"}`} style={{ "--quality-score": quality.score } as CSSProperties}><strong>{quality.score}</strong><span>可信度</span></div><div><span className="eyebrow"><ListChecks size={15} />签发前数据门禁</span><h2>{quality.blockers ? "当前报告暂不能提交" : "已通过硬性门禁"}</h2><p>安全合规、设备唯一标识、财务口径和分析范围是硬门槛；经济效益再高也不能抵消安全风险。</p></div><div className="quality-counts"><span><strong>{quality.blockers}</strong>阻断</span><span><strong>{quality.warnings}</strong>预警</span><span><strong>{quality.passed}</strong>通过</span></div></section>
          <section className="panel report-quality-checks"><div className="panel-heading"><div><h3>检查结果</h3><p>每次保存都会把检查结果与计算快照一并固化到当前版本。</p></div><span className={`page-badge ${quality.blockers ? "warning" : ""}`}>{quality.blockers ? <CircleAlert size={15} /> : <ShieldCheck size={15} />}{quality.blockers ? "需要处理" : "允许提交"}</span></div><div className="quality-check-list">{quality.checks.map((check) => <article className={`quality-${check.level}`} key={check.id}><span>{check.level === "passed" ? <CheckCircle2 size={18} /> : check.level === "warning" ? <CircleAlert size={18} /> : <XCircle size={18} />}</span><div><small>{check.domain}</small><strong>{check.label}</strong><p>{check.detail}</p></div><div className="quality-check-action"><i>{check.level === "passed" ? "通过" : check.level === "warning" ? "预警" : "阻断"}</i>{check.level !== "passed" && ["identity", "safety", "insight-lineage"].includes(check.id) && onOpenEquipment ? <button onClick={onOpenEquipment}>去设备台账</button> : null}{["sources", "collection-profiles"].includes(check.id) && onOpenSources ? <button onClick={onOpenSources}>去数据口径</button> : null}</div></article>)}</div></section>
          <section className={`report-warning-ack panel ${warningAcknowledged ? "acknowledged" : ""}`}><div><ClipboardCheck size={20} /><span><strong>人工与待发布文件复核确认</strong><small>确认仅表示已核对来源、截止时间和调整原因，不会把预警改成“已发布事实”。</small></span></div><label><input type="checkbox" disabled={!editable || !quality.warnings} checked={warningAcknowledged} onChange={(event) => setWarningAcknowledged(event.target.checked)} /><span>{warningAcknowledged ? "已确认本版本预警" : quality.warnings ? "我已复核上述预警并接受披露" : "当前没有需要确认的预警"}</span></label></section>
        </div>
      ) : null}

      {tab === "ledger" ? (
        <div className="report-ledger-layout">
          <section className="report-readiness-summary"><div><span>我的草稿</span><strong>{reports.filter((report) => report.status === "draft").length}</strong><small>可继续编辑</small></div><div><span>待复核</span><strong>{reports.filter((report) => report.status === "pending_review").length}</strong><small>等待财务 / 运营处理</small></div><div><span>待签发</span><strong>{reports.filter((report) => report.status === "approved").length}</strong><small>等待院级确认</small></div><div><span>已签发</span><strong>{reports.filter((report) => report.status === "issued").length}</strong><small>正式冻结版本</small></div></section>
          <section className="panel report-ledger-table"><div className="panel-heading"><div><h3>医院报告台账</h3><p>已提交版本不可覆盖；退回或签发后通过“新建修订版”继续完善。</p></div><span className="page-badge"><FileClock size={15} />{ledgerLoading ? "加载中" : `${reports.length} 个版本`}</span></div>{reports.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>报告 / 版本</th><th>期间与范围</th><th>数据质量</th><th>状态</th><th>责任链</th><th>更新时间</th><th /></tr></thead><tbody>{reports.map((report) => <tr key={report.id} className={report.id === currentReportId ? "selected-row" : ""}><td><strong>{report.title}</strong><small>{reportNumber(hospital, report)} · V{report.version}</small></td><td>{report.period}<small>{report.scope === "hospital" ? "全院重点设备" : report.scope === "category" ? `设备品类：${report.config.deviceCategory || "未指定"}` : "单台设备"}</small></td><td><span className={`quality-mini ${report.blockingCount ? "blocked" : "ready"}`}>{report.qualityScore} 分</span><small>{report.blockingCount} 阻断 · {report.warningCount} 预警</small></td><td><span className={`report-status-badge status-${report.status}`}>{reportStatusMeta[report.status].label}</span></td><td>{report.createdBy}<small>{report.reviewedBy ? `复核：${report.reviewedBy}` : "尚未复核"}{report.approvedBy ? ` · 签发：${report.approvedBy}` : ""}</small></td><td>{displayTime(report.updatedAt)}</td><td><button className="secondary-button compact-button" onClick={() => openReport(report)}>打开</button></td></tr>)}</tbody></table></div> : <div className="report-ledger-empty"><FileText size={28} /><strong>当前医院还没有报告版本</strong><p>配置本次报告后点击“保存草稿”，即可进入医院台账。</p></div>}</section>
          {serverPersistence && canExport ? (
            <section className="panel report-artifact-ledger">
              <div className="panel-heading"><div><h3>云端报告文件</h3><p>每个文件均标明报告号、版本和签发状态，正式件不会被不同内容覆盖。</p></div><span className="page-badge"><Archive size={15} />{artifactLoading ? "加载中" : `${artifacts.length} 个文件`}</span></div>
              {artifacts.length ? (
                <div className="report-artifact-list">{artifacts.map((artifact) => {
                  const linkedReport = reports.find((report) => report.id === artifact.reportId);
                  return <article key={artifact.id}><span className="source-icon"><FileText size={17} /></span><div><strong>{artifact.fileName}</strong><small>{linkedReport ? `${reportNumber(hospital, linkedReport)} · V${linkedReport.version} · ${reportStatusMeta[linkedReport.status].label}` : "历史文件 · 未关联有效报告版本"}</small><small>{displayFileSize(artifact.sizeBytes)} · {displayTime(artifact.createdAt)} · SHA-256 {artifact.sha256.slice(0, 12)}…</small></div><a className="secondary-button compact-button" href={`/api/report-artifacts?hospitalId=${encodeURIComponent(hospital.id)}&artifactId=${encodeURIComponent(artifact.id)}`}><Download size={14} />下载</a></article>;
                })}</div>
              ) : <div className="report-ledger-empty compact"><Archive size={25} /><strong>还没有云端文件</strong><p>保存报告后导出 Word 或 CSV，文件会自动出现在这里。</p></div>}
            </section>
          ) : null}
          <div className="report-ledger-bottom"><section className="panel"><div className="panel-heading"><div><h3>审批与导出记录</h3><p>记录谁在什么时间对哪个版本做了什么操作。</p></div><Clock3 size={19} /></div><div className="report-event-list">{events.length ? events.slice(0, 12).map((event) => <article key={event.id}><i /><div><strong>{event.detail}</strong><small>{event.actor} · {displayTime(event.createdAt)}</small></div><span>{event.action}</span></article>) : <p>暂无操作记录。</p>}</div></section><section className="panel"><div className="panel-heading"><div><h3>职责分离规则</h3><p>服务端在每次状态变更时重新校验医院成员关系。</p></div><ShieldCheck size={19} /></div><div className="report-duty-rules"><p><CheckCircle2 size={16} />编制人不能复核本人提交的报告</p><p><CheckCircle2 size={16} />复核人不能签发本人复核的报告</p><p><CheckCircle2 size={16} />跨医院访问和操作默认拒绝</p><p><CheckCircle2 size={16} />正式签发后内容和快照不可覆盖</p></div></section></div>
        </div>
      ) : null}

      {tab === "fields" ? (
        <div className="report-fields-layout">
          <section className="report-readiness-summary">
            <div><span>模板字段总量</span><strong>{totalFields}</strong><small>由参考模板反推的数据项</small></div><div><span>系统字段已建模</span><strong>{coveredFields}</strong><small>{completeness.toFixed(0)}% 建设覆盖；本报告质量见“数据质检”</small></div><div><span>已发布文件包</span><strong>{model.publishedFileCoverage.mode === "published" ? model.publishedFileCoverage.readyIds.length : model.sourceCoverage.connected}</strong><small>{model.publishedFileCoverage.mode === "published" ? `${model.publishedFileCoverage.missingIds.length} 个必需文件待发布` : `${model.sourceCoverage.pending} 待配置 · ${model.sourceCoverage.manual} 人工填报`}</small></div><div><span>相关采集模板</span><strong>{model.analysisProfileCoverage.enabled}/{model.analysisProfileCoverage.total}</strong><small>{model.analysisProfileCoverage.pending} 个尚未启用 · {model.analysisProfileCoverage.missing.length} 个缺失</small></div>
          </section>
          {activePlatformTemplate ? <section className="panel">
            <div className="panel-heading"><div><h3>当前模板需要的逻辑文件包</h3><p>模板只声明标准字段需求；{hospital.shortName}在“文件口径说明”准备相应 Excel/CSV/JSON，并由数据准备中心映射、复核与发布。</p></div>{onOpenSources ? <button className="secondary-button compact-button" onClick={onOpenSources}><Database size={14} />查看文件口径</button> : null}</div>
            <div className="template-source-mapping-grid">{activePlatformTemplate.sourceRequirements.map((item) => {
              const matched = sourceMatch(item.sourceId);
              const status = model.publishedFileCoverage.mode === "published" ? model.publishedFileCoverage.statusByRequirement[item.sourceId] ? "已连接" : "待配置" : matched?.match?.status ?? "待配置";
              return <article key={item.sourceId}><span className={`source-readiness-state ${status === "已连接" ? "connected" : status === "人工填报" ? "manual" : "pending"}`}><Database size={16} /></span><div><strong>{requirementFileLabel(item.sourceId, matched?.requirement.name ?? item.sourceId)}</strong><small>{item.purpose}</small><p>{matched?.match ? `本院文件：${matched.match.category}文件 · ${matched.match.fields}` : `尚未匹配；可采用：${matched?.requirement.fallback ?? "受控人工补充"}`}</p></div><i>{item.criticality === "required" ? "必需" : item.criticality === "recommended" ? "建议" : "可选"} · {status}</i></article>;
            })}</div>
          </section> : null}
          <section className="panel">
            <div className="panel-heading"><div><h3>可复用字段包</h3><p>字段按业务域公共维护，多个模板复用同一份字段定义和文件映射，避免每新增一个模板就重复整理表格。</p></div><span className="chart-note">{config.template.fieldPackIds.length} 个已启用</span></div>
            <div className="template-field-pack-grid">{fieldPackCatalog.filter((pack) => config.template.fieldPackIds.includes(pack.id)).map((pack) => <article key={pack.id}><span>{pack.name}</span><strong>{pack.representativeFields.length} 个代表字段</strong><p>{pack.description}</p><small>{pack.representativeFields.join("、")}</small></article>)}</div>
          </section>
          <section className="panel">
            <div className="panel-heading"><div><h3>模板字段反推清单</h3><p>每个数据域都明确来源、现状与需要补充的系统字段。</p></div><span className="page-badge"><Database size={15} />持续完善</span></div>
            <div className="table-scroll"><table className="data-table report-field-table"><thead><tr><th>数据域</th><th>字段数</th><th>已覆盖</th><th>覆盖率</th><th>建议来源文件</th><th>本次新增 / 后续补充</th></tr></thead><tbody>{reportFieldDomains.map((item) => <tr key={item.domain}><td><strong>{item.domain}</strong></td><td>{item.fields}</td><td>{item.covered}</td><td><span className={`coverage-pill ${item.covered === item.fields ? "complete" : "partial"}`}>{(item.covered / item.fields * 100).toFixed(0)}%</span></td><td>{item.source}</td><td>{item.additions}</td></tr>)}</tbody></table></div>
          </section>
          <section className="panel">
            <div className="panel-heading"><div><h3>发布文件准备度</h3><p>正式报告保留文件截止时间、责任部门、发布快照和复核状态。</p></div><span className="chart-note">{model.publishedFileCoverage.mode === "published" ? model.publishedFileCoverage.total : model.sourceCoverage.total} 类来源</span></div>
            <div className="report-source-readiness">{model.dataSources.map((source) => <article key={source.name}><span className={`source-readiness-state ${source.status === "已连接" ? "connected" : source.status === "人工填报" ? "manual" : "pending"}`}><Database size={16} /></span><div><strong>{source.name}</strong><small>{source.fields}</small></div><i>{source.status}</i></article>)}</div>
          </section>
          <section className="panel">
            <div className="panel-heading"><div><h3>采集与计算口径准备度</h3><p>报告版本会冻结相关品类的设备绑定、分母、质量门禁与收费对账阈值。</p></div><span className="chart-note">{model.analysisProfileCoverage.readyPercent.toFixed(0)}% 已启用</span></div>
            <div className="report-source-readiness">{model.analysisProfiles.map((profile) => <article key={profile.id}><span className={`source-readiness-state ${profile.status === "已启用" ? "connected" : profile.status === "停用" ? "manual" : "pending"}`}><SlidersHorizontal size={16} /></span><div><strong>{profile.category}</strong><small>{profile.deviceIdentityBinding} · {profile.utilizationDenominator}</small></div><i>{profile.status}</i></article>)}</div>
          </section>
        </div>
      ) : null}
    </>
  );
}
