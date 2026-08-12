/**
 * 设备台账字段配置。
 *
 * 台账的列分两类：
 * 1) 内置列（下面 BUILTIN_LEDGER_COLUMNS）——资产编号、名称/型号、科室、房间号等，
 *    结构固定，代码里直接渲染；
 * 2) 自定义列——各院自己在"台账字段配置"里加，存在云端资源 ledgerFields 里，
 *    每条定义决定台账多显示一列、编辑弹窗多一个输入框。
 *
 * 自定义字段的值存在 Device.customFields 上（键为 LedgerFieldDefinition.key），
 * 一律按字符串保存：台账要能原样回显医院填的内容，数字/日期只在录入时校验格式，
 * 不做隐式转换，避免"输入 007 存成 7"这类静默改写。
 */

export type LedgerFieldType = "text" | "number" | "date" | "select";

export type LedgerFieldDefinition = {
  /** 稳定键，创建后不可改；Device.customFields 用它做下标。 */
  key: string;
  label: string;
  type: LedgerFieldType;
  required: boolean;
  /** type 为 select 时的候选项；其它类型忽略。 */
  options: string[];
  /** 录入提示，显示在输入框下方。 */
  hint: string;
  /** 是否在台账表格里显示为一列；关掉只在编辑弹窗里可填。 */
  visibleInTable: boolean;
  order: number;
};

export const LEDGER_FIELD_TYPE_LABELS: Record<LedgerFieldType, string> = {
  text: "文本",
  number: "数字",
  date: "日期",
  select: "单选",
};

/** 内置列：供"台账字段配置"页面展示"哪些是系统列、不可删"，也供列顺序说明使用。 */
export const BUILTIN_LEDGER_COLUMNS = [
  { key: "assetCode", label: "资产编号", note: "按医院简码自动生成，可手工覆盖" },
  { key: "name", label: "设备名称/型号", note: "名称在上、型号在下，同一列显示" },
  { key: "owningDepartment", label: "所属科室", note: "资产归属的科室，唯一" },
  { key: "usingDepartments", label: "使用科室", note: "可填多个，表格里折叠显示" },
  { key: "roomNumber", label: "房间号", note: "设备安放的房间" },
  { key: "enabledDate", label: "启用日期", note: "" },
  { key: "investment", label: "原值(万元)", note: "" },
  { key: "dataSource", label: "数据来源", note: "手动填写 / 文件导入 / 接口对接" },
  { key: "status", label: "状态", note: "由效益口径推算，不在台账手工维护" },
] as const;

/** 内置键不能被自定义字段占用，否则会和系统列串位。 */
const RESERVED_KEYS = new Set<string>([
  ...BUILTIN_LEDGER_COLUMNS.map((column) => column.key),
  "id", "shortName", "model", "department", "customFields", "cost", "revenue", "utilization",
]);

export const DEVICE_DATA_SOURCES = ["手动填写", "文件导入", "接口对接"] as const;
export type DeviceDataSource = (typeof DEVICE_DATA_SOURCES)[number];

export function normalizeFieldKey(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

/**
 * 由字段名推导标识。
 *
 * 医院基本都用中文命名字段（"设备来源""维保到期日"），中文过一遍 normalizeFieldKey
 * 会被清成空串——如果直接拿它当标识，用户就只能自己想一个英文名，
 * "留空自动生成"形同虚设。所以纯中文名回退到 field_1、field_2… 依次编号，
 * 并且避开已占用的标识和系统保留键。
 */
export function deriveFieldKey(label: string, existing: readonly LedgerFieldDefinition[]): string {
  const taken = new Set<string>([...existing.map((field) => field.key), ...RESERVED_KEYS]);
  const normalized = normalizeFieldKey(label);
  if (normalized && !taken.has(normalized)) return normalized;
  if (normalized) {
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${normalized}_${index}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `field_${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return "";
}

export type LedgerFieldError =
  | "label_required"
  | "key_required"
  | "key_reserved"
  | "key_duplicated"
  | "options_required";

export const LEDGER_FIELD_ERROR_MESSAGES: Record<LedgerFieldError, string> = {
  label_required: "请填写字段名称",
  key_required: "字段标识只能用字母、数字和下划线，请重新填写",
  key_reserved: "该标识与系统内置列冲突，请换一个",
  key_duplicated: "已存在同名标识的字段",
  options_required: "单选字段至少要有一个候选项",
};

export function validateFieldDefinition(
  draft: LedgerFieldDefinition,
  existing: readonly LedgerFieldDefinition[],
  editingKey?: string,
): LedgerFieldError | null {
  if (!draft.label.trim()) return "label_required";
  if (!draft.key) return "key_required";
  if (RESERVED_KEYS.has(draft.key)) return "key_reserved";
  if (existing.some((field) => field.key === draft.key && field.key !== editingKey)) return "key_duplicated";
  if (draft.type === "select" && draft.options.filter((option) => option.trim()).length === 0) return "options_required";
  return null;
}

/** 单个值的录入校验：必填为空、数字非数字、日期非日期、单选不在候选项内都要拦下。 */
export function validateFieldValue(field: LedgerFieldDefinition, rawValue: string): string {
  const value = (rawValue ?? "").trim();
  if (!value) return field.required ? `${field.label}为必填项` : "";
  if (field.type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) return `${field.label}只能填数字`;
  if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${field.label}请填写为 YYYY-MM-DD`;
  if (field.type === "select" && field.options.length && !field.options.includes(value)) return `${field.label}只能从候选项中选择`;
  return "";
}

/** 保存前整体校验，返回第一条错误；没有错误返回空字符串。 */
export function validateCustomFieldValues(
  fields: readonly LedgerFieldDefinition[],
  values: Record<string, string> | undefined,
): string {
  for (const field of [...fields].sort((left, right) => left.order - right.order)) {
    const message = validateFieldValue(field, values?.[field.key] ?? "");
    if (message) return message;
  }
  return "";
}

export function sortedLedgerFields(fields: readonly LedgerFieldDefinition[]): LedgerFieldDefinition[] {
  return [...fields].sort((left, right) => left.order - right.order || left.label.localeCompare(right.label, "zh-CN"));
}

export function tableLedgerFields(fields: readonly LedgerFieldDefinition[]): LedgerFieldDefinition[] {
  return sortedLedgerFields(fields).filter((field) => field.visibleInTable);
}

/**
 * 资产编号自动生成：医院简码 + 7 位顺序号，从 0000001 开始。
 * 顺序号按"现有台账里同简码的最大号 + 1"推算，不单独存计数器——
 * 计数器和实际数据容易漂移（导入、删除、跨设备同步都会打乱），
 * 从现状推算则任何时候都自洽。
 */
export const ASSET_CODE_SEQUENCE_WIDTH = 7;

export function nextAssetCode(prefix: string, existingCodes: readonly string[]): string {
  const cleanPrefix = (prefix ?? "").trim().toUpperCase();
  if (!cleanPrefix) return "";
  const pattern = new RegExp(`^${cleanPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d{${ASSET_CODE_SEQUENCE_WIDTH}})$`);
  let max = 0;
  for (const code of existingCodes) {
    const matched = pattern.exec((code ?? "").trim().toUpperCase());
    if (matched) max = Math.max(max, Number(matched[1]));
  }
  return `${cleanPrefix}${String(max + 1).padStart(ASSET_CODE_SEQUENCE_WIDTH, "0")}`;
}

export function normalizeAssetCodePrefix(input: string): string {
  return (input ?? "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);
}

/** 使用科室：允许多个，界面折叠显示第一个 + 展开其余。 */
export function usingDepartmentList(device: { usingDepartments?: string[]; department?: string }): string[] {
  const list = (device.usingDepartments ?? []).map((item) => item.trim()).filter(Boolean);
  if (list.length) return list;
  const fallback = (device.department ?? "").trim();
  return fallback ? [fallback] : [];
}
