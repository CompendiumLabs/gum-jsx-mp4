import { element_children } from '@gum-jsx/core'
import type { Child, Element } from '@gum-jsx/core'

type FrameContext = Readonly<{ time: number; frame: number; fps: number }>
type FrameGenerator = (context: FrameContext) => Element
type VideoProps = Readonly<{
  size: readonly [number, number]
  fps: number
  background?: string
}> & Readonly<
  | { children: Child; frame?: never; duration?: never }
  | { frame: FrameGenerator; duration: number; children?: never }
>

// A top-level JSX component describes a timeline; its frames are layout elements.
class Video {
  readonly size: readonly [number, number]
  readonly fps: number
  readonly duration: number
  readonly background?: string
  readonly children?: readonly Element[]
  readonly frame: FrameGenerator

  // Snapshot frame lists without evaluating generators or laying out any frames.
  constructor(props: VideoProps) {
    const { size, fps, background, children, frame, duration } = props
    if (!Array.isArray(size) || size.length !== 2
      || !Array.from(size).every(n => Number.isSafeInteger(n) && n > 0)
      || size[0] * size[1] > 16_777_216) {
      throw new RangeError('size must contain two positive integer dimensions, at most 16,777,216 pixels')
    }
    if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('fps must be positive and finite')
    if (background !== undefined && typeof background !== 'string') {
      throw new TypeError('background must be a color string')
    }

    // A list has exactly one element per frame, so fps determines its duration.
    if (children !== undefined) {
      if (frame !== undefined || duration !== undefined) {
        throw new TypeError('Video accepts either children or frame with duration')
      }
      const frames = element_children(children)
      if (!frames.length) throw new TypeError('Video requires at least one frame child')
      this.children = frames
      this.duration = frames.length / fps
      this.frame = ({ frame }) => frames[frame]
    } else {
      if (typeof frame !== 'function') {
        throw new TypeError('Video.frame must be a function returning a Gum element')
      }
      this.duration = duration!
      this.frame = frame
    }

    // Validate timing before any encoder or output file is opened.
    this.size = Object.freeze([...size]) as readonly [number, number]
    this.fps = fps
    this.background = background
    if (!Number.isFinite(this.duration) || this.duration <= 0) {
      throw new RangeError('duration must be positive and finite')
    }
    if (!Number.isSafeInteger(this.frame_count) || this.frame_count < 1) {
      throw new RangeError('Invalid frame count')
    }
    Object.freeze(this)
  }

  // Keep list lengths exact, including at fractional frame rates.
  get frame_count(): number {
    return this.children?.length ?? Math.ceil(this.duration * this.fps)
  }
}

// Recognize components and the original generator-based descriptions.
function is_video(value: unknown): value is Video | VideoProps {
  return value instanceof Video || (value !== null && typeof value === 'object'
    && typeof (value as VideoProps).frame === 'function')
}

// Normalize library inputs while retaining already validated component identities.
function validate_mp4(value: unknown): Video {
  if (value instanceof Video) return value
  if (!value || typeof value !== 'object') throw new TypeError('Source must return a Video component')
  return new Video(value as VideoProps)
}

export { Video, is_video, validate_mp4 }
export { lerp, progress, ease_in_out } from './timing'
export type { VideoProps, FrameContext, FrameGenerator }
