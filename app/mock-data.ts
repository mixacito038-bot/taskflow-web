export type DeviceStatus = "运行良好" | "需要关注" | "效益预警";

export type CostBreakdown = {
  labor: number;
  consumables: number;
  depreciation: number;
  maintenance: number;
  energy: number;
  space: number;
  indirect: number;
};

export type Device = {
  id: string;
  assetCode: string;
  name: string;
  shortName: string;
  model: string;
  category?: string;
  manufacturer?: string;
  serialNumber?: string;
  department: string;
  location?: string;
  enabledDate: string;
  fundingSource?: string;
  usefulLifeYears?: number;
  depreciationMethod?: string;
  licenseNumber?: string;
  maintenanceStatus?: string;
  monitoringStatus?: string;
  investment: number;
  quantity: number;
  serviceVolume: number;
  serviceUnit: string;
  revenue: number;
  utilization: number;
  planPayback: number;
  forecastPayback: number;
  status: DeviceStatus;
  cost: CostBreakdown;
};

export type ModuleSize = "small" | "medium" | "wide" | "full";

export type DashboardModule = {
  id: string;
  name: string;
  description: string;
  visible: boolean;
  size: ModuleSize;
};

export type CostEntry = {
  id: string;
  type: "人工" | "耗材";
  deviceId: string;
  deviceName: string;
  item: string;
  detail: string;
  period: string;
  amount: number;
  owner: string;
  createdAt: string;
};

export type DataSource = {
  name: string;
  category: string;
  fields: string;
  owner: string;
  frequency: string;
  status: "已连接" | "待配置" | "人工填报";
  lastSync: string;
};

export const initialDevices: Device[] = [
  {
    id: "mri-01",
    assetCode: "YLSB-2021-0036",
    name: "3.0T 磁共振成像系统",
    shortName: "3.0T 磁共振",
    model: "MAGNETOM Vida",
    category: "诊断类（放射）",
    manufacturer: "西门子医疗",
    serialNumber: "MRI-VDA-20210318",
    department: "医学影像科",
    location: "医技楼二层 MR1 机房",
    enabledDate: "2021-03-18",
    fundingSource: "自筹资金",
    usefulLifeYears: 10,
    depreciationMethod: "平均年限法",
    licenseNumber: "乙类大型设备配置许可证",
    maintenanceStatus: "全保合同",
    monitoringStatus: "运行状态文件待导入",
    investment: 1580,
    quantity: 1,
    serviceVolume: 23450,
    serviceUnit: "检查人次",
    revenue: 1832,
    utilization: 83,
    planPayback: 4,
    forecastPayback: 4.5,
    status: "运行良好",
    cost: { labor: 306, consumables: 186, depreciation: 159, maintenance: 239, energy: 120, space: 106, indirect: 213 },
  },
  {
    id: "ct-01",
    assetCode: "YLSB-2022-0018",
    name: "128 排螺旋 CT",
    shortName: "128 排 CT",
    model: "Revolution CT",
    category: "诊断类（放射）",
    manufacturer: "GE 医疗",
    serialNumber: "CT-REV-20220610",
    department: "医学影像科",
    location: "门诊楼一层 CT2 机房",
    enabledDate: "2022-06-10",
    fundingSource: "财政专项 60% + 自筹 40%",
    usefulLifeYears: 10,
    depreciationMethod: "平均年限法",
    licenseNumber: "乙类大型设备配置许可证",
    maintenanceStatus: "全保合同",
    monitoringStatus: "采集器 + OCR 已接入",
    investment: 980,
    quantity: 1,
    serviceVolume: 42120,
    serviceUnit: "检查人次",
    revenue: 1550,
    utilization: 91,
    planPayback: 3,
    forecastPayback: 3.4,
    status: "运行良好",
    cost: { labor: 235, consumables: 190, depreciation: 123, maintenance: 179, energy: 134, space: 78, indirect: 181 },
  },
  {
    id: "robot-01",
    assetCode: "YLSB-2023-0007",
    name: "腔镜手术机器人",
    shortName: "手术机器人",
    model: "da Vinci Xi",
    category: "手术治疗类",
    manufacturer: "Intuitive Surgical",
    serialNumber: "DVXI-20230208",
    department: "手术部",
    location: "手术中心 8 号手术间",
    enabledDate: "2023-02-08",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内准入备案完整",
    maintenanceStatus: "原厂维保",
    monitoringStatus: "工单系统已接入",
    investment: 2200,
    quantity: 1,
    serviceVolume: 820,
    serviceUnit: "手术台次",
    revenue: 1480,
    utilization: 48,
    planPayback: 6,
    forecastPayback: 8.6,
    status: "效益预警",
    cost: { labor: 314, consumables: 513, depreciation: 215, maintenance: 248, energy: 83, space: 99, indirect: 183 },
  },
  {
    id: "linac-01",
    assetCode: "YLSB-2020-0051",
    name: "医用直线加速器",
    shortName: "直线加速器",
    model: "TrueBeam STx",
    category: "治疗类（放疗）",
    manufacturer: "瓦里安医疗",
    serialNumber: "TBSTX-20201126",
    department: "放疗科",
    location: "肿瘤中心负一层加速器机房",
    enabledDate: "2020-11-26",
    fundingSource: "专项债 + 自筹",
    usefulLifeYears: 10,
    depreciationMethod: "平均年限法",
    licenseNumber: "放射诊疗许可有效",
    maintenanceStatus: "全保合同",
    monitoringStatus: "设备日志已接入",
    investment: 1800,
    quantity: 1,
    serviceVolume: 16800,
    serviceUnit: "治疗例次",
    revenue: 2100,
    utilization: 76,
    planPayback: 5,
    forecastPayback: 5.2,
    status: "需要关注",
    cost: { labor: 379, consumables: 190, depreciation: 174, maintenance: 300, energy: 205, space: 126, indirect: 206 },
  },
  {
    id: "ultrasound-01",
    assetCode: "YLSB-2024-0023",
    name: "高端彩色多普勒超声",
    shortName: "高端超声",
    model: "EPIQ Elite",
    category: "诊断类（超声）",
    manufacturer: "飞利浦医疗",
    serialNumber: "US-EPIQ-20240115",
    department: "超声医学科",
    location: "门诊楼三层超声中心",
    enabledDate: "2024-01-15",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "保修期内",
    monitoringStatus: "影像业务文件待导入",
    investment: 320,
    quantity: 2,
    serviceVolume: 32600,
    serviceUnit: "检查人次",
    revenue: 980,
    utilization: 88,
    planPayback: 2,
    forecastPayback: 2.3,
    status: "运行良好",
    cost: { labor: 270, consumables: 85, depreciation: 64, maintenance: 71, energy: 36, space: 57, indirect: 127 },
  },
  {
    id: "bio-01",
    assetCode: "YLSB-2022-0072",
    name: "全自动生化分析仪",
    shortName: "生化分析仪",
    model: "cobas pro",
    category: "检验类",
    manufacturer: "罗氏诊断",
    serialNumber: "LIS-CBP-20220903",
    department: "检验科",
    location: "检验科生化流水线区",
    enabledDate: "2022-09-03",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "试剂绑定维保",
    monitoringStatus: "检验业务文件待导入",
    investment: 450,
    quantity: 1,
    serviceVolume: 450000,
    serviceUnit: "检测项次",
    revenue: 1220,
    utilization: 79,
    planPayback: 2.5,
    forecastPayback: 3,
    status: "运行良好",
    cost: { labor: 194, consumables: 349, depreciation: 78, maintenance: 107, energy: 68, space: 49, indirect: 125 },
  },
];

export const initialModules: DashboardModule[] = [
  { id: "kpi", name: "核心指标", description: "投资、收入、净收益、使用率与预警数", visible: true, size: "full" },
  { id: "dimensions", name: "五维效益评价", description: "经济、效率、质量、体验与设备保障综合评分", visible: true, size: "full" },
  { id: "trend", name: "收入成本趋势", description: "月度收入、成本与净收益趋势", visible: true, size: "wide" },
  { id: "cost", name: "成本构成", description: "人工、耗材、折旧、维保等成本占比", visible: true, size: "small" },
  { id: "payback", name: "回本年限对比", description: "原计划与最新预计回本周期", visible: true, size: "medium" },
  { id: "efficiency", name: "效益效率矩阵", description: "使用率与投资收益率四象限", visible: true, size: "medium" },
  { id: "quality", name: "质量与患者体验", description: "报告质控、重复检查、等待与报告时效", visible: true, size: "medium" },
  { id: "reliability", name: "设备保障", description: "可用率、故障、停机与预防性维护", visible: true, size: "medium" },
  { id: "workforce", name: "人员绩效", description: "技师、诊断医生工作量与科室绩效质控", visible: true, size: "full" },
  { id: "category", name: "品类经营与资源配置", description: "同类横比、收益排行与共享潜力", visible: true, size: "full" },
  { id: "alerts", name: "管理预警", description: "低使用率、亏损和回本延期提示", visible: true, size: "small" },
  { id: "table", name: "设备效益明细", description: "按单机查看收入、成本、服务量和状态", visible: true, size: "full" },
];

export const initialCostEntries: CostEntry[] = [
  { id: "ce-01", type: "人工", deviceId: "mri-01", deviceName: "3.0T 磁共振成像系统", item: "影像技师", detail: "6 人 × 160 小时 × 186 元/小时", period: "2026-06", amount: 17.86, owner: "医学影像科", createdAt: "2026-07-02 09:20" },
  { id: "ce-02", type: "耗材", deviceId: "robot-01", deviceName: "腔镜手术机器人", item: "专用器械臂耗材", detail: "41 套 × 12,500 元/套 · 单独收费", period: "2026-06", amount: 51.25, owner: "手术部", createdAt: "2026-07-03 14:35" },
  { id: "ce-03", type: "耗材", deviceId: "bio-01", deviceName: "全自动生化分析仪", item: "生化检测试剂", detail: "126 盒 × 2,760 元/盒 · 不可单独收费", period: "2026-06", amount: 34.78, owner: "检验科", createdAt: "2026-07-04 11:08" },
];

export const dataSources: DataSource[] = [
  { name: "设备资产主数据文件", category: "设备与资产", fields: "资产编号、品牌型号、原值、启用日期、使用科室", owner: "资产部 / 设备科", frequency: "每月", status: "已连接", lastSync: "2026-07-22 月度文件" },
  { name: "收费收入文件", category: "业务与收入", fields: "收费项目、执行科室、收入、退费", owner: "信息部 / 财务部", frequency: "每日", status: "待配置", lastSync: "—" },
  { name: "影像业务文件", category: "影像设备", fields: "检查次数、设备编码、报告时效", owner: "信息部 / 影像科", frequency: "每日", status: "待配置", lastSync: "—" },
  { name: "检验业务文件", category: "检验设备", fields: "样本数、检测项次、仪器编码", owner: "信息部 / 检验科", frequency: "每日", status: "待配置", lastSync: "—" },
  { name: "内镜业务文件", category: "内镜设备", fields: "检查例次、主机编号、镜体编号与类型", owner: "内镜中心 / 信息部", frequency: "每日", status: "待配置", lastSync: "—" },
  { name: "手术业务文件", category: "手术设备", fields: "手术事件键、设备编码、使用起止时间", owner: "手术部 / 信息部", frequency: "每日", status: "待配置", lastSync: "—" },
  { name: "财务成本文件", category: "财务与成本", fields: "原值、折旧、收入、付款与凭证", owner: "财务部 / 资产部", frequency: "每月", status: "已连接", lastSync: "2026-07 月度文件" },
  { name: "耗材明细文件", category: "耗材与试剂", fields: "领用量、出库价、退库、批次", owner: "物资部 / 使用科室", frequency: "每日", status: "待配置", lastSync: "—" },
  { name: "设备运行日志文件", category: "运行状态", fields: "开机时长、故障、停机、能耗", owner: "设备科 / 信息部", frequency: "每日", status: "待配置", lastSync: "—" },
  { name: "维修保养文件", category: "设备保障", fields: "报修、故障、停机、MTTR、PM、合同与备件", owner: "医学装备部 / 采购部", frequency: "每日", status: "待配置", lastSync: "—" },
  { name: "预约排队文件", category: "患者体验", fields: "申请、预约、签到、叫号、开始与取消时间", owner: "门诊部 / 运营部 / 信息部", frequency: "每日", status: "待配置", lastSync: "—" },
  { name: "临床质控文件", category: "临床质量", fields: "报告抽检、操作质控、合理使用、疑难病例", owner: "医务处 / 质控办", frequency: "每月", status: "人工填报", lastSync: "2026-07 月度文件" },
  { name: "能源空间文件", category: "后勤资源", fields: "电水气用量、单价、设备面积、内部面积成本", owner: "后勤部 / 基建处 / 财务部", frequency: "每月", status: "人工填报", lastSync: "2026-07 月度文件" },
  { name: "人工成本文件", category: "人员投入", fields: "岗位、人数、工时、小时成本", owner: "人力资源部 / 使用科室", frequency: "每月", status: "人工填报", lastSync: "2026-07 月度文件" },
];

export const monthLabels = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
export const revenueFactors = [0.78, 0.7, 0.93, 1.02, 1.05, 1.08, 1, 1.04, 1.1, 1.12, 1.08, 1.1];
export const costFactors = [0.91, 0.88, 0.96, 1, 1.01, 1.03, 1.02, 1.04, 1.05, 1.06, 1.02, 1.02];

export function totalCost(device: Device) {
  return Object.values(device.cost).reduce((sum, value) => sum + value, 0);
}

export function netBenefit(device: Device) {
  return device.revenue - totalCost(device);
}

export function roi(device: Device) {
  return (netBenefit(device) / device.investment) * 100;
}
