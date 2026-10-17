(() => {
  const box = document.createElement('div');
  box.className = 'decision'; box.style.marginTop = '16px';
  document.querySelector('#game')?.appendChild(box);
  let identity = null, sentRound = 0;
  async function identityFor(playerId) {
    const response = await fetch('/api/identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId})});
    return response.ok ? response.json() : null;
  }
  const events = new EventSource('/events');
  events.onmessage = async (event) => {
    const state = JSON.parse(event.data), playerId = localStorage.getItem('pandemic-player-id');
    if (!playerId || state.phase === 'lobby') { box.hidden = true; return; }
    if (!identity) identity = await identityFor(playerId);
    const me = state.players.find((player) => player.id === playerId);
    if (!identity || identity.faction !== 'good' || !me || state.round < 2 || state.phase !== 'active' || sentRound === state.round) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<h3>匿名舉報</h3><p>本回合可舉報一名未公開陣營的實驗室；9 點會公開陣營。</p>${state.players.filter((player) => player.id !== playerId && !player.revealed).map((player) => `<button class="choice" data-target="${player.id}">${player.name}<small>舉報點 ${player.reports}</small></button>`).join('')}`;
    box.querySelectorAll('[data-target]').forEach((button) => button.onclick = async () => {
      const response = await fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId,targetId:button.dataset.target})});
      if (response.ok) { sentRound = state.round; box.hidden = true; } else alert((await response.json()).error);
    });
  };
})();
