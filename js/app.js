/* ═══════════════════════════════════════════════════════════════════════════
   Anagrafiche — APP: entrata, navigazione, sessione

   Chi entra lo decide app_ruolo() (tabella profili): titolare o responsabile.
   tm_utenti NON si legge (la vecchia Rubrica la pretendeva, riga 432).
   Navigazione con l'indirizzo (#commesse, #commessa/ID, #nuova-commessa…), così
   il tasto «indietro» del telefono e del browser fa quello che ci si aspetta.
   Indietro (v5, 3.11.2026): ogni schermata = un passo nella storia del browser.
   - Finestre e conferme (togli contatto, togli documento, elimina contatto) aprono
     un «livello» (APP.livello): Indietro le chiude senza cambiare schermata.
   - Modulo con dati non salvati: Indietro (o un clic su un altro elemento, o Esci)
     chiede «Resta qui» / «Esci senza salvare». Dopo un salvataggio, o col tasto
     Annulla, non chiede (APP.libera).
   ═══════════════════════════════════════════════════════════════════════════ */
var APP = (function () {
  'use strict'
  var esc = AC.esc, ico = AC.ico, el = AC.el
  var RUOLI_AMMESSI = ['titolare', 'responsabile']
  var utente = null   // { ruolo, email, id }

  function mostraPagina(nome) {
    ;['login', 'negato', 'app'].forEach(function (p) { el('pagina-' + p).hidden = (p !== nome) })
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  function mostraLogin(messaggio, tipo) {
    utente = null
    CM.svuota(); PS.svuota(); if (window.KT) KT.svuota()
    if (window.CX) { CX.chiudiSubito(); CX.avvisoFilePendenti(null) }
    var mr = el('menu-registro'); if (mr) mr.hidden = true
    el('pane-elenco').innerHTML = ''; el('pane-dettaglio').innerHTML = ''
    mostraPagina('login')
    el('login-avviso').innerHTML = messaggio ? AC.avviso(tipo || 'info', esc(messaggio)) : ''
    var e = el('login-email'); if (e && !e.value) e.focus()
  }
  var loginInCorso = false
  async function login(ev) {
    ev.preventDefault()
    if (loginInCorso) return   // Invio premuto due volte: un solo accesso
    var email = el('login-email').value.trim(), pw = el('login-password').value
    var av = el('login-avviso')
    av.innerHTML = ''
    if (!email) { av.innerHTML = AC.avviso('err', 'Scrivi la tua email.'); el('login-email').focus(); return }
    if (!pw) { av.innerHTML = AC.avviso('err', 'Scrivi la password.'); el('login-password').focus(); return }
    var b = el('login-entra'); b.disabled = true; loginInCorso = true
    try {
      await AD.entra(email, pw)
      el('login-password').value = ''
      await dopoLogin()
    } catch (e) {
      var m = String(e.message || e)
      av.innerHTML = AC.avviso('err', /invalid login|invalid_credentials/i.test(m) ? 'Email o password non corretti.' : esc(m))
    } finally { b.disabled = false; loginInCorso = false }
  }

  // Dopo il login (o all'apertura con una sessione già aperta): chi sei?
  async function dopoLogin() {
    var s = await AD.sessione()
    if (!s) return mostraLogin('')
    try {
      utente = await AD.ruolo()
    } catch (e) {
      if (e.sessioneAssente) return mostraLogin('Sessione scaduta: entra di nuovo.')
      mostraPagina('negato')
      var dettaglio = (e.originale && e.originale.message) || e.message
      el('negato-testo').innerHTML = AC.avviso('err', 'Non riesco a sapere chi sei: riprova tra poco.<br><small>' + esc(dettaglio) + '</small>')
      return
    }
    if (RUOLI_AMMESSI.indexOf(utente.ruolo) < 0) {
      mostraPagina('negato')
      el('negato-testo').innerHTML = AC.avviso('warn',
        '<strong>Anagrafiche è per il titolare e il responsabile.</strong><br>' +
        'Sei entrato come ' + esc(utente.email) + ', con il ruolo «' + esc(utente.ruolo || 'nessuno') + '».<br>' +
        'Per i cantieri usa l\'App Cantieri.')
      return
    }
    el('menu-registro').hidden = utente.ruolo !== 'titolare'   // il Registro cancellazioni lo vede solo il titolare
    el('utente').innerHTML = esc(utente.email) + ' <span class="ruolo">' + esc(utente.ruolo) + '</span>'
    mostraPagina('app')
    vai()
    CX.avvisoFilePendenti(utente)   // cancellazioni con file ancora da togliere: solo il titolare
  }

  async function esci() {
    if (sporco()) return chiediConferma(function () { scarta(); esciDavvero() })
    return esciDavvero()
  }
  async function esciDavvero() {
    libera()
    await AD.esci()
    location.hash = ''
    mostraLogin('Sei uscito.', 'ok')
  }

  // Chiamata da tutte le sezioni quando il database dice «sessione assente».
  function sessioneScaduta() { mostraLogin('Sessione scaduta: entra di nuovo. Quello che non era salvato non è stato salvato.', 'warn') }

  // ── Navigazione ────────────────────────────────────────────────────────────
  var SEZIONI = {
    commesse: { titolo: 'Commesse', menu: 'commesse' },
    commessa: { titolo: 'Commesse', menu: 'commesse' },
    'nuova-commessa': { titolo: 'Commesse', menu: 'commesse' },
    'nuovo-interno': { titolo: 'Commesse', menu: 'commesse' },
    'nuovo-contatto': { titolo: 'Commesse', menu: 'commesse' },
    persone: { titolo: 'Persone', menu: 'persone' },
    persona: { titolo: 'Persone', menu: 'persone' },
    'nuova-persona': { titolo: 'Persone', menu: 'persone' },
    contatti: { titolo: 'Contatti', menu: 'contatti' },
    contatto: { titolo: 'Contatti', menu: 'contatti' },
    'nuovo-contatto-rubrica': { titolo: 'Contatti', menu: 'contatti' },
    categorie: { titolo: 'Contatti', menu: 'contatti' },
    registro: { titolo: 'Registro cancellazioni', menu: 'registro' }
  }
  async function vai() {
    if (!utente) return
    var parti = location.hash.replace(/^#/, '').split('/').filter(Boolean)
    if (!parti.length || !SEZIONI[parti[0]]) parti = ['commesse']
    var sez = SEZIONI[parti[0]]
    el('titolo-sezione').textContent = sez.titolo
    document.querySelectorAll('[data-menu]').forEach(function (b) {
      var attivo = b.dataset.menu === sez.menu
      b.classList.toggle('menu-attivo', attivo)
      if (attivo) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current')
    })
    document.body.classList.remove('con-dettaglio')
    try {
      try {
        if (sez.menu === 'commesse') return await CM.mostra(parti, utente)
        if (sez.menu === 'registro') { await CX.mostraRegistro(utente); return await PS.mostraRegistroPeriodi(utente) }
        if (sez.menu === 'persone') return await PS.mostra(parti, utente)
        if (sez.menu === 'contatti') {
          if (window.KT) return await KT.mostra(parti, utente)
          return inArrivo('Contatti',
            'Per ora i contatti si gestiscono nella Rubrica. Quando sarà pronta, la Rubrica entrerà qui.',
            '<a class="btn btn-secondario" href="riserva/">' + ico('contatti') + '<span>Apri la Rubrica</span></a>')
        }
      } finally { snap = firma() }   // com'è la schermata appena disegnata: da qui si vede se qualcosa cambia
    } catch (e) {
      if (e.sessioneAssente) return sessioneScaduta()
      document.body.classList.remove('con-dettaglio')
      el('pane-elenco').innerHTML = AC.avviso('err', '<strong>Non riesco a caricare i dati.</strong> ' + esc(e.message) +
        '<div class="azioni-riga"><button type="button" class="btn btn-secondario btn-piccolo" id="riprova">Riprova</button></div>')
      el('pane-dettaglio').innerHTML = ''
      var r = el('riprova'); if (r) r.addEventListener('click', function () { CM.ricarica(); PS.ricarica(); if (window.KT) KT.ricarica(); vai() })
    }
  }
  function inArrivo(titolo, testo, extra) {
    el('pane-elenco').innerHTML = '<div class="vuoto vuoto-grande"><h2>' + esc(titolo) + '</h2><p>' + esc(testo) + '</p>' + (extra || '') + '</div>'
    el('pane-dettaglio').innerHTML = ''
  }

  // ── Tasto Indietro: storia del browser ─────────────────────────────────────
  // Ogni voce della storia porta il suo numero (history.state.n). Le voci dei
  // «livelli» (finestre, conferme) hanno anche liv:true e lo stesso indirizzo
  // della schermata sotto. Tutto passa da popstate (scatta anche per i cambi di #).
  var pos = 0            // numero della voce dove siamo
  var salta = 0          // popstate causati da noi (history.go): da ignorare
  var livelli = []       // [{ n, chiudi }] finestre aperte, l'ultima è in cima
  var snap = null        // firma dei campi della scheda appena disegnata
  var libero = false     // la prossima uscita non chiede conferma (dopo salva / Annulla)

  // Firma dei campi della scheda a destra (modulo): confrontata con quella di
  // quando è stata disegnata, dice se c'è qualcosa non salvato.
  function firma() {
    var pane = el('pane-dettaglio'); if (!pane) return ''
    var out = []
    pane.querySelectorAll('input,select,textarea').forEach(function (x) {
      if (x.type === 'file' || x.type === 'button' || x.type === 'submit') return
      out.push((x.id || x.name || x.type) + '=' + (x.type === 'checkbox' || x.type === 'radio' ? (x.checked ? '1' : '0') : x.value))
    })
    return out.join('|')
  }
  function sporco() {
    var p = el('pagina-app')
    return !!(utente && p && !p.hidden && snap !== null && firma() !== snap)
  }
  // Dopo un salvataggio o col tasto Annulla: l'uscita seguente non chiede niente.
  function libera() { libero = true; setTimeout(function () { libero = false }, 600) }
  // Butta via le bozze in memoria dei moduli (non quella salvata sul telefono per le commesse).
  function scarta() { CM.scarta(); PS.scarta(); if (window.KT) KT.scarta() }

  // Finestra: una finestra o conferma aperta = una voce in più nella storia, così Indietro la chiude.
  function livello(chiudi) {
    pos++
    try { history.pushState({ n: pos, liv: true }, '') } catch (e) { pos--; return }
    livelli.push({ n: pos, chiudi: chiudi })
  }
  // La finestra si è chiusa da sola (tasto Annulla…): toglie anche la sua voce dalla storia.
  // Restituisce una promessa: finita la storia a posto, si può continuare (es. cambiare schermata).
  var attesaLivello = null
  function chiudiLivello() {
    if (!livelli.length) return Promise.resolve()
    livelli.pop(); salta++
    return new Promise(function (ok) {
      attesaLivello = ok
      setTimeout(function () { if (attesaLivello === ok) { attesaLivello = null; salta = Math.max(0, salta - 1); ok() } }, 800)
      history.back()
    })
  }

  function chiediConferma(esciPure) {
    var v = el('vela-uscita'); if (!v) return
    el('vela-esci').onclick = function () { chiudiVela(); esciPure() }
    el('vela-resta').onclick = chiudiVela
    v.hidden = false
    el('vela-resta').focus()
  }
  function chiudiVela() { var v = el('vela-uscita'); if (v) v.hidden = true }

  function popstate() {
    var st = history.state, nuovo
    if (st && typeof st.n === 'number') nuovo = st.n
    else { nuovo = pos + 1; st = { n: nuovo }; try { history.replaceState(st, '') } catch (e) {} }
    if (salta > 0) { salta--; pos = nuovo; if (attesaLivello) { var r = attesaLivello; attesaLivello = null; r() } return }
    var delta = nuovo - pos
    // 1. Indietro con una finestra aperta: la chiude e basta.
    var cima = livelli[livelli.length - 1]
    if (cima && nuovo < cima.n) { livelli.pop(); pos = nuovo; try { cima.chiudi() } catch (e) {} return }
    // 2. Voce di una finestra già chiusa: si passa oltre.
    if (st.liv) { pos = nuovo; if (delta) { salta++; history.go(delta < 0 ? -1 : 1) } return }
    // 3. Finestra «modifiche non salvate» aperta: Indietro = «Resta qui».
    var v = el('vela-uscita')
    if (v && !v.hidden) { chiudiVela(); salta++; history.go(-delta); return }
    // 4. Modulo con dati non salvati: si torna dov'era e si chiede.
    if (!libero && sporco()) {
      salta++; history.go(-delta)
      chiediConferma(function () { scarta(); libera(); history.go(delta) })
      return
    }
    livelli = []; pos = nuovo
    vai()
  }

  // ── Avvio ──────────────────────────────────────────────────────────────────
  function avvia() {
    // icone del menu e dei tasti fissi (sempre con la scritta)
    document.querySelectorAll('[data-ico]').forEach(function (x) { x.insertAdjacentHTML('afterbegin', ico(x.dataset.ico)) })
    el('versione').textContent = ANAG_CONFIG.VERSIONE
    el('login-form').addEventListener('submit', login)
    el('esci').addEventListener('click', esci)
    el('negato-esci').addEventListener('click', esci)
    // storia del browser: numero della voce di partenza
    try {
      var s0 = history.state
      if (s0 && typeof s0.n === 'number') pos = s0.n; else history.replaceState({ n: 0 }, '')
    } catch (e) {}
    window.addEventListener('popstate', popstate)
    // tasto «Annulla» (link): è una scelta, niente domande
    document.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('[data-libera]')
      if (a) { scarta(); libera() }
    }, true)
    window.addEventListener('beforeunload', function (ev) { if (sporco()) { ev.preventDefault(); ev.returnValue = '' } })
    document.addEventListener('keydown', function (ev) {
      var v = el('vela-uscita')
      if (ev.key === 'Escape' && v && !v.hidden) { ev.preventDefault(); chiudiVela() }
    })
    CM.avvia(); PS.avvia(); if (window.KT) KT.avvia(); CX.avvia()
    AD.sb.auth.onAuthStateChange(function (evento) {
      if (evento === 'SIGNED_OUT' && utente) mostraLogin('Sessione chiusa: entra di nuovo.', 'warn')
    })
    dopoLogin().catch(function (e) { mostraLogin('Errore all\'avvio: ' + e.message, 'err') })
  }

  // La schermata è stata ridisegnata dopo un salvataggio (v7, categorie): da qui si riparte a confrontare.
  function rifirma() { snap = firma() }

  return { avvia: avvia, sessioneScaduta: sessioneScaduta, libera: libera, livello: livello, chiudiLivello: chiudiLivello, rifirma: rifirma,
           // per le prove
           _sporco: sporco, _pos: function () { return pos } }
})()

document.addEventListener('DOMContentLoaded', APP.avvia)
