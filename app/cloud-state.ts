import type { NotificationPreferences } from "./AccountCenter";
import type { BenefitAnalysisProfile } from "./benefit-analysis-config";
import type { ImprovementAction } from "./ImprovementCenter";
import type { LedgerFieldDefinition } from "./device-ledger-fields";
import type { CostEntry, DashboardModule, DataSource, Device } from "./mock-data";
import type { PlatformNotification } from "./notification-data";

export type CloudResource =
  | "devices"
  | "costEntries"
  | "notifications"
  | "improvementActions"
  | "modules"
  | "dataSources"
  | "analysisProfiles"
  | "ledgerFields";

export type CloudSharedState = {
  devices: Device[];
  costEntries: CostEntry[];
  notifications: PlatformNotification[];
  improvementActions: ImprovementAction[];
  modules: DashboardModule[];
  dataSources: DataSource[];
  analysisProfiles: BenefitAnalysisProfile[];
  ledgerFields: LedgerFieldDefinition[];
};

export type CloudResourceRevisions = Record<CloudResource, number>;

export type CloudUserPreferences = {
  theme?: "clinical" | "teal" | "midnight";
  density?: "comfortable" | "compact";
  contentZoom?: number;
  notificationPreferences?: NotificationPreferences;
  activeHospitalId?: string;
  department?: string;
  period?: string;
  perspective?: "管理层" | "设备科" | "临床科室";
  readNotificationIds?: string[];
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
