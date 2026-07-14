export interface AuthoritySubject {
  userId: string
  authority?: number
  roles?: readonly string[]
}

export interface AdministratorPolicy {
  administrators?: readonly string[]
  minimumAuthority?: number
  administratorRoles?: readonly string[]
}

const defaultRoles = ['owner', 'admin', 'administrator', 'group-owner', 'group-admin']

export function hasAuthority(subject: AuthoritySubject, minimumAuthority: number) {
  return typeof subject.authority === 'number'
    && Number.isFinite(subject.authority)
    && subject.authority >= minimumAuthority
}

export function isAdministrator(
  subject: AuthoritySubject,
  policy: AdministratorPolicy = {},
) {
  if (policy.administrators?.includes(subject.userId)) return true
  if (hasAuthority(subject, policy.minimumAuthority ?? 4)) return true
  const acceptedRoles = new Set((policy.administratorRoles ?? defaultRoles).map(role => role.toLowerCase()))
  return subject.roles?.some(role => acceptedRoles.has(role.toLowerCase())) ?? false
}

export function canManageSettings(
  subject: AuthoritySubject,
  targetUserId: string,
  policy: AdministratorPolicy = {},
) {
  return subject.userId === targetUserId || isAdministrator(subject, policy)
}

export const isAdmin = isAdministrator
