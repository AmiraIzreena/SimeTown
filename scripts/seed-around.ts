import type { Actor } from '../src/server/auth/actor';
import { ACTOR_COLUMNS, toActor } from '../src/server/auth/session';
import { suggestReportByRules } from '../src/server/ai/classifier';
import { one, type Db } from '../src/server/db/client';
import { setMeToo, updateReport } from '../src/server/modules/reports/service';
import type { ReportCategory } from '../src/shared/domain';

/**
 * Enough community reports for Lapor issues to be tried at scale. Each first report starts an issue; other residents
 * then report the same problem in their own words (added to that issue) or say "Me too", so about twenty problems
 * reach the five residents that make them public and "Needs attention", across every type, while others stay below
 * it. Statuses cover new, in progress (some late), fixed and closed with no action; the public problems carry their
 * written English and Malay titles.
 *
 * The report rows are written directly, with the rule-based classifier's suggestion, so seeding never calls the
 * configured AI provider; status changes and Me too go through the app's own services. Safe to run again: a report
 * whose place is already in the township is skipped, so new entries here are added on the next run.
 */

const DOMAIN = 'demo.kita.test';
const DAY = 86_400_000;

type Status = 'NEW' | 'IN_PROGRESS' | 'RESOLVED' | 'REJECTED';
interface Seed {
  by: string;
  category: ReportCategory;
  description: string;
  place: string;
  zone: string;
  /** Days ago it was reported. */
  ago: number;
  status: Status;
  /** In progress: days from today to the fix date (negative is overdue). Fixed or closed: days ago it was. */
  when?: number;
  meToo?: string[];
}

const EV12 = 'Elmina Valley 1 & 2';
const EV345 = 'Elmina Valley 3, 4 & 5';
const EG = 'Elmina Gardens';
const EW = 'Elmina West';

const REPORTS: Seed[] = [
  // Potholes and road damage
  { by: 'priya', category: 'POTHOLE', description: 'Deep pothole in the left lane, cars swerve to avoid it.', place: 'Persiaran Elektron, outside Elmina Central Park car park', zone: EV345, ago: 2, status: 'NEW', meToo: ['daniel', 'hafiz', 'siti'] },
  { by: 'hafiz', category: 'POTHOLE', description: 'Road surface breaking up at the junction after the rain.', place: 'Jalan Metafasa U16/156 junction', zone: EV12, ago: 9, status: 'IN_PROGRESS', when: 3, meToo: ['aisyah'] },
  { by: 'arjun', category: 'POTHOLE', description: 'Cracked pavement slabs, a child tripped here yesterday.', place: 'Pavement along Persiaran Atmosfera, near the bus stop', zone: EG, ago: 14, status: 'IN_PROGRESS', when: -2, meToo: ['zainab', 'karyan'] },
  { by: 'zainab', category: 'POTHOLE', description: 'Speed bump paint gone and the bump is broken on one side.', place: 'Jalan Frekuensi U16/110, before the playground', zone: EG, ago: 4, status: 'NEW' },
  { by: 'siti', category: 'POTHOLE', description: 'Sunken manhole cover making a loud bang when cars pass.', place: 'Jalan Metafasa U16/1N, opposite No. 22', zone: EV345, ago: 20, status: 'RESOLVED', when: 12 },
  { by: 'meiling', category: 'POTHOLE', description: 'Potholes along the service road behind the shops.', place: 'Service road behind Elmina Lakeside shops', zone: EW, ago: 45, status: 'RESOLVED', when: 38 },

  // Lighting
  { by: 'karyan', category: 'LIGHTING', description: 'Three street lights out in a row, the stretch is completely dark.', place: 'Jalan Frekuensi U16/115, Nos. 30 to 44', zone: EG, ago: 3, status: 'IN_PROGRESS', when: 2, meToo: ['zainab', 'aisyah', 'daniel'] },
  { by: 'priya', category: 'LIGHTING', description: 'Lamp at the park entrance keeps flickering all night.', place: 'Elmina Central Park, main entrance', zone: EV345, ago: 1, status: 'NEW', meToo: ['siti'] },
  { by: 'hafiz', category: 'LIGHTING', description: 'Lights in the pedestrian underpass are not working.', place: 'Underpass to Persiaran Casuarina', zone: EW, ago: 11, status: 'IN_PROGRESS', when: -3, meToo: ['meiling'] },
  { by: 'siti', category: 'LIGHTING', description: 'Street light on during the day and off at night.', place: 'Jalan Metafasa U16/171, near the surau', zone: EV12, ago: 16, status: 'RESOLVED', when: 10 },
  { by: 'arjun', category: 'LIGHTING', description: 'Garden lights along the jogging track are broken.', place: 'Elmina Lakeside jogging track, north side', zone: EW, ago: 7, status: 'NEW' },

  // Blocked drains
  { by: 'meiling', category: 'DRAINAGE', description: 'Drain full of leaves, water floods the road after rain.', place: 'Jalan Metafasa U16/161, corner house', zone: EV12, ago: 5, status: 'IN_PROGRESS', when: 4, meToo: ['daniel', 'priya'] },
  { by: 'zainab', category: 'DRAINAGE', description: 'Stagnant water in the monsoon drain, mosquitoes breeding.', place: 'Monsoon drain behind Jalan Frekuensi U16/112', zone: EG, ago: 8, status: 'IN_PROGRESS', when: -1, meToo: ['karyan', 'aisyah'] },
  { by: 'daniel', category: 'DRAINAGE', description: 'Drain cover missing, open hole beside the walkway.', place: 'Walkway to SJK (T) Ladang Rasak', zone: EV345, ago: 2, status: 'NEW', meToo: ['siti', 'arjun'] },
  { by: 'karyan', category: 'DRAINAGE', description: 'Overflowing drain outside the clubhouse every evening.', place: 'Elmina Gardens clubhouse', zone: EG, ago: 6, status: 'NEW' },
  { by: 'priya', category: 'DRAINAGE', description: 'Silt blocking the culvert under the road.', place: 'Persiaran Metafasa culvert near Sungai Subang', zone: EV12, ago: 25, status: 'RESOLVED', when: 18 },
  { by: 'arjun', category: 'DRAINAGE', description: 'Drain behind the terrace houses smells badly.', place: 'Back lane behind Persiaran Casuarina terraces', zone: EW, ago: 60, status: 'RESOLVED', when: 50 },

  // Rubbish and dumping
  { by: 'siti', category: 'WASTE', description: 'Old mattress and sofa dumped on the road shoulder.', place: 'Empty lot beside Persiaran Elektron', zone: EV345, ago: 3, status: 'IN_PROGRESS', when: 1, meToo: ['priya'] },
  { by: 'hafiz', category: 'WASTE', description: 'Rubbish not collected for a week, bins overflowing.', place: 'Jalan Metafasa U16/171, bin centre', zone: EV12, ago: 2, status: 'NEW', meToo: ['daniel', 'aisyah', 'meiling'] },
  { by: 'zainab', category: 'WASTE', description: 'Garden waste piled up at the corner for days.', place: 'Jalan Frekuensi U16/110 corner', zone: EG, ago: 10, status: 'RESOLVED', when: 7 },
  { by: 'meiling', category: 'WASTE', description: 'Construction debris left on the grass verge.', place: 'Grass verge along Persiaran Casuarina', zone: EW, ago: 5, status: 'NEW' },

  // Access barriers
  { by: 'karyan', category: 'ACCESS_BARRIER', description: 'Cars parked on the ramp every morning, wheelchairs cannot pass.', place: 'Ramp at Elmina Gardens clubhouse', zone: EG, ago: 4, status: 'IN_PROGRESS', when: 5, meToo: ['zainab'] },
  { by: 'priya', category: 'ACCESS_BARRIER', description: 'Lift at the community hall out of order.', place: 'Elmina Valley community hall', zone: EV12, ago: 6, status: 'NEW', meToo: ['hafiz', 'aisyah'] },
  { by: 'daniel', category: 'ACCESS_BARRIER', description: 'Bollards too close together for a pram or wheelchair.', place: 'Path into Elmina Central Park from Persiaran Elektron', zone: EV345, ago: 12, status: 'REJECTED', when: 9 },
  { by: 'arjun', category: 'ACCESS_BARRIER', description: 'Kerb ramp broken, the edge is now a step.', place: 'Crossing at Persiaran Casuarina and Persiaran Elmina', zone: EW, ago: 18, status: 'RESOLVED', when: 11 },

  // Safety hazards
  { by: 'zainab', category: 'SAFETY', description: 'Large tree branch hanging over the road after the storm.', place: 'Jalan Frekuensi U16/115, outside No. 8', zone: EG, ago: 1, status: 'IN_PROGRESS', when: 1, meToo: ['karyan', 'daniel'] },
  { by: 'siti', category: 'SAFETY', description: 'Exposed electrical wires at the base of a lamp post.', place: 'Lamp post beside Elmina Central Park playground', zone: EV345, ago: 2, status: 'NEW', meToo: ['priya', 'hafiz'] },
  { by: 'meiling', category: 'SAFETY', description: 'Railing along the lake path is loose and leaning.', place: 'Elmina Lakeside, lake path railing', zone: EW, ago: 9, status: 'IN_PROGRESS', when: -4, meToo: ['arjun'] },
  { by: 'hafiz', category: 'SAFETY', description: 'Broken glass scattered across the futsal court.', place: 'Elmina Valley futsal court', zone: EV12, ago: 15, status: 'RESOLVED', when: 14 },

  // Something else
  { by: 'karyan', category: 'OTHER', description: 'Stray dogs gathering near the school gate in the morning.', place: 'SJK (T) Ladang Rasak, front gate', zone: EV345, ago: 3, status: 'NEW', meToo: ['siti'] },
  { by: 'priya', category: 'OTHER', description: 'Graffiti on the wall of the guardhouse.', place: 'Elmina Valley 1 guardhouse', zone: EV12, ago: 8, status: 'IN_PROGRESS', when: 6 },
  { by: 'arjun', category: 'OTHER', description: 'Bench in the park is broken and has sharp edges.', place: 'Elmina Lakeside, bench near the pier', zone: EW, ago: 22, status: 'RESOLVED', when: 15 },

  // More open ones, so every type has over three being handled.
  { by: 'zainab', category: 'ACCESS_BARRIER', description: 'Tactile paving tiles missing along the walkway.', place: 'Walkway along Persiaran Atmosfera', zone: EG, ago: 3, status: 'NEW', meToo: ['karyan'] },
  { by: 'siti', category: 'ACCESS_BARRIER', description: 'Gate to the park too narrow for a wheelchair.', place: 'Side gate to Elmina Central Park from Jalan Metafasa U16/1N', zone: EV345, ago: 7, status: 'IN_PROGRESS', when: 8, meToo: ['daniel'] },
  { by: 'priya', category: 'SAFETY', description: 'Open trench from roadworks left without barriers.', place: 'Jalan Metafasa U16/161, outside No. 3', zone: EV12, ago: 1, status: 'NEW', meToo: ['hafiz', 'aisyah'] },
  { by: 'arjun', category: 'SAFETY', description: 'Wasp nest under the shelter roof at the bus stop.', place: 'Bus stop on Persiaran Casuarina', zone: EW, ago: 2, status: 'IN_PROGRESS', when: 1 },
  { by: 'hafiz', category: 'WASTE', description: 'Recycling bins overflowing at the weekend.', place: 'Recycling corner at Elmina Valley community hall', zone: EV12, ago: 1, status: 'NEW', meToo: ['priya'] },
  { by: 'meiling', category: 'OTHER', description: 'Noise from a generator running all night at a construction site.', place: 'Construction site next to Persiaran Casuarina', zone: EW, ago: 2, status: 'NEW', meToo: ['arjun'] },
  { by: 'zainab', category: 'OTHER', description: 'Signboard to the clubhouse has fallen over.', place: 'Jalan Frekuensi U16/112, clubhouse signboard', zone: EG, ago: 5, status: 'IN_PROGRESS', when: 4 },
];

/**
 * More residents reporting the same problems in their own words, each added to the first report's issue (as a
 * resident does after "Yes, add my report"). `joins` is the first report's place.
 */
const JOINS: { joins: string; by: string; description: string; place: string; ago: number }[] = [
  { joins: 'Persiaran Elektron, outside Elmina Central Park car park', by: 'arjun', description: 'Big hole in the road near the park car park, nearly lost a tyre.', place: 'Persiaran Elektron near the park car park', ago: 1 },
  { joins: 'Jalan Metafasa U16/156 junction', by: 'meiling', description: 'Jalan rosak teruk di simpang, banyak lubang.', place: 'Simpang Jalan Metafasa U16/156', ago: 6 },
  { joins: 'Jalan Metafasa U16/156 junction', by: 'karyan', description: 'Road at the U16/156 junction is breaking apart.', place: 'Junction at Jalan Metafasa U16/156', ago: 5 },
  { joins: 'Pavement along Persiaran Atmosfera, near the bus stop', by: 'siti', description: 'Broken paving by the bus stop, my mother almost fell.', place: 'Bus stop on Persiaran Atmosfera', ago: 10 },
  { joins: 'Jalan Frekuensi U16/110, before the playground', by: 'karyan', description: 'Speed bump before the playground is cracked and the paint is gone.', place: 'Speed bump near the Jalan Frekuensi U16/110 playground', ago: 3 },
  { joins: 'Jalan Frekuensi U16/110, before the playground', by: 'aisyah', description: 'Bonggol jalan pecah sebelah, kereta laju di situ.', place: 'Bonggol depan taman permainan U16/110', ago: 2 },
  { joins: 'Jalan Frekuensi U16/115, Nos. 30 to 44', by: 'meiling', description: 'Whole row of street lights off on Jalan Frekuensi U16/115.', place: 'Jalan Frekuensi U16/115, middle stretch', ago: 2 },
  { joins: 'Elmina Central Park, main entrance', by: 'arjun', description: 'Flickering light at the Central Park entrance.', place: 'Central Park front entrance', ago: 1 },
  { joins: 'Elmina Central Park, main entrance', by: 'hafiz', description: 'Lampu di pintu masuk taman berkelip sepanjang malam.', place: 'Pintu masuk Elmina Central Park', ago: 0 },
  { joins: 'Underpass to Persiaran Casuarina', by: 'arjun', description: 'Underpass to Casuarina is pitch dark at night.', place: 'Casuarina pedestrian underpass', ago: 9 },
  { joins: 'Underpass to Persiaran Casuarina', by: 'priya', description: 'No lights in the underpass, feels unsafe walking home.', place: 'Underpass under Persiaran Casuarina', ago: 8 },
  { joins: 'Elmina Lakeside jogging track, north side', by: 'meiling', description: 'Track lights broken along the north side of the lake.', place: 'Lakeside jogging track, north stretch', ago: 5 },
  { joins: 'Elmina Lakeside jogging track, north side', by: 'siti', description: 'Lampu trek joging tepi tasik tidak menyala.', place: 'Trek joging Elmina Lakeside', ago: 4 },
  { joins: 'Jalan Metafasa U16/161, corner house', by: 'hafiz', description: 'Drain at the corner of U16/161 overflows every time it rains.', place: 'Corner of Jalan Metafasa U16/161', ago: 4 },
  { joins: 'Monsoon drain behind Jalan Frekuensi U16/112', by: 'arjun', description: 'Lots of mosquitoes from the stagnant monsoon drain.', place: 'Monsoon drain behind U16/112', ago: 6 },
  { joins: 'Walkway to SJK (T) Ladang Rasak', by: 'priya', description: 'Missing drain cover on the school walkway, children walk past it.', place: 'School walkway, SJK (T) Ladang Rasak', ago: 1 },
  { joins: 'Elmina Gardens clubhouse', by: 'zainab', description: 'Longkang depan kelab melimpah setiap petang.', place: 'Longkang depan kelab Elmina Gardens', ago: 5 },
  { joins: 'Elmina Gardens clubhouse', by: 'meiling', description: 'Drain outside the clubhouse is overflowing again.', place: 'Outside Elmina Gardens clubhouse', ago: 3 },
  { joins: 'Empty lot beside Persiaran Elektron', by: 'daniel', description: 'Someone dumped furniture on the empty lot by Persiaran Elektron.', place: 'Vacant lot on Persiaran Elektron', ago: 2 },
  { joins: 'Empty lot beside Persiaran Elektron', by: 'arjun', description: 'Old sofa and mattress dumped by the roadside.', place: 'Roadside lot, Persiaran Elektron', ago: 2 },
  { joins: 'Jalan Metafasa U16/171, bin centre', by: 'priya', description: 'Sampah tidak dikutip seminggu di pusat tong sampah.', place: 'Pusat tong sampah Jalan Metafasa U16/171', ago: 1 },
  { joins: 'Ramp at Elmina Gardens clubhouse', by: 'aisyah', description: 'Car parked on the clubhouse ramp again this morning.', place: 'Clubhouse wheelchair ramp, Elmina Gardens', ago: 3 },
  { joins: 'Ramp at Elmina Gardens clubhouse', by: 'meiling', description: 'Cannot get the pram up the clubhouse ramp because of parked cars.', place: 'Elmina Gardens clubhouse ramp', ago: 2 },
  { joins: 'Elmina Valley community hall', by: 'siti', description: 'Lif dewan komuniti rosak, warga emas susah naik.', place: 'Lif dewan komuniti Elmina Valley', ago: 4 },
  { joins: 'Jalan Frekuensi U16/115, outside No. 8', by: 'aisyah', description: 'Dahan besar hampir jatuh ke jalan selepas ribut.', place: 'Jalan Frekuensi U16/115, depan No. 8', ago: 1 },
  { joins: 'Lamp post beside Elmina Central Park playground', by: 'daniel', description: 'Wires sticking out of the lamp post next to the playground.', place: 'Playground lamp post, Central Park', ago: 1 },
  { joins: 'Lamp post beside Elmina Central Park playground', by: 'arjun', description: 'Exposed cables at the base of a lamp post where kids play.', place: 'Lamp post by the Central Park playground', ago: 1 },
  { joins: 'Elmina Lakeside, lake path railing', by: 'priya', description: 'The railing on the lake path is wobbly and leaning out.', place: 'Lake path railing, Elmina Lakeside', ago: 8 },
  { joins: 'Elmina Lakeside, lake path railing', by: 'karyan', description: 'Pagar tepi tasik longgar, bahaya untuk kanak-kanak.', place: 'Pagar laluan tasik Elmina Lakeside', ago: 7 },
  { joins: 'SJK (T) Ladang Rasak, front gate', by: 'priya', description: 'Stray dogs chasing children at the school gate.', place: 'Front gate of SJK (T) Ladang Rasak', ago: 2 },
  { joins: 'SJK (T) Ladang Rasak, front gate', by: 'daniel', description: 'Pack of stray dogs by the school entrance every morning.', place: 'School entrance, SJK (T) Ladang Rasak', ago: 2 },
  // Problems already fixed, which many had reported.
  { joins: 'Jalan Metafasa U16/1N, opposite No. 22', by: 'daniel', description: 'Manhole cover bangs loudly every time a car passes.', place: 'Manhole on Jalan Metafasa U16/1N', ago: 19 },
  { joins: 'Jalan Metafasa U16/1N, opposite No. 22', by: 'priya', description: 'Penutup lurang tenggelam, bunyi kuat.', place: 'Lurang di Jalan Metafasa U16/1N', ago: 19 },
  { joins: 'Jalan Metafasa U16/1N, opposite No. 22', by: 'hafiz', description: 'Sunken manhole cover on U16/1N.', place: 'Jalan Metafasa U16/1N manhole cover', ago: 18 },
  { joins: 'Jalan Metafasa U16/1N, opposite No. 22', by: 'arjun', description: 'The manhole on U16/1N is lower than the road.', place: 'U16/1N road, by No. 22', ago: 18 },
  { joins: 'Elmina Valley futsal court', by: 'meiling', description: 'Glass all over the futsal court.', place: 'Futsal court, Elmina Valley', ago: 15 },
  { joins: 'Elmina Valley futsal court', by: 'siti', description: 'Kaca pecah di gelanggang futsal.', place: 'Gelanggang futsal Elmina Valley', ago: 15 },
  { joins: 'Elmina Valley futsal court', by: 'karyan', description: 'Broken bottles on the court, someone could get cut.', place: 'Elmina Valley futsal court, near the net', ago: 14 },
  { joins: 'Elmina Valley futsal court', by: 'arjun', description: 'Shattered glass on the futsal court floor.', place: 'Futsal court by the community hall', ago: 14 },
];

/** More "Me too" on open problems (on the first report), so the public ones reach five residents. */
const EXTRA_ME_TOO: { place: string; logins: string[] }[] = [
  { place: 'Jalan Metafasa U16/156 junction', logins: ['priya'] },
  { place: 'Pavement along Persiaran Atmosfera, near the bus stop', logins: ['meiling'] },
  { place: 'Jalan Frekuensi U16/110, before the playground', logins: ['daniel', 'hafiz'] },
  { place: 'Elmina Central Park, main entrance', logins: ['zainab'] },
  { place: 'Underpass to Persiaran Casuarina', logins: ['daniel'] },
  { place: 'Elmina Lakeside jogging track, north side', logins: ['karyan', 'zainab'] },
  { place: 'Jalan Metafasa U16/161, corner house', logins: ['aisyah'] },
  { place: 'Monsoon drain behind Jalan Frekuensi U16/112', logins: ['siti'] },
  { place: 'Walkway to SJK (T) Ladang Rasak', logins: ['hafiz'] },
  { place: 'Elmina Gardens clubhouse', logins: ['aisyah', 'arjun'] },
  { place: 'Empty lot beside Persiaran Elektron', logins: ['hafiz'] },
  { place: 'Ramp at Elmina Gardens clubhouse', logins: ['arjun'] },
  { place: 'Elmina Valley community hall', logins: ['daniel'] },
  { place: 'Jalan Frekuensi U16/115, outside No. 8', logins: ['meiling'] },
  { place: 'Elmina Lakeside, lake path railing', logins: ['zainab'] },
  { place: 'SJK (T) Ladang Rasak, front gate', logins: ['hafiz'] },
];

/** The public wording, as the model writes it from an issue's reports (English and Malay), keyed by first place. */
const WORDING: Record<string, [string, string, string, string]> = {
  'Persiaran Elektron, outside Elmina Central Park car park': ['Deep pothole on Persiaran Elektron by the park car park', 'Lubang dalam di Persiaran Elektron dekat tempat letak kereta taman', 'A deep pothole in the left lane makes cars swerve near the Central Park car park.', 'Lubang dalam di lorong kiri menyebabkan kereta mengelak berhampiran tempat letak kereta Central Park.'],
  'Jalan Metafasa U16/156 junction': ['Road breaking up at the Jalan Metafasa U16/156 junction', 'Jalan rosak di simpang Jalan Metafasa U16/156', 'The road surface at the junction is breaking up into potholes after the rain.', 'Permukaan jalan di simpang pecah dan berlubang selepas hujan.'],
  'Pavement along Persiaran Atmosfera, near the bus stop': ['Broken paving at the Persiaran Atmosfera bus stop', 'Laluan pejalan kaki rosak di perhentian bas Persiaran Atmosfera', 'Cracked paving slabs by the bus stop are a tripping hazard.', 'Papak laluan yang retak di perhentian bas boleh menyebabkan orang tersadung.'],
  'Jalan Frekuensi U16/110, before the playground': ['Broken speed bump before the U16/110 playground', 'Bonggol jalan rosak sebelum taman permainan U16/110', 'The speed bump before the playground is cracked and its paint has worn off.', 'Bonggol jalan sebelum taman permainan retak dan catnya telah pudar.'],
  'Jalan Frekuensi U16/115, Nos. 30 to 44': ['Street lights out along Jalan Frekuensi U16/115', 'Lampu jalan padam di sepanjang Jalan Frekuensi U16/115', 'A row of street lights is out, leaving the stretch from No. 30 to 44 dark.', 'Sederet lampu jalan padam dan kawasan dari No. 30 hingga 44 gelap.'],
  'Elmina Central Park, main entrance': ['Flickering light at the Central Park entrance', 'Lampu berkelip di pintu masuk Central Park', 'The lamp at the main park entrance flickers through the night.', 'Lampu di pintu masuk utama taman berkelip sepanjang malam.'],
  'Underpass to Persiaran Casuarina': ['No lights in the Persiaran Casuarina underpass', 'Tiada lampu di laluan bawah tanah Persiaran Casuarina', 'The pedestrian underpass is dark at night and feels unsafe.', 'Laluan pejalan kaki bawah tanah gelap pada waktu malam dan terasa tidak selamat.'],
  'Elmina Lakeside jogging track, north side': ['Track lights out on the Lakeside jogging path', 'Lampu trek padam di laluan joging Lakeside', 'Garden lights along the north side of the jogging track are not working.', 'Lampu taman di sebelah utara trek joging tidak berfungsi.'],
  'Jalan Metafasa U16/161, corner house': ['Overflowing drain at the corner of Jalan Metafasa U16/161', 'Longkang melimpah di selekoh Jalan Metafasa U16/161', 'The drain is full of leaves and floods the road whenever it rains.', 'Longkang penuh daun dan membanjiri jalan setiap kali hujan.'],
  'Monsoon drain behind Jalan Frekuensi U16/112': ['Stagnant monsoon drain behind Jalan Frekuensi U16/112', 'Longkang monsun bertakung di belakang Jalan Frekuensi U16/112', 'Standing water in the monsoon drain is breeding mosquitoes.', 'Air bertakung di longkang monsun menjadi tempat pembiakan nyamuk.'],
  'Walkway to SJK (T) Ladang Rasak': ['Missing drain cover on the school walkway', 'Penutup longkang hilang di laluan ke sekolah', 'An open drain beside the walkway to SJK (T) Ladang Rasak, used by children.', 'Longkang terbuka di tepi laluan ke SJK (T) Ladang Rasak yang digunakan kanak-kanak.'],
  'Elmina Gardens clubhouse': ['Drain overflowing outside the Elmina Gardens clubhouse', 'Longkang melimpah di luar kelab Elmina Gardens', 'The drain outside the clubhouse overflows most evenings.', 'Longkang di luar kelab melimpah hampir setiap petang.'],
  'Empty lot beside Persiaran Elektron': ['Furniture dumped on the lot by Persiaran Elektron', 'Perabot dibuang di tanah kosong tepi Persiaran Elektron', 'An old mattress and sofa have been dumped on the road shoulder.', 'Tilam dan sofa lama dibuang di bahu jalan.'],
  'Jalan Metafasa U16/171, bin centre': ['Rubbish not collected at the U16/171 bin centre', 'Sampah tidak dikutip di pusat tong U16/171', 'Bins have overflowed after a week without collection.', 'Tong sampah melimpah selepas seminggu tidak dikutip.'],
  'Ramp at Elmina Gardens clubhouse': ['Cars blocking the Elmina Gardens clubhouse ramp', 'Kereta menghalang tanjakan kelab Elmina Gardens', 'Cars parked on the ramp each morning stop wheelchairs and prams getting through.', 'Kereta yang diletakkan di tanjakan setiap pagi menghalang kerusi roda dan kereta sorong.'],
  'Elmina Valley community hall': ['Lift out of order at the Elmina Valley community hall', 'Lif rosak di dewan komuniti Elmina Valley', 'The hall lift is not working, which is hard for older residents.', 'Lif dewan tidak berfungsi dan menyukarkan warga emas.'],
  'Jalan Frekuensi U16/115, outside No. 8': ['Branch hanging over Jalan Frekuensi U16/115', 'Dahan tergantung di atas Jalan Frekuensi U16/115', 'A large branch is hanging over the road after the storm.', 'Dahan besar tergantung di atas jalan selepas ribut.'],
  'Lamp post beside Elmina Central Park playground': ['Exposed wires at a Central Park playground lamp post', 'Wayar terdedah di tiang lampu taman permainan Central Park', 'Electrical wires are exposed at the base of a lamp post where children play.', 'Wayar elektrik terdedah di pangkal tiang lampu tempat kanak-kanak bermain.'],
  'Elmina Lakeside, lake path railing': ['Loose railing on the Elmina Lakeside path', 'Pagar longgar di laluan Elmina Lakeside', 'The railing along the lake path is loose and leaning outwards.', 'Pagar di sepanjang laluan tasik longgar dan condong ke luar.'],
  'SJK (T) Ladang Rasak, front gate': ['Stray dogs at the SJK (T) Ladang Rasak gate', 'Anjing liar di pintu pagar SJK (T) Ladang Rasak', 'A pack of stray dogs gathers at the school gate in the mornings.', 'Sekumpulan anjing liar berkumpul di pintu pagar sekolah pada waktu pagi.'],
  'Jalan Metafasa U16/1N, opposite No. 22': ['Sunken manhole cover on Jalan Metafasa U16/1N', 'Penutup lurang tenggelam di Jalan Metafasa U16/1N', 'A sunken manhole cover banged loudly whenever cars passed.', 'Penutup lurang yang tenggelam berbunyi kuat setiap kali kereta lalu.'],
  'Elmina Valley futsal court': ['Broken glass on the Elmina Valley futsal court', 'Kaca pecah di gelanggang futsal Elmina Valley', 'Broken glass was scattered across the futsal court.', 'Kaca pecah bertaburan di gelanggang futsal.'],
};

const NOTES: Record<Status, string> = {
  NEW: '',
  IN_PROGRESS: 'Passed to the contractor; the fix is booked.',
  RESOLVED: 'Fixed by the township contractor.',
  REJECTED: 'This is outside the township office’s control; referred to the local council.',
};

async function actorByLogin(db: Db, login: string): Promise<Actor | undefined> {
  const row = await one<Parameters<typeof toActor>[0]>(db, `SELECT ${ACTOR_COLUMNS} FROM users u WHERE lower(u.email) = lower($1)`, [`${login}@${DOMAIN}`]);
  return row ? toActor(row) : undefined;
}

export async function seedAroundReports(db: Db, input: { now: Date; log: (line: string) => void }) {
  const { now, log } = input;
  const logins = [...new Set(['staff', ...REPORTS.flatMap((r) => [r.by, ...(r.meToo ?? [])]), ...JOINS.map((j) => j.by), ...EXTRA_ME_TOO.flatMap((m) => m.logins)])];
  const people = new Map<string, Actor>();
  for (const login of logins) {
    const actor = await actorByLogin(db, login);
    if (!actor) return log(`Around the township: demo account ${login} missing; skipped.`);
    people.set(login, actor);
  }
  const staff = people.get('staff')!;
  const zones = new Map((await db.query<{ id: string; name: string }>('SELECT id, name FROM flood_zones WHERE township_id = $1', [staff.townshipId])).map((z) => [z.name, z.id]));
  const at = (days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * 3_600_000);
  const day = (offset: number) => new Date(now.getTime() + offset * DAY).toISOString().slice(0, 10);

  let added = 0;
  for (const [i, r] of REPORTS.entries()) {
    if (await one(db, 'SELECT 1 FROM reports WHERE township_id = $1 AND location_text = $2', [staff.townshipId, r.place])) continue;
    added += 1;
    const reporter = people.get(r.by)!;
    const created = at(r.ago, (i * 5) % 11);
    const rules = suggestReportByRules(r.description);
    const urgency = r.category === 'SAFETY' ? 'URGENT' : rules.urgency;
    // Each first report starts its own issue.
    const issue = (await one<{ id: string }>(
      db,
      'INSERT INTO report_issues (township_id, category, zone_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $4) RETURNING id',
      [reporter.townshipId, r.category, zones.get(r.zone) ?? null, created],
    ))!;
    const row = (await one<{ id: string }>(
      db,
      `INSERT INTO reports (township_id, reporter_id, zone_id, category, urgency, ai_category, ai_urgency, ai_source, description, location_text, issue_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'RULES', $8, $9, $10, $11, $11) RETURNING id`,
      [reporter.townshipId, reporter.id, zones.get(r.zone) ?? null, r.category, urgency, rules.category, rules.urgency, r.description, r.place, issue.id, created],
    ))!;
    // Neighbours join in while the report is still open, then the township office acts on it.
    for (const [n, login] of (r.meToo ?? []).entries()) await setMeToo(db, people.get(login)!, row.id, true, at(Math.max(r.ago - 1 - n, 0), 1));
    if (r.status === 'IN_PROGRESS') {
      await updateReport(db, staff, row.id, { status: 'IN_PROGRESS', staffNote: NOTES.IN_PROGRESS, assignedTo: 'Township contractor', targetDate: day(r.when ?? 3) }, at(Math.max(r.ago - 1, 0)));
    } else if (r.status === 'RESOLVED' || r.status === 'REJECTED') {
      await updateReport(db, staff, row.id, { status: r.status, staffNote: NOTES[r.status] }, at(r.when ?? 0));
    }
  }
  // Residents who wrote about the same problem, added to its issue with its progress so far.
  let joined = 0;
  for (const j of JOINS) {
    if (await one(db, 'SELECT 1 FROM reports WHERE township_id = $1 AND location_text = $2', [staff.townshipId, j.place])) continue;
    const first = await one<{ issue_id: string }>(db, 'SELECT issue_id FROM reports WHERE township_id = $1 AND location_text = $2', [staff.townshipId, j.joins]);
    if (!first) continue;
    joined += 1;
    const reporter = people.get(j.by)!;
    const rules = suggestReportByRules(j.description);
    await db.query(
      `INSERT INTO reports (township_id, reporter_id, zone_id, category, urgency, ai_category, ai_urgency, ai_source, description, location_text, issue_id,
                            status, staff_note, assigned_to, assigned_at, target_date, checked_at, resolved_at, created_at, updated_at)
       SELECT f.township_id, $2, r.zone_id, r.category, CASE WHEN r.category = 'SAFETY' THEN 'URGENT' ELSE $3 END, $4, $3, 'RULES', $5, $6, f.issue_id,
              r.status, r.staff_note, r.assigned_to, r.assigned_at, r.target_date, r.checked_at,
              CASE WHEN r.resolved_at IS NULL THEN NULL ELSE greatest(r.resolved_at, $7::timestamptz) END, $7::timestamptz, $7::timestamptz
         FROM (SELECT $1::uuid AS issue_id, township_id FROM report_issues WHERE id = $1) f
         JOIN reports r ON r.id = (SELECT first_report_id FROM report_issue_facts WHERE id = $1)`,
      [first.issue_id, reporter.id, rules.urgency, rules.category, j.description, j.place, at(j.ago, 3)],
    );
  }
  for (const m of EXTRA_ME_TOO) {
    const first = await one<{ id: string; reporter_id: string; status: string }>(db, 'SELECT id, reporter_id, status FROM reports WHERE township_id = $1 AND location_text = $2', [staff.townshipId, m.place]);
    if (!first || !['NEW', 'IN_PROGRESS'].includes(first.status)) continue;
    for (const login of m.logins) if (people.get(login)!.id !== first.reporter_id) await setMeToo(db, people.get(login)!, first.id, true, at(0, 6));
  }
  // The written public wording; an issue that already has a title (written or corrected by staff) keeps it.
  for (const [place, [title, titleMs, summary, summaryMs]] of Object.entries(WORDING)) {
    await db.query(
      `UPDATE report_issues SET title = $3, title_ms = $4, summary = $5, summary_ms = $6, title_source = 'MODEL'
        WHERE title IS NULL AND id = (SELECT issue_id FROM reports WHERE township_id = $1 AND location_text = $2)`,
      [staff.townshipId, place, title, titleMs, summary, summaryMs],
    );
  }
  log(added || joined ? `Around the township: ${added} new problems and ${joined} more residents' reports grouped into them.` : 'Around the township: demo reports already there.');
}
