import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

// Model loading that also works where .glb files can't be served: when the
// page sets `window.__B64_ASSETS`, models are fetched as base64 text
// (`<url>.b64.txt`) and decoded in the browser.

const cache = new Map<string, Promise<GLTF>>();

export function loadGLTF(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const loader = new GLTFLoader();
      if ((window as unknown as { __B64_ASSETS?: boolean }).__B64_ASSETS) {
        const text = await (await fetch(`${url}.b64.txt`)).text();
        const bin = Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0));
        return loader.parseAsync(bin.buffer, "");
      }
      return loader.loadAsync(url);
    })();
    cache.set(url, p);
  }
  return p;
}
