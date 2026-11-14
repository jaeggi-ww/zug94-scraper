# zug94-scraper

Next.js API serving Zug 94's last match, next match and league table as JSON,
for the [supporter-zug94](../supporter-zug94) website.

```
GET /api/zug94
```

The response contract is documented in [docs/api.md](docs/api.md).

## How it works

```
GitHub Actions (daily)                          Vercel
┌──────────────────────────────┐   git push   ┌──────────────────────────────┐
│ Camoufox (stealth Firefox)    │ ───────────▶ │ Next.js                       │
│  1. widget.football.ch → table│  data/       │  /api/zug94 reads the JSON,   │
│  2. matchcenter.el-pl.ch →    │  zug94.json  │  picks last/next match at     │
│     schedule + venues         │  (only when  │  request time, slices table   │
│  3. validate, write if changed│   changed)   │  to 3 rows, adds CORS         │
└──────────────────────────────┘              └──────────────────────────────┘
```

**Why not scrape inside Vercel?** Camoufox is a full Firefox build: far bigger than
Vercel's 250 MB function limit, and it needs Linux GUI libraries Vercel doesn't have.
So the browser runs in GitHub Actions, and Vercel only serves the result.

- **Pages scraped**
  - Table: `https://widget.football.ch/Widgets.aspx/v-397/t-31551/a-trr/?lang=de`
  - Team schedule: `https://matchcenter.el-pl.ch/default.aspx?oid=3&lng=1&v=397&t=31551&ls=25795&sg=70238&a=pt`
  - Venues: each match's detail page (`…&tg=<match id>`), looked up for the last match and the next 3.
- **Bot protection.** Each page is opened in a fresh browser context and the scraper waits for the
  real content. On a stripped or blocked page it retries up to 5 times. If validation fails,
  the old data stays untouched and the workflow fails. Failed pages are uploaded as the
  `debug-pages` artifact.
- **Last/next match** are chosen when the API is called, not when the data is scraped, so
  the API stays correct between scrapes. A match without a result stays "next" until 3 h
  after kickoff. It becomes "last" once its score has been scraped.
- **Commits** only happen when the data actually changed, so there's roughly one Vercel
  deploy per match-related update.

## Local development

```bash
npm install
npm run browser:fetch       # download Camoufox (~once)
npm run scrape              # scrape and update data/zug94.json
npm run scrape -- --dry-run # scrape, print the API response, don't write
npm run scrape -- --headful # watch the browser
npm run dev                 # http://localhost:3000/api/zug94
```

## Deployment

1. Push this repo to GitHub.
2. Import it in Vercel (framework: Next.js, no env vars needed).
3. In GitHub → Settings → Actions → General → Workflow permissions, allow **Read and write**.
4. Run the **Scrape Zug 94 data** workflow once by hand (Actions tab → Run workflow).

The schedule is once a day at 05:00 UTC (`0 5 * * *`) = 06:00 CET / 07:00 CEST in
[.github/workflows/scrape.yml](.github/workflows/scrape.yml). It can also be started by hand
(Actions tab → Run workflow), and it runs on every code push.
GitHub pauses scheduled workflows after 60 days without repository activity. Data commits
count as activity, so this only happens during a long summer break.

## Changing teams / seasons

The URLs and team name are at the top of [scripts/scraper.ts](scripts/scraper.ts). The `ls`/`sg`
parameters in the schedule URL change each season.
