import { DeluxeScore, Rating } from '../domain/rating'
import {
  ComboStatus,
  MusicDifficulty,
  MusicGenre,
  MusicType,
  Rate,
  type RateName,
  SyncStatus,
} from '../domain/enums'
import type { GameVersion, RecordEntry } from '../domain/music'
import { normalizeSearchText, toSimplified } from '../utils/strings'
import {
  createFilter,
  FilterType,
  type ComboDesignerConfig,
  type ComboFilter,
  type ComboQueryOptions,
  type KeywordRule,
} from './filter-types'

export interface ComboRuleSet {
  keywords: KeywordRule[]
  achievementPattern: RegExp
  achievementFilter: (matched: string) => ComboFilter
  excludeUtage: ComboFilter
}

function rateFilter(id: string, rate: RateName, exact = false) {
  return createFilter(id, FilterType.Achievement, {
    record: exact
      ? record => record.rate === rate
      : record => Rate.greaterEqual(record.achievement, rate),
  })
}

function versionFilter(id: string, versions: Iterable<GameVersion>) {
  const accepted = new Set([...versions].map(version => version.version))
  return createFilter(id, FilterType.Version, {
    chart: chart => accepted.has(chart.music.version.version),
  })
}

function simplifyPlateName(name: string) {
  return toSimplified(name)
    .replaceAll('極', '极')
    .replaceAll('覇者', '霸者')
}

function plateSuffix(name: string) {
  const normalized = simplifyPlateName(name)
  return ['舞舞', '极', '将', '神'].find(suffix => normalized.endsWith(suffix))
}

function plateFilter(name: string, requires: number[], remasters: number[]) {
  const suffix = plateSuffix(name)
  const normalized = simplifyPlateName(name)
  return createFilter(`plate:${normalized}`, FilterType.Plate, {
    name: `plate_${name}`,
    chart: chart => chart.difficulty === MusicDifficulty.ReMaster
      ? remasters.includes(chart.music.id)
      : requires.includes(chart.music.id),
    record: record => {
      if (suffix === '极') return record.comboStatus.isFC()
      if (suffix === '将') return Rate.greaterEqual(record.achievement, 'sss')
      if (suffix === '神') return record.comboStatus.isAP()
      if (suffix === '舞舞') return record.syncStatus.isFSD()
      if (normalized === '霸者') return record.achievement >= 800_000
      return false
    },
  })
}

function fittedSort(record: RecordEntry) {
  return -Rating.calc(record.chart.fitLevelValue, record.achievement)
}

const emptyDesignerConfig: ComboDesignerConfig = {
  aliases: {},
  includes: {},
  collabs: {},
}

export function createDesignerFilter(requestedName: string, config: ComboDesignerConfig) {
  const normalized = normalizeSearchText(requestedName)
  const aliasEntry = Object.entries(config.aliases).find(([mainName, aliases]) => (
    normalizeSearchText(mainName) === normalized
    || aliases.some(alias => normalizeSearchText(alias) === normalized)
  ))
  const mainName = aliasEntry?.[0] ?? requestedName
  const normalizedMainName = normalizeSearchText(mainName)
  const includes = Object.entries(config.includes).find(([name]) => (
    normalizeSearchText(name) === normalizedMainName
  ))?.[1] ?? []
  const searchKeywords = [...new Set([...includes, mainName].map(normalizeSearchText))]
  const collaborationRows = Object.entries(config.collabs).find(([name]) => {
    const normalizedName = normalizeSearchText(name)
    return normalizedName === normalizedMainName || normalizedName === normalized
  })?.[1] ?? []
  const collaborations = collaborationRows.map((raw) => {
    const [musicId, difficulty, extra] = raw.split('#')
    if (extra || !/^\d+$/.test(musicId) || !/^\d+$/.test(difficulty)) {
      throw new TypeError(`Invalid designer collaboration chart: ${JSON.stringify(raw)}`)
    }
    return {
      musicId: Number(musicId),
      difficulty: MusicDifficulty.of(Number(difficulty)),
    }
  })

  return createFilter(`designer:${normalized}`, FilterType.Designer, {
    chart: chart => searchKeywords.some(keyword => (
      normalizeSearchText(chart.notesDesigner).includes(keyword)
    )) || collaborations.some(collaboration => (
      chart.music.id === collaboration.musicId
      && chart.difficulty === collaboration.difficulty
    )),
    singleChart: true,
  })
}

export function buildComboRules(options: ComboQueryOptions = {}): ComboRuleSet {
  const entries: KeywordRule[] = []
  let order = 0
  const add = (aliases: string[], filter: ComboFilter, atStart = false) => {
    const rule = { aliases, filter, order: order++ }
    if (atStart) entries.unshift(rule)
    else entries.push(rule)
  }

  add(['极', '全连', 'fc'], createFilter('combo:fc', FilterType.Combo, {
    name: 'fc',
    record: record => record.comboStatus.isFC(),
  }))
  add(['理论', 'ap+', 'app'], createFilter('combo:app', FilterType.Combo, {
    name: 'app',
    record: record => record.comboStatus === ComboStatus.AllPerfectPlus,
  }))
  add(['神', 'ap'], createFilter('combo:ap', FilterType.Combo, {
    name: 'ap',
    record: record => record.comboStatus.isAP(),
  }))
  add(['fdx+', 'fsd+', 'fdxp', 'fsdp'], createFilter('sync:fsdp', FilterType.Sync, {
    name: 'fsdp',
    record: record => record.syncStatus === SyncStatus.FullSyncDeluxePlus,
  }))
  add(['舞舞', 'fdx', 'fsd'], createFilter('sync:fsd', FilterType.Sync, {
    name: 'fsd',
    record: record => record.syncStatus.isFSD(),
  }))

  add(['寸'], createFilter('achievement:close-below', FilterType.Achievement, {
    record: record => {
      const decimal = record.achievement % 10_000
      return record.achievement >= 994_250
        && record.achievement <= 1_004_999
        && ((decimal >= 4_250 && decimal <= 4_999) || (decimal >= 9_250 && decimal <= 9_999))
    },
    sortBy: record => {
      let target = Math.round(record.achievement / 10_000) * 10_000
      if (target < record.achievement) target += 5_000
      return target - record.achievement
    },
  }))
  add(['锁血', '锁', '名刀', '血压'], createFilter('achievement:close-above', FilterType.Achievement, {
    record: record => {
      const decimal = record.achievement % 10_000
      return record.achievement >= 1_000_000
        && record.achievement <= 1_005_250
        && ((decimal >= 5_000 && decimal <= 5_250) || (decimal >= 0 && decimal <= 1_250))
    },
    sortBy: record => {
      let target = Math.round(record.achievement / 10_000) * 10_000
      if (target > record.achievement) target -= 5_000
      return record.achievement - target
    },
  }))

  add(['大将', '鸟加', 'sss+', 'sssp'], rateFilter('rate:ge:sssp', 'sssp'))
  add(['将'], rateFilter('rate:ge:sss', 'sss'))
  add(['纯鸟', '纯sss', '仅鸟', '仅sss'], rateFilter('rate:eq:sss', 'sss', true))
  add(['鸟', 'sss'], rateFilter('rate:ge:sss:bird', 'sss'))
  add(['霸', 'clear'], rateFilter('rate:ge:a', 'a'))
  add(['牛逼', 'nb'], createFilter('achievement:100.8', FilterType.Achievement, {
    record: record => record.achievement >= 1_008_000,
  }))
  add(['丢人', '招笑', '越级', '越'], createFilter('achievement:under-95', FilterType.Achievement, {
    record: record => record.achievement < 950_000,
  }))

  add(['纯ss+', '仅ss+'], rateFilter('rate:eq:ssp', 'ssp', true))
  add(['纯ss', '仅ss'], rateFilter('rate:eq:ss', 'ss', true))
  add(['纯s+', '仅s+'], rateFilter('rate:eq:sp', 'sp', true))
  add(['纯s', '仅s'], rateFilter('rate:eq:s', 's', true))
  add(['纯aaa', '仅aaa'], rateFilter('rate:eq:aaa', 'aaa', true))
  add(['ss+', 'ssp'], rateFilter('rate:ge:ssp', 'ssp'))
  add(['ss'], rateFilter('rate:ge:ss', 'ss'))
  add(['s+', 'sp'], rateFilter('rate:ge:sp', 'sp'))
  add(['s'], rateFilter('rate:ge:s', 's'))
  add(['aaa'], rateFilter('rate:ge:aaa', 'aaa'))

  add(['完整', '全'], createFilter('limit:all', FilterType.Limit, { disable15: true }))
  add(['拟合定数', '拟合', 'nh'], createFilter('modification:fit-level', FilterType.Modification, {
    fitLevelValue: true,
    sortBy: fittedSort,
  }))
  add(['理想'], createFilter('modification:ideal', FilterType.Modification, {
    modifier: record => {
      if (record.rate === 'sssp') {
        record.achievement = 1_010_000
        record.comboStatus = ComboStatus.AllPerfectPlus
        return
      }
      record.rate = Rate.next(record.rate)
      record.achievement = Rate.floor(record.rate)
      record.rating = Rating.calc(record.chart, record.achievement)
    },
  }))

  add(['宴谱', '宴会场'], createFilter('difficulty:Utage', FilterType.Difficulty, {
    name: 'utage',
    chart: chart => chart.difficulty === MusicDifficulty.Utage,
    singleChart: true,
  }))
  add(['标准', '标'], createFilter('type:standard', FilterType.Type, {
    chart: chart => chart.music.type === MusicType.Standard,
  }))
  add(['dx谱'], createFilter('type:dx', FilterType.Type, {
    chart: chart => chart.music.type === MusicType.Deluxe,
  }))
  add(['旧框'], createFilter('version:pre-dx', FilterType.Version, {
    chart: chart => chart.music.version.version <= 19_900,
  }))
  add(['dx'], createFilter('version:dx', FilterType.Version, {
    chart: chart => chart.music.version.version > 19_900,
  }))

  const versions = [...(options.data?.versions.values() ?? [])]
  const newestVersion = versions.reduce<GameVersion | undefined>((latest, version) => (
    !latest || version.version > latest.version ? version : latest
  ), undefined)
  if (newestVersion) {
    add(['旧版本', '旧'], createFilter('version:old', FilterType.Version, {
      chart: chart => chart.music.version.version !== newestVersion.version,
    }))
    add(['新版本', '新歌', '新'], versionFilter('version:newest', [newestVersion]))
  }

  const starNames = ['一星', '二星', '三星', '四星', '五星']
  starNames.forEach((name, index) => {
    const stars = index + 1
    add([name, `${stars}星`], createFilter(`star:${stars}`, FilterType.Star, {
      record: record => DeluxeScore.stars(record.deluxeScore, record.chart.maxDeluxeScore) === stars,
    }))
  })
  for (const genre of MusicGenre.values) {
    if (genre === MusicGenre.Utage) continue
    add([genre.genreName, genre.value, ...genre.names], createFilter(`genre:${genre.id}`, FilterType.Genre, {
      chart: chart => chart.music.genre === genre,
    }))
  }
  for (const difficulty of MusicDifficulty.values) {
    if (difficulty === MusicDifficulty.Utage) continue
    add([...difficulty.names], createFilter(`difficulty:${difficulty.name}`, FilterType.Difficulty, {
      chart: chart => chart.difficulty === difficulty,
      singleChart: true,
    }))
  }

  const levelValues: number[] = []
  for (let level = 1; level <= 15; level++) {
    levelValues.push(level)
    if (level >= 7 && level <= 14) {
      for (let decimal = 1; decimal <= 9; decimal++) levelValues.push(level + decimal / 10)
    }
  }
  levelValues.reverse().forEach(value => {
    add([value.toFixed(1)], createFilter(`level-value:${value.toFixed(1)}`, FilterType.Level, {
      name: 'levelValue',
      chart: chart => chart.levelValue === value,
      singleChart: true,
    }))
  })
  const levels: string[] = []
  for (let level = 1; level <= 15; level++) {
    levels.push(String(level))
    if (level >= 7 && level <= 14) levels.push(`${level}+`)
  }
  levels.reverse().forEach(level => {
    const aliases = Number.parseInt(level, 10) >= 10 ? [`${level}级`, level] : [`${level}级`]
    add(aliases, createFilter(`level:${level}`, FilterType.Level, {
      name: 'level',
      chart: chart => chart.level === level,
      singleChart: true,
    }))
  })

  const designerConfig = options.designerConfig ?? emptyDesignerConfig
  for (const [mainName, aliases] of Object.entries(designerConfig.aliases)) {
    add([...aliases], createDesignerFilter(mainName, designerConfig))
  }

  const data = options.data
  if (data) {
    const versionPlates = [...data.plates.values()].filter(plate => (
      plate.genre === '実績' && plate.requires.length > 0 && simplifyPlateName(plate.name) !== '霸者'
    ))
    const byPrefix = new Map<string, typeof versionPlates[number]>()
    for (const plate of versionPlates) {
      const suffix = plateSuffix(plate.name)
      if (!suffix) continue
      const simplified = simplifyPlateName(plate.name)
      byPrefix.set(simplified.slice(0, -suffix.length), plate)
    }
    const earlyVersions = ['真', '超', '檄'].flatMap(prefix => {
      const plate = byPrefix.get(prefix)
      return plate?.requires.map(id => data.musics.get(id)?.version).filter((value): value is GameVersion => Boolean(value)) ?? []
    })
    if (earlyVersions.length) add(['真超檄'], versionFilter('version:early-plates', earlyVersions), true)
    for (const [prefix, plate] of byPrefix) {
      const plateVersions = plate.requires
        .map(id => data.musics.get(id)?.version)
        .filter((value): value is GameVersion => Boolean(value))
      add([prefix, toSimplified(prefix)], versionFilter(`version:plate:${prefix}`, plateVersions))
      add([`${toSimplified(prefix)}代`], versionFilter(`version:plate-era:${prefix}`, plateVersions), true)
    }

    for (const version of versions.filter(value => value.version > 20_000)) {
      const year = version.name.includes('舞萌DX ') ? version.name.split('舞萌DX ')[1] : version.name
      add([`舞萌dx${year}`, `dx${year}`, year], createFilter(`version:through:${version.version}`, FilterType.Version, {
        chart: chart => chart.music.version.version <= version.version,
        nowVersion: version,
      }), true)
    }
    const dxOriginal = versions.find(version => version.version === 20_000)
    if (dxOriginal) {
      add(['dx无印'], createFilter('version:through:20000', FilterType.Version, {
        chart: chart => chart.music.version.version <= dxOriginal.version,
        nowVersion: dxOriginal,
      }), true)
    }

    const designers = new Set([...data.musics.values()].flatMap(music => (
      music.charts.map(chart => chart.notesDesigner).filter(name => name.trim() && name !== '-')
    )))
    for (const designer of designers) {
      add([designer], createDesignerFilter(designer, designerConfig), true)
    }

    for (const plate of data.plates.values()) {
      if (plate.genre !== '実績' || !plate.requires.length) continue
      add([plate.name, simplifyPlateName(plate.name)], plateFilter(plate.name, plate.requires, plate.remasters), true)
    }
  }

  for (const tag of options.tags ?? []) {
    add(tag.aliases, createFilter(`tag:${tag.name}`, FilterType.Tag, {
      name: tag.name,
      chart: chart => tag.musics.includes(chart.music.id),
    }))
  }

  const random = options.random ?? Math.random
  const randomOrders = new Map<RecordEntry, number>()
  add(['随机'], createFilter('sort:random', FilterType.Sort, {
    sortBy: record => {
      let value = randomOrders.get(record)
      if (value === undefined) {
        value = random()
        randomOrders.set(record, value)
      }
      return value
    },
  }))

  return {
    keywords: entries,
    achievementPattern: /(?<!\d)(?:10[0-1]|[1-9]?\d)\.\d{1,4}(?=%)/g,
    achievementFilter: matched => createFilter(`achievement:exact:${matched}`, FilterType.Achievement, {
      record: record => record.achievement === Math.round(Number(matched) * 10_000),
    }),
    excludeUtage: createFilter('default:exclude-utage', FilterType.Default, {
      name: 'excludeUtage',
      chart: chart => chart.difficulty !== MusicDifficulty.Utage,
    }),
  }
}
