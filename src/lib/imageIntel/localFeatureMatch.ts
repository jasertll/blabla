// Real local-feature matching via OpenCV.js (the official OpenCV build
// compiled to WASM) — ORB keypoint detection, a brute-force Hamming
// matcher with Lowe's ratio test, and RANSAC homography estimation to
// verify the matches are geometrically consistent (not just locally
// similar-looking patches). This is the same pipeline real CV tooling
// uses to answer "do these two images share the same underlying
// photographed scene/object" — evidence for image similarity, never
// identity (spec section 10).
//
// @techstark/opencv-js's module export IS a Promise that resolves to
// the ready `cv` namespace once its WASM runtime finishes initializing
// (confirmed by reading its own dist/opencv.js UMD wrapper directly —
// `module.exports = factory()`, and factory()'s own return value is
// `cv(Module)`, itself a Promise). Lazy-loaded on first use, same
// pattern as every other heavy engine in this app.
import type { LocalFeatureMatchResult } from "./types";

let cvPromise: Promise<any> | null = null;

async function getCv(): Promise<any> {
  if (!cvPromise) {
    cvPromise = (async () => {
      const mod: any = await import("@techstark/opencv-js");
      const ready = mod.default ?? mod;
      return typeof ready?.then === "function" ? await ready : ready;
    })().catch((err) => {
      cvPromise = null;
      throw err;
    });
  }
  return cvPromise;
}

const MAX_FEATURES = 1000;
const RATIO_TEST_THRESHOLD = 0.75; // Lowe's ratio test, the standard value from the original SIFT paper
const RANSAC_REPROJ_THRESHOLD = 4.0;
const MIN_MATCHES_FOR_HOMOGRAPHY = 4; // a homography needs at least 4 point correspondences

export async function matchLocalFeatures(canvasA: HTMLCanvasElement, canvasB: HTMLCanvasElement): Promise<LocalFeatureMatchResult> {
  const cv = await getCv();

  const matA = cv.imread(canvasA);
  const matB = cv.imread(canvasB);
  const grayA = new cv.Mat();
  const grayB = new cv.Mat();
  const keypointsA = new cv.KeyPointVector();
  const keypointsB = new cv.KeyPointVector();
  const descriptorsA = new cv.Mat();
  const descriptorsB = new cv.Mat();
  const orb = new cv.ORB(MAX_FEATURES);
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knnMatches = new cv.DMatchVectorVector();

  const cleanup: any[] = [matA, matB, grayA, grayB, keypointsA, keypointsB, descriptorsA, descriptorsB, orb, matcher, knnMatches];
  let homographyMask: any = null;
  let srcPointsMat: any = null;
  let dstPointsMat: any = null;
  let homography: any = null;
  let matchPreviewMat: any = null;

  try {
    cv.cvtColor(matA, grayA, cv.COLOR_RGBA2GRAY);
    cv.cvtColor(matB, grayB, cv.COLOR_RGBA2GRAY);

    orb.detectAndCompute(grayA, new cv.Mat(), keypointsA, descriptorsA);
    orb.detectAndCompute(grayB, new cv.Mat(), keypointsB, descriptorsB);

    const kA = keypointsA.size();
    const kB = keypointsB.size();

    if (kA < 8 || kB < 8 || descriptorsA.rows === 0 || descriptorsB.rows === 0) {
      return { status: "insufficient-features", message: `Too few keypoints detected (${kA} vs ${kB}) — image likely too small, flat, or low-contrast for reliable local-feature matching.`, keypointsA: kA, keypointsB: kB, goodMatches: 0, goodMatchRatio: 0, inlierCount: 0, inlierRatio: 0, geometricallyConsistent: false, matchPreviewDataUrl: null };
    }

    matcher.knnMatch(descriptorsA, descriptorsB, knnMatches, 2);

    const goodMatches: { queryIdx: number; trainIdx: number }[] = [];
    for (let i = 0; i < knnMatches.size(); i++) {
      const pair = knnMatches.get(i);
      if (pair.size() < 2) continue;
      const m = pair.get(0);
      const n = pair.get(1);
      if (m.distance < RATIO_TEST_THRESHOLD * n.distance) {
        goodMatches.push({ queryIdx: m.queryIdx, trainIdx: m.trainIdx });
      }
    }

    const goodMatchRatio = Math.min(kA, kB) > 0 ? goodMatches.length / Math.min(kA, kB) : 0;

    let inlierCount = 0;
    let geometricallyConsistent = false;
    if (goodMatches.length >= MIN_MATCHES_FOR_HOMOGRAPHY) {
      const srcPts: number[] = [];
      const dstPts: number[] = [];
      for (const m of goodMatches) {
        const ptA = keypointsA.get(m.queryIdx).pt;
        const ptB = keypointsB.get(m.trainIdx).pt;
        srcPts.push(ptA.x, ptA.y);
        dstPts.push(ptB.x, ptB.y);
      }
      srcPointsMat = cv.matFromArray(goodMatches.length, 1, cv.CV_32FC2, srcPts);
      dstPointsMat = cv.matFromArray(goodMatches.length, 1, cv.CV_32FC2, dstPts);
      homographyMask = new cv.Mat();
      homography = cv.findHomography(srcPointsMat, dstPointsMat, cv.RANSAC, RANSAC_REPROJ_THRESHOLD, homographyMask);

      if (!homography.empty()) {
        for (let i = 0; i < homographyMask.rows; i++) {
          if (homographyMask.data[i] === 1) inlierCount++;
        }
        geometricallyConsistent = inlierCount >= MIN_MATCHES_FOR_HOMOGRAPHY && inlierCount / goodMatches.length >= 0.15;
      }
    }
    const inlierRatio = goodMatches.length > 0 ? inlierCount / goodMatches.length : 0;

    // Visual proof, not just numbers — a real side-by-side drawn match
    // overlay the analyst can actually inspect.
    let matchPreviewDataUrl: string | null = null;
    try {
      matchPreviewMat = new cv.Mat();
      const dmatchVector = new cv.DMatchVector();
      for (const m of goodMatches.slice(0, 60)) {
        dmatchVector.push_back(new cv.DMatch(m.queryIdx, m.trainIdx, 0, 0));
      }
      cv.drawMatches(matA, keypointsA, matB, keypointsB, dmatchVector, matchPreviewMat);
      const previewCanvas = document.createElement("canvas");
      cv.imshow(previewCanvas, matchPreviewMat);
      matchPreviewDataUrl = previewCanvas.toDataURL("image/jpeg", 0.85);
      dmatchVector.delete();
    } catch {
      matchPreviewDataUrl = null;
    }

    return {
      status: "ok",
      keypointsA: kA,
      keypointsB: kB,
      goodMatches: goodMatches.length,
      goodMatchRatio,
      inlierCount,
      inlierRatio,
      geometricallyConsistent,
      matchPreviewDataUrl,
    };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Local feature matching failed.", keypointsA: 0, keypointsB: 0, goodMatches: 0, goodMatchRatio: 0, inlierCount: 0, inlierRatio: 0, geometricallyConsistent: false, matchPreviewDataUrl: null };
  } finally {
    for (const m of [...cleanup, homographyMask, srcPointsMat, dstPointsMat, homography, matchPreviewMat]) {
      try {
        m?.delete?.();
      } catch {
        // already freed or never allocated — ignore
      }
    }
  }
}
