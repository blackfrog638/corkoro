# Corkoro

从 Obsidian 发布文章的可定制博客。网站、发布工具和 Obsidian 插件解耦，既能在编辑器中操作，也能由 agent / CLI 操作。

## 当前状态

2026-11-11：完成目录与协作规范初始化。尚未实现网站、发布 CLI、评论接口或 Obsidian 插件；没有安装业务依赖，也没有配置云端资源。

## 从这里开始

- [Agent 协作规则](AGENTS.md)
- [架构与模块边界](docs/architecture.md)
- [已确定的技术决策](docs/decisions/0001-project-boundaries.md)
- [开发计划与待确定事项](docs/roadmap.md)
- [本地开发和运维说明](docs/runbook.md)

## 目录

| 路径 | 职责 |
| --- | --- |
| `apps/web` | Astro 网站、文章展示、搜索、评论组件 |
| `apps/api` | Cloudflare Worker API，使用 D1 保存评论等数据 |
| `apps/obsidian-plugin` | Obsidian 的发布入口与结果展示 |
| `packages/publisher` | 与 Obsidian UI 无关的内容处理和发布流程 |
| `packages/content-contract` | 内容包格式、兼容规则和运行时校验 |
| `packages/api-contract` | 公开接口与管理接口的数据约定 |
| `tools/cli` | 发布及管理命令入口 |
| `tests/fixtures/vault` | 人工编写的示例笔记，不放真实私人笔记 |
| `content/published` | 供网站消费的公开内容包，接入生成流程后由工具管理 |

当前目录是开发骨架，不代表各模块已实现。包清单和依赖随对应模块开发加入，暂不创建空包或伪成功命令。

## 默认技术方向

Astro + TypeScript；GitHub Actions 构建并部署到 GitHub Pages；Pagefind 搜索；Cloudflare Workers + D1 承载动态业务；官方 MCP / Wrangler 支持管理。React 仅在交互组件需要时引入。

评论免登录、免邮箱验证，审核后公开。RSS 与邮件订阅独立于评论；邮件服务供应商尚未最终确定。
