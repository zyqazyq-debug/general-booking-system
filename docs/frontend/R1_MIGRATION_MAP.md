# R1 前端迁移地图（证据与次序）

## 范围与结论

本文件是 Phase 0/R1 的只读证据地图，不定义新的业务规则，也不替代
`packages/shared`、后端 OpenAPI 或领域状态机。迁移后的唯一调用方向为：

`UI -> application facade -> generated HTTP client/adapter -> API`。

当前 `frontend/src/generated/api.ts` 是空 fallback；`frontend/src/types/api.ts` 和各
`api/*.ts` 仍手写 DTO/URL。因此，下面列出的所有手写调用都必须等共享契约负责人
交付 schema、OpenAPI 和生成 API 后才能迁移；不得以另一份前端类型替代真源。

## 阻断项：身份、预约和支付语义

### P0：QR 模拟身份可走到真实登录接口

- `frontend/src/core/auth/qr-login/simulate.ts:5-24` 固定生成 `demo` OpenID，随后调用
  注入的微信/QQ 登录适配器。
- `frontend/src/core/auth/qr-login/composables.ts:22-38` 在人工确认时无开发环境门禁地调用
  `simulateQrScanLogin`。
- `frontend/src/domains/login/pages/LoginImpl.vue:179-234` 打开微信或 QQ 登录弹窗即进入该
  人工确认链路；只有 URL `auto` 分支受 `import.meta.env.DEV` 限制。
- `frontend/src/domains/user/api/auth.ts:35-50` 将 OpenID 直接提交至 `/auth/wechat` 或
  `/auth/qq`。

迁移前置契约：真实 OAuth/扫码 ticket 的发起、回调、polling、取消、过期和错误码 DTO；
生产环境禁止使用模拟 identity。R2 不能保留 `demo` 生产路径。

### P0：创建预约和购买 intent 没有端到端幂等

- `frontend/src/domains/booking/composables/useBookingSubmitFlow.ts:24-34` 直接创建订单；
  `:59-66` 又直接创建购买 intent。
- `frontend/src/domains/booking/composables/useBookingCredit.ts:29-65` 直接查询信用点并再次
  直接创建购买 intent。
- `frontend/src/domains/booking/components/BookingFooterActions.vue:8-12` 没有 pending/disabled
  属性；`BookingModal.vue:87-106` 未投影提交状态。
- `frontend/src/domains/order/api/order.ts:7-21` 未接受 intent/key 或发送 `Idempotency-Key`。
- `frontend/src/utils/request.ts:175-257` 只处理 token refresh 的一次 401 重试，没有 mutation
  的弱网结果未知恢复语义。

迁移前置契约：稳定的 intent ID、`Idempotency-Key`、同 key 重放原结果、结果查询、
可显示状态和审计/trace correlation。前端只可对同一 intent 重试，不能生成第二笔业务命令。

### 支付现状：未接入真实支付主链，存在两份手写占位

- `frontend/src/domains/payment/api/payment.ts:19-34` 手写 `/payments/recharge` 与
  `/payments/:paymentNo/status`，未在产品路径发现调用者。
- `frontend/src/domains/user/components/panels/profile/composables/useProfilePanelState.ts:72-74`
  的“充值”仅提示“开发中”。
- 两处购买 intent 成功提示仍为“购买接口预留已创建”：
  `useBookingCredit.ts:52-60`、`useBookingSubmitFlow.ts:59-70`。

R1 需要支付负责人确定：创建预支付、渠道跳转/回调、查询、最终账务状态和禁止前端宣告
支付成功的响应模型。R2 前不得把 intent 成功当作支付成功。

## 所有 generic PATCH / DELETE 清单

这些 API 必须由生成 client 暴露为带语义的 command 或资源编辑 contract；涉及状态变化的
不能保留无约束 `data: any` PATCH。

| 现有位置 | 当前端点/方法 | 迁移目标 |
|---|---|---|
| `frontend/src/domains/library/api/distribution.ts:86-122` | collection PATCH、reparent PATCH、status PATCH（多处 `any`） | `DistributionApplication` 的编辑、重挂和启停命令；各自 DTO/并发版本。 |
| `frontend/src/domains/provider/api/schedule.ts:21-34` | `/schedules/:id` PATCH，`data: any` | Provider schedule 编辑 command；确认是否仍为有效领域。 |
| `frontend/src/pages/schedule/edit.vue:155,174` | schedule PATCH/DELETE | 页面改调 schedule facade；删除走明确生命周期命令。 |
| `frontend/src/pages/schedule/list.vue:298` | schedule PATCH | 页面改调 facade；不得内联 payload。 |
| `frontend/src/domains/service/pages/ServiceEditImpl.vue:207,231` | service PATCH/DELETE | Service application command；页面仅绑定 view model。 |
| `frontend/src/shared/api/service.ts:53-68,146-170` | service / service-block PATCH、DELETE | 拆入 provider/service facade，生成 request/response 类型。 |
| `frontend/src/domains/user/api/profile.ts:20,50` | user profile PATCH | Profile command，区分 locale、profile 与身份绑定。 |
| `frontend/src/domains/user/components/panels/profile/composables/useProfileEditorActions.ts:43` | profile PATCH | 改调 Profile application facade。 |

未发现前端对订单状态使用 `PATCH`；订单 UI 当前使用 confirm/complete/no-show/cancel
任务端点。后端仍存在通用订单 PATCH 的事实应由订单领域负责人移除或收紧，前端不得接入。

## Raw identity 与 Telegram 边界

| 证据 | 迁移/保留规则 |
|---|---|
| `frontend/src/domains/login/pages/LoginImpl.vue:191-207` 把全局 `onTelegramAuth` 传来的对象交给 `/auth/telegram` | 用生成的 ticket/callback contract 取代任意对象透传；不得把浏览器回调对象当身份真源。 |
| `frontend/src/platforms/telegram/index.ts:75-138` 仅转发满足签名 envelope 的 initData，并清理 URL 参数 | 保留为 Telegram adapter；只可调用 WebApp-login facade，`initDataUnsafe` 不得进入身份写入。 |
| `frontend/src/domains/user/components/panels/profile/composables/useProfileIdentityBinding.ts:32-54` 读取 `initDataUnsafe.user` | 当前仅为账户显示 fallback；R2 必须保持 display-only，任何绑定/授权决定必须以服务端已验证身份为准。 |
| `frontend/src/domains/admin/pages/AdminLoginImpl.vue:35-48` 保留 admin/admin123 demo 注释与前端角色提示 | 删除 demo 文案/死分支；前端角色仅是可见性投影，不能是授权判断。 |

## 可用性和 notes 的手工规则

### 可用性

- `frontend/src/domains/booking/composables/useBookingSlots.ts:34-59` 读取 slots 后按本地服务规则再次过滤。
- `frontend/src/domains/booking/composables/useBookingConfirmFlow.ts:50-60` 在提交前手工读取服务 active 状态。
- `frontend/src/domains/library/composables/useLibraryFilters.ts:20-53` 自建五分钟 availability cache。
- `frontend/src/shared/utils/booking-unavailable.ts:14-36` 用错误消息正则补充 unavailable 判断；
  `frontend/src/shared/composables/useBookingUnavailableGuard.ts:21-64` 保存页面级不可用标记。

生成 API 应提供已类型化的 availability 状态/原因码/观察时间。UI 可以显示 projection，
但不可自行把旧快照、英文错误文本或本地日历规则作为业务可预约的最终结论。

### notes 与兼容字段

- `frontend/src/domains/booking/composables/useBookingSource.ts:26-36` 从 `private_notes` 解析
  “说明”并显示为公共描述。
- `frontend/src/shared/utils/price-compat.ts:81-125` 以多套价格字段作本地 fallback，并直接
  写 debug telemetry。
- `frontend/src/domains/library/api/distribution.ts:57-80` 同时接收 `serviceId/service_id`、
  `private_note/private_notes` 等手写兼容字段。

这些兼容应由 adapter 的版本化 DTO 显式承担，并带弃用窗口/度量；UI 与领域 composable
不得继续解析 private notes 或猜测字段优先级。

## 手写 HTTP 调用迁移批次

`shared/api/request.ts` 只是 `utils/request.ts` 的再导出，不能作为 application facade。

1. **阻断先行**：booking、order、payment、auth/QR、Telegram WebApp；覆盖
   `domains/booking/**`、`domains/order/api/order.ts`、`domains/payment/api/payment.ts`、
   `domains/user/api/auth.ts`。
2. **资源与状态命令**：service/provider/schedule/distribution；覆盖
   `shared/api/service.ts`、`domains/provider/api/schedule.ts`、`domains/library/api/distribution.ts`，
   并替换 `pages/schedule/{edit,list}.vue` 和 `domains/service/pages/ServiceEditImpl.vue` 的直连。
3. **账户与管理**：user profile/identity/admin/referral；覆盖 `domains/user/api/**`、
   `domains/admin/api/admin.ts`、`domains/admin/pages/AdminUsersImpl.vue`。
4. **读模型和遗留页**：library、share、agent dashboard 及其 `request` 直连；迁移为已发布
   read facade，最后删除 `shared/api/request.ts` 的通用再导出使用方式。

## 生成 API 到前端 facade 的设计清单

共享契约负责人交付生成 API 后，每个 endpoint 只在 HTTP adapter 内出现一次；下游按下表调用。

| generated API 类别 | adapter/application facade | UI 消费者 |
|---|---|---|
| Auth / Telegram WebApp / identity scan | `AuthApplication`、`IdentityBindingApplication` | login、profile composables、Telegram adapter |
| Orders / reservation intent / availability / credit | `BookingApplication`、`OrderApplication` | booking、order、library view model |
| Payment prepay / status | `PaymentApplication` | profile/payment view model；不由 booking 直接 request |
| Service / block / provider schedule | `ProviderApplication` | provider/service/schedule 页面 |
| Agency collection / import / link / availability | `DistributionApplication` | distribution、library、share 页面 |
| User profile / locale / admin credit | `ProfileApplication`、`AdminApplication` | user/admin 页面 |

R2 适配器应负责字段命名、header、schema 校验、错误 envelope、trace/idempotency header；
application facade 负责命令 intent 生命周期和失效/刷新事件；Vue 页面和 composable 不保留 URL、
HTTP method 或后端错误字符串分支。

## R1 验收和停止条件

在不修改生成产物前，可做的静态验收：

```powershell
npm --prefix packages/shared run build
npm --prefix frontend run type-check
npm --prefix frontend run lint:arch
```

R2 的停止条件：未收到 Auth QR/OAuth、Telegram、预约幂等、支付、可用性及上述 generic mutation
的生成 request/response contract 与错误码/版本语义。不得用 `any`、手写 URL 或 UI fallback
绕过该条件。
