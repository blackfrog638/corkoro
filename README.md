# Corkoro

由外部 Markdown、资源和站点配置驱动的博客构建与发布工具。Obsidian 是一种内容来源，插件、agent 与终端通过同一套 CLI 使用核心能力。

## 当前状态

**桌面 CLI 已通过三平台本地构建与预览验收。** 支持 Windows 本地固定 NTFS、Linux 本地 ext4 和 macOS 本地 APFS（大小写敏感和不敏感）。系统依赖、命令和适用范围见[运行手册](docs/runbook.md)。

CLI 支持检查与选择内容、生成公开内容包、构建 Astro 站点与 Pagefind 索引，以及在本地预览。发布时，`deploy` 将快照提交到指定的本地博客分支，`upload:site` 推送核对过的提交，`status` 查询 GitHub Pages 部署记录。评论公开 HTTP 接口与数据层已在 Node 和本地 SQLite 验收，管理 CLI 支持列出、批准和拒绝待审评论，以及本地 SQLite 评论备份与恢复。Cloudflare 预览与 Obsidian 插件待开发。

## 从这里开始

- [Agent 协作规则](AGENTS.md)
- [架构与模块边界](docs/architecture.md)
- [已确定的技术决策](docs/decisions/0001-project-boundaries.md)
- [外部输入与构建边界](docs/decisions/0002-external-input-build.md)
- [Vault 内单配置与纯生成站点](docs/decisions/0004-vault-config-generated-site.md)
- [发布范围协议](docs/publication.md)与[CLI 契约](docs/cli.md)
- [命令状态机、反例与证明边界](docs/state-machine.md)
- [七命令结果协议](docs/cli-protocol.md)与[配置事务规则](docs/config-transactions.md)
- [开发计划与待确定事项](docs/roadmap.md)与[第三阶段任务拆解](docs/site-implementation-plan.md)
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
| `examples/site` | Vault 配置与四种人工场景的使用说明 |

目前已有内容契约、内容包构建库及 CLI 的选择与引用规划代码；apps/web 已有最小生成器，apps/api 已有评论存储库入口，Obsidian 插件仍预留。当前采用根包统一编译源模块和管理依赖，尚不独立发布子包。Node 开发版本固定为 .node-version，依赖与 pnpm 锁文件已加入。

## 输入与输出

真实文章、关于页、头像和配置保存在用户 Vault。一个 `corkoro.config.json` 内含发布清单、个人资料、友链及默认主题设置，通过 CLI `--config` 引用。配置路径字段相对配置目录，文章清单中的 source 相对源根目录。构建只读输入；init/content 可显式创建或修改指定配置。

Corkoro 自带 default 主题，生成内容包、Astro 站点项目和静态网站，输出位于 Vault 外且可完全重建。用户无需维护或修改生成的站点项目；部署上传已生成的产物。规划中的 Obsidian 插件将收集配置、调用 CLI 和展示结果；依赖分析及发布规则只在核心维护。人工测试样例和示例配置可以放在本仓库。

陌生 Vault 的目标流程为 `inspect → init → content add/list → check → plan → build → preview → deploy`。初始化不选择文章；文章只有配置的 publication.entries 中 `publish: true` 的条目进入构建；关于页通过 site.pages 显式选择，资料和友链直接写在 site 中。没有文章但有页面或资料也可构建。源笔记里的公开属性只是候选线索，链接和嵌入也不能自动公开其他笔记。

## 默认技术方向

Astro + TypeScript；GitHub Actions 构建并部署到 GitHub Pages；Pagefind 搜索；Cloudflare Workers + D1 承载动态业务；官方 MCP / Wrangler 支持管理。React 仅在交互组件需要时引入。

评论免登录、免邮箱验证，审核后公开。RSS 与邮件订阅独立于评论；邮件服务供应商尚未最终确定。
