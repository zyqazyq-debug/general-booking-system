# OWNERSHIP_INVARIANTS 资源所有权不变量
任何跨角色/跨节点修改业务数据的操作，必须先通过本文件声明的 ownership 校验。Playbook §2.5 ownership-first 意识落地。

## 1. 用户信用账户（users.credit_balance / users.frozen_credit）
- 唯一入口一：UserFinancialService 的 6 个原子操作：
  freezeCredit / unfreezeCredit / burnCredit / addCredit / transferFrozenCredit / getCreditSummary
- 唯一入口二：PaymentSucceededListener 监听 OrderPaymentSucceededEvent 时调用 addCredit 充值
- ❌ 禁止：任何其他 service/listener/controller 直接操作 users 表的 credit_balance / frozen_credit 字段
- ❌ 禁止：使用 QueryBuilder / createQueryBuilder / raw SQL 直接 UPDATE users SET credit_balance=... 绕过上述两个入口

## 2. AgencyNode 分销节点 markup 定价字段（markup_type / markup_value）
- 只允许以下 actor 才能修改：
  a) 节点自身的 agent_id 对应的已登录 User（JWT sub === node.agent_id）
  b) 该节点的祖先链（从 parent 往上直到 provider）中的任何 agent，且 chain_status === ACTIVE
- ❌ 禁止：平台管理员（admin）直接修改代理节点定价（若管理员确有必要重置，走专门的 force-reset 流程，附 reason 字段 + 审计日志）
- ❌ 禁止：SAME_PARENT 导入时直接 SET markup_value（必须走 create+import 流程，由 agency-collection-mutation.service 统一 ownership 检查）
- 精度守卫：markup_type === 'PERCENT' 时 markup_value ∈ [0, 100]；'FIXED' 时 markup_value ≥ 0。否则直接抛 InvalidMarkupValueError

## 3. ServiceBlock（排班不可用时段）+ Service（服务本体）
- ServiceBlock.create/update/delete：actor.sub === service.owner_id
- Service 基础信息（name / duration / buffer_before 等）：actor.sub === service.owner_id
- ❌ 禁止：跨服务商修改他人的服务/排班（即使是 SUPER_ADMIN）
- 冲突检测前置：ServiceBlock 的任何 CRUD 必须先调用 conflict-detector.ts 的合法区间校验

## 4. CommissionRecord（佣金流水记录）
- Immutable：一旦 INSERT，任何角色均不允许 UPDATE / DELETE 该表行
- 若需修正：新增一条同 order_id + same level 的负向对冲记录，reason 字段必填
- 写时快照：每条 CommissionRecord 必须同时携带 snapshot_markup_type 和 snapshot_markup_value，保证历史佣金复算不被后续的 AgencyNode.markup* 现值污染

## 5. 架构层面 ownership
- 20+ 跨领域 Port 仅能在 domain-ports.module.ts / platform-ports.module.ts 两处绑定
- ❌ 禁止：controller / service 里直接 new XXXService()（必须走 Nest DI）
- 平台层 platforms/* 只能依赖 src/domains/<domain>/(ports/*|index.ts|dto/*|interfaces/*|runtime.ts|events/*)，与 DepCruiser 第 5 条规则对应
