# 发布核心

已实现扫描、配置读取、路径检查、显式内容选择和只读引用规划；不依赖 Obsidian API。核心入口为 src/index.ts，CLI 复用同一套规则。src/planning.ts 统一生成 check/plan 报告，并保留捕获字节与语法树；src/markdown.ts 解析引用，src/assets.ts 校验允许资源。

Windows 本地 NTFS 配置事务由 src/transaction.ts 与 native/windows-transaction.ps1 适配：固定脚本通过结构化 stdin 接收请求，稳定锁载体互斥，原子创建/替换。支持范围及恢复见 [runbook](../../docs/runbook.md)。未支持平台拒绝写入，不降级为直接覆盖。

内容包写出和网站执行尚未实现。已实现的解析范围与拒绝语法见 [决策 0008](../../docs/decisions/0008-readonly-reference-planning.md)。当前随根包编译，未独立发布。
