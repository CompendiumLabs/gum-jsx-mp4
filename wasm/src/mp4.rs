//! Single-track fragmented MP4. Each frame is its own fragment, so no movie-sized
//! sample table or media buffer is retained. H.264 uses no B frames (DTS = PTS).
const TIMESCALE: u32 = 1_000_000;
fn u16be(out: &mut Vec<u8>, n: u16) {
    out.extend(n.to_be_bytes());
}
fn u32be(out: &mut Vec<u8>, n: u32) {
    out.extend(n.to_be_bytes());
}
fn u64be(out: &mut Vec<u8>, n: u64) {
    out.extend(n.to_be_bytes());
}
fn zeros(out: &mut Vec<u8>, count: usize) {
    out.resize(out.len() + count, 0);
}
fn atom(kind: &[u8; 4], data: Vec<u8>) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 8);
    u32be(
        &mut out,
        (data.len() + 8).try_into().expect("MP4 box exceeds 4 GiB"),
    );
    out.extend(kind);
    out.extend(data);
    out
}
fn full(version: u8, flags: u32) -> Vec<u8> {
    vec![
        version,
        (flags >> 16) as u8,
        (flags >> 8) as u8,
        flags as u8,
    ]
}
fn matrix(out: &mut Vec<u8>) {
    for n in [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000] {
        u32be(out, n);
    }
}

pub fn init(
    width: u16,
    height: u16,
    duration: u64,
    sps: &[u8],
    pps: &[u8],
) -> Result<Vec<u8>, String> {
    if sps.len() < 4 || sps.len() > 65535 || pps.is_empty() || pps.len() > 65535 {
        return Err("Invalid H.264 parameter sets".into());
    }
    let mut ftyp = b"isom".to_vec();
    u32be(&mut ftyp, 512);
    ftyp.extend(b"isomiso6avc1mp41");
    let mut out = atom(b"ftyp", ftyp);
    let mut mvhd = full(1, 0);
    zeros(&mut mvhd, 16);
    u32be(&mut mvhd, TIMESCALE);
    u64be(&mut mvhd, duration);
    u32be(&mut mvhd, 0x10000);
    u16be(&mut mvhd, 0x100);
    zeros(&mut mvhd, 10);
    matrix(&mut mvhd);
    zeros(&mut mvhd, 24);
    u32be(&mut mvhd, 2);
    let mut moov = atom(b"mvhd", mvhd);

    let mut tkhd = full(1, 7);
    zeros(&mut tkhd, 16);
    u32be(&mut tkhd, 1);
    u32be(&mut tkhd, 0);
    u64be(&mut tkhd, duration);
    zeros(&mut tkhd, 16);
    matrix(&mut tkhd);
    u32be(&mut tkhd, (width as u32) << 16);
    u32be(&mut tkhd, (height as u32) << 16);
    let mut trak = atom(b"tkhd", tkhd);
    let mut mdhd = full(1, 0);
    zeros(&mut mdhd, 16);
    u32be(&mut mdhd, TIMESCALE);
    u64be(&mut mdhd, duration);
    u16be(&mut mdhd, 0x55c4);
    u16be(&mut mdhd, 0); // language: und
    let mut mdia = atom(b"mdhd", mdhd);
    let mut hdlr = full(0, 0);
    u32be(&mut hdlr, 0);
    hdlr.extend(b"vide");
    zeros(&mut hdlr, 12);
    hdlr.extend(b"Gum video\0");
    mdia.extend(atom(b"hdlr", hdlr));
    let mut vmhd = full(0, 1);
    zeros(&mut vmhd, 8);
    let mut minf = atom(b"vmhd", vmhd);
    let mut dref = full(0, 0);
    u32be(&mut dref, 1);
    dref.extend(atom(b"url ", full(0, 1)));
    minf.extend(atom(b"dinf", atom(b"dref", dref)));

    let mut avc1 = vec![0; 6];
    u16be(&mut avc1, 1);
    zeros(&mut avc1, 16);
    u16be(&mut avc1, width);
    u16be(&mut avc1, height);
    u32be(&mut avc1, 0x480000);
    u32be(&mut avc1, 0x480000);
    u32be(&mut avc1, 0);
    u16be(&mut avc1, 1);
    zeros(&mut avc1, 32);
    u16be(&mut avc1, 24);
    u16be(&mut avc1, 65535);
    let mut avcc = vec![1, sps[1], sps[2], sps[3], 255, 225];
    u16be(&mut avcc, sps.len() as u16);
    avcc.extend(sps);
    avcc.push(1);
    u16be(&mut avcc, pps.len() as u16);
    avcc.extend(pps);
    avc1.extend(atom(b"avcC", avcc));
    // RGB input is sRGB; conversion uses the limited-range BT.601 matrix.
    let mut colr = b"nclx".to_vec();
    u16be(&mut colr, 1);
    u16be(&mut colr, 13);
    u16be(&mut colr, 6);
    colr.push(0);
    avc1.extend(atom(b"colr", colr));
    let mut stsd = full(0, 0);
    u32be(&mut stsd, 1);
    stsd.extend(atom(b"avc1", avc1));
    let mut stbl = atom(b"stsd", stsd);
    for kind in [b"stts", b"stsc", b"stco"] {
        let mut data = full(0, 0);
        u32be(&mut data, 0);
        stbl.extend(atom(kind, data));
    }
    let mut stsz = full(0, 0);
    zeros(&mut stsz, 8);
    stbl.extend(atom(b"stsz", stsz));
    minf.extend(atom(b"stbl", stbl));
    mdia.extend(atom(b"minf", minf));
    trak.extend(atom(b"mdia", mdia));
    moov.extend(atom(b"trak", trak));
    let mut trex = full(0, 0);
    for n in [1, 1, 0, 0, 0] {
        u32be(&mut trex, n);
    }
    moov.extend(atom(b"mvex", atom(b"trex", trex)));
    out.extend(atom(b"moov", moov));
    Ok(out)
}

pub fn frame(sequence: u32, timestamp: u64, duration: u32, key: bool, sample: Vec<u8>) -> Vec<u8> {
    let mut mfhd = full(0, 0);
    u32be(&mut mfhd, sequence);
    let mut moof = atom(b"mfhd", mfhd);
    let mut tfhd = full(0, 0x020000);
    u32be(&mut tfhd, 1); // default-base-is-moof
    let mut traf = atom(b"tfhd", tfhd);
    let mut tfdt = full(1, 0);
    u64be(&mut tfdt, timestamp);
    traf.extend(atom(b"tfdt", tfdt));
    let mut trun = full(0, 0x000701);
    u32be(&mut trun, 1);
    // moof header + mfhd + traf header + tfhd/tfdt + trun (32 bytes) + mdat header
    let data_offset = 8 + moof.len() + 8 + traf.len() + 32 + 8;
    u32be(&mut trun, data_offset as u32);
    u32be(&mut trun, duration);
    u32be(&mut trun, sample.len() as u32);
    u32be(&mut trun, if key { 0x02000000 } else { 0x01010000 });
    traf.extend(atom(b"trun", trun));
    moof.extend(atom(b"traf", traf));
    let mut out = atom(b"moof", moof);
    out.extend(atom(b"mdat", sample));
    out
}

pub struct AccessUnit {
    pub sample: Vec<u8>,
    pub sps: Vec<u8>,
    pub pps: Vec<u8>,
    pub key: bool,
}
// Annex B start codes become the 4-byte lengths required by avc1 samples.
pub fn access_unit(bytes: &[u8]) -> Result<AccessUnit, String> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let size = if bytes[i..].starts_with(&[0, 0, 0, 1]) {
            4
        } else if bytes[i..].starts_with(&[0, 0, 1]) {
            3
        } else {
            i += 1;
            continue;
        };
        starts.push((i, i + size));
        i += size;
    }
    let mut result = AccessUnit {
        sample: Vec::new(),
        sps: Vec::new(),
        pps: Vec::new(),
        key: false,
    };
    let mut slices = 0;
    for (index, &(_, start)) in starts.iter().enumerate() {
        let mut end = starts
            .get(index + 1)
            .map_or(bytes.len(), |&(offset, _)| offset);
        while end > start && bytes[end - 1] == 0 {
            end -= 1;
        }
        if start == end {
            return Err("Empty H.264 NAL unit".into());
        }
        let nal = &bytes[start..end];
        match nal[0] & 31 {
            7 => result.sps = nal.to_vec(),
            8 => result.pps = nal.to_vec(),
            kind => {
                if kind == 5 {
                    result.key = true;
                }
                if kind == 1 || kind == 5 {
                    slices += 1;
                }
                u32be(&mut result.sample, nal.len() as u32);
                result.sample.extend(nal);
            }
        }
    }
    if slices == 0 {
        return Err("Encoder produced no H.264 slice".into());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn annex_b_lengths_and_keyframes() {
        let unit = access_unit(&[
            0, 0, 0, 1, 0x67, 66, 0, 40, 0, 0, 1, 0x68, 7, 0, 0, 0, 1, 0x65, 9,
        ])
        .unwrap();
        assert_eq!(unit.sps, [0x67, 66, 0, 40]);
        assert_eq!(unit.pps, [0x68, 7]);
        assert_eq!(unit.sample, [0, 0, 0, 2, 0x65, 9]);
        assert!(unit.key);
        assert!(access_unit(&[]).is_err());
    }
    #[test]
    fn fragment_data_offset_points_at_sample() {
        let bytes = frame(1, 0, 33333, true, vec![7, 8, 9]);
        let offset = bytes.windows(4).position(|s| s == b"trun").unwrap();
        let data_offset =
            u32::from_be_bytes(bytes[offset + 12..offset + 16].try_into().unwrap()) as usize;
        assert_eq!(&bytes[data_offset..], &[7, 8, 9]);
    }
}
