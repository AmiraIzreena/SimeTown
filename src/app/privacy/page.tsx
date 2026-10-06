import type { Metadata } from 'next';
import { Bullets, LegalDocument, type LegalSection } from '@/components/features/legal';
import { LEGAL } from '@/shared/legal';

export const metadata: Metadata = { title: 'Privacy Notice', description: 'How KITA+ collects, uses and protects your personal data.' };

const mail = (
  <a href={`mailto:${LEGAL.contactEmail}`} className="font-semibold text-brand-700 hover:underline">
    {LEGAL.contactEmail}
  </a>
);

/** One row of the "what we collect" table. */
const Row = ({ what, details }: { what: string; details: string }) => (
  <tr className="border-t border-ink-200 align-top">
    <th scope="row" className="w-1/3 py-2.5 pr-4 text-left font-semibold text-ink-900">
      {what}
    </th>
    <td className="py-2.5">{details}</td>
  </tr>
);

const sections: LegalSection[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: (
      <>
        <p>
          KITA+ is operated by {LEGAL.operator} (“we”, “us”). We are responsible for the personal data processed in KITA+ and handle it in line with Malaysia’s Personal Data Protection Act
          2010, as amended in 2024 (“PDPA”). This notice explains what we collect, why, who sees it, how long we keep it, and your rights.
        </p>
        <p>
          KITA+ is a prototype for the Sime Darby Property University Hackathon 2026 and is not an official Sime Darby Property service. Before KITA+ is offered to the public, this notice will
          be reviewed and a Bahasa Malaysia version provided.
        </p>
      </>
    ),
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <>
        <table className="w-full text-[15px]">
          <caption className="sr-only">Personal data KITA+ collects</caption>
          <tbody>
            <Row what="Account" details="Full name, email address, phone number, your role, and your password (stored only as a one-way scrambled hash, never in readable form)." />
            <Row what="Home (residents)" details="The address you choose from the township’s property record, whether you are the owner or a tenant, and whether your home has been confirmed." />
            <Row what="Shop (shops)" details="Business name, registration number, type and business address, and the contact person’s name, email and phone number." />
            <Row what="Points and activity" details="Points earned and spent and who funded them; purchases at member shops (shop, amount, points); recycling drop-offs (material and weight); trail check-ins; monthly electricity and water readings; Impact XP and badges." />
            <Row what="What you post" details="Community posts and responses, reports with their description, the location you type and an optional photo, and whether you asked to be contacted about solar." />
            <Row what="Technical" details="A sign-in cookie, records of requests (time, page, result and account), and your internet address to limit repeated attempts." />
          </tbody>
        </table>
        <p>
          We do <strong>not</strong> collect your MyKad number, bank or card details, precise GPS location, contacts or biometric data. Photos you take to check a recycling material are
          checked and then discarded, not stored.
        </p>
      </>
    ),
  },
  {
    id: 'why',
    title: 'Why we use it',
    body: (
      <>
        <p>We use your personal data, with your consent and to provide the service you signed up for, to:</p>
        <Bullets
          items={[
            'create and secure your account, and confirm your home against the property record;',
            'run the points programme: record points, apply its rules and limits, and pay shops for points they accept;',
            'send you safety warnings, such as flood alerts for your zone, and notices about your account;',
            'run community features, reports and moderation;',
            'show the township grouped results, such as kilograms recycled, without identifying anyone;',
            'prevent and investigate fraud, misuse and security incidents; and',
            'meet our legal obligations.',
          ]}
        />
        <p>We do not sell your personal data, and we do not use it for advertising.</p>
      </>
    ),
  },
  {
    id: 'share',
    title: 'Who can see it',
    body: (
      <Bullets
        items={[
          <><strong>Township office staff</strong> see what they need to confirm homes, handle reports, moderate posts and contact residents who asked about solar.</>,
          <><strong>Shops</strong> see only your first name and initial when you buy or use points with them, never your contact details or address.</>,
          <><strong>Sponsors</strong> see grouped totals only, and nothing at all for very small groups. They see your details only if you choose to share them.</>,
          <><strong>Other residents</strong> see your first name on posts and responses. Street leagues show street totals, not individuals.</>,
          <><strong>Sime Darby Property</strong> sees township-level results that do not identify anyone.</>,
          <><strong>Service providers</strong> that run KITA+ for us under contract: our hosting provider and our database provider (Supabase). If automated photo and report checks are switched on, the photo or report text, without your name or contact details, is sent to an AI service provider to suggest a category.</>,
          <><strong>Authorities</strong>, where the law requires it.</>,
        ]}
      />
    ),
  },
  {
    id: 'transfers',
    title: 'Data stored outside Malaysia',
    body: (
      <p>
        Our database is hosted in Singapore, and an AI service provider, if used, may process data in other countries. When personal data leaves Malaysia we take steps, as the PDPA requires,
        to make sure it is protected to a standard comparable to Malaysian law, including choosing providers with strong security and contractual protections.
      </p>
    ),
  },
  {
    id: 'keep',
    title: 'How long we keep it',
    body: (
      <Bullets
        items={[
          'Your account details, for as long as your account is open.',
          'When you delete your account: your name, contact details, posts, report descriptions and photos are removed at once. Records of points transactions are kept in anonymised form, because financial records must stay complete.',
          'Sign-in sessions end after 7 days or when you sign out. Set-password links expire after 7 days. Internet addresses used to limit repeated attempts are kept for no more than a day.',
        ]}
      />
    ),
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: (
      <>
        <Bullets
          items={[
            'Passwords are stored only as salted one-way hashes. Connections to KITA+ and to our database are encrypted.',
            'Each role sees only what it needs. Sensitive actions, such as balance corrections, new administrator accounts and password resets for accounts in use, need a second person to approve.',
            'Important actions are recorded in an audit trail.',
          ]}
        />
        <p>If a personal data breach is likely to cause you significant harm, we will tell you and the Personal Data Protection Commissioner as the PDPA requires.</p>
      </>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: (
      <>
        <Bullets
          items={[
            <><strong>Access and portability:</strong> download everything we hold about you, in a machine-readable file, from your Account page.</>,
            <><strong>Correction:</strong> update your name, phone and address on your Account page, or ask the township office to change your email.</>,
            <><strong>Withdrawing consent and deletion:</strong> withdraw a solar request at any time, or delete your account from your Account page. Some features need certain data, so withdrawing consent may mean you can no longer use them.</>,
            <><strong>Complaints:</strong> contact us first. You may also complain to the Personal Data Protection Commissioner (Jabatan Perlindungan Data Peribadi).</>,
          ]}
        />
        <p>For any other request, email {mail}. We reply within 21 days.</p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies and browser storage',
    body: (
      <p>
        KITA+ uses one essential cookie, which keeps you signed in. It cannot be read by scripts and is deleted when you sign out or after 7 days. Your browser also remembers, for the current
        visit only, whether you have already seen a flood warning or a reminder to complete your details. We use no analytics, advertising or third-party cookies.
      </p>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: <p>KITA+ is for adults. Anyone under 18 may use it only with the consent of a parent or guardian.</p>,
  },
  {
    id: 'changes',
    title: 'Changes to this notice',
    body: (
      <p>
        The version and date of this notice are shown at the top. When we make a change that matters, we will ask you to read and accept the updated notice the next time you sign in.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact and data protection officer',
    body: <p>Questions, requests and complaints about personal data go to our data protection officer at {mail}.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Notice"
      other={{ href: '/terms', label: 'Terms of Use' }}
      summary={
        <>
          <p className="font-semibold">In short</p>
          <p className="mt-1">
            We collect what KITA+ needs to work: your contact details, your address in the township, and what you do in the app. Shops see only your first name and initial; sponsors see grouped
            totals only. We never sell your data or use it for advertising. You can download or delete your data at any time from your Account page.
          </p>
        </>
      }
      sections={sections}
    />
  );
}
