const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST_KEY = process.env.HOST_KEY || '';
const PUBLIC = path.join(__dirname, 'public');
const clients = new Set();

const state = {
  players: {},
  round: 0,
  phase: 'lobby',
  markets: [],
  notice: '等待主持人啟動收容協議。',
};

function publicState() {
  const players = Object.values(state.players)
    .map((p) => ({
      id: p.id, name: p.name, resources: p.resources, samples: p.samples,
      score: calculateScore(p), market: p.market,
    }))
    .sort((a, b) => b.score - a.score || b.resources - a.resources || a.name.localeCompare(b.name, 'zh-Hant'));
  return {
    round: state.round, phase: state.phase, notice: state.notice,
    players,
    markets: state.markets.map((m) => ({
      id: m.id, sample: m.sample, pot: m.pot, status: m.status,
      queue: m.queue.map((id) => state.players[id] ? state.players[id].name : '未知'),
      currentPlayerId: m.queue[m.index] || null,
      currentPlayerName: state.players[m.queue[m.index]]?.name || null,
      decisions: m.decisions,
    })),
  };
}

function calculateScore(player) {
  const risks = player.samples.map((s) => s.risk).sort((a, b) => a - b);
  let totalRisk = 0;
  for (let i = 0; i < risks.length;) {
    totalRisk += risks[i];
    let j = i + 1;
    while (j < risks.length && risks[j] === risks[j - 1] + 1) j += 1;
    i = j;
  }
  return player.resources - totalRisk;
}

function sampleCard(risk) {
  const families = ['VX', 'NOVA', 'KRYO', 'MORBUS', 'HELIX'];
  return { id: crypto.randomUUID(), code: `${families[Math.floor(Math.random() * families.length)]}-${String(risk).padStart(2, '0')}`, risk };
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function broadcast() {
  const payload = `data: ${JSON.stringify(publicState())}\n\n`;
  for (const res of clients) res.write(payload);
}

function startRound() {
  const playerIds = shuffle(Object.keys(state.players));
  if (playerIds.length < 2) throw new Error('至少需要兩位玩家才能開始。');
  const marketCount = Math.min(5, Math.ceil(playerIds.length / 4));
  const groups = Array.from({ length: marketCount }, () => []);
  playerIds.forEach((id, index) => groups[index % marketCount].push(id));
  const risks = shuffle(Array.from({ length: 33 }, (_, i) => i + 3)).slice(0, marketCount);
  state.round += 1;
  state.phase = 'active';
  state.notice = `第 ${state.round} 輪收容作業進行中。五個市場同步處理。`;
  state.markets = groups.map((queue, index) => ({
    id: index + 1, sample: sampleCard(risks[index]), queue, index: 0, pot: 0,
    status: 'active', decisions: [],
  }));
  Object.values(state.players).forEach((p) => { p.market = null; });
  state.markets.forEach((m) => m.queue.forEach((id) => { state.players[id].market = m.id; }));
}

function resolveMarket(market, winnerId, automatic = false) {
  const winner = state.players[winnerId];
  winner.samples.push(market.sample);
  winner.resources += market.pot;
  market.status = 'resolved';
  market.winnerId = winnerId;
  market.decisions.push({ playerId: winnerId, action: automatic ? 'forced' : 'accept' });
  state.notice = `${winner.name} 收容了 ${market.sample.code}，獲得 ${market.pot} 點隔離資源。`;
}

function decide(playerId, action) {
  const player = state.players[playerId];
  if (!player) throw new Error('找不到玩家。請重新加入。');
  const market = state.markets.find((m) => m.id === player.market && m.status === 'active');
  if (!market || market.queue[market.index] !== playerId) throw new Error('現在還不是你的決策時間。');
  if (!['accept', 'decline'].includes(action)) throw new Error('無效操作。');
  if (action === 'accept') {
    resolveMarket(market, playerId);
    return;
  }
  if (player.resources < 1) throw new Error('隔離資源不足，必須收容樣本。');
  player.resources -= 1;
  market.pot += 1;
  market.decisions.push({ playerId, action: 'decline' });
  market.index += 1;
  if (market.index >= market.queue.length - 1) resolveMarket(market, market.queue[market.index], true);
}

function endRound() {
  if (state.phase !== 'active') throw new Error('目前沒有進行中的回合。');
  if (state.markets.some((m) => m.status === 'active')) throw new Error('仍有市場尚未結算。');
  Object.values(state.players).forEach((p) => { p.market = null; });
  state.phase = 'between';
  state.notice = `第 ${state.round} 輪結算完成。請查看全場風險排名。`;
}

function resetGame() {
  Object.values(state.players).forEach((p) => { p.resources = 8; p.samples = []; p.market = null; });
  state.round = 0; state.phase = 'lobby'; state.markets = []; state.notice = '收容協議已重置，等待主持人啟動。';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 100000) reject(new Error('資料過大')); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('資料格式錯誤')); } });
  });
}
function json(res, status, payload) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); }
function requireHost(req) {
  if (HOST_KEY && req.headers['x-host-key'] !== HOST_KEY) throw new Error('主持人密鑰不正確。');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    if (url.pathname === '/api/state') return json(res, 200, publicState());
    if (req.method === 'POST' && url.pathname === '/api/join') {
      const { name } = await readBody(req); const clean = String(name || '').trim().slice(0, 16);
      if (!clean) throw new Error('請輸入玩家名稱。');
      const id = crypto.randomUUID(); state.players[id] = { id, name: clean, resources: 8, samples: [], market: null };
      broadcast(); return json(res, 201, { id });
    }
    if (req.method === 'POST' && url.pathname === '/api/decision') {
      const { playerId, action } = await readBody(req); decide(playerId, action); broadcast(); return json(res, 200, publicState());
    }
    if (req.method === 'POST' && url.pathname === '/api/host/start') { requireHost(req); startRound(); broadcast(); return json(res, 200, publicState()); }
    if (req.method === 'POST' && url.pathname === '/api/host/end') { requireHost(req); endRound(); broadcast(); return json(res, 200, publicState()); }
    if (req.method === 'POST' && url.pathname === '/api/host/reset') { requireHost(req); resetGame(); broadcast(); return json(res, 200, publicState()); }
    const filename = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.normalize(path.join(PUBLIC, filename));
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: '禁止存取' });
    const data = fs.readFileSync(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  } catch (error) { json(res, 400, { error: error.message || '伺服器錯誤' }); }
});
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`P.A.N.D.E.M.I.C. running on http://localhost:${PORT}`));
}

module.exports = { state, calculateScore, startRound, decide, endRound, resetGame };
