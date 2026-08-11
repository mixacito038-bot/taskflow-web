import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { getChatGPTUser, type ChatGPTUser } from "../app/chatgpt-auth";
import { PRODUCT_FULL_NAME } from "../app/brand";
import { getDb } from ".";
import {
  accountMfaSettings,
  accountRecoveryCodes,
  accounts,
  appSessions,
  auditLogs,
} from "./schema";

export const APP_SESSION_COOKIE = "__Host-yh_app_session";
export const APP_SESSION_IDLE_SECONDS = 8 * 60 * 60;
export const APP_SESSION_ABSOLUTE_SECONDS = 24 * 60 * 60;

const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MFA_LOCK_THRESHOLD = 5;
const MFA_LOCK_MS = 15 * 60 * 1000;
const MFA_PENDING_MS = 10 * 60 * 1000;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
const RECOVERY_CODE_COUNT = 10;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MFA_ISSUER = PRODUCT_FULL_NAME;

type HeaderReader = Pick<Headers, "get">;
type SessionRow = typeof appSessions.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;
type MfaRow = typeof accountMfaSettings.$inferSelect;

export type AppSessionState =
  | "unauthenticated"
  | "unprovisioned"
  | "none"
  | "active"
  | "locked"
  | "revoked"
  | "expired"
  | "invalid";

export type AppSessionContext = {
  sessionId: string;
  accountId: string;
  email: string;
  displayName: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
};

export type AppSessionInspection = {
  ssoUser: ChatGPTUser | null;
  account: AccountRow | null;
  session: SessionRow | null;
  state: AppSessionState;
};

export type MfaPublicStatus = {
  status: "disabled" | "pending" | "enabled";
  enabled: boolean;
  confirmedAt: string | null;
  pendingExpiresAt: string | null;
  lockedUntil: string | null;
  recoveryCodesRemaining: number;
};

export type MfaFactor = {
  totpCode?: string;
  recoveryCode?: string;
};

export class AppSessionRequirementError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "AppSessionRequirementError";
    this.code = code;
    this.status = status;
  }
}

export class MfaVerificationError extends Error {
  readonly code: string;
  readonly status: number;
  readonly lockedUntil: string | null;

  constructor(code: string, status = 400, lockedUntil: string | null = null) {
    super(code);
    this.name = "MfaVerificationError";
    this.code = code;
    this.status = status;
    this.lockedUntil = lockedUntil;
  }
}

export function appSessionError(error: unknown) {
  if (error instanceof AppSessionRequirementError) {
    return Response.json({ error: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "app_session_validation_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export function mfaVerificationError(error: unknown) {
  if (error instanceof MfaVerificationError) {
    return Response.json({
      error: error.code,
      ...(error.lockedUntil ? { lockedUntil: error.lockedUntil } : {}),
    }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "mfa_verification_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new AppSessionRequirementError("origin_required", 403);
  let requestOrigin: string;
  let suppliedOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
    suppliedOrigin = new URL(origin).origin;
  } catch {
    throw new AppSessionRequirementError("origin_invalid", 403);
  }
  if (requestOrigin !== suppliedOrigin) {
    throw new AppSessionRequirementError("origin_mismatch", 403);
  }
}

export async function inspectAppSession(request?: Request, touch = false): Promise<AppSessionInspection> {
  const ssoUser = await getChatGPTUser();
  if (!ssoUser) return { ssoUser: null, account: null, session: null, state: "unauthenticated" };

  const db = await getDb();
  const email = normalizeEmail(ssoUser.email);
  const [account] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
  if (!account || account.status !== "active") {
    return { ssoUser, account: account ?? null, session: null, state: "unprovisioned" };
  }

  const rawToken = readCookie(await getRequestHeaders(request), APP_SESSION_COOKIE);
  if (!rawToken) return { ssoUser, account, session: null, state: "none" };
  const tokenHash = await sha256Hex(rawToken);
  let [session] = await db.select().from(appSessions).where(eq(appSessions.tokenHash, tokenHash)).limit(1);
  if (!session) return { ssoUser, account, session: null, state: "none" };
  if (session.accountId !== account.id || normalizeEmail(session.ssoEmail) !== email) {
    return { ssoUser, account, session, state: "invalid" };
  }

  const now = Date.now();
  if (Date.parse(session.absoluteExpiresAt) <= now || Date.parse(session.idleExpiresAt) <= now) {
    const revokedAt = new Date(now).toISOString();
    await db.update(appSessions).set({ status: "revoked", revokedAt }).where(and(
      eq(appSessions.id, session.id),
      or(eq(appSessions.status, "active"), eq(appSessions.status, "locked")),
    ));
    session = { ...session, status: "revoked", revokedAt };
    return { ssoUser, account, session, state: "expired" };
  }

  if (session.status === "revoked") return { ssoUser, account, session, state: "revoked" };
  if (session.status === "locked") return { ssoUser, account, session, state: "locked" };

  if (touch && now - Date.parse(session.lastSeenAt) >= SESSION_TOUCH_INTERVAL_MS) {
    const lastSeenAt = new Date(now).toISOString();
    const idleExpiresAt = new Date(Math.min(
      now + APP_SESSION_IDLE_SECONDS * 1000,
      Date.parse(session.absoluteExpiresAt),
    )).toISOString();
    const [touched] = await db.update(appSessions).set({ lastSeenAt, idleExpiresAt }).where(and(
      eq(appSessions.id, session.id),
      eq(appSessions.status, "active"),
    )).returning();
    if (touched) session = touched;
  }

  return { ssoUser, account, session, state: "active" };
}

export async function requireAppSession(request?: Request): Promise<AppSessionContext> {
  const inspection = await inspectAppSession(request, true);
  if (inspection.state === "unauthenticated") {
    throw new AppSessionRequirementError("authentication_required", 401);
  }
  if (inspection.state !== "active" || !inspection.account || !inspection.session) {
    const code = inspection.state === "locked"
      ? "app_session_locked"
      : inspection.state === "expired"
        ? "app_session_expired"
        : inspection.state === "unprovisioned"
          ? "account_not_provisioned"
          : "app_session_required";
    throw new AppSessionRequirementError(code, 423);
  }
  return sessionContext(inspection.account, inspection.session);
}

export async function issueAppSession(
  account: AccountRow,
  ssoEmail: string,
  request?: Request,
) {
  const db = await getDb();
  const requestHeaders = await getRequestHeaders(request);
  const oldToken = readCookie(requestHeaders, APP_SESSION_COOKIE);
  if (oldToken) {
    const oldTokenHash = await sha256Hex(oldToken);
    const revokedAt = new Date().toISOString();
    await db.update(appSessions).set({ status: "revoked", revokedAt }).where(and(
      eq(appSessions.tokenHash, oldTokenHash),
      or(eq(appSessions.status, "active"), eq(appSessions.status, "locked")),
    ));
  }

  const rawToken = randomBase64Url(32);
  const tokenHash = await sha256Hex(rawToken);
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const idleExpiresAt = new Date(now + APP_SESSION_IDLE_SECONDS * 1000).toISOString();
  const absoluteExpiresAt = new Date(now + APP_SESSION_ABSOLUTE_SECONDS * 1000).toISOString();
  const [session] = await db.insert(appSessions).values({
    id: `session-${crypto.randomUUID()}`,
    tokenHash,
    accountId: account.id,
    ssoEmail: normalizeEmail(ssoEmail),
    status: "active",
    createdAt,
    lastSeenAt: createdAt,
    idleExpiresAt,
    absoluteExpiresAt,
  }).returning();
  return {
    rawToken,
    context: sessionContext(account, session),
  };
}

export async function lockAppSession(request?: Request) {
  const context = await requireAppSession(request);
  const db = await getDb();
  const lockedAt = new Date().toISOString();
  const [locked] = await db.update(appSessions).set({ status: "locked", lockedAt }).where(and(
    eq(appSessions.id, context.sessionId),
    eq(appSessions.status, "active"),
  )).returning({ id: appSessions.id });
  if (!locked) throw new AppSessionRequirementError("app_session_state_changed", 409);
  await writeSecurityAudit(context.accountId, "app_session_lock", "allowed", "应用会话已锁定");
  return { ...context, status: "locked" as const, lockedAt };
}

export async function revokeCurrentAppSession(request?: Request) {
  const inspection = await inspectAppSession(request);
  if (inspection.state === "unauthenticated") {
    throw new AppSessionRequirementError("authentication_required", 401);
  }
  if (!inspection.account || !inspection.session || !["active", "locked"].includes(inspection.state)) {
    throw new AppSessionRequirementError("app_session_required", 423);
  }
  const db = await getDb();
  const revokedAt = new Date().toISOString();
  const [revoked] = await db.update(appSessions).set({ status: "revoked", revokedAt }).where(and(
    eq(appSessions.id, inspection.session.id),
    or(eq(appSessions.status, "active"), eq(appSessions.status, "locked")),
  )).returning({ id: appSessions.id });
  if (!revoked) throw new AppSessionRequirementError("app_session_state_changed", 409);
  await writeSecurityAudit(inspection.account.id, "app_session_revoke", "allowed", "当前应用会话已撤销");
}

export async function revokeAllAppSessions(request?: Request) {
  const context = await requireAppSession(request);
  const db = await getDb();
  const revokedAt = new Date().toISOString();
  await db.update(appSessions).set({ status: "revoked", revokedAt }).where(and(
    eq(appSessions.accountId, context.accountId),
    or(eq(appSessions.status, "active"), eq(appSessions.status, "locked")),
  ));
  await writeSecurityAudit(context.accountId, "app_session_revoke_all", "allowed", "账号全部应用会话已撤销");
}

export function appSessionCookie(rawToken: string) {
  return `${APP_SESSION_COOKIE}=${rawToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${APP_SESSION_ABSOLUTE_SECONDS}`;
}

export function clearAppSessionCookie() {
  return `${APP_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function getMfaStatus(accountId: string): Promise<MfaPublicStatus> {
  const db = await getDb();
  let [settings] = await db.select().from(accountMfaSettings).where(eq(accountMfaSettings.accountId, accountId)).limit(1);
  if (settings && await expirePendingMfaIfNeeded(settings)) {
    [settings] = await db.select().from(accountMfaSettings).where(eq(accountMfaSettings.accountId, accountId)).limit(1);
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(accountRecoveryCodes).where(and(
    eq(accountRecoveryCodes.accountId, accountId),
    isNull(accountRecoveryCodes.usedAt),
  ));
  if (!settings) {
    return { status: "disabled", enabled: false, confirmedAt: null, pendingExpiresAt: null, lockedUntil: null, recoveryCodesRemaining: 0 };
  }
  return {
    status: settings.status,
    enabled: settings.status === "enabled",
    confirmedAt: settings.confirmedAt,
    pendingExpiresAt: settings.status === "pending" ? settings.pendingExpiresAt : null,
    lockedUntil: isFuture(settings.lockedUntil) ? settings.lockedUntil : null,
    recoveryCodesRemaining: Number(count ?? 0),
  };
}

export async function beginMfaEnrollment(accountId: string, email: string) {
  const db = await getDb();
  let [existing] = await db.select().from(accountMfaSettings).where(eq(accountMfaSettings.accountId, accountId)).limit(1);
  if (existing?.status === "pending" && await expirePendingMfaIfNeeded(existing)) {
    [existing] = await db.select().from(accountMfaSettings).where(eq(accountMfaSettings.accountId, accountId)).limit(1);
  }
  if (existing?.status === "enabled") throw new MfaVerificationError("mfa_already_enabled", 409);
  if (existing?.status === "pending") throw new MfaVerificationError("mfa_enrollment_pending", 409);

  const secretBytes = crypto.getRandomValues(new Uint8Array(20));
  const secret = base32Encode(secretBytes);
  const encrypted = await encryptTotpSecret(secret);
  const now = new Date().toISOString();
  const pendingExpiresAt = new Date(Date.now() + MFA_PENDING_MS).toISOString();
  const [pending] = await db.insert(accountMfaSettings).values({
    accountId,
    status: "pending",
    secretCiphertext: encrypted.ciphertext,
    secretIv: encrypted.iv,
    lastTotpCounter: -1,
    failedAttempts: 0,
    lockedUntil: null,
    pendingExpiresAt,
    confirmedAt: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: accountMfaSettings.accountId,
    setWhere: eq(accountMfaSettings.status, "disabled"),
    set: {
      status: "pending",
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      lastTotpCounter: -1,
      failedAttempts: 0,
      lockedUntil: null,
      pendingExpiresAt,
      confirmedAt: null,
      updatedAt: now,
    },
  }).returning({ accountId: accountMfaSettings.accountId });
  if (!pending) throw new MfaVerificationError("mfa_state_changed", 409);
  await db.delete(accountRecoveryCodes).where(eq(accountRecoveryCodes.accountId, accountId));
  await writeSecurityAudit(accountId, "mfa_begin", "allowed", "开始绑定身份验证器");

  const label = `${MFA_ISSUER}:${normalizeEmail(email)}`;
  const otpauthUri = `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(MFA_ISSUER)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
  return { secret, otpauthUri, pendingExpiresAt };
}

export async function confirmMfaEnrollment(accountId: string, totpCode: string) {
  const db = await getDb();
  const settings = await getMfaRow(accountId);
  if (settings?.status === "pending" && await expirePendingMfaIfNeeded(settings)) {
    await writeSecurityAudit(accountId, "mfa_confirm", "denied", "身份验证器绑定已超时");
    throw new MfaVerificationError("mfa_enrollment_expired", 410);
  }
  if (!settings || settings.status !== "pending" || !settings.secretCiphertext || !settings.secretIv || !settings.pendingExpiresAt) {
    throw new MfaVerificationError("mfa_enrollment_not_pending", 409);
  }
  await clearExpiredMfaLock(settings);
  const refreshed = await getMfaRow(accountId);
  assertMfaNotLocked(refreshed);
  const secret = await decryptTotpSecret(refreshed!.secretCiphertext!, refreshed!.secretIv!);
  const matchedCounter = await matchTotpCounter(secret, totpCode, refreshed!.lastTotpCounter);
  if (matchedCounter === null) {
    const failure = await recordMfaFailure(accountId);
    await writeSecurityAudit(accountId, "mfa_confirm", "denied", "身份验证器验证码校验失败");
    throw failure;
  }

  const confirmedAt = new Date().toISOString();
  const [updated] = await db.update(accountMfaSettings).set({
    status: "enabled",
    lastTotpCounter: matchedCounter,
    failedAttempts: 0,
    lockedUntil: null,
    pendingExpiresAt: null,
    confirmedAt,
    updatedAt: confirmedAt,
  }).where(and(
    eq(accountMfaSettings.accountId, accountId),
    eq(accountMfaSettings.status, "pending"),
    lt(accountMfaSettings.lastTotpCounter, matchedCounter),
    eq(accountMfaSettings.secretCiphertext, refreshed!.secretCiphertext!),
    eq(accountMfaSettings.secretIv, refreshed!.secretIv!),
    eq(accountMfaSettings.pendingExpiresAt, refreshed!.pendingExpiresAt!),
    eq(accountMfaSettings.updatedAt, refreshed!.updatedAt),
  )).returning();
  if (!updated) throw new MfaVerificationError("mfa_code_replayed", 409);

  const recoveryCodes = await replaceRecoveryCodes(accountId);
  await writeSecurityAudit(accountId, "mfa_confirm", "allowed", "身份验证器已启用并生成恢复码");
  return { confirmedAt, recoveryCodes };
}

export async function cancelMfaEnrollment(accountId: string) {
  const db = await getDb();
  const settings = await getMfaRow(accountId);
  if (settings?.status === "enabled") {
    throw new MfaVerificationError("mfa_already_enabled", 409);
  }
  if (!settings || settings.status === "disabled") return;

  const now = new Date().toISOString();
  const [cancelled] = await db.update(accountMfaSettings).set({
    status: "disabled",
    secretCiphertext: null,
    secretIv: null,
    lastTotpCounter: -1,
    failedAttempts: 0,
    lockedUntil: null,
    pendingExpiresAt: null,
    confirmedAt: null,
    updatedAt: now,
  }).where(and(
    eq(accountMfaSettings.accountId, accountId),
    eq(accountMfaSettings.status, "pending"),
    settings.secretCiphertext
      ? eq(accountMfaSettings.secretCiphertext, settings.secretCiphertext)
      : isNull(accountMfaSettings.secretCiphertext),
    settings.pendingExpiresAt
      ? eq(accountMfaSettings.pendingExpiresAt, settings.pendingExpiresAt)
      : isNull(accountMfaSettings.pendingExpiresAt),
    eq(accountMfaSettings.updatedAt, settings.updatedAt),
  )).returning({ accountId: accountMfaSettings.accountId });
  if (!cancelled) {
    const current = await getMfaRow(accountId);
    if (current?.status === "enabled") {
      throw new MfaVerificationError("mfa_already_enabled", 409);
    }
    return;
  }
  await db.delete(accountRecoveryCodes).where(eq(accountRecoveryCodes.accountId, accountId));
  await writeSecurityAudit(accountId, "mfa_cancel", "allowed", "已取消身份验证器绑定并清除临时密钥");
}

export async function verifyMfaFactor(accountId: string, factor: MfaFactor) {
  let settings = await getMfaRow(accountId);
  if (!settings || settings.status !== "enabled") throw new MfaVerificationError("mfa_not_enabled", 409);
  await clearExpiredMfaLock(settings);
  settings = await getMfaRow(accountId);
  assertMfaNotLocked(settings);

  const recoveryCode = factor.recoveryCode?.trim();
  if (recoveryCode) {
    const codeHash = await sha256Hex(normalizeRecoveryCode(recoveryCode));
    const db = await getDb();
    const [code] = await db.select().from(accountRecoveryCodes).where(and(
      eq(accountRecoveryCodes.accountId, accountId),
      eq(accountRecoveryCodes.codeHash, codeHash),
      isNull(accountRecoveryCodes.usedAt),
    )).limit(1);
    if (code) {
      const [consumed] = await db.update(accountRecoveryCodes).set({ usedAt: new Date().toISOString() }).where(and(
        eq(accountRecoveryCodes.id, code.id),
        isNull(accountRecoveryCodes.usedAt),
      )).returning();
      if (consumed) {
        await resetMfaFailures(accountId);
        return "recovery" as const;
      }
    }
    const failure = await recordMfaFailure(accountId);
    throw failure;
  }

  const totpCode = factor.totpCode?.trim();
  if (!totpCode) throw new MfaVerificationError("mfa_factor_required", 428);
  if (!settings!.secretCiphertext || !settings!.secretIv) throw new MfaVerificationError("mfa_configuration_invalid", 500);
  const secret = await decryptTotpSecret(settings!.secretCiphertext, settings!.secretIv);
  const matchedCounter = await matchTotpCounter(secret, totpCode, settings!.lastTotpCounter);
  if (matchedCounter === null) {
    const failure = await recordMfaFailure(accountId);
    throw failure;
  }

  const db = await getDb();
  const [updated] = await db.update(accountMfaSettings).set({
    lastTotpCounter: matchedCounter,
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date().toISOString(),
  }).where(and(
    eq(accountMfaSettings.accountId, accountId),
    eq(accountMfaSettings.status, "enabled"),
    lt(accountMfaSettings.lastTotpCounter, matchedCounter),
    eq(accountMfaSettings.secretCiphertext, settings!.secretCiphertext),
    settings!.confirmedAt
      ? eq(accountMfaSettings.confirmedAt, settings!.confirmedAt)
      : isNull(accountMfaSettings.confirmedAt),
  )).returning();
  if (!updated) {
    const failure = await recordMfaFailure(accountId);
    throw failure.code === "mfa_invalid" ? new MfaVerificationError("mfa_code_replayed", failure.status, failure.lockedUntil) : failure;
  }
  return "totp" as const;
}

export async function disableMfa(accountId: string) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.update(accountMfaSettings).set({
    status: "disabled",
    secretCiphertext: null,
    secretIv: null,
    lastTotpCounter: -1,
    failedAttempts: 0,
    lockedUntil: null,
    pendingExpiresAt: null,
    confirmedAt: null,
    updatedAt: now,
  }).where(eq(accountMfaSettings.accountId, accountId));
  await db.delete(accountRecoveryCodes).where(eq(accountRecoveryCodes.accountId, accountId));
  await writeSecurityAudit(accountId, "mfa_disable", "allowed", "多因素认证已关闭");
}

export async function writeSecurityAudit(
  accountId: string,
  action: string,
  result: "allowed" | "denied",
  detail: string,
) {
  const db = await getDb();
  await db.insert(auditLogs).values({
    actorAccountId: accountId,
    action,
    resourceType: "account_security",
    resourceId: accountId,
    result,
    detail,
  });
}

function sessionContext(account: AccountRow, session: SessionRow): AppSessionContext {
  return {
    sessionId: session.id,
    accountId: account.id,
    email: account.email,
    displayName: account.displayName,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    idleExpiresAt: session.idleExpiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
  };
}

async function getRequestHeaders(request?: Request): Promise<HeaderReader> {
  return request?.headers ?? await headers();
}

function readCookie(headerReader: HeaderReader, name: string) {
  const cookieHeader = headerReader.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isFuture(value: string | null) {
  return Boolean(value && Date.parse(value) > Date.now());
}

async function getMfaRow(accountId: string): Promise<MfaRow | null> {
  const db = await getDb();
  const [settings] = await db.select().from(accountMfaSettings).where(eq(accountMfaSettings.accountId, accountId)).limit(1);
  return settings ?? null;
}

function assertMfaNotLocked(settings: MfaRow | null) {
  if (settings?.lockedUntil && Date.parse(settings.lockedUntil) > Date.now()) {
    throw new MfaVerificationError("mfa_temporarily_locked", 423, settings.lockedUntil);
  }
}

async function clearExpiredMfaLock(settings: MfaRow) {
  if (!settings.lockedUntil || Date.parse(settings.lockedUntil) > Date.now()) return;
  const db = await getDb();
  await db.update(accountMfaSettings).set({
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date().toISOString(),
  }).where(and(
    eq(accountMfaSettings.accountId, settings.accountId),
    eq(accountMfaSettings.lockedUntil, settings.lockedUntil),
  ));
}

async function expirePendingMfaIfNeeded(settings: MfaRow) {
  if (
    settings.status !== "pending"
    || !settings.pendingExpiresAt
    || Date.parse(settings.pendingExpiresAt) > Date.now()
  ) return false;
  const db = await getDb();
  await db.update(accountMfaSettings).set({
    status: "disabled",
    secretCiphertext: null,
    secretIv: null,
    lastTotpCounter: -1,
    failedAttempts: 0,
    lockedUntil: null,
    pendingExpiresAt: null,
    confirmedAt: null,
    updatedAt: new Date().toISOString(),
  }).where(and(
    eq(accountMfaSettings.accountId, settings.accountId),
    eq(accountMfaSettings.status, "pending"),
    eq(accountMfaSettings.pendingExpiresAt, settings.pendingExpiresAt),
    settings.secretCiphertext
      ? eq(accountMfaSettings.secretCiphertext, settings.secretCiphertext)
      : isNull(accountMfaSettings.secretCiphertext),
    eq(accountMfaSettings.updatedAt, settings.updatedAt),
  ));
  return true;
}

async function resetMfaFailures(accountId: string) {
  const db = await getDb();
  await db.update(accountMfaSettings).set({
    failedAttempts: 0,
    lockedUntil: null,
    updatedAt: new Date().toISOString(),
  }).where(eq(accountMfaSettings.accountId, accountId));
}

async function recordMfaFailure(accountId: string) {
  const now = Date.now();
  const lockCandidate = new Date(now + MFA_LOCK_MS).toISOString();
  const db = await getDb();
  const [updated] = await db.update(accountMfaSettings).set({
    failedAttempts: sql<number>`${accountMfaSettings.failedAttempts} + 1`,
    lockedUntil: sql<string | null>`CASE
      WHEN ${accountMfaSettings.failedAttempts} + 1 >= ${MFA_LOCK_THRESHOLD}
      THEN ${lockCandidate}
      ELSE NULL
    END`,
    updatedAt: new Date(now).toISOString(),
  }).where(eq(accountMfaSettings.accountId, accountId)).returning({
    failedAttempts: accountMfaSettings.failedAttempts,
    lockedUntil: accountMfaSettings.lockedUntil,
  });
  return updated?.lockedUntil
    ? new MfaVerificationError("mfa_temporarily_locked", 423, updated.lockedUntil)
    : new MfaVerificationError("mfa_invalid", 400);
}

async function replaceRecoveryCodes(accountId: string) {
  const db = await getDb();
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  const rows = await Promise.all(codes.map(async (code) => ({
    id: `recovery-${crypto.randomUUID()}`,
    accountId,
    codeHash: await sha256Hex(normalizeRecoveryCode(code)),
  })));
  const inserts = rows.map((row) => db.insert(accountRecoveryCodes).values(row));
  await db.batch([
    db.delete(accountRecoveryCodes).where(eq(accountRecoveryCodes.accountId, accountId)),
    ...inserts,
  ] as const);
  return codes;
}

function generateRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const value = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte & 31]).join("");
  return `YH-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

function normalizeRecoveryCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function encryptTotpSecret(secret: string) {
  const key = await getTotpEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptTotpSecret(ciphertext: string, iv: string) {
  const key = await getTotpEncryptionKey();
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(iv) },
      key,
      base64UrlToBytes(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new MfaVerificationError("mfa_secret_decryption_failed", 500);
  }
}

async function getTotpEncryptionKey() {
  const { env } = await import("cloudflare:workers");
  const runtimeEnv = env as unknown as { MFA_TOTP_ENCRYPTION_KEY?: string };
  const rawKey = runtimeEnv.MFA_TOTP_ENCRYPTION_KEY?.trim();
  if (!rawKey) throw new MfaVerificationError("mfa_encryption_key_unavailable", 503);
  const keyBytes = decodeEncryptionKey(rawKey);
  if (keyBytes.byteLength !== 32) throw new MfaVerificationError("mfa_encryption_key_invalid", 503);
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function decodeEncryptionKey(value: string) {
  if (/^[a-f0-9]{64}$/i.test(value)) {
    return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
  }
  try {
    return base64UrlToBytes(value);
  } catch {
    throw new MfaVerificationError("mfa_encryption_key_invalid", 503);
  }
}

async function matchTotpCounter(secret: string, code: string, lastCounter: number) {
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return null;
  const nowCounter = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
  const secretBytes = base32Decode(secret);
  for (const offset of [-1, 0, 1]) {
    const counter = nowCounter + offset;
    if (counter <= lastCounter) continue;
    const expected = await generateTotp(secretBytes, counter);
    if (constantTimeEqual(expected, code)) return counter;
  }
  return null;
}

async function generateTotp(secret: Uint8Array, counter: number) {
  const counterBytes = new Uint8Array(8);
  let value = BigInt(counter);
  for (let index = 7; index >= 0; index -= 1) {
    counterBytes[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  const key = await crypto.subtle.importKey("raw", new Uint8Array(secret).buffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = (
    ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff)
  ) >>> 0;
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, "0");
}

function base32Encode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

function base32Decode(value: string) {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value.toUpperCase().replace(/=+$/g, "")) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new MfaVerificationError("mfa_configuration_invalid", 500);
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function randomBase64Url(length: number) {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

async function sha256Hex(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
