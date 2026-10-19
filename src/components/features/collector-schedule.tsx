'use client';

import { Text } from '@/components/ui/localized-text';

import { Fragment } from 'react';
import { describeSchedule } from '@/shared/collector-schedule';

/** When a collector works, in plain words: "Weekdays · Morning", "Mon, Wed · Both", or their own older text. */
export function ScheduleText({ stored }: { stored: string }) {
  const d = describeSchedule(stored);
  if ('legacy' in d) return <Text>{d.legacy}</Text>;
  return (
    <>
      {d.days.map((day, i) => <Fragment key={day}>{i > 0 && ', '}<Text>{day}</Text></Fragment>)}
      {' · '}<Text>{d.time}</Text>
    </>
  );
}
