export type FileSignature = {
  bytes: number[];
  offset: number;
  label: string;
  mime: string;
  // Extensions a file with this real type would normally carry. Used to
  // flag a mismatch against the file's actual name — the classic
  // "invoice.pdf" that's really an .exe trick.
  typicalExtensions: string[];
  // Types worth a heads-up if they show up disguised as something else,
  // or arrive unexpectedly at all (executables, scripts, archives that
  // can contain executables).
  dangerous: boolean;
  // Whether near-maximum entropy (~7.2-8.0 bits/byte) is the EXPECTED,
  // benign baseline for this format because it's compressed/encoded by
  // design (JPEG, ZIP, MP4…) — vs. formats that are normally low/medium
  // entropy, where a spike to near-random is itself a meaningful signal
  // (an unpacked PE, a plaintext-based RTF, uncompressed PCM audio).
  // This is what lets the entropy check reason about context instead of
  // applying one flat threshold to every file type.
  naturallyHighEntropy: boolean;
};

export const MAGIC_SIGNATURES: FileSignature[] = [
  // --- Documents ---
  { bytes: [0x25, 0x50, 0x44, 0x46], offset: 0, label: "PDF Document", mime: "application/pdf", typicalExtensions: ["pdf"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x50, 0x4b, 0x03, 0x04], offset: 0, label: "ZIP / OOXML (docx, xlsx, pptx, apk, jar…)", mime: "application/zip", typicalExtensions: ["zip", "docx", "xlsx", "pptx", "docm", "xlsm", "pptm", "odt", "ods", "odp", "apk", "jar"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x50, 0x4b, 0x05, 0x06], offset: 0, label: "ZIP Archive (empty)", mime: "application/zip", typicalExtensions: ["zip"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], offset: 0, label: "Legacy OLE2 (doc, xls, ppt, msi)", mime: "application/x-ole-storage", typicalExtensions: ["doc", "xls", "ppt", "msi"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x7b, 0x5c, 0x72, 0x74, 0x66, 0x31], offset: 0, label: "RTF Document", mime: "application/rtf", typicalExtensions: ["rtf"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x25, 0x21, 0x50, 0x53], offset: 0, label: "PostScript Document", mime: "application/postscript", typicalExtensions: ["ps", "eps"], dangerous: false, naturallyHighEntropy: false },

  // --- Windows / Linux / macOS executables ---
  { bytes: [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00], offset: 0, label: "Windows Shortcut (.lnk) — common malware delivery vector", mime: "application/x-ms-shortcut", typicalExtensions: ["lnk"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0x4d, 0x5a], offset: 0, label: "Windows PE Executable (.exe/.dll/.scr)", mime: "application/x-msdownload", typicalExtensions: ["exe", "dll", "scr", "sys", "cpl"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0x7f, 0x45, 0x4c, 0x46], offset: 0, label: "ELF Executable (Linux)", mime: "application/x-elf", typicalExtensions: ["", "elf", "bin", "so"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0xfe, 0xed, 0xfa, 0xce], offset: 0, label: "Mach-O Executable (macOS, 32-bit)", mime: "application/x-mach-binary", typicalExtensions: ["", "dylib"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0xfe, 0xed, 0xfa, 0xcf], offset: 0, label: "Mach-O Executable (macOS, 64-bit)", mime: "application/x-mach-binary", typicalExtensions: ["", "dylib"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], offset: 0, label: "Mach-O Executable (macOS, 64-bit, reverse byte order)", mime: "application/x-mach-binary", typicalExtensions: ["", "dylib"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], offset: 0, label: "Java Class File / Mach-O Fat Binary", mime: "application/java-vm", typicalExtensions: ["class"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0x64, 0x65, 0x78, 0x0a, 0x30, 0x33, 0x35, 0x00], offset: 0, label: "Android DEX (Dalvik Executable)", mime: "application/x-dex", typicalExtensions: ["dex"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0x00, 0x61, 0x73, 0x6d], offset: 0, label: "WebAssembly Module", mime: "application/wasm", typicalExtensions: ["wasm"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0xfe, 0xed, 0xfe, 0xed], offset: 0, label: "Java KeyStore (JKS)", mime: "application/x-java-keystore", typicalExtensions: ["jks", "keystore"], dangerous: false, naturallyHighEntropy: false },

  // --- Images ---
  { bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0, label: "PNG Image", mime: "image/png", typicalExtensions: ["png"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0xff, 0xd8, 0xff], offset: 0, label: "JPEG Image", mime: "image/jpeg", typicalExtensions: ["jpg", "jpeg", "jfif", "jpe", "jif"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20], offset: 0, label: "JPEG 2000 Image", mime: "image/jp2", typicalExtensions: ["jp2"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x47, 0x49, 0x46, 0x38], offset: 0, label: "GIF Image", mime: "image/gif", typicalExtensions: ["gif"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x42, 0x4d], offset: 0, label: "BMP Image", mime: "image/bmp", typicalExtensions: ["bmp"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x49, 0x49, 0x2a, 0x00], offset: 0, label: "TIFF Image (little-endian)", mime: "image/tiff", typicalExtensions: ["tif", "tiff"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x4d, 0x4d, 0x00, 0x2a], offset: 0, label: "TIFF Image (big-endian)", mime: "image/tiff", typicalExtensions: ["tif", "tiff"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8, label: "WebP Image", mime: "image/webp", typicalExtensions: ["webp"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x38, 0x42, 0x50, 0x53], offset: 0, label: "Photoshop Document (PSD/PSB)", mime: "image/vnd.adobe.photoshop", typicalExtensions: ["psd", "psb"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x00, 0x00, 0x01, 0x00], offset: 0, label: "Windows Icon (ICO)", mime: "image/x-icon", typicalExtensions: ["ico"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x00, 0x00, 0x02, 0x00], offset: 0, label: "Windows Cursor (CUR)", mime: "image/x-icon", typicalExtensions: ["cur"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x67, 0x69, 0x6d, 0x70, 0x20, 0x78, 0x63, 0x66], offset: 0, label: "GIMP XCF Image", mime: "image/x-xcf", typicalExtensions: ["xcf"], dangerous: false, naturallyHighEntropy: false },

  // --- Audio ---
  { bytes: [0x66, 0x4c, 0x61, 0x43], offset: 0, label: "FLAC Audio", mime: "audio/flac", typicalExtensions: ["flac"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x4f, 0x67, 0x67, 0x53], offset: 0, label: "Ogg Container (Vorbis/Opus/Theora)", mime: "audio/ogg", typicalExtensions: ["ogg", "oga", "ogv"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x4d, 0x54, 0x68, 0x64], offset: 0, label: "MIDI Audio", mime: "audio/midi", typicalExtensions: ["mid", "midi"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x23, 0x21, 0x41, 0x4d, 0x52], offset: 0, label: "AMR Audio", mime: "audio/amr", typicalExtensions: ["amr"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x57, 0x41, 0x56, 0x45], offset: 8, label: "WAV Audio", mime: "audio/wav", typicalExtensions: ["wav"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x46, 0x4f, 0x52, 0x4d], offset: 0, label: "IFF Container (AIFF audio or Amiga IFF)", mime: "audio/aiff", typicalExtensions: ["aiff", "aif"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x49, 0x44, 0x33], offset: 0, label: "MP3 Audio (ID3 tag)", mime: "audio/mpeg", typicalExtensions: ["mp3"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0xff, 0xfb], offset: 0, label: "MP3 Audio (raw frame sync, no ID3 tag)", mime: "audio/mpeg", typicalExtensions: ["mp3"], dangerous: false, naturallyHighEntropy: true },

  // --- Video ---
  { bytes: [0x1a, 0x45, 0xdf, 0xa3], offset: 0, label: "Matroska / WebM Video (EBML)", mime: "video/webm", typicalExtensions: ["mkv", "webm"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x46, 0x4c, 0x56, 0x01], offset: 0, label: "Flash Video (FLV)", mime: "video/x-flv", typicalExtensions: ["flv"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x66, 0x74, 0x79, 0x70], offset: 4, label: "MP4 / MOV / HEIC Container (ISO base media)", mime: "video/mp4", typicalExtensions: ["mp4", "mov", "m4a", "m4v", "heic", "heif", "3gp", "3g2"], dangerous: false, naturallyHighEntropy: true },

  // --- Archives / compression ---
  { bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00], offset: 0, label: "RAR5 Archive", mime: "application/x-rar", typicalExtensions: ["rar"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x52, 0x61, 0x72, 0x21], offset: 0, label: "RAR Archive (RAR4 or earlier)", mime: "application/x-rar", typicalExtensions: ["rar"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x1f, 0x8b], offset: 0, label: "GZIP Archive", mime: "application/gzip", typicalExtensions: ["gz", "tgz"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], offset: 0, label: "7-Zip Archive", mime: "application/x-7z-compressed", typicalExtensions: ["7z"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x42, 0x5a, 0x68], offset: 0, label: "BZIP2 Archive", mime: "application/x-bzip2", typicalExtensions: ["bz2"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], offset: 0, label: "XZ Archive", mime: "application/x-xz", typicalExtensions: ["xz"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x04, 0x22, 0x4d, 0x18], offset: 0, label: "LZ4 Compressed Stream", mime: "application/x-lz4", typicalExtensions: ["lz4"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x28, 0xb5, 0x2f, 0xfd], offset: 0, label: "Zstandard (zstd) Compressed Stream", mime: "application/zstd", typicalExtensions: ["zst"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x21, 0x3c, 0x61, 0x72, 0x63, 0x68, 0x3e], offset: 0, label: "Unix ar Archive (.deb/.a)", mime: "application/x-archive", typicalExtensions: ["deb", "a"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x4d, 0x53, 0x43, 0x46], offset: 0, label: "Windows Cabinet (CAB) Archive", mime: "application/vnd.ms-cab-compressed", typicalExtensions: ["cab"], dangerous: false, naturallyHighEntropy: true },

  // --- Fonts ---
  { bytes: [0x77, 0x4f, 0x46, 0x32], offset: 0, label: "WOFF2 Web Font", mime: "font/woff2", typicalExtensions: ["woff2"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x77, 0x4f, 0x46, 0x46], offset: 0, label: "WOFF Web Font", mime: "font/woff", typicalExtensions: ["woff"], dangerous: false, naturallyHighEntropy: true },
  { bytes: [0x4f, 0x54, 0x54, 0x4f], offset: 0, label: "OpenType Font (OTF)", mime: "font/otf", typicalExtensions: ["otf"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x00, 0x01, 0x00, 0x00], offset: 0, label: "TrueType Font (TTF)", mime: "font/ttf", typicalExtensions: ["ttf"], dangerous: false, naturallyHighEntropy: false },

  // --- Disk / VM images ---
  { bytes: [0x4b, 0x44, 0x4d, 0x56], offset: 0, label: "VMware Virtual Disk (VMDK)", mime: "application/x-vmdk", typicalExtensions: ["vmdk"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x51, 0x46, 0x49, 0xfb], offset: 0, label: "QEMU QCOW2 Disk Image", mime: "application/x-qemu-disk", typicalExtensions: ["qcow2"], dangerous: false, naturallyHighEntropy: false },

  // --- Windows forensic artifacts ---
  { bytes: [0x72, 0x65, 0x67, 0x66], offset: 0, label: "Windows Registry Hive", mime: "application/x-ms-reg", typicalExtensions: ["", "dat"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x45, 0x6c, 0x66, 0x46, 0x69, 0x6c, 0x65, 0x00], offset: 0, label: "Windows Event Log (EVTX)", mime: "application/x-ms-evtx", typicalExtensions: ["evtx"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x21, 0x42, 0x44, 0x4e], offset: 0, label: "Outlook PST/OST Mail Archive", mime: "application/vnd.ms-outlook", typicalExtensions: ["pst", "ost"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x49, 0x54, 0x53, 0x46], offset: 0, label: "Compiled HTML Help (CHM)", mime: "application/vnd.ms-htmlhelp", typicalExtensions: ["chm"], dangerous: true, naturallyHighEntropy: false },

  // --- Adobe Flash (legacy, still a real historical malware vector) ---
  { bytes: [0x46, 0x57, 0x53], offset: 0, label: "Flash SWF (uncompressed)", mime: "application/x-shockwave-flash", typicalExtensions: ["swf"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0x43, 0x57, 0x53], offset: 0, label: "Flash SWF (zlib-compressed)", mime: "application/x-shockwave-flash", typicalExtensions: ["swf"], dangerous: true, naturallyHighEntropy: true },
  { bytes: [0x5a, 0x57, 0x53], offset: 0, label: "Flash SWF (LZMA-compressed)", mime: "application/x-shockwave-flash", typicalExtensions: ["swf"], dangerous: true, naturallyHighEntropy: true },

  // --- Databases ---
  { bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65], offset: 0, label: "SQLite Database", mime: "application/x-sqlite3", typicalExtensions: ["db", "sqlite", "sqlite3"], dangerous: false, naturallyHighEntropy: false },

  // --- Other containers/disk formats worth recognizing ---
  { bytes: [0x75, 0x73, 0x74, 0x61, 0x72], offset: 257, label: "TAR Archive (POSIX ustar)", mime: "application/x-tar", typicalExtensions: ["tar"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x43, 0x44, 0x30, 0x30, 0x31], offset: 0x8001, label: "ISO 9660 Disk Image", mime: "application/x-iso9660-image", typicalExtensions: ["iso"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x49, 0x49, 0xbc, 0x01], offset: 0, label: "JPEG XR / HD Photo Image", mime: "image/vnd.ms-photo", typicalExtensions: ["wdp", "jxr"], dangerous: false, naturallyHighEntropy: true },

  // --- Recent real-world malware delivery vectors ---
  { bytes: [0xe4, 0x52, 0x5c, 0x7b, 0x8c, 0xd8, 0xa7, 0x4d, 0xae, 0xb1, 0x53, 0x78, 0xd0, 0x29, 0x96, 0xd3], offset: 0, label: "Microsoft OneNote (.one) — a major 2023+ phishing/malware delivery vector via embedded lure files", mime: "application/onenote", typicalExtensions: ["one"], dangerous: true, naturallyHighEntropy: false },
  { bytes: [0x53, 0x43, 0x43, 0x41], offset: 4, label: "Windows Prefetch File", mime: "application/x-ms-prefetch", typicalExtensions: ["pf"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0xed, 0xab, 0xee, 0xdb], offset: 0, label: "RPM Package", mime: "application/x-rpm", typicalExtensions: ["rpm"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x62, 0x70, 0x6c, 0x69, 0x73, 0x74, 0x30, 0x30], offset: 0, label: "Apple Binary Property List (plist)", mime: "application/x-plist", typicalExtensions: ["plist"], dangerous: false, naturallyHighEntropy: false },
  { bytes: [0x76, 0x68, 0x64, 0x78, 0x66, 0x69, 0x6c, 0x65], offset: 0, label: "VHDX Virtual Disk Image", mime: "application/x-vhdx", typicalExtensions: ["vhdx"], dangerous: false, naturallyHighEntropy: false },
];

export function detectFileType(bytes: Uint8Array): FileSignature | null {
  for (const sig of MAGIC_SIGNATURES) {
    const start = sig.offset;
    if (bytes.length < start + sig.bytes.length) continue;
    if (sig.bytes.every((b, i) => bytes[start + i] === b)) return sig;
  }
  return null;
}
