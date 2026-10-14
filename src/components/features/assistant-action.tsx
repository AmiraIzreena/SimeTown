'use client';

import { Text } from '@/components/ui/localized-text';

import { Pencil } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';

export interface PassDetails {
  visitorName: string;
  vehicleNo: string;
  type: 'ONE_VISIT' | 'DELIVERY' | 'EVENT';
  date: string;
  startTime: string;
  hours: number;
}

export interface AssistantAction {
  id: string;
  kind: 'CREATE_VISITOR_PASS' | 'HAND_OVER_TO_STAFF';
  summary: string;
  status: 'PROPOSED' | 'DONE' | 'CANCELLED' | 'EXPIRED' | 'FAILED' | 'SUPERSEDED';
  details: PassDetails | { question: string };
}

const STATUS: Record<Exclude<AssistantAction['status'], 'PROPOSED'>, string> = {
  DONE: 'Done',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired: ask again if you still need it',
  FAILED: 'Did not work',
  SUPERSEDED: 'Replaced by a newer proposal',
};

const TYPES: [PassDetails['type'], string, number][] = [
  ['ONE_VISIT', 'One visit (up to 48 hours)', 48],
  ['DELIVERY', 'Delivery (up to 24 hours)', 24],
  ['EVENT', 'Event guest (up to 48 hours)', 48],
];

/**
 * A task the Assistant proposed. Nothing happens until the resident taps Yes;
 * before that they can change any detail here, and the server checks the
 * changes with the same rules as the proposal itself.
 */
export function AssistantActionCard({
  action,
  onDecide,
  onChanged,
}: {
  action: AssistantAction;
  onDecide: (yes: boolean) => void;
  onChanged: (action: AssistantAction) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const pass = action.kind === 'CREATE_VISITOR_PASS' ? (action.details as PassDetails) : null;
  const question = action.kind === 'HAND_OVER_TO_STAFF' ? (action.details as { question: string }).question : '';
  const [draft, setDraft] = useState<PassDetails | null>(pass);
  const [draftQuestion, setDraftQuestion] = useState(question);
  const maxHours = TYPES.find(([t]) => t === draft?.type)?.[2] ?? 48;

  const startEditing = () => {
    setDraft(pass);
    setDraftQuestion(question);
    setError(null);
    setFields({});
    setEditing(true);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = pass
        ? { pass: { ...draft!, visitorName: draft!.visitorName.trim(), vehicleNo: draft!.vehicleNo.trim() || undefined } }
        : { question: draftQuestion };
      onChanged(await api.post<AssistantAction>(`/assistant/actions/${action.id}/edit`, body));
      setEditing(false);
    } catch (e) {
      if (e instanceof ApiError) {
        setFields(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k.replace(/^pass\./, ''), v])));
        setError(e.message);
      } else setError('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-md border border-ink-200 bg-white p-3 text-sm">
      {!editing && <p className="text-ink-800"><Text>{action.summary}</Text></p>}
      {action.status !== 'PROPOSED' ? (
        <p className="mt-1 text-xs text-ink-500"><Text>{STATUS[action.status]}</Text></p>
      ) : editing ? (
        <form method="post" onSubmit={save} className="space-y-3" noValidate>
          {draft ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Visitor’s name" value={draft.visitorName} maxLength={80} onChange={(e) => setDraft({ ...draft, visitorName: e.target.value })} error={fields.visitorName} required />
                <Select label="Kind of pass" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as PassDetails['type'] })}>
                  {TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      <Text>{label}</Text>
                    </option>
                  ))}
                </Select>
                <Input label="Day" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} error={fields.date} required />
                <Input label="From (Malaysia time)" type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} error={fields.startTime} required />
                <Input
                  label="For how many hours"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={maxHours}
                  value={String(draft.hours)}
                  onChange={(e) => setDraft({ ...draft, hours: Number(e.target.value) })}
                  error={fields.hours}
                  required
                />
                <Input label="Car plate (optional)" value={draft.vehicleNo} maxLength={15} onChange={(e) => setDraft({ ...draft, vehicleNo: e.target.value })} error={fields.vehicleNo} />
              </div>
            </>
          ) : (
            <Textarea label="Your question for the township office" rows={3} maxLength={1000} value={draftQuestion} onChange={(e) => setDraftQuestion(e.target.value)} error={fields.question} />
          )}
          {error && <p className="text-xs text-accent-700"><Text>{error}</Text></p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" pending={saving}><Text>Save changes</Text></Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}><Text>Keep as it was</Text></Button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onDecide(true)}>
            <Text>{pass ? 'Yes, make the pass' : 'Yes, send it'}</Text></Button>
          <Button size="sm" variant="secondary" onClick={startEditing}>
            <Pencil className="size-3.5" aria-hidden /><Text>Change</Text></Button>
          <Button size="sm" variant="secondary" onClick={() => onDecide(false)}><Text>No</Text></Button>
        </div>
      )}
    </div>
  );
}
