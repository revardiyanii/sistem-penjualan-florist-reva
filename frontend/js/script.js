// FRONTEND (tampilan & event). Data diambil lewat objek API di backend/app.js. (file: script.js)
// ===== Helper =====
const $ = s => document.querySelector(s);
const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const parseRupiah = value => {
  if (value === null) return null;
  const normalized = value.trim().replace(/^Rp\s*/i, '').replace(/[.,\s]/g, '');
  return /^\d+$/.test(normalized) ? Number(normalized) : NaN;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const salePaymentMethods = sale => {
  const methods = [1, 2].map(stage => {
    const status = sale[`payment_${stage}_status`], method = sale[`payment_${stage}_method`];
    if (status === 'Belum Dibayar' || !method) return null;
    return method;
  }).filter(Boolean);
  const uniqueMethods = [...new Set(methods)];
  return uniqueMethods.length ? uniqueMethods.join(' / ') : sale.payment_method || 'Metode tidak tersedia';
};
const salePaymentStatus = sale => {
  const status = sale.payment_status === 'Menunggu Verifikasi' && sale.payment_plan === 'DP 50%'
    ? 'DP' : sale.paid_total == null ? 'Perlu verifikasi' : sale.payment_status || 'Belum Bayar';
  return status;
};
const saleOutstanding = sale => {
  if (sale.payment_status === 'Lunas') return 0;
  if (salePaymentStatus(sale) === 'DP') return Math.round(Number(sale.total) * 50) / 100;
  return sale.paid_total == null ? null : Math.max(0, Number(sale.total) - Number(sale.paid_total));
};
const updateTodayDate = () => {
  const now = new Date();
  $('#todayDate').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  setTimeout(updateTodayDate, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now);
};
updateTodayDate();
const toast = (m, err) => { const t = $('#toast'); t.textContent = m; t.className = 'show' + (err ? ' err' : ''); setTimeout(() => t.className = '', 3000); };
const run = async (p, ok) => { const { data, error } = await p; if (error) { toast(error.code === '23503' ? 'Data ini masih terhubung dengan transaksi, sehingga tidak bisa dihapus' : error.message, 1); return null; } if (ok) toast(ok); return data ?? true; };

let customers = [], products = [], cart = [], salesCache = [], editSale = null, editOrig = {}, editPrice = {}, salePage = 1;
let isAdmin = false, activeReviewId = null, activePayoffSaleId = null, activeCustomerId = null, activeProductId = null, activeCartIndex = null;
const salePageSize = 20;
const avail = p => p.stock + (editOrig[p.product_id] || 0); // stok tersedia (termasuk qty transaksi yang sedang diubah)

// ===== Navigasi =====
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('main section').forEach(s => s.hidden = s.id !== b.dataset.v);
  load();
});

// ===== CRUD generik =====
function bindForm(fid, table, idc, fields, after) {
  const f = $(fid);
  f.onsubmit = async e => {
    e.preventDefault();
    const o = {}; fields.forEach(k => o[k] = f[k].value.trim() || null);
    ['price', 'stock', 'low_stock_threshold'].forEach(k => { if (k in o) o[k] = Number(o[k] || 0); });
    const r = await run(API.save(table, idc, o, f.rid.value || null), 'Tersimpan');
    if (r) { f.reset(); f.rid.value = ''; after(); }
  };
}
const fill = (fid, obj) => { const f = $(fid); Object.keys(obj).forEach(k => { if (f[k]) f[k].value = obj[k] ?? ''; }); f.scrollIntoView({ behavior: 'smooth' }); };
const remove = async (t, idc, id, after) => { if (confirm('Hapus data ini?') && await run(API.del(t, idc, id), 'Terhapus')) after(); };

window.editC = id => fill('#fC', { ...customers.find(x => x.customer_id === id), rid: id });
window.openCustomerActions = id => {
  const customer = customers.find(x => x.customer_id === id);
  if (!customer) return;
  activeCustomerId = id;
  $('#customerActionsName').textContent = customer.name;
  $('#customerActions').showModal();
};
$('#editCustomer').onclick = () => {
  if (activeCustomerId === null) return;
  const id = activeCustomerId;
  $('#customerActions').close();
  activeCustomerId = null;
  window.editC(id);
};
$('#deleteCustomer').onclick = async () => {
  if (activeCustomerId === null) return;
  const id = activeCustomerId;
  const customer = customers.find(x => x.customer_id === id);
  if (!confirm(`Hapus data pelanggan${customer ? ` "${customer.name}"` : ''}? Tindakan ini tidak dapat dibatalkan.`)) return;
  if (await run(API.del('customers', 'customer_id', id), 'Data pelanggan berhasil dihapus')) {
    $('#customerActions').close();
    activeCustomerId = null;
    if ($('#fC').rid.value === String(id)) $('#fC').reset();
    await load();
  }
};
$('#closeCustomerActions').onclick = () => {
  $('#customerActions').close();
  activeCustomerId = null;
};
$('#customerActions').addEventListener('close', () => { activeCustomerId = null; });
window.editP = id => fill('#fP', { ...products.find(x => x.product_id === id), rid: id });
window.openProductActions = id => {
  const product = products.find(x => x.product_id === id);
  if (!product) return;
  activeProductId = id;
  $('#productActionsName').textContent = product.name;
  $('#productActions').showModal();
};
$('#editProduct').onclick = () => {
  if (activeProductId === null) return;
  const id = activeProductId;
  $('#productActions').close();
  activeProductId = null;
  window.editP(id);
};
$('#deleteProduct').onclick = async () => {
  if (activeProductId === null) return;
  const id = activeProductId;
  const product = products.find(x => x.product_id === id);
  if (!confirm(`Hapus data produk${product ? ` "${product.name}"` : ''}? Tindakan ini tidak dapat dibatalkan.`)) return;
  if (await run(API.del('products', 'product_id', id), 'Data produk berhasil dihapus')) {
    $('#productActions').close();
    activeProductId = null;
    if ($('#fP').rid.value === String(id)) $('#fP').reset();
    await load();
  }
};
$('#closeProductActions').onclick = () => {
  $('#productActions').close();
  activeProductId = null;
};
$('#productActions').addEventListener('close', () => { activeProductId = null; });

// ===== Render =====
const actions = (e, d) => `<td class="act"><button onclick="${e}">Ubah</button><button class="del" onclick="${d}">Hapus</button></td>`;
function renderProducts() {
  const sort = $('#productSort').value;
  const sortedProducts = [...products].sort((a, b) => sort === 'name'
    ? (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' })
    : new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  $('#tP').innerHTML = sortedProducts.map(x => `<tr class="${Number(x.stock) === 0 ? 'out-of-stock' : ''}"><td><button class="product-name" type="button" onclick="openProductActions(${x.product_id})" aria-haspopup="dialog">${esc(x.name)}</button></td><td>${rp(x.price)}</td><td><span class="badge ${Number(x.stock) <= Number(x.low_stock_threshold ?? 3) ? 'no' : 'ok'}">${x.stock}</span></td><td><form class="add-stock-form" onsubmit="addProductStock(event,${x.product_id})"><input name="quantity" type="number" min="1" step="1" required aria-label="Jumlah stok yang ditambahkan untuk ${esc(x.name)}"><button type="submit" class="btn">Tambah</button></form></td></tr>`).join('') || '<tr><td colspan="4">Belum ada produk</td></tr>';
}
window.addProductStock = async (event, id) => {
  event.preventDefault();
  const form = event.currentTarget, quantity = Number(form.quantity.value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return toast('Jumlah stok yang ditambahkan harus bilangan bulat lebih dari 0', 1);
  if (!isAdmin) return toast('Akun ini belum memiliki hak Admin di Supabase Auth', 1);
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const productName = products.find(product => product.product_id === id)?.name || 'Produk';
    if (await run(API.addProductStock(id, quantity), `Stok ${productName} berhasil ditambah ${quantity}`)) {
      await load();
    }
  } finally {
    button.disabled = false;
  }
};
function renderCustomers() {
  const sort = $('#customerSort').value;
  const sortedCustomers = [...customers].sort((a, b) => sort === 'name'
    ? (a.name || '').localeCompare(b.name || '', 'id', { sensitivity: 'base' })
    : new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  $('#tC').innerHTML = sortedCustomers.map(x => `<tr><td><button class="customer-name" type="button" onclick="openCustomerActions(${x.customer_id})" aria-haspopup="dialog">${esc(x.name)}</button></td><td>${esc(x.phone)}</td><td>${esc(x.address)}</td></tr>`).join('') || '<tr><td colspan="3">Belum ada pelanggan</td></tr>';
}
async function load() {
  const v = document.querySelector('nav .on').dataset.v;
  const [c, p] = await Promise.all([run(API.list('customers', 'created_at')), run(API.list('products', 'created_at'))]);
  customers = c || []; products = p || [];
  if (v === 'vC') renderCustomers();
  if (v === 'vP') renderProducts();
  if (v === 'vS') { renderSaleForm(); await renderHistory(); }
  if (v === 'vG') await renderChart();
}
$('#customerSort').onchange = renderCustomers;
$('#productSort').onchange = renderProducts;
function renderSaleForm() {
  const selectedCustomer = Number($('#sCust').value);
  if (selectedCustomer && customers.some(c => c.customer_id === selectedCustomer)) setSaleCustomer(selectedCustomer);
  else $('#sCust').value = '';
  $('#sProd').innerHTML = '<option value="" disabled selected>Pilih produk buket</option>' + products.filter(p => avail(p) > 0).map(p => `<option value="${p.product_id}">${esc(p.name)} (stok ${avail(p)})</option>`).join('');
  renderCart();
}
function setSaleCustomer(id) {
  const customer = customers.find(c => c.customer_id === Number(id));
  $('#sCust').value = customer ? String(customer.customer_id) : '';
  $('#sCustSearch').value = customer?.name || '';
  $('#sCustOptions').hidden = true;
  $('#sCustSearch').setAttribute('aria-expanded', 'false');
}
function renderCustomerOptions() {
  const query = $('#sCustSearch').value.trim().toLocaleLowerCase('id-ID');
  const matches = customers.filter(c => `${c.name || ''} ${c.phone || ''}`.toLocaleLowerCase('id-ID').includes(query)).slice(0, 10);
  $('#sCustOptions').innerHTML = matches.map(c => `<button type="button" role="option" aria-selected="false" data-customer-id="${c.customer_id}">${esc(c.name)}${c.phone ? `<small>${esc(c.phone)}</small>` : ''}</button>`).join('')
    || '<span class="muted">Pelanggan tidak ditemukan</span>';
  $('#sCustOptions').hidden = false;
  $('#sCustSearch').setAttribute('aria-expanded', 'true');
}
$('#sCustSearch').oninput = () => {
  $('#sCust').value = '';
  renderCustomerOptions();
};
$('#sCustSearch').onfocus = renderCustomerOptions;
$('#sCustSearch').onkeydown = event => {
  if (event.key === 'Escape') {
    $('#sCustOptions').hidden = true;
    $('#sCustSearch').setAttribute('aria-expanded', 'false');
  } else if (event.key === 'Enter' && !$('#sCustOptions').hidden) {
    const first = $('#sCustOptions [data-customer-id]');
    if (first) {
      event.preventDefault();
      setSaleCustomer(first.dataset.customerId);
    }
  }
};
$('#sCustOptions').onclick = event => {
  const option = event.target.closest('[data-customer-id]');
  if (option) setSaleCustomer(option.dataset.customerId);
};
document.addEventListener('click', event => {
  if (!event.target.closest('.sale-customer-picker')) {
    $('#sCustOptions').hidden = true;
    $('#sCustSearch').setAttribute('aria-expanded', 'false');
  }
});
function renderCart() {
  let total = 0;
  $('#cart').innerHTML = cart.map((i, n) => {
    const p = products.find(x => x.product_id === i.product_id), price = editPrice[i.product_id] ?? p?.price ?? 0, sub = price * i.qty; total += sub;
    return `<tr><td><button class="cart-product-name" type="button" onclick="openCartItemActions(${n})" aria-haspopup="dialog">${esc(p?.name)}</button></td><td>${i.qty}</td><td>${rp(price)}</td><td><b>${rp(sub)}</b></td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">Keranjang kosong</td></tr>';
  $('#total').textContent = rp(total);
}
window.openCartItemActions = index => {
  const item = cart[index], product = item && products.find(x => x.product_id === item.product_id);
  if (!product) return;
  activeCartIndex = index;
  $('#cartItemActionsName').textContent = `${product.name} · Kuantitas ${item.qty}`;
  $('#cartItemActionButtons').hidden = false;
  $('#cartItemEditForm').hidden = true;
  $('#cartItemActions').showModal();
};
$('#editCartItem').onclick = () => {
  if (activeCartIndex === null) return;
  const item = cart[activeCartIndex], product = item && products.find(x => x.product_id === item.product_id);
  if (!item || !product) return;
  $('#cartItemQty').value = item.qty;
  $('#cartItemStock').textContent = `Stok tersedia: ${avail(product)}`;
  $('#cartItemActionButtons').hidden = true;
  $('#cartItemEditForm').hidden = false;
  $('#cartItemQty').focus();
};
$('#cartItemEditForm').onsubmit = event => {
  event.preventDefault();
  if (activeCartIndex === null) return;
  const item = cart[activeCartIndex], product = item && products.find(x => x.product_id === item.product_id);
  const qty = Number($('#cartItemQty').value);
  if (!item || !product || !Number.isInteger(qty) || qty < 1) return toast('Kuantitas harus berupa bilangan bulat minimal 1', 1);
  if (qty > avail(product)) return toast('Stok tidak tersedia', 1);
  item.qty = qty;
  $('#cartItemActions').close();
  activeCartIndex = null;
  renderCart();
};
$('#deleteCartItem').onclick = () => {
  if (activeCartIndex === null) return;
  const item = cart[activeCartIndex], product = item && products.find(x => x.product_id === item.product_id);
  if (!confirm(`Hapus ${product?.name || 'item ini'} dari keranjang?`)) return;
  cart.splice(activeCartIndex, 1);
  $('#cartItemActions').close();
  activeCartIndex = null;
  renderCart();
};
$('#closeCartItemActions').onclick = $('#cancelCartItemEdit').onclick = () => $('#cartItemActions').close();
$('#cartItemActions').addEventListener('close', () => { activeCartIndex = null; });
async function renderHistory() {
  let result = await run(API.sales(salePage, salesFilters(), salePageSize));
  let rows = result?.rows || [], total = result?.count || 0;
  const pageCount = Math.ceil(total / salePageSize);
  if (pageCount && salePage > pageCount) {
    salePage = pageCount;
    result = await run(API.sales(salePage, salesFilters(), salePageSize));
    rows = result?.rows || [];
  }
  salesCache = rows;
  const fD = t => new Date(t).toLocaleDateString('en-GB');
  $('#tS').innerHTML = salesCache.map((x, index) => { const ok = x.status === 'selesai';
    const rowNumber = (salePage - 1) * salePageSize + index + 1;
    const quantity = x.sale_details.reduce((sum, detail) => sum + Number(detail.qty || 0), 0);
    const order = [...new Set(x.sale_details.map(d => d.products?.name || 'Produk dihapus'))].map(name => `<div>${esc(name)}</div>`).join('');
    const payments = [1, 2].map(stage => ({
      stage, amount: x[`payment_${stage}_amount`], method: x[`payment_${stage}_method`],
      status: x[`payment_${stage}_status`], reason: x[`payment_${stage}_rejection_reason`]
    })).filter(p => p.status !== 'Belum Dibayar');
    const pending = payments.some(p => p.status === 'Menunggu Verifikasi');
    const paymentStatus = salePaymentStatus(x);
    const paymentTone = ['Belum Bayar','Menunggu Verifikasi','Ditolak','Perlu verifikasi'].includes(paymentStatus)
      ? 'no' : paymentStatus === 'DP' ? 'dp' : 'ok';
    const methods = salePaymentMethods(x);
    const paymentLabel = x.status !== 'selesai'
      ? `${methods} DIBATALKAN`
      : `${methods} ${salePaymentStatus(x)}`;
    const paymentCell = `<span class="badge ${paymentTone}">${esc(paymentLabel)}</span>`;
    const balance = saleOutstanding(x);
    let balanceAction = '', statusActions = '';
    if (ok && x.paid_total == null && isAdmin) {
      statusActions += `<button onclick="reconcilePayment(${x.sale_id})">Verifikasi data lama</button>`;
    }
    if (ok && paymentStatus === 'DP' && x.payment_1_status === 'Terverifikasi') {
      if (x.payment_2_status === 'Menunggu Verifikasi') {
        balanceAction = `<button onclick="reviewProof(${x.sale_id},2)">Tandai Lunas</button>`;
      } else {
        balanceAction = `<button onclick="openPayoff(${x.sale_id})">Tandai Lunas</button>`;
      }
    } else if (ok && Number(x.paid_total || 0) < Number(x.total) && !pending) {
      if (isAdmin && payments.some(p => p.status === 'Menunggu Verifikasi')) {
        statusActions += payments.filter(p => p.status === 'Menunggu Verifikasi')
          .map(p => `<button onclick="reviewProof(${x.sale_id},${p.stage})">Tinjau Pembayaran</button>`).join('');
      } else if (!payments.some(p => p.status === 'Menunggu Verifikasi') && (!isAdmin || paymentStatus !== 'DP')) {
        statusActions += `<button onclick="uploadProof(${x.sale_id})">Upload Bukti Pembayaran</button>`;
      }
    } else if (ok && pending && isAdmin) {
      statusActions += payments.filter(p => p.status === 'Menunggu Verifikasi')
        .map(p => `<button onclick="reviewProof(${x.sale_id},${p.stage})">${p.stage === 2 ? 'Tandai Lunas' : 'Tinjau Pembayaran'}</button>`).join('');
    }
    if (ok && payments.length === 0 && Number(x.paid_total || 0) === 0) {
      statusActions += `<button onclick="editS(${x.sale_id})">Ubah</button>`;
    }
    if (ok) statusActions += `<button class="del" onclick="cancelS(${x.sale_id})">Batalkan</button>`;
    const canOpenPayoff = ok && paymentStatus === 'DP'
      && x.payment_1_status === 'Terverifikasi'
      && !['Menunggu Verifikasi', 'Terverifikasi'].includes(x.payment_2_status);
    const balanceCell = balance === null ? 'Perlu verifikasi'
      : canOpenPayoff ? `<button type="button" class="sale-balance-trigger" onclick="openPayoff(${x.sale_id})" aria-label="Upload bukti pelunasan, sisa tagihan ${rp(balance)}">${rp(balance)}</button>`
        : rp(balance);
    const mainRow = `<tr class="${ok ? '' : 'void'}"><td class="nw">${rowNumber}</td><td class="nw">${fD(x.sale_date)}</td><td>${esc(x.customers?.name || '-')}</td>`
      + `<td>${order || '<span class="muted">Tidak ada detail pesanan</span>'}${x.order_notes ? `<small class="sale-state-detail">${esc(x.order_notes)}</small>` : ''}</td>`
      + `<td class="nw">${quantity}</td><td class="nw">${rp(x.total)}</td><td>${paymentCell}</td><td class="nw">${balanceCell}</td></tr>`;
    const followupRow = statusActions || balanceAction
      ? `<tr class="sale-followup-row"><td colspan="7"></td><td><div class="sale-followup-content">${balanceAction}${statusActions}</div></td></tr>`
      : '';
    return mainRow + followupRow;
  }).join('') || '<tr><td colspan="8">Tidak ada transaksi untuk filter ini</td></tr>';
  $('#salePageInfo').textContent = pageCount ? `Halaman ${salePage} dari ${pageCount} · ${total} pesanan` : 'Tidak ada pesanan';
  $('#salePageNumbers').innerHTML = Array.from({ length: pageCount }, (_, index) => index + 1)
    .map(page => `<button type="button" class="sale-page-number${page === salePage ? ' active' : ''}" data-page="${page}" aria-label="Halaman ${page}" aria-current="${page === salePage ? 'page' : 'false'}">${page}</button>`).join('');
}
function setEditUI(on) {
  $('#sTitle').textContent = on ? `Ubah Transaksi No. ${editSale}` : 'Buat Transaksi';
  $('#cancelEdit').hidden = !on; $('#checkout').textContent = on ? 'Simpan Perubahan' : 'Simpan Transaksi';
  $('#sPlan').disabled = on;
  $('#saleProofField').hidden = on;
  $('#sProof').required = !on;
}
function resetEdit() {
  editSale = null; editOrig = {}; editPrice = {}; cart = [];
  $('#sPay').querySelector('option[value="Tunai"]')?.remove();
  setEditUI(false); $('#sCust').value = ''; $('#sCustSearch').value = ''; $('#sProof').value = ''; $('#sProofName').textContent = 'Format JPG atau PNG.';
  $('#sCustOptions').hidden = true; $('#sCustSearch').setAttribute('aria-expanded', 'false');
  $('#sPay').value = ''; $('#sPlan').value = 'DP 50%'; $('#sNotes').value = '';
}
window.editS = id => {
  const x = salesCache.find(s => s.sale_id === id); if (!x) return;
  resetEdit(); editSale = id;
  x.sale_details.forEach(d => { editOrig[d.product_id] = (editOrig[d.product_id] || 0) + d.qty; editPrice[d.product_id] = Number(d.unit_price); cart.push({ product_id: d.product_id, qty: d.qty }); });
  renderSaleForm(); setSaleCustomer(x.customer_id);
  if (x.payment_method === 'Tunai' && !$('#sPay').querySelector('option[value="Tunai"]')) $('#sPay').insertAdjacentHTML('beforeend', '<option value="Tunai">Tunai (transaksi lama)</option>');
  $('#sPay').value = x.payment_method; $('#sPlan').value = x.payment_plan || 'Lunas';
  $('#sNotes').value = x.order_notes || ''; setEditUI(true);
  $('#sTitle').scrollIntoView({ behavior: 'smooth' });
};
window.cancelS = async id => {
  if (!confirm(`Batalkan transaksi No. ${id}? Stok akan dikembalikan. Pengembalian uang tidak dicatat otomatis.`)) return;
  if (await run(API.cancelSale(id), 'Transaksi dibatalkan')) { if (editSale === id) resetEdit(); load(); }
};
window.reconcilePayment = async id => {
  if (!isAdmin) return toast('Hanya admin yang dapat memverifikasi pembayaran lama', 1);
  const amount = parseRupiah(prompt('Transaksi DP lama: masukkan total nominal yang sudah diterima sampai saat ini (Rp).'));
  if (amount === null || !Number.isFinite(amount) || amount < 0) return;
  if (await run(API.reconcilePayment(id, amount), 'Saldo pembayaran lama diverifikasi')) renderHistory();
};
window.uploadProof = id => {
  const sale = salesCache.find(x => x.sale_id === id);
  if (!sale) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp,application/pdf';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
    if (!extensions[file.type] || file.size > 5 * 1024 * 1024) {
      toast('Pilih bukti JPG, PNG, WEBP, atau PDF maksimal 5 MB', 1);
      return;
    }
    const initialPayment = Number(sale.paid_total || 0) === 0;
    const stage = initialPayment ? 1 : 2;
    const instruction = initialPayment
      ? sale.payment_plan === 'DP 50%' ? 'DP awal harus tepat 50% dari total.' : 'Pembayaran awal harus lunas.'
      : `Sisa tagihan ${rp(Number(sale.total) - Number(sale.paid_total))}.`;
    const amount = parseRupiah(prompt(`Masukkan nominal yang dibayar. ${instruction}`));
    if (amount === null || !Number.isFinite(amount) || amount <= 0) return;
    const method = prompt('Metode transfer (QRIS atau Transfer):', sale.payment_method);
    if (!['QRIS', 'Transfer'].includes((method || '').trim())) return toast('Pilih metode QRIS atau Transfer', 1);
    const path = `${id}/${crypto.randomUUID()}.${extensions[file.type]}`;
    const { error: uploadError } = await API.uploadProof(path, file);
    if (uploadError) return toast(`Bukti gagal diunggah: ${uploadError.message}`, 1);
    const submitted = await run(API.submitProof(id, stage, amount, method.trim(), path), 'Bukti pembayaran dikirim untuk verifikasi');
    if (!submitted) {
      const { error: removeError } = await API.removeProof(path);
      if (removeError) toast(`Bukti yatim gagal dibersihkan: ${removeError.message}`, 1);
      return;
    }
    renderHistory();
    renderChart();
  };
  input.click();
};
window.openPayoff = id => {
  const sale = salesCache.find(x => x.sale_id === id);
  if (!isAdmin) return toast('Hanya admin yang dapat mengonfirmasi pelunasan', 1);
  if (!sale || sale.status !== 'selesai' || sale.payment_status !== 'DP') return toast('Transaksi tidak berstatus DP', 1);
  if (sale.payment_1_status !== 'Terverifikasi') return toast('Pembayaran DP harus diverifikasi sebelum pelunasan', 1);
  if (sale.payment_2_status === 'Menunggu Verifikasi' || sale.payment_2_status === 'Terverifikasi') {
    return toast('Bukti pelunasan sudah diajukan atau diverifikasi', 1);
  }
  activePayoffSaleId = id;
  $('#payoffForm').reset();
  $('#payoffProofName').textContent = 'Format JPG/PNG, maksimal 5 MB.';
  $('#confirmPayoff').disabled = true;
  $('#payoffMeta').textContent = `Pesanan #${id} · Sisa tagihan ${rp(Math.max(0, Number(sale.total) - Number(sale.paid_total)))}`;
  $('#payoffDialog').showModal();
};
$('#payoffProof').onchange = () => {
  const file = $('#payoffProof').files[0];
  const button = $('#confirmPayoff');
  if (!file) {
    $('#payoffProofName').textContent = 'Format JPG/PNG, maksimal 5 MB.';
    button.disabled = true;
    return;
  }
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    $('#payoffProof').value = '';
    $('#payoffProofName').textContent = 'Format JPG/PNG, maksimal 5 MB.';
    button.disabled = true;
    return toast('Pilih bukti pelunasan JPG atau PNG maksimal 5 MB', 1);
  }
  $('#payoffProofName').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  button.disabled = false;
};
$('#payoffForm').onsubmit = async event => {
  event.preventDefault();
  const id = activePayoffSaleId, sale = salesCache.find(x => x.sale_id === id), file = $('#payoffProof').files[0];
  if (!isAdmin) return toast('Hanya admin yang dapat mengonfirmasi pelunasan', 1);
  if (!sale || sale.status !== 'selesai' || sale.payment_status !== 'DP') return toast('Transaksi tidak lagi berstatus DP', 1);
  if (!file || !['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    $('#confirmPayoff').disabled = true;
    return toast('Unggah bukti pelunasan JPG atau PNG maksimal 5 MB terlebih dahulu', 1);
  }
  const button = $('#confirmPayoff');
  button.disabled = true;
  const extension = file.type === 'image/jpeg' ? 'jpg' : 'png';
  const path = `${id}/${crypto.randomUUID()}.${extension}`;
  try {
    const { error: uploadError } = await API.uploadProof(path, file);
    if (uploadError) return toast(`Bukti pelunasan gagal diunggah: ${uploadError.message}`, 1);
    const amount = Math.round((Number(sale.total) - Number(sale.paid_total)) * 100) / 100;
    const method = sale.payment_1_method || sale.payment_method;
    const submitted = await run(API.submitProof(id, 2, amount, method, path));
    if (!submitted) {
      const { error: removeError } = await API.removeProof(path);
      if (removeError) toast(`Bukti pelunasan gagal dibersihkan: ${removeError.message}`, 1);
      return;
    }
    const reviewed = await run(API.reviewProof(id, 2, true, null));
    if (!reviewed) {
      toast('Bukti tersimpan dan menunggu konfirmasi admin; tinjau bukti tersebut untuk menyelesaikan pelunasan.', 1);
      $('#payoffDialog').close();
      activePayoffSaleId = null;
      await load();
      return;
    }
    toast('Pelunasan dikonfirmasi. Status menjadi LUNAS dan sisa tagihan Rp 0.');
    $('#payoffDialog').close();
    activePayoffSaleId = null;
    await load();
    renderChart();
  } finally {
    if ($('#payoffDialog').open) button.disabled = false;
  }
};
$('#cancelPayoff').onclick = () => $('#payoffDialog').close();
$('#payoffDialog').addEventListener('close', () => {
  activePayoffSaleId = null;
  $('#payoffForm').reset();
  $('#confirmPayoff').disabled = true;
});
window.reviewProof = async (id, stage) => {
  if (!isAdmin) return toast('Hanya admin yang dapat memverifikasi bukti pembayaran', 1);
  const payment = await run(API.payment(id, stage));
  if (!payment) return;
  const { data, error } = await API.signedProofUrl(payment.proof_path);
  if (error) return toast(`Bukti tidak dapat dibuka: ${error.message}`, 1);
  activeReviewId = { saleId: id, stage };
  const payoffReview = stage === 2;
  $('#proofQuestion').hidden = !payoffReview;
  $('#proofQuestion').textContent = payoffReview ? 'Apakah pesanan ini telah dilunasi?' : '';
  $('#rejectProof').hidden = payoffReview;
  $('#closeProof').textContent = payoffReview ? 'Batal' : 'Tutup';
  $('#proofMeta').textContent = `Pesanan #${payment.sale_id} · ${stage === 1 ? 'Tahap 1' : 'Pelunasan'} · ${rp(payment.amount)} · ${payment.payment_method}`;
  $('#approveProof').textContent = payoffReview ? 'Ya' : 'Verifikasi & Catat Pembayaran';
  $('#proofLink').href = data.signedUrl;
  $('#proofDialog').showModal();
};
$('#approveProof').onclick = async () => {
  if (activeReviewId === null) return;
  const stage = activeReviewId.stage;
  if (stage !== 2 && !confirm('Verifikasi dan catat pembayaran ini?')) return;
  if (await run(API.reviewProof(activeReviewId.saleId, stage, true, null), stage === 2 ? 'Pelunasan diverifikasi. Status menjadi LUNAS dan sisa tagihan Rp 0.' : 'Pembayaran diverifikasi dan dicatat')) {
    $('#proofDialog').close();
    activeReviewId = null;
    $('#approveProof').textContent = 'Verifikasi & Catat Pembayaran';
    $('#rejectProof').hidden = false;
    $('#closeProof').textContent = 'Tutup';
    renderHistory();
    renderChart();
    renderChart();
  }
};
$('#rejectProof').onclick = async () => {
  if (activeReviewId === null) return;
  const reason = prompt('Tuliskan alasan penolakan bukti pembayaran:');
  if (!reason?.trim()) return toast('Alasan penolakan wajib diisi', 1);
  if (await run(API.reviewProof(activeReviewId.saleId, activeReviewId.stage, false, reason.trim()), 'Bukti pembayaran ditolak')) {
    $('#proofDialog').close();
    activeReviewId = null;
    $('#approveProof').textContent = 'Verifikasi & Catat Pembayaran';
    $('#rejectProof').hidden = false;
    $('#closeProof').textContent = 'Tutup';
    renderHistory();
    renderChart();
  }
};
$('#closeProof').onclick = () => {
  $('#proofDialog').close();
  activeReviewId = null;
  $('#approveProof').textContent = 'Verifikasi & Catat Pembayaran';
  $('#rejectProof').hidden = false;
  $('#closeProof').textContent = 'Tutup';
};
$('#sProof').onchange = () => {
  const file = $('#sProof').files[0];
  if (!file) {
    $('#sProofName').textContent = 'Format JPG atau PNG.';
    return;
  }
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    $('#sProof').value = '';
    $('#sProofName').textContent = 'Format JPG atau PNG.';
    return toast('Pilih foto bukti JPG atau PNG maksimal 5 MB', 1);
  }
  $('#sProofName').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
};
$('#addCart').onclick = () => {
  const pid = Number($('#sProd').value), qty = Number($('#sQty').value);
  if (!pid) return toast('Pilih produk buket terlebih dahulu', 1);
  if (!Number.isInteger(qty) || qty < 1) return toast('Jumlah pembelian minimal 1 dan harus berupa bilangan bulat', 1);
  const p = products.find(x => x.product_id === pid); if (!p) return;
  const ex = cart.find(i => i.product_id === pid), have = (ex?.qty || 0) + qty;
  if (have > avail(p)) return toast('Stok tidak tersedia', 1);
  ex ? ex.qty = have : cart.push({ product_id: pid, qty }); renderCart();
};
async function rollbackUnsubmittedSale(id, proofPaths = []) {
  for (const path of new Set(proofPaths.filter(Boolean))) {
    const { error } = await API.removeProof(path);
    if (error) toast(`Bukti transaksi #${id} gagal dibersihkan: ${error.message}`, 1);
  }
  const { error } = await API.cancelSale(id);
  if (error) toast(`Transaksi #${id} belum memiliki bukti pembayaran yang terhubung dan gagal dibatalkan: ${error.message}`, 1);
}
$('#checkout').onclick = async () => {
  if (!cart.length) return toast('Keranjang kosong', 1);
  const customerId = Number($('#sCust').value);
  if (!customerId || !customers.some(c => c.customer_id === customerId)) return toast('Cari lalu pilih pelanggan dari hasil pencarian', 1);
  const c = Number($('#sCust').value), pay = $('#sPay').value, plan = $('#sPlan').value;
  const notes = $('#sNotes').value.trim();
  const creating = !editSale;
  if (!pay) return toast('Pilih metode pembayaran', 1);
  const file = $('#sProof').files[0];
  if (creating && !file) return toast('Pilih foto bukti pembayaran sebelum menyimpan transaksi', 1);
  if (creating && (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024)) return toast('Pilih foto bukti JPG atau PNG maksimal 5 MB', 1);
  if (creating && cart.reduce((sum, item) => {
    const product = products.find(x => x.product_id === item.product_id);
    return sum + Number(product?.price || 0) * item.qty;
  }, 0) <= 0) return toast('Total transaksi harus lebih dari nol untuk mengirim bukti pembayaran', 1);
  const button = $('#checkout');
  button.disabled = true;
  $('#sProof').disabled = true;
  try {
    if (!creating) {
      const updated = await run(API.updateSale(editSale, c, pay, null, notes, cart), 'Pesanan diperbarui');
      if (updated) { resetEdit(); await load(); }
      return;
    }
    const created = await run(API.createSale(c, pay, plan, null, notes, cart));
    if (!created) return;
    const createdId = Number(created);
    if (!Number.isSafeInteger(createdId) || createdId <= 0) return toast('Transaksi dibuat tetapi nomor transaksi tidak valid; periksa riwayat sebelum mencoba lagi', 1);
    const { data: summary, error: summaryError } = await API.saleSummary(createdId);
    if (summaryError) {
      toast(`Transaksi #${createdId} belum dapat disiapkan untuk pembayaran: ${summaryError.message}`, 1);
      await rollbackUnsubmittedSale(createdId);
      $('#sProof').value = '';
      $('#sProofName').textContent = 'Format JPG atau PNG.';
      return;
    }
    const extension = file.type === 'image/jpeg' ? 'jpg' : 'png';
    const proofPath = `${createdId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await API.uploadProof(proofPath, file);
    if (uploadError) {
      toast(`Bukti gagal diunggah: ${uploadError.message}`, 1);
      await rollbackUnsubmittedSale(createdId);
      $('#sProof').value = '';
      $('#sProofName').textContent = 'Format JPG atau PNG.';
      return;
    }
    const total = Number(summary.total);
    const amount = summary.payment_plan === 'DP 50%'
      ? Math.round((total * 0.5 + Number.EPSILON) * 100) / 100
      : total;
    const submitted = await run(API.submitProof(createdId, 1, amount, summary.payment_method, proofPath));
    if (!submitted) {
      await rollbackUnsubmittedSale(createdId, [proofPath]);
      $('#sProof').value = '';
      $('#sProofName').textContent = 'Format JPG atau PNG.';
      return;
    }
    toast(isAdmin
      ? `Transaksi #${createdId} tersimpan. Pembayaran ${summary.payment_plan === 'DP 50%' ? 'DP dicatat dan sisa tagihan langsung diperbarui.' : 'lunas langsung dicatat.'}`
      : `Transaksi #${createdId} tersimpan. Bukti menunggu verifikasi admin.`);
    resetEdit();
    await load();
  } finally {
    button.disabled = false;
    $('#sProof').disabled = false;
  }
};
$('#cancelEdit').onclick = () => { resetEdit(); load(); };

function salesFilters() {
  const filters = {}, search = $('#saleSearch').value.trim().toLocaleLowerCase('id-ID');
  if ($('#saleFrom').value) filters.from = new Date(`${$('#saleFrom').value}T00:00:00`).toISOString();
  if ($('#saleTo').value) {
    const end = new Date(`${$('#saleTo').value}T00:00:00`);
    end.setDate(end.getDate() + 1);
    filters.to = end.toISOString();
  }
  if (search) {
    filters.customerIds = customers.filter(c => (c.name || '').toLocaleLowerCase('id-ID').includes(search)).map(c => c.customer_id);
  }
  return filters;
}
window.updateFulfillment = async (id, status) => {
  if (await run(API.updateFulfillment(id, status), 'Status pesanan diperbarui')) {
    renderChart();
    renderHistory();
  } else renderHistory();
};
window.openSales = () => document.querySelector('nav button[data-v="vS"]').click();
$('#filterSales').onclick = () => {
  if ($('#saleFrom').value && $('#saleTo').value && $('#saleFrom').value > $('#saleTo').value) return toast('Tanggal awal tidak boleh melewati tanggal akhir', 1);
  salePage = 1;
  renderHistory();
};
$('#saleSearch').onkeydown = e => { if (e.key === 'Enter') $('#filterSales').click(); };
$('#salePageNumbers').onclick = event => {
  const button = event.target.closest('button[data-page]');
  if (!button) return;
  const page = Number(button.dataset.page);
  if (!Number.isInteger(page) || page < 1 || page === salePage) return;
  salePage = page;
  renderHistory();
};
$('#exportSales').onclick = async () => {
  if ($('#saleFrom').value && $('#saleTo').value && $('#saleFrom').value > $('#saleTo').value) return toast('Tanggal awal tidak boleh melewati tanggal akhir', 1);
  const rows = [];
  let page = 1, batch;
  do {
    batch = await run(API.sales(page, salesFilters(), salePageSize));
    if (!batch) return;
    rows.push(...batch.rows);
    page++;
  } while (rows.length < batch.count);
  const quote = value => {
    let text = String(value ?? '');
    if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csvRows = [
    ['No.', 'Tanggal', 'Pelanggan', 'Produk', 'Qty', 'Total', 'Pembayaran', 'Sisa Tagihan'],
    ...rows.map((s, index) => [
      index + 1,
      new Date(s.sale_date).toLocaleDateString('id-ID'), s.customers?.name,
      [...new Set(s.sale_details.map(d => d.products?.name || 'Produk dihapus'))].join(' / '),
      s.sale_details.reduce((sum, detail) => sum + Number(detail.qty || 0), 0),
      s.total, s.status !== 'selesai' ? 'DIBATALKAN' : `${salePaymentMethods(s)} ${salePaymentStatus(s)}`,
      saleOutstanding(s) === null ? 'Perlu verifikasi' : saleOutstanding(s)
    ])
  ];
  const csv = '\uFEFFsep=;\r\n' + csvRows.map(row => row.map(quote).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `rekap-penjualan-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

// ===== Grafik (transaksi berstatus 'selesai' saja) =====
const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
async function renderChart() {
  const daily = $('#gMode').value === 'd';
  const [y, mo] = daily ? $('#gMonth').value.split('-').map(Number) : [Number($('#gYear').value), 1];
  if (!y || !mo) return;
  const from = new Date(y, mo - 1, 1), to = daily ? new Date(y, mo, 1) : new Date(y + 1, 0, 1); // 'to' = awal periode berikutnya (tidak ikut)
  const now = new Date(), todayFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const [s, d, todaySales, todayReceipts] = await Promise.all([
    run(API.reportSales(from.toISOString(), to.toISOString())),
    run(API.reportItems(from.toISOString(), to.toISOString())),
    run(API.reportSales(todayFrom.toISOString(), tomorrow.toISOString())),
    run(API.paymentsReceived(todayFrom.toISOString(), tomorrow.toISOString()))
  ]);
  const key = t => { const k = new Date(t).toLocaleDateString('en-CA'); return daily ? k : k.slice(0, 7); };
  const data = {}, step = new Date(from);
  while (step < to) { data[key(step)] = 0; daily ? step.setDate(step.getDate() + 1) : step.setMonth(step.getMonth() + 1); }
  (s || []).forEach(x => { const k = key(x.sale_date); if (k in data) data[k] += Number(x.total); });
  const vals = Object.values(data), omzet = vals.reduce((a, b) => a + b, 0), max = Math.max(...vals, 1), n = (s || []).length;
  const unknownPayments = (s || []).filter(x => x.paid_total == null).length;
  const outstanding = (s || []).reduce((sum, x) => sum + (x.paid_total == null ? 0 : Math.max(0, Number(x.total) - Number(x.paid_total))), 0);
  const todayTotal = (todaySales || []).reduce((sum, sale) => sum + Number(sale.total), 0);
  const todayCashIn = (todayReceipts || []).reduce((sum, payment) => sum + Number(payment.amount), 0);
  $('#dashMetrics').innerHTML = `<div class="dashboard-metric"><small>Total Penjualan Bulanan</small><b>${rp(omzet)}</b><span>${daily ? `${BULAN[mo - 1]} ${y}` : `Tahun ${y}`}</span></div>
    <div class="dashboard-metric"><small>Total Transaksi</small><b>${n}</b><span>Sesuai periode grafik</span></div>
    <div class="dashboard-metric"><small>Rata-rata Penjualan</small><b>${rp(n ? omzet / n : 0)}</b><span>Per transaksi pada periode</span></div>
    <div class="dashboard-metric"><small>Sisa Tagihan</small><b>${rp(outstanding)}</b><span>${unknownPayments ? `${unknownPayments} transaksi perlu verifikasi` : 'Sesuai periode grafik'}</span></div>
    <div class="dashboard-metric"><small>Penjualan Hari Ini</small><b>${rp(todayTotal)}</b><span>${(todaySales || []).length} pesanan</span></div>
    <div class="dashboard-metric"><small>Pembayaran Diterima Hari Ini</small><b>${rp(todayCashIn)}</b></div>`;
  $('#gBars').innerHTML = Object.entries(data).map(([k, v]) => { const t = daily ? k.slice(8) : BULAN[Number(k.slice(5)) - 1].slice(0, 3);
    return `<div class="bar" title="${daily ? k : BULAN[Number(k.slice(5)) - 1] + ' ' + y}: ${rp(v)}"><i style="height:calc((100% - 16px) * ${v / max})"></i><span>${t}</span></div>`; }).join('');
  const top = {}; (d || []).forEach(x => { const nm = x.products?.name || '?'; top[nm] = (top[nm] || 0) + x.qty; });
  const arr = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5), m = arr[0]?.[1] || 1;
  $('#gTop').innerHTML = arr.map(([nm, q]) => `<li><span>${esc(nm)}</span><span class="hb"><i style="width:${q / m * 100}%"></i></span><b>${q}</b></li>`).join('') || '<li class="muted">Belum ada data</li>';
}
$('#gMonth').value = new Date().toLocaleDateString('en-CA').slice(0, 7); $('#gYear').value = new Date().getFullYear();
$('#gMode').onchange = () => { const d = $('#gMode').value === 'd'; $('#gMonth').hidden = !d; $('#gYear').hidden = d; renderChart(); };
$('#gMonth').onchange = $('#gYear').onchange = renderChart;
bindForm('#fC', 'customers', 'customer_id', ['name', 'phone', 'address'], load);
bindForm('#fP', 'products', 'product_id', ['name', 'price', 'stock'], load);
$('#goSale').onclick = () => document.querySelector('nav button[data-v="vS"]').click();

// ===== Login (Supabase Auth) =====
$('#fL').onsubmit = async e => {
  e.preventDefault(); const f = e.target;
  const { error } = await API.signIn(f.email.value.trim(), f.password.value);
  if (error) toast(error.code === 'invalid_credentials' || error.message === 'Invalid login credentials' ? 'Email atau kata sandi salah' : 'Login gagal: ' + error.message, 1); else f.password.value = '';
};
$('#logout').onclick = () => API.signOut();
API.onAuth(sess => setTimeout(() => { // setTimeout: hindari panggilan Supabase langsung di dalam callback
  const was = !$('#app').hidden;
  $('#login').hidden = !!sess; $('#app').hidden = !sess; $('#who').textContent = sess?.user.email || '';
  if (sess && !was) {
    API.isAdmin().then(({ data, error }) => {
      if (error) { isAdmin = false; toast(`Status admin tidak dapat diperiksa: ${error.message}`, 1); }
      else isAdmin = Boolean(data);
      $('#who').textContent = `${sess.user.email} · ${isAdmin ? 'Admin' : 'Staf'}`;
      if (!error && !isAdmin) toast('Akun belum memiliki hak Admin. Tetapkan role admin pada app_metadata akun ini di Supabase, lalu muat ulang aplikasi.', 1);
      load();
    });
  }
  if (!sess) { isAdmin = false; $('#who').textContent = ''; resetEdit(); customers = []; products = []; }
}, 0));