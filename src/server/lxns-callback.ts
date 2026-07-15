export const DEFAULT_LXNS_CALLBACK_PATH = '/mai-plugin/lxns/callback'
export const LXNS_CALLBACK_PATH_PATTERN = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u

export function resolveLxnsCallbackPath(value?: string) {
  const path = value === undefined ? DEFAULT_LXNS_CALLBACK_PATH : value
  if (!LXNS_CALLBACK_PATH_PATTERN.test(path)) {
    throw new Error(`Invalid LXNS OAuth callback path: ${path}`)
  }
  return path
}
