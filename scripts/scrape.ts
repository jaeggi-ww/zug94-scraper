// Usage: npm run scrape [-- --dry-run] [-- --headful]
// Scrapes both pages with Camoufox, validates the result and writes data/zug94.json
// only when the data actually changed (so CI only commits real changes).
import { readFile, writeFile } from "node:fs/promises"
import { isDeepStrictEqual } from "node:util"
import type { Snapshot, StoredMatch } from "../lib/contract.ts"
import { buildResponse, pickLastMatch } from "../lib/build-response.ts"
import { launchBrowser, scrapeSchedule, scrapeTable, TEAM_NAME, type ScrapedMatch } from "./scraper.ts"

const DATA_FILE = new URL("../data/zug94.json", import.meta.url)
const UPCOMING_VENUES = 3 // look up the venue for this many upcoming matches

const args = new Set(process.argv.slice(2))
const dryRun = args.has("--dry-run")
const headless = !args.has("--headful")

const matchKey = (m: StoredMatch) => `${m.date}|${m.homeTeam.name}|${m.awayTeam.name}`

function validate(snapshot: Omit<Snapshot, "updatedAt">) {
  const errors: string[] = []
  if (snapshot.table.length < 3) errors.push(`table has only ${snapshot.table.length} rows`)
  const zugRows = snapshot.table.filter((r) => r.isZug94).length
  if (zugRows !== 1) errors.push(`table has ${zugRows} "${TEAM_NAME}" rows, expected 1`)
  if (snapshot.matches.length === 0) errors.push("schedule is empty")
  if (errors.length) throw new Error(`Scraped data failed validation:\n- ${errors.join("\n- ")}`)
}

async function readSnapshot(): Promise<Snapshot | null> {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf-8"))
  } catch {
    return null
  }
}

async function main() {
  const started = Date.now()
  const previous = await readSnapshot()
  const browser = await launchBrowser(headless)
  let snapshotData: Omit<Snapshot, "updatedAt">

  try {
    const { table, tableUrl } = await scrapeTable(browser)
    console.log(`table: ${table.length} rows`)

    const schedule = await scrapeSchedule(browser)
    try {
      const now = new Date()
      const last = pickLastMatch(schedule.matches, now)
      const upcoming = schedule.matches
        .filter((m) => m.homeTeam.score === null && m.status === null && m.date >= now.toISOString().slice(0, 10))
        .slice(0, UPCOMING_VENUES)
      await schedule.loadVenues([...(last ? [last as ScrapedMatch] : []), ...upcoming])
      console.log(`schedule: ${schedule.matches.length} matches`)
    } finally {
      await schedule.close()
    }

    // Keep venues found in earlier runs (lookups are only done for a few matches each run).
    const knownVenues = new Map((previous?.matches ?? []).map((m) => [matchKey(m), m.venue]))
    const matches: StoredMatch[] = schedule.matches.map(({ detailUrl: _d, ...m }) => ({
      ...m,
      venue: m.venue ?? knownVenues.get(matchKey(m)) ?? null,
    }))

    snapshotData = { tableUrl, table, matches }
    validate(snapshotData)
  } finally {
    await browser.close()
  }

  const response = buildResponse({ updatedAt: new Date().toISOString(), ...snapshotData })
  console.log("API response would be:\n" + JSON.stringify(response, null, 2))

  const { updatedAt: _u, ...previousData } = previous ?? { updatedAt: "" }
  if (previous && isDeepStrictEqual(previousData, snapshotData)) {
    console.log(`No changes (${((Date.now() - started) / 1000).toFixed(1)}s).`)
    return
  }
  if (dryRun) {
    console.log("Data changed — not written (--dry-run).")
    return
  }
  const snapshot: Snapshot = { updatedAt: new Date().toISOString(), ...snapshotData }
  await writeFile(DATA_FILE, JSON.stringify(snapshot, null, 2) + "\n", "utf-8")
  console.log(`Wrote data/zug94.json (${((Date.now() - started) / 1000).toFixed(1)}s).`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
