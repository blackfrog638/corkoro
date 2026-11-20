# 开发与运维

## 桌面平台实测范围（2026-11-19）

| 平台与目标卷 | 只读 CLI | 配置、独立内容包和站点指针写入 | 整站构建与预览 |
| --- | --- | --- | --- |
| Windows，本地固定 NTFS | 已验证 | 已验证，使用 Windows PowerShell/.NET | 已在 Windows CI 验证 |
| Linux，本地 ext4 | 运行全量验收 | 系统 Python 3、findmnt、flock 与 renameat2 | 运行四种整站场景 |
| macOS，本地 APFS | 运行全量验收 | 系统 Python 3、diskutil、flock 与 renameatx_np | 在 APFS 和大小写敏感 APFS 卷运行整站验收 |

三平台执行 `pnpm test`、`pnpm run verify:model` 和 `pnpm run verify:sites`。macOS CI 为两种大小写模式分别挂载临时卷。请从仓库根先运行 `pnpm install --frozen-lockfile`。验收只使用临时目录中的人工 Vault。[CI 运行记录](https://github.com/blackfrog638/corkoro/actions/workflows/ci.yml)

POSIX 写入依赖 /usr/bin/python3 及上述系统工具。POSIX 后端以 0600 创建候选文件及锁载体。替换已有配置时沿用属主、属组、普通权限位及访问 ACL，例如 0640 的共享配置更新后仍为 0640。无法复制访问权限时在提交前报错。缺少 findmnt 时返回 TRANSACTION_UNSUPPORTED。Linux 拒绝开启目录 casefold 的 ext4。网络共享、其它文件系统和缺少所需原语的环境不属于支持范围。持锁进程终止后可重新调用；提交响应未知时先重读配置或站点指针。

## 当前可用能力

2026-11-14 S5 进展：publisher 导出 captureContent(configPath, signal?)，返回只读捕获的公开 bundle、configVersion、outputDirectory、diagnostics；网站 buildSite 首参数可直接接收该 bundle。该入口已接入 build --config <file> [--json]，输出使用配置 output.directory。快照交接及后续单提交设计见 [决策 0012](decisions/0012-build-cli-snapshot-handoff.md)。

2026-11-12：可运行 inspect、init、content list/add/remove、含引用检查的 check 和只读 plan。comments 尚未实现，返回不支持。内容包 v1 已通过库入口实现转换与原子写出；2026-11-13 已增加最小 Astro 站点构建库，默认主题与搜索已实现，插件仍待开发。

开发运行版本固定 Node 26.13.0（.node-version），pnpm 11.25.0。package.json 的 Node 范围兼容 pnpm 自身携带的 24.22.1；本轮业务测试运行于 Node 26.13.0。运行 pnpm exec node --version 可核对真正执行脚本的 Node。依赖精确固定并提交 pnpm-lock.yaml；无须真实 Vault 或云凭据。

```powershell
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm test
pnpm run verify:model
```

build 编译 TypeScript 并复制 Windows 和 POSIX 事务辅助脚本到 dist；test 先构建，再运行真实测试。有限状态模型是另一项验证，不能代替运行时测试。三平台的 CI 任务均执行真实入口验收。

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

先执行 `pnpm run build`。从仓库根可用以下 PowerShell 示例构建人工样例，输出到样例配置指定的 `.local/example-sites/selected/content.bundle.json`（Git 已忽略 .local）。此处展示独立内容包库；完整网站请使用下文的 `corkoro build`。

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

网站库只读公开包，不需要 Vault 或 Obsidian。当前默认主题提供首页文章摘要、独立作者区、文章与普通页面阅读布局及友链卡片，支持配置配色及 base；完整 build CLI 已交付。Astro 7.4.11 已固定在锁文件，构建复用工具依赖，不另行联网安装。

输出根保留随机版本目录与 site.current.json。`readSite` 验证活动静态文件摘要并返回 siteDirectory / projectDirectory。只服务或上传 siteDirectory，不要公开整个输出根，其中包含旧版本。可用本地静态服务器查看该目录；配置了 base 时服务器须把该目录挂载到相应前缀。也可使用下文的 preview 命令。

失败保留上次站点，失败目录和旧版本均不自动删除。result.effect 表示当前记录是否提交，retainedDirectory 表示本次分配的目录；unknown 或调用方失去响应时，重新 readSite 核对。坏记录、被手工修改的站点不会自动修复。库仅检查输出与传入包的隔离，使用者仍应选择 Vault 外的输出位置；配置级 build 已统一校验所有输入。完整格式、所有权及恢复边界见 [决策 0011](decisions/0011-generated-site-publication.md)。

S2 基础布局曾用人工样例在 1280px 和 390px 宽度检查首页、文章及导航，在移动宽度检查关于页和友链；图片可加载且无横向溢出。运行时 web.test.mjs 覆盖真实 Astro 构建、正文/属性转义、中文与 base 链接、Vault 离线、锁竞争、构建失败、取消、进程中断、非法产物和文件摘要验证。

## Windows 写入与恢复

本轮实际验证 Windows + 本地固定 NTFS 卷 + Windows PowerShell/.NET。辅助进程以 windowsHide、参数数组启动；结构化 stdin 传路径/内容信息，不拼 shell。稳定空锁文件由 FileShare.None 互斥持有；更新通过 File.Replace，首次创建用同卷 File.Move。Windows UNC 或不支持卷返回 TRANSACTION_UNSUPPORTED。PowerShell 被环境策略禁用时不绕过策略。

手工编辑器/同步软件不得与命令同时写同一配置。锁忙立即返回 CONFIG_BUSY，不自动重试；不要删除 .corkoro-state 锁载体。进程退出后 OS 释放锁，可重用遗留载体。事务目录被扫描和发布规则排除；旧临时文件不自动重放，给 CLEANUP_PENDING，需人工确认后清理。

退出 5/effect=unknown 或无响应时，先 list/读取配置，再决定是否重试。130 仅表示已知提交前取消。已提交后取消不回滚。效果、错误和恢复详见 [结果协议](cli-protocol.md)与[事务规则](config-transactions.md)。尚未验证断电耐久性，也不保证恶意本地进程并发替换路径时安全。

## 实际验证范围

运行时测试将人工 Vault 复制到独立临时目录，覆盖严格 JSON/版本结构、参数错误、扫描与只读性、中文路径、跨工作目录、空配置、站点资料、幂等稳定 ID、缺文件停用、保留资料/主题、输出隔离、硬链接/junction 越界、双进程竞争与持有者退出、并发 init、提交后响应丢失重试、版本冲突、取消及遗留临时文件。新增 planning.test.mjs 验证引用授权、资源来源合并、解析器语法边界、伪装图片、主动 SVG、缺失/歧义与路径错误，并检查只读命令前后的输入文件哈希。

bundle.test.mjs 另验证公开正文树、内容摘要与引用闭合、零文章站点、确定性重建、部分撤回、只读输入、校验与转换共享捕获字节、输出锁竞争、失去响应后的重读/幂等重试、暂存后进程退出、提交前取消、硬链接拒绝、父目录持锁行为及输出 junction 被替换后仍绑定原目标。生成内容包不代表网站已通过渲染或 UI 验收。

三平台执行共用写入测试，并按操作系统验证持锁目录改名行为。正文、资源的哈希验证与抽象模型检查分别报告。

## 远端与后续阶段

源码远端为 [blackfrog638/corkoro](https://github.com/blackfrog638/corkoro)，默认分支 main。已配置验证用 GitHub Actions；示例站使用 gh-pages 分支，CI 验证使用人工 Vault；Cloudflare 云端环境和邮件服务待接入。引用解析、只读 plan、公开内容包与最小 Astro 站点库已落地；默认主题、搜索及完整 build CLI 已完成。部署操作见下文。CI 未来只接收经过筛选的公开快照，不上传整个 Vault。

数据库迁移、生产环境、管理员认证和备份恢复在 API 实现阶段另行建立。不存在的操作不会以占位成功脚本代替。

S2 全量运行时测试 44 项通过；Unicode 组合字符路由回归先复现失败，再统一 NFC 修复。独立审查代理因额度限制中止，未生成完整回执；已对当前改动进行人工复核。Code review: skipped (ce-code-review unavailable) — top-level reviewer terminated at usage limit; manual diff review completed.

## S3 默认主题验收

2026-11-14 S4 进展：网站库在 Astro 成功后、当前站点指针提交前生成 Pagefind 1.6.0 索引；索引进入同一静态文件摘要清单。仅逐条索引公开内容包中的文章和站点页正文，URL 复用 base/NFC 编码规则，不扫描 Vault、首页、资料或友链。零文档站点不生成索引。索引错误阻止新版本提交；取消在索引操作之间检查。已接入 Pagefind 官方组件，页面正文前提供可折叠搜索，无文档则隐藏。浏览器已验证中文“人工”“起步”、无结果提示、根路径与 /blog/ 结果跳转及 390px 无横向溢出；中文分词质量仅以人工样例验证，不承诺任意子串匹配。搜索在浏览器执行，无后端；禁用 JavaScript 时保留浏览导航。

首页摘要仅取已公开正文树的首个顶层段落，合并空白并截取最多 140 个 Unicode 码点；不读取原始 Vault，不改变公开范围。无文章时隐藏文章栏目，无资料或友链时不产生对应栏目。正文已有顶层一级标题则保留；否则使用配置标题补齐。导航显示当前页面，键盘跳转入口将焦点移到正文。

配色使用 theme.settings.colorMode（light/dark/system），accentColor 用于装饰，链接使用文字色。样式无远端字体或客户端脚本依赖。

2026-11-13：全量运行时 47 项通过，随后新增的零文档资料/友链用例与其余主题用例共 4 项单独通过，类型检查通过。真实 Astro 明暗样例构建成功；浏览器检查 1280px 桌面首页、390px 首页/文章/关于/友链，以及深色桌面首页。长代码仅在块内横向滚动，页面不横向溢出，图片加载正常，跳到正文后焦点为 main-content。

## 完整构建 CLI

```powershell
pnpm run build
pnpm corkoro build --config "tests/fixtures/vault/网站/selected.config.json" --json
```

成功结果 data.siteDirectory 是唯一应服务或部署的目录，其中 content.bundle.json 是同版本公开内容包，不包含原始私有配置。site.current.json 的摘要清单同时保护内容包、HTML 和搜索文件。不要公开输出根。旧版本与失败目录保留；退出 5 或失去响应后用网站库 readSite 核对。构建支持本页列出的本地卷，使用已安装的工具依赖。

2026-11-14 S5 验证：全量 50 项运行时测试通过。真实 CLI 在两个不同 cwd 使用同一绝对配置构建，核对 configVersion、buildId 与生成内容包；站点失败/取消/竞争及旧版本保持回归通过。

## CI（S6）

工作流在 push、pull_request 和手动触发时运行。每个任务按锁文件安装、核对 Node、类型检查并执行完整回归，限时 20 分钟。

2026-11-19 三平台真实事务、构建、预览、公开快照及有限模型验收见[四种环境的 CI 记录](https://github.com/blackfrog638/corkoro/actions/runs/44456391565)。macOS 任务先验证临时卷的实际大小写行为，再运行同一套 CLI。

2026-11-18 本地验收使用 Node 26.13.0 和 pnpm 11.25.0。Windows 原生全量测试通过 60 项，跳过 1 项非 Windows 事务拒绝用例，有限模型和四种整站场景通过。WSL2 Ubuntu x86_64 在独立 Linux 临时目录完成冻结安装、类型检查与编译，当时的 cli.test.mjs 和 planning.test.mjs通过 14 项，跳过 10 项 Windows 专用用例。

`pnpm run verify:sites` 要求先执行 `pnpm run build`，复制仓库人工 Vault 到系统临时目录，通过真实 CLI 构建 selected/pages-only，确认空配置和未授权引用返回退出 3；核对输入文件摘要及站点指针清单。临时目录保留供排查，路径打印在结果中，不写真实 Vault。

工作流只有 contents:read 权限，不保留 checkout 凭据，不用 secrets、不部署、不上传产物。PR 代码只在临时托管 runner 上运行，未使用 pull_request_target。固定 Action 来源：[checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node)、[pnpm/action-setup](https://github.com/pnpm/action-setup)。

2026-11-14 本地实测：冻结锁安装、类型检查、有限模型、四种人工场景通过；运行时代码未变，沿用上一提交全量 50 项通过记录。YAML 解析及格式检查通过。此为推送前本地记录；远端结果见下一条验收记录。

2026-11-14 远端验收：[开发分支 CI](https://github.com/blackfrog638/corkoro/actions/runs/43599881122) 全部通过。首次运行发现 Windows 临时路径别名使两项故障注入未触发；测试目标改为 realpath 后通过，未削弱安全断言。

## 本地预览（2026-11-14）

`pnpm corkoro preview --out-dir <构建输出根目录> [--port 4321] [--json]`

先运行 build，再将配置 output.directory 的实际目录传给 preview。--out-dir 相对当前工作目录；不读取 Vault 或当前配置，不重新构建。只绑定 127.0.0.1，端口 0 自动分配空闲端口。启动时验证 site.current.json 和全部文件摘要，捕获同一版本的公开字节；后续修改文件或重建不会改变运行中的预览，需停止后重新启动。只服务摘要清单中的文件，不列目录，不暴露项目源码、旧版本或输出根。子路径使用构建内 content.bundle.json 的 site.address.base。

启动成功时输出地址；--json 输出一个标准结果对象，data 为 { url, buildId }，effect=none、configVersion=null。进程持续服务，Ctrl+C 或 SIGTERM 停止并正常退出；启动前取消退出 130，端口占用等启动错误返回非零。成功对象仅表示已开始监听，不表示部署或进程已结束。首版将站点装入内存，适合本地博客预览，不提供热更新或生产托管。

2026-11-14 preview 本地验收：51 项运行时测试、类型检查、有限模型检查通过。verify:sites 的四个人工场景通过，成功场景另通过 HTTP 核对每个真实 Astro/Pagefind 文件的摘要及脚本、SVG 类型。未重新做浏览器布局验收（本次无页面布局修改），未执行远端发布。


## 部署交接（2026-11-15）

build 在本地生成静态网站。用户可自行选择静态托管服务；使用 GitHub Pages 时，由用户为该博客选择产物仓库和分支。

`pnpm --silent package:site <构建输出根目录>` 将当前站点捕获为完整 JSON 快照并写到 stdout。先执行 pnpm run build 编译工具；目录相对调用工作目录，不读取 Vault、不重新构建、不写入或上传。参数错误退出 2，捕获失败返回非零且 stderr 给出诊断；失败不输出可用包。此开发工具不是 corkoro deploy 命令。

库入口为 apps/web 的 captureDeployment；读取移交快照使用 content-contract 的 parseDeployment 复核摘要。快照不是直接供 Pages 服务的网页，deploy 将快照文件提交到显式指定的本地博客分支。详细边界见 [部署快照决策](decisions/0014-deployment-snapshot.md)。下文分别列出本地提交、远端推送和状态查询的操作步骤。

## 核对博客仓库的发布差异

先编译工具并完成网站 build。下面的 PowerShell 示例从工具仓库根运行。将输出根目录、目标博客仓库的本地副本和本地分支替换为实际值。示例将快照保存为 UTF-8（Windows PowerShell 5 的默认重定向编码为 UTF-16）。
```powershell
$payload = pnpm --silent package:site "E:/generated/my-blog"
if ($LASTEXITCODE -ne 0) { throw "未生成快照" }
$snapshotFile = Join-Path ([IO.Path]::GetTempPath()) ("corkoro-" + [guid]::NewGuid() + ".json")
[IO.File]::WriteAllText($snapshotFile, $payload, [Text.UTF8Encoding]::new($false))
pnpm --silent compare:site "$snapshotFile" "E:/sites/my-blog" main
```

compare:site 校验快照后读取指定本地分支的 Git 树。JSON 报告给出 commit、deploymentId，以及 add、update、unchanged、preserve、conflict 路径列表。preserve 表示目标已有而快照未提供的文件，包括已撤回但仍在仓库中的旧文章，实际撤回需要另行处理。比较以仓库根为发布目录，使用 Git 路径大小写和提交中的原始字节。工作区改动、未跟踪文件和远端分支更新不参与比较。目标分支需已有提交。成功退出 0，参数错误 2，有冲突 3，快照或 Git 读取失败 1。操作不写仓库、不推送，也不表示 Pages 已上线。

## 将核对后的快照提交到本地博客分支

目标是已配置 Git 提交者姓名、邮箱的可信本地仓库，分支须有初始提交。选择未被任何工作区检出的分支，例如预先创建的 publish 分支；也可使用裸仓库。执行期间不要在其他进程检出目标分支。路径使用仓库根目录。先按上文保存快照，再运行：

```powershell
$blogRepo = "E:/sites/my-blog"
$branch = "publish"
$diffJson = pnpm --silent compare:site "$snapshotFile" "$blogRepo" "$branch"
if ($LASTEXITCODE -ne 0) { throw "无法提交，请检查冲突或诊断" }
$review = $diffJson | ConvertFrom-Json
$review | Format-List
# 核对改动后使用同一份报告提交
pnpm --silent corkoro deploy --snapshot "$snapshotFile" --repo "$blogRepo" --branch "$branch" --expected $review.commit --deployment-id $review.deploymentId --json
```

成功结果含 stage=local_commit、commit、branch 和 deploymentId。只有实际更新分支时 effect=committed。已是相同内容时返回 none；原请求重试遇到该请求生成的直接后继提交，也会返回 none。提交前分支已变化或 Git 拒绝原子更新时，重新比较再决定。失去响应后先核对目标分支。操作保留快照以外文件及用户工作区/索引。随后可执行 upload:site 推送该提交，再用 status 核对 Pages 部署。

## 上传已核对的博客提交

先保存 compare:site 的输出为 $review，将本地 deploy 的 JSON 输出解析为 $local。目标仓库已有同名分支，其当前提交应为 $review.commit。Git 凭据使用本机凭据管理器。命令所有位置参数均必填：

```powershell
pnpm --silent upload:site "$snapshotFile" "$blogRepo" "$branch" "https://github.com/OWNER/BLOG.git" $review.commit $local.data.commit $review.deploymentId
```

支持显式 GitHub HTTPS 仓库 URL，测试可使用本机裸仓库绝对路径。要求本地提交以核对过的远端提交为唯一父提交，检查快照中所有文件以及该提交的全部改动路径。推送只更新指定分支，旧提交号在 Git 服务端再次校验。成功 JSON 的 stage 为 remote_commit。重复请求发现完全相同的远端提交时返回 changed=false；远端分支已经前进时停止，重新比较后再操作。初次接入先基于目标已有分支做本地部署；不创建远端、不发送标签、不删除旧文件。失败时 stderr 输出诊断；退出 5 表示推送响应丢失且无法查明远端状态，恢复连接后先核对远端提交。Pages 是否已上线仍需独立确认。

## 查询 GitHub Pages 发布状态

在本地 build、preview 确认页面后，按上文 compare:site、deploy、upload:site 顺序发布。上传成功后查询同一提交，可重复执行：

```powershell
pnpm --silent corkoro status --repo OWNER/BLOG --branch "$branch" --expected $local.data.commit --json
```

命令只读查询 GitHub 的 github-pages 环境中最近 20 条部署，按分支名和完整 40 位提交号识别目标。state 为 live、pending、failed、superseded 或 unknown。liveCommit 是这批记录中最近一条当前状态为 success 的提交，无法确认时为 null。该值反映 GitHub 部署记录，CDN 缓存可能稍后刷新。pending 可稍后重查，failed 可查看仓库 Actions 日志，unknown 时核对目标及部署历史。退出 0 表示查询成功，应读取 state 判断是否上线。退出 4 表示网络、权限或响应错误，可在恢复访问后重查。私有仓库可通过 GH_TOKEN 提供具有 Deployments 读取权限的令牌。需要代理的 Node 环境可设置 HTTPS_PROXY 和 NODE_USE_ENV_PROXY=1。

## 本地评论数据层验收

在仓库根运行 `pnpm run build`，再运行 `node --test tests/runtime/comments.test.mjs`。测试在内存 SQLite 上执行 apps/api/migrations/0001_comments.sql，通过 D1 风格的语句适配器验证匿名提交、审核状态隔离、文章隔离、可选邮箱和分页。全量 `pnpm test` 包含此用例。同一用例文件通过 Worker fetch 入口发送标准 Request，并核验状态码和 JSON。限流使用测试绑定。真实 Workers 运行时和云端 D1 仍待验收。

## 管理员审核评论

管理入口为单独的 apps/api/src/admin.ts，使用同一博客的 DB。先依次应用 0001_comments.sql 与 0002_reviews.sql。每个环境单独生成 32 个随机字节并编码为无填充 base64url。将该字符串的 SHA-256 小写十六进制摘要设为 ADMIN_TOKEN_SHA256，原令牌仅供管理员客户端通过 HTTPS 的 Authorization 请求头以 Bearer 方式使用。更换绑定的摘要即可轮换令牌。

- GET /admin/comments 返回最多 50 条待审评论；下一页传入 ?after=上一页最后一条评论的数字ID。
- POST /admin/comments/{id}/approve 或 /reject 决定结果。相同决定重试返回 200，相反决定返回 409，不存在的 ID 返回 404。缺少有效凭据返回 401。
- 审核决定及 UTC 时间与评论状态在同一 SQL 语句中提交。当前凭据代表单一管理员，不区分多位操作者。公开 Worker 不挂载管理入口。

本地验收沿用上述 comments.test.mjs；云端迁移和服务绑定待指定预览环境后验证。
