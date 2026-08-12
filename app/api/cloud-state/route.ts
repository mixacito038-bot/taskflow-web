import { and, eq, sql } from "drizzle-orm";
import { appSessionError, assertSameOrigin, requireAppSession } from "../../../db/account-security";
import {
  cloudResourceNames,
  CloudPreferences,
  CloudResourceName,
  CloudSharedState,
  defaultCloudPreferences,
  emptyResourceRevisions,
  emptySharedState,
  getCloudStateAccess,
  mayBootstrapCloudState,
  mayReadCloudResource,
  mayUseHospital,
  mayWriteCloudResource,
  normalizeResourceRevision,
  parseStoredJson,
} from "../../../db/cloud-state";
import { getDb } from "../../../db";
import {
  accountCloudPreferences,
  auditLogs,
  hospitalCloudResources,
} from "../../../db/schema";

export const dynamic = "force-dynamic";

type CloudStateAction =
  | "bootstrap"
  | "save_resource"
  | "save_snapshot"
  | "delete_resource"
  | "save_preferences";

type CloudStatePayload = {
  action?: CloudStateAction;
  hospitalId?: string;
  resource?: CloudResourceName;
  value?: unknown;
  shared?: Partial<CloudSharedState>;
  baseRevision?: number;
};

type CloudAccess = NonNullable<Awaited<ReturnType<typeof getCloudStateAccess>>>;

const resourceNameSet = new Set<string>(cloudResourceNames);
const maxResourceItems: Record<CloudResourceName, number> = {
  devices: 10_000,
  costEntries: 50_000,
  notifications: 10_000,
  improvementActions: 20_000,
  modules: 200,
  dataSources: 2_000,
  analysisProfiles: 200,
  ledgerFields: 200,
};
const maxResourceBytes = 1_500_000;
const notificationPreferenceKeys = [
  "benefitAlerts",
  "costTasks",
  "dataQuality",
  "securityAlerts",
  "weeklyDigest",
] as const;
const allowedThemes = new Set(["clinical", "teal", "midnight"]);
const allowedDensities = new Set(["comfortable", "compact"]);
const allowedContentZooms = new Set([0.8, 0.9, 1, 1.1, 1.2, 1.3]);
const allowedPerspectives = new Set(["管理层", "设备科", "临床科室"]);
const allowedPreferenceKeys = new Set([
  "theme",
  "density",
  "contentZoom",
  "notificationPreferences",
  "readNotificationIds",
  "activeHospitalId",
  "department",
  "period",
  "perspective",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isResourceName(value: unknown): value is CloudResourceName {
  return typeof value === "string" && resourceNameSet.has(value);
}

function validateHospitalId(value: unknown) {
  if (typeof value !== "string") return "";
  const hospitalId = value.trim();
  return /^[a-zA-Z0-9_-]{1,128}$/.test(hospitalId) ? hospitalId : "";
}

function serializeResource(resource: CloudResourceName, value: unknown) {
  if (!Array.isArray(value) || value.length > maxResourceItems[resource]) return null;
  if (value.some((item) => !isRecord(item))) return null;
  const normalized = resource === "notifications"
    ? value.map((item) => {
        const notification = { ...item };
        delete notification.read;
        return notification;
      })
    : value;
  const json = JSON.stringify(normalized);
  if (new TextEncoder().encode(json).byteLength > maxResourceBytes) return null;
  return json;
}

function sanitizeNotificationPreferences(
  value: unknown,
  fallback: Record<string, boolean>,
) {
  if (!isRecord(value)) return null;
  const next = { ...fallback };
  for (const key of notificationPreferenceKeys) {
    if (value[key] !== undefined && typeof value[key] !== "boolean") return null;
    if (typeof value[key] === "boolean") next[key] = value[key];
  }
  if (Object.keys(value).some((key) => !notificationPreferenceKeys.includes(key as typeof notificationPreferenceKeys[number]))) {
    return null;
  }
  return next;
}

function sanitizeReadNotificationIds(value: unknown) {
  if (!Array.isArray(value) || value.length > 5_000) return null;
  if (value.some((id) => typeof id !== "string" || !id.trim() || id.length > 200)) return null;
  const ids = [...new Set(value.map((id) => (id as string).trim()))];
  return new TextEncoder().encode(JSON.stringify(ids)).byteLength <= 500_000 ? ids : null;
}

function isOwnedByAccount(value: Record<string, unknown>, access: CloudAccess) {
  const candidates = [
    value.accountId,
    value.ownerAccountId,
    value.createdByAccountId,
    value.ownerEmail,
    value.email,
  ];
  return candidates.some((candidate) => candidate === access.account.id || candidate === access.account.email);
}

function matchesDepartment(
  value: Record<string, unknown>,
  departmentScope: string[],
  allowedDeviceIds: Set<string>,
) {
  if (typeof value.deviceId === "string" && allowedDeviceIds.has(value.deviceId)) return true;
  const candidates = [value.department, value.departmentId, value.departmentName]
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  return candidates.some((candidate) => departmentScope.includes(candidate));
}

function applyDataScope(shared: CloudSharedState, access: CloudAccess) {
  if (access.dataScope === "platform" || access.dataScope === "hospital") return shared;
  if (access.dataScope === "self") {
    const devices = shared.devices.filter((item) => isRecord(item) && isOwnedByAccount(item, access));
    const allowedDeviceIds = new Set(
      devices.map((item) => isRecord(item) && typeof item.id === "string" ? item.id : "").filter(Boolean),
    );
    return {
      ...shared,
      devices,
      costEntries: shared.costEntries.filter((item) => isRecord(item) && (
        isOwnedByAccount(item, access)
        || (typeof item.deviceId === "string" && allowedDeviceIds.has(item.deviceId))
      )),
      notifications: shared.notifications.filter((item) => isRecord(item) && (
        isOwnedByAccount(item, access)
        || (typeof item.deviceId === "string" && allowedDeviceIds.has(item.deviceId))
      )),
      improvementActions: shared.improvementActions.filter((item) => isRecord(item) && (
        isOwnedByAccount(item, access)
        || (typeof item.deviceId === "string" && allowedDeviceIds.has(item.deviceId))
      )),
      dataSources: [],
      analysisProfiles: [],
      // 台账列定义是全院统一口径：按科室裁剪会让科室用户少看到列，表格直接缺列。
      ledgerFields: shared.ledgerFields,
    };
  }
  const departments = access.departmentScope;
  const devices = shared.devices.filter(
    (item) => isRecord(item) && matchesDepartment(item, departments, new Set()),
  );
  const allowedDeviceIds = new Set(
    devices.map((item) => isRecord(item) && typeof item.id === "string" ? item.id : "").filter(Boolean),
  );
  return {
    ...shared,
    devices,
    costEntries: shared.costEntries.filter(
      (item) => isRecord(item) && matchesDepartment(item, departments, allowedDeviceIds),
    ),
    notifications: shared.notifications.filter(
      (item) => isRecord(item) && matchesDepartment(item, departments, allowedDeviceIds),
    ),
    improvementActions: shared.improvementActions.filter(
      (item) => isRecord(item) && matchesDepartment(item, departments, allowedDeviceIds),
    ),
    dataSources: [],
    analysisProfiles: [],
  };
}

function hasFullResourceWriteScope(access: CloudAccess) {
  return access.dataScope === "platform" || access.dataScope === "hospital";
}

async function readCloudState(hospitalId: string, access: CloudAccess) {
  const db = await getDb();
  const resourceRows = await db
    .select()
    .from(hospitalCloudResources)
    .where(eq(hospitalCloudResources.hospitalId, hospitalId));
  const [preferenceRow] = await db
    .select()
    .from(accountCloudPreferences)
    .where(eq(accountCloudPreferences.accountId, access.account.id))
    .limit(1);

  let shared = emptySharedState();
  const revisions = emptyResourceRevisions();
  for (const row of resourceRows) {
    if (!isResourceName(row.resource)) continue;
    if (!mayReadCloudResource(access, row.resource)) continue;
    const value = parseStoredJson<unknown[]>(row.valueJson, []);
    shared[row.resource] = Array.isArray(value) ? value : [];
    revisions[row.resource] = normalizeResourceRevision(row.revision);
  }
  shared = applyDataScope(shared, access);

  const defaults = defaultCloudPreferences(hospitalId);
  const storedNotificationPreferences = preferenceRow
    ? parseStoredJson<Record<string, boolean>>(preferenceRow.notificationPreferencesJson, defaults.notificationPreferences)
    : defaults.notificationPreferences;
  const notificationPreferences = sanitizeNotificationPreferences(
    storedNotificationPreferences,
    defaults.notificationPreferences,
  ) ?? defaults.notificationPreferences;
  const readNotificationIds = preferenceRow
    ? sanitizeReadNotificationIds(parseStoredJson<unknown>(preferenceRow.readNotificationIdsJson, [])) ?? []
    : [];
  let activeHospitalId = preferenceRow?.activeHospitalId || hospitalId;
  if (!await mayUseHospital(access.account.id, activeHospitalId, access.platformAdmin)) activeHospitalId = hospitalId;
  const preferences: CloudPreferences = preferenceRow ? {
    theme: allowedThemes.has(preferenceRow.theme) ? preferenceRow.theme : defaults.theme,
    density: allowedDensities.has(preferenceRow.density) ? preferenceRow.density : defaults.density,
    contentZoom: allowedContentZooms.has(preferenceRow.contentZoom) ? preferenceRow.contentZoom : defaults.contentZoom,
    notificationPreferences,
    readNotificationIds,
    activeHospitalId,
    department: preferenceRow.department,
    period: preferenceRow.period,
    perspective: allowedPerspectives.has(preferenceRow.perspective) ? preferenceRow.perspective : defaults.perspective,
  } : defaults;

  const readableResources = cloudResourceNames.filter((resource) => mayReadCloudResource(access, resource));
  const missingResources = readableResources.filter(
    (resource) => !resourceRows.some((row) => row.resource === resource),
  );
  const timestamps = [
    ...resourceRows
      .filter((row) => isResourceName(row.resource) && mayReadCloudResource(access, row.resource))
      .map((row) => row.updatedAt),
    preferenceRow?.updatedAt,
  ].filter((value): value is string => Boolean(value)).sort();

  return {
    initialized: missingResources.length === 0,
    missingResources,
    shared,
    revisions,
    preferences,
    updatedAt: timestamps.at(-1) ?? null,
  };
}

async function bootstrapResource(
  hospitalId: string,
  resource: CloudResourceName,
  valueJson: string,
  accountId: string,
) {
  const db = await getDb();
  const now = new Date().toISOString();
  const [inserted] = await db.insert(hospitalCloudResources).values({
    hospitalId,
    resource,
    valueJson,
    revision: 1,
    schemaVersion: 1,
    updatedByAccountId: accountId,
    updatedAt: now,
  }).onConflictDoNothing().returning({ resource: hospitalCloudResources.resource });
  return Boolean(inserted);
}

type ResourceWriteResult =
  | { written: true; revision: number }
  | { written: false; currentRevision: number };

async function compareAndSwapResource(
  hospitalId: string,
  resource: CloudResourceName,
  valueJson: string,
  accountId: string,
  baseRevision: number,
): Promise<ResourceWriteResult> {
  const db = await getDb();
  const now = new Date().toISOString();
  if (baseRevision === 0) {
    const [inserted] = await db.insert(hospitalCloudResources).values({
      hospitalId,
      resource,
      valueJson,
      revision: 1,
      schemaVersion: 1,
      updatedByAccountId: accountId,
      updatedAt: now,
    }).onConflictDoNothing().returning({ revision: hospitalCloudResources.revision });
    if (inserted) return { written: true, revision: normalizeResourceRevision(inserted.revision) };
  } else {
    const [updated] = await db
      .update(hospitalCloudResources)
      .set({
        valueJson,
        revision: sql<number>`${hospitalCloudResources.revision} + 1`,
        schemaVersion: 1,
        updatedByAccountId: accountId,
        updatedAt: now,
      })
      .where(and(
        eq(hospitalCloudResources.hospitalId, hospitalId),
        eq(hospitalCloudResources.resource, resource),
        eq(hospitalCloudResources.revision, baseRevision),
      ))
      .returning({ revision: hospitalCloudResources.revision });
    if (updated) return { written: true, revision: normalizeResourceRevision(updated.revision) };
  }

  const [current] = await db
    .select({ revision: hospitalCloudResources.revision })
    .from(hospitalCloudResources)
    .where(and(
      eq(hospitalCloudResources.hospitalId, hospitalId),
      eq(hospitalCloudResources.resource, resource),
    ))
    .limit(1);
  return {
    written: false,
    currentRevision: current ? normalizeResourceRevision(current.revision) : 0,
  };
}

async function recordAudit(
  hospitalId: string,
  accountId: string,
  action: string,
  resourceId: string,
  detail: string,
) {
  const db = await getDb();
  await db.insert(auditLogs).values({
    hospitalId,
    actorAccountId: accountId,
    action,
    resourceType: "cloud_state",
    resourceId,
    result: "allowed",
    detail,
  });
}

function cloudStateError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("D1 binding") || message.includes("no such table") || message.includes("no such column")) {
    return Response.json({ error: "cloud_store_unavailable" }, { status: 503 });
  }
  return Response.json({ error: "cloud_state_operation_failed" }, { status: 500 });
}

async function writeRevisionedResource(
  hospitalId: string,
  payload: CloudStatePayload,
  access: CloudAccess,
) {
  if (!isResourceName(payload.resource)) {
    return Response.json({ error: "resource_required" }, { status: 400 });
  }
  if (!mayWriteCloudResource(access, payload.resource)) {
    return Response.json({ error: "permission_denied" }, { status: 403 });
  }
  if (!hasFullResourceWriteScope(access)) {
    return Response.json({ error: "scoped_snapshot_write_denied" }, { status: 403 });
  }
  if (payload.baseRevision === undefined) {
    return Response.json({
      error: "base_revision_required",
      resource: payload.resource,
    }, { status: 428 });
  }
  if (
    typeof payload.baseRevision !== "number"
    || !Number.isSafeInteger(payload.baseRevision)
    || payload.baseRevision < 0
  ) {
    return Response.json({ error: "invalid_base_revision", resource: payload.resource }, { status: 400 });
  }
  const valueJson = serializeResource(payload.resource, payload.value);
  if (valueJson === null) {
    return Response.json({ error: "invalid_resource_value" }, { status: 400 });
  }

  const write = await compareAndSwapResource(
    hospitalId,
    payload.resource,
    valueJson,
    access.account.id,
    payload.baseRevision,
  );
  if (!write.written) {
    // The conflict body is built from readCloudState so currentValue is filtered
    // through the same hospital and data-scope boundary as an ordinary GET.
    const currentState = await readCloudState(hospitalId, access);
    return Response.json({
      error: "revision_conflict",
      resource: payload.resource,
      expectedRevision: payload.baseRevision,
      currentRevision: currentState.revisions[payload.resource] ?? write.currentRevision,
      currentValue: currentState.shared[payload.resource],
    }, { status: 409 });
  }

  await recordAudit(
    hospitalId,
    access.account.id,
    "save_cloud_resource",
    payload.resource,
    `${valueJson.length} bytes · revision ${payload.baseRevision} -> ${write.revision}`,
  );
  return Response.json(await readCloudState(hospitalId, access));
}

async function handleRevisionedResourceRequest(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    return appSessionError(error);
  }
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try {
    user = await requireAppSession(request);
  } catch (error) {
    return appSessionError(error);
  }
  let payload: CloudStatePayload;
  try {
    payload = await request.json() as CloudStatePayload;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const hospitalId = validateHospitalId(payload.hospitalId);
  if (!hospitalId) return Response.json({ error: "hospital_required" }, { status: 400 });
  try {
    const access = await getCloudStateAccess(user.email, hospitalId);
    if (!access) return Response.json({ error: "permission_denied" }, { status: 403 });
    return await writeRevisionedResource(hospitalId, payload, access);
  } catch (error) {
    return cloudStateError(error);
  }
}

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try {
    user = await requireAppSession(request);
  } catch (error) {
    return appSessionError(error);
  }
  const hospitalId = validateHospitalId(new URL(request.url).searchParams.get("hospitalId"));
  if (!hospitalId) return Response.json({ error: "hospital_required" }, { status: 400 });
  try {
    const access = await getCloudStateAccess(user.email, hospitalId);
    if (!access) return Response.json({ error: "permission_denied" }, { status: 403 });
    return Response.json(await readCloudState(hospitalId, access));
  } catch (error) {
    return cloudStateError(error);
  }
}

export async function PUT(request: Request) {
  return handleRevisionedResourceRequest(request);
}

export async function PATCH(request: Request) {
  return handleRevisionedResourceRequest(request);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    return appSessionError(error);
  }
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try {
    user = await requireAppSession(request);
  } catch (error) {
    return appSessionError(error);
  }
  let payload: CloudStatePayload;
  try {
    payload = await request.json() as CloudStatePayload;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const hospitalId = validateHospitalId(payload.hospitalId);
  if (!hospitalId || !payload.action) return Response.json({ error: "invalid_request" }, { status: 400 });

  try {
    const access = await getCloudStateAccess(user.email, hospitalId);
    if (!access) return Response.json({ error: "permission_denied" }, { status: 403 });
    const db = await getDb();

    if (payload.action === "save_snapshot") {
      return Response.json({
        error: "bulk_snapshot_write_disabled",
        detail: "Use revisioned PUT/PATCH writes for each resource.",
      }, { status: 409 });
    }

    if (payload.action === "bootstrap") {
      const shared = payload.shared;
      if (!isRecord(shared)) return Response.json({ error: "shared_state_required" }, { status: 400 });
      const entries = cloudResourceNames
        .filter((resource) => shared[resource] !== undefined)
        .map((resource) => ({ resource, json: serializeResource(resource, shared[resource]) }));
      if (!entries.length || entries.some((entry) => entry.json === null)) {
        return Response.json({ error: "invalid_shared_state" }, { status: 400 });
      }
      if (
        !mayBootstrapCloudState(access)
        || entries.some((entry) => !mayWriteCloudResource(access, entry.resource))
        || !hasFullResourceWriteScope(access)
      ) {
        return Response.json({ error: "permission_denied" }, { status: 403 });
      }
      const insertedResources: CloudResourceName[] = [];
      for (const entry of entries) {
        if (await bootstrapResource(hospitalId, entry.resource, entry.json as string, access.account.id)) {
          insertedResources.push(entry.resource);
        }
      }
      await recordAudit(
        hospitalId,
        access.account.id,
        "bootstrap_cloud_state",
        hospitalId,
        `inserted=${insertedResources.join(",") || "none"}; preserved=${entries
          .filter((entry) => !insertedResources.includes(entry.resource))
          .map((entry) => entry.resource)
          .join(",") || "none"}`,
      );
      return Response.json(await readCloudState(hospitalId, access));
    }

    if (payload.action === "save_resource") {
      return writeRevisionedResource(hospitalId, payload, access);
    }

    if (payload.action === "delete_resource") {
      if (!isResourceName(payload.resource)) return Response.json({ error: "resource_required" }, { status: 400 });
      if (!mayWriteCloudResource(access, payload.resource)) return Response.json({ error: "permission_denied" }, { status: 403 });
      if (!hasFullResourceWriteScope(access)) return Response.json({ error: "scoped_snapshot_write_denied" }, { status: 403 });
      return Response.json({
        error: "resource_delete_disabled",
        detail: "Use a revisioned PUT/PATCH with an empty resource value.",
      }, { status: 409 });
    }

    if (payload.action === "save_preferences") {
      if (!isRecord(payload.value)) return Response.json({ error: "invalid_preferences" }, { status: 400 });
      if (Object.keys(payload.value).some((key) => !allowedPreferenceKeys.has(key))) {
        return Response.json({ error: "invalid_preferences" }, { status: 400 });
      }
      const currentState = await readCloudState(hospitalId, access);
      const current = currentState.preferences;
      if (payload.value.theme !== undefined && (typeof payload.value.theme !== "string" || !allowedThemes.has(payload.value.theme))) {
        return Response.json({ error: "invalid_theme" }, { status: 400 });
      }
      if (payload.value.density !== undefined && (typeof payload.value.density !== "string" || !allowedDensities.has(payload.value.density))) {
        return Response.json({ error: "invalid_density" }, { status: 400 });
      }
      if (payload.value.contentZoom !== undefined && (typeof payload.value.contentZoom !== "number" || !allowedContentZooms.has(payload.value.contentZoom))) {
        return Response.json({ error: "invalid_content_zoom" }, { status: 400 });
      }
      if (payload.value.department !== undefined && (typeof payload.value.department !== "string" || !payload.value.department.trim() || payload.value.department.trim().length > 100)) {
        return Response.json({ error: "invalid_department" }, { status: 400 });
      }
      if (payload.value.period !== undefined && (typeof payload.value.period !== "string" || !payload.value.period.trim() || payload.value.period.trim().length > 50)) {
        return Response.json({ error: "invalid_period" }, { status: 400 });
      }
      if (payload.value.perspective !== undefined && (typeof payload.value.perspective !== "string" || !allowedPerspectives.has(payload.value.perspective))) {
        return Response.json({ error: "invalid_perspective" }, { status: 400 });
      }
      const notificationPreferences = payload.value.notificationPreferences === undefined
        ? current.notificationPreferences
        : sanitizeNotificationPreferences(payload.value.notificationPreferences, current.notificationPreferences);
      if (!notificationPreferences) return Response.json({ error: "invalid_notification_preferences" }, { status: 400 });
      const readNotificationIds = payload.value.readNotificationIds === undefined
        ? current.readNotificationIds
        : sanitizeReadNotificationIds(payload.value.readNotificationIds);
      if (!readNotificationIds) return Response.json({ error: "invalid_read_notification_ids" }, { status: 400 });
      const activeHospitalId = payload.value.activeHospitalId === undefined
        ? current.activeHospitalId
        : validateHospitalId(payload.value.activeHospitalId);
      if (!activeHospitalId || !await mayUseHospital(access.account.id, activeHospitalId, access.platformAdmin)) {
        return Response.json({ error: "invalid_active_hospital" }, { status: 400 });
      }
      const now = new Date().toISOString();
      const next = {
        theme: (payload.value.theme ?? current.theme) as CloudPreferences["theme"],
        density: (payload.value.density ?? current.density) as CloudPreferences["density"],
        contentZoom: (payload.value.contentZoom ?? current.contentZoom) as number,
        notificationPreferences,
        readNotificationIds,
        activeHospitalId,
        department: typeof payload.value.department === "string" ? payload.value.department.trim() : current.department,
        period: typeof payload.value.period === "string" ? payload.value.period.trim() : current.period,
        perspective: (payload.value.perspective ?? current.perspective) as CloudPreferences["perspective"],
      };
      const preferenceUpdates: {
        theme?: CloudPreferences["theme"];
        density?: CloudPreferences["density"];
        contentZoom?: number;
        notificationPreferencesJson?: string;
        readNotificationIdsJson?: string;
        activeHospitalId?: string;
        department?: string;
        period?: string;
        perspective?: CloudPreferences["perspective"];
        updatedAt: string;
      } = { updatedAt: now };
      if (payload.value.theme !== undefined) preferenceUpdates.theme = next.theme;
      if (payload.value.density !== undefined) preferenceUpdates.density = next.density;
      if (payload.value.contentZoom !== undefined) preferenceUpdates.contentZoom = next.contentZoom;
      if (payload.value.notificationPreferences !== undefined) {
        preferenceUpdates.notificationPreferencesJson = JSON.stringify(next.notificationPreferences);
      }
      if (payload.value.readNotificationIds !== undefined) {
        preferenceUpdates.readNotificationIdsJson = JSON.stringify(next.readNotificationIds);
      }
      if (payload.value.activeHospitalId !== undefined) preferenceUpdates.activeHospitalId = next.activeHospitalId;
      if (payload.value.department !== undefined) preferenceUpdates.department = next.department;
      if (payload.value.period !== undefined) preferenceUpdates.period = next.period;
      if (payload.value.perspective !== undefined) preferenceUpdates.perspective = next.perspective;
      await db.insert(accountCloudPreferences).values({
        accountId: access.account.id,
        theme: next.theme,
        density: next.density,
        contentZoom: next.contentZoom,
        notificationPreferencesJson: JSON.stringify(next.notificationPreferences),
        readNotificationIdsJson: JSON.stringify(next.readNotificationIds),
        activeHospitalId: next.activeHospitalId,
        department: next.department,
        period: next.period,
        perspective: next.perspective,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: accountCloudPreferences.accountId,
        // Update only the fields sent by the client. This prevents two
        // simultaneous preference requests from restoring each other's stale
        // values after both read the same previous row.
        set: preferenceUpdates,
      });
      await recordAudit(hospitalId, access.account.id, "save_cloud_preferences", access.account.id, "更新个人跨设备偏好");
      return Response.json(await readCloudState(hospitalId, access));
    }

    return Response.json({ error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    return cloudStateError(error);
  }
}
