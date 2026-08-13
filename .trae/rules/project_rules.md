“高内聚、低耦合、模块一一对应、跨模块用接口”

- 模块一一对应 ：每个模块一个目录（如 viewer / model / export / cloud / billing ），目录内包含自己的 ui/application/domain/adapters；模块对外只暴露一个入口文件 index.ts 。
- 公开入口（接口面） ：跨模块只能 import { … } from '<module>/index' 或调用 API；禁止深路径引用对方内部文件（ core/\*\* 、 components/\*\* 、 adapters/\*\* 都视为私有）。
- Ports/Adapters ：需要外部能力的模块自己定义 ports （接口）；具体实现放 adapters ，由上层装配（web 的 composition root 或 api 的 service container）注入，避免“直接 new / 直接调用别人的实现”。
- 依赖方向固定 ： domain 纯规则（不依赖框架/IO）→ application 编排用例（依赖 ports）→ adapters 接环境（DB/HTTP/Storage/Three/Zustand）→ ui 只调用 application；反向依赖一律禁止。
- 共享只放契约 ： packages/shared 只放 DTO/错误码/运行时 schema 校验（Zod/Valibot 等），不放业务实现、不读 env、不做 IO；这样 web/api/db 都能安全共用。
- 强制约束落地 ：用边界测试或 lint 规则禁止深路径导入与反向依赖；CI 里固定跑 test + build + 边界检查 ，防止边界回潮。
- 跨端/跨模块通信策略 ：优先通过“模块 Facade（application API）”或“共享状态（仅在 web 内部）”；凡涉及收费/权限/分享链接签发必须走 api ，避免前端绕过。

