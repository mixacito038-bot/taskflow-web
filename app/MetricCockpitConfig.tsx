"use client";

import { FormEvent, useMemo, useState } from "react";
import { ChevronDown, LayoutDashboard, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";

import styles from "./MetricCockpitConfig.module.css";
import { GROUP_BY_LABELS, MetricCockpitBoard, type BoardEditorHooks } from "./MetricCockpitBoard";
import {
  MetricCategory,
  MetricCategoryTone,
  MetricDictionaryEntry,
  metricCategory,
} from "./metric-dictionary";
import {
  CHART_KIND_LABELS,
  ChartAggregation,
  ChartComputeContext,
  ChartKind,
  ChartTemplate,
  ChartValueSource,
  COCKPIT_DIMENSION_PRESETS,
  METRIC_VALUE_BINDINGS,
  MetricBinding,
  MetricCockpitConfigState,
  MetricCockpitItem,
  RateSpec,
} from "./chart-template-catalog";
import { REPORT_FIELD_GROUPS, reportFieldLabel } from "./device-report-fields";

/**
 * 看板渲染器（含五个手写 SVG 图表和卡片）已经拆到 ./MetricCockpitBoard，
 * 这里继续 re-export：正式驾驶舱页一直是从本文件 import 它的，断了这条线正式页就白了。
 */
export { MetricCockpitBoard };
export type { BoardEditorHooks };

const CHART_KINDS = Object.keys(CHART_KIND_LABELS) as ChartKind[];

const SIZE_SEQUENCE: MetricCockpitItem["size"][] = ["small", "medium", "wide"];

const AGGREGATION_LABELS: Record<ChartAggregation, string> = {
  sum: "求和",
  rate: "比率",
};

// 色标沿用指标字典配置页的思路：一律落在主题变量上，深浅主题各自取各自的色值。
const TONE_CLASS: Record<MetricCategoryTone, string> = {
  blue: styles.toneBlue,
  green: styles.toneGreen,
  orange: styles.toneOrange,
  purple: styles.tonePurple,
  red: styles.toneRed,
  slate: styles.toneSlate,
};

/* ------------------------------------------------------------------ 纯函数 */

function sourceToKey(source: ChartValueSource): string {
  return source.kind === "reportField" ? `field:${source.fieldKey}` : source.kind;
}

function keyToSource(key: string): ChartValueSource {
  if (key.startsWith("field:")) return { kind: "reportField", fieldKey: key.slice("field:".length) };
  return { kind: key as "totalCost" | "margin" | "costBreakdown" };
}

function denominatorToKey(denominator: RateSpec["denominator"]): string {
  return typeof denominator === "string" ? denominator : `field:${denominator.fieldKey}`;
}

function keyToDenominator(key: string): RateSpec["denominator"] {
  if (key.startsWith("field:")) return { fieldKey: key.slice("field:".length) };
  return key as "calendarDays" | "usageHours" | "deviceCount";
}

const DENOMINATOR_LABELS: Record<string, string> = {
  calendarDays: "周期日历天数",
  usageHours: "使用小时数",
  deviceCount: "在用设备台数",
};

function fieldLabelOf(ctx: ChartComputeContext, fieldKey: string): string {
  const granularity = ctx.periods.length ? ctx.periods[0].granularity : "month";
  const field = ctx.fields.find((item) => item.key === fieldKey);
  return field ? reportFieldLabel(field, granularity) : fieldKey;
}

function describeSource(ctx: ChartComputeContext, source: ChartValueSource): string {
  if (source.kind === "reportField") return `填报字段「${fieldLabelOf(ctx, source.fieldKey)}」`;
  if (source.kind === "totalCost") return "当期总成本（计入成本的填报项合计）";
  if (source.kind === "margin") return "结余（总收入 − 当期总成本）";
  return "成本构成（计入成本的字段逐项拆分）";
}

function describeDenominator(ctx: ChartComputeContext, denominator: RateSpec["denominator"]): string {
  if (typeof denominator === "string") return DENOMINATOR_LABELS[denominator] ?? denominator;
  return `填报字段「${fieldLabelOf(ctx, denominator.fieldKey)}」`;
}

function describeTemplate(ctx: ChartComputeContext, template: ChartTemplate): string {
  const base = describeSource(ctx, template.source);
  const grouped = `按${GROUP_BY_LABELS[template.groupBy]}分组`;
  if (template.aggregation === "rate" && template.rate) {
    return `${describeSource(ctx, template.rate.numerator)} ÷ ${describeDenominator(ctx, template.rate.denominator)}，${grouped}`;
  }
  return `${base}求和，${grouped}`;
}

/**
 * 给指标绑定挑模板：先按取值 + 聚合完全一致找，找不到再退到取值一致的。
 * 匹配不上返回 null，让卡片走「未接入」空态，绝不随手塞一个口径不符的模板充数。
 */
function matchTemplate(binding: MetricBinding, templates: readonly ChartTemplate[]): ChartTemplate | null {
  const key = sourceToKey(binding.source);
  return (
    templates.find((template) => sourceToKey(template.source) === key && template.aggregation === binding.aggregation) ??
    templates.find((template) => sourceToKey(template.source) === key) ??
    null
  );
}

/** stat 天生是小卡、表格和折线需要横向空间，其余默认中卡；用户随时可在预览里循环切。 */
function defaultSizeFor(kind: ChartKind): MetricCockpitItem["size"] {
  if (kind === "stat") return "small";
  if (kind === "table" || kind === "line") return "wide";
  return "medium";
}

function makeItem(entryId: string, order: number, templates: readonly ChartTemplate[]): MetricCockpitItem {
  const binding = METRIC_VALUE_BINDINGS[entryId] ?? null;
  const chartKind = binding?.defaultChart ?? "stat";
  return {
    entryId,
    templateId: binding ? matchTemplate(binding, templates)?.id ?? "" : "",
    chartKind,
    size: defaultSizeFor(chartKind),
    order,
  };
}

function presetItems(entryIds: readonly string[], templates: readonly ChartTemplate[]): MetricCockpitItem[] {
  return entryIds.map((entryId, index) => makeItem(entryId, index, templates));
}

function sameItems(left: readonly MetricCockpitItem[], right: readonly MetricCockpitItem[]): boolean {
  if (left.length !== right.length) return false;
  const sortByOrder = (list: readonly MetricCockpitItem[]) => [...list].sort((a, b) => a.order - b.order);
  const a = sortByOrder(left);
  const b = sortByOrder(right);
  return a.every((item, index) =>
    item.entryId === b[index].entryId &&
    item.templateId === b[index].templateId &&
    item.chartKind === b[index].chartKind &&
    item.size === b[index].size);
}

/* ------------------------------------------------------------------ 配置页 */

function nextTemplateId(templates: readonly ChartTemplate[]): string {
  let index = templates.length + 1;
  while (templates.some((template) => template.id === `hospital-chart-${index}`)) index += 1;
  return `hospital-chart-${index}`;
}

function emptyTemplate(): ChartTemplate {
  return {
    id: "",
    name: "",
    description: "",
    chartKind: "bar",
    source: { kind: "totalCost" },
    aggregation: "sum",
    unit: "元",
    groupBy: "department",
    builtin: false,
  };
}

export default function MetricCockpitConfig({
  config,
  onConfigChange,
  templates,
  onTemplatesChange,
  entries,
  categories,
  ctx,
  canManage,
  notify,
}: {
  config: MetricCockpitConfigState;
  onConfigChange: (next: MetricCockpitConfigState) => void;
  templates: ChartTemplate[];
  onTemplatesChange: (next: ChartTemplate[]) => void;
  entries: MetricDictionaryEntry[];
  categories: MetricCategory[];
  ctx: ChartComputeContext;
  canManage: boolean;
  notify: (message: string, tone?: "info" | "error") => void;
}) {
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [draggingEntryId, setDraggingEntryId] = useState<string | null>(null);
  const [confirmPreset, setConfirmPreset] = useState<"leader" | "department" | "board" | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<ChartTemplate | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  const departments = useMemo(() => {
    const seen = new Set<string>();
    for (const device of ctx.devices) {
      const department = device.department?.trim();
      if (department) seen.add(department);
    }
    return [...seen];
  }, [ctx.devices]);

  const currentPreset = COCKPIT_DIMENSION_PRESETS.find((preset) => preset.id === config.dimension) ?? null;
  // 只有在用户确实改过看板时才拦一道确认：没改过就静默重置，弹窗会变成狼来了。
  const itemsDirty = currentPreset ? !sameItems(config.items, presetItems(currentPreset.entryIds, templates)) : true;

  function applyPreset(presetId: "leader" | "department" | "board") {
    const preset = COCKPIT_DIMENSION_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    onConfigChange({
      ...config,
      dimension: presetId,
      department: presetId === "department" ? (config.department || departments[0] || "") : config.department,
      items: presetItems(preset.entryIds, templates),
    });
    setConfirmPreset(null);
    notify(`已切换到「${preset.label}」，看板已重置为该视角的默认指标组合`);
  }

  function handlePresetClick(presetId: "leader" | "department" | "board") {
    if (presetId === config.dimension) return;
    if (itemsDirty) {
      setConfirmPreset(presetId);
      return;
    }
    applyPreset(presetId);
  }

  function updateItem(entryId: string, patch: Partial<MetricCockpitItem>) {
    onConfigChange({
      ...config,
      items: config.items.map((item) => (item.entryId === entryId ? { ...item, ...patch } : item)),
    });
  }

  function toggleEntry(entry: MetricDictionaryEntry) {
    const existing = config.items.find((item) => item.entryId === entry.id);
    if (existing) {
      onConfigChange({ ...config, items: config.items.filter((item) => item.entryId !== entry.id) });
      return;
    }
    const nextOrder = config.items.reduce((max, item) => Math.max(max, item.order), -1) + 1;
    onConfigChange({ ...config, items: [...config.items, makeItem(entry.id, nextOrder, templates)] });
    setSelectedEntryId(entry.id);
  }

  function dropOnItem(targetEntryId: string) {
    if (!draggingEntryId || draggingEntryId === targetEntryId) return;
    const source = config.items.find((item) => item.entryId === draggingEntryId);
    const target = config.items.find((item) => item.entryId === targetEntryId);
    if (!source || !target) return;
    // 交换两张卡片的 order 而不是整体插入：和驾驶舱模块编排一个手感，拖到谁就跟谁换位。
    onConfigChange({
      ...config,
      items: config.items.map((item) => {
        if (item.entryId === source.entryId) return { ...item, order: target.order };
        if (item.entryId === target.entryId) return { ...item, order: source.order };
        return item;
      }),
    });
    setDraggingEntryId(null);
  }

  function cycleSize(entryId: string) {
    const item = config.items.find((candidate) => candidate.entryId === entryId);
    if (!item) return;
    const next = SIZE_SEQUENCE[(SIZE_SEQUENCE.indexOf(item.size) + 1) % SIZE_SEQUENCE.length];
    updateItem(entryId, { size: next });
  }

  function removeItem(entryId: string) {
    onConfigChange({ ...config, items: config.items.filter((item) => item.entryId !== entryId) });
  }

  function saveTemplate(event: FormEvent) {
    event.preventDefault();
    if (!templateDraft) return;
    const name = templateDraft.name.trim();
    if (!name) {
      notify("请填写模板名称", "error");
      return;
    }
    if (templateDraft.aggregation === "rate" && !templateDraft.rate) {
      notify("比率模板必须配置分子和分母", "error");
      return;
    }
    const next: ChartTemplate = {
      ...templateDraft,
      name,
      // 聚合从比率改回求和时把 rate 一并清掉，否则残留配置会在导出的口径说明里冒出来。
      rate: templateDraft.aggregation === "rate" ? templateDraft.rate : undefined,
    };
    if (next.id) {
      onTemplatesChange(templates.map((template) => (template.id === next.id ? next : template)));
      notify(`模板「${name}」已更新`);
    } else {
      onTemplatesChange([...templates, { ...next, id: nextTemplateId(templates) }]);
      notify(`模板「${name}」已创建`);
    }
    setTemplateDraft(null);
  }

  function removeTemplate(template: ChartTemplate) {
    if (config.items.some((item) => item.templateId === template.id)) {
      notify("该模板正被看板卡片使用，请先把对应卡片换到其它模板", "error");
      return;
    }
    onTemplatesChange(templates.filter((candidate) => candidate.id !== template.id));
    notify(`模板「${template.name}」已删除`);
  }

  const editingItem = editingItemId ? config.items.find((item) => item.entryId === editingItemId) ?? null : null;
  const editingEntry = editingItem ? entries.find((entry) => entry.id === editingItem.entryId) ?? null : null;
  const scopeLabel = config.dimension === "department" ? `科室：${config.department || "未选择"}` : "全院口径";
  const draftRate: RateSpec = templateDraft?.rate ?? { numerator: templateDraft?.source ?? { kind: "totalCost" }, denominator: "calendarDays", percent: true };

  const sourceOptions = (
    <>
      {REPORT_FIELD_GROUPS.map((group) => {
        const fields = ctx.fields.filter((field) => field.groupId === group.id);
        if (!fields.length) return null;
        return (
          <optgroup key={group.id} label={group.label}>
            {fields.map((field) => (
              <option key={field.key} value={`field:${field.key}`}>
                {fieldLabelOf(ctx, field.key)}
              </option>
            ))}
          </optgroup>
        );
      })}
      <optgroup label="派生口径">
        <option value="totalCost">当期总成本</option>
        <option value="margin">结余（收入 − 成本）</option>
        <option value="costBreakdown">成本构成</option>
      </optgroup>
    </>
  );

  return (
    <div className={styles.layout}>
      <div className={styles.sideColumn}>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>维度</h3>
              <p>驾驶舱按谁在看分三个视角，切换会重置右侧看板为该视角的默认指标。</p>
            </div>
          </div>
          <div className={styles.presetGrid}>
            {COCKPIT_DIMENSION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={preset.id === config.dimension ? `${styles.presetCard} ${styles.presetActive}` : styles.presetCard}
                onClick={() => handlePresetClick(preset.id)}
              >
                <LayoutDashboard size={15} aria-hidden />
                <span>
                  <strong>{preset.label}</strong>
                  <small>{preset.description}</small>
                </span>
              </button>
            ))}
          </div>
          {config.dimension === "department" ? (
            <label className={`form-field ${styles.departmentField}`}>
              <span>统计科室</span>
              <select
                value={config.department}
                onChange={(event) => onConfigChange({ ...config, department: event.target.value })}
              >
                <option value="">请选择科室</option>
                {departments.map((department) => (
                  <option key={department} value={department}>{department}</option>
                ))}
              </select>
              <small>科室清单来自设备台账的使用科室，看板只统计该科室名下的设备。</small>
            </label>
          ) : null}
          <div className={styles.switchRow}>
            <button
              type="button"
              role="switch"
              aria-checked={config.onlyConfirmed}
              className={config.onlyConfirmed ? `${styles.switch} ${styles.switchOn}` : styles.switch}
              onClick={() => onConfigChange({ ...config, onlyConfirmed: !config.onlyConfirmed })}
            >
              <i aria-hidden />
            </button>
            <span>
              <strong>正式口径</strong>
              <small>开：只统计已确认的填报数据；关：连同填报中、已提交的草稿一起算（预览口径）。</small>
            </span>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>指标清单</h3>
              <p>勾选加入看板；「未接入」的指标也能加，等填报口径覆盖后自动点亮，不显示估算值。</p>
            </div>
            <span className="chart-note">{config.items.length} / {entries.length} 已上板</span>
          </div>
          <ul className={styles.metricList}>
            {entries.map((entry) => {
              const binding = METRIC_VALUE_BINDINGS[entry.id] ?? null;
              const included = config.items.some((item) => item.entryId === entry.id);
              const category = metricCategory(categories, entry.categoryId);
              const rowClass = [
                styles.metricRow,
                selectedEntryId === entry.id ? styles.metricRowSelected : "",
              ].filter(Boolean).join(" ");
              return (
                <li key={entry.id}>
                  <div className={rowClass} onClick={() => setSelectedEntryId(entry.id)}>
                    <input
                      type="checkbox"
                      checked={included}
                      aria-label={`加入看板：${entry.name}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleEntry(entry)}
                    />
                    <i className={`${styles.toneDot} ${category ? TONE_CLASS[category.tone] : styles.toneSlate}`} aria-hidden />
                    <span className={styles.metricName}>{entry.name}</span>
                    <span className={binding ? `${styles.bindBadge} ${styles.bindOk}` : `${styles.bindBadge} ${styles.bindNone}`}>
                      {binding ? "可自动计算" : "未接入"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <h3>
                <button type="button" className={styles.libraryToggle} onClick={() => setLibraryOpen((open) => !open)} aria-expanded={libraryOpen}>
                  模板库
                  <ChevronDown size={15} className={libraryOpen ? styles.chevronOpen : styles.chevron} aria-hidden />
                </button>
              </h3>
              <p>计算规则和引用哪一个值都在模板里配好，卡片只负责选模板和挑图型。</p>
            </div>
            {canManage ? (
              <button type="button" className="secondary-button" onClick={() => { setLibraryOpen(true); setTemplateDraft(emptyTemplate()); }}>
                <Plus size={15} />新增模板
              </button>
            ) : null}
          </div>
          {libraryOpen ? (
            <ul className={styles.templateList}>
              {templates.map((template) => (
                <li key={template.id} className={styles.templateRow}>
                  <div className={styles.templateCopy}>
                    <div className={styles.templateTitle}>
                      <strong>{template.name}</strong>
                      <span className={styles.kindTag}>{CHART_KIND_LABELS[template.chartKind]}</span>
                      {template.builtin ? <span className={styles.builtinTag}>内置</span> : null}
                    </div>
                    <small>{describeTemplate(ctx, template)}</small>
                  </div>
                  {canManage ? (
                    <div className={styles.templateActions}>
                      <button type="button" className="icon-button" aria-label={`编辑模板 ${template.name}`} onClick={() => setTemplateDraft({ ...template })}>
                        <Pencil size={14} />
                      </button>
                      {!template.builtin ? (
                        <button type="button" className="icon-button danger" aria-label={`删除模板 ${template.name}`} onClick={() => removeTemplate(template)}>
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <section className={`panel ${styles.previewPanel}`}>
        <div className="panel-heading">
          <div>
            <h3>当前布局预览</h3>
            <p>预览用的就是正式看板的渲染器，所见即所得；拖拽卡片换位，悬停出操作角标可换图型（比如从饼状图换成柱状图）、切尺寸、换模板或移除。</p>
          </div>
          <span className="chart-note">{scopeLabel} · {config.onlyConfirmed ? "仅已确认" : "含草稿"}</span>
        </div>
        <MetricCockpitBoard
          compact
          config={config}
          entries={entries}
          categories={categories}
          ctx={ctx}
          templates={templates}
          editor={{
            selectedEntryId,
            draggingEntryId,
            onSelect: setSelectedEntryId,
            onDragStart: setDraggingEntryId,
            onDragEnd: () => setDraggingEntryId(null),
            onDrop: dropOnItem,
            onChartKind: (entryId, kind) => updateItem(entryId, { chartKind: kind }),
            onCycleSize: cycleSize,
            onEditItem: setEditingItemId,
            onRemove: removeItem,
          }}
        />
      </section>

      {confirmPreset ? (
        <div className="modal-backdrop confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="cockpit-preset-confirm">
          <section className="confirmation-dialog">
            <span className="confirmation-icon"><RotateCcw size={22} /></span>
            <div>
              <small>重置当前看板</small>
              <h2 id="cockpit-preset-confirm">
                切换到「{COCKPIT_DIMENSION_PRESETS.find((preset) => preset.id === confirmPreset)?.label ?? confirmPreset}」？
              </h2>
              <p>当前看板的卡片组合、图型和排序是手工调整过的。切换维度会把看板重置为该视角的默认指标，手工调整不会保留，也无法撤销。</p>
            </div>
            <footer>
              <button className="secondary-button" onClick={() => setConfirmPreset(null)}>取消</button>
              <button className="primary-button" onClick={() => applyPreset(confirmPreset)}>确认切换并重置</button>
            </footer>
          </section>
        </div>
      ) : null}

      {editingItem ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingItemId(null); }}>
          <div className={`editor-drawer ${styles.smallDrawer}`}>
            <div className="editor-header">
              <div>
                <span className="eyebrow">更换模板</span>
                <h2>{editingEntry?.name ?? editingItem.entryId}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setEditingItemId(null)} aria-label="关闭"><X size={19} /></button>
            </div>
            <div className="editor-body">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={template.id === editingItem.templateId ? `${styles.templatePick} ${styles.templatePickActive}` : styles.templatePick}
                  onClick={() => {
                    updateItem(editingItem.entryId, { templateId: template.id });
                    notify(`已改用模板「${template.name}」`);
                    setEditingItemId(null);
                  }}
                >
                  <strong>{template.name}</strong>
                  <span className={styles.kindTag}>{CHART_KIND_LABELS[template.chartKind]}</span>
                  <small>{describeTemplate(ctx, template)}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {templateDraft ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setTemplateDraft(null); }}>
          <form className="editor-drawer" onSubmit={saveTemplate}>
            <div className="editor-header">
              <div>
                <span className="eyebrow">模板库</span>
                <h2>{templateDraft.id ? "编辑模板" : "新增模板"}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setTemplateDraft(null)} aria-label="关闭"><X size={19} /></button>
            </div>
            <div className="editor-body">
              <label className="form-field">
                <span>模板名称</span>
                <input
                  value={templateDraft.name}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })}
                  placeholder="例如：科室收入占比"
                  required
                />
                <small>显示在模板库和卡片编辑里的名字，起一个业务上一眼能懂的。</small>
              </label>
              <div className="form-row two">
                <label className="form-field">
                  <span>图表类型</span>
                  <select
                    value={templateDraft.chartKind}
                    onChange={(event) => setTemplateDraft({ ...templateDraft, chartKind: event.target.value as ChartKind })}
                  >
                    {CHART_KINDS.map((kind) => (
                      <option key={kind} value={kind}>{CHART_KIND_LABELS[kind]}</option>
                    ))}
                  </select>
                  <small>卡片默认用这个图型，上板后还能在预览里快捷切换。</small>
                </label>
                <label className="form-field">
                  <span>单位</span>
                  <input
                    value={templateDraft.unit}
                    onChange={(event) => setTemplateDraft({ ...templateDraft, unit: event.target.value })}
                    placeholder="例如：元、小时、%"
                  />
                  <small>跟着数值一起显示；比率按百分比时一般填「%」。</small>
                </label>
              </div>
              <label className="form-field">
                <span>取值（引用哪一个值）</span>
                <select
                  value={sourceToKey(templateDraft.source)}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, source: keyToSource(event.target.value) })}
                >
                  {sourceOptions}
                </select>
                <small>数据从哪来：18 项填报字段按填报页的分组列出，后面三项是平台算好的派生口径。</small>
              </label>
              <label className="form-field">
                <span>聚合方式</span>
                <select
                  value={templateDraft.aggregation}
                  onChange={(event) => {
                    const aggregation = event.target.value as ChartAggregation;
                    setTemplateDraft({
                      ...templateDraft,
                      aggregation,
                      rate: aggregation === "rate" ? draftRate : undefined,
                    });
                  }}
                >
                  {(Object.keys(AGGREGATION_LABELS) as ChartAggregation[]).map((aggregation) => (
                    <option key={aggregation} value={aggregation}>{AGGREGATION_LABELS[aggregation]}</option>
                  ))}
                </select>
                <small>求和：把范围内所有设备、所有期间的取值加总；比率：分子 ÷ 分母，用来做占比和率。</small>
              </label>
              {templateDraft.aggregation === "rate" ? (
                <div className={styles.rateBox}>
                  <label className="form-field">
                    <span>分子</span>
                    <select
                      value={sourceToKey(draftRate.numerator)}
                      onChange={(event) => setTemplateDraft({ ...templateDraft, rate: { ...draftRate, numerator: keyToSource(event.target.value) } })}
                    >
                      {sourceOptions}
                    </select>
                    <small>被除的那个数，通常和取值一致。</small>
                  </label>
                  <label className="form-field">
                    <span>分母</span>
                    <select
                      value={denominatorToKey(draftRate.denominator)}
                      onChange={(event) => setTemplateDraft({ ...templateDraft, rate: { ...draftRate, denominator: keyToDenominator(event.target.value) } })}
                    >
                      <option value="calendarDays">周期日历天数</option>
                      <option value="usageHours">使用小时数</option>
                      <option value="deviceCount">在用设备台数</option>
                      {ctx.fields.map((field) => (
                        <option key={field.key} value={`field:${field.key}`}>
                          填报字段：{fieldLabelOf(ctx, field.key)}
                        </option>
                      ))}
                    </select>
                    <small>除以什么：按天摊、按小时摊、按台数摊，或除以另一个填报字段。</small>
                  </label>
                  <label className={styles.percentField}>
                    <input
                      type="checkbox"
                      checked={draftRate.percent}
                      onChange={(event) => setTemplateDraft({ ...templateDraft, rate: { ...draftRate, percent: event.target.checked } })}
                    />
                    <span>按百分比显示（× 100）</span>
                  </label>
                </div>
              ) : null}
              <label className="form-field">
                <span>分组维度</span>
                <select
                  value={templateDraft.groupBy}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, groupBy: event.target.value as ChartTemplate["groupBy"] })}
                >
                  {(Object.keys(GROUP_BY_LABELS) as ChartTemplate["groupBy"][]).map((groupBy) => (
                    <option key={groupBy} value={groupBy}>{GROUP_BY_LABELS[groupBy]}</option>
                  ))}
                </select>
                <small>图上的每根柱子 / 每个扇区代表什么：按科室、按设备、按成本构成拆，或按期间看趋势。</small>
              </label>
              <label className="form-field">
                <span>取值说明</span>
                <textarea
                  rows={2}
                  value={templateDraft.description}
                  onChange={(event) => setTemplateDraft({ ...templateDraft, description: event.target.value })}
                  placeholder="给同事看的一句话说明，例如：按科室汇总当期维修费"
                />
                <small>选填；显示在模板库列表里，帮别人判断该不该用这个模板。</small>
              </label>
            </div>
            <div className="editor-footer">
              <button className="secondary-button" type="button" onClick={() => setTemplateDraft(null)}>取消</button>
              <button className="primary-button" type="submit"><Save size={16} />保存模板</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
