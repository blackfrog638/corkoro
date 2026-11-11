# 外部站点项目示例

这里只解释组织方式，没有可运行配置或生成产物。第一阶段实现配置协议后再加入真实示例。

用户实际使用时无需在 Corkoro 源码中创建文章目录：

```text
E:/notes/my-vault/          原始笔记及附件
E:/sites/my-blog/
  corkoro.config.json      指向外部内容源
  theme/                   用户的样式和页面定制
  output/                  工具生成的内容包与静态网站
E:/dev/corkoro/             工具开发仓库
```

以下 JSON 仅为字段草案，尚未冻结或实现。所有路径字段相对配置文件目录；附件目录也遵循此规则，不相对内容根目录。

```json
{
  "schemaVersion": 1,
  "source": {
    "root": "../../notes/my-vault",
    "format": "obsidian-markdown",
    "assetRoots": ["../../notes/my-vault/attachments"]
  },
  "output": { "directory": "./output" }
}
```

附件目录仅表示允许查找的位置，发布集合由公开文章引用计算。输出不是源笔记的一部分，不手工修补产物。源与输出不能相同或互为祖先。

人工样例可放在工具仓库，真实私人笔记不放在示例中。后续测试还需把样例复制到仓库外的临时目录验证，不能只证明固定目录能运行。
