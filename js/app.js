// CT Rubrica — Carpenteria Ticinese
// app.js — tutta la logica dell'app
// Stack: HTML/JS vanilla + Supabase JS v2
//
// Stesso progetto Supabase e stessa tabella (tm_contatti) di Pre-contabilità:
// un contatto salvato qui compare anche là, e viceversa. Il login usa gli
// stessi account (auth.users): non esiste un secondo sistema di accesso.

'use strict'

// ─── Configurazione ──────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://wgidgbauhivdctdxfjnk.supabase.co'
const SUPABASE_KEY = 'sb_publishable_Ke7MTQGHPYVXvKInfOrUQQ_Ys6qKJvD'
const BUCKET_FOTO  = 'rubrica-foto'
const APP_VERSIONE = 2

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

// ─── Le categorie ────────────────────────────────────────────────────────────
// Stanno nella tabella rubrica_categorie (id, azienda_id, nome, ordine, attiva).
// L'id è la chiave che finisce in tm_contatti.categorie (text[]) e NON cambia
// mai: rinominare tocca solo `nome`, così i contatti già taggati restano
// agganciati. Disattivare (attiva = false) toglie la categoria dalle spunte e
// dai filtri, ma chi ce l'ha la conserva e la vede col suo nome. Le righe non
// si cancellano mai. Un contatto ne può avere più di una: compare in ogni
// filtro che ha spuntato.
var CATEGORIE = []   // tutte le righe dell'azienda, anche le disattivate, per `ordine`
var categorieErrore = null   // testo dell'errore se rubrica_categorie non si legge

// Ogni categoria ha un colore (tinta HSL): la tabella non lo ha, quindi le
// categorie di partenza hanno tinte scelte perché si distinguano bene, le
// altre la ricavano dall'id (sempre la stessa per la stessa categoria). Il CSS
// decide quanto chiara o scura, a seconda del tema del telefono.
var TINTE_CATEGORIE = {
  fornitori: 24, collaboratori: 212, preventivi: 266, appalti_presi: 150,
  appalti_conclusi: 182, marketing_servizi: 330, tecnici: 44, altro: -1
}

function tintaDaTesto(s) {
  var h = 0
  s = String(s || '')
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

// Lo stile inline con tinta e saturazione; -1 = grigio.
function stileTinta(h) {
  return h < 0 ? '--h:220;--s:8%' : '--h:' + h + ';--s:62%'
}

function rigaCategoria(r) {
  var h = r.id in TINTE_CATEGORIE ? TINTE_CATEGORIE[r.id] : tintaDaTesto(r.id)
  return { k: r.id, n: r.nome || r.id, stile: stileTinta(h), ordine: r.ordine, attiva: r.attiva !== false }
}

function ordinaCategorie() {
  CATEGORIE.sort(function (a, b) {
    var oa = a.ordine == null ? Infinity : a.ordine, ob = b.ordine == null ? Infinity : b.ordine
    if (oa !== ob) return oa < ob ? -1 : 1
    return a.n.localeCompare(b.n, 'it', { sensitivity: 'base' })
  })
}

// Quelle che si offrono: spunte del modulo e pulsanti-filtro.
function categorieAttive() {
  return CATEGORIE.filter(function (c) { return c.attiva })
}

// Una chiave che non è (più) in tabella si mostra com'è: meglio l'id che niente.
function categoriaInfo(k) {
  return CATEGORIE.filter(function (c) { return c.k === k })[0] ||
         { k: k, n: k, stile: stileTinta(-1), attiva: false }
}

// ─── Icone ───────────────────────────────────────────────────────────────────
// Disegni a tratto (stile Lucide, licenza ISC), uguali su iPhone, Samsung e PC:
// le emoji cambiano aspetto da un telefono all'altro. Nell'HTML si scrive
// <i data-ico="nome"></i> e riempiIcone() ci mette il disegno.
var ICONE = {
  telefono:  '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  cellulare: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  messaggio: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  email:     '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  mappa:     '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  sito:      '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  cerca:     '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  piu:       '<path d="M5 12h14"/><path d="M12 5v14"/>',
  indietro:  '<path d="m15 18-6-6 6-6"/>',
  avanti:    '<path d="m9 18 6-6-6-6"/>',
  modifica:  '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  elimina:   '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  tag:       '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  esci:      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  copia:     '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  persona:   '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  documento: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  banca:     '<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
  orologio:  '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  nota:      '<path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>',
  foto:      '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  chiudi:    '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  spunta:    '<path d="M20 6 9 17l-5-5"/>',
  archivio:  '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  gruppo:    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  ok:        '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  attenzione:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  errore:    '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  info:      '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'
}

function icona(nome) {
  return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">' + (ICONE[nome] || '') + '</svg>'
}

function riempiIcone(radice) {
  Array.prototype.forEach.call((radice || document).querySelectorAll('i[data-ico]'), function (i) {
    if (!i.firstChild) i.innerHTML = icona(i.getAttribute('data-ico'))
  })
}

// ─── I paesi ─────────────────────────────────────────────────────────────────
// Stesso elenco di Pre-contabilità (FASE 21). A schermo il nome, nel database
// il codice ISO 3166-1 a due lettere. Il campo è SOLO una tendina: scrivere
// «Svizzera» a mano in un campo di due caratteri dava «SV», che è El Salvador.
var PAESE_PREDEFINITO = 'CH'

var PAESI_FREQUENTI = [
  { c: 'CH', n: 'Svizzera' },
  { c: 'IT', n: 'Italia' },
  { c: 'DE', n: 'Germania' },
  { c: 'FR', n: 'Francia' },
  { c: 'AT', n: 'Austria' },
  { c: 'LI', n: 'Liechtenstein' }
]

var PAESI_ALTRI = [
  { c: 'AL', n: 'Albania' }, { c: 'AD', n: 'Andorra' }, { c: 'SA', n: 'Arabia Saudita' },
  { c: 'AR', n: 'Argentina' }, { c: 'AM', n: 'Armenia' }, { c: 'AU', n: 'Australia' },
  { c: 'AZ', n: 'Azerbaigian' }, { c: 'BE', n: 'Belgio' }, { c: 'BY', n: 'Bielorussia' },
  { c: 'BA', n: 'Bosnia ed Erzegovina' }, { c: 'BR', n: 'Brasile' }, { c: 'BG', n: 'Bulgaria' },
  { c: 'CA', n: 'Canada' }, { c: 'CN', n: 'Cina' }, { c: 'CY', n: 'Cipro' },
  { c: 'VA', n: 'Città del Vaticano' }, { c: 'KR', n: 'Corea del Sud' },
  { c: 'HR', n: 'Croazia' }, { c: 'DK', n: 'Danimarca' }, { c: 'EG', n: 'Egitto' },
  { c: 'AE', n: 'Emirati Arabi Uniti' }, { c: 'EE', n: 'Estonia' }, { c: 'FI', n: 'Finlandia' },
  { c: 'GE', n: 'Georgia' }, { c: 'JP', n: 'Giappone' }, { c: 'GI', n: 'Gibilterra' },
  { c: 'GR', n: 'Grecia' }, { c: 'IN', n: 'India' }, { c: 'ID', n: 'Indonesia' },
  { c: 'IE', n: 'Irlanda' }, { c: 'IS', n: 'Islanda' }, { c: 'IL', n: 'Israele' },
  { c: 'LV', n: 'Lettonia' }, { c: 'LT', n: 'Lituania' }, { c: 'LU', n: 'Lussemburgo' },
  { c: 'MK', n: 'Macedonia del Nord' }, { c: 'MT', n: 'Malta' }, { c: 'MA', n: 'Marocco' },
  { c: 'MX', n: 'Messico' }, { c: 'MD', n: 'Moldova' }, { c: 'MC', n: 'Monaco' },
  { c: 'ME', n: 'Montenegro' }, { c: 'NO', n: 'Norvegia' }, { c: 'NZ', n: 'Nuova Zelanda' },
  { c: 'NL', n: 'Paesi Bassi' }, { c: 'PL', n: 'Polonia' }, { c: 'PT', n: 'Portogallo' },
  { c: 'GB', n: 'Regno Unito' }, { c: 'CZ', n: 'Repubblica Ceca' }, { c: 'RO', n: 'Romania' },
  { c: 'RU', n: 'Russia' }, { c: 'SM', n: 'San Marino' }, { c: 'RS', n: 'Serbia' },
  { c: 'SG', n: 'Singapore' }, { c: 'SK', n: 'Slovacchia' }, { c: 'SI', n: 'Slovenia' },
  { c: 'ES', n: 'Spagna' }, { c: 'US', n: 'Stati Uniti' }, { c: 'ZA', n: 'Sudafrica' },
  { c: 'SE', n: 'Svezia' }, { c: 'TH', n: 'Thailandia' }, { c: 'TR', n: 'Turchia' },
  { c: 'UA', n: 'Ucraina' }, { c: 'HU', n: 'Ungheria' }
]

function paeseValido(codice) {
  var c = String(codice == null ? '' : codice).trim().toUpperCase()
  if (!c) return false
  return PAESI_FREQUENTI.concat(PAESI_ALTRI).some(function (p) { return p.c === c })
}

function nomePaese(codice) {
  var c = String(codice == null ? '' : codice).trim().toUpperCase()
  var t = PAESI_FREQUENTI.concat(PAESI_ALTRI).filter(function (p) { return p.c === c })[0]
  return t ? t.n : ''
}

// Le voci della tendina. Niente voce vuota: la colonna è NOT NULL e la
// Svizzera è il caso normale. Un codice già scritto che non sta in elenco
// (i vecchi «SV») NON viene cambiato di nascosto: entra come voce «da
// correggere», così si vede e si sistema scegliendo il paese giusto.
function buildPaeseOptions(selected) {
  var sel = String(selected == null ? '' : selected).trim().toUpperCase() || PAESE_PREDEFINITO
  function voce(p) {
    return '<option value="' + esc(p.c) + '"' + (p.c === sel ? ' selected' : '') + '>' +
           esc(p.n + ' (' + p.c + ')') + '</option>'
  }
  var out = '<optgroup label="Più usati">' + PAESI_FREQUENTI.map(voce).join('') + '</optgroup>'
  out += '<optgroup label="Tutti gli altri">' + PAESI_ALTRI.map(voce).join('') + '</optgroup>'
  if (!paeseValido(sel)) {
    out += '<optgroup label="Da correggere">' +
             '<option value="' + esc(sel) + '" selected>⚠️ «' + esc(sel) + '» non è un paese valido — scegline uno</option>' +
           '</optgroup>'
  }
  return out
}

// ─── Stato ───────────────────────────────────────────────────────────────────
let currentUser      = null
let currentAziendaId = null
let contatti         = []        // tutti i contatti dell'azienda, già ordinati
let filtroCategoria  = 'tutti'   // 'tutti' | una chiave di CATEGORIE | 'archiviati'
let testoRicerca     = ''
let vistaCorrente    = 'lista'
let letturaId        = null      // contatto aperto nella scheda in lettura
let editingId        = null      // contatto in modifica (null = nuovo)
let fotoPendente     = null      // File scelto nel modulo, non ancora caricato
let fotoDaTogliere   = false     // «Togli foto» premuto in modifica
let forzaSalvataggio = false     // «Salva comunque» dopo l'avviso omonimi
let colonneOpzionali = { cellulare: true, doppiaCategoria: true }  // sonda all'avvio

// ─── Piccole utilità ─────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id) }
function html(id, h) { var e = el(id); if (e) e.innerHTML = h }
function getVal(id) { var e = el(id); return e ? String(e.value || '').trim() : '' }
function setVal(id, v) { var e = el(id); if (e) e.value = v == null ? '' : v }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function bannerHtml(tipo, msg, extraHtml) {
  var ico = { ok: 'ok', warn: 'attenzione', err: 'errore', info: 'info' }[tipo] || 'info'
  return '<div class="banner ' + tipo + '" role="alert">' +
           '<span class="icona">' + icona(ico) + '</span>' +
           '<div class="msg">' + msg + (extraHtml || '') + '</div>' +
         '</div>'
}

// msg è testo semplice (viene escapato); extraHtml è HTML già pronto.
function mostraBanner(id, tipo, msg, extraHtml) {
  html(id, bannerHtml(tipo, esc(msg), extraHtml))
}

function pulisciBanner(id) { html(id, '') }

// Il nome con cui un contatto compare ovunque: ragione sociale se c'è,
// altrimenti cognome + nome.
function contattoNome(c) {
  if (!c) return ''
  if (c.ragione_sociale) return c.ragione_sociale
  return [c.cognome, c.nome].filter(Boolean).join(' ')
}

function iniziali(c) {
  var n = contattoNome(c)
  var parole = n.split(/\s+/).filter(Boolean)
  if (!parole.length) return '?'
  if (parole.length === 1) return parole[0].slice(0, 2).toUpperCase()
  return (parole[0][0] + parole[1][0]).toUpperCase()
}

// Una tinta stabile per contatto, dal nome: così le iniziali si distinguono.
function stileAvatar(c) {
  return '--h:' + tintaDaTesto(contattoNome(c)) + ';--s:48%'
}

function avatarHtml(c, grande) {
  var cls = 'avatar' + (grande ? ' grande' : '')
  if (c.foto_url) {
    // Se la foto non si carica (file cancellato, bucket privato) si torna alle iniziali.
    return '<div class="' + cls + '" style="' + stileAvatar(c) + '">' +
             '<img src="' + esc(c.foto_url) + '" alt="" loading="lazy"' +
             ' onerror="this.parentNode.textContent=\'' + esc(iniziali(c)) + '\'" />' +
           '</div>'
  }
  return '<div class="' + cls + '" style="' + stileAvatar(c) + '">' + esc(iniziali(c)) + '</div>'
}

// Il numero come va nel link tel: solo cifre e il + iniziale. Lo «(0)» della
// notazione svizzera («+41 (0)91 …») si toglie: con il prefisso non si compone.
function telHref(n) {
  var s = String(n || '').trim().replace(/\(0\)/g, '')
  var piu = s.charAt(0) === '+'
  var cifre = s.replace(/[^0-9]/g, '')
  return cifre ? 'tel:' + (piu ? '+' : '') + cifre : ''
}

function ibanLeggibile(iban) {
  return String(iban || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()
}

function urlSito(s) {
  s = String(s || '').trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : 'https://' + s
}

// Le categorie di un contatto. Se la colonna nuova è NULL (contatto creato da
// Pre-contabilità, mai aperto qui) si ricava dalla categoria vecchia quello che
// si può: fornitore → Fornitori, collaboratore → Collaboratori. Un «cliente»
// non si sa se sia preventivo o appalto: resta senza categoria finché qualcuno
// non lo apre e sceglie. Un array VUOTO invece è una scelta fatta da qui
// (tutte le spunte tolte) e si rispetta: niente ripiego.
function categorieDi(c) {
  if (Array.isArray(c.categorie)) return c.categorie
  var out = []
  if (c.categoria === 'fornitore' || c.e_fornitore === true) out.push('fornitori')
  if (c.categoria === 'collaboratore') out.push('collaboratori')
  return out
}

function badgesCategorie(c) {
  var cats = categorieDi(c)
  var out = cats.map(function (k) {
    var info = categoriaInfo(k)
    if (!info.attiva) {
      return '<span class="badge spenta" style="' + info.stile + '"' +
               ' title="Categoria disattivata: resta su questo contatto, non si offre ai nuovi">' +
               '<i class="pallino"></i>' + esc(info.n) + '</span>'
    }
    return '<span class="badge" style="' + info.stile + '"><i class="pallino"></i>' + esc(info.n) + '</span>'
  })
  if (!cats.length) out.push('<span class="badge grigio">senza categoria</span>')
  if (c.attivo === false) out.push('<span class="badge warn">archiviato</span>')
  return out.join(' ')
}

// ─── Avvio ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function () {
  if (el('piede-versione')) el('piede-versione').textContent = APP_VERSIONE
  riempiIcone(document)

  // Girando il tablet o allargando la finestra la scheda passa da sola fra
  // «a tutto schermo» e «accanto all'elenco».
  var attesaResize = null
  window.addEventListener('resize', function () {
    clearTimeout(attesaResize)
    attesaResize = setTimeout(function () { if (vistaCorrente === 'scheda') aggiornaSplit() }, 150)
  })

  // Sessione scaduta o chiusa da un'altra scheda: si torna al login.
  sb.auth.onAuthStateChange(function (evento) {
    if (evento === 'SIGNED_OUT') {
      currentUser = null; currentAziendaId = null; contatti = []
      mostraPagina('login')
    }
  })

  // Sessione già aperta (la libreria la tiene nel browser): si entra diretti.
  try {
    const { data } = await sb.auth.getSession()
    if (data && data.session && data.session.user) {
      currentUser = data.session.user
      await entraNellApp()
      return
    }
  } catch (e) {
    console.warn('getSession:', e)
  }
  mostraPagina('login')
})

// Esc: dalla scheda o dal modulo si torna all'elenco.
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Escape') return
  if (vistaCorrente === 'modulo') annullaModulo()
  else if (vistaCorrente === 'scheda' || vistaCorrente === 'categorie') mostraVista('lista')
})

function mostraPagina(quale) {
  el('pagina-login').hidden = quale !== 'login'
  el('pagina-app').hidden   = quale !== 'app'
  if (quale === 'login') setTimeout(function () { var e = el('login-email'); if (e) e.focus() }, 50)
}

// ─── Login / logout ──────────────────────────────────────────────────────────
async function login(event) {
  if (event) event.preventDefault()
  var btn = el('login-btn')
  pulisciBanner('login-banner')
  var email = getVal('login-email')
  var password = el('login-password') ? el('login-password').value : ''
  if (!email || !password) {
    mostraBanner('login-banner', 'err', 'Inserisci email e password.')
    return false
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Accesso…' }
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: email, password: password })
    if (error) throw error
    currentUser = data.user
    await entraNellApp()
  } catch (e) {
    console.warn('Login:', e)
    var m = String(e && e.message || '')
    var testo = /invalid login credentials|invalid_credentials/i.test(m)
      ? 'Email o password non corretti.'
      : /email not confirmed/i.test(m)
        ? 'Questo indirizzo non è ancora confermato.'
        : /fetch|network/i.test(m)
          ? 'Non riesco a raggiungere il server: controlla la connessione.'
          : 'Accesso non riuscito: ' + m
    mostraBanner('login-banner', 'err', testo)
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Entra' }
  }
  return false
}

async function logout() {
  try { await sb.auth.signOut() } catch (_) { /* si esce comunque */ }
  currentUser = null; currentAziendaId = null; contatti = []
  setVal('login-password', '')
  mostraPagina('login')
}

async function entraNellApp() {
  if (el('topbar-email')) el('topbar-email').textContent = currentUser.email || ''
  mostraPagina('app')
  pulisciBanner('banner-globale')
  html('lista-contatti', '<div class="caricamento">Carico la rubrica…</div>')
  try {
    await loadAziendaId()
    await sondaColonne()
    await loadContatti()
    // Senza categorie la rubrica si usa lo stesso: i contatti tengono le loro
    // (il modulo le ripropone spuntate anche se non sono in tabella).
    try { await loadCategorie() } catch (ec) { console.warn('Categorie:', ec) }
    mostraVista('lista')
    if (categorieErrore) {
      mostraBanner('banner-globale', 'warn', 'Non riesco a leggere le categorie (rubrica_categorie): ' + categorieErrore +
        ' I contatti restano visibili e conservano le loro categorie.')
    }
  } catch (e) {
    console.error('Avvio:', e)
    mostraBanner('banner-globale', 'err', 'Non riesco a caricare la rubrica: ' + spiegaErrore(e))
    html('lista-contatti', '')
  }
}

// L'azienda dell'utente: serve per scrivere (la policy RLS pretende un
// azienda_id fra quelli dell'utente) e per leggere solo i contatti suoi.
async function loadAziendaId() {
  const { data, error } = await sb.from('tm_utenti').select('azienda_id').eq('id', currentUser.id).single()
  if (error) throw new Error('utente non collegato a nessuna azienda (tm_utenti): ' + error.message)
  currentAziendaId = data ? data.azienda_id : null
  if (!currentAziendaId) throw new Error('utente senza azienda in tm_utenti.')
}

// Le colonne che potrebbero non esserci ancora. `cellulare` arriva con
// SQL_FASE29 di Pre-contabilità, e_cliente/e_fornitore con SQL_FASE17: se
// mancano, si lavora senza (il campo Cellulare si nasconde) invece di far
// fallire tutta la lettura.
async function sondaColonne() {
  async function esiste(campi) {
    const { error } = await sb.from('tm_contatti').select(campi).limit(1)
    return !error
  }
  colonneOpzionali.cellulare       = await esiste('id, cellulare')
  colonneOpzionali.doppiaCategoria = await esiste('id, e_cliente, e_fornitore')
  if (el('c-cellulare-campo')) el('c-cellulare-campo').hidden = !colonneOpzionali.cellulare
}

// ─── Lettura dei contatti ────────────────────────────────────────────────────
async function loadContatti() {
  var campi = 'id, categoria, categorie, ragione_sociale, nome, cognome, referente,' +
              ' indirizzo, cap, citta, paese, telefono, email, sito_web, uid_partita_iva,' +
              ' iban, giorni_pagamento, note, foto_url, attivo, created_at, updated_at'
  if (colonneOpzionali.cellulare)       campi += ', cellulare'
  if (colonneOpzionali.doppiaCategoria) campi += ', e_cliente, e_fornitore'

  const { data, error } = await sb.from('tm_contatti').select(campi).eq('azienda_id', currentAziendaId)
  if (error) {
    // Le tre colonne nuove sono il requisito minimo di questa app.
    if (/categorie|foto_url|referente/.test(String(error.message || ''))) {
      throw new Error('mancano le colonne categorie / foto_url / referente su tm_contatti. ' +
                      'Lancia sql/da_applicare/SQL_RUBRICA_00_colonne.sql in Supabase → SQL Editor.')
    }
    throw error
  }
  contatti = (data || []).sort(function (a, b) {
    return contattoNome(a).localeCompare(contattoNome(b), 'it', { sensitivity: 'base' })
  })
  return contatti
}

function contattoById(id) {
  return contatti.filter(function (c) { return c.id === id })[0] || null
}

// ─── Lettura delle categorie ─────────────────────────────────────────────────
// Tutte le righe dell'azienda, anche le disattivate: servono per dare il nome
// giusto ai contatti che le hanno ancora.
async function loadCategorie() {
  categorieErrore = null
  const { data, error } = await sb.from('rubrica_categorie')
    .select('id, nome, ordine, attiva')
    .eq('azienda_id', currentAziendaId)
    .order('ordine', { ascending: true })
  if (error) {
    categorieErrore = spiegaErrore(error)
    throw error
  }
  CATEGORIE = (data || []).map(rigaCategoria)
  ordinaCategorie()
  // Il filtro aperto su una categoria che non c'è più tra le attive torna a «Tutti».
  if (filtroCategoria !== 'tutti' && filtroCategoria !== 'archiviati' &&
      !categorieAttive().some(function (c) { return c.k === filtroCategoria })) {
    filtroCategoria = 'tutti'
  }
  return CATEGORIE
}

// ─── Viste ───────────────────────────────────────────────────────────────────
// Sullo schermo grande la scheda si apre accanto all'elenco, come nei CRM;
// sul telefono prende tutto lo schermo.
var MQ_SPLIT = window.matchMedia('(min-width: 1024px)')

function aggiornaSplit() {
  var split = vistaCorrente === 'scheda' && MQ_SPLIT.matches
  el('contenuto').classList.toggle('split', split)
  el('vista-lista').hidden = !(vistaCorrente === 'lista' || split)
  return split
}

function mostraVista(quale) {
  vistaCorrente = quale
  el('vista-scheda').hidden = quale !== 'scheda'
  el('vista-modulo').hidden = quale !== 'modulo'
  el('vista-categorie').hidden = quale !== 'categorie'
  var split = aggiornaSplit()
  if (quale === 'lista') {
    letturaId = null
    renderLista()
  } else {
    // Gli esiti («Contatto eliminato») stanno sull'elenco: altrove non servono.
    pulisciBanner('banner-globale')
    if (split) renderLista()   // per evidenziare il contatto aperto
  }
  if (!split) window.scrollTo(0, 0)
}

// ─── Elenco: ricerca, filtri, righe ──────────────────────────────────────────
function normalizzaTesto(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

function onRicerca() {
  testoRicerca = getVal('ricerca')
  if (el('ricerca-pulisci')) el('ricerca-pulisci').hidden = !testoRicerca
  renderLista()
}

function pulisciRicerca() {
  setVal('ricerca', '')
  onRicerca()
  var e = el('ricerca'); if (e) e.focus()
}

function impostaFiltro(k) {
  filtroCategoria = k
  renderLista()
}

// La ricerca guarda nome, cognome, ragione sociale e referente. Ogni parola
// scritta deve comparire da qualche parte: «rossi lugano» non trova nulla
// perché la città non è nel nome, ma «mario ros» trova Mario Rossi.
function corrispondeRicerca(c, parole) {
  if (!parole.length) return true
  var pagliaio = normalizzaTesto([c.ragione_sociale, c.nome, c.cognome, c.referente].filter(Boolean).join(' '))
  return parole.every(function (p) { return pagliaio.indexOf(p) !== -1 })
}

function renderLista() {
  var parole = normalizzaTesto(testoRicerca).split(/\s+/).filter(Boolean)
  var cercati = contatti.filter(function (c) { return corrispondeRicerca(c, parole) })
  var attivi = cercati.filter(function (c) { return c.attivo !== false })
  var archiviati = cercati.filter(function (c) { return c.attivo === false })

  // I pulsanti-filtro con i conteggi (sulla ricerca corrente): solo le
  // categorie attive. La chiave passa da data-k, non dentro l'onclick.
  var cats = categorieAttive()
  if (filtroCategoria !== 'tutti' && filtroCategoria !== 'archiviati' &&
      !cats.some(function (cat) { return cat.k === filtroCategoria })) {
    filtroCategoria = 'tutti'
  }
  var conteggi = {}
  cats.forEach(function (cat) { conteggi[cat.k] = 0 })
  attivi.forEach(function (c) {
    categorieDi(c).forEach(function (k) { if (k in conteggi) conteggi[k]++ })
  })
  var f = '<button type="button" role="tab" class="filtro' + (filtroCategoria === 'tutti' ? ' attivo' : '') + '"' +
            ' onclick="impostaFiltro(\'tutti\')">Tutti <span class="conta">' + attivi.length + '</span></button>'
  cats.forEach(function (cat) {
    f += '<button type="button" role="tab" class="filtro' + (filtroCategoria === cat.k ? ' attivo' : '') + '"' +
           ' style="' + cat.stile + '" data-k="' + esc(cat.k) + '" onclick="impostaFiltro(this.dataset.k)">' +
           '<i class="pallino"></i>' + esc(cat.n) +
           ' <span class="conta">' + conteggi[cat.k] + '</span></button>'
  })
  // Gli archiviati si vedono solo se ce ne sono, e solo chiedendolo.
  if (archiviati.length || filtroCategoria === 'archiviati') {
    f += '<button type="button" role="tab" class="filtro archiviati' + (filtroCategoria === 'archiviati' ? ' attivo' : '') + '"' +
           ' onclick="impostaFiltro(\'archiviati\')">' + icona('archivio') + 'Archiviati <span class="conta">' + archiviati.length + '</span></button>'
  }
  var box = el('filtri-categorie')
  var scorrimento = box ? box.scrollLeft : 0
  html('filtri-categorie', f)
  // Sul telefono i filtri scorrono di lato: ridisegnandoli non si torna all'inizio.
  if (box) box.scrollLeft = scorrimento

  var mostrati
  if (filtroCategoria === 'tutti') mostrati = attivi
  else if (filtroCategoria === 'archiviati') mostrati = archiviati
  else mostrati = attivi.filter(function (c) { return categorieDi(c).indexOf(filtroCategoria) !== -1 })

  var etichettaFiltro = filtroCategoria === 'tutti' ? 'Tutti i contatti'
    : filtroCategoria === 'archiviati' ? 'Contatti archiviati'
    : categoriaInfo(filtroCategoria).n
  html('lista-intestazione', esc(etichettaFiltro) + ' · ' + mostrati.length +
    (mostrati.length === 1 ? ' contatto' : ' contatti') +
    (testoRicerca ? ' per «' + esc(testoRicerca) + '»' : ''))

  if (!mostrati.length) {
    var msg = contatti.length === 0
      ? '<strong>La rubrica è vuota.</strong>Premi «Nuovo contatto» per iniziare.'
      : testoRicerca
        ? '<strong>Nessun contatto trovato.</strong>Prova con meno lettere, oppure cambia filtro.'
        : '<strong>Nessun contatto in questa categoria.</strong>Apri un contatto e spunta la categoria per farlo comparire qui.'
    html('lista-contatti', '<div class="vuoto">' + msg + '</div>')
    return
  }

  // Le lettere A, B, C… come nella rubrica del telefono. Solo per nome: in
  // ricerca l'ordine è lo stesso, quindi restano utili anche lì.
  var out = '', lettera = null
  mostrati.forEach(function (c) {
    var l = normalizzaTesto(contattoNome(c)).charAt(0).toUpperCase()
    if (!/[A-Z]/.test(l)) l = '#'
    if (l !== lettera) { out += '<div class="lettera">' + l + '</div>'; lettera = l }
    out += rigaHtml(c)
  })
  html('lista-contatti', out)
}

function rigaHtml(c) {
  var sub = []
  if (c.referente) sub.push(esc(c.referente))
  if (c.citta) sub.push(esc(c.citta))
  if (!sub.length && c.email) sub.push(esc(c.email))

  // I link tel: accanto a ogni numero. stopPropagation: toccare il telefono
  // deve chiamare, non aprire la scheda.
  var azioni = ''
  if (c.cellulare && telHref(c.cellulare)) {
    azioni += '<a class="btn-icona" href="' + esc(telHref(c.cellulare)) + '" title="Chiama cellulare ' + esc(c.cellulare) + '"' +
              ' aria-label="Chiama cellulare" onclick="event.stopPropagation()">' + icona('cellulare') + '</a>'
  }
  if (c.telefono && telHref(c.telefono)) {
    azioni += '<a class="btn-icona" href="' + esc(telHref(c.telefono)) + '" title="Chiama ' + esc(c.telefono) + '"' +
              ' aria-label="Chiama telefono" onclick="event.stopPropagation()">' + icona('telefono') + '</a>'
  }

  return '<div class="riga' + (c.attivo === false ? ' archiviata' : '') + (c.id === letturaId ? ' selezionata' : '') + '"' +
           ' tabindex="0" role="button"' +
           ' onclick="apriContatto(\'' + c.id + '\')"' +
           ' onkeydown="if(event.key===\'Enter\')apriContatto(\'' + c.id + '\')">' +
           avatarHtml(c) +
           '<div class="riga-main">' +
             '<div class="riga-nome">' + esc(contattoNome(c)) + '</div>' +
             (sub.length ? '<div class="riga-sub">' + sub.join(' · ') + '</div>' : '') +
             '<div class="riga-badges">' + badgesCategorie(c) + '</div>' +
           '</div>' +
           (azioni ? '<div class="riga-azioni">' + azioni + '</div>' : '') +
         '</div>'
}

// ─── Scheda in lettura ───────────────────────────────────────────────────────
function apriContatto(id) {
  var c = contattoById(id)
  if (!c) { mostraBanner('banner-globale', 'err', 'Contatto non trovato: ricarica la pagina.'); return }
  letturaId = id
  pulisciBanner('scheda-banner')
  html('scheda-contenuto', schedaHtml(c))
  mostraVista('scheda')
}

// Il numero per WhatsApp: internazionale, solo cifre, senza «+». Un numero
// scritto senza prefisso («079 …») prende quello del paese del contatto; se
// il paese non è fra questi non si indovina: niente pulsante WhatsApp.
var PREFISSI_PAESE = { CH: '41', IT: '39', DE: '49', FR: '33', AT: '43', LI: '423' }

function whatsappHref(numero, paese) {
  var s = String(numero || '').trim().replace(/\(0\)/g, '')
  var cifre = s.replace(/[^0-9]/g, '')
  if (!cifre) return ''
  if (s.charAt(0) === '+') return 'https://wa.me/' + cifre
  if (cifre.indexOf('00') === 0) return 'https://wa.me/' + cifre.slice(2)
  var pref = PREFISSI_PAESE[String(paese || PAESE_PREDEFINITO).toUpperCase()]
  if (!pref) return ''
  // In Italia lo 0 dei fissi fa parte del numero; altrove si toglie.
  return 'https://wa.me/' + pref + (pref === '39' ? cifre : cifre.replace(/^0/, ''))
}

// Google Maps apre l'app sia su Android sia su iPhone (se installata),
// altrimenti la pagina web.
function mappaHref(c) {
  var q = [c.indirizzo, [c.cap, c.citta].filter(Boolean).join(' '), nomePaese(c.paese)].filter(Boolean).join(', ')
  return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : ''
}

function azioneRapida(href, ico, etich, esterno) {
  return '<a class="azione" href="' + esc(href) + '"' + (esterno ? ' target="_blank" rel="noopener"' : '') + '>' +
           icona(ico) + '<span>' + etich + '</span></a>'
}

// Una riga della scheda: icona, etichetta piccola, valore. Con href tutta la
// riga si tocca (chiama, scrive, apre la mappa); con copia ha il pulsante «copia».
function infoRiga(ico, etich, valHtml, opz) {
  if (!valHtml) return ''
  opz = opz || {}
  var corpo = '<span class="info-ico">' + icona(ico) + '</span>' +
              '<div class="info-testo">' + (etich ? '<div class="info-etich">' + etich + '</div>' : '') +
                '<div class="info-val' + (opz.note ? ' note' : '') + '">' + valHtml + '</div></div>'
  if (opz.href) {
    return '<a class="info-riga" href="' + esc(opz.href) + '"' + (opz.esterno ? ' target="_blank" rel="noopener"' : '') + '>' +
             corpo + '<span class="info-coda">' + icona('avanti') + '</span></a>'
  }
  if (opz.copia) {
    return '<div class="info-riga">' + corpo +
             '<button type="button" class="btn-copia" title="Copia" aria-label="Copia ' + esc(etich) + '"' +
               ' data-t="' + esc(opz.copia) + '" data-n="' + esc(etich) + '" onclick="copiaTesto(this.dataset.t, this.dataset.n)">' +
               icona('copia') + '</button></div>'
  }
  return '<div class="info-riga">' + corpo + '</div>'
}

function gruppoHtml(titolo, righe) {
  return righe ? '<div class="gruppo"><div class="gruppo-titolo">' + titolo + '</div>' + righe + '</div>' : ''
}

async function copiaTesto(testo, nome) {
  try {
    await navigator.clipboard.writeText(testo)
    mostraBanner('scheda-banner', 'ok', nome + ' copiato.')
  } catch (_) {
    // Senza permesso agli appunti (http, browser vecchi) si ripiega su execCommand.
    var t = document.createElement('textarea')
    t.value = testo; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'
    document.body.appendChild(t); t.select()
    var ok = false
    try { ok = document.execCommand('copy') } catch (_) { ok = false }
    document.body.removeChild(t)
    mostraBanner('scheda-banner', ok ? 'ok' : 'warn', ok ? nome + ' copiato.' : 'Non riesco a copiare: tieni premuto sul testo e copialo a mano.')
  }
  setTimeout(function () {
    var b = el('scheda-banner')
    if (b && /copiato/.test(b.textContent)) pulisciBanner('scheda-banner')
  }, 2500)
}

function schedaHtml(c) {
  var citta = [c.cap, c.citta].filter(Boolean).join(' ')
  var indirizzo = [c.indirizzo, citta].filter(Boolean).map(esc).join('<br>')
  var paeseOk = !c.paese || paeseValido(c.paese)
  var paese = c.paese
    ? (paeseOk ? esc(nomePaese(c.paese))
               : '<span class="badge err">«' + esc(c.paese) + '» non valido — apri Modifica e scegli il paese</span>')
    : ''

  // Le azioni rapide sotto il nome, come nella rubrica del telefono.
  var azioni = []
  if (c.cellulare && telHref(c.cellulare)) azioni.push(azioneRapida(telHref(c.cellulare), 'cellulare', 'Cellulare'))
  if (c.telefono && telHref(c.telefono)) azioni.push(azioneRapida(telHref(c.telefono), 'telefono', 'Chiama'))
  var wa = c.cellulare ? whatsappHref(c.cellulare, c.paese) : ''
  if (wa) azioni.push(azioneRapida(wa, 'messaggio', 'WhatsApp', true))
  if (c.email) azioni.push(azioneRapida('mailto:' + c.email, 'email', 'Email'))
  var mappa = (c.indirizzo || c.citta) ? mappaHref(c) : ''
  if (mappa) azioni.push(azioneRapida(mappa, 'mappa', 'Mappa', true))

  var recapiti =
    infoRiga('cellulare', 'Cellulare', c.cellulare ? esc(c.cellulare) : '', { href: telHref(c.cellulare) }) +
    infoRiga('telefono', 'Telefono', c.telefono ? esc(c.telefono) : '', { href: telHref(c.telefono) }) +
    infoRiga('email', 'Email', c.email ? esc(c.email) : '', { href: c.email ? 'mailto:' + c.email : '' }) +
    infoRiga('sito', 'Sito web', c.sito_web ? esc(c.sito_web) : '', { href: urlSito(c.sito_web), esterno: true })

  var dove =
    infoRiga('mappa', 'Indirizzo', indirizzo, { href: mappa, esterno: true }) +
    infoRiga('sito', 'Paese', paese)

  var amministrativi =
    infoRiga('documento', 'UID / Partita IVA', c.uid_partita_iva ? '<span class="mono">' + esc(c.uid_partita_iva) + '</span>' : '',
             { copia: c.uid_partita_iva }) +
    infoRiga('banca', 'IBAN', c.iban ? '<span class="mono">' + esc(ibanLeggibile(c.iban)) + '</span>' : '',
             { copia: c.iban ? String(c.iban).replace(/\s+/g, '') : '' }) +
    infoRiga('orologio', 'Giorni di pagamento', c.giorni_pagamento == null ? '' : esc(c.giorni_pagamento + ' giorni'))

  var note = infoRiga('nota', '', c.note ? esc(c.note) : '', { note: true })

  var corpo = gruppoHtml('Recapiti', recapiti) + gruppoHtml('Sede', dove) +
              gruppoHtml('Dati amministrativi', amministrativi) + gruppoHtml('Note', note)

  var meta = []
  if (c.created_at) meta.push('Creato il ' + dataIt(c.created_at))
  if (c.updated_at && c.updated_at !== c.created_at) meta.push('modificato il ' + dataIt(c.updated_at))

  var sotto = []
  if (c.ragione_sociale && (c.nome || c.cognome)) sotto.push(esc([c.nome, c.cognome].filter(Boolean).join(' ')))
  if (c.referente) sotto.push('Referente: ' + esc(c.referente))

  return '<div class="scheda-testa">' +
           avatarHtml(c, true) +
           '<div class="scheda-nome">' + esc(contattoNome(c)) + '</div>' +
           (sotto.length ? '<div class="scheda-referente">' + sotto.join(' · ') + '</div>' : '') +
           '<div class="scheda-badges">' + badgesCategorie(c) + '</div>' +
         '</div>' +
         (azioni.length ? '<div class="azioni-rapide">' + azioni.join('') + '</div>' : '') +
         (corpo || '<div class="card dim">Nessun altro dato: tocca Modifica per completare la scheda.</div>') +
         (meta.length ? '<div class="scheda-meta">' + esc(meta.join(' · ')) + '</div>' : '') +
         '<div class="scheda-elimina">' +
           '<button type="button" class="btn-link" onclick="chiediElimina()">' + icona('elimina') + 'Elimina contatto</button>' +
         '</div>'
}

function dataIt(iso) {
  try { return new Date(iso).toLocaleDateString('it-CH') } catch (_) { return '' }
}

// ─── Eliminazione: rapida, una conferma inline e via ─────────────────────────
// Niente finestre modali: un banner con «Sì, elimina» e «Annulla». Se il
// contatto è nominato da fatture o movimenti in Pre-contabilità, il database
// rifiuta (vincolo di chiave esterna): allora si propone di archiviarlo, che è
// la stessa strada di Pre-contabilità.
function chiediElimina() {
  var c = contattoById(letturaId)
  if (!c) return
  html('scheda-banner', bannerHtml('err',
    '<strong>Eliminare ' + esc(contattoNome(c)) + '?</strong> L\'operazione non si annulla.',
    '<div class="banner-azioni">' +
      '<button type="button" class="btn-danger pieno" onclick="eliminaConfermato()">Sì, elimina</button>' +
      '<button type="button" class="btn-secondary" onclick="pulisciBanner(\'scheda-banner\')">Annulla</button>' +
    '</div>'))
  // «Elimina» sta in fondo alla scheda, la conferma in cima: la si porta in vista.
  el('scheda-banner').scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function eliminaConfermato() {
  var id = letturaId
  var c = contattoById(id)
  if (!c) return
  var nome = contattoNome(c)
  html('scheda-banner', '<div class="caricamento">Eliminazione…</div>')
  try {
    const { error } = await sb.from('tm_contatti').delete().eq('id', id).eq('azienda_id', currentAziendaId)
    if (error) throw error
    await cancellaFotoContatto(id)   // best-effort: se fallisce resta un file orfano, non un problema
    await loadContatti()
    mostraVista('lista')
    mostraBanner('banner-globale', 'ok', 'Contatto eliminato: ' + nome + '.')
  } catch (e) {
    console.warn('Elimina:', e)
    if (e && (e.code === '23503' || /foreign key|violates/i.test(String(e.message || '')))) {
      html('scheda-banner', bannerHtml('warn',
        '<strong>Non si può eliminare: è collegato a documenti in Pre-contabilità</strong> ' +
        '(fatture, acquisti o movimenti). Quei documenti devono continuare a dire a chi si riferiscono. ' +
        'Si può <strong>archiviare</strong>: sparisce dagli elenchi, i documenti restano leggibili.',
        '<div class="banner-azioni">' +
          '<button type="button" class="btn-primary" onclick="archiviaCorrente()">Archivia il contatto</button>' +
          '<button type="button" class="btn-secondary" onclick="pulisciBanner(\'scheda-banner\')">Annulla</button>' +
        '</div>'))
      return
    }
    mostraBanner('scheda-banner', 'err', 'Non eliminato: ' + spiegaErrore(e))
  }
}

async function archiviaCorrente() {
  var id = letturaId
  if (!id) return
  html('scheda-banner', '<div class="caricamento">Archiviazione…</div>')
  try {
    const { error } = await sb.from('tm_contatti').update({ attivo: false }).eq('id', id).eq('azienda_id', currentAziendaId)
    if (error) throw error
    await loadContatti()
    mostraVista('lista')
    mostraBanner('banner-globale', 'ok', 'Contatto archiviato: non compare più negli elenchi, lo ritrovi nel filtro «Archiviati».')
  } catch (e) {
    mostraBanner('scheda-banner', 'err', 'Non archiviato: ' + spiegaErrore(e))
  }
}

// ─── Modulo: nuovo / modifica ────────────────────────────────────────────────
// Le spunte sono le categorie attive. In più, già spuntate, quelle che il
// contatto ha e che non sono attive (disattivate o sparite dalla tabella):
// senza, salvando la scheda si perderebbero di nascosto.
function renderCategorieCheck(selezionate) {
  var sel = selezionate || []
  var voci = categorieAttive().slice()
  sel.forEach(function (k) {
    if (!voci.some(function (cat) { return cat.k === k })) voci.push(categoriaInfo(k))
  })
  if (!voci.length) {
    html('c-categorie', '<div class="dim">Nessuna categoria attiva: aggiungile da «Gestisci categorie».</div>')
    return
  }
  html('c-categorie', voci.map(function (cat) {
    return '<label class="chip-cat' + (cat.attiva ? '' : ' spenta') + '"' +
             (cat.attiva ? '' : ' title="Categoria disattivata: togli la spunta per toglierla dal contatto"') + '>' +
             '<input type="checkbox" name="c-cat" value="' + esc(cat.k) + '"' + (sel.indexOf(cat.k) !== -1 ? ' checked' : '') + ' />' +
             '<span class="chip-corpo" style="' + cat.stile + '">' +
               '<i class="pallino"></i><span class="spunta">' + icona('spunta') + '</span>' + esc(cat.n) +
               (cat.attiva ? '' : ' <span class="dim">(disattivata)</span>') +
             '</span>' +
           '</label>'
  }).join(''))
}

function categorieSpuntate() {
  return Array.prototype.slice.call(document.querySelectorAll('input[name="c-cat"]:checked'))
    .map(function (i) { return i.value })
}

function azzeraModulo() {
  ;['c-ragione', 'c-nome', 'c-cognome', 'c-referente', 'c-indirizzo', 'c-cap', 'c-citta',
    'c-telefono', 'c-cellulare', 'c-email', 'c-sito', 'c-uid', 'c-iban', 'c-giorni', 'c-note']
    .forEach(function (id) { setVal(id, '') })
  if (el('c-attivo')) el('c-attivo').checked = true
  if (el('c-foto')) el('c-foto').value = ''
  fotoPendente = null
  fotoDaTogliere = false
  forzaSalvataggio = false
  pulisciBanner('modulo-banner')
}

function nuovoContatto() {
  editingId = null
  azzeraModulo()
  renderCategorieCheck(filtroCategoria !== 'tutti' && filtroCategoria !== 'archiviati' ? [filtroCategoria] : [])
  el('c-paese').innerHTML = buildPaeseOptions(PAESE_PREDEFINITO)
  el('c-attivo-riga').hidden = true
  el('modulo-titolo').textContent = 'Nuovo contatto'
  el('modulo-salva-btn').textContent = 'Salva contatto'
  renderFotoAnteprima(null)
  aggiornaLinkRecapiti()
  mostraVista('modulo')
  setTimeout(function () { el('c-ragione').focus() }, 50)
}

function modificaContattoCorrente() {
  if (letturaId) modificaContatto(letturaId)
}

function modificaContatto(id) {
  var c = contattoById(id)
  if (!c) { mostraBanner('banner-globale', 'err', 'Contatto non trovato: ricarica la pagina.'); return }
  editingId = id
  azzeraModulo()
  setVal('c-ragione', c.ragione_sociale)
  setVal('c-nome', c.nome)
  setVal('c-cognome', c.cognome)
  setVal('c-referente', c.referente)
  setVal('c-indirizzo', c.indirizzo)
  setVal('c-cap', c.cap)
  setVal('c-citta', c.citta)
  el('c-paese').innerHTML = buildPaeseOptions(c.paese || PAESE_PREDEFINITO)
  setVal('c-telefono', c.telefono)
  setVal('c-cellulare', c.cellulare)
  setVal('c-email', c.email)
  setVal('c-sito', c.sito_web)
  setVal('c-uid', c.uid_partita_iva)
  setVal('c-iban', c.iban ? ibanLeggibile(c.iban) : '')
  setVal('c-giorni', c.giorni_pagamento == null ? '' : c.giorni_pagamento)
  setVal('c-note', c.note)
  el('c-attivo').checked = c.attivo !== false
  el('c-attivo-riga').hidden = false
  renderCategorieCheck(categorieDi(c))
  // Un cliente di Pre-contabilità senza categorie nuove: lo si dice, così chi
  // apre la scheda sa perché non compare in nessun filtro.
  if (c.categoria === 'cliente' && !Array.isArray(c.categorie)) {
    mostraBanner('modulo-banner', 'info',
      'In Pre-contabilità questo contatto è un «cliente». Spunta Preventivi, Appalti presi o Appalti conclusi per collocarlo.')
  }
  el('modulo-titolo').textContent = contattoNome(c)
  el('modulo-salva-btn').textContent = 'Salva modifiche'
  renderFotoAnteprima(c.foto_url ? { url: c.foto_url } : null, c)
  aggiornaLinkRecapiti()
  mostraVista('modulo')
}

function annullaModulo() {
  var id = editingId
  editingId = null
  azzeraModulo()
  if (id && contattoById(id)) apriContatto(id)
  else mostraVista('lista')
}

// Il titolo del modulo segue quello che si scrive: si vede subito con che
// nome il contatto comparirà in elenco.
function aggiornaAnteprimaNome() {
  var finto = { ragione_sociale: getVal('c-ragione'), nome: getVal('c-nome'), cognome: getVal('c-cognome') }
  if (!editingId) el('modulo-titolo').textContent = contattoNome(finto) || 'Nuovo contatto'
  // Le iniziali nel tondo seguono il nome, ma solo se nel tondo non c'è una foto.
  var esistente = editingId ? contattoById(editingId) : null
  var haFoto = !!fotoPendente || (esistente && esistente.foto_url && !fotoDaTogliere)
  if (!haFoto) renderFotoAnteprima(null, finto)
}

// I pulsanti «chiama» accanto ai campi si accendono mentre si scrive il numero.
function aggiornaLinkRecapiti() {
  ;[['c-telefono', 'c-telefono-link'], ['c-cellulare', 'c-cellulare-link']].forEach(function (p) {
    var a = el(p[1])
    if (!a) return
    var href = telHref(getVal(p[0]))
    a.hidden = !href
    a.href = href || '#'
  })
}

// ─── Foto ────────────────────────────────────────────────────────────────────
function renderFotoAnteprima(foto, c) {
  var box = el('foto-anteprima')
  var btnTogli = el('c-foto-rimuovi')
  if (!box) return
  if (foto && foto.url) {
    box.className = 'foto-anteprima'
    box.setAttribute('style', '')
    box.innerHTML = '<img src="' + esc(foto.url) + '" alt="Foto del contatto" />'
    if (btnTogli) btnTogli.hidden = false
    return
  }
  var finto = c || { ragione_sociale: getVal('c-ragione'), nome: getVal('c-nome'), cognome: getVal('c-cognome') }
  var ini = contattoNome(finto) ? iniziali(finto) : ''
  if (ini) {
    box.className = 'foto-anteprima'
    box.setAttribute('style', stileAvatar(finto))
    box.textContent = ini
  } else {
    box.className = 'foto-anteprima vuota'
    box.setAttribute('style', '')
    box.innerHTML = icona('foto')
  }
  if (btnTogli) btnTogli.hidden = true
}

function onFotoScelta(input) {
  var file = input.files && input.files[0]
  if (!file) return
  if (!/^image\//.test(file.type)) {
    mostraBanner('modulo-banner', 'err', 'Il file scelto non è un\'immagine.')
    input.value = ''
    return
  }
  fotoPendente = file
  fotoDaTogliere = false
  var reader = new FileReader()
  reader.onload = function (ev) { renderFotoAnteprima({ url: ev.target.result }) }
  reader.readAsDataURL(file)
}

function rimuoviFoto() {
  fotoPendente = null
  fotoDaTogliere = true
  if (el('c-foto')) el('c-foto').value = ''
  renderFotoAnteprima(null)
}

// La foto si riduce nel browser prima di salirla: una foto da telefono pesa
// 3-5 MB, per un avatar ne bastano 800 px. Se la riduzione non riesce (formato
// strano) si carica il file com'è.
function ridimensionaFoto(file, maxLato) {
  return new Promise(function (resolve) {
    var url = URL.createObjectURL(file)
    var img = new Image()
    img.onload = function () {
      try {
        var w = img.naturalWidth, h = img.naturalHeight
        var scala = Math.min(1, maxLato / Math.max(w, h))
        var cw = Math.max(1, Math.round(w * scala)), ch = Math.max(1, Math.round(h * scala))
        var canvas = document.createElement('canvas')
        canvas.width = cw; canvas.height = ch
        canvas.getContext('2d').drawImage(img, 0, 0, cw, ch)
        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url)
          if (blob) resolve({ blob: blob, ext: 'jpg', tipo: 'image/jpeg' })
          else resolve(fileOriginale())
        }, 'image/jpeg', 0.85)
      } catch (_) {
        URL.revokeObjectURL(url)
        resolve(fileOriginale())
      }
    }
    img.onerror = function () { URL.revokeObjectURL(url); resolve(fileOriginale()) }
    img.src = url

    function fileOriginale() {
      var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
      return { blob: file, ext: ext, tipo: file.type || 'application/octet-stream' }
    }
  })
}

// Il percorso nel bucket è <id_contatto>/<timestamp>.<estensione>: mai il
// nome del contatto, che può cambiare, avere accenti o essere uguale a un altro.
async function caricaFoto(contattoId, file) {
  var f = await ridimensionaFoto(file, 800)
  var path = contattoId + '/' + Date.now() + '.' + f.ext
  const { error } = await sb.storage.from(BUCKET_FOTO).upload(path, f.blob, { contentType: f.tipo, upsert: false })
  if (error) throw error
  const { data } = sb.storage.from(BUCKET_FOTO).getPublicUrl(path)
  return data.publicUrl
}

// Dal foto_url salvato si ricava il percorso nel bucket, per cancellare il file.
function pathDaFotoUrl(url) {
  var m = String(url || '').match(/\/object\/(?:public|sign|authenticated)\/rubrica-foto\/([^?#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

async function cancellaFotoFile(url) {
  var p = pathDaFotoUrl(url)
  if (!p) return
  try { await sb.storage.from(BUCKET_FOTO).remove([p]) } catch (e) { console.warn('Foto non rimossa:', e) }
}

async function cancellaFotoContatto(contattoId) {
  try {
    const { data } = await sb.storage.from(BUCKET_FOTO).list(contattoId)
    var paths = (data || []).map(function (f) { return contattoId + '/' + f.name })
    if (paths.length) await sb.storage.from(BUCKET_FOTO).remove(paths)
  } catch (e) { console.warn('Foto del contatto non rimosse:', e) }
}

// ─── Raccolta e controllo del modulo ─────────────────────────────────────────
function raccogliContatto() {
  var ragione = getVal('c-ragione'), nome = getVal('c-nome'), cognome = getVal('c-cognome')
  if (!ragione && !nome && !cognome) {
    throw new Error('Serve almeno la ragione sociale oppure nome e cognome: è il nome con cui il contatto compare in elenco.')
  }
  var giorni = getVal('c-giorni')
  var giorniNum = giorni === '' ? null : parseInt(giorni, 10)
  if (giorniNum != null && (isNaN(giorniNum) || giorniNum < 0 || giorniNum > 365)) {
    throw new Error('I giorni di pagamento devono essere un numero fra 0 e 365.')
  }
  var paese = getVal('c-paese').toUpperCase()
  if (!paeseValido(paese)) {
    throw new Error('Scegli il paese dalla tendina: «' + paese + '» non è un codice valido.')
  }
  var email = getVal('c-email')
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('L\'email non sembra corretta: manca la chiocciola o il dominio.')
  }

  var cats = categorieSpuntate()
  var payload = {
    azienda_id:       currentAziendaId,
    categorie:        cats,
    ragione_sociale:  ragione || null,
    nome:             nome || null,
    cognome:          cognome || null,
    referente:        getVal('c-referente') || null,
    indirizzo:        getVal('c-indirizzo') || null,
    cap:              getVal('c-cap') || null,
    citta:            getVal('c-citta') || null,
    paese:            paese,
    telefono:         getVal('c-telefono') || null,
    email:            email || null,
    sito_web:         getVal('c-sito') || null,
    uid_partita_iva:  getVal('c-uid') || null,
    iban:             getVal('c-iban') ? getVal('c-iban').replace(/\s/g, '').toUpperCase() : null,
    giorni_pagamento: giorniNum,
    note:             getVal('c-note') || null,
    attivo:           editingId ? el('c-attivo').checked : true
  }
  if (colonneOpzionali.cellulare) payload.cellulare = getVal('c-cellulare') || null

  // La categoria «vecchia» di Pre-contabilità (una sola, obbligatoria) si tiene
  // allineata a quelle nuove, così le sue schede Clienti/Fornitori restano
  // giuste: preventivi e appalti sono clienti, fornitori e collaboratori sono
  // quello che dicono. Un solo caso in cui NON si tocca: un «cliente» di
  // Pre-contabilità mai categorizzato qui che viene salvato senza spuntare
  // niente — toglierlo dai clienti dell'altra app sarebbe un effetto che chi
  // salva non ha chiesto.
  var legacy = categoriaLegacy(cats)
  var esistente = editingId ? contattoById(editingId) : null
  var clienteDaProteggere = legacy.categoria === 'generico' && esistente &&
                            esistente.categoria === 'cliente' && !Array.isArray(esistente.categorie)
  if (!clienteDaProteggere) {
    payload.categoria = legacy.categoria
    if (colonneOpzionali.doppiaCategoria) {
      payload.e_cliente = legacy.e_cliente
      payload.e_fornitore = legacy.e_fornitore
    }
  }
  return payload
}

function categoriaLegacy(cats) {
  var cliente = ['preventivi', 'appalti_presi', 'appalti_conclusi'].some(function (k) { return cats.indexOf(k) !== -1 })
  var fornitore = cats.indexOf('fornitori') !== -1
  var collab = cats.indexOf('collaboratori') !== -1
  var categoria = cliente ? 'cliente' : fornitore ? 'fornitore' : collab ? 'collaboratore' : 'generico'
  return {
    categoria: categoria,
    e_cliente: cliente && categoria !== 'cliente',
    e_fornitore: fornitore && categoria !== 'fornitore'
  }
}

// ─── Avviso omonimi: mai un blocco ───────────────────────────────────────────
// Stesso criterio di Pre-contabilità (FASE 18): le forme societarie non
// distinguono due ditte («Bianchi SA» e «Bianchi Sagl»), accenti e punteggiatura
// nemmeno. Stesso UID = quasi certamente lo stesso soggetto. Ma si avvisa e
// basta: gli omonimi esistono, e lo stesso soggetto con due IBAN si registra
// due volte. Decide chi salva.
var FORME_SOCIETARIE = /\b(sa|sagl|srl|sarl|ag|gmbh|spa|snc|sas)\b/g

function normalizzaNomeContatto(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\./g, '')
    .replace(/[,;:'’"`()\[\]\/\\-]/g, ' ')
    .replace(FORME_SOCIETARIE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizzaUid(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function cercaContattiSimili(payload) {
  var nome = normalizzaNomeContatto(payload.ragione_sociale ||
                                    [payload.cognome, payload.nome].filter(Boolean).join(' '))
  var nomeInv = normalizzaNomeContatto([payload.nome, payload.cognome].filter(Boolean).join(' '))
  var uid = normalizzaUid(payload.uid_partita_iva)
  var fuori = []
  contatti.forEach(function (x) {
    if (x.id === editingId) return
    var uidUguale = !!uid && normalizzaUid(x.uid_partita_iva) === uid
    var nx = normalizzaNomeContatto(contattoNome(x))
    var nomeUguale = !!nome && (nx === nome || (!!nomeInv && nx === nomeInv))
    if (uidUguale || nomeUguale) fuori.push({ c: x, forte: uidUguale })
  })
  return fuori
}

function mostraAvvisoDoppione(simili) {
  var forte = simili.some(function (s) { return s.forte })
  var righe = simili.map(function (s) {
    var x = s.c
    var dettagli = [x.citta, x.telefono, x.cellulare].filter(Boolean).join(' · ')
    return '<div class="dop-riga">' +
             '<div>' +
               '<strong>' + esc(contattoNome(x)) + '</strong> ' +
               (s.forte ? '<span class="badge err">stesso UID</span>' : '<span class="badge warn">stesso nome</span>') +
               (x.attivo === false ? ' <span class="badge warn">archiviato</span>' : '') +
               '<div class="dim">' + esc(dettagli || 'nessun recapito registrato') + '</div>' +
             '</div>' +
             '<button type="button" class="btn-secondary btn-piccolo" onclick="apriContattoDaAvviso(\'' + x.id + '\')">Apri</button>' +
           '</div>'
  }).join('')

  html('modulo-banner', bannerHtml(forte ? 'err' : 'warn',
    '<strong>' + (forte ? 'C\'è già un contatto con lo stesso UID / partita IVA.'
                        : 'C\'è già un contatto con un nome molto simile.') + '</strong> ' +
    (forte ? 'Due ditte diverse non hanno lo stesso UID: quasi sicuramente è lo stesso soggetto.'
           : 'Può essere un omonimo, oppure lo stesso soggetto già in rubrica.') +
    ' Decidi tu: il programma non salva e non scarta niente da solo.',
    '<div class="dop-lista">' + righe + '</div>' +
    '<div class="banner-azioni">' +
      '<button type="button" class="btn-primary" onclick="salvaComunque()">Salva comunque</button>' +
      '<button type="button" class="btn-secondary" onclick="pulisciBanner(\'modulo-banner\')">Correggo</button>' +
    '</div>'))
  el('modulo-banner').scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function salvaComunque() {
  forzaSalvataggio = true
  return salvaContatto()
}

function apriContattoDaAvviso(id) {
  forzaSalvataggio = false
  editingId = null
  azzeraModulo()
  apriContatto(id)
}

// ─── Salvataggio ─────────────────────────────────────────────────────────────
async function salvaContatto(event) {
  if (event) event.preventDefault()
  var btn = el('modulo-salva-btn')
  var testoBtn = btn ? btn.textContent : ''
  pulisciBanner('modulo-banner')
  try {
    var payload = raccogliContatto()

    if (!forzaSalvataggio) {
      var simili = cercaContattiSimili(payload)
      if (simili.length) { mostraAvvisoDoppione(simili); return false }
    }
    forzaSalvataggio = false

    if (btn) { btn.disabled = true; btn.textContent = 'Salvataggio…' }

    var id = editingId
    var fotoUrlPrecedente = id && contattoById(id) ? contattoById(id).foto_url : null

    if (id) {
      if (fotoDaTogliere && !fotoPendente) payload.foto_url = null
      const { error } = await sb.from('tm_contatti').update(payload).eq('id', id).eq('azienda_id', currentAziendaId)
      if (error) throw error
    } else {
      const { data, error } = await sb.from('tm_contatti').insert(payload).select('id').single()
      if (error) throw error
      id = data.id
    }

    // La foto dopo il contatto: il percorso nel bucket vuole l'id, e per un
    // contatto nuovo l'id esiste solo dopo l'insert.
    var avvisoFoto = ''
    if (fotoPendente) {
      try {
        var url = await caricaFoto(id, fotoPendente)
        const { error: errFoto } = await sb.from('tm_contatti').update({ foto_url: url }).eq('id', id).eq('azienda_id', currentAziendaId)
        if (errFoto) throw errFoto
        if (fotoUrlPrecedente) await cancellaFotoFile(fotoUrlPrecedente)
      } catch (ef) {
        console.warn('Foto:', ef)
        avvisoFoto = ' La foto però non è stata caricata: ' + spiegaErroreFoto(ef)
      }
    } else if (fotoDaTogliere && fotoUrlPrecedente) {
      await cancellaFotoFile(fotoUrlPrecedente)
    }

    await loadContatti()
    editingId = null
    fotoPendente = null
    fotoDaTogliere = false
    apriContatto(id)
    mostraBanner('scheda-banner', avvisoFoto ? 'warn' : 'ok',
      'Contatto salvato: ' + contattoNome(payload) + '.' + avvisoFoto)
  } catch (e) {
    console.warn('Salva:', e)
    mostraBanner('modulo-banner', 'err', 'Non salvato: ' + spiegaErrore(e))
    el('modulo-banner').scrollIntoView({ behavior: 'smooth', block: 'center' })
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = testoBtn || 'Salva contatto' }
  }
  return false
}

// ─── Gestisci categorie ──────────────────────────────────────────────────────
// Rinominare cambia solo `nome`; aggiungere crea un id leggibile dal nome e non
// sovrascrive mai un id che c'è già; disattivare mette attiva = false. Nessuna
// riga si cancella. Dopo ogni modifica la lista in memoria è già aggiornata:
// filtri e spunte la usano subito, senza ricaricare niente.
async function apriGestioneCategorie() {
  pulisciBanner('categorie-banner')
  setVal('cat-nuovo-nome', '')
  aggiornaIdNuovaCategoria()
  renderGestioneCategorie()
  mostraVista('categorie')
  // Si rilegge la tabella: qualcun altro può averla cambiata nel frattempo.
  try {
    await loadCategorie()
  } catch (e) {
    mostraBanner('categorie-banner', 'err', 'Non riesco a leggere le categorie (rubrica_categorie): ' + spiegaErrore(e))
  }
  renderGestioneCategorie()
}

// "Geometri" → "geometri", "Appalti presi" → "appalti_presi", "Caffè & Bar" → "caffe_bar".
function slugCategoria(nome) {
  return String(nome || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '')
}

function aggiornaIdNuovaCategoria() {
  var nome = getVal('cat-nuovo-nome')
  var id = slugCategoria(nome)
  var esistente = id ? CATEGORIE.filter(function (c) { return c.k === id })[0] : null
  html('cat-nuovo-id', !nome ? 'L\'id interno si ricava dal nome e non cambia più, nemmeno rinominando.'
    : !id ? 'Il nome deve contenere almeno una lettera o una cifra.'
    : esistente ? 'L\'id <span class="mono">' + esc(id) + '</span> esiste già («' + esc(esistente.n) + '»' +
                  (esistente.attiva ? '' : ', disattivata') + ').'
    : 'Id interno: <span class="mono">' + esc(id) + '</span>')
}

function contaContattiCategoria(k) {
  return contatti.filter(function (c) { return categorieDi(c).indexOf(k) !== -1 }).length
}

function renderGestioneCategorie() {
  if (!CATEGORIE.length) {
    html('categorie-elenco', '<div class="vuoto">' + (categorieErrore
      ? '<strong>Categorie non disponibili.</strong>' + esc(categorieErrore)
      : '<strong>Nessuna categoria.</strong>Aggiungine una qui sopra.') + '</div>')
    return
  }
  html('categorie-elenco', CATEGORIE.map(function (cat) {
    var n = contaContattiCategoria(cat.k)
    // Il nome si cambia dove sta; «Salva nome» compare solo se è cambiato.
    // Invio salva, Esc rimette il nome di prima.
    return '<div class="cat-riga' + (cat.attiva ? '' : ' spenta') + '" style="' + cat.stile + '">' +
             '<i class="pallino"></i>' +
             '<div class="cat-main">' +
               '<input type="text" maxlength="60" aria-label="Nome della categoria" value="' + esc(cat.n) + '"' +
                 ' data-cat-nome="' + esc(cat.k) + '" enterkeyhint="done"' +
                 ' oninput="segnaNomeCambiato(this)"' +
                 ' onkeydown="tastoNomeCategoria(event, this)" />' +
               '<div class="cat-meta">' + n + (n === 1 ? ' contatto' : ' contatti') +
                 ' · <span class="mono">' + esc(cat.k) + '</span>' +
                 (cat.attiva ? '' : ' · <span class="badge spenta">disattivata</span>') +
               '</div>' +
             '</div>' +
             '<div class="cat-comandi">' +
               '<button type="button" class="btn-primary btn-piccolo cat-salva" data-k="' + esc(cat.k) + '"' +
                 ' onclick="rinominaCategoria(this.dataset.k)">Salva nome</button>' +
               (cat.attiva
                 ? '<button type="button" class="btn-secondary btn-piccolo" data-k="' + esc(cat.k) + '" onclick="impostaCategoriaAttiva(this.dataset.k, false)">Disattiva</button>'
                 : '<button type="button" class="btn-secondary btn-piccolo" data-k="' + esc(cat.k) + '" onclick="impostaCategoriaAttiva(this.dataset.k, true)">Riattiva</button>') +
             '</div>' +
           '</div>'
  }).join(''))
}

function segnaNomeCambiato(input) {
  var riga = input.closest('.cat-riga')
  if (riga) riga.classList.toggle('modificata', input.value.trim() !== input.defaultValue.trim())
}

function tastoNomeCategoria(ev, input) {
  if (ev.key === 'Enter') {
    ev.preventDefault()
    rinominaCategoria(input.dataset.catNome)
  } else if (ev.key === 'Escape') {
    // Qui Esc annulla la modifica del nome, non chiude la pagina.
    ev.stopPropagation()
    input.value = input.defaultValue
    segnaNomeCambiato(input)
    input.blur()
  }
}

function inputNomeCategoria(k) {
  return Array.prototype.slice.call(document.querySelectorAll('[data-cat-nome]'))
    .filter(function (i) { return i.dataset.catNome === k })[0] || null
}

// Un update che la RLS non lascia passare non dà errore: torna zero righe.
// Per questo si chiede la riga indietro e si controlla che ci sia.
async function aggiornaRigaCategoria(k, campi) {
  const { data, error } = await sb.from('rubrica_categorie').update(campi)
    .eq('id', k).eq('azienda_id', currentAziendaId)
    .select('id, nome, ordine, attiva')
  if (error) throw error
  if (!data || !data.length) {
    throw new Error('il database non ha aggiornato nessuna riga (permessi su rubrica_categorie?).')
  }
  return data[0]
}

function sostituisciCategoria(riga) {
  var nuova = rigaCategoria(riga)
  CATEGORIE = CATEGORIE.map(function (c) { return c.k === nuova.k ? nuova : c })
  ordinaCategorie()
  return nuova
}

async function rinominaCategoria(k) {
  var cat = CATEGORIE.filter(function (c) { return c.k === k })[0]
  var input = inputNomeCategoria(k)
  if (!cat || !input) return
  var nome = input.value.trim()
  if (!nome) {
    mostraBanner('categorie-banner', 'err', 'Il nome non può essere vuoto.')
    input.value = cat.n
    return
  }
  if (nome === cat.n) {
    mostraBanner('categorie-banner', 'info', '«' + nome + '»: il nome è già questo, niente da salvare.')
    return
  }
  var doppia = CATEGORIE.filter(function (c) { return c.k !== k && normalizzaTesto(c.n) === normalizzaTesto(nome) })[0]
  if (doppia) {
    mostraBanner('categorie-banner', 'warn', 'C\'è già una categoria che si chiama «' + doppia.n + '»' +
      (doppia.attiva ? '' : ' (disattivata)') + ': scegli un nome diverso.')
    input.focus()
    return
  }
  var vecchio = cat.n
  html('categorie-banner', '<div class="caricamento">Rinomino…</div>')
  try {
    sostituisciCategoria(await aggiornaRigaCategoria(k, { nome: nome }))
    renderGestioneCategorie()
    var n = contaContattiCategoria(k)
    mostraBanner('categorie-banner', 'ok', 'Rinominata: «' + vecchio + '» → «' + nome + '». ' +
      (n ? (n === 1 ? 'Il contatto che l\'aveva la mostra' : 'I ' + n + ' contatti che l\'avevano la mostrano') + ' già col nome nuovo.'
         : 'Nessun contatto la usa ancora.'))
  } catch (e) {
    console.warn('Rinomina categoria:', e)
    mostraBanner('categorie-banner', 'err', 'Non rinominata: ' + spiegaErrore(e))
  }
}

async function impostaCategoriaAttiva(k, attiva) {
  var cat = CATEGORIE.filter(function (c) { return c.k === k })[0]
  if (!cat) return
  html('categorie-banner', '<div class="caricamento">' + (attiva ? 'Riattivo' : 'Disattivo') + '…</div>')
  try {
    var nuova = sostituisciCategoria(await aggiornaRigaCategoria(k, { attiva: attiva }))
    if (!attiva && filtroCategoria === k) filtroCategoria = 'tutti'
    renderGestioneCategorie()
    var n = contaContattiCategoria(k)
    mostraBanner('categorie-banner', 'ok', attiva
      ? '«' + nuova.n + '» è di nuovo attiva: torna fra i filtri e nelle spunte.'
      : '«' + nuova.n + '» disattivata: non si offre più ai contatti. ' +
        (n ? (n === 1 ? 'Il contatto che l\'aveva la conserva' : 'I ' + n + ' contatti che l\'avevano la conservano') +
             ' e la vedono nella scheda.' : ''))
  } catch (e) {
    console.warn('Attiva/disattiva categoria:', e)
    mostraBanner('categorie-banner', 'err', 'Non modificata: ' + spiegaErrore(e))
  }
}

async function aggiungiCategoria(event) {
  if (event) event.preventDefault()
  var nome = getVal('cat-nuovo-nome')
  var id = slugCategoria(nome)
  if (!nome) {
    mostraBanner('categorie-banner', 'err', 'Scrivi il nome della categoria nuova.')
    return false
  }
  if (!id) {
    mostraBanner('categorie-banner', 'err', 'Il nome deve contenere almeno una lettera o una cifra: da lì si ricava l\'id.')
    return false
  }
  // Mai sovrascrivere: se l'id c'è già (anche disattivato) si avvisa e basta.
  var esistente = CATEGORIE.filter(function (c) { return c.k === id })[0]
  if (esistente) {
    mostraBanner('categorie-banner', 'warn', 'Esiste già una categoria con id «' + id + '»: «' + esistente.n + '»' +
      (esistente.attiva ? '. Non la sovrascrivo: scegli un nome diverso.'
                        : ', disattivata. Non la sovrascrivo: se è quella che cerchi, premi «Riattiva» nell\'elenco.'))
    return false
  }
  var doppia = CATEGORIE.filter(function (c) { return normalizzaTesto(c.n) === normalizzaTesto(nome) })[0]
  if (doppia) {
    mostraBanner('categorie-banner', 'warn', 'C\'è già una categoria che si chiama «' + doppia.n + '»: scegli un nome diverso.')
    return false
  }
  var ordine = CATEGORIE.reduce(function (m, c) { return c.ordine != null && c.ordine > m ? c.ordine : m }, 0) + 1
  var btn = el('cat-aggiungi-btn')
  if (btn) btn.disabled = true
  try {
    const { data, error } = await sb.from('rubrica_categorie')
      .insert({ id: id, azienda_id: currentAziendaId, nome: nome, ordine: ordine, attiva: true })
      .select('id, nome, ordine, attiva').single()
    if (error) throw error
    CATEGORIE.push(rigaCategoria(data))
    ordinaCategorie()
    setVal('cat-nuovo-nome', '')
    aggiornaIdNuovaCategoria()
    renderGestioneCategorie()
    mostraBanner('categorie-banner', 'ok', 'Categoria «' + nome + '» aggiunta (id ' + id + '): è già fra i filtri e nelle spunte dei contatti.')
  } catch (e) {
    console.warn('Aggiungi categoria:', e)
    if (e && (e.code === '23505' || /duplicate key|unique/i.test(String(e.message || '')))) {
      mostraBanner('categorie-banner', 'warn', 'L\'id «' + id + '» esiste già nel database: non lo sovrascrivo. Scegli un nome diverso.')
    } else {
      mostraBanner('categorie-banner', 'err', 'Non aggiunta: ' + spiegaErrore(e))
    }
  } finally {
    if (btn) btn.disabled = false
  }
  return false
}

// ─── Errori in parole ────────────────────────────────────────────────────────
function spiegaErrore(e) {
  var m = (e && (e.message || e.msg)) ? String(e.message || e.msg) : String(e)
  if (/tm_contatti_ha_un_nome/.test(m)) return 'serve almeno la ragione sociale oppure un nome.'
  if (/giorni_pagamento/.test(m) && /check/i.test(m)) return 'i giorni di pagamento non possono essere negativi.'
  if (/categoria/.test(m) && /check/i.test(m)) return 'categoria non ammessa dal database (controlla il vincolo su tm_contatti.categoria).'
  if (/categorie/.test(m) && /check/i.test(m)) return 'una categoria scelta non è ammessa dal vincolo su tm_contatti.categorie: allinea il vincolo agli id di rubrica_categorie.'
  if (/value too long/i.test(m)) return 'un campo è troppo lungo per il database (il paese, per esempio, deve essere il codice a due lettere).'
  if (/row-level security|violates row-level|permission denied/i.test(m)) {
    return 'il database ha rifiutato l\'operazione (regole di sicurezza). Rifai il login e riprova; se resta così, segnalalo.'
  }
  if (/JWT|expired|not authenticated/i.test(m)) return 'la sessione è scaduta: esci e rientra.'
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'non riesco a raggiungere il server: controlla la connessione.'
  return m
}

function spiegaErroreFoto(e) {
  var m = (e && (e.message || e.error)) ? String(e.message || e.error) : String(e)
  if (/bucket not found/i.test(m)) {
    return 'il bucket «' + BUCKET_FOTO + '» non esiste ancora. Lancia sql/da_applicare/SQL_RUBRICA_01_storage.sql in Supabase.'
  }
  if (/row-level security|policy|unauthorized|403/i.test(m)) {
    return 'il bucket rifiuta il caricamento (permessi Storage). Controlla le policy di SQL_RUBRICA_01_storage.sql.'
  }
  if (/too large|payload/i.test(m)) return 'il file è troppo grande.'
  return m
}
