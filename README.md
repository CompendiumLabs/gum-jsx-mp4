# @gum-jsx/mp4

[Gum](https://github.com/CompendiumLabs/gum-jsx) — installation, quickstart, and user documentation.

A video is a Gum figure evaluated at each frame time. This Bun package lays out
frames, rasterizes them through `@gum-jsx/png`, and encodes H.264/MP4 using bundled
WebAssembly. No FFmpeg, native add-on, install script, or Rust toolchain is needed
for ordinary use. This package is a library; use the main `gum` CLI for MP4 output
and frame previews.

## Run the examples

From the workspace root:

```sh
bun install
mkdir -p gum-jsx-mp4/out

# Preview in a terminal supporting Kitty graphics:
bun gum-jsx/src/cli.ts gum-jsx-mp4/examples/orbit.jsx --time 1.5

# Or save a PNG:
bun gum-jsx/src/cli.ts gum-jsx-mp4/examples/orbit.jsx \
  --time 1.5 -o gum-jsx-mp4/out/orbit.png

# Export MP4 entirely within Bun:
bun gum-jsx/src/cli.ts gum-jsx-mp4/examples/orbit.jsx \
  -o gum-jsx-mp4/out/orbit.mp4
```

The example is a twelve-second, 960 × 540 spiral traveling through space at 30 fps.
A fixed perspective camera views the helix from the side and slightly above;
a fading, depth-sorted trail and a floor grid show its shape and forward motion.
Edit `start_x`, `end_x`, `radius`, `pitch`, `speed`, or `eye` in `examples/orbit.jsx`
to change the path or camera. Duration follows the travel distance and speed.
The trail grows from the starting point; each frame is computed directly from time.

`examples/life.jsx` runs Conway's Game of Life on a seeded 72 × 30 grid with
wraparound edges. It shows one generation per frame at 12 fps for sixteen seconds;
newborn and surviving cells have distinct colors. Edit `seed`, `density`, `columns`,
or `rows` to change the world. Generations are precomputed so previews can seek
directly to any frame.

```sh
bun gum-jsx/src/cli.ts gum-jsx-mp4/examples/life.jsx --time 5 \
  -o gum-jsx-mp4/out/life.png
bun gum-jsx/src/cli.ts gum-jsx-mp4/examples/life.jsx \
  -o gum-jsx-mp4/out/life.mp4
```

`--qp 18` sets the H.264 quantizer; valid integers
are 10–51, with lower values giving higher quality and larger files. Default: 18.
This is a fixed quantizer, not FFmpeg/x264's CRF quality scale.

With no `-o`, the main CLI writes Kitty graphics to stdout, including when stdout
is redirected. Use `-o frame.png` to save PNG bytes. Preview and PNG export do not initialize the video encoder.

## Source format

Return a top-level `Video` component from ordinary Gum JSX function-body source,
with no imports or exports. A bare `<Video ... />` is also valid. Core and math
bindings, `Video`, and the timing helpers are in scope. The source is evaluated
once; the frame generator runs on demand for each frame.

```jsx
return <Video
  size={[640, 360]}
  fps={30}
  duration={3}
  background="#ffffff"
  frame={({ time, frame, fps }) => (
    <Box padding={em(1)} font-size={px(36)}>
      <Text>{time.toFixed(2)} seconds</Text>
    </Box>
  )}
/>
```

For prebuilt frames, pass elements as children instead of `frame` and `duration`.
Each child occupies one frame; duration is the child count divided by `fps`.
Arrays and fragments flatten into frames, and conditional children are supported.
The component snapshots the children when constructed.

```jsx
return (
  <Video size={[640, 360]} fps={2}>
    <Svg background="red" />
    <Svg background="blue" />
  </Video>
)
```

- `size` and `fps` are required; the default background is white. Choose either
  nonempty children, or `frame` with `duration` in seconds. Combining them is an error.
- `frame` receives a zero-based integer index, `time = frame / fps` in seconds,
  and `fps`. Return a Gum element synchronously.
- Generator frame count is `ceil(duration * fps)`; lists use their exact length.
  Encoded duration is the frame count divided
  by fps, rounded to microseconds. The exact end time is not sampled. Fractional
  frame rates such as `30000 / 1001` use rounded absolute timestamps to avoid drift.
- `gum --time` selects `floor(time * fps)`; time must be in `[0, duration)`.
- Canvas dimensions override source viewport dimensions. Video dimensions must
  be even integers from 2 to 4096. Encoder fps must be in `[0.001, 1000]`, with
  fewer than 4,294,967,295 frames. PNG previews retain the rasterizer's limits.
- Fix plot limits when axes should remain stationary.
- Frames should depend only on their inputs and precomputed data. Avoid mutable
  counters, wall-clock time, and random calls inside the frame function. Compute
  random geometry once outside it, using `setSeed` for reproducibility.

`Video` describes a timeline and belongs at the top level; its frames are ordinary
Gum layout elements. The original `{ size, fps, duration, frame, background }`
descriptions remain accepted.

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

You can also import `Video` and construct it directly with `new Video({ size, fps,
children: frames })` or `new Video({ size, fps, duration, frame })`. `VideoProps` describes
these two prop forms. `create_renderer` exposes
`frame_count`, `fragment(index)`, `pixels(index)`, and `png(index)`.
`render_mp4` accepts a destination path or a chunk callback as its second argument.
Callback writes are awaited for backpressure; a failed callback may leave a partial
stream. File writes preserve an existing destination on failure. The renderer
always writes MP4 regardless of the path extension. Its options accept `qp`, an AbortSignal `signal`, and
`on_progress(completed, total)` after each frame is encoded and written.

### Portable encoder

Browser hosts can import `Video` and the timing helpers from `@gum-jsx/mp4/video`.
This entry point describes timelines without importing the encoder or filesystem APIs.

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
[third-party notices](THIRD_PARTY_NOTICES.md) for its license.

## Development

```sh
bun run --cwd gum-jsx-mp4 test
bun run --cwd gum-jsx-mp4 typecheck
```

Only decoder-based integration tests require FFmpeg and ffprobe; they are skipped
if either is missing. Export, cleanup, and cancellation tests run without them.
The package is private while its API is being established.

To rebuild the vendored WASM, install Rust with `wasm32-unknown-unknown` standard
libraries and Clang supporting the wasm32 target, then run:

```sh
bun run --cwd gum-jsx-mp4 build:wasm
bun run --cwd gum-jsx-mp4 test:rust
```

The build uses locked, offline Cargo with no third-party Rust crates, plus the
vendored C header. It refreshes the embedded artifact and license notices. Commit
`src/generated/wasm.ts` when changing encoder code; consumers need no compiler.
