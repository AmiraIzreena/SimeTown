
import { Text } from '@/components/ui/localized-text';
import { LocalizedSvg } from '@/components/ui/localized-elements';
/**
 * A drawn test picture for the camera reading (proposal 6.5): a drain with a
 * painted measuring post, the water at a known level. Night and glare
 * versions show the conditions that lower the model's confidence.
 */
export function FloodPicture({ pct, night = false, glare = false, className }: { pct: number; night?: boolean; glare?: boolean; className?: string }) {
  const top = 18;
  const bottom = 132;
  const waterY = bottom - ((bottom - top) * pct) / 100;
  return (
    <LocalizedSvg viewBox="0 0 160 150" role="img" aria-label={`Test picture: water at ${pct}% of the measuring post${night ? ', at night in heavy rain' : glare ? ', with glare' : ''}`} className={className}>
      <rect width="160" height="150" fill={night ? '#0b1a24' : '#cfe3ea'} />
      <rect x="0" y="0" width="22" height="150" fill={night ? '#1b2a33' : '#9aa8a0'} />
      <rect x="138" y="0" width="22" height="150" fill={night ? '#1b2a33' : '#9aa8a0'} />
      <rect x="74" y={top - 6} width="14" height={bottom - top + 12} fill="#f4f1e6" stroke="#5d6b66" />
      {Array.from({ length: 11 }, (_, i) => {
        const y = bottom - ((bottom - top) * i) / 10;
        return (
          <g key={i}>
            <line x1={i % 5 === 0 ? 70 : 74} x2="88" y1={y} y2={y} stroke={i >= 9 ? '#b91229' : i >= 7.5 ? '#a8650c' : '#374040'} strokeWidth={i % 5 === 0 ? 2 : 1} />
            {i % 2 === 0 && (
              <text x="92" y={y + 3} fontSize="8" fill={night ? '#9fb3bd' : '#374040'}>
                <Text>{i * 10}</Text>
              </text>
            )}
          </g>
        );
      })}
      <rect x="22" y={waterY} width="116" height={150 - waterY} fill={night ? '#173b4f' : '#5f8fa3'} opacity="0.85" />
      <path d={`M22 ${waterY} q12 -3 24 0 t24 0 t24 0 t24 0 t20 0`} fill="none" stroke={night ? '#2d5b73' : '#cde6ee'} strokeWidth="2" />
      {glare && <ellipse cx="96" cy={waterY - 4} rx="40" ry="10" fill="white" opacity="0.75" />}
      {night &&
        Array.from({ length: 22 }, (_, i) => <line key={i} x1={(i * 37) % 160} y1={(i * 23) % 150} x2={((i * 37) % 160) - 5} y2={((i * 23) % 150) + 14} stroke="#8fb0c0" strokeWidth="1" opacity="0.6" />)}
    </LocalizedSvg>
  );
}
