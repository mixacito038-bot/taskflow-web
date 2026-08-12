import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 纯静态源码断言：这一页要靠浏览器才跑得起来，但「口径有没有被重新自己算一遍」
// 「中英夹杂标题有没有改掉」「字号有没有超标」这些在源码层面就能钉死，钉住它们比不测强得多。
const componentUrl = new URL("../app/CapitalPlanningCenter.tsx", import.meta.url);
const tsx = await readFile(componentUrl, "utf8");
const cssRaw = await readFile(new URL("../app/CapitalPlanningCenter.module.css", import.meta.url), "utf8");

// 注释里会提到类名、px 数值和被废弃的旧口径（比如解释金额为什么换算成元），
// 不剥掉的话「类写没写」「页面正文有没有旧单位」都可能被一句注释蒙混过去。
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");
const code = tsx.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** 只取选择器文本（每个 { 前面那段），避免类名出现在声明值里也被当成「写过样式」 */
const selectorText = [...css.matchAll(/([^{}]+)\{/g)].map((match) => match[1]).join("\n");

/** 取某个类的规则体（media 里的重复定义会被拼在一起），用于「这个类里有没有某条声明」的断言 */
function ruleBodies(source, className) {
  const bodies = [];
  const pattern = new RegExp(`\\.${className}\\s*(?:[,:][^{]*)?\\{([^}]*)\\}`, "g");
  for (const match of source.matchAll(pattern)) bodies.push(match[1]);
  return bodies.join("\n");
}

test("资本计划仍给出可解释的分档与情景，且分档口径来自诊断内核", async () => {
  const source = await readFile(componentUrl, "utf8");
  // 五个处置分档与四种情景是这一页的核心产出，改口径来源不等于可以少给结论。
  // 标题去掉了原来的「3—5 年」：这一页只做风险排序和情景测算，没有按年分期，
  // 顶着一个页面兑现不了的时间跨度反而是虚的。
  for (const requiredText of [
    "资本计划",
    "必须替换",
    "计划替换",
    "可延寿",
    "共享调拨",
    "评分依据",
  ]) {
    assert.match(source, new RegExp(requiredText));
  }
  assert.match(source, /riskScore/);
  assert.match(source, /maintenanceRatio/);
  // 四种情景的名字现在只在内核里定义一次，页面遍历 SCENARIO_MODES 渲染。
  // 页面里再硬写一遍「不行动/维修延寿/…」就等于又开了第二处口径，正是这次要消灭的东西。
  assert.match(source, /SCENARIO_MODES/);
  assert.match(source, /scenarioFor\(/);
  const kernel = await readFile(new URL("../app/benefit-diagnosis.ts", import.meta.url), "utf8");
  for (const mode of ["不行动", "维修延寿", "更新替换", "共享调拨"]) {
    assert.match(kernel, new RegExp(mode), `内核缺少处置情景「${mode}」`);
  }
});

test("页面上不再出现中英夹杂的 scenario 字样", () => {
  // 实测截图里这块标题写的是「处置 scenario 情景比较」，是本次要修的缺陷。
  // 判定方式：在剥掉注释的代码里禁「独立成词」的 scenario——
  // 标识符里的 scenarioFor / SCENARIO_MODES / styles.scenarioGrid 不受影响，
  // 而混进中文标题的那个 scenario 一定是独立单词。注释里回顾被删掉的旧函数名不算缺陷。
  assert.doesNotMatch(code, /(?<![A-Za-z0-9_$])scenario(?![A-Za-z0-9_$])/i, "代码里仍有独立成词的 scenario");
  assert.doesNotMatch(tsx, /处置\s*scenario/i, "中英夹杂的旧标题还在");
  assert.match(code, /处置情景比较/);
});

test("自有的 classify() 和 scenario() 已删除，口径全部来自诊断内核", () => {
  // 这一页、改进中心、alert-rules 各算一套时，同一台设备会在不同页面得出相反结论，
  // 院长照着哪一页拍板都可能是错的。所以本页只允许展示内核结果。
  assert.doesNotMatch(code, /function\s+classify\b/, "本地 classify() 还在");
  assert.doesNotMatch(code, /function\s+scenario\b/, "本地 scenario() 还在");
  assert.doesNotMatch(code, /(?<![A-Za-z0-9_$.])classify\(/, "还有人在调用本地 classify()");
  assert.match(code, /import \{ SCENARIO_MODES, scenarioFor \} from "\.\/benefit-diagnosis";/);
  // 分档、风险分、象限一律直接读内核结果，不在本页重新判定
  assert.match(code, /item\.band/);
  assert.match(code, /selected\.band/);
  assert.match(code, /selected\.riskScore/);
  assert.match(code, /selected\.quadrant/);
});

test("不再从 mock-data 取 netBenefit / roi / totalCost", () => {
  // 这三个是台账年度汇总口径，跟按设备×期间的填报数据对不上；混用会造出第二份数。
  assert.doesNotMatch(tsx, /from "\.\/mock-data"/, "还在 import mock-data");
  assert.doesNotMatch(code, /netBenefit/, "还在使用旧口径 netBenefit");
  assert.doesNotMatch(code, /totalCost/, "还在使用旧口径 totalCost");
  assert.doesNotMatch(code, /(?<![A-Za-z0-9_$.])roi\(/, "还在使用旧口径 roi()");
});

test("金额口径是元，页面正文不出现旧的万元口径", () => {
  // 内核给的 investment / margin / annualImpact 已经换算成元，页面只加千分位。
  // 注释里解释换算规则是必要的，所以断言前先剥注释，只看会渲染出去的文本。
  assert.doesNotMatch(code, /万/, "页面正文仍在用旧的万元口径");
  assert.ok(code.includes("} 元`"), "金额没有带「元」单位");
  assert.match(code, /本期结余\(元\)/);
  assert.match(code, /更新替换投入\(元\)/);
  // investment 走同一个元口径的格式化函数，不再被当成万元直出
  assert.match(code, /moneyText\(facts\.investment\)/);
  assert.match(code, /moneyText\(outcome\.investment\)/);
});

test("缺数显示「—」，绝不把 null 当 0 参与计算", () => {
  // 论证材料里编一个 0 比留白危险得多：0 会被直接求和，空白至少还能被看见。
  assert.ok(code.includes('value === null ? "—"'), "金额/比率缺数没有显示破折号");
  assert.match(code, /outcome\.annualImpact === null/, "情景卡没有处理年影响缺数");
  assert.match(code, /本期没有填报数据，估不出年影响/, "年影响为空时没有写明缺数原因");
  // 指标类字段一律不允许 ?? 0 / || 0 兜底（分档计数那种天然为 0 的除外）
  assert.doesNotMatch(
    code,
    /(revenue|cost|margin|utilization|maintenanceRatio|annualImpact|paybackYears|integrity|examVolume)\s*(\?\?|\|\|)\s*0/,
    "有指标字段把缺数兜成了 0",
  );
  // 导出 CSV 时缺数也是空单元格，不是 0
  assert.match(code, /facts\.utilization === null \? "" : facts\.utilization/);
  assert.match(code, /facts\.margin === null \? "" : facts\.margin/);
});

test("findings 的 evidence 真的渲染出来了", () => {
  // 分档不给证据，在预算会上一句话就被问倒；标签只有名字等于没依据。
  assert.match(code, /title=\{finding\.evidence\}/, "表格标签没有把 evidence 挂到 hover 上");
  assert.match(code, /\{finding\.evidence\}/, "详情里没有逐条列出 evidence");
  assert.match(code, /\{finding\.title\}/);
  assert.match(code, /\{finding\.suggestion\}/);
  // hover 出证据的标签要给 help 光标，否则没人知道能悬停
  assert.match(ruleBodies(css, "tag"), /cursor:\s*help/);
});

test("四种处置情景来自 SCENARIO_MODES，不是硬编码三种", () => {
  // 旧版只有「不行动/维修延寿/更新替换」三种，共享调拨被漏在外面，
  // 而调拨恰恰是「先盘活存量再采购」的关键选项。模式清单必须由内核给。
  assert.match(code, /SCENARIO_MODES\.map\(\(mode\) => scenarioFor\(selected, mode\)\)/);
  assert.doesNotMatch(code, /\[\s*"不行动"/, "还在本页硬编码情景模式数组");
  assert.doesNotMatch(code, /as const\)\.map\(\(mode\)/, "还在用本地常量元组当情景清单");
});

test("每张情景卡都带 caveat", () => {
  // 这些数是管理侧估算，正式立项要换成财务确认值；卡片不带这句就会被当成预算依据用出去。
  assert.match(code, /\{outcome\.caveat\}/);
  assert.match(code, /className=\{styles\.caveat\}/);
  assert.match(code, /\{outcome\.note\}/);
  assert.match(code, /\{outcome\.riskChange\}/);
});

test("focusDeviceId 用惰性初值消费，并回调 onFocusConsumed", () => {
  // 从效益分析页/改进中心点「送资本论证」跳进来，要直接选中那台设备。
  // 必须走惰性初值：在 effect 里 setSelectedId 会多一次级联渲染，仓库的 eslint 也会拦。
  assert.match(code, /useState\(\(\) => \{/, "选中态没有用惰性初值");
  assert.match(code, /focusDeviceId && diagnoses\.some\(\(item\) => item\.facts\.deviceId === focusDeviceId\)/);
  assert.match(code, /scrollIntoView\(/, "没有滚动到焦点设备那一行");
  assert.match(code, /onFocusConsumed\?\.\(\)/);
  const effect = code.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[focusDeviceId, onFocusConsumed\]\);/);
  assert.ok(effect, "没找到消费 focusDeviceId 的一次性 effect");
  assert.doesNotMatch(effect[1], /setSelectedId|setState/, "effect 里同步 setState 会造成级联渲染");
  assert.match(effect[1], /focusHandled\.current/, "effect 没有做一次性保护");
});

test("优先级表按 riskScore 降序", () => {
  // 这一页的全部意义就是「先看谁最危险」，排序错了整页就白做。
  assert.match(code, /\.sort\(\(left, right\) => right\.riskScore - left\.riskScore\)/);
  // 排序发生在筛选之前：搜索和分档筛选只做减法，不能打乱名次
  assert.ok(code.indexOf("right.riskScore - left.riskScore") < code.indexOf("const filtered ="));
});

test("组件签名与平台接线契约一致", () => {
  // 这几个 prop 由 EquipmentPlatform 接线，名字对不上就是编译不过。
  for (const prop of ["diagnoses", "periodLabel", "onSelectDevice", "focusDeviceId", "onFocusConsumed", "canManage", "notify"]) {
    assert.match(code, new RegExp(`\\b${prop}\\b`), `缺少 prop ${prop}`);
  }
  assert.match(code, /diagnoses: DeviceDiagnosis\[\];/);
  assert.match(code, /notify: \(message: string, tone\?: "info" \| "error"\) => void;/);
  assert.match(code, /onSelectDevice\(facts\.deviceId\)/);
  // periodLabel 是期间口径，页头必须写出来，否则读者不知道这批结论对应哪一期
  assert.match(code, /期间口径 \{periodLabel\}/);
});

test("页面四块结构齐全：页头 / 概览卡 / 优先级表 / 详情与情景", () => {
  assert.match(code, /战略资产管理/);
  assert.match(code, /<h1>资本计划<\/h1>/);
  // 边界声明必须留在页头右上：这一页给的是花钱的建议，不是审批结论
  assert.match(code, /管理建议，不替代临床安全与预算审批/);
  for (const band of ["必须替换", "计划替换", "共享调拨", "可延寿", "持续观察"]) {
    assert.match(code, new RegExp(band), `分档 ${band} 没出现`);
  }
  assert.match(code, /更新预算情景合计/);
  assert.match(code, /设备更新优先级/);
  assert.match(code, /处置情景比较/);
  // 搜索与分档筛选：几百台设备靠翻页找不现实
  assert.match(code, /placeholder="搜索设备名称 \/ 资产编号 \/ 科室"/);
  assert.match(code, /aria-label="处置分档筛选"/);
});

test("宽表在自己容器里横滚，页面主体不横滚，且不引图表库", () => {
  // 主体一旦横滚，左侧导航和页头会一起跑出视野；图表库是离线部署红线，风险条只能用 CSS 画。
  assert.match(ruleBodies(css, "tableWrap"), /overflow-x:\s*auto/);
  assert.doesNotMatch(ruleBodies(css, "root"), /overflow-x/);
  assert.doesNotMatch(ruleBodies(css, "layout"), /overflow-x/);
  assert.doesNotMatch(tsx, /recharts|echarts|chart\.js/i, "引入了图表库");
  assert.match(ruleBodies(css, "riskTrack"), /height:\s*4px/);
});

test("CSS 里不存在小于 12px 的字号", () => {
  // 平台硬性规定：医院端很多是 1366×768 的老机器加中年用户，11px 中文在那种屏上糊成一团。
  const sizes = [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((match) => match[1].trim());
  assert.ok(sizes.length > 0, "没扫到任何 font-size，正则或文件不对");
  for (const size of sizes) {
    assert.match(size, /^\d+(\.\d+)?px$/, `字号只允许写死 px，发现「${size}」`);
    assert.ok(Number.parseFloat(size) >= 12, `字号 ${size} 小于 12px`);
  }
});

test("颜色全部走主题变量，不写死十六进制", () => {
  // 深色主题（theme-midnight）只换变量不换样式表，写死一个色值在深色下就是一块斑。
  // rgba() 半透明阴影是例外：它叠在底色上，跟着主题走。
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "CSS Module 里出现了写死的十六进制颜色");
  assert.match(css, /var\(--surface\)/);
  assert.match(css, /var\(--primary-soft\)/);
  assert.match(css, /var\(--red\)/);
});

test("组件用到的每个 styles.xxx 都在 CSS Module 里有定义", () => {
  // 少一个类页面就塌一块，而且塌得静悄悄（className 变成 undefined，元素直接裸奔）。
  const used = [...new Set([...tsx.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))];
  assert.ok(used.length >= 40, `styles.xxx 抓取异常，只抓到 ${used.length} 个`);
  const missing = used.filter((name) => !new RegExp(`\\.${name}(?![A-Za-z0-9_-])`).test(selectorText));
  assert.deepEqual(missing, [], `以下类在 CapitalPlanningCenter.module.css 里没有定义：${missing.join("、")}`);
});
