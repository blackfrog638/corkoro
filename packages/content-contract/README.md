# 内容格式

src/index.ts 已实现严格配置、请求与已支持命令输出的 Zod 运行时校验及推导类型。JSON 解析拒绝重复键、非法 UTF-8、注释和尾逗号；未知字段及不支持版本明确失败。

配置协议见 [发布范围](../../docs/publication.md)，输出见 [结果协议](../../docs/cli-protocol.md)。PlanData 已提供运行时校验和推导类型。文件身份、磁盘边界及引用解析由 publisher 检查，src/bundle.ts 定义公开内容包 v1、manifest、内容树、摘要与引用闭合验证，以及库入口结果；见[内容包协议](../../docs/content-bundle.md)。该模块单独导入，资源内容验证仍由 publisher 的 readContentBundle 负责。当前随根包统一编译，不独立发布。
