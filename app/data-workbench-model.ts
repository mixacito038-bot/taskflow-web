export type DataWorkbenchSectionId =
  | "overview"
  | "sources"
  | "imports"
  | "batches"
  | "mapping"
  | "cleaning"
  | "quality"
  | "reconciliation"
  | "publishing"
  | "lineage";

export type DataWorkbenchSection = {
  id: DataWorkbenchSectionId;
  label: string;
  description: string;
};

export const DATA_WORKBENCH_ENTRY_CLICKS = 3;

export const DATA_WORKBENCH_SECTIONS: readonly DataWorkbenchSection[] = [
  { id: "overview", label: "工作台", description: "数据准备进度与今日待办" },
  {
    id: "sources",
    label: "文件与模板",
    description: "文件源、业务模板和数据集",
  },
  {
    id: "imports",
    label: "文件导入",
    description: "Excel / CSV / JSON 受控导入",
  },
  { id: "batches", label: "原始批次", description: "原始事实只追加不覆盖" },
  {
    id: "mapping",
    label: "字段/主数据映射",
    description: "标准字段、设备和科室映射",
  },
  { id: "cleaning", label: "清洗规则", description: "校验、标准化和隔离规则" },
  {
    id: "quality",
    label: "数据质量与隔离",
    description: "质量门禁、行级隔离与修复",
  },
  {
    id: "reconciliation",
    label: "文件对账",
    description: "两个文件版本之间逐键核对",
  },
  {
    id: "publishing",
    label: "审核与发布",
    description: "双角色审核后发布数据版本",
  },
  {
    id: "lineage",
    label: "血缘与回滚",
    description: "文件、快照、版本、更正和回滚",
  },
] as const;

export type FileBusinessTemplate = {
  code: string;
  dataDomain: string;
  name: string;
  domain: string;
  description: string;
  requiredFields: string[];
};

export const FILE_BUSINESS_TEMPLATES: readonly FileBusinessTemplate[] = [
  {
    code: "device_master",
    dataDomain: "device",
    name: "设备台账",
    domain: "设备主数据",
    description: "资产编号、设备名称、规格型号和归属科室",
    requiredFields: ["资产编号", "设备名称"],
  },
  {
    code: "exam_activity",
    dataDomain: "exam",
    name: "检查工作量",
    domain: "服务与效率",
    description: "检查号、设备、完成时间、主部位和多部位",
    requiredFields: ["检查号", "设备编号", "完成时间"],
  },
  {
    code: "billing_revenue",
    dataDomain: "revenue",
    name: "收费与收入",
    domain: "收入与收费",
    description: "收费项目、金额、退费与冲销事实",
    requiredFields: ["来源记录号", "金额"],
  },
  {
    code: "cost_detail",
    dataDomain: "cost",
    name: "成本明细",
    domain: "全成本",
    description: "折旧、人工、耗材、维修与能耗",
    requiredFields: ["设备编号", "成本类型", "金额"],
  },
  {
    code: "maintenance",
    dataDomain: "maintenance",
    name: "维修保养",
    domain: "设备保障",
    description: "故障、停机、维修、保养与费用",
    requiredFields: ["设备编号", "事件时间"],
  },
  {
    code: "utilization",
    dataDomain: "utilization",
    name: "开机与利用率",
    domain: "服务与效率",
    description: "计划时间、开机时间、作业时间和停机",
    requiredFields: ["设备编号", "统计日期"],
  },
  {
    code: "quality_safety",
    dataDomain: "quality",
    name: "质量与安全",
    domain: "质量安全",
    description: "不良事件、质控结果和整改闭环",
    requiredFields: ["事件编号", "事件日期"],
  },
  {
    code: "target_budget",
    dataDomain: "target",
    name: "目标与预算",
    domain: "目标预算",
    description: "指标目标、预算期间和责任部门",
    requiredFields: ["指标编码", "期间", "目标值"],
  },
] as const;

export type FileTemplateField = {
  code: string;
  name: string;
  type:
    "string" | "integer" | "decimal" | "date" | "datetime" | "boolean" | "json";
  required: boolean;
  aliases: string[];
};

const commonDevice = (required = true): FileTemplateField => ({
  code: "deviceId",
  name: "设备编号",
  type: "string",
  required,
  aliases: ["资产编号", "设备编码", "仪器编号"],
});
const recordType = (value: string): FileTemplateField => ({
  code: "recordType",
  name: "记录类型",
  type: "string",
  required: false,
  aliases: ["数据类型", value],
});
export const FILE_TEMPLATE_FIELDS: Readonly<
  Record<string, readonly FileTemplateField[]>
> = {
  device_master: [
    {
      code: "recordType",
      name: "记录类型",
      type: "string",
      required: true,
      aliases: ["数据类型"],
    },
    commonDevice(),
    {
      code: "assetCode",
      name: "资产编码",
      type: "string",
      required: true,
      aliases: ["资产号"],
    },
    {
      code: "deviceName",
      name: "设备名称",
      type: "string",
      required: true,
      aliases: ["仪器名称"],
    },
    {
      code: "category",
      name: "设备类别",
      type: "string",
      required: false,
      aliases: ["分类"],
    },
    {
      code: "model",
      name: "规格型号",
      type: "string",
      required: false,
      aliases: ["型号"],
    },
    {
      code: "manufacturer",
      name: "生产厂家",
      type: "string",
      required: false,
      aliases: ["制造商"],
    },
    {
      code: "department",
      name: "归属科室",
      type: "string",
      required: true,
      aliases: ["科室", "使用科室"],
    },
    {
      code: "shortName",
      name: "设备简称",
      type: "string",
      required: false,
      aliases: ["简称"],
    },
    {
      code: "location",
      name: "安装位置",
      type: "string",
      required: false,
      aliases: ["位置"],
    },
    {
      code: "investment",
      name: "资产原值",
      type: "decimal",
      required: true,
      aliases: ["购置金额", "原值", "originalValue"],
    },
    {
      code: "purchaseDate",
      name: "购置日期",
      type: "date",
      required: false,
      aliases: ["采购日期"],
    },
    {
      code: "enabledDate",
      name: "启用日期",
      type: "date",
      required: true,
      aliases: ["投入使用日期", "inServiceDate"],
    },
    {
      code: "quantity",
      name: "设备数量",
      type: "integer",
      required: false,
      aliases: ["数量"],
    },
    {
      code: "serviceUnit",
      name: "服务量单位",
      type: "string",
      required: false,
      aliases: ["工作量单位"],
    },
    {
      code: "status",
      name: "设备状态",
      type: "string",
      required: true,
      aliases: ["使用状态"],
    },
    {
      code: "planPayback",
      name: "计划回收期",
      type: "decimal",
      required: false,
      aliases: ["计划回本年限"],
    },
    {
      code: "forecastPayback",
      name: "预计回收期",
      type: "decimal",
      required: false,
      aliases: ["预计回本年限"],
    },
    {
      code: "licenseNumber",
      name: "许可证号",
      type: "string",
      required: false,
      aliases: ["许可编号"],
    },
    {
      code: "maintenanceStatus",
      name: "维保状态",
      type: "string",
      required: false,
      aliases: ["保修状态"],
    },
  ],
  exam_activity: [
    {
      code: "recordType",
      name: "记录类型",
      type: "string",
      required: true,
      aliases: ["数据类型"],
    },
    {
      code: "examId",
      name: "检查号",
      type: "string",
      required: true,
      aliases: ["检查流水号"],
    },
    commonDevice(),
    {
      code: "occurredAt",
      name: "完成时间",
      type: "datetime",
      required: true,
      aliases: ["检查时间", "执行时间"],
    },
    {
      code: "bodyPart",
      name: "主检查部位",
      type: "string",
      required: false,
      aliases: ["主部位", "检查部位"],
    },
    {
      code: "bodyParts",
      name: "检查部位集合",
      type: "json",
      required: false,
      aliases: ["多部位", "部位列表"],
    },
    {
      code: "isPrimary",
      name: "是否主部位",
      type: "boolean",
      required: false,
      aliases: ["主部位标记"],
    },
    {
      code: "allocationWeight",
      name: "部位分摊权重",
      type: "decimal",
      required: false,
      aliases: ["分摊比例"],
    },
    {
      code: "examRevenue",
      name: "收入",
      type: "decimal",
      required: false,
      aliases: ["收费金额"],
    },
    {
      code: "examCost",
      name: "成本",
      type: "decimal",
      required: false,
      aliases: ["检查成本"],
    },
    {
      code: "department",
      name: "执行科室",
      type: "string",
      required: false,
      aliases: ["科室"],
    },
  ],
  billing_revenue: [
    recordType("revenue"),
    {
      code: "sourceRecordId",
      name: "来源记录号",
      type: "string",
      required: true,
      aliases: ["收费流水号"],
    },
    commonDevice(false),
    {
      code: "examId",
      name: "检查号",
      type: "string",
      required: false,
      aliases: ["检查流水号"],
    },
    {
      code: "occurredAt",
      name: "收费时间",
      type: "datetime",
      required: true,
      aliases: ["记账时间"],
    },
    {
      code: "itemCode",
      name: "收费项目编码",
      type: "string",
      required: true,
      aliases: ["项目编码"],
    },
    {
      code: "amount",
      name: "金额",
      type: "decimal",
      required: true,
      aliases: ["收费金额", "收入"],
    },
    {
      code: "refundAmount",
      name: "退费金额",
      type: "decimal",
      required: false,
      aliases: ["冲销金额"],
    },
    {
      code: "department",
      name: "责任科室",
      type: "string",
      required: false,
      aliases: ["科室"],
    },
  ],
  cost_detail: [
    recordType("cost"),
    commonDevice(),
    {
      code: "period",
      name: "期间",
      type: "string",
      required: true,
      aliases: ["月份", "会计期间"],
    },
    {
      code: "costType",
      name: "成本类型",
      type: "string",
      required: true,
      aliases: ["费用类型"],
    },
    {
      code: "amount",
      name: "金额",
      type: "decimal",
      required: true,
      aliases: ["成本", "费用金额"],
    },
    {
      code: "sourceRecordId",
      name: "来源记录号",
      type: "string",
      required: false,
      aliases: ["凭证号"],
    },
    {
      code: "department",
      name: "责任科室",
      type: "string",
      required: false,
      aliases: ["科室"],
    },
  ],
  maintenance: [
    recordType("maintenance"),
    {
      code: "eventId",
      name: "事件编号",
      type: "string",
      required: true,
      aliases: ["工单号"],
    },
    commonDevice(),
    {
      code: "occurredAt",
      name: "事件时间",
      type: "datetime",
      required: true,
      aliases: ["报修时间"],
    },
    {
      code: "eventType",
      name: "事件类型",
      type: "string",
      required: true,
      aliases: ["维修类型"],
    },
    {
      code: "downtimeMinutes",
      name: "停机分钟",
      type: "decimal",
      required: false,
      aliases: ["停机时长"],
    },
    {
      code: "maintenanceCost",
      name: "维修费用",
      type: "decimal",
      required: false,
      aliases: ["维保成本"],
    },
    {
      code: "status",
      name: "工单状态",
      type: "string",
      required: false,
      aliases: ["状态"],
    },
  ],
  utilization: [
    recordType("utilization"),
    commonDevice(),
    {
      code: "period",
      name: "统计日期",
      type: "date",
      required: true,
      aliases: ["日期", "期间", "statDate"],
    },
    {
      code: "scheduledMinutes",
      name: "计划服务分钟",
      type: "decimal",
      required: true,
      aliases: ["计划时间", "plannedMinutes"],
    },
    {
      code: "poweredMinutes",
      name: "开机分钟",
      type: "decimal",
      required: false,
      aliases: ["开机时间"],
    },
    {
      code: "activeMinutes",
      name: "有效作业分钟",
      type: "decimal",
      required: true,
      aliases: ["作业时间"],
    },
    {
      code: "downtimeMinutes",
      name: "停机分钟",
      type: "decimal",
      required: false,
      aliases: ["停机时长"],
    },
    {
      code: "examCount",
      name: "检查人次",
      type: "integer",
      required: false,
      aliases: ["工作量"],
    },
  ],
  quality_safety: [
    recordType("quality"),
    {
      code: "eventId",
      name: "事件编号",
      type: "string",
      required: true,
      aliases: ["质控编号"],
    },
    commonDevice(false),
    {
      code: "eventDate",
      name: "事件日期",
      type: "date",
      required: true,
      aliases: ["质控日期"],
    },
    {
      code: "eventType",
      name: "质量类型",
      type: "string",
      required: true,
      aliases: ["质控项目"],
    },
    {
      code: "severity",
      name: "风险等级",
      type: "string",
      required: false,
      aliases: ["严重度"],
    },
    {
      code: "correctiveAction",
      name: "整改措施",
      type: "string",
      required: false,
      aliases: ["整改内容"],
    },
  ],
  target_budget: [
    recordType("target"),
    {
      code: "metricCode",
      name: "指标编码",
      type: "string",
      required: true,
      aliases: ["指标"],
    },
    {
      code: "period",
      name: "期间",
      type: "string",
      required: true,
      aliases: ["预算期间"],
    },
    {
      code: "targetValue",
      name: "目标值",
      type: "decimal",
      required: true,
      aliases: ["指标目标"],
    },
    {
      code: "budgetAmount",
      name: "预算值",
      type: "decimal",
      required: false,
      aliases: ["预算金额"],
    },
    {
      code: "department",
      name: "责任部门",
      type: "string",
      required: false,
      aliases: ["科室"],
    },
    commonDevice(false),
    {
      code: "owner",
      name: "责任人",
      type: "string",
      required: false,
      aliases: ["负责人"],
    },
  ],
};

export function templateFields(templateCode: string) {
  return FILE_TEMPLATE_FIELDS[templateCode] ?? [];
}

function normalizedHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-/（）()]/g, "");
}

export function suggestTemplateField(
  templateCode: string,
  sourceHeader: string,
) {
  const target = normalizedHeader(sourceHeader);
  return (
    templateFields(templateCode).find((field) =>
      [field.code, field.name, ...field.aliases].some(
        (alias) => normalizedHeader(alias) === target,
      ),
    )?.code ?? ""
  );
}

function csvEscape(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildBusinessTemplateCsv(templateCode: string) {
  const fields = templateFields(templateCode);
  const headers = fields.map((field) => csvEscape(field.name)).join(",");
  return `\ufeff${headers}\r\n`;
}

export type CsvParseResult = {
  headers: string[];
  rows: Array<Record<string, string>>;
  warnings: string[];
};

export type DatasetColumnSchema = {
  name: string;
  inferredType:
    "integer" | "decimal" | "boolean" | "date" | "datetime" | "string";
  nullable: boolean;
};

export type DatasetProfile = {
  schema: { columns: DatasetColumnSchema[] };
  profile: {
    rowCount: number;
    columns: Record<
      string,
      { nonEmpty: number; empty: number; distinct: number }
    >;
    sampleRowCount?: number;
    scope?: "full_csv" | "server_preview";
  };
};

function inferValueType(values: string[]): DatasetColumnSchema["inferredType"] {
  const populated = values.map((value) => value.trim()).filter(Boolean);
  if (!populated.length) return "string";
  if (populated.every((value) => /^-?\d+$/.test(value))) return "integer";
  if (populated.every((value) => /^-?(?:\d+\.?\d*|\.\d+)$/.test(value)))
    return "decimal";
  if (populated.every((value) => /^(?:true|false|是|否|0|1)$/i.test(value)))
    return "boolean";
  if (populated.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))
    return "date";
  if (
    populated.every((value) => /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(value))
  )
    return "datetime";
  return "string";
}

export function buildCsvDatasetProfile(parsed: CsvParseResult): DatasetProfile {
  const columns = Object.fromEntries(
    parsed.headers.map((header) => {
      const values = parsed.rows.map((row) => row[header] ?? "");
      const nonEmptyValues = values
        .map((value) => value.trim())
        .filter(Boolean);
      return [
        header,
        {
          nonEmpty: nonEmptyValues.length,
          empty: values.length - nonEmptyValues.length,
          distinct: new Set(nonEmptyValues).size,
        },
      ];
    }),
  );
  return {
    schema: {
      columns: parsed.headers.map((header) => {
        const values = parsed.rows.map((row) => row[header] ?? "");
        return {
          name: header,
          inferredType: inferValueType(values),
          nullable: values.some((value) => !value.trim()),
        };
      }),
    },
    profile: { rowCount: parsed.rows.length, columns },
  };
}

function parseCsvCells(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, unterminatedQuote: quoted };
}

export function parseCsv(value: string, delimiter = ","): CsvParseResult {
  if (
    delimiter.length !== 1 ||
    delimiter === "\n" ||
    delimiter === "\r" ||
    delimiter === '"'
  )
    throw new Error("INVALID_CSV_DELIMITER");
  const input = value.replace(/^\ufeff/, "");
  const parsed = parseCsvCells(input, delimiter);
  const nonEmptyRows = parsed.rows.filter((row) =>
    row.some((cell) => cell.trim()),
  );
  const rawHeaders = nonEmptyRows.shift() ?? [];
  const headers = rawHeaders.map(
    (header, index) => header.trim() || `未命名列${index + 1}`,
  );
  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  const warnings: string[] = [];
  if (parsed.unterminatedQuote)
    warnings.push("文件存在未闭合的引号，最后一行可能不完整");
  if (duplicateHeaders.length)
    warnings.push(`发现重复列名：${[...new Set(duplicateHeaders)].join("、")}`);

  const rows = nonEmptyRows.map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""]),
    ),
  );
  if (nonEmptyRows.some((cells) => cells.length !== headers.length))
    warnings.push("部分记录的列数与表头不一致，已保留空值等待清洗");
  return { headers, rows, warnings };
}

function jsonCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function parseJsonRecords(value: string): CsvParseResult {
  const decoded = JSON.parse(value) as unknown;
  const candidate = Array.isArray(decoded)
    ? decoded
    : decoded &&
        typeof decoded === "object" &&
        Array.isArray((decoded as { data?: unknown }).data)
      ? (decoded as { data: unknown[] }).data
      : null;
  if (!candidate) throw new Error("JSON_ARRAY_REQUIRED");
  if (
    candidate.some(
      (row) => !row || typeof row !== "object" || Array.isArray(row),
    )
  )
    throw new Error("JSON_OBJECT_ROWS_REQUIRED");
  const records = candidate as Array<Record<string, unknown>>;
  const headers = [...new Set(records.flatMap((row) => Object.keys(row)))];
  const rows = records.map((row) =>
    Object.fromEntries(
      headers.map((header) => [header, jsonCell(row[header])]),
    ),
  );
  return {
    headers,
    rows,
    warnings: headers.length ? [] : ["JSON 数组中没有可识别字段"],
  };
}

export type ImportParseMode =
  "client_csv" | "client_json" | "server_excel" | "unsupported";

export type ImportFileClassification = {
  extension: string;
  parseMode: ImportParseMode;
  label: string;
};

export function classifyImportFile(
  file: Pick<File, "name" | "size">,
): ImportFileClassification {
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  if (extension === "csv")
    return { extension, parseMode: "client_csv", label: "浏览器内解析 CSV" };
  if (extension === "json")
    return { extension, parseMode: "client_json", label: "浏览器内解析 JSON" };
  if (extension === "xlsx")
    return {
      extension,
      parseMode: "server_excel",
      label: "等待服务端解析 Excel",
    };
  if (extension === "xls")
    return {
      extension,
      parseMode: "unsupported",
      label: "旧版 XLS 需先另存为 XLSX",
    };
  return { extension, parseMode: "unsupported", label: "不支持的文件类型" };
}

export type QualityInput = {
  total: number;
  valid: number;
  warning: number;
  rejected: number;
};

export type QualitySummary = QualityInput & {
  unclassified: number;
  passRate: number;
};

export function calculateQualitySummary(input: QualityInput): QualitySummary {
  const total = Math.max(0, Math.round(input.total));
  const valid = Math.max(0, Math.min(total, Math.round(input.valid)));
  const warning = Math.max(
    0,
    Math.min(total - valid, Math.round(input.warning)),
  );
  const rejected = Math.max(
    0,
    Math.min(total - valid - warning, Math.round(input.rejected)),
  );
  const unclassified = Math.max(0, total - valid - warning - rejected);
  return {
    total,
    valid,
    warning,
    rejected,
    unclassified,
    passRate: total ? Number(((valid / total) * 100).toFixed(1)) : 0,
  };
}

export type CleaningPreviewRule = {
  id: string;
  type: "trim" | "required" | "number" | "deduplicate";
  field: string;
  label: string;
};

export type QuarantinedPreviewRow = {
  rowId: string;
  row: Record<string, string>;
  errors: Array<{ ruleId: string; field: string; message: string }>;
};

export type CleaningPreviewResult = {
  rows: Array<Record<string, string>>;
  quarantine: QuarantinedPreviewRow[];
  steps: Array<{
    ruleId: string;
    label: string;
    before: number;
    after: number;
    affected: number;
  }>;
};

export type ServerCleaningImpact = {
  importId: string;
  inputRows: number;
  validRows: number;
  quarantinedRows: number;
  issueCount: number;
  steps: Array<{
    ruleId: string;
    ruleType: string;
    fieldName: string;
    changedRows: number;
    issueRows: number;
    samples: Array<{ row: number; before: unknown; after: unknown }>;
  }>;
};

export function normalizeServerCleaningImpact(
  importId: string,
  value: unknown,
): ServerCleaningImpact | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const impact = value as Record<string, unknown>;
  const numberValue = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) && input >= 0
      ? input
      : 0;
  const steps = Array.isArray(impact.steps)
    ? impact.steps.flatMap((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
        const step = entry as Record<string, unknown>;
        const samples = Array.isArray(step.samples)
          ? step.samples.flatMap((sample) => {
              if (!sample || typeof sample !== "object" || Array.isArray(sample))
                return [];
              const item = sample as Record<string, unknown>;
              return [
                {
                  row: numberValue(item.row),
                  before: item.before,
                  after: item.after,
                },
              ];
            })
          : [];
        return [
          {
            ruleId: String(step.ruleId ?? ""),
            ruleType: String(step.ruleType ?? ""),
            fieldName: String(step.fieldName ?? ""),
            changedRows: numberValue(step.changedRows),
            issueRows: numberValue(step.issueRows),
            samples,
          },
        ];
      })
    : [];
  return {
    importId,
    inputRows: numberValue(impact.inputRows),
    validRows: numberValue(impact.validRows),
    quarantinedRows: numberValue(impact.quarantinedRows),
    issueCount: numberValue(impact.issueCount),
    steps,
  };
}

export function runCleaningPreview(
  inputRows: Array<Record<string, string>>,
  rules: readonly CleaningPreviewRule[],
): CleaningPreviewResult {
  let active = inputRows.map((row) => ({ ...row }));
  const quarantine: QuarantinedPreviewRow[] = [];
  const steps: CleaningPreviewResult["steps"] = [];
  for (const rule of rules) {
    const before = active.length;
    let affected = 0;
    if (rule.type === "trim") {
      active = active.map((row) => {
        const current = row[rule.field] ?? "";
        const next = current.trim();
        if (next !== current) affected += 1;
        return { ...row, [rule.field]: next };
      });
    } else {
      const seen = new Set<string>();
      const passing: typeof active = [];
      active.forEach((row, index) => {
        const value = row[rule.field] ?? "";
        const invalid =
          rule.type === "required"
            ? !value.trim()
            : rule.type === "number"
              ? value.trim() !== "" && !Number.isFinite(Number(value))
              : seen.has(value);
        if (rule.type === "deduplicate") seen.add(value);
        if (invalid) {
          affected += 1;
          quarantine.push({
            rowId: row.id || `row-${index + 1}`,
            row,
            errors: [
              {
                ruleId: rule.id,
                field: rule.field,
                message: `${rule.label}未通过`,
              },
            ],
          });
        } else passing.push(row);
      });
      active = passing;
    }
    steps.push({
      ruleId: rule.id,
      label: rule.label,
      before,
      after: active.length,
      affected,
    });
  }
  return { rows: active, quarantine, steps };
}

export type FileReconciliationResult = {
  matched: number;
  changed: number;
  leftOnly: number;
  rightOnly: number;
  rows: Array<{
    key: string;
    status: "matched" | "changed" | "left_only" | "right_only";
    differences: string[];
  }>;
};

export function reconcileFileRows(
  leftRows: Array<Record<string, string>>,
  rightRows: Array<Record<string, string>>,
  config: { keyFields: string[]; compareFields: string[] },
): FileReconciliationResult {
  const keyOf = (row: Record<string, string>) =>
    config.keyFields.map((field) => row[field] ?? "").join("\u001f");
  const left = new Map(leftRows.map((row) => [keyOf(row), row]));
  const right = new Map(rightRows.map((row) => [keyOf(row), row]));
  const keys = new Set([...left.keys(), ...right.keys()]);
  const rows: FileReconciliationResult["rows"] = [];
  keys.forEach((key) => {
    const leftRow = left.get(key);
    const rightRow = right.get(key);
    if (!leftRow) rows.push({ key, status: "right_only", differences: [] });
    else if (!rightRow)
      rows.push({ key, status: "left_only", differences: [] });
    else {
      const differences = config.compareFields.filter(
        (field) => (leftRow[field] ?? "") !== (rightRow[field] ?? ""),
      );
      rows.push({
        key,
        status: differences.length ? "changed" : "matched",
        differences,
      });
    }
  });
  return {
    matched: rows.filter((row) => row.status === "matched").length,
    changed: rows.filter((row) => row.status === "changed").length,
    leftOnly: rows.filter((row) => row.status === "left_only").length,
    rightOnly: rows.filter((row) => row.status === "right_only").length,
    rows,
  };
}

export function quarantineRowsToCsv(rows: readonly QuarantinedPreviewRow[]) {
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [
    "row_id,field,error,row_json",
    ...rows.flatMap((item) =>
      item.errors.map((error) =>
        [item.rowId, error.field, error.message, JSON.stringify(item.row)]
          .map(escape)
          .join(","),
      ),
    ),
  ].join("\n");
}

export type WorkbenchBatchStatus =
  | "待解析"
  | "待映射"
  | "校验中"
  | "待复核"
  | "可发布"
  | "已发布"
  | "已隔离"
  | "uploading"
  | "pending_mapping"
  | "validating"
  | "pending_review"
  | "ready"
  | "published"
  | "failed"
  | "withdrawn"
  | "superseded";

export type WorkbenchBatch = {
  id: string;
  name: string;
  domain: string;
  period: string;
  source: string;
  records: number;
  valid: number;
  warning: number;
  rejected: number;
  status: WorkbenchBatchStatus;
  createdAt: string;
  owner: string;
  version?: string;
  revision?: number;
  businessTemplateCode?: string;
};

export const initialWorkbenchBatches: WorkbenchBatch[] = [
  {
    id: "B20260811-017",
    name: "7月收费明细.xlsx",
    domain: "收入与收费",
    period: "2026-07",
    source: "Excel 文件",
    records: 12846,
    valid: 12698,
    warning: 106,
    rejected: 42,
    status: "可发布",
    createdAt: "08-11 09:32",
    owner: "财务部",
    businessTemplateCode: "billing_revenue",
  },
  {
    id: "B20260811-016",
    name: "7月检查工作量.csv",
    domain: "服务与效率",
    period: "2026-07",
    source: "CSV 文件",
    records: 11428,
    valid: 11231,
    warning: 164,
    rejected: 33,
    status: "待复核",
    createdAt: "08-11 08:55",
    owner: "影像科",
    businessTemplateCode: "exam_activity",
  },
  {
    id: "B20260810-013",
    name: "设备台账.json",
    domain: "设备主数据",
    period: "2026-08",
    source: "JSON 文件",
    records: 642,
    valid: 629,
    warning: 8,
    rejected: 5,
    status: "已发布",
    createdAt: "08-10 17:20",
    owner: "设备科",
    version: "DATA-2026.08.10-03",
    businessTemplateCode: "device_master",
  },
  {
    id: "B20260810-011",
    name: "人工成本补录.xlsx",
    domain: "全成本",
    period: "2026-07",
    source: "Excel 文件",
    records: 188,
    valid: 0,
    warning: 0,
    rejected: 0,
    status: "待解析",
    createdAt: "08-10 16:08",
    owner: "人力资源部",
    businessTemplateCode: "cost_detail",
  },
];

export type WorkbenchSource = {
  id: string;
  name: string;
  kind: "文件";
  domain: string;
  owner: string;
  cadence: string;
  status:
    | "正常"
    | "待联调"
    | "人工导入"
    | "异常"
    | "draft"
    | "active"
    | "disabled"
    | "error";
  lastRun: string;
  freshness: string;
};

export type RemoteConnectorRow = {
  id: string;
  name?: string;
  code?: string;
  sourceType?: string;
  transportType?: string;
  status?: WorkbenchSource["status"];
  metadataJson?: string;
  updatedAt?: string;
};

export type RemoteImportRow = {
  id: string;
  dataDomain?: string;
  ingestionMode?: string;
  fileName?: string;
  status?: WorkbenchBatchStatus;
  rowCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
  revision?: number;
  createdAt?: string;
  createdByAccountId?: string;
  businessTemplateCode?: string;
};

export type RemotePublishStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "published"
  | "withdrawn"
  | "superseded";

export type RemotePublishRow = {
  id: string;
  seriesId: string;
  version: number;
  dataDomain: string;
  status: RemotePublishStatus;
  rowCount: number;
  mappingVersion?: string;
  ruleVersion?: string;
  reviewComment?: string;
  createdAt?: string;
  publishedAt?: string | null;
  curatedSnapshotId?: string;
  publishedSnapshotId?: string;
  snapshotHash?: string;
  correctionOf?: string | null;
  correctionOfId?: string | null;
  rollbackOf?: string | null;
  rollbackOfId?: string | null;
};

export const FILE_WORKBENCH_RESOURCES = [
  "templates",
  "imports",
  "datasets",
  "records",
  "mappings",
  "fieldDefinitions",
  "metrics",
  "visualizations",
  "recipes",
  "qualityIssues",
  "quarantine",
  "reconciliations",
  "publishes",
  "publishedRecords",
  "snapshots",
  "reviews",
  "lineage",
] as const;

export type FileWorkbenchResource = (typeof FILE_WORKBENCH_RESOURCES)[number];

export const FILE_WORKBENCH_RESOURCE_LABELS: Record<
  FileWorkbenchResource,
  string
> = {
  templates: "业务模板",
  imports: "导入批次",
  datasets: "原始数据集",
  records: "数据记录",
  mappings: "字段映射",
  fieldDefinitions: "字段定义",
  metrics: "指标定义",
  visualizations: "展示定义",
  recipes: "清洗配方",
  qualityIssues: "质量问题",
  quarantine: "隔离记录",
  reconciliations: "对账结果",
  publishes: "发布版本",
  publishedRecords: "已发布数据行",
  snapshots: "数据快照",
  reviews: "审核记录",
  lineage: "血缘审计",
};

export const FILE_WORKBENCH_STATE_LABELS = {
  loading: "加载中",
  ready: "已就绪",
  empty: "暂无数据",
  error: "加载失败",
} as const;

export type WorkbenchApiState<T> =
  | { status: "ready"; data: T }
  | { status: "empty"; data: T }
  | { status: "error"; error: string; unsupported: boolean };

export class WorkbenchApiError extends Error {
  code: string;
  status: number;
  unsupported: boolean;
  constructor(code: string, status: number, detail = "") {
    super(detail || code);
    this.code = code;
    this.status = status;
    this.unsupported =
      status === 404 ||
      code === "unsupported_action" ||
      code === "invalid_request";
  }
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class FileWorkbenchApiClient {
  private baseUrl: string;
  private hospitalId: string;
  private fetcher: FetchLike;

  constructor(baseUrl: string, hospitalId: string, fetcher: FetchLike = fetch) {
    this.baseUrl = baseUrl;
    this.hospitalId = hospitalId;
    this.fetcher = fetcher;
  }

  private async json<T>(response: Response): Promise<T> {
    const body = (await response.json().catch(() => ({}))) as T & {
      error?: string;
      detail?: string;
    };
    if (!response.ok)
      throw new WorkbenchApiError(
        body.error ?? `request_failed_${response.status}`,
        response.status,
        body.detail,
      );
    return body;
  }

  resourceUrl(
    resource: FileWorkbenchResource,
    extra: Record<string, string> = {},
  ) {
    const params = new URLSearchParams({
      hospitalId: this.hospitalId,
      resource,
      limit: "200",
      ...extra,
    });
    return `${this.baseUrl}?${params.toString()}`;
  }

  async list<T>(
    resource: FileWorkbenchResource,
    extra?: Record<string, string>,
  ) {
    return this.json<{ data: T[] }>(
      await this.fetcher(this.resourceUrl(resource, extra), {
        headers: { accept: "application/json" },
      }),
    );
  }

  async action<T>(action: string, payload: Record<string, unknown>) {
    return this.json<{ data: T }>(
      await this.fetcher(this.baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          hospitalId: this.hospitalId,
          action,
          ...payload,
        }),
      }),
    );
  }

  async uploadFile(
    file: File,
    options: {
      businessTemplateCode: string;
      sheetName?: string;
      headerRow: number;
      idempotencyKey: string;
      delimiter?: string;
      dateFormat?: string;
      numberFormat?: string;
      inspectOnly?: boolean;
    },
  ) {
    const form = new FormData();
    form.append("hospitalId", this.hospitalId);
    form.append("file", file);
    Object.entries(options).forEach(([key, value]) =>
      form.append(key, String(value)),
    );
    return this.json<{ data: FileImportEnvelope }>(
      await this.fetcher(`${this.baseUrl}/import-file`, {
        method: "POST",
        body: form,
      }),
    );
  }
}

export type FileImportEnvelope = {
  import?: RemoteImportRow;
  dataset?: {
    id: string;
    importJobId: string;
    rowCount: number;
    sha256: string;
    sizeBytes: number;
    createdAt?: string;
  };
  workbook: {
    sheets: Array<{ name: string; rowCount: number; columnCount: number }>;
    selectedSheet: string;
    headerRow: number;
    headers: string[];
    previewRows: Array<Record<string, unknown>>;
    rowCount: number;
    profile?: {
      missingRequiredFields?: string[];
      nullCounts?: Record<string, number>;
      inferredTypes?: Record<string, string>;
      schema?: {
        columns: Array<{
          name: string;
          inferredType: string;
          required?: boolean;
          nullable?: boolean;
        }>;
      };
      profile?: DatasetProfile["profile"];
      rowCount?: number;
      columns?: DatasetProfile["profile"]["columns"];
    };
    warnings?: string[];
  };
  snapshot?: { id: string; sha256?: string; rowCount?: number };
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  parseMode: string;
  inspectOnly?: boolean;
};

export function remoteConnectorToSource(
  row: RemoteConnectorRow,
): WorkbenchSource {
  return {
    id: row.id,
    name: row.name || row.code || row.id,
    kind: "文件",
    domain: row.sourceType || "文件数据集",
    owner: "文件责任台账",
    cadence: "按文件批次导入",
    status: row.status ?? "draft",
    lastRun: row.updatedAt || "尚未运行",
    freshness: "以服务端任务为准",
  };
}

export function remoteImportToBatch(row: RemoteImportRow): WorkbenchBatch {
  return {
    id: row.id,
    name: row.fileName || row.dataDomain || row.id,
    domain: row.dataDomain || "未配置数据域",
    period: "以原始批次元数据为准",
    source: row.ingestionMode || "file",
    records: row.rowCount ?? 0,
    valid: row.acceptedCount ?? 0,
    warning: 0,
    rejected: row.rejectedCount ?? 0,
    status: row.status ?? "uploading",
    createdAt: row.createdAt || "—",
    owner: row.createdByAccountId || "当前账号",
    revision: row.revision ?? 1,
    businessTemplateCode: row.businessTemplateCode,
  };
}

export const initialWorkbenchSources: WorkbenchSource[] = [
  {
    id: "src-xlsx",
    name: "Excel 文件批次",
    kind: "文件",
    domain: "设备、收入、成本",
    owner: "业务部门",
    cadence: "按需",
    status: "正常",
    lastRun: "今天 09:32",
    freshness: "已复核",
  },
  {
    id: "src-csv",
    name: "CSV 文件批次",
    kind: "文件",
    domain: "工作量与质量",
    owner: "业务部门",
    cadence: "按需",
    status: "正常",
    lastRun: "今天 08:55",
    freshness: "已复核",
  },
  {
    id: "src-json",
    name: "JSON 文件批次",
    kind: "文件",
    domain: "设备主数据",
    owner: "设备科",
    cadence: "按需",
    status: "人工导入",
    lastRun: "昨天 17:20",
    freshness: "已发布",
  },
];
