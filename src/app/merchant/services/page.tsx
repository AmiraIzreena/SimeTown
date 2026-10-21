'use client';

import { Text } from '@/components/ui/localized-text';

import { CircleSlash, Clock, Plus, UserRound, Wrench } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { PriceLine, SERVICE_ICONS } from '@/components/features/home-services';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, EmptyState, Notice } from '@/components/ui/feedback';
import { Input, Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { parseRM } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import {
  formatPhone, SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS, SERVICE_PRICING, SERVICE_PRICING_LABELS,
  type ServiceCategory, type ServicePricing,
} from '@/shared/domain';

interface Listing {
  id: string;
  category: ServiceCategory;
  description: string;
  pricing: ServicePricing;
  callout_fee_sen: number | null;
  price_note: string;
  active: boolean;
}
interface Worker {
  id: string;
  full_name: string;
  phone: string | null;
  active: boolean;
  open_jobs: number;
  completed_jobs: number;
}
interface Setup {
  merchant: { name: string; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED'; about: string | null };
  listings: Listing[];
  workers: Worker[];
}

export default function ServicesPage() {
  const setup = useApi<Setup>('/merchant/services');
  const [editing, setEditing] = useState<Listing | 'new' | null>(null);
  const [addingWorker, setAddingWorker] = useState(false);
  const reload = () => void setup.mutate();

  const about = useAction((text: string) => api.patch('/merchant/services/about', { about: text }), { success: 'Saved.', onSuccess: reload });
  const toggleListing = useAction((id: string, active: boolean) => api.post(`/merchant/services/listings/${id}/active`, { active }), { success: 'Saved.', onSuccess: reload });
  const toggleWorker = useAction((id: string, active: boolean) => api.post(`/merchant/services/workers/${id}/active`, { active }), { success: 'Saved.', onSuccess: reload });

  return (
    <>
      <PageHeader
        title="Services and workers"
        description="What residents see when they choose a company, and the workers you can send. Residents see the worker’s name before the visit."
        action={<Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /><Text>Add a service</Text></Button>}
      />
      <Async state={setup}>
        {(data) => (
          <div className="space-y-6">
            {data.merchant.status !== 'ACTIVE' && (
              <Notice icon={data.merchant.status === 'PENDING' ? Clock : CircleSlash} title={data.merchant.status === 'PENDING' ? 'Your business is waiting for approval.' : 'Your business is suspended.'}>
                <Text>{data.merchant.status === 'PENDING' ? 'The township office is checking your business. You can set up now; residents see you once you are approved.' : 'Your business is suspended. Residents cannot book you. Contact the township office.'}</Text>
              </Notice>
            )}

            <Card>
              <CardHeader title="Services" description="One listing per type of service. Say how you price it, and any call-out fee, so residents know before they book." />
              {data.listings.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={Wrench} title="No services yet" action={<Button onClick={() => setEditing('new')}><Text>Add a service</Text></Button>}><Text>Add what you offer so residents can find you.</Text></EmptyState>
                </div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {data.listings.map((l) => {
                    const Icon = SERVICE_ICONS[l.category];
                    return (
                      <li key={l.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
                        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700"><Icon className="size-5" aria-hidden /></span>
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">
                            <Text>{SERVICE_CATEGORY_LABELS[l.category]}</Text>
                            {!l.active && <Badge tone="neutral"><Text>Hidden</Text></Badge>}
                          </p>
                          <p className="text-sm text-ink-700">{l.description}</p>
                          <PriceLine pricing={l.pricing} calloutFeeSen={l.callout_fee_sen} priceNote={l.price_note} />
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setEditing(l)}><Text>Edit</Text></Button>
                          <Button size="sm" variant="ghost" onClick={() => void toggleListing.run(l.id, !l.active)} disabled={toggleListing.pending}><Text>{l.active ? 'Hide' : 'Show'}</Text></Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader
                title="Workers"
                description="Register everyone you send to homes. Name and phone only; never an identity card number."
                action={<Button size="sm" variant="secondary" onClick={() => setAddingWorker(true)}><Plus className="size-4" aria-hidden /><Text>Add worker</Text></Button>}
              />
              {data.workers.length === 0 ? (
                <div className="p-5"><EmptyState icon={UserRound} title="No workers yet"><Text>Add a worker before you accept bookings, so residents know who is coming.</Text></EmptyState></div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {data.workers.map((wk) => (
                    <li key={wk.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-600"><UserRound className="size-5" aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-ink-900">{wk.full_name}{!wk.active && <Badge tone="neutral"><Text>Inactive</Text></Badge>}</p>
                        <p className="text-sm text-ink-500">
                          {wk.phone ? formatPhone(wk.phone) : <Text>No phone</Text>}
                          {' · '}<Text>{wk.open_jobs === 1 ? '1 visit coming up' : `${wk.open_jobs} visits coming up`}</Text>
                          {' · '}<Text>{wk.completed_jobs === 1 ? '1 job done' : `${wk.completed_jobs} jobs done`}</Text>
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void toggleWorker.run(wk.id, !wk.active)} disabled={toggleWorker.pending}><Text>{wk.active ? 'Make inactive' : 'Make active'}</Text></Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* The profile text changes rarely, so it sits after the services and workers used every day. */}
            <Card>
              <CardHeader title="About your company" description="A few lines residents read on your profile." />
              <form
                method="post"
                className="space-y-3 p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void about.run(String(new FormData(event.currentTarget).get('about') ?? '').trim());
                }}
              >
                <Textarea label="About" name="about" maxLength={600} defaultValue={data.merchant.about ?? ''} placeholder="e.g. Family plumbing business serving Elmina since 2015. Licensed and insured." error={about.fields.about} />
                <Button type="submit" size="sm" variant="secondary" pending={about.pending}><Text>Save</Text></Button>
              </form>
            </Card>
          </div>
        )}
      </Async>

      <ListingForm listing={editing} taken={setup.data?.listings.map((l) => l.category) ?? []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
      <WorkerForm open={addingWorker} onClose={() => setAddingWorker(false)} onSaved={() => { setAddingWorker(false); reload(); }} />
    </>
  );
}

function ListingForm({ listing, taken, onClose, onSaved }: { listing: Listing | 'new' | null; taken: ServiceCategory[]; onClose: () => void; onSaved: () => void }) {
  const existing = listing && listing !== 'new' ? listing : null;
  const [fee, setFee] = useState('');
  const [feeKey, setFeeKey] = useState<string | null>(null);
  // Reset the fee field whenever a different listing is opened.
  const key = existing?.id ?? (listing === 'new' ? 'new' : null);
  if (key !== feeKey) {
    setFeeKey(key);
    setFee(existing?.callout_fee_sen ? (existing.callout_fee_sen / 100).toFixed(2) : '');
  }
  const save = useAction((body: Record<string, unknown>) => api.post('/merchant/services/listings', body), { success: 'Service saved.', onSuccess: onSaved });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void save.run({
      category: data.get('category'),
      description: String(data.get('description') ?? '').trim(),
      pricing: data.get('pricing'),
      calloutFeeSen: fee.trim() ? parseRM(fee) : null,
      priceNote: String(data.get('priceNote') ?? '').trim(),
    });
  };
  const f = save.fields;
  const choices = SERVICE_CATEGORIES.filter((c) => c === existing?.category || !taken.includes(c));
  return (
    <Modal
      open={listing !== null}
      onClose={onClose}
      title={existing ? 'Edit service' : 'Add a service'}
      footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="listing-form" pending={save.pending}><Text>Save</Text></Button></>}
    >
      {listing !== null && (
        <form id="listing-form" method="post" onSubmit={submit} className="space-y-4" noValidate key={key ?? 'none'}>
          <Select label="Service" name="category" defaultValue={existing?.category ?? choices[0]} disabled={Boolean(existing)} error={f.category}>
            {choices.map((c) => <option key={c} value={c}><Text>{SERVICE_CATEGORY_LABELS[c]}</Text></option>)}
          </Select>
          {existing && <input type="hidden" name="category" value={existing.category} />}
          <Textarea label="What you do" name="description" maxLength={600} defaultValue={existing?.description ?? ''} placeholder="e.g. Leaking pipes, blocked drains, water heaters and taps." required error={f.description} />
          <Select label="How you price it" name="pricing" defaultValue={existing?.pricing ?? 'INSPECTION'} error={f.pricing}>
            {SERVICE_PRICING.map((p) => <option key={p} value={p}><Text>{SERVICE_PRICING_LABELS[p]}</Text></option>)}
          </Select>
          <Input label="Call-out or inspection fee (RM, optional)" value={fee} onChange={(event) => setFee(event.target.value)} inputMode="decimal" hint="Leave empty if there is none." error={f.calloutFeeSen} />
          <Input label="Price note for residents" name="priceNote" maxLength={200} defaultValue={existing?.price_note ?? ''} placeholder="e.g. RM30 inspection, credited to the repair if you go ahead" required error={f.priceNote} />
          <p className="text-sm text-ink-500"><Text>Residents pay you directly. Charge only what you showed here or agreed with them before starting.</Text></p>
        </form>
      )}
    </Modal>
  );
}

function WorkerForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const add = useAction((body: { fullName: string; phone?: string }) => api.post('/merchant/services/workers', body), { success: 'Worker added.', onSuccess: onSaved });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const phone = String(data.get('phone') ?? '').trim();
    void add.run({ fullName: String(data.get('fullName') ?? '').trim(), phone: phone || undefined });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a worker"
      description="Residents see this name before the visit."
      footer={<><Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button><Button type="submit" form="worker-form" pending={add.pending}><Text>Add worker</Text></Button></>}
    >
      {open && (
        <form id="worker-form" method="post" onSubmit={submit} className="space-y-4" noValidate>
          <Input label="Full name" name="fullName" maxLength={80} autoComplete="off" required error={add.fields.fullName} />
          <Input label="Phone (optional, seen by your company and township staff only)" name="phone" type="tel" inputMode="tel" error={add.fields.phone} />
        </form>
      )}
    </Modal>
  );
}
