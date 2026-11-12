# CLI

src/main.ts 已实现 inspect、init、content list/add/remove 和基础 check 的参数解析、结构化输出、退出码及取消入口。业务规则由 publisher/content-contract 维护。

先在仓库根 pnpm run build，再 pnpm --silent corkoro --help。供 agent 调用时使用绝对 Node 与 dist/tools/cli/src/main.js 路径及参数数组。尚未全局打包/发布；plan 和后续命令返回 UNSUPPORTED_COMMAND。

用法及平台限制见 [runbook](../../docs/runbook.md)，协议见 [CLI 契约](../../docs/cli.md)。
