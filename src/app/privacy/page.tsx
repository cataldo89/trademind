import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'TradeMind privacy policy.',
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-950 px-6 py-16 text-gray-100">
      <article className="mx-auto max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">
          TradeMind
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-white">Privacy Policy</h1>
        <p className="mt-6 text-gray-300">
          TradeMind collects account, authentication, portfolio, watchlist, alert, and trading
          workflow information needed to operate the platform. If you connect Alpaca, TradeMind may
          receive account information and order-related data authorized by you through Alpaca
          Connect.
        </p>
        <p className="mt-4 text-gray-300">
          We use this information to provide the service, secure user sessions, display portfolio
          and market information, process user-directed trading actions, and improve reliability.
          We do not sell personal information.
        </p>
        <p className="mt-4 text-gray-300">
          You may disconnect third-party account access, stop using the service, or request account
          data deletion by contacting TradeMind support through the application.
        </p>
      </article>
    </main>
  )
}
