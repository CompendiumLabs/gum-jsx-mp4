import { wasm_base64 } from './generated/wasm'

export type EncoderOptions = Readonly<{
  size: readonly [number, number]
  fps: number
  frame_count: number
  /** H.264 quantizer, 10–51. Lower is higher quality; default 18. */
  qp?: number
}>

type Wasm = {
  memory: WebAssembly.Memory
  video_init(width: number, height: number, fps: number, frames: number, qp: number): number
  video_input(): number
  video_encode(): number
  video_output(): number
  video_output_len(): number
  video_error(): number
  video_error_len(): number
  video_close(): void
}
let compiled: WebAssembly.Module | undefined
function module(): WebAssembly.Module {
  if (!compiled) {
    const binary = atob(wasm_base64)
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
    compiled = new WebAssembly.Module(bytes)
  }
  return compiled
}

/** Portable RGBA → fragmented MP4 encoder. Each encode() returns owned bytes
 * to append to the output, including the file header on the first frame. */
export function create_encoder({ size, fps, frame_count, qp = 18 }: EncoderOptions) {
  if (!Array.isArray(size) || size.length !== 2 || !Array.from(size).every(n => Number.isInteger(n) && n > 0 && n <= 4096 && n % 2 === 0)
    || size[0] * size[1] > 16_777_216) {
    throw new RangeError('Video dimensions must be even integers from 2 to 4096')
  }
  if (!Number.isFinite(fps) || fps < 0.001 || fps > 1000) throw new RangeError('fps must be in [0.001, 1000]')
  if (!Number.isInteger(frame_count) || frame_count < 1 || frame_count >= 0xffffffff) throw new RangeError('Invalid frame_count')
  if (!Number.isInteger(qp) || qp < 10 || qp > 51) throw new RangeError('qp must be an integer from 10 to 51')
  const [width, height] = size
  let wasm: Wasm | undefined = new WebAssembly.Instance(module()).exports as unknown as Wasm
  function check(status: number): void {
    if (status !== 0) {
      const bytes = new Uint8Array(wasm!.memory.buffer, wasm!.video_error(), wasm!.video_error_len())
      throw new Error(new TextDecoder().decode(bytes))
    }
  }
  function close(): void {
    const instance = wasm
    wasm = undefined
    // A trapped WASM instance may retain a borrowed Rust RefCell. Drop the
    // instance even if explicit cleanup traps; preserve the original error.
    try { instance?.video_close() } catch { /* WebAssembly memory is reclaimed by GC. */ }
  }
  try { check(wasm.video_init(width, height, fps, frame_count, qp)) }
  catch (error) { close(); throw error }
  let completed = 0
  return {
    encode(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
      if (!wasm) throw new Error('Encoder is closed')
      if (completed >= frame_count) throw new Error('All frames have already been encoded')
      if (rgba.byteLength !== width * height * 4) throw new RangeError('RGBA length does not match the video dimensions')
      try {
        new Uint8Array(wasm.memory.buffer, wasm.video_input(), rgba.byteLength).set(rgba)
        check(wasm.video_encode())
        // Encoding can grow memory; reacquire it, then copy before the next frame.
        const output = new Uint8Array(wasm.memory.buffer, wasm.video_output(), wasm.video_output_len()).slice()
        completed++
        return output
      } catch (error) { close(); throw error }
    },
    finish(): void {
      if (!wasm) throw new Error('Encoder is closed')
      const missing = frame_count - completed
      close()
      if (missing) throw new Error(`Video is incomplete: ${missing} frames missing`)
    },
    close,
  }
}
