import { and, desc, eq } from "drizzle-orm";
import { appSessionError, assertSameOrigin, requireAppSession } from "../../../db/account-security";
import { getCloudStateAccess } from "../../../db/cloud-state";
import { getDb } from "../../../db";
import { auditLogs, benefitReports, reportArtifacts } from "../../../db/schema";

export const dynamic = "force-dynamic";

type R2ObjectBodyLike = {
  body: ReadableStream<Uint8Array>;
  httpMetadata?: { contentType?: string };
};

type R2BucketLike = {
  put(
    key: string,
    value: ArrayBuffer,
    options?: {
      httpMetadata?: { contentType?: string; contentDisposition?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  delete(key: string): Promise<void>;
};

const allowedContentTypes = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
]);
const maximumArtifactBytes = 12 * 1024 * 1024;

async function getReportBucket() {
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as { REPORT_FILES?: R2BucketLike };
  if (!runtimeEnv.REPORT_FILES) throw new Error("R2 binding REPORT_FILES is unavailable");
  return runtimeEnv.REPORT_FILES;
}

function safeHospitalId(value: FormDataEntryValue | string | null) {
  if (typeof value !== "string") return "";
  const hospitalId = value.trim();
  return /^[a-zA-Z0-9_-]{1,128}$/.test(hospitalId) ? hospitalId : "";
}

function safeFileName(value: string) {
  return value.replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim().slice(0, 180);
}

function contentDisposition(fileName: string) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replaceAll('"', "'");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function hex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hasExpectedSignature(contentType: string, bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes);
  if (contentType === "text/csv") return !view.slice(0, Math.min(view.length, 4096)).includes(0);
  return view.length >= 4 && view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04;
}

async function deleteObjectWithRetry(bucket: R2BucketLike, fileKey: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await bucket.delete(fileKey);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function reportFileAccess(email: string, hospitalId: string) {
  const access = await getCloudStateAccess(email, hospitalId);
  if (
    !access
    || (!access.platformAdmin && !access.permissions.has("report.export"))
    || (access.dataScope !== "platform" && access.dataScope !== "hospital")
  ) return null;
  return access;
}

function storageError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("R2 binding")) return Response.json({ error: "artifact_store_unavailable" }, { status: 503 });
  if (message.includes("D1 binding") || message.includes("no such table")) return Response.json({ error: "artifact_metadata_unavailable" }, { status: 503 });
  return Response.json({ error: "artifact_operation_failed" }, { status: 500 });
}

export async function GET(request: Request) {
  let user: Awaited<ReturnType<typeof requireAppSession>>;
  try {
    user = await requireAppSession(request);
  } catch (error) {
    return appSessionError(error);
  }
  const url = new URL(request.url);
  const hospitalId = safeHospitalId(url.searchParams.get("hospitalId"));
  const artifactId = url.searchParams.get("artifactId")?.trim() ?? "";
  if (!hospitalId) return Response.json({ error: "hospital_required" }, { status: 400 });
  try {
    const access = await reportFileAccess(user.email, hospitalId);
    if (!access) return Response.json({ error: "permission_denied" }, { status: 403 });
    const db = await getDb();
    if (artifactId) {
      const [artifact] = await db.select().from(reportArtifacts).where(and(
        eq(reportArtifacts.id, artifactId),
        eq(reportArtifacts.hospitalId, hospitalId),
      )).limit(1);
      if (!artifact) return Response.json({ error: "artifact_not_found" }, { status: 404 });
      const object = await (await getReportBucket()).get(artifact.fileKey);
      if (!object) return Response.json({ error: "artifact_file_missing" }, { status: 404 });
      return new Response(object.body, {
        headers: {
          "content-type": artifact.contentType,
          "content-length": String(artifact.sizeBytes),
          "content-disposition": contentDisposition(artifact.fileName),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
    const rows = await db.select({
      id: reportArtifacts.id,
      reportId: reportArtifacts.reportId,
      fileName: reportArtifacts.fileName,
      contentType: reportArtifacts.contentType,
      sizeBytes: reportArtifacts.sizeBytes,
      sha256: reportArtifacts.sha256,
      createdAt: reportArtifacts.createdAt,
    }).from(reportArtifacts)
      .where(eq(reportArtifacts.hospitalId, hospitalId))
      .orderBy(desc(reportArtifacts.createdAt))
      .limit(100);
    return Response.json({ artifacts: rows });
  } catch (error) {
    return storageError(error);
  }
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
  try {
    const form = await request.formData();
    const hospitalId = safeHospitalId(form.get("hospitalId"));
    const reportId = typeof form.get("reportId") === "string" ? String(form.get("reportId")).trim() : "";
    const claimedSha256 = typeof form.get("sha256") === "string" ? String(form.get("sha256")).toLowerCase().trim() : "";
    const file = form.get("file");
    if (!hospitalId || !reportId || !(file instanceof File)) return Response.json({ error: "invalid_artifact" }, { status: 400 });
    if (!/^[a-f0-9]{64}$/.test(claimedSha256)) return Response.json({ error: "invalid_hash" }, { status: 400 });
    const access = await reportFileAccess(user.email, hospitalId);
    if (!access) return Response.json({ error: "permission_denied" }, { status: 403 });
    const fileName = safeFileName(file.name);
    const contentType = file.type.split(";", 1)[0].trim().toLowerCase();
    if (!fileName || !allowedContentTypes.has(contentType) || file.size <= 0 || file.size > maximumArtifactBytes) {
      return Response.json({ error: "invalid_artifact" }, { status: 400 });
    }
    const db = await getDb();
    const [report] = await db.select({
      id: benefitReports.id,
      status: benefitReports.status,
      snapshotJson: benefitReports.snapshotJson,
    }).from(benefitReports).where(and(
      eq(benefitReports.id, reportId),
      eq(benefitReports.hospitalId, hospitalId),
    )).limit(1);
    if (!report) return Response.json({ error: "report_not_found" }, { status: 404 });
    if (report.status !== "issued") return Response.json({ error: "report_not_issued" }, { status: 409 });
    if (!access.platformAdmin && !access.permissions.has("report.approve")) {
      return Response.json({ error: "issued_artifact_permission_denied" }, { status: 403 });
    }
    const officialFileName = contentType === "text/csv"
      ? fileName.endsWith("-已签发.csv")
      : fileName.endsWith("-正式签发版.docx");
    if (!report.snapshotJson || !officialFileName) {
      return Response.json({ error: "invalid_issued_artifact" }, { status: 409 });
    }
    const bytes = await file.arrayBuffer();
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    if (claimedSha256 !== sha256) return Response.json({ error: "hash_mismatch" }, { status: 409 });
    if (!hasExpectedSignature(contentType, bytes)) return Response.json({ error: "invalid_file_signature" }, { status: 400 });
    const [existingOfficial] = await db.select().from(reportArtifacts).where(and(
      eq(reportArtifacts.hospitalId, hospitalId),
      eq(reportArtifacts.reportId, reportId),
      eq(reportArtifacts.contentType, contentType),
    )).limit(1);
    if (existingOfficial && existingOfficial.sha256 !== sha256) {
      return Response.json({ error: "issued_artifact_conflict" }, { status: 409 });
    }
    if (existingOfficial) {
      return Response.json({
        artifact: {
          id: existingOfficial.id,
          reportId: existingOfficial.reportId,
          fileName: existingOfficial.fileName,
          contentType: existingOfficial.contentType,
          sizeBytes: existingOfficial.sizeBytes,
          sha256: existingOfficial.sha256,
          createdAt: existingOfficial.createdAt,
        },
      });
    }

    const artifactId = `artifact-${crypto.randomUUID()}`;
    const extension = contentType === "text/csv" ? "csv" : "docx";
    const fileKey = `reports/${hospitalId}/${reportId}/${new Date().toISOString().slice(0, 10)}/${artifactId}.${extension}`;
    const bucket = await getReportBucket();
    await bucket.put(fileKey, bytes, {
      httpMetadata: { contentType, contentDisposition: contentDisposition(fileName) },
      customMetadata: { hospitalId, reportId, sha256 },
    });
    try {
      await db.batch([
        db.insert(reportArtifacts).values({
          id: artifactId,
          hospitalId,
          reportId,
          actorAccountId: access.account.id,
          fileKey,
          fileName,
          contentType,
          sizeBytes: file.size,
          sha256,
        }),
        db.insert(auditLogs).values({
          hospitalId,
          actorAccountId: access.account.id,
          action: "store_report_artifact",
          resourceType: "report_artifact",
          resourceId: artifactId,
          result: "allowed",
          detail: `${fileName} · ${file.size} bytes · SHA-256 ${sha256}`,
        }),
      ]);
    } catch (error) {
      await deleteObjectWithRetry(bucket, fileKey);
      throw error;
    }
    return Response.json({
      artifact: {
        id: artifactId,
        reportId,
        fileName,
        contentType,
        sizeBytes: file.size,
        sha256,
        createdAt: new Date().toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    return storageError(error);
  }
}
