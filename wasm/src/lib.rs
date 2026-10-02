mod mp4;
use std::{cell::RefCell, ffi::c_void, ptr};

extern "C" {
    fn codec_sizes(width: i32, height: i32, gop: i32, persist: *mut i32, scratch: *mut i32) -> i32;
    fn codec_init(persist: *mut c_void, width: i32, height: i32, gop: i32) -> i32;
    fn codec_encode(
        persist: *mut c_void,
        scratch: *mut c_void,
        yuv: *mut u8,
        width: i32,
        height: i32,
        qp: i32,
        data: *mut *mut u8,
        size: *mut i32,
    ) -> i32;
}
struct Encoder {
    width: usize,
    height: usize,
    fps: f64,
    frames: u32,
    index: u32,
    qp: i32,
    // u128 ensures 16-byte alignment for the codec's internal allocations.
    persist: Vec<u128>,
    scratch: Vec<u128>,
    rgba: Vec<u8>,
    yuv: Vec<u8>,
    output: Vec<u8>,
}
impl Encoder {
    fn new(width: u32, height: u32, fps: f64, frames: u32, qp: u32) -> Result<Self, String> {
        if width == 0
            || height == 0
            || width > 4096
            || height > 4096
            || (width | height) & 1 != 0
            || u64::from(width) * u64::from(height) > 16_777_216
        {
            return Err("Video dimensions must be even integers from 2 to 4096".into());
        }
        if !fps.is_finite() || !(0.001..=1000.).contains(&fps) || frames == 0 || frames == u32::MAX
        {
            return Err("WASM video requires fps in [0.001, 1000] and 1..4294967294 frames".into());
        }
        if !(10..=51).contains(&qp) {
            return Err("qp must be an integer from 10 to 51".into());
        }
        let gop = (fps * 2.).round().max(1.) as i32;
        let (mut persistent, mut scratch) = (0, 0);
        let status = unsafe {
            codec_sizes(
                width as i32,
                height as i32,
                gop,
                &mut persistent,
                &mut scratch,
            )
        };
        if status != 0 || persistent <= 0 || scratch <= 0 {
            return Err(format!("Codec allocation error {status}"));
        }
        let mut persist = vec![0u128; (persistent as usize + 15) / 16];
        let scratch = vec![0u128; (scratch as usize + 15) / 16];
        let status = unsafe {
            codec_init(
                persist.as_mut_ptr().cast(),
                width as i32,
                height as i32,
                gop,
            )
        };
        if status != 0 {
            return Err(format!("Codec initialization error {status}"));
        }
        let pixels = width as usize * height as usize;
        Ok(Self {
            width: width as usize,
            height: height as usize,
            fps,
            frames,
            index: 0,
            qp: qp as i32,
            persist,
            scratch,
            rgba: vec![0; pixels * 4],
            yuv: vec![0; pixels * 3 / 2],
            output: Vec::new(),
        })
    }
    fn timestamp(&self, frame: u32) -> u64 {
        (f64::from(frame) * 1_000_000. / self.fps).round() as u64
    }
    fn encode(&mut self) -> Result<(), String> {
        if self.index >= self.frames {
            return Err("All frames have already been encoded".into());
        }
        rgba_to_yuv(&self.rgba, &mut self.yuv, self.width, self.height);
        let mut data = ptr::null_mut();
        let mut size = 0;
        let status = unsafe {
            codec_encode(
                self.persist.as_mut_ptr().cast(),
                self.scratch.as_mut_ptr().cast(),
                self.yuv.as_mut_ptr(),
                self.width as i32,
                self.height as i32,
                self.qp,
                &mut data,
                &mut size,
            )
        };
        if status != 0 || data.is_null() || size <= 0 {
            return Err(format!("H.264 encoding error {status}"));
        }
        let bytes = unsafe { std::slice::from_raw_parts(data, size as usize) };
        let unit = mp4::access_unit(bytes)?;
        self.output.clear();
        if self.index == 0 {
            self.output.extend(mp4::init(
                self.width as u16,
                self.height as u16,
                self.timestamp(self.frames),
                &unit.sps,
                &unit.pps,
            )?);
        }
        let start = self.timestamp(self.index);
        let duration = (self.timestamp(self.index + 1) - start) as u32;
        self.output.extend(mp4::frame(
            self.index + 1,
            start,
            duration,
            unit.key,
            unit.sample,
        ));
        self.index += 1;
        Ok(())
    }
}

fn rgb(rgba: &[u8], offset: usize) -> [i32; 3] {
    let alpha = rgba[offset + 3] as i32;
    std::array::from_fn(|c| (rgba[offset + c] as i32 * alpha + 255 * (255 - alpha) + 127) / 255)
}
// BT.601 limited-range YUV420; average all four RGB samples for each chroma pair.
fn rgba_to_yuv(rgba: &[u8], yuv: &mut [u8], width: usize, height: usize) {
    let pixels = width * height;
    for y in (0..height).step_by(2) {
        for x in (0..width).step_by(2) {
            let mut sum = [0; 3];
            for dy in 0..2 {
                for dx in 0..2 {
                    let offset = (y + dy) * width + x + dx;
                    let [r, g, b] = rgb(rgba, offset * 4);
                    yuv[offset] =
                        (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(16, 235) as u8;
                    sum[0] += r;
                    sum[1] += g;
                    sum[2] += b;
                }
            }
            let [r, g, b] = sum.map(|n| (n + 2) / 4);
            let uv = y / 2 * (width / 2) + x / 2;
            yuv[pixels + uv] =
                (((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(16, 240) as u8;
            yuv[pixels * 5 / 4 + uv] =
                (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(16, 240) as u8;
        }
    }
}

#[derive(Default)]
struct State {
    encoder: Option<Encoder>,
    error: String,
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
#[no_mangle]
pub extern "C" fn video_init(width: u32, height: u32, fps: f64, frames: u32, qp: u32) -> i32 {
    STATE.with(|state| {
        let mut state = state.borrow_mut();
        state.encoder = None;
        state.error.clear();
        match Encoder::new(width, height, fps, frames, qp) {
            Ok(encoder) => {
                state.encoder = Some(encoder);
                0
            }
            Err(error) => {
                state.error = error;
                1
            }
        }
    })
}
#[no_mangle]
pub extern "C" fn video_input() -> *mut u8 {
    STATE.with(|s| {
        s.borrow_mut()
            .encoder
            .as_mut()
            .map_or(ptr::null_mut(), |e| e.rgba.as_mut_ptr())
    })
}
#[no_mangle]
pub extern "C" fn video_encode() -> i32 {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        let result = s
            .encoder
            .as_mut()
            .ok_or_else(|| "Encoder is closed".to_string())
            .and_then(Encoder::encode);
        match result {
            Ok(()) => 0,
            Err(error) => {
                s.error = error;
                1
            }
        }
    })
}
#[no_mangle]
pub extern "C" fn video_output() -> *const u8 {
    STATE.with(|s| {
        s.borrow()
            .encoder
            .as_ref()
            .map_or(ptr::null(), |e| e.output.as_ptr())
    })
}
#[no_mangle]
pub extern "C" fn video_output_len() -> usize {
    STATE.with(|s| s.borrow().encoder.as_ref().map_or(0, |e| e.output.len()))
}
#[no_mangle]
pub extern "C" fn video_error() -> *const u8 {
    STATE.with(|s| s.borrow().error.as_ptr())
}
#[no_mangle]
pub extern "C" fn video_error_len() -> usize {
    STATE.with(|s| s.borrow().error.len())
}
#[no_mangle]
pub extern "C" fn video_close() {
    STATE.with(|s| s.borrow_mut().encoder = None);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conversion_composites_alpha_and_averages_chroma() {
        let mut output = [0; 6];
        rgba_to_yuv(
            &[
                255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255,
            ],
            &mut output,
            2,
            2,
        );
        assert_eq!(&output[..4], &[82, 41, 235, 235]);
        assert_eq!(&output[4..], &[146, 151]);
    }
}
