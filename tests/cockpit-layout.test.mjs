import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 全部为静态源码断言：看板和配置页都是 "use client" 组件，import 进来要拖一整套 DOM 环境；
// 而隔壁 EquipmentPlatform.tsx / globals.css 正被并行改动，那会把别人的进度变成本文件的假红灯。
// 真实排版（折行、卡片等高、横向溢出）已经用 playwright 在 1920/1560/1440/1280/1024/768 六个宽度实测过，
// 这里守的是「那些修法还在源码里」，防的是以后有人顺手改回去。
const boardTsx = await readFile(new URL("../app/MetricCockpitBoard.tsx", import.meta.url), "utf8");
const boardCss = await readFile(new URL("../app/MetricCockpitBoard.module.css", import.meta.url), "utf8");
const configTsx = await readFile(new URL("../app/MetricCockpitConfig.tsx", import.meta.url), "utf8");
const configCss = await readFile(new URL("../app/MetricCockpitConfig.module.css", import.meta.url), "utf8");

/** 去掉 /* *\/ 注释：注释里写的是「为什么」，里面的示例数字和类名不该被当成真实声明扫进断言。 */
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const boardCssBare = stripComments(boardCss);
const configCssBare = stripComments(configCss);

/** prefers-reduced-motion 降级块的正文（可能有多个，全部拼起来）。 */
const reduceBlocks = (source) => {
  const blocks = [];
  const marker = "@media (prefers-reduced-motion: reduce)";
  let from = source.indexOf(marker);
  while (from >= 0) {
    let depth = 0;
    let index = source.indexOf("{", from);
    const start = index;
    for (; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(source.slice(start + 1, index));
    from = source.indexOf(marker, index);
  }
  return blocks;
};

/** 把 css 拆成「选择器 + 声明块」，keyframes 内部的帧不算规则。 */
const ruleBlocks = (source) => {
  const rules = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
};

/** 取某个类的声明块正文；同名多条（如 .a 和 .a.b）时只取选择器完全相等的那条。 */
const declarationsOf = (source, selector) => {
  const rule = ruleBlocks(source).find((item) => item.selector === selector);
  assert.ok(rule, `样式表里找不到 ${selector} 这条规则`);
  return rule.body;
};

test("大数字按内容长度自适应字号，且分档依据是终值不是滚动中的中间值", () => {
  // 用户看到的「94,114,7 / 75 元」就是一个字号包不住 4~14 个字符造成的：
  // 医院收入 8~11 位，带千分位就是 10~14 个字符，而最窄的小卡只有 ~180px 能写字。
  assert.match(boardTsx, /function statSizeClass\(text: string\): string \{/);
  assert.match(boardTsx, /if \(text\.length >= 12\) return styles\.statValueXs;/);
  assert.match(boardTsx, /if \(text\.length >= 10\) return styles\.statValueSm;/);
  assert.match(boardTsx, /if \(text\.length >= 7\) return styles\.statValueMd;/);
  // 分档必须看终值：跟着滚动中的中间值换档，数字会一边滚一边变大小，比折行还晃眼
  assert.match(boardTsx, /const finalText = series\.total === null \? "—" : formatValue\(series\.total\);/);
  assert.match(boardTsx, /statSizeClass\(finalText\)/);
  assert.doesNotMatch(boardTsx, /statSizeClass\(formatValue\(rolled\)\)/);
  // 三档在两种尺寸下都要成立：正式看板一套，compact 预览再小一档
  for (const cls of ["statValueMd", "statValueSm", "statValueXs"]) {
    assert.match(boardCssBare, new RegExp(`\\.${cls} \\{ font-size: \\d+px; \\}`), `缺少 .${cls} 档位字号`);
    assert.match(boardCssBare, new RegExp(`\\.statValueCompact\\.${cls} \\{ font-size: \\d+px; \\}`), `compact 下缺少 .${cls} 档位字号`);
  }
});

test("大数字绝不折行，单位也不会被甩到下一行", () => {
  // overflow-wrap: anywhere 允许从任意字符断开，正是「94,114,7 / 75 元」的成因；
  // 单位是 .statValue 的子节点，父级 nowrap 一起管住，不会被单独甩下去。
  const stat = declarationsOf(boardCssBare, ".statValue");
  assert.match(stat, /white-space:\s*nowrap;/);
  assert.doesNotMatch(stat, /overflow-wrap/);
  // 滚动时每一帧数字宽度都在变，没有 tabular-nums 整块会跟着抖
  assert.match(stat, /font-variant-numeric:\s*tabular-nums;/);
  // 兜底：真遇到超出预估的长数，宁可省略号也不许溢到邻居卡片上
  assert.match(stat, /text-overflow:\s*ellipsis;/);
  assert.match(stat, /overflow:\s*hidden;/);
  // 省略了还能悬浮看全
  assert.match(boardTsx, /title=\{series\.total === null \? undefined : `\$\{finalText\}\$\{unit\}`\}/);
  // 单位仍旧只在有数时才渲染，缺数卡片不许冒出一个孤零零的「元」
  assert.match(boardTsx, /\{series\.total !== null && unit \? <small className=\{styles\.statUnit\}>\{unit\}<\/small> : null\}/);
});

test("卡片标题单行省略 + title 悬浮出全名，同一行卡片才等高", () => {
  // 窄卡里钳两行会让「医院设备总收/入」两行、「台均服务人次」一行，同一行卡片高度参差，
  // 正是用户说的「上上下下很奇怪」。
  const title = declarationsOf(boardCssBare, ".cardTitle");
  assert.match(title, /white-space:\s*nowrap;/);
  assert.match(title, /text-overflow:\s*ellipsis;/);
  assert.match(title, /overflow:\s*hidden;/);
  assert.doesNotMatch(title, /line-clamp/);
  assert.match(boardTsx, /<strong className=\{styles\.cardTitle\} title=\{name\}>\{name\}<\/strong>/);
  // 卡片仍旧整列拉伸对齐，否则同一行里内容少的那张会缩水
  assert.match(declarationsOf(boardCssBare, ".board"), /align-items:\s*stretch;/);
});

test("看板栅格用 auto-fit + minmax 自动排列，通栏卡仍占满整行", () => {
  // 钉死 4 列时预览里每张小卡只剩 150px；改成按可用宽度自己算列数，
  // 同一份栅格在 ~700px 的预览里排 3 列、在 ~1100px 的正式看板里排 4~5 列。
  const board = declarationsOf(boardCssBare, ".board");
  assert.match(board, /grid-template-columns:\s*repeat\(auto-(?:fit|fill),\s*minmax\(\d+px,\s*1fr\)\);/);
  // dense 让后面的小卡回填被中卡 / 通栏卡挤出来的空位，不再「一行 3 张 + 空一格」
  assert.match(board, /grid-auto-flow:\s*row dense;/);
  // 列数是算出来的，通栏卡再写 span 4 就不是通栏了
  assert.match(boardCssBare, /\.cardWide \{ grid-column: 1 \/ -1; \}/);
  assert.match(boardCssBare, /\.cardMedium \{ grid-column: span 2; \}/);
  const minmax = Number(/minmax\((\d+)px/.exec(board)[1]);
  // 下限量过：再窄就装不下「14 个字符 + 人次」这一行数字
  assert.ok(minmax >= 180 && minmax <= 240, `栅格列宽下限 ${minmax}px 超出实测可用区间`);
});

test("右栏是独立的一列并且 sticky，模板库已从左栏底部搬到右栏", () => {
  // 左栏（维度 + 指标清单）天生比右栏长，不 sticky 的话勾到清单下半截时预览已经滚出视口，
  // 用户得滚上去看一眼再滚回来——这正是「上上下下很奇怪」。
  const column = declarationsOf(configCssBare, ".previewColumn");
  assert.match(column, /position:\s*sticky;/);
  assert.match(column, /align-self:\s*start;/);
  // topbar 高 64px 且自身 sticky，贴上去会被压住
  const top = Number(/top:\s*(\d+)px;/.exec(column)[1]);
  assert.ok(top > 64, `右栏 sticky 的 top=${top}px 会钻到 64px 高的 topbar 底下`);
  // 撑高不是解法：给右栏灌 min-height 只是把空白换个地方摆
  assert.doesNotMatch(column, /min-height/);
  // 结构上：预览和模板库是右栏的两块，左栏只剩维度和指标清单
  assert.match(configTsx, /<div className=\{styles\.previewColumn\}>/);
  const right = configTsx.slice(configTsx.indexOf('<div className={styles.previewColumn}>'), configTsx.indexOf("{confirmPreset ?"));
  assert.ok(right.includes("<h3>当前布局预览</h3>"), "预览面板不在右栏里");
  assert.ok(right.includes("模板库"), "模板库没有搬到右栏");
  const left = configTsx.slice(configTsx.indexOf('<div className={styles.sideColumn}>'), configTsx.indexOf('<div className={styles.previewColumn}>'));
  assert.ok(left.includes("<h3>维度</h3>") && left.includes("<h3>指标清单</h3>"), "左栏丢了维度或指标清单");
  assert.ok(!left.includes(">\n                  模板库"), "模板库还留在左栏");
  // 单列断点下再 sticky 就是把预览钉在屏幕上挡住下面的模板库
  assert.match(configCssBare, /@media \(max-width: 1100px\)[\s\S]*?\.previewColumn \{\s*position:\s*static;/);
});

test("sticky 的右栏内部限高滚动，不会长到视口之外", () => {
  // 模板库展开有十几条，右栏一旦比视口还高，sticky 之后底下几条就再也滚不到了。
  assert.match(declarationsOf(configCssBare, ".templateList"), /max-height:\s*\d+px;[\s\S]*overflow-y:\s*auto;/);
  // 左栏的指标清单本来就是这个规矩，两边一致
  assert.match(declarationsOf(configCssBare, ".metricList"), /max-height:\s*\d+px;[\s\S]*overflow-y:\s*auto;/);
});

test("两个样式表都没有小于 12px 的字号", () => {
  // 驾驶舱经常投在会议室大屏或护士站的老显示器上，11px 的中文在那儿就是一团灰。
  // 这也是不用 clamp() / 容器查询做自适应字号的原因：静态断言只认得 `NNpx` 字面量。
  for (const [name, sheet] of [["MetricCockpitBoard", boardCssBare], ["MetricCockpitConfig", configCssBare]]) {
    const declarations = [...sheet.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim());
    assert.ok(declarations.length >= 8, `${name} 的字号声明数量异常，正则可能没扫到`);
    for (const value of declarations) {
      const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
      assert.ok(px, `${name} 用了非 px 字号：${value}`);
      assert.ok(Number(px[1]) >= 12, `${name} 出现 ${value} 字号，低于 12px 下限`);
    }
  }
  // SVG 里的刻度和图例字号绕开了 CSS，同样要守住
  for (const match of boardTsx.matchAll(/fontSize=\{([^}]+)\}/g)) {
    for (const literal of match[1].match(/\d+(?:\.\d+)?/g) ?? []) {
      assert.ok(Number(literal) >= 12, `图表 SVG 出现 ${literal}px 字号，低于 12px 下限`);
    }
  }
});

test("两个样式表都不写死颜色，一律走主题变量", () => {
  // 写死的色值在深色主题下不会跟着翻转，一块惨白的卡片糊在深色页面上会亮瞎眼。
  for (const [name, sheet, bare] of [
    ["MetricCockpitBoard", boardCss, boardCssBare],
    ["MetricCockpitConfig", configCss, configCssBare],
  ]) {
    assert.doesNotMatch(sheet, /#[0-9a-fA-F]{3,8}\b/, `${name} 出现裸十六进制色值`);
    // rgba() 只允许用在阴影上：阴影是半透明黑，深浅主题通用，没有主题变量可依
    for (const match of bare.matchAll(/[a-z-]+:[^;]*\brgba?\([^)]*\)/g)) {
      assert.match(match[0], /^box-shadow:/, `${name} 里 rgba 只允许出现在阴影：${match[0]}`);
    }
    assert.doesNotMatch(bare, /:\s*(?:white|black|red|blue|green|orange|purple|gray|grey)\s*[;}]/, `${name} 用了裸色名`);
  }
  // 新加的档位字号只改大小，颜色仍旧继承 .statValue 的 var(--text)
  assert.match(declarationsOf(boardCssBare, ".statValue"), /color:\s*var\(--text\);/);
});

test("排版返工没弄坏任何一处动画", () => {
  // 入场错峰、数字滚动、图表绘制、刷新脉冲、轮播高亮——排版是排版，动效一个都不许掉。
  assert.match(boardCssBare, /animation: cardIn .* backwards;/);
  assert.match(boardCssBare, /animation-delay:\s*calc\(var\(--i, 0\) \* \d+ms\)/);
  assert.match(boardTsx, /style=\{\{ "--i": Math\.min\(index, STAGGER_MAX_INDEX\) \}/);
  for (const name of ["cardIn", "freshPulse", "barGrow", "barRise", "lineDraw", "softIn", "pieSweep"]) {
    assert.match(boardCssBare, new RegExp(`@keyframes ${name}\\b`), `少了 ${name} 关键帧`);
  }
  assert.match(boardTsx, /requestAnimationFrame\(/);
  assert.match(boardTsx, /return \(\) => cancelAnimationFrame\(frame\);/);
  assert.match(boardCssBare, /\.card\.cardSpotlight \{[^}]*transform: scale\(/);
  // 动画靠数据指纹当 key 重播，父组件因为别的状态重渲染时不许满屏乱闪
  assert.match(boardTsx, /<span key=\{seriesSignature\(series, item\.chartKind\)\}/);
});

test("每一处动效都还在 prefers-reduced-motion 里降级", () => {
  // 前庭功能障碍的用户看见满屏平移、缩放和脉冲会真的头晕；新增的类同样要被这一票否决覆盖。
  const blocks = reduceBlocks(boardCssBare);
  assert.ok(blocks.length >= 1, "MetricCockpitBoard.module.css 里没有 prefers-reduced-motion 降级块");
  const reduceText = blocks.join("\n");
  assert.match(reduceText, /animation:\s*none/);
  assert.match(reduceText, /transition:\s*none/);
  assert.match(reduceText, /transform:\s*none/);
  const covered = new Set([...reduceText.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]));
  const animated = new Set();
  for (const rule of ruleBlocks(boardCssBare.split("@media (prefers-reduced-motion: reduce)")[0])) {
    if (!/(^|[\s;])(animation|transition):/.test(rule.body)) continue;
    for (const match of rule.selector.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) animated.add(match[1]);
  }
  assert.ok(animated.size >= 6, `动画类数量异常（只扫到 ${animated.size} 个），正则可能没扫到`);
  const uncovered = [...animated].filter((name) => !covered.has(name));
  assert.deepEqual(uncovered, [], `这些类有动效但没在 reduce 块里降级：${uncovered.join("、")}`);
});

test("两个 module.css 各自和自己的 tsx 配对，styles.xxx 零缺失", () => {
  // 按文件各自配对检查：拼起来查会掩盖「A 文件用的类定义在 B 的样式表里」这种其实不生效的情况
  // （CSS Module 是按文件局部作用域的）。找不到的类名会静默变成 undefined：页面不报错，只是排版塌掉。
  for (const [name, source, sheet] of [
    ["MetricCockpitBoard", boardTsx, boardCssBare],
    ["MetricCockpitConfig", configTsx, configCssBare],
  ]) {
    const used = [...new Set([...source.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))];
    assert.ok(used.length >= 10, `${name} 没扫到足够的 styles.xxx，正则可能失效了`);
    const defined = new Set([...sheet.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]));
    const missing = used.filter((cls) => !defined.has(cls));
    assert.deepEqual(missing, [], `${name} 缺少样式定义：${missing.join("、")}`);
  }
});

test("排版返工没有引入任何外部库", () => {
  // 平台是纯离线部署（医院内网 + 腾讯云私有化），引 CDN 图表 / 动画库会直接白屏。
  for (const [name, source] of [["MetricCockpitBoard", boardTsx], ["MetricCockpitConfig", configTsx]]) {
    const sources = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(sources.length >= 3, `${name} 没扫到 import，正则可能失效了`);
    for (const from of sources) {
      assert.ok(
        from.startsWith("./") || from.startsWith("../") || from === "react" || from === "lucide-react",
        `${name} 引入了计划外的外部依赖：${from}`,
      );
    }
    assert.doesNotMatch(source, /import\(\s*["']/, `${name} 出现动态 import`);
  }
});
