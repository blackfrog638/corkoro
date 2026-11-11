# 开发与运维

## 当前可用能力

当前只有目录骨架。根 `package.json` 不提供 `dev`、`build`、`test` 等脚本；模块实现后再添加真实命令。

包管理器固定为 pnpm 11.25.0（初始化环境中可用的版本）。首次引入运行时依赖时校验兼容性，固定 Node 版本并提交锁文件。本次未安装依赖。

可用的只读检查：

```powershell
git status --short
node -e "JSON.parse(require('node:fs').readFileSync('package.json','utf8')); console.log('package.json OK')"
```

## 开发启动前

1. 阅读 `docs/roadmap.md`，确定本次实现范围。
2. 在对应模块加入真实包清单，建立验证入口。
3. 使用人工测试笔记，不需要真实 Vault 或生产凭据。
4. 真实笔记和站点配置放在仓库外；开发临时内容可放在被忽略的 `.local/`。组织示例见 [Vault 单配置示例](../examples/site/README.md)。

## 已约定但尚未实现的命令

开发仓库将建立真实 pnpm 脚本。面向用户的 corkoro CLI 是另一层入口，权威用法见 [CLI 契约](cli.md)，选择规则见 [发布范围协议](publication.md)。下面不是可执行安装指南：

```powershell
corkoro inspect --source "E:/notes/my-vault" --format obsidian-markdown --json
corkoro init --source "E:/notes/my-vault" --config "E:/notes/my-vault/网站/corkoro.config.json" --out-dir "E:/generated/my-blog" --format obsidian-markdown --json
corkoro content add "技术/第一篇文章.md" --slug first-post --config "E:/notes/my-vault/网站/corkoro.config.json" --json
corkoro content list --config "E:/notes/my-vault/网站/corkoro.config.json" --json
corkoro check --config "E:/notes/my-vault/网站/corkoro.config.json" --json
corkoro plan --config "E:/notes/my-vault/网站/corkoro.config.json" --json
```

初始化默认空清单及空附件授权；使用者需设置允许的附件目录并显式选择文章。source、config 参数相对调用者目录；配置字段和 init 的 out-dir 相对配置目录；content add 的文章路径相对源根目录。源笔记属性只提供线索，不能自动加入选择。插件传递参数数组，不拼接 shell 字符串。

init/content 只创建或修改指定配置，保留 site/theme，不改正文和资源。inspect/check/plan/build 对全部输入只读。个人资料、友链及默认主题设置内联于配置，关于页和头像通过路径引用；没有独立 publication.json 或需要手改的站点项目。

plan 指明文章、页面、资料、友链与附件的包含理由，阻断未公开引用；JSON 只是一份报告。后续 build、preview、deploy、status 和评论管理的详细参数尚未冻结。构建不上传和发信，部署才产生远端操作。

以上能力目前均未实现。新增命令后将本节改为真实用法，并说明退出码、输入输出和环境选择。

## 远端操作

初始化没有配置 remote、GitHub Actions、Cloudflare 资源或 MCP 连接。首次部署需确定目标仓库、Pages 基路径、权限和环境。构建成功与部署成功分别核对。CI 只接收公开快照和可移植配置，不依赖本机 Vault 路径，不上传整个私人 Vault。

评论管理不要求实现后台网页，但需要授权管理入口。生产操作显式指定环境；只展示本次操作需要的数据。密钥不写入命令示例或日志。

## 数据迁移、备份与恢复

API 开发时将迁移放入 `apps/api/migrations/`，并添加执行说明。导出文件放在仓库外或被忽略的 `backups/`。在拥有真实数据库前不添加占位恢复命令；接入时必须验证一次导出和恢复。
