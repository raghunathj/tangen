import type { ReactNode } from 'react'
import Link from 'next/link'
import './globals.css'

export const metadata = { title: 'Tangen · Live Preview Demo', description: 'Pages + posts from a Tangen site' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">Tangen Demo</Link>
          <nav><Link href="/">Posts</Link></nav>
        </header>
        <main className="container">{children}</main>
        <footer className="site-footer">Rendered from the Tangen REST API via <code>@tangen/sdk</code>.</footer>
      </body>
    </html>
  )
}
