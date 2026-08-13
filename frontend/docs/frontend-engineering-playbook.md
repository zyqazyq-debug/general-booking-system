# 前端工程经验与规范（收口版）

## 1. 总体原则（单人全栈甜点区）

- 保持“模块化 + 原子服务 + 接口解耦”，避免引入厚重模板化架构
- 优先小步快跑，采用兼容迁移，不做一次性大爆炸改造
- 先稳接口契约，再做语义命名收口，最后做目录与历史兼容清理

## 2. 目录与域边界规范

### 2.1 推荐分层
- `pages/*`：页面编排与路由入口
- `components/*`：可复用 UI 与展示组件
- `components/*/composables`：页面无关业务动作与流程编排
- `stores/*`：仅保存状态数据，不承载复杂业务流程
- `api/*`：接口调用封装与参数适配
- `core/*`：启动、认证初始化、路由守卫等基础流程

### 2.2 依赖方向
- 允许：`pages -> components/composables/stores/api/core`
- 禁止：普通 `components -> pages`
- 迁移期：`components/panels/*` 可暂时豁免，但必须逐步迁出

### 2.3 边界护栏
- ESLint 已增加限制：`src/components/**/*` 禁止直接导入 `@/pages/**`
- 旧结构过渡期，允许通过“中间承接组件”分批迁移，避免大范围回归

## 3. API 契约规范

### 3.1 任务驱动接口优先
- 状态机动作走任务接口（如 `POST /order/:id/confirm`、`POST /order/:id/complete`）
- 前端禁止拼装“状态 PATCH payload”模拟动作

### 3.2 统一参数映射
- 在 `api/*` 做兼容适配，组件层不做字段翻译
- 示例：`service_id -> serviceId` 在 API 层转换

### 3.3 统一解析入口
- 链接解析统一走 `api/link.ts`，按顺序尝试分销解析、分享解析、兜底解析
- 解析参数兼容 `token` 与 `slug`，对外语义推荐使用 `slug`

## 4. Store 与 Composable 职责规范

- Store 仅存数据与轻量 getter
- 复杂业务动作下沉到 composable（下单、导入、确认流、价格计算等）
- Composable 负责读写 Store 与调用 API，组件只绑定交互与展示

## 5. 命名与语义收口规范

### 5.1 领域命名
- 新增能力统一使用 `distribution/agency` 语义
- `agent` 仅作为兼容层命名，不再承载新实现

### 5.2 样式命名
- 避免通用 `btn` 命名，统一使用语义类（如 `*-action`）
- 逐步减少 `text-muted/mb-*/row/col-*` 等 legacy 工具类裸用

### 5.3 路由迁移策略
- 新路由采用新语义路径（如 `pages/distribution/*`）
- 如需兼容历史深链，可短期保留跳转壳（redirect），观察期结束后移除

## 6. 质量门禁规范

### 6.1 本地脚本
- 必备：`npm run lint`、`npm run type-check`、`npm run build:h5`
- 提交前必须三项全过

### 6.2 提交前自动化
- 已接入 `husky + lint-staged`
- staged 文件自动执行格式化与静态检查

### 6.3 风险控制
- 每次收口改动必须带回归验证
- 先改 API 封装，再改调用点，最后做命名清理

## 7. 执行节奏（推荐）

1. 增加新语义实现（新 API/新路由/新组件）
2. 保留旧语义兼容别名与跳转
3. 切主链路调用到新语义
4. 跑全量校验并灰度观察
5. 最后移除旧语义壳

## 8. 后续清理清单

- 在 CI 中增加“禁止新增 agent 语义/路径”检查（含 `/agent/`、`pages/agent/*`、`@/api/agent`）
- 继续迁移 `components/panels/* -> domain components/composables`
- 补一页迁移公告，明确旧路径退场时间
