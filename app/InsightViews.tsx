"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Building2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Database,
  Download,
  Gauge,
  HeartPulse,
  History,
  Pencil,
  QrCode,
  Search,
  ShieldCheck,
  Stethoscope,
  Users,
  Wrench,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cloneDevicesForHospital, Device, netBenefit, roi, totalCost } from "./mock-data";
import {
  auditCorrections,
  collectionPaths,
  DeviceInsight,
  deviceInsights,
  dimensionMeta,
  DimensionId,
  insightFor,
  metricDefinitions,
  responsibilityMatrix,
} from "./metric-definitions";
import type { PublishedDatasetView } from "./published-data";
import styles from "./DeviceDossier.module.css";

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

const dimensionIcons: Record<DimensionId, React.ReactNode> = {
  economic: <CircleDollarSign size={19} />,
  efficiency: <Gauge size={19} />,
  quality: <Stethoscope size={19} />,
  experience: <HeartPulse size={19} />,
  reliability: <ShieldCheck size={19} />,
};

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function scoreClass(score: number) {
  if (score >= 85) return "strong";
  if (score >= 70) return "steady";
  return "risk";
}

function selectedProfiles(deviceIds: string[], publishedData?: PublishedDatasetView) {
  return deviceIds.map((id) => publishedData ? publishedData.insights[id] : deviceInsights[id]).filter(Boolean);
}

export function DimensionOverview({ deviceIds, publishedData }: { deviceIds: string[]; publishedData?: PublishedDatasetView }) {
  const profiles = selectedProfiles(deviceIds, publishedData);
  if (!profiles.length) return <section className="panel insight-unavailable"><Database size={22} /><div><h3>暂无已发布的五维评价</h3><p>设备已建立台账，但质量、体验和保障事实尚未通过数据准备中心发布。</p></div></section>;
  return (
    <section className="dimension-overview" aria-label="五维效益评价">
      {dimensionMeta.map((dimension) => {
        const score = average(profiles.map((profile) => profile.scores[dimension.id]));
        return (
          <article className={`dimension-card ${scoreClass(score)}`} key={dimension.id}>
            <div className="dimension-card-top">
              <span className="dimension-icon">{dimensionIcons[dimension.id]}</span>
              <strong>{score.toFixed(0)}</strong>
            </div>
            <h3>{dimension.label}</h3>
            <p>{dimension.summary}</p>
            <small>{dimension.focus}</small>
            <div className="score-track"><i style={{ width: `${score}%` }} /></div>
          </article>
        );
      })}
    </section>
  );
}

export function QualityExperiencePanel({ deviceIds, publishedData }: { deviceIds: string[]; publishedData?: PublishedDatasetView }) {
  const profiles = selectedProfiles(deviceIds, publishedData);
  if (!profiles.length) return <section className="panel insight-unavailable"><Database size={22} /><div><h3>暂无质量与患者体验数据</h3><p>发布相应事实和指标版本后，此模块会自动生成。</p></div></section>;
  const chartData = dimensionMeta.map((dimension) => ({
    name: dimension.label,
    评分: Number(average(profiles.map((profile) => profile.scores[dimension.id])).toFixed(1)),
  }));
  const values = {
    report: average(profiles.map((profile) => profile.reportQualityRate)),
    repeat: average(profiles.map((profile) => profile.repeatRate)),
    wait: average(profiles.map((profile) => profile.onSiteWaitMinutes)),
    reportHours: average(profiles.map((profile) => profile.reportHours)),
  };

  return (
    <section className="panel insight-panel">
      <div className="panel-heading"><div><h3>质量与患者体验</h3><p>质量指标按设备类别比较，等待指标按患者旅程拆分</p></div><span className="chart-note">{publishedData?.publication ? `发布 V${publishedData.publication.version}` : "演示数据"}</span></div>
      <div className="insight-kpis">
        <div><span>报告质控合格率</span><strong>{values.report.toFixed(1)}%</strong><small>质控系统 · 月度</small></div>
        <div><span>质量原因重复率</span><strong>{values.repeat.toFixed(1)}%</strong><small>{publishedData ? "质量文件 · 越低越好" : "检查报告演示 · 越低越好"}</small></div>
        <div><span>现场平均等待</span><strong>{values.wait.toFixed(0)}分</strong><small>签到至检查开始</small></div>
        <div><span>平均报告时长</span><strong>{values.reportHours.toFixed(1)}时</strong><small>检查结束至报告完成</small></div>
      </div>
      <div className="chart-area insight-score-chart">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 22, left: 10, bottom: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} hide />
            <YAxis type="category" dataKey="name" width={68} axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
            <Tooltip formatter={(value) => `${Number(value).toFixed(1)} 分`} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }} />
            <Bar dataKey="评分" fill="var(--primary)" radius={[0, 5, 5, 0]} barSize={10} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function ReliabilityPanel({ deviceIds, publishedData }: { deviceIds: string[]; publishedData?: PublishedDatasetView }) {
  const profiles = selectedProfiles(deviceIds, publishedData);
  if (!profiles.length) return <section className="panel insight-unavailable"><Database size={22} /><div><h3>暂无设备保障数据</h3><p>需要发布维修、停机和预防性维护事实。</p></div></section>;
  const availability = average(profiles.map((profile) => profile.availabilityRate));
  const faults = average(profiles.map((profile) => profile.failuresPer1000Hours));
  const downtime = profiles.reduce((sum, profile) => sum + profile.downtimeHours, 0);
  const pm = average(profiles.map((profile) => profile.pmCompletionRate));
  return (
    <section className="panel reliability-panel">
      <div className="panel-heading"><div><h3>设备保障</h3><p>可用率、标准化故障率与预防性维护</p></div><ShieldCheck size={20} /></div>
      <div className="reliability-hero">
        <div className="availability-ring" style={{ "--ring-value": `${availability * 3.6}deg` } as React.CSSProperties}><span><strong>{availability.toFixed(1)}%</strong><small>可用率</small></span></div>
        <div className="reliability-summary">
          <div><span>故障率</span><strong>{faults.toFixed(1)}</strong><small>次/1000运行小时</small></div>
          <div><span>故障停机</span><strong>{number.format(downtime)}</strong><small>小时</small></div>
          <div><span>PM完成率</span><strong>{pm.toFixed(0)}%</strong><small>已完成÷应完成</small></div>
        </div>
      </div>
      <div className="definition-note"><Database size={15} /><span>“可用率”按计划时长核算，不与开机率或设备台数完好率混用。</span></div>
    </section>
  );
}

export function WorkforcePerformancePanel({ deviceIds, publishedData }: { deviceIds: string[]; publishedData?: PublishedDatasetView }) {
  if (publishedData) return <section className="panel insight-unavailable"><Database size={22} /><div><h3>暂无已发布人员绩效事实</h3><p>正式模式只使用已发布数据；请发布人员、班次、报告与质控指标后配置展示。</p></div></section>;
  const scopeRatio = deviceIds.length ? deviceIds.length / 6 : 0;
  const workload = (value: number) => Math.round(value * scopeRatio).toLocaleString("zh-CN");
  const technicianMetrics = [
    { label: "诊疗人次", value: workload(1286), note: "标准工作量口径" },
    { label: "增强检查", value: workload(338), note: "高复杂度项目" },
    { label: "特殊项目", value: workload(126), note: "专项技术操作" },
  ];
  const doctorMetrics = [
    { label: "报告人次", value: workload(1174), note: "已审核并签发" },
    { label: "疑难病例", value: workload(86), note: "会诊/复核病例" },
    { label: "平均报告时长", value: "2.6h", note: "检查结束至签发" },
  ];
  const departmentMetrics = [
    { label: "质控完成率", value: 96.4 },
    { label: "报告及时率", value: 94.8 },
    { label: "标准工作量达成", value: 91.2 },
    { label: "培训完成率", value: 92.0 },
  ];

  return (
    <section className="panel workforce-panel" aria-label="人员绩效分析">
      <div className="panel-heading">
        <div><h3>人员绩效分析</h3><p>将设备使用与技师、诊断医生工作量及科室质控联动</p></div>
        <span className="chart-note">演示数据 · 非个人薪酬绩效</span>
      </div>
      <div className="workforce-grid">
        <article className="workforce-card workforce-technician">
          <div className="workforce-card-heading"><span><Users size={18} /></span><div><strong>技师工作量</strong><small>诊疗、增强、特殊项目与班次贡献</small></div></div>
          <div className="workforce-primary"><strong>{workload(1286)}</strong><span>诊疗人次</span><small>较上期 +8.3%</small></div>
          <div className="workforce-metric-list">{technicianMetrics.slice(1).map((metric) => <div key={metric.label}><span>{metric.label}<small>{metric.note}</small></span><strong>{metric.value}</strong></div>)}</div>
        </article>
        <article className="workforce-card workforce-doctor">
          <div className="workforce-card-heading"><span><Stethoscope size={18} /></span><div><strong>诊断医生工作量</strong><small>报告产出、疑难病例与报告时效</small></div></div>
          <div className="workforce-primary"><strong>{workload(1174)}</strong><span>报告人次</span><small>质控完成 96.4%</small></div>
          <div className="workforce-metric-list">{doctorMetrics.slice(1).map((metric) => <div key={metric.label}><span>{metric.label}<small>{metric.note}</small></span><strong>{metric.value}</strong></div>)}</div>
        </article>
        <article className="workforce-card workforce-department">
          <div className="workforce-card-heading"><span><BarChart3 size={18} /></span><div><strong>科室绩效与质控</strong><small>按设备、科室和项目汇总效率与质量贡献</small></div></div>
          <div className="workforce-progress-list">
            {departmentMetrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><i><b style={{ width: `${metric.value}%` }} /></i><strong>{metric.value.toFixed(1)}%</strong></div>)}
          </div>
          <p className="workforce-guidance"><CheckCircle2 size={15} />用于排班、培训与服务质量改进；正式绩效评价需由人力、医务和科室共同确认口径。</p>
        </article>
      </div>
    </section>
  );
}

export function CategoryPerformancePanel({ devices, onSelect }: { devices: Device[]; onSelect: (device: Device) => void }) {
  const data = devices.map((device) => ({
    id: device.id,
    name: device.shortName,
    收入: device.revenue,
    成本: totalCost(device),
    净收益: netBenefit(device),
    ROI: Number(roi(device).toFixed(1)),
  }));
  const ranked = [...devices].sort((a, b) => roi(b) - roi(a));
  return (
    <section className="panel category-panel">
      <div className="panel-heading"><div><h3>品类经营与资源配置</h3><p>同类横比、收益趋势与低效/紧缺/共享潜力识别</p></div><span className="chart-note">单机可下钻</span></div>
      <div className="category-layout">
        <div className="chart-area category-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 22 }}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="name" angle={-18} textAnchor="end" interval={0} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
              <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="收入" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="成本" fill="var(--primary-soft-strong)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="rank-list">
          {ranked.slice(0, 5).map((device, index) => (
            <button key={device.id} onClick={() => onSelect(device)}>
              <span className="rank-index">{index + 1}</span>
              <span><strong>{device.shortName}</strong><small>使用率 {device.utilization}% · {roi(device).toFixed(1)}% ROI</small></span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function DeviceQrCard({ device, hospitalId }: { device: Device; hospitalId?: string }) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    // 深链必须带医院上下文：同一账号可能有多家医院权限，缺少 hospital 参数时
    // 扫码会落在"当前医院"，跨院扫码只会得到一句"设备不在可见范围"。
    const params = new URLSearchParams();
    if (hospitalId) params.set("hospital", hospitalId);
    params.set("device", device.id);
    QRCode.toDataURL(`${window.location.origin}/?${params.toString()}`, { width: 220, margin: 1, errorCorrectionLevel: "M" })
      .then((dataUrl) => { if (!cancelled) setQrDataUrl(dataUrl); })
      .catch(() => { if (!cancelled) setQrDataUrl(""); });
    return () => { cancelled = true; };
  }, [device.id, hospitalId]);
  return (
    <section className="panel">
      <div className="panel-heading"><div><h3>设备二维码</h3><p>扫码直达本设备档案（需登录并具备权限）。</p></div><QrCode size={19} /></div>
      <div className={styles.qrBody}>
        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.qrImage} src={qrDataUrl} alt={`${device.name} 档案二维码`} />
        ) : <div className={styles.qrPending}>二维码在本机生成中，若长时间未出现请刷新页面。</div>}
        <dl className={styles.qrMeta}><div><dt>设备编号</dt><dd>{device.id}</dd></div><div><dt>资产编号</dt><dd>{device.assetCode}</dd></div></dl>
        {qrDataUrl ? <a className={styles.qrDownload} href={qrDataUrl} download={`${device.id}-二维码.png`}><Download size={15} />下载二维码</a> : null}
      </div>
    </section>
  );
}

function DeviceTimeline({ device, profile }: { device: Device; profile: DeviceInsight }) {
  const focusAction = profile.actions[0];
  const reliabilityFacts = Number.isFinite(profile.availabilityRate) && Number.isFinite(profile.downtimeHours)
    ? `可用率 ${profile.availabilityRate}% · 故障停机 ${profile.downtimeHours} 小时`
    : "可用率与停机事实待接入";
  const entries = [
    { label: device.enabledDate, title: "采购启用", note: [`投资 ${number.format(device.investment)} 万元`, device.fundingSource, device.usefulLifeYears ? `折旧年限 ${device.usefulLifeYears} 年` : null].filter(Boolean).join(" · ") },
    { label: "阶段", title: "运行使用", note: `本期服务量 ${number.format(device.serviceVolume)} ${device.serviceUnit} · 台账使用率 ${device.utilization}% · ${reliabilityFacts}` },
    { label: "阶段", title: "维保状态", note: `${device.maintenanceStatus ?? "维保方式待录入"} · ${device.monitoringStatus ?? "监测接入情况待录入"}` },
    { label: "阶段", title: "当前关注", note: `台账状态 ${device.status}${focusAction ? ` · ${focusAction.title}（${focusAction.owner} · 截止 ${focusAction.due} · ${focusAction.status}）` : profile.dataStatus === "unavailable" ? " · 行动建议将在洞察发布后生成" : " · 暂无待办行动建议"}` },
  ];
  return (
    <section className="panel">
      <div className="panel-heading"><div><h3>设备时间轴</h3><p>仅基于台账与已接入的洞察事实生成，未接入部分明确标注</p></div><History size={19} /></div>
      <ol className={styles.timeline}>
        {entries.map((entry) => <li key={entry.title}><span className={styles.timelineLabel}>{entry.label}</span><div><strong>{entry.title}</strong><small>{entry.note}</small></div></li>)}
        <li className={styles.timelineHint}><span className={styles.timelineLabel}>提示</span><div><small>完整时间轴（验收/维修工单/调拨）将在维修与台账事实接入后自动补齐。</small></div></li>
      </ol>
    </section>
  );
}

export function SingleEquipmentDetail({
  device,
  devices,
  onSelect,
  onBack,
  onEdit,
  publishedData,
  canEdit = true,
  hospitalId,
}: {
  device: Device;
  devices: Device[];
  onSelect: (device: Device) => void;
  onBack: () => void;
  onEdit: (device: Device) => void;
  canEdit?: boolean;
  publishedData?: PublishedDatasetView;
  hospitalId?: string;
}) {
  const profile = publishedData?.insights[device.id] ?? insightFor(publishedData ? `published-missing:${device.id}` : device.id);
  const cashOperatingCost = totalCost(device) - device.cost.depreciation;
  const cashContribution = device.revenue - cashOperatingCost;
  const cashPayback = cashContribution > 0 ? device.investment / cashContribution : 0;
  if (profile.dataStatus === "unavailable") {
    return (
      <>
        <div className="detail-toolbar">
          <button className="secondary-button" onClick={onBack}><ArrowLeft size={17} />返回设备台账</button>
          <label><span>查看设备</span><select value={device.id} onChange={(event) => { const next = devices.find((item) => item.id === event.target.value); if (next) onSelect(next); }}>{devices.map((item) => <option value={item.id} key={item.id}>{item.shortName} · {item.department}</option>)}</select></label>
        </div>
        <section className="detail-hero">
          <div className="device-monogram"><Activity size={26} /></div>
          <div className="detail-title"><span className="eyebrow">单机台账 · 待发布数据</span><h1>{device.name}</h1><p>{device.model} · {device.assetCode} · {device.department} · {device.enabledDate} 启用</p></div>
          <div className="detail-actions"><span className="status-pill neutral">暂无已发布洞察</span>{canEdit ? <button className="secondary-button" onClick={() => onEdit(device)}><Pencil size={16} />编辑台账</button> : null}</div>
        </section>
        <section className="panel single-device-unavailable"><Database size={25} /><div><h2>没有用其他设备的示例值代替</h2><p>这台设备尚未发布质量、效率、患者体验和保障事实。请在数据准备中心完成字段映射、质量门禁、业务复核与版本发布；发布后本页会按指标与可视化配置自动生成。</p></div></section>
        <div className="detail-metrics">
          <div><span>台账收入</span><strong>{number.format(device.revenue)}万</strong><small>未作为正式分析结论</small></div>
          <div><span>台账全成本</span><strong>{number.format(totalCost(device))}万</strong><small>等待批次复核</small></div>
          <div><span>台账净收益</span><strong>{number.format(netBenefit(device))}万</strong><small>等待已发布事实重算</small></div>
          <div><span>设备使用率</span><strong>{device.utilization}%</strong><small>台账录入值</small></div>
        </div>
        <div className={styles.dossierGrid}>
          <DeviceQrCard device={device} hospitalId={hospitalId} />
          <DeviceTimeline device={device} profile={profile} />
        </div>
      </>
    );
  }
  const publishedSnapshotId = publishedData?.publication?.snapshotId;
  const sourceRows = publishedSnapshotId ? publishedData.metricDefinitions.slice(0, 7).map((definition) => {
    const visualization = publishedData.visualizationDefinitions.find((item) => item.metricDefinitionId === definition.id || item.metricCode === definition.code);
    const point = visualization ? publishedData.analytics[visualization.id]?.[0] : null;
    return [
      definition.name,
      point ? `${number.format(point.value)} ${definition.unit}` : "见发布事实",
      definition.formula,
      `发布文件 ${publishedSnapshotId}`,
      `指标 v${definition.version}`,
    ];
  }) : [
    ["年度收入", `${number.format(device.revenue)} 万元`, "Σ有效收费－退费", "收入与业务量文件", "财务部"],
    ["会计净收益", `${number.format(netBenefit(device))} 万元`, "收入－含折旧全成本", "平台计算", "财务部"],
    ["现金贡献", `${number.format(cashContribution)} 万元`, "收入－不含折旧现金成本", "平台计算", "财务部"],
    ["简单现金回收期", `${cashPayback.toFixed(1)} 年`, "投资额÷年度现金贡献", "投资与成本文件＋平台计算", "财务/资产"],
    ["原计划 / 最新预计回本", `${device.planPayback.toFixed(1)} / ${device.forecastPayback.toFixed(1)} 年`, "按计划工作量、收费与成本假设滚动预测", "预算论证＋经营计划", "财务/资产/科室"],
    ["开机/负荷/闲置", `${profile.uptimeRate}% / ${profile.loadRate}% / ${profile.idleRate}%`, "三个指标分别计算", "运行时长与业务事件文件", "设备科/科室"],
    ["标准化故障率", `${profile.failuresPer1000Hours} 次/千小时`, "故障次数÷运行时长×1000", "工单与维修保养文件", "医学装备部"],
  ];
  const costRows = [
    ["人工", device.cost.labor], ["耗材", device.cost.consumables], ["折旧", device.cost.depreciation], ["维修维保", device.cost.maintenance],
    ["水电气", device.cost.energy], ["房屋", device.cost.space], ["管理", device.cost.indirect],
  ];
  const maxCost = Math.max(...costRows.map(([, value]) => Number(value)));
  const pieColors = ["var(--primary)", "var(--green)", "var(--orange)", "var(--violet)", "var(--cyan)"];

  return (
    <>
      <div className="detail-toolbar">
        <button className="secondary-button" onClick={onBack}><ArrowLeft size={17} />返回设备台账</button>
        <label><span>查看设备</span><select value={device.id} onChange={(event) => { const next = devices.find((item) => item.id === event.target.value); if (next) onSelect(next); }}>{devices.map((item) => <option value={item.id} key={item.id}>{item.shortName} · {item.department}</option>)}</select></label>
      </div>
      <section className="detail-hero">
        <div className="device-monogram"><Activity size={26} /></div>
        <div className="detail-title"><span className="eyebrow">单机综合分析 · {publishedData?.publication ? `发布 V${publishedData.publication.version}` : "模拟数据"}</span><h1>{device.name}</h1><p>{device.model} · {device.assetCode} · {device.department} · {device.enabledDate} 启用</p></div>
        <div className="detail-actions"><span className={`status-pill ${device.status === "运行良好" ? "success" : device.status === "需要关注" ? "warning" : "danger"}`}>{device.status}</span>{canEdit ? <button className="secondary-button" onClick={() => onEdit(device)}><Pencil size={16} />编辑台账</button> : <span className="page-badge">只读权限</span>}</div>
      </section>

      <DimensionOverview deviceIds={[device.id]} publishedData={publishedData} />

      <div className="detail-metrics">
        <div><span>年度收入</span><strong>{number.format(device.revenue)}万</strong><small>{publishedData ? "当前发布版本 · 暂无上期同比" : "演示同比 +8.6%"}</small></div>
        <div><span>会计净收益</span><strong>{number.format(netBenefit(device))}万</strong><small>含折旧全成本</small></div>
        <div><span>现金贡献</span><strong>{number.format(cashContribution)}万</strong><small>用于回收期评估</small></div>
        <div><span>简单现金回收期</span><strong>{cashPayback.toFixed(1)}年</strong><small>按年度现金贡献静态估算</small></div>
        <div><span>有效服务量</span><strong>{number.format(device.serviceVolume)}</strong><small>{device.serviceUnit}</small></div>
        <div><span>原计划 / 最新预计</span><strong>{device.planPayback.toFixed(1)}/{device.forecastPayback.toFixed(1)}年</strong><small>{publishedData ? `当前发布指标；同类排名 ${profile.peerRank}/${profile.peerCount}` : `演示管理预测；同类排名 ${profile.peerRank}/${profile.peerCount}`}</small></div>
      </div>

      <div className="detail-grid">
        <section className="panel detail-wide">
          <div className="panel-heading"><div><h3>收入、成本与使用率趋势</h3><p>{publishedData ? "仅展示当前 snapshot 内已发布的期间事实" : "演示月度事实；正式报告按发布期间锁定"}</p></div><span className="chart-note">万元 / %</span></div>
          <div className="chart-area detail-trend-chart">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={profile.monthly} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis yAxisId="money" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis yAxisId="rate" orientation="right" domain={[40, 100]} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="money" dataKey="revenue" name="收入" fill="var(--primary)" radius={[4, 4, 0, 0]} barSize={15} />
                <Bar yAxisId="money" dataKey="cost" name="成本" fill="var(--primary-soft-strong)" radius={[4, 4, 0, 0]} barSize={15} />
                <Line yAxisId="rate" type="monotone" dataKey="utilization" name="使用率" stroke="var(--green)" strokeWidth={2.2} dot={{ r: 2.5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><h3>全成本拆解</h3><p>含折旧的会计成本，避免维保合同与工单重复</p></div></div>
          <div className="cost-bars">
            {costRows.map(([label, value]) => <div key={String(label)}><span>{label}</span><i><b style={{ width: `${(Number(value) / maxCost) * 100}%` }} /></i><strong>{number.format(Number(value))}万</strong></div>)}
          </div>
        </section>
      </div>

      <div className="detail-grid three-panels">
        <section className="panel clinical-panel">
          <div className="panel-heading"><div><h3>临床质量</h3><p>仅在同类设备、相同部位与项目内比较</p></div><Stethoscope size={19} /></div>
          <div className="compact-kpis"><div><span>阳性率</span><strong>{profile.positiveRate || "—"}{profile.positiveRate ? "%" : ""}</strong></div><div><span>增强率</span><strong>{profile.enhancementRate || "—"}{profile.enhancementRate ? "%" : ""}</strong></div><div><span>报告合格</span><strong>{profile.reportQualityRate}%</strong></div><div><span>重复检查</span><strong>{profile.repeatRate}%</strong></div></div>
          <div className="definition-note"><ShieldCheck size={14} /><span>阳性率不是越高越好，需结合患者来源与适应证审核。</span></div>
        </section>
        <section className="panel journey-panel">
          <div className="panel-heading"><div><h3>患者旅程</h3><p>拆分预约等待与现场等待</p></div><HeartPulse size={19} /></div>
          <div className="journey-line">
            <div><i>1</i><span>预约</span><strong>{profile.appointmentWaitDays}天</strong></div>
            <div><i>2</i><span>现场等待</span><strong>{profile.onSiteWaitMinutes}分</strong></div>
            <div><i>3</i><span>检查/治疗</span><strong>{profile.activeHours}时/日</strong></div>
            <div><i>4</i><span>报告</span><strong>{profile.reportHours}时</strong></div>
          </div>
          <div className="journey-footer"><span>全流程 {profile.totalJourneyHours} 小时</span><strong>满意度 {profile.satisfaction}%</strong></div>
        </section>
        <section className="panel patient-source-panel">
          <div className="panel-heading"><div><h3>患者来源</h3><p>支撑流程优化与合理使用分析</p></div><Users size={19} /></div>
          <div className="patient-source-layout">
            <div className="chart-area source-pie"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={profile.patientSources} dataKey="value" nameKey="name" innerRadius={35} outerRadius={56} paddingAngle={2}>{profile.patientSources.map((item, index) => <Cell key={item.name} fill={pieColors[index % pieColors.length]} />)}</Pie><Tooltip formatter={(value) => `${value}%`} contentStyle={{ borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface)" }} /></PieChart></ResponsiveContainer></div>
            <div className="source-mini-legend">{profile.patientSources.map((item, index) => <div key={item.name}><i style={{ background: pieColors[index % pieColors.length] }} /><span>{item.name}</span><strong>{item.value}%</strong></div>)}</div>
          </div>
        </section>
      </div>

      <div className="detail-grid">
        <section className="panel reliability-detail">
          <div className="panel-heading"><div><h3>设备保障与 PM</h3><p>故障率统一为次/1000运行小时</p></div><Wrench size={19} /></div>
          <div className="compact-kpis five"><div><span>可用率</span><strong>{profile.availabilityRate}%</strong></div><div><span>故障率</span><strong>{profile.failuresPer1000Hours}</strong><small>次/千小时</small></div><div><span>停机</span><strong>{profile.downtimeHours}h</strong></div><div><span>MTTR</span><strong>{profile.mttrHours}h</strong></div><div><span>PM完成/通过</span><strong>{profile.pmCompletionRate}/{profile.pmPassRate}%</strong></div></div>
        </section>
        <section className="panel action-panel">
          <div className="panel-heading"><div><h3>管理行动闭环</h3><p>异常必须落到责任人与截止时间</p></div><CheckCircle2 size={19} /></div>
          <div className="action-list">{profile.actions.map((action) => <div key={action.title}><span className={`status-pill ${action.status === "已完成" ? "success" : action.status === "进行中" ? "warning" : "neutral"}`}>{action.status}</span><span><strong>{action.title}</strong><small>{action.owner} · 截止 {action.due}</small></span></div>)}</div>
        </section>
      </div>

      <div className={styles.dossierGrid}>
        <DeviceQrCard device={device} hospitalId={hospitalId} />
        <DeviceTimeline device={device} profile={profile} />
      </div>

      <section className="panel lineage-panel">
        <div className="panel-heading"><div><h3>关键值来源与计算血缘</h3><p>同屏显示值、公式、系统来源与业务责任，便于复核</p></div><span className="chart-note">口径版本 2026-V2.0</span></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>指标</th><th>当前值</th><th>计算方法</th><th>系统来源</th><th>业务确认</th></tr></thead><tbody>{sourceRows.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>
      </section>
    </>
  );
}

export function MetricGovernanceCenter() {
  const [dimension, setDimension] = useState<DimensionId | "all">("all");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => metricDefinitions.filter((metric) => {
    const matchesDimension = dimension === "all" || metric.dimension === dimension;
    const haystack = `${metric.metric}${metric.definition}${metric.formula}${metric.source}${metric.owner}`.toLowerCase();
    return matchesDimension && haystack.includes(query.toLowerCase());
  }), [dimension, query]);

  return (
    <>
      <section className="panel audit-panel">
        <div className="panel-heading"><div><h3>口径评审记录</h3><p>已将需求材料中的口径歧义逐项转为可执行的数据规则</p></div><span className="status-pill success">6 项已修正</span></div>
        <div className="audit-grid">{auditCorrections.map((item, index) => <div key={item}><span>{index + 1}</span><p>{item}</p></div>)}</div>
      </section>

      <section className="panel collection-panel">
        <div className="panel-heading"><div><h3>三类数据采集路径</h3><p>先重点设备，再扩展全品类；普适性与精度分层建设</p></div></div>
        <div className="collection-grid">{collectionPaths.map((path) => <article key={path.name}><span>{path.phase}</span><h4>{path.name}</h4><p>{path.scope}</p><dl><div><dt>可获得数据</dt><dd>{path.data}</dd></div><div><dt>责任边界</dt><dd>{path.owner}</dd></div></dl><strong>{path.status}</strong></article>)}</div>
      </section>

      <section className="panel metric-dictionary">
        <div className="panel-heading"><div><h3>指标字典：值从哪里来、怎么算、谁确认</h3><p>共 {metricDefinitions.length} 个核心指标；信息部负责取数过程，业务部门负责口径签字</p></div><span className="chart-note">示例值均为模拟</span></div>
        <div className="dictionary-toolbar">
          <div className="dimension-tabs"><button className={dimension === "all" ? "active" : ""} onClick={() => setDimension("all")}>全部</button>{dimensionMeta.map((item) => <button className={dimension === item.id ? "active" : ""} onClick={() => setDimension(item.id)} key={item.id}>{item.label}</button>)}</div>
          <label className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索指标、公式、系统或部门" /></label>
        </div>
        <div className="table-scroll"><table className="data-table dictionary-table"><thead><tr><th>维度/指标</th><th>定义</th><th>计算公式</th><th>来源系统</th><th>提供/确认部门</th><th>频率</th><th>示例值</th><th>审核说明</th></tr></thead><tbody>{filtered.map((metric) => <tr key={`${metric.dimension}-${metric.metric}`}><td><span className={`dimension-pill dimension-${metric.dimension}`}>{dimensionMeta.find((item) => item.id === metric.dimension)?.label}</span><strong>{metric.metric}</strong></td><td>{metric.definition}</td><td><code>{metric.formula}</code></td><td>{metric.source}</td><td>{metric.owner}</td><td>{metric.frequency}</td><td>{metric.example}</td><td>{metric.audit ?? "—"}</td></tr>)}</tbody></table></div>
      </section>

      <section className="panel responsibility-panel">
        <div className="panel-heading"><div><h3>部门责任矩阵</h3><p>文件提供、口径确认和发布复核分开，形成可追责的数据治理闭环</p></div></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>部门/角色</th><th>需要提供</th><th>需要确认</th><th>建议频率</th></tr></thead><tbody>{responsibilityMatrix.map((row) => <tr key={row.department}><td><strong>{row.department}</strong></td><td>{row.provides}</td><td>{row.confirms}</td><td>{row.cadence}</td></tr>)}</tbody></table></div>
      </section>
    </>
  );
}

function extremeChip(value: number, values: number[]) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === min) return null;
  if (value === max) return <i className={`${styles.extremeChip} ${styles.chipHigh}`}>最高</i>;
  if (value === min) return <i className={`${styles.extremeChip} ${styles.chipLow}`}>最低</i>;
  return null;
}

export function HospitalComparePanel({ hospitals, activeHospitalId, onSwitchHospital }: {
  hospitals: Array<{ id: string; name: string; shortName: string; level: string; region: string }>;
  activeHospitalId: string;
  onSwitchHospital: (hospitalId: string) => void;
}) {
  const rows = useMemo(() => hospitals.map((hospital) => {
    const fleet = cloneDevicesForHospital(hospital.id);
    return {
      hospital,
      deviceCount: fleet.length,
      investment: fleet.reduce((sum, item) => sum + item.investment, 0),
      revenue: fleet.reduce((sum, item) => sum + item.revenue, 0),
      controllableCost: fleet.reduce((sum, item) => sum + totalCost(item) - item.cost.depreciation, 0),
      net: fleet.reduce((sum, item) => sum + netBenefit(item), 0),
      utilization: average(fleet.map((item) => item.utilization)),
      attention: fleet.filter((item) => item.utilization < 55 || netBenefit(item) < 0).length,
    };
  }), [hospitals]);
  if (!rows.length) return <section className="panel insight-unavailable"><Database size={22} /><div><h3>暂无可对比的医院</h3><p>请先在权限管理中配置医院并授予访问权限。</p></div></section>;
  const columnValues = {
    deviceCount: rows.map((row) => row.deviceCount),
    investment: rows.map((row) => row.investment),
    revenue: rows.map((row) => row.revenue),
    controllableCost: rows.map((row) => row.controllableCost),
    net: rows.map((row) => row.net),
    utilization: rows.map((row) => row.utilization),
    attention: rows.map((row) => row.attention),
  };
  return (
    <section className="panel">
      <div className="panel-heading"><div><h3>集团多院区对比</h3><p>对比基于各院当前工作区数据；接入各院正式发布数据后自动切换为已发布口径。</p></div><Building2 size={19} /></div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>医院</th><th>台数（套）</th><th>总投资（万元）</th><th>年收入（万元）</th><th>可控成本合计（万元）</th><th>净收益（万元）</th><th>平均使用率</th><th>需关注台数</th><th>操作</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.hospital.id} className={row.hospital.id === activeHospitalId ? styles.activeRow : undefined}>
                <td><div className={styles.hospitalCell}><strong>{row.hospital.shortName}{row.hospital.id === activeHospitalId ? <i className={styles.currentTag}>当前</i> : null}</strong><small>{row.hospital.name} · {row.hospital.level} · {row.hospital.region}</small></div></td>
                <td>{row.deviceCount}{extremeChip(row.deviceCount, columnValues.deviceCount)}</td>
                <td>{number.format(row.investment)}{extremeChip(row.investment, columnValues.investment)}</td>
                <td>{number.format(row.revenue)}{extremeChip(row.revenue, columnValues.revenue)}</td>
                <td>{number.format(row.controllableCost)}{extremeChip(row.controllableCost, columnValues.controllableCost)}</td>
                <td>{number.format(row.net)}{extremeChip(row.net, columnValues.net)}</td>
                <td>{row.utilization.toFixed(1)}%{extremeChip(row.utilization, columnValues.utilization)}</td>
                <td>{row.attention}{extremeChip(row.attention, columnValues.attention)}</td>
                <td><button className="secondary-button" onClick={() => onSwitchHospital(row.hospital.id)}>进入<ChevronRight size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="definition-note"><Database size={15} /><span>可控成本＝全成本－折旧；需关注台数口径：使用率低于 55% 或净收益为负。</span></div>
    </section>
  );
}
