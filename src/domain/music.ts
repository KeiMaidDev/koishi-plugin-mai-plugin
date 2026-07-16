import { MusicDifficulty, type ComboStatus, type MusicGenre, type MusicType, type RateName, type SyncStatus } from './enums'

export interface GameVersion {
  id: number
  name: string
  version: number
}

export class Notes {
  readonly break: number

  constructor(
    readonly tap = 0,
    readonly hold = 0,
    readonly slide = 0,
    readonly touch = 0,
    breakNotes = 0,
  ) {
    this.break = breakNotes
  }

  get total() {
    return this.tap + this.hold + this.slide + this.touch + this.break
  }

  get maxDeluxeScore() {
    return this.total * 3
  }
}

export class MusicInfo {
  charts: ChartInfo[] = []

  constructor(
    readonly id: number,
    readonly name: string,
    readonly type: MusicType,
    readonly rights: string,
    readonly artist: string,
    readonly genre: MusicGenre,
    readonly bpm: number,
    readonly version: GameVersion,
    readonly isNew: boolean,
  ) {}

  get resourceId() {
    return this.id >= 100_000 ? this.id : this.id % 10_000
  }

  get fakeReMaster() {
    return new ChartInfo(this, MusicDifficulty.ReMaster, '', 0, new Notes(), '')
  }
}

export class ChartInfo {
  fitLevelValue = 0

  constructor(
    readonly music: MusicInfo,
    readonly difficulty: MusicDifficulty,
    readonly level: string,
    readonly levelValue: number,
    readonly notes: Notes,
    readonly notesDesigner: string,
  ) {}

  get maxDeluxeScore() {
    return this.notes.maxDeluxeScore
  }
}

export class RecordEntry {
  constructor(
    readonly music: MusicInfo,
    readonly chart: ChartInfo,
    public achievement: number,
    public comboStatus: ComboStatus,
    public syncStatus: SyncStatus,
    readonly deluxeScore: number,
    public rate: RateName,
    public rating: number,
  ) {}
}
