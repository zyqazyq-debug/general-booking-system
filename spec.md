# 通用预约系统 (Universal Booking System) 技术规格说明书

## 1. 系统概述
本系统是一个去中心化的时间/资源预约平台。核心理念是**“信用分抵押”**与**“多级分销”**。系统实行**双轨制账户**：**资金余额**（Balance）用于推广返利提现，**信用分**（Credit Score）用于预约抵押。发布者（Owner）发布日程，中介（Agent）进行二次加价分销，消费者（Consumer）使用信用分抵押预约。前端支持**多语言（i18n）**自动适配。

## 2. 核心业务流程

### 2.1 账户与信用模型 (双轨制)
*   **资金余额 (Balance)**：
    *   **来源**：推广返利、充值（购买订阅套餐时可能涉及）。
    *   **用途**：提现（扣除手续费）。
    *   **性质**：真金白银，可提现。
*   **信用分 (Credit Score)**：
    *   **来源**：系统赠送、履约积累、购买（可选）。
    *   **用途**：预约时作为保证金冻结。
    *   **性质**：虚拟积分，**不可提现**。
*   **流转逻辑**：
    1.  **预约冻结**：消费者发起预约 -> 系统冻结消费者 N 分信用分。
    2.  **履约成功**：发布者点击“完成” -> 系统**解冻并退还** N 分给消费者。
    3.  **履约失败（爽约）**：发布者点击“违约” -> 系统**扣除（销毁）**消费者 N 分。**注意：扣除的分数不给发布者，直接销毁，避免发布者恶意刷分。**

### 2.2 分销模型
*   **多级引用链**：支持 A -> B -> C -> D 的无限级代理。
    *   **链式加价**：
        *   C 代理 B 时，C 的基础价 = B 的最终价。
        *   系统记录完整的引用链（Reference Chain），但对外只展示直接上级的信息。
*   **价格计算**：
    *   最终价格 = 递归计算整条链上的加价。
    *   若 A 改价，整条链自动重新计算。
*   **隐私隔离**：
    *   消费者 D 只能看到直接上级 C 的信息。
    *   中介 C 只能看到直接上级 B 的信息，**无法穿透**看到源头 A。
    *   源头 A 能看到最终成交价格，但无法直接获取 C 或 D 的客户资料。

### 2.3 日程规则
*   **时间存储**：统一使用 UTC 时间戳存储，前端根据用户时区格式化显示。
*   **高级规则**：
    *   **循环规则**：支持按周（如每周一、三、五）重复。
    *   **缓冲时间**：每单结束后自动锁定 X 分钟。
    *   **开关控制**：支持“临时下架”（屏蔽特定时段）和“全局下线”。

### 2.4 日历同步
*   **iCal 支持**：
    *   **导出**：系统为每个发布者/中介生成唯一的 `.ics` 订阅链接。发布者可将其导入 Google Calendar / Outlook，实时查看系统内的预约。
    *   **导入（可选）**：解析外部 iCal 链接，自动屏蔽忙碌时段（避免撞单）。

## 3. 数据库设计 (Schema Design)

### 3.1 用户表 (users)
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | UUID | 主键 |
| username | VARCHAR | 用户名 |
| wallet_balance | DECIMAL | 资金余额（可提现返利） |
| credit_score | INT | 信用分（用于抵押） |
| credit_frozen | INT | 冻结信用分 |
| locale | VARCHAR | 语言偏好 (zh-CN, en-US) |
| role | ENUM | 角色（Owner, Agent, Consumer, Admin） |
| referrer_id | UUID | 推荐人 ID（推广返利绑定） |
| subscription_plan | ENUM | 订阅套餐（FREE, BASIC, PRO） |
| subscription_expires_at | TIMESTAMP | 订阅过期时间 |
| created_at | TIMESTAMP | 注册时间 |

### 3.2 日程配置表 (schedule_configs) - 发布者维度
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | UUID | 主键 |
| owner_id | UUID | 关联 users.id |
| title | VARCHAR | 日程标题（如“钢琴课”） |
| base_price | DECIMAL | 基础展示价格（仅展示） |
| deposit_points | INT | 预约所需抵押信用点 |
| duration_minutes | INT | 单次服务时长 |
| buffer_minutes | INT | 缓冲时间 |
| is_active | BOOLEAN | 全局开关 |
| rules | JSONB | 循环规则（如 `{"repeat": "weekly", "days": [1,3,5], "start": "09:00", "end": "18:00"}`） |
| metadata | JSONB | 扩展数据（预留字段：地理位置 `{lat, lng, address}`、图片 URL、服务标签等） |

### 3.3 中介代理表 (agent_links)
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | UUID | 主键 |
| original_owner_id | UUID | 源头发布者 ID |
| parent_link_id | UUID | 上级代理链接 ID（空则表示直接代理 Owner，非空则表示多级代理） |
| agent_id | UUID | 当前中介 ID |
| markup_type | ENUM | 加价类型（PERCENT, FIXED） |
| markup_value | DECIMAL | 加价数值 |
| private_note | TEXT | 中介私有备注 |
| share_token | VARCHAR | 专属分享码 |

### 3.4 预约订单表 (appointments)
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | UUID | 主键 |
| consumer_id | UUID | 消费者 ID |
| owner_id | UUID | 发布者 ID |
| agent_id | UUID | 中介 ID（可选，记录来源） |
| start_time | TIMESTAMP | 预约开始时间 (UTC) |
| end_time | TIMESTAMP | 预约结束时间 (UTC) |
| status | ENUM | PENDING(待确认), CONFIRMED(已锁定), COMPLETED(已完成), CANCELLED(已取消), NO_SHOW(爽约) |
| frozen_points | INT | 冻结信用点数 |
| display_price_snapshot | DECIMAL | 下单时看到的价格快照 |
| created_at | TIMESTAMP | 下单时间 |

### 3.5 信用流水表 (credit_logs)
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | UUID | 主键 |
| user_id | UUID | 用户 ID |
| amount | INT | 变动金额（+100, -100） |
| type | ENUM | DEPOSIT_FREEZE, DEPOSIT_RETURN, PENALTY, SERVICE_FEE, RECHARGE |
| ref_id | UUID | 关联订单 ID |

### 3.6 日历同步表 (calendar_integrations)
| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| id | UUID | 主键 |
| user_id | UUID | 用户 ID |
| type | ENUM | ICAL_IMPORT, ICAL_EXPORT |
| url | TEXT | iCal 链接 |
| last_synced_at | TIMESTAMP | 最后同步时间 |

## 4. API 接口设计 (RESTful)

### 4.1 日程管理 (Owner)
*   `POST /api/schedules`: 创建/更新日程配置。
*   `GET /api/schedules/availability`: 查询某时间段的空闲状态。
*   `GET /api/schedules/ical/{token}`: 获取 iCal 导出链接（公开）。

### 4.2 代理分销 (Agent)
*   `POST /api/agents/link`: 创建代理链接（设置加价）。
*   `GET /api/agents/link/{token}`: 解析分享链接（返回加价后的日程信息）。

### 4.3 预约交易 (Consumer)
*   `POST /api/appointments`: 发起预约（检查余额 -> 冻结 -> 写库）。
*   `POST /api/appointments/{id}/cancel`: 取消预约（检查规则 -> 解冻/扣罚）。

### 4.4 履约管理 (Owner)
*   `POST /api/appointments/{id}/confirm`: 确认接单（手动模式）。
*   `POST /api/appointments/{id}/complete`: 完成服务（解冻押金，扣除工具费）。
*   `POST /api/appointments/{id}/no-show`: 标记爽约（扣除押金）。

### 4.5 运营管理 (Admin)
*   `GET /api/admin/stats`: 全局数据看板（用户数、订单数、信用点池）。
*   `POST /api/admin/users/{id}/ban`: 封禁用户。
*   `POST /api/admin/subscription/plans`: 配置订阅套餐。

### 4.6 推广系统
*   `GET /api/referral/link`: 获取我的推广链接。
*   `GET /api/referral/stats`: 查看我的推广业绩。

### 4.7 资金管理
*   `POST /api/finance/withdraw`: 申请提现（信用点 -> 支付宝/微信）。
*   `GET /api/finance/config`: 获取当前费率（提现手续费、返利比例）。

## 5. 技术栈选型
*   **前端**：Uni-app (Vue3 + TS) -> 编译为 H5/小程序/App。
    *   **i18n**: 使用 `vue-i18n` 实现多语言支持。
*   **后端**：NestJS (Node.js) + TypeORM。
    *   **模块化设计**：
        *   `ConfigModule`: 全局配置中心（管理 15% 返利比例等）。
        *   `PaymentModule`: 聚合支付宝/微信支付 SDK。
*   **数据库**：PostgreSQL。
*   **缓存**：Redis (用于高并发下的库存锁定)。

## 6. 隐私与安全
*   **数据脱敏**：API 返回用户信息时，手机号等敏感字段必须掩码或不返回。
*   **越权检测**：严格检查 `agent_id` 是否有权查看 `private_note`。
