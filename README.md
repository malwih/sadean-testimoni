# 🧡 Sadean Studio — Custom Testimoni Bot

Bot Discord berbasis **Node.js + discord.js** untuk alur testimoni pembelian map dan asset Roblox. Proyek ini bisa dibuka dan dijalankan dari Visual Studio Code.

## Fitur

- Embed panel **Send Testimoni** di channel `send-testimoni`.
- Tombol membuat ticket privat bernomor, contohnya `testimoni-0001`.
- Embed ticket dengan tombol **Close Ticket** dan **Send Testimoni**.
- Modal berisi kolom pesan testimoni dan dropdown rating ⭐ 1–5.
- Setelah formulir dikirim, pembeli wajib mengunggah minimal satu lampiran dalam 15 menit. Semua jenis lampiran yang diterima Discord dapat dipakai; tidak dibatasi hanya JPG/PNG/PDF.
- Jika bukti belum diunggah setelah 15 menit, ticket ditutup otomatis.
- Setelah lampiran diterima, bot mengunci izin mengirim pesan milik pembeli dan menampilkan tombol **ACCEPT / REJECT**.
- Hanya anggota yang mempunyai **role ID `STAFF_ROLE_ID`** yang dapat mengambil keputusan. Klik oleh user biasa akan ditolak oleh bot.
- Saat **ACCEPT**, testimoni dipublikasikan ke `testimoni-order`, termasuk pesan, rating, atribusi user, dan bukti. Lampiran kecil dicoba diunggah ulang ke channel publik; lampiran yang melewati batas atau gagal disalin tetap dicantumkan sebagai tautan.
- Saat **REJECT**, ticket menampilkan embed penolakan dan ditutup otomatis setelah 15 menit.
- Status ticket dan deadline disimpan ke `data/store.json`, sehingga timer yang masih aktif dapat dipulihkan setelah bot restart.

> **Tentang identitas pengirim:** Discord tidak menyediakan cara bagi bot biasa untuk mengirim pesan sebagai akun user lain. Karena itu, posting yang disetujui dikirim oleh akun bot, dengan nama/avatar pembeli dan mention pembeli ditampilkan secara jelas. Bot ini tidak menyamar sebagai akun pembeli.

## 1. Persiapan

1. Install **Node.js 20 atau lebih baru** dari situs resmi Node.js.
2. Buka folder proyek ini di Visual Studio Code.
3. Buka terminal VS Code melalui **Terminal → New Terminal**.
4. Jalankan:

   ```bash
   npm install
   ```

## 2. Buat bot di Discord Developer Portal

1. Buka [Discord Developer Portal](https://discord.com/developers/applications).
2. Klik **New Application**, beri nama misalnya `Sadean Studio Testimoni`.
3. Buka menu **Bot**, buat/siapkan bot, lalu salin **Bot Token**. Jangan membagikan token ke orang lain.
4. Di halaman **Bot**, aktifkan **Message Content Intent** pada bagian Privileged Gateway Intents. Ini diperlukan agar bot dapat mendeteksi lampiran yang diunggah dalam ticket.
5. Di menu **General Information**, salin **Application ID**.
6. Undang bot ke server menggunakan OAuth2 URL Generator dengan scopes `bot` dan `applications.commands`. Berikan izin bot berikut:
   - View Channels
   - Send Messages
   - Read Message History
   - Embed Links
   - Attach Files
   - Manage Channels (untuk membuat dan menghapus ticket)
   - Manage Roles / kelola permission channel (untuk mengunci izin kirim pesan pemilik ticket setelah bukti masuk)
7. Pastikan role bot tidak dibatasi oleh permission channel/kategori server.

## 3. Siapkan ID server, channel, dan role

Aktifkan **Developer Mode** di Discord: **User Settings → Advanced → Developer Mode**. Lalu klik kanan server, channel, kategori, atau role dan pilih **Copy ID**.

Siapkan nilai berikut:

- `DISCORD_TOKEN`: token dari menu Bot.
- `CLIENT_ID`: Application ID dari General Information.
- `GUILD_ID`: ID server Discord.
- `SEND_TESTIMONI_CHANNEL_ID`: ID channel tempat panel tombol akan dipasang.
- `TESTIMONI_ORDER_CHANNEL_ID`: ID channel hasil publikasi testimoni.
- `STAFF_ROLE_ID`: ID role yang boleh menekan ACCEPT / REJECT.
- `TICKET_CATEGORY_ID`: ID kategori tempat ticket dibuat (opsional; kosongkan untuk tanpa kategori).

## 4. Isi konfigurasi `.env`

1. Salin `.env.example` lalu ubah nama salinannya menjadi `.env`.
2. Isi semua ID dan token sesuai server kamu. Jangan menambahkan tanda kutip dan jangan memberi spasi di sekitar `=`.
3. Contoh format:

   ```dotenv
   DISCORD_TOKEN=token_bot_kamu
   CLIENT_ID=123456789012345678
   GUILD_ID=123456789012345678
   SEND_TESTIMONI_CHANNEL_ID=123456789012345678
   TESTIMONI_ORDER_CHANNEL_ID=123456789012345678
   STAFF_ROLE_ID=123456789012345678
   TICKET_CATEGORY_ID=123456789012345678
   PUBLIC_UPLOAD_COPY_LIMIT_MB=8
   ```

Angka pada contoh hanya contoh format; ganti dengan ID milik server kamu sendiri.

## 5. Jalankan bot

Di terminal VS Code:

```bash
npm run check
npm start
```

Jika berhasil, terminal menampilkan bot login dan slash command berhasil didaftarkan. Biarkan terminal tetap berjalan selama bot digunakan. Untuk menghentikan bot, tekan `Ctrl + C`.

## 6. Pasang panel

1. Pastikan bot online dan berada di server yang sesuai dengan `GUILD_ID`.
2. Jalankan command `/setup-testimoni` di server. Command ini hanya untuk administrator.
3. Bot mengirim embed panel secara otomatis ke channel yang ditentukan oleh `SEND_TESTIMONI_CHANNEL_ID`.
4. Jika ingin membuat panel baru, jalankan command yang sama lagi. Hapus panel lama secara manual bila tidak diperlukan.

## 7. Cara kerja bagi pembeli dan staff

1. Pembeli menekan **Send Testimoni** pada panel.
2. Bot membuat ticket privat `testimoni-0001` dan menampilkan tombol **Send Testimoni** serta **Close Ticket**.
3. Pembeli mengisi pesan ulasan dan memilih rating bintang lewat dropdown di modal.
4. Bot memberi instruksi untuk mengunggah bukti transfer di chat ticket. Waktu 15 menit mulai dihitung setelah formulir berhasil dikirim.
5. Setelah lampiran masuk, bot mengunci izin pembeli untuk mengirim pesan dan memunculkan panel review **ACCEPT / REJECT**.
6. Staff dengan role ID yang dikonfigurasi memeriksa bukti dan menekan salah satu tombol.
7. **ACCEPT:** bot memposting embed testimoni beserta rating, atribusi pembeli, dan lampiran/tautan bukti di channel publik.
8. **REJECT:** bot mengirim embed penolakan; ticket ditutup otomatis setelah 15 menit. Staff atau pembeli juga dapat menutup ticket lebih awal lewat tombol **Close Ticket**.

## Catatan penting

- Gunakan aplikasi/bot khusus untuk proyek ini. Saat start, bot mendaftarkan command guild `/setup-testimoni` dan mengganti daftar slash command guild milik aplikasi tersebut dengan command ini.

- Bot membatasi satu ticket aktif per user pada server tersebut agar alur testimoni tidak menumpuk.
- User biasa tidak bisa melihat ticket user lain karena permission channel dibuat privat.
- Izin kanal Discord tetap berlaku: pastikan staff role dapat melihat channel kategori ticket dan bot memiliki izin membuat/mengedit/menghapus channel.
- Semua format file diterima sepanjang Discord berhasil mengunggahnya. Batas ukuran attachment bergantung pada batas upload Discord/server akun pengunggah.
- `PUBLIC_UPLOAD_COPY_LIMIT_MB` membatasi total ukuran file yang dicoba diunggah ulang oleh bot ke channel publik. File yang terlalu besar akan ditampilkan sebagai tautan bukti, sehingga pastikan ticket sumber tidak langsung dihapus apabila kamu perlu menjaga tautan lampiran tersebut tetap tersedia.
- Backup `data/store.json` jika ingin menyimpan catatan ticket. File tersebut tidak menyimpan token bot.
- Jangan upload `.env` ke GitHub atau kirim token bot di chat. Jika token bocor, reset token dari Developer Portal.

## Troubleshooting

**Slash command belum muncul**
- Pastikan `CLIENT_ID`, `GUILD_ID`, dan token benar.
- Tunggu beberapa saat atau restart bot setelah konfigurasi diubah.
- Bot harus diundang dengan scope `applications.commands`.

**Bot tidak mendeteksi file yang diunggah**
- Pastikan `Message Content Intent` diaktifkan pada Developer Portal.
- Pastikan intent tersebut juga ada di konfigurasi bot (sudah disertakan pada source code).
- Pastikan bot dapat melihat channel ticket dan membaca riwayat pesan.

**Gagal membuat ticket**
- Beri bot izin `Manage Channels`, `Manage Roles`, `View Channels`, `Send Messages`, `Embed Links`, dan `Read Message History`.
- Pastikan `STAFF_ROLE_ID` benar. Pastikan `TICKET_CATEGORY_ID` benar jika digunakan.

**Staff tidak bisa ACCEPT / REJECT**
- Hanya role dengan ID persis sama seperti `STAFF_ROLE_ID` yang diizinkan. Periksa kembali ID role di `.env`.

**Testimoni gagal dipublikasikan**
- Periksa `TESTIMONI_ORDER_CHANNEL_ID` dan izin bot untuk mengirim embed/lampiran di channel tersebut.
- Periksa pesan error di terminal VS Code. Jika upload file terlalu besar, sesuaikan `PUBLIC_UPLOAD_COPY_LIMIT_MB` atau gunakan tautan bukti.
