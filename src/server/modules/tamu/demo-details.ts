import type { DetailsInput } from './visitor-data';

/**
 * Made-up visitor details for demonstrations and demo data. The MyKad-shaped numbers use birthplace code 00, which
 * is never issued, so they cannot belong to anyone. Licences expire two years after the given day.
 */
export function demoVisitorDetails(now: Date, kind: 'collector' | 'family' | 'helper' | 'contractor' | 'rider' = 'collector'): DetailsInput {
  const licence = new Date(now.getTime() + 730 * 86_400_000).toISOString().slice(0, 10);
  switch (kind) {
    case 'family':
      return { citizenship: 'MALAYSIAN', idNumber: '580412-00-5122', transport: 'CAR', vehicleNo: 'BKL 2408', licenceExpiry: licence, reason: 'VISITING' };
    case 'helper':
      return { citizenship: 'NON_MALAYSIAN', idNumber: 'DEMOP4471209', transport: 'ON_FOOT', reason: 'HELPER' };
    case 'contractor':
      return { citizenship: 'MALAYSIAN', idNumber: '880923-00-6031', transport: 'VAN', vehicleNo: 'WA 5521 K', licenceExpiry: licence, reason: 'MAINTENANCE' };
    case 'rider':
      return { citizenship: 'MALAYSIAN', idNumber: '990117-00-7713', transport: 'MOTORCYCLE', vehicleNo: 'VBN 772', licenceExpiry: licence, reason: 'DELIVERY' };
    default:
      return { citizenship: 'MALAYSIAN', idNumber: '850315-00-5521', transport: 'LORRY', vehicleNo: 'BKL 7071', licenceExpiry: licence, reason: 'CONTRACTOR' };
  }
}
