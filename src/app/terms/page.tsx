import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Use',
  description: 'TradeMind terms of use.',
}

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gray-950 px-6 py-16 text-gray-100">
      <article className="mx-auto max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">
          TradeMind
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-white">Terms of Use</h1>
        <p className="mt-6 text-gray-300">
          TradeMind provides market analysis, portfolio tools, alerts, and trading workflows for
          informational and execution-support purposes. By using TradeMind, you are responsible for
          your own investment decisions and for reviewing any order before it is submitted.
        </p>
        <p className="mt-4 text-gray-300">
          TradeMind does not provide financial, legal, tax, or investment advice. Market data,
          signals, forecasts, and AI-generated analysis may be incomplete, delayed, or inaccurate.
          Past performance does not guarantee future results.
        </p>
        <p className="mt-4 text-gray-300">
          When you connect an Alpaca account, you authorize TradeMind to access account information
          and place transactions only at your direction. You may revoke connected-account access
          through Alpaca or your TradeMind account settings.
        </p>
      </article>
    </main>
  )
}
