# 发布范围协议 v1

状态：首版配置结构校验、显式选择和基础路径检查已实现；内容引用解析与构建尚未实现。CLI 用法见 [命令契约](cli.md)，执行顺序见 [开发计划](roadmap.md)。本协议落实 [单配置决策](decisions/0004-vault-config-generated-site.md)。v1 尚未公开发布；当前开发版采用本协议，无已发布数据迁移。

## 授权来源

Vault 内单个配置文件的 publication.entries 是当前站点唯一的文章公开授权来源。文章必须有对应 entry 且 `publish` 严格为布尔值 `true` 才能成为构建入口。

扫描到文件不等于选择文件；链接到另一篇笔记不等于允许公开它。新站点清单为空，不根据目录名称、标签、正文或源笔记中的 `publish: true` 自动选择。源笔记属性仅用于候选提示，既不自动授予授权，也不隐式覆盖配置内清单；`inspect` 的线索不是发布清单。

用户可编辑清单，插件和 CLI 可在明确选择操作时修改清单。agent 不根据内容猜测作者意图并自动加入文章。首版只支持逐文件选择，不支持持续匹配 glob/标签的自动公开规则，也不直接执行扫描结果中的命令。

## 一个配置入口，两类文件

`corkoro.config.json` 保存配置、publication.entries、个人资料、友链和主题设置。关于页 Markdown、头像等仍为独立文件，由这一个配置引用。输出构建 manifest 是生成记录，不是另一份用户维护的输入清单。

配置推荐放在 Vault 的 `网站/` 目录。完整示例（字段已有运行时校验，网站尚未实现）：

```json
{
  "schemaVersion": 1,
  "source": {
    "root": "..",
    "format": "obsidian-markdown",
    "assetRoots": [
      "../attachments",
      "./assets"
    ]
  },
  "publication": {
    "entries": [
      {
        "source": "文章/起步.md",
        "id": "fixture-first",
        "slug": "first-post",
        "publish": true
      },
      {
        "source": "文章/相关阅读.md",
        "id": "fixture-related",
        "slug": "related",
        "publish": true
      }
    ]
  },
  "site": {
    "title": "示例作者的博客",
    "profile": {
      "name": "示例作者",
      "bio": "这里是人工示例资料。",
      "avatar": "./assets/avatar.svg",
      "socials": [
        {
          "label": "个人主页",
          "url": "https://example.org"
        }
      ]
    },
    "pages": [
      {
        "id": "page-about",
        "source": "./关于.md",
        "route": "/about/",
        "publish": true
      }
    ],
    "friends": [
      {
        "name": "示例友链",
        "url": "https://example.org",
        "description": "人工示例，不会在本次访问该地址。"
      }
    ]
  },
  "theme": {
    "name": "default",
    "settings": {
      "colorMode": "system",
      "accentColor": "#3b82f6"
    }
  },
  "output": {
    "directory": "../../generated/my-blog"
  }
}
```

顶层 schemaVersion、source、publication、site、theme、output 均必填。source.format 为 markdown 或 obsidian-markdown。publication 只包含 entries，不再支持 file。site 的 title、profile、pages、friends 必填；允许 profile 为 null、pages/friends 为空。theme.name 首版只接受 default。所有对象拒绝未知字段及不支持的版本。

配置文件路径相对调用者工作目录；配置中的文件路径相对配置文件目录。文章 entry.source 相对 source.root。site.pages[].source、profile.avatar 等路径相对配置目录，并必须解析到 source.root 内的文件。输出目录不得与源目录或资源根目录相同或互为祖先，也不能包含配置文件。配置允许位于源目录内，但不能被文章/页面/附件选择公开。

附件根目录也相对配置目录，允许位于源内；只发布被明确入口引用的支持类型。配置本身、Markdown 冒充附件和系统目录不能借资源机制公开。扫描和显式公开入口排除 .corkoro-state 事务目录；配置文件自身也不得放入该目录。扫描跳过 .git、.obsidian、.trash、node_modules，首版不遍历子目录符号链接；路径边界需解析实际目标（包括 junction），输出尚不存在时解析最近存在祖先。

## 关于页、个人资料、友链与默认主题

- site.title 是非空站点标题，不单独代表存在可发布内容。
- site.profile 为 null 或包含非空 name、bio 字符串、socials 数组的对象；可选 avatar 为 Vault 内资源路径。socials 每项包含 label 和 http/https URL。不把其它任意配置字段透传到页面。
- site.friends 是显式公开的列表，每项包含非空 name 和 http/https URL，可选 description。默认主题在列表非空时生成 /friends/；首版不抓取友链站点信息。
- site.pages 每项包含 id、source、route、publish。id 与文章 ID 同样稳定且全局唯一；source 指向 Vault 内 Markdown，但相对配置目录；publish 为布尔值。启用页面参与依赖分析，不进入文章列表和 RSS。
- route 使用 /segment/ 形式的单段路由，segment 遵循文章 slug 规则。文章路由为 /<slug>/；首页 /、/friends/、/search/ 为默认主题保留路径。页面和所有文章 slug 的路由按 NFC 和忽略大小写检查冲突，包括停用条目，避免恢复时发生隐式覆盖。
- 同一个 Markdown 不能同时声明为文章和站点页。停用页面仍保留身份与路由，不要求源文件存在；启用页面必须存在。
- theme.settings 首版包含 colorMode（system/light/dark）和 accentColor（# 加六位十六进制颜色）。配置其它主题名称或未支持设置时报错。首版不接外部 CSS/组件/主题包；默认主题由 Corkoro 提供，版本跟随工具。
- 配置中显式填写的 profile、friends 即为展示输入；不需要再把它们加入文章清单。头像及页面图片仍须位于 source.assetRoots 内。用户可在 Obsidian 里维护配置与被引用文件，不编辑生成的 Astro 项目。

## 配置内的文章发布清单

下面是 publication 区块的片段，不是独立文件：

```json
{
  "entries": [
    {
      "source": "技术/第一篇文章.md",
      "id": "article-001",
      "slug": "first-post",
      "publish": true
    }
  ]
}
```

- `entries` 可为空；每个条目的四个字段必填，未知键报错。`publish` 只接受布尔值，不接受字符串或数字。
- `source` 相对 `source.root`，统一保存 `/` 分隔路径。只接受源内的 `.md` 文件，不接受绝对路径、空段、`.`、`..` 或 glob；显式新增时必须存在。
- `id` 是站点内唯一的不透明标识；允许 1～128 位 ASCII 字母、数字、`.`、`_`、`-`，首位必须为字母或数字。工具默认生成 UUID，允许用户显式指定；生成后只存配置内清单，不写回文章正文。
- `slug` 是非空的单个 URL 路径段，允许中文；禁止 `/`、`\`、`?`、`#`、`%`、控制字符、首尾空白、`.` 和 `..`。由用户显式指定，渲染器统一编码，不能由文件改名自动变化。
- 清单内的 source、id、slug 均唯一，包括停用条目。词法重复 source 在结构层判断；实际文件的大小写别名、硬链接等重复在 paths 层按文件身份判断；slug 以 NFC 归一化并忽略大小写检查冲突，避免跨平台产生两个网址。
- `publish: false` 保留身份但不构建。停用条目的字段仍需符合格式，不要求其源文件存在；启用条目缺文件是 check/plan/build 的内容错误，不阻止 list 或对该条目 remove。

源文件改名后，修改原 entry 的 `source`，保留 id/slug；首版不猜测重命名，不按内容哈希自动分配身份。一个文件不能在同一清单内分配两个 ID。多站点各自维护一份完整配置。

`content remove` 将 `publish` 改为 false，保留 ID 和 slug。再次选择同一路径时恢复原 entry；不会生成新 ID。只有手动明确编辑清单才彻底移除历史条目。稳定身份依赖保留历史且不复用旧 ID；手工彻底删除后，本配置无法识别旧 ID 是否被分配给另一篇文章。

## 依赖与公开范围

文章入口是启用清单条目；站点页入口是启用的 site.pages，profile 和 friends 提供结构化展示内容。核心分析入口文档的依赖，不将整个源树或资源根目录打包。

| 引用 | v1 行为 |
| --- | --- |
| 已启用文章/站点页之间的 Markdown 链接或双链 | 解析到对应文章 slug 或页面 route，记录依赖 |
| 链接指向未选中或停用文档 | `UNPUBLISHED_TARGET` 错误；不自动公开，也不静默生成失效链接 |
| 嵌入未选中或停用笔记 | `UNPUBLISHED_EMBED` 错误；绝不展开正文 |
| 嵌入已选中文档 | 首版返回 `UNSUPPORTED_SYNTAX`，后续支持时再定义递归与循环规则 |
| 已启用文章、页面或显式资料引用的本地资源 | 仅在资源类型受支持且实际路径位于允许资源根目录时包含；逐项列出来源 |
| 无引用附件 | 不包含，即使位于允许资源目录 |
| 以图片语法引用 `.md` 或系统目录文件 | 不作为附件绕过文章选择规则，报错 |
| 缺失、歧义、越界目标 | 分别诊断并阻止成功构建 |
| 外部 URL | 不下载、不递归抓取，不作为本地依赖打包 |

普通 Markdown 相对引用以当前源文档目录解析；这是文档语法规则，不是配置路径规则。Obsidian 双链先按明确路径匹配，再按唯一笔记名匹配；歧义时报错。链接标题、块锚点等支持边界在依赖分析实现时确定；未完成检查必须标为未检查或不支持，不能输出完整通过。

资源类型白名单在内容执行阶段建立；首版不提供任意文件下载通道。扫描其他笔记的路径或元数据以建立链接索引，不等于允许其正文进入输出。

## 空清单、计划和构建

空文章清单是有效配置。可发布内容包括：启用文章、启用站点页、非 null 的有效 profile、非空 friends。只要其中一种存在且校验完整通过，即使零篇文章也可构建。只有站点标题或主题设置不算内容。

完全没有内容时，init/list/check/plan 可以成功并返回 EMPTY_SELECTION 提示，plan.buildable 为 false；build 拒绝执行且不覆盖已有产物。禁止退回全库公开；未来撤回整个站点需单独明确操作。

`plan` 是只读解释结果，不是可执行脚本。结果包含启用文章、站点页、显式资料/友链、解析出的资源、未通过的引用、稳定原因代码及来源；不输出未公开正文。首版 changes 固定为 null 并标记 BASELINE_NOT_SUPPORTED；在输出 manifest 另行定义后才增加基线比较，不假装无差异。

构建重新执行相同选择与检查逻辑，不执行过期的 plan JSON。捕获的输入字节和解析结果同时供校验与渲染使用，渲染器不重读活跃源文件。读取时发现变动应失败；这不等于任意多文件瞬时快照，严格一致构建需稳定输入或不可变快照。事务与环境假设见 [状态机](state-machine.md)。相同输入与配置应产生相同公开内容集合。清单修改只影响下次构建，旧本地产物和已部署的远端站点不会因此即时改变。公开范围按每个构建自身的输入快照判断，不能用当前清单回溯断言旧产物自动消失。

## 必须验证的场景

1. 陌生 Vault 没有任何标记时，能扫描和初始化，发布集合仍为空。
2. 有笔记写着 `publish: true`，但清单为空时仍不发布；报告只列为候选线索。
3. 没有 frontmatter 的笔记可由配置内清单选择，不修改源文件。
4. 选中 A，A 引用已选 B 和允许图片：集合准确且能解释每项来源。
5. 选中 A，A 链接/嵌入未选 C：报告具体引用错误，不把 C 加进来。
6. 无引用附件、配置文件本身及图片语法伪装的笔记不进入产物；网站目录内仅显式引用的关于页和头像可以进入产物。
7. 停用后重新选择，ID/slug 保留；源改名未更新清单时失败，不创建新文章身份。
8. 从不同工作目录调用，路径一致；中文和空格路径可用；只读命令下所有输入哈希不变；init/content 仅改变指定配置，正文和资源哈希不变。
9. 无文章但有关于页/资料/友链时可以构建；页面不进入文章 RSS，路由冲突明确失败。
10. 输出目录完全丢弃后可重建；配置和输入内保存全部身份及个人数据，默认主题来自固定工具版本。
