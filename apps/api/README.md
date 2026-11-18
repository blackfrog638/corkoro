# 评论存储

首个迁移位于 migrations/0001_comments.sql。src/comments.ts 提供面向 D1 预处理语句的 submitComment 和 listPublicComments 库入口。每份数据库服务一个博客，articleId 使用发布清单里的稳定 ID。

新评论初始状态为 pending。公开查询使用 public_comments 视图，只读取 approved 记录以及公开字段，按 ID 升序分页。刷新时从第一页重新读取，以包含后来才获批的早期评论。

当前通过 SQLite 在本地验证迁移和库入口。Worker HTTP 路由、文章存在性检查、频率限制、审核授权、管理命令及云端环境仍待实现。
