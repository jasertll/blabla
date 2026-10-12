import type { NextConfig } from "next";

// Security headers ported from the tools' original next.config.js, with the
// fonts this hospital UI loads from Google Fonts added to style-src/font-src.
const csp = [
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "media-src 'self' blob:",
  // pwnedpasswords: k-anonymity check from the browser; jsdelivr: tesseract.js OCR;
  // tfhub/storage.googleapis: TensorFlow.js face/object models (Image Threat Intelligence)
  "connect-src 'self' https://api.pwnedpasswords.com https://cdn.jsdelivr.net https://tfhub.dev https://storage.googleapis.com",
  "worker-src 'self' blob:",
  "frame-src https://cyberattackmap.net",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_ID: new Date().toISOString().replace("T", " ").slice(0, 16) + "Z",
  },
  // @techstark/opencv-js references require("fs") in a dead branch; Turbopack
  // still needs something to resolve it to in the browser build.
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/lib/emptyNodeModuleStub.ts" },
      path: { browser: "./src/lib/emptyNodeModuleStub.ts" },
      crypto: { browser: "./src/lib/emptyNodeModuleStub.ts" },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // the static copy of the hospital (a private artifact) calls these from another origin
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    ];
  },
};

export default nextConfig;
