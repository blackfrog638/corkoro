# Corkoro

由外部 Markdown、资源和站点配置驱动的博客构建与发布工具。Obsidian 是一种内容来源，插件、agent 与终端通过同一套 CLI 使用核心能力。

## 当前状态

2026-11-11：完成目录与协作规范初始化。尚未实现网站、发布 CLI、评论接口或 Obsidian 插件；没有安装业务依赖，也没有配置云端资源。

## 从这里开始

- [Agent 协作规则](AGENTS.md)
- [架构与模块边界](docs/architecture.md)
- [已确定的技术决策](docs/decisions/0001-project-boundaries.md)
- [外部输入与构建边界](docs/decisions/0002-external-input-build.md)
- [开发计划与待确定事项](docs/roadmap.md)
- [本地开发和运维说明](docs/runbook.md)

## 目录

| 路径 | 职责 |
| --- | --- |
| `apps/web` | 默认 Astro 渲染器，消费内容包与外部站点定制 |
| `apps/api` | Cloudflare Worker API，使用 D1 保存评论等数据 |
| `apps/obsidian-plugin` | Obsidian 的发布入口与结果展示 |
| `packages/publisher` | 配置解析、构建规划、内容处理与执行编排 |
| `packages/content-contract` | 配置、内容包及诊断格式的运行时校验 |
| `packages/api-contract` | 公开接口与管理接口的数据约定 |
| `tools/cli` | 发布及管理命令入口 |
| `tests/fixtures/vault` | 人工编写的示例笔记，不放真实私人笔记 |
| `examples/site` | 外部站点项目的组织示例，目前仅有说明 |

当前目录是开发骨架，不代表各模块已实现。包清单和依赖随对应模块开发加入，暂不创建空包或伪成功命令。

## 输入与输出

真实笔记、资源和站点配置保留在用户自己的目录，通过 CLI 的 `--config` 等参数指定。相对路径以配置文件目录为基准；构建默认不改写源文件。输出写入独立目录，不要求复制文章到工具源码中。

构建生成内容包和网站，部署上传已生成的产物。Obsidian 插件收集配置、调用 CLI 和展示结果；依赖分析及发布规则只在核心维护。人工测试样例和示例配置可以放在本仓库。

## 默认技术方向

Astro + TypeScript；GitHub Actions 构建并部署到 GitHub Pages；Pagefind 搜索；Cloudflare Workers + D1 承载动态业务；官方 MCP / Wrangler 支持管理。React 仅在交互组件需要时引入。

评论免登录、免邮箱验证，审核后公开。RSS 与邮件订阅独立于评论；邮件服务供应商尚未最终确定。
