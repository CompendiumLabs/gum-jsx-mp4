import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { create_encoder } from '../src/encoder'
import { create_renderer, evaluate_mp4, render_mp4 } from '../src'
import { wasm_base64 } from '../src/generated/wasm'

const directories: string[] = []
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'gum-mp4-encoder-'))
  directories.push(path)
  return path
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
const config = { size: [66, 50] as const, fps: 30, frame_count: 2 }
function pixels(width = 66, height = 50) {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 220; data[i + 1] = 40; data[i + 2] = 80; data[i + 3] = 255
  }
  return data
}

test('portable encoder emits owned chunks, isolates sessions, and enforces its lifecycle', () => {
  const first = create_encoder(config), second = create_encoder(config)
  try {
    const bytes = first.encode(pixels())
    const snapshot = bytes.slice()
    expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe('ftyp')
    expect(second.encode(pixels())).toEqual(bytes)
    const next = first.encode(pixels())
    expect(new TextDecoder().decode(next.subarray(4, 8))).toBe('moof')
    expect(bytes).toEqual(snapshot)
    expect(() => first.encode(pixels())).toThrow('All frames')
    first.finish()
    expect(() => first.encode(pixels())).toThrow('closed')
    expect(() => second.finish()).toThrow('incomplete')
    expect(() => second.encode(pixels())).toThrow('closed')
  } finally { first.close(); second.close() }
})

test('invalid sizes, quality, timing, and RGBA buffers are rejected before encoding', () => {
  for (const invalid of [
    { size: [65, 50] }, { size: [8192, 2] }, { size: [NaN, 50] },
    { fps: 0 }, { fps: Infinity }, { frame_count: 0 }, { frame_count: 2 ** 32 },
    { qp: 0 }, { qp: 18.5 },
  ]) {
    expect(() => create_encoder({ ...config, ...invalid } as typeof config)).toThrow()
  }
  const encoder = create_encoder(config)
  try { expect(() => encoder.encode(new Uint8Array(7))).toThrow('RGBA length') }
  finally { encoder.close() }
})

test('smallest supported frame encodes successfully', () => {
  const encoder = create_encoder({ size: [2, 2], fps: 1, frame_count: 1 })
  try {
    expect(encoder.encode(pixels(2, 2)).length).toBeGreaterThan(0)
    encoder.finish()
  } finally { encoder.close() }
})

test('WASM memory stays bounded while encoding a long sequence', () => {
  const module = new WebAssembly.Module(Buffer.from(wasm_base64, 'base64'))
  expect(WebAssembly.Module.imports(module)).toEqual([])
  const wasm = new WebAssembly.Instance(module).exports as unknown as {
    memory: WebAssembly.Memory
    video_init(w: number, h: number, fps: number, frames: number, qp: number): number
    video_input(): number
    video_encode(): number
    video_close(): void
  }
  expect(wasm.video_init(64, 48, 30, 2000, 18)).toBe(0)
  new Uint8Array(wasm.memory.buffer, wasm.video_input(), 64 * 48 * 4).set(pixels(64, 48))
  let warmed_memory = 0
  try {
    for (let frame = 0; frame < 2000; frame++) {
      if (wasm.video_encode() !== 0) throw new Error(`Encoding failed at frame ${frame}`)
      if (frame === 99) warmed_memory = wasm.memory.buffer.byteLength
    }
    expect(wasm.memory.buffer.byteLength).toBeLessThanOrEqual(warmed_memory + 4 * 65536)
  } finally { wasm.video_close() }
})

test('CLI exports with an empty PATH and no FFmpeg executable', async () => {
  const path = await directory()
  const source = join(path, 'scene.jsx'), output = join(path, 'out.mp4')
  await writeFile(source, 'return { size:[66,50], fps:2, duration:1, frame:() => <Circle fill="red" /> }')
  const result = Bun.spawnSync([process.execPath, join(import.meta.dir, '../src/cli.ts'), 'render', source, '-o', output], {
    env: { ...process.env, PATH: '' },
  })
  expect(result.exitCode).toBe(0)
  expect((await readFile(output)).subarray(4, 8).toString()).toBe('ftyp')
})

test('abort on a later event-loop turn interrupts an export and cleans up', async () => {
  const path = await directory()
  const video = evaluate_mp4('return { size:[64,48], fps:30, duration:100, frame:() => <Circle /> }')
  const controller = new AbortController()
  let frames = 0
  await expect(render_mp4(video, join(path, 'out.mp4'), {
    signal: controller.signal,
    on_progress(count) {
      frames = count
      if (count === 1) setTimeout(() => controller.abort(), 0)
    },
  })).rejects.toThrow()
  expect(frames).toBeLessThan(3000)
  expect(await readdir(path)).toEqual([])
})

test('encoder can be bundled for browsers without Node built-ins', async () => {
  const result = await Bun.build({ entrypoints: [join(import.meta.dir, '../src/encoder.ts')], target: 'browser' })
  expect(result.success).toBe(true)
})

const has_decoder = Boolean(Bun.which('ffmpeg') && Bun.which('ffprobe'))
test.skipIf(!has_decoder)('fractional fps, macroblock cropping, keyframes, and alpha survive a round trip', async () => {
  const path = await directory(), output = join(path, 'fractional.mp4')
  const fps = 30000 / 1001, frame_count = 65
  const encoder = create_encoder({ ...config, fps, frame_count })
  const chunks: Uint8Array[] = []
  const rgba = pixels()
  // All pixels are transparent: encoded output should be white, never black/red.
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 0
  for (let frame = 0; frame < frame_count; frame++) chunks.push(encoder.encode(rgba))
  encoder.finish()
  await writeFile(output, Buffer.concat(chunks))
  const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-count_frames', '-show_streams', '-show_packets', '-of', 'json', output])
  expect(probe.exitCode).toBe(0)
  const { streams: [stream], packets } = JSON.parse(probe.stdout.toString())
  expect([stream.width, stream.height, Number(stream.nb_read_frames)]).toEqual([66, 50, frame_count])
  expect(Number(stream.duration)).toBeCloseTo(frame_count / fps, 5)
  expect(packets.filter((p: { flags: string }) => p.flags.includes('K')).length).toBe(2)
  for (let frame = 0; frame < frame_count; frame++) {
    expect(Number(packets[frame].pts_time)).toBeCloseTo(frame / fps, 5)
    expect(Number(packets[frame].duration_time)).toBeGreaterThan(0)
  }
  const decoded = Bun.spawnSync(['ffmpeg', '-v', 'error', '-i', output, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  expect(decoded.exitCode).toBe(0)
  expect(decoded.stdout.length).toBe(66 * 50 * 3 * frame_count)
  expect(Math.min(...decoded.stdout.subarray(0, 66 * 50 * 3))).toBeGreaterThan(245)
})

test.skipIf(!has_decoder)('moving detailed frames decode with bounded pixel error', async () => {
  const output = join(await directory(), 'detail.mp4')
  const source = await readFile(join(import.meta.dir, 'fixtures/detail.jsx'), 'utf8')
  const video = evaluate_mp4(source)
  await render_mp4(video, output)
  const decoded = Bun.spawnSync(['ffmpeg', '-v', 'error', '-i', output, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
  expect(decoded.exitCode).toBe(0)
  const renderer = create_renderer(video), pixels_per_frame = video.size[0] * video.size[1]
  expect(decoded.stdout.length).toBe(pixels_per_frame * 3 * renderer.frame_count)
  let squared_error = 0
  for (let frame = 0; frame < renderer.frame_count; frame++) {
    const original = renderer.pixels(frame).data
    for (let pixel = 0; pixel < pixels_per_frame; pixel++) {
      for (let channel = 0; channel < 3; channel++) {
        const difference = original[pixel * 4 + channel] - decoded.stdout[(frame * pixels_per_frame + pixel) * 3 + channel]
        squared_error += difference * difference
      }
    }
  }
  const rmse = Math.sqrt(squared_error / decoded.stdout.length)
  expect(rmse).toBeLessThan(12)
})
