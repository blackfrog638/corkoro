# CLI 契约 v1

状态：已实现 inspect、init、content list/add/remove、check 和只读 plan；Windows 本地 NTFS 可写，其它平台写入拒绝。build 已实现；deploy 已支持本地分支提交；status 支持按分支与提交查询 GitHub Pages，comments 仍返回不支持；preview 已实现。引用支持边界见 [决策 0008](decisions/0008-readonly-reference-planning.md)。仓库内运行入口见 runbook，尚未全局发布 corkoro。配置与选择语义以 [发布范围协议](publication.md) 为准。校验层次、并发、提交和证明边界见 [状态机](state-machine.md)及[决策 0005](decisions/0005-command-state-boundaries.md)。七个命令的精确封装、守卫和错误优先级以 [结果协议](cli-protocol.md) 为准；配置写入以 [事务协议](config-transactions.md) 为准。

## 命令结构

```text
corkoro <command> [options]
corkoro content <action> [arguments] [options]
```

支持 `--help`、`--version` 和每条命令的 `--help`。首版默认非交互；缺参数或非法选项明确失败，不弹确认提示，也不隐式执行下一阶段。未实现命令报告不支持，不能返回伪成功。

## 接入与选择：首版接口

| 命令 | 作用 | 写入 |
| --- | --- | --- |
| `inspect --source <dir> --format <format> [--json]` | 无配置扫描源库，列出文件、资源、标记线索和支持情况 | 无 |
| `init --source <dir> --config <file> --out-dir <dir> --format <format> [--json]` | 创建单一配置，内含空文章清单和默认主题设置 | 仅指定配置 |
| `content list --config <file> [--json]` | 列出全部清单条目，包括停用条目；不扫描后自动补齐 | 无 |
| `content add <source-path> --config <file> --slug <slug> [--id <id>] [--json]` | 新增或恢复一个显式选择 | 仅配置的 publication.entries |
| `content remove <id> --config <file> [--json]` | 停用一个条目，保留身份 | 仅配置的 publication.entries |
| `check --config <file> [--json]` | 校验配置、选择及已实现的内容规则 | 无 |
| `plan --config <file> [--json]` | 输出文章、页面、资料、友链、资源和逐项理由 | 无 |

`format` 为 `markdown` 或 `obsidian-markdown`，不因发现 `.obsidian` 就擅自启用某个解析器。`inspect` 不需要已有配置；它报告候选路径、数量、已知语法类别及公开属性线索，不输出正文、完整 frontmatter 或 Obsidian 配置文件内容。无法读取的文件和未检查内容必须报告，不能声称完整扫描。构建和选择命令不访问网络；preview 仅监听本机 HTTP。

`init` 在 --config 指定位置创建一个 JSON 配置：publication.entries 和 assetRoots 为空，site.title 为“我的博客”、profile 为 null、pages/friends 为空，theme 为 default（colorMode: system、accentColor: #3b82f6）。--out-dir 必填，输出必须与源目录和资源目录隔离。配置可放在 Vault 内已有的非空目录；仅拒绝已存在的目标配置文件，不要求清空父目录。只创建配置、必要父目录及工具事务元数据，不生成关于页或头像，不覆盖已有文件。附件根目录由用户随后配置，不按目录名自动授权。成功不代表内容校验通过；失败清理只处理本次创建且身份未变的临时文件，允许保留必要父目录；不删除用户文件。

`content add` 不接受目录、glob 或正文中的指令。新增时 source 必须存在且位于允许范围；ID 省略时生成 UUID，slug 必填。重复添加同一路径且 id（若指定）/slug 一致时幂等返回 `changed: false`；停用则恢复原条目。与已有身份冲突时报错，不静默更新 ID 或网址。改名目前通过编辑原条目的 source 完成。

`content remove` 只将 publish 改为 false，不删源文件、附件或远端内容。已停用时幂等返回 `changed: false`；不存在 ID 时返回选择错误。配置写入需通过完整结构校验及当前操作的局部前置条件，不要求全站内容可构建。list/remove 不依赖正文存在或其它文章的引用有效；remove 只接受文章清单 ID。合作写入者需从读取到提交串行化、复核版本并原子提交，发现冲突时拒绝覆盖。手工编辑器/同步软件与命令同时写同一配置不受支持；复核后仍可能竞争，不能承诺任意并发写入零丢失。content 操作仅改变 publication.entries，必须保留 site、theme 及其它区块的值；不改正文或资源。关于页、资料、友链和主题设置首版直接编辑配置，不为它们另设 CLI CRUD 命令。结构错误需先手工修复；停用最后文章可以成功，是否还有站点内容由 check/plan 判断。

提交前失败不改变配置语义；锁文件、临时文件等工具事务元数据不属于用户内容，不能扩大写入权限。提交后进程崩溃或响应丢失时结果可能未知，先重新 list/读取配置，再幂等重试；不能把所有非零退出或无响应都视为“未写入”。init 并发创建必须只有一个提交成功，重试遇到 CONFIG_EXISTS 不覆盖。

## 部署状态查询

`status --repo OWNER/BLOG --branch <branch> --expected <完整提交号> [--json]` 只读查询 GitHub Pages，核对指定分支与提交的部署状态。

## 预留的评论管理命令

`comments list/approve/reject/export` 用于规划中的评论管理。当前帮助将 comments 列为 planned，调用返回 `UNSUPPORTED_COMMAND`。

## 参数与路径

- `inspect/init` 的 `--source` 和各命令的 `--config` 本身相对调用者工作目录解析。
- 配置中的所有路径字段相对配置文件目录。`init --out-dir` 也以目标配置目录为基准（可传绝对路径）；未来对应配置覆盖参数沿用此基准，显式参数优先。
- `content add <source-path>` 是源库内文件标识，相对 `source.root`；清单内保存 `/` 分隔路径，不接受绝对路径和父级遍历。这与配置路径是不同类型。
- `init` 尽量生成相对配置路径；Windows 跨盘无法表达相对路径时使用绝对路径并提示不可直接移植到 CI。
- 首版没有自动查找配置，没有 `--all`、`--force`、持续发布匹配规则或可执行 shell 配置。含空格参数通过独立参数传入。

## JSON 输出与退出码

正常完成及可处理错误下，`--json` 时 stdout 输出一个 JSON 对象；stderr 用于日志（管道损坏时只能尽力输出）。默认输出适合人阅读。已解析到 JSON 模式的错误也使用相同封装；诊断用稳定代码而不是让 agent 解析自然语言。

```json
{
  "schemaVersion": 1,
  "command": "check",
  "ok": true,
  "exitCode": 0,
  "effect": "none",
  "configVersion": "sha256:cdc6b9730e7be1b91071d13fd905fc00e9f84b8df492c568f8e83b284e843b18",
  "data": {
    "selectedCount": 0,
    "pageCount": 0,
    "hasProfile": false,
    "friendCount": 0,
    "passedChecks": [
      "config",
      "selection",
      "site",
      "theme",
      "paths",
      "references"
    ],
    "failedChecks": [],
    "unperformedChecks": [],
    "complete": true,
    "buildable": false
  },
  "diagnostics": [
    {
      "code": "EMPTY_SELECTION",
      "severity": "warning",
      "message": "尚未选择发布内容",
      "location": null
    }
  ]
}
```

`ok` 表示该命令请求的工作是否成功，不代表网站已构建或已上线。`check` 必须列出已检查与未检查范围；部分检查完成时不能宣称整体内容通过。`plan` 在依赖分析尚未实现时应报告不支持，不能输出伪完整集合。空集合指没有启用文章、启用页面、有效 profile 或 friends；仅文章清单为空不构成阻断。`buildable` 在有阻断问题或空集合时为 false，有必需检查未完成且无已知阻断时为 null，全部必要检查通过且非空时才为 true。

`inspect` 的 data 包含 inventory、候选线索、扫描范围和未检查项；`content list` 包含 entries；选择变更包含 entry 和 changed；`init` 包含生成文件路径。具体子结构已在结果协议中定义，运行时验证器随对应实现建立。不同命令的 data 不共用含义不清的字段。

`plan` 的 data 包含 articles、pages、profile、friends、assets、blockedReferences、changes、buildable；每个包含项有 reason 和来源引用。正常未选择笔记不必逐条输出；与入口相关的阻断引用必须列出。首版 `changes` 固定为 null，附 BASELINE_NOT_SUPPORTED；输出 manifest 确定后再实现差异分析。

| 退出码 | 含义 | 典型诊断 |
| --- | --- | --- |
| 0 | 命令成功，可有提示 | 空清单的 init/list/check/plan |
| 1 | 非预期内部错误 | `INTERNAL_ERROR` |
| 2 | 参数、配置或协议版本错误 | `INVALID_ARGUMENT`、`INVALID_CONFIG`、`UNSUPPORTED_VERSION`、`UNSUPPORTED_COMMAND` |
| 3 | 选择或内容规则不满足 | `MISSING_SOURCE`、`PATH_OUT_OF_SCOPE`、`DUPLICATE_ID`、`UNPUBLISHED_TARGET`、`UNSUPPORTED_SYNTAX`；build 的 `EMPTY_SELECTION` |
| 4 | 文件系统操作、锁占用或写入冲突 | `IO_ERROR`、`CONFIG_EXISTS`、`CONFIG_CHANGED`、`CONFIG_BUSY` 等 |
| 5 | 无法确定提交结果 | `COMMIT_UNKNOWN`，effect=unknown |
| 130 | 提交前取消 | `CANCELLED`，effect=none |

发生错误时 `ok: false` 且返回相应退出码。前置阶段失败不继续后续阶段；同阶段多个错误依 internal、protocol、IO/事务、内容排序。取消和提交未知按事务阶段处理，不能用一般错误优先级覆盖提交事实。完整扫描遇到不可读文件不能返回 0，部分 inventory 可保留在 data 中。

## 陌生 Vault 的本地规划操作顺序

```powershell
corkoro inspect --source "E:/notes/陌生 Vault" --format obsidian-markdown --json
corkoro init --source "E:/notes/陌生 Vault" --config "E:/notes/陌生 Vault/网站/corkoro.config.json" --out-dir "E:/generated/my-blog" --format obsidian-markdown --json
# 用户配置允许的附件目录，然后显式选择文章。
corkoro content add "技术/第一篇文章.md" --slug first-post --config "E:/notes/陌生 Vault/网站/corkoro.config.json" --json
corkoro content list --config "E:/notes/陌生 Vault/网站/corkoro.config.json" --json
corkoro check --config "E:/notes/陌生 Vault/网站/corkoro.config.json" --json
corkoro plan --config "E:/notes/陌生 Vault/网站/corkoro.config.json" --json
```

上述是推荐流程，不是要求持久保存“已检查”的强制会话状态。check/plan 是对其所读输入的观察；后续 build 必须自行捕获、校验并渲染同一批输入字节，不能相信旧报告或渲染时重读活跃 Vault。remove 不删除旧构建或撤回远端；preview/deploy 消费的是明确的已提交构建版本。正文、文件名、扫描诊断和评论内容均视为数据，不得作为 agent 操作指令执行。

## 完整构建（2026-11-14）

`corkoro build --config <file> [--json]` 捕获并校验当前配置及内容，生成网站和搜索；输出使用配置 output.directory。首版不提供输出覆盖参数。配置路径相对调用目录，配置内部路径相对配置目录。输入不修改，不上传或部署。结果 data 含 buildId、outputDirectory、siteDirectory、retainedDirectory；生成失败保留旧网站，目录残留不等于提交。effect=unknown 时 data/configVersion 为 null，退出 5；使用 readSite(outputDirectory) 核对当前记录后再决定重试。部署只取 siteDirectory。详见决策 0012。

## 本地预览（2026-11-14）

`pnpm corkoro preview --out-dir <构建输出根目录> [--port 4321] [--json]`

先运行 build，再将配置 output.directory 的实际目录传给 preview。--out-dir 相对当前工作目录；不读取 Vault 或当前配置，不重新构建。只绑定 127.0.0.1，端口 0 自动分配空闲端口。启动时验证 site.current.json 和全部文件摘要，捕获同一版本的公开字节；后续修改文件或重建不会改变运行中的预览，需停止后重新启动。只服务摘要清单中的文件，不列目录，不暴露项目源码、旧版本或输出根。子路径使用构建内 content.bundle.json 的 site.address.base。

启动成功时输出地址；--json 输出一个标准结果对象，data 为 { url, buildId }，effect=none、configVersion=null。进程持续服务，Ctrl+C 或 SIGTERM 停止并正常退出；启动前取消退出 130，端口占用等启动错误返回非零。成功对象仅表示已开始监听，不表示部署或进程已结束。首版将站点装入内存，适合本地博客预览，不提供热更新或生产托管。

## 提交网站快照到本地分支

`deploy --snapshot <file> --repo <local-repo> --branch <branch> --expected <commit> --deployment-id <id> [--json]`。两个版本参数使用 compare:site 报告中的 commit 和 deploymentId。成功结果的 stage 为 local_commit，commit 为目标分支提交号。远端推送使用 upload:site，上线查询使用 status。前置条件和重试示例见 [runbook](runbook.md)。
