# 0015 桌面 CLI 共用事务协议，按本地文件系统验收

2026-11-18 采纳。2026-11-19 完成 Linux 和 macOS 的首批本地卷验收。

用户需要在 Windows、Linux 和 macOS 上用同一份可移植配置生成博客。当前配置、独立内容包及站点指针的提交都经过 `openTransaction`。直接放开操作系统判断，会让新环境承担尚未验证的锁与提交保证。

平台差异集中在事务入口与必要的文件系统操作。CLI、内容选择规则、公开内容包和站点版本协议继续共用。各后端都要实现合作写入者互斥、首次创建禁止覆盖、更新原子替换，以及提交结果未知时的重读恢复。无法确认目标卷满足条件时，写入返回 `TRANSACTION_UNSUPPORTED`。[配置事务协议](../config-transactions.md) · [完整构建提交边界](0012-build-cli-snapshot-handoff.md)

按能力和实际卷记录支持范围。先交付三平台只读基线，再依次验收 Linux 本地 ext4 和 macOS 本地 APFS 的写入与整站流程。Windows 本地固定 NTFS 继续执行原有回归。网络共享、移动端及其它卷类型需要独立的适配证据。POSIX 后端的具体原语及辅助程序分发方式在实现阶段依据目标卷实测确定。[实施计划](../cross-platform-plan.md)

2026-11-19 实现选择：复用 JSON 管道协议，通过系统 Python 3 标准库在独立进程中持有非阻塞 flock。稳定锁文件位于同卷 slots 子目录，以目标原名进行本机查找，因此首次创建和 Unicode 别名也能取得正确的锁。Linux 使用 renameat2 的 NOREPLACE，macOS 使用 renameatx_np 的 EXCL，更新使用相对已打开目录描述符的原子替换。锁随管道 EOF 或进程退出释放。CI 对本地 ext4 及两种 APFS 卷模式运行真实 CLI 和整站用例。
