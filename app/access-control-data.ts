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
  { id: "hosp-central", code: "HOSP-001", name: "勇虹示范中心医院", shortName: "中心医院", level: "三级甲等", category: "综合医院", assetCodePrefix: "YHZX", region: "总院区", status: "运行中" },
  { id: "hosp-east", code: "HOSP-002", name: "勇虹示范东院", shortName: "东院", level: "三级乙等", category: "综合医院", assetCodePrefix: "YHDY", region: "东院区", status: "运行中" },
  { id: "hosp-specialty", code: "HOSP-003", name: "勇虹示范专科医院", shortName: "专科医院", level: "三级（未定等）", category: "专科医院", assetCodePrefix: "YHZK", region: "专科院区", status: "运行中" },
];

/**
 * 权限清单：一条权限 = 一组具体的按钮。
 *
 * 本轮删掉了两条空壳（`audit.view` / `connector.manage`）——它们在整个 app/ 下
 * 没有一处 hasPermission 判定、也不参与任何菜单可见性，勾上勾不上界面完全一样。
 * 空壳权限比没有权限更糟：医院以为自己关掉了某个功能，实际根本没关。
 *
 * `controls` 写的是这条权限放开的**按钮**，直接显示在配置角色的弹窗里。
 * 医院管权限的人认按钮不认编码，"source.manage" 看不懂，"指标字典能不能增删改"看得懂。
 */
export type PermissionGroup = "分析查看" | "业务维护" | "报告流转" | "数据准备" | "平台管理";

export type PermissionColumn = {
  code: string;
  label: string;
  controls: string;
  group: PermissionGroup;
  /** 高风险 = 能改院级口径、改别人权限，或把数据对外发出去。角色卡片据此打标。 */
  risk?: boolean;
};

export const permissionGroups: readonly PermissionGroup[] = ["分析查看", "业务维护", "报告流转", "数据准备", "平台管理"];

export const permissionColumns: readonly PermissionColumn[] = [
  { code: "dashboard.view", label: "效益驾驶舱", controls: "进入效益驾驶舱和效益分析", group: "分析查看" },
  { code: "equipment.manage", label: "设备台账", controls: "新增/编辑设备、台账字段配置", group: "业务维护", risk: true },
  { code: "cost.manage", label: "设备数据填报", controls: "确认/退回填报、批量确认、字段配置", group: "业务维护", risk: true },
  { code: "improvement.manage", label: "运营改进与资本计划", controls: "建改进任务、送资本论证、导出论证清单", group: "业务维护" },
  { code: "source.manage", label: "指标字典", controls: "指标字典增删改、分析方案编辑", group: "业务维护", risk: true },
  { code: "report.manage", label: "报告编制", controls: "保存草稿、提交复核、新建修订版", group: "报告流转" },
  { code: "report.review", label: "报告复核", controls: "对待复核的报告做复核处理", group: "报告流转" },
  { code: "report.approve", label: "报告签发", controls: "正式签发报告，并进入资本计划", group: "报告流转", risk: true },
  { code: "report.export", label: "报告查看与导出", controls: "生成效益报告、导出 Word/CSV", group: "报告流转", risk: true },
  { code: "data.ingest", label: "数据导入", controls: "导入与登记原始文件", group: "数据准备" },
  { code: "data.clean", label: "数据清洗", controls: "字段映射、清洗与质量规则", group: "数据准备" },
  { code: "data.review", label: "数据复核", controls: "批次复核、填写对账豁免原因", group: "数据准备" },
  { code: "data.publish", label: "数据发布", controls: "发布与撤回正式数据版本", group: "数据准备", risk: true },
  { code: "hospital.manage", label: "医院租户管理", controls: "新增、编辑、停用医院", group: "平台管理", risk: true },
  { code: "member.manage", label: "用户权限与驾驶舱配置", controls: "成员与角色、驾驶舱布局与看板配置", group: "平台管理", risk: true },
];

const allPermissions = permissionColumns.map((permission) => permission.code);

export const initialRoles: RoleDefinition[] = [
  { id: "role-platform-admin", name: "平台超级管理员", code: "platform_admin", description: "平台侧最高权限，用于开通医院租户与排障；日常业务应交给医院侧角色。", dataScope: "平台全部医院", memberCount: 1, builtIn: true, permissions: allPermissions },
  { id: "role-hospital-admin", name: "医院管理员", code: "hospital_admin", description: "管理本医院组织、成员、角色、数据准备和院级配置。", dataScope: "本医院全部", memberCount: 3, builtIn: true, permissions: allPermissions.filter((code) => code !== "hospital.manage") },
  { id: "role-leadership", name: "院领导", code: "leadership", description: "查看全院经营、资源配置和改进成效，并负责正式报告与数据版本签发。", dataScope: "本医院全部", memberCount: 8, builtIn: true, permissions: ["dashboard.view", "improvement.manage", "report.approve", "report.export", "data.publish"] },
  { id: "role-equipment", name: "医学装备管理员", code: "equipment_manager", description: "维护设备台账、文件数据准备、保障任务和效益报告初稿。", dataScope: "本医院全部", memberCount: 12, builtIn: true, permissions: ["dashboard.view", "equipment.manage", "improvement.manage", "report.manage", "report.export", "source.manage", "data.ingest", "data.clean", "data.review"] },
  { id: "role-finance", name: "财务成本管理员", code: "finance_manager", description: "维护收入成本口径、复核效益数据和报告财务结论。", dataScope: "本医院全部", memberCount: 6, builtIn: true, permissions: ["dashboard.view", "cost.manage", "report.manage", "report.review", "report.export", "source.manage", "data.review"] },
  { id: "role-clinical", name: "临床科室负责人", code: "clinical_manager", description: "仅查看授权科室并跟进本科室改进任务。", dataScope: "指定科室", memberCount: 34, builtIn: true, permissions: ["dashboard.view", "improvement.manage"] },
  { id: "role-auditor", name: "审计只读", code: "auditor", description: "查看分析结果与效益报告，不改动任何配置。", dataScope: "本医院全部", memberCount: 4, builtIn: true, permissions: ["dashboard.view", "report.export"] },
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
  { time: "07-22 08:51", actor: "未知账号", hospital: "东院", action: "访问设备数据填报", target: "固定成本", result: "已拒绝" },
  { time: "07-21 17:42", actor: "林晓", hospital: "中心医院", action: "更新成本数据", target: "128 排 CT", result: "成功" },
];
