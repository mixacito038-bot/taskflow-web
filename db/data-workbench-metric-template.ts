export const HOSPITAL_METRIC_TEMPLATE_METADATA_SCHEMA = "hospital-metric-template/v1" as const;

export type HospitalMetricTemplateCatalogItem = {
  sourceItem: number;
  code: string;
  name: string;
  dimension: string;
  definition: string;
  formula: string;
  numerator: string;
  denominator: string;
  unit: string;
  grain: string;
  dimensions: readonly string[];
  sources: readonly string[];
  owner: string;
  evidence: string;
  readiness: "ready" | "configure" | "deferred";
  audience: readonly string[];
  version: string;
  validation: string;
  decision: string;
};

export type HospitalMetricTemplateMetadata = {
  schema: typeof HOSPITAL_METRIC_TEMPLATE_METADATA_SCHEMA;
  catalogVersion: string;
  sourceItem: number;
  dimension: string;
  definition: string;
  grain: string;
  owner: string;
  evidence: string;
  readiness: "ready" | "configure" | "deferred";
  audience: string[];
  validation: string;
  decision: string;
};

export type HospitalMetricTemplateRow = {
  code: string;
  name: string;
  formula: string;
  aggregation: "sum" | "avg" | "min" | "max" | "count" | "distinct_count" | "ratio" | "custom";
  numerator: string;
  denominator: string;
  dimensionsJson: string;
  sourceFieldRefsJson: string;
  unit: string;
  description: string;
  status: "draft" | "active" | "retired";
  version: number;
};

type ExistingHospitalMetricRow = HospitalMetricTemplateRow & { id?: string };

const contentKeys = [
  "code",
  "name",
  "formula",
  "aggregation",
  "numerator",
  "denominator",
  "dimensionsJson",
  "sourceFieldRefsJson",
  "unit",
  "description",
  "version",
] as const satisfies readonly (keyof HospitalMetricTemplateRow)[];

function dbVersionForCatalog(templateVersion: string) {
  const match = templateVersion.match(/\.(\d+)$/);
  const version = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("invalid_hospital_metric_catalog_version");
  return version;
}

function aggregationForFormula(formula: string): HospitalMetricTemplateRow["aggregation"] {
  const normalized = formula.trim().toUpperCase();
  if (normalized.startsWith("COUNT_DISTINCT(")) return "distinct_count";
  if (normalized.startsWith("COUNT(")) return "count";
  if (normalized.startsWith("AVG(")) return "avg";
  if (normalized.includes("/") || normalized.includes("* 100%") || normalized.includes("*100%")) return "ratio";
  if (normalized.startsWith("SUM(") && !/[+\-]/.test(normalized)) return "sum";
  return "custom";
}

function metadataFor(item: HospitalMetricTemplateCatalogItem, templateVersion: string): HospitalMetricTemplateMetadata {
  return {
    schema: HOSPITAL_METRIC_TEMPLATE_METADATA_SCHEMA,
    catalogVersion: templateVersion,
    sourceItem: item.sourceItem,
    dimension: item.dimension,
    definition: item.definition,
    grain: item.grain,
    owner: item.owner,
    evidence: item.evidence,
    readiness: item.readiness,
    audience: [...item.audience],
    validation: item.validation,
    decision: item.decision,
  };
}

export function buildHospitalMetricTemplateRows(
  catalog: readonly HospitalMetricTemplateCatalogItem[],
  templateVersion: string,
): HospitalMetricTemplateRow[] {
  const version = dbVersionForCatalog(templateVersion);
  const codes = new Set<string>();
  return catalog.map((item) => {
    if (item.version !== templateVersion) throw new Error("hospital_metric_catalog_version_mismatch");
    if (codes.has(item.code)) throw new Error("duplicate_hospital_metric_code");
    codes.add(item.code);
    return {
      code: item.code,
      name: item.name,
      formula: item.formula,
      aggregation: aggregationForFormula(item.formula),
      numerator: item.numerator,
      denominator: item.denominator,
      dimensionsJson: JSON.stringify(item.dimensions),
      sourceFieldRefsJson: JSON.stringify(item.sources),
      unit: item.unit,
      description: JSON.stringify(metadataFor(item, templateVersion)),
      status: "draft",
      version,
    };
  });
}

function hasSameContent(expected: HospitalMetricTemplateRow, existing: ExistingHospitalMetricRow) {
  return contentKeys.every((key) => expected[key] === existing[key]);
}

export function planHospitalMetricTemplateImport(
  expectedRows: readonly HospitalMetricTemplateRow[],
  existingRows: readonly ExistingHospitalMetricRow[],
) {
  const existingByKey = new Map(existingRows.map((row) => [`${row.code}\u0000${row.version}`, row]));
  const created: HospitalMetricTemplateRow[] = [];
  const skipped: Array<{ code: string; version: number; status: HospitalMetricTemplateRow["status"] }> = [];
  const conflicts: Array<{ code: string; version: number; status: HospitalMetricTemplateRow["status"] }> = [];

  for (const expected of expectedRows) {
    const existing = existingByKey.get(`${expected.code}\u0000${expected.version}`);
    if (!existing) {
      created.push(expected);
    } else if (hasSameContent(expected, existing)) {
      skipped.push({ code: expected.code, version: expected.version, status: existing.status });
    } else {
      conflicts.push({ code: expected.code, version: expected.version, status: existing.status });
    }
  }

  // The batch is all-or-nothing: a conflicting code/version prevents partial
  // creation of the remaining catalog rows and never mutates the existing row.
  return { created: conflicts.length ? [] : created, skipped, conflicts };
}

export function parseHospitalMetricTemplateMetadata(value: string): HospitalMetricTemplateMetadata | null {
  try {
    const parsed = JSON.parse(value) as Partial<HospitalMetricTemplateMetadata>;
    if (
      parsed.schema !== HOSPITAL_METRIC_TEMPLATE_METADATA_SCHEMA
      || typeof parsed.catalogVersion !== "string"
      || typeof parsed.sourceItem !== "number"
      || typeof parsed.definition !== "string"
      || typeof parsed.dimension !== "string"
      || typeof parsed.grain !== "string"
      || typeof parsed.owner !== "string"
      || typeof parsed.evidence !== "string"
      || !["ready", "configure", "deferred"].includes(parsed.readiness ?? "")
      || !Array.isArray(parsed.audience)
      || typeof parsed.validation !== "string"
      || typeof parsed.decision !== "string"
    ) return null;
    return parsed as HospitalMetricTemplateMetadata;
  } catch {
    return null;
  }
}

export type HospitalMetricActivationBindings = {
  sourceFieldIds: readonly string[];
  dependencyMetricIds: readonly string[];
};

export function hospitalMetricActivationIssues(
  row: HospitalMetricTemplateRow,
  bindings: HospitalMetricActivationBindings,
  expectedCatalogVersion?: string,
) {
  if (row.status !== "draft") return ["immutable_status"] as const;
  const metadata = parseHospitalMetricTemplateMetadata(row.description);
  if (!metadata) return ["not_hospital_metric_template"] as const;
  if (expectedCatalogVersion && metadata.catalogVersion !== expectedCatalogVersion) {
    return ["unsupported_template_version"] as const;
  }
  if (metadata.readiness === "deferred") return ["deferred_metric"] as const;
  try {
    const refs = JSON.parse(row.sourceFieldRefsJson);
    if (!Array.isArray(refs) || !refs.length || refs.some((ref) => typeof ref !== "string" || !ref.trim())) {
      return ["source_reference_required"] as const;
    }
  } catch {
    return ["source_reference_required"] as const;
  }
  if (!bindings.sourceFieldIds.length && !bindings.dependencyMetricIds.length) {
    return ["source_binding_required"] as const;
  }
  return [] as const;
}
