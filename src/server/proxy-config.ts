export interface ProxyEndpoint {
  server: string
  port: number
}

export interface GeneratedProxyConfig {
  contentType: 'application/json' | 'text/yaml'
  body: string
}

function commonJson(endpoint: ProxyEndpoint, includeClashApi: boolean) {
  return {
    log: { level: 'info', timestamp: true },
    ...(includeClashApi ? {
      experimental: {
        clash_api: {
          external_controller: '127.0.0.1:9090',
          external_ui: 'ui',
          default_mode: 'rule',
          store_selected: false,
        },
      },
    } : {}),
    inbounds: [{
      type: 'mixed',
      tag: 'mixed-in',
      listen: '127.0.0.1',
      listen_port: 2080,
      sniff: true,
      sniff_override_destination: true,
    }],
    outbounds: [
      { type: 'http', tag: 'maimai-proxy', server: endpoint.server, server_port: endpoint.port },
      { type: 'direct', tag: 'direct' },
      { type: 'dns', tag: 'dns-out' },
    ],
    route: {
      rules: [
        { domain_suffix: ['tgk-wcaime.wahlap.com'], outbound: 'maimai-proxy' },
        { protocol: 'dns', outbound: 'dns-out' },
      ],
      final: 'direct',
      auto_detect_interface: true,
    },
  }
}

function nekoBoxJson(endpoint: ProxyEndpoint) {
  return {
    dns: {
      final: 'dns-remote',
      independent_cache: true,
      rules: [
        { domain: [endpoint.server, 'tgk-wcaime.wahlap.com', 'dns.google'], server: 'dns-direct' },
        { outbound: ['any'], server: 'dns-direct' },
      ],
      servers: [
        { address: 'rcode://success', tag: 'dns-block' },
        { address: 'local', detour: 'direct', tag: 'dns-local' },
        { address: 'https://223.5.5.5/dns-query', address_resolver: 'dns-local', detour: 'direct', strategy: 'prefer_ipv4', tag: 'dns-direct' },
        { address: 'https://dns.google/dns-query', address_resolver: 'dns-direct', strategy: 'prefer_ipv4', tag: 'dns-remote' },
      ],
    },
    inbounds: [{
      domain_strategy: '',
      listen: '127.0.0.1',
      listen_port: 2080,
      sniff: true,
      sniff_override_destination: true,
      tag: 'mixed-in',
      type: 'mixed',
    }],
    log: { level: 'info' },
    outbounds: [
      { domain_strategy: 'prefer_ipv4', password: '', server: endpoint.server, server_port: endpoint.port, username: '', tag: 'proxy', type: 'http' },
      { tag: 'direct', type: 'direct' },
    ],
    route: {
      auto_detect_interface: true,
      rule_set: [],
      rules: [
        { action: 'hijack-dns', port: [53] },
        { action: 'hijack-dns', protocol: ['dns'] },
        { action: 'route', domain: ['tgk-wcaime.wahlap.com'], outbound: 'proxy' },
      ],
    },
  }
}

function clashYaml(endpoint: ProxyEndpoint) {
  const proxyName = '舞萌DX成绩更新代理'
  return [
    'port: 7890',
    'socks-port: 7891',
    'mode: rule',
    'proxies:',
    `  - name: ${JSON.stringify(proxyName)}`,
    `    server: ${JSON.stringify(endpoint.server)}`,
    `    port: ${endpoint.port}`,
    '    type: http',
    'proxy-groups:',
    '  - name: default',
    '    type: select',
    '    proxies:',
    `      - ${JSON.stringify(proxyName)}`,
    'rules:',
    '  - DOMAIN-SUFFIX,tgk-wcaime.wahlap.com,default',
    '  - MATCH,DIRECT',
  ].join('\n')
}

function validEndpoint(endpoint: ProxyEndpoint) {
  return endpoint.server.length > 0
    && endpoint.server.length <= 253
    && Number.isInteger(endpoint.port)
    && endpoint.port >= 1
    && endpoint.port <= 65_535
}

export function createProxyConfig(type: string, endpoint: ProxyEndpoint): GeneratedProxyConfig | null {
  if (!validEndpoint(endpoint)) return null
  if (type === 'clash') return { contentType: 'text/yaml', body: clashYaml(endpoint) }
  const data = type === 'sing-box'
    ? commonJson(endpoint, false)
    : type === 'throne' || type === 'nekoray'
      ? commonJson(endpoint, true)
      : type === 'nekobox'
        ? nekoBoxJson(endpoint)
        : null
  return data ? { contentType: 'application/json', body: JSON.stringify(data) } : null
}
