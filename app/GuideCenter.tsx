"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  CircleHelp,
  Clock3,
  Database,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LockKeyhole,
  MonitorPlay,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Workflow,
} from "lucide-react";

export type GuideTarget =
  | "cockpit"
  | "analysis"
  | "report"
  | "improvement"
  | "equipment"
  | "costs"
  | "layout"
  | "sources"
  | "access"
  | "messages";

export type GuideStatus = {
  deviceCount: number;
  connectedSources: number;
  totalSources: number;
  enabledProfiles: number;
  totalProfiles: number;
  costRecordCount: number;
  openActionCount: number;
};

type GuideProps = {
  currentRoleName: string;
  currentHospitalName: string;
  period: string;
  demoMode: boolean;
  originTarget: GuideTarget;
  availableTargets: GuideTarget[];
  status: GuideStatus;
  onNavigate: (target: GuideTarget) => void;
};

type RoleId = "leader" | "equipment" | "finance" | "department" | "it" | "admin";
type GuideTab = "start" | "flow" | "pages" | "demo" | "faq";

type GuideStep = {
  title: string;
  description: string;
  target: GuideTarget;
  outcome: string;
};

const roleRoutes: Array<{
  id: RoleId;
  name: string;
  mission: string;
  caution: string;
  steps: GuideStep[];
}> = [
  {
    id: "leader",
    name: "院领导",
    mission: "先看全院异常和资源配置，再看正式报告与整改闭环。",
    caution: "驾驶舱用于发现问题，不直接替代采购、停用或报废决策。",
    steps: [
      { title: "看全院经营概况", description: "切换期间与管理层视角，先看投资、收入、结余、使用率和可用率。", target: "cockpit", outcome: "识别本期需要追问的设备与科室" },
      { title: "核对报告证据", description: "查看数据质检、口径版本、报告状态和主要管理问题。", target: "report", outcome: "确认报告是否具备复核或签发条件" },
      { title: "追踪整改结果", description: "查看责任人、措施、期限、目标值和复评结果。", target: "improvement", outcome: "确认重大问题已经形成管理闭环" },
    ],
  },
  {
    id: "equipment",
    name: "设备科",
    mission: "先把设备主数据与运行事件对上，再解释低利用和高维修成本。",
    caution: "设备映射和停机记录未核对前，不应把结果直接用于正式评价。",
    steps: [
      { title: "核对设备台账", description: "检查资产编号、科室、原值、启用日期、位置和设备状态。", target: "equipment", outcome: "重点设备主数据完整且无重复" },
      { title: "核对采集证据链", description: "按品类查看来源、事件、质检、对账和指标配置。", target: "analysis", outcome: "设备事件能够关联到正确设备和服务记录" },
      { title: "处理异常设备", description: "把低利用、长停机或高维修成本转成责任行动。", target: "improvement", outcome: "问题有原因、责任人、期限和复评计划" },
      { title: "参与报告复核", description: "核对设备范围、保障指标和口径附录。", target: "report", outcome: "设备科意见已纳入报告版本" },
    ],
  },
  {
    id: "finance",
    name: "财务运营",
    mission: "完成收入、全成本、分摊和期间一致性核对。",
    caution: "财务数据按日或月结更新，不应与设备秒级运行状态混成一个“实时”口径。",
    steps: [
      { title: "归集成本", description: "录入人工、耗材、折旧、维修、能耗、空间和间接成本。", target: "costs", outcome: "成本带期间、对象、来源和责任部门" },
      { title: "核对来源与口径", description: "确认财务、资产、收费和物资来源及指标生效版本。", target: "sources", outcome: "收入、成本和会计期间一致" },
      { title: "复核效益报告", description: "检查净收入、全成本、结余、回本和差异说明。", target: "report", outcome: "重大差异有解释，报告可进入审核" },
    ],
  },
  {
    id: "department",
    name: "科室负责人",
    mission: "确认本科室工作量、使用时长和业务异常原因。",
    caution: "科室确认业务事实和原因，不直接修改财务结果或指标公式。",
    steps: [
      { title: "切换科室视角", description: "在驾驶舱筛选本科室，查看工作量、使用率、等待和保障情况。", target: "cockpit", outcome: "识别与现场认知不一致的指标" },
      { title: "处理待办消息", description: "打开需要确认的数据质量、成本或整改提醒。", target: "messages", outcome: "待确认事项均已响应或说明" },
      { title: "落实改进措施", description: "确认措施可执行，并填写责任人、期限和目标。", target: "improvement", outcome: "科室行动进入复评计划" },
    ],
  },
  {
    id: "it",
    name: "信息科",
    mission: "保证文件批次完整、字段映射正确、异常可追踪。",
    caution: "文件“解析成功”不等于数据“可用于核算”，还需完成匹配、质检、对账和审核发布。",
    steps: [
      { title: "准备来源文件", description: "登记设备、业务收入、成本、运行、保障和质量文件模板。", target: "sources", outcome: "责任人、更新频率和最近导入批次清楚" },
      { title: "验证导入与匹配", description: "查看设备绑定、最小事件集、完整率和对账容差。", target: "analysis", outcome: "阻断性映射和文件异常已分类" },
    ],
  },
  {
    id: "admin",
    name: "平台管理员",
    mission: "先建立医院和权限边界，再开放数据与功能。",
    caution: "登录身份、医院成员关系、角色权限和数据范围必须同时满足。",
    steps: [
      { title: "配置医院与成员", description: "建立医院、分配成员、角色和科室数据范围。", target: "access", outcome: "不同账号只进入授权医院与科室" },
      { title: "发布数据与指标规则", description: "配置数据来源、设备品类模板和指标口径。", target: "sources", outcome: "口径有负责人、版本和生效期" },
      { title: "配置展示布局", description: "按医院和管理角色调整驾驶舱模块与信息密度。", target: "layout", outcome: "首页聚焦当前医院的管理重点" },
    ],
  },
];

const monthlyFlow: Array<GuideStep & { owner: string }> = [
  { title: "准备来源文件", description: "完成本期 Excel、CSV 或 JSON 导入，记录来源、责任人和时间。", target: "sources", owner: "信息科", outcome: "关键文件已导入" },
  { title: "自动质检", description: "识别缺失、重复、未匹配、迟到和跨期数据。", target: "analysis", owner: "信息科 / 设备科", outcome: "异常已分类" },
  { title: "设备核对", description: "确认资产、设备事件和服务事件绑定关系。", target: "equipment", owner: "设备科", outcome: "设备映射可追溯" },
  { title: "收入成本归集", description: "核对退费、冲销、成本对象、分摊依据和会计期间。", target: "costs", owner: "财务运营", outcome: "收支期间一致" },
  { title: "专业复核", description: "核对使用率、可用率、服务量、结余和重大差异。", target: "cockpit", owner: "设备科 / 财务 / 科室", outcome: "重大差异有说明" },
  { title: "报告复核签发", description: "冻结设备范围、数据快照、口径版本和审核意见。", target: "report", owner: "编制 / 复核 / 签发人", outcome: "形成正式版本" },
  { title: "异常整改", description: "把低利用、高成本、长停机等问题转为责任行动。", target: "improvement", owner: "设备科 / 科室", outcome: "措施进入复评" },
  { title: "更正与留痕", description: "已发布数据不覆盖，按更正流程生成新版本并保留差异。", target: "report", owner: "授权复核人", outcome: "原版本永久保留" },
];

const pageGuides: Array<{
  target: GuideTarget;
  title: string;
  audience: string;
  problem: string;
  source: string;
  done: string;
}> = [
  { target: "cockpit", title: "效益驾驶舱", audience: "院领导、设备科、科室负责人", problem: "发现趋势、异常和需要决策的问题。", source: "设备台账、业务收入、全成本、运行事件和保障记录。", done: "已找到异常对象，并能继续下钻或转为行动。" },
  { target: "analysis", title: "采集与分析", audience: "信息科、设备科", problem: "证明数据从哪里来、如何绑定、质检和对账。", source: "数据源配置、设备品类模板、事件字段和阈值。", done: "阻断异常已关闭，或已在报告中披露影响。" },
  { target: "equipment", title: "设备台账", audience: "设备科、资产管理", problem: "建立所有分析的设备主键与生命周期基础。", source: "资产、合同、验收和院内设备档案。", done: "资产编号唯一，关键字段完整，变更有记录。" },
  { target: "costs", title: "成本填报", audience: "财务运营、设备科、科室", problem: "把人工、耗材、折旧、维修等成本归集到设备和期间。", source: "财务、物资、工单、能源和人工导出文件。", done: "成本对象、期间、金额、来源和分摊依据完整。" },
  { target: "sources", title: "文件来源与口径", audience: "信息科、财务、管理员", problem: "配置文件从哪里取得，以及指标如何计算。", source: "受控导出文件、字段字典、责任矩阵和指标版本。", done: "正式期间只使用已复核发布的文件与有效口径。" },
  { target: "report", title: "效益分析报告", audience: "编制人、复核人、院领导", problem: "把指定期间、数据与口径冻结成可复核的正式快照。", source: "设备、收入成本、质量、保障、采集规则和审核事件。", done: "阻断项清零，审核意见和版本状态完整。" },
  { target: "improvement", title: "运营改进中心", audience: "设备科、科室、运营部门", problem: "把异常转成有责任、有期限、有目标的行动。", source: "驾驶舱预警、单机分析和人工复核结论。", done: "措施包含原因、责任人、目标值、期限和复评结果。" },
  { target: "access", title: "医院与权限", audience: "平台管理员、医院管理员", problem: "确定谁能进入哪家医院、看到哪些科室并执行什么操作。", source: "登录身份、医院成员、角色权限和数据范围。", done: "最小权限生效，高风险操作有审计记录。" },
  { target: "messages", title: "消息中心", audience: "全部角色", problem: "集中处理数据质量、成本、效益、安全和系统提醒。", source: "业务规则、任务状态和系统事件。", done: "需要行动的消息已进入对应页面处理。" },
  { target: "layout", title: "驾驶舱配置", audience: "医院管理员", problem: "按医院管理重点调整模块、主题和信息密度。", source: "医院配置和账号显示偏好。", done: "首页只保留角色真正需要的管理信息。" },
];

const demoRoute = [
  { time: "0:00–0:30", title: "登录、医院与角色", target: "access" as GuideTarget, talk: "说明不同账号只进入被授权医院与科室；当前使用脱敏演示数据。" },
  { time: "0:30–1:30", title: "驾驶舱发现异常", target: "cockpit" as GuideTarget, talk: "展示投资、收入、结余、使用率、可用率，并点击一台异常设备。" },
  { time: "1:30–2:30", title: "采集与核对证据", target: "analysis" as GuideTarget, talk: "展示来源、设备绑定、完整率和对账容差，强调未匹配数据不进入正式结果。" },
  { time: "2:30–4:00", title: "生成并复核报告", target: "report" as GuideTarget, talk: "展示数据质检、版本状态、指标口径和 Word 导出。" },
  { time: "4:00–5:00", title: "形成改进闭环", target: "improvement" as GuideTarget, talk: "把低利用或高成本异常转为措施，设置责任人与复评日期。" },
];

const faqs = [
  ["为什么驾驶舱和业务或财务文件不一致？", "通常与统计期间、退费冲销、迟到文件、设备映射或月结状态有关。先进入数据准备中心查看批次、隔离区和对账结果，不直接手工调整驾驶舱结果。"],
  ["为什么某台设备没有效益数据？", "先检查资产编号、业务模板、最近发布版本，以及服务和收费记录能否关联到该设备。"],
  ["使用率到底怎么算？", "工作时长÷排班可服务时长、工作时长÷开机时长是不同指标。应查看当前指标的分子、分母、排除规则、版本和生效期。"],
  ["可以手工导入数据吗？", "可以，但应使用受控模板，记录来源、导入人、时间和核对结果。手工数据不能直接覆盖已冻结或已发布期间。"],
  ["设备结余为负是否意味着应该报废？", "不是。还需结合临床必要性、质量安全、设备年限、故障、服务能力和替代方案综合判断。"],
  ["为什么不同账号看到的数据不同？", "医院成员关系、角色权限和科室数据范围共同决定访问结果。若认为有误，请由管理员核对授权。"],
  ["本期文件缺失时还能生成报告吗？", "可以保存草稿，但必须显示数据不完整及影响范围；存在阻断性异常或未发布文件时不能签发正式报告。"],
  ["能录入患者姓名或病历详情吗？", "不能。效益分析只使用业务关联所需的脱敏标识或汇总数据，不在本平台保存患者身份和实时生理参数。"],
];

function inferRole(roleName: string): RoleId {
  if (/平台|管理员/.test(roleName)) return "admin";
  if (/信息/.test(roleName)) return "it";
  if (/财务|运营/.test(roleName)) return "finance";
  if (/科室|临床/.test(roleName)) return "department";
  if (/设备|医工|装备/.test(roleName)) return "equipment";
  return "leader";
}

function targetIcon(target: GuideTarget) {
  const props = { size: 18, "aria-hidden": true };
  if (target === "cockpit") return <LayoutDashboard {...props} />;
  if (target === "analysis") return <Activity {...props} />;
  if (target === "report") return <FileText {...props} />;
  if (target === "improvement") return <Target {...props} />;
  if (target === "equipment") return <FileSpreadsheet {...props} />;
  if (target === "costs") return <CircleDollarSign {...props} />;
  if (target === "layout") return <Settings2 {...props} />;
  if (target === "sources") return <Database {...props} />;
  if (target === "access") return <ShieldCheck {...props} />;
  return <Bell {...props} />;
}

export default function GuideCenter({
  currentRoleName,
  currentHospitalName,
  period,
  demoMode,
  originTarget,
  availableTargets,
  status,
  onNavigate,
}: GuideProps) {
  const [tab, setTab] = useState<GuideTab>("start");
  const [roleId, setRoleId] = useState<RoleId>(() => inferRole(currentRoleName));
  const [pageQuery, setPageQuery] = useState("");
  const available = useMemo(() => new Set(availableTargets), [availableTargets]);
  const selectedRole = roleRoutes.find((role) => role.id === roleId) ?? roleRoutes[0];
  const originGuide = pageGuides.find((page) => page.target === originTarget);

  const visiblePageGuides = pageGuides.filter((page) => {
    const query = pageQuery.trim().toLowerCase();
    return !query || `${page.title}${page.audience}${page.problem}`.toLowerCase().includes(query);
  });

  function openTarget(target: GuideTarget) {
    if (available.has(target)) onNavigate(target);
  }

  return (
    <main className="guide-center">
      <header className="guide-hero">
        <div>
          <span className="guide-eyebrow"><Sparkles size={15} />首次使用与日常操作</span>
          <h1>使用指南</h1>
          <p>不需要从头读说明书。选择你的岗位或要完成的工作，点击流程节点即可进入对应页面。</p>
          <div className="guide-context-tags">
            <span><Building2 size={14} />{currentHospitalName}</span>
            <span><Users size={14} />{currentRoleName}</span>
            <span><Clock3 size={14} />{period}</span>
            <span className={demoMode ? "demo" : "formal"}>{demoMode ? "演示数据" : "授权医院云数据"}</span>
          </div>
        </div>
        <div className="guide-hero-actions">
          <button className="primary-button" type="button" onClick={() => setTab("start")}><Route size={17} />按我的角色开始</button>
          <button className="secondary-button" type="button" onClick={() => setTab("demo")}><MonitorPlay size={17} />5 分钟演示路线</button>
        </div>
      </header>

      <section className="guide-readiness" aria-label="当前配置快照">
        <article><span><FileSpreadsheet size={19} /></span><div><strong>{status.deviceCount}</strong><small>台（套）设备已建档</small></div></article>
        <article><span><Database size={19} /></span><div><strong>{status.connectedSources}/{status.totalSources}</strong><small>来源文件模板已准备</small></div></article>
        <article><span><Workflow size={19} /></span><div><strong>{status.enabledProfiles}/{status.totalProfiles}</strong><small>品类规则显示已启用</small></div></article>
        <article><span><CircleDollarSign size={19} /></span><div><strong>{status.costRecordCount}</strong><small>条成本填报记录</small></div></article>
        <article><span><Target size={19} /></span><div><strong>{status.openActionCount}</strong><small>项改进任务未完成</small></div></article>
        <footer><CircleHelp size={15} />这里是配置与记录快照，不等于本月已经完成采集、对账、复核或签发。</footer>
      </section>

      {originGuide ? (
        <section className="guide-origin">
          <span>{targetIcon(originGuide.target)}</span>
          <div><small>你从“{originGuide.title}”进入</small><strong>{originGuide.problem}</strong><p>完成标志：{originGuide.done}</p></div>
          <button type="button" className="secondary-button" disabled={!available.has(originGuide.target)} onClick={() => openTarget(originGuide.target)}>返回该页面<ArrowRight size={15} /></button>
        </section>
      ) : null}

      <nav className="guide-tabs" role="tablist" aria-label="使用指南栏目">
        {([
          ["start", "按角色开始", Route],
          ["flow", "月度闭环", Workflow],
          ["pages", "页面说明", BookOpenCheck],
          ["demo", "演示路线", MonitorPlay],
          ["faq", "常见问题", CircleHelp],
        ] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon size={16} />{label}</button>
        ))}
      </nav>

      {tab === "start" ? (
        <section className="guide-section" id="guide-role-route">
          <div className="guide-section-heading">
            <div><span>角色路线</span><h2>我该先做什么</h2><p>系统已根据当前角色预选路线，也可以切换查看其他岗位如何协作。</p></div>
          </div>
          <div className="guide-role-picker" role="list" aria-label="选择使用角色">
            {roleRoutes.map((role) => <button key={role.id} type="button" className={role.id === roleId ? "active" : ""} onClick={() => setRoleId(role.id)}>{role.name}</button>)}
          </div>
          <div className="guide-role-summary">
            <span><Users size={20} /></span>
            <div><small>{selectedRole.name}的目标</small><strong>{selectedRole.mission}</strong><p>{selectedRole.caution}</p></div>
          </div>
          <div className="guide-route-grid">
            {selectedRole.steps.map((step, index) => {
              const allowed = available.has(step.target);
              return (
                <article key={`${selectedRole.id}-${step.title}`} className={!allowed ? "disabled" : ""}>
                  <header><i>{String(index + 1).padStart(2, "0")}</i><span>{targetIcon(step.target)}</span><em>{allowed ? "可进入" : "当前账号无权限"}</em></header>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                  <small><CheckCircle2 size={14} />完成标志：{step.outcome}</small>
                  <button type="button" disabled={!allowed} onClick={() => openTarget(step.target)}>进入页面<ArrowRight size={15} /></button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {tab === "flow" ? (
        <section className="guide-section">
          <div className="guide-section-heading">
            <div><span>医院月度闭环</span><h2>从数据到报告，再到整改复评</h2><p>节点按业务顺序排列；正式落地时，未通过前置校验的期间不能直接跳到正式签发。</p></div>
          </div>
          <div className="guide-monthly-flow" aria-label="医疗设备效益分析月度闭环流程图">
            {monthlyFlow.map((step, index) => {
              const allowed = available.has(step.target);
              return (
                <div className="guide-flow-wrap" key={step.title}>
                  <button type="button" className="guide-flow-node" disabled={!allowed} onClick={() => openTarget(step.target)}>
                    <span>{index + 1}</span>
                    <i>{targetIcon(step.target)}</i>
                    <strong>{step.title}</strong>
                    <small>{step.owner}</small>
                    <p>{step.description}</p>
                    <em>{allowed ? step.outcome : "当前角色不可进入此页面"}</em>
                  </button>
                  {index < monthlyFlow.length - 1 ? <ArrowRight className="guide-flow-arrow" size={18} aria-hidden="true" /> : null}
                </div>
              );
            })}
          </div>
          <aside className="guide-version-rule">
            <LockKeyhole size={20} />
            <div><strong>正式版本的更正规则</strong><p>已发布数据不直接覆盖。需要修改时提交更正原因，重新核对后生成新版本，并保留原版本、修改人、修改时间和差异。</p></div>
          </aside>
        </section>
      ) : null}

      {tab === "pages" ? (
        <section className="guide-section">
          <div className="guide-section-heading guide-pages-heading">
            <div><span>页面帮助</span><h2>每个页面解决什么问题</h2><p>先看“完成标志”，能最快判断这一步是否真的结束。</p></div>
            <label className="guide-search"><Search size={16} /><input value={pageQuery} onChange={(event) => setPageQuery(event.target.value)} placeholder="搜索页面、角色或任务" aria-label="搜索页面说明" /></label>
          </div>
          <div className="guide-page-grid">
            {visiblePageGuides.map((page) => {
              const allowed = available.has(page.target);
              return (
                <article key={page.target} className={!allowed ? "disabled" : ""}>
                  <header><span>{targetIcon(page.target)}</span><div><h3>{page.title}</h3><small>{page.audience}</small></div></header>
                  <dl>
                    <div><dt>解决什么问题</dt><dd>{page.problem}</dd></div>
                    <div><dt>数据从哪里来</dt><dd>{page.source}</dd></div>
                    <div><dt>完成标志</dt><dd>{page.done}</dd></div>
                  </dl>
                  <button type="button" disabled={!allowed} onClick={() => openTarget(page.target)}>{allowed ? "打开页面" : "当前账号无权限"}<ArrowRight size={15} /></button>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {tab === "demo" ? (
        <section className="guide-section">
          <div className="guide-section-heading">
            <div><span>现场演示脚本</span><h2>5 分钟讲清楚系统价值</h2><p>路线刻意控制在五个场景，先讲权限边界，再讲证据、报告和整改，不堆页面。</p></div>
          </div>
          <ol className="guide-demo-route">
            {demoRoute.map((step, index) => {
              const allowed = available.has(step.target);
              return (
                <li key={step.time}>
                  <span className="guide-demo-index">{index + 1}</span>
                  <time>{step.time}</time>
                  <div><strong>{step.title}</strong><p>{step.talk}</p></div>
                  <button type="button" disabled={!allowed} onClick={() => openTarget(step.target)}>去演示<ArrowRight size={15} /></button>
                </li>
              );
            })}
          </ol>
          <aside className="guide-demo-note">
            <ShieldCheck size={20} />
            <div><strong>演示前固定说明</strong><p>当前演示只使用脱敏样例；正式数据仅来自经过映射、清洗、对账和审核发布的 Excel、CSV 或 JSON 文件，不依赖 HIS、PACS 等在线接口。</p></div>
          </aside>
        </section>
      ) : null}

      {tab === "faq" ? (
        <section className="guide-section">
          <div className="guide-section-heading">
            <div><span>常见问题</span><h2>先处理最容易产生误解的问题</h2><p>涉及正式数据、口径或权限时，应以医院已发布规则和审计记录为准。</p></div>
          </div>
          <div className="guide-faq-list">
            {faqs.map(([question, answer], index) => (
              <details key={question} open={index === 0}>
                <summary>{question}<span>展开说明</span></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="guide-footer">
        <BarChart3 size={18} />
        <div><strong>判断顺序：先数据可信，再指标合理，最后才是结果好不好。</strong><p>如果页面上的结果无法追溯到数据来源、设备绑定、质检、对账和口径版本，就不应进入正式报告或管理决策。</p></div>
      </footer>
    </main>
  );
}
