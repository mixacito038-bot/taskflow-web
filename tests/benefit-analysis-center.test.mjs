import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 纯静态源码断言（不 import .tsx，本仓库的测试跑在 node 上，没有 JSX 运行时也没有 DOM）：
// 「类有没有写、字号有没有超标、图表库有没有偷偷混进来、缺数会不会被补成 0」
// 这些都是源码层面就能钉死的红线，钉住它们比不测强得多。
const tsx = await readFile(new URL("../app/BenefitAnalysisCenter.tsx", import.meta.url), "utf8");
const cssRaw = await readFile(new URL("../app/BenefitAnalysisCenter.module.css", import.meta.url), "utf8");
// 注释里会提到类名和 px 数值（比如解释为什么覆盖全局 .admin-stats），
// 不剥掉的话「类写没写」「字号超没超标」都可能被一句注释蒙混过去。
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");
// 同理：TSX 的注释里会写「不补 0」「不引图表库」这类字样，断言前先剥掉，免得自证清白。
const code = tsx.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** 只取选择器文本（每个 { 前面那段），避免类名出现在声明值里也被当成「写过样式」 */
const selectorText = [...css.matchAll(/([^{}]+)\{/g)].map((match) => match[1]).join("\n");

test("组件用到的每个 styles.xxx 都在 CSS Module 里有定义", () => {
  // 少一个类页面就塌一块，而且塌得静悄悄（className 变成 undefined，元素直接裸奔）。
  const used = [...new Set([...tsx.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))];
  assert.ok(used.length >= 30, `styles.xxx 抓取异常，只抓到 ${used.length} 个`);
  const missing = used.filter((name) => !new RegExp(`\\.${name}(?![A-Za-z0-9_-])`).test(selectorText));
  assert.deepEqual(missing, [], `以下类在 BenefitAnalysisCenter.module.css 里没有定义：${missing.join("、")}`);
});

test("CSS 里不存在小于 12px 的字号", () => {
  // 平台硬性规定：医院端很多是 1366×768 的老机器加中年用户，11px 中文在那种屏上糊成一团。
  const sizes = [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((match) => match[1].trim());
  assert.ok(sizes.length > 0, "没扫到任何 font-size，正则或文件不对");
  for (const size of sizes) {
    assert.match(size, /^\d+(\.\d+)?px$/, `字号只允许写死 px，发现「${size}」`);
    assert.ok(Number.parseFloat(size) >= 12, `字号 ${size} 小于 12px`);
  }
  // SVG 里的字号写在属性上（fontSize={12}），CSS 扫不到，一并检查一遍
  const svgSizes = [...tsx.matchAll(/fontSize=\{(\d+(?:\.\d+)?)\}/g)].map((match) => Number.parseFloat(match[1]));
  assert.ok(svgSizes.length > 0, "SVG 里没扫到 fontSize");
  for (const size of svgSizes) assert.ok(size >= 12, `SVG 字号 ${size} 小于 12px`);
});

test("颜色全部走主题变量，不写死十六进制", () => {
  // 深色主题（theme-midnight）只换变量不换样式表，写死一个 #fff 卡片在深色下就是一块白斑。
  // rgba() 半透明阴影是例外：它叠在底色上，跟着主题走。
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "CSS Module 里出现了写死的十六进制颜色");
  // SVG 的 fill / stroke 直接写在 JSX 属性上，同样不许出现裸色值
  assert.doesNotMatch(code, /(?:fill|stroke|background)="#[0-9a-fA-F]{3,8}"/, "SVG 里出现了写死的十六进制颜色");
  assert.match(css, /var\(--surface\)/);
  assert.match(css, /var\(--primary-soft\)/);
});

test("没有引入任何图表库：离线部署红线", () => {
  // 医院内网装不了 CDN、也不许临时 npm i：图表全部手写 SVG。
  // 逐条核对 import 来源，只放行 react / lucide-react / 相对路径。
  const sources = [...tsx.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(sources.length >= 3, `没扫到 import，只有 ${sources.length} 条`);
  for (const source of sources) {
    const allowed = source === "react" || source === "lucide-react" || source.startsWith("./") || source.startsWith("../");
    assert.ok(allowed, `不允许的依赖来源：${source}`);
  }
  // 动态 import 会绕开上面的静态核对，直接堵死
  assert.doesNotMatch(code, /\bimport\s*\(/, "出现了动态 import()");
  assert.doesNotMatch(code, /require\s*\(/, "出现了 require()");
  // 手写 SVG 的实锤：两张图都在源码里画元素，而不是丢给组件
  assert.match(tsx, /<svg /);
  assert.match(tsx, /<circle/);
  assert.match(tsx, /<rect/);
});

test("两张图都带 role=\"img\" 和 aria-label", () => {
  // 屏幕阅读器读不出一堆 <circle>；没有 aria-label 的图对读屏用户等于不存在。
  const svgTags = [...tsx.matchAll(/<svg [^>]*>/g)].map((match) => match[0]);
  assert.equal(svgTags.length, 2, `预期 2 张手写图（四象限散点 + 科室结余条形），实际 ${svgTags.length} 张`);
  for (const tag of svgTags) {
    assert.match(tag, /role="img"/, `SVG 缺 role="img"：${tag}`);
    assert.match(tag, /aria-label=/, `SVG 缺 aria-label：${tag}`);
    // viewBox 自适应宽度，不写死 width/height 属性
    assert.match(tag, /viewBox=/, `SVG 缺 viewBox：${tag}`);
  }
});

test("四象限的参考线取诊断内核的阈值，不是抄一个数字", () => {
  // 阈值改了图必须跟着改。写死 60 之后，内核调到 55，图上那条线就开始骗人。
  assert.match(code, /DEFAULT_DIAGNOSIS_THRESHOLDS\.utilizationFloor/);
  assert.match(code, /const floor = DEFAULT_DIAGNOSIS_THRESHOLDS\.utilizationFloor;/);
  // 竖线画在 xOf(floor)、横线画在 yOf(0)：两条线分出四格
  assert.match(code, /const floorX = xOf\(floor\);/);
  assert.match(code, /const zeroY = yOf\(0\);/);
  assert.match(code, /x1=\{floorX\}/);
  assert.match(code, /y1=\{zeroY\}/);
});

test("缺数显示「—」，绝不补 0 也绝不估算", () => {
  // 补 0 会让「没填数据」和「真的一分钱没赚」长得一模一样，医院据此拍板换设备就出事了。
  assert.match(code, /value === null \? "—"/);
  assert.match(code, /margin === null/);
  assert.match(code, /utilization === null \|\| margin === null/);
  // 把 null 当 0 参与计算的两种典型写法，一条都不许有
  assert.doesNotMatch(code, /\?\?\s*0\b/, "出现了 ?? 0：缺数被当成 0");
  assert.doesNotMatch(code, /\|\|\s*0\b/, "出现了 || 0：缺数被当成 0");
  assert.doesNotMatch(code, /Number\(\s*\w+\s*\)\s*\|\|/, "出现了 Number(x) || 兜底");
});

test("三个跳转回调都被真正调用，不是只挂在签名上", () => {
  // 这一页的价值就在「看到问题能直接派出去」；回调只声明不调用，页面就退化成一张海报。
  assert.match(code, /onCreateAction\(deviceId, finding\)/);
  assert.match(code, /onSendToCapital\(deviceId\)/);
  assert.match(code, /onOpenReporting\(deviceId\)/);
  // 补数清单里的「去填报」也要真的跳
  assert.match(code, /onOpenReporting\(item\.facts\.deviceId\)/);
  // 设备名点进单机分析
  assert.match(code, /onOpenDevice\(facts\.deviceId\)/);
  assert.match(code, /onOpenDevice\(point\.diagnosis\.facts\.deviceId\)/);
});

test("按钮按 finding.route 分发，三个去向都在", () => {
  // 一台设备可能同时挂着「使用率不足」（去改进）和「回本滞后」（去资本论证），
  // 笼统一个按钮等于让人在下一页再猜一次到底处理哪条问题。
  const dispatch = code.slice(code.indexOf("function dispatchFinding"), code.indexOf("function sortedFindings"));
  assert.ok(dispatch.length > 0, "没找到 dispatchFinding");
  assert.match(dispatch, /switch \(finding\.route\)/);
  assert.match(dispatch, /case "improvement":/);
  assert.match(dispatch, /case "capital":/);
  assert.match(dispatch, /case "data":/);
  // 按钮逐条 finding 渲染，而不是每台设备一个
  assert.match(code, /findings\.map\(\(finding, index\) => \(canManage \?/);
  assert.match(code, /ROUTE_LABELS\[finding\.route\]/);
  // 没有 cost.manage 时按钮变只读说明
  assert.match(code, /ROUTE_READONLY\[finding\.route\]/);
  assert.match(code, /styles\.readonlyAction/);
});

test("待补数设备不进散点图，改走右侧补数清单", () => {
  // 它们没有坐标，画进去就等于替设备编一个使用率和结余。
  assert.match(code, /if \(item\.quadrant === "待补数"\) continue;/);
  assert.match(code, /if \(utilization === null \|\| margin === null\) continue;/);
  assert.match(code, /diagnoses\.filter\(\(item\) => item\.quadrant === "待补数"\)/);
  assert.match(code, /待补数 \{pendingDevices\.length\} 台/);
});

test("问题清单按风险分从高到低排", () => {
  // 第一屏就该是最该处理的那几台，否则这张表还得让人自己扫一遍找重点。
  assert.match(code, /matched\.sort\(\(a, b\) => b\.riskScore - a\.riskScore\)/);
  // 清单只放触发了阈值的设备
  assert.match(code, /if \(item\.findings\.length === 0\) return false;/);
  // 没有触发阈值时的空态
  assert.match(code, /ledger-empty/);
  assert.match(code, /本期没有触发阈值的设备/);
});

test("四象限、科室对比、问题清单三块的筛选与口径开关都接上了", () => {
  // 象限卡点了要能筛下面的清单，否则四个数字只是装饰。
  assert.match(code, /setQuadrantFilter\(quadrantFilter === quadrant \? "all" : quadrant\)/);
  assert.match(code, /quadrantFilter !== "all" && item\.quadrant !== quadrantFilter/);
  assert.match(code, /codeFilter !== "all"/);
  assert.match(code, /severityFilter !== "all"/);
  // 正式口径开关：改的是上层的统计口径，本页只负责翻转并说清楚翻到了哪一档
  assert.match(code, /onOnlyConfirmedChange\(next\)/);
  assert.match(code, /role="switch"/);
  assert.match(code, /aria-checked=\{onlyConfirmed\}/);
  // 期间口径要写在页面上，否则读者不知道这批数是哪几个月的
  assert.match(code, /\{periodLabel\}/);
});

test("表格与科室图共用诊断内核排好的顺序，横滚只发生在容器内部", () => {
  // 内核已按结余升序排好（缺数垫底），页面再排一遍就会和内核的口径打架，
  // 而且表和图一旦各排各的，读者会以为看到的是两批数据。
  assert.match(code, /const rollups = useMemo\(\(\) => departmentRollup\(diagnoses\), \[diagnoses\]\);/);
  assert.doesNotMatch(code, /\[\.\.\.rollups\]\.sort/, "页面又给科室重排了一次");
  assert.match(code, /<DepartmentMarginChart rows=\{rollups\.map/);
  assert.match(code, /\{rollups\.map\(\(row\) => \(/);
  // 宽表走全局 .table-scroll，图走模块的 .chartScroll，页面主体不横滚
  assert.match(code, /className="table-scroll"/);
  const chartScroll = css.slice(css.indexOf(".chartScroll"));
  assert.match(chartScroll.slice(0, 200), /overflow-x:\s*auto/);
  assert.doesNotMatch(css, /overflow-x:\s*scroll/);
});

test("风险分进度条按内核的 0—100 量纲画，分档线和内核对齐", () => {
  // 按「全院最高分」归一化会让 40 分的设备顶满进度条，看着像最危险的那台；
  // riskScore 内核已封顶到 100，直接用绝对量纲，60 分这条线跟 bandOf 的「计划替换」一致。
  assert.match(code, /Math\.min\(100, Math\.max\(0, item\.riskScore\)\)/);
  assert.match(code, /item\.riskScore >= 60 \? "var\(--red\)"/);
  assert.doesNotMatch(code, /maxRisk/, "又按全院最高分归一化了");
});

test("页面不再含「文件采集」那一套词", () => {
  // 这一页是效益分析，不是数据治理：采集契约、模板、来源文件由数据准备中心和指标字典负责，
  // 词一旦回来，页面就会又长回那个没人看的模板清单。
  for (const word of ["采集合同", "最小事件数据集", "来源文件", "文件模板", "采集与分析"]) {
    assert.ok(!tsx.includes(word), `页面出现了文件采集那套词：${word}`);
  }
  // 反过来，效益分析该有的骨架必须在
  for (const word of ["效益分析", "效益四象限", "科室对比", "问题设备清单"]) {
    assert.ok(tsx.includes(word), `缺少效益分析的核心区块：${word}`);
  }
});
