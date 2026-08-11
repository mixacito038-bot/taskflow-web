import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import { PRODUCT_FULL_NAME } from "./brand";
import { BenefitReportModel, ReportSectionId, reportFieldDomains } from "./benefit-report-model";
import { metricDefinitions } from "./metric-definitions";
import { HOSPITAL_METRIC_CATALOG_VERSION, hospitalMetricCatalog } from "./hospital-metric-catalog";

const NAVY = "1F4E79";
const PALE = "EAF1F7";
const BORDER = "7A8793";
const TEXT = "182230";
const MUTED = "667587";
const DOC_FONT = "Arial Unicode MS";
const PAGE_WIDTH = 12240;
const CONTENT_WIDTH = 9960;
type TextRunOptions = Exclude<ConstructorParameters<typeof TextRun>[0], string>;
type ParagraphOptions = Exclude<ConstructorParameters<typeof Paragraph>[0], string>;
type ParagraphAlignment = NonNullable<ParagraphOptions["alignment"]>;

function run(text: string, options: TextRunOptions = {}) {
  return new TextRun({ text, font: DOC_FONT, color: TEXT, ...options });
}

function para(text: string, options: ParagraphOptions = {}) {
  return new Paragraph({ children: [run(text)], spacing: { after: 120, line: 320 }, ...options });
}

function heading(text: string, level: typeof HeadingLevel.HEADING_1 | typeof HeadingLevel.HEADING_2 | typeof HeadingLevel.HEADING_3 = HeadingLevel.HEADING_1) {
  return new Paragraph({ text, heading: level, spacing: { before: level === HeadingLevel.HEADING_1 ? 300 : 180, after: 100 }, keepNext: true });
}

function bullet(text: string) {
  return new Paragraph({ children: [run(text)], bullet: { level: 0 }, spacing: { after: 90, line: 320 } });
}

function tableCell(text: string, width: number, header: boolean, shaded: boolean, alignment: ParagraphAlignment = AlignmentType.LEFT) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    shading: header ? { fill: NAVY, type: ShadingType.CLEAR } : shaded ? { fill: PALE, type: ShadingType.CLEAR } : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({ alignment, spacing: { after: 0, line: 280 }, children: [run(text, { color: header ? "FFFFFF" : TEXT, bold: header, size: header ? 20 : 19 })] })],
  });
}

function reportTable(headers: string[], rows: Array<Array<string | number>>, widths?: number[]) {
  const resolved = widths ?? headers.map(() => Math.floor(CONTENT_WIDTH / headers.length));
  const remainder = CONTENT_WIDTH - resolved.reduce((sum, value) => sum + value, 0);
  resolved[resolved.length - 1] += remainder;
  const border = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: resolved,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((value, index) => tableCell(value, resolved[index], true, false, AlignmentType.CENTER)) }),
      ...rows.map((row, rowIndex) => new TableRow({ cantSplit: true, children: row.map((value, index) => {
        const text = String(value);
        const numeric = /^[-+]?\d[\d,.]*(?:%|年|万|元|小时|天|次|人次)?$/.test(text);
        return tableCell(text, resolved[index], false, rowIndex % 2 === 1, numeric ? AlignmentType.RIGHT : AlignmentType.LEFT);
      }) })),
    ],
  });
}

function spacer() {
  return new Paragraph({ text: "", spacing: { after: 100 } });
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

function sectionEnabled(model: BenefitReportModel, id: ReportSectionId) {
  return model.config.sections.includes(id);
}

function roundReportAmount(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function periodCostParts(row: BenefitReportModel["rows"][number], includeLabor: boolean) {
  const { cost } = row.device;
  const annualBase = cost.consumables
    + cost.depreciation
    + cost.maintenance
    + cost.energy
    + cost.space
    + cost.indirect
    + (includeLabor ? cost.labor : 0);
  const periodRatio = annualBase ? row.cost / annualBase : 0;
  const leadingAnnualParts = includeLabor
    ? [cost.labor, cost.consumables, cost.depreciation, cost.maintenance]
    : [cost.consumables, cost.depreciation, cost.maintenance];
  const leadingPeriodParts = leadingAnnualParts.map((value) => roundReportAmount(value * periodRatio));
  const displayedTotal = roundReportAmount(row.cost);
  const groupedRemainder = roundReportAmount(
    displayedTotal - leadingPeriodParts.reduce((sum, value) => sum + value, 0),
  );
  return [...leadingPeriodParts, groupedRemainder].map((value) => value.toFixed(1));
}

export type BenefitReportExportContext = {
  statusLabel: string;
  reportNumber: string;
  version: number;
  qualityScore: number;
  reviewedBy?: string;
  approvedBy?: string;
  issuedAt?: string | null;
};

export async function exportBenefitReportDocx(model: BenefitReportModel, context?: BenefitReportExportContext) {
  const issued = context?.statusLabel === "已签发";
  const rowsWithInsight = model.rows.filter((row) => row.hasInsight);
  const editionLabel = issued ? "正式签发版" : "未签发预览版";
  const scopeLabel = model.config.scope === "hospital"
    ? "全院重点设备"
    : model.config.scope === "category"
      ? `设备品类：${model.config.deviceCategory || "未指定"}`
      : `单台设备：${model.rows[0]?.device.name ?? "未指定"}`;
  const blocks: Array<Paragraph | Table> = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 300 }, children: [run(model.config.title, { bold: true, size: 40, color: NAVY })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [run(`（${model.config.period} · ${model.config.template.categoryLabel} · V${model.config.template.version}）`, { size: 24, color: MUTED })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 180, after: 80 }, children: [run(editionLabel, { bold: true, size: 22, color: issued ? "168560" : "C2413B" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 180 }, children: [run(`${context?.reportNumber || "尚未编号"} · V${context?.version ?? 1} · 数据可信度 ${context?.qualityScore ?? "—"} 分`, { size: 18, color: MUTED })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 700, after: 160 }, children: [run(model.hospital.name, { bold: true, size: 26 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 140 }, children: [run(model.config.preparedBy, { size: 22, color: MUTED })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 100 }, children: [run(`编制：${model.config.compiler || "—"}`, { size: 20 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run(`审核：${model.config.reviewer || "—"}`, { size: 20 })] }),
    ...(context?.reviewedBy ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run(`系统复核账号：${context.reviewedBy}`, { size: 20 })] })] : []),
    ...(context?.approvedBy ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run(`系统签发账号：${context.approvedBy}`, { size: 20 })] })] : []),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run(`报告日期：${model.config.issueDate}`, { size: 20 })] }),
    ...(issued && context?.issuedAt ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [run(`签发时间：${new Date(context.issuedAt).toLocaleString("zh-CN", { hour12: false })}`, { size: 20, color: "168560" })] })] : []),
    pageBreak(),
  ];

  if (sectionEnabled(model, "summary")) {
    blocks.push(heading("第一部分 报告摘要"));
    blocks.push(reportTable(["核心指标", "数值", "核心指标", "数值"], [
      ["纳入分析设备", `${model.rows.length} 组`, "设备总原值", `${model.totals.investment.toFixed(1)} 万元`],
      ["期间总收入", `${model.totals.revenue.toFixed(1)} 万元`, `期间${model.costLabel}`, `${model.totals.cost.toFixed(1)} 万元`],
      ["期间总结余", `${model.totals.net.toFixed(1)} 万元`, "收支结余率", `${model.totals.margin.toFixed(1)}%`],
      ["总服务量", model.totals.serviceVolume.toLocaleString("zh-CN"), "平均使用率", `${model.totals.avgUtilization.toFixed(1)}%`],
      ["综合评级", rowsWithInsight.length ? `${model.grade}（${model.overallScore.toFixed(1)}分）` : "数据缺失", "设备可用率", rowsWithInsight.length ? `${model.totals.avgAvailability.toFixed(1)}%` : "数据缺失"],
    ], [2200, 2780, 2200, 2780]));
    blocks.push(spacer(), heading("重点发现", HeadingLevel.HEADING_2), ...model.keyFindings.map(bullet));
    blocks.push(heading("主要问题", HeadingLevel.HEADING_2), ...model.issues.slice(0, 6).map((issue) => bullet(`${issue.device}：${issue.evidence}`)));
    blocks.push(heading("核心建议", HeadingLevel.HEADING_2), ...model.recommendations.map(bullet));
  }

  if (sectionEnabled(model, "scope")) {
    blocks.push(heading("第二部分 分析范围与数据来源"));
    blocks.push(para(`分析层级：${scopeLabel}；报告期间：${model.config.period}；纳入标准：设备原值不低于 ${model.config.minimumInvestment} 万元。`));
    blocks.push(para(`采用模板：${model.config.template.name} V${model.config.template.version}（${model.config.template.categoryLabel}）；成本口径：${model.costLabel}；缺失值策略：${model.config.commonRules.missingValuePolicy === "block" ? "缺失即阻断" : model.config.commonRules.missingValuePolicy === "warn" ? "缺失预警" : "允许说明后人工补录"}。`));
    if (model.config.commonRules.missingValuePolicy === "manual_with_reason") {
      blocks.push(para(`受控补录：责任人 ${model.config.commonRules.manualDataOwner || "未填写"}；原因 ${model.config.commonRules.manualDataReason || "未填写"}；佐证 ${model.config.commonRules.manualDataEvidence || "未填写"}。`));
    }
    blocks.push(para(`采集规则准备度：${model.analysisProfileCoverage.enabled}/${model.analysisProfileCoverage.total} 个相关设备品类已启用；报告快照同时冻结设备身份绑定、使用率分母、完整率、绑定率与收费对账容差。`));
    blocks.push(reportTable(["数据类别", "文件模板 / 方式", "状态", "主要字段"], model.dataSources.map((source) => [source.category, source.name, source.status, source.fields]), [1800, 2450, 1300, 4410]));
  }

  if (sectionEnabled(model, "inventory")) {
    blocks.push(heading("第三部分 设备基本情况"));
    blocks.push(reportTable(["设备名称", "类别 / 厂家", "资产编号 / SN", "使用科室 / 地点", "启用日期", "原值（万）"], model.rows.map(({ device }) => [
      device.name,
      `${device.category ?? "未配置"} / ${device.manufacturer ?? "未配置"}`,
      `${device.assetCode} / ${device.serialNumber ?? "未配置"}`,
      `${device.department} / ${device.location ?? "未配置"}`,
      device.enabledDate,
      device.investment.toFixed(1),
    ]), [1900, 1760, 1780, 2020, 1200, 1300]));
  }

  if (sectionEnabled(model, "economic")) {
    blocks.push(heading("第四部分 经济效益分析"));
    blocks.push(reportTable(["设备", "收入（万）", `${model.costLabel}（万）`, "结余（万）", "结余率", "静态回收期"], model.rows.map((row) => [row.device.shortName, row.revenue.toFixed(1), row.cost.toFixed(1), row.net.toFixed(1), `${(row.revenue ? row.net / row.revenue * 100 : 0).toFixed(1)}%`, row.payback ? `${row.payback.toFixed(1)}年` : "不可回收"]), [2200, 1550, 1550, 1550, 1450, 1660]));
    blocks.push(spacer(), heading("成本结构", HeadingLevel.HEADING_2));
    if (model.config.costScope === "non_personnel") {
      const costRows = model.rows.map((row) => [row.device.shortName, ...periodCostParts(row, false)]);
      blocks.push(reportTable(["设备", "耗材/试剂", "折旧", "维修维保", "能耗/空间/管理"], costRows, [2300, 1700, 1700, 1850, 2410]));
      blocks.push(para("本模板按非人员成本评价，人工成本不计入本节成本与结余；如用于医院全成本核算，应切换综合效益模板或经财务确认后补充人工成本。"));
    } else {
      const costRows = model.rows.map((row) => [row.device.shortName, ...periodCostParts(row, true)]);
      blocks.push(reportTable(["设备", "人工", "耗材/试剂", "折旧", "维修维保", "能耗/空间/管理"], costRows, [2100, 1450, 1550, 1450, 1600, 1810]));
    }
    blocks.push(spacer(), para("收入完整性核查：建议按月对账已发布业务量文件、收费收入文件和退费记录，差异分类保留免费复查、绿色通道、补录和疑似漏费原因。"));
  }

  if (sectionEnabled(model, "efficiency")) {
    blocks.push(heading("第五部分 使用效率分析"));
    blocks.push(reportTable(["设备", "使用率", "开机率", "负荷率", "日均有效时长", "预约等待", "现场等待"], model.rows.map((row) => row.hasInsight ? [row.device.shortName, `${row.device.utilization}%`, `${row.insight.uptimeRate}%`, `${row.insight.loadRate}%`, `${row.insight.activeHours}小时`, `${row.insight.appointmentWaitDays}天`, `${row.insight.onSiteWaitMinutes}分钟`] : [row.device.shortName, `${row.device.utilization}%`, "数据缺失", "数据缺失", "数据缺失", "数据缺失", "数据缺失"]), [1900, 1200, 1200, 1200, 1500, 1450, 1510]));
  }

  if (sectionEnabled(model, "quality")) {
    blocks.push(heading("第六部分 质量安全与运行保障"));
    blocks.push(reportTable(["设备", "质控合格率", "设备可用率", "故障率", "停机时长", "MTTR", "PM完成/通过"], model.rows.map((row) => row.hasInsight ? [row.device.shortName, `${row.insight.reportQualityRate}%`, `${row.insight.availabilityRate}%`, `${row.insight.failuresPer1000Hours}次/千小时`, `${row.insight.downtimeHours}小时`, `${row.insight.mttrHours}小时`, `${row.insight.pmCompletionRate}% / ${row.insight.pmPassRate}%`] : [row.device.shortName, "数据缺失", "数据缺失", "数据缺失", "数据缺失", "数据缺失", "数据缺失"]), [1800, 1450, 1450, 1550, 1200, 1100, 1410]));
  }

  if (sectionEnabled(model, "social")) {
    blocks.push(heading("第七部分 社会效益分析"));
    blocks.push(...[
      rowsWithInsight.length ? `服务可及性：平均预约等待 ${(rowsWithInsight.reduce((sum, row) => sum + row.insight.appointmentWaitDays, 0) / rowsWithInsight.length).toFixed(1)} 天，现场等待 ${(rowsWithInsight.reduce((sum, row) => sum + row.insight.onSiteWaitMinutes, 0) / rowsWithInsight.length).toFixed(0)} 分钟。` : "服务可及性：数据缺失，未生成等待时长结论。",
      "临床能力：按设备类别统计新增技术、新项目、复杂病例支持和 DRG/DIP 病组贡献，避免仅以收费流水评价。",
      "应急与教学：记录应急调配、重大保障、科研课题、论文、培训和进修带教等非财务产出。",
      rowsWithInsight.length ? `患者体验：平均满意度 ${(rowsWithInsight.reduce((sum, row) => sum + row.insight.satisfaction, 0) / rowsWithInsight.length).toFixed(1)} 分。` : "患者体验：数据缺失，未生成满意度结论。",
    ].map(bullet));
  }

  if (sectionEnabled(model, "lifecycle")) {
    blocks.push(heading("第八部分 配置合理性与全生命周期"));
    blocks.push(reportTable(["设备", "使用年限 / 预计年限", "维保状态", "监测状态", "本期建议"], model.rows.map((row) => {
      const age = Math.max(0, 2026 - Number(row.device.enabledDate.slice(0, 4)));
      const advice = row.device.utilization >= 80 ? "保障运行，跟踪扩容阈值" : row.net < 0 ? "限期整改，评估调配或处置" : "优化排班与共享，半年后复评";
      return [row.device.shortName, `${age}年 / ${row.device.usefulLifeYears ?? "未配置"}年`, row.device.maintenanceStatus ?? "未配置", row.device.monitoringStatus ?? "未配置", advice];
    }), [1700, 1800, 1700, 1900, 2860]));
  }

  if (sectionEnabled(model, "evaluation")) {
    blocks.push(heading("第九部分 综合效益评价"));
    blocks.push(reportTable(["评价维度", "权重", "得分", "加权得分", "评价"], model.scoreRows.map((item) => [item.label, `${item.weight}%`, item.score.toFixed(1), item.weighted.toFixed(1), item.score >= 85 ? "表现突出" : item.score >= 70 ? "运行稳定" : "需要改进"]), [2100, 1300, 1400, 1600, 3560]));
    blocks.push(spacer(), para(`综合得分 ${model.overallScore.toFixed(1)} 分，评级“${model.grade}”。评分规则：优 ≥85，良 70—84，一般 60—69，差 <60。`));
  }

  if (sectionEnabled(model, "issues")) {
    blocks.push(heading("第十部分 问题清单与整改计划"));
    blocks.push(reportTable(["设备", "问题类型", "具体表现", "初步原因", "责任部门", "时限", "优先级"], model.issues.map((issue) => [issue.device, issue.type, issue.evidence, issue.cause, issue.owner, issue.due, issue.priority]), [1400, 1250, 2200, 2100, 1500, 1000, 510]));
  }

  if (sectionEnabled(model, "conclusion")) {
    blocks.push(heading("第十一部分 结论与建议"));
    blocks.push(heading("总体结论", HeadingLevel.HEADING_2), para(`${model.config.period}，${model.hospital.name}纳入 ${model.rows.length} 组重点设备，总收入 ${model.totals.revenue.toFixed(1)} 万元、${model.costLabel} ${model.totals.cost.toFixed(1)} 万元、总结余 ${model.totals.net.toFixed(1)} 万元，平均使用率 ${model.totals.avgUtilization.toFixed(1)}%，综合评分 ${model.overallScore.toFixed(1)} 分（${model.grade}）。`));
    blocks.push(heading("分类施策建议", HeadingLevel.HEADING_2), ...model.recommendations.map(bullet));
    blocks.push(para(`编制部门：${model.config.preparedBy}    编制：${model.config.compiler || "—"}    审核：${model.config.reviewer || "—"}`));
  }

  if (sectionEnabled(model, "appendix")) {
    blocks.push(pageBreak(), heading("附录A 模板、版本与公共口径"));
    blocks.push(reportTable(["项目", "冻结值"], [
      ["模板分类", model.config.template.categoryLabel],
      ["模板与版本", `${model.config.template.name} V${model.config.template.version}`],
      ["模板来源", model.config.template.sourceDocument || (model.config.template.origin === "hospital" ? "医院适配配置" : "平台公共模板")],
      ["成本口径", model.costLabel],
      ["医院指标模板", model.config.commonRules.hospitalMetricTemplateVersion ?? HOSPITAL_METRIC_CATALOG_VERSION],
      ["公共规则", `金额单位 ${model.config.commonRules.amountUnit}；标准服务时长 ${model.config.commonRules.standardServiceHoursPerDay} 小时/日；数据截止日每月 ${model.config.commonRules.dataCutoffDay} 日${model.config.commonRules.missingValuePolicy === "manual_with_reason" ? `；受控补录责任人 ${model.config.commonRules.manualDataOwner}` : ""}`],
      ["逻辑数据包", model.config.template.sourceRequirementIds.join("、")],
    ], [2200, 7760]));
    blocks.push(heading("附录B 指标定义与计算公式"));
    blocks.push(reportTable(["维度", "指标", "计算公式", "数据来源"], metricDefinitions.slice(0, 18).map((item) => [item.dimension, item.metric, item.formula, item.source]), [1300, 1900, 4000, 2760]));
    blocks.push(heading("附录C 医院关注指标口径快照"));
    blocks.push(reportTable(
      ["原表", "指标", "计算公式 / 分母", "状态", "口径控制"],
      hospitalMetricCatalog.map((metric) => [
        metric.sourceItem,
        `${metric.name}\n${metric.code}`,
        `${metric.formula}\n分母：${metric.denominator}`,
        metric.readiness === "ready" ? "首批核心" : metric.readiness === "configure" ? "配置后启用" : "暂缓展示",
        metric.validation,
      ]),
      [700, 1800, 3100, 1200, 3160],
    ));
    blocks.push(heading("附录D 报告字段覆盖情况"));
    blocks.push(reportTable(["数据域", "字段数", "已覆盖", "来源", "待补充"], reportFieldDomains.map((item) => [item.domain, item.fields, item.covered, item.source, item.additions]), [1500, 900, 900, 2300, 4360]));
    blocks.push(heading("附录E 采集、设备绑定与对账规则快照"));
    blocks.push(reportTable(
      ["设备品类", "状态 / 生效日", "来源文件", "设备身份绑定", "质量与对账阈值", "使用率分母"],
      model.analysisProfiles.map((profile) => [
        profile.category,
        `${profile.status} / ${profile.effectiveDate}`,
        profile.sourceSystems.join("、"),
        profile.deviceIdentityBinding,
        `完整率≥${profile.completenessThreshold}%；绑定率≥${profile.bindingRateThreshold}%；对账差异≤${profile.reconciliationTolerance}%`,
        profile.utilizationDenominator,
      ]),
      [1200, 1250, 1900, 1900, 1900, 1610],
    ));
  }

  const doc = new Document({
    creator: PRODUCT_FULL_NAME,
    title: `${model.hospital.shortName}-${model.config.title}-${model.config.period}`,
    description: `按医院、期间、模板版本和设备范围生成的${model.config.template.categoryLabel}报告`,
    styles: {
      default: { document: { run: { font: DOC_FONT, size: 21, color: TEXT }, paragraph: { spacing: { after: 120, line: 320 } } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: DOC_FONT, size: 30, bold: true, color: NAVY }, paragraph: { spacing: { before: 300, after: 100 }, keepNext: true, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: DOC_FONT, size: 26, bold: true, color: NAVY }, paragraph: { spacing: { before: 180, after: 90 }, keepNext: true, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: DOC_FONT, size: 24, bold: true, color: NAVY }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true, outlineLevel: 2 } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: PAGE_WIDTH, height: 15840 }, margin: { top: 1250, right: 1138, bottom: 1250, left: 1138, header: 600, footer: 600 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`${PRODUCT_FULL_NAME} · ${editionLabel} · `, { size: 18, color: issued ? "168560" : "C2413B" }), new TextRun({ children: [PageNumber.CURRENT], font: DOC_FONT, size: 18, color: MUTED })] })] }) },
      children: blocks,
    }],
  });
  const blob = await Packer.toBlob(doc);
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  const fileName = `${model.hospital.shortName}-${model.config.period}-医疗设备效益分析报告-${editionLabel}.docx`;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  return { fileName, sha256, blob };
}
