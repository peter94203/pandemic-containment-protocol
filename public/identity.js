(() => {
  const descriptions = {
    '病毒專家':'收容病毒樣本時危險係數 −5。','細菌專家':'收容細菌樣本時危險係數 −5。','寄生蟲專家':'收容寄生蟲樣本時危險係數 −5。','免疫學家':'收容所有樣本時危險係數 −2。','研發天才':'每次收容有 20% 機率使危險係數歸零。','收容指揮官':'爭奪同一樣本時，隔離點數視為額外 +3。','生物安全官':'每回合首次無人收容時，不會被扣隔離點數。','緊急應變員':'每回合第一次收到樣本時，額外獲得 2 點隔離點數。','病原體獵人':'收容危險係數大於 15 的樣本時，危險係數 −5。',
    '基因定序師':'同類型連號樣本只要湊齊 2 張，即可消除。','疫苗開發員':'每成功消除一組樣本，獲得 +5 隔離點數。','流行病學專家':'每回合可私下預覽下一回合必定出現的 3 張樣本。','跨域研究員':'相同數字的任意兩種類型樣本，即可消除。',
    '變異工程師':'每局 5 次：選擇一個分配所樣本，使危險係數 +6，且收容者不能取得任何減傷。','黑市走私商':'每局 3 次：預覽下回合兩張樣本並秘密標記一張；它在第一小回合被收容時，失控 +1、你獲得 +2 隔離點數。','內部破壞者':'每局 2 次：第一小回合啟用；若五張未全數收容，未收容樣本危險係數 +20，且不可減傷或消除。','假情報員':'每局 4 次：在回合結束後，預先指定下回合一個病原體分配所；公開時會直接隱藏其種類與編號。','失控宿主':'每局 3 次：秘密鎖定一張樣本；收容者取得後才會發現它無法消除。'
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
      overlay.innerHTML = `<p class="eyebrow">身份確認</p><h2>${info.faction==='evil'?'狂人陣營':'研究員陣營'}</h2><p>你的身份：<b>${info.role}</b></p><p>${descriptions[info.role] || '請善用你的身份能力。'}</p>${info.allies.length?`<p>你的狂人陣營同伴：${info.allies.join('、')}</p>`:''}<p>${info.confirmed?'身份已確認，等待其他玩家。':'請確認你已閱讀身份與能力。'}</p>${info.confirmed?'': '<button class="btn" id="identityConfirm">我已確認身份</button>'}`;
      const button = document.querySelector('#identityConfirm'); if(button) button.onclick = async()=>{await request('/api/confirm',{playerId});};
    } catch (_) {}
  };
})();
