# Sistem Penjualan Bouquet by Reva

Aplikasi web sederhana untuk membantu toko Bouquet by Reva mengelola katalog buket, pelanggan, dan transaksi penjualan. Antarmuka menggunakan HTML, CSS, dan JavaScript. Data, autentikasi, serta fungsi transaksi tersimpan dan dijalankan melalui Supabase dengan PostgreSQL.

## Fitur

- Login dan logout menggunakan Supabase Auth.
- Pengelolaan produk, harga, dan stok.
- Pengelolaan data pelanggan.
- Pembuatan, pengubahan, dan pembatalan transaksi.
- Perhitungan total transaksi dan penyesuaian stok melalui fungsi SQL.
- Riwayat penjualan, ringkasan grafik harian/bulanan, dan produk terlaris.

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
4. Buka **SQL Editor** di Supabase, tempel isi `database/schema.sql`, lalu jalankan. Skrip membuat empat tabel, relasi, Row Level Security (RLS), dan fungsi `create_sale`, `update_sale`, serta `cancel_sale`. Skrip juga menambahkan contoh produk dan pelanggan apabila tabel masih kosong.
5. Buat akun pengguna di **Authentication > Users**. Kebijakan RLS pada tabel hanya mengizinkan pengguna yang telah login untuk membaca dan mengubah data.

## Menjalankan Aplikasi

Tidak ada proses build atau instalasi dependensi npm yang diperlukan.

1. Buka folder proyek di VS Code.
2. Jalankan `frontend/html/index.html` menggunakan ekstensi server statis seperti **Live Server**. Jika membuka HTML langsung dari file lokal, dukungan permintaan jaringan dapat berbeda antarbrowser; gunakan server lokal bila Supabase tidak dapat diakses.
3. Masuk menggunakan akun yang telah dibuat di Supabase Auth.

`backend/app.js` bukan server Node.js terpisah. File tersebut dimuat oleh halaman web dan menggunakan Supabase JavaScript Client yang disediakan melalui CDN pada `index.html`. Operasi transaksi yang mengubah stok dijalankan oleh fungsi PostgreSQL agar perubahan transaksi dan stok berlangsung konsisten.

## Ringkasan ERD

| Entitas | Fungsi | Kunci utama |
| --- | --- | --- |
| `Products` | Menyimpan katalog, harga, dan stok buket. | `product_id` |
| `Customers` | Menyimpan data pelanggan. | `customer_id` |
| `Sales` | Menyimpan informasi utama transaksi dan status pembayaran. | `sale_id`; `customer_id` adalah FK ke `Customers` |
| `Sale_Details` | Menyimpan item, kuantitas, dan harga per item pada transaksi. | `detail_id`; `sale_id` dan `product_id` adalah FK |

Relasi: satu `Customers` dapat memiliki banyak `Sales`; satu `Sales` dapat memiliki banyak `Sale_Details`; satu `Products` dapat muncul pada banyak `Sale_Details`. Karena itu, `Sales` dan `Products` memiliki relasi banyak-ke-banyak yang dihubungkan melalui `Sale_Details`.

## Catatan Transaksi

- Metode pembayaran yang didukung adalah QRIS dan Transfer.
- Status pembayaran adalah DP atau Lunas.
- Status transaksi adalah selesai atau batal.
- `Sale_Details.subtotal` dihitung otomatis dari kuantitas dikalikan harga satuan.
- Pembuatan transaksi mengambil harga dari tabel produk, mengurangi stok, dan menghitung total secara atomik. Pembatalan transaksi mengembalikan stok dan menyimpan transaksi dengan status batal.
