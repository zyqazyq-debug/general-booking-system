# 通用预约系统：生产-代理-消费 结构说明

## 1. 角色定义

*   **生产者 (Provider)**: 
    *   服务的原始创建者。
    *   定义服务的基础信息（名称、时长、工作日等）和**基础售价 (Base Price)**。
    *   在系统中对应 `Schedule` 表的 `owner_id`。

*   **代理 (Agent)**:
    *   通过导入生产者的服务并生成推广链接的用户。
    *   可以设置**加价 (Markup)**（固定金额或百分比）和**说明/备注**。
    *   代理可以是多级的（代理 B 导入 生产者 A，代理 C 导入 代理 B）。
    *   在系统中对应 `AgencyNode` 表。

*   **消费者 (Consumer)**:
    *   通过代理链接或直接链接预约服务的最终用户。
    *   支付最终价格（基础售价 + 每一级代理的加价）。
    *   在系统中对应 `Order` 表的 `consumer_id`。

## 2. 核心数据流

### 2.1 服务发布与代理链条
1.  **发布**: Provider 创建 `Schedule` (e.g., Base Price: ¥100).
2.  **一级代理**: Agent A 导入 `Schedule`，创建 `AgencyNode A`。
    *   设置加价: +¥20 (Fixed)
    *   售价: ¥120
3.  **二级代理**: Agent B 导入 `AgencyNode A` 的链接，创建 `AgencyNode B`。
    *   设置加价: +10% (Percent)
    *   成本基数: ¥120
    *   加价额: ¥12
    *   售价: ¥132

### 2.2 价格计算与更新
*   **自底向上追溯**: 任何节点的最终售价 = 生产者底价 + ∑(路径上所有上级代理的加价)。
*   **动态更新**: 
    *   当 Provider 修改 Base Price 时，所有下游代理的成本基数自动改变。
    *   当 Agent A 修改加价时，系统递归更新所有子节点（如 Agent B）的 `markup_amount`。
    *   **百分比加价**: 始终基于最新的（上级售价）计算绝对值。
    *   **固定加价**: 保持绝对值不变，叠加到新的基数上。

### 2.3 下单与佣金记录
当消费者通过 Agent B 的链接下单时：
1.  **生成订单 (Order)**: 记录最终支付金额 ¥132。
2.  **生成佣金记录 (CommissionRecord)**: 系统自顶向下生成记录链：
    *   **Provider**: 
        *   Role: PROVIDER
        *   Cost: 0
        *   Markup: ¥100 (Base)
        *   Final: ¥100
        *   Child: Agent A
    *   **Agent A**:
        *   Role: AGENT
        *   Cost: ¥100
        *   Markup: ¥20
        *   Final: ¥120
        *   Child: Agent B
    *   **Agent B**:
        *   Role: AGENT
        *   Cost: ¥120
        *   Markup: ¥12
        *   Final: ¥132
        *   Child: null (Consumer)

## 3. 前端展示逻辑

*   **消费订单列表**:
    *   显示: 最终支付金额 (¥132)。
*   **代理订单列表**:
    *   显示: 
        *   进货价 (Cost Price): ¥120
        *   加价额 (Markup): +¥12
        *   出售价 (Final Price): ¥132
*   **服务订单列表**:
    *   显示: 基础售价 (¥100)。

## 4. 数据库实体关系图 (ERD 简述)

*   `User` (用户)
*   `Schedule` (日程/服务) -> Belongs to User (Provider)
*   `AgencyNode` (代理节点) -> Links User (Agent) to Schedule (Root) & Parent AgencyNode
    *   Fields: `markup_type`, `markup_value`, `markup_amount`
*   `Order` (订单) -> Links Consumer, Schedule, and (Optionally) AgencyNode
*   `CommissionRecord` (佣金记录) -> Links Order to Agent/Provider for financial tracking
