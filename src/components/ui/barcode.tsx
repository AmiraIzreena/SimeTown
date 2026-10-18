import { LocalizedSvg } from '@/components/ui/localized-elements';

/**
 * A Code 128 (set B) barcode as SVG: the 1D symbology most shipping labels
 * use, readable by phone cameras and USB scanners. Encodes printable ASCII.
 */

// Bar and space widths for each of the 107 Code 128 symbols (0-105, then the stop pattern).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** The module widths of the whole symbol, quiet zones excluded. */
export function code128Modules(text: string): number[] {
  const codes = [START_B, ...[...text].map((ch) => {
    const v = ch.charCodeAt(0) - 32;
    if (v < 0 || v > 94) throw new Error('Code 128 B encodes printable ASCII only.');
    return v;
  })];
  const checksum = codes.reduce((sum, code, i) => sum + code * (i === 0 ? 1 : i), 0) % 103;
  return [...codes, checksum, STOP].flatMap((code) => [...PATTERNS[code]!].map(Number));
}

export function Barcode({ value, height = 64, label }: { value: string; height?: number; label: string }) {
  const modules = code128Modules(value);
  const quiet = 10;
  const width = modules.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const bars: { x: number; w: number }[] = [];
  modules.forEach((w, i) => {
    if (i % 2 === 0) bars.push({ x, w });
    x += w;
  });
  return (
    <LocalizedSvg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-auto w-full max-w-sm bg-white" preserveAspectRatio="none" style={{ aspectRatio: `${width} / ${height}` }}>
      {bars.map((b, i) => <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />)}
    </LocalizedSvg>
  );
}
