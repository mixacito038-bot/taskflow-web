function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function reconciliationKey(record: Record<string, unknown>, fields: string[]) {
  if (!fields.length || fields.every((field) => record[field] === null || record[field] === undefined || record[field] === "")) throw new Error("reconciliation_blank_key");
  return fields.map((field) => JSON.stringify(record[field] ?? null)).join("|");
}

export function groupReconciliationRows<T extends { record: Record<string, unknown> }>(rows: T[], fields: string[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = reconciliationKey(row.record, fields);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

export function reconciliationValuesEqual(left: unknown, right: unknown, rule: Record<string, unknown> = {}) {
  if (typeof left === "number" && typeof right === "number") {
    const absolute = typeof rule.absolute === "number" && rule.absolute >= 0 ? rule.absolute : 0;
    const relative = typeof rule.relative === "number" && rule.relative >= 0 ? rule.relative : 0;
    return Math.abs(left - right) <= Math.max(absolute, relative * Math.max(Math.abs(left), Math.abs(right)));
  }
  return stableStringify(left) === stableStringify(right);
}
