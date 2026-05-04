import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from '@/components/providers'
import { Toaster } from 'sonner'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'TradeMind — Trading Intelligence Platform',
    template: '%s | TradeMind',
  },
  description:
    'Plataforma SaaS de trading intradía con IA. Análisis técnico, señales, portafolio y alertas para mercados USA.',
  keywords: ['trading', 'day trading', 'bolsa', 'inversiones', 'señales', 'portafolio'],
  robots: { index: false, follow: false },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased bg-gray-950 text-gray-100 min-h-screen`}>
        <Providers>
          {children}
          <Toaster
            theme="dark"
            position="top-right"
            toastOptions={{
              style: {
                background: '#111827',
                border: '1px solid #1f2937',
                color: '#f9fafb',
              },
            }}
          />
        </Providers>
      </body>
    </html>
  )
}
