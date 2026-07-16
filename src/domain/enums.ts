export class MusicDifficulty {
  static readonly Basic = new MusicDifficulty(0, 'Basic', ['\u7eff\u8c31', '\u7eff'])
  static readonly Advanced = new MusicDifficulty(1, 'Advanced', ['\u9ec4\u8c31', '\u9ec4'])
  static readonly Expert = new MusicDifficulty(2, 'Expert', ['\u7ea2\u8c31', '\u7ea2'])
  static readonly Master = new MusicDifficulty(3, 'Master', ['\u7d2b\u8c31', '\u7d2b'])
  static readonly ReMaster = new MusicDifficulty(4, 'ReMaster', ['\u767d\u8c31', '\u767d'])
  static readonly Utage = new MusicDifficulty(10, 'Utage', ['\u5bb4\u8c31', '\u5bb4'])

  static readonly values = [
    MusicDifficulty.Basic,
    MusicDifficulty.Advanced,
    MusicDifficulty.Expert,
    MusicDifficulty.Master,
    MusicDifficulty.ReMaster,
    MusicDifficulty.Utage,
  ] as const

  private constructor(
    readonly value: number,
    readonly name: string,
    readonly names: readonly string[],
  ) {}

  static of(value: number) {
    const difficulty = MusicDifficulty.values.find(entry => entry.value === value)
    if (!difficulty) throw new RangeError(`Unknown music difficulty: ${value}`)
    return difficulty
  }

  static from(name: string) {
    return MusicDifficulty.values.find(entry =>
      entry.names.includes(name) || entry.name.includes(name),
    )
  }

  get brief() {
    return this.names[this.names.length - 1]
  }

  toString() {
    return this.name
  }
}

export class MusicType {
  static readonly Standard = new MusicType('SD', 'standard')
  static readonly Deluxe = new MusicType('DX', 'dx')
  static readonly values = [MusicType.Standard, MusicType.Deluxe] as const

  private constructor(
    readonly value: string,
    readonly full: string,
  ) {}

  static of(value: string) {
    const type = MusicType.values.find(entry => entry.value === value)
    if (!type) throw new RangeError(`Unknown music type: ${value}`)
    return type
  }
}

export class MusicGenre {
  static readonly PopsAnime = new MusicGenre(101, '\u6d41\u884c&\u52a8\u6f2b', 'POPS\u30a2\u30cb\u30e1', ['\u52a8\u6f2b', '\u6d41\u884c', '\u4e8c\u6b21\u5143'])
  static readonly Niconico = new MusicGenre(102, 'niconico\uff06VOCALOID\u2122', 'niconico\u30dc\u30fc\u30ab\u30ed\u30a4\u30c9', ['niconico & VOCALOID', 'nico', 'v\u5bb6', 'v', '\u672f\u529b\u53e3', '\u672f', '\u30dc\u30ab\u30ed', '\u30dc\u30fc\u30ab\u30ed\u30a4\u30c9', '\u30cb\u30b3\u30cb\u30b3', '\u30cb\u30b3'])
  static readonly Touhou = new MusicGenre(103, '\u4e1c\u65b9Project', '\u6771\u65b9Project', ['\u4e1c\u65b9', '\u4e1c', '\u8f66', '\u6771\u65b9'])
  static readonly Variety = new MusicGenre(104, '\u5176\u4ed6\u6e38\u620f', '\u30b2\u30fc\u30e0\u30d0\u30e9\u30a8\u30c6\u30a3', ['\u5176\u4ed6', 'variety'])
  static readonly Original = new MusicGenre(105, '\u821e\u840c', 'maimai', ['\u821e\u840c', 'maimai'])
  static readonly Chugeki = new MusicGenre(106, '\u97f3\u51fb&\u4e2d\u4e8c\u8282\u594f', '\u30aa\u30f3\u30b2\u30adCHUNITHM', ['\u97f3\u51fb\u4e2d\u4e8c', '\u4e2d\u4e8c\u97f3\u51fb', 'chugeki', 'gekichu'])
  static readonly Utage = new MusicGenre(107, '\u5bb4\u4f1a\u5834', '\u5bb4\u4f1a\u5834', ['\u5bb4\u4f1a\u573a'])

  static readonly values = [
    MusicGenre.PopsAnime,
    MusicGenre.Niconico,
    MusicGenre.Touhou,
    MusicGenre.Variety,
    MusicGenre.Original,
    MusicGenre.Chugeki,
    MusicGenre.Utage,
  ] as const

  private constructor(
    readonly id: number,
    readonly genreName: string,
    readonly value: string,
    readonly names: readonly string[],
  ) {}

  static of(value: string) {
    const genre = MusicGenre.values.find(entry => entry.value === value)
    if (!genre) throw new RangeError(`Unknown music genre: ${value}`)
    return genre
  }

  toString() {
    return this.value
  }
}

export class ComboStatus {
  static readonly None = new ComboStatus(0, 'none')
  static readonly FullCombo = new ComboStatus(1, 'fc')
  static readonly FullComboPlus = new ComboStatus(2, 'fcp')
  static readonly AllPerfect = new ComboStatus(3, 'ap')
  static readonly AllPerfectPlus = new ComboStatus(4, 'app')
  static readonly values = [
    ComboStatus.None,
    ComboStatus.FullCombo,
    ComboStatus.FullComboPlus,
    ComboStatus.AllPerfect,
    ComboStatus.AllPerfectPlus,
  ] as const

  private constructor(
    readonly id: number,
    readonly value: string,
  ) {}

  static of(id: number): ComboStatus
  static of(value: string | null | undefined): ComboStatus
  static of(value: number | string | null | undefined) {
    if (typeof value === 'number') {
      const status = ComboStatus.values.find(entry => entry.id === value)
      if (!status) throw new RangeError(`Unknown combo status: ${value}`)
      return status
    }
    return ComboStatus.values.find(entry => entry.value === value) ?? ComboStatus.None
  }

  isAP() {
    return this.id >= ComboStatus.AllPerfect.id
  }

  isFC() {
    return this.id >= ComboStatus.FullCombo.id
  }
}

export class SyncStatus {
  static readonly None = new SyncStatus(0, 'none')
  static readonly FullSync = new SyncStatus(1, 'fs')
  static readonly FullSyncPlus = new SyncStatus(2, 'fsp')
  static readonly FullSyncDeluxe = new SyncStatus(3, 'fsd')
  static readonly FullSyncDeluxePlus = new SyncStatus(4, 'fsdp')
  static readonly Sync = new SyncStatus(5, 'sync')
  static readonly values = [
    SyncStatus.None,
    SyncStatus.FullSync,
    SyncStatus.FullSyncPlus,
    SyncStatus.FullSyncDeluxe,
    SyncStatus.FullSyncDeluxePlus,
    SyncStatus.Sync,
  ] as const

  private constructor(
    readonly id: number,
    readonly value: string,
  ) {}

  static of(id: number): SyncStatus
  static of(value: string | null | undefined): SyncStatus
  static of(value: number | string | null | undefined) {
    if (typeof value === 'number') {
      const status = SyncStatus.values.find(entry => entry.id === value)
      if (!status) throw new RangeError(`Unknown sync status: ${value}`)
      return status
    }
    return SyncStatus.values.find(entry => entry.value === value) ?? SyncStatus.None
  }

  isFSD() {
    return this === SyncStatus.FullSyncDeluxe || this === SyncStatus.FullSyncDeluxePlus
  }

  isFS() {
    return this === SyncStatus.FullSync || this === SyncStatus.FullSyncPlus || this.isFSD()
  }
}

const rateFloors = {
  sssp: 1_005_000,
  sss: 1_000_000,
  ssp: 995_000,
  ss: 990_000,
  sp: 980_000,
  s: 970_000,
  aaa: 940_000,
  aa: 900_000,
  a: 800_000,
  bbb: 750_000,
  bb: 700_000,
  b: 600_000,
  c: 500_000,
  d: 0,
} as const

export type RateName = keyof typeof rateFloors

export class Rate {
  static readonly rates: readonly RateName[] = [
    'sssp', 'sss', 'ssp', 'ss', 'sp', 's',
    'aaa', 'aa', 'a', 'bbb', 'bb', 'b', 'c', 'd',
  ]

  static get(achievement: number): RateName {
    if (achievement >= 1_005_000 && achievement <= 1_010_000) return 'sssp'
    if (achievement >= 1_000_000 && achievement < 1_005_000) return 'sss'
    if (achievement >= 995_000 && achievement < 1_000_000) return 'ssp'
    if (achievement >= 990_000 && achievement < 995_000) return 'ss'
    if (achievement >= 980_000 && achievement < 990_000) return 'sp'
    if (achievement >= 970_000 && achievement < 980_000) return 's'
    if (achievement >= 940_000 && achievement < 970_000) return 'aaa'
    if (achievement >= 900_000 && achievement < 940_000) return 'aa'
    if (achievement >= 800_000 && achievement < 900_000) return 'a'
    if (achievement >= 750_000 && achievement < 800_000) return 'bbb'
    if (achievement >= 700_000 && achievement < 750_000) return 'bb'
    if (achievement >= 600_000 && achievement < 700_000) return 'b'
    if (achievement >= 500_000 && achievement < 600_000) return 'c'
    return 'd'
  }

  static floor(rate: string) {
    return rateFloors[rate as RateName] ?? 0
  }

  static greater(a: string, b: string): boolean
  static greater(a: number, b: RateName): boolean
  static greater(a: number | string, b: string) {
    return (typeof a === 'number' ? a : Rate.floor(a)) > Rate.floor(b)
  }

  static greaterEqual(achievement: number, rate: RateName) {
    return achievement >= Rate.floor(rate)
  }

  static toString(achievement: number) {
    const whole = Math.trunc(achievement / 10_000)
    const fraction = Math.abs(achievement % 10_000).toString().padStart(4, '0')
    return `${whole}.${fraction}%`
  }

  static next(rate: RateName) {
    if (rate === 'sssp') return rate
    const index = Rate.rates.indexOf(rate)
    if (index < 1) throw new RangeError(`Unknown rate: ${rate}`)
    return Rate.rates[index - 1]
  }
}
