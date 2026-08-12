import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const studioUrl = new URL("../app/BenefitAnalysisStudio.tsx", import.meta.url);
const readStudio = () => readFile(studioUrl, "utf8");

// 只取组件参数表，避免正文里的同名字符串干扰签名断言。
function readSignature(source) {
  const start = source.indexOf("export default function BenefitAnalysisStudio(");
  assert.notEqual(start, -1, "找不到组件定义");
  const end = source.indexOf("}) {", start);
  assert.notEqual(end, -1, "找不到组件参数表结尾");
  return source.slice(start, end);
}

test("页签类型只剩全面监测与自定义视图", async () => {
  const source = await readStudio();
  // 采集方案／质量与对账／分析口径的职责已回到数据准备中心和指标字典，类型里不能再留残值。
  assert.match(source, /type StudioTab = "monitor" \| "custom";/);
  assert.doesNotMatch(source, /"collection"/);
  assert.doesNotMatch(source, /"quality"/);
  assert.doesNotMatch(source, /"metrics"/);
});

test("被删的三个页签按钮文案彻底消失", async () => {
  const source = await readStudio();
  // 文案还在就说明分支没删干净，用户会在界面上再次看到重复入口。
  for (const label of ["采集方案", "质量与对账", "分析口径"]) {
    assert.doesNotMatch(source, new RegExp(label), `${label} 仍然残留`);
  }
});

test("采集方案页签的内容不再出现", async () => {
  const source = await readStudio();
  // 文件模板、来源准备状态属于数据准备中心，这里重复展示会让两处状态互相矛盾。
  for (const token of ["采集合同", "最小事件数据集", "来源文件与当前准备状态", "证据链", "文件采集方式", "analysis-ingestion-flow", "analysis-collection-layout"]) {
    assert.doesNotMatch(source, new RegExp(token), `${token} 仍然残留`);
  }
});

test("没有指向已删页签的跳转", async () => {
  const source = await readStudio();
  // 死跳转会让按钮点了没反应，比直接删掉更糟。
  assert.doesNotMatch(source, /setTab\(/);
  assert.doesNotMatch(source, /onTabChange\("(collection|quality|metrics)"\)/);
  // 跨页签跳转只允许落到保留下来的两个页签。
  for (const match of source.matchAll(/onTabChange\("([^"]+)"\)/g)) {
    assert.ok(["monitor", "custom"].includes(match[1]), `跳转到了不存在的页签 ${match[1]}`);
  }
});

test("组件不再自带页头", async () => {
  const source = await readStudio();
  // 页头由「效益分析」父页面统一提供，组件内再来一个 h1 就是重复标题。
  assert.doesNotMatch(source, /page-heading/);
  assert.doesNotMatch(source, /<h1/);
  // 顶部数值卡同样归父页面，这里不再重复统计。
  assert.doesNotMatch(source, /analysis-summary/);
  assert.doesNotMatch(source, /品类模板/);
  assert.doesNotMatch(source, /来源文件准备/);
});

test("组件不再渲染自己的页签按钮条", async () => {
  const source = await readStudio();
  // 页签由父组件渲染，组件内部只按 tab 属性渲染内容，否则页面上会出现两排页签。
  assert.doesNotMatch(source, /analysis-tabs/);
  assert.doesNotMatch(source, /role="tablist"/);
  assert.doesNotMatch(source, /role="tab"/);
});

test("组件签名接收 tab 与 onTabChange，不再接收来源数据", async () => {
  const source = await readStudio();
  const signature = readSignature(source);
  // 父页面托管页签状态，所以必须能传入并回写。
  assert.match(signature, /tab: "monitor" \| "custom";/);
  assert.match(signature, /onTabChange: \(next: "monitor" \| "custom"\) => void;/);
  // sources / onOpenSources 只被删掉的页签使用，留着就是无人使用的死接口。
  assert.doesNotMatch(signature, /\bsources\b/);
  assert.doesNotMatch(signature, /onOpenSources/);
  assert.doesNotMatch(source, /onOpenSources/);
  assert.doesNotMatch(source, /DataSource/);
});

test("保留的两个页签仍然渲染各自的核心内容", async () => {
  const source = await readStudio();
  // 全面监测复用五大类指标看板，自定义视图复用可配置画布，这两处是本次改造要留下的价值。
  assert.match(source, /tab === "monitor"/);
  assert.match(source, /ComprehensiveMonitoringBoard devices=\{devices\}/);
  assert.match(source, /tab === "custom"/);
  assert.match(source, /<ConfigurableAnalyticsCanvas/);
  assert.match(source, /setCustomChartType/);
  assert.match(source, /多部位检查计算规则/);
});

test("编辑弹窗与校验完整保留且有可达入口", async () => {
  const source = await readStudio();
  // 弹窗原本被多个页签共用，删页签不等于删配置能力；没有入口的弹窗等于死代码。
  assert.match(source, /analysis-profile-dialog/);
  assert.match(source, /openEditor\(selected\)/);
  for (const rule of [
    "分摊权重合计必须为 100%",
    "云端分析事件不得采集直接身份字段",
    "月计划可服务时长应大于 0 且不超过 744 小时",
    "质量阈值与对账容差必须在 0–100% 之间",
  ]) {
    assert.match(source, new RegExp(rule), `${rule} 校验丢失`);
  }
});

test("没有残留的死 import", async () => {
  const source = await readStudio();
  const importPattern = /^import[\s\S]*?from\s+"[^"]+";/gm;
  const statements = source.match(importPattern) ?? [];
  assert.ok(statements.length > 0, "没有解析到任何 import");
  // 逐条核对导入符号确实在正文里使用；删分支最容易漏掉的就是这些孤儿 import。
  const body = source.replace(importPattern, "");
  for (const statement of statements) {
    const names = [];
    const named = statement.match(/\{([\s\S]*?)\}/);
    if (named) {
      for (const raw of named[1].split(",")) {
        const token = raw.trim().replace(/^type\s+/, "");
        if (!token) continue;
        const parts = token.split(/\s+as\s+/);
        names.push(parts[parts.length - 1].trim());
      }
    }
    const defaultImport = statement.match(/^import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,|\s+from)/);
    if (defaultImport) names.push(defaultImport[1]);
    for (const name of names) {
      assert.ok(new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(body), `${name} 已导入却没有被使用`);
    }
  }
});

test("被删分支的辅助常量与函数一并清理", async () => {
  const source = await readStudio();
  // 常量留着不用会让下一个人以为还有对应界面。
  for (const symbol of ["sampleQuality", "metricRules", "qualityGates", "matchSource", "qualityTone", "profileStructureReady", "configurationIssues", "FlowStage", "hospitalMetricCatalog"]) {
    assert.doesNotMatch(source, new RegExp(symbol), `${symbol} 仍然残留`);
  }
});

test("没有小于 12px 的字号", async () => {
  const source = await readStudio();
  // 医院端在大屏和投屏上使用，字号低于 12px 会看不清。
  const sizes = [
    ...source.matchAll(/fontSize:\s*"?(\d+(?:\.\d+)?)(?:px)?"?/g),
    ...source.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g),
  ];
  for (const match of sizes) {
    assert.ok(Number(match[1]) >= 12, `存在 ${match[1]}px 的字号`);
  }
});
