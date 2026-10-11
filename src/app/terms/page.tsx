
import { Text } from '@/components/ui/localized-text';
import type { Metadata } from 'next';
import { LocalizedLink as Link } from '@/components/ui/localized-elements';
import { Bullets, LegalDocument, type LegalSection } from '@/components/features/legal';
import { LEGAL } from '@/shared/legal';

export const metadata: Metadata = { title: 'Terms of Use', description: 'The terms that apply when you use KITA+.' };

const link = (href: string, text: string) => (
  <Link href={href} className="font-semibold text-brand-700 hover:underline">
    <Text>{text}</Text>
  </Link>
);

const sections: LegalSection[] = [
  {
    id: 'about',
    title: 'About KITA+ and these Terms',
    body: (
      <>
        <p><Text>KITA+ is a township platform that brings community, safety, mobility, green living and local shopping into one account. It is operated by </Text><Text>{LEGAL.operator}</Text><Text> (“we”, “us”). These Terms of Use (“Terms”) apply whenever you create an account or use KITA+.</Text></p>
        <p><Text>KITA+ is currently a </Text><strong><Text>prototype</Text></strong><Text> built for the Sime Darby Property University Hackathon 2026. It is not an official Sime Darby Property service. In this prototype the townships, homes, shops, sponsors and figures are demonstration data, no real money moves, and KITA Points cannot be exchanged for real goods or services.</Text></p>
        <p><Text>By ticking “I accept” when you register, or by using KITA+, you agree to these Terms and to our </Text><Text>{link('/privacy', 'Privacy Notice')}</Text><Text>. If you do not agree, please do not use KITA+.</Text></p>
      </>
    ),
  },
  {
    id: 'eligibility',
    title: 'Who can use KITA+',
    body: (
      <Bullets
        items={[
          'Resident accounts are for people who live in, or own a home in, a participating township. You must be 18 or older, or have the consent of a parent or guardian.',
          'Shop accounts are for businesses registered in Malaysia that operate in the township. A shop can give and accept points only after the township office approves it.',
          'Sponsor, township staff and administrator accounts are created by invitation only.',
        ]}
      />
    ),
  },
  {
    id: 'account',
    title: 'Your account',
    body: (
      <>
        <Bullets
          items={[
            'Give accurate details: your full name, a working email address and phone number, and your real address. Keep them up to date on your Account page.',
            'One account per person. Do not share your account or let anyone else use it.',
            'Keep your password secret. You are responsible for what happens in your account. Tell the township office straight away if you think someone else has used it.',
            'Your home is confirmed against the township’s property record before you can earn or spend points. Tenants may be confirmed by the owner or by the township office. We may refuse a confirmation we cannot verify.',
            'If you choose a different home, your account must be confirmed again.',
          ]}
        />
      </>
    ),
  },
  {
    id: 'points',
    title: 'KITA Points and Impact XP',
    body: (
      <>
        <p>
          <strong><Text>Impact XP</Text></strong><Text> recognises verified good actions such as recycling, walking a township loop or helping a neighbour. It gives you levels and badges. It has no money value.</Text></p>
        <p>
          <strong><Text>KITA Points</Text></strong><Text> have value only when spent at participating township shops, where 100 points are worth RM1. They are not money, not e-money and not a deposit.</Text></p>
        <Bullets
          items={[
            'Points are given only when a shop, a sponsor or Sime Darby Property has already paid for them (“no pool, no points”). When a reward pool runs out, those rewards stop.',
            'You can use points from 100 points, in whole ringgit, for up to 30% of one bill. You confirm every use on your own phone. No points are earned on the part of a bill paid with points.',
            'Points cannot be exchanged for cash, withdrawn, sold or transferred to another person.',
            'Points stay valid while you earn or spend at least once every 12 months, and for at most 24 months from when they were earned. We remind you 60 and 14 days before points expire.',
            'If a purchase is refunded, points earned on it are taken back, and points you spent on it are returned as points, never as cash.',
            'Daily and monthly limits apply to each person and each home.',
            'We may correct mistakes in a balance (with the approval of a second administrator) and reverse points obtained by error, misuse or fraud.',
            'If a daily check finds a problem with the reward float, points may be paused until it is resolved.',
          ]}
        />
        <p><Text>Programme rules such as rates and limits are shown in the app and may change. We will tell you in the app before a change that affects points you already hold.</Text></p>
      </>
    ),
  },
  {
    id: 'shops',
    title: 'Shops',
    body: (
      <Bullets
        items={[
          'Record only real sales, at the amount actually paid, for the resident whose member code you were shown.',
          'Points you give are paid from your prefunded reward pool, together with the service fee shown in your dashboard. Without enough money in the pool, no points are given.',
          'Accept points within the rules above. You are paid 100% of the value of points you accept, in a weekly settlement. There is no fee for accepting points.',
          'Process refunds in KITA+ as well as at your till, so points are adjusted correctly.',
          'Keep your business details and address up to date. We may suspend a shop that breaks these Terms.',
        ]}
      />
    ),
  },
  {
    id: 'sponsors',
    title: 'Sponsors and campaigns',
    body: (
      <p><Text>Sponsors fund challenges with a fixed budget paid in advance. Rewards stop when the budget is used, and any unused budget is refunded when the campaign closes. Sponsors receive grouped results only, never details of individual residents, unless a resident chooses to share them.</Text></p>
    ),
  },
  {
    id: 'community',
    title: 'Community features and your content',
    body: (
      <>
        <p><Text>Jiran, Kongsi and Lapor let you post events, ask for or offer help, give away or lend items, and report problems. When you post or report:</Text></p>
        <Bullets
          items={[
            'Be truthful and respectful. Do not post anything unlawful, harmful, misleading, discriminatory or that invades someone’s privacy.',
            'Do not make false reports. Impact XP for a report is given only after township staff confirm it.',
            'Exchanges of items or help are between residents. We are not a party to them, and items are given as they are.',
            'Posts flagged by several residents are hidden until a moderator reviews them. We may remove content that breaks these Terms.',
          ]}
        />
        <p><Text>You keep ownership of what you post. You allow us to store, display and process it to run KITA+ for the township.</Text></p>
      </>
    ),
  },
  {
    id: 'safety',
    title: 'Flood alerts and safety information',
    body: (
      <>
        <p><Text>Banjir shows water levels and warnings by zone, and a danger warning with a safe route. These alerts </Text><strong><Text>support but do not replace</Text></strong><Text> official warnings from the authorities, such as Jabatan Pengairan dan Saliran (Public Infobanjir) and the National Disaster Management Agency (NADMA). Always follow instructions from the authorities.</Text></p>
        <p>
          <strong><Text>In an emergency, call 999.</Text></strong><Text> In this prototype, water levels come from a simulated sensor.</Text></p>
      </>
    ),
  },
  {
    id: 'ai',
    title: 'Automated suggestions',
    body: (
      <p><Text>KITA+ may suggest the type and urgency of a report, or the material of an item you recycle, using rules or an AI service. Suggestions can be wrong. Township staff can always correct them, and every correction is recorded.</Text></p>
    ),
  },
  {
    id: 'use',
    title: 'Acceptable use',
    body: (
      <Bullets
        items={[
          'Do not create fake accounts, impersonate anyone, or try to earn points or XP in ways the rules do not intend, such as fake sales, invented drop-offs or shared checkpoint codes.',
          'Do not try to get into accounts or data that are not yours, interfere with KITA+, or collect data from it by automated means.',
          'Do not use KITA+ for any unlawful purpose.',
        ]}
      />
    ),
  },
  {
    id: 'availability',
    title: 'Availability and changes to KITA+',
    body: (
      <p><Text>KITA+ is a prototype and is provided as it is. We may change, pause or stop features, and demonstration data may be reset. We try to keep KITA+ available and accurate but cannot promise that it will always be uninterrupted or error-free.</Text></p>
    ),
  },
  {
    id: 'liability',
    title: 'Our responsibility to you',
    body: (
      <>
        <p><Text>Nothing in these Terms limits rights you have under Malaysian law that cannot be limited, including under the Consumer Protection Act 1999. Subject to that, we are not responsible for loss that was not reasonably foreseeable, for loss caused by events outside our reasonable control, or for exchanges between residents.</Text></p>
        <p><Text>Where we are responsible for a mistake in your points, we will correct your balance.</Text></p>
      </>
    ),
  },
  {
    id: 'closing',
    title: 'Closing or suspending an account',
    body: (
      <p><Text>You can delete your account at any time from your Account page. Your personal details are then removed, and any points you still hold are given up and go back to whoever funded them. We may suspend or close an account that breaks these Terms, and will tell you why unless the law prevents us.</Text></p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these Terms',
    body: (
      <p><Text>We may update these Terms. The version and date are shown at the top of this page. When we make a change that matters, we will ask you to read and accept the new Terms the next time you sign in.</Text></p>
    ),
  },
  {
    id: 'law',
    title: 'Law and disputes',
    body: <p><Text>These Terms are governed by the laws of Malaysia. The courts of Malaysia have jurisdiction over any dispute about them.</Text></p>,
  },
  {
    id: 'contact',
    title: 'Contact us',
    body: (
      <p><Text>Questions about these Terms: </Text><a href={`mailto:${LEGAL.contactEmail}`} className="font-semibold text-brand-700 hover:underline"><Text>{LEGAL.contactEmail}</Text></a><Text>, or speak to your township office.</Text></p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Use"
      other={{ href: '/privacy', label: 'Privacy Notice' }}
      summary={
        <>
          <p className="font-semibold"><Text>In short</Text></p>
          <p className="mt-1"><Text>Give accurate details and keep your account to yourself. KITA Points are a reward worth RM1 per 100 points at township shops, never cash. Be respectful in community features. Flood alerts support, but do not replace, official warnings. This is a prototype: no real money moves.</Text></p>
        </>
      }
      sections={sections}
    />
  );
}
