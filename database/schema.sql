-- Bouquet by Reva - Supabase: SQL Editor > New query > Run (aman dijalankan ulang)
--
-- ERD:
--   customers (customer_id PK, name, phone, address, created_at)
--       1 ---< sales (sale_id PK, customer_id FK wajib, sale_date, total,
--                     payment_method [QRIS|Transfer], payment_status [DP|Lunas], status [selesai|batal])
--                    1 ---< sale_details (detail_id PK, sale_id FK, product_id FK, qty, unit_price, subtotal)
--   products (product_id PK, name, price, stock, created_at)
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
  created_at timestamptz not null default now()
);

create table if not exists sales (
  sale_id bigint generated always as identity primary key,
  customer_id bigint not null references customers(customer_id) on delete restrict,
  sale_date timestamptz not null default now(),
  total numeric(12,2) not null default 0,
  payment_method text not null,
  payment_status text not null default 'Lunas' check (payment_status in ('DP','Lunas')),
  status text not null default 'selesai' check (status in ('selesai','batal'))  -- internal: transaksi aktif / dibatalkan
);
-- Penyesuaian jika tabel sales versi lama sudah ada
alter table sales add column if not exists status text not null default 'selesai' check (status in ('selesai','batal'));
alter table sales add column if not exists payment_status text not null default 'Lunas' check (payment_status in ('DP','Lunas'));
alter table sales alter column payment_method drop default;

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

-- Metode pembayaran hanya QRIS atau Transfer
alter table sales drop constraint if exists chk_sales_payment;
alter table sales add constraint chk_sales_payment check (payment_method in ('QRIS','Transfer')) not valid;
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

-- Signature fungsi berubah (tambah p_pay_status): hapus versi lama agar tidak ada duplikat
drop function if exists create_sale(bigint, text, jsonb);
drop function if exists update_sale(bigint, bigint, text, jsonb);

-- Transaksi baru (atomik): harga dari database, stok berkurang, gagal = rollback semua
create or replace function create_sale(p_customer bigint, p_payment text, p_pay_status text, p_items jsonb)
returns bigint language plpgsql as $$
declare v_id bigint; it jsonb; v_price numeric; v_total numeric := 0; v_qty int; v_pid bigint;
begin
  if p_customer is null then raise exception 'Pelanggan harus dipilih'; end if;
  if p_payment is null or p_payment not in ('QRIS','Transfer') then raise exception 'Metode pembayaran harus QRIS atau Transfer'; end if;
  if p_pay_status is null or p_pay_status not in ('DP','Lunas') then raise exception 'Status pembayaran harus DP atau Lunas'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Keranjang kosong'; end if;
  insert into sales(customer_id, payment_method, payment_status) values (p_customer, p_payment, p_pay_status) returning sale_id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    v_pid := (it->>'product_id')::bigint; v_qty := (it->>'qty')::int;
    select price into v_price from products where product_id = v_pid for update;
    if v_price is null then raise exception 'Produk % tidak ditemukan', v_pid; end if;
    update products set stock = stock - v_qty where product_id = v_pid;  -- CHECK stock>=0 menolak jika kurang
    insert into sale_details(sale_id, product_id, qty, unit_price) values (v_id, v_pid, v_qty, v_price);
    v_total := v_total + v_price * v_qty;
  end loop;
  update sales set total = v_total where sale_id = v_id;
  return v_id;
end $$;

-- Ubah transaksi: stok lama dikembalikan, item diganti, total dihitung ulang.
-- Produk yang sudah ada mempertahankan harga lama; produk baru memakai harga saat ini.
create or replace function update_sale(p_sale bigint, p_customer bigint, p_payment text, p_pay_status text, p_items jsonb)
returns bigint language plpgsql as $$
declare v_status text; v_old jsonb; it jsonb; v_pid bigint; v_qty int; v_price numeric; v_total numeric := 0;
begin
  if p_customer is null then raise exception 'Pelanggan harus dipilih'; end if;
  if p_payment is null or p_payment not in ('QRIS','Transfer') then raise exception 'Metode pembayaran harus QRIS atau Transfer'; end if;
  if p_pay_status is null or p_pay_status not in ('DP','Lunas') then raise exception 'Status pembayaran harus DP atau Lunas'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'Keranjang kosong'; end if;
  select status into v_status from sales where sale_id = p_sale for update;
  if v_status is distinct from 'selesai' then raise exception 'Transaksi tidak bisa diubah'; end if;
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
  update sales set customer_id = p_customer, payment_method = p_payment, payment_status = p_pay_status, total = v_total
    where sale_id = p_sale;
  return p_sale;
end $$;

-- Batalkan transaksi: stok dikembalikan, data tetap ada dengan status 'batal'
create or replace function cancel_sale(p_sale bigint) returns void language plpgsql as $$
declare v_status text;
begin
  select status into v_status from sales where sale_id = p_sale for update;
  if v_status is null then raise exception 'Transaksi tidak ditemukan'; end if;
  if v_status <> 'selesai' then raise exception 'Transaksi sudah dibatalkan'; end if;
  update products p set stock = p.stock + d.q
    from (select product_id, sum(qty) q from sale_details where sale_id = p_sale group by product_id) d
    where p.product_id = d.product_id;
  update sales set status = 'batal' where sale_id = p_sale;
end $$;

-- RLS: hanya user yang login (Supabase Auth) yang boleh membaca/menulis
do $$ declare t text; begin
  foreach t in array array['customers','products','sales','sale_details'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists demo_all on %I', t);
    execute format('drop policy if exists auth_all on %I', t);
    execute format('create policy auth_all on %I for all to authenticated using (true) with check (true)', t);
  end loop; end $$;

-- Data contoh: hanya masuk jika tabelnya masih kosong (tidak menggandakan data saat dijalankan ulang)
insert into products(name, price, stock)
select * from (values ('Buket Mawar Pink',185000,10),('Bunga Meja Tulip',120000,8),
  ('Standing Flower Duka Cita',350000,5),('Baby Breath Vase',95000,12)) v(name, price, stock)
where not exists (select 1 from products);
insert into customers(name, phone, address)
select * from (values ('Sari Wulandari','081234567890','Semarang'),('Dinda Pratama','082198765432','Ungaran')) v(name, phone, address)
where not exists (select 1 from customers);

notify pgrst, 'reload schema';  -- muat ulang cache API agar fungsi baru langsung dikenali
