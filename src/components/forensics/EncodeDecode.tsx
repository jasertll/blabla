"use client";

import { useState } from "react";
import { Binary } from "lucide-react";

type Encoding = "base64" | "hex" | "url" | "rot13";

function encode(text: string, enc: Encoding): string {
  switch (enc) {
    case "base64":
      return btoa(unescape(encodeURIComponent(text)));
    case "hex":
      return Array.from(new TextEncoder().encode(text)).map((b) => b.toString(16).padStart(2, "0")).join("");
    case "url":
      return encodeURIComponent(text);
    case "rot13":
      return text.replace(/[a-zA-Z]/g, (c) => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
      });
  }
}

function decode(text: string, enc: Encoding): string {
  switch (enc) {
    case "base64":
      return decodeURIComponent(escape(atob(text)));
    case "hex":
      return new TextDecoder().decode(new Uint8Array((text.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16))));
    case "url":
      return decodeURIComponent(text);
    case "rot13":
      return encode(text, "rot13"); // symmetric
  }
}

export default function EncodeDecode() {
  const [enc, setEnc] = useState<Encoding>("base64");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(direction: "encode" | "decode") {
    setError(null);
    try {
      setOutput(direction === "encode" ? encode(input, enc) : decode(input, enc));
    } catch {
      setError("Couldn't process that input with the selected encoding.");
      setOutput("");
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
        <Binary className="h-3.5 w-3.5 text-accent" /> Encode / Decode
      </p>
      <div className="flex gap-2">
        <select
          value={enc}
          onChange={(e) => setEnc(e.target.value as Encoding)}
          className="bg-panel/60 border border-border rounded-lg px-2 py-1.5 text-xs text-slate-200"
        >
          <option value="base64">Base64</option>
          <option value="hex">Hex</option>
          <option value="url">URL</option>
          <option value="rot13">ROT13</option>
        </select>
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={3}
        placeholder="Paste text or an encoded string…"
        dir="ltr"
        className="w-full bg-panel/60 border border-border rounded-lg p-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent"
      />
      <div className="flex gap-2">
        <button onClick={() => run("encode")} className="text-xs px-2.5 py-1 rounded-md bg-accent/80 hover:bg-accent text-white transition-colors">Encode</button>
        <button onClick={() => run("decode")} className="text-xs px-2.5 py-1 rounded-md bg-panel border border-border hover:border-accent/50 text-slate-200 transition-colors">Decode</button>
      </div>
      {error && <p className="text-xs text-red-300">{error}</p>}
      {output && <div className="rounded-lg bg-[#0d0a18] border border-border p-2 text-xs font-mono text-slate-300 break-all">{output}</div>}
    </div>
  );
}
