import type { BenefitAnalysisProfile } from "./benefit-analysis-config";
import type { ImprovementAction } from "./ImprovementCenter";
import type { LedgerFieldDefinition } from "./device-ledger-fields";
import type { ChartTemplate, MetricCockpitConfigState } from "./chart-template-catalog";
import type { DeviceReportRecord, ReportFieldDefinition } from "./device-report-fields";
import type { MetricCategory, MetricDictionaryEntry } from "./metric-dictionary";
import type { CostEntry, DashboardModule, DataSource, Device } from "./mock-data";

export type CloudResource =
  | "devices"
  | "costEntries"
  | "improvementActions"
  | "modules"
  | "dataSources"
  | "analysisProfiles"
  | "ledgerFields"
  | "metricDictionary"
  | "metricCategories"
  | "deviceReports"
  | "reportFields"
  | "chartTemplates"
  | "metricCockpit";

export type CloudSharedState = {
  devices: Device[];
  costEntries: CostEntry[];
  improvementActions: ImprovementAction[];
  modules: DashboardModule[];
  dataSources: DataSource[];
  analysisProfiles: BenefitAnalysisProfile[];
  ledgerFields: LedgerFieldDefinition[];
  metricDictionary: MetricDictionaryEntry[];
  metricCategories: MetricCategory[];
  deviceReports: DeviceReportRecord[];
  reportFields: ReportFieldDefinition[];
  chartTemplates: ChartTemplate[];
  /** 驾驶舱配置只有一份，但云端资源统一按数组存，取第 0 条 */
  metricCockpit: MetricCockpitConfigState[];
};

export type CloudResourceRevisions = Record<CloudResource, number>;

export type CloudUserPreferences = {
  theme?: "clinical" | "teal" | "midnight";
  density?: "comfortable" | "compact";
  contentZoom?: number;
  activeHospitalId?: string;
  department?: string;
  period?: string;
  perspective?: "管理层" | "设备科" | "临床科室";
};

export type CloudStateResponse = {
  initialized: boolean;
  missingResources: CloudResource[];
  shared: CloudSharedState;
  revisions: CloudResourceRevisions;
  preferences: CloudUserPreferences;
  updatedAt: string | null;
};

export type CloudResourceWriteRequest = {
  hospitalId: string;
  resource: CloudResource;
  value: unknown[];
  baseRevision: number;
};

export type CloudRevisionConflictResponse = {
  error: "revision_conflict";
  resource: CloudResource;
  expectedRevision: number;
  currentRevision: number;
  currentValue: unknown[];
};

export type CloudSyncState = "idle" | "loading" | "ready" | "saving" | "error";
