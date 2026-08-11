export type NotificationCategory = "预警" | "待办" | "数据" | "安全" | "系统";
export type NotificationPriority = "紧急" | "重要" | "普通";
export type NotificationTarget = "detail" | "costs" | "improvement" | "sources" | "access" | "cockpit";

export type PlatformNotification = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  hospitalId?: string;
  hospitalName: string;
  createdAt: string;
  timeLabel: string;
  source: string;
  read: boolean;
  actionLabel?: string;
  target?: NotificationTarget;
  deviceId?: string;
};

export const initialNotifications: PlatformNotification[] = [
  {
    id: "notice-robot-roi",
    title: "手术机器人进入效益预警区间",
    summary: "近 3 个月手术量低于计划 18%，预计回本期延长至 9.1 年。",
    detail: "建议设备科联合手术部复核术式开放、排程利用率与专用耗材成本，并在本周运营例会上确认改进负责人。",
    category: "预警",
    priority: "紧急",
    hospitalId: "hosp-central",
    hospitalName: "中心医院",
    createdAt: "2026-07-22T09:26:00+08:00",
    timeLabel: "今天 09:26",
    source: "效益预警引擎",
    read: false,
    actionLabel: "查看单机分析",
    target: "detail",
    deviceId: "robot-01",
  },
  {
    id: "notice-cost-review",
    title: "6 月人工成本等待财务复核",
    summary: "医学影像科提交 3 条人工成本记录，共计 42.8 万元。",
    detail: "成本将在复核通过后进入正式月度口径。请核对人员范围、工时来源和小时成本版本，避免与科室间接成本重复归集。",
    category: "待办",
    priority: "重要",
    hospitalId: "hosp-central",
    hospitalName: "中心医院",
    createdAt: "2026-07-22T08:40:00+08:00",
    timeLabel: "今天 08:40",
    source: "成本填报中心",
    read: false,
    actionLabel: "去复核成本",
    target: "costs",
  },
  {
    id: "notice-linac-maintenance",
    title: "直线加速器维保合同将在 30 天内到期",
    summary: "当前合同到期日为 2026-08-18，续签方案尚未登记。",
    detail: "建议医学装备部在到期前完成服务范围、关键备件、响应时限和年度价格比选，并同步更新设备保障口径。",
    category: "预警",
    priority: "重要",
    hospitalId: "hosp-central",
    hospitalName: "中心医院",
    createdAt: "2026-07-21T16:18:00+08:00",
    timeLabel: "昨天 16:18",
    source: "设备维保文件",
    read: false,
    actionLabel: "查看设备详情",
    target: "detail",
    deviceId: "linac-01",
  },
  {
    id: "notice-pacs-mapping",
    title: "检查业务文件发现 12 条项目映射异常",
    summary: "新增项目编码尚未关联设备品类，可能影响本月服务量。",
    detail: "异常数据已进入隔离区，当前不会写入正式指标。请信息部补充项目编码映射，并由医学影像科确认业务口径。",
    category: "数据",
    priority: "重要",
    hospitalId: "hosp-central",
    hospitalName: "中心医院",
    createdAt: "2026-07-21T14:05:00+08:00",
    timeLabel: "昨天 14:05",
    source: "数据质量监测",
    read: true,
    actionLabel: "检查数据源",
    target: "sources",
  },
  {
    id: "notice-member-review",
    title: "东院新增成员等待激活",
    summary: "1 个医学装备管理员账号已创建医院成员关系。",
    detail: "成员还需要进入站点访问名单并完成首次登录。超过 7 天未激活时，邀请应自动失效并进入安全审计。",
    category: "安全",
    priority: "重要",
    hospitalId: "hosp-east",
    hospitalName: "东院",
    createdAt: "2026-07-21T11:32:00+08:00",
    timeLabel: "昨天 11:32",
    source: "医院与权限",
    read: false,
    actionLabel: "查看账号成员",
    target: "access",
  },
  {
    id: "notice-improvement-progress",
    title: "CT 候检时长改进任务已完成阶段复盘",
    summary: "平均候检时长下降 12 分钟，目标完成率 86%。",
    detail: "本阶段已完成预约分时和急诊插单规则调整，仍需观察未来两周高峰时段表现，再决定是否固化为院级流程。",
    category: "待办",
    priority: "普通",
    hospitalId: "hosp-central",
    hospitalName: "中心医院",
    createdAt: "2026-07-20T17:20:00+08:00",
    timeLabel: "07-20 17:20",
    source: "运营改进中心",
    read: true,
    actionLabel: "查看改进任务",
    target: "improvement",
  },
  {
    id: "notice-access-review",
    title: "季度高风险权限复核将在 9 天后到期",
    summary: "需复核平台管理员、医院管理员、设备和财务管理员。",
    detail: "请确认离岗账号、临时授权、跨院成员关系和导出权限。复核结果应保留操作者、时间、变更前后值和审批依据。",
    category: "安全",
    priority: "紧急",
    hospitalName: "全平台",
    createdAt: "2026-07-20T09:00:00+08:00",
    timeLabel: "07-20 09:00",
    source: "安全治理中心",
    read: false,
    actionLabel: "开始权限复核",
    target: "access",
  },
  {
    id: "notice-metric-version",
    title: "2026-V2.0 指标口径已生效",
    summary: "现金贡献、简单回收期和设备可用率口径完成版本更新。",
    detail: "新版本已应用于 2026 年度分析。历史报表仍保留原口径版本号，导出时会同时携带分析期间和口径版本。",
    category: "系统",
    priority: "普通",
    hospitalName: "全平台",
    createdAt: "2026-07-19T10:15:00+08:00",
    timeLabel: "07-19 10:15",
    source: "指标治理中心",
    read: true,
    actionLabel: "查看指标口径",
    target: "sources",
  },
];
