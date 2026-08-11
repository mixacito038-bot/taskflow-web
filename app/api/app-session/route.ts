import { getChatGPTUser } from "../../chatgpt-auth";
import { resolveSsoAccount } from "../../../db/account-access";
import {
  appSessionCookie,
  appSessionError,
  assertSameOrigin,
  clearAppSessionCookie,
  getMfaStatus,
  inspectAppSession,
  issueAppSession,
  lockAppSession,
  mfaVerificationError,
  MfaVerificationError,
  revokeAllAppSessions,
  revokeCurrentAppSession,
  verifyMfaFactor,
  writeSecurityAudit,
  type AppSessionInspection,
  type MfaFactor,
} from "../../../db/account-security";

type AppSessionAction = "status" | "start" | "unlock" | "lock" | "revoke" | "revoke_all";

type AppSessionRequest = MfaFactor & {
  action?: AppSessionAction;
};

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const inspection = await inspectAppSession(request);
    const response = Response.json(await statusPayload(inspection), { headers: NO_STORE_HEADERS });
    if (["revoked", "expired", "invalid"].includes(inspection.state)) {
      response.headers.set("Set-Cookie", clearAppSessionCookie());
    }
    return response;
  } catch {
    return Response.json({ error: "app_session_status_failed" }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    return withNoStore(appSessionError(error));
  }

  let payload: AppSessionRequest;
  try {
    payload = await request.json() as AppSessionRequest;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const action = payload.action;
  if (!action) return Response.json({ error: "action_required" }, { status: 400, headers: NO_STORE_HEADERS });

  try {
    if (action === "status") {
      return Response.json(await statusPayload(await inspectAppSession(request)), { headers: NO_STORE_HEADERS });
    }
    if (action === "start") return await startSession(request, payload);
    if (action === "unlock") return await unlockSession(request, payload);
    if (action === "lock") {
      await lockAppSession(request);
      const inspection = await inspectAppSession(request);
      return Response.json(await statusPayload(inspection), { headers: NO_STORE_HEADERS });
    }
    if (action === "revoke") {
      await revokeCurrentAppSession(request);
      return Response.json({
        ssoAuthenticated: true,
        provisioned: true,
        appSession: { status: "revoked" },
      }, { headers: { ...NO_STORE_HEADERS, "Set-Cookie": clearAppSessionCookie() } });
    }
    if (action === "revoke_all") {
      await revokeAllAppSessions(request);
      return Response.json({
        ssoAuthenticated: true,
        provisioned: true,
        appSession: { status: "revoked" },
      }, { headers: { ...NO_STORE_HEADERS, "Set-Cookie": clearAppSessionCookie() } });
    }
    return Response.json({ error: "unsupported_action" }, { status: 400, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof MfaVerificationError) return withNoStore(mfaVerificationError(error));
    return withNoStore(appSessionError(error));
  }
}

async function startSession(request: Request, factor: MfaFactor) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  const account = await resolveSsoAccount(user);
  if (!account) return Response.json({ error: "account_not_provisioned" }, { status: 403, headers: NO_STORE_HEADERS });
  if (account.status !== "active") return Response.json({ error: "account_disabled" }, { status: 403, headers: NO_STORE_HEADERS });

  const mfa = await getMfaStatus(account.id);
  if (mfa.enabled) {
    try {
      const method = await verifyMfaFactor(account.id, factor);
      await writeSecurityAudit(account.id, "app_session_mfa", "allowed", `新会话通过${method === "recovery" ? "恢复码" : "动态口令"}验证`);
    } catch (error) {
      await writeSecurityAudit(account.id, "app_session_mfa", "denied", "新会话多因素验证失败");
      throw error;
    }
  }
  assertMfaSnapshotUnchanged(mfa, await getMfaStatus(account.id));

  const issued = await issueAppSession(account, user.email, request);
  await writeSecurityAudit(account.id, "app_session_start", "allowed", "新应用会话已创建并轮换令牌");
  return Response.json({
    ssoAuthenticated: true,
    provisioned: true,
    account: {
      email: account.email,
      displayName: account.displayName,
    },
    appSession: {
      status: "active",
      createdAt: issued.context.createdAt,
      lastSeenAt: issued.context.lastSeenAt,
      idleExpiresAt: issued.context.idleExpiresAt,
      absoluteExpiresAt: issued.context.absoluteExpiresAt,
    },
    mfa: await getMfaStatus(account.id),
  }, { headers: { ...NO_STORE_HEADERS, "Set-Cookie": appSessionCookie(issued.rawToken) } });
}

async function unlockSession(request: Request, factor: MfaFactor) {
  const inspection = await inspectAppSession(request);
  if (inspection.state === "unauthenticated") {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  if (inspection.state !== "locked" || !inspection.account || !inspection.ssoUser) {
    return Response.json({ error: "app_session_not_locked" }, { status: 409, headers: NO_STORE_HEADERS });
  }

  const mfa = await getMfaStatus(inspection.account.id);
  if (mfa.enabled) {
    try {
      const method = await verifyMfaFactor(inspection.account.id, factor);
      await writeSecurityAudit(inspection.account.id, "app_session_unlock_mfa", "allowed", `解锁通过${method === "recovery" ? "恢复码" : "动态口令"}验证`);
    } catch (error) {
      await writeSecurityAudit(inspection.account.id, "app_session_unlock_mfa", "denied", "应用会话解锁验证失败");
      throw error;
    }
  }
  assertMfaSnapshotUnchanged(mfa, await getMfaStatus(inspection.account.id));

  const issued = await issueAppSession(inspection.account, inspection.ssoUser.email, request);
  await writeSecurityAudit(inspection.account.id, "app_session_unlock", "allowed", "应用会话已解锁并轮换令牌");
  return Response.json({
    ssoAuthenticated: true,
    provisioned: true,
    account: {
      email: inspection.account.email,
      displayName: inspection.account.displayName,
    },
    appSession: {
      status: "active",
      createdAt: issued.context.createdAt,
      lastSeenAt: issued.context.lastSeenAt,
      idleExpiresAt: issued.context.idleExpiresAt,
      absoluteExpiresAt: issued.context.absoluteExpiresAt,
    },
    mfa: await getMfaStatus(inspection.account.id),
  }, { headers: { ...NO_STORE_HEADERS, "Set-Cookie": appSessionCookie(issued.rawToken) } });
}

async function statusPayload(inspection: AppSessionInspection) {
  const session = inspection.session;
  return {
    ssoAuthenticated: Boolean(inspection.ssoUser),
    provisioned: Boolean(inspection.account?.status === "active"),
    ...(inspection.account ? {
      account: {
        email: inspection.account.email,
        displayName: inspection.account.displayName,
      },
      mfa: await getMfaStatus(inspection.account.id),
    } : {}),
    appSession: {
      status: inspection.state,
      ...(session ? {
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        idleExpiresAt: session.idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
        lockedAt: session.lockedAt,
      } : {}),
    },
  };
}

function withNoStore(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function assertMfaSnapshotUnchanged(
  before: Awaited<ReturnType<typeof getMfaStatus>>,
  after: Awaited<ReturnType<typeof getMfaStatus>>,
) {
  if (
    before.status !== after.status
    || before.confirmedAt !== after.confirmedAt
    || before.pendingExpiresAt !== after.pendingExpiresAt
  ) {
    throw new MfaVerificationError("mfa_state_changed", 409);
  }
}
