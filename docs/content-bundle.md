# 公开内容包 v1

实现位于 `packages/content-contract/src/bundle.ts`；类型和运行时校验在一起。它与输入配置、只读 PlanData、CLI Envelope 是三个不同边界。设计依据见 [决策 0009](decisions/0009-public-content-bundle.md)。

## 文件结构

`output.directory/content.bundle.json`：

| 字段 | 内容 |
| --- | --- |
| format / schemaVersion | 固定 corkoro-content / 1；未知版本或字段拒绝 |
| manifest.site | title、可空 profile、friends、可选 address；头像替换为资源 ID |
| manifest.theme | 经过校验的内置 default 主题设置 |
| manifest.documents | id、article/page 类型、已编码单段 route、title、contentHash |
| manifest.assets | id、mediaType、byteLength |
| documents | id 与 body（root 内容树） |
| assets | id 与 base64 编码的资源字节 |
| buildId | 除自身外的规范化 JSON 的 sha256 摘要 |

文档标题取首个顶层一级标题的纯文字，缺失或空白时使用稳定 ID；frontmatter 不用于标题或授权。route 由配置 slug/页面路由编码，站点部署 base 在后续渲染阶段添加。去重规则解码后按 NFC、忽略大小写判断，与输入清单一致。输出顺序确定：文档沿已验证入口顺序，资源按 ID 排序，友链保留配置顺序。

内容树支持 root、paragraph、heading、blockquote、list、listItem、emphasis、strong、text、inlineCode、code、break、thematicBreak、link、image。链接目标为 document/id、asset/id 或 external/url。引用式链接展开；定义、YAML/TOML frontmatter 和语法位置丢弃；代码块保留 language 与正文，不保留附加 meta。双链别名作为文字保留，不二次解释成 Markdown。原始 HTML、笔记嵌入和锚点等仍按决策 0008 拒绝，Callout/公式尚无专用渲染。

AST 是数据，渲染器必须按白名单节点渲染、转义文字与属性，不能把 text/code 当 HTML 或脚本执行。外链仅允许 HTTP、HTTPS 和 mailto；图片不允许 mailto。不抓取外部资源。资源允许的类型及 SVG 限制沿用引用检查；位图仅检查签名和相关头字段，不承诺完整解码验证。

读入检查字段结构、文档/资源唯一性、路由冲突、清单与负载一一对应、摘要、base64 规范编码、资源类型与引用闭合；拒绝悬空引用和无引用附件。`readContentBundle` 额外对解码后的资源执行内容白名单验证。只调用 schema 不等于已完成资源内容检查。此协议未规定任意节点的所有父子组合，也未规定最终 HTML 样式；生成端由 CommonMark AST 投影，渲染端仍需按类型处理。

产物不加入源路径、输入配置、停用清单或未选正文。作者主动写进已选正文、公开资料或 URL 的文字会保留，这不是自动隐私脱敏工具。

## 库 API

编译后从 `dist/packages/publisher/src/index.js` 导入：

```ts
buildContentBundle(configPath: string, signal?: AbortSignal): Promise<BundleResult>
readContentBundle(filename: string): Promise<ContentBundle>
```

相对 configPath/filename 以调用方工作目录解析；传绝对路径即可独立于工作目录。配置内部相对路径仍以配置文件为基准。构建只写输出，不上传、不写输入；写入目前仅支持 Windows 本地 NTFS。

BundleResult 包含 ok、exitCode、effect、bundlePath、buildId、diagnostics。成功有路径与 buildId；相同内容返回 effect=none，新提交为 committed。失败为 none 或 unknown，unknown 时 buildId=null，不能据此猜测磁盘状态。诊断复用 CLI 结构和排序；这不是 CLI Envelope，不含 command/configVersion/data。

| 情况 | 退出码 / 诊断 |
| --- | --- |
| 成功或相同内容 | 0 |
| 内部错误 | 1 / INTERNAL_ERROR |
| 参数或配置结构错误 | 2 |
| 引用、选择或转换错误；完全空内容 | 3；EMPTY_SELECTION 为构建错误 |
| 文件系统、输出占用/冲突、不受支持的写入环境 | 4；OUTPUT_BUSY / OUTPUT_CHANGED / OUTPUT_NOT_OWNED 等 |
| 提交结果未知 | 5 / COMMIT_UNKNOWN |
| 已知提交前取消 | 130 / CANCELLED |

提交后取消不撤销结果，可返回 CANCEL_AFTER_COMMIT 警告。`readContentBundle` 不返回 BundleResult，读取失败抛出异常；格式或内容校验失败抛出 code=INVALID_BUNDLE 的 Failure，调用方需捕获。

零文章但有页面、profile 或 friends 可构建；完全空内容拒绝，旧包不变。部分撤回需重新构建才进入新包；已经发布的远端内容不会自动删除。恢复时不自动回放 .tmp，先读取 content.bundle.json，再以当前配置重新构建。详情见 [runbook](runbook.md)。
