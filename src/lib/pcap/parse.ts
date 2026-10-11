/**
 * lib/pcap/parse.ts — classic libpcap (.pcap) file format reader.
 *
 * Format (all multi-byte fields in one consistent endianness, determined
 * by the magic number itself):
 *   Global header (24 bytes): magic(4) major(2) minor(2) thiszone(4)
 *     sigfigs(4) snaplen(4) network(4)
 *   Per record: ts_sec(4) ts_usec(4) incl_len(4) orig_len(4) + incl_len
 *     bytes of captured frame data.
 *
 * pcapng (.pcapng) is a different, block-based format — not handled here;
 * callers should check `looksLikePcapng` first and show an honest
 * "not supported yet" message instead of misparsing it.
 */

export type PcapPacket = {
  /** Seconds since epoch, plus fractional microseconds/nanoseconds. */
  timestamp: number;
  /** Bytes actually captured (may be less than origLen if snaplen truncated it). */
  data: Uint8Array;
  origLen: number;
};

export type PcapFile = {
  linkType: number;
  nanosecondResolution: boolean;
  packets: PcapPacket[];
};

const MAGIC_US_LE = 0xa1b2c3d4;
const MAGIC_US_BE = 0xd4c3b2a1;
const MAGIC_NS_LE = 0xa1b23c4d;
const MAGIC_NS_BE = 0x4d3cb2a1;

export function looksLikePcapng(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
  const magic = view.getUint32(0, true);
  // pcapng's Section Header Block type is always 0x0A0D0D0A, regardless
  // of the byte-order magic that follows it.
  return magic === 0x0a0d0d0a;
}

export function parsePcap(bytes: Uint8Array): PcapFile {
  if (bytes.length < 24) throw new Error("File is too small to be a valid .pcap capture.");

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magicLE = view.getUint32(0, true);

  let little: boolean;
  let nanosecondResolution: boolean;
  if (magicLE === MAGIC_US_LE) { little = true; nanosecondResolution = false; }
  else if (magicLE === MAGIC_US_BE) { little = false; nanosecondResolution = false; }
  else if (magicLE === MAGIC_NS_LE) { little = true; nanosecondResolution = true; }
  else if (magicLE === MAGIC_NS_BE) { little = false; nanosecondResolution = true; }
  else {
    throw new Error(
      looksLikePcapng(bytes)
        ? "This is a .pcapng capture — only classic .pcap (libpcap) format is supported right now."
        : "Not a recognized .pcap file (magic number didn't match)."
    );
  }

  const network = view.getUint32(20, little);
  const packets: PcapPacket[] = [];
  let offset = 24;

  while (offset + 16 <= bytes.length) {
    const tsSec = view.getUint32(offset, little);
    const tsFrac = view.getUint32(offset + 4, little);
    const inclLen = view.getUint32(offset + 8, little);
    const origLen = view.getUint32(offset + 12, little);
    offset += 16;

    if (inclLen > bytes.length - offset || inclLen > 262144) {
      // Corrupt/truncated record, or we guessed the endianness wrong —
      // stop rather than reading garbage as a packet length and walking
      // off the end of the buffer.
      break;
    }

    const data = bytes.subarray(offset, offset + inclLen);
    offset += inclLen;

    const timestamp = tsSec + tsFrac / (nanosecondResolution ? 1e9 : 1e6);
    packets.push({ timestamp, data, origLen });
  }

  return { linkType: network, nanosecondResolution, packets };
}
