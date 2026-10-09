import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Page } from '@gum-jsx/core'
import { Video, is_video, create_renderer, evaluate_mp4, render_mp4, validate_mp4,
  progress, ease_in_out, lerp } from '../src'

const directories: string[] = []
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'gum-mp4-test-'))
  directories.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function scene() {
  return evaluate_mp4(`<Video
    size={[64, 48]} fps={3} duration={1}
    frame={({ frame }) => (
      <Page width={px(1)} height={px(1)} background={['red', 'lime', 'blue'][frame]} />
    )}
  />`)
}

test('frame timing, fixed viewport, and random access', () => {
  const original = scene()
  const calls: unknown[] = []
  const renderer = create_renderer({ size: original.size, fps: original.fps, duration: 0.8, frame(context) {
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

test('Video snapshots frame lists and preserves exact frame counts', () => {
  const red = new Page({ background: 'red' })
  const blue = new Page({ background: 'blue' })
  const frames = [red, red, red, red, red, red, blue]
  const size: [number, number] = [64, 48]
  const video = new Video({ size, fps: 25, children: frames })
  frames[6] = red
  frames.push(red)
  size[0] = 80

  expect(video.duration).toBe(7 / 25)
  expect(video.frame_count).toBe(7)
  expect(Object.isFrozen(video)).toBe(true)
  expect(Object.isFrozen(video.children)).toBe(true)
  expect(Object.isFrozen(video.size)).toBe(true)
  expect(validate_mp4(video)).toBe(video)
  expect(is_video(video)).toBe(true)
  const renderer = create_renderer(video)
  expect(renderer.frame_count).toBe(7)
  const last = renderer.pixels(6)
  expect([last.width, last.height]).toEqual([64, 48])
  expect([...last.data.slice(0, 4)]).toEqual([0, 0, 255, 255])
  expect([...renderer.pixels(0).data.slice(0, 4)]).toEqual([255, 0, 0, 255])
  expect(() => renderer.pixels(7)).toThrow('frame must')
})

test('Video JSX accepts frame children and leaves generators lazy', () => {
  const video = evaluate_mp4(`<Video size={[64, 48]} fps={2}>
    <Page background="red" />
    <Page background="blue" />
  </Video>`)
  expect(video).toBeInstanceOf(Video)
  expect(video.duration).toBe(1)
  expect([...create_renderer(video).pixels(1).data.slice(0, 4)]).toEqual([0, 0, 255, 255])
  const lazy = evaluate_mp4(`<Video size={[64, 48]} fps={2} duration={1}
    frame={() => { throw new Error('called on demand') }} />`)
  expect(() => create_renderer(lazy).pixels(0)).toThrow('Frame 0 (0s): called on demand')
})

test('Video flattens child arrays and fragments and accepts a single frame', () => {
  const video = evaluate_mp4(`<Video size={[64, 48]} fps={2}>
    {false && <Page />}
    <>
      <Page background="red" />
      {[null, [<Page background="blue" />]]}
    </>
  </Video>`)
  expect(video.frame_count).toBe(2)
  expect(video.duration).toBe(1)
  expect([...create_renderer(video).pixels(1).data.slice(0, 4)]).toEqual([0, 0, 255, 255])
  const single = new Video({ size: [64, 48], fps: 2, children: new Page() })
  expect(single.frame_count).toBe(1)
  expect(single.duration).toBe(0.5)
})

test('Video rejects empty, invalid, and conflicting frame sources', () => {
  for (const props of [
    'children={[]}', 'children={[42]}', 'children={Array(2)}', 'children="invalid"',
    'children={[<Circle />]} duration={1}',
    'children={[<Circle />]} frame={() => <Circle />}',
    'frame={() => <Circle />}', '',
  ]) {
    expect(() => evaluate_mp4(`<Video size={[64, 48]} fps={2} ${props} />`)).toThrow()
  }
})

test('rejects invalid descriptions and frame results', () => {
  for (const invalid of [{ fps: 0 }, { duration: Infinity }, { size: [0, 48] }, { frame: 7 }]) {
    expect(() => validate_mp4({ ...scene(), ...invalid })).toThrow()
  }
  expect(() => create_renderer(evaluate_mp4('return { size:[64,48], fps:3, duration:1, frame: () => 42 }')).pixels(1))
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

test('frame failure preserves existing output and removes temporary files', async () => {
  const path = await directory()
  const output = join(path, 'out.mp4')
  await writeFile(output, 'existing')
  const video = scene()
  await expect(render_mp4({ size: video.size, fps: video.fps, duration: video.duration, frame(context) {
    if (context.frame === 1) throw new Error('test frame failure')
    return video.frame(context)
  } }, output)).rejects.toThrow('test frame failure')
  expect(await readFile(output, 'utf8')).toBe('existing')
  expect(await readdir(path)).toEqual(['out.mp4'])
})

test('progress callback failure cleans partial output', async () => {
  const path = await directory()
  await expect(render_mp4(scene(), join(path, 'out.mp4'), {
    on_progress() { throw new Error('test progress failure') },
  })).rejects.toThrow('test progress failure')
  expect(await readdir(path)).toEqual([])
})

const has_ffmpeg = Boolean(Bun.which('ffmpeg') && Bun.which('ffprobe'))
test.skipIf(!has_ffmpeg)('MP4 has correct timing, dimensions, frame order, and colors', async () => {
  const output = join(await directory(), 'out.mp4')
  const completed: number[] = []
  await render_mp4(scene(), output, { on_progress: count => { completed.push(count) } })
  expect(completed).toEqual([1, 2, 3])
  const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-of', 'json', output])
  expect(probe.exitCode).toBe(0)
  const stream = JSON.parse(probe.stdout.toString()).streams[0]
  expect([stream.codec_name, stream.width, stream.height, stream.nb_read_frames, stream.r_frame_rate, stream.pix_fmt])
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

test('cancellation cleans up without replacing existing output', async () => {
  const path = await directory()
  const output = join(path, 'out.mp4')
  await writeFile(output, 'existing')
  const controller = new AbortController()
  await expect(render_mp4(scene(), output, {
    signal: controller.signal, on_progress: () => controller.abort(),
  })).rejects.toThrow()
  expect(await readFile(output, 'utf8')).toBe('existing')
  expect(await readdir(path)).toEqual(['out.mp4'])
})

test('MP4 sinks receive file-equivalent chunks with backpressure and propagate failures', async () => {
  const output = join(await directory(), 'out.bin')
  const chunks: Uint8Array[] = []
  let writing = false
  await render_mp4(scene(), async bytes => {
    expect(writing).toBe(false)
    writing = true
    await new Promise(resolve => setTimeout(resolve, 1))
    chunks.push(bytes)
    writing = false
  })
  await render_mp4(scene(), output)
  expect(await readFile(output)).toEqual(Buffer.concat(chunks))
  await expect(render_mp4(scene(), () => { throw new Error('sink failure') })).rejects.toThrow('sink failure')
})
