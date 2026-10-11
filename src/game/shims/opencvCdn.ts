// Static-build stand-in for `@techstark/opencv-js` (13 MB, too large to ship
// as one artifact file). Loads the exact same version's UMD build from
// jsDelivr on first use and hands back what the package itself exports: a
// Promise that resolves to the ready `cv` namespace.

const VERSION = "5.0.0-release.1";

const ready: Promise<unknown> = new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = `https://cdn.jsdelivr.net/npm/@techstark/opencv-js@${VERSION}/dist/opencv.js`;
  s.async = true;
  s.onload = () => resolve((window as unknown as { cv: unknown }).cv);
  s.onerror = () => reject(new Error("OpenCV could not be downloaded"));
  document.head.appendChild(s);
});

export default ready;
