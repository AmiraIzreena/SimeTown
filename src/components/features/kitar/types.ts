import type { ApiError } from '@/lib/api';
import { MATERIAL_INFO, MATERIALS, type Material } from '@/shared/domain';

/** Loaded data as `useApi` returns it, the shape `Async` takes. */
export interface Loaded<T> {
  data?: T;
  error?: ApiError;
  isLoading: boolean;
  mutate?: () => unknown;
}

/** What GET /kitar returns. The fields added for the Kitar hub are optional: an older server leaves them out. */
export interface KitarMachine {
  id: string;
  name: string;
  status: 'ONLINE' | 'FULL' | 'OFFLINE';
  location: string;
  /** The one material this bin takes; null takes any material. */
  material?: Material | null;
  kiosk_id?: string;
  kiosk?: string;
}

export interface KitarRate {
  material: Material;
  pointsPerKg: number;
  placeholder: boolean;
}

export interface KitarLimits {
  tripsToday: number;
  tripsPerDay: number;
  homeTripsMonth: number;
  homeTripsPerMonth: number;
  homePointsMonth: number;
  homePointsMax: number;
}

export type PointsStatus = 'ON' | 'PROGRAMME_PAUSED' | 'NO_PROMISES' | 'HOME_LIMIT';

export interface KitarOverview {
  monthGrams: number;
  allGrams: number;
  dropOffs: number;
  street: string | null;
  streetMonthGrams: number;
  /** `test`: a practice entry from Kitar test mode. */
  recent: { id: string; material: Material; weight_g: number; created_at: string; kiosk: string; test?: boolean }[];
  kiosks: { id: string; name: string; location: string }[];
  machines: KitarMachine[];
  photoCheck: boolean;
  rates?: KitarRate[];
  monthGramsByMaterial?: Partial<Record<Material, number>>;
  limits?: KitarLimits;
  points?: { status: PointsStatus };
  /** Present only while Kitar test mode is on (local demos): the XP a trip earns, for the practice preview. */
  testEntry?: { xp: number };
}

/** The part of GET /wallet the hub shows. */
export interface WalletSummary {
  totalPoints: number;
  xp: number;
  level: { level: number; name: string; floor: number; next: number };
}

export const isMaterial = (value: unknown): value is Material => typeof value === 'string' && (MATERIALS as readonly string[]).includes(value);

/** A material's label, or the raw value if the server sends one this page does not know, so nothing crashes. */
export const materialLabel = (value: unknown): string => (isMaterial(value) ? MATERIAL_INFO[value].label : String(value ?? ''));
