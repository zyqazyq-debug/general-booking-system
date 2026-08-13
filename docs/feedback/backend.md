# 本轮进度报告（BE / Backend Architect）

**时间戳**: 2026-03-30 17:10:00

## 本轮工作
- 开始前已读取 `docs/feedback` 全部当前进度；`docs/refactor` 目录本轮仍不存在可读任务文档，因此按当前用户指令直接清理 backend 剩余 legacy runtime 引用。
- 清除用户点名的 6 个遗留 importer：`link.module.ts`、`credit-escrow.entity.ts`、`agency-services.adapter.ts`、`agency-services.module.ts`、`service.entity.ts`、`conflict-detector.spec.ts`，改为走 `index.ts` 或直接去掉不必要的模块依赖。
- 为承接上述替换，补齐 `order/index.ts`、`product-listing/index.ts`、`resources/index.ts` 的更窄公开导出，让实体引用不再依赖 `runtime.ts`。
- `link/link.module.ts` 去掉对 `AgencyModule` 的 runtime 依赖，继续通过全局 `DomainPortsModule` 暴露的 `AGENCY_LINK_QUERY_PORT` 完成注入。
- 额外顺手修复 `agency/entities/agency-node.entity.ts` 中未登记的 `users/runtime.ts` 导入，否则 `lint:runtime` 会在本轮收尾时暴露新的 unknown importer。
- 同步清空 `scripts/backend/runtime-import-boundary.config.js` 中已失效的 allowlist，当前 backend runtime 遗留白名单归零。

## 验证结果
- `backend` 执行 `npm run lint:runtime` 通过；统计结果为 `runtime import records: 29`、`legacy importers: 0`、`unknown importers: 0`、`stale allowlist entries: 0`。
- `backend` 执行 `npm run lint:arch` 通过；`depcruise` 输出 `no dependency violations found (401 modules, 1452 dependencies cruised)`。
- `backend` 执行 `npm run build` 通过。
- `backend` 执行 `npm test -- --runInBand` 通过；`21` 个 suite、`74` 个测试全部通过。测试过程中仍有既有的 Node warning 与 Telegram callback warn，但未导致失败。

## 结论与建议
- 本轮没有改动实体字段、关系注解和测试断言，只收窄了跨模块引用入口，TypeORM 关系与用例行为保持稳定。
- 目前 backend 的 `runtime.ts` 已收敛为组合根专用装配面；后续若继续强化边界，可考虑为平台侧也逐步减少对 domain runtime 的聚合导出依赖。
