# koishi-plugin-mai-plugin

[![npm](https://img.shields.io/npm/v/koishi-plugin-mai-plugin?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-mai-plugin)

> [!NOTE]
> 本项目由各种AI工具开发，存在一定的问题，见谅，如有更好的实现欢迎 PR<br>
> 有好的提议欢迎提ISSUE！

面向 Koishi 的舞萌 DX 查询插件，移植自[可怜BOT](https://github.com/xszqxszq/KarenBot) 的舞萌查分插件

## 功能

- 通过水鱼或落雪查分器查询 B15、B25、B35、B40、B50 和单曲成绩。
- 生成成绩列表、定数表、完成表、进度表、未完成表和段位表。
- 查询曲目、谱面、别名、BPM、谱师、曲师、版本和拟合定数。
- 支持每日推荐、歌曲试听、经典猜歌和舞萌开字母。
- 支持群聊机厅排卡、机厅别名和排卡人数管理。
- 支持落雪 OAuth 绑定及水鱼成绩导入更新。
- QQ 平台支持原生 Markdown 和按钮，其他平台可回退到普通文本与图片。

## 安装

在 Koishi 控制台的插件市场中搜索并安装：

```text
mai-plugin
```

插件包名：

```text
koishi-plugin-mai-plugin
```

安装后启用插件，并确认 Koishi 已启用数据库和 Server 服务。

## 运行要求

- Node.js 18 或更高版本。
- Koishi 4.18.7 或兼容版本。
- Koishi `database` 与 `server` 服务；数据库驱动需要支持插件注册的数据表和 `upsert`。
- 可用的 Koishi HTTP 服务，用于访问水鱼、落雪和静态资源源。
- QQ 原生 Markdown 和按钮使用 [adapter-qq-crack](https://github.com/koishi-shangxue-plugins/koishi-plugin-adapter-qq-crack) 独有语法；不支持时可启用兼容模式。

需要使用落雪 OAuth 或水鱼成绩更新时，请先配置 Koishi Server 的 `selfUrl`，或设置插件的 `publicBaseUrl`。落雪 OAuth 还需要将[开发者面板生成的完整授权链接](https://maimai.lxns.net/docs/oauth-guide)填入 `oauth.authorizationUrl`。


`resourceSync.allowedHosts` 应填写资源同步允许访问的额外主机名，不包含协议和路径。生产环境建议使用 HTTPS，并明确配置主机白名单。

## 查分器绑定

首次查询前，按以下顺序完成设置：

1. 绑定查询使用的 QQ 号：

   ```text
   /mai 绑定 <QQ 号>
   ```

2. 绑定至少一个查分器：

   ```text
   /mai 绑定落雪
   /mai 绑定水鱼 <水鱼成绩导入 Token>
   ```

3. 选择成绩查询使用的查分器：

   ```text
   /mai 设置查分器
   ```

   插件会提供“自动”“水鱼”“落雪”按钮。自动模式会依次尝试当前可用的查分器。

4. 查询成绩：

   ```text
   /mai B50
   ```

落雪绑定会跳转到 OAuth 授权页面。水鱼绑定需要用户自己的成绩导入 Token；插件配置中的水鱼开发者 Token 与用户导入 Token 用途不同。

## 常用命令

所有功能均支持 `/mai ...` 形式。聊天中的兼容触发词只在精确匹配时接管消息。

| 场景 | 命令示例 |
| --- | --- |
| 帮助 | `/mai` |
| QQ 绑定 | `/mai 绑定 <QQ 号>` |
| 查分器选择 | `/mai 设置查分器`、`/mai 设置查分器 自动`、`/mai 设置查分器 水鱼`、`/mai 设置查分器 落雪` |
| 查分器绑定 | `/mai 绑定落雪`、`/mai 解绑落雪`、`/mai 绑定水鱼 <Token>` |
| Rating 图片 | `/mai B15`、`/mai B25`、`/mai B35`、`/mai B40`、`/mai B50` |
| 单曲成绩 | `/mai info <曲目>`、`/mai minfo <曲目>`、`/mai 紫谱成绩 <曲目>` |
| 曲目查询 | `/mai id123`、`/mai 查歌 <关键词>`、`/mai 随个`、`/mai 今日舞萌` |
| 列表与表格 | `/mai 分数列表`、`/mai 定数表`、`/mai 完成表`、`/mai 未完成表`、`/mai 段位表` |
| 进度查询 | `/mai <条件>进度` |
| 分数计算 | `/mai 分数线 <参数>` |
| 图片设置 | `/mai 设置头像 <头像>`、`/mai 设置牌子 <牌子>`、`/mai 设置mai` |
| 猜歌 | `/mai 猜歌`、`/mai 舞萌开字母`、`/mai 启用猜歌`、`/mai 禁用猜歌` |
| 排卡 | `/mai 排卡管理`、`/mai 几`、机厅别名加人数 |
| 成绩更新 | `/mai 更新`、`/mai 导` |
| 平台回退 | `/mai 兼容模式`、`/mai 关闭兼容模式` |

查询自己但尚未绑定 QQ 时，插件会暂存原命令，并在绑定成功后自动继续查询。未绑定查分器或未导入成绩时，QQ 平台会提供对应的绑定按钮。

## 回调与兼容模式

插件注册以下公网路由：

| 路由 | 用途 |
| --- | --- |
| `GET <oauth.callbackPath>` | 接收落雪 OAuth 回调。 |
| `GET /mai-plugin/update?token=...` | 发起舞萌成绩更新授权跳转。 |
| `GET /mai-plugin/proxy-config/:type` | 生成 `sing-box`、`throne`、`nekoray`、`nekobox` 或 `clash` 配置。 |
| `GET /wc_auth/oauth/callback/maimai-dx` | 接收舞萌成绩更新回调。 |

落雪 OAuth 的 redirect URI 为 `publicBaseUrl`（或 Koishi Server `selfUrl`）与 `oauth.callbackPath` 的组合。例如：

```text
https://bot.example.com/mai-plugin/lxns/callback
```

控制台登记的 redirect URI 必须与插件最终生成的地址完全一致。

水鱼成绩更新需要部署者另行提供受控 HTTP 代理。本插件只生成客户端配置和处理回调，不实现通用 HTTP CONNECT 转发代理。不得暴露无认证的开放代理，并应限制目标域名、端口和访问来源。

QQ 平台会在帮助、绑定、分页和可恢复错误中使用原生 Markdown 与按钮。非 QQ 平台、适配器不支持富媒体或启用 `compatibilityMode` 时，插件会继续使用普通文本和图片回复。

OAuth Token、水鱼导入 Token、开发者 Token、QQ 号和 friend code 都属于敏感信息。请勿在日志、聊天记录、工单或截图中公开；`oauth.tokenCipherKey` 更换前应先迁移或清理已有 OAuth Token。

## 项目结构

```text
mai-plugin/
├─ assets/
│  ├─ fallback/          # 缺失远程资源时使用的默认图片
│  ├─ fonts/             # Takumi 渲染使用的字体及授权说明
│  └─ generated/         # 段位、状态和 Rating 等渲染素材
├─ docs/
│  └─ superpowers/       # 设计与实施记录
├─ src/
│  ├─ commands/          # Koishi 命令、快捷触发词和交互引导
│  ├─ data/              # 资源清单、缓存、标准化和同步服务
│  ├─ database/          # 数据表声明与仓储实现
│  ├─ domain/            # 曲目、玩家、Rating 和枚举等领域模型
│  ├─ platform/          # QQ 富媒体、回退消息、权限与命令路由
│  ├─ providers/         # 水鱼、落雪查分器及查询链
│  ├─ query/             # 组合查询解析、过滤规则和执行器
│  ├─ render/            # Takumi 渲染服务、节点和图片模板
│  ├─ server/            # OAuth、成绩更新、代理配置和 HTTP 路由
│  ├─ services/          # 查询、设置、别名、猜歌、排卡和更新业务
│  ├─ utils/             # 字符串与并发控制工具
│  ├─ config.ts          # 插件配置类型与 Schema
│  ├─ constants.ts       # 插件名称、注入服务和生命周期常量
│  ├─ index.ts           # Koishi 插件入口及生命周期装配
│  └─ types.ts           # 生命周期与插件上下文类型
├─ package.json          # npm 与 Koishi 插件元数据
├─ tsconfig.json         # Koishi 工作区 TypeScript 配置
└─ README.md             # 使用与开发文档
```

运行期间的资源快照和试听文件默认写入 `data/maimai`，该路径可通过 `resourceSync.cacheDir` 修改。

## 开发



在 Koishi 根目录执行：

```powershell
yarn clone https://github.com/KeiMaidDev/koishi-plugin-mai-plugin
```

## 许可证

MIT
