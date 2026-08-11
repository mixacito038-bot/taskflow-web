import { parse as parseCsv } from "csv-parse/sync";
import {
  FORMULA_PLACEHOLDER,
  XlsxImportError,
  parseXlsxWorkbook,
} from "./data-workbench-xlsx";

export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 100_000;
export const MAX_IMPORT_COLUMNS = 256;
export const MAX_IMPORT_CELL_CHARACTERS = 32_000;

export type SupportedImportType = "xlsx" | "csv" | "json";

export type BusinessTemplateContract = {
  code: string;
  dataDomain: string;
  requiredFields: string[];
  aliases: Record<string, string>;
};

export type ParsedFileDataset = {
  fileType: SupportedImportType;
  sheets: Array<{ name: string; rowCount: number; columnCount: number }>;
  selectedSheet: string;
  headerRow: number;
  headers: string[];
  records: Array<Record<string, unknown>>;
  previewRows: Array<Record<string, unknown>>;
  warnings: string[];
  profile: {
    missingRequiredFields: string[];
    nullCounts: Record<string, number>;
    inferredTypes: Record<string, string[]>;
  };
  parseMode: "server_xlsx" | "server_csv" | "server_json";
};

export class FileDatasetParseError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 422) {
    super(code);
    this.name = "FileDatasetParseError";
    this.code = code;
    this.status = status;
  }
}

export function detectImportType(fileName: string): SupportedImportType | null {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".xlsx")) return "xlsx";
  if (normalized.endsWith(".csv")) return "csv";
  if (normalized.endsWith(".json")) return "json";
  return null;
}

function safeScalar(value: unknown, warnings: string[], cellRef: string): unknown {
  if (value === null || value === undefined) return null;
  if (["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "string" && value.length > MAX_IMPORT_CELL_CHARACTERS) throw new FileDatasetParseError("import_cell_too_long", 413);
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.formula === "string" || typeof record.sharedFormula === "string") {
      if (warnings.filter((warning) => warning.startsWith("公式单元格")).length < 10) warnings.push(`公式单元格 ${cellRef} 未执行、缓存值未采信。`);
      return FORMULA_PLACEHOLDER;
    }
    if (typeof record.hyperlink === "string") return typeof record.text === "string" ? record.text : "";
    if (Array.isArray(record.richText)) return record.richText.map((part) => typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "").join("");
    if (typeof record.error === "string") return record.error;
  }
  const serialized = JSON.stringify(value, (_key, child) => {
    if (typeof child === "bigint") return child.toString();
    return child;
  });
  if (serialized.length > MAX_IMPORT_CELL_CHARACTERS) throw new FileDatasetParseError("import_cell_too_long", 413);
  if (warnings.filter((warning) => warning.startsWith("嵌套值")).length < 10) warnings.push(`嵌套值 ${cellRef} 已确定性序列化为 JSON 文本。`);
  return serialized;
}

function normalizeHeaders(values: unknown[], aliases: Record<string, string>) {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const raw = value === null || value === undefined || value === "" || value === FORMULA_PLACEHOLDER ? `列${index + 1}` : String(value).trim();
    const aliased = aliases[raw] || raw;
    const base = aliased.slice(0, 160) || `列${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function rowsToRecords(rows: unknown[][], headerIndex: number, template: BusinessTemplateContract) {
  if (headerIndex < 0 || headerIndex >= rows.length) throw new FileDatasetParseError("invalid_header_row", 400);
  const headers = normalizeHeaders(rows[headerIndex], template.aliases);
  if (!headers.length || headers.length > MAX_IMPORT_COLUMNS) throw new FileDatasetParseError("import_column_limit_exceeded", 413);
  const records = rows.slice(headerIndex + 1)
    .filter((row) => row.some((value) => value !== null && value !== undefined && value !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
  if (records.length > MAX_IMPORT_ROWS) throw new FileDatasetParseError("import_row_limit_exceeded", 413);
  return { headers, records };
}

function profileDataset(headers: string[], records: Array<Record<string, unknown>>, template: BusinessTemplateContract) {
  const nullCounts: Record<string, number> = {};
  const inferredTypes: Record<string, string[]> = {};
  for (const header of headers) {
    nullCounts[header] = 0;
    const types = new Set<string>();
    for (const record of records) {
      const value = record[header];
      if (value === null || value === undefined || value === "") nullCounts[header] += 1;
      else types.add(value instanceof Date ? "datetime" : typeof value);
    }
    inferredTypes[header] = [...types].sort();
  }
  const missingRequiredFields = template.requiredFields.filter((field) => !headers.includes(field));
  return {
    missingRequiredFields,
    nullCounts,
    inferredTypes,
    schema: {
      columns: headers.map((name) => ({ name, inferredType: inferredTypes[name].join("|") || "empty", required: template.requiredFields.includes(name) })),
    },
    profile: {
      rowCount: records.length,
      columns: Object.fromEntries(headers.map((name) => [name, {
        empty: nullCounts[name],
        distinct: new Set(records.map((record) => JSON.stringify(record[name] ?? null))).size,
      }])),
    },
  };
}

async function parseXlsx(bytes: Uint8Array, options: ParseFileDatasetOptions, template: BusinessTemplateContract): Promise<ParsedFileDataset> {
  let workbook;
  try {
    workbook = await parseXlsxWorkbook(bytes, {
      maxFileBytes: MAX_IMPORT_FILE_BYTES,
      maxRowsPerSheet: MAX_IMPORT_ROWS + 1,
      maxColumnsPerSheet: MAX_IMPORT_COLUMNS,
      maxTotalCells: MAX_IMPORT_ROWS * 10,
      maxCellCharacters: MAX_IMPORT_CELL_CHARACTERS,
    });
  } catch (error) {
    if (error instanceof XlsxImportError) throw new FileDatasetParseError(error.code, error.status);
    throw error;
  }
  const sheets = workbook.sheets.map((sheet) => ({ name: sheet.name, rowCount: sheet.rowCount, columnCount: sheet.columnCount }));
  const sheet = options.sheetName ? workbook.sheets.find((item) => item.name === options.sheetName) : workbook.sheets.find((item) => item.rows.length > 0);
  if (!sheet) throw new FileDatasetParseError(options.sheetName ? "worksheet_not_found" : "xlsx_has_no_data");
  if (sheet.rowCount > MAX_IMPORT_ROWS + 1) throw new FileDatasetParseError("import_row_limit_exceeded", 413);
  if (sheet.columnCount > MAX_IMPORT_COLUMNS) throw new FileDatasetParseError("import_column_limit_exceeded", 413);
  const headerRow = options.headerRow ?? 1;
  const header = sheet.rows.find((row) => row.rowNumber === headerRow);
  if (!header) throw new FileDatasetParseError("invalid_header_row", 400);
  const rows = [
    Array.from({ length: sheet.columnCount }, (_, index) => header.values[index] ?? null),
    ...sheet.rows.filter((row) => row.rowNumber > headerRow).map((row) => row.values),
  ];
  const { headers, records } = rowsToRecords(rows, 0, template);
  const warnings = [...sheet.warnings];
  const profile = profileDataset(headers, records, template);
  if (profile.missingRequiredFields.length) warnings.push(`业务模板缺少必填字段：${profile.missingRequiredFields.join("、")}`);
  return { fileType: "xlsx", sheets, selectedSheet: sheet.name, headerRow, headers, records, previewRows: records.slice(0, 20), warnings, profile, parseMode: "server_xlsx" };
}

function parseCsvDataset(bytes: Uint8Array, options: ParseFileDatasetOptions, template: BusinessTemplateContract): ParsedFileDataset {
  let rows: unknown[][];
  const delimiter = options.delimiter ?? ",";
  if (delimiter.length !== 1 || /["\r\n]/.test(delimiter)) throw new FileDatasetParseError("invalid_csv_delimiter", 400);
  try {
    rows = parseCsv(Buffer.from(bytes), { delimiter, bom: true, skip_empty_lines: true, relax_column_count: false, max_record_size: MAX_IMPORT_CELL_CHARACTERS * MAX_IMPORT_COLUMNS }) as unknown[][];
  } catch {
    throw new FileDatasetParseError("invalid_csv");
  }
  if (rows.length > MAX_IMPORT_ROWS + 1) throw new FileDatasetParseError("import_row_limit_exceeded", 413);
  const headerRow = options.headerRow ?? 1;
  const { headers, records } = rowsToRecords(rows, headerRow - 1, template);
  const profile = profileDataset(headers, records, template);
  const warnings = profile.missingRequiredFields.length ? [`业务模板缺少必填字段：${profile.missingRequiredFields.join("、")}`] : [];
  if (options.dateFormat || options.numberFormat) warnings.push("日期/数字格式仅作为导入元数据保存，本次解析未按展示格式转换原始值。");
  return { fileType: "csv", sheets: [{ name: "CSV", rowCount: records.length, columnCount: headers.length }], selectedSheet: "CSV", headerRow, headers, records, previewRows: records.slice(0, 20), warnings, profile, parseMode: "server_csv" };
}

function parseJsonDataset(bytes: Uint8Array, template: BusinessTemplateContract): ParsedFileDataset {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new FileDatasetParseError("invalid_json_dataset");
  }
  const envelope = value && typeof value === "object" ? value as { rows?: unknown; data?: unknown } : null;
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(envelope?.rows) ? envelope.rows
      : Array.isArray(envelope?.data) ? envelope.data : null;
  if (!rows || rows.length > MAX_IMPORT_ROWS || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new FileDatasetParseError("json_rows_array_required");
  const sourceRecords = rows as Array<Record<string, unknown>>;
  const rawHeaders = [...new Set(sourceRecords.flatMap((row) => Object.keys(row)))];
  if (rawHeaders.length > MAX_IMPORT_COLUMNS) throw new FileDatasetParseError("import_column_limit_exceeded", 413);
  const headers = normalizeHeaders(rawHeaders, template.aliases);
  const warnings: string[] = [];
  const records = sourceRecords.map((row) => Object.fromEntries(rawHeaders.map((header, index) => [headers[index], safeScalar(row[header], warnings, `JSON:${header}`)])));
  const profile = profileDataset(headers, records, template);
  if (profile.missingRequiredFields.length) warnings.push(`业务模板缺少必填字段：${profile.missingRequiredFields.join("、")}`);
  return { fileType: "json", sheets: [{ name: "JSON", rowCount: records.length, columnCount: headers.length }], selectedSheet: "JSON", headerRow: 0, headers, records, previewRows: records.slice(0, 20), warnings, profile, parseMode: "server_json" };
}

export type ParseFileDatasetOptions = { fileName: string; sheetName?: string; headerRow?: number; delimiter?: string; dateFormat?: string; numberFormat?: string };

export async function parseFileDataset(bytes: Uint8Array, options: ParseFileDatasetOptions, template: BusinessTemplateContract): Promise<ParsedFileDataset> {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMPORT_FILE_BYTES) throw new FileDatasetParseError("import_file_size_invalid", 413);
  const fileType = detectImportType(options.fileName);
  if (!fileType) throw new FileDatasetParseError(options.fileName.toLowerCase().endsWith(".xls") ? "legacy_xls_not_supported" : "unsupported_import_file", 415);
  if (fileType === "xlsx") return parseXlsx(bytes, options, template);
  if (fileType === "csv") return parseCsvDataset(bytes, options, template);
  return parseJsonDataset(bytes, template);
}
