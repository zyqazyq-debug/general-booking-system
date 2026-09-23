# 模块责任与跨层边界

本文说明代码的责任归属及改动时必须保留的边界；业务状态和金额规则以
[`CORE_INVARIANTS.md`](./CORE_INVARIANTS.md) 为准，发布状态和证据格式以
`ops/contracts/` 的版本化契约为准。这里不以运行手册代替可执行契约。

## 责任表

| 责任域 | 唯一写入/决策责任 | 对外边界 | 不允许的捷径 |
|---|---|---|---|
| 订单 `backend/src/domains/order` | 订单状态转换、时段占用、订单事件与通知投递记录 | 领域规则、应用服务、`ports/`、`events/`、公开 `index.ts` | Controller/Telegram 入口直接改订单状态；跨域调用用户或机构内部服务；事务提交前发非持久通知 |
| 用户财务 `backend/src/domains/users` | 信用余额和冻结余额的原子变更 | `user-financial.service.ts` 经端口向订单域提供操作 | 订单、支付、机构域直接写 `credit_balance` 或 `frozen_credit` |
| 机构与佣金 `backend/src/domains/agency` | 机构归属、定价快照、佣金计算与记录 | 端口、事件与公开导出 | 读取可变机构现值来重算历史佣金；更新既有佣金记录 |
| Telegram `backend/src/platforms/telegram` | Bot API 适配、Webhook/轮询入口、入站去重 | 应用用例和领域端口 | Bot 更新处理器直接跨域写库；把外部请求成功当作业务提交成功 |
| 前端 `frontend/src/domains` | 场景交互、展示状态和 API 适配 | 页面/组件调用 composable，API 类型由后端 OpenAPI 生成 | Vue 组件复制后端状态转换、金额结算或权限规则；手改生成的 API 类型 |
| 发布 `ops/release` | 不可变发布身份、租约/栅栏、外部动作回执与恢复 | `ops/contracts`、状态机、受限执行器和独立读回 | 手改部署状态/锁；绕过回执直接切流；把本地测试 PASS 称作 G4/G5 验收 |

## 真源与依赖方向

1. 业务状态和金额约束由纯规则及版本化契约定义；应用服务负责事务和编排，适配器负责数据库、HTTP、Bot 与外部平台。入口层只做鉴权、校验和转发。
2. 跨域依赖优先经 `ports/` 和组合根注入。`index.ts` 是公开导出边界，不等于允许调用另一域的内部实现。`runtime.ts` 只由批准的组合根导入。
3. 后端 OpenAPI 是前端接口类型的来源。`npm run quality:gates` 会重新生成临时客户端并与提交产物逐字比较；变更接口时必须同时通过该门禁。
4. 订单、Telegram 入站和发布动作分别有自己的状态机；外部动作必须先形成可审计意图，再以独立读回证明结果。网络超时、进程健康和回执成功不可互相替代。
5. 预发布与生产的身份、网络、数据、密钥和路由必须分离。G4 不完整时，不得把预发布探测或本地单测提升为生产授权。

## 当前执行情况与待收紧处

- `tools/lint/check-runtime-imports.js` 与 `backend/.dependency-cruiser.js` 已限制运行时导入、循环、共享层反向依赖和多数跨域深路径；后者仍保留对 `auth/`、若干公开子目录及 `runtime.ts` 的例外。收紧例外应先列出真实依赖并迁移到端口，不可简单删规则或新增豁免来使门禁变绿。
- `order/domain/order-role-policy.ts` 与 `order/domain/order-status-transition.policy.ts` 仍直接依赖 NestJS 异常，尚非零框架依赖的纯领域层。迁移时应先定义领域错误，再由入口/应用边界映射为现有 HTTP 错误，保持外部契约不变。
- `users/adapters/auth-users.adapter.ts` 的 `save/saveTx` 会从认证 DTO 覆写余额字段，`auth/services/account-merge.service.ts` 也直接合并并清零余额。这是与上述唯一写入责任尚未对齐的现存缺口，尤其可能让普通身份资料更新覆盖并发的财务变更。修复必须先定义合并资金账本和事务锁顺序，再拆分身份字段写入与财务转账，不能只删掉赋值语句。
- 订单创建当前直接写 `RESERVED` 并冻结信用，而确认接口只接受 `PENDING`。两条路径的产品语义尚未统一；在确定是否需要人工确认、待确认超时与占位策略前，不改变创建状态或放宽状态转换。
- 旧预发布基线的 Telegram 是直连轮询；新候选使用独立代理。回滚可用性因此不能只按容器健康或 Web 探测判定，必须证明回滚基线自身可用的 Telegram 出站和唯一投递者。
- 订单确认现已在事务中以 `pessimistic_write` 锁住订单，提交后才发通知。此单元验证不替代 PostgreSQL 并发验证。

## 合并与发布门禁

每个变更应说明：所属责任域、受影响的公开契约、状态机迁移、失败/重试行为、回滚路径及测试证据。代码门禁为 `npm run quality:gates`；运维动作还必须通过 `ops/check` 完整测试、真实环境独立读回及相应 G4/G5 回执。生产变更只在 G4 完整通过、回滚方案及生产前置证据重新确认后执行。
