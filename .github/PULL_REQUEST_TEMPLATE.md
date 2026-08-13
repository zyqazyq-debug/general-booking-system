## PR 概览
<!-- 简短说明本次 PR 做了什么 -->

## 变更类型
- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Docs / CI / Tooling

## 架构判断检查清单（Playbook §6 七条方法，至少勾选 3 条）
- [ ] **判断 1（单一真源）**：我确认本 PR 涉及的事实/配置/契约只有一个正式来源，没有双份手工维护（若有跨端契约变更，请说明 packages/shared 或 Swagger 生成是否同步）
- [ ] **判断 2（生成优先）**：本 PR 涉及的派生产物可从真源自动生成（如 API 类型、ESLint 规则、DTO 类型），无需手工复制同步
- [ ] **判断 3（门禁前移）**：本 PR 涉及高代价动作（迁移/部署/DB 备份）时，已补 dry-run / 白名单 / 二次确认 等前置守卫
- [ ] **判断 4（Ownership）**：本 PR 涉及资源修改（AgencyNode markup / ServiceBlock / 用户信用 / 佣金快照）时，已补 ownership 不变量校验或断言
- [ ] **判断 5（统一投影）**：本 PR 涉及前端多端展示的聚合数据，已新增 projection 层统一对外，避免 H5/小程序/Telegram 各自编排拼装
- [ ] **判断 6（自动守护）**：本 PR 新增/修改了值得在 folderOpen 自动 watch 的任务（如类型检查/架构边界检查/日志监视），已对应更新 .vscode/tasks.json
- [ ] **判断 7（目录增长合理）**：本 PR 新增脚本/文档时已放到对应职责目录（tools/lint tools/migrate tools/ops docs/architecture docs/protocol docs/testing），没有散落到根或不相关的子目录

## 跨模块边界检查
- [ ] 没有任何跨域深路径引用（仅允许从 <module>/index 公共入口 import）
- [ ] 没有反向依赖（domain 不依赖 framework / IO / adapters）
- [ ] 新增的跨领域 Port 接口已在 platform-ports.module.ts 绑定

## 验证清单
- [ ] `npm run lint:arch`（backend）通过，0 violations
- [ ] `npm run build`（backend / frontend）通过
- [ ] 新增/修改的单测全绿；若涉及业务域已补对应用例
