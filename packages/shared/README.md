# @app/shared

契约共享包：只放 DTO / 错误码 / 运行时 Zod schema，**不放业务实现、IO、env**。

## R1 公共契约

`@app/shared` 的公开入口导出 schema、由 schema 推导的 TypeScript 类型和状态常量。
后端 CommonJS 和前端构建工具均消费同一包；禁止从后端 entity 或 UI 类型导入契约。

| 导出 | wire 值 / 语义 |
|---|---|
| `AuthUserStatus` | `ACTIVE / MERGED / DISABLED`，账户生命周期，不是扫码状态 |
| `AgencyNodeStatus` | `ACTIVE / INACTIVE / DELETED`，当前代码实际写入值 |
| `OrderStatus` | `PENDING / RESERVED / COMPLETED / CANCELLED / FORFEITED / DISPUTED` |
| `PaymentTransactionStatus` | `pending / success / failed / cancelled`，保持原有大小写 |
| `ServiceLifecycleStatus` | `ACTIVE / INACTIVE / DELETED`，新公开词汇；现有 bool 字段尚未迁移 |

每项状态同时导出 `Z<Name>Enum`。`AgencyNodeStatus` 不接受只出现在旧注释中的
`SUSPENDED`；历史数据是否存在该值须由领域负责人核验，本包不静默映射。
这里只定义 wire 值，不决定订单初态、状态转换、权限、业务幂等或持久化。

## 命令与事件 envelope

- 公共元数据：`idempotencyKey`、`actor`、`occurredAt`、`correlationId`、`causationId`。
- 命令：另含 `commandId`、`commandVersion`、`commandType`、`payload`。
- 事件：另含 `eventId`、`eventVersion`、`eventType`、`payload`。
- 所有字段必填；根消息的 `causationId` 显式为 `null`。版本是正整数，时间必须带时区。
- `actor` 是 `{kind:'user'|'system',id:string}` 或 `{kind:'anonymous',id:null}`；
  可信 transport 必须从实际认证上下文构造 actor，不能依据客户端自报 actor 授权。
- Envelope 拒绝未知头字段，payload 只接受 JSON 对象及可序列化 JSON 值。
- 生产者负责生成并持久保存 ID/发生时间；重投同一事件保持 eventId 不变。
  correlationId 标记同一流程，causationId 引用直接原因消息的 commandId/eventId。
- idempotencyKey 只是协议字段；接收领域负责确定作用域、持久化去重、冲突规则及审计。
  schema 通过不代表已实现 exactly-once、状态机或安全校验。

## 验证

```sh
npm run build --prefix packages/shared
npm test --prefix packages/shared
npm run test:generate-api --prefix frontend
```

`npm test` 的 pretest 自动构建，不依赖干净 checkout 中不存在的 dist。
构建产物被 git 忽略，发布/CI 必须先构建共享包再运行消费者。
