"use client";

import { type FormEvent, useEffect, useState } from "react";
import { AlertTriangle, Database, Pencil, Save, ShieldCheck, X } from "lucide-react";
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
import type { Device } from "./mock-data";
import ComprehensiveMonitoringBoard from "./ComprehensiveMonitoringBoard";
import ConfigurableAnalyticsCanvas from "./ConfigurableAnalyticsCanvas";
import type { ChartType, MetricDefinition, VisualizationDefinition } from "./analytics-semantic-layer";

type StudioTab = "monitor" | "custom";

// 文件模板、质量门禁、口径定义已分别由“数据准备中心”和“指标字典”承载，这里只保留监测与自定义分析。
const studioTabTitles: Record<StudioTab, string> = {
  monitor: "全面监测",
  custom: "自定义视图",
};

function splitList(value: string) {
  return [...new Set(value
    .split(/[\n,，、;；]+/)
    .map((item) => item.trim())
    .filter(Boolean))];
}

export default function BenefitAnalysisStudio({
  profiles,
  setProfiles,
  devices,
  canManage,
  notify,
  tab,
  onTabChange,
}: {
  profiles: BenefitAnalysisProfile[];
  setProfiles: (next: BenefitAnalysisProfile[]) => void;
  devices: Device[];
  canManage: boolean;
  notify: (message: string, tone?: "info" | "error") => void;
  /** 页签由父组件托管，因为「效益分析」页顶部是三个并列页签：效益总览 / 全面监测 / 自定义视图 */
  tab: "monitor" | "custom";
  onTabChange: (next: "monitor" | "custom") => void;
}) {
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? "");
  const [draft, setDraft] = useState<BenefitAnalysisProfile | null>(null);
  const [error, setError] = useState("");
  const [customChartType, setCustomChartType] = useState<ChartType>("bar");
  const selected = profiles.find((profile) => profile.id === selectedId) ?? profiles[0];
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
    notify("已恢复六类行业规则模板，并保存到当前医院");
  }

  function openEditor(profile: BenefitAnalysisProfile) {
    if (!canManage) {
      notify("当前账号没有效益分析配置权限", "error");
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
    setProfiles(profiles.map((profile) => profile.id === draft.id ? draft : profile));
    setDraft(null);
    setError("");
    notify(`${draft.category}分析规则已保存到当前医院工作区`);
  }

  if (!profiles.length) {
    return (
      <section className="panel analysis-empty">
        <Database size={28} />
        {/* 页头由父页面提供，这里用 h2 承载空态标题，避免组件内再出现一个 h1 */}
        <h2 style={{ fontSize: 20 }}>当前医院尚未初始化分析规则</h2>
        {canManage ? <button className="primary-button" onClick={initializeProfiles}>初始化行业模板</button> : <small>请联系拥有“数据源管理”权限的医院管理员完成初始化。</small>}
      </section>
    );
  }

  return (
    <>
      <main className="analysis-studio" aria-label={studioTabTitles[tab]}>
      {tab === "monitor" ? (
        <>
          {selected ? (
            <section className="panel configurable-view-toolbar">
              <div><h3>{selected.category}分析规则</h3><p>{selected.workloadUnit} · 计划可服务 {selected.plannedServiceHoursPerMonth} 小时/月 · {selected.utilizationDenominator}</p></div>
              <label>设备品类
                <select value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
                  {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.category}</option>)}
                </select>
              </label>
              {/* 规则弹窗是本组件唯一的口径编辑入口，删掉其他页签后必须在这里保留可达入口 */}
              {canManage ? <button type="button" className="secondary-button compact-action" onClick={() => openEditor(selected)}><Pencil size={14} />编辑规则</button> : null}
            </section>
          ) : null}
          <ComprehensiveMonitoringBoard devices={devices} />
        </>
      ) : null}

      {tab === "custom" ? (
        <>
          <section className="panel configurable-view-toolbar">
            <div><h3>自定义视图</h3><p>数据来自当前工作区设备台账。</p></div>
            <label>展示形式
              <select value={customChartType} onChange={(event) => setCustomChartType(event.target.value as ChartType)}>
                <option value="kpi">KPI</option><option value="table">表格</option><option value="bar">柱状图</option><option value="line">折线图</option><option value="pie">饼图</option><option value="scatter">散点图</option><option value="heatmap">热力图</option>
              </select>
            </label>
            {/* 页签状态在父组件，组件内的跨页签跳转只能回调上去 */}
            <button type="button" className="text-button" onClick={() => onTabChange("monitor")}>查看全面监测</button>
          </section>
          <div className="configurable-view-grid">
            <ConfigurableAnalyticsCanvas metric={customMetric} visualization={customVisualization} data={customAnalyticsData} metricDefinitionVersion={1} visualizationVersion={1} />
            <section className="panel multi-part-policy">
              <h3>多部位检查计算规则</h3>
              <p>设备检查人次按 <code>examId</code> 去重，只计 1 次；按部位分析时展开关联表，收入与成本按主部位、平均或权重分摊，不重复计算。</p>
              <dl><div><dt>设备工作量</dt><dd>去重检查 1 次</dd></div><div><dt>部位工作量</dt><dd>胸部 1、腹部 1</dd></div><div><dt>收入</dt><dd>总额保持不变</dd></div></dl>
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
              <button type="button" className="icon-button" onClick={() => setDraft(null)} aria-label="关闭分析规则配置"><X size={18} /></button>
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
