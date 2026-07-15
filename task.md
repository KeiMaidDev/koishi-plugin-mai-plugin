# mai-plugin 规范化整改任务

## 已确认执行决策

- 按 Task 1 -> Task 2 -> Task 3 -> Task 4 的顺序实施，每个 Task 先补失败测试，再完成最小实现、定向验证和独立提交。
- Task 5 只执行完整验收并在最终报告中记录结果，不为验收创建空提交。
- 本文件作为本轮整改的正式设计、实施边界与验收规格；不额外保留 `.superpowers/` 或 `docs/superpowers/` 过程文档。

## 目标

将 koishi-plugin-mai-plugin 整改为符合 Koishi 工作区规范、可由根工作区 Yarn/Yakumo 干净构建并正常加载的插件，同时完成以下用户功能：

1. QQ 可操作引导必须使用 qq:rawmarkdown 正文下挂原生按钮。
2. 恢复显式的落雪查分器 OAuth 绑定与解绑入口。
3. 修复“Koishi yarn build 构建后产物不可运行”的问题。
4. 清理过程文件、重复构建链和不应存在于插件仓库中的目录。

## 官方依据

- QQ 消息按钮：https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/msg-btn.html
- Koishi 工作区开发：https://koishi.chat/zh-CN/guide/develop/workspace.html
- Koishi 发布插件：https://koishi.chat/zh-CN/guide/develop/publish.html
- 本机 Koishi 官方脚手架：C:\koishi-app\node_modules\@koishijs\scripts\template
- 本机 Koishi 构建管线：C:\koishi-app\yakumo.yml，顺序为 tsc -> esbuild -> client

## 已确认基线

- 当前 QQ 平台层已经能创建 qq:rawmarkdown，但未绑定、OAuth 和部分帮助提示仍使用纯文本链接或 qq:rawmarkdown-without-keyboard。
- 当前按钮类型缺少官方字段 visited_label、reply、unsupport_tips、指定用户列表和 URL 跳转动作。
- 当前只有查询触发的被动 LXNS OAuth，没有明确的 /mai 绑定落雪 命令。
- 当前包混用 Yarn 4 工作区、package-lock.json、npm 构建脚本、Vite 自定义构建、lib 声明和 dist JavaScript 双产物。
- yarn build mai-plugin 在已有缓存产物时可以退出成功，因此必须从删除构建产物后的干净状态验证，不能只检查退出码。
- 当前仓库包含 .superpowers/、docs/superpowers/ 等过程文件；src/、tests/、scripts/ 和运行时 assets/ 属于必要目录，禁止误删。

## 全局约束

- 本轮只执行本文件列出的整改，不重写查询、渲染、猜歌、排卡或成绩算法。
- 实施采用测试先行：先观察目标测试失败，再写最小实现使其通过。
- 若使用子智能体，只允许 5.6 模型；无法保证模型版本时不得派发子智能体。
- QQ 的可操作引导必须是非空 raw markdown 正文加 keyboard；禁止只发送 keyboard。
- 非 QQ 平台和用户主动启用的兼容模式必须保留纯文本或普通图片回退。
- 不得记录或回显 OAuth code、state、access token、refresh token、Client Secret、导入 Token 或密钥。
- OAuth 跳转按钮只允许 https:// URL；命令按钮只允许插件定义的固定命令，不拼接未校验的用户输入。
- 不得删除运行时字体、生成素材、回退素材、测试夹具、渲染基线或资源生成脚本。
- 不得把 node_modules、lib、dist、tsconfig.tsbuildinfo 提交到 Git。
- 正式构建入口固定为在 C:\koishi-app 执行 yarn build mai-plugin。

---

## Task 1：按 QQ 官方协议重建 Raw Markdown 按钮层

### 涉及文件

- 修改：src/platform/qq-message.ts
- 修改：src/commands/support.ts
- 修改：src/platform/fallback-message.ts
- 修改：使用帮助、分页、绑定或错误恢复按钮的命令模块
- 测试：tests/unit/qq-message.spec.ts
- 测试：tests/integration/commands-core.spec.ts
- 测试：tests/integration/guess.spec.ts

### 数据结构要求

- 将按钮动作建模为可区分联合类型：
  - action.type = 0：HTTPS 跳转按钮。
  - action.type = 1：回调按钮。
  - action.type = 2：指令按钮。
- 每个按钮必须包含：
  - 在同一 keyboard 中唯一的 id。
  - render_data.label。
  - render_data.visited_label。
  - render_data.style，仅允许 0 或 1。
  - action.permission.type。
  - action.data。
  - action.unsupport_tips。
- 指令按钮根据场景显式设置 action.reply 与 action.enter，不得依赖适配器默认值。
- 个人绑定、OAuth 和个人数据操作使用 permission.type = 0，并设置当前用户 ID；通用帮助和公开分页可使用 permission.type = 2。
- 单个 keyboard 最多 5 行，每行最多 5 个按钮；构造函数超限时必须抛出明确错误。
- raw markdown 正文必须为非空字符串；禁止在引导场景降级为 qq:rawmarkdown-without-keyboard。

### 必须使用 raw markdown 下挂按钮的场景

- /mai 和帮助页：常用查询、绑定、设置查分器、猜歌、排卡入口。
- 自己未绑定 QQ：下挂“绑定 QQ”指令按钮；命令需要用户补充 QQ 号时不得自动发送不完整命令。
- 查分器未绑定或未授权：下挂“绑定落雪”和“绑定水鱼”按钮。
- LXNS OAuth：下挂“前往落雪授权”HTTPS 跳转按钮。
- 可恢复错误：下挂“重试”或返回帮助按钮。
- 搜索、成绩列表和帮助分页：继续使用 raw markdown 下挂上一页/下一页回调按钮。

### 测试清单

- [ ] 先写失败测试，证明上述引导当前仍产生纯文本链接或无 keyboard 的 raw markdown。
- [ ] 验证按钮 JSON 字段与 QQ 官方文档完全一致。
- [ ] 验证 raw markdown 正文非空、keyboard 不超过 5x5、按钮 ID 唯一。
- [ ] 验证 HTTPS 跳转按钮拒绝 http:、javascript:、data: 和协议相对 URL。
- [ ] 验证个人按钮的 specify_user_ids 只包含发起用户。
- [ ] 验证非 QQ 与兼容模式仍返回可读文本，不包含 QQ 专用元素。
- [ ] 静态检查上述引导路径不得创建 qq:markdown 或 qq:rawmarkdown-without-keyboard。

### 完成标准

- QQ 用户看到的所有可操作引导均为 qq:rawmarkdown 正文下挂按钮。
- 真实 interaction/button 测试可以完成分页和固定指令操作。
- 不支持按钮的客户端能看到 unsupport_tips，且仍可手动执行正文中的命令。

---

## Task 2：恢复显式落雪查分器绑定与解绑

### 涉及文件

- 修改：src/commands/update.ts
- 修改：src/commands/core.ts
- 修改：src/commands/support.ts
- 修改：src/services/update-service.ts
- 修改：src/database/repositories.ts
- 修改：src/platform/fallback-message.ts
- 测试：tests/integration/server-routes.spec.ts
- 测试：tests/integration/commands-core.spec.ts
- 测试：tests/integration/full-flow.spec.ts

### 命令契约

- 新增主命令：mai.bind-lxns。
- 支持触发词：
  - /mai 绑定落雪
  - /mai bind-lxns
  - 绑定落雪
- 新增解绑命令：
  - /mai 解绑落雪
  - /mai unbind-lxns
  - 解绑落雪
- “设置查分器为落雪”只修改查分器偏好，不得冒充绑定成功。

### OAuth 绑定流程

1. 检查 oauth.enabled、Client ID、Client Secret、tokenCipherKey 和公网回调地址。
2. 为当前用户创建 256 位、单次使用、限时有效的 state。
3. 返回非空 qq:rawmarkdown，下挂“前往落雪授权”HTTPS 按钮。
4. 按钮只允许发起用户操作，正文同时提供无法使用按钮时的手动说明。
5. 回调必须校验 state，再使用 code 换取 token；不得从 query 参数读取用户身份。
6. token 加密保存后发送绑定成功消息；若存在待执行命令则只重放一次。
7. 显式重复绑定允许覆盖旧 token，但必须重新走 OAuth，不得直接报告成功。
8. 解绑删除当前用户的 LXNS OAuth token 和未完成 state，不影响 QQ 绑定、水鱼 Token 或其他用户。

### 失败处理

- 未配置 OAuth：raw markdown 下挂返回帮助/配置说明按钮，不生成无效授权 URL。
- state 过期、重复消费、code 交换失败：给出可重试的 raw markdown 按钮。
- 查询他人时遇到 OAuth 必需错误：不得使用请求者 OAuth 身份替代目标用户。
- 日志、回复、异常和测试快照不得包含 code、state 或 token 原值。

### 测试清单

- [ ] 先写失败测试，证明 /mai 绑定落雪 当前没有独立命令。
- [ ] 验证命令返回 qq:rawmarkdown 和用户专属 HTTPS 跳转按钮。
- [ ] 验证授权 URL 使用配置后的 oauth.callbackPath。
- [ ] 验证回调成功后加密保存 token，并只重放一次待执行命令。
- [ ] 验证重复回调、过期 state、错误 code 和插件重启后的失效行为。
- [ ] 验证解绑幂等，解绑后再次查询会重新引导 OAuth。
- [ ] 验证非 QQ 平台返回同一授权 URL 的文本回退。

### 完成标准

- 用户无需先触发成绩查询即可主动绑定落雪。
- 绑定、重新绑定、解绑和失败重试均有明确按钮引导。
- OAuth 安全边界保持现有强度，不新增明文凭据存储。

---

## Task 3：迁移到 Koishi Yarn/Yakumo 标准构建

### 涉及文件

- 修改：package.json
- 修改：tsconfig.json
- 修改：src/render/assets.ts
- 删除：vite.config.ts
- 删除：package-lock.json
- 修改：.gitignore
- 修改：tests/integration/package.spec.ts

### package.json 目标

- main 使用 lib/index.js。
- typings 使用 lib/index.d.ts。
- 移除 type: module、自定义 Vite exports 和重复的 dist/index.js 服务端入口。
- 不得重新引入导致 Koishi Registry 无法读取 package.json 的 exports 限制；若保留 exports，必须显式导出 ./package.json 并覆盖 CJS/ESM 加载测试。
- files 只包含运行所需的 lib 与必要 assets；没有控制台客户端时不发布空 dist。
- 移除 build、build:types、build:js 和 Vite prepack 脚本，正式构建交给根工作区 Yakumo。
- 保留必要的测试、压力测试和资源生成脚本，并统一使用 Yarn 调用。
- 移除不再直接使用的 vite 依赖；保留 Vitest或脚本确实需要的依赖。
- 补齐非空 description、homepage、repository、bugs 和 koishi 元数据。

### 运行时资源路径

- 审计 src/render/assets.ts 中的 import.meta.url。Koishi 标准服务端产物若为 CommonJS，不得在构建后留下不可用的 import.meta。
- 资源根目录必须相对最终 lib/index.js 或已解析的包根目录计算，不能相对 src/render/ 的开发目录计算。
- Windows、Linux glibc 和 Linux musl 产物都必须能找到 assets/fonts、assets/generated 与 assets/fallback。
- 测试必须真正调用字体注册和一次最小渲染，不能只断言路径字符串。

### tsconfig.json 目标

使用 Koishi 官方工作区结构：

~~~json
{
  "extends": "../../tsconfig.base",
  "compilerOptions": {
    "outDir": "lib",
    "rootDir": "src"
  },
  "include": ["src"]
}
~~~

仅当现有源码确实需要额外类型时添加最小覆盖，不复制根 tsconfig.base.json 的整套配置。

### 干净构建测试

- [ ] 在删除前解析并打印绝对路径，确认目标都位于 C:\koishi-app\external\mai-plugin 内。
- [ ] 删除本地生成的 lib/、dist/ 和 tsconfig.tsbuildinfo。
- [ ] 在 C:\koishi-app 执行 yarn clean mai-plugin。
- [ ] 在 C:\koishi-app 执行 yarn build mai-plugin。
- [ ] 断言生成 lib/index.js 与 lib/index.d.ts，且不依赖构建前残留文件。
- [ ] 从 C:\koishi-app 使用 Node 加载 koishi-plugin-mai-plugin，检查 apply、Config、name 导出。
- [ ] 使用 Koishi Registry 的同等解析路径验证 koishi-plugin-mai-plugin/package.json 可读取。
- [ ] 从打包产物安装到临时目录，验证字体与运行时 assets 均存在。
- [ ] 以最小 Koishi Context 执行插件初始化和释放，确认不是“构建成功但运行失败”。

### 完成标准

- 根目录 yarn build mai-plugin 在无历史产物时成功。
- 生成物由 Yakumo 管线唯一负责，不再同时维护 npm/Vite 双构建。
- 构建后的插件能被当前 Koishi 配置扫描、加载并正常释放。

---

## Task 4：清理目录、发布内容和文档

### 必须删除

- .superpowers/
- docs/superpowers/
- 插件内 node_modules/
- 本地生成的 lib/
- 本地生成的 dist/
- tsconfig.tsbuildinfo
- package-lock.json
- 已确认不再使用的 vite.config.ts

其中 node_modules/lib/dist/tsconfig.tsbuildinfo 是本地生成内容，只清理工作区，不加入 Git 删除记录；其余已跟踪过程文件应从版本库移除。

### 必须保留

- src/：插件源码。
- tests/：单元、集成、渲染与打包回归测试。
- assets/fonts/：运行时字体及许可证。
- assets/generated/：运行时渲染素材。
- assets/fallback/：资源缺失回退素材。
- scripts/：仍被 package scripts 或维护流程引用的资源/基线脚本。
- task.md：本次整改任务与验收记录。

### 审计要求

- [ ] 对每个准备删除的目录列出“来源、是否跟踪、是否发布、是否运行时读取”。
- [ ] 使用 rg 检查待删脚本或资源没有源码引用。
- [ ] 使用 npm pack --dry-run 或 Yarn 对等流程检查最终发布文件白名单。
- [ ] 发布包不得包含测试、计划文档、构建缓存、源映射、日志或本地数据库。
- [ ] .gitignore 同时覆盖 lib、dist、node_modules、tsbuildinfo、日志和编辑器缓存。
- [ ] 不得删除 C:\koishi-app\external\mai-plugin-worktrees 等项目外路径；若需清理，必须作为独立操作确认其归属。

### README 更新

- 使用 UTF-8 中文重写或修正乱码。
- 说明 QQ raw markdown 按钮能力与非 QQ 回退。
- 记录 /mai 绑定落雪、/mai 解绑落雪 和 OAuth 配置。
- 根据 oauth.callbackPath 给出最终回调地址计算示例。
- 构建说明只使用：

~~~powershell
cd C:\koishi-app
yarn build mai-plugin
~~~

- 删除 npm/Vite 双构建和过时固定回调路径说明。

### 完成标准

- 仓库根目录只保留插件源码、必要资源、测试、维护脚本和标准元数据。
- Git 工作区没有已跟踪的构建产物或过程报告。
- 发布包内容可解释、最小且足以运行。

---

## Task 5：完整回归、真实交互与交付验收

### 自动化测试

- [ ] tests/unit/qq-message.spec.ts：官方按钮字段、5x5 限制、URL 白名单、用户权限。
- [ ] tests/integration/commands-core.spec.ts：帮助、未绑定和错误恢复均为 raw markdown 下挂按钮。
- [ ] tests/integration/server-routes.spec.ts：显式落雪绑定、回调、重试和解绑。
- [ ] tests/integration/full-flow.spec.ts：从命令按钮到 OAuth 回调再到待执行命令重放。
- [ ] tests/integration/package.spec.ts：干净 Yakumo 产物、manifest、assets 和生产导入。
- [ ] 保持全部现有查询、数据库、渲染、猜歌、排卡和安全测试通过。

### QQ 消息结构验收

对每个引导场景捕获最终发送元素并断言：

~~~text
type = qq:rawmarkdown
markdown.content = 非空
keyboard.content.rows = 1..5
row.buttons = 1..5
~~~

还必须断言：

- 绑定按钮仅当前用户可点击。
- OAuth URL 按钮为 action.type = 0 且目标为 HTTPS。
- 固定命令按钮为 action.type = 2。
- 分页按钮为 action.type = 1，回调 token 有范围、时效和单次消费限制。
- 任意回复和日志不包含 OAuth 敏感值。

### 构建与运行验收

从干净状态按顺序执行：

~~~powershell
cd C:\koishi-app
yarn install --immutable
yarn clean mai-plugin
yarn build mai-plugin
yarn workspace koishi-plugin-mai-plugin test --pool=threads --maxWorkers=1 --reporter=dot
~~~

随后执行：

- Node 生产入口导入检查。
- Koishi PackageScanner manifest 解析检查。
- 最小 Context 初始化/释放检查。
- 临时打包安装检查。
- QQ mock 的真实按钮点击与 OAuth 完整流程检查。

在无分页文件的 8 GB Windows 环境中，测试命令应限制 worker 和 Node 堆预留，避免多个子进程各自预留大堆造成假性 OOM；不得通过跳过测试来规避。

### 人工验收

- [ ] QQ 单聊点击“绑定落雪”后可以直接打开 LXNS 授权页。
- [ ] QQ 群聊按钮不会允许其他用户代替发起者绑定。
- [ ] 授权成功后原查询最多重放一次。
- [ ] 解绑后再次查询会重新显示 raw markdown 授权按钮。
- [ ] 不支持按钮或非 QQ 平台仍能按正文提示完成操作。
- [ ] 删除所有构建产物后，Koishi 根工作区仍可一次构建并加载插件。

## 最终交付

- 每个 Task 独立提交，提交中不得混入无关文件。
- 最终报告列出：修改文件、删除目录、raw markdown 覆盖场景、绑定命令、构建命令、测试数量、跳过项和残余风险。
- git status --short 只能保留用户明确要求不提交的文件；不得遗留构建缓存或临时目录。
