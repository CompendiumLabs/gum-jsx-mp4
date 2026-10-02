# WASM video backend

## Architecture

```
Gum element → Fragment → RGBA → Rust/YUV420 → minih264 → Rust/MP4 → file
```

`wasm/src/lib.rs` owns a frame buffer, YUV planes, codec persistent/scratch memory,
and the current encoded output. The C shim in `wasm/codec.c` passes those buffers
to an unmodified, pinned minih264 header. Rust allocations for codec state are
16-byte aligned. The upstream codec handles edge padding and SPS cropping for
even dimensions that are not multiples of 16.

`wasm/src/mp4.rs` converts Annex B NAL start codes to MP4 length prefixes, extracts
SPS/PPS into `avcC`, and emits a one-track fragmented MP4. DTS equals PTS because
this encoder uses I/P frames, with an IDR approximately every two seconds.
Timestamps are rounded independently onto a 1,000,000 Hz clock. The initial
metadata carries the known total duration. Each subsequent `moof`/`mdat` pair
contains one frame, its timing, and its dependency flags. There is no accumulated
sample table or output file in WASM memory.

`src/encoder.ts` caches the compiled module, creates one instance per session,
and copies each output chunk before exposing it to callers. `src/encode.ts`
awaits writes before encoding another frame, yields between frames for signals,
and renames a sibling temporary file only after completion. The portable encoder
entry point has no filesystem, subprocess, or Node dependencies.

## Build

The checked-in artifact was built with Rust 1.98.1 and Clang 22.1.8 on Linux x64.
The build needs the Rust `wasm32-unknown-unknown` target and Clang's wasm32 backend.
It does not need Emscripten, WASI, an archiver, or third-party Cargo dependencies.
The tiny headers in `wasm/include` provide the C codec's only required declarations;
Rust's compiler runtime supplies memory primitives. Codec assertions remain enabled.

Run `bun run build:wasm` inside the package. The script uses offline, locked Cargo,
rejects modules with host imports, embeds the WASM as base64 JavaScript, and copies
license notices. The compiled module is about 116 KiB (about 155 KiB as base64).
It requires neither WASM SIMD nor threads. Initialization is lazy.

Upstream source and commit are recorded in `wasm/vendor/README.md`. The artifact
and its notices must be regenerated together when encoder sources change.

## Initial measurements

One local Bun 1.4.2/Linux x64 run, including layout, rasterization, encoding, and file writes.
Source evaluation happened before each timer:

| Scene | WASM elapsed | FFmpeg elapsed | WASM file | FFmpeg file |
|---|---:|---:|---:|---:|
| Orbit: 960×540, 180 frames, 30 fps | 1.41 s | 0.66 s | 204,723 B | 71,426 B |
| Detail: 320×180, 12 frames, 12 fps | 0.059 s | 0.066 s | 59,385 B | 34,229 B |

WASM used fixed QP 18 and fragmented MP4; FFmpeg used libx264, `-preset fast`,
`-crf 18`, yuv420p, and fast-start conventional MP4. These quality scales are not
equivalent. Measurements illustrate current cost, not equal-quality codec
performance or a cross-machine guarantee. The detail case used a warmed WASM
module. The orbit includes compilation/initialization on its first use.

The orbit's decoded frame was inspected visually. The automated detail fixture
checks small text, colored lines, and moving curves against the rendered RGB
frames, with an RMSE ceiling of 12 intensity levels. YUV420 is lossy in both
backends, particularly around narrow colored strokes.

## Verification and limits

- Bun tests verify export, session isolation, owned output
  buffers, dimension/timing/quality validation, and incomplete-session handling.
- A 2,000-frame test checks that WASM linear memory stays bounded after warmup.
- Decoder tests use FFmpeg/ffprobe as independent readers: colors, dimensions,
  cropped macroblocks, frame order, keyframe flags, fractional timestamps,
  duration, alpha compositing, and detailed moving frames.
- File tests cover frame/callback failures, cancellation on a later event-loop
  turn, removal of temporary output, and preservation of an existing destination.
- Native Rust tests check color conversion, NAL parsing, and MP4 data offsets.
- The encoder passes a browser-target bundle check; browser execution and other
  operating systems have not yet been validated.

minih264 is experimental upstream software, and this is an initial integration.
The backend is scalar software encoding and currently supports MP4/H.264 only,
with no audio, B frames, variable frame rate, or hardware acceleration. Dimensions
are limited to even values from 2 through 4096. Fixed QP controls quality, not
bitrate. A single frame runs synchronously, so cancellation waits for that frame.

Fragmented MP4 allows bounded memory and incremental output. It differs from
FFmpeg's previous fast-start MP4: there is no conventional global sample table
or final random-access index, and readers may scan fragments when seeking.
Compatibility has been checked with FFmpeg; browser and desktop-player testing
remains future work.
