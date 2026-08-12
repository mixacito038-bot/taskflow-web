export type HospitalStatus = "运行中" | "筹备中" | "已停用";

export type Hospital = {
  id: string;
  code: string;
  name: string;
  shortName: string;
  level: string;
  category: string;
  /** 资产编号简码：新增设备时按「简码 + 7 位顺序号」生成资产编号。 */
  assetCodePrefix: string;
  region: string;
  status: HospitalStatus;
  tenantKey: string;
  dataCompleteness: number;
  connectedSources: number;
};

export type ViewerIdentity = {
  displayName: string;
  email: string;
  authenticated: boolean;
};

export type DataScope = "平台全部医院" | "本医院全部" | "指定科室" | "本人负责设备";

export type RoleDefinition = {
  id: string;
  name: string;
  code: string;
  description: string;
  dataScope: DataScope;
  memberCount: number;
  builtIn: boolean;
  permissions: string[];
};

export type Membership = {
  id: string;
  name: string;
  email: string;
  hospitalId: string;
  roleId: string;
  departmentScope: string[];
  status: "正常" | "待激活" | "已停用";
  lastLogin: string;
  username?: string | null;
  mustChangePassword?: boolean;
};

export const initialHospitals: Hospital[] = [
  { id: "hosp-central", code: "HOSP-001", name: "勇虹示范中心医院", shortName: "中心医院", level: "三级甲等", category: "综合医院", assetCodePrefix: "YHZX", region: "总院区", status: "运行中", tenantKey: "tenant_yh_central", dataCompleteness: 96.8, connectedSources: 7 },
  { id: "hosp-east", code: "HOSP-002", name: "勇虹示范东院", shortName: "东院", level: "三级乙等", category: "综合医院", assetCodePrefix: "YHDY", region: "东院区", status: "运行中", tenantKey: "tenant_yh_east", dataCompleteness: 91.4, connectedSources: 5 },
  { id: "hosp-specialty", code: "HOSP-003", name: "勇虹示范专科医院", shortName: "专科医院", level: "三级（未定等）", category: "专科医院", assetCodePrefix: "YHZK", region: "专科院区", status: "运行中", tenantKey: "tenant_yh_specialty", dataCompleteness: 88.6, connectedSources: 4 },
];

export const permissionColumns = [
  { code: "dashboard.view", label: "驾驶舱" },
  { code: "equipment.manage", label: "设备台账" },
  { code: "cost.manage", label: "成本填报" },
  { code: "improvement.manage", label: "改进闭环" },
  { code: "report.manage", label: "报告编制" },
  { code: "report.review", label: "报告复核" },
  { code: "report.approve", label: "报告签发" },
  { code: "report.export", label: "报表导出" },
  { code: "source.manage", label: "数据口径" },
  { code: "connector.manage", label: "文件来源配置" },
  { code: "data.ingest", label: "数据导入" },
  { code: "data.clean", label: "数据清洗" },
  { code: "data.review", label: "数据复核" },
  { code: "data.publish", label: "数据发布" },
  { code: "hospital.manage", label: "医院配置" },
  { code: "member.manage", label: "用户权限" },
  { code: "audit.view", label: "审计日志" },
];

const allPermissions = permissionColumns.map((permission) => permission.code);

export const initialRoles: RoleDefinition[] = [
  { id: "role-platform-admin", name: "平台超级管理员", code: "platform_admin", description: "负责医院租户开通与全平台安全治理，不参与日常业务操作。", dataScope: "平台全部医院", memberCount: 1, builtIn: true, permissions: allPermissions },
  { id: "role-hospital-admin", name: "医院管理员", code: "hospital_admin", description: "管理本医院组织、成员、角色、文件来源和院级配置。", dataScope: "本医院全部", memberCount: 3, builtIn: true, permissions: allPermissions.filter((code) => code !== "hospital.manage") },
  { id: "role-leadership", name: "院领导", code: "leadership", description: "查看全院经营、资源配置和改进成效，并负责正式报告与数据版本签发。", dataScope: "本医院全部", memberCount: 8, builtIn: true, permissions: ["dashboard.view", "improvement.manage", "report.approve", "report.export", "data.publish", "audit.view"] },
  { id: "role-equipment", name: "医学装备管理员", code: "equipment_manager", description: "维护设备台账、文件数据准备、保障任务和效益报告初稿。", dataScope: "本医院全部", memberCount: 12, builtIn: true, permissions: ["dashboard.view", "equipment.manage", "improvement.manage", "report.manage", "report.export", "source.manage", "connector.manage", "data.ingest", "data.clean", "data.review", "audit.view"] },
  { id: "role-finance", name: "财务成本管理员", code: "finance_manager", description: "维护收入成本口径、复核效益数据和报告财务结论。", dataScope: "本医院全部", memberCount: 6, builtIn: true, permissions: ["dashboard.view", "cost.manage", "report.manage", "report.review", "report.export", "source.manage", "data.review", "audit.view"] },
  { id: "role-clinical", name: "临床科室负责人", code: "clinical_manager", description: "仅查看授权科室并跟进本科室改进任务。", dataScope: "指定科室", memberCount: 34, builtIn: true, permissions: ["dashboard.view", "improvement.manage"] },
  { id: "role-auditor", name: "审计只读", code: "auditor", description: "查看指定医院的分析结果、指标口径和审计记录。", dataScope: "本医院全部", memberCount: 4, builtIn: true, permissions: ["dashboard.view", "report.export", "source.manage", "audit.view"] },
];

export const initialMemberships: Membership[] = [
  { id: "member-01", name: "陈敏", email: "chen.min@example-hospital.cn", hospitalId: "hosp-central", roleId: "role-hospital-admin", departmentScope: [], status: "正常", lastLogin: "2026-07-22 09:12" },
  { id: "member-02", name: "周宁", email: "zhou.ning@example-hospital.cn", hospitalId: "hosp-central", roleId: "role-equipment", departmentScope: [], status: "正常", lastLogin: "2026-07-22 08:46" },
  { id: "member-03", name: "林晓", email: "lin.xiao@example-hospital.cn", hospitalId: "hosp-central", roleId: "role-finance", departmentScope: [], status: "正常", lastLogin: "2026-07-21 17:28" },
  { id: "member-04", name: "吴桐", email: "wu.tong@example-hospital.cn", hospitalId: "hosp-east", roleId: "role-clinical", departmentScope: ["医学影像科"], status: "正常", lastLogin: "2026-07-22 07:55" },
  { id: "member-05", name: "蒋辰", email: "jiang.chen@example-hospital.cn", hospitalId: "hosp-specialty", roleId: "role-equipment", departmentScope: [], status: "待激活", lastLogin: "尚未登录" },
  { id: "member-06", name: "审计专员", email: "audit@example-hospital.cn", hospitalId: "hosp-central", roleId: "role-auditor", departmentScope: [], status: "正常", lastLogin: "2026-07-20 14:10" },
];

export const accessAuditEvents = [
  { time: "07-22 09:18", actor: "平台管理员", hospital: "中心医院", action: "更新角色权限", target: "医学装备管理员", result: "成功" },
  { time: "07-22 09:12", actor: "陈敏", hospital: "中心医院", action: "导出设备效益报表", target: "2026 年度", result: "成功" },
  { time: "07-22 08:51", actor: "未知账号", hospital: "东院", action: "访问成本填报", target: "固定成本", result: "已拒绝" },
  { time: "07-21 17:42", actor: "林晓", hospital: "中心医院", action: "更新成本数据", target: "128 排 CT", result: "成功" },
];
