import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { QrAssembler, type TransferBundle } from '@/lib/transfer'

/**
 * Camera-based chunk scanner for the central laptop. Reads frames off a
 * <video> into a canvas and runs jsQR over them, feeding every decode into
 * the assembler until a bundle completes.
 */
export function QrScanner({ onBundle }: { onBundle: (b: TransferBundle) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const assembler = useRef(new QrAssembler())
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ have: 0, total: 0 })
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    if (!scanning) return
    let stream: MediaStream | null = null
    let raf = 0
    let cancelled = false

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        tick()
      } catch {
        setError('Could not open the camera. Check browser permissions.')
        setScanning(false)
      }
    }

    function tick() {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        raf = requestAnimationFrame(tick)
        return
      }
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const found = jsQR(image.data, image.width, image.height)
        if (found?.data) {
          // Assembly decompresses on the final chunk, so it resolves async.
          // Keep pulling frames meanwhile rather than stalling the loop.
          assembler.current.accept(found.data)
            .then((bundle) => {
              setProgress(assembler.current.progress)
              if (bundle) { onBundle(bundle); setScanning(false) }
            })
            .catch((e) => setError(e instanceof Error ? e.message : 'Unreadable code'))
        }
      }
      raf = requestAnimationFrame(tick)
    }

    start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [scanning, onBundle])

  return (
    <div className="space-y-3">
      {!scanning ? (
        <button type="button" onClick={() => { setError(''); assembler.current.reset(); setScanning(true) }}
          className="btn-primary w-full">
          Start camera scan
        </button>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
            <video ref={videoRef} playsInline muted className="w-full" />
            <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-peninsula-400/60" />
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setScanning(false)} className="btn-ghost">Stop</button>
            {progress.total > 0 && (
              <span className="text-sm tabular-nums text-slate-400">
                {progress.have} / {progress.total} codes captured
              </span>
            )}
          </div>
        </>
      )}
      <canvas ref={canvasRef} className="hidden" />
      {error && <p className="text-sm text-rose-400">{error}</p>}
    </div>
  )
}
