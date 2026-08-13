/* connector.manage 保留在这里，但已从**用户可授予的权限清单**（app/access-control-data.ts）里删除：
   数据准备中心没有任何连接管理界面，这条权限过去勾上勾不上界面完全一样。
   服务端 create_connector/update_connector 的实现和凭据安全校验都还在，只是现在没人能拿到这条权限，
   于是这两个 action 一律 403 —— fail-closed。将来真做出连接管理页面时，把它加回权限清单即可。 */
export const dataWorkbenchPermissions = [
  "connector.manage",
  "data.ingest",
  "data.clean",
  "data.review",
  "data.publish",
] as const;

export type DataWorkbenchPermission = (typeof dataWorkbenchPermissions)[number];

export const importStatuses = [
  "uploading",
  "pending_mapping",
  "validating",
  "pending_review",
  "ready",
  "published",
  "failed",
  "withdrawn",
  "superseded",
] as const;

export type ImportStatus = (typeof importStatuses)[number];

const importTransitions: Record<ImportStatus, readonly ImportStatus[]> = {
  uploading: ["pending_mapping", "failed"],
  pending_mapping: ["validating", "failed"],
  validating: ["pending_review", "failed"],
  pending_review: ["ready", "pending_mapping", "failed"],
  ready: ["published", "pending_mapping", "failed"],
  published: ["withdrawn", "superseded"],
  failed: ["uploading", "withdrawn"],
  withdrawn: [],
  superseded: [],
};

export const publishStatuses = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "published",
  "withdrawn",
  "superseded",
] as const;

export type PublishStatus = (typeof publishStatuses)[number];

const publishTransitions: Record<PublishStatus, readonly PublishStatus[]> = {
  draft: ["pending_review"],
  pending_review: ["approved", "rejected"],
  approved: ["published", "rejected"],
  rejected: ["draft"],
  published: ["withdrawn", "superseded"],
  withdrawn: [],
  superseded: [],
};

export function canAdvanceImport(from: string, to: string): to is ImportStatus {
  return isImportStatus(from) && isImportStatus(to) && importTransitions[from].includes(to);
}

export function canAdvancePublish(from: string, to: string): to is PublishStatus {
  return isPublishStatus(from) && isPublishStatus(to) && publishTransitions[from].includes(to);
}

export function isImportStatus(value: unknown): value is ImportStatus {
  return typeof value === "string" && (importStatuses as readonly string[]).includes(value);
}

export function isPublishStatus(value: unknown): value is PublishStatus {
  return typeof value === "string" && (publishStatuses as readonly string[]).includes(value);
}

const sensitiveKeyPattern = /(password|passwd|pwd|secret|token|api[-_]?key|authorization|credential|private[-_]?key|access[-_]?key)/i;

export function containsSensitiveConnectorMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveConnectorMaterial);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => (
    sensitiveKeyPattern.test(key) || containsSensitiveConnectorMaterial(child)
  ));
}

/** Store only a non-secret endpoint. Userinfo, query strings and fragments may leak credentials. */
export function normalizeConnectorEndpoint(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const endpoint = new URL(value.trim());
    if (!["https:", "http:"].includes(endpoint.protocol)) return null;
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
    return endpoint.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function isSafeCredentialReference(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= 300
    && /^(secret|tencent-sm|vault):\/\/[a-zA-Z0-9/_@.:-]+$/.test(value);
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function boundedJson(value: unknown, maxBytes = 100_000): string | null {
  try {
    const json = JSON.stringify(value);
    return new TextEncoder().encode(json).byteLength <= maxBytes ? json : null;
  } catch {
    return null;
  }
}

export function safeIdentifier(value: unknown, maxLength = 128): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized.length <= maxLength && /^[a-zA-Z0-9_.:@/-]+$/.test(normalized) ? normalized : "";
}

