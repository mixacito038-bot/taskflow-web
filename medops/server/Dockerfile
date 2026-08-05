# 急救设备巡检系统 · 后端镜像（多阶段；npm ci 在同架构层执行，better-sqlite3 原生模块可用）
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm 偶发「Exit handler never called!」时会装了一半却仍以 0 退出，产出「构建成功但缺包」的坏镜像。
# 装完立刻逐个 require 全部生产依赖（同时验证 better-sqlite3 原生模块可加载），有问题当场让构建失败。
RUN npm ci --omit=dev && \
    node -e "const d=Object.keys(require('./package.json').dependencies); \
             for (const m of d) require(m); \
             console.log('依赖自检通过：' + d.length + ' 个');"

FROM node:20-bookworm-slim
ENV NODE_ENV=production TZ=Asia/Shanghai
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
EXPOSE 3000
CMD ["node", "src/index.js"]
