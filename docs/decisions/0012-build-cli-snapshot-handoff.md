# 0012：完整构建使用内存快照交接

日期：2026-11-14。S5 的快照库入口已实现，命令及结果协议已实现。

不能简单地串联 buildContentBundle(config) 与 buildSite(共享包路径)：两次调用之间，另一构建可能替换包，导致本次命令渲染别人的捕获结果。完整构建应由 publisher 捕获并校验输入，直接把本次公开内容包交给网站库。

captureContent(configPath, signal?) 返回 bundle、configVersion、outputDirectory 与 diagnostics；读取配置一次，以配置目录解析输出，校验所有输入输出隔离，调用现有引用分析与正文转换，不写中间内容包。空选择和内容错误拒绝捕获，取消不返回可用快照。

buildSite 现在同时接受包路径和内存内容包。内存入口在第一次 await 前序列化、深复制并完整校验，包括资源字节校验；调用方后续修改对象不影响此次构建。它仍不能自行推断 Vault 路径，完整 CLI 必须传入 captureContent 校验过的输出位置。路径入口保持原有包文件隔离检查。

CLI 为 build --config <file> [--json]，不提供输出覆盖。编排在 tools/cli，publisher 不反向导入网站应用。公开内容包写入新 generation 的 site/content.bundle.json，与网站及搜索共同纳入摘要清单，只有一次 site.current.json 提交。它不更新旧的根级 content.bundle.json。effect 表示当前版本指针提交，失败生成目录可保留。成功 data 含 buildId、outputDirectory、siteDirectory、retainedDirectory；提交未知依统一 envelope 返回 data/configVersion=null、effect=unknown、退出 5。无响应时通过 readSite 重新核对，不能盲目重放。

实测：捕获不修改配置、不创建输出；捕获后 Vault 离线仍可构建；buildSite 调用后修改原对象不改变站点 buildId 或页面。旧路径入口的锁竞争、取消、故障和旧站点保留回归继续通过。
