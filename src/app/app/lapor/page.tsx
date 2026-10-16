'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedInput } from '@/components/ui/localized-elements';

import { Camera, MapPin, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AksesPage, AksesWizard, useAksesMode } from '@/components/features/akses-mode';
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
  const akses = useAksesMode();
  const reports = usePaged<Report>('/reports?limit=10');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Report | null>(null);

  return (
    <AksesPage profile={akses.profile} simple={akses.simple} largeText={akses.largeText} largeTargets={akses.largeTargets}>
      <PageHeader
        title="Lapor"
        description="Report a hazard or an access barrier in under a minute. You earn Impact XP once township staff confirm it."
        action={
          <Button size={akses.guided ? 'lg' : 'md'} onClick={() => setOpen(true)}>
            <Plus className="size-4" aria-hidden /><Text>New report</Text></Button>
        }
      />
      {reports.error ? (
        <ErrorState error={reports.error} onRetry={() => void reports.reload()} />
      ) : reports.isLoading ? (
        <SkeletonList rows={3} />
      ) : reports.items.length === 0 ? (
        <EmptyState title="You have not reported anything" action={<Button size={akses.guided ? 'lg' : 'md'} onClick={() => setOpen(true)}><Text>New report</Text></Button>}><Text>Seen a pothole, a broken light, a blocked drain or a blocked ramp? Tell the township team.</Text></EmptyState>
      ) : (
        <ul className="report-timeline space-y-3">
          {reports.items.map((report, index) => (
            <li key={report.id} className="report-timeline-item" style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}>
              <button type="button" onClick={() => setDetail(report)} className="lift block w-full rounded-lg border border-ink-200 bg-white p-5 text-left shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={report.status} />
                  <span className="text-sm font-semibold text-ink-900"><Text>{categoryLabel(report.category)}</Text></span>
                  <span className="ml-auto text-xs text-ink-500"><Text>{timeAgo(report.created_at)}</Text></span>
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
          <Button variant="secondary" onClick={() => void reports.loadMore()} pending={reports.loadingMore}><Text>Show more</Text></Button>
        </div>
      )}

      <NewReport open={open} guided={akses.guided} onClose={() => setOpen(false)} onCreated={() => void reports.reload()} />

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
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-600"><Text>From the township team</Text></p>
                <p className="mt-1">{detail.staff_note}</p>
              </div>
            )}
            <p className="text-sm text-ink-500"><Text>Last updated </Text><Text>{timeAgo(detail.updated_at)}</Text>.</p>
          </div>
        )}
      </Modal>
    </AksesPage>
  );
}

function NewReport({ open, guided, onClose, onCreated }: { open: boolean; guided: boolean; onClose: () => void; onCreated: () => void }) {
  const zones = useApi<BanjirOverview>(open ? '/banjir' : null);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [step, setStep] = useState(0);
  const [description, setDescription] = useState('');
  const [locationText, setLocationText] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [category, setCategory] = useState('');
  const [guidedError, setGuidedError] = useState('');
  const create = useAction(
    async (data: FormData) => {
      const photo = data.get('photo');
      if (photo instanceof File && photo.size > 0) data.set('photo', await shrinkPhoto(photo), 'photo.jpg');
      else data.delete('photo');
      return api.post<Created>('/reports', data);
    },
    {
      success: (r) => `Sent. Sorted as ${REPORT_CATEGORY_LABELS[r.category]}, ${URGENCY_LABELS[r.urgency].toLowerCase()} urgency. Staff can correct this.`,
      onSuccess: () => {
        setPhotoName(null);
        setPhoto(null);
        setStep(0);
        onCreated();
        onClose();
      },
    },
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void create.run(new FormData(event.currentTarget));
  };
  const submitGuided = () => {
    const data = new FormData();
    data.set('description', description.trim());
    data.set('locationText', locationText.trim());
    if (zoneId) data.set('zoneId', zoneId);
    if (category) data.set('category', category);
    if (photo) data.set('photo', photo);
    void create.run(data);
  };
  const next = () => {
    if (step === 0 && !description.trim()) {
      setGuidedError('Please describe the problem.');
      return;
    }
    if (step === 1 && !locationText.trim()) {
      setGuidedError('Please enter the location.');
      return;
    }
    setGuidedError('');
    setStep((current) => Math.min(current + 1, 4));
  };
  const f = create.fields;
  return (
    guided ? (
      <AksesWizard open={open} title="New report" step={step} total={5} onClose={onClose} onBack={() => setStep((current) => current - 1)} onNext={next} onSubmit={submitGuided} pending={create.pending} submitLabel="Send report">
        {step === 0 && <Textarea label="What is the problem?" labelClassName="!text-3xl !font-semibold" value={description} onChange={(event) => { setDescription(event.target.value); setGuidedError(''); }} maxLength={1000} placeholder="e.g. Street light not working outside the playground" required error={guidedError || f.description} />}
        {step === 1 && <Input label="Where is it?" labelClassName="!text-3xl !font-semibold" value={locationText} onChange={(event) => { setLocationText(event.target.value); setGuidedError(''); }} maxLength={160} placeholder="Street, landmark or nearest house" required error={guidedError || f.locationText} />}
        {step === 2 && <Select label="Area (optional)" labelClassName="!text-3xl !font-semibold" value={zoneId} onChange={(event) => setZoneId(event.target.value)}>
          <option value=""><Text>Not sure</Text></option>
          {zones.data?.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
        </Select>}
        {step === 3 && <Select label="Type" labelClassName="!text-3xl !font-semibold" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value=""><Text>Suggest for me</Text></option>
          {REPORT_CATEGORIES.map((item) => <option key={item} value={item}><Text>{REPORT_CATEGORY_LABELS[item]}</Text></option>)}
        </Select>}
        {step === 4 && <label className="flex min-h-24 cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed border-ink-300 px-6 py-5 text-2xl font-semibold text-ink-700 hover:border-brand-500 hover:bg-brand-50/40">
          <Camera className="size-8 shrink-0 text-ink-500" aria-hidden />
          <span className="min-w-0 flex-1"><Text>{photoName ?? 'Add a photo (optional)'}</Text></span>
          <LocalizedInput type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(event) => { const file = event.target.files?.[0] ?? null; setPhoto(file); setPhotoName(file?.name ?? null); }} />
        </label>}
        <p className="text-lg text-ink-600"><Text>If someone is in immediate danger, call 999 first.</Text></p>
      </AksesWizard>
    ) : (
      <Modal open={open} onClose={onClose} title="New report" description="If someone is in immediate danger, call 999 first." footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="new-report" pending={create.pending}><Text>Send report</Text></Button></>}>
        <form method="post" id="new-report" onSubmit={submit} className="space-y-4" noValidate>
          <Textarea label="What is the problem?" name="description" maxLength={1000} placeholder="e.g. Street light not working outside the playground" required error={f.description} />
          <Input label="Where is it?" name="locationText" maxLength={160} placeholder="Street, landmark or nearest house" required error={f.locationText} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Area (optional)" name="zoneId" defaultValue=""><option value=""><Text>Not sure</Text></option>{zones.data?.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</Select>
            <Select label="Type" name="category" defaultValue="" hint="Leave it and SimeTown will suggest one."><option value=""><Text>Suggest for me</Text></option>{REPORT_CATEGORIES.map((item) => <option key={item} value={item}><Text>{REPORT_CATEGORY_LABELS[item]}</Text></option>)}</Select>
          </div>
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-dashed border-ink-300 px-4 py-3 text-[15px] text-ink-700 transition-colors duration-200 hover:border-brand-500 hover:bg-brand-50/40 focus-within:border-brand-500">
            <Camera className="size-5 shrink-0 text-ink-500" aria-hidden /><span className="min-w-0 flex-1 truncate"><Text>{photoName ?? 'Add a photo (optional)'}</Text></span>
            <LocalizedInput type="file" name="photo" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(event) => setPhotoName(event.target.files?.[0]?.name ?? null)} />
          </label>
        </form>
      </Modal>
    )
  );
}
