import { Element, Evaluator, LayoutPass, exact, layout_element, make_request, px } from '@gum-jsx/core'
import * as math from '@gum-jsx/math'
import { render_pixels, render_png } from '@gum-jsx/png'
import * as timing from './timing'
import { Video, validate_mp4 } from './video'
import type { VideoProps } from './video'

/** Evaluate Gum function-body source once; its result is the video description. */
export function evaluate_mp4(source: string, name = 'video.jsx'): Video {
  return validate_mp4(new Evaluator({ scope: { ...math, ...timing, Video }, name }).evaluate(source))
}

/** Reuse fonts and layout caches while rendering independently addressable frames. */
export function create_renderer(value: Video | VideoProps) {
  const video = validate_mp4(value)
  const [width, height] = video.size
  const pass = new LayoutPass()
  const fonts = math.createMathFonts()
  const { frame_count } = video
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
