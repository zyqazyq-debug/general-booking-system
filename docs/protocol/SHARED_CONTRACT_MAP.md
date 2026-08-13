# SHARED_CONTRACT_MAP 跨端契约共享映射图
（D2 轮 packages/shared 建立后这里会补充具体 DTO/Schema 映射表）

## 当前跨端契约现状（SSoT 缺口状态）
| 契约实体 | 当前后端真源（domain/dto） | 当前前端镜像（types/api.ts 或 domains/*/api/*） | 是否双份手工维护 | 计划迁移目标 |
|---|---|---|---|---|
| 创建订单请求 CreateOrderDto | backend/src/domains/order/dto/create-order.dto.ts | frontend/src/types/api.ts CreateOrderRequest | ✅ 手工双份，有漂移风险 | packages/shared/dtos/order/create-order.schema.ts (Zod) + openapi-typescript 自动生成 |
| 订单过滤 OrderFilterDto | backend/src/domains/order/dto/order-filter.dto.ts | frontend/src/types/api.ts OrderListParams | ✅ 手工双份 | 同上 |
| 创建服务 CreateServiceDto | backend/src/domains/services/dto/create-service.dto.ts | frontend/src/domains/provider/service/api/*.ts | ✅ 手工双份 | packages/shared/dtos/services |
| 创建分销节点 CreateAgencyNodeDto | backend/src/domains/agency/dto/create-agency-node.dto.ts | frontend/src/types/api.ts + agent/distribution 页面内联类型 | ✅ 三处漂移 | packages/shared/dtos/agency |
| 登录/注册 LoginDto / RegisterDto | backend/src/domains/auth/dto/*.ts | frontend/src/core/auth/* types | ✅ 手工双份 | packages/shared/dtos/auth |
| 业务错误码枚举 | backend/src/shared/common/exceptions/business-error-code.ts | frontend/src/utils/error-code.ts | ✅ 手工双份 | packages/shared/error-codes/index.ts |
| 分页参数 PaginationDto | backend/src/shared/common/dto/pagination.dto.ts | 前端各 API 内联 page/limit 字段 | ✅ 手工双份 | packages/shared/dtos/common/pagination.schema.ts |
| 创建支付 CreatePrepayDto | backend/src/domains/payment/dto/create-prepay.dto.ts | 前端 request.ts payment 方法 | ✅ 手工双份 | packages/shared/dtos/payment |

## 共享契约规则（与 project_rules.md 一致）
- packages/shared 只放三类：DTO / 错误码 / 运行时 schema 校验（Zod / Valibot）
- 不放业务实现、不读 env、不做 IO
- 新增契约必须先加 SHARED_CONTRACT_MAP 一行记录再改代码
