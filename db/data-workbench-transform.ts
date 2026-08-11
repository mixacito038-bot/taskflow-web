export type MappingField = { source: string; target: string; defaultValue?: unknown; transform?: string };
export type CleaningRuleContract = { id: string; sequence: number; ruleType: string; fieldName: string; config: Record<string, unknown>; enabled: boolean };
export type TransformIssue = { recordIndex: number; fieldName: string; ruleCode: string; severity: "warning" | "blocker"; message: string; before: unknown; after: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeFieldMapping(value: unknown): MappingField[] {
  const source = isRecord(value) && Array.isArray(value.fields) ? value.fields : value;
  if (Array.isArray(source)) return source.flatMap((item) => {
    if (!isRecord(item) || typeof item.source !== "string" || typeof item.target !== "string") return [];
    if (!safeMappingTarget(item.target)) return [];
    return [{ source: item.source, target: item.target, defaultValue: item.default, transform: typeof item.transform === "string" ? item.transform : undefined }];
  });
  if (isRecord(source)) return Object.entries(source).flatMap(([from, to]) => typeof to === "string" && safeMappingTarget(to) ? [{ source: from, target: to }] : []);
  return [];
}

function safeMappingTarget(value: string) {
  return value.length <= 160
    && /^[a-zA-Z][a-zA-Z0-9_.]*$/.test(value)
    && !/(^|\.)(__proto__|prototype|constructor)(\.|$)/i.test(value)
    && !/(patient.?name|full.?name|phone|mobile|id.?card|national.?id|address|birth.?date|dob|患者姓名|姓名|手机|电话|证件|身份证|地址|出生日期)/i.test(value);
}

function convert(value: unknown, transform?: string) {
  if (!transform) return value;
  if (transform === "trim") return typeof value === "string" ? value.trim() : value;
  if (transform === "upper") return typeof value === "string" ? value.trim().toUpperCase() : value;
  if (transform === "lower") return typeof value === "string" ? value.trim().toLowerCase() : value;
  if (transform === "number") {
    const number = typeof value === "number" ? value : Number(String(value ?? "").replaceAll(",", ""));
    return Number.isFinite(number) ? number : value;
  }
  if (transform === "boolean") return [true, 1, "1", "true", "是", "Y", "y"].includes(value as never);
  if (transform === "date") {
    const date = new Date(String(value ?? ""));
    return Number.isNaN(date.valueOf()) ? value : date.toISOString();
  }
  return value;
}

export function applyFieldMapping(records: Array<Record<string, unknown>>, mapping: MappingField[], templateCode: string) {
  return records.map((record) => {
    const mapped: Record<string, unknown> = { templateCode };
    for (const field of mapping) mapped[field.target] = convert(record[field.source] ?? field.defaultValue ?? null, field.transform);
    if (record._lineage) mapped._lineage = record._lineage;
    return mapped;
  });
}

function parseNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

export function executeCleaningRules(records: Array<Record<string, unknown>>, rules: CleaningRuleContract[], requiredFields: string[] = []) {
  const output = records.map((record) => ({ ...record }));
  const issues: TransformIssue[] = [];
  const impacts: Array<{ ruleId: string; ruleType: string; fieldName: string; changedRows: number; issueRows: number; samples: Array<{ row: number; before: unknown; after: unknown }> }> = [];
  for (const rule of [...rules].filter((item) => item.enabled).sort((a, b) => a.sequence - b.sequence)) {
    if (rule.ruleType === "deduplicate") {
      const keyFields = Array.isArray(rule.config.keyFields) ? rule.config.keyFields.filter((field): field is string => typeof field === "string" && Boolean(field)) : rule.fieldName ? [rule.fieldName] : [];
      if (!keyFields.length) throw new Error("deduplicate_key_fields_required");
      const seen = new Set<string>();
      let duplicateRows = 0;
      output.forEach((record, recordIndex) => {
        const key = JSON.stringify(keyFields.map((field) => record[field] ?? null));
        if (seen.has(key)) {
          duplicateRows += 1;
          issues.push({ recordIndex, fieldName: keyFields.join(","), ruleCode: rule.id, severity: "blocker", message: `业务键重复：${keyFields.join("+")}`, before: key, after: key });
        } else seen.add(key);
      });
      impacts.push({ ruleId: rule.id, ruleType: rule.ruleType, fieldName: keyFields.join(","), changedRows: 0, issueRows: duplicateRows, samples: [] });
      continue;
    }
    let changedRows = 0;
    let issueRows = 0;
    const samples: Array<{ row: number; before: unknown; after: unknown }> = [];
    output.forEach((record, recordIndex) => {
      const before = record[rule.fieldName];
      let after = before;
      let issue: Omit<TransformIssue, "recordIndex" | "fieldName" | "before" | "after"> | null = null;
      if (rule.ruleType === "trim" && typeof before === "string") after = before.trim();
      else if (rule.ruleType === "upper" && typeof before === "string") after = before.toUpperCase();
      else if (rule.ruleType === "lower" && typeof before === "string") after = before.toLowerCase();
      else if (rule.ruleType === "default" && (before === null || before === undefined || before === "")) after = rule.config.value ?? null;
      else if (rule.ruleType === "number") {
        const number = parseNumber(before);
        if (number === null) issue = { ruleCode: rule.id, severity: "blocker", message: `${rule.fieldName} 不是有效数字` };
        else after = number;
      } else if (rule.ruleType === "required" && (before === null || before === undefined || before === "")) {
        issue = { ruleCode: rule.id, severity: "blocker", message: `${rule.fieldName} 为必填字段` };
      } else if (rule.ruleType === "regex" && typeof rule.config.pattern === "string") {
        const pattern = rule.config.pattern;
        const unsafe = pattern.length > 256 || /(\([^)]*[+*][^)]*\))[+*{]|(\.\*){2,}|(\.\+){2,}/.test(pattern);
        let matches = false;
        if (!unsafe) {
          try { matches = new RegExp(pattern, "u").test(String(before ?? "").slice(0, 32_000)); } catch { matches = false; }
        }
        if (unsafe || !matches) issue = { ruleCode: rule.id, severity: rule.config.severity === "warning" ? "warning" : "blocker", message: unsafe ? `${rule.fieldName} 使用了不安全的正则规则` : `${rule.fieldName} 不符合格式规则` };
      } else if (rule.ruleType === "enum" && Array.isArray(rule.config.values) && !rule.config.values.includes(before)) {
        issue = { ruleCode: rule.id, severity: rule.config.severity === "warning" ? "warning" : "blocker", message: `${rule.fieldName} 不在允许字典中` };
      } else if (rule.ruleType === "replace" && isRecord(rule.config.values) && typeof before === "string" && rule.config.values[before] !== undefined) {
        after = rule.config.values[before];
      }
      if (!Object.is(before, after)) {
        record[rule.fieldName] = after;
        changedRows += 1;
        if (samples.length < 5) samples.push({ row: recordIndex + 1, before, after });
      }
      if (issue) {
        issues.push({ ...issue, recordIndex, fieldName: rule.fieldName, before, after });
        issueRows += 1;
      }
    });
    impacts.push({ ruleId: rule.id, ruleType: rule.ruleType, fieldName: rule.fieldName, changedRows, issueRows, samples });
  }
  output.forEach((record, recordIndex) => requiredFields.forEach((field) => {
    const value = record[field] ?? (field === "deviceId" ? record["device.id"] : undefined);
    if (value === null || value === undefined || value === "") issues.push({ recordIndex, fieldName: field, ruleCode: `template.${field}.required`, severity: "blocker", message: `业务模板必填字段 ${field} 缺失`, before: value, after: value });
  }));
  return { records: output, issues, impacts };
}

function examParts(record: Record<string, unknown>) {
  const source = Array.isArray(record.bodyParts)
    ? record.bodyParts
    : typeof record.bodyParts === "string" ? record.bodyParts.split(/[、,，;；|/]/)
      : typeof record.bodyPart === "string" ? record.bodyPart.split(/[、,，;；|/]/) : [];
  return source.map((item, index) => {
    if (isRecord(item)) {
      const name = String(item.name ?? item.code ?? "").trim();
      const weight = typeof item.weight === "number" && item.weight > 0 ? item.weight : null;
      return name ? { name, weight, isPrimary: item.isPrimary === true, sequence: index + 1 } : null;
    }
    const name = String(item).trim();
    const rowWeight = typeof record.bodyPartWeight === "number" ? record.bodyPartWeight : typeof record.allocationWeight === "number" ? record.allocationWeight : null;
    return name ? { name, weight: rowWeight && rowWeight > 0 ? rowWeight : null, isPrimary: record.isPrimary === true || record.isPrimaryBodyPart === true, sequence: index + 1 } : null;
  }).filter((item): item is NonNullable<typeof item> => Boolean(item));
}

/** Expands one-exam/many-body-parts without duplicating exam-level money. */
export function expandExamActivityForPublish(records: Array<Record<string, unknown>>, allocationRule: "equal_by_body_part" | "weighted_by_body_part" | "primary_body_part" = "equal_by_body_part") {
  const groups = new Map<string, Array<Record<string, unknown>>>();
  for (const record of records) {
    const examId = typeof record.examId === "string" ? record.examId.trim() : "";
    if (!examId) throw new Error("exam_id_required");
    groups.set(examId, [...(groups.get(examId) ?? []), record]);
  }
  const output: Array<Record<string, unknown>> = [];
  for (const [examId, rows] of groups) {
    for (const field of ["deviceId", "occurredAt", "department"] as const) {
      const distinct = new Set(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined && value !== "").map((value) => String(value)));
      if (distinct.size > 1) throw new Error(`conflicting_exam_${field}:${examId}`);
    }
    const values = (field: "examRevenue" | "examCost") => [...new Set(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined && value !== "").map((value) => Number(value)))];
    const revenue = values("examRevenue");
    const cost = values("examCost");
    if (revenue.some((value) => !Number.isFinite(value)) || cost.some((value) => !Number.isFinite(value)) || revenue.length > 1 || cost.length > 1) throw new Error(`conflicting_exam_amount:${examId}`);
    const parts = [...new Map(rows.flatMap((row) => examParts(row)).map((part) => [part.name, part])).values()];
    if (!parts.length) {
      output.push({ ...rows[0], examId, examRevenue: revenue[0] ?? rows[0].examRevenue, examCost: cost[0] ?? rows[0].examCost });
      continue;
    }
    const explicitWeight = parts.every((part) => part.weight !== null) && Math.abs(parts.reduce((sum, part) => sum + (part.weight ?? 0), 0) - 1) < 0.000001;
    const primaryIndexes = parts.flatMap((part, index) => part.isPrimary ? [index] : []);
    if (allocationRule === "weighted_by_body_part" && !explicitWeight) throw new Error(`invalid_exam_allocation_weight:${examId}`);
    if (allocationRule === "primary_body_part" && primaryIndexes.length !== 1) throw new Error(`invalid_exam_primary_body_part:${examId}`);
    const primaryIndex = primaryIndexes[0] ?? 0;
    parts.forEach((part, index) => output.push({
      ...rows[0], examId, bodyPart: part.name, allocationWeight: allocationRule === "weighted_by_body_part" ? part.weight : allocationRule === "primary_body_part" ? index === primaryIndex ? 1 : 0 : 1 / parts.length,
      isPrimary: index === primaryIndex, examRevenue: revenue[0] ?? rows[0].examRevenue, examCost: cost[0] ?? rows[0].examCost,
      _lineage: rows.find((row) => examParts(row).some((candidate) => candidate.name === part.name))?._lineage ?? rows[0]._lineage,
    }));
  }
  return output;
}
