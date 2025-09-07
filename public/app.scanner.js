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
  resetDecodeLog();
  setStatus('Готовим фото…');
  logStep(`Исходный файл: name=${file.name||'(без имени)'} type=${file.type||'(unknown)'} size=${fmtSize(file.size)}`);

  // HEIC → JPEG конвертация, если требуется
  const conv = await convertHeicIfNeeded(file);
  if (!conv?.blob) { setStatus('Не удалось открыть HEIC. Попробуйте JPEG/PNG.'); logStep('Конвертация не удалась.'); return; }
  logStep(`Конвертация: метод=${conv.method} → type=${conv.blob.type||'(unknown)'} size=${fmtSize(conv.blob.size)}`);
  const url = URL.createObjectURL(conv.blob);
  const img = new Image();
  img.onload = async () => {
    logStep(`Изображение загружено: ${img.width}x${img.height}`);
    showPreview(url, conv.blob.type||'image/*');
    setStatus('Распознаём фото…');
    try {
      const resultText = await robustDecodeFromImage(img);
      if (resultText) {
        await handleDecoded(resultText);
        setStatus('Готово');
      } else {
        setStatus('Не удалось распознать код на фото');
      }
    } catch (err) {
      console.error('[scanner] decode error', err);
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

  // 2) Попытка через нативный BarcodeDetector (если доступен)
  try {
    if ('BarcodeDetector' in window) {
      const bd = new window.BarcodeDetector({ formats: ['ean_13','ean_8','upc_a','code_128','code_39','itf'] });
      // Пробуем оригинал и повороты
      const tries = [img];
      // create a canvas scaled for detector (небольшой для скорости)
      const baseSmall = drawScaled(img, 1600);
      tries.push(baseSmall);
      const r0 = await bd.detect(tries[0]).catch(()=>[]);
      const r1 = r0?.length ? r0 : await bd.detect(tries[1]).catch(()=>[]);
      const found = r1?.[0]?.rawValue;
      if (found) return found;
    }
  } catch {}

  // 3) Через канвас, с поворотами и подсказками
  const base = drawScaled(img, 1800);
  // Несколько вариантов подсказок: сначала фокус на EAN‑13/UPC‑A (книги/товары), затем шире
  const hintsVariants = [];
  try {
    const baseHints = new Map();
    baseHints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    baseHints.set(ZXing.DecodeHintType.ASSUME_GS1, true);
    const narrow = new Map(baseHints);
    narrow.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.UPC_A]);
    const wide = new Map(baseHints);
    wide.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
      ZXing.BarcodeFormat.EAN_13,
      ZXing.BarcodeFormat.EAN_8,
      ZXing.BarcodeFormat.UPC_A,
      ZXing.BarcodeFormat.CODE_128,
      ZXing.BarcodeFormat.CODE_39,
      ZXing.BarcodeFormat.ITF
    ]);
    hintsVariants.push(narrow, wide);
  } catch { hintsVariants.push(null); }

  // Набор углов, включая небольшие повороты для фотографий "чуть под углом"
  const angles = [0, 3, -3, 6, -6, 10, -10, 14, -14, 20, -20, 90, 180, 270];
  for (const ang of angles) {
    const c = ang ? rotateCanvas(base, ang) : base;
    // Сначала пробуем гибридный, затем глобальную гистограмму
    const tryBin = [
      (src) => new ZXing.Common.HybridBinarizer(src),
      (src) => new ZXing.Common.GlobalHistogramBinarizer(src)
    ];
    for (const mkBin of tryBin) {
      for (const hints of hintsVariants) {
        const text = tryDecodeCanvas(c, hints, mkBin);
        if (text) return text;
        // Небольшое центрированное кадрирование — иногда помогает
        const cropped = cropCenter(c, 0.88);
        const text2 = tryDecodeCanvas(cropped, hints, mkBin);
        if (text2) return text2;
        // Полосы по центру (полезно для 1D кодов)
        for (const stripe of cropHorizontalStripes(c)) {
          const t3 = tryDecodeCanvas(stripe, hints, mkBin);
          if (t3) return t3;
        }
        // Дополнительно: предварительная бинаризация Otsu на срезах
        const bw = binarizeOtsu(c);
        const t4 = tryDecodeCanvas(bw, hints, mkBin);
        if (t4) return t4;
      }
    }
  }
  // 4) Fallback: Quagga2 (иногда лучше ловит EAN‑13 на фото)
  try {
    logStep('Fallback Quagga2: пробуем распознать по всему кадру');
    const q1 = await quaggaDecodeFromCanvas(base);
    if (q1) return q1;
    for (const ang of [90,180,270]){
      const c = rotateCanvas(base, ang);
      const q = await quaggaDecodeFromCanvas(c);
      if (q) return q;
    }
  } catch (e) { console.warn('Quagga fallback error', e); }
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
  const isHeic = /\.heic$/i.test(file.name || '') || /heic|heif/i.test(file.type || '');
  if (!isHeic) return { blob: file, method: 'pass-through' };
  try {
    await loadHeic2Any();
    if (window.heic2any) {
      // Convert to PNG for maximum compatibility
      const out = await window.heic2any({ blob: file, toType: 'image/png' });
      const blob = Array.isArray(out) ? out[0] : out;
      return { blob, method: 'heic2any->png' };
    }
  } catch {}
  try {
    if (window.createImageBitmap) {
      const bmp = await window.createImageBitmap(file);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      if (blob) return { blob, method: 'imageBitmap->canvas->png' };
    }
  } catch {}
  return { blob: null, method: 'failed' };
}

function drawScaled(img, maxW) {
  const ratio = Math.min(1, maxW / img.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  // Убрали фильтры: иногда они портят 1D коды (пересатурация)
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
    logStep(`Пробуем decode: ${canvas.width}x${canvas.height} binarizer=${mkBinarizer.name||'unknown'}`);
    const luminance = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
    const binarizer = mkBinarizer(luminance);
    const bitmap = new ZXing.BinaryBitmap(binarizer);
    const reader = new ZXing.MultiFormatReader();
    if (reader.setHints && hints) reader.setHints(hints);
    const result = reader.decode(bitmap);
    return result?.getText ? result.getText() : result?.text || null;
  } catch { return null; }
}

// ---------- Quagga2 fallback ----------
let quaggaLoaderPromise = null;
function loadQuagga(){
  if (window.Quagga) return Promise.resolve();
  if (quaggaLoaderPromise) return quaggaLoaderPromise;
  quaggaLoaderPromise = new Promise((resolve, reject) => {
    const urls = [
      'https://cdn.jsdelivr.net/npm/quagga2@1.2.6/dist/quagga.min.js',
      'https://unpkg.com/quagga2@1.2.6/dist/quagga.min.js'
    ];
    let i = 0;
    const tryNext = () => {
      if (i >= urls.length) return reject(new Error('Quagga load failed'));
      const s = document.createElement('script');
      s.src = urls[i++];
      s.onload = () => resolve();
      s.onerror = () => { s.remove(); tryNext(); };
      document.head.appendChild(s);
    };
    tryNext();
  });
  return quaggaLoaderPromise;
}

async function quaggaDecodeFromCanvas(canvas){
  await loadQuagga();
  if (!window.Quagga) return null;
  const dataUrl = canvas.toDataURL('image/png');
  return new Promise((resolve) => {
    window.Quagga.decodeSingle({
      src: dataUrl,
      numOfWorkers: 0,
      inputStream: { size: Math.max(canvas.width, canvas.height) },
      locator: { halfSample: false, patchSize: 'large' },
      decoder: { readers: ['ean_reader','ean_8_reader','upc_reader','upc_e_reader','code_128_reader','code_39_reader','itf_reader'] }
    }, (result) => {
      const code = result?.codeResult?.code || null;
      if (code) logStep('Quagga2: найден код ' + code);
      resolve(code);
    });
  });
}

// ---------- Simple Otsu binarization ----------
function binarizeOtsu(src){
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0,0,c.width,c.height); const d = img.data;
  const hist = new Uint32Array(256);
  for (let i=0;i<d.length;i+=4){ const g=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])|0; hist[g]++; }
  let sum=0; for (let t=0;t<256;t++) sum+=t*hist[t];
  let sumB=0, wB=0, wF=0, mB=0, mF=0, max=0, thresh=127; const tot=c.width*c.height;
  for (let t=0;t<256;t++){ wB+=hist[t]; if (wB===0) continue; wF=tot-wB; if (wF===0) break; sumB+=t*hist[t]; mB=sumB/wB; mF=(sum-sumB)/wF; const between=wB*wF*(mB-mF)*(mB-mF); if (between>max){ max=between; thresh=t; } }
  for (let i=0;i<d.length;i+=4){ const g=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])|0; const v = g>thresh?255:0; d[i]=d[i+1]=d[i+2]=v; d[i+3]=255; }
  ctx.putImageData(img,0,0); return c;
}

// ---------- Debug log helpers ----------
function ensureLogBox(){
  let box = document.getElementById('decodeLogBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'decodeLogBox';
    box.style.marginTop = '8px';
    box.style.padding = '8px';
    box.style.border = '1px dashed var(--border)';
    box.style.borderRadius = '8px';
    box.style.background = 'rgba(17,22,28,.6)';
    const parent = statusEl?.parentElement || document.body;
    parent.appendChild(box);
  }
  return box;
}
function logStep(text){
  // UI logging disabled: keep console output only
  console.log('[scanner]', text);
}
function resetDecodeLog(){
  const box = document.getElementById('decodeLogBox');
  if (box) box.innerHTML = '';
}
function fmtSize(n){ if (!Number.isFinite(n)) return '—'; const kb = n/1024; return kb<1024? `${kb.toFixed(1)} KB` : `${(kb/1024).toFixed(2)} MB`; }
function showPreview(url, type){
  const box = ensureLogBox();
  let img = document.getElementById('convertedPreview');
  if (!img) { img = document.createElement('img'); img.id='convertedPreview'; img.style.maxWidth='100%'; img.style.marginTop='8px'; img.style.borderRadius='8px'; img.style.border='1px solid var(--border)'; box.appendChild(img); }
  img.src = url; img.alt = `converted (${type})`;
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
