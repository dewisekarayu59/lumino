import type { Metadata } from 'next'
import './globals.css'
import { NotificationProvider } from '@/components/notification/Toast'
import ThemeProvider from '@/components/ThemeProvider'
import NextTopLoader from 'nextjs-toploader'

export const metadata: Metadata = {
  title: 'lumiox',
  description: 'Premium multi-provider AI Chat application with a modern, elegant interface.',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-[100dvh] bg-background text-text-primary antialiased">
        <ThemeProvider>
          <NextTopLoader color="var(--accent-500)" showSpinner={false} />
          <NotificationProvider />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
