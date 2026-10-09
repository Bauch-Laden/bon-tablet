'use strict';
/*
 * Bauch-Laden Food-Truck – Digitale Bestellbons
 * Pollt die Zettle Purchase API, vergibt eigene Bestellnummern
 * und schickt offene Bons per WebSocket an das Küchen-Tablet.
 */
require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const SERVER_VERSION = '1.3.0';

// ---------- Konfiguration (.env) ----------
const PORT = parseInt(process.env.PORT || '3000', 10);
const CLIENT_ID = process.env.ZETTLE_CLIENT_ID || '';
const API_KEY = process.env.ZETTLE_API_KEY || '';
const MOCK = process.env.ZETTLE_MOCK === '1';
const POLL_MS = parseInt(process.env.POLL_MS || '4000', 10);
const NR_MIN = parseInt(process.env.NR_MIN || '1', 10);
const NR_MAX = parseInt(process.env.NR_MAX || '99', 10);
const MAX_ALTER_MIN = parseInt(process.env.MAX_ALTER_MIN || '30', 10);
const BACKOFFICE_PIN = String(process.env.BACKOFFICE_PIN || '111222');
const GESCHUETZT = ['naechsteNr', 'testbon', 'alleLeeren'];
const AUSBLENDEN = (process.env.AUSBLENDEN || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const STATE_FILE = path.join(__dirname, 'state.json');
const HTML_FILE = path.join(__dirname, 'kueche.html');
const PURCHASE_URL = 'https://purchase.izettle.com/purchases/v2';

// ---------- Zustand ----------
let state = {
  naechsteNr: NR_MIN,
  lastPurchaseHash: null,
  offen: [],      // { id, nr, zeit, positionen:[{name, menge, notiz}], test }
  erledigt: [],   // zuletzt erledigte Bons (für Rückgängig), max. 20
  gesehen: []     // Purchase-UUIDs, um Duplikate zu vermeiden, max. 500
};
const status = { zettleOk: false, letzterFehler: null, letzterPoll: null };
const ROT_NACH_MS = 30000;   // erst nach so langer Störung wird die Anzeige rot

function ladeState() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    state = Object.assign(state, j);
    console.log(`Zustand geladen: ${state.offen.length} offene Bons, nächste Nr. ${state.naechsteNr}`);
  } catch (e) {
    console.log('Kein gespeicherter Zustand – starte neu.');
  }
}
let speichernTimer = null;
function speichereState() {
  clearTimeout(speichernTimer);
  speichernTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(state));
      fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
    } catch (e) { console.error('Speichern fehlgeschlagen:', e.message); }
  }, 200);
}

// ---------- Bons ----------
function nimmNummer() {
  const nr = state.naechsteNr;
  state.naechsteNr = nr >= NR_MAX ? NR_MIN : nr + 1;
  return nr;
}

function neuerBon(positionen, zeit, id, test) {
  const bon = { id, nr: nimmNummer(), zeit, positionen, test: !!test };
  state.offen.push(bon);
  speichereState();
  console.log(`Neuer Bon #${bon.nr}: ${positionen.map(p => p.menge + 'x ' + p.name).join(', ')}`);
  sendeZustand({ neu: bon.id });
}

function merkeGesehen(id) {
  state.gesehen.push(id);
  if (state.gesehen.length > 500) state.gesehen = state.gesehen.slice(-500);
}

function verarbeitePurchase(p) {
  const id = p.purchaseUUID1 || p.purchaseUUID;
  if (!id || state.gesehen.includes(id)) return;
  merkeGesehen(id);

  if (p.refund === true) return; // Erstattungen ignorieren

  const zeit = Date.parse(p.timestamp) || Date.now();
  if (Date.now() - zeit > MAX_ALTER_MIN * 60 * 1000) return; // alter Rückstand nach Neustart

  const positionen = (p.products || [])
    .map(pr => {
      const variante = (pr.variantName || '').trim();
      return {
        name: (pr.name || 'Artikel') + (variante ? ' – ' + variante : ''),
        menge: Math.max(1, Math.round(parseFloat(pr.quantity) || 1)),
        notiz: (pr.comment || '').trim()
      };
    })
    .filter(pos => !AUSBLENDEN.some(a => pos.name.toLowerCase().includes(a)));

  if (!positionen.length) { speichereState(); return; } // z. B. nur Getränke
  neuerBon(positionen, zeit, id, false);
}

// ---------- Zettle ----------
// Netzwerkfehler ("fetch failed") bis zu zweimal sofort wiederholen
async function netzFetch(url, opts) {
  let letzter;
  for (let versuch = 0; versuch < 3; versuch++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      letzter = e;
      await new Promise(r => setTimeout(r, 400 * (versuch + 1)));
    }
  }
  const ursache = letzter && letzter.cause ? (letzter.cause.code || letzter.cause.message) : '';
  throw new Error('Netzwerk: ' + (letzter ? letzter.message : 'unbekannt') + (ursache ? ' (' + ursache + ')' : ''));
}

let token = null;
let tokenAblauf = 0;

async function holeToken(erzwingen) {
  if (!erzwingen && token && Date.now() < tokenAblauf - 5 * 60 * 1000) return token;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: CLIENT_ID,
    assertion: API_KEY
  });
  const r = await netzFetch('https://oauth.zettle.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!r.ok) throw new Error(`Token-Fehler ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  token = j.access_token;
  tokenAblauf = Date.now() + (j.expires_in || 7200) * 1000;
  console.log('Neues Zettle-Token geholt.');
  return token;
}

async function zettleGet(url) {
  let t = await holeToken(false);
  let r = await netzFetch(url, { headers: { Authorization: 'Bearer ' + t } });
  if (r.status === 401) {
    t = await holeToken(true);
    r = await netzFetch(url, { headers: { Authorization: 'Bearer ' + t } });
  }
  if (!r.ok) throw new Error(`Zettle-Fehler ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function initHash() {
  // Jüngsten Kauf als Startpunkt holen – er selbst wird nicht als Bon angezeigt
  const j = await zettleGet(`${PURCHASE_URL}?limit=1&descending=true`);
  (j.purchases || []).forEach(p => merkeGesehen(p.purchaseUUID1 || p.purchaseUUID));
  state.lastPurchaseHash = j.lastPurchaseHash || j.firstPurchaseHash || null;
  speichereState();
  console.log('Start-Hash gesetzt:', state.lastPurchaseHash);
}

async function poll() {
  if (!state.lastPurchaseHash) { await initHash(); return; }
  const url = `${PURCHASE_URL}?limit=20&descending=false&lastPurchaseHash=${encodeURIComponent(state.lastPurchaseHash)}`;
  const j = await zettleGet(url);
  (j.purchases || []).forEach(verarbeitePurchase);
  if (j.lastPurchaseHash) state.lastPurchaseHash = j.lastPurchaseHash;
  speichereState();
}

let fehlerInFolge = 0;
async function pollSchleife() {
  try {
    await poll();
    fehlerInFolge = 0;
    const warVorherFehler = !status.zettleOk;
    status.zettleOk = true;
    status.letzterFehler = null;
    status.letzterPoll = Date.now();
    if (warVorherFehler) sendeZustand();
  } catch (e) {
    fehlerInFolge++;
    status.letzterFehler = e.message;
    console.error(new Date().toLocaleTimeString('de-DE') + ' Poll-Fehler:', e.message);
    // Kurze Aussetzer nicht als Störung anzeigen
    const seitErfolg = status.letzterPoll ? Date.now() - status.letzterPoll : Infinity;
    if (status.zettleOk && seitErfolg > ROT_NACH_MS) {
      status.zettleOk = false;
      sendeZustand();
    }
  }
  const warte = fehlerInFolge ? Math.min(15000, POLL_MS * (fehlerInFolge + 1)) : POLL_MS;
  setTimeout(pollSchleife, warte);
}

// ---------- Testmodus ohne Zettle ----------
const TEST_ARTIKEL = [
  'Falafel-Wrap', 'Halloumi-Burger', 'Pommes', 'Süßkartoffel-Pommes',
  'Wedges', 'Veggie-Bowl', 'Linsensuppe', 'Kumpir'
];
function testBon() {
  const anzahl = 1 + Math.floor(Math.random() * 3);
  const positionen = [];
  for (let i = 0; i < anzahl; i++) {
    positionen.push({
      name: TEST_ARTIKEL[Math.floor(Math.random() * TEST_ARTIKEL.length)],
      menge: 1 + Math.floor(Math.random() * 2),
      notiz: Math.random() < 0.2 ? 'ohne Zwiebeln' : ''
    });
  }
  neuerBon(positionen, Date.now(), 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), true);
}

// ---------- WebSocket ----------
let wss;
function zustandNachricht(extra) {
  return JSON.stringify(Object.assign({
    typ: 'zustand',
    version: SERVER_VERSION,
    offen: state.offen,
    letzteErledigt: state.erledigt.length ? state.erledigt[state.erledigt.length - 1] : null,
    naechsteNr: state.naechsteNr,
    nrMin: NR_MIN,
    nrMax: NR_MAX,
    status: { mock: MOCK, zettleOk: MOCK ? true : status.zettleOk, letzterFehler: status.letzterFehler, letzterPoll: status.letzterPoll }
  }, extra || {}));
}
function sendeZustand(extra) {
  if (!wss) return;
  const msg = zustandNachricht(extra);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
}

function behandleNachricht(m, ws) {
  if (m.typ === 'pinPruefen') {
    ws.send(JSON.stringify({ typ: String(m.pin) === BACKOFFICE_PIN ? 'pinOk' : 'pinFalsch' }));
    return;
  }
  if (GESCHUETZT.includes(m.typ) && String(m.pin) !== BACKOFFICE_PIN) {
    ws.send(JSON.stringify({ typ: 'pinFalsch' }));
    return;
  }
  if (m.typ === 'erledigt') {
    const i = state.offen.findIndex(b => b.id === m.id);
    if (i === -1) return;
    const [bon] = state.offen.splice(i, 1);
    bon.erledigtUm = Date.now();
    state.erledigt.push(bon);
    if (state.erledigt.length > 20) state.erledigt = state.erledigt.slice(-20);
  } else if (m.typ === 'rueckgaengig') {
    const bon = state.erledigt.pop();
    if (!bon) return;
    delete bon.erledigtUm;
    state.offen.push(bon);
    state.offen.sort((a, b) => a.zeit - b.zeit);
  } else if (m.typ === 'position') {
    const bon = state.offen.find(b => b.id === m.id);
    if (!bon || !bon.positionen[m.index]) return;
    bon.positionen[m.index].raus = !!m.raus;
  } else if (m.typ === 'naechsteNr') {
    const nr = parseInt(m.nr, 10);
    if (!(nr >= NR_MIN && nr <= NR_MAX)) return;
    state.naechsteNr = nr;
  } else if (m.typ === 'testbon') {
    testBon();
    return;
  } else if (m.typ === 'alleLeeren') {
    state.erledigt.push(...state.offen.map(b => Object.assign(b, { erledigtUm: Date.now() })));
    if (state.erledigt.length > 20) state.erledigt = state.erledigt.slice(-20);
    state.offen = [];
  } else {
    return;
  }
  speichereState();
  sendeZustand();
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/kueche.html') {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { res.writeHead(500); res.end('kueche.html fehlt'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  } else if (url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: SERVER_VERSION, mock: MOCK, offen: state.offen.length, naechsteNr: state.naechsteNr, ...status }));
  } else {
    res.writeHead(404); res.end('Nicht gefunden');
  }
});

wss = new WebSocketServer({ server });
wss.on('connection', ws => {
  ws.send(zustandNachricht());
  ws.on('message', raw => {
    try { behandleNachricht(JSON.parse(raw), ws); } catch (e) { console.error('Ungültige Nachricht:', e.message); }
  });
});

// ---------- Start ----------
ladeState();
server.listen(PORT, () => {
  console.log(`Bon-Server v${SERVER_VERSION} läuft auf Port ${PORT}${MOCK ? ' (TESTMODUS ohne Zettle)' : ''}`);
  if (MOCK) {
    setInterval(() => { if (Math.random() < 0.5) testBon(); }, 20000);
  } else {
    if (!CLIENT_ID || !API_KEY) {
      console.error('ZETTLE_CLIENT_ID und ZETTLE_API_KEY in .env eintragen!');
      status.letzterFehler = 'Zugangsdaten fehlen in .env';
    } else {
      pollSchleife();
    }
  }
});
