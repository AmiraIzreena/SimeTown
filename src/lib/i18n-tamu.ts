/**
 * Malay for Tamu's visitor details (BR26, revised 2026-10-23): the forms, the gate, the visitor's pass page, the
 * emails, the walkthroughs and the Terms and Privacy sections about visitors. Entries the shared catalogues already
 * give are not repeated here.
 */
export const tamuMalay: Record<string, string> = {
  // Labels shared by every form (shared/domain.ts, components/features/visitor-details.tsx).
  'Malaysian citizen': 'Warganegara Malaysia',
  'Non-Malaysian citizen': 'Bukan warganegara Malaysia',
  'No vehicle (on foot)': 'Tiada kenderaan (berjalan kaki)',
  'Car': 'Kereta',
  'Motorcycle': 'Motosikal',
  'Bicycle': 'Basikal',
  'Van': 'Van',
  'Lorry': 'Lori',
  'Bus': 'Bas',
  'E-hailing or taxi': 'E-hailing atau teksi',
  'Visiting family or friends': 'Melawat keluarga atau rakan',
  'Contractor or renovation': 'Kontraktor atau pengubahsuaian',
  'Domestic helper': 'Pembantu rumah',
  'Event': 'Acara',
  'Property viewing': 'Melihat hartanah',
  'Maintenance or repair': 'Penyelenggaraan atau pembaikan',
  'Citizenship': 'Kewarganegaraan',
  'MyKad number': 'Nombor MyKad',
  'Passport, ID or licence number': 'Nombor pasport, kad pengenalan atau lesen',
  'e.g. A12345678': 'cth. A12345678',
  'e.g. 900101-00-1234': 'cth. 900101-00-1234',
  'From their own country.': 'Dari negara mereka sendiri.',
  'Also their driving licence number. MyKid for children.': 'Juga nombor lesen memandu mereka. MyKid untuk kanak-kanak.',
  'Transport': 'Pengangkutan',
  'Driving licence expiry': 'Tarikh tamat lesen memandu',
  'An expired licence cannot be used to drive in.': 'Lesen yang telah tamat tempoh tidak boleh digunakan untuk memandu masuk.',
  'Reason for the visit': 'Sebab lawatan',
  'What is the visit for?': 'Apakah tujuan lawatan?',
  'Licence valid until': 'Lesen sah sehingga',
  'No visitor details yet': 'Belum ada butiran pelawat',

  // Field errors from the server and the step-by-step form.
  'A MyKad or MyKid number has 12 digits, like 900101-00-1234.': 'Nombor MyKad atau MyKid ada 12 digit, seperti 900101-00-1234.',
  'Check the number: its first 6 digits are the date of birth.': 'Semak nombor itu: 6 digit pertamanya ialah tarikh lahir.',
  'Use 5 to 20 letters and numbers, as printed on the passport, identity card or licence.': 'Gunakan 5 hingga 20 huruf dan nombor, seperti yang dicetak pada pasport, kad pengenalan atau lesen.',
  'Choose the visitor’s citizenship.': 'Pilih kewarganegaraan pelawat.',
  'Enter the identity number.': 'Masukkan nombor pengenalan diri.',
  'This driving licence has expired. A visitor cannot drive in on it.': 'Lesen memandu ini telah tamat tempoh. Pelawat tidak boleh memandu masuk dengannya.',
  'Say what the visit is for.': 'Nyatakan tujuan lawatan.',
  'Enter the visitor’s citizenship and identity number.': 'Masukkan kewarganegaraan dan nombor pengenalan diri pelawat.',
  'Choose how the visitor is travelling.': 'Pilih cara pelawat datang.',
  'Enter the vehicle number.': 'Masukkan nombor kenderaan.',
  'Enter the driving licence’s expiry date.': 'Masukkan tarikh tamat lesen memandu.',
  'Choose the reason for the visit.': 'Pilih sebab lawatan.',
  'Please agree before sending your details.': 'Sila bersetuju sebelum menghantar butiran anda.',
  'Choose which emails to change.': 'Pilih e-mel yang hendak diubah.',
  'Only residents receive parcel and visitor emails.': 'Hanya penduduk menerima e-mel bungkusan dan pelawat.',
  'The gate could not record the collector.': 'Pintu masuk tidak dapat merekodkan pengutip.',
  'This pass can no longer be used. Ask your host for a new one.': 'Pas ini tidak boleh digunakan lagi. Minta pas baharu daripada tuan rumah anda.',
  'Your details are already complete. The guard checks them at the gate.': 'Butiran anda sudah lengkap. Pengawal menyemaknya di pintu masuk.',
  'Visitor details cannot be saved yet: the township office must finish setting up SimeTown (VISITOR_DATA_KEY).':
    'Butiran pelawat belum boleh disimpan: pejabat perbandaran perlu melengkapkan persediaan SimeTown (VISITOR_DATA_KEY).',

  // The resident's Tamu page.
  'The gate needs your visitor’s citizenship, identity number, transport and reason for the visit. You can let your visitor give their identity on their pass link.':
    'Pintu masuk memerlukan kewarganegaraan, nombor pengenalan diri, pengangkutan dan sebab lawatan pelawat anda. Anda boleh membiarkan pelawat memberikan pengenalan diri mereka melalui pautan pas mereka.',
  'Visitor’s identity': 'Pengenalan diri pelawat',
  'Visitor’s IC or passport': 'IC atau pasport pelawat',
  'Who fills in the visitor’s IC or passport number?': 'Siapa yang mengisi nombor IC atau pasport pelawat?',
  'I’ll fill it in now': 'Saya isi sekarang',
  'You have their IC or passport number with you.': 'Anda ada nombor IC atau pasport mereka.',
  'My visitor fills it in': 'Pelawat saya yang isi',
  'They type it on their pass link before they come. If they don’t, the guard records it at the gate.': 'Mereka menaipnya di pautan pas sebelum datang. Jika tidak, pengawal merekodkannya di pintu masuk.',
  'Who fills it in?': 'Siapa yang isi?',
  'Who gives it?': 'Siapa yang memberikannya?',
  'Your visitor enters it on their pass link before they come. The guard fills it in at the gate if they did not.':
    'Pelawat anda memasukkannya melalui pautan pas sebelum datang. Pengawal mengisinya di pintu masuk jika mereka tidak berbuat demikian.',
  'I will enter it now': 'Saya akan memasukkannya sekarang',
  'My visitor enters it on their pass link': 'Pelawat saya memasukkannya melalui pautan pas mereka',
  'Only with your visitor’s permission. The number is stored encrypted, shown in full only to the guard at the gate, and deleted after 90 days. Your home sees its last 4 characters.':
    'Hanya dengan kebenaran pelawat anda. Nombor itu disimpan secara disulitkan, dipaparkan sepenuhnya hanya kepada pengawal di pintu masuk, dan dipadam selepas 90 hari. Rumah anda melihat 4 aksara terakhirnya.',
  'Waiting for your visitor’s details: they can give them on their link, or the guard fills them in at the gate.':
    'Menunggu butiran pelawat anda: mereka boleh memberikannya melalui pautan mereka, atau pengawal mengisinya di pintu masuk.',
  'Your visitor gives their identity on this link before they come. If they do not, the guard fills it in at the gate.':
    'Pelawat anda memberikan pengenalan diri mereka melalui pautan ini sebelum datang. Jika tidak, pengawal mengisinya di pintu masuk.',
  'WhatsApp and SMS open on your phone with the message ready: you send it yourself. Sharing again later makes a new link and the old one stops working.':
    'WhatsApp dan SMS dibuka di telefon anda dengan mesej yang sedia: anda sendiri yang menghantarnya. Berkongsi semula kemudian membuat pautan baharu dan pautan lama berhenti berfungsi.',
  'Who gives the visitor’s identity?': 'Siapa yang memberikan pengenalan diri pelawat?',
  'If your visitor gives it, they enter it on their pass link. The guard fills it in at the gate if they did not.':
    'Jika pelawat anda yang memberikannya, mereka memasukkannya melalui pautan pas mereka. Pengawal mengisinya di pintu masuk jika mereka tidak berbuat demikian.',

  // The guard's gate screen.
  'Scan visitor passes, log walk-ins and answer SOS calls. Check the visitor’s identity card against their details and hand it straight back: never keep the card.':
    'Imbas pas pelawat, rekodkan pelawat tanpa pas dan jawab panggilan SOS. Semak kad pengenalan pelawat dengan butiran mereka dan pulangkan serta-merta: jangan sekali-kali menyimpan kad itu.',
  'Details needed:': 'Butiran diperlukan:',
  'The visitor’s driving licence has expired. They cannot drive in until a valid licence is shown: enter its expiry date.':
    'Lesen memandu pelawat telah tamat tempoh. Mereka tidak boleh memandu masuk sehingga lesen yang sah ditunjukkan: masukkan tarikh tamatnya.',
  'Fill in what this pass is missing, from the visitor’s identity card. Then hand the card straight back.':
    'Isikan apa yang tiada pada pas ini, daripada kad pengenalan pelawat. Kemudian pulangkan kad itu serta-merta.',
  'Let in': 'Benarkan masuk',
  'The host has been told they arrived. Hand the identity card straight back.': 'Tuan rumah telah dimaklumkan mereka tiba. Pulangkan kad pengenalan serta-merta.',
  'No pass? Record the visitor’s details from their identity card, and the house. The household replies in SimeTown.':
    'Tiada pas? Rekodkan butiran pelawat daripada kad pengenalan mereka, dan rumah yang dituju. Isi rumah menjawab dalam SimeTown.',

  // The visitor's pass page and the guest page.
  'Thank you. Your details are with the gate.': 'Terima kasih. Butiran anda telah diterima oleh pintu masuk.',
  'Before you come: your details for the gate': 'Sebelum anda datang: butiran anda untuk pintu masuk',
  'Your host asked you to give these yourself. It makes the gate quicker. If you prefer, the guard can fill them in from your identity card when you arrive.':
    'Tuan rumah anda meminta anda memberikannya sendiri. Ini mempercepatkan urusan di pintu masuk. Jika anda mahu, pengawal boleh mengisinya daripada kad pengenalan anda semasa anda tiba.',
  'I agree that SimeTown keeps these details for township security, shows the number in full only to the guard at the gate, and deletes them after 90 days. See the':
    'Saya bersetuju bahawa SimeTown menyimpan butiran ini untuk keselamatan perbandaran, memaparkan nombor itu sepenuhnya hanya kepada pengawal di pintu masuk, dan memadamnya selepas 90 hari. Lihat',
  'Send my details': 'Hantar butiran saya',
  'Your details': 'Butiran anda',
  'Your details are with the gate. Bring your identity card: the guard checks it and hands it straight back.':
    'Butiran anda telah diterima oleh pintu masuk. Bawa kad pengenalan anda: pengawal menyemaknya dan memulangkannya serta-merta.',
  'For township security the gate records your name, citizenship, identity number, transport and the reason for your visit. The number is stored encrypted, shown in full only to the guard, and deleted after 90 days. The guard never keeps your identity card.':
    'Untuk keselamatan perbandaran, pintu masuk merekodkan nama, kewarganegaraan, nombor pengenalan diri, pengangkutan dan sebab lawatan anda. Nombor itu disimpan secara disulitkan, dipaparkan sepenuhnya hanya kepada pengawal, dan dipadam selepas 90 hari. Pengawal tidak sekali-kali menyimpan kad pengenalan anda.',
  'Your host sends you a link by WhatsApp or SMS. Open it, add your details if your host asks, and show the QR code at the main gate. No app needed.':
    'Tuan rumah anda menghantar pautan melalui WhatsApp atau SMS. Bukanya, tambah butiran anda jika diminta oleh tuan rumah, dan tunjukkan kod QR di pintu utama. Tiada aplikasi diperlukan.',
  'Open the link on your phone as you arrive. No app to download. Bring your identity card: the guard checks it and hands it straight back.':
    'Buka pautan di telefon anda semasa tiba. Tiada aplikasi untuk dimuat turun. Bawa kad pengenalan anda: pengawal menyemaknya dan memulangkannya serta-merta.',

  // The visitor's email: SimeTown sends the pass.
  'Visitor’s email (optional)': 'E-mel pelawat (pilihan)',
  'SimeTown emails them the pass. Leave it empty to send the link yourself by WhatsApp or SMS.':
    'SimeTown menghantar pas kepada mereka melalui e-mel. Biarkan kosong untuk menghantar pautan sendiri melalui WhatsApp atau SMS.',
  'Pass emailed to': 'Pas dihantar melalui e-mel kepada',
  'SimeTown has emailed the pass to': 'SimeTown telah menghantar pas melalui e-mel kepada',
  '. You can also send the link yourself below.': '. Anda juga boleh menghantar pautan sendiri di bawah.',
  'Open your pass before you arrive and show its QR code at the main gate.': 'Buka pas anda sebelum tiba dan tunjukkan kod QR-nya di pintu utama.',
  'Your visitor pass is ready': 'Pas pelawat anda sudah sedia',
  'Open my pass': 'Buka pas saya',
  'Bring your identity card: the guard checks it and hands it straight back. If your host asked, add your details on the pass page before you come. This link is your pass, so please do not forward this email.':
    'Bawa kad pengenalan anda: pengawal menyemaknya dan memulangkannya serta-merta. Jika diminta oleh tuan rumah, tambah butiran anda di halaman pas sebelum datang. Pautan ini ialah pas anda, jadi sila jangan majukan e-mel ini.',
  'You received this because a SimeTown resident invited you. Your email address is used only to send this pass.':
    'Anda menerima ini kerana seorang penduduk SimeTown menjemput anda. Alamat e-mel anda hanya digunakan untuk menghantar pas ini.',
  'SimeTown emails your visitor the pass': 'SimeTown menghantar pas kepada pelawat anda melalui e-mel',
  'Add your visitor’s email and SimeTown emails them the pass: a link with its QR code. No email? Send the link yourself by WhatsApp or SMS from your phone. Your visitor needs no app and no account. Sharing again makes a new link: an emailed visitor gets it too, and the old one stops working.':
    'Tambah e-mel pelawat anda dan SimeTown menghantar pas kepada mereka: pautan dengan kod QR-nya. Tiada e-mel? Hantar pautan sendiri melalui WhatsApp atau SMS dari telefon anda. Pelawat anda tidak memerlukan aplikasi atau akaun. Berkongsi semula membuat pautan baharu: pelawat yang menerima e-mel turut mendapatnya, dan pautan lama berhenti berfungsi.',
  'SimeTown has emailed the pass': 'SimeTown telah menghantar pas melalui e-mel',
  'Or send by WhatsApp or SMS': 'Atau hantar melalui WhatsApp atau SMS',

  // No WhatsApp or SMS: SimeTown emails the pass, or the resident gives the pass code.
  'SimeTown emails them the pass. No email? Give them the pass code: the guard can type it at the gate.':
    'SimeTown menghantar pas kepada mereka melalui e-mel. Tiada e-mel? Berikan kod pas: pengawal boleh menaipnya di pintu masuk.',
  'Send again': 'Hantar semula',
  'Your visitor opens the email and shows the QR code at the gate.': 'Pelawat anda membuka e-mel dan menunjukkan kod QR di pintu masuk.',
  'Give your visitor the pass code, or copy the link for them.': 'Berikan kod pas kepada pelawat anda, atau salin pautan untuk mereka.',
  'No email was given. Tell your visitor the pass code above: the guard can type it at the gate. Or copy the link and pass it on.':
    'Tiada e-mel diberikan. Beritahu pelawat anda kod pas di atas: pengawal boleh menaipnya di pintu masuk. Atau salin pautan dan sampaikan kepada mereka.',
  'Send again makes a new link and the old one stops working. If you gave an email, SimeTown emails the new link.':
    'Hantar semula membuat pautan baharu dan pautan lama berhenti berfungsi. Jika anda memberikan e-mel, SimeTown menghantar pautan baharu melalui e-mel.',
  'Your pass comes by email': 'Pas anda dihantar melalui e-mel',
  'SimeTown emails it when your host invites you. It is valid for the day or the times your host chose. No email? Your host can give you the pass code instead.':
    'SimeTown menghantarnya melalui e-mel apabila tuan rumah menjemput anda. Ia sah untuk hari itu atau masa yang dipilih tuan rumah. Tiada e-mel? Tuan rumah boleh memberikan kod pas kepada anda.',
  'SimeTown emails you the pass your host made. Open it, add your details if your host asks, and show the QR code at the main gate. No app needed.':
    'SimeTown menghantar pas yang dibuat oleh tuan rumah anda melalui e-mel. Bukanya, tambah butiran anda jika diminta oleh tuan rumah, dan tunjukkan kod QR di pintu utama. Tiada aplikasi diperlukan.',
  'Add your visitor’s email and SimeTown emails them the pass: a link with its QR code. Your visitor needs no app and no account. No email? Tell them the pass code: the guard can type it at the gate. Send again makes a new link, emailed to your visitor, and the old one stops working.':
    'Tambah e-mel pelawat anda dan SimeTown menghantar pas kepada mereka: pautan dengan kod QR-nya. Pelawat anda tidak memerlukan aplikasi atau akaun. Tiada e-mel? Beritahu mereka kod pas: pengawal boleh menaipnya di pintu masuk. Hantar semula membuat pautan baharu, dihantar kepada pelawat melalui e-mel, dan pautan lama berhenti berfungsi.',
  'No email? Tell them the pass code': 'Tiada e-mel? Beritahu mereka kod pas',
  'Send again makes a new link': 'Hantar semula membuat pautan baharu',
  'The company sees this pass in its bookings. The worker shows the QR code, or tells the guard the code, at the main gate.':
    'Syarikat melihat pas ini dalam tempahannya. Pekerja menunjukkan kod QR, atau memberitahu kod itu kepada pengawal, di pintu utama.',

  // Account: emails.
  'Parcel and visitor news in your inbox, in the language you use in SimeTown. Pickup codes and visitors’ identity numbers are never sent by email.':
    'Berita bungkusan dan pelawat dalam peti masuk anda, dalam bahasa yang anda gunakan dalam SimeTown. Kod pengambilan dan nombor pengenalan diri pelawat tidak sekali-kali dihantar melalui e-mel.',
  'Visitor emails': 'E-mel pelawat',
  'When your visitor is let in at the main gate, and when someone without a pass asks for your home.':
    'Apabila pelawat anda dibenarkan masuk di pintu utama, dan apabila seseorang tanpa pas bertanya tentang rumah anda.',
  'Visitor emails are on.': 'E-mel pelawat dihidupkan.',
  'Visitor emails are off. Tamu still tells you in the app.': 'E-mel pelawat dimatikan. Tamu masih memaklumkan anda dalam aplikasi.',

  // Emails to the household (server/modules/email/tamu.ts).
  'Your visitor has arrived': 'Pelawat anda telah tiba',
  'Identity': 'Pengenalan diri',
  'Travelling by': 'Datang dengan',
  'Checked at the gate': 'Disemak di pintu masuk',
  'Recorded at the gate': 'Direkodkan di pintu masuk',
  'Open Tamu': 'Buka Tamu',
  'Answer in Tamu': 'Jawab dalam Tamu',
  'A visitor is at the main gate for your home': 'Seorang pelawat berada di pintu utama untuk rumah anda',
  'Waiting for your answer': 'Menunggu jawapan anda',
  'Are you expecting this visitor?': 'Adakah anda menjangka pelawat ini?',
  'For your visitor’s privacy, identity numbers are never sent by email. Tamu shows the last 4 characters.':
    'Untuk privasi pelawat anda, nombor pengenalan diri tidak sekali-kali dihantar melalui e-mel. Tamu memaparkan 4 aksara terakhir.',
  'You received this because a visitor came to your home. You can turn visitor emails off in Account.':
    'Anda menerima ini kerana seorang pelawat datang ke rumah anda. Anda boleh mematikan e-mel pelawat di Akaun.',

  // Walkthroughs: residents.
  'Visitor passes, visitor details, walk-ins and SOS, from your phone to the main gate.': 'Pas pelawat, butiran pelawat, pelawat tanpa pas dan SOS, dari telefon anda ke pintu utama.',
  'Choose the kind of visit, then your visitor’s name, how they travel and the reason for the visit. A car or motorcycle needs its number. Each kind of pass has its own longest length: a delivery lasts a day, a contractor up to 30 days.':
    'Pilih jenis lawatan, kemudian nama pelawat anda, cara mereka datang dan sebab lawatan. Kereta atau motosikal memerlukan nombornya. Setiap jenis pas ada tempoh paling lama sendiri: penghantaran sehari, kontraktor sehingga 30 hari.',
  'Visiting family': 'Melawat keluarga',
  'Car · BKL 2408': 'Kereta · BKL 2408',
  'Their identity: from you, or from them': 'Pengenalan diri mereka: daripada anda, atau daripada mereka',
  'The gate also needs your visitor’s citizenship and identity number, and a driver’s licence expiry. Enter them now, with your visitor’s permission, or let your visitor give them on their pass link. Your home only ever sees the last 4 characters.':
    'Pintu masuk juga memerlukan kewarganegaraan dan nombor pengenalan diri pelawat anda, dan tarikh tamat lesen bagi pemandu. Masukkannya sekarang, dengan kebenaran pelawat anda, atau biarkan pelawat memberikannya melalui pautan pas mereka. Rumah anda hanya melihat 4 aksara terakhir.',
  'Licence valid': 'Lesen sah',
  'The pass is a link with a QR code. Your visitor needs no app and no account. WhatsApp and SMS open on your phone with the message ready: you send it yourself. Sharing again makes a new link, and the old one stops working.':
    'Pas ialah pautan dengan kod QR. Pelawat anda tidak memerlukan aplikasi atau akaun. WhatsApp dan SMS dibuka di telefon anda dengan mesej yang sedia: anda sendiri yang menghantarnya. Berkongsi semula membuat pautan baharu, dan pautan lama berhenti berfungsi.',
  'They see the QR code to show the guard and directions to the main gate. If you left their identity to them, a short form asks for it, sent only with their agreement. Only your street is shown, never your house number or your name.':
    'Mereka melihat kod QR untuk ditunjukkan kepada pengawal dan arah ke pintu utama. Jika anda membiarkan mereka memberikan pengenalan diri, satu borang ringkas memintanya, dihantar hanya dengan persetujuan mereka. Hanya jalan anda dipaparkan, tidak sekali-kali nombor rumah atau nama anda.',
  'The guard scans the QR code at the main gate and checks their identity card. You get a notification and an email saying who came, how and why, never their identity number. A one-visit or delivery pass then closes by itself.':
    'Pengawal mengimbas kod QR di pintu utama dan menyemak kad pengenalan mereka. Anda menerima pemberitahuan dan e-mel tentang siapa yang datang, bagaimana dan mengapa, tidak sekali-kali nombor pengenalan diri mereka. Pas satu lawatan atau penghantaran kemudian ditutup dengan sendirinya.',
  'Email: Your visitor has arrived': 'E-mel: Pelawat anda telah tiba',
  'Identity number never emailed': 'Nombor pengenalan diri tidak sekali-kali dihantar melalui e-mel',
  'The guard records their details and your home is asked straight away, in the app and by email. Tap Expected, Not expected or Call me; the first answer from your home is the one the guard sees. Not expected tells the guard. It never blocks lawful access on a public road.':
    'Pengawal merekodkan butiran mereka dan rumah anda ditanya serta-merta, dalam aplikasi dan melalui e-mel. Ketik Dijangka, Tidak dijangka atau Hubungi saya; jawapan pertama dari rumah anda ialah yang dilihat pengawal. Tidak dijangka memaklumkan pengawal. Ia tidak sekali-kali menghalang akses yang sah di jalan awam.',
  'Motorcycle · Delivery. Are you expecting them?': 'Motosikal · Penghantaran. Adakah anda menjangka kedatangan mereka?',
  'A visit keeps the visitor’s name, citizenship, identity number, transport and reason. The number is stored encrypted and shown in full only to the guard. Guards never keep the card. Everything is deleted after 90 days. Tamu gives no points and no XP.':
    'Lawatan menyimpan nama, kewarganegaraan, nombor pengenalan diri, pengangkutan dan sebab lawatan pelawat. Nombor itu disimpan secara disulitkan dan dipaparkan sepenuhnya hanya kepada pengawal. Pengawal tidak sekali-kali menyimpan kad itu. Semuanya dipadam selepas 90 hari. Tamu tidak memberi mata dan tiada XP.',
  'Number encrypted; your home sees the last 4': 'Nombor disulitkan; rumah anda melihat 4 terakhir',
  'Guards never keep the card': 'Pengawal tidak sekali-kali menyimpan kad',

  // Walkthroughs: the guard.
  'Visitor passes and details, walk-ins, SOS calls and the patrol round.': 'Pas dan butiran pelawat, pelawat tanpa pas, panggilan SOS dan pusingan rondaan.',
  'Valid: check the card, then let them in': 'Sah: semak kad, kemudian benarkan mereka masuk',
  'The screen shows who they are, the house and their details, with the full identity number. Compare it with their identity card and hand the card straight back. The host is told they arrived.':
    'Skrin menunjukkan siapa mereka, rumah yang dituju dan butiran mereka, dengan nombor pengenalan diri penuh. Bandingkan dengan kad pengenalan mereka dan pulangkan kad itu serta-merta. Tuan rumah dimaklumkan mereka telah tiba.',
  'One visit · to No. 5, Jalan Metafasa': 'Satu lawatan · ke No. 5, Jalan Metafasa',
  'Details missing? Fill them in first': 'Butiran tiada? Isikan dahulu',
  'A pass SimeTown made for a collector or a worker, or one whose visitor did not add their identity, asks you for what is missing. Copy it from their identity card, then tap Let in. Nothing is recorded until then.':
    'Pas yang dibuat SimeTown untuk pengutip atau pekerja, atau pas yang pelawatnya tidak menambah pengenalan diri, meminta anda mengisi apa yang tiada. Salin daripada kad pengenalan mereka, kemudian ketik Benarkan masuk. Tiada apa-apa direkodkan sebelum itu.',
  'Details needed: Collector': 'Butiran diperlukan: Pengutip',
  'A pass may be cancelled by the host, expired, already used or not valid yet. A driver whose licence has expired cannot be let in by vehicle until a valid licence date is entered. Log anyone else as a walk-in, so the household can answer.':
    'Pas mungkin dibatalkan oleh tuan rumah, tamat tempoh, sudah digunakan atau belum sah. Pemandu yang lesennya telah tamat tempoh tidak boleh dibenarkan masuk dengan kenderaan sehingga tarikh lesen yang sah dimasukkan. Rekodkan orang lain sebagai pelawat tanpa pas, supaya isi rumah boleh menjawab.',
  'Driving licence expired': 'Lesen memandu tamat tempoh',
  'No pass? Record their details and ask the household': 'Tiada pas? Rekodkan butiran mereka dan tanya isi rumah',
  'From their identity card, record the name, citizenship and identity number, how they travel (with the vehicle number and licence expiry for drivers) and the reason, then choose the house and tap Ask the household. Everyone there with the app is asked, in the app and by email.':
    'Daripada kad pengenalan mereka, rekodkan nama, kewarganegaraan dan nombor pengenalan diri, cara mereka datang (dengan nombor kenderaan dan tarikh tamat lesen bagi pemandu) dan sebab lawatan, kemudian pilih rumah dan ketik Tanya isi rumah. Setiap orang di situ yang ada aplikasi akan ditanya, dalam aplikasi dan melalui e-mel.',
  'Motorcycle · Delivery': 'Motosikal · Penghantaran',

  // Privacy Notice: visitors.
  'Visitors to your home (Tamu)': 'Pelawat ke rumah anda (Tamu)',
  'Your visitor’s name, citizenship, identity number, how they travel (vehicle number and, when they drive, their driving licence’s expiry), the reason for the visit, their email address if you give it so SimeTown can send them the pass, the times they came and left, and your home’s reply. See “Visitors” below.':
    'Nama, kewarganegaraan, nombor pengenalan diri pelawat anda, cara mereka datang (nombor kenderaan dan, jika mereka memandu, tarikh tamat lesen memandu), sebab lawatan, alamat e-mel mereka jika anda memberikannya supaya SimeTown boleh menghantar pas, masa mereka datang dan pergi, dan jawapan rumah anda. Lihat “Pelawat” di bawah.',
  'Email address:': 'Alamat e-mel:',
  'if the resident gives the visitor’s email address, SimeTown uses it only to send the pass link, and again if the pass is shared again. Only the resident’s household sees it. It is deleted with the pass, and the record of each email after 30 days.':
    'jika penduduk memberikan alamat e-mel pelawat, SimeTown menggunakannya hanya untuk menghantar pautan pas, dan sekali lagi jika pas dikongsi semula. Hanya isi rumah penduduk itu yang melihatnya. Ia dipadam bersama pas, dan rekod setiap e-mel selepas 30 hari.',
  'Give a visitor’s email address only if it is theirs and they are happy to receive the pass by email. SimeTown uses it for nothing else.':
    'Berikan alamat e-mel pelawat hanya jika ia milik mereka dan mereka bersetuju menerima pas melalui e-mel. SimeTown tidak menggunakannya untuk tujuan lain.',
  'collect your own MyKad number, bank or card details, precise GPS location, contacts or biometric data. Photos you take to check a recycling material are checked and then discarded, not stored. The only identity numbers SimeTown keeps are those of visitors at the main gate, as explained below.':
    'mengumpul nombor MyKad anda sendiri, butiran bank atau kad, lokasi GPS yang tepat, kenalan atau data biometrik. Foto yang anda ambil untuk menyemak bahan kitar semula disemak dan kemudian dibuang, tidak disimpan. Satu-satunya nombor pengenalan diri yang disimpan SimeTown ialah nombor pelawat di pintu utama, seperti yang diterangkan di bawah.',
  'Visitors': 'Pelawat',
  'For the township’s security, the main gate records who comes in. This applies to visitors with a pass and to visitors without one.':
    'Untuk keselamatan perbandaran, pintu utama merekodkan siapa yang masuk. Ini terpakai kepada pelawat yang mempunyai pas dan yang tidak.',
  'What is recorded:': 'Apa yang direkodkan:',
  'the visitor’s name; citizenship; identity number (a MyKad or MyKid number for Malaysians, or a passport, identity card or driving licence number for others); how they travel, with the vehicle number and, when they drive, the expiry date of their driving licence; the reason for the visit; the home they visit; and when they came and left.':
    'nama pelawat; kewarganegaraan; nombor pengenalan diri (nombor MyKad atau MyKid bagi rakyat Malaysia, atau nombor pasport, kad pengenalan atau lesen memandu bagi yang lain); cara mereka datang, dengan nombor kenderaan dan, jika mereka memandu, tarikh tamat lesen memandu; sebab lawatan; rumah yang dilawati; dan masa mereka datang dan pergi.',
  'Who gives it:': 'Siapa yang memberikannya:',
  'the resident who invites them, with the visitor’s permission; or the visitor on their own pass link, with their agreement; or the guard at the gate, from the visitor’s identity card. The guard checks the card and hands it straight back. Guards never keep, copy or photograph it.':
    'penduduk yang menjemput mereka, dengan kebenaran pelawat; atau pelawat sendiri melalui pautan pas mereka, dengan persetujuan mereka; atau pengawal di pintu masuk, daripada kad pengenalan pelawat. Pengawal menyemak kad itu dan memulangkannya serta-merta. Pengawal tidak sekali-kali menyimpan, menyalin atau mengambil gambarnya.',
  'Why:': 'Mengapa:',
  'to know who is in the township, to let the household know their visitor has arrived, and to make sure anyone driving in holds a valid driving licence. A visitor whose licence has expired cannot be recorded to drive in.':
    'untuk mengetahui siapa yang berada dalam perbandaran, memaklumkan isi rumah bahawa pelawat mereka telah tiba, dan memastikan sesiapa yang memandu masuk memegang lesen memandu yang sah. Pelawat yang lesennya telah tamat tempoh tidak boleh direkodkan untuk memandu masuk.',
  'Who sees the identity number:': 'Siapa yang melihat nombor pengenalan diri:',
  'only the guard at the gate sees it in full. The household and the visitor’s own pass page show its last 4 characters. It is never sent by email, and the AI Assistant never receives it.':
    'hanya pengawal di pintu masuk yang melihatnya sepenuhnya. Isi rumah dan halaman pas pelawat sendiri memaparkan 4 aksara terakhirnya. Ia tidak sekali-kali dihantar melalui e-mel, dan Pembantu AI tidak sekali-kali menerimanya.',
  'How it is protected:': 'Bagaimana ia dilindungi:',
  'the identity number is stored encrypted, with a key kept outside the database.': 'nombor pengenalan diri disimpan secara disulitkan, dengan kunci yang disimpan di luar pangkalan data.',
  'How long:': 'Berapa lama:',
  'visitor records, with every detail in them, are deleted after 90 days.': 'rekod pelawat, dengan semua butiran di dalamnya, dipadam selepas 90 hari.',
  'Visitors’ rights:': 'Hak pelawat:',
  'a visitor may ask us what we hold about them, to correct it or to delete it, by email to':
    'pelawat boleh bertanya kepada kami apa yang kami simpan tentang mereka, meminta pembetulan atau pemadamannya, melalui e-mel ke',
  'Visitor records at the main gate, including visitors’ identity numbers, are deleted after 90 days.':
    'Rekod pelawat di pintu utama, termasuk nombor pengenalan diri pelawat, dipadam selepas 90 hari.',
  'We collect what SimeTown needs to work: your contact details, your address in the township, and what you do in the app. For security, the main gate also records your visitors’ details, including their identity number, which is encrypted, shown in full only to the guard and deleted after 90 days. Shops see only your first name and initial; sponsors see grouped totals only. We never sell your data or use it for advertising. You can download or delete your data at any time from your Account page.':
    'Kami mengumpul apa yang diperlukan SimeTown untuk berfungsi: butiran hubungan anda, alamat anda dalam perbandaran, dan apa yang anda lakukan dalam aplikasi. Untuk keselamatan, pintu utama juga merekodkan butiran pelawat anda, termasuk nombor pengenalan diri mereka, yang disulitkan, dipaparkan sepenuhnya hanya kepada pengawal dan dipadam selepas 90 hari. Kedai hanya melihat nama pertama dan huruf awal anda; penaja hanya melihat jumlah berkumpulan. Kami tidak sekali-kali menjual data anda atau menggunakannya untuk pengiklanan. Anda boleh memuat turun atau memadam data anda pada bila-bila masa dari halaman Akaun anda.',

  // Terms of Use: visitors.
  'Visitor passes and the main gate': 'Pas pelawat dan pintu utama',
  'Tamu lets you send visitors a pass and tells you when they arrive. For the township’s security, every visit records the visitor’s citizenship, identity number, transport and the reason for the visit. When you create a pass or answer for a visitor:':
    'Tamu membolehkan anda menghantar pas kepada pelawat dan memaklumkan anda apabila mereka tiba. Untuk keselamatan perbandaran, setiap lawatan merekodkan kewarganegaraan, nombor pengenalan diri, pengangkutan dan sebab lawatan pelawat. Apabila anda mencipta pas atau menjawab bagi pihak pelawat:',
  'Enter your visitor’s details accurately, and only with their permission. Tell them that SimeTown keeps these details for township security and deletes them after 90 days, as our Privacy Notice explains. You may instead let your visitor give their identity on their own pass link.':
    'Masukkan butiran pelawat anda dengan tepat, dan hanya dengan kebenaran mereka. Beritahu mereka bahawa SimeTown menyimpan butiran ini untuk keselamatan perbandaran dan memadamnya selepas 90 hari, seperti yang diterangkan dalam Notis Privasi kami. Anda juga boleh membiarkan pelawat memberikan pengenalan diri mereka melalui pautan pas mereka sendiri.',
  'Do not use someone else’s identity number, or create a pass for anyone other than the visitor named on it.':
    'Jangan gunakan nombor pengenalan diri orang lain, atau cipta pas untuk sesiapa selain pelawat yang dinamakan padanya.',
  'A visitor driving in must hold a valid driving licence. A visitor whose licence has expired cannot be recorded to drive in.':
    'Pelawat yang memandu masuk mesti memegang lesen memandu yang sah. Pelawat yang lesennya telah tamat tempoh tidak boleh direkodkan untuk memandu masuk.',
  'The guard checks the visitor’s identity card and hands it straight back. Guards never keep, copy or photograph it.':
    'Pengawal menyemak kad pengenalan pelawat dan memulangkannya serta-merta. Pengawal tidak sekali-kali menyimpan, menyalin atau mengambil gambarnya.',
  'We may suspend Tamu, or your account, for passes or details that break these Terms.':
    'Kami boleh menggantung Tamu, atau akaun anda, kerana pas atau butiran yang melanggar Terma ini.',
  'Give accurate details and keep your account to yourself. SimeTown Points are a reward worth RM1 per 100 points at township shops, never cash. Be respectful in community features. Give your visitors’ details accurately and only with their permission. Flood alerts support, but do not replace, official warnings. This is a prototype: no real money moves.':
    'Berikan butiran yang tepat dan jangan kongsi akaun anda. Mata SimeTown ialah ganjaran bernilai RM1 bagi setiap 100 mata di kedai perbandaran, bukan wang tunai. Hormati orang lain dalam ciri komuniti. Berikan butiran pelawat anda dengan tepat dan hanya dengan kebenaran mereka. Amaran banjir menyokong, tetapi tidak menggantikan, amaran rasmi. Ini ialah prototaip: tiada wang sebenar berpindah.',
};

export const tamuTemplates: readonly (readonly [string, string])[] = [
  ['Your visitor pass for {0}', 'Pas pelawat anda untuk {0}'],
  [
    'you have been invited to {0}. Open your pass before you arrive and show its QR code to the guard at the main gate.',
    'anda telah dijemput ke {0}. Buka pas anda sebelum tiba dan tunjukkan kod QR-nya kepada pengawal di pintu utama.',
  ],
  ['{0} was let in at the main gate.', '{0} telah dibenarkan masuk di pintu utama.'],
  ['{0} was let in at the main gate with the pass you sent.', '{0} telah dibenarkan masuk di pintu utama dengan pas yang anda hantar.'],
  ['{0} is at the main gate. Are you expecting them?', '{0} berada di pintu utama. Adakah anda menjangka kedatangan mereka?'],
  [
    'the guard has recorded {0} at the main gate, asking for your home. Please answer in SimeTown: Expected, Not expected or Call me.',
    'pengawal telah merekodkan {0} di pintu utama, yang ingin ke rumah anda. Sila jawab dalam SimeTown: Dijangka, Tidak dijangka atau Hubungi saya.',
  ],
  [
    'Who came, how and why. Identity numbers show their last 4 characters only. Visitor records are deleted after {0} days.',
    'Siapa yang datang, bagaimana dan mengapa. Nombor pengenalan diri hanya memaparkan 4 aksara terakhir. Rekod pelawat dipadam selepas {0} hari.',
  ],
  [
    'Done. {0} Pass code {1}. Share the link below with {2}: they add their identity and transport on it, or the guard fills them in at the gate. You can make a new link in Tamu any time.',
    'Selesai. {0} Kod pas {1}. Kongsi pautan di bawah dengan {2}: mereka menambah pengenalan diri dan pengangkutan padanya, atau pengawal mengisinya di pintu masuk. Anda boleh membuat pautan baharu dalam Tamu pada bila-bila masa.',
  ],
];
