import { homeServicesTemplates } from './i18n-home-services';
import { komunitiTemplates } from './i18n-komuniti';
import { aksesTemplates } from './i18n-akses';
import { shopsTemplates } from './i18n-shops';
import { collectionsTemplates } from './i18n-collections';

/** Templates for application-generated messages; interpolated personal values stay unchanged. */
export const messageTemplates: readonly (readonly [string, string])[] = [
  // Old Taman notifications are still stored in residents' inboxes; keep translating them.
  ["You won plot {0} at {1}", "Anda memenangi plot {0} di {1}"],
  ["Your {0} sighting is confirmed", "Pemerhatian {0} anda disahkan"],
  ["Photo: {0}", "Foto: {0}"],
  ["{0} challenges a year", "{0} cabaran setahun"],
  [
    "{0} min ago",
    "{0} min lalu"
  ],
  [
    "+{0} Impact XP",
    "+{0} XP Impak"
  ],
  [
    "+{0} points ({1}), funded by {2}",
    "+{0} mata ({1}), dibiayai oleh {2}"
  ],
  [
    "+{0} offer points ({1}), backed by township shop offers",
    "+{0} mata tawaran ({1}), disandarkan tawaran kedai perbandaran"
  ],
  [
    "{0} not found.",
    "{0} tidak ditemui."
  ],
  [
    "{0}: water at {1}%.",
    "{0}: air pada {1}%."
  ],
  [
    "{0}. Reply Expected, Not expected or Call me.",
    "{0}. Jawab Dijangka, Tidak dijangka atau Hubungi saya."
  ],
  [
    "{0} is expected today",
    "{0} dijangka hari ini"
  ],
  [
    "Your offer points cover it now ({0} points).",
    "Mata tawaran anda kini mencukupi ({0} mata)."
  ],
  // native review
  // native review
  [
    "From verified green actions, for example {0} ({1}).",
    "Daripada tindakan hijau yang disahkan, contohnya {0} ({1})."
  ],
  [
    "{0} offer points. Recycle at a kiosk bin or take a tracked walk to earn them.",
    "{0} mata tawaran. Kitar semula di tong kiosk atau buat jalan kaki yang dijejak untuk memperolehnya."
  ],
  [
    "at {0}",
    "pada {0}"
  ],
  [
    "of {0} homes · {1} verified residents",
    "daripada {0} rumah · {1} penduduk disahkan"
  ],
  [
    "{0} kiosk drop-offs",
    "{0} serahan kiosk"
  ],
  [
    "{0} urgent and unread",
    "{0} segera dan belum dibaca"
  ],
  [
    "{0} resolved · median {1} h",
    "{0} diselesaikan · median {1} j"
  ],
  [
    "{0} sales at {1} shops",
    "{0} jualan di {1} kedai"
  ],
  [
    "{0} by shops · {1} by campaigns",
    "{0} oleh kedai · {1} oleh kempen"
  ],
  [
    "{0} of {1} online",
    "{0} daripada {1} dalam talian"
  ],
  [
    "{0} of {1}",
    "{0} daripada {1}"
  ],
  [
    "Logged. {0} resident{1} at {2} asked to reply.",
    "Direkodkan. {0} penduduk{1} di {2} diminta membalas."
  ],
  [
    "Logged. Nobody at {0} has the app: call the house.",
    "Direkodkan. Tiada sesiapa di {0} mempunyai aplikasi: hubungi rumah."
  ],
  [
    "· out {0}",
    "· keluar {0}"
  ],
  [
    "Checked {0}",
    "Disemak {0}"
  ],
  [
    "{0} zone{1} under a flood alert: {2}.",
    "{0} zon{1} di bawah amaran banjir: {2}."
  ],
  [
    "Service fee {0}",
    "Fi perkhidmatan {0}"
  ],
  [
    "{0} in success fees waiting",
    "{0} fi kejayaan menunggu"
  ],
  [
    ": at most {0} points here",
    ": maksimum {0} mata di sini"
  ],
  [
    ", minimum {0}",
    ", minimum {0}"
  ],
  [
    "You give the discount; the only fee is {0}% of it.",
    "Anda memberi diskaun; satu-satunya fi ialah {0}% daripadanya."
  ],
  [
    "Ask {0} to open their SimeTown wallet and confirm {1}.",
    "Minta {0} membuka dompet SimeTown dan mengesahkan {1}."
  ],
  [
    "the Shop Offer{0}",
    "Tawaran Kedai{0}"
  ],
  [
    "and {0} points",
    "dan {0} mata"
  ],
  [
    "Collect {0} from {1}.",
    "Terima {0} daripada {1}."
  ],
  [
    "Your tier runs until {0}{1}.",
    "Peringkat anda aktif hingga {0}{1}."
  ],
  [
    "{0} – {1} · funded by {2}",
    "{0} – {1} · dibiayai oleh {2}"
  ],
  [
    "Test picture: water at {0}% of the measuring post{1}",
    "Gambar ujian: air pada {0}% tiang pengukur{1}"
  ],
  [
    "Recycling at {0}",
    "SimeTown Recycle semula di {0}"
  ],
  [
    "Recorded at {0}",
    "Direkodkan di {0}"
  ],
  [
    "· min. spend {0}",
    "· belanja min. {0}"
  ],
  [
    "of {0}",
    "daripada {0}"
  ],
  [
    "Done. You used {0} points and pay {1}.{2}",
    "Selesai. Anda menggunakan {0} mata dan membayar {1}.{2}"
  ],
  [
    "+{0} points earned.",
    "+{0} mata diperoleh."
  ],
  [
    "Use the offer “{0}” at {1}?",
    "Gunakan tawaran “{0}” di {1}?"
  ],
  [
    "Use {0} points at {1}?",
    "Gunakan {0} mata di {1}?"
  ],
  [
    "· Shop Offer {0} off ({1} offer-backed points)",
    "· Tawaran Kedai diskaun {0} ({1} mata bersandarkan tawaran)"
  ],
  [
    "· points cover {0}",
    "· mata membayar {0}"
  ],
  [
    "Progress in {0}",
    "Kemajuan dalam {0}"
  ],
  [
    "Checkpoint passed: {0}",
    "Pusat semak dilalui: {0}"
  ],
  [
    "{0} weak GPS fixes ignored.",
    "{0} bacaan GPS lemah diabaikan."
  ],
  [
    "{0} was too fast for this activity and does not count.",
    "{0} terlalu laju untuk aktiviti ini dan tidak dikira."
  ],
  [
    "Fair play: parts faster than {0} km/h do not count.",
    "Permainan adil: bahagian melebihi {0} km/j tidak dikira."
  ],
  [
    "Signed-in {0}.",
    "{0} yang log masuk."
  ],
  [
    "{0} · backed by township shop offers",
    "{0} · disandarkan tawaran kedai perbandaran"
  ],
  [
    "{0} · funded by {1}",
    "{0} · dibiayai oleh {1}"
  ],
  [
    "Is {0} blocked?",
    "Adakah {0} terhalang?"
  ],
  [
    "{0} is normal: the water is at {1}%. I only repeat the official status; I never raise or cancel an alert.",
    "{0} normal: air pada {1}%. Saya hanya mengulangi status rasmi; saya tidak mengeluarkan atau membatalkan amaran."
  ],
  [
    "{0} is under a {1} alert: water at {2}%. {3}",
    "{0} di bawah amaran {1}: air pada {2}%. {3}"
  ],
  [
    "Safe route: {0}",
    "Laluan selamat: {0}"
  ],
  [
    "You have {0} points, worth {1}: {2} cash-backed and {3} offer-backed. You have saved {4} so far.",
    "Anda mempunyai {0} mata, bernilai {1}: {2} bersandarkan tunai dan {3} bersandarkan tawaran. Anda telah menjimatkan {4} setakat ini."
  ],
  [
    "Make a one-visit pass for {0}, {1} for 12 hours?",
    "Buat pas sekali lawatan untuk {0}, {1} selama 12 jam?"
  ],
  [
    "Done. Pass code {0}. Send {1} this link: {2}/pass/{3}",
    "Selesai. Kod pas {0}. Hantar pautan ini kepada {1}: {2}/pass/{3}"
  ],
  [
    "Available now: {0}. You have {1} offer points.",
    "Tersedia sekarang: {0}. Anda mempunyai {1} mata tawaran."
  ],
  [
    "{0} scanned. {1} more to finish {2}. {3}",
    "{0} diimbas. {1} lagi untuk melengkapkan {2}. {3}"
  ],
  [
    "Claimed {0}. {1} Guest recycling earns XP only.",
    "Dituntut {0}. {1} SimeTown Recycle semula tetamu hanya memperoleh XP."
  ],
  [
    "{0}, this month",
    "{0}, bulan ini"
  ],
  [
    "Sent. Sorted as {0}, {1} urgency. Staff can correct this.",
    "Dihantar. Dikategorikan sebagai {0}, tahap kecemasan {1}. Kakitangan boleh membetulkannya."
  ],
  [
    "Until {0}",
    "Hingga {0}"
  ],
  [
    "Salam! Here is your visitor pass for City of Elmina. Show the QR code at the main gate: {0}",
    "Salam! Ini pas pelawat anda untuk City of Elmina. Tunjukkan kod QR di pintu utama: {0}"
  ],
  [
    "Up to {0} day{1} for this kind of pass.",
    "Sehingga {0} hari{1} untuk jenis pas ini."
  ],
  [
    "· arrived {0}",
    "· tiba {0}"
  ],
  [
    "Name, vehicle and time only. Visitor records are deleted after {0} days.",
    "Nama, kenderaan dan masa sahaja. Rekod pelawat dipadamkan selepas {0} hari."
  ],
  [
    "Pass for {0}",
    "Pas untuk {0}"
  ],
  [
    "Visitor pass {0}",
    "Pas pelawat {0}"
  ],
  [
    "You need {0} more offer points.",
    "Anda memerlukan {0} lagi mata tawaran."
  ],
  [
    "Progress to {0}",
    "Kemajuan ke {0}"
  ],
  [
    "{0} points ({1}), in whole ringgit.",
    "{0} mata ({1}), dalam ringgit penuh."
  ],
  [
    "{0}% of one bill. You confirm each use on this phone.",
    "{0}% satu bil. Anda mengesahkan setiap penggunaan pada telefon ini."
  ],
  [
    "Points stay alive while you earn or spend at least once every {0} months. No point lasts longer than {1} months.",
    "Mata kekal aktif jika anda memperoleh atau membelanjakan sekurang-kurangnya sekali setiap {0} bulan. Tiada mata bertahan melebihi {1} bulan."
  ],
  [
    "Points earned {0}",
    "Mata diperoleh {0}"
  ],
  [
    "Member code {0}",
    "Kod ahli {0}"
  ],
  [
    "AI suggested {0} · staff set {1}",
    "AI mencadangkan {0} · kakitangan menetapkan {1}"
  ],
  [
    "{0} → {1} · water at {2}% · {3}",
    "{0} → {1} · air pada {2}% · {3}"
  ],
  [
    "{0} sent to {1}.",
    "{0} dihantar kepada {1}."
  ],
  [
    "Two signals agree: {0}.",
    "Dua isyarat sepadan: {0}."
  ],
  [
    "Only one signal shows {0}. A person must confirm.",
    "Hanya satu isyarat menunjukkan {0}. Manusia mesti mengesahkan."
  ],
  [
    "Updated {0}",
    "Dikemas kini {0}"
  ],
  [
    "Accuracy is reported only as measured here. Readings below {0}% confidence are not trusted as a signal.",
    "Ketepatan hanya dilaporkan seperti diukur di sini. Bacaan dengan keyakinan bawah {0}% tidak dipercayai sebagai isyarat."
  ],
  [
    "Tier recorded: {0} for the year.",
    "Peringkat direkodkan: {0} untuk tahun ini."
  ],
  [
    "· until {0}",
    "· hingga {0}"
  ],
  [
    "Tier for {0}",
    "Peringkat untuk {0}"
  ],
  [
    "Records the yearly fee of {0} as received.",
    "Merekodkan fi tahunan {0} sebagai diterima."
  ],
  [
    "Funded. {0} is now in the reward pool.",
    "Dibiayai. {0} kini dalam dana ganjaran."
  ],
  [
    "Closed. {0} goes back to the funder.",
    "Ditutup. {0} dipulangkan kepada pembiaya."
  ],
  [
    "{0} · {1} from {2}",
    "{0} · {1} daripada {2}"
  ],
  [
    "Reward every ({0})",
    "Ganjaran setiap ({0})"
  ],
  [
    "Worth {0}",
    "Bernilai {0}"
  ],
  [
    ", SimeTown fee {0}, running costs {1}",
    ", fi SimeTown {0}, kos operasi {1}"
  ],
  [
    "· bank statement {0}",
    "· penyata bank {0}"
  ],
  [
    "Paid {0} to {1} shop(s).",
    "Dibayar {0} kepada {1} kedai."
  ],
  [
    "· decided by {0}",
    "· diputuskan oleh {0}"
  ],
  [
    "Remove {0}",
    "Buang {0}"
  ],
  [
    "Photo of {0}",
    "Foto {0}"
  ],
  [
    "QR code for {0}",
    "Kod QR untuk {0}"
  ],
  [
    "SimeTown Recycle recycling kiosk · {0}",
    "Kiosk SimeTown Recycle semula SimeTown Recycle · {0}"
  ],
  [
    "{0} · checkpoint {1} of {2}",
    "{0} · pusat semak {1} daripada {2}"
  ],
  [
    "· last record {0}",
    "· rekod terakhir {0}"
  ],
  [
    "Patrol point {0}",
    "Titik rondaan {0}"
  ],
  [
    "{0} · pool now {1}",
    "{0} · dana kini {1}"
  ],
  [
    "{0}% of each discount used",
    "{0}% setiap diskaun digunakan"
  ],
  [
    "{0} offer points for {1} off · {2}",
    "{0} mata tawaran untuk diskaun {1} · {2}"
  ],
  [
    "You choose the terms. The only fee is {0}% of each discount actually used.",
    "Anda memilih syarat. Satu-satunya fi ialah {0}% setiap diskaun yang benar-benar digunakan."
  ],
  [
    "Refunded. Give back {0} in cash.{1}",
    "Dibayar balik. Pulangkan {0} tunai.{1}"
  ],
  [
    "{0} points went back to the customer.",
    "{0} mata dipulangkan kepada pelanggan."
  ],
  [
    ", less {0} of Shop Offer success fees still waiting",
    ", tolak {0} fi kejayaan Tawaran Kedai yang masih menunggu"
  ],
  [
    "Visitor pass code {0}",
    "Kod pas pelawat {0}"
  ],
  [
    ", through the {0}",
    ", melalui {0}"
  ],
  [
    "Run a scheduled job ({0}); bearer token",
    "Jalankan tugas berjadual ({0}); token pembawa"
  ],
  [
    "{0} asked you to be their carer",
    "{0} meminta anda menjadi penjaga mereka"
  ],
  [
    "{0}% in the drain",
    "{0}% dalam longkang"
  ],
  [
    "{0}% on the measuring post",
    "{0}% pada tiang pengukur"
  ],
  [
    "Picture unclear (confidence {0}%): not counted",
    "Gambar kabur (keyakinan {0}%): tidak dikira"
  ],
  [
    "{0} mm an hour{1}",
    "{0} mm sejam{1}"
  ],
  [
    "{0} resident report{1} of water",
    "{0} laporan penduduk{1} tentang air"
  ],
  [
    "Water is at {0}%.",
    "Air pada {0}%."
  ],
  [
    "All clear in {0}. The water is back to normal.",
    "Keadaan selamat di {0}. Air kembali normal."
  ],
  [
    "{0} in {1}.{2}",
    "{0} di {1}.{2}"
  ],
  [
    "Leave now by the safe route: {0} Go to {1}. Tap “I’m safe” when you are.",
    "Keluar sekarang ikut laluan selamat: {0} Pergi ke {1}. Ketik “Saya selamat” apabila selamat."
  ],
  [
    "Next update by {0}.",
    "Kemas kini seterusnya selewat-lewatnya {0}."
  ],
  [
    "Flood danger in {0}",
    "Bahaya banjir di {0}"
  ],
  [
    "Heads-up: flood danger in {0}",
    "Perhatian: bahaya banjir di {0}"
  ],
  [
    "Flood warning in {0}",
    "Amaran banjir di {0}"
  ],
  [
    "All clear in {0}",
    "Keadaan selamat di {0}"
  ],
  [
    "Confirm a flood {0} for {1}",
    "Sahkan {0} banjir untuk {1}"
  ],
  [
    "Only one signal so far. {0}",
    "Satu isyarat sahaja setakat ini. {0}"
  ],
  [
    "A flood warning for {0} is waiting",
    "Amaran banjir untuk {0} sedang menunggu"
  ],
  [
    "Flood update for {0}",
    "Kemas kini banjir untuk {0}"
  ],
  [
    "Help needed in {0}",
    "Bantuan diperlukan di {0}"
  ],
  [
    "{0} asked for help during the flood alert.",
    "{0} meminta bantuan semasa amaran banjir."
  ],
  [
    "Campaign funded · {0}",
    "Kempen dibiayai · {0}"
  ],
  [
    "Unused pool refunded · {0}",
    "Dana tidak digunakan dipulangkan · {0}"
  ],
  [
    "Another sponsor already holds the {0} category at this tier.",
    "Penaja lain sudah memegang kategori {0} pada peringkat ini."
  ],
  [
    "{0} tier · {1}",
    "Peringkat {0} · {1}"
  ],
  [
    "Someone responded to \"{0}\"",
    "Seseorang membalas \"{0}\""
  ],
  [
    "Your post \"{0}\" was removed",
    "Siaran anda \"{0}\" dibuang"
  ],
  [
    "{0} asked to create an admin account for {1}.",
    "{0} meminta akaun pentadbir dicipta untuk {1}."
  ],
  [
    "{0} asked for a new set-password link for {1}.",
    "{0} meminta pautan tetapan kata laluan baharu untuk {1}."
  ],
  [
    "RM {0}",
    "RM {0}"
  ],
  [
    "Bil {0} / {1} Bill",
    "Bil {0} / {1} Bill"
  ],
  [
    "The weight does not match {0}.",
    "Berat tidak sepadan dengan {0}."
  ],
  [
    "This bin is for {0} only.",
    "Tong ini untuk {0} sahaja."
  ],
  // native review
  [
    "Test entry recorded at {0}",
    "Entri ujian direkodkan di {0}"
  ],
  [
    "Recycling recorded at {0}",
    "SimeTown Recycle semula direkodkan di {0}"
  ],
  [
    "{0} kg recorded. You have reached today’s recycling limit for rewards.",
    "{0} kg direkodkan. Anda mencapai had ganjaran SimeTown Recycle semula hari ini."
  ],
  [
    "{0} kg recorded: +{1} XP{2}{3}.",
    "{0} kg direkodkan: +{1} XP{2}{3}."
  ],
  [
    ", +{0} offer points",
    ", +{0} mata tawaran"
  ],
  [
    "Guest recycling can be claimed for {0} days only.",
    "SimeTown Recycle semula tetamu hanya boleh dituntut selama {0} hari."
  ],
  [
    "{0} is {1}",
    "{0} kini {1}"
  ],
  [
    "Reward pool top-up · {0}",
    "Tambah nilai dana ganjaran · {0}"
  ],
  [
    "Weekly payment · {0}",
    "Bayaran mingguan · {0}"
  ],
  [
    "Float is {0} sen but owes {1} sen.",
    "Dana sandaran {0} sen tetapi tanggungan {1} sen."
  ],
  [
    "Point batches total {0} but wallets total {1}.",
    "Jumlah kelompok mata {0} tetapi jumlah dompet {1}."
  ],
  [
    "{0} account balance(s) do not match their entries.",
    "{0} baki akaun tidak sepadan dengan rekodnya."
  ],
  [
    "{0} transaction(s) do not balance.",
    "{0} transaksi tidak seimbang."
  ],
  [
    "Bank statement shows {0} sen; the ledger shows {1} sen.",
    "Penyata bank menunjukkan {0} sen; lejar menunjukkan {1} sen."
  ],
  [
    "Ledger account {0} is missing for {1}",
    "Akaun lejar {0} tiada untuk {1}"
  ],
  [
    "Ledger account {0} is missing",
    "Akaun lejar {0} tiada"
  ],
  [
    "Point lots for user {0} are {1} short of the wallet balance",
    "Kelompok mata pengguna {0} kurang {1} daripada baki dompet"
  ],
  [
    "{0} points have expired",
    "{0} mata telah luput"
  ],
  [
    "{0} points expire within {1} days",
    "{0} mata luput dalam {1} hari"
  ],
  [
    "Use them at any member shop before {0}, or they will expire.",
    "Gunakan di kedai ahli sebelum {0} atau ia luput."
  ],
  [
    "{0} is approved",
    "{0} diluluskan"
  ],
  [
    "The smallest amount you can use is {0} points.",
    "Jumlah minimum yang boleh digunakan ialah {0} mata."
  ],
  [
    "Points are used in steps of {0} (whole ringgit).",
    "Mata digunakan dalam gandaan {0} (ringgit penuh)."
  ],
  [
    "Points can cover at most {0}% of a bill: {1} points here.",
    "Mata boleh membayar maksimum {0}% bil: {1} mata di sini."
  ],
  [
    "{0} · funded by the shop",
    "{0} · dibiayai oleh kedai"
  ],
  [
    "This offer needs a bill of at least RM{0}.",
    "Tawaran ini memerlukan bil sekurang-kurangnya RM{0}."
  ],
  [
    "the offer “{0}”",
    "tawaran “{0}”"
  ],
  [
    "Confirm {0} at {1}",
    "Sahkan {0} di {1}"
  ],
  [
    "Spent at {0}",
    "Dibelanjakan di {0}"
  ],
  [
    "Refund from {0}",
    "Bayaran balik daripada {0}"
  ],
  [
    "Refund at {0}",
    "Bayaran balik di {0}"
  ],
  [
    "{0} points are back in your wallet.",
    "{0} mata kembali dalam dompet anda."
  ],
  [
    "Shop Offer success fee · {0}",
    "Fi kejayaan Tawaran Kedai · {0}"
  ],
  [
    "Your report is {0}",
    "Laporan anda {0}"
  ],
  [
    "Choose a day in the next {0} days.",
    "Pilih hari dalam {0} hari akan datang."
  ],
  [
    "A {0} pass can last at most {1} day{2}.",
    "Pas {0} boleh bertahan maksimum {1} hari{2}."
  ],
  [
    "Help needed at {0}.",
    "Bantuan diperlukan di {0}."
  ],
  [
    "{0} arrived at {1}",
    "{0} tiba di {1}"
  ],
  [
    "{0} is at the main gate",
    "{0} berada di pintu utama"
  ],
  [
    "Check the drain grilles on the way to {0}, if it is safe to do so.",
    "Semak jeriji longkang dalam perjalanan ke {0}, jika selamat."
  ],
  [
    "Open the assembly point: {0}.",
    "Buka tempat berkumpul: {0}."
  ],
  [
    "Direct cars and walkers along the safe route: {0}",
    "Arahkan kereta dan pejalan kaki ikut laluan selamat: {0}"
  ],
  [
    "Not counted: {0}",
    "Tidak dikira: {0}"
  ],
  [
    "Claim code {0}",
    "Kod tuntutan {0}"
  ],
  [
    "{0} on the waiting list",
    "{0} dalam senarai menunggu"
  ],
  [
    "Still on the waiting list for {0}",
    "Masih dalam senarai menunggu untuk {0}"
  ],
  [
    "AI · {0}",
    "AI · {0}"
  ],
  [
    "Sources (checked {0})",
    "Sumber (disemak {0})"
  ],
  [
    "Answers are written by AI ({0}) from your own SimeTown data and checked facts, and can be wrong: check anything important. Your question and the details needed to answer it are sent to {1}. In danger, call 999. It never decides a safety alert.",
    "Jawapan ditulis oleh AI ({0}) berdasarkan data SimeTown anda dan fakta yang telah disemak, dan mungkin salah: semak perkara penting. Soalan anda dan butiran yang diperlukan untuk menjawabnya dihantar kepada {1}. Jika dalam bahaya, hubungi 999. Ia tidak pernah memutuskan amaran keselamatan."
  ],
  [
    "A {0} pass can last at most {1} hours.",
    "Pas {0} boleh bertahan paling lama {1} jam."
  ],
  [
    "{0} drop-offs",
    "{0} hantaran"
  ],
  [
    "{0} confirmed",
    "{0} disahkan"
  ],
  [
    "Hello, {0}!",
    "Helo, {0}!"
  ],
  [
    "{0} points",
    "{0} mata"
  ],
  [
    "{0} verified",
    "{0} disahkan"
  ],
  [
    "· {0} loop{1} complete",
    "· {0} laluan selesai{1}"
  ],
  [
    "Notifications, {0} unread",
    "Pemberitahuan, {0} belum dibaca"
  ],
  [
    "Confirmed: {0}",
    "Disahkan: {0}"
  ],
  [
    "Kitar recycling kiosk · {0}",
    "Kiosk kitar semula Kitar · {0}"
  ],
  [
    "Your passes: {0}. To make one, try “Make a visitor pass for Ali tomorrow”.",
    "Pas anda: {0}. Untuk membuat pas, cuba “Buat pas pelawat untuk Ali esok”."
  ],
  [
    "You have {0} points, worth {1}: {2} cash-backed and {3} offer points. You have saved {4} so far.",
    "Anda mempunyai {0} mata, bernilai {1}: {2} disandarkan tunai dan {3} mata tawaran. Anda telah berjimat {4} setakat ini."
  ],
  [
    "You can recycle at {0}. Each drop-off earns Impact XP.",
    "Anda boleh kitar semula di {0}. Setiap hantaran memberi XP Impak."
  ],
  [
    "If anyone is in danger, call 999 now. {0}",
    "Jika sesiapa dalam bahaya, hubungi 999 sekarang. {0}"
  ],
  [
    "That did not work: {0}",
    "Itu tidak berjaya: {0}"
  ],
  [
    "One visit pass for {0}, from {1} for {2} hours.",
    "Pas satu lawatan untuk {0}, dari {1} selama {2} jam."
  ],
  [
    "Delivery pass for {0}, from {1} for {2} hours.",
    "Pas penghantaran untuk {0}, dari {1} selama {2} jam."
  ],
  [
    "Event guest pass for {0}, from {1} for {2} hours.",
    "Pas tetamu majlis untuk {0}, dari {1} selama {2} jam."
  ],
  [
    "Send this question to the township office: “{0}”",
    "Hantar soalan ini kepada pejabat perbandaran: “{0}”"
  ],
  [
    "Done. {0} Pass code {1}. Share the link below with {2}; you can make a new link in Tamu any time.",
    "Selesai. {0} Kod pas {1}. Kongsi pautan di bawah dengan {2}; anda boleh membuat pautan baharu dalam Tamu bila-bila masa."
  ],
  [
    "{0} is normal: the water is at {1}%. I only repeat the official status; I never raise or end an alert.",
    "{0} normal: paras air pada {1}%. Saya hanya mengulang status rasmi; saya tidak pernah menaikkan atau menamatkan amaran."
  ],
  [
    "{0} is under a {1} alert, with water at {2}%. {3} If anyone is in danger, call 999.",
    "{0} berada dalam status {1}, dengan paras air pada {2}%. {3} Jika sesiapa dalam bahaya, hubungi 999."
  ],
  ...homeServicesTemplates,
  ...komunitiTemplates,
  ["Reported {0}", "Dilaporkan {0}"],
  ["{0} affected", "{0} terjejas"],
  ["{0} residents affected", "{0} penduduk terjejas"],
  ["Assigned to {0}", "Diserahkan kepada {0}"],
  ["Target: {0}", "Sasaran: {0}"],
  ["Expected fixed by {0}", "Dijangka dibaiki menjelang {0}"],
  ["{0}% have a target date", "{0}% mempunyai tarikh sasaran"],
  ["Checked within {0} h · {1} fixed in 90 days", "Disemak dalam {0} j · {1} dibaiki dalam 90 hari"],
  ["{0} open", "{0} terbuka"],
  ["{0} fixed", "{0} dibaiki"],
  ["median {0} days", "median {0} hari"],
  ["{0} open requests", "{0} permintaan terbuka"],
  ["Parcel from {0}", "Bungkusan daripada {0}"],
  ["Waiting on shelf {0} at the guardhouse", "Menunggu di rak {0} di pondok pengawal"],
  ["Recycling collection by {0}", "Kutipan kitar semula oleh {0}"],
  ["From {0}", "Daripada {0}"],
  ["Arrived {0}", "Tiba {0}"],
  ["Shelf {0}", "Rak {0}"],
  ["shelf {0}", "rak {0}"],
  ["Logged {0}", "Direkodkan {0}"],
  ["Logged for {0}. The household has the collection code.", "Direkodkan untuk {0}. Isi rumah mempunyai kod tuntutan."],
  ["Logged for {0}. Nobody there has the app: call the house.", "Direkodkan untuk {0}. Tiada sesiapa di sana menggunakan aplikasi: hubungi rumah itu."],
  ["{0} waiting 3 days or more", "{0} menunggu 3 hari atau lebih"],
  ["{0}% collected within a day", "{0}% dituntut dalam sehari"],
  ["{0} returned to the courier", "{0} dipulangkan kepada kurier"],
  ["{0}% of collections, last 30 days", "{0}% daripada tuntutan, 30 hari lalu"],
  ["Handed over {0}", "Diserahkan {0}"],
  ["queried {0}", "dipersoalkan {0}"],
  ["{0}% full", "{0}% penuh"],
  ["{0} min saved", "{0} min dijimatkan"],
  ["Gate pass {0} is ready in Tamu.", "Pas pintu pagar {0} sedia dalam Tamu."],
  ["{0} collected", "{0} dikutip"],
  ["{0} collections · {1}", "{0} kutipan · {1}"],
  ["{0}{1}% on last month", "{0}{1}% berbanding bulan lalu"],
  ["Confirmed. Gate pass {0} made for the household.", "Disahkan. Pas pintu pagar {0} dibuat untuk isi rumah."],
  ["{0} m²", "{0} m²"],
  ["Update {0}", "Kemas kini {0}"],
  ["{0} days", "{0} hari"],
  ["{0} does not take {1}.", "{0} tidak menerima {1}."],
  ["Choose a day from tomorrow up to {0} days ahead.", "Pilih hari dari esok hingga {0} hari ke hadapan."],
  ["Your home can have up to {0} collections booked at a time.", "Rumah anda boleh menempah sehingga {0} kutipan pada satu masa."],
  ["Collector {0}, {1}: {2}", "Pengutip {0}, {1}: {2}"],
  ["{0} comes on {1}. The gate has their pass.", "{0} datang pada {1}. Pintu pagar mempunyai pas mereka."],
  ["{0} took {1} kg.", "{0} mengambil {1} kg."],
  ["{0} could not come on {1}. Please book another day.", "{0} tidak dapat datang pada {1}. Sila tempah hari lain."],
  ["Parcel from {0} at the guardhouse", "Bungkusan daripada {0} di pondok pengawal"],
  ["Shelf {0}. Show code {1} to collect it.", "Rak {0}. Tunjukkan kod {1} untuk menuntutnya."],
  ["Parcel from {0} collected", "Bungkusan daripada {0} telah dituntut"],
  ["Collected by {0}. Not you? Tell us in SimeTown.", "Dituntut oleh {0}. Bukan anda? Beritahu kami dalam SimeTown."],
  ["Parcel from {0} returned to the courier", "Bungkusan daripada {0} dipulangkan kepada kurier"],
  ["{0}, shelf {1}: the household says it never reached them.", "{0}, rak {1}: isi rumah berkata ia tidak sampai kepada mereka."],
  ["Your parcel from {0} is still waiting", "Bungkusan anda daripada {0} masih menunggu"],
  ["Shelf {0} at the guardhouse. Please collect it soon.", "Rak {0} di pondok pengawal. Sila tuntut segera."],
  ["{0} will fix it", "{0} akan membaikinya"],
  ["{0}: expected by {1}.", "{0}: dijangka siap menjelang {1}."],
  ["door {0}", "pintu {0}"],
  ["{0} of {1} held", "{0} daripada {1} disimpan"],
  ["applied {0}", "memohon {0}"],
  ["Stations for {0}", "Stesen untuk {0}"],
  ["Tomorrow, of {0}", "Esok, daripada {0}"],
  ["{0} occupied of {1}", "{0} berisi daripada {1}"],
  ["code {0}", "kod {0}"],
  ["{0} occupied, {1} reserved, {2} available, {3} faulty, {4} disabled", "{0} berisi, {1} ditempah, {2} kosong, {3} rosak, {4} tidak digunakan"],
  ["Overdue: {0} · to relocate: {1}", "Lewat tempoh: {0} · untuk dipindahkan: {1}"],
  ["Collected after {0} h on average", "Dituntut selepas purata {0} j"],
  ["size {0}", "saiz {0}"],
  ["Created {0}", "Dicipta {0}"],
  ["Case {0} created.", "Kes {0} dicipta."],
  ["{0} is ready for investigation under Smart locker cases.", "{0} sedia untuk disiasat di bawah Kes lokar pintar."],
  ["{0} active moves", "{0} pemindahan aktif"],
  ["{0} registered stations", "{0} stesen berdaftar"],
  ["{0} clear", "{0} tiada tugasan"],
  ["{0} matching", "{0} sepadan"],
  ["to {0}", "ke {0}"],
  ["Simulator: {0}", "Simulator: {0}"],
  ["Station code {0}", "Kod stesen {0}"],
  ["Door {0}", "Pintu {0}"],
  ["QR code {0}", "Kod QR {0}"],
  ["{0} compartments", "{0} petak"],
  ["last heard {0}", "kali terakhir dihubungi {0}"],
  ["{0}: {1} free", "{0}: {1} kosong"],
  ["{0} free", "{0} kosong"],
  ["Size {0}", "Saiz {0}"],
  ["Door {0} is shut with the parcel inside. The household has been told.", "Pintu {0} ditutup dengan bungkusan di dalam. Isi rumah telah dimaklumkan."],
  ["Door {0} is open", "Pintu {0} terbuka"],
  ["{0} Nothing was delivered; the township office has been told.", "{0} Tiada apa-apa dihantar; pejabat perbandaran telah dimaklumkan."],
  ["Now at {0}", "Kini di {0}"],
  ["by {0}", "menjelang {0}"],
  ["Door {0} is open. Take your parcel and shut the door.", "Pintu {0} terbuka. Ambil bungkusan anda dan tutup pintu."],
  ["Need more time? Add {0} hours", "Perlukan lebih masa? Tambah {0} jam"],
  ["Your deadline moves by {0} hours.", "Tarikh akhir anda dilanjutkan {0} jam."],
  ["You can do this up to {0} times per parcel.", "Anda boleh melakukannya sehingga {0} kali bagi setiap bungkusan."],
  ["A storage fee of {0} applies, as set by the township. SimeTown does not take payment, and the fee never stops you collecting your parcel.", "Fi simpanan {0} dikenakan, seperti yang ditetapkan oleh perbandaran. SimeTown tidak menerima bayaran, dan fi itu tidak pernah menghalang anda menuntut bungkusan."],
  ["{0} d {1} h left to collect", "Tinggal {0} hari {1} j untuk menuntut"],
  ["{0} h {1} min left to collect", "Tinggal {0} j {1} min untuk menuntut"],
  ["Collect by {0}", "Tuntut menjelang {0}"],
  ["Keypad accepted: door {0} opens.", "Papan kekunci diterima: pintu {0} dibuka."],
  ["Take it to {0} and hand it to staff. It counts as delivered once they receive it.", "Bawa ke {0} dan serahkan kepada kakitangan. Ia dikira dihantar sebaik mereka menerimanya."],
  ["Door {0} is opening.", "Pintu {0} sedang dibuka."],
  ["{0} is {1}% full", "{0} {1}% penuh"],
  ["{0} is full", "{0} penuh"],
  ["{0}: {1} faulty compartment{2}", "{0}: {1} petak rosak{2}"],
  ["{0}: {1} parcel{2} to relocate", "{0}: {1} bungkusan{2} untuk dipindahkan"],
  ["Likely short of about {0} compartments tomorrow: open the overflow counter early and relocate overdue parcels first.", "Mungkin kekurangan kira-kira {0} petak esok: buka kaunter limpahan awal dan pindahkan bungkusan lewat tempoh dahulu."],
  ["Relocate the {0} overdue parcel{1} to free compartments.", "Pindahkan {0} bungkusan{1} lewat tempoh untuk mengosongkan petak."],
  ["Repair or re-enable {0} compartment{1} out of use.", "Baiki atau aktifkan semula {0} petak{1} yang tidak digunakan."],
  ["Average for this weekday over the last {0} week{1}; {2}% of parcels are collected within a day.", "Purata bagi hari ini dalam {0} minggu{1} lalu; {2}% bungkusan dituntut dalam sehari."],
  ["Only {0} day{1} of history: overall daily average used, so treat this as rough.", "Hanya {0} hari{1} sejarah: purata harian keseluruhan digunakan, jadi anggap ini sebagai anggaran kasar."],
  ["This parcel is {0} and cannot move to “{1}”.", "Bungkusan ini {0} dan tidak boleh berpindah ke “{1}”."],
  ["{0} applied for a courier account.", "{0} memohon akaun kurier."],
  ["You can deliver to {0} locker station{1}.", "Anda boleh menghantar ke {0} stesen lokar{1}."],
  ["This parcel is at {0}. Scan the QR code on that station.", "Bungkusan ini di {0}. Imbas kod QR pada stesen itu."],
  ["{0} was not collected from the counter in time.", "{0} tidak dituntut dari kaunter dalam masa."],
  ["{0} shown", "{0} dipaparkan"],
  ["{0} of {1} parcels", "{0} daripada {1} bungkusan"],
  ["{0} of {1} parcels stored", "{0} daripada {1} bungkusan disimpan"],
  ["Stored {0}", "Disimpan {0}"],
  ["{0} stored", "{0} disimpan"],
  ["{0} incoming", "{0} akan masuk"],
  ["{0} capacity", "Kapasiti {0}"],
  ["{0} of {1} committed", "{0} daripada {1} diperuntukkan"],
  ["{0} parcels awaiting collection", "{0} bungkusan menunggu pengambilan"],
  ["{0} / {1} occupied", "{0} / {1} digunakan"],
  ["{0} parcels awaiting transfer", "{0} bungkusan menunggu pemindahan"],
  ["{0} locker stations", "{0} stesen lokar"],
  ["{0} is full. Choose another location.", "{0} sudah penuh. Pilih lokasi lain."],
  ["{0} still has stored or incoming parcels. Clear them before closing the location.", "{0} masih mempunyai bungkusan disimpan atau akan masuk. Kosongkannya sebelum menutup lokasi."],
  ["Not collected within {0} hours", "Tidak dituntut dalam {0} jam"],
  ["First reminder sent to {0} household member(s)", "Peringatan pertama dihantar kepada {0} ahli isi rumah"],
  ["Final reminder sent to {0} household member(s)", "Peringatan terakhir dihantar kepada {0} ahli isi rumah"],
  ["{0}, door {1}. Please collect it by {2}.", "{0}, pintu {1}. Sila tuntut menjelang {2}."],
  ["{0}, door {1}. After {2} it moves to the parcel counter.", "{0}, pintu {1}. Selepas {2} ia dipindahkan ke kaunter bungkusan."],
  ["{0}, door {1}: past its collection deadline.", "{0}, pintu {1}: melepasi tarikh akhir tuntutan."],
  ["It can still be collected from {0} until staff move it. We will tell you where it is.", "Ia masih boleh dituntut dari {0} sehingga kakitangan memindahkannya. Kami akan memberitahu anda di mana ia berada."],
  ["Relocation to {0} started", "Pemindahan ke {0} dimulakan"],
  ["Moved to {0}", "Dipindahkan ke {0}"],
  ["Your parcel is now at {0}", "Bungkusan anda kini di {0}"],
  ["{0}. Open {1}. {2} Collect by {3}. Your pickup code has changed: see Parcels.", "{0}. Dibuka {1}. {2} Tuntut menjelang {3}. Kod tuntutan anda telah berubah: lihat Bungkusan."],
  ["Inspect: {0}", "Periksa: {0}"],
  ["{0} went back to the courier. Contact them to arrange delivery again.", "{0} telah dipulangkan kepada kurier. Hubungi mereka untuk mengatur penghantaran semula."],
  ["Resolved: {0}", "Diselesaikan: {0}"],
  ["Your parcel is at {0}", "Bungkusan anda di {0}"],
  ["The gateway answered {0}.", "Get laluan menjawab {0}."],
  ["The gateway could not be reached: {0}", "Get laluan tidak dapat dihubungi: {0}"],
  ["Deposit stopped: {0}", "Kemasukan dihentikan: {0}"],
  ["Door did not open for collection: {0}", "Pintu tidak terbuka untuk tuntutan: {0}"],
  ["Door did not open for relocation: {0}", "Pintu tidak terbuka untuk pemindahan: {0}"],
  ["Locker door problem at {0}", "Masalah pintu lokar di {0}"],
  ["Door {0}: {1}", "Pintu {0}: {1}"],
  ["Door {0} opened without an unlock", "Pintu {0} terbuka tanpa buka kunci"],
  ["{0}: check the locker.", "{0}: periksa lokar."],
  ["Deposited in door {0}", "Dimasukkan ke pintu {0}"],
  ["Door {0}. Collect by {1}: open Parcels in SimeTown for your QR code and PIN.", "Pintu {0}. Tuntut menjelang {1}: buka Bungkusan dalam SimeTown untuk kod QR dan PIN anda."],
  ["Collected from door {0}. Not you? Tell the township office.", "Dituntut dari pintu {0}. Bukan anda? Beritahu pejabat perbandaran."],
  ["Registered by {0} at {1}", "Didaftarkan oleh {0} di {1}"],
  ["{0} has no {1} compartment free", "{0} tiada petak {1} yang kosong"],
  ["No {0} compartment free at {1}", "Tiada petak {0} kosong di {1}"],
  ["Door {0} reserved", "Pintu {0} ditempah"],
  ["Courier chose {0} instead", "Kurier memilih {0}"],
  ["Courier is taking it to {0}", "Kurier membawanya ke {0}"],
  ["Received from the courier at {0}", "Diterima daripada kurier di {0}"],
  ["Parcel waiting at {0}", "Bungkusan menunggu di {0}"],
  ["{0}. Open {1}. Show your pickup code from Parcels in SimeTown.", "{0}. Dibuka {1}. Tunjukkan kod tuntutan anda dari Bungkusan dalam SimeTown."],
  ["Delivery not made: {0}", "Penghantaran tidak dibuat: {0}"],
  ["Parcel from {0} in {1}", "Bungkusan daripada {0} di {1}"],
  ["Handed over at {0}; ID checked", "Diserahkan di {0}; ID disemak"],
  ["Handed over at {0}. Not you? Tell the township office.", "Diserahkan di {0}. Bukan anda? Beritahu pejabat perbandaran."],
  ["Collection time extended by {0} hours{1}", "Masa tuntutan dilanjutkan {0} jam{1}"],
  ["Courier chose another station", "Kurier memilih stesen lain"],
  ["{0} is full. Choose another storage place.", "{0} penuh. Pilih tempat simpanan lain."],
  ["{0}: keypad locked after too many wrong codes", "{0}: papan kekunci dikunci selepas terlalu banyak kod salah"],
  ["Keypad locked since {0}", "Papan kekunci dikunci sejak {0}"],
  ["Wrong pickup codes in the last day: {0}", "Kod tuntutan salah dalam sehari lalu: {0}"],
  ["{0}: {1} wrong pickup codes in a day, so its keypad is locked. Residents can still open their doors from the app. Unlock it under Smart lockers once it is safe.", "{0}: {1} kod tuntutan salah dalam sehari, jadi papan kekuncinya dikunci. Penduduk masih boleh membuka pintu mereka daripada aplikasi. Buka kuncinya di bawah Lokar pintar apabila selamat."],
  ["{0}: {1} wrong pickup codes in {2} minutes. It is refusing codes for a while.", "{0}: {1} kod tuntutan salah dalam {2} minit. Ia menolak kod buat seketika."],
  ["{0} residents at the station have asked for it to be unlocked.", "{0} penduduk di stesen telah meminta ia dibuka kunci."],
  ["{0}: keypad locked, and {1} resident{2} asked for it to be unlocked", "{0}: papan kekunci dikunci, dan {1} penduduk{2} meminta ia dibuka kunci"],
  ["{0} ({1}): a resident asked for the keypad to be unlocked. They can still open their door from the app. Unlock it under Smart lockers once the station is checked.", "{0} ({1}): seorang penduduk meminta papan kekunci dibuka kunci. Mereka masih boleh membuka pintu mereka daripada aplikasi. Buka kuncinya di bawah Lokar pintar selepas stesen diperiksa."],
  ["Stations: {0}", "Stesen: {0}"],
  ["Agreement until {0}", "Perjanjian hingga {0}"],
  ["Shipment checks answering (last {0})", "Semakan penghantaran dijawab (terakhir {0})"],
  ["Shipment checks failing: {0}", "Semakan penghantaran gagal: {0}"],
  ["{0}: integration", "{0}: integrasi"],
  ["Add a representative for {0}", "Tambah wakil untuk {0}"],
  ["{0} times", "{0} kali"],
  ["last {0}", "terakhir {0}"],
  ["Resolution: {0}", "Penyelesaian: {0}"],
  ["Asked by {0}, {1}", "Diminta oleh {0}, {1}"],
  ["decided by {0}", "diputuskan oleh {0}"],
  ["{0} failed checks in 24 h", "{0} semakan gagal dalam 24 jam"],
  ["{0} attempts, last {1}", "{0} cubaan, terakhir {1}"],
  ["delivered {0}", "dihantar {0}"],
  ["{0} assurance", "jaminan {0}"],
  ["You manage {0}’s couriers", "Anda mengurus kurier {0}"],
  ["Reconfirm each courier at least every {0} days, or their access pauses until you do.", "Sahkan semula setiap kurier sekurang-kurangnya setiap {0} hari, atau akses mereka dijeda sehingga anda berbuat demikian."],
  ["signed in {0}", "log masuk {0}"],
  ["{0} refused scans", "{0} imbasan ditolak"],
  ["Barcode for tracking number {0}", "Kod bar untuk nombor penjejakan {0}"],
  ["Weight: {0} kg", "Berat: {0} kg"],
  ["Size: {0} × {1} × {2} mm", "Saiz: {0} × {1} × {2} mm"],
  ["Carried by: {0}", "Dibawa oleh: {0}"],
  ["Shows: {0}", "Menunjukkan: {0}"],
  ["{0} (simulated)", "{0} (simulasi)"],
  ["Simulated authenticator: {0}", "Pengesah simulasi: {0}"],
  ["{0} (simulated sign-in)", "{0} (log masuk simulasi)"],
  ["The sign-in could not be verified: {0}", "Log masuk tidak dapat disahkan: {0}"],
  ["{0} is not authorised at any township at the moment.", "{0} tidak diberi kuasa di mana-mana perbandaran buat masa ini."],
  ["{0} changed your access to the township’s lockers.", "{0} mengubah akses anda ke lokar perbandaran."],
  ["{0} has reactivated your access to the township’s lockers.", "{0} telah mengaktifkan semula akses anda ke lokar perbandaran."],
  ["{0} has suspended your access to the township’s lockers.", "{0} telah menggantung akses anda ke lokar perbandaran."],
  ["{0} was paused because nobody reconfirmed them in {1} days.", "{0} dijeda kerana tiada sesiapa mengesahkan mereka semula dalam {1} hari."],
  ["{0}: agreement ended", "{0}: perjanjian tamat"],
  ["{0}: agreement ends soon", "{0}: perjanjian akan tamat tidak lama lagi"],
  ["The agreement ends on {0}. Renew it to keep its couriers working.", "Perjanjian tamat pada {0}. Perbaharuinya supaya kuriernya terus bekerja."],
  ["{0} asked to open door for {1}: {2}", "{0} meminta untuk membuka pintu bagi {1}: {2}"],
  ["Approve {0}", "Luluskan {0}"],
  ["Suspend {0}", "Gantung {0}"],
  ["Revoke {0}", "Batalkan {0}"],
  ["{0} · {1} (suspended by the company)", "{0} · {1} (digantung oleh syarikat)"],
  ["Simulated reference {0}", "Rujukan simulasi {0}"],
  ["Reference {0}", "Rujukan {0}"],
  ["You can reopen a report within {0} days of its outcome. The township office’s admins are told.", "Anda boleh membuka semula laporan dalam masa {0} hari selepas keputusannya. Pentadbir pejabat perbandaran akan dimaklumkan."],
  ["Last checked {0}.", "Kali terakhir disemak {0}."],
  ["{0} being investigated · {1} waiting", "{0} sedang disiasat · {1} menunggu"],
  ["{0} assigned to you", "{0} diberikan kepada anda"],
  ["{0} critical", "{0} kritikal"],
  ["{0} sent to courier companies, not counted", "{0} dihantar kepada syarikat kurier, tidak dikira"],
  ["{0} resolved in the last 30 days", "{0} diselesaikan dalam 30 hari lalu"],
  ["opened {0}", "dibuka {0}"],
  ["updated {0}", "dikemas kini {0}"],
  ["Waiting for {0}", "Menunggu {0}"],
  ["Handled in Lapor's own queue and shown here for one view of everything open: {0} open, {1} past their target date.", "Dikendalikan dalam baris gilir Lapor sendiri dan dipaparkan di sini untuk satu paparan semua yang terbuka: {0} terbuka, {1} melepasi tarikh sasaran."],
  ["Handled by {0}", "Dikendalikan oleh {0}"],
  ["In their words: {0}", "Dalam kata-kata mereka: {0}"],
  ["Report {0} received.", "Laporan {0} diterima."],
  ["You already reported this: {0}.", "Anda sudah melaporkan ini: {0}."],
  ["This is for {0} to handle", "Ini untuk {0} kendalikan"],
  ["Sent to the simulated company. Its reference: {0}", "Dihantar kepada syarikat simulasi. Rujukannya: {0}"],
  ["This case is “{0}” and cannot move to “{1}”.", "Kes ini “{0}” dan tidak boleh berpindah ke “{1}”."],
  ["Case for you: {0}", "Kes untuk anda: {0}"],
  ["A report can be reopened within {0} days of its outcome. Please report it again.", "Laporan boleh dibuka semula dalam masa {0} hari selepas keputusannya. Sila laporkan semula."],
  ["Reopened: {0}", "Dibuka semula: {0}"],
  ["{0}: the resolution target must come after the assignment target.", "{0}: sasaran penyelesaian mesti selepas sasaran pengambilan."],
  ["{0}’s own system is not connected to SimeTown. Contact the company through its support channel.", "Sistem {0} sendiri tidak disambungkan dengan SimeTown. Hubungi syarikat itu melalui saluran sokongannya."],
  ["Checked: {0} escalated, {1} closed.", "Disemak: {0} dinaikkan, {1} ditutup."],
  ["Resolve within {0}{1} min", "Selesaikan dalam {0}{1} minit"],
  ["Take within {0}{1} min", "Ambil dalam {0}{1} minit"],
  ["Report received: {0}", "Laporan diterima: {0}"],
  ["Critical case: {0}", "Kes kritikal: {0}"],
  ["Urgent case: {0}", "Kes segera: {0}"],
  ["Escalated: {0}", "Dinaikkan: {0}"],
  ["Update on your report {0}", "Kemas kini laporan anda {0}"],
  ["We need a few more details ({0})", "Kami perlukan sedikit butiran lagi ({0})"],
  ["Report {0}: {1}", "Laporan {0}: {1}"],
  ["Report {0} reopened", "Laporan {0} dibuka semula"],
  ["Reply on {0}", "Balasan untuk {0}"],
  ["{0} is handling this case.", "{0} mengendalikan kes ini."],
  ["Assigned to {0}.", "Ditugaskan kepada {0}."],
  ["Moved to {0}: {1}", "Dipindahkan kepada {0}: {1}"],
  ["{0} asked for an admin: {1}", "{0} meminta pentadbir: {1}"],
  ["The resident disputes the outcome: {0}", "Penduduk mempertikaikan keputusan: {0}"],
  ["Nobody has taken this {0}-priority case since it was {1}.", "Tiada sesiapa mengambil kes keutamaan {0} ini sejak ia {1}."],
  ["It is here: {0}{1}. Your pickup code is on the Parcels page.", "Ia sudah sampai: {0}{1}. Kod tuntutan anda ada di halaman Bungkusan."],
  ["It is at the guardhouse, shelf {0}. Your collection code is on the Parcels page.", "Ia di pondok pengawal, rak {0}. Kod tuntutan anda ada di halaman Bungkusan."],
  ["All {0} open smart locker cases", "Semua {0} kes lokar pintar yang terbuka"],
  ["{0} overdue", "{0} melepasi tarikh akhir"],
  ["{0} nobody has taken", "{0} belum diambil sesiapa"],
  ["Requested by {0}, {1}", "Diminta oleh {0}, {1}"],
  ["expires {0}", "tamat {0}"],
  ["{0} parcels selected", "{0} bungkusan dipilih"],
  ["{0} not taken yet", "{0} belum diambil"],
  ["{0} need attention", "{0} perlu perhatian"],
  ["There is already an access request for {0}.", "Permintaan akses untuk {0} sudah wujud."],
  ["{0} requested controlled access to {1} occupied doors at {2}.", "{0} meminta akses terkawal kepada {1} pintu berisi di {2}."],
  ["{0} ms", "{0} milisaat"],
  // Insights
  ["{0} drop-offs at kiosks and machines", "{0} serahan di kiosk dan mesin"],
  ["{0} loops completed", "{0} laluan diselesaikan"],
  ["{0} open access issues", "{0} isu akses terbuka"],
  ["No pledge, no points: offer-backed points given this month ({0}) can never pass what {1} shop offer(s) promised ({2}).", "Tiada ikrar, tiada mata: mata bertawaran yang diberi bulan ini ({0}) tidak boleh melebihi apa yang dijanjikan oleh {1} tawaran kedai ({2})."],
  // Akses+ last, so an existing template always matches first.
  ...aksesTemplates,
  ...shopsTemplates,
  ...collectionsTemplates,
];
