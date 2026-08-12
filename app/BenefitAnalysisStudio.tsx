"use client";

import {
  type Dispatch,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Cable,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Database,
  FileCheck2,
  Gauge,
  Pencil,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  X,
} from "lucide-react";
import {
  benefitCollectionMethodOptions,
  benefitDeviceCategories,
  benefitProfileStatusOptions,
  cloneBenefitAnalysisProfiles,
  initialBenefitAnalysisProfiles,
  utilizationDenominatorOptions,
  type BenefitAnalysisProfile,
  type BenefitProfileStatus,
  type UtilizationDenominator,
} from "./benefit-analysis-config";
import type { DataSource, Device } from "./mock-data";
import ComprehensiveMonitoringBoard from "./ComprehensiveMonitoringBoard";
import ConfigurableAnalyticsCanvas from "./ConfigurableAnalyticsCanvas";
import type { ChartType, MetricDefinition, VisualizationDefinition } from "./analytics-semantic-layer";
import {
  hospitalMetricCatalog,
  hospitalMetricEvidenceSummary,
  hospitalMetricReadinessSummary,
  type HospitalMetricEvidence,
  type HospitalMetricReadiness,
} from "./hospital-metric-catalog";

type StudioTab = "collection" | "monitor" | "quality" | "metrics" | "custom";
type ConfigurationIssueKind = "source" | "manual" | "profile";

type ConfigurationIssue = {
  id: string;
  profile: BenefitAnalysisProfile;
  kind: ConfigurationIssueKind;
  title: string;
  detail: string;
  owner: string;
};

type FlowStage = {
  key: "source" | "event" | "quality" | "reconcile" | "metric";
  label: string;
  state: "ready" | "attention" | "draft";
  stateLabel: string;
  detail: string;
};

type SampleQuality = {
  completeness: number;
  binding: number;
  reconciliation: number;
  timeliness: number;
};

const sampleQuality: Record<string, SampleQuality> = {
  "profile-radiology": { completeness: 99.1, binding: 99.4, reconciliation: 99.2, timeliness: 98.5 },
  "profile-ultrasound": { completeness: 98.6, binding: 99.1, reconciliation: 98.7, timeliness: 97.4 },
  "profile-endoscopy": { completeness: 96.9, binding: 97.8, reconciliation: 96.6, timeliness: 94.8 },
  "profile-operating-room": { completeness: 97.5, binding: 98.2, reconciliation: 97.1, timeliness: 96.4 },
  "profile-life-support": { completeness: 96.2, binding: 98.8, reconciliation: 97.5, timeliness: 98.1 },
  "profile-laboratory": { completeness: 99.4, binding: 99.5, reconciliation: 99.1, timeliness: 99.3 },
};

const metricRules = [
  {
    group: "产能与效率",
    metric: "有效使用率",
    formula: "有效作业时长 ÷ 计划可服务时长 × 100%",
    guard: "分母扣除批准的计划停机；不可用开机时长替代",
  },
  {
    group: "设备保障",
    metric: "设备可用率",
    formula: "(计划可服务时长－故障停机时长) ÷ 计划可服务时长",
    guard: "与开机率、负荷率分别核算",
  },
  {
    group: "经济效益",
    metric: "全成本结余",
    formula: "有效收入－折旧－维保维修－人工－耗材－能耗－空间－间接成本",
    guard: "合同内维保与实际维修不得重复归集",
  },
  {
    group: "现金回报",
    metric: "净现值 NPV",
    formula: "Σ(CFₜ ÷ (1+r)ᵗ)－初始投资",
    guard: "折现率、评估期、残值和现金流假设随报告冻结",
  },
  {
    group: "量本利",
    metric: "盈亏平衡工作量",
    formula: "固定成本 ÷ (次均收入－次均变动成本)",
    guard: "单位边际贡献≤0时不计算",
  },
  {
    group: "数据可信",
    metric: "收费对账差异率",
    formula: "|设备实际完成工作量－有效收费工作量| ÷ 设备实际完成工作量 × 100%",
    guard: "免费复查、绿色通道、退费、补录分别解释",
  },
];

const hospitalMetricReadinessLabels: Record<HospitalMetricReadiness, string> = {
  ready: "首批核心",
  configure: "配置后启用",
  deferred: "暂缓展示",
};

const hospitalMetricEvidenceLabels: Record<HospitalMetricEvidence, string> = {
  direct: "资料直接",
  partial: "部分相关",
  industry: "行业补充",
  incomplete: "依据待补",
};

const hospitalMetricReadiness = hospitalMetricReadinessSummary();
const hospitalMetricEvidence = hospitalMetricEvidenceSummary();

const qualityGates = [
  ["完整性", "必填字段有值且通过类型、范围校验", "不允许用默认值掩盖缺失"],
  ["唯一性", "来源记录号、设备事件号不可重复", "重复记录先隔离，不直接覆盖"],
  ["设备绑定", "每条事件唯一匹配资产编号与设备标识", "一对多、无匹配进入人工队列"],
  ["时序一致", "开始≤结束，收费/报告时间不能早于服务事件", "跨日任务按医院业务日规则处理"],
  ["业务对账", "设备工作量文件与收费收入文件按冻结规则核对", "差异必须分类，不只看总数相等"],
  ["及时性", "在配置的批次时限内到达并完成校验", "迟到数据触发重算和版本记录"],
];

function splitList(value: string) {
  return [...new Set(value
    .split(/[\n,，、;；]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

function matchSource(profileSource: string, source: DataSource) {
  const left = profileSource.toLowerCase().replaceAll(" ", "");
  const right = source.name.toLowerCase().replaceAll(" ", "");
  return left === right
    || left.includes(right)
    || right.includes(left)
    || left.split(/[+/]/).some((token) => token.length > 2 && right.includes(token));
}

function statusTone(status: BenefitProfileStatus) {
  if (status === "已启用") return "success";
  if (status === "待试导") return "warning";
  if (status === "停用") return "danger";
  return "neutral";
}

function qualityTone(value: number, threshold: number, lowerIsBetter = false) {
  const pass = lowerIsBetter ? value <= threshold : value >= threshold;
  return pass ? "pass" : "warning";
}

function profileStructureReady(profile: BenefitAnalysisProfile) {
  return profile.collectionMethods.length > 0
    && profile.sourceSystems.length > 0
    && Boolean(profile.deviceIdentityBinding.trim())
    && profile.eventFields.length > 0
    && Boolean(profile.workloadUnit.trim())
    && profile.plannedServiceHoursPerMonth > 0
    && profile.plannedServiceHoursPerMonth <= 744
    && profile.allocationCountWeight + profile.allocationTimeWeight === 100
    && [
      profile.ocrConfidenceThreshold,
      profile.reconciliationTolerance,
      profile.completenessThreshold,
      profile.bindingRateThreshold,
    ].every((value) => Number.isFinite(value) && value >= 0 && value <= 100);
}

export default function BenefitAnalysisStudio({
  profiles,
  setProfiles,
  devices,
  sources,
  canManage,
  notify,
  onOpenSources,
}: {
  profiles: BenefitAnalysisProfile[];
  setProfiles: Dispatch<SetStateAction<BenefitAnalysisProfile[]>>;
  devices: Device[];
  sources: DataSource[];
  canManage: boolean;
  notify: (message: string) => void;
  onOpenSources?: () => void;
}) {
  const [tab, setTab] = useState<StudioTab>("collection");
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? "");
  const [draft, setDraft] = useState<BenefitAnalysisProfile | null>(null);
  const [error, setError] = useState("");
  const [customChartType, setCustomChartType] = useState<ChartType>("bar");
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0];
  const enabledCount = profiles.filter((profile) => profile.status === "已启用").length;
  const connectedSources = sources.filter((source) => source.status === "已连接").length;
  const rulesReadyCount = profiles.filter(profileStructureReady).length;
  const deviceCategories = useMemo(
    () => new Set(devices.map((device) => device.category || device.serviceUnit).filter(Boolean)).size,
    [devices],
  );
  const customMetric: MetricDefinition = {
    code: "device_revenue",
    name: "设备收入",
    aggregation: "sum",
    field: "revenue",
    unit: " 万元",
    allowedDimensions: ["device", "department", "category", "body_part"],
    status: "active",
    version: 1,
  };
  const customVisualization: VisualizationDefinition = {
    code: `device_revenue_${customChartType}`,
    name: "设备收入自定义展示",
    metricCode: customMetric.code,
    chartType: customChartType,
    dimension: "设备",
    sort: "desc",
    limit: 20,
    status: "active",
    version: 1,
  };
  const customAnalyticsData = devices.map((device) => ({ label: device.shortName, value: device.revenue, secondary: device.utilization, group: device.department }));
  const configurationIssues = useMemo<ConfigurationIssue[]>(() => profiles.flatMap((profile) => {
    const linked = profile.sourceSystems.map((name) => ({
      name,
      source: sources.find((item) => matchSource(name, item)),
    }));
    const missing = linked.filter((item) => !item.source).map((item) => item.name);
    const pending = linked.filter((item) => item.source?.status === "待配置").map((item) => item.name);
    const manual = linked.filter((item) => item.source?.status === "人工填报").map((item) => item.name);
    const issues: ConfigurationIssue[] = [];
    if (missing.length || pending.length) {
      issues.push({
        id: `${profile.id}-source`,
        profile,
        kind: "source",
        title: "来源文件尚未就绪",
        detail: missing.length
          ? `未建档：${missing.join("、")}${pending.length ? `；待准备：${pending.join("、")}` : ""}`
          : `待准备：${pending.join("、")}`,
        owner: profile.responsibleDepartment,
      });
    }
    if (manual.length) {
      issues.push({
        id: `${profile.id}-manual`,
        profile,
        kind: "manual",
        title: "人工来源需要双人复核",
        detail: `${manual.join("、")}当前为人工填报，需保留文件版本、填报人和复核人`,
        owner: profile.responsibleDepartment,
      });
    }
    if (profile.status !== "已启用" || !profileStructureReady(profile)) {
      issues.push({
        id: `${profile.id}-profile`,
        profile,
        kind: "profile",
        title: profileStructureReady(profile) ? "规则版本尚未启用" : "规则结构不完整",
        detail: profileStructureReady(profile)
          ? `当前状态为“${profile.status}”，启用前需完成文件试导与抽样对账`
          : "采集方式、事件字段、门槛或分摊权重仍需补齐",
        owner: profile.responsibleDepartment,
      });
    }
    return issues;
  }), [profiles, sources]);
  const selectedStages = useMemo<FlowStage[]>(() => {
    if (!selected) return [];
    const linkedSources = selected.sourceSystems.map((name) => sources.find((item) => matchSource(name, item)));
    const linkedCount = linkedSources.filter(Boolean).length;
    const connectedCount = linkedSources.filter((source) => source?.status === "已连接").length;
    const hasPendingSource = linkedSources.some((source) => !source || source.status === "待配置");
    const thresholdValues = [
      selected.ocrConfidenceThreshold,
      selected.completenessThreshold,
      selected.bindingRateThreshold,
    ];
    const thresholdsReady = thresholdValues.every((value) => Number.isFinite(value) && value >= 0 && value <= 100);
    const reconciliationReady = Number.isFinite(selected.reconciliationTolerance)
      && selected.reconciliationTolerance >= 0
      && selected.reconciliationTolerance <= 100;
    return [
      {
        key: "source",
        label: "来源",
        state: hasPendingSource ? "attention" : connectedCount === linkedSources.length ? "ready" : "draft",
        stateLabel: hasPendingSource ? "待完善" : connectedCount === linkedSources.length ? "模板已准备" : "含人工来源",
        detail: `${linkedCount}/${selected.sourceSystems.length} 已建档 · ${connectedCount} 已准备`,
      },
      {
        key: "event",
        label: "事件",
        state: selected.eventFields.length && selected.deviceIdentityBinding.trim() ? "ready" : "attention",
        stateLabel: selected.eventFields.length && selected.deviceIdentityBinding.trim() ? "规则已定义" : "待补齐",
        detail: `${selected.eventFields.length} 个字段 · ${selected.deviceIdentityBinding ? "已定义设备绑定" : "未定义设备绑定"}`,
      },
      {
        key: "quality",
        label: "质检",
        state: thresholdsReady ? "ready" : "attention",
        stateLabel: thresholdsReady ? "门槛已定义" : "阈值异常",
        detail: `完整率 ≥${selected.completenessThreshold}% · 绑定率 ≥${selected.bindingRateThreshold}%`,
      },
      {
        key: "reconcile",
        label: "对账",
        state: reconciliationReady ? "ready" : "attention",
        stateLabel: reconciliationReady ? "容差已定义" : "容差异常",
        detail: `设备完成量与有效收费量差异 ≤${selected.reconciliationTolerance}%`,
      },
      {
        key: "metric",
        label: "指标",
        state: selected.status === "已启用" ? "ready" : "draft",
        stateLabel: selected.status === "已启用" ? "口径已启用" : selected.status,
        detail: `${selected.workloadUnit} · ${selected.utilizationDenominator}`,
      },
    ];
  }, [selected, sources]);

  useEffect(() => {
    if (!draft) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDraft(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [draft]);

  function initializeProfiles() {
    const next = cloneBenefitAnalysisProfiles(initialBenefitAnalysisProfiles);
    setProfiles(next);
    setSelectedId(next[0]?.id ?? "");
    notify("已恢复六类行业采集模板，并保存到当前医院");
  }

  function openEditor(profile: BenefitAnalysisProfile) {
    if (!canManage) {
      notify("当前账号没有采集与分析配置权限");
      return;
    }
    setDraft({
      ...profile,
      collectionMethods: [...profile.collectionMethods],
      sourceSystems: [...profile.sourceSystems],
      eventFields: [...profile.eventFields],
    });
    setError("");
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.collectionMethods.length || !draft.sourceSystems.length || !draft.eventFields.length) {
      setError("至少配置一种文件方式、一个来源文件类别和一个事件字段。");
      return;
    }
    if (!draft.deviceIdentityBinding.trim() || !draft.workloadUnit.trim() || !draft.responsibleDepartment.trim() || !draft.effectiveDate) {
      setError("设备绑定规则、工作量单位、责任部门和生效日期均为必填项。");
      return;
    }
    if (profiles.some((profile) => profile.id !== draft.id && profile.category === draft.category)) {
      setError("每个设备品类只能保留一套配置，请选择未被占用的品类。");
      return;
    }
    if (draft.plannedServiceHoursPerMonth <= 0 || draft.plannedServiceHoursPerMonth > 744) {
      setError("月计划可服务时长应大于 0 且不超过 744 小时。");
      return;
    }
    const thresholds = [
      draft.ocrConfidenceThreshold,
      draft.reconciliationTolerance,
      draft.completenessThreshold,
      draft.bindingRateThreshold,
    ];
    if (thresholds.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
      setError("质量阈值与对账容差必须在 0–100% 之间。");
      return;
    }
    if (draft.allocationCountWeight + draft.allocationTimeWeight !== 100) {
      setError("按次数与按时长的分摊权重合计必须为 100%。");
      return;
    }
    if (draft.eventFields.some((field) => /患者姓名|身份证|手机号|住院号|病历号/.test(field))) {
      setError("云端分析事件不得采集直接身份字段，请改用院内网关生成的去标识化事件键。");
      return;
    }
    setProfiles((current) => current.map((profile) => profile.id === draft.id ? draft : profile));
    setDraft(null);
    setError("");
    notify(`${draft.category}采集与分析规则已保存到当前医院工作区`);
  }

  function activateStage(stage: FlowStage["key"]) {
    if (!selected) return;
    if (stage === "source") {
      if (onOpenSources) onOpenSources();
      else notify("请在“文件来源与口径”页面维护模板和导入准备状态");
      return;
    }
    if (stage === "event") {
      openEditor(selected);
      return;
    }
    if (stage === "quality" || stage === "reconcile") {
      setTab("quality");
      return;
    }
    setTab("metrics");
  }

  function handleIssue(issue: ConfigurationIssue) {
    setSelectedId(issue.profile.id);
    if (issue.kind === "source") {
      if (onOpenSources) onOpenSources();
      else {
        setTab("collection");
        notify("请在“文件来源与口径”页面登记来源模板");
      }
      return;
    }
    if (issue.kind === "profile" && canManage) {
      openEditor(issue.profile);
      return;
    }
    setTab("collection");
  }

  if (!profiles.length) {
    return (
      <section className="panel analysis-empty">
        <Database size={28} />
        <h1>当前医院尚未初始化采集分析规则</h1>
        {canManage ? <button className="primary-button" onClick={initializeProfiles}>初始化行业模板</button> : <small>请联系拥有“数据源管理”权限的医院管理员完成初始化。</small>}
      </section>
    );
  }

  return (
    <>
      <main className="analysis-studio">
      <div className="page-heading analysis-page-heading">
        <div>
          <div className="eyebrow"><Activity size={15} />医院级文件与核算规则</div>
          <h1>文件采集与效益分析</h1>
          <p>不同设备品类使用不同业务模板与评价口径。</p>
        </div>
        <div className="heading-actions">
          {onOpenSources ? <button className="secondary-button" onClick={onOpenSources}><Cable size={17} />文件来源与口径</button> : null}
          {canManage && selected ? <button className="primary-button" onClick={() => openEditor(selected)}><SlidersHorizontal size={17} />配置当前品类</button> : null}
        </div>
      </div>

      <section className="analysis-summary" aria-label="采集分析配置摘要">
        <div><span><Database size={18} /></span><p>品类模板<strong>{profiles.length}</strong><small>{enabledCount} 类已启用</small></p></div>
        <div><span><Cable size={18} /></span><p>来源文件准备<strong>{connectedSources}/{sources.length}</strong><small>按医院文件台账状态</small></p></div>
        <div><span><FileCheck2 size={18} /></span><p>规则完整<strong>{rulesReadyCount}/{profiles.length}</strong><small>仅检查配置结构与阈值</small></p></div>
        <div><span><BarChart3 size={18} /></span><p>设备覆盖<strong>{devices.length}</strong><small>{deviceCategories} 个现有设备分类</small></p></div>
      </section>

      <div className="analysis-tabs" role="tablist" aria-label="采集与分析配置页签">
        <button role="tab" aria-selected={tab === "collection"} className={tab === "collection" ? "active" : ""} onClick={() => setTab("collection")}><Database size={16} />采集方案</button>
        <button role="tab" aria-selected={tab === "monitor"} className={tab === "monitor" ? "active" : ""} onClick={() => setTab("monitor")}><Gauge size={16} />全面监测</button>
        <button role="tab" aria-selected={tab === "quality"} className={tab === "quality" ? "active" : ""} onClick={() => setTab("quality")}><ShieldCheck size={16} />质量与对账</button>
        <button role="tab" aria-selected={tab === "metrics"} className={tab === "metrics" ? "active" : ""} onClick={() => setTab("metrics")}><CircleDollarSign size={16} />分析口径</button>
        <button role="tab" aria-selected={tab === "custom"} className={tab === "custom" ? "active" : ""} onClick={() => setTab("custom")}><BarChart3 size={16} />自定义视图</button>
      </div>

      {tab === "collection" ? (
        <>
          <section className="analysis-priority">
            <strong>文件采集方式</strong>
            <div><span>1 Excel 标准模板</span><ChevronRight size={15} /><span>2 CSV 明细文件</span><ChevronRight size={15} /><span>3 JSON 批量数据</span><ChevronRight size={15} /><span>4 受控人工补充</span></div>
            <small>每种方式都必须保留原件、哈希、导入人、映射版本和复核记录；解析成功不代表数据已经准确。</small>
          </section>
          {selected ? (
            <section className="analysis-ingestion-flow" aria-label={`${selected.category}采集分析流程`}>
              <header>
                <div><strong>{selected.category}证据链</strong></div>
                <span className={`status-pill ${statusTone(selected.status)}`}>{selected.status}</span>
              </header>
              <div>
                {selectedStages.map((stage, index) => (
                  <div className="analysis-flow-node-wrap" key={stage.key}>
                    <button type="button" className={`analysis-flow-node ${stage.state}`} onClick={() => activateStage(stage.key)}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{stage.label}</strong>
                      <i>{stage.stateLabel}</i>
                      <small>{stage.detail}</small>
                    </button>
                    {index < selectedStages.length - 1 ? <ChevronRight size={17} aria-hidden="true" /> : null}
                  </div>
                ))}
              </div>
              <footer><ShieldCheck size={15} />这里显示的是文件模板与规则台账状态，不代表真实记录已导入、质检已通过或指标已经发布。</footer>
            </section>
          ) : null}
          <div className="analysis-collection-layout">
            <section className="panel analysis-profile-list">
              <div className="panel-heading"><div><h3>设备品类模板</h3></div><span className="chart-note">{profiles.length} 类</span></div>
              <div>
                {profiles.map((profile) => (
                  <button key={profile.id} className={selected?.id === profile.id ? "active" : ""} onClick={() => setSelectedId(profile.id)}>
                    <span><strong>{profile.category}</strong><small>{profile.workloadUnit} · {profile.collectionMethods.join(" / ")}</small></span>
                    <i className={`status-pill ${statusTone(profile.status)}`}>{profile.status}</i>
                  </button>
                ))}
              </div>
            </section>

            {selected ? (
              <section className="panel analysis-profile-detail">
                <div className="panel-heading">
                  <div><h3>{selected.category}采集合同</h3><p>规则自 {selected.effectiveDate} 生效 · {selected.responsibleDepartment}</p></div>
                  {canManage ? <button className="secondary-button compact-action" onClick={() => openEditor(selected)}><Pencil size={14} />编辑</button> : null}
                </div>
                <div className="analysis-contract-grid">
                  <div><span>设备唯一绑定</span><strong>{selected.deviceIdentityBinding}</strong></div>
                  <div><span>工作量单位</span><strong>{selected.workloadUnit}</strong></div>
                  <div><span>计划可服务时长</span><strong>{selected.plannedServiceHoursPerMonth} 小时/月</strong></div>
                  <div><span>利用率分母</span><strong>{selected.utilizationDenominator}</strong></div>
                </div>
                <div className="analysis-detail-section">
                  <h4>采集方式</h4>
                  <div className="analysis-chips">{selected.collectionMethods.map((method) => <span key={method}>{method}</span>)}</div>
                </div>
                <div className="analysis-detail-section">
                  <h4>来源文件与当前准备状态</h4>
                  <div className="analysis-source-readiness">
                    {selected.sourceSystems.map((name) => {
                      const source = sources.find((item) => matchSource(name, item));
                      return <div key={name}><span className={source?.status === "已连接" ? "connected" : source?.status === "人工填报" ? "manual" : "pending"}><Database size={15} /></span><strong>{name}</strong><small>{source ? source.status === "已连接" ? "模板已准备" : source.status === "人工填报" ? "受控人工文件" : "待准备" : "尚未登记来源文件"}</small></div>;
                    })}
                  </div>
                </div>
                <div className="analysis-detail-section">
                  <h4>最小事件数据集</h4>
                  <div className="analysis-event-fields">{selected.eventFields.map((field) => <span key={field}><CheckCircle2 size={14} />{field}</span>)}</div>
                </div>
              </section>
            ) : null}
          </div>
          <div className="analysis-privacy-note"><ShieldCheck size={18} /><span><strong>隐私边界：</strong>云端效益层只接收设备、事件、科室和金额等去标识化数据；姓名、身份证、手机号、住院号、病历号与影像原文不得进入本演示云。</span></div>
        </>
      ) : null}

      {tab === "monitor" ? (
        <ComprehensiveMonitoringBoard devices={devices} />
      ) : null}

      {tab === "quality" ? (
        <>
          <section className="panel analysis-quality-table">
            <div className="panel-heading"><div><h3>分品类质量门禁</h3><p>下列百分比是脱敏样例校验，仅为规则演示，不代表真实接入结果</p></div><span className="status-pill warning">样例数据</span></div>
            <div className="table-scroll">
              <table className="data-table analysis-responsive-table">
                <thead><tr><th>设备品类</th><th>完整率 / 门槛</th><th>设备绑定 / 门槛</th><th>业务对账</th><th>及时率</th><th>处理结论</th><th>下一步</th></tr></thead>
                <tbody>{profiles.map((profile) => {
                  const sample = sampleQuality[profile.id] ?? { completeness: 0, binding: 0, reconciliation: 0, timeliness: 0 };
                  const difference = Number((100 - sample.reconciliation).toFixed(1));
                  const pass = sample.completeness >= profile.completenessThreshold
                    && sample.binding >= profile.bindingRateThreshold
                    && difference <= profile.reconciliationTolerance;
                  return (
                    <tr key={profile.id}>
                      <td data-label="设备品类"><strong>{profile.category}</strong><small>{profile.status}</small></td>
                      <td data-label="完整率 / 门槛"><span className={`analysis-quality-value ${qualityTone(sample.completeness, profile.completenessThreshold)}`}>{sample.completeness}% / {profile.completenessThreshold}%</span></td>
                      <td data-label="设备绑定 / 门槛"><span className={`analysis-quality-value ${qualityTone(sample.binding, profile.bindingRateThreshold)}`}>{sample.binding}% / {profile.bindingRateThreshold}%</span></td>
                      <td data-label="业务对账"><span className={`analysis-quality-value ${qualityTone(difference, profile.reconciliationTolerance, true)}`}>差异 {difference}% / ≤{profile.reconciliationTolerance}%</span></td>
                      <td data-label="及时率">{sample.timeliness}%</td>
                      <td data-label="处理结论"><span className={`status-pill ${pass ? "success" : "warning"}`}>{pass ? "样例可进入分析" : "样例进入隔离复核"}</span></td>
                      <td data-label="下一步"><button className="text-button analysis-row-action" onClick={() => { setSelectedId(profile.id); if (pass) setTab("metrics"); else if (canManage) openEditor(profile); else setTab("collection"); }}>{pass ? "查看口径" : canManage ? "调整门禁" : "查看规则"}</button></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </section>
          <section className="analysis-quality-grid">
            {qualityGates.map(([name, rule, exception], index) => (
              <article className="panel" key={name}><span>{String(index + 1).padStart(2, "0")}</span><h3>{name}</h3><p>{rule}</p><small>{exception}</small></article>
            ))}
          </section>
          <section className="panel analysis-review-queue">
            <div className="panel-heading"><div><h3>配置待办</h3><p>由当前医院的规则状态和文件台账即时推导；这里只导航到可处理页面，不冒充后台已执行修复</p></div><span className="chart-note">{configurationIssues.length} 项</span></div>
            {configurationIssues.length ? (
              <div>
                {configurationIssues.slice(0, 9).map((issue) => (
                  <article key={issue.id}>
                    <AlertTriangle size={17} />
                    <span><strong>{issue.profile.category} · {issue.title}</strong><small>{issue.detail}</small></span>
                    <i>{issue.owner}</i>
                    <button className="secondary-button compact-action" onClick={() => handleIssue(issue)}>
                      {issue.kind === "source" ? "配置来源" : issue.kind === "profile" && canManage ? "编辑规则" : "查看方案"}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="analysis-no-issues"><CheckCircle2 size={20} /><span><strong>当前配置没有待办</strong><small>这只说明规则与来源台账完整，不代表医院数据已经通过质量门禁。</small></span></div>
            )}
          </section>
        </>
      ) : null}

      {tab === "metrics" ? (
        <>
          <section className="panel analysis-metric-rules">
            <div className="panel-heading"><div><h3>可解释的效益指标</h3></div><span className="chart-note">规则版本 2026-V3.0</span></div>
            <div className="analysis-metric-grid">{metricRules.map((rule) => <article key={rule.metric}><span>{rule.group}</span><h3>{rule.metric}</h3><code>{rule.formula}</code><small>{rule.guard}</small></article>)}</div>
          </section>
          <section className="panel analysis-allocation-table">
            <div className="panel-heading"><div><h3>医院关注指标基线</h3><p>医院工作簿 17 项已转成 20 个不可混用的可执行口径；启用还需真实数据、字段映射和质量门禁。</p></div><span className="chart-note">核心 {hospitalMetricReadiness.ready} · 待配置 {hospitalMetricReadiness.configure} · 暂缓 {hospitalMetricReadiness.deferred}</span></div>
            <div className="analysis-priority"><strong>依据成熟度</strong><div><span>直接 {hospitalMetricEvidence.direct}</span><ChevronRight size={15} /><span>部分相关 {hospitalMetricEvidence.partial}</span><ChevronRight size={15} /><span>行业补充 {hospitalMetricEvidence.industry}</span><ChevronRight size={15} /><span>待补 {hospitalMetricEvidence.incomplete}</span></div><small>依据成熟度和数据准备状态分别管理；有理论依据不代表医院数据已经可用。</small></div>
            <div className="table-scroll">
              <table className="data-table analysis-responsive-table">
                <thead><tr><th>原表</th><th>指标</th><th>公式 / 分母</th><th>依据</th><th>纳入状态</th><th>平台处理决定</th></tr></thead>
                <tbody>{hospitalMetricCatalog.map((metric) => (
                  <tr key={metric.code}>
                    <td data-label="原表">{metric.sourceItem}</td>
                    <td data-label="指标"><strong>{metric.name}</strong><small>{metric.code}</small></td>
                    <td data-label="公式 / 分母"><code>{metric.formula}</code><small>分母：{metric.denominator}</small></td>
                    <td data-label="依据"><span className={`status-pill ${metric.evidence === "direct" ? "success" : metric.evidence === "incomplete" ? "danger" : "warning"}`}>{hospitalMetricEvidenceLabels[metric.evidence]}</span></td>
                    <td data-label="纳入状态"><span className={`status-pill ${metric.readiness === "ready" ? "success" : metric.readiness === "configure" ? "warning" : "neutral"}`}>{hospitalMetricReadinessLabels[metric.readiness]}</span></td>
                    <td data-label="平台处理决定">{metric.decision}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
          <section className="panel analysis-allocation-table">
            <div className="panel-heading"><div><h3>共享成本分摊规则</h3><p>次数与时长只是可配置驱动因子，责任部门、有效期和异常处理必须同步留痕</p></div></div>
            <div className="table-scroll">
              <table className="data-table analysis-responsive-table">
                <thead><tr><th>品类</th><th>按次数</th><th>按时长</th><th>责任部门</th><th>生效日期</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>{profiles.map((profile) => (
                  <tr key={profile.id}>
                    <td data-label="品类"><strong>{profile.category}</strong></td>
                    <td data-label="按次数">{profile.allocationCountWeight}%</td>
                    <td data-label="按时长">{profile.allocationTimeWeight}%</td>
                    <td data-label="责任部门">{profile.responsibleDepartment}</td>
                    <td data-label="生效日期">{profile.effectiveDate}</td>
                    <td data-label="状态"><span className={`status-pill ${statusTone(profile.status)}`}>{profile.status}</span></td>
                    <td data-label="操作">{canManage ? <button className="text-button analysis-row-action" onClick={() => openEditor(profile)}>调整分摊</button> : "只读"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
          <section className="analysis-evidence-flow">
            <article><span><Database size={18} /></span><strong>原始事实</strong><small>设备事件、业务记录、收费、成本凭证</small></article>
            <ChevronRight size={17} />
            <article><span><ShieldCheck size={18} /></span><strong>质量门禁</strong><small>绑定、完整、对账、异常隔离</small></article>
            <ChevronRight size={17} />
            <article><span><CircleDollarSign size={18} /></span><strong>单机核算</strong><small>收入、全成本、现金贡献、NPV</small></article>
            <ChevronRight size={17} />
            <article><span><Target size={18} /></span><strong>管理闭环</strong><small>排班、共享、维修、采购、更新与复评</small></article>
          </section>
        </>
      ) : null}

      {tab === "custom" ? (
        <>
          <section className="panel configurable-view-toolbar">
            <div><h3>指标展示配置预览</h3><p>当前数据来自页面已有设备集合。</p></div>
            <label>展示形式
              <select value={customChartType} onChange={(event) => setCustomChartType(event.target.value as ChartType)}>
                <option value="kpi">KPI</option><option value="table">表格</option><option value="bar">柱状图</option><option value="line">折线图</option><option value="pie">饼图</option><option value="scatter">散点图</option><option value="heatmap">热力图</option>
              </select>
            </label>
          </section>
          <div className="configurable-view-grid">
            <ConfigurableAnalyticsCanvas metric={customMetric} visualization={customVisualization} data={customAnalyticsData} metricDefinitionVersion={1} visualizationVersion={1} />
            <section className="panel multi-part-policy">
              <h3>多部位检查计算规则</h3>
              <p>一次检查可关联一个主部位和多个附加部位。设备检查人次按 <code>examId</code> 去重，只计 1 次；按部位分析时展开关联表，但收入和成本必须选择主部位、平均或权重分摊，不能把整笔金额重复计算。</p>
              <dl><div><dt>设备工作量</dt><dd>去重检查 1 次</dd></div><div><dt>部位工作量</dt><dd>胸部 1、腹部 1</dd></div><div><dt>收入</dt><dd>总额保持不变</dd></div></dl>
              <small>数据中心发布字段定义、指标版本和分摊规则后，报告快照同时冻结对应版本。</small>
            </section>
          </div>
        </>
      ) : null}
      </main>

      {draft ? (
        <div
          className="modal-backdrop analysis-modal"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDraft(null);
          }}
        >
          <form className="analysis-profile-dialog" role="dialog" aria-modal="true" aria-labelledby="analysis-profile-title" onSubmit={saveProfile}>
            <header>
              <div><span>医院级云端规则</span><h2 id="analysis-profile-title">配置{draft.category}</h2></div>
              <button type="button" className="icon-button" onClick={() => setDraft(null)} aria-label="关闭采集分析配置"><X size={18} /></button>
            </header>
            <div className="analysis-profile-form">
              <fieldset>
                <legend>采集链路</legend>
                <label>设备品类
                  <select value={draft.category} onChange={(event) => setDraft((current) => current ? { ...current, category: event.target.value as BenefitAnalysisProfile["category"] } : current)}>
                    {benefitDeviceCategories.map((category) => <option key={category}>{category}</option>)}
                  </select>
                </label>
                <label>采集方式<div className="analysis-method-picker">{benefitCollectionMethodOptions.map((method) => <label key={method}><input type="checkbox" checked={draft.collectionMethods.includes(method)} onChange={(event) => setDraft((current) => current ? { ...current, collectionMethods: event.target.checked ? [...current.collectionMethods, method] : current.collectionMethods.filter((item) => item !== method) } : current)} />{method}</label>)}</div></label>
                <label>来源文件类别<textarea rows={2} value={draft.sourceSystems.join("、")} onChange={(event) => setDraft((current) => current ? { ...current, sourceSystems: splitList(event.target.value) } : current)} placeholder="多个文件类别用顿号或换行分隔" /></label>
                <label>设备唯一绑定规则<input value={draft.deviceIdentityBinding} onChange={(event) => setDraft((current) => current ? { ...current, deviceIdentityBinding: event.target.value } : current)} /></label>
                <label>最小事件字段<textarea rows={3} value={draft.eventFields.join("、")} onChange={(event) => setDraft((current) => current ? { ...current, eventFields: splitList(event.target.value) } : current)} /></label>
              </fieldset>
              <fieldset>
                <legend>分析分母与质量门禁</legend>
                <div className="form-row two"><label>工作量单位<input value={draft.workloadUnit} onChange={(event) => setDraft((current) => current ? { ...current, workloadUnit: event.target.value } : current)} /></label><label>月计划可服务时长<input type="number" min="1" max="744" value={draft.plannedServiceHoursPerMonth} onChange={(event) => setDraft((current) => current ? { ...current, plannedServiceHoursPerMonth: Number(event.target.value) } : current)} /></label></div>
                <label>利用率分母<select value={draft.utilizationDenominator} onChange={(event) => setDraft((current) => current ? { ...current, utilizationDenominator: event.target.value as UtilizationDenominator } : current)}>{utilizationDenominatorOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                <div className="form-row two"><label>字段识别置信阈值（%）<input type="number" min="0" max="100" step=".1" value={draft.ocrConfidenceThreshold} onChange={(event) => setDraft((current) => current ? { ...current, ocrConfidenceThreshold: Number(event.target.value) } : current)} /></label><label>业务对账容差（%）<input type="number" min="0" max="100" step=".1" value={draft.reconciliationTolerance} onChange={(event) => setDraft((current) => current ? { ...current, reconciliationTolerance: Number(event.target.value) } : current)} /></label></div>
                <div className="form-row two"><label>完整率门槛（%）<input type="number" min="0" max="100" step=".1" value={draft.completenessThreshold} onChange={(event) => setDraft((current) => current ? { ...current, completenessThreshold: Number(event.target.value) } : current)} /></label><label>设备绑定率门槛（%）<input type="number" min="0" max="100" step=".1" value={draft.bindingRateThreshold} onChange={(event) => setDraft((current) => current ? { ...current, bindingRateThreshold: Number(event.target.value) } : current)} /></label></div>
              </fieldset>
              <fieldset>
                <legend>成本分摊与治理</legend>
                <div className="form-row two"><label>按次数权重（%）<input type="number" min="0" max="100" value={draft.allocationCountWeight} onChange={(event) => setDraft((current) => current ? { ...current, allocationCountWeight: Number(event.target.value) } : current)} /></label><label>按时长权重（%）<input type="number" min="0" max="100" value={draft.allocationTimeWeight} onChange={(event) => setDraft((current) => current ? { ...current, allocationTimeWeight: Number(event.target.value) } : current)} /></label></div>
                <label>责任部门<input value={draft.responsibleDepartment} onChange={(event) => setDraft((current) => current ? { ...current, responsibleDepartment: event.target.value } : current)} /></label>
                <div className="form-row two"><label>生效日期<input type="date" value={draft.effectiveDate} onChange={(event) => setDraft((current) => current ? { ...current, effectiveDate: event.target.value } : current)} /></label><label>规则状态<select value={draft.status} onChange={(event) => setDraft((current) => current ? { ...current, status: event.target.value as BenefitProfileStatus } : current)}>{benefitProfileStatusOptions.map((option) => <option key={option}>{option}</option>)}</select></label></div>
              </fieldset>
              <div className="analysis-form-warning"><ShieldCheck size={16} />此处只保存文件规则与阈值，不保存外部系统凭证或患者身份数据。</div>
              {error ? <div className="analysis-form-error" role="alert" aria-live="assertive"><AlertTriangle size={16} />{error}</div> : null}
            </div>
            <footer><button type="button" className="secondary-button" onClick={() => setDraft(null)}>取消</button><button className="primary-button"><Save size={16} />保存医院规则</button></footer>
          </form>
        </div>
      ) : null}
    </>
  );
}
