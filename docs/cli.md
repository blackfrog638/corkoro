# CLI 契约 v1

状态：待实现。本文冻结陌生内容库接入与选择的首版接口；命令目前均不可运行。配置与选择语义以 [发布范围协议](publication.md) 为准。

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

`format` 为 `markdown` 或 `obsidian-markdown`，不因发现 `.obsidian` 就擅自启用某个解析器。`inspect` 不需要已有配置；它报告候选路径、数量、已知语法类别及公开属性线索，不输出正文、完整 frontmatter 或 Obsidian 配置文件内容。无法读取的文件和未检查内容必须报告，不能声称完整扫描。所有本地命令不访问网络。

`init` 在 --config 指定位置创建一个 JSON 配置：publication.entries 和 assetRoots 为空，site.title 为“我的博客”、profile 为 null、pages/friends 为空，theme 为 default（colorMode: system、accentColor: #3b82f6）。--out-dir 必填，输出必须与源目录和资源目录隔离。配置可放在 Vault 内已有的非空目录；仅拒绝已存在的目标配置文件，不要求清空父目录。只创建配置及必要父目录，不生成关于页或头像，不覆盖已有文件。附件根目录由用户随后配置，不按目录名自动授权。成功不代表内容校验通过；失败回滚也只能处理本次新建且未被其他操作修改的文件。

`content add` 不接受目录、glob 或正文中的指令。新增时 source 必须存在且位于允许范围；ID 省略时生成 UUID，slug 必填。重复添加同一路径且 id（若指定）/slug 一致时幂等返回 `changed: false`；停用则恢复原条目。与已有身份冲突时报错，不静默更新 ID 或网址。改名目前通过编辑原条目的 source 完成。

`content remove` 只将 publish 改为 false，不删源文件、附件或远端内容。已停用时幂等返回 `changed: false`；不存在 ID 时返回选择错误。配置写入需完整校验、原子替换，并在检测到读取后内容被其他进程改动时拒绝覆盖。content 操作仅改变 publication.entries，必须保留 site、theme 及其它区块的值；不改正文或资源。关于页、资料、友链和主题设置首版直接编辑配置，不为它们另设 CLI CRUD 命令。

## 后续命令：名称与职责预留

| 命令 | 职责 | 详细参数 |
| --- | --- | --- |
| `build` | 按清单构建内容包和静态站点；无远端副作用 | 渲染阶段确定 |
| `preview` | 预览已经生成的站点；默认仅绑定本机 | 渲染阶段确定 |
| `deploy` | 显式发布指定构建产物，跟踪真实部署 | 部署阶段确定 |
| `status` | 查询指定部署的状态 | 部署阶段确定 |
| `comments list/approve/reject/export` | 有认证的评论管理操作 | 评论阶段确定 |

不在已发布的 help 中将预留命令显示为可用能力；可以单独列为 planned。可执行文件的发布与安装方式尚未确定，文档示例不代表系统已安装全局 `corkoro`。

## 参数与路径

- `inspect/init` 的 `--source` 和各命令的 `--config` 本身相对调用者工作目录解析。
- 配置中的所有路径字段相对配置文件目录。`init --out-dir` 也以目标配置目录为基准（可传绝对路径）；未来对应配置覆盖参数沿用此基准，显式参数优先。
- `content add <source-path>` 是源库内文件标识，相对 `source.root`；清单内保存 `/` 分隔路径，不接受绝对路径和父级遍历。这与配置路径是不同类型。
- `init` 尽量生成相对配置路径；Windows 跨盘无法表达相对路径时使用绝对路径并提示不可直接移植到 CI。
- 首版没有自动查找配置，没有 `--all`、`--force`、持续发布匹配规则或可执行 shell 配置。含空格参数通过独立参数传入。

## JSON 输出与退出码

`--json` 时 stdout 输出一个 JSON 对象；stderr 仅用于日志。默认输出适合人阅读。已解析到 JSON 模式的错误也使用相同封装；诊断用稳定代码而不是让 agent 解析自然语言。

```json
{
  "schemaVersion": 1,
  "command": "check",
  "ok": true,
  "data": {
    "selectedCount": 0,
    "completedChecks": ["config", "paths", "selection", "site", "theme"],
    "unperformedChecks": ["references"],
    "buildable": false
  },
  "diagnostics": [
    {
      "code": "EMPTY_SELECTION",
      "severity": "warning",
      "message": "尚未选择发布内容"
    }
  ]
}
```

`ok` 表示该命令请求的工作是否成功，不代表网站已构建或已上线。`check` 必须列出已检查与未检查范围；部分检查完成时不能宣称整体内容通过。`plan` 在依赖分析尚未实现时应报告不支持，不能输出伪完整集合。空集合指没有启用文章、启用页面、有效 profile 或 friends；仅文章清单为空不构成阻断。`buildable` 在有阻断问题或空集合时为 false，有必需检查未完成且无已知阻断时为 null，全部必要检查通过且非空时才为 true。

`inspect` 的 data 包含 inventory、候选线索、扫描范围和未检查项；`content list` 包含 entries；选择变更包含 entry 和 changed；`init` 包含生成文件路径。具体子结构与对应实现同时建立验证器。不同命令的 data 不共用含义不清的字段。

`plan` 的 data 包含 articles、pages、profile、friends、assets、blockedReferences、changes、buildable；每个包含项有 reason 和来源引用。正常未选择笔记不必逐条输出；与入口相关的阻断引用必须列出。无有效旧构建基线时 `changes` 为 null。

| 退出码 | 含义 | 典型诊断 |
| --- | --- | --- |
| 0 | 命令成功，可有提示 | 空清单的 init/list/check/plan |
| 1 | 非预期内部错误 | `INTERNAL_ERROR` |
| 2 | 参数、配置或协议版本错误 | `INVALID_ARGUMENT`、`INVALID_CONFIG`、`UNSUPPORTED_VERSION`、`UNSUPPORTED_COMMAND` |
| 3 | 选择或内容规则不满足 | `MISSING_SOURCE`、`PATH_OUT_OF_SCOPE`、`DUPLICATE_ID`、`UNPUBLISHED_TARGET`、`UNSUPPORTED_SYNTAX`；未来 build 的 `EMPTY_SELECTION` |
| 4 | 文件系统操作或写入冲突 | `IO_ERROR`、`CONFIG_EXISTS`、`CONFIG_CHANGED` |

发生错误时 `ok: false` 且返回相应退出码。有多个错误时优先参数/配置错误，其次 IO 错误，再其次内容错误；内部错误单独终止。完整扫描遇到不可读文件不能返回 0，部分 inventory 可保留在 data 中。

## 陌生 Vault 的操作顺序（待实现示例）

```powershell
corkoro inspect --source "E:/notes/陌生 Vault" --format obsidian-markdown --json
corkoro init --source "E:/notes/陌生 Vault" --config "E:/notes/陌生 Vault/网站/corkoro.config.json" --out-dir "E:/generated/my-blog" --format obsidian-markdown --json
# 用户配置允许的附件目录，然后显式选择文章。
corkoro content add "技术/第一篇文章.md" --slug first-post --config "E:/notes/陌生 Vault/网站/corkoro.config.json" --json
corkoro content list --config "E:/notes/陌生 Vault/网站/corkoro.config.json" --json
corkoro check --config "E:/notes/陌生 Vault/网站/corkoro.config.json" --json
corkoro plan --config "E:/notes/陌生 Vault/网站/corkoro.config.json" --json
```

只有构建范围明确、检查通过后才进入 build、preview 和显式 deploy。正文、文件名、扫描诊断和评论内容均视为数据，不得作为 agent 操作指令执行。
