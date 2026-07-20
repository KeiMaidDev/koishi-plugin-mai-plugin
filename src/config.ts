import Schema from 'schemastery'
import {
  DEFAULT_LXNS_CALLBACK_PATH,
  LXNS_CALLBACK_PATH_PATTERN,
} from './server/lxns-callback'

export interface Config {
  developerTokens: {
    divingFish: string
    lxns: string
  }
  oauth: {
    enabled: boolean
    authorizationUrl: string
    callbackPath?: string
    clientId: string
    clientSecret: string
    tokenCipherKey: string
  }
  resourceSync: {
    enabled: boolean
    intervalMinutes: number
    timeoutMs: number
    cacheDir: string
    staticBaseUrl: string
    allowedHosts: string[]
  }
  render: {
    concurrency: number
    queueLimit: number
    timeoutMs: number
  }
  publicBaseUrl: string
  administrators: string[]
  compatibilityMode: boolean
  debugMode: boolean
}

const secret = () => Schema.string().role('secret').default('')

export const ConfigSchema: Schema<Config> = Schema.object({
  developerTokens: Schema.object({
    divingFish: secret().description('水鱼查分器开发者令牌，用于查询详细成绩。'),
    lxns: secret().description('落雪咖啡屋开发者令牌，用于查询成绩并同步 LXNS 曲目与收藏品数据。'),
  }).description('开发者平台令牌'),
  oauth: Schema.object({
    enabled: Schema.boolean().default(false)
      .description('是否启用 LXNS OAuth 用户授权和成绩同步。'),
    authorizationUrl: Schema.string().default('')
      .description('LXNS 开发者面板生成的完整 OAuth 授权链接，必须包含 response_type、client_id、redirect_uri 和 scope。'),
    callbackPath: Schema.string()
      .pattern(LXNS_CALLBACK_PATH_PATTERN)
      .default(DEFAULT_LXNS_CALLBACK_PATH)
      .description('LXNS OAuth 回调路径。完整地址为“publicBaseUrl 或 Koishi Server selfUrl”加上此路径。'),
    clientId: secret().description('LXNS OAuth 客户端 ID。'),
    clientSecret: secret().description('LXNS OAuth 客户端密钥。'),
    tokenCipherKey: secret()
      .description('用于加密持久化 OAuth 令牌的密钥；启用 OAuth 时必须配置。'),
  }).description('LXNS OAuth 设置'),
  resourceSync: Schema.object({
    enabled: Schema.boolean().default(true)
      .description('是否在启动时同步数据；优先使用 LXNS，失败时切换水鱼，均失败时使用本地快照。'),
    intervalMinutes: Schema.natural().min(1).max(1_440).default(60)
      .description('资源同步检查间隔，单位为分钟。'),
    timeoutMs: Schema.natural().min(1_000).max(120_000).default(10_000)
      .description('单个资源请求的超时时间，单位为毫秒。'),
    cacheDir: Schema.string().min(1).max(512).default('data/maimai')
      .description('曲目快照及按需下载的封面、头像、姓名框和试听音频缓存目录。'),
    staticBaseUrl: Schema.string().default('')
      .description('自定义静态资源服务的基础 URL；留空时使用默认数据源。'),
    allowedHosts: Schema.array(Schema.string()).default([])
      .description('资源同步允许访问的额外主机名白名单，不包含协议和路径。'),
  }).description('乐曲资源同步'),
  render: Schema.object({
    concurrency: Schema.natural().min(1).max(16).default(4)
      .description('同时执行的最大图片渲染任务数。'),
    queueLimit: Schema.natural().min(1).max(1_024).default(64)
      .description('等待渲染的最大任务数，超过后拒绝新任务。'),
    timeoutMs: Schema.natural().min(1_000).max(120_000).default(30_000)
      .description('单个图片渲染任务的超时时间，单位为毫秒。'),
  }).description('图片渲染'),
  publicBaseUrl: Schema.string().default('')
    .description('插件回调路由可从公网访问的基础 URL；留空时使用 Koishi Server 的 selfUrl。'),
  administrators: Schema.array(Schema.string()).default([])
    .description('拥有插件管理权限的 Koishi 用户 ID 列表。'),
  compatibilityMode: Schema.boolean().default(false)
    .description('是否为 QQ 平台强制使用兼容消息，关闭富媒体交互。'),
  debugMode: Schema.boolean().default(false)
    .description('是否输出脱敏调试日志，用于检查数据源、查分器、素材缓存和渲染流程。'),
})

export const Config = ConfigSchema

export const usage = `
**本项目由各种AI工具开发，存在一定的问题，见谅，如有更好的实现欢迎 PR，有好的提议欢迎提ISSUE！**

面向 Koishi 的舞萌 DX 查询插件，移植自[可怜BOT](https://github.com/xszqxszq/KarenBot) 的舞萌查分插件

插件需要以下配置：[水鱼查分器](https://maimai.diving-fish.com/)开发者令牌，[落雪咖啡屋](https://maimai.lxns.net/)开发者令牌以及 OAuth 授权链接、客户端 ID、密钥、令牌加密密钥。

请确保您的koishi处于公网可访问状态，或者配置了反向代理，确保落雪OAuth回调地址可访问。
申请落雪OAuth客户端时，务必勾选所有应用权限范围，否则落雪查分器可能无法正常使用。
`.trim()
