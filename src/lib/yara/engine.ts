/**
 * lib/yara/engine.ts — a real YARA engine, entirely client-side, using
 * VirusTotal/Google's official `@virustotal/yara-x` package (a
 * WebAssembly build of YARA-X, the Rust-based successor to the original
 * C libyara that VirusTotal itself now uses in production). Unlike
 * lib/malwareIndicators.ts's curated string table — which is explicit
 * about only approximating the kind of matching a YARA `strings:` block
 * does — this compiles and runs *actual* YARA rule syntax against real
 * file bytes: real pattern matching (text/hex/regex), real `condition:`
 * logic, real tags/metadata, real match offsets. Nothing here is
 * simulated or approximated.
 *
 * The WASM binary (~6MB) is only loaded the first time this module is
 * used, matching the lazy-load pattern lib/c2pa/verify.ts already uses
 * for its own WASM engine.
 */

import init, { Compiler } from "@virustotal/yara-x";

let initPromise: Promise<void> | null = null;

function getEngine(): Promise<void> {
  if (!initPromise) {
    initPromise = init({ module_or_path: "yara_x_js_bg.wasm" }).then(() => undefined).catch((err) => {
      initPromise = null; // allow retrying on the next call instead of caching a permanent failure
      throw err;
    });
  }
  return initPromise;
}

export type YaraPatternMatch = { offset: number; length: number };
export type YaraPattern = { identifier: string; kind: string; isPrivate: boolean; matches: YaraPatternMatch[] };
export type YaraRuleMetadata = { identifier: string; value: unknown };
export type YaraRuleMatch = {
  identifier: string;
  namespace: string;
  isPrivate: boolean;
  isGlobal: boolean;
  tags: string[];
  metadata: YaraRuleMetadata[];
  patterns: YaraPattern[];
};
export type YaraScanResult = { valid: boolean; matches: YaraRuleMatch[]; warnings: string[] };

export type YaraCompileResult =
  | { ok: true; scan: (bytes: Uint8Array) => YaraScanResult; dispose: () => void; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

// Defense-in-depth bounds on a single scan — this is a public tool where
// anyone can paste an arbitrary rule and an arbitrary file, so a rule
// that's accidentally (or deliberately) pathological shouldn't be able
// to hang the tab or flood the results list. YARA-X's own regex engine
// is NFA-based (not backtracking), so classic ReDoS patterns don't
// appear to cause the blowup they would in a backtracking engine — this
// is still wired up as a documented, real safety net rather than relying
// on that alone.
const SCAN_TIMEOUT_MS = 10_000;
const MAX_MATCHES_PER_PATTERN = 1000;

/** Loading the WASM engine failed (network hiccup, unsupported browser,
 * etc.) — distinct from a rule compilation failure, surfaced separately
 * so the UI can tell "the engine itself didn't load" from "your rule has
 * a syntax error." */
export class YaraEngineLoadError extends Error {}

/**
 * Compiles real YARA-X source and returns either a ready-to-use scanner
 * or the real compiler diagnostics — never silently falls back to "no
 * matches" on a bad rule. Each call gets its own Compiler/Rules
 * instance (freed once scanning is done) rather than keeping engine
 * state alive across calls, since this is a one-shot "compile, scan,
 * show results" tool rather than a long-running scanner.
 */
export async function compileYaraSource(source: string): Promise<YaraCompileResult> {
  try {
    await getEngine();
  } catch {
    throw new YaraEngineLoadError("تعذر تحميل محرك YARA-X (مشكلة شبكة على الأغلب) — جرب تاني.");
  }

  const compiler = new Compiler();
  try {
    compiler.addSource(source);
    if (compiler.errors.length > 0) {
      return { ok: false, errors: compiler.errors, warnings: compiler.warnings };
    }
    const rules = compiler.build();
    const warnings = rules.warnings;
    const scanner = rules.scanner();
    scanner.setTimeoutMs(SCAN_TIMEOUT_MS);
    scanner.setMaxMatchesPerPattern(MAX_MATCHES_PER_PATTERN);
    return {
      ok: true,
      warnings,
      scan: (bytes: Uint8Array): YaraScanResult => {
        const result = scanner.scan(bytes) as YaraScanResult;
        // Private rules exist only as building blocks for other rules'
        // conditions — real `yara` never lists them as detections in
        // its own output, and the JS API here doesn't filter them on
        // its own (confirmed directly: a private rule's own match
        // entry comes back with isPrivate: true but is NOT excluded
        // from `matches`), so surfacing one as if it were an ordinary
        // finding would be misleading. They still correctly influence
        // whichever public rule's condition references them — only the
        // separate, user-facing "detection" entry is dropped.
        return { ...result, matches: result.matches.filter((m) => !m.isPrivate) };
      },
      // Rules/Scanner live in the WASM heap, separate from JS's GC'd
      // heap — the caller must call this once done scanning (new
      // compile, or component unmount) or it leaks there for the rest
      // of the session. See the package's own README on this.
      dispose: () => {
        scanner.free();
        rules.free();
      },
    };
  } catch (e) {
    // addSource() throws (rather than just populating .errors) for some
    // classes of syntax error — surface that message the same way as a
    // normal compiler error instead of letting it become an unhandled
    // exception.
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [message], warnings: compiler.warnings };
  } finally {
    compiler.free();
  }
}
