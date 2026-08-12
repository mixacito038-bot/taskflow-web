import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 纯静态源码断言：目录导航要真正跑起来得有浏览器（IntersectionObserver、matchMedia、打印预览），
// 但「锚点在不在、折叠会不会把打印稿吃掉一章、字号有没有超标」这些在源码层面就能钉死，
// 钉住它们比不测强得多——尤其打印那条，少印一章对医院是事故。
const tsx = await readFile(new URL("../app/BenefitReportCenter.tsx", import.meta.url), "utf8");
const cssRaw = await readFile(new URL("../app/BenefitReportCenter.module.css", import.meta.url), "utf8");
// 注释里会写到 px 数值和类名（比如解释 84px 顶栏偏移），不剥掉的话断言会被一句注释蒙混过去。
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

/** 报告正文的十二章标题，逐字取自正式报告；这份内容是合规产物，导航改造一个字都不许动。 */
const chapterHeadings = [
  "一、报告摘要",
  "二、范围与数据来源",
  "三、设备基本情况",
  "四、经济效益与回收",
  "五、使用效率分析",
  "六、质量安全与设备保障",
  "七、社会效益",
  "八、配置与全生命周期",
  "九、综合评价",
  "十、问题清单与整改计划",
  "十一、结论与建议",
  "十二、指标与口径附录",
];

/** 取出某个 @media 查询的完整规则体（花括号配对，嵌套规则不会被截断）。 */
function mediaBlock(source, query) {
  const start = source.indexOf(query);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return "";
}

test("十二个章节各有稳定锚点 id，且互不重复", () => {
  // 锚点是目录、外链和历史书签的唯一定位方式，重复或漏一个就是断链。
  const anchors = [...tsx.matchAll(/anchor: "([^"]+)"/g)].map((match) => match[1]);
  assert.equal(anchors.length, 12, `目录常量应有 12 个锚点，实际 ${anchors.length} 个`);
  assert.equal(new Set(anchors).size, 12, "锚点 id 出现重复");
  for (const anchor of anchors) {
    assert.ok(tsx.includes(`id="${anchor}"`), `正文缺少锚点元素 id="${anchor}"`);
  }
});

test("十二章标题一字未改", () => {
  // 报告正文是给院长和卫健委的合规产物，本次改造只加导航和折叠，正文不许删改。
  for (const heading of chapterHeadings) {
    assert.ok(tsx.includes(`<h3>${heading}</h3>`), `章节标题「${heading}」被改动或丢失`);
  }
});

test("目录高亮用 IntersectionObserver，不用 scroll 事件轮询", () => {
  // 页面高一万六千像素、正文一万两千字，scroll 事件里反复取位会明显掉帧。
  assert.match(tsx, /new IntersectionObserver\(/);
  assert.match(tsx, /observer\.observe\(node\)/);
  assert.match(tsx, /observer\.disconnect\(\)/);
  assert.doesNotMatch(tsx, /addEventListener\(\s*["']scroll["']/, "出现了 scroll 事件监听");
  assert.doesNotMatch(tsx, /onScroll=/, "出现了 onScroll 轮询");
});

test("目录项点击平滑滚动，且章节留出顶栏偏移", () => {
  // 没有 scroll-margin-top 的话，滚过去标题正好被 sticky 顶栏盖住，等于没跳。
  assert.match(tsx, /onClick=\{\(\) => scrollToChapter\(chapter\)\}/);
  assert.match(tsx, /scrollIntoView\(\{ behavior: [^)]*block: "start" \}\)/);
  assert.match(css, /\.chapter\s*\{[^}]*scroll-margin-top:\s*\d+px/);
  assert.match(css, /\.tocRail\s*\{[^}]*position:\s*sticky/);
});

test("尊重 prefers-reduced-motion", () => {
  // 系统关掉动效的用户（含前庭功能障碍）不能被强行平滑滚动。
  assert.match(tsx, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(tsx, /reduceMotion \? "auto" : "smooth"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("每章折叠按钮带 aria-expanded，且默认全部展开", () => {
  // 折叠是查阅便利，正式报告的默认态必须是完整展开的。
  assert.match(tsx, /aria-expanded=\{!collapsed\}/);
  assert.match(tsx, /aria-controls=\{`report-\$\{id\}-body`\}/);
  assert.match(tsx, /useState<ReportSectionId\[\]>\(\[\]\)/, "折叠状态的初值不是空数组（默认应全部展开）");
  assert.match(tsx, /全部展开/);
  assert.match(tsx, /全部收起/);
});

test("折叠只靠 CSS 隐藏，正文始终留在 DOM 里", () => {
  // 若折叠时把正文卸载掉，打印就再也救不回来了；十二章都要挂 data-collapsed。
  const marked = [...tsx.matchAll(/data-collapsed=\{chapterCollapsed\("([^"]+)"\)\}/g)].map((match) => match[1]);
  assert.equal(marked.length, 12, `应有 12 处 data-collapsed，实际 ${marked.length} 处`);
  assert.equal(new Set(marked).size, 12, "data-collapsed 绑定的章节 id 有重复");
  assert.match(css, /\.chapterBody\[data-collapsed="true"\]\s*\{[^}]*display:\s*none/);
});

test("打印时目录隐藏，且所有章节强制展开", () => {
  // 这条最重要：打印稿是正式材料，不能因为谁点了折叠就少印一章。
  const print = mediaBlock(css, "@media print");
  assert.ok(print.length > 0, "没有 @media print 规则");
  assert.match(print, /\.tocRail[^{]*\{[^}]*display:\s*none\s*!important/);
  assert.match(print, /\.chapterBody[^{]*\{[^}]*display:\s*block\s*!important/);
  assert.match(print, /\[data-collapsed="true"\]/, "打印规则没有覆盖到已折叠的章节");
});

test("阅读进度显示当前章序与进度条", () => {
  assert.match(tsx, /第 \{activeChapterIndex \+ 1\} \/ \{reportChapters\.length\} 章/);
  assert.match(tsx, /styles\.tocProgressBar/);
  assert.match(css, /\.tocProgressTrack\s*\{/);
});

test("窄屏断点存在，目录改为横向滚动 chip 条", () => {
  // 1100px 以下正文本来就窄，240px 的目录再占一列就把表格挤没了。
  const narrow = mediaBlock(css, "@media (max-width: 1100px)");
  assert.ok(narrow.length > 0, "缺少 1100px 窄屏断点");
  assert.match(narrow, /\.previewLayout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(narrow, /\.tocList\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(narrow, /\.tocRail\s*\{[^}]*position:\s*static/);
});

test("CSS 里不存在小于 12px 的字号", () => {
  // 平台硬性规定：医院端很多是 1366×768 的老机器加中年用户，11px 中文糊成一团。
  const sizes = [...css.matchAll(/font-size:\s*([^;}]+)/g)].map((match) => match[1].trim());
  assert.ok(sizes.length > 0, "没扫到任何 font-size，正则或文件不对");
  for (const size of sizes) {
    assert.match(size, /^\d+(\.\d+)?px$/, `字号只允许写死 px，发现「${size}」`);
    assert.ok(Number.parseFloat(size) >= 12, `字号 ${size} 小于 12px`);
  }
});

test("CSS 不写裸十六进制色值，颜色全部走主题变量", () => {
  // 写死颜色的地方在暗色主题下必然失效；阴影允许 rgba()，但色值必须来自变量。
  const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  assert.deepEqual(hex, [], `发现裸十六进制色值：${hex.join("、")}`);
});

test("组件用到的每个 styles.xxx 都在 CSS Module 里有定义", () => {
  // 少一个类页面就塌一块，而且塌得静悄悄：className 变成 undefined，元素直接裸奔。
  const selectorText = [...css.matchAll(/([^{}]+)\{/g)].map((match) => match[1]).join("\n");
  const used = [...new Set([...tsx.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))];
  assert.ok(used.length >= 12, `styles.xxx 抓取异常，只抓到 ${used.length} 个`);
  const missing = used.filter((name) => !new RegExp(`\\.${name}(?![A-Za-z0-9_-])`).test(selectorText));
  assert.deepEqual(missing, [], `以下类在 BenefitReportCenter.module.css 里没有定义：${missing.join("、")}`);
});
