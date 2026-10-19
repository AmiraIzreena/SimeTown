/**
 * What SimeTown Assistant knows about City of Elmina, Sime Darby Property and
 * local services. Every entry was checked against the sources listed with it
 * on the date shown; anything the sources disagree on, or that changes often,
 * says so and points to the official channel. The Assistant answers from these
 * entries only: it is told never to add facts of its own.
 *
 * To update: change the text, the sources and `checked` together.
 */

export interface KnowledgeSource {
  title: string;
  url: string;
}

export interface KnowledgeEntry {
  id: string;
  title: string;
  /** Words people use when asking, in English and Bahasa Malaysia. */
  keywords: string[];
  /** Phrases that mean the question is about something else, such as "park a car" for the park. */
  notWhen?: string[];
  /** One or two sentences: the answer when there is no AI. */
  short: string;
  /** The full checked text, for the AI. */
  details: string;
  /** Where in the app this continues, if anywhere. */
  appLink?: { href: string; label: string };
  sources: KnowledgeSource[];
  /** The date the sources were last checked (YYYY-MM-DD). */
  checked: string;
}

const CHECKED = '2026-10-14';

export const KNOWLEDGE: KnowledgeEntry[] = [
  {
    id: 'elmina-overview',
    title: 'City of Elmina at a glance',
    keywords: ['elmina', 'city of elmina', 'township', 'bandar', 'perbandaran', 'about', 'tentang', 'size', 'acres', 'ekar', 'where', 'mana', 'shah alam', 'sime darby', 'developer', 'pemaju'],
    short:
      'City of Elmina is Sime Darby Property’s township in Shah Alam, Selangor, along the Guthrie Corridor Expressway. It is reported as about 6,500 acres across Elmina East, Elmina West, Denai Alam, Bukit Subang and Elmina Business Park, with a 300-acre Central Park.',
    details:
      'City of Elmina is a township by Sime Darby Property in Shah Alam, Selangor, on the Guthrie Corridor. Reported component areas: Elmina East about 1,088 acres, Elmina West about 2,662 acres, Denai Alam about 1,000 acres, Bukit Subang about 250 acres (the earliest part, from 2000) and Elmina Business Park about 1,500 acres. The total is usually given as about 6,500 acres, but some Sime Darby Property pages say 5,000 acres, so the figure depends on the date and what is counted. It has a 300-acre Central Park and about 1,118 acres of parkland, next to the Bukit Cherakah (also called Subang) forest reserve. The homes are in Shah Alam sections such as U15, U16 and U17, and the local council is Majlis Bandaraya Shah Alam (MBSA).',
    sources: [
      { title: 'EdgeProp: The City of Elmina, a sustainable integrated township', url: 'https://www.edgeprop.my/content/1912815/city-elmina%E2%80%94-sustainable-integrated-township' },
      { title: 'Sime Darby Property: City of Elmina', url: 'https://www.simedarbyproperty.com/commercial/city-of-elmina' },
    ],
    checked: CHECKED,
  },
  {
    id: 'precincts',
    title: 'Neighbourhoods (precincts) in City of Elmina',
    keywords: ['precinct', 'presint', 'neighbourhood', 'kawasan', 'phase', 'fasa', 'elmina valley', 'elmina gardens', 'elmina green', 'elmina ridge', 'harmoni', 'clusia', 'viana', 'liana', 'ariza', 'garinia', 'keana', 'cressida', 'reesia', 'hevea', 'regia', 'the nine'],
    short:
      'The main home precincts are Elmina Valley (phases 1 to 5) and Elmina Gardens in Elmina East, and Elmina Green and Elmina Ridge in Elmina West. Harmoni @ City of Elmina is the Rumah Selangorku affordable apartment project.',
    details:
      'Elmina East (Shah Alam section U16, postcode 40160) holds Elmina Valley, built in phases 1 to 5 from 2016, and Elmina Gardens, whose sub-precincts include Ariza, Clusia, Liana, Viana, Garinia, Keana, Cressida, Regia, Hevea and Reesia (Reesia advertises its own small community garden). Elmina West holds Elmina Green (launched in phases from 2017, including The Nine) and Elmina Ridge, a low-density precinct next to the Bukit Cherakah Forest Reserve launched in May 2024. Harmoni @ City of Elmina is a Sime Darby Property Rumah Selangorku affordable apartment project of three blocks in Elmina West. Some Valley 4 and 5 streets are in section U15, where listings disagree on the postcode.',
    sources: [
      { title: 'PropertyGuru: City of Elmina review', url: 'https://www.propertyguru.com.my/new-property-launch/reviews/city-of-elmina-shah-alam-216064' },
      { title: 'Sime Darby Property: Elmina Green launch', url: 'https://www.simedarbyproperty.com/press-releases/sime-darby-property-launches-elmina-green' },
      { title: 'Sime Darby Property: Elmina Ridge 1 launch', url: 'https://www.simedarbyproperty.com/press-releases/sime-darby-propertys-elmina-ridge-1-sees-spectacular-demand-upon-its-official-launch' },
      { title: 'EdgeProp: Harmoni @ City of Elmina', url: 'https://www.edgeprop.my/project/harmoni-city-of-elmina-rumah-selangorku--10185' },
    ],
    checked: CHECKED,
  },
  {
    id: 'homes-for-sale',
    title: 'Homes Sime Darby Property is selling in Elmina',
    keywords: ['sale', 'selling', 'sell', 'buy', 'beli', 'jual', 'dijual', 'new launch', 'pelancaran', 'launch', 'house', 'home', 'rumah', 'property', 'hartanah', 'price', 'harga', 'available', 'unit', 'booking', 'tempah rumah'],
    short:
      'What is on sale changes often, so ask Sime Darby Property for current launches and prices: City of Elmina sales gallery, No. 5 Persiaran Garcinia, Elmina West, tel +603-7849 5700, or toll-free 1-800-88-1118.',
    details:
      'Launches and prices change often and are not listed here, so never quote a price or say a unit is available. Recent news, for context only: The Nine at Elmina Green sold out its latest phase of link homes on its launch day (May 2025). Elmina Ridge Stage 1 sold out after its May 2024 launch, and a second phase was planned for the second quarter of 2025 (not confirmed). In 2026 Sime Darby Property’s new launches around Elmina were industrial (Elmina Business Park 2). For current homes, prices and availability: the City of Elmina page on simedarbyproperty.com, or the sales gallery at No. 5 Persiaran Garcinia, Elmina West (tel +603-7849 5700; toll-free 1-800-88-1118, Monday to Friday 8.30am to 5.30pm).',
    sources: [
      { title: 'Sime Darby Property: City of Elmina', url: 'https://www.simedarbyproperty.com/city-of-elmina/' },
      { title: 'NST: New link homes in City of Elmina sold out on launch day (May 2025)', url: 'https://www.nst.com.my/property/2025/05/1218382/sime-darby-propertys-new-link-homes-city-elmina-sold-out-launch-day' },
      { title: 'Sime Darby Property: Elmina Ridge 1 launch', url: 'https://www.simedarbyproperty.com/press-releases/sime-darby-propertys-elmina-ridge-1-sees-spectacular-demand-upon-its-official-launch' },
      { title: 'Sime Darby Property: Elmina Business Park 2', url: 'https://www.simedarbyproperty.com/press-releases/sime-darby-property-widens-industrial-footprint-elmina-business-park-2' },
    ],
    checked: CHECKED,
  },
  {
    id: 'sales-gallery',
    title: 'Contacting Sime Darby Property',
    keywords: ['contact', 'hubungi', 'phone', 'telefon', 'call', 'sales gallery', 'galeri jualan', 'office', 'pejabat', 'hotline', 'sime darby', 'developer', 'pemaju', 'opening hours', 'waktu operasi', 'defect', 'kecacatan'],
    short:
      'Sime Darby Property’s City of Elmina sales gallery is at No. 5 Persiaran Garcinia, Elmina West (tel +603-7849 5700). The toll-free line is 1-800-88-1118, Monday to Friday, 8.30am to 5.30pm. Please call to confirm the gallery’s opening hours.',
    details:
      'City of Elmina sales gallery: No. 5, Persiaran Garcinia, Elmina West, Shah Alam; tel +603-7849 5700. Sime Darby Property’s pages disagree on its hours (9.30am to 9pm on the City of Elmina page, 9.30am to 6pm on the contact page), so say to call and confirm. Toll-free customer line: 1-800-88-1118, Monday to Friday, 8.30am to 5.30pm, except public holidays. Older listings show the Elmina Pavilion on Persiaran Eserina as a gallery; it may no longer be in use.',
    sources: [
      { title: 'Sime Darby Property: City of Elmina', url: 'https://www.simedarbyproperty.com/city-of-elmina/' },
      { title: 'Sime Darby Property: Contact us', url: 'https://www.simedarbyproperty.com/contact-us' },
    ],
    checked: CHECKED,
  },
  {
    id: 'central-park',
    title: 'Elmina Central Park',
    notWhen: ['parking', 'park a', 'park my', 'park the', 'park his', 'park her', 'park our', 'park car', 'car park', 'letak kereta', 'parkir', 'tempat letak'],
    keywords: ['park', 'taman', 'central park', 'jogging', 'running', 'lari', 'cycling', 'basikal', 'bicycle', 'walk', 'jalan kaki', 'track', 'trek', 'riadah', 'playground', 'taman permainan', 'river', 'sungai subang'],
    short:
      'Elmina Central Park is a 300-acre park of six themed parks with jogging and cycling tracks along Sungai Subang. The Gerak map in this app shows walking and cycling loops there.',
    details:
      'Elmina Central Park covers 300 acres made up of six themed parks, with jogging and cycling tracks along Sungai Subang, a fitness station and playgrounds. It is open to the public; drive in by the West Elmina exit, with parking along the park. The Elmina Rainforest Knowledge Centre and the Elmina Community Edible Gardens are inside it, and the Elmina Outdoor Sculpture Museum is part of the wider park beside Elmina Lakeside Mall. The SimeTown Gerak map shows mapped loops such as Eco Lake, the Elmina Valley Central Park lake and the riverside ride.',
    appLink: { href: '/app/gerak', label: 'Open the Gerak map' },
    sources: [
      { title: 'Selangor Tourism: Elmina Central Park', url: 'https://selangor.travel/listing/elmina-central-park/' },
      { title: 'StarProperty: Sime Darby Property fuses art, nature and sustainability', url: 'https://www.starproperty.my/news/sime-darby-property-fuses-art-nature-and-sustainability/130085' },
    ],
    checked: CHECKED,
  },
  {
    id: 'rainforest-centre',
    title: 'Elmina Rainforest Knowledge Centre',
    keywords: ['rainforest', 'hutan', 'knowledge centre', 'erkc', 'nursery', 'tapak semaian', 'trees', 'pokok', 'nature', 'alam', 'trcrc', 'biodiversity'],
    short:
      'The Elmina Rainforest Knowledge Centre is a 1.09-acre centre inside Elmina Central Park, run with the Tropical Rainforest Conservation and Research Centre (TRCRC), with a 10-acre nursery next to it.',
    details:
      'The Elmina Rainforest Knowledge Centre (ERKC) covers 1.09 acres inside Elmina Central Park. Sime Darby Property developed it with the Tropical Rainforest Conservation and Research Centre (TRCRC) from 2019, with an adjoining 10-acre nursery for native rainforest trees. It opened in October 2020 and was officially launched in May 2022, when it had nurtured 187 plant species. Visiting hours are not listed here: suggest contacting Sime Darby Property.',
    sources: [{ title: 'Sime Darby Property: official launch of Elmina Rainforest Knowledge Centre', url: 'https://www.simedarbyproperty.com/press-releases/sime-darby-property-pushes-ahead-biodiversity-agenda-official-launch-elmina' }],
    checked: CHECKED,
  },
  {
    id: 'edible-gardens',
    title: 'Elmina Community Edible Gardens',
    keywords: ['garden', 'kebun', 'edible garden', 'kebun komuniti', 'plot', 'plant', 'tanam', 'farming', 'berkebun', 'allotment', 'ballot', 'undian'],
    short:
      'The Elmina Community Edible Gardens opened in January 2019 in Elmina Central Park, Elmina West, with over 100 plots given to residents by ballot. In this app, Taman lets you join the waiting list.',
    details:
      'Sime Darby Property opened the Elmina Community Edible Gardens in January 2019 at Elmina Central Park in Elmina West, with support from Majlis Bandaraya Shah Alam (MBSA). It has over 100 plots of 2 m by 1 m up to 6.5 m by 1 m, allotted to residents by ballot. Whether it still runs and how to apply today are not confirmed: suggest contacting Sime Darby Property. In SimeTown, Taman shows a demo version where residents join a waiting list and staff run the ballot.',
    appLink: { href: '/app/taman', label: 'Open Taman' },
    sources: [{ title: 'Sime Darby Property: City of Elmina’s first community edible gardens', url: 'https://www.simedarbyproperty.com/press-releases/sime-darby-property-launches-city-elminas-first-community-edible-gardens' }],
    checked: CHECKED,
  },
  {
    id: 'lakeside-mall',
    title: 'Elmina Lakeside Mall',
    keywords: ['mall', 'shopping', 'beli-belah', 'pusat beli-belah', 'lakeside', 'jaya grocer', 'harvey norman', 'grocery', 'barang dapur', 'eat', 'makan', 'restaurant', 'restoran', 'cafe', 'kedai'],
    short:
      'Elmina Lakeside Mall is on Persiaran Garcinia, Elmina West, by Eco Lake. It opened in August 2024 and was officially launched in January 2025; Jaya Grocer and Harvey Norman are its anchor tenants.',
    details:
      'Elmina Lakeside Mall, owned by Sime Darby Property, is on Persiaran Garcinia, Elmina West, beside Eco Lake and Elmina Urban Park. It had a soft opening on 22 August 2024 and was officially launched by the Sultan of Selangor on 11 January 2025. Anchor tenants are Jaya Grocer and Harvey Norman; others reported include Kenny Hills Bakers, Nak Nak and Ediya Coffee. It has about 200,000 sq ft of lettable space. Opening hours are not listed here.',
    sources: [
      { title: 'Sime Darby Property: Elmina Lakeside Mall now open', url: 'https://www.simedarbyproperty.com/press-releases/elmina-lakeside-mall-now-open-nature-inspired-lifestyle-community-hub-sime-darby' },
      { title: 'EdgeProp: Sultan of Selangor launches Elmina Lakeside Mall and museum', url: 'https://www.edgeprop.my/content/1911542/sultan-selangor-launches-elmina-lakeside-mall-and-museum' },
    ],
    checked: CHECKED,
  },
  {
    id: 'sculpture-museum',
    title: 'Elmina Outdoor Sculpture Museum',
    keywords: ['sculpture', 'arca', 'museum', 'muzium', 'art', 'seni', 'outdoor museum'],
    short:
      'The Elmina Outdoor Sculpture Museum, launched with Elmina Lakeside Mall in January 2025, shows sculptures by Malaysian and regional artists in the park beside the mall.',
    details:
      'The Elmina Outdoor Sculpture Museum was launched by the Sultan of Selangor together with Elmina Lakeside Mall in January 2025. Sime Darby Property describes it as Malaysia’s first outdoor sculpture museum, showing contemporary sculpture by Malaysian, regional and international artists within the parkland by the mall. Admission and opening hours are not confirmed here.',
    sources: [
      { title: 'RTM: Sultan of Selangor graces two new landmarks in Bandar Elmina', url: 'https://berita.rtm.gov.my/highlights/senarai-berita-highlights/senarai-artikel/sultan-of-selangor-graces-two-new-landmarks-in-bandar-elmina/' },
      { title: 'StarProperty: Sime Darby Property fuses art, nature and sustainability', url: 'https://www.starproperty.my/news/sime-darby-property-fuses-art-nature-and-sustainability/130085' },
    ],
    checked: CHECKED,
  },
  {
    id: 'waste-collection',
    title: 'Rubbish collection',
    keywords: ['rubbish', 'sampah', 'garbage', 'trash', 'waste', 'sisa', 'collection', 'kutipan', 'kutip', 'bin', 'tong', 'bulky', 'pukal', 'kdeb', 'separation', 'pengasingan'],
    short:
      'Household rubbish in Shah Alam is collected for MBSA by KDEB Waste Management. Landed homes usually get three collections a week and high-rise homes daily; MBSA’s page has the schedule for your area, or call MBSA on 03-5510 5133.',
    details:
      'Domestic waste in the Majlis Bandaraya Shah Alam (MBSA) area, which includes City of Elmina, is collected by KDEB Waste Management. MBSA’s guide: terrace, bungalow and semi-detached homes three days a week on a set combination (for example Tuesday, Thursday and Friday, or Monday, Friday and Saturday), high-rise homes every day. The exact days for a street are in the schedule on MBSA’s domestic waste page; do not guess them. MBSA’s line is 03-5510 5133. Bulky waste is handled separately, with Roll-On Roll-Off bins placed around Shah Alam. MBSA asks residents to separate waste.',
    appLink: { href: '/app/kitar', label: 'Open Kitar' },
    sources: [
      { title: 'MBSA: Kutipan sampah domestik (KDEB)', url: 'https://www.mbsa.gov.my/ms-my/mbsa/perkhidmatan/perkhidmatanperbandaran/Halaman/kutipan_sampah_domestik.aspx' },
      { title: 'KDEBWM: Roll-on roll-off bins for bulky waste around MBSA', url: 'https://www.kdebwm.com/media-room/articles/kdebwm-sedia-tong-roro-kutip-sampah-pukal-di-384-k/' },
    ],
    checked: CHECKED,
  },
  {
    id: 'emergency',
    title: 'Emergencies',
    keywords: ['emergency', 'kecemasan', '999', '112', 'police', 'polis', 'ambulance', 'ambulans', 'fire', 'api', 'kebakaran', 'bomba', 'accident', 'kemalangan', 'help', 'tolong', 'bahaya', 'danger'],
    short: 'In any emergency call 999 (police, ambulance, fire and rescue, civil defence). Do that before anything else.',
    details:
      'Malaysia’s emergency number is 999 (MERS 999), which covers the police, ambulance, the Fire and Rescue Department (Bomba) and Civil Defence; the older 991 and 994 numbers were merged into it in 2007. Calls to 112 from a mobile are redirected to 999, but may need an active SIM. In any danger, tell the person to call 999 first. For a flood, the township’s official status is in Banjir in this app.',
    appLink: { href: '/app/banjir', label: 'Open Banjir' },
    sources: [{ title: 'Civil Defence (APM): 999 emergency services', url: 'https://www.civildefence.gov.my/999-emergency-services/?lang=en' }],
    checked: CHECKED,
  },
  {
    id: 'mbsa',
    title: 'Shah Alam City Council (MBSA)',
    keywords: ['mbsa', 'majlis bandaraya', 'council', 'majlis', 'pbt', 'complaint', 'aduan', 'pothole', 'lubang', 'street light', 'lampu jalan', 'drain', 'longkang', 'grass', 'rumput', 'assessment', 'cukai taksiran'],
    short:
      'City of Elmina is under Majlis Bandaraya Shah Alam (MBSA). Its line is 03-5510 5133 and complaints can go to aduan.mbsa.gov.my or the Respons Rakyat app. In SimeTown, Lapor sends a report to the township team.',
    details:
      'The local authority for City of Elmina is Majlis Bandaraya Shah Alam (MBSA). Its main line is 03-5510 5133; complaints can be made at aduan.mbsa.gov.my, through the council’s app or the Respons Rakyat app. Integrity complaints about MBSA staff go to aduanintegriti@mbsa.gov.my. Inside SimeTown, Lapor sends a report with a photo to the township team, who track it to a fix.',
    appLink: { href: '/app/lapor', label: 'Report a problem' },
    sources: [
      { title: 'The Star: How to report potholes (May 2023)', url: 'https://thestar.com.my/metro/metro-news/2023/05/12/how-to-reportpotholes' },
      { title: 'Siakap Keli (Bernama): MBSA integrity complaints channel (Aug 2025)', url: 'https://siakapkeli.my/articles/mbsa-tidak-berkompromi-dengan-anggota-salah-guna-kuasa' },
    ],
    checked: CHECKED,
  },
  {
    id: 'getting-there',
    title: 'Getting to and from Elmina',
    keywords: ['road', 'jalan', 'highway', 'lebuhraya', 'gce', 'guthrie', 'interchange', 'persimpangan', 'exit', 'toll', 'tol', 'drive', 'memandu', 'traffic', 'trafik', 'prolintas', 'access'],
    short:
      'City of Elmina is reached by the Elmina Interchange, exit 3504 on the Guthrie Corridor Expressway (GCE), which opened in January 2018. Prolintas, which runs the GCE, is on 1-800-22-8888.',
    details:
      'The Elmina Interchange is exit 3504 on the Guthrie Corridor Expressway (GCE), run by Prolintas, and opened in January 2018. Sime Darby Property built feeder roads linking Denai Alam and Bukit Subang to Elmina West, and Subang Bestari to the GCE through Elmina East. The interchange ramps were closed for a while after a light-aircraft crash in August 2023 and reopened. For road or toll questions, Prolintas is on 1-800-22-8888.',
    sources: [
      { title: 'Sime Darby Property: Elmina Interchange is now open', url: 'https://www.simedarbyproperty.com/press-releases/elmina-interchange-now-open-enhancing-connectivity-sime-darby-propertys-city-elmina' },
      { title: 'paultan.org: Elmina interchange reopened (Aug 2023)', url: 'https://paultan.org/2023/08/18/elmina-interchange-at-gce-reopened-prolintas/' },
    ],
    checked: CHECKED,
  },
  {
    id: 'schools',
    title: 'Schools in and near Elmina',
    keywords: ['school', 'sekolah', 'kindergarten', 'tadika', 'preschool', 'prasekolah', 'international school', 'sekolah antarabangsa', 'education', 'pendidikan', 'tahfiz'],
    short:
      'Schools in Elmina include Global Oak Tree Scholars International School and Al-Amin Darul Musthofa (an integrated Islamic school at Temu Elmina), plus several preschools. A Chinese primary school, SJK(C) Regent Elmina, was planned; check its status with the school or the Education Department.',
    details:
      'Reported schools in City of Elmina: Global Oak Tree Scholars International School (Elmina campus, preschool to secondary, British and Cambridge IGCSE curricula); Al-Amin Darul Musthofa, an integrated Islamic school at Temu Elmina, its second branch, opened in 2023; and preschools such as Bright Kids and Tiny Tree House (Persiaran Atmosfera). A planned education hub listed SJK(C) Regent Elmina (expected around 2025, not confirmed open) and SK and SMK Denai Alam. SJK (T) Ladang Rasak is on Persiaran Metafasa next to Elmina Valley. Fees and places change: check with each school.',
    sources: [
      { title: 'iProperty: City of Elmina, the jewel of Shah Alam', url: 'https://www.iproperty.com.my/property-insights/city-of-elmina-the-jewel-of-shah-alam-94468' },
      { title: 'Kiddy123: Al-Amin Darul Musthofa, Elmina', url: 'https://www.kiddy123.com/article/al-amin-darul-musthofa-integrated-islamic-school-elmina/' },
      { title: 'Education Destination Malaysia: Global Oak Tree Scholars', url: 'https://educationdestinationmalaysia.com/school/global-oak-tree-scholars-international-school' },
      { title: 'OpenStreetMap: SJK (T) Ladang Rasak', url: 'https://www.openstreetmap.org/search?query=SJK%20(T)%20Ladang%20Rasak' },
    ],
    checked: CHECKED,
  },
  {
    id: 'business-park',
    title: 'Elmina Business Park and other developments',
    keywords: ['business park', 'taman perniagaan', 'industrial', 'perindustrian', 'factory', 'kilang', 'data centre', 'pusat data', 'google', 'jobs', 'kerja', 'city centre', 'pusat bandar'],
    short:
      'Elmina Business Park is Sime Darby Property’s industrial park in the township, home to Google’s first hyperscale data centre in Malaysia. Elmina Business Park 2, a 600-acre industrial park, launched in January 2026.',
    details:
      'Elmina Business Park is Sime Darby Property’s industrial park within City of Elmina; it hosts Google’s first hyperscale data centre in Malaysia, which was due for completion in the second quarter of 2026. Elmina Business Park 2 (600 acres, gross development value about RM1.72 billion, semi-detached factories and 2 to 4 acre industrial lots) launched in January 2026 and was about 70% taken up by April 2026. Sime Darby Property also plans Elmina City Centre as the township’s commercial centre.',
    sources: [
      { title: 'Sime Darby Property: Elmina Business Park 2', url: 'https://www.simedarbyproperty.com/press-releases/sime-darby-property-widens-industrial-footprint-elmina-business-park-2' },
      { title: 'The Edge: Elmina Business Park 2 70% taken up', url: 'https://theedgemalaysia.com/node/799556' },
    ],
    checked: CHECKED,
  },
  {
    id: 'app-features',
    title: 'What SimeTown can do',
    keywords: ['app', 'aplikasi', 'simetown', 'how', 'bagaimana', 'feature', 'ciri', 'help', 'bantuan', 'what can you do', 'apa boleh', 'gerak', 'lapor', 'tamu', 'kitar', 'jimat', 'banjir', 'taman', 'akses', 'jiran', 'kongsi', 'komuniti', 'community'],
    short:
      'SimeTown covers Gerak (walks and rides), Lapor (reports), Tamu (visitor passes), Jiran and Kongsi (neighbours and sharing), Kitar (recycling), Jimat (energy bills), Banjir (flood status), Taman (gardens) and Akses+ (access needs), with points you can spend at township shops.',
    details:
      'SimeTown features: Gerak tracks walks and rides on the township loops; Lapor reports problems such as potholes or broken lights to the township team with a photo; Tamu makes visitor passes and lets the guard check visitors; Jiran is the neighbours’ help board and Kongsi is for sharing and lending; Kitar records recycling at kiosk bins; Jimat reads electricity and water bills and tracks savings; Banjir shows the official flood status and alerts; Taman has the edible gardens waiting list, the watering roster and the wildlife log; Akses+ records access needs and a carer. Points earned from green actions can be spent at township shops. The Assistant can make a visitor pass or pass a question to the township office after the resident confirms.',
    // About this app itself: no outside source.
    sources: [],
    checked: CHECKED,
  },
];

const words = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

const STOP = new Set(['the', 'and', 'for', 'what', 'is', 'are', 'in', 'of', 'to', 'a', 'an', 'do', 'does', 'di', 'yang', 'dan', 'ke', 'ini', 'itu', 'apa', 'ada', 'me', 'my', 'i', 'you', 'can', 'how', 'right', 'now']);

/**
 * Finds the entries that best match a question. Keyword phrases count most,
 * then words in the title, then words in the text. Whole words only, so
 * "drain" never matches "rain".
 */
export function searchKnowledge(query: string, limit = 3): { entry: KnowledgeEntry; score: number }[] {
  const q = ` ${words(query).join(' ')} `;
  const qWords = new Set(words(query).filter((w) => !STOP.has(w)));
  if (qWords.size === 0) return [];
  return KNOWLEDGE.map((entry) => {
    if (entry.notWhen?.some((p) => q.includes(` ${words(p).join(' ')} `))) return { entry, score: 0 };
    let score = 0;
    for (const k of entry.keywords) {
      const phrase = words(k).join(' ');
      if (phrase && q.includes(` ${phrase} `)) score += phrase.includes(' ') ? 4 : 3;
    }
    for (const w of words(entry.title)) if (qWords.has(w)) score += 1.5;
    const text = new Set(words(entry.details));
    for (const w of qWords) if (text.has(w)) score += 0.5;
    return { entry, score };
  })
    .filter((r) => r.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
