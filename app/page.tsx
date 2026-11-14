import snapshot from "@/data/zug94.json"

export default function Home() {
  return (
    <main>
      <h1>Zug 94 Data API</h1>
      <p>
        <a href="/api/zug94">/api/zug94</a> – last match, next match and league table as JSON.
      </p>
      <p>Data last changed: {new Date(snapshot.updatedAt).toLocaleString("de-CH", { timeZone: "Europe/Zurich" })}</p>
    </main>
  )
}
