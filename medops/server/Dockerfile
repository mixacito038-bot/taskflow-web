# 急救设备巡检系统 · 后端镜像（多阶段；npm ci 在同架构层执行，better-sqlite3 原生模块可用）
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# 可选的离线依赖包。目录为空时这一行也不会失败（vendor/README.md 一定存在）。
# 服务器容器内上不了网 / npm 源不稳 / 内存不够编译时，把 node_modules.tar.gz 放进去即可。
COPY vendor ./vendor

# 国内服务器直连 registry.npmjs.org 经常超时或半途断流，
# 腾讯云部署默认传入 https://registry.npmmirror.com（见 deploy/tencent/docker-compose.yml）。
# 留空则用 npm 默认源，其余部署方式行为不变。
ARG NPM_REGISTRY=

# npm 有个长期存在的毛病：装到一半失败时打印「Exit handler never called!」却**以 0 退出**，
# 于是产出一个「构建成功但缺包」的镜像，服务起来后才在运行时崩。网络抖动也会造成同样结果。
# 所以这里刻意**不看 npm 的退出码**，而是每轮装完都逐个 require 全部生产依赖来判定成败
#（顺带验证 better-sqlite3 的原生模块能否加载）——按结果重试，而不是按返回值重试。
# 三轮都不成就让构建失败，绝不产出坏镜像。
RUN set -u; \
    VERIFY="const d=Object.keys(require('./package.json').dependencies); \
            for (const m of d) require(m); \
            console.log('依赖自检通过：' + d.length + ' 个');"; \
    ok=0; \
    if [ -f vendor/node_modules.tar.gz ]; then \
      echo "==== 发现离线依赖包，直接解压（不联网）===="; \
      tar xzf vendor/node_modules.tar.gz; \
      if node -e "$VERIFY"; then ok=1; \
      else echo "离线包在本机不可用（架构或 node 版本不符），改走在线安装"; rm -rf node_modules; fi; \
    fi; \
    rm -rf vendor; \
    if [ "$ok" = 1 ]; then exit 0; fi; \
    npm config set fetch-retries 3; \
    npm config set fetch-retry-maxtimeout 60000; \
    FALLBACK=https://registry.npmjs.org; \
    for i in 1 2 3; do \
      if [ "$i" = 3 ] || [ -z "$NPM_REGISTRY" ]; then REG="$FALLBACK"; else REG="$NPM_REGISTRY"; fi; \
      echo "==== 第 $i 次安装依赖（源：$REG）===="; \
      npm config set registry "$REG"; \
      npm ci --omit=dev --no-audit --no-fund || echo "（npm 报错，继续按实际结果判定）"; \
      if node -e "$VERIFY"; then ok=1; break; fi; \
      echo "第 $i 次装完不完整（npm 可能报了 Exit handler never called），清理后重试"; \
      rm -rf node_modules ~/.npm/_cacache; \
    done; \
    [ "$ok" = 1 ] || { echo "连续 3 次都没装全依赖：请确认服务器能稳定访问 npm 源，或在 .env 里改 NPM_REGISTRY"; exit 1; }

FROM node:20-bookworm-slim
ENV NODE_ENV=production TZ=Asia/Shanghai
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
EXPOSE 3000
CMD ["node", "src/index.js"]
