'use client'

import { getAllMarketStatus, getMarketCurrentTime } from '@/lib/market-schedule'
import { cn } from '@/lib/utils'
import { Calendar, Clock } from 'lucide-react'
import { useEffect, useState } from 'react'

export function MarketCalendarWidget() {
  const [statuses, setStatuses] = useState(() => getAllMarketStatus())
  const [currentTime, setCurrentTime] = useState({
    US: getMarketCurrentTime('US'),
  })

  useEffect(() => {
    const interval = setInterval(() => {
      setStatuses(getAllMarketStatus())
      setCurrentTime({
        US: getMarketCurrentTime('US'),
      })
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  const markets = [
    {
      key: 'US' as const,
      label: 'NYSE / NASDAQ',
      flag: '🇺🇸',
      hours: '09:30 – 16:00 ET',
      timezone: 'ET (New York)',
    },
  ]

  const sessionColors = {
    regular: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    pre: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    after: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    closed: 'text-gray-500 bg-gray-800 border-gray-700',
  }

  const sessionLabel = {
    regular: 'Abierto',
    pre: 'Pre-Mercado',
    after: 'Post-Mercado',
    closed: 'Cerrado',
  }

  return (
    <div className="glass rounded-xl overflow-hidden h-full">
      <div className="px-5 py-4 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Calendar className="w-4 h-4 text-emerald-400" />
          Estado del mercado
        </h2>
      </div>

      <div className="p-4 space-y-3">
        {markets.map((m) => {
          const status = statuses[m.key]
          const colorClass = sessionColors[status.session]

          return (
            <div key={m.key} className="p-4 rounded-lg border border-gray-800 bg-gray-800/30">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{m.flag}</span>
                  <div>
                    <p className="text-xs font-semibold text-white">{m.label}</p>
                    <p className="text-xs text-gray-500">{m.timezone}</p>
                  </div>
                </div>
                <span className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', colorClass)}>
                  {sessionLabel[status.session]}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {m.hours}
                </span>
                <span className="font-mono text-gray-400">{currentTime[m.key]}</span>
              </div>

              {status.session === 'closed' && status.nextOpen && (
                <p className="text-xs text-gray-600 mt-2">
                  Próxima apertura: {new Date(status.nextOpen).toLocaleDateString('es', {
                    weekday: 'short', month: 'short', day: 'numeric',
                  })}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
