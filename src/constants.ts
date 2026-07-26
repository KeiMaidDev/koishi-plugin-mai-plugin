export const PLUGIN_NAME = 'mai-plugin'

export const INJECTED_SERVICES = ['database', 'server'] as const

export const LIFECYCLE_STAGES = [
  'database-models',
  'data-cache',
  'providers',
  'renderer',
  'services',
  'routes',
  'commands',
] as const
