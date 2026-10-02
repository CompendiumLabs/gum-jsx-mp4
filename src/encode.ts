import { spawn } from 'node:child_process'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { create_renderer } from './scene'
import type { Video } from './scene'

export type RenderOptions = Readonly<{
  ffmpeg?: string
  signal?: AbortSignal
  on_progress?: (completed: number, total: number) => void
}>

/** Stream RGBA frames to an installed FFmpeg; publish the MP4 only after success. */
export async function render_video(video: Video, output: string, options: RenderOptions = {}): Promise<void> {
  const renderer = create_renderer(video)
  const [width, height] = renderer.video.size
  if (width % 2 || height % 2) throw new RangeError('MP4 export requires even width and height')
  if (!output.toLowerCase().endsWith('.mp4')) throw new Error('Video output must end in .mp4')
  options.signal?.throwIfAborted()
  const destination = resolve(output)
  const temporary = await mkdtemp(join(dirname(destination), '.gum-video-'))
  const file = join(temporary, 'video.mp4')
  try {
    const child = spawn(options.ffmpeg ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${width}x${height}`,
      '-framerate', String(renderer.video.fps), '-i', 'pipe:0',
      '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file,
    ], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    let spawn_error: Error | undefined
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192) })
    child.on('error', error => { spawn_error = error })
    const closed = new Promise<number | null>(resolve => child.on('close', resolve))
    const abort = () => { child.kill('SIGKILL') }
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) abort()
    async function* frames() {
      for (let frame = 0; frame < renderer.frame_count; frame++) {
        options.signal?.throwIfAborted()
        const { data } = renderer.pixels(frame)
        // H.264 has no alpha: composite any remaining transparency onto white.
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] === 255) continue
          const alpha = data[i + 3]! / 255
          for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c]! * alpha + 255 * (1 - alpha))
          data[i + 3] = 255
        }
        yield data
        options.on_progress?.(frame + 1, renderer.frame_count)
      }
    }
    try {
      await pipeline(Readable.from(frames()), child.stdin, { signal: options.signal })
      const code = await closed
      if (spawn_error) throw spawn_error
      if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`)
      options.signal?.throwIfAborted()
      await rename(file, destination)
    } catch (cause) {
      child.kill('SIGKILL')
      await closed
      if ((spawn_error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        throw new Error('FFmpeg was not found. Install ffmpeg or pass --ffmpeg /path/to/ffmpeg.', { cause })
      }
      throw new Error(`${cause instanceof Error ? cause.message : cause}${stderr.trim() ? `\n${stderr.trim()}` : ''}`, { cause })
    } finally {
      options.signal?.removeEventListener('abort', abort)
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
