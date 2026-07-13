import { normalizeSearchText } from '../utils/strings'
import { buildComboRules } from './combo-rules'
import type { ComboFilter, ComboQueryOptions } from './filter-types'

function replaceAllLiteral(value: string, target: string) {
  return value.split(target).join(' ')
}

export function parseComboQuery(
  fullCommand: string,
  options: ComboQueryOptions = {},
): ComboFilter[] | null {
  const ruleSet = buildComboRules(options)
  const filters: ComboFilter[] = []
  const seen = new Set<ComboFilter>()
  let command = normalizeSearchText(fullCommand)

  command = command.replace(ruleSet.achievementPattern, matched => {
    filters.push(ruleSet.achievementFilter(matched))
    return ' '
  })

  const keywords = ruleSet.keywords
    .flatMap(rule => rule.aliases.map(alias => ({
      alias: normalizeSearchText(alias),
      filter: rule.filter,
      order: rule.order,
    })))
    .filter(entry => entry.alias)
    .sort((left, right) => right.alias.length - left.alias.length || left.order - right.order)

  for (const keyword of keywords) {
    if (!command.includes(keyword.alias)) continue
    if (!seen.has(keyword.filter)) {
      filters.push(keyword.filter)
      seen.add(keyword.filter)
    }
    command = replaceAllLiteral(command, keyword.alias)
  }

  if (!filters.length) return null
  if (!filters.some(filter => filter.name === 'utage')) filters.unshift(ruleSet.excludeUtage)
  return filters
}
