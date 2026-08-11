export type DimensionId = "economic" | "efficiency" | "quality" | "experience" | "reliability";
export type InsightDataStatus = "published" | "demo" | "unavailable";

export const METRIC_DEFINITION_VERSION = "2026.08.11.1";
export const VISUALIZATION_DEFINITION_VERSION = "2026.08.11.1";

export type VisualizationDefinition = {
  id: string;
  title: string;
  grain: "examId" | "examId+bodyPart" | "deviceId+period";
  aggregation: string;
  audit: string;
};

export const visualizationDefinitions: VisualizationDefinition[] = [
  { id: "exam-volume-trend", title: "检查人次趋势", grain: "examId", aggregation: "COUNT(DISTINCT examId)", audit: "多部位检查只能计一次检查人次" },
  { id: "body-part-mix", title: "检查部位构成", grain: "examId+bodyPart", aggregation: "COUNT(DISTINCT examId, bodyPart)", audit: "部位记录关联检查事实，不重复整笔收入或成本" },
  { id: "device-benefit-trend", title: "设备效益趋势", grain: "deviceId+period", aggregation: "SUM(allocatedRevenue), SUM(allocatedCost)", audit: "金额必须记录 allocationRule 并满足分摊守恒" },
];

export type DeviceInsight = {
  deviceId: string;
  dataStatus: InsightDataStatus;
  scores: Record<DimensionId, number>;
  standardWorkload: number;
  activeHours: number;
  uptimeRate: number;
  loadRate: number;
  idleRate: number;
  peakShare: number;
  positiveRate: number;
  enhancementRate: number;
  reportQualityRate: number;
  repeatRate: number;
  appointmentWaitDays: number;
  onSiteWaitMinutes: number;
  reportHours: number;
  totalJourneyHours: number;
  satisfaction: number;
  availabilityRate: number;
  failuresPer1000Hours: number;
  downtimeHours: number;
  mttrHours: number;
  pmCompletionRate: number;
  pmPassRate: number;
  peerRank: number;
  peerCount: number;
  monthly: Array<{ month: string; revenue: number; cost: number; utilization: number }>;
  patientSources: Array<{ name: string; value: number }>;
  actions: Array<{ title: string; owner: string; due: string; status: "进行中" | "待确认" | "已完成" }>;
};

export type MetricDefinition = {
  dimension: DimensionId;
  metric: string;
  definition: string;
  formula: string;
  source: string;
  owner: string;
  frequency: string;
  example: string;
  audit?: string;
};

export const dimensionMeta: Array<{
  id: DimensionId;
  label: string;
  summary: string;
  focus: string;
}> = [
  { id: "economic", label: "经济效益", summary: "收入、全成本、现金贡献与回收", focus: "回答赚不赚钱、何时回本" },
  { id: "efficiency", label: "使用效率", summary: "工作量、有效时长、负荷与峰谷", focus: "回答设备是否真正有效产出" },
  { id: "quality", label: "临床质量", summary: "检查结构、合理使用与报告质控", focus: "回答设备是否用得合理" },
  { id: "experience", label: "患者体验", summary: "预约、现场等待、报告与全流程时长", focus: "回答流程是否更顺畅" },
  { id: "reliability", label: "设备保障", summary: "可用率、故障、停机、维修与 PM", focus: "回答保障是否可靠" },
];

const monthlyTemplate = [
  { month: "1月", revenue: 132, cost: 103, utilization: 76.1 },
  { month: "2月", revenue: 126, cost: 101, utilization: 74.8 },
  { month: "3月", revenue: 146, cost: 108, utilization: 79.2 },
  { month: "4月", revenue: 154, cost: 112, utilization: 81.4 },
  { month: "5月", revenue: 161, cost: 115, utilization: 84.1 },
  { month: "6月", revenue: 158, cost: 113, utilization: 83.0 },
  { month: "7月", revenue: 166, cost: 116, utilization: 85.2 },
  { month: "8月", revenue: 159, cost: 114, utilization: 82.6 },
  { month: "9月", revenue: 168, cost: 118, utilization: 86.0 },
  { month: "10月", revenue: 171, cost: 119, utilization: 86.8 },
  { month: "11月", revenue: 165, cost: 117, utilization: 84.9 },
  { month: "12月", revenue: 166, cost: 120, utilization: 83.7 },
];

function scaledMonthly(scale: number, utilizationDelta: number) {
  return monthlyTemplate.map((item) => ({
    ...item,
    revenue: Number((item.revenue * scale).toFixed(1)),
    cost: Number((item.cost * (0.88 + scale * 0.12)).toFixed(1)),
    utilization: Number(Math.max(32, Math.min(97, item.utilization + utilizationDelta)).toFixed(1)),
  }));
}

export const deviceInsights: Record<string, Omit<DeviceInsight, "dataStatus">> = {
  "mri-01": {
    deviceId: "mri-01",
    scores: { economic: 82, efficiency: 86, quality: 91, experience: 78, reliability: 88 },
    standardWorkload: 27840,
    activeHours: 6.8,
    uptimeRate: 83.4,
    loadRate: 78.6,
    idleRate: 21.4,
    peakShare: 62.4,
    positiveRate: 68,
    enhancementRate: 31.6,
    reportQualityRate: 97.2,
    repeatRate: 1.4,
    appointmentWaitDays: 3.2,
    onSiteWaitMinutes: 26,
    reportHours: 2.8,
    totalJourneyHours: 4.1,
    satisfaction: 92.6,
    availabilityRate: 96.8,
    failuresPer1000Hours: 2.8,
    downtimeHours: 34,
    mttrHours: 5.6,
    pmCompletionRate: 100,
    pmPassRate: 96,
    peerRank: 3,
    peerCount: 12,
    monthly: monthlyTemplate,
    patientSources: [
      { name: "门诊", value: 44 },
      { name: "住院", value: 31 },
      { name: "急诊", value: 12 },
      { name: "体检", value: 8 },
      { name: "其他", value: 5 },
    ],
    actions: [
      { title: "增加周二、周四晚间增强检查时段", owner: "医学影像科", due: "07-31", status: "进行中" },
      { title: "核对冷却系统两次告警与停机记录", owner: "医学装备部", due: "07-26", status: "待确认" },
      { title: "将报告平均时长降至 2.5 小时以内", owner: "影像诊断组", due: "08-15", status: "进行中" },
    ],
  },
  "ct-01": {
    deviceId: "ct-01",
    scores: { economic: 89, efficiency: 94, quality: 88, experience: 84, reliability: 91 },
    standardWorkload: 48620, activeHours: 8.3, uptimeRate: 92.1, loadRate: 86.5, idleRate: 13.5, peakShare: 58.2,
    positiveRate: 61.2, enhancementRate: 27.8, reportQualityRate: 96.5, repeatRate: 1.1,
    appointmentWaitDays: 1.4, onSiteWaitMinutes: 18, reportHours: 1.9, totalJourneyHours: 3.2, satisfaction: 94.1,
    availabilityRate: 98.1, failuresPer1000Hours: 1.7, downtimeHours: 18, mttrHours: 3.8, pmCompletionRate: 100, pmPassRate: 98,
    peerRank: 2, peerCount: 18, monthly: scaledMonthly(0.86, 8), patientSources: [{ name: "门诊", value: 39 }, { name: "住院", value: 34 }, { name: "急诊", value: 20 }, { name: "体检", value: 7 }],
    actions: [{ title: "午间高峰增加 1 个机动班次", owner: "医学影像科", due: "07-28", status: "进行中" }],
  },
  "robot-01": {
    deviceId: "robot-01",
    scores: { economic: 48, efficiency: 52, quality: 93, experience: 88, reliability: 79 },
    standardWorkload: 1030, activeHours: 3.6, uptimeRate: 61.5, loadRate: 48.2, idleRate: 51.8, peakShare: 71.4,
    positiveRate: 0, enhancementRate: 0, reportQualityRate: 98.1, repeatRate: 0.8,
    appointmentWaitDays: 5.8, onSiteWaitMinutes: 34, reportHours: 6.2, totalJourneyHours: 30.4, satisfaction: 91.8,
    availabilityRate: 94.2, failuresPer1000Hours: 3.9, downtimeHours: 62, mttrHours: 8.7, pmCompletionRate: 92, pmPassRate: 94,
    peerRank: 7, peerCount: 8, monthly: scaledMonthly(0.81, -33), patientSources: [{ name: "住院", value: 91 }, { name: "门诊", value: 5 }, { name: "急诊", value: 4 }],
    actions: [{ title: "跨科室建立手术适应证联合评估清单", owner: "手术部", due: "08-05", status: "待确认" }, { title: "评估维保合同与按次维修成本", owner: "医学装备部", due: "08-12", status: "进行中" }],
  },
  "linac-01": {
    deviceId: "linac-01",
    scores: { economic: 76, efficiency: 79, quality: 95, experience: 80, reliability: 74 },
    standardWorkload: 19120, activeHours: 7.1, uptimeRate: 80.2, loadRate: 74.7, idleRate: 25.3, peakShare: 67.9,
    positiveRate: 0, enhancementRate: 0, reportQualityRate: 98.6, repeatRate: 0.6,
    appointmentWaitDays: 4.6, onSiteWaitMinutes: 22, reportHours: 4.8, totalJourneyHours: 5.7, satisfaction: 90.4,
    availabilityRate: 93.8, failuresPer1000Hours: 4.4, downtimeHours: 78, mttrHours: 9.1, pmCompletionRate: 96, pmPassRate: 94,
    peerRank: 5, peerCount: 9, monthly: scaledMonthly(1.13, -5), patientSources: [{ name: "住院", value: 66 }, { name: "门诊", value: 29 }, { name: "其他", value: 5 }],
    actions: [{ title: "完成射频系统故障复盘与备件前置", owner: "医学装备部", due: "07-30", status: "进行中" }],
  },
  "ultrasound-01": {
    deviceId: "ultrasound-01",
    scores: { economic: 92, efficiency: 90, quality: 87, experience: 91, reliability: 93 },
    standardWorkload: 35480, activeHours: 7.7, uptimeRate: 89.5, loadRate: 84.2, idleRate: 15.8, peakShare: 54.3,
    positiveRate: 43.5, enhancementRate: 0, reportQualityRate: 95.8, repeatRate: 1.7,
    appointmentWaitDays: 0.8, onSiteWaitMinutes: 16, reportHours: 0.6, totalJourneyHours: 1.5, satisfaction: 95.2,
    availabilityRate: 98.7, failuresPer1000Hours: 1.2, downtimeHours: 11, mttrHours: 2.6, pmCompletionRate: 100, pmPassRate: 99,
    peerRank: 1, peerCount: 26, monthly: scaledMonthly(0.55, 5), patientSources: [{ name: "门诊", value: 52 }, { name: "住院", value: 27 }, { name: "体检", value: 15 }, { name: "急诊", value: 6 }],
    actions: [{ title: "将下午低谷时段开放给体检中心", owner: "超声医学科", due: "07-29", status: "已完成" }],
  },
  "bio-01": {
    deviceId: "bio-01",
    scores: { economic: 84, efficiency: 88, quality: 92, experience: 89, reliability: 90 },
    standardWorkload: 512000, activeHours: 12.4, uptimeRate: 91.2, loadRate: 82.8, idleRate: 17.2, peakShare: 49.8,
    positiveRate: 22.7, enhancementRate: 0, reportQualityRate: 99.1, repeatRate: 0.9,
    appointmentWaitDays: 0, onSiteWaitMinutes: 12, reportHours: 1.1, totalJourneyHours: 1.8, satisfaction: 94.8,
    availabilityRate: 97.9, failuresPer1000Hours: 1.9, downtimeHours: 21, mttrHours: 3.2, pmCompletionRate: 100, pmPassRate: 98,
    peerRank: 2, peerCount: 14, monthly: scaledMonthly(0.67, 1), patientSources: [{ name: "门诊", value: 46 }, { name: "住院", value: 38 }, { name: "急诊", value: 10 }, { name: "体检", value: 6 }],
    actions: [{ title: "优化夜间急诊样本优先级规则", owner: "检验科", due: "08-02", status: "进行中" }],
  },
};

function unavailableInsightFor(deviceId: string): DeviceInsight {
  const unavailable = Number.NaN;
  return {
    deviceId,
    dataStatus: "unavailable",
    scores: {
      economic: unavailable,
      efficiency: unavailable,
      quality: unavailable,
      experience: unavailable,
      reliability: unavailable,
    },
    standardWorkload: unavailable,
    activeHours: unavailable,
    uptimeRate: unavailable,
    loadRate: unavailable,
    idleRate: unavailable,
    peakShare: unavailable,
    positiveRate: unavailable,
    enhancementRate: unavailable,
    reportQualityRate: unavailable,
    repeatRate: unavailable,
    appointmentWaitDays: unavailable,
    onSiteWaitMinutes: unavailable,
    reportHours: unavailable,
    totalJourneyHours: unavailable,
    satisfaction: unavailable,
    availabilityRate: unavailable,
    failuresPer1000Hours: unavailable,
    downtimeHours: unavailable,
    mttrHours: unavailable,
    pmCompletionRate: unavailable,
    pmPassRate: unavailable,
    peerRank: unavailable,
    peerCount: unavailable,
    monthly: [],
    patientSources: [],
    actions: [],
  };
}

export function insightFor(deviceId: string): DeviceInsight {
  const insight = deviceInsights[deviceId];
  return insight
    ? { ...insight, dataStatus: "demo" }
    : unavailableInsightFor(deviceId);
}

export function hasInsightFor(deviceId: string) {
  return Object.prototype.hasOwnProperty.call(deviceInsights, deviceId);
}

export const metricDefinitions: MetricDefinition[] = [
  { dimension: "economic", metric: "多部位检查分摊收入/成本", definition: "一次检查涉及多个部位时，将检查级金额按冻结的分摊规则分配到部位", formula: "部位分摊额＝检查级金额×allocationWeight；同一examId各部位分摊额之和＝检查级金额", source: "HIS/收费＋RIS/PACS＋分摊规则", owner: "财务部确认；信息部实现", frequency: "每批次", example: "等比分摊/权重分摊/主部位归集", audit: "不得给每个bodyPart重复计入整笔收入或成本；报告冻结allocationRule" },
  { dimension: "economic", metric: "设备总收入", definition: "按检查/治疗完成时间归集的有效收费，扣除退费", formula: "Σ有效收费金额－Σ退费金额", source: "HIS/收费、RIS/PACS", owner: "财务部确认；信息部映射", frequency: "每日", example: "1,832万元", audit: "DRG/病组归因收入应单列" },
  { dimension: "economic", metric: "全成本", definition: "设备运营所消耗的全部资源", formula: "折旧＋维修维保＋人工＋耗材＋能耗＋房屋＋管理成本", source: "HRP、SPD、HR、CMMS、能耗", owner: "财务部牵头，多部门会签", frequency: "每月", example: "1,329万元", audit: "能耗只计一次；合同内维修避免重复" },
  { dimension: "economic", metric: "会计净收益", definition: "用于经营结果评价，包含折旧", formula: "设备总收入－全成本", source: "平台计算", owner: "财务部复核", frequency: "每月", example: "503万元" },
  { dimension: "economic", metric: "现金贡献", definition: "用于现金回收评价，不含非现金折旧", formula: "设备总收入－现金运营成本", source: "平台计算", owner: "财务部复核", frequency: "每月", example: "662万元", audit: "不得与会计净收益混用" },
  { dimension: "economic", metric: "年度ROI", definition: "年度会计收益相对原始投入的比例", formula: "年度净收益÷购置投入×100%", source: "HRP/资产卡片", owner: "财务部/资产部", frequency: "每年", example: "31.8%" },
  { dimension: "economic", metric: "简单现金回收期", definition: "初始投资通过现金贡献回收的估算年数", formula: "初始投资÷年度现金贡献", source: "平台计算", owner: "财务部", frequency: "每月滚动", example: "2.4年", audit: "不能用含折旧净收益直接替代现金流" },
  { dimension: "economic", metric: "净现值 NPV", definition: "将评估期现金流按医院批准的折现率折算到基准日", formula: "Σ(CFₜ÷(1+r)ᵗ)－初始投资", source: "HRP＋预算＋平台情景参数", owner: "财务部确认折现率与现金流", frequency: "每季度滚动", example: "286万元", audit: "折现率、评估期和残值必须随报告冻结" },
  { dimension: "economic", metric: "盈亏平衡工作量", definition: "覆盖固定成本所需的最低有效服务量", formula: "固定成本÷(次均收入－次均变动成本)", source: "HIS＋HRP＋SPD", owner: "财务部/运营部", frequency: "每月", example: "1,460例/月", audit: "单位边际贡献小于等于0时不得计算" },
  { dimension: "economic", metric: "次均收入/成本", definition: "单位有效服务量的收入与成本", formula: "收入或全成本÷有效服务量", source: "HIS＋RIS/PACS/LIS", owner: "财务部/使用科室", frequency: "每月", example: "781/567元" },
  { dimension: "efficiency", metric: "标准工作量", definition: "考虑不同项目复杂度后的可比工作量", formula: "Σ项目数量×项目权重", source: "RIS/PACS/LIS", owner: "医务处/绩效办定权重", frequency: "每日", example: "27,840点" },
  { dimension: "efficiency", metric: "检查人次（去重）", definition: "以检查事实主键统计完成的检查次数，多部位仍计一次", formula: "COUNT(DISTINCT examId)", source: "RIS/PACS/LIS", owner: "医务处/信息部", frequency: "每日", example: "23,450人次", audit: "禁止按bodyPart行数直接计检查人次" },
  { dimension: "efficiency", metric: "有效工作时长", definition: "设备实际执行检查/治疗的状态时长", formula: "Σ有效任务结束－开始时间", source: "设备IoT＋业务系统", owner: "设备科/使用科室", frequency: "实时", example: "6.8小时/日" },
  { dimension: "efficiency", metric: "开机率", definition: "设备开机时长相对计划可服务时长", formula: "开机时长÷计划可服务时长×100%", source: "设备IoT/日志", owner: "设备科确认排班", frequency: "实时", example: "83.4%", audit: "与负荷率、可用率分开" },
  { dimension: "efficiency", metric: "负荷率", definition: "开机时间内的有效作业占比", formula: "有效工作时长÷开机时长×100%", source: "IoT＋RIS/PACS", owner: "设备科/使用科室", frequency: "实时", example: "78.6%" },
  { dimension: "efficiency", metric: "闲置率", definition: "开机时间内无有效任务的占比", formula: "空闲时长÷开机时长×100%", source: "设备IoT/日志", owner: "设备科", frequency: "实时", example: "21.4%" },
  { dimension: "efficiency", metric: "高峰占比", definition: "配置的高峰时段内完成的工作量占比", formula: "高峰时段工作量÷总工作量×100%", source: "排队叫号＋RIS/PACS", owner: "运营部/使用科室", frequency: "每日", example: "62.4%" },
  { dimension: "quality", metric: "阳性率", definition: "限定设备类别、部位和项目后的阳性报告占比", formula: "阳性报告数÷有效报告数×100%", source: "RIS/PACS/LIS", owner: "医务处/质控办", frequency: "每月", example: "68.0%", audit: "不可跨设备类别直接排名" },
  { dimension: "quality", metric: "检查部位分析粒度", definition: "同一次检查的不同部位以检查和部位联合键关联", formula: "DISTINCT(examId, bodyPart)", source: "RIS/PACS", owner: "医务处/信息部", frequency: "每日", example: "exam-001+胸部", audit: "部位维度不改变检查人次，金额必须使用明确allocationRule" },
  { dimension: "quality", metric: "增强率", definition: "适用检查中采用增强方案的占比", formula: "增强检查数÷适用检查数×100%", source: "RIS/PACS＋药耗", owner: "影像科/质控办", frequency: "每月", example: "31.6%", audit: "分母必须限定适用项目" },
  { dimension: "quality", metric: "报告质量合格率", definition: "抽检报告达到质控标准的比例", formula: "合格报告数÷抽检报告数×100%", source: "质控系统", owner: "质控办/医务处", frequency: "每月", example: "97.2%" },
  { dimension: "quality", metric: "重复检查率", definition: "因技术或质量原因重复执行的占比", formula: "质量原因重复检查数÷有效检查数×100%", source: "RIS/PACS＋质控", owner: "使用科室", frequency: "每月", example: "1.4%" },
  { dimension: "experience", metric: "预约等待", definition: "预约申请到计划检查时间的时长", formula: "预约时间－申请时间", source: "预约平台", owner: "门诊部/运营部", frequency: "每日", example: "3.2天", audit: "与现场等待拆分" },
  { dimension: "experience", metric: "现场等待", definition: "患者签到/取号到检查开始的时长", formula: "检查开始－签到时间", source: "叫号系统＋RIS", owner: "使用科室", frequency: "实时", example: "26分钟" },
  { dimension: "experience", metric: "平均报告时长", definition: "检查结束到报告完成的平均耗时", formula: "AVG(报告完成－检查结束)", source: "RIS/PACS/LIS", owner: "诊断科室", frequency: "每日", example: "2.8小时" },
  { dimension: "experience", metric: "总诊疗时长", definition: "患者到院至结果可获取的全流程耗时", formula: "结果可获取－签到时间", source: "HIS＋叫号＋RIS/PACS", owner: "运营部", frequency: "每日", example: "4.1小时" },
  { dimension: "experience", metric: "爽约/流失率", definition: "预约未到或中途取消的患者占比", formula: "(未到＋取消)÷预约总数×100%", source: "预约平台/HIS", owner: "门诊部", frequency: "每日", example: "3.6%" },
  { dimension: "reliability", metric: "设备可用率", definition: "计划服务时段内设备可提供服务的比例", formula: "(计划可用时长－故障停机)÷计划可用时长", source: "CMMS＋IoT", owner: "医学装备部", frequency: "实时", example: "96.8%", audit: "不等于开机率或台数完好率" },
  { dimension: "reliability", metric: "标准化故障率", definition: "每1000运行小时发生的故障次数", formula: "故障次数÷运行时长×1000", source: "CMMS＋设备日志", owner: "医学装备部", frequency: "每月", example: "2.8次/千小时", audit: "材料中的2.8%已改为标准化率" },
  { dimension: "reliability", metric: "平均故障间隔 MTBF", definition: "两次可归责故障之间的平均有效运行时长", formula: "有效运行时长÷可归责故障次数", source: "CMMS＋设备事件", owner: "医学装备部", frequency: "每月", example: "356小时", audit: "故障为0时展示观察期下限，不伪造无穷值" },
  { dimension: "reliability", metric: "停机时长", definition: "故障导致设备不可用的时间总和", formula: "Σ恢复可用－故障开始", source: "CMMS/IoT", owner: "医学装备部", frequency: "实时", example: "34小时" },
  { dimension: "reliability", metric: "平均修复时长 MTTR", definition: "每次已修复故障的平均维修时长", formula: "总维修时长÷已修复故障次数", source: "CMMS", owner: "医学装备部", frequency: "每月", example: "5.6小时" },
  { dimension: "reliability", metric: "PM完成/通过率", definition: "预防性维护执行率与验收通过率，分别核算", formula: "已完成÷应完成；通过÷已完成", source: "CMMS/EAM", owner: "医学装备部", frequency: "每月", example: "100% / 96%", audit: "两个指标不得合并" },
  { dimension: "reliability", metric: "设备事件匹配率", definition: "有效设备事件成功绑定唯一设备主数据的比例", formula: "唯一匹配事件数÷有效设备事件数×100%", source: "采集网关＋资产主数据", owner: "信息部/医学装备部", frequency: "每日", example: "98.6%", audit: "一对多、无匹配和设备标识漂移必须进入隔离队列" },
  { dimension: "reliability", metric: "收费对账差异率", definition: "设备实际完成工作量与有效收费工作量的绝对差异", formula: "|实际工作量－有效收费工作量|÷实际工作量×100%", source: "设备事件＋HIS/收费", owner: "财务部/医保物价办/使用科室", frequency: "每日", example: "1.2%", audit: "免费复查、绿色通道、退费和补录须分类说明" },
  { dimension: "reliability", metric: "必填字段完整率", definition: "通过字段级校验的必填值占应填值总数的比例", formula: "有效必填值数÷应填必填值数×100%", source: "采集与质量规则引擎", owner: "信息部取数；业务部门确认", frequency: "每批次", example: "99.1%", audit: "不得用默认值回填掩盖缺失" },
];

export const collectionPaths = [
  { name: "业务系统数据中台", scope: "CT、MR、DR、超声、内镜及检验设备", data: "收入、服务量、项目结构、报告与临床质量", owner: "信息部集成；财务/医务复核", phase: "第一阶段", status: "优先落地" },
  { name: "扫码登记", scope: "全品类、通用与移动设备", data: "使用人、时间、科室、位置与服务记录", owner: "临床科室执行；设备科管理资产码", phase: "第二阶段", status: "快速覆盖" },
  { name: "设备物联网", scope: "重点有源、需状态/位置/能耗监测设备", data: "开机、有效、待机、停机、故障、位置与能耗", owner: "设备科/后勤主责；信息部接入", phase: "第三阶段", status: "精细监测" },
];

export const responsibilityMatrix = [
  { department: "资产部 / 医学装备部", provides: "资产编号、型号、原值、启用日、折旧年限、维保合同、维修工单", confirms: "设备主数据、保障口径与设备—接口映射", cadence: "月度" },
  { department: "财务部", provides: "有效收入、退费、折旧、分摊率、付款凭证与成本核算结果", confirms: "收入、全成本、ROI、现金贡献与回收期", cadence: "月结" },
  { department: "信息部", provides: "接口、主数据映射、任务调度、血缘、质量规则和平台运行", confirms: "取数过程与技术完整性，不替代业务口径签字", cadence: "实时/每日" },
  { department: "使用科室", provides: "服务量、班次、有效工时、项目归属、人员投入与异常原因", confirms: "业务真实性、设备使用与管理动作", cadence: "每日/每月" },
  { department: "医务处 / 质控办", provides: "项目权重、合理使用、报告和操作质控规则", confirms: "阳性率、增强率、质量指标适用范围", cadence: "月度" },
  { department: "人力资源 / 绩效办", provides: "岗位、人数、薪酬成本、工时与工作量权重", confirms: "人工成本与人员绩效口径", cadence: "月度" },
  { department: "物资 / SPD / 药剂", provides: "领用量、加权出库价、退库、收费属性与批次", confirms: "耗材/试剂成本及设备归属", cadence: "每日" },
  { department: "后勤 / 能源 / 基建", provides: "电水气用量、单价、设备面积与内部面积成本", confirms: "能耗和房屋占用成本", cadence: "每月" },
];

export const auditCorrections = [
  "全成本中的重复“能耗”已合并，并拆分水、电、气来源。",
  "会计净收益与现金贡献分开；回收期按现金贡献计算。",
  "开机率、负荷率、闲置率、可用率拆成四个独立指标。",
  "故障率改为“次/1000运行小时”，不再使用无分母百分比。",
  "预约等待与现场等待拆分，患者旅程起止时间可追溯。",
  "阳性率、增强率限定设备类别、部位、项目和适用人群后比较。",
];
