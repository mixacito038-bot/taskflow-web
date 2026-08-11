"use client";

import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import {
  ArrowRight,
  Calculator,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  Gauge,
  Lightbulb,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingDown,
  TrendingUp,
  Wrench,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Device, netBenefit, roi, totalCost } from "./mock-data";
import { insightFor } from "./metric-definitions";
import type { PublishedDatasetView } from "./published-data";

export type ActionStatus = "待启动" | "进行中" | "已完成";
export type Priority = "高" | "中" | "低";

export type ImprovementAction = {
  id: string;
  deviceId: string;
  title: string;
  issue: string;
  owner: string;
  dueDate: string;
  expectedBenefit: number;
  status: ActionStatus;
  priority: Priority;
  progress: number;
  actualBenefit?: number;
  baselineValue?: number;
  targetValue?: number;
  actualValue?: number;
  metricUnit?: string;
  evidence?: string;
  reviewDate?: string;
  history?: Array<{ at: string; status: ActionStatus; note: string }>;
};

type ImprovementCenterProps = {
  devices: Device[];
  actions: ImprovementAction[];
  setActions: Dispatch<SetStateAction<ImprovementAction[]>>;
  onSelectDevice: (device: Device) => void;
  notify: (message: string) => void;
  publishedData?: PublishedDatasetView;
  demoMode?: boolean;
};

const currency = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

export const initialActions: ImprovementAction[] = [
  {
    id: "action-robot-capacity",
    deviceId: "robot-01",
    title: "建立跨科室适应证池并按周统筹排台",
    issue: "使用率 48%，预计回本较计划延后 2.6 年",
    owner: "手术部 / 医务处",
    dueDate: "2026-08-31",
    expectedBenefit: 118,
    status: "进行中",
    priority: "高",
    progress: 55,
    baselineValue: 48,
    targetValue: 65,
    metricUnit: "% 使用率",
    evidence: "跨科室适应证池已建立，等待首轮月度复测。",
    history: [{ at: "2026-07-08", status: "进行中", note: "医务处完成方案立项" }],
  },
  {
    id: "action-linac-reliability",
    deviceId: "linac-01",
    title: "射频系统故障复盘与关键备件前置",
    issue: "可用率 93.8%，年度停机 78 小时",
    owner: "医学装备部 / 放疗科",
    dueDate: "2026-07-31",
    expectedBenefit: 46,
    status: "进行中",
    priority: "高",
    progress: 72,
  },
  {
    id: "action-mri-wait",
    deviceId: "mri-01",
    title: "增开晚间增强检查时段并重排预约模板",
    issue: "预约等待 3.2 天，高峰时段集中度 62.4%",
    owner: "医学影像科 / 运营部",
    dueDate: "2026-08-15",
    expectedBenefit: 62,
    status: "待启动",
    priority: "中",
    progress: 15,
  },
  {
    id: "action-ct-flow",
    deviceId: "ct-01",
    title: "建立取消原因清单并配置午间机动班次",
    issue: "需求高峰与排班错位，需持续压降积压和取消",
    owner: "医学影像科",
    dueDate: "2026-08-08",
    expectedBenefit: 38,
    status: "已完成",
    priority: "中",
    progress: 100,
    actualBenefit: 31,
    baselineValue: 58,
    targetValue: 35,
    actualValue: 37,
    metricUnit: "次取消/周",
    evidence: "午间机动班次排班表、取消原因台账与连续四周复测记录。",
    reviewDate: "2026-08-08",
    history: [{ at: "2026-08-08", status: "已完成", note: "科室复核并确认阶段收益" }],
  },
];

const weeklyFlow = [
  { week: "第1周", referrals: 950, activity: 840, backlog: 1160, cancellations: 58, leadTime: 18, utilization: 78 },
  { week: "第2周", referrals: 930, activity: 875, backlog: 1215, cancellations: 55, leadTime: 17, utilization: 81 },
  { week: "第3周", referrals: 910, activity: 925, backlog: 1200, cancellations: 43, leadTime: 15, utilization: 85 },
  { week: "第4周", referrals: 895, activity: 940, backlog: 1155, cancellations: 37, leadTime: 13, utilization: 88 },
  { week: "第5周", referrals: 870, activity: 945, backlog: 1080, cancellations: 31, leadTime: 11, utilization: 91 },
  { week: "第6周", referrals: 860, activity: 950, backlog: 990, cancellations: 26, leadTime: 9, utilization: 92 },
];

const practiceCards = [
  {
    label: "国家规范",
    title: "大型医用设备绩效专项审计",
    practice: "按单机贯通配置、采购、验收、使用、维修、盘点、处置和绩效评价，并保留公式与证据链。",
    applied: "已转化：生命周期组合、指标目标差距、单机追溯与责任行动。",
    href: "https://www.nhc.gov.cn/caiwusi/c100043/202311/a830e1effc8e458886dde10a49c2d906/files/1734002081819_92969.pdf",
  },
  {
    label: "国际方法",
    title: "WHO 设备台账与维护信息系统",
    practice: "把资产状态、预防性维护、维修工单、备件、合同和退役统一到可追踪的设备生命周期。",
    applied: "已转化：设备可用率/PM 目标、保障类任务和更新论证建议。",
    href: "https://www.who.int/publications/i/item/9789240111257",
  },
  {
    label: "运营案例",
    title: "NHS CT 需求—产能改进",
    practice: "每周同时观察转诊、活动量、在制/积压、取消和等待时间，用流程图找约束并小步验证方案。",
    applied: "已转化：周度需求—产能生命体征和情景方案收益跟踪。",
    href: "https://www.england.nhs.uk/long-read/case-study-improving-access-to-computed-tomography-ct/",
  },
];

function targetTone(value: number, target: number, inverse = false) {
  const achieved = inverse ? value <= target : value >= target;
  const near = inverse ? value <= target * 1.2 : value >= target * 0.94;
  return achieved ? "success" : near ? "warning" : "danger";
}

function MetricTarget({
  label,
  value,
  unit,
  target,
  targetLabel,
  inverse = false,
  icon,
}: {
  label: string;
  value: number | null;
  unit: string;
  target: number;
  targetLabel: string;
  inverse?: boolean;
  icon: React.ReactNode;
}) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <article className="target-card target-unavailable">
        <div className="target-card-top"><span>{icon}</span><small>{targetLabel}</small></div>
        <p>{label}</p>
        <strong>待发布</strong>
        <div className="target-progress" aria-hidden="true"><i style={{ width: "0%" }} /></div>
        <footer><span>目标 {target}{unit}</span><b>数据缺失</b></footer>
      </article>
    );
  }
  const tone = targetTone(value, target, inverse);
  const gap = inverse ? target - value : value - target;
  return (
    <article className={`target-card target-${tone}`}>
      <div className="target-card-top"><span>{icon}</span><small>{targetLabel}</small></div>
      <p>{label}</p>
      <strong>{value.toFixed(1)}{unit}</strong>
      <div className="target-progress"><i style={{ width: `${Math.min(100, Math.max(8, inverse ? (target / value) * 100 : (value / target) * 100))}%` }} /></div>
      <footer><span>目标 {target}{unit}</span><b>{gap >= 0 ? "已达标" : `差 ${Math.abs(gap).toFixed(1)}${unit}`}</b></footer>
    </article>
  );
}

function resolvedInsightFor(publishedData: PublishedDatasetView | undefined, deviceId: string) {
  return publishedData?.insights[deviceId]
    ?? insightFor(publishedData ? `published-missing:${deviceId}` : deviceId);
}

function finiteAverage(values: number[]) {
  const available = values.filter((value) => Number.isFinite(value));
  return available.length
    ? available.reduce((sum, value) => sum + value, 0) / available.length
    : null;
}

export default function ImprovementCenter({ devices, actions, setActions, onSelectDevice, notify, publishedData, demoMode = false }: ImprovementCenterProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState(devices[0]?.id ?? "");
  const [volumeLift, setVolumeLift] = useState(10);
  const [costReduction, setCostReduction] = useState(4);
  const [availabilityLift, setAvailabilityLift] = useState(2);
  const [reviewingActionId, setReviewingActionId] = useState("");
  const [reviewDraft, setReviewDraft] = useState({ actualValue: "", actualBenefit: "", evidence: "", reviewDate: "2026-08-11" });

  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? devices[0];
  const insights = devices.map((device) => resolvedInsightFor(publishedData, device.id)).filter((item) => item.dataStatus !== "unavailable");
  const averages = {
    utilization: finiteAverage(devices.map((device) => device.utilization)),
    availability: finiteAverage(insights.map((item) => item.availabilityRate)),
    pm: finiteAverage(insights.map((item) => item.pmCompletionRate)),
    wait: finiteAverage(insights.map((item) => item.onSiteWaitMinutes)),
  };

  const scenario = useMemo(() => {
    if (!selectedDevice) return null;
    const currentRevenue = selectedDevice.revenue;
    const currentCashCost = totalCost(selectedDevice) - selectedDevice.cost.depreciation;
    const controllableCost = selectedDevice.cost.maintenance + selectedDevice.cost.energy + selectedDevice.cost.indirect;
    const projectedRevenue = currentRevenue * (1 + volumeLift / 100);
    const projectedCashCost = currentCashCost
      + selectedDevice.cost.consumables * (volumeLift / 100)
      - controllableCost * (costReduction / 100);
    const currentContribution = currentRevenue - currentCashCost;
    const projectedContribution = projectedRevenue - projectedCashCost;
    const currentPayback = currentContribution > 0 ? selectedDevice.investment / currentContribution : null;
    const projectedPayback = projectedContribution > 0 ? selectedDevice.investment / projectedContribution : null;
    return {
      currentRevenue,
      projectedRevenue,
      currentContribution,
      projectedContribution,
      currentPayback,
      projectedPayback,
      incremental: projectedContribution - currentContribution,
      projectedAvailability: Number.isFinite(resolvedInsightFor(publishedData, selectedDevice.id).availabilityRate)
        ? Math.min(99.9, resolvedInsightFor(publishedData, selectedDevice.id).availabilityRate + availabilityLift)
        : null,
    };
  }, [availabilityLift, costReduction, publishedData, selectedDevice, volumeLift]);

  const portfolio = useMemo(() => devices.map((device) => {
    const insight = resolvedInsightFor(publishedData, device.id);
    const age = 2026 - Number(device.enabledDate.slice(0, 4));
    const paybackDelay = device.forecastPayback - device.planPayback;
    const riskScore = age * 4
      + (Number.isFinite(insight.availabilityRate) ? Math.max(0, 97 - insight.availabilityRate) * 4 : 0)
      + Math.max(0, 70 - device.utilization) * 1.2
      + Math.max(0, paybackDelay) * 7;
    let recommendation = "持续运行";
    let tone = "success";
    if (device.utilization < 60 || paybackDelay >= 2) {
      recommendation = "专项优化";
      tone = "danger";
    } else if (age >= 5 && Number.isFinite(insight.availabilityRate) && insight.availabilityRate < 95) {
      recommendation = "更新论证";
      tone = "warning";
    } else if ((Number.isFinite(insight.availabilityRate) && insight.availabilityRate < 97) || (Number.isFinite(insight.pmCompletionRate) && insight.pmCompletionRate < 95)) {
      recommendation = "保障提升";
      tone = "warning";
    }
    return { device, insight, age, riskScore, recommendation, tone };
  }).sort((a, b) => b.riskScore - a.riskScore), [devices, publishedData]);

  const completedActions = actions.filter((action) => action.status === "已完成");
  const activeActions = actions.filter((action) => action.status !== "已完成");
  const expectedBenefit = activeActions.reduce((sum, action) => sum + action.expectedBenefit, 0);
  const confirmedBenefit = completedActions.reduce((sum, action) => sum + (action.actualBenefit ?? 0), 0);

  function advanceAction(action: ImprovementAction) {
    const nextStatus: ActionStatus = action.status === "待启动" ? "进行中" : action.status === "进行中" ? "已完成" : "待启动";
    const nextProgress = nextStatus === "待启动" ? 15 : nextStatus === "进行中" ? 55 : 100;
    setActions((current) => current.map((item) => item.id === action.id ? {
      ...item,
      status: nextStatus,
      progress: nextProgress,
      history: [...(item.history ?? []), { at: new Date().toISOString(), status: nextStatus, note: "任务状态更新" }],
    } : item));
    notify(`${action.title} 已更新为“${nextStatus}”`);
  }

  function openReview(action: ImprovementAction) {
    setReviewingActionId(action.id);
    setReviewDraft({
      actualValue: action.actualValue?.toString() ?? "",
      actualBenefit: action.actualBenefit?.toString() ?? "",
      evidence: action.evidence ?? "",
      reviewDate: action.reviewDate ?? "2026-08-11",
    });
  }

  function saveReview(action: ImprovementAction) {
    const actualValue = Number(reviewDraft.actualValue);
    const actualBenefit = Number(reviewDraft.actualBenefit);
    if (!Number.isFinite(actualValue) || !Number.isFinite(actualBenefit) || !reviewDraft.evidence.trim()) {
      notify("请填写复测实际值、已确认收益和执行证据");
      return;
    }
    setActions((current) => current.map((item) => item.id === action.id ? {
      ...item,
      actualValue,
      actualBenefit,
      evidence: reviewDraft.evidence.trim(),
      reviewDate: reviewDraft.reviewDate,
      status: "已完成",
      progress: 100,
      history: [...(item.history ?? []), { at: new Date().toISOString(), status: "已完成", note: "完成复测并登记已确认收益" }],
    } : item));
    setReviewingActionId("");
    notify("复测结果和已确认收益已保存");
  }

  function saveScenario() {
    if (!selectedDevice || !scenario) return;
    const action: ImprovementAction = {
      id: `scenario-${selectedDevice.id}-${Date.now()}`,
      deviceId: selectedDevice.id,
      title: `${selectedDevice.shortName}产能与可控成本优化方案`,
      issue: `服务量 +${volumeLift}%、可控成本 -${costReduction}%、可用率 +${availabilityLift} 个百分点`,
      owner: `${selectedDevice.department} / 医学装备部`,
      dueDate: "2026-09-30",
      expectedBenefit: Math.max(0, Number(scenario.incremental.toFixed(1))),
      status: "待启动",
      priority: scenario.incremental >= 80 ? "高" : "中",
      progress: 10,
      baselineValue: selectedDevice.utilization,
      targetValue: Math.min(100, selectedDevice.utilization + volumeLift),
      metricUnit: "% 使用率",
      evidence: "",
      history: [{ at: new Date().toISOString(), status: "待启动", note: "由情景测算创建" }],
    };
    setActions((current) => [action, ...current]);
    notify("情景方案已保存到改进行动清单");
  }

  function resetActions() {
    if (!demoMode) {
      notify("正式模式不能写入演示任务");
      return;
    }
    setActions(initialActions);
    notify("改进行动已恢复为演示初始状态");
  }

  if (!selectedDevice || !scenario) return null;

  const scenarioBars = [
    { name: "现金贡献", 当前: Number(scenario.currentContribution.toFixed(1)), 方案后: Number(scenario.projectedContribution.toFixed(1)) },
    { name: "设备收入", 当前: Number(scenario.currentRevenue.toFixed(1)), 方案后: Number(scenario.projectedRevenue.toFixed(1)) },
  ];

  return (
    <>
      <div className="page-heading improvement-heading">
        <div>
          <div className="eyebrow"><Target size={15} />从指标预警到收益兑现</div>
          <h1>运营改进中心</h1>
          <p>用“发现差距—测算方案—指派责任—复盘收益”的闭环，把设备效益分析真正转化为管理动作。</p>
        </div>
        <div className="heading-actions">
          <span className="page-badge"><ShieldCheck size={16} />示例目标 · 可按院内制度配置</span>
          {demoMode ? <button className="secondary-button" onClick={resetActions}><RefreshCw size={16} />重置演示任务</button> : null}
        </div>
      </div>

      <section className="improvement-loop" aria-label="运营改进闭环">
        {[
          ["01", "发现差距", "对标目标、同类设备和趋势", <Gauge key="gauge" size={18} />],
          ["02", "情景测算", "统一收入、现金成本与回收口径", <Calculator key="calculator" size={18} />],
          ["03", "责任到人", "形成负责人、期限和预期收益", <ClipboardCheck key="clipboard" size={18} />],
          ["04", "复盘收益", "验证等待、可用率和效益改善", <CheckCircle2 key="check" size={18} />],
        ].map(([index, title, note, icon], itemIndex) => (
          <article key={String(title)}>
            <span>{icon}</span>
            <div><small>{index}</small><strong>{title}</strong><p>{note}</p></div>
            {itemIndex < 3 ? <ArrowRight className="loop-arrow" size={17} /> : null}
          </article>
        ))}
      </section>

      <div className="section-heading compact-section-heading">
        <div><h2>目标差距雷达</h2><p>目标为院内管理示例；阳性率等质量指标必须按设备类别和适用项目分组，不能直接横向排名。</p></div>
        <span className="chart-note">按当前纳管设备加权前的简单平均</span>
      </div>
      <section className="target-grid">
        <MetricTarget label="平均使用率" value={averages.utilization} unit="%" target={80} targetLabel="院内示例目标" icon={<Gauge size={17} />} />
        <MetricTarget label="设备可用率" value={averages.availability} unit="%" target={97} targetLabel="院内示例目标" icon={<Wrench size={17} />} />
        <MetricTarget label="PM 完成率" value={averages.pm} unit="%" target={95} targetLabel="院内示例目标" icon={<ShieldCheck size={17} />} />
        <MetricTarget label="现场等待" value={averages.wait} unit="分钟" target={30} targetLabel="院内示例目标" inverse icon={<Clock3 size={17} />} />
      </section>

      <div className="improvement-two-column scenario-section">
        <section className="panel scenario-panel">
          <div className="panel-heading">
            <div><h3>单机效益情景测算</h3><p>使用现金贡献口径估算回收期，折旧不作为现金支出；耗材随服务量联动。</p></div>
            <select value={selectedDevice.id} onChange={(event) => setSelectedDeviceId(event.target.value)}>
              {devices.map((device) => <option key={device.id} value={device.id}>{device.shortName}</option>)}
            </select>
          </div>
          <div className="scenario-controls">
            <label>
              <span><b>服务量提升</b><strong>+{volumeLift}%</strong></span>
              <input type="range" min="0" max="30" step="1" value={volumeLift} onChange={(event) => setVolumeLift(Number(event.target.value))} />
              <small>假设次均收入不变；耗材成本按服务量同比增加</small>
            </label>
            <label>
              <span><b>可控成本下降</b><strong>-{costReduction}%</strong></span>
              <input type="range" min="0" max="12" step="1" value={costReduction} onChange={(event) => setCostReduction(Number(event.target.value))} />
              <small>仅作用于维保、能源与间接成本，不压缩质量投入</small>
            </label>
            <label>
              <span><b>可用率提升</b><strong>+{availabilityLift}pp</strong></span>
              <input type="range" min="0" max="5" step="0.5" value={availabilityLift} onChange={(event) => setAvailabilityLift(Number(event.target.value))} />
              <small>作为保障目标展示，不重复折算收入，避免效益高估</small>
            </label>
          </div>
          <div className="scenario-results">
            <div><span>年度增量现金贡献</span><strong className={scenario.incremental >= 0 ? "positive" : "negative"}>{scenario.incremental >= 0 ? "+" : ""}{currency.format(scenario.incremental)} 万</strong><small>方案前后现金贡献差额</small></div>
            <div><span>现金回收期</span><strong>{scenario.projectedPayback ? `${scenario.projectedPayback.toFixed(1)} 年` : "尚不可回收"}</strong><small>当前 {scenario.currentPayback ? `${scenario.currentPayback.toFixed(1)} 年` : "尚不可回收"}</small></div>
            <div><span>目标可用率</span><strong>{scenario.projectedAvailability === null ? "待发布" : `${scenario.projectedAvailability.toFixed(1)}%`}</strong><small>{scenario.projectedAvailability === null ? "尚无设备保障事实" : `当前 ${resolvedInsightFor(publishedData, selectedDevice.id).availabilityRate.toFixed(1)}%`}</small></div>
          </div>
          <button className="primary-button scenario-save" onClick={saveScenario}><ClipboardCheck size={16} />保存为改进方案</button>
        </section>

        <section className="panel scenario-chart-panel">
          <div className="panel-heading"><div><h3>方案前后效益对比</h3><p>单位：万元/年 · 为管理测算，不替代财务预算审批</p></div><span className="chart-note">实时联动</span></div>
          <div className="scenario-chart">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scenarioBars} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="当前" fill="var(--primary-soft-strong)" radius={[5, 5, 0, 0]} barSize={34} />
                <Bar dataKey="方案后" fill="var(--green)" radius={[5, 5, 0, 0]} barSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="scenario-guardrail"><ShieldCheck size={17} /><span><strong>质量护栏</strong><small>方案执行期间同步监控报告合格率、重复检查率和患者等待，任一恶化即复盘。</small></span></div>
        </section>
      </div>

      {!publishedData ? <section className="panel flow-panel">
        <div className="panel-heading">
          <div><h3>需求—产能周监测</h3><p>借鉴 NHS 诊断服务改进：活动量不等于利用率，需同时观察转诊、完成量、积压、取消与等待。</p></div>
          <span className="chart-note">CT 改进样例 · 非真实诊疗数据</span>
        </div>
        <div className="flow-summary">
          <div><span>周转诊量</span><strong>860</strong><small><TrendingDown size={13} />较首周 -9.5%</small></div>
          <div><span>周完成量</span><strong>950</strong><small><TrendingUp size={13} />连续 4 周高于需求</small></div>
          <div><span>在册积压</span><strong>990</strong><small><TrendingDown size={13} />较峰值 -18.5%</small></div>
          <div><span>转诊至检查</span><strong>9 天</strong><small><TrendingDown size={13} />较首周缩短 9 天</small></div>
        </div>
        <div className="flow-chart-grid">
          <div className="flow-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyFlow} margin={{ top: 12, right: 15, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="referrals" name="转诊需求" stroke="var(--orange)" strokeWidth={2.2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="activity" name="完成量" stroke="var(--primary)" strokeWidth={2.4} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="backlog" name="积压" stroke="var(--violet)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flow-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyFlow} margin={{ top: 12, right: 15, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="week" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis yAxisId="right" orientation="right" domain={[70, 100]} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine yAxisId="right" y={90} stroke="var(--green)" strokeDasharray="4 4" />
                <Line yAxisId="left" type="monotone" dataKey="cancellations" name="取消数" stroke="var(--red)" strokeWidth={2.2} dot={{ r: 3 }} />
                <Line yAxisId="left" type="monotone" dataKey="leadTime" name="等待天数" stroke="var(--orange)" strokeWidth={2.2} dot={{ r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="utilization" name="利用率%" stroke="var(--green)" strokeWidth={2.4} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section> : <section className="panel flow-panel"><div className="panel-heading"><div><h3>需求—产能周监测</h3><p>正式模式只展示发布文件中的期间指标；当前版本尚未发布转诊、完成量、积压、取消与等待序列。</p></div><span className="chart-note">暂无发布事实</span></div></section>}

      <section className="panel action-center">
        <div className="panel-heading">
          <div><h3>管理行动闭环</h3><p>每项任务必须有问题证据、责任人、完成期限、预期收益和状态复盘。</p></div>
          <div className="action-summary"><span>{activeActions.length} 项进行中</span><strong>预期增益 {currency.format(expectedBenefit)} 万/年</strong><small>已确认收益 {currency.format(confirmedBenefit)} 万/年 · {completedActions.length} 项已完成</small></div>
        </div>
        <div className="action-board">
          {actions.map((action) => {
            const device = devices.find((item) => item.id === action.deviceId);
            const buttonLabel = action.status === "待启动" ? "开始处理" : action.status === "进行中" ? "标记完成" : "重新打开";
            return (
              <article key={action.id} className={`action-card action-${action.status === "已完成" ? "done" : action.priority === "高" ? "high" : "normal"}`}>
                <div className="action-card-head"><span className={`priority-pill priority-${action.priority}`}>{action.priority}优先级</span><span className={`status-pill ${action.status === "已完成" ? "success" : action.status === "进行中" ? "warning" : "neutral"}`}>{action.status}</span></div>
                <button className="action-title" onClick={() => device && onSelectDevice(device)}><strong>{action.title}</strong><ChevronRight size={15} /></button>
                <p>{action.issue}</p>
                <dl><div><dt>责任人</dt><dd>{action.owner}</dd></div><div><dt>完成期限</dt><dd>{action.dueDate}</dd></div><div><dt>预期增益</dt><dd>{currency.format(action.expectedBenefit)} 万/年</dd></div>{action.actualBenefit !== undefined ? <div><dt>已确认收益</dt><dd>{currency.format(action.actualBenefit)} 万/年</dd></div> : null}</dl>
                {(action.baselineValue !== undefined || action.evidence) ? <div className="action-evidence">
                  <strong>执行证据与复测</strong>
                  {action.baselineValue !== undefined ? <span>基线 {action.baselineValue}{action.metricUnit ?? ""} → 目标 {action.targetValue ?? "—"}{action.metricUnit ?? ""} → 实际 {action.actualValue ?? "待复测"}{action.metricUnit ?? ""}</span> : null}
                  <small>{action.evidence || "尚未上传/登记执行证据"}{action.reviewDate ? ` · 复测 ${action.reviewDate}` : ""}</small>
                </div> : null}
                <div className="action-progress"><i style={{ width: `${action.progress}%` }} /></div>
                <footer><span>{action.progress}%</span><div className="action-footer-buttons"><button className="review-button" onClick={() => openReview(action)}>记录复测</button><button onClick={() => advanceAction(action)}>{buttonLabel}<ArrowRight size={14} /></button></div></footer>
                {reviewingActionId === action.id ? <div className="action-review-form">
                  <label><span>复测实际值</span><input type="number" value={reviewDraft.actualValue} onChange={(event) => setReviewDraft((current) => ({ ...current, actualValue: event.target.value }))} /></label>
                  <label><span>已确认收益（万元/年）</span><input type="number" value={reviewDraft.actualBenefit} onChange={(event) => setReviewDraft((current) => ({ ...current, actualBenefit: event.target.value }))} /></label>
                  <label><span>复测日期</span><input type="date" value={reviewDraft.reviewDate} onChange={(event) => setReviewDraft((current) => ({ ...current, reviewDate: event.target.value }))} /></label>
                  <label className="review-evidence"><span>执行证据</span><textarea rows={2} value={reviewDraft.evidence} onChange={(event) => setReviewDraft((current) => ({ ...current, evidence: event.target.value }))} placeholder="填写排班、工单、会议纪要、附件编号或复测数据说明" /></label>
                  <div><button onClick={() => setReviewingActionId("")}>取消</button><button className="primary-button" onClick={() => saveReview(action)}>保存复测</button></div>
                </div> : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel lifecycle-panel">
        <div className="panel-heading"><div><h3>全生命周期资源配置建议</h3><p>综合设备年龄、使用率、可用率和回本偏差形成论证线索；最终更新决策仍需临床、技术、财务与合规评审。</p></div><span className="chart-note">风险排序 · 非自动采购结论</span></div>
        <div className="table-scroll">
          <table className="data-table lifecycle-table">
            <thead><tr><th>设备</th><th>启用年限</th><th className="num">使用率</th><th className="num">可用率 / PM</th><th className="num">年度净收益 / ROI</th><th className="num">计划 / 预计回本</th><th>管理建议</th><th>下一步</th></tr></thead>
            <tbody>
              {portfolio.map(({ device, insight, age, recommendation, tone }) => (
                <tr key={device.id}>
                  <td><button className="device-link" onClick={() => onSelectDevice(device)}><strong>{device.shortName}</strong><span>{device.department}</span></button></td>
                  <td>{age} 年</td>
                  <td className="num">{device.utilization}%</td>
                  <td className="num">{Number.isFinite(insight.availabilityRate) ? `${insight.availabilityRate.toFixed(1)}% / ${insight.pmCompletionRate.toFixed(0)}%` : "待发布"}</td>
                  <td className={`num ${netBenefit(device) < 0 ? "negative" : "positive"}`}>{currency.format(netBenefit(device))} 万 / {roi(device).toFixed(1)}%</td>
                  <td className="num">{device.planPayback.toFixed(1)} / {device.forecastPayback.toFixed(1)} 年</td>
                  <td><span className={`status-pill ${tone}`}>{recommendation}</span></td>
                  <td><button className="text-button" onClick={() => onSelectDevice(device)}>查看单机分析</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="section-heading practice-heading"><div><h2>行业优秀实践如何落到系统</h2><p>不照搬厂商大屏，而是把公开方法转成数据字段、管理频率、责任动作和可验证结果。</p></div></div>
      <section className="practice-grid">
        {practiceCards.map((practice) => (
          <article key={practice.title}>
            <div><span>{practice.label}</span><ExternalLink size={15} /></div>
            <h3>{practice.title}</h3>
            <p>{practice.practice}</p>
            <strong><Lightbulb size={15} />{practice.applied}</strong>
            <a href={practice.href} target="_blank" rel="noreferrer">查看官方来源<ArrowRight size={14} /></a>
          </article>
        ))}
      </section>

      <div className="method-note"><CircleAlert size={17} /><span><strong>口径提示：</strong>改进目标值、设备分组、现金流口径及收益复盘规则，需由财务、医务、设备、信息和使用科室共同确认后生效。</span></div>
    </>
  );
}
