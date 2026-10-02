import { mkdtemp, open, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { create_encoder } from './encoder'
import { create_renderer } from './scene'
import type { Video } from './scene'

export type RenderOptions = Readonly<{
  /** H.264 quantizer, 10–51. Lower is higher quality; default 18. */
  qp?: number
  signal?: AbortSignal
  on_progress?: (completed: number, total: number) => void
}>

/** Stream WASM-encoded MP4 fragments to disk; replace the output only on success. */
export async function render_video(video: Video, output: string, options: RenderOptions = {}): Promise<void> {
  const renderer = create_renderer(video)
  if (!output.toLowerCase().endsWith('.mp4')) throw new Error('Video output must end in .mp4')
  options.signal?.throwIfAborted()
  const encoder = create_encoder({ size: renderer.video.size, fps: renderer.video.fps,
    frame_count: renderer.frame_count, qp: options.qp })
  const destination = resolve(output)
  let temporary: string | undefined
  try {
    temporary = await mkdtemp(join(dirname(destination), '.gum-video-'))
    const file = join(temporary, 'video.mp4')
    const handle = await open(file, 'wx')
    try {
      for (let frame = 0; frame < renderer.frame_count; frame++) {
        // Yield between frames so signals and UI progress can run during exports.
        await setImmediate()
        options.signal?.throwIfAborted()
        const bytes = encoder.encode(renderer.pixels(frame).data)
        let offset = 0
        while (offset < bytes.length) {
          options.signal?.throwIfAborted()
          const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset)
          if (!bytesWritten) throw new Error('Could not write encoded video')
          offset += bytesWritten
        }
        options.on_progress?.(frame + 1, renderer.frame_count)
      }
      encoder.finish()
    } finally {
      await handle.close()
    }
    options.signal?.throwIfAborted()
    await rename(file, destination)
  } finally {
    encoder.close()
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}
