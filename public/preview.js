(() => {
  const panel = document.createElement('article');
  panel.className = 'personal panel'; panel.style.marginTop = '16px'; panel.hidden = true;
  document.querySelector('#game')?.appendChild(panel);
  let lastRound = -1;
  async function refresh() {
    const playerId = localStorage.getItem('pandemic-player-id');
    if (!playerId) return;
    const response = await fetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId})});
    if (!response.ok) return;
    const { preview } = await response.json();
    if (!preview?.length) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = `<p class="eyebrow">流行病學預測｜僅你可見</p><h3>下一回合樣本預覽</h3>${preview.map((sample)=>`<p class="sample">${sample.typeLabel} ${sample.code} <span class="risk">−${sample.risk}</span></p>`).join('')}`;
  }
  const events = new EventSource('/events');
  events.onmessage = (event) => {
    const state = JSON.parse(event.data);
    if (state.round !== lastRound || state.phase === 'active') { lastRound = state.round; refresh(); }
  };
})();
