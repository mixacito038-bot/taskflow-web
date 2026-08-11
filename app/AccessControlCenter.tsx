"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  CircleAlert,
  Copy,
  Download,
  FileClock,
  Fingerprint,
  KeyRound,
  Pencil,
  Plus,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  ShieldOff,
  UserCog,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  accessAuditEvents,
  DataScope,
  Hospital,
  initialMemberships,
  initialRoles,
  Membership,
  permissionColumns,
  RoleDefinition,
  ViewerIdentity,
} from "./access-control-data";
import { menuCatalog, menuVisibleForPermissions, togglePermissionsForMenu } from "./menu-catalog";

type ConfigurableRole = RoleDefinition & { hospitalId?: string | null };
type AuditPolicy = {
  hospitalId: string;
  retentionDays: number;
  reviewCycleMonths: number;
  invitationExpiryDays: number;
  denialAlertThreshold: number;
  exportFormat: "csv" | "xlsx";
  updatedAt?: string;
};
type AuditEvent = { time: string; actor: string; hospital: string; action: string; target: string; result: string };

type TenantMembership = {
  membershipId: string;
  hospitalId: string;
  hospitalCode: string;
  hospitalName: string;
  hospitalShortName: string;
  hospitalLevel?: string;
  hospitalRegion?: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  dataScope: string;
  departmentScope: string[];
  permissions: string[];
};

export type TenantContext = {
  account: { id: string; email: string; displayName: string };
  memberships: TenantMembership[];
  accessCatalog?: {
    roles: ConfigurableRole[];
    members: Membership[];
    auditPolicies: Record<string, AuditPolicy>;
    auditEvents: AuditEvent[];
  };
};

type AccessControlCenterProps = {
  viewer: ViewerIdentity;
  hospitals: Hospital[];
  activeHospitalId: string;
  tenantContext: TenantContext | null;
  sessionState: "loading" | "verified" | "demo" | "denied";
  onSwitchHospital: (hospitalId: string) => void;
  onHospitalsChange: (hospitals: Hospital[]) => void;
  notify: (message: string) => void;
};

type AccessTab = "hospitals" | "members" | "roles" | "audit";

const defaultPolicy = (hospitalId: string): AuditPolicy => ({
  hospitalId,
  retentionDays: 365,
  reviewCycleMonths: 3,
  invitationExpiryDays: 7,
  denialAlertThreshold: 5,
  exportFormat: "csv",
});

const dataScopeOptions: DataScope[] = ["本医院全部", "指定科室", "本人负责设备"];
const serverScope: Record<DataScope, "platform" | "hospital" | "department" | "self"> = {
  平台全部医院: "platform",
  本医院全部: "hospital",
  指定科室: "department",
  本人负责设备: "self",
};

function useSessionConfig<T>(initialValue: T) {
  return useState<T>(initialValue);
}

function roleRisk(role: ConfigurableRole) {
  const highRisk = ["equipment.manage", "cost.manage", "report.export", "source.manage", "hospital.manage", "member.manage"];
  return role.permissions.some((permission) => highRisk.includes(permission));
}

function actionLabel(action: string) {
  return ({
    bootstrap_owner: "初始化平台管理员",
    invite_member: "保存医院成员",
    create_hospital: "新增医院",
    update_hospital: "更新医院配置",
    update_member_status: "变更成员状态",
    set_member_credential: "配置登录凭据",
    save_role: "保存角色权限",
    save_audit_policy: "更新审计策略",
    tenant_context: "核验医院权限",
  } as Record<string, string>)[action] ?? action;
}

export default function AccessControlCenter({
  viewer,
  hospitals,
  activeHospitalId,
  tenantContext,
  sessionState,
  onSwitchHospital,
  onHospitalsChange,
  notify,
}: AccessControlCenterProps) {
  const [tab, setTab] = useState<AccessTab>("hospitals");
  const [memberSearch, setMemberSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [hospitalDraft, setHospitalDraft] = useState<Hospital | null>(null);
  const [hospitalIsNew, setHospitalIsNew] = useState(false);
  const [memberDraft, setMemberDraft] = useState<Membership | null>(null);
  const [memberIsNew, setMemberIsNew] = useState(false);
  const [roleDraft, setRoleDraft] = useState<ConfigurableRole | null>(null);
  const [roleIsNew, setRoleIsNew] = useState(false);
  const [pendingMemberStatusChange, setPendingMemberStatusChange] = useState<Membership | null>(null);
  const [pendingHospitalStatusChange, setPendingHospitalStatusChange] = useState<Hospital | null>(null);
  const [credentialTarget, setCredentialTarget] = useState<Membership | null>(null);
  const [credentialUsername, setCredentialUsername] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");
  const [memberships, setMemberships] = useSessionConfig<Membership[]>(initialMemberships);
  const [roles, setRoles] = useSessionConfig<ConfigurableRole[]>(initialRoles.map((role) => ({ ...role, hospitalId: null })));
  const [policies, setPolicies] = useSessionConfig<Record<string, AuditPolicy>>(Object.fromEntries(hospitals.map((hospital) => [hospital.id, defaultPolicy(hospital.id)])));
  const [auditEvents, setAuditEvents] = useSessionConfig<AuditEvent[]>(accessAuditEvents);
  const [auditDraft, setAuditDraft] = useState<AuditPolicy>(policies[activeHospitalId] ?? defaultPolicy(activeHospitalId));

  useEffect(() => {
    if (sessionState !== "verified" || !tenantContext?.accessCatalog) return;
    const timer = window.setTimeout(() => {
      const catalog = tenantContext.accessCatalog;
      if (!catalog) return;
      setRoles(catalog.roles);
      setMemberships(catalog.members);
      if (Object.keys(catalog.auditPolicies).length) setPolicies((current) => ({ ...current, ...catalog.auditPolicies }));
      if (catalog.auditEvents.length) setAuditEvents(catalog.auditEvents);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [sessionState, setAuditEvents, setMemberships, setPolicies, setRoles, tenantContext]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAuditDraft(policies[activeHospitalId] ?? defaultPolicy(activeHospitalId)), 0);
    return () => window.clearTimeout(timer);
  }, [activeHospitalId, policies]);

  const activeHospital = hospitals.find((hospital) => hospital.id === activeHospitalId) ?? hospitals[0];
  const activeServerMembership = tenantContext?.memberships.find((membership) => membership.hospitalId === activeHospitalId);
  const platformAdmin = tenantContext?.memberships.some((membership) => membership.roleId === "role-platform-admin") ?? sessionState === "demo";
  const canManageMembers = platformAdmin || activeServerMembership?.permissions.includes("member.manage") || sessionState === "demo";
  const effectiveRole = activeServerMembership?.roleName ?? (viewer.authenticated ? "平台超级管理员" : "体验管理员");
  const currentHospitalRoles = roles.filter((role) => !role.hospitalId || role.hospitalId === activeHospitalId);
  const actorPermissionSet = new Set(platformAdmin ? permissionColumns.map((permission) => permission.code) : activeServerMembership?.permissions ?? []);
  const assignableRoles = currentHospitalRoles.filter((role) => platformAdmin || role.permissions.every((permission) => actorPermissionSet.has(permission)));
  const visibleMembers = useMemo(() => memberships.filter((membership) => {
    const role = roles.find((item) => item.id === membership.roleId);
    const text = `${membership.name}${membership.email}${role?.name ?? ""}`.toLowerCase();
    return membership.hospitalId === activeHospitalId && membership.email !== viewer.email && text.includes(memberSearch.toLowerCase());
  }), [activeHospitalId, memberSearch, memberships, roles, viewer.email]);
  const currentPolicy = policies[activeHospitalId] ?? defaultPolicy(activeHospitalId);
  const highRiskRoles = currentHospitalRoles.filter(roleRisk).length;
  const visibleAuditEvents = auditEvents.filter((event) => event.hospital === activeHospital?.shortName || event.hospital === "全平台");
  const recentDenials = visibleAuditEvents.filter((event) => event.result === "已拒绝").length;

  async function postConfiguration(payload: Record<string, unknown>) {
    if (sessionState !== "verified") return {} as Record<string, unknown>;
    const response = await fetch("/api/tenant-context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(response.status === 403 ? "当前账号没有此项配置权限" : "配置未能保存到服务端");
    return response.json() as Promise<Record<string, unknown>>;
  }

  function recordAudit(action: string, target: string) {
    setAuditEvents((current) => [{ time: new Date().toLocaleString("zh-CN", { hour12: false }), actor: viewer.displayName, hospital: activeHospital?.shortName ?? "当前医院", action, target, result: "成功" }, ...current].slice(0, 100));
  }

  function openNewHospital() {
    setHospitalIsNew(true);
    setHospitalDraft({ id: `hosp-${Date.now()}`, code: `HOSP-${String(hospitals.length + 1).padStart(3, "0")}`, name: "", shortName: "", level: "三级甲等", region: "主院区", status: "筹备中", tenantKey: "", dataCompleteness: 0, connectedSources: 0 });
  }

  function openHospitalEditor(hospital: Hospital) {
    setHospitalIsNew(false);
    setHospitalDraft({ ...hospital });
  }

  async function saveHospital(event: FormEvent) {
    event.preventDefault();
    if (!hospitalDraft?.name.trim() || !hospitalDraft.code.trim()) return notify("请填写医院名称和编码");
    if (hospitalIsNew && hospitals.some((hospital) => hospital.code === hospitalDraft.code)) return notify("医院编码已存在");
    setSaving(true);
    try {
      let id = hospitalDraft.id;
      if (hospitalIsNew) {
        const result = await postConfiguration({ action: "create_hospital", code: hospitalDraft.code, name: hospitalDraft.name, shortName: hospitalDraft.shortName, level: hospitalDraft.level, region: hospitalDraft.region });
        const serverHospital = result.hospital as { id?: string } | undefined;
        id = serverHospital?.id ?? id;
      } else {
        await postConfiguration({ action: "update_hospital", hospitalId: hospitalDraft.id, name: hospitalDraft.name, shortName: hospitalDraft.shortName, level: hospitalDraft.level, region: hospitalDraft.region, status: hospitalDraft.status === "已停用" ? "disabled" : "active" });
      }
      const nextHospital = { ...hospitalDraft, id, shortName: hospitalDraft.shortName.trim() || hospitalDraft.name, tenantKey: hospitalDraft.tenantKey || `tenant_${hospitalDraft.code.toLowerCase().replaceAll("-", "_")}`, status: hospitalIsNew && sessionState !== "verified" ? "筹备中" as const : hospitalIsNew ? "运行中" as const : hospitalDraft.status };
      onHospitalsChange(hospitalIsNew ? [...hospitals, nextHospital] : hospitals.map((hospital) => hospital.id === nextHospital.id ? nextHospital : hospital));
      recordAudit(hospitalIsNew ? "新增医院" : "更新医院配置", nextHospital.name);
      setHospitalDraft(null);
      notify(hospitalIsNew ? "医院已加入配置清单" : "医院配置已保存");
    } catch (error) {
      notify(error instanceof Error ? error.message : "医院配置保存失败");
    } finally { setSaving(false); }
  }

  async function toggleHospitalStatus(hospital: Hospital) {
    if (hospital.id === activeHospitalId && hospital.status !== "已停用") return notify("不能停用当前正在使用的医院，请先切换医院");
    const nextStatus = hospital.status === "已停用" ? "运行中" : "已停用";
    setSaving(true);
    try {
      await postConfiguration({ action: "update_hospital", hospitalId: hospital.id, name: hospital.name, shortName: hospital.shortName, level: hospital.level, region: hospital.region, status: nextStatus === "已停用" ? "disabled" : "active" });
      onHospitalsChange(hospitals.map((item) => item.id === hospital.id ? { ...item, status: nextStatus } : item));
      recordAudit(`${nextStatus === "已停用" ? "停用" : "启用"}医院`, hospital.name);
      notify(`${hospital.shortName}已${nextStatus === "已停用" ? "停用" : "启用"}`);
    } catch (error) { notify(error instanceof Error ? error.message : "医院状态保存失败"); }
    finally { setSaving(false); setPendingHospitalStatusChange(null); }
  }

  function openNewMember() {
    setMemberIsNew(true);
    setMemberDraft({ id: `member-${activeHospitalId}-${memberships.length + 1}`, name: "", email: "", hospitalId: activeHospitalId, roleId: assignableRoles.find((role) => role.code !== "platform_admin")?.id ?? "", departmentScope: [], status: "待激活", lastLogin: "尚未登录" });
  }

  function openMemberEditor(member: Membership) {
    setMemberIsNew(false);
    setMemberDraft({ ...member, departmentScope: [...member.departmentScope] });
  }

  async function saveMember(event: FormEvent) {
    event.preventDefault();
    if (!memberDraft?.name.trim() || !memberDraft.email.includes("@")) return notify("请填写姓名和正确的登录邮箱");
    if (memberIsNew && memberships.some((member) => member.hospitalId === activeHospitalId && member.email === memberDraft.email.toLowerCase())) return notify("该账号已属于当前医院");
    const selectedRole = roles.find((role) => role.id === memberDraft.roleId);
    if (selectedRole?.dataScope === "指定科室" && !memberDraft.departmentScope.length) return notify("指定科室角色至少需要配置一个科室");
    setSaving(true);
    try {
      await postConfiguration({ action: "invite_member", hospitalId: activeHospitalId, email: memberDraft.email.toLowerCase(), displayName: memberDraft.name, roleId: memberDraft.roleId, departmentScope: memberDraft.departmentScope });
      const nextMember = { ...memberDraft, email: memberDraft.email.toLowerCase(), hospitalId: activeHospitalId };
      setMemberships((current) => memberIsNew ? [nextMember, ...current] : current.map((member) => member.id === nextMember.id ? nextMember : member));
      recordAudit(memberIsNew ? "添加医院成员" : "调整成员权限", `${nextMember.name} · ${roles.find((role) => role.id === nextMember.roleId)?.name ?? "未配置角色"}`);
      setMemberDraft(null);
      notify(memberIsNew ? "成员已加入待激活清单，验证邮箱首次登录后自动激活" : "成员角色与数据范围已保存");
    } catch (error) { notify(error instanceof Error ? error.message : "成员配置保存失败"); }
    finally { setSaving(false); }
  }

  function suggestUsername(email: string) {
    const local = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, "") ?? "";
    return /^[a-z]/.test(local) ? local : local ? `yh.${local}` : "";
  }

  function randomInitialPassword() {
    const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
    return `Yh${body}8`;
  }

  function openCredentialEditor(member: Membership) {
    setCredentialTarget(member);
    setCredentialUsername(member.username ?? suggestUsername(member.email));
    setCredentialPassword(randomInitialPassword());
  }

  async function saveCredential(event: FormEvent) {
    event.preventDefault();
    if (!credentialTarget) return;
    const username = credentialUsername.trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{2,63}$/.test(username)) return notify("登录账号需以字母开头，3—64 位小写字母、数字或 . _ -");
    if (credentialPassword.length < 8 || !/[a-zA-Z]/.test(credentialPassword) || !/[0-9]/.test(credentialPassword)) return notify("初始密码至少 8 位且需同时包含字母和数字");
    setSaving(true);
    try {
      await postConfiguration({ action: "set_member_credential", hospitalId: activeHospitalId, email: credentialTarget.email, username, password: credentialPassword });
      setMemberships((current) => current.map((item) => item.id === credentialTarget.id ? { ...item, username, mustChangePassword: true } : item));
      recordAudit(credentialTarget.username ? "重置成员密码" : "分配登录账号", `${credentialTarget.name} · ${username}`);
      notify(`登录账号已保存，请把账号密码线下告知成员（首次登录需修改密码）`);
      setCredentialTarget(null);
      setCredentialPassword("");
    } catch (error) { notify(error instanceof Error ? error.message : "登录账号保存失败"); }
    finally { setSaving(false); }
  }

  async function toggleMemberStatus(member: Membership) {
    const nextStatus = member.status === "已停用" ? "正常" : "已停用";
    setSaving(true);
    try {
      await postConfiguration({ action: "update_member_status", hospitalId: activeHospitalId, email: member.email, status: nextStatus === "正常" ? "active" : "disabled" });
      setMemberships((current) => current.map((item) => item.id === member.id ? { ...item, status: nextStatus } : item));
      recordAudit(`${nextStatus === "正常" ? "启用" : "停用"}成员`, member.email);
      notify(`${member.name}已${nextStatus === "正常" ? "启用" : "停用"}`);
    } catch (error) { notify(error instanceof Error ? error.message : "成员状态保存失败"); }
    finally { setSaving(false); setPendingMemberStatusChange(null); }
  }

  function openRoleCopy(role?: ConfigurableRole) {
    setRoleIsNew(true);
    setRoleDraft(role ? { ...role, id: `role-${Date.now()}`, hospitalId: activeHospitalId, name: `${role.name}（自定义）`, code: `${role.code}_custom`, builtIn: false, memberCount: 0, permissions: role.permissions.filter((permission) => actorPermissionSet.has(permission)) } : { id: `role-${Date.now()}`, hospitalId: activeHospitalId, name: "", code: "", description: "", dataScope: "本医院全部", memberCount: 0, builtIn: false, permissions: actorPermissionSet.has("dashboard.view") ? ["dashboard.view"] : [] });
  }

  function openRoleEditor(role: ConfigurableRole) {
    setRoleIsNew(false);
    setRoleDraft({ ...role, permissions: [...role.permissions] });
  }

  async function saveRole(event: FormEvent) {
    event.preventDefault();
    if (!roleDraft?.name.trim() || !roleDraft.code.trim() || !roleDraft.permissions.length) return notify("请填写角色名称、编码并至少选择一项权限");
    setSaving(true);
    try {
      const result = await postConfiguration({ action: "save_role", hospitalId: activeHospitalId, roleId: roleIsNew ? undefined : roleDraft.id, roleCode: roleDraft.code, roleName: roleDraft.name, roleDescription: roleDraft.description, dataScope: serverScope[roleDraft.dataScope], permissionCodes: roleDraft.permissions });
      const serverRole = result.role as { id?: string } | undefined;
      const nextRole = { ...roleDraft, id: serverRole?.id ?? roleDraft.id, hospitalId: activeHospitalId, builtIn: false };
      setRoles((current) => roleIsNew ? [...current, nextRole] : current.map((role) => role.id === nextRole.id ? nextRole : role));
      recordAudit(roleIsNew ? "新增自定义角色" : "更新角色权限", `${nextRole.name} · ${nextRole.permissions.length}项权限`);
      setRoleDraft(null);
      notify(roleIsNew ? "自定义角色已创建" : "角色权限已保存");
    } catch (error) { notify(error instanceof Error ? error.message : "角色配置保存失败"); }
    finally { setSaving(false); }
  }

  async function saveAuditPolicy(event: FormEvent) {
    event.preventDefault();
    if (!canManageMembers) return notify("当前账号只有审计查看权限，不能修改安全策略");
    setSaving(true);
    try {
      await postConfiguration({ action: "save_audit_policy", ...auditDraft });
      setPolicies((current) => ({ ...current, [activeHospitalId]: { ...auditDraft, hospitalId: activeHospitalId } }));
      recordAudit("更新审计策略", `${auditDraft.retentionDays}天保留 · 每${auditDraft.reviewCycleMonths}个月复核`);
      notify("审计与权限复核策略已保存");
    } catch (error) { notify(error instanceof Error ? error.message : "审计策略保存失败"); }
    finally { setSaving(false); }
  }

  function exportAuditLog() {
    const header = ["时间", "操作者", "医院", "动作", "对象", "结果"];
    const rows = visibleAuditEvents.map((event) => [event.time, event.actor, event.hospital, actionLabel(event.action), event.target, event.result]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${activeHospital?.shortName ?? "医院"}-权限审计日志.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    recordAudit("导出审计日志", `${visibleAuditEvents.length}条`);
    notify("审计日志已导出");
  }

  return (
    <>
      <div className="page-heading access-heading compact-access-heading">
        <div><div className="eyebrow"><ShieldCheck size={15} />医院租户与权限配置</div><h1>医院与权限</h1><p>配置医院、账号、角色和审计策略。正式登录环境保存到服务端，演示环境保存到当前浏览器。</p></div>
        <div className="identity-assurance"><span className={`identity-state identity-${sessionState}`}><Fingerprint size={15} />{sessionState === "verified" ? "身份已核验" : sessionState === "loading" ? "正在核验" : "演示配置"}</span><strong>{viewer.displayName}</strong><small>{effectiveRole}</small></div>
      </div>

      <section className="access-config-summary">
        <div><span>当前医院</span><strong>{activeHospital?.shortName}</strong><small>{activeHospital?.code} · {activeHospital?.status}</small></div>
        <div><span>医院成员</span><strong>{visibleMembers.length + 1}</strong><small>含当前账号</small></div>
        <div><span>可用角色</span><strong>{currentHospitalRoles.length}</strong><small>{currentHospitalRoles.filter((role) => !role.builtIn).length} 个自定义角色</small></div>
        <div><span>权限复核</span><strong>每 {currentPolicy.reviewCycleMonths} 个月</strong><small>日志保留 {currentPolicy.retentionDays} 天</small></div>
      </section>

      <div className="access-tabs config-tabs">
        <button className={tab === "hospitals" ? "active" : ""} onClick={() => setTab("hospitals")}><Building2 size={16} />医院</button>
        <button className={tab === "members" ? "active" : ""} onClick={() => setTab("members")}><Users size={16} />成员</button>
        <button className={tab === "roles" ? "active" : ""} onClick={() => setTab("roles")}><KeyRound size={16} />角色权限</button>
        <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><FileClock size={16} />审计策略</button>
      </div>

      {tab === "hospitals" ? <section className="panel access-panel"><div className="panel-heading"><div><h3>医院配置</h3><p>维护名称、简称、等级、院区和运行状态。</p></div>{platformAdmin ? <button className="primary-button" onClick={openNewHospital}><Plus size={16} />新增医院</button> : <span className="chart-note">仅平台管理员可配置</span>}</div><div className="hospital-config-list">{hospitals.map((hospital) => <article key={hospital.id} className={hospital.id === activeHospitalId ? "active" : ""}><header><span><Building2 size={18} /></span><div><strong>{hospital.name}</strong><small>{hospital.code} · {hospital.level} · {hospital.region}</small></div><i className={`hospital-status status-${hospital.status}`}>{hospital.status}</i></header><div className="hospital-config-metrics"><span>数据完整率<strong>{hospital.dataCompleteness.toFixed(1)}%</strong></span><span>已准备文件来源<strong>{hospital.connectedSources} 个</strong></span><span>租户隔离键<strong>{hospital.tenantKey}</strong></span></div><footer><button className="text-button" disabled={hospital.id === activeHospitalId || hospital.status === "已停用"} onClick={() => onSwitchHospital(hospital.id)}>进入</button>{platformAdmin ? <><button className="secondary-button compact-action" onClick={() => openHospitalEditor(hospital)}><Pencil size={14} />编辑</button><button className={`secondary-button compact-action ${hospital.status === "已停用" ? "success-action" : "danger-action"}`} disabled={hospital.id === activeHospitalId && hospital.status !== "已停用"} onClick={() => setPendingHospitalStatusChange(hospital)}>{hospital.status === "已停用" ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}{hospital.status === "已停用" ? "启用" : "停用"}</button></> : null}</footer></article>)}</div></section> : null}

      {tab === "members" ? <section className="panel access-panel"><div className="panel-heading"><div><h3>{activeHospital?.shortName}成员</h3><p>为账号分配医院内角色，并按需限定科室数据范围。</p></div>{canManageMembers ? <button className="primary-button" onClick={openNewMember}><UserPlus size={16} />添加成员</button> : <span className="chart-note">只读权限</span>}</div><div className="table-toolbar"><label className="search-field"><Search size={16} /><input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="搜索姓名、邮箱或角色" /></label><span className="chart-note">{visibleMembers.length + 1} 个账号</span></div><div className="table-scroll"><table className="data-table member-table configurable-member-table"><thead><tr><th>账号</th><th>角色</th><th>数据范围</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody><tr className="current-viewer-row"><td><div className="member-identity"><span>{viewer.displayName.slice(0, 1)}</span><div><strong>{viewer.displayName}</strong><small>{viewer.email} · 当前账号</small></div></div></td><td>{effectiveRole}</td><td>{activeServerMembership?.dataScope === "department" ? activeServerMembership.departmentScope.join("、") : "医院范围"}</td><td><span className="status-pill success">正常</span></td><td>本次访问</td><td><span className="muted-action">不可修改自己</span></td></tr>{visibleMembers.map((member) => { const role = roles.find((item) => item.id === member.roleId); const manageable = assignableRoles.some((item) => item.id === role?.id); return <tr key={member.id}><td><div className="member-identity"><span>{member.name.slice(0, 1)}</span><div><strong>{member.name}</strong><small>{member.email}</small><small className={member.username ? "member-username" : "member-username missing"}>{member.username ? `登录账号：${member.username}${member.mustChangePassword ? "（待改密）" : ""}` : "未分配登录账号"}</small></div></div></td><td>{role?.name ?? "未配置"}</td><td>{member.departmentScope.length ? member.departmentScope.join("、") : role?.dataScope ?? "医院范围"}</td><td><span className={`status-pill ${member.status === "正常" ? "success" : member.status === "待激活" ? "warning" : "neutral"}`}>{member.status}</span></td><td>{member.lastLogin}</td><td>{manageable ? <div className="row-actions"><button className="text-button" onClick={() => openMemberEditor(member)}>编辑</button><button className="text-button" onClick={() => openCredentialEditor(member)}>{member.username ? "重置密码" : "分配账号"}</button><button className="text-button danger-text" onClick={() => setPendingMemberStatusChange(member)}>{member.status === "已停用" ? "启用" : "停用"}</button></div> : <span className="muted-action">权限高于当前账号</span>}</td></tr>; })}</tbody></table></div></section> : null}

      {tab === "roles" ? <section className="panel access-panel"><div className="panel-heading"><div><h3>角色与权限</h3><p>内置角色作为模板使用；复制后可按本医院需要配置权限。</p></div>{canManageMembers ? <button className="primary-button" onClick={() => openRoleCopy()}><Plus size={16} />新增自定义角色</button> : <span className="chart-note">只读权限</span>}</div><div className="role-config-list">{currentHospitalRoles.map((role) => { const manageable = assignableRoles.some((item) => item.id === role.id); return <article key={role.id}><div className="role-config-head"><span className={roleRisk(role) ? "risk" : "standard"}><UserCog size={17} /></span><div><strong>{role.name}</strong><small>{role.code} · {role.builtIn ? "内置模板" : "本医院自定义"}</small></div><i>{memberships.filter((member) => member.roleId === role.id && member.hospitalId === activeHospitalId).length} 人</i></div><p>{role.description}</p><div className="role-config-meta"><span>{role.dataScope}</span><span>{role.permissions.length} 项权限</span>{roleRisk(role) ? <span className="risk-label">含高风险权限</span> : null}</div><div className="role-permission-preview">{permissionColumns.map((permission) => <span key={permission.code} className={role.permissions.includes(permission.code) ? "allowed" : "denied"}>{role.permissions.includes(permission.code) ? <Check size={12} /> : null}{permission.label}</span>)}</div>{canManageMembers ? <footer>{manageable ? role.builtIn ? <button className="secondary-button" onClick={() => openRoleCopy(role)}><Copy size={14} />复制为自定义角色</button> : <button className="secondary-button" onClick={() => openRoleEditor(role)}><Settings2 size={14} />配置角色</button> : <span className="muted-action">权限高于当前账号，不可配置</span>}</footer> : null}</article>; })}</div></section> : null}

      {tab === "audit" ? <div className="audit-config-layout"><form className="panel audit-policy-panel" onSubmit={saveAuditPolicy}><div className="panel-heading"><div><h3>审计与复核策略</h3><p>设置当前医院的日志保留、账号邀请和权限复核规则。</p></div><span className="page-badge"><FileClock size={15} />当前生效</span></div><div className="audit-policy-fields"><label>日志保留期<select disabled={!canManageMembers} value={auditDraft.retentionDays} onChange={(event) => setAuditDraft((current) => ({ ...current, retentionDays: Number(event.target.value) }))}><option value={180}>180 天</option><option value={365}>365 天</option><option value={730}>2 年</option><option value={1095}>3 年</option></select><small>到期后按医院制度归档或清理</small></label><label>权限复核周期<select disabled={!canManageMembers} value={auditDraft.reviewCycleMonths} onChange={(event) => setAuditDraft((current) => ({ ...current, reviewCycleMonths: Number(event.target.value) }))}><option value={1}>每月</option><option value={3}>每季度</option><option value={6}>每半年</option><option value={12}>每年</option></select><small>高风险角色建议每季度复核</small></label><label>待激活有效期<select disabled={!canManageMembers} value={auditDraft.invitationExpiryDays} onChange={(event) => setAuditDraft((current) => ({ ...current, invitationExpiryDays: Number(event.target.value) }))}><option value={3}>3 天</option><option value={7}>7 天</option><option value={14}>14 天</option><option value={30}>30 天</option></select><small>验证邮箱首次登录自动激活，过期则拒绝</small></label><label>拒绝访问告警阈值<select disabled={!canManageMembers} value={auditDraft.denialAlertThreshold} onChange={(event) => setAuditDraft((current) => ({ ...current, denialAlertThreshold: Number(event.target.value) }))}><option value={3}>3 次/小时</option><option value={5}>5 次/小时</option><option value={10}>10 次/小时</option><option value={20}>20 次/小时</option></select><small>达到阈值后进入消息中心</small></label></div><footer className="audit-policy-actions"><span>上次更新：{currentPolicy.updatedAt ? new Date(currentPolicy.updatedAt).toLocaleString("zh-CN", { hour12: false }) : "使用默认策略"}</span><button className="primary-button" disabled={saving || !canManageMembers}><Save size={16} />{canManageMembers ? "保存策略" : "只读"}</button></footer></form><section className="panel audit-log-panel"><div className="panel-heading"><div><h3>授权与访问日志</h3><p>记录配置变更、允许访问和拒绝访问。</p></div><button className="secondary-button" onClick={exportAuditLog}><Download size={16} />导出日志</button></div><div className="audit-config-kpis"><div><span>高风险角色</span><strong>{highRiskRoles}</strong></div><div><span>待激活账号</span><strong>{memberships.filter((member) => member.hospitalId === activeHospitalId && member.status === "待激活").length}</strong></div><div><span>拒绝记录</span><strong>{recentDenials}</strong></div></div><div className="table-scroll"><table className="data-table audit-table"><thead><tr><th>时间</th><th>操作者</th><th>医院</th><th>动作</th><th>对象</th><th>结果</th></tr></thead><tbody>{visibleAuditEvents.map((event) => <tr key={`${event.time}-${event.actor}-${event.action}`}><td>{event.time}</td><td>{event.actor}</td><td>{event.hospital}</td><td>{actionLabel(event.action)}</td><td>{event.target}</td><td><span className={`status-pill ${event.result === "成功" ? "success" : "danger"}`}>{event.result}</span></td></tr>)}</tbody></table></div></section></div> : null}

      {hospitalDraft ? <div className="modal-backdrop access-modal"><form className="access-dialog" onSubmit={saveHospital}><header><div><span>{hospitalIsNew ? "新增医院" : "编辑医院"}</span><h2>{hospitalIsNew ? "创建医院配置" : hospitalDraft.shortName}</h2></div><button type="button" className="icon-button" onClick={() => setHospitalDraft(null)} aria-label="关闭医院配置"><X size={18} /></button></header><div className="access-dialog-body"><label>医院全称<input required value={hospitalDraft.name} onChange={(event) => setHospitalDraft((current) => current ? { ...current, name: event.target.value } : current)} placeholder="例如：某某市中心医院" /></label><div className="form-row two"><label>医院编码<input required disabled={!hospitalIsNew} value={hospitalDraft.code} onChange={(event) => setHospitalDraft((current) => current ? { ...current, code: event.target.value.toUpperCase() } : current)} /></label><label>显示简称<input value={hospitalDraft.shortName} onChange={(event) => setHospitalDraft((current) => current ? { ...current, shortName: event.target.value } : current)} /></label></div><div className="form-row two"><label>医院等级<select value={hospitalDraft.level} onChange={(event) => setHospitalDraft((current) => current ? { ...current, level: event.target.value } : current)}><option>三级甲等</option><option>三级综合</option><option>三级专科</option><option>二级医院</option><option>未设置</option></select></label><label>院区/区域<input value={hospitalDraft.region} onChange={(event) => setHospitalDraft((current) => current ? { ...current, region: event.target.value } : current)} /></label></div><div className="dialog-warning"><CircleAlert size={16} />医院编码创建后不可修改；医院停启用请在医院列表中单独操作。</div></div><footer><button type="button" className="secondary-button" onClick={() => setHospitalDraft(null)}>取消</button><button className="primary-button" disabled={saving}><Save size={16} />保存医院</button></footer></form></div> : null}

      {memberDraft ? <div className="modal-backdrop access-modal"><form className="access-dialog" onSubmit={saveMember}><header><div><span>{activeHospital?.shortName}</span><h2>{memberIsNew ? "添加医院成员" : "编辑成员权限"}</h2></div><button type="button" className="icon-button" onClick={() => setMemberDraft(null)} aria-label="关闭成员配置"><X size={18} /></button></header><div className="access-dialog-body"><div className="form-row two"><label>姓名<input required value={memberDraft.name} onChange={(event) => setMemberDraft((current) => current ? { ...current, name: event.target.value } : current)} /></label><label>登录邮箱<input type="email" required disabled={!memberIsNew} value={memberDraft.email} onChange={(event) => setMemberDraft((current) => current ? { ...current, email: event.target.value } : current)} /></label></div><label>医院内角色<select required value={memberDraft.roleId} onChange={(event) => setMemberDraft((current) => current ? { ...current, roleId: event.target.value, departmentScope: [] } : current)}>{assignableRoles.filter((role) => role.code !== "platform_admin" || platformAdmin).map((role) => <option key={role.id} value={role.id}>{role.name} · {role.dataScope}</option>)}</select></label><label>科室范围<input value={memberDraft.departmentScope.join("、")} onChange={(event) => setMemberDraft((current) => current ? { ...current, departmentScope: event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) } : current)} placeholder="仅指定科室角色需要，例如：医学影像科、放射科" /></label><div className="config-form-note">数据范围由角色决定；选择“指定科室”角色时必须填写科室范围。</div></div><footer><button type="button" className="secondary-button" onClick={() => setMemberDraft(null)}>取消</button><button className="primary-button" disabled={saving}><Save size={16} />保存成员</button></footer></form></div> : null}

      {roleDraft ? <div className="modal-backdrop access-modal"><form className="access-dialog wide-dialog" onSubmit={saveRole}><header><div><span>{roleIsNew ? "本医院自定义角色" : "编辑自定义角色"}</span><h2>{roleIsNew ? "配置角色" : roleDraft.name}</h2></div><button type="button" className="icon-button" onClick={() => setRoleDraft(null)} aria-label="关闭角色配置"><X size={18} /></button></header><div className="access-dialog-body"><div className="form-row two"><label>角色名称<input required value={roleDraft.name} onChange={(event) => setRoleDraft((current) => current ? { ...current, name: event.target.value } : current)} /></label><label>角色编码<input required disabled={!roleIsNew} value={roleDraft.code} onChange={(event) => setRoleDraft((current) => current ? { ...current, code: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") } : current)} placeholder="例如：equipment_viewer" /></label></div><label>角色说明<input value={roleDraft.description} onChange={(event) => setRoleDraft((current) => current ? { ...current, description: event.target.value } : current)} /></label><label>数据范围<select value={roleDraft.dataScope} onChange={(event) => setRoleDraft((current) => current ? { ...current, dataScope: event.target.value as DataScope } : current)}>{dataScopeOptions.map((scope) => <option key={scope}>{scope}</option>)}</select></label><fieldset className="permission-selector menu-selector"><legend>左侧菜单可见性 <span>勾选后自动配置对应权限</span></legend><div>{menuCatalog.map((menu) => { const permissionSet = new Set(roleDraft.permissions); const visible = menuVisibleForPermissions(menu, permissionSet); const grantable = menu.permissions.some((code) => actorPermissionSet.has(code)); return <label key={menu.id} className={visible ? "checked" : ""}><input type="checkbox" disabled={!grantable} checked={visible} onChange={() => setRoleDraft((current) => current ? { ...current, permissions: togglePermissionsForMenu(current.permissions, menu, !visible, actorPermissionSet) } : current)} /><span><strong>{menu.label}</strong><small>{menu.note ?? (menu.group === "show" ? "展示菜单" : "管理菜单")}</small></span><Check size={15} /></label>; })}</div><small className="menu-selector-note">消息中心与使用指南无需权限，对全部角色可见。菜单勾选与下方“功能权限”联动，也可在下方逐项微调。</small></fieldset><fieldset className="permission-selector"><legend>功能权限 <span>已选 {roleDraft.permissions.length} 项</span></legend><div>{permissionColumns.map((permission) => <label key={permission.code} className={roleDraft.permissions.includes(permission.code) ? "checked" : ""}><input type="checkbox" disabled={!actorPermissionSet.has(permission.code)} checked={roleDraft.permissions.includes(permission.code)} onChange={() => setRoleDraft((current) => current ? { ...current, permissions: current.permissions.includes(permission.code) ? current.permissions.filter((code) => code !== permission.code) : [...current.permissions, permission.code] } : current)} /><span><strong>{permission.label}</strong><small>{permission.code}</small></span><Check size={15} /></label>)}</div></fieldset><div className="dialog-warning"><CircleAlert size={16} />成员管理、医院配置、成本维护和报表导出属于高风险权限，应按最小权限原则分配。</div></div><footer><button type="button" className="secondary-button" onClick={() => setRoleDraft(null)}>取消</button><button className="primary-button" disabled={saving}><Save size={16} />保存角色</button></footer></form></div> : null}

      {credentialTarget ? <div className="modal-backdrop access-modal"><form className="access-dialog" onSubmit={saveCredential}><header><div><span>{activeHospital?.shortName}</span><h2>{credentialTarget.username ? "重置登录密码" : "分配登录账号"}</h2></div><button type="button" className="icon-button" onClick={() => { setCredentialTarget(null); setCredentialPassword(""); }} aria-label="关闭登录账号配置"><X size={18} /></button></header><div className="access-dialog-body"><div className="config-form-note">为 {credentialTarget.name}（{credentialTarget.email}）设置账号密码登录凭据。保存后请线下告知成员；成员首次登录必须修改密码。</div><div className="form-row two"><label>登录账号<input required value={credentialUsername} disabled={Boolean(credentialTarget.username)} onChange={(event) => setCredentialUsername(event.target.value)} placeholder="小写字母开头，如 zhang.san" /></label><label>初始密码<input required value={credentialPassword} onChange={(event) => setCredentialPassword(event.target.value)} placeholder="至少 8 位，含字母和数字" /></label></div><div className="row-actions"><button type="button" className="text-button" onClick={() => setCredentialPassword(randomInitialPassword())}>重新生成随机密码</button></div><div className="dialog-warning"><CircleAlert size={16} />密码只在此处展示一次，服务端仅保存加盐哈希；请勿通过不安全渠道传递。</div></div><footer><button type="button" className="secondary-button" onClick={() => { setCredentialTarget(null); setCredentialPassword(""); }}>取消</button><button className="primary-button" disabled={saving}><Save size={16} />保存凭据</button></footer></form></div> : null}

      {pendingMemberStatusChange ? <div className="modal-backdrop confirmation-modal"><section className="confirmation-dialog"><span className="confirmation-icon"><UserCog size={22} /></span><div><small>成员状态变更</small><h2>{pendingMemberStatusChange.status === "已停用" ? "启用" : "停用"}{pendingMemberStatusChange.name}？</h2><p>{pendingMemberStatusChange.status === "已停用" ? "启用后将恢复该账号在当前医院的访问。" : "停用后将立即撤销该账号在当前医院的访问，其他医院不受影响。"}</p></div><footer><button className="secondary-button" onClick={() => setPendingMemberStatusChange(null)}>取消</button><button className="danger-button" disabled={saving} onClick={() => toggleMemberStatus(pendingMemberStatusChange)}>确认{pendingMemberStatusChange.status === "已停用" ? "启用" : "停用"}</button></footer></section></div> : null}

      {pendingHospitalStatusChange ? <div className="modal-backdrop confirmation-modal"><section className="confirmation-dialog"><span className="confirmation-icon"><Building2 size={22} /></span><div><small>医院状态变更</small><h2>{pendingHospitalStatusChange.status === "已停用" ? "启用" : "停用"}{pendingHospitalStatusChange.shortName}？</h2><p>{pendingHospitalStatusChange.status === "已停用" ? "启用后，已授权成员可以重新进入该医院。" : "停用后，该医院全部成员将无法访问业务数据，但历史配置和审计日志会保留。"}</p></div><footer><button className="secondary-button" onClick={() => setPendingHospitalStatusChange(null)}>取消</button><button className="danger-button" disabled={saving} onClick={() => toggleHospitalStatus(pendingHospitalStatusChange)}>确认{pendingHospitalStatusChange.status === "已停用" ? "启用" : "停用"}</button></footer></section></div> : null}
    </>
  );
}
