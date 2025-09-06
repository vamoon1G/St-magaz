const searchInput = document.getElementById('search');
const resultsList = document.getElementById('results');
const logoutBtn = document.getElementById('logout');

let timer;
searchInput.addEventListener('input', ()=>{
  clearTimeout(timer);
  timer = setTimeout(run, 250);
});

async function run(){
  const q = searchInput.value.trim();
  const r = await fetch(`/api/products?q=${encodeURIComponent(q)}`);
  const j = await r.json();
  resultsList.innerHTML='';
  (j.data||[]).forEach(p=>{
    const li = document.createElement('li');
    li.className = 'list-item hoverable';
    li.innerHTML = `<div class="rowed"><b>${p.name}</b><span class="muted"> — ${p.price} / шт</span></div><div class="code">${p.barcode}</div><a class="exists" href="/product/${encodeURIComponent(p.barcode)}" title="Товар уже есть — перейти">↗</a>`;
    li.onclick = (e)=>{ if(!(e.target instanceof HTMLAnchorElement)) location.href = `/product/${encodeURIComponent(p.barcode)}`; };
    resultsList.appendChild(li);
  });
}

logoutBtn.onclick = async()=>{ await fetch('/api/logout',{method:'POST'}); location.href='/login'; };

run();
