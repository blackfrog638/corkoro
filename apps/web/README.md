# 网站

已实现最小站点构建库。编译入口为 dist/apps/web/src/index.js，buildSite(bundlePath, outputDirectory, signal?) 生成独立 Astro 项目和静态网站；readSite(outputDirectory) 校验并定位当前站点。

src/render.ts 负责公共正文转义与链接，src/theme.ts 提供默认主题布局，src/theme-styles.ts 管理响应式与明暗样式，src/index.ts 处理构建和版本切换。支持范围与示例见 [runbook](../../docs/runbook.md)，输出保证见 [决策 0011](../../docs/decisions/0011-generated-site-publication.md)。已接入 Pagefind 静态搜索；尚无完整 build CLI。

提供内置 default 主题及 Astro 站点生成/渲染能力，负责文章、关于页、个人资料、友链、导航、搜索与评论界面。通过显式路径消费公开内容包，不读取原始 Vault，也不要求复制内容到本目录。

用户在 Vault 配置中选择默认主题及设置，站点项目完全生成到独立输出，删除后应能重建。首版提供配色模式与强调色设置，不实现外部 CSS、布局覆盖或第三方主题接口。具体边界见 [架构](../../docs/architecture.md)。
