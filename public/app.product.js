const params = new URLSearchParams(location.search);
const pathBarcode = decodeURIComponent(location.pathname.split('/').pop());
const statusEl = document.getElementById('status');
const logoutBtn = document.getElementById('logout');

const barcodeEl = document.getElementById('barcode');
const nameEl = document.getElementById('name');
const priceEl = document.getElementById('price');
const createdAtEl = document.getElementById('created_at');
const categoryEl = document.getElementById('category');
const brandEl = document.getElementById('brand');
const stockEl = document.getElementById('stock');
const cats = document.getElementById('cats');

const editToggle = document.getElementById('editToggle');
const editActions = document.getElementById('editActions');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const deleteBtn = document.getElementById('deleteBtn');

function setDisabled(dis){ [nameEl, priceEl, createdAtEl, categoryEl, brandEl, stockEl].forEach(i=>i.disabled=dis); }
function setStatus(m){ statusEl.textContent=m||''; }

async function loadCats(){
  const r = await fetch('/api/categories');
  const j = await r.json(); cats.innerHTML='';
  (j.data||[]).forEach(c=>{ const o=document.createElement('option'); o.value=c; cats.appendChild(o); });
}

async function load(){
  const r = await fetch(`/api/products?barcode=${encodeURIComponent(pathBarcode)}`);
  const j = await r.json();
  if(!j.data) { setStatus('Не найден'); return; }
  const p = j.data;
  document.getElementById('title').textContent = p.name || 'Товар';
  barcodeEl.value = p.barcode;
  nameEl.value = p.name;
  priceEl.value = p.price;
  createdAtEl.value = p.created_at;
  categoryEl.value = p.category || '';
  brandEl.value = p.brand || '';
  stockEl.value = p.stock ?? 0;
}

editToggle.onclick = ()=>{
  const editing = editActions.classList.toggle('hidden');
  setDisabled(!editing);
};

saveBtn.onclick = async ()=>{
  const body = {
    name: nameEl.value.trim(),
    price: Number(priceEl.value),
    created_at: createdAtEl.value,
    category: categoryEl.value.trim()||null,
    brand: brandEl.value.trim()||null,
    stock: Number(stockEl.value||0)
  };
  const r = await fetch(`/api/products/${encodeURIComponent(pathBarcode)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  const j = await r.json();
  if (j.ok) { setStatus('Сохранено'); setDisabled(true); editActions.classList.add('hidden'); } else setStatus('Ошибка: '+(j.error||''));
};

cancelBtn.onclick = ()=>{ setDisabled(true); editActions.classList.add('hidden'); load(); };

deleteBtn.onclick = async ()=>{
  if(!confirm('Удалить товар?')) return;
  const r = await fetch(`/api/products/${encodeURIComponent(pathBarcode)}`, { method:'DELETE' });
  const j = await r.json();
  if (j.ok) location.href = '/search'; else setStatus('Ошибка: '+(j.error||''));
};

logoutBtn.onclick = async()=>{ await fetch('/api/logout',{method:'POST'}); location.href='/login'; };

setDisabled(true); loadCats(); load();