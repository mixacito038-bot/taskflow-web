"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Building2,
  ChartNoAxesCombined,
  CheckCircle2,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import type { ViewerIdentity } from "./access-control-data";
import { COMPANY_NAME, PRODUCT_FULL_NAME, PRODUCT_NAME } from "./brand";

export type LoginMode = "signin" | "session-required" | "locked";

export type PasswordLoginResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export type LoginScreenProps = {
  viewer?: ViewerIdentity;
  mode?: LoginMode;
  unlockWithPassword?: boolean;
  busy?: boolean;
  error?: string;
  onEnterDemo?: () => void;
  onContinue?: (credential: string) => void | Promise<void>;
  onPasswordLogin?: (username: string, password: string) => Promise<PasswordLoginResult>;
  onSwitchAccount?: () => void | Promise<void>;
};

export default function LoginScreen({
  viewer,
  mode,
  unlockWithPassword = false,
  busy = false,
  error,
  onEnterDemo,
  onContinue,
  onPasswordLogin,
  onSwitchAccount,
}: LoginScreenProps) {
  const requestedMode = mode ?? (viewer?.authenticated ? "session-required" : "signin");
  const resolvedMode: LoginMode = viewer?.authenticated ? requestedMode : "signin";
  const isApplicationSessionFlow = resolvedMode !== "signin";
  const [credential, setCredential] = useState("");
  const [localError, setLocalError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const credentialId = useId();
  const usernameId = useId();
  const passwordId = useId();
  const effectiveBusy = busy || submitting;
  const visibleError = error || localError;
  const avatarLabel = (viewer?.displayName || viewer?.email || "账").trim().slice(0, 1).toUpperCase() || "账";

  async function handlePasswordLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onPasswordLogin || effectiveBusy) return;
    if (!username.trim() || !password) {
      setLocalError("请输入登录账号和密码。");
      return;
    }
    setLocalError("");
    setSubmitting(true);
    try {
      const result = await onPasswordLogin(username.trim(), password);
      if (!result.ok) setLocalError(result.message);
    } catch {
      setLocalError("登录请求失败，请检查网络后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onContinue || effectiveBusy) return;

    if (unlockWithPassword && !credential) {
      setLocalError("请输入账号密码。");
      return;
    }

    setLocalError("");
    setSubmitting(true);
    try {
      // SSO 会话直接进入，无需凭据；密码会话解锁只需重新出示账号密码。
      await onContinue(unlockWithPassword ? credential : "");
    } catch {
      setLocalError("应用会话建立失败，请核对验证信息后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <BrandIdentity className="login-brand" />
        <div className="login-hero-copy">
          <span className="login-kicker"><ChartNoAxesCombined size={16} />{PRODUCT_FULL_NAME}</span>
          <h1>让每一台医疗设备的价值<br />都可衡量、可追踪、可改进</h1>
          <p>统一连接设备台账、收入成本、临床服务、患者体验与设备保障，按医院和岗位权限呈现可信的经营视图。</p>
        </div>
        <div className="login-capabilities">
          <div><Building2 size={18} /><span><strong>医院级隔离</strong><small>账号只进入已授权医院</small></span></div>
          <div><ShieldCheck size={18} /><span><strong>岗位级授权</strong><small>按角色与科室限定数据范围</small></span></div>
          <div><CheckCircle2 size={18} /><span><strong>关键操作留痕</strong><small>填报、导出和权限变更可追溯</small></span></div>
        </div>
      </section>

      <section className="login-form-panel">
        <BrandIdentity className="login-mobile-brand" />

        {isApplicationSessionFlow && viewer ? (
          <form className="login-card login-session-card" onSubmit={handleContinue}>
            <span className={`login-lock ${resolvedMode === "locked" ? "is-locked" : "is-verified"}`}>
              {resolvedMode === "locked" ? <LockKeyhole size={22} /> : <ShieldCheck size={22} />}
            </span>
            <div className="login-heading">
              <small>{resolvedMode === "locked" ? "应用会话已锁定" : "登录身份已核验"}</small>
              <h2>{resolvedMode === "locked" ? "重新确认后继续" : `进入${PRODUCT_FULL_NAME}`}</h2>
              <p>
                {resolvedMode === "locked"
                  ? "为保护医院业务数据，需要重新确认当前身份后恢复应用会话。"
                  : "登录身份与应用会话相互独立，请确认账号后进入医院业务空间。"}
              </p>
            </div>

            <div className="login-identity-card">
              <span className="login-identity-avatar">{avatarLabel}</span>
              <div><small>当前登录账号</small><strong>{viewer.displayName}</strong><span>{viewer.email}</span></div>
              <i><CheckCircle2 size={15} />已核验</i>
            </div>

            <div className="login-session-steps" aria-label="两层身份与应用会话状态">
              <div className="complete"><b>1</b><span><strong>登录身份</strong><small>当前账号已核验</small></span></div>
              <ArrowRight className="login-session-step-arrow" size={16} />
              <div className="current"><b>2</b><span><strong>应用会话</strong><small>{resolvedMode === "locked" ? "等待解锁" : "等待进入"}</small></span></div>
            </div>

            {unlockWithPassword ? (
              <label className="login-credential-field" htmlFor={credentialId}>
                <span><KeyRound size={16} />账号密码</span>
                <input
                  id={credentialId}
                  type="password"
                  value={credential}
                  onChange={(event) => {
                    setCredential(event.target.value);
                    if (localError) setLocalError("");
                  }}
                  autoComplete="current-password"
                  maxLength={128}
                  disabled={effectiveBusy}
                  placeholder="重新输入账号密码"
                  aria-invalid={Boolean(visibleError)}
                  aria-describedby={`${credentialId}-help${visibleError ? ` ${credentialId}-error` : ""}`}
                />
                <small id={`${credentialId}-help`}>为保护医院业务数据，恢复被锁定的会话需要重新输入账号密码。</small>
              </label>
            ) : (
              <div className="login-session-note"><ShieldCheck size={17} /><span><strong>安全边界已就绪</strong><small>进入后仍会在服务端核验医院成员关系、院内角色和数据范围。</small></span></div>
            )}

            {visibleError ? <div className="login-error" id={`${credentialId}-error`} role="alert"><CircleAlert size={16} /><span>{visibleError}</span></div> : null}

            <button className="primary-button login-primary login-continue" type="submit" disabled={!onContinue || effectiveBusy}>
              <span>{effectiveBusy ? "正在建立应用会话" : "进入平台"}</span>
              {effectiveBusy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
            </button>
            {onSwitchAccount ? (
              <button className="secondary-button login-switch-account" type="button" disabled={effectiveBusy} onClick={() => void onSwitchAccount()}>
                <LogOut size={16} />切换登录账号
              </button>
            ) : null}
            <p className="login-boundary-copy">切换账号会先退出当前登录身份；不会删除医院成员关系或云端业务数据。</p>
          </form>
        ) : (
          <div className="login-card">
            <span className="login-lock"><LockKeyhole size={22} /></span>
            <div className="login-heading"><small>欢迎使用</small><h2>登录{PRODUCT_FULL_NAME}</h2><p>使用平台分配的医院工作账号和密码登录。</p></div>
            {onPasswordLogin ? (
              <form className="login-password-form" onSubmit={handlePasswordLogin}>
                <label className="login-credential-field" htmlFor={usernameId}>
                  <span><Building2 size={16} />登录账号</span>
                  <input
                    id={usernameId}
                    value={username}
                    onChange={(event) => { setUsername(event.target.value); if (localError) setLocalError(""); }}
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={64}
                    disabled={effectiveBusy}
                    placeholder="由平台管理员分配"
                  />
                </label>
                <label className="login-credential-field" htmlFor={passwordId}>
                  <span><KeyRound size={16} />密码</span>
                  <input
                    id={passwordId}
                    type="password"
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); if (localError) setLocalError(""); }}
                    autoComplete="current-password"
                    maxLength={128}
                    disabled={effectiveBusy}
                    placeholder="账号密码"
                  />
                </label>
                {visibleError ? <div className="login-error" role="alert"><CircleAlert size={16} /><span>{visibleError}</span></div> : null}
                <button className="primary-button login-primary" type="submit" disabled={effectiveBusy}>
                  <span>{effectiveBusy ? "正在登录" : "登录"}</span>
                  {effectiveBusy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
                </button>
              </form>
            ) : (
              <div className="login-session-note"><ShieldCheck size={17} /><span><strong>请使用医院工作账号登录</strong><small>登录账号由平台管理员在“医院与权限”中统一分配。</small></span></div>
            )}
            {onEnterDemo ? (
              <>
                <div className="login-divider"><span>没有账号？</span></div>
                <div className="login-secondary-actions">
                  <button className="secondary-button login-demo" onClick={onEnterDemo}>进入演示环境</button>
                </div>
              </>
            ) : null}
            {!onPasswordLogin && visibleError ? <div className="login-error" role="alert"><CircleAlert size={16} /><span>{visibleError}</span></div> : null}
            <div className="login-help"><ShieldCheck size={15} /><p><strong>登录不等于获得业务权限</strong><span>登录后系统还会核验医院成员关系、院内角色、科室范围和操作权限。</span></p></div>
          </div>
        )}
        <footer>© 2026 勇虹医疗 · 数据仅用于授权的医院经营管理</footer>
      </section>
    </main>
  );
}

function BrandIdentity({ className }: { className: string }) {
  return (
    <div className={className}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/yonghong-logo.png" alt="勇虹医疗 YHONG" />
      <div><strong>{COMPANY_NAME}</strong><span>{PRODUCT_NAME}</span></div>
    </div>
  );
}
