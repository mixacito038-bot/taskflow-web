"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { BellRing, Building2, Check, ChevronRight, Clipboard, Copy, Fingerprint, KeyRound, LoaderCircle, LockKeyhole, LogOut, Mail, MonitorSmartphone, QrCode, ShieldCheck, ShieldOff, Smartphone, UserRound, X } from "lucide-react";
import { TenantContext } from "./AccessControlCenter";
import { Hospital, ViewerIdentity } from "./access-control-data";

export type AccountTab = "profile" | "security" | "preferences";

export type NotificationPreferences = {
  benefitAlerts: boolean;
  costTasks: boolean;
  dataQuality: boolean;
  securityAlerts: boolean;
  weeklyDigest: boolean;
};

export const defaultNotificationPreferences: NotificationPreferences = {
  benefitAlerts: true,
  costTasks: true,
  dataQuality: true,
  securityAlerts: true,
  weeklyDigest: false,
};

export type AccountSessionSummary = {
  createdAt?: string;
  lastSeenAt?: string;
  idleExpiresAt?: string;
  absoluteExpiresAt?: string;
  mfa?: MfaStatus;
};

type MfaStatus = {
  status: "disabled" | "pending" | "enabled";
  enabled: boolean;
  confirmedAt: string | null;
  lockedUntil: string | null;
  recoveryCodesRemaining: number;
  pendingExpiresAt?: string | null;
};

type MfaEnrollment = {
  secret: string;
  otpauthUri: string;
  pendingExpiresAt?: string | null;
};

function securityErrorMessage(code?: string) {
  return {
    mfa_already_enabled: "当前账号已经启用验证器。",
    mfa_enrollment_not_pending: "本次绑定已失效，请重新生成二维码。",
    mfa_enrollment_expired: "二维码已过期，请重新开始绑定。",
    mfa_invalid: "验证码或恢复码不正确，请重试。",
    mfa_code_replayed: "该动态验证码已经使用，请等待下一组验证码。",
    mfa_temporarily_locked: "验证失败次数过多，账号的二次验证已临时锁定。",
    mfa_factor_required: "请输入动态验证码或恢复码。",
    mfa_encryption_key_unavailable: "多因素验证服务尚未完成安全密钥配置。",
    app_session_required: "应用会话已失效，请重新进入设备效益管理平台。",
    app_session_locked: "应用会话已锁定，请先解锁设备效益管理平台。",
  }[code ?? ""] ?? "安全设置暂时无法完成，请稍后重试。";
}

function formatSecurityTime(value?: string | null) {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

export default function AccountCenter({
  viewer,
  hospitals,
  activeHospital,
  tenantContext,
  sessionState,
  currentRoleName,
  preferences,
  onPreferencesChange,
  tab,
  onTabChange,
  onSwitchHospital,
  onOpenAccess,
  onExitDemo,
  applicationSession,
  onLockApplication,
  onRevokeAllApplicationSessions,
  onSignOutIdentity,
  notify,
}: {
  viewer: ViewerIdentity;
  hospitals: Hospital[];
  activeHospital: Hospital;
  tenantContext: TenantContext | null;
  sessionState: "loading" | "verified" | "demo" | "denied" | "error";
  currentRoleName: string;
  preferences: NotificationPreferences;
  onPreferencesChange: (preferences: NotificationPreferences) => void;
  tab: AccountTab;
  onTabChange: (tab: AccountTab) => void;
  onSwitchHospital: (hospitalId: string) => void;
  onOpenAccess: () => void;
  onExitDemo: () => void;
  applicationSession: AccountSessionSummary | null;
  onLockApplication: () => void;
  onRevokeAllApplicationSessions: () => void;
  onSignOutIdentity: () => void;
  notify: (message: string) => void;
}) {
  const [mfaStatus, setMfaStatus] = useState<MfaStatus>(applicationSession?.mfa ?? {
    status: "disabled",
    enabled: false,
    confirmedAt: null,
    lockedUntil: null,
    recoveryCodesRemaining: 0,
  });
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityError, setSecurityError] = useState("");
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [enrollmentCode, setEnrollmentCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCredential, setDisableCredential] = useState("");
  const [passwordCurrent, setPasswordCurrent] = useState("");
  const [passwordNew, setPasswordNew] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function submitPasswordChange() {
    if (passwordBusy) return;
    if (!passwordCurrent || !passwordNew) {
      setPasswordFeedback({ tone: "error", text: "请输入当前密码和新密码。" });
      return;
    }
    if (passwordNew !== passwordConfirm) {
      setPasswordFeedback({ tone: "error", text: "两次输入的新密码不一致。" });
      return;
    }
    setPasswordBusy(true);
    setPasswordFeedback(null);
    try {
      const response = await fetch("/api/app-session", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ action: "change_password", currentPassword: passwordCurrent, newPassword: passwordNew }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        const text = {
          credential_not_found: "当前账号未启用密码登录，请联系管理员在“医院与权限”中分配登录账号。",
          invalid_credentials: "当前密码不正确，请重新输入。",
          weak_password: "新密码至少 8 位，且需同时包含字母和数字。",
          password_unchanged: "新密码不能与当前密码相同。",
          app_session_required: "会话已过期，请重新登录后再修改密码。",
        }[result.error ?? ""] ?? "密码修改失败，请稍后重试。";
        setPasswordFeedback({ tone: "error", text });
        return;
      }
      setPasswordCurrent("");
      setPasswordNew("");
      setPasswordConfirm("");
      setPasswordFeedback({ tone: "ok", text: "密码已修改，下次登录请使用新密码。" });
      notify("登录密码已更新");
    } catch {
      setPasswordFeedback({ tone: "error", text: "网络异常，密码修改未完成。" });
    } finally {
      setPasswordBusy(false);
    }
  }

  useEffect(() => {
    if (tab !== "security" || !viewer.authenticated || sessionState !== "verified") return;
    let cancelled = false;
    fetch("/api/account-security", { headers: { accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        const result = await response.json() as { mfa?: MfaStatus; error?: string };
        if (!response.ok || !result.mfa) throw new Error(result.error ?? "security_status_failed");
        return result.mfa;
      })
      .then((status) => {
        if (!cancelled) {
          setMfaStatus(status);
          setSecurityError("");
        }
      })
      .catch((error) => {
        if (!cancelled) setSecurityError(securityErrorMessage(error instanceof Error ? error.message : ""));
      })
      .finally(() => {
        if (!cancelled) setSecurityLoading(false);
      });
    return () => { cancelled = true; };
  }, [sessionState, tab, viewer.authenticated]);
  function togglePreference(key: keyof NotificationPreferences) {
    onPreferencesChange({ ...preferences, [key]: !preferences[key] });
    notify(sessionState === "verified" ? "消息偏好已保存到云端账号" : "演示消息偏好已更新");
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(viewer.email);
      notify("登录邮箱已复制");
    } catch {
      notify(`登录邮箱：${viewer.email}`);
    }
  }

  async function postSecurity<T>(payload: Record<string, unknown>) {
    const response = await fetch("/api/account-security", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as T & { error?: string; lockedUntil?: string };
    if (!response.ok) throw new Error(result.error ?? "security_action_failed");
    return result;
  }

  async function beginAuthenticatorEnrollment() {
    if (securityBusy) return;
    setSecurityBusy(true);
    setSecurityError("");
    setEnrollmentCode("");
    setRecoveryCodes([]);
    try {
      const result = await postSecurity<{
        mfa: MfaEnrollment & { status: "pending"; enabled: false };
      }>({ action: "begin" });
      const nextEnrollment = {
        secret: result.mfa.secret,
        otpauthUri: result.mfa.otpauthUri,
        pendingExpiresAt: result.mfa.pendingExpiresAt,
      };
      const dataUrl = await QRCode.toDataURL(nextEnrollment.otpauthUri, {
        width: 256,
        margin: 1,
        errorCorrectionLevel: "M",
        color: { dark: "#0a5961", light: "#ffffff" },
      });
      setEnrollment(nextEnrollment);
      setQrDataUrl(dataUrl);
      setMfaStatus((current) => ({
        ...current,
        status: "pending",
        enabled: false,
        pendingExpiresAt: nextEnrollment.pendingExpiresAt,
      }));
    } catch (error) {
      setSecurityError(securityErrorMessage(error instanceof Error ? error.message : ""));
    } finally {
      setSecurityBusy(false);
    }
  }

  async function confirmAuthenticatorEnrollment() {
    if (securityBusy) return;
    const code = enrollmentCode.trim().replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) {
      setSecurityError("请输入验证器中的 6 位动态验证码。");
      return;
    }
    setSecurityBusy(true);
    setSecurityError("");
    try {
      const result = await postSecurity<{ mfa: MfaStatus; recoveryCodes: string[] }>({
        action: "confirm",
        totpCode: code,
      });
      setMfaStatus(result.mfa);
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      setQrDataUrl("");
      setEnrollmentCode("");
      notify("身份验证器已启用，请立即保存恢复码");
    } catch (error) {
      setSecurityError(securityErrorMessage(error instanceof Error ? error.message : ""));
    } finally {
      setSecurityBusy(false);
    }
  }

  async function cancelAuthenticatorEnrollment() {
    if (securityBusy) return;
    setSecurityBusy(true);
    setSecurityError("");
    try {
      const result = await postSecurity<{ mfa: MfaStatus }>({ action: "cancel" });
      setMfaStatus(result.mfa);
      setEnrollment(null);
      setQrDataUrl("");
      setEnrollmentCode("");
      notify("本次验证器绑定已取消，临时密钥已清除");
    } catch (error) {
      setSecurityError(securityErrorMessage(error instanceof Error ? error.message : ""));
    } finally {
      setSecurityBusy(false);
    }
  }

  async function disableAuthenticator() {
    if (securityBusy) return;
    const credential = disableCredential.trim().replace(/\s+/g, "");
    if (!credential) {
      setSecurityError("关闭前请输入动态验证码或恢复码。");
      return;
    }
    setSecurityBusy(true);
    setSecurityError("");
    try {
      const result = await postSecurity<{ mfa: MfaStatus }>({
        action: "disable",
        ...(/^\d{6}$/.test(credential) ? { totpCode: credential } : { recoveryCode: credential }),
      });
      setMfaStatus(result.mfa);
      setDisableOpen(false);
      setDisableCredential("");
      notify("当前账号的身份验证器已关闭");
    } catch (error) {
      setSecurityError(securityErrorMessage(error instanceof Error ? error.message : ""));
    } finally {
      setSecurityBusy(false);
    }
  }

  async function copyRecoveryCodes() {
    const content = recoveryCodes.join("\n");
    try {
      await navigator.clipboard.writeText(content);
      notify("恢复码已复制，请保存到安全位置");
    } catch {
      notify("浏览器未允许复制，请手工保存恢复码");
    }
  }

  async function copyAuthenticatorKey() {
    if (!enrollment?.secret) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      notify("手动设置密钥已复制");
    } catch {
      notify("浏览器未允许复制，请手工记录密钥");
    }
  }

  const membershipFor = (hospitalId: string) => tenantContext?.memberships.find((membership) => membership.hospitalId === hospitalId);
  const activeMembership = membershipFor(activeHospital.id);
  const authorizedStateLabel = sessionState === "verified"
    ? "当前访问已授权"
    : sessionState === "loading"
      ? "正在核验"
      : sessionState === "demo"
        ? "体验身份"
        : "医院成员关系不可用";

  return (
    <>
      <div className="page-heading account-heading">
        <div><div className="eyebrow"><UserRound size={15} />身份、权限与个人偏好</div><h1>个人中心</h1><p>查看登录身份、医院成员关系、当前权限和消息接收方式。</p></div>
        <span className={`identity-state identity-${sessionState}`}><Fingerprint size={15} />{sessionState === "verified" ? "服务端身份已核验" : sessionState === "loading" ? "正在核验身份" : sessionState === "demo" ? "体验身份" : "医院授权不可用"}</span>
      </div>

      <section className="account-hero">
        <span className="account-avatar">{viewer.displayName.slice(0, 1)}</span>
        <div><small>当前登录账号</small><h2>{viewer.displayName}</h2><p><Mail size={14} />{viewer.email}</p></div>
        <dl><div><dt>当前医院</dt><dd>{activeHospital.shortName}</dd></div><div><dt>医院内角色</dt><dd>{currentRoleName}</dd></div><div><dt>授权医院</dt><dd>{hospitals.length} 家</dd></div></dl>
      </section>

      <div className="account-tabs">
        <button className={tab === "profile" ? "active" : ""} onClick={() => onTabChange("profile")}><UserRound size={16} />账号概览</button>
        <button className={tab === "security" ? "active" : ""} onClick={() => onTabChange("security")}><LockKeyhole size={16} />登录与安全</button>
        <button className={tab === "preferences" ? "active" : ""} onClick={() => onTabChange("preferences")}><BellRing size={16} />消息偏好</button>
      </div>

      {tab === "profile" ? (
        <div className="account-grid">
          <section className="panel account-panel">
            <div className="panel-heading"><div><h3>账号信息</h3><p>姓名和邮箱来自受信任登录身份，不在业务前端自行修改。</p></div></div>
            <div className="account-fields"><div><span>显示姓名</span><strong>{viewer.displayName}</strong></div><div><span>登录邮箱</span><strong>{viewer.email}</strong><button onClick={copyEmail} aria-label="复制登录邮箱"><Clipboard size={14} /></button></div><div><span>访问状态</span><strong className={sessionState === "verified" ? "success-text" : ""}>{sessionState === "verified" ? <Check size={14} /> : null}{authorizedStateLabel}</strong></div><div><span>身份来源</span><strong>{viewer.authenticated ? "平台工作账号" : "体验身份"}</strong></div></div>
          </section>
          <section className="panel account-panel account-hospitals">
            <div className="panel-heading"><div><h3>我的医院</h3><p>同一账号在不同医院可以拥有不同角色和数据范围。</p></div><button className="text-button" onClick={onOpenAccess}>查看权限详情</button></div>
            <div className="account-hospital-list">{hospitals.map((hospital) => {
              const membership = membershipFor(hospital.id);
              return <button key={hospital.id} className={hospital.id === activeHospital.id ? "active" : ""} onClick={() => onSwitchHospital(hospital.id)}><span><Building2 size={17} /></span><div><strong>{hospital.name}</strong><small>{membership?.roleName ?? (sessionState === "demo" ? "演示管理员" : "已授权成员")} · {membership?.dataScope === "department" ? membership.departmentScope.join("、") : "医院范围"}</small></div><i>{hospital.id === activeHospital.id ? "当前" : "进入"}</i></button>;
            })}</div>
          </section>
        </div>
      ) : null}

      {tab === "security" ? (
        <div className="security-dashboard">
          <div className="account-grid security-grid">
            <section className="panel account-panel">
              <div className="panel-heading"><div><h3>当前授权边界</h3><p>身份、应用会话和医院权限三项都通过后，才会加载业务数据。</p></div><span className={`status-pill ${sessionState === "verified" ? "success" : "attention"}`}>{authorizedStateLabel}</span></div>
              <div className="security-check-list">
                <div><span><Fingerprint size={18} /></span><div><strong>登录身份</strong><small>{viewer.authenticated ? `已核验 ${viewer.email}` : "当前为体验身份"}</small></div>{viewer.authenticated ? <Check size={17} /> : <ShieldOff size={17} />}</div>
                <div><span><MonitorSmartphone size={18} /></span><div><strong>设备效益管理平台会话</strong><small>{applicationSession?.createdAt ? `创建于 ${formatSecurityTime(applicationSession.createdAt)}` : sessionState === "demo" ? "体验会话" : "正在核验"}</small></div>{sessionState === "verified" ? <Check size={17} /> : <ShieldOff size={17} />}</div>
                <div><span><Building2 size={18} /></span><div><strong>医院成员关系</strong><small>{activeHospital.name} · {currentRoleName}</small></div>{activeMembership || sessionState === "demo" ? <Check size={17} /> : <ShieldOff size={17} />}</div>
                <div><span><KeyRound size={18} /></span><div><strong>数据与操作范围</strong><small>{activeMembership?.dataScope === "department" ? `指定科室：${activeMembership.departmentScope.join("、") || "未配置"}` : activeMembership?.dataScope === "self" ? "本人负责设备" : activeMembership?.dataScope === "platform" ? "平台授权范围" : "本医院范围"} · {activeMembership?.permissions.length ?? 0} 项权限</small></div>{activeMembership || sessionState === "demo" ? <Check size={17} /> : <ShieldOff size={17} />}</div>
              </div>
              <button className="secondary-button security-access-button" onClick={onOpenAccess}><ShieldCheck size={16} />查看医院与权限<ChevronRight size={15} /></button>
            </section>

            <section className="panel account-panel">
              <div className="panel-heading"><div><h3>当前应用会话</h3><p>这里只展示服务器真实记录，不根据浏览器猜测城市、系统或历史设备。</p></div><span className="status-pill success">当前浏览器</span></div>
              <div className="session-facts">
                <div><span>会话创建</span><strong>{formatSecurityTime(applicationSession?.createdAt)}</strong></div>
                <div><span>最近服务端活动</span><strong>{formatSecurityTime(applicationSession?.lastSeenAt)}</strong></div>
                <div><span>空闲到期</span><strong>{formatSecurityTime(applicationSession?.idleExpiresAt)}</strong></div>
                <div><span>最长有效期</span><strong>{formatSecurityTime(applicationSession?.absoluteExpiresAt)}</strong></div>
              </div>
              {viewer.authenticated ? (
                <div className="session-actions">
                  <button className="secondary-button" onClick={onLockApplication}><LockKeyhole size={16} />锁定此设备</button>
                  <button className="secondary-button" onClick={onRevokeAllApplicationSessions}><LogOut size={16} />退出全部应用会话</button>
                  <button className="danger-button" onClick={onSignOutIdentity}><ShieldOff size={16} />退出登录</button>
                </div>
              ) : <button className="danger-button signout-button" onClick={onExitDemo}><LogOut size={16} />退出演示环境</button>}
              <p className="session-action-note">“锁定此设备”保留登录身份，仅暂停本浏览器访问；“退出登录”才会离开当前身份并返回登录页。</p>
            </section>
          </div>

          {viewer.authenticated ? (
            <section className="panel mfa-security-panel password-change-panel">
              <div className="panel-heading">
                <div><h3>登录密码</h3><p>修改账号密码登录的密码；密码仅以加盐哈希存储。未分配登录账号的成员请联系医院管理员。</p></div>
                <span className="status-pill">账号密码登录</span>
              </div>
              <form className="password-change-fields" onSubmit={(event) => { event.preventDefault(); void submitPasswordChange(); }}>
                <label>当前密码<input type="password" autoComplete="current-password" maxLength={128} value={passwordCurrent} disabled={passwordBusy} onChange={(event) => { setPasswordCurrent(event.target.value); if (passwordFeedback) setPasswordFeedback(null); }} /></label>
                <label>新密码<input type="password" autoComplete="new-password" maxLength={128} value={passwordNew} disabled={passwordBusy} onChange={(event) => { setPasswordNew(event.target.value); if (passwordFeedback) setPasswordFeedback(null); }} placeholder="至少 8 位，含字母和数字" /></label>
                <label>确认新密码<input type="password" autoComplete="new-password" maxLength={128} value={passwordConfirm} disabled={passwordBusy} onChange={(event) => { setPasswordConfirm(event.target.value); if (passwordFeedback) setPasswordFeedback(null); }} /></label>
                <button className="primary-button" type="submit" disabled={passwordBusy}>{passwordBusy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />}修改密码</button>
              </form>
              {passwordFeedback ? <div className={passwordFeedback.tone === "ok" ? "password-change-ok" : "account-security-error"} role={passwordFeedback.tone === "ok" ? "status" : "alert"}>{passwordFeedback.text}</div> : null}
            </section>
          ) : null}

          <section className="panel mfa-security-panel">
            <div className="panel-heading">
              <div><h3>二维码二次验证</h3><p>使用 Microsoft Authenticator、Google Authenticator 等验证器扫描动态二维码；二维码在本机生成，验证码由服务端校验。</p></div>
              <span className={`status-pill ${mfaStatus.enabled ? "success" : mfaStatus.status === "pending" ? "attention" : ""}`}>{securityLoading ? "正在读取" : mfaStatus.enabled ? "已启用" : mfaStatus.status === "pending" ? "待确认" : "未启用"}</span>
            </div>
            <div className="mfa-security-body">
              <span className={`mfa-security-icon ${mfaStatus.enabled ? "enabled" : ""}`}>{securityLoading ? <LoaderCircle className="spin" size={24} /> : <QrCode size={24} />}</span>
              <div>
                <strong>{mfaStatus.enabled ? "登录本平台时需要动态验证码" : "建议为医院管理账号绑定身份验证器"}</strong>
                <p>{mfaStatus.enabled ? `启用时间：${formatSecurityTime(mfaStatus.confirmedAt)}；剩余 ${mfaStatus.recoveryCodesRemaining} 枚一次性恢复码。` : "启用后，新建或解锁应用会话时，除账号密码外还需要验证器动态码；二维码不是微信扫码登录。"}</p>
                {mfaStatus.lockedUntil ? <small className="mfa-lock-warning">验证失败次数过多，暂时锁定至 {formatSecurityTime(mfaStatus.lockedUntil)}</small> : null}
              </div>
              <div className="mfa-security-actions">
                {mfaStatus.enabled
                  ? <button className="secondary-button" onClick={() => { setSecurityError(""); setDisableCredential(""); setDisableOpen(true); }}><ShieldOff size={16} />关闭验证器</button>
                  : <button className="primary-button" disabled={securityBusy || securityLoading} onClick={() => void beginAuthenticatorEnrollment()}>{securityBusy ? <LoaderCircle className="spin" size={16} /> : <Smartphone size={16} />}绑定身份验证器</button>}
              </div>
            </div>
            {securityError ? <div className="account-security-error" role="alert">{securityError}</div> : null}
          </section>
        </div>
      ) : null}

      {tab === "preferences" ? (
        <section className="panel account-panel preferences-panel">
          <div className="panel-heading"><div><h3>消息接收偏好</h3><p>紧急安全消息始终进入消息中心；正式登录后的设置会跟随账号跨设备同步。</p></div></div>
          <div className="preference-list">
            {[
              ["benefitAlerts", "效益与使用率预警", "亏损、低使用率、回本延期和资源配置异常"],
              ["costTasks", "成本填报与复核待办", "人工、耗材、固定成本提交和退回"],
              ["dataQuality", "数据质量与文件异常", "导入失败、字段映射和口径版本变化"],
              ["securityAlerts", "账号与权限安全提醒", "成员激活、权限复核和拒绝访问"],
              ["weeklyDigest", "每周运营摘要", "汇总本周预警、改进任务和关键指标变化"],
            ].map(([key, title, note]) => <div key={key}><span><strong>{title}</strong><small>{note}</small></span><button role="switch" aria-checked={preferences[key as keyof NotificationPreferences]} className={`preference-switch ${preferences[key as keyof NotificationPreferences] ? "active" : ""}`} onClick={() => togglePreference(key as keyof NotificationPreferences)}><i /></button></div>)}
          </div>
        </section>
      ) : null}

      {enrollment || recoveryCodes.length ? (
        <div className="modal-backdrop mfa-modal" role="dialog" aria-modal="true" aria-labelledby="mfa-dialog-title">
          <section className="mfa-dialog">
            {recoveryCodes.length ? (
              <>
                <header>
                  <span className="mfa-dialog-icon success"><Check size={22} /></span>
                  <div><small>最后一步</small><h2 id="mfa-dialog-title">保存一次性恢复码</h2><p>验证器已启用。每枚恢复码只能使用一次，服务端只保存其校验摘要，关闭后无法再次查看。</p></div>
                </header>
                <div className="recovery-code-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>
                <div className="mfa-dialog-notice"><ShieldCheck size={17} /><span>请保存到密码管理器或离线安全位置，不要通过聊天或普通邮件发送。</span></div>
                <footer>
                  <button className="secondary-button" onClick={() => void copyRecoveryCodes()}><Copy size={16} />复制全部</button>
                  <button className="primary-button" onClick={() => { setRecoveryCodes([]); setSecurityError(""); }}>我已安全保存</button>
                </footer>
              </>
            ) : enrollment ? (
              <>
                <header>
                  <span className="mfa-dialog-icon"><QrCode size={22} /></span>
                  <div><small>账号二次验证</small><h2 id="mfa-dialog-title">绑定身份验证器</h2><p>用 Microsoft Authenticator、Google Authenticator 或兼容 TOTP 的验证器扫描二维码。</p></div>
                  <button className="icon-button" aria-label="取消绑定" disabled={securityBusy} onClick={() => void cancelAuthenticatorEnrollment()}><X size={18} /></button>
                </header>
                <div className="mfa-enrollment-layout">
                  <div className="mfa-qr-card">
                    {qrDataUrl ? (
                      // The QR image is generated locally from the one-time otpauth URI.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={qrDataUrl} alt="身份验证器绑定二维码" />
                    ) : <LoaderCircle className="spin" size={30} />}
                    <span>二维码约 10 分钟内有效</span>
                  </div>
                  <div className="mfa-enrollment-steps">
                    <ol>
                      <li><b>1</b><span><strong>打开手机验证器</strong><small>选择“添加账号”或“扫描二维码”。</small></span></li>
                      <li><b>2</b><span><strong>扫描左侧二维码</strong><small>无法扫码时，可手动输入下方设置密钥。</small></span></li>
                      <li><b>3</b><span><strong>输入当前 6 位验证码</strong><small>只有服务端校验通过后才会真正启用。</small></span></li>
                    </ol>
                    <div className="mfa-manual-key"><span>手动设置密钥</span><code>{enrollment.secret}</code><button className="icon-button" onClick={() => void copyAuthenticatorKey()} aria-label="复制手动设置密钥"><Copy size={15} /></button></div>
                    <label className="mfa-code-field">动态验证码<input value={enrollmentCode} onChange={(event) => { setEnrollmentCode(event.target.value.replace(/\D/g, "").slice(0, 6)); setSecurityError(""); }} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" /></label>
                    {securityError ? <div className="account-security-error" role="alert">{securityError}</div> : null}
                  </div>
                </div>
                <footer>
                  <button className="secondary-button" disabled={securityBusy} onClick={() => void cancelAuthenticatorEnrollment()}>取消绑定</button>
                  <button className="primary-button" disabled={securityBusy || enrollmentCode.length !== 6} onClick={() => void confirmAuthenticatorEnrollment()}>{securityBusy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}验证并启用</button>
                </footer>
              </>
            ) : null}
          </section>
        </div>
      ) : null}

      {disableOpen ? (
        <div className="modal-backdrop mfa-modal" role="dialog" aria-modal="true" aria-labelledby="disable-mfa-title">
          <section className="mfa-dialog mfa-disable-dialog">
            <header>
              <span className="mfa-dialog-icon danger"><ShieldOff size={22} /></span>
              <div><small>高风险账号操作</small><h2 id="disable-mfa-title">关闭二维码二次验证？</h2><p>关闭后，新建或解锁平台应用会话将只依赖账号密码。确认前需要输入当前动态验证码或恢复码。</p></div>
              <button className="icon-button" aria-label="取消关闭" disabled={securityBusy} onClick={() => { setDisableOpen(false); setDisableCredential(""); setSecurityError(""); }}><X size={18} /></button>
            </header>
            <label className="mfa-code-field">动态验证码或恢复码<input value={disableCredential} onChange={(event) => { setDisableCredential(event.target.value); setSecurityError(""); }} autoComplete="one-time-code" placeholder="6 位验证码或 YH-… 恢复码" /></label>
            {securityError ? <div className="account-security-error" role="alert">{securityError}</div> : null}
            <footer>
              <button className="secondary-button" disabled={securityBusy} onClick={() => { setDisableOpen(false); setDisableCredential(""); setSecurityError(""); }}>取消</button>
              <button className="danger-button" disabled={securityBusy || !disableCredential.trim()} onClick={() => void disableAuthenticator()}>{securityBusy ? <LoaderCircle className="spin" size={16} /> : <ShieldOff size={16} />}确认关闭</button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
