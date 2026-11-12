# 七个本地命令的结果与分支协议

日期：2026-11-12。状态：第一阶段 CLI 已实现（plan 除外），本文同时规定后续完整语义。细化 [CLI 用法](cli.md)，与 [事务协议](config-transactions.md) 一起定义首版的有限范围。build/preview/deploy/status/comments 不在本协议的完备性主张中。

## 参数和共同执行顺序

命令为 inspect、init、content list、content add、content remove、check、plan；参数见 cli.md。首版拒绝未知参数、重复选项、额外位置参数、空参数、非法 format、非布尔旗标值。不自动发现配置，不隐式覆盖或重试。--json 是无值旗标。--help/--version 是元信息请求，不访问输入；与 --json 或业务参数混用返回 INVALID_ARGUMENT；--version 只允许根级使用。

统一阶段：解析参数 → 检查命令是否已实现 → 安全定位输入 → 写命令获取锁 → 读配置/扫描 → 结构与局部校验 → 生成结果或提交 → 输出。前置阶段失败不继续后续阶段，不为了搜集更多错误去读无关文件。plan 尚未实现时在读取配置前返回 UNSUPPORTED_COMMAND。

只读命令不创建锁目录或事务文件。读到完整旧版或新版配置均合法；读取期间检测到变化返回 INPUT_CHANGED，不重试、不声称取得全库原子快照。配置使用严格 UTF-8 JSON（可接受文件开头一个 BOM），拒绝重复键、未知键和不支持版本。结构校验不依赖正文存在；文件身份别名冲突属于路径校验，不妨碍 list/remove。

## 唯一结果封装

下面是协议类型记法；已实现字段的类型和运行时校验位于 packages/content-contract，PlanData 暂为设计。所有字段必填，除非带 ?；null 与空数组不能互换。对象不允许未列出的字段。计数和资源根下标均为非负安全整数，行列为正安全整数。可见错误必须使用同一封装，强杀/断电/输出管道断开不保证产生完整结果。

```typescript
type Command = 'inspect' | 'init' | 'content list' | 'content add'
  | 'content remove' | 'check' | 'plan';
type Effect = 'none' | 'committed' | 'unknown';
type Envelope<T> = {
  schemaVersion: 1;
  command: Command | null; // 未识别命令时 null
  ok: boolean;            // 当且仅当 exitCode === 0
  exitCode: 0 | 1 | 2 | 3 | 4 | 5 | 130;
  effect: Effect;         // 只描述本次配置写入，不描述临时文件或别的进程
  configVersion: string | null;
  data: T | null;
  diagnostics: Diagnostic[];
};
type Diagnostic = {
  code: string; severity: 'error' | 'warning' | 'info'; message: string;
  location: { kind: 'config' | 'source' | 'asset'; path: string;
    assetRoot: number | null; pointer: string | null; line: number | null; column: number | null } | null;
};
```

configVersion 是本次读取/提交的原始配置字节的 SHA-256，格式 sha256: 加 64 位小写十六进制；不是整库版本。inspect 或未读到配置时为 null；写成功时为提交后的版本；effect=unknown 时必须为 null。不能用它授权后续构建。诊断 location 的 config path 是请求的配置路径，source path 相对 source.root，asset path 使用对应资源根下相对路径，assetRoot 为对应 source.assetRoots 下标；非 asset 的 assetRoot 必须为 null。行列从 1 开始，未知则 null；pointer 使用 JSON Pointer 字符串。

除 inspect/check/plan 的明确部分报告外，失败 data=null；已知提交后才发生内部故障可保留完整写入结果。effect=committed 表示本次确实提交了配置；幂等无变化为 none；只读命令永远为 none。客户端只有收到并解析完整封装才可依赖这些字段，无响应则结果未知。

## 各命令 data

Entry、Profile、Friend 的字段和约束直接引用 publication.md（运行时由 content-contract 唯一定义），不另复制业务规则。数组保留清单顺序；扫描结果按源相对路径的 Unicode 码点顺序排序；资产按根下标、相对路径排序。未指定的诊断顺序按 code、location.path、pointer、line、column 排序，null 在前；错误级别优先于 warning/info。

```typescript
type InventoryItem = {
  source: string; kind: 'markdown' | 'asset' | 'other';
  publishHint: boolean | null; // 仅识别布尔 publish 属性，不是授权
  syntax: string[];           // 已识别语法类别；不能暗示支持构建
};
type InspectData = {
  inventory: InventoryItem[];
  complete: boolean;
  skipped: { source: string; reason: 'system' | 'symlink' | 'transaction' }[];
  unexamined: { source: string; code: string }[];
};
type InitData = { configPath: string; outputDirectory: string; changed: true };
type ListData = { entries: Entry[] };
type ChangeData = { entry: Entry; changed: boolean };
type CheckName = 'config' | 'selection' | 'site' | 'theme' | 'paths' | 'references';
type CheckData = {
  selectedCount: number; pageCount: number; hasProfile: boolean; friendCount: number;
  passedChecks: CheckName[]; failedChecks: CheckName[]; unperformedChecks: CheckName[];
  complete: boolean; buildable: boolean | null;
};
type Reason = { code: 'SELECTED_ARTICLE' | 'SELECTED_PAGE' | 'EXPLICIT_PROFILE'
  | 'EXPLICIT_FRIEND' | 'REFERENCED_ASSET'; fromId: string | null; field: string | null };
type Article = { id: string; source: string; slug: string; reason: Reason };
type Page = { id: string; source: string; route: string; reason: Reason };
type Asset = { assetRoot: number; path: string; reasons: Reason[] };
type PlanData = {
  articles: Article[]; pages: Page[];
  profile: { value: Profile; reason: Reason } | null;
  friends: { value: Friend; reason: Reason }[];
  assets: Asset[];
  blockedReferences: { fromId: string; target: string; code: string;
    line: number | null; column: number | null }[];
  changes: null;
  complete: boolean; buildable: boolean | null;
};
```

- inspect：只列成功读取的项目；未授权任何文章。系统目录/链接/事务目录是约定跳过范围，不计为失败。范围内不可读或无法分析的文件进入 unexamined，complete=false，返回非零。syntax 首版词表为 markdown-link、markdown-image、wikilink、embed、other；无法可靠分类的内容只标 other，不声称识别所有语法。
- init：路径输出为本机绝对路径，创建配置及必要父目录，不创建输出目录。失败不回滚删除可能被其他进程使用的父目录，空目录残留不算配置提交。
- list：返回完整配置内文章条目，包括停用项；不扫描正文。读到结构错误返回 data=null。
- add/remove：返回最终目标条目；changed=false 时不得重写或格式化配置，configVersion 保持相同。changed=true 只允许目标条目变化，站点设置保持语义值；JSON 排版无需字节保持。重复 add 必须匹配原 source/slug/显式 ID，冲突不静默更新。
- check：W 有效后才返回 CheckData，否则 data=null。六个检查类别恰好分别出现在三个检查数组中的一个；passed/failed 表示该类别已做完且通过/失败，未做完归 unperformed。complete 当且仅当 unperformedChecks 为空。已知内容错误或完全空使 buildable=false；有内容且无已知错误但未检查完为 null；完整通过才为 true。基础 check 尚不检查 references，因此非空输入只能得到 null 或 false。
- plan：只有完整规划能力已实现才接受请求。W 有效后可以返回部分报告；complete 表示约定的分析范围已走完，不表示通过。完整发现坏链时 complete=true、buildable=false、非零退出；IO/输入变动/取消中止时 complete=false、buildable=false。文章/页面数组表示显式入口，含被坏链阻断的入口，不是可直接部署的内容包。资产只列成功验证的资源。首版 changes 固定 null 并附 BASELINE_NOT_SUPPORTED info，旧构建差异留待定义输出 manifest 后实现，不猜测变化。page.source 转为源根相对路径；资产根下标对应 source.assetRoots。profile/friends 只包含明确可公开字段，不透传整个配置；reason.field 为配置 JSON Pointer，文章/页面资源的 fromId 指向入口 ID。所有数组不含未公开正文。

取消发生在未形成上述部分报告之前时 data=null；有结构有效的部分 CheckData 时 complete=false，buildable=false，剩余检查归 unperformed。无法读取完整配置时不伪造计数为零。

## 守卫的有序分区

每行从左到右，命中首项就停止；“有效”指 W(C)，不代表可构建。所有分支共用参数/能力/安全定位/IO/取消规则，因此没有隐式成功兜底。

| 命令 | 有序分支 |
| --- | --- |
| inspect | 源根缺失→MISSING_SOURCE；不可读→IO_ERROR；范围内项目失败→部分报告及错误；否则完整报告 |
| init | 事务不支持/锁忙→相应错误；配置路径已有任意对象→CONFIG_EXISTS；源/输出非法→错误；候选合法→创建提交 |
| list | 配置缺失→CONFIG_NOT_FOUND；损坏/版本错误→结构错误；有效→列出全部条目 |
| add | 配置缺失/损坏→错误；目标不安全/缺失→错误；现有 source 身份参数不一致或跨文章/页面冲突→ENTRY_CONFLICT；相同且启用→不变；相同且停用→恢复；新 source 与 ID/路由冲突→相应错误；否则追加 |
| remove | 配置缺失/损坏→错误；文章 ID 不存在（包括仅存在于页面）→UNKNOWN_ID；已停用→不变；启用→停用 |
| check | 配置缺失/损坏→错误；已知检查错误→部分/完整错误报告；无错误且必需检查未实现→成功的未完成报告；完整通过→成功报告 |
| plan | 能力未实现→UNSUPPORTED_COMMAND；配置缺失/损坏→错误；分析中止/内容阻断→错误报告；完全空→成功但不可构建；其余完整有效→成功可构建 |

新条目 UUID 自动生成最多尝试 3 次，每次检查与文章/页面全部历史条目冲突，三次均冲突返回 ID_ALLOCATION_FAILED，不修改配置。已有 source 未提供 ID 时保留原 ID，不生成新 ID。新增时可访问的源文件身份别名必须检查；无法确定身份安全性时拒绝本次新增。词法重复 source 在 W 层检查，实际文件别名在 paths 层检查；不要为 list/remove 强制访问全部源文件。

## 诊断与退出码

这是阶段内优先级；前置阶段已经失败时不执行后续阶段。可恢复诊断可汇总；选取退出码按 internal > protocol > IO/事务 > 内容。相同优先级不依赖扫描完成顺序。取消是阶段边界事件，观测到后停止工作，返回 130；若前一错误已决定终止则保持该错误。提交阶段另见事务表。

| 退出码 | 诊断类别及代码 |
| --- | --- |
| 0 | 无 error；EMPTY_SELECTION warning、BASELINE_NOT_SUPPORTED info、CLEANUP_PENDING warning、CANCEL_AFTER_COMMIT warning |
| 1 | INTERNAL_ERROR、ID_ALLOCATION_FAILED |
| 2 | INVALID_ARGUMENT、INVALID_CONFIG、UNSUPPORTED_VERSION、UNSUPPORTED_COMMAND |
| 3 | MISSING_SOURCE、PATH_OUT_OF_SCOPE、UNKNOWN_ID、ENTRY_CONFLICT、DUPLICATE_ID、DUPLICATE_ROUTE、DUPLICATE_SOURCE、UNPUBLISHED_TARGET、UNPUBLISHED_EMBED、UNSUPPORTED_SYNTAX、MISSING_TARGET、AMBIGUOUS_TARGET、UNSUPPORTED_ASSET |
| 4 | CONFIG_NOT_FOUND、CONFIG_EXISTS、CONFIG_BUSY、CONFIG_CHANGED、INPUT_CHANGED、IO_ERROR、TRANSACTION_UNSUPPORTED、UNSAFE_TRANSACTION_STATE |
| 5 | COMMIT_UNKNOWN，仅无法判断本次提交结果时，effect=unknown |
| 130 | CANCELLED，仅已知未提交，effect=none |

结构中已存在重复 ID/路由/source 归 INVALID_CONFIG（细节写 location/message）；命令产生的候选冲突才用 DUPLICATE_*。不存在的普通命令为 INVALID_ARGUMENT，已知但未实现的命令为 UNSUPPORTED_COMMAND。文件不存在与无权限分别报告缺失与 IO；不能把权限错误当作不存在并覆盖。

## 完备性的限定

在已列明的输入类别、阶段事件和环境假设下，每个请求必须选择一个互斥终态；失败、明确拒绝和结果未知也属于定义过的终态。不要求任意请求成功。URI/Markdown 解析器、OS 原子提交和进程锁仍是适配层证明义务；形式化覆盖这些抽象事件不证明适配层实现正确。
