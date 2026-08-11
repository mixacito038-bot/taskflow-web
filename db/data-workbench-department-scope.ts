export function departmentOfPublishedRecord(record: Record<string, unknown>) {
  for (const key of ["departmentId", "department", "device.departmentId", "device.department"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  if (record.device && typeof record.device === "object" && !Array.isArray(record.device)) {
    const device = record.device as Record<string, unknown>;
    for (const key of ["departmentId", "department"]) if (typeof device[key] === "string" && device[key].trim()) return device[key].trim();
  }
  return "";
}

export function filterPublishedRecordsByDepartment(records: Array<Record<string, unknown>>, departmentScope: string[]) {
  const allowed = new Set(departmentScope);
  return records.filter((record) => allowed.has(departmentOfPublishedRecord(record)));
}
