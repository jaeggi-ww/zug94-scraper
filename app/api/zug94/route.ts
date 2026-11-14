import snapshot from "@/data/zug94.json"
import { buildResponse } from "@/lib/build-response.ts"
import type { Snapshot } from "@/lib/contract.ts"

// Evaluated per request so "last" / "next" match roll over at kickoff time,
// independent of when the scraper last ran. Vercel's CDN caches it briefly.
export const dynamic = "force-dynamic"

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
}

export function GET() {
  return Response.json(buildResponse(snapshot as Snapshot), { headers: HEADERS })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS })
}
