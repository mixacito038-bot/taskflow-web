"use client";

import { type Dispatch, FormEvent, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  Cable,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CircleDollarSign,
  Clock3,
  Cloud,
  CloudCog,
  CloudOff,
  Database,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  GripVertical,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  UserRound,
  Users,
  Wrench,
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
} from "./mock-data";
import {
  CategoryPerformancePanel,
  DimensionOverview,
  MetricGovernanceCenter,
  QualityExperiencePanel,
  ReliabilityPanel,
  SingleEquipmentDetail,
  WorkforcePerformancePanel,
} from "./InsightViews";
import AccessControlCenter, { TenantContext } from "./AccessControlCenter";
import ImprovementCenter, { initialActions, type ImprovementAction } from "./ImprovementCenter";
import { insightFor } from "./metric-definitions";
import { Hospital, initialHospitals, permissionColumns, ViewerIdentity } from "./access-control-data";
import AccountCenter, { AccountTab, defaultNotificationPreferences, type NotificationPreferences } from "./AccountCenter";
import LoginScreen from "./LoginScreen";
import NotificationCenter from "./NotificationCenter";
import { initialNotifications, PlatformNotification } from "./notification-data";
import BenefitReportCenter from "./BenefitReportCenter";
import BenefitAnalysisStudio from "./BenefitAnalysisStudio";
import GuideCenter, { type GuideTarget } from "./GuideCenter";
import {
  cloneBenefitAnalysisProfiles,
  initialBenefitAnalysisProfiles,
  type BenefitAnalysisProfile,
} from "./benefit-analysis-config";
import CloudOperationsCenter from "./CloudOperationsCenter";
import CapitalPlanningCenter from "./CapitalPlanningCenter";
import DataWorkbench from "./DataWorkbench";
import { DATA_WORKBENCH_ENTRY_CLICKS } from "./data-workbench-model";
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

type View = "cockpit" | "analysis" | "report" | "improvement" | "capital" | "workbench" | "equipment" | "detail" | "costs" | "layout" | "sources" | "access" | "operations" | "messages" | "account" | "guide";
type Perspective = "管理层" | "设备科" | "临床科室";
type ThemeId = "clinical" | "teal" | "midnight";
type Density = "comfortable" | "compact";
type CostTab = "labor" | "consumables" | "fixed";
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
  mfa?: {
    status: "disabled" | "pending" | "enabled";
    enabled: boolean;
    confirmedAt: string | null;
    lockedUntil: string | null;
    recoveryCodesRemaining: number;
  };
};

function guideTargetFor(view: View): GuideTarget {
  if (view === "detail") return "equipment";
  if (view === "capital") return "improvement";
  if (view === "workbench") return "sources";
  if (view === "account") return "access";
  if (view === "guide") return "cockpit";
  return view;
}

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
};
const cloudResourceLabels: Record<CloudResource, string> = {
  devices: "设备台账",
  costEntries: "成本明细",
  notifications: "医院消息",
  improvementActions: "改进任务",
  modules: "驾驶舱布局",
  dataSources: "文件口径配置",
  analysisProfiles: "采集分析配置",
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

function displayCloudTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function cloneDevices() {
  return initialDevices.map((device) => ({ ...device, cost: { ...device.cost } }));
}

function cloneDevicesForHospital(hospitalId: string) {
  const profile = hospitalId === "hosp-east"
    ? { revenue: 0.74, cost: 0.71, volume: 0.72, utilization: -5 }
    : hospitalId === "hosp-specialty"
      ? { revenue: 0.58, cost: 0.61, volume: 0.56, utilization: -9 }
      : { revenue: 1, cost: 1, volume: 1, utilization: 0 };
  return cloneDevices().map((device) => ({
    ...device,
    revenue: Math.round(device.revenue * profile.revenue),
    serviceVolume: Math.round(device.serviceVolume * profile.volume),
    utilization: Math.max(35, Math.min(98, device.utilization + profile.utilization)),
    forecastPayback: Number((device.forecastPayback / Math.max(profile.revenue, 0.4)).toFixed(1)),
    cost: Object.fromEntries(Object.entries(device.cost).map(([key, value]) => [key, Math.round(value * profile.cost)])) as Device["cost"],
  }));
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
  const [headerPanel, setHeaderPanel] = useState<"notifications" | "account" | null>(null);
  const [guideOrigin, setGuideOrigin] = useState<GuideTarget>("cockpit");
  const [accountTab, setAccountTab] = useState<AccountTab>("profile");
  const [notificationFocusId, setNotificationFocusId] = useState("");
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
  const [analysisProfileStore, setAnalysisProfileStoreLocal] = useDemoState<Record<string, BenefitAnalysisProfile[]>>("equip-benefit-analysis-profiles-by-hospital-v1", demoMode ? initialAnalysisProfileStore() : {}, demoMode);
  const [notificationPreferences, setNotificationPreferencesLocal] = useDemoState<NotificationPreferences>("equip-benefit-notification-preferences-v1", defaultNotificationPreferences, demoMode);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const readNotificationIdsRef = useRef<string[]>([]);
  const [cloudSyncState, setCloudSyncState] = useState<CloudSyncState>(viewer.authenticated ? "idle" : "ready");
  const [cloudHydrated, setCloudHydrated] = useState(!viewer.authenticated);
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<string | null>(null);
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
  const [toast, setToast] = useState("");
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [equipmentStatus, setEquipmentStatus] = useState("全部状态");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deviceDraft, setDeviceDraft] = useState<Device>(cloneDevices()[0]);
  const [costTab, setCostTab] = useState<CostTab>("labor");
  const [costDeviceId, setCostDeviceId] = useState(initialDevices[0].id);
  const [draggingModule, setDraggingModule] = useState<string | null>(null);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [selectedDeviceId, setSelectedDeviceId] = useState(initialDevices[0].id);
  const [notifications, setNotificationsLocal] = useDemoState<PlatformNotification[]>("equip-benefit-notifications-v1", initialNotifications, demoMode);
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
      return {
        id: membership.hospitalId,
        code: membership.hospitalCode,
        name: membership.hospitalName,
        shortName: membership.hospitalShortName,
        level: membership.hospitalLevel ?? existing?.level ?? "未设置",
        region: membership.hospitalRegion ?? existing?.region ?? "未设置",
        status: "运行中",
        tenantKey: existing?.tenantKey ?? `tenant_${membership.hospitalCode.toLowerCase().replaceAll("-", "_")}`,
        dataCompleteness: existing?.dataCompleteness ?? 0,
        connectedSources: existing?.connectedSources ?? 0,
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
  const costEntries = costEntryStore[effectiveHospitalId] ?? (demoMode ? cloneCostEntriesForHospital(effectiveHospitalId) : []);
  const improvementActions = improvementStore[effectiveHospitalId] ?? (demoMode ? initialActions : []);
  const currentDataSources = sourceStore[effectiveHospitalId] ?? (demoMode ? initialDataSources : []);
  const currentAnalysisProfiles = analysisProfileStore[effectiveHospitalId] ?? (demoMode ? initialBenefitAnalysisProfiles : []);
  const activeMembership = tenantContext?.memberships.find((membership) => membership.hospitalId === effectiveHospitalId);
  const currentRoleName = activeMembership?.roleName ?? (viewer.authenticated ? "平台超级管理员" : "体验角色");
  const activePermissions = new Set(sessionState === "demo" || (sessionState === "verified" && isPlatformAdmin)
    ? permissionColumns.map((permission) => permission.code)
    : sessionState === "verified" ? activeMembership?.permissions ?? [] : []);
  const hasPermission = (permission: string) => activePermissions.has(permission);
  const dataWorkbenchPermissions = ["connector.manage", "data.ingest", "data.clean", "data.review", "data.publish"];
  const canOpenDataWorkbench = dataWorkbenchPermissions.some(hasPermission);

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
      notifications: [],
      improvementActions: [],
      modules: initialModules.map((module) => ({ ...module })),
      dataSources: [],
      analysisProfiles: [],
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
    setAnalysisProfileStoreLocal((current) => ({ ...current, [hospitalId]: result.shared.analysisProfiles }));
    setModulesLocal(result.shared.modules);
    setNotificationsLocal((current) => [
      ...current.filter((notification) => notification.hospitalId !== hospitalId),
      ...result.shared.notifications.map((notification) => ({ ...notification, hospitalId })),
    ]);
    const preferences = result.preferences;
    if (preferences.theme) setThemeLocal(preferences.theme);
    if (preferences.density) setDensityLocal(preferences.density);
    if (typeof preferences.contentZoom === "number") setContentZoomLocal(preferences.contentZoom);
    if (preferences.notificationPreferences) setNotificationPreferencesLocal({ ...defaultNotificationPreferences, ...preferences.notificationPreferences });
    if (preferences.department) setDepartment(preferences.department);
    if (preferences.period) setPeriod(preferences.period);
    if (preferences.perspective) setPerspective(preferences.perspective);
    readNotificationIdsRef.current = preferences.readNotificationIds ?? [];
    setReadNotificationIds(readNotificationIdsRef.current);
    cloudRevisions.current[hospitalId] = result.revisions;
    setCloudUpdatedAt(result.updatedAt);
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
        const result = await request();
        setCloudUpdatedAt(result.updatedAt);
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
    } else if (resource === "notifications") {
      setNotificationsLocal((current) => [
        ...current.filter((notification) => notification.hospitalId !== hospitalId),
        ...(value as PlatformNotification[]).map((notification) => ({ ...notification, hospitalId })),
      ]);
    } else if (resource === "improvementActions") {
      setImprovementStoreLocal((current) => ({ ...current, [hospitalId]: value as ImprovementAction[] }));
    } else if (resource === "modules") {
      setModulesLocal(value as DashboardModule[]);
    } else if (resource === "dataSources") {
      setSourceStoreLocal((current) => ({ ...current, [hospitalId]: value as typeof initialDataSources }));
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
      const result = await requestCloudResource(
        conflict.hospitalId,
        conflict.resource,
        conflict.localValue,
        conflict.currentRevision,
      );
      setCloudUpdatedAt(result.updatedAt);
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

  function setCostEntries(update: CostEntry[] | ((current: CostEntry[]) => CostEntry[])) {
    setCostEntryStoreLocal((currentStore) => {
      const current = currentStore[effectiveHospitalId] ?? (demoMode ? cloneCostEntriesForHospital(effectiveHospitalId) : []);
      const next = typeof update === "function" ? update(current) : update;
      void persistCloudResource("costEntries", next);
      return { ...currentStore, [effectiveHospitalId]: next };
    });
  }

  const setImprovementActions: Dispatch<SetStateAction<ImprovementAction[]>> = (update) => {
    setImprovementStoreLocal((currentStore) => {
      const current = currentStore[effectiveHospitalId] ?? (demoMode ? initialActions : []);
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

  const setCurrentDataSources: Dispatch<SetStateAction<typeof initialDataSources>> = (update) => {
    setSourceStoreLocal((currentStore) => {
      const current = currentStore[effectiveHospitalId] ?? (demoMode ? initialDataSources : []);
      const next = resolveStateUpdate(update, current);
      void persistCloudResource("dataSources", next);
      return { ...currentStore, [effectiveHospitalId]: next };
    });
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

  function setNotificationPreferences(value: NotificationPreferences) {
    setNotificationPreferencesLocal(value);
    void persistCloudPreferences({ notificationPreferences: value });
  }

  function updateReadNotificationIds(value: string[] | ((current: string[]) => string[])) {
    const next = typeof value === "function" ? value(readNotificationIdsRef.current) : value;
    const unique = [...new Set(next)];
    readNotificationIdsRef.current = unique;
    setReadNotificationIds(unique);
    void persistCloudPreferences({ readNotificationIds: unique });
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
    setCloudUpdatedAt(null);
    setCloudError("");
    setCloudConflict(null);
    setHeaderPanel(null);
    setMobileNavOpen(false);
    setReadNotificationIds([]);
    readNotificationIdsRef.current = [];
    setDeviceStoreLocal(initialDeviceStore());
    setCostEntryStoreLocal(initialCostEntryStore());
    setImprovementStoreLocal(initialImprovementStore());
    setSourceStoreLocal(initialSourceStore());
    setAnalysisProfileStoreLocal(initialAnalysisProfileStore());
    setModulesLocal(initialModules);
    setNotificationsLocal(initialNotifications);
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
      const passwordSession = applicationSession?.authMethod === "password";
      const normalized = passwordSession ? credential : credential.trim().replace(/\s+/g, "");
      const response = await fetch("/api/app-session", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          action: applicationSessionState === "locked" ? "unlock" : "start",
          ...(passwordSession
            ? { password: normalized }
            : normalized
              ? /^\d{6}$/.test(normalized)
                ? { totpCode: normalized }
                : { recoveryCode: normalized }
              : {}),
        }),
      });
      const result = await response.json() as ApplicationSessionSnapshot & { error?: string; lockedUntil?: string };
      if (!response.ok) {
        const message = {
          account_not_provisioned: "当前账号尚未加入任何医院，请联系平台管理员配置医院与角色。",
          account_disabled: "当前账号已停用，请联系平台管理员。",
          mfa_factor_required: "请输入验证器中的 6 位动态验证码，或一枚恢复码。",
          mfa_invalid: "验证码或恢复码不正确，请重新输入。",
          mfa_code_replayed: "该动态验证码已经使用，请等待验证器生成下一组验证码。",
          mfa_temporarily_locked: result.lockedUntil
            ? `验证失败次数过多，请在 ${new Date(result.lockedUntil).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 后重试。`
            : "验证失败次数过多，请稍后重试。",
          mfa_encryption_key_unavailable: "多因素验证服务尚未完成安全密钥配置，请联系平台管理员。",
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

  async function passwordLogin(username: string, password: string, mfaCredential?: string) {
    const normalizedMfa = mfaCredential?.trim().replace(/\s+/g, "") ?? "";
    const response = await fetch("/api/app-session", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        action: "password_login",
        username,
        password,
        ...(normalizedMfa
          ? /^\d{6}$/.test(normalizedMfa)
            ? { totpCode: normalizedMfa }
            : { recoveryCode: normalizedMfa }
          : {}),
      }),
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
        mfa_required: "该账号已启用多因素验证，请输入动态验证码。",
        mfa_invalid: "验证码或恢复码不正确，请重新输入。",
        mfa_code_replayed: "该动态验证码已经使用，请等待验证器生成下一组验证码。",
        mfa_temporarily_locked: "验证失败次数过多，请稍后重试。",
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

  const currentCostDevice = devices.find((device) => device.id === costDeviceId) ?? devices[0];
  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? devices[0];
  const hospitalNotifications = notifications
    .filter((item) => !item.hospitalId || item.hospitalId === effectiveHospitalId)
    .map((item) => ({ ...item, read: item.read || readNotificationIds.includes(item.id) }));
  const unreadNotificationCount = hospitalNotifications.filter((item) => !item.read).length;
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

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function navigate(nextView: View) {
    setView(nextView);
    setHeaderPanel(null);
    setMobileNavOpen(false);
    setLayoutEditing(false);
    setDraggingModule(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openGuide() {
    if (view !== "guide") setGuideOrigin(guideTargetFor(view));
    navigate("guide");
  }

  function openDeviceDetail(device: Device) {
    setSelectedDeviceId(device.id);
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
    setNotificationsLocal(initialNotifications);
    setNotificationPreferencesLocal(defaultNotificationPreferences);
    readNotificationIdsRef.current = [];
    setReadNotificationIds([]);
    notify("已恢复全部演示数据和默认布局");
  }

  function markNotification(id: string, read = true) {
    if (sessionState === "demo") {
      setNotificationsLocal((current) => current.map((item) => item.id === id ? { ...item, read } : item));
      return;
    }
    updateReadNotificationIds((current) => read
      ? [...current, id]
      : current.filter((notificationId) => notificationId !== id));
  }

  function markCurrentHospitalNotificationsRead() {
    const visibleIds = hospitalNotifications.map((item) => item.id);
    if (sessionState === "demo") {
      const visibleIdSet = new Set(visibleIds);
      setNotificationsLocal((current) => current.map((item) => visibleIdSet.has(item.id) ? { ...item, read: true } : item));
    } else {
      updateReadNotificationIds((current) => [...current, ...visibleIds]);
    }
    notify("当前医院消息已全部标为已读");
  }

  function openNotificationCenter(notification?: PlatformNotification) {
    if (notification) {
      markNotification(notification.id);
      setNotificationFocusId(notification.id);
    }
    navigate("messages");
  }

  function openNotificationTarget(notification: PlatformNotification) {
    markNotification(notification.id);
    const target = notification.target;
    const permitted = !target
      || target === "cockpit"
      || target === "detail"
      || (target === "costs" && hasPermission("cost.manage"))
      || (target === "improvement" && hasPermission("improvement.manage"))
      || (target === "sources" && hasPermission("source.manage"))
      || (target === "access" && (hasPermission("hospital.manage") || hasPermission("member.manage")));
    if (!permitted) {
      notify("当前角色没有处理该事项的权限，可联系医院管理员协助");
      return;
    }
    if (target === "detail" && notification.deviceId) {
      const targetDevice = devices.find((device) => device.id === notification.deviceId);
      if (targetDevice) return openDeviceDetail(targetDevice);
    }
    if (target) navigate(target);
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
          assetCode: "YLSB-2026-",
          name: "",
          shortName: "",
          model: "",
          category: "",
          manufacturer: "",
          serialNumber: "",
          department: "",
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
    if (!deviceDraft.name.trim() || !deviceDraft.department.trim()) {
      notify("请填写设备名称和使用科室");
      return;
    }
    setDevices((current) =>
      editingDevice ? current.map((device) => (device.id === deviceDraft.id ? deviceDraft : device)) : [...current, deviceDraft],
    );
    setEditorOpen(false);
    notify(editingDevice ? "设备信息已更新，驾驶舱同步刷新" : "设备已加入台账和驾驶舱");
  }

  function addLabor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const headcount = Number(form.get("headcount"));
    const hours = Number(form.get("hours"));
    const hourlyCost = Number(form.get("hourlyCost"));
    const amount = (headcount * hours * hourlyCost) / 10000;
    const selected = devices.find((device) => device.id === String(form.get("deviceId")));
    if (!selected || amount <= 0) return notify("请完整填写人工成本数据");
    const entry: CostEntry = {
      id: `labor-${crypto.randomUUID()}`,
      type: "人工",
      deviceId: selected.id,
      deviceName: selected.name,
      item: String(form.get("role")),
      detail: `${headcount} 人 × ${hours} 小时 × ${hourlyCost} 元/小时`,
      period: String(form.get("period")),
      amount: Number(amount.toFixed(2)),
      owner: selected.department,
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    };
    setCostEntries((current) => [entry, ...current]);
    setDevices((current) => current.map((device) => (device.id === selected.id ? { ...device, cost: { ...device.cost, labor: device.cost.labor + amount } } : device)));
    event.currentTarget.reset();
    notify(`已计入 ${amount.toFixed(2)} 万元人工成本`);
  }

  function addConsumable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const quantityValue = Number(form.get("quantity"));
    const unitPrice = Number(form.get("unitPrice"));
    const amount = (quantityValue * unitPrice) / 10000;
    const selected = devices.find((device) => device.id === String(form.get("deviceId")));
    if (!selected || amount <= 0) return notify("请完整填写耗材成本数据");
    const entry: CostEntry = {
      id: `material-${crypto.randomUUID()}`,
      type: "耗材",
      deviceId: selected.id,
      deviceName: selected.name,
      item: String(form.get("item")),
      detail: `${quantityValue} ${String(form.get("unit"))} × ${unitPrice} 元/${String(form.get("unit"))} · ${String(form.get("chargeMode"))}`,
      period: String(form.get("period")),
      amount: Number(amount.toFixed(2)),
      owner: selected.department,
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    };
    setCostEntries((current) => [entry, ...current]);
    setDevices((current) => current.map((device) => (device.id === selected.id ? { ...device, cost: { ...device.cost, consumables: device.cost.consumables + amount } } : device)));
    event.currentTarget.reset();
    notify(`已计入 ${amount.toFixed(2)} 万元耗材成本`);
  }

  function saveFixedCosts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selectedId = String(form.get("deviceId"));
    setDevices((current) =>
      current.map((device) =>
        device.id === selectedId
          ? {
              ...device,
              cost: {
                ...device.cost,
                depreciation: Number(form.get("depreciation")),
                maintenance: Number(form.get("maintenance")),
                energy: Number(form.get("energy")),
                space: Number(form.get("space")),
                indirect: Number(form.get("indirect")),
              },
            }
          : device,
      ),
    );
    notify("固定成本已保存，驾驶舱同步刷新");
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
    { id: "analysis", label: "采集与分析", icon: <Activity size={18} />, group: "show", permissions: ["dashboard.view", "source.manage"] },
    { id: "report", label: "效益分析报告", icon: <FileText size={18} />, group: "show", permissions: ["report.manage", "report.review", "report.approve", "report.export"] },
    { id: "improvement", label: "运营改进中心", icon: <Target size={18} />, group: "show", permissions: ["improvement.manage"] },
    { id: "capital", label: "资本计划", icon: <Boxes size={18} />, group: "show", permissions: ["improvement.manage", "report.approve"] },
    { id: "messages", label: "消息中心", icon: <Bell size={18} />, group: "show", permissions: [] },
    { id: "guide", label: "使用指南", icon: <CircleHelp size={18} />, group: "show", permissions: [] },
    { id: "equipment", label: "设备台账", icon: <FileSpreadsheet size={18} />, group: "manage", permissions: ["equipment.manage"] },
    { id: "costs", label: "成本填报", icon: <CircleDollarSign size={18} />, group: "manage", permissions: ["cost.manage"] },
    { id: "layout", label: "驾驶舱配置", icon: <SlidersHorizontal size={18} />, group: "manage", permissions: ["member.manage"] },
    { id: "sources", label: "文件口径说明", icon: <Database size={18} />, group: "manage", permissions: ["source.manage"] },
    ...(dataWorkbenchUnlocked ? [{ id: "workbench" as View, label: "数据准备中心", icon: <Cable size={18} />, group: "manage" as const, permissions: dataWorkbenchPermissions }] : []),
    { id: "access", label: "医院与权限", icon: <ShieldCheck size={18} />, group: "manage", permissions: ["hospital.manage", "member.manage"] },
    { id: "operations", label: "云端运维", icon: <CloudCog size={18} />, group: "manage", permissions: ["member.manage"] },
  ];
  const permittedNavItems = navItems.filter((item) =>
    (item.id !== "operations" || sessionState === "verified")
    && (!item.permissions.length || item.permissions.some(hasPermission)));
  const guideAvailableTargets = permittedNavItems
    .map((item) => item.id)
    .filter((id): id is GuideTarget => id !== "guide" && id !== "capital" && id !== "workbench");

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
    analysis: "采集与效益分析",
    report: "效益分析报告",
    improvement: "运营改进中心",
    capital: "3—5 年资本计划",
    workbench: "数据准备中心",
    equipment: "设备台账",
    detail: selectedDevice ? `${selectedDevice.shortName}单机分析` : "单机设备分析",
    costs: "成本填报中心",
    layout: "驾驶舱配置",
    sources: "文件模板与指标口径",
    access: "医院与权限管理",
    operations: "云端运维与演示自检",
    messages: "消息中心",
    account: "个人中心",
    guide: "使用指南",
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
        mfaEnabled={Boolean(applicationSession?.mfa?.enabled)}
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
    <div className={`platform theme-${theme} density-${density}`}>
      <aside className={`sidebar ${mobileNavOpen ? "mobile-open" : ""}`}>
        <div className="brand" role="button" tabIndex={0} aria-label="勇虹医疗品牌区" onClick={(event) => brandClick(event.timeStamp)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") brandClick(event.timeStamp); }}>
          {/* The supplied wordmark is already optimized and must retain its exact transparent canvas. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/yonghong-logo.png" alt="勇虹医疗 YHONG" />
          <div><strong>勇虹医疗</strong><span>{dataWorkbenchUnlocked ? "数据准备模式已解锁" : "设备效益管理平台"}</span></div>
          <button className="icon-button sidebar-close" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)}><X size={19} /></button>
        </div>
        <nav>
          <p className="nav-label">分析展示</p>
          {permittedNavItems.filter((item) => item.group === "show").map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => item.id === "guide" ? openGuide() : navigate(item.id)}>{item.icon}<span>{item.label}</span>{item.id === "messages" && unreadNotificationCount ? <i className="nav-count">{unreadNotificationCount}</i> : null}</button>
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
          <div className="data-health"><span><i />{activeHospital?.shortName ?? "医院未配置"}</span><small>{sessionState === "verified" ? cloudSyncState === "saving" ? "正在保存到云端" : cloudSyncState === "error" ? "云端同步需重试" : "云端数据已同步" : "演示租户上下文"}{cloudUpdatedAt ? ` · ${displayCloudTime(cloudUpdatedAt)}` : ""}</small></div>
          {sessionState === "demo"
            ? <button onClick={() => setResetConfirmOpen(true)}><RotateCcw size={16} />恢复演示数据</button>
            : <button onClick={() => setCloudRetryKey((current) => current + 1)}><Cloud size={16} />重新同步云端</button>}
        </div>
      </aside>

      {mobileNavOpen ? <button className="mobile-mask" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} /> : null}

      <main className="main-shell">
        <header className="topbar">
          <button className="icon-button menu-button" aria-label="打开导航" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
          <div className="breadcrumb"><span>大型设备效益分析</span><b>/</b><strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            {sessionState === "verified" ? <span className={`cloud-sync-badge sync-${cloudSyncState}`} title={cloudUpdatedAt ? `最近同步：${new Date(cloudUpdatedAt).toLocaleString("zh-CN", { hour12: false })}` : "云端工作区"}>{cloudSyncState === "saving" ? <LoaderCircle className="spin" size={14} /> : cloudSyncState === "error" ? <CloudOff size={14} /> : <Cloud size={14} />}{cloudSyncState === "saving" ? "保存中" : cloudSyncState === "error" ? "同步失败" : "云端已同步"}</span> : null}
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
            <button className={`guide-shortcut ${view === "guide" ? "active" : ""}`} type="button" aria-label="打开使用指南" onClick={openGuide}>
              <CircleHelp size={17} /><span>使用指南</span>
            </button>
            <button className="icon-button notification-button" aria-label="打开消息中心速览" aria-haspopup="dialog" aria-expanded={headerPanel === "notifications"} onClick={() => setHeaderPanel((current) => current === "notifications" ? null : "notifications")}><Bell size={18} />{unreadNotificationCount ? <i>{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</i> : null}</button>
            <button className="account-trigger" aria-label="打开账号菜单" aria-haspopup="menu" aria-expanded={headerPanel === "account"} onClick={() => setHeaderPanel((current) => current === "account" ? null : "account")}><span className="avatar">{viewer.displayName.slice(0, 1)}</span><span className="user"><strong>{viewer.displayName}</strong><span>{currentRoleName}</span></span><ChevronDown size={14} /></button>
            {headerPanel === "notifications" ? (
              <div className="header-popover notification-popover" role="dialog" aria-label="消息速览">
                <header><div><strong>消息速览</strong><span>{unreadNotificationCount} 条未读 · {activeHospital.shortName}</span></div><button className="text-button" onClick={markCurrentHospitalNotificationsRead}>全部已读</button></header>
                <div className="popover-notification-list">
                  {hospitalNotifications.slice(0, 5).map((item) => <button key={item.id} className={!item.read ? "unread" : ""} onClick={() => openNotificationCenter(item)}><span className={`popover-dot priority-${item.priority}`} /><span><strong>{item.title}</strong><small>{item.summary}</small><em>{item.timeLabel} · {item.source}</em></span><ChevronRight size={15} /></button>)}
                </div>
                <footer><button onClick={() => openNotificationCenter()}>查看全部消息<ChevronRight size={15} /></button></footer>
              </div>
            ) : null}
            {headerPanel === "account" ? (
              <div className="header-popover account-popover" role="menu">
                <header><span className="avatar large">{viewer.displayName.slice(0, 1)}</span><div><strong>{viewer.displayName}</strong><small>{viewer.email}</small><em>{activeHospital.shortName} · {currentRoleName}</em></div></header>
                <div className="account-menu-list"><button role="menuitem" onClick={() => openAccount("profile")}><UserRound size={16} /><span><strong>个人中心</strong><small>身份与医院成员关系</small></span><ChevronRight size={15} /></button><button role="menuitem" onClick={() => openAccount("security")}><ShieldCheck size={16} /><span><strong>登录与安全</strong><small>会话、权限与退出登录</small></span><ChevronRight size={15} /></button><button role="menuitem" onClick={() => openAccount("preferences")}><Bell size={16} /><span><strong>消息偏好</strong><small>设置提醒类型</small></span><ChevronRight size={15} /></button>{hasPermission("member.manage") || hasPermission("hospital.manage") ? <button role="menuitem" onClick={() => navigate("access")}><Building2 size={16} /><span><strong>医院与权限</strong><small>成员、角色与安全审计</small></span><ChevronRight size={15} /></button> : null}</div>
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
              <section className="guide-entry-strip" aria-label="首次使用入口">
                <span className="guide-entry-icon"><CircleHelp size={20} /></span>
                <div>
                  <strong>不知道从哪里开始？按你的岗位走一遍关键流程</strong>
                  <p>先看角色路线，再直接进入设备、文件准备、成本、报告或改进页面；每一步都写明责任人和完成标志。</p>
                </div>
                <div className="guide-entry-readiness">
                  <span><b>{devices.length}</b> 台设备</span>
                  <span><b>{publishedData.publication ? publishedData.rows.length : 0}</b> 已发布文件事实</span>
                  <span><b>{currentAnalysisProfiles.filter((item) => item.status === "已启用").length}/{currentAnalysisProfiles.length}</b> 品类规则已启用</span>
                </div>
                <button className="primary-button" type="button" onClick={openGuide}>打开使用指南<ChevronRight size={16} /></button>
              </section>
              {sessionState === "verified" ? <section className={`guide-entry-strip ${publishedData.publication ? "" : "warning"}`} aria-label="正式发布数据状态">
                <span className="guide-entry-icon">{publishedLoading ? <LoaderCircle className="spin" size={20} /> : publishedData.publication ? <ShieldCheck size={20} /> : <Database size={20} />}</span>
                <div><strong>{publishedLoading ? "正在读取正式发布数据" : publishedData.publication ? `当前使用发布版本 V${publishedData.publication.version}` : "本院暂无可用 Published 数据"}</strong><p>{publishedData.publication ? `Snapshot ${publishedData.publication.snapshotId} · SHA-256 ${publishedData.publication.snapshotSha256.slice(0, 12)}… · ${publishedData.publication.rowCount} 行；更正或回滚后将自动切换。` : publishedError ? "发布数据读取失败，正式页面保持空态，不使用演示值。" : "请在数据准备中心完成质量门禁、审核和发布；正式页面不会使用演示设备补位。"}</p></div>
              </section> : null}
              <div className="filter-bar">
                <label><Building2 size={16} /><span>使用科室</span><select value={department} onChange={(event) => setDepartmentPreference(event.target.value)}>{departmentOptions.map((option) => <option key={option}>{option}</option>)}</select></label>
                <label><Clock3 size={16} /><span>分析期间</span><select value={period} onChange={(event) => setPeriodPreference(event.target.value)}><option>2026年度</option><option>2026年上半年</option><option>2026年第二季度</option></select></label>
                <label><Users size={16} /><span>角色视角</span><select value={perspective} onChange={(event) => setPerspectivePreference(event.target.value as Perspective)}><option>管理层</option><option>设备科</option><option>临床科室</option></select></label>
                <div className="filter-status"><i />{publishedSupplyStatus}</div>
              </div>
              {sessionState !== "verified" || publishedData.publication ? <section className="role-summary" aria-label={`${perspective}重点指标`}>
                <div className="role-summary-title"><span>{perspective}</span><small>{perspective === "管理层" ? "看价值与资源配置" : perspective === "设备科" ? "看流程与设备保障" : "看服务效率与设备可用"}</small></div>
                {perspectiveItems[perspective].map((item) => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></div>)}
              </section> : null}
              {sessionState !== "verified" || publishedData.publication ? <div className="dashboard-grid">
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
              </div> : <div className="empty-dashboard"><Database size={30} /><h3>暂无已发布数据</h3><p>正式模式保持空态；完成文件映射、清洗、复核与发布后自动刷新。</p>{canOpenDataWorkbench && dataWorkbenchUnlocked ? <button className="primary-button" onClick={() => navigate("workbench")}>打开数据准备中心</button> : null}</div>}
              {configuredPublishedCanvases.length ? <div className="dashboard-grid">{configuredPublishedCanvases.map((item) => <div className="module module-medium" key={item.visualization.code}><ConfigurableAnalyticsCanvas metric={item.metric} visualization={item.visualization} data={[...item.data]} metricDefinitionVersion={item.metric.version ?? 1} visualizationVersion={item.visualization.version} /></div>)}</div> : null}
              {!visibleModules.length ? <div className="empty-dashboard"><EyeOff size={30} /><h3>驾驶舱暂未启用模块</h3><p>前往管理后台选择需要展示的内容。</p><button className="primary-button" onClick={() => navigate("layout")}>立即配置</button></div> : null}
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
            <BenefitAnalysisStudio
              profiles={currentAnalysisProfiles}
              setProfiles={setCurrentAnalysisProfiles}
              devices={devices}
              sources={currentDataSources}
              canManage={hasPermission("source.manage")}
              notify={notify}
              onOpenSources={hasPermission("source.manage") ? () => navigate("sources") : undefined}
            />
          ) : null}

          {view === "equipment" ? (
            <EquipmentManagement
              devices={devices}
              search={equipmentSearch}
              setSearch={setEquipmentSearch}
              status={equipmentStatus}
              setStatus={setEquipmentStatus}
              onEdit={openDeviceEditor}
              onView={openDeviceDetail}
              onAdd={() => openDeviceEditor()}
            />
          ) : null}

          {view === "improvement" ? (
            <ImprovementCenter
              devices={devices}
              actions={improvementActions}
              setActions={setImprovementActions}
              onSelectDevice={openDeviceDetail}
              notify={notify}
              publishedData={sessionState === "verified" ? publishedData : undefined}
              demoMode={demoMode}
            />
          ) : null}

          {view === "capital" ? (
            <CapitalPlanningCenter devices={devices} onSelectDevice={openDeviceDetail} />
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
            />
          ) : null}

          {view === "costs" ? (
            <CostManagement
              devices={devices}
              entries={costEntries}
              tab={costTab}
              setTab={setCostTab}
              currentDeviceId={costDeviceId}
              setCurrentDeviceId={setCostDeviceId}
              currentDevice={currentCostDevice}
              onLabor={addLabor}
              onConsumable={addConsumable}
              onFixed={saveFixedCosts}
            />
          ) : null}

          {view === "layout" ? (
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
            <DataSourceManagement sources={currentDataSources} setSources={setCurrentDataSources} notify={notify} />
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

          {view === "operations" ? (
            <CloudOperationsCenter
              hospitalId={effectiveHospitalId}
              hospitalName={activeHospital.name}
              canManage={sessionState === "verified" && hasPermission("member.manage")}
            />
          ) : null}

          {view === "messages" ? (
            <NotificationCenter
              notifications={hospitalNotifications}
              activeHospital={activeHospital}
              onMarkRead={markNotification}
              onMarkAllRead={markCurrentHospitalNotificationsRead}
              onOpen={openNotificationTarget}
              initialSelectedId={notificationFocusId}
            />
          ) : null}

          {view === "guide" ? (
            <GuideCenter
              key={`${effectiveHospitalId}-${currentRoleName}`}
              currentRoleName={currentRoleName}
              currentHospitalName={activeHospital.name}
              period={period}
              demoMode={sessionState === "demo"}
              originTarget={guideOrigin}
              availableTargets={guideAvailableTargets}
              status={{
                deviceCount: devices.length,
                connectedSources: currentDataSources.filter((item) => item.status === "已连接").length,
                totalSources: currentDataSources.length,
                enabledProfiles: currentAnalysisProfiles.filter((item) => item.status === "已启用").length,
                totalProfiles: currentAnalysisProfiles.length,
                costRecordCount: costEntries.length,
                openActionCount: improvementActions.filter((item) => item.status !== "已完成").length,
              }}
              onNavigate={(target) => navigate(target)}
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
              preferences={notificationPreferences}
              onPreferencesChange={setNotificationPreferences}
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
                mfa: applicationSession.mfa,
              } : null}
              cloudUpdatedAt={cloudUpdatedAt}
              cloudSyncState={cloudSyncState}
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
              <dl className="exit-session-facts"><div><dt>账号</dt><dd>{viewer.email}</dd></div><div><dt>当前医院</dt><dd>{activeHospital.shortName}</dd></div><div><dt>云端状态</dt><dd>{cloudSyncState === "saving" ? "仍在保存，请稍候" : cloudSyncState === "error" ? "存在未同步修改，请先处理" : "已完成同步"}</dd></div></dl>
            </div>
            <footer>
              <button className="secondary-button" disabled={applicationSessionBusy} onClick={() => setExitConfirmMode(null)}>取消</button>
              <button className={exitConfirmMode === "lock" ? "primary-button" : "danger-button"} disabled={applicationSessionBusy || cloudSyncState === "saving"} onClick={() => void confirmExitAction()}>{applicationSessionBusy ? <LoaderCircle className="spin" size={16} /> : exitConfirmMode === "lock" ? <LockKeyhole size={16} /> : <LogOut size={16} />}{applicationSessionBusy ? "正在处理" : exitConfirmMode === "lock" ? "确认锁定" : exitConfirmMode === "all" ? "退出全部会话" : "退出登录"}</button>
            </footer>
          </section>
        </div>
      ) : null}

      {toast ? <div className="toast"><Check size={17} />{toast}</div> : null}
    </div>
  );
}

function EquipmentManagement({
  devices,
  search,
  setSearch,
  status,
  setStatus,
  onEdit,
  onView,
  onAdd,
}: {
  devices: Device[];
  search: string;
  setSearch: (value: string) => void;
  status: string;
  setStatus: (value: string) => void;
  onEdit: (device: Device) => void;
  onView: (device: Device) => void;
  onAdd: () => void;
}) {
  const filtered = devices.filter((device) => {
    const matchesSearch = `${device.name}${device.shortName}${device.assetCode}${device.model}${device.department}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (status === "全部状态" || device.status === status);
  });

  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow"><FileSpreadsheet size={15} />资产主数据</div><h1>设备台账</h1><p>维护单机基础资料、收入、工作量和计划指标，变更后驾驶舱实时更新。</p></div>
        <button className="primary-button" onClick={onAdd}><Plus size={17} />新增设备</button>
      </div>
      <div className="admin-stats">
        <div><span>纳管设备</span><strong>{devices.length}</strong><small>台（套）</small></div>
        <div><span>资产原值</span><strong>{currency.format(devices.reduce((sum, item) => sum + item.investment, 0))}</strong><small>万元</small></div>
        <div><span>效益预警</span><strong>{devices.filter((item) => item.status === "效益预警").length}</strong><small>台设备</small></div>
        <div><span>数据完整率</span><strong>96.8%</strong><small>演示口径</small></div>
      </div>
      <Panel title="设备主数据" description={`共 ${filtered.length} 条结果`} action={<span className="chart-note">编辑后自动保存到本机</span>}>
        <div className="table-toolbar">
          <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索设备、型号、资产编号或科室" /></label>
          <select className="select-control" value={status} onChange={(event) => setStatus(event.target.value)}><option>全部状态</option><option>运行良好</option><option>需要关注</option><option>效益预警</option></select>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>资产编号</th><th>设备名称/型号</th><th>使用科室</th><th>启用日期</th><th className="num">原值(万元)</th><th className="num">年度收入</th><th className="num">总成本</th><th className="num">使用率</th><th>状态</th><th className="action-col action-wide">操作</th></tr></thead>
            <tbody>{filtered.map((device) => (
              <tr key={device.id}>
                <td><code>{device.assetCode}</code></td>
                <td><button className="device-link" onClick={() => onView(device)}><strong>{device.name}</strong><span>{device.model}</span></button></td>
                <td>{device.department}</td><td>{device.enabledDate}</td>
                <td className="num">{currency.format(device.investment)}</td><td className="num">{currency.format(device.revenue)}</td><td className="num">{currency.format(totalCost(device))}</td><td className="num">{device.utilization}%</td>
                <td><span className={`status-pill ${statusTone(device.status)}`}>{device.status}</span></td>
                <td className="action-col action-wide"><button className="icon-button" aria-label={`查看${device.name}详情`} onClick={() => onView(device)}><Eye size={16} /></button><button className="icon-button" aria-label={`编辑${device.name}`} onClick={() => onEdit(device)}><Pencil size={16} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function CostManagement({
  devices,
  entries,
  tab,
  setTab,
  currentDeviceId,
  setCurrentDeviceId,
  currentDevice,
  onLabor,
  onConsumable,
  onFixed,
}: {
  devices: Device[];
  entries: CostEntry[];
  tab: CostTab;
  setTab: (tab: CostTab) => void;
  currentDeviceId: string;
  setCurrentDeviceId: (id: string) => void;
  currentDevice?: Device;
  onLabor: (event: FormEvent<HTMLFormElement>) => void;
  onConsumable: (event: FormEvent<HTMLFormElement>) => void;
  onFixed: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const laborTotal = devices.reduce((sum, device) => sum + device.cost.labor, 0);
  const materialTotal = devices.reduce((sum, device) => sum + device.cost.consumables, 0);
  const fixedTotal = devices.reduce((sum, device) => sum + device.cost.depreciation + device.cost.maintenance + device.cost.energy + device.cost.space + device.cost.indirect, 0);

  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow"><CircleDollarSign size={15} />全成本核算</div><h1>成本填报中心</h1><p>按设备、期间和成本项目填写人工、耗材及固定运行成本，并保留填报记录。</p></div>
        <span className="page-badge"><CheckCircle2 size={16} />2026-V1.3 口径</span>
      </div>
      <div className="admin-stats cost-stats">
        <div><span>人工成本</span><strong>{currency.format(laborTotal)}</strong><small>万元 / 年</small></div>
        <div><span>耗材试剂</span><strong>{currency.format(materialTotal)}</strong><small>万元 / 年</small></div>
        <div><span>固定运行成本</span><strong>{currency.format(fixedTotal)}</strong><small>万元 / 年</small></div>
        <div><span>本月填报</span><strong>{entries.length}</strong><small>条记录</small></div>
      </div>
      <div className="cost-workspace">
        <Panel title="新增成本记录" description="保存后立即计入设备全成本">
          <div className="tab-list">
            <button className={tab === "labor" ? "active" : ""} onClick={() => setTab("labor")}><Users size={16} />人工成本</button>
            <button className={tab === "consumables" ? "active" : ""} onClick={() => setTab("consumables")}><Boxes size={16} />耗材/试剂</button>
            <button className={tab === "fixed" ? "active" : ""} onClick={() => setTab("fixed")}><Wrench size={16} />固定成本</button>
          </div>
          {tab === "labor" ? (
            <form className="entry-form" onSubmit={onLabor}>
              <FormSelect name="deviceId" label="归属设备" defaultValue={currentDeviceId} onChange={(value) => setCurrentDeviceId(value)} options={devices.map((device) => ({ value: device.id, label: `${device.shortName} · ${device.department}` }))} />
              <FormInput name="period" label="核算期间" type="month" defaultValue="2026-07" required />
              <FormInput name="role" label="岗位/人员类型" placeholder="例如：影像技师" required />
              <div className="form-row three"><FormInput name="headcount" label="投入人数" type="number" min="0" step="1" suffix="人" required /><FormInput name="hours" label="月均工时" type="number" min="0" step="0.5" suffix="小时" required /><FormInput name="hourlyCost" label="小时成本" type="number" min="0" step="0.01" suffix="元" required /></div>
              <div className="formula-hint"><CircleDollarSign size={16} /><span>系统计算：人数 × 工时 × 小时成本 ÷ 10,000 = 本期人工成本（万元）</span></div>
              <button className="primary-button submit-button" type="submit"><Save size={17} />保存人工成本</button>
            </form>
          ) : null}
          {tab === "consumables" ? (
            <form className="entry-form" onSubmit={onConsumable}>
              <FormSelect name="deviceId" label="归属设备" defaultValue={currentDeviceId} onChange={(value) => setCurrentDeviceId(value)} options={devices.map((device) => ({ value: device.id, label: `${device.shortName} · ${device.department}` }))} />
              <FormInput name="period" label="核算期间" type="month" defaultValue="2026-07" required />
              <FormInput name="item" label="耗材/试剂名称" placeholder="例如：增强扫描造影剂" required />
              <div className="form-row three"><FormInput name="quantity" label="使用数量" type="number" min="0" step="0.01" required /><FormInput name="unit" label="计量单位" placeholder="盒/套/支" required /><FormInput name="unitPrice" label="单位成本" type="number" min="0" step="0.01" suffix="元" required /></div>
              <FormSelect name="chargeMode" label="收费属性" defaultValue="不可单独收费" options={[{ value: "不可单独收费", label: "不可单独收费" }, { value: "可单独收费", label: "可单独收费" }]} />
              <div className="formula-hint"><Boxes size={16} /><span>可单独收费与不可单独收费耗材分别记录，便于核对收入归因和医保口径。</span></div>
              <button className="primary-button submit-button" type="submit"><Save size={17} />保存耗材成本</button>
            </form>
          ) : null}
          {tab === "fixed" && currentDevice ? (
            <form className="entry-form" onSubmit={onFixed} key={currentDevice.id}>
              <FormSelect name="deviceId" label="归属设备" defaultValue={currentDeviceId} onChange={(value) => setCurrentDeviceId(value)} options={devices.map((device) => ({ value: device.id, label: `${device.shortName} · ${device.department}` }))} />
              <div className="form-row two"><FormInput name="depreciation" label="年度折旧费" type="number" min="0" step="0.01" suffix="万元" defaultValue={currentDevice.cost.depreciation} /><FormInput name="maintenance" label="维修维保费" type="number" min="0" step="0.01" suffix="万元" defaultValue={currentDevice.cost.maintenance} /></div>
              <div className="form-row two"><FormInput name="energy" label="水电气与能耗" type="number" min="0" step="0.01" suffix="万元" defaultValue={currentDevice.cost.energy} /><FormInput name="space" label="房屋及配套" type="number" min="0" step="0.01" suffix="万元" defaultValue={currentDevice.cost.space} /></div>
              <FormInput name="indirect" label="间接管理成本" type="number" min="0" step="0.01" suffix="万元" defaultValue={currentDevice.cost.indirect} />
              <div className="formula-hint"><Wrench size={16} /><span>固定成本按年度口径维护；也可在数据准备中心导入财务凭证或能耗计量文件，经复核发布后归集。</span></div>
              <button className="primary-button submit-button" type="submit"><Save size={17} />保存固定成本</button>
            </form>
          ) : null}
        </Panel>
        <Panel title="填报说明" description="数据责任与审核建议">
          <div className="responsibility-list">
            <div><span className="responsibility-icon blue"><Users size={17} /></span><span><strong>人工成本</strong><small>人力资源部提供薪酬口径，使用科室确认人数与工时，财务部审核。</small></span></div>
            <div><span className="responsibility-icon orange"><Boxes size={17} /></span><span><strong>耗材/试剂</strong><small>物资部或 SPD 提供出库价与数量，使用科室确认设备归属。</small></span></div>
            <div><span className="responsibility-icon violet"><Wrench size={17} /></span><span><strong>折旧与维保</strong><small>资产部、设备科和财务部按固定资产卡片及合同提供。</small></span></div>
            <div><span className="responsibility-icon green"><Database size={17} /></span><span><strong>数据管理员职责</strong><small>负责文件上传、映射、清洗与版本发布，不代替业务部门确认数据口径。</small></span></div>
          </div>
        </Panel>
      </div>
      <Panel title="最近填报记录" description="演示数据可在本机持续追加">
        <div className="table-scroll">
          <table className="data-table"><thead><tr><th>类型</th><th>归属设备</th><th>项目</th><th>计算明细</th><th>期间</th><th className="num">金额(万元)</th><th>责任科室</th><th>填报时间</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td><span className={`type-pill ${entry.type === "人工" ? "labor" : "material"}`}>{entry.type}</span></td><td>{entry.deviceName}</td><td>{entry.item}</td><td>{entry.detail}</td><td>{entry.period}</td><td className="num">{entry.amount.toFixed(2)}</td><td>{entry.owner}</td><td>{entry.createdAt}</td></tr>)}</tbody></table>
        </div>
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
  sources,
  setSources,
  notify,
}: {
  sources: typeof initialDataSources;
  setSources: Dispatch<SetStateAction<typeof initialDataSources>>;
  notify: (message: string) => void;
}) {
  const [ruleSource, setRuleSource] = useState<(typeof initialDataSources)[number] | null>(null);
  const [configSource, setConfigSource] = useState<(typeof initialDataSources)[number] | null>(null);
  const sourceCounts = sources.reduce((result, source) => ({ ...result, [source.status]: (result[source.status] ?? 0) + 1 }), {} as Record<string, number>);
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
  function saveSourceConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configSource) return;
    setSources((current) => current.map((source) => source.name === configSource.name ? configSource : source));
    setConfigSource(null);
    notify("文件责任、频率与状态已保存到医院云端");
  }
  return (
    <>
      <div className="page-heading">
        <div><div className="eyebrow"><Database size={15} />文件准备</div><h1>文件模板与指标口径</h1><p>明确每类 Excel/CSV/JSON 文件的字段、责任人、更新频率与指标计算口径；正式分析只读取审核后发布的文件快照。</p></div>
        <button className="secondary-button" onClick={downloadFieldTemplate}><FileSpreadsheet size={17} />下载文件字段模板</button>
      </div>
      <Panel title="文件数据清单" description="这里记录数据责任与更新计划；实际文件请在数据准备中心上传、清洗、复核并发布" action={<span className="chart-note">{sourceCounts["已连接"] ?? 0} 已准备 · {sourceCounts["待配置"] ?? 0} 待准备 · {sourceCounts["人工填报"] ?? 0} 人工文件</span>}>
        <div className="source-grid">
          {sources.map((source) => (
            <article className="source-card" key={source.name}>
              <div className="source-top"><span className="source-icon"><Database size={18} /></span><span className={`status-pill ${source.status === "已连接" ? "success" : source.status === "人工填报" ? "warning" : "neutral"}`}>{source.status === "已连接" ? "模板已准备" : source.status}</span></div>
              <h3>{source.category}文件</h3><p>{source.fields}</p>
              <dl><div><dt>业务责任</dt><dd>{source.owner}</dd></div><div><dt>更新频率</dt><dd>{source.frequency}</dd></div><div><dt>最近文件</dt><dd>{source.lastSync}</dd></div></dl>
              <div className="source-card-actions"><button className="secondary-button compact-action" onClick={() => setConfigSource({ ...source })}><Pencil size={14} />配置</button><button className="source-action" onClick={() => setRuleSource(source)}>查看文件规则</button></div>
            </article>
          ))}
        </div>
      </Panel>
      <Panel title="核心字段映射与责任人" description="业务部门确认字段与口径，上传文件经质量门禁和复核后才能发布">
        <div className="table-scroll"><table className="data-table"><thead><tr><th>数据域</th><th>关键字段/计算</th><th>建议文件模板</th><th>业务责任部门</th></tr></thead><tbody>{mappingRows.map((row) => <tr key={row[0]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div>
      </Panel>
      <MetricGovernanceCenter />
      {configSource ? (
        <div className="modal-backdrop source-rule-modal" role="dialog" aria-modal="true" aria-labelledby="source-config-title">
          <form className="source-rule-dialog source-config-dialog" onSubmit={saveSourceConfig}>
            <header><div><span>医院级文件配置</span><h2 id="source-config-title">{configSource.category}文件</h2></div><button type="button" className="icon-button" onClick={() => setConfigSource(null)} aria-label="关闭文件配置"><X size={18} /></button></header>
            <div className="source-rule-body">
              <label>业务责任部门<input value={configSource.owner} onChange={(event) => setConfigSource((current) => current ? { ...current, owner: event.target.value } : current)} /></label>
              <div className="form-row two"><label>更新频率<select value={configSource.frequency} onChange={(event) => setConfigSource((current) => current ? { ...current, frequency: event.target.value } : current)}><option>实时</option><option>每日</option><option>每周</option><option>每月</option><option>按需</option></select></label><label>准备状态<select value={configSource.status} onChange={(event) => setConfigSource((current) => current ? { ...current, status: event.target.value as (typeof initialDataSources)[number]["status"] } : current)}><option>待配置</option><option>人工填报</option><option value="已连接">模板已准备</option></select></label></div>
              <label>最近文件说明<input value={configSource.lastSync} onChange={(event) => setConfigSource((current) => current ? { ...current, lastSync: event.target.value } : current)} placeholder="例如：2026-07-23 月度文件或尚未准备" /></label>
              <div className="dialog-warning"><AlertTriangle size={16} />这里仅保存文件责任、频率和准备状态；不会保存任何外部系统账号或密码。</div>
            </div>
            <footer><button type="button" className="secondary-button" onClick={() => setConfigSource(null)}>取消</button><button className="primary-button"><Save size={16} />保存云端配置</button></footer>
          </form>
        </div>
      ) : null}
      {ruleSource ? (
        <div className="modal-backdrop source-rule-modal" role="dialog" aria-modal="true" aria-labelledby="source-rule-title">
          <section className="source-rule-dialog">
            <header><div><span>人工数据采集规范</span><h2 id="source-rule-title">{ruleSource.name}填报规则</h2></div><button className="icon-button" onClick={() => setRuleSource(null)} aria-label="关闭填报规则"><X size={18} /></button></header>
            <div className="source-rule-body">
              <div className="rule-summary"><span><Database size={17} /></span><div><strong>{ruleSource.fields}</strong><small>责任部门：{ruleSource.owner} · 更新频率：{ruleSource.frequency}</small></div></div>
              <ol><li><strong>下载并使用标准字段模板</strong><span>不得修改字段编码、期间格式和设备资产编号。</span></li><li><strong>业务部门完成初审</strong><span>核对数量、单价、责任科室和数据期间，避免重复填报。</span></li><li><strong>上传前执行质量校验</strong><span>空值、重复记录和异常金额进入隔离区，不直接写入正式口径。</span></li><li><strong>保留来源与复核记录</strong><span>记录填报人、复核人、文件版本和导入时间，便于审计追溯。</span></li></ol>
              <div className="dialog-warning"><AlertTriangle size={16} />正式文件请进入数据准备中心上传；发布前会保留原始快照、清洗规则、复核人与来源行。</div>
            </div>
            <footer><button className="secondary-button" onClick={() => setRuleSource(null)}>关闭</button><button className="primary-button" onClick={downloadFieldTemplate}><Download size={16} />下载字段模板</button></footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function DeviceEditor({
  draft,
  setDraft,
  editing,
  onClose,
  onSave,
}: {
  draft: Device;
  setDraft: React.Dispatch<React.SetStateAction<Device>>;
  editing: boolean;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
}) {
  const field = <K extends keyof Device>(key: K, value: Device[K]) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="editor-drawer" onSubmit={onSave}>
        <div className="editor-header"><div><span className="eyebrow">设备主数据</span><h2>{editing ? "编辑设备" : "新增设备"}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><X size={19} /></button></div>
        <div className="editor-body">
          <h3>基础信息</h3>
          <FormInput label="设备名称" value={draft.name} onChange={(value) => field("name", value)} required />
          <div className="form-row two"><FormInput label="简称" value={draft.shortName} onChange={(value) => field("shortName", value)} required /><FormInput label="资产编号" value={draft.assetCode} onChange={(value) => field("assetCode", value)} required /></div>
          <div className="form-row two"><FormInput label="规格型号" value={draft.model} onChange={(value) => field("model", value)} /><FormInput label="使用科室" value={draft.department} onChange={(value) => field("department", value)} required /></div>
          <div className="form-row two"><FormInput label="设备类别" value={draft.category ?? ""} onChange={(value) => field("category", value)} placeholder="例如：诊断类（放射）" /><FormInput label="生产厂家 / 品牌" value={draft.manufacturer ?? ""} onChange={(value) => field("manufacturer", value)} /></div>
          <div className="form-row two"><FormInput label="出厂编号 / SN" value={draft.serialNumber ?? ""} onChange={(value) => field("serialNumber", value)} /><FormInput label="安装地点" value={draft.location ?? ""} onChange={(value) => field("location", value)} /></div>
          <div className="form-row two"><FormInput label="启用日期" type="date" value={draft.enabledDate} onChange={(value) => field("enabledDate", value)} /><FormInput label="数量" type="number" value={draft.quantity} onChange={(value) => field("quantity", Number(value))} suffix="台" /></div>
          <h3>报告与全生命周期档案</h3>
          <div className="form-row two"><FormInput label="资金来源" value={draft.fundingSource ?? ""} onChange={(value) => field("fundingSource", value)} /><FormInput label="预计使用年限" type="number" value={draft.usefulLifeYears ?? 8} onChange={(value) => field("usefulLifeYears", Number(value))} suffix="年" /></div>
          <div className="form-row two"><FormInput label="折旧方法" value={draft.depreciationMethod ?? ""} onChange={(value) => field("depreciationMethod", value)} /><FormInput label="配置证 / 许可信息" value={draft.licenseNumber ?? ""} onChange={(value) => field("licenseNumber", value)} /></div>
          <div className="form-row two"><FormInput label="维保状态" value={draft.maintenanceStatus ?? ""} onChange={(value) => field("maintenanceStatus", value)} /><FormInput label="数据监测状态" value={draft.monitoringStatus ?? ""} onChange={(value) => field("monitoringStatus", value)} /></div>
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
}) {
  return (
    <label className="form-field"><span>{label}{required ? <b>*</b> : null}</span><div className="input-wrap"><input name={name} type={type} value={value} defaultValue={defaultValue} onChange={onChange ? (event) => onChange(event.target.value) : undefined} placeholder={placeholder} required={required} min={min} step={step} />{suffix ? <i>{suffix}</i> : null}</div></label>
  );
}

function FormSelect({
  label,
  name,
  options,
  defaultValue,
  onChange,
}: {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  return <label className="form-field"><span>{label}</span><select name={name} defaultValue={defaultValue} onChange={onChange ? (event) => onChange(event.target.value) : undefined}>{options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>;
}
