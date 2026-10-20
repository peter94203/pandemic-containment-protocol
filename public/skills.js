(() => {
  const panel = document.createElement('article');
  panel.className = 'decision'; panel.style.marginTop = '16px';
  document.querySelector('#game')?.appendChild(panel);
  const descriptions = {
    '變異工程師':'每局 5 次：選一張樣本 +10，且不能減傷。','黑市走私商':'每局 3 次：從下回合預覽的兩張樣本中秘密標記一張。','內部破壞者':'每局 2 次：第一小回合啟用；若未全數收容，剩餘樣本 +30 且不可減傷、不可消除。','假情報員':'每局 2 次：偽造下回合全部五個病原體分配所的樣本資訊。','失控宿主':'每局 4 次：秘密鎖定一張樣本；收容後才會揭露不可消除。',
  };
  let identity=null,lastState=null,previousPhase='';
  async function getIdentity(){const playerId=localStorage.getItem('pandemic-player-id');if(!playerId)return null;const r=await fetch('/api/identity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId})});return r.ok?r.json():null;}
  async function render(){
    const phase=lastState?.phase;if(phase==='lobby'){panel.hidden=true;previousPhase=phase;return;}
    if(phase!==previousPhase){if(phase==='identity'||phase==='between')identity=null;previousPhase=phase;}
    if(!identity)identity=await getIdentity();
    const active=phase==='active'?lastState.markets.filter(m=>m.status==='active'):[];
    if(!identity||identity.faction!=='evil'||identity.revealed){panel.hidden=true;return;}
    let choices='';
    if(identity.role==='假情報員'&&phase==='between') choices=identity.pendingHiddenAll?'<p class="waiting">已偽造下回合全部五個病原體分配所。</p>':'<button class="choice" data-market="all">偽造下回合全部五個病原體分配所</button>';
    else if(identity.role==='黑市走私商'&&phase==='between') choices=identity.pendingSmuggledSampleId?'<p class="waiting">已秘密標記一張下回合樣本。</p>':identity.smugglerPreview.map(s=>`<button class="choice" data-market="${s.id}">標記：${s.typeLabel} ${s.code} <span class="risk">−${s.risk}</span></button>`).join('')||'<p class="waiting">卡池已無下一回合樣本。</p>';
    else if(identity.role==='內部破壞者'&&phase==='active'&&active.length&&lastState.markets.every(m=>m.pot===0)) choices=`<button class="choice" data-market="${active[0].id}">啟用本回合內部破壞</button>`;
    else if(['假情報員','黑市走私商','內部破壞者'].includes(identity.role)) {panel.hidden=true;return;}
    else if(active.length) choices=active.map(m=>`<button class="choice" data-market="${m.id}">對病原體分配所 ${String.fromCharCode(64+m.id)} 使用技能</button>`).join('');
    else {panel.hidden=true;return;}
    panel.hidden=false;panel.innerHTML=`<h3>隱密行動｜${identity.role}</h3><p>${descriptions[identity.role]}</p>${choices}`;
    panel.querySelectorAll('[data-market]').forEach(button=>button.onclick=async()=>{if(!confirm(`確定要使用「${identity.role}」技能嗎？\n本大回合使用後不能再使用其他技能。`))return;const playerId=localStorage.getItem('pandemic-player-id');const r=await fetch('/api/skill',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerId,marketId:button.dataset.market})});if(!r.ok)alert((await r.json()).error||'技能未能使用');else{identity=await getIdentity();render();}});
  }
  const events=new EventSource('/events');events.onmessage=e=>{lastState=JSON.parse(e.data);render();};
})();
