# zug94-scraper

Data API for the Zug 94 match data shown on the supporter club website (supporter-zug94.ch,
repo `supporter-zug94`, sibling folder `../supporter-zug94`). Returns the last match, the
next match and 3 rows of the league table as JSON.

- Live: `https://zug94-scraper.vercel.app/api/zug94`
- GitHub: `jaeggi-ww/zug94-scraper` (public). Vercel deploys every push to `main` automatically.

State as of November 2026.

## Architecture

```
GitHub Actions, daily 05:00 UTC            git push            Vercel (Next.js 16)
scripts/scrape.ts + Camoufox      ──── data/zug94.json ────▶   app/api/zug94/route.ts
(scrapes football.ch / el-pl.ch)      (committed only           reads the JSON, builds
                                       when data changed)       the response per request
```

- **Scraping never runs on Vercel.** Camoufox (stealth Firefox) is far larger than Vercel's
  250 MB function limit and needs Linux GUI libraries. It runs only in GitHub Actions or
  locally. Don't move scraping into a route handler.
- `data/zug94.json` is the stored snapshot: full league table + full Zug 94 schedule + venues.
  It's committed to the repo; a commit triggers a Vercel redeploy, and the route imports it.
- `updatedAt` in the snapshot = the time the data last **changed**, not the last scrape.
  Runs that find nothing new write nothing and commit nothing. That's intended.
- The **route computes last/next match at request time** (`lib/build-response.ts`) from the
  stored schedule, so "next match" rolls over at kickoff even without a new scrape:
  - last = latest match with both scores and kickoff ≤ now (Europe/Zurich)
  - next = earliest match without score, `status === null` (not cancelled), kickoff ≥ now − 3 h
    (a match being played stays "next" until its result is scraped)
  - table = team above Zug 94, Zug 94, team below; top 3 if first, bottom 3 if last
    (`sliceAroundZug94`)
  - `updatedAt` (snapshot's last-change time, shown as "Stand" on the website) and
    `leagueSize` (full table length, shown as "13. von 16") are passed through

## Files

| File | Purpose |
|---|---|
| `lib/contract.ts` | Response types (`ApiResponse`) + stored snapshot types. **Must match `lib/zug94.ts` in the website**, which validates every response and hides the section on mismatch. |
| `lib/build-response.ts` | Pure logic: pick last/next match, slice table. |
| `app/api/zug94/route.ts` | GET + OPTIONS, CORS `*`, `Cache-Control: s-maxage=300, stale-while-revalidate=3600`. |
| `app/page.tsx` | Tiny info page showing "Data last changed". |
| `scripts/scraper.ts` | Camoufox scraping: URLs, DOM extraction, normalisation, retries, venues. |
| `scripts/scrape.ts` | Entry: run scraper, validate, keep known venues, write JSON if changed. |
| `.github/workflows/scrape.yml` | Daily schedule + run on push + manual trigger; commits data. |
| `docs/api.md` | Public JSON contract (copy of the website's `docs/zug94-api.md`; keep in sync). |

## Scraped sources (constants at the top of `scripts/scraper.ts`)

- **Table:** `https://widget.football.ch/Widgets.aspx/v-397/t-31551/a-trr/?lang=de`
  → rows of `[id$="tbRangliste"]` (`td.ranCrang/ranCteam/ranCsp/ranCtdf/ranCpt`). The
  "Resultate + Rangliste" nav link gives `tableUrl`.
- **Schedule:** `https://matchcenter.el-pl.ch/default.aspx?oid=3&lng=1&v=397&t=31551&ls=25795&sg=70238&a=pt`
  → the `[id$="tbResultate"]` list that contains `.spiel` items; `.sppTitel` rows are
  competition headers; `.tabMyTeam` marks Zug 94; `.sppStatusText` marks cancelled/forfeit.
- **Venues:** each match's detail page `…&tg=<match id>`, header `.shortSpielort`
  ("… - Spielnummer: N - <venue>, <town> - <pitch>"). Played matches link it directly;
  upcoming ones only have a calendar link whose `sid` equals the `tg` id. Looked up for the
  last match + next 3 each run; venues from earlier runs are kept.
- Friendlies ("Trainingsspiele") are included in last/next match.
- **Season change:** `ls`/`sg` in the schedule URL change every season. When the schedule
  shows the wrong season or validation fails after summer, take the new "Team-Spielplan"
  link from the widget page's navigation and update `SCHEDULE_URL`.
- Team names in friendlies carry league tags like "(1.)" / "(PL)", which `cleanTeam()` strips.
  The website maps exact team names to logo files, so keep names as football.ch spells them.

## Bot protection

football.ch blocks plain HTTP clients by TLS fingerprint and sometimes serves a stripped
page. That's why Camoufox is used: each page opens in a fresh browser context, waits for a
real-content selector, and retries up to 5× with backoff. Failed pages are saved to
`.debug/*.html` (uploaded as the `debug-pages` artifact in CI). Validation failure → exit 1,
existing data untouched.

## Running locally

```bash
npm install
npm run browser:fetch          # download Camoufox once (~cache dir)
npm run scrape -- --dry-run    # scrape + print API response, don't write
npm run scrape                 # update data/zug94.json
npm run scrape -- --headful    # watch the browser
npm run dev                    # http://localhost:3000/api/zug94
npm run typecheck && npm run lint && npm run build
```

Scripts are TypeScript run directly by Node (type stripping, Node ≥ 22.18), so imports use
`.ts` extensions and only erasable TS syntax is allowed (no enums, no parameter properties).
Functions passed to `page.evaluate` run in the browser and must be self-contained.

## CI details (`.github/workflows/scrape.yml`)

- Triggers: `cron: "0 5 * * *"` (06:00 CET / 07:00 CEST; GitHub cron is UTC-only and may
  start late or skip runs under load), push to `main` (except data/markdown changes),
  manual `workflow_dispatch`.
- `runs-on: ubuntu-24.04` (pinned: playwright-core 1.62's `install-deps` knows its packages).
- `GITHUB_TOKEN` is passed to `camoufox-js fetch` and the scrape step: the browser download
  uses the GitHub API, and the anonymous rate limit on shared runners made the first run fail.
- Camoufox is cached under `~/.cache/camoufox`, keyed on `package-lock.json`.
- `camoufox-js` requires `playwright-core` < 1.63 (peer dependency). Upgrade them together.
- Workflow permission "Read and write" is required so the job can push data commits.
- GitHub disables scheduled workflows after 60 days without repo activity (e.g. a summer
  break with no data changes). Re-enable in the Actions tab if that happens.

## Changing the API

The website validates responses strictly (`assertZug94Data` in the website's `lib/zug94.ts`).
Any change to the response shape needs the same change there and in both docs, plus a
`version` bump if it's breaking. Adding a field the website doesn't read is harmless.
