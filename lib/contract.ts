// Public API contract: GET /api/zug94 (see docs/api.md).
// Must stay identical to lib/zug94.ts in the supporter-zug94 website.

export const API_VERSION = 1

export interface Team {
  name: string
  score: number | null
}

export interface Match {
  date: string // "YYYY-MM-DD"
  time: string | null // "HH:mm", Swiss local time
  competition: string | null
  venue: string | null
  homeTeam: Team
  awayTeam: Team
}

export interface TableRow {
  rank: number
  team: string
  isZug94: boolean
  played: number
  goalDifference: number
  points: number
}

export interface ApiResponse {
  version: number
  lastMatch: Match | null
  nextMatch: Match | null
  table: TableRow[] // exactly 3 rows
  tableUrl: string | null
}

// Stored snapshot written by the scraper (data/zug94.json). The API derives the
// response from it at request time so last/next match roll over without a new scrape.

export interface StoredMatch extends Match {
  status: string | null // e.g. "Spiel findet nicht statt", "Forfait"; null = normal
}

export interface Snapshot {
  updatedAt: string // ISO timestamp of the last scrape that changed the data
  tableUrl: string | null
  table: TableRow[] // full league table, sorted by rank
  matches: StoredMatch[] // full Zug 94 team schedule, chronological
}
