// Real bootstrap resampling — legitimate at any sample size. A small
// sample doesn't produce a fake-precise number here; it produces a wide
// confidence interval, which is itself the honest signal that the point
// estimate isn't trustworthy yet. That's the whole point of using this
// instead of just reporting the raw mean.

export type BootstrapResult = {
  expectancyMean: number;
  expectancyCI: [number, number];
  profitFactorMean: number | null;
  profitFactorCI: [number | null, number | null];
  iterations: number;
  sampleSize: number;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.floor(p * (sorted.length - 1));
  return sorted[idx];
}

export function bootstrapTradeMetrics(rMultiples: number[], iterations = 1000): BootstrapResult | null {
  if (rMultiples.length === 0) return null;

  const expectancies: number[] = [];
  const profitFactors: number[] = [];

  for (let iter = 0; iter < iterations; iter++) {
    const sample: number[] = [];
    for (let i = 0; i < rMultiples.length; i++) {
      sample.push(rMultiples[Math.floor(Math.random() * rMultiples.length)]);
    }

    expectancies.push(sample.reduce((s, v) => s + v, 0) / sample.length);

    const gains = sample.filter((v) => v > 0).reduce((s, v) => s + v, 0);
    const losses = Math.abs(sample.filter((v) => v <= 0).reduce((s, v) => s + v, 0));
    if (losses > 0) profitFactors.push(gains / losses);
  }

  expectancies.sort((a, b) => a - b);
  profitFactors.sort((a, b) => a - b);

  const lo = percentile(expectancies, 0.025) ?? 0;
  const hi = percentile(expectancies, 0.975) ?? 0;
  const pfLo = percentile(profitFactors, 0.025);
  const pfHi = percentile(profitFactors, 0.975);

  return {
    expectancyMean: Number((expectancies.reduce((s, v) => s + v, 0) / expectancies.length).toFixed(3)),
    expectancyCI: [Number(lo.toFixed(3)), Number(hi.toFixed(3))],
    profitFactorMean: profitFactors.length > 0 ? Number((profitFactors.reduce((s, v) => s + v, 0) / profitFactors.length).toFixed(2)) : null,
    profitFactorCI: [pfLo != null ? Number(pfLo.toFixed(2)) : null, pfHi != null ? Number(pfHi.toFixed(2)) : null],
    iterations,
    sampleSize: rMultiples.length,
  };
}
