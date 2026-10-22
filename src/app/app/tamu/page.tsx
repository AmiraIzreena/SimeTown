'use client';

import { Text } from '@/components/ui/localized-text';
import { CopyButton } from '@/components/ui/copy-button';

import { DoorOpen, Flag, LifeBuoy, MessageCircle, Send, ShieldCheck, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AksesPage, AksesReadAloud, useAksesMode } from '@/components/features/akses-mode';
import { ReportProblemDialog } from '@/components/features/report-problem';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Async, EmptyState, SkeletonRows } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { QrCode } from '@/components/ui/qr';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { formatDateTime, timeAgo } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { PASS_TYPES, PASS_TYPE_INFO, type HostReply, type PassType } from '@/shared/domain';

interface Pass {
  id: string;
  type: PassType;
  visitorName: string;
  vehicleNo: string | null;
  code: string;
  validFrom: string;
  validUntil: string;
  entries: number;
  maxEntries: number | null;
  lastEntryAt: string | null;
  status: 'ACTIVE' | 'NOT_YET' | 'USED' | 'EXPIRED' | 'CANCELLED';
}
interface Overview {
  passes: Pass[];
  visits: { id: string; kind: 'PASS' | 'WALK_IN'; visitor_name: string; vehicle_no: string | null; host_reply: HostReply | null; entered_at: string; exited_at: string | null }[];
  waiting: { id: string; visitor_name: string; vehicle_no: string | null; entered_at: string }[];
  sos: { id: string; status: string; created_at: string } | null;
  retentionDays: number;
}
interface Issued {
  id: string;
  code: string;
  token: string;
}

const STATUS: Record<Pass['status'], { label: string; tone: 'success' | 'brand' | 'neutral' | 'warning' }> = {
  ACTIVE: { label: 'Valid now', tone: 'success' },
  NOT_YET: { label: 'Starts later', tone: 'brand' },
  USED: { label: 'Used', tone: 'neutral' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'warning' },
};

/** A datetime-local value in Malaysia time for "now + hours". */
function localInput(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 3_600_000);
  return shifted.toISOString().slice(0, 16);
}
const fromLocalInput = (value: string) => new Date(`${value}:00+08:00`);
const DEFAULT_HOURS: Record<PassType, number> = { ONE_VISIT: 12, DELIVERY: 4, EVENT: 12, REGULAR_HELPER: 24 * 30, CONTRACTOR: 24 * 7, CARER: 24 * 30 };

export default function TamuPage() {
  const t = useT();
  const akses = useAksesMode();
  const toast = useToast();
  const overview = useApi<Overview>('/tamu', { refreshInterval: 10_000 });
  const [type, setType] = useState<PassType>('ONE_VISIT');
  const [from, setFrom] = useState(() => localInput(new Date()));
  const [until, setUntil] = useState(() => localInput(new Date(Date.now() + DEFAULT_HOURS.ONE_VISIT * 3_600_000)));
  const [issued, setIssued] = useState<(Issued & { visitorName: string }) | null>(null);
  const [askSos, setAskSos] = useState(false);
  const [guidedOpen, setGuidedOpen] = useState(false);
  const [guidedStep, setGuidedStep] = useState(0);
  const [guidedName, setGuidedName] = useState('');
  const [guidedVehicle, setGuidedVehicle] = useState('');
  const [guidedError, setGuidedError] = useState('');

  const create = useAction(
    (body: { type: PassType; visitorName: string; vehicleNo?: string }) => api.post<Issued>('/tamu/passes', { ...body, validFrom: fromLocalInput(from), validUntil: fromLocalInput(until) }),
    { onSuccess: () => void overview.mutate() },
  );
  const renew = useAction((pass: Pass) => api.post<Issued>(`/tamu/passes/${pass.id}/link`), {});
  const cancel = useAction((id: string) => api.post(`/tamu/passes/${id}/cancel`), { onSuccess: () => void overview.mutate(), success: 'Pass cancelled. The link no longer works.' });
  const reply = useAction((id: string, answer: HostReply) => api.post(`/tamu/entries/${id}/reply`, { reply: answer }), { onSuccess: () => void overview.mutate(), success: 'The guard can see your answer.' });
  const sos = useAction(() => api.post<{ alreadyOpen: boolean }>('/tamu/sos'), {
    onSuccess: () => {
      setAskSos(false);
      void overview.mutate();
    },
    success: (r) => (r.alreadyOpen ? 'Your SOS is already with the guardhouse.' : t('The guardhouse has been told. Help is coming.')),
  });

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const visitorName = String(form.get('visitorName') ?? '').trim();
    const vehicleNo = String(form.get('vehicleNo') ?? '').trim() || undefined;
    const result = await create.run({ type, visitorName, vehicleNo });
    if (result) {
      setIssued({ ...result, visitorName });
      formElement.reset();
    }
  };
  const onType = (next: PassType) => {
    setType(next);
    setUntil(localInput(new Date(fromLocalInput(from).getTime() + DEFAULT_HOURS[next] * 3_600_000)));
  };
  const startGuidedPass = () => {
    setGuidedStep(0);
    setGuidedName('');
    setGuidedVehicle('');
    setGuidedError('');
    setGuidedOpen(true);
  };
  const finishGuidedPass = async () => {
    const visitorName = guidedName.trim();
    if (!visitorName) {
      setGuidedError(t('Please enter the visitor name.'));
      return;
    }
    const result = await create.run({ type, visitorName, vehicleNo: guidedVehicle.trim() || undefined });
    if (result) {
      setIssued({ ...result, visitorName });
      setGuidedOpen(false);
    }
  };

  const [gateReport, setGateReport] = useState(false);
  const link = issued ? `${window.location.origin}/pass/${issued.token}` : '';
  const message = issued ? t(`Salam! Here is your visitor pass for City of Elmina. Show the QR code at the main gate: ${link}`) : '';
  const spokenSummary = overview.data
    ? `${overview.data.waiting.length} ${t('Someone is at the main gate')}. ${overview.data.passes.length} ${t('visitor passes')}. ${overview.data.sos ? t('An SOS is active with the guardhouse.') : ''}`
    : t('Visitor passes and the guardhouse');

  return (
    <AksesPage profile={akses.profile} simple={akses.simple} largeText={akses.largeText} largeTargets={akses.largeTargets}>
      <PageHeader
        title={t('Tamu')}
        description="Send a visitor a pass by link; they need no app. The guard scans it at the main gate and you are told the moment they arrive."
        action={
          <div className="flex flex-wrap gap-2">
            <Button size="lg" variant="danger" onClick={() => setAskSos(true)}>
              <LifeBuoy className="size-5" aria-hidden />
              {t('SOS to the guardhouse')}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => setGateReport(true)}>
              <Flag className="size-5" aria-hidden />
              <Text>Report a gate problem</Text>
            </Button>
            <AksesReadAloud profile={akses.profile} text={spokenSummary} />
          </div>
        }
      />
      <ReportProblemDialog open={gateReport} onClose={() => setGateReport(false)} context="GATE" subtitle="A courier or visitor turned away, someone let in who should not be, or a safety concern. For an emergency, use SOS." />
      <div className="space-y-6">
        {overview.data?.sos && (
          <Card className="border-accent-200 bg-accent-50 p-5 text-[15px] text-accent-700">
            <strong><Text>SOS </Text><Text>{overview.data.sos.status === 'ACKNOWLEDGED' ? 'seen by a guard: help is on the way.' : 'sent to the guardhouse.'}</Text></strong> <Text>{timeAgo(overview.data.sos.created_at)}</Text>
          </Card>
        )}
        {overview.data?.waiting.map((w) => (
          <Card key={w.id} className="animate-rise border-gold-300 bg-gold-50 p-5">
            <p className="text-sm font-semibold text-gold-700">{t('Someone is at the main gate')}</p>
            <p className="mt-1 font-display text-xl font-bold text-ink-900">
              {w.visitor_name}
              {w.vehicle_no && <span className="ml-2 text-base font-medium text-ink-600">{w.vehicle_no}</span>}
            </p>
            <p className="text-sm text-ink-600"><Text>Arrived </Text><Text>{timeAgo(w.entered_at)}</Text><Text>. Are you expecting them?</Text></p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => reply.run(w.id, 'EXPECTED')} disabled={reply.pending}>
                {t('Expected')}
              </Button>
              <Button variant="secondary" onClick={() => reply.run(w.id, 'NOT_EXPECTED')} disabled={reply.pending}>
                {t('Not expected')}
              </Button>
              <Button variant="ghost" onClick={() => reply.run(w.id, 'CALL_ME')} disabled={reply.pending}>
                {t('Call me')}
              </Button>
            </div>
            <p className="mt-3 text-xs text-ink-500"><Text>“Not expected” tells the guard. It never blocks lawful access on a public road.</Text></p>
          </Card>
        ))}

        <div className={akses.simple ? 'grid gap-6' : 'grid gap-6 lg:grid-cols-[1fr_1.1fr]'}>
          <Card>
            <CardHeader title={t('New visitor pass')} description="No identity card is ever asked for: a name and, if they drive, a vehicle number." />
            {akses.guided ? (
              <div className="p-5">
                <Button size="lg" className="min-h-20 w-full text-xl" onClick={startGuidedPass}>
                  <DoorOpen className="size-6" aria-hidden /><Text>Create a visitor pass</Text>
                </Button>
              </div>
            ) : (
            <form method="post" onSubmit={submit} className="space-y-4 p-5" noValidate>
              <Select label={t('Kind of visit')} value={type} onChange={(event) => onType(event.target.value as PassType)}>
                {PASS_TYPES.map((p) => (
                  <option key={p} value={p}>
                    <Text>{PASS_TYPE_INFO[p].label}</Text>
                    <Text>{PASS_TYPE_INFO[p].entries === 1 ? ' (one entry)' : ''}</Text>
                  </option>
                ))}
              </Select>
              <Input name="visitorName" label={t('Visitor name')} placeholder="e.g. Puan Rahmah" required maxLength={80} error={create.fields.visitorName} />
              <Input name="vehicleNo" label={t('Vehicle number (optional)')} placeholder="e.g. BKL 2408" maxLength={12} autoCapitalize="characters" error={create.fields.vehicleNo} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input type="datetime-local" label={t('From')} value={from} onChange={(event) => setFrom(event.target.value)} error={create.fields.validFrom} />
                <Input type="datetime-local" label={t('Until')} value={until} onChange={(event) => setUntil(event.target.value)} error={create.fields.validUntil} hint={`Up to ${PASS_TYPE_INFO[type].maxDays} day${PASS_TYPE_INFO[type].maxDays === 1 ? '' : 's'} for this kind of pass.`} />
              </div>
              <Button type="submit" size="lg" pending={create.pending}>
                <Send className="size-4" aria-hidden />
                {t('Create pass')}
              </Button>
            </form>
            )}
          </Card>

          <Card>
            <CardHeader title={t('Your passes')} description="Passes for your home from the last week and the days ahead." />
            <Async state={overview} skeleton={<SkeletonRows rows={3} />}>
              {(o) =>
                o.passes.length === 0 ? (
                  <div className="p-5">
                    <EmptyState icon={DoorOpen} title="No passes yet"><Text>Create one for your next visitor, delivery or contractor.</Text></EmptyState>
                  </div>
                ) : (
                  <ul className="divide-y divide-ink-100">
                    {o.passes.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-ink-900">
                            {p.visitorName} {p.vehicleNo && <span className="font-normal text-ink-500">· {p.vehicleNo}</span>}
                          </p>
                          <p className="text-sm text-ink-500">
                            <Text>{PASS_TYPE_INFO[p.type].label}</Text> · <Text>{formatDateTime(p.validFrom)}</Text><Text> to </Text><Text>{formatDateTime(p.validUntil)}</Text>
                            <Text>{p.lastEntryAt && ` · arrived ${timeAgo(p.lastEntryAt)}`}</Text>
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={STATUS[p.status].tone}><Text>{STATUS[p.status].label}</Text></Badge>
                          {(p.status === 'ACTIVE' || p.status === 'NOT_YET') && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                pending={renew.pending}
                                onClick={async () => {
                                  const r = await renew.run(p);
                                  if (r) setIssued({ ...r, visitorName: p.visitorName });
                                }}
                              ><Text>Share</Text></Button>
                              <Button size="sm" variant="ghost" onClick={() => cancel.run(p.id)} disabled={cancel.pending}><Text>Cancel</Text></Button>
                            </>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              }
            </Async>
          </Card>
        </div>

        <Card>
          <CardHeader title={t('Visit history')} description={`Name, vehicle and time only. Visitor records are deleted after ${overview.data?.retentionDays ?? 90} days.`} />
          <Async state={overview}>
            {(o) =>
              o.visits.length === 0 ? (
                <p className="p-5 text-sm text-ink-500"><Text>No visits yet.</Text></p>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {o.visits.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink-100 text-ink-600">
                          <UserRound className="size-[18px]" aria-hidden />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-medium text-ink-900">{v.visitor_name}</span>
                          <span className="block text-sm text-ink-500">
                            <Text>{v.kind === 'PASS' ? 'With a pass' : 'Walk-in'}</Text><Text> · in </Text><Text>{formatDateTime(v.entered_at)}</Text>
                            <Text>{v.exited_at && ` · out ${formatDateTime(v.exited_at)}`}</Text>
                          </span>
                        </span>
                      </span>
                      {v.host_reply && <Badge tone={v.host_reply === 'EXPECTED' ? 'success' : v.host_reply === 'NOT_EXPECTED' ? 'warning' : 'brand'}>{t(v.host_reply === 'EXPECTED' ? 'Expected' : v.host_reply === 'NOT_EXPECTED' ? 'Not expected' : 'Call me')}</Badge>}
                    </li>
                  ))}
                </ul>
              )
            }
          </Async>
        </Card>
        <p className="flex items-center gap-2 text-sm text-ink-500">
          <ShieldCheck className="size-4" aria-hidden /><Text>Tamu gives no points and no XP. It follows the published rules for guarded neighbourhoods.</Text></p>
      </div>

      <Modal open={issued !== null} onClose={() => setIssued(null)} title={`Pass for ${issued?.visitorName ?? ''}`} description="Send this link. The visitor opens it and shows the QR code at the gate.">
        {issued && (
          <div className="flex flex-col items-center gap-4">
            <QrCode value={`KITAPASS:${issued.code}`} label={`Visitor pass ${issued.code}`} />
            <p className="visitor-pass-reveal font-display text-2xl font-bold tracking-[0.18em] text-ink-900"><Text>{issued.code}</Text></p>
            <div className="grid w-full gap-2 sm:grid-cols-3">
              <Button href={`https://wa.me/?text=${encodeURIComponent(message)}`} variant="primary">
                <MessageCircle className="size-4" aria-hidden />
                {t('Send by WhatsApp')}
              </Button>
              <Button href={`sms:?&body=${encodeURIComponent(message)}`} variant="secondary">
                <Send className="size-4" aria-hidden />
                {t('Send by SMS')}
              </Button>
              <CopyButton
                variant="secondary"
                text={link}
                onCopied={() => toast.show('Link copied.', 'success')}
                onError={() => toast.show('Could not copy. Press and hold the link to copy it.', 'error')}
              />
            </div>
            <p className="w-full break-all rounded-md bg-ink-50 px-3 py-2 text-xs text-ink-600"><Text>{link}</Text></p>
            <p className="text-xs text-ink-500"><Text>Sharing again later makes a new link and the old one stops working.</Text></p>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={askSos} onClose={() => setAskSos(false)} onConfirm={() => void sos.run()} title={t('Call the guardhouse now?')} confirmLabel={t('Send SOS')} destructive pending={sos.pending}>
        <p><Text>The guards and the township team are told your address at once. In a medical emergency, also call 999.</Text></p>
      </ConfirmDialog>
      <Modal
        open={guidedOpen}
        wide
        className="guided-modal"
        onClose={() => setGuidedOpen(false)}
        title="New visitor pass"
        description={t('Question {step} of {total}', { step: guidedStep + 1, total: 6 })}
        footer={
          guidedStep > 0 ? (
            <>
              <Button size="lg" variant="secondary" onClick={() => setGuidedStep((step) => step - 1)}><Text>Back</Text></Button>
              {guidedStep < 5 ? (
                <>
                  {guidedStep === 3 && <Button size="lg" variant="ghost" onClick={() => { setGuidedError(''); setGuidedStep(4); }}><Text>Skip</Text></Button>}
                  <Button size="lg" onClick={() => {
                    if (guidedStep === 2 && !guidedName.trim()) {
                      setGuidedError(t('Please enter the visitor name.'));
                      return;
                    }
                    setGuidedError('');
                    setGuidedStep((step) => step + 1);
                  }}><Text>Next</Text></Button>
                </>
              ) : (
                <Button size="lg" pending={create.pending} onClick={() => void finishGuidedPass()}>
                  <Send className="size-5" aria-hidden /><Text>Create pass</Text>
                </Button>
              )}
            </>
          ) : (
            <Button size="lg" variant="secondary" onClick={() => setGuidedOpen(false)}><Text>Cancel</Text></Button>
          )
        }
      >
        <div className="flex min-h-64 flex-col justify-center gap-5">
          {guidedStep === 0 ? (
            <>
              <p className="text-center text-5xl font-bold text-ink-900"><Text>Is someone coming?</Text></p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Button size="lg" variant="success" className="min-h-32 text-4xl" onClick={() => setGuidedStep(1)}><Text>Yes</Text></Button>
                <Button size="lg" variant="danger" className="min-h-32 text-4xl" onClick={() => setGuidedOpen(false)}><Text>No</Text></Button>
              </div>
            </>
          ) : guidedStep === 1 ? (
            <Select label="Kind of visit" labelClassName="!text-3xl !font-semibold" value={type} onChange={(event) => onType(event.target.value as PassType)}>
              {PASS_TYPES.map((passType) => (
                <option key={passType} value={passType}>
                  <Text>{PASS_TYPE_INFO[passType].label}</Text>
                  <Text>{PASS_TYPE_INFO[passType].entries === 1 ? ' (one entry)' : ''}</Text>
                </option>
              ))}
            </Select>
          ) : guidedStep === 2 ? (
            <Input
              label="Visitor name"
              labelClassName="!text-3xl !font-semibold"
              value={guidedName}
              onChange={(event) => { setGuidedName(event.target.value); setGuidedError(''); }}
              placeholder="e.g. Puan Rahmah"
              required
              maxLength={80}
              error={guidedError || create.fields.visitorName}
            />
          ) : guidedStep === 3 ? (
            <Input
              label="Vehicle number (optional)"
              labelClassName="!text-3xl !font-semibold"
              value={guidedVehicle}
              onChange={(event) => setGuidedVehicle(event.target.value)}
              placeholder="e.g. BKL 2408"
              maxLength={12}
              autoCapitalize="characters"
              error={create.fields.vehicleNo}
            />
          ) : guidedStep === 4 ? (
            <Input type="datetime-local" label="From" labelClassName="!text-3xl !font-semibold" value={from} onChange={(event) => setFrom(event.target.value)} error={create.fields.validFrom} />
          ) : (
            <Input
              type="datetime-local"
              label="Until"
              labelClassName="!text-3xl !font-semibold"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
              error={create.fields.validUntil}
              hint={`Up to ${PASS_TYPE_INFO[type].maxDays} day${PASS_TYPE_INFO[type].maxDays === 1 ? '' : 's'} for this kind of pass.`}
            />
          )}
        </div>
      </Modal>
    </AksesPage>
  );
}
