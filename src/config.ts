import Schema from 'schemastery'

export interface Config {
  developerTokens: {
    divingFish: string
    lxns: string
  }
  oauth: {
    enabled: boolean
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
}

const secret = () => Schema.string().role('secret').default('')

export const ConfigSchema: Schema<Config> = Schema.object({
  developerTokens: Schema.object({
    divingFish: secret().description('水鱼查分器开发者令牌，用于查询详细成绩。'),
    lxns: secret().description('落雪咖啡屋开发者令牌，用于访问 LXNS 开发者接口。'),
  }).description('开发者平台令牌'),
  oauth: Schema.object({
    enabled: Schema.boolean().default(false)
      .description('是否启用 LXNS OAuth 用户授权和成绩同步。'),
    clientId: secret().description('LXNS OAuth 客户端 ID。'),
    clientSecret: secret().description('LXNS OAuth 客户端密钥。'),
    tokenCipherKey: secret()
      .description('用于加密持久化 OAuth 令牌的密钥；启用 OAuth 时必须配置。'),
  }).description('LXNS OAuth 设置'),
  resourceSync: Schema.object({
    enabled: Schema.boolean().default(true)
      .description('是否在启动时同步远程乐曲数据和资源。'),
    intervalMinutes: Schema.natural().min(1).max(1_440).default(60)
      .description('资源同步检查间隔，单位为分钟。'),
    timeoutMs: Schema.natural().min(1_000).max(120_000).default(10_000)
      .description('单个资源请求的超时时间，单位为毫秒。'),
    cacheDir: Schema.string().min(1).max(512).default('data/maimai')
      .description('乐曲数据、封面和试听资源的本地缓存目录。'),
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
})

export const Config = ConfigSchema
