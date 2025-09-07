const searchInput = document.getElementById('search');
const resultsList = document.getElementById('results');
const countEl = document.getElementById('count');
const btnAZ = document.getElementById('sortAZ');
const btnPrice = document.getElementById('sortPrice');
const selectAll = document.getElementById('selectAll');
const bulkDelete = document.getElementById('bulkDelete');
const selectedCountEl = document.getElementById('selectedCount');
const editToggle = document.getElementById('editToggle');
const bulkActions = document.getElementById('bulkActions');

let timer, lastData = [], sortMode = 'time';
const selected = new Set();
let editMode = false;

function setEditMode(on){
  editMode = !!on;
  if (bulkActions) bulkActions.classList.toggle('hidden', !editMode);
  if (!editMode) { selected.clear(); }
  render();
}

searchInput.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(run, 250);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && resultsList.firstChild) {
    const firstLink = resultsList.querySelector('a.exists');
    if (firstLink && firstLink.href) {
      location.href = firstLink.href;
    } else {
      // fallback: открыть первый элемент, если это <li>
      const firstLi = resultsList.firstChild;
      const bc = firstLi?.querySelector?.('.code')?.textContent?.trim();
      if (bc) location.href = `/product/${encodeURIComponent(bc)}`;
    }
  }
});

btnAZ && (btnAZ.onclick = () => { sortMode = 'az'; render(); });
btnPrice && (btnPrice.onclick = () => { sortMode = 'price'; render(); });

// Аккуратное экранирование строки для RegExp
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(text, q) {
  if (!q) return text;
  const re = new RegExp('(' + escapeRegExp(q) + ')', 'ig');
  return String(text).replace(re, '<mark>$1</mark>');
}

function render(q = searchInput.value.trim()) {
  let data = [...lastData];

  if (q) {
    // Сначала те, что начинаются с запроса
    const lower = q.toLowerCase();
    const starts = data.filter(p => (p.name || '').toLowerCase().startsWith(lower));
    const rest = data.filter(p => !(p.name || '').toLowerCase().startsWith(lower));
    data = [...starts, ...rest];
  }

  if (sortMode === 'az') data.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
  if (sortMode === 'price') data.sort((a, b) => (a.price || 0) - (b.price || 0));

  resultsList.innerHTML = '';
  data.forEach(p => {
    const li = document.createElement('li');
    li.className = 'list-item hoverable';
    li.dataset.barcode = p.barcode;
    // Build content
    let checkbox = null;
    if (editMode) {
      checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'sel';
      const isSel = selected.has(p.barcode);
      checkbox.checked = isSel;
      if (isSel) li.classList.add('selected');
      checkbox.style.marginRight = '8px';
      checkbox.addEventListener('click', (e) => {
        e.stopPropagation();
        if (checkbox.checked) { selected.add(p.barcode); li.classList.add('selected'); }
        else { selected.delete(p.barcode); li.classList.remove('selected'); }
        updateBulkUI();
      });
      li.appendChild(checkbox);
    }

    const title = document.createElement('div');
    title.className = 'rowed';
    title.innerHTML = `<b>${highlight(p.name || '', q)}</b><span class="muted"> — ${p.price} / rub</span>`;

    const code = document.createElement('div');
    code.className = 'code';
    code.innerHTML = highlight(p.barcode || '', q);

    const link = document.createElement('a');
    link.className = 'exists';
    link.href = `/product/${encodeURIComponent(p.barcode)}`;
    link.title = 'Перейти к товару';
    link.textContent = '↗';

    li.appendChild(title);
    li.appendChild(code);
    li.appendChild(link);

    li.onclick = (e) => {
      if (e.target instanceof HTMLAnchorElement || e.target instanceof HTMLInputElement) return;
      if (editMode && checkbox) {
        checkbox.checked = !checkbox.checked;
        if (checkbox.checked) { selected.add(p.barcode); li.classList.add('selected'); }
        else { selected.delete(p.barcode); li.classList.remove('selected'); }
        updateBulkUI();
      } else {
        location.href = `/product/${encodeURIComponent(p.barcode)}`;
      }
    };
    resultsList.appendChild(li);
  });

  if (countEl) countEl.textContent = `Найдено: ${data.length}`;
  updateBulkUI();
}

async function run() {
  const q = searchInput.value.trim();
  const r = await fetch(`/api/products?q=${encodeURIComponent(q)}`);
  const j = await r.json();
  lastData = j.data || [];
  render(q);
}

run();

// Start collapsed (view mode)
setEditMode(false);

// Bulk controls
function updateBulkUI() {
  const renderedItems = Array.from(resultsList.querySelectorAll('li'));
  const renderedBarcodes = renderedItems.map(li => li.querySelector('.code')?.textContent?.trim()).filter(Boolean);
  const allSelected = renderedBarcodes.length > 0 && renderedBarcodes.every(bc => selected.has(bc));
  if (selectAll) selectAll.checked = editMode && allSelected;
  const count = selected.size;
  if (selectedCountEl) selectedCountEl.textContent = (editMode && count) ? `Выбрано: ${count}` : '';
  if (bulkDelete) bulkDelete.disabled = !editMode || count === 0;
}

selectAll && selectAll.addEventListener('change', () => {
  if (!editMode) { selectAll.checked = false; return; }
  const items = Array.from(resultsList.querySelectorAll('li'));
  items.forEach(li => {
    const bc = li.querySelector('.code')?.textContent?.trim();
    const cb = li.querySelector('input.sel');
    if (!bc || !cb) return;
    cb.checked = selectAll.checked;
    if (selectAll.checked) { selected.add(bc); li.classList.add('selected'); }
    else { selected.delete(bc); li.classList.remove('selected'); }
  });
  updateBulkUI();
});

bulkDelete && bulkDelete.addEventListener('click', async () => {
  const list = Array.from(selected);
  if (!list.length) return;
  if (!confirm(`Удалить выбранные (${list.length})?`)) return;
  // Delete sequentially to avoid any 404 noise and keep UX clean
  const originalText = bulkDelete.textContent;
  bulkDelete.disabled = true; bulkDelete.textContent = 'Удаление…';
  let ok = 0, fail = 0;
  for (const bc of list) {
    try {
      const rr = await fetch(`/api/products/${encodeURIComponent(bc)}`, { method: 'DELETE', headers: { 'Accept': 'application/json' } });
      const jj = await rr.json().catch(()=>({ ok:false }));
      if (rr.ok && jj.ok) { ok++; selected.delete(bc); }
      else fail++;
    } catch { fail++; }
  }
  await run();
  bulkDelete.textContent = originalText; bulkDelete.disabled = selected.size === 0;
  if (fail) alert(`Не удалось удалить ${fail} из ${list.length}.`);
});

// Edit mode controls (toggle on repeated clicks)
if (editToggle) editToggle.onclick = () => setEditMode(!editMode);
