# @gum-jsx/video

A video is a Gum figure evaluated at each frame time. This Bun package lays out
each frame, rasterizes it through `@gum-jsx/png`, and streams RGBA to an installed
FFmpeg. It has its own `gum-video` CLI and adds no dependencies to `@gum-jsx/cli`.

## Run the example

Requires Bun and FFmpeg with the `libx264` encoder. From the workspace root:

```sh
bun install
mkdir -p gum-jsx-video/out

# Preview directly in a terminal supporting Kitty graphics:
bun run --silent --cwd gum-jsx-video gum-video frame examples/orbit.jsx --time 1.5

# Or save a PNG:
bun run --cwd gum-jsx-video gum-video frame examples/orbit.jsx \
  --time 1.5 -o out/orbit.png

bun run --cwd gum-jsx-video gum-video render examples/orbit.jsx \
  -o out/orbit.mp4
```

The example is a six-second, 960 × 540 orbit at 30 fps. Edit its frame function to
change the animation. PNG export does not require FFmpeg. Use `--ffmpeg <path>`
with `render` if the executable is outside PATH.

With no `-o`, `frame` writes Kitty graphics to stdout using the shared
`@gum-jsx/cli/kitty` formatter. This also works when stdout is redirected;
the output is terminal graphics commands, not a PNG file. Both preview modes
render the same frame and need no FFmpeg.

## Source format

Use ordinary Gum JSX function-body source, with an explicit `return` and no
imports or exports. Core and math bindings plus the timing helpers are in scope.
The source is evaluated once; the returned frame function runs for each frame.

```jsx
return {
  size: [640, 360],
  fps: 30,
  duration: 3,
  background: '#ffffff',
  frame: ({ time, frame, fps }) => (
    <Box padding={px(32)}>
      <Text font-size={px(36)}>
        {time.toFixed(2)} seconds
      </Text>
    </Box>
  ),
}
```

- `size`, `fps`, `duration`, and `frame` are required; the default background is white.
- `frame` receives a zero-based integer index, `time = frame / fps` in seconds,
  and `fps`. Return a Gum element synchronously.
- Frame count is `ceil(duration * fps)`; encoded duration is that count divided
  by fps. The exact end time is not sampled.
- `frame --time` selects `floor(time * fps)`; time must be in `[0, duration)`.
- Canvas dimensions override source viewport dimensions. MP4 requires even
  dimensions. Fix plot limits when axes should remain stationary.
- Frames should depend only on their inputs and precomputed data. Avoid mutable
  counters, wall-clock time, and random calls inside the frame function. Compute
  random geometry once outside it, using `setSeed` for reproducibility.

Helpers: `lerp(a, b, progress)`, `progress(time, start, duration)` (clamped), and
`ease_in_out(progress)` (smoothstep). For example:
`lerp(0, 100, ease_in_out(progress(time, 1, 2)))` moves from 0 to 100 over seconds 1–3.

## Library

```ts
import { evaluate_video, create_renderer, render_video } from '@gum-jsx/video'

const video = evaluate_video(await Bun.file('scene.jsx').text(), 'scene.jsx')
await render_video(video, 'scene.mp4')
await Bun.write('frame.png', create_renderer(video).png(30))
```

You can also construct a typed `Video` directly. `create_renderer` exposes
`frame_count`, `fragment(index)`, `pixels(index)`, and `png(index)`.
`render_video` accepts `ffmpeg`, an AbortSignal `signal`, and
`on_progress(completed, total)` (frames submitted, before encoding finishes).

## Scope

MP4/H.264 with yuv420p, CRF 18, and fast-start metadata; no audio or clip timeline.
MP4 composites residual transparency onto white; PNG retains alpha when an
explicit transparent background is supplied. Rasterizer restrictions apply,
including unsupported live text and emoji without outlines.

Frames stream with backpressure. Fonts and layout caches are reused. Successful
exports replace the destination; failures and cancellation remove temporary
files and preserve any existing output. Output parent directories must exist.

## Development

```sh
bun run --cwd gum-jsx-video test
bun run --cwd gum-jsx-video typecheck
```

The MP4 round-trip tests require FFmpeg and ffprobe and are skipped if either is
missing. The package is private while its API is being established.
