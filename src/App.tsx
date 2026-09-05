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
      <header className="sticky top-0 z-40 border-b border-white/10 bg-surface-0/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-lg font-extrabold text-peninsula-400">6036</span>
            <span className="hidden text-xs font-semibold uppercase tracking-wider text-slate-500 sm:inline">
              Scouting
            </span>
          </div>

          <nav className="flex flex-1 gap-0.5 overflow-x-auto">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to}
                className={({ isActive }) => clsx(
                  'whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition',
                  isActive ? 'bg-peninsula-600/20 text-peninsula-300' : 'text-slate-500 hover:bg-white/5 hover:text-slate-300',
                )}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-3 text-xs md:flex">
            <span className="text-slate-600">{game.year} {game.name}</span>
            {settings.eventKey && (
              <span className="rounded bg-white/5 px-2 py-0.5 font-mono text-slate-400">
                {settings.eventKey}
              </span>
            )}
            <span className={clsx('h-2 w-2 rounded-full', online ? 'bg-emerald-500' : 'bg-slate-600')}
              title={online ? 'Online' : 'Offline — data is saved locally'} />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Suspense fallback={<div className="p-8 text-center text-sm text-slate-600">Loading…</div>}>
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
