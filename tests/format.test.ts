import { describe, expect, it } from 'vitest';
import { formatDuration } from '@/lib/format';

describe('formatDuration', () => {
  it('reads like a person would say it', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(135)).toBe('2 h 15 min');
    expect(formatDuration(1440)).toBe('1 day');
    expect(formatDuration(1500)).toBe('1 day 1 h');
    expect(formatDuration(18557.3)).toBe('12 days 21 h'); // the open demo flood event
  });
});
