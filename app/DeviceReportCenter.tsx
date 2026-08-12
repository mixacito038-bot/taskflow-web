"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarRange, CircleAlert, ClipboardList, Download, LayoutList, Merge, Search, Settings2, Table2, TriangleAlert, Undo2, X } from "lucide-react";

import {
  canEditReport,
  completionStat,
  customRangePeriod,
  derivedMetrics,
  DeviceReportRecord,
  findReportRecord,
  listPeriods,
  migrateCostEntries,
  PERIOD_GRANULARITY_LABELS,
  PeriodGranularity,
  REPORT_STATUS_LABELS,
  REPORT_STATUS_TONES,
  ReportFieldDefinition,
  ReportFieldGroupId,
  ReportPeriod,
  ReportStatus,
  reportFieldFullLabel,
  reportFieldLabel,
  reportFieldsByGroup,
  reportStatusOf,
  reportTotalCost,
  reportWarnings,
  validateReportValue,
  validateReportValues,
} from "./device-report-fields";
import { CostEntry } from "./mock-data";
import styles from "./DeviceReportCenter.module.css";

export type DeviceReportWorkload = { examVolume?: string; positiveCount?: string; totalRevenue?: string };

type DeviceRow = { id: string; assetCode?: string; name: string; model?: string; department: string };

const YEARS = [2024, 2025, 2026, 2027] as const;
const GRANULARITIES: readonly PeriodGranularity[] = ["day", "week", "month", "quarter", "range"];
// 空勾选集合复用同一个引用：每次新建 Set 会让依赖它的 useMemo 每渲染都失效
const EMPTY_IDS: ReadonlySet<string> = new Set<string>();
const EMPTY_DRAFTS: Record<string, string> = {};

// 宽表双层表头的组底色只用主题变量：写死色值在深色主题下会刺眼
const GROUP_TONES: Record<ReportFieldGroupId, string> = {
  usage: "var(--primary-soft)",
  workload: "var(--violet-soft)",
  direct: "var(--green-soft)",
  space: "var(--orange-soft)",
  maintenance: "var(--red-soft)",
  other: "var(--surface-soft)",
};

// 金额一律千分位展示；口径是元，不做任何单位换算
const moneyFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });

function formatMoney(value: number | null): string {
  return value === null ? "—" : moneyFormat.format(value);
}

const AMOUNT_PATTERN = /^\d+(\.\d+)?$/;

/** 导入值转数字：查不到、非法一律 null，界面显示「—」，绝不编 0 */
function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = raw.trim();
  if (!AMOUNT_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 业务量三项只认 workloadOf 的返回；不在三项里的键（自定义导入字段）没有来源，返回 undefined */
function workloadValue(workload: DeviceReportWorkload | undefined, key: string): string | undefined {
  if (!workload) return undefined;
  if (key === "examVolume") return workload.examVolume;
  if (key === "positiveCount") return workload.positiveCount;
  if (key === "totalRevenue") return workload.totalRevenue;
  return undefined;
}

function csvCell(value: string | number): string {
  const text = String(value);
  // 以 =+-@ 开头的内容加前导引号，防 CSV 注入
  const safe = /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadCsv(fileName: string, rows: (string | number)[][]) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  // 首行 BOM 让 Excel 认出 UTF-8，否则中文列头全是乱码
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
}

/** globals 的 status-pill 没有 info 档，submitted 的蓝 pill 用模块类补齐，不动全局样式 */
function statusPillClass(status: ReportStatus): string {
  const tone = REPORT_STATUS_TONES[status];
  return tone === "info" ? `status-pill ${styles.pillInfo}` : `status-pill ${tone}`;
}

export default function DeviceReportCenter({
  devices,
  fields,
  records,
  onRecordsChange,
  workloadOf,
  oldCostEntries,
  canManage,
  notify,
  currentUser,
  initialDeviceId,
  onConsumedInitialDevice,
  onOpenFieldSettings,
}: {
  /** 台账全集：id、assetCode、name、model、department 至少可用 */
  devices: { id: string; assetCode?: string; name: string; model?: string; department: string }[];
  /** 已合并自定义字段的填报字段（mergeReportFields 的结果） */
  fields: ReportFieldDefinition[];
  records: DeviceReportRecord[];
  onRecordsChange: (next: DeviceReportRecord[]) => void;
  /** 业务量三项（数据准备中心导入）；查不到返回 undefined，界面显示「—」绝不编 0 */
  workloadOf: (deviceId: string, periodKey: string) => DeviceReportWorkload | undefined;
  /** 旧成本填报记录（迁移用）；CostEntry 类型 import 自 "./mock-data" */
  oldCostEntries: CostEntry[];
  /** cost.manage：确认/退回/批量操作/迁移 */
  canManage: boolean;
  notify: (message: string, tone?: "info" | "error") => void;
  currentUser: string;
  /** 从设备台账「眼睛」进来时预选的设备：直接打开该设备抽屉 */
  initialDeviceId?: string;
  onConsumedInitialDevice?: () => void;
  onOpenFieldSettings?: () => void;
}) {
  /* -------------------------------------------------- 期间轴 */
  const [year, setYear] = useState(() => {
    const current = new Date().getFullYear();
    return YEARS.includes(current as (typeof YEARS)[number]) ? current : 2026;
  });
  const [granularity, setGranularity] = useState<PeriodGranularity>("month");
  const [dayMonth, setDayMonth] = useState(() => new Date().getMonth() + 1);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [customPeriod, setCustomPeriod] = useState<ReportPeriod | null>(null);
  // 默认落在月粒度的当月：填报动作绝大多数发生在「上个月的账、这个月填」
  const [selectedKey, setSelectedKey] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
  });

  const periods = useMemo<ReportPeriod[]>(
    () => (granularity === "range" ? (customPeriod ? [customPeriod] : []) : listPeriods(granularity, year, dayMonth)),
    [granularity, year, dayMonth, customPeriod],
  );
  /**
   * 切粒度/年份后旧选中键会失效（例如从月切到周，"2026-08" 不在周清单里）。
   * 这里直接推导出生效期间，而不是用 effect 把 state 改回去：
   * 后者要多渲染一轮，中间那一帧是「没有选中期」的空页，会闪一下。
   */
  const period = useMemo(() => {
    if (!periods.length) return null;
    const matched = periods.find((item) => item.key === selectedKey);
    if (matched) return matched;
    const now = new Date();
    const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    return periods.find((item) => item.start <= today && today <= item.end) ?? periods[0];
  }, [periods, selectedKey]);
  // 勾选、宽表草稿这些「本期暂存」都跟着生效期间走，而不是跟着用户点过的键
  const activeKey = period?.key ?? "";

  function makeRangePeriod() {
    const next = customRangePeriod(rangeStart, rangeEnd);
    if (!next) return notify("区间起止日期不合法：请填完整日期，且开始日期不能晚于结束日期", "error");
    setCustomPeriod(next);
    setSelectedKey(next.key);
  }

  /* -------------------------------------------------- 当期数据索引 */
  const deviceIds = useMemo(() => devices.map((device) => device.id), [devices]);
  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);

  const periodRecords = useMemo(() => {
    const map = new Map<string, DeviceReportRecord>();
    if (!period) return map;
    const known = new Set(deviceIds);
    for (const record of records) {
      if (record.periodKey === period.key && known.has(record.deviceId)) map.set(record.deviceId, record);
    }
    return map;
  }, [records, period, deviceIds]);

  const periodStats = useMemo(
    () => new Map(periods.map((item) => [item.key, completionStat(deviceIds, records, item.key)])),
    [periods, deviceIds, records],
  );
  const selectedStat = period ? periodStats.get(period.key) : undefined;
  const returnedCount = useMemo(() => {
    let count = 0;
    for (const record of periodRecords.values()) if (record.status === "returned") count += 1;
    return count;
  }, [periodRecords]);

  /* -------------------------------------------------- 字段可见性 */
  // 日/周粒度隐藏费用类子项（countsToCost 组）：医院水电物业只有月度账，按天填只会逼人瞎摊
  const hideCostFields = granularity === "day" || granularity === "week";
  const visibleFields = useMemo(
    () => (hideCostFields ? fields.filter((field) => !field.countsToCost) : fields),
    [fields, hideCostFields],
  );
  const fieldGroups = useMemo(
    () => reportFieldsByGroup(visibleFields).filter((item) => item.fields.length > 0),
    [visibleFields],
  );

  /* -------------------------------------------------- 清单过滤 */
  const [keyword, setKeyword] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ReportStatus>("all");
  const [view, setView] = useState<"list" | "grid">("list");
  // 勾选连同它所属的期间一起存：换期间时旧勾选自然失效，
  // 不需要用 effect 清空（那样要多渲染一轮，中间一帧还带着上一期的勾选）
  const [selection, setSelection] = useState<{ periodKey: string; ids: ReadonlySet<string> }>({ periodKey: "", ids: new Set() });
  const selected = selection.periodKey === activeKey ? selection.ids : EMPTY_IDS;
  const setSelected = (update: (prev: ReadonlySet<string>) => ReadonlySet<string>) => {
    setSelection((prev) => ({ periodKey: activeKey, ids: update(prev.periodKey === activeKey ? prev.ids : EMPTY_IDS) }));
  };

  const departments = useMemo(
    () => [...new Set(devices.map((device) => device.department).filter(Boolean))],
    [devices],
  );

  const searched = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    return devices.filter((device) => {
      if (deptFilter && device.department !== deptFilter) return false;
      if (!text) return true;
      return [device.assetCode, device.name, device.model, device.department]
        .some((part) => (part ?? "").toLowerCase().includes(text));
    });
  }, [devices, keyword, deptFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<ReportStatus, number> = { empty: 0, draft: 0, submitted: 0, confirmed: 0, returned: 0 };
    for (const device of searched) counts[reportStatusOf(periodRecords.get(device.id))] += 1;
    return counts;
  }, [searched, periodRecords]);

  const filteredDevices = useMemo(
    () => (statusFilter === "all" ? searched : searched.filter((device) => reportStatusOf(periodRecords.get(device.id)) === statusFilter)),
    [searched, statusFilter, periodRecords],
  );

  function toggleSelect(deviceId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }

  const allFilteredSelected = filteredDevices.length > 0 && filteredDevices.every((device) => selected.has(device.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) for (const device of filteredDevices) next.delete(device.id);
      else for (const device of filteredDevices) next.add(device.id);
      return next;
    });
  }

  /* -------------------------------------------------- 记录写回 */
  function upsertRecord(prev: DeviceReportRecord | undefined, next: DeviceReportRecord) {
    onRecordsChange(prev ? records.map((item) => (item === prev ? next : item)) : [...records, next]);
  }

  function confirmDevices(ids: readonly string[]) {
    if (!period) return;
    const eligible = new Set(ids.filter((id) => periodRecords.get(id)?.status === "submitted"));
    if (!eligible.size) return notify("所选设备里没有「已提交」状态的数据可确认", "error");
    const nowIso = new Date().toISOString();
    onRecordsChange(records.map((record) => {
      if (record.periodKey !== period.key || !eligible.has(record.deviceId) || record.status !== "submitted") return record;
      const next: DeviceReportRecord = { ...record, status: "confirmed", updatedAt: nowIso, updatedBy: currentUser };
      return next;
    }));
    notify(`已确认 ${eligible.size} 台设备的本期数据`);
  }

  /* -------------------------------------------------- 批量操作 */
  const [returnTarget, setReturnTarget] = useState<string[] | null>(null);
  const [returnReasonDraft, setReturnReasonDraft] = useState("");

  function openReturnModal(ids: string[]) {
    setReturnReasonDraft("");
    setReturnTarget(ids);
  }

  function runReturn() {
    if (!returnTarget || !period) return;
    const reason = returnReasonDraft.trim();
    if (!reason) return notify("请填写退回原因：科室要知道改什么才能重填", "error");
    const eligible = new Set(returnTarget.filter((id) => {
      const status = periodRecords.get(id)?.status;
      return status === "submitted" || status === "confirmed";
    }));
    if (!eligible.size) {
      setReturnTarget(null);
      return notify("所选设备里没有可退回的数据（仅「已提交」「已确认」可退回）", "error");
    }
    const nowIso = new Date().toISOString();
    onRecordsChange(records.map((record) => {
      if (record.periodKey !== period.key || !eligible.has(record.deviceId)) return record;
      if (record.status !== "submitted" && record.status !== "confirmed") return record;
      const next: DeviceReportRecord = { ...record, status: "returned", returnReason: reason, updatedAt: nowIso, updatedBy: currentUser };
      return next;
    }));
    notify(`已退回 ${eligible.size} 台设备的本期数据`);
    setReturnTarget(null);
    setReturnReasonDraft("");
    setSelected(() => EMPTY_IDS);
  }

  function batchSubmit() {
    if (!period) return;
    const ids = [...selected];
    const draftIds = ids.filter((id) => periodRecords.get(id)?.status === "draft");
    const invalidNames: string[] = [];
    const okIds = new Set<string>();
    for (const id of draftIds) {
      const record = periodRecords.get(id);
      if (!record) continue;
      const error = validateReportValues(visibleFields, record.values);
      if (error) invalidNames.push(deviceById.get(id)?.name ?? id);
      else okIds.add(id);
    }
    if (!okIds.size) {
      return notify(invalidNames.length
        ? `没有提交任何设备：${invalidNames.length} 台校验未通过（${invalidNames.slice(0, 3).join("、")}${invalidNames.length > 3 ? " 等" : ""}）`
        : "所选设备里没有「填报中」的草稿可提交", "error");
    }
    const nowIso = new Date().toISOString();
    onRecordsChange(records.map((record) => {
      if (record.periodKey !== period.key || !okIds.has(record.deviceId) || record.status !== "draft") return record;
      const next: DeviceReportRecord = { ...record, status: "submitted", updatedAt: nowIso, updatedBy: currentUser };
      delete next.returnReason;
      return next;
    }));
    const skippedIneligible = ids.length - draftIds.length;
    notify(`已提交 ${okIds.size} 台`
      + (invalidNames.length ? `；${invalidNames.length} 台校验未通过被跳过（${invalidNames.slice(0, 3).join("、")}${invalidNames.length > 3 ? " 等" : ""}）` : "")
      + (skippedIneligible ? `；${skippedIneligible} 台非「填报中」状态未处理` : ""));
    setSelected(() => EMPTY_IDS);
  }

  function batchConfirm() {
    confirmDevices([...selected]);
    setSelected(() => EMPTY_IDS);
  }

  /* -------------------------------------------------- 填报抽屉 */
  /**
   * 从设备台账点「眼睛」进来时要直接打开这台设备的抽屉。
   * 用惰性初值而不是 effect：本页每次从台账进来都是全新挂载，
   * effect 里再 setState 会先渲染一帧空列表再弹抽屉，看着像闪了一下。
   */
  const [drawerDeviceId, setDrawerDeviceId] = useState<string | null>(
    () => (initialDeviceId && devices.some((device) => device.id === initialDeviceId) ? initialDeviceId : null),
  );
  const [drawerValues, setDrawerValues] = useState<Record<string, string>>(() => {
    if (!drawerDeviceId) return {};
    const now = new Date();
    const key = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    return { ...(findReportRecord(records, drawerDeviceId, key)?.values ?? {}) };
  });

  const drawerDevice = drawerDeviceId ? deviceById.get(drawerDeviceId) : undefined;
  const drawerRecord = drawerDeviceId ? periodRecords.get(drawerDeviceId) : undefined;
  const drawerStatus = reportStatusOf(drawerRecord);
  const drawerEditable = canEditReport(drawerStatus);
  const drawerWorkload = drawerDeviceId && period ? workloadOf(drawerDeviceId, period.key) : undefined;

  // 警告与派生指标要把导入的业务量并进来一起算，否则阳性率、结余永远是「—」
  const drawerComputedValues = useMemo(() => {
    const merged: Record<string, string> = { ...drawerValues };
    for (const field of fields) {
      if (field.source !== "import") continue;
      const value = workloadValue(drawerWorkload, field.key);
      if (value !== undefined) merged[field.key] = value;
      else delete merged[field.key];
    }
    return merged;
  }, [drawerValues, drawerWorkload, fields]);

  const drawerWarnings = useMemo(
    () => (period && drawerDeviceId ? reportWarnings(fields, drawerComputedValues, period) : []),
    [fields, drawerComputedValues, period, drawerDeviceId],
  );
  const drawerMetrics = useMemo(
    () => (period && drawerDeviceId ? derivedMetrics(fields, drawerComputedValues, period, granularity) : []),
    [fields, drawerComputedValues, period, granularity, drawerDeviceId],
  );

  function openDrawer(deviceId: string) {
    if (!period) return notify("请先在左侧选择填报期间", "error");
    const record = findReportRecord(records, deviceId, period.key);
    setDrawerValues({ ...(record?.values ?? {}) });
    setDrawerDeviceId(deviceId);
  }

  function closeDrawer() {
    setDrawerDeviceId(null);
    setDrawerValues({});
  }

  /** 只写手工字段：业务量三项以 workloadOf 为准，抄进记录会造出第二份口径 */
  function buildNextValues(): Record<string, string> {
    const next: Record<string, string> = { ...(drawerRecord?.values ?? {}) };
    for (const field of visibleFields) {
      if (field.source !== "manual") continue;
      const value = (drawerValues[field.key] ?? "").trim();
      if (value) next[field.key] = value;
      else delete next[field.key];
    }
    return next;
  }

  function persistDrawer(status: "draft" | "submitted"): boolean {
    if (!drawerDevice || !period) return false;
    const values = buildNextValues();
    const error = validateReportValues(visibleFields, values);
    if (error) {
      notify(error, "error");
      return false;
    }
    const next: DeviceReportRecord = {
      deviceId: drawerDevice.id,
      periodKey: period.key,
      values,
      status,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser,
    };
    // 存草稿时保留退回原因当参考；提交即视为已按原因整改，横幅不再出现
    if (status === "draft" && drawerRecord?.returnReason) next.returnReason = drawerRecord.returnReason;
    upsertRecord(drawerRecord, next);
    return true;
  }

  function saveDraft() {
    if (!persistDrawer("draft") || !drawerDevice) return;
    notify(`「${drawerDevice.name}」本期数据已保存为草稿`);
    closeDrawer();
  }

  function submitDrawer() {
    if (!persistDrawer("submitted") || !drawerDevice) return;
    notify(`「${drawerDevice.name}」本期数据已提交`);
    closeDrawer();
  }

  function saveAndNext() {
    if (!persistDrawer("draft") || !drawerDevice) return;
    // 从当前设备往后找（绕圈），只挑还没填完的；本次保存只改了当前台，其他台状态引用旧索引即可
    const list = filteredDevices;
    const index = list.findIndex((device) => device.id === drawerDevice.id);
    for (let step = 1; step <= list.length; step += 1) {
      const candidate = list[(index + step + list.length) % list.length];
      if (!candidate || candidate.id === drawerDevice.id) continue;
      const status = reportStatusOf(periodRecords.get(candidate.id));
      if (status === "empty" || status === "draft") {
        const record = periodRecords.get(candidate.id);
        setDrawerValues({ ...(record?.values ?? {}) });
        setDrawerDeviceId(candidate.id);
        notify(`「${drawerDevice.name}」已保存，切换到「${candidate.name}」`);
        return;
      }
    }
    notify("已保存；当前筛选下没有待填报的设备了，本期都填完了");
    closeDrawer();
  }

  /* -------------------------------------------------- 台账「眼睛」入口 */
  // 抽屉已在惰性初值里开好，这里只负责回告父组件「这个预选已消费」并在设备不存在时提示。
  const consumedInitialRef = useRef(false);
  useEffect(() => {
    if (consumedInitialRef.current || !initialDeviceId) return;
    consumedInitialRef.current = true;
    if (!devices.some((device) => device.id === initialDeviceId)) {
      notify("台账里找不到要填报的设备，可能已被删除", "error");
    }
    onConsumedInitialDevice?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDeviceId]);

  /* -------------------------------------------------- 旧成本记录归并 */
  const [migrationDismissed, setMigrationDismissed] = useState(false);
  const [migrationConfirmOpen, setMigrationConfirmOpen] = useState(false);
  const showMigration = canManage && oldCostEntries.length > 0 && !migrationDismissed;

  function runMigration() {
    const nowIso = new Date().toISOString();
    const result = migrateCostEntries(oldCostEntries, records, new Set(deviceIds), currentUser, nowIso);
    onRecordsChange(result.records);
    const labelByKey = new Map(fields.map((field) => [field.key, reportFieldLabel(field, "month")]));
    const actionLabels = {
      merged: "已归并",
      skipped_confirmed: "跳过：目标期间已确认",
      skipped_no_device: "跳过：设备不在台账",
    } as const;
    downloadCsv(`旧成本记录归并对照表-${nowIso.slice(0, 10)}.csv`, [
      ["原记录号", "设备", "期间", "类型", "项目", "金额(万元)", "换算金额(元)", "归入字段", "处理结果"],
      ...result.mapping.map((row) => [
        row.entryId,
        row.deviceName,
        row.period,
        row.type,
        row.item,
        row.amountWan,
        row.amountYuan,
        labelByKey.get(row.targetField) ?? row.targetField,
        actionLabels[row.action],
      ]),
    ]);
    const count = (action: string) => result.mapping.filter((row) => row.action === action).length;
    notify(`旧成本记录归并完成：并入 ${count("merged")} 笔，目标已确认跳过 ${count("skipped_confirmed")} 笔，设备不在台账跳过 ${count("skipped_no_device")} 笔；对照表 CSV 已自动下载`);
    setMigrationConfirmOpen(false);
    setMigrationDismissed(true);
  }

  /* -------------------------------------------------- 导出 */
  function exportCsv() {
    if (!period) return notify("请先在左侧选择填报期间", "error");
    if (!filteredDevices.length) return notify("当前筛选下没有设备可导出", "error");
    const header = [
      "资产编号", "设备名称", "型号", "所属科室", "数据状态",
      ...visibleFields.map((field) => reportFieldFullLabel(field, granularity)),
      "当期总成本(元)", "总收入(元)", "结余(元)",
    ];
    const rows = filteredDevices.map((device) => {
      const record = periodRecords.get(device.id);
      const workload = workloadOf(device.id, period.key);
      const cost = reportTotalCost(fields, record?.values);
      const revenue = parseAmount(workload?.totalRevenue);
      const net = cost === null || revenue === null ? null : round2(revenue - cost);
      return [
        device.assetCode ?? "", device.name, device.model ?? "", device.department,
        REPORT_STATUS_LABELS[reportStatusOf(record)],
        ...visibleFields.map((field) => (field.source === "import"
          ? workloadValue(workload, field.key) ?? ""
          : record?.values[field.key] ?? "")),
        cost === null ? "" : String(cost),
        revenue === null ? "" : String(revenue),
        net === null ? "" : String(net),
      ];
    });
    downloadCsv(`设备数据填报-${period.key}-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
    notify(`已导出本期 ${filteredDevices.length} 台设备的填报数据`);
  }

  /* -------------------------------------------------- 宽表（批量填报视图） */
  // 草稿连同它所属的期间+视图一起存：切期间或切回清单视图时旧草稿自然失效，
  // 用 effect 清空会多渲染一轮，中间那一帧旧期的数字还挂在新期的格子里
  const [gridState, setGridState] = useState<{ scope: string; drafts: Record<string, string> }>({ scope: "", drafts: {} });
  const gridScope = `${activeKey}|${view}`;
  const gridDrafts = gridState.scope === gridScope ? gridState.drafts : EMPTY_DRAFTS;
  const setGridDrafts = (update: (prev: Record<string, string>) => Record<string, string>) => {
    setGridState((prev) => ({ scope: gridScope, drafts: update(prev.scope === gridScope ? prev.drafts : EMPTY_DRAFTS) }));
  };
  const gridFields = useMemo(() => fieldGroups.flatMap((item) => item.fields), [fieldGroups]);

  function dropGridDraft(draftKey: string) {
    setGridDrafts((prev) => {
      if (!(draftKey in prev)) return prev;
      const next = { ...prev };
      delete next[draftKey];
      return next;
    });
  }

  function commitGridCell(device: DeviceRow, field: ReportFieldDefinition, draftKey: string) {
    if (!period) return;
    const raw = gridDrafts[draftKey];
    if (raw === undefined) return;
    const record = periodRecords.get(device.id);
    if (record && !canEditReport(record.status)) return;
    const value = raw.trim();
    if (value === (record?.values[field.key] ?? "").trim()) return dropGridDraft(draftKey);
    const error = validateReportValue(field, value);
    // 校验不过就把草稿文本留在格子里让人改，写回一个错值比留着醒目的错误更糟
    if (error) return notify(error, "error");
    const values = { ...(record?.values ?? {}) };
    if (value) values[field.key] = value;
    else delete values[field.key];
    // 宽表里改一格即回到草稿：已提交的数据被改动后必须重新走提交确认流程
    const next: DeviceReportRecord = {
      deviceId: device.id,
      periodKey: period.key,
      values,
      status: "draft",
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser,
    };
    upsertRecord(record, next);
    dropGridDraft(draftKey);
  }

  /* -------------------------------------------------- 汇总 */
  const summary = useMemo(() => {
    let revenue: number | null = null;
    let cost: number | null = null;
    let filled = 0;
    if (period) {
      for (const device of filteredDevices) {
        const record = periodRecords.get(device.id);
        if (!record || record.status === "returned") continue;
        filled += 1;
        const deviceCost = reportTotalCost(fields, record.values);
        if (deviceCost !== null) cost = (cost ?? 0) + deviceCost;
        const deviceRevenue = parseAmount(workloadOf(device.id, period.key)?.totalRevenue);
        if (deviceRevenue !== null) revenue = (revenue ?? 0) + deviceRevenue;
      }
    }
    if (revenue !== null) revenue = round2(revenue);
    if (cost !== null) cost = round2(cost);
    const net = revenue === null || cost === null ? null : round2(revenue - cost);
    const ratio = revenue === null || cost === null || cost === 0 ? null : round2((revenue / cost) * 100);
    return { revenue, cost, net, ratio, filled };
  }, [filteredDevices, periodRecords, fields, period, workloadOf]);

  /* -------------------------------------------------- 渲染 */
  const chips: { key: "all" | ReportStatus; label: string; count: number }[] = [
    { key: "all", label: "全部", count: searched.length },
    ...(Object.keys(REPORT_STATUS_LABELS) as ReportStatus[]).map((status) => ({
      key: status,
      label: REPORT_STATUS_LABELS[status],
      count: statusCounts[status],
    })),
  ];

  const drawerPeriodTitle = period
    ? (period.granularity === "range" ? `${period.start} ~ ${period.end}` : `${year}年${period.label}`)
    : "";

  const sourceTag = (groupId: ReportFieldGroupId) => (groupId === "workload"
    ? <span className="status-pill" style={{ color: "var(--violet)", background: "var(--violet-soft)" }}>数据准备中心导入</span>
    : <span className="status-pill" style={{ color: "var(--primary)", background: "var(--primary-soft)" }}>手工填报</span>);

  const hiddenCostNote = hideCostFields && fields.some((field) => field.countsToCost) ? (
    <div className="editor-tip"><CircleAlert size={16} />费用类子项按月/季度/区间填报：水电、物业等只有月度账单，日/周粒度不展示这些字段，避免逼着科室凭空分摊。</div>
  ) : null;

  function rowActions(device: DeviceRow, status: ReportStatus) {
    if (status === "empty") return <button className="text-button" onClick={() => openDrawer(device.id)}>去填报</button>;
    if (status === "draft") return <button className="text-button" onClick={() => openDrawer(device.id)}>继续填报</button>;
    if (status === "returned") return <button className="text-button" onClick={() => openDrawer(device.id)}>修改</button>;
    if (status === "submitted") {
      return (
        <>
          <button className="text-button" onClick={() => openDrawer(device.id)}>查看</button>
          {canManage ? (
            <>
              <button className="text-button" onClick={() => confirmDevices([device.id])}>确认</button>
              <button className="text-button danger-text" onClick={() => openReturnModal([device.id])}>退回</button>
            </>
          ) : null}
        </>
      );
    }
    return <button className="text-button" onClick={() => openDrawer(device.id)}>查看</button>;
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow"><ClipboardList size={15} />单设备成本与业务量</div>
          <h1>设备数据填报</h1>
        </div>
        <div className="heading-actions">
          <button className="secondary-button" onClick={exportCsv}><Download size={16} />数据导出</button>
          {canManage && onOpenFieldSettings
            ? <button className="secondary-button" onClick={onOpenFieldSettings}><Settings2 size={16} />填报字段配置</button>
            : null}
        </div>
      </div>

      {showMigration ? (
        <div className={styles.migrateBanner}>
          <Merge size={16} />
          <p>检测到旧成本填报记录 {oldCostEntries.length} 条，可归并到新填报口径（人工 → 人员成本支出、耗材 → 直接耗材支出）。</p>
          <button className="secondary-button compact-action" onClick={() => setMigrationConfirmOpen(true)}>执行归并</button>
          <button className="icon-button" aria-label="关闭归并提示" onClick={() => setMigrationDismissed(true)}><X size={15} /></button>
        </div>
      ) : null}

      <div className={styles.layout}>
        <aside className={styles.rail}>
          <div className={styles.railControls}>
            <label className={styles.controlRow}>
              <span>年份</span>
              <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
                {YEARS.map((item) => <option key={item} value={item}>{item}年</option>)}
              </select>
            </label>
            <div className={styles.granularitySeg} role="group" aria-label="期间粒度">
              {GRANULARITIES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`${styles.segButton} ${granularity === item ? styles.segActive : ""}`}
                  aria-pressed={granularity === item}
                  onClick={() => setGranularity(item)}
                >
                  {PERIOD_GRANULARITY_LABELS[item]}
                </button>
              ))}
            </div>
            {granularity === "day" ? (
              <label className={styles.controlRow}>
                <span>月份</span>
                <select value={dayMonth} onChange={(event) => setDayMonth(Number(event.target.value))}>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <option key={month} value={month}>{month}月</option>
                  ))}
                </select>
              </label>
            ) : null}
            {granularity === "range" ? (
              <div className={styles.rangeControls}>
                <input type="date" value={rangeStart} onChange={(event) => setRangeStart(event.target.value)} aria-label="区间开始日期" />
                <input type="date" value={rangeEnd} onChange={(event) => setRangeEnd(event.target.value)} aria-label="区间结束日期" />
                <button type="button" className="secondary-button compact-action" onClick={makeRangePeriod}>
                  <CalendarRange size={14} />生成期间
                </button>
              </div>
            ) : null}
          </div>

          <div className={styles.periodList}>
            {periods.length ? periods.map((item) => {
              const stat = periodStats.get(item.key) ?? { total: 0, filled: 0, confirmed: 0, rate: 0 };
              const fill = stat.rate >= 1 ? "var(--green)" : stat.rate < 0.3 ? "var(--orange)" : "var(--primary)";
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`${styles.periodItem} ${period?.key === item.key ? styles.periodActive : ""}`}
                  onClick={() => setSelectedKey(item.key)}
                >
                  <span className={styles.periodTop}>
                    <span className={styles.periodName}>{item.label}</span>
                    <span className={styles.periodCount}>{stat.filled}/{stat.total}</span>
                  </span>
                  <span className={styles.progressTrack}><i style={{ width: `${Math.round(stat.rate * 100)}%`, background: fill }} /></span>
                </button>
              );
            }) : (
              <p className={styles.railEmpty}>{granularity === "range" ? "选择起止日期后点「生成期间」" : "本粒度下没有可选期间"}</p>
            )}
          </div>

          <footer className={styles.railSummary}>
            {period && selectedStat
              ? <>本期已填 {selectedStat.filled}/{selectedStat.total} 台 · 已确认 {selectedStat.confirmed} · 已退回 {returnedCount}</>
              : "尚未选择期间"}
          </footer>
        </aside>

        <div className={styles.main}>
          {devices.length === 0 ? (
            <div className="ledger-empty">
              <ClipboardList size={26} />
              <strong>台账里还没有设备</strong>
              <p>设备数据填报按台账逐台进行。请先到「设备台账」建档或导入设备，再回到本页按期间填报成本与使用情况。</p>
            </div>
          ) : (
            <>
              <div className={styles.toolbar}>
                <label className={`search-field ${styles.searchBox}`}>
                  <Search size={15} />
                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索资产编号 / 设备名称 / 型号 / 科室"
                    aria-label="搜索设备"
                  />
                </label>
                <select className={styles.deptSelect} value={deptFilter} onChange={(event) => setDeptFilter(event.target.value)} aria-label="按科室筛选">
                  <option value="">全部科室</option>
                  {departments.map((dept) => <option key={dept} value={dept}>{dept}</option>)}
                </select>
                <button className="secondary-button" onClick={() => setView(view === "list" ? "grid" : "list")}>
                  {view === "list" ? <><Table2 size={15} />批量填报视图</> : <><LayoutList size={15} />返回清单视图</>}
                </button>
              </div>

              <div className={styles.chipRow}>
                {chips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    className={`${styles.chip} ${statusFilter === chip.key ? styles.chipActive : ""}`}
                    aria-pressed={statusFilter === chip.key}
                    onClick={() => setStatusFilter(chip.key)}
                  >
                    {chip.label}<i>{chip.count}</i>
                  </button>
                ))}
              </div>

              {view === "list" && selected.size ? (
                <div className={styles.batchBar}>
                  <span>已选 {selected.size} 台</span>
                  <button className="secondary-button compact-action" onClick={batchSubmit}>批量提交</button>
                  {canManage ? (
                    <>
                      <button className="secondary-button compact-action" onClick={batchConfirm}>批量确认</button>
                      <button className="secondary-button compact-action danger-text" onClick={() => openReturnModal([...selected])}>批量退回</button>
                    </>
                  ) : null}
                  <button className="text-button" onClick={() => setSelected(() => EMPTY_IDS)}>清除选择</button>
                </div>
              ) : null}

              {filteredDevices.length === 0 ? (
                <div className="ledger-empty">
                  <Search size={24} />
                  <strong>没有匹配的设备</strong>
                  <p>调整搜索关键字、科室或状态筛选后再试。</p>
                </div>
              ) : view === "list" ? (
                <>
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className={styles.checkCol}>
                            <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} aria-label="全选当前筛选结果" />
                          </th>
                          <th>数据状态</th>
                          <th>资产编号</th>
                          <th>设备名称</th>
                          <th>所属科室</th>
                          <th className="num">总收入(元)</th>
                          <th className="num">当期总成本(元)</th>
                          <th className="num">结余(元)</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDevices.map((device) => {
                          const record = periodRecords.get(device.id);
                          const status = reportStatusOf(record);
                          const cost = reportTotalCost(fields, record?.values);
                          const revenue = period ? parseAmount(workloadOf(device.id, period.key)?.totalRevenue) : null;
                          const net = cost === null || revenue === null ? null : round2(revenue - cost);
                          return (
                            <tr key={device.id}>
                              <td className={styles.checkCol}>
                                <input type="checkbox" checked={selected.has(device.id)} onChange={() => toggleSelect(device.id)} aria-label={`选择${device.name}`} />
                              </td>
                              <td><span className={statusPillClass(status)}>{REPORT_STATUS_LABELS[status]}</span></td>
                              <td>{device.assetCode || "—"}</td>
                              <td>
                                <div className={styles.deviceCell}>
                                  <strong>{device.name}</strong>
                                  <small>{device.model || "—"}</small>
                                </div>
                              </td>
                              <td>{device.department}</td>
                              <td className="num">{formatMoney(revenue)}</td>
                              <td className="num">{formatMoney(cost)}</td>
                              <td className={`num ${net === null ? "" : net < 0 ? styles.netNegative : styles.netPositive}`}>{formatMoney(net)}</td>
                              <td className={styles.rowActions}>{rowActions(device, status)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <footer className={styles.summaryBar}>
                    <span className={styles.summaryTitle}>本期合计（已填设备）</span>
                    <span>总收入(元) <strong>{formatMoney(summary.revenue)}</strong></span>
                    <span>总成本(元) <strong>{formatMoney(summary.cost)}</strong></span>
                    <span>结余(元) <strong className={summary.net === null ? "" : summary.net < 0 ? styles.netNegative : styles.netPositive}>{formatMoney(summary.net)}</strong></span>
                    <span>成本收益率 <strong>{summary.ratio === null ? "—" : `${summary.ratio}%`}</strong></span>
                    <span className={styles.summaryFill}>已填 {summary.filled}/{filteredDevices.length}</span>
                  </footer>
                </>
              ) : (
                <div className={styles.gridWrap}>
                  <table className={styles.gridTable}>
                    <thead>
                      <tr>
                        <th rowSpan={2} className={styles.gridDeviceTh}>设备</th>
                        {fieldGroups.map(({ group, fields: groupFields }) => (
                          <th key={group.id} colSpan={groupFields.length} className={styles.gridGroupTh} style={{ background: GROUP_TONES[group.id] }}>
                            {group.label}
                          </th>
                        ))}
                        <th rowSpan={2} className={styles.gridTotalTh}>合计(元)</th>
                      </tr>
                      <tr>
                        {fieldGroups.flatMap(({ group, fields: groupFields }) => groupFields.map((field) => (
                          <th key={field.key} className={styles.gridFieldTh} style={{ background: GROUP_TONES[group.id] }}>
                            <span>{reportFieldLabel(field, granularity)}</span>
                            {field.unit ? <small>{field.unit}</small> : null}
                          </th>
                        )))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDevices.map((device) => {
                        const record = periodRecords.get(device.id);
                        const status = reportStatusOf(record);
                        const locked = !canEditReport(status);
                        const workload = period ? workloadOf(device.id, period.key) : undefined;
                        return (
                          <tr key={device.id} className={locked ? styles.gridLockedRow : undefined}>
                            <th className={styles.gridDeviceCell}>
                              <strong>{device.name}</strong>
                              <small>{device.assetCode || device.department}</small>
                              <span className={statusPillClass(status)}>{REPORT_STATUS_LABELS[status]}</span>
                            </th>
                            {gridFields.map((field) => {
                              if (field.source === "import") {
                                return <td key={field.key} className={styles.gridImportCell}>{workloadValue(workload, field.key) ?? "—"}</td>;
                              }
                              const draftKey = `${device.id}|${field.key}`;
                              return (
                                <td key={field.key} className={styles.gridInputCell}>
                                  <input
                                    className={styles.cellInput}
                                    value={gridDrafts[draftKey] ?? record?.values[field.key] ?? ""}
                                    readOnly={locked}
                                    aria-label={`${device.name} ${reportFieldLabel(field, granularity)}`}
                                    onChange={(event) => setGridDrafts((prev) => ({ ...prev, [draftKey]: event.target.value }))}
                                    onBlur={() => commitGridCell(device, field, draftKey)}
                                  />
                                </td>
                              );
                            })}
                            <td className={styles.gridTotalCell}>{formatMoney(reportTotalCost(fields, record?.values))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {hiddenCostNote}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {drawerDevice && period ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
          <div className={`editor-drawer ${styles.reportDrawer}`} role="dialog" aria-modal="true" aria-label={`填报${drawerDevice.name}`}>
            <div className="editor-header">
              <div>
                <span className="eyebrow"><ClipboardList size={14} />设备数据填报</span>
                <h2>{drawerDevice.name}</h2>
                <div className={styles.drawerMeta}>
                  {drawerDevice.model ? <span>{drawerDevice.model}</span> : null}
                  {drawerDevice.assetCode ? <span>{drawerDevice.assetCode}</span> : null}
                  <span>{drawerPeriodTitle} · {period.days} 天</span>
                  <span className={statusPillClass(drawerStatus)}>{REPORT_STATUS_LABELS[drawerStatus]}</span>
                </div>
              </div>
              <button className="icon-button" type="button" onClick={closeDrawer} aria-label="关闭"><X size={19} /></button>
            </div>

            <div className="editor-body">
              {drawerStatus === "returned" && drawerRecord?.returnReason ? (
                <div className={styles.returnBanner}>
                  <Undo2 size={16} />
                  <div><strong>本期数据被退回</strong><p>{drawerRecord.returnReason}</p></div>
                </div>
              ) : null}

              {drawerWarnings.length ? (
                <div className={styles.warnBox}>
                  <TriangleAlert size={16} />
                  <div>{drawerWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
                </div>
              ) : null}

              {fieldGroups.map(({ group, fields: groupFields }) => (
                <section key={group.id} className={styles.groupSection}>
                  <header className={styles.groupHead}>
                    <strong>{group.label}</strong>
                    {sourceTag(group.id)}
                    <small>{group.hint}</small>
                  </header>
                  <div className={styles.fieldGrid}>
                    {groupFields.map((field) => {
                      if (field.source === "import") {
                        const value = workloadValue(drawerWorkload, field.key);
                        return (
                          <div key={field.key} className="form-field">
                            <span>{reportFieldLabel(field, granularity)}</span>
                            <div className={styles.importValue} title={field.hint}>
                              <span>{value ?? "—"}</span>
                              {field.unit ? <i>{field.unit}</i> : null}
                            </div>
                            {value === undefined ? <small className={styles.importMissing}>尚未从数据准备中心导入</small> : null}
                          </div>
                        );
                      }
                      return (
                        <label key={field.key} className="form-field">
                          <span>{reportFieldLabel(field, granularity)}{field.required ? <i className="required-mark">必填</i> : null}</span>
                          <div className="input-wrap">
                            <input
                              value={drawerValues[field.key] ?? ""}
                              onChange={(event) => setDrawerValues({ ...drawerValues, [field.key]: event.target.value })}
                              placeholder={field.hint}
                              disabled={!drawerEditable}
                            />
                            {field.unit ? <i>{field.unit}</i> : null}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}

              {hiddenCostNote}

              <section className={styles.groupSection}>
                <header className={styles.groupHead}>
                  <strong>派生指标</strong>
                  <span className="status-pill" style={{ color: "var(--green)", background: "var(--green-soft)" }}>系统自动算</span>
                  <small>鼠标悬浮到卡片上可见计算口径</small>
                </header>
                <div className={styles.metricsGrid}>
                  {drawerMetrics.map((metric) => (
                    <div key={metric.key} className={styles.metricCard} title={metric.formula}>
                      <small>{metric.label}</small>
                      <strong>
                        {metric.value === null ? "—" : moneyFormat.format(metric.value)}
                        {metric.value !== null && metric.unit ? <i>{metric.unit}</i> : null}
                      </strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="editor-footer">
              {canManage && drawerStatus === "submitted" ? (
                <div className={styles.footerLeft}>
                  <button className="secondary-button" type="button" onClick={() => confirmDevices([drawerDevice.id])}>确认</button>
                  <button className="secondary-button danger-text" type="button" onClick={() => openReturnModal([drawerDevice.id])}>退回</button>
                </div>
              ) : null}
              {drawerEditable ? (
                <>
                  <button className="secondary-button" type="button" onClick={closeDrawer}>取消</button>
                  <button className="secondary-button" type="button" onClick={saveDraft}>保存草稿</button>
                  <button className="secondary-button" type="button" onClick={saveAndNext}>保存并填下一台</button>
                  <button className="primary-button" type="button" onClick={submitDrawer}>提交</button>
                </>
              ) : (
                <>
                  <p className={styles.confirmedTip}>已确认的数据不可修改，需要修改请先退回。</p>
                  <button className="secondary-button" type="button" onClick={closeDrawer}>关闭</button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {returnTarget ? (
        <div className="modal-backdrop confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="report-return-title">
          <section className="confirmation-dialog">
            <span className="confirmation-icon"><Undo2 size={22} /></span>
            <div>
              <small>退回重填</small>
              <h2 id="report-return-title">退回 {returnTarget.length} 台设备的本期数据？</h2>
              <p>退回后状态变为「已退回」，科室修改并重新提交前不计入完成率。退回原因会显示在填报抽屉顶部，请写清要改什么。</p>
              <label className={`form-field ${styles.returnReasonField}`}>
                <span>退回原因<i className="required-mark">必填</i></span>
                <textarea
                  rows={3}
                  value={returnReasonDraft}
                  onChange={(event) => setReturnReasonDraft(event.target.value)}
                  placeholder="例如：电费与能耗平台数据不一致，请核对后重新提交"
                />
              </label>
            </div>
            <footer>
              <button className="secondary-button" onClick={() => setReturnTarget(null)}>取消</button>
              <button className="danger-button" onClick={runReturn}>确认退回</button>
            </footer>
          </section>
        </div>
      ) : null}

      {migrationConfirmOpen ? (
        <div className="modal-backdrop confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="report-migrate-title">
          <section className="confirmation-dialog">
            <span className="confirmation-icon"><Merge size={22} /></span>
            <div>
              <small>归并旧数据</small>
              <h2 id="report-migrate-title">把 {oldCostEntries.length} 条旧成本记录归并到新口径？</h2>
              <p>
                规则：人工 → 人员成本支出，耗材 → 直接耗材支出；旧金额按原口径 ×10000 换算为元（保留到分）；
                同一设备同一期间的同类记录自动累加；已有手工填报值的字段保持原值、绝不覆盖；
                目标期间「已确认」的设备整台跳过；不在台账中的设备跳过。
                执行后会自动下载对照表 CSV，逐笔列明每条旧记录的去向，供财务备查。
              </p>
            </div>
            <footer>
              <button className="secondary-button" onClick={() => setMigrationConfirmOpen(false)}>取消</button>
              <button className="primary-button" onClick={runMigration}>执行归并并下载对照表</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
