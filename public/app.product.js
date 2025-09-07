// Robust scanner logic: waits for DOM, guards nulls, no listVideoInputDevices usage,
// supports scan from camera and from photo, and loads categories + brands.

document.addEventListener('DOMContentLoaded', () => {
  const $ = (id) => document.getElementById(id);

  const video       = $('video') || $('videoEl') || document.getElementById('video');
  const overlay     = $('overlay');
  const startBtn    = $('startScan');
  const stopBtn     = $('stopScan');
  const statusEl    = $('status');
  const logoutBtn   = $('logout');
  const pickImage   = $('pickImage');

  const barcodeEl   = $('barcode');
  const nameEl      = $('name');
  const priceEl     = $('price');
  const createdAtEl = $('created_at');
  const categoryEl  = $('category');
  const brandEl     = $('brand');
  const stockEl     = $('stock');
  const editToggle  = $('editToggle');
  const editActions = $('editActions');
  const saveBtn     = $('saveBtn');
  const cancelBtn   = $('cancelBtn');
  const deleteBtn   = $('deleteBtn');
  const createBtn   = $('createBtn');

  // datalists
  const catsList    = $('cats');
  const brandsList  = $('brands');

  let codeReader = null;
  let stream = null;

  // Определяем штрих‑код из URL: /product/:barcode, ?barcode=..., или #...
  function getBarcodeFromUrl() {
    try {
      const parts = (location.pathname || '').split('/').filter(Boolean);
      const last = decodeURIComponent(parts.pop() || '');
      if (last && last !== 'product' && last !== 'product.html') return last;
      const q = new URLSearchParams(location.search).get('barcode');
      if (q) return q;
      if (location.hash && location.hash.length > 1) return decodeURIComponent(location.hash.slice(1));
    } catch {}
    return '';
  }
  const urlBarcode = getBarcodeFromUrl();

  if (createdAtEl) createdAtEl.valueAsDate = new Date();

  function setStatus(m){ if (statusEl) statusEl.textContent = m || ''; }
  function setDisabled(dis) {
    [nameEl, priceEl, createdAtEl, categoryEl, brandEl, stockEl]
      .filter(Boolean).forEach(i => i.disabled = dis);
  }

  async function loadCategoriesAndBrands() {
    try {
      const [catsRes, brandsRes] = await Promise.all([
        fetch('/api/categories'),
        fetch('/api/brands').catch(()=>({ json: async()=>({data:[]}) }))
      ]);
      const catsJson   = await catsRes.json();
      const brandsJson = await brandsRes.json();
      if (catsList) {
        catsList.innerHTML = '';
        (catsJson.data || []).forEach(c => { const o = document.createElement('option'); o.value = c; catsList.appendChild(o); });
      }
      if (brandsList) {
        brandsList.innerHTML = '';
        (brandsJson.data || []).forEach(b => { const o = document.createElement('option'); o.value = b; brandsList.appendChild(o); });
      }
    } catch (e) { /* ignore */ }
  }

  // Подгружаем товар и заполняем форму
  async function loadProduct() {
    if (!urlBarcode) { setStatus('Не указан штрих‑код в URL'); return; }
    try {
      const r = await fetch(`/api/products?barcode=${encodeURIComponent(urlBarcode)}`);
      if (r.status === 401) { location.href = '/login'; return; }
      const j = await r.json();
      if (!j.data) { setStatus('Товар не найден'); return; }
      const p = j.data;
      if (barcodeEl)   barcodeEl.value   = p.barcode || '';
      if (nameEl)      nameEl.value      = p.name || '';
      if (priceEl)     priceEl.value     = p.price ?? '';
      if (createdAtEl) createdAtEl.value = p.created_at || '';
      if (categoryEl)  categoryEl.value  = p.category || '';
      if (brandEl)     brandEl.value     = p.brand || '';
      if (stockEl)     stockEl.value     = p.stock ?? 0;
      const titleEl = document.getElementById('title');
      if (titleEl) titleEl.textContent = p.name || 'Товар';
      setStatus('');
    } catch (e) {
      setStatus('Ошибка загрузки товара');
    }
  }

  async function handleDecoded(text){
    if (overlay) overlay.textContent = `Найден код: ${text}`;
    if (barcodeEl) barcodeEl.value = text;
    try {
      const r = await fetch(`/api/products?barcode=${encodeURIComponent(text)}`);
      const j = await r.json();
      if (j.data) {
        setStatus('Товар уже зарегистрирован. Открываю…');
        setTimeout(()=> location.href = `/product/${encodeURIComponent(text)}`, 400);
      } else {
        nameEl?.focus();
        setStatus('Новый товар — заполни поля и создай.');
      }
    } catch (e) {
      setStatus('Ошибка запроса к серверу');
    }
  }

  async function start(){
    try{
      if (!window.isSecureContext && location.hostname !== 'localhost') {
        setStatus('Нужен HTTPS или localhost');
        return;
      }

      // 1) try back camera first
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      // 2) preview
      if (video) {
        video.srcObject = stream;
        await video.play();
      }

      // 3) start ZXing on this device
      codeReader = new ZXing.BrowserMultiFormatReader();
      const devId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || null;
      codeReader.decodeFromVideoDevice(devId, video, (result/*, err*/)=>{
        if(result){
          handleDecoded(result.getText ? result.getText() : result.text);
        }
      });
      setStatus('Сканер запущен');
    }catch(e){
      if (e.name === 'NotAllowedError') setStatus('Дай разрешение на камеру в браузере.');
      else if (e.name === 'NotFoundError') setStatus('Камера не найдена.');
      else if (e.name === 'NotReadableError') setStatus('Камера занята другим приложением.');
      else setStatus('Ошибка камеры: ' + e.message);
    }
  }

  function stop(){
    try { codeReader?.reset(); } catch {}
    if (stream) { try { stream.getTracks().forEach(t=>t.stop()); } catch {} stream = null; }
    setStatus('Сканер остановлен');
  }

  // from photo
  async function decodeFromImageFile(file){
    if (!file) return;
    setStatus('Распознаём фото…');
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      try {
        if (typeof ZXing.BrowserMultiFormatReader.prototype.decodeFromImage === 'function') {
          const r = await new ZXing.BrowserMultiFormatReader().decodeFromImage(img);
          await handleDecoded(r.getText ? r.getText() : r.text);
          setStatus('Готово');
          URL.revokeObjectURL(url);
          return;
        }
        const canvas = document.createElement('canvas');
        const maxW = 1280;
        const ratio = Math.min(1, maxW / img.width);
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const luminance = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        const binarizer = new ZXing.Common.HybridBinarizer(luminance);
        const bitmap = new ZXing.BinaryBitmap(binarizer);
        const reader = new ZXing.MultiFormatReader();
        const result = reader.decode(bitmap);
        await handleDecoded(result.getText());
        setStatus('Готово');
      } catch (err) {
        setStatus('Не удалось распознать код на фото');
      } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => setStatus('Не удалось открыть фото');
    img.src = url;
  }

  // wire up handlers only if elements exist
  if (startBtn) startBtn.onclick = start;
  if (stopBtn)  stopBtn.onclick  = stop;
  if (logoutBtn) logoutBtn.onclick = async () => { await fetch('/api/logout', { method:'POST' }); location.href = '/login'; };

  // Editing controls
  if (editToggle && editActions) {
    editToggle.onclick = () => {
      const hidden = editActions.classList.toggle('hidden');
      setDisabled(hidden);
    };
  }
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const body = {
        name: (nameEl?.value || '').trim(),
        price: Number(priceEl?.value),
        created_at: createdAtEl?.value,
        category: (categoryEl?.value || '').trim() || null,
        brand: (brandEl?.value || '').trim() || null,
        stock: Number(stockEl?.value || 0)
      };
      const bc = barcodeEl?.value?.trim();
      if (!bc) { setStatus('Не указан штрих‑код'); return; }
      try {
        const r = await fetch(`/api/products/${encodeURIComponent(bc)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const j = await r.json();
        if (j.ok) { setStatus('Сохранено'); setDisabled(true); editActions?.classList.add('hidden'); await loadProduct(); }
        else setStatus('Ошибка: ' + (j.error || ''));
      } catch { setStatus('Ошибка сохранения'); }
    };
  }
  if (cancelBtn) {
    cancelBtn.onclick = async () => {
      setDisabled(true);
      editActions?.classList.add('hidden');
      await loadProduct();
    };
  }
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      const bc = barcodeEl?.value?.trim();
      if (!bc) return;
      if (!confirm('Удалить товар?')) return;
      try {
        const r = await fetch(`/api/products/${encodeURIComponent(bc)}`, { method:'DELETE' });
        const j = await r.json();
        if (j.ok) location.href = '/search'; else setStatus('Ошибка: ' + (j.error || ''));
      } catch { setStatus('Ошибка удаления'); }
    };
  }

  if (barcodeEl) {
    barcodeEl.addEventListener('change', async () => {
      const code = barcodeEl.value.trim(); if (!code) return;
      try {
        const r = await fetch(`/api/products?barcode=${encodeURIComponent(code)}`);
        const j = await r.json();
        if (j.data) location.href = `/product/${encodeURIComponent(code)}`;
      } catch {}
    });
  }

  if (createBtn) {
    createBtn.onclick = async () => {
      const body = {
        barcode: (barcodeEl?.value || '').trim(),
        name: (nameEl?.value || '').trim(),
        price: Number(priceEl?.value),
        created_at: createdAtEl?.value,
        category: (categoryEl?.value || '').trim() || null,
        brand: (brandEl?.value || '').trim() || null,
        stock: Number(stockEl?.value || 0)
      };
      if(!body.barcode || !body.name || !(body.price>=0) || !body.created_at) { setStatus('Заполни обязательные поля'); return; }
      try {
        const r = await fetch('/api/products', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
        const j = await r.json();
        if (j.ok) location.href = `/product/${encodeURIComponent(body.barcode)}`; else setStatus('Ошибка: '+(j.error||''));
      } catch (e) { setStatus('Ошибка сохранения'); }
    };
  }

  if (pickImage) {
    pickImage.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      decodeFromImageFile(file);
    });
  }

  setDisabled(true);
  loadCategoriesAndBrands();
  loadProduct();
});
