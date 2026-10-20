(() => {
  const quickMessages = [
    '我這一輪要拿 A', '我這一輪要拿 B', '我這一輪要拿 C', '我這一輪要拿 D', '我這一輪要拿 E',
    '我這一輪有使用技能', '我技能次數用完了', '我還有技能次數',
  ];
  const panel = document.createElement('article');
  panel.className = 'evil-chat panel';
  document.querySelector('#game')?.appendChild(panel);
  let identity = null;
  let loading = false;

  async function getIdentity() {
    const playerId = localStorage.getItem('pandemic-player-id');
    if (!playerId) return null;
    const response = await fetch('/api/identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId }) });
    return response.ok ? response.json() : null;
  }

  function render() {
    if (!identity || identity.faction !== 'evil') { panel.hidden = true; return; }
    panel.hidden = false;
    const log = (identity.evilMessages || []).slice().reverse();
    panel.innerHTML = `<h2>狂人陣營內部通訊</h2><p class="waiting">此區只有狂人陣營可見，研究員與投影幕不會收到內容。</p><div class="quick-message-grid">${quickMessages.map((text, index) => `<button class="choice" data-message="${index}">${text}</button>`).join('')}</div><div class="evil-log">${log.length ? log.map((message) => `<p><b>${esc(message.name)} 玩家（身份 ${esc(message.role)}）表示：</b>${esc(message.text)}</p>`).join('') : '<p class="waiting">尚無內部訊息。</p>'}</div>`;
    panel.querySelectorAll('[data-message]').forEach((button) => {
      button.onclick = async () => {
        if (loading) return;
        loading = true;
        try {
          const playerId = localStorage.getItem('pandemic-player-id');
          const response = await fetch('/api/evil-message', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ playerId, messageIndex:Number(button.dataset.message) }) });
          const data = await response.json();
          if (!response.ok) alert(data.error || '訊息未能送出。');
        } catch (_) { alert('訊息未能送出。'); }
        finally { loading = false; }
      };
    });
  }

  const events = new EventSource('/events');
  events.onmessage = async (event) => {
    const state = JSON.parse(event.data);
    if (!localStorage.getItem('pandemic-player-id') || state.phase === 'lobby' || state.phase === 'final') { panel.hidden = true; identity = null; return; }
    identity = await getIdentity();
    render();
  };
})();
