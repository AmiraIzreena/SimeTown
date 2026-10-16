import { describe, expect, it } from 'vitest';
import { parsePassRequest } from '@/server/modules/assistant/pass-request';

/** Reading a visitor pass request in English and Bahasa Malaysia. Today is Monday 2 November 2026. */

const TODAY = '2026-11-02';
const read = (text: string) => parsePassRequest(text, TODAY);

describe('visitor pass requests', () => {
  it('reads the name, day, start time and length in English', () => {
    expect(read('Make a visitor pass for Ali tomorrow at 3pm for 4 hours')).toEqual({ visitorName: 'Ali', date: '2026-11-03', startTime: '15:00', hours: 4 });
    expect(read('Visitor pass for Mak Cik Rosnah today 9:30 am')).toEqual({ visitorName: 'Mak Cik Rosnah', date: '2026-11-02', startTime: '09:30' });
    expect(read('pass for Siti at 18:45')).toMatchObject({ visitorName: 'Siti', startTime: '18:45' });
    expect(read('A pass for Ravi at noon')).toMatchObject({ startTime: '12:00' });
    expect(read('Visitor for Ali at 12am')).toMatchObject({ startTime: '00:00' });
  });

  it('reads the same in Bahasa Malaysia', () => {
    expect(read('Buat pas pelawat untuk Ali esok pukul 3 petang selama 2 jam')).toEqual({ visitorName: 'Ali', date: '2026-11-03', startTime: '15:00', hours: 2 });
    expect(read('pas untuk Aminah lusa pukul 10 pagi')).toMatchObject({ visitorName: 'Aminah', date: '2026-11-04', startTime: '10:00' });
    expect(read('pelawat untuk Farid hari ini jam 8 malam')).toMatchObject({ date: '2026-11-02', startTime: '20:00' });
    expect(read('pelawat untuk Farid pukul 1 tengah hari')).toMatchObject({ startTime: '13:00' });
  });

  it('works out weekdays and dates', () => {
    expect(read('visitor for Ali on Saturday').date).toBe('2026-11-07');
    expect(read('visitor for Ali on Monday').date).toBe(TODAY);
    expect(read('visitor for Ali next Monday').date).toBe('2026-11-09');
    expect(read('pelawat untuk Ali hari Sabtu').date).toBe('2026-11-07');
    expect(read('visitor for Ali on 20 Nov').date).toBe('2026-11-20');
    expect(read('visitor for Ali on 5 Okt').date).toBe('2027-10-05'); // already past this year
    expect(read('visitor for Ali on 25/12').date).toBe('2026-12-25');
    expect(read('visitor for Ali on 2026-11-30').date).toBe('2026-11-30');
    expect(read('visitor for Ali on 31 Feb').date).toBeUndefined();
  });

  it('reads the kind of pass and the car plate', () => {
    expect(read('delivery pass for Lalamove tomorrow')).toMatchObject({ visitorName: 'Lalamove', type: 'DELIVERY' });
    expect(read('pass for Ahmad family for the kenduri on Sabtu, car WXY 1234')).toMatchObject({ visitorName: 'Ahmad family', type: 'EVENT', vehicleNo: 'WXY 1234' });
  });

  it('never mistakes a time, a length or a day for a name', () => {
    expect(read('Make a pass for 4 hours for Ali').visitorName).toBe('Ali');
    expect(read('visitor pass for tomorrow for Ali').visitorName).toBe('Ali');
    expect(read('make a visitor pass tomorrow').visitorName).toBeUndefined();
    expect(read('pass for Ali and Abu').visitorName).toBe('Ali');
    expect(read('pas untuk Ali pukul 3 petang').hours).toBeUndefined(); // "3" is the time, not 3 hours
  });
});
