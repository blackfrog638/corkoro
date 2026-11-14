# 开发与运维

## 当前可用能力

2026-11-14 S5 进展：publisher 导出 captureContent(configPath, signal?)，返回只读捕获的公开 bundle、configVersion、outputDirectory、diagnostics；网站 buildSite 首参数可直接接收该 bundle。该入口尚未接 CLI，build 命令仍不支持。快照交接及后续单提交设计见 [决策 0012](decisions/0012-build-cli-snapshot-handoff.md)。

2026-11-12：可运行 inspect、init、content list/add/remove、含引用检查的 check 和只读 plan。build/preview/deploy/status/comments 尚未实现，返回不支持。内容包 v1 已通过库入口实现转换与原子写出；2026-11-13 已增加最小 Astro 站点构建库，完整主题体验、搜索与插件仍待开发。

开发运行版本固定 Node 26.13.0（.node-version），pnpm 11.25.0。package.json 的 Node 范围兼容 pnpm 自身携带的 24.22.1；本轮业务测试运行于 Node 26.13.0。运行 pnpm exec node --version 可核对真正执行脚本的 Node。依赖精确固定并提交 pnpm-lock.yaml；无须真实 Vault 或云凭据。

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm test
pnpm run verify:model
```

build 编译 TypeScript 并复制 Windows 辅助脚本到 dist；test 先构建，再运行真实测试。有限状态模型是另一项验证，不能代替运行时测试。尚未接 CI。

## 站点地址准备

可在配置 site 内添加 `"address": { "origin": "https://example.org", "base": "/blog/" }`。origin 不带尾斜线，base 必须带首尾斜线；根站点使用 `/`。现有 check 会校验格式，内容包库会携带地址；不填时旧流程保持可用。最小网站库已消费地址；不会因此部署到该地址。详见 [ADR 0010](decisions/0010-site-address-and-theme-boundaries.md)和[任务拆解](site-implementation-plan.md)。

## 本地 CLI

从仓库根运行；脚本不需要全局安装。--silent 抑制 pnpm 包装层日志，CLI 自身 --json 只输出一个封装对象。插件/agent 可直接以 Node 可执行文件加绝对 dist/tools/cli/src/main.js 路径调用，避免依赖工作目录或拼接 shell。

```powershell
pnpm --silent corkoro inspect --source "tests/fixtures/vault" --format obsidian-markdown --json
pnpm --silent corkoro content list --config "tests/fixtures/vault/网站/selected.config.json" --json
pnpm --silent corkoro check --config "tests/fixtures/vault/网站/selected.config.json" --json
pnpm --silent corkoro plan --config "tests/fixtures/vault/网站/selected.config.json" --json
pnpm --silent corkoro plan --config "tests/fixtures/vault/网站/blocked.config.json" --json
```

selected 样例 check/plan 返回 complete=true、buildable=true；plan 列出两篇文章、一页、diagram.svg 与 avatar.svg 的引用理由。blocked 样例退出 3，分别列出未选笔记的链接/嵌入错误，complete=true、buildable=false。完全空的配置退出 0、buildable=false；缺失入口或 IO 中止会留下未完成的检查范围。plan 不写文件、不生成网站、不上传内容；changes=null、BASELINE_NOT_SUPPORTED 表示未比较旧构建。

当前支持 CommonMark 链接/图片/引用式链接，以及 Obsidian 双链/别名和图片引用。只读取已选正文；代码和 frontmatter 内的引用不参与依赖。允许被引用的 PNG/JPEG/GIF/WebP 与受限静态 SVG，不包含未引用附件。标题/块锚点、笔记嵌入、原始 HTML、Dataview 明确拒绝；详细语法、SVG 与格式校验边界见 [决策 0008](decisions/0008-readonly-reference-planning.md)。通过规划不代表已有渲染能力。

在用户选择的外部 Vault 创建配置（下列路径需自行替换，不在本轮访问）：

```powershell
pnpm --silent corkoro init --source "E:/notes/my-vault" --config "E:/notes/my-vault/网站/corkoro.config.json" --out-dir "E:/generated/my-blog" --format obsidian-markdown --json
pnpm --silent corkoro content add "技术/第一篇文章.md" --slug first-post --config "E:/notes/my-vault/网站/corkoro.config.json" --json
pnpm --silent corkoro content remove article-id --config "E:/notes/my-vault/网站/corkoro.config.json" --json
```

init 创建空配置和必要事务元数据，不创建输出站点。用户填写允许资源根目录、关于页/资料/友链。add/remove 只修改配置内清单，保留其它字段；remove 可停用缺失正文，重复调用不改写配置。扫描属性不是授权。

## 公开内容包库入口

先执行 `pnpm run build`。从仓库根可用以下 PowerShell 示例构建人工样例，输出到样例配置指定的 `.local/example-sites/selected/content.bundle.json`（Git 已忽略 .local）。此处直接调用库，`corkoro build` 仍未实现。

```powershell
@'
import { buildContentBundle, readContentBundle } from './dist/packages/publisher/src/index.js';
const result = await buildContentBundle('tests/fixtures/vault/网站/selected.config.json');
console.log(JSON.stringify(result, null, 2));
if (result.ok) {
  const bundle = await readContentBundle(result.bundlePath);
  console.log(JSON.stringify(bundle.manifest, null, 2));
}
process.exitCode = result.exitCode;
'@ | pnpm exec node --input-type=module
```

接入外部 Vault 时仅替换配置参数（建议传绝对路径）；不要复制内容进源码。库读取配置内 output.directory，只包含启用入口和获准引用资源。包中含规范化正文树、公开资料及资源字节，尚无 HTML 网站。具体字段与错误见[内容包协议](content-bundle.md)。

相同输入返回相同 buildId、effect=none；修改选择后重建会整体替换包，撤回文档和无引用附件随之消失；其它输出文件不受影响。完全空内容或错误引用保留旧包。已有 content.bundle.json 若不是合法内容包，返回 OUTPUT_NOT_OWNED；不会自动删除或修补。尚未创建有效包时，失败也可能留下输出目录和事务元数据。

内容包写入锁忙为 OUTPUT_BUSY，冲突为 OUTPUT_CHANGED。effect=unknown、退出 5 或调用方未收到响应时，先用 readContentBundle 读取目标，核对 buildId/manifest，再用当前配置重试；不重放 .tmp，不把历史结果当作当前发布授权。输入正文和资源始终只读；源编辑发生在捕获之后不会改变本次转换，下一次构建会重新检查。

## 最小 Astro 站点库入口

先构建内容包，再从仓库根调用网站库（不是 `corkoro build`）：

```powershell
@'
import { buildSite, readSite } from './dist/apps/web/src/index.js';
const result = await buildSite('.local/example-sites/selected/content.bundle.json', '.local/site-preview');
console.log(JSON.stringify(result, null, 2));
if (result.ok) console.log((await readSite('.local/site-preview')).siteDirectory);
process.exitCode = result.exitCode;
'@ | pnpm exec node --input-type=module
```

网站库只读公开包，不需要 Vault 或 Obsidian。当前默认主题提供首页文章摘要、独立作者区、文章与普通页面阅读布局及友链卡片，支持配置配色及 base；完整 build CLI 尚未交付。Astro 7.4.11 已固定在锁文件，构建复用工具依赖，不另行联网安装。

输出根保留随机版本目录与 site.current.json。`readSite` 验证活动静态文件摘要并返回 siteDirectory / projectDirectory。只服务或上传 siteDirectory，不要公开整个输出根，其中包含旧版本。可用本地静态服务器查看该目录；配置了 base 时服务器须把该目录挂载到相应前缀。预览不是本轮新增 CLI 命令。

失败保留上次站点，失败目录和旧版本均不自动删除。result.effect 表示当前记录是否提交，retainedDirectory 表示本次分配的目录；unknown 或调用方失去响应时，重新 readSite 核对。坏记录、被手工修改的站点不会自动修复。库仅检查输出与传入包的隔离，使用者仍应选择 Vault 外的输出位置；未来配置级 build 会统一校验所有输入。完整格式、所有权及恢复边界见 [决策 0011](decisions/0011-generated-site-publication.md)。

S2 基础布局曾用人工样例在 1280px 和 390px 宽度检查首页、文章及导航，在移动宽度检查关于页和友链；图片可加载且无横向溢出。运行时 web.test.mjs 覆盖真实 Astro 构建、正文/属性转义、中文与 base 链接、Vault 离线、锁竞争、构建失败、取消、进程中断、非法产物和文件摘要验证。

## Windows 写入与恢复

本轮实际验证 Windows + 本地固定 NTFS 卷 + Windows PowerShell/.NET。辅助进程以 windowsHide、参数数组启动；结构化 stdin 传路径/内容信息，不拼 shell。稳定空锁文件由 FileShare.None 互斥持有；更新通过 File.Replace，首次创建用同卷 File.Move。其它平台、UNC 或不支持卷返回 TRANSACTION_UNSUPPORTED。PowerShell 被环境策略禁用时不绕过策略。

手工编辑器/同步软件不得与命令同时写同一配置。锁忙立即返回 CONFIG_BUSY，不自动重试；不要删除 .corkoro-state 锁载体。进程退出后 OS 释放锁，可重用遗留载体。事务目录被扫描和发布规则排除；旧临时文件不自动重放，给 CLEANUP_PENDING，需人工确认后清理。

退出 5/effect=unknown 或无响应时，先 list/读取配置，再决定是否重试。130 仅表示已知提交前取消。已提交后取消不回滚。效果、错误和恢复详见 [结果协议](cli-protocol.md)与[事务规则](config-transactions.md)。尚未验证断电耐久性，也不保证恶意本地进程并发替换路径时安全。

## 实际验证范围

运行时测试将人工 Vault 复制到独立临时目录，覆盖严格 JSON/版本结构、参数错误、扫描与只读性、中文路径、跨工作目录、空配置、站点资料、幂等稳定 ID、缺文件停用、保留资料/主题、输出隔离、硬链接/junction 越界、双进程竞争与持有者退出、并发 init、提交后响应丢失重试、版本冲突、取消及遗留临时文件。新增 planning.test.mjs 验证引用授权、资源来源合并、解析器语法边界、伪装图片、主动 SVG、缺失/歧义与路径错误，并检查只读命令前后的输入文件哈希。

bundle.test.mjs 另验证公开正文树、内容摘要与引用闭合、零文章站点、确定性重建、部分撤回、只读输入、校验与转换共享捕获字节、输出锁竞争、失去响应后的重读/幂等重试、暂存后进程退出、提交前取消、硬链接拒绝、父目录持锁行为及输出 junction 被替换后仍绑定原目标。生成内容包不代表网站已通过渲染或 UI 验收。

Windows 写入测试在其它平台标为跳过，不能将这些平台的绿色结果当作写入认证。正文、资源的哈希验证与抽象模型检查分别报告。

## 远端与后续阶段

源码远端为 [blackfrog638/corkoro](https://github.com/blackfrog638/corkoro)，默认分支 main。尚未配置 GitHub Actions、Pages 部署或 Cloudflare 资源，也不发邮件。引用解析、只读 plan、公开内容包与最小 Astro 站点库已落地；默认主题体验已完成，下一步接搜索，随后实现完整 build CLI。CI 未来只接收经过筛选的公开快照，不上传整个 Vault。

数据库迁移、生产环境、管理员认证和备份恢复在 API 实现阶段另行建立。不存在的操作不会以占位成功脚本代替。

S2 全量运行时测试 44 项通过；Unicode 组合字符路由回归先复现失败，再统一 NFC 修复。独立审查代理因额度限制中止，未生成完整回执；已对当前改动进行人工复核。Code review: skipped (ce-code-review unavailable) — top-level reviewer terminated at usage limit; manual diff review completed.

## S3 默认主题验收

2026-11-14 S4 进展：网站库在 Astro 成功后、当前站点指针提交前生成 Pagefind 1.6.0 索引；索引进入同一静态文件摘要清单。仅逐条索引公开内容包中的文章和站点页正文，URL 复用 base/NFC 编码规则，不扫描 Vault、首页、资料或友链。零文档站点不生成索引。索引错误阻止新版本提交；取消在索引操作之间检查。已接入 Pagefind 官方组件，页面正文前提供可折叠搜索，无文档则隐藏。浏览器已验证中文“人工”“起步”、无结果提示、根路径与 /blog/ 结果跳转及 390px 无横向溢出；中文分词质量仅以人工样例验证，不承诺任意子串匹配。搜索在浏览器执行，无后端；禁用 JavaScript 时保留浏览导航。

首页摘要仅取已公开正文树的首个顶层段落，合并空白并截取最多 140 个 Unicode 码点；不读取原始 Vault，不改变公开范围。无文章时隐藏文章栏目，无资料或友链时不产生对应栏目。正文已有顶层一级标题则保留；否则使用配置标题补齐。导航显示当前页面，键盘跳转入口将焦点移到正文。

配色使用 theme.settings.colorMode（light/dark/system），accentColor 用于装饰，链接使用文字色。样式无远端字体或客户端脚本依赖。

2026-11-13：全量运行时 47 项通过，随后新增的零文档资料/友链用例与其余主题用例共 4 项单独通过，类型检查通过。真实 Astro 明暗样例构建成功；浏览器检查 1280px 桌面首页、390px 首页/文章/关于/友链，以及深色桌面首页。长代码仅在块内横向滚动，页面不横向溢出，图片加载正常，跳到正文后焦点为 main-content。
