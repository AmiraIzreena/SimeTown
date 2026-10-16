'use client';

import { Text } from '@/components/ui/localized-text';

import { BookOpen, Building, CalendarCheck, DoorOpen, Hammer, House, KeyRound, Paintbrush, ShieldCheck, Sparkles, Wind, Wrench } from 'lucide-react';
import { PreviewBadge, SimulatedNote } from '@/components/features/preview';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui/card';

/**
 * SimeTown Home, as a mock-up (proposal section 5: "Later", and section 16:
 * "Mock-up screens: SimeTown Assistant and SimeTown Home"). It shows what the service
 * would do. Nothing here can be booked, bought or sold, and every listing and
 * launch shown is invented.
 */
const LOGBOOK = [
  { icon: Wrench, title: 'Kitchen sink leak', text: 'Defect reported during the warranty period · fixed', badge: 'Closed', tone: 'success' as const },
  { icon: ShieldCheck, title: 'Roof and structure warranty', text: 'Defect liability period: 24 months from vacant possession', badge: '9 months left', tone: 'brand' as const },
  { icon: Wind, title: 'Air-conditioner, living room', text: 'Serviced every 6 months · next service due in 3 weeks', badge: 'Due soon', tone: 'gold' as const },
  { icon: BookOpen, title: 'Water heater manual and receipt', text: 'Stored with the logbook', badge: 'Saved', tone: 'neutral' as const },
];
const SERVICES = [
  { icon: Sparkles, title: 'Home cleaning', text: 'Vetted cleaners; a carer or helper pass is sent through Tamu.' },
  { icon: Wind, title: 'Air-conditioner service', text: 'Book a slot; the contractor gets a Tamu contractor pass.' },
  { icon: Paintbrush, title: 'Renovation', text: 'Approved contractors who follow the township’s renovation rules.' },
  { icon: Hammer, title: 'Repairs', text: 'Plumbing, electrical and carpentry from people SDP trusts.' },
];

export default function HomeServicesPage() {
  return (
    <>
      <PageHeader title="SimeTown Home" description="Home services from people Sime Darby Property trusts: a home logbook, bookings with contractor passes, and resale and rental inside the township." action={<PreviewBadge><Text>Coming soon</Text></PreviewBadge>} />
      <div className="space-y-6">
        <SimulatedNote><Text>SimeTown Home is not open yet. The records, listings and launches below are examples.</Text></SimulatedNote>

        <div className="home-service-grid grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Home logbook" description="Defects, warranties and appliance records in one place." />
            <ul className="divide-y divide-ink-100">
              {LOGBOOK.map((item) => (
                <li key={item.title} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
                      <item.icon className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-ink-900"><Text>{item.title}</Text></span>
                      <span className="block text-sm text-ink-500"><Text>{item.text}</Text></span>
                    </span>
                  </span>
                  <Badge tone={item.tone}><Text>{item.badge}</Text></Badge>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Book a home service" description="Each booking can send the contractor a pass through Tamu." />
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              {SERVICES.map((s) => (
                <div key={s.title} className="rounded-lg border border-ink-200 p-4">
                  <s.icon className="size-5 text-brand-700" aria-hidden />
                  <p className="mt-2 text-[15px] font-semibold text-ink-900"><Text>{s.title}</Text></p>
                  <p className="mt-1 text-sm text-ink-600"><Text>{s.text}</Text></p>
                  <Button size="sm" variant="secondary" className="mt-3" disabled>
                    <CalendarCheck className="size-4" aria-hidden /><Text>Booking opens soon</Text></Button>
                </div>
              ))}
            </div>
            <div className="border-t border-ink-100 px-5 py-3">
              <Button href="/app/tamu" variant="ghost" size="sm">
                <DoorOpen className="size-4" aria-hidden /><Text>Send a contractor pass now in Tamu</Text></Button>
            </div>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Resale and rental inside the township" description="Listings from residents, seen by residents first." />
            <ul className="divide-y divide-ink-100">
              {[
                { title: 'Terrace house, 4 bedrooms (sample listing)', text: 'Elmina Valley 2 · for rent', icon: House },
                { title: 'Pangsapuri Harmoni Elmina, 3 bedrooms (sample listing)', text: 'Block A, mid floor · for sale', icon: Building },
              ].map((l) => (
                <li key={l.title} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-gold-50 text-gold-700">
                    <l.icon className="size-5" aria-hidden />
                  </span>
                  <span>
                    <span className="block text-[15px] font-semibold text-ink-900"><Text>{l.title}</Text></span>
                    <span className="block text-sm text-ink-500"><Text>{l.text}</Text></span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="bg-gradient-to-br from-brand-800 to-brand-950 text-white">
            <div className="p-6">
              <Badge tone="gold"><Text>Early preview (sample)</Text></Badge>
              <h2 className="mt-3 text-xl font-bold text-white"><Text>A new phase is coming to the township</Text></h2>
              <p className="mt-2 text-[15px] text-brand-100"><Text>Residents and their families see new launches first. Engaged residents are the warmest leads for Sime Darby Property, and SimeTown Home is where they would hear first.</Text></p>
              <Button variant="light" className="mt-5" disabled>
                <KeyRound className="size-4" aria-hidden /><Text>Registration opens soon</Text></Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
