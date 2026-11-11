# CLI

预留发布与管理命令入口，当前无可执行命令。

为终端、agent、CI 和桌面插件提供统一调用入口。通过 `--config` 读取 Vault 内的单一站点配置（含文章清单、资料、友链与默认主题设置），调用核心的规划和执行能力；`build` 生成产物，`deploy` 显式发布产物，不混合副作用。

首个实现目标是陌生 Vault 接入：`inspect`、`init`、`content list/add/remove` 和分范围 `check`；随后补全 `plan` 依赖解释。参数、输出和退出码以 [CLI 契约](../../docs/cli.md) 为准。后续管理命令提供范围明确的查询、审核和导出能力。参见 [操作手册](../../docs/runbook.md)。
