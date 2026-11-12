# Corkoro

由外部 Markdown、资源和站点配置驱动的博客构建与发布工具。Obsidian 是一种内容来源，插件、agent 与终端通过同一套 CLI 使用核心能力。

## 当前状态

2026-11-11：完成目录、协作规范、外部输入边界，以及 Vault 内单配置、纯生成站点、发布范围与 CLI 首版契约，加入人工示例。尚未实现网站、发布 CLI、评论接口或 Obsidian 插件；没有安装业务依赖，也没有配置云端资源。已有独立有限状态验证脚本，用于检查抽象契约，不代表 CLI 已实现或验证。

## 从这里开始

- [Agent 协作规则](AGENTS.md)
- [架构与模块边界](docs/architecture.md)
- [已确定的技术决策](docs/decisions/0001-project-boundaries.md)
- [外部输入与构建边界](docs/decisions/0002-external-input-build.md)
- [Vault 内单配置与纯生成站点](docs/decisions/0004-vault-config-generated-site.md)
- [发布范围协议](docs/publication.md)与[CLI 契约](docs/cli.md)
- [命令状态机、反例与证明边界](docs/state-machine.md)
- [七命令结果协议](docs/cli-protocol.md)与[配置事务规则](docs/config-transactions.md)
- [开发计划与待确定事项](docs/roadmap.md)
- [本地开发和运维说明](docs/runbook.md)

## 目录

| 路径 | 职责 |
| --- | --- |
| `apps/web` | 内置默认主题与 Astro 站点生成/渲染器 |
| `apps/api` | Cloudflare Worker API，使用 D1 保存评论等数据 |
| `apps/obsidian-plugin` | Obsidian 的发布入口与结果展示 |
| `packages/publisher` | 配置解析、构建规划、内容处理与执行编排 |
| `packages/content-contract` | 配置、发布清单、内容包及诊断格式的运行时校验 |
| `packages/api-contract` | 公开接口与管理接口的数据约定 |
| `tools/cli` | 发布及管理命令入口 |
| `tests/fixtures/vault` | 人工编写的示例笔记，不放真实私人笔记 |
| `examples/site` | Vault 配置与四种人工场景的使用说明，CLI 尚未实现 |

当前目录是开发骨架，不代表各模块已实现。包清单和依赖随对应模块开发加入，暂不创建空包或伪成功命令。

## 输入与输出

真实文章、关于页、头像和配置保存在用户 Vault。一个 `corkoro.config.json` 内含发布清单、个人资料、友链及默认主题设置，通过 CLI `--config` 引用。配置路径字段相对配置目录，文章清单中的 source 相对源根目录。构建只读输入；init/content 可显式创建或修改指定配置。

Corkoro 自带 default 主题，生成内容包、Astro 站点项目和静态网站，输出位于 Vault 外且可完全重建。用户无需维护或修改生成的站点项目；部署上传已生成的产物。Obsidian 插件收集配置、调用 CLI 和展示结果；依赖分析及发布规则只在核心维护。人工测试样例和示例配置可以放在本仓库。

陌生 Vault 的目标流程为 `inspect → init → content add/list → check → plan → build → preview → deploy`。初始化不选择文章；文章只有配置的 publication.entries 中 `publish: true` 的条目进入构建；关于页通过 site.pages 显式选择，资料和友链直接写在 site 中。没有文章但有页面或资料也可构建。源笔记里的公开属性只是候选线索，链接和嵌入也不能自动公开其他笔记。

## 默认技术方向

Astro + TypeScript；GitHub Actions 构建并部署到 GitHub Pages；Pagefind 搜索；Cloudflare Workers + D1 承载动态业务；官方 MCP / Wrangler 支持管理。React 仅在交互组件需要时引入。

评论免登录、免邮箱验证，审核后公开。RSS 与邮件订阅独立于评论；邮件服务供应商尚未最终确定。
