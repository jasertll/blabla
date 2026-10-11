"use client";

// Minimal stand-in for next/dynamic, used only by the static (non-Next)
// build of the hospital. Supports the `() => import(...)` + `loading` form
// the tools use.

import { lazy, Suspense, type ComponentType } from "react";

type Opts = { ssr?: boolean; loading?: () => React.ReactNode };

export default function dynamic<P extends object>(loader: () => Promise<{ default: ComponentType<P> } | ComponentType<P>>, opts: Opts = {}) {
  const L = lazy(async () => {
    const m = await loader();
    return "default" in (m as object) ? (m as { default: ComponentType<P> }) : { default: m as ComponentType<P> };
  });
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={opts.loading ? opts.loading() : null}>
        <L {...props} />
      </Suspense>
    );
  };
}
