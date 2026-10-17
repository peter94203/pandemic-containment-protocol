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

const state = {
  players: {},
  round: 0,
  phase: 'lobby',
  markets: [],
  deck: [],
  submissions: {},
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
  return shuffle(SAMPLE_TYPES.flatMap((type) => Array.from({ length: 25 }, (_, index) => ({
    id: crypto.randomUUID(), type: type.id, typeLabel: type.label,
    code: `${type.prefix}-${String(index + 1).padStart(2, '0')}`,
    risk: index + 1,
  }))));
}

function drawSamples(count) {
  if (state.deck.length < count) state.deck.push(...buildDeck());
  return Array.from({ length: count }, () => state.deck.pop());
}

function eliminationCandidates(samples) {
  const candidates = [];
  for (const type of SAMPLE_TYPES) {
    const cards = samples.filter((sample) => sample.type === type.id);
    const byRisk = new Map(cards.map((sample) => [sample.risk, sample]));
    for (let start = 1; start <= 23; start += 1) {
      const run = [];
      for (let risk = start; risk <= 25 && byRisk.has(risk); risk += 1) {
        run.push(byRisk.get(risk));
        if (run.length >= 3) candidates.push([...run]);
      }
    }
  }
  for (let risk = 1; risk <= 25; risk += 1) {
    const trio = SAMPLE_TYPES.map((type) => samples.find((sample) => sample.type === type.id && sample.risk === risk));
    if (trio.every(Boolean)) candidates.push(trio);
  }
  return candidates;
}

function bestElimination(samples) {
  const candidates = eliminationCandidates(samples);
  let best = { saved: 0, ids: new Set() };
  function search(index, used, saved) {
    if (index === candidates.length) {
      if (saved > best.saved) best = { saved, ids: new Set(used) };
      return;
    }
    search(index + 1, used, saved);
    const candidate = candidates[index];
    if (candidate.some((sample) => used.has(sample.id))) return;
    const next = new Set(used);
    candidate.forEach((sample) => next.add(sample.id));
    search(index + 1, next, saved + candidate.reduce((sum, sample) => sum + sample.risk, 0));
  }
  search(0, new Set(), 0);
  return best;
}

function calculateScore(player) {
  const totalRisk = player.samples.reduce((sum, sample) => sum + sample.risk, 0);
  return player.resources - totalRisk + bestElimination(player.samples).saved;
}

function playerView(player) {
  const eliminated = bestElimination(player.samples).ids;
  return {
    id: player.id,
    name: player.name,
    resources: player.resources,
    samples: player.samples.map((sample) => ({ ...sample, eliminated: eliminated.has(sample.id) })),
    sampleCount: player.samples.length,
    score: calculateScore(player),
    submitted: Boolean(state.submissions[player.id]),
  };
}

function publicState() {
  return {
    round: state.round,
    phase: state.phase,
    notice: state.notice,
    submissionCount: Object.keys(state.submissions).length,
    playerCount: Object.keys(state.players).length,
    players: Object.values(state.players).map(playerView).sort((a, b) => b.score - a.score || b.resources - a.resources || a.name.localeCompare(b.name, 'zh-Hant')),
    markets: state.markets.map((market) => ({
      id: market.id,
      sample: market.sample,
      pot: market.pot,
      status: market.status,
      winnerName: market.winnerId ? state.players[market.winnerId]?.name : null,
    })),
  };
}

function broadcast() {
  const message = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const response of clients) response.write(message);
}

function startRound() {
  if (state.phase === 'active') throw new Error('本回合仍有尚未售出的樣本。');
  if (Object.keys(state.players).length < 2) throw new Error('至少需要兩位玩家才能開始。');
  state.round += 1;
  state.phase = 'active';
  state.submissions = {};
  state.markets = drawSamples(5).map((sample, index) => ({
    id: index + 1, sample, pot: 0, status: 'active', winnerId: null,
  }));
  state.notice = `第 ${state.round} 輪開市：請決定五個市場中想收容的樣本。`;
}

function selectWinner(candidateIds) {
  let finalists = candidateIds.filter((id) => state.players[id].samples.length === 0);
  if (!finalists.length) finalists = [...candidateIds];
  const highestResources = Math.max(...finalists.map((id) => state.players[id].resources));
  finalists = finalists.filter((id) => state.players[id].resources === highestResources);
  const fewestSamples = Math.min(...finalists.map((id) => state.players[id].samples.length));
  finalists = finalists.filter((id) => state.players[id].samples.length === fewestSamples);
  return shuffle(finalists)[0];
}

function resolveMarketPass() {
  const outcomes = [];
  for (const market of state.markets.filter((item) => item.status === 'active')) {
    const applicants = Object.entries(state.submissions)
      .filter(([, actions]) => actions[market.id] === 'accept')
      .map(([id]) => id);
    if (applicants.length) {
      const winnerId = selectWinner(applicants);
      const winner = state.players[winnerId];
      winner.samples.push(market.sample);
      winner.resources += market.pot;
      market.status = 'sold';
      market.winnerId = winnerId;
      outcomes.push(`${winner.name} 收容 ${market.sample.code}`);
    } else {
      Object.values(state.players).forEach((player) => { player.resources -= 1; });
      market.pot += Object.keys(state.players).length;
      outcomes.push(`${market.sample.code} 無人收容，拒絕池累積至 ${market.pot}`);
    }
  }
  state.submissions = {};
  if (state.markets.every((market) => market.status === 'sold')) {
    state.phase = 'between';
    state.notice = `第 ${state.round} 輪結束：${outcomes.join('；')}。`;
  } else {
    state.notice = `仍有樣本未售出：${outcomes.join('；')}。請重新決策。`;
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

function resetGame() {
  Object.values(state.players).forEach((player) => { player.resources = 8; player.samples = []; });
  state.round = 0; state.phase = 'lobby'; state.markets = []; state.deck = []; state.submissions = {};
  state.notice = '收容協議已重置，等待主持人啟動。';
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
    if (request.method === 'POST' && url.pathname === '/api/host/start') { requireHost(request); startRound(); broadcast(); return json(response, 200, publicState()); }
    if (request.method === 'POST' && url.pathname === '/api/host/end') { requireHost(request); if (state.phase === 'active') throw new Error('市場尚未全部售出。'); return json(response, 200, publicState()); }
    if (request.method === 'POST' && url.pathname === '/api/host/reset') { requireHost(request); resetGame(); broadcast(); return json(response, 200, publicState()); }
    const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC, filename));
    if (!file.startsWith(PUBLIC)) return json(response, 403, { error: '禁止存取' });
    const data = fs.readFileSync(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); response.end(data);
  } catch (error) { json(response, 400, { error: error.message || '伺服器錯誤' }); }
});

if (require.main === module) server.listen(PORT, '0.0.0.0', () => console.log(`P.A.N.D.E.M.I.C. running on http://localhost:${PORT}`));
module.exports = { state, calculateScore, startRound, submitActions, resetGame, bestElimination };
