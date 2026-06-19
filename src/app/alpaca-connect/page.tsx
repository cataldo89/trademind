import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, ShieldCheck } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Alpaca Connect Disclosure',
  description: 'TradeMind disclosure shown before connecting an Alpaca account.',
}

export default function AlpacaConnectPage() {
  return (
    <main className="min-h-screen bg-gray-950 text-gray-100">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12">
        <div className="mb-8 inline-flex w-fit items-center gap-2 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-medium text-emerald-300">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Alpaca account authorization
        </div>

        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300">
              TradeMind
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-white md:text-6xl">
              Connect your Alpaca account
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-gray-300 md:text-lg">
              TradeMind uses Alpaca Connect so you can authorize account access before viewing
              portfolio data or placing trades from the platform.
            </p>
          </div>

          <div className="rounded-md border border-gray-800 bg-gray-900/80 p-6 shadow-2xl shadow-black/30">
            <h2 className="text-xl font-semibold text-white">Authorize TradeMind</h2>
            <p className="mt-4 text-sm leading-7 text-gray-300">
              By allowing TradeMind to access your Alpaca account, you are granting TradeMind
              access to your account information and authorization to place transactions in your
              account at your direction. Alpaca does not warrant or guarantee that TradeMind will
              work as advertised or expected. Before authorizing, learn more about TradeMind.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-400 px-4 py-3 text-sm font-semibold text-gray-950 transition hover:bg-emerald-300"
              >
                Continue
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/privacy"
                className="inline-flex items-center justify-center rounded-md border border-gray-700 px-4 py-3 text-sm font-semibold text-gray-200 transition hover:bg-gray-800"
              >
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap gap-4 text-sm text-gray-400">
          <Link href="/terms" className="hover:text-white">
            Terms of Use
          </Link>
          <Link href="/privacy" className="hover:text-white">
            Privacy Policy
          </Link>
        </div>
      </section>
    </main>
  )
}
