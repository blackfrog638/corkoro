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
4. 真实笔记和站点配置放在仓库外；开发临时内容可放在被忽略的 `.local/`。组织示例见 [外部站点项目](../examples/site/README.md)。

## 规划中的命令

开发仓库将建立真实的 `check`、`test`、`build` 等 pnpm 脚本。面向用户的 `corkoro` CLI 是另一层入口，下面仅为计划中的接口示意，不是可执行安装指南：

```powershell
corkoro check --config "E:/sites/my-blog/corkoro.config.json" --json
corkoro build --config "E:/sites/my-blog/corkoro.config.json" --out-dir "./output"
corkoro deploy --config "E:/sites/my-blog/corkoro.config.json" --artifact "./output"
```

`--config` 本身相对调用者工作目录定位。配置内路径及 `--out-dir`、`--artifact` 等对应覆盖路径以配置文件目录为基准，显式参数优先于配置。插件传递参数数组，不拼接 shell 字符串。`check` 只读，`build` 不上传和发信，`deploy` 才产生远端操作。

后续增加发布状态查询与变更计划展示；管理 CLI 计划支持待审列表、批准、拒绝、导出。初期不执行外部生成的任意命令或保存的构建计划。

以上能力目前均未实现。新增命令后将本节改为真实用法，并说明退出码、输入输出和环境选择。

## 远端操作

初始化没有配置 remote、GitHub Actions、Cloudflare 资源或 MCP 连接。首次部署需确定目标仓库、Pages 基路径、权限和环境。构建成功与部署成功分别核对。CI 只接收公开快照和可移植配置，不依赖本机 Vault 路径，不上传整个私人 Vault。

评论管理不要求实现后台网页，但需要授权管理入口。生产操作显式指定环境；只展示本次操作需要的数据。密钥不写入命令示例或日志。

## 数据迁移、备份与恢复

API 开发时将迁移放入 `apps/api/migrations/`，并添加执行说明。导出文件放在仓库外或被忽略的 `backups/`。在拥有真实数据库前不添加占位恢复命令；接入时必须验证一次导出和恢复。
