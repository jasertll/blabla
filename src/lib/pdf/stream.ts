/**
 * JOSINT · PDF Toolkit — Content-stream parser
 * محلل تدفّق محتوى PDF
 *
 * يُستخدم لجراحة دقيقة على محتوى الصفحة: نحدد العناصر المطلوب حذفها
 * بالبايت، ثم نحذفها فقط — دون المساس بأي محتوى آخر.
 */

export type TokKind = 'str' | 'hex' | 'name' | 'kw' | 'inline';

export interface Tok {
  /** نوع الوحدة */
  k: TokKind;
  /** بداية البايت */
  a: number;
  /** نهاية البايت (غير شاملة) */
  b: number;
}

/** كتلة q ... Q */
export interface Block {
  /** بداية بايت الكتلة (عند q) */
  b0: number;
  /** نهاية بايت الكتلة (بعد Q) */
  b1: number;
  /** فهرس وحدة البداية */
  t0: number;
  /** فهرس وحدة النهاية (وحدة Q) */
  t1: number;
  /** عمق التداخل */
  depth: number;
}

/** منطقة محتوى معلّم BDC ... EMC */
export interface MarkedRegion {
  b0: number;
  b1: number;
  t0: number;
  t1: number;
  /** الوسم، عادةً OC */
  tag: string | null;
  /** اسم الخاصية في Resources/Properties */
  prop: string | null;
}

export type Cut = [number, number];

const SPACE = new Set([0x20, 0x09, 0x0d, 0x0a, 0x0c, 0x00]);
const DELIM = new Set([
  0x20, 0x09, 0x0d, 0x0a, 0x0c, 0x00,
  0x2f, 0x5b, 0x5d, 0x3c, 0x3e, 0x28, 0x29, 0x7b, 0x7d, 0x25,
]);

function eq(buf: Uint8Array, at: number, s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (buf[at + i] !== s.charCodeAt(i)) return false;
  }
  return true;
}

function find(buf: Uint8Array, needle: string, from: number): number {
  const n0 = needle.charCodeAt(0);
  for (let i = from; i <= buf.length - needle.length; i++) {
    if (buf[i] === n0 && eq(buf, i, needle)) return i;
  }
  return -1;
}

/** نص لاتيني من مقطع بايتات */
export function latin(buf: Uint8Array, a: number, b: number): string {
  let s = '';
  for (let i = a; i < b; i++) s += String.fromCharCode(buf[i]);
  return s;
}

/**
 * تفكيك تدفّق المحتوى إلى وحدات.
 * يتعامل بشكل صحيح مع النصوص الحرفية والست عشرية والتعليقات والصور المضمّنة،
 * حتى لا تُفسَّر بايتاتها كعوامل رسم.
 */
export function tokenize(buf: Uint8Array): Tok[] {
  const out: Tok[] = [];
  const n = buf.length;
  let i = 0;

  while (i < n) {
    const c = buf[i];

    if (SPACE.has(c)) { i++; continue; }

    // تعليق
    if (c === 0x25) {
      const j = find(buf, '\n', i);
      i = j < 0 ? n : j + 1;
      continue;
    }

    // نص حرفي ( ... ) مع دعم التداخل والهروب
    if (c === 0x28) {
      let depth = 1;
      let j = i + 1;
      while (j < n && depth > 0) {
        const ch = buf[j];
        if (ch === 0x5c) { j += 2; continue; }       // \
        if (ch === 0x28) depth++;
        else if (ch === 0x29) depth--;
        j++;
      }
      out.push({ k: 'str', a: i, b: j });
      i = j;
      continue;
    }

    // << أو >>
    if (c === 0x3c && buf[i + 1] === 0x3c) { out.push({ k: 'kw', a: i, b: i + 2 }); i += 2; continue; }
    if (c === 0x3e && buf[i + 1] === 0x3e) { out.push({ k: 'kw', a: i, b: i + 2 }); i += 2; continue; }

    // نص ست عشري < ... >
    if (c === 0x3c) {
      const j = find(buf, '>', i);
      const e = j < 0 ? n : j + 1;
      out.push({ k: 'hex', a: i, b: e });
      i = e;
      continue;
    }

    // [ ] { }
    if (c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      out.push({ k: 'kw', a: i, b: i + 1 });
      i++;
      continue;
    }

    // اسم /Xyz
    if (c === 0x2f) {
      let j = i + 1;
      while (j < n && !DELIM.has(buf[j])) j++;
      out.push({ k: 'name', a: i, b: j });
      i = j;
      continue;
    }

    // كلمة مفتاحية / رقم
    let j = i;
    while (j < n && !DELIM.has(buf[j])) j++;
    if (j === i) j = i + 1;

    // صورة مضمّنة: BI ... ID <بيانات ثنائية> EI
    if (j - i === 2 && buf[i] === 0x42 && buf[i + 1] === 0x49) {
      const k = find(buf, 'EI', j);
      const e = k < 0 ? n : k + 2;
      out.push({ k: 'inline', a: i, b: e });
      i = e;
      continue;
    }

    out.push({ k: 'kw', a: i, b: j });
    i = j;
  }

  return out;
}

/** نص الكلمة المفتاحية لوحدة */
export function kw(buf: Uint8Array, t: Tok): string {
  return latin(buf, t.a, t.b);
}

/** اسم بدون الشرطة المائلة */
export function nameOf(buf: Uint8Array, t: Tok): string {
  return latin(buf, t.a + 1, t.b);
}

/**
 * كل كتل q ... Q في **جميع** مستويات التداخل، مرتّبة من الأصغر إلى الأكبر.
 *
 * هذا جوهر الأمان: العلامة المائية غالباً داخل كتلة متداخلة صغيرة،
 * بينما الكتلة الخارجية تضم الصفحة كلها. استهداف الأصغر دائماً
 * يمنع حذف محتوى الصفحة بالخطأ.
 */
export function findBlocks(buf: Uint8Array, toks: Tok[]): Block[] {
  const out: Block[] = [];
  const stack: Array<{ b0: number; t0: number }> = [];

  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.k !== 'kw') continue;
    const w = kw(buf, t);
    if (w === 'q') {
      stack.push({ b0: t.a, t0: idx });
    } else if (w === 'Q' && stack.length) {
      const s = stack.pop()!;
      out.push({ b0: s.b0, b1: t.b, t0: s.t0, t1: idx, depth: stack.length });
    }
  }

  out.sort((x, y) => (x.t1 - x.t0) - (y.t1 - y.t0));
  return out;
}

/** أصغر كتلة تحتوي هذه الوحدة */
export function innermost(blocks: Block[], tokIdx: number): Block | null {
  for (const b of blocks) {
    if (b.t0 <= tokIdx && tokIdx <= b.t1) return b;
  }
  return null;
}

/** مناطق المحتوى المعلّم /Tag /Prop BDC ... EMC */
export function findMarked(buf: Uint8Array, toks: Tok[]): MarkedRegion[] {
  const out: MarkedRegion[] = [];
  const stack: Array<{ b0: number; t0: number; tag: string | null; prop: string | null }> = [];

  for (let idx = 0; idx < toks.length; idx++) {
    const t = toks[idx];
    if (t.k !== 'kw') continue;
    const w = kw(buf, t);

    if (w === 'BDC' || w === 'BMC') {
      let tag: string | null = null;
      let prop: string | null = null;
      let b0 = t.a;
      if (w === 'BDC' && idx >= 2) {
        if (toks[idx - 1].k === 'name') prop = nameOf(buf, toks[idx - 1]);
        if (toks[idx - 2].k === 'name') {
          tag = nameOf(buf, toks[idx - 2]);
          b0 = toks[idx - 2].a;
        }
      }
      stack.push({ b0, t0: idx, tag, prop });
    } else if (w === 'EMC' && stack.length) {
      const s = stack.pop()!;
      out.push({ b0: s.b0, b1: t.b, t0: s.t0, t1: idx, tag: s.tag, prop: s.prop });
    }
  }

  return out;
}

/** فكّ هروب النص الحرفي */
function unescape(buf: Uint8Array, a: number, b: number): number[] {
  const out: number[] = [];
  let i = a;
  const map: Record<number, number> = {
    0x6e: 0x0a, 0x72: 0x0d, 0x74: 0x09, 0x62: 0x08,
    0x66: 0x0c, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c,
  };
  while (i < b) {
    const c = buf[i];
    if (c === 0x5c && i + 1 < b) {
      const nx = buf[i + 1];
      if (nx in map) { out.push(map[nx]); i += 2; continue; }
      if (nx >= 0x30 && nx <= 0x37) {
        let oct = '';
        let j = i + 1;
        while (j < b && oct.length < 3 && buf[j] >= 0x30 && buf[j] <= 0x37) {
          oct += String.fromCharCode(buf[j]);
          j++;
        }
        out.push(parseInt(oct, 8) & 0xff);
        i = j;
        continue;
      }
      i += 2;
      continue;
    }
    out.push(c);
    i++;
  }
  return out;
}

/** كل بايتات النصوص داخل مدى وحدات */
export function collectStrings(buf: Uint8Array, toks: Tok[], t0: number, t1: number): Uint8Array {
  const acc: number[] = [];
  for (let i = t0; i <= t1 && i < toks.length; i++) {
    const t = toks[i];
    if (t.k === 'str') {
      acc.push(...unescape(buf, t.a + 1, t.b - 1));
    } else if (t.k === 'hex') {
      let hex = '';
      for (let j = t.a + 1; j < t.b - 1; j++) {
        const ch = String.fromCharCode(buf[j]);
        if (/[0-9a-fA-F]/.test(ch)) hex += ch;
      }
      if (hex.length % 2) hex += '0';
      for (let j = 0; j < hex.length; j += 2) acc.push(parseInt(hex.substr(j, 2), 16));
    }
  }
  return Uint8Array.from(acc);
}

const strip = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * هل تحتوي بايتات النص على الكلمة المطلوبة؟
 * نجرّب عدة ترميزات لأن خطوط PDF المجزّأة قد تستخدم UTF-16 أو ترميزاً مخصصاً.
 */
export function matchesText(raw: Uint8Array, needle: string): boolean {
  if (!raw.length || !needle) return false;
  const target = strip(needle);
  if (!target) return false;

  // latin-1
  if (strip(latin(raw, 0, raw.length)).includes(target)) return true;

  // UTF-16BE / UTF-16LE
  const be: string[] = [];
  const le: string[] = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    be.push(String.fromCharCode((raw[i] << 8) | raw[i + 1]));
    le.push(String.fromCharCode((raw[i + 1] << 8) | raw[i]));
  }
  if (strip(be.join('')).includes(target)) return true;
  if (strip(le.join('')).includes(target)) return true;

  // UTF-8
  try {
    const dec = new TextDecoder('utf-8', { fatal: false }).decode(raw);
    if (strip(dec).includes(target)) return true;
  } catch { /* تجاهل */ }

  // بايتات صفرية متخللة (ترميز مركّب)
  let nz = '';
  for (let i = 0; i < raw.length; i++) if (raw[i]) nz += String.fromCharCode(raw[i]);
  if (strip(nz).includes(target)) return true;

  return false;
}

/** دمج المقاطع المتداخلة */
export function mergeCuts(cuts: Cut[]): Cut[] {
  const sorted = [...cuts].sort((a, b) => a[0] - b[0]);
  const out: Cut[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** حذف المقاطع المحددة من التدفّق */
export function applyCuts(buf: Uint8Array, merged: Cut[]): Uint8Array {
  if (!merged.length) return buf;
  let size = buf.length + merged.length;
  for (const [s, e] of merged) size -= (e - s);
  const out = new Uint8Array(Math.max(size, 0));
  let w = 0;
  let prev = 0;
  for (const [s, e] of merged) {
    out.set(buf.subarray(prev, s), w);
    w += s - prev;
    out[w++] = 0x0a;
    prev = e;
  }
  out.set(buf.subarray(prev), w);
  w += buf.length - prev;
  return out.subarray(0, w);
}

/** تجزئة مبسّطة (FNV-1a) لمقارنة الكتل بين الصفحات */
export function hashRange(buf: Uint8Array, a: number, b: number): string {
  let h = 0x811c9dc5;
  let lastSpace = false;
  for (let i = a; i < b; i++) {
    const c = buf[i];
    const isSpace = SPACE.has(c);
    if (isSpace) {
      if (lastSpace) continue;
      lastSpace = true;
      h ^= 0x20;
    } else {
      lastSpace = false;
      h ^= c;
    }
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

/** ربط عدة تدفّقات محتوى في مخزن واحد (المواصفة تعتبرها متسلسلة) */
export function concatStreams(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const total = parts.reduce((s, p) => s + p.length + 1, 0);
  const out = new Uint8Array(total);
  let w = 0;
  for (const p of parts) {
    out.set(p, w);
    w += p.length;
    out[w++] = 0x0a;
  }
  return out.subarray(0, w);
}
