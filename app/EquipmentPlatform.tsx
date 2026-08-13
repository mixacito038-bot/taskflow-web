"use client";

import { type Dispatch, FormEvent, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Gauge,
  Boxes,
  Building2,
  Cable,
  Check,
  CircleAlert,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Cloud,
  CloudOff,
  Database,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  GripVertical,
  BookOpen,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Minus,
  MonitorPlay,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  MoreHorizontal,
  Trash2,
  SlidersHorizontal,
  Sparkles,
  Target,
  UserRound,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  CostEntry,
  DashboardModule,
  Device,
  DeviceStatus,
  ModuleHeight,
  ModuleSize,
  cloneDevicesForHospital,
  costFactors,
  dataSources as initialDataSources,
  initialCostEntries,
  initialDevices,
  initialModules,
  monthLabels,
  netBenefit,
  revenueFactors,
  roi,
  totalCost,
  cloneDeviceReportsForHospital,
  cloneDeviceWorkloadForHospital,
} from "./mock-data";
import {
  CategoryPerformancePanel,
  DimensionOverview,
  HospitalComparePanel,
  MetricGovernanceCenter,
  QualityExperiencePanel,
  ReliabilityPanel,
  SingleEquipmentDetail,
  WorkforcePerformancePanel,
} from "./InsightViews";
import AccessControlCenter, { TenantContext } from "./AccessControlCenter";
import ImprovementCenter, { initialActions, normalizeActionBenefitUnits, type ImprovementAction } from "./ImprovementCenter";
import { insightFor } from "./metric-definitions";
import { Hospital, initialHospitals, permissionColumns, ViewerIdentity } from "./access-control-data";
import AccountCenter, { AccountTab } from "./AccountCenter";
import LoginScreen from "./LoginScreen";
import BenefitReportCenter from "./BenefitReportCenter";
import BenefitAnalysisStudio from "./BenefitAnalysisStudio";
import {
  cloneBenefitAnalysisProfiles,
  initialBenefitAnalysisProfiles,
  type BenefitAnalysisProfile,
} from "./benefit-analysis-config";
import CapitalPlanningCenter from "./CapitalPlanningCenter";
import DataWorkbench from "./DataWorkbench";
import BenefitAnalysisCenter from "./BenefitAnalysisCenter";
import DeviceReportCenter, { DeviceReportWorkload } from "./DeviceReportCenter";
import LedgerFieldSettings from "./LedgerFieldSettings";
import MetricCockpitConfig, { MetricCockpitBoard } from "./MetricCockpitConfig";
import MetricDictionarySettings from "./MetricDictionarySettings";
import ReportFieldSettings from "./ReportFieldSettings";
import { DATA_WORKBENCH_ENTRY_CLICKS } from "./data-workbench-model";
import {
  DEVICE_DATA_SOURCES,
  LedgerFieldDefinition,
  nextAssetCode,
  sortedLedgerFields,
  tableLedgerFields,
  usingDepartmentList,
  validateCustomFieldValues,
  validateFieldValue,
} from "./device-ledger-fields";
import {
  DeviceReportRecord,
  listPeriods,
  mergeReportFields,
  ReportFieldDefinition,
} from "./device-report-fields";
import {
  buildDiagnoses,
  type Finding,
} from "./benefit-diagnosis";
import {
  ChartComputeContext,
  ChartTemplate,
  DEFAULT_CHART_TEMPLATES,
  defaultMetricCockpitConfig,
  MetricCockpitConfigState,
  normalizeCockpitConfig,
} from "./chart-template-catalog";
import {
  activeMetrics,
  DEFAULT_METRIC_CATEGORIES,
  DEFAULT_METRIC_DICTIONARY,
  MetricCategory,
  MetricDictionaryEntry,
} from "./metric-dictionary";
import { normalizeHospitalTaxonomy } from "./hospital-catalog";
import { menuCatalog } from "./menu-catalog";
import ConfigurableAnalyticsCanvas from "./ConfigurableAnalyticsCanvas";
import type { MetricDefinition as ConfigurableMetric, VisualizationDefinition as ConfigurableVisualization } from "./analytics-semantic-layer";
import { usePublishedDataset } from "./published-data-client";
import { aggregatePublishedFinancialMonths } from "./published-data";
import type {
  CloudResource,
  CloudResourceRevisions,
  CloudRevisionConflictResponse,
  CloudSharedState,
  CloudStateResponse,
  CloudSyncState,
  CloudUserPreferences,
} from "./cloud-state";

// 空覆盖层复用同一引用：每渲染新建 [] 会让依赖它的 useMemo 每次都重算
const EMPTY_REPORT_FIELDS: ReportFieldDefinition[] = [];

type View = "cockpit" | "analysis" | "report" | "improvement" | "capital" | "workbench" | "equipment" | "ledger-fields" | "metric-dictionary" | "detail" | "costs" | "report-fields" | "layout" | "sources" | "access" | "account";
type Perspective = "管理层" | "设备科" | "临床科室";
type ThemeId = "clinical" | "teal" | "midnight";
type Density = "comfortable" | "compact";
type CloudConflict = CloudRevisionConflictResponse & {
  hospitalId: string;
  localValue: unknown[];
};
type ApplicationSessionState = "checking" | "required" | "locked" | "active" | "error" | "demo";
type ApplicationSessionSnapshot = {
  ssoAuthenticated: boolean;
  authMethod?: "sso" | "password" | null;
  mustChangePassword?: boolean;
  provisioned: boolean;
  account?: {
    email: string;
    displayName: string;
  };
  appSession: {
    status: "unauthenticated" | "unprovisioned" | "none" | "active" | "locked" | "revoked" | "expired" | "invalid";
    createdAt?: string;
    lastSeenAt?: string;
    idleExpiresAt?: string;
    absoluteExpiresAt?: string;
    lockedAt?: string | null;
  };
};

class CloudRequestError extends Error {
  status: number;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.error === "string" ? payload.error : "cloud_state_failed");
    this.status = status;
    this.payload = payload;
  }
}

const currency = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const contentZoomLevels = [0.8, 0.9, 1, 1.1, 1.2, 1.3];
const periodMonthIndexes: Record<string, number[]> = {
  "2026年度": monthLabels.map((_, index) => index),
  "2026年上半年": [0, 1, 2, 3, 4, 5],
  "2026年第二季度": [3, 4, 5],
  // 单月期间：与效益分析报告的月报期间对齐，避免一键月报把全局期间设成驾驶舱不认识的值。
  ...Object.fromEntries(monthLabels.map((_, index) => [`2026年${index + 1}月`, [index]])),
};
const cloudResourceLabels: Record<CloudResource, string> = {
  devices: "设备台账",
  costEntries: "成本明细",
  deviceReports: "设备填报记录",
  reportFields: "填报字段配置",
  chartTemplates: "图表模板",
  metricCockpit: "指标字典驾驶舱",
  deviceCockpit: "单机效益看板",
  improvementActions: "改进任务",
  modules: "驾驶舱布局",
  dataSources: "文件口径配置",
  analysisProfiles: "采集分析配置",
  ledgerFields: "台账字段配置",
  metricDictionary: "指标字典",
  metricCategories: "指标分类",
};

const themeOptions: Array<{ id: ThemeId; name: string; note: string }> = [
  { id: "clinical", name: "临床蓝", note: "清晰、克制，适合日常经营分析" },
  { id: "teal", name: "运营青", note: "更强调效率与增长，适合运营中心" },
  { id: "midnight", name: "深海大屏", note: "高对比深色，适合会议室驾驶舱" },
];

const sizeLabels: Record<ModuleSize, string> = {
  small: "1/3 宽",
  medium: "1/2 宽",
  wide: "2/3 宽",
  full: "整行",
};

const heightLabels: Record<ModuleHeight, string> = {
  compact: "紧凑",
  standard: "标准",
  tall: "加高",
};

const moduleSizeOrder: ModuleSize[] = ["small", "medium", "wide", "full"];
const moduleHeightOrder: ModuleHeight[] = ["compact", "standard", "tall"];

function normalizeSeries(total: number, factors: number[]) {
  const sum = factors.reduce((result, value) => result + value, 0);
  return factors.map((factor) => (total * factor) / sum);
}

function statusTone(status: DeviceStatus) {
  if (status === "效益预警") return "danger";
  if (status === "需要关注") return "warning";
  return "success";
}

function cloneDevices() {
  return initialDevices.map((device) => ({ ...device, cost: { ...device.cost } }));
}

function initialDeviceStore() {
  return Object.fromEntries(initialHospitals.map((hospital) => [hospital.id, cloneDevicesForHospital(hospital.id)]));
}

function cloneCostEntriesForHospital(hospitalId: string) {
  const factor = hospitalId === "hosp-east" ? 0.72 : hospitalId === "hosp-specialty" ? 0.6 : 1;
  return initialCostEntries.map((entry) => ({ ...entry, id: `${hospitalId}-${entry.id}`, amount: Number((entry.amount * factor).toFixed(2)) }));
}

function initialCostEntryStore() {
  return Object.fromEntries(initialHospitals.map((hospital) => [hospital.id, cloneCostEntriesForHospital(hospital.id)]));
}

function initialImprovementStore() {
  return Object.fromEntries(initialHospitals.map((hospital) => [
    hospital.id,
    initialActions.map((action) => ({ ...action })),
  ]));
}

function initialSourceStore() {
  return Object.fromEntries(initialHospitals.map((hospital) => [
    hospital.id,
    initialDataSources.map((source) => ({ ...source })),
  ]));
}

function initialAnalysisProfileStore() {
  return Object.fromEntries(initialHospitals.map((hospital) => [
    hospital.id,
    cloneBenefitAnalysisProfiles(),
  ]));
}

function useDemoState<T>(key: string, initialValue: T, enabled: boolean) {
  const [value, setValue] = useState<T>(initialValue);
  const [ready, setReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(key);
        if (stored) setValue(JSON.parse(stored) as T);
      } catch {
        // The local prototype remains usable when browser storage is unavailable.
      } finally {
        setReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled || !ready) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore local quota/privacy errors in the demonstration build.
    }
  }, [enabled, key, ready, value]);

  return [value, setValue] as const;
}

function resolveStateUpdate<T>(update: SetStateAction<T>, current: T) {
  return typeof update === "function" ? (update as (value: T) => T)(current) : update;
}

function MetricCard({
  label,
  value,
  note,
  icon,
  tone = "blue",
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  tone?: "blue" | "green" | "orange" | "violet" | "red";
}) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{note}</span>
      </div>
    </article>
  );
}

function Panel({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h3>{title}</h3>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyModule({ text }: { text: string }) {
  return (
    <div className="empty-module">
      <BarChart3 size={26} />
      <span>{text}</span>
    </div>
  );
}

export default function EquipmentPlatform({ viewer }: { viewer: ViewerIdentity }) {
  const demoMode = !viewer.authenticated;
  const [view, setView] = useState<View>("cockpit");
  const [demoEntered, setDemoEntered] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [headerPanel, setHeaderPanel] = useState<"account" | null>(null);
  const [accountTab, setAccountTab] = useState<AccountTab>("profile");
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [exitConfirmMode, setExitConfirmMode] = useState<"lock" | "identity" | "all" | null>(null);
  const [applicationSessionState, setApplicationSessionState] = useState<ApplicationSessionState>(viewer.authenticated ? "checking" : "demo");
  const [applicationSession, setApplicationSession] = useState<ApplicationSessionSnapshot | null>(null);
  const [applicationSessionBusy, setApplicationSessionBusy] = useState(false);
  const [applicationSessionError, setApplicationSessionError] = useState("");
  const [applicationSessionRetryKey, setApplicationSessionRetryKey] = useState(0);
  const [tenantRetryKey, setTenantRetryKey] = useState(0);
  const [hospitals, setHospitalsLocal] = useDemoState<Hospital[]>("equip-benefit-hospitals-v1", initialHospitals, demoMode);
  const [activeHospitalId, setActiveHospitalIdLocal] = useDemoState<string>("equip-benefit-active-hospital-v1", initialHospitals[0].id, demoMode);
  const [tenantContext, setTenantContext] = useState<TenantContext | null>(null);
  const [sessionState, setSessionState] = useState<"loading" | "verified" | "demo" | "denied" | "error">(viewer.authenticated ? "loading" : "demo");
  const [department, setDepartment] = useState("全部科室");
  const [period, setPeriod] = useState("2026年度");
  const [perspective, setPerspective] = useState<Perspective>("管理层");
  const [deviceStore, setDeviceStoreLocal] = useDemoState<Record<string, Device[]>>("equip-benefit-devices-by-hospital-v1", demoMode ? initialDeviceStore() : {}, demoMode);
  const [modules, setModulesLocal] = useDemoState<DashboardModule[]>("equip-benefit-modules-v2", initialModules, demoMode);
  const [theme, setThemeLocal] = useDemoState<ThemeId>("equip-benefit-theme", "clinical", demoMode);
  const [density, setDensityLocal] = useDemoState<Density>("equip-benefit-density", "comfortable", demoMode);
  const [contentZoom, setContentZoomLocal] = useDemoState<number>("equip-benefit-content-zoom", 1.1, demoMode);
  const [costEntryStore, setCostEntryStoreLocal] = useDemoState<Record<string, CostEntry[]>>("equip-benefit-cost-entries-by-hospital-v1", demoMode ? initialCostEntryStore() : {}, demoMode);
  const [improvementStore, setImprovementStoreLocal] = useDemoState<Record<string, ImprovementAction[]>>("equip-benefit-improvement-actions-by-hospital-v2", demoMode ? initialImprovementStore() : {}, demoMode);
  const [sourceStore, setSourceStoreLocal] = useDemoState<Record<string, typeof initialDataSources>>("equip-benefit-data-sources-by-hospital-v1", demoMode ? initialSourceStore() : {}, demoMode);
  const [ledgerFieldStore, setLedgerFieldStoreLocal] = useDemoState<Record<string, LedgerFieldDefinition[]>>("equip-benefit-ledger-fields-by-hospital-v1", {}, demoMode);
  const [metricStore, setMetricStoreLocal] = useDemoState<Record<string, MetricDictionaryEntry[]>>("equip-benefit-metric-dictionary-by-hospital-v1", {}, demoMode);
  const [metricCategoryStore, setMetricCategoryStoreLocal] = useDemoState<Record<string, MetricCategory[]>>("equip-benefit-metric-categories-by-hospital-v1", {}, demoMode);
  const [deviceReportStore, setDeviceReportStoreLocal] = useDemoState<Record<string, DeviceReportRecord[]>>("equip-benefit-device-reports-by-hospital-v1", {}, demoMode);
  const [reportFieldStore, setReportFieldStoreLocal] = useDemoState<Record<string, ReportFieldDefinition[]>>("equip-benefit-report-fields-by-hospital-v1", {}, demoMode);
  const [chartTemplateStore, setChartTemplateStoreLocal] = useDemoState<Record<string, ChartTemplate[]>>("equip-benefit-chart-templates-by-hospital-v1", {}, demoMode);
  const [metricCockpitStore, setMetricCockpitStoreLocal] = useDemoState<Record<string, MetricCockpitConfigState[]>>("equip-benefit-metric-cockpit-by-hospital-v1", {}, demoMode);
  const [analysisProfileStore, setAnalysisProfileStoreLocal] = useDemoState<Record<string, BenefitAnalysisProfile[]>>("equip-benefit-analysis-profiles-by-hospital-v1", demoMode ? initialAnalysisProfileStore() : {}, demoMode);
  const [cloudSyncState, setCloudSyncState] = useState<CloudSyncState>(viewer.authenticated ? "idle" : "ready");
  const [cloudHydrated, setCloudHydrated] = useState(!viewer.authenticated);
  const [cloudRetryKey, setCloudRetryKey] = useState(0);
  const [cloudError, setCloudError] = useState("");
  const cloudRequestId = useRef(0);
  const cloudPendingWrites = useRef(0);
  const cloudWriteQueues = useRef<Record<string, Promise<void>>>({});
  const cloudWriteVersions = useRef<Record<string, number>>({});
  const cloudDirtyKeys = useRef(new Set<string>());
  const cloudRevisions = useRef<Record<string, CloudResourceRevisions>>({});
  const [cloudConflict, setCloudConflict] = useState<CloudConflict | null>(null);
  const [cloudConflictAction, setCloudConflictAction] = useState<"server" | "local" | "download" | "">("");
  const initialPreferenceApplied = useRef(false);
  const [toast, setToast] = useState<{ message: string; tone: "info" | "error" } | null>(null);
  const toastTimer = useRef(0);
  const [equipmentSearch, setEquipmentSearch] = useState("");
  // 台账“眼睛”入口带过来的设备：进入设备数据填报时直接打开这台设备的抽屉
  const [reportFocusDeviceId, setReportFocusDeviceId] = useState("");
  // 效益分析页的统计口径：开=只算已确认的填报数据（正式口径），关=含填报中/已提交（预览）
  const [analysisOnlyConfirmed, setAnalysisOnlyConfirmed] = useState(true);
  const [analysisTab, setAnalysisTab] = useState<"overview" | "monitor" | "custom">("overview");
  // 分析页点「建改进任务」带去改进中心的那条问题；改进中心消费一次后清空
  const [pendingFinding, setPendingFinding] = useState<{ deviceId: string; finding: Finding } | null>(null);
  // 分析页/改进中心点「送资本论证」带去资本计划的设备
  const [capitalFocusDeviceId, setCapitalFocusDeviceId] = useState("");
  /**
   * 驾驶舱分两套：行业驾驶舱（模块编排）与指标字典驾驶舱（17 条口径成图）。
   *
   * 配置页和展示页共用这一个状态——配完字典看板直接点左侧「效益驾驶舱」，
   * 看到的就是刚配的那套。两边各存一份的话，会出现"配了半天没地方展示"。
   */
  const [cockpitKind, setCockpitKind] = useState<"industry" | "dictionary">("industry");
  const [equipmentStatus, setEquipmentStatus] = useState("全部状态");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deviceDraft, setDeviceDraft] = useState<Device>(cloneDevices()[0]);
  const [draggingModule, setDraggingModule] = useState<string | null>(null);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [projectionMode, setProjectionMode] = useState(false);
  const [projectionPaused, setProjectionPaused] = useState(false);
  const projectionIndexRef = useRef(0);
  const deepLinkHandled = useRef(false);
  // 深链只允许切换一次医院，避免"切院→数据重载→再切院"的循环。
  const deepLinkHospitalSwitched = useRef(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(initialDevices[0].id);
  const [dataWorkbenchUnlocked, setDataWorkbenchUnlocked] = useState(false);
  const [workbenchEntryPromptOpen, setWorkbenchEntryPromptOpen] = useState(false);
  const [workbenchEntryPassword, setWorkbenchEntryPassword] = useState("");
  const [workbenchEntryError, setWorkbenchEntryError] = useState("");
  const [workbenchEntryBusy, setWorkbenchEntryBusy] = useState(false);
  const brandClickCount = useRef(0);
  const brandClickStartedAt = useRef(0);

  useEffect(() => {
    if (sessionState !== "verified" || !tenantContext) return;
    setHospitalsLocal((current) => tenantContext.memberships.map((membership) => {
      const existing = current.find((hospital) => hospital.id === membership.hospitalId)
        ?? initialHospitals.find((hospital) => hospital.id === membership.hospitalId);
      // 历史库里可能还留着"三级综合"这类把类别混进等级的旧取值，这里统一折算成
      // （等级, 类别）两个字段，等次无从推断的落到"（未定等）"，不臆造甲乙丙。
      const taxonomy = normalizeHospitalTaxonomy(
        membership.hospitalLevel ?? existing?.level ?? "",
        membership.hospitalCategory ?? existing?.category ?? "",
      );
      return {
        id: membership.hospitalId,
        code: membership.hospitalCode,
        name: membership.hospitalName,
        shortName: membership.hospitalShortName,
        level: taxonomy.level,
        category: taxonomy.category,
        assetCodePrefix: membership.hospitalAssetCodePrefix ?? existing?.assetCodePrefix ?? "",
        region: membership.hospitalRegion ?? existing?.region ?? "未设置",
        status: "运行中",
      };
    }));
  }, [sessionState, setHospitalsLocal, tenantContext]);

  const isPlatformAdmin = tenantContext?.memberships.some((membership) => membership.roleId === "role-platform-admin") ?? false;
  const permittedHospitalIds = new Set(tenantContext?.memberships.map((membership) => membership.hospitalId) ?? []);
  const accessibleHospitals = sessionState === "verified" && !isPlatformAdmin
    ? hospitals.filter((hospital) => permittedHospitalIds.has(hospital.id))
    : hospitals;
  const activeHospital = accessibleHospitals.find((hospital) => hospital.id === activeHospitalId) ?? accessibleHospitals[0] ?? hospitals[0];
  const effectiveHospitalId = activeHospital?.id ?? initialHospitals[0].id;
  const workspaceDevices = useMemo(
    () => deviceStore[effectiveHospitalId] ?? (demoMode ? cloneDevicesForHospital(effectiveHospitalId) : []),
    [demoMode, deviceStore, effectiveHospitalId],
  );
  const { view: publishedData, loading: publishedLoading, error: publishedError } = usePublishedDataset(
    effectiveHospitalId,
    sessionState === "verified",
  );
  const devices = useMemo(
    () => sessionState === "demo" ? workspaceDevices : [...publishedData.devices],
    [publishedData.devices, sessionState, workspaceDevices],
  );
  /**
   * 设备台账（资产主数据维护页）看到的设备集合 = 已发布设备 + 本院手工建档的设备。
   *
   * 分析类页面（驾驶舱、单机效益、报告）仍然只认已发布数据，这条边界不动：
   * 那里的每个数字都要能追到发布快照。但台账是主数据维护台，手工录入本来就是
   * 平台承认的一种数据来源（另两种是文件导入和接口对接），不把它显示出来的话，
   * "新增设备"保存成功却查无此设备，等于按钮是坏的。
   * 正式模式下 workspaceDevices 只包含用户真实录入的记录，不含任何演示数据。
   */
  const ledgerDevices = useMemo(() => {
    if (sessionState === "demo") return workspaceDevices;
    const published = publishedData.devices;
    const publishedIds = new Set(published.map((device) => device.id));
    const publishedCodes = new Set(published.map((device) => device.assetCode.trim()));
    // 同一台设备后来走了文件导入并发布，以发布版本为准，避免台账里出现两行。
    const manual = workspaceDevices.filter(
      (device) => !publishedIds.has(device.id) && !publishedCodes.has(device.assetCode.trim()),
    );
    return [...published, ...manual];
  }, [publishedData.devices, sessionState, workspaceDevices]);
  const costEntries = costEntryStore[effectiveHospitalId] ?? (demoMode ? cloneCostEntriesForHospital(effectiveHospitalId) : []);
  /**
   * 收益字段统一按元。云端存量任务是按万元存的，读出来先换算一次。
   * 换算在读取处做而不是写一次性迁移脚本：医院的数据在各自的云端资源里，
   * 迁移脚本要么漏掉没登录过的医院，要么得等一次全量刷库；就地换算 + 标记
   * 则是谁读到谁修好，且反复读不会重复乘。
   */
  const improvementActions = useMemo(
    () => normalizeActionBenefitUnits(improvementStore[effectiveHospitalId] ?? (demoMode ? initialActions : [])),
    [improvementStore, effectiveHospitalId, demoMode],
  );
  const currentDataSources = sourceStore[effectiveHospitalId] ?? (demoMode ? initialDataSources : []);
  const currentLedgerFields = ledgerFieldStore[effectiveHospitalId] ?? [];
  // 医院还没自定义过就用出厂口径；一旦配置过（哪怕清空成 0 条）就以医院的为准。
  const currentMetricEntries = metricStore[effectiveHospitalId] ?? DEFAULT_METRIC_DICTIONARY;
  const currentMetricCategories = metricCategoryStore[effectiveHospitalId] ?? DEFAULT_METRIC_CATEGORIES;
  const currentDeviceReports = deviceReportStore[effectiveHospitalId] ?? (demoMode ? cloneDeviceReportsForHospital(effectiveHospitalId) : []);
  // 覆盖层里存的是医院改写过/新增的字段，合并出厂 18 项才是最终生效清单
  const currentReportFieldOverrides = useMemo(
    () => reportFieldStore[effectiveHospitalId] ?? EMPTY_REPORT_FIELDS,
    [reportFieldStore, effectiveHospitalId],
  );
  const currentReportFields = useMemo(() => mergeReportFields(currentReportFieldOverrides), [currentReportFieldOverrides]);
  // 医院没自定义过就用出厂模板；每渲染新建一份数组会让下游 useMemo 永远失效
  const currentChartTemplates = useMemo(
    () => (chartTemplateStore[effectiveHospitalId]?.length
      ? chartTemplateStore[effectiveHospitalId]
      : [...DEFAULT_CHART_TEMPLATES]),
    [chartTemplateStore, effectiveHospitalId],
  );
  // 云端按数组存（资源统一是数组），驾驶舱配置只有一份，取第 0 条
  const currentMetricCockpit = useMemo(
    () => normalizeCockpitConfig(
      metricCockpitStore[effectiveHospitalId]?.[0],
      new Set(activeMetrics(currentMetricEntries).map((entry) => entry.id)),
      currentChartTemplates,
    ),
    [metricCockpitStore, effectiveHospitalId, currentMetricEntries, currentChartTemplates],
  );
  const currentAnalysisProfiles = analysisProfileStore[effectiveHospitalId] ?? (demoMode ? initialBenefitAnalysisProfiles : []);
  const activeMembership = tenantContext?.memberships.find((membership) => membership.hospitalId === effectiveHospitalId);
  const currentRoleName = activeMembership?.roleName ?? (viewer.authenticated ? "平台超级管理员" : "体验角色");
  const activePermissions = new Set(sessionState === "demo" || (sessionState === "verified" && isPlatformAdmin)
    ? permissionColumns.map((permission) => permission.code)
    : sessionState === "verified" ? activeMembership?.permissions ?? [] : []);
  const hasPermission = (permission: string) => activePermissions.has(permission);
  const dataWorkbenchPermissions = ["connector.manage", "data.ingest", "data.clean", "data.review", "data.publish"];
  const canOpenDataWorkbench = dataWorkbenchPermissions.some(hasPermission);

  function notify(message: string, tone: "info" | "error" = "info") {
    // 清掉上一条提示的计时器，避免连续操作时第二条提示被前一条的定时器提前清空。
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ message, tone });
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
      toastTimer.current = 0;
    }, tone === "error" ? 4200 : 2600);
  }

  function brandClick(now: number) {
    if (!brandClickStartedAt.current || now - brandClickStartedAt.current > 4000) {
      brandClickStartedAt.current = now;
      brandClickCount.current = 1;
    } else {
      brandClickCount.current += 1;
    }
    if (brandClickCount.current >= DATA_WORKBENCH_ENTRY_CLICKS) {
      brandClickCount.current = 0;
      brandClickStartedAt.current = 0;
      if (!canOpenDataWorkbench) {
        notify("当前角色没有数据准备中心权限");
        return;
      }
      if (dataWorkbenchUnlocked) {
        setView("workbench");
        setMobileNavOpen(false);
        return;
      }
      setWorkbenchEntryPassword("");
      setWorkbenchEntryError("");
      setWorkbenchEntryPromptOpen(true);
    }
  }

  async function submitWorkbenchEntryPassword() {
    const password = workbenchEntryPassword.trim();
    if (!password) {
      setWorkbenchEntryError("请输入入口口令");
      return;
    }
    setWorkbenchEntryBusy(true);
    setWorkbenchEntryError("");
    try {
      const response = await fetch("/api/workbench-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        setWorkbenchEntryError("入口口令不正确");
        return;
      }
      setWorkbenchEntryPromptOpen(false);
      setWorkbenchEntryPassword("");
      setDataWorkbenchUnlocked(true);
      setView("workbench");
      setMobileNavOpen(false);
      notify("已进入数据准备模式");
    } catch {
      setWorkbenchEntryError("口令核验失败，请检查网络后重试");
    } finally {
      setWorkbenchEntryBusy(false);
    }
  }

  function initialCloudState(): CloudSharedState {
    return {
      devices: [],
      costEntries: [],
      improvementActions: [],
      modules: initialModules.map((module) => ({ ...module })),
      dataSources: [],
      ledgerFields: [],
      metricDictionary: DEFAULT_METRIC_DICTIONARY,
      metricCategories: DEFAULT_METRIC_CATEGORIES,
      analysisProfiles: [],
      deviceReports: [],
      reportFields: [],
      chartTemplates: [],
      metricCockpit: [defaultMetricCockpitConfig()],
      deviceCockpit: [defaultMetricCockpitConfig()],
    };
  }

  async function requestCloudState(payload: Record<string, unknown>) {
    const response = await fetch("/api/cloud-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as CloudStateResponse & Record<string, unknown>;
    if (!response.ok) throw new CloudRequestError(response.status, result);
    return result as CloudStateResponse;
  }

  async function requestCloudResource(
    hospitalId: string,
    resource: CloudResource,
    value: unknown[],
    explicitBaseRevision?: number,
  ) {
    const baseRevision = explicitBaseRevision
      ?? cloudRevisions.current[hospitalId]?.[resource]
      ?? 0;
    const response = await fetch("/api/cloud-state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hospitalId, resource, value, baseRevision }),
    });
    const result = await response.json() as CloudStateResponse & Record<string, unknown>;
    if (!response.ok) {
      if (
        response.status === 409
        && result.error === "revision_conflict"
        && result.resource === resource
        && Number.isSafeInteger(result.currentRevision)
        && Array.isArray(result.currentValue)
      ) {
        setCloudConflict({
          error: "revision_conflict",
          hospitalId,
          resource,
          expectedRevision: Number(result.expectedRevision) || baseRevision,
          currentRevision: Number(result.currentRevision),
          currentValue: result.currentValue,
          localValue: value,
        });
      }
      throw new CloudRequestError(response.status, result);
    }
    const next = result as CloudStateResponse;
    cloudRevisions.current[hospitalId] = next.revisions;
    return next;
  }

  function applyCloudState(result: CloudStateResponse, hospitalId: string) {
    setDeviceStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.devices }));
    setCostEntryStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.costEntries }));
    setImprovementStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.improvementActions }));
    setSourceStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.dataSources }));
    setLedgerFieldStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.ledgerFields ?? [] }));
    if (result.shared.metricDictionary?.length) setMetricStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.metricDictionary }));
    if (result.shared.metricCategories?.length) setMetricCategoryStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.metricCategories }));
    setAnalysisProfileStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.analysisProfiles }));
    setDeviceReportStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.deviceReports ?? [] }));
    setReportFieldStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.reportFields ?? [] }));
    setChartTemplateStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.chartTemplates ?? [] }));
    setMetricCockpitStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.metricCockpit ?? [] }));
    setModulesLocal(result.shared.modules);
    const preferences = result.preferences;
    if (preferences.theme) setThemeLocal(preferences.theme);
    if (preferences.density) setDensityLocal(preferences.density);
    if (typeof preferences.contentZoom === "number") setContentZoomLocal(preferences.contentZoom);
    if (preferences.department) setDepartment(preferences.department);
    if (preferences.period) setPeriod(preferences.period);
    if (preferences.perspective) setPerspective(preferences.perspective);
    cloudRevisions.current[hospitalId] = result.revisions;
    setCloudError("");
    setCloudHydrated(true);
    setCloudSyncState("ready");
  }

  useEffect(() => {
    if (sessionState !== "verified" || !tenantContext || !effectiveHospitalId) return;
    const requestId = ++cloudRequestId.current;
    const load = async () => {
      setCloudHydrated(false);
      setCloudSyncState("loading");
      setCloudError("");
      const response = await fetch(`/api/cloud-state?hospitalId=${encodeURIComponent(effectiveHospitalId)}`, {
        headers: { accept: "application/json" },
      });
      let result = await response.json() as CloudStateResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "cloud_state_failed");
      const membership = tenantContext.memberships.find((item) => item.hospitalId === effectiveHospitalId);
      const mayInitializeHospital = isPlatformAdmin
        || (membership?.dataScope === "hospital" && membership.permissions.includes("member.manage"));
      if ((!result.initialized || result.missingResources.length) && mayInitializeHospital) {
        result = await requestCloudState({
          action: "bootstrap",
          hospitalId: effectiveHospitalId,
          shared: initialCloudState(),
        });
      }
      if (requestId !== cloudRequestId.current) return;
      const preferredHospitalId = result.preferences.activeHospitalId;
      const canUsePreferredHospital = preferredHospitalId
        && tenantContext.memberships.some((membership) => membership.hospitalId === preferredHospitalId);
      if (!initialPreferenceApplied.current && canUsePreferredHospital && preferredHospitalId !== effectiveHospitalId) {
        initialPreferenceApplied.current = true;
        setActiveHospitalIdLocal(preferredHospitalId);
        return;
      }
      initialPreferenceApplied.current = true;
      applyCloudState(result, effectiveHospitalId);
    };
    const timer = window.setTimeout(() => {
      load().catch((error) => {
        if (requestId !== cloudRequestId.current) return;
        setCloudHydrated(false);
        setCloudSyncState("error");
        setCloudError(error instanceof Error && error.message === "permission_denied"
          ? "当前账号没有初始化或读取该医院云数据的权限"
          : "云端数据暂时无法加载，请检查网络后重试");
      });
    }, 0);
    return () => window.clearTimeout(timer);
    // applyCloudState intentionally reads the current hospital's local setters; requestId prevents stale responses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudRetryKey, effectiveHospitalId, sessionState, tenantContext]);

  function queueCloudWrite(
    key: string,
    request: () => Promise<CloudStateResponse>,
    errorMessage: string,
    toastMessage: string,
  ) {
    if (sessionState !== "verified" || !cloudHydrated) return Promise.resolve();
    const version = (cloudWriteVersions.current[key] ?? 0) + 1;
    cloudWriteVersions.current[key] = version;
    cloudDirtyKeys.current.add(key);
    cloudPendingWrites.current += 1;
    setCloudSyncState("saving");
    const previous = cloudWriteQueues.current[key] ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      try {
        await request();
        if (cloudWriteVersions.current[key] === version) cloudDirtyKeys.current.delete(key);
      } catch (error) {
        const code = error instanceof CloudRequestError && typeof error.payload.error === "string"
          ? error.payload.error
          : "";
        if (code === "revision_conflict") {
          setCloudError("发现另一台设备更新，本机修改已保留，等待选择处理方式");
          notify("检测到云端版本冲突，系统没有覆盖任何一方的数据");
        } else if (code === "base_revision_required") {
          setCloudError("云端版本校验信息缺失，请重新同步后再保存");
          notify("需要重新同步医院云数据后再保存");
        } else {
          setCloudError(errorMessage);
          notify(toastMessage);
        }
      } finally {
        cloudPendingWrites.current -= 1;
        if (cloudPendingWrites.current) {
          setCloudSyncState("saving");
        } else if (cloudDirtyKeys.current.size) {
          setCloudSyncState("error");
        } else {
          setCloudError("");
          setCloudSyncState("ready");
        }
      }
    });
    cloudWriteQueues.current[key] = task;
    return task;
  }

  function persistCloudResource<T extends unknown[]>(resource: CloudResource, value: T) {
    const hospitalId = effectiveHospitalId;
    return queueCloudWrite(
      `${hospitalId}:${resource}`,
      () => requestCloudResource(hospitalId, resource, value),
      "有更改尚未保存到云端，请重试",
      "云端保存失败，本次更改尚未跨设备同步",
    );
  }

  function persistCloudPreferences(value: CloudUserPreferences) {
    const hospitalId = effectiveHospitalId;
    return queueCloudWrite(
      "account:preferences",
      () => requestCloudState({ action: "save_preferences", hospitalId, value }),
      "个人设置尚未保存到云端",
      "个人设置云端同步失败，请稍后重试",
    );
  }

  function applyCloudResourceLocally(
    hospitalId: string,
    resource: CloudResource,
    value: unknown[],
  ) {
    if (resource === "devices") {
      setDeviceStoreLocal((current) => ({ ...current, [hospitalId]: value as Device[] }));
    } else if (resource === "costEntries") {
      setCostEntryStoreLocal((current) => ({ ...current, [hospitalId]: value as CostEntry[] }));
    } else if (resource === "improvementActions") {
      setImprovementStoreLocal((current) => ({ ...current, [hospitalId]: value as ImprovementAction[] }));
    } else if (resource === "modules") {
      setModulesLocal(value as DashboardModule[]);
    } else if (resource === "dataSources") {
      setSourceStoreLocal((current) => ({ ...current, [hospitalId]: value as typeof initialDataSources }));
    } else if (resource === "ledgerFields") {
      setLedgerFieldStoreLocal((current) => ({ ...current, [hospitalId]: value as LedgerFieldDefinition[] }));
    } else if (resource === "metricDictionary") {
      setMetricStoreLocal((current) => ({ ...current, [hospitalId]: value as MetricDictionaryEntry[] }));
    } else if (resource === "metricCategories") {
      setMetricCategoryStoreLocal((current) => ({ ...current, [hospitalId]: value as MetricCategory[] }));
    } else if (resource === "deviceReports") {
      setDeviceReportStoreLocal((current) => ({ ...current, [hospitalId]: value as DeviceReportRecord[] }));
    } else if (resource === "reportFields") {
      setReportFieldStoreLocal((current) => ({ ...current, [hospitalId]: value as ReportFieldDefinition[] }));
    } else if (resource === "chartTemplates") {
      setChartTemplateStoreLocal((current) => ({ ...current, [hospitalId]: value as ChartTemplate[] }));
    } else if (resource === "metricCockpit") {
      setMetricCockpitStoreLocal((current) => ({ ...current, [hospitalId]: value as MetricCockpitConfigState[] }));
    } else {
      setAnalysisProfileStoreLocal((current) => ({ ...current, [hospitalId]: value as BenefitAnalysisProfile[] }));
    }
  }

  function settleCloudConflict(conflict: CloudConflict) {
    cloudDirtyKeys.current.delete(`${conflict.hospitalId}:${conflict.resource}`);
    setCloudConflict(null);
    setCloudConflictAction("");
    if (cloudDirtyKeys.current.size) {
      setCloudSyncState("error");
    } else if (cloudPendingWrites.current) {
      setCloudSyncState("saving");
    } else {
      setCloudError("");
      setCloudSyncState("ready");
    }
  }

  function useServerConflictVersion() {
    if (!cloudConflict) return;
    setCloudConflictAction("server");
    applyCloudResourceLocally(
      cloudConflict.hospitalId,
      cloudConflict.resource,
      cloudConflict.currentValue,
    );
    const revisions = cloudRevisions.current[cloudConflict.hospitalId];
    if (revisions) revisions[cloudConflict.resource] = cloudConflict.currentRevision;
    const label = cloudResourceLabels[cloudConflict.resource];
    settleCloudConflict(cloudConflict);
    notify(`已采用云端${label}，本机冲突版本未覆盖云端`);
  }

  async function keepLocalConflictVersion() {
    if (!cloudConflict || cloudConflictAction) return;
    const conflict = cloudConflict;
    setCloudConflictAction("local");
    setCloudSyncState("saving");
    try {
      await requestCloudResource(
        conflict.hospitalId,
        conflict.resource,
        conflict.localValue,
        conflict.currentRevision,
      );
      settleCloudConflict(conflict);
      notify(`已明确使用本机${cloudResourceLabels[conflict.resource]}覆盖上一云端版本，并保留审计记录`);
    } catch (error) {
      const code = error instanceof CloudRequestError && typeof error.payload.error === "string"
        ? error.payload.error
        : "";
      if (code === "revision_conflict") {
        setCloudError("处理期间云端再次更新，请重新比较最新版本");
        notify("云端在处理期间再次更新，系统仍未覆盖数据");
      } else {
        setCloudError("本机版本仍未保存，请检查网络后重试");
        notify("本机版本保存失败，数据仍保留在当前页面");
      }
      setCloudSyncState("error");
      setCloudConflictAction("");
    }
  }

  function downloadLocalConflictCopy() {
    if (!cloudConflict) return;
    setCloudConflictAction("download");
    const content = JSON.stringify({
      format: "yonghong-cloud-conflict-copy",
      exportedAt: new Date().toISOString(),
      hospitalId: cloudConflict.hospitalId,
      resource: cloudConflict.resource,
      expectedRevision: cloudConflict.expectedRevision,
      currentCloudRevision: cloudConflict.currentRevision,
      records: cloudConflict.localValue,
    }, null, 2);
    const href = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${cloudResourceLabels[cloudConflict.resource]}-本机冲突副本-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
    setCloudConflictAction("");
    notify("本机冲突副本已下载，可在选择版本前留存");
  }

  function setDevices(update: Device[] | ((current: Device[]) => Device[])) {
    setDeviceStoreLocal((currentStore) => {
      const current = currentStore[effectiveHospitalId] ?? (demoMode ? cloneDevicesForHospital(effectiveHospitalId) : []);
      const next = typeof update === "function" ? update(current) : update;
      void persistCloudResource("devices", next);
      return { ...currentStore, [effectiveHospitalId]: next };
    });
  }

  const setImprovementActions: Dispatch<SetStateAction<ImprovementAction[]>> = (update) => {
    setImprovementStoreLocal((currentStore) => {
      const current = normalizeActionBenefitUnits(currentStore[effectiveHospitalId] ?? (demoMode ? initialActions : []));
      const next = resolveStateUpdate(update, current);
      void persistCloudResource("improvementActions", next);
      return { ...currentStore, [effectiveHospitalId]: next };
    });
  };

  const setModules: Dispatch<SetStateAction<DashboardModule[]>> = (update) => {
    setModulesLocal((current) => {
      const next = resolveStateUpdate(update, current);
      void persistCloudResource("modules", next);
      return next;
    });
  };

  const setCurrentLedgerFields: Dispatch<SetStateAction<LedgerFieldDefinition[]>> = (update) => {
    setLedgerFieldStoreLocal((currentStore) => {
      const current = currentStore[effectiveHospitalId] ?? [];
      const next = resolveStateUpdate(update, current);
      void persistCloudResource("ledgerFields", next);
      return { ...currentStore, [effectiveHospitalId]: next };
    });
  };

  const setCurrentDeviceReports = (next: DeviceReportRecord[]) => {
    setDeviceReportStoreLocal((currentStore) => {
      void persistCloudResource("deviceReports", next);
      return { ...currentStore, [effectiveHospitalId]: next };
    });
  };

  const setCurrentReportFields = (next: ReportFieldDefinition[]) => {
    setReportFieldStoreLocal((currentStore) => {
      void persistCloudResource("reportFields", next);
      return { ...currentStore, [effectiveHospitalId]: next };
    });
  };

  const setCurrentChartTemplates = (next: ChartTemplate[]) => {
    setChartTemplateStoreLocal((currentStore) => {
      void persistCloudResource("chartTemplates", next);
      return { ...currentStore, [effectiveHospitalId]: next };
    });
  };

  const setCurrentMetricCockpit = (next: MetricCockpitConfigState) => {
    setMetricCockpitStoreLocal((currentStore) => {
      void persistCloudResource("metricCockpit", [next]);
      return { ...currentStore, [effectiveHospitalId]: [next] };
    });
  };

  const setCurrentMetricEntries = (next: MetricDictionaryEntry[]) => {
    setMetricStoreLocal((current) => ({ ...current, [effectiveHospitalId]: next }));
    void persistCloudResource("metricDictionary", next);
  };

  const setCurrentMetricCategories = (next: MetricCategory[]) => {
    setMetricCategoryStoreLocal((current) => ({ ...current, [effectiveHospitalId]: next }));
    void persistCloudResource("metricCategories", next);
  };

  const setCurrentAnalysisProfiles: Dispatch<SetStateAction<BenefitAnalysisProfile[]>> = (update) => {
    setAnalysisProfileStoreLocal((currentStore) => {
      const current = currentStore[effectiveHospitalId] ?? (demoMode ? cloneBenefitAnalysisProfiles() : []);
      const next = resolveStateUpdate(update, current);
      void persistCloudResource("analysisProfiles", next);
      return { ...currentStore, [effectiveHospitalId]: next };
    });
  };

  function setTheme(value: ThemeId) {
    setThemeLocal(value);
    void persistCloudPreferences({ theme: value });
  }

  function setDensity(value: Density) {
    setDensityLocal(value);
    void persistCloudPreferences({ density: value });
  }

  function setContentZoom(value: number) {
    setContentZoomLocal(value);
    void persistCloudPreferences({ contentZoom: value });
  }



  function setDepartmentPreference(value: string) {
    setDepartment(value);
    void persistCloudPreferences({ department: value });
  }

  function setPeriodPreference(value: string) {
    setPeriod(value);
    void persistCloudPreferences({ period: value });
  }

  function setPerspectivePreference(value: Perspective) {
    setPerspective(value);
    void persistCloudPreferences({ perspective: value });
  }

  function setActiveHospital(value: string) {
    setActiveHospitalIdLocal(value);
    void persistCloudPreferences({ activeHospitalId: value });
  }

  function clearAuthenticatedWorkspace() {
    setTenantContext(null);
    setSessionState("loading");
    setCloudHydrated(false);
    setCloudSyncState("idle");
    setCloudError("");
    setCloudConflict(null);
    setHeaderPanel(null);
    setMobileNavOpen(false);
    setDeviceStoreLocal(initialDeviceStore());
    setCostEntryStoreLocal(initialCostEntryStore());
    setImprovementStoreLocal(initialImprovementStore());
    setSourceStoreLocal(initialSourceStore());
    setAnalysisProfileStoreLocal(initialAnalysisProfileStore());
    setModulesLocal(initialModules);
    setView("cockpit");
  }

  function applyApplicationSessionSnapshot(snapshot: ApplicationSessionSnapshot) {
    setApplicationSession(snapshot);
    setApplicationSessionError("");
    if (snapshot.appSession.status === "active") {
      setApplicationSessionState("active");
      return;
    }
    clearAuthenticatedWorkspace();
    setApplicationSessionState(snapshot.appSession.status === "locked" ? "locked" : "required");
  }

  async function refreshApplicationSession() {
    const response = await fetch("/api/app-session", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const result = await response.json() as ApplicationSessionSnapshot & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "app_session_status_failed");
    applyApplicationSessionSnapshot(result);
    return result;
  }

  function publishApplicationSessionChange(state: "locked" | "required" | "active") {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("yh-application-session");
    channel.postMessage({ state });
    channel.close();
  }

  useEffect(() => {
    if (!viewer.authenticated) return;
    let cancelled = false;
    fetch("/api/app-session", {
      headers: { accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json() as ApplicationSessionSnapshot & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "app_session_status_failed");
        return result;
      })
      .then((snapshot) => {
        if (!cancelled) applyApplicationSessionSnapshot(snapshot);
      })
      .catch(() => {
        if (cancelled) return;
        clearAuthenticatedWorkspace();
        setApplicationSessionState("error");
        setApplicationSessionError("系统会话状态暂时无法核验，请检查网络后重试。");
      });
    return () => { cancelled = true; };
    // The retry key intentionally rechecks the server-owned application session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationSessionRetryKey, viewer.authenticated]);

  useEffect(() => {
    if (!viewer.authenticated || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("yh-application-session");
    const recheck = () => {
      void refreshApplicationSession().catch(() => {
        clearAuthenticatedWorkspace();
        setApplicationSessionState("error");
        setApplicationSessionError("系统会话状态暂时无法核验，请重新检查。");
      });
    };
    channel.addEventListener("message", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      channel.removeEventListener("message", recheck);
      channel.close();
      window.removeEventListener("focus", recheck);
    };
    // Session refresh is intentionally bound once; current setters remain stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.authenticated]);

  async function continueApplicationSession(credential: string) {
    setApplicationSessionBusy(true);
    setApplicationSessionError("");
    try {
      // 二次验证已下线，解锁只需要账号密码本身，不再做 `password|mfacode` 的拼接解析。
      const passwordSession = applicationSession?.authMethod === "password";
      const response = await fetch("/api/app-session", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action: applicationSessionState === "locked" ? "unlock" : "start",
          ...(passwordSession ? { password: credential } : {}),
        }),
      });
      const result = await response.json() as ApplicationSessionSnapshot & { error?: string; lockedUntil?: string };
      if (!response.ok) {
        const message = {
          account_not_provisioned: "当前账号尚未加入任何医院，请联系平台管理员配置医院与角色。",
          account_disabled: "当前账号已停用，请联系平台管理员。",
          app_session_not_locked: "当前会话状态已变化，正在重新核验。",
          password_required: "请输入账号密码后解锁。",
          invalid_credentials: "账号密码不正确，请重新输入。",
          credential_locked: result.lockedUntil
            ? `密码错误次数过多，请在 ${new Date(result.lockedUntil).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 后重试。`
            : "密码错误次数过多，请稍后重试。",
        }[result.error ?? ""] ?? "暂时无法进入系统，请稍后重试。";
        setApplicationSessionError(message);
        if (result.error === "app_session_not_locked") setApplicationSessionRetryKey((current) => current + 1);
        return;
      }
      applyApplicationSessionSnapshot(result);
      setSessionState("loading");
      setTenantRetryKey((current) => current + 1);
      publishApplicationSessionChange("active");
    } finally {
      setApplicationSessionBusy(false);
    }
  }

  async function changeApplicationSession(action: "lock" | "revoke" | "revoke_all") {
    setApplicationSessionBusy(true);
    setApplicationSessionError("");
    try {
      const response = await fetch("/api/app-session", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as ApplicationSessionSnapshot & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "app_session_action_failed");
      applyApplicationSessionSnapshot(result);
      publishApplicationSessionChange(action === "lock" ? "locked" : "required");
    } catch {
      setApplicationSessionError("系统会话操作未完成，请检查网络后重试。");
      throw new Error("app_session_action_failed");
    } finally {
      setApplicationSessionBusy(false);
    }
  }

  async function passwordLogin(username: string, password: string) {
    const response = await fetch("/api/app-session", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ action: "password_login", username, password }),
    });
    const result = await response.json().catch(() => ({})) as { error?: string; lockedUntil?: string };
    if (!response.ok) {
      const code = result.error ?? "password_login_failed";
      const message = {
        credentials_required: "请输入登录账号和密码。",
        invalid_credentials: "账号或密码不正确，请重新输入。",
        account_disabled: "当前账号已停用，请联系平台管理员。",
        credential_locked: result.lockedUntil
          ? `密码错误次数过多，请在 ${new Date(result.lockedUntil).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 后重试。`
          : "密码错误次数过多，请稍后重试。",
      }[code] ?? "登录失败，请稍后重试。";
      return { ok: false as const, code, message };
    }
    // 服务端会话 Cookie 已写入；整页刷新让服务端身份解析接管后续流程。
    window.location.reload();
    return { ok: true as const };
  }

  const passwordAuthenticated = applicationSession?.authMethod === "password";

  async function confirmExitAction() {
    if (!exitConfirmMode || applicationSessionBusy || cloudSyncState === "saving") return;
    const mode = exitConfirmMode;
    setExitConfirmMode(null);
    if (mode === "identity") {
      try {
        await changeApplicationSession("revoke");
      } catch {
        // The trusted identity is still explicitly signed out if local revocation is unavailable.
      }
      if (passwordAuthenticated) {
        window.location.reload();
      } else {
        window.location.assign("/signout-with-chatgpt?return_to=%2F");
      }
      return;
    }
    try {
      await changeApplicationSession(mode === "all" ? "revoke_all" : "lock");
    } catch {
      notify("系统会话操作未完成，请稍后重试");
    }
  }

  async function switchUnifiedIdentity() {
    try {
      await changeApplicationSession("revoke");
    } catch {
      // Identity switching remains available if the already-expired app session cannot be revoked.
    }
    if (passwordAuthenticated) {
      window.location.reload();
    } else {
      window.location.assign("/signout-with-chatgpt?return_to=%2F");
    }
  }

  useEffect(() => {
    if (!viewer.authenticated || applicationSessionState !== "active") return;
    let cancelled = false;
    fetch("/api/tenant-context", { headers: { accept: "application/json" } })
      .then(async (response) => {
        if (response.status === 423) {
          const result = await response.json() as { error?: string };
          clearAuthenticatedWorkspace();
          setApplicationSessionState(result.error === "app_session_locked" ? "locked" : "required");
          return { sessionRequired: true } as const;
        }
        if (response.status === 403) return { denied: true } as const;
        if (!response.ok) throw new Error("tenant context unavailable");
        return response.json() as Promise<TenantContext>;
      })
      .then((context) => {
        if (cancelled) return;
        if ("sessionRequired" in context) return;
        if ("denied" in context) {
          setSessionState("denied");
          return;
        }
        setTenantContext(context);
        setSessionState("verified");
      })
      .catch(() => {
        if (!cancelled) setSessionState("error");
      });
    return () => { cancelled = true; };
    // The retry key intentionally reruns membership resolution after a new application session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationSessionState, tenantRetryKey, viewer.authenticated]);

  useEffect(() => {
    if (!accessibleHospitals.length || accessibleHospitals.some((hospital) => hospital.id === activeHospitalId)) return;
    setActiveHospitalIdLocal(accessibleHospitals[0].id);
  }, [accessibleHospitals, activeHospitalId, setActiveHospitalIdLocal]);

  useEffect(() => {
    // 深链解析：设备档案二维码可携带 ?device=<id>（可选 ?view=<安全视图>）直达单机分析。
    // 必须等工作区就绪（演示模式已进入，或正式会话已核验）后再消费，
    // 否则会在登录页阶段被吃掉，密码登录整页刷新后深链就丢了。
    if (deepLinkHandled.current) return;
    const workspaceReady = demoMode ? demoEntered : sessionState === "verified";
    if (!workspaceReady) return;
    const params = new URLSearchParams(window.location.search);
    const deviceParam = params.get("device");
    const viewParam = params.get("view");
    const hospitalParam = params.get("hospital");
    if (!deviceParam && !viewParam) {
      deepLinkHandled.current = true;
      return;
    }
    let hospitalOutOfScope = false;
    if (hospitalParam && hospitalParam !== activeHospitalId && !deepLinkHospitalSwitched.current) {
      // 二维码带医院上下文时先切到该院再解析设备；无权限则如实告知，不静默落到当前医院。
      deepLinkHospitalSwitched.current = true;
      if (accessibleHospitals.some((hospital) => hospital.id === hospitalParam)) {
        setActiveHospitalIdLocal(hospitalParam);
        return;
      }
      hospitalOutOfScope = true;
    }
    // 只在发布数据仍在读取时等待；读完仍为空就照常消费深链并给出反馈，
    // 否则 ?device 会永久挂起，把同一条深链里的 ?view 一起卡住。
    if (deviceParam && !devices.length && !demoMode && publishedLoading) return;
    deepLinkHandled.current = true;
    const safeViews: View[] = ["cockpit", "analysis", "equipment", "detail"];
    const timer = window.setTimeout(() => {
      if (hospitalOutOfScope) notify("扫码指向的医院不在当前账号的授权范围，已停留在当前医院", "error");
      if (deviceParam) {
        if (devices.some((device) => device.id === deviceParam)) {
          setSelectedDeviceId(deviceParam);
          setView("detail");
        } else {
          // 诚实反馈：设备不在当前医院的可见范围（未发布或跨院）时明确告知，不静默吞掉。
          notify("扫码设备不在当前医院的可见范围，请确认医院或该设备数据是否已发布", "error");
        }
      } else if (viewParam && safeViews.includes(viewParam as View)) {
        // ?view 只能落到当前角色有权限的视图，避免深链绕过左侧菜单的权限过滤。
        // 权限取自与左侧菜单同源的菜单目录，避免前向引用尚未声明的 navItems。
        const target = menuCatalog.find((item) => item.id === viewParam);
        const allowed = !target || !target.permissions.length || target.permissions.some(hasPermission);
        if (allowed) setView(viewParam as View);
        else notify("当前角色没有该页面的访问权限", "error");
      }
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
    }, 0);
    return () => window.clearTimeout(timer);
    // navItems/hasPermission 每次渲染重建，加入依赖会导致重复消费；深链只消费一次由 ref 守卫。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessibleHospitals, activeHospitalId, demoEntered, demoMode, devices, publishedLoading, sessionState]);

  useEffect(() => {
    // 口令弹窗支持 Esc 关闭，与平台其它确认弹窗保持一致的键盘可达性。
    if (!workbenchEntryPromptOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || workbenchEntryBusy) return;
      setWorkbenchEntryPromptOpen(false);
      setWorkbenchEntryPassword("");
      setWorkbenchEntryError("");
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [workbenchEntryBusy, workbenchEntryPromptOpen]);

  useEffect(() => {
    if (!projectionMode) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setProjectionMode(false);
      setProjectionPaused(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [projectionMode]);

  useEffect(() => {
    if (!projectionMode || projectionPaused) return;
    // 字典看板不用模块网格，它自己带轮播（rotateMs），这里就不要再滚一遍页面
    if (cockpitKind === "dictionary") return;
    const timer = window.setInterval(() => {
      const moduleNodes = document.querySelectorAll<HTMLElement>(".projection-mode .dashboard-grid > .module");
      if (!moduleNodes.length) return;
      projectionIndexRef.current = (projectionIndexRef.current + 1) % moduleNodes.length;
      moduleNodes[projectionIndexRef.current]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 15000);
    return () => window.clearInterval(timer);
  }, [projectionMode, projectionPaused, cockpitKind]);

  function enterProjectionMode() {
    setProjectionMode(true);
    setProjectionPaused(false);
    projectionIndexRef.current = 0;
    setHeaderPanel(null);
    setMobileNavOpen(false);
    setLayoutEditing(false);
    setDraggingModule(null);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  function exitProjectionMode() {
    setProjectionMode(false);
    setProjectionPaused(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }

  const departmentOptions = useMemo(() => ["全部科室", ...Array.from(new Set(devices.map((device) => device.department)))], [devices]);

  const safeContentZoom = contentZoomLevels.includes(contentZoom) ? contentZoom : 1.1;
  const contentZoomIndex = contentZoomLevels.indexOf(safeContentZoom);
  const contentZoomStyle = {
    "--content-zoom": safeContentZoom,
    "--content-zoom-width": `${100 / safeContentZoom}%`,
    "--content-zoom-max": `${3200 / safeContentZoom}px`,
  } as React.CSSProperties;

  const filteredDevices = useMemo(
    () => (department === "全部科室" ? devices : devices.filter((device) => device.department === department)),
    [department, devices],
  );

  const totals = useMemo(() => {
    const investment = filteredDevices.reduce((sum, device) => sum + device.investment, 0);
    const revenue = filteredDevices.reduce((sum, device) => sum + device.revenue, 0);
    const cost = filteredDevices.reduce((sum, device) => sum + totalCost(device), 0);
    const net = revenue - cost;
    const utilization = filteredDevices.length
      ? filteredDevices.reduce((sum, device) => sum + device.utilization, 0) / filteredDevices.length
      : 0;
    const alerts = filteredDevices.filter((device) => device.status !== "运行良好").length;
    return { investment, revenue, cost, net, utilization, alerts };
  }, [filteredDevices]);

  const selectedMonthIndexes = periodMonthIndexes[period] ?? periodMonthIndexes["2026年度"];
  const publishedFinancialMonths = useMemo(
    () => aggregatePublishedFinancialMonths(publishedData.rows, filteredDevices.map((device) => device.id)),
    [filteredDevices, publishedData.rows],
  );
  const selectedPublishedMonths = useMemo(
    () => publishedFinancialMonths.months.filter((item) => item.period.startsWith("2026-") && selectedMonthIndexes.includes(Number(item.period.slice(5)) - 1)),
    [publishedFinancialMonths.months, selectedMonthIndexes],
  );
  const periodRatios = useMemo(() => {
    const ratio = (factors: number[]) => selectedMonthIndexes.reduce((sum, index) => sum + factors[index], 0) / factors.reduce((sum, value) => sum + value, 0);
    return { revenue: ratio(revenueFactors), cost: ratio(costFactors), service: selectedMonthIndexes.length / monthLabels.length };
  }, [selectedMonthIndexes]);
  const periodTotals = useMemo(() => {
    if (sessionState === "verified") {
      const available = publishedFinancialMonths.completeTimeGrain && selectedPublishedMonths.length > 0;
      const revenue = selectedPublishedMonths.reduce((sum, item) => sum + item.revenue, 0);
      const cost = selectedPublishedMonths.reduce((sum, item) => sum + item.cost, 0);
      return { ...totals, revenue, cost, net: revenue - cost, available };
    }
    const revenue = totals.revenue * periodRatios.revenue;
    const cost = totals.cost * periodRatios.cost;
    return { ...totals, revenue, cost, net: revenue - cost, available: true };
  }, [periodRatios.cost, periodRatios.revenue, publishedFinancialMonths.completeTimeGrain, selectedPublishedMonths, sessionState, totals]);

  const trendData = useMemo(() => {
    if (sessionState === "verified") return selectedPublishedMonths.map((item) => ({
      month: item.month,
      收入: Number(item.revenue.toFixed(1)),
      成本: Number(item.cost.toFixed(1)),
      净收益: Number((item.revenue - item.cost).toFixed(1)),
    }));
    const revenueSeries = normalizeSeries(totals.revenue, revenueFactors);
    const costSeries = normalizeSeries(totals.cost, costFactors);
    return monthLabels.map((month, index) => ({
      month,
      收入: Number(revenueSeries[index].toFixed(1)),
      成本: Number(costSeries[index].toFixed(1)),
      净收益: Number((revenueSeries[index] - costSeries[index]).toFixed(1)),
    })).filter((_, index) => selectedMonthIndexes.includes(index));
  }, [selectedMonthIndexes, selectedPublishedMonths, sessionState, totals.cost, totals.revenue]);

  const costStructure = useMemo(() => {
    const labels: Array<[keyof Device["cost"], string]> = [
      ["labor", "人工"],
      ["consumables", "耗材/试剂"],
      ["depreciation", "折旧"],
      ["maintenance", "维修维保"],
      ["energy", "水电气"],
      ["space", "房屋配套"],
      ["indirect", "间接成本"],
    ];
    return labels.map(([key, name]) => ({
      name,
      value: sessionState === "verified"
        ? selectedPublishedMonths.reduce((sum, month) => sum + (month.costByType[key] ?? 0), 0)
        : filteredDevices.reduce((sum, device) => sum + device.cost[key], 0) * periodRatios.cost,
    }));
  }, [filteredDevices, periodRatios.cost, selectedPublishedMonths, sessionState]);

  const paybackData = filteredDevices.map((device) => ({
    name: device.shortName,
    原计划: device.planPayback,
    最新预计: device.forecastPayback,
  }));

  const efficiencyData = filteredDevices.map((device) => ({
    name: device.shortName,
    x: device.utilization,
    y: Number(roi(device).toFixed(1)),
    z: Math.max(80, device.investment / 3),
  }));

  const visibleModules = modules.filter((module) => module.visible);
  const riskDevices = filteredDevices
    .filter((device) => device.status !== "运行良好" || netBenefit(device) < 0 || device.utilization < 60)
    .sort((a, b) => roi(a) - roi(b));

  const selectedDevice = ledgerDevices.find((device) => device.id === selectedDeviceId) ?? devices[0];
  const availabilityValues = filteredDevices
    .map((device) => sessionState === "verified" ? publishedData.insights[device.id]?.availabilityRate : insightFor(device.id).availabilityRate)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageAvailability = availabilityValues.length
    ? availabilityValues.reduce((sum, value) => sum + value, 0) / availabilityValues.length
    : 0;
  const perspectiveItems: Record<Perspective, Array<{ label: string; value: string; note: string }>> = {
    管理层: [
      { label: "资产规模", value: `${currency.format(totals.investment)} 万`, note: "当前筛选设备原值" },
      { label: "设备可用率", value: `${averageAvailability.toFixed(1)}%`, note: "按计划可用时长核算" },
      { label: "维修维保成本", value: `${currency.format(filteredDevices.reduce((sum, device) => sum + device.cost.maintenance, 0))} 万`, note: "合同与工单去重后" },
      { label: period === "2026年度" ? "会计净收益" : "期间会计净收益", value: periodTotals.available ? `${currency.format(periodTotals.net)} 万` : "数据缺失", note: periodTotals.available ? "收入减含折旧全成本" : "当前发布文件缺少可用期间字段" },
    ],
    设备科: [
      { label: "待处理报修", value: sessionState === "demo" ? "28" : "—", note: sessionState === "demo" ? "维修工单示例" : "等待已发布工单指标" },
      { label: "超时工单", value: sessionState === "demo" ? "6" : "—", note: sessionState === "demo" ? "超过服务级别 · 演示" : "等待已发布工单指标" },
      { label: "维保到期", value: sessionState === "demo" ? "15" : "—", note: sessionState === "demo" ? "未来 30 天 · 演示" : "等待已发布合同指标" },
      { label: "PM 逾期", value: sessionState === "demo" ? "8" : "—", note: sessionState === "demo" ? "应完成未完成 · 演示" : "等待已发布 PM 指标" },
    ],
    临床科室: [
      { label: "科室设备总数", value: sessionState === "demo" ? "132" : String(filteredDevices.length), note: sessionState === "demo" ? "全院临床科室演示" : "当前发布版本" },
      { label: "报修进行中", value: sessionState === "demo" ? "9" : "—", note: sessionState === "demo" ? "受理至待验收 · 演示" : "等待已发布工单指标" },
      { label: "保养提醒", value: sessionState === "demo" ? "14" : "—", note: sessionState === "demo" ? "未来 14 天 · 演示" : "等待已发布 PM 指标" },
      { label: "可借调设备", value: sessionState === "demo" ? "21" : "—", note: sessionState === "demo" ? "同类低负荷设备 · 演示" : "等待已发布共享指标" },
    ],
  };
  const configuredPublishedCanvases = sessionState === "verified" ? publishedData.visualizationDefinitions.flatMap((visualization) => {
    const metric = publishedData.metricDefinitions.find((definition) => definition.id === visualization.metricDefinitionId || definition.code === visualization.metricCode);
    const data = publishedData.analytics[visualization.id];
    if (!metric || !data?.length) return [];
    const configurableMetric = {
      code: metric.code,
      name: metric.name,
      aggregation: metric.aggregation,
      field: metric.sourceFieldRefs[0] ?? metric.code,
      unit: metric.unit,
      allowedDimensions: metric.dimensions,
      status: "active",
      version: metric.version,
    } as unknown as ConfigurableMetric;
    const configurableVisualization = {
      code: visualization.code,
      name: visualization.name,
      metricCode: metric.code,
      chartType: visualization.chartType,
      dimension: visualization.dimension || undefined,
      series: visualization.series || undefined,
      sort: visualization.sort === "none" ? undefined : visualization.sort,
      limit: visualization.limit,
      status: "active",
      version: visualization.version,
    } satisfies ConfigurableVisualization;
    return [{ metric: configurableMetric, visualization: configurableVisualization, data }];
  }) : [];
  const publishedSupplyStatus = sessionState !== "verified"
    ? "演示口径：2026-V2.0"
    : publishedLoading
      ? "正在读取正式数据"
      : publishedData.publication
        ? `发布 ${publishedData.publication.seriesId}@${publishedData.publication.version}`
        : publishedError
          ? "正式数据读取失败"
          : "正式数据未发布";

  function navigate(nextView: View) {
    setView(nextView);
    setHeaderPanel(null);
    setMobileNavOpen(false);
    setLayoutEditing(false);
    setDraggingModule(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openDeviceDetail(device: Device) {
    setSelectedDeviceId(device.id);
    navigate("detail");
  }

  /** 分析类页面只拿得到 deviceId，这里按 id 打开单机分析 */
  function openDeviceDetailById(deviceId: string) {
    setSelectedDeviceId(deviceId);
    navigate("detail");
  }

  function switchHospital(hospitalId: string) {
    const hospital = accessibleHospitals.find((item) => item.id === hospitalId);
    if (!hospital) {
      notify("当前账号没有该医院的访问权限");
      return;
    }
    setActiveHospital(hospitalId);
    setDepartmentPreference("全部科室");
    setSelectedDeviceId(initialDevices[0].id);
    setHeaderPanel(null);
    setView("cockpit");
    notify(`已进入${hospital.name}`);
  }

  function resetDemo() {
    setDeviceStoreLocal(initialDeviceStore());
    setModulesLocal(initialModules);
    setThemeLocal("clinical");
    setDensityLocal("comfortable");
    setCostEntryStoreLocal(initialCostEntryStore());
    setImprovementStoreLocal(initialImprovementStore());
    setSourceStoreLocal(initialSourceStore());
    setAnalysisProfileStoreLocal(initialAnalysisProfileStore());
    setHospitalsLocal(initialHospitals);
    setActiveHospitalIdLocal(initialHospitals[0].id);
    setPerspective("管理层");
    setSelectedDeviceId(initialDevices[0].id);
    notify("已恢复全部演示数据和默认布局");
  }





  function openAccount(tab: AccountTab) {
    setAccountTab(tab);
    navigate("account");
  }

  function openDeviceEditor(device?: Device) {
    const next = device
      ? { ...device, cost: { ...device.cost } }
      : {
          id: `device-${Date.now()}`,
          // 医院配置里填了简码就自动编号（简码 + 7 位顺序号），留空则由用户手工填。
          assetCode: nextAssetCode(activeHospital?.assetCodePrefix ?? "", ledgerDevices.map((item) => item.assetCode)),
          name: "",
          shortName: "",
          model: "",
          category: "",
          manufacturer: "",
          serialNumber: "",
          department: "",
          owningDepartment: "",
          usingDepartments: [],
          roomNumber: "",
          dataSource: "手动填写",
          customFields: {},
          location: "",
          enabledDate: "2026-07-22",
          fundingSource: "",
          usefulLifeYears: 8,
          depreciationMethod: "平均年限法",
          licenseNumber: "",
          maintenanceStatus: "",
          monitoringStatus: "",
          investment: 0,
          quantity: 1,
          serviceVolume: 0,
          serviceUnit: "人次",
          revenue: 0,
          utilization: 0,
          planPayback: 0,
          forecastPayback: 0,
          status: "需要关注" as DeviceStatus,
          cost: { labor: 0, consumables: 0, depreciation: 0, maintenance: 0, energy: 0, space: 0, indirect: 0 },
        };
    setEditingDevice(device ?? null);
    setDeviceDraft(next);
    setEditorOpen(true);
  }

  function saveDevice(event: FormEvent) {
    event.preventDefault();
    if (!deviceDraft.name.trim() || !usingDepartmentList(deviceDraft).length) {
      notify("请填写设备名称和至少一个使用科室", "error");
      return;
    }
    if (!deviceDraft.assetCode.trim()) {
      notify("请填写资产编号；在「医院与权限」里配好资产编号简码后可自动生成", "error");
      return;
    }
    const duplicated = ledgerDevices.some((device) => device.id !== deviceDraft.id && device.assetCode.trim() === deviceDraft.assetCode.trim());
    if (duplicated) {
      notify("资产编号已存在，请换一个", "error");
      return;
    }
    const customError = validateCustomFieldValues(currentLedgerFields, deviceDraft.customFields);
    if (customError) {
      notify(customError, "error");
      return;
    }
    // 录入时允许留空行（方便连续添加），落库前清理掉。
    const cleanedDepartments = usingDepartmentList(deviceDraft);
    const cleaned: Device = { ...deviceDraft, usingDepartments: cleanedDepartments, department: cleanedDepartments[0] ?? deviceDraft.department };
    setDevices((current) =>
      editingDevice ? current.map((device) => (device.id === cleaned.id ? cleaned : device)) : [...current, cleaned],
    );
    setEditorOpen(false);
    notify(editingDevice ? "设备信息已更新，驾驶舱同步刷新" : "设备已加入台账和驾驶舱");
  }

  /**
   * 业务量三项（检查人次 / 阳性数 / 总收入）只认数据准备中心发布的 device_workload 行。
   *
   * 用 Map 预先按「设备|期间」建索引：填报页每渲染一行都要查一次，
   * 24 台设备 × 逐格查一遍全量 rows 会在几千行时明显卡顿。
   * 查不到返回 undefined，界面据此显示「—」——绝不回退成 0，
   * 「这一格没上传」和「这一格真的是 0」是两回事。
   */
  const workloadIndex = useMemo(() => {
    const index = new Map<string, DeviceReportWorkload>();
    for (const row of publishedData.rows) {
      if (row.recordType !== "exam") continue;
      const deviceId = typeof row.deviceId === "string" ? row.deviceId : "";
      const period = typeof row.period === "string" ? row.period : "";
      // 只有带 period 的业务量行才有意义：逐次检查明细没有期间，聚合不到填报周期上
      if (!deviceId || !period) continue;
      const asText = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
      const examVolume = asText(row.examVolume);
      const positiveCount = asText(row.positiveCount);
      const totalRevenue = asText(row.totalRevenue);
      if (!examVolume && !positiveCount && !totalRevenue) continue;
      index.set(`${deviceId}|${period}`, {
        examVolume: examVolume || undefined,
        positiveCount: positiveCount || undefined,
        totalRevenue: totalRevenue || undefined,
      });
    }
    return index;
  }, [publishedData.rows]);

  // 演示模式没有发布数据，用与演示台账同源的一份兜底；正式模式一律只认已发布行，
  // 查不到就是查不到，界面显示「—」，绝不拿演示数编进正式口径。
  const demoWorkloadIndex = useMemo(
    () => (demoMode ? cloneDeviceWorkloadForHospital(effectiveHospitalId) : null),
    [demoMode, effectiveHospitalId],
  );

  const workloadOf = (deviceId: string, periodKey: string) =>
    workloadIndex.get(`${deviceId}|${periodKey}`) ?? demoWorkloadIndex?.get(`${deviceId}|${periodKey}`);

  /**
   * 字典驾驶舱的算数上下文：设备与填报记录都取当前医院的，期间默认取本年 12 个月，
   * 这样看板上的「科室相加 / 时间相加」和填报页看到的是同一批数
   */
  /**
   * 驾驶舱页顶部的「使用科室」筛选要真正驱动字典看板。
   * 选了具体科室就按该科室算，选「全部科室」才回到看板自己配的维度——
   * 否则页面上摆着个筛选器却对下面的图没有任何影响，等于骗人。
   */
  const cockpitBoardConfig = useMemo(() => {
    if (department === "全部科室") return currentMetricCockpit;
    return { ...currentMetricCockpit, dimension: "department" as const, department };
  }, [currentMetricCockpit, department]);

  const cockpitComputeContext: ChartComputeContext = useMemo(() => ({
    devices: ledgerDevices.map((device) => ({ id: device.id, department: device.department, name: device.name })),
    records: currentDeviceReports,
    onlyConfirmed: currentMetricCockpit.onlyConfirmed,
    periods: listPeriods("month", new Date().getFullYear()),
    fields: currentReportFields,
    workloadOf,
  // workloadOf 是 workloadIndex 的薄封装，跟着索引一起变，不必单列依赖
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ledgerDevices, currentDeviceReports, currentMetricCockpit.onlyConfirmed, currentReportFields, workloadIndex, demoWorkloadIndex]);

  /**
   * 四个分析页（效益分析 / 运营改进 / 资本计划 / 效益报告）共用的诊断结果。
   *
   * 以前这四页各算各的：alert-rules 一套阈值、资本计划一套 riskScore、改进中心一套情景测算，
   * 同一台设备能给出互相矛盾的结论。现在只有这一处判断，四页都从这里取。
   */
  const analysisPeriods = useMemo(() => listPeriods("month", new Date().getFullYear()), []);
  const analysisPeriodLabel = `${new Date().getFullYear()} 年度 · 按月填报（${analysisPeriods.length} 期）`;
  const diagnoses = useMemo(() => buildDiagnoses({
    devices: ledgerDevices,
    records: currentDeviceReports,
    periods: analysisPeriods,
    fields: currentReportFields,
    workloadOf,
    onlyConfirmed: analysisOnlyConfirmed,
  }),
  // workloadOf 是两个索引的薄封装，跟着它们一起变
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [ledgerDevices, currentDeviceReports, analysisPeriods, currentReportFields, analysisOnlyConfirmed, workloadIndex, demoWorkloadIndex]);

  /** 分析页 →（改进 / 资本 / 填报）的三条去向，集中在这里，页面只管调用 */
  function routeFindingToImprovement(deviceId: string, finding: Finding) {
    setPendingFinding({ deviceId, finding });
    navigate("improvement");
  }
  function routeDeviceToCapital(deviceId: string) {
    setCapitalFocusDeviceId(deviceId);
    navigate("capital");
  }
  function routeDeviceToReporting(deviceId: string) {
    setReportFocusDeviceId(deviceId);
    navigate("costs");
  }

  function moveModule(id: string, direction: -1 | 1) {
    setModules((current) => {
      const index = current.findIndex((module) => module.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function dropModule(targetId: string) {
    if (!draggingModule || draggingModule === targetId) return;
    setModules((current) => {
      const sourceIndex = current.findIndex((module) => module.id === draggingModule);
      const targetIndex = current.findIndex((module) => module.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDraggingModule(null);
  }

  function stepModuleSize(id: string, direction: -1 | 1) {
    setModules((current) => current.map((module) => {
      if (module.id !== id) return module;
      const nextIndex = Math.min(moduleSizeOrder.length - 1, Math.max(0, moduleSizeOrder.indexOf(module.size) + direction));
      return { ...module, size: moduleSizeOrder[nextIndex] };
    }));
  }

  function stepModuleHeight(id: string, direction: -1 | 1) {
    setModules((current) => current.map((module) => {
      if (module.id !== id) return module;
      const nextIndex = Math.min(moduleHeightOrder.length - 1, Math.max(0, moduleHeightOrder.indexOf(module.height ?? "standard") + direction));
      return { ...module, height: moduleHeightOrder[nextIndex] };
    }));
  }

  function toggleLayoutEditing() {
    if (layoutEditing) {
      setLayoutEditing(false);
      setDraggingModule(null);
      setModules((current) => [...current]);
      notify("驾驶舱布局已保存，并同步到当前医院");
      return;
    }
    setLayoutEditing(true);
    notify("已进入布局编辑：拖动模块调整位置，用模块角标调整宽度和高度");
  }

  const navItems: Array<{ id: View; label: string; icon: React.ReactNode; group: "show" | "manage"; permissions: string[] }> = [
    { id: "cockpit", label: "效益驾驶舱", icon: <LayoutDashboard size={18} />, group: "show", permissions: ["dashboard.view"] },
    { id: "analysis", label: "效益分析", icon: <Activity size={18} />, group: "show", permissions: ["dashboard.view", "source.manage"] },
    { id: "report", label: "效益分析报告", icon: <FileText size={18} />, group: "show", permissions: ["report.manage", "report.review", "report.approve", "report.export"] },
    { id: "improvement", label: "运营改进中心", icon: <Target size={18} />, group: "show", permissions: ["improvement.manage"] },
    { id: "capital", label: "资本计划", icon: <Boxes size={18} />, group: "show", permissions: ["improvement.manage", "report.approve"] },
    { id: "equipment", label: "设备台账", icon: <FileSpreadsheet size={18} />, group: "manage", permissions: ["equipment.manage"] },
    { id: "costs", label: "设备数据填报", icon: <CircleDollarSign size={18} />, group: "manage", permissions: ["cost.manage"] },
    { id: "layout", label: "驾驶舱配置", icon: <SlidersHorizontal size={18} />, group: "manage", permissions: ["member.manage"] },
    { id: "sources", label: "指标字典", icon: <Database size={18} />, group: "manage", permissions: ["source.manage"] },
    ...(dataWorkbenchUnlocked ? [{ id: "workbench" as View, label: "数据准备中心", icon: <Cable size={18} />, group: "manage" as const, permissions: dataWorkbenchPermissions }] : []),
    { id: "access", label: "医院与权限", icon: <ShieldCheck size={18} />, group: "manage", permissions: ["hospital.manage", "member.manage"] },
  ];
  const permittedNavItems = navItems.filter((item) =>
    !item.permissions.length || item.permissions.some(hasPermission));

  function renderModule(module: DashboardModule) {
    if (sessionState === "verified" && module.id === "trend" && !trendData.length) {
      return <EmptyModule text="当前发布文件没有可用的 occurredAt、period 或 statDate 月份事实；正式模式不会按静态月份系数拆分年度值。" />;
    }
    if (module.id === "kpi") {
      const periodLabel = period === "2026年度" ? "年度" : "期间";
      return (
        <div className="metrics-grid">
          <MetricCard label="设备总投资" value={`${currency.format(totals.investment)} 万`} note={`${filteredDevices.length} 台（套）纳入分析`} icon={<Building2 size={21} />} tone="blue" />
          <MetricCard label={`${periodLabel}收入`} value={periodTotals.available ? `${currency.format(periodTotals.revenue)} 万` : "数据缺失"} note={periodTotals.available ? "已发布收费/业务量文件，按来源行去重" : "当前发布文件缺少可用期间字段"} icon={<CircleDollarSign size={21} />} tone="green" />
          <MetricCard label={`${periodLabel}净收益`} value={periodTotals.available ? `${currency.format(periodTotals.net)} 万` : "数据缺失"} note={periodTotals.available ? `${periodLabel}投资收益率 ${totals.investment ? ((periodTotals.net / totals.investment) * 100).toFixed(1) : "0.0"}%` : "未生成期间收入成本结论"} icon={<Activity size={21} />} tone={periodTotals.available && periodTotals.net < 0 ? "red" : "violet"} />
          <MetricCard label="平均使用率" value={`${totals.utilization.toFixed(1)}%`} note={`${totals.alerts} 台设备需要关注`} icon={<Clock3 size={21} />} tone={totals.alerts ? "orange" : "blue"} />
        </div>
      );
    }

    if (module.id === "dimensions") {
      return <DimensionOverview deviceIds={filteredDevices.map((device) => device.id)} publishedData={sessionState === "verified" ? publishedData : undefined} />;
    }

    if (module.id === "quality") {
      return <QualityExperiencePanel deviceIds={filteredDevices.map((device) => device.id)} publishedData={sessionState === "verified" ? publishedData : undefined} />;
    }

    if (module.id === "reliability") {
      return <ReliabilityPanel deviceIds={filteredDevices.map((device) => device.id)} publishedData={sessionState === "verified" ? publishedData : undefined} />;
    }

    if (module.id === "workforce") {
      return <WorkforcePerformancePanel deviceIds={filteredDevices.map((device) => device.id)} publishedData={sessionState === "verified" ? publishedData : undefined} />;
    }

    if (module.id === "category") {
      return <CategoryPerformancePanel devices={filteredDevices} onSelect={openDeviceDetail} />;
    }

    if (module.id === "hospital-compare") {
      // 正式模式下跨院已发布口径尚未接入（当前只拉取所在医院的发布数据），
      // 按“正式页面不用演示值补位”的铁律显示明确空态，绝不把体验数据当作各院真实指标。
      if (sessionState === "verified") {
        return <EmptyModule text="集团对比需要各院已发布口径。当前版本仅接入所在医院的发布数据，正式模式不展示体验值；跨院对比将在多院供数接入后开放。" />;
      }
      return (
        <HospitalComparePanel
          hospitals={accessibleHospitals.map((hospital) => ({
            id: hospital.id,
            name: hospital.name,
            shortName: hospital.shortName,
            level: hospital.level,
            region: hospital.region,
          }))}
          activeHospitalId={effectiveHospitalId}
          onSwitchHospital={switchHospital}
        />
      );
    }

    if (module.id === "trend") {
      return (
        <Panel title="收入与成本趋势" description="按自然月观察经营波动，单位：万元" action={<span className="chart-note">{sessionState === "verified" ? `发布 V${publishedData.publication?.version ?? "—"}` : "模拟数据"}</span>}>
          <div className="chart-area chart-lg">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 12, right: 14, left: -12, bottom: 0 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
                <Line type="monotone" dataKey="收入" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--primary)" }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="成本" stroke="var(--orange)" strokeWidth={2.2} dot={{ r: 3, fill: "var(--orange)" }} />
                <Line type="monotone" dataKey="净收益" stroke="var(--green)" strokeWidth={2} strokeDasharray="5 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      );
    }

    if (module.id === "cost") {
      if (sessionState === "verified" && !periodTotals.available) return <EmptyModule text="当前发布成本文件缺少可用期间字段，无法形成期间成本构成。" />;
      const pieColors = ["var(--primary)", "var(--orange)", "var(--violet)", "var(--green)", "var(--cyan)", "var(--rose)", "var(--slate)"];
      return (
        <Panel title="成本构成" description="按全成本口径归集">
          <div className="cost-layout">
            <div className="chart-area chart-pie">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={costStructure} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                    {costStructure.map((item, index) => <Cell key={item.name} fill={pieColors[index]} />)}
                  </Pie>
                  <Tooltip formatter={(value) => `${currency.format(Number(value))} 万元`} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pie-center"><strong>{currency.format(periodTotals.cost)}</strong><span>期间成本/万</span></div>
            </div>
            <div className="cost-legend">
              {costStructure.slice(0, 5).map((item, index) => (
                <div key={item.name}><i style={{ background: pieColors[index] }} /><span>{item.name}</span><strong>{periodTotals.cost ? ((item.value / periodTotals.cost) * 100).toFixed(0) : 0}%</strong></div>
              ))}
            </div>
          </div>
        </Panel>
      );
    }

    if (module.id === "payback") {
      return (
        <Panel title="计划与预计回本年限" description="预计高于计划时应追溯工作量、收费与成本偏差">
          {paybackData.length ? (
            <div className="chart-area chart-md">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={paybackData} layout="vertical" margin={{ top: 8, right: 26, left: 20, bottom: 0 }}>
                  <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} unit="年" tick={{ fill: "var(--muted)", fontSize: 12 }} />
                  <YAxis dataKey="name" type="category" width={78} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="原计划" fill="var(--primary-soft-strong)" radius={[0, 5, 5, 0]} barSize={9} />
                  <Bar dataKey="最新预计" fill="var(--orange)" radius={[0, 5, 5, 0]} barSize={9} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyModule text="当前筛选下暂无设备" />}
        </Panel>
      );
    }

    if (module.id === "efficiency") {
      return (
        <Panel title="效益效率矩阵" description="横轴使用率，纵轴投资收益率，气泡大小代表投资额">
          {efficiencyData.length ? (
            <div className="chart-area chart-md">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 12, right: 22, left: -6, bottom: 2 }}>
                  <CartesianGrid stroke="var(--chart-grid)" />
                  <XAxis type="number" dataKey="x" name="使用率" unit="%" domain={[30, 100]} tick={{ fill: "var(--muted)", fontSize: 12 }} />
                  <YAxis type="number" dataKey="y" name="投资收益率" unit="%" tick={{ fill: "var(--muted)", fontSize: 12 }} />
                  <ZAxis type="number" dataKey="z" range={[80, 420]} />
                  <ReferenceLine x={70} stroke="var(--orange)" strokeDasharray="4 4" />
                  <ReferenceLine y={20} stroke="var(--orange)" strokeDasharray="4 4" />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }} />
                  <Scatter name="设备" data={efficiencyData} fill="var(--primary)" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyModule text="当前筛选下暂无设备" />}
        </Panel>
      );
    }

    if (module.id === "alerts") {
      return (
        <Panel title="管理预警" description="按影响程度排序" action={<span className="count-badge">{riskDevices.length}</span>}>
          <div className="alert-list">
            {riskDevices.length ? riskDevices.slice(0, 4).map((device) => (
              <button className="alert-item" key={device.id} onClick={() => openDeviceDetail(device)}>
                <span className={`alert-symbol ${statusTone(device.status)}`}><AlertTriangle size={16} /></span>
                <span><strong>{device.shortName}</strong><small>{device.utilization < 60 ? `使用率仅 ${device.utilization}%` : `预计回本延后 ${(device.forecastPayback - device.planPayback).toFixed(1)} 年`}</small></span>
                <ChevronDown size={15} className="alert-arrow" />
              </button>
            )) : <div className="all-clear"><CheckCircle2 size={24} /><strong>暂无异常设备</strong><span>当前筛选范围运行正常</span></div>}
          </div>
        </Panel>
      );
    }

    if (module.id === "table") {
      return (
        <Panel title="设备效益明细" description="单机口径 · 收入、成本、净收益单位：万元" action={hasPermission("equipment.manage") ? <button className="text-button" onClick={() => navigate("equipment")}>管理设备</button> : <span className="chart-note">只读视图</span>}>
          <div className="table-scroll">
            <table className="data-table dashboard-table">
              <thead><tr><th>设备</th><th>科室</th><th className="num">服务量</th><th className="num">使用率</th><th className="num">收入</th><th className="num">总成本</th><th className="num">净收益</th><th className="num">投资收益率</th><th className="num">计划/预计回本</th><th>状态</th><th className="action-col">详情</th></tr></thead>
              <tbody>
                {filteredDevices.map((device) => (
                  <tr key={device.id}>
                    <td><button className="device-link" onClick={() => openDeviceDetail(device)}><strong>{device.shortName}</strong><span>{device.model}</span></button></td>
                    <td>{device.department}</td>
                    <td className="num">{currency.format(device.serviceVolume)} <small>{device.serviceUnit}</small></td>
                    <td className="num">{device.utilization}%</td>
                    <td className="num">{currency.format(device.revenue)}</td>
                    <td className="num">{currency.format(totalCost(device))}</td>
                    <td className={`num ${netBenefit(device) < 0 ? "negative" : "positive"}`}>{currency.format(netBenefit(device))}</td>
                    <td className={`num ${roi(device) < 0 ? "negative" : ""}`}>{roi(device).toFixed(1)}%</td>
                    <td className="num">{device.planPayback.toFixed(1)} / {device.forecastPayback.toFixed(1)} 年</td>
                    <td><span className={`status-pill ${statusTone(device.status)}`}>{device.status}</span></td>
                    <td className="action-col"><button className="icon-button" aria-label={`查看${device.name}详情`} onClick={() => openDeviceDetail(device)}><Eye size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      );
    }

    return null;
  }

  const pageTitle = {
    cockpit: "大型医疗设备效益驾驶舱",
    analysis: "效益分析",
    report: "效益分析报告",
    improvement: "运营改进中心",
    capital: "3—5 年资本计划",
    workbench: "数据准备中心",
    equipment: "设备台账",
    "ledger-fields": "台账字段配置",
    detail: selectedDevice ? `${selectedDevice.shortName}单机分析` : "单机设备分析",
    costs: "设备数据填报",
    "report-fields": "填报字段配置",
    layout: "驾驶舱配置",
    sources: "指标字典",
    "metric-dictionary": "指标字典配置",
    access: "医院与权限管理",
    account: "个人中心",
  }[view];

  if (!viewer.authenticated && !demoEntered) {
    return <LoginScreen onEnterDemo={() => setDemoEntered(true)} onPasswordLogin={passwordLogin} />;
  }

  if (viewer.authenticated && applicationSessionState === "checking") {
    return <main className="access-loading-page"><div className="access-loading-card"><span><LoaderCircle className="spin" size={30} /></span><p>正在检查系统会话</p><h1>请稍候</h1><small>应用会话确认完成前不会加载医院业务数据。</small></div></main>;
  }

  if (viewer.authenticated && ["required", "locked", "error"].includes(applicationSessionState)) {
    return (
      <LoginScreen
        viewer={viewer}
        mode={applicationSessionState === "locked" ? "locked" : "session-required"}
        unlockWithPassword={passwordAuthenticated && applicationSessionState === "locked"}
        busy={applicationSessionBusy}
        error={applicationSessionError}
        onContinue={continueApplicationSession}
        onSwitchAccount={switchUnifiedIdentity}
      />
    );
  }

  if (viewer.authenticated && sessionState === "loading") {
    return <main className="access-loading-page"><div className="access-loading-card"><span><ShieldCheck size={30} /></span><p>正在核验医院成员关系</p><h1>请稍候</h1><small>权限确认完成前不会加载医院业务数据或管理入口。</small></div></main>;
  }

  if (sessionState === "denied") {
    return (
      <main className="access-denied-page">
        <div className="access-denied-card">
          <span><ShieldCheck size={30} /></span>
          <p>访问已被安全策略拒绝</p>
          <h1>账号尚未配置医院权限</h1>
          <strong>{viewer.email}</strong>
          <small>请联系平台管理员，将该账号加入指定医院并分配医院内角色。仅完成站点分享、但没有医院成员关系时，仍然不能访问业务数据。</small>
          <div className="access-boundary-actions"><button className="secondary-button" onClick={() => { setSessionState("loading"); setTenantRetryKey((current) => current + 1); }}>重新核验</button><button className="danger-button" onClick={() => void changeApplicationSession("revoke").catch(() => undefined).finally(() => { if (passwordAuthenticated) window.location.reload(); else window.location.assign("/signout-with-chatgpt?return_to=%2F"); })}>退出并切换账号</button></div>
        </div>
      </main>
    );
  }

  if (sessionState === "error") {
    return (
      <main className="access-loading-page">
        <div className="access-loading-card cloud-load-error">
          <span><CloudOff size={30} /></span>
          <p>医院权限服务暂时不可用</p>
          <h1>尚未加载任何业务数据</h1>
          <small>这不是权限拒绝。请检查网络后重新核验；系统不会因此回退到演示身份。</small>
          <div className="access-boundary-actions"><button className="primary-button" onClick={() => { setSessionState("loading"); setTenantRetryKey((current) => current + 1); }}>重新核验</button><button className="secondary-button" onClick={() => void changeApplicationSession("lock").catch(() => notify("暂时无法锁定，请稍后重试"))}>返回系统登录页</button></div>
        </div>
      </main>
    );
  }

  if (viewer.authenticated && sessionState === "verified" && !cloudHydrated) {
    return (
      <main className="access-loading-page">
        <div className={`access-loading-card ${cloudSyncState === "error" ? "cloud-load-error" : ""}`}>
          <span>{cloudSyncState === "error" ? <CloudOff size={30} /> : <LoaderCircle className="spin" size={30} />}</span>
          <p>{cloudSyncState === "error" ? "云端工作区加载失败" : "正在加载医院云数据"}</p>
          <h1>{cloudSyncState === "error" ? "暂时不能进入业务页面" : "正在同步跨设备数据"}</h1>
          <small>{cloudError || "设备台账、成本、消息、改进任务和驾驶舱配置加载完成后才会开放。"}</small>
          {cloudSyncState === "error" ? <button className="primary-button" onClick={() => setCloudRetryKey((current) => current + 1)}>重新加载</button> : null}
        </div>
      </main>
    );
  }

  if (view === "workbench" && canOpenDataWorkbench && dataWorkbenchUnlocked) {
    return (
      <DataWorkbench
        hospitalId={effectiveHospitalId}
        hospitalName={activeHospital?.name ?? "当前医院"}
        permissions={[...activePermissions]}
        demoMode={demoMode}
        isPlatformAdmin={isPlatformAdmin}
        onNotify={notify}
        onExit={() => setView("sources")}
      />
    );
  }

  return (
    <div className={`platform theme-${theme} density-${density}${projectionMode ? " projection-mode" : ""}`}>
      <aside className={`sidebar ${mobileNavOpen ? "mobile-open" : ""}`}>
        <div className="brand" role="button" tabIndex={0} aria-label="勇虹医疗品牌区" onClick={(event) => brandClick(event.timeStamp)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") brandClick(event.timeStamp); }}>
          {/* The supplied wordmark is already optimized and must retain its exact transparent canvas. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/yonghong-logo.png" alt="勇虹医疗 YHONG" />
          <div><strong>勇虹医疗</strong><span>{dataWorkbenchUnlocked ? "数据准备模式已解锁" : "设备效益管理平台"}</span></div>
          {/* 阻止冒泡：移动端关闭导航不应计入品牌区连击，否则误触会弹出入口口令框。 */}
          <button
            className="icon-button sidebar-close"
            aria-label="关闭导航"
            onClick={(event) => { event.stopPropagation(); setMobileNavOpen(false); }}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
          ><X size={19} /></button>
        </div>
        <nav>
          <p className="nav-label">分析展示</p>
          {permittedNavItems.filter((item) => item.group === "show").map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)}>{item.icon}<span>{item.label}</span></button>
          ))}
          <p className="nav-label">管理后台</p>
          {permittedNavItems.filter((item) => item.group === "manage").map((item) => (
            <button key={item.id} className={view === item.id || (view === "detail" && item.id === "equipment") ? "active" : ""} onClick={() => navigate(item.id)}>{item.icon}<span>{item.label}</span>{item.id === "costs" ? <i className="nav-dot" /> : null}</button>
          ))}
        </nav>
        <div className="sidebar-foot">
          {accessibleHospitals.length > 1 ? (
            <label className="sidebar-hospital-switcher">
              <Building2 size={15} />
              <span>当前医院</span>
              <select value={effectiveHospitalId} onChange={(event) => switchHospital(event.target.value)} aria-label="移动端当前医院">
                {accessibleHospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.shortName}</option>)}
              </select>
            </label>
          ) : null}
          <div className="data-health"><span><i />{activeHospital?.shortName ?? "医院未配置"}</span>{sessionState === "demo" ? <small>演示租户上下文</small> : null}</div>
          {sessionState === "demo"
            ? <button onClick={() => setResetConfirmOpen(true)}><RotateCcw size={16} />恢复演示数据</button>
            : null}
        </div>
      </aside>

      {mobileNavOpen ? <button className="mobile-mask" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} /> : null}

      <main className="main-shell">
        <header className="topbar">
          <button className="icon-button menu-button" aria-label="打开导航" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>大型设备效益分析</span><b>/</b><strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            <label className="hospital-switcher" title="切换当前医院">
              <Building2 size={16} />
              <select value={effectiveHospitalId} onChange={(event) => switchHospital(event.target.value)} aria-label="当前医院">
                {accessibleHospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.shortName}</option>)}
              </select>
            </label>
            <div className="zoom-controls" aria-label="页面显示比例">
              <button
                type="button"
                aria-label="缩小页面"
                title="缩小页面"
                disabled={contentZoomIndex === 0}
                onClick={() => setContentZoom(contentZoomLevels[Math.max(0, contentZoomIndex - 1)])}
              ><ZoomOut size={16} /></button>
              <button type="button" className="zoom-value" title="恢复为 100%" onClick={() => setContentZoom(1)}>{Math.round(safeContentZoom * 100)}%</button>
              <button
                type="button"
                aria-label="放大页面"
                title="放大页面"
                disabled={contentZoomIndex === contentZoomLevels.length - 1}
                onClick={() => setContentZoom(contentZoomLevels[Math.min(contentZoomLevels.length - 1, contentZoomIndex + 1)])}
              ><ZoomIn size={16} /></button>
            </div>
            <button className="account-trigger" aria-label="打开账号菜单" aria-haspopup="menu" aria-expanded={headerPanel === "account"} onClick={() => setHeaderPanel((current) => current === "account" ? null : "account")}><span className="avatar">{viewer.displayName.slice(0, 1)}</span><span className="user"><strong>{viewer.displayName}</strong><span>{currentRoleName}</span></span><ChevronDown size={14} /></button>
            {headerPanel === "account" ? (
              <div className="header-popover account-popover" role="menu">
                <header><span className="avatar large">{viewer.displayName.slice(0, 1)}</span><div><strong>{viewer.displayName}</strong><small>{viewer.email}</small><em>{activeHospital.shortName} · {currentRoleName}</em></div></header>
                <div className="account-menu-list"><button role="menuitem" onClick={() => openAccount("profile")}><UserRound size={16} /><span><strong>个人中心</strong><small>身份与医院成员关系</small></span><ChevronRight size={15} /></button><button role="menuitem" onClick={() => openAccount("security")}><ShieldCheck size={16} /><span><strong>登录与安全</strong><small>会话、权限与退出登录</small></span><ChevronRight size={15} /></button>{hasPermission("member.manage") || hasPermission("hospital.manage") ? <button role="menuitem" onClick={() => navigate("access")}><Building2 size={16} /><span><strong>医院与权限</strong><small>成员、角色与安全审计</small></span><ChevronRight size={15} /></button> : null}</div>
                <footer>{viewer.authenticated ? <button onClick={() => { setHeaderPanel(null); setExitConfirmMode("lock"); }}><LockKeyhole size={16} />锁定并返回系统登录页</button> : <button onClick={() => { setDemoEntered(false); setHeaderPanel(null); }}><LogOut size={16} />退出演示环境</button>}</footer>
              </div>
            ) : null}
          </div>
        </header>

        {headerPanel ? <button className="header-popover-mask" aria-label="关闭顶部菜单" onClick={() => setHeaderPanel(null)} /> : null}

        {cloudConflict ? (
          <section className="cloud-conflict-banner" role="alert" aria-label="云端版本冲突">
            <span className="cloud-conflict-icon"><AlertTriangle size={20} /></span>
            <div>
              <strong>另一台设备已经更新“{cloudResourceLabels[cloudConflict.resource]}”</strong>
              <p>
                本机基于版本 {cloudConflict.expectedRevision} 编辑，云端现为版本 {cloudConflict.currentRevision}。
                本机 {cloudConflict.localValue.length} 条、云端 {cloudConflict.currentValue.length} 条；系统没有自动覆盖任何一方。
              </p>
            </div>
            <div className="cloud-conflict-actions">
              <button className="secondary-button" type="button" disabled={Boolean(cloudConflictAction)} onClick={downloadLocalConflictCopy}>
                <Download size={15} />下载本机副本
              </button>
              <button className="secondary-button" type="button" disabled={Boolean(cloudConflictAction)} onClick={useServerConflictVersion}>
                {cloudConflictAction === "server" ? <LoaderCircle className="spin" size={15} /> : <Cloud size={15} />}采用云端版本
              </button>
              <button className="primary-button" type="button" disabled={Boolean(cloudConflictAction)} onClick={() => void keepLocalConflictVersion()}>
                {cloudConflictAction === "local" ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保留并上传本机版本
              </button>
            </div>
          </section>
        ) : null}

        <div className="content" style={contentZoomStyle}>
          {view === "cockpit" ? (
            <>
              <div className="page-heading cockpit-heading">
                <div>
                  <div className="eyebrow"><Sparkles size={15} />综合运营视图</div>
                  <h1>大型医疗设备效益驾驶舱</h1>
                  <p>统一观察经济效益、使用效率、临床质量、患者体验和设备保障，并按角色呈现管理重点。</p>
                </div>
                <div className="heading-actions">
                  <div className="cockpit-kind-switch" role="tablist" aria-label="驾驶舱看板">
                    <button role="tab" aria-selected={cockpitKind === "industry"} className={cockpitKind === "industry" ? "active" : ""} onClick={() => setCockpitKind("industry")}>
                      <LayoutDashboard size={15} />行业看板
                    </button>
                    <button role="tab" aria-selected={cockpitKind === "dictionary"} className={cockpitKind === "dictionary" ? "active" : ""} onClick={() => setCockpitKind("dictionary")}>
                      <BookOpen size={15} />指标字典看板
                    </button>
                  </div>
                  <button className="secondary-button" onClick={enterProjectionMode}><MonitorPlay size={17} />投屏模式</button>
                  {hasPermission("member.manage") && (sessionState !== "verified" || publishedData.publication) && visibleModules.length ? (
                    <button className={layoutEditing ? "primary-button" : "secondary-button"} onClick={toggleLayoutEditing}>
                      {layoutEditing ? <Check size={17} /> : <Pencil size={17} />}
                      {layoutEditing ? "完成布局" : "编辑布局"}
                    </button>
                  ) : null}
                  {hasPermission("member.manage") ? <button className="secondary-button" onClick={() => navigate("layout")}><Settings2 size={17} />配置驾驶舱</button> : null}
                  {hasPermission("report.export") ? <button className="primary-button" onClick={() => navigate("report")}><FileText size={17} />生成效益报告</button> : null}
                </div>
              </div>
              <section className="guide-entry-strip" aria-label="本院数据就绪情况">
                <span className="guide-entry-icon"><Database size={20} /></span>
                <div>
                  <strong>本院数据就绪情况</strong>
                  <p>设备台账、已发布文件事实与品类规则的当前数量。</p>
                </div>
                <div className="guide-entry-readiness">
                  <span><b>{devices.length}</b> 台设备</span>
                  <span><b>{publishedData.publication ? publishedData.rows.length : 0}</b> 已发布文件事实</span>
                  <span><b>{currentAnalysisProfiles.filter((item) => item.status === "已启用").length}/{currentAnalysisProfiles.length}</b> 品类规则已启用</span>
                </div>
              </section>
              {sessionState === "verified" ? <section className={`guide-entry-strip ${publishedData.publication ? "" : "warning"}`} aria-label="正式发布数据状态">
                <span className="guide-entry-icon">{publishedLoading ? <LoaderCircle className="spin" size={20} /> : publishedData.publication ? <ShieldCheck size={20} /> : <Database size={20} />}</span>
                <div><strong>{publishedLoading ? "正在读取正式发布数据" : publishedData.publication ? `当前使用发布版本 V${publishedData.publication.version}` : "本院暂无可用 Published 数据"}</strong><p>{publishedData.publication ? `Snapshot ${publishedData.publication.snapshotId} · SHA-256 ${publishedData.publication.snapshotSha256.slice(0, 12)}… · ${publishedData.publication.rowCount} 行；更正或回滚后将自动切换。` : publishedError ? "发布数据读取失败，正式页面保持空态，不使用演示值。" : "请在数据准备中心完成质量门禁、审核和发布；正式页面不会使用演示设备补位。"}</p></div>
              </section> : null}
              <div className="filter-bar">
                <label><Building2 size={16} /><span>使用科室</span><select value={department} onChange={(event) => setDepartmentPreference(event.target.value)}>{departmentOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                <label><Clock3 size={16} /><span>分析期间</span><select value={period} onChange={(event) => setPeriodPreference(event.target.value)}>{Object.keys(periodMonthIndexes).map((option) => <option key={option}>{option}</option>)}</select></label>
                <label><Users size={16} /><span>角色视角</span><select value={perspective} onChange={(event) => setPerspectivePreference(event.target.value as Perspective)}><option>管理层</option><option>设备科</option><option>临床科室</option></select></label>
                <div className="filter-status"><i />{publishedSupplyStatus}</div>
              </div>
              {sessionState !== "verified" || publishedData.publication ? <section className="role-summary" aria-label={`${perspective}重点指标`}>
                <div className="role-summary-title"><span>{perspective}</span><small>{perspective === "管理层" ? "看价值与资源配置" : perspective === "设备科" ? "看流程与设备保障" : "看服务效率与设备可用"}</small></div>
                {perspectiveItems[perspective].map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></div>)}
              </section> : null}
              {cockpitKind === "dictionary" ? (
                <section className="panel cockpit-dictionary-panel" aria-label="指标字典看板">
                  <div className="panel-heading">
                    <div>
                      <h3>指标字典看板</h3>
                      <p>
                        {department === "全部科室" ? "全院口径" : `已按「${department}」筛选`}
                        {" · "}
                        {currentMetricCockpit.onlyConfirmed ? "只统计已确认的填报数据" : "含填报中与已提交的草稿"}
                        {" · "}共 {currentMetricCockpit.items.length} 张卡片
                      </p>
                    </div>
                    {hasPermission("member.manage") ? (
                      <button className="secondary-button compact-action" onClick={() => navigate("layout")}><Settings2 size={15} />配置看板</button>
                    ) : null}
                  </div>
                  <MetricCockpitBoard
                    config={cockpitBoardConfig}
                    entries={activeMetrics(currentMetricEntries)}
                    categories={currentMetricCategories}
                    ctx={cockpitComputeContext}
                    templates={currentChartTemplates}
                    rotateMs={projectionMode && !projectionPaused ? 12000 : 0}
                  />
                </section>
              ) : null}
              {cockpitKind === "industry" && (sessionState !== "verified" || publishedData.publication) ? <div className="dashboard-grid">
                {visibleModules.map((module) => (
                  <div
                    className={`module module-${module.size} module-h-${module.height ?? "standard"}${layoutEditing ? " module-editing" : ""}${layoutEditing && draggingModule === module.id ? " dragging" : ""}`}
                    key={module.id}
                    draggable={layoutEditing}
                    onDragStart={layoutEditing ? () => setDraggingModule(module.id) : undefined}
                    onDragEnd={layoutEditing ? () => setDraggingModule(null) : undefined}
                    onDragOver={layoutEditing ? (event) => event.preventDefault() : undefined}
                    onDrop={layoutEditing ? () => dropModule(module.id) : undefined}
                  >
                    {layoutEditing ? (
                      <div className="module-layout-controls">
                        <span className="module-drag-chip" title="按住拖动，放到目标模块上调整顺序"><GripVertical size={14} />{module.name}</span>
                        <span className="module-control-group" role="group" aria-label={`${module.name}宽度`}>
                          <button type="button" aria-label="减小宽度" disabled={module.size === moduleSizeOrder[0]} onClick={() => stepModuleSize(module.id, -1)}><Minus size={13} /></button>
                          <b>宽 {sizeLabels[module.size]}</b>
                          <button type="button" aria-label="增加宽度" disabled={module.size === moduleSizeOrder[moduleSizeOrder.length - 1]} onClick={() => stepModuleSize(module.id, 1)}><Plus size={13} /></button>
                        </span>
                        <span className="module-control-group" role="group" aria-label={`${module.name}高度`}>
                          <button type="button" aria-label="降低高度" disabled={(module.height ?? "standard") === moduleHeightOrder[0]} onClick={() => stepModuleHeight(module.id, -1)}><Minus size={13} /></button>
                          <b>高 {heightLabels[module.height ?? "standard"]}</b>
                          <button type="button" aria-label="增加高度" disabled={(module.height ?? "standard") === moduleHeightOrder[moduleHeightOrder.length - 1]} onClick={() => stepModuleHeight(module.id, 1)}><Plus size={13} /></button>
                        </span>
                      </div>
                    ) : null}
                    {renderModule(module)}
                  </div>
                ))}
              </div> : cockpitKind === "industry" ? <div className="empty-dashboard"><Database size={30} /><h3>暂无已发布数据</h3><p>正式模式保持空态；完成文件映射、清洗、复核与发布后自动刷新。</p>{canOpenDataWorkbench && dataWorkbenchUnlocked ? <button className="primary-button" onClick={() => navigate("workbench")}>打开数据准备中心</button> : null}</div> : null}
              {cockpitKind === "industry" && configuredPublishedCanvases.length ? <div className="dashboard-grid">{configuredPublishedCanvases.map((item) => <div className="module module-medium" key={item.visualization.code}><ConfigurableAnalyticsCanvas metric={item.metric} visualization={item.visualization} data={[...item.data]} metricDefinitionVersion={item.metric.version ?? 1} visualizationVersion={item.visualization.version} /></div>)}</div> : null}
              {cockpitKind === "industry" && !visibleModules.length ? <div className="empty-dashboard"><EyeOff size={30} /><h3>驾驶舱暂未启用模块</h3><button className="primary-button" onClick={() => navigate("layout")}>立即配置</button></div> : null}
            </>
          ) : null}

          {view === "report" ? (
            <BenefitReportCenter
              key={activeHospital.id}
              devices={devices}
              dataSources={currentDataSources}
              analysisProfiles={currentAnalysisProfiles}
              hospital={activeHospital}
              period={period}
              onPeriodChange={setPeriodPreference}
              canManage={hasPermission("report.manage")}
              canReview={hasPermission("report.review")}
              canApprove={hasPermission("report.approve")}
              canExport={hasPermission("report.export")}
              serverPersistence={sessionState === "verified"}
              viewerName={viewer.displayName}
              onOpenEquipment={hasPermission("equipment.manage") ? () => navigate("equipment") : undefined}
              onOpenSources={hasPermission("source.manage") ? () => navigate("sources") : undefined}
              notify={notify}
              publishedData={sessionState === "verified" ? publishedData : undefined}
            />
          ) : null}

          {view === "analysis" ? (
            <div className="analysis-tabs" role="tablist" aria-label="效益分析页签">
              <button role="tab" aria-selected={analysisTab === "overview"} className={analysisTab === "overview" ? "active" : ""} onClick={() => setAnalysisTab("overview")}><Activity size={16} />效益总览</button>
              <button role="tab" aria-selected={analysisTab === "monitor"} className={analysisTab === "monitor" ? "active" : ""} onClick={() => setAnalysisTab("monitor")}><Gauge size={16} />全面监测</button>
              <button role="tab" aria-selected={analysisTab === "custom"} className={analysisTab === "custom" ? "active" : ""} onClick={() => setAnalysisTab("custom")}><BarChart3 size={16} />自定义视图</button>
            </div>
          ) : null}

          {view === "analysis" && analysisTab === "overview" ? (
            <BenefitAnalysisCenter
              diagnoses={diagnoses}
              periodLabel={analysisPeriodLabel}
              onlyConfirmed={analysisOnlyConfirmed}
              onOnlyConfirmedChange={setAnalysisOnlyConfirmed}
              onOpenDevice={openDeviceDetailById}
              onCreateAction={routeFindingToImprovement}
              onSendToCapital={routeDeviceToCapital}
              onOpenReporting={routeDeviceToReporting}
              canManage={hasPermission("improvement.manage")}
              notify={notify}
            />
          ) : null}


          {view === "analysis" && analysisTab !== "overview" ? (
            <BenefitAnalysisStudio
              profiles={currentAnalysisProfiles}
              setProfiles={setCurrentAnalysisProfiles}
              devices={devices}
              canManage={hasPermission("source.manage")}
              notify={notify}
              tab={analysisTab}
              onTabChange={setAnalysisTab}
            />
          ) : null}

          {view === "equipment" ? (
            <EquipmentManagement
              devices={ledgerDevices}
              ledgerFields={currentLedgerFields}
              onConfigureFields={() => navigate("ledger-fields")}
              canConfigureFields={hasPermission("equipment.manage")}
              search={equipmentSearch}
              setSearch={setEquipmentSearch}
              status={equipmentStatus}
              setStatus={setEquipmentStatus}
              onEdit={openDeviceEditor}
              onOpenReport={(device) => { setReportFocusDeviceId(device.id); navigate("costs"); }}
              onAdd={() => openDeviceEditor()}
            />
          ) : null}

          {view === "ledger-fields" ? (
            <LedgerFieldSettings
              fields={currentLedgerFields}
              onChange={setCurrentLedgerFields}
              canManage={hasPermission("equipment.manage")}
              notify={notify}
              onBack={() => navigate("equipment")}
            />
          ) : null}

          {view === "metric-dictionary" ? (
            <MetricDictionarySettings
              entries={currentMetricEntries}
              categories={currentMetricCategories}
              onEntriesChange={setCurrentMetricEntries}
              onCategoriesChange={setCurrentMetricCategories}
              canManage={hasPermission("source.manage")}
              notify={notify}
              onBack={() => navigate("sources")}
            />
          ) : null}

          {view === "improvement" ? (
            <ImprovementCenter
              diagnoses={diagnoses}
              actions={improvementActions}
              setActions={setImprovementActions}
              periodLabel={analysisPeriodLabel}
              onSelectDevice={openDeviceDetailById}
              onSendToCapital={routeDeviceToCapital}
              notify={notify}
              canManage={hasPermission("improvement.manage")}
              pendingFinding={pendingFinding ?? undefined}
              onPendingFindingConsumed={() => setPendingFinding(null)}
            />
          ) : null}

          {view === "capital" ? (
            <CapitalPlanningCenter
              diagnoses={diagnoses}
              periodLabel={analysisPeriodLabel}
              onSelectDevice={openDeviceDetailById}
              focusDeviceId={capitalFocusDeviceId || undefined}
              onFocusConsumed={() => setCapitalFocusDeviceId("")}
              canManage={hasPermission("improvement.manage")}
              notify={notify}
            />
          ) : null}

          {view === "detail" && selectedDevice ? (
            <SingleEquipmentDetail
              device={selectedDevice}
              devices={devices}
              onSelect={(device) => setSelectedDeviceId(device.id)}
              onBack={() => navigate(hasPermission("equipment.manage") ? "equipment" : "cockpit")}
              onEdit={openDeviceEditor}
              canEdit={hasPermission("equipment.manage")}
              publishedData={sessionState === "verified" ? publishedData : undefined}
              hospitalId={activeHospitalId}
            />
          ) : null}

          {view === "costs" ? (
            <DeviceReportCenter
              devices={ledgerDevices}
              fields={currentReportFields}
              records={currentDeviceReports}
              onRecordsChange={setCurrentDeviceReports}
              workloadOf={workloadOf}
              oldCostEntries={costEntries}
              canManage={hasPermission("cost.manage")}
              notify={notify}
              currentUser={viewer.displayName}
              initialDeviceId={reportFocusDeviceId}
              onConsumedInitialDevice={() => setReportFocusDeviceId("")}
              onOpenFieldSettings={hasPermission("cost.manage") ? () => navigate("report-fields") : undefined}
            />
          ) : null}

          {view === "report-fields" ? (
            <ReportFieldSettings
              fields={currentReportFieldOverrides}
              onChange={setCurrentReportFields}
              canManage={hasPermission("cost.manage")}
              notify={notify}
              onBack={() => navigate("costs")}
            />
          ) : null}

          {view === "layout" ? (
            <div className="cockpit-kind-tabs" role="tablist" aria-label="驾驶舱类别">
              <button role="tab" aria-selected={cockpitKind === "industry"} className={cockpitKind === "industry" ? "active" : ""} onClick={() => setCockpitKind("industry")}>
                <LayoutDashboard size={16} />行业驾驶舱<small>通用效益模块编排</small>
              </button>
              <button role="tab" aria-selected={cockpitKind === "dictionary"} className={cockpitKind === "dictionary" ? "active" : ""} onClick={() => setCockpitKind("dictionary")}>
                <BookOpen size={16} />指标字典驾驶舱<small>按字典 {activeMetrics(currentMetricEntries).length} 条口径成图</small>
              </button>
            </div>
          ) : null}

          {view === "layout" && cockpitKind === "dictionary" ? (
            <MetricCockpitConfig
              config={currentMetricCockpit}
              onConfigChange={setCurrentMetricCockpit}
              templates={currentChartTemplates}
              onTemplatesChange={setCurrentChartTemplates}
              entries={activeMetrics(currentMetricEntries)}
              categories={currentMetricCategories}
              ctx={cockpitComputeContext}
              canManage={hasPermission("member.manage")}
              notify={notify}
            />
          ) : null}

          {view === "layout" && cockpitKind === "industry" ? (
            <LayoutConfiguration
              modules={modules}
              setModules={setModules}
              theme={theme}
              setTheme={setTheme}
              density={density}
              setDensity={setDensity}
              draggingModule={draggingModule}
              setDraggingModule={setDraggingModule}
              moveModule={moveModule}
              dropModule={dropModule}
              openCockpit={() => navigate("cockpit")}
              notify={notify}
            />
          ) : null}

          {view === "sources" ? (
            <DataSourceManagement
              metricEntries={currentMetricEntries}
              metricCategories={currentMetricCategories}
              notify={notify}
              onConfigureMetrics={() => navigate("metric-dictionary")}
              canConfigureMetrics={hasPermission("source.manage")}
            />
          ) : null}

          {view === "access" ? (
            <AccessControlCenter
              viewer={viewer}
              hospitals={hospitals}
              activeHospitalId={effectiveHospitalId}
              tenantContext={tenantContext}
              sessionState={sessionState}
              onSwitchHospital={switchHospital}
              onHospitalsChange={setHospitalsLocal}
              notify={notify}
            />
          ) : null}


          {view === "account" ? (
            <AccountCenter
              viewer={viewer}
              hospitals={accessibleHospitals}
              activeHospital={activeHospital}
              tenantContext={tenantContext}
              sessionState={sessionState}
              currentRoleName={currentRoleName}
              tab={accountTab}
              onTabChange={setAccountTab}
              onSwitchHospital={switchHospital}
              onOpenAccess={() => hasPermission("member.manage") || hasPermission("hospital.manage") ? navigate("access") : notify("当前角色没有医院与权限管理权限")}
              onExitDemo={() => { setDemoEntered(false); setView("cockpit"); }}
              applicationSession={applicationSession ? {
                createdAt: applicationSession.appSession.createdAt,
                lastSeenAt: applicationSession.appSession.lastSeenAt,
                idleExpiresAt: applicationSession.appSession.idleExpiresAt,
                absoluteExpiresAt: applicationSession.appSession.absoluteExpiresAt,
              } : null}
              onLockApplication={() => setExitConfirmMode("lock")}
              onRevokeAllApplicationSessions={() => setExitConfirmMode("all")}
              onSignOutIdentity={() => setExitConfirmMode("identity")}
              notify={notify}
            />
          ) : null}
        </div>
      </main>

      {editorOpen ? (
        <DeviceEditor
          draft={deviceDraft}
          setDraft={setDeviceDraft}
          editing={Boolean(editingDevice)}
          ledgerFields={currentLedgerFields}
          assetCodePrefix={activeHospital?.assetCodePrefix ?? ""}
          onClose={() => setEditorOpen(false)}
          onSave={saveDevice}
        />
      ) : null}

      {workbenchEntryPromptOpen ? (
        <div className="modal-backdrop confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="workbench-entry-title">
          <section className="confirmation-dialog">
            <span className="confirmation-icon"><LockKeyhole size={22} /></span>
            <div>
              <small>受控入口</small>
              <h2 id="workbench-entry-title">进入数据准备中心</h2>
              <p>请输入入口口令。口令通过后仍会在服务端校验医院成员关系与数据准备权限。</p>
              <form
                className="workbench-entry-form"
                onSubmit={(event) => { event.preventDefault(); void submitWorkbenchEntryPassword(); }}
              >
                <input
                  type="password"
                  value={workbenchEntryPassword}
                  onChange={(event) => { setWorkbenchEntryPassword(event.target.value); if (workbenchEntryError) setWorkbenchEntryError(""); }}
                  placeholder="入口口令"
                  aria-label="数据准备中心入口口令"
                  autoComplete="off"
                  maxLength={128}
                  disabled={workbenchEntryBusy}
                  autoFocus
                />
              </form>
              {workbenchEntryError ? <p className="workbench-entry-error" role="alert">{workbenchEntryError}</p> : null}
            </div>
            <footer>
              <button className="secondary-button" disabled={workbenchEntryBusy} onClick={() => { setWorkbenchEntryPromptOpen(false); setWorkbenchEntryPassword(""); setWorkbenchEntryError(""); }}>取消</button>
              <button className="primary-button" disabled={workbenchEntryBusy} onClick={() => void submitWorkbenchEntryPassword()}>{workbenchEntryBusy ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}{workbenchEntryBusy ? "正在核验" : "确认进入"}</button>
            </footer>
          </section>
        </div>
      ) : null}

      {resetConfirmOpen ? (
        <div className="modal-backdrop confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="reset-demo-title">
          <section className="confirmation-dialog">
            <span className="confirmation-icon"><RotateCcw size={22} /></span>
            <div><small>演示环境操作</small><h2 id="reset-demo-title">恢复全部演示数据？</h2><p>设备台账、成本填报、驾驶舱布局、消息状态和医院切换将恢复到初始值。此操作不会影响服务端医院和账号权限。</p></div>
            <footer><button className="secondary-button" onClick={() => setResetConfirmOpen(false)}>取消</button><button className="danger-button" onClick={() => { resetDemo(); setResetConfirmOpen(false); }}>确认恢复</button></footer>
          </section>
        </div>
      ) : null}

      {exitConfirmMode ? (
        <div className="modal-backdrop confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="exit-session-title">
          <section className="confirmation-dialog session-exit-dialog">
            <span className="confirmation-icon">{exitConfirmMode === "lock" ? <LockKeyhole size={22} /> : <LogOut size={22} />}</span>
            <div>
              <small>{exitConfirmMode === "lock" ? "当前浏览器" : exitConfirmMode === "all" ? "全部设备" : "登录身份"}</small>
              <h2 id="exit-session-title">{exitConfirmMode === "lock" ? "锁定并返回系统登录页？" : exitConfirmMode === "all" ? "退出全部平台会话？" : "退出登录并切换账号？"}</h2>
              <p>{exitConfirmMode === "lock"
                ? "本浏览器的平台会话会在服务端锁定，医院云端业务数据立即停止访问；登录身份仍保留。"
                : exitConfirmMode === "all"
                  ? "当前账号在所有设备上的平台应用会话都会撤销。医院成员关系和云端数据不会删除。"
                  : "当前平台会话会先撤销，然后退出当前登录身份并返回登录页；不会删除医院成员关系或云端数据。"}</p>
              <dl className="exit-session-facts"><div><dt>账号</dt><dd>{viewer.email}</dd></div><div><dt>当前医院</dt><dd>{activeHospital.shortName}</dd></div></dl>
            </div>
            <footer>
              <button className="secondary-button" disabled={applicationSessionBusy} onClick={() => setExitConfirmMode(null)}>取消</button>
              <button className={exitConfirmMode === "lock" ? "primary-button" : "danger-button"} disabled={applicationSessionBusy || cloudSyncState === "saving"} onClick={() => void confirmExitAction()}>{applicationSessionBusy ? <LoaderCircle className="spin" size={16} /> : exitConfirmMode === "lock" ? <LockKeyhole size={16} /> : <LogOut size={16} />}{applicationSessionBusy ? "正在处理" : exitConfirmMode === "lock" ? "确认锁定" : exitConfirmMode === "all" ? "退出全部会话" : "退出登录"}</button>
            </footer>
          </section>
        </div>
      ) : null}

      {projectionMode ? (
        <div className="projection-overlay" role="toolbar" aria-label="投屏控制条">
          <span className="projection-title"><MonitorPlay size={16} />{activeHospital?.name ?? "医院"}</span>
          <span className="projection-meta">{period} · 效益驾驶舱投屏</span>
          <div className="projection-actions">
            <button type="button" onClick={() => setProjectionPaused((current) => !current)}>
              {projectionPaused ? <Play size={15} /> : <Pause size={15} />}
              {projectionPaused ? "继续轮播" : "暂停轮播"}
            </button>
            <button type="button" className="projection-exit" onClick={exitProjectionMode}><X size={15} />退出投屏</button>
          </div>
        </div>
      ) : null}

      <div className="toast-live-region" role="status" aria-live="polite">
        {toast ? <div className={`toast ${toast.tone === "error" ? "toast-error" : ""}`}>{toast.tone === "error" ? <CircleAlert size={17} /> : <Check size={17} />}{toast.message}</div> : null}
      </div>
    </div>
  );
}

function EquipmentManagement({
  devices,
  ledgerFields,
  search,
  setSearch,
  status,
  setStatus,
  onEdit,
  onOpenReport,
  onAdd,
  onConfigureFields,
  canConfigureFields,
}: {
  devices: Device[];
  ledgerFields: LedgerFieldDefinition[];
  search: string;
  setSearch: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  onEdit: (device: Device) => void;
  /** 台账是基础资料，点“眼睛”进入这台设备的按期数据填报视图 */
  onOpenReport: (device: Device) => void;
  onAdd: () => void;
  onConfigureFields: () => void;
  canConfigureFields: boolean;
}) {
  // 展开的"使用科室"行：一台设备可挂多个使用科室，表格默认只显示第一个，
  // 点省略号按钮就地展开成逐条列表，避免把表格撑得很宽。
  const [expandedDepartments, setExpandedDepartments] = useState<string | null>(null);
  const columns = tableLedgerFields(ledgerFields);
  const filtered = devices.filter((device) => {
    const departments = usingDepartmentList(device).join("");
    const custom = Object.values(device.customFields ?? {}).join("");
    const matchesSearch = `${device.name}${device.shortName}${device.assetCode}${device.model}${device.department}${device.owningDepartment ?? ""}${departments}${device.roomNumber ?? ""}${custom}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (status === "全部状态" || device.status === status);
  });

  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow"><FileSpreadsheet size={15} />资产主数据</div><h1>设备台账</h1></div>
        <div className="heading-actions">
          {canConfigureFields ? <button className="secondary-button" onClick={onConfigureFields}><SlidersHorizontal size={16} />台账字段配置</button> : null}
          <button className="primary-button" onClick={onAdd}><Plus size={17} />新增设备</button>
        </div>
      </div>
      <div className="admin-stats single">
        <div><span>资产原值</span><strong>{currency.format(devices.reduce((sum, item) => sum + item.investment, 0))}</strong><small>万元</small></div>
      </div>
      <Panel title="设备主数据" description={`共 ${filtered.length} 条结果`}>
        <div className="table-toolbar">
          <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索设备、型号、资产编号、科室或房间号" /></label>
          <select className="select-control" value={status} onChange={(event) => setStatus(event.target.value)}><option>全部状态</option><option>运行良好</option><option>需要关注</option><option>效益预警</option></select>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table className="data-table ledger-table">
              <thead><tr>
                <th>资产编号</th><th>设备名称/型号</th><th>所属科室</th><th>使用科室</th><th>房间号</th><th>启用日期</th><th className="num">原值(万元)</th><th>数据来源</th><th>状态</th>
                {columns.map((field) => <th key={field.key}>{field.label}</th>)}
                <th className="action-col action-wide">操作</th>
              </tr></thead>
              <tbody>{filtered.map((device) => {
                const departments = usingDepartmentList(device);
                const expanded = expandedDepartments === device.id;
                return (
                  <tr key={device.id}>
                    <td><code>{device.assetCode}</code></td>
                    <td><button className="device-link" onClick={() => onOpenReport(device)}><strong>{device.name}</strong><span>{device.model}</span></button></td>
                    <td>{device.owningDepartment?.trim() || device.department || "—"}</td>
                    <td>
                      {departments.length ? (
                        <div className={`using-departments${expanded ? " expanded" : ""}`}>
                          {expanded
                            ? <ul>{departments.map((item) => <li key={item}>{item}</li>)}</ul>
                            : <span>{departments[0]}</span>}
                          {departments.length > 1 ? (
                            <button
                              type="button"
                              className="using-departments-toggle"
                              aria-expanded={expanded}
                              aria-label={expanded ? `收起${device.name}的使用科室` : `展开${device.name}的全部 ${departments.length} 个使用科室`}
                              title={expanded ? "收起" : `共 ${departments.length} 个使用科室`}
                              onClick={() => setExpandedDepartments(expanded ? null : device.id)}
                            ><MoreHorizontal size={15} /></button>
                          ) : null}
                        </div>
                      ) : "—"}
                    </td>
                    <td>{device.roomNumber?.trim() || "—"}</td>
                    <td>{device.enabledDate}</td>
                    <td className="num">{currency.format(device.investment)}</td>
                    <td><span className="source-pill">{device.dataSource?.trim() || "手动填写"}</span></td>
                    <td><span className={`status-pill ${statusTone(device.status)}`}>{device.status}</span></td>
                    {columns.map((field) => <td key={field.key}>{device.customFields?.[field.key]?.trim() || "—"}</td>)}
                    <td className="action-col action-wide"><span className="action-cell"><button className="icon-button" aria-label={`查看${device.name}的数据填报`} title="按期查看/填报这台设备的数据" onClick={() => onOpenReport(device)}><Eye size={16} /></button><button className="icon-button" aria-label={`编辑${device.name}`} onClick={() => onEdit(device)}><Pencil size={16} /></button></span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : (
          <div className="ledger-empty">
            <FileSpreadsheet size={26} />
            <strong>{devices.length ? "没有符合筛选条件的设备" : "本院台账还没有设备"}</strong>
            <p>{devices.length
              ? "换个关键词或把状态筛选改回“全部状态”。"
              : "两种方式录入：点右上角“新增设备”手工建档；或在数据准备中心上传设备台账文件后发布。"}</p>
          </div>
        )}
      </Panel>
    </>
  );
}

function LayoutConfiguration({
  modules,
  setModules,
  theme,
  setTheme,
  density,
  setDensity,
  draggingModule,
  setDraggingModule,
  moveModule,
  dropModule,
  openCockpit,
  notify,
}: {
  modules: DashboardModule[];
  setModules: React.Dispatch<React.SetStateAction<DashboardModule[]>>;
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  density: Density;
  setDensity: (density: Density) => void;
  draggingModule: string | null;
  setDraggingModule: (id: string | null) => void;
  moveModule: (id: string, direction: -1 | 1) => void;
  dropModule: (id: string) => void;
  openCockpit: () => void;
  notify: (message: string) => void;
}) {
  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow"><SlidersHorizontal size={15} />所见即所得配置</div><h1>驾驶舱配置</h1><p>选择展示模块、调整顺序、宽度和高度，并设置驾驶舱视觉主题；也可以在驾驶舱页面点击“编辑布局”直接拖拽调整，配置按当前医院保存。</p></div>
        <div className="heading-actions"><button className="secondary-button" onClick={() => setModules(initialModules)}><RotateCcw size={17} />恢复默认布局</button><button className="primary-button" onClick={openCockpit}><Eye size={17} />查看驾驶舱</button></div>
      </div>
      <div className="config-grid">
        <Panel title="视觉主题" description="选择适合使用场景的界面风格">
          <div className="theme-picker">
            {themeOptions.map((option) => (
              <button key={option.id} className={`theme-option ${theme === option.id ? "active" : ""}`} onClick={() => { setTheme(option.id); notify(`已切换为${option.name}`); }}>
                <span className={`theme-preview preview-${option.id}`}><i /><i /><i /></span>
                <span><strong>{option.name}</strong><small>{option.note}</small></span>
                {theme === option.id ? <CheckCircle2 size={18} /> : null}
              </button>
            ))}
          </div>
          <div className="density-picker"><span><strong>信息密度</strong><small>影响卡片间距与表格行高</small></span><div><button className={density === "comfortable" ? "active" : ""} onClick={() => setDensity("comfortable")}>舒适</button><button className={density === "compact" ? "active" : ""} onClick={() => setDensity("compact")}>紧凑</button></div></div>
        </Panel>
        <Panel title="当前布局预览" description={`${modules.filter((module) => module.visible).length} 个模块已启用`}>
          <div className={`mini-dashboard mini-${theme}`}>
            {modules.filter((module) => module.visible).map((module) => <div key={module.id} className={`mini-block mini-${module.size}`}><span>{module.name}</span></div>)}
          </div>
          <div className="preview-caption"><i />配置保存后，驾驶舱按此顺序和宽度展示</div>
        </Panel>
      </div>
      <Panel title="模块编排" description="拖动卡片调整顺序，也可以使用上下移动按钮；宽度和高度会同步到驾驶舱" action={<span className="chart-note">宽度 1/3–整行 · 高度 紧凑/标准/加高</span>}>
        <div className="module-config-list">
          {modules.map((module, index) => (
            <div
              className={`module-config-item ${draggingModule === module.id ? "dragging" : ""}`}
              key={module.id}
              draggable
              onDragStart={() => setDraggingModule(module.id)}
              onDragEnd={() => setDraggingModule(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropModule(module.id)}
            >
              <GripVertical className="drag-handle" size={18} />
              <span className="module-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="module-copy"><strong>{module.name}</strong><small>{module.description}</small></span>
              <label className="size-field"><span>宽度</span><select value={module.size} onChange={(event) => setModules((current) => current.map((item) => item.id === module.id ? { ...item, size: event.target.value as ModuleSize } : item))}>{Object.entries(sizeLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="size-field"><span>高度</span><select value={module.height ?? "standard"} onChange={(event) => setModules((current) => current.map((item) => item.id === module.id ? { ...item, height: event.target.value as ModuleHeight } : item))}>{Object.entries(heightLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <div className="order-actions"><button className="icon-button" aria-label="上移" disabled={index === 0} onClick={() => moveModule(module.id, -1)}><ArrowUp size={15} /></button><button className="icon-button" aria-label="下移" disabled={index === modules.length - 1} onClick={() => moveModule(module.id, 1)}><ArrowDown size={15} /></button></div>
              <button className={`visibility-button ${module.visible ? "active" : ""}`} onClick={() => setModules((current) => current.map((item) => item.id === module.id ? { ...item, visible: !item.visible } : item))}>{module.visible ? <Eye size={16} /> : <EyeOff size={16} />}{module.visible ? "已显示" : "已隐藏"}</button>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

function DataSourceManagement({
  metricEntries,
  metricCategories,
  notify,
  onConfigureMetrics,
  canConfigureMetrics,
}: {
  metricEntries: MetricDictionaryEntry[];
  metricCategories: MetricCategory[];
  notify: (message: string) => void;
  onConfigureMetrics: () => void;
  canConfigureMetrics: boolean;
}) {
  const mappingRows = [
    ["设备基础信息", "资产编号、型号、原值、启用日期", "设备主数据文件", "资产部/设备科"],
    ["收入", "有效收费－退费；归因收入单列", "收入明细文件", "财务部/医保办"],
    ["服务量", "检查次数、治疗例次、手术台次或检测项次", "业务量明细文件", "使用科室"],
    ["人工成本", "人数×工时×小时成本", "人工成本文件", "人力资源部/科室"],
    ["耗材成本", "领用量×加权平均出库价", "耗材出库文件", "物资部/科室"],
    ["折旧与维保", "资产折旧＋合同/实际维修费", "折旧与维修保养文件", "财务部/设备科"],
    ["使用率", "实际运行时长÷可用时长", "运行时长文件", "设备科/科室"],
    ["临床质量", "阳性、增强、报告与操作质控；按类别/项目限定", "质量事实文件", "医务处/质控办"],
    ["患者体验", "预约、签到、检查、报告、结果时间戳", "患者旅程时间文件", "门诊部/运营部"],
    ["设备保障", "故障、停机、MTTR、PM、维保合同", "工单与维修保养文件", "医学装备部"],
    ["现金回收期", "投资额÷年度现金贡献（不含折旧）", "投资与现金成本文件", "财务部/资产部"],
  ];
  function downloadFieldTemplate() {
    const header = ["数据域", "关键字段/计算", "建议文件模板", "业务责任部门"];
    const csv = [header, ...mappingRows].map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "医疗设备效益分析-文件字段模板.csv";
    link.click();
    URL.revokeObjectURL(link.href);
    notify("文件字段模板已导出");
  }
  return (
    <>
      <div className="page-heading">
        <div><h1>指标字典</h1></div>
        <div className="heading-actions">
          {canConfigureMetrics ? <button className="secondary-button" onClick={onConfigureMetrics}><SlidersHorizontal size={16} />指标字典配置</button> : null}
          <button className="secondary-button" onClick={downloadFieldTemplate}><FileSpreadsheet size={17} />下载文件字段模板</button>
        </div>
      </div>
      <MetricGovernanceCenter entries={activeMetrics(metricEntries)} categories={metricCategories} />
    </>
  );
}

function DeviceEditor({
  draft,
  setDraft,
  editing,
  ledgerFields,
  assetCodePrefix,
  onClose,
  onSave,
}: {
  draft: Device;
  setDraft: React.Dispatch<React.SetStateAction<Device>>;
  editing: boolean;
  ledgerFields: LedgerFieldDefinition[];
  assetCodePrefix: string;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
}) {
  const field = <K extends keyof Device>(key: K, value: Device[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const customFields = sortedLedgerFields(ledgerFields);
  // 这里必须用草稿里的原始数组，不能用 usingDepartmentList：那个函数会把空串过滤掉，
  // 导致点"添加使用科室"新增的空行在下一次渲染就消失，按钮看起来没反应。
  // 空行只在保存时清理。
  const usingDepartments = draft.usingDepartments?.length
    ? draft.usingDepartments
    : draft.department.trim() ? [draft.department] : [""];
  const setCustomField = (key: string, value: string) =>
    setDraft((current) => ({ ...current, customFields: { ...(current.customFields ?? {}), [key]: value } }));
  const setUsingDepartments = (next: string[]) =>
    // department 是历史字段，很多地方（成本、改进、报告）还按它做科室过滤，
    // 这里同步成第一个非空的使用科室，避免多科室设备在其它页面直接消失。
    setDraft((current) => ({ ...current, usingDepartments: next, department: next.find((item) => item.trim()) ?? "" }));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="editor-drawer" onSubmit={onSave}>
        <div className="editor-header"><div><span className="eyebrow">设备主数据</span><h2>{editing ? "编辑设备" : "新增设备"}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
        <div className="editor-body">
          <h3>基础信息</h3>
          <FormInput label="设备名称" value={draft.name} onChange={(value) => field("name", value)} required />
          <div className="form-row two"><FormInput label="简称" value={draft.shortName} onChange={(value) => field("shortName", value)} required /><FormInput label="资产编号" value={draft.assetCode} onChange={(value) => field("assetCode", value)} required hint={assetCodePrefix ? `按医院简码 ${assetCodePrefix} 自动生成，可手工覆盖` : "医院尚未配置资产编号简码，请手工填写或先到「医院与权限」配置"} /></div>
          <div className="form-row two"><FormInput label="规格型号" value={draft.model} onChange={(value) => field("model", value)} /><FormInput label="所属科室" value={draft.owningDepartment ?? ""} onChange={(value) => field("owningDepartment", value)} placeholder="资产归属的科室" /></div>
          <label className="form-field"><span>使用科室<i className="required-mark">必填</i></span>
            <div className="multi-input">
              {usingDepartments.map((item, index) => (
                <div className="multi-input-row" key={`${item}-${index}`}>
                  <input
                    value={item}
                    aria-label={`使用科室 ${index + 1}`}
                    onChange={(event) => setUsingDepartments(usingDepartments.map((value, position) => position === index ? event.target.value : value))}
                    placeholder="例如：医学影像科"
                  />
                  <button type="button" className="icon-button" aria-label={`删除使用科室 ${index + 1}`} disabled={usingDepartments.length <= 1} onClick={() => setUsingDepartments(usingDepartments.filter((_, position) => position !== index))}><Trash2 size={15} /></button>
                </div>
              ))}
              <button type="button" className="text-button" onClick={() => setUsingDepartments([...usingDepartments, ""])}><Plus size={15} />添加使用科室</button>
            </div>
            <small>一台设备可由多个科室共用；台账里默认显示第一个，点省略号展开全部。</small>
          </label>
          <div className="form-row two"><FormInput label="房间号" value={draft.roomNumber ?? ""} onChange={(value) => field("roomNumber", value)} placeholder="例如：门诊楼 B1-07" /><label className="form-field"><span>数据来源</span><select value={draft.dataSource ?? "手动填写"} onChange={(event) => field("dataSource", event.target.value)}>{DEVICE_DATA_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}</select><small>手工建档默认「手动填写」；数据准备中心发布的设备会标为「文件导入」。</small></label></div>
          <div className="form-row two"><FormInput label="设备类别" value={draft.category ?? ""} onChange={(value) => field("category", value)} placeholder="例如：诊断类（放射）" /><FormInput label="生产厂家 / 品牌" value={draft.manufacturer ?? ""} onChange={(value) => field("manufacturer", value)} /></div>
          <div className="form-row two"><FormInput label="出厂编号 / SN" value={draft.serialNumber ?? ""} onChange={(value) => field("serialNumber", value)} /><FormInput label="安装地点" value={draft.location ?? ""} onChange={(value) => field("location", value)} /></div>
          <div className="form-row two"><FormInput label="启用日期" type="date" value={draft.enabledDate} onChange={(value) => field("enabledDate", value)} /><FormInput label="数量" type="number" value={draft.quantity} onChange={(value) => field("quantity", Number(value))} suffix="台" /></div>
          <h3>报告与全生命周期档案</h3>
          <div className="form-row two"><FormInput label="资金来源" value={draft.fundingSource ?? ""} onChange={(value) => field("fundingSource", value)} /><FormInput label="预计使用年限" type="number" value={draft.usefulLifeYears ?? 8} onChange={(value) => field("usefulLifeYears", Number(value))} suffix="年" /></div>
          <div className="form-row two"><FormInput label="折旧方法" value={draft.depreciationMethod ?? ""} onChange={(value) => field("depreciationMethod", value)} /><FormInput label="配置证 / 许可信息" value={draft.licenseNumber ?? ""} onChange={(value) => field("licenseNumber", value)} /></div>
          <div className="form-row two"><FormInput label="维保状态" value={draft.maintenanceStatus ?? ""} onChange={(value) => field("maintenanceStatus", value)} /><FormInput label="数据监测状态" value={draft.monitoringStatus ?? ""} onChange={(value) => field("monitoringStatus", value)} /></div>
          {customFields.length ? (
            <>
              <h3>本院自定义字段</h3>
              {customFields.map((definition) => {
                const value = draft.customFields?.[definition.key] ?? "";
                const message = validateFieldValue(definition, value);
                return (
                  <label className="form-field" key={definition.key}>
                    <span>{definition.label}{definition.required ? <i className="required-mark">必填</i> : null}</span>
                    {definition.type === "select" ? (
                      <select value={value} onChange={(event) => setCustomField(definition.key, event.target.value)}>
                        <option value="">{definition.required ? "请选择" : "未填写"}</option>
                        {definition.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : (
                      <input
                        type={definition.type === "date" ? "date" : definition.type === "number" ? "number" : "text"}
                        value={value}
                        onChange={(event) => setCustomField(definition.key, event.target.value)}
                        placeholder={definition.required ? "必填" : "选填"}
                      />
                    )}
                    {/* 选填留空不算错；填了但格式不对要当场提示，不能等到保存才拦。 */}
                    {value.trim() && message ? <small className="field-error">{message}</small> : definition.hint ? <small>{definition.hint}</small> : null}
                  </label>
                );
              })}
            </>
          ) : null}
          <h3>效益数据</h3>
          <div className="form-row two"><FormInput label="项目总投资" type="number" value={draft.investment} onChange={(value) => field("investment", Number(value))} suffix="万元" /><FormInput label="年度收入" type="number" value={draft.revenue} onChange={(value) => field("revenue", Number(value))} suffix="万元" /></div>
          <div className="form-row two"><FormInput label="年度服务量" type="number" value={draft.serviceVolume} onChange={(value) => field("serviceVolume", Number(value))} /><FormInput label="服务量单位" value={draft.serviceUnit} onChange={(value) => field("serviceUnit", value)} /></div>
          <div className="form-row two"><FormInput label="使用率" type="number" value={draft.utilization} onChange={(value) => field("utilization", Number(value))} suffix="%" /><FormInput label="预计回本年限" type="number" step="0.1" value={draft.forecastPayback} onChange={(value) => field("forecastPayback", Number(value))} suffix="年" /></div>
          <div className="form-row two"><FormInput label="原计划回本年限" type="number" step="0.1" value={draft.planPayback} onChange={(value) => field("planPayback", Number(value))} suffix="年" /><label className="form-field"><span>运行状态</span><select value={draft.status} onChange={(event) => field("status", event.target.value as DeviceStatus)}><option>运行良好</option><option>需要关注</option><option>效益预警</option></select></label></div>
          <div className="editor-tip"><Activity size={16} />成本明细请在“成本填报”中维护，避免不同入口产生口径冲突。</div>
        </div>
        <div className="editor-footer"><button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit"><Save size={17} />保存并同步</button></div>
      </form>
    </div>
  );
}

function FormInput({
  label,
  name,
  type = "text",
  value,
  defaultValue,
  onChange,
  placeholder,
  suffix,
  required,
  min,
  step,
  hint,
}: {
  label: string;
  name?: string;
  type?: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (value: string) => void;
  placeholder?: string;
  suffix?: string;
  required?: boolean;
  min?: string;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="form-field"><span>{label}{required ? <b>*</b> : null}</span><div className="input-wrap"><input name={name} type={type} value={value} defaultValue={defaultValue} onChange={onChange ? (event) => onChange(event.target.value) : undefined} placeholder={placeholder} required={required} min={min} step={step} />{suffix ? <i>{suffix}</i> : null}</div>{hint ? <small>{hint}</small> : null}</label>
  );
}

