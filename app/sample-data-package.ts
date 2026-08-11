import { FILE_BUSINESS_TEMPLATES, templateFields } from "./data-workbench-model";

export const SAMPLE_DATA_PACKAGE_VERSION = "2026.08-01";

export type SampleDataFile = {
  fileName: string;
  csv: string;
  rowCount: number;
};

type SampleRow = Record<string, string>;
type SampleDataset = Record<string, SampleRow[]>;

type MonthSpec = {
  period: string;
  days: number;
  workdays: number;
  factor: number;
};

// 2026 年 12 个月：春节（2 月）低谷、暑期（7-8 月）小高峰、国庆（10 月）回落。
const MONTHS: readonly MonthSpec[] = [
  { period: "2026-01", days: 31, workdays: 21, factor: 0.92 },
  { period: "2026-02", days: 28, workdays: 15, factor: 0.62 },
  { period: "2026-03", days: 31, workdays: 22, factor: 1.0 },
  { period: "2026-04", days: 30, workdays: 21, factor: 1.02 },
  { period: "2026-05", days: 31, workdays: 19, factor: 0.99 },
  { period: "2026-06", days: 30, workdays: 21, factor: 1.0 },
  { period: "2026-07", days: 31, workdays: 23, factor: 1.1 },
  { period: "2026-08", days: 31, workdays: 21, factor: 1.16 },
  { period: "2026-09", days: 30, workdays: 22, factor: 1.05 },
  { period: "2026-10", days: 31, workdays: 17, factor: 0.9 },
  { period: "2026-11", days: 30, workdays: 21, factor: 1.0 },
  { period: "2026-12", days: 31, workdays: 23, factor: 1.04 },
];

type DeviceSpec = {
  id: string;
  assetCode: string;
  name: string;
  shortName: string;
  category: string;
  model: string;
  manufacturer: string;
  department: string;
  location: string;
  investment: number;
  purchaseDate: string;
  enabledDate: string;
  serviceUnit: string;
  planPayback: number;
  forecastPayback: number;
  licenseNumber: string;
  maintenanceStatus: string;
  allDay: boolean;
  dailyMinutes: number;
  sampleExamBase: number;
  monthlyVolumeBase: number;
  perCaseMinutes: number;
  revenueMin: number;
  revenueMax: number;
  itemCodes: string[];
  bodyParts: string[];
  consumablePerCase: number;
  laborMonthly: number;
  energyBase: number;
  energyPerActiveMinute: number;
  depreciationYears: number;
  annualMaintenanceRate: number;
  plannedMaintenanceMonths: number[];
  faultCount: number;
  faultTypes: string[];
  faultCostMin: number;
  faultCostMax: number;
};

const DEVICES: readonly DeviceSpec[] = [
  {
    id: "YH-MRI-01",
    assetCode: "ZC-2021-0186",
    name: "3.0T 磁共振成像系统",
    shortName: "3.0T 磁共振",
    category: "磁共振",
    model: "uMR 790",
    manufacturer: "联影医疗",
    department: "医学影像科",
    location: "门诊医技楼2层磁共振1号机房",
    investment: 21800000,
    purchaseDate: "2021-06-18",
    enabledDate: "2021-09-30",
    serviceUnit: "人次",
    planPayback: 6,
    forecastPayback: 6.5,
    licenseNumber: "国械注准20213061218",
    maintenanceStatus: "在保",
    allDay: false,
    dailyMinutes: 780,
    sampleExamBase: 4,
    monthlyVolumeBase: 560,
    perCaseMinutes: 24,
    revenueMin: 980,
    revenueMax: 1650,
    itemCodes: ["310701012", "310701015"],
    bodyParts: ["头颅", "颈椎", "腰椎", "膝关节", "上腹部", "垂体"],
    consumablePerCase: 45,
    laborMonthly: 68000,
    energyBase: 28000,
    energyPerActiveMinute: 0.6,
    depreciationYears: 10,
    annualMaintenanceRate: 0.06,
    plannedMaintenanceMonths: [3, 9],
    faultCount: 2,
    faultTypes: ["梯度线圈故障", "冷头故障", "软件系统故障"],
    faultCostMin: 12000,
    faultCostMax: 180000,
  },
  {
    id: "YH-MRI-02",
    assetCode: "ZC-2018-0092",
    name: "1.5T 磁共振成像系统",
    shortName: "1.5T 磁共振",
    category: "磁共振",
    model: "MAGNETOM Aera",
    manufacturer: "西门子医疗",
    department: "医学影像科",
    location: "门诊医技楼2层磁共振2号机房",
    investment: 12600000,
    purchaseDate: "2018-04-20",
    enabledDate: "2018-07-15",
    serviceUnit: "人次",
    planPayback: 6,
    forecastPayback: 5.8,
    licenseNumber: "国械注进20173211472",
    maintenanceStatus: "保外维保合同",
    allDay: false,
    dailyMinutes: 780,
    sampleExamBase: 3,
    monthlyVolumeBase: 480,
    perCaseMinutes: 24,
    revenueMin: 720,
    revenueMax: 1250,
    itemCodes: ["310701008"],
    bodyParts: ["头颅", "颈椎", "腰椎", "肩关节", "盆腔"],
    consumablePerCase: 40,
    laborMonthly: 62000,
    energyBase: 22000,
    energyPerActiveMinute: 0.55,
    depreciationYears: 10,
    annualMaintenanceRate: 0.06,
    plannedMaintenanceMonths: [4, 10],
    faultCount: 2,
    faultTypes: ["梯度线圈故障", "射频线圈故障", "冷却系统故障"],
    faultCostMin: 10000,
    faultCostMax: 160000,
  },
  {
    id: "YH-CT-01",
    assetCode: "ZC-2022-0035",
    name: "256排螺旋CT",
    shortName: "256排CT",
    category: "CT",
    model: "Revolution CT",
    manufacturer: "GE医疗",
    department: "医学影像科",
    location: "门诊医技楼1层CT1号机房",
    investment: 16800000,
    purchaseDate: "2022-03-10",
    enabledDate: "2022-05-28",
    serviceUnit: "人次",
    planPayback: 5,
    forecastPayback: 5.2,
    licenseNumber: "国械注进20213060827",
    maintenanceStatus: "在保",
    allDay: false,
    dailyMinutes: 780,
    sampleExamBase: 5,
    monthlyVolumeBase: 1450,
    perCaseMinutes: 9,
    revenueMin: 420,
    revenueMax: 1180,
    itemCodes: ["310701005", "310703021"],
    bodyParts: ["胸部", "头颅", "全腹部", "冠脉CTA", "胸腹联合", "颈部"],
    consumablePerCase: 60,
    laborMonthly: 72000,
    energyBase: 9000,
    energyPerActiveMinute: 0.5,
    depreciationYears: 10,
    annualMaintenanceRate: 0.065,
    plannedMaintenanceMonths: [2, 8],
    faultCount: 3,
    faultTypes: ["球管故障", "探测器故障", "冷却系统故障", "高压发生器故障"],
    faultCostMin: 15000,
    faultCostMax: 420000,
  },
  {
    id: "YH-CT-02",
    assetCode: "ZC-2019-0148",
    name: "64排螺旋CT",
    shortName: "64排CT",
    category: "CT",
    model: "uCT 760",
    manufacturer: "联影医疗",
    department: "医学影像科",
    location: "门诊医技楼1层CT2号机房",
    investment: 9800000,
    purchaseDate: "2019-09-12",
    enabledDate: "2019-12-01",
    serviceUnit: "人次",
    planPayback: 5,
    forecastPayback: 4.6,
    licenseNumber: "国械注准20193060455",
    maintenanceStatus: "保外维保合同",
    allDay: false,
    dailyMinutes: 660,
    sampleExamBase: 4,
    monthlyVolumeBase: 1180,
    perCaseMinutes: 9,
    revenueMin: 350,
    revenueMax: 780,
    itemCodes: ["310701005"],
    bodyParts: ["胸部", "头颅", "全腹部", "腰椎", "副鼻窦"],
    consumablePerCase: 52,
    laborMonthly: 66000,
    energyBase: 8600,
    energyPerActiveMinute: 0.5,
    depreciationYears: 10,
    annualMaintenanceRate: 0.06,
    plannedMaintenanceMonths: [1, 7],
    faultCount: 2,
    faultTypes: ["球管故障", "探测器故障", "机械部件故障"],
    faultCostMin: 12000,
    faultCostMax: 360000,
  },
  {
    id: "YH-CT-03",
    assetCode: "ZC-2020-0211",
    name: "16排螺旋CT（急诊）",
    shortName: "急诊CT",
    category: "CT",
    model: "NeuViz 16",
    manufacturer: "东软医疗",
    department: "急诊医学科",
    location: "急诊楼1层CT机房",
    investment: 4200000,
    purchaseDate: "2020-11-05",
    enabledDate: "2021-01-20",
    serviceUnit: "人次",
    planPayback: 5,
    forecastPayback: 5.5,
    licenseNumber: "国械注准20203060912",
    maintenanceStatus: "保外维保合同",
    allDay: true,
    dailyMinutes: 1440,
    sampleExamBase: 3,
    monthlyVolumeBase: 860,
    perCaseMinutes: 10,
    revenueMin: 320,
    revenueMax: 650,
    itemCodes: ["310701004"],
    bodyParts: ["头颅", "胸部", "全腹部", "颈椎"],
    consumablePerCase: 55,
    laborMonthly: 60000,
    energyBase: 8000,
    energyPerActiveMinute: 0.5,
    depreciationYears: 10,
    annualMaintenanceRate: 0.06,
    plannedMaintenanceMonths: [5, 11],
    faultCount: 3,
    faultTypes: ["球管故障", "高压发生器故障", "软件系统故障"],
    faultCostMin: 9000,
    faultCostMax: 260000,
  },
  {
    id: "YH-DR-01",
    assetCode: "ZC-2019-0077",
    name: "数字化X射线摄影系统",
    shortName: "DR（门诊）",
    category: "DR",
    model: "新东方1000C",
    manufacturer: "万东医疗",
    department: "医学影像科",
    location: "门诊医技楼1层DR机房",
    investment: 1150000,
    purchaseDate: "2019-05-16",
    enabledDate: "2019-06-30",
    serviceUnit: "人次",
    planPayback: 4,
    forecastPayback: 3.8,
    licenseNumber: "国械注准20183060233",
    maintenanceStatus: "保外维保合同",
    allDay: false,
    dailyMinutes: 660,
    sampleExamBase: 4,
    monthlyVolumeBase: 1650,
    perCaseMinutes: 5,
    revenueMin: 98,
    revenueMax: 165,
    itemCodes: ["310701001"],
    bodyParts: ["胸部正位", "腰椎正侧位", "膝关节正侧位", "手部正斜位", "踝关节正侧位"],
    consumablePerCase: 8,
    laborMonthly: 30000,
    energyBase: 1200,
    energyPerActiveMinute: 0.2,
    depreciationYears: 8,
    annualMaintenanceRate: 0.04,
    plannedMaintenanceMonths: [6, 12],
    faultCount: 2,
    faultTypes: ["平板探测器故障", "高压发生器故障", "机械部件故障"],
    faultCostMin: 6000,
    faultCostMax: 150000,
  },
  {
    id: "YH-DR-02",
    assetCode: "ZC-2021-0248",
    name: "移动式数字化X射线机",
    shortName: "移动DR",
    category: "DR",
    model: "MOBILETT Elara Max",
    manufacturer: "西门子医疗",
    department: "急诊医学科",
    location: "急诊楼抢救区（移动）",
    investment: 980000,
    purchaseDate: "2021-08-10",
    enabledDate: "2021-09-15",
    serviceUnit: "人次",
    planPayback: 4,
    forecastPayback: 4.4,
    licenseNumber: "国械注进20203062091",
    maintenanceStatus: "在保",
    allDay: true,
    dailyMinutes: 1440,
    sampleExamBase: 2,
    monthlyVolumeBase: 420,
    perCaseMinutes: 6,
    revenueMin: 110,
    revenueMax: 180,
    itemCodes: ["310701002"],
    bodyParts: ["床旁胸部正位", "床旁腹部立位"],
    consumablePerCase: 8,
    laborMonthly: 22000,
    energyBase: 600,
    energyPerActiveMinute: 0.2,
    depreciationYears: 8,
    annualMaintenanceRate: 0.04,
    plannedMaintenanceMonths: [1, 7],
    faultCount: 2,
    faultTypes: ["平板探测器故障", "电池组失效", "机械部件故障"],
    faultCostMin: 5000,
    faultCostMax: 90000,
  },
  {
    id: "YH-DSA-01",
    assetCode: "ZC-2020-0069",
    name: "血管造影X射线系统（DSA）",
    shortName: "DSA",
    category: "DSA",
    model: "Azurion 7 M20",
    manufacturer: "飞利浦医疗",
    department: "介入导管室",
    location: "住院楼3层介入导管室",
    investment: 13500000,
    purchaseDate: "2020-06-22",
    enabledDate: "2020-09-10",
    serviceUnit: "例",
    planPayback: 6,
    forecastPayback: 5.6,
    licenseNumber: "国械注进20193062340",
    maintenanceStatus: "在保",
    allDay: false,
    dailyMinutes: 600,
    sampleExamBase: 1.6,
    monthlyVolumeBase: 96,
    perCaseMinutes: 85,
    revenueMin: 4800,
    revenueMax: 12800,
    itemCodes: ["330801006", "330802011"],
    bodyParts: ["冠状动脉", "脑血管", "外周血管", "肝动脉"],
    consumablePerCase: 3800,
    laborMonthly: 90000,
    energyBase: 5000,
    energyPerActiveMinute: 0.6,
    depreciationYears: 10,
    annualMaintenanceRate: 0.06,
    plannedMaintenanceMonths: [4, 10],
    faultCount: 2,
    faultTypes: ["平板探测器故障", "C臂机械故障", "球管故障"],
    faultCostMin: 20000,
    faultCostMax: 380000,
  },
  {
    id: "YH-MMG-01",
    assetCode: "ZC-2023-0021",
    name: "乳腺X射线摄影系统",
    shortName: "乳腺钼靶",
    category: "钼靶",
    model: "Selenia Dimensions",
    manufacturer: "豪洛捷",
    department: "医学影像科",
    location: "门诊医技楼1层钼靶机房",
    investment: 3850000,
    purchaseDate: "2023-02-15",
    enabledDate: "2023-04-01",
    serviceUnit: "人次",
    planPayback: 6,
    forecastPayback: 6.2,
    licenseNumber: "国械注进20223060518",
    maintenanceStatus: "在保",
    allDay: false,
    dailyMinutes: 480,
    sampleExamBase: 1.4,
    monthlyVolumeBase: 260,
    perCaseMinutes: 14,
    revenueMin: 270,
    revenueMax: 380,
    itemCodes: ["310701019"],
    bodyParts: ["双侧乳腺"],
    consumablePerCase: 20,
    laborMonthly: 26000,
    energyBase: 900,
    energyPerActiveMinute: 0.15,
    depreciationYears: 8,
    annualMaintenanceRate: 0.05,
    plannedMaintenanceMonths: [3, 11],
    faultCount: 1,
    faultTypes: ["压迫器故障", "平板探测器故障"],
    faultCostMin: 6000,
    faultCostMax: 120000,
  },
  {
    id: "YH-US-01",
    assetCode: "ZC-2022-0104",
    name: "彩色多普勒超声诊断仪",
    shortName: "彩超5号",
    category: "彩超",
    model: "Voluson E10",
    manufacturer: "GE医疗",
    department: "超声医学科",
    location: "门诊楼3层超声5号诊室",
    investment: 2680000,
    purchaseDate: "2022-07-08",
    enabledDate: "2022-08-20",
    serviceUnit: "人次",
    planPayback: 4,
    forecastPayback: 3.6,
    licenseNumber: "国械注进20213062104",
    maintenanceStatus: "在保",
    allDay: false,
    dailyMinutes: 660,
    sampleExamBase: 4,
    monthlyVolumeBase: 1500,
    perCaseMinutes: 7,
    revenueMin: 160,
    revenueMax: 420,
    itemCodes: ["310801003", "310801007"],
    bodyParts: ["上腹部", "甲状腺", "心脏", "颈动脉", "乳腺", "泌尿系"],
    consumablePerCase: 5,
    laborMonthly: 45000,
    energyBase: 800,
    energyPerActiveMinute: 0.1,
    depreciationYears: 8,
    annualMaintenanceRate: 0.04,
    plannedMaintenanceMonths: [2, 8],
    faultCount: 1,
    faultTypes: ["探头故障", "主机板卡故障"],
    faultCostMin: 8000,
    faultCostMax: 120000,
  },
  {
    id: "YH-US-02",
    assetCode: "ZC-2021-0113",
    name: "彩色多普勒超声诊断仪",
    shortName: "彩超8号",
    category: "彩超",
    model: "Resona R9",
    manufacturer: "迈瑞医疗",
    department: "超声医学科",
    location: "门诊楼3层超声8号诊室",
    investment: 1860000,
    purchaseDate: "2021-03-25",
    enabledDate: "2021-05-10",
    serviceUnit: "人次",
    planPayback: 4,
    forecastPayback: 3.9,
    licenseNumber: "国械注准20203061507",
    maintenanceStatus: "保外维保合同",
    allDay: false,
    dailyMinutes: 660,
    sampleExamBase: 3,
    monthlyVolumeBase: 1250,
    perCaseMinutes: 7,
    revenueMin: 150,
    revenueMax: 380,
    itemCodes: ["310801003"],
    bodyParts: ["上腹部", "甲状腺", "妇科经腹", "颈动脉", "浅表包块"],
    consumablePerCase: 5,
    laborMonthly: 42000,
    energyBase: 750,
    energyPerActiveMinute: 0.1,
    depreciationYears: 8,
    annualMaintenanceRate: 0.04,
    plannedMaintenanceMonths: [5, 11],
    faultCount: 1,
    faultTypes: ["探头故障", "显示器故障"],
    faultCostMin: 6000,
    faultCostMax: 90000,
  },
  {
    id: "YH-US-03",
    assetCode: "ZC-2020-0187",
    name: "便携式彩色超声诊断仪",
    shortName: "便携彩超",
    category: "彩超",
    model: "M9",
    manufacturer: "迈瑞医疗",
    department: "心血管内科",
    location: "住院楼6层心内科病区（床旁）",
    investment: 660000,
    purchaseDate: "2020-10-12",
    enabledDate: "2020-11-25",
    serviceUnit: "人次",
    planPayback: 3,
    forecastPayback: 3.2,
    licenseNumber: "国械注准20193061880",
    maintenanceStatus: "保外维保合同",
    allDay: false,
    dailyMinutes: 480,
    sampleExamBase: 1.5,
    monthlyVolumeBase: 380,
    perCaseMinutes: 10,
    revenueMin: 180,
    revenueMax: 350,
    itemCodes: ["310801011"],
    bodyParts: ["心脏", "颈动脉", "下肢血管"],
    consumablePerCase: 4,
    laborMonthly: 20000,
    energyBase: 300,
    energyPerActiveMinute: 0.08,
    depreciationYears: 8,
    annualMaintenanceRate: 0.04,
    plannedMaintenanceMonths: [6, 12],
    faultCount: 1,
    faultTypes: ["探头故障", "电池组失效"],
    faultCostMin: 4000,
    faultCostMax: 60000,
  },
  {
    id: "YH-EN-01",
    assetCode: "ZC-2021-0229",
    name: "电子胃肠镜系统",
    shortName: "胃肠镜",
    category: "内镜",
    model: "CV-290",
    manufacturer: "奥林巴斯",
    department: "消化内镜中心",
    location: "门诊楼4层内镜中心2号诊室",
    investment: 2350000,
    purchaseDate: "2021-11-18",
    enabledDate: "2022-01-10",
    serviceUnit: "例",
    planPayback: 4,
    forecastPayback: 3.7,
    licenseNumber: "国械注进20203063315",
    maintenanceStatus: "保外维保合同",
    allDay: false,
    dailyMinutes: 600,
    sampleExamBase: 2.5,
    monthlyVolumeBase: 420,
    perCaseMinutes: 22,
    revenueMin: 860,
    revenueMax: 2350,
    itemCodes: ["310901001", "310902003"],
    bodyParts: ["胃", "结肠", "胃+结肠"],
    consumablePerCase: 180,
    laborMonthly: 65000,
    energyBase: 900,
    energyPerActiveMinute: 0.15,
    depreciationYears: 8,
    annualMaintenanceRate: 0.05,
    plannedMaintenanceMonths: [5, 11],
    faultCount: 2,
    faultTypes: ["光源故障", "送水送气故障", "图像处理器故障"],
    faultCostMin: 9000,
    faultCostMax: 160000,
  },
  {
    id: "YH-EN-02",
    assetCode: "ZC-2022-0158",
    name: "电子支气管镜",
    shortName: "支气管镜",
    category: "内镜",
    model: "BF-Q290",
    manufacturer: "奥林巴斯",
    department: "呼吸与危重症医学科",
    location: "住院楼4层呼吸内镜室",
    investment: 1280000,
    purchaseDate: "2022-05-20",
    enabledDate: "2022-07-01",
    serviceUnit: "例",
    planPayback: 4,
    forecastPayback: 4.3,
    licenseNumber: "国械注进20213063577",
    maintenanceStatus: "在保",
    allDay: false,
    dailyMinutes: 480,
    sampleExamBase: 1.2,
    monthlyVolumeBase: 130,
    perCaseMinutes: 28,
    revenueMin: 1100,
    revenueMax: 2100,
    itemCodes: ["310903002"],
    bodyParts: ["支气管"],
    consumablePerCase: 220,
    laborMonthly: 40000,
    energyBase: 600,
    energyPerActiveMinute: 0.12,
    depreciationYears: 8,
    annualMaintenanceRate: 0.05,
    plannedMaintenanceMonths: [4, 10],
    faultCount: 1,
    faultTypes: ["光源故障", "插入部钳道破损"],
    faultCostMin: 8000,
    faultCostMax: 110000,
  },
  {
    id: "YH-LA-01",
    assetCode: "ZC-2020-0012",
    name: "医用直线加速器",
    shortName: "直线加速器",
    category: "直线加速器",
    model: "Versa HD",
    manufacturer: "医科达",
    department: "肿瘤放疗科",
    location: "放疗中心地下1层1号机房",
    investment: 28500000,
    purchaseDate: "2020-01-15",
    enabledDate: "2020-06-30",
    serviceUnit: "疗次",
    planPayback: 7,
    forecastPayback: 7.4,
    licenseNumber: "国械注进20193060126",
    maintenanceStatus: "在保",
    allDay: false,
    dailyMinutes: 660,
    sampleExamBase: 0,
    monthlyVolumeBase: 720,
    perCaseMinutes: 15,
    revenueMin: 0,
    revenueMax: 0,
    itemCodes: [],
    bodyParts: [],
    consumablePerCase: 260,
    laborMonthly: 110000,
    energyBase: 12000,
    energyPerActiveMinute: 0.8,
    depreciationYears: 10,
    annualMaintenanceRate: 0.07,
    plannedMaintenanceMonths: [2, 8],
    faultCount: 2,
    faultTypes: ["多叶光栅故障", "束流不稳定", "冷却系统故障"],
    faultCostMin: 30000,
    faultCostMax: 350000,
  },
  {
    id: "YH-LAB-01",
    assetCode: "ZC-2021-0056",
    name: "全自动生化免疫流水线",
    shortName: "检验流水线",
    category: "检验流水线",
    model: "cobas 8000",
    manufacturer: "罗氏诊断",
    department: "检验科",
    location: "医技楼1层检验科",
    investment: 8600000,
    purchaseDate: "2021-04-28",
    enabledDate: "2021-07-15",
    serviceUnit: "标本",
    planPayback: 5,
    forecastPayback: 4.8,
    licenseNumber: "国械注进20203402289",
    maintenanceStatus: "在保",
    allDay: false,
    dailyMinutes: 960,
    sampleExamBase: 0,
    monthlyVolumeBase: 46000,
    perCaseMinutes: 0.3,
    revenueMin: 0,
    revenueMax: 0,
    itemCodes: [],
    bodyParts: [],
    consumablePerCase: 6.5,
    laborMonthly: 85000,
    energyBase: 7000,
    energyPerActiveMinute: 0.25,
    depreciationYears: 8,
    annualMaintenanceRate: 0.05,
    plannedMaintenanceMonths: [3, 9],
    faultCount: 3,
    faultTypes: ["加样臂故障", "试剂针堵塞", "轨道传输故障"],
    faultCostMin: 5000,
    faultCostMax: 90000,
  },
  {
    id: "YH-LAB-02",
    assetCode: "ZC-2019-0121",
    name: "化学发光免疫分析仪",
    shortName: "发光免疫",
    category: "检验流水线",
    model: "i2000SR",
    manufacturer: "雅培诊断",
    department: "检验科",
    location: "医技楼1层检验科免疫室",
    investment: 2150000,
    purchaseDate: "2019-08-15",
    enabledDate: "2019-10-08",
    serviceUnit: "标本",
    planPayback: 4,
    forecastPayback: 3.5,
    licenseNumber: "国械注进20183401764",
    maintenanceStatus: "保外维保合同",
    allDay: false,
    dailyMinutes: 600,
    sampleExamBase: 0,
    monthlyVolumeBase: 8600,
    perCaseMinutes: 0.8,
    revenueMin: 0,
    revenueMax: 0,
    itemCodes: [],
    bodyParts: [],
    consumablePerCase: 12,
    laborMonthly: 40000,
    energyBase: 2000,
    energyPerActiveMinute: 0.2,
    depreciationYears: 8,
    annualMaintenanceRate: 0.05,
    plannedMaintenanceMonths: [6, 12],
    faultCount: 1,
    faultTypes: ["加样针堵塞", "温控模块故障"],
    faultCostMin: 4000,
    faultCostMax: 60000,
  },
  {
    id: "YH-VEN-01",
    assetCode: "ZC-2020-0093",
    name: "有创呼吸机",
    shortName: "呼吸机1号",
    category: "呼吸机",
    model: "Evita V500",
    manufacturer: "德尔格",
    department: "重症医学科",
    location: "住院楼5层ICU 3床位",
    investment: 450000,
    purchaseDate: "2020-02-20",
    enabledDate: "2020-03-15",
    serviceUnit: "例",
    planPayback: 3,
    forecastPayback: 3.1,
    licenseNumber: "国械注进20193080442",
    maintenanceStatus: "保外维保合同",
    allDay: true,
    dailyMinutes: 1440,
    sampleExamBase: 0,
    monthlyVolumeBase: 11,
    perCaseMinutes: 2800,
    revenueMin: 0,
    revenueMax: 0,
    itemCodes: [],
    bodyParts: [],
    consumablePerCase: 850,
    laborMonthly: 15000,
    energyBase: 600,
    energyPerActiveMinute: 0.05,
    depreciationYears: 6,
    annualMaintenanceRate: 0.03,
    plannedMaintenanceMonths: [4, 10],
    faultCount: 1,
    faultTypes: ["流量传感器故障", "涡轮故障", "氧电池失效"],
    faultCostMin: 3000,
    faultCostMax: 45000,
  },
  {
    id: "YH-VEN-02",
    assetCode: "ZC-2021-0301",
    name: "有创呼吸机",
    shortName: "呼吸机2号",
    category: "呼吸机",
    model: "SV800",
    manufacturer: "迈瑞医疗",
    department: "重症医学科",
    location: "住院楼5层ICU 7床位",
    investment: 398000,
    purchaseDate: "2021-12-10",
    enabledDate: "2022-01-05",
    serviceUnit: "例",
    planPayback: 3,
    forecastPayback: 2.9,
    licenseNumber: "国械注准20213080915",
    maintenanceStatus: "在保",
    allDay: true,
    dailyMinutes: 1440,
    sampleExamBase: 0,
    monthlyVolumeBase: 9,
    perCaseMinutes: 2800,
    revenueMin: 0,
    revenueMax: 0,
    itemCodes: [],
    bodyParts: [],
    consumablePerCase: 820,
    laborMonthly: 15000,
    energyBase: 600,
    energyPerActiveMinute: 0.05,
    depreciationYears: 6,
    annualMaintenanceRate: 0.03,
    plannedMaintenanceMonths: [5, 11],
    faultCount: 1,
    faultTypes: ["流量传感器故障", "湿化器故障"],
    faultCostMin: 3000,
    faultCostMax: 40000,
  },
  {
    id: "YH-VEN-03",
    assetCode: "ZC-2019-0064",
    name: "无创呼吸机",
    shortName: "无创呼吸机",
    category: "呼吸机",
    model: "V60",
    manufacturer: "飞利浦医疗",
    department: "呼吸与危重症医学科",
    location: "住院楼4层呼吸科病区",
    investment: 268000,
    purchaseDate: "2019-06-18",
    enabledDate: "2019-07-20",
    serviceUnit: "例",
    planPayback: 3,
    forecastPayback: 3.4,
    licenseNumber: "国械注进20183080677",
    maintenanceStatus: "保外维保合同",
    allDay: true,
    dailyMinutes: 1440,
    sampleExamBase: 0,
    monthlyVolumeBase: 8,
    perCaseMinutes: 2600,
    revenueMin: 0,
    revenueMax: 0,
    itemCodes: [],
    bodyParts: [],
    consumablePerCase: 680,
    laborMonthly: 12000,
    energyBase: 500,
    energyPerActiveMinute: 0.05,
    depreciationYears: 6,
    annualMaintenanceRate: 0.03,
    plannedMaintenanceMonths: [3, 9],
    faultCount: 1,
    faultTypes: ["面罩接口漏气报警异常", "涡轮故障"],
    faultCostMin: 2000,
    faultCostMax: 30000,
  },
];

const QUALITY_DEVICES = [
  "YH-MRI-01",
  "YH-MRI-02",
  "YH-CT-01",
  "YH-CT-02",
  "YH-CT-03",
  "YH-DR-01",
  "YH-DSA-01",
  "YH-LA-01",
] as const;

const QUALITY_CHECK_TYPES = [
  "影像质量抽查",
  "辐射剂量抽查",
  "增强检查占比核查",
  "质控完成率核查",
  "PM 一次通过核查",
] as const;

const ADVERSE_EVENTS: ReadonlyArray<{
  deviceId: string;
  month: number;
  eventType: string;
  severity: string;
  correctiveAction: string;
}> = [
  {
    deviceId: "YH-CT-01",
    month: 3,
    eventType: "不良事件（造影剂外渗）",
    severity: "一般",
    correctiveAction: "已按造影剂外渗应急预案处置，完善注射前评估与观察流程",
  },
  {
    deviceId: "YH-MRI-01",
    month: 5,
    eventType: "安全隐患（铁磁物品带入）",
    severity: "重要",
    correctiveAction: "磁体间加装金属探测门禁，全员复训入室安检流程",
  },
  {
    deviceId: "YH-DSA-01",
    month: 6,
    eventType: "不良事件（术中设备报警）",
    severity: "一般",
    correctiveAction: "排查高压注射器连接，术前检查单增加专项确认项",
  },
  {
    deviceId: "YH-VEN-01",
    month: 7,
    eventType: "不良事件（管路冷凝水报警）",
    severity: "提示",
    correctiveAction: "调整湿化温度设定并纳入交接班核查清单",
  },
  {
    deviceId: "YH-EN-01",
    month: 8,
    eventType: "不良事件（洗消追溯缺项）",
    severity: "一般",
    correctiveAction: "补齐内镜洗消追溯记录并复核洗消机运行参数",
  },
  {
    deviceId: "YH-LA-01",
    month: 9,
    eventType: "安全隐患（门联锁误报）",
    severity: "重要",
    correctiveAction: "更换门联锁传感器，恢复治疗前完成安全联锁自检",
  },
  {
    deviceId: "YH-LAB-01",
    month: 10,
    eventType: "不良事件（标本溶血率偏高）",
    severity: "提示",
    correctiveAction: "与采血中心联合培训采血规范，按周监测溶血率回落",
  },
  {
    deviceId: "YH-DR-02",
    month: 11,
    eventType: "不良事件（转运途中碰撞）",
    severity: "提示",
    correctiveAction: "规划移动DR专用转运通道并加装防撞护角",
  },
];

const TARGET_OWNERS = ["设备管理部部长", "医学装备委员会秘书", "运营管理科科长"] as const;

const ANNUAL_TARGETS: ReadonlyArray<{
  metricCode: string;
  targetValue: string;
  budgetAmount: string;
}> = [
  { metricCode: "hospital.device.net_direct_revenue", targetValue: "62000000", budgetAmount: "9800000" },
  { metricCode: "hospital.device.exam_count", targetValue: "118000", budgetAmount: "" },
  { metricCode: "hospital.device.time_utilization_rate", targetValue: "0.72", budgetAmount: "" },
  { metricCode: "hospital.device.capacity_utilization_rate", targetValue: "0.68", budgetAmount: "" },
  { metricCode: "hospital.device.work_saturation_rate", targetValue: "0.80", budgetAmount: "" },
  { metricCode: "hospital.device.fleet_good_condition_rate", targetValue: "0.97", budgetAmount: "" },
  { metricCode: "hospital.device.avg_repair_response_hours", targetValue: "2", budgetAmount: "" },
  { metricCode: "hospital.device.mttr_hours", targetValue: "24", budgetAmount: "" },
  { metricCode: "hospital.device.fault_downtime_hours", targetValue: "900", budgetAmount: "" },
  { metricCode: "hospital.device.repair_cost_to_original_value_rate", targetValue: "0.025", budgetAmount: "5200000" },
  { metricCode: "hospital.device.power_on_hours", targetValue: "68000", budgetAmount: "" },
  { metricCode: "hospital.device.operating_surplus", targetValue: "21500000", budgetAmount: "" },
];

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

type Rng = ReturnType<typeof createRng>;

function randomInt(rng: Rng, min: number, max: number) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pad(value: number, width: number) {
  return String(value).padStart(width, "0");
}

function dateTime(period: string, day: number, hour: number, minute: number) {
  return `${period}-${pad(day, 2)} ${pad(hour, 2)}:${pad(minute, 2)}`;
}

function csvEscape(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

type ExamEntry = {
  device: DeviceSpec;
  monthIndex: number;
  time: string;
  day: number;
  bodyPart: string;
  bodyParts: string[];
  revenue: number;
  cost: number;
};

function generateExamEntries(rng: Rng): ExamEntry[] {
  const entries: ExamEntry[] = [];
  for (const device of DEVICES) {
    if (!device.sampleExamBase) continue;
    MONTHS.forEach((month, monthIndex) => {
      const count = Math.max(
        1,
        Math.round(device.sampleExamBase * month.factor + (rng() - 0.5) * 0.9),
      );
      for (let index = 0; index < count; index += 1) {
        const day = randomInt(rng, 1, Math.min(28, month.days));
        const hour = device.allDay ? randomInt(rng, 0, 23) : randomInt(rng, 8, 17);
        const minute = randomInt(rng, 0, 59);
        const partIndex = randomInt(rng, 0, device.bodyParts.length - 1);
        const mainPart = device.bodyParts[partIndex] ?? "常规部位";
        const multiPart = device.bodyParts.length > 1 && rng() < 0.15;
        const extraPart = multiPart
          ? (device.bodyParts[(partIndex + 1) % device.bodyParts.length] ?? mainPart)
          : "";
        const revenue = Math.round(
          device.revenueMin + rng() * (device.revenueMax - device.revenueMin),
        );
        const cost = Math.round(revenue * (0.55 + rng() * 0.25));
        entries.push({
          device,
          monthIndex,
          time: dateTime(month.period, day, hour, minute),
          day,
          bodyPart: mainPart,
          bodyParts: extraPart ? [mainPart, extraPart] : [mainPart],
          revenue,
          cost,
        });
      }
    });
  }
  entries.sort((left, right) =>
    left.time === right.time
      ? left.device.id.localeCompare(right.device.id)
      : left.time.localeCompare(right.time),
  );
  return entries;
}

function buildSampleDataset(): SampleDataset {
  const rng = createRng(20260811);

  const deviceRows: SampleRow[] = DEVICES.map((device) => ({
    recordType: "device",
    deviceId: device.id,
    assetCode: device.assetCode,
    deviceName: device.name,
    category: device.category,
    model: device.model,
    manufacturer: device.manufacturer,
    department: device.department,
    shortName: device.shortName,
    location: device.location,
    investment: device.investment.toFixed(2),
    purchaseDate: device.purchaseDate,
    enabledDate: device.enabledDate,
    quantity: "1",
    serviceUnit: device.serviceUnit,
    status: "在用",
    planPayback: device.planPayback.toFixed(1),
    forecastPayback: device.forecastPayback.toFixed(1),
    licenseNumber: device.licenseNumber,
    maintenanceStatus: device.maintenanceStatus,
  }));

  const examEntries = generateExamEntries(rng);
  const examRows: SampleRow[] = [];
  const billingRows: SampleRow[] = [];
  examEntries.forEach((entry, index) => {
    const examId = `EX-2026-${pad(index + 1, 5)}`;
    const multi = entry.bodyParts.length > 1;
    examRows.push({
      recordType: "exam",
      examId,
      deviceId: entry.device.id,
      occurredAt: entry.time,
      bodyPart: entry.bodyPart,
      bodyParts: JSON.stringify(entry.bodyParts),
      isPrimary: "是",
      allocationWeight: multi ? "0.65" : "1.00",
      examRevenue: String(entry.revenue),
      examCost: String(entry.cost),
      department: entry.device.department,
    });

    const [datePart = "", timePart = "08:00"] = entry.time.split(" ");
    const [hourText = "8", minuteText = "0"] = timePart.split(":");
    let minute = Number(minuteText) + randomInt(rng, 6, 45);
    let hour = Number(hourText);
    if (minute > 59) {
      minute -= 60;
      hour += 1;
    }
    if (hour > 23) {
      hour = 23;
      minute = 59;
    }
    const itemCode =
      entry.device.itemCodes[index % Math.max(1, entry.device.itemCodes.length)] ??
      "310700000";
    billingRows.push({
      recordType: "revenue",
      sourceRecordId: `SF-2026-${pad(index + 1, 5)}`,
      deviceId: entry.device.id,
      examId,
      occurredAt: `${datePart} ${pad(hour, 2)}:${pad(minute, 2)}`,
      itemCode,
      amount: String(entry.revenue),
      refundAmount: "",
      department: entry.device.department,
    });

    if (index % 47 === 23) {
      const month = MONTHS[entry.monthIndex];
      const refundDay = Math.min(entry.day + 2, month?.days ?? entry.day);
      const period = month?.period ?? "2026-01";
      billingRows.push({
        recordType: "revenue",
        sourceRecordId: `SF-2026-${pad(index + 1, 5)}-R`,
        deviceId: entry.device.id,
        examId,
        occurredAt: dateTime(period, refundDay, 10, randomInt(rng, 0, 59)),
        itemCode,
        amount: String(-entry.revenue),
        refundAmount: String(entry.revenue),
        department: entry.device.department,
      });
    }
  });

  type MaintenanceEntry = {
    device: DeviceSpec;
    monthIndex: number;
    time: string;
    eventType: string;
    downtime: number;
    cost: number;
    status: string;
    planned: boolean;
  };
  const maintenanceEntries: MaintenanceEntry[] = [];
  const downtimeByDeviceMonth = new Map<string, number>();
  for (const device of DEVICES) {
    for (const plannedMonth of device.plannedMaintenanceMonths) {
      const month = MONTHS[plannedMonth - 1];
      if (!month) continue;
      const downtime = randomInt(rng, 240, 480);
      maintenanceEntries.push({
        device,
        monthIndex: plannedMonth - 1,
        time: dateTime(month.period, randomInt(rng, 10, 20), 8, randomInt(rng, 0, 30)),
        eventType: "计划保养",
        downtime,
        cost: 0,
        status: "已完成",
        planned: true,
      });
      const key = `${device.id}|${month.period}`;
      downtimeByDeviceMonth.set(key, (downtimeByDeviceMonth.get(key) ?? 0) + downtime);
    }
    for (let index = 0; index < device.faultCount; index += 1) {
      const monthIndex = randomInt(rng, 0, 11);
      const month = MONTHS[monthIndex];
      if (!month) continue;
      const day = randomInt(rng, 2, Math.min(26, month.days - 2));
      const startHour = device.allDay ? randomInt(rng, 0, 23) : randomInt(rng, 8, 16);
      const startMinute = randomInt(rng, 0, 59);
      const reportDelay = randomInt(rng, 5, 40);
      const responseDelay = randomInt(rng, 30, 300);
      const severe = rng() < 0.3;
      const repairMinutes = severe
        ? randomInt(rng, 16, 72) * 60
        : randomInt(rng, 2, 10) * 60;
      const downtime = reportDelay + responseDelay + repairMinutes;
      const cost = severe
        ? Math.round(device.faultCostMax * (0.4 + rng() * 0.6))
        : Math.round(
            device.faultCostMin +
              rng() * Math.min(device.faultCostMin * 3, device.faultCostMax * 0.25),
          );
      let reportMinute = startMinute + reportDelay;
      let reportHour = startHour;
      while (reportMinute > 59) {
        reportMinute -= 60;
        reportHour += 1;
      }
      if (reportHour > 23) {
        reportHour = 23;
        reportMinute = 59;
      }
      const typeIndex = randomInt(rng, 0, device.faultTypes.length - 1);
      maintenanceEntries.push({
        device,
        monthIndex,
        time: dateTime(month.period, day, reportHour, reportMinute),
        eventType: device.faultTypes[typeIndex] ?? "机械部件故障",
        downtime,
        cost,
        status: "已验收",
        planned: false,
      });
      const key = `${device.id}|${month.period}`;
      downtimeByDeviceMonth.set(key, (downtimeByDeviceMonth.get(key) ?? 0) + downtime);
    }
  }
  maintenanceEntries.sort((left, right) =>
    left.time === right.time
      ? left.device.id.localeCompare(right.device.id)
      : left.time.localeCompare(right.time),
  );
  let plannedSequence = 0;
  let faultSequence = 0;
  const maintenanceRows: SampleRow[] = maintenanceEntries.map((entry) => {
    const eventId = entry.planned
      ? `BY-2026-${pad((plannedSequence += 1), 3)}`
      : `WX-2026-${pad((faultSequence += 1), 3)}`;
    return {
      recordType: "maintenance",
      eventId,
      deviceId: entry.device.id,
      occurredAt: entry.time,
      eventType: entry.eventType,
      downtimeMinutes: String(entry.downtime),
      maintenanceCost: entry.cost.toFixed(2),
      status: entry.status,
    };
  });

  const utilizationRows: SampleRow[] = [];
  const costRows: SampleRow[] = [];
  let voucherSequence = 0;
  for (const device of DEVICES) {
    MONTHS.forEach((month) => {
      const scheduled = device.allDay
        ? month.days * 1440
        : month.workdays * device.dailyMinutes;
      const volume = Math.max(
        1,
        Math.round(device.monthlyVolumeBase * month.factor * (1 + (rng() - 0.5) * 0.06)),
      );
      const active = Math.min(
        Math.round(volume * device.perCaseMinutes),
        Math.round(scheduled * 0.94),
      );
      const powered = device.allDay
        ? scheduled
        : Math.min(scheduled, active + month.workdays * 80);
      const downtime = downtimeByDeviceMonth.get(`${device.id}|${month.period}`) ?? 0;
      utilizationRows.push({
        recordType: "utilization",
        deviceId: device.id,
        period: `${month.period}-${pad(month.days, 2)}`,
        scheduledMinutes: String(scheduled),
        poweredMinutes: String(powered),
        activeMinutes: String(active),
        downtimeMinutes: String(downtime),
        examCount: String(volume),
      });

      const monthlyCosts: Array<[string, number]> = [
        ["折旧", device.investment / (device.depreciationYears * 12)],
        ["维保", (device.investment * device.annualMaintenanceRate) / 12],
        ["人工", device.laborMonthly * (1 + (rng() - 0.5) * 0.04)],
        ["耗材", device.consumablePerCase * volume],
        ["能耗", device.energyBase + device.energyPerActiveMinute * active],
      ];
      for (const [costType, amount] of monthlyCosts) {
        costRows.push({
          recordType: "cost",
          deviceId: device.id,
          period: month.period,
          costType,
          amount: amount.toFixed(2),
          sourceRecordId: `PZ-2026-${pad((voucherSequence += 1), 4)}`,
          department: device.department,
        });
      }
    });
  }

  const qualityRows: SampleRow[] = [];
  let qualitySequence = 0;
  QUALITY_DEVICES.forEach((deviceId, deviceIndex) => {
    MONTHS.forEach((month, monthIndex) => {
      const checkType =
        QUALITY_CHECK_TYPES[(deviceIndex + monthIndex) % QUALITY_CHECK_TYPES.length] ??
        "影像质量抽查";
      const roll = rng();
      const severity = roll < 0.82 ? "提示" : roll < 0.95 ? "一般" : "重要";
      const correctiveAction =
        severity === "提示"
          ? "质控通过，保持现行流程"
          : severity === "一般"
            ? "已按质控整改单完成校准并复验通过"
            : "停机复检并升级维保工单，复验合格后恢复排程";
      qualityRows.push({
        recordType: "quality",
        eventId: `QC-2026-${pad((qualitySequence += 1), 4)}`,
        deviceId,
        eventDate: `${month.period}-${pad(randomInt(rng, 20, 27), 2)}`,
        eventType: checkType,
        severity,
        correctiveAction,
      });
    });
  });
  ADVERSE_EVENTS.forEach((event, index) => {
    const month = MONTHS[event.month - 1];
    qualityRows.push({
      recordType: "quality",
      eventId: `AE-2026-${pad(index + 1, 3)}`,
      deviceId: event.deviceId,
      eventDate: `${month?.period ?? "2026-01"}-${pad(randomInt(rng, 5, 25), 2)}`,
      eventType: event.eventType,
      severity: event.severity,
      correctiveAction: event.correctiveAction,
    });
  });

  const targetRows: SampleRow[] = [];
  ANNUAL_TARGETS.forEach((target, index) => {
    targetRows.push({
      recordType: "target",
      metricCode: target.metricCode,
      period: "2026",
      targetValue: target.targetValue,
      budgetAmount: target.budgetAmount,
      department: "设备管理部",
      deviceId: "",
      owner: TARGET_OWNERS[index % TARGET_OWNERS.length] ?? "设备管理部部长",
    });
  });
  MONTHS.forEach((month) => {
    targetRows.push({
      recordType: "target",
      metricCode: "hospital.device.net_direct_revenue",
      period: month.period,
      targetValue: String(Math.round((62000000 / 12) * month.factor)),
      budgetAmount: String(Math.round(9800000 / 12)),
      department: "设备管理部",
      deviceId: "",
      owner: "运营管理科科长",
    });
  });

  return {
    device_master: deviceRows,
    exam_activity: examRows,
    billing_revenue: billingRows,
    cost_detail: costRows,
    maintenance: maintenanceRows,
    utilization: utilizationRows,
    quality_safety: qualityRows,
    target_budget: targetRows,
  };
}

let datasetCache: SampleDataset | null = null;

function sampleDataset(): SampleDataset {
  if (!datasetCache) datasetCache = buildSampleDataset();
  return datasetCache;
}

export const SAMPLE_DATA_ROW_COUNTS: Readonly<Record<string, number>> = {
  device_master: 20,
  exam_activity: 480,
  billing_revenue: 490,
  cost_detail: 1200,
  maintenance: 74,
  utilization: 240,
  quality_safety: 104,
  target_budget: 24,
};

/** 返回指定模板的示范数据行（按模板字段编码键控的字符串值），供服务端一键发布链路复用。 */
export function buildSampleDataRows(templateCode: string): ReadonlyArray<Readonly<Record<string, string>>> {
  const rows = sampleDataset()[templateCode];
  if (!rows) throw new Error(`UNKNOWN_SAMPLE_TEMPLATE_${templateCode}`);
  return rows;
}

export function buildSampleDataCsv(templateCode: string): SampleDataFile {
  const template = FILE_BUSINESS_TEMPLATES.find((item) => item.code === templateCode);
  const rows = sampleDataset()[templateCode];
  if (!template || !rows) throw new Error(`UNKNOWN_SAMPLE_TEMPLATE_${templateCode}`);
  const fields = templateFields(templateCode);
  const lines = [
    fields.map((field) => csvEscape(field.name)).join(","),
    ...rows.map((row) =>
      fields.map((field) => csvEscape(row[field.code] ?? "")).join(","),
    ),
  ];
  return {
    fileName: `${template.name}-示范数据-2026.csv`,
    csv: `\ufeff${lines.join("\r\n")}\r\n`,
    rowCount: rows.length,
  };
}
