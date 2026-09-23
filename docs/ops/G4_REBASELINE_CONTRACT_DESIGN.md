# G4 预发布故障重建基线：契约设计草案

状态：设计草案，**不是操作许可或已通过的验收**。适用范围仅为 `booking-preprod`。
本文件不替代当前部署状态、签名回执或 NAS 实时读回；任何执行都必须从当时的
Git SHA、完整测试结果和 canonical NAS 状态重新开始。

## 为什么不能复用原恢复链

当前事故的 `FAILED -> FAILED_RECOVERED -> IDLE` 路径把固定旧 green 的容器身份、
数据库身份、Telegram 直连及公开探测共同作为成功条件。旧 green 的 Web 健康，
不等于 Telegram 完整可用。尤其不能把已经失败的 `preprod-restore-active-runtime`
回执改为成功、丢弃其五项资源上的 `pendingAction`，或仅凭健康检查签发
`FAILED_RECOVERED`。原事故的失败回执和资源链须永久可审计。

## 状态与所有权

新流程应定义独立版本的 `booking-preprod` rebaseline 契约，不放宽旧 v2/v3
恢复校验。在完成全部新证据之前，canonical `phase` 保持 `FAILED`。新流程通过
CAS generation、递增 fencing epoch、限时租约和受限执行器记录子阶段；每个外部
动作先持久化 request/pending，再执行，随后由独立读回生成不可变回执。所有动作
只允许预发布资源，拒绝生产容器、网络、数据库、DNS 或 Cloudflare 路由。

新根证据至少绑定：原 FAILED 状态摘要及 operation ID、失败候选和旧 active 身份、
现有失败/成功回执链头、五项 pending 资源的完整身份、取证目录及摘要、数据库
OID/备份摘要、当前控制平面安装与签名身份。新动作不得复用
`preprod-restore-active-runtime` 或 `FAILED_RECOVERED` 回执的名称/语义。

| 子阶段（canonical phase 仍为 FAILED） | 必须独立证明 | 失败处理 |
| --- | --- | --- |
| `FORENSIC_BOUND` | 原状态、回执、pending、固定容器及数据库与实时读回一致 | 不接管、不清锁 |
| `FAILED_ACTION_CLOSED` | 仅追加新版本 supersede/containment 事件，链接原 fail 回执、原 pending 快照和每项资源前驱；受限执行器以 CAS 关闭当前 pending，不声称旧恢复成功 | 任一资源最终效果不确定则不关闭，留在 FAILED |
| `LEGACY_ISOLATED` | 旧版进程和 Telegram 投递者的隔离可独立核验；固定容器 ID/镜像/配置仍可取证 | 不启动新投递者 |
| `BASELINES_READY` | 两个独立代理感知基线的签名、镜像、数据库兼容、独立服务名/别名/端口和真实 Bot API 读回均通过 | 不切公开入口 |
| `PROMOTED_AND_REVERSIBLE` | 受控公开切换、唯一投递者、入站去重、出站实测、公开身份与实际反向切换均有回执 | 代理或共享依赖失效时保持 FAILED，不声称可回滚 |

这里的表是拟议契约，阶段名和 schema 必须在实现前固定并通过兼容性审查。
首次公开切换时旧 green 不能被当作完整回滚目标。要先准备独立于旧 green
容器名称的两个代理感知身份，分别具有独立服务名、网络别名和预发布专属
loopback 端口；端口清单必须证明不占用现有 18082 或其他服务的 18081。
允许的回滚目标必须在切换前证明数据库兼容、网络隔离、Telegram 实际调用、
唯一投递者和入口可切换性；这只是切前预演，切后仍须实际反向切换、公开探测
和新鲜的代理/Bot/投递者读回。若两边共享的 Telegram 代理失效，两边都不可用，
不能声称完整回滚。仅有代理的无令牌 HTTP 响应或 `/livez` 不构成 Bot/业务验收。

## 最小实现面与顺序

1. 先版本化 `deploy-state`、状态迁移、外部动作 request/receipt、终结回执及
   JSON Schema。旧事故的原 fail 回执、pending 快照及链根不可改写；新流程
   只能追加可验证的后继事件并显式保存旧链根。
2. 在状态存储和执行器中实现原失败 pending 的受控终结/跨 fence 恢复，要求
   每项资源的前驱摘要一致、原失败回执可核验、旧动作最终效果和无在途进程
   都经过独立读回；不确定则不关闭。CAS 关闭当前 pending 不得重写原快照。
3. 实现新基线的预发布专属命名、Compose/网络/loopback 端口、路由选择及
   冲突证明。旧容器不能
   原地加代理、改 hosts、重建或覆盖同名容器；镜像、配置和 ID 保留取证。
4. 区分代理连通、Bot 身份/`getWebhookInfo`、入站 webhook 去重与出站消息
   投递的回执；出站仅向授权的预发布测试 chat 发送，回执脱敏。证明 webhook
   与 worker 各自唯一，禁止 polling/webhook 双投递及旧进程重启后再现。
5. 在真实切换前提供已验证的反向路径，并把切换、回滚、再次推广与两轮 30 分钟
   观察纳入新版本状态机。没有完整回滚证据，不得标记 G4 通过或进入 G5。

## 必备负向与故障注入测试

- 旧失败回执缺失/摘要改变、任一 pending 资源身份或前驱不一致、跨 fence 重放；
- 租约过期接管与并发 CAS，外部动作前、中、读回后、回执写入前的崩溃恢复；
- pass 回执落盘后仅部分资源头更新、入口已切但状态 CAS 未提交的恢复；
- 数据库 OID/迁移表/备份漂移，旧版与新基线数据库兼容性失败；
- 数据库迁移已提交但回执丢失、受控备份还原演练，以及 contract migration 后禁止自动回滚；
- Docker ID、镜像、配置哈希、网络别名、端口、挂载或签名安装读回漂移；
- 代理可达但 Bot API 失败、代理 DNS 退化为直连、出站失败、webhook 错误、
  入站重复、双 worker 或旧投递者重启再现；
- 公开响应被缓存、版本身份错配、切换后回滚代理失效；
- 所有失败路径均维持 `FAILED` 和完整取证链，不触及生产资源。

## 当前停止线

本草案不授权清理旧 pending、替换旧 green、手改状态/锁或执行首次公开切换。
代码、契约和测试完成后，仍需从 NAS 真实状态重做完整只读前置条件对照，
通过质量门禁、独立核验、签名安装读回，才可进入任何预发布变更。
