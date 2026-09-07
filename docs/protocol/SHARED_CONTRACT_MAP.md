# SHARED_CONTRACT_MAP 跨端契约共享映射图
R1：共享包是 wire enum / request / response / error / event 的唯一真源。
领域策略保留在后端领域中；本轮没有切换业务 controller 或 UI。

## R1 已发布的最小公共契约

| 契约 | 唯一声明 | 当前接入边界 |
|---|---|---|
| Actor、命令 / 事件 envelope | packages/shared/src/envelopes/message-envelope.schema.ts | commandId/commandVersion/commandType 或 eventId/eventVersion/eventType，加 payload；公共头为 idempotencyKey/actor/occurredAt/correlationId/causationId。禁止默认生成元数据，根 causationId 显式 null；运行时去重和 actor 鉴权仍由领域/transport 承担 |
| AuthUserStatus | packages/shared/src/enums/auth-user-status.ts | ACTIVE/MERGED/DISABLED；来自账户生命周期，不覆盖登录票据/扫码流程 |
| AgencyNodeStatus | packages/shared/src/enums/agency-node-status.ts | ACTIVE/INACTIVE/DELETED；按真实 mutation 写入值定义。旧 SUSPENDED 注释及可能历史数据尚未核验，不自动映射 |
| OrderStatus | packages/shared/src/enums/order-status.ts | 六态词汇；订单初态与转换由订单领域决定，禁止通过共享包添加通用状态 PATCH |
| PaymentTransactionStatus | packages/shared/src/enums/payment-transaction-status.ts | pending/success/failed/cancelled；保留当前 wire 小写值 |
| ServiceLifecycleStatus | packages/shared/src/enums/service-lifecycle-status.ts | ACTIVE/INACTIVE/DELETED；仅公开词汇，尚未替换 is_active/is_deleted，未在本轮增加响应字段 |
| 错误码、分页 | packages/shared/src/error-codes/index.ts；packages/shared/src/dtos/common/pagination.schema.ts | 既有 D2 定义；后端错误码和 DTO 尚未替换，分页 query 的字符串转换策略仍待 R2 对齐 |

所有 enum 的运行时常量和 TypeScript 类型都从同一个 Zod enum 推导，不增加第二份枚举。
公共包仅从自身模块与 Zod 导入，无 NestJS/TypeORM/UI/IO/env 依赖。

## 生成门禁（R1）

前端生成器为 `frontend/scripts/generate-api.mjs`，明确指定同一份 OpenAPI JSON 输入：

```sh
npm run generate:api --prefix frontend -- --input ../docs/protocol/openapi.json
npm run generate:api --prefix frontend -- --input ../docs/protocol/openapi.json --check
npm run test:generate-api --prefix frontend
```

`openapi.json` 是 R2 的确定性输入。当前提交的是从已实现公开 `GET /health` 响应核验出的最小基线，
用于消除空 fallback 并验证生成链；它不声称覆盖完整后端 API。新增业务端点必须先由后端 Swagger
或已审查 DTO 核验后写入同一输入。生成器也支持显式 HTTP URL；本地 Swagger 的源码路径为 `/api-json`，
不能再硬编码 `3000/docs-json`。
缺输入、读取/HTTP/JSON/生成错误、空 paths、无 HTTP operation、空 DTO/schema、
缺失成功响应契约或生成 TypeScript 缺失输入 operation，均失败并返回非零。
200/201 等成功响应须显式描述 payload；无响应体使用 204/205（重定向可用 3xx）。
允许内联 schema，不强制非空 components.schemas。生成结果的 operation/response/payload
不能退化为 any/unknown/空对象。失败不覆盖已有工件、不制造空 fallback。
成功后才以同目录临时文件替换；`--check` 只比较，不写文件。

R2 已由上述输入生成非空 `frontend/src/generated/api.ts`。`frontend/src/generated/README.md` 说明了
确定性输入、校验命令和当前覆盖边界。
`packages/shared` 的 `npm test` 自动先 build；不依赖未跟踪的 dist。

## 尚未迁移的业务接口（R2 接入清单）
| 契约实体 | 当前后端真源（domain/dto） | 当前前端镜像（types/api.ts 或 domains/*/api/*） | 是否双份手工维护 | 计划迁移目标 |
|---|---|---|---|---|
| 创建订单请求 CreateOrderDto | backend/src/domains/order/dto/create-order.dto.ts | frontend/src/domains/order/api/order.ts createOrder 参数 | ✅ 手工双份，有漂移风险 | packages/shared/src/dtos/order（待建）+ 自动生成客户端 |
| 订单过滤 OrderFilterDto | backend/src/domains/order/dto/order-filter.dto.ts | frontend/src/domains/order/api/order.ts getOrders 参数 | ✅ 手工双份 | 同上 |
| 创建服务 CreateServiceDto | backend/src/domains/services/dto/create-service.dto.ts | frontend/src/shared/api/service.ts Partial<Service> | ✅ 手工双份 | packages/shared/src/dtos/services（待建） |
| 创建分销节点 CreateAgencyNodeDto | backend/src/domains/agency/dto/create-agency-node.dto.ts | frontend/src/domains/library/api/distribution.ts；frontend/src/domains/distribution/api/agent.ts | ✅ 多处漂移 | packages/shared/src/dtos/agency（待建） |
| 登录/注册 LoginDto / CreateAuthUserDto | backend/src/domains/auth/dto/login.dto.ts、create-auth-user.dto.ts | frontend/src/domains/user/api/auth.ts | ✅ 手工双份；register.schema.ts 尚未接入 | packages/shared/src/dtos/auth（待建） |
| 业务错误码枚举 | backend/src/shared/common/exceptions/business-error-code.ts | frontend/src/utils/error-code.ts | ✅ 手工双份 | packages/shared/src/error-codes/index.ts |
| 分页参数 PaginationDto | backend/src/shared/common/dto/pagination.dto.ts | 前端各 API 内联 page/limit 字段 | ✅ 手工双份 | packages/shared/src/dtos/common/pagination.schema.ts |
| 创建支付 CreatePrepayDto | backend/src/domains/payment/dto/create-prepay.dto.ts | frontend/src/domains/payment/api/payment.ts（路径/字段待对齐） | ✅ 手工双份 | packages/shared/src/dtos/payment（待建） |

## 共享契约规则（与 project_rules.md 一致）
- packages/shared 只放三类：DTO / 错误码 / 运行时 schema 校验（Zod / Valibot）
- 不放业务实现、不读 env、不做 IO
- 新增契约必须先加 SHARED_CONTRACT_MAP 一行记录再改代码
