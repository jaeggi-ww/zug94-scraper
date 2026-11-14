# Zug 94 Data API – Contract

The supporter-zug94 website (`components/live-match-data.tsx`) calls this API **directly from
the browser** and renders three cards: *Letztes Spiel*, *Nächstes Spiel*, *Tabelle*. The website
validates responses with `assertZug94Data` in its `lib/zug94.ts`. This repo's types are in
[lib/contract.ts](../lib/contract.ts) and must stay in sync with it.

The API does all the work (scraping, picking the matches, cutting the table). The website only
validates and displays. If the response doesn't match this contract, the whole section is hidden.

## Request

```
GET https://<project>.vercel.app/api/zug94
```

## Required response headers

| Header | Value | Why |
|---|---|---|
| `Content-Type` | `application/json` | |
| `Access-Control-Allow-Origin` | `https://supporter-zug94.ch` (or `*`) | Browser calls it cross-origin. Add `http://localhost:3000` for local dev, or use `*`. |
| `Cache-Control` | `public, s-maxage=300, stale-while-revalidate=3600` | Vercel's CDN caches the response for 5 min. |

## Response body (HTTP 200)

**The shape is always identical.** Every key is always present. Unknown values are `null`, never
omitted, never `""`. Numbers are JSON numbers, not strings.

```json
{
  "version": 1,
  "lastMatch": {
    "date": "2026-11-08",
    "time": "16:00",
    "competition": "1. Liga Classic",
    "venue": "Herti Allmend, Zug",
    "homeTeam": { "name": "Zug 94", "score": 2 },
    "awayTeam": { "name": "FC Solothurn", "score": 1 }
  },
  "nextMatch": {
    "date": "2026-11-15",
    "time": "15:00",
    "competition": "1. Liga Classic",
    "venue": "Stadion FC Langenthal",
    "homeTeam": { "name": "FC Langenthal", "score": null },
    "awayTeam": { "name": "Zug 94", "score": null }
  },
  "table": [
    { "rank": 4, "team": "SC Buochs",     "isZug94": false, "played": 13, "goalDifference": 6, "points": 23 },
    { "rank": 5, "team": "Zug 94",        "isZug94": true,  "played": 13, "goalDifference": 4, "points": 22 },
    { "rank": 6, "team": "FC Black Stars","isZug94": false, "played": 13, "goalDifference": -1, "points": 20 }
  ],
  "tableUrl": "https://matchcenter.ifv.ch/default.aspx?v=397&oid=3&lng=1&t=31551&a=trr"
}
```

## Fields

### Top level

| Key | Type | Rule |
|---|---|---|
| `version` | number | Always `1`. Any other value → website hides the section. Bump only on breaking changes. |
| `lastMatch` | Match \| `null` | Most recent Zug 94 match **that has a final score**. `null` only if none played yet this season. |
| `nextMatch` | Match \| `null` | Earliest Zug 94 match **with no score, not cancelled, and kickoff no more than 3 h ago** (Europe/Zurich), so a match being played stays "next" until its result is in. `null` in the off-season. |
| `table` | TableRow[] | **Exactly 3 rows** (fewer only if the league has fewer than 3 teams), sorted by `rank` ascending. See selection rule below. |
| `tableUrl` | string \| `null` | Link to the full table ("Vollständige Tabelle →"). Hidden if `null`. |

### Match

| Key | Type | Rule |
|---|---|---|
| `date` | string | `YYYY-MM-DD`, Swiss local date. Website formats it as `Sa, 08.11.2026`. |
| `time` | string \| `null` | `HH:mm`, 24h, Swiss local time. `null` if kickoff not set yet. |
| `competition` | string \| `null` | e.g. `"1. Liga Classic"`, `"Schweizer Cup"`. |
| `venue` | string \| `null` | Stadium / location. |
| `homeTeam` / `awayTeam` | Team | Home is always the first team, as listed by the federation. |

### Team

| Key | Type | Rule |
|---|---|---|
| `name` | string | Must be **spelled exactly** like on football.ch (e.g. `"Grasshopper Club Zürich U-21"`); the website matches it to logos in `public/teams/<name>.png`. Zug 94 is always `"Zug 94"`. |
| `score` | number \| `null` | Goals. Always a number in `lastMatch`, always `null` in `nextMatch`. |

### TableRow

| Key | Type | Rule |
|---|---|---|
| `rank` | number | League position, 1 = first. |
| `team` | string | Same spelling rule as `Team.name`. |
| `isZug94` | boolean | `true` for exactly one row (the highlighted one). |
| `played` | number | Matches played. |
| `goalDifference` | number | Goals for minus against. Can be negative. Website shows `+4` / `-1`. |
| `points` | number | |

### Table selection rule (which 3 rows)

Let `i` be Zug 94's position in the full table sorted by rank:

| Situation | Rows returned |
|---|---|
| Zug 94 is first | ranks 1, 2, 3 |
| Zug 94 is last | the last 3 ranks |
| Otherwise | team above, Zug 94, team below |

```ts
const start = Math.min(Math.max(0, i - 1), full.length - 3)
const table = full.slice(start, start + 3)
```

## Errors

If the API cannot produce valid data, it should **return the last good response** (from its own
cache) rather than an error. If it has nothing at all, respond with a non-200 status; the website
then hides the section.

## Test checklist

- [ ] `curl -i <url>` shows `Access-Control-Allow-Origin` and `Content-Type: application/json`
- [ ] All 5 top-level keys present, `version: 1`
- [ ] `table` has 3 rows, exactly one `isZug94: true`
- [ ] Numbers are numbers (`2`, not `"2"`)
- [ ] `date` is `YYYY-MM-DD`, `time` is `HH:mm` or `null`
- [ ] Team names match the filenames in `public/teams/`
