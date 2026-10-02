export function lerp(a: number, b: number, progress: number): number {
  return a + (b - a) * progress
}

/** Progress over a time interval, held at 0 before it and 1 after it. */
export function progress(time: number, start: number, duration: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) {
    throw new RangeError('progress requires finite times and a positive duration')
  }
  return Math.max(0, Math.min(1, (time - start) / duration))
}

/** Smoothstep easing for progress in [0, 1]. */
export function ease_in_out(progress: number): number {
  const t = Math.max(0, Math.min(1, progress))
  return t * t * (3 - 2 * t)
}
