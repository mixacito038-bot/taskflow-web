/**
 * 改进任务的数据模型与出厂样例。
 *
 * 从 ImprovementCenter.tsx 里拆出来，是因为组件 import 了 CSS Module，
 * 而 CSS 在 node 里加载不了——模型跟着组件走就没法写真正跑起来的单元测试，
 * 只能退回到正则扫源码那种「看着像对」的断言。收益单位换算这种差一万倍的事，
 * 必须能真跑一遍。
 */

import type { FindingCode } from "./benefit-diagnosis";

export type ActionStatus = "待启动" | "进行中" | "已完成";
export type Priority = "高" | "中" | "低";

export type ActionSource = { deviceId: string; code: FindingCode; title: string };

export type ImprovementAction = {
  id: string;
  deviceId: string;
  title: string;
  issue: string;
  owner: string;
  dueDate: string;
  expectedBenefit: number;
  status: ActionStatus;
  priority: Priority;
  progress: number;
  actualBenefit?: number;
  /**
   * 收益字段的单位标记。
   *
   * 这两个字段历史上存的是万元，而效益分析、资本计划、设备数据填报现在一律用元。
   * 相邻页面上「结余 -1,309,826 元」和「预计收益 118 万元」并排出现，
   * 差一万倍的两个数迟早会被加到一起。统一成元之后，存量数据要能自己认出来还没换算过——
   * 靠的就是这个标记，而不是"看数值大小猜"（38 到底是 38 元还是 38 万元，猜不出来）。
   */
  benefitUnit?: "yuan";
  baselineValue?: number;
  targetValue?: number;
  actualValue?: number;
  metricUnit?: string;
  evidence?: string;
  reviewDate?: string;
  history?: Array<{ at: string; status: ActionStatus; note: string }>;
  sourceFinding?: ActionSource;
};

// 出厂样例已按元存储，带上标记免得再被 normalizeActionBenefitUnits 乘一次
export const initialActions: ImprovementAction[] = [
  {
    id: "action-robot-capacity",
    benefitUnit: "yuan",
    deviceId: "robot-01",
    title: "建立跨科室适应证池并按周统筹排台",
    issue: "使用率 48%，预计回本较计划延后 2.6 年",
    owner: "手术部 / 医务处",
    dueDate: "2026-08-31",
    expectedBenefit: 1180000,
    status: "进行中",
    priority: "高",
    progress: 55,
    baselineValue: 48,
    targetValue: 65,
    metricUnit: "% 使用率",
    evidence: "跨科室适应证池已建立，等待首轮月度复测。",
    history: [{ at: "2026-07-08", status: "进行中", note: "医务处完成方案立项" }],
  },
  {
    id: "action-linac-reliability",
    benefitUnit: "yuan",
    deviceId: "linac-01",
    title: "射频系统故障复盘与关键备件前置",
    issue: "可用率 93.8%，年度停机 78 小时",
    owner: "医学装备部 / 放疗科",
    dueDate: "2026-07-31",
    expectedBenefit: 460000,
    status: "进行中",
    priority: "高",
    progress: 72,
  },
  {
    id: "action-mri-wait",
    benefitUnit: "yuan",
    deviceId: "mri-01",
    title: "增开晚间增强检查时段并重排预约模板",
    issue: "预约等待 3.2 天，高峰时段集中度 62.4%",
    owner: "医学影像科 / 运营部",
    dueDate: "2026-08-15",
    expectedBenefit: 620000,
    status: "待启动",
    priority: "中",
    progress: 15,
  },
  {
    id: "action-ct-flow",
    benefitUnit: "yuan",
    deviceId: "ct-01",
    title: "建立取消原因清单并配置午间机动班次",
    issue: "需求高峰与排班错位，需持续压降积压和取消",
    owner: "医学影像科",
    dueDate: "2026-08-08",
    expectedBenefit: 380000,
    status: "已完成",
    priority: "中",
    progress: 100,
    actualBenefit: 310000,
    baselineValue: 58,
    targetValue: 35,
    actualValue: 37,
    metricUnit: "次取消/周",
    evidence: "午间机动班次排班表、取消原因台账与连续四周复测记录。",
    reviewDate: "2026-08-08",
    history: [{ at: "2026-08-08", status: "已完成", note: "科室复核并确认阶段收益" }],
  },
  {
    id: "action-dr03-merge",
    benefitUnit: "yuan",
    deviceId: "dr-03",
    title: "体检 DR 与门诊时段合并并开放团检预约",
    issue: "使用率 46%，年度净收益 -260,000 元，预计回本超 12 年",
    owner: "健康管理中心 / 医学影像科",
    dueDate: "2026-09-30",
    expectedBenefit: 340000,
    status: "待启动",
    priority: "高",
    progress: 5,
    baselineValue: 46,
    targetValue: 62,
    metricUnit: "% 使用率",
    evidence: "团检客户排期意向表已收集，待运营部排班评审。",
    history: [{ at: "2026-08-05", status: "待启动", note: "低使用率专项立项，纳入三季度改进清单" }],
  },
  {
    id: "action-mri03-warranty",
    benefitUnit: "yuan",
    deviceId: "mri-03",
    title: "1.5T MRI 脱保设备维保方案比价与签约",
    issue: "脱保运行，故障 6.8 次/千小时，年度停机 126 小时",
    owner: "医学装备部 / 采购中心",
    dueDate: "2026-09-15",
    expectedBenefit: 520000,
    status: "进行中",
    priority: "高",
    progress: 40,
    baselineValue: 126,
    targetValue: 60,
    metricUnit: "小时停机/年",
    evidence: "原厂与两家第三方维保报价已入围，等待院内比价会议。",
    history: [{ at: "2026-07-28", status: "进行中", note: "完成维保需求清单与故障史整理" }],
  },
  {
    id: "action-usportable-dispatch",
    benefitUnit: "yuan",
    deviceId: "us-portable-01",
    title: "便携彩超转入共享调度池按床旁需求派单",
    issue: "使用率 52%，科室专占导致闲置与重复购置申请并存",
    owner: "超声医学科 / 医学装备部",
    dueDate: "2026-09-10",
    expectedBenefit: 180000,
    status: "进行中",
    priority: "中",
    progress: 30,
    baselineValue: 52,
    targetValue: 70,
    metricUnit: "% 使用率",
    evidence: "共享调度试行方案已发科室征求意见。",
  },
  {
    id: "action-ct02-capacity",
    benefitUnit: "yuan",
    deviceId: "ct-02",
    title: "256 排 CT 超负荷分流与增购论证",
    issue: "使用率 93%，预约等待 4.5 天，节假日积压明显",
    owner: "医学影像科 / 运营部",
    dueDate: "2026-10-31",
    expectedBenefit: 960000,
    status: "待启动",
    priority: "中",
    progress: 10,
    baselineValue: 4.5,
    targetValue: 2.5,
    metricUnit: "天预约等待",
    evidence: "分流至 ct-03 的时段方案与增购可行性初稿编制中。",
  },
];

/** 万元换算成元的倍率。写成常量而不是散落的 10000，改口径时不会漏掉某一处。 */
const WAN_TO_YUAN = 10_000;

/**
 * 把历史上按万元存的收益字段换算成元。
 *
 * 只认 benefitUnit 标记，不按数值大小猜：一台设备预计收益 38，
 * 既可能是没换算过的 38 万元，也可能是换算过的 38 元，猜错就是一万倍的账。
 * 换算后打上标记，下次读到就不再动它——这个函数必须可以反复调用而结果不变。
 */
export function normalizeActionBenefitUnits(actions: readonly ImprovementAction[]): ImprovementAction[] {
  return actions.map((action) => {
    if (action.benefitUnit === "yuan") return action;
    const next: ImprovementAction = { ...action, benefitUnit: "yuan", expectedBenefit: action.expectedBenefit * WAN_TO_YUAN };
    if (action.actualBenefit !== undefined) next.actualBenefit = action.actualBenefit * WAN_TO_YUAN;
    return next;
  });
}
