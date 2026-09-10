# 环境对比清单（dev / preprod / prod）

本清单汇总当前三套环境在域名、端口、IP、发布方式与依赖上的差异，便于快速查阅与排查。

## 概览矩阵

| 项 | dev（本地开发） | preprod（NAS 预发/灰度） | prod（NAS 生产） |
|---|---|---|---|
| 入口域名 | 无固定域名（本机） | `booking-preprod.happybooking.uk` → 专用 Cloudflare Tunnel | `app.happybooking.uk` → 生产入口 |
| 入口 IP | 开发机本地 | NAS：`192.168.3.5` | NAS：`192.168.3.5` |
| 网关（静态+反代） | Vite dev server 兼代理 | Nginx 容器 | Nginx 容器 |
| 前端端口 | `8443`（Vite） | green `127.0.0.1:18082` / blue `127.0.0.1:18083` → gateway:8080 | 由生产 edge 发布，gateway 内部监听 8080 |
| 后端端口（服务监听） | `3001`（Nest） | `3001`（容器内，不映射宿主机） | `3001`（容器内，不映射宿主机） |
| API 路径 | `/api/*` 由 Vite 代理到 `localhost:3001` | `/api/*` 由 Nginx 反代至 `backend:3001/api/` | `/api/*` 由 Nginx 反代至 `backend:3001/api/` |
| 健康检查 | `http://localhost:3001/livez` 或经 Vite 代理 | `https://booking-preprod.happybooking.uk/livez`、`/readyz`、`/__ops/version` | `/livez`、`/readyz`、`/__ops/version` |
| 短链规则 | 裸 slug 由 Vite 代理至后端 `/api/link/resolve/<slug>` | Nginx 裸 slug → 后端 `/api/link/resolve$uri`；`/s/:slug`、`/r/:code` 由后端 302 跳前端路由 | 同 preprod |
| Postgres | 可用本地或直连 NAS | 独立容器：`5432`（容器内），宿主机仅 `127.0.0.1:5434` | 生产容器：宿主机 `5433:5432`（LAN 可连） |
| Redis | 可本地或直连 NAS | 独立容器，不对外端口 | 宿主机 `6379:6379`（LAN 可连） |
| 核心 env（示例） | `NODE_ENV=development` 等 | `NODE_ENV=production`；`ALLOWED_ORIGINS=https://preprod...`；`API_URL=https://preprod.../api`；`TYPEORM_SYNCHRONIZE=false` | 与 preprod 相同，域名为 `https://app.happybooking.uk` |
| Telegram | polling；token=dev 专用 | 独立预发 bot；候选以 webhook 模式验证，单例 worker 与 egress 受状态机控制 | 独立生产 bot；HTTPS webhook |
| 发布方式 | 本地 `npm run dev` | 仅 root-owned fenced control-plane，按 G4 状态机推进 | 仅在 G4 通过及回滚方案验证后按生产发布控制面推进 |

## 端口差异摘要

- dev：`8443`（前端 Vite）+ `3001`（后端）。
- preprod：green `18082` / blue `18083`（均仅 loopback）+ 后端 `3001`（容器内）；Redis 不对外。
- prod：`8080`（网关，域名 `app.happybooking.uk` 指向）+ 后端 `3001`（容器内）；Postgres `5433`；Redis `6379`。

## 发布/运维动作

- dev（本地）：`npm run dev`（根目录脚本进入 `frontend`）。
- preprod（NAS）：受保护目录 `/volume1/happybooking/booking-preprod`。禁止直接
  `docker compose up/down/pull`；必须使用 root-owned
  `/usr/local/libexec/happybooking/run-booking-preprod-control-plane`，并遵循
  [FENCED_EXECUTOR_RUNBOOK.md](../../ops/release/FENCED_EXECUTOR_RUNBOOK.md) 的租约、证据、回读和回滚状态机。
- prod（NAS）：生产发布不复用预发布 launcher；仅在 G4 完整通过后使用经审核的生产发布流程。

## NAS 关键路径

- 预发目录：`/volume1/happybooking/booking-preprod`
  - 不可变版本：`releases/<releaseId>`
  - 运行环境：`.env`（root `0600`）
  - G4 证据、回执与密钥：`.g4/`
  - 数据面有意保留在 `/volume1/homes/realzyq/booking-preprod-data`，不得随控制根迁移或清理
- 生产目录：`/volume1/homes/realzyq/booking-prod`（结构同上）

## 机器人/Telegram

- dev（本地）
  - `TELEGRAM_BOT_TOKEN=<dev 专用>`
  - `TELEGRAM_BOT_MODE=polling`
  - `TELEGRAM_ENABLE_WEBHOOK=false`
  - 可选：`TELEGRAM_PROXY_URL`（如需走代理）

- preprod（预发/灰度）
  - 使用独立预发 bot，不复用生产 token；密钥只从 root-only secret 文件注入。
  - API slot 使用 `TELEGRAM_BOT_MODE=webhook`、`TELEGRAM_ENABLE_WEBHOOK=true`，入口固定为
    `https://booking-preprod.happybooking.uk/telegram/webhook`。
  - 单例 order worker 不接收 Telegram 更新：其 `polling` 配置同时保持
    `TELEGRAM_ENABLE_WEBHOOK=false` 和 `TELEGRAM_POLLING_DELETE_WEBHOOK_ON_STARTUP=false`，只负责 outbox 投递。
  - API slot 与 order worker 的启停、转移和回读均由预发布状态机控制，禁止手工启动第二个单例。

- prod（生产）
  - `TELEGRAM_BOT_TOKEN=<prod 专用>`
  - 运行模式：`polling` 或 `webhook`（推荐 webhook + HTTPS 域名）
  - 约束：同一 token 同一时间只能被**一个实例**拉取更新；否则会 409 冲突

## 注意事项

- 预发与生产的 Telegram 机器人不得共用同一 token；预发使用独立 bot，生产 bot 保持不动。
- 若需让 dev 直连 NAS 数据库，建议使用只读账号或独立库名，避免误改生产数据；生产 Postgres 对内网开放 `5433`，谨慎授权。

## 代码与配置参考

- dev 端口与代理：`frontend/vite.config.ts`
- 后端监听 `0.0.0.0`、启动日志打印 env/db/api：`backend/src/main.ts`
- 短链跳转 `/s/:slug`、`/r/:code`：`backend/src/app.controller.ts`
- 健康检查路由：`backend/src/shared/health/health.controller.ts`
