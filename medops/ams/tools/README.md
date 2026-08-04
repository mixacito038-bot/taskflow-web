# ams 注入工具 — 原件升级 / 重注入步骤

资产盘点系统是打包压缩的单文件 React 应用（无源码）。云同步能力通过
**注入 shim** 实现：不改原件一个字节，构建时把原件中最大的 `<script>`
（bundle）抽出为独立文件，原位换成 `shim.js`，由 shim 完成鉴权、首次
对账后再动态放行 bundle。

## 目录

```
ams/
├── original/pandian-v1.10.6.html   原件（只读，永不修改）
├── shim/shim.js                    垫片源码（登录/对账/拦截/同步）
├── tools/inject-shim.js            注入构建脚本（本目录）
└── dist/                           构建产物（部署 /pandian/ 用）
    ├── index.html                  原件去 bundle + 引 shim.js
    ├── shim.js                     垫片拷贝
    ├── app.bundle.js               原 bundle（一个字节不差）
    └── manifest.json               {bundleSha256, shimHash, builtAt}
```

## 日常构建

```bash
node tools/inject-shim.js
```

幂等：每次都从原件全量重建 dist/，可重复执行（仅 `builtAt` 变化）。

## 上游发新版原件时（如 v1.10.7）

1. 把新原件放入 `original/`（保留旧版本文件以便回滚）：
   `original/pandian-v1.10.7.html`
2. 重新注入：
   ```bash
   node tools/inject-shim.js --src original/pandian-v1.10.7.html
   ```
3. **核对注入结果**（新版打包结构可能变化）：
   - 脚本输出的 bundle 大小应仍是数十万字节级（明显是主 bundle，
     不是 xlsx 之类的 vendor 块）；若不确定，打开 dist/app.bundle.js
     开头确认是 `(()=>{var ...` 形式的应用代码；
   - `dist/index.html` 中恰好出现一处 `<script src="shim.js?v=...">`；
   - `dist/manifest.json` 的 `bundleSha256` 与
     `sha256sum` 手算 dist/app.bundle.js 一致。
4. **核对 shim 依赖的原件内部约定是否仍成立**（打开新原件搜索确认）：
   - localStorage key 仍为 `ams:*`，白名单表与契约 §5 一致；
   - 仍监听 `storage` 事件做跨窗口刷新（shim 靠手造 StorageEvent 触发
     App 自刷新；注意 bundle 会忽略 `key==='ams:_ts'` 的事件，shim
     因此补发业务 key 事件，若新版逻辑变化需同步调整 shim.notifyApp）；
   - IndexedDB 仍为 `ams-files` v1 / store `files`(keyPath id,
     index byAsset→assetId)，附件记录形如
     `{id,assetId,name,type,size,dataUrl,createdAt}`；schema 变了要
     同步改 shim 的 idbOpen/fileSync。
5. 本地跑一遍冒烟（登录 → 首次对账 → 改数据 → push → 冲突覆盖提示），
   再交 deploy 更新 `/pandian/`。

## 注意

- `shim.js?v=` 的版本号取 shim 内容 sha256 前 8 位，shim 改动即自动
  换 URL 破缓存；app.bundle.js 由 nginx 按 no-cache+ETag 下发（契约 §7）。
- 原件 `original/*.html` 是唯一事实源，dist/ 全部可再生，不要手改 dist/。
