import { embedLsbInImage } from "@/lib/steganography";

// Real evidence files, generated in the browser. Each one is built so the
// matching instrument finds the clue in it by its own analysis: the email
// headers trace the letter back inside the hospital, the photograph carries a
// message in its pixels' least significant bits, the capture holds a
// cleartext login and a DNS tunnel, the implant matches a YARA rule, the
// PDF's metadata names its author.

export const VISITOR = "D. MORROW";
export const VISITOR_PHONE = "Morrow-iPhone";
export const PASSWORD = "candle";

// ------------------------------------------------------------------ the letter

export function letterEml(): string {
  return [
    "Return-Path: <d.morrow@ashfield-mail.net>",
    "Received: from relay.ashfield-mail.net (relay.ashfield-mail.net [203.0.113.40])",
    "\tby mx.ashfield-mail.net with ESMTPS id 4f17a; Thu, 17 Oct 2024 04:17:52 +0000",
    "Received: from lantern-relay.brookhaven.local (unknown [198.51.100.17])",
    "\tby relay.ashfield-mail.net with ESMTP id 0417b; Thu, 17 Oct 2024 04:17:49 +0000",
    "Received: from [10.4.17.201] (ward2-201.guest.brookhaven.local [10.4.17.201])",
    `\tby lantern-relay.brookhaven.local with ESMTP; Thu, 17 Oct 2024 04:17:31 +0000`,
    "Authentication-Results: mx.ashfield-mail.net; spf=fail smtp.mailfrom=ashfield-mail.net; dkim=none; dmarc=fail header.from=ashfield-mail.net",
    "Received-SPF: fail (ashfield-mail.net: 198.51.100.17 is not a permitted sender)",
    "From: Elena Voss <e.voss@ashfield-mail.net>",
    "Reply-To: d.morrow@ashfield-mail.net",
    "To: d.morrow@ashfield-mail.net",
    "Subject: the network inside is still running",
    "Date: Thu, 17 Oct 2024 04:17:00 +0000",
    "Message-ID: <0417.201@lantern-relay.brookhaven.local>",
    `X-Mailer: LANTERN Relay 2.3 (device: ${VISITOR_PHONE})`,
    "X-Originating-IP: [10.4.17.201]",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "I know you stopped waiting for me. I'm in Brookhaven. Come and find me.",
    "— E.",
    "",
  ].join("\r\n");
}

// ------------------------------------------------------------------ the photograph

/** A grainy photo of room 201, with a message in the pixels' LSBs. */
export async function wardPhoto(): Promise<Blob> {
  const w = 480;
  const h = 360;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#3a3d36");
  g.addColorStop(1, "#141512");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // window light
  ctx.fillStyle = "rgba(200,205,190,0.35)";
  ctx.fillRect(300, 40, 110, 140);
  ctx.fillStyle = "#1a1b18";
  ctx.fillRect(352, 40, 6, 140);
  ctx.fillRect(300, 108, 110, 6);
  // bed
  ctx.fillStyle = "#7d7a6c";
  ctx.fillRect(60, 220, 240, 50);
  ctx.fillStyle = "#3b3a33";
  ctx.fillRect(60, 270, 10, 60);
  ctx.fillRect(290, 270, 10, 60);
  // a woman sitting on the bed, turned away
  ctx.fillStyle = "#0e0e0c";
  ctx.beginPath();
  ctx.arc(170, 150, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(145, 172, 52, 62);
  // grain, and the date stamp
  const img = ctx.getImageData(0, 0, w, h);
  let s = 417;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s >> 8) % 28) - 14;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = "#e0782a";
  ctx.font = "bold 18px monospace";
  ctx.fillText("'24 10 17  04:17", 300, 340);
  const message =
    "If you found this, they haven't found it yet. LANTERN reads everything that touches the network: every phone, every visitor. " +
    "I logged into it once. The capture is still on my phone. They put my phone in the morgue with me. B1. — E.";
  const { result } = embedLsbInImage(ctx.getImageData(0, 0, w, h), { kind: "text", text: message });
  ctx.putImageData(result, 0, 0);
  return new Promise((resolve) => c.toBlob((b) => resolve(b!), "image/png"));
}

// ------------------------------------------------------------------ the capture

/** A classic pcap from Elena's phone: DNS to the LANTERN host, a cleartext
 *  HTTP login, and long DNS labels smuggling the visitor log out. */
export function phoneCapture(): Uint8Array {
  const packets: { t: number; frame: Uint8Array }[] = [];
  const phone = [10, 4, 17, 88];
  const dns = [10, 4, 17, 1];
  const lantern = [10, 4, 17, 5];
  let t = 1729138620; // Thu 17 Oct 2024, 04:17:00
  let ipId = 1;
  const mac = (n: number) => [0x02, 0x04, 0x17, 0x00, 0x00, n];

  const ipv4 = (src: number[], dst: number[], proto: number, payload: Uint8Array) => {
    const h = new Uint8Array(20 + payload.length);
    h[0] = 0x45;
    h[2] = (h.length >> 8) & 0xff;
    h[3] = h.length & 0xff;
    h[4] = (ipId >> 8) & 0xff;
    h[5] = ipId++ & 0xff;
    h[8] = 64;
    h[9] = proto;
    h.set(src, 12);
    h.set(dst, 16);
    let sum = 0;
    for (let i = 0; i < 20; i += 2) sum += (h[i] << 8) | h[i + 1];
    while (sum >> 16) sum = (sum & 0xffff) + (sum >> 16);
    const ck = ~sum & 0xffff;
    h[10] = ck >> 8;
    h[11] = ck & 0xff;
    h.set(payload, 20);
    return h;
  };
  const ether = (src: number, dst: number, ip: Uint8Array) => {
    const f = new Uint8Array(14 + ip.length);
    f.set(mac(dst), 0);
    f.set(mac(src), 6);
    f[12] = 0x08;
    f[13] = 0x00;
    f.set(ip, 14);
    return f;
  };
  const udp = (sport: number, dport: number, data: Uint8Array) => {
    const u = new Uint8Array(8 + data.length);
    u[0] = sport >> 8;
    u[1] = sport & 0xff;
    u[2] = dport >> 8;
    u[3] = dport & 0xff;
    u[4] = u.length >> 8;
    u[5] = u.length & 0xff;
    u.set(data, 8);
    return u;
  };
  let seq = 4170000;
  const tcp = (sport: number, dport: number, flags: number, data: Uint8Array) => {
    const s = new Uint8Array(20 + data.length);
    s[0] = sport >> 8;
    s[1] = sport & 0xff;
    s[2] = dport >> 8;
    s[3] = dport & 0xff;
    s[4] = (seq >> 24) & 0xff;
    s[5] = (seq >> 16) & 0xff;
    s[6] = (seq >> 8) & 0xff;
    s[7] = seq & 0xff;
    seq += Math.max(1, data.length);
    s[12] = 0x50;
    s[13] = flags;
    s[14] = 0xff;
    s[15] = 0xff;
    s.set(data, 20);
    return s;
  };
  const dnsQuery = (id: number, name: string) => {
    const labels = name.split(".");
    const q: number[] = [id >> 8, id & 0xff, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
    for (const l of labels) {
      q.push(l.length);
      for (const ch of l) q.push(ch.charCodeAt(0));
    }
    q.push(0, 0, 1, 0, 1);
    return new Uint8Array(q);
  };
  const enc = (s: string) => new TextEncoder().encode(s);
  const push = (frame: Uint8Array, dt = 0.2) => {
    t += dt;
    packets.push({ t, frame });
  };

  push(ether(88, 1, ipv4(phone, dns, 17, udp(53017, 53, dnsQuery(0x0417, "lantern.brookhaven.local")))));
  // the login, in the clear
  push(ether(88, 5, ipv4(phone, lantern, 6, tcp(49417, 80, 0x02, new Uint8Array()))), 0.05);
  const form = `user=e.voss&pass=${PASSWORD}`;
  const req = `POST /lantern/login HTTP/1.1\r\nHost: lantern.brookhaven.local\r\nContent-Length: ${form.length}\r\n\r\n${form}`;
  push(ether(88, 5, ipv4(phone, lantern, 6, tcp(49417, 80, 0x18, enc(req)))), 0.05);
  const resp = "HTTP/1.1 302 Found\r\nLocation: /console/subjects\r\nSet-Cookie: lantern_session=0417; HttpOnly\r\n\r\n";
  push(ether(5, 88, ipv4(lantern, phone, 6, tcp(80, 49417, 0x18, enc(resp)))), 0.05);
  const get = "GET /console/subjects?filter=visitors&day=thursday HTTP/1.1\r\nHost: lantern.brookhaven.local\r\nCookie: lantern_session=0417\r\n\r\n";
  push(ether(88, 5, ipv4(phone, lantern, 6, tcp(49417, 80, 0x18, enc(get)))), 0.4);
  const body =
    "subject_id,name,device,first_seen,last_seen\r\n" +
    `0201,VOSS E.,Pixel-EV,2021-03-02,2021-10-14\r\n` +
    `0417,${VISITOR},${VISITOR_PHONE},2021-03-04,2024-10-17\r\n`;
  push(ether(5, 88, ipv4(lantern, phone, 6, tcp(80, 49417, 0x18, enc(`HTTP/1.1 200 OK\r\nContent-Type: text/csv\r\n\r\n${body}`)))), 0.05);
  // smuggling the visitor log out, a label at a time
  const secret = `visitor-0417-${VISITOR_PHONE}-connected-every-thursday-sent-the-letter-at-0417`.toLowerCase();
  for (let i = 0; i < secret.length; i += 52) {
    const label = secret.slice(i, i + 52).replace(/[^a-z0-9-]/g, "-");
    push(ether(88, 1, ipv4(phone, dns, 17, udp(53100 + i, 53, dnsQuery(0x1000 + i, `${label}.x.candle-out.net`)))), 1.1);
  }
  // the heartbeat: LANTERN checking that the phone is still there
  for (let k = 0; k < 6; k++) push(ether(88, 5, ipv4(phone, lantern, 17, udp(41700, 4170, enc(`LANTERN-BEACON dev=${VISITOR_PHONE} seq=${k}`)))), 1.1);

  const total = 24 + packets.reduce((n, p) => n + 16 + p.frame.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0xa1b2c3d4, true);
  v.setUint16(4, 2, true);
  v.setUint16(6, 4, true);
  v.setUint32(16, 65535, true);
  v.setUint32(20, 1, true);
  let o = 24;
  for (const p of packets) {
    v.setUint32(o, Math.floor(p.t), true);
    v.setUint32(o + 4, Math.round((p.t % 1) * 1e6), true);
    v.setUint32(o + 8, p.frame.length, true);
    v.setUint32(o + 12, p.frame.length, true);
    out.set(p.frame, o + 16);
    o += 16 + p.frame.length;
  }
  return out;
}

// ------------------------------------------------------------------ the implant

export function implantBinary(): Uint8Array {
  const header = [0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0x3e, 0];
  const strings = [
    "LANTERN/2.3 field implant",
    "beacon_interval_ms=1100",
    "beacon_host=lantern.brookhaven.local:4170",
    "collect=wifi_probe,contacts,location,mail_outbox",
    "subject[0201]=VOSS_E;status=DECEASED;retain=forever",
    `subject[0417]=${VISITOR};device=${VISITOR_PHONE};role=VISITOR_THU`,
    `task[0417]=compose_mail(from=e.voss,to=self,at=04:17,body=letter_template_7)`,
    "operator=DIRECTOR_KESSLER",
    "kill_switch=candle",
  ];
  const parts: number[] = [...header];
  let s = 1701;
  for (let i = 0; i < 600; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    parts.push((s >> 16) & 0xff);
  }
  for (const str of strings) {
    parts.push(0);
    for (const ch of str) parts.push(ch.charCodeAt(0));
    for (let i = 0; i < 40; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      parts.push((s >> 16) & 0xff);
    }
  }
  return new Uint8Array(parts);
}

export const LANTERN_RULE = `rule LANTERN_Implant
{
    meta:
        description = "Brookhaven LANTERN field implant (from the Archive tape)"
        author = "E. Voss"
    strings:
        $name   = "LANTERN/2.3"
        $beacon = "beacon_host=lantern.brookhaven.local"
        $task   = "compose_mail(" ascii
        $elf    = { 7F 45 4C 46 }
    condition:
        $elf at 0 and $name and ($beacon or $task)
}
`;

// ------------------------------------------------------------------ the minutes

export async function minutesPdf(): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const page = doc.addPage([595, 842]);
  const lines = [
    "BROOKHAVEN HOSPITAL - PROJECT LANTERN",
    "Minutes, closed session. Thursday, 14 October 2021.",
    "Present: Director H. Kessler; network contractor (minutes).",
    "",
    "1. The contractor reports that Ms. Voss (Network) logged in",
    "   to the LANTERN console from her own phone on Tuesday.",
    "2. Ms. Voss to be admitted as a patient (ward 2, room 201)",
    "   for her wellbeing. Network access revoked.",
    "3. The contractor asks that his name be kept out of it,",
    "   and that his Thursday visits to 201 not be logged.",
    "   Refused. LANTERN logs everything.",
    "",
    "Minutes taken by: see document properties.",
  ];
  lines.forEach((l, i) => page.drawText(l, { x: 50, y: 780 - i * 18, size: 11, font, color: rgb(0.1, 0.1, 0.1) }));
  doc.setTitle("LANTERN - closed session minutes");
  doc.setAuthor(VISITOR);
  doc.setSubject("Ms. Voss - reported by the contractor");
  doc.setKeywords(["LANTERN", "subject 0201 VOSS", "reported by contractor", "subject 0417 visitor", "do not delete logs"]);
  doc.setCreator("LANTERN console");
  doc.setProducer(`${VISITOR_PHONE} / Notes`);
  const bytes = await doc.save();
  return new Blob([bytes as BlobPart], { type: "application/pdf" });
}
