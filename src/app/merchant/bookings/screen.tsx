'use client';

import { Text } from '@/components/ui/localized-text';

import { CalendarCheck, ChevronRight, DoorOpen, MapPin, Phone, UserRound, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { BookingPhoto, BookingStatusBadge, BookingTimeline, SERVICE_ICONS, SLOT_SHORT, Stars, type BookingEvent } from '@/components/features/home-services';
import { Button } from '@/components/ui/button';
import { Badge, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { Tabs } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { formatDate, formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { formatPhone, SERVICE_CATEGORY_LABELS, type BookingStatus, type ServiceCategory, type ServiceSlot } from '@/shared/domain';

interface Booking {
  id: string;
  status: BookingStatus;
  category: ServiceCategory;
  problem: string;
  hasPhoto: boolean;
  preferredDate: string;
  preferredSlot: ServiceSlot;
  scheduledAt: string | null;
  providerNote: string | null;
  closedReason: string | null;
  worker: { id: string; name: string } | null;
  review: { rating: number; comment: string | null } | null;
  residentName: string;
  residentPhone: string | null;
  address: string | null;
  passCode: string | null;
  passValidUntil: string | null;
  overdue: boolean;
  createdAt: string;
}
interface Detail extends Booking {
  history: BookingEvent[];
}
interface Setup {
  workers: { id: string; full_name: string; active: boolean; open_jobs: number }[];
}

/** A local date and time for a datetime-local field, in Malaysia time. */
function suggestedVisit(date: string, slot: ServiceSlot): string {
  const hour = slot === 'MORNING' ? '10:00' : slot === 'AFTERNOON' ? '14:00' : '18:00';
  return `${date}T${hour}`;
}
/** The field's value is Malaysia time (UTC+8, no daylight saving). */
const fromLocal = (value: string) => new Date(`${value}:00+08:00`).toISOString();

/** One plain line telling the company what to do next, so nobody has to work out the steps. */
const NEXT_STEP: Partial<Record<BookingStatus, string>> = {
  REQUESTED: 'Next: accept with a visit time, or decline.',
  ACCEPTED: 'Next: choose the worker who will visit. The resident sees their name, and their gate pass is made automatically.',
  SCHEDULED: 'Next: when the job is finished, tap Work is finished.',
  IN_PROGRESS: 'Next: when the job is finished, tap Work is finished.',
  WORK_DONE: 'Waiting for the resident to confirm the job is complete.',
};

export function BookingsScreen({ initialBooking }: { initialBooking: string | null }) {
  const [filter, setFilter] = useState<'OPEN' | 'CLOSED'>('OPEN');
  const list = useApi<Booking[]>(`/merchant/bookings?filter=${filter}`, { refreshInterval: 30_000 });
  const [openId, setOpenId] = useState<string | null>(initialBooking);
  const waiting = list.data?.filter((b) => b.status === 'REQUESTED').length ?? 0;

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Requests from residents. Accept with a visit time, assign a registered worker, and the resident sees who is coming. Prices are agreed with the resident in person."
        action={<Button href="/merchant/services" variant="secondary"><Wrench className="size-4" aria-hidden /><Text>Services and workers</Text></Button>}
      />
      <Tabs label="Bookings" value={filter} onChange={setFilter} items={[{ key: 'OPEN', label: 'Open', count: filter === 'OPEN' ? waiting || undefined : undefined }, { key: 'CLOSED', label: 'Finished' }]} />
      <div className="mt-5">
        <Async state={list}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState icon={CalendarCheck} title={filter === 'OPEN' ? 'No open bookings' : 'Nothing finished yet'}>
                <Text>{filter === 'OPEN' ? 'New requests from residents appear here, and you are notified.' : 'Completed, declined and cancelled bookings appear here.'}</Text>
              </EmptyState>
            ) : (
              <ul className="space-y-3">
                {rows.map((b) => {
                  const Icon = SERVICE_ICONS[b.category];
                  return (
                    <li key={b.id}>
                      <button type="button" onClick={() => setOpenId(b.id)} className="lift flex w-full items-center gap-3 rounded-lg border border-ink-200 bg-white p-4 text-left shadow-xs">
                        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <BookingStatusBadge status={b.status} company />
                            {b.overdue && <Badge tone="danger"><Text>Waiting over a day</Text></Badge>}
                            <span className="text-sm font-semibold text-ink-900"><Text>{SERVICE_CATEGORY_LABELS[b.category]}</Text> · {b.residentName}</span>
                          </span>
                          <span className="mt-1 block truncate text-[15px] text-ink-700">{b.problem}</span>
                          <span className="mt-1 block text-sm text-ink-500">
                            {b.scheduledAt ? <Text>{formatDateTime(b.scheduledAt)}</Text> : <><Text>Asked for </Text><Text>{formatDate(b.preferredDate)}</Text>, <Text>{SLOT_SHORT[b.preferredSlot]}</Text></>}
                            {b.worker && <> · {b.worker.name}</>}
                            {' · '}<Text>{timeAgo(b.createdAt)}</Text>
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-ink-400" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          }
        </Async>
      </div>
      <BookingModal id={openId} onClose={() => setOpenId(null)} onChanged={() => void list.mutate()} />
    </>
  );
}

function BookingModal({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const detail = useApi<Detail>(id ? `/merchant/bookings/${id}` : null);
  const setup = useApi<Setup>(id ? '/merchant/services' : null);
  const [mode, setMode] = useState<'accept' | 'decline' | 'cancel' | 'done' | null>(null);
  const refresh = () => {
    setMode(null);
    void detail.mutate();
    void setup.mutate();
    onChanged();
  };
  const accept = useAction((body: { scheduledAt: string; workerId?: string; note?: string }) => api.post(`/merchant/bookings/${id}/accept`, body), { success: 'Accepted. The resident has been told.', onSuccess: refresh });
  const decline = useAction((reason: string) => api.post(`/merchant/bookings/${id}/decline`, { reason }), { success: 'Declined. The resident has been told.', onSuccess: refresh });
  const assign = useAction((workerId: string) => api.post(`/merchant/bookings/${id}/worker`, { workerId }), { success: 'Worker assigned. The resident can see who is coming.', onSuccess: refresh });
  const start = useAction(() => api.post(`/merchant/bookings/${id}/start`), { success: 'Visit started.', onSuccess: refresh });
  const done = useAction((note: string) => api.post(`/merchant/bookings/${id}/done`, { note: note || undefined }), { success: 'Marked done. The resident will confirm.', onSuccess: refresh });
  const cancel = useAction((reason: string) => api.post(`/merchant/bookings/${id}/cancel`, { reason }), { success: 'Booking cancelled. The resident has been told.', onSuccess: refresh });

  const workers = setup.data?.workers.filter((w) => w.active) ?? [];
  const d = detail.data;
  const close = () => {
    setMode(null);
    onClose();
  };

  const submitAccept = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const when = String(data.get('scheduledAt') ?? '');
    if (!when) return;
    void accept.run({ scheduledAt: fromLocal(when), workerId: String(data.get('workerId') ?? '') || undefined, note: String(data.get('note') ?? '').trim() || undefined });
  };
  const reasonForm = (run: (reason: string) => unknown, pending: boolean, label: string, button: string, error?: string) => (
    <form
      method="post"
      className="space-y-3 rounded-lg border border-ink-200 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void run(String(new FormData(event.currentTarget).get('reason') ?? '').trim());
      }}
    >
      <Textarea label={label} name="reason" maxLength={300} required error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" pending={pending}><Text>{button}</Text></Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}><Text>Back</Text></Button>
      </div>
    </form>
  );

  return (
    <Modal open={id !== null} onClose={close} title={d ? SERVICE_CATEGORY_LABELS[d.category] : 'Booking'} description={d ? <span className="inline-flex flex-wrap items-center gap-2">{d.residentName} <BookingStatusBadge status={d.status} company /></span> : undefined}>
      <Async state={detail}>
        {(b) => (
          <div className="space-y-5">
            {NEXT_STEP[b.status] && <p className="rounded-lg bg-brand-50 px-3 py-2 text-[15px] font-medium text-brand-900"><Text>{NEXT_STEP[b.status]!}</Text></p>}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>The problem</Text></p>
              <p className="mt-1 whitespace-pre-line text-[15px] text-ink-700">{b.problem}</p>
              {b.hasPhoto && <div className="mt-2"><BookingPhoto bookingId={b.id} /></div>}
              <p className="mt-2 text-sm text-ink-600"><Text>Resident asked for </Text><Text>{formatDate(b.preferredDate)}</Text>, <Text>{SLOT_SHORT[b.preferredSlot]}</Text></p>
            </div>

            {b.address ? (
              <div className="space-y-1 rounded-lg bg-ink-25 p-3 text-[15px] text-ink-800">
                <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-ink-500" aria-hidden />{b.address}</p>
                {b.residentPhone && <p className="flex items-center gap-2"><Phone className="size-4 text-ink-500" aria-hidden /><a className="underline" href={`tel:${b.residentPhone}`}>{formatPhone(b.residentPhone)}</a></p>}
                {b.scheduledAt && <p className="flex items-center gap-2"><CalendarCheck className="size-4 text-ink-500" aria-hidden /><Text>Visit: </Text><Text>{formatDateTime(b.scheduledAt)}</Text></p>}
              </div>
            ) : b.status === 'REQUESTED' ? (
              <p className="text-sm text-ink-500"><Text>The resident’s address and phone number are shown once you accept.</Text></p>
            ) : null}

            {b.passCode && (
              <p className="flex flex-wrap items-center gap-2 rounded-lg border border-success-600/30 bg-success-50 p-3 text-[15px] text-success-700">
                <DoorOpen className="size-4" aria-hidden /><Text>Gate pass for the worker: </Text><strong>{b.passCode}</strong>
                {b.passValidUntil && <span className="text-sm"><Text> (until </Text><Text>{formatDateTime(b.passValidUntil)}</Text>)</span>}
                <span className="basis-full text-sm"><Text>Give this code to the worker to show at the main gate.</Text></span>
              </p>
            )}

            {b.worker && (
              <p className="flex items-center gap-2 text-[15px] text-ink-800"><UserRound className="size-4 text-ink-500" aria-hidden /><Text>Worker: </Text><strong>{b.worker.name}</strong></p>
            )}
            {b.providerNote && <p className="text-sm text-ink-600"><Text>Your note: </Text>{b.providerNote}</p>}
            {b.closedReason && <p className="text-sm text-ink-600"><Text>Reason: </Text>{b.closedReason}</p>}
            {b.review && (
              <div className="rounded-lg bg-ink-25 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>The resident’s review</Text></p>
                <Stars rating={b.review.rating} />
                {b.review.comment && <p className="mt-1 text-[15px] text-ink-700">{b.review.comment}</p>}
              </div>
            )}

            {b.status === 'REQUESTED' && mode === null && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setMode('accept')}><Text>Accept</Text></Button>
                <Button variant="secondary" onClick={() => setMode('decline')}><Text>Decline</Text></Button>
              </div>
            )}
            {mode === 'accept' && (
              <form method="post" onSubmit={submitAccept} className="space-y-3 rounded-lg border border-ink-200 p-4">
                <Input label="Visit time" name="scheduledAt" type="datetime-local" defaultValue={suggestedVisit(b.preferredDate, b.preferredSlot)} required hint="Change it to suggest a different time. The resident can cancel if it does not suit them." error={accept.fields.scheduledAt} />
                <Select label="Worker" name="workerId" defaultValue={workers.length === 1 ? workers[0]!.id : ''} hint="You can also assign a worker later, before the visit.">
                  <option value=""><Text>Assign later</Text></option>
                  {workers.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                </Select>
                <Input label="Note to the resident (optional)" name="note" maxLength={300} error={accept.fields.note} />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" pending={accept.pending}><Text>Accept booking</Text></Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}><Text>Back</Text></Button>
                </div>
              </form>
            )}
            {mode === 'decline' && reasonForm(decline.run, decline.pending, 'Why can you not take it?', 'Decline booking', decline.fields.reason)}

            {(b.status === 'ACCEPTED' || b.status === 'SCHEDULED') && mode === null && (
              <div className="space-y-3 rounded-lg border border-ink-200 p-4">
                <Select
                  label={b.worker ? 'Change the worker' : 'Assign a worker'}
                  value={b.worker?.id ?? ''}
                  onChange={(event) => event.target.value && void assign.run(event.target.value)}
                  disabled={assign.pending}
                  hint={b.worker ? 'The resident is told. A new gate pass is made for the new worker, and the old one stops working.' : 'The resident sees the worker’s name, and a gate pass is made for them automatically.'}
                >
                  <option value="" disabled><Text>Choose a worker</Text></option>
                  {workers.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                </Select>
                {workers.length === 0 && <p className="text-sm text-ink-600"><Text>Register your workers first, under Services and workers.</Text></p>}
              </div>
            )}

            {mode === null && (
              <div className="flex flex-wrap gap-2">
                {(b.status === 'SCHEDULED' || b.status === 'IN_PROGRESS') && <Button variant="success" onClick={() => setMode('done')}><Text>Work is finished</Text></Button>}
                {b.status === 'SCHEDULED' && <Button variant="secondary" onClick={() => void start.run()} pending={start.pending}><Text>Worker has arrived</Text></Button>}
                {['ACCEPTED', 'SCHEDULED', 'IN_PROGRESS'].includes(b.status) && <Button variant="ghost" onClick={() => setMode('cancel')}><Text>Cancel booking</Text></Button>}
              </div>
            )}
            {mode === 'done' && (
              <form
                method="post"
                className="space-y-3 rounded-lg border border-ink-200 p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void done.run(String(new FormData(event.currentTarget).get('note') ?? '').trim());
                }}
              >
                <Textarea label="What was done? (optional)" name="note" maxLength={300} placeholder="e.g. Replaced the sink trap. RM120 agreed and paid in cash." error={done.fields.note} />
                <p className="text-sm text-ink-600"><Text>The booking is completed when the resident confirms.</Text></p>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="success" pending={done.pending}><Text>Mark work done</Text></Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}><Text>Back</Text></Button>
                </div>
              </form>
            )}
            {mode === 'cancel' && reasonForm(cancel.run, cancel.pending, 'Why are you cancelling? The resident sees this.', 'Cancel booking', cancel.fields.reason)}

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500"><Text>History</Text></p>
              <BookingTimeline events={b.history} showPassCode />
            </div>
          </div>
        )}
      </Async>
    </Modal>
  );
}
