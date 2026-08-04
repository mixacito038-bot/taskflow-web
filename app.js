/* TaskFlow AI 网页原型 — 数据层(localStorage) + NLP 解析 + 视图渲染 + 交互 + AI 设置 + 导出导入 */

// completedAt ISO 校验：前缀 + 可解析（防 "2026-08-03T垃圾" 混入；Invalid Date 静默漏计，review nit 加固）
const isValidISO = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(new Date(v).getTime());

// ============ 数据层 ============
const Store = {
  KEY: "taskflow.web.tasks",
  SETTINGS_KEY: "taskflow.web.settings",
  load() {
    try {
      const v = JSON.parse(localStorage.getItem(this.KEY));
      if (!Array.isArray(v)) return [];
      // 逐元素校验（localStorage 篡改/旧版本数据防白屏，security_review LOW）
      const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
      const seen = new Set();
      // 第一遍：合法 UUID 去重（旧数据非法 id 先保留）
      const deduped = v.filter(t => t && typeof t === "object" && typeof t.title === "string" && t.title.trim() !== "")
        .filter(t => { if (isUUID(t.id)) { if (seen.has(t.id)) return false; seen.add(t.id); } return true; });
      // 第二遍：非法/缺失 id 补新 UUID（不与已有冲突）
      return deduped.map(t => {
        if (isUUID(t.id)) return t;
        let id = crypto.randomUUID();
        while (seen.has(id)) id = crypto.randomUUID();
        seen.add(id);
        return { ...t, id };
      }).map(t => ({
          id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(t.id)) ? t.id : crypto.randomUUID(),
          title: t.title,
          notes: typeof t.notes === "string" ? t.notes : null,   // F-002 Markdown 备注（脏数据归 null）
          done: t.done === true,
          completedAt: isValidISO(t.completedAt) ? t.completedAt : null,   // ISO 校验（脏数据归 null → createdAt 兜底）
          priority: ["high","medium","low","none"].includes(t.priority) ? t.priority : "none",
          tags: Array.isArray(t.tags) ? t.tags.filter(x => typeof x === "string") : [],
          due: typeof t.due === "string" ? t.due : null,
          pinned: t.pinned === true,
          createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString(),
          list: typeof t.list === "string" ? t.list : null,
          sortOrder: Number.isFinite(t.sortOrder) ? t.sortOrder : 0,   // 与原生 Task.sortOrder 对齐（默认 0 → createdAt 兜底）
          reminder: Number.isFinite(t.reminder) ? t.reminder : null,
          recurrence: typeof t.recurrence === "string" ? t.recurrence : null,
          subtasks: normSubtasks(t.subtasks, 0),   // F-003 多层子任务（递归规范化，深度上限 32）
          checklist: Array.isArray(t.checklist) ? t.checklist.filter(x => x && typeof x.title === "string").map(x => ({ id: String(x.id || crypto.randomUUID()), title: x.title, done: x.done === true })) : []
        }));
    } catch { return []; }
  },
  save(tasks) { localStorage.setItem(this.KEY, JSON.stringify(tasks)); },
  loadSettings() {
    try { return JSON.parse(localStorage.getItem(this.SETTINGS_KEY)) || {}; } catch { return {}; }
  },
  saveSettings(s) { localStorage.setItem(this.SETTINGS_KEY, JSON.stringify(s)); }
};

let tasks = Store.load();
let settings = Store.loadSettings();
let currentView = "list";
let currentFilter = "";   // today / overdue / high
let editingId = null;     // 详情面板当前任务
let quickAddDue = null;   // 日历「该天添加」预置的日期（ISO），创建成功后清空

// 演示样例（首次启动注入，便于立即测试）
if (tasks.length === 0) {
  const now = new Date();
  const day = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return d.toISOString(); };
  const fmt = (d) => new Date(d).toISOString();
  tasks = [
    { id: crypto.randomUUID(), title: "准备季度汇报 PPT", done: false, priority: "high", tags: ["工作"],
      due: fmt(day(0)), pinned: true, createdAt: fmt(now) },
    { id: crypto.randomUUID(), title: "预约牙医复诊", done: false, priority: "medium", tags: ["健康"],
      due: fmt(day(-2)), pinned: false, createdAt: fmt(now) },
    { id: crypto.randomUUID(), title: "读完 DDIA 第 4 章", done: false, priority: "low", tags: ["学习"],
      due: fmt(day(3)), pinned: false, createdAt: fmt(now) },
    { id: crypto.randomUUID(), title: "给妈妈打电话", done: true, priority: "none", tags: ["生活"],
      due: fmt(day(0)), pinned: false, createdAt: fmt(now) },
    { id: crypto.randomUUID(), title: "整理本周聊天记录交给 AI 总结", done: false, priority: "none", tags: ["AI"],
      due: null, pinned: false, createdAt: fmt(now) }
  ];
  Store.save(tasks);
}

// ============ NLP 快速添加解析（对标 QuickAddParser 十条用例） ============
const NLP = {
  parse(text) {
    let remaining = text.trim();
    const result = { title: "", due: null, priority: "none", tags: [], list: null, reminder: null, recurrence: null };

    // 标签 #xxx
    result.tags = [...remaining.matchAll(/#([\p{L}\p{N}_\-]+)/gu)].map(m => m[1]);
    remaining = remaining.replace(/#[\p{L}\p{N}_\-]+/gu, " ");

    // 清单 !xxx
    const listM = remaining.match(/!([\p{L}\p{N}_\-]+)/u);
    if (listM) { result.list = listM[1]; remaining = remaining.replace(/![\p{L}\p{N}_\-]+/u, " "); }

    // 优先级（与 Swift 一致：仅高优先级/！触发，防"重要会议"误判）
    if (/高优先级|！/.test(remaining)) { result.priority = "high"; remaining = remaining.replace(/高优先级|！/g, " "); }
    else if (/中优先级/.test(remaining)) { result.priority = "medium"; remaining = remaining.replace(/中优先级/g, " "); }
    else if (/低优先级/.test(remaining)) { result.priority = "low"; remaining = remaining.replace(/低优先级/g, " "); }

    // 提醒提前 N 分钟/小时/天
    const remM = remaining.match(/提醒\s*提前\s*(\d+)\s*(分钟|小时|天)/);
    if (remM) {
      const unit = remM[2] === "小时" ? 60 : remM[2] === "天" ? 1440 : 1;
      result.reminder = Math.min(parseInt(remM[1]), 365 * 24 * 60) * unit;
      remaining = remaining.replace(/提醒\s*提前\s*\d+\s*(分钟|小时|天)/, " ");
    }

    // 重复规则
    const weeklyM = remaining.match(/每周([一二三四五六日天])/);
    if (weeklyM) { result.recurrence = "weekly:" + ("一二三四五六日天".indexOf(weeklyM[1]) + 1); }   // 括号防字符串拼接（NLP 对照测试暴露 weekly:21 bug）
    else if (/每周/.test(remaining)) { result.recurrence = "weekly"; remaining = remaining.replace(/每周/, " "); }
    else if (/每天|每日/.test(remaining)) { result.recurrence = "daily"; remaining = remaining.replace(/每天|每日/g, " "); }
    else {
      const monthlyM = remaining.match(/每月(?:的)?([\d、和号]+)/);
      if (monthlyM) {
        const days = [...monthlyM[1].matchAll(/\d+/g)].map(m => parseInt(m[0])).filter(d => d >= 1 && d <= 31);
        result.recurrence = "monthly:" + (days.length ? days.join(",") : "1");
        remaining = remaining.replace(monthlyM[0], " ");
      }
    }

    // 日期
    const now = new Date();
    let dayOffset = null;
    let m;
    if ((m = remaining.match(/(\d+)天后/))) { dayOffset = parseInt(m[1]); remaining = remaining.replace(/(\d+)天后/, " "); }
    else if (/大后天/.test(remaining)) { dayOffset = 3; remaining = remaining.replace(/大后天/, " "); }
    else if (/后天/.test(remaining)) { dayOffset = 2; remaining = remaining.replace(/后天/, " "); }
    else if (/明天|明日/.test(remaining)) { dayOffset = 1; remaining = remaining.replace(/明天|明日/, " "); }
    else if (/今天|今日/.test(remaining)) { dayOffset = 0; remaining = remaining.replace(/今天|今日/, " "); }

    const d = new Date(now);
    if (dayOffset !== null) { d.setDate(d.getDate() + dayOffset); d.setHours(9, 0, 0, 0); result.due = d.toISOString(); }

    // 下下周X / 下周X / 每周X / 周X
    const next2M = remaining.match(/下下(?:个)?周([一二三四五六日天])/);
    const nextM = remaining.match(/下(?:个)?周([一二三四五六日天])/);
    const wkM = remaining.match(/(?:这|本)?周([一二三四五六日天])/);
    if (next2M || nextM || (weeklyM && !nextM) || wkM) {
      const target = next2M || nextM || weeklyM || wkM;
      const iso = "一二三四五六日天".indexOf(target[1]) + 1;
      const today = new Date(); today.setHours(0,0,0,0);
      let delta = iso - (today.getDay() === 0 ? 7 : today.getDay());
      if (delta <= 0) delta += 7;
      // 下周一 = 即将到来的周一（与 Swift offsetWeeks:0 一致）；下下周X 额外 +7
      if (next2M) delta += 7;
      const wd = new Date(today); wd.setDate(wd.getDate() + delta);
      result.due = wd.toISOString();
      remaining = remaining.replace(target[0], " ");
    }

    // 月底
    if (!result.due && /月底/.test(remaining)) {
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      result.due = last.toISOString();
      remaining = remaining.replace(/月底(前)?/, " ");
    }

    // 时间点：下午3点 / 晚上8点 / 10:00 / 今晚
    let hm = null;
    const hmM = remaining.match(/(\d{1,2})[:：](\d{2})/);
    if (hmM) { hm = [parseInt(hmM[1]), parseInt(hmM[2])]; remaining = remaining.replace(hmM[0], " "); }
    else {
      const cnM = remaining.match(/(下午|晚上|中午|凌晨|早上|上午)?(\d{1,2})[点时](半)?/);
      if (cnM) {
        let h = parseInt(cnM[2]);
        if (cnM[1] === "下午" || cnM[1] === "晚上") h += 12;
        hm = [h % 24, cnM[3] ? 30 : 0];
        remaining = remaining.replace(cnM[0], " ");
      }
    }
    if (hm) {
      const base = result.due ? new Date(result.due) : new Date();
      base.setHours(hm[0], hm[1], 0, 0);
      result.due = base.toISOString();
    }
    if (!result.due && /今晚/.test(remaining)) {
      const t = new Date(); t.setHours(23, 59, 0, 0);
      result.due = t.toISOString();
      remaining = remaining.replace(/今晚/, " ");
    }

    result.title = remaining.replace(/\s+/g, " ").trim();
    return result;
  }
};

// ============ 工具 ============
// F-003 多层子任务：递归规范化（脏数据过滤 + 深度上限 32 对齐原生 deepCopySubtask 防御）
function normSubtasks(list, depth) {
  if (!Array.isArray(list) || depth > 32) return [];
  return list.filter(x => x && typeof x.title === "string" && x.title.trim() !== "").map(x => ({
    id: String(x.id || crypto.randomUUID()),
    title: x.title,
    done: x.done === true,
    subtasks: normSubtasks(x.subtasks, (depth || 0) + 1)
  }));
}
// F-003 递归统计子任务（总数/已完成数；父任务进度 = 子任务完成率，TC-0103）
function countSubtasks(list) {
  let total = 0, done = 0;
  const walk = (items) => {
    for (const s of items || []) { total++; if (s.done) done++; walk(s.subtasks); }
  };
  walk(list);
  return { total, done };
}
// F-003 按路径（数组下标链）查找子任务节点；返回 { parent, idx, node } 或 null
function findSubtaskByPath(t, path) {
  let arr = t.subtasks || [], parent = null, node = null, idx = -1;
  for (const seg of path) {
    if (!Number.isInteger(seg) || seg < 0 || !Array.isArray(arr) || seg >= arr.length) return null;   // NaN 段防御（review nit：仅手工篡改 DOM 可触发）
    parent = arr; idx = seg; node = arr[seg];
    arr = node.subtasks;
  }
  return { parent, idx, node };
}
const $id = (id) => document.getElementById(id);
const fmtDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso), now = new Date();
  const startToday = new Date(now); startToday.setHours(0,0,0,0);
  const startDue = new Date(d); startDue.setHours(0,0,0,0);
  const diff = Math.round((startDue - startToday) / 86400000);
  const hm = `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  if (diff === 0) return { text: `今天 ${hm}`, cls: "due-today" };
  if (diff === -1) return { text: `昨天 ${hm}`, cls: "due-over" };
  if (diff === 1) return { text: `明天 ${hm}`, cls: "" };
  if (diff < 0) return { text: `已逾期 ${-diff} 天`, cls: "due-over" };
  const names = ["周日","周一","周二","周三","周四","周五","周六"];
  return { text: `${names[startDue.getDay()]} ${hm}`, cls: "" };
};
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
// F-002 Markdown 备注渲染（零依赖、纯函数）：块级语法（标题/引用/列表）在 esc 前识别，
// 内容部分统一 esc 防 XSS 后再做行内解析
// 支持：标题 #/##、无序列表 -/*、有序列表 1.、引用 >、行内 `code`、**加粗**、*斜体*、[链接](url)、空行分段
function mdRender(src) {
  if (typeof src !== "string" || !src.trim()) return "";
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = String(src).split("\n");
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) { flush(); continue; }
    let m;
    if ((m = t.match(/^(#{1,2})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
    else if ((m = t.match(/^>\s?(.*)$/))) { flush(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); }
    else if ((m = t.match(/^[-*]\s+(.*)$/))) { flush(); out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = t.match(/^\d+\.\s+(.*)$/))) { flush(); out.push(`<li>${inline(m[1])}</li>`); }
    else para.push(t);
  }
  flush();
  return out.join("\n");
}
// 提醒单位友好显示（分钟→小时/天）
const fmtReminder = (min) => min % 1440 === 0 ? `${min / 1440} 天` : min % 60 === 0 ? `${min / 60} 小时` : `${min} 分钟`;
// 重复规则下次日期（weekly:N / daily / monthly:days），对标 Swift RecurrenceEngine 语义
// 提取为纯函数：TC-0111 完成时生成下一实例复用（nextOccurrenceDate + spawnNextInstance）
function nextOccurrenceDate(t) {
  if (!t.recurrence) return null;
  const base = t.due ? new Date(t.due) : new Date();
  const [kind, param] = t.recurrence.split(":");
  let next = null;
  if (kind === "daily") { next = new Date(base); next.setDate(next.getDate() + 1); }
  else if (kind === "weekly" && param) {
    const target = parseInt(param);
    next = new Date(base); next.setDate(next.getDate() + 1);
    let guard = 0;
    while (((next.getDay() + 6) % 7) + 1 !== target && guard++ < 8) next.setDate(next.getDate() + 1);
  } else if (kind === "weekly") { next = new Date(base); next.setDate(next.getDate() + 7); }
  else if (kind === "monthly") {
    const days = param ? param.split(",").map(Number) : [1];
    next = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    const dim = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    const day = days.filter(d => d <= dim).sort((a, b) => a - b)[0] || dim;
    next.setDate(day);
  }
  return next;
}
function nextOccurrenceText(t) {
  const next = nextOccurrenceDate(t);
  if (!next) return "";
  const names = ["日","一","二","三","四","五","六"];
  return ` · 下次 ${next.getMonth() + 1}/${next.getDate()} 周${names[next.getDay()]}`;
}
const isOverdue = (t) => t.due && !t.done && new Date(t.due) < new Date();
const isToday = (t) => t.due && new Date(t.due).toDateString() === new Date().toDateString();
// 今日待办计数（今天到期且未完成——"待办"口径，today 智能列表含已完成项；review nit 注释澄清）
function todayCount(items) {
  return items.filter(t => !t.done && isToday(t)).length;
}

// ============ 过滤 ============
function filteredTasks() {
  const q = $id("searchInput").value.trim().toLowerCase();
  const pri = $id("priorityFilter").value;
  const status = $id("statusFilter").value;
  return tasks.filter(t => {
    if (currentFilter === "today" && !isToday(t)) return false;
    if (currentFilter === "overdue" && !isOverdue(t)) return false;
    if (currentFilter === "high" && t.priority !== "high") return false;
    if (pri && t.priority !== pri) return false;
    if (status === "done" && !t.done) return false;
    if (status === "active" && t.done) return false;
    if (q && !(t.title + " " + t.tags.join(" ")).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (b.pinned - a.pinned) || (a.done - b.done) || (a.sortOrder - b.sortOrder) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}
// ============ 列表手动排序（拖拽；对齐原生 TaskStore.move 整列表重写 sortOrder 语义） ============
function applyManualSort(movedId, beforeId) {
  const visible = filteredTasks();
  const fromIdx = visible.findIndex(t => t.id === movedId);
  if (fromIdx < 0 || beforeId === movedId) return false;
  const visibleIds = new Set(visible.map(t => t.id));
  // 被过滤/搜索隐藏的任务保持相对顺序追加在末尾（不参与本次拖拽）
  const rest = tasks.filter(t => !visibleIds.has(t.id))
    .sort((a, b) => (a.sortOrder - b.sortOrder) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const list = [...visible];
  const [moved] = list.splice(fromIdx, 1);
  const toIdx = beforeId ? list.findIndex(t => t.id === beforeId) : list.length;
  if (toIdx < 0) return false;
  list.splice(toIdx, 0, moved);   // 插入到目标卡片之前
  // 整列表重写 sortOrder = index（与原生 move 一致；避免默认 0 与手动序冲突）
  [...list, ...rest].forEach((t, i) => {
    const real = tasks.find(x => x.id === t.id);
    if (real) real.sortOrder = i;
  });
  Store.save(tasks);
  return true;
}

function wireListSort() {
  const container = $id("viewContainer");
  container.querySelectorAll(".task-card").forEach(card => {
    card.draggable = true;
    card.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", card.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      container.querySelectorAll(".drop-target").forEach(c => c.classList.remove("drop-target"));
    });
  });
  // container 级监听只绑一次（render 重渲染不累积；卡片监听随 innerHTML 重建自然销毁）
  if (!container.dataset.sortBound) {
    container.dataset.sortBound = "1";
    container.addEventListener("dragover", e => {
      if (currentView !== "list") return;
      e.preventDefault();
      // 落点占位：目标卡片虚线框（每次 dragover 先清理再标记，防残留）
      const el = e.target.closest(".task-card");
      container.querySelectorAll(".drop-target").forEach(c => { if (c !== el) c.classList.remove("drop-target"); });
      if (el && !el.classList.contains("dragging")) el.classList.add("drop-target");
    });
    container.addEventListener("drop", e => {
      // 仅列表视图响应；看板拖拽的 drop 冒泡到容器时静默跳过（review blocking 修复：
      // 否则 board 拖拽会误触发 applyManualSort 重写全部 sortOrder）
      if (currentView !== "list") return;
      e.preventDefault();
      container.querySelectorAll(".drop-target").forEach(c => c.classList.remove("drop-target"));
      container.querySelectorAll(".dragging").forEach(c => c.classList.remove("dragging"));   // 兜底清理（review minor：drop 后不依赖 dragend 保证）
      const id = e.dataTransfer.getData("text/plain");
      if (!id) return;
      const beforeEl = e.target.closest(".task-card");
      const beforeId = beforeEl ? beforeEl.dataset.id : null;
      if (applyManualSort(id, beforeId)) render();
    });
  }
}

// ============ 视图渲染 ============
function taskCardHTML(t) {
  const due = fmtDate(t.due);
  const priClass = t.priority === "high" ? "h" : t.priority === "medium" ? "m" : t.priority === "low" ? "l" : "";
  const tagClsMap = Object.assign(Object.create(null), { "工作":"t-blue", "健康":"t-red", "学习":"t-teal", "AI":"t-violet" });
  const tagCls = t.tags[0] && Object.prototype.hasOwnProperty.call(tagClsMap, t.tags[0]) ? tagClsMap[t.tags[0]] : "";
  return `<div class="task-card ${tagCls}" data-id="${esc(t.id)}" data-action="detail">
    <div class="task-check ${t.done ? "done" : ""}" data-action="toggle">${t.done ? "✓" : ""}</div>
    <div class="task-body">
      <div class="task-title ${t.done ? "done" : ""}">${t.pinned ? '<span class="pinned">📌</span>' : ""}${esc(t.title)}</div>
      <div class="task-meta">
        ${t.tags.map(tag => `<span class="tag-pill">${esc(tag)}</span>`).join("")}
        ${due ? `<span class="${due.cls}">🗓 ${due.text}</span>` : ""}
        ${t.recurrence ? `<span>🔁 重复${nextOccurrenceText(t)}</span>` : ""}
        ${t.reminder ? `<span>🔔 提前 ${fmtReminder(t.reminder)}</span>` : ""}
        ${(t.checklist || []).length ? `<span>☑ ${t.checklist.filter(c => c.done).length}/${t.checklist.length}</span>` : ""}
        ${(t.subtasks || []).length ? (() => { const c = countSubtasks(t.subtasks); return `<span>▣ 子任务 ${c.done}/${c.total}</span>`; })() : ""}
        ${t.notes ? `<span>📝 备注</span>` : ""}
      </div>
    </div>
    ${priClass ? `<div class="pri-dot ${priClass}"></div>` : ""}
  </div>`;
}

// 空态引导组件（emoji + 主文案 + 操作提示；统一各视图无数据时的首次使用引导）
function emptyHint(emoji, title, tip) {
  return `<div class="empty-state"><div class="big">${emoji}</div>${esc(title)}<br><span class="hint-text">${esc(tip)}</span></div>`;
}

// 顶栏今日待办徽标（render 时刷新；点击切到 today 智能列表）
function updateTodayBadge() {
  const n = todayCount(tasks);
  $id("todayBadge").textContent = `⏰ 今天 ${n}`;
  $id("todayBadge").title = n ? `今天还有 ${n} 项待办（点击查看）` : "今天没有到期任务（点击查看今天）";
}
function goTodayFilter() {
  currentView = "list";
  currentFilter = "today";
  document.querySelectorAll(".side-item[data-view]").forEach(x => x.classList.remove("active"));
  document.querySelector(".side-item[data-view='list']")?.classList.add("active");
  document.querySelectorAll(".side-filter").forEach(x => x.classList.remove("active"));
  document.querySelector(".side-filter[data-filter='today']")?.classList.add("active");
  render();
}

// 清除已完成任务（确认式；原地修改保持引用稳定；无 done 时按钮隐藏）
function clearCompleted() {
  const doneCount = tasks.filter(t => t.done).length;
  if (!doneCount) return;
  if (!confirm(`确定清除 ${doneCount} 个已完成任务？此操作不可撤销`)) return;
  tasks.splice(0, tasks.length, ...tasks.filter(t => !t.done));
  Store.save(tasks);
  render();
}
function updateClearBtn() {
  const n = tasks.filter(t => t.done).length;
  const btn = $id("clearDoneBtn");
  if (!btn) return;   // null 保护：按钮缺失时不中断渲染（review nit）
  btn.hidden = n === 0;
  if (n) btn.textContent = `🧹 清除已完成 (${n})`;
}

function render() {
  updateTodayBadge();   // 徽标随任何渲染刷新（任务增删/完成/视图切换）
  updateClearBtn();     // 清除按钮随渲染刷新（done 数量/可见性）
  const container = $id("viewContainer");
  const list = filteredTasks();

  if (currentView === "list") {
    if (list.length === 0) {
      container.innerHTML = emptyHint("📋", "没有任务", "按 n 或点「＋ 新建任务」，试试 NLP：明天下午3点 高优先级 买牛奶 #生活");
    } else {
      const pinned = list.filter(t => t.pinned);
      const rest = list.filter(t => !t.pinned);
      container.innerHTML =
        (pinned.length ? `<div class="side-group" style="margin:0 4px 8px">📌 置顶</div>${pinned.map(taskCardHTML).join("")}` : "") +
        rest.map(taskCardHTML).join("");
      wireListSort();   // 拖拽排序（卡片 draggable + 容器 drop）
    }
  } else if (currentView === "board") {
    if (list.length === 0) {
      container.innerHTML = emptyHint("📊", "看板还没有任务", "创建任务后可按状态/清单/标签分组查看（按 n 快速添加）");
      return;
    }
    // A4: 分组模式（状态/清单/标签）——看板工具栏选择
    const boardGroup = settings.boardGroup || "status";
    const chips = [["status","按状态"],["list","按清单"],["tag","按标签"]]
      .map(([k, label]) => `<button class="btn ${boardGroup === k ? "active" : ""}" data-action="boardGroup" data-g="${k}">${label}</button>`).join("");
    const cols = boardColumns(list, boardGroup);
    container.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:10px">${chips}</div><div class="board">${cols.map(col => `
      <div class="board-col"><h4 data-col="${esc(col.name)}">${esc(col.name)}<span class="n">${col.tasks.length}</span></h4>
      ${col.tasks.map(t => `
        <div class="board-card" draggable="true" data-id="${esc(t.id)}" data-action="detail">
          <div class="board-card-title">${esc(t.title)}</div>
          ${t.due ? `<div class="board-card-meta">🗓 ${esc(fmtDate(t.due).text)}</div>` : ""}
          ${t.priority !== "none" ? `<div class="pri-dot ${t.priority[0]}"></div>` : ""}
        </div>`).join("")}
      </div>`).join("")}</div>`;
    wireBoardDrag(boardGroup);
  } else if (currentView === "calendar") {
    renderCalendar();
  } else if (currentView === "stats") {
    renderStats();
  } else if (currentView === "matrix") {
    if (list.length === 0) {   // 与看板空态同口径（当前视图结果为空即提示，review nit 统一）
      container.innerHTML = emptyHint("🧭", "四象限还没有任务", "创建任务后按「紧急（今天到期/逾期）× 重要（高/中优先级）」自动归类");
      return;
    }
    renderMatrix(list);
  } else if (currentView === "habits") {
    renderHabits();
  } else if (currentView === "pomodoro") {
    renderPomodoro();
  } else if (currentView === "templates") {
    renderTemplates();
  }
}

// A4: 看板列构造（状态/清单/标签分组）
function boardColumns(list, group) {
  if (group === "list") {
    const byList = Object.create(null);
    list.forEach(t => { const k = t.list || "未分组"; (byList[k] = byList[k] || []).push(t); });
    return Object.entries(byList).map(([name, tasks]) => ({ name, tasks }));
  }
  if (group === "tag") {
    const byTag = Object.assign(Object.create(null), { "未标签": [] });
    list.forEach(t => {
      if (!t.tags || !t.tags.length) { byTag["未标签"].push(t); return; }
      t.tags.forEach(tag => { (byTag[tag] = byTag[tag] || []).push(t); });
    });
    return Object.entries(byTag).map(([name, tasks]) => ({ name, tasks }));
  }
  return [
    { name: "待办", tasks: list.filter(t => !t.done) },
    { name: "已完成", tasks: list.filter(t => t.done) }
  ];
}

// 看板拖拽（按分组模式处理落列：状态→完成切换；清单/标签→移动分组）
function wireBoardDrag(group) {
  document.querySelectorAll(".board-card").forEach(card => {
    card.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", card.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");   // 拖拽中视觉态（半透明+微缩）
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      document.querySelectorAll(".board-col.drag-over").forEach(c => c.classList.remove("drag-over"));
    });
  });
  document.querySelectorAll(".board-col").forEach(col => {
    col.addEventListener("dragover", e => {
      e.preventDefault();
      col.classList.add("drag-over");   // 列悬停高亮
    });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", e => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain");
      const task = tasks.find(t => t.id === id);
      if (!task) return;
      const colName = col.querySelector("h4").dataset.col ?? col.querySelector("h4").textContent.replace(/\s*\d+$/, "").trim();
      if (group === "status") {
        // 与 toggleDone 同一入口（review should-fix：此前直接改 done 漏维护 completedAt，趋势落桶不一致）
        setTaskDone(task.id, colName === "已完成");
      } else if (group === "list") {
        task.list = colName === "未分组" ? null : colName;
      } else if (group === "tag") {
        task.tags = task.tags || [];
        if (colName === "未标签") { task.tags = []; }
        else if (colName && !task.tags.includes(colName)) { task.tags.push(colName); }
      }
      Store.save(tasks); render();
    });
  });
}

// 日历
let calCursor = new Date();
function renderCalendar() {
  const year = calCursor.getFullYear(), month = calCursor.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;  // 周一起
  let cells = "";
  for (let i = 0; i < lead; i++) cells += `<div class="day other"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const isToday = date.toDateString() === new Date().toDateString();
    const dayTasks = tasks.filter(t => t.due && new Date(t.due).toDateString() === date.toDateString());
    cells += `<div class="day ${isToday ? "today" : ""}" data-iso="${esc(date.toISOString())}">${d}${dayTasks.length ? '<span class="evt"></span>' : ""}</div>`;
  }
  containerHTML(`<div class="calendar">
    <div class="cal-head"><button class="btn ghost" data-action="calShift" data-d="-1">‹</button>${year} 年 ${month + 1} 月<button class="btn ghost" data-action="calShift" data-d="1">›</button></div>
    <div class="cal-grid">${["一","二","三","四","五","六","日"].map(x => `<div class="dow">${x}</div>`).join("")}${cells}</div>
    <div class="day-tasks" id="dayTasks"></div>
  </div>`);
}
function calShift(delta) { calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + delta, 1); render(); }
function showDayTasks(iso) {
  const date = new Date(iso);
  const dayTasks = tasks.filter(t => t.due && new Date(t.due).toDateString() === date.toDateString());
  $id("dayTasks").innerHTML =
    `<div class="day-tasks-head"><b>${esc(date.toDateString())}</b><button class="btn ghost" data-action="quickAddDay" data-iso="${esc(iso)}">＋ 该天添加</button></div>` +
    (dayTasks.length
      ? dayTasks.map(t => taskCardHTML(t)).join("")
      : `<div class="hint-text">无任务</div>`);
}
function containerHTML(html) { $id("viewContainer").innerHTML = html; }

// 统计
// 完成趋势（对齐原生 StatsAggregator：按 completedAt 完成日落桶；旧数据无 completedAt 时以 createdAt 兜底）
function computeTrend(mode) {
  const when = (t) => t.completedAt || t.createdAt;
  if (mode === "4w") {
    const weeks = [];
    for (let i = 3; i >= 0; i--) {
      const start = new Date();
      start.setDate(start.getDate() - (i + 1) * 7);
      const from = start.getTime(), to = start.getTime() + 7 * 86400000 + 1000;   // +1s 容差：右边界恰为 now 时排除"此刻完成"的任务（真实边界 bug）
      weeks.push({ label: `${start.getMonth()+1}/${start.getDate()}`, n: tasks.filter(t => t.done && when(t) && new Date(when(t)).getTime() >= from && new Date(when(t)).getTime() < to).length });
    }
    return weeks;
  }
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    trend.push({ label: `${d.getMonth()+1}/${d.getDate()}`, n: tasks.filter(t => t.done && when(t) && new Date(when(t)).toDateString() === d.toDateString()).length });
  }
  return trend;
}

// 本周完成率（对齐原生 StatsAggregator.completionRate：completedAt 落本周为分子 / due 落本周为分母；
// 分母为空为 0；周一起。webapp 分子对旧数据以 createdAt 兜底——与 computeTrend 同口径）
function computeWeekRate() {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));   // 周一 = 本周起点
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart.getTime() + 7 * 86400000);
  const inWeek = (v) => { const t = new Date(v).getTime(); return t >= weekStart.getTime() && t < weekEnd.getTime(); };
  const due = tasks.filter(t => t.due && inWeek(t.due)).length;
  if (!due) return { rate: 0, completed: 0, due: 0 };
  const completed = tasks.filter(t => t.done && (t.completedAt || t.createdAt) && inWeek(t.completedAt || t.createdAt)).length;
  return { rate: Math.floor(completed / due * 100), completed, due };   // Math.floor 对齐原生 Int() 截断（review warn）
}

// 统计快照导出（文本格式，可存档/分享；对齐 renderStats 口径）
function exportStatsText() {
  const total = tasks.length, done = tasks.filter(t => t.done).length;
  const rate = total ? Math.round(done / total * 100) : 0;
  const wk = computeWeekRate();
  const overdue = tasks.filter(isOverdue).length;
  const trend7 = computeTrend("7d").map(x => `${x.label}:${x.n}`).join(" ");
  const pri = Object.assign(Object.create(null), { high: 0, medium: 0, low: 0, none: 0 });
  tasks.forEach(t => { if (["high","medium","low","none"].includes(t.priority)) pri[t.priority]++; });
  const tagCount = Object.create(null);
  tasks.forEach(t => t.tags.forEach(tag => tagCount[tag] = (tagCount[tag] || 0) + 1));
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([n, c]) => `${n}(${c})`).join("、") || "无";
  return [
    `TaskFlow 统计快照 ${new Date().toLocaleString("zh-CN")}`,
    `任务总数：${total}（完成 ${done}，完成率 ${rate}%）`,
    `本周完成率：${wk.rate}%（本周完成 ${wk.completed} / 本周到期 ${wk.due}）`,
    `逾期未完成：${overdue}`,
    `近7天完成趋势：${trend7}`,   // 固定 7d（页面可切 4w，导出保持简版）
    `优先级分布：高 ${pri.high} / 中 ${pri.medium} / 低 ${pri.low} / 无 ${pri.none}`,
    `标签 Top5：${topTags}`,
  ].join("\n");
}
// 统一下载入口（append→click→remove→延迟 revoke；防部分浏览器不触发与下载竞态，review 统一）
function downloadBlob(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadStats() {
  downloadBlob(exportStatsText(), `taskflow-stats-${new Date().toISOString().slice(0, 10)}.txt`, "text/plain;charset=utf-8");
}

function renderStats() {
  const total = tasks.length, done = tasks.filter(t => t.done).length;
  const rate = total ? Math.round(done / total * 100) : 0;
  const pri = Object.assign(Object.create(null), { high: 0, medium: 0, low: 0, none: 0 });
  tasks.forEach(t => { if (["high","medium","low","none"].includes(t.priority)) pri[t.priority]++; });
  const tagCount = Object.create(null);
  tasks.forEach(t => t.tags.forEach(tag => tagCount[tag] = (tagCount[tag] || 0) + 1));
  const topTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxTag = topTags.length ? topTags[0][1] : 1;
  // 逾期统计
  const overdueCount = tasks.filter(isOverdue).length;
  // 周/月趋势（工具栏切换；按 completedAt 落桶，对齐原生 StatsAggregator）
  const trendMode = settings.trendMode || "7d";
  const trendData = computeTrend(trendMode);
  const trendMax = Math.max(1, ...trendData.map(x => x.n));
  const trendToggle = [["7d","近7天"],["4w","近4周"]].map(([k,label]) => `<button class="btn ${trendMode===k?"active":""}" data-action="trendMode" data-g="${k}" style="font-size:11px;padding:4px 10px">${label}</button>`).join("");
  const wk = computeWeekRate();   // 本周完成率（对齐原生 completionRate 口径）
  containerHTML(`<div class="stats">
    ${total === 0 ? `<div class="hint-text" style="margin-bottom:8px">还没有任务——创建后这里会展示完成率、趋势与分布（按 n 快速添加）</div>` : ""}
    <div style="display:flex;justify-content:flex-end;margin-bottom:6px"><button class="btn" data-action="exportStats" style="font-size:11px;padding:4px 10px">📋 导出统计</button></div>
    <div class="stat-card"><h4>完成率</h4><div class="stat-big">${rate}%</div><div style="font-size:12px;color:var(--ink3)">${done}/${total} 任务 · 逾期 ${overdueCount} 项</div></div>
    <div class="stat-card"><h4>本周完成率</h4><div class="stat-big">${wk.rate}%</div><div style="font-size:12px;color:var(--ink3)">本周完成 ${wk.completed} / 本周到期 ${wk.due}</div></div>
    <div class="stat-card"><h4>完成趋势</h4><div style="display:flex;gap:4px;margin-bottom:6px">${trendToggle}</div><div class="trend">${trendData.map(x => `<div class="bar" style="height:${Math.max(4, x.n / trendMax * 100)}%" title="${x.label}: ${x.n}"></div>`).join("")}</div><div style="font-size:10px;color:var(--ink3)">${trendData.map(x => x.label).join(" ")}</div></div>
    <div class="stat-card"><h4>优先级分布</h4>
      ${[["high","高",pri.high],["medium","中",pri.medium],["low","低",pri.low],["none","无",pri.none]].map(([k,l,v]) => `
        <div class="bar-row"><span style="width:26px">${l}</span><div class="bar-track"><div class="bar-fill" style="width:${total ? v / total * 100 : 0}%"></div></div><span>${v}</span></div>`).join("")}
    </div>
    <div class="stat-card"><h4>标签 Top5</h4>
      ${topTags.length ? topTags.map(([name, n]) => `
        <div class="bar-row"><span style="width:60px">${esc(name)}</span><div class="bar-track"><div class="bar-fill" style="width:${n / maxTag * 100}%"></div></div><span>${n}</span></div>`).join("") : "暂无标签"}
    </div>
  </div>`);
}

// ============ 交互 ============
// 完成状态变更单一入口：维护 completedAt（对齐原生 StatsAggregator 完成日落桶）；
// 幂等（done 未变化时不动 completedAt）。调用方负责 Store.save + render。
function setTaskDone(id, done) {
  const t = tasks.find(x => x.id === id);
  if (!t || t.done === done) return;
  t.done = done;
  t.completedAt = done ? new Date().toISOString() : null;
}
// 完成重复任务时生成下一实例（TC-0111：完成后生成下一实例且"仅本次"可选）
// 复制原任务全部字段，仅 done/completedAt/createdAt/due 变化；规则结束（nextOccurrenceDate 返回 null）不生成
function spawnNextInstance(t) {
  const next = nextOccurrenceDate(t);
  if (!next) return;
  tasks.push({
    id: crypto.randomUUID(),
    title: t.title,
    notes: typeof t.notes === "string" ? t.notes : null,   // F-002 备注随重复实例复制
    done: false,
    completedAt: null,
    priority: t.priority,
    tags: Array.isArray(t.tags) ? [...t.tags] : [],
    due: next.toISOString(),
    pinned: t.pinned,
    createdAt: new Date().toISOString(),
    list: t.list,
    sortOrder: t.sortOrder,
    reminder: t.reminder,
    recurrence: t.recurrence,
    subtasks: normSubtasks(t.subtasks, 0),   // F-003 多层子任务递归深拷贝（复用规范化，含子级结构）
    checklist: Array.isArray(t.checklist) ? t.checklist.map(x => ({ ...x })) : []
  });
}
// 详情面板"仅本次"勾选状态（标记完成时跳过生成下一实例；打开详情时重置）
let onlyThisTime = false;
// 备注编辑态（F-002：打开详情重置，保存/取消退出）
let editingNotes = false;
function toggleDone(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const wasDone = t.done;
  setTaskDone(id, !t.done);
  // 从未完成→完成 且 有重复规则 且 未勾选"仅本次" → 生成下一实例（TC-0111）
  if (!wasDone && t.recurrence && !onlyThisTime) spawnNextInstance(t);
  onlyThisTime = false;   // 一次性消费（review：防残留影响后续完成）
  Store.save(tasks); render();
  if (editingId === id) openDetail(id);
}

// F-003 多层子任务递归渲染：path 为索引路径（如 [0,1] 表示第 2 层的第 2 项）；缩进随层级递增；
// 有子级的节点显示折叠箭头（collapsedPaths 记录已折叠路径）；每项提供「＋ 子级」就地添加子任务
let collapsedPaths = new Set();   // 折叠的子任务路径（"0,1" 格式；打开详情时重置）
function renderSubtasks(list, path) {
  if (!Array.isArray(list) || !list.length) return '<span class="hint-text">暂无子任务</span>';
  return list.map((st, i) => {
    const p = path.concat(i);
    const key = p.join(",");
    const hasKids = Array.isArray(st.subtasks) && st.subtasks.length > 0;
    const collapsed = collapsedPaths.has(key);
    return `
      <div class="detail-check" style="padding-left:${path.length * 18}px">
        ${hasKids ? `<button class="btn ghost" style="font-size:10px;padding:0 4px" data-action="collapseSubtask" data-spath="${key}">${collapsed ? "▸" : "▾"}</button>` : '<span style="width:18px"></span>'}
        <input type="checkbox" ${st.done ? "checked" : ""} data-action="toggleSubtask" data-spath="${key}">
        <span style="${st.done ? "text-decoration:line-through;color:var(--ink3)" : ""}">${esc(st.title)}</span>
        ${hasKids ? `<span style="font-size:10px;color:var(--ink3)">(${countSubtasks(st.subtasks).done}/${countSubtasks(st.subtasks).total})</span>` : ""}
        <button class="btn ghost" style="margin-left:auto;font-size:10px" data-action="addSubtaskTo" data-spath="${key}">＋</button>
        <button class="btn ghost" style="font-size:10px" data-action="delSubtask" data-spath="${key}">✕</button>
      </div>
      ${collapsed ? "" : (Array.isArray(st.subtasks) && st.subtasks.length ? renderSubtasks(st.subtasks, p) : "")}
    `;
  }).join("");
}
// Quick Add
function openQuickAdd() {
  quickAddDue = null;   // 普通入口不带预置日期
  $id("quickAddOverlay").classList.remove("hidden");
  $id("qaInput").value = "";
  $id("qaParsed").innerHTML = "";
  $id("qaInput").placeholder = '试试：「明天下午3点 高优先级 买牛奶 #生活」或「每周三晚上8点 健身」';
  setTimeout(() => $id("qaInput").focus(), 50);
}
function openQuickAddFor(iso) {   // 日历「该天添加」：预置日期，NLP 未写日期时落到该天
  quickAddDue = iso;
  $id("quickAddOverlay").classList.remove("hidden");
  $id("qaInput").value = "";
  $id("qaParsed").innerHTML = "";
  $id("qaInput").placeholder = `为该天（${new Date(iso).toDateString()}）添加任务，可直接输入 NLP 语法（写了日期以输入为准）`;
  setTimeout(() => $id("qaInput").focus(), 50);
}
function qaParsePreview() {
  const text = $id("qaInput").value;
  if (!text.trim()) { $id("qaParsed").innerHTML = ""; return; }
  const p = NLP.parse(text);
  const chips = [];
  if (p.due) chips.push(`🗓 ${new Date(p.due).toLocaleString("zh-CN", { month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit" })}`);
  if (p.priority !== "none") chips.push(`⚑ ${({ high:"高", medium:"中", low:"低" }[p.priority] || p.priority)}优先级`);
  p.tags.forEach(t => chips.push(`#${esc(t)}`));
  if (p.list) chips.push(`!${esc(p.list)}`);
  if (p.reminder) chips.push(`🔔 提前 ${p.reminder} 分钟`);
  if (p.recurrence) chips.push(`🔁 重复`);
  $id("qaParsed").innerHTML = chips.map(c => `<span class="tag-pill">${c}</span>`).join("") || `<span class="hint-text">标题：${esc(p.title)}</span>`;
}
function qaCreate() {
  const text = $id("qaInput").value;
  if (!text.trim()) return;
  const lines = text.split("\n").map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    const p = NLP.parse(line);
    if (!p.title) continue;
    // 日历「该天添加」预置日期兜底：NLP 未解析出日期才使用（用户显式写的日期优先）
    if (quickAddDue && !p.due) p.due = quickAddDue;
    tasks.push({
      id: crypto.randomUUID(), title: p.title, done: false, priority: p.priority,
      tags: p.tags, due: p.due, pinned: false, createdAt: new Date().toISOString(),
      list: p.list, reminder: p.reminder, recurrence: p.recurrence, notes: null,
      subtasks: [], checklist: []
    });
  }
  Store.save(tasks);
  quickAddDue = null;   // 预置日期一次性使用
  $id("quickAddOverlay").classList.add("hidden");
  render();
}

// 详情
function openDetail(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  if (editingId !== id) { editingNotes = false; collapsedPaths = new Set(); }   // 切换任务时重置备注编辑态与子任务折叠态；同任务内保留（review：此前无条件重置使 editNotes/collapse 失效）
  editingId = id;
  onlyThisTime = false;   // 每次打开详情重置"仅本次"（防残留影响后续完成，review）
  const due = fmtDate(t.due);
  $id("detailBody").innerHTML = `
    <div style="font-size:16px;font-weight:700;margin-bottom:10px">${esc(t.title)}</div>
    <div class="detail-row">🗓 截止日期<b>${due ? due.text : "未设置"}</b></div>
    <div class="detail-row">⚑ 优先级<b>${esc({ high:"高", medium:"中", low:"低", none:"无" }[t.priority] || "无")}</b></div>
    <div style="margin-top:10px;font-size:12px;font-weight:700;color:var(--ink2)">备注 <button class="btn ghost" data-action="editNotes" style="font-size:10px">${t.notes ? "编辑" : "＋ 添加"}</button></div>
    <div id="detailNotes" class="detail-notes">
      ${editingNotes ? `
        <textarea id="notesInput" style="width:100%;min-height:80px;margin-bottom:6px">${esc(t.notes || "")}</textarea>
        <button class="btn primary" data-action="saveNotes">保存</button>
        <button class="btn ghost" data-action="cancelNotes">取消</button>
      ` : (t.notes ? mdRender(t.notes) : '<span class="hint-text">无备注</span>')}
    </div>
    <div style="margin-top:10px;font-size:12px;font-weight:700;color:var(--ink2)">检查事项（${(t.checklist||[]).filter(c=>c.done).length}/${(t.checklist||[]).length}）</div>
    <div id="detailChecklist">
      ${(t.checklist||[]).map((c,i) => `<div class="detail-check"><input type="checkbox" ${c.done?"checked":""} data-action="toggleChecklist" data-ci="${i}"><span style="${c.done?"text-decoration:line-through;color:var(--ink3)":""}">${esc(c.title)}</span><button class="btn ghost" style="margin-left:auto;font-size:10px" data-action="delChecklist" data-ci="${i}">✕</button></div>`).join("") || '<span class="hint-text">暂无检查事项</span>'}
      <div style="display:flex;gap:6px;margin-top:6px"><input type="text" id="checklistInput" placeholder="添加检查项…" style="flex:1;margin-bottom:0"><button class="btn" data-action="addChecklist">＋</button></div>
    </div>
    <div style="margin-top:12px;font-size:12px;font-weight:700;color:var(--ink2)">子任务（${(() => { const c = countSubtasks(t.subtasks); return `${c.done}/${c.total}`; })()}）</div>
    <div id="detailSubtasks">
      ${renderSubtasks(t.subtasks, [])}
      <div style="display:flex;gap:6px;margin-top:6px"><input type="text" id="subtaskInput" placeholder="添加子任务…" style="flex:1;margin-bottom:0"><button class="btn" data-action="addSubtask">＋</button></div>
    </div>
    <div class="detail-row"># 标签<b>${esc(t.tags.join(", ")) || "无"}</b></div>
    ${t.recurrence ? `<div class="detail-row">🔁 重复<b>${esc(t.recurrence)}</b> <label style="font-weight:400;margin-left:8px"><input type="checkbox" data-action="onlyThisTime"> 仅本次</label></div>` : ""}
    ${t.reminder ? `<div class="detail-row">🔔 提醒<b>提前 ${esc(t.reminder)} 分钟</b></div>` : ""}
    <div class="detail-row">📌 置顶<b><input type="checkbox" ${t.pinned ? "checked" : ""} data-action="togglePinned"></b></div>
    <div style="margin-top:12px;font-size:12px;font-weight:700;color:var(--ink2)">优先级（点击修改）</div>
    <div style="display:flex;gap:6px;margin-top:6px">
      ${["none","low","medium","high"].map(p => `<button class="btn ${t.priority === p ? "active" : ""}" data-action="setPriority" data-p="${p}">${({ high:"高", medium:"中", low:"低", none:"无" }[p] || p)}</button>`).join("")}
    </div>
    <div class="detail-actions">
      <button class="btn primary" data-action="toggle">${t.done ? "取消完成" : "标记完成"}</button>
      <button class="btn" style="color:var(--red)" data-action="delete">删除</button>
    </div>`;
  $id("detailOverlay").classList.remove("hidden");
}
function togglePinned(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.pinned = !t.pinned;
  Store.save(tasks); render(); openDetail(id);
}
// F-002 备注保存（读 notesInput textarea → 写回任务 → 退出编辑态）
function saveNotes(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  const val = $id("notesInput") ? $id("notesInput").value : "";
  t.notes = val.trim() ? val.trim() : null;   // 空备注归 null（与 Store.load 口径一致）
  editingNotes = false;
  Store.save(tasks); render(); openDetail(id);
}
function toggleChecklist(id, idx) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  if (t.checklist[idx]) t.checklist[idx].done = !t.checklist[idx].done;
  Store.save(tasks); render(); openDetail(id);
}
function addChecklist(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  const val = $id("checklistInput").value.trim(); if (!val) return;
  t.checklist = t.checklist || [];
  t.checklist.push({ id: crypto.randomUUID(), title: val, done: false });
  Store.save(tasks); render(); openDetail(id);
}
function delChecklist(id, idx) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  t.checklist.splice(idx, 1); Store.save(tasks); render(); openDetail(id);
}
// F-003 路径化子任务操作：spath 为 "0,1" 索引路径（顶层 addSubtask 为顶层追加）
function parsePath(s) { return String(s || "").split(",").filter(x => x !== "").map(Number); }
// 空路径防御：DOM 被篡改为空 data-spath 时防 splice(-1) 误删（review nit）
function hasPath(s) { return String(s || "").split(",").filter(x => x !== "").length > 0; }
function toggleSubtask(id, spath) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  if (!hasPath(spath)) return;   // 空路径防御（review nit：防 findSubtaskByPath 返回 {node:null} 后 TypeError）
  const hit = findSubtaskByPath(t, parsePath(spath));
  if (hit) { hit.node.done = !hit.node.done; Store.save(tasks); render(); openDetail(id); }
}
function addSubtask(id) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  const val = $id("subtaskInput").value.trim(); if (!val) return;
  t.subtasks = t.subtasks || [];
  t.subtasks.push({ id: crypto.randomUUID(), title: val, done: false, subtasks: [] });
  Store.save(tasks); render(); openDetail(id);
}
// 在指定子任务节点下追加子级（F-003 多层）；深度 ≥32 拒绝（review should-fix：防超深链保存后 reload 被 normSubtasks 静默截断）
function addSubtaskTo(id, spath) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  if (!hasPath(spath)) return;   // 空路径防御（review nit：与 delSubtask 同款）
  const hit = findSubtaskByPath(t, parsePath(spath));
  if (!hit) return;
  const depth = parsePath(spath).length;
  if (depth >= 32) return;   // 目标节点已是第 32 层，禁止再加深
  hit.node.subtasks = hit.node.subtasks || [];
  hit.node.subtasks.push({ id: crypto.randomUUID(), title: "新子任务", done: false, subtasks: [] });
  collapsedPaths.delete(String(spath || ""));   // 向折叠节点添加后自动展开（review nit：新子任务可见）
  Store.save(tasks); render(); openDetail(id);
}
function delSubtask(id, spath) {
  const t = tasks.find(x => x.id === id); if (!t) return;
  if (!hasPath(spath)) return;   // 空路径防御（review nit：防 splice(-1) 误删）
  const hit = findSubtaskByPath(t, parsePath(spath));
  if (hit) { hit.parent.splice(hit.idx, 1); Store.save(tasks); render(); openDetail(id); }
}
function collapseSubtask(id, spath) {
  const key = String(spath || "");
  if (collapsedPaths.has(key)) collapsedPaths.delete(key); else collapsedPaths.add(key);
  openDetail(id);
}
function setPriority(id, p) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.priority = p;
  Store.save(tasks); render(); openDetail(id);
}
// 删除撤销（TC-0101：删除 5s 内可撤销）：记录被删任务快照 + 原索引，undoBar 提供"撤销"入口
let lastDeleted = null;      // { task, index }
let undoBarTimer = null;
function showUndoBar(msg) {
  const bar = $id("undoBar");
  if (!bar) return;   // 测试环境无该元素时静默
  bar.innerHTML = `${esc(msg)} <button class="btn ghost" data-action="undoDelete">撤销</button>`;
  bar.classList.remove("hidden");
}
function hideUndoBar() {
  const bar = $id("undoBar");
  if (bar) bar.classList.add("hidden");
}
function deleteTask(id) {
  const idx = tasks.findIndex(x => x.id === id);
  if (idx < 0) return;
  const [removed] = tasks.splice(idx, 1);
  Store.save(tasks);
  lastDeleted = { task: removed, index: idx };
  clearTimeout(undoBarTimer);
  undoBarTimer = setTimeout(() => { lastDeleted = null; hideUndoBar(); }, 5000);   // 5s 撤销窗口
  showUndoBar(`已删除「${removed.title}」`);
  $id("detailOverlay").classList.add("hidden");
  editingId = null;
  onlyThisTime = false;   // 删除路径关闭详情：同步清理（review 复核：防残留影响后续完成）
  render();
}
function undoDelete() {
  if (!lastDeleted) return;
  tasks.splice(Math.min(lastDeleted.index, tasks.length), 0, lastDeleted.task);   // 原索引恢复（索引越界则末尾）
  lastDeleted = null;
  clearTimeout(undoBarTimer);
  hideUndoBar();
  Store.save(tasks);
  render();
}

// ============ A2 语音输入（Web Speech API） ============
let voiceRecognition = null;
let isVoiceListening = false;
function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { $id("voiceStatus").textContent = "⚠️ 当前浏览器不支持语音识别（需 Safari/Chrome）"; return; }
  voiceRecognition = new SR();
  voiceRecognition.lang = "zh-CN";
  voiceRecognition.interimResults = false;
  voiceRecognition.continuous = false;
  voiceRecognition.onresult = (e) => {
    const text = e.results[0][0].transcript;
    $id("qaInput").value = ($id("qaInput").value ? $id("qaInput").value + " " : "") + text;
    qaParsePreview();
    $id("voiceStatus").textContent = `✅ 已识别：${text}`;
  };
  voiceRecognition.onerror = (e) => {
    isVoiceListening = false;
    $id("voiceStatus").textContent = `❌ 识别失败：${e.error === "not-allowed" ? "麦克风权限被拒绝" : e.error}`;
  };
  voiceRecognition.onend = () => { isVoiceListening = false; $id("voiceBtn").textContent = "🎤 语音输入"; };
}
$id("voiceBtn").addEventListener("click", () => {
  if (!voiceRecognition) initVoice();
  if (!voiceRecognition) return;
  if (isVoiceListening) { voiceRecognition.stop(); isVoiceListening = false; $id("voiceBtn").textContent = "🎤 语音输入"; return; }
  try {
    voiceRecognition.start();
    isVoiceListening = true;
    $id("voiceBtn").textContent = "🔴 聆听中…点击停止";
    $id("voiceStatus").textContent = "🎙 请说话…";
  } catch (e) {
    $id("voiceStatus").textContent = "❌ 无法启动（可能已在识别中）";
  }
});

// ============ P2 习惯打卡（localStorage 独立存储） ============
const Habits = {
  KEY: "taskflow.web.habits",
  load() {
    try {
      const v = JSON.parse(localStorage.getItem(this.KEY));
      if (!Array.isArray(v)) return [];
      return v.filter(h => h && typeof h.name === "string")
        .map(h => ({ name: h.name, dates: Array.isArray(h.dates) ? h.dates.filter(d => typeof d === "string") : [] }));
    } catch { return []; }
  },
  save(h) { localStorage.setItem(this.KEY, JSON.stringify(h)); }
};
// 习惯连续打卡天数（从今天往前数；今天未打卡即 0——与"到今天为止连续"语义一致）
function habitStreak(dates) {
  const set = new Set(dates || []);
  let n = 0;
  for (let d = new Date(); ; d.setDate(d.getDate() - 1)) {
    if (set.has(d.toDateString())) n++;
    else break;
  }
  return n;
}

function renderHabits() {
  const habits = Habits.load();
  const today = new Date().toDateString();
  containerHTML(`<div class="stats"><div class="stat-card" style="min-width:100%">
    <h4>🔥 习惯打卡（今日 ${habits.filter(h => (h.dates || []).includes(today)).length}/${habits.length}）</h4>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <input type="text" id="habitInput" placeholder="新习惯，如：喝水 2L / 跑步 30 分钟" style="flex:1">
      <button class="btn primary" data-action="addHabit">添加</button>
    </div>
    ${habits.length ? habits.map((h, i) => {
      const doneToday = (h.dates || []).includes(today);
      const streak = habitStreak(h.dates);
      return `<div class="detail-check"><input type="checkbox" ${doneToday ? "checked" : ""} data-action="toggleHabit" data-hi="${i}"><span style="${doneToday ? "color:var(--ink3)" : ""}">${esc(h.name)}</span><span style="margin-left:auto;font-size:11px;color:var(--ink3)">🔥 ${streak} 天</span><button class="btn ghost" style="font-size:10px" data-action="delHabit" data-hi="${i}">✕</button></div>`;
    }).join("") : '<span class="hint-text">还没有习惯，添加一个开始打卡吧</span>'}
  </div></div>`);
}
function addHabit() {
  const val = $id("habitInput").value.trim(); if (!val) return;
  const h = Habits.load(); h.push({ name: val, dates: [] }); Habits.save(h); render();
}
function toggleHabit(idx) {
  const h = Habits.load(); if (!h[idx]) return;
  const today = new Date().toDateString();
  h[idx].dates = h[idx].dates || [];
  const i = h[idx].dates.indexOf(today);
  if (i >= 0) h[idx].dates.splice(i, 1); else h[idx].dates.push(today);
  Habits.save(h); render();
}
function delHabit(idx) { const h = Habits.load(); h.splice(idx, 1); Habits.save(h); render(); }

// ============ P2 番茄钟 ============
let pomoTimer = null;
function renderPomodoro() {
  if (pomoRunning) { clearInterval(pomoTimer); pomoRunning = false; }   // 切视图防残留 interval
  const active = tasks.filter(t => !t.done);
  containerHTML(`<div class="stats"><div class="stat-card" style="min-width:100%">
    <h4>🍅 番茄钟（25 分钟专注 / 5 分钟休息）</h4>
    <div style="text-align:center;padding:12px 0">
      <div id="pomoTime" style="font-size:52px;font-weight:800;font-variant-numeric:tabular-nums">25:00</div>
      <div style="font-size:12px;color:var(--ink2);margin:6px 0" id="pomoState">准备开始</div>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn primary" data-action="pomoStart">▶ 开始</button>
        <button class="btn" data-action="pomoReset">↺ 重置</button>
        <select id="pomoTask" class="select" style="max-width:160px">
          <option value="">不关联任务</option>
          ${active.map(t => `<option value="${t.id}">${esc(t.title).slice(0, 14)}</option>`).join("")}
        </select>
      </div>
      ${pomoCount > 0 ? `<div style="margin-top:10px;font-size:12px;color:var(--ink3)">今日已专注 ${pomoCount} 个番茄</div>` : ""}
    </div>
  </div></div>`);
}
let pomoRemaining = 25 * 60, pomoMode = "work", pomoCount = 0, pomoRunning = false; // pomoRunning 先于 renderPomodoro 使用（TDZ 防御）
function pomoStart() {
  if (pomoRunning) { clearInterval(pomoTimer); pomoRunning = false; $id("pomoState").textContent = "已暂停"; return; }
  pomoRunning = true;
  pomoTimer = setInterval(() => {
    pomoRemaining--;
    if (pomoRemaining <= 0) {
      clearInterval(pomoTimer); pomoRunning = false;
      if (pomoMode === "work") { pomoCount++; pomoMode = "rest"; pomoRemaining = 5 * 60; $id("pomoState").textContent = "🍅 完成！休息 5 分钟"; }
      else { pomoMode = "work"; pomoRemaining = 25 * 60; $id("pomoState").textContent = "☕ 休息结束，开始专注"; }
    }
    const m = Math.floor(pomoRemaining / 60), s = pomoRemaining % 60;
    $id("pomoTime").textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }, 1000);
  $id("pomoState").textContent = pomoMode === "work" ? "🍅 专注中…" : "☕ 休息中…";
}
function pomoReset() { clearInterval(pomoTimer); pomoRunning = false; pomoMode = "work"; pomoRemaining = 25 * 60; $id("pomoTime").textContent = "25:00"; $id("pomoState").textContent = "准备开始"; }

// ============ P2 模板 ============
const TEMPLATES = [
  { name: "每日例行", tasks: ["晨间计划 每天", "回复消息 今天 高优先级", "运动 30 分钟", "睡前复盘 今晚"] },
  { name: "项目启动", tasks: ["明确目标与范围", "拆解里程碑", "分配任务 !工作", "建立沟通节奏"] },
  { name: "会议跟进", tasks: ["整理会议纪要", "确认行动项 明天", "同步相关方 !工作"] },
  { name: "旅行计划", tasks: ["订机票/酒店", "列行程清单", "准备证件 高优先级"] }
];
function renderTemplates() {
  containerHTML(`<div class="stats"><div class="stat-card" style="min-width:100%">
    <h4>📋 任务模板（点击即创建全部任务）</h4>
    ${TEMPLATES.map((t, i) => `<div class="detail-check"><button class="btn primary" data-action="applyTemplate" data-ti="${i}" style="margin-right:8px">应用</button><span>${esc(t.name)}（${t.tasks.length} 项）</span></div>`).join("")}
    <div class="hint-text">模板创建的任务可直接编辑；后续可自定义模板（存于代码 TEMPLATES 常量）。</div>
  </div></div>`);
}
function applyTemplate(idx) {
  const t = TEMPLATES[idx]; if (!t) return;
  let added = 0;
  t.tasks.forEach(line => {
    const p = NLP.parse(line);
    if (!p.title) return;
    tasks.push({ id: crypto.randomUUID(), title: p.title, done: false, priority: p.priority,
      tags: p.tags, due: p.due, pinned: false, createdAt: new Date().toISOString(),
      list: p.list, reminder: p.reminder, recurrence: p.recurrence, subtasks: [], checklist: [] });
    added++;
  });
  Store.save(tasks); render(); alert(`已从模板「${t.name}」创建 ${added} 个任务`);
}

// ============ P2 艾森豪威尔矩阵 ============
function renderMatrix(list) {   // 参数化：使用过滤后的 list（review should-fix：此前内部用全局 tasks，与空态判断口径分裂）
  // 定义：紧急=今天到期或逾期；重要=高/中优先级
  const urgent = (t) => !!t.due && (isOverdue(t) || isToday(t));
  const important = (t) => t.priority === "high" || t.priority === "medium";
  const q = {
    qi: list.filter(t => !t.done && urgent(t) && important(t)),
    q2: list.filter(t => !t.done && !urgent(t) && important(t)),
    q3: list.filter(t => !t.done && urgent(t) && !important(t)),
    q4: list.filter(t => !t.done && !urgent(t) && !important(t))
  };
  const card = (items, color) => items.map(t => `<div class="board-card" style="border-left:3px solid ${color}" data-id="${esc(t.id)}" data-action="detail">${esc(t.title)}</div>`).join("");
  containerHTML(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <div class="board-col"><h4>🔴 重要且紧急（立即做）<span class="n">${q.qi.length}</span></h4>${card(q.qi, "var(--red)")}</div>
    <div class="board-col"><h4>🟡 重要不紧急（计划做）<span class="n">${q.q2.length}</span></h4>${card(q.q2, "var(--amber)")}</div>
    <div class="board-col"><h4>🟢 紧急不重要（委托）<span class="n">${q.q3.length}</span></h4>${card(q.q3, "var(--green)")}</div>
    <div class="board-col"><h4>⚪ 不重要不紧急（删除）<span class="n">${q.q4.length}</span></h4>${card(q.q4, "var(--ink3)")}</div>
  </div>`);
}

// ============ P2 ICS 导出（日历订阅格式） ============
function exportICS() {
  const escICS = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r/g, "").replace(/\n/g, "\\n");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TaskFlow//Web//CN"];
  const now = new Date();
  tasks.filter(t => t.due).forEach(t => {
    const d = new Date(t.due);
    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (x) => `${x.getFullYear()}${pad(x.getMonth()+1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${t.id}@taskflow-web`);
    lines.push(`DTSTAMP:${now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z/, "Z")}`);
    lines.push(`DTSTART:${fmt(d)}`);
    lines.push(`SUMMARY:${escICS(t.title)}`);
    if (t.tags.length) lines.push(`CATEGORIES:${t.tags.map(escICS).join(",")}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  downloadBlob(lines.join("\r\n"), `taskflow-${new Date().toISOString().slice(0, 10)}.ics`, "text/calendar");
}

// ============ AI 设置 ============
function openAI() {
  $id("aiBaseURL").value = settings.baseURL || "https://openrouter.ai/api/v1";
  $id("aiKey").value = settings.apiKey || "";
  $id("aiModel").value = settings.model || "openai/gpt-4o-mini";
  $id("aiPrompt").value = settings.prompt || "你是 TaskFlow AI 助手。回答简洁、结构化。涉及任务数据时只提供建议。";
  $id("aiStatus").textContent = "";
  $id("aiOverlay").classList.remove("hidden");
}
function aiSave() {
  settings = {
    baseURL: $id("aiBaseURL").value.trim(),
    apiKey: $id("aiKey").value.trim(),
    model: $id("aiModel").value.trim(),
    prompt: $id("aiPrompt").value.trim()
  };
  Store.saveSettings(settings);
  $id("aiStatus").textContent = "✅ 已保存到本浏览器 localStorage（Key 仅存本机浏览器，请勿用于生产）";
}
async function aiTest() {
  const base = $id("aiBaseURL").value.trim().replace(/\/+$/, "");
  const key = $id("aiKey").value.trim();
  const model = $id("aiModel").value.trim();
  $id("aiStatus").textContent = "⏳ 测试中…（浏览器直连需 CORS 兼容端点）";
  try {
    const resp = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "回复 OK" }], max_tokens: 8 })
    });
    if (!resp.ok) {
      $id("aiStatus").textContent = `❌ HTTP ${resp.status}：${await resp.text().then(t => t.slice(0, 120)).catch(() => "")}`;
      return;
    }
    const data = await resp.json();
    $id("aiStatus").textContent = `✅ 连接成功：${data.choices?.[0]?.message?.content?.slice(0, 60) || "OK"}`;
  } catch (e) {
    $id("aiStatus").textContent = `❌ 连接失败：${e.message}（OpenAI 官方端点无 CORS 头，需本地代理或用 OpenRouter）`;
  }
}

// ============ 导出 / 导入 ============
function exportJSON() {
  const doc = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: tasks.map(t => ({ ...t }))
  };
  downloadBlob(JSON.stringify(doc, null, 2), `taskflow-export-${new Date().toISOString().slice(0, 10)}.json`, "application/json");
}
function importJSON(file) {
  if (file.size > 10 * 1024 * 1024) { alert("导入失败：文件超过 10MB 上限"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = JSON.parse(reader.result);
      if (!doc.tasks || !Array.isArray(doc.tasks)) throw new Error("格式错误");
      const existing = new Set(tasks.map(t => t.id));
      let added = 0, skipped = 0;
      const isUUID = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));
      for (const t of doc.tasks) {
        if (!isUUID(t.id) || typeof t.title !== "string" || !t.title.trim() || existing.has(t.id)) { skipped++; continue; }
        // 字段规范化（防脏数据）
        const norm = {
          id: t.id, title: t.title, done: t.done === true,
          notes: typeof t.notes === "string" ? t.notes : null,   // F-002 Markdown 备注
          completedAt: isValidISO(t.completedAt) ? t.completedAt : null,   // ISO 校验（security_review informational 加固）
          priority: ["high","medium","low","none"].includes(t.priority) ? t.priority : "none",
          tags: Array.isArray(t.tags) ? t.tags.filter(x => typeof x === "string") : [],
          due: typeof t.due === "string" ? t.due : null,
          pinned: t.pinned === true, createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString(),
          list: typeof t.list === "string" ? t.list : null,
          sortOrder: Number.isFinite(t.sortOrder) ? t.sortOrder : 0,   // 与原生 Task.sortOrder 对齐
          reminder: Number.isFinite(t.reminder) ? t.reminder : null,
          recurrence: typeof t.recurrence === "string" ? t.recurrence : null,
          subtasks: normSubtasks(t.subtasks, 0),   // F-003 多层子任务（递归规范化，深度上限 32）
          checklist: Array.isArray(t.checklist) ? t.checklist.filter(x => x && typeof x.title === "string").map(x => ({ id: String(x.id || crypto.randomUUID()), title: x.title, done: x.done === true })) : []
        };
        tasks.push(norm); existing.add(t.id); added++;
      }
      Store.save(tasks);
      render();
      alert(`导入完成：新增 ${added} 条，跳过 ${skipped} 条（重复/无效）`);
    } catch (e) {
      alert(`导入失败：${e.message}`);
    }
  };
  reader.readAsText(file);
}

// ============ 关于 ============
function openAbout() {
  $id("aboutBody").innerHTML = `
    <b>这是什么？</b><br>
    TaskFlow AI 的<b>网页版原型</b>——用于在无 Xcode/无 Apple ID 环境下，先在浏览器里验证<b>功能与样式</b>是否正确。数据存于本机浏览器 localStorage。<br><br>
    <b>测试清单</b><br>
    1️⃣ 右上角切换 <code>A/B/C 三套皮肤</code> 与深色模式<br>
    2️⃣ 点「＋ 新建任务」输入：<code>明天下午3点 高优先级 买牛奶 #生活</code> → 看 NLP 解析胶囊 → 确认创建<br>
    3️⃣ 试试：<code>每周三晚上8点 健身</code> / <code>3天后 提交报销 !工作</code> / <code>月底前 写完周报</code><br>
    4️⃣ 侧栏切换 列表 / 看板（拖拽到已完成列）/ 日历 / 统计<br>
    5️⃣ 搜索框 + 优先级/状态过滤；点任务卡片看详情（优先级/置顶/删除）<br>
    6️⃣ ✨ AI 设置：配置 OpenRouter 等 CORS 兼容端点可<b>直接测试连接</b>（OpenAI 官方端点需本地代理）<br>
    6️⃣.5 🔔 提醒：点工具栏「🔔 提醒」授权后，<b>页面打开期间</b>任务到期（提前 N 分钟）会弹系统通知，点通知直达任务；<b>页面关闭/后台推送</b>仍受浏览器限制——原生版才有系统级通知<br>
    7️⃣ 侧栏「导出 JSON / 导入 JSON」验证数据备份<br>
    8️⃣ P2 功能：🔥 习惯打卡 / 🍅 番茄钟 / 📋 模板 / 🧭 四象限 / 📅 导出 ICS（日历导入）<br>
    9️⃣ 位置提醒与协作共享：Web 版<b>不支持</b>（位置需后台权限、协作需服务器）——原生版 P2 再议<br>
    1️⃣0️⃣ 键盘快捷键：<code>n</code> 快速添加 / <code>/</code> 聚焦搜索 / <code>Esc</code> 关闭弹层 / <code>?</code> 本说明（输入框内不触发）<br><br>
    <b>与原生版关系</b><br>
    本原型用于功能/样式验证；最终交付仍为 SwiftUI 原生 App（M0~M4 代码已就绪，待你有 Apple ID + Xcode 后编译分发）。核心逻辑（NLP 解析规则、三套皮肤 token）两端一致。<br><br>
    <b>本地启动</b><br>
    双击 <code>webapp/index.html</code> 即可（或 <code>cd webapp && python3 -m http.server 8080</code> 后访问 <code>http://localhost:8080</code>）。
  `;
  $id("aboutOverlay").classList.remove("hidden");
}

// ============ 浏览器提醒（页面打开期间到期通知；后台推送仍需原生版） ============
const NOTIFY_KEY = "taskflow.web.notified";
const notifySupported = "Notification" in window;

function updateNotifyBtn() {
  const btn = $id("notifyBtn");
  if (!notifySupported) { btn.hidden = true; return; }
  if (Notification.permission === "granted") {
    btn.textContent = "🔔 提醒已开启";
    btn.title = "到期任务将在页面打开期间弹出通知";
  } else if (Notification.permission === "denied") {
    btn.textContent = "🔔 提醒被拒绝";
    btn.title = "请在浏览器站点设置中允许通知后刷新";
    btn.disabled = true;
  } else {
    btn.textContent = "🔔 开启提醒";
    btn.title = "点击授权后，到期任务会弹系统通知";
  }
}

function requestNotifyPermission() {
  if (!notifySupported) return;
  if (Notification.permission === "granted") { updateNotifyBtn(); return; }
  Notification.requestPermission().then(updateNotifyBtn);
}

// 已通知记录：key = `${taskId}@${提醒时间点ms}`，防重复；超过 200 条整体清空（原型简化）
function notifiedKeys() {
  try { const v = JSON.parse(localStorage.getItem(NOTIFY_KEY)); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
function markNotified(key) {
  const m = notifiedKeys();
  m[key] = true;
  if (Object.keys(m).length > 200) {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify({ [key]: true }));
  } else {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify(m));
  }
}

function checkReminders() {
  if (!notifySupported || Notification.permission !== "granted") return;
  const now = Date.now();
  const fired = notifiedKeys();
  for (const t of Store.load()) {
    if (t.done || !t.due || !Number.isFinite(t.reminder) || t.reminder <= 0) continue;
    const dueMs = new Date(t.due).getTime();
    if (!Number.isFinite(dueMs)) continue;
    const at = dueMs - t.reminder * 60000;   // 提醒时间点 = 到期 - 提前量
    const key = `${t.id}@${at}`;
    if (fired[key]) continue;
    // 仅通知过去 60 秒内到点的提醒（页面关闭期间错过的过期提醒不补发，避免打开即轰炸）
    const elapsed = now - at;
    if (elapsed < 0 || elapsed > 60000) continue;
    try {
      const n = new Notification(`⏰ ${t.title}`, {
        body: `提前 ${fmtReminder(t.reminder)} 提醒 · 到期 ${fmtDate(t.due).text}`,
        // tag 仅用于通知去重：≤32 字符（规范上限，超长会被个别浏览器截断）；
        // 完整任务 id 走 data（无长度限制），sw.js 点击时优先取 data.id
        tag: `tf-${t.id.slice(0, 8)}`,
        data: { id: t.id },
      });
      n.onclick = () => { window.focus(); openDetail(t.id); };
      // 构造成功后才落库（review should-fix：此前先 markNotified，构造抛异常会永久丢提醒）
      markNotified(key);
    } catch { /* 构造失败不标记，下一轮轮询重试 */ }
  }
}

// 全局键盘快捷键（输入框聚焦时不触发；? 打开使用说明）
function shortcutAction(key, targetTag) {
  if (targetTag === "INPUT" || targetTag === "TEXTAREA" || targetTag === "SELECT") return null;
  if (key === "n" || key === "N") return "quickAdd";
  if (key === "/") return "focusSearch";
  if (key === "Escape") return "closeOverlays";
  if (key === "?") return "about";
  return null;
}
document.addEventListener("keydown", (e) => {
  // 忽略修饰键组合（Cmd/Ctrl/Alt+n 等属浏览器/系统快捷键，不劫持——review should-fix）
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const act = shortcutAction(e.key, e.target && e.target.tagName);
  if (!act) return;
  if (act === "quickAdd") openQuickAdd();
  else if (act === "focusSearch") { e.preventDefault(); $id("searchInput").focus(); }
  else if (act === "closeOverlays") {
    document.querySelectorAll(".overlay").forEach(o => {
      if (!o.classList.contains("hidden")) {
        o.classList.add("hidden");
        if (o.id === "detailOverlay") { editingId = null; onlyThisTime = false; }   // Escape 关闭详情：同步清理（review 复核第 4 条路径）
        if (o.id === "quickAddOverlay") quickAddDue = null;
      }
    });
  }
  else if (act === "about") openAbout();
});

// ============ 事件绑定 ============
document.querySelectorAll(".side-item[data-view]").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".side-item[data-view]").forEach(x => x.classList.remove("active"));
    el.classList.add("active");
    currentView = el.dataset.view;
    currentFilter = "";
    document.querySelectorAll(".side-filter").forEach(x => x.classList.remove("active"));
    render();
  });
});
document.querySelectorAll(".side-filter").forEach(el => {
  el.addEventListener("click", () => {
    document.querySelectorAll(".side-filter").forEach(x => x.classList.remove("active"));
    el.classList.add("active");
    currentView = "list";
    document.querySelectorAll(".side-item[data-view]").forEach(x => x.classList.remove("active"));
    document.querySelector(".side-item[data-view='list']").classList.add("active");
    currentFilter = el.dataset.filter;
    render();
  });
});
$id("searchInput").addEventListener("input", render);
$id("priorityFilter").addEventListener("change", render);
$id("statusFilter").addEventListener("change", render);
$id("addBtn").addEventListener("click", openQuickAdd);
$id("templateBtn").addEventListener("click", () => {
  currentView = "templates";
  document.querySelectorAll(".side-item[data-view]").forEach(x => x.classList.remove("active"));
  currentFilter = "";
  renderTemplates();
});
$id("icsBtn").addEventListener("click", exportICS);
$id("notifyBtn").addEventListener("click", requestNotifyPermission);
$id("qaClose").addEventListener("click", () => { quickAddDue = null; $id("quickAddOverlay").classList.add("hidden"); });
$id("qaInput").addEventListener("input", qaParsePreview);
$id("qaCreate").addEventListener("click", qaCreate);
$id("qaClear").addEventListener("click", () => { $id("qaInput").value = ""; $id("qaParsed").innerHTML = ""; /* 刻意保留 quickAddDue：清空=重输（保留上下文），qaClose=取消（清空预置） */ });
$id("detailClose").addEventListener("click", () => { $id("detailOverlay").classList.add("hidden"); editingId = null; onlyThisTime = false; });
$id("aiBtn").addEventListener("click", openAI);
$id("aiClose").addEventListener("click", () => $id("aiOverlay").classList.add("hidden"));
$id("aiSave").addEventListener("click", aiSave);
$id("aiTest").addEventListener("click", aiTest);
$id("aboutBtn").addEventListener("click", openAbout);
$id("aboutClose").addEventListener("click", () => $id("aboutOverlay").classList.add("hidden"));
$id("exportBtn").addEventListener("click", exportJSON);
$id("importBtn").addEventListener("click", () => $id("importFile").click());
$id("importFile").addEventListener("change", (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ""; });
$id("themeBtn").addEventListener("click", () => {
  const body = document.body;
  body.dataset.theme = body.dataset.theme === "light" ? "dark" : "light";
  $id("themeBtn").textContent = body.dataset.theme === "light" ? "🌙 深色" : "☀️ 浅色";
});
$id("todayBadge").addEventListener("click", goTodayFilter);
$id("clearDoneBtn").addEventListener("click", clearCompleted);
document.querySelectorAll(".skin-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.body.dataset.skin = btn.dataset.skin;
    document.querySelectorAll(".skin-btn").forEach(b => b.classList.toggle("active", b === btn));
  });
});
document.querySelectorAll(".overlay").forEach(ov => {
  ov.addEventListener("click", (e) => {
    if (e.target === ov) {
      ov.classList.add("hidden");
      if (ov.id === "quickAddOverlay") quickAddDue = null;
      if (ov.id === "detailOverlay") { editingId = null; onlyThisTime = false; }   // 空白点击关闭详情：同步清理（review should-fix：防 onlyThisTime 残留影响后续完成）
    }
  });
});
// 事件委托（任务卡片/勾选/日历/详情动作；防 inline onclick XSS）
document.addEventListener("click", (e) => {
  // 日历日（限定 .day 元素，避免误吞「该天添加」按钮——其带 data-iso 但属 data-action，review blocking 修复）
  const day = e.target.closest(".day[data-iso]");
  if (day) { showDayTasks(day.dataset.iso); return; }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  // 详情面板动作无自身 data-id：editingId 兜底（review blocking 修复）
  const id = el.dataset.id || el.closest("[data-id]")?.dataset.id || editingId;
  switch (el.dataset.action) {
    case "detail": openDetail(id); break;
    case "toggle": e.stopPropagation(); toggleDone(id); break;
    case "undoDelete": undoDelete(); break;
    case "togglePinned": togglePinned(id); break;
    case "editNotes": editingNotes = true; openDetail(id); break;
    case "cancelNotes": editingNotes = false; openDetail(id); break;
    case "saveNotes": saveNotes(id); break;
    case "onlyThisTime": onlyThisTime = el.checked === true; break;
    case "setPriority": setPriority(id, el.dataset.p); break;
    case "delete": deleteTask(id); break;
    case "calShift": calShift(parseInt(el.dataset.d || "0")); break;
    case "quickAddDay": openQuickAddFor(el.dataset.iso); break;
    case "toggleChecklist": toggleChecklist(id, parseInt(el.dataset.ci)); break;
    case "addChecklist": addChecklist(id); break;
    case "delChecklist": delChecklist(id, parseInt(el.dataset.ci)); break;
    case "boardGroup": settings.boardGroup = el.dataset.g; Store.saveSettings(settings); render(); break;
    case "trendMode": settings.trendMode = el.dataset.g; Store.saveSettings(settings); render(); break;
    case "exportStats": downloadStats(); break;
    case "toggleSubtask": toggleSubtask(id, el.dataset.spath); break;
    case "addSubtask": addSubtask(id); break;
    case "addSubtaskTo": addSubtaskTo(id, el.dataset.spath); break;
    case "delSubtask": delSubtask(id, el.dataset.spath); break;
    case "collapseSubtask": collapseSubtask(id, el.dataset.spath); break;
    case "addHabit": addHabit(); break;
    case "toggleHabit": toggleHabit(parseInt(el.dataset.hi)); break;
    case "delHabit": delHabit(parseInt(el.dataset.hi)); break;
    case "pomoStart": pomoStart(); break;
    case "pomoReset": pomoReset(); break;
    case "applyTemplate": applyTemplate(parseInt(el.dataset.ti)); break;
  }
});
// 初始化
document.querySelector(`.skin-btn[data-skin="${document.body.dataset.skin}"]`)?.classList.add("active");
render();
updateNotifyBtn();
setInterval(checkReminders, 30000);          // 每 30s 检查到期提醒
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkReminders(); });

// SW 通知点击且无已开窗口时经 ?task= 进入：打开对应任务并清理 URL（review should-fix 修复，无时序竞争）
const openTaskParam = new URLSearchParams(location.search).get("task");
if (openTaskParam) {
  try { history.replaceState(null, "", location.pathname); } catch { /* 清理失败不影响功能 */ }
  currentView = "list";
  currentFilter = "";
  document.querySelectorAll(".side-item[data-view]").forEach(x => x.classList.remove("active"));
  document.querySelector(".side-item[data-view='list']")?.classList.add("active");
  document.querySelectorAll(".side-filter").forEach(x => x.classList.remove("active"));
  render();
  openDetail(openTaskParam);   // 不存在的 id 安全返回（review 已核查）
}

// PWA：Service Worker 注册（仅 https/localhost；失败静默不影响使用）
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
  // SW 通知点击 → 打开对应任务（页面在后台时由 SW 转发）
  navigator.serviceWorker.addEventListener("message", (e) => {
    // 仅接受本页 ServiceWorker 的消息（security_review MEDIUM：校验来源与 id 格式，
    // 防被嵌入 iframe 的跨源页面伪造 {type:"open-task"} 干扰 UI）
    if (!(e.source instanceof ServiceWorker)) return;
    const id = (e.data && e.data.type === "open-task" && typeof e.data.id === "string") ? e.data.id : null;
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
    currentView = "list";
    currentFilter = "";
    document.querySelectorAll(".side-item[data-view]").forEach(x => x.classList.remove("active"));
    document.querySelector(".side-item[data-view='list']")?.classList.add("active");
    document.querySelectorAll(".side-filter").forEach(x => x.classList.remove("active"));
    render();
    openDetail(id);
  });
}
