"use client";

import { type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  CircleAlert,
  Target,
  TriangleAlert,
  X,
} from "lucide-react";
import type { DeviceDiagnosis, DeviceFacts, Finding, FindingCode, FindingSeverity } from "./benefit-diagnosis";
import styles from "./ImprovementAlerts.module.css";
import {
  initialActions,
  normalizeActionBenefitUnits,
  type ActionSource,
  type ActionStatus,
  type ImprovementAction,
  type Priority,
} from "./improvement-actions";

// 模型与出厂数据现在住在 improvement-actions.ts；这里转出去，调用方不必跟着改 import。
export { initialActions, normalizeActionBenefitUnits };
export type { ActionSource, ActionStatus, ImprovementAction, Priority };

const currency = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

const STATUS_COLUMNS: ActionStatus[] = ["待启动", "进行中", "已完成"];
const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };
const SEVERITY_LABEL: Record<FindingSeverity, string> = { high: "高", medium: "中", low: "低" };
const SEVERITY_TONE: Record<FindingSeverity, string> = { high: "danger", medium: "warning", low: "neutral" };
const STATUS_TONE: Record<ActionStatus, string> = { 待启动: "neutral", 进行中: "warning", 已完成: "success" };

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function shiftDays(days: number) {
  const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return target.toISOString().slice(0, 10);
}

/** 逾期＝截止日早于今天且没完成。看板要靠它标红，别处也复用同一判定，避免两套口径。 */
function isOverdue(action: ImprovementAction, today: string) {
  return action.status !== "已完成" && action.dueDate < today;
}

function overdueDays(dueDate: string, today: string) {
  const diff = Date.parse(today) - Date.parse(dueDate);
  return Number.isFinite(diff) ? Math.max(1, Math.round(diff / (24 * 60 * 60 * 1000))) : 1;
}

/** 一条问题是否已被某个任务认领：优先用 sourceFinding，老任务退回文本包含判断。 */
function matchesFinding(action: ImprovementAction, deviceId: string, finding: Finding) {
  if (action.sourceFinding) {
    return action.sourceFinding.deviceId === deviceId && action.sourceFinding.code === finding.code;
  }
  return action.deviceId === deviceId && (action.issue.includes(finding.title) || action.title.includes(finding.title));
}

/** 问题类型决定拿哪个事实当基线；没有对应事实就留空，不编数字。 */
function baselineOf(code: FindingCode, facts: DeviceFacts | undefined): { value: number | null; unit: string } {
  if (!facts) return { value: null, unit: "" };
  switch (code) {
    case "low_utilization":
      return { value: facts.utilization, unit: "% 使用率" };
    case "loss":
      return { value: facts.margin, unit: "元结余" };
    case "payback_delay":
      return { value: facts.paybackYears, unit: "年回本" };
    case "high_fault":
      return { value: facts.integrity, unit: "% 完好率" };
    case "high_maintenance":
      return { value: facts.maintenanceRatio, unit: "% 维护占收入" };
    default:
      return { value: null, unit: "" };
  }
}

function numberText(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : String(Math.round(value * 100) / 100);
}

type ActionDraft = {
  id: string;
  deviceId: string;
  title: string;
  issue: string;
  owner: string;
  dueDate: string;
  priority: Priority;
  status: ActionStatus;
  progress: string;
  expectedBenefit: string;
  baselineValue: string;
  targetValue: string;
  actualValue: string;
  metricUnit: string;
  actualBenefit: string;
  evidence: string;
  sourceFinding?: ActionSource;
};

function emptyDraft(deviceId: string): ActionDraft {
  return {
    id: "",
    deviceId,
    title: "",
    issue: "",
    owner: "",
    dueDate: shiftDays(60),
    priority: "中",
    status: "待启动",
    progress: "0",
    expectedBenefit: "",
    baselineValue: "",
    targetValue: "",
    actualValue: "",
    metricUnit: "",
    actualBenefit: "",
    evidence: "",
  };
}

/** 从诊断问题预填任务：标题用诊断建议，问题描述保留证据原文，基线取对应事实。 */
function draftFromFinding(deviceId: string, finding: Finding, facts: DeviceFacts | undefined): ActionDraft {
  const baseline = baselineOf(finding.code, facts);
  return {
    ...emptyDraft(deviceId),
    title: finding.suggestion,
    issue: `${finding.title}：${finding.evidence}`,
    owner: facts?.department ?? "",
    dueDate: shiftDays(finding.severity === "high" ? 30 : finding.severity === "medium" ? 60 : 90),
    priority: finding.severity === "high" ? "高" : finding.severity === "medium" ? "中" : "低",
    baselineValue: numberText(baseline.value),
    metricUnit: baseline.unit,
    sourceFinding: { deviceId, code: finding.code, title: finding.title },
  };
}

function draftFromAction(action: ImprovementAction): ActionDraft {
  return {
    id: action.id,
    deviceId: action.deviceId,
    title: action.title,
    issue: action.issue,
    owner: action.owner,
    dueDate: action.dueDate,
    priority: action.priority,
    status: action.status,
    progress: String(action.progress),
    expectedBenefit: numberText(action.expectedBenefit),
    baselineValue: numberText(action.baselineValue),
    targetValue: numberText(action.targetValue),
    actualValue: numberText(action.actualValue),
    metricUnit: action.metricUnit ?? "",
    actualBenefit: numberText(action.actualBenefit),
    evidence: action.evidence ?? "",
    sourceFinding: action.sourceFinding,
  };
}

function optionalNumber(raw: string) {
  return raw.trim() === "" ? undefined : Number(raw);
}

/** 达成率对「越高越好」和「越低越好」都成立：都按基线到目标这段距离走了多少算。 */
function achievement(action: ImprovementAction) {
  const { baselineValue, targetValue, actualValue } = action;
  if (baselineValue === undefined || targetValue === undefined) return null;
  if (actualValue === undefined) return 0;
  const span = targetValue - baselineValue;
  if (span === 0) return actualValue === targetValue ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round(((actualValue - baselineValue) / span) * 100)));
}

export default function ImprovementCenter({
  diagnoses,
  actions,
  setActions,
  periodLabel,
  onSelectDevice,
  onSendToCapital,
  notify,
  canManage,
  pendingFinding,
  onPendingFindingConsumed,
}: {
  diagnoses: DeviceDiagnosis[];
  actions: ImprovementAction[];
  setActions: Dispatch<SetStateAction<ImprovementAction[]>>;
  periodLabel: string;
  onSelectDevice: (deviceId: string) => void;
  /** route 为 capital 的问题，一键转去资本计划 */
  onSendToCapital: (deviceId: string) => void;
  notify: (message: string, tone?: "info" | "error") => void;
  canManage: boolean;
  /** 从效益分析页点「建改进任务」带过来的问题：进页面就把新建任务弹窗打开并预填 */
  pendingFinding?: { deviceId: string; finding: Finding };
  onPendingFindingConsumed?: () => void;
}) {
  /**
   * 效益分析页带过来的问题要一进页面就把弹窗开好。
   * 用惰性初值而不是 effect：切到本页时组件是全新挂载，
   * effect 里再 setState 会先渲染一帧空列表再弹窗，看着像闪了一下。
   */
  const [draft, setDraft] = useState<ActionDraft | null>(() => {
    if (!pendingFinding) return null;
    const facts = diagnoses.find((item) => item.facts.deviceId === pendingFinding.deviceId)?.facts;
    return draftFromFinding(pendingFinding.deviceId, pendingFinding.finding, facts);
  });
  const today = todayISO();

  const factsById = useMemo(
    () => new Map(diagnoses.map((item) => [item.facts.deviceId, item.facts])),
    [diagnoses],
  );

  // Esc 关弹窗。只在弹窗打开时注册，避免常驻一个全局键盘监听。
  useEffect(() => {
    if (!draft) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDraft(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [draft]);

  // 弹窗已在惰性初值里开好，这里只回告父组件「这条问题已消费」，避免来回切页反复弹。
  const consumedRef = useRef(false);
  useEffect(() => {
    if (consumedRef.current || !pendingFinding) return;
    consumedRef.current = true;
    onPendingFindingConsumed?.();
  }, [pendingFinding, onPendingFindingConsumed]);

  const findingRows = useMemo(() => {
    const rows = diagnoses.flatMap((diagnosis) =>
      diagnosis.findings.map((finding) => ({ finding, facts: diagnosis.facts, riskScore: diagnosis.riskScore })),
    );
    return rows.sort(
      (a, b) =>
        SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity] || b.riskScore - a.riskScore,
    );
  }, [diagnoses]);

  /** 本页只认领 route === "improvement"；capital 交给资本计划，data 是填报的事，不在本页出现。 */
  const { pendingRows, claimedRows } = useMemo(() => {
    const pending: typeof findingRows = [];
    const claimed: Array<(typeof findingRows)[number] & { action: ImprovementAction }> = [];
    for (const row of findingRows) {
      if (row.finding.route !== "improvement") continue;
      const owner = actions.find((action) => matchesFinding(action, row.facts.deviceId, row.finding));
      if (owner) claimed.push({ ...row, action: owner });
      else pending.push(row);
    }
    return { pendingRows: pending, claimedRows: claimed };
  }, [actions, findingRows]);

  const capitalRows = useMemo(() => findingRows.filter((row) => row.finding.route === "capital"), [findingRows]);

  const stats = useMemo(() => {
    const done = actions.filter((action) => action.status === "已完成");
    return {
      pending: pendingRows.length,
      running: actions.filter((action) => action.status === "进行中").length,
      done: done.length,
      benefit: done.reduce((sum, action) => sum + (action.actualBenefit ?? 0), 0),
      overdue: actions.filter((action) => isOverdue(action, today)).length,
    };
  }, [actions, pendingRows.length, today]);

  const targetRows = useMemo(
    () => actions.filter((action) => action.targetValue !== undefined && action.baselineValue !== undefined),
    [actions],
  );

  function deviceLabel(deviceId: string) {
    const facts = factsById.get(deviceId);
    return facts ? `${facts.name}${facts.model ? ` · ${facts.model}` : ""}` : deviceId;
  }

  function guard() {
    if (canManage) return true;
    notify("当前账号只能查看改进任务，不能新建或修改", "error");
    return false;
  }

  function openCreate(deviceId: string, finding?: Finding) {
    if (!guard()) return;
    setDraft(finding ? draftFromFinding(deviceId, finding, factsById.get(deviceId)) : emptyDraft(deviceId));
  }

  function advanceAction(action: ImprovementAction) {
    if (!guard()) return;
    const next: ActionStatus =
      action.status === "待启动" ? "进行中" : action.status === "进行中" ? "已完成" : "进行中";
    const progress = next === "已完成" ? 100 : next === "进行中" ? Math.max(action.progress, 40) : action.progress;
    setActions((current) =>
      current.map((item) =>
        item.id === action.id
          ? {
              ...item,
              status: next,
              progress,
              history: [
                ...(item.history ?? []),
                { at: today, status: next, note: `状态由「${action.status}」推进到「${next}」` },
              ],
            }
          : item,
      ),
    );
    notify(`${action.title} 已更新为「${next}」`);
  }

  function saveDraft() {
    if (!draft || !guard()) return;
    const title = draft.title.trim();
    const owner = draft.owner.trim();
    if (!title || !owner || !draft.dueDate) {
      notify("任务标题、负责人和截止日必须填写", "error");
      return;
    }
    const numericFields = [
      draft.progress,
      draft.expectedBenefit,
      draft.baselineValue,
      draft.targetValue,
      draft.actualValue,
      draft.actualBenefit,
    ];
    if (numericFields.some((value) => value.trim() !== "" && !Number.isFinite(Number(value)))) {
      notify("进度、收益、基线/目标/实际值只能填数字", "error");
      return;
    }
    const status = draft.status;
    const next: ImprovementAction = {
      id: draft.id || `action-${draft.deviceId || "device"}-${Date.now()}`,
      deviceId: draft.deviceId,
      title,
      issue: draft.issue.trim(),
      owner,
      dueDate: draft.dueDate,
      expectedBenefit: Number(draft.expectedBenefit || 0),
      status,
      priority: draft.priority,
      progress: Math.max(0, Math.min(100, Number(draft.progress || 0))),
      actualBenefit: optionalNumber(draft.actualBenefit),
      baselineValue: optionalNumber(draft.baselineValue),
      targetValue: optionalNumber(draft.targetValue),
      actualValue: optionalNumber(draft.actualValue),
      metricUnit: draft.metricUnit.trim() || undefined,
      evidence: draft.evidence.trim() || undefined,
      reviewDate: draft.actualValue.trim() ? today : undefined,
      sourceFinding: draft.sourceFinding,
    };
    setActions((current) => {
      const existing = current.find((item) => item.id === next.id);
      if (!existing) {
        return [{ ...next, history: [{ at: today, status, note: "由待认领问题建立改进任务" }] }, ...current];
      }
      const statusChanged = existing.status !== status;
      return current.map((item) =>
        item.id === next.id
          ? {
              ...next,
              history: statusChanged
                ? [...(item.history ?? []), { at: today, status, note: `编辑任务并改为「${status}」` }]
                : item.history,
            }
          : item,
      );
    });
    setDraft(null);
    notify(draft.id ? "任务已更新" : "改进任务已建立，请跟进负责人与期限");
  }

  return (
    <div className={styles.root}>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><Target size={15} />问题到收益的闭环</div>
          <h1>运营改进中心</h1>
        </div>
        <div className={styles.headingMeta}><CalendarClock size={14} />数据期间 {periodLabel}</div>
      </div>

      <section className={styles.stats} aria-label="闭环概览">
        <article className={styles.statCard}>
          <span>待认领问题</span><strong>{stats.pending}</strong><small>诊断命中且未建任务</small>
        </article>
        <article className={styles.statCard}>
          <span>进行中任务</span><strong>{stats.running}</strong><small>已指认负责人</small>
        </article>
        <article className={styles.statCard}>
          <span>本期已完成</span><strong>{stats.done}</strong><small>{periodLabel}</small>
        </article>
        <article className={styles.statCard}>
          <span>已兑现收益</span><strong>{currency.format(stats.benefit)}</strong><small>元 · 复测确认口径</small>
        </article>
        <article className={`${styles.statCard} ${stats.overdue ? styles.statAlarm : ""}`}>
          <span>逾期任务</span><strong>{stats.overdue}</strong><small>截止日已过且未完成</small>
        </article>
      </section>

      <section className={styles.panel} aria-label="待认领问题">
        <header className={styles.panelHead}>
          <div>
            <h2>待认领问题</h2>
            <p>来自效益诊断，按严重度与风险分排序。</p>
          </div>
          <span className={styles.panelNote}>待认领 {pendingRows.length} 条 · 已认领 {claimedRows.length} 条</span>
        </header>

        {pendingRows.length === 0 ? (
          <p className={styles.empty}>
            {findingRows.length === 0 ? "本期诊断没有产生问题，或数据尚未发布。" : "运营类问题都已认领。"}
          </p>
        ) : (
          <ul className={styles.findingList}>
            {pendingRows.map((row) => (
              <li key={`${row.facts.deviceId}-${row.finding.code}`} className={styles.findingRow}>
                <span className={`status-pill ${SEVERITY_TONE[row.finding.severity]}`}>
                  {SEVERITY_LABEL[row.finding.severity]}
                </span>
                <div className={styles.findingBody}>
                  <button type="button" className={styles.deviceLink} onClick={() => onSelectDevice(row.facts.deviceId)}>
                    <strong>{row.facts.name}</strong>
                    <span>{row.facts.model}</span>
                    <small>{row.facts.department}</small>
                    <ChevronRight size={13} />
                  </button>
                  <p className={styles.findingTitle}>{row.finding.title}</p>
                  <p className={styles.findingEvidence}>{row.finding.evidence}</p>
                  <p className={styles.findingSuggestion}>建议：{row.finding.suggestion}</p>
                </div>
                <button
                  type="button"
                  className="secondary-button compact-action"
                  onClick={() => openCreate(row.facts.deviceId, row.finding)}
                >
                  建改进任务
                </button>
              </li>
            ))}
          </ul>
        )}

        {claimedRows.length ? (
          <div className={styles.claimedBlock}>
            <span className={styles.blockTitle}>已认领</span>
            <ul className={styles.claimedList}>
              {claimedRows.map((row) => (
                <li key={`claimed-${row.facts.deviceId}-${row.finding.code}`}>
                  <span className="status-pill success">已认领</span>
                  <span className={styles.claimedFinding}>{row.facts.name} · {row.finding.title}</span>
                  <span className={styles.claimedAction}>{row.action.title}</span>
                  <span className={`status-pill ${STATUS_TONE[row.action.status]}`}>{row.action.status}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {capitalRows.length ? (
          <div className={styles.capitalBlock}>
            <span className={styles.blockTitle}>属于更新与处置，转资本计划</span>
            <ul className={styles.capitalList}>
              {capitalRows.map((row) => (
                <li key={`capital-${row.facts.deviceId}-${row.finding.code}`}>
                  <div>
                    <strong>{row.facts.name} · {row.finding.title}</strong>
                    <small>{row.finding.evidence}</small>
                  </div>
                  <button
                    type="button"
                    className="secondary-button compact-action"
                    onClick={() => onSendToCapital(row.facts.deviceId)}
                  >
                    转资本计划<ArrowRight size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className={styles.panel} aria-label="任务闭环看板">
        <header className={styles.panelHead}>
          <div>
            <h2>任务闭环看板</h2>
            <p>推进状态与填实际值都会写入任务历史。</p>
          </div>
          {canManage ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => openCreate(diagnoses[0]?.facts.deviceId ?? "")}
            >
              <ClipboardCheck size={15} />新建任务
            </button>
          ) : null}
        </header>

        {actions.length === 0 ? (
          <p className={styles.empty}>还没有改进任务，从上面的待认领问题建一条。</p>
        ) : (
          <div className={styles.board}>
            {STATUS_COLUMNS.map((column) => {
              const columnActions = actions.filter((action) => action.status === column);
              return (
                <div key={column} className={styles.boardColumn}>
                  <header className={styles.boardHead}>
                    <span className={`status-pill ${STATUS_TONE[column]}`}>{column}</span>
                    <b>{columnActions.length}</b>
                  </header>
                  {columnActions.length === 0 ? (
                    <p className={styles.columnEmpty}>暂无任务</p>
                  ) : (
                    columnActions.map((action) => {
                      const overdue = isOverdue(action, today);
                      const facts = factsById.get(action.deviceId);
                      const unit = action.metricUnit ?? "";
                      return (
                        <article
                          key={action.id}
                          className={`${styles.taskCard} ${overdue ? styles.taskOverdue : ""}`}
                        >
                          <div className={styles.taskTop}>
                            <span className={`status-pill ${action.priority === "高" ? "danger" : action.priority === "中" ? "warning" : "neutral"}`}>
                              {action.priority}优先级
                            </span>
                            {overdue ? (
                              <span className={styles.overdueTag}>
                                <TriangleAlert size={12} />逾期 {overdueDays(action.dueDate, today)} 天
                              </span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className={styles.taskTitle}
                            onClick={() => onSelectDevice(action.deviceId)}
                          >
                            <strong>{action.title}</strong><ChevronRight size={14} />
                          </button>
                          <p className={styles.taskIssue}>{action.issue}</p>
                          <dl className={styles.taskMeta}>
                            <div><dt>设备</dt><dd>{facts ? `${facts.name} · ${facts.department}` : action.deviceId}</dd></div>
                            <div><dt>负责人</dt><dd>{action.owner}</dd></div>
                            <div>
                              <dt>截止日</dt>
                              <dd className={overdue ? styles.overdueText : ""}>{action.dueDate}</dd>
                            </div>
                            <div><dt>预计收益</dt><dd>{currency.format(action.expectedBenefit)} 元</dd></div>
                            {action.actualBenefit !== undefined ? (
                              <div><dt>实际收益</dt><dd>{currency.format(action.actualBenefit)} 元</dd></div>
                            ) : null}
                          </dl>
                          {action.baselineValue !== undefined ? (
                            <p className={styles.taskMetric}>
                              基线 {action.baselineValue}{unit} → 目标 {action.targetValue ?? "—"}{unit} → 实际{" "}
                              {action.actualValue ?? "待复测"}{unit}
                            </p>
                          ) : null}
                          {action.evidence ? <p className={styles.taskEvidence}>{action.evidence}</p> : null}
                          <div className={styles.progressTrack}>
                            <i style={{ width: `${Math.max(0, Math.min(100, action.progress))}%` }} />
                          </div>
                          <footer className={styles.taskFoot}>
                            <span>{action.progress}%</span>
                            {canManage ? (
                              <div className={styles.taskButtons}>
                                <button
                                  type="button"
                                  className="secondary-button compact-action"
                                  onClick={() => setDraft(draftFromAction(action))}
                                >
                                  编辑 / 填实际值
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button compact-action"
                                  onClick={() => advanceAction(action)}
                                >
                                  {action.status === "待启动" ? "开始处理" : action.status === "进行中" ? "标记完成" : "重新打开"}
                                  <ArrowRight size={13} />
                                </button>
                              </div>
                            ) : null}
                          </footer>
                        </article>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.panel} aria-label="目标达成">
        <header className={styles.panelHead}>
          <div>
            <h2>目标达成</h2>
            <p>只统计设定了基线与目标的任务，实际值来自复测。</p>
          </div>
          <span className={styles.panelNote}>{targetRows.length} 项有目标</span>
        </header>
        {targetRows.length === 0 ? (
          <p className={styles.empty}>还没有任务设定基线与目标，编辑任务补上后这里出现达成率。</p>
        ) : (
          <ul className={styles.targetList}>
            {targetRows.map((action) => {
              const rate = achievement(action) ?? 0;
              const unit = action.metricUnit ?? "";
              return (
                <li key={`target-${action.id}`} className={styles.targetRow}>
                  <div className={styles.targetHead}>
                    <strong>{action.title}</strong>
                    <small>{deviceLabel(action.deviceId)}</small>
                  </div>
                  <div className={styles.targetNumbers}>
                    <span>基线 {action.baselineValue}{unit}</span>
                    <span>目标 {action.targetValue}{unit}</span>
                    <span>实际 {action.actualValue === undefined ? "待复测" : `${action.actualValue}${unit}`}</span>
                  </div>
                  <div className={styles.targetBar}>
                    <i style={{ width: `${rate}%` }} data-reached={rate >= 100} />
                  </div>
                  <span className={styles.targetRate}>{rate}%</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {draft ? (
        <div
          className={styles.dialogScrim}
          role="dialog"
          aria-modal="true"
          aria-label={draft.id ? "编辑改进任务" : "新建改进任务"}
          // 点遮罩和按 Esc 都要能关：仓库里其它弹窗都是这个手感，
          // 少了这两条，用户只能去找右上角那个小叉，中途还点不动别的菜单。
          onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}
        >
          <div className={styles.dialog}>
            <header className={styles.dialogHead}>
              <div>
                <strong>{draft.id ? "编辑改进任务" : "新建改进任务"}</strong>
                <small>{deviceLabel(draft.deviceId)}</small>
              </div>
              <button type="button" className={styles.iconButton} onClick={() => setDraft(null)} aria-label="关闭">
                <X size={16} />
              </button>
            </header>
            <div className={styles.dialogBody}>
              <label className={styles.fieldWide}>
                <span>任务标题</span>
                <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
              </label>
              <label className={styles.fieldWide}>
                <span>问题描述</span>
                <textarea rows={2} value={draft.issue} onChange={(event) => setDraft({ ...draft, issue: event.target.value })} />
              </label>
              <label className={styles.field}>
                <span>设备</span>
                <select value={draft.deviceId} onChange={(event) => setDraft({ ...draft, deviceId: event.target.value })}>
                  {factsById.has(draft.deviceId) ? null : <option value={draft.deviceId}>{draft.deviceId || "未指定"}</option>}
                  {diagnoses.map((item) => (
                    <option key={item.facts.deviceId} value={item.facts.deviceId}>{item.facts.name}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>负责人</span>
                <input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} placeholder="科室 / 部门" />
              </label>
              <label className={styles.field}>
                <span>截止日</span>
                <input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
              </label>
              <label className={styles.field}>
                <span>优先级</span>
                <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value as Priority })}>
                  {(["高", "中", "低"] as Priority[]).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>状态</span>
                <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ActionStatus })}>
                  {STATUS_COLUMNS.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>进度（%）</span>
                <input type="number" value={draft.progress} onChange={(event) => setDraft({ ...draft, progress: event.target.value })} />
              </label>
              <label className={styles.field}>
                <span>指标单位</span>
                <input value={draft.metricUnit} onChange={(event) => setDraft({ ...draft, metricUnit: event.target.value })} placeholder="如 % 使用率" />
              </label>
              <label className={styles.field}>
                <span>基线值</span>
                <input type="number" value={draft.baselineValue} onChange={(event) => setDraft({ ...draft, baselineValue: event.target.value })} />
              </label>
              <label className={styles.field}>
                <span>目标值</span>
                <input type="number" value={draft.targetValue} onChange={(event) => setDraft({ ...draft, targetValue: event.target.value })} />
              </label>
              <label className={styles.field}>
                <span>实际值</span>
                <input type="number" value={draft.actualValue} onChange={(event) => setDraft({ ...draft, actualValue: event.target.value })} />
              </label>
              <label className={styles.field}>
                <span>预计收益（元）</span>
                <input type="number" value={draft.expectedBenefit} onChange={(event) => setDraft({ ...draft, expectedBenefit: event.target.value })} />
              </label>
              <label className={styles.field}>
                <span>实际收益（元）</span>
                <input type="number" value={draft.actualBenefit} onChange={(event) => setDraft({ ...draft, actualBenefit: event.target.value })} />
              </label>
              <label className={styles.fieldWide}>
                <span>执行证据</span>
                <textarea rows={2} value={draft.evidence} onChange={(event) => setDraft({ ...draft, evidence: event.target.value })} placeholder="排班表、工单号、会议纪要或复测记录" />
              </label>
            </div>
            <footer className={styles.dialogFoot}>
              <span className={styles.dialogNote}><CircleAlert size={13} />实际值与实际收益需有可核对的证据</span>
              <button type="button" className="text-button" onClick={() => setDraft(null)}>取消</button>
              <button type="button" className="primary-button" onClick={saveDraft}>
                <ClipboardCheck size={15} />保存任务
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
