import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 全部为静态源码断言：看板是 "use client" 组件，import 进来要拖一整套 DOM 环境，
// 而隔壁 EquipmentPlatform.tsx 可能正被并行改动——那会把别人的进度变成本文件的假红灯。
const tsx = await readFile(new URL("../app/MetricCockpitBoard.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/MetricCockpitBoard.module.css", import.meta.url), "utf8");
const configTsx = await readFile(new URL("../app/MetricCockpitConfig.tsx", import.meta.url), "utf8");

/** 去掉 /* *\/ 注释：注释里的示例代码和中文说明不该被当成真实声明扫进断言。 */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const cssNoComments = stripComments(css);

/** prefers-reduced-motion 降级块的正文（可能有多个，全部拼起来）。 */
const reduceBlocks = (() => {
  const blocks = [];
  const marker = "@media (prefers-reduced-motion: reduce)";
  let from = cssNoComments.indexOf(marker);
  while (from >= 0) {
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
    blocks.push(cssNoComments.slice(start + 1, index));
    from = cssNoComments.indexOf(marker, index);
  }
  return blocks;
})();

/** 把 css 拆成「选择器 + 声明块」，keyframes 内部的帧不算规则。 */
const ruleBlocks = (source) => {
  const rules = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
};

test("tsx 里引用的样式类在 module.css 里都有定义", () => {
  // CSS Modules 找不到的类名会静默变成 undefined：页面不报错，只是排版塌掉、动画不播，
  // 拆分时最容易漏的就是「类搬了一半」。
  const used = [...new Set([...tsx.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))];
  assert.ok(used.length >= 35, "样式类引用数量异常，正则可能没扫到");
  const defined = new Set([...cssNoComments.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]));
  const missing = used.filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], `module.css 缺少这些类定义：${missing.join("、")}`);
});

test("样式表没有小于 12px 的字号", () => {
  // 驾驶舱经常投在会议室大屏或护士站的老显示器上，11px 的中文在那儿就是一团灰。
  const declarations = [...cssNoComments.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.ok(declarations.length >= 8, "字号声明数量异常，正则可能没扫到");
  for (const value of declarations) {
    const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
    // 只许用 px：em/rem 会被父级放大缩小，静态断言就守不住这条下限了
    assert.ok(px, `module.css 用了非 px 字号：${value}`);
    assert.ok(Number(px[1]) >= 12, `module.css 出现 ${value} 字号，低于 12px 下限`);
  }
  // SVG 里的刻度和图例字号绕开了 CSS，同样要守住
  for (const match of tsx.matchAll(/fontSize=\{([^}]+)\}/g)) {
    for (const literal of match[1].match(/\d+(?:\.\d+)?/g) ?? []) {
      assert.ok(Number(literal) >= 12, `图表 SVG 出现 ${literal}px 字号，低于 12px 下限`);
    }
  }
});

test("样式表不写死颜色，一律走主题变量", () => {
  // 写死的色值在深色主题下不会跟着翻转，一块惨白的卡片糊在深色页面上会亮瞎眼。
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(tsx, /(fill|stroke|background|color)="#[0-9a-fA-F]{3,8}"/);
  // rgba() 只允许用在阴影上：阴影是半透明黑，深浅主题通用，没有主题变量可依
  for (const match of cssNoComments.matchAll(/[a-z-]+:[^;]*\brgba?\([^)]*\)/g)) {
    assert.match(match[0], /^box-shadow:/, `rgba 只允许出现在阴影里：${match[0]}`);
  }
  // 常见的裸色名同样是写死
  assert.doesNotMatch(cssNoComments, /:\s*(?:white|black|red|blue|green|orange|purple|gray|grey)\s*[;}]/);
  // 图表里的颜色也全部取自变量，包括环形图的取色槽位
  assert.match(tsx, /const PIE_SLOT_COLORS = \[\s*"var\(--primary\)",/);
  for (const match of tsx.matchAll(/(?:fill|stroke)="([^"]+)"/g)) {
    assert.ok(match[1].startsWith("var(--") || match[1] === "none", `图表里出现写死的颜色：${match[1]}`);
  }
});

test("不引任何外部图表库或动画库", () => {
  // 平台是纯离线部署（医院内网 + 腾讯云私有化），引 CDN 图表库会直接白屏。
  // package.json 里躺着 recharts，更要盯死这条线，别顺手 import 进来。
  assert.doesNotMatch(tsx, /\brecharts\b/i);
  assert.doesNotMatch(tsx, /\becharts\b/i);
  assert.doesNotMatch(tsx, /\bframer-motion\b/i);
  assert.doesNotMatch(tsx, /\bgsap\b/i);
  assert.doesNotMatch(tsx, /react-spring/i);
  assert.doesNotMatch(tsx, /from\s+"d3(-[a-z]+)?"/);
  // 逐条核 import 来源：只允许 react、图标库和本仓库相对路径
  const sources = [...tsx.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(sources.length >= 3);
  for (const source of sources) {
    assert.ok(
      source.startsWith("./") || source.startsWith("../") || source === "react" || source === "lucide-react",
      `引入了计划外的外部依赖：${source}`,
    );
  }
  // 动态 import 同样会打包进去，一并堵掉
  assert.doesNotMatch(tsx, /import\(\s*["']/);
});

test("五种图表渲染器都还在，且都是手写 SVG", () => {
  // 拆分不是改功能：五个渲染器一个都不能在搬家路上掉了，掉一个就会掉进兜底分支画错图。
  for (const fn of ["StatChart", "BarChart", "LineChart", "PieChart", "TableChart"]) {
    assert.match(tsx, new RegExp(`function ${fn}\\(`), `缺少 ${fn} 渲染函数`);
  }
  const dispatch = tsx.slice(tsx.indexOf("let body: React.ReactNode;"), tsx.indexOf("<div\n      ref={cardRef}"));
  assert.match(dispatch, /item\.chartKind === "stat"[\s\S]*<StatChart/);
  assert.match(dispatch, /item\.chartKind === "bar"[\s\S]*<BarChart/);
  assert.match(dispatch, /item\.chartKind === "line"[\s\S]*<LineChart/);
  assert.match(dispatch, /item\.chartKind === "pie"[\s\S]*<PieChart/);
  assert.match(dispatch, /\} else \{\s*body = <TableChart/);
  // 环形图的取色槽位有限，超出就并成「其他」；循环取色会出现两个同色扇区，图例对不上号
  assert.match(tsx, /const PIE_MAX_SLICES = PIE_SLOT_COLORS\.length/);
  assert.match(tsx, /label: "其他"/);
});

test("每张图表 SVG 都带 role 与 aria-label", () => {
  // 读屏器把没有 role 的内联 SVG 当装饰跳过，图上的数字对视障用户就彻底消失了。
  const svgTags = [...tsx.matchAll(/<svg\b[\s\S]*?>/g)].map((match) => match[0]);
  assert.equal(svgTags.length, 4, "图表 SVG 数量与预期不符（条形、纵向柱、折线、环形各一）");
  for (const tag of svgTags) {
    assert.match(tag, /role="img"/);
    assert.match(tag, /aria-label=\{aria\}/);
  }
  // aria-label 要说清「哪个指标、什么图、多少组、什么单位」，光有 role 等于只报「图片」
  assert.equal((tsx.match(/const aria = `/g) ?? []).length, 3);
  // 纯装饰的色点、脉冲层不能被读出来
  assert.match(tsx, /className=\{styles\.legendDot\}[^>]*aria-hidden/);
  assert.match(tsx, /className=\{styles\.freshPulse\} aria-hidden/);
});

test("每一处动画都有 prefers-reduced-motion 降级", () => {
  // 前庭功能障碍的用户看见满屏平移、缩放和脉冲会真的头晕；系统开关必须一票否决所有动效。
  assert.ok(reduceBlocks.length >= 1, "module.css 里没有 prefers-reduced-motion 降级块");
  const reduceText = reduceBlocks.join("\n");
  const reduceClasses = new Set([...reduceText.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]));
  // 降级块自己要真的关掉动效，只写个空块等于没写
  assert.match(reduceText, /animation:\s*none/);
  assert.match(reduceText, /transition:\s*none/);
  assert.match(reduceText, /transform:\s*none/);
  // 逐条核对：凡是声明了 animation / transition 的类，都要在降级块里被点名
  const animated = new Set();
  for (const rule of ruleBlocks(cssNoComments.split("@media (prefers-reduced-motion: reduce)")[0])) {
    if (!/(^|[\s;])(animation|transition):/.test(rule.body)) continue;
    for (const match of rule.selector.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) animated.add(match[1]);
  }
  assert.ok(animated.size >= 6, `动画类数量异常（只扫到 ${animated.size} 个），正则可能没扫到`);
  const uncovered = [...animated].filter((name) => !reduceClasses.has(name));
  assert.deepEqual(uncovered, [], `这些类有动效但没在 reduce 块里降级：${uncovered.join("、")}`);
  // 入场错峰用 CSS 变量按 index 传，不给每张卡拼 inline 的 animation-delay 字符串
  assert.match(tsx, /style=\{\{ "--i": Math\.min\(index, STAGGER_MAX_INDEX\) \}/);
  assert.match(cssNoComments, /animation-delay:\s*calc\(var\(--i, 0\) \* \d+ms\)/);
});

test("数字滚动用 requestAnimationFrame，并且卸载时取消", () => {
  // 不 cancel 的话，卡片被移除后回调还在 setState，控制台一片警告，帧也白烧。
  const hook = tsx.slice(tsx.indexOf("function useCountUp("), tsx.indexOf("/* ---", tsx.indexOf("function useCountUp(")));
  assert.match(hook, /requestAnimationFrame\(/);
  assert.match(hook, /return \(\) => cancelAnimationFrame\(frame\);/);
  // 从「当前显示值」接着滚，而不是每次都退回 0：连续刷新时才不会一惊一乍地跳回零
  assert.match(hook, /const from = fromRef\.current;/);
  assert.match(hook, /fromRef\.current = value;/);
  // 减少动效时直接给终值，不进 rAF
  assert.match(hook, /if \(target === null \|\| reduceMotion\) return;/);
});

test("缺数不滚动，直接落到「—」", () => {
  // 滚动的中间帧全是「看起来像真数」的数字，缺数卡片滚一串出来会被当成真实结果拿去汇报。
  assert.match(tsx, /return value === null \? "—" : formatNumber\(value\);/);
  const stat = tsx.slice(tsx.indexOf("function StatChart("), tsx.indexOf("function BarChart("));
  assert.match(stat, /\{series\.total === null \? "—" : formatValue\(rolled\)\}/);
  // null 分支必须挡在滚动之前：hook 里也得直接返回，不能让 rAF 拿 null 去算
  assert.match(tsx, /if \(target === null\) return 0;/);
  assert.match(stat, /本期暂无可统计数据/);
});

test("大屏轮播的定时器有清理", () => {
  // 不清定时器：切页面之后它还在跑，回来时几个定时器叠着走，焦点乱跳还漏内存。
  const hook = tsx.slice(tsx.indexOf("function useSpotlight("), tsx.indexOf("export function MetricCockpitBoard("));
  assert.match(hook, /const timer = setInterval\(/);
  assert.match(hook, /return \(\) => clearInterval\(timer\);/);
  // 暂停/恢复：鼠标移入看板就停，不然用户想细看的那张卡自己跑了
  assert.match(tsx, /onMouseEnter=\{rotating \? spotlight\.pause : undefined\}/);
  assert.match(tsx, /onMouseLeave=\{rotating \? spotlight\.resume : undefined\}/);
  assert.match(hook, /if \(!enabled \|\| paused \|\| count < 2 \|\| rotateMs <= 0\) return;/);
});

test("轮播只在正式展示态生效，配置页预览不自转", () => {
  // 预览里卡片自己转起来，用户根本点不中要改的那张——editor 一传就必须关掉轮播。
  assert.match(tsx, /rotateMs\?: number;/);
  assert.match(tsx, /const rotating = !editor && \(rotateMs \?\? 0\) > 0 && items\.length > 1;/);
  assert.match(tsx, /const spotlight = useSpotlight\(items\.length, rotateMs \?\? 0, rotating\);/);
  // 焦点态与其余卡片的降透明度都由看板统一下发，卡片自己不猜
  assert.match(tsx, /spotlight=\{spotlight\.index === index\}/);
  assert.match(tsx, /dimmed=\{spotlight\.index >= 0 && spotlight\.index !== index\}/);
  // reduce 下只切高亮不做缩放
  assert.match(reduceBlocks.join("\n"), /\.card\.cardSpotlight/);
});

test("动画只在数据真的变化时重放", () => {
  // CSS 动画只有重新挂载才会重播：拿数据指纹当 key，父组件因为别的状态重渲染时指纹不变，
  // 整块看板就不会莫名其妙抖一下。
  assert.match(tsx, /function seriesSignature\(series: ChartSeries \| null, suffix: string\): string/);
  assert.match(tsx, /<span key=\{seriesSignature\(series, item\.chartKind\)\} className=\{styles\.freshPulse\}/);
  for (const kind of ["bar", "line", "pie"]) {
    assert.ok(tsx.includes(`seriesSignature(series, "${kind}")`), `${kind} 图没有按数据指纹重放绘制动画`);
  }
  assert.equal((tsx.match(/<g key=\{drawKey\}>/g) ?? []).length, 4, "四张 SVG 的绘制层都要挂 drawKey");
});

test("配置页仍然 re-export 看板，且不再自己定义它", () => {
  // 正式驾驶舱页一直是 `import MetricCockpitConfig, { MetricCockpitBoard } from "./MetricCockpitConfig"`，
  // 断了这条 re-export，正式页会整块白掉。
  assert.match(configTsx, /import \{ GROUP_BY_LABELS, MetricCockpitBoard, type BoardEditorHooks \} from "\.\/MetricCockpitBoard";/);
  assert.match(configTsx, /export \{ MetricCockpitBoard \};/);
  assert.match(configTsx, /export type \{ BoardEditorHooks \};/);
  // 拆干净：配置页里不能再留第二份定义，两份渲染器迟早各自漂移
  assert.doesNotMatch(configTsx, /export function MetricCockpitBoard\(/);
  assert.doesNotMatch(configTsx, /function BoardCard\(/);
  for (const fn of ["StatChart", "BarChart", "LineChart", "PieChart", "TableChart"]) {
    assert.doesNotMatch(configTsx, new RegExp(`function ${fn}\\(`), `配置页里还留着 ${fn}`);
  }
  // 预览仍然用同一个渲染器，且只有一个调用点
  assert.equal((configTsx.match(/<MetricCockpitBoard\s/g) ?? []).length, 1);
  assert.ok(configTsx.indexOf("<h3>当前布局预览</h3>") < configTsx.indexOf("<MetricCockpitBoard"));
});

test("拆分后功能不缩水：拖拽、图型切换、尺寸与空态都还在", () => {
  // 「拆完必须和拆之前一模一样」——这条是拆分的验收线，逐个钩子核对。
  assert.match(tsx, /draggable=\{Boolean\(editor\)\}/);
  assert.match(tsx, /onDragStart=\{editor \? \(\) => editor\.onDragStart\(item\.entryId\) : undefined\}/);
  assert.match(tsx, /onDragOver=\{editor \? \(event\) => event\.preventDefault\(\) : undefined\}/);
  assert.match(tsx, /onDrop=\{editor \? \(\) => editor\.onDrop\(item\.entryId\) : undefined\}/);
  assert.match(tsx, /onDragEnd=\{editor \? \(\) => editor\.onDragEnd\(\) : undefined\}/);
  assert.match(tsx, /const CHART_KINDS = Object\.keys\(CHART_KIND_LABELS\) as ChartKind\[\]/);
  assert.match(tsx, /editor\.onChartKind\(item\.entryId, kind\)/);
  assert.match(tsx, /aria-pressed=\{kind === item\.chartKind\}/);
  assert.match(tsx, /const items = \[\.\.\.config\.items\]\.sort\(\(left, right\) => left\.order - right\.order\)/);
  // 三种「没数」都在图表分支之前拦下，任何一种漏了都会掉进图表分支画出 0
  const dispatch = tsx.slice(tsx.indexOf("let body: React.ReactNode;"), tsx.indexOf("<div\n      ref={cardRef}"));
  assert.ok(dispatch.indexOf("series.unavailable") < dispatch.indexOf('item.chartKind === "stat"'));
  assert.match(dispatch, /if \(!entry\) \{\s*body = <UnavailableCard/);
  assert.match(dispatch, /\} else if \(!series\) \{\s*body = <UnavailableCard/);
  assert.match(tsx, /const series = binding && template \? computeChartSeries\(template, scope, computeCtx\) : null;/);
  assert.equal((tsx.match(/本期各分组均无数据/g) ?? []).length, 3);
});
