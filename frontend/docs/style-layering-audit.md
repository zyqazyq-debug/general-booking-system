# 前端样式层级梳理（初版）

## 1. 当前层级模型

### 1.1 全局层（Global）
- 入口：`src/App.vue`
- 特征：包含 reset、工具类、部分 legacy 布局规则
- 风险：通用类名（如 `.btn/.badge/.text-*`）可能影响页面与组件

### 1.2 设计变量层（Design Tokens）
- 入口：`src/uni.scss`
- 特征：颜色、间距、字体等基础变量
- 现状：页面硬编码仍较多，变量覆盖率不足

### 1.3 布局骨架层（Layout）
- 入口：`src/components/AppPage.vue`、`src/components/AppTabBar.vue`
- 特征：页面容器、滚动区、导航/底栏
- 风险：与 `App.vue` 中 legacy 布局样式并存，存在双轨

### 1.4 组件层（Component）
- 入口：`src/components/*`
- 特征：多数采用 `scoped` + 前缀化类名，边界较清晰
- 风险：被页面 `:deep` 穿透后可能失去隔离

### 1.5 页面层（Page）
- 入口：`src/pages/*`
- 特征：`scoped` 与非 `scoped` 混用
- 风险：非 `scoped` 页面使用通用类名时，跨页污染概率高

### 1.6 覆盖层（Override/Patch）
- 入口：页面内 `:deep/::v-deep`、`!important`、内联 `style`
- 风险：维护成本高，升级三方组件时回归风险大

## 2. 核心风险点（按优先级）

### P0
- 非 `scoped` 页面样式 + 通用类名

### P1
- `App.vue` 全局工具类范围过大
- `AppPage/AppTabBar` 与 legacy 布局规则并存
- `order/list.vue` 中 `!important` 与深度穿透过多

### P2
- 页面内联样式数量偏多，样式来源分散
- 硬编码色值与间距较多，未统一走 token

## 3. 治理顺序（建议）

1. 统一布局所有权：以 `AppPage/AppTabBar` 为唯一骨架，持续收敛 legacy 规则  
2. 页面样式隔离：优先改造高频页面为 `scoped` 或页面级命名空间  
3. 压缩覆盖层：减少 `!important` 与 `:deep`，仅保留必要白名单  
4. token 化：把颜色/间距硬编码迁移到 `uni.scss`  
5. 建规范：新增页面默认 `scoped`，禁用通用类名裸写

## 4. 后续执行原则

- 不一次性全改，按页面批次推进，避免大面积回归
- 每批次只处理一个层级目标（先隔离，再美化）
- 每次改动后做小屏 + H5 浏览器工具栏场景回归
