import { Suspense, lazy, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import clsx from 'clsx'
import { getGame } from '@/games'
import { getConfig } from '@/lib/config'
import { loadSettings } from '@/lib/settings'
import { fetchEvent, getTbaKey } from '@/lib/tba'
import MatchScout from '@/features/match/MatchScout'
import PitScout from '@/features/pit/PitScout'
import SuperScout from '@/features/super/SuperScout'
import Settings from '@/features/settings/Settings'

// The scouting forms load eagerly — a scout on venue wifi must never wait
// for a chunk to arrive as the match starts. Analysis (recharts) and data
// transfer (jsQR, qrcode) are lazy: they only ever run on the strategy
// laptop, which has time to fetch them.
const TeamList = lazy(() => import('@/features/analysis/TeamList'))
const TeamPage = lazy(() => import('@/features/analysis/TeamPage'))
const Compare = lazy(() => import('@/features/analysis/Compare'))
const PicklistView = lazy(() => import('@/features/picklist/Picklist'))
const DataHub = lazy(() => import('@/features/data/DataHub'))
const MatchReview = lazy(() => import('@/features/video/MatchReview'))

const NAV = [
  { to: '/match', label: 'Match' },
  { to: '/pit', label: 'Pit' },
  { to: '/super', label: 'Super' },
  { to: '/analysis', label: 'Analysis' },
  { to: '/review', label: 'Review' },
  { to: '/compare', label: 'Compare' },
  { to: '/picklist', label: 'Picklist' },
  { to: '/data', label: 'Data' },
  { to: '/settings', label: 'Settings' },
]

export default function App() {
  const [settings, setSettings] = useState(loadSettings)
  const [online, setOnline] = useState(navigator.onLine)
  const game = getGame(settings.gameId)

  // Refresh the cached event once on launch when there is a network. Match
  // results and newly posted videos land without anyone remembering to sync.
  useEffect(() => {
    if (!getConfig().autoSyncOnLaunch) return
    if (!navigator.onLine || !settings.eventKey || !getTbaKey()) return
    fetchEvent(settings.eventKey).catch(() => {
      // Offline or a bad key: the cached copy stays usable, so stay quiet.
    })
  }, [settings.eventKey])

  useEffect(() => {
    const reload = () => setSettings(loadSettings())
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('settings-changed', reload)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('settings-changed', reload)
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-deck-500 bg-deck-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-5 px-3 py-1.5">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display text-[22px] font-700 leading-none text-chalk">6036</span>
            <span className="hidden font-display text-[13px] font-500 leading-none text-chalk-faint sm:inline">
              Scouting
            </span>
          </div>

          <nav className="flex flex-1 gap-px overflow-x-auto">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to}
                className={({ isActive }) => clsx(
                  'whitespace-nowrap px-2.5 py-1 font-display text-[15px] font-600 leading-none transition',
                  'border-b-2',
                  isActive
                    ? 'border-signal text-chalk'
                    : 'border-transparent text-chalk-faint hover:text-chalk-dim',
                )}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-3 text-[12px] md:flex">
            <span className="text-chalk-faint">{game.year} {game.name}</span>
            {settings.eventKey && (
              <span className="rounded-panel border border-deck-500 px-1.5 py-0.5 text-chalk-dim">
                {settings.eventKey}
              </span>
            )}
            <span
              title={online ? 'Online' : 'Offline — everything is saved on this device'}
              className={clsx('h-1.5 w-1.5 rounded-full',
                online ? 'bg-emerald-400' : 'bg-signal')} />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Suspense fallback={
          <div className="p-10 text-center text-[14px] text-chalk-faint">Loading…</div>
        }>
        <Routes>
          <Route path="/" element={<Navigate to="/match" replace />} />
          <Route path="/match" element={<MatchScout />} />
          <Route path="/pit" element={<PitScout />} />
          <Route path="/super" element={<SuperScout />} />
          <Route path="/analysis" element={<TeamList />} />
          <Route path="/analysis/:teamNumber" element={<TeamPage />} />
          <Route path="/review" element={<MatchReview />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/picklist" element={<PicklistView />} />
          <Route path="/data" element={<DataHub />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/match" replace />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  )
}
