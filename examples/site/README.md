# Vault 单配置示例

这里是 [发布范围协议 v1](../../docs/publication.md) 的人工示例说明，已有第一阶段 CLI，可扫描、管理配置和执行基础检查，尚无网站生成产物。所有完整配置实际放在 [人工 Vault 的网站目录](../../tests/fixtures/vault/网站)，用来验证配置在源库内的场景。

用户实际目录可以组织为：

```text
E:/notes/my-vault/
  文章/                         原始文章
  attachments/                  文章附件
  网站/
    corkoro.config.json         唯一配置入口
    关于.md                     关于页正文
    assets/avatar.svg           头像
E:/generated/my-blog/           工具生成的内容包、Astro 项目和静态网站
E:/dev/corkoro/                 工具开发仓库
```

配置内的 publication.entries 保存文章选择和稳定身份；site 保存关于页引用、个人资料、友链；theme 指向 Corkoro 自带的 default 主题及其设置。无需单独的 publication.json、theme 目录或用户维护的站点源码。关于页和头像仍为独立文件，不塞进 JSON。

配置文件中的路径相对配置目录，文章 entry.source 相对 source.root；Markdown 正文中的相对引用以正文目录为准。输出必须在 Vault 与资源根目录外，不能与输入互为祖先。附件目录只表示允许查找的位置，只发布显式入口引用的支持资源。

## 四份独立配置

| 配置 | 场景 | 预期 |
| --- | --- | --- |
| [corkoro.config.json](../../tests/fixtures/vault/网站/corkoro.config.json) | init 的空配置形态 | 零文章、零页面、无资料友链、空附件授权，不能构建 |
| [selected.config.json](../../tests/fixtures/vault/网站/selected.config.json) | 两篇无属性文章，以及关于页、资料、友链 | 两篇文章、一页、被引用图片及头像进入产物 |
| [blocked.config.json](../../tests/fixtures/vault/网站/blocked.config.json) | 文章引用未公开笔记 | 阻断链接/嵌入，不扩大选择 |
| [pages-only.config.json](../../tests/fixtures/vault/网站/pages-only.config.json) | 零文章，有关于页、资料和友链 | 可以生成站点，页面不进文章列表/RSS |

每份都是完整输入，未来通过 --config 选择一份，不合并配置。输出指向仓库内被忽略的 .local/example-sites 下不同目录；目前这些产物不存在。带 publish true 属性的候选文章在所有配置中均未选择，不能自动发布。

后续测试需复制人工 Vault 到独立临时目录，再调整输出到该 Vault 外，验证路径不依赖仓库位置。构建不改任何输入；content 操作只改目标配置内清单并保留其它区块；丢弃输出后应能重建。这里的文件全部是人工数据，不放真实私人笔记。
