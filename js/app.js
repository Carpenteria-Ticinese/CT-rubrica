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
const APP_VERSIONE = 1

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

// ─── Le sette categorie ──────────────────────────────────────────────────────
// Nel database stanno in tm_contatti.categorie (text[]) con la chiave `k`.
// Un contatto ne può avere più di una: compare in ogni filtro che ha spuntato.
var CATEGORIE = [
  { k: 'fornitori',         n: 'Fornitori',           i: '🏭' },
  { k: 'collaboratori',     n: 'Collaboratori',       i: '🤝' },
  { k: 'preventivi',        n: 'Preventivi',          i: '📝' },
  { k: 'appalti_presi',     n: 'Appalti presi',       i: '🏗️' },
  { k: 'appalti_conclusi',  n: 'Appalti conclusi',    i: '✅' },
  { k: 'marketing_servizi', n: 'Marketing e servizi', i: '📣' },
  { k: 'altro',             n: 'Altro',               i: '📁' }
]

function categoriaInfo(k) {
  return CATEGORIE.filter(function (c) { return c.k === k })[0] || { k: k, n: k, i: '🏷️' }
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
  var icona = { ok: '✅', warn: '⚠️', err: '❌', info: 'ℹ️' }[tipo] || 'ℹ️'
  return '<div class="banner ' + tipo + '" role="alert">' +
           '<span class="icona" aria-hidden="true">' + icona + '</span>' +
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

// Un colore stabile per contatto, dal nome: così le iniziali si distinguono.
var COLORI_AVATAR = ['#2d6a4f', '#40916c', '#1d4e89', '#7b2cbf', '#b5651d', '#9d0208', '#0077b6', '#6a994e', '#bc6c25', '#5f0f40']
function coloreAvatar(c) {
  var s = contattoNome(c), h = 0
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return COLORI_AVATAR[h % COLORI_AVATAR.length]
}

function avatarHtml(c, grande) {
  var cls = 'avatar' + (grande ? ' grande' : '')
  if (c.foto_url) {
    // Se la foto non si carica (file cancellato, bucket privato) si torna alle iniziali.
    return '<div class="' + cls + '" style="background:' + coloreAvatar(c) + '">' +
             '<img src="' + esc(c.foto_url) + '" alt="" loading="lazy"' +
             ' onerror="this.parentNode.textContent=\'' + esc(iniziali(c)) + '\'" />' +
           '</div>'
  }
  return '<div class="' + cls + '" style="background:' + coloreAvatar(c) + '">' + esc(iniziali(c)) + '</div>'
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
    return '<span class="badge">' + info.i + ' ' + esc(info.n) + '</span>'
  })
  if (!cats.length) out.push('<span class="badge grigio">senza categoria</span>')
  if (c.attivo === false) out.push('<span class="badge warn">📦 archiviato</span>')
  return out.join(' ')
}

// ─── Avvio ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function () {
  if (el('piede-versione')) el('piede-versione').textContent = APP_VERSIONE

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
  else if (vistaCorrente === 'scheda') mostraVista('lista')
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
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Accesso…' }
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
  html('lista-contatti', '<div class="caricamento">⏳ Carico la rubrica…</div>')
  try {
    await loadAziendaId()
    await sondaColonne()
    await loadContatti()
    mostraVista('lista')
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

// ─── Viste ───────────────────────────────────────────────────────────────────
function mostraVista(quale) {
  vistaCorrente = quale
  el('vista-lista').hidden  = quale !== 'lista'
  el('vista-scheda').hidden = quale !== 'scheda'
  el('vista-modulo').hidden = quale !== 'modulo'
  if (quale === 'lista') {
    letturaId = null
    renderLista()
  } else {
    // Gli esiti («Contatto eliminato») stanno sull'elenco: altrove non servono.
    pulisciBanner('banner-globale')
  }
  window.scrollTo(0, 0)
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

  // I pulsanti-filtro con i conteggi (sulla ricerca corrente).
  var conteggi = {}
  CATEGORIE.forEach(function (cat) { conteggi[cat.k] = 0 })
  attivi.forEach(function (c) {
    categorieDi(c).forEach(function (k) { if (k in conteggi) conteggi[k]++ })
  })
  var f = '<button type="button" role="tab" class="filtro' + (filtroCategoria === 'tutti' ? ' attivo' : '') + '"' +
            ' onclick="impostaFiltro(\'tutti\')">👥 Tutti <span class="conta">' + attivi.length + '</span></button>'
  CATEGORIE.forEach(function (cat) {
    f += '<button type="button" role="tab" class="filtro' + (filtroCategoria === cat.k ? ' attivo' : '') + '"' +
           ' onclick="impostaFiltro(\'' + cat.k + '\')">' + cat.i + ' ' + esc(cat.n) +
           ' <span class="conta">' + conteggi[cat.k] + '</span></button>'
  })
  // Gli archiviati si vedono solo se ce ne sono, e solo chiedendolo.
  if (archiviati.length || filtroCategoria === 'archiviati') {
    f += '<button type="button" role="tab" class="filtro archiviati' + (filtroCategoria === 'archiviati' ? ' attivo' : '') + '"' +
           ' onclick="impostaFiltro(\'archiviati\')">📦 Archiviati <span class="conta">' + archiviati.length + '</span></button>'
  }
  html('filtri-categorie', f)

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

  html('lista-contatti', mostrati.map(rigaHtml).join(''))
}

function rigaHtml(c) {
  var sub = []
  if (c.referente) sub.push('👤 ' + esc(c.referente))
  if (c.citta) sub.push(esc([c.cap, c.citta].filter(Boolean).join(' ')))
  if (c.email) sub.push(esc(c.email))

  // I link tel: accanto a ogni numero. stopPropagation: toccare il telefono
  // deve chiamare, non aprire la scheda.
  var azioni = ''
  if (c.telefono && telHref(c.telefono)) {
    azioni += '<a class="btn-icona" href="' + esc(telHref(c.telefono)) + '" title="Chiama ' + esc(c.telefono) + '"' +
              ' onclick="event.stopPropagation()">📞</a>'
  }
  if (c.cellulare && telHref(c.cellulare)) {
    azioni += '<a class="btn-icona" href="' + esc(telHref(c.cellulare)) + '" title="Chiama cellulare ' + esc(c.cellulare) + '"' +
              ' onclick="event.stopPropagation()">📱</a>'
  }

  return '<div class="riga' + (c.attivo === false ? ' archiviata' : '') + '" tabindex="0" role="button"' +
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

function voce(etich, valHtml, larga) {
  if (!valHtml) return ''
  return '<div class="voce' + (larga ? ' larga' : '') + '"><div class="etich">' + etich + '</div>' +
         '<div class="val' + (larga ? ' note' : '') + '">' + valHtml + '</div></div>'
}

function recapitoTel(numero, icona) {
  if (!numero) return ''
  var href = telHref(numero)
  return '<span class="recapito">' + esc(numero) +
         (href ? ' <a class="btn-icona" href="' + esc(href) + '" title="Chiama">' + icona + '</a>' : '') +
         '</span>'
}

function schedaHtml(c) {
  var indirizzo = [c.indirizzo, [c.cap, c.citta].filter(Boolean).join(' ')]
    .filter(Boolean).map(esc).join('<br>')
  var paese = c.paese
    ? (paeseValido(c.paese) ? esc(nomePaese(c.paese) + ' (' + c.paese + ')')
                            : '<span class="badge err">⚠️ «' + esc(c.paese) + '» non valido — apri Modifica e scegli il paese</span>')
    : ''
  var righe =
    voce('Telefono', recapitoTel(c.telefono, '📞')) +
    voce('Cellulare', recapitoTel(c.cellulare, '📱')) +
    voce('Email', c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' : '') +
    voce('Sito web', c.sito_web ? '<a href="' + esc(urlSito(c.sito_web)) + '" target="_blank" rel="noopener">' + esc(c.sito_web) + '</a>' : '') +
    voce('Indirizzo', indirizzo) +
    voce('Paese', paese) +
    voce('UID / Partita IVA', c.uid_partita_iva ? '<span class="mono">' + esc(c.uid_partita_iva) + '</span>' : '') +
    voce('IBAN', c.iban ? '<span class="mono">' + esc(ibanLeggibile(c.iban)) + '</span>' : '') +
    voce('Giorni di pagamento', c.giorni_pagamento == null ? '' : esc(c.giorni_pagamento + ' giorni')) +
    voce('Note', c.note ? esc(c.note) : '', true)

  var meta = []
  if (c.created_at) meta.push('creato il ' + dataIt(c.created_at))
  if (c.updated_at && c.updated_at !== c.created_at) meta.push('modificato il ' + dataIt(c.updated_at))

  return '<div class="scheda-testa">' +
           avatarHtml(c, true) +
           '<div>' +
             '<div class="scheda-nome">' + esc(contattoNome(c)) + '</div>' +
             (c.ragione_sociale && (c.nome || c.cognome)
               ? '<div class="scheda-referente">' + esc([c.nome, c.cognome].filter(Boolean).join(' ')) + '</div>' : '') +
             (c.referente ? '<div class="scheda-referente">👤 Referente: ' + esc(c.referente) + '</div>' : '') +
             '<div class="scheda-badges">' + badgesCategorie(c) + '</div>' +
           '</div>' +
         '</div>' +
         (righe ? '<div class="scheda-griglia">' + righe + '</div>'
                : '<div class="dim">Nessun altro dato: apri Modifica per completare la scheda.</div>') +
         (meta.length ? '<div class="dim" style="margin-top:16px;font-size:11px">' + esc(meta.join(' · ')) + '</div>' : '')
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
      '<button type="button" class="btn-danger pieno" onclick="eliminaConfermato()">🗑️ Sì, elimina</button>' +
      '<button type="button" class="btn-secondary" onclick="pulisciBanner(\'scheda-banner\')">Annulla</button>' +
    '</div>'))
}

async function eliminaConfermato() {
  var id = letturaId
  var c = contattoById(id)
  if (!c) return
  var nome = contattoNome(c)
  html('scheda-banner', '<div class="caricamento">⏳ Eliminazione…</div>')
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
          '<button type="button" class="btn-primary" onclick="archiviaCorrente()">📦 Archivia il contatto</button>' +
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
  html('scheda-banner', '<div class="caricamento">⏳ Archiviazione…</div>')
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
function renderCategorieCheck(selezionate) {
  var sel = selezionate || []
  html('c-categorie', CATEGORIE.map(function (cat) {
    return '<label class="check">' +
             '<input type="checkbox" name="c-cat" value="' + cat.k + '"' + (sel.indexOf(cat.k) !== -1 ? ' checked' : '') + ' />' +
             '<span>' + cat.i + ' ' + esc(cat.n) + '</span>' +
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
  el('modulo-salva-btn').textContent = '💾 Salva contatto'
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
  el('modulo-salva-btn').textContent = '💾 Salva modifiche'
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
    box.style.background = ''
    box.innerHTML = '<img src="' + esc(foto.url) + '" alt="Foto del contatto" />'
    if (btnTogli) btnTogli.hidden = false
    return
  }
  var finto = c || { ragione_sociale: getVal('c-ragione'), nome: getVal('c-nome'), cognome: getVal('c-cognome') }
  var ini = contattoNome(finto) ? iniziali(finto) : ''
  if (ini) {
    box.className = 'foto-anteprima'
    box.style.background = coloreAvatar(finto)
    box.textContent = ini
  } else {
    box.className = 'foto-anteprima vuota'
    box.style.background = ''
    box.textContent = '📷'
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
               (s.forte ? '<span class="badge err">🆔 stesso UID</span>' : '<span class="badge warn">👥 stesso nome</span>') +
               (x.attivo === false ? ' <span class="badge warn">📦 archiviato</span>' : '') +
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
      '<button type="button" class="btn-primary" onclick="salvaComunque()">💾 Salva comunque</button>' +
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

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvataggio…' }

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
    if (btn) { btn.disabled = false; btn.textContent = testoBtn || '💾 Salva contatto' }
  }
  return false
}

// ─── Errori in parole ────────────────────────────────────────────────────────
function spiegaErrore(e) {
  var m = (e && (e.message || e.msg)) ? String(e.message || e.msg) : String(e)
  if (/tm_contatti_ha_un_nome/.test(m)) return 'serve almeno la ragione sociale oppure un nome.'
  if (/giorni_pagamento/.test(m) && /check/i.test(m)) return 'i giorni di pagamento non possono essere negativi.'
  if (/categoria/.test(m) && /check/i.test(m)) return 'categoria non ammessa dal database (controlla il vincolo su tm_contatti.categoria).'
  if (/categorie/.test(m) && /check/i.test(m)) return 'una categoria scelta non è ammessa dal vincolo su tm_contatti.categorie: allinea il vincolo alle sette chiavi dell\'app.'
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
