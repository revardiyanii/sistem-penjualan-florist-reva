// BACKEND (lapisan data): semua akses ke Supabase ada di sini.
// Catatan: file ini tetap berjalan di browser (Supabase adalah backend-nya). Butuh `db` dari backend/config.js.
// ===== Data layer (akses Supabase) =====
const API = {
  list: (t, order) => db.from(t).select('*').order(order, { ascending: false }),
  save: (t, idc, obj, id) => id ? db.from(t).update(obj).eq(idc, id) : db.from(t).insert(obj),
  del: (t, idc, id) => db.from(t).delete().eq(idc, id),
  addProductStock: (id, quantity) => db.rpc('add_product_stock', { p_product_id: id, p_quantity: quantity }),
  sales: async (page, filters, pageSize = 20) => {
    let query = db.from('sales')
      .select('sale_id,customer_id,sale_date,total,paid_total,payment_method,payment_status,payment_plan,status,pickup_date,order_notes,fulfillment_status,payment_1_amount,payment_1_method,payment_1_status,payment_1_proof_path,payment_1_at,payment_1_rejection_reason,payment_2_amount,payment_2_method,payment_2_status,payment_2_proof_path,payment_2_at,payment_2_rejection_reason,customers(name,phone),sale_details(product_id,qty,unit_price,products(name))', { count: 'exact' })
      .order('sale_date', { ascending: false }).order('sale_id', { ascending: false });
    if (filters.from) query = query.gte('sale_date', filters.from);
    if (filters.to) query = query.lt('sale_date', filters.to);
    if (filters.saleId && filters.customerIds?.length) {
      query = query.or(`sale_id.eq.${filters.saleId},customer_id.in.(${filters.customerIds.join(',')})`);
    } else if (filters.saleId) query = query.eq('sale_id', filters.saleId);
    else if (filters.customerIds) {
      if (!filters.customerIds.length) return { data: { rows: [], count: 0 }, error: null };
      query = query.in('customer_id', filters.customerIds);
    }
    const { data, error, count } = await query.range((page - 1) * pageSize, page * pageSize - 1);
    return { data: data ? { rows: data, count: count ?? 0 } : null, error };
  },
  payment: async (id, stage) => {
    const { data, error } = await db.from('sales')
      .select('sale_id,payment_1_amount,payment_1_method,payment_1_status,payment_1_proof_path,payment_1_at,payment_1_rejection_reason,payment_2_amount,payment_2_method,payment_2_status,payment_2_proof_path,payment_2_at,payment_2_rejection_reason')
      .eq('sale_id', id).single();
    if (error) return { data: null, error };
    const n = `payment_${stage}`;
    return { data: { sale_id: data.sale_id, stage, amount: data[`${n}_amount`], payment_method: data[`${n}_method`], verification_status: data[`${n}_status`], proof_path: data[`${n}_proof_path`], paid_at: data[`${n}_at`], rejection_reason: data[`${n}_rejection_reason`] }, error: null };
  },
  createSale: (c, p, plan, pickup, notes, items) => db.rpc('create_sale', {
    p_customer: c, p_payment: p, p_payment_plan: plan, p_pickup_date: pickup || null, p_order_notes: notes, p_items: items
  }),
  saleSummary: id => db.from('sales').select('sale_id,total,payment_plan,payment_method').eq('sale_id', id).single(),
  updateSale: (id, c, p, pickup, notes, items) => db.rpc('update_sale', {
    p_sale: id, p_customer: c, p_payment: p, p_pickup_date: pickup || null, p_order_notes: notes, p_items: items
  }),
  cancelSale: id => db.rpc('cancel_sale', { p_sale: id }),
  submitProof: (id, stage, amount, method, path) => db.rpc('submit_payment_proof', { p_sale: id, p_stage: stage, p_amount: amount, p_method: method, p_proof_path: path }),
  reviewProof: (id, stage, approve, reason) => db.rpc('review_payment_proof', { p_sale: id, p_stage: stage, p_approve: approve, p_rejection_reason: reason }),
  updateFulfillment: (id, status) => db.rpc('set_sale_fulfillment', { p_sale: id, p_fulfillment_status: status }),
  isAdmin: () => db.rpc('is_app_admin'),
  uploadProof: (path, file) => db.storage.from('payment-proofs').upload(path, file, { contentType: file.type, upsert: false }),
  removeProof: path => db.storage.from('payment-proofs').remove([path]),
  signedProofUrl: path => db.storage.from('payment-proofs').createSignedUrl(path, 600),
  paymentsReceived: async (from, to) => {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from('sales').select('payment_1_amount,payment_1_status,payment_1_at,payment_2_amount,payment_2_status,payment_2_at')
        .or(`and(payment_1_status.eq.Terverifikasi,payment_1_at.gte.${from},payment_1_at.lt.${to}),and(payment_2_status.eq.Terverifikasi,payment_2_at.gte.${from},payment_2_at.lt.${to})`)
        .order('sale_id').range(offset, offset + 999);
      if (error) return { data: null, error };
      data.forEach(sale => [1, 2].forEach(stage => {
        const prefix = `payment_${stage}_`;
        const paidAt = sale[`${prefix}at`];
        if (sale[`${prefix}status`] === 'Terverifikasi' && paidAt >= from && paidAt < to) {
          rows.push({ amount: sale[`${prefix}amount`], paid_at: paidAt });
        }
      }));
      if (data.length < 1000) return { data: rows, error: null };
    }
  },
  reconcilePayment: (id, amount) => db.rpc('reconcile_sale_payment', { p_sale: id, p_paid_total: amount }),
  // Auth
  signIn: (email, password) => db.auth.signInWithPassword({ email, password }),
  signOut: () => db.auth.signOut(),
  onAuth: cb => db.auth.onAuthStateChange((_ev, sess) => cb(sess)),
  // Laporan (hanya transaksi berstatus 'selesai'), diambil per halaman agar tidak terpotong batas API.
  reportSales: async (from, to) => {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from('sales').select('sale_date,total,paid_total')
        .eq('status', 'selesai').gte('sale_date', from).lt('sale_date', to)
        .order('sale_date').range(offset, offset + 999);
      if (error) return { data: null, error };
      rows.push(...data);
      if (data.length < 1000) return { data: rows, error: null };
    }
  },
  reportItems: async (from, to) => {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db.from('sale_details').select('qty,products(name),sales!inner(status,sale_date)')
        .eq('sales.status', 'selesai').gte('sales.sale_date', from).lt('sales.sale_date', to)
        .order('detail_id').range(offset, offset + 999);
      if (error) return { data: null, error };
      rows.push(...data);
      if (data.length < 1000) return { data: rows, error: null };
    }
  }
};