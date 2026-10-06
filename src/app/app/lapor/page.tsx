'use client';

import { Camera, MapPin, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ReportPhoto, StatusBadge, UrgencyBadge, categoryLabel, URGENCY_LABELS, type Report } from '@/components/features/report-bits';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState, ErrorState, SkeletonList } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useAction, useApi, usePaged } from '@/lib/hooks';
import { shrinkPhoto } from '@/lib/image';
import type { BanjirOverview } from '@/lib/types';
import { REPORT_CATEGORIES, REPORT_CATEGORY_LABELS, type ReportCategory, type Urgency } from '@/shared/domain';

interface Created {
  category: ReportCategory;
  urgency: Urgency;
}

export default function LaporPage() {
  const reports = usePaged<Report>('/reports?limit=10');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Report | null>(null);

  return (
    <>
      <PageHeader
        title="Lapor"
        description="Report a hazard or an access barrier in under a minute. You earn Impact XP once township staff confirm it."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden />
            New report
          </Button>
        }
      />
      {reports.error ? (
        <ErrorState error={reports.error} onRetry={() => void reports.reload()} />
      ) : reports.isLoading ? (
        <SkeletonList rows={3} />
      ) : reports.items.length === 0 ? (
        <EmptyState title="You have not reported anything" action={<Button onClick={() => setOpen(true)}>New report</Button>}>
          Seen a pothole, a broken light, a blocked drain or a blocked ramp? Tell the township team.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {reports.items.map((report) => (
            <li key={report.id}>
              <button type="button" onClick={() => setDetail(report)} className="lift block w-full rounded-lg border border-ink-200 bg-white p-5 text-left shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={report.status} />
                  <span className="text-sm font-semibold text-ink-900">{categoryLabel(report.category)}</span>
                  <span className="ml-auto text-xs text-ink-500">{timeAgo(report.created_at)}</span>
                </div>
                <p className="mt-2 line-clamp-2 text-[15px] text-ink-700">{report.description}</p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-ink-500">
                  <MapPin className="size-4" aria-hidden />
                  {report.location_text}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {reports.hasMore && (
        <div className="mt-5 text-center">
          <Button variant="secondary" onClick={() => void reports.loadMore()} pending={reports.loadingMore}>
            Show more
          </Button>
        </div>
      )}

      <NewReport open={open} onClose={() => setOpen(false)} onCreated={() => void reports.reload()} />

      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail ? categoryLabel(detail.category) : ''} description={detail?.location_text}>
        {detail && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={detail.status} />
              <UrgencyBadge urgency={detail.urgency} />
            </div>
            <p className="whitespace-pre-line text-[15px] text-ink-700">{detail.description}</p>
            <ReportPhoto report={detail} />
            {detail.staff_note && (
              <div className="rounded-lg bg-brand-50 p-4 text-[15px] text-brand-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">From the township team</p>
                <p className="mt-1">{detail.staff_note}</p>
              </div>
            )}
            <p className="text-sm text-ink-500">Last updated {timeAgo(detail.updated_at)}.</p>
          </div>
        )}
      </Modal>
    </>
  );
}

function NewReport({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const zones = useApi<BanjirOverview>(open ? '/banjir' : null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const create = useAction(
    async (form: HTMLFormElement) => {
      const data = new FormData(form);
      const photo = data.get('photo');
      if (photo instanceof File && photo.size > 0) data.set('photo', await shrinkPhoto(photo), 'photo.jpg');
      else data.delete('photo');
      return api.post<Created>('/reports', data);
    },
    {
      success: (r) => `Sent. Sorted as ${REPORT_CATEGORY_LABELS[r.category]}, ${URGENCY_LABELS[r.urgency].toLowerCase()} urgency. Staff can correct this.`,
      onSuccess: () => {
        setPhotoName(null);
        onCreated();
        onClose();
      },
    },
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void create.run(event.currentTarget);
  };
  const f = create.fields;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New report"
      description="If someone is in immediate danger, call 999 first."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="new-report" pending={create.pending}>
            Send report
          </Button>
        </>
      }
    >
      <form method="post" id="new-report" onSubmit={submit} className="space-y-4" noValidate>
        <Textarea label="What is the problem?" name="description" maxLength={1000} placeholder="e.g. Street light not working outside the playground" required error={f.description} />
        <Input label="Where is it?" name="locationText" maxLength={160} placeholder="Street, landmark or nearest house" required error={f.locationText} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Area (optional)" name="zoneId" defaultValue="">
            <option value="">Not sure</option>
            {zones.data?.zones.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.name}
              </option>
            ))}
          </Select>
          <Select label="Type" name="category" defaultValue="" hint="Leave it and KITA+ will suggest one.">
            <option value="">Suggest for me</option>
            {REPORT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {REPORT_CATEGORY_LABELS[category]}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-dashed border-ink-300 px-4 py-3 text-[15px] text-ink-700 transition-colors duration-200 hover:border-brand-500 hover:bg-brand-50/40 focus-within:border-brand-500">
          <Camera className="size-5 shrink-0 text-ink-500" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{photoName ?? 'Add a photo (optional)'}</span>
          <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(event) => setPhotoName(event.target.files?.[0]?.name ?? null)} />
        </label>
      </form>
    </Modal>
  );
}
