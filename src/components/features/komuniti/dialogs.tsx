'use client';

import { Text } from '@/components/ui/localized-text';
import { LocalizedImg, LocalizedInput } from '@/components/ui/localized-elements';

import { ImagePlus, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/field';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { shrinkPhoto } from '@/lib/image';
import { POST_FLAG_CATEGORIES, POST_FLAG_CATEGORY_LABELS, type PostFlagCategory, type PostType } from '@/shared/domain';
import { KINDS, addDays, today, type Post, type PostKind, type Responder } from './model';

/** "What would you like to post?" when the tab allows more than one kind. */
export function ChooseKind({ open, types, large, onClose, onChoose }: { open: boolean; types: PostType[]; large: boolean; onClose: () => void; onChoose: (kind: PostKind) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="What would you like to post?" description="Pick one. You can earn Impact XP once the other person confirms." footer={<Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {types.map((type) => {
          const kind = KINDS[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onChoose(kind)}
              className={cn('flex items-start gap-3 rounded-lg border border-ink-200 text-left transition-colors duration-200 hover:border-brand-400 hover:bg-brand-50/40 focus-visible:border-brand-500', large ? 'p-5' : 'p-4')}
            >
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-md', kind.tone)}>
                <kind.icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className={cn('block font-semibold text-ink-900', large ? 'text-lg' : 'text-[15px]')}><Text>{kind.create}</Text></span>
                <span className="mt-0.5 block text-sm text-ink-500"><Text>{kind.group}</Text> · <Text>{kind.pitch}</Text></span>
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/** Accepting a borrower: agree the date the item should come back. */
export function LendItem({ post, responder, large, onClose, onLent }: { post: Post; responder: Responder; large: boolean; onClose: () => void; onLent: () => void }) {
  const t = useT();
  const [dueBack, setDueBack] = useState(() => addDays(today(), 3));
  const accept = useAction((date: string) => api.post(`/posts/${post.id}/responses/${responder.user_id}/accept`, { dueBack: date }), {
    success: 'Accepted. They have been told the return date.',
    onSuccess: () => {
      onLent();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('Lend to {name}', { name: responder.name })}
      description="Agree when it should come back. You earn Impact XP once you mark it returned."
      footer={
        <>
          <Button size={large ? 'lg' : 'md'} variant="secondary" onClick={onClose}><Text>Cancel</Text></Button>
          <Button size={large ? 'lg' : 'md'} type="submit" form="lend-item" pending={accept.pending}><Text>Accept</Text></Button>
        </>
      }
    >
      <form method="post"
        id="lend-item"
        onSubmit={(event) => {
          event.preventDefault();
          void accept.run(dueBack);
        }}
      >
        <Input label="Return by" name="dueBack" type="date" value={dueBack} min={today()} max={addDays(today(), 60)} onChange={(event) => setDueBack(event.target.value)} required error={accept.fields.dueBack} />
      </form>
    </Modal>
  );
}

/** The create form. In guided (Akses) mode it asks one question at a time. */
export function CreatePost({ kind, accessible, onClose, onCreated }: { kind: PostKind; accessible: boolean; onClose: () => void; onCreated: () => void }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [location, setLocation] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [capacity, setCapacity] = useState('');
  const [guidedError, setGuidedError] = useState('');
  // One optional photo, shrunk in the browser before it is sent (as in Lapor).
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);
  const choosePhoto = (file: File | null) => {
    setPhoto(file);
    setPreview(file ? URL.createObjectURL(file) : null);
  };
  const steps = kind.type === 'EVENT' ? ['title', 'body', 'location', 'startsAt', 'capacity', 'photo'] as const : ['title', 'body', 'location', 'photo'] as const;
  const currentStep = steps[step];
  const create = useAction(async (body: Record<string, string | number | undefined>) => {
    if (!photo) return api.post('/posts', body);
    const data = new FormData();
    for (const [key, value] of Object.entries(body)) if (value !== undefined) data.set(key, String(value));
    data.set('photo', await shrinkPhoto(photo), 'photo.jpg');
    return api.post('/posts/with-photo', data);
  }, {
    success: 'Posted.',
    onSuccess: () => {
      onCreated();
      onClose();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void create.run({
      type: kind.type,
      title: title.trim(),
      body: body.trim(),
      location: location.trim() || undefined,
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      capacity: capacity ? Number(capacity) : undefined,
    });
  };
  const next = () => {
    const invalid = currentStep === 'title' && !title.trim()
      ? 'Please enter a title.'
      : currentStep === 'body' && !body.trim()
        ? 'Please enter details.'
        : currentStep === 'startsAt' && !startsAt
          ? 'Please choose a date and time.'
          : '';
    if (invalid) {
      setGuidedError(invalid);
      return;
    }
    setGuidedError('');
    setStep((current) => Math.min(current + 1, steps.length - 1));
  };
  const f = create.fields;
  return (
    <Modal
      open
      wide={accessible}
      className={accessible ? 'guided-modal' : undefined}
      onClose={onClose}
      title={kind.create}
      description={accessible ? t('Question {step} of {total}', { step: step + 1, total: steps.length }) : kind.xpNote}
      footer={
        <>
          {accessible && step > 0 && <Button size="lg" variant="secondary" onClick={() => setStep((current) => current - 1)}><Text>Back</Text></Button>}
          <Button size={accessible ? 'lg' : 'md'} variant="secondary" onClick={onClose}><Text>Cancel</Text></Button>
          {accessible && step < steps.length - 1 ? (
            <Button size="lg" onClick={next}><Text>Next</Text></Button>
          ) : (
            <Button size={accessible ? 'lg' : 'md'} type="submit" form="create-post" pending={create.pending}><Text>Post</Text></Button>
          )}
        </>
      }
    >
      {accessible && <p className="mb-4 text-base text-ink-600"><Text>{kind.xpNote}</Text></p>}
      <form method="post" id="create-post" onSubmit={submit} className="space-y-4" noValidate>
        {(!accessible || currentStep === 'title') && <Input label="Title" labelClassName={accessible ? '!text-3xl !font-semibold' : undefined} name="title" value={title} onChange={(event) => { setTitle(event.target.value); setGuidedError(''); }} maxLength={100} required error={guidedError || f.title} />}
        {(!accessible || currentStep === 'body') && <Textarea label="Details" labelClassName={accessible ? '!text-3xl !font-semibold' : undefined} name="body" value={body} onChange={(event) => { setBody(event.target.value); setGuidedError(''); }} maxLength={1000} required error={guidedError || f.body} />}
        {(!accessible || currentStep === 'location') && <Input label="Where (optional)" labelClassName={accessible ? '!text-3xl !font-semibold' : undefined} name="location" value={location} onChange={(event) => setLocation(event.target.value)} maxLength={120} error={f.location} />}
        {kind.type === 'EVENT' && (!accessible || currentStep === 'startsAt') && <Input label="Date and time" labelClassName={accessible ? '!text-3xl !font-semibold' : undefined} name="startsAt" type="datetime-local" value={startsAt} onChange={(event) => { setStartsAt(event.target.value); setGuidedError(''); }} required error={guidedError || f.startsAt} />}
        {kind.type === 'EVENT' && (!accessible || currentStep === 'capacity') && <Input label="Places (optional)" labelClassName={accessible ? '!text-3xl !font-semibold' : undefined} name="capacity" type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} min={1} inputMode="numeric" error={f.capacity} />}
        {(!accessible || currentStep === 'photo') && (
          <div className="space-y-2">
            <p className={accessible ? 'text-3xl font-semibold text-ink-900' : 'text-sm font-medium text-ink-700'}><Text>Photo (optional)</Text></p>
            {preview ? (
              <div className="flex items-start gap-3">
                <LocalizedImg src={preview} alt="The photo you chose" className="max-h-40 w-auto rounded-lg border border-ink-200 object-contain" />
                <Button size="sm" variant="ghost" onClick={() => choosePhoto(null)}><X className="size-4" aria-hidden /><Text>Remove</Text></Button>
              </div>
            ) : (
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-ink-300 bg-white p-3 text-sm text-ink-600 transition-colors hover:border-brand-400 hover:bg-brand-50/50 has-focus-visible:outline-2 has-focus-visible:outline-brand-600">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700"><ImagePlus className="size-4" aria-hidden /></span>
                <span>
                  <span className="block font-semibold text-ink-900"><Text>Add a photo</Text></span>
                  <Text>It helps neighbours see what you mean. JPEG, PNG or WebP.</Text>
                </span>
                <LocalizedInput type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => choosePhoto(event.target.files?.[0] ?? null)} />
              </label>
            )}
            <p className={accessible ? 'text-base text-ink-600' : 'text-xs text-ink-500'}><Text>Don’t include faces, car plates or house numbers.</Text></p>
          </div>
        )}
      </form>
    </Modal>
  );
}

/** Reporting a post to township staff: why, and (optionally) a few words. */
export function ReportPost({ post, onClose, onReported }: { post: Post | null; onClose: () => void; onReported: () => void }) {
  const [category, setCategory] = useState<PostFlagCategory>('SCAM');
  const flag = useAction((reason: string) => api.post(`/posts/${post!.id}/flag`, { category, reason: reason || undefined }), {
    success: 'Thank you. Township staff will look at it.',
    onSuccess: () => {
      onReported();
      onClose();
    },
  });
  return (
    <Modal
      open={post !== null}
      onClose={onClose}
      title="Report this post"
      description="Township staff see every report. Posts reported by several residents are hidden until staff have reviewed them. The person who posted it is not told who reported it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}><Text>Cancel</Text></Button>
          <Button variant="danger" type="submit" form="flag-post" pending={flag.pending}><Text>Report</Text></Button>
        </>
      }
    >
      <form method="post"
        id="flag-post"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void flag.run(String(new FormData(event.currentTarget).get('reason') ?? '').trim());
        }}
      >
        <Select label="What is wrong with it?" name="category" value={category} onChange={(event) => setCategory(event.target.value as PostFlagCategory)} error={flag.fields.category}>
          {POST_FLAG_CATEGORIES.map((c) => <option key={c} value={c}><Text>{POST_FLAG_CATEGORY_LABELS[c]}</Text></option>)}
        </Select>
        <Textarea
          label={category === 'OTHER' ? 'Tell us more' : 'Tell us more (optional)'}
          name="reason"
          maxLength={200}
          required={category === 'OTHER'}
          error={flag.fields.reason}
        />
      </form>
    </Modal>
  );
}
