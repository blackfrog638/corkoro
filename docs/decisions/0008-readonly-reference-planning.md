# 0008：只读引用分析与可解释计划

日期：2026-11-12。细化 0007 的下一阶段；本次交付 `check` 的引用层和 `plan`，不交付内容包写出或站点构建。

## 决策

- `check` 与 `plan` 调用同一分析函数，先校验配置和路径，再捕获已选文章/页面的字节并解析。保留捕获字节、语法树和解析目标，供后续内容执行复用；报告本身不能作为未来构建授权。
- CommonMark 使用 mdast-util-from-markdown，frontmatter 扩展将 YAML/TOML 元数据排除出正文依赖。Obsidian 双链在原始源位置识别，排除代码、元数据、HTML、已有 Markdown 链接/图片区域。只索引未选文件的路径，不读取其正文。
- 普通 Markdown 相对路径基于正文目录，URL 编码解码一次。双链含 `/` 时按源根相对路径解析，`./` 和 `../` 则按正文目录；不含 `/` 的文件名必须在源与允许资源根目录的索引中唯一。双链名称按字面匹配，不做 URL 解码。索引不遍历符号链接，跳过系统目录，重复根只扫描一次。
- 无扩展名的本地引用按 `.md` 解析。双链支持 `[[目标|显示名]]` 和图片 `![[attachments/image.svg]]`；显示名不参与授权。大小写按索引中的文件名精确匹配；不自动选择同名候选。不支持依赖 Obsidian frontmatter aliases 搜索。
- HTTP(S)、协议相对 URL 和普通链接的 mailto 是外部引用，不访问网络。其它 URI scheme、绝对本地路径、系统目录、配置文件身份别名、越界目标均阻断。未选文档的链接/图片语法/嵌入仍按未授权笔记处理。
- 本轮标题/块锚点、带 query 的本地路径、整篇笔记嵌入、原始 HTML 和 Dataview/DataviewJS 代码块返回 `UNSUPPORTED_SYNTAX`。普通代码块与行内代码是字面内容。Callout、数学排版及其它插件视图没有渲染实现；本阶段不承诺 Obsidian 的完整显示兼容性。后续渲染必须消费已分析的语法树，不启用新的文件读取或执行插件。
- 资源首批只接受 PNG、JPEG、GIF、WebP 和受限静态 SVG。栅格图做扩展名与文件头校验，不是完整解码或恶意文件检测；Markdown 改后缀不能通过。SVG 使用 saxes 严格 XML 解析，只允许基本图形、文字元素和静态属性，禁止脚本、事件、样式、外链、DOCTYPE 和处理指令；不清洗后静默接受。SVG 支持范围由 assets.ts 的白名单定义。
- 每份通过验证的资源只列一次，保留所有直接引用入口的理由；多个重叠资源根中按配置次序选择第一个。未引用资源不读取、不包含。profile/friends 为明确公开资料，plan 不包含正文或整份配置，但仍是本地诊断报告，不能原样部署。

## 结果与边界

完全分析完成后发现坏链：`complete=true`、`buildable=false`、退出 3。路径前置失败或 IO/输入变动中止：`complete=false`、`buildable=false`。空集合完成分析后退出 0，但仍不可构建。`changes=null` 与 `BASELINE_NOT_SUPPORTED` 明确表示没有基线比较。

本轮未建立输出 manifest、写出事务或 HTML 渲染器。`buildable=true` 表示此捕获输入通过当前约定的规划规则，不表示网站已生成。多文件读取不是全库瞬时快照；文件系统并发假设沿用状态机文档。

## 依据与验证

解析器 API 依据：[mdast-util-from-markdown](https://github.com/syntax-tree/mdast-util-from-markdown)、[frontmatter 扩展](https://github.com/syntax-tree/mdast-util-frontmatter)、[saxes](https://github.com/lddubeau/saxes)。依赖固定版本并随锁文件提交；saxes 6 为已归档的成熟解析器，限制为无实体扩展的静态 SVG 校验，未来替换时需保留白名单与回归样例。

人工临时 Vault 测试覆盖选中/未选笔记、代码与元数据、URL 编码、引用式图片、双链别名/歧义、站点独立内容、附件伪装、SVG 主动内容、硬链接配置别名、junction 越界、缺失目标、跨工作目录确定性和全部输入哈希不变。真实文件系统验证与有限模型分别报告，见 [runbook](../runbook.md)。
