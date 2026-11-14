import { API_VERSION, type ApiResponse, type Match, type Snapshot, type StoredMatch, type TableRow } from "./contract.ts"

const TABLE_ROWS = 3
// A match without a result stays "next" for this long after kickoff (it's being played).
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000

const zurichFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Zurich",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** "YYYY-MM-DD HH:mm" in Swiss local time — sortable as a string. */
function zurichKey(at: Date): string {
  return zurichFormat.format(at)
}

function kickoffKey(m: StoredMatch): string {
  return `${m.date} ${m.time ?? "00:00"}`
}

const isPlayed = (m: StoredMatch) => m.homeTeam.score !== null && m.awayTeam.score !== null

function toMatch({ status: _status, ...match }: StoredMatch): Match {
  return match
}

/** Team above Zug 94, Zug 94, team below. First → top 3, last → bottom 3. */
export function sliceAroundZug94(table: TableRow[]): TableRow[] {
  const sorted = [...table].sort((a, b) => a.rank - b.rank)
  if (sorted.length <= TABLE_ROWS) return sorted
  const i = sorted.findIndex((row) => row.isZug94)
  if (i === -1) return sorted.slice(0, TABLE_ROWS)
  const start = Math.min(Math.max(0, i - 1), sorted.length - TABLE_ROWS)
  return sorted.slice(start, start + TABLE_ROWS)
}

export function pickLastMatch(matches: StoredMatch[], now: Date): StoredMatch | null {
  const nowKey = zurichKey(now)
  let best: StoredMatch | null = null
  for (const m of matches) {
    if (!isPlayed(m) || kickoffKey(m) > nowKey) continue
    if (!best || kickoffKey(m) >= kickoffKey(best)) best = m
  }
  return best
}

export function pickNextMatch(matches: StoredMatch[], now: Date): StoredMatch | null {
  const fromKey = zurichKey(new Date(now.getTime() - LIVE_WINDOW_MS))
  const today = zurichKey(now).slice(0, 10)
  let best: StoredMatch | null = null
  for (const m of matches) {
    if (isPlayed(m) || m.status !== null) continue
    const upcoming = m.time === null ? m.date >= today : kickoffKey(m) >= fromKey
    if (!upcoming) continue
    if (!best || kickoffKey(m) < kickoffKey(best)) best = m
  }
  return best
}

export function buildResponse(snapshot: Snapshot, now = new Date()): ApiResponse {
  const last = pickLastMatch(snapshot.matches, now)
  const next = pickNextMatch(snapshot.matches, now)
  return {
    version: API_VERSION,
    lastMatch: last && toMatch(last),
    nextMatch: next && toMatch(next),
    table: sliceAroundZug94(snapshot.table),
    tableUrl: snapshot.tableUrl,
  }
}
