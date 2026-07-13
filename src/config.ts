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
    divingFish: secret(),
    lxns: secret(),
  }),
  oauth: Schema.object({
    enabled: Schema.boolean().default(false),
    clientId: secret(),
    clientSecret: secret(),
    tokenCipherKey: secret(),
  }),
  resourceSync: Schema.object({
    enabled: Schema.boolean().default(true),
    intervalMinutes: Schema.natural().min(1).max(1_440).default(60),
    timeoutMs: Schema.natural().min(1_000).max(120_000).default(10_000),
    cacheDir: Schema.string().min(1).max(512).default('data/maimai'),
    staticBaseUrl: Schema.string().default(''),
    allowedHosts: Schema.array(Schema.string()).default([]),
  }),
  render: Schema.object({
    concurrency: Schema.natural().min(1).max(16).default(4),
    queueLimit: Schema.natural().min(1).max(1_024).default(64),
    timeoutMs: Schema.natural().min(1_000).max(120_000).default(30_000),
  }),
  publicBaseUrl: Schema.string().default(''),
  administrators: Schema.array(Schema.string()).default([]),
  compatibilityMode: Schema.boolean().default(false),
})

export const Config = ConfigSchema
