(() => {
  const descriptions = {
    '病毒專家':'收容病毒樣本時危險係數 −4。','細菌專家':'收容細菌樣本時危險係數 −4。','寄生蟲專家':'收容寄生蟲樣本時危險係數 −4。','免疫學家':'收容所有樣本時危險係數 −2。','研發天才':'每次收容有 15% 機率使危險係數歸零。','收容指揮官':'爭奪同一樣本時，隔離點數視為額外 +3。','生物安全官':'每回合首次無人收容時，不會被扣隔離點數。','緊急應變員':'每回合首次收容時，額外獲得 2 點隔離點數。','病原體獵人':'收容危險係數 15 以上的樣本時，危險係數 −4。',
    '基因定序師':'特殊研究身份；目前保留給後續事件擴充。','疫苗開發員':'特殊研究身份；目前保留給後續事件擴充。','流行病學專家':'特殊研究身份；目前保留給後續事件擴充。','跨域研究員':'特殊研究身份；目前保留給後續事件擴充。'
  };
  let shown = false;
  const overlay = document.createElement('section');
  overlay.className = 'decision'; overlay.style.position = 'fixed'; overlay.style.inset = '8vh 7vw'; overlay.style.zIndex = '9'; overlay.style.overflow = 'auto'; overlay.hidden = true;
  document.body.appendChild(overlay);
  async function request(path, body) { const r = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const d = await r.json(); if(!r.ok) throw Error(d.error); return d; }
  const events = new EventSource('/events');
  events.onmessage = async (event) => {
    const state = JSON.parse(event.data); const playerId = localStorage.getItem('pandemic-player-id');
    if (!playerId || state.phase !== 'identity') { if (shown) overlay.hidden = true; return; }
    try { const info = await request('/api/identity',{playerId}); shown = true; overlay.hidden = false;
      overlay.innerHTML = `<p class="eyebrow">身份確認</p><h2>${info.faction==='evil'?'反收容派':'收容協議研究員'}</h2><p>你的身份：<b>${info.role}</b></p><p>${descriptions[info.role] || '請善用你的身份能力。'}</p>${info.allies.length?`<p>你的反收容派同伴：${info.allies.join('、')}</p>`:''}<p>${info.confirmed?'身份已確認，等待其他玩家。':'請確認你已閱讀身份與能力。'}</p>${info.confirmed?'': '<button class="btn" id="identityConfirm">我已確認身份</button>'}`;
      const button = document.querySelector('#identityConfirm'); if(button) button.onclick = async()=>{await request('/api/confirm',{playerId});};
    } catch (_) {}
  };
})();
