(() => {
  const panel = document.createElement('section');
  panel.className = 'panel rankings'; panel.style.marginTop = '18px';
  document.querySelector('.app')?.appendChild(panel);
  async function refresh() {
    const key = localStorage.getItem('pandemic-host-key');
    if (!key) { panel.innerHTML = '<p class="waiting">輸入主持人密鑰並開始遊戲後，監控面板會顯示。</p>'; return; }
    const response = await fetch('/api/host/state',{headers:{'X-Host-Key':key}});
    if (!response.ok) return;
    const state = await response.json();
    const delayed = state.delayedEffects?.length ? `<p>延遲異常：${state.delayedEffects.map(x=>`${x.sourceName || '未知'} → 第 ${x.dueRound} 輪 +${x.amount}`).join('；')}</p>` : '<p>延遲異常：無</p>';
    const result = state.result ? `<h2>${state.result.winningFaction==='evil'?'反收容派勝利':'收容協議成功'}</h2>${state.result.scores.map((player,index)=>`<div class="row"><b>#${index+1}</b><span>${player.name}｜${player.faction==='evil'?'壞人':'好人'} ${player.role}</span><span>${player.base}+${player.bonus}=${player.total}</span></div>`).join('')}` : `<button class="btn" id="finalizeGame">鎖定失控指數並最終結算</button>`;
    panel.innerHTML = `<h2>主持人私有監控｜失控指數 ${state.outbreak}</h2>${delayed}${state.players.map(player=>`<div class="row"><b>${player.name}</b><span>${player.faction==='evil'?'壞人':'好人'}｜${player.role}</span><span>確認:${player.confirmed?'✓':'—'}｜舉報:${player.reports}</span><span>${player.actions?JSON.stringify(player.actions):'未送出'}</span></div>`).join('')}${result}`;
    const button = document.querySelector('#finalizeGame');
    if (button) button.onclick = async () => { if (!confirm('確定鎖定失控指數並結算？')) return; await fetch('/api/host/finalize',{method:'POST',headers:{'X-Host-Key':key}}); };
  }
  setInterval(refresh, 1500); refresh();
})();
