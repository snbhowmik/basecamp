// A short deterministic run of bar widths (1-4) from a seed — so the same request
// always draws the same "barcode". Decoration only: it is not scannable and not
// random. What actually resolves a request is its reference text and the QR.
export function decorativeBars(seed: string): number[] {
  const s = seed || '0';
  const bars: number[] = [];
  for (let i = 0; i < 40; i++) bars.push(1 + ((s.charCodeAt(i % s.length) + i) % 4));
  return bars;
}
