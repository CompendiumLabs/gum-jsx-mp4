# minih264

Unmodified `minih264e.h` and `LICENSE` from:
https://github.com/lieff/minih264

Pinned commit: `b0baea7a80ef9d12da97301dd1099b8791b5ba43`

The wrapper disables SVC, threading, and temporal denoising. WASM uses the
portable scalar C implementation. Clang compiles it; Rust owns all allocations.
The `__EMSCRIPTEN__` define selects the header's little-endian platform branch;
no Emscripten runtime or toolchain is used.
