// Ligue de golf — tout fonctionne dans le navigateur.
// Les données sont gardées dans le navigateur (localStorage) et peuvent être
// exportées / importées en JSON. Au premier chargement, on lit data/ligue.json.

const STORAGE_KEY = 'ligue-golf';
const EDITOR_KEY = 'ligue-golf-editeur';
// Empreinte SHA-256 du mot de passe par défaut (« golf2026 »). Se change dans Réglages.
const DEFAULT_EDIT_HASH = 'c3d202d707368179b25dd25eead59c9dd6f45f55e65347c0e23485dfba34e403';
const DEFAULT_SETTINGS = { participation: 1, parAdversaire: 1, bonusVictoire: 2 };
const STAT_FIELDS = [
  { key: 'putts', label: 'Putts' },
  { key: 'fairways', label: 'Allées atteintes' },
  { key: 'greens', label: 'Verts en régulation' },
  { key: 'birdies', label: 'Oiselets (ou mieux)' },
  { key: 'drive', label: 'Plus long coup de départ (vg)' },
];

let db = null;
let currentTab = 'classement';
let tabState = {}; // filtres, joueur sélectionné, partie en édition
let editor = false; // false = lecture seule

// ---------- Accès ----------
// Lecture seule par défaut : on lit toujours data/ligue.json du site.
// Le mode édition se débloque avec un mot de passe. Ce n'est pas une vraie sécurité
// (le code est public) : ça empêche surtout les modifications par erreur.

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const editHash = () => db.settings.editHash || DEFAULT_EDIT_HASH;

async function login() {
  const pw = prompt('Mot de passe pour modifier :');
  if (!pw) return;
  if (await sha256(pw) !== editHash()) { alert('Mot de passe incorrect.'); return; }
  editor = true;
  try { localStorage.setItem(EDITOR_KEY, '1'); } catch (e) { /* ignore */ }
  await load();
  render();
}

async function logout() {
  editor = false;
  try { localStorage.removeItem(EDITOR_KEY); } catch (e) { /* ignore */ }
  tabState.editing = null;
  db = await fetchSiteData();
  render();
}

// ---------- Données ----------

function emptyDb() {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, players: [], courses: [], games: [] };
}

function normalize(d) {
  const base = emptyDb();
  const out = { ...base, ...d };
  out.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  return out;
}

async function load() {
  if (!editor) { db = await fetchSiteData(); return; }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { db = normalize(JSON.parse(raw)); return; }
  } catch (e) { /* stockage indisponible */ }
  db = await fetchSiteData();
}

async function fetchSiteData() {
  try {
    const res = await fetch('data/ligue.json', { cache: 'no-store' });
    if (res.ok) return normalize(await res.json());
  } catch (e) { /* fichier absent (ouvert en local) */ }
  return emptyDb();
}

function save() {
  if (!editor) return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
}

const uid = () => Math.random().toString(36).slice(2, 10);
const byId = (list, id) => list.find(x => x.id === id);
const playerName = id => byId(db.players, id)?.name ?? '(joueur supprimé)';
const courseName = id => byId(db.courses, id)?.name ?? '(terrain supprimé)';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmtNum = (n, d = 1) => (n == null || isNaN(n) ? '—' : Number(n).toFixed(d).replace(/\.0+$/, '').replace('.', ','));
const fmtPar = n => (n == null || isNaN(n) ? '—' : n === 0 ? 'N' : (n > 0 ? '+' : '') + fmtNum(n));
const fmtDate = s => new Date(s + 'T12:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });

// ---------- Pointage ----------
// Chaque partie = une liste d'équipes. En « chacun pour soi », chaque équipe a 1 joueur.
// Pour chaque joueur :
//   participation
// + parAdversaire × (nombre de joueurs adverses battus ; égalité = la moitié)
// + bonusVictoire si son équipe termine 1re (partagé en cas d'égalité)
// Ainsi, battre 3 adversaires seul rapporte autant que gagner en équipe contre 3 joueurs,
// et une victoire contre un gros groupe vaut plus qu'un duel.

function scoreGame(game, settings = db.settings) {
  const teams = game.teams.filter(t => t.players.length && t.score !== '' && t.score != null && !isNaN(t.score));
  const best = Math.min(...teams.map(t => +t.score));
  const nbWinners = teams.filter(t => +t.score === best).length;
  const result = {}; // playerId -> { points, rank, beaten, won, teamIdx }
  teams.forEach((t) => {
    let beaten = 0;
    let rank = 1;
    teams.forEach(u => {
      if (u === t) return;
      if (+u.score > +t.score) beaten += u.players.length;
      else if (+u.score === +t.score) beaten += u.players.length / 2;
      if (+u.score < +t.score) rank += 1;
    });
    const won = +t.score === best && teams.length > 1;
    const pts = settings.participation + settings.parAdversaire * beaten + (won ? settings.bonusVictoire / nbWinners : 0);
    t.players.forEach(pid => {
      result[pid] = { points: pts, rank, beaten, won, soloWin: won && nbWinners === 1, team: t };
    });
  });
  return result;
}

// ---------- Statistiques ----------

function filteredGames() {
  const season = tabState.season || 'all';
  return db.games
    .filter(g => season === 'all' || g.date.slice(0, 4) === season)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function seasons() {
  return [...new Set(db.games.map(g => g.date.slice(0, 4)))].sort().reverse();
}

function playerStats(pid, games) {
  const s = {
    games: 0, points: 0, wins: 0,
    solo: { games: 0, wins: 0, vsPar: [], best: null },
    team: { games: 0, wins: 0, losses: 0, partners: {}, best: null },
    stat: {}, statN: {}, holes: 0, greensHoles: 0,
  };
  for (const g of games) {
    const res = scoreGame(g)[pid];
    if (!res) continue;
    s.games += 1;
    s.points += res.points;
    if (res.won) s.wins += 1;
    const vsPar = +res.team.score - (+g.par || 0);
    if (g.format === 'individuel') {
      s.solo.games += 1;
      if (res.won) s.solo.wins += 1;
      s.solo.vsPar.push(vsPar);
      if (s.solo.best == null || vsPar < s.solo.best.vsPar) s.solo.best = { vsPar, score: +res.team.score, game: g };
    } else {
      s.team.games += 1;
      if (res.won) s.team.wins += 1; else s.team.losses += 1;
      if (s.team.best == null || vsPar < s.team.best.vsPar) s.team.best = { vsPar, score: +res.team.score, game: g };
      res.team.players.filter(p => p !== pid).forEach(p => {
        const ps = (s.team.partners[p] ||= { games: 0, wins: 0 });
        ps.games += 1; if (res.won) ps.wins += 1;
      });
    }
    const st = (g.stats || {})[pid] || {};
    for (const f of STAT_FIELDS) {
      if (st[f.key] !== '' && st[f.key] != null && !isNaN(st[f.key])) {
        s.stat[f.key] = f.key === 'drive' ? Math.max(s.stat[f.key] || 0, +st[f.key]) : (s.stat[f.key] || 0) + +st[f.key];
        s.statN[f.key] = (s.statN[f.key] || 0) + 1;
        if (f.key === 'greens') s.greensHoles += +g.holes || 18;
      }
    }
  }
  s.avgVsPar = s.solo.vsPar.length ? s.solo.vsPar.reduce((a, b) => a + b, 0) / s.solo.vsPar.length : null;
  return s;
}

function standings(games) {
  return db.players
    .map(p => ({ p, s: playerStats(p.id, games) }))
    .filter(r => r.s.games > 0)
    .sort((a, b) => b.s.points - a.s.points || b.s.wins - a.s.wins || (a.s.avgVsPar ?? 99) - (b.s.avgVsPar ?? 99));
}

// ---------- Rendu ----------

const view = () => document.getElementById('view');

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === currentTab));
  const fn = { classement: renderStandings, parties: renderGames, joueurs: renderPlayers, terrains: renderCourses, reglages: renderSettings }[currentTab];
  document.body.classList.toggle('editeur', editor);
  const acc = document.getElementById('access');
  acc.textContent = editor ? '🔓 Mode édition' : '🔒 Lecture seule';
  acc.title = editor ? 'Toucher pour revenir en lecture seule' : 'Toucher pour entrer le mot de passe';
  view().innerHTML = fn();
  bind();
}

function seasonSelect() {
  const opts = seasons().map(y => `<option value="${y}" ${tabState.season === y ? 'selected' : ''}>Saison ${y}</option>`).join('');
  return `<select data-action="season" style="width:auto"><option value="all">Toutes les saisons</option>${opts}</select>`;
}

function renderStandings() {
  const games = filteredGames();
  const rows = standings(games);
  if (!rows.length) {
    return `<div class="card empty">Aucune partie pour l'instant.<br><br><button class="primary edit-only" data-action="new-game">+ Ajouter une partie</button></div>`;
  }
  const best = b => (b ? `<span title="${esc(b.score)} — ${esc(fmtDate(b.game.date))}, ${esc(courseName(b.game.courseId))}">${fmtPar(b.vsPar)}</span>` : '—');
  const body = rows.map((r, i) => `
    <tr class="${i === 0 ? 'rank1' : ''}" data-action="open-player" data-id="${r.p.id}" style="cursor:pointer">
      <td>${i + 1}</td>
      <td><b>${esc(r.p.name)}</b></td>
      <td class="num"><b>${fmtNum(r.s.points)}</b></td>
      <td class="num">${r.s.games}</td>
      <td class="num">${r.s.wins}</td>
      <td class="num">${fmtNum(r.s.points / r.s.games, 2)}</td>
      <td class="num">${fmtPar(r.s.avgVsPar)}</td>
      <td class="num grp">${r.s.solo.games}</td>
      <td class="num">${r.s.solo.wins}</td>
      <td class="num">${best(r.s.solo.best)}</td>
      <td class="num grp">${r.s.team.games}</td>
      <td class="num">${r.s.team.wins}</td>
      <td class="num">${best(r.s.team.best)}</td>
    </tr>`).join('');
  const last = games[0];
  return `
    <div class="row between"><h2>Classement</h2>${seasonSelect()}</div>
    <div class="card scroll">
      <table class="standings">
        <thead>
          <tr class="groups"><th colspan="7"></th><th colspan="3" class="grp">Solo</th><th colspan="3" class="grp">Équipe</th></tr>
          <tr><th>#</th><th>Joueur</th><th class="num">Pts</th><th class="num">PJ</th><th class="num">V</th><th class="num">Pts/PJ</th><th class="num">Moy. solo</th>
            <th class="num grp">PJ</th><th class="num">V</th><th class="num">Meill.</th>
            <th class="num grp">PJ</th><th class="num">V</th><th class="num">Meill.</th></tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <p class="muted">PJ = parties jouées · V = victoires · Moy. solo = score moyen par rapport à la normale en « chacun pour soi » · Meill. = meilleur score par rapport à la normale.</p>
    </div>
    ${last ? `<h3>Dernière partie</h3>${gameCard(last)}` : ''}
    <div class="row edit-only"><button class="primary" data-action="new-game">+ Ajouter une partie</button></div>`;
}

function gameCard(g) {
  const res = scoreGame(g);
  const teams = [...g.teams].filter(t => t.players.length).sort((a, b) => (+a.score) - (+b.score));
  const lines = teams.map(t => {
    const r = res[t.players[0]];
    const names = t.players.map(p => esc(playerName(p))).join(' &amp; ');
    const vs = +t.score - (+g.par || 0);
    return `<tr>
      <td class="${r?.won ? 'win' : ''}">${r ? r.rank : '—'}</td>
      <td>${names}${r?.won ? ' 🏆' : ''}</td>
      <td class="num">${esc(t.score)} <span class="muted">(${fmtPar(vs)})</span></td>
      <td class="num">+${r ? fmtNum(r.points) : 0}</td>
    </tr>`;
  }).join('');
  return `<div class="card">
    <div class="row between">
      <div><b>${fmtDate(g.date)}</b> · ${esc(courseName(g.courseId))}
        <span class="pill">${g.format === 'individuel' ? 'Chacun pour soi' : 'Meilleure balle'}</span>
        <span class="muted">${g.holes} trous · normale ${g.par}</span></div>
      <div class="row edit-only"><button class="small" data-action="edit-game" data-id="${g.id}">Modifier</button></div>
    </div>
    <div class="scroll"><table><thead><tr><th>#</th><th>${g.format === 'individuel' ? 'Joueur' : 'Équipe'}</th><th class="num">Score</th><th class="num">Pts/joueur</th></tr></thead><tbody>${lines}</tbody></table></div>
    ${g.notes ? `<p class="muted">${esc(g.notes)}</p>` : ''}
  </div>`;
}

function renderGames() {
  if (tabState.editing) return gameForm(tabState.editing);
  const games = filteredGames();
  return `
    <div class="row between"><h2>Parties</h2><div class="row">${seasonSelect()}<button class="primary edit-only" data-action="new-game">+ Nouvelle partie</button></div></div>
    ${games.length ? games.map(gameCard).join('') : '<div class="card empty">Aucune partie.</div>'}`;
}

// ----- Formulaire de partie -----

function newGameDraft() {
  const c = db.courses[0];
  return {
    id: null, date: new Date().toISOString().slice(0, 10), courseId: c?.id || '',
    holes: c?.holes || 18, par: c?.par || 72, format: 'equipe',
    present: [], assign: {}, teamScores: {}, stats: {}, notes: '', nbTeams: 2,
  };
}

function draftFromGame(g) {
  const assign = {}; const teamScores = {};
  g.teams.forEach((t, i) => { t.players.forEach(p => { assign[p] = i; }); teamScores[i] = t.score; });
  return {
    id: g.id, date: g.date, courseId: g.courseId, holes: g.holes, par: g.par, format: g.format,
    present: g.teams.flatMap(t => t.players), assign, teamScores,
    stats: JSON.parse(JSON.stringify(g.stats || {})), notes: g.notes || '',
    nbTeams: g.format === 'equipe' ? g.teams.length : 2,
  };
}

function gameForm(d) {
  const courseOpts = db.courses.map(c => `<option value="${c.id}" ${c.id === d.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const chips = db.players.map(p => `<span class="chip ${d.present.includes(p.id) ? 'on' : ''}" data-action="toggle-present" data-id="${p.id}">${esc(p.name)}</span>`).join('');
  let scoring = '';
  if (d.present.length) {
    if (d.format === 'individuel') {
      scoring = d.present.map(pid => `
        <div class="row"><div class="field" style="flex:2"><b>${esc(playerName(pid))}</b></div>
        <div class="field"><input type="number" inputmode="numeric" placeholder="Score" data-bind="score-player" data-id="${pid}" value="${esc(d.teamScores['p_' + pid] ?? '')}"></div></div>`).join('');
    } else {
      const teamOpts = i => Array.from({ length: d.nbTeams }, (_, k) => `<option value="${k}" ${i === k ? 'selected' : ''}>Équipe ${k + 1}</option>`).join('');
      const assignRows = d.present.map(pid => `
        <div class="row"><div class="field" style="flex:2">${esc(playerName(pid))}</div>
        <div class="field"><select data-bind="assign" data-id="${pid}"><option value="">—</option>${teamOpts(d.assign[pid])}</select></div></div>`).join('');
      const teamBoxes = Array.from({ length: d.nbTeams }, (_, k) => {
        const members = d.present.filter(p => d.assign[p] === k).map(playerName).map(esc).join(' &amp; ') || '<span class="muted">aucun joueur</span>';
        return `<div class="teambox row between"><div><b>Équipe ${k + 1}</b> : ${members}</div>
          <div style="width:110px"><input type="number" inputmode="numeric" placeholder="Score" data-bind="score-team" data-id="${k}" value="${esc(d.teamScores[k] ?? '')}"></div></div>`;
      }).join('');
      scoring = `
        <div class="row"><label style="margin:0">Nombre d'équipes</label>
          <div class="seg">${[2, 3, 4].map(n => `<button type="button" class="${d.nbTeams === n ? 'on' : ''}" data-action="nb-teams" data-n="${n}">${n}</button>`).join('')}</div>
          <button type="button" class="small" data-action="random-teams">🎲 Équipes au hasard</button></div>
        <h3>Qui joue avec qui ?</h3>${assignRows}
        <h3>Score de chaque équipe</h3>${teamBoxes}`;
    }
  }
  const statsBlock = d.present.length ? `
    <details ${Object.keys(d.stats).length ? 'open' : ''}><summary>Statistiques personnelles (facultatif)</summary>
      <div class="scroll"><table><thead><tr><th>Joueur</th>${STAT_FIELDS.map(f => `<th>${f.label}</th>`).join('')}</tr></thead><tbody>
      ${d.present.map(pid => `<tr><td>${esc(playerName(pid))}</td>${STAT_FIELDS.map(f => `<td><input style="min-width:70px" type="number" inputmode="numeric" data-bind="stat" data-id="${pid}" data-key="${f.key}" value="${esc(d.stats[pid]?.[f.key] ?? '')}"></td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
    </details>` : '';

  return `
    <h2>${d.id ? 'Modifier la partie' : 'Nouvelle partie'}</h2>
    <div class="card">
      <div class="row">
        <div class="field"><label>Date</label><input type="date" data-bind="date" value="${d.date}"></div>
        <div class="field"><label>Terrain</label>
          <select data-bind="course"><option value="">— choisir —</option>${courseOpts}<option value="__new">+ Nouveau terrain…</option></select></div>
      </div>
      <div class="row">
        <div class="field"><label>Trous joués</label><select data-bind="holes">${[9, 18].map(h => `<option ${+d.holes === h ? 'selected' : ''}>${h}</option>`).join('')}</select></div>
        <div class="field"><label>Normale (par)</label><input type="number" data-bind="par" value="${d.par}"></div>
      </div>
      <label>Formule</label>
      <div class="seg" style="margin-bottom:12px">
        <button type="button" class="${d.format === 'equipe' ? 'on' : ''}" data-action="format" data-f="equipe">2 balles meilleure balle</button>
        <button type="button" class="${d.format === 'individuel' ? 'on' : ''}" data-action="format" data-f="individuel">Chacun pour soi</button>
      </div>
      <label>Joueurs présents</label>
      <div class="chips" style="margin-bottom:8px">${chips}<span class="chip" data-action="add-player-inline">+ Nouveau joueur</span></div>
    </div>
    ${scoring ? `<div class="card">${scoring}</div>` : ''}
    ${statsBlock ? `<div class="card">${statsBlock}</div>` : ''}
    <div class="card"><label>Notes</label><textarea data-bind="notes" rows="2">${esc(d.notes)}</textarea></div>
    <div class="row between">
      <div class="row"><button class="primary" data-action="save-game">Enregistrer</button><button data-action="cancel-game">Annuler</button></div>
      ${d.id ? '<button class="danger" data-action="delete-game">Supprimer</button>' : ''}
    </div>
    <p class="muted" id="form-error"></p>`;
}

function draftToGame(d) {
  let teams;
  if (d.format === 'individuel') {
    teams = d.present.map(pid => ({ players: [pid], score: d.teamScores['p_' + pid] }));
  } else {
    teams = Array.from({ length: d.nbTeams }, (_, k) => ({ players: d.present.filter(p => d.assign[p] === k), score: d.teamScores[k] }))
      .filter(t => t.players.length);
  }
  teams = teams.map(t => ({ ...t, score: t.score === '' || t.score == null ? null : +t.score }));
  const stats = {};
  d.present.forEach(pid => {
    const st = d.stats[pid];
    if (st && Object.values(st).some(v => v !== '' && v != null)) stats[pid] = st;
  });
  return { id: d.id || uid(), date: d.date, courseId: d.courseId, holes: +d.holes, par: +d.par, format: d.format, teams, stats, notes: d.notes.trim() };
}

function validate(d) {
  if (!d.date) return 'Choisis une date.';
  if (!d.courseId) return 'Choisis un terrain.';
  if (d.present.length < 2) return 'Il faut au moins 2 joueurs.';
  if (d.format === 'equipe' && d.present.some(p => d.assign[p] == null || d.assign[p] === '')) return 'Place chaque joueur dans une équipe.';
  const g = draftToGame(d);
  if (g.teams.length < 2) return 'Il faut au moins 2 équipes avec des joueurs.';
  if (g.teams.some(t => t.score == null || isNaN(t.score))) return 'Entre un score pour chaque ' + (d.format === 'equipe' ? 'équipe.' : 'joueur.');
  return null;
}

// ----- Joueurs -----

function renderPlayers() {
  const games = filteredGames();
  const sel = tabState.player && byId(db.players, tabState.player) ? tabState.player : null;
  const list = db.players.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(p =>
    `<span class="chip ${p.id === sel ? 'on' : ''}" data-action="open-player" data-id="${p.id}">${esc(p.name)}</span>`).join('');
  let detail = '';
  if (sel) {
    const p = byId(db.players, sel);
    const s = playerStats(sel, games);
    const partners = Object.entries(s.team.partners).sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games || b[1].games - a[1].games)
      .map(([id, v]) => `<tr><td>${esc(playerName(id))}</td><td class="num">${v.games}</td><td class="num">${v.wins}</td><td class="num">${Math.round(100 * v.wins / v.games)} %</td></tr>`).join('');
    const avg = k => (s.statN[k] ? s.stat[k] / s.statN[k] : null);
    const history = games.filter(g => g.teams.some(t => t.players.includes(sel))).map(g => {
      const r = scoreGame(g)[sel];
      return `<tr><td>${fmtDate(g.date)}</td><td>${esc(courseName(g.courseId))}</td><td>${g.format === 'individuel' ? 'Solo' : 'Équipe'}</td>
        <td class="num">${r ? r.rank : '—'}${r?.won ? ' 🏆' : ''}</td><td class="num">${r ? esc(r.team.score) : '—'}</td><td class="num">+${r ? fmtNum(r.points) : 0}</td></tr>`;
    }).join('');
    detail = `
      <div class="card">
        <div class="row between"><h2 style="margin:0">${esc(p.name)}</h2>
          <div class="row edit-only"><button class="small" data-action="rename-player" data-id="${p.id}">Renommer</button>
          <button class="small danger" data-action="delete-player" data-id="${p.id}">Supprimer</button></div></div>
        <h3>Général</h3>
        <div class="stats">
          <div class="stat"><b>${fmtNum(s.points)}</b><span>Points</span></div>
          <div class="stat"><b>${s.games}</b><span>Parties</span></div>
          <div class="stat"><b>${s.wins}</b><span>Victoires</span></div>
          <div class="stat"><b>${s.games ? Math.round(100 * s.wins / s.games) : 0} %</b><span>% victoires</span></div>
        </div>
        <h3>Chacun pour soi</h3>
        <div class="stats">
          <div class="stat"><b>${s.solo.games}</b><span>Parties</span></div>
          <div class="stat"><b>${s.solo.wins}</b><span>Victoires</span></div>
          <div class="stat"><b>${fmtPar(s.avgVsPar)}</b><span>Moyenne vs normale</span></div>
          <div class="stat"><b>${s.solo.best ? fmtPar(s.solo.best.vsPar) : '—'}</b><span>Meilleure ronde${s.solo.best ? ` (${s.solo.best.score}, ${esc(courseName(s.solo.best.game.courseId))})` : ''}</span></div>
        </div>
        <h3>Meilleure balle</h3>
        <div class="stats">
          <div class="stat"><b>${s.team.games}</b><span>Parties</span></div>
          <div class="stat"><b>${s.team.wins}–${s.team.losses}</b><span>Victoires–défaites</span></div>
        </div>
        ${partners ? `<div class="scroll"><table><thead><tr><th>Partenaire</th><th class="num">PJ</th><th class="num">V</th><th class="num">%</th></tr></thead><tbody>${partners}</tbody></table></div>` : ''}
        <h3>Statistiques personnelles <span class="muted">(moyenne par partie)</span></h3>
        <div class="stats">
          <div class="stat"><b>${fmtNum(avg('putts'))}</b><span>Putts</span></div>
          <div class="stat"><b>${fmtNum(avg('fairways'))}</b><span>Allées atteintes</span></div>
          <div class="stat"><b>${s.greensHoles ? Math.round(100 * s.stat.greens / s.greensHoles) + ' %' : '—'}</b><span>Verts en régulation</span></div>
          <div class="stat"><b>${fmtNum(avg('birdies'))}</b><span>Oiselets</span></div>
          <div class="stat"><b>${s.stat.drive ? s.stat.drive + ' vg' : '—'}</b><span>Plus long départ</span></div>
        </div>
        <h3>Historique</h3>
        ${history ? `<div class="scroll"><table><thead><tr><th>Date</th><th>Terrain</th><th>Formule</th><th class="num">Rang</th><th class="num">Score</th><th class="num">Pts</th></tr></thead><tbody>${history}</tbody></table></div>` : '<p class="muted">Aucune partie.</p>'}
      </div>`;
  }
  return `
    <div class="row between"><h2>Joueurs</h2>${seasonSelect()}</div>
    <div class="card"><div class="chips">${list || '<span class="muted">Aucun joueur.</span>'}</div>
      <div class="row edit-only" style="margin-top:12px"><input id="new-player" placeholder="Nom du joueur" style="flex:1;width:auto"><button class="primary" data-action="add-player">Ajouter</button></div></div>
    ${detail}`;
}

// ----- Terrains -----

function renderCourses() {
  const rows = db.courses.map(c => {
    const games = db.games.filter(g => g.courseId === c.id);
    let record = null;
    games.filter(g => g.format === 'individuel').forEach(g => g.teams.forEach(t => {
      const vs = +t.score - +g.par;
      if (!record || vs < record.vs) record = { vs, score: t.score, who: t.players[0], date: g.date };
    }));
    return `<tr><td><b>${esc(c.name)}</b></td><td class="num">${c.par}</td><td class="num">${games.length}</td>
      <td>${record ? `${fmtPar(record.vs)} — ${esc(playerName(record.who))} <span class="muted">(${fmtDate(record.date)})</span>` : '—'}</td>
      <td class="num edit-only"><button class="small" data-action="edit-course" data-id="${c.id}">Modifier</button></td></tr>`;
  }).join('');
  return `
    <h2>Terrains</h2>
    <div class="card scroll">
      ${rows ? `<table><thead><tr><th>Terrain</th><th class="num">Normale</th><th class="num">Parties</th><th>Record (solo)</th><th class="edit-only"></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">Aucun terrain.</p>'}
    </div>
    <div class="card edit-only">
      <h3 style="margin-top:0">Ajouter un terrain</h3>
      <div class="row">
        <div class="field" style="flex:2"><label>Nom</label><input id="course-name" placeholder="ex. Pebble Beach"></div>
        <div class="field"><label>Normale (18 trous)</label><input id="course-par" type="number" value="72"></div>
      </div>
      <button class="primary" data-action="add-course">Ajouter</button>
    </div>`;
}

// ----- Réglages -----

function renderSettings() {
  const s = db.settings;
  const ro = editor ? '' : 'disabled';
  const ex = (n, sz = 1) => fmtNum(s.participation + s.parAdversaire * n * sz + s.bonusVictoire);
  return `
    <h2>Système de pointage</h2>
    <div class="card">
      <p>Après chaque partie, chaque joueur reçoit :</p>
      <ul>
        <li><b>Participation</b> : des points juste pour être venu.</li>
        <li><b>Par adversaire battu</b> : des points pour chaque <i>joueur</i> adverse qui a fait un pire score que toi (égalité = moitié).
          En meilleure balle, battre une équipe de 2 compte pour 2 adversaires — pour chacun des 2 coéquipiers.</li>
        <li><b>Bonus victoire</b> : pour la 1re place (partagé en cas d'égalité).</li>
      </ul>
      <div class="row">
        <div class="field"><label>Participation</label><input type="number" step="0.5" data-bind="setting" data-key="participation" value="${s.participation}" ${ro}></div>
        <div class="field"><label>Par adversaire battu</label><input type="number" step="0.5" data-bind="setting" data-key="parAdversaire" value="${s.parAdversaire}" ${ro}></div>
        <div class="field"><label>Bonus victoire</label><input type="number" step="0.5" data-bind="setting" data-key="bonusVictoire" value="${s.bonusVictoire}" ${ro}></div>
      </div>
      <p class="muted">Exemples avec ces réglages : gagner en meilleure balle 2 contre 2 = <b>${ex(2)}</b> pts chacun ·
        gagner en solo contre 3 joueurs = <b>${ex(3)}</b> pts · gagner en solo contre 5 joueurs = <b>${ex(5)}</b> pts ·
        finir dernier = <b>${fmtNum(s.participation)}</b> pt. Le classement est recalculé automatiquement si tu changes ces valeurs.</p>
    </div>
    <div class="edit-only">
    <h2>Données</h2>
    <div class="card">
      <p class="muted">Les données sont sauvegardées dans ce navigateur. Pour les partager avec la gang, exporte le fichier
        et remplace <code>data/ligue.json</code> dans le dépôt GitHub : tout le monde verra la même chose.</p>
      <div class="row">
        <button data-action="export">⬇️ Exporter (JSON)</button>
        <label class="btn" style="margin:0;color:var(--text);font-size:1rem">⬆️ Importer<input type="file" accept=".json" data-action="import" hidden></label>
        <button data-action="reload-site">🔄 Recharger la version du site</button>
      </div>
    </div>
    <h2>Accès</h2>
    <div class="card">
      <p class="muted">Sans mot de passe, le site est en lecture seule. Après un changement de mot de passe,
        exporte le fichier et remplace <code>data/ligue.json</code> pour qu'il s'applique à tout le monde.</p>
      <div class="row"><button data-action="change-password">🔑 Changer le mot de passe</button></div>
    </div>
    </div>`;
}

// ---------- Événements ----------

function bind() {
  view().querySelectorAll('[data-action]').forEach(el => {
    const evt = el.tagName === 'SELECT' || el.type === 'file' ? 'change' : 'click';
    el.addEventListener(evt, e => {
      if (!editor && EDIT_ACTIONS.has(el.dataset.action)) return;
      actions[el.dataset.action]?.(el, e);
    });
  });
  view().querySelectorAll('[data-bind]').forEach(el => {
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { if (editor) binds[el.dataset.bind]?.(el); });
  });
}

const draft = () => tabState.editing;

const EDIT_ACTIONS = new Set(['new-game', 'edit-game', 'save-game', 'delete-game', 'add-player', 'add-player-inline',
  'rename-player', 'delete-player', 'add-course', 'edit-course', 'export', 'import', 'reload-site', 'change-password']);

const binds = {
  date: el => { draft().date = el.value; },
  holes: el => { draft().holes = +el.value; const c = byId(db.courses, draft().courseId); if (c) draft().par = el.value === '9' ? Math.round(c.par / 2) : c.par; render(); },
  par: el => { draft().par = el.value; },
  notes: el => { draft().notes = el.value; },
  course: el => {
    if (el.value === '__new') {
      const name = prompt('Nom du terrain ?');
      if (name?.trim()) {
        const par = +prompt('Normale (18 trous) ?', '72') || 72;
        const c = { id: uid(), name: name.trim(), par, holes: 18 };
        db.courses.push(c); save();
        draft().courseId = c.id; draft().par = +draft().holes === 9 ? Math.round(par / 2) : par;
      }
      render(); return;
    }
    draft().courseId = el.value;
    const c = byId(db.courses, el.value);
    if (c) { draft().par = +draft().holes === 9 ? Math.round(c.par / 2) : c.par; render(); }
  },
  assign: el => { draft().assign[el.dataset.id] = el.value === '' ? null : +el.value; render(); },
  'score-team': el => { draft().teamScores[el.dataset.id] = el.value; },
  'score-player': el => { draft().teamScores['p_' + el.dataset.id] = el.value; },
  stat: el => { (draft().stats[el.dataset.id] ||= {})[el.dataset.key] = el.value === '' ? '' : +el.value; },
  setting: el => { db.settings[el.dataset.key] = +el.value || 0; save(); },
};

const actions = {
  season: el => { tabState.season = el.value; render(); },
  'new-game': () => { currentTab = 'parties'; tabState.editing = newGameDraft(); render(); },
  'edit-game': el => { currentTab = 'parties'; tabState.editing = draftFromGame(byId(db.games, el.dataset.id)); render(); window.scrollTo(0, 0); },
  'cancel-game': () => { tabState.editing = null; render(); },
  'toggle-present': el => {
    const d = draft(); const id = el.dataset.id;
    d.present = d.present.includes(id) ? d.present.filter(p => p !== id) : [...d.present, id];
    render();
  },
  'add-player-inline': () => {
    const name = prompt('Nom du nouveau joueur ?');
    if (!name?.trim()) return;
    const p = { id: uid(), name: name.trim() };
    db.players.push(p); save(); draft().present.push(p.id); render();
  },
  format: el => { draft().format = el.dataset.f; render(); },
  'nb-teams': el => {
    const d = draft(); d.nbTeams = +el.dataset.n;
    Object.keys(d.assign).forEach(p => { if (d.assign[p] >= d.nbTeams) d.assign[p] = null; });
    render();
  },
  'random-teams': () => {
    const d = draft();
    const shuffled = d.present.slice().sort(() => Math.random() - 0.5);
    shuffled.forEach((p, i) => { d.assign[p] = i % d.nbTeams; });
    render();
  },
  'save-game': () => {
    const d = draft(); const err = validate(d);
    if (err) { document.getElementById('form-error').textContent = '⚠️ ' + err; return; }
    const g = draftToGame(d);
    const i = db.games.findIndex(x => x.id === g.id);
    if (i >= 0) db.games[i] = g; else db.games.push(g);
    save(); tabState.editing = null; render();
  },
  'delete-game': () => {
    if (!confirm('Supprimer cette partie ?')) return;
    db.games = db.games.filter(g => g.id !== draft().id); save(); tabState.editing = null; render();
  },
  'open-player': el => { currentTab = 'joueurs'; tabState.player = el.dataset.id; render(); },
  'add-player': () => {
    const input = document.getElementById('new-player'); const name = input.value.trim();
    if (!name) return;
    const p = { id: uid(), name }; db.players.push(p); save(); tabState.player = p.id; render();
  },
  'rename-player': el => {
    const p = byId(db.players, el.dataset.id); const name = prompt('Nouveau nom ?', p.name);
    if (name?.trim()) { p.name = name.trim(); save(); render(); }
  },
  'delete-player': el => {
    const used = db.games.some(g => g.teams.some(t => t.players.includes(el.dataset.id)));
    if (used) { alert('Ce joueur a des parties enregistrées. Supprime ou modifie ces parties d\'abord.'); return; }
    if (!confirm('Supprimer ce joueur ?')) return;
    db.players = db.players.filter(p => p.id !== el.dataset.id); save(); tabState.player = null; render();
  },
  'add-course': () => {
    const name = document.getElementById('course-name').value.trim();
    if (!name) return;
    db.courses.push({ id: uid(), name, par: +document.getElementById('course-par').value || 72, holes: 18 });
    save(); render();
  },
  'edit-course': el => {
    const c = byId(db.courses, el.dataset.id);
    const name = prompt('Nom du terrain ?', c.name); if (!name?.trim()) return;
    const par = +prompt('Normale (18 trous) ?', c.par) || c.par;
    c.name = name.trim(); c.par = par; save(); render();
  },
  export: () => {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'ligue.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  import: el => {
    const file = el.files[0]; if (!file) return;
    file.text().then(t => {
      try {
        const data = normalize(JSON.parse(t));
        if (!confirm(`Remplacer les données actuelles par ce fichier (${data.games.length} parties, ${data.players.length} joueurs) ?`)) return;
        db = data; save(); render();
      } catch (e) { alert('Fichier invalide.'); }
    });
  },
  'change-password': async () => {
    const a = prompt('Nouveau mot de passe :');
    if (!a) return;
    if (prompt('Confirme le nouveau mot de passe :') !== a) { alert('Les deux mots de passe ne sont pas pareils.'); return; }
    db.settings.editHash = await sha256(a); save();
    alert('Mot de passe changé dans ce navigateur. Exporte et remplace data/ligue.json pour l\'appliquer au site.');
  },
  'reload-site': async () => {
    if (!confirm('Remplacer les données de ce navigateur par celles du fichier data/ligue.json du site ?')) return;
    db = await fetchSiteData(); save(); render();
  },
};

document.getElementById('tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  currentTab = b.dataset.tab;
  if (currentTab !== 'parties' || !editor) tabState.editing = null;
  render();
});

document.getElementById('access').addEventListener('click', () => (editor ? logout() : login()));

try { editor = localStorage.getItem(EDITOR_KEY) === '1'; } catch (e) { /* ignore */ }
load().then(render);
