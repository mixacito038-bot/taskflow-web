"use client";

import { CSSProperties, FormEvent, useMemo, useState } from "react";
import { CircleAlert, ClipboardList, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";

import { normalizeFieldKey } from "./device-ledger-fields";
import {
  DEFAULT_REPORT_FIELDS,
  PERIOD_GRANULARITY_LABELS,
  PeriodGranularity,
  REPORT_FIELD_ERROR_MESSAGES,
  REPORT_FIELD_GROUPS,
  ReportFieldDefinition,
  ReportFieldGroupId,
  ReportFieldSource,
  ReportFieldType,
  mergeReportFields,
  reportFieldLabel,
  reportFieldsByGroup,
  validateReportFieldDefinition,
} from "./device-report-fields";

const FIELD_TYPE_LABELS: Record<ReportFieldType, string> = { integer: "整数", decimal: "小数", text: "文本" };

/** 名称预览要覆盖全部粒度：医院只在月粒度看过名字，换到周粒度才发现读不通就晚了。 */
const PREVIEW_GRANULARITIES: readonly PeriodGranularity[] = ["day", "week", "month", "quarter", "range"];

/** 业务量三项由数据准备中心上传，本页只做标注，不提供改成手工填的口子。 */
const WORKLOAD_IMPORT_KEYS = new Set(["examVolume", "positiveCount", "totalRevenue"]);

const FACTORY_BY_KEY = new Map(DEFAULT_REPORT_FIELDS.map((field) => [field.key, field]));

/** 与 validateReportFieldDefinition 的保留表保持一致，自动生成标识时先避开它们，免得生成完再被打回。 */
const RESERVED_REPORT_KEYS = new Set<string>([
  ...DEFAULT_REPORT_FIELDS.map((field) => field.key),
  "deviceId",
  "periodKey",
  "status",
]);

// status-pill 全局只有 success/warning/danger/neutral 四档，蓝紫两色用主题变量补；
// 写死十六进制切到深色主题会刺眼。
const SOURCE_TONES: Record<ReportFieldSource, { label: string; text: string; fill: string }> = {
  manual: { label: "手工填报", text: "var(--primary)", fill: "var(--primary-soft)" },
  import: { label: "数据准备中心导入", text: "var(--violet)", fill: "var(--violet-soft)" },
};

const HINT_STYLE: CSSProperties = { color: "var(--muted)", fontSize: 12, lineHeight: 1.6 };
const SUBTEXT_STYLE: CSSProperties = { display: "block", marginTop: 4, color: "var(--muted)", fontSize: 12, lineHeight: 1.5 };
const GROUP_SECTION_STYLE: CSSProperties = { border: "1px solid var(--border)", borderRadius: 12, padding: "13px 14px" };

type ConfirmAction = { kind: "reset" } | { kind: "remove"; field: ReportFieldDefinition };

function SourcePill({ source }: { source: ReportFieldSource }) {
  const tone = SOURCE_TONES[source];
  return <span className="status-pill" style={{ color: tone.text, background: tone.fill }}>{tone.label}</span>;
}

/**
 * 由名称推导标识。
 *
 * 医院都用中文命名（「{期}外送检测费」），中文过 normalizeFieldKey 是空串，
 * 直接拿去当标识只会报「标识只能用字母数字下划线」，等于逼用户自己想英文名，
 * 所以回退到 field_N，并避开出厂键和已占用的标识。
 */
function deriveReportFieldKey(label: string, existing: readonly ReportFieldDefinition[]): string {
  const taken = new Set<string>([...existing.map((field) => field.key), ...RESERVED_REPORT_KEYS]);
  const normalized = normalizeFieldKey(label);
  if (normalized && !taken.has(normalized)) return normalized;
  if (normalized) {
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${normalized}_${index}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `field_${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return "";
}

function emptyDraft(order: number): ReportFieldDefinition {
  return {
    key: "",
    labelPattern: "",
    unit: "",
    groupId: "other",
    type: "decimal",
    required: false,
    source: "manual",
    // 默认不计入：新字段悄悄进了总成本合计，医院对不上账时最难查。
    countsToCost: false,
    hint: "",
    order,
    builtin: false,
  };
}

export default function ReportFieldSettings({
  fields,
  onChange,
  canManage,
  notify,
  onBack,
}: {
  /** 医院自定义/改写过的字段（云端资源 reportFields 的值），不含未被改写的出厂项 */
  fields: ReportFieldDefinition[];
  onChange: (next: ReportFieldDefinition[]) => void;
  /** cost.manage 权限 */
  canManage: boolean;
  notify: (message: string, tone?: "info" | "error") => void;
  onBack: () => void;
}) {
  // fields 是覆盖层，填报页真正用的是它并到 18 项出厂字段之上的结果，页面必须按合并结果展示。
  const effective = useMemo(() => mergeReportFields(fields), [fields]);
  const grouped = useMemo(() => reportFieldsByGroup(effective), [effective]);
  const overriddenKeys = useMemo(() => new Set(fields.map((field) => field.key)), [fields]);
  const customCount = fields.filter((field) => !FACTORY_BY_KEY.has(field.key)).length;
  const rewrittenCount = fields.length - customCount;

  const [draft, setDraft] = useState<ReportFieldDefinition | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  // 标识是填报记录的下标，创建后不可改。
  const keyLocked = editingKey !== null;
  const editingFactory = editingKey ? FACTORY_BY_KEY.get(editingKey) : undefined;
  // 改写出厂项时，分组/类型/计入成本都由平台口径固定，只当只读回显。
  const factoryLocked = editingFactory !== undefined;

  function openCreate() {
    setDraft(emptyDraft(effective.length ? Math.max(...effective.map((field) => field.order)) + 1 : 1));
    setEditingKey(null);
  }

  function openEdit(field: ReportFieldDefinition) {
    setDraft({ ...field });
    setEditingKey(field.key);
  }

  function closeDraft() {
    setDraft(null);
    setEditingKey(null);
  }

  /** 覆盖层按 key 写入：同 key 就替换，没有就追加，标识锁死后不会出现改键留旧条的情况。 */
  function upsertOverride(candidate: ReportFieldDefinition) {
    onChange(fields.some((field) => field.key === candidate.key)
      ? fields.map((field) => field.key === candidate.key ? candidate : field)
      : [...fields, candidate]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const labelPattern = draft.labelPattern.trim();
    /**
     * 改写出厂项时整条拷出厂定义，只换名称/单位/必填/提示/顺序：
     * 覆盖层存的是完整对象，缺一项 mergeReportFields 合出来就是残缺定义。
     */
    const candidate: ReportFieldDefinition = editingFactory
      ? {
          ...editingFactory,
          labelPattern: labelPattern || editingFactory.labelPattern,
          unit: draft.unit.trim(),
          required: draft.required,
          hint: draft.hint.trim(),
          order: draft.order,
        }
      : {
          ...draft,
          labelPattern,
          key: keyLocked ? draft.key : (normalizeFieldKey(draft.key) || deriveReportFieldKey(labelPattern, effective)),
          unit: draft.unit.trim(),
          hint: draft.hint.trim(),
          builtin: false,
        };
    // 出厂 key 本身就在保留表里，改写出厂项整条送进校验必然报 key_reserved，所以只校验名称。
    const error = editingFactory
      ? (labelPattern ? null : ("label_required" as const))
      : validateReportFieldDefinition(candidate, effective, editingKey ?? undefined);
    if (error) return notify(REPORT_FIELD_ERROR_MESSAGES[error], "error");
    upsertOverride(candidate);
    const name = reportFieldLabel(candidate, "month");
    notify(editingKey ? `字段「${name}」已保存` : `字段「${name}」已加入填报页`);
    closeDraft();
  }

  function remove(field: ReportFieldDefinition) {
    onChange(fields.filter((item) => item.key !== field.key));
    notify(`已删除字段「${reportFieldLabel(field, "month")}」；已填报的值仍保留，重新添加同标识的字段即可恢复显示`);
  }

  /** 还原出厂 = 从覆盖层里摘掉这一条，出厂定义自然重新生效。 */
  function revert(field: ReportFieldDefinition) {
    onChange(fields.filter((item) => item.key !== field.key));
    notify(`「${reportFieldLabel(field, "month")}」已还原为出厂口径`);
  }

  function restoreDefaults() {
    // 覆盖层清空即回到 18 项出厂原样，不需要把出厂定义再写一遍进去。
    onChange([]);
    notify(`已恢复平台出厂的 ${DEFAULT_REPORT_FIELDS.length} 项填报字段`);
  }

  function runConfirmAction() {
    if (!confirmAction) return;
    if (confirmAction.kind === "reset") restoreDefaults();
    else remove(confirmAction.field);
    setConfirmAction(null);
  }

  const previewPattern = draft ? draft.labelPattern.trim() : "";

  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow"><ClipboardList size={15} />设备数据填报</div><h1>填报字段配置</h1></div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={onBack}>返回设备数据填报</button>
          {canManage ? <button className="secondary-button" onClick={() => setConfirmAction({ kind: "reset" })}><RotateCcw size={16} />恢复出厂字段</button> : null}
          {canManage ? <button className="primary-button" onClick={openCreate}><Plus size={17} />新增字段</button> : null}
        </div>
      </div>

      {!canManage ? <div className="dialog-warning"><CircleAlert size={16} />当前角色只能查看，修改需要「设备数据填报」管理权限。</div> : null}

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>生效中的填报字段</h3>
            <p>共 {effective.length} 项：{DEFAULT_REPORT_FIELDS.length} 项出厂字段（其中 {rewrittenCount} 项已改写）+ {customCount} 项自建字段</p>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {grouped.map(({ group, fields: groupFields }) => (
            <div key={group.id} style={GROUP_SECTION_STYLE}>
              <div className="panel-heading" style={{ marginBottom: groupFields.length ? 10 : 0 }}>
                <div><h3>{group.label}</h3><p>{group.hint}</p></div>
                <span className="chart-note">{groupFields.length} 项</span>
              </div>
              {groupFields.length ? (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>字段名称</th>
                        <th>标识</th>
                        <th>单位</th>
                        <th>类型</th>
                        <th>数据来源</th>
                        <th>必填</th>
                        <th>计入总成本</th>
                        <th className="action-col action-wide">操作</th>
                      </tr>
                    </thead>
                    <tbody>{groupFields.map((field) => {
                      const name = reportFieldLabel(field, "month");
                      return (
                        <tr key={field.key}>
                          <td>
                            <strong>{name}</strong>
                            {field.labelPattern.includes("{期}") ? (
                              <small style={SUBTEXT_STYLE}>随周期粒度显示为：{PREVIEW_GRANULARITIES.filter((item) => item !== "month").map((item) => reportFieldLabel(field, item)).join(" / ")}</small>
                            ) : null}
                            {field.builtin && overriddenKeys.has(field.key) ? <small style={SUBTEXT_STYLE}>已改写出厂口径</small> : null}
                          </td>
                          <td><code>{field.key}</code></td>
                          <td>{field.unit || "—"}</td>
                          <td>{FIELD_TYPE_LABELS[field.type]}</td>
                          <td><SourcePill source={field.source} /></td>
                          <td>{field.required ? <span className="status-pill warning">必填</span> : <span className="status-pill neutral">选填</span>}</td>
                          <td>{field.countsToCost ? "是" : "否"}</td>
                          <td className="action-col action-wide">
                            {canManage ? (
                              <span className="action-cell">
                                <button className="text-button" type="button" onClick={() => openEdit(field)}>{field.builtin ? "改写" : "编辑"}</button>
                                {field.builtin && overriddenKeys.has(field.key) ? <button className="text-button" type="button" onClick={() => revert(field)}>还原出厂</button> : null}
                                {field.builtin ? (
                                  <button
                                    className="icon-button"
                                    type="button"
                                    disabled
                                    title="出厂字段的口径被指标字典引用，删了指标就断了；不需要可以设为选填"
                                    aria-label={`${name}是出厂字段，不可删除`}
                                  ><Trash2 size={16} /></button>
                                ) : (
                                  <button className="icon-button danger" type="button" aria-label={`删除${name}`} onClick={() => setConfirmAction({ kind: "remove", field })}><Trash2 size={16} /></button>
                                )}
                              </span>
                            ) : <span className="chart-note">只读</span>}
                          </td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              ) : <small style={HINT_STYLE}>这一组还没有字段。</small>}
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h3>出厂字段说明</h3>
            <p>平台内置 {DEFAULT_REPORT_FIELDS.length} 项；标识、类型、数据来源和是否计入成本由平台固定，只能改名称、单位、必填、提示和顺序</p>
          </div>
        </div>
        <div className="editor-tip"><CircleAlert size={16} />业务量与收入三项（{[...WORKLOAD_IMPORT_KEYS].map((key) => reportFieldLabel(FACTORY_BY_KEY.get(key)!, "month")).join("、")}）由数据准备中心表格上传，不在填报页手工填。</div>
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead><tr><th>名称</th><th>标识</th><th>分组</th><th>数据来源</th><th>计入总成本</th></tr></thead>
            <tbody>{DEFAULT_REPORT_FIELDS.map((field) => (
              <tr key={field.key}>
                <td>
                  <strong>{reportFieldLabel(field, "month")}</strong>
                  {WORKLOAD_IMPORT_KEYS.has(field.key) ? <small style={SUBTEXT_STYLE}>由数据准备中心表格上传，不在填报页手工填</small> : null}
                </td>
                <td><code>{field.key}</code></td>
                <td>{REPORT_FIELD_GROUPS.find((group) => group.id === field.groupId)?.label ?? field.groupId}</td>
                <td><SourcePill source={field.source} /></td>
                <td>{field.countsToCost ? "是" : "否"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      {draft ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDraft(); }}>
          <form className="editor-drawer" onSubmit={submit}>
            <div className="editor-header">
              <div><span className="eyebrow">填报字段</span><h2>{factoryLocked ? "改写出厂字段" : editingKey ? "编辑字段" : "新增字段"}</h2></div>
              <button className="icon-button" type="button" onClick={closeDraft} aria-label="关闭"><X size={19} /></button>
            </div>
            <div className="editor-body">
              <label className="form-field"><span>字段名称<i className="required-mark">必填</i></span>
                <input required value={draft.labelPattern} onChange={(event) => setDraft({ ...draft, labelPattern: event.target.value })} placeholder="例如：{期}外送检测费" />
                <small style={HINT_STYLE}>名称里可以用 {"{期}"} 占位符：填「{"{期}"}维修费」，月粒度显示「月维修费」，周粒度显示「周维修费」。</small>
              </label>
              {previewPattern.includes("{期}") ? (
                <div className="form-field"><span>名称预览</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {PREVIEW_GRANULARITIES.map((granularity) => (
                      <span key={granularity} className="status-pill neutral">
                        {PERIOD_GRANULARITY_LABELS[granularity]}：{reportFieldLabel({ ...draft, labelPattern: previewPattern }, granularity)}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              <label className="form-field"><span>字段标识</span>
                <input
                  value={draft.key}
                  disabled={keyLocked}
                  onChange={(event) => setDraft({ ...draft, key: normalizeFieldKey(event.target.value) })}
                  placeholder="留空则按名称自动生成"
                />
                <small style={HINT_STYLE}>{keyLocked
                  ? "标识创建后不可修改：已填的数据以它为下标，改了等于把历史数据丢了。"
                  : "留空即可；中文名会自动编号为 field_1、field_2…。也可自己填字母、数字和下划线。"}</small>
              </label>
              <div className="form-row two">
                <label className="form-field"><span>单位</span>
                  <input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} placeholder="例如：天 / 小时 / 元 / 人次 / 例" />
                </label>
                <label className="form-field"><span>所属分组</span>
                  <select value={draft.groupId} disabled={factoryLocked} onChange={(event) => setDraft({ ...draft, groupId: event.target.value as ReportFieldGroupId })}>
                    {REPORT_FIELD_GROUPS.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}
                  </select>
                </label>
              </div>
              <div className="form-row two">
                <label className="form-field"><span>字段类型</span>
                  <select value={draft.type} disabled={factoryLocked} onChange={(event) => setDraft({ ...draft, type: event.target.value as ReportFieldType })}>
                    {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="form-field"><span>是否必填</span>
                  <select value={draft.required ? "required" : "optional"} onChange={(event) => setDraft({ ...draft, required: event.target.value === "required" })}>
                    <option value="optional">选填</option>
                    <option value="required">必填</option>
                  </select>
                </label>
              </div>
              <label className="form-field"><span>是否计入当期总成本</span>
                <select value={draft.countsToCost ? "yes" : "no"} disabled={factoryLocked} onChange={(event) => setDraft({ ...draft, countsToCost: event.target.value === "yes" })}>
                  <option value="no">不计入</option>
                  <option value="yes">计入</option>
                </select>
                <small style={HINT_STYLE}>{factoryLocked
                  ? "出厂字段是否计入成本由平台口径固定，不可改，否则总成本会和指标字典对不上。"
                  : "计入的字段会加进「当期总成本」，进而影响单次检查成本、当期结余。"}</small>
              </label>
              <label className="form-field"><span>录入提示</span>
                <input value={draft.hint} onChange={(event) => setDraft({ ...draft, hint: event.target.value })} placeholder="显示在录入框下方，例如：含配件和外购服务" />
              </label>
              <label className="form-field"><span>顺序</span>
                <input type="number" min={1} value={draft.order} onChange={(event) => setDraft({ ...draft, order: Number(event.target.value) || 0 })} />
                <small style={HINT_STYLE}>数字越小越靠前，决定它在所属分组里的位置。</small>
              </label>
              <div className="editor-tip"><CircleAlert size={16} />{factoryLocked
                ? "出厂字段只能改名称、单位、必填、提示和顺序；其余口径改了会和指标字典对不上。"
                : "删除字段只摘掉这一列，已填报的值仍保留在记录里。"}</div>
            </div>
            <div className="editor-footer">
              <button className="secondary-button" type="button" onClick={closeDraft}>取消</button>
              <button className="primary-button" type="submit"><Save size={17} />保存字段</button>
            </div>
          </form>
        </div>
      ) : null}

      {confirmAction ? (
        <div className="modal-backdrop confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="report-field-confirm-title">
          <section className="confirmation-dialog">
            <span className="confirmation-icon">{confirmAction.kind === "reset" ? <RotateCcw size={22} /> : <Trash2 size={22} />}</span>
            <div>
              <small>{confirmAction.kind === "reset" ? "覆盖当前配置" : "从填报页移除"}</small>
              <h2 id="report-field-confirm-title">{confirmAction.kind === "reset"
                ? "恢复出厂字段？"
                : `删除字段「${reportFieldLabel(confirmAction.field, "month")}」？`}</h2>
              <p>{confirmAction.kind === "reset"
                ? `自建字段和对出厂项的改写会全部清空，填报页回到 ${DEFAULT_REPORT_FIELDS.length} 项出厂字段原样。已填报的数据不会被删除。`
                : "填报页不再显示这一列；已填的值仍留在记录里，重新添加同标识的字段就能看到。"}</p>
            </div>
            <footer>
              <button className="secondary-button" onClick={() => setConfirmAction(null)}>取消</button>
              <button className="danger-button" onClick={runConfirmAction}>{confirmAction.kind === "reset" ? "确认恢复出厂" : "确认删除"}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
