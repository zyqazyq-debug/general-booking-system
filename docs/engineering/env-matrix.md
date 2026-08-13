# 环境对比清单（dev / preprod / prod）

本清单汇总当前三套环境在域名、端口、IP、发布方式与依赖上的差异，便于快速查阅与排查。

## 概览矩阵

| 项 | dev（本地开发） | preprod（NAS 预发/灰度） | prod（NAS 生产） |
|---|---|---|---|
| 入口域名 | 无固定域名（本机） | 建议 `preprod.happybooking.uk` → NAS:8081（可接入 Cloudflare/Tunnel） | `app.happybooking.uk` → NAS:8080 |
| 入口 IP | 开发机本地 | NAS：`192.168.3.5` | NAS：`192.168.3.5` |
| 网关（静态+反代） | Vite dev server 兼代理 | Nginx 容器 | Nginx 容器 |
| 前端端口 | `8443`（Vite） | `8081`（宿主机 → gateway:80） | `8080`（宿主机 → gateway:80） |
| 后端端口（服务监听） | `3001`（Nest） | `3001`（容器内，不映射宿主机） | `3001`（容器内，不映射宿主机） |
| API 路径 | `/api/*` 由 Vite 代理到 `localhost:3001` | `/api/*` 由 Nginx 反代至 `backend:3001/api/` | `/api/*` 由 Nginx 反代至 `backend:3001/api/` |
| 健康检查 | `http://localhost:3001/health` 或经 Vite 代理 | `http://<域名或IP>:8081/health`（网关反代） | 建议同 preprod 统一暴露 `/health` |
| 短链规则 | 裸 slug 由 Vite 代理至后端 `/api/link/resolve/<slug>` | Nginx 裸 slug → 后端 `/api/link/resolve$uri`；`/s/:slug`、`/r/:code` 由后端 302 跳前端路由 | 同 preprod |
| Postgres | 可用本地或直连 NAS | 独立容器：`5432`（容器内），宿主机仅 `127.0.0.1:5434` | 生产容器：宿主机 `5433:5432`（LAN 可连） |
| Redis | 可本地或直连 NAS | 独立容器，不对外端口 | 宿主机 `6379:6379`（LAN 可连） |
| 核心 env（示例） | `NODE_ENV=development` 等 | `NODE_ENV=production`；`ALLOWED_ORIGINS=https://preprod...`；`API_URL=https://preprod.../api`；`TYPEORM_SYNCHRONIZE=false` | 与 preprod 相同，域名为 `https://app.happybooking.uk` |
| Telegram | polling；token=dev 专用 | polling（或独立预发 bot）；当前 token=DUMMY 避免与 prod 冲突 | 生产 bot（token=prod 专用），polling 或 webhook（HTTPS 域名） |
| 发布方式 | 本地 `npm run dev` | NAS：`docker compose up -d --build` | NAS：`docker compose up -d --build` |

## 端口差异摘要

- dev：`8443`（前端 Vite）+ `3001`（后端）。
- preprod：`8081`（网关）+ 后端 `3001`（容器内）；Postgres 仅 `127.0.0.1:5434`；Redis 不对外。
- prod：`8080`（网关，域名 `app.happybooking.uk` 指向）+ 后端 `3001`（容器内）；Postgres `5433`；Redis `6379`。

## 发布/运维动作

- dev（本地）：`npm run dev`（根目录脚本进入 `frontend`）。
- preprod（NAS）：目录 `/volume1/homes/realzyq/booking-preprod`，执行  
  `sudo /usr/local/bin/docker compose up -d --build`。  
  可回滚：`/volume1/homes/realzyq/booking-preprod/.deploy/rollback.sh <timestamp>`。
- prod（NAS）：目录 `/volume1/homes/realzyq/booking-prod`，执行  
  `sudo /usr/local/bin/docker compose up -d --build`。

## NAS 关键路径

- 预发目录：`/volume1/homes/realzyq/booking-preprod`
  - Compose：`docker-compose.yml`
  - Nginx：`ops/network/nginx.conf`
  - 环境变量：`.env`
  - 数据目录：`data/postgres`、`data/redis`
  - 快照与回滚：`.deploy/snapshots/`、`.deploy/rollback.sh`
- 生产目录：`/volume1/homes/realzyq/booking-prod`（结构同上）

## 机器人/Telegram

- dev（本地）
  - `TELEGRAM_BOT_TOKEN=<dev 专用>`
  - `TELEGRAM_BOT_MODE=polling`
  - `TELEGRAM_ENABLE_WEBHOOK=false`
  - 可选：`TELEGRAM_PROXY_URL`（如需走代理）

- preprod（预发/灰度）
  - 当前设置：`TELEGRAM_BOT_TOKEN=DUMMY`（避免与生产 bot 的 polling 冲突造成 409）
  - 推荐：如需在预发真实验证，申请**独立预发 bot**，使用单独 token；保持  
    `TELEGRAM_BOT_MODE=polling`，`TELEGRAM_ENABLE_WEBHOOK=false`（内网无公网 HTTPS 时）
  - 若将来为预发接入公网 HTTPS，可改用 webhook：设置 `TELEGRAM_ENABLE_WEBHOOK=true` 与 `TELEGRAM_WEBHOOK_URL`

- prod（生产）
  - `TELEGRAM_BOT_TOKEN=<prod 专用>`
  - 运行模式：`polling` 或 `webhook`（推荐 webhook + HTTPS 域名）
  - 约束：同一 token 同一时间只能被**一个实例**拉取更新；否则会 409 冲突

## 注意事项

- 预发与生产的 Telegram 机器人不要共用同一 token。预发已将 `TELEGRAM_BOT_TOKEN=DUMMY`，避免 polling 冲突导致 409。
- 若需让 dev 直连 NAS 数据库，建议使用只读账号或独立库名，避免误改生产数据；生产 Postgres 对内网开放 `5433`，谨慎授权。

## 代码与配置参考

- dev 端口与代理：`frontend/vite.config.ts`
- 后端监听 `0.0.0.0`、启动日志打印 env/db/api：`backend/src/main.ts`
- 短链跳转 `/s/:slug`、`/r/:code`：`backend/src/app.controller.ts`
- 健康检查路由：`backend/src/shared/health/health.controller.ts`
