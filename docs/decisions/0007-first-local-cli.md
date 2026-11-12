# 第一阶段 CLI 与 Windows 配置事务适配

日期：2026-11-12。状态：已实现并在本机验证；不扩大到其它平台或网站构建。

## 决策

- 根包统一编译 content-contract、publisher、tools/cli；暂不独立发布子包。严格 TypeScript，运行版本 .node-version，精确依赖和 pnpm 锁文件。
- Zod 共享类型和运行时规则；jsonc-parser 只用于严格 JSON 语法/重复键检测，不接受注释；yaml 仅处理 inspect 候选属性，不自动选择文章。
- Windows 本地 NTFS 使用固定 PowerShell/.NET 辅助进程持有稳定空载体的 FileShare.None 互斥；请求通过 JSON 管道传输，不拼接用户脚本。CLI 父进程退出时管道 EOF 使辅助进程退出并释放锁。
- 同卷 File.Move 实现仅当不存在时创建，File.Replace 更新配置；通过固定 C# 方法传递真正的 null 备份参数，避免 PowerShell 将 null 转成空路径。配置文件自身不充当锁载体。
- 更新遇到无法确认的提交故障报告 unknown；只清理当前事务身份匹配的临时文件。不支持的写入平台或卷明确拒绝。
- 基础 check 不检查 references，非空内容不报告 buildable=true。网站、plan、部署和插件仍未实现。

## 实现依据与证据

Microsoft 文档：[FileShare.None](https://learn.microsoft.com/en-us/dotnet/api/system.io.fileshare)、[File.Replace](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.replace)、[File.Move](https://learn.microsoft.com/en-us/dotnet/api/system.io.file.move)。这些 API 文档不是对任意文件系统断电一致性的证明。

本机真实测试覆盖互斥、持有者退出、并发创建、版本冲突、幂等、提交后丢响应重试和路径隔离。测试在临时人工 Vault 中执行；未测试断电、恶意本地进程或网络文件系统。命令与验证见 [runbook](../runbook.md)。
