# 评论存储

首个迁移位于 migrations/0001_comments.sql。src/comments.ts 提供面向 D1 预处理语句的 submitComment 和 listPublicComments 库入口。每份数据库服务一个博客，articleId 使用发布清单里的稳定 ID。

新评论初始状态为 pending。公开查询使用 public_comments 视图，只读取 approved 记录以及公开字段，按 ID 升序分页。刷新时从第一页重新读取，以包含后来才获批的早期评论。

公开 Worker 入口为 src/worker.ts。GET /comments 接受 articleId、可选 after 和 limit；POST /comments 接受契约定义的 JSON，提交成功返回 202。两条路由均要求稳定 ID 存在于 COMMENT_ARTICLES 数组。部署方需根据上线文章维护此列表，撤回时同步更新。DB 为 D1 绑定；COMMENT_LIMITER 为限流绑定，使用 Cloudflare 边缘提供的 CF-Connecting-IP 作为键。提交请求体上限 32 KiB。仅在受信任的 Cloudflare 入口接收该头。独立审核入口见 src/admin.ts 和运行手册。管理 CLI 已支持三种审核操作。Cloudflare 预览配置和实测结果见运行手册。跨域前端接入待实现。
