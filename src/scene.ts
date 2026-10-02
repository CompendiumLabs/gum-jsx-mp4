import { Element, Evaluator, LayoutPass, exact, layout_element, make_request, px } from '@gum-jsx/core'
import * as math from '@gum-jsx/math'
import { render_pixels, render_png } from '@gum-jsx/png'
import * as timing from './timing'

export type FrameContext = Readonly<{ time: number; frame: number; fps: number }>
export type Video = Readonly<{
  size: readonly [number, number]
  fps: number
  duration: number
  background?: string
  frame: (context: FrameContext) => Element
}>

export function validate_video(value: unknown): Video {
  if (!value || typeof value !== 'object') throw new TypeError('Source must return a video object')
  const video = value as Video
  if (!Array.isArray(video.size) || video.size.length !== 2
    || video.size.some(n => !Number.isSafeInteger(n) || n <= 0)
    || video.size[0] * video.size[1] > 16_777_216) {
    throw new RangeError('size must contain two positive integer dimensions, at most 16,777,216 pixels')
  }
  if (!Number.isFinite(video.fps) || video.fps <= 0) throw new RangeError('fps must be positive and finite')
  if (!Number.isFinite(video.duration) || video.duration <= 0) throw new RangeError('duration must be positive and finite')
  const count = Math.ceil(video.duration * video.fps)
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('Invalid frame count')
  if (typeof video.frame !== 'function') throw new TypeError('video.frame must be a function returning a Gum element')
  if (video.background !== undefined && typeof video.background !== 'string') throw new TypeError('background must be a color string')
  return Object.freeze({ ...video, size: Object.freeze([...video.size]) as readonly [number, number] })
}

/** Evaluate Gum function-body source once; its result is the video description. */
export function evaluate_video(source: string, name = 'video.jsx'): Video {
  return validate_video(new Evaluator({ scope: { ...math, ...timing }, name }).evaluate(source))
}

/** Reuse fonts and layout caches while rendering independently addressable frames. */
export function create_renderer(value: Video) {
  const video = validate_video(value)
  const [width, height] = video.size
  const pass = new LayoutPass()
  const fonts = math.createMathFonts()
  const frame_count = Math.ceil(video.duration * video.fps)
  function fragment(frame: number) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= frame_count) {
      throw new RangeError(`frame must be an integer from 0 to ${frame_count - 1}`)
    }
    try {
      const element = video.frame({ time: frame / video.fps, frame, fps: video.fps })
      if (!(element instanceof Element)) throw new TypeError('video.frame must return a Gum element')
      return layout_element(element, {
        pass, fonts, text_mode: 'path',
        request: make_request({ width: exact(width), height: exact(height) }),
        overrides: { width: px(width), height: px(height) },
      }).fragment
    } catch (cause) {
      throw new Error(`Frame ${frame} (${frame / video.fps}s): ${cause instanceof Error ? cause.message : cause}`, { cause })
    }
  }
  const background = video.background ?? '#ffffff'
  return { video, frame_count, fragment,
    pixels: (frame: number) => render_pixels(fragment(frame), { background }),
    png: (frame: number) => render_png(fragment(frame), { background }),
  }
}
