# CLI

CLI 入口为 `src/main.ts`。可用命令、参数和退出码见 [CLI 契约](../../docs/cli.md)。

先在仓库根 pnpm run build，再 pnpm --silent corkoro --help。供 agent 调用时使用绝对 Node 与 dist/tools/cli/src/main.js 路径及参数数组。当前通过仓库脚本运行。

操作示例及平台限制见 [runbook](../../docs/runbook.md)。
