// FRONTEND (tampilan & event). Data diambil lewat objek API di backend/app.js. (file: script.js)
// ===== Helper =====
const $ = s => document.querySelector(s);
const rp = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const updateTodayDate = () => {
  const now = new Date();
  $('#todayDate').textContent = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  setTimeout(updateTodayDate, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now);
};
updateTodayDate();
const toast = (m, err) => { const t = $('#toast'); t.textContent = m; t.className = 'show' + (err ? ' err' : ''); setTimeout(() => t.className = '', 3000); };
const run = async (p, ok) => { const { data, error } = await p; if (error) { toast(error.code === '23503' ? 'Data ini masih terhubung dengan transaksi, sehingga tidak bisa dihapus' : error.message, 1); return null; } if (ok) toast(ok); return data ?? true; };

let customers = [], products = [], cart = [], salesCache = [], editSale = null, editOrig = {}, editPrice = {};
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
    ['price', 'stock'].forEach(k => { if (k in o) o[k] = Number(o[k] || 0); });
    const r = await run(API.save(table, idc, o, f.rid.value || null), 'Tersimpan ✿');
    if (r) { f.reset(); f.rid.value = ''; after(); }
  };
}
const fill = (fid, obj) => { const f = $(fid); Object.keys(obj).forEach(k => { if (f[k]) f[k].value = obj[k] ?? ''; }); f.scrollIntoView({ behavior: 'smooth' }); };
const remove = async (t, idc, id, after) => { if (confirm('Hapus data ini?') && await run(API.del(t, idc, id), 'Terhapus')) after(); };

window.editC = id => fill('#fC', { ...customers.find(x => x.customer_id === id), rid: id });
window.delC = id => remove('customers', 'customer_id', id, load);
window.editP = id => fill('#fP', { ...products.find(x => x.product_id === id), rid: id });
window.delP = id => remove('products', 'product_id', id, load);

// ===== Render =====
const actions = (e, d) => `<td class="act"><button onclick="${e}">Ubah</button><button class="del" onclick="${d}">Hapus</button></td>`;
async function load() {
  const v = document.querySelector('nav .on').dataset.v;
  const [c, p] = await Promise.all([run(API.list('customers', 'created_at')), run(API.list('products', 'created_at'))]);
  customers = c || []; products = p || [];
  if (v === 'vC') $('#tC').innerHTML = customers.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.phone)}</td><td>${esc(x.address)}</td>${actions(`editC(${x.customer_id})`, `delC(${x.customer_id})`)}</tr>`).join('') || '<tr><td colspan="4">Belum ada pelanggan</td></tr>';
  if (v === 'vP') $('#tP').innerHTML = products.map(x => `<tr><td>${esc(x.name)}</td><td>${rp(x.price)}</td><td><span class="badge ${x.stock <= 3 ? 'no' : 'ok'}">${x.stock}</span></td>${actions(`editP(${x.product_id})`, `delP(${x.product_id})`)}</tr>`).join('') || '<tr><td colspan="4">Belum ada produk</td></tr>';
  if (v === 'vS') { renderSaleForm(); renderHistory(); }
  if (v === 'vG') renderChart();
}
function renderSaleForm() {
  $('#sCust').innerHTML = '<option value="" disabled selected>Pilih pelanggan…</option>' + customers.map(c => `<option value="${c.customer_id}">${esc(c.name)}</option>`).join('');
  $('#sProd').innerHTML = '<option value="" disabled selected>Pilih produk buket</option>' + products.filter(p => avail(p) > 0).map(p => `<option value="${p.product_id}">${esc(p.name)} (stok ${avail(p)})</option>`).join('');
  renderCart();
}
function renderCart() {
  let total = 0;
  $('#cart').innerHTML = cart.map((i, n) => {
    const p = products.find(x => x.product_id === i.product_id), price = editPrice[i.product_id] ?? p?.price ?? 0, sub = price * i.qty; total += sub;
    return `<tr><td>${esc(p?.name)}</td><td>${i.qty}</td><td>${rp(price)}</td><td><b>${rp(sub)}</b></td><td class="act"><button class="del" title="Hapus" onclick="cart.splice(${n},1);renderCart()">✕</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">Keranjang kosong</td></tr>';
  $('#total').textContent = rp(total);
}
const noOf = id => salesCache.findIndex(x => x.sale_id === id) + 1; // nomor urut baris di tabel
async function renderHistory() {
  salesCache = (await run(API.sales())) || [];
  const fD = t => new Date(t).toLocaleDateString('en-GB'), fT = t => new Date(t).toLocaleTimeString('en-GB'); // dd/mm/yyyy dan jj:mm:dd
  $('#tS').innerHTML = salesCache.map((x, i) => { const ok = x.status === 'selesai';
    const lines = f => x.sale_details.map(d => `<div>${f(d)}</div>`).join('');
    return `<tr class="${ok ? '' : 'void'}"><td>${i + 1}</td><td class="nw">${fD(x.sale_date)}<br><span class="muted">${fT(x.sale_date)}</span></td><td>${esc(x.customers?.name || '-')}</td>`
      + `<td class="nw">${lines(d => esc(d.products?.name))}</td><td class="nw">${lines(d => d.qty)}</td><td class="nw">${esc(x.payment_method)}</td><td class="nw">${rp(x.total)}</td>`
      + `<td><span class="badge ${!ok ? 'no' : x.payment_status === 'DP' ? 'dp' : 'ok'}">${ok ? x.payment_status : 'Batal'}</span></td>`
      + (ok ? `<td class="act"><button onclick="editS(${x.sale_id})">Ubah</button><button class="del" onclick="cancelS(${x.sale_id})">Batalkan</button></td>` : '<td></td>') + '</tr>'; }).join('') || '<tr><td colspan="9">Belum ada transaksi</td></tr>';
}
function setEditUI(on) {
  $('#sTitle').textContent = on ? `Ubah Transaksi No. ${noOf(editSale)}` : 'Transaksi Baru';
  $('#cancelEdit').hidden = !on; $('#checkout').textContent = on ? 'Simpan Perubahan' : 'Simpan Transaksi';
}
function resetEdit() { editSale = null; editOrig = {}; editPrice = {}; cart = []; setEditUI(false); $('#sPay').value = ''; $('#sStat').value = ''; }
window.editS = id => {
  const x = salesCache.find(s => s.sale_id === id); if (!x) return;
  resetEdit(); editSale = id;
  x.sale_details.forEach(d => { editOrig[d.product_id] = (editOrig[d.product_id] || 0) + d.qty; editPrice[d.product_id] = Number(d.unit_price); cart.push({ product_id: d.product_id, qty: d.qty }); });
  renderSaleForm(); $('#sCust').value = x.customer_id ?? ''; $('#sPay').value = x.payment_method; $('#sStat').value = x.payment_status; setEditUI(true);
  $('#sTitle').scrollIntoView({ behavior: 'smooth' });
};
window.cancelS = async id => {
  if (!confirm(`Batalkan transaksi No. ${noOf(id)}? Stok akan dikembalikan.`)) return;
  if (await run(API.cancelSale(id), 'Transaksi dibatalkan')) { if (editSale === id) resetEdit(); load(); }
};
$('#addCart').onclick = () => {
  const pid = Number($('#sProd').value), qty = Number($('#sQty').value);
  if (!pid) return toast('Pilih produk buket terlebih dahulu', 1);
  const p = products.find(x => x.product_id === pid); if (!p || qty < 1) return;
  const ex = cart.find(i => i.product_id === pid), have = (ex?.qty || 0) + qty;
  if (have > avail(p)) return toast('Stok tidak cukup', 1);
  ex ? ex.qty = have : cart.push({ product_id: pid, qty }); renderCart();
};
$('#checkout').onclick = async () => {
  if (!cart.length) return toast('Keranjang kosong', 1);
  if (!$('#sCust').value) return toast('Pilih pelanggan terlebih dahulu', 1);
  const c = Number($('#sCust').value), pay = $('#sPay').value, st = $('#sStat').value;
  if (!pay) return toast('Pilih metode pembayaran (QRIS atau Transfer)', 1);
  if (!st) return toast('Pilih status pembayaran (Lunas atau DP)', 1);
  const r = await run(editSale ? API.updateSale(editSale, c, pay, st, cart) : API.createSale(c, pay, st, cart), editSale ? 'Transaksi diperbarui ✿' : 'Transaksi berhasil ✿');
  if (r) { resetEdit(); load(); }
};
$('#cancelEdit').onclick = () => { resetEdit(); load(); };

// ===== Grafik (transaksi berstatus 'selesai' saja) =====
const BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
async function renderChart() {
  const daily = $('#gMode').value === 'd';
  const [y, mo] = daily ? $('#gMonth').value.split('-').map(Number) : [Number($('#gYear').value), 1];
  if (!y || !mo) return;
  const from = new Date(y, mo - 1, 1), to = daily ? new Date(y, mo, 1) : new Date(y + 1, 0, 1); // 'to' = awal periode berikutnya (tidak ikut)
  const [s, d] = await Promise.all([run(API.reportSales(from.toISOString(), to.toISOString())), run(API.reportItems(from.toISOString(), to.toISOString()))]);
  const key = t => { const k = new Date(t).toLocaleDateString('en-CA'); return daily ? k : k.slice(0, 7); };
  const data = {}, step = new Date(from);
  while (step < to) { data[key(step)] = 0; daily ? step.setDate(step.getDate() + 1) : step.setMonth(step.getMonth() + 1); }
  (s || []).forEach(x => { const k = key(x.sale_date); if (k in data) data[k] += Number(x.total); });
  const vals = Object.values(data), omzet = vals.reduce((a, b) => a + b, 0), max = Math.max(...vals, 1), n = (s || []).length;
  const label = daily ? `${BULAN[mo - 1]} ${y}` : `Tahun ${y}`;
  $('#gSum').innerHTML = `<div><small>Total Penjualan (${label})</small><b>${rp(omzet)}</b></div><div><small>Total Transaksi</small><b>${n}</b></div><div><small>Rata-rata / Transaksi</small><b>${rp(n ? omzet / n : 0)}</b></div>`;
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
  if (sess && !was) load();
  if (!sess) { resetEdit(); customers = []; products = []; }
}, 0));