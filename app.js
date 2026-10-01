// BACKEND (lapisan data): semua akses ke Supabase ada di sini.
// Catatan: file ini tetap berjalan di browser (Supabase adalah backend-nya). Butuh `db` dari backend/config.js.
// ===== Data layer (akses Supabase) =====
const API = {
  list: (t, order) => db.from(t).select('*').order(order, { ascending: false }),
  save: (t, idc, obj, id) => id ? db.from(t).update(obj).eq(idc, id) : db.from(t).insert(obj),
  del: (t, idc, id) => db.from(t).delete().eq(idc, id),
  sales: () => db.from('sales').select('sale_id,customer_id,sale_date,total,payment_method,payment_status,status,customers(name),sale_details(product_id,qty,unit_price,products(name))').order('sale_date', { ascending: false }).limit(50),
  createSale: (c, p, st, items) => db.rpc('create_sale', { p_customer: c, p_payment: p, p_pay_status: st, p_items: items }),
  updateSale: (id, c, p, st, items) => db.rpc('update_sale', { p_sale: id, p_customer: c, p_payment: p, p_pay_status: st, p_items: items }),
  cancelSale: id => db.rpc('cancel_sale', { p_sale: id }),
  // Auth
  signIn: (email, password) => db.auth.signInWithPassword({ email, password }),
  signOut: () => db.auth.signOut(),
  onAuth: cb => db.auth.onAuthStateChange((_ev, sess) => cb(sess)),
  // Laporan (hanya transaksi berstatus 'selesai')
  reportSales: (from, to) => db.from('sales').select('sale_date,total').eq('status', 'selesai').gte('sale_date', from).lt('sale_date', to),
  reportItems: (from, to) => db.from('sale_details').select('qty,products(name),sales!inner(status,sale_date)').eq('sales.status', 'selesai').gte('sales.sale_date', from).lt('sales.sale_date', to)
};