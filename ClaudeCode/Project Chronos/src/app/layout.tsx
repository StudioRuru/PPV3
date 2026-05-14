import type { Metadata } from 'next'
import { Geist_Mono } from 'next/font/google'
import './globals.css'

const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
  title: 'Watchmaker',
  description: 'Watch movement service assistant',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className={`${mono.variable} h-full bg-zinc-950 text-zinc-100 antialiased`}>
        {children}
      </body>
    </html>
  )
}
