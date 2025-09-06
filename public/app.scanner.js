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

async function loadCategories() {
  const r = await fetch('/api/categories');
  const j = await r.json();
  const dl = document.getElementById('cats');
  dl.innerHTML='';
  (j.data||[]).forEach(c=>{ const o=document.createElement('option'); o.value=c; dl.appendChild(o); });
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

async function start() {
  try {
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      setStatus('Нужен HTTPS или localhost');
      return;
    }

    // 1) просим заднюю камеру (если есть), иначе любую
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
    } catch (e) {
      // фолбэк на любую доступную камеру
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    // 2) показываем превью
    video.srcObject = stream;
    await video.play();

    // 3) берём deviceId из реального трека — это надёжнее, чем перечисление устройств
    const track = stream.getVideoTracks()[0];
    const deviceId = track?.getSettings?.().deviceId || null;

    // 4) запускаем ZXing
    codeReader = new ZXing.BrowserMultiFormatReader();
    codeReader.decodeFromVideoDevice(deviceId, video, (result, err) => {
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

logoutBtn.onclick = async()=>{ await fetch('/api/logout',{method:'POST'}); location.href='/login'; };