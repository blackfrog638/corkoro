# 发布核心

已实现扫描、配置读取、基础路径检查和显式内容选择；不依赖 Obsidian API。核心入口为 src/index.ts，CLI 复用同一套规则。

Windows 本地 NTFS 配置事务由 src/transaction.ts 与 native/windows-transaction.ps1 适配：固定脚本通过结构化 stdin 接收请求，稳定锁载体互斥，原子创建/替换。支持范围及恢复见 [runbook](../../docs/runbook.md)。未支持平台拒绝写入，不降级为直接覆盖。

引用检查、plan、内容包和网站执行尚未实现；基础 check 必须列出 references 未完成。当前随根包编译，未独立发布。
