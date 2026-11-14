// Camoufox-based scraper for football.ch / el-pl.ch. Runs in GitHub Actions (or locally),
// never inside Vercel — the browser is far too large for a serverless function.
import { Camoufox } from "camoufox-js"
import type { Browser, BrowserContext, Page } from "playwright-core"
import { mkdir, writeFile } from "node:fs/promises"
import type { StoredMatch, TableRow } from "../lib/contract.ts"

export const WIDGET_URL = "https://widget.football.ch/Widgets.aspx/v-397/t-31551/a-trr/?lang=de"
export const SCHEDULE_URL =
  "https://matchcenter.el-pl.ch/default.aspx?oid=3&lng=1&v=397&t=31551&ls=25795&sg=70238&a=pt"
export const TEAM_NAME = "Zug 94"

const ATTEMPTS = 5
const NAV_TIMEOUT_MS = 30_000
const READY_TIMEOUT_MS = 15_000

// ---------- browser helpers ----------

export async function launchBrowser(headless = true): Promise<Browser> {
  return Camoufox({ headless, locale: "de-CH", os: "windows" })
}

async function withRetries<T>(label: string, fn: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      console.warn(`[${label}] attempt ${attempt}/${ATTEMPTS} failed: ${(error as Error).message.split("\n")[0]}`)
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
  throw new Error(`[${label}] giving up after ${ATTEMPTS} attempts: ${(lastError as Error)?.message}`)
}

async function saveDebug(page: Page, name: string) {
  try {
    await mkdir(".debug", { recursive: true })
    await writeFile(`.debug/${name}.html`, await page.content(), "utf-8")
  } catch {
    // best effort
  }
}

/**
 * Opens `url` in a fresh context (fresh cookies/fingerprint) and waits until the real
 * content is there. The bot protection sometimes serves a stripped page; that shows up
 * as a selector timeout and triggers a retry. Caller must close the returned context.
 */
async function openReady(browser: Browser, url: string, readySelector: string, label: string) {
  return withRetries(label, async (attempt) => {
    const context: BrowserContext = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
      await page.waitForSelector(readySelector, { timeout: READY_TIMEOUT_MS })
      return { context, page }
    } catch (error) {
      await saveDebug(page, `${label}-attempt${attempt}`)
      await context.close()
      throw error
    }
  })
}

// ---------- normalisation ----------

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()

/** "Zug 94 (1.)" / "SC Cham (PL)" → league tag used in friendlies is dropped. */
const cleanTeam = (s: string) => clean(s).replace(/\s*\([^()]{1,6}\)$/, "")

function toInt(s: string, field: string): number {
  const n = Number(clean(s).replace(/\.$/, "").replace(/^\+/, ""))
  if (!Number.isInteger(n)) throw new Error(`Not a number for ${field}: "${s}"`)
  return n
}

const toScore = (s: string) => (/^\d+$/.test(clean(s)) ? Number(clean(s)) : null)

function toIsoDate(s: string): string {
  const m = clean(s).match(/(\d{2})\.(\d{2})\.(\d{4})/)
  if (!m) throw new Error(`Unparseable date: "${s}"`)
  return `${m[3]}-${m[2]}-${m[1]}`
}

function toTime(s: string): string | null {
  const m = clean(s).match(/^(\d{1,2}):(\d{2})$/)
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null
}

/** "Herti Allmend, Zug - 1 (Stadion)" → "Herti Allmend, Zug" */
const venueFromParts = (s: string) => clean(s.split(" - ")[0]) || null

// ---------- league table (widget.football.ch) ----------

interface RawTableRow {
  rank: string
  team: string
  played: string
  goalDifference: string
  points: string
}

export async function scrapeTable(browser: Browser): Promise<{ table: TableRow[]; tableUrl: string | null }> {
  const { context, page } = await openReady(browser, WIDGET_URL, '[id$="tbRangliste"] td.ranCteam', "widget")
  try {
    const raw = await page.evaluate(() => {
      const text = (el: Element | null) => el?.textContent ?? ""
      const rows: RawTableRow[] = []
      document.querySelectorAll('[id$="tbRangliste"] tr').forEach((tr) => {
        const team = tr.querySelector("td.ranCteam")
        if (!team) return
        rows.push({
          rank: text(tr.querySelector("td.ranCrang")),
          team: text(team),
          played: text(tr.querySelector("td.ranCsp")),
          goalDifference: text(tr.querySelector("td.ranCtdf")),
          points: text(tr.querySelector("td.ranCpt")),
        })
      })
      const link = Array.from(document.querySelectorAll<HTMLAnchorElement>(".nisTeamNavi a")).find(
        (a) => (a.textContent ?? "").trim() === "Resultate + Rangliste"
      )
      return { rows, tableUrl: link?.href ?? null }
    })

    let previousRank = 0
    const table = raw.rows.map((r): TableRow => {
      // Tied teams can have an empty rank cell — they share the rank above.
      const rank = clean(r.rank) ? toInt(r.rank, "rank") : previousRank
      previousRank = rank
      const team = cleanTeam(r.team)
      return {
        rank,
        team,
        isZug94: team === TEAM_NAME,
        played: toInt(r.played, `played (${team})`),
        goalDifference: toInt(r.goalDifference, `goalDifference (${team})`),
        points: toInt(r.points, `points (${team})`),
      }
    })
    return { table, tableUrl: raw.tableUrl }
  } finally {
    await context.close()
  }
}

// ---------- team schedule (matchcenter.el-pl.ch) ----------

interface RawMatch {
  competition: string | null
  date: string
  time: string
  home: string
  homeIsZug: boolean
  away: string
  awayIsZug: boolean
  scoreHome: string
  scoreAway: string
  status: string | null
  detailUrl: string | null
}

export interface ScrapedMatch extends StoredMatch {
  detailUrl: string | null
}

export interface ScheduleSession {
  matches: ScrapedMatch[]
  /** Fills `venue` for the given matches; failures leave it null. */
  loadVenues(targets: ScrapedMatch[]): Promise<void>
  close(): Promise<void>
}

export async function scrapeSchedule(browser: Browser): Promise<ScheduleSession> {
  const { context, page } = await openReady(browser, SCHEDULE_URL, '[id$="tbResultate"] .spiel', "schedule")
  try {
    const raw = await page.evaluate(() => {
      const text = (el: Element | null) => el?.textContent ?? ""
      // Played matches link to their detail page ("Telegramm"). Upcoming ones only have a
      // calendar export link, but its sid is the same match id the detail page takes as tg=.
      const detailUrl = (spiel: Element): string | null => {
        const telegram = spiel.querySelector<HTMLAnchorElement>('.telegramm-link a[title="Telegramm"]')
        if (telegram) return telegram.href
        const cal = spiel.querySelector<HTMLAnchorElement>("a.nisCal")
        const sid = cal && new URL(cal.href).searchParams.get("sid")
        if (!sid) return null
        const url = new URL(location.href)
        url.searchParams.delete("a")
        url.searchParams.set("tg", sid)
        return url.href
      }
      // The page has several tbResultate lists; the schedule is the one with matches.
      const list = Array.from(document.querySelectorAll('[id$="tbResultate"]')).find((l) => l.querySelector(".spiel"))
      const out: RawMatch[] = []
      let competition: string | null = null
      for (const item of Array.from(list?.children ?? [])) {
        if (item.classList.contains("sppTitel")) {
          competition = text(item)
          continue
        }
        const spiel = item.querySelector(".spiel")
        if (!spiel) continue
        const dateEl = spiel.querySelector(".date")
        const dateText = text(dateEl?.querySelector("span") ?? null)
        const teamA = spiel.querySelector(".teamA")
        const teamB = spiel.querySelector(".teamB")
        out.push({
          competition,
          date: dateText,
          time: text(dateEl).replace(dateText, ""),
          home: text(teamA),
          homeIsZug: !!teamA?.querySelector(".tabMyTeam"),
          away: text(teamB),
          awayIsZug: !!teamB?.querySelector(".tabMyTeam"),
          scoreHome: text(spiel.querySelector(".torA")),
          scoreAway: text(spiel.querySelector(".torB")),
          status: spiel.querySelector(".sppStatusText") ? text(spiel.querySelector(".sppStatusText")) : null,
          detailUrl: detailUrl(spiel),
        })
      }
      return out
    })

    const matches = raw.map((r): ScrapedMatch => {
      if (!r.homeIsZug && !r.awayIsZug) throw new Error(`Match without ${TEAM_NAME}: ${r.home} - ${r.away}`)
      return {
        date: toIsoDate(r.date),
        time: toTime(r.time),
        competition: clean(r.competition) || null,
        venue: null,
        homeTeam: { name: r.homeIsZug ? TEAM_NAME : cleanTeam(r.home), score: toScore(r.scoreHome) },
        awayTeam: { name: r.awayIsZug ? TEAM_NAME : cleanTeam(r.away), score: toScore(r.scoreAway) },
        status: r.status ? clean(r.status) : null,
        detailUrl: r.detailUrl,
      }
    })

    return {
      matches,
      async loadVenues(targets) {
        for (const m of targets) {
          if (!m.detailUrl) continue
          try {
            m.venue = await venueFromDetailPage(context, m.detailUrl)
          } catch (error) {
            console.warn(`[venue] ${m.date} ${m.homeTeam.name} - ${m.awayTeam.name}: ${(error as Error).message}`)
          }
        }
      },
      close: () => context.close(),
    }
  } catch (error) {
    await context.close()
    throw error
  }
}

/** Header reads "… - Spielnummer: 105656 - Stade des Grands-Prés, Bassecourt - Terrain principal". */
async function venueFromDetailPage(context: BrowserContext, url: string): Promise<string | null> {
  const page = await context.newPage()
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
    await page.waitForSelector(".shortSpielort", { timeout: READY_TIMEOUT_MS })
    const header = clean(await page.textContent(".shortSpielort"))
    const parts = header.split(" - ")
    const i = parts.findIndex((p) => p.startsWith("Spielnummer"))
    if (i === -1 || !parts[i + 1]) throw new Error(`venue not found in "${header}"`)
    return venueFromParts(parts[i + 1])
  } finally {
    await page.close()
  }
}
