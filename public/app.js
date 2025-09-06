const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startScan');
const stopBtn = document.getElementById('stopScan');
const flipBtn = document.getElementById('flipCam');
const pickImage = document.getElementById('pickImage');

const barcodeEl = document.getElementById('barcode');
const nameEl = document.getElementById('name');
const priceEl = document.getElementById('price');
const unitEl = document.getElementById('unit');
const categoryEl = document.getElementById('category');
const brandEl = document.getElementById('brand');
const stockEl = document.getElementById('stock');
const pinEl = document.getElementById('pin');

const saveBtn = document.getElementById('saveBtn');
const updateBtn = document.getElementById('updateBtn');
const deleteBtn = document.getElementById('deleteBtn');
const statusEl = document.getElementById('status');

const searchInput = document.getElementById('search');
const resultsList = document.getElementById('results');

let codeReader;
let currentStream;
let currentDeviceId = null;
let devices = [];

function setStatus(msg, kind = 'info') {
  statusEl.textContent = msg || '';
  statusEl.dataset.kind = kind;
}

function fillForm(p = {}) {
  barcodeEl.value = p.barcode || '';
  nameEl.value = p.name || '';
  priceEl.value = p.price ?? '';
  unitEl.value = p.unit || 'шт';
  categoryEl.value = p.category || '';
  brandEl.value = p.brand || '';
  stockEl.value = p.stock ?? 0;
}

async function fetchByBarcode(barcode) {
  const r = await fetch(`/api/products?barcode=${encodeURIComponent(barcode)}`);
  const json = await r.json();
  return json.data || null;
}

async function handleDecoded(text) {
  if (!text) return;
  overlay.textContent = `Найден код: ${text}`;
  barcodeEl.value = text;
  const item = await fetchByBarcode(text);
  if (item) {
    fillForm(item);
    setStatus('Товар найден. Можно редактировать.', 'success');
  } else {
    nameEl.focus();
    setStatus('Новый товар. Заполни поля и создай.', 'warn');
  }
}

async function listDevices() {
  try {
    devices = await ZXing.BrowserCodeReader.listVideoInputDevices();
  } catch (e) { devices = []; }
}

async function startScanner() {
  try {
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      setStatus('Нужен HTTPS (или запускай на localhost).', 'error');
      return;
    }

    setStatus('Запуск камеры...');
    codeReader = new ZXing.BrowserMultiFormatReader();

    await listDevices();
    // Выбираем "заднюю" если есть, иначе первую
    const preferred = devices.find(d => /back|rear|environment/i.test(d.label)) || devices[0];
    currentDeviceId = preferred?.deviceId || null;

    const constraints = currentDeviceId ? { deviceId: { exact: currentDeviceId } } : { facingMode: 'environment' };

    currentStream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
    video.srcObject = currentStream;
    await video.play();

    setStatus('Сканер запущен. Наведи на штрих‑код.', 'success');

    const controls = await codeReader.decodeFromVideoDevice(currentDeviceId, video, (result, err) => {
      if (result) handleDecoded(result.getText());
    });

    video._controls = controls;
  } catch (e) {
    if (e.name === 'NotAllowedError') setStatus('Дай разрешение на камеру в браузере.', 'error');
    else if (e.name === 'NotFoundError') setStatus('Не найдена камера. Подключи камеру или используй телефон.', 'error');
    else if (e.name === 'NotReadableError') setStatus('Камера занята другим приложением. Закрой Zoom/Telegram/OBS и попробуй снова.', 'error');
    else setStatus('Ошибка камеры: ' + e.message, 'error');
  }
}

function stopScanner() {
  try { video._controls?.stop(); } catch {}
  if (currentStream) { currentStream.getTracks().forEach(t => t.stop()); currentStream = null; }
  setStatus('Сканер остановлен.');
}

async function flipCamera() {
  if (!devices.length) await listDevices();
  if (!devices.length) return setStatus('Камер нет.', 'error');
  const idx = devices.findIndex(d => d.deviceId === currentDeviceId);
  const next = devices[(idx + 1) % devices.length];
  currentDeviceId = next.deviceId;
  stopScanner();
  setTimeout(startScanner, 100);
}

async function decodeImageFile(file) {
  if (!file) return;
  setStatus('Распознаём изображение...');
  const reader = new FileReader();
  reader.onload = async () => {
    const img = new Image();
    img.onload = async () => {
      try {
        const luminanceSource = new ZXing.HTMLCanvasElementLuminanceSource(drawToCanvas(img));
        const binarizer = new ZXing.Common.HybridBinarizer(luminanceSource);
        const bitmap = new ZXing.BinaryBitmap(binarizer);
        const result = new ZXing.MultiFormatReader().decode(bitmap);
        await handleDecoded(result.getText());
        setStatus('Готово.', 'success');
      } catch (e) {
        setStatus('Не удалось распознать код на фото.', 'error');
      }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function drawToCanvas(img) {
  const canvas = document.createElement('canvas');
  const w = Math.min(1280, img.width);
  const ratio = w / img.width;
  canvas.width = w;
  canvas.height = Math.round(img.height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

startBtn.addEventListener('click', startScanner);
stopBtn.addEventListener('click', stopScanner);
flipBtn.addEventListener('click', flipCamera);

pickImage.addEventListener('change', (e) => decodeImageFile(e.target.files?.[0]));

barcodeEl.addEventListener('change', async () => {
  const code = barcodeEl.value.trim();
  if (!code) return;
  const item = await fetchByBarcode(code);
  if (item) { fillForm(item); setStatus('Товар найден.', 'success'); }
  else { nameEl.value = ''; setStatus('Новый товар. Заполни поля и нажми Создать.', 'warn'); }
});

saveBtn.addEventListener('click', async () => {
  const body = {
    barcode: barcodeEl.value.trim(),
    name: nameEl.value.trim(),
    price: Number(priceEl.value),
    unit: unitEl.value.trim() || 'шт',
    category: categoryEl.value.trim(),
    brand: brandEl.value.trim(),
    stock: Number(stockEl.value || 0),
    pin: pinEl.value
  };
  const r = await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await r.json();
  if (json.ok) setStatus('Создано успешно.', 'success'); else setStatus('Ошибка: ' + (json.error || ''), 'error');
});

updateBtn.addEventListener('click', async () => {
  const code = barcodeEl.value.trim();
  if (!code) return setStatus('Нет штрих‑кода', 'error');
  const body = {
    name: nameEl.value.trim(),
    price: Number(priceEl.value),
    unit: unitEl.value.trim() || 'шт',
    category: categoryEl.value.trim(),
    brand: brandEl.value.trim(),
    stock: Number(stockEl.value || 0),
  };
  const r = await fetch(`/api/products/${encodeURIComponent(code)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': pinEl.value },
    body: JSON.stringify(body)
  });
  const json = await r.json();
  if (json.ok) setStatus('Изменения сохранены.', 'success'); else setStatus('Ошибка: ' + (json.error || ''), 'error');
});

deleteBtn.addEventListener('click', async () => {
  const code = barcodeEl.value.trim();
  if (!code) return setStatus('Нет штрих‑кода', 'error');
  if (!confirm('Удалить товар?')) return;
  const r = await fetch(`/api/products/${encodeURIComponent(code)}`, { method: 'DELETE', headers: { 'x-admin-pin': pinEl.value } });
  const json = await r.json();
  if (json.ok) { fillForm({}); setStatus('Удалено.', 'success'); } else setStatus('Ошибка: ' + (json.error || ''), 'error');
});

let searchTimer;
searchInput?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = searchInput.value.trim();
    const r = await fetch(`/api/products?q=${encodeURIComponent(q)}`);
    const json = await r.json();
    resultsList.innerHTML = '';
    (json.data || []).forEach(p => {
      const li = document.createElement('li');
      li.className = 'list-item';
      li.innerHTML = `<b>${p.name}</b><span class="muted"> — ${p.price} / ${p.unit}</span><div class="code">${p.barcode}</div>`;
      li.addEventListener('click', () => { fillForm(p); barcodeEl.scrollIntoView({ behavior: 'smooth' }); });
      resultsList.appendChild(li);
    });
  }, 250);
});