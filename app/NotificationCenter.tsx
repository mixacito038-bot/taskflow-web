"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Bell, Check, CheckCheck, ChevronRight, CircleDollarSign, Database, FileClock, Search, ShieldAlert } from "lucide-react";
import { Hospital } from "./access-control-data";
import { PlatformNotification } from "./notification-data";

type NotificationFilter = "all" | "unread" | "action" | "system";

function categoryIcon(category: PlatformNotification["category"]) {
  if (category === "预警") return <AlertTriangle size={17} />;
  if (category === "待办") return <CircleDollarSign size={17} />;
  if (category === "数据") return <Database size={17} />;
  if (category === "安全") return <ShieldAlert size={17} />;
  return <Bell size={17} />;
}

export default function NotificationCenter({
  notifications,
  activeHospital,
  onMarkRead,
  onMarkAllRead,
  onOpen,
  initialSelectedId,
}: {
  notifications: PlatformNotification[];
  activeHospital: Hospital;
  onMarkRead: (id: string, read?: boolean) => void;
  onMarkAllRead: () => void;
  onOpen: (notification: PlatformNotification) => void;
  initialSelectedId?: string;
}) {
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? notifications[0]?.id ?? "");
  const unread = notifications.filter((item) => !item.read).length;
  const urgent = notifications.filter((item) => item.priority === "紧急" && !item.read).length;
  const actionable = notifications.filter((item) => item.target).length;

  const filtered = useMemo(() => notifications.filter((item) => {
    const text = `${item.title}${item.summary}${item.category}${item.source}`.toLowerCase();
    const matchesQuery = text.includes(query.trim().toLowerCase());
    if (!matchesQuery) return false;
    if (filter === "unread") return !item.read;
    if (filter === "action") return Boolean(item.target);
    if (filter === "system") return item.category === "系统" || item.category === "数据";
    return true;
  }), [filter, notifications, query]);

  const selected = notifications.find((item) => item.id === selectedId) ?? filtered[0] ?? notifications[0];

  return (
    <>
      <div className="page-heading notification-heading">
        <div><div className="eyebrow"><Bell size={15} />工作提醒与系统消息</div><h1>消息中心</h1><p>集中处理当前医院的效益预警、成本待办、数据质量、安全复核与系统通知。</p></div>
        <button className="secondary-button" onClick={onMarkAllRead} disabled={!unread}><CheckCheck size={17} />全部标为已读</button>
      </div>

      <section className="notification-kpis">
        <div><span>未读消息</span><strong>{unread}</strong><small>{activeHospital.shortName}与全平台消息</small></div>
        <div className={urgent ? "risk" : ""}><span>紧急事项</span><strong>{urgent}</strong><small>建议今天完成处理</small></div>
        <div><span>可处理事项</span><strong>{actionable}</strong><small>可直接跳转业务页面</small></div>
        <div><span>消息保留</span><strong>90 天</strong><small>安全审计按院内制度保留</small></div>
      </section>

      <section className="notification-workspace">
        <div className="notification-list-panel">
          <div className="notification-toolbar">
            <div className="notification-tabs">
              <button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>全部</button>
              <button className={filter === "unread" ? "active" : ""} onClick={() => setFilter("unread")}>未读 <i>{unread}</i></button>
              <button className={filter === "action" ? "active" : ""} onClick={() => setFilter("action")}>待处理</button>
              <button className={filter === "system" ? "active" : ""} onClick={() => setFilter("system")}>数据与系统</button>
            </div>
            <label className="notification-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、来源或类型" /></label>
          </div>
          <div className="notification-list">
            {filtered.map((item) => (
              <button key={item.id} className={`notification-row ${!item.read ? "unread" : ""} ${selected?.id === item.id ? "selected" : ""}`} onClick={() => { setSelectedId(item.id); onMarkRead(item.id); }}>
                <span className={`notification-category category-${item.category}`}>{categoryIcon(item.category)}</span>
                <span className="notification-row-copy"><span><strong>{item.title}</strong>{!item.read ? <i /> : null}</span><small>{item.summary}</small><em>{item.hospitalName} · {item.source}</em></span>
                <span className="notification-row-meta"><time>{item.timeLabel}</time><b className={`priority-${item.priority}`}>{item.priority}</b><ChevronRight size={15} /></span>
              </button>
            ))}
            {!filtered.length ? <div className="notification-empty"><Check size={25} /><strong>没有符合条件的消息</strong><span>可以切换筛选条件或清空搜索内容。</span></div> : null}
          </div>
        </div>

        <aside className="notification-detail-panel">
          {selected ? (
            <>
              <header><span className={`notification-category category-${selected.category}`}>{categoryIcon(selected.category)}</span><div><small>{selected.category} · {selected.priority}</small><h2>{selected.title}</h2></div></header>
              <div className="notification-detail-meta"><span>{selected.hospitalName}</span><span>{selected.source}</span><time>{selected.timeLabel}</time></div>
              <p>{selected.detail}</p>
              <section><strong>处理建议</strong><ul><li>先核对消息对应的数据范围和当前医院。</li><li>进入业务页面完成处理后，保留必要的责任人与结果记录。</li><li>涉及成本、权限或导出时按医院制度完成复核。</li></ul></section>
              <footer>
                <button className="secondary-button" onClick={() => onMarkRead(selected.id, !selected.read)}>{selected.read ? "标为未读" : "标为已读"}</button>
                {selected.target ? <button className="primary-button" onClick={() => onOpen(selected)}>{selected.actionLabel ?? "立即处理"}<ChevronRight size={16} /></button> : null}
              </footer>
            </>
          ) : <div className="notification-empty"><FileClock size={26} /><strong>选择一条消息查看详情</strong></div>}
        </aside>
      </section>
    </>
  );
}
