'use client';

import { Text } from '@/components/ui/localized-text';

import { Download, LogOut, Mail, MapPin, ShieldAlert, Trash2 } from 'lucide-react';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { useState, type FormEvent } from 'react';
import { AksesPage, AksesWizard, useAksesMode } from '@/components/features/akses-mode';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Async, Skeleton } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { formatPhone, ROLE_LABELS } from '@/shared/domain';
import { reloadTo } from '@/lib/navigate';
import { AddressPicker } from './address';
import { ShopAddressFields } from './auth';

/** Parcel emails: on unless the resident switches them off. Security alerts about their locker door always come. */
function EmailCard({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const save = useAction((parcels: boolean) => api.post<{ parcels: boolean }>('/me/email-preferences', { parcels }), {
    success: (r) => (r.parcels ? 'Parcel emails are on.' : 'Parcel emails are off. Security alerts still come by email.'),
    onSuccess: onChanged,
  });
  const emails = me.emails;
  if (!emails) return null;
  return (
    <Card>
      <CardHeader title="Emails" description="Parcel news in your inbox, in the language you use in SimeTown. Pickup codes are never sent by email." />
      <div className="space-y-4 p-5">
        <p className="flex items-center gap-2 text-sm text-ink-600"><Mail className="size-4 shrink-0 text-ink-400" aria-hidden /><span className="min-w-0 break-all">{emails.address ?? <Text>No email address on your account</Text>}</span></p>
        <Switch
          label="Parcel emails"
          hint="When a parcel is in your locker or at the guardhouse, and a weekly reminder while one waits at the guardhouse."
          checked={emails.parcels}
          disabled={save.pending}
          onChange={(on) => void save.run(on)}
        />
        <p className="flex items-start gap-2 rounded-lg bg-ink-25 p-3 text-sm text-ink-600"><ShieldAlert className="mt-0.5 size-4 shrink-0 text-ink-400" aria-hidden /><Text>Security alerts, such as your locker door being opened without a code, are always sent.</Text></p>
      </div>
    </Card>
  );
}

/** A resident's home address. Choosing a different home means it is confirmed again (BR1). */
function HomeCard({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [changing, setChanging] = useState(false);
  const change = useAction((body: { homeId: string; occupancy: string }) => api.post('/me/home', body), {
    success: 'Address saved. The township office will confirm your home.',
    onSuccess: () => {
      setChanging(false);
      onChanged();
    },
  });
  const incomplete = me.missing.includes('address');
  return (
    <Card>
      <CardHeader title="Home address" description="Linked to the property record. Staff confirm it before you can earn or spend." />
      <div className="space-y-4 p-5">
        {me.home && !incomplete ? (
          <p className="flex items-start gap-2 text-[15px] text-ink-800">
            <MapPin className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
            <span>
              {me.home.address}
              <span className="block text-sm text-ink-500"><Text>{me.occupancy === 'TENANT' ? 'Tenant' : 'Owner'}</Text></span>
            </span>
          </p>
        ) : (
          <p className="rounded-md border border-warning-600/30 bg-warning-50 p-3 text-sm text-warning-700"><Text>Your address is incomplete. Please choose your home from the list.</Text></p>
        )}
        <Button variant={incomplete ? 'primary' : 'secondary'} onClick={() => setChanging(true)}>
          <Text>{incomplete ? 'Choose my address' : 'Change address'}</Text>
        </Button>
      </div>
      <Modal
        open={changing}
        onClose={() => setChanging(false)}
        title="Your address"
        description="If you choose a different home, your account is confirmed again before you can earn or spend."
        footer={
          <>
            <Button variant="secondary" onClick={() => setChanging(false)}><Text>Cancel</Text></Button>
            <Button type="submit" form="change-home" pending={change.pending}><Text>Save address</Text></Button>
          </>
        }
      >
        <form
          id="change-home"
          method="post"
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
            void change.run({ homeId: form.homeId ?? '', occupancy: form.occupancy ?? 'OWNER' });
          }}
        >
          <AddressPicker townshipId={me.townshipId} error={change.fields.homeId} />
          <Select label="I am the" name="occupancy" defaultValue={me.occupancy ?? 'OWNER'} error={change.fields.occupancy}>
            <option value="OWNER"><Text>Owner</Text></option>
            <option value="TENANT"><Text>Tenant</Text></option>
          </Select>
        </form>
      </Modal>
    </Card>
  );
}

/** A shop's business address, shown to residents in the shop directory. */
function ShopAddressCard({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const save = useAction((body: Record<string, unknown>) => api.patch('/merchant/profile', body), { success: 'Shop address saved.', onSuccess: onChanged });
  return (
    <Card>
      <CardHeader title="Shop address" description="Shown to residents in the shop directory." />
      <form
        method="post"
        className="space-y-4 p-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save.run(Object.fromEntries(new FormData(event.currentTarget)));
        }}
      >
        <ShopAddressFields fields={save.fields} initial={me.shop ?? undefined} />
        <Button type="submit" pending={save.pending}><Text>Save shop address</Text></Button>
      </form>
    </Card>
  );
}

/** Profile, address, password and personal-data rights (PDPA). The same screen for every role. */
export function AccountPanel({ accessible = false }: { accessible?: boolean }) {
  const me = useApi<Me>('/me');
  const [deleting, setDeleting] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileStep, setProfileStep] = useState(0);
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordStep, setPasswordStep] = useState(0);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const save = useAction((body: { fullName: string; phone: string }) => api.patch('/me', body), { success: 'Profile saved.', onSuccess: () => void me.mutate() });
  const password = useAction((body: { current: string; next: string }) => api.post('/me/password', body), { success: 'Password changed. Other devices have been signed out.' });
  const remove = useAction((pw: string) => api.post('/me/delete', { password: pw }), { onSuccess: () => reloadTo('/') });

  const onProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    void save.run({ fullName: form.fullName!, phone: form.phone ?? '' });
  };
  const onPassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = event.currentTarget;
    const form = Object.fromEntries(new FormData(element)) as Record<string, string>;
    void password.run({ current: form.current!, next: form.next! }).then((ok) => ok && element.reset());
  };

  return (
    <>
      <PageHeader title="Account" description="Your details, your password and your personal data." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" />
          <Async state={me} skeleton={<div className="p-5"><Skeleton className="h-40" /></div>}>
            {(user) => accessible ? (
                <div className="space-y-4 p-5">
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="brand"><Text>{ROLE_LABELS[user.role]}</Text></Badge>
                    {user.role === 'RESIDENT' && <Badge tone={user.residencyStatus === 'VERIFIED' ? 'success' : 'warning'}><Text>{user.residencyStatus === 'VERIFIED' ? 'Home confirmed' : 'Home not confirmed yet'}</Text></Badge>}
                  </div>
                  <p className="text-lg"><strong><Text>Email</Text>:</strong> {user.email}</p>
                  <p className="text-lg"><strong><Text>Full name</Text>:</strong> {user.fullName}</p>
                  <p className="text-lg"><strong><Text>Phone</Text>:</strong> {user.phone ? formatPhone(user.phone) : <Text>Not set</Text>}</p>
                  <Button size="lg" className="min-h-20 w-full text-xl" onClick={() => {
                    setFullName(user.fullName);
                    setPhoneNumber(user.phone ? formatPhone(user.phone) : '');
                    setProfileStep(0);
                    setProfileOpen(true);
                  }}><Text>Edit profile one step at a time</Text></Button>
                </div>
              ) : (
              <form method="post" onSubmit={onProfile} className="space-y-4 p-5" noValidate>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="brand"><Text>{ROLE_LABELS[user.role]}</Text></Badge>
                  {user.role === 'RESIDENT' && <Badge tone={user.residencyStatus === 'VERIFIED' ? 'success' : 'warning'}><Text>{user.residencyStatus === 'VERIFIED' ? 'Home confirmed' : 'Home not confirmed yet'}</Text></Badge>}
                </div>
                <Input label="Email" value={user.email} readOnly disabled hint="Contact the township office to change your email." />
                <Input label="Full name" name="fullName" defaultValue={user.fullName} autoComplete="name" required error={save.fields.fullName} />
                <Input
                  label="Phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  defaultValue={user.phone ? formatPhone(user.phone) : ''}
                  autoComplete="tel"
                  required
                  hint={user.phone ? 'Used for urgent alerts and by the township office.' : 'Required. A Malaysian mobile number, such as 012-345 6789.'}
                  error={save.fields.phone}
                />
                <Button type="submit" pending={save.pending}><Text>Save profile</Text></Button>
              </form>
              )}
          </Async>
        </Card>

        {me.data?.role === 'RESIDENT' && <HomeCard me={me.data} onChanged={() => void me.mutate()} />}
        {me.data?.role === 'RESIDENT' && <EmailCard me={me.data} onChanged={() => void me.mutate()} />}
        {me.data?.role === 'MERCHANT' && <ShopAddressCard me={me.data} onChanged={() => void me.mutate()} />}

        <Card>
          <CardHeader title="Password" description="Changing it signs you out everywhere else." />
          {accessible ? (
            <div className="p-5">
              <Button size="lg" className="min-h-20 w-full text-xl" onClick={() => { setPasswordStep(0); setCurrentPassword(''); setNewPassword(''); setPasswordOpen(true); }}><Text>Change password one step at a time</Text></Button>
            </div>
          ) : (
          <form onSubmit={onPassword} method="post" className="space-y-4 p-5" noValidate>
            <Input label="Current password" name="current" type="password" autoComplete="current-password" required error={password.fields.current} />
            <Input label="New password" name="next" type="password" autoComplete="new-password" hint="At least 10 characters." required error={password.fields.next} />
            <Button type="submit" pending={password.pending}><Text>Change password</Text></Button>
          </form>
          )}
        </Card>

        <Card>
          <CardHeader title="Your data" description="Under Malaysia’s Personal Data Protection Act you can see and remove what we hold about you." />
          <div className="flex flex-wrap gap-3 p-5">
            <a href="/api/v1/me/export" download className="inline-flex min-h-11 items-center gap-2 rounded-md border border-ink-200 bg-white px-4 text-[15px] font-semibold text-ink-800 shadow-xs transition-colors duration-200 hover:border-ink-300 hover:bg-ink-25">
              <Download className="size-4" aria-hidden /><Text>Download my data</Text></a>
            <Button variant="ghost" className="text-accent-600 hover:bg-accent-50" onClick={() => setDeleting(true)}>
              <Trash2 className="size-4" aria-hidden /><Text>Delete my account</Text></Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="Terms and privacy" description="The agreements that apply to your account." />
          <div className="space-y-3 p-5 text-[15px] text-ink-700">
            {me.data?.terms.version === me.data?.terms.current && me.data?.terms.acceptedAt ? (
              <p><Text>You accepted the current Terms of Use and Privacy Notice on </Text><Text>{formatDate(me.data.terms.acceptedAt)}</Text>.</p>
            ) : (
              <p><Text>The Terms of Use and Privacy Notice have changed since you last accepted them. You will be asked to review them.</Text></p>
            )}
            <div className="flex flex-wrap gap-4">
              <Link href="/terms" className="font-semibold text-brand-700 hover:underline"><Text>Terms of Use</Text></Link>
              <Link href="/privacy" className="font-semibold text-brand-700 hover:underline"><Text>Privacy Notice</Text></Link>
            </div>
          </div>
        </Card>

        <Card className="lg:hidden">
          <div className="p-5">
            <Button
              variant="secondary"
              className="w-full"
              onClick={async () => {
                await api.post('/auth/logout').catch(() => undefined);
                reloadTo('/');
              }}
            >
              <LogOut className="size-4" aria-hidden /><Text>Sign out</Text></Button>
          </div>
        </Card>
      </div>

      <Modal
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete your account?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(false)}><Text>Keep my account</Text></Button>
            <Button variant="danger" type="submit" form="delete-account" pending={remove.pending}><Text>Delete for good</Text></Button>
          </>
        }
      >
        <form
          id="delete-account"
          method="post"
          className="space-y-4 text-[15px] text-ink-700"
          onSubmit={(event) => {
            event.preventDefault();
            void remove.run(String(new FormData(event.currentTarget).get('password')));
          }}
        >
          <p><Text>This cannot be undone. Your name, contact details, posts and photos are removed.</Text></p>
          {me.data?.role === 'RESIDENT' && <p><Text>Any points you still hold are given up and go back to whoever funded them. Anonymous records of past transactions are kept, as the law requires.</Text></p>}
          <Input label="Enter your password to confirm" name="password" type="password" autoComplete="current-password" required />
        </form>
      </Modal>
      {accessible && (
        <>
          <AksesWizard open={profileOpen} title="Edit profile" step={profileStep} total={2} onClose={() => setProfileOpen(false)} onBack={() => setProfileStep((step) => step - 1)} onNext={() => setProfileStep(1)} onSubmit={() => void save.run({ fullName: fullName.trim(), phone: phoneNumber }).then((result) => result && setProfileOpen(false))} pending={save.pending} submitLabel="Save profile">
            {profileStep === 0 ? (
              <Input label="Full name" labelClassName="!text-3xl !font-semibold" value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required error={save.fields.fullName} />
            ) : (
              <Input label="Phone number" labelClassName="!text-3xl !font-semibold" type="tel" inputMode="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} autoComplete="tel" required hint="A Malaysian mobile number, such as 012-345 6789." error={save.fields.phone} />
            )}
          </AksesWizard>
          <AksesWizard open={passwordOpen} title="Change password" step={passwordStep} total={2} onClose={() => setPasswordOpen(false)} onBack={() => setPasswordStep((step) => step - 1)} onNext={() => setPasswordStep(1)} onSubmit={() => void password.run({ current: currentPassword, next: newPassword }).then((result) => result && setPasswordOpen(false))} pending={password.pending} submitLabel="Change password">
            {passwordStep === 0 ? (
              <Input label="Current password" labelClassName="!text-3xl !font-semibold" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required error={password.fields.current} />
            ) : (
              <Input label="New password" labelClassName="!text-3xl !font-semibold" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required hint="At least 10 characters." error={password.fields.next} />
            )}
          </AksesWizard>
        </>
      )}
    </>
  );
}

export function ResidentAccountPanel() {
  const akses = useAksesMode();
  return (
    <AksesPage>
      <AccountPanel accessible={akses.guided} />
    </AksesPage>
  );
}
