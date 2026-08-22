# vendor —— 离线依赖包（可选）

服务器装不上 npm 依赖时（容器内上不了网、npm 源不稳、内存不够编译），
把预先打包好的 `node_modules.tar.gz` 放进这个目录，构建时就会**直接解压使用、完全不联网**。

    /opt/medops/server/vendor/node_modules.tar.gz

放进来后重跑 `bash deploy.sh` 即可。构建日志会显示「发现离线依赖包，直接解压（不联网）」。

注意：
- 这个包是给 **linux/x64 + node:20-bookworm-slim** 用的（里面 better-sqlite3 是编译好的原生模块）。
  架构对不上时构建会自检出来并自动改走在线安装，不会装出一个坏镜像。
- 目录空着完全不影响，构建会照常走在线安装。
