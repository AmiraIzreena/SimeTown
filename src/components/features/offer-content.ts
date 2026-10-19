import {
  Accessibility, Bike, Bot, DoorOpen, Droplets, Gauge, HandHeart, House, Megaphone, Recycle, Repeat2, Store, TriangleAlert, type LucideIcon,
} from 'lucide-react';

/** What SimeTown offers, by layer. Shared by the landing page, the "What we offer" page and the top bar's menu. */
export interface OfferGroup {
  id: 'people' | 'planet' | 'business';
  layer: string;
  question: string;
  items: { icon: LucideIcon; name: string; gloss: string; text: string }[];
}

export const STEPS = [
  { n: '1', title: 'Do', text: 'Recycle, cycle a loop, report a hazard, help a neighbour, or simply shop locally.' },
  { n: '2', title: 'Earn', text: 'Every verified action earns Impact XP. Points come only where a shop, a sponsor or SDP has paid for them.' },
  { n: '3', title: 'Spend', text: 'Use points for up to 30% of a bill at any township shop. You confirm on your own phone.' },
  { n: '4', title: 'Settle', text: 'The float pays the shop in full, every week. Nobody pays twice and no shop is out of pocket.' },
];

export const FEATURES: OfferGroup[] = [
  {
    id: 'people',
    layer: 'People',
    question: 'Safer, more connected, more inclusive living',
    items: [
      { icon: HandHeart, name: 'Jiran', gloss: 'Neighbours', text: 'Join township events. Ask for help or offer it.' },
      { icon: TriangleAlert, name: 'Lapor', gloss: 'Report', text: 'Report a hazard or a blocked ramp in under a minute and follow it until it is fixed.' },
      { icon: DoorOpen, name: 'Tamu', gloss: 'Visitors', text: 'Send a visitor pass by link. The guard scans it and you are told the moment they arrive.' },
      { icon: Bike, name: 'Gerak', gloss: 'Move', text: 'Track a walk or ride on the map; checkpoints tick themselves, with fair-play checks.' },
      { icon: Accessibility, name: 'Akses+', gloss: 'Access', text: 'Simple Mode, read-aloud, flashing alerts, step-free places and a priority help list.' },
    ],
  },
  {
    id: 'planet',
    layer: 'Planet',
    question: 'Making sustainable living easy and worth doing',
    items: [
      { icon: Recycle, name: 'SimeTown Recycle', gloss: 'Recycle', text: 'Each kiosk bin has a scale that weighs your items, sends the weight by itself and signs every record.' },
      { icon: Repeat2, name: 'Kongsi', gloss: 'Share', text: 'Give away or lend things instead of throwing them out.' },
      { icon: Droplets, name: 'Banjir', gloss: 'Flood', text: 'Sensors and camera AI, two signals must agree, a person checks the rest, and a safe route.' },
      { icon: Bot, name: 'SimeTown Assistant', gloss: 'Preview', text: 'Ask in English or Bahasa Malaysia. It acts only after you confirm, and never decides an alert.' },
    ],
  },
  {
    id: 'business',
    layer: 'Business',
    question: 'Tools for shops, sponsors and Sime Darby Property',
    items: [
      { icon: Store, name: 'SimeTown Merchant', gloss: 'Shops', text: 'Give and accept points, and set your own Shop Offer with a monthly budget you control.' },
      { icon: Megaphone, name: 'SimeTown Partner Hub', gloss: 'Sponsors', text: 'Three sponsor tiers, and challenges with a fixed budget. Unused reward money is refunded; fees are not.' },
      { icon: Gauge, name: 'SimeTown Insights', gloss: 'SDP', text: 'What the township achieved, in totals only, with the float matched to the sen.' },
      { icon: House, name: 'SimeTown Home', gloss: 'Preview', text: 'A home logbook, trusted home services with contractor passes, and early previews of launches.' },
    ],
  },
];
