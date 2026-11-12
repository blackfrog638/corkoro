# 开发与运维

## 当前可用能力

2026-11-12：可运行 inspect、init、content list/add/remove、基础 check。plan/build/preview/deploy/status/comments 尚未实现，返回不支持。网站与插件仍未开发。

开发运行版本固定 Node 26.13.0（.node-version），pnpm 11.25.0。package.json 的 Node 范围兼容 pnpm 自身携带的 24.22.1；本轮业务测试运行于 Node 26.13.0。运行 pnpm exec node --version 可核对真正执行脚本的 Node。依赖精确固定并提交 pnpm-lock.yaml；无须真实 Vault 或云凭据。

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm test
pnpm run verify:model
```

build 编译 TypeScript 并复制 Windows 辅助脚本到 dist；test 先构建，再运行真实测试。有限状态模型是另一项验证，不能代替运行时测试。尚未接 CI。

## 本地 CLI

从仓库根运行；脚本不需要全局安装。--silent 抑制 pnpm 包装层日志，CLI 自身 --json 只输出一个封装对象。插件/agent 可直接以 Node 可执行文件加绝对 dist/tools/cli/src/main.js 路径调用，避免依赖工作目录或拼接 shell。

```powershell
pnpm --silent corkoro inspect --source "tests/fixtures/vault" --format obsidian-markdown --json
pnpm --silent corkoro content list --config "tests/fixtures/vault/网站/selected.config.json" --json
pnpm --silent corkoro check --config "tests/fixtures/vault/网站/selected.config.json" --json
```

样例 check 的非空输入返回 buildable=null、unperformedChecks=[references]，只说明结构和路径通过；完全空返回 false。基础 check 不判断双链、嵌入、正文资源及完整 Obsidian 兼容性，不能据此发布。

在用户选择的外部 Vault 创建配置（下列路径需自行替换，不在本轮访问）：

```powershell
pnpm --silent corkoro init --source "E:/notes/my-vault" --config "E:/notes/my-vault/网站/corkoro.config.json" --out-dir "E:/generated/my-blog" --format obsidian-markdown --json
pnpm --silent corkoro content add "技术/第一篇文章.md" --slug first-post --config "E:/notes/my-vault/网站/corkoro.config.json" --json
pnpm --silent corkoro content remove article-id --config "E:/notes/my-vault/网站/corkoro.config.json" --json
```

init 创建空配置和必要事务元数据，不创建输出站点。用户填写允许资源根目录、关于页/资料/友链。add/remove 只修改配置内清单，保留其它字段；remove 可停用缺失正文，重复调用不改写配置。扫描属性不是授权。

## Windows 写入与恢复

本轮实际验证 Windows + 本地固定 NTFS 卷 + Windows PowerShell/.NET。辅助进程以 windowsHide、参数数组启动；结构化 stdin 传路径/内容信息，不拼 shell。稳定空锁文件由 FileShare.None 互斥持有；更新通过 File.Replace，首次创建用同卷 File.Move。其它平台、UNC 或不支持卷返回 TRANSACTION_UNSUPPORTED。PowerShell 被环境策略禁用时不绕过策略。

手工编辑器/同步软件不得与命令同时写同一配置。锁忙立即返回 CONFIG_BUSY，不自动重试；不要删除 .corkoro-state 锁载体。进程退出后 OS 释放锁，可重用遗留载体。事务目录被扫描和发布规则排除；旧临时文件不自动重放，给 CLEANUP_PENDING，需人工确认后清理。

退出 5/effect=unknown 或无响应时，先 list/读取配置，再决定是否重试。130 仅表示已知提交前取消。已提交后取消不回滚。效果、错误和恢复详见 [结果协议](cli-protocol.md)与[事务规则](config-transactions.md)。尚未验证断电耐久性，也不保证恶意本地进程并发替换路径时安全。

## 实际验证范围

11 项测试将人工 Vault 复制到独立临时目录，覆盖严格 JSON/版本结构、参数错误、扫描与只读性、中文路径、跨工作目录、空配置、站点资料、幂等稳定 ID、缺文件停用、保留资料/主题、输出隔离、硬链接/junction 越界、双进程竞争与持有者退出、并发 init、提交后响应丢失重试、版本冲突、取消及遗留临时文件。

Windows 写入测试在其它平台标为跳过，不能将这些平台的绿色结果当作写入认证。正文、资源的哈希验证与抽象模型检查分别报告。

## 远端与后续阶段

本轮没有创建 remote、GitHub Actions、Cloudflare 资源、MCP 连接或部署，也不发邮件。第二阶段先实现引用解析和只读 plan，再进入内容包、网站和部署。CI 未来只接收经过筛选的公开快照，不上传整个 Vault。

数据库迁移、生产环境、管理员认证和备份恢复在 API 实现阶段另行建立。不存在的操作不会以占位成功脚本代替。
