import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create_renderer, evaluate_video, render_video, validate_video, progress, ease_in_out, lerp } from '../src'

const directories: string[] = []
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'gum-video-test-'))
  directories.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function scene() {
  return evaluate_video(`return {
    size: [64, 48], fps: 3, duration: 1,
    frame: ({ frame }) => <Svg width={px(1)} height={px(1)} background={['red', 'lime', 'blue'][frame]} />,
  }`)
}

test('frame timing, fixed viewport, and random access', () => {
  const original = scene()
  const calls: unknown[] = []
  const renderer = create_renderer({ ...original, duration: 0.8, frame(context) {
    calls.push(context)
    return original.frame(context)
  } })
  expect(renderer.frame_count).toBe(3)
  const blue = renderer.pixels(2)
  expect([blue.width, blue.height]).toEqual([64, 48])
  expect([...blue.data.slice(0, 4)]).toEqual([0, 0, 255, 255])
  expect([...renderer.pixels(0).data.slice(0, 4)]).toEqual([255, 0, 0, 255])
  expect(renderer.pixels(2).data).toEqual(blue.data)
  expect(calls).toEqual([
    { time: 2 / 3, frame: 2, fps: 3 },
    { time: 0, frame: 0, fps: 3 },
    { time: 2 / 3, frame: 2, fps: 3 },
  ])
  expect(() => renderer.pixels(3)).toThrow('frame must')
})

test('rejects invalid descriptions and frame results', () => {
  for (const invalid of [{ fps: 0 }, { duration: Infinity }, { size: [0, 48] }, { frame: 7 }]) {
    expect(() => validate_video({ ...scene(), ...invalid })).toThrow()
  }
  expect(() => create_renderer(evaluate_video('return { size:[64,48], fps:3, duration:1, frame: () => 42 }')).pixels(1))
    .toThrow('Frame 1')
})

test('timing helpers clamp intervals and interpolate', () => {
  expect(progress(0, 1, 2)).toBe(0)
  expect(progress(2, 1, 2)).toBe(0.5)
  expect(progress(4, 1, 2)).toBe(1)
  expect(lerp(10, 20, ease_in_out(0.5))).toBe(15)
  expect(() => progress(1, 0, 0)).toThrow()
})

test('PNG works without FFmpeg', () => {
  const png = create_renderer(scene()).png(0)
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
})

test('missing encoder preserves existing output and removes temporary files', async () => {
  const path = await directory()
  const output = join(path, 'out.mp4')
  await writeFile(output, 'existing')
  await expect(render_video(scene(), output, { ffmpeg: join(path, 'missing-ffmpeg') })).rejects.toThrow('FFmpeg was not found')
  expect(await readFile(output, 'utf8')).toBe('existing')
  expect(await readdir(path)).toEqual(['out.mp4'])
})

test('reports encoder errors and cleans partial output', async () => {
  const path = await directory()
  const encoder = join(path, 'fail')
  await writeFile(encoder, '#!/bin/sh\ncat >/dev/null\necho "test encoder failure" >&2\nexit 9\n', { mode: 0o755 })
  await expect(render_video(scene(), join(path, 'out.mp4'), { ffmpeg: encoder })).rejects.toThrow('test encoder failure')
  expect(await readdir(path)).toEqual(['fail'])
})

const has_ffmpeg = Boolean(Bun.which('ffmpeg') && Bun.which('ffprobe'))
test.skipIf(!has_ffmpeg)('MP4 has correct timing, dimensions, frame order, and colors', async () => {
  const output = join(await directory(), 'out.mp4')
  const completed: number[] = []
  await render_video(scene(), output, { on_progress: count => { completed.push(count) } })
  expect(completed).toEqual([1, 2, 3])
  const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', output])
  expect(probe.exitCode).toBe(0)
  const stream = JSON.parse(probe.stdout.toString()).streams[0]
  expect([stream.codec_name, stream.width, stream.height, stream.nb_frames, stream.r_frame_rate, stream.pix_fmt])
    .toEqual(['h264', 64, 48, '3', '3/1', 'yuv420p'])
  expect(Number(stream.duration)).toBeCloseTo(1)
  const decoded = Bun.spawnSync(['ffmpeg', '-v', 'error', '-i', output, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  expect(decoded.exitCode).toBe(0)
  expect(decoded.stdout.length).toBe(64 * 48 * 3 * 3)
  for (let frame = 0; frame < 3; frame++) {
    const pixel = decoded.stdout.subarray(frame * 64 * 48 * 3, frame * 64 * 48 * 3 + 3)
    expect(pixel[frame]).toBeGreaterThan(240)
    for (let channel = 0; channel < 3; channel++) if (channel !== frame) expect(pixel[channel]).toBeLessThan(15)
  }
})

test.skipIf(!has_ffmpeg)('cancellation cleans up without replacing existing output', async () => {
  const path = await directory()
  const output = join(path, 'out.mp4')
  await writeFile(output, 'existing')
  const controller = new AbortController()
  await expect(render_video(scene(), output, {
    signal: controller.signal, on_progress: () => controller.abort(),
  })).rejects.toThrow()
  expect(await readFile(output, 'utf8')).toBe('existing')
  expect(await readdir(path)).toEqual(['out.mp4'])
})
