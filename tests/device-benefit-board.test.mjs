import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 全部是静态源码断言：单机效益看板是 "use client" 组件，import 进来要拖一整套 DOM 环境，
// 而隔壁 EquipmentPlatform.tsx / MetricCockpit* 可能正被并行改动——
// 真去渲染它，会把别人的进度变成本文件的假红灯。
const tsx = await readFile(new URL("../app/DeviceBenefitBoard.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/DeviceBenefitBoard.module.css", import.meta.url), "utf8");

/** 去掉注释：注释里的中文说明和示例不该被当成真实代码扫进断言。 */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const tsxCode = stripComments(tsx);
const cssNoComments = stripComments(css);

/** 把 css 拆成「选择器 + 声明块」，keyframes 内部的帧不算规则。 */
const ruleBlocks = (source) => {
  const rules = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ selector: match[1].trim(), body: match[2] });
  return rules;
};

/** prefers-reduced-motion 降级块的正文。 */
const reduceBlock = (() => {
  const marker = "@media (prefers-reduced-motion: reduce)";
  const from = cssNoComments.indexOf(marker);
  if (from < 0) return "";
  let depth = 0;
  let index = cssNoComments.indexOf("{", from);
  const start = index;
  for (; index < cssNoComments.length; index += 1) {
    if (cssNoComments[index] === "{") depth += 1;
    if (cssNoComments[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return cssNoComments.slice(start + 1, index);
})();

test("tsx 里引用的样式类在 module.css 里都有定义", () => {
  // CSS Modules 找不到的类名会静默变成 undefined：页面不报错，只是排版塌掉、动画不播，
  // 新建一页时最容易漏的就是「类写了一半」。
  const used = [...new Set([...tsx.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))];
  assert.ok(used.length >= 60, `样式类引用数量异常（只扫到 ${used.length} 个），正则可能没扫到`);
  const defined = new Set([...cssNoComments.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]));
  const missing = used.filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], `module.css 缺少这些类定义：${missing.join("、")}`);
});

test("样式表没有小于 12px 的字号", () => {
  // 平台硬约束：本页会投在会议室大屏和护士站的老显示器上，11px 的中文在那儿就是一团灰。
  const declarations = [...cssNoComments.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.ok(declarations.length >= 15, "字号声明数量异常，正则可能没扫到");
  for (const value of declarations) {
    const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
    // 只许用 px：em/rem 会被父级缩放，静态断言就守不住这条下限了
    assert.ok(px, `module.css 用了非 px 字号：${value}`);
    assert.ok(Number(px[1]) >= 12, `module.css 出现 ${value} 字号，低于 12px 下限`);
  }
  // SVG 里的刻度、图例和圆心汇总字号绕开了 CSS，同样要守住
  for (const match of tsx.matchAll(/fontSize=\{([^}]+)\}/g)) {
    for (const literal of match[1].match(/\d+(?:\.\d+)?/g) ?? []) {
      assert.ok(Number(literal) >= 12, `图表 SVG 出现 ${literal}px 字号，低于 12px 下限`);
    }
  }
});

test("样式表不写死颜色，一律走主题变量", () => {
  // 写死的色值在深色主题下不会跟着翻转，一块惨白的卡片糊在深色页面上会亮瞎眼。
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  // rgba() 只允许用在阴影上：阴影是半透明黑，深浅主题通用，没有对应的主题变量
  for (const match of cssNoComments.matchAll(/[a-z-]+:[^;]*\brgba?\([^)]*\)/g)) {
    assert.match(match[0], /^box-shadow:/, `rgba 只允许出现在阴影里：${match[0]}`);
  }
  // 常见的裸色名同样算写死
  assert.doesNotMatch(cssNoComments, /:\s*(?:white|black|red|blue|green|orange|purple|gray|grey)\s*[;}]/);
  // 图表里的颜色也全部取自变量，包括环形图的取色槽位
  assert.match(tsx, /const PIE_SLOT_COLORS = \[\s*"var\(--primary\)",/);
  for (const match of tsx.matchAll(/(?:fill|stroke)="([^"]+)"/g)) {
    assert.ok(match[1].startsWith("var(--") || match[1] === "none", `图表里出现写死的颜色：${match[1]}`);
  }
});

test("不引任何图表库或动画库，只用 react、图标库和本仓库模块", () => {
  // 平台是纯离线部署（医院内网 + 腾讯云私有化），引 CDN 图表库会直接白屏；
  // package.json 里还躺着 recharts，更要盯死这条线，别顺手 import 进来。
  const sources = [...tsx.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(sources.length >= 4, "import 数量异常，正则可能没扫到");
  for (const source of sources) {
    assert.ok(
      source.startsWith("./") || source.startsWith("../") || source === "react" || source === "lucide-react",
      `引入了计划外的外部依赖：${source}`,
    );
  }
  for (const banned of [/\brecharts\b/i, /\becharts\b/i, /\bframer-motion\b/i, /\bgsap\b/i, /react-spring/i, /from\s+"d3(-[a-z]+)?"/]) {
    assert.doesNotMatch(tsx, banned, `引入了被禁的库：${banned}`);
  }
  // 动态 import 一样会被打包进去，一并堵掉
  assert.doesNotMatch(tsx, /import\(\s*["']/);
  // 图表必须是手写 SVG，五种图型一个都不能少
  for (const fn of ["StatChart", "BarChart", "LineChart", "PieChart", "TableChart"]) {
    assert.match(tsx, new RegExp(`function ${fn}\\(`), `缺少 ${fn} 渲染函数`);
  }
});

test("取数范围钉死在单台设备，不会算成全院或科室口径", () => {
  // 本页回答的就是「这一台设备的账」。范围一旦退回汇总口径，
  // 卡片上的数会变成全院合计却挂在一台设备的档案里，比空着危险得多。
  assert.match(tsx, /const scope: CockpitScope = \{ level: "device", deviceId: selectedDeviceId \};/);
  assert.doesNotMatch(tsxCode, /level:\s*"(hospital|department)"/);
  // 算数走公共的 computeChartSeries，口径与驾驶舱同一处定义，不在本页另写一套
  assert.match(tsx, /computeChartSeries\(\{ \.\.\.template, groupBy: groupByFor\(item\.chartKind, template\) \}, scope, computeCtx\)/);
});

test("未接入口径的指标走「未接入」空态，绝不用 0 冒充", () => {
  // 17 条指标里有 4 条（部位数、工作饱和度、完好率、维修响应）当前填报口径算不出来。
  // 给它们编一个 0 或近似值，等于拿一个没人认过的数去汇报。
  assert.match(tsx, /const binding = METRIC_VALUE_BINDINGS\[item\.entryId\] \?\? null;/);
  assert.match(tsx, /const series = binding && template\s*\n\s*\? computeChartSeries\(/);
  assert.match(tsx, /:\s*null;/);
  assert.match(tsx, /\} else if \(!series\) \{\s*\n\s*body = <UnavailableCard reason="尚未接入填报口径" \/>;/);
  assert.match(tsx, /function UnavailableCard\(\{ reason \}: \{ reason: string \}\)/);
  // 空态里只有徽标和原因文案，没有任何数字
  const card = tsx.slice(tsx.indexOf("function UnavailableCard("), tsx.indexOf("function BoardCard("));
  assert.doesNotMatch(card, /formatValue|formatNumber|\b0\b/);
});

test("缺数一律显示「—」，不把 null 当 0 相加", () => {
  // 补 0 会让「还没填报」看起来像「本期真的没有收入」，这种假数拿去汇报要出事。
  assert.match(tsx, /return value === null \? "—" : formatNumber\(value\);/);
  // 关键事实缺数时连单位都不带，避免出现「— 元」这种半截读数
  assert.match(tsx, /\{cell\.value === null \? null : <small className=\{styles\.factUnit\}>\{cell\.unit\}<\/small>\}/);
  // 量程只由有数的点决定：把 null 当 0 参与 max/min 会压扁整张图，还让人以为那一期是 0
  assert.match(tsx, /const values = points\.filter\(\(point\) => point\.value !== null\)\.map\(\(point\) => point\.value as number\);/);
  assert.doesNotMatch(tsxCode, /\?\?\s*0\b/, "出现了把缺数兜底成 0 的写法");
  // 折线遇到缺数要断线，不能连成一条假趋势
  assert.match(tsx, /if \(point\.value === null\) \{/);
});

test("编辑态下卡片可拖拽换位，四件套齐全", () => {
  // dragover 不 preventDefault，浏览器不认这是可放置区域，drop 根本不会触发——
  // 表现是「能拖起来但放不下」，最难查的一种拖拽 bug。
  assert.match(tsx, /draggable=\{Boolean\(editor\)\}/);
  assert.match(tsx, /onDragStart=\{editor \? \(\) => editor\.onDragStart\(item\.entryId\) : undefined\}/);
  assert.match(tsx, /onDragEnd=\{editor \? \(\) => editor\.onDragEnd\(\) : undefined\}/);
  assert.match(tsx, /onDragOver=\{editor \? \(event\) => event\.preventDefault\(\) : undefined\}/);
  assert.match(tsx, /onDrop=\{editor \? \(event\) => \{ event\.preventDefault\(\); editor\.onDrop\(item\.entryId\); \} : undefined\}/);
  // 换位是交换两张卡的 order，拖到谁就跟谁换位，与驾驶舱配置一个手感
  const drop = tsx.slice(tsx.indexOf("function dropOnItem("), tsx.indexOf("function cycleSize("));
  assert.match(drop, /if \(item\.entryId === source\.entryId\) return \{ \.\.\.item, order: target\.order \};/);
  assert.match(drop, /if \(item\.entryId === target\.entryId\) return \{ \.\.\.item, order: source\.order \};/);
  assert.match(drop, /onConfigChange\(\{/);
});

test("换图型、切尺寸、移除都通过 onConfigChange 写回", () => {
  // 本页只负责改配置对象，持久化在平台层。任何一处忘了回调，用户改完刷新就白改了。
  assert.match(tsx, /function updateItem\(entryId: string, patch: Partial<MetricCockpitItem>\) \{\s*\n\s*onConfigChange\(\{/);
  assert.match(tsx, /onChartKind: \(entryId, kind\) => updateItem\(entryId, \{ chartKind: kind \}\)/);
  // 尺寸是 small → medium → wide 的循环，取模回到头，不会卡在通栏
  assert.match(tsx, /const SIZE_SEQUENCE: MetricCockpitItem\["size"\]\[\] = \["small", "medium", "wide"\];/);
  assert.match(tsx, /SIZE_SEQUENCE\[\(SIZE_SEQUENCE\.indexOf\(item\.size\) \+ 1\) % SIZE_SEQUENCE\.length\]/);
  const remove = tsx.slice(tsx.indexOf("function removeItem("), tsx.indexOf("/* ------", tsx.indexOf("function removeItem(")));
  assert.match(remove, /onConfigChange\(\{ \.\.\.config, items: config\.items\.filter\(\(item\) => item\.entryId !== entryId\) \}\)/);
  // 指标清单勾选同样写回：勾上是新增一张卡，取消是移除
  const toggle = tsx.slice(tsx.indexOf("function toggleEntry("), tsx.indexOf("function dropOnItem("));
  assert.match(toggle, /onConfigChange\(\{ \.\.\.config, items: config\.items\.filter/);
  assert.match(toggle, /onConfigChange\(\{ \.\.\.config, items: \[\.\.\.config\.items, makeItem\(entry\.id, nextOrder, templates\)\] \}\)/);
});

test("本期没有填报数据时给引导，不画一堆零值图表", () => {
  // 没填报的设备所有指标都是缺数，硬渲染出来就是一屏「—」和空图，
  // 用户看不出该干什么；这时唯一有用的动作是去补数。
  assert.match(tsx, /\{facts\.hasReport === false \? \(/);
  assert.match(tsx, /onClick=\{\(\) => onOpenReporting\(facts\.deviceId\)\}/);
  assert.match(tsx, /本期没有填报数据/);
  assert.match(tsx, /去填报/);
  // 引导态下整块看板不渲染
  assert.match(tsx, /\{facts\.hasReport === false \? null : \(/);
  // 设备清单上也用状态点提前标出来，免得一台台点进去才发现没数
  assert.match(tsx, /device\.hasReport \? `\$\{styles\.deviceDot\} \$\{styles\.dotOn\}` : `\$\{styles\.deviceDot\} \$\{styles\.dotOff\}`/);
});

test("每张图表 SVG 都带 role 与 aria-label", () => {
  // 读屏器把没有 role 的内联 SVG 当装饰跳过，图上的数字对视障用户就彻底消失了。
  const svgTags = [...tsx.matchAll(/<svg\b[\s\S]*?>/g)].map((match) => match[0]);
  assert.equal(svgTags.length, 4, "图表 SVG 数量与预期不符（横向条形、纵向柱、折线、环形各一）");
  for (const tag of svgTags) {
    assert.match(tag, /role="img"/);
    assert.match(tag, /aria-label=\{aria\}/);
  }
  // aria-label 要说清「哪个指标、什么图、多少组、什么单位」，光有 role 等于只报「图片」
  assert.equal((tsx.match(/const aria = `/g) ?? []).length, 3);
  // 纯装饰的色点、抓手不能被读出来
  assert.match(tsx, /className=\{styles\.legendDot\}[^>]*aria-hidden/);
  assert.match(tsx, /className=\{styles\.cardGrip\} aria-hidden/);
});

test("编辑开关受 canManage 门控，没权限连开关都不出现", () => {
  // 没有配置权限的人不该改看板；把开关藏起来还不够，
  // 权限被收回时已经打开的编辑态也要立刻失效，所以编辑态由「有权限 且 开着开关」共同决定。
  assert.match(tsx, /const editorOn = canManage && editing;/);
  assert.match(tsx, /\{canManage \? \(\s*\n\s*<button\s*\n\s*type="button"\s*\n\s*role="switch"/);
  assert.match(tsx, /aria-checked=\{editing\}/);
  // 卡片上的操作角标和指标清单都只在编辑态注入
  assert.match(tsx, /editor=\{editorOn \? \{/);
  assert.match(tsx, /\{editorOn \? \(\s*\n\s*<aside className=\{styles\.picker\}>/);
  // 权限没了不靠 effect 把 state 改回去：本仓库 eslint 把「effect 里同步 setState」判为 error
  assert.equal((tsx.match(/useEffect\(/g) ?? []).length, 1, "只应有数字滚动一处 effect");
  assert.match(tsx, /return \(\) => cancelAnimationFrame\(frame\);/);
});

test("组件签名与平台接线约定一致", () => {
  // 这一串 props 是平台层接线时按名字传的，少一个或改名字都会让接线处静默拿到 undefined。
  // 从组件起点往后找参数块的收尾，不能直接 indexOf("}: {")：
  // 前面的 BoardCard 也是这个写法，会先命中它、把签名切成空串。
  const signatureFrom = tsx.indexOf("export default function DeviceBenefitBoard({");
  const signature = tsx.slice(signatureFrom, tsx.indexOf("}: {", signatureFrom));
  assert.ok(signature.length > 0, "没有定位到组件签名，正则或锚点可能变了");
  for (const prop of [
    "diagnoses", "entries", "categories", "templates", "ctx", "config", "onConfigChange",
    "periodLabel", "selectedDeviceId", "onSelectDevice", "canManage", "notify", "onOpenReporting",
  ]) {
    assert.match(signature, new RegExp(`\\n  ${prop},`), `组件签名缺少 ${prop}`);
  }
  // 配置类型直接用驾驶舱那一份，单机看板不另造一套配置结构
  assert.match(tsx, /config: MetricCockpitConfigState;/);
  assert.match(tsx, /onConfigChange: \(next: MetricCockpitConfigState\) => void;/);
});

test("正式口径开关跟着看板配置走，与驾驶舱同一条规则", () => {
  // ctx 带的只是页面默认值；配置里选了「仅已确认」，本页就不能把草稿算进去——
  // 同一台设备在驾驶舱和这里算出两个数，报表被质询时说不清以哪个为准。
  assert.match(tsx, /\(\) => \(\{ \.\.\.ctx, onlyConfirmed: config\.onlyConfirmed \}\)/);
  assert.match(tsx, /\[ctx, config\.onlyConfirmed\]/);
  // 当前口径要写在档案头上，看数的人得知道这批数含不含草稿
  assert.match(tsx, /\{config\.onlyConfirmed \? "仅已确认" : "含草稿"\}/);
});

test("设备选择器能按设备名、资产编号、科室搜索", () => {
  // 医院里找设备的三种说法：叫得出名字、报得出资产编号、只记得在哪个科室。
  assert.match(tsx, /\[item\.facts\.name, item\.facts\.assetCode, item\.facts\.department, item\.facts\.model\]/);
  assert.match(tsx, /\.some\(\(part\) => \(part \?\? ""\)\.toLowerCase\(\)\.includes\(text\)\)\)/);
  assert.match(tsx, /placeholder="设备名称 \/ 资产编号 \/ 科室"/);
  // 设备多的医院有几百台：列表自己滚，页面主体不跟着长高
  assert.match(cssNoComments, /\.deviceList \{[^}]*overflow-y: auto;/s);
  // 宽内容（明细表）在自己的容器里横滚，页面主体不横向滚
  assert.match(cssNoComments, /\.tableWrap \{[^}]*overflow: auto;/s);
});

test("每一处动画都有 prefers-reduced-motion 降级", () => {
  // 前庭功能障碍的用户看见满屏平移、缩放和脉冲会真的头晕；系统开关必须一票否决所有动效。
  assert.ok(reduceBlock.length > 0, "module.css 里没有 prefers-reduced-motion 降级块");
  assert.match(reduceBlock, /animation:\s*none/);
  assert.match(reduceBlock, /transition:\s*none/);
  assert.match(reduceBlock, /transform:\s*none/);
  const reduceClasses = new Set([...reduceBlock.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]));
  const animated = new Set();
  for (const rule of ruleBlocks(cssNoComments.split("@media (prefers-reduced-motion: reduce)")[0])) {
    if (!/(^|[\s;])(animation|transition):/.test(rule.body)) continue;
    for (const match of rule.selector.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) animated.add(match[1]);
  }
  assert.ok(animated.size >= 6, `动画类数量异常（只扫到 ${animated.size} 个），正则可能没扫到`);
  const uncovered = [...animated].filter((name) => !reduceClasses.has(name));
  assert.deepEqual(uncovered, [], `这些类有动效但没在 reduce 块里降级：${uncovered.join("、")}`);
  // 入场错峰用 CSS 变量按序号传，不给每张卡拼 inline 的 animation-delay 字符串
  assert.match(tsx, /style=\{\{ "--i": Math\.min\(index, STAGGER_MAX_INDEX\) \}/);
  assert.match(cssNoComments, /animation-delay:\s*calc\(var\(--i, 0\) \* \d+ms\)/);
});

test("单机看板的卡片高度可比：标题单行省略、大数字按长度分档换字号", async () => {
  const [tsx, css] = await Promise.all([
    readFile(new URL("../app/DeviceBenefitBoard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/DeviceBenefitBoard.module.css", import.meta.url), "utf8"),
  ]);
  // 钳两行时「医院设备总结余（设备盈余）」占两行、旁边「医院设备总使用率」占一行，
  // 同一行卡片一高一矮，卡里的大数字跟着上下错位。
  assert.doesNotMatch(css, /line-clamp/, "指标名又钳成多行了，同一行卡片会高矮不齐");
  assert.match(css, /\.cardTitle \{[^}]*white-space: nowrap/);
  assert.match(css, /\.cardTitle \{[^}]*text-overflow: ellipsis/);
  // 名字被截了要能悬浮看全，否则「医院设备总…」三张卡长得一样
  assert.match(tsx, /className=\{styles\.cardTitle\} title=\{name\}/);

  // 大数字：nowrap 防「8,381,4 / 00 元」这种拦腰折断
  assert.match(css, /\.statValue \{[^}]*white-space: nowrap/);
  // 分档字号必须写成 NNpx 字面量，下面这条 ≥12px 的硬下限才守得住
  const sizes = [...css.matchAll(/\.statValue(?:Md|Sm|Xs) \{ font-size: (\d+)px; \}/g)].map((m) => Number(m[1]));
  assert.equal(sizes.length, 3, "缺少 Md/Sm/Xs 三档字号");
  for (const size of sizes) assert.ok(size >= 12, `字号 ${size}px 低于 12px 硬下限`);
  // 档位依据必须是终值：跟着滚动中的中间值换档，数字会一边滚一边变大小
  assert.match(tsx, /const finalText = series\.total === null \? "—" : formatValue\(series\.total\);/);
  assert.match(tsx, /statSizeClass\(finalText\)/);
});
