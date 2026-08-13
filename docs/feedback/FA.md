# 本轮进度报告（FA / Frontend Architect）

**时间戳**: 2026-03-27 22:15:42

## 本轮工作
- 开始前已读取 `docs/feedback` 全部当前进度；`docs/refactor` 目录本轮仍不存在可读任务文档，因此按当前用户指令直接执行前端边界收口。
- 在 `frontend/dependency-cruiser.config.cjs` 补齐前端门禁：将 `pages/shared/core/components` 全部纳入检查范围，并把禁止深引目标扩展到 `domains/*/api/*`，要求跨域统一通过各域 `index.ts` 门面访问。
- 扩充 `frontend/src/domains/library/index.ts` 与 `frontend/src/domains/provider/index.ts` 的公开导出，补出 schedule / collection 相关调用所需 facade。
- 清理现有违规调用：`frontend/src/components/schedule-collection/useScheduleCollectionActions.ts`、`useScheduleCollectionEditor.ts`、`useScheduleCollectionImport.ts` 已从 deep import 改为走 `@/domains/library`、`@/domains/distribution`、`@/domains/provider`；`frontend/src/pages/schedule/list.vue` 与 `create.vue` 也改为通过 `@/domains/provider` 访问服务能力。

## 新增/消除的越界点
- 新增门禁：前端新增“禁止 `pages/shared/core/components` 深引 `domains/*/api/*`”边界规则，CI 现在可直接拦截这类新增越界。
- 已消除越界：`frontend/src` 中现有 `@/domains/*/api/*` 绝对路径跨域 deep import 已清零。
- 仍存遗留：`frontend/src/shared/api/service.ts` 仍承载具体服务 IO，且 provider / library / service 域内部仍有部分文件继续直接依赖它；这不属于本轮用户指定门禁范围，但仍是下一轮应继续收口的旧层污染点。

## 验证结果
- `frontend` 执行 `npm run lint:arch` 通过；`depcruise` 报告 `no dependency violations found (252 modules, 540 dependencies cruised)`。
- `frontend` 执行 `npm run type-check` 通过。
- `frontend` 执行 `npm run build:h5` 通过。

## 下一步风险
- `pages/schedule/*` 仍是遗留业务岛，页面自身还直接编排请求、导航与弹窗；本轮只先把跨域入口收回 facade，未彻底完成 page → domain impl 的迁移。
- `domains/provider/index.ts` 当前临时转发了 `shared/api/service.ts` 的能力，用于先消除页面层违规入口；后续应把这些 API 真正下沉到 provider 域内部，并逐步抽空 `shared/api/service.ts`。
