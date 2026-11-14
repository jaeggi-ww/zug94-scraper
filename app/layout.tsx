export const metadata = {
  title: "Zug 94 Data API",
  description: "Last match, next match and league table of Zug 94 as JSON.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem", lineHeight: 1.5 }}>{children}</body>
    </html>
  )
}
