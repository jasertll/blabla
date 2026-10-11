// Real face detection via BlazeFace (Google's lightweight real-time face
// detector, distributed as a pretrained TensorFlow.js model) — runs
// entirely client-side via WebGL, no server, no API key, consistent
// with this app's keyless/local-processing philosophy. Lazy-loaded
// (dynamic import) only when the analyst actually runs face analysis,
// same pattern as this codebase's other heavy on-demand engines
// (lib/yara/engine.ts's WASM, lib/c2pa/verify.ts's WASM).
//
// STRICT SCOPE: this module detects faces and derives IMAGE-QUALITY
// signals only (resolution, blur, brightness, rough pose from keypoint
// geometry). It never attempts identity inference — there is no
// recognition/embedding model here, only detection + geometry, which is
// the hard boundary the spec's section 6 restriction requires.
import type { FaceDetection } from "./types";

let modelPromise: Promise<any> | null = null;

async function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const tf = await import("@tensorflow/tfjs");
      await tf.ready();
      const blazeface = await import("@tensorflow-models/blazeface");
      return blazeface.load();
    })().catch((err) => {
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

/** Laplacian-variance blur metric — a real, standard, textbook sharpness
 * measure (the variance of the second-derivative/edge-response image;
 * a blurry region has few sharp edges, so its Laplacian response is
 * low-variance). Operates on a grayscale crop. */
function laplacianVariance(gray: Float64Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  const responses: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap =
        -4 * gray[i] +
        gray[i - 1] +
        gray[i + 1] +
        gray[i - width] +
        gray[i + width];
      responses.push(lap);
    }
  }
  const mean = responses.reduce((a, b) => a + b, 0) / responses.length;
  const variance = responses.reduce((a, b) => a + (b - mean) ** 2, 0) / responses.length;
  return variance;
}

function estimateYaw(landmarks: number[][]): FaceDetection["estimatedYaw"] {
  // landmarks order from BlazeFace: rightEye, leftEye, nose, mouth, rightEar, leftEar
  const [rightEye, leftEye] = landmarks;
  const eyeMidX = (rightEye[0] + leftEye[0]) / 2;
  const eyeDist = Math.abs(leftEye[0] - rightEye[0]);
  if (eyeDist < 1) return "unknown";
  const noseX = landmarks[2][0];
  const offset = (noseX - eyeMidX) / eyeDist;
  if (offset > 0.35) return "right-profile";
  if (offset < -0.35) return "left-profile";
  return "frontal";
}

export async function detectFaces(canvas: HTMLCanvasElement): Promise<FaceDetection[]> {
  const model = await getModel();
  const predictions = await model.estimateFaces(canvas, false);

  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const results: FaceDetection[] = [];
  for (let idx = 0; idx < predictions.length; idx++) {
    const p = predictions[idx];
    const topLeft = Array.isArray(p.topLeft) ? p.topLeft : await p.topLeft.data();
    const bottomRight = Array.isArray(p.bottomRight) ? p.bottomRight : await p.bottomRight.data();
    const landmarksRaw = Array.isArray(p.landmarks) ? p.landmarks : await p.landmarks.array();

    const x = Math.max(0, Math.round(topLeft[0]));
    const y = Math.max(0, Math.round(topLeft[1]));
    const width = Math.max(1, Math.round(bottomRight[0] - topLeft[0]));
    const height = Math.max(1, Math.round(bottomRight[1] - topLeft[1]));
    const clampedW = Math.min(width, canvas.width - x);
    const clampedH = Math.min(height, canvas.height - y);
    if (clampedW <= 0 || clampedH <= 0) continue;

    const faceImageData = ctx.getImageData(x, y, clampedW, clampedH);
    const gray = new Float64Array(clampedW * clampedH);
    let brightnessSum = 0;
    for (let i = 0; i < clampedW * clampedH; i++) {
      const r = faceImageData.data[i * 4];
      const g = faceImageData.data[i * 4 + 1];
      const b = faceImageData.data[i * 4 + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      gray[i] = luma;
      brightnessSum += luma;
    }
    const brightness = brightnessSum / (clampedW * clampedH);
    const blur = laplacianVariance(gray, clampedW, clampedH);
    const resolutionPx = clampedW * clampedH;

    // Quality score: a weighted, bounded combination of resolution,
    // sharpness, and lighting — each term clamped to [0,1] before
    // weighting, so one wildly out-of-range input can't blow out the
    // final 0-100 score. Weights sum to 1.0.
    const resScore = Math.min(1, resolutionPx / (120 * 120)); // 120x120px treated as "good enough"
    const blurScore = Math.min(1, blur / 150); // empirical: >150 variance reads as acceptably sharp for a face crop
    const brightnessScore = 1 - Math.min(1, Math.abs(brightness - 128) / 128); // penalize too dark or too blown-out
    const qualityScore = Math.round((resScore * 0.4 + blurScore * 0.4 + brightnessScore * 0.2) * 100);

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = clampedW;
    cropCanvas.height = clampedH;
    cropCanvas.getContext("2d")!.putImageData(faceImageData, 0, 0);

    const landmarkPoints = landmarksRaw as number[][];
    results.push({
      id: `face-${idx}`,
      bbox: { x, y, width: clampedW, height: clampedH },
      landmarks: {
        rightEye: [landmarkPoints[0][0], landmarkPoints[0][1]],
        leftEye: [landmarkPoints[1][0], landmarkPoints[1][1]],
        nose: [landmarkPoints[2][0], landmarkPoints[2][1]],
        mouth: [landmarkPoints[3][0], landmarkPoints[3][1]],
        rightEar: [landmarkPoints[4]?.[0] ?? 0, landmarkPoints[4]?.[1] ?? 0],
        leftEar: [landmarkPoints[5]?.[0] ?? 0, landmarkPoints[5]?.[1] ?? 0],
      },
      detectionConfidence: Array.isArray(p.probability) ? p.probability[0] : await p.probability.data().then((d: Float32Array) => d[0]),
      qualityScore,
      blurScore: blur,
      resolutionPx,
      brightnessEstimate: brightness,
      estimatedYaw: estimateYaw(landmarkPoints),
      cropDataUrl: cropCanvas.toDataURL("image/jpeg", 0.85),
    });
  }

  return results;
}
