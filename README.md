# Sistem Informasi Penjualan dan Pengelolaan Pesanan Florist Bouquet by Reva

Aplikasi web untuk memusatkan administrasi pelanggan, produk, stok, pesanan, pembayaran, dan rekap penjualan yang sebelumnya tersebar di beberapa tempat. Antarmuka menggunakan HTML, CSS, dan JavaScript; data, autentikasi, database, serta penyimpanan bukti pembayaran menggunakan Supabase.

## Fitur

- Login dan logout menggunakan Supabase Auth.
- CRUD pelanggan, produk, harga, dan stok; admin dapat menambahkan stok secara akumulatif dari setiap baris produk, sementara batas stok rendah dapat diatur per produk.
- Pencatatan dan perubahan pesanan dengan detail item, tanggal pemesanan, catatan khusus pelanggan, dan status pengerjaan. Tanggal pengambilan tetap tersedia untuk data pesanan lama, tetapi tidak diminta pada transaksi baru.
- Pembayaran QRIS/transfer dengan pilihan DP tepat 50% atau lunas.
- Maksimal dua tahap pembayaran dalam data Penjualan: pembayaran awal dan pelunasan.
- Pencarian pelanggan saat membuat transaksi, pilihan produk beserta stok, keranjang dengan kuantitas dan subtotal, catatan permintaan khusus, serta unggah foto bukti pembayaran yang wajib sebelum transaksi baru dibuat.
- Unggah bukti pembayaran privat, status menunggu verifikasi/terverifikasi/ditolak, serta alasan penolakan. Hanya admin yang ditetapkan dapat mengesahkan bukti.
- Bukti pembayaran awal tetap wajib. Jika transaksi dicatat oleh admin, pembayaran DP/lunas langsung dicatat sebagai terverifikasi; transaksi yang dicatat staf tetap menunggu pemeriksaan admin.
- Nilai pembayaran dan sisa tagihan hanya berubah setelah bukti diverifikasi admin.
- Dashboard pesanan pengambilan 7 hari, bukti pembayaran yang menunggu, penjualan dan penerimaan harian, serta notifikasi stok rendah.
- Pencarian riwayat berdasarkan pelanggan/no. HP/nomor pesanan, filter tanggal, paginasi, dan ekspor CSV UTF-8 bertanda titik koma agar kolom terbaca rapi di Excel lokal Indonesia.
- Rekap/grafik harian dan bulanan serta produk terlaris.

## Struktur Folder

```text
database/
  schema.sql             Skema PostgreSQL, relasi, kebijakan, dan fungsi transaksi
backend/
  app.js                 Lapisan akses data Supabase yang dipanggil dari browser
  config.js              Konfigurasi URL dan kunci publik Supabase
frontend/
  assets/
    flower-mark.svg      Logo bunga
  css/
    style.css            Gaya antarmuka
  html/
    index.html           Halaman aplikasi
  js/
    script.js            Interaksi, navigasi, dan render data
Dokumentasi_Sistem_Penjualan_Bouquet_by_Reva.docx
                         Penjelasan sistem dan ERD untuk kebutuhan kuliah
README.md
```

## Persiapan Supabase

1. Buat atau buka proyek Supabase.
2. Buka `backend/config.js` dan sesuaikan `SUPABASE_URL` serta `SUPABASE_ANON_KEY` dengan URL proyek dan publishable/anon key dari **Project Settings > API**.
3. Jangan masukkan `service_role` key atau secret key ke frontend. Kunci yang disimpan di `config.js` dapat diakses dari browser.
4. Buka **SQL Editor** di Supabase, tempel isi `database/schema.sql`, lalu jalankan. Sistem hanya menggunakan empat tabel aplikasi: `customers`, `products`, `sales`, dan `sale_details`. Nominal, bukti, serta status kedua tahap pembayaran menjadi kolom pada `sales`; Supabase Auth dan Storage tetap dipakai sebagai layanan infrastruktur, bukan tabel entitas aplikasi.
5. Buat akun pengguna di **Authentication > Users**. Untuk menetapkan hak admin tanpa menambah tabel entitas, jalankan di SQL Editor dan ganti alamat email contoh dengan email persis yang terdaftar:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where lower(email) = lower('email-admin-anda@example.com')
   returning id, email, raw_app_meta_data ->> 'role' as role;
   ```

   Jalankan dari lingkungan tepercaya, bukan frontend. Pastikan hasil mengembalikan akun yang benar dengan `role` bernilai `admin`; jika tidak ada baris, periksa email pada **Authentication > Users**. Fungsi otorisasi membaca metadata akun tepercaya di Supabase Auth, sehingga pemeriksaan hak admin tidak bergantung pada klaim JWT yang mungkin masih lama. Muat ulang aplikasi atau masuk kembali setelah mengubah hak. Admin pada tabel lama `app_admins` akan dipindahkan otomatis ke metadata Auth.
6. Jika database sudah berisi data, jalankan skrip migrasi sebelum memakai aplikasi. Bukti dan status dari maksimal dua pembayaran lama per penjualan akan dipindahkan ke kolom penjualan. Skrip akan berhenti secara eksplisit jika ada penjualan dengan lebih dari dua pembayaran agar riwayat tersebut dapat direkonsiliasi sebelum tabel lama dihapus.

## Menjalankan Aplikasi

Tidak ada proses build atau instalasi dependensi npm yang diperlukan.

1. Buka folder proyek di VS Code.
2. Jalankan `frontend/html/index.html` menggunakan ekstensi server statis seperti **Live Server**. Jika membuka HTML langsung dari file lokal, dukungan permintaan jaringan dapat berbeda antarbrowser; gunakan server lokal bila Supabase tidak dapat diakses.
3. Masuk menggunakan akun yang telah dibuat di Supabase Auth.

`backend/app.js` bukan server Node.js terpisah. File tersebut dimuat oleh halaman web dan menggunakan Supabase JavaScript Client yang disediakan melalui CDN pada `index.html`. Perubahan stok, transaksi, dan verifikasi pembayaran dijalankan melalui fungsi PostgreSQL agar perubahan penting berlangsung konsisten. Bukti berada di bucket privat; akses baca memakai signed URL singkat untuk admin.

## Ringkasan ERD

| Entitas | Fungsi | Kunci utama |
| --- | --- | --- |
| `Products` | Menyimpan katalog, harga, dan stok buket. | `product_id` |
| `Customers` | Menyimpan data pelanggan. | `customer_id` |
| `Sales` | Menyimpan informasi utama transaksi dan status pembayaran. | `sale_id`; `customer_id` adalah FK ke `Customers` |
| `Sale_Details` | Menyimpan item, kuantitas, dan harga per item pada transaksi. | `detail_id`; `sale_id` dan `product_id` adalah FK |

Relasi: satu `Customers` dapat memiliki banyak `Sales`; satu `Sales` dapat memiliki banyak `Sale_Details`; satu `Products` dapat muncul pada banyak `Sale_Details`. Karena itu, `Sales` dan `Products` memiliki relasi banyak-ke-banyak yang dihubungkan melalui `Sale_Details`.

## Catatan Transaksi

- Untuk pesanan baru, metode pembayaran adalah QRIS atau Transfer. Metode Tunai hanya dipertahankan untuk riwayat lama.
- Pilihan DP 50% mengharuskan pembayaran awal tepat 50% dari total pesanan; pilihan Lunas mengharuskan pembayaran awal sebesar total pesanan.
- Transaksi baru wajib menyertakan foto bukti pembayaran JPG atau PNG maksimal 5 MB. Foto diunggah ke Supabase Storage privat pada folder berdasarkan ID transaksi, lalu ditautkan ke pembayaran transaksi. Jika unggahan atau penautan gagal, sistem mencoba membatalkan transaksi dan mengembalikan stok.
- Setiap tahap pembayaran menyimpan nominal, metode, waktu, bukti, status Menunggu Verifikasi/Terverifikasi/Ditolak, dan alasan penolakan pada `Sales`. Pembayaran yang menunggu/ditolak tidak menambah `paid_total`; sisa tagihan diperbarui setelah admin menyetujuinya.
- Pembayaran berikutnya setelah DP adalah pelunasan satu kali dan harus sama dengan sisa tagihan.
- Rekap Data Penjualan dapat dicari berdasarkan nama pelanggan dan difilter menurut tanggal. Tabel menampilkan Tanggal, Pelanggan, Produk, Qty, Total, Pembayaran, dan Sisa Tagihan, dengan maksimal 20 transaksi per halaman dan navigasi angka. Untuk transaksi DP, baris tambahan menyediakan **Tandai Lunas**. Admin wajib mengunggah bukti JPG/PNG maksimal 5 MB, lalu memilih **Ya** pada dialog **Upload Bukti Bayar Pelunasan**. Bukti pelunasan disimpan ke Supabase Storage dan ditautkan ke tahap pembayaran kedua pada transaksi yang sama. RPC Supabase memperbarui `paid_total`, status menjadi Lunas, serta sisa tagihan menjadi Rp 0; bukti DP awal tetap tersimpan.
- Pesanan dapat diubah sebelum bukti pembayaran diajukan. Setelah pembayaran diajukan, penjualan perlu dibatalkan dan dibuat ulang bila detail pesanan harus dikoreksi.
- Transaksi DP lama yang nominalnya tidak tercatat tetap perlu direkonsiliasi admin melalui tombol **Verifikasi data lama**.
- Status pengerjaan pesanan: Diterima, Diproses, Siap Diambil, dan Selesai. Status transaksi tetap terpisah, yaitu selesai atau batal.
- Pembatalan mengembalikan stok, tetapi tidak mencatat pengembalian dana secara otomatis.
- `Sale_Details.subtotal` dihitung otomatis dari kuantitas dikalikan harga satuan.
- Pembuatan dan perubahan transaksi mengambil harga dari tabel produk, mengurangi stok, dan menghitung total secara atomik. Pembatalan transaksi mengembalikan stok dan menyimpan transaksi dengan status batal.
