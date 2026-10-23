/** Bahasa Malaysia for account emails (welcome, password reset) and the forgotten-password screens. */
export const accountMalay: Record<string, string> = {
  // Forgotten password screens
  'Forgot your password?': 'Lupa kata laluan?',
  'Reset your password': 'Tetapkan semula kata laluan anda',
  'Enter the email you use for SimeTown. We will email you a link to choose a new password.':
    'Masukkan e-mel yang anda gunakan untuk SimeTown. Kami akan menghantar pautan melalui e-mel untuk anda memilih kata laluan baharu.',
  'Remembered it?': 'Sudah ingat?',
  'Send reset link': 'Hantar pautan tetapan semula',
  'Check your email': 'Semak e-mel anda',
  'If an account uses this email, a link to reset its password is on its way. The link works once and expires in 30 minutes.':
    'Jika ada akaun yang menggunakan e-mel ini, pautan untuk menetapkan semula kata laluannya sedang dihantar. Pautan ini berfungsi sekali sahaja dan tamat tempoh dalam 30 minit.',
  'Choose a new password': 'Pilih kata laluan baharu',
  'This link works once and expires 30 minutes after it was sent. Saving signs you out on every other device.':
    'Pautan ini berfungsi sekali sahaja dan tamat tempoh 30 minit selepas dihantar. Menyimpan akan mengeluarkan anda daripada semua peranti lain.',
  'Open the whole link from the email, or ask for a new one from the sign-in page.':
    'Buka pautan penuh daripada e-mel, atau minta pautan baharu di halaman log masuk.',
  'New password': 'Kata laluan baharu',
  'Save password and sign in': 'Simpan kata laluan dan log masuk',
  'This link has expired or was already used. Ask for a new one from the sign-in page.':
    'Pautan ini telah tamat tempoh atau sudah digunakan. Minta pautan baharu di halaman log masuk.',
  'Your password was changed': 'Kata laluan anda telah ditukar',
  'If you did not do this, contact the township office straight away.': 'Jika ini bukan anda, hubungi pejabat perbandaran dengan segera.',

  // Password reset email
  'Reset your SimeTown password': 'Tetapkan semula kata laluan SimeTown anda',
  'Account': 'Akaun',
  'we received a request to reset the password for your SimeTown account. Choose a new one with the button below.':
    'kami menerima permintaan untuk menetapkan semula kata laluan akaun SimeTown anda. Pilih kata laluan baharu dengan butang di bawah.',
  'Account email': 'E-mel akaun',
  'Requested': 'Diminta',
  'Expires in': 'Tamat tempoh dalam',
  'Reset my password': 'Tetapkan semula kata laluan saya',
  'If you did not ask for this, you can ignore this email. Your password stays the same.':
    'Jika anda tidak memintanya, anda boleh abaikan e-mel ini. Kata laluan anda kekal sama.',
  'You received this because a password reset was asked for with this email address. Account emails are always sent.':
    'Anda menerima e-mel ini kerana permintaan menetapkan semula kata laluan dibuat dengan alamat e-mel ini. E-mel akaun sentiasa dihantar.',

  // Welcome email
  'Welcome to SimeTown': 'Selamat datang ke SimeTown',
  'Your account is ready. Your township office will confirm your home next.': 'Akaun anda sudah sedia. Pejabat perbandaran anda akan mengesahkan rumah anda seterusnya.',
  'Account created': 'Akaun dibuat',
  'Your SimeTown account is ready': 'Akaun SimeTown anda sudah sedia',
  'Township': 'Perbandaran',
  'Created': 'Dibuat',
  'Your home': 'Rumah anda',
  'Waiting for the township office to confirm': 'Menunggu pengesahan pejabat perbandaran',
  'Open SimeTown': 'Buka SimeTown',
  'You can look around the app now. Earning and spending points starts once your home is confirmed. If you did not create this account, contact the township office.':
    'Anda boleh meneroka aplikasi sekarang. Mengumpul dan membelanjakan mata bermula sebaik sahaja rumah anda disahkan. Jika anda tidak membuat akaun ini, hubungi pejabat perbandaran.',
  'You received this because a SimeTown account was created with this email address. Account emails are always sent.':
    'Anda menerima e-mel ini kerana akaun SimeTown dibuat dengan alamat e-mel ini. E-mel akaun sentiasa dihantar.',
};

export const accountTemplates: readonly (readonly [string, string])[] = [
  ['This link works once and expires in {0} minutes.', 'Pautan ini berfungsi sekali sahaja dan tamat tempoh dalam {0} minit.'],
  ['{0} minutes', '{0} minit'],
  ['thank you for joining SimeTown in {0}. Your account has been created, and your township office will now confirm your home.',
    'terima kasih kerana menyertai SimeTown di {0}. Akaun anda telah dibuat, dan pejabat perbandaran anda kini akan mengesahkan rumah anda.'],
];
