/**
 * YouTube IFrame Player API loader.
 *
 * A plain <iframe> embed can't be paused, seeked or queried from the page —
 * which is exactly what marking moments in a match requires. This loads
 * YouTube's player API once and hands back a controllable player.
 */

declare global {
  interface Window {
    YT?: any
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<any> | null = null

/** Loads the IFrame API once per page and resolves with `window.YT`. */
export function loadYouTubeApi(): Promise<any> {
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) return resolve(window.YT)

    const timeout = setTimeout(
      () => reject(new Error('YouTube player failed to load. Check the network.')),
      15000,
    )

    // The API calls this global exactly once when it is ready.
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      clearTimeout(timeout)
      resolve(window.YT)
    }

    if (!document.querySelector('script[data-yt-api]')) {
      const script = document.createElement('script')
      script.src = 'https://www.youtube.com/iframe_api'
      script.async = true
      script.dataset.ytApi = '1'
      script.onerror = () => { clearTimeout(timeout); reject(new Error('Could not reach YouTube.')) }
      document.head.appendChild(script)
    }
  })

  return apiPromise
}

/** mm:ss for a number of seconds. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
