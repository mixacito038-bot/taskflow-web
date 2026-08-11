import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "@excel.js/jszip";

const parserUrl = new URL("../db/data-workbench-xlsx.ts", import.meta.url);
const routeUrl = new URL("../app/api/data-workbench/import-file/route.ts", import.meta.url);

async function sampleWorkbook() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1"><c r="A1" t="inlineStr"><is><t>设备编号</t></is></c><c r="B1" t="inlineStr"><is><t>收入</t></is></c><c r="C1" t="inlineStr"><is><t>计算值</t></is></c><c r="D1" t="inlineStr"><is><t>合并说明</t></is></c></row>
        <row r="2"><c r="A2" t="inlineStr"><is><t>DEV-001</t></is></c><c r="B2"><v>1250</v></c><c r="C2"><f>SUM(B2)</f><v>1250</v></c><c r="D2" t="inlineStr"><is><t>样例</t></is></c></row>
      </sheetData>
      <mergeCells count="1"><mergeCell ref="D1:E1"/></mergeCells>
    </worksheet>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

test("upload metadata accepts xlsx and rejects legacy xls and oversized files", async () => {
  const { MAX_XLSX_BYTES, validateXlsxUploadMetadata } = await import(parserUrl.href);
  assert.equal(validateXlsxUploadMetadata("equipment.xlsx", MAX_XLSX_BYTES).ok, true);
  assert.deepEqual(validateXlsxUploadMetadata("equipment.xls", 100), {
    ok: false,
    code: "legacy_xls_not_supported",
    status: 415,
  });
  assert.equal(validateXlsxUploadMetadata("equipment.xlsx", MAX_XLSX_BYTES + 1).code, "xlsx_file_too_large");
  assert.equal(validateXlsxUploadMetadata("equipment.csv", 100).code, "xlsx_extension_required");
});

test("real xlsx is parsed server-side without trusting formula cache", async () => {
  const { FORMULA_PLACEHOLDER, parseXlsxBuffer } = await import(parserUrl.href);
  const parsed = await parseXlsxBuffer(await sampleWorkbook());
  assert.equal(parsed.parseMode, "server_xlsx");
  assert.equal(parsed.rowCount, 1);
  assert.deepEqual(parsed.headers.slice(0, 3), ["设备编号", "收入", "计算值"]);
  assert.equal(parsed.previewRows[0]["设备编号"], "DEV-001");
  assert.equal(parsed.previewRows[0]["计算值"], FORMULA_PLACEHOLDER);
  assert.ok(parsed.warnings.some((warning) => warning.includes("公式")));
  assert.ok(parsed.warnings.some((warning) => warning.includes("合并")));
});

test("parser rejects resource-limit overflow and macro-bearing OOXML packages", async () => {
  const { XlsxImportError, parseXlsxBuffer } = await import(parserUrl.href);
  await assert.rejects(
    parseXlsxBuffer(await sampleWorkbook(), { maxRowsPerSheet: 1 }),
    (error) => error instanceof XlsxImportError && error.code === "xlsx_row_limit_exceeded",
  );

  const zip = await JSZip.loadAsync(await sampleWorkbook());
  zip.file("xl/vbaProject.bin", new Uint8Array([1, 2, 3]));
  const macroBuffer = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(
    parseXlsxBuffer(macroBuffer),
    (error) => error instanceof XlsxImportError && error.code === "xlsx_active_content_forbidden",
  );
});

test("route contract enforces session, same-origin, tenant scope, permission and multipart", async () => {
  const route = await readFile(routeUrl, "utf8");
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /requireAppSession\(request\)/);
  assert.match(route, /getCloudStateAccess\(user\.email, hospitalId\)/);
  assert.match(route, /dataScope === "hospital"/);
  assert.match(route, /permissions\.has\("data\.ingest"\)/);
  assert.match(route, /multipart\/form-data/);
  assert.match(route, /MAX_IMPORT_FILE_BYTES/);
  assert.match(route, /import_file_too_large/);
  assert.match(route, /FileDatasetParseError/);
});
