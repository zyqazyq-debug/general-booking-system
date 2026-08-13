# 下个项目可借鉴的工程经验提纯版

## 1. 使用方式

这份文档不是要把当前项目的流程原样复制到下个项目。

更准确地说，它回答的是：

- 当前项目有哪些**值得借鉴的工程特点**
- 这些特点为什么有效
- 在别的项目里可以如何类比使用

因此，下面很多内容都应理解为**举例说明特点**，而不是放之四海皆准的固定模板。

---

## 2. 当前项目最值得带走的，不是具体流程，而是几类工程意识

### 2.1 单一真源意识

当前项目里，很多关键内容都尽量避免多处手工维护。

例子：

- Runtime 真源只有一份：[runtime-lite.ps1](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/pc_tools/pc_bootstrap_chain/runtime/runtime-lite.ps1)
- Web 控制台源码集中在 [web_console](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/web_console)
- 协议与契约集中在 [apps/protocol](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/protocol)

值得借鉴的不是“必须用 PowerShell 注入 Runtime”，而是：

**同一事实尽量只有一个正式来源。**

下个项目可以把这个思想迁移成：

- 配置真源
- 协议真源
- UI 状态真源
- 嵌入资源真源

不一定照搬目录名，但最好保留“冲突时谁说了算”的规则。

### 2.2 生成优先意识

当前项目里，一个明显特点是：凡是能从真源机械推导出来的东西，尽量让构建流程生成，而不是长期手工同步。

例子：

- Web 资源经 [build-web.ps1](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/web_console/build-web.ps1) 生成后再进入固件
- Runtime 通过 [sync-runtime-chunks.ps1](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/firmware_esp32s3/tools/pre-build/sync-runtime-chunks.ps1) 注入到固件侧
- 构建产物由 [firmware-build.ps1](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/ops/firmware-build.ps1) 输出带指纹的 manifest

值得借鉴的不是“任何项目都要做注入分块”，而是：

**只要某份内容本质上是另一份内容的派生物，就优先自动生成。**

### 2.3 门禁前移意识

当前项目把不少错误挡在“真正运行之前”。

例子：

- 刷机前不是直接写 bin，而是通过 [flash-app.ps1](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/ops/flash-app.ps1) 做模式探测、切换、验证
- 公共门禁和端口互斥集中在 [common.ps1](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/ops/common.ps1)
- 真正原子刷写由 [firmware-flash.ps1](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/ops/firmware-flash.ps1) 负责

这里值得迁移的不是“所有项目都要做刷机门禁”，而是：

**越容易造成大代价错误的动作，越应该在入口处加守卫。**

换到下个项目，门禁对象可以是：

- 数据迁移
- 发布部署
- 合同生成
- 客户端打包
- 权限切换

### 2.4 分层意识

当前项目不是简单按语言堆文件，而是明显按职责分层。

在固件这边，能看出比较稳定的结构：

- `transport`
- `ingress`
- `services`
- `protocol`
- `roles`
- `core`

例如 [firmware_esp32s3/main](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/firmware_esp32s3/main) 下，传输、入口解析、业务状态机、角色装配是分开的。

值得借鉴的不是目录名本身，而是：

**入口处理、状态机、平台适配、对外状态投影不要混在一起。**

### 2.5 ownership-first 意识

这个项目很强调“谁拥有当前资源、谁拥有当前任务、谁能接管当前状态”。

这在下面这些领域里都能看到：

- CDC 会话
- Runtime 生命周期
- HID 提交流水
- task / lease / session

对应文档也非常强调所有权与不变量，例如：

- [CONNECTION_TASK_LEASE_SOT.md](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/docs/architecture/CONNECTION_TASK_LEASE_SOT.md)
- [CORE_INVARIANTS.md](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/docs/architecture/CORE_INVARIANTS.md)

下个项目不一定也有 CDC 或 HID，但这个经验很好迁移：

**共享资源先建 ownership 模型，再叠业务功能。**

### 2.6 fail-closed 意识

当前项目更偏向在状态不明确时收紧能力，而不是乐观放行。

值得借鉴的不是“所有产品都必须保守”，而是：

**在错误代价高、资源竞争强、状态恢复复杂的系统里，fail-closed 往往比乐观策略更稳。**

---

## 3. IDE 打开工作区后的自动门禁与监视，是这个项目很有代表性的特点

这部分很值得总结，但要注意，它适合的是**有明显工程编排需求、且团队长期在同一工作区协作**的项目。

当前项目里，工作区打开后并不是“只有编辑器准备好了”，而是一部分工程守卫也进入了待命状态。

相关入口主要是：

- [tasks.json](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/.vscode/tasks.json)
- [tasks.generated.json](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/tasks.generated.json)

### 3.1 自动运行的任务体现了什么特点

当前项目里可以看到 `runOn: folderOpen` 的后台任务，例如：

- [【协议】all-contracts watch](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/tasks.generated.json#L238-L262)
- [【前端】运行 Web Console (Local Server)](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/tasks.generated.json#L396-L416)

这里值得借鉴的特点是：

- 契约生成不靠人记得去跑
- 本地调试底座可以在进入工作区时自动就绪
- 守卫型任务常驻，重型任务手动触发

这不意味着下个项目也一定要 `folderOpen` 自启这些任务。

更稳妥的理解应该是：

**可以把“重复、低风险、容易遗漏”的工程动作变成工作区级自动守卫。**

### 3.2 背景监视任务体现了什么特点

当前项目还把日志观测标准化成任务，例如：

- [【监视】ADB logcat (BluetoothHid)](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/.vscode/tasks.json#L24-L46)
- [【监视】ADB logcat -> _project/tools/monitor_latest.log](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/.vscode/tasks.json#L49-L66)

相关脚本位于：

- [monitor-keyboard-and-adb.ps1](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/shared_infra/scripts/monitor-keyboard-and-adb.ps1)

这里体现的不是“所有工程都该开 logcat”，而是：

**运行时观测被当成工程标准件，而不是临时命令。**

对于别的项目，这种思路可以迁移成：

- 后端项目的本地日志 tail
- 前端项目的 bundle/watch 守卫
- 数据项目的 schema/watch 守卫
- 桌面项目的本地诊断监视

### 3.3 什么时候不建议照搬

如果下个项目具备这些特征，就不要简单照搬：

- 团队成员电脑资源差异很大
- 自动任务会抢占关键端口或设备
- 工作区很重，打开即启动会拖慢日常开发
- 项目本身是轻量单体，不值得维护一套任务编排系统

因此，这部分更适合作为“当前项目的一个工程特点示例”，而不是通用规范。

---

## 4. 目录结构的特点：按工程职责组织，而不是按语言堆放

这个项目的目录结构很有代表性。

它不是简单把所有脚本、所有代码、所有文档混在根目录，而是按职责拆开。

### 4.1 顶层结构的特点

最核心的几个目录是：

- [apps](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps)
- [tools](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools)
- [docs](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/docs)

这里的特点不是名字，而是角色边界：

- `apps` 放运行时代码和产品端代码
- `tools` 放运维、构建、发布、诊断、监视脚本
- `docs` 放规则、架构、验收、交接和协议说明

这类结构适合中大型、多端、长期演进的项目。

如果是很小的单仓项目，未必需要拆这么细。

### 4.2 apps 目录的特点

[apps](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps) 下面继续按系统角色拆分，而不是把所有客户端混成一个目录。

例如：

- [firmware_esp32s3](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/firmware_esp32s3)
- [web_console](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/web_console)
- [miniapp_wechat](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/miniapp_wechat)
- [mobile_tools](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/mobile_tools)
- [mobile_flutter](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/mobile_flutter)
- [pc_tools](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/pc_tools)
- [protocol](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/protocol)
- [shared_infra](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/shared_infra)

这说明当前项目的结构特点是：

**运行端、协议层、共享基础设施是并列角色，而不是某一端的附属物。**

这个特点在下个项目里很值得参考，尤其是当项目同时包含设备端、服务端、客户端、共享协议时。

### 4.3 docs 目录的特点

[docs](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/docs) 下面也不是单一 README，而是分区管理：

- [architecture](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/docs/architecture)
- [protocol](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/docs/protocol)
- [testing](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/docs/testing)
- [debug](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/docs/debug)
- [tools](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/docs/tools)

这里体现的是：

**文档也按工程职责分类，而不是所有说明都堆进一个文件夹。**

这种结构适合知识量比较大的项目，但对小项目来说可能偏重。

### 4.4 tools 目录的特点

[tools](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools) 不是杂物箱，而是一个工程控制面。

例如：

- [ops](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/ops)
- [tasks.generated.json](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/tasks.generated.json)
- [monitor_latest.log](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/monitor_latest.log)

这里的特点不是“什么都往 tools 里放”，而是：

**把工程过程本身收束到固定入口。**

---

## 5. 代码结构的特点：边界明确，状态机集中

从代码结构上看，这个项目很有代表性的特点，是把“入口处理”“业务状态机”“平台适配”“对外状态”尽量分开。

### 5.1 固件层次结构比较清楚

以 [firmware_esp32s3/main](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/firmware_esp32s3/main) 为例，可以看到比较稳定的层次：

- `transport`
- `ingress`
- `services`
- `roles`
- `protocol`

这说明它不是按“谁先写出来”组织代码，而是按职责收束。

### 5.2 入口层与业务层有分工

这类结构的一个优点是：

- 入口层负责解析、校验、路由
- service 层负责状态机和核心领域逻辑
- 状态投影层负责对外统一表达

例如这条链路就很能说明问题：

- [command_dispatcher_app_pc.c](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/firmware_esp32s3/main/ingress/command_dispatcher_app_pc.c)
- [pc_bootstrap_service.c](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/firmware_esp32s3/main/services/pc_bootstrap_service.c)
- [pc_channel_status.c](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/apps/firmware_esp32s3/main/services/pc_channel_status.c)

这个例子值得借鉴的不是具体文件名，而是：

**请求入口、状态机核心、对外状态面最好分开。**

### 5.3 统一状态面是一个很好的特点

当前项目里，Web、APP、调试链路很多时候并不是直接读取内部零散状态，而是依赖统一状态投影。

这类设计的优点是：

- 客户端少猜测
- 调试更容易对齐
- 多端更容易共享事实

但这也只是适合“多端共享状态”的工程。

如果下个项目是非常简单的单端应用，不一定需要做成完整状态投影层。

### 5.4 工具脚本本身也带层次

当前项目的脚本不是零散工具集合，而是有明显层次：

- build
- flash / ota
- diagnose
- monitor
- backup

相关入口集中在 [tools/ops](file:///D:/用户目录/桌面/编程/蓝牙键盘输入/_project/tools/ops)。

这个特点非常值得借鉴，但不一定要照搬成 PowerShell。

更核心的经验是：

**让工程操作有固定入口，而不是靠口头命令和历史终端记录。**

---

## 6. 更适合迁移到下个项目的，不是“复制流程”，而是“复制判断方法”

如果要把当前项目经验带到下个项目，我更建议复制下面这些判断方法，而不是逐条复制流程。

### 判断 1

这个事实是否应该只有一个正式来源？

### 判断 2

这个产物是否可以从真源自动生成？

### 判断 3

这个高代价动作是否应该前移门禁？

### 判断 4

这里的问题是功能问题，还是 ownership 问题？

### 判断 5

这里的状态是否应该统一对外投影？

### 判断 6

这个工作区是否值得在打开时自动拉起守卫任务？

### 判断 7

这个目录是按职责在增长，还是按历史在堆积？

---

## 7. 结论

当前项目最值得总结给下个项目的，不是某一条刷机链路、某一个 IDE 任务，或者某一种目录名。

真正有价值的是这些“工程特点”：

- 倾向单一真源
- 倾向生成优先
- 倾向门禁前移
- 倾向边界分层
- 倾向 ownership-first
- 倾向把观测和工具链做成正式工程组成部分

至于这些特点在下个项目里具体怎么落地，应该由项目规模、团队协作方式、运行环境和风险成本来决定，而不是机械照搬当前仓库的流程。
