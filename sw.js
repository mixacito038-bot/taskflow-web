/* TaskFlow AI 网页原型 — Service Worker（PWA：添加到主屏幕后离线可用）
   简单缓存策略：安装时预缓存核心资源，运行时缓存命中优先；
   仅缓存同源 GET 且 resp.ok 的响应（4xx/5xx 与跨域 AI 请求不入缓存）。 */
const CACHE = "taskflow-web-v2";
const CORE = [
  "./index.html", "./styles.css", "./app.js", "./manifest.json",
  "./apple-touch-icon.png", "./icon-192.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 仅同源 GET；跨域请求（AI 测试连接）与 POST 不缓存
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
      // 仅缓存成功响应（4xx/5xx 不入缓存，review blocking 修复）
      if (!resp.ok) return resp;
      const copy = resp.clone();
      caches.open(CACHE)
        .then((c) => c.put(e.request, copy))
        .catch(() => {});   // 配额超限静默（不阻塞响应）
      return resp;
    }).catch(() => {
      // 离线兜底（review blocking 修复）：导航请求回退 App Shell；非导航未命中 → 网络错误
      // 非导航/无缓存兜底 → 显式网络错误（避免 respondWith(undefined) 的 TypeError 噪音）
      if (e.request.mode === "navigate") {
        return caches.match("./index.html").then((hit) => hit || Response.error());
      }
      return Response.error();
    }))
  );
});

// 通知点击：聚焦已有页面并打开对应任务；无页面则经 ?task= 打开 App Shell
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const id = e.notification.tag.replace(/^tf-/, "");
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) {
      if ("focus" in c) {
        c.focus();
        c.postMessage({ type: "open-task", id });   // 已加载页面：监听器就绪，postMessage 可靠
        return;
      }
    }
    // 无窗口：openWindow 后新页面 message 监听器尚未注册，postMessage 必然丢失（review should-fix）。
    // 改经 ?task= 查询参数由页面 load 消费——无时序竞争；离线时 fetch 兜底仍返回 App Shell。
    await self.clients.openWindow("./?task=" + encodeURIComponent(id));
  })());
});
