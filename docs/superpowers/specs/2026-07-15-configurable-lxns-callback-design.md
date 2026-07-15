# 可配置 LXNS OAuth 回调路径设计

## 目标

允许管理员自定义 LXNS OAuth 回调 URL 的路径部分，并在插件启动时明确给出最终回调地址。

## 兼容性

- 新增 `oauth.callbackPath` 配置项。
- 默认值保持为 `/mai-plugin/lxns/callback`，现有 LXNS 应用和 YAML 配置无需修改。
- `Config` 类型中的该字段为可选字段，直接调用插件 API 的旧代码仍可运行；运行时缺省时使用默认路径。
- 用户可将其设置为 `/lxns/callback`，随后必须在 LXNS 开发者后台填写相同的完整 URL。

## 路径约束

回调路径必须：

- 以 `/` 开头并至少包含一个非空路径段。
- 每个路径段只能包含 ASCII 字母、数字、下划线和连字符。
- 不得包含查询参数、URL 片段、连续斜杠、`.`、`..` 或 `:参数` 路由占位符。

Schema 校验与运行时校验使用同一正则表达式。非法路径必须阻止插件启动或配置保存，不能静默回退到其他路径。

## 组件设计

新增 `src/server/lxns-callback.ts`，负责：

- 导出默认路径和路径正则表达式。
- 将缺省值解析为默认路径，并拒绝非法值。

`src/config.ts` 使用相同常量和正则定义 `oauth.callbackPath`，配置说明明确完整地址为 `<publicBaseUrl 或 Koishi Server selfUrl><callbackPath>`。

`UpdateService` 在生成 LXNS 授权 URL 和交换授权码时使用解析后的路径。`registerMaiServerRoutes` 使用同一路径注册 GET 回调路由。两者不得保留硬编码路径。

默认生命周期注册服务器路由时：

- OAuth 已启用且存在公网基础地址：以 info 日志输出最终完整回调 URL。
- OAuth 已启用但没有 `publicBaseUrl` 或 Server `selfUrl`：以 warning 日志说明无法生成公网回调地址。
- OAuth 未启用：不输出 OAuth 回调日志。

日志只包含公开 URL，不得输出客户端密钥、令牌、授权码或 state。

## 测试

- 单元测试覆盖默认路径、自定义路径和各类非法路径。
- Schema 测试覆盖默认值、中文说明和路径正则。
- OAuth 服务测试验证授权请求与令牌交换使用自定义完整回调 URL。
- 路由测试验证仅自定义路径可处理回调，旧路径在自定义配置下返回 404。
- 生命周期测试验证启用 OAuth 时的 info/warning 日志，不包含敏感配置。
- 运行完整测试与生产构建。

