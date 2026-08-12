"use client";

import { useState } from "react";
import { Building2, Check, ChevronRight, Clipboard, Fingerprint, KeyRound, LoaderCircle, LockKeyhole, LogOut, Mail, MonitorSmartphone, ShieldCheck, ShieldOff, UserRound } from "lucide-react";
import { TenantContext } from "./AccessControlCenter";
import { Hospital, ViewerIdentity } from "./access-control-data";

export type AccountTab = "profile" | "security";

export type AccountSessionSummary = {
  createdAt?: string;
  lastSeenAt?: string;
  idleExpiresAt?: string;
  absoluteExpiresAt?: string;
};

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

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(viewer.email);
      notify("登录邮箱已复制");
    } catch {
      notify(`登录邮箱：${viewer.email}`);
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
        <div><div className="eyebrow"><UserRound size={15} />身份、权限与登录安全</div><h1>个人中心</h1><p>查看登录身份、医院成员关系和当前权限。</p></div>
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
        </div>
      ) : null}
    </>
  );
}
