"use client";

import { FormEvent, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, CircleAlert, Plus, Save, Tags, Trash2, X } from "lucide-react";

import {
  evidenceTone,
  METRIC_CATEGORY_TONES,
  MetricCategory,
  MetricCategoryTone,
  MetricDictionaryEntry,
  MetricEvidenceLevel,
  metricCategory,
} from "./metric-dictionary";

const EVIDENCE_LEVELS: MetricEvidenceLevel[] = ["是", "部分相关", "否", "未标注"];

// 色标必须落在主题变量上：写死十六进制色值，切到深色主题就会亮瞎。
const TONE_COLORS: Record<MetricCategoryTone, { text: string; fill: string }> = {
  blue: { text: "var(--primary)", fill: "var(--primary-soft)" },
  green: { text: "var(--green)", fill: "var(--green-soft)" },
  orange: { text: "var(--orange)", fill: "var(--orange-soft)" },
  purple: { text: "var(--violet)", fill: "var(--violet-soft)" },
  red: { text: "var(--red)", fill: "var(--red-soft)" },
  slate: { text: "var(--slate)", fill: "var(--surface-soft)" },
};

const TONE_LABELS: Record<MetricCategoryTone, string> = {
  blue: "蓝",
  green: "绿",
  orange: "橙",
  purple: "紫",
  red: "红",
  slate: "灰",
};

/**
 * 原文形如「部分相关（资料+行业标准）」：前半截是可比对的档位，括号里是各院自己写的说明。
 * 拆成两个控件编辑、保存时再拼回同一串，既能让 evidenceTone 继续按档位判色，
 * 也不会把医院原来的措辞洗掉。
 */
function splitEvidence(evidence: string): { level: MetricEvidenceLevel; extra: string } {
  const text = evidence.trim();
  const level = EVIDENCE_LEVELS.find((item) => text.startsWith(item));
  if (!level) return { level: "未标注", extra: text };
  const rest = text.slice(level.length).trim();
  const wrapped = rest.startsWith("（") && rest.endsWith("）");
  return { level, extra: wrapped ? rest.slice(1, -1) : rest };
}

function joinEvidence(level: MetricEvidenceLevel, extra: string): string {
  const note = extra.trim();
  return note ? `${level}（${note}）` : level;
}

/** 计算口径和出处都是整段原文（含换行），表格里只放一行摘要，完整内容看编辑弹窗或悬浮提示。 */
function preview(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return "—";
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function nextId(prefix: string, taken: string[]): string {
  let index = taken.length + 1;
  while (taken.includes(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

/** 序号就是字典里的行号，增删和上下移之后都重排成 1…N，避免出现断号。 */
function resequence(list: MetricDictionaryEntry[]): MetricDictionaryEntry[] {
  return list.map((item, position) => ({ ...item, seq: position + 1 }));
}

function emptyEntry(categoryId: string, seq: number): MetricDictionaryEntry {
  return { id: "", seq, name: "", categoryId, formula: "", evidence: "", source: "", system: "", note: "" };
}

function ToneDot({ tone }: { tone: MetricCategoryTone }) {
  return (
    <i
      aria-hidden
      style={{ width: 12, height: 12, flex: "0 0 auto", borderRadius: 4, background: TONE_COLORS[tone].text, display: "inline-block" }}
    />
  );
}

function CategoryChip({ category }: { category: MetricCategory | undefined }) {
  if (!category) return <span className="status-pill neutral">分类已删除</span>;
  return (
    <span className="status-pill" style={{ color: TONE_COLORS[category.tone].text, background: TONE_COLORS[category.tone].fill }}>
      {category.label}
    </span>
  );
}

export default function MetricDictionarySettings({
  entries,
  categories,
  onEntriesChange,
  onCategoriesChange,
  canManage,
  notify,
  onBack,
}: {
  entries: MetricDictionaryEntry[];
  categories: MetricCategory[];
  onEntriesChange: (next: MetricDictionaryEntry[]) => void;
  onCategoriesChange: (next: MetricCategory[]) => void;
  canManage: boolean;
  notify: (message: string, tone?: "info" | "error") => void;
  onBack: () => void;
}) {
  const ordered = useMemo(() => [...entries].sort((left, right) => left.seq - right.seq), [entries]);
  const usage = useMemo(() => {
    const counter = new Map<string, number>();
    for (const entry of entries) counter.set(entry.categoryId, (counter.get(entry.categoryId) ?? 0) + 1);
    return counter;
  }, [entries]);

  const [entryDraft, setEntryDraft] = useState<MetricDictionaryEntry | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [evidenceLevel, setEvidenceLevel] = useState<MetricEvidenceLevel>("未标注");
  const [evidenceExtra, setEvidenceExtra] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<MetricCategory | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  function openCreateEntry() {
    const first = categories[0];
    if (!first) return notify("请先建一个分类，指标必须挂在分类下面", "error");
    setEntryDraft(emptyEntry(first.id, ordered.length + 1));
    setEditingEntryId(null);
    setEvidenceLevel("未标注");
    setEvidenceExtra("");
  }

  function openEditEntry(entry: MetricDictionaryEntry) {
    const evidence = splitEvidence(entry.evidence);
    setEntryDraft({ ...entry });
    setEditingEntryId(entry.id);
    setEvidenceLevel(evidence.level);
    setEvidenceExtra(evidence.extra);
  }

  function closeEntry() {
    setEntryDraft(null);
    setEditingEntryId(null);
  }

  function submitEntry(event: FormEvent) {
    event.preventDefault();
    if (!entryDraft) return;
    const name = entryDraft.name.trim();
    if (!name) return notify("指标名称必填", "error");
    if (!metricCategory(categories, entryDraft.categoryId)) return notify("请为指标选择一个分类", "error");
    const candidate: MetricDictionaryEntry = {
      ...entryDraft,
      id: editingEntryId ?? nextId("metric", entries.map((item) => item.id)),
      name,
      formula: entryDraft.formula.trim(),
      evidence: joinEvidence(evidenceLevel, evidenceExtra),
      source: entryDraft.source.trim(),
      system: entryDraft.system.trim(),
      note: entryDraft.note.trim(),
    };
    // 同名不拦：不同院区可能真有同名口径，只在提示里说清楚，让填报人自己判断。
    const duplicated = ordered.some((item) => item.id !== editingEntryId && item.name === name);
    onEntriesChange(resequence(editingEntryId
      ? ordered.map((item) => item.id === editingEntryId ? candidate : item)
      : [...ordered, candidate]));
    notify(duplicated
      ? `指标「${name}」已保存；字典里已有同名指标，若不是不同院区的同一口径建议改名区分`
      : editingEntryId ? `指标「${name}」已保存` : `指标「${name}」已加入字典`);
    closeEntry();
  }

  function removeEntry(entry: MetricDictionaryEntry) {
    onEntriesChange(resequence(ordered.filter((item) => item.id !== entry.id)));
    notify(`已删除指标「${entry.name}」`);
  }

  function moveEntry(entry: MetricDictionaryEntry, delta: number) {
    const index = ordered.findIndex((item) => item.id === entry.id);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    onEntriesChange(resequence(next));
  }

  function openCreateCategory() {
    setCategoryDraft({ id: "", label: "", tone: METRIC_CATEGORY_TONES[0] });
    setEditingCategoryId(null);
  }

  function openEditCategory(category: MetricCategory) {
    setCategoryDraft({ ...category });
    setEditingCategoryId(category.id);
  }

  function closeCategory() {
    setCategoryDraft(null);
    setEditingCategoryId(null);
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    if (!categoryDraft) return;
    const label = categoryDraft.label.trim();
    if (!label) return notify("分类名称必填", "error");
    // 分类重名和指标重名不一样：下拉框里两个同名分类根本分不出该选哪个，直接拦下。
    if (categories.some((item) => item.id !== editingCategoryId && item.label === label)) {
      return notify(`已有同名分类「${label}」，换个名字区分`, "error");
    }
    const candidate: MetricCategory = {
      ...categoryDraft,
      id: editingCategoryId ?? nextId("category", categories.map((item) => item.id)),
      label,
    };
    onCategoriesChange(editingCategoryId
      ? categories.map((item) => item.id === editingCategoryId ? candidate : item)
      : [...categories, candidate]);
    notify(editingCategoryId ? `分类「${label}」已保存` : `分类「${label}」已创建`);
    closeCategory();
  }

  function removeCategory(category: MetricCategory) {
    const inUse = usage.get(category.id) ?? 0;
    // 分类没了指标就成了孤儿，页面上只剩一个"分类已删除"的灰标，谁也说不清它原来属于哪一类。
    if (inUse) return notify(`分类「${category.label}」下还有 ${inUse} 条指标，请先把它们改到别的分类再删`, "error");
    onCategoriesChange(categories.filter((item) => item.id !== category.id));
    notify(`已删除分类「${category.label}」`);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><BookOpen size={15} />指标字典</div>
          <h1>指标字典配置</h1>
          
        </div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={onBack}>返回</button>
          {canManage ? <button className="primary-button" onClick={openCreateEntry}><Plus size={17} />新增指标</button> : null}
        </div>
      </div>

      {!canManage ? <div className="dialog-warning"><CircleAlert size={16} />当前角色只能查看指标字典，新增、修改和删除需要「数据口径」权限。</div> : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>指标条目</h3>
            <p>{ordered.length ? `共 ${ordered.length} 条；序号即字典里的排列顺序` : "还没有指标条目"}</p>
          </div>
        </div>
        {ordered.length ? (
          <div className="table-scroll">
            <table className="data-table dictionary-table">
              <thead>
                <tr>
                  <th>序号 / 指标名称</th>
                  <th>分类</th>
                  <th>计算口径</th>
                  <th>理论依据</th>
                  <th>数据来源/取数系统</th>
                  <th>备注</th>
                  <th className="action-col action-wide">操作</th>
                </tr>
              </thead>
              <tbody>{ordered.map((entry, index) => {
                const evidence = splitEvidence(entry.evidence);
                return (
                  <tr key={entry.id}>
                    <td><span className="source-pill">{entry.seq}</span><strong>{entry.name}</strong></td>
                    <td><CategoryChip category={metricCategory(categories, entry.categoryId)} /></td>
                    <td title={entry.formula || undefined}>{preview(entry.formula, 52)}</td>
                    <td title={entry.source || undefined}>
                      <span className={`status-pill ${evidenceTone(entry.evidence)}`}>{evidence.level}</span>
                      <div>{evidence.extra ? `${evidence.extra}｜` : ""}{preview(entry.source, 40)}</div>
                    </td>
                    <td>{entry.system || "—"}</td>
                    <td title={entry.note || undefined}>{preview(entry.note, 30)}</td>
                    <td className="action-col action-wide">
                      {canManage ? (
                        <>
                          <button className="icon-button" aria-label={`上移${entry.name}`} disabled={index === 0} onClick={() => moveEntry(entry, -1)}><ArrowUp size={15} /></button>
                          <button className="icon-button" aria-label={`下移${entry.name}`} disabled={index === ordered.length - 1} onClick={() => moveEntry(entry, 1)}><ArrowDown size={15} /></button>
                          <button className="text-button" onClick={() => openEditEntry(entry)}>编辑</button>
                          <button className="icon-button danger" aria-label={`删除${entry.name}`} onClick={() => removeEntry(entry)}><Trash2 size={15} /></button>
                        </>
                      ) : <span className="chart-note">只读</span>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : (
          <div className="ledger-empty">
            <BookOpen size={26} />
            <strong>还没有指标条目</strong>
            <p>把院内《指标梳理》表里的口径逐条录进来：一条指标要说清怎么算、依据出自哪份文件、数从哪个系统取。{canManage ? "点右上角「新增指标」开始。" : "录入需要「数据口径」权限。"}</p>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>指标分类</h3>
            <p>{categories.length ? `共 ${categories.length} 个；色标决定指标在分析页里的标签颜色` : "还没有分类"}</p>
          </div>
          {canManage ? <button className="secondary-button compact-action" onClick={openCreateCategory}><Plus size={15} />新增分类</button> : null}
        </div>
        {categories.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>分类名称</th><th>色标</th><th>使用中的指标</th><th className="action-col action-wide">操作</th></tr></thead>
              <tbody>{categories.map((category) => (
                <tr key={category.id}>
                  <td><strong>{category.label}</strong></td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <ToneDot tone={category.tone} />
                      <CategoryChip category={category} />
                    </span>
                  </td>
                  <td>{usage.get(category.id) ?? 0} 条</td>
                  <td className="action-col action-wide">
                    {canManage ? (
                      <>
                        <button className="text-button" onClick={() => openEditCategory(category)}>编辑</button>
                        <button className="icon-button danger" aria-label={`删除${category.label}`} onClick={() => removeCategory(category)}><Trash2 size={15} /></button>
                      </>
                    ) : <span className="chart-note">只读</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="ledger-empty">
            <Tags size={26} />
            <strong>还没有分类</strong>
            <p>分类是指标的分组方式，比如「经济效益」「使用效率」「设备保障」。{canManage ? "先建一个分类，才能开始录指标。" : "创建分类需要「数据口径」权限。"}</p>
          </div>
        )}
      </section>

      {entryDraft ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEntry(); }}>
          <form className="editor-drawer" onSubmit={submitEntry}>
            <div className="editor-header">
              <div><span className="eyebrow">指标字典</span><h2>{editingEntryId ? "编辑指标" : "新增指标"}</h2></div>
              <button className="icon-button" type="button" onClick={closeEntry} aria-label="关闭"><X size={19} /></button>
            </div>
            <div className="editor-body">
              <div className="form-row two">
                <label className="form-field"><span>指标名称<i className="required-mark">必填</i></span>
                  <input required value={entryDraft.name} onChange={(event) => setEntryDraft({ ...entryDraft, name: event.target.value })} placeholder="例如：设备使用率" />
                </label>
                <label className="form-field"><span>所属分类<i className="required-mark">必填</i></span>
                  <select value={entryDraft.categoryId} onChange={(event) => setEntryDraft({ ...entryDraft, categoryId: event.target.value })}>
                    {metricCategory(categories, entryDraft.categoryId) ? null : <option value="">请选择分类</option>}
                    {categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}
                  </select>
                </label>
              </div>
              <label className="form-field"><span>计算口径</span>
                <textarea rows={5} value={entryDraft.formula} onChange={(event) => setEntryDraft({ ...entryDraft, formula: event.target.value })} placeholder={"照抄院内《指标梳理》表的原文，例如：\n设备实际开机时长 ÷ 设备可用时长 × 100%\n其中：\n（1）可用时长按每日 8 小时、每周 5 天计"} />
                <small>报表被质询时要能逐字回溯到院内原表，这里保持原文措辞，不要改写。</small>
              </label>
              <div className="form-row two">
                <label className="form-field"><span>是否找到理论依据</span>
                  <select value={evidenceLevel} onChange={(event) => setEvidenceLevel(event.target.value as MetricEvidenceLevel)}>
                    {EVIDENCE_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
                  </select>
                </label>
                <label className="form-field"><span>补充说明</span>
                  <input value={evidenceExtra} onChange={(event) => setEvidenceExtra(event.target.value)} placeholder="例如：资料+行业标准" />
                  <small>填了存成「{joinEvidence(evidenceLevel, evidenceExtra || "补充说明")}」，留空只存「{evidenceLevel}」。</small>
                </label>
              </div>
              <label className="form-field"><span>理论依据出处（详细）</span>
                <textarea rows={6} value={entryDraft.source} onChange={(event) => setEntryDraft({ ...entryDraft, source: event.target.value })} placeholder={"逐条写清文件名、指标编号和页码，例如：\n《国家三级公立医院绩效考核操作手册（2024版）》指标11（第42-43页）"} />
                <small>写到能让人翻到原文那一页为止；评审时这一栏就是答辩材料。</small>
              </label>
              <label className="form-field"><span>数据来源/取数系统</span>
                <input value={entryDraft.system} onChange={(event) => setEntryDraft({ ...entryDraft, system: event.target.value })} placeholder="例如：HIS系统（收费记录）、财务科（收入核算）" />
              </label>
              <label className="form-field"><span>备注</span>
                <textarea rows={2} value={entryDraft.note} onChange={(event) => setEntryDraft({ ...entryDraft, note: event.target.value })} placeholder="口径待定、暂用手工填报之类的情况写在这里" />
              </label>
              <div className="editor-tip"><CircleAlert size={16} />指标重名不会被拦下：不同院区确实可能有同名口径，保存时只提示。</div>
            </div>
            <div className="editor-footer">
              <button className="secondary-button" type="button" onClick={closeEntry}>取消</button>
              <button className="primary-button" type="submit"><Save size={17} />保存指标</button>
            </div>
          </form>
        </div>
      ) : null}

      {categoryDraft ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCategory(); }}>
          <form className="editor-drawer" onSubmit={submitCategory}>
            <div className="editor-header">
              <div><span className="eyebrow">指标分类</span><h2>{editingCategoryId ? "编辑分类" : "新增分类"}</h2></div>
              <button className="icon-button" type="button" onClick={closeCategory} aria-label="关闭"><X size={19} /></button>
            </div>
            <div className="editor-body">
              <label className="form-field"><span>分类名称<i className="required-mark">必填</i></span>
                <input required value={categoryDraft.label} onChange={(event) => setCategoryDraft({ ...categoryDraft, label: event.target.value })} placeholder="例如：经济效益" />
              </label>
              <div className="form-field"><span>色标</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {METRIC_CATEGORY_TONES.map((tone) => (
                    <button
                      key={tone}
                      type="button"
                      aria-pressed={categoryDraft.tone === tone}
                      onClick={() => setCategoryDraft({ ...categoryDraft, tone })}
                      style={{
                        minWidth: 64,
                        minHeight: 36,
                        padding: "0 11px",
                        borderRadius: 9,
                        color: TONE_COLORS[tone].text,
                        background: TONE_COLORS[tone].fill,
                        border: `1px solid ${categoryDraft.tone === tone ? TONE_COLORS[tone].text : "var(--border)"}`,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      <ToneDot tone={tone} />{TONE_LABELS[tone]}
                    </button>
                  ))}
                </div>
                <small>预览：<CategoryChip category={{ ...categoryDraft, label: categoryDraft.label.trim() || "分类名称" }} /></small>
              </div>
              <div className="editor-tip"><CircleAlert size={16} />分类下还有指标时不能删除，得先把这些指标改到别的分类，免得留下无主指标。</div>
            </div>
            <div className="editor-footer">
              <button className="secondary-button" type="button" onClick={closeCategory}>取消</button>
              <button className="primary-button" type="submit"><Save size={17} />保存分类</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
