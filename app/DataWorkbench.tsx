"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Blocks,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CircleDot,
  Clock3,
  CloudUpload,
  Database,
  Download,
  FileClock,
  FileSpreadsheet,
  GitBranch,
  History,
  Link2,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Menu,
  PencilLine,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import styles from "./DataWorkbench.module.css";
import {
  HOSPITAL_METRIC_CATALOG_VERSION,
  hospitalMetricCatalog,
} from "./hospital-metric-catalog";
import {
  metricTemplateRegistry,
  resolveMetricTemplate,
} from "./metric-template-registry";
import {
  DATA_WORKBENCH_ENTRY_CLICKS,
  DATA_WORKBENCH_SECTIONS,
  FILE_BUSINESS_TEMPLATES,
  FILE_WORKBENCH_RESOURCE_LABELS,
  FILE_WORKBENCH_RESOURCES,
  FILE_WORKBENCH_STATE_LABELS,
  FileWorkbenchApiClient,
  WorkbenchApiError,
  buildCsvDatasetProfile,
  buildBusinessTemplateCsv,
  calculateQualitySummary,
  classifyImportFile,
  initialWorkbenchBatches,
  parseCsv,
  parseJsonRecords,
  normalizeServerCleaningImpact,
  quarantineRowsToCsv,
  reconcileFileRows,
  remoteImportToBatch,
  runCleaningPreview,
  suggestTemplateField,
  templateFields,
  type CleaningPreviewRule,
  type CsvParseResult,
  type DataWorkbenchSectionId,
  type DatasetProfile,
  type FileBusinessTemplate,
  type FileImportEnvelope,
  type FileWorkbenchResource,
  type QuarantinedPreviewRow,
  type RemoteImportRow,
  type RemotePublishRow,
  type ServerCleaningImpact,
  type WorkbenchBatch,
} from "./data-workbench-model";
import {
  SAMPLE_DATA_PACKAGE_VERSION,
  buildSampleDataCsv,
} from "./sample-data-package";

export type DataWorkbenchProps = {
  hospitalId: string;
  onExit: () => void;
  permissions: readonly string[];
  hospitalName?: string;
  apiBaseUrl?: string;
  onNotify?: (message: string) => void;
  demoMode?: boolean;
  isPlatformAdmin?: boolean;
};

type RawRow = Record<string, unknown>;
type ResourceCollections = Record<FileWorkbenchResource, RawRow[]>;
type ResourceStatus = {
  state: "loading" | "ready" | "empty" | "error";
  error?: string;
  unsupported?: boolean;
};
type ImportDraft = {
  file: File;
  rawText: string;
  parsed: CsvParseResult | null;
  profile: DatasetProfile | null;
  sha256: string;
};

const emptyCollections = Object.fromEntries(
  FILE_WORKBENCH_RESOURCES.map((resource) => [resource, []]),
) as unknown as ResourceCollections;
const loadingStatuses = Object.fromEntries(
  FILE_WORKBENCH_RESOURCES.map((resource) => [resource, { state: "loading" }]),
) as Record<FileWorkbenchResource, ResourceStatus>;
const demoStatuses = Object.fromEntries(
  FILE_WORKBENCH_RESOURCES.map((resource) => [resource, { state: "empty" }]),
) as Record<FileWorkbenchResource, ResourceStatus>;
const chartTypes = [
  { value: "kpi", label: "KPI" },
  { value: "table", label: "表格" },
  { value: "bar", label: "柱状" },
  { value: "line", label: "折线" },
  { value: "pie", label: "饼图" },
  { value: "scatter", label: "散点" },
  { value: "heatmap", label: "热力图" },
] as const;
const cleaningRules: CleaningPreviewRule[] = [
  { id: "trim", type: "trim", field: "deviceId", label: "设备编号去首尾空格" },
  {
    id: "required",
    type: "required",
    field: "deviceId",
    label: "设备编号必填",
  },
  { id: "number", type: "number", field: "amount", label: "金额必须为数字" },
  {
    id: "deduplicate",
    type: "deduplicate",
    field: "sourceRecordId",
    label: "来源记录号去重",
  },
];

const icons: Record<DataWorkbenchSectionId, React.ReactNode> = {
  overview: <Activity size={17} />,
  sources: <FileSpreadsheet size={17} />,
  imports: <CloudUpload size={17} />,
  batches: <Database size={17} />,
  mapping: <Link2 size={17} />,
  cleaning: <WandSparkles size={17} />,
  quality: <ListChecks size={17} />,
  reconciliation: <Blocks size={17} />,
  publishing: <Rocket size={17} />,
  lineage: <GitBranch size={17} />,
};

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    uploading: "上传中",
    pending_mapping: "待映射",
    validating: "清洗校验中",
    pending_review: "待审核",
    ready: "可发布",
    published: "已发布",
    failed: "失败",
    withdrawn: "已撤回",
    superseded: "历史版本",
    draft: "草稿",
    approved: "已批准",
    rejected: "已驳回",
  };
  return labels[status] ?? status;
}

function tone(status: string) {
  if (
    ["ready", "approved", "published", "已发布", "成功", "matched"].includes(
      status,
    )
  )
    return styles.success;
  if (
    [
      "failed",
      "rejected",
      "阻断",
      "error",
      "left_only",
      "right_only",
      "value_mismatch",
    ].includes(status)
  )
    return styles.danger;
  if (
    [
      "pending_mapping",
      "validating",
      "pending_review",
      "changed",
      "预警",
    ].includes(status)
  )
    return styles.warning;
  return styles.neutral;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function normalizeRows(
  rows: Array<Record<string, unknown>>,
  headers: string[],
) {
  return rows.map((row) =>
    Object.fromEntries(
      headers.map((header) => [
        header,
        row[header] === null || row[header] === undefined
          ? ""
          : String(row[header]),
      ]),
    ),
  ) as Array<Record<string, string>>;
}

function normalizeWorkbookProfile(
  value: FileImportEnvelope["workbook"]["profile"],
  fallback: DatasetProfile | null,
): DatasetProfile | null {
  if (!value) return fallback;
  const profile =
    value.profile ??
    (typeof value.rowCount === "number" && value.columns
      ? { rowCount: value.rowCount, columns: value.columns }
      : null);
  if (!profile) return fallback;
  const allowedTypes = new Set([
    "integer",
    "decimal",
    "boolean",
    "date",
    "datetime",
    "string",
  ]);
  const schema = value.schema
    ? {
        columns: value.schema.columns.map((column) => ({
          name: column.name,
          inferredType: (allowedTypes.has(column.inferredType)
            ? column.inferredType
            : "string") as DatasetProfile["schema"]["columns"][number]["inferredType"],
          nullable: column.nullable ?? !column.required,
        })),
      }
    : (fallback?.schema ?? { columns: [] });
  return { schema, profile };
}

function downloadText(
  name: string,
  content: string,
  type = "text/csv;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function suggestedMapping(headers: string[], templateCode: string) {
  return Object.fromEntries(
    headers.map((header) => [
      header,
      suggestTemplateField(templateCode, header),
    ]),
  );
}

function jsonArray(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function jsonObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function displayStoredValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value !== "string") return JSON.stringify(value);
  try {
    return JSON.stringify(JSON.parse(value) as unknown);
  } catch {
    return value;
  }
}

function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeading}>
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Heading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className={styles.pageHeading}>
      <div>
        <span className={styles.eyebrow}>
          <CircleDot size={13} />
          {eyebrow}
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </header>
  );
}

export default function DataWorkbench({
  hospitalId,
  onExit,
  permissions,
  hospitalName = "当前医院",
  apiBaseUrl = "/api/data-workbench",
  onNotify,
  demoMode = false,
  isPlatformAdmin = false,
}: DataWorkbenchProps) {
  const [section, setSection] = useState<DataWorkbenchSectionId>("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [collections, setCollections] =
    useState<ResourceCollections>(emptyCollections);
  const [resourceStatus, setResourceStatus] =
    useState<Record<FileWorkbenchResource, ResourceStatus>>(
      demoMode ? demoStatuses : loadingStatuses,
    );
  const [batches, setBatches] = useState<WorkbenchBatch[]>(
    demoMode ? initialWorkbenchBatches : [],
  );
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [importResult, setImportResult] = useState<FileImportEnvelope | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [templateCode, setTemplateCode] = useState(
    FILE_BUSINESS_TEMPLATES[0].code,
  );
  const [sheetName, setSheetName] = useState("");
  const [headerRow, setHeaderRow] = useState(1);
  const [delimiter, setDelimiter] = useState(",");
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [numberFormat, setNumberFormat] = useState("小数点 . / 无千分位");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mappingTab, setMappingTab] = useState<
    "fields" | "custom" | "metric" | "visual"
  >("fields");
  const [operation, setOperation] = useState("");
  const [samplePublishConfirm, setSamplePublishConfirm] = useState(false);
  const [cleaningPreview, setCleaningPreview] = useState<ReturnType<
    typeof runCleaningPreview
  > | null>(null);
  const [serverCleaningImpact, setServerCleaningImpact] =
    useState<ServerCleaningImpact | null>(null);
  const [repairingRow, setRepairingRow] =
    useState<QuarantinedPreviewRow | null>(null);
  const [repairValue, setRepairValue] = useState("");
  const [leftSnapshot, setLeftSnapshot] = useState("");
  const [rightSnapshot, setRightSnapshot] = useState("");
  const [keyFields, setKeyFields] = useState("设备编号");
  const [compareFields, setCompareFields] = useState("金额");
  const [localReconciliation, setLocalReconciliation] = useState<ReturnType<
    typeof reconcileFileRows
  > | null>(null);
  const [selectedChart, setSelectedChart] =
    useState<(typeof chartTypes)[number]["value"]>("kpi");
  const [fieldName, setFieldName] = useState("");
  const [fieldCode, setFieldCode] = useState("");
  const [metricName, setMetricName] = useState("");
  const [metricTemplateVersion, setMetricTemplateVersion] = useState<string>(
    HOSPITAL_METRIC_CATALOG_VERSION,
  );
  const [catalogFieldIds, setCatalogFieldIds] = useState<string[]>([]);
  const [catalogDependencyIds, setCatalogDependencyIds] = useState<string[]>(
    [],
  );
  const [recipeRules, setRecipeRules] =
    useState<CleaningPreviewRule[]>(cleaningRules);
  const [selectedPublishIds, setSelectedPublishIds] = useState<string[]>([]);
  const [correctionOfId, setCorrectionOfId] = useState("");
  const [selectedMetricIds, setSelectedMetricIds] = useState<string[]>([]);
  const [selectedVisualizationIds, setSelectedVisualizationIds] = useState<
    string[]
  >([]);
  const [allocationRule, setAllocationRule] = useState<
    "equal_by_body_part" | "weighted_by_body_part" | "primary_body_part"
  >("weighted_by_body_part");
  const [reconciliationWaiverReason, setReconciliationWaiverReason] =
    useState("");
  const [rollbackTargetId, setRollbackTargetId] = useState("");
  const [rollbackReason, setRollbackReason] = useState("");
  const [breakGlassPublishId, setBreakGlassPublishId] = useState("");
  const [breakGlassReason, setBreakGlassReason] = useState("");
  const [breakGlassStatus, setBreakGlassStatus] = useState<
    "approved" | "rejected"
  >("approved");
  const [breakGlassImportId, setBreakGlassImportId] = useState("");
  const [breakGlassImportReason, setBreakGlassImportReason] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const client = useMemo(
    () => new FileWorkbenchApiClient(apiBaseUrl, hospitalId),
    [apiBaseUrl, hospitalId],
  );
  const permissionSet = useMemo(() => new Set(permissions), [permissions]);
  const canIngest = demoMode || permissionSet.has("data.ingest");
  const canClean = demoMode || permissionSet.has("data.clean");
  const canReview = demoMode || permissionSet.has("data.review");
  const canPublish = demoMode || permissionSet.has("data.publish");
  const activatableHospitalMetricCodes = useMemo(
    () =>
      new Set(
        Object.values(metricTemplateRegistry)
          .flatMap((template) => template.catalog)
          .filter((metric) => metric.readiness !== "deferred")
          .map((metric) => metric.code),
      ),
    [],
  );

  useEffect(() => {
    if (demoMode) return;
    let active = true;
    const resources = FILE_WORKBENCH_RESOURCES.map(async (resource) => {
      try {
        const result = await client.list<RawRow>(resource, {
          limit:
            resource === "records"
              ? "1000"
              : resource === "snapshots" || resource === "imports"
                ? "500"
                : "200",
        });
        return {
          resource,
          data: result.data,
          status: {
            state: result.data.length ? "ready" : "empty",
          } as ResourceStatus,
        };
      } catch (caught) {
        const apiError = caught instanceof WorkbenchApiError ? caught : null;
        return {
          resource,
          data: [],
          status: {
            state: "error",
            error: caught instanceof Error ? caught.message : "request_failed",
            unsupported: apiError?.unsupported,
          } as ResourceStatus,
        };
      }
    });
    void Promise.all(resources).then((results) => {
      if (!active) return;
      setCollections(
        Object.fromEntries(
          results.map((result) => [result.resource, result.data]),
        ) as ResourceCollections,
      );
      setResourceStatus(
        Object.fromEntries(
          results.map((result) => [result.resource, result.status]),
        ) as Record<FileWorkbenchResource, ResourceStatus>,
      );
      const imports = results.find((result) => result.resource === "imports")
        ?.data as RemoteImportRow[] | undefined;
      const nextBatches = (imports ?? []).map(remoteImportToBatch);
      setBatches(nextBatches);
      setSelectedBatchId((current) =>
        nextBatches.some((item) => item.id === current)
          ? current
          : (nextBatches[0]?.id ?? ""),
      );
    });
    return () => {
      active = false;
    };
  }, [client, demoMode, reload]);

  const uploadTemplate =
    FILE_BUSINESS_TEMPLATES.find((item) => item.code === templateCode) ??
    FILE_BUSINESS_TEMPLATES[0];
  const selectedBatch =
    batches.find((item) => item.id === selectedBatchId) ?? batches[0] ?? null;
  const selectedTemplate =
    FILE_BUSINESS_TEMPLATES.find(
      (item) => item.code === selectedBatch?.businessTemplateCode,
    ) ?? uploadTemplate;
  const filePreview = importResult
    ? {
        headers: importResult.workbook.headers,
        rows: normalizeRows(
          importResult.workbook.previewRows,
          importResult.workbook.headers,
        ),
        warnings: importResult.workbook.warnings ?? [],
      }
    : (draft?.parsed ?? null);
  const workbookProfile = importResult?.workbook.profile;
  const fileProfile = normalizeWorkbookProfile(
    workbookProfile,
    draft?.profile ?? null,
  );
  const selectedRawSnapshot = collections.snapshots.find(
    (item) =>
      String(item.importJobId ?? "") === selectedBatch?.id &&
      String(item.layer ?? "") === "raw",
  );
  const snapshotHeaders = jsonArray(selectedRawSnapshot?.headersJson);
  const snapshotRows = collections.records
    .filter(
      (item) =>
        String(item.snapshotId ?? "") === String(selectedRawSnapshot?.id ?? ""),
    )
    .map((item) => jsonObject(item.recordJson ?? item.record));
  const snapshotPreview = snapshotHeaders.length
    ? {
        headers: snapshotHeaders,
        rows: normalizeRows(snapshotRows, snapshotHeaders),
        warnings: [],
      }
    : null;
  const currentImportPreview =
    importResult?.import?.id === selectedBatch?.id ? filePreview : null;
  const preview =
    currentImportPreview ?? snapshotPreview ?? (demoMode ? filePreview : null);
  const snapshotProfileValue = jsonObject(selectedRawSnapshot?.profileJson);
  const snapshotProfile = normalizeWorkbookProfile(
    snapshotProfileValue as FileImportEnvelope["workbook"]["profile"],
    null,
  );
  const profile = currentImportPreview
    ? fileProfile
    : (snapshotProfile ?? (demoMode ? fileProfile : null));
  const serverQuarantine = collections.quarantine as Array<
    RawRow & {
      issueId: string;
      snapshotId: string;
      recordId: string;
      revision: number;
      sourceRowNumber: number;
      fieldName: string;
      message: string;
      severity: string;
      status: string;
      value: unknown;
      record: Record<string, unknown>;
    }
  >;
  const localQuarantine = cleaningPreview?.quarantine ?? [];
  const snapshots = collections.snapshots;
  const selectedCuratedSnapshot = snapshots
    .filter(
      (item) =>
        String(item.importJobId ?? "") === selectedBatch?.id &&
        String(item.layer ?? "") === "curated",
    )
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  const selectedCuratedProfile = jsonObject(selectedCuratedSnapshot?.profileJson);
  const persistedCleaningImpact = selectedBatch && selectedCuratedSnapshot
    ? normalizeServerCleaningImpact(selectedBatch.id, {
        inputRows: selectedBatch.records,
        validRows: selectedBatch.valid,
        quarantinedRows: selectedBatch.rejected,
        issueCount: selectedCuratedProfile.issueCount,
        steps: selectedCuratedProfile.impacts,
      })
    : null;
  const visibleServerCleaningImpact =
    serverCleaningImpact?.importId === selectedBatch?.id
      ? serverCleaningImpact
      : persistedCleaningImpact;
  const reconciliationEnvelope = collections.reconciliations[0] ?? {};
  const reconciliationConfigs = Array.isArray(reconciliationEnvelope.configs)
    ? (reconciliationEnvelope.configs as RawRow[])
    : [];
  const reconciliationRuns = Array.isArray(reconciliationEnvelope.runs)
    ? (reconciliationEnvelope.runs as RawRow[])
    : [];
  const reconciliationDifferences = Array.isArray(
    reconciliationEnvelope.differences,
  )
    ? (reconciliationEnvelope.differences as RawRow[])
    : [];
  const publishes = collections.publishes as unknown as RemotePublishRow[];
  const quality = selectedBatch
    ? calculateQualitySummary({
        total: selectedBatch.records,
        valid: selectedBatch.valid,
        warning: selectedBatch.warning,
        rejected: selectedBatch.rejected,
      })
    : null;

  function inform(message: string) {
    setNotice(message);
    onNotify?.(message);
    window.setTimeout(() => setNotice(""), 3200);
  }

  function open(id: DataWorkbenchSectionId) {
    setSection(id);
    setMobileNav(false);
  }

  function retryResources() {
    setResourceStatus(loadingStatuses);
    setReload((value) => value + 1);
  }

  function resourceState(resource: FileWorkbenchResource, emptyText: string) {
    if (demoMode) return null;
    const current = resourceStatus[resource];
    if (current.state === "loading")
      return (
        <div className={styles.resourceNotice} role="status">
          <LoaderCircle className={styles.spin} size={18} />
          <div>
            <strong>正在加载真实数据</strong>
            <span>{emptyText}</span>
          </div>
        </div>
      );
    if (current.state === "error")
      return (
        <div
          className={`${styles.resourceNotice} ${styles.resourceError}`}
          role="alert"
        >
          <CircleAlert size={18} />
          <div>
            <strong>
              {current.unsupported
                ? "当前服务尚未开放此能力"
                : "真实数据加载失败"}
            </strong>
            <span>{current.error}</span>
          </div>
          <button className={styles.secondaryButton} onClick={retryResources}>
            重试
          </button>
        </div>
      );
    if (current.state === "empty")
      return (
        <div className={styles.resourceNotice}>
          <Database size={18} />
          <div>
            <strong>暂无真实数据</strong>
            <span>{emptyText}</span>
          </div>
        </div>
      );
    return null;
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setImportResult(null);
    const classification = classifyImportFile(file);
    if (classification.parseMode === "unsupported")
      return setError("只支持 .xlsx、.csv、.json；旧格式请先转换。");
    try {
      const sha256 = await sha256File(file);
      const text =
        classification.parseMode === "server_excel" ? "" : await file.text();
      const parsed =
        classification.parseMode === "client_csv"
          ? parseCsv(text, delimiter)
          : classification.parseMode === "client_json"
            ? parseJsonRecords(text)
            : null;
      setDraft({
        file,
        rawText: text,
        parsed,
        profile: parsed ? buildCsvDatasetProfile(parsed) : null,
        sha256,
      });
      if (parsed) setMapping(suggestedMapping(parsed.headers, templateCode));
    } catch (caught) {
      setError(
        `文件读取失败：${caught instanceof Error ? caught.message : "parse_failed"}`,
      );
    }
  }

  function changeDelimiter(nextDelimiter: string) {
    setDelimiter(nextDelimiter);
    if (!draft || classifyImportFile(draft.file).parseMode !== "client_csv")
      return;
    try {
      const parsed = parseCsv(draft.rawText, nextDelimiter);
      setDraft((current) =>
        current
          ? { ...current, parsed, profile: buildCsvDatasetProfile(parsed) }
          : current,
      );
      setMapping(suggestedMapping(parsed.headers, templateCode));
      setError("");
    } catch (caught) {
      setError(
        `CSV 重新解析失败：${caught instanceof Error ? caught.message : "parse_failed"}`,
      );
    }
  }

  function changeTemplate(nextTemplateCode: string) {
    setTemplateCode(nextTemplateCode);
    if (filePreview)
      setMapping(suggestedMapping(filePreview.headers, nextTemplateCode));
  }

  function downloadSampleData(code: string) {
    const sample = buildSampleDataCsv(code);
    downloadText(sample.fileName, sample.csv);
    inform(`${sample.fileName} 已生成，共 ${sample.rowCount} 行脱敏示范数据`);
  }

  function downloadAllSampleData() {
    FILE_BUSINESS_TEMPLATES.forEach((item, index) => {
      window.setTimeout(() => {
        const sample = buildSampleDataCsv(item.code);
        downloadText(sample.fileName, sample.csv);
      }, index * 350);
    });
    inform("8 个示范数据文件将依次下载，可直接走 导入→映射→清洗→发布 全流程");
  }

  async function submitFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || importing || lock.current) return;
    lock.current = true;
    setImporting(true);
    setError("");
    try {
      if (demoMode) {
        const records = draft.parsed?.rows.length ?? 0;
        const batch: WorkbenchBatch = {
          id: `DEMO-${crypto.randomUUID()}`,
          name: draft.file.name,
          domain: uploadTemplate.domain,
          period: "当前文件",
          source: draft.file.name.endsWith(".json")
            ? "JSON 文件"
            : draft.file.name.endsWith(".csv")
              ? "CSV 文件"
              : "Excel 文件",
          records,
          valid: 0,
          warning: 0,
          rejected: 0,
          status: "待映射",
          createdAt: new Date().toLocaleString("zh-CN"),
          owner: "演示账号",
          businessTemplateCode: uploadTemplate.code,
        };
        setBatches((current) => [batch, ...current]);
        setSelectedBatchId(batch.id);
        inform("演示批次已在本地建立，未写入正式数据服务");
      } else {
        const excel =
          classifyImportFile(draft.file).parseMode === "server_excel";
        const inspectOnly = excel && !importResult;
        if (excel && importResult?.inspectOnly && !sheetName) {
          setError("请先明确选择要入库的 Excel Sheet，再确认建立批次。");
          return;
        }
        const importIdempotencyKey = await sha256Text(
          [
            draft.sha256,
            templateCode,
            sheetName || "<first>",
            headerRow,
            delimiter,
            dateFormat,
            numberFormat,
          ].join("|"),
        );
        const response = await client.uploadFile(draft.file, {
          businessTemplateCode: templateCode,
          sheetName,
          headerRow,
          idempotencyKey: importIdempotencyKey,
          delimiter,
          dateFormat,
          numberFormat,
          inspectOnly,
        });
        if (inspectOnly) {
          setImportResult(response.data);
          setSheetName("");
          setHeaderRow(Math.max(1, response.data.workbook.headerRow));
          inform("工作簿预检完成；请选择 Sheet 和表头行后再确认入库");
          return;
        }
        if (
          !response.data.import ||
          !response.data.dataset ||
          !response.data.workbook
        )
          throw new Error("FILE_IMPORT_WORKFLOW_NOT_AVAILABLE");
        setImportResult(response.data);
        setSheetName(response.data.workbook.selectedSheet);
        setHeaderRow(Math.max(1, response.data.workbook.headerRow));
        const next = remoteImportToBatch(response.data.import);
        setBatches((current) => [
          next,
          ...current.filter((item) => item.id !== next.id),
        ]);
        setSelectedBatchId(next.id);
        setMapping(
          suggestedMapping(response.data.workbook.headers, templateCode),
        );
        inform("文件原件、解析画像、批次和不可变快照已由服务端登记");
      }
    } catch (caught) {
      setError(
        `导入未完成：${caught instanceof Error ? caught.message : "import_failed"}。页面不会模拟成功。`,
      );
    } finally {
      lock.current = false;
      setImporting(false);
    }
  }

  async function callAction<T>(
    action: string,
    payload: Record<string, unknown>,
    success: string,
  ) {
    if (operation) return null;
    setOperation(action);
    setError("");
    try {
      const response = await client.action<T>(action, payload);
      inform(success);
      return response.data;
    } catch (caught) {
      setError(
        `${action} 未完成：${caught instanceof Error ? caught.message : "request_failed"}。当前状态保持不变。`,
      );
      return null;
    } finally {
      setOperation("");
    }
  }

  async function applyMapping() {
    if (!selectedBatch || !canClean) return;
    const effectiveMapping = Object.fromEntries(
      (preview?.headers ?? []).map((header) => [
        header,
        mapping[header] ?? suggestTemplateField(selectedTemplate.code, header),
      ]),
    );
    const mappingName = `${selectedTemplate.name}字段映射`;
    const appliedMappingIds = new Set(
      snapshots.map((item) => String(item.mappingId ?? "")).filter(Boolean),
    );
    const existing = collections.mappings.find(
      (item) =>
        String(item.dataDomain ?? "") === selectedTemplate.dataDomain &&
        String(item.name ?? "") === mappingName &&
        String(item.status ?? "") === "draft" &&
        !appliedMappingIds.has(String(item.id)),
    );
    const mappingVersions = collections.mappings
      .filter(
        (item) =>
          String(item.dataDomain ?? "") === selectedTemplate.dataDomain &&
          String(item.name ?? "") === mappingName,
      )
      .map((item) => Number(item.version ?? 0));
    const saved = await callAction<RawRow>(
      existing ? "update_mapping" : "create_mapping",
      {
        ...(existing ? { id: existing.id } : {}),
        dataDomain: selectedTemplate.dataDomain,
        name: mappingName,
        version: existing?.version ?? Math.max(0, ...mappingVersions) + 1,
        status: "draft",
        mapping: effectiveMapping,
      },
      existing ? "当前模板字段映射已更新" : "当前模板字段映射草稿已保存",
    );
    const mappingId = String(saved?.id ?? "");
    const mappingHash = await sha256Text(
      JSON.stringify(
        Object.entries(effectiveMapping).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    );
    if (mappingId)
      await callAction(
        "apply_mapping",
        {
          importId: selectedBatch.id,
          mappingId,
          idempotencyKey: `map-${selectedBatch.id.slice(0, 40)}-${mappingHash.slice(0, 32)}`,
        },
        "服务端已应用字段映射",
      );
  }

  async function runServerCleaning() {
    if (!selectedBatch || !canClean) return;
    if (!recipeRules.length || recipeRules.some((rule) => !rule.field.trim())) {
      setError(
        "清洗规则字段不能为空；请从当前 canonical 字段中选择后再执行。",
      );
      return;
    }
    const appliedRecipeIds = new Set(
      snapshots.map((item) => String(item.recipeId ?? "")).filter(Boolean),
    );
    const existing = collections.recipes.find(
      (item) =>
        String(item.dataDomain ?? "") === selectedTemplate.dataDomain &&
        String(item.status ?? "") === "draft" &&
        !appliedRecipeIds.has(String(item.id)),
    );
    const versions = collections.recipes
      .filter(
        (item) => String(item.dataDomain ?? "") === selectedTemplate.dataDomain,
      )
      .map((item) => Number(item.version ?? 0));
    const rulesPayload = recipeRules.map((rule, index) => ({
      ruleType: rule.type,
      fieldName: rule.field,
      config: { label: rule.label },
      sequence: index + 1,
      enabled: true,
    }));
    const recipe = await callAction<RawRow>(
      existing ? "update_recipe" : "create_recipe",
      {
        ...(existing ? { id: existing.id } : {}),
        dataDomain: selectedTemplate.dataDomain,
        name: `${selectedTemplate.name}清洗配方`,
        description: "由文件数据中心规则编辑器创建",
        version: existing?.version ?? Math.max(0, ...versions) + 1,
        status: "draft",
        rules: rulesPayload,
      },
      existing ? "未应用清洗配方已更新" : "清洗配方新版本已创建",
    );
    const recipeId = String(recipe?.id ?? "");
    if (!recipeId) return;
    const rulesHash = await sha256Text(JSON.stringify(rulesPayload));
    const result = await callAction<{
      snapshot?: RawRow;
      impact?: unknown;
    }>(
      "run_cleaning",
      {
        importId: selectedBatch.id,
        recipeId,
        idempotencyKey: `clean-${selectedBatch.id.slice(0, 40)}-${rulesHash.slice(0, 32)}`,
      },
      "服务端清洗试运行已完成，可查看逐步影响",
    );
    if (result) {
      const impact = normalizeServerCleaningImpact(
        selectedBatch.id,
        result.impact,
      );
      if (impact) setServerCleaningImpact(impact);
      retryResources();
    }
  }

  function runLocalCleaning() {
    if (!preview) return setError("请先选择并真实解析一个文件。");
    const result = runCleaningPreview(preview.rows, recipeRules);
    setCleaningPreview(result);
    inform("本地预检完成；结果未写入服务端");
  }

  async function repairServerRow() {
    const row = serverQuarantine.find(
      (item) =>
        item.recordId === repairingRow?.rowId &&
        item.fieldName === repairingRow.errors[0]?.field,
    );
    if (!row || !repairingRow) return;
    const repaired = await callAction(
      "repair_quarantine",
      {
        snapshotId: row.snapshotId,
        rowId: row.recordId,
        baseRevision: row.revision,
        patch: { [repairingRow.errors[0]?.field ?? "value"]: repairValue },
        comment: "在线修复隔离记录",
      },
      "隔离记录已提交修复并重新校验",
    );
    if (repaired) {
      setRepairingRow(null);
      retryResources();
    }
  }

  async function runReconciliation() {
    if (!leftSnapshot || !rightSnapshot)
      return setError("请选择左右两个真实快照。");
    if (leftSnapshot === rightSnapshot)
      return setError("左右侧必须选择不同快照，不能用同一版本自对账。");
    const keys = keyFields
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const comparisons = compareFields
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    const matchingConfig = reconciliationConfigs.find(
      (item) =>
        JSON.stringify(jsonArray(item.leftKeyFieldsJson)) ===
          JSON.stringify(keys) &&
        JSON.stringify(jsonArray(item.rightKeyFieldsJson)) ===
          JSON.stringify(keys) &&
        JSON.stringify(jsonArray(item.compareFieldsJson)) ===
          JSON.stringify(comparisons),
    );
    let configId = String(matchingConfig?.id ?? "");
    if (!configId) {
      const config = await callAction<RawRow>(
        "create_reconciliation_config",
        {
          name: `${selectedTemplate.name}文件对账`,
          dataDomain: selectedTemplate.dataDomain,
          leftKeyFields: keys,
          rightKeyFields: keys,
          compareFields: comparisons,
          tolerance: {},
          status: "draft",
        },
        "文件对账配置已保存",
      );
      configId = String(config?.id ?? "");
    }
    if (!configId) return;
    const result = await callAction<RawRow>(
      "run_reconciliation",
      {
        configId,
        leftSnapshotId: leftSnapshot,
        rightSnapshotId: rightSnapshot,
      },
      "文件对账已由服务端执行",
    );
    if (result) retryResources();
  }

  async function activateMetricDefinition(item: RawRow) {
    if (!canReview) return;
    if (String(item.code ?? "").startsWith("hospital.")) {
      const result = await callAction(
        "activate_hospital_metric_definition",
        {
          id: item.id,
          sourceFieldDefinitionIds: catalogFieldIds,
          dependencyMetricDefinitionIds: catalogDependencyIds.filter(
            (id) => id !== String(item.id),
          ),
        },
        "医院关注指标已审核启用",
      );
      if (result) retryResources();
      return;
    }
    const result = await callAction(
      "save_metric_definition",
      {
        id: item.id,
        code: item.code,
        name: item.name,
        formula: item.formula,
        aggregation: item.aggregation,
        numerator: item.numerator ?? "",
        denominator: item.denominator ?? "",
        dimensions: jsonArray(item.dimensionsJson ?? item.dimensions),
        sourceFieldRefs: jsonArray(
          item.sourceFieldRefsJson ?? item.sourceFieldRefs,
        ),
        unit: item.unit ?? "",
        description: item.description ?? "",
        version: item.version ?? 1,
        status: "active",
      },
      "指标定义已审核启用",
    );
    if (result) retryResources();
  }

  async function importHospitalMetricCatalog() {
    const template = resolveMetricTemplate(metricTemplateVersion);
    const result = await callAction(
      "import_hospital_metric_template",
      { templateVersion: metricTemplateVersion },
      `${template?.label ?? "医院关注指标"} ${template?.expectedCount ?? 20} 项已导入为草稿`,
    );
    if (result) retryResources();
  }

  async function activateFieldDefinition(item: RawRow) {
    if (!canReview) return;
    const result = await callAction(
      "save_field_definition",
      {
        id: item.id,
        code: item.code,
        name: item.name,
        dataType: item.dataType,
        unit: item.unit ?? "",
        dictionary: jsonObject(item.dictionaryJson ?? item.dictionary),
        validation: jsonObject(item.validationJson ?? item.validation),
        description: item.description ?? "",
        version: item.version ?? 1,
        status: "active",
      },
      "字段定义已审核启用",
    );
    if (result) retryResources();
  }

  async function activateVisualizationDefinition(item: RawRow) {
    if (!canReview) return;
    const result = await callAction(
      "save_visualization_definition",
      {
        id: item.id,
        metricId: item.metricId,
        code: item.code,
        name: item.name,
        chartType: item.chartType,
        dimension: item.dimension ?? "",
        series: jsonArray(item.seriesJson ?? item.series),
        sort: jsonObject(item.sortJson ?? item.sort),
        config: jsonObject(item.configJson ?? item.config),
        limit: item.limit ?? 20,
        version: item.version ?? 1,
        status: "active",
      },
      "展示定义已审核启用",
    );
    if (result) retryResources();
  }

  async function reviewImport(
    item: WorkbenchBatch,
    status: "ready" | "pending_mapping",
    emergencyReason = "",
  ) {
    if (operation) return;
    setOperation("advance_import");
    setError("");
    try {
      await client.action("advance_import", {
        id: item.id,
        status,
        revision: item.revision ?? 1,
        rowCount: item.records,
        acceptedCount: item.valid,
        rejectedCount: item.rejected,
        comment: status === "ready" ? "质量复核通过" : "质量复核退回重新映射",
        ...(emergencyReason ? { breakGlassReason: emergencyReason } : {}),
      });
      inform(
        status === "ready"
          ? "批次已复核通过，可进入发布"
          : "批次已退回重新映射",
      );
      setBreakGlassImportId("");
      setBreakGlassImportReason("");
      retryResources();
    } catch (caught) {
      if (
        caught instanceof WorkbenchApiError &&
        caught.code === "self_review_forbidden" &&
        isPlatformAdmin &&
        status === "ready"
      ) {
        setBreakGlassImportId(item.id);
        setError(
          "批次四眼复核被阻止。平台管理员可填写不少于 20 字的紧急理由后手动重试，操作将写入审计。",
        );
      } else {
        setError(
          `advance_import 未完成：${caught instanceof Error ? caught.message : "request_failed"}。`,
        );
      }
    } finally {
      setOperation("");
    }
  }

  async function createPublish() {
    if (!selectedPublishIds.length || !canClean) return;
    const intentKey = await sha256Text(
      [
        "create_publish",
        ...[...selectedPublishIds].sort(),
        ...[...selectedMetricIds].sort(),
        ...[...selectedVisualizationIds].sort(),
        allocationRule,
        correctionOfId,
        reconciliationWaiverReason.trim(),
      ].join("|"),
    );
    const data = await callAction<RemotePublishRow>(
      "create_publish",
      {
        curatedSnapshotIds: selectedPublishIds,
        metricDefinitionIds: selectedMetricIds,
        visualizationDefinitionIds: selectedVisualizationIds,
        allocationRule,
        ...(selectedPublishIds.length > 1 &&
        reconciliationWaiverReason.trim().length >= 20
          ? {
              reconciliationWaiverReason:
                reconciliationWaiverReason.trim(),
            }
          : {}),
        ...(correctionOfId ? { correctionOfId } : {}),
        idempotencyKey: intentKey,
      },
      "发布草稿已创建，等待另一角色审核",
    );
    if (data) {
      setCorrectionOfId("");
      retryResources();
    }
  }

  async function transitionPublish(
    item: RemotePublishRow,
    status: "draft" | "pending_review" | "approved" | "rejected" | "published",
    emergencyReason = "",
  ) {
    if (operation) return;
    setOperation("advance_publish");
    setError("");
    try {
      await client.action("advance_publish", {
        id: item.id,
        status,
        comment: emergencyReason
          ? "平台管理员紧急复核"
          : "文件数据中心状态流转",
        ...(emergencyReason ? { breakGlassReason: emergencyReason } : {}),
      });
      inform(`发布状态已更新为${statusLabel(status)}`);
      setBreakGlassPublishId("");
      setBreakGlassReason("");
      retryResources();
    } catch (caught) {
      if (
        caught instanceof WorkbenchApiError &&
        caught.code === "self_review_forbidden" &&
        isPlatformAdmin &&
        (status === "approved" || status === "rejected")
      ) {
        setBreakGlassPublishId(item.id);
        setBreakGlassStatus(status);
        setError(
          "四眼复核被阻止。平台管理员如确需紧急处理，必须填写不少于 20 字的理由后手动重试；该操作会进入审计。",
        );
      } else {
        setError(
          `advance_publish 未完成：${caught instanceof Error ? caught.message : "request_failed"}。当前状态保持不变。`,
        );
      }
    } finally {
      setOperation("");
    }
  }

  async function rollbackPublish(item: RemotePublishRow) {
    if (rollbackReason.trim().length < 20) {
      setError("请填写不少于 20 字的真实回滚理由。");
      return;
    }
    const reasonHash = await sha256Text(rollbackReason.trim());
    const result = await callAction(
      "rollback_publish",
      {
        targetPublishId: item.id,
        comment: rollbackReason.trim(),
        idempotencyKey: `rollback-${item.id}-${reasonHash.slice(0, 24)}`,
      },
      "回滚草稿已创建；需继续完成提交、审核、批准与发布",
    );
    if (result) {
      setRollbackTargetId("");
      setRollbackReason("");
      retryResources();
    }
  }

  function renderOverview() {
    const progress = [
      demoMode || collections.templates.length > 0,
      demoMode || collections.datasets.length > 0,
      Boolean(preview),
      batches.length > 0,
      Object.values(mapping).some(Boolean) || collections.mappings.length > 0,
      Boolean(cleaningPreview) || collections.recipes.length > 0,
      (serverQuarantine.length === 0 && batches.length > 0) ||
        collections.qualityIssues.length > 0,
      reconciliationRuns.length > 0,
      publishes.length > 0,
      collections.lineage.length > 0 || snapshots.length > 0,
    ];
    const completed = progress.filter(Boolean).length;
    return (
      <>
        <section className={styles.hero}>
          <div>
            <span className={styles.eyebrow}>
              <Sparkles size={15} />
              文件数据准备工作区
            </span>
            <h1>Excel、CSV、JSON 数据中心</h1>
            <p>
              从业务模板和文件解析开始，逐步完成画像、映射、清洗、隔离修复、文件对账、双角色审核、发布、更正与回滚。
            </p>
          </div>
          <div className={styles.heroVersion}>
            <span>当前十步进度</span>
            <strong>{completed}/10</strong>
            <small>
              {demoMode
                ? "演示数据不会进入正式发布"
                : "所有完成状态来自真实资源"}
            </small>
          </div>
        </section>
        <ol className={styles.workflowStrip}>
          {DATA_WORKBENCH_SECTIONS.map((item, index) => (
            <li key={item.id} className={progress[index] ? styles.current : ""}>
              <button onClick={() => open(item.id)}>
                <i>{index + 1}</i>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <ChevronRight size={14} />
              </button>
            </li>
          ))}
        </ol>
        <section className={styles.metrics}>
          <article>
            <span className={styles.metricIcon}>
              <FileSpreadsheet size={19} />
            </span>
            <div>
              <small>文件批次健康</small>
              <strong>{batches.length}</strong>
              <p>正式模式不预置固定批次</p>
            </div>
          </article>
          <article>
            <span className={styles.metricIcon}>
              <TableProperties size={19} />
            </span>
            <div>
              <small>已解析记录</small>
              <strong>
                {batches
                  .reduce((sum, item) => sum + item.records, 0)
                  .toLocaleString("zh-CN")}
              </strong>
              <p>来自导入批次行数</p>
            </div>
          </article>
          <article>
            <span className={styles.metricIcon}>
              <CircleAlert size={19} />
            </span>
            <div>
              <small>隔离记录</small>
              <strong>{serverQuarantine.length}</strong>
              <p>逐行修复后重新校验</p>
            </div>
          </article>
          <article>
            <span className={styles.metricIcon}>
              <Rocket size={19} />
            </span>
            <div>
              <small>已发布版本</small>
              <strong>
                {publishes.filter((item) => item.status === "published").length}
              </strong>
              <p>不从 manifest 读取明细行</p>
            </div>
          </article>
        </section>
        <Panel
          title="正式资源状态"
          description="缺少的正式文件服务能力会显示不可用，不会用静态数值补齐"
        >
          <div className={styles.stateGrid}>
            {FILE_WORKBENCH_RESOURCES.map((resource) => (
              <article key={resource}>
                <span
                  className={tone(
                    resourceStatus[resource].state === "error"
                      ? "error"
                      : resourceStatus[resource].state === "ready"
                        ? "ready"
                        : "draft",
                  )}
                >
                  <CircleDot size={12} />
                  {FILE_WORKBENCH_STATE_LABELS[resourceStatus[resource].state]}
                </span>
                <strong>{FILE_WORKBENCH_RESOURCE_LABELS[resource]}</strong>
                <small>{collections[resource].length} 条</small>
              </article>
            ))}
          </div>
        </Panel>
      </>
    );
  }

  function renderSources() {
    const templates = collections.templates.length
      ? (collections.templates as unknown as FileBusinessTemplate[])
      : demoMode
        ? [...FILE_BUSINESS_TEMPLATES]
        : [];
    return (
      <>
        <Heading
          eyebrow="步骤 2 · 文件源定义"
          title="文件与模板"
          description="主操作只处理 Excel、CSV、JSON；模板负责定义业务含义和最低字段要求。"
        />
        {resourceState("templates", "正在读取医院可用业务模板。")}
        {!templates.length && resourceStatus.templates.state !== "loading" ? (
          <div className={styles.capabilityNote}>
            <AlertTriangle size={18} />
            <div>
              <strong>服务端暂无模板数据</strong>
              <p>可查看内置 8 类模板说明，但正式保存仍需 templates 资源。</p>
            </div>
          </div>
        ) : null}
        <div className={styles.templateGrid}>
          {FILE_BUSINESS_TEMPLATES.map((item) => (
            <article
              key={item.code}
              className={templateCode === item.code ? styles.selected : ""}
            >
              <button
                className={styles.templateSelect}
                onClick={() => changeTemplate(item.code)}
              >
                <span>
                  <FileSpreadsheet size={18} />
                </span>
                <small>{item.domain}</small>
                <strong>{item.name}</strong>
                <p>{item.description}</p>
                <em>{item.requiredFields.join(" · ")}</em>
              </button>
              <button
                className={styles.templateDownload}
                onClick={() =>
                  downloadText(
                    `${item.code}-template.csv`,
                    buildBusinessTemplateCsv(item.code),
                  )
                }
              >
                <Download size={14} />
                下载 CSV 模板 / 字段说明
              </button>
              <button
                className={styles.templateDownload}
                onClick={() => downloadSampleData(item.code)}
              >
                <WandSparkles size={14} />
                下载示范数据
              </button>
            </article>
          ))}
        </div>
        <Panel
          title="文件数据集健康"
          description="按原件哈希、解析批次和不可变快照判断，不显示外部系统连接健康"
        >
          <div className={styles.stateGrid}>
            {(collections.datasets.length ? collections.datasets : []).map(
              (dataset) => (
                <article key={String(dataset.id)}>
                  <span className={styles.success}>
                    <BadgeCheck size={12} />
                    已登记
                  </span>
                  <strong>{String(dataset.fileName ?? dataset.id)}</strong>
                  <small>
                    {Number(dataset.rowCount ?? 0).toLocaleString("zh-CN")} 行 ·{" "}
                    {String(dataset.sha256 ?? "").slice(0, 12)}
                  </small>
                </article>
              ),
            )}
          </div>
          {resourceState("datasets", "尚无真实数据集，请从文件导入开始。")}
        </Panel>
      </>
    );
  }

  function renderImports() {
    const headers = filePreview?.headers ?? [];
    const rows = filePreview?.rows.slice(0, 20) ?? [];
    const importProfile = fileProfile;
    return (
      <>
        <Heading
          eyebrow="步骤 3 · 受控解析"
          title="文件导入"
          description="Excel、CSV、JSON 均通过真实文件读取；收到真实表头、行数和哈希前不会标记为已解析。"
          action={
            draft ? (
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setDraft(null);
                  setImportResult(null);
                  if (fileInput.current) fileInput.current.value = "";
                }}
              >
                <RefreshCw size={15} />
                重新选择
              </button>
            ) : (
              <button
                className={styles.secondaryButton}
                onClick={downloadAllSampleData}
              >
                <Download size={15} />
                下载全部示范数据
              </button>
            )
          }
        />
        {error ? (
          <div className={styles.errorBanner} role="alert">
            <CircleAlert size={17} />
            <span>{error}</span>
            <button onClick={() => setError("")} aria-label="关闭错误">
              <X size={15} />
            </button>
          </div>
        ) : null}
        <div className={styles.importLayout}>
          <Panel
            title="导入向导"
            description="业务模板 → 文件格式 → Sheet / 表头 → 服务端批次"
          >
            <form className={styles.importForm} onSubmit={submitFile}>
              <label className={styles.dropzone}>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,.xlsx,.json"
                  onChange={chooseFile}
                  disabled={!canIngest || importing}
                />
                <span>
                  <Upload size={24} />
                </span>
                <strong>{draft?.file.name ?? "选择 Excel、CSV 或 JSON"}</strong>
                <small>
                  {draft
                    ? `${fileSize(draft.file.size)} · SHA-256 ${draft.sha256.slice(0, 12)}…`
                    : "正式模式原件由服务端不可变存储"}
                </small>
                <em>{canIngest ? "选择文件" : "无导入权限"}</em>
              </label>
              <div className={styles.formGrid}>
                <label>
                  <span>业务模板</span>
                  <select
                    value={templateCode}
                    onChange={(event) => changeTemplate(event.target.value)}
                  >
                    {FILE_BUSINESS_TEMPLATES.map((item) => (
                      <option value={item.code} key={item.code}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Sheet</span>
                  <input
                    list="workbook-sheet-options"
                    value={sheetName}
                    onChange={(event) => setSheetName(event.target.value)}
                    placeholder="留空使用首个工作表"
                  />
                  <datalist id="workbook-sheet-options">
                    {(importResult?.workbook.sheets ?? []).map((sheet) => (
                      <option key={sheet.name} value={sheet.name}>
                        {sheet.rowCount} 行 · {sheet.columnCount} 列
                      </option>
                    ))}
                  </datalist>
                </label>
                <label>
                  <span>表头行</span>
                  <input
                    type="number"
                    min="1"
                    value={headerRow}
                    onChange={(event) =>
                      setHeaderRow(Math.max(1, Number(event.target.value)))
                    }
                  />
                </label>
                <label>
                  <span>CSV 分隔符 / 格式</span>
                  <select
                    value={delimiter}
                    onChange={(event) => changeDelimiter(event.target.value)}
                  >
                    <option value=",">逗号 ,</option>
                    <option value=";">分号 ;</option>
                    <option value="\t">制表符 Tab</option>
                  </select>
                </label>
                <label>
                  <span>日期格式</span>
                  <select
                    value={dateFormat}
                    onChange={(event) => setDateFormat(event.target.value)}
                  >
                    <option>YYYY-MM-DD</option>
                    <option>YYYY/MM/DD</option>
                    <option>DD/MM/YYYY</option>
                  </select>
                </label>
                <label>
                  <span>数字格式</span>
                  <select
                    value={numberFormat}
                    onChange={(event) => setNumberFormat(event.target.value)}
                  >
                    <option>小数点 . / 无千分位</option>
                    <option>小数点 . / 千分位 ,</option>
                    <option>小数点 , / 千分位 .</option>
                  </select>
                </label>
              </div>
              <footer className={styles.formActions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => downloadSampleData(templateCode)}
                >
                  <WandSparkles size={15} />
                  下载示范数据
                </button>
                <button
                  className={styles.primaryButton}
                  disabled={
                    !draft ||
                    !canIngest ||
                    importing ||
                    Boolean(importResult?.inspectOnly && !sheetName)
                  }
                >
                  {importing ? (
                    <LoaderCircle className={styles.spin} size={15} />
                  ) : (
                    <CloudUpload size={15} />
                  )}
                  {importing
                    ? "正在上传，禁止重复提交"
                    : classifyImportFile(draft?.file ?? { name: "", size: 0 })
                          .parseMode === "server_excel" && !importResult
                      ? "预检 Excel 工作簿"
                      : importResult?.inspectOnly
                        ? "确认 Sheet 并建立真实批次"
                        : "上传并建立真实批次"}
                </button>
              </footer>
            </form>
            <div className={styles.capabilityNote}>
              <FileSpreadsheet size={18} />
              <div>
                <strong>示范数据包 {SAMPLE_DATA_PACKAGE_VERSION}</strong>
                <p>
                  这些文件为脱敏示范数据，与设备台账使用同一套设备编号，可直接走
                  导入→映射→清洗→发布 全流程；不含姓名、证件、手机号等个人信息。
                  金额类字段（资产原值、金额、退费金额、维修费用、预算金额）统一为
                  <strong>万元</strong>，与平台内部口径一致；医院上传自有文件时请按同一单位换算。
                </p>
              </div>
            </div>
            {templateCode === "exam_activity" ? (
              <div className={styles.capabilityNote}>
                <AlertTriangle size={18} />
                <div>
                  <strong>一次检查多部位映射</strong>
                  <p>
                    用 examId 标识一次检查；主部位映射 bodyPart，多部位可用
                    bodyParts 数组或相同 examId 的重复行，并用 isPrimary /
                    allocationWeight 标识。部位行数不能直接当作检查人次。
                  </p>
                </div>
              </div>
            ) : null}
          </Panel>
          <Panel
            title="真实预览与画像"
            description={
              filePreview
                ? `${headers.length} 列 · ${importResult?.workbook.rowCount ?? filePreview.rows.length} 行`
                : "选择 CSV/JSON 后本地预览；Excel 由服务端返回 Sheet 与画像"
            }
          >
            {rows.length ? (
              <>
                <div className={styles.previewTable}>
                  <table>
                    <thead>
                      <tr>
                        {headers.map((header) => (
                          <th key={header}>{header}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={index}>
                          {headers.map((header) => (
                            <td key={header}>{row[header] || <em>空值</em>}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.portraitGrid}>
                  {headers.map((header) => (
                    <article key={header}>
                      <strong>{header}</strong>
                      <span>
                        {importProfile?.schema.columns.find(
                          (item) => item.name === header,
                        )?.inferredType ?? "服务端识别"}
                      </span>
                      <small>
                        空值{" "}
                        {importProfile?.profile.columns[header]?.empty ?? "—"} ·
                        唯一{" "}
                        {importProfile?.profile.columns[header]?.distinct ??
                          "—"}
                      </small>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.emptyState}>
                <TableProperties size={26} />
                <strong>尚无真实预览</strong>
                <p>可先下载示范数据体验全流程；Excel 需服务端解析成功后显示。</p>
              </div>
            )}
          </Panel>
        </div>
      </>
    );
  }

  function renderBatches() {
    return (
      <>
        <Heading
          eyebrow="步骤 4 · 不可变原件"
          title="原始批次"
          description="每次文件上传形成独立导入、数据集和快照；更正通过新版本完成。"
        />
        {resourceState("imports", "正在读取真实文件批次。")}
        {batches.length ? (
          <Panel title="文件批次台账" description="记录数和状态均来自服务端">
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>文件批次</th>
                    <th>模板域</th>
                    <th>记录数</th>
                    <th>状态</th>
                    <th>创建时间</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr
                      key={batch.id}
                      className={
                        batch.id === selectedBatch?.id ? styles.selectedRow : ""
                      }
                    >
                      <td>
                        <strong>{batch.name}</strong>
                        <small>{batch.id}</small>
                      </td>
                      <td>{batch.domain}</td>
                      <td>{batch.records.toLocaleString("zh-CN")}</td>
                      <td>
                        <i className={tone(batch.status)}>
                          {statusLabel(batch.status)}
                        </i>
                      </td>
                      <td>{batch.createdAt}</td>
                      <td>
                        <button onClick={() => setSelectedBatchId(batch.id)}>
                          选择
                          <ChevronRight size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}
      </>
    );
  }

  function renderMapping() {
    const headers = preview?.headers ?? [];
    const customFields = collections.fieldDefinitions.map((item) => ({
      code: String(item.code ?? ""),
      name: String(item.name ?? item.code ?? "自定义字段"),
      type: String(item.dataType ?? "string") as ReturnType<
        typeof templateFields
      >[number]["type"],
      required: Boolean(jsonObject(item.validationJson).required),
      aliases: [] as string[],
      status: String(item.status ?? "draft"),
      version: Number(item.version ?? 1),
    }));
    const standardFields = [
      ...templateFields(selectedTemplate.code),
      ...customFields.filter(
        (field) =>
          field.code &&
          !templateFields(selectedTemplate.code).some(
            (item) => item.code === field.code,
          ),
      ),
    ];
    const activeFieldDefinitions = collections.fieldDefinitions.filter(
      (item) => String(item.status) === "active",
    );
    const activeCatalogMetrics = collections.metrics.filter(
      (item) =>
        String(item.status) === "active" &&
        String(item.code ?? "").startsWith("hospital."),
    );
    const canonicalField = (value: string) => mapping[value] || value;
    return (
      <>
        <Heading
          eyebrow="步骤 5 · 元数据驱动"
          title="字段 / 主数据映射"
          description="来源字段完全由当前文件表头驱动；自定义字段、指标与展示配置通过正式 API 保存。"
          action={
            <button
              className={styles.primaryButton}
              disabled={!selectedBatch || !canClean || Boolean(operation)}
              onClick={() => void applyMapping()}
            >
              <Check size={15} />
              应用映射
            </button>
          }
        />
        <div
          className={styles.mappingTabs}
          role="tablist"
          aria-label="元数据配置"
        >
          <button
            className={mappingTab === "fields" ? styles.activeTab : ""}
            onClick={() => setMappingTab("fields")}
          >
            字段映射
          </button>
          <button
            className={mappingTab === "custom" ? styles.activeTab : ""}
            onClick={() => setMappingTab("custom")}
          >
            自定义字段定义
          </button>
          <button
            className={mappingTab === "metric" ? styles.activeTab : ""}
            onClick={() => setMappingTab("metric")}
          >
            指标配置
          </button>
          <button
            className={mappingTab === "visual" ? styles.activeTab : ""}
            onClick={() => setMappingTab("visual")}
          >
            展示配置
          </button>
        </div>
        {mappingTab === "fields" ? (
          <Panel
            title="数据驱动字段映射"
            description={
              headers.length
                ? `${headers.length} 个来源字段`
                : "先解析真实文件后配置"
            }
          >
            {headers.length ? (
              <div className={styles.mappingGrid}>
                {headers.map((header) => (
                  <label key={header}>
                    <span>
                      <code>{header}</code>
                      <small>
                        {profile?.schema.columns.find(
                          (item) => item.name === header,
                        )?.inferredType ?? "string"}
                      </small>
                    </span>
                    <ArrowRight size={14} />
                    <input
                      list="standard-field-options"
                      value={
                        mapping[header] ??
                        suggestTemplateField(selectedTemplate.code, header)
                      }
                      onChange={(event) =>
                        setMapping((current) => ({
                          ...current,
                          [header]: event.target.value,
                        }))
                      }
                      placeholder="标准字段 code"
                    />
                  </label>
                ))}
                <datalist id="standard-field-options">
                  {standardFields.map((field) => (
                    <option key={field.code} value={field.code}>
                      {field.name} · {field.type} ·{" "}
                      {field.required ? "必填" : "可选"}
                    </option>
                  ))}
                </datalist>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <Link2 size={25} />
                <strong>没有可映射字段</strong>
                <p>正式模式不会显示固定 fieldMappings。</p>
              </div>
            )}
            <div
              className={styles.portraitGrid}
              aria-label="当前模板标准字段说明"
            >
              {standardFields.map((field) => (
                <article key={field.code}>
                  <strong>{field.name}</strong>
                  <span>{field.code}</span>
                  <small>
                    {field.type} · {field.required ? "必填" : "可选"}
                  </small>
                </article>
              ))}
            </div>
          </Panel>
        ) : null}
        {mappingTab === "custom" ? (
          <Panel
            title="自定义字段定义"
            description="名称、code、类型、单位、字典、必填、校验"
          >
            <form
              className={styles.formGrid}
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                const dictionaryCode = String(
                  values.get("fieldDictionary") ?? "",
                ).trim();
                void callAction(
                  "save_field_definition",
                  {
                    name: fieldName,
                    code: fieldCode,
                    dataType: String(values.get("fieldType") ?? "string"),
                    unit: String(values.get("fieldUnit") ?? "").trim(),
                    dictionary: dictionaryCode ? { code: dictionaryCode } : {},
                    validation: {
                      required: values.get("fieldRequired") === "on",
                      expression: String(
                        values.get("fieldValidation") ?? "",
                      ).trim(),
                    },
                    description: "文件数据中心自定义字段",
                    version: 1,
                    status: "draft",
                  },
                  "字段定义草稿已保存",
                );
              }}
            >
              <label>
                <span>名称</span>
                <input
                  value={fieldName}
                  onChange={(event) => setFieldName(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>code</span>
                <input
                  value={fieldCode}
                  onChange={(event) => setFieldCode(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>类型</span>
                <select name="fieldType" defaultValue="string">
                  <option value="string">文本</option>
                  <option value="integer">整数</option>
                  <option value="decimal">小数</option>
                  <option value="date">日期</option>
                  <option value="code">字典编码</option>
                  <option value="json">JSON / 数组</option>
                </select>
              </label>
              <label>
                <span>单位</span>
                <input name="fieldUnit" placeholder="元 / 分钟 / 次" />
              </label>
              <label>
                <span>字典</span>
                <input name="fieldDictionary" placeholder="可选字典 code" />
              </label>
              <label>
                <span>必填</span>
                <input name="fieldRequired" type="checkbox" />
              </label>
              <label>
                <span>校验表达式</span>
                <input name="fieldValidation" placeholder="例如：长度 ≤ 120" />
              </label>
              <footer className={styles.formActions}>
                <button className={styles.primaryButton} disabled={!canClean}>
                  保存字段草稿
                </button>
              </footer>
            </form>
            <div className={styles.candidateList}>
              {collections.fieldDefinitions.map((item) => (
                <article key={String(item.id)}>
                  <span className={tone(String(item.status ?? "draft"))}>
                    <Braces size={15} />
                  </span>
                  <div>
                    <strong>{String(item.name ?? item.code)}</strong>
                    <small>
                      {String(item.code)} · {String(item.dataType)} · v
                      {String(item.version ?? 1)}
                    </small>
                  </div>
                  <i className={tone(String(item.status ?? "draft"))}>
                    {statusLabel(String(item.status ?? "draft"))}
                  </i>
                  {String(item.status) === "draft" ? (
                    <button
                      disabled={!canReview || Boolean(operation)}
                      onClick={() => void activateFieldDefinition(item)}
                    >
                      审核启用
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </Panel>
        ) : null}
        {mappingTab === "metric" ? (
          <Panel
            title="指标配置"
            description="选择字段、聚合 / 公式、分子、分母、维度和版本"
            action={
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <select
                  aria-label="选择指标模板版本"
                  value={metricTemplateVersion}
                  onChange={(event) =>
                    setMetricTemplateVersion(event.target.value)
                  }
                >
                  {Object.entries(metricTemplateRegistry).map(
                    ([version, template]) => (
                      <option key={version} value={version}>
                        {template.label}（{template.expectedCount} 项）
                      </option>
                    ),
                  )}
                </select>
                <button
                  className={styles.secondaryButton}
                  disabled={!canClean || Boolean(operation)}
                  onClick={() => void importHospitalMetricCatalog()}
                >
                  导入
                  {resolveMetricTemplate(metricTemplateVersion)?.label ??
                    "医院关注指标"}
                  （
                  {resolveMetricTemplate(metricTemplateVersion)
                    ?.expectedCount ?? 20}
                  {" 项）"}
                </button>
              </div>
            }
          >
            <form
              className={styles.formGrid}
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                const selectedSource = canonicalField(
                  String(values.get("metricSourceField") ?? "").trim(),
                );
                const dimensions = String(values.get("metricDimensions") ?? "")
                  .split(",")
                  .map((item) => canonicalField(item.trim()))
                  .filter(Boolean);
                void callAction(
                  "save_metric_definition",
                  {
                    name: metricName,
                    code: String(values.get("metricCode") ?? "").trim(),
                    formula: String(values.get("metricFormula") ?? "").trim(),
                    aggregation: String(
                      values.get("metricAggregation") ?? "count",
                    ),
                    numerator: String(values.get("metricNumerator") ?? "")
                      .trim()
                      .split(/\s+/)
                      .map(canonicalField)
                      .join(" "),
                    denominator: String(values.get("metricDenominator") ?? "")
                      .trim()
                      .split(/\s+/)
                      .map(canonicalField)
                      .join(" "),
                    dimensions,
                    sourceFieldRefs: [
                      selectedSource,
                      ...Object.values(mapping).filter(Boolean),
                    ].filter(
                      (value, index, all) =>
                        Boolean(value) && all.indexOf(value) === index,
                    ),
                    unit: String(values.get("metricUnit") ?? "").trim(),
                    description: "文件指标",
                    version: 1,
                    status: "draft",
                  },
                  "指标草稿已保存",
                );
              }}
            >
              <label>
                <span>指标名称</span>
                <input
                  value={metricName}
                  onChange={(event) => setMetricName(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>指标 code</span>
                <input
                  name="metricCode"
                  placeholder="例如 device.exam_count"
                  required
                />
              </label>
              <label>
                <span>选择字段</span>
                <select name="metricSourceField" required>
                  <option value="">请选择</option>
                  {standardFields.map((field) => (
                    <option key={field.code} value={field.code}>
                      {field.name} · {field.code}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>聚合方式</span>
                <select name="metricAggregation" defaultValue="count">
                  <option value="sum">求和</option>
                  <option value="avg">平均</option>
                  <option value="min">最小</option>
                  <option value="max">最大</option>
                  <option value="count">计数</option>
                  <option value="distinct_count">去重计数</option>
                  <option value="ratio">比率</option>
                  <option value="custom">自定义</option>
                </select>
              </label>
              <label>
                <span>公式</span>
                <input name="metricFormula" defaultValue="COUNT(*)" required />
              </label>
              <label>
                <span>分子</span>
                <input
                  name="metricNumerator"
                  list="standard-field-options"
                  placeholder="可选 canonical 分子字段"
                />
              </label>
              <label>
                <span>分母</span>
                <input
                  name="metricDenominator"
                  list="standard-field-options"
                  placeholder="可选 canonical 分母字段"
                />
              </label>
              <label>
                <span>维度</span>
                <input
                  name="metricDimensions"
                  placeholder="deviceId,department,period"
                />
              </label>
              <label>
                <span>单位</span>
                <input name="metricUnit" placeholder="次 / 元 / %" />
              </label>
              <footer className={styles.formActions}>
                <button className={styles.primaryButton} disabled={!canClean}>
                  保存指标草稿
                </button>
              </footer>
            </form>
            <div className={styles.capabilityNote}>
              <BadgeCheck size={18} />
              <div>
                <strong>医院关注指标激活绑定</strong>
                <p>
                  原表存在‘或’口径的项目拆分后共形成 20 个指标。先勾选 active
                  字段定义和已启用依赖指标，再对 catalog
                  草稿执行“审核启用”；服务端会返回具体阻断原因。
                </p>
              </div>
            </div>
            <div className={styles.batchChooser}>
              {activeFieldDefinitions.map((item) => (
                <label key={String(item.id)}>
                  <input
                    type="checkbox"
                    checked={catalogFieldIds.includes(String(item.id))}
                    onChange={(event) =>
                      setCatalogFieldIds((current) =>
                        event.target.checked
                          ? [...current, String(item.id)]
                          : current.filter((id) => id !== String(item.id)),
                      )
                    }
                  />
                  <span>
                    <strong>{String(item.name ?? item.code)}</strong>
                    <small>active 字段 · {String(item.code)}</small>
                  </span>
                </label>
              ))}
              {activeCatalogMetrics.map((item) => (
                <label key={String(item.id)}>
                  <input
                    type="checkbox"
                    checked={catalogDependencyIds.includes(String(item.id))}
                    onChange={(event) =>
                      setCatalogDependencyIds((current) =>
                        event.target.checked
                          ? [...current, String(item.id)]
                          : current.filter((id) => id !== String(item.id)),
                      )
                    }
                  />
                  <span>
                    <strong>{String(item.name ?? item.code)}</strong>
                    <small>active 依赖指标 · {String(item.code)}</small>
                  </span>
                </label>
              ))}
            </div>
            <h3>医院关注指标基线</h3>
            <p>
              原表存在“或”口径的项目拆分后共形成 20 个指标。目录中的外部业务
              出处只用于说明理论来源；本平台仅接收 Excel、CSV 或 JSON
              导出文件，不建立在线接口。当前展示模板：
              {resolveMetricTemplate(metricTemplateVersion)?.label ??
                "医院关注指标基线"}
              （{metricTemplateVersion}）。
            </p>
            <div className={styles.stateGrid}>
              {(
                resolveMetricTemplate(metricTemplateVersion)?.catalog ??
                hospitalMetricCatalog
              ).map((catalog) => {
                const stored = collections.metrics.find(
                  (item) => String(item.code) === catalog.code,
                );
                return (
                  <article key={catalog.code}>
                    <span className={tone(String(stored?.status ?? "draft"))}>
                      {catalog.readiness} · {catalog.evidence}
                    </span>
                    <strong>{catalog.name}</strong>
                    <small>
                      {catalog.dimension} · {catalog.formula}
                    </small>
                    <small>
                      {stored ? statusLabel(String(stored.status)) : "尚未导入"}
                    </small>
                  </article>
                );
              })}
            </div>
            <div className={styles.candidateList}>
              {collections.metrics.map((item) => (
                <article key={String(item.id)}>
                  <span className={tone(String(item.status ?? "draft"))}>
                    <BadgeCheck size={15} />
                  </span>
                  <div>
                    <strong>{String(item.name ?? item.code ?? item.id)}</strong>
                    <small>
                      {String(item.code ?? "")} · v{String(item.version ?? 1)}
                    </small>
                  </div>
                  <i className={tone(String(item.status ?? "draft"))}>
                    {statusLabel(String(item.status ?? "draft"))}
                  </i>
                  {String(item.status) === "draft" ? (
                    <button
                      disabled={
                        !canReview ||
                        Boolean(operation) ||
                        (String(item.code ?? "").startsWith("hospital.") &&
                          !activatableHospitalMetricCodes.has(
                            String(item.code ?? ""),
                          ))
                      }
                      onClick={() => void activateMetricDefinition(item)}
                    >
                      {String(item.code ?? "").startsWith("hospital.") &&
                      !activatableHospitalMetricCodes.has(String(item.code ?? ""))
                        ? "暂缓启用"
                        : "审核启用"}
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </Panel>
        ) : null}
        {mappingTab === "visual" ? (
          <Panel
            title="展示配置"
            description="KPI、表格、柱状、折线、饼图、散点、热力图；可选维度、系列和排序"
          >
            <div className={styles.visualizationPicker}>
              {chartTypes.map((item) => (
                <button
                  key={item.value}
                  className={
                    selectedChart === item.value
                      ? styles.selectedVisualization
                      : ""
                  }
                  onClick={() => setSelectedChart(item.value)}
                >
                  <TableProperties size={16} />
                  {item.label}
                </button>
              ))}
            </div>
            <form
              className={styles.formGrid}
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                void callAction(
                  "save_visualization_definition",
                  {
                    metricId: String(values.get("visualMetricId") ?? ""),
                    code: String(values.get("visualCode") ?? "").trim(),
                    name: String(values.get("visualName") ?? "").trim(),
                    chartType: selectedChart,
                    dimension: String(
                      values.get("visualDimension") ?? "",
                    ).trim(),
                    series: String(values.get("visualSeries") ?? "")
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                    sort: {
                      direction: String(values.get("visualSort") ?? "desc"),
                    },
                    config: {},
                    limit: 20,
                    version: 1,
                    status: "draft",
                  },
                  "展示配置草稿已保存",
                );
              }}
            >
              <label>
                <span>指标</span>
                <select name="visualMetricId" required>
                  <option value="">请选择已保存指标</option>
                  {collections.metrics.map((item) => (
                    <option key={String(item.id)} value={String(item.id)}>
                      {String(item.name ?? item.code ?? item.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>展示名称</span>
                <input name="visualName" required />
              </label>
              <label>
                <span>展示 code</span>
                <input
                  name="visualCode"
                  placeholder="exam_volume_bar"
                  required
                />
              </label>
              <label>
                <span>维度</span>
                <input
                  name="visualDimension"
                  list="standard-field-options"
                  placeholder="选择字段维度"
                />
              </label>
              <label>
                <span>系列</span>
                <input
                  name="visualSeries"
                  list="standard-field-options"
                  placeholder="可选系列，逗号分隔"
                />
              </label>
              <label>
                <span>排序</span>
                <select name="visualSort" defaultValue="desc">
                  <option value="desc">指标值降序</option>
                  <option value="asc">指标值升序</option>
                </select>
              </label>
              <footer className={styles.formActions}>
                <button
                  className={styles.primaryButton}
                  disabled={!canClean || !collections.metrics[0]}
                >
                  保存展示草稿
                </button>
              </footer>
            </form>
            <div className={styles.candidateList}>
              {collections.visualizations.map((item) => (
                <article key={String(item.id)}>
                  <span className={tone(String(item.status ?? "draft"))}>
                    <TableProperties size={15} />
                  </span>
                  <div>
                    <strong>{String(item.name ?? item.code ?? item.id)}</strong>
                    <small>
                      {String(item.chartType ?? "图表")} ·{" "}
                      {String(item.code ?? "")}
                    </small>
                  </div>
                  <i className={tone(String(item.status ?? "draft"))}>
                    {statusLabel(String(item.status ?? "draft"))}
                  </i>
                  {String(item.status) === "draft" ? (
                    <button
                      disabled={!canReview || Boolean(operation)}
                      onClick={() => void activateVisualizationDefinition(item)}
                    >
                      审核启用
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          </Panel>
        ) : null}
      </>
    );
  }

  function renderCleaning() {
    const canonicalFields = [
      ...templateFields(selectedTemplate.code).map((item) => ({
        code: item.code,
        name: item.name,
      })),
      ...collections.fieldDefinitions.map((item) => ({
        code: String(item.code ?? ""),
        name: String(item.name ?? item.code ?? "自定义字段"),
      })),
    ].filter(
      (field, index, all) =>
        field.code &&
        all.findIndex((item) => item.code === field.code) === index,
    );
    return (
      <>
        <Heading
          eyebrow="步骤 6 · 可解释规则"
          title="清洗规则"
          description="先基于真实预览做本地预检，再由服务端配方执行；每一步保留 before、after 和 affected。"
          action={
            <div className={styles.actionRow}>
              <button
                className={styles.secondaryButton}
                onClick={runLocalCleaning}
              >
                <Play size={15} />
                本地预检
              </button>
              <button
                className={styles.primaryButton}
                disabled={!canClean || !selectedBatch || Boolean(operation)}
                onClick={() => void runServerCleaning()}
              >
                <WandSparkles size={15} />
                服务端试运行
              </button>
            </div>
          }
        />
        <Panel
          title="清洗配方编辑"
          description="字段与规则类型可编辑；正式执行时若当前数据域没有配方，将先保存再试运行。"
          action={
            <button
              className={styles.secondaryButton}
              onClick={() =>
                setRecipeRules((current) => [
                  ...current,
                  {
                    id: `rule-${crypto.randomUUID()}`,
                    type: "required",
                    field: "",
                    label: "新增必填校验",
                  },
                ])
              }
            >
              新增规则
            </button>
          }
        >
          <div className={styles.mappingGrid}>
            {recipeRules.map((rule) => (
              <label key={rule.id}>
                <select
                  value={rule.type}
                  onChange={(event) =>
                    setRecipeRules((current) =>
                      current.map((item) =>
                        item.id === rule.id
                          ? {
                              ...item,
                              type: event.target
                                .value as CleaningPreviewRule["type"],
                            }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="trim">去首尾空格</option>
                  <option value="required">必填</option>
                  <option value="number">数字校验</option>
                  <option value="deduplicate">去重</option>
                </select>
                <input
                  list="cleaning-field-options"
                  value={rule.field}
                  onChange={(event) =>
                    setRecipeRules((current) =>
                      current.map((item) =>
                        item.id === rule.id
                          ? { ...item, field: event.target.value }
                          : item,
                      ),
                    )
                  }
                  placeholder="字段名"
                />
                <button
                  type="button"
                  onClick={() =>
                    setRecipeRules((current) =>
                      current.filter((item) => item.id !== rule.id),
                    )
                  }
                  aria-label={`删除规则 ${rule.label}`}
                >
                  <X size={14} />
                </button>
              </label>
            ))}
            <datalist id="cleaning-field-options">
              {canonicalFields.map((field) => (
                <option key={field.code} value={field.code}>
                  {field.name}
                </option>
              ))}
            </datalist>
          </div>
        </Panel>
        <Panel
          title={demoMode ? "演示清洗逐步影响" : "正式服务端执行结果"}
          description={
            demoMode
              ? "本地预检不改变正式快照"
              : "仅展示服务端 run_cleaning 返回或 Curated 快照中持久化的逐步影响"
          }
        >
          {!demoMode && visibleServerCleaningImpact ? (
            <>
              <section className={styles.mappingSummary}>
                <article>
                  <strong>{visibleServerCleaningImpact.inputRows}</strong>
                  <span>输入行</span>
                </article>
                <article>
                  <strong>{visibleServerCleaningImpact.validRows}</strong>
                  <span>有效行</span>
                </article>
                <article>
                  <strong>{visibleServerCleaningImpact.quarantinedRows}</strong>
                  <span>隔离行</span>
                </article>
                <article>
                  <strong>{visibleServerCleaningImpact.issueCount}</strong>
                  <span>问题数</span>
                </article>
              </section>
              <div className={styles.impactList}>
                {visibleServerCleaningImpact.steps.map((step, index) => (
                  <article key={step.ruleId}>
                    <i>{index + 1}</i>
                    <div>
                      <strong>
                        {step.ruleType} · {step.fieldName || "组合业务键"}
                      </strong>
                      <small>
                        变更 {step.changedRows} 行 · 发现问题 {step.issueRows} 行
                      </small>
                    </div>
                    <b>{step.changedRows + step.issueRows} 行受影响</b>
                  </article>
                ))}
              </div>
            </>
          ) : demoMode && cleaningPreview ? (
            <div className={styles.impactList}>
              {cleaningPreview.steps.map((step, index) => (
                <article key={step.ruleId}>
                  <i>{index + 1}</i>
                  <div>
                    <strong>{step.label}</strong>
                    <small>
                      输入 {step.before} 行 → 输出 {step.after} 行
                    </small>
                  </div>
                  <b>{step.affected} 行受影响</b>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <Braces size={25} />
              <strong>{demoMode ? "尚未试运行" : "尚无服务端执行结果"}</strong>
              <p>
                {demoMode
                  ? "不会显示固定清洗结果。"
                  : "本地预检不会在这里冒充正式执行结果。"}
              </p>
            </div>
          )}
        </Panel>
        {!demoMode && cleaningPreview ? (
          <Panel
            title="本地预检（未写入正式快照）"
            description="仅用于执行前检查；正式结果以上方服务端记录为准"
          >
            <div className={styles.impactList}>
              {cleaningPreview.steps.map((step, index) => (
                <article key={step.ruleId}>
                  <i>{index + 1}</i>
                  <div>
                    <strong>{step.label}</strong>
                    <small>
                      输入 {step.before} 行 → 输出 {step.after} 行
                    </small>
                  </div>
                  <b>{step.affected} 行受影响</b>
                </article>
              ))}
            </div>
          </Panel>
        ) : null}
        {resourceState("recipes", "正在读取服务端清洗配方和逐步影响。")}
      </>
    );
  }

  function renderQuality() {
    const reviewBatches = batches.filter(
      (item) => item.status === "pending_review" || item.status === "待复核",
    );
    const rows = [
      ...serverQuarantine
        .reduce((groups, item) => {
          const current = groups.get(item.recordId) ?? {
            rowId: item.recordId,
            row: Object.fromEntries(
              Object.entries(item.record ?? {}).map(([key, value]) => [
                key,
                String(value ?? ""),
              ]),
            ),
            errors: [],
          };
          current.errors.push({
            ruleId: item.issueId,
            field: item.fieldName,
            message: item.message,
          });
          groups.set(item.recordId, current);
          return groups;
        }, new Map<string, QuarantinedPreviewRow>())
        .values(),
    ];
    const shown = rows.length ? rows : demoMode ? localQuarantine : [];
    return (
      <>
        <Heading
          eyebrow="步骤 7 · 行级闭环"
          title="数据质量与隔离"
          description="正式质量数字来自批次与 quarantine 资源；支持行级在线修复、重新校验和错误下载。"
          action={
            <button
              className={styles.secondaryButton}
              disabled={!shown.length}
              onClick={() => {
                if (demoMode)
                  downloadText("隔离错误.csv", quarantineRowsToCsv(shown));
                else
                  window.location.assign(
                    client.resourceUrl("quarantine", { format: "csv" }),
                  );
              }}
            >
              <Download size={15} />
              下载错误
            </button>
          }
        />
        {reviewBatches.length ? (
          <Panel
            title="批次质量复核"
            description="复核通过调用 advance_import 进入 ready；退回则回到 pending_mapping。"
          >
            <div className={styles.candidateList}>
              {reviewBatches.map((item) => (
                <article key={item.id}>
                  <span className={styles.warning}>
                    <FileClock size={15} />
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.id} · revision {item.revision ?? 1}
                    </small>
                  </div>
                  <i className={styles.warning}>待复核</i>
                  <div className={styles.publishActions}>
                    <button
                      disabled={!canIngest || Boolean(operation)}
                      onClick={() => void reviewImport(item, "pending_mapping")}
                    >
                      退回重新映射
                    </button>
                    <button
                      disabled={!canReview || Boolean(operation)}
                      onClick={() => void reviewImport(item, "ready")}
                    >
                      复核通过
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        ) : null}
        {isPlatformAdmin && breakGlassImportId ? (
          <div
            className={styles.rowEditor}
            role="dialog"
            aria-modal="true"
            aria-label="平台管理员批次紧急复核"
          >
            <header>
              <strong>批次紧急复核</strong>
              <button
                onClick={() => setBreakGlassImportId("")}
                aria-label="关闭批次紧急复核"
              >
                <X size={16} />
              </button>
            </header>
            <div className={styles.capabilityNote}>
              <AlertTriangle size={18} />
              <div>
                <strong>此操作绕过正常四眼复核</strong>
                <p>理由、操作者与批次 revision 会进入审计。</p>
              </div>
            </div>
            <label>
              <span>breakGlassReason（至少 20 字）</span>
              <textarea
                rows={4}
                value={breakGlassImportReason}
                onChange={(event) =>
                  setBreakGlassImportReason(event.target.value)
                }
              />
            </label>
            <footer>
              <button
                className={styles.secondaryButton}
                onClick={() => setBreakGlassImportId("")}
              >
                取消
              </button>
              <button
                className={styles.primaryButton}
                disabled={
                  breakGlassImportReason.trim().length < 20 ||
                  Boolean(operation)
                }
                onClick={() => {
                  const item = batches.find(
                    (batch) => batch.id === breakGlassImportId,
                  );
                  if (item)
                    void reviewImport(
                      item,
                      "ready",
                      breakGlassImportReason.trim(),
                    );
                }}
              >
                确认紧急复核通过
              </button>
            </footer>
          </div>
        ) : null}
        {quality ? (
          <section className={styles.mappingSummary}>
            <article>
              <strong>{quality.total.toLocaleString("zh-CN")}</strong>
              <span>批次总行数</span>
              <small>{selectedBatch?.id}</small>
            </article>
            <article>
              <strong>{quality.valid.toLocaleString("zh-CN")}</strong>
              <span>有效</span>
              <small>{quality.passRate}%</small>
            </article>
            <article>
              <strong>{quality.warning}</strong>
              <span>预警</span>
              <small>保留明细</small>
            </article>
            <article>
              <strong>{quality.rejected}</strong>
              <span>隔离</span>
              <small>可逐行修复</small>
            </article>
          </section>
        ) : (
          resourceState("imports", "质量统计等待真实批次。")
        )}
        {shown.length ? (
          <Panel
            title="行级隔离"
            description="修复必须携带 snapshotId、rowId 与 baseRevision"
          >
            <div className={styles.quarantineList}>
              {shown.map((item) => (
                <article key={item.rowId}>
                  <span className={styles.danger}>
                    <CircleAlert size={14} />
                    隔离
                  </span>
                  <div>
                    <strong>{item.rowId}</strong>
                    <small>
                      {item.errors
                        .map((entry) => `${entry.field}: ${entry.message}`)
                        .join("；")}
                    </small>
                  </div>
                  <button
                    onClick={() => {
                      setRepairingRow(item);
                      setRepairValue(
                        item.row[item.errors[0]?.field ?? ""] ?? "",
                      );
                    }}
                  >
                    <PencilLine size={14} />
                    在线修复
                  </button>
                </article>
              ))}
            </div>
          </Panel>
        ) : (
          resourceState("quarantine", "当前没有隔离记录，或当前文件能力尚未开放。")
        )}
        {repairingRow ? (
          <div
            className={styles.rowEditor}
            role="dialog"
            aria-modal="true"
            aria-label="在线修复隔离记录"
          >
            <header>
              <strong>在线修复 · {repairingRow.rowId}</strong>
              <button onClick={() => setRepairingRow(null)} aria-label="关闭">
                <X size={16} />
              </button>
            </header>
            <label>
              <span>{repairingRow.errors[0]?.field}</span>
              <input
                value={repairValue}
                onChange={(event) => setRepairValue(event.target.value)}
              />
            </label>
            <footer>
              <button
                className={styles.secondaryButton}
                onClick={() => setRepairingRow(null)}
              >
                取消
              </button>
              <button
                className={styles.primaryButton}
                disabled={!serverQuarantine.length || Boolean(operation)}
                onClick={() => void repairServerRow()}
              >
                提交修复并重检
              </button>
            </footer>
          </div>
        ) : null}
      </>
    );
  }

  function renderReconciliation() {
    const serverResult = reconciliationRuns[0];
    const serverDifferences = serverResult
      ? reconciliationDifferences.filter(
          (item) => String(item.runId ?? "") === String(serverResult.id ?? ""),
        )
      : [];
    return (
      <>
        <Heading
          eyebrow="步骤 8 · 跨文件核对"
          title="文件对账"
          description="选择左右两个真实快照，配置业务主键与比较字段；不使用固定对账数。"
          action={
            <button
              className={styles.primaryButton}
              disabled={
                !canClean ||
                !leftSnapshot ||
                !rightSnapshot ||
                leftSnapshot === rightSnapshot ||
                Boolean(operation)
              }
              onClick={() => void runReconciliation()}
            >
              <Blocks size={15} />
              运行服务端对账
            </button>
          }
        />
        <Panel title="对账配置" description="两个版本可来自不同文件批次">
          <div className={styles.formGrid}>
            <label>
              <span>左侧快照</span>
              <select
                value={leftSnapshot}
                onChange={(event) => setLeftSnapshot(event.target.value)}
              >
                <option value="">请选择</option>
                {snapshots.map((item) => (
                  <option value={String(item.id)} key={String(item.id)}>
                    {String(item.fileName ?? item.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>右侧快照</span>
              <select
                value={rightSnapshot}
                onChange={(event) => setRightSnapshot(event.target.value)}
              >
                <option value="">请选择</option>
                {snapshots.map((item) => (
                  <option value={String(item.id)} key={String(item.id)}>
                    {String(item.fileName ?? item.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>业务主键</span>
              <input
                value={keyFields}
                onChange={(event) => setKeyFields(event.target.value)}
              />
            </label>
            <label>
              <span>比较字段</span>
              <input
                value={compareFields}
                onChange={(event) => setCompareFields(event.target.value)}
              />
            </label>
          </div>
        </Panel>
        {serverResult ? (
          <section className={styles.reconcileSummary}>
            {[
              ["matchedCount", "matched"],
              ["mismatchCount", "changed"],
              ["leftOnlyCount", "leftOnly"],
              ["rightOnlyCount", "rightOnly"],
            ].map(([key, label]) => (
              <article key={key}>
                <span>{label}</span>
                <strong>
                  {Number(serverResult[key] ?? 0).toLocaleString("zh-CN")}
                </strong>
                <small>服务端对账结果</small>
              </article>
            ))}
          </section>
        ) : localReconciliation ? (
          <section className={styles.reconcileSummary}>
            <article>
              <span>matched</span>
              <strong>{localReconciliation.matched}</strong>
            </article>
            <article>
              <span>changed</span>
              <strong>{localReconciliation.changed}</strong>
            </article>
            <article>
              <span>leftOnly</span>
              <strong>{localReconciliation.leftOnly}</strong>
            </article>
            <article>
              <span>rightOnly</span>
              <strong>{localReconciliation.rightOnly}</strong>
            </article>
          </section>
        ) : (
          resourceState("reconciliations", "暂无真实文件对账结果。")
        )}
        {serverResult ? (
          <Panel
            title="对账差异明细"
            description="以下行来自服务端持久化 differences；左右值保持原始对账快照语义"
          >
            {serverDifferences.length ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>业务键</th>
                      <th>差异类型</th>
                      <th>字段</th>
                      <th>左侧值</th>
                      <th>右侧值</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serverDifferences.map((item, index) => (
                      <tr key={String(item.id ?? `${serverResult.id}-${index}`)}>
                        <td>
                          <code>{String(item.matchKey ?? "—")}</code>
                        </td>
                        <td>
                          <span className={tone(String(item.differenceType ?? ""))}>
                            {String(item.differenceType ?? "差异")}
                          </span>
                        </td>
                        <td>{String(item.fieldName ?? "—") || "—"}</td>
                        <td>
                          <code>{displayStoredValue(item.leftValueJson)}</code>
                        </td>
                        <td>
                          <code>{displayStoredValue(item.rightValueJson)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.emptyState}>
                <CheckCircle2 size={24} />
                <strong>当前对账运行没有持久化差异</strong>
                <p>该运行可作为多文件发布门禁的无差异证据。</p>
              </div>
            )}
          </Panel>
        ) : null}
        {demoMode && preview?.rows.length ? (
          <button
            className={styles.secondaryButton}
            onClick={() =>
              setLocalReconciliation(
                reconcileFileRows(preview.rows, preview.rows, {
                  keyFields: keyFields.split(",").map((item) => item.trim()),
                  compareFields: compareFields
                    .split(",")
                    .map((item) => item.trim()),
                }),
              )
            }
          >
            演示：用当前预览自对账
          </button>
        ) : null}
      </>
    );
  }

  function renderPublishing() {
    const readyImportIds = new Set(
      batches
        .filter((item) => item.status === "ready" || item.status === "可发布")
        .map((item) => item.id),
    );
    const curatedCandidates = snapshots.filter(
      (item) =>
        String(item.layer ?? "") === "curated" &&
        String(item.status ?? "") === "ready" &&
        readyImportIds.has(String(item.importJobId ?? "")),
    );
    const latestVersionByImport = new Map<string, number>();
    curatedCandidates.forEach((item) => {
      const importId = String(item.importJobId ?? "");
      latestVersionByImport.set(
        importId,
        Math.max(
          latestVersionByImport.get(importId) ?? 0,
          Number(item.version ?? 0),
        ),
      );
    });
    const eligibleSnapshots = curatedCandidates.filter(
      (item) =>
        Number(item.version ?? 0) ===
        latestVersionByImport.get(String(item.importJobId ?? "")),
    );
    const selectedRows = eligibleSnapshots.filter((item) =>
      selectedPublishIds.includes(String(item.id)),
    );
    const impactRows = selectedRows.reduce(
      (sum, item) => sum + Number(item.rowCount ?? 0),
      0,
    );
    const activeMetrics = collections.metrics.filter(
      (item) => String(item.status) === "active",
    );
    const activeVisualizations = collections.visualizations.filter(
      (item) => String(item.status) === "active",
    );
    const waiverTooShort =
      selectedPublishIds.length > 1 &&
      Boolean(reconciliationWaiverReason.trim()) &&
      reconciliationWaiverReason.trim().length < 20;
    const rollbackTarget = publishes.find(
      (item) => item.id === rollbackTargetId && item.status === "superseded",
    );
    return (
      <>
        <Heading
          eyebrow="步骤 9 · 双角色门禁"
          title="审核与发布"
          description="发布草稿、提交审核、另一角色批准、正式发布相互分离；创建人不能审核自己的发布。"
          action={
            <button
              className={styles.primaryButton}
              disabled={
                !canClean ||
                !selectedPublishIds.length ||
                !selectedMetricIds.length ||
                !selectedVisualizationIds.length ||
                waiverTooShort ||
                Boolean(operation)
              }
              onClick={() => void createPublish()}
            >
              <Rocket size={15} />
              {correctionOfId ? "创建更正版草稿" : "创建发布草稿"}
            </button>
          }
        />
        {!selectedMetricIds.length || !selectedVisualizationIds.length ? (
          <div className={styles.capabilityNote}>
            <AlertTriangle size={18} />
            <div>
              <strong>发布定义尚未选齐</strong>
              <p>
                至少选择 1 个 active 指标和 1 个引用该指标的 active
                展示，才能创建可被下游读取的版本。
              </p>
            </div>
          </div>
        ) : null}
        {correctionOfId ? (
          <div className={styles.capabilityNote}>
            <History size={18} />
            <div>
              <strong>正在创建更正版本</strong>
              <p>
                基于 {correctionOfId}，使用当前选中的 curated
                快照和定义生成新草稿，不覆盖旧版本。
              </p>
            </div>
            <button onClick={() => setCorrectionOfId("")}>取消更正</button>
          </div>
        ) : null}
        {!publishes.some((item) => item.status === "published") ? (
          <div className={styles.capabilityNote}>
            <Rocket size={18} />
            <div>
              <strong>本院尚无正式发布版本</strong>
              <p>
                可一键把示范数据包（设备台账 / 检查 / 收费 / 成本 / 利用五类文件）按完整治理链路
                导入并直接发布为当前供数版本；全部批次和血缘都会带“示范数据包”标识，
                已有正式发布版本的医院会被拒绝以防覆盖真实数据。
              </p>
            </div>
            <button
              className={styles.primaryButton}
              disabled={!canPublish || Boolean(operation)}
              title={canPublish ? "" : "需要 data.publish 权限"}
              onClick={() => setSamplePublishConfirm(true)}
            >
              <Rocket size={15} />
              一键载入示范数据并正式发布
            </button>
          </div>
        ) : null}
        {samplePublishConfirm ? (
          <div
            className={styles.rowEditor}
            role="dialog"
            aria-modal="true"
            aria-label="确认载入示范数据并正式发布"
          >
            <strong>确认把示范数据发布为当前供数版本？</strong>
            <p>
              将创建 5 个带“示范数据包”标识的导入批次（设备台账 / 检查 / 收费 / 成本 / 利用），
              经完整治理链路后发布为 hospital-current-supply 当前供数版本，前台正式模式随即显示这批数据。
              该操作会写入血缘与审计记录；已有正式发布版本的医院会被服务端拒绝，不会覆盖真实数据。
            </p>
            <footer>
              <button className={styles.secondaryButton} onClick={() => setSamplePublishConfirm(false)}>取消</button>
              <button
                className={styles.primaryButton}
                disabled={Boolean(operation)}
                onClick={() => {
                  setSamplePublishConfirm(false);
                  void callAction("publish_sample_dataset", {}, "示范数据已完成正式发布，前台稍后自动刷新")
                    .then((result) => { if (result) retryResources(); });
                }}
              >
                确认发布
              </button>
            </footer>
          </div>
        ) : null}
        <Panel
          title="发布影响预览"
          description="只显示批次、快照、行数与下游影响；不从 manifestJson 内嵌或读取记录行"
        >
          <div className={styles.publishImpact}>
            <div>
              <small>选中可发布快照</small>
              <strong>{selectedRows.length}</strong>
            </div>
            <div>
              <small>预计行数</small>
              <strong>{impactRows.toLocaleString("zh-CN")}</strong>
            </div>
            <div>
              <small>影响对象</small>
              <strong>
                {selectedMetricIds.length} 指标 /{" "}
                {selectedVisualizationIds.length} 展示
              </strong>
            </div>
          </div>
          <div className={styles.batchChooser}>
            {eligibleSnapshots.map((item) => (
              <label key={String(item.id)}>
                <input
                  type="checkbox"
                  checked={selectedPublishIds.includes(String(item.id))}
                  onChange={(event) =>
                    setSelectedPublishIds((current) =>
                      event.target.checked
                        ? [...current, String(item.id)]
                        : current.filter((id) => id !== String(item.id)),
                    )
                  }
                />
                <span>
                  <strong>{String(item.fileName ?? item.id)}</strong>
                  <small>
                    {Number(item.rowCount ?? 0).toLocaleString("zh-CN")} 行 ·{" "}
                    {String(item.dataDomain ?? "curated")}
                  </small>
                </span>
              </label>
            ))}
            {!eligibleSnapshots.length ? (
              <p>暂无 ready 状态的 curated 快照；请先完成映射与清洗。</p>
            ) : null}
          </div>
          <div className={styles.formGrid}>
            <label>
              <span>多部位分摊规则</span>
              <select
                value={allocationRule}
                onChange={(event) =>
                  setAllocationRule(event.target.value as typeof allocationRule)
                }
              >
                <option value="equal_by_body_part">按部位等额分摊</option>
                <option value="weighted_by_body_part">按部位权重分摊</option>
                <option value="primary_body_part">全部归入主部位</option>
              </select>
              <small>
                检查人次始终按 distinct examId 计算，不按部位行数计算。
              </small>
            </label>
            {selectedPublishIds.length > 1 ? (
              <label>
                <span>对账门禁豁免理由（可选）</span>
                <textarea
                  rows={4}
                  value={reconciliationWaiverReason}
                  disabled={!canReview}
                  onChange={(event) =>
                    setReconciliationWaiverReason(event.target.value)
                  }
                  placeholder="仅在多快照存在合理差异、且拥有 data.review 权限时填写；不少于 20 字"
                />
                <small>
                  留空时必须由无差异对账结果连通覆盖所有所选快照；填写后需至少 20
                  字并写入审核审计。
                </small>
                {waiverTooShort ? (
                  <em role="alert">已填写的豁免理由不足 20 字。</em>
                ) : null}
              </label>
            ) : null}
          </div>
          <h3>选择进入发布 manifest 的已启用指标</h3>
          <div className={styles.batchChooser}>
            {activeMetrics.map((item) => (
              <label key={String(item.id)}>
                <input
                  type="checkbox"
                  checked={selectedMetricIds.includes(String(item.id))}
                  onChange={(event) =>
                    setSelectedMetricIds((current) =>
                      event.target.checked
                        ? [...current, String(item.id)]
                        : current.filter((id) => id !== String(item.id)),
                    )
                  }
                />
                <span>
                  <strong>{String(item.name ?? item.code)}</strong>
                  <small>{String(item.code)}</small>
                </span>
              </label>
            ))}
            {!activeMetrics.length ? <p>暂无已审核启用的指标定义。</p> : null}
          </div>
          <h3>选择进入发布 manifest 的已启用展示</h3>
          <div className={styles.batchChooser}>
            {activeVisualizations.map((item) => (
              <label key={String(item.id)}>
                <input
                  type="checkbox"
                  checked={selectedVisualizationIds.includes(String(item.id))}
                  onChange={(event) => {
                    setSelectedVisualizationIds((current) =>
                      event.target.checked
                        ? [...current, String(item.id)]
                        : current.filter((id) => id !== String(item.id)),
                    );
                    if (event.target.checked && item.metricId)
                      setSelectedMetricIds((current) =>
                        current.includes(String(item.metricId))
                          ? current
                          : [...current, String(item.metricId)],
                      );
                  }}
                />
                <span>
                  <strong>{String(item.name ?? item.code)}</strong>
                  <small>
                    {String(item.chartType)} · {String(item.code)}
                  </small>
                </span>
              </label>
            ))}
            {!activeVisualizations.length ? (
              <p>暂无已审核启用的展示定义。</p>
            ) : null}
          </div>
        </Panel>
        {publishes.length ? (
          <Panel title="版本审核流" description="审核人与创建人必须不同">
            <div className={styles.candidateList}>
              {publishes.map((item) => (
                <article key={item.id}>
                  <span className={tone(item.status)}>
                    <FileClock size={16} />
                  </span>
                  <div>
                    <strong>
                      {item.seriesId}@{item.version}
                    </strong>
                    <small>
                      {item.dataDomain} ·{" "}
                      {item.rowCount.toLocaleString("zh-CN")} 行 · snapshot{" "}
                      {item.publishedSnapshotId ??
                        item.curatedSnapshotId ??
                        "待生成"}
                    </small>
                    <p>
                      {(item.correctionOfId ?? item.correctionOf)
                        ? `更正版本：基于 ${item.correctionOfId ?? item.correctionOf}`
                        : (item.rollbackOfId ?? item.rollbackOf)
                          ? `回滚版本：基于 ${item.rollbackOfId ?? item.rollbackOf}`
                          : item.reviewComment || "暂无审核意见"}
                    </p>
                  </div>
                  <i className={tone(item.status)}>
                    {statusLabel(item.status)}
                  </i>
                  <div className={styles.publishActions}>
                    {item.status === "draft" ? (
                      <button
                        disabled={!canClean}
                        onClick={() =>
                          void transitionPublish(item, "pending_review")
                        }
                      >
                        提交审核
                      </button>
                    ) : null}
                    {item.status === "pending_review" ? (
                      <>
                        <button
                          disabled={!canReview}
                          onClick={() =>
                            void transitionPublish(item, "rejected")
                          }
                        >
                          驳回
                        </button>
                        <button
                          disabled={!canReview}
                          onClick={() =>
                            void transitionPublish(item, "approved")
                          }
                        >
                          另一角色批准
                        </button>
                      </>
                    ) : null}
                    {item.status === "approved" ? (
                      <button
                        disabled={!canPublish}
                        onClick={() =>
                          void transitionPublish(item, "published")
                        }
                      >
                        正式发布
                      </button>
                    ) : null}
                    {item.status === "published" ? (
                      <>
                        <button
                          disabled={!canClean}
                          onClick={() => {
                            setCorrectionOfId(item.id);
                            inform(
                              "已选择当前发布版本作为更正来源；请勾选新的 curated 快照和发布定义",
                            );
                          }}
                        >
                          创建更正版
                        </button>
                        <span>如需回滚，请在历史版本中选择目标。</span>
                      </>
                    ) : null}
                    {item.status === "superseded" ? (
                      <button
                        disabled={!canPublish}
                        onClick={() => {
                          setRollbackTargetId(item.id);
                          setRollbackReason("");
                        }}
                      >
                        回滚到此版本
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        ) : (
          resourceState("publishes", "暂无真实发布版本。")
        )}
        {rollbackTarget ? (
          <div
            className={styles.rowEditor}
            role="dialog"
            aria-modal="true"
            aria-label="填写回滚理由"
          >
            <header>
              <strong>
                回滚到 {rollbackTarget.seriesId}@{rollbackTarget.version}
              </strong>
              <button
                onClick={() => setRollbackTargetId("")}
                aria-label="关闭回滚确认"
              >
                <X size={16} />
              </button>
            </header>
            <div className={styles.capabilityNote}>
              <History size={18} />
              <div>
                <strong>回滚会创建新的发布草稿</strong>
                <p>不会覆盖当前版本，仍需完成提交、独立审核、批准和正式发布。</p>
              </div>
            </div>
            <label>
              <span>真实回滚理由（至少 20 字）</span>
              <textarea
                rows={5}
                value={rollbackReason}
                onChange={(event) => setRollbackReason(event.target.value)}
                placeholder="请说明异常范围、判断依据和期望恢复的历史版本"
              />
            </label>
            <footer>
              <button
                className={styles.secondaryButton}
                onClick={() => setRollbackTargetId("")}
              >
                取消
              </button>
              <button
                className={styles.primaryButton}
                disabled={
                  !canPublish ||
                  rollbackReason.trim().length < 20 ||
                  Boolean(operation)
                }
                onClick={() => void rollbackPublish(rollbackTarget)}
              >
                确认创建回滚草稿
              </button>
            </footer>
          </div>
        ) : null}
        {isPlatformAdmin && breakGlassPublishId ? (
          <div
            className={styles.rowEditor}
            role="dialog"
            aria-modal="true"
            aria-label="平台管理员紧急复核"
          >
            <header>
              <strong>平台管理员紧急复核</strong>
              <button
                onClick={() => setBreakGlassPublishId("")}
                aria-label="关闭紧急复核"
              >
                <X size={16} />
              </button>
            </header>
            <div className={styles.capabilityNote}>
              <AlertTriangle size={18} />
              <div>
                <strong>此操作绕过正常四眼复核</strong>
                <p>不会自动执行；理由、操作者和发布版本会写入审计。</p>
              </div>
            </div>
            <label>
              <span>breakGlassReason（至少 20 字）</span>
              <textarea
                value={breakGlassReason}
                onChange={(event) => setBreakGlassReason(event.target.value)}
                rows={4}
              />
            </label>
            <footer>
              <button
                className={styles.secondaryButton}
                onClick={() => setBreakGlassPublishId("")}
              >
                取消
              </button>
              <button
                className={styles.primaryButton}
                disabled={
                  breakGlassReason.trim().length < 20 || Boolean(operation)
                }
                onClick={() => {
                  const item = publishes.find(
                    (publish) => publish.id === breakGlassPublishId,
                  );
                  if (item)
                    void transitionPublish(
                      item,
                      breakGlassStatus,
                      breakGlassReason.trim(),
                    );
                }}
              >
                确认紧急{breakGlassStatus === "approved" ? "批准" : "驳回"}
              </button>
            </footer>
          </div>
        ) : null}
      </>
    );
  }

  function renderLineage() {
    const lineage = collections.lineage;
    const snapshotsData = collections.snapshots;
    return (
      <>
        <Heading
          eyebrow="步骤 10 · 可追溯版本"
          title="血缘与回滚"
          description="从文件原件、解析批次、映射、清洗快照、发布版本追溯到更正与回滚。"
        />
        {lineage.length ? (
          <Panel title="真实血缘事件" description="按服务端审计时间排序">
            <div className={styles.auditList}>
              {lineage.map((item, index) => (
                <article key={String(item.id ?? index)}>
                  <span>
                    <History size={15} />
                  </span>
                  <div>
                    <strong>{String(item.action ?? "操作")}</strong>
                    <small>
                      {String(item.resourceType ?? "resource")} ·{" "}
                      {String(item.resourceId ?? "")} ·{" "}
                      {String(item.createdAt ?? "")}
                    </small>
                  </div>
                  <i className={tone(String(item.toStatus ?? "draft"))}>
                    {statusLabel(String(item.toStatus ?? "记录"))}
                  </i>
                </article>
              ))}
            </div>
          </Panel>
        ) : (
          resourceState("lineage", "暂无血缘审计事件。")
        )}
        {snapshotsData.length ? (
          <Panel
            title="不可变快照与更正链"
            description="更正产生新快照；回滚产生可审计的新发布版本，不覆盖历史"
          >
            <div className={styles.lineageGraph}>
              {snapshotsData.map((item, index) => (
                <div className={styles.lineageNodeWrap} key={String(item.id)}>
                  <button>
                    <small>快照 {index + 1}</small>
                    <strong>{String(item.fileName ?? item.id)}</strong>
                    <span>
                      {Number(item.rowCount ?? 0).toLocaleString("zh-CN")} 行 ·{" "}
                      {String(item.sha256 ?? item.hash ?? "").slice(0, 12)}
                    </span>
                  </button>
                  {index < snapshotsData.length - 1 ? (
                    <span>
                      <ArrowRight size={16} />
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </Panel>
        ) : (
          resourceState("snapshots", "暂无快照，因此不能显示更正版本或回滚链。")
        )}
      </>
    );
  }

  const content =
    section === "overview"
      ? renderOverview()
      : section === "sources"
        ? renderSources()
        : section === "imports"
          ? renderImports()
          : section === "batches"
            ? renderBatches()
            : section === "mapping"
              ? renderMapping()
              : section === "cleaning"
                ? renderCleaning()
                : section === "quality"
                  ? renderQuality()
                  : section === "reconciliation"
                    ? renderReconciliation()
                    : section === "publishing"
                      ? renderPublishing()
                      : renderLineage();
  const current =
    DATA_WORKBENCH_SECTIONS.find((item) => item.id === section) ??
    DATA_WORKBENCH_SECTIONS[0];

  return (
    <div
      className={styles.shell}
      data-entry-clicks={DATA_WORKBENCH_ENTRY_CLICKS}
    >
      <aside
        className={`${styles.sidebar} ${mobileNav ? styles.mobileOpen : ""}`}
      >
        <header className={styles.sidebarHeader}>
          <span>
            <Database size={20} />
          </span>
          <div>
            <small>勇虹医疗</small>
            <strong>文件数据中心</strong>
          </div>
          <button
            onClick={() => setMobileNav(false)}
            aria-label="关闭文件数据中心导航"
          >
            <X size={18} />
          </button>
        </header>
        <div className={styles.hospitalContext}>
          <ShieldCheck size={15} />
          <div>
            <small>当前医院数据空间</small>
            <strong>{hospitalName}</strong>
            <code>{hospitalId}</code>
          </div>
        </div>
        <nav aria-label="数据准备中心导航">
          {DATA_WORKBENCH_SECTIONS.map((item, index) => (
            <button
              key={item.id}
              className={item.id === section ? styles.active : ""}
              aria-current={item.id === section ? "page" : undefined}
              onClick={() => open(item.id)}
            >
              <span>{icons[item.id]}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </div>
              <i>{String(index + 1).padStart(2, "0")}</i>
            </button>
          ))}
        </nav>
        <footer>
          <button onClick={onExit}>
            <ArrowLeft size={15} />
            返回设备效益平台
          </button>
          <span>
            <LockKeyhole size={12} />{DATA_WORKBENCH_ENTRY_CLICKS} 击口令入口 · 服务端最终鉴权
          </span>
        </footer>
      </aside>
      {mobileNav ? (
        <button
          className={styles.mobileMask}
          aria-label="关闭导航"
          onClick={() => setMobileNav(false)}
        />
      ) : null}
      <main className={styles.main}>
        <header className={styles.topbar}>
          <button
            className={styles.menuButton}
            onClick={() => setMobileNav(true)}
            aria-label="打开文件数据中心导航"
          >
            <Menu size={18} />
          </button>
          <div>
            <span>文件数据中心</span>
            <ChevronRight size={13} />
            <strong>{current.label}</strong>
          </div>
          <div className={styles.topbarMeta}>
            <span>
              <Clock3 size={13} />
              {demoMode ? "演示模式" : "正式文件数据"}
            </span>
            <span className={styles.environment}>
              <CircleDot size={12} />
              Excel / CSV / JSON
            </span>
          </div>
        </header>
        <div className={styles.content}>
          {error && section !== "imports" ? (
            <div className={styles.errorBanner} role="alert">
              <CircleAlert size={16} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="关闭错误">
                <X size={14} />
              </button>
            </div>
          ) : null}
          {content}
        </div>
      </main>
      {notice ? (
        <div className={styles.toast} role="status">
          <CheckCircle2 size={16} />
          {notice}
        </div>
      ) : null}
    </div>
  );
}
