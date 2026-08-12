"use client";

import { FormEvent, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CircleAlert, Columns3, Plus, Save, Trash2, X } from "lucide-react";

import {
  BUILTIN_LEDGER_COLUMNS,
  deriveFieldKey,
  LEDGER_FIELD_ERROR_MESSAGES,
  LEDGER_FIELD_TYPE_LABELS,
  LedgerFieldDefinition,
  LedgerFieldType,
  normalizeFieldKey,
  sortedLedgerFields,
  validateFieldDefinition,
} from "./device-ledger-fields";

function emptyDraft(order: number): LedgerFieldDefinition {
  return { key: "", label: "", type: "text", required: false, options: [], hint: "", visibleInTable: true, order };
}

export default function LedgerFieldSettings({
  fields,
  onChange,
  canManage,
  notify,
  onBack,
}: {
  fields: LedgerFieldDefinition[];
  onChange: (next: LedgerFieldDefinition[]) => void;
  canManage: boolean;
  notify: (message: string, tone?: "info" | "error") => void;
  onBack: () => void;
}) {
  const ordered = useMemo(() => sortedLedgerFields(fields), [fields]);
  const [draft, setDraft] = useState<LedgerFieldDefinition | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [optionText, setOptionText] = useState("");
  // 键在创建后不可改：设备记录用它当下标，改了等于把已填的值全丢了。
  const keyLocked = editingKey !== null;

  function openCreate() {
    setDraft(emptyDraft(ordered.length ? Math.max(...ordered.map((field) => field.order)) + 1 : 1));
    setEditingKey(null);
    setOptionText("");
  }

  function openEdit(field: LedgerFieldDefinition) {
    setDraft({ ...field, options: [...field.options] });
    setEditingKey(field.key);
    setOptionText(field.options.join("\n"));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const options = draft.type === "select"
      ? optionText.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
    const candidate: LedgerFieldDefinition = {
      ...draft,
      label: draft.label.trim(),
      // 中文字段名规范化后是空串，这里回退到 field_N，别让用户被迫自己想英文标识
      key: keyLocked ? draft.key : (normalizeFieldKey(draft.key) || deriveFieldKey(draft.label, ordered)),
      hint: draft.hint.trim(),
      options,
    };
    const error = validateFieldDefinition(candidate, ordered, editingKey ?? undefined);
    if (error) return notify(LEDGER_FIELD_ERROR_MESSAGES[error], "error");
    onChange(editingKey
      ? ordered.map((field) => field.key === editingKey ? candidate : field)
      : [...ordered, candidate]);
    notify(editingKey ? `字段「${candidate.label}」已保存` : `字段「${candidate.label}」已加入台账`);
    setDraft(null);
    setEditingKey(null);
  }

  function remove(field: LedgerFieldDefinition) {
    onChange(ordered.filter((item) => item.key !== field.key));
    // 只摘掉列定义，设备记录里已填的值原样留着：万一是误删，重新加回同名字段就能看到。
    notify(`已删除字段「${field.label}」；设备上已填写的值仍保留，重新添加同标识的字段即可恢复显示`);
  }

  function move(field: LedgerFieldDefinition, delta: number) {
    const index = ordered.findIndex((item) => item.key === field.key);
    const target = index + delta;
    if (index === -1 || target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next.map((item, position) => ({ ...item, order: position + 1 })));
  }

  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow"><Columns3 size={15} />设备台账</div><h1>台账字段配置</h1></div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={onBack}>返回设备台账</button>
          {canManage ? <button className="primary-button" onClick={openCreate}><Plus size={17} />新增字段</button> : null}
        </div>
      </div>

      {!canManage ? <div className="dialog-warning"><CircleAlert size={16} />当前角色只能查看字段配置，修改需要「设备台账」管理权限。</div> : null}

      <section className="panel">
        <div className="panel-heading"><div><h3>自定义字段</h3><p>{ordered.length ? `共 ${ordered.length} 个；顺序即台账里的列顺序` : "还没有自定义字段"}</p></div></div>
        {ordered.length ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>字段名称</th><th>标识</th><th>类型</th><th>必填</th><th>台账显示</th><th>候选项 / 提示</th><th className="action-col action-wide">操作</th></tr></thead>
              <tbody>{ordered.map((field, index) => (
                <tr key={field.key}>
                  <td><strong>{field.label}</strong></td>
                  <td><code>{field.key}</code></td>
                  <td>{LEDGER_FIELD_TYPE_LABELS[field.type]}</td>
                  <td>{field.required ? <span className="status-pill warning">必填</span> : <span className="status-pill neutral">选填</span>}</td>
                  <td>{field.visibleInTable ? "显示为一列" : "仅在编辑弹窗"}</td>
                  <td>{field.type === "select" ? field.options.join(" / ") : field.hint || "—"}</td>
                  <td className="action-col action-wide">
                    {canManage ? (
                      <span className="action-cell">
                        <button className="icon-button" aria-label={`上移${field.label}`} disabled={index === 0} onClick={() => move(field, -1)}><ArrowUp size={16} /></button>
                        <button className="icon-button" aria-label={`下移${field.label}`} disabled={index === ordered.length - 1} onClick={() => move(field, 1)}><ArrowDown size={16} /></button>
                        <button className="text-button" onClick={() => openEdit(field)}>编辑</button>
                        <button className="icon-button danger" aria-label={`删除${field.label}`} onClick={() => remove(field)}><Trash2 size={16} /></button>
                      </span>
                    ) : <span className="chart-note">只读</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : (
          <div className="ledger-empty">
            <Columns3 size={26} />
            <strong>还没有自定义字段</strong>
            <p>比如「设备来源」「合同编号」「维保到期日」这类本院要管、系统内置列里没有的信息，都可以加在这里。</p>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading"><div><h3>系统内置列</h3></div></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>列</th><th>标识</th><th>说明</th></tr></thead>
            <tbody>{BUILTIN_LEDGER_COLUMNS.map((column) => (
              <tr key={column.key}><td>{column.label}</td><td><code>{column.key}</code></td><td>{column.note || "—"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      {draft ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}>
          <form className="editor-drawer" onSubmit={submit}>
            <div className="editor-header">
              <div><span className="eyebrow">台账字段</span><h2>{editingKey ? "编辑字段" : "新增字段"}</h2></div>
              <button className="icon-button" type="button" onClick={() => setDraft(null)} aria-label="关闭"><X size={19} /></button>
            </div>
            <div className="editor-body">
              <label className="form-field"><span>字段名称<i className="required-mark">必填</i></span>
                <input required value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} placeholder="例如：维保到期日" />
              </label>
              <label className="form-field"><span>字段标识</span>
                <input
                  value={draft.key}
                  disabled={keyLocked}
                  onChange={(event) => setDraft({ ...draft, key: normalizeFieldKey(event.target.value) })}
                  placeholder="留空则按名称自动生成"
                />
                <small>{keyLocked ? "标识创建后不可修改：设备上已填的值以它为准。" : "留空即可；中文名会自动编号为 field_1、field_2…。也可自己填字母、数字和下划线，导出文件的列名会用它。"}</small>
              </label>
              <div className="form-row two">
                <label className="form-field"><span>字段类型</span>
                  <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as LedgerFieldType })}>
                    {Object.entries(LEDGER_FIELD_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="form-field"><span>是否必填</span>
                  <select value={draft.required ? "required" : "optional"} onChange={(event) => setDraft({ ...draft, required: event.target.value === "required" })}>
                    <option value="optional">选填</option>
                    <option value="required">必填</option>
                  </select>
                  <small>必填字段在保存设备时会拦下空值；选填留空显示为“—”。</small>
                </label>
              </div>
              {draft.type === "select" ? (
                <label className="form-field"><span>候选项<i className="required-mark">必填</i></span>
                  <textarea rows={4} value={optionText} onChange={(event) => setOptionText(event.target.value)} placeholder={"一行一个，例如：\n院内自购\n厂家投放\n科研借用"} />
                  <small>录入时只能从这些候选项里选。</small>
                </label>
              ) : (
                <label className="form-field"><span>录入提示</span>
                  <input value={draft.hint} onChange={(event) => setDraft({ ...draft, hint: event.target.value })} placeholder="显示在录入框下方，例如：填写合同约定的到期日" />
                </label>
              )}
              <label className="form-field"><span>台账显示</span>
                <select value={draft.visibleInTable ? "table" : "editor"} onChange={(event) => setDraft({ ...draft, visibleInTable: event.target.value === "table" })}>
                  <option value="table">在设备台账里显示为一列</option>
                  <option value="editor">只在新增/编辑设备时录入</option>
                </select>
                <small>列多了表格会很宽；不常看的字段建议只在编辑弹窗里录入。</small>
              </label>
              <div className="editor-tip"><CircleAlert size={16} />删除字段只会摘掉这一列，设备上已填的值仍然保留；重新添加同标识的字段即可恢复显示。</div>
            </div>
            <div className="editor-footer">
              <button className="secondary-button" type="button" onClick={() => setDraft(null)}>取消</button>
              <button className="primary-button" type="submit"><Save size={17} />保存字段</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
