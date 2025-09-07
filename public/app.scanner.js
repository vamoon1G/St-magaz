const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('startScan');
const stopBtn = document.getElementById('stopScan');
const statusEl = document.getElementById('status');
const logoutBtn = document.getElementById('logout');

const barcodeEl = document.getElementById('barcode');
const nameEl = document.getElementById('name');
const priceEl = document.getElementById('price');
const createdAtEl = document.getElementById('created_at');
const categoryEl = document.getElementById('category');
const brandEl = document.getElementById('brand');
const stockEl = document.getElementById('stock');
const createBtn = document.getElementById('createBtn');

let codeReader, stream;

createdAtEl.valueAsDate = new Date();

// NEW: подгружаем категории и бренды
async function loadCategories() {
  const [catsRes, brandsRes] = await Promise.all([
    fetch('/api/categories'),
    fetch('/api/brands')
  ]);
  const catsJson = await catsRes.json();
  const brandsJson = await brandsRes.json();

  const dlCats = document.getElementById('cats');
  const dlBrands = document.getElementById('brands');
  dlCats.innerHTML = '';
  (catsJson.data || []).forEach(c => { const o = document.createElement('option'); o.value = c; dlCats.appendChild(o); });
  dlBrands.innerHTML = '';
  (brandsJson.data || []).forEach(b => { const o = document.createElement('option'); o.value = b; dlBrands.appendChild(o); });
}
loadCategories();

function setStatus(m){ statusEl.textContent=m||''; }

async function handleDecoded(text){
  overlay.textContent = `Найден код: ${text}`;
  barcodeEl.value = text;
  const r = await fetch(`/api/products?barcode=${encodeURIComponent(text)}`);
  const j = await r.json();
  if (j.data) {
    setStatus('Товар уже зарегистрирован. Открыть страницу…');
    setTimeout(()=> location.href = `/product/${encodeURIComponent(text)}`, 600);
  } else {
    nameEl.focus();
    setStatus('Новый товар — заполни поля и создай.');
  }
}

// NEW: старт камеры без listVideoInputDevices
async function start() {
  try {
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      setStatus('Нужен HTTPS или localhost');
      return;
    }

    // 1) Берём «заднюю» камеру по facingMode, fallback — любая
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    // 2) Превью
    video.srcObject = stream;
    await video.play();

    // 3) deviceId из активного трека (если доступен)
    const devId = stream.getVideoTracks()[0]?.getSettings?.().deviceId || null;

    // 4) Запускаем ZXing
    codeReader = new ZXing.BrowserMultiFormatReader();
    codeReader.decodeFromVideoDevice(devId, video, (result, err) => {
      if (result) handleDecoded(result.getText());
    });

    setStatus('Сканер запущен');
  } catch (e) {
    if (e.name === 'NotAllowedError') setStatus('Дай разрешение на камеру в браузере.');
    else if (e.name === 'NotFoundError') setStatus('Камера не найдена.');
    else if (e.name === 'NotReadableError') setStatus('Камера занята другим приложением.');
    else setStatus('Ошибка камеры: ' + e.message);
  }
}

// NEW: распознавание кода с фото (более устойчивое)
const pickImage = document.getElementById('pickImage');
pickImage?.addEventListener('change', async (e) => {
  let file = e.target.files?.[0];
  if (!file) return;
  setStatus('Распознаём фото…');

  // HEIC → JPEG конвертация, если требуется
  file = await convertHeicIfNeeded(file);

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = async () => {
    try {
      const resultText = await robustDecodeFromImage(img);
      if (resultText) {
        await handleDecoded(resultText);
        setStatus('Готово');
      } else {
        setStatus('Не удалось распознать код на фото');
      }
    } catch (err) {
      setStatus('Не удалось распознать код на фото');
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  img.onerror = () => setStatus('Не удалось открыть фото');
  img.src = url;
});

async function robustDecodeFromImage(img) {
  // 1) Попытка через BrowserMultiFormatReader (если поддерживается)
  try {
    if (typeof ZXing.BrowserMultiFormatReader.prototype.decodeFromImage === 'function') {
      const r = await new ZXing.BrowserMultiFormatReader().decodeFromImage(img);
      const t = r?.getText ? r.getText() : r?.text;
      if (t) return t;
    }
  } catch {}

  // 2) Через канвас, с поворотами и подсказками
  const base = drawScaled(img, 1600);
  const hints = new Map();
  try { hints.set(ZXing.DecodeHintType.TRY_HARDER, true); } catch {}
  try { hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.ITF
  ]); } catch {}

  const angles = [0, 90, 180, 270];
  for (const ang of angles) {
    const c = ang ? rotateCanvas(base, ang) : base;
    // Сначала пробуем гибридный, затем глобальную гистограмму
    const tryBin = [
      (src) => new ZXing.Common.HybridBinarizer(src),
      (src) => new ZXing.Common.GlobalHistogramBinarizer(src)
    ];
    for (const mkBin of tryBin) {
      const text = tryDecodeCanvas(c, hints, mkBin);
      if (text) return text;
      // Небольшое центрированное кадрирование 80% — иногда помогает
      const cropped = cropCenter(c, 0.85);
      const text2 = tryDecodeCanvas(cropped, hints, mkBin);
      if (text2) return text2;
      // Полосы по центру (полезно для 1D кодов)
      for (const stripe of cropHorizontalStripes(c)) {
        const t3 = tryDecodeCanvas(stripe, hints, mkBin);
        if (t3) return t3;
      }
    }
  }
  return null;
}

// HEIC support: загрузка heic2any с CDN и конвертация в JPEG, если браузер не поддерживает HEIC
let heicLoaderPromise = null;
function loadHeic2Any() {
  if (window.heic2any) return Promise.resolve();
  if (heicLoaderPromise) return heicLoaderPromise;
  heicLoaderPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.3/dist/heic2any.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('heic2any load failed'));
    document.head.appendChild(s);
  });
  return heicLoaderPromise;
}

async function convertHeicIfNeeded(file){
  const isHeic = /heic$/i.test(file.name) || file.type === 'image/heic' || file.type === 'image/heif';
  if (!isHeic) return file;
  try {
    await loadHeic2Any();
    if (!window.heic2any) return file;
    const out = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    const blob = Array.isArray(out) ? out[0] : out;
    return new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
  } catch (e) {
    // Если не удалось — возвращаем исходный файл; ниже возникнет ошибка загрузки <img>
    setStatus('HEIC не поддерживается этим браузером. Попробуйте JPEG/PNG.');
    return file;
  }
}

function drawScaled(img, maxW) {
  const ratio = Math.min(1, maxW / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  // Усиливаем контраст и слегка повышаем яркость
  ctx.filter = 'contrast(160%) brightness(105%)';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function rotateCanvas(src, deg) {
  const rad = deg * Math.PI / 180;
  const dst = document.createElement('canvas');
  if (deg % 180 === 0) { dst.width = src.width; dst.height = src.height; }
  else { dst.width = src.height; dst.height = src.width; }
  const ctx = dst.getContext('2d', { willReadFrequently: true });
  ctx.translate(dst.width/2, dst.height/2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width/2, -src.height/2);
  return dst;
}

function cropCenter(src, scale=0.85) {
  const w = Math.round(src.width * scale);
  const h = Math.round(src.height * scale);
  const x = Math.round((src.width - w)/2);
  const y = Math.round((src.height - h)/2);
  const dst = document.createElement('canvas');
  dst.width = w; dst.height = h;
  const ctx = dst.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, x, y, w, h, 0, 0, w, h);
  return dst;
}

function cropHorizontalStripes(src) {
  // Выделяем несколько горизонтальных полос по центру, где обычно расположен штрих‑код
  const stripes = [];
  const heights = [0.25, 0.33, 0.4];
  for (const hFrac of heights) {
    const h = Math.round(src.height * hFrac);
    const y = Math.round((src.height - h) / 2);
    const c = document.createElement('canvas');
    c.width = src.width; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, y, src.width, h, 0, 0, c.width, c.height);
    stripes.push(c);
  }
  return stripes;
}

function tryDecodeCanvas(canvas, hints, mkBinarizer) {
  try {
    const luminance = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    const binarizer = mkBinarizer(luminance);
    const bitmap = new ZXing.BinaryBitmap(binarizer);
    const reader = new ZXing.MultiFormatReader();
    if (reader.setHints && hints) reader.setHints(hints);
    const result = reader.decode(bitmap);
    return result?.getText ? result.getText() : result?.text || null;
  } catch { return null; }
}



function stop(){ try{ codeReader?.reset(); }catch{} if(stream){stream.getTracks().forEach(t=>t.stop()); stream=null;} setStatus('Сканер остановлен'); }

startBtn.onclick=start; stopBtn.onclick=stop;

barcodeEl.addEventListener('change', async()=>{
  const code = barcodeEl.value.trim(); if(!code) return;
  const r = await fetch(`/api/products?barcode=${encodeURIComponent(code)}`);
  const j = await r.json();
  if (j.data) location.href = `/product/${encodeURIComponent(code)}`;
});

createBtn.onclick = async ()=>{
  const body = {
    barcode: barcodeEl.value.trim(),
    name: nameEl.value.trim(),
    price: Number(priceEl.value),
    created_at: createdAtEl.value,
    category: categoryEl.value.trim()||null,
    brand: brandEl.value.trim()||null,
    stock: Number(stockEl.value||0)
  };
  if(!body.barcode || !body.name || !(body.price>=0) || !body.created_at) return setStatus('Заполни обязательные поля');
  const r = await fetch('/api/products',{method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  const j = await r.json();
  if (j.ok) location.href = `/product/${encodeURIComponent(body.barcode)}`; else setStatus('Ошибка: '+(j.error||''));
};

// Безопасно навешиваем обработчик выхода, если кнопка есть на странице
if (logoutBtn) {
  logoutBtn.onclick = async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login';
  };
}
