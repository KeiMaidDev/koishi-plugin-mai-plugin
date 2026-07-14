# koishi-plugin-mai-plugin

[![npm](https://img.shields.io/npm/v/koishi-plugin-mai-plugin?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-mai-plugin)

Koishi 的舞萌 DX 查询、原生 Takumi 图片渲染、猜歌、排卡和成绩更新插件。运行时不依赖 Puppeteer、Playwright、Chromium 或其他浏览器渲染器。

## 运行要求

- Node.js 18 或更高版本。
- Koishi 4.18.7 或兼容版本。
- Koishi `database` 与 `server` 服务。数据库驱动必须支持本插件注册的数据表和 `upsert`。
- 可用的 Koishi HTTP 服务，用于访问水鱼、落雪和资源静态源。
- `@takumi-rs/core` 与 `@takumi-rs/helpers` 的当前平台原生包。
- QQ 原生 Markdown/按钮需要相应 QQ 适配器能力；其他平台和兼容模式会使用普通消息。

安装后，在 Koishi 控制台中启用 `mai-plugin`。需要 OAuth 或水鱼更新时，必须先正确配置 Server `selfUrl` 或本插件的 `publicBaseUrl`。

## 配置

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `developerTokens.divingFish` | 空 | 水鱼开发者 Token。查询水鱼数据时需要。 |
| `developerTokens.lxns` | 空 | 落雪开发者 Token。按服务端要求配置。 |
| `oauth.enabled` | `false` | 是否启用落雪 OAuth 自动授权。 |
| `oauth.clientId` | 空 | 落雪 OAuth Client ID。 |
| `oauth.clientSecret` | 空 | 落雪 OAuth Client Secret。 |
| `oauth.tokenCipherKey` | 空 | OAuth Token 的 AES-256-GCM 本地加密密钥。启用 OAuth 时必须设置稳定、高熵的值。 |
| `resourceSync.enabled` | `true` | 是否同步曲目、封面、头像、姓名框和段位资源。 |
| `resourceSync.intervalMinutes` | `60` | 同步周期，范围 1 到 1440 分钟。 |
| `resourceSync.timeoutMs` | `10000` | 单次资源请求超时，范围 1000 到 120000 毫秒。 |
| `resourceSync.cacheDir` | `data/maimai` | 资源快照、清单和预览音频目录。 |
| `resourceSync.staticBaseUrl` | 空 | `manifest.json` 所在的 HTTP(S) 静态资源根地址；生产环境应使用 HTTPS。 |
| `resourceSync.allowedHosts` | `[]` | 资源同步允许访问的主机白名单。 |
| `render.concurrency` | `4` | Takumi 同时渲染数，范围 1 到 16。 |
| `render.queueLimit` | `64` | 渲染等待队列上限，范围 1 到 1024。 |
| `render.timeoutMs` | `30000` | 单次渲染超时，范围 1000 到 120000 毫秒。 |
| `publicBaseUrl` | 空 | 公网 HTTP(S) 根地址；为空时使用 Koishi Server `selfUrl`。 |
| `administrators` | `[]` | 可执行别名、猜歌和排卡管理操作的用户 ID。 |
| `compatibilityMode` | `false` | 全局使用普通文本/图片回复，禁用 QQ 原生 Markdown 和按钮。 |

`publicBaseUrl` 应是外部用户和第三方服务实际可访问的根地址，例如 `https://bot.example.com`。生产环境应使用 HTTPS，不要包含账号、密码、查询参数或片段。

## 数据目录

`resourceSync.cacheDir` 下包含：

- `manifest.json`：当前原子快照清单。
- `snapshots/<revision>-<uuid>/`：校验完成的版本化资源快照。
- `preview/<resourceId>.ogg`：可选的本地预览音频。
- 临时 `.staging-*` 目录：同步期间使用，失败时清理。

当前版本会保留成功快照。长期运行时应监控磁盘占用，并在确认 `manifest.json` 未引用旧快照后按运维策略清理。

数据库保存 QQ 绑定、查分器设置、别名投票、排卡分组、猜歌状态、落雪 OAuth Token 和水鱼导入 Token。OAuth access/refresh Token 使用 `oauth.tokenCipherKey` 加密；水鱼导入 Token 仍属于数据库敏感数据，应依靠数据库权限、磁盘加密和备份访问控制保护。

## 回调与代理

公网路由如下：

| 路由 | 用途 |
| --- | --- |
| `GET /mai-plugin/lxns/callback` | 落雪 OAuth code 回调。 |
| `GET /mai-plugin/update?token=...` | 发起舞萌授权跳转。 |
| `GET /mai-plugin/proxy-config/:type` | 输出 `sing-box`、`throne`、`nekoray`、`nekobox` 或 `clash` 配置。 |
| `ALL /wc_auth/oauth/callback/maimai-dx` | 接收舞萌授权回调；实际仅允许 GET。 |

落雪控制台的 redirect URI 应设置为：

```text
<publicBaseUrl>/mai-plugin/lxns/callback
```

水鱼更新使用的舞萌回调为：

```text
<publicBaseUrl>/wc_auth/oauth/callback/maimai-dx
```

生成的客户端配置会将 `tgk-wcaime.wahlap.com` 指向 `publicBaseUrl` 对应的 HTTP 代理端点。**本插件不实现通用 HTTP CONNECT 转发代理。** 部署者必须单独提供受控代理，并满足以下要求：

- 只允许转发到舞萌授权所需的固定域名和端口。
- 使用防火墙、VPN、来源白名单或认证限制访问；不得暴露无认证开放代理。
- 保留 Koishi 回调所需的原始 Host，并正确配置受信反向代理。
- 在部署前确认第三方服务条款、所在地法律和网络管理政策允许该流程。

若没有满足这些要求的代理，不要使用 `更新`/`导` 功能或向用户分发代理配置。

## 命令

所有命令均支持 `/mai ...` 形式；兼容触发词仅在精确匹配时接管消息。

| 分类 | 主要触发词 |
| --- | --- |
| 帮助 | `mai` |
| 绑定与设置 | `bind`、`绑定`、`设置查分器`、`设置水鱼`、`设置落雪`、`兼容模式`、`设置头像`、`设置牌子`、`设置mai`、`默认` |
| 曲目 | `id123`、难度 + `id123`、`随个`、`查歌`、`搜索`、定数/拟合定数/谱师/版本/曲师/正则/BPM 查歌 |
| 别名 | `添加别名`、`删除别名` |
| 每日与音频 | `今日舞萌`、`预览` |
| Rating 图片 | `B15`、`B25`、`B35`、`B40`、`B50`、随心配过滤 |
| 成绩与列表 | `info`、`minfo`、难度成绩、`分数列表`、`成绩列表` |
| 等级与段位 | `定数表`、`完成表`、`进度表`、`未完成表`、`段位表`、`<条件>进度` |
| 计算 | `分数线` |
| 猜歌 | `猜歌`、`舞萌开字母`、`开字母`、`开歌`、`不玩了`、启用/禁用猜歌 |
| 排卡 | `排卡管理`、`几`、`机厅别名+人数`、`机厅别名+/-人数` |
| 更新 | `更新`、`导`、`绑定水鱼 <水鱼成绩导入Token>` |

查询自己且未绑定 QQ 时，插件会暂存原命令；绑定完成后自动重放。落雪返回 OAuth 必需错误时，仅自己的查询会启动授权，查询他人不会借用请求者身份授权。

## 安全注意事项

- OAuth state 和更新 token 是 256 位随机、10 分钟过期、单次消费的内存值。插件重启后未完成回调会失效。
- 回调身份只取自服务端 state，不读取 query 中的用户 ID。
- 舞萌回调同时检查原始 Host 和解析后的 Host。仅在明确配置受信代理时启用 Koishi/Koa 的代理信任。
- 使用 HTTPS 公网地址；不要在聊天、日志、工单或截图中暴露 OAuth code/state、更新 token、开发者 Token、水鱼导入 Token、QQ 或 friend code。
- `oauth.tokenCipherKey` 应至少使用 32 字节随机秘密，并保持稳定；更换密钥前应清理或迁移已有 OAuth Token。
- 资源同步只接受 HTTP(S)；生产环境应使用 HTTPS，并显式设置 `resourceSync.allowedHosts` 白名单。清单与文件均校验大小和摘要。
- 舞萌页面响应限制为 5 MiB，每页最多解析 5000 条记录；Cookie 数量和转发总长度也有限制。
- 用户正则最长 128 字符，并在受限 worker/超时内执行。Takumi 只接收内部节点，不渲染用户提供的 HTML/CSS。
- 渲染并发和队列必须按机器内存调低。独立压力脚本使用原生并发 1 和单 worker thread，参考测试机的混合 64 请求峰值 RSS 约 461 MiB；生产默认并发 4 可能更高，实际值也会随平台和素材变化。
- 定期检查 `npm audit` 和 Koishi 安全公告。不要在未评估兼容性的情况下执行强制降级或 `npm audit fix --force`。

## 验收与开发

```text
npm run build
npm test
npm run test:full-flow
npm run test:stress
```

压力测试实际同时提交 16 个 B50、16 个等级表和 64 个混合请求，并输出吞吐、P95、峰值 RSS 和错误数。重型批次只由 `test:stress` 启用并在独立单 worker thread 中运行；常规 `npm test` 会跳过该批次，避免与正在运行的 Koishi 实例争抢内存。

比较两张同尺寸 PNG：

```text
npm run compare:images -- actual.png expected.png --threshold 0.005
npm run compare:images -- actual.png expected.png --region cover:40,120,280,280
```

全图和每个关键区域都必须不高于 0.5% 变化率。平台基线生成与 Linux 基线状态说明见 `tests/render/baselines/README.md`。
