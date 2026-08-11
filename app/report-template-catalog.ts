import {
  createDefaultReportConfig,
  normalizeBenefitReportConfig,
  type BenefitReportConfig,
  type ReportSectionId,
} from "./benefit-report-model";

/**
 * 平台模板目录只描述“标准模板及适用规则”。
 *
 * 医院启用、设为默认、字段映射和报告实例应由各自的持久化关系承载，
 * 不在此处伪装成已经自动完成的数据接入或模板解析。
 */

export type ReportTemplateCategoryId =
  | "comprehensive_benefit"
  | "operational_performance"
  | "single_device_analysis"
  | "investment_configuration"
  | "lifecycle_disposal"
  | "special_governance";

export type TemplateSourceRequirementId =
  | "asset_master"
  | "his_billing"
  | "finance_hrp"
  | "device_runtime"
  | "cmms_eam"
  | "spd_material"
  | "quality_clinical"
  | "manual_supplement";

export type TemplateFieldPackId =
  | "basic_identity"
  | "asset_configuration"
  | "operational_efficiency"
  | "revenue_cost"
  | "investment_return"
  | "monthly_trend"
  | "quality_social"
  | "lifecycle_assurance"
  | "governance_audit";

export type TemplateAnalysisScope = "hospital" | "category" | "device";
export type TemplatePeriodGranularity = "month" | "quarter" | "half_year" | "year";
export type TemplateCostScope = "full_cost" | "non_personnel";
export type PlatformTemplateStatus = "active" | "preview";
export type TemplateSourceCriticality = "required" | "recommended" | "optional";

export type ReportTemplateCategory = {
  id: ReportTemplateCategoryId;
  code: string;
  name: string;
  description: string;
  typicalDecision: string;
  recommendedFrequency: string;
  sortOrder: number;
};

export type TemplateSourceRequirement = {
  id: TemplateSourceRequirementId;
  name: string;
  description: string;
  canonicalData: readonly string[];
  matchKeywords: readonly string[];
  fallback: string;
};

export type TemplateFieldPack = {
  id: TemplateFieldPackId;
  name: string;
  description: string;
  representativeFields: readonly string[];
  relatedSourceIds: readonly TemplateSourceRequirementId[];
};

export type PlatformReportTemplate = {
  id: string;
  code: string;
  name: string;
  shortName: string;
  categoryId: ReportTemplateCategoryId;
  summary: string;
  version: string;
  status: PlatformTemplateStatus;
  origin: "platform_baseline" | "reference_document_adaptation";
  referenceDocument?: {
    name: string;
    note: string;
  };
  supportedScopes: readonly TemplateAnalysisScope[];
  supportedPeriods: readonly TemplatePeriodGranularity[];
  costScope: TemplateCostScope;
  sourceRequirements: readonly {
    sourceId: TemplateSourceRequirementId;
    criticality: TemplateSourceCriticality;
    purpose: string;
  }[];
  fieldPackIds: readonly TemplateFieldPackId[];
  sectionIds: readonly ReportSectionId[];
  applicableHospitalProfiles: readonly string[];
  selectionGuidance: string;
  configPatch: Partial<BenefitReportConfig>;
  buildConfig: (period?: string) => BenefitReportConfig;
};

export const templateCategories: readonly ReportTemplateCategory[] = [
  {
    id: "comprehensive_benefit",
    code: "COMPREHENSIVE",
    name: "综合效益评价",
    description: "从经济、效率、质量安全、社会效益和生命周期形成院级综合判断。",
    typicalDecision: "年度经营复盘、院级绩效评价、管理驾驶舱汇报",
    recommendedFrequency: "半年或年度",
    sortOrder: 10,
  },
  {
    id: "operational_performance",
    code: "OPERATIONS",
    name: "运营绩效评价",
    description: "围绕开机、工作量、收入、成本、结余和投资回收评价设备运营表现。",
    typicalDecision: "月度运营分析、同类设备横向比较、科室联席复盘",
    recommendedFrequency: "月度或季度",
    sortOrder: 20,
  },
  {
    id: "single_device_analysis",
    code: "SINGLE_DEVICE",
    name: "单机深度分析",
    description: "对单台设备或同品类设备开展可追溯的工作量、收益、成本和趋势诊断。",
    typicalDecision: "重点设备复盘、低效设备整改、同品类配置优化",
    recommendedFrequency: "月度、季度或专项",
    sortOrder: 30,
  },
  {
    id: "investment_configuration",
    code: "INVESTMENT",
    name: "投资与配置论证",
    description: "服务购置、扩容和配置许可论证，比较需求、产能、全周期成本与预期回报。",
    typicalDecision: "购置可研、预算申报、配置证申请、同类设备增配",
    recommendedFrequency: "按项目",
    sortOrder: 40,
  },
  {
    id: "lifecycle_disposal",
    code: "LIFECYCLE",
    name: "生命周期与更新处置",
    description: "综合年限、故障、维保、质量风险、残值和替代能力形成更新或处置建议。",
    typicalDecision: "更新改造、维保策略、报废处置、设备调拨",
    recommendedFrequency: "年度或专项",
    sortOrder: 50,
  },
  {
    id: "special_governance",
    code: "GOVERNANCE",
    name: "专项监管与整改复评",
    description: "针对低效、闲置、漏费、质控或审计问题建立证据、责任、期限和复评闭环。",
    typicalDecision: "专项检查、审计整改、问题设备复评",
    recommendedFrequency: "按专项或整改周期",
    sortOrder: 60,
  },
] as const;

export const sourceRequirementCatalog: readonly TemplateSourceRequirement[] = [
  {
    id: "asset_master",
    name: "资产与设备主数据",
    description: "统一设备身份、资产原值、启用时间、科室、品牌型号和折旧基础。",
    canonicalData: ["设备唯一标识", "资产原值", "启用日期", "使用科室", "品牌型号", "折旧年限"],
    matchKeywords: ["资产系统", "设备台账", "固定资产", "设备档案"],
    fallback: "经医学装备部门复核的设备主数据导入表",
  },
  {
    id: "his_billing",
    name: "收费与业务导出文件",
    description: "提供设备关联项目的检查人次、服务量、收费金额及退费或免费业务；以医院受控导出文件进入平台。",
    canonicalData: ["服务人次", "收费工作量", "收入", "退费", "免费项目", "项目编码"],
    matchKeywords: ["HIS", "收费", "RIS", "PACS", "LIS", "预约"],
    fallback: "财务与业务科室共同签字确认的月度工作量收入表",
  },
  {
    id: "finance_hrp",
    name: "财务成本导出文件",
    description: "提供收入确认、折旧、维修、能源、人工和分摊等可审计财务口径；以财务确认文件进入平台。",
    canonicalData: ["确认收入", "折旧", "维修费", "能源费", "人工成本", "间接分摊"],
    matchKeywords: ["HRP", "财务", "成本核算", "总账", "预算"],
    fallback: "由财务部门确认口径和期间的成本归集表",
  },
  {
    id: "device_runtime",
    name: "设备运行日志文件",
    description: "记录开关机、工作状态、检查事件和故障事件，支撑效率指标。",
    canonicalData: ["开机时长", "工作时长", "空闲时长", "检查事件", "故障事件", "设备时间戳"],
    matchKeywords: ["物联网", "设备日志", "IoT", "DICOM", "运行日志"],
    fallback: "设备日志导出文件或经科室确认的运行记录",
  },
  {
    id: "cmms_eam",
    name: "维修保养导出文件",
    description: "提供报修、故障停机、预防性维护、维保合同和质量保障记录。",
    canonicalData: ["报修次数", "停机时长", "PM 完成率", "维保费用", "故障类型", "工单状态"],
    matchKeywords: ["CMMS", "EAM", "医学装备", "维修", "维保", "工单"],
    fallback: "设备维修维保台账及合同费用汇总",
  },
  {
    id: "spd_material",
    name: "物资耗材导出文件",
    description: "按设备或项目归集专用耗材、试剂和材料消耗。",
    canonicalData: ["耗材编码", "领用数量", "耗材金额", "退库", "设备关联", "项目关联"],
    matchKeywords: ["SPD", "物资", "耗材", "试剂", "库房"],
    fallback: "经物资部门与使用科室核对的耗材归集表",
  },
  {
    id: "quality_clinical",
    name: "临床质量与服务台账",
    description: "补充质量安全、临床能力、患者服务、科研教学和应急保障指标。",
    canonicalData: ["质控结果", "阳性率", "等候时间", "新技术", "科研教学", "应急服务"],
    matchKeywords: ["质控", "医务", "护理", "患者服务", "科研", "教学"],
    fallback: "责任部门确认的专项统计表及佐证材料",
  },
  {
    id: "manual_supplement",
    name: "受控人工补充",
    description: "承载暂未系统化但经责任人、口径和截止时间确认的数据。",
    canonicalData: ["数据值", "统计口径", "责任人", "佐证附件", "截止时间", "调整原因"],
    matchKeywords: ["人工填报", "导入", "补录", "专项台账"],
    fallback: "必须保留责任人、佐证、版本和审核记录，不允许无依据覆盖系统数据",
  },
] as const;

export const fieldPackCatalog: readonly TemplateFieldPack[] = [
  {
    id: "basic_identity",
    name: "基础身份包",
    description: "建立一院、一机、一编码的报告分析对象。",
    representativeFields: ["医院", "设备编号", "资产编号", "设备名称", "型号", "科室", "启用日期"],
    relatedSourceIds: ["asset_master"],
  },
  {
    id: "asset_configuration",
    name: "资产配置包",
    description: "描述规模、金额、品牌、资金来源、年龄结构和配置明细。",
    representativeFields: ["设备数量", "资产原值", "进口占比", "平均机龄", "品牌分布", "资金来源", "年龄分布"],
    relatedSourceIds: ["asset_master", "finance_hrp"],
  },
  {
    id: "operational_efficiency",
    name: "运行效率包",
    description: "统一开机率、使用率、工作时长和服务时段的分母与时间口径。",
    representativeFields: ["开机时长", "开机率", "工作时长", "使用率", "首次工作时间", "末次工作时间"],
    relatedSourceIds: ["device_runtime", "his_billing", "manual_supplement"],
  },
  {
    id: "revenue_cost",
    name: "收益成本包",
    description: "形成收入、成本、结余、结余率和成本构成。",
    representativeFields: ["服务人次", "总收入", "折旧", "维修费", "耗材费", "其他成本", "净收益", "结余率"],
    relatedSourceIds: ["his_billing", "finance_hrp", "spd_material"],
  },
  {
    id: "investment_return",
    name: "投资回报包",
    description: "评价设备投入与年度产出的匹配程度。",
    representativeFields: ["购置金额", "年化净收益", "静态回收期", "年度 ROI", "维修费率", "维修收入比"],
    relatedSourceIds: ["asset_master", "finance_hrp", "his_billing", "cmms_eam"],
  },
  {
    id: "monthly_trend",
    name: "月度趋势包",
    description: "按月冻结工作量、收入、成本、结余和效率，支持季、半年和年度汇总。",
    representativeFields: ["月份", "服务量", "收入", "成本", "净收益", "开机率", "使用率"],
    relatedSourceIds: ["his_billing", "finance_hrp", "device_runtime"],
  },
  {
    id: "quality_social",
    name: "质量与社会效益包",
    description: "补充质量安全、服务可及性、临床能力和科研教学价值。",
    representativeFields: ["质控合格率", "患者等候", "临床新技术", "外转减少", "应急保障", "科研教学"],
    relatedSourceIds: ["quality_clinical", "cmms_eam", "manual_supplement"],
  },
  {
    id: "lifecycle_assurance",
    name: "保障与生命周期包",
    description: "覆盖故障、维护、可用性、全寿命周期成本和更新处置。",
    representativeFields: ["故障次数", "停机时长", "MTBF", "MTTR", "PM 完成率", "LCC", "更新建议"],
    relatedSourceIds: ["asset_master", "cmms_eam", "finance_hrp"],
  },
  {
    id: "governance_audit",
    name: "治理审计包",
    description: "保留模板、公式、责任链、数据截止、整改和复评记录。",
    representativeFields: ["模板版本", "公式版本", "数据截止时间", "编制人", "审核人", "问题责任", "复评结果"],
    relatedSourceIds: ["manual_supplement"],
  },
] as const;

const comprehensiveSections: ReportSectionId[] = [
  "summary",
  "scope",
  "inventory",
  "economic",
  "efficiency",
  "quality",
  "social",
  "lifecycle",
  "evaluation",
  "issues",
  "conclusion",
  "appendix",
];

const operationalSections: ReportSectionId[] = [
  "summary",
  "scope",
  "inventory",
  "efficiency",
  "economic",
  "issues",
  "conclusion",
  "appendix",
];

const singleDeviceSections: ReportSectionId[] = [
  "summary",
  "scope",
  "inventory",
  "efficiency",
  "economic",
  "quality",
  "issues",
  "conclusion",
  "appendix",
];

function buildConfig(
  defaultPeriod: string,
  patch: Partial<BenefitReportConfig>,
  requestedPeriod?: string,
): BenefitReportConfig {
  const base = createDefaultReportConfig(requestedPeriod ?? defaultPeriod);
  return {
    ...base,
    ...patch,
    period: requestedPeriod ?? patch.period ?? base.period,
    sections: [...(patch.sections ?? base.sections)],
  };
}

export function granularityForPeriod(period: string): TemplatePeriodGranularity | null {
  const normalized = period.trim();
  if (/^\d{4}年(?:[1-9]|1[0-2])月$/.test(normalized)) return "month";
  if (/^\d{4}年第[一二三四]季度$/.test(normalized)) return "quarter";
  if (/^\d{4}年[上下]半年$/.test(normalized)) return "half_year";
  if (/^\d{4}年度$/.test(normalized)) return "year";
  return null;
}

export const platformReportTemplates: readonly PlatformReportTemplate[] = [
  {
    id: "platform-comprehensive-benefit-v2",
    code: "YH-COMPREHENSIVE-001",
    name: "医疗设备全维度综合效益分析",
    shortName: "全维度综合",
    categoryId: "comprehensive_benefit",
    summary: "适用于院级年度或半年度综合评价，兼顾经济产出、运行效率、质量安全、社会效益与生命周期。",
    version: "2.0",
    status: "active",
    origin: "platform_baseline",
    supportedScopes: ["hospital", "category", "device"],
    supportedPeriods: ["quarter", "half_year", "year"],
    costScope: "full_cost",
    sourceRequirements: [
      { sourceId: "asset_master", criticality: "required", purpose: "确定设备身份、资产原值和配置基础" },
      { sourceId: "his_billing", criticality: "required", purpose: "形成工作量和收入" },
      { sourceId: "finance_hrp", criticality: "required", purpose: "形成全成本和财务确认口径" },
      { sourceId: "device_runtime", criticality: "recommended", purpose: "形成运行效率和使用时段" },
      { sourceId: "cmms_eam", criticality: "required", purpose: "形成保障能力和生命周期指标" },
      { sourceId: "spd_material", criticality: "recommended", purpose: "归集耗材和试剂成本" },
      { sourceId: "quality_clinical", criticality: "required", purpose: "补充质量安全和社会效益" },
      { sourceId: "manual_supplement", criticality: "optional", purpose: "补充暂未系统化的管理指标" },
    ],
    fieldPackIds: [
      "basic_identity",
      "asset_configuration",
      "operational_efficiency",
      "revenue_cost",
      "investment_return",
      "monthly_trend",
      "quality_social",
      "lifecycle_assurance",
      "governance_audit",
    ],
    sectionIds: comprehensiveSections,
    applicableHospitalProfiles: ["三级综合医院", "三级专科医院", "二级医院", "医联体牵头医院"],
    selectionGuidance: "需要形成院级管理结论、跨维度评分或年度正式报告时使用；不建议替代月度单机运营复盘。",
    configPatch: {
      title: "大型医疗设备全维度综合效益分析报告",
      scope: "hospital",
      sections: comprehensiveSections,
    },
    buildConfig: (period) => buildConfig("2026年度", {
      title: "大型医疗设备全维度综合效益分析报告",
      scope: "hospital",
      sections: comprehensiveSections,
    }, period),
  },
  {
    id: "platform-operational-performance-v1",
    code: "YH-OPERATIONS-001",
    name: "医疗设备运营绩效分析",
    shortName: "运营绩效",
    categoryId: "operational_performance",
    summary: "依据新增《医疗设备绩效分析报告模版》归纳，聚焦资产配置、运行效率、收益成本、ROI 与分期明细。",
    version: "1.0",
    status: "active",
    origin: "reference_document_adaptation",
    referenceDocument: {
      name: "医疗设备绩效分析-模版.pdf",
      note: "由报告结构、指标和公式人工归纳为平台草案；启用前仍需医院确认财务口径、分母和数据映射。",
    },
    supportedScopes: ["hospital", "category", "device"],
    supportedPeriods: ["month", "quarter", "half_year", "year"],
    costScope: "non_personnel",
    sourceRequirements: [
      { sourceId: "asset_master", criticality: "required", purpose: "设备基础信息、资产配置和折旧基础" },
      { sourceId: "his_billing", criticality: "required", purpose: "服务量、收费和收入" },
      { sourceId: "finance_hrp", criticality: "required", purpose: "折旧、维修及其他非人工成本" },
      { sourceId: "device_runtime", criticality: "required", purpose: "开机、工作时长和使用率" },
      { sourceId: "cmms_eam", criticality: "required", purpose: "维修费、维保和故障记录" },
      { sourceId: "manual_supplement", criticality: "recommended", purpose: "补充首末工作时间、归属说明和调整事项" },
    ],
    fieldPackIds: [
      "basic_identity",
      "asset_configuration",
      "operational_efficiency",
      "revenue_cost",
      "investment_return",
      "monthly_trend",
      "governance_audit",
    ],
    sectionIds: operationalSections,
    applicableHospitalProfiles: ["三级综合医院", "三级专科医院", "二级医院", "有月度设备运营分析机制的医院"],
    selectionGuidance: "需要按月、季、半年或年度查看设备运营表现时使用；本模板明确采用非人工成本，不得与全成本报告直接混用。",
    configPatch: {
      title: "医疗设备运营绩效分析报告",
      scope: "hospital",
      sections: operationalSections,
    },
    buildConfig: (period) => buildConfig("2026年6月", {
      title: "医疗设备运营绩效分析报告",
      scope: "hospital",
      sections: operationalSections,
    }, period),
  },
  {
    id: "platform-device-deep-dive-v1",
    code: "YH-DEVICE-DEEP-001",
    name: "单机与同品类设备深度分析",
    shortName: "单机 / 同品类深度",
    categoryId: "single_device_analysis",
    summary: "以单台设备或同品类全部设备为范围，深挖收益、效率和保障，并支持统一口径的横向比较。",
    version: "1.0",
    status: "active",
    origin: "reference_document_adaptation",
    referenceDocument: {
      name: "医疗设备绩效分析-模版.pdf",
      note: "将原模版的单机分析与同品类范围分析归纳为一个可切换范围的标准模板草案。",
    },
    supportedScopes: ["category", "device"],
    supportedPeriods: ["month", "quarter", "half_year", "year"],
    costScope: "non_personnel",
    sourceRequirements: [
      { sourceId: "asset_master", criticality: "required", purpose: "绑定单机或同品类设备身份" },
      { sourceId: "his_billing", criticality: "required", purpose: "按设备归属服务量和收入" },
      { sourceId: "finance_hrp", criticality: "required", purpose: "按设备归属折旧和运营成本" },
      { sourceId: "device_runtime", criticality: "required", purpose: "形成单机时长、效率和峰谷特征" },
      { sourceId: "cmms_eam", criticality: "required", purpose: "形成故障、维修和可用性证据" },
      { sourceId: "manual_supplement", criticality: "recommended", purpose: "记录设备归属调整和异常说明" },
    ],
    fieldPackIds: [
      "basic_identity",
      "asset_configuration",
      "operational_efficiency",
      "revenue_cost",
      "investment_return",
      "monthly_trend",
      "lifecycle_assurance",
      "governance_audit",
    ],
    sectionIds: singleDeviceSections,
    applicableHospitalProfiles: ["所有已建立设备唯一身份和设备级工作量映射的医院"],
    selectionGuidance: "用于重点单机诊断或同品类多机比较；选择同品类时必须先统一工作量、收入归属和使用率分母。",
    configPatch: {
      title: "医疗设备单机与同品类深度分析报告",
      scope: "device",
      sections: singleDeviceSections,
    },
    buildConfig: (period) => buildConfig("2026年6月", {
      title: "医疗设备单机与同品类深度分析报告",
      scope: "device",
      sections: singleDeviceSections,
    }, period),
  },
] as const;

export function getPlatformTemplate(idOrCode: string): PlatformReportTemplate | undefined {
  return platformReportTemplates.find(
    (template) => template.id === idOrCode || template.code === idOrCode,
  );
}

export function buildPlatformTemplateConfig(
  template: PlatformReportTemplate,
  period?: string,
): BenefitReportConfig {
  const category = templateCategories.find((item) => item.id === template.categoryId);
  const periodLabels: Record<TemplatePeriodGranularity, string> = {
    month: "月度",
    quarter: "季度",
    half_year: "半年度",
    year: "年度",
  };
  const requestedGranularity = period ? granularityForPeriod(period) : null;
  const safePeriod = period && requestedGranularity && template.supportedPeriods.includes(requestedGranularity)
    ? period.trim()
    : undefined;
  return normalizeBenefitReportConfig({
    ...template.buildConfig(safePeriod),
    costScope: template.costScope === "non_personnel" ? "non_personnel" : "full",
    template: {
      code: template.code,
      name: template.name,
      category: template.categoryId,
      categoryLabel: category?.name ?? "未分类",
      version: template.version,
      origin: "platform",
      status: template.status === "active" ? "published" : "draft",
      sourceDocument: template.referenceDocument?.name,
      fieldPackIds: [...template.fieldPackIds],
      sourceRequirementIds: template.sourceRequirements.map((item) => item.sourceId),
      requiredSourceRequirementIds: template.sourceRequirements
        .filter((item) => item.criticality === "required")
        .map((item) => item.sourceId),
      supportedScopes: [...template.supportedScopes],
      supportedPeriods: template.supportedPeriods.map((item) => periodLabels[item]),
      applicableDeviceCategories: [],
    },
  }, safePeriod);
}
