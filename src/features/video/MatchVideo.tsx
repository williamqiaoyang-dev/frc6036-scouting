import { useState } from 'react'
import type { CachedMatch } from '@/lib/schema'
import { videoEmbedUrl, videoWatchUrl } from '@/lib/tba'
import { Empty } from '@/components/ui'

/**
 * Embedded match footage from The Blue Alliance.
 *
 * Loaded click-to-play rather than eagerly: a review page can list a dozen
 * matches, and mounting a dozen YouTube iframes would hammer both the
 * network and the venue's bandwidth. The thumbnail is served straight from
 * YouTube's image CDN, which is far cheaper than the player.
 */
export function MatchVideo({ match, label }: { match: CachedMatch; label?: string }) {
  const [playing, setPlaying] = useState(false)
  const video = match.videos[0]

  if (!video) {
    return (
      <div className="rounded-panel border border-dashed border-deck-500 p-6 text-center">
        <p className="text-sm text-chalk-dim">No video posted yet</p>
        <p className="mt-1 text-xs text-chalk-faint">
          Footage appears here once someone uploads it to The Blue Alliance.
        </p>
      </div>
    )
  }

  const embed = videoEmbedUrl(video)
  const watch = videoWatchUrl(video)

  // Non-YouTube media has no embed endpoint — link out instead.
  if (!embed) {
    return (
      <a href={watch} target="_blank" rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-panel border border-deck-500 bg-deck-800 p-6 text-sm font-semibold text-chalk hover:bg-deck-600">
        Watch on The Blue Alliance ↗
      </a>
    )
  }

  const id = video.key.split('?')[0]

  return (
    <div className="overflow-hidden rounded-panel border border-deck-500 bg-black">
      <div className="relative aspect-video">
        {playing ? (
          <iframe
            src={`${embed}&autoplay=1`}
            title={label ?? `Match ${match.matchNumber} video`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)}
            className="group absolute inset-0 h-full w-full">
            <img
              src={`https://i.ytimg.com/vi/${id}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover opacity-70 transition group-hover:opacity-90"
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-xl text-white ring-2 ring-white/30 transition group-hover:scale-110 group-hover:bg-signal/15">
                ▶
              </span>
            </span>
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <span className="truncate text-xs text-chalk-dim">
          {label ?? `Match ${match.matchNumber}`}
          {match.videos.length > 1 && (
            <span className="ml-2 text-chalk-faint">+{match.videos.length - 1} more</span>
          )}
        </span>
        <a href={watch} target="_blank" rel="noreferrer"
          className="shrink-0 text-xs text-chalk-faint hover:text-chalk">
          YouTube ↗
        </a>
      </div>
    </div>
  )
}
