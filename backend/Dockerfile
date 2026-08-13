# 后端 Dockerfile (生产环境 - 注入构建产物版)
# 直接基于 node:22-alpine 运行，跳过 npm install 和 build 步骤
# 依赖本地已经编译好的 dist 和 node_modules (如果可能)
# 或者在容器内仅安装生产依赖

FROM node:20-alpine

WORKDIR /app

# 安装构建工具 (用于编译 sqlite3 等原生依赖)
RUN apk add --no-cache python3 make g++

# 1. 复制 package.json 和 lock 文件
COPY package.json package-lock.json ./

# 2. 安装生产依赖 (这一步在 NAS 上可能仍需时间，但比完整构建快)
# 为了极致速度，如果本地和 NAS 架构一致(都是 x64/arm64)，甚至可以复制 node_modules
# 但为了稳妥，我们还是让它安装一次生产依赖
RUN npm install --production

# 3. 复制本地编译好的代码 (dist 目录)
# 注意：这要求在 docker build 之前，本地已经运行过 npm run build
COPY dist ./dist

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3001

# 暴露端口
EXPOSE 3001

# 启动命令
CMD ["node", "dist/src/main.js"]
