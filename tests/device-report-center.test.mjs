import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 纯静态源码断言：这一页的行为要靠浏览器才跑得起来，但「类有没有写、字号有没有超标、
// 关键口径文案有没有被后来的改动删掉」这些是源码层面就能钉死的，钉住它们比不测强得多。
const tsx = await readFile(new URL("../app/DeviceReportCenter.tsx", import.meta.url), "utf8");
const cssRaw = await readFile(new URL("../app/DeviceReportCenter.module.css", import.meta.url), "utf8");
// 注释里会提到类名和 px 数值（比如解释为什么覆盖全局 .search-field），
// 不剥掉的话「类写没写」「字号超没超标」都可能被一句注释蒙混过去。
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

/** 只取选择器文本（每个 { 前面那段），避免类名出现在声明值里也被当成「写过样式」 */
const selectorText = [...css.matchAll(/([^{}]+)\{/g)].map((match) => match[1]).join("\n");

/** 取某个类的规则体（含 media 里的重复定义会被拼在一起），用于「这个类里有没有某条声明」的断言 */
function ruleBodies(source, className) {
  const bodies = [];
  const pattern = new RegExp(`\\.${className}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "g");
  for (const match of source.matchAll(pattern)) bodies.push(match[1]);
  return bodies.join("\n");
}

test("组件用到的每个 styles.xxx 都在 CSS Module 里有定义", () => {
  // 少一个类页面就塌一块，而且塌得静悄悄（className 变成 undefined，元素直接裸奔），
  // 所以这条是本文件最重要的断言：以后加了类忘了写样式，测试会直接红。
  const used = [...new Set([...tsx.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))];
  assert.ok(used.length >= 55, `styles.xxx 抓取异常，只抓到 ${used.length} 个`);
  const missing = used.filter((name) => !new RegExp(`\\.${name}(?![A-Za-z0-9_-])`).test(selectorText));
  assert.deepEqual(missing, [], `以下类在 DeviceReportCenter.module.css 里没有定义：${missing.join("、")}`);
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
  // 深色主题（theme-midnight）只换变量不换样式表，写死一个 #fff 卡片在深色下就是一块白斑。
  // rgba() 半透明阴影是例外：它叠在底色上，跟着主题走。
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "CSS Module 里出现了写死的十六进制颜色");
  assert.match(css, /var\(--surface\)/);
  assert.match(css, /var\(--primary-soft\)/);
});

test("设备清单有搜索框：几百台设备靠翻页找不现实", () => {
  assert.match(tsx, /search-field \$\{styles\.searchBox\}/);
  assert.match(tsx, /placeholder="搜索资产编号 \/ 设备名称 \/ 型号 \/ 科室"/);
  assert.match(tsx, /aria-label="搜索设备"/);
  // 搜索框要吃掉工具条的剩余宽度，而不是被全局 .search-field 的定宽锁死
  assert.match(ruleBodies(css, "searchBox"), /flex:\s*1 1 260px/);
});

test("批量填报视图与「保存并填下一台」都在", () => {
  // 前者是一次填一屏设备的 Excel 式宽表，后者是抽屉里连续填的快捷路径，
  // 两个都是「一次要填几十台」这个真实场景的答案，删掉任一个都会让填报重新变成体力活。
  assert.match(tsx, /批量填报视图/);
  assert.match(tsx, /返回清单视图/);
  assert.match(tsx, /保存并填下一台/);
  assert.match(tsx, /onClick=\{saveAndNext\}/);
});

test("业务量三项只读回显，来源是数据准备中心", () => {
  // 检查人次、阳性数、总收入来自 HIS/RIS 导出，本页再手工填一遍就会出现两份口径，
  // 出报表时两边对不上。所以：只读展示 + 说明来源 + 保存时绝不把它们写进记录。
  assert.match(tsx, /数据准备中心导入/);
  assert.match(tsx, /尚未从数据准备中心导入/);
  // 抽屉：import 字段走 importValue 只读块，分支里没有 input
  const drawerBranch = tsx.slice(tsx.indexOf('if (field.source === "import") {\n                        const value'));
  const drawerImport = drawerBranch.slice(0, drawerBranch.indexOf("return (\n                        <label"));
  assert.match(drawerImport, /styles\.importValue/);
  assert.doesNotMatch(drawerImport, /<input/);
  // 宽表：import 字段直接渲染文本单元格
  assert.match(tsx, /if \(field\.source === "import"\) \{\s*return <td key=\{field\.key\} className=\{styles\.gridImportCell\}>/);
  // 落库时只写 manual 字段，导入值永远不进记录
  assert.match(tsx, /if \(field\.source !== "manual"\) continue;/);
});

test("日/周粒度隐藏费用类字段", () => {
  // 水电、物业、折旧只有月度账单，按天填只能逼科室凭空分摊，分摊出来的数没有任何分析价值。
  assert.match(tsx, /const hideCostFields = granularity === "day" \|\| granularity === "week";/);
  assert.match(tsx, /fields\.filter\(\(field\) => !field\.countsToCost\)/);
  assert.match(tsx, /日\/周粒度不展示这些字段/);
});

test("已确认的数据只读，改动必须先退回", () => {
  // 确认是财务口径的封账动作；允许确认后直接改，等于绕开复核。
  assert.match(tsx, /已确认的数据不可修改，需要修改请先退回。/);
  assert.match(tsx, /const drawerEditable = canEditReport\(drawerStatus\);/);
  assert.match(tsx, /disabled=\{!drawerEditable\}/);
  // 宽表同理：锁定行的输入框只读，整行压灰
  assert.match(tsx, /const locked = !canEditReport\(status\);/);
  assert.match(tsx, /readOnly=\{locked\}/);
  assert.match(tsx, /locked \? styles\.gridLockedRow : undefined/);
});

test("金额口径是元，不是万元", () => {
  // 旧成本表用万元，新口径统一到元（避免 0.0123 万元这种没法读的数）。
  // 归并对照表的「金额(万元)」列名是旧记录的原始口径，属于历史列名，断言时避开它。
  const withoutLegacyColumn = tsx.replaceAll('"金额(万元)"', '"金额(旧列名)"');
  assert.doesNotMatch(withoutLegacyColumn, /万元/, "页面正文出现了万元口径");
  assert.match(tsx, /总收入\(元\)/);
  assert.match(tsx, /当期总成本\(元\)/);
  assert.match(tsx, /结余\(元\)/);
  assert.match(tsx, /合计\(元\)/);
  // 归并时把旧的万元换算成元，换算规则要写给用户看
  assert.match(tsx, /×10000 换算为元/);
});

test("宽表的设备列冻结在最左", () => {
  // 二十来列横向滚动时设备名跟着滚走，填数的人就不知道自己在给哪台机器填了。
  assert.match(css, /position:\s*sticky/);
  for (const name of ["gridDeviceTh", "gridDeviceCell"]) {
    const body = ruleBodies(css, name);
    assert.match(body, /position:\s*sticky/, `${name} 没有 sticky`);
    assert.match(body, /left:\s*0/, `${name} 没有钉在左边`);
    // 冻结列必须有不透明底色，否则下层单元格会从它后面滚过去叠在一起
    assert.match(body, /background:\s*var\(--surface/, `${name} 没有不透明底色`);
  }
});

test("横向滚动只发生在宽表内部，页面主体不横滚", () => {
  // 主体一旦横滚，左边期间轴和顶部导航会一起跑出视野，页面就废了。
  assert.match(ruleBodies(css, "gridWrap"), /overflow-x:\s*auto/);
  assert.doesNotMatch(ruleBodies(css, "layout"), /overflow-x/);
  assert.doesNotMatch(ruleBodies(css, "main"), /overflow-x/);
});

test("期间列表自己滚动，两栏在窄屏折成单列", () => {
  // 周粒度一年 53 条、日粒度一月 31 条：不给列表独立滚动区，整页会被顶得老长，右侧表格被推出屏幕。
  const periodList = ruleBodies(css, "periodList");
  assert.match(periodList, /overflow-y:\s*auto/);
  assert.match(periodList, /max-height:/);
  // 1100px 以下折单列，期间条改横向排列
  assert.match(css, /@media \(max-width: 1100px\)/);
  const narrow = css.slice(css.indexOf("@media (max-width: 1100px)"));
  assert.match(narrow, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(narrow, /flex-direction:\s*row/);
});
