# TEST_PYRAMID 测试金字塔现状与覆盖地图
当前项目测试形态 = 8 个纯规则单元 + ~10 个服务集成 + 3 个 E2E。高风险域（auth/payment/notification）覆盖率为 0，是下一阶段补齐重点。

```
       /\        E2E  3个：booking-flow / agency-import-confirm / app.e2e(health)
      /  \       Service/Integration  ~10个：order-lifecycle, order-financial,
     /    \                                         order-validator, agency-pricing,
    /______\                                        services, telegram-adapters
       Unit  ~8个：conflict-detector, time-slot-generator, commission-calculator,
                  3个 order 纯 policy (transition/settlement/role), price-strategy
```

## E2E 三件套（backend/test/）
- [booking-flow.e2e-spec.ts](d:/用户目录/桌面/编程/通用预约系统/backend/test/booking-flow.e2e-spec.ts)：注册服务商 → 建服务 → 分销A加价 → 导入B再加价 → 充值 → 下单 → 软删除断言（完整三级分销价格链路）。**双 DB 支持**：默认 SQLite + synchronize（零配置）；`npm run test:e2e:pg` 切换真实 PG，要求库名含 test/e2e。
- [agency-import-confirm.e2e-spec.ts](d:/用户目录/桌面/编程/通用预约系统/backend/test/agency-import-confirm.e2e-spec.ts)：SAME_PARENT 重复导入语义 + 负加价值 400 拦截。
- [app.e2e-spec.ts](d:/用户目录/桌面/编程/通用预约系统/backend/test/app.e2e-spec.ts)：/health 冒烟，容忍 Telegram 亚健康（不应在 CI 强制阻塞，因为它需要真实 Bot token）。

## 覆盖热力图（Domain → Pure Policy → Service → Tools → Listeners → Controller）
| Domain | Pure Policy (Unit) | Application Service (Integration) | Algorithm Utils (Unit) | Controller | Event Listener | Adapter |
|---|---|---|---|---|---|---|
| order | ★★★★ 3个 policy (transition/settlement/role) | ★★★★ 2个 (lifecycle/financial/validator.spec) | ★★★★ order-validator.spec | - | - | - |
| services | - | - | ★★★★ conflict-detector + time-slot-generator | - | - | - |
| agency | - | ★★★ agency-pricing.service.spec | ★★★★ commission-calculator + price-strategy | - | ★★ commission-listener.spec | - |
| telegram | N/A | N/A | N/A | N/A | N/A | ★★★ 5个 spec (auth/users/order/booking/agency) |
| auth | - | - | - | - | - | 🔴 0（最高风险缺口） |
| payment | - | - | - | - | - | 🔴 0（最高风险缺口：createPrepay 幂等、notify 重复回调） |
| notification | - | - | - | - | - | 🔴 0（通知失败重试 / 降级） |
| users | - | - | - | - | - | ⚪ 0（六大数据操作已有悲观锁，建议补 UT 断言守恒） |
| admin | - | - | - | - | - | 0 |
| link | - | - | - | - | - | 0 |
| calendar-sync | - | - | - | - | - | 0 |
| product-listing | - | - | - | - | - | 0 |
| referral | - | - | - | - | - | 0 |
| resources | - | - | - | - | - | 0 |
| system-config | - | - | - | - | - | 0 |

## CI 中执行的测试集
- gates job 现有：`cd backend && npm test`（即所有 Unit + Service Integration，21 suites / 74 tests）
- gates job 待补（D0-A）：SQLite E2E（排除 app.e2e-spec，因为会真实起 HTTP）、`npm run lint:arch`

## 下一阶段优先补齐建议
按 ROI 排序：
1. **payment**：MockPaymentProvider 基础上补 createPrepay 失败分支 + handleNotify 幂等 + escrow 加减平衡 UT；P0
2. **auth**：JwtAuthGuard + RolesGuard 组合、密钥轮转、合并账户去重；P0
3. **users**：六大数据操作断言 credit_balance + frozen_credit 守恒；P1
4. **notification**：Telegram 发送失败重试 / 死信降级；P1
