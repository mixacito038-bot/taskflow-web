import type {
  ExamAllocationRule,
  PublishedChartType,
  PublishedDatasetPayload,
  PublishedDatasetPublication,
  PublishedMetricDefinition,
  PublishedVisualizationDefinition,
} from "./published-data";

type JsonRecord = Record<string, unknown>;

export type StoredMetricDefinition = {
  id: string;
  code: string;
  name: string;
  formula: string;
  aggregation: string;
  numerator: string;
  denominator: string;
  dimensionsJson: string;
  sourceFieldRefsJson: string;
  unit: string;
  version: number;
};

export type StoredVisualizationDefinition = {
  id: string;
  code: string;
  name: string;
  metricId: string;
  chartType: string;
  dimension: string;
  seriesJson: string;
  sortJson: string;
  limit: number;
  version: number;
};

export type PublishedSource = {
  dataDomain?: string;
  publish: {
    id: string;
    seriesId: string;
    version: number;
    status: string;
    mappingVersion?: string;
    ruleVersion?: string;
    publishedAt: string | null;
    correctionOfId?: string | null;
    rollbackOfId?: string | null;
  };
  snapshot: { id: string; sha256: string; rowCount: number; mappingVersion?: string; ruleVersion?: string };
  manifest: JsonRecord;
  records: JsonRecord[];
};

const chartTypes = new Set<PublishedChartType>(["kpi", "table", "bar", "line", "pie", "scatter", "heatmap"]);
const aggregations = new Set<PublishedMetricDefinition["aggregation"]>(["sum", "avg", "min", "max", "count", "distinct_count", "ratio", "custom"]);
const allocationRules = new Set<ExamAllocationRule>(["equal_by_body_part", "weighted_by_body_part", "primary_body_part"]);

function jsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string, fallback: unknown): unknown {
  try { return JSON.parse(value); } catch { return fallback; }
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function definitionsFromManifest(manifest: JsonRecord) {
  const definitions = jsonRecord(manifest.definitions) ? manifest.definitions : {};
  const metrics = Array.isArray(definitions.metrics) ? definitions.metrics.flatMap((item) => jsonRecord(item)
    && typeof item.id === "string" && typeof item.code === "string" && Number.isSafeInteger(item.version)
    ? [{ id: item.id, code: item.code, version: Number(item.version) }] : []) : [];
  const visualizations = Array.isArray(definitions.visualizations) ? definitions.visualizations.flatMap((item) => jsonRecord(item)
    && typeof item.id === "string" && typeof item.code === "string" && Number.isSafeInteger(item.version)
    ? [{ id: item.id, code: item.code, version: Number(item.version), metricId: typeof item.metricId === "string" ? item.metricId : "" }] : []) : [];
  return {
    metricDefinitionIds: [...new Set([...stringArray(definitions.metricDefinitionIds), ...metrics.map((item) => item.id)])],
    visualizationDefinitionIds: [...new Set([...stringArray(definitions.visualizationDefinitionIds), ...visualizations.map((item) => item.id)])],
    metrics,
    visualizations,
  };
}

export function publishedDefinitionIds(sources: readonly PublishedSource[]) {
  const metricDefinitionIds = new Set<string>();
  const visualizationDefinitionIds = new Set<string>();
  const metrics = new Map<string, { id: string; code: string; version: number }>();
  const visualizations = new Map<string, { id: string; code: string; version: number; metricId: string }>();
  let contractConflict = false;
  sources.forEach((source) => {
    const definitions = definitionsFromManifest(source.manifest);
    definitions.metricDefinitionIds.forEach((id) => metricDefinitionIds.add(id));
    definitions.visualizationDefinitionIds.forEach((id) => visualizationDefinitionIds.add(id));
    definitions.metrics.forEach((item) => {
      const existing = metrics.get(item.id);
      if (existing && (existing.code !== item.code || existing.version !== item.version)) contractConflict = true;
      metrics.set(item.id, item);
    });
    definitions.visualizations.forEach((item) => {
      const existing = visualizations.get(item.id);
      if (existing && (existing.code !== item.code || existing.version !== item.version || existing.metricId !== item.metricId)) contractConflict = true;
      visualizations.set(item.id, item);
    });
  });
  return { metricDefinitionIds: [...metricDefinitionIds], visualizationDefinitionIds: [...visualizationDefinitionIds], metrics: [...metrics.values()], visualizations: [...visualizations.values()], contractConflict };
}

export function publishedDefinitionContractMatches(
  frozen: ReturnType<typeof publishedDefinitionIds>,
  metricRows: readonly StoredMetricDefinition[],
  visualizationRows: readonly StoredVisualizationDefinition[],
) {
  if (frozen.contractConflict) return false;
  if (frozen.metrics.length && frozen.metrics.some((item) => {
    const stored = metricRows.find((row) => row.id === item.id);
    return !stored || stored.code !== item.code || stored.version !== item.version;
  })) return false;
  if (frozen.visualizations.length && frozen.visualizations.some((item) => {
    const stored = visualizationRows.find((row) => row.id === item.id);
    return !stored || stored.code !== item.code || stored.version !== item.version || (item.metricId && stored.metricId !== item.metricId);
  })) return false;
  return true;
}

export function normalizePublishedDefinitions(
  metricRows: readonly StoredMetricDefinition[],
  visualizationRows: readonly StoredVisualizationDefinition[],
) {
  const metricDefinitions = metricRows.flatMap((row): PublishedMetricDefinition[] => {
    if (!aggregations.has(row.aggregation as PublishedMetricDefinition["aggregation"])) return [];
    return [{
      id: row.id,
      code: row.code,
      name: row.name,
      formula: row.formula,
      aggregation: row.aggregation as PublishedMetricDefinition["aggregation"],
      numerator: row.numerator,
      denominator: row.denominator,
      dimensions: stringArray(parseJson(row.dimensionsJson, [])),
      sourceFieldRefs: stringArray(parseJson(row.sourceFieldRefsJson, [])),
      unit: row.unit,
      version: row.version,
    }];
  });
  const metricCodes = new Map(metricDefinitions.map((definition) => [definition.id, definition.code]));
  const visualizationDefinitions = visualizationRows.flatMap((row): PublishedVisualizationDefinition[] => {
    if (!chartTypes.has(row.chartType as PublishedChartType) || !metricCodes.has(row.metricId)) return [];
    const seriesValue = parseJson(row.seriesJson, []);
    const series = Array.isArray(seriesValue)
      ? seriesValue.find((item): item is string => typeof item === "string") ?? ""
      : jsonRecord(seriesValue) && typeof seriesValue.field === "string" ? seriesValue.field : "";
    const sortValue = parseJson(row.sortJson, {});
    const sortCandidate = jsonRecord(sortValue) ? sortValue.direction ?? sortValue.order : "none";
    const sort = sortCandidate === "asc" || sortCandidate === "desc" ? sortCandidate : "none";
    return [{
      id: row.id,
      code: row.code,
      name: row.name,
      metricDefinitionId: row.metricId,
      metricCode: metricCodes.get(row.metricId)!,
      chartType: row.chartType as PublishedChartType,
      dimension: row.dimension,
      series,
      sort,
      limit: row.limit,
      version: row.version,
    }];
  });
  return { metricDefinitions, visualizationDefinitions };
}

function manifestTransform(source: PublishedSource) {
  return jsonRecord(source.manifest.transform) ? source.manifest.transform : {};
}

function manifestAllocationRule(sources: readonly PublishedSource[]): ExamAllocationRule {
  for (const source of sources) {
    const transform = manifestTransform(source);
    if (typeof transform.allocationRule === "string" && allocationRules.has(transform.allocationRule as ExamAllocationRule)) {
      return transform.allocationRule as ExamAllocationRule;
    }
  }
  return "equal_by_body_part";
}

function versionSet(values: readonly string[]) {
  return [...new Set(values.filter(Boolean))].sort().join("|") || "unversioned";
}

export function buildPublishedPayload(input: {
  hospitalId: string;
  supplyHash: string;
  sources: readonly PublishedSource[];
  metricDefinitions: readonly PublishedMetricDefinition[];
  visualizationDefinitions: readonly PublishedVisualizationDefinition[];
}): PublishedDatasetPayload {
  if (!input.sources.length) {
    return { mode: "formal", publication: null, rows: [], metricDefinitions: [], visualizationDefinitions: [] };
  }
  const singular = input.sources.length === 1 ? input.sources[0] : null;
  const latestPublishedAt = input.sources.map((source) => source.publish.publishedAt ?? "").sort().at(-1) ?? "";
  const mappingVersions = input.sources.map((source) => source.publish.mappingVersion ?? source.snapshot.mappingVersion ?? String(manifestTransform(source).mappingVersion ?? ""));
  const ruleVersions = input.sources.map((source) => source.publish.ruleVersion ?? source.snapshot.ruleVersion ?? String(manifestTransform(source).ruleVersion ?? ""));
  const publication: PublishedDatasetPublication = {
    id: singular?.publish.id ?? `published-set:${input.supplyHash}`,
    hospitalId: input.hospitalId,
    seriesId: singular?.publish.seriesId ?? "hospital-current-set",
    version: singular?.publish.version ?? Math.max(...input.sources.map((source) => source.publish.version)),
    status: singular?.publish.status === "superseded" ? "superseded" : "published",
    snapshotId: singular?.snapshot.id ?? `set:${input.supplyHash}`,
    snapshotSha256: singular?.snapshot.sha256 ?? input.supplyHash,
    rowCount: input.sources.reduce((sum, source) => sum + source.snapshot.rowCount, 0),
    mappingVersion: versionSet(mappingVersions),
    ruleVersion: versionSet(ruleVersions),
    metricDefinitionVersion: versionSet(input.metricDefinitions.map((definition) => `${definition.code}@${definition.version}`)),
    visualizationVersion: versionSet(input.visualizationDefinitions.map((definition) => `${definition.code}@${definition.version}`)),
    allocationRule: manifestAllocationRule(input.sources),
    publishedAt: latestPublishedAt,
    correctionOfId: singular?.publish.correctionOfId ?? null,
    rollbackOfId: singular?.publish.rollbackOfId ?? null,
  };
  return {
    mode: "formal",
    publication,
    rows: input.sources.flatMap((source) => source.records) as PublishedDatasetPayload["rows"],
    metricDefinitions: [...input.metricDefinitions],
    visualizationDefinitions: [...input.visualizationDefinitions],
  };
}
