use std::{env, path::PathBuf, process::Command};

fn main() {
    let target = env::var("TARGET").unwrap();
    let output = PathBuf::from(env::var("OUT_DIR").unwrap());
    let object = output.join("codec.o");
    let mut cc = Command::new(env::var("CC").unwrap_or_else(|_| "clang".into()));
    cc.args(["-c", "codec.c", "-O3", "-fno-strict-aliasing", "-fwrapv"]);
    if target == "wasm32-unknown-unknown" {
        cc.args([
            "--target=wasm32-unknown-unknown",
            "-ffreestanding",
            "-Iinclude",
            "-D__EMSCRIPTEN__",
        ]);
    }
    assert!(
        cc.arg("-o").arg(&object).status().unwrap().success(),
        "C codec compilation failed"
    );
    // Link the object directly: no archiver, C runtime, or WASI SDK is needed.
    println!("cargo:rustc-link-arg={}", object.display());
    for file in [
        "codec.c",
        "vendor/minih264e.h",
        "include/assert.h",
        "include/string.h",
        "include/stdio.h",
    ] {
        println!("cargo:rerun-if-changed={file}");
    }
    println!("cargo:rerun-if-env-changed=CC");
}
