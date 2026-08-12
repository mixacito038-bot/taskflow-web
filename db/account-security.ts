import { and, eq, or } from "drizzle-orm";
import { headers } from "next/headers";
import { getChatGPTUser, type ChatGPTUser } from "../app/chatgpt-auth";
import { getDb } from ".";
import {
  accounts,
  appSessions,
  auditLogs,
} from "./schema";

export const APP_SESSION_COOKIE = "__Host-yh_app_session";
export const APP_SESSION_IDLE_SECONDS = 8 * 60 * 60;
export const APP_SESSION_ABSOLUTE_SECONDS = 24 * 60 * 60;

const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

type HeaderReader = Pick<Headers, "get">;
type SessionRow = typeof appSessions.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;

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

export function appSessionError(error: unknown) {
  if (error instanceof AppSessionRequirementError) {
    return Response.json({ error: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "app_session_validation_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
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
  const db = await getDb();
  const rawToken = readCookie(await getRequestHeaders(request), APP_SESSION_COOKIE);
  const tokenHash = rawToken ? await sha256Hex(rawToken) : null;
  const [tokenSession] = tokenHash
    ? await db.select().from(appSessions).where(eq(appSessions.tokenHash, tokenHash)).limit(1)
    : [];

  // 账号密码会话：会话本身即身份凭证，不依赖统一身份网关请求头。
  if (tokenSession?.authMethod === "password") {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, tokenSession.accountId)).limit(1);
    if (!account || account.status !== "active") {
      return { ssoUser: null, account: account ?? null, session: tokenSession, state: "invalid" };
    }
    return settleSessionLifecycle(db, null, account, tokenSession, touch);
  }

  const ssoUser = await getChatGPTUser();
  if (!ssoUser) return { ssoUser: null, account: null, session: null, state: "unauthenticated" };

  const email = normalizeEmail(ssoUser.email);
  const [account] = await db.select().from(accounts).where(eq(accounts.email, email)).limit(1);
  if (!account || account.status !== "active") {
    return { ssoUser, account: account ?? null, session: null, state: "unprovisioned" };
  }

  const session = tokenSession ?? null;
  if (!session) return { ssoUser, account, session: null, state: "none" };
  if (session.accountId !== account.id || normalizeEmail(session.ssoEmail) !== email) {
    return { ssoUser, account, session, state: "invalid" };
  }
  return settleSessionLifecycle(db, ssoUser, account, session, touch);
}

async function settleSessionLifecycle(
  db: Awaited<ReturnType<typeof getDb>>,
  ssoUser: ChatGPTUser | null,
  account: AccountRow,
  initialSession: SessionRow,
  touch: boolean,
): Promise<AppSessionInspection> {
  let session = initialSession;
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
  authMethod: "sso" | "password" = "sso",
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
    authMethod,
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

export async function writeSecurityAudit(
  accountId: string,
  action: string,
  result: "allowed" | "denied",
  detail: string,
) {
  const db = await getDb();
  await db.insert(auditLogs).values({
    // 账号不存在时（例如密码登录失败）传空串：外键要求必须写 null，
    // 否则整条审计插入会因外键失败并把鉴权错误掩盖成 500。
    actorAccountId: accountId || null,
    action,
    resourceType: "account_security",
    resourceId: accountId || "unknown_account",
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
