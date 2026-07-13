import type { RecordEntry } from './music'

export class PlayerInfo {
  constructor(
    readonly nickname = '',
    readonly rating = 0,
    readonly course = 0,
  ) {}
}

export class PlayerSettings {
  constructor(
    readonly avatar: number | null = null,
    readonly plate: number | null = null,
  ) {}
}

export class RatingResponse {
  constructor(
    readonly player: PlayerInfo,
    public settings: PlayerSettings | null | undefined = null,
    public oldRatingList: RecordEntry[] = [],
    public newRatingList: RecordEntry[] = [],
  ) {}
}

export class RecordsResponse {
  constructor(
    readonly player: PlayerInfo,
    public settings: PlayerSettings | null | undefined = null,
    readonly records: RecordEntry[] = [],
  ) {}
}
