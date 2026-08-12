import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

// 全部为静态源码断言：chart-template-catalog.ts 可能正被并行编写，
// import 组件会把「另一个人还没写完」变成本文件的失败，那是假红灯。
const tsx = await readFile(new URL("../app/MetricCockpitConfig.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/MetricCockpitConfig.module.css", import.meta.url), "utf8");

const between = (start, end) => {
  const from = tsx.indexOf(start);
  assert.ok(from >= 0, `源码里找不到 ${start}`);
  const to = end ? tsx.indexOf(end, from) : tsx.length;
  assert.ok(to > from, `源码里找不到 ${start} 之后的 ${end}`);
  return tsx.slice(from, to);
};

const countOf = (pattern) => (tsx.match(pattern) ?? []).length;

test("预览用的就是正式看板的渲染器，不是另写一套", () => {
  // 预览和驾驶舱一旦各有一套渲染逻辑，改了预览没改看板就会货不对板，
  // 用户在配置页看到的排版到了正式页全变样。
  assert.match(tsx, /export function MetricCockpitBoard\(/);
  assert.match(tsx, /<MetricCockpitBoard\s/);
  // 交互钩子是可选参数：配置页传 editor 才有拖拽和角标，正式页不传即纯展示，
  // 同一个组件承担两种形态，才谈得上「共用」。
  assert.match(tsx, /editor\?: BoardEditorHooks/);
  assert.match(tsx, /export type BoardEditorHooks = \{/);
  // 卡片渲染只有一个调用点，杜绝第二套看板悄悄长出来
  assert.equal(countOf(/<BoardCard\b/g), 1);
  assert.equal(countOf(/<MetricCockpitBoard\s/g), 1);
  // 预览挂在「当前布局预览」面板里
  assert.ok(tsx.indexOf("<h3>当前布局预览</h3>") < tsx.indexOf("<MetricCockpitBoard"));
  assert.match(tsx, /预览用的就是正式看板的渲染器/);
});

test("五种图表类型都能在卡片上直接切换", () => {
  // 用户的原话就是「从饼状图换成柱状图」：切换按钮必须遍历图型全集生成，
  // 手写五个按钮迟早漏掉新增的图型。
  assert.match(tsx, /const CHART_KINDS = Object\.keys\(CHART_KIND_LABELS\) as ChartKind\[\]/);
  assert.match(tsx, /\{CHART_KINDS\.map\(\(kind\) => \(/);
  assert.match(tsx, /aria-label=\{`切换为\$\{CHART_KIND_LABELS\[kind\]\}`\}/);
  assert.match(tsx, /aria-pressed=\{kind === item\.chartKind\}/);
  // 点击要真的写回 chartKind，而不只是本地高亮
  assert.match(tsx, /editor\.onChartKind\(item\.entryId, kind\)/);
  assert.match(tsx, /onChartKind: \(entryId, kind\) => updateItem\(entryId, \{ chartKind: kind \}\)/);
  assert.match(tsx, /items: config\.items\.map\(\(item\) => \(item\.entryId === entryId \? \{ \.\.\.item, \.\.\.patch \} : item\)\)/);
  // 五个分支各自接到一个渲染器，缺一个就会掉进兜底分支画错图
  const dispatch = between("let body: React.ReactNode;", "return (\n    <div\n      ref={cardRef}");
  assert.match(dispatch, /item\.chartKind === "stat"[\s\S]*<StatChart/);
  assert.match(dispatch, /item\.chartKind === "bar"[\s\S]*<BarChart/);
  assert.match(dispatch, /item\.chartKind === "line"[\s\S]*<LineChart/);
  assert.match(dispatch, /item\.chartKind === "pie"[\s\S]*<PieChart/);
  assert.match(dispatch, /\} else \{\s*body = <TableChart/);
  // 模板编辑里也用同一份图型全集，两处口径不能各写各的
  assert.match(tsx, /\{CHART_KINDS\.map\(\(kind\) => \(\s*<option key=\{kind\} value=\{kind\}>\{CHART_KIND_LABELS\[kind\]\}<\/option>/);
});

test("五种图都是手写 SVG，五个渲染函数齐备", () => {
  for (const fn of ["StatChart", "BarChart", "LineChart", "PieChart", "TableChart"]) {
    assert.match(tsx, new RegExp(`function ${fn}\\(`), `缺少 ${fn} 渲染函数`);
  }
  // 环形图的取色槽位有限，超出就并成「其他」；循环取色会出现两个同色扇区，图例对不上号
  assert.match(tsx, /const PIE_MAX_SLICES = PIE_SLOT_COLORS\.length/);
  assert.match(tsx, /label: "其他"/);
});

test("不引任何外部图表库", () => {
  // 平台是纯离线部署（医院内网 + 腾讯云私有化），引 CDN 图表库会直接白屏。
  // package.json 里躺着 recharts，更要盯死这条线，别顺手 import 进来。
  assert.doesNotMatch(tsx, /\brecharts\b/i);
  assert.doesNotMatch(tsx, /\becharts\b/i);
  assert.doesNotMatch(tsx, /\bchart\.js\b/i);
  assert.doesNotMatch(tsx, /react-chartjs/i);
  assert.doesNotMatch(tsx, /from\s+"d3(-[a-z]+)?"/);
  // 逐条核 import 来源：只允许 react、图标库和本仓库相对路径
  const sources = [...tsx.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(sources.length >= 4);
  for (const source of sources) {
    assert.ok(
      source.startsWith("./") || source.startsWith("../") || source === "react" || source === "lucide-react",
      `引入了计划外的外部依赖：${source}`,
    );
  }
  // 动态 import 同样会打包进去，一并堵掉
  assert.doesNotMatch(tsx, /import\(\s*["']/);
});

test("卡片可拖拽换位，四个拖拽事件齐全", () => {
  // 少任何一个，卡片要么拖不起来（缺 draggable/onDragStart），
  // 要么放不下去（缺 onDragOver 的 preventDefault，浏览器默认禁止落点）。
  assert.match(tsx, /draggable=\{Boolean\(editor\)\}/);
  assert.match(tsx, /onDragStart=\{editor \? \(\) => editor\.onDragStart\(item\.entryId\) : undefined\}/);
  assert.match(tsx, /onDragOver=\{editor \? \(event\) => event\.preventDefault\(\) : undefined\}/);
  assert.match(tsx, /onDrop=\{editor \? \(\) => editor\.onDrop\(item\.entryId\) : undefined\}/);
  assert.match(tsx, /onDragEnd=\{editor \? \(\) => editor\.onDragEnd\(\) : undefined\}/);
  // 落点逻辑要真的改 order 并写回配置，否则松手就弹回原位
  assert.match(tsx, /function dropOnItem\(targetEntryId: string\)/);
  assert.match(tsx, /if \(!draggingEntryId \|\| draggingEntryId === targetEntryId\) return;/);
  assert.match(tsx, /if \(item\.entryId === source\.entryId\) return \{ \.\.\.item, order: target\.order \};/);
  assert.match(tsx, /if \(item\.entryId === target\.entryId\) return \{ \.\.\.item, order: source\.order \};/);
  // 渲染前按 order 排序，否则改了 order 界面不动
  assert.match(tsx, /const items = \[\.\.\.config\.items\]\.sort\(\(left, right\) => left\.order - right\.order\)/);
});

test("领导 / 科室 / 看板三种维度预设都能选，且走同一份预设表", () => {
  // 三个视角的标题与默认指标组合都在 COCKPIT_DIMENSION_PRESETS 里，
  // 页面只做遍历——在组件里硬编码三个按钮，等于给预设表开了个后门。
  assert.match(tsx, /\{COCKPIT_DIMENSION_PRESETS\.map\(\(preset\) => \(/);
  assert.match(tsx, /<strong>\{preset\.label\}<\/strong>/);
  assert.match(tsx, /<small>\{preset\.description\}<\/small>/);
  // 三个预设 id 在类型上钉死，写错一个 TS 就报错
  assert.equal(countOf(/"leader" \| "department" \| "board"/g), 3);
  assert.match(tsx, /function applyPreset\(presetId: "leader" \| "department" \| "board"\)/);
  assert.match(tsx, /const preset = COCKPIT_DIMENSION_PRESETS\.find\(\(candidate\) => candidate\.id === presetId\)/);
  assert.match(tsx, /items: presetItems\(preset\.entryIds, templates\)/);
  assert.match(tsx, /onClick=\{\(\) => handlePresetClick\(preset\.id\)\}/);
  // 科室视角要挑具体科室，且科室清单来自台账而不是写死
  assert.match(tsx, /config\.dimension === "department" \? \(/);
  assert.match(tsx, /<span>统计科室<\/span>/);
  assert.match(tsx, /for \(const device of ctx\.devices\)/);
  // 统计范围跟着维度走：选了科室就下钻到科室，否则全院
  assert.match(tsx, /function scopeOf\(config: MetricCockpitConfigState\): CockpitScope/);
  assert.match(tsx, /\{ level: "department", department: config\.department \}/);
});

test("切维度会重置看板，只在用户改过时才弹确认，且沿用既有弹窗样式", () => {
  // 弹窗必须复用仓库那一套，另造一套会和其它页的确认框长得不一样
  assert.match(tsx, /className="modal-backdrop confirmation-modal"/);
  assert.match(tsx, /<section className="confirmation-dialog">/);
  assert.match(tsx, /role="dialog" aria-modal="true"/);
  // 脏检查：和该预设的默认组合逐项比，没改过就静默重置——每次都弹会变成狼来了
  assert.match(tsx, /const itemsDirty = currentPreset \? !sameItems\(config\.items, presetItems\(currentPreset\.entryIds, templates\)\) : true;/);
  assert.match(tsx, /if \(presetId === config\.dimension\) return;\s*if \(itemsDirty\) \{\s*setConfirmPreset\(presetId\);\s*return;\s*\}\s*applyPreset\(presetId\);/);
  // 比较要看图型和尺寸，只比 entryId 的话「只换了图型」会被当成没改过而被静默清掉
  const same = between("function sameItems(", "function scopeOf(");
  assert.match(same, /item\.entryId === b\[index\]\.entryId/);
  assert.match(same, /item\.templateId === b\[index\]\.templateId/);
  assert.match(same, /item\.chartKind === b\[index\]\.chartKind/);
  assert.match(same, /item\.size === b\[index\]\.size/);
  // 手工排版会丢，得在弹窗里说清楚，并且取消是真的什么都不做
  assert.match(tsx, /手工调整不会保留，也无法撤销/);
  assert.match(tsx, /onClick=\{\(\) => setConfirmPreset\(null\)\}>取消<\/button>/);
  assert.match(tsx, /onClick=\{\(\) => applyPreset\(confirmPreset\)\}>确认切换并重置<\/button>/);
});

test("未接入的指标走空态文案，绝不用 0 冒充数据", () => {
  // 平台的数据诚实底线：缺数就说没数。显示 0 会被当成真实结果拿去开会汇报。
  assert.match(tsx, /const series = binding && template \? computeChartSeries\(template, scope, computeCtx\) : null;/);
  const dispatch = between("let body: React.ReactNode;", "return (\n    <div\n      ref={cardRef}");
  // 三种「没数」都在图表分支之前拦下，任何一种漏了都会掉进图表分支画出 0
  assert.ok(dispatch.indexOf("series.unavailable") < dispatch.indexOf('item.chartKind === "stat"'));
  assert.match(dispatch, /if \(!entry\) \{\s*body = <UnavailableCard/);
  assert.match(dispatch, /\} else if \(!series\) \{\s*body = <UnavailableCard/);
  assert.match(dispatch, /\} else if \(series\.unavailable\) \{\s*body = <UnavailableCard reason=\{series\.unavailableReason \?\? "当前口径下暂无数据"\} \/>/);
  assert.match(tsx, /reason="尚未接入填报口径"/);
  // 空态卡片里不许出现任何数值渲染
  const card = between("function UnavailableCard(", "function BoardCard(");
  assert.match(card, /未接入<\/span>/);
  assert.match(card, /\{reason\}<\/p>/);
  assert.doesNotMatch(card, /formatValue|formatNumber|series/);
  // 单点为 null 时也是「—」而不是 0；整组没数时给文案而不是画一张全零的图
  assert.match(tsx, /return value === null \? "—" : formatNumber\(value\);/);
  assert.match(tsx, /本期暂无可统计数据/);
  assert.equal(countOf(/本期各分组均无数据/g), 3);
});

test("模板库能配计算规则：取值、聚合、比率的分子分母", () => {
  // 「引用哪一个值 + 怎么算」全在模板里，卡片只挑模板和图型——
  // 口径散落到卡片上就没法复用，也没法在模板库里一眼看全。
  assert.match(tsx, /<form className="editor-drawer" onSubmit=\{saveTemplate\}>/);
  assert.match(tsx, /\{templateDraft\.id \? "编辑模板" : "新增模板"\}/);
  // 取值来源：填报字段按填报页分组列出 + 三项派生口径
  assert.match(tsx, /<span>取值（引用哪一个值）<\/span>/);
  assert.match(tsx, /value=\{sourceToKey\(templateDraft\.source\)\}/);
  assert.match(tsx, /setTemplateDraft\(\{ \.\.\.templateDraft, source: keyToSource\(event\.target\.value\) \}\)/);
  assert.match(tsx, /function keyToSource\(key: string\): ChartValueSource/);
  assert.match(tsx, /REPORT_FIELD_GROUPS\.map\(\(group\) => \{/);
  assert.match(tsx, /<option value="totalCost">当期总成本<\/option>/);
  assert.match(tsx, /<option value="margin">结余（收入 − 成本）<\/option>/);
  assert.match(tsx, /<option value="costBreakdown">成本构成<\/option>/);
  // 聚合方式：求和 / 比率
  assert.match(tsx, /<span>聚合方式<\/span>/);
  assert.match(tsx, /const aggregation = event\.target\.value as ChartAggregation;/);
  assert.match(tsx, /const AGGREGATION_LABELS: Record<ChartAggregation, string> = \{\s*sum: "求和",\s*rate: "比率",/);
  // 比率的分子分母各自可选，分母还支持按天 / 按小时 / 按台数摊
  assert.match(tsx, /const draftRate: RateSpec =/);
  assert.match(tsx, /<span>分子<\/span>/);
  assert.match(tsx, /rate: \{ \.\.\.draftRate, numerator: keyToSource\(event\.target\.value\) \}/);
  assert.match(tsx, /<span>分母<\/span>/);
  assert.match(tsx, /rate: \{ \.\.\.draftRate, denominator: keyToDenominator\(event\.target\.value\) \}/);
  assert.match(tsx, /<option value="calendarDays">周期日历天数<\/option>/);
  assert.match(tsx, /<option value="usageHours">使用小时数<\/option>/);
  assert.match(tsx, /<option value="deviceCount">在用设备台数<\/option>/);
  assert.match(tsx, /按百分比显示（× 100）/);
  // 分组维度决定每根柱子代表什么
  assert.match(tsx, /event\.target\.value as ChartTemplate\["groupBy"\]/);
  assert.match(tsx, /const GROUP_BY_LABELS: Record<ChartTemplate\["groupBy"\], string> = \{/);
});

test("保存模板前校验：比率必须有分子分母，名称不能空", () => {
  // rate 缺分子分母算出来是 NaN，整张卡片会显示一个「NaN%」发到院领导眼前。
  const save = between("function saveTemplate(event: FormEvent)", "function removeTemplate(");
  assert.match(save, /if \(templateDraft\.aggregation === "rate" && !templateDraft\.rate\) \{\s*notify\("比率模板必须配置分子和分母", "error"\);\s*return;\s*\}/);
  assert.match(save, /if \(!name\) \{\s*notify\("请填写模板名称", "error"\);\s*return;\s*\}/);
  // 校验必须挡在写回之前，先写后校等于没校
  assert.ok(save.indexOf("比率模板必须配置分子和分母") < save.indexOf("onTemplatesChange("));
  assert.ok(save.indexOf("请填写模板名称") < save.indexOf("onTemplatesChange("));
  // 聚合从比率改回求和要把 rate 清掉，残留配置会在口径说明里冒出来
  assert.match(save, /rate: templateDraft\.aggregation === "rate" \? templateDraft\.rate : undefined,/);
  // 被卡片用着的模板不许删，否则卡片会指向一个不存在的模板
  assert.match(tsx, /if \(config\.items\.some\(\(item\) => item\.templateId === template\.id\)\) \{\s*notify\("该模板正被看板卡片使用/);
});

test("样式表没有小于 12px 的字号", () => {
  // 驾驶舱经常投在会议室大屏或护士站的老显示器上，11px 的中文在那儿就是一团灰。
  const declarations = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1].trim());
  assert.ok(declarations.length >= 20, "字号声明数量异常，正则可能没扫到");
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
  for (const match of css.matchAll(/[a-z-]+:[^;]*\brgba?\([^)]*\)/g)) {
    assert.match(match[0], /^box-shadow:/, `rgba 只允许出现在阴影里：${match[0]}`);
  }
  // 常见的裸色名同样是写死
  assert.doesNotMatch(css, /:\s*(?:white|black|red|blue|green|orange|purple|gray|grey)\s*[;}]/);
  // 图表里的颜色也全部取自变量，包括环形图的取色槽位
  assert.match(tsx, /const PIE_SLOT_COLORS = \[\s*"var\(--primary\)",/);
  for (const match of tsx.matchAll(/(?:fill|stroke)="([^"]+)"/g)) {
    assert.ok(
      match[1].startsWith("var(--") || match[1] === "none",
      `图表里出现写死的颜色：${match[1]}`,
    );
  }
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
  assert.equal(countOf(/const aria = `/g), 3);
  assert.match(tsx, /const aria = `\$\{label\}：\$\{CHART_KIND_LABELS\.bar\}，\$\{points\.length\} 个分组，单位\$\{unit \|\| "无"\}`/);
  assert.match(tsx, /const aria = `\$\{label\}：\$\{CHART_KIND_LABELS\.line\}，\$\{points\.length\} 个期间，单位\$\{unit \|\| "无"\}`/);
  assert.match(tsx, /const aria = `\$\{label\}：\$\{CHART_KIND_LABELS\.pie\}/);
  // 纯装饰的色点、图标不能被读出来
  assert.match(tsx, /className=\{styles\.legendDot\}[^>]*aria-hidden/);
  assert.match(tsx, /<GripVertical size=\{14\} className=\{styles\.cardGrip\} aria-hidden \/>/);
});

test("tsx 里引用的样式类在 module.css 里都有定义", () => {
  // CSS Modules 找不到的类名会静默变成 undefined，页面不报错、只是排版塌掉，
  // 这种漏改（改名了但漏了一处引用）只能靠这条断言兜住。
  const used = [...new Set([...tsx.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((match) => match[1]))];
  assert.ok(used.length >= 60, "样式类引用数量异常，正则可能没扫到");
  const defined = new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1]));
  const missing = used.filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], `module.css 缺少这些类定义：${missing.join("、")}`);
});

test("图表口径目录（若已生成）导出计算入口、值绑定与维度预设", async () => {
  // 该文件正由另一个进程编写，还没落地时跳过——为别人的进度让本页测试变红没有意义。
  const url = new URL("../app/chart-template-catalog.ts", import.meta.url);
  const exists = await access(url).then(() => true, () => false);
  if (!exists) {
    console.log("app/chart-template-catalog.ts 尚未生成，跳过其导出断言");
    return;
  }
  const catalog = await readFile(url, "utf8");
  assert.match(catalog, /export function computeChartSeries|export const computeChartSeries/);
  assert.match(catalog, /export const METRIC_VALUE_BINDINGS/);
  assert.match(catalog, /export const COCKPIT_DIMENSION_PRESETS/);
});
