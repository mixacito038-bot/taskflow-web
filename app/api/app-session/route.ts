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
import {
  changeAccountPassword,
  getAccountCredentialSummary,
  maybeBootstrapAdminCredential,
  PasswordAuthError,
  passwordAuthError,
  verifyPasswordLogin,
} from "../../../db/password-auth";

type AppSessionAction =
  | "status"
  | "start"
  | "unlock"
  | "lock"
  | "revoke"
  | "revoke_all"
  | "password_login"
  | "change_password";

type AppSessionRequest = MfaFactor & {
  action?: AppSessionAction;
  username?: string;
  password?: string;
  currentPassword?: string;
  newPassword?: string;
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
    if (action === "password_login") return await passwordLogin(request, payload);
    if (action === "change_password") return await changePassword(request, payload);
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
    if (error instanceof PasswordAuthError) return withNoStore(passwordAuthError(error));
    return withNoStore(appSessionError(error));
  }
}

async function passwordLogin(request: Request, payload: AppSessionRequest) {
  const username = typeof payload.username === "string" ? payload.username.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!username || !password) {
    return Response.json({ error: "credentials_required" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  await maybeBootstrapAdminCredential(username, password);
  let account: Awaited<ReturnType<typeof verifyPasswordLogin>>["account"];
  try {
    ({ account } = await verifyPasswordLogin(username, password));
  } catch (error) {
    // 失败/锁定路径也要留痕（对齐 MFA 失败写 denied 审计）；账号可能不存在，故
    // actorAccountId 留空，脱敏用户名与失败原因记入 detail。审计失败不得掩盖鉴权错误。
    const reason = error instanceof PasswordAuthError ? error.code : "password_login_failed";
    try {
      await writeSecurityAudit("", "password_login", "denied", `账号密码登录失败：${reason}（尝试账号 ${maskUsername(username)}）`);
    } catch {
      // 审计写入失败时静默，优先向调用方返回原始鉴权错误。
    }
    throw error;
  }

  const mfa = await getMfaStatus(account.id);
  if (mfa.enabled) {
    if (!payload.totpCode && !payload.recoveryCode) {
      return Response.json({ error: "mfa_required" }, { status: 401, headers: NO_STORE_HEADERS });
    }
    try {
      const method = await verifyMfaFactor(account.id, payload);
      await writeSecurityAudit(account.id, "password_login_mfa", "allowed", `密码登录通过${method === "recovery" ? "恢复码" : "动态口令"}验证`);
    } catch (error) {
      await writeSecurityAudit(account.id, "password_login_mfa", "denied", "密码登录多因素验证失败");
      throw error;
    }
  }
  assertMfaSnapshotUnchanged(mfa, await getMfaStatus(account.id));

  const issued = await issueAppSession(account, account.email, request, "password");
  await writeSecurityAudit(account.id, "password_login", "allowed", "账号密码登录建立应用会话");
  const credential = await getAccountCredentialSummary(account.id);
  return Response.json({
    ssoAuthenticated: false,
    provisioned: true,
    authMethod: "password",
    account: {
      email: account.email,
      displayName: account.displayName,
    },
    mustChangePassword: credential?.mustChangePassword ?? false,
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

async function changePassword(request: Request, payload: AppSessionRequest) {
  const inspection = await inspectAppSession(request);
  if (inspection.state !== "active" || !inspection.account) {
    return Response.json({ error: "app_session_required" }, { status: 423, headers: NO_STORE_HEADERS });
  }
  const currentPassword = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
  const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";
  if (!currentPassword || !newPassword) {
    return Response.json({ error: "credentials_required" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  await changeAccountPassword(inspection.account.id, currentPassword, newPassword);
  await writeSecurityAudit(inspection.account.id, "password_change", "allowed", "账号密码已修改");
  return Response.json({ ok: true, mustChangePassword: false }, { headers: NO_STORE_HEADERS });
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

async function unlockSession(request: Request, factor: AppSessionRequest) {
  const inspection = await inspectAppSession(request);
  if (inspection.state === "unauthenticated") {
    return Response.json({ error: "authentication_required" }, { status: 401, headers: NO_STORE_HEADERS });
  }
  const passwordSession = inspection.session?.authMethod === "password";
  if (inspection.state !== "locked" || !inspection.account || (!inspection.ssoUser && !passwordSession)) {
    return Response.json({ error: "app_session_not_locked" }, { status: 409, headers: NO_STORE_HEADERS });
  }
  if (passwordSession) {
    // 密码会话解锁需要重新出示账号密码，防止无人值守设备被直接恢复。
    const password = typeof factor.password === "string" ? factor.password : "";
    if (!password) return Response.json({ error: "password_required" }, { status: 401, headers: NO_STORE_HEADERS });
    const credential = await getAccountCredentialSummary(inspection.account.id);
    if (!credential) return Response.json({ error: "credential_not_found" }, { status: 409, headers: NO_STORE_HEADERS });
    await verifyPasswordLogin(credential.username, password);
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

  const issued = await issueAppSession(
    inspection.account,
    inspection.ssoUser?.email ?? inspection.account.email,
    request,
    passwordSession ? "password" : "sso",
  );
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
    authMethod: session?.authMethod ?? (inspection.ssoUser ? "sso" : null),
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

// 审计里只保留用户名前 2 位，其余以 *** 脱敏，避免把完整登录账号写进日志。
function maskUsername(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return "***";
  return `${trimmed.slice(0, 2)}***`;
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
