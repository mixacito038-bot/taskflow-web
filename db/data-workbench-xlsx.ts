import JSZip from "@excel.js/jszip";
import { SaxesParser } from "saxes";

export const MAX_XLSX_BYTES = 25 * 1024 * 1024;
export const FORMULA_PLACEHOLDER = "[公式未采信]";

export type XlsxImportLimits = {
  maxFileBytes: number;
  maxZipEntries: number;
  maxUncompressedBytes: number;
  maxWorksheets: number;
  maxRowsPerSheet: number;
  maxColumnsPerSheet: number;
  maxTotalCells: number;
  maxCellCharacters: number;
  previewRows: number;
};

export const defaultXlsxImportLimits: XlsxImportLimits = {
  maxFileBytes: MAX_XLSX_BYTES,
  maxZipEntries: 10_000,
  maxUncompressedBytes: 250 * 1024 * 1024,
  maxWorksheets: 20,
  maxRowsPerSheet: 100_000,
  maxColumnsPerSheet: 256,
  maxTotalCells: 1_000_000,
  maxCellCharacters: 32_000,
  previewRows: 20,
};

export type XlsxPreviewValue = string | number | boolean | null;

export type XlsxParseResult = {
  rowCount: number;
  headers: string[];
  previewRows: Array<Record<string, XlsxPreviewValue>>;
  warnings: string[];
  parseMode: "server_xlsx";
};

export type XlsxWorkbookSheet = {
  name: string;
  rowCount: number;
  columnCount: number;
  rows: Array<{ rowNumber: number; values: XlsxPreviewValue[] }>;
  warnings: string[];
};

export type XlsxWorkbookParseResult = {
  sheets: XlsxWorkbookSheet[];
  parseMode: "server_xlsx";
};

type ZipEntry = {
  name: string;
  dir: boolean;
  _data?: { uncompressedSize?: number };
  async(type: "string"): Promise<string>;
};

type ZipArchive = {
  files: Record<string, ZipEntry>;
  file(name: string): ZipEntry | null;
};

export class XlsxImportError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message = code) {
    super(message);
    this.name = "XlsxImportError";
    this.code = code;
    this.status = status;
  }
}

export function validateXlsxUploadMetadata(fileName: string, sizeBytes: number, maxBytes = MAX_XLSX_BYTES) {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".xls")) {
    return { ok: false as const, code: "legacy_xls_not_supported", status: 415 as const };
  }
  if (!normalized.endsWith(".xlsx")) {
    return { ok: false as const, code: "xlsx_extension_required", status: 415 as const };
  }
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    return { ok: false as const, code: "xlsx_file_empty", status: 400 as const };
  }
  if (sizeBytes > maxBytes) {
    return { ok: false as const, code: "xlsx_file_too_large", status: 413 as const };
  }
  return { ok: true as const };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeLimits(overrides?: Partial<XlsxImportLimits>): XlsxImportLimits {
  const limits = { ...defaultXlsxImportLimits, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`Invalid XLSX limit: ${name}`);
  }
  return limits;
}

async function preflightOoxmlPackage(buffer: Buffer, limits: XlsxImportLimits) {
  if (buffer.length > limits.maxFileBytes) throw new XlsxImportError("xlsx_file_too_large", 413);
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new XlsxImportError("invalid_xlsx_package", 422);
  }
  let zip: ZipArchive;
  try {
    const zipApi = JSZip as { loadAsync(input: Buffer, options: { checkCRC32: boolean; createFolders: boolean }): Promise<ZipArchive> };
    zip = await zipApi.loadAsync(buffer, { checkCRC32: false, createFolders: false });
  } catch {
    throw new XlsxImportError("invalid_xlsx_package", 422);
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > limits.maxZipEntries) throw new XlsxImportError("xlsx_zip_entry_limit_exceeded", 413);
  let uncompressedBytes = 0;
  for (const entry of entries) {
    const normalizedName = entry.name.replaceAll("\\", "/").toLowerCase();
    if (
      normalizedName === "xl/vbaproject.bin"
      || normalizedName.startsWith("xl/externallinks/")
      || normalizedName === "xl/connections.xml"
      || normalizedName.startsWith("xl/embeddings/")
      || normalizedName.startsWith("xl/oleobjects/")
      || normalizedName.startsWith("customui/")
    ) {
      throw new XlsxImportError("xlsx_active_content_forbidden", 422);
    }
    const privateData = entry._data;
    const entryBytes = Number(privateData?.uncompressedSize ?? 0);
    if (Number.isFinite(entryBytes) && entryBytes > 0) uncompressedBytes += entryBytes;
    if (uncompressedBytes > limits.maxUncompressedBytes) {
      throw new XlsxImportError("xlsx_uncompressed_size_limit_exceeded", 413);
    }
  }
  return zip;
}

function nonEmpty(value: XlsxPreviewValue) {
  return value !== null && value !== "";
}

function xmlLocalName(name: string) {
  return name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
}

function xmlAttribute(tag: { attributes: Record<string, unknown> }, name: string) {
  const value = tag.attributes[name];
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.value === "string") return value.value;
  return "";
}

function parseXml(xml: string, handlers: {
  open?: (name: string, tag: { attributes: Record<string, unknown> }) => void;
  text?: (value: string) => void;
  close?: (name: string) => void;
}) {
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => handlers.open?.(xmlLocalName(tag.name), tag));
  parser.on("text", (value) => handlers.text?.(value));
  parser.on("cdata", (value) => handlers.text?.(value));
  parser.on("closetag", (tag) => handlers.close?.(xmlLocalName(typeof tag === "string" ? tag : tag.name)));
  parser.on("error", (error) => { throw error; });
  parser.write(xml).close();
}

async function sharedStringsFromArchive(zip: ZipArchive, limits: XlsxImportLimits) {
  const entry = zip.file("xl/sharedStrings.xml");
  if (!entry) return [];
  const values: string[] = [];
  let current: string | null = null;
  let captureText = false;
  parseXml(await entry.async("string"), {
    open(name) {
      if (name === "si") current = "";
      if (name === "t" && current !== null) captureText = true;
    },
    text(value) {
      if (!captureText || current === null) return;
      current += value;
      if (current.length > limits.maxCellCharacters) throw new XlsxImportError("xlsx_cell_character_limit_exceeded", 413);
    },
    close(name) {
      if (name === "t") captureText = false;
      if (name === "si" && current !== null) {
        values.push(current);
        if (values.length > limits.maxTotalCells) throw new XlsxImportError("xlsx_total_cell_limit_exceeded", 413);
        current = null;
      }
    },
  });
  return values;
}

function columnNumberFromAddress(address: string) {
  const letters = address.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result;
}

function rowNumberFromAddress(address: string) {
  return Number(address.match(/\d+$/)?.[0] ?? 0);
}

function valueFromCell(type: string, raw: string, inline: string, sharedStrings: string[]): XlsxPreviewValue {
  if (type === "inlineStr") return inline;
  if (type === "s") return sharedStrings[Number(raw)] ?? "";
  if (type === "b") return raw === "1";
  if (type === "str" || type === "e" || type === "d") return raw;
  if (!raw) return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : raw;
}

type ParsedSheet = {
  name: string;
  rows: Array<{ rowNumber: number; values: XlsxPreviewValue[] }>;
  merges: string[];
  formulaAddresses: string[];
  externalFormulaAddresses: string[];
  hyperlinkAddresses: string[];
  cellCount: number;
};

async function parseWorksheetEntry(
  entry: ZipEntry,
  sheetName: string,
  sharedStrings: string[],
  limits: XlsxImportLimits,
): Promise<ParsedSheet> {
  const rowValues = new Map<number, Map<number, XlsxPreviewValue>>();
  const merges: string[] = [];
  const formulaAddresses: string[] = [];
  const externalFormulaAddresses: string[] = [];
  const hyperlinkAddresses: string[] = [];
  let currentRow = 0;
  let currentCell: { address: string; column: number; type: string; raw: string; inline: string; formula: string; hasFormula: boolean } | null = null;
  let captureValue = false;
  let captureInline = false;
  let captureFormula = false;
  let cellCount = 0;

  parseXml(await entry.async("string"), {
    open(name, tag) {
      if (name === "row") {
        currentRow = Number(xmlAttribute(tag, "r")) || currentRow + 1;
        if (currentRow > limits.maxRowsPerSheet) throw new XlsxImportError("xlsx_row_limit_exceeded", 413);
      } else if (name === "c") {
        const address = xmlAttribute(tag, "r") || `A${currentRow || 1}`;
        const column = columnNumberFromAddress(address) || 1;
        const addressedRow = rowNumberFromAddress(address);
        if (addressedRow) currentRow = addressedRow;
        if (currentRow > limits.maxRowsPerSheet) throw new XlsxImportError("xlsx_row_limit_exceeded", 413);
        if (column > limits.maxColumnsPerSheet) throw new XlsxImportError("xlsx_column_limit_exceeded", 413);
        currentCell = { address, column, type: xmlAttribute(tag, "t"), raw: "", inline: "", formula: "", hasFormula: false };
        cellCount += 1;
        if (cellCount > limits.maxTotalCells) throw new XlsxImportError("xlsx_total_cell_limit_exceeded", 413);
      } else if (name === "v" && currentCell) {
        captureValue = true;
      } else if (name === "t" && currentCell?.type === "inlineStr") {
        captureInline = true;
      } else if (name === "f" && currentCell) {
        currentCell.hasFormula = true;
        captureFormula = true;
      } else if (name === "mergeCell") {
        const range = xmlAttribute(tag, "ref");
        if (range && merges.length < 10_000) merges.push(range);
      } else if (name === "hyperlink") {
        const reference = xmlAttribute(tag, "ref");
        if (reference && hyperlinkAddresses.length < 20) hyperlinkAddresses.push(reference);
      }
    },
    text(value) {
      if (!currentCell) return;
      if (captureValue) currentCell.raw += value;
      if (captureInline) currentCell.inline += value;
      if (captureFormula) currentCell.formula += value;
      if (currentCell.raw.length > limits.maxCellCharacters || currentCell.inline.length > limits.maxCellCharacters || currentCell.formula.length > limits.maxCellCharacters) {
        throw new XlsxImportError("xlsx_cell_character_limit_exceeded", 413);
      }
    },
    close(name) {
      if (name === "v") captureValue = false;
      if (name === "t") captureInline = false;
      if (name === "f") captureFormula = false;
      if (name !== "c" || !currentCell) return;
      const row = rowValues.get(currentRow) ?? new Map<number, XlsxPreviewValue>();
      if (currentCell.hasFormula) {
        if (formulaAddresses.length < 20) formulaAddresses.push(currentCell.address);
        if (/\[[^\]]+\]|\b(?:WEBSERVICE|HYPERLINK|RTD)\s*\(/i.test(currentCell.formula) && externalFormulaAddresses.length < 20) {
          externalFormulaAddresses.push(currentCell.address);
        }
        row.set(currentCell.column, FORMULA_PLACEHOLDER);
      } else {
        row.set(currentCell.column, valueFromCell(currentCell.type, currentCell.raw, currentCell.inline, sharedStrings));
      }
      rowValues.set(currentRow, row);
      currentCell = null;
    },
  });

  const mergedSubordinates = new Set<string>();
  for (const range of merges) {
    const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
    if (!match) continue;
    const firstColumn = columnNumberFromAddress(match[1]);
    const lastColumn = columnNumberFromAddress(match[3]);
    const firstRow = Number(match[2]);
    const lastRow = Number(match[4]);
    if (lastRow > limits.maxRowsPerSheet) throw new XlsxImportError("xlsx_row_limit_exceeded", 413);
    if (lastColumn > limits.maxColumnsPerSheet) throw new XlsxImportError("xlsx_column_limit_exceeded", 413);
    if ((lastRow - firstRow + 1) * (lastColumn - firstColumn + 1) > limits.maxTotalCells) {
      throw new XlsxImportError("xlsx_total_cell_limit_exceeded", 413);
    }
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        if (row !== firstRow || column !== firstColumn) mergedSubordinates.add(`${row}:${column}`);
      }
    }
  }

  const rows = [...rowValues.entries()].sort(([left], [right]) => left - right).map(([rowNumber, valuesByColumn]) => {
    const maxColumn = Math.max(0, ...valuesByColumn.keys());
    const values = Array.from({ length: maxColumn }, (_, index) => mergedSubordinates.has(`${rowNumber}:${index + 1}`) ? null : valuesByColumn.get(index + 1) ?? null);
    return { rowNumber, values };
  }).filter((row) => row.values.some(nonEmpty));
  return { name: sheetName, rows, merges, formulaAddresses, externalFormulaAddresses, hyperlinkAddresses, cellCount };
}

function uniqueHeaders(values: XlsxPreviewValue[], columnCount: number) {
  const used = new Map<string, number>();
  return Array.from({ length: columnCount }, (_, index) => {
    const raw = values[index];
    const base = raw === null || raw === "" || raw === FORMULA_PLACEHOLDER ? `列${index + 1}` : String(raw).trim();
    const bounded = base.slice(0, 160) || `列${index + 1}`;
    const count = (used.get(bounded) ?? 0) + 1;
    used.set(bounded, count);
    return count === 1 ? bounded : `${bounded}_${count}`;
  });
}

function mergeTouchesRow(range: string, rowNumber: number) {
  const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  return match ? rowNumber >= Number(match[2]) && rowNumber <= Number(match[4]) : false;
}

function normalizeWorkbookTarget(target: string) {
  const normalized = target.replaceAll("\\", "/").replace(/^\//, "");
  const workbookRelative = normalized.startsWith("xl/") ? normalized : `xl/${normalized.replace(/^\.\//, "")}`;
  const segments = workbookRelative.split("/").filter(Boolean);
  if (segments.includes("..")) return "";
  return segments.join("/").toLowerCase();
}

async function worksheetNamesFromArchive(zip: ZipArchive) {
  const workbookEntry = zip.file("xl/workbook.xml");
  const relationshipsEntry = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookEntry || !relationshipsEntry) return new Map<string, string>();

  const relationshipTargets = new Map<string, string>();
  parseXml(await relationshipsEntry.async("string"), {
    open(name, tag) {
      if (name !== "Relationship") return;
      const id = xmlAttribute(tag, "Id");
      const target = normalizeWorkbookTarget(xmlAttribute(tag, "Target"));
      if (id && target) relationshipTargets.set(id, target);
    },
  });

  const names = new Map<string, string>();
  parseXml(await workbookEntry.async("string"), {
    open(name, tag) {
      if (name !== "sheet") return;
      const relationshipId = xmlAttribute(tag, "r:id") || xmlAttribute(tag, "id");
      const target = relationshipTargets.get(relationshipId);
      const sheetName = xmlAttribute(tag, "name").trim().slice(0, 120);
      if (target && sheetName) names.set(target, sheetName);
    },
  });
  return names;
}

function warningsForSheet(sheet: ParsedSheet, headerRowNumber?: number) {
  const warnings: string[] = [];
  const headerMerges = headerRowNumber
    ? sheet.merges.filter((range) => mergeTouchesRow(range, headerRowNumber))
    : [];
  if (headerMerges.length) warnings.push(`表头行包含合并单元格（${headerMerges.slice(0, 10).join("、")}），请在字段映射前确认列名。`);
  if (sheet.formulaAddresses.length) warnings.push(`检测到公式单元格（示例：${sheet.formulaAddresses.join("、")}）；未执行公式且未采信缓存结果，预览显示“${FORMULA_PLACEHOLDER}”。`);
  if (sheet.externalFormulaAddresses.length) warnings.push(`检测到可能含外部引用或网络函数的公式（示例：${sheet.externalFormulaAddresses.join("、")}），已禁用并忽略结果。`);
  if (sheet.hyperlinkAddresses.length) warnings.push(`检测到超链接单元格（示例：${sheet.hyperlinkAddresses.join("、")}），仅保留显示文字。`);
  return warnings;
}

async function parseWorkbookPackage(bufferLike: Buffer | Uint8Array, overrides?: Partial<XlsxImportLimits>) {
  const limits = mergeLimits(overrides);
  const buffer = Buffer.isBuffer(bufferLike) ? bufferLike : Buffer.from(bufferLike);
  const zip = await preflightOoxmlPackage(buffer, limits);
  const worksheetEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
    .sort((left, right) => Number(left.name.match(/sheet(\d+)/i)?.[1] ?? 0) - Number(right.name.match(/sheet(\d+)/i)?.[1] ?? 0));
  if (!worksheetEntries.length) throw new XlsxImportError("xlsx_has_no_worksheets", 422);
  if (worksheetEntries.length > limits.maxWorksheets) throw new XlsxImportError("xlsx_worksheet_limit_exceeded", 413);

  try {
    const sharedStrings = await sharedStringsFromArchive(zip, limits);
    const worksheetNames = await worksheetNamesFromArchive(zip);
    const sheets: ParsedSheet[] = [];
    let totalCells = 0;
    for (let index = 0; index < worksheetEntries.length; index += 1) {
      const entry = worksheetEntries[index];
      const sheetName = worksheetNames.get(entry.name.replaceAll("\\", "/").toLowerCase()) ?? `工作表${index + 1}`;
      const parsed = await parseWorksheetEntry(entry, sheetName, sharedStrings, limits);
      totalCells += parsed.cellCount;
      if (totalCells > limits.maxTotalCells) throw new XlsxImportError("xlsx_total_cell_limit_exceeded", 413);
      sheets.push(parsed);
    }
    return { limits, sheets };
  } catch (error) {
    if (error instanceof XlsxImportError) throw error;
    throw new XlsxImportError("invalid_xlsx_workbook", 422);
  }
}

/**
 * Parses every worksheet into inert scalar rows for the file-import pipeline.
 * Formula results are replaced, and active OOXML content is rejected during
 * package preflight before any worksheet data is returned.
 */
export async function parseXlsxWorkbook(bufferLike: Buffer | Uint8Array, overrides?: Partial<XlsxImportLimits>): Promise<XlsxWorkbookParseResult> {
  const { sheets } = await parseWorkbookPackage(bufferLike, overrides);
  return {
    sheets: sheets.map((sheet) => ({
      name: sheet.name,
      rowCount: sheet.rows.length ? Math.max(...sheet.rows.map((row) => row.rowNumber)) : 0,
      columnCount: Math.max(0, ...sheet.rows.map((row) => row.values.length)),
      rows: sheet.rows,
      warnings: warningsForSheet(sheet),
    })),
    parseMode: "server_xlsx",
  };
}

/**
 * Server-only XLSX value parser.
 *
 * The OOXML package is opened with the maintained JSZip fork, then only the
 * shared-string and worksheet value XML parts are streamed through a strict
 * SAX parser. Formula nodes are detected separately from cached value nodes;
 * cached results are never returned and formulas are never evaluated.
 */
export async function parseXlsxBuffer(bufferLike: Buffer | Uint8Array, overrides?: Partial<XlsxImportLimits>): Promise<XlsxParseResult> {
  const { limits, sheets } = await parseWorkbookPackage(bufferLike, overrides);

  const nonEmptySheets = sheets.filter((sheet) => sheet.rows.length > 0);
  if (!nonEmptySheets.length) throw new XlsxImportError("xlsx_has_no_data", 422);
  const sheet = nonEmptySheets[0];
  const normalizedRows = sheet.rows;
  if (!normalizedRows.length) throw new XlsxImportError("xlsx_has_no_data", 422);

  const headerRow = normalizedRows[0];
  const columnCount = Math.max(headerRow.values.length, ...normalizedRows.map((row) => row.values.length));
  if (columnCount > limits.maxColumnsPerSheet) throw new XlsxImportError("xlsx_column_limit_exceeded", 413);
  const headers = uniqueHeaders(headerRow.values, columnCount);
  const dataRows = normalizedRows.slice(1);
  const previewRows = dataRows.slice(0, limits.previewRows).map(({ values }) => Object.fromEntries(
    headers.map((header, index) => [header, values[index] ?? null]),
  ));
  const warnings: string[] = [];
  if (nonEmptySheets.length > 1) {
    warnings.push(`工作簿包含 ${nonEmptySheets.length} 个非空工作表；本次预览仅使用首个工作表“${sheet.name}”。`);
  }
  warnings.push(...warningsForSheet(sheet, headerRow.rowNumber));

  return { rowCount: dataRows.length, headers, previewRows, warnings, parseMode: "server_xlsx" };
}
