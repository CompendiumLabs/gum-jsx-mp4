# @gum-jsx/mp4

A video is a Gum figure evaluated at each frame time. This Bun package lays out
frames, rasterizes them through `@gum-jsx/png`, and encodes H.264/MP4 using bundled
WebAssembly. No FFmpeg, native add-on, install script, or Rust toolchain is needed
for ordinary use. The separate `gum-video` command keeps video out of the core CLI.

## Run the example

From the workspace root:

```sh
bun install
mkdir -p gum-jsx-video/out

# Preview in a terminal supporting Kitty graphics:
bun run --silent --cwd gum-jsx-video gum-video frame examples/orbit.jsx --time 1.5

# Or save a PNG:
bun run --cwd gum-jsx-video gum-video frame examples/orbit.jsx \
  --time 1.5 -o out/orbit.png

# Export MP4 entirely within Bun:
bun run --cwd gum-jsx-video gum-video render examples/orbit.jsx \
  -o out/orbit.mp4
```

The example is a six-second, 960 × 540 orbit at 30 fps. Edit its frame function to
change the animation. `render --qp 18` sets the H.264 quantizer; valid integers
are 10–51, with lower values giving higher quality and larger files. Default: 18.
This is a fixed quantizer, not FFmpeg/x264's CRF quality scale.

With no `-o`, `frame` writes Kitty graphics to stdout using the shared
`@gum-jsx/cli/kitty` formatter, including when stdout is redirected. Use `-o`
to save PNG bytes. Preview and PNG export do not initialize the video encoder.

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
    <Box padding={em(1)} font-size={px(36)}>
      <Text>{time.toFixed(2)} seconds</Text>
    </Box>
  ),
}
```

- `size`, `fps`, `duration`, and `frame` are required; the default background is white.
- `frame` receives a zero-based integer index, `time = frame / fps` in seconds,
  and `fps`. Return a Gum element synchronously.
- Frame count is `ceil(duration * fps)`; encoded duration is that count divided
  by fps, rounded to microseconds. The exact end time is not sampled. Fractional
  frame rates such as `30000 / 1001` use rounded absolute timestamps to avoid drift.
- `frame --time` selects `floor(time * fps)`; time must be in `[0, duration)`.
- Canvas dimensions override source viewport dimensions. Video dimensions must
  be even integers from 2 to 4096. Encoder fps must be in `[0.001, 1000]`, with
  fewer than 4,294,967,295 frames. PNG previews retain the rasterizer's limits.
- Fix plot limits when axes should remain stationary.
- Frames should depend only on their inputs and precomputed data. Avoid mutable
  counters, wall-clock time, and random calls inside the frame function. Compute
  random geometry once outside it, using `setSeed` for reproducibility.

Helpers: `lerp(a, b, progress)`, `progress(time, start, duration)` (clamped), and
`ease_in_out(progress)` (smoothstep). For example:
`lerp(0, 100, ease_in_out(progress(time, 1, 2)))` moves from 0 to 100 over seconds 1–3.

## Library

```ts
import { evaluate_mp4, create_renderer, render_mp4 } from '@gum-jsx/mp4'

const mp4 = evaluate_mp4(await Bun.file('scene.jsx').text(), 'scene.jsx')
await render_mp4(mp4, 'scene.mp4', { qp: 18 })
await Bun.write('frame.png', create_renderer(mp4).png(30))
```

You can also construct a typed `MP4` directly. `create_renderer` exposes
`frame_count`, `fragment(index)`, `pixels(index)`, and `png(index)`.
`render_mp4` accepts `qp`, an AbortSignal `signal`, and
`on_progress(completed, total)` after each frame is encoded and written.

### Portable encoder

`@gum-jsx/mp4/encoder` has no Node imports or filesystem access. It compiles the
embedded WASM lazily, reuses the compiled module, and gives each encoder an
independent instance. This entry point can be bundled for a browser; runtime
validation so far is in Bun. Browser CSP must permit WebAssembly compilation.

```ts
import { create_encoder } from '@gum-jsx/mp4/encoder'

const encoder = create_encoder({ size: [640, 360], fps: 30, frame_count: 90 })
try {
  for (let frame = 0; frame < 90; frame++) {
    const bytes = encoder.encode(rgba_for_frame(frame))
    await write_chunk(bytes)
  }
  encoder.finish()
} finally {
  encoder.close()
}
```

`encode` accepts tightly packed, straight-alpha RGBA (`Uint8Array` or
`Uint8ClampedArray`) and returns owned MP4 bytes. Append each returned chunk in
order. The first contains the file header. `finish` validates the frame count and
releases resources; no extra output chunk is needed. `close` is idempotent and
can abandon an incomplete export. Yield between frames in interactive hosts;
individual frame encoding is synchronous.

## Encoding and scope

The checked-in module combines Rust buffer management, RGBA-to-YUV conversion,
and MP4 writing with a pinned C minih264 codec compiled into the same WASM binary.
There are no WASI or other host imports. It uses scalar software encoding,
YUV420, and a keyframe approximately every two seconds, with no B frames or audio.

Output is **fragmented MP4**: initialization metadata followed by one `moof`/`mdat`
pair per frame. This allows incremental writes with bounded encoder memory and
requires no seeking or in-memory movie buffer. Readers must support fragmented
MP4. Unlike the former FFmpeg output, there is no conventional full-file sample
index; some readers may scan fragments to seek. Decoder tests cover FFmpeg;
other players still need platform testing.

RGB is composited onto white when residual alpha remains, then converted using
limited-range BT.601 YUV420, with color metadata in the MP4. PNG retains alpha
when an explicit transparent background is supplied. Rasterizer restrictions
apply, including unsupported live text and emoji without outlines.

Successful exports replace the destination. Failures and cancellation remove
temporary files and preserve any existing output. Parent directories must exist.
Cancellation is observed between frames and writes. Fonts and layout caches are
reused, and only the current raw and compressed frame buffers are retained.

minih264 is an experimental upstream encoder. See [WASM implementation](docs/WASM.md)
for build details, measurements, and limitations, and
[third-party notices](THIRD_PARTY_NOTICES.md) for its license. The old `--ffmpeg`
option and `RenderOptions.ffmpeg` have been removed.

## Development

```sh
bun run --cwd gum-jsx-video test
bun run --cwd gum-jsx-video typecheck
```

Only decoder-based integration tests require FFmpeg and ffprobe; they are skipped
if either is missing. Export, cleanup, cancellation, and CLI tests run without them.
The package is private while its API is being established.

To rebuild the vendored WASM, install Rust with `wasm32-unknown-unknown` standard
libraries and Clang supporting the wasm32 target, then run:

```sh
bun run --cwd gum-jsx-video build:wasm
bun run --cwd gum-jsx-video test:rust
```

The build uses locked, offline Cargo with no third-party Rust crates, plus the
vendored C header. It refreshes the embedded artifact and license notices. Commit
`src/generated/wasm.ts` when changing encoder code; consumers need no compiler.
