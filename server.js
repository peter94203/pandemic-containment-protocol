const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST_KEY = process.env.HOST_KEY || '';
const PUBLIC = path.join(__dirname, 'public');
const clients = new Set();
const SAMPLE_TYPES = [
  { id: 'virus', label: '病毒', prefix: 'V' },
  { id: 'bacteria', label: '細菌', prefix: 'B' },
  { id: 'parasite', label: '寄生蟲', prefix: 'P' },
];
const GOOD_ROLES = ['病毒專家','細菌專家','寄生蟲專家','免疫學家','研發天才','基因定序師','疫苗開發員','收容指揮官','生物安全官','流行病學專家','跨域研究員','緊急應變員','病原體獵人'];
const EVIL_ROLES = ['變異工程師','黑市走私商','內部破壞者','假情報員','失控宿主'];

const state = {
  players: {},
  round: 0,
  phase: 'lobby',
  markets: [],
  deck: [],
  submissions: {},
  outbreak: 0,
  result: null,
  delayedEffects: [],
  revealAnnouncement: null,
  config: { evilCount: 5, samplesPerType: 25, decisionSeconds: 60 },
  decisionDeadline: null,
  timerHandle: null,
  notice: '等待主持人啟動收容協議。',
};

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildDeck() {
  return shuffle(SAMPLE_TYPES.flatMap((type) => Array.from({ length: state.config.samplesPerType }, (_, index) => ({
    id: crypto.randomUUID(), type: type.id, typeLabel: type.label,
    code: `${type.prefix}-${String(index + 1).padStart(2, '0')}`,
    risk: index + 1, baseRisk: index + 1,
  }))));
}

function ensureDeck(count) {
  while (state.deck.length < count) state.deck.push(...buildDeck());
}

function drawSamples(count) {
  ensureDeck(count);
  return Array.from({ length: count }, () => state.deck.pop());
}

function eliminationCandidates(samples, role) {
  const candidates = [];
  const sequenceLength = role === '基因定序師' ? 2 : 3;
  const crossTypeLength = role === '跨域研究員' ? 2 : 3;
  for (const type of SAMPLE_TYPES) {
    const cards = samples.filter((sample) => sample.type === type.id && !sample.locked);
    const byRisk = new Map(cards.map((sample) => [sample.risk, sample]));
    const risks = [...byRisk.keys()].sort((a, b) => a - b);
    for (let start = 0; start < risks.length; start += 1) {
      const run = [byRisk.get(risks[start])];
      for (let index = start + 1; index < risks.length && risks[index] === risks[index - 1] + 1; index += 1) {
        run.push(byRisk.get(risks[index]));
        if (run.length >= sequenceLength) candidates.push([...run]);
      }
    }
  }
  const risks = [...new Set(samples.map((sample) => sample.risk))];
  for (const risk of risks) {
    const matching = SAMPLE_TYPES.map((type) => samples.find((sample) => sample.type === type.id && sample.risk === risk && !sample.locked)).filter(Boolean);
    if (matching.length >= crossTypeLength) {
      if (crossTypeLength === 2) {
        for (let left = 0; left < matching.length; left += 1) for (let right = left + 1; right < matching.length; right += 1) candidates.push([matching[left], matching[right]]);
      } else candidates.push(matching);
    }
  }
  return candidates;
}

function bestElimination(samples, role) {
  const candidates = eliminationCandidates(samples, role);
  let best = { saved: 0, ids: new Set(), groups: [] };
  function search(index, used, saved, groups) {
    if (index === candidates.length) {
      if (saved > best.saved || (saved === best.saved && groups.length > best.groups.length)) best = { saved, ids: new Set(used), groups: [...groups] };
      return;
    }
    search(index + 1, used, saved, groups);
    const candidate = candidates[index];
    if (candidate.some((sample) => used.has(sample.id))) return;
    const next = new Set(used);
    candidate.forEach((sample) => next.add(sample.id));
    search(index + 1, next, saved + candidate.reduce((sum, sample) => sum + sample.risk, 0), [...groups, candidate]);
  }
  search(0, new Set(), 0, []);
  return best;
}

function calculateScore(player) {
  const totalRisk = player.samples.reduce((sum, sample) => sum + sample.risk, 0);
  return player.resources - totalRisk + bestElimination(player.samples, player.role).saved;
}

function publicSample(sample, marketIsActive = false) {
  if (marketIsActive && sample.hiddenType) {
    return { ...sample, type: 'unknown', typeLabel: '未知', code: 'CLASSIFIED' };
  }
  return { ...sample };
}

function playerView(player) {
  const eliminated = bestElimination(player.samples, player.role).ids;
  return {
    id: player.id,
    name: player.name,
    resources: player.resources,
    samples: player.samples.map((sample) => ({ ...sample, eliminated: eliminated.has(sample.id) })),
    sampleCount: player.samples.length,
    score: calculateScore(player),
    submitted: Boolean(state.submissions[player.id]),
    role: player.faction === 'evil' && !player.revealed ? '未知' : player.role,
    faction: player.revealed ? player.faction : 'unknown',
    reports: player.reports || 0,
  };
}

function publicState() {
  return {
    round: state.round,
    phase: state.phase,
    notice: state.notice,
    submissionCount: Object.keys(state.submissions).length,
    playerCount: Object.keys(state.players).length,
    outbreak: state.outbreak,
    decisionDeadline: state.decisionDeadline,
    decisionSeconds: state.config.decisionSeconds,
    revealAnnouncement: state.revealAnnouncement,
    result: state.result,
    players: Object.values(state.players).map(playerView).sort((a, b) => b.score - a.score || b.resources - a.resources || a.name.localeCompare(b.name, 'zh-Hant')),
    markets: state.markets.map((market) => ({
      id: market.id,
      sample: publicSample(market.sample, market.status === 'active'),
      pot: market.pot,
      status: market.status,
      winnerName: market.winnerId ? state.players[market.winnerId]?.name : null,
    })),
  };
}

function assignRoles() {
  const players = shuffle(Object.values(state.players));
  const evilCount = Math.min(state.config.evilCount, players.length);
  const evilRoles = shuffle(EVIL_ROLES);
  const goodRoles = shuffle(GOOD_ROLES);
  players.forEach((player, index) => {
    player.faction = index < evilCount ? 'evil' : 'good';
    // 每種陣營先完整發過一輪不重複身份，之後才從下一輪重新使用。
    player.role = index < evilCount
      ? evilRoles[index % evilRoles.length]
      : goodRoles[(index - evilCount) % goodRoles.length];
    player.reports = 0; player.revealed = false; player.reportUsedRound = 0; player.confirmed = false; player.skillUses = 0;
  });
}

function hostState() {
  return {
    ...publicState(),
    markets: state.markets.map((market) => ({
      id: market.id, sample: { ...market.sample }, pot: market.pot, status: market.status,
      winnerName: market.winnerId ? state.players[market.winnerId]?.name : null,
      smuggledBy: market.smuggledBy ? state.players[market.smuggledBy]?.name : null,
    })),
    players: Object.values(state.players).map((player) => ({ ...playerView(player), role: player.role, faction: player.faction, confirmed: player.confirmed, actions: state.submissions[player.id] || null })),
    delayedEffects: (state.delayedEffects || []).map((effect) => ({ ...effect, sourceName: state.players[effect.sourceId]?.name })),
  };
}
function identityView(playerId) {
  const player = state.players[playerId];
  if (!player) throw new Error('找不到玩家。');
  return { role: player.role, faction: player.faction, confirmed: player.confirmed, allies: player.faction === 'evil' ? Object.values(state.players).filter((item) => item.faction === 'evil' && item.id !== playerId).map((item) => item.name) : [] };
}

function previewView(playerId) {
  const player = state.players[playerId];
  if (!player) throw new Error('找不到玩家。');
  if (player.role !== '流行病學專家' || !player.nextPreview) return { preview: null };
  return { preview: { ...player.nextPreview } };
}

function broadcast() {
  const message = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const response of clients) response.write(message);
}

function clearDecisionTimer() {
  if (state.timerHandle) clearTimeout(state.timerHandle);
  state.timerHandle = null;
  state.decisionDeadline = null;
}

function scheduleDecisionTimer() {
  clearDecisionTimer();
  state.decisionDeadline = Date.now() + state.config.decisionSeconds * 1000;
  state.timerHandle = setTimeout(() => {
    try { forceMarketPass('時間到，未送出的決策已視為全部拒絕。'); broadcast(); } catch (_) {}
  }, state.config.decisionSeconds * 1000);
}

function startRound() {
  if (state.phase === 'active') throw new Error('本回合仍有尚未售出的樣本。');
  if (state.phase === 'final') throw new Error('本局已結算，請先重置後再開始。');
  if (Object.keys(state.players).length < 1) throw new Error('至少需要一位玩家才能開始。');
  if (state.phase === 'lobby') {
    assignRoles(); state.phase = 'identity'; state.notice = '身份已發放，等待所有玩家確認。'; return;
  }
  if (state.phase === 'identity') {
    if (Object.values(state.players).some((player) => !player.confirmed)) throw new Error('仍有玩家尚未確認身份。');
  }
  state.round += 1;
  const dueEffects = (state.delayedEffects || []).filter((effect) => effect.dueRound <= state.round);
  dueEffects.forEach((effect) => { state.outbreak += effect.amount; });
  state.delayedEffects = (state.delayedEffects || []).filter((effect) => effect.dueRound > state.round);
  Object.values(state.players).forEach((player) => { player.roundCollected = false; });
  state.phase = 'active';
  state.submissions = {};
  state.markets = drawSamples(5).map((sample, index) => ({
    id: index + 1, sample, pot: 0, status: 'active', winnerId: null,
  }));
  Object.values(state.players).filter((player) => player.role === '假情報員' && player.pendingHiddenSlot).forEach((player) => {
    const target = state.markets.find((market) => market.id === player.pendingHiddenSlot);
    if (target) target.sample.hiddenType = true;
    player.pendingHiddenSlot = null;
  });
  ensureDeck(5);
  const nextRoundPreview = state.deck[state.deck.length - 1];
  Object.values(state.players).forEach((player) => { player.nextPreview = player.role === '流行病學專家' ? { ...nextRoundPreview } : null; });
  state.notice = `第 ${state.round} 輪開市：請決定五個市場中想收容的樣本。${dueEffects.length ? ` ${dueEffects.length} 項延遲異常已計入失控指數。` : ''}`;
  scheduleDecisionTimer();
}

function confirmIdentity(playerId) {
  const player = state.players[playerId];
  if (!player || state.phase !== 'identity') throw new Error('目前沒有待確認的身份。');
  player.confirmed = true;
  state.notice = `已確認 ${Object.values(state.players).filter((item) => item.confirmed).length}／${Object.keys(state.players).length} 位玩家身份。`;
}

function selectWinner(candidateIds) {
  let finalists = candidateIds.filter((id) => state.players[id].samples.length === 0);
  if (!finalists.length) finalists = [...candidateIds];
  const highestResources = Math.max(...finalists.map((id) => state.players[id].resources + (state.players[id].role === '收容指揮官' ? 3 : 0)));
  finalists = finalists.filter((id) => state.players[id].resources + (state.players[id].role === '收容指揮官' ? 3 : 0) === highestResources);
  const fewestSamples = Math.min(...finalists.map((id) => state.players[id].samples.length));
  finalists = finalists.filter((id) => state.players[id].samples.length === fewestSamples);
  return shuffle(finalists)[0];
}

function resolveMarketPass() {
  clearDecisionTimer();
  const outcomes = [];
  const firstPass = state.markets.every((market) => market.pot === 0);
  for (const market of state.markets.filter((item) => item.status === 'active')) {
    const applicants = Object.entries(state.submissions)
      .filter(([, actions]) => actions[market.id] === 'accept')
      .map(([id]) => id);
    if (applicants.length) {
      const winnerId = selectWinner(applicants);
      const winner = state.players[winnerId];
      applyCollectionEffects(winner, market.sample);
      winner.samples.push(market.sample);
      if (winner.role === '疫苗開發員') {
        const elimination = bestElimination(winner.samples, winner.role);
        const completedGroups = elimination.groups.filter((group) => group.some((sample) => sample.id === market.sample.id)).length;
        if (completedGroups) winner.resources += completedGroups * 4;
      }
      winner.resources += market.pot;
      if (winner.role === '緊急應變員' && !winner.roundCollected) winner.resources += 2;
      winner.roundCollected = true;
      market.status = 'sold';
      market.winnerId = winnerId;
      outcomes.push(`${winner.name} 收容 ${market.sample.code}`);
      if (market.smuggledBy) {
        const delay = Math.floor(Math.random() * 3);
        if (delay === 0) state.outbreak += 1;
        else (state.delayedEffects ||= []).push({ sourceId: market.smuggledBy, amount: 1, dueRound: state.round + delay, description: '走私樣本流入造成的延遲失控' });
      }
    } else {
      Object.values(state.players).forEach((player) => { if (!(player.role === '生物安全官' && player.safetyUsedRound !== state.round)) { player.resources -= 1; } else player.safetyUsedRound = state.round; });
      market.pot += Object.keys(state.players).length;
      if (!market.outbreakCounted) { state.outbreak += 1; market.outbreakCounted = true; }
      outcomes.push(`${market.sample.code} 無人收容，拒絕池累積至 ${market.pot}`);
    }
  }
  state.submissions = {};
  if (state.markets.every((market) => market.status === 'sold')) {
    if (firstPass) state.outbreak = Math.max(0, state.outbreak - 2);
    const evilWins = state.markets.filter((market) => state.players[market.winnerId].faction === 'evil').length;
    if (evilWins >= 2) state.outbreak += 2;
    state.phase = 'between';
    state.notice = `第 ${state.round} 輪結束：${outcomes.join('；')}。`;
  } else {
    state.notice = `仍有樣本未售出：${outcomes.join('；')}。請重新決策。`;
    scheduleDecisionTimer();
  }
}

function forceMarketPass(reason = '主持人已結算本次決策。') {
  if (state.phase !== 'active') throw new Error('目前沒有需要結算的市場決策。');
  const activeMarkets = state.markets.filter((market) => market.status === 'active');
  Object.values(state.players).forEach((player) => {
    if (state.submissions[player.id]) return;
    state.submissions[player.id] = Object.fromEntries(activeMarkets.map((market) => [market.id, 'decline']));
    if (player.faction === 'good') player.reportUsedRound = state.round;
  });
  resolveMarketPass();
  state.notice = `${reason} ${state.notice}`;
}

function applyCollectionEffects(player, sample) {
  // 收容時固定危險係數；被變異或破壞的樣本不能再減傷。
  if (sample.noReduction) return;
  let reduction = 0;
  if ((player.role === '病毒專家' && sample.type === 'virus') || (player.role === '細菌專家' && sample.type === 'bacteria') || (player.role === '寄生蟲專家' && sample.type === 'parasite')) reduction += 4;
  if (player.role === '免疫學家') reduction += 2;
  if (player.role === '病原體獵人' && sample.risk >= 15) reduction += 4;
  if (player.role === '研發天才' && Math.random() < 0.15) { sample.risk = 0; sample.reductionNote = '研發天才：風險歸零'; return; }
  if (reduction) { sample.risk = Math.max(0, sample.risk - reduction); sample.reductionNote = `角色減傷 −${reduction}`; }
}

function reportPlayer(reporterId, targetId) {
  const reporter = state.players[reporterId], target = state.players[targetId];
  if (!reporter || !target) throw new Error('找不到實驗室。');
  if (state.round < 2 || reporter.faction !== 'good') throw new Error('目前無法使用舉報。');
  if (reporter.reportUsedRound === state.round) throw new Error('每回合只能舉報一次。');
  if (target.revealed) throw new Error('該玩家已公開陣營。');
  reporter.reportUsedRound = state.round; target.reports += 1;
  if (target.reports >= 9) {
    target.revealed = true;
    const change = target.faction === 'evil' ? -2 : 2;
    state.outbreak += change;
    state.revealAnnouncement = `舉報門檻達成：${target.name} 已公開為${target.faction === 'evil' ? '反收容派' : '收容協議研究員'}（${target.role}）；失控指數 ${change > 0 ? '+' : ''}${change}。`;
    state.notice = state.revealAnnouncement;
  }
}

function submitActions(playerId, actions) {
  if (state.phase !== 'active') throw new Error('目前沒有進行中的市場。');
  if (!state.players[playerId]) throw new Error('找不到玩家，請重新加入。');
  if (state.submissions[playerId]) throw new Error('你已提交本輪決策。');
  const activeMarkets = state.markets.filter((market) => market.status === 'active');
  if (!actions || typeof actions !== 'object' || activeMarkets.some((market) => !['accept', 'decline'].includes(actions[market.id]))) {
    throw new Error('請為每一個尚未售出的市場作出決定。');
  }
  state.submissions[playerId] = actions;
  if (Object.keys(state.submissions).length === Object.keys(state.players).length) resolveMarketPass();
  else state.notice = `已收到 ${Object.keys(state.submissions).length}／${Object.keys(state.players).length} 位實驗室的加密決策。`;
}

function useSkill(playerId, marketId) {
  const player = state.players[playerId];
  if (!player) throw new Error('找不到你的實驗室，請重新登入。');
  if (player.faction !== 'evil') throw new Error('只有反收容派可使用隱密行動。');
  if (player.role === '假情報員' && state.phase === 'between') {
    const slot = Number(marketId);
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) throw new Error('請選擇下回合的 A～E 市場。');
    player.skillUses = player.skillUses || 0;
    if (player.skillUses >= 3) throw new Error('技能次數已用完。');
    player.pendingHiddenSlot = slot;
    player.skillUses += 1;
    state.notice = '市場偵測到異常操作。';
    return;
  }
  if (state.phase !== 'active') throw new Error('技能只能在市場開放期間使用。');
  const market = state.markets.find((item) => item.id === Number(marketId) && item.status === 'active');
  if (!market) throw new Error('這個市場已結算，請選擇仍在開放中的市場。');
  player.skillUses = player.skillUses || 0;
  const limits = { '變異工程師': 3, '黑市走私商': 3, '內部破壞者': 1, '假情報員': 3, '失控宿主': 2 };
  if (player.skillUses >= limits[player.role]) throw new Error('技能次數已用完。');
  if (player.role === '變異工程師') { market.sample.risk += 4; market.sample.baseRisk += 4; market.sample.noReduction = true; market.sample.reductionNote = '變異：禁止減傷'; }
  if (player.role === '黑市走私商') market.smuggledBy = playerId;
  if (player.role === '內部破壞者') state.markets.filter((item) => item.status === 'active').forEach((item) => { item.sample.noReduction = true; });
  if (player.role === '假情報員') throw new Error('假情報員請在本回合結束後，預先偽造下回合的市場資訊。');
  if (player.role === '失控宿主') market.sample.locked = true;
  player.skillUses += 1;
  state.notice = '市場偵測到異常操作。';
}

function resetGame() {
  clearDecisionTimer();
  Object.values(state.players).forEach((player) => { player.resources = 8; player.samples = []; player.role = null; player.faction = 'good'; player.reports = 0; player.revealed = false; player.confirmed = false; player.skillUses = 0; player.pendingHiddenSlot = null; });
  state.round = 0; state.phase = 'lobby'; state.markets = []; state.deck = []; state.submissions = {}; state.outbreak = 0; state.result = null; state.delayedEffects = [];
  state.revealAnnouncement = null;
  state.notice = '收容協議已重置，等待主持人啟動。';
}

function configureGame(evilCount, samplesPerType, decisionSeconds = state.config.decisionSeconds) {
  if (state.phase !== 'lobby') throw new Error('只能在身份發放前設定壞人人數。');
  const count = Number(evilCount);
  const playerCount = Object.keys(state.players).length;
  if (!Number.isInteger(count) || count < 0 || count > playerCount) throw new Error(`壞人人數必須是 0 到 ${playerCount} 的整數。`);
  const sampleCount = Number(samplesPerType);
  if (!Number.isInteger(sampleCount) || sampleCount < 3 || sampleCount > 99) throw new Error('每種樣本數量必須是 3 到 99 的整數。');
  const seconds = Number(decisionSeconds);
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 600) throw new Error('每次決策秒數必須是 10 到 600 的整數。');
  state.config.evilCount = count;
  state.config.samplesPerType = sampleCount;
  state.config.decisionSeconds = seconds;
  state.notice = `本場將分配 ${count} 名反收容派；病毒、細菌、寄生蟲各 ${sampleCount} 張；每次決策 ${seconds} 秒。等待主持人發放身份。`;
}

function removePlayer(playerId) {
  if (!['lobby', 'identity'].includes(state.phase)) throw new Error('市場已開啟，為避免結算錯誤，本回合不能移除玩家。');
  const player = state.players[playerId];
  if (!player) throw new Error('這位玩家已不存在。');
  delete state.players[playerId];
  if (state.phase === 'identity') {
    const confirmed = Object.values(state.players).filter((item) => item.confirmed).length;
    state.notice = `已移除 ${player.name}。已確認 ${confirmed}／${Object.keys(state.players).length} 位玩家身份。`;
  } else {
    state.notice = `已移除 ${player.name}。目前有 ${Object.keys(state.players).length} 位玩家等待加入。`;
  }
}

function finalizeGame() {
  if (state.phase === 'active') throw new Error('請先完成目前所有市場。');
  if (state.phase === 'lobby' || state.phase === 'identity') throw new Error('遊戲尚未開始。');
  const highRisk = Object.values(state.players).reduce((sum, player) => sum + player.samples.filter((sample) => !bestElimination(player.samples, player.role).ids.has(sample.id) && sample.risk >= 15).length, 0);
  state.outbreak += highRisk;
  const winningFaction = state.outbreak >= 10 ? 'evil' : 'good';
  const scores = Object.values(state.players).map((player) => {
    let bonus = 0;
    if (player.faction === 'good' && winningFaction === 'good') bonus = 10;
    if (player.faction === 'evil' && winningFaction === 'evil') bonus = player.reports < 3 ? 50 : player.reports < 9 ? 15 : 10;
    return { id: player.id, name: player.name, faction: player.faction, role: player.role, base: calculateScore(player), bonus, total: calculateScore(player) + bonus };
  }).sort((a,b) => b.total - a.total);
  state.result = { winningFaction, highRisk, scores };
  state.phase = 'final'; state.notice = winningFaction === 'evil' ? `失控指數 ${state.outbreak}：反收容派勝利。` : `失控指數 ${state.outbreak}：收容協議成功。`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; if (body.length > 100000) reject(new Error('資料過大')); });
    request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('資料格式錯誤')); } });
  });
}
function json(response, status, payload) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(payload)); }
function requireHost(request) { if (HOST_KEY && request.headers['x-host-key'] !== HOST_KEY) throw new Error('主持人密鑰不正確。'); }

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      response.write(`data: ${JSON.stringify(publicState())}\n\n`);
      clients.add(response); request.on('close', () => clients.delete(response)); return;
    }
    if (url.pathname === '/api/state') return json(response, 200, publicState());
    if (url.pathname === '/api/host/state') { requireHost(request); return json(response, 200, hostState()); }
    if (request.method === 'POST' && url.pathname === '/api/identity') { const { playerId } = await readBody(request); return json(response, 200, identityView(playerId)); }
    if (request.method === 'POST' && url.pathname === '/api/preview') { const { playerId } = await readBody(request); return json(response, 200, previewView(playerId)); }
    if (request.method === 'POST' && url.pathname === '/api/join') {
      if (state.phase !== 'lobby') throw new Error('遊戲已開始，請等待下一場收容協議。');
      const { name } = await readBody(request); const clean = String(name || '').trim().slice(0, 16);
      if (!clean) throw new Error('請輸入玩家名稱。');
      const id = crypto.randomUUID(); state.players[id] = { id, name: clean, resources: 8, samples: [] };
      broadcast(); return json(response, 201, { id });
    }
    if (request.method === 'POST' && url.pathname === '/api/submit') {
      const { playerId, actions } = await readBody(request); submitActions(playerId, actions); broadcast(); return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/confirm') {
      const { playerId } = await readBody(request); confirmIdentity(playerId); broadcast(); return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/report') {
      const { playerId, targetId } = await readBody(request); reportPlayer(playerId, targetId); broadcast(); return json(response, 200, publicState());
    }
    if (request.method === 'POST' && url.pathname === '/api/skill') { const { playerId, marketId } = await readBody(request); useSkill(playerId, marketId); broadcast(); return json(response, 200, publicState()); }
    if (request.method === 'POST' && url.pathname === '/api/host/start') { requireHost(request); startRound(); broadcast(); return json(response, 200, publicState()); }
    if (request.method === 'POST' && url.pathname === '/api/host/config') { requireHost(request); const { evilCount, samplesPerType, decisionSeconds } = await readBody(request); configureGame(evilCount, samplesPerType, decisionSeconds); broadcast(); return json(response, 200, publicState()); }
    if (request.method === 'POST' && url.pathname === '/api/host/force-resolve') { requireHost(request); forceMarketPass(); broadcast(); return json(response, 200, publicState()); }
    if (request.method === 'POST' && url.pathname === '/api/host/remove-player') { requireHost(request); const { playerId } = await readBody(request); removePlayer(playerId); broadcast(); return json(response, 200, publicState()); }
    if (request.method === 'POST' && url.pathname === '/api/host/end') { requireHost(request); if (state.phase === 'active') throw new Error('市場尚未全部售出。'); return json(response, 200, publicState()); }
    if (request.method === 'POST' && url.pathname === '/api/host/reset') { requireHost(request); resetGame(); broadcast(); return json(response, 200, publicState()); }
    if (request.method === 'POST' && url.pathname === '/api/host/finalize') { requireHost(request); finalizeGame(); broadcast(); return json(response, 200, publicState()); }
    const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC, filename));
    if (!file.startsWith(PUBLIC)) return json(response, 403, { error: '禁止存取' });
    let data = fs.readFileSync(file);
    if (filename === 'player.html') data = Buffer.from(data.toString().replace('</body>', '<script src="/identity.js"></script><script src="/report.js"></script><script src="/skills.js"></script><script src="/preview.js"></script></body>'));
    if (filename === 'host.html') data = Buffer.from(data.toString().replace('</body>', '<script src="/host-monitor.js"></script></body>'));
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); response.end(data);
  } catch (error) { json(response, 400, { error: error.message || '伺服器錯誤' }); }
});

if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`P.A.N.D.E.M.I.C. running on http://localhost:${PORT}`));
module.exports = { state, calculateScore, startRound, submitActions, resetGame, bestElimination, confirmIdentity, finalizeGame, configureGame, useSkill, removePlayer, previewView, forceMarketPass };
