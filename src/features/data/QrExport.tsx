import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type { QrChunk, TransferBundle } from '@/lib/transfer'
import { chunkForQr } from '@/lib/transfer'

/**
 * Cycles through the bundle's QR chunks on a timer. The scanning laptop
 * collects them in any order and stops when it has them all, so the scout
 * just holds the screen up until the other side says done.
 */
export function QrExport({ bundle }: { bundle: TransferBundle }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [chunks, setChunks] = useState<QrChunk[]>([])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(700)

  // Chunking gzips the payload, so it is async.
  useEffect(() => {
    let stale = false
    chunkForQr(bundle).then((c) => { if (!stale) { setChunks(c); setIndex(0) } })
    return () => { stale = true }
  }, [bundle])

  useEffect(() => {
    if (!playing || chunks.length <= 1) return
    const id = setInterval(() => setIndex((i) => (i + 1) % chunks.length), speed)
    return () => clearInterval(id)
  }, [playing, chunks.length, speed])

  useEffect(() => {
    if (!canvasRef.current || !chunks[index]) return
    QRCode.toCanvas(canvasRef.current, JSON.stringify(chunks[index]), {
      width: 380,
      margin: 2,
      errorCorrectionLevel: 'L', // lowest ECC = most payload per code
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => {})
  }, [index, chunks])

  if (!chunks.length) {
    return <p className="py-8 text-center text-sm text-chalk-faint">Packing data…</p>
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="rounded-panel bg-white p-3">
        <canvas ref={canvasRef} />
      </div>

      <div className="flex items-center gap-3 text-sm">
        <span className="font-mono tabular-nums text-chalk-dim">
          {index + 1} / {chunks.length}
        </span>
        {chunks.length > 1 && (
          <>
            <button type="button" onClick={() => setPlaying((p) => !p)} className="btn-ghost py-1">
              {playing ? 'Pause' : 'Play'}
            </button>
            <select className="input w-auto py-1 text-xs" value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={400}>Fast</option>
              <option value={700}>Normal</option>
              <option value={1200}>Slow</option>
            </select>
          </>
        )}
      </div>

      <p className="max-w-sm text-center text-xs text-chalk-faint">
        {chunks.length > 1
          ? `This export is split across ${chunks.length} codes. Let it loop at least once while the other device scans.`
          : 'Hold this up to the scanning device.'}
      </p>
    </div>
  )
}
