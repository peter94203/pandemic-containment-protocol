(() => {
  const panel = document.createElement('article');
  panel.className = 'decision';
  panel.style.marginTop = '16px';
  document.querySelector('#game')?.appendChild(panel);
  const descriptions = {
    '變異工程師': '每局 3 次：使一個樣本危險係數 +4，且收容者不能獲得任何減傷。',
    '黑市走私商': '每局 3 次：標記一個樣本；若它被收容，將在 0～2 回合後使失控指數 +1。',
    '內部破壞者': '每局 1 次：使本輪所有尚未售出的樣本都不能獲得減傷。',
    '假情報員': '每局 3 次：隱藏一個市場樣本的種類，直到收容結果揭曉。',
    '失控宿主': '每局 2 次：鎖定一個樣本；收容者無法用任何連線規則消除它。',
  };
  let identity = null;
  let lastState = null;
  async function getIdentity() {
    const playerId = localStorage.getItem('pandemic-player-id');
    if (!playerId) return null;
    const response = await fetch('/api/identity', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({playerId}) });
    return response.ok ? response.json() : null;
  }
  async function render() {
    if (lastState?.phase === 'lobby') { panel.hidden = true; return; }
    if (!identity) identity = await getIdentity();
    const active = lastState?.phase === 'active' ? lastState.markets.filter((market) => market.status === 'active') : [];
    if (!identity || identity.faction !== 'evil' || !active.length) { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = `<h3>隱密行動｜${identity.role}</h3><p>${descriptions[identity.role] || ''}</p>${active.map((market) => `<button class="choice" data-market="${market.id}">對市場 ${String.fromCharCode(64 + market.id)} 使用技能</button>`).join('')}`;
    panel.querySelectorAll('[data-market]').forEach((button) => { button.onclick = async () => {
      const playerId = localStorage.getItem('pandemic-player-id');
      const response = await fetch('/api/skill', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({playerId, marketId:button.dataset.market}) });
      if (!response.ok) alert((await response.json()).error || '技能未能使用');
    }; });
  }
  const events = new EventSource('/events');
  events.onmessage = (event) => { lastState = JSON.parse(event.data); render(); };
})();
