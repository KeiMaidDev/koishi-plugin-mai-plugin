export interface LXNSScore {
  id: number
  level_index: number
  achievements: number
  fc?: string | null
  fs?: string | null
  dx_score: number
  type: string
  play_time?: string | null
  upload_time?: string | null
  last_played_time?: string | null
}

export interface LXNSRatingResponse {
  standard: LXNSScore[]
  dx: LXNSScore[]
}

export interface LXNSCollection {
  id: number
  name: string
  color?: string | null
  description?: string | null
  genre?: string | null
  required?: LXNSCollectionRequired[] | null
}

export interface LXNSCollectionRequired {
  difficulties?: number[] | null
  rate?: string | null
  fc?: string | null
  fs?: string | null
  songs?: LXNSCollectionRequiredSong[] | null
  completed?: boolean | null
}

export interface LXNSCollectionRequiredSong {
  id: number
  title: string
  type: string
  completed?: boolean | null
  completed_difficulties?: number[] | null
}

export interface LXNSPlayer {
  name: string
  rating: number
  friend_code: number
  course_rank: number
  class_rank: number
  star: number
  icon?: LXNSCollection | null
  name_plate?: LXNSCollection | null
  frame?: LXNSCollection | null
}

export interface DivingFishRecord {
  achievements: number
  ds: number
  dxScore: number
  fc: string
  fs: string
  level: string
  level_index: number
  level_label: string
  ra: number
  rate: string
  song_id: number
  title: string
  type: string
}

export interface DivingFishCharts {
  sd: DivingFishRecord[]
  dx: DivingFishRecord[]
}

export interface DivingFishRatingResponse {
  username: string
  rating: number
  additional_rating: number
  nickname: string
  plate?: string | null
  charts: DivingFishCharts
}

export interface DivingFishRecordsResponse {
  username: string
  rating: number
  additional_rating: number
  nickname: string
  plate: string
  records: DivingFishRecord[]
}

export function toInternalAchievement(achievement: number) {
  return Math.trunc(achievement * 10_000)
}

export function normalizeLxnsMusicId(id: number, type: string) {
  return type === 'dx' && id < 10_000 ? id + 10_000 : id
}
