export const benefitDeviceCategories = [
  "放射/放疗/核医学",
  "超声",
  "内镜",
  "手术室共享设备",
  "生命支持",
  "检验",
] as const;

export type BenefitDeviceCategory = (typeof benefitDeviceCategories)[number];

export const benefitCollectionMethodOptions = [
  "Excel 标准模板",
  "CSV 明细文件",
  "JSON 批量数据",
  "受控人工补充",
] as const;

export type BenefitCollectionMethod = (typeof benefitCollectionMethodOptions)[number];

export const benefitProfileStatusOptions = ["草稿", "待试导", "已启用", "停用"] as const;

export type BenefitProfileStatus = (typeof benefitProfileStatusOptions)[number];

export const utilizationDenominatorOptions = [
  "排班可服务时长（扣除计划停机）",
  "设备可用时长（扣除故障停机）",
  "科室开放时长",
  "自然日时长",
] as const;

export type UtilizationDenominator = (typeof utilizationDenominatorOptions)[number];

export type BenefitAnalysisProfile = {
  id: string;
  category: BenefitDeviceCategory;
  collectionMethods: BenefitCollectionMethod[];
  sourceSystems: string[];
  deviceIdentityBinding: string;
  eventFields: string[];
  workloadUnit: string;
  plannedServiceHoursPerMonth: number;
  ocrConfidenceThreshold: number;
  reconciliationTolerance: number;
  completenessThreshold: number;
  bindingRateThreshold: number;
  utilizationDenominator: UtilizationDenominator;
  allocationCountWeight: number;
  allocationTimeWeight: number;
  responsibleDepartment: string;
  effectiveDate: string;
  status: BenefitProfileStatus;
};

export const initialBenefitAnalysisProfiles: BenefitAnalysisProfile[] = [
  {
    id: "profile-radiology",
    category: "放射/放疗/核医学",
    collectionMethods: ["Excel 标准模板", "CSV 明细文件", "JSON 批量数据"],
    sourceSystems: ["影像业务文件", "收费收入文件", "设备运行日志文件", "财务成本文件"],
    deviceIdentityBinding: "资产编号 + DICOM AE Title + 设备序列号",
    eventFields: ["检查/治疗开始", "检查/治疗结束", "工作/待机/关机状态", "检查部位/治疗项目", "收费与退费标记"],
    workloadUnit: "检查/治疗例次",
    plannedServiceHoursPerMonth: 352,
    ocrConfidenceThreshold: 95,
    reconciliationTolerance: 1,
    completenessThreshold: 98,
    bindingRateThreshold: 99,
    utilizationDenominator: "排班可服务时长（扣除计划停机）",
    allocationCountWeight: 60,
    allocationTimeWeight: 40,
    responsibleDepartment: "医学影像科 / 放疗科 / 信息部",
    effectiveDate: "2026-07-01",
    status: "已启用",
  },
  {
    id: "profile-ultrasound",
    category: "超声",
    collectionMethods: ["Excel 标准模板", "CSV 明细文件", "JSON 批量数据"],
    sourceSystems: ["影像业务文件", "收费收入文件", "设备运行日志文件", "财务成本文件"],
    deviceIdentityBinding: "资产编号 + 工作站编号 + 主机/探头标识",
    eventFields: ["检查开始", "检查结束", "主机工作状态", "探头类型与使用时长", "收费与退费标记"],
    workloadUnit: "检查人次",
    plannedServiceHoursPerMonth: 440,
    ocrConfidenceThreshold: 96,
    reconciliationTolerance: 1.5,
    completenessThreshold: 98,
    bindingRateThreshold: 99,
    utilizationDenominator: "科室开放时长",
    allocationCountWeight: 70,
    allocationTimeWeight: 30,
    responsibleDepartment: "超声医学科 / 信息部",
    effectiveDate: "2026-07-01",
    status: "已启用",
  },
  {
    id: "profile-endoscopy",
    category: "内镜",
    collectionMethods: ["Excel 标准模板", "CSV 明细文件", "受控人工补充"],
    sourceSystems: ["内镜业务文件", "收费收入文件", "设备运行日志文件", "耗材明细文件"],
    deviceIdentityBinding: "资产编号 + 主机编号 + 镜体条码",
    eventFields: ["检查开始", "检查结束", "主机编号", "镜体编号与类型", "清洗消毒批次"],
    workloadUnit: "检查例次",
    plannedServiceHoursPerMonth: 352,
    ocrConfidenceThreshold: 96,
    reconciliationTolerance: 2,
    completenessThreshold: 98,
    bindingRateThreshold: 99,
    utilizationDenominator: "科室开放时长",
    allocationCountWeight: 50,
    allocationTimeWeight: 50,
    responsibleDepartment: "消化内镜中心 / 感控办 / 信息部",
    effectiveDate: "2026-08-01",
    status: "待试导",
  },
  {
    id: "profile-operating-room",
    category: "手术室共享设备",
    collectionMethods: ["Excel 标准模板", "CSV 明细文件", "JSON 批量数据"],
    sourceSystems: ["手术业务文件", "收费收入文件", "设备运行日志文件", "维修保养文件"],
    deviceIdentityBinding: "资产编号 + 文件内设备编码 + 手术间位置码",
    eventFields: ["设备进入/离开手术间", "使用开始", "使用结束", "工作状态", "去标识化手术事件键"],
    workloadUnit: "使用台次",
    plannedServiceHoursPerMonth: 352,
    ocrConfidenceThreshold: 95,
    reconciliationTolerance: 2,
    completenessThreshold: 97,
    bindingRateThreshold: 98,
    utilizationDenominator: "排班可服务时长（扣除计划停机）",
    allocationCountWeight: 60,
    allocationTimeWeight: 40,
    responsibleDepartment: "手术部 / 医学装备部 / 信息部",
    effectiveDate: "2026-08-01",
    status: "待试导",
  },
  {
    id: "profile-life-support",
    category: "生命支持",
    collectionMethods: ["Excel 标准模板", "CSV 明细文件", "JSON 批量数据"],
    sourceSystems: ["设备运行日志文件", "维修保养文件", "收费收入文件"],
    deviceIdentityBinding: "资产编号 + 设备序列号 + 文件内设备编码",
    eventFields: ["工作/待机/关机状态", "使用开始", "使用结束", "告警类型与次数", "服务区域编码"],
    workloadUnit: "设备使用小时",
    plannedServiceHoursPerMonth: 720,
    ocrConfidenceThreshold: 95,
    reconciliationTolerance: 2,
    completenessThreshold: 97,
    bindingRateThreshold: 99,
    utilizationDenominator: "设备可用时长（扣除故障停机）",
    allocationCountWeight: 30,
    allocationTimeWeight: 70,
    responsibleDepartment: "重症医学科 / 医学装备部 / 信息部",
    effectiveDate: "2026-09-01",
    status: "草稿",
  },
  {
    id: "profile-laboratory",
    category: "检验",
    collectionMethods: ["Excel 标准模板", "CSV 明细文件", "JSON 批量数据"],
    sourceSystems: ["检验业务文件", "收费收入文件", "耗材明细文件", "财务成本文件"],
    deviceIdentityBinding: "资产编号 + 文件内仪器编码 + 设备序列号",
    eventFields: ["标本接收", "检测开始", "检测完成", "检测项目与复检标记", "仪器状态与质控结果"],
    workloadUnit: "检测项次",
    plannedServiceHoursPerMonth: 600,
    ocrConfidenceThreshold: 95,
    reconciliationTolerance: 1,
    completenessThreshold: 99,
    bindingRateThreshold: 99,
    utilizationDenominator: "设备可用时长（扣除故障停机）",
    allocationCountWeight: 70,
    allocationTimeWeight: 30,
    responsibleDepartment: "检验科 / 信息部 / 物资部",
    effectiveDate: "2026-07-01",
    status: "已启用",
  },
];

export function cloneBenefitAnalysisProfiles(profiles = initialBenefitAnalysisProfiles) {
  return profiles.map((profile) => ({
    ...profile,
    collectionMethods: [...profile.collectionMethods],
    sourceSystems: [...profile.sourceSystems],
    eventFields: [...profile.eventFields],
  }));
}
