// "cloudflare:workers" 的 Node 替身：构建产物在运行时通过
// `await import("cloudflare:workers")` 读取 env；这里把它指到
// 服务壳在启动时装配的绑定对象（D1→SQLite、R2→磁盘、环境变量）。
export const env = new Proxy({}, {
  get(_target, key) {
    return globalThis.__YH_WORKER_ENV__?.[key];
  },
  has(_target, key) {
    return globalThis.__YH_WORKER_ENV__ ? key in globalThis.__YH_WORKER_ENV__ : false;
  },
});

export function waitUntil() {
  // Node 进程内无需延长生命周期；异步任务自然完成。
}
