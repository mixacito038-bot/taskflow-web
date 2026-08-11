import {
  appSessionError,
  assertSameOrigin,
  beginMfaEnrollment,
  cancelMfaEnrollment,
  confirmMfaEnrollment,
  disableMfa,
  getMfaStatus,
  mfaVerificationError,
  MfaVerificationError,
  requireAppSession,
  verifyMfaFactor,
  writeSecurityAudit,
  type MfaFactor,
} from "../../../db/account-security";

type SecurityAction = "status" | "begin" | "cancel" | "confirm" | "disable";

type SecurityRequest = MfaFactor & {
  action?: SecurityAction;
};

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const session = await requireAppSession(request);
    return Response.json({
      mfa: await getMfaStatus(session.accountId),
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return withNoStore(appSessionError(error));
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
  } catch (error) {
    return withNoStore(appSessionError(error));
  }

  let payload: SecurityRequest;
  try {
    payload = await request.json() as SecurityRequest;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const session = await requireAppSession(request);
    if (payload.action === "status") {
      return Response.json({ mfa: await getMfaStatus(session.accountId) }, { headers: NO_STORE_HEADERS });
    }
    if (payload.action === "begin") {
      const enrollment = await beginMfaEnrollment(session.accountId, session.email);
      return Response.json({
        mfa: {
          status: "pending",
          enabled: false,
          secret: enrollment.secret,
          otpauthUri: enrollment.otpauthUri,
          pendingExpiresAt: enrollment.pendingExpiresAt,
        },
      }, { status: 201, headers: NO_STORE_HEADERS });
    }
    if (payload.action === "cancel") {
      await cancelMfaEnrollment(session.accountId);
      return Response.json({
        mfa: await getMfaStatus(session.accountId),
      }, { headers: NO_STORE_HEADERS });
    }
    if (payload.action === "confirm") {
      if (!payload.totpCode?.trim()) {
        return Response.json({ error: "totp_code_required" }, { status: 400, headers: NO_STORE_HEADERS });
      }
      const confirmed = await confirmMfaEnrollment(session.accountId, payload.totpCode.trim());
      return Response.json({
        mfa: await getMfaStatus(session.accountId),
        recoveryCodes: confirmed.recoveryCodes,
      }, { headers: NO_STORE_HEADERS });
    }
    if (payload.action === "disable") {
      const status = await getMfaStatus(session.accountId);
      if (status.status === "disabled") {
        return Response.json({ error: "mfa_not_enabled" }, { status: 409, headers: NO_STORE_HEADERS });
      }
      if (status.enabled) {
        try {
          await verifyMfaFactor(session.accountId, payload);
        } catch (error) {
          await writeSecurityAudit(session.accountId, "mfa_disable_request", "denied", "关闭多因素认证验证失败");
          throw error;
        }
      }
      await disableMfa(session.accountId);
      return Response.json({ mfa: await getMfaStatus(session.accountId) }, { headers: NO_STORE_HEADERS });
    }
    return Response.json({ error: "unsupported_action" }, { status: 400, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof MfaVerificationError) return withNoStore(mfaVerificationError(error));
    return withNoStore(appSessionError(error));
  }
}

function withNoStore(response: Response) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
