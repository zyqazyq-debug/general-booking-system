# CORE_INVARIANTS 业务域核心不变量（跨团队对齐的 SSoT）
所有代码修改、PR 审查、架构决策都必须至少不破坏下面的不变量。

## 1. 订单状态机（domains/order）
合法状态转换矩阵：
```
PENDING   ──confirm──▶ RESERVED
RESERVED  ──complete─▶ COMPLETED
RESERVED  ──cancel───▶ CANCELLED
RESERVED  ──forfeit──▶ FORFEITED
FORFEITED ──dispute──▶ DISPUTED
```
- 任何反向跳转、非矩阵上的跳转必须被 OrderStatusTransitionPolicy 拦截并抛异常
- 对同一订单执行写操作（confirm/complete/cancel/forfeit/dispute）时，order-lifecycle.service 必须持有 pessimistic_write 悲观锁 + 外层数据库事务，两条件缺一不可
- OrderRolePolicy 强约束：只有 PROVIDER 角色可触发 complete / forfeit；只有 CONSUMER 可触发 dispute；双方都能 cancel，但 PROVIDER 取消不触发信用金违约金

## 2. 用户信用账户守恒（domains/users + domains/payment）
- 任一用户的恒等式：`credit_balance + frozen_credit = C`（常数，只在 addCredit / burnCredit 外部注入时改变，任何内部订单流程中总和不变）
- 能修改用户 credit_balance 或 frozen_credit 的入口只允许有：
  ① user-financial.service 六大原子操作（freeze/unfreeze/burn/add/transferFrozen/getSummary）
  ② payment-succeeded.listener 监听 OrderPaymentSucceededEvent 时调 addCredit
- 任何绕过这两个入口直接操作 users.credit_balance/frozen_credit 的代码视为架构破坏
- 所有金额精度必须使用 Decimal.js，最终落库前统一 `toDecimalPlaces(2, Decimal.ROUND_HALF_UP)`

## 3. 佣金计算与分销链（domains/agency）
- AgencyNode 形成的分销链（agent → parent → ... → provider provider node）最大深度 ≤ 20（超过时 calculateCommission 抛 CommissionDepthLimitExceededError）
- CommissionRecord 一旦 `INSERT` 后视为 Immutable，不允许 UPDATE/DELETE；任何历史修正必须新增一条负向对冲记录并附 reason 字段
- 写时快照：每条 CommissionRecord 必须携带 snapshot_markup_type 和 snapshot_markup_value，不依赖后续 AgencyNode.markup_* 的现值
- CollectionQuotaSubscription 配额的购买 / 续费 / 过期 闭环必须通过对称的 adapter-port 设计，禁止跨域直接调实现类

## 4. 架构分层（全局）
```
最底层：domain 纯规则（零框架/IO依赖，不能 import NestJS / TypeORM / 任何 adapter）
    ↑ 被调用
application services（用例编排，仅依赖 ports 接口）
    ↑ 被调用
adapters（实现 ports 接口）
    ↑ 注入
controllers/listeners/bot-updates（HTTP/事件/Bot 入口，只做参数路由和 DTO 校验）
    ↑
runtime.ts（仅 Composition Root 可 import）
```
- Runtime 导入守卫：只有 app.module.ts、domain-ports.module.ts、platform-ports.module.ts、main.ts 四个装配根文件可以 import 任意 runtime.ts；其他文件一律禁止（check_runtime_imports.js 会在 CI 中 fail-closed）
- 跨域导入：仅允许 `import { X } from '@app/<other-domain>/index'` 形式，禁止深路径引用对方 services/domain/adapters 内部文件
