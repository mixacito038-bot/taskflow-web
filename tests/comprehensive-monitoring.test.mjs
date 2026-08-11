import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateFormula,
  evaluateMetricSet,
  extractFormulaRefs,
  parseFormula,
  validateFormulaExpression,
} from "../app/metric-formula.ts";
import {
  COMPREHENSIVE_MONITORING_CODE_PREFIX,
  COMPREHENSIVE_MONITORING_VERSION,
  comprehensiveMonitoringCatalog,
  comprehensiveMonitoringCategories,
} from "../app/comprehensive-monitoring-template.ts";
import {
  metricTemplateRegistry,
  registeredMetricTemplateVersions,
  resolveMetricTemplate,
} from "../app/metric-template-registry.ts";
import {
  HOSPITAL_METRIC_CATALOG_VERSION,
  hospitalMetricCatalog,
} from "../app/hospital-metric-catalog.ts";
import {
  buildHospitalMetricTemplateRows,
  hospitalMetricActivationIssues,
  parseHospitalMetricTemplateMetadata,
  planHospitalMetricTemplateImport,
} from "../db/data-workbench-metric-template.ts";
import {
  evaluateDerivedMetrics,
  validateMetricDefinition,
} from "../app/analytics-semantic-layer.ts";

const values = new Map([
  ["hospital.monitor.revenue", 1832],
  ["hospital.monitor.cost", 1010],
  ["hospital.monitor.exam_count", 23450],
]);
const resolve = (ref) => (values.has(ref) ? values.get(ref) : undefined);

test("公式引擎：优先级、括号、一元负号和小数", () => {
  assert.deepEqual(evaluateFormula("1 + 2 * 3", resolve), { ok: true, value: 7 });
  assert.deepEqual(evaluateFormula("(1 + 2) * 3", resolve), { ok: true, value: 9 });
  assert.deepEqual(evaluateFormula("-2 * 3", resolve), { ok: true, value: -6 });
  assert.deepEqual(evaluateFormula("2 - -3", resolve), { ok: true, value: 5 });
  assert.deepEqual(evaluateFormula("10 / 4", resolve), { ok: true, value: 2.5 });
  assert.deepEqual(evaluateFormula("1.5 * 2", resolve), { ok: true, value: 3 });
  assert.deepEqual(
    evaluateFormula("hospital.monitor.revenue - hospital.monitor.cost", resolve),
    { ok: true, value: 822 },
  );
});

test("公式引擎：除零、缺值、未知引用与非有限结果显式失败", () => {
  assert.deepEqual(evaluateFormula("1 / 0", resolve), { ok: false, reason: "division_by_zero" });
  assert.deepEqual(
    evaluateFormula("hospital.monitor.revenue / no.such.metric", resolve),
    { ok: false, reason: "unknown_ref" },
  );
  assert.deepEqual(
    evaluateFormula("hospital.monitor.revenue - hospital.monitor.cost", () => null),
    { ok: false, reason: "missing_value" },
  );
  assert.deepEqual(
    evaluateFormula("hospital.monitor.revenue - hospital.monitor.cost", () => Number.NaN),
    { ok: false, reason: "missing_value" },
  );
  assert.deepEqual(evaluateFormula("big * big", () => 1e308), { ok: false, reason: "not_finite" });
  assert.deepEqual(evaluateFormula("1 +", resolve), { ok: false, reason: "parse_error" });
});

test("公式引擎：中文校验信息与非法输入拒绝", () => {
  assert.deepEqual(validateFormulaExpression("a + b * (c - 1)"), []);
  assert.deepEqual(validateFormulaExpression(""), ["公式不能为空"]);
  assert.match(validateFormulaExpression("收入 - 成本")[0], /无法识别/);
  assert.match(validateFormulaExpression("1 +")[0], /缺少操作数|不完整/);
  assert.match(validateFormulaExpression("(a + b")[0], /括号不匹配/);
  assert.match(validateFormulaExpression("a + b)")[0], /括号不匹配/);
  assert.match(validateFormulaExpression("1.2.3")[0], /数字格式不正确/);
  assert.match(validateFormulaExpression("a b")[0], /不符合语法/);
  const scoped = validateFormulaExpression("a - b", new Set(["a"]));
  assert.deepEqual(scoped, ["公式引用了未登记的指标编码：b"]);
  // 禁止任何 eval 路径：引擎必须纯解析执行。
  assert.equal(parseFormula("a + b").ok, true);
});

test("公式引擎：extractFormulaRefs 去重且保持出现顺序", () => {
  assert.deepEqual(
    extractFormulaRefs("hospital.monitor.revenue / hospital.monitor.exam_count + hospital.monitor.revenue"),
    ["hospital.monitor.revenue", "hospital.monitor.exam_count"],
  );
  assert.deepEqual(extractFormulaRefs("1 +"), []);
});

test("公式引擎：指标集拓扑求值、链式依赖与循环检测", () => {
  const base = new Map([["a", 10], ["b", 4]]);
  const results = evaluateMetricSet(
    [
      { code: "a" },
      { code: "b" },
      { code: "diff", formulaExpr: "a - b" },
      { code: "ratio", formulaExpr: "diff / b" },
      { code: "broken", formulaExpr: "a / missing_base" },
      { code: "divzero", formulaExpr: "a / (b - 4)" },
      { code: "loop_x", formulaExpr: "loop_y + 1" },
      { code: "loop_y", formulaExpr: "loop_x + 1" },
      { code: "depends_on_loop", formulaExpr: "loop_x * 2" },
      { code: "no_data" },
    ],
    (code) => (base.has(code) ? base.get(code) : code === "missing_base" ? undefined : null),
  );
  assert.deepEqual(results.get("a"), { ok: true, value: 10 });
  assert.deepEqual(results.get("diff"), { ok: true, value: 6 });
  assert.deepEqual(results.get("ratio"), { ok: true, value: 1.5 });
  assert.deepEqual(results.get("broken"), { ok: false, reason: "unknown_ref" });
  assert.deepEqual(results.get("divzero"), { ok: false, reason: "division_by_zero" });
  assert.deepEqual(results.get("loop_x"), { ok: false, reason: "circular_reference" });
  assert.deepEqual(results.get("loop_y"), { ok: false, reason: "circular_reference" });
  assert.deepEqual(results.get("depends_on_loop"), { ok: false, reason: "missing_value" });
  assert.deepEqual(results.get("no_data"), { ok: false, reason: "missing_value" });
});

test("全面监测目录：30 项指标映射五个维度且编码唯一", () => {
  assert.equal(comprehensiveMonitoringCatalog.length, 30);
  const dimensions = new Set(["economic", "efficiency", "quality", "experience", "reliability"]);
  const codes = new Set();
  for (const item of comprehensiveMonitoringCatalog) {
    assert.ok(dimensions.has(item.dimension), `${item.code} 维度非法`);
    assert.ok(item.code.startsWith(COMPREHENSIVE_MONITORING_CODE_PREFIX), `${item.code} 前缀错误`);
    assert.ok(item.code.startsWith("hospital."), "客户端模板识别依赖 hospital. 前缀");
    assert.ok(!codes.has(item.code), `${item.code} 重复`);
    codes.add(item.code);
    assert.equal(item.version, COMPREHENSIVE_MONITORING_VERSION);
    assert.ok(item.name.trim() && item.formula.trim() && item.unit.trim() && item.grain.trim());
    assert.ok(["ready", "configure", "deferred"].includes(item.readiness));
  }
  const byDimension = {
    economic: 7,
    efficiency: 4,
    quality: 5,
    experience: 4,
    reliability: 10,
  };
  for (const [dimension, count] of Object.entries(byDimension)) {
    assert.equal(
      comprehensiveMonitoringCatalog.filter((item) => item.dimension === dimension).length,
      count,
      `${dimension} 数量不符`,
    );
  }
});

test("全面监测目录：每条 formulaExpr 可解析且只引用目录内编码", () => {
  const codes = new Set(comprehensiveMonitoringCatalog.map((item) => item.code));
  const derived = comprehensiveMonitoringCatalog.filter((item) => item.formulaExpr !== undefined);
  assert.ok(derived.length >= 3, "至少利润与两个次均指标为派生");
  for (const item of derived) {
    assert.deepEqual(
      validateFormulaExpression(item.formulaExpr, codes),
      [],
      `${item.code} 公式非法`,
    );
    const refs = extractFormulaRefs(item.formulaExpr);
    assert.ok(refs.length > 0);
    for (const ref of refs) assert.ok(codes.has(ref), `${item.code} 引用了目录外编码 ${ref}`);
  }
  // 派生链自洽：给定基础值时整个目录求值不产生循环。
  const results = evaluateMetricSet(
    comprehensiveMonitoringCatalog.map((item) => ({ code: item.code, formulaExpr: item.formulaExpr })),
    (code) => (code === "hospital.monitor.revenue" ? 100 : code === "hospital.monitor.cost" ? 60 : code === "hospital.monitor.exam_count" ? 20 : null),
  );
  assert.deepEqual(results.get("hospital.monitor.profit"), { ok: true, value: 40 });
  assert.deepEqual(results.get("hospital.monitor.revenue_per_exam"), { ok: true, value: 5 });
  assert.deepEqual(results.get("hospital.monitor.cost_per_exam"), { ok: true, value: 3 });
  for (const result of results.values()) {
    assert.notEqual(result.ok === false ? result.reason : "", "circular_reference");
  }
});

test("全面监测目录：分类结构恰好覆盖全部编码且标题正确", () => {
  assert.deepEqual(
    comprehensiveMonitoringCategories.map((category) => category.title),
    ["设备效益", "设备效率", "临床使用质量", "患者体验", "设备保障"],
  );
  const covered = comprehensiveMonitoringCategories.flatMap((category) => category.metricCodes);
  assert.equal(covered.length, comprehensiveMonitoringCatalog.length);
  assert.deepEqual(
    [...covered].sort(),
    comprehensiveMonitoringCatalog.map((item) => item.code).sort(),
  );
  for (const category of comprehensiveMonitoringCategories) {
    for (const code of category.metricCodes) {
      const item = comprehensiveMonitoringCatalog.find((entry) => entry.code === code);
      assert.equal(item?.dimension, category.dimension);
    }
  }
});

test("模板注册表：登记基线与全面监测两个版本", () => {
  assert.deepEqual(
    [...registeredMetricTemplateVersions].sort(),
    [COMPREHENSIVE_MONITORING_VERSION, HOSPITAL_METRIC_CATALOG_VERSION].sort(),
  );
  const baseline = resolveMetricTemplate(HOSPITAL_METRIC_CATALOG_VERSION);
  assert.equal(baseline?.catalog, hospitalMetricCatalog);
  assert.equal(baseline?.expectedCount, 20);
  assert.equal(baseline?.catalog.length, 20);
  const monitoring = resolveMetricTemplate(COMPREHENSIVE_MONITORING_VERSION);
  assert.equal(monitoring?.catalog, comprehensiveMonitoringCatalog);
  assert.equal(monitoring?.expectedCount, 30);
  assert.equal(monitoring?.catalog.length, 30);
  assert.equal(resolveMetricTemplate("HOSPITAL-BASELINE-2020.01.01.1"), null);
  assert.equal(resolveMetricTemplate("toString"), null);
  for (const [version, template] of Object.entries(metricTemplateRegistry)) {
    assert.equal(template.catalog.length, template.expectedCount, `${version} expectedCount 不符`);
    assert.ok(template.catalog.every((item) => item.version === version));
  }
});

test("全面监测模板可构建 30 条草稿并保留 formulaExpr 元数据", () => {
  const rows = buildHospitalMetricTemplateRows(comprehensiveMonitoringCatalog, COMPREHENSIVE_MONITORING_VERSION);
  assert.equal(rows.length, 30);
  assert.ok(rows.every((row) => row.status === "draft" && row.version === 1));
  const profit = rows.find((row) => row.code === "hospital.monitor.profit");
  const metadata = parseHospitalMetricTemplateMetadata(profit.description);
  assert.equal(metadata?.schema, "hospital-metric-template/v1");
  assert.equal(metadata?.catalogVersion, COMPREHENSIVE_MONITORING_VERSION);
  assert.equal(metadata?.formulaExpr, "hospital.monitor.revenue - hospital.monitor.cost");
  const base = rows.find((row) => row.code === "hospital.monitor.revenue");
  const baseMetadata = parseHospitalMetricTemplateMetadata(base.description);
  assert.equal(baseMetadata?.formulaExpr, undefined);
  assert.ok(!Object.prototype.hasOwnProperty.call(JSON.parse(base.description), "formulaExpr"));
  // 基线模板元数据保持逐字节兼容：不出现 formulaExpr 键。
  const baselineRows = buildHospitalMetricTemplateRows(hospitalMetricCatalog, HOSPITAL_METRIC_CATALOG_VERSION);
  assert.ok(baselineRows.every((row) => !Object.prototype.hasOwnProperty.call(JSON.parse(row.description), "formulaExpr")));
});

test("全面监测模板导入计划幂等且冲突时全量拒绝", () => {
  const rows = buildHospitalMetricTemplateRows(comprehensiveMonitoringCatalog, COMPREHENSIVE_MONITORING_VERSION);
  const fresh = planHospitalMetricTemplateImport(rows, []);
  assert.equal(fresh.created.length, 30);
  assert.deepEqual(fresh.skipped, []);
  assert.deepEqual(fresh.conflicts, []);
  const repeat = planHospitalMetricTemplateImport(rows, rows);
  assert.equal(repeat.created.length, 0);
  assert.equal(repeat.skipped.length, 30);
  assert.deepEqual(repeat.conflicts, []);
  const tampered = rows.map((row) => ({ ...row }));
  tampered[2].formula = "tampered";
  const conflicted = planHospitalMetricTemplateImport(rows, tampered);
  assert.equal(conflicted.created.length, 0);
  assert.equal(conflicted.conflicts.length, 1);
});

test("激活校验接受注册版本集合并拒绝未登记版本", () => {
  const rows = buildHospitalMetricTemplateRows(comprehensiveMonitoringCatalog, COMPREHENSIVE_MONITORING_VERSION);
  const activatable = rows.find((row) => row.code === "hospital.monitor.exam_count");
  assert.deepEqual(
    hospitalMetricActivationIssues(activatable, { sourceFieldIds: ["field-1"], dependencyMetricIds: [] }, registeredMetricTemplateVersions),
    [],
  );
  assert.deepEqual(
    hospitalMetricActivationIssues(activatable, { sourceFieldIds: ["field-1"], dependencyMetricIds: [] }, new Set([HOSPITAL_METRIC_CATALOG_VERSION])),
    ["unsupported_template_version"],
  );
  // 旧字符串签名保持兼容。
  assert.deepEqual(
    hospitalMetricActivationIssues(activatable, { sourceFieldIds: ["field-1"], dependencyMetricIds: [] }, COMPREHENSIVE_MONITORING_VERSION),
    [],
  );
});

test("语义层：派生指标校验与求值", () => {
  assert.deepEqual(
    validateMetricDefinition({
      code: "device_profit",
      name: "设备利润",
      aggregation: "sum",
      formulaExpr: "hospital.monitor.revenue - hospital.monitor.cost",
      status: "draft",
      version: 1,
    }),
    [],
  );
  assert.deepEqual(
    validateMetricDefinition({ code: "device_revenue", name: "设备收入", aggregation: "sum", field: "revenue", status: "draft", version: 1 }),
    [],
  );
  assert.deepEqual(
    validateMetricDefinition({ code: "device_revenue", name: "设备收入", aggregation: "sum", status: "draft", version: 1 }),
    ["指标必须引用字段"],
  );
  assert.match(
    validateMetricDefinition({ code: "bad_formula", name: "坏公式", aggregation: "sum", formulaExpr: "a +", status: "draft", version: 1 })[0],
    /公式/,
  );
  const results = evaluateDerivedMetrics(
    [
      { code: "revenue" },
      { code: "cost" },
      { code: "profit", formulaExpr: "revenue - cost" },
    ],
    (code) => (code === "revenue" ? 12 : code === "cost" ? 5 : null),
  );
  assert.deepEqual(results.get("profit"), { ok: true, value: 7 });
});

test("服务端路由与工作台使用模板注册表", async () => {
  const [route, workbench] = await Promise.all([
    readFile(new URL("../app/api/data-workbench/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/DataWorkbench.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /resolveMetricTemplate\(templateVersion\)/);
  assert.match(route, /registeredTemplate\.expectedCount/);
  assert.match(route, /registeredMetricTemplateVersions/);
  assert.match(route, /Object\.values\(metricTemplateRegistry\)\.flatMap/);
  assert.match(route, /unsupported_hospital_metric_template_version/);
  assert.match(workbench, /metricTemplateRegistry/);
  assert.match(workbench, /setMetricTemplateVersion/);
  assert.match(workbench, /选择指标模板版本/);
  assert.match(workbench, /templateVersion: metricTemplateVersion/);
});

test("采集与分析工作室挂载全面监测看板", async () => {
  const [studio, board] = await Promise.all([
    readFile(new URL("../app/BenefitAnalysisStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/ComprehensiveMonitoringBoard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(studio, /"monitor"/);
  assert.match(studio, /全面监测/);
  assert.match(studio, /ComprehensiveMonitoringBoard devices=\{devices\}/);
  assert.match(board, /数据缺失 · 待字段映射/);
  assert.match(board, /不可计算 · 分母为零/);
  assert.match(board, /不可计算 · 循环引用/);
  assert.match(board, /COMPREHENSIVE_MONITORING_VERSION/);
  assert.match(board, /数据准备中心/);
  assert.match(board, /evaluateMetricSet/);
});
