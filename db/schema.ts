import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const hospitals = sqliteTable("hospitals", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  level: text("level").notNull().default("未定级"),
  category: text("category").notNull().default("未设置"),
  assetCodePrefix: text("asset_code_prefix").notNull().default(""),
  region: text("region").notNull().default("未设置"),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("hospitals_code_unique").on(table.code)]);

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("accounts_email_unique").on(table.email)]);

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").references(() => hospitals.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  dataScope: text("data_scope", { enum: ["platform", "hospital", "department", "self"] }).notNull(),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("roles_hospital_code_unique").on(table.hospitalId, table.code)]);

export const permissions = sqliteTable("permissions", {
  code: text("code").primaryKey(),
  module: text("module").notNull(),
  name: text("name").notNull(),
  risk: text("risk", { enum: ["low", "medium", "high"] }).notNull().default("low"),
});

export const rolePermissions = sqliteTable("role_permissions", {
  roleId: text("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionCode: text("permission_code").notNull().references(() => permissions.code, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.roleId, table.permissionCode] })]);

export const hospitalMemberships = sqliteTable("hospital_memberships", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  roleId: text("role_id").notNull().references(() => roles.id),
  departmentScope: text("department_scope").notNull().default("[]"),
  status: text("status", { enum: ["active", "disabled", "pending"] }).notNull().default("active"),
  validUntil: text("valid_until"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("memberships_account_hospital_unique").on(table.accountId, table.hospitalId)]);

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hospitalId: text("hospital_id").references(() => hospitals.id),
  actorAccountId: text("actor_account_id").references(() => accounts.id),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  result: text("result", { enum: ["allowed", "denied"] }).notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditPolicies = sqliteTable("audit_policies", {
  hospitalId: text("hospital_id").primaryKey().references(() => hospitals.id, { onDelete: "cascade" }),
  retentionDays: integer("retention_days").notNull().default(365),
  reviewCycleMonths: integer("review_cycle_months").notNull().default(3),
  invitationExpiryDays: integer("invitation_expiry_days").notNull().default(7),
  denialAlertThreshold: integer("denial_alert_threshold").notNull().default(5),
  exportFormat: text("export_format", { enum: ["csv", "xlsx"] }).notNull().default("csv"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reportTemplates = sqliteTable("report_templates", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  configJson: text("config_json").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdByAccountId: text("created_by_account_id").references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("report_templates_hospital_name_unique").on(table.hospitalId, table.name),
  uniqueIndex("report_templates_one_default_per_hospital")
    .on(table.hospitalId)
    .where(sql`${table.isDefault} = 1`),
]);

export const benefitReports = sqliteTable("benefit_reports", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  seriesId: text("series_id").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status", { enum: ["draft", "pending_review", "approved", "issued", "rejected"] }).notNull().default("draft"),
  title: text("title").notNull(),
  period: text("period").notNull(),
  scope: text("scope", { enum: ["hospital", "category", "device"] }).notNull().default("hospital"),
  configJson: text("config_json").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  qualityScore: integer("quality_score").notNull().default(0),
  blockingCount: integer("blocking_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  warningAcknowledged: integer("warning_acknowledged", { mode: "boolean" }).notNull().default(false),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  reviewedByAccountId: text("reviewed_by_account_id").references(() => accounts.id),
  approvedByAccountId: text("approved_by_account_id").references(() => accounts.id),
  reviewComment: text("review_comment").notNull().default(""),
  submittedAt: text("submitted_at"),
  reviewedAt: text("reviewed_at"),
  issuedAt: text("issued_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("benefit_reports_series_version_unique").on(table.seriesId, table.version)]);

export const reportEvents = sqliteTable("report_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  reportId: text("report_id").references(() => benefitReports.id, { onDelete: "cascade" }),
  actorAccountId: text("actor_account_id").references(() => accounts.id),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const reportArtifacts = sqliteTable("report_artifacts", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  reportId: text("report_id").references(() => benefitReports.id, { onDelete: "set null" }),
  actorAccountId: text("actor_account_id").references(() => accounts.id, { onDelete: "set null" }),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("report_artifacts_file_key_unique").on(table.fileKey)]);

export const hospitalCloudResources = sqliteTable("hospital_cloud_resources", {
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  resource: text("resource", {
    enum: ["devices", "costEntries", "notifications", "improvementActions", "modules", "dataSources", "analysisProfiles", "ledgerFields", "metricDictionary", "metricCategories"],
  }).notNull(),
  valueJson: text("value_json").notNull().default("[]"),
  revision: integer("revision").notNull().default(1),
  schemaVersion: integer("schema_version").notNull().default(1),
  updatedByAccountId: text("updated_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.hospitalId, table.resource] })]);

export const accountCloudPreferences = sqliteTable("account_cloud_preferences", {
  accountId: text("account_id").primaryKey().references(() => accounts.id, { onDelete: "cascade" }),
  theme: text("theme", { enum: ["clinical", "teal", "midnight"] }).notNull().default("clinical"),
  density: text("density", { enum: ["comfortable", "compact"] }).notNull().default("comfortable"),
  contentZoom: real("content_zoom").notNull().default(1.1),
  notificationPreferencesJson: text("notification_preferences_json").notNull().default("{}"),
  readNotificationIdsJson: text("read_notification_ids_json").notNull().default("[]"),
  activeHospitalId: text("active_hospital_id").references(() => hospitals.id, { onDelete: "set null" }),
  department: text("department").notNull().default("全部科室"),
  period: text("period").notNull().default("2026年度"),
  perspective: text("perspective", { enum: ["管理层", "设备科", "临床科室"] }).notNull().default("管理层"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const dataSourceConnectors = sqliteTable("data_source_connectors", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  sourceType: text("source_type", { enum: ["HIS", "PACS", "RIS", "LIS", "HRP", "CMMS", "IoT", "file", "manual", "other"] }).notNull(),
  transportType: text("transport_type", { enum: ["HL7", "DICOM", "FHIR", "REST", "SFTP", "database", "file", "manual", "other"] }).notNull(),
  endpoint: text("endpoint").notNull().default(""),
  credentialRef: text("credential_ref").notNull().default(""),
  metadataJson: text("metadata_json").notNull().default("{}"),
  status: text("status", { enum: ["draft", "active", "disabled", "error"] }).notNull().default("draft"),
  revision: integer("revision").notNull().default(1),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  updatedByAccountId: text("updated_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_source_connectors_hospital_code_unique").on(table.hospitalId, table.code),
  index("data_source_connectors_hospital_status_idx").on(table.hospitalId, table.status),
]);

export const dataImportJobs = sqliteTable("data_import_jobs", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  connectorId: text("connector_id").references(() => dataSourceConnectors.id, { onDelete: "set null" }),
  dataDomain: text("data_domain").notNull(),
  ingestionMode: text("ingestion_mode", { enum: ["api", "file", "manual"] }).notNull(),
  fileName: text("file_name").notNull().default(""),
  objectKey: text("object_key").notNull().default(""),
  sha256: text("sha256").notNull().default(""),
  status: text("status", { enum: ["uploading", "pending_mapping", "validating", "pending_review", "ready", "published", "failed", "withdrawn", "superseded"] }).notNull().default("uploading"),
  rowCount: integer("row_count").notNull().default(0),
  acceptedCount: integer("accepted_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  errorCode: text("error_code").notNull().default(""),
  businessTemplateCode: text("business_template_code").notNull().default("generic"),
  selectedSheet: text("selected_sheet").notNull().default(""),
  headerRow: integer("header_row").notNull().default(1),
  parserConfigJson: text("parser_config_json").notNull().default("{}"),
  idempotencyKey: text("idempotency_key").notNull().default(""),
  revision: integer("revision").notNull().default(1),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  reviewedByAccountId: text("reviewed_by_account_id").references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("data_import_jobs_hospital_status_idx").on(table.hospitalId, table.status),
  index("data_import_jobs_hospital_domain_idx").on(table.hospitalId, table.dataDomain),
  uniqueIndex("data_import_jobs_hospital_idempotency_unique").on(table.hospitalId, table.idempotencyKey).where(sql`${table.idempotencyKey} <> ''`),
]);

export const rawDatasets = sqliteTable("raw_datasets", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  importJobId: text("import_job_id").notNull().references(() => dataImportJobs.id, { onDelete: "cascade" }),
  connectorId: text("connector_id").references(() => dataSourceConnectors.id, { onDelete: "set null" }),
  objectKey: text("object_key").notNull().default(""),
  contentType: text("content_type").notNull().default("application/octet-stream"),
  sizeBytes: integer("size_bytes").notNull().default(0),
  sha256: text("sha256").notNull().default(""),
  rowCount: integer("row_count").notNull().default(0),
  schemaJson: text("schema_json").notNull().default("{}"),
  profileJson: text("profile_json").notNull().default("{}"),
  retentionUntil: text("retention_until"),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("raw_datasets_hospital_job_unique").on(table.hospitalId, table.importJobId),
  index("raw_datasets_hospital_created_idx").on(table.hospitalId, table.createdAt),
]);

export const dataFieldMappings = sqliteTable("data_field_mappings", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  connectorId: text("connector_id").references(() => dataSourceConnectors.id, { onDelete: "set null" }),
  dataDomain: text("data_domain").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  mappingJson: text("mapping_json").notNull(),
  status: text("status", { enum: ["draft", "active", "retired"] }).notNull().default("draft"),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  updatedByAccountId: text("updated_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_field_mappings_hospital_domain_version_unique").on(table.hospitalId, table.dataDomain, table.name, table.version),
  index("data_field_mappings_hospital_status_idx").on(table.hospitalId, table.status),
]);

export const dataFieldDefinitions = sqliteTable("data_field_definitions", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  dataType: text("data_type", { enum: ["string", "integer", "decimal", "boolean", "date", "datetime", "code", "json"] }).notNull(),
  unit: text("unit").notNull().default(""),
  dictionaryJson: text("dictionary_json").notNull().default("{}"),
  validationJson: text("validation_json").notNull().default("{}"),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["draft", "active", "retired"] }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  updatedByAccountId: text("updated_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_field_definitions_hospital_code_version_unique").on(table.hospitalId, table.code, table.version),
  index("data_field_definitions_hospital_status_idx").on(table.hospitalId, table.status),
]);

export const dataMetricDefinitions = sqliteTable("data_metric_definitions", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  formula: text("formula").notNull(),
  aggregation: text("aggregation", { enum: ["sum", "avg", "min", "max", "count", "distinct_count", "ratio", "custom"] }).notNull(),
  numerator: text("numerator").notNull().default(""),
  denominator: text("denominator").notNull().default(""),
  dimensionsJson: text("dimensions_json").notNull().default("[]"),
  sourceFieldRefsJson: text("source_field_refs_json").notNull().default("[]"),
  unit: text("unit").notNull().default(""),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["draft", "active", "retired"] }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  updatedByAccountId: text("updated_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_metric_definitions_hospital_code_version_unique").on(table.hospitalId, table.code, table.version),
  index("data_metric_definitions_hospital_status_idx").on(table.hospitalId, table.status),
]);

export const dataVisualizationDefinitions = sqliteTable("data_visualization_definitions", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  metricId: text("metric_id").notNull().references(() => dataMetricDefinitions.id, { onDelete: "cascade" }),
  chartType: text("chart_type").notNull(),
  dimension: text("dimension").notNull().default(""),
  seriesJson: text("series_json").notNull().default("[]"),
  sortJson: text("sort_json").notNull().default("{}"),
  limit: integer("limit").notNull().default(20),
  configJson: text("config_json").notNull().default("{}"),
  status: text("status", { enum: ["draft", "active", "retired"] }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  updatedByAccountId: text("updated_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_visualizations_hospital_code_version_unique").on(table.hospitalId, table.code, table.version),
  index("data_visualizations_hospital_metric_idx").on(table.hospitalId, table.metricId),
]);

export const dataBusinessTemplates = sqliteTable("data_business_templates", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").references(() => hospitals.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  dataDomain: text("data_domain").notNull(),
  fileTypesJson: text("file_types_json").notNull().default("[\"xlsx\",\"csv\",\"json\"]"),
  requiredFieldsJson: text("required_fields_json").notNull().default("[]"),
  optionalFieldsJson: text("optional_fields_json").notNull().default("[]"),
  aliasesJson: text("aliases_json").notNull().default("{}"),
  validationJson: text("validation_json").notNull().default("{}"),
  defaultHeaderRow: integer("default_header_row").notNull().default(1),
  status: text("status", { enum: ["draft", "active", "retired"] }).notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdByAccountId: text("created_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
  updatedByAccountId: text("updated_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_business_templates_hospital_code_version_unique").on(table.hospitalId, table.code, table.version),
  index("data_business_templates_hospital_status_idx").on(table.hospitalId, table.status),
]);

export const dataDatasetSnapshots = sqliteTable("data_dataset_snapshots", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  importJobId: text("import_job_id").references(() => dataImportJobs.id, { onDelete: "set null" }),
  layer: text("layer", { enum: ["raw", "staging", "curated", "published"] }).notNull(),
  version: integer("version").notNull().default(1),
  status: text("status", { enum: ["building", "ready", "published", "failed", "withdrawn", "superseded"] }).notNull().default("building"),
  objectKey: text("object_key").notNull(),
  sha256: text("sha256").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  rowCount: integer("row_count").notNull(),
  headersJson: text("headers_json").notNull().default("[]"),
  profileJson: text("profile_json").notNull().default("{}"),
  parentSnapshotId: text("parent_snapshot_id"),
  mappingId: text("mapping_id").references(() => dataFieldMappings.id, { onDelete: "set null" }),
  recipeId: text("recipe_id").references(() => dataCleaningRecipes.id, { onDelete: "set null" }),
  mappingVersion: text("mapping_version").notNull().default(""),
  ruleVersion: text("rule_version").notNull().default(""),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_dataset_snapshots_hospital_object_unique").on(table.hospitalId, table.objectKey),
  index("data_dataset_snapshots_hospital_layer_idx").on(table.hospitalId, table.layer, table.status),
  index("data_dataset_snapshots_import_idx").on(table.hospitalId, table.importJobId, table.version),
]);

export const dataPipelineRecords = sqliteTable("data_pipeline_records", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").notNull().references(() => dataDatasetSnapshots.id, { onDelete: "cascade" }),
  sourceRowNumber: integer("source_row_number").notNull(),
  sourceRecordId: text("source_record_id").notNull(),
  recordJson: text("record_json").notNull(),
  recordSha256: text("record_sha256").notNull(),
  status: text("status", { enum: ["valid", "quarantined", "excluded"] }).notNull().default("valid"),
  errorCount: integer("error_count").notNull().default(0),
  revision: integer("revision").notNull().default(1),
  updatedByAccountId: text("updated_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_pipeline_records_snapshot_source_unique").on(table.snapshotId, table.sourceRowNumber),
  index("data_pipeline_records_hospital_snapshot_status_idx").on(table.hospitalId, table.snapshotId, table.status),
]);

export const dataRecordIssues = sqliteTable("data_record_issues", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  snapshotId: text("snapshot_id").notNull().references(() => dataDatasetSnapshots.id, { onDelete: "cascade" }),
  recordId: text("record_id").notNull().references(() => dataPipelineRecords.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull().default(""),
  ruleCode: text("rule_code").notNull(),
  severity: text("severity", { enum: ["warning", "blocker"] }).notNull(),
  status: text("status", { enum: ["open", "resolved", "waived"] }).notNull().default("open"),
  message: text("message").notNull(),
  beforeJson: text("before_json").notNull().default("null"),
  afterJson: text("after_json").notNull().default("null"),
  resolutionComment: text("resolution_comment").notNull().default(""),
  resolvedByAccountId: text("resolved_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("data_record_issues_hospital_snapshot_status_idx").on(table.hospitalId, table.snapshotId, table.status),
  index("data_record_issues_record_idx").on(table.recordId, table.status),
]);

export const dataReconciliationConfigs = sqliteTable("data_reconciliation_configs", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  leftKeyFieldsJson: text("left_key_fields_json").notNull(),
  rightKeyFieldsJson: text("right_key_fields_json").notNull(),
  compareFieldsJson: text("compare_fields_json").notNull().default("[]"),
  toleranceJson: text("tolerance_json").notNull().default("{}"),
  status: text("status", { enum: ["draft", "active", "retired"] }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  updatedByAccountId: text("updated_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_reconciliation_configs_hospital_name_version_unique").on(table.hospitalId, table.name, table.version),
]);

export const dataReconciliationRuns = sqliteTable("data_reconciliation_runs", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  configId: text("config_id").notNull().references(() => dataReconciliationConfigs.id),
  leftSnapshotId: text("left_snapshot_id").notNull().references(() => dataDatasetSnapshots.id),
  rightSnapshotId: text("right_snapshot_id").notNull().references(() => dataDatasetSnapshots.id),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull().default("running"),
  matchedCount: integer("matched_count").notNull().default(0),
  leftOnlyCount: integer("left_only_count").notNull().default(0),
  rightOnlyCount: integer("right_only_count").notNull().default(0),
  mismatchCount: integer("mismatch_count").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
}, (table) => [
  uniqueIndex("data_reconciliation_runs_hospital_idempotency_unique").on(table.hospitalId, table.idempotencyKey),
  index("data_reconciliation_runs_hospital_created_idx").on(table.hospitalId, table.createdAt),
]);

export const dataReconciliationDifferences = sqliteTable("data_reconciliation_differences", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  runId: text("run_id").notNull().references(() => dataReconciliationRuns.id, { onDelete: "cascade" }),
  matchKey: text("match_key").notNull(),
  differenceType: text("difference_type", { enum: ["left_only", "right_only", "value_mismatch"] }).notNull(),
  fieldName: text("field_name").notNull().default(""),
  leftRecordId: text("left_record_id").references(() => dataPipelineRecords.id, { onDelete: "set null" }),
  rightRecordId: text("right_record_id").references(() => dataPipelineRecords.id, { onDelete: "set null" }),
  leftValueJson: text("left_value_json").notNull().default("null"),
  rightValueJson: text("right_value_json").notNull().default("null"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("data_reconciliation_differences_run_idx").on(table.hospitalId, table.runId, table.differenceType),
]);

export const dataReviewEvents = sqliteTable("data_review_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  decision: text("decision", { enum: ["submit", "approve", "reject", "waive", "break_glass", "rollback"] }).notNull(),
  actorAccountId: text("actor_account_id").notNull().references(() => accounts.id),
  comment: text("comment").notNull().default(""),
  breakGlassReason: text("break_glass_reason").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("data_review_events_hospital_resource_idx").on(table.hospitalId, table.resourceType, table.resourceId, table.createdAt),
]);

export const dataPipelineIdempotency = sqliteTable("data_pipeline_idempotency", {
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestSha256: text("request_sha256").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  responseJson: text("response_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.hospitalId, table.action, table.idempotencyKey] })]);

export const dataExamEvents = sqliteTable("data_exam_events", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  importJobId: text("import_job_id").references(() => dataImportJobs.id, { onDelete: "set null" }),
  sourceEventKey: text("source_event_key").notNull(),
  deviceKey: text("device_key").notNull(),
  encounterKey: text("encounter_key").notNull().default(""),
  patientKey: text("patient_key").notNull().default(""),
  occurredAt: text("occurred_at").notNull(),
  revenueCents: integer("revenue_cents").notNull().default(0),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_exam_events_hospital_source_key_unique").on(table.hospitalId, table.sourceEventKey),
  index("data_exam_events_hospital_occurred_idx").on(table.hospitalId, table.occurredAt),
]);

export const dataExamEventBodyParts = sqliteTable("data_exam_event_body_parts", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  examEventId: text("exam_event_id").notNull().references(() => dataExamEvents.id, { onDelete: "cascade" }),
  bodyPartCode: text("body_part_code").notNull(),
  bodyPartName: text("body_part_name").notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  sequence: integer("sequence").notNull().default(1),
  weight: real("weight").notNull().default(1),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_exam_body_parts_event_code_unique").on(table.examEventId, table.bodyPartCode),
  uniqueIndex("data_exam_body_parts_one_primary_unique").on(table.examEventId).where(sql`${table.isPrimary} = 1`),
  index("data_exam_body_parts_hospital_event_idx").on(table.hospitalId, table.examEventId),
]);

export const dataCleaningRecipes = sqliteTable("data_cleaning_recipes", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  dataDomain: text("data_domain").notNull(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status", { enum: ["draft", "active", "retired"] }).notNull().default("draft"),
  description: text("description").notNull().default(""),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  updatedByAccountId: text("updated_by_account_id").notNull().references(() => accounts.id),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_cleaning_recipes_hospital_name_version_unique").on(table.hospitalId, table.dataDomain, table.name, table.version),
]);

export const dataCleaningRules = sqliteTable("data_cleaning_rules", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  recipeId: text("recipe_id").notNull().references(() => dataCleaningRecipes.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  ruleType: text("rule_type").notNull(),
  fieldName: text("field_name").notNull().default(""),
  configJson: text("config_json").notNull().default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_cleaning_rules_recipe_sequence_unique").on(table.recipeId, table.sequence),
  index("data_cleaning_rules_hospital_recipe_idx").on(table.hospitalId, table.recipeId),
]);

export const dataQualityIssues = sqliteTable("data_quality_issues", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  importJobId: text("import_job_id").references(() => dataImportJobs.id, { onDelete: "cascade" }),
  rawDatasetId: text("raw_dataset_id").references(() => rawDatasets.id, { onDelete: "cascade" }),
  ruleCode: text("rule_code").notNull(),
  fieldName: text("field_name").notNull().default(""),
  severity: text("severity", { enum: ["info", "warning", "blocker"] }).notNull(),
  status: text("status", { enum: ["open", "acknowledged", "resolved", "waived"] }).notNull().default("open"),
  affectedRows: integer("affected_rows").notNull().default(0),
  message: text("message").notNull(),
  sampleJson: text("sample_json").notNull().default("[]"),
  resolutionComment: text("resolution_comment").notNull().default(""),
  resolvedByAccountId: text("resolved_by_account_id").references(() => accounts.id),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("data_quality_issues_hospital_status_idx").on(table.hospitalId, table.status),
  index("data_quality_issues_hospital_job_idx").on(table.hospitalId, table.importJobId),
]);

export const dataPublishVersions = sqliteTable("data_publish_versions", {
  id: text("id").primaryKey(),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  seriesId: text("series_id").notNull(),
  version: integer("version").notNull().default(1),
  dataDomain: text("data_domain").notNull(),
  status: text("status", { enum: ["draft", "pending_review", "approved", "rejected", "published", "withdrawn", "superseded"] }).notNull().default("draft"),
  sourceImportIdsJson: text("source_import_ids_json").notNull().default("[]"),
  manifestJson: text("manifest_json").notNull().default("{}"),
  rowCount: integer("row_count").notNull().default(0),
  mappingVersion: text("mapping_version").notNull().default(""),
  ruleVersion: text("rule_version").notNull().default(""),
  curatedSnapshotId: text("curated_snapshot_id").references(() => dataDatasetSnapshots.id, { onDelete: "set null" }),
  publishedSnapshotId: text("published_snapshot_id").references(() => dataDatasetSnapshots.id, { onDelete: "set null" }),
  snapshotSha256: text("snapshot_sha256").notNull().default(""),
  correctionOfId: text("correction_of_id"),
  rollbackOfId: text("rollback_of_id"),
  idempotencyKey: text("idempotency_key").notNull().default(""),
  reviewComment: text("review_comment").notNull().default(""),
  createdByAccountId: text("created_by_account_id").notNull().references(() => accounts.id),
  reviewedByAccountId: text("reviewed_by_account_id").references(() => accounts.id),
  publishedByAccountId: text("published_by_account_id").references(() => accounts.id),
  reviewedAt: text("reviewed_at"),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("data_publish_versions_hospital_series_version_unique").on(table.hospitalId, table.seriesId, table.version),
  index("data_publish_versions_hospital_status_idx").on(table.hospitalId, table.status),
  uniqueIndex("data_publish_versions_one_active_series_unique").on(table.hospitalId, table.seriesId).where(sql`${table.status} = 'published'`),
  uniqueIndex("data_publish_versions_hospital_idempotency_unique").on(table.hospitalId, table.idempotencyKey).where(sql`${table.idempotencyKey} <> ''`),
]);

export const dataLineageEvents = sqliteTable("data_lineage_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  hospitalId: text("hospital_id").notNull().references(() => hospitals.id, { onDelete: "cascade" }),
  actorAccountId: text("actor_account_id").references(() => accounts.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  fromStatus: text("from_status").notNull().default(""),
  toStatus: text("to_status").notNull().default(""),
  importJobId: text("import_job_id").references(() => dataImportJobs.id, { onDelete: "set null" }),
  datasetVersion: text("dataset_version").notNull().default(""),
  mappingVersion: text("mapping_version").notNull().default(""),
  ruleVersion: text("rule_version").notNull().default(""),
  detailJson: text("detail_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("data_lineage_events_hospital_created_idx").on(table.hospitalId, table.createdAt),
  index("data_lineage_events_hospital_resource_idx").on(table.hospitalId, table.resourceType, table.resourceId),
]);

export const accountCredentials = sqliteTable("account_credentials", {
  accountId: text("account_id").primaryKey().references(() => accounts.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  iterations: integer("iterations").notNull().default(210000),
  algorithm: text("algorithm").notNull().default("pbkdf2-sha256"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  passwordUpdatedAt: text("password_updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("account_credentials_username_unique").on(table.username)]);

export const appSessions = sqliteTable("app_sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  accountId: text("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  ssoEmail: text("sso_email").notNull(),
  authMethod: text("auth_method", { enum: ["sso", "password"] }).notNull().default("sso"),
  status: text("status", { enum: ["active", "locked", "revoked"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  idleExpiresAt: text("idle_expires_at").notNull(),
  absoluteExpiresAt: text("absolute_expires_at").notNull(),
  lockedAt: text("locked_at"),
  revokedAt: text("revoked_at"),
}, (table) => [
  uniqueIndex("app_sessions_token_hash_unique").on(table.tokenHash),
  index("app_sessions_account_status_idx").on(table.accountId, table.status),
]);
