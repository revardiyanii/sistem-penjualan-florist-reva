-- Bouquet by Reva - Supabase: SQL Editor > New query > Run (aman dijalankan ulang)
--
-- ERD:
--   customers (customer_id PK, name, phone, address, created_at)
--       1 ---< sales (sale_id PK, customer_id FK wajib, sale_date, total, paid_total,
--                     payment_method [QRIS|Transfer], payment_plan [DP 50%|Lunas],
--                     pickup_date opsional, order_notes, fulfillment_status, dua tahap pembayaran, status transaksi)
--                    1 ---< sale_details (detail_id PK, sale_id FK, product_id FK, qty, unit_price, subtotal)
--   products (product_id PK, name, price, stock, low_stock_threshold, created_at)
--       1 ---< sale_details

create table if not exists customers (
  customer_id bigint generated always as identity primary key,
  name text not null,
  phone text,
  address text,
  created_at timestamptz not null default now()
);
create table if not exists products (
  product_id bigint generated always as identity primary key,
  name text not null,
  price numeric(12,2) not null check (price >= 0),
  stock int not null default 0 check (stock >= 0),
  low_stock_threshold int not null default 3 check (low_stock_threshold >= 0),
  created_at timestamptz not null default now()
);
alter table products add column if not exists low_stock_threshold int not null default 3 check (low_stock_threshold >= 0);

create table if not exists sales (
  sale_id bigint generated always as identity primary key,
  customer_id bigint not null references customers(customer_id) on delete restrict,
  sale_date timestamptz not null default now(),
  total numeric(12,2) not null default 0,
  payment_method text not null,
  payment_status text not null default 'Lunas' check (payment_status in ('Belum Bayar','DP','Lunas')),
  paid_total numeric(12,2),
  payment_plan text not null default 'Lunas' check (payment_plan in ('DP 50%','Lunas')),
  payment_1_amount numeric(12,2),
  payment_1_method text,
  payment_1_status text not null default 'Belum Dibayar',
  payment_1_proof_path text,
  payment_1_at timestamptz,
  payment_1_reviewed_at timestamptz,
  payment_1_rejection_reason text,
  payment_2_amount numeric(12,2),
  payment_2_method text,
  payment_2_status text not null default 'Belum Dibayar',
  payment_2_proof_path text,
  payment_2_at timestamptz,
  payment_2_reviewed_at timestamptz,
  payment_2_rejection_reason text,
  pickup_date date,
  order_notes text,
  fulfillment_status text not null default 'Selesai' check (fulfillment_status in ('Diterima','Diproses','Siap Diambil','Selesai','Dibatalkan')),
  status text not null default 'selesai' check (status in ('selesai','batal'))  -- internal: transaksi aktif / dibatalkan
);
-- Penyesuaian jika tabel sales versi lama sudah ada
alter table sales add column if not exists status text not null default 'selesai' check (status in ('selesai','batal'));
alter table sales alter column sale_date set default now();
alter table sales add column if not exists payment_status text not null default 'Lunas' check (payment_status in ('Belum Bayar','DP','Lunas'));
alter table sales add column if not exists paid_total numeric(12,2);
alter table sales add column if not exists payment_plan text not null default 'Lunas';
alter table sales add column if not exists payment_1_amount numeric(12,2);
alter table sales add column if not exists payment_1_method text;
alter table sales add column if not exists payment_1_status text not null default 'Belum Dibayar';
alter table sales add column if not exists payment_1_proof_path text;
alter table sales add column if not exists payment_1_at timestamptz;
alter table sales add column if not exists payment_1_reviewed_at timestamptz;
alter table sales add column if not exists payment_1_rejection_reason text;
alter table sales add column if not exists payment_2_amount numeric(12,2);
alter table sales add column if not exists payment_2_method text;
alter table sales add column if not exists payment_2_status text not null default 'Belum Dibayar';
alter table sales add column if not exists payment_2_proof_path text;
alter table sales add column if not exists payment_2_at timestamptz;
alter table sales add column if not exists payment_2_reviewed_at timestamptz;
alter table sales add column if not exists payment_2_rejection_reason text;
alter table sales add column if not exists pickup_date date;
alter table sales alter column pickup_date drop not null;
alter table sales add column if not exists order_notes text;
alter table sales add column if not exists fulfillment_status text not null default 'Selesai';
alter table sales alter column payment_method drop default;
alter table sales drop constraint if exists sales_payment_status_check;
alter table sales add constraint sales_payment_status_check
  check (payment_status in ('Belum Bayar','Menunggu Verifikasi','Ditolak','DP','Lunas')) not valid;
alter table sales drop constraint if exists sales_payment_plan_check;
alter table sales add constraint sales_payment_plan_check check (payment_plan in ('DP 50%','Lunas')) not valid;
alter table sales drop constraint if exists sales_fulfillment_status_check;
alter table sales add constraint sales_fulfillment_status_check
  check (fulfillment_status in ('Diterima','Diproses','Siap Diambil','Selesai','Dibatalkan')) not valid;
alter table sales drop constraint if exists sales_payment_1_status_check;
alter table sales add constraint sales_payment_1_status_check
  check (payment_1_status in ('Belum Dibayar','Menunggu Verifikasi','Terverifikasi','Ditolak')) not valid;
alter table sales drop constraint if exists sales_payment_2_status_check;
alter table sales add constraint sales_payment_2_status_check
  check (payment_2_status in ('Belum Dibayar','Menunggu Verifikasi','Terverifikasi','Ditolak')) not valid;

-- Nominal untuk transaksi lama yang Lunas diketahui; nominal DP lama tidak dapat ditebak.
update sales set paid_total = total where payment_status = 'Lunas' and paid_total is null;
alter table sales drop constraint if exists sales_paid_total_check;
alter table sales add constraint sales_paid_total_check
  check (paid_total is null or (paid_total >= 0 and paid_total <= total)) not valid;

do $$
declare c text;
begin
  -- Pelanggan wajib: NOT NULL + FK on delete restrict (pelanggan yang punya transaksi tidak bisa dihapus)
  if exists (select 1 from sales where customer_id is null) then
    raise notice 'Ada transaksi lama tanpa pelanggan: NOT NULL pada sales.customer_id belum diterapkan.';
  else
    alter table sales alter column customer_id set not null;
  end if;
  for c in select conname from pg_constraint
           where conrelid = 'public.sales'::regclass and contype = 'f' and confrelid = 'public.customers'::regclass loop
    execute format('alter table sales drop constraint %I', c);
  end loop;
  alter table sales add constraint sales_customer_id_fkey
    foreign key (customer_id) references customers(customer_id) on delete restrict;
end $$;

-- Metode pembayaran
alter table sales drop constraint if exists chk_sales_payment;
alter table sales add constraint chk_sales_payment check (payment_method in ('Tunai','QRIS','Transfer')) not valid;
do $$ begin
  alter table sales validate constraint chk_sales_payment;
exception when check_violation then
  raise notice 'Ada transaksi lama dengan metode pembayaran lain; aturan hanya berlaku untuk data baru.';
end $$;

create table if not exists sale_details (
  detail_id bigint generated always as identity primary key,
  sale_id bigint not null references sales(sale_id) on delete cascade,
  product_id bigint not null references products(product_id) on delete restrict,
  qty int not null check (qty > 0),
  unit_price numeric(12,2) not null,
  subtotal numeric(12,2) generated always as (qty * unit_price) stored
);
create index if not exists idx_sales_customer on sales(customer_id);
create index if not exists idx_details_sale on sale_details(sale_id);
create index if not exists idx_sales_pickup_date on sales(pickup_date) where status = 'selesai';

create or replace function is_app_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select u.raw_app_meta_data ->> 'role' = 'admin'
    from auth.users u
    where u.id = auth.uid()
  ), false)
$$;

create or replace function add_product_stock(p_product_id bigint, p_quantity integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_stock integer;
begin
  if not public.is_app_admin() then
    raise exception 'Hanya admin yang dapat menambah stok produk.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Jumlah stok yang ditambahkan harus lebih dari 0.' using errcode = '22023';
  end if;

  update public.products
  set stock = stock + p_quantity
  where product_id = p_product_id
  returning stock into v_stock;

  if not found then
    raise exception 'Produk tidak ditemukan.' using errcode = 'P0002';
  end if;
  return v_stock;
end;
$$;

drop policy if exists payment_proofs_cleanup on storage.objects;
drop function if exists submit_payment_proof(bigint, numeric, text, text);
drop function if exists review_payment_proof(bigint, boolean, text);
drop function if exists record_sale_payment(bigint, numeric, text);
drop function if exists reconcile_sale_payment(bigint, numeric);

do $$
declare v_sale bigint;
begin
  if to_regclass('public.sale_payments') is not null then
    alter table public.sale_payments add column if not exists proof_path text;
    alter table public.sale_payments add column if not exists verification_status text not null default 'Terverifikasi';
    alter table public.sale_payments add column if not exists reviewed_at timestamptz;
    alter table public.sale_payments add column if not exists rejection_reason text;
    insert into public.sale_payments(sale_id, paid_at, amount, payment_method)
    select s.sale_id, s.sale_date, s.total, s.payment_method
    from public.sales s
    where s.payment_status = 'Lunas' and s.total > 0
      and not exists (select 1 from public.sale_payments p where p.sale_id = s.sale_id);

    select sale_id into v_sale from public.sale_payments group by sale_id having count(*) > 2 limit 1;
    if v_sale is not null then
      raise exception 'Pesanan % memiliki lebih dari dua pembayaran. Rekonsiliasi riwayat tersebut sebelum migrasi empat entitas.', v_sale;
    end if;
    with ranked as (
      select p.*, row_number() over (partition by sale_id order by paid_at, payment_id) as stage
      from public.sale_payments p
    ), grouped as (
      select sale_id,
        max(amount) filter (where stage = 1) as amount_1,
        max(payment_method) filter (where stage = 1) as method_1,
        max(verification_status) filter (where stage = 1) as status_1,
        max(proof_path) filter (where stage = 1) as proof_1,
        max(paid_at) filter (where stage = 1) as at_1,
        max(reviewed_at) filter (where stage = 1) as reviewed_1,
        max(rejection_reason) filter (where stage = 1) as reason_1,
        max(amount) filter (where stage = 2) as amount_2,
        max(payment_method) filter (where stage = 2) as method_2,
        max(verification_status) filter (where stage = 2) as status_2,
        max(proof_path) filter (where stage = 2) as proof_2,
        max(paid_at) filter (where stage = 2) as at_2,
        max(reviewed_at) filter (where stage = 2) as reviewed_2,
        max(rejection_reason) filter (where stage = 2) as reason_2,
        coalesce(sum(amount) filter (where verification_status = 'Terverifikasi'), 0) as paid
      from ranked group by sale_id
    )
    update public.sales s set
      payment_1_amount = g.amount_1, payment_1_method = g.method_1, payment_1_status = g.status_1,
      payment_1_proof_path = g.proof_1, payment_1_at = g.at_1, payment_1_reviewed_at = g.reviewed_1,
      payment_1_rejection_reason = g.reason_1,
      payment_2_amount = g.amount_2, payment_2_method = g.method_2, payment_2_status = coalesce(g.status_2, 'Belum Dibayar'),
      payment_2_proof_path = g.proof_2, payment_2_at = g.at_2, payment_2_reviewed_at = g.reviewed_2,
      payment_2_rejection_reason = g.reason_2, paid_total = g.paid,
      payment_plan = case when g.paid > 0 and g.paid < s.total then 'DP 50%' else s.payment_plan end,
      payment_status = case
        when g.status_1 = 'Menunggu Verifikasi' or g.status_2 = 'Menunggu Verifikasi' then 'Menunggu Verifikasi'
        when g.paid >= s.total then 'Lunas'
        when g.paid > 0 then 'DP'
        when g.status_1 = 'Ditolak' or g.status_2 = 'Ditolak' then 'Ditolak'
        else 'Belum Bayar' end
    from grouped g where s.sale_id = g.sale_id;
    drop table public.sale_payments;
  else
    update public.sales set payment_1_amount = paid_total, payment_1_method = payment_method,
      payment_1_status = 'Terverifikasi', payment_1_at = sale_date,
      payment_plan = case when paid_total < total then 'DP 50%' else payment_plan end
    where paid_total > 0 and payment_1_amount is null;
  end if;
  update public.sales set payment_1_amount = paid_total, payment_1_method = payment_method,
    payment_1_status = 'Terverifikasi', payment_1_at = sale_date,
    payment_plan = case when paid_total < total then 'DP 50%' else payment_plan end
  where paid_total > 0 and payment_1_amount is null;
  if to_regclass('public.app_admins') is not null then
    update auth.users u set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
      from public.app_admins a where a.user_id = u.id;
    drop table public.app_admins;
  end if;
end $$;

-- Signature fungsi transaksi berubah; hapus versi lama agar tidak ada duplikat.
drop function if exists create_sale(bigint, text, jsonb);
drop function if exists create_sale(bigint, text, text, jsonb);
drop function if exists create_sale(bigint, text, numeric, jsonb);
drop function if exists create_sale(bigint, text, text, date, text, jsonb);
drop function if exists update_sale(bigint, bigint, text, text, jsonb);
drop function if exists update_sale(bigint, bigint, text, jsonb);
drop function if exists update_sale(bigint, bigint, text, date, text, jsonb);
drop function if exists record_sale_payment(bigint, numeric, text);

-- Pembayaran non-admin menunggu verifikasi; pembayaran yang dicatat admin langsung tervalidasi.
create or replace function create_sale(
  p_customer bigint, p_payment text, p_payment_plan text,
  p_pickup_date date, p_order_notes text, p_items jsonb
)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; it jsonb; v_price numeric; v_total numeric := 0; v_qty int; v_pid bigint;
begin
  if p_customer is null then raise exception 'Pelanggan harus dipilih'; end if;
  if p_payment is null or p_payment not in ('QRIS','Transfer') then raise exception 'Metode pembayaran harus QRIS atau Transfer'; end if;
  if p_payment_plan is null or p_payment_plan not in ('DP 50%','Lunas') then raise exception 'Pilih skema DP 50%% atau Lunas'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Daftar item tidak valid'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Keranjang kosong'; end if;
  insert into sales(customer_id, payment_method, payment_status, paid_total, payment_plan, pickup_date, order_notes, fulfillment_status)
    values (p_customer, p_payment, 'Belum Bayar', 0, p_payment_plan, p_pickup_date, nullif(trim(p_order_notes), ''), 'Diterima')
    returning sale_id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::bigint; v_qty := (it->>'qty')::int;
    select price into v_price from products where product_id = v_pid for update;
    if v_price is null then raise exception 'Produk % tidak ditemukan', v_pid; end if;
    update products set stock = stock - v_qty where product_id = v_pid;  -- CHECK stock>=0 menolak jika kurang
    insert into sale_details(sale_id, product_id, qty, unit_price) values (v_id, v_pid, v_qty, v_price);
    v_total := v_total + v_price * v_qty;
  end loop;
  update sales set total = v_total, payment_status = case when v_total = 0 then 'Lunas' else 'Belum Bayar' end where sale_id = v_id;
  return v_id;
end $$;

-- Ubah transaksi: stok lama dikembalikan, item diganti, total dihitung ulang.
-- Produk yang sudah ada mempertahankan harga lama; produk baru memakai harga saat ini.
create or replace function update_sale(
  p_sale bigint, p_customer bigint, p_payment text,
  p_pickup_date date, p_order_notes text, p_items jsonb
)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_status text; v_old jsonb; it jsonb; v_pid bigint; v_qty int; v_price numeric; v_total numeric := 0; v_paid numeric;
begin
  if p_customer is null then raise exception 'Pelanggan harus dipilih'; end if;
  if p_payment is null or p_payment not in ('Tunai','QRIS','Transfer') then raise exception 'Metode pembayaran tidak valid'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Daftar item tidak valid'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Keranjang kosong'; end if;
  select status into v_status from sales where sale_id = p_sale for update;
  if v_status is distinct from 'selesai' then raise exception 'Transaksi tidak bisa diubah'; end if;
  if p_payment = 'Tunai' and not exists (select 1 from sales where sale_id = p_sale and payment_method = 'Tunai') then
    raise exception 'Metode pembayaran baru harus QRIS atau Transfer';
  end if;
  if exists (select 1 from sales where sale_id = p_sale and
      (payment_1_status <> 'Belum Dibayar' or payment_2_status <> 'Belum Dibayar')) then
    raise exception 'Pesanan tidak dapat diubah setelah bukti pembayaran diajukan';
  end if;
  select coalesce(paid_total, 0) into v_paid from sales where sale_id = p_sale;
  if v_paid > 0 then raise exception 'Pesanan tidak dapat diubah setelah pembayaran diverifikasi'; end if;
  select jsonb_object_agg(product_id::text, unit_price) into v_old from sale_details where sale_id = p_sale;
  update products p set stock = p.stock + d.q
    from (select product_id, sum(qty) q from sale_details where sale_id = p_sale group by product_id) d
    where p.product_id = d.product_id;
  delete from sale_details where sale_id = p_sale;
  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::bigint; v_qty := (it->>'qty')::int;
    select coalesce((v_old->>v_pid::text)::numeric, price) into v_price from products where product_id = v_pid for update;
    if v_price is null then raise exception 'Produk % tidak ditemukan', v_pid; end if;
    update products set stock = stock - v_qty where product_id = v_pid;
    insert into sale_details(sale_id, product_id, qty, unit_price) values (p_sale, v_pid, v_qty, v_price);
    v_total := v_total + v_price * v_qty;
  end loop;
  update sales set customer_id = p_customer, payment_method = p_payment, total = v_total,
    pickup_date = coalesce(p_pickup_date, pickup_date), order_notes = nullif(trim(p_order_notes), ''),
    payment_status = case when v_total = 0 then 'Lunas' else 'Belum Bayar' end
    where sale_id = p_sale;
  return p_sale;
end $$;

drop function if exists submit_payment_proof(bigint, numeric, text, text);
create or replace function submit_payment_proof(p_sale bigint, p_stage smallint, p_amount numeric, p_method text, p_proof_path text)
returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric; v_total numeric; v_order_status text; v_plan text; v_stage_status text;
begin
  if p_stage is null or p_stage not in (1, 2) then raise exception 'Tahap pembayaran tidak valid'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Nominal pembayaran harus lebih dari nol'; end if;
  if p_method is null or p_method not in ('QRIS','Transfer') then raise exception 'Metode pembayaran harus QRIS atau Transfer'; end if;
  if p_proof_path is null or p_proof_path !~ ('^' || p_sale::text || '/[a-f0-9-]+\.(png|jpg|jpeg|webp|pdf)$') then
    raise exception 'Lokasi bukti pembayaran tidak valid';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'payment-proofs' and name = p_proof_path) then
    raise exception 'File bukti pembayaran belum tersedia';
  end if;
  select coalesce(paid_total, 0), total, status, payment_plan,
    case when p_stage = 1 then payment_1_status else payment_2_status end
    into v_paid, v_total, v_order_status, v_plan, v_stage_status
    from sales where sale_id = p_sale for update;
  if v_order_status is null then raise exception 'Pesanan tidak ditemukan'; end if;
  if v_order_status <> 'selesai' then raise exception 'Pesanan batal tidak dapat menerima pembayaran'; end if;
  if v_stage_status in ('Menunggu Verifikasi','Terverifikasi') then raise exception 'Tahap pembayaran ini sudah dikirim atau diverifikasi'; end if;
  if p_stage = 1 then
    if v_paid > 0 then raise exception 'Tahap pertama sudah dibayar'; end if;
    if v_plan = 'Lunas' and p_amount <> v_total then raise exception 'Pembayaran lunas harus sebesar total tagihan'; end if;
    if v_plan = 'DP 50%' and p_amount <> round(v_total * 0.5, 2) then raise exception 'DP awal harus tepat 50%% dari total pesanan'; end if;
    update sales set payment_1_amount = p_amount, payment_1_method = p_method,
      payment_1_status = case when public.is_app_admin() then 'Terverifikasi' else 'Menunggu Verifikasi' end,
      payment_1_proof_path = p_proof_path,
      payment_1_at = now(), payment_1_reviewed_at = case when public.is_app_admin() then now() else null end,
      payment_1_rejection_reason = null,
      paid_total = case when public.is_app_admin() then v_paid + p_amount else paid_total end,
      payment_status = case when public.is_app_admin()
        then case when v_paid + p_amount >= v_total then 'Lunas' else 'DP' end
        else 'Menunggu Verifikasi' end
      where sale_id = p_sale;
  else
    if v_paid <= 0 or v_paid >= v_total then raise exception 'Tahap pelunasan belum dapat dikirim'; end if;
    if v_stage_status = 'Menunggu Verifikasi' then raise exception 'Bukti pelunasan sedang menunggu verifikasi'; end if;
    if p_amount <> v_total - v_paid then raise exception 'Nominal pelunasan harus sama dengan sisa tagihan'; end if;
    if not exists (select 1 from sales where sale_id = p_sale and payment_1_status = 'Terverifikasi') then
      raise exception 'DP harus diverifikasi sebelum pelunasan';
    end if;
    update sales set payment_2_amount = p_amount, payment_2_method = p_method,
      payment_2_status = 'Menunggu Verifikasi', payment_2_proof_path = p_proof_path,
      payment_2_at = now(), payment_2_reviewed_at = null, payment_2_rejection_reason = null,
      payment_status = 'Menunggu Verifikasi' where sale_id = p_sale;
  end if;
end $$;

drop function if exists review_payment_proof(bigint, boolean, text);
create or replace function review_payment_proof(p_sale bigint, p_stage smallint, p_approve boolean, p_rejection_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_amount numeric; v_paid numeric; v_total numeric; v_order_status text;
  v_stage_status text; v_other_status text; v_new_paid numeric;
begin
  if not public.is_app_admin() then raise exception 'Hanya admin yang dapat memverifikasi bukti pembayaran'; end if;
  if p_stage is null or p_stage not in (1, 2) or p_approve is null then raise exception 'Keputusan verifikasi tidak valid'; end if;
  select status, coalesce(paid_total, 0), total,
    case when p_stage = 1 then payment_1_amount else payment_2_amount end,
    case when p_stage = 1 then payment_1_status else payment_2_status end,
    case when p_stage = 1 then payment_2_status else payment_1_status end
    into v_order_status, v_paid, v_total, v_amount, v_stage_status, v_other_status
    from sales where sale_id = p_sale for update;
  if v_order_status is null then raise exception 'Pesanan tidak ditemukan'; end if;
  if v_order_status <> 'selesai' then raise exception 'Pesanan batal tidak dapat menerima verifikasi pembayaran'; end if;
  if v_stage_status <> 'Menunggu Verifikasi' then raise exception 'Bukti pembayaran tidak sedang menunggu verifikasi'; end if;
  if not p_approve and nullif(trim(p_rejection_reason), '') is null then raise exception 'Alasan penolakan harus diisi'; end if;
  if p_approve and (v_amount is null or v_paid + v_amount > v_total) then raise exception 'Nominal bukti melebihi sisa tagihan'; end if;

  if p_stage = 1 then
    update sales set payment_1_status = case when p_approve then 'Terverifikasi' else 'Ditolak' end,
      payment_1_reviewed_at = now(), payment_1_rejection_reason = case when p_approve then null else trim(p_rejection_reason) end
      where sale_id = p_sale;
  else
    update sales set payment_2_status = case when p_approve then 'Terverifikasi' else 'Ditolak' end,
      payment_2_reviewed_at = now(), payment_2_rejection_reason = case when p_approve then null else trim(p_rejection_reason) end
      where sale_id = p_sale;
  end if;

  v_new_paid := v_paid + case when p_approve then v_amount else 0 end;
  update sales set paid_total = v_new_paid,
    payment_status = case
      when v_other_status = 'Menunggu Verifikasi' then 'Menunggu Verifikasi'
      when v_new_paid >= v_total then 'Lunas'
      when v_new_paid > 0 then 'DP'
      when not p_approve then 'Ditolak'
      else 'Belum Bayar' end
    where sale_id = p_sale;
end $$;

create or replace function set_sale_fulfillment(p_sale bigint, p_fulfillment_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_fulfillment_status not in ('Diterima','Diproses','Siap Diambil','Selesai') then raise exception 'Status pesanan tidak valid'; end if;
  update sales set fulfillment_status = p_fulfillment_status
    where sale_id = p_sale and status = 'selesai';
  if not found then raise exception 'Pesanan aktif tidak ditemukan'; end if;
end $$;

create or replace function reconcile_sale_payment(p_sale bigint, p_paid_total numeric)
returns void language plpgsql security definer set search_path = public as $$
declare v_paid numeric; v_total numeric; v_status text; v_method text; v_sale_date timestamptz;
begin
  if not public.is_app_admin() then raise exception 'Hanya admin yang dapat memverifikasi pembayaran lama'; end if;
  if p_paid_total is null or p_paid_total < 0 then raise exception 'Nominal pembayaran tidak valid'; end if;
  select paid_total, total, status, payment_method, sale_date into v_paid, v_total, v_status, v_method, v_sale_date
    from sales where sale_id = p_sale for update;
  if v_status is null then raise exception 'Transaksi tidak ditemukan'; end if;
  if v_status <> 'selesai' then raise exception 'Transaksi batal tidak dapat diverifikasi'; end if;
  if v_paid is not null then raise exception 'Pembayaran transaksi ini sudah tercatat'; end if;
  if p_paid_total > v_total then raise exception 'Pembayaran tidak boleh melebihi total transaksi'; end if;
  update sales set paid_total = p_paid_total,
    payment_1_amount = p_paid_total,
    payment_1_method = v_method,
    payment_1_status = case when p_paid_total > 0 then 'Terverifikasi' else 'Belum Dibayar' end,
    payment_1_at = case when p_paid_total > 0 then v_sale_date else null end,
    payment_plan = case when p_paid_total > 0 and p_paid_total < v_total then 'DP 50%' else payment_plan end,
    payment_status = case when v_total = 0 then 'Lunas'
                          when p_paid_total = 0 then 'Belum Bayar'
                          when p_paid_total >= v_total then 'Lunas' else 'DP' end
    where sale_id = p_sale;
end $$;

-- Batalkan transaksi: stok dikembalikan, data tetap ada dengan status 'batal'
create or replace function cancel_sale(p_sale bigint) returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from sales where sale_id = p_sale for update;
  if v_status is null then raise exception 'Transaksi tidak ditemukan'; end if;
  if v_status <> 'selesai' then raise exception 'Transaksi sudah dibatalkan'; end if;
  update products p set stock = p.stock + d.q
    from (select product_id, sum(qty) q from sale_details where sale_id = p_sale group by product_id) d
    where p.product_id = d.product_id;
  update sales set status = 'batal', fulfillment_status = 'Dibatalkan' where sale_id = p_sale;
end $$;

-- RLS: pengguna login mengelola pelanggan/produk; transaksi hanya dibaca langsung.
do $$ declare t text; begin
  foreach t in array array['customers','products'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists demo_all on %I', t);
    execute format('drop policy if exists auth_all on %I', t);
    execute format('create policy auth_all on %I for all to authenticated using (true) with check (true)', t);
  end loop; end $$;

-- Pembayaran dan detail pesanan hanya bisa diubah melalui fungsi transaksi.
do $$ declare t text; begin
  foreach t in array array['sales','sale_details'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists auth_all on %I', t);
    execute format('drop policy if exists auth_read on %I', t);
    execute format('create policy auth_read on %I for select to authenticated using (true)', t);
    execute format('revoke insert, update, delete on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
  end loop; end $$;

-- Storage bukti privat; hanya admin dapat membaca dan meninjau file.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];
drop policy if exists payment_proofs_upload on storage.objects;
create policy payment_proofs_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and name ~ '^[0-9]+/[a-f0-9-]+\.(png|jpg|jpeg|webp|pdf)$');
drop policy if exists payment_proofs_staging_read on storage.objects;
drop policy if exists payment_proofs_move on storage.objects;
drop policy if exists payment_proofs_admin_read on storage.objects;
create policy payment_proofs_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.is_app_admin());
drop policy if exists payment_proofs_cleanup on storage.objects;
create policy payment_proofs_cleanup on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and (public.is_app_admin() or not exists (
    select 1 from public.sales s where s.payment_1_proof_path = name or s.payment_2_proof_path = name
  )));

revoke all on function is_app_admin() from public, anon;
grant execute on function is_app_admin() to authenticated;
revoke all on function add_product_stock(bigint, integer) from public, anon;
grant execute on function add_product_stock(bigint, integer) to authenticated;
revoke all on function create_sale(bigint, text, text, date, text, jsonb) from public, anon;
grant execute on function create_sale(bigint, text, text, date, text, jsonb) to authenticated;
revoke all on function update_sale(bigint, bigint, text, date, text, jsonb) from public, anon;
grant execute on function update_sale(bigint, bigint, text, date, text, jsonb) to authenticated;
revoke all on function cancel_sale(bigint) from public, anon;
grant execute on function cancel_sale(bigint) to authenticated;
revoke all on function submit_payment_proof(bigint, smallint, numeric, text, text) from public, anon;
grant execute on function submit_payment_proof(bigint, smallint, numeric, text, text) to authenticated;
revoke all on function review_payment_proof(bigint, smallint, boolean, text) from public, anon;
grant execute on function review_payment_proof(bigint, smallint, boolean, text) to authenticated;
revoke all on function set_sale_fulfillment(bigint, text) from public, anon;
grant execute on function set_sale_fulfillment(bigint, text) to authenticated;
revoke all on function reconcile_sale_payment(bigint, numeric) from public, anon;
grant execute on function reconcile_sale_payment(bigint, numeric) to authenticated;

-- Data contoh: hanya masuk jika tabelnya masih kosong (tidak menggandakan data saat dijalankan ulang)
insert into products(name, price, stock)
select * from (values ('Buket Mawar Pink',185000,10),('Bunga Meja Tulip',120000,8),
  ('Standing Flower Duka Cita',350000,5),('Baby Breath Vase',95000,12)) v(name, price, stock)
where not exists (select 1 from products);
insert into customers(name, phone, address)
select * from (values ('Sari Wulandari','081234567890','Semarang'),('Dinda Pratama','082198765432','Ungaran')) v(name, phone, address)
where not exists (select 1 from customers);

notify pgrst, 'reload schema';  -- muat ulang cache API agar fungsi baru langsung dikenali
