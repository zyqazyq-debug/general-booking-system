# src/generated

本目录是自动生成工件，禁止手工编辑 `api.ts`。

当前确定性输入是 `docs/protocol/openapi.json`。从 `frontend` 目录更新和校验：

```sh
npm run generate:api -- --input ../docs/protocol/openapi.json
npm run generate:api -- --input ../docs/protocol/openapi.json --check
```

生成器不提供网络 fallback 或空 schema。输入、读取、校验或生成任一步失败时，现有工件保持不变并以非零状态退出。

该输入目前只覆盖已核验的公开 `GET /health` 基线。它不能代表完整后端路由；新增业务端点前，必须先将经后端 Swagger 或已审查 DTO 核验的契约加入输入，再重新生成。
