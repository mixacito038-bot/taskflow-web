import type { DeviceReportRecord } from "./device-report-fields";

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
  /** 资产归属科室（唯一）。老数据没有时回落到 department。 */
  owningDepartment?: string;
  /** 使用科室，可多个；台账表格折叠显示。老数据没有时回落到 department。 */
  usingDepartments?: string[];
  /** 设备安放的房间号。 */
  roomNumber?: string;
  /** 该台设备的数据来源：手动填写 / 文件导入 / 接口对接。 */
  dataSource?: string;
  /** 各院自定义台账字段的值，键为 LedgerFieldDefinition.key。 */
  customFields?: Record<string, string>;
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

export type ModuleHeight = "compact" | "standard" | "tall";

export type DashboardModule = {
  id: string;
  name: string;
  description: string;
  visible: boolean;
  size: ModuleSize;
  height?: ModuleHeight;
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
  {
    id: "mri-02",
    assetCode: "YLSB-2023-0012",
    name: "3.0T 磁共振成像系统（二号机）",
    shortName: "3.0T 磁共振 2 号",
    model: "uMR 780",
    category: "诊断类（放射）",
    manufacturer: "联影医疗",
    serialNumber: "MRI-UMR-20230415",
    department: "医学影像科",
    location: "医技楼二层 MR2 机房",
    enabledDate: "2023-04-15",
    fundingSource: "财政专项 50% + 自筹 50%",
    usefulLifeYears: 10,
    depreciationMethod: "平均年限法",
    licenseNumber: "乙类大型设备配置许可证",
    maintenanceStatus: "全保合同",
    monitoringStatus: "设备日志已接入",
    investment: 1480,
    quantity: 1,
    serviceVolume: 21800,
    serviceUnit: "检查人次",
    revenue: 1635,
    utilization: 81,
    planPayback: 4,
    forecastPayback: 4.2,
    status: "运行良好",
    cost: { labor: 288, consumables: 165, depreciation: 148, maintenance: 118, energy: 112, space: 92, indirect: 188 },
  },
  {
    id: "mri-03",
    assetCode: "YLSB-2018-0044",
    name: "1.5T 磁共振成像系统",
    shortName: "1.5T 磁共振",
    model: "MAGNETOM Aera",
    category: "诊断类（放射）",
    manufacturer: "西门子医疗",
    serialNumber: "MRI-AER-20181022",
    department: "医学影像科",
    location: "住院楼负一层 MR3 机房",
    enabledDate: "2018-10-22",
    fundingSource: "自筹资金",
    usefulLifeYears: 10,
    depreciationMethod: "平均年限法",
    licenseNumber: "乙类大型设备配置许可证",
    maintenanceStatus: "脱保",
    monitoringStatus: "运行状态文件待导入",
    investment: 920,
    quantity: 1,
    serviceVolume: 19400,
    serviceUnit: "检查人次",
    revenue: 1010,
    utilization: 72,
    planPayback: 5,
    forecastPayback: 6.8,
    status: "需要关注",
    cost: { labor: 236, consumables: 118, depreciation: 92, maintenance: 64, energy: 86, space: 71, indirect: 142 },
  },
  {
    id: "ct-02",
    assetCode: "YLSB-2024-0009",
    name: "256 排宽体螺旋 CT",
    shortName: "256 排 CT",
    model: "Revolution Apex",
    category: "诊断类（放射）",
    manufacturer: "GE 医疗",
    serialNumber: "CT-APX-20240322",
    department: "医学影像科",
    location: "门诊楼一层 CT1 机房",
    enabledDate: "2024-03-22",
    fundingSource: "财政专项 60% + 自筹 40%",
    usefulLifeYears: 10,
    depreciationMethod: "平均年限法",
    licenseNumber: "乙类大型设备配置许可证",
    maintenanceStatus: "全保合同",
    monitoringStatus: "采集器 + OCR 已接入",
    investment: 2050,
    quantity: 1,
    serviceVolume: 49600,
    serviceUnit: "检查人次",
    revenue: 1885,
    utilization: 93,
    planPayback: 4,
    forecastPayback: 4.4,
    status: "运行良好",
    cost: { labor: 262, consumables: 214, depreciation: 205, maintenance: 143, energy: 152, space: 84, indirect: 196 },
  },
  {
    id: "ct-03",
    assetCode: "YLSB-2021-0058",
    name: "64 排螺旋 CT（急诊）",
    shortName: "64 排 CT",
    model: "Aquilion Prime SP",
    category: "诊断类（放射）",
    manufacturer: "佳能医疗",
    serialNumber: "CT-AQP-20210906",
    department: "医学影像科",
    location: "急诊楼一层急诊 CT 机房",
    enabledDate: "2021-09-06",
    fundingSource: "医院自筹",
    usefulLifeYears: 10,
    depreciationMethod: "平均年限法",
    licenseNumber: "乙类大型设备配置许可证",
    maintenanceStatus: "第三方维保",
    monitoringStatus: "设备日志已接入",
    investment: 760,
    quantity: 1,
    serviceVolume: 36400,
    serviceUnit: "检查人次",
    revenue: 1130,
    utilization: 88,
    planPayback: 3.5,
    forecastPayback: 3.8,
    status: "运行良好",
    cost: { labor: 224, consumables: 158, depreciation: 84, maintenance: 53, energy: 108, space: 62, indirect: 139 },
  },
  {
    id: "dr-01",
    assetCode: "YLSB-2022-0031",
    name: "数字化 X 线摄影系统（门诊）",
    shortName: "DR 1 号",
    model: "DigitalDiagnost C90",
    category: "诊断类（放射）",
    manufacturer: "飞利浦医疗",
    serialNumber: "DR-DDC-20220518",
    department: "医学影像科",
    location: "门诊楼二层 DR1 摄片室",
    enabledDate: "2022-05-18",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "第三方维保",
    monitoringStatus: "影像业务文件待导入",
    investment: 185,
    quantity: 1,
    serviceVolume: 51600,
    serviceUnit: "检查人次",
    revenue: 402,
    utilization: 86,
    planPayback: 2,
    forecastPayback: 2.2,
    status: "运行良好",
    cost: { labor: 132, consumables: 26, depreciation: 23, maintenance: 9, energy: 14, space: 18, indirect: 46 },
  },
  {
    id: "dr-02",
    assetCode: "YLSB-2022-0032",
    name: "数字化 X 线摄影系统（住院部）",
    shortName: "DR 2 号",
    model: "uDR 780i",
    category: "诊断类（放射）",
    manufacturer: "联影医疗",
    serialNumber: "DR-UDR-20220627",
    department: "医学影像科",
    location: "住院楼一层 DR2 摄片室",
    enabledDate: "2022-06-27",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "第三方维保",
    monitoringStatus: "影像业务文件待导入",
    investment: 168,
    quantity: 1,
    serviceVolume: 43900,
    serviceUnit: "检查人次",
    revenue: 334,
    utilization: 79,
    planPayback: 2,
    forecastPayback: 2.6,
    status: "运行良好",
    cost: { labor: 121, consumables: 22, depreciation: 21, maintenance: 8, energy: 12, space: 15, indirect: 40 },
  },
  {
    id: "dr-03",
    assetCode: "YLSB-2024-0041",
    name: "数字化 X 线摄影系统（体检中心）",
    shortName: "DR 3 号",
    model: "新东方 1000T",
    category: "诊断类（放射）",
    manufacturer: "万东医疗",
    serialNumber: "DR-XDF-20240520",
    department: "健康管理中心",
    location: "体检楼二层摄片室",
    enabledDate: "2024-05-20",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "保修期内",
    monitoringStatus: "影像业务文件待导入",
    investment: 152,
    quantity: 1,
    serviceVolume: 11800,
    serviceUnit: "检查人次",
    revenue: 94,
    utilization: 46,
    planPayback: 3,
    forecastPayback: 12,
    status: "效益预警",
    cost: { labor: 58, consumables: 8, depreciation: 17, maintenance: 3, energy: 6, space: 11, indirect: 17 },
  },
  {
    id: "dr-mobile-01",
    assetCode: "YLSB-2019-0027",
    name: "移动式数字化 X 线摄影系统",
    shortName: "移动 DR",
    model: "MobileDiagnost wDR",
    category: "诊断类（放射）",
    manufacturer: "飞利浦医疗",
    serialNumber: "DR-MOB-20190712",
    department: "重症医学科",
    location: "ICU 病区床旁（流动）",
    enabledDate: "2019-07-12",
    fundingSource: "自筹资金",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "脱保",
    monitoringStatus: "扫码登记已启用",
    investment: 132,
    quantity: 1,
    serviceVolume: 9200,
    serviceUnit: "检查人次",
    revenue: 83,
    utilization: 58,
    planPayback: 4,
    forecastPayback: 9.5,
    status: "需要关注",
    cost: { labor: 44, consumables: 5, depreciation: 17, maintenance: 6, energy: 2, space: 2, indirect: 9 },
  },
  {
    id: "dsa-01",
    assetCode: "YLSB-2022-0049",
    name: "数字减影血管造影系统（DSA）",
    shortName: "DSA",
    model: "Azurion 7 M20",
    category: "手术治疗类（介入）",
    manufacturer: "飞利浦医疗",
    serialNumber: "DSA-AZ7-20221108",
    department: "介入医学科",
    location: "介入中心一层 1 号导管室",
    enabledDate: "2022-11-08",
    fundingSource: "专项债 + 自筹",
    usefulLifeYears: 10,
    depreciationMethod: "平均年限法",
    licenseNumber: "乙类大型设备配置许可证",
    maintenanceStatus: "原厂维保",
    monitoringStatus: "手术业务文件待导入",
    investment: 1380,
    quantity: 1,
    serviceVolume: 2680,
    serviceUnit: "手术台次",
    revenue: 1340,
    utilization: 74,
    planPayback: 5,
    forecastPayback: 5.4,
    status: "运行良好",
    cost: { labor: 246, consumables: 262, depreciation: 138, maintenance: 97, energy: 76, space: 88, indirect: 158 },
  },
  {
    id: "us-02",
    assetCode: "YLSB-2023-0035",
    name: "高端彩色多普勒超声（心脏专用）",
    shortName: "心脏彩超",
    model: "EPIQ CVx",
    category: "诊断类（超声）",
    manufacturer: "飞利浦医疗",
    serialNumber: "US-CVX-20230814",
    department: "超声医学科",
    location: "门诊楼三层心脏超声室",
    enabledDate: "2023-08-14",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "原厂维保",
    monitoringStatus: "影像业务文件待导入",
    investment: 295,
    quantity: 1,
    serviceVolume: 20600,
    serviceUnit: "检查人次",
    revenue: 620,
    utilization: 84,
    planPayback: 2.5,
    forecastPayback: 2.4,
    status: "运行良好",
    cost: { labor: 176, consumables: 38, depreciation: 37, maintenance: 21, energy: 12, space: 24, indirect: 67 },
  },
  {
    id: "us-03",
    assetCode: "YLSB-2024-0016",
    name: "高端彩色多普勒超声（妇产专用）",
    shortName: "妇产彩超",
    model: "Voluson E10",
    category: "诊断类（超声）",
    manufacturer: "GE 医疗",
    serialNumber: "US-VE10-20240226",
    department: "超声医学科",
    location: "妇产科门诊超声室",
    enabledDate: "2024-02-26",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "保修期内",
    monitoringStatus: "影像业务文件待导入",
    investment: 268,
    quantity: 1,
    serviceVolume: 23900,
    serviceUnit: "检查人次",
    revenue: 645,
    utilization: 87,
    planPayback: 2,
    forecastPayback: 2,
    status: "运行良好",
    cost: { labor: 182, consumables: 41, depreciation: 34, maintenance: 19, energy: 11, space: 22, indirect: 64 },
  },
  {
    id: "us-portable-01",
    assetCode: "YLSB-2024-0052",
    name: "便携式彩色多普勒超声",
    shortName: "便携彩超",
    model: "Venue Go",
    category: "诊断类（超声）",
    manufacturer: "GE 医疗",
    serialNumber: "US-VNG-20240618",
    department: "重症医学科",
    location: "ICU 病区床旁（流动）",
    enabledDate: "2024-06-18",
    fundingSource: "医院自筹",
    usefulLifeYears: 6,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "保修期内",
    monitoringStatus: "扫码登记已启用",
    investment: 88,
    quantity: 1,
    serviceVolume: 5400,
    serviceUnit: "检查人次",
    revenue: 62,
    utilization: 52,
    planPayback: 4,
    forecastPayback: 13,
    status: "效益预警",
    cost: { labor: 39, consumables: 5, depreciation: 11, maintenance: 4, energy: 1, space: 2, indirect: 8 },
  },
  {
    id: "endo-gastro-01",
    assetCode: "YLSB-2023-0021",
    name: "电子胃镜系统",
    shortName: "电子胃镜",
    model: "EVIS X1 CV-1500",
    category: "诊断类（内镜）",
    manufacturer: "奥林巴斯",
    serialNumber: "EN-GAS-20230530",
    department: "消化内镜中心",
    location: "内镜中心 3 号诊室",
    enabledDate: "2023-05-30",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "原厂维保",
    monitoringStatus: "内镜业务文件待导入",
    investment: 342,
    quantity: 1,
    serviceVolume: 13200,
    serviceUnit: "检查人次",
    revenue: 570,
    utilization: 82,
    planPayback: 3,
    forecastPayback: 3.1,
    status: "运行良好",
    cost: { labor: 164, consumables: 92, depreciation: 43, maintenance: 24, energy: 9, space: 21, indirect: 55 },
  },
  {
    id: "endo-colon-01",
    assetCode: "YLSB-2023-0022",
    name: "电子结肠镜系统",
    shortName: "电子肠镜",
    model: "EVIS X1 CF-EZ1500",
    category: "诊断类（内镜）",
    manufacturer: "奥林巴斯",
    serialNumber: "EN-COL-20230530",
    department: "消化内镜中心",
    location: "内镜中心 5 号诊室",
    enabledDate: "2023-05-30",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "原厂维保",
    monitoringStatus: "内镜业务文件待导入",
    investment: 315,
    quantity: 1,
    serviceVolume: 9800,
    serviceUnit: "检查人次",
    revenue: 490,
    utilization: 78,
    planPayback: 3,
    forecastPayback: 3.6,
    status: "运行良好",
    cost: { labor: 148, consumables: 84, depreciation: 39, maintenance: 22, energy: 8, space: 20, indirect: 49 },
  },
  {
    id: "lap-01",
    assetCode: "YLSB-2022-0064",
    name: "4K 腹腔镜手术系统",
    shortName: "4K 腹腔镜",
    model: "VISERA ELITE III",
    category: "手术治疗类",
    manufacturer: "奥林巴斯",
    serialNumber: "LAP-VE3-20221215",
    department: "手术部",
    location: "手术中心 5 号手术间",
    enabledDate: "2022-12-15",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内准入备案完整",
    maintenanceStatus: "第三方维保",
    monitoringStatus: "手术业务文件待导入",
    investment: 276,
    quantity: 1,
    serviceVolume: 1520,
    serviceUnit: "手术台次",
    revenue: 640,
    utilization: 76,
    planPayback: 3.5,
    forecastPayback: 3.7,
    status: "运行良好",
    cost: { labor: 156, consumables: 187, depreciation: 35, maintenance: 19, energy: 7, space: 26, indirect: 62 },
  },
  {
    id: "hema-01",
    assetCode: "YLSB-2023-0056",
    name: "血液分析流水线",
    shortName: "血液流水线",
    model: "XN-9100",
    category: "检验类",
    manufacturer: "希森美康",
    serialNumber: "LIS-XN9-20230911",
    department: "检验科",
    location: "检验科血液体液区",
    enabledDate: "2023-09-11",
    fundingSource: "医院自筹",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "试剂绑定维保",
    monitoringStatus: "检验业务文件待导入",
    investment: 435,
    quantity: 1,
    serviceVolume: 268000,
    serviceUnit: "标本数",
    revenue: 670,
    utilization: 76,
    planPayback: 3,
    forecastPayback: 3.5,
    status: "运行良好",
    cost: { labor: 128, consumables: 196, depreciation: 54, maintenance: 30, energy: 24, space: 18, indirect: 66 },
  },
  {
    id: "vent-01",
    assetCode: "YLSB-2021-0072",
    name: "有创呼吸机组（生命支持）",
    shortName: "呼吸机组",
    model: "SV800 / Evita V300 混编",
    category: "生命支持类",
    manufacturer: "迈瑞医疗 / 德尔格",
    serialNumber: "ICU-VENT-2021 批次",
    department: "重症医学科",
    location: "ICU 一、二病区",
    enabledDate: "2021-12-20",
    fundingSource: "财政专项",
    usefulLifeYears: 8,
    depreciationMethod: "平均年限法",
    licenseNumber: "院内验收备案完整",
    maintenanceStatus: "原厂维保",
    monitoringStatus: "扫码登记已启用",
    investment: 340,
    quantity: 20,
    serviceVolume: 5900,
    serviceUnit: "机械通气日",
    revenue: 205,
    utilization: 63,
    planPayback: 6,
    forecastPayback: 8.8,
    status: "需要关注",
    cost: { labor: 68, consumables: 48, depreciation: 38, maintenance: 20, energy: 6, space: 5, indirect: 21 },
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
  { id: "hospital-compare", name: "集团医院对比", description: "同集团医院核心效益指标横向对比", visible: false, size: "full" },
];

export const initialCostEntries: CostEntry[] = [
  { id: "ce-01", type: "人工", deviceId: "mri-01", deviceName: "3.0T 磁共振成像系统", item: "影像技师", detail: "6 人 × 160 小时 × 186 元/小时", period: "2026-06", amount: 17.86, owner: "医学影像科", createdAt: "2026-07-02 09:20" },
  { id: "ce-02", type: "耗材", deviceId: "robot-01", deviceName: "腔镜手术机器人", item: "专用器械臂耗材", detail: "41 套 × 12,500 元/套 · 单独收费", period: "2026-06", amount: 51.25, owner: "手术部", createdAt: "2026-07-03 14:35" },
  { id: "ce-03", type: "耗材", deviceId: "bio-01", deviceName: "全自动生化分析仪", item: "生化检测试剂", detail: "126 盒 × 2,760 元/盒 · 不可单独收费", period: "2026-06", amount: 34.78, owner: "检验科", createdAt: "2026-07-04 11:08" },
  { id: "ce-04", type: "人工", deviceId: "ct-02", deviceName: "256 排宽体螺旋 CT", item: "影像技师", detail: "8 人 × 168 小时 × 172 元/小时", period: "2026-07", amount: 23.11, owner: "医学影像科", createdAt: "2026-08-02 10:14" },
  { id: "ce-05", type: "耗材", deviceId: "dsa-01", deviceName: "数字减影血管造影系统（DSA）", item: "导管室介入耗材", detail: "造影导管、导丝等 126 台次领用 · 单独收费", period: "2026-07", amount: 24.58, owner: "介入医学科", createdAt: "2026-08-03 15:22" },
  { id: "ce-06", type: "耗材", deviceId: "hema-01", deviceName: "血液分析流水线", item: "血细胞分析试剂", detail: "84 套 × 3,150 元/套 · 不可单独收费", period: "2026-07", amount: 26.46, owner: "检验科", createdAt: "2026-08-04 09:41" },
  { id: "ce-07", type: "人工", deviceId: "endo-gastro-01", deviceName: "电子胃镜系统", item: "内镜医师与护士", detail: "4 人 × 152 小时 × 198 元/小时", period: "2026-07", amount: 12.04, owner: "消化内镜中心", createdAt: "2026-08-04 16:05" },
  { id: "ce-08", type: "耗材", deviceId: "vent-01", deviceName: "有创呼吸机组（生命支持）", item: "呼吸管路与细菌过滤器", detail: "486 套 × 86 元/套 · 不可单独收费", period: "2026-07", amount: 4.18, owner: "重症医学科", createdAt: "2026-08-05 08:52" },
  { id: "ce-09", type: "人工", deviceId: "dr-03", deviceName: "数字化 X 线摄影系统（体检中心）", item: "放射技师（兼班）", detail: "2 人 × 88 小时 × 165 元/小时", period: "2026-07", amount: 2.9, owner: "健康管理中心", createdAt: "2026-08-05 11:37" },
  { id: "ce-10", type: "耗材", deviceId: "mri-02", deviceName: "3.0T 磁共振成像系统（二号机）", item: "对比剂（钆剂）", detail: "612 支 × 285 元/支 · 单独收费", period: "2026-07", amount: 17.44, owner: "医学影像科", createdAt: "2026-08-06 14:19" },
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
export const revenueFactors = [0.8, 0.64, 0.96, 1, 1.04, 1.05, 1.1, 1.12, 1.05, 1.07, 1.06, 1.11];
export const costFactors = [0.93, 0.9, 0.97, 1, 1.01, 1.02, 1.04, 1.05, 1.02, 1.03, 1.01, 1.02];

export function cloneDevicesForHospital(hospitalId: string): Device[] {
  const profile = hospitalId === "hosp-east"
    ? { revenue: 0.74, cost: 0.71, volume: 0.72, utilization: -5 }
    : hospitalId === "hosp-specialty"
      ? { revenue: 0.58, cost: 0.61, volume: 0.56, utilization: -9 }
      : { revenue: 1, cost: 1, volume: 1, utilization: 0 };
  return initialDevices.map((device) => ({
    ...device,
    revenue: Math.round(device.revenue * profile.revenue),
    serviceVolume: Math.round(device.serviceVolume * profile.volume),
    utilization: Math.max(35, Math.min(98, device.utilization + profile.utilization)),
    forecastPayback: Number((device.forecastPayback / Math.max(profile.revenue, 0.4)).toFixed(1)),
    cost: Object.fromEntries(Object.entries(device.cost).map(([key, value]) => [key, Math.round(value * profile.cost)])) as Device["cost"],
  }));
}

export function totalCost(device: Device) {
  return Object.values(device.cost).reduce((sum, value) => sum + value, 0);
}

export function netBenefit(device: Device) {
  return device.revenue - totalCost(device);
}

export function roi(device: Device) {
  return (netBenefit(device) / device.investment) * 100;
}

/* ------------------------------------------------------------------ 设备数据填报演示数据 */

/**
 * 「设备数据填报」的演示数据。
 *
 * 演示环境里台账、成本、驾驶舱都有数，唯独填报是空的，指标字典驾驶舱整屏「未接入」，
 * 看不出效果。这里按台账已有的年度口径反推出逐月填报值，让演示环境有真实数据可算。
 *
 * 三条硬约束：
 * - 只写手工填报的 15 项。examVolume / positiveCount / totalRevenue 的口径是「数据准备中心表格导入」，
 *   把它们写进填报记录等于凭空造出第二份业务量口径，和导入的表格互相打架。
 * - 全部确定性：不用 Math.random()、不用 new Date()。演示数据每次渲染都变会触发 React 水合告警。
 * - 逐月加总必须等于台账年度值，一分不差；对不上账的演示数据比没有演示数据更糟。
 */

const DEMO_REPORT_YEAR = 2026;

/** 填报操作人；演示数据统一署名，避免看起来像真人填的。 */
const DEMO_REPORT_OPERATOR = "设备科 · 演示数据";

/**
 * 各类设备的日均开机工时，用来把「使用天数」折算成「使用时长」。
 * 检验流水线和呼吸机组接近全天运行，手术、内镜跟着排班走，所以按类别取值而不是一刀切。
 */
const DEMO_DAILY_HOURS_BY_CATEGORY: Record<string, number> = {
  "诊断类（放射）": 12.5,
  "诊断类（超声）": 9.5,
  "诊断类（内镜）": 8,
  "检验类": 16,
  "治疗类（放疗）": 11,
  "手术治疗类": 8.5,
  "手术治疗类（介入）": 8,
  "生命支持类": 20,
};

/** 台账没写类别的设备按单班 8 小时算。 */
const DEMO_DAILY_HOURS_FALLBACK = 8;

/** 故障时长的放大系数：预警设备故障多，演示时「设备完好率」才有高低之分。 */
const DEMO_FAULT_RATIO_BY_STATUS: Record<DeviceStatus, number> = {
  运行良好: 1,
  需要关注: 2.2,
  效益预警: 3,
};

/**
 * 台账七项年度成本（万元）→ 填报口径的 12 项（元）的拆分。
 *
 * share 之和为 1，且每组最后一项直接拿剩余额，拆完仍等于原额，不会因为四舍五入漏掉几块钱。
 * straightLine 的项按平均年限法逐月等额，不跟月度波动——折旧是会计口径，不该随用量起伏。
 */
const DEMO_COST_SPLITS: { source: keyof CostBreakdown; parts: { key: string; share: number; straightLine?: boolean }[] }[] = [
  { source: "consumables", parts: [{ key: "consumableCost", share: 1 }] },
  { source: "depreciation", parts: [{ key: "deviceDepreciation", share: 1, straightLine: true }] },
  { source: "labor", parts: [{ key: "laborCost", share: 1 }] },
  // 医疗设备机房的能耗以电为主，水主要是冷却与清洗，按 15 / 85 拆。
  { source: "energy", parts: [{ key: "waterFee", share: 0.15 }, { key: "powerFee", share: 0.85 }] },
  // 空间成本的大头是房屋折旧，物业只占日常保洁与安保的分摊。
  { source: "space", parts: [{ key: "buildingDepreciation", share: 0.7, straightLine: true }, { key: "propertyFee", share: 0.3 }] },
  // 维保合同占大头，其次是故障维修；日常保养与计量检定金额小但每年都有。
  {
    source: "maintenance",
    parts: [
      { key: "repairFee", share: 0.22 },
      { key: "maintenanceFee", share: 0.52 },
      { key: "upkeepFee", share: 0.16 },
      { key: "meteringFee", share: 0.1 },
    ],
  },
  { source: "indirect", parts: [{ key: "otherFee", share: 1 }] },
];

/** 平均年限法的月度权重：12 个月一样重。 */
const DEMO_STRAIGHT_LINE_WEIGHTS = Array.from({ length: 12 }, () => 1);

/**
 * 演示用的填报进度：1–6 月已确认，7 月待复核，8 月还在填，9–12 月不生成记录。
 * 未来月份本来就没数，凭空造反而不真实；全绿也看不出填报流程。
 */
const DEMO_REPORT_STATUS_BY_MONTH: (DeviceReportRecord["status"] | null)[] = [
  "confirmed", "confirmed", "confirmed", "confirmed", "confirmed", "confirmed",
  "submitted", "draft", null, null, null, null,
];

/** 挑两台设备的 6 月做「已退回」，否则演示里根本看不到这个状态。 */
const DEMO_RETURNED_JUNE_REASONS: Record<string, string> = {
  "ct-01": "电费与后勤台账对不上，请核对分摊系数",
  "endo-gastro-01": "维修费与维保合同金额重复入账，请拆分后重报",
};

/**
 * 把全年总额（元）按月度权重摊到 12 个月。
 *
 * 逐月各自四舍五入的话，12 个月加起来会和全年差几块钱，报表上就是「合计对不上」。
 * 所以前 11 个月按权重取整，12 月直接用全年总额减掉前 11 个月——舍入余数由末月吸收，
 * 保证逐月求和 === 全年总额。权重非负且末月权重不算低，末月不会被减成负数。
 */
function spreadAnnualAmountByMonth(totalYuan: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  const months: number[] = [];
  let allocated = 0;
  for (let index = 0; index < weights.length - 1; index += 1) {
    const amount = weightSum > 0 ? Math.round((totalYuan * weights[index]) / weightSum) : 0;
    months.push(amount);
    allocated += amount;
  }
  months.push(totalYuan - allocated);
  return months;
}

function demoDaysInMonth(monthIndex: number): number {
  // 走 UTC：本地时区解析会让月末掉到下个月，天数一错使用率就全错。
  return new Date(Date.UTC(DEMO_REPORT_YEAR, monthIndex + 1, 0)).getUTCDate();
}

/**
 * 单台设备全年 12 个月的填报值（手工填报的 15 项）。
 *
 * 单独导出是为了让「逐月加总 === 台账年度成本」这条口径一致性能被直接验证：
 * 演示记录只落 1–8 月，光看记录是加不出全年的。
 */
export function deviceReportValuesByMonth(device: Device): Record<string, string>[] {
  const monthly: Record<string, string>[] = Array.from({ length: 12 }, () => ({}));

  // 成本：台账是「万元/年」，填报是「元/期」，先 ×10000 拆成填报口径的各项，再按月摊。
  for (const split of DEMO_COST_SPLITS) {
    const annualYuan = Math.round(device.cost[split.source] * 10000);
    let remaining = annualYuan;
    split.parts.forEach((part, partIndex) => {
      const partYuan = partIndex === split.parts.length - 1 ? remaining : Math.round(annualYuan * part.share);
      remaining -= partYuan;
      const weights = part.straightLine ? DEMO_STRAIGHT_LINE_WEIGHTS : costFactors;
      spreadAnnualAmountByMonth(partYuan, weights).forEach((amount, monthIndex) => {
        monthly[monthIndex][part.key] = String(amount);
      });
    });
  }

  // 使用情况
  const dailyHours = DEMO_DAILY_HOURS_BY_CATEGORY[device.category ?? ""] ?? DEMO_DAILY_HOURS_FALLBACK;
  const faultRatio = DEMO_FAULT_RATIO_BY_STATUS[device.status];
  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const days = demoDaysInMonth(monthIndex);
    // 使用率是 0–100，折算成当月开机天数；再兜一次上限，免得高使用率的设备算出 32 天。
    const usageDays = Math.min(days, Math.round((days * device.utilization) / 100));
    const usageHours = Math.round(usageDays * dailyHours * 10) / 10;
    // 故障时长取使用时长的千分之几，用 costFactors 做确定性的月度波动，再按设备状态放大。
    // 系数恒小于 1，故障时长绝不会超过使用时长——超了填报页会一片橙色告警。
    const faultHours = Math.round(usageHours * (0.006 + (costFactors[monthIndex] - 0.9) * 0.02) * faultRatio * 10) / 10;
    monthly[monthIndex].usageDays = String(usageDays);
    monthly[monthIndex].usageHours = usageHours.toFixed(1);
    monthly[monthIndex].faultHours = faultHours.toFixed(1);
  }

  return monthly;
}

/**
 * 只有出具阳性/阴性结论的检查设备才谈得上「检阳性数」。
 * 介入手术平台做的是治疗性操作、直线加速器做的是放疗、呼吸机是生命支持，
 * 它们根本不产生阳性判读；给这类设备编一个阳性数，医院拿去算阳性率就是假结论。
 */
const DEMO_POSITIVE_READING_CATEGORIES = new Set([
  "诊断类（放射）",
  "诊断类（超声）",
  "诊断类（内镜）",
  "检验类",
]);

/** 阳性率区间参考影像与检验科室的常见检出水平；上限远小于 1，阳性数必然不超过检查人次。 */
const DEMO_POSITIVE_RATE_BASE = 0.08;
const DEMO_POSITIVE_RATE_SPAN = 0.14;

export type DemoDeviceWorkload = { examVolume?: string; positiveCount?: string; totalRevenue?: string };

/**
 * 演示模式下的「业务量与收入」三项。
 *
 * 正式模式里这三项来自数据准备中心发布的 device_workload 行，填报页只读回显；
 * 演示模式没有发布数据，若不给一份，字典驾驶舱上的收入、结余、阳性率会全是空卡，
 * 演示时看不出这套口径是怎么串起来的。
 *
 * 口径与演示台账保持同源：年度 serviceVolume / revenue 按既有的 revenueFactors 月度权重分摊，
 * 前 11 个月取整、末月吃掉舍入余数，12 个月加总分毫不差地等于年度值——
 * 否则驾驶舱按月加出来的合计会和台账对不上。
 */
export function cloneDeviceWorkloadForHospital(hospitalId: string): Map<string, DemoDeviceWorkload> {
  const index = new Map<string, DemoDeviceWorkload>();
  const weightTotal = revenueFactors.reduce((sum, factor) => sum + factor, 0);
  for (const device of cloneDevicesForHospital(hospitalId)) {
    const positiveReading = DEMO_POSITIVE_READING_CATEGORIES.has(device.category ?? "");
    // 收入在台账里是万元，填报与驾驶舱一律按元
    const revenueYuan = Math.round(device.revenue * 10000);
    const spread = (total: number) => {
      const parts: number[] = [];
      let used = 0;
      for (let monthIndex = 0; monthIndex < 11; monthIndex += 1) {
        const part = Math.round((total * revenueFactors[monthIndex]) / weightTotal);
        parts.push(part);
        used += part;
      }
      parts.push(total - used);
      return parts;
    };
    const volumes = spread(device.serviceVolume);
    const revenues = spread(revenueYuan);
    DEMO_REPORT_STATUS_BY_MONTH.forEach((status, monthIndex) => {
      if (!status) return;
      const examVolume = volumes[monthIndex];
      const rate = DEMO_POSITIVE_RATE_BASE + (revenueFactors[monthIndex] - 0.64) * DEMO_POSITIVE_RATE_SPAN;
      const entry: DemoDeviceWorkload = {
        examVolume: String(examVolume),
        totalRevenue: String(revenues[monthIndex]),
      };
      if (positiveReading) entry.positiveCount = String(Math.round(examVolume * rate));
      index.set(`${device.id}|${DEMO_REPORT_YEAR}-${String(monthIndex + 1).padStart(2, "0")}`, entry);
    });
  }
  return index;
}

/**
 * 某家医院的全部演示填报记录。
 *
 * 设备取 cloneDevicesForHospital(hospitalId)，成本与使用率本就按医院打了折，
 * 填报值跟着分院走，不同医院的驾驶舱不会算出一模一样的数。
 */
export function cloneDeviceReportsForHospital(hospitalId: string): DeviceReportRecord[] {
  const records: DeviceReportRecord[] = [];
  for (const device of cloneDevicesForHospital(hospitalId)) {
    const monthly = deviceReportValuesByMonth(device);
    DEMO_REPORT_STATUS_BY_MONTH.forEach((status, monthIndex) => {
      if (!status) return;
      const returnReason = monthIndex === 5 ? DEMO_RETURNED_JUNE_REASONS[device.id] : undefined;
      const month = String(monthIndex + 1).padStart(2, "0");
      const record: DeviceReportRecord = {
        deviceId: device.id,
        periodKey: `${DEMO_REPORT_YEAR}-${month}`,
        values: monthly[monthIndex],
        status: returnReason ? "returned" : status,
        // 固定时间戳（次月 5 日填报，退回记录晚几小时）：用 new Date() 会让演示数据每次渲染都变，
        // 既触发 React 水合告警，也让测试无法断言。
        updatedAt: `${DEMO_REPORT_YEAR}-${String(monthIndex + 2).padStart(2, "0")}-05T${returnReason ? "15:30" : "09:00"}:00.000Z`,
        updatedBy: DEMO_REPORT_OPERATOR,
      };
      if (returnReason) record.returnReason = returnReason;
      records.push(record);
    });
  }
  return records;
}
