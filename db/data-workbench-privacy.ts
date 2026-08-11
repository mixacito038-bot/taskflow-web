const allowedNameKeys = new Set(["devicename", "departmentname", "filename", "sheetname", "manufacturername", "metricname", "templatename"]);
const directIdentifierKeys = new Set([
  "name", "fullname", "patientname", "patientfullname", "phone", "phonenumber", "mobile", "mobilenumber",
  "idcard", "nationalid", "identitynumber", "address", "homeaddress", "dob", "dateofbirth", "birthdate",
  "姓名", "患者姓名", "患者全名", "手机", "手机号", "电话", "电话号码", "证件", "证件号", "身份证", "身份证号", "地址", "家庭住址", "出生日期",
]);

export function isDirectPatientIdentifierKey(key: string) {
  const normalized = key.trim().toLowerCase().replace(/[\s_.\-]/g, "");
  return !allowedNameKeys.has(normalized) && directIdentifierKeys.has(normalized);
}

export function containsDirectPatientIdentifiers(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsDirectPatientIdentifiers);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => isDirectPatientIdentifierKey(key) || containsDirectPatientIdentifiers(child));
}

export function redactDirectPatientIdentifiers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDirectPatientIdentifiers);
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    try { return redactDirectPatientIdentifiers(JSON.parse(value)); } catch { return value; }
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, isDirectPatientIdentifierKey(key) ? "***" : redactDirectPatientIdentifiers(child)]));
}
