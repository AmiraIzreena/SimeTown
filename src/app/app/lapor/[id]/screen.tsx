'use client';
import { Button } from '@/components/ui/button';
import { Card, PageHeader } from '@/components/ui/card';
import { Async, SkeletonList } from '@/components/ui/feedback';
import { Text } from '@/components/ui/localized-text';
import { ReportProgress, ReportPhoto, FixedPhoto, StatusBadge, categoryLabel, type Report } from '@/components/features/report-bits';
import { useApi } from '@/lib/hooks';
export default function ReportDetail({ id }: { id: string }) {
  const report = useApi<Report>(`/reports/${encodeURIComponent(id)}`);
  return <>
    <PageHeader title="Report details" action={<Button variant="secondary" href="/app/lapor"><Text>Open Lapor</Text></Button>} />
    <Async state={report} skeleton={<SkeletonList rows={2} />}>{(r) => <Card className="space-y-4 p-5">
      <div><h2 className="font-semibold"><Text>{categoryLabel(r.category)}</Text></h2><p className="text-sm text-ink-500">{r.location_text}</p></div>
      <StatusBadge status={r.status} /><ReportProgress report={r} />
      <p className="whitespace-pre-wrap text-sm">{r.description}</p><ReportPhoto report={r} />
      {r.staff_note && <div className="rounded-lg bg-brand-50 p-4"><p className="font-semibold"><Text>From the township team</Text></p><p className="mt-1 text-sm">{r.staff_note}</p></div>}
      <FixedPhoto report={r} />
    </Card>}</Async>
  </>;
}
