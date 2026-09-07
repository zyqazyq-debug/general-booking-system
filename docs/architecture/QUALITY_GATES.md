# 可重复质量门禁

本文件定义 CI 与本地验证的同一条 fail-closed 链。门禁只验证，不执行格式化、自动修复、生产发布、生产迁移或远端写操作。

## 唯一入口

```powershell
npm run quality:gates
```

执行顺序固定为：

1. shared build；
2. shared 自有测试、运行时契约与纯净边界测试；
3. backend build；
4. backend 订单、auth/agency/services、Telegram/env 三组 targeted tests；各组独立执行并汇总失败，单个损坏 spec 不会遮蔽其他组；
5. backend dependency boundary；
6. frontend typecheck、dependency boundary、H5 build；
7. 从已构建 backend 的 `/api-json` 重新生成临时客户端，要求 OpenAPI paths/schema 非空，且与提交产物逐字一致；
8. 根脚本入口存在性与 PowerShell AST 解析检查。

任何输入缺失、命令不可执行、空 OpenAPI、生成漂移或子门禁非零退出都会立即终止，不允许 soft-pass 或空 schema fallback。

## 依赖安装

CI 必须分别执行以下命令，并以各包 lockfile 为准：

```powershell
npm ci --prefix packages/shared
npm ci --prefix backend
npm ci --prefix frontend
```

质量入口自身不安装依赖，也不修复损坏的 `node_modules`。

在 Windows 上，入口仅通过 `cmd.exe /d /s /c` 调用 `npm.cmd`；直接执行 Node 的门禁保持非 shell 调用。这样既兼容 npm 的 `.cmd` 包装器，也不放宽参数边界或失败处理。

## 当前冻结项

根目录原先指向不存在 `ops/deploy/**`、`ops/check/**` 的命令已从公开脚本移除。生产发布入口在不可变镜像、readiness、原子切流和回滚状态机完成前保持冻结；`ops:guard` 仅执行静态入口和 PowerShell 语法检查。

PostgreSQL E2E、生产迁移、NAS smoke、Cloudflare 路由和恢复演练不属于本地零基础设施门禁，必须在隔离或经主调度确认的环境中单独执行并保留审计记录。
