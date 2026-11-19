# 发布核心

已实现扫描、配置读取、路径检查、显式内容选择和只读引用规划；不依赖 Obsidian API。核心入口为 src/index.ts，CLI 复用同一套规则。src/planning.ts 统一生成 check/plan 报告，并保留捕获字节与语法树；src/markdown.ts 解析引用，src/assets.ts 校验允许资源。

配置、独立内容包和站点指针通过 `src/transaction.ts` 提交。Windows 使用 PowerShell/.NET 辅助进程，Linux 和 macOS 使用系统 Python 3 辅助进程。支持的卷、系统依赖和提交结果未知时的恢复步骤见[运行手册](../../docs/runbook.md)。

已实现 buildContentBundle / readContentBundle 库入口：src/content.ts 转换捕获字节，src/bundle.ts 负责内容包检查与原子写出，详见[内容包协议](../../docs/content-bundle.md)。完整 build CLI 将本次捕获的公开内容包交给网站构建库，提交边界见[决策 0012](../../docs/decisions/0012-build-cli-snapshot-handoff.md)。已实现的解析范围与拒绝语法见 [决策 0008](../../docs/decisions/0008-readonly-reference-planning.md)。当前随根包编译，未独立发布。
