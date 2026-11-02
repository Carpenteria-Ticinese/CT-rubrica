/* ═══════════════════════════════════════════════════════════════════════════
   Anagrafiche — APP: entrata, navigazione, sessione

   Chi entra lo decide app_ruolo() (tabella profili): titolare o responsabile.
   tm_utenti NON si legge (la vecchia Rubrica la pretendeva, riga 432).
   Navigazione con l'indirizzo (#commesse, #commessa/ID, #nuova-commessa…), così
   il tasto «indietro» del telefono e del browser fa quello che ci si aspetta.
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
    el('pane-elenco').innerHTML = ''; el('pane-dettaglio').innerHTML = ''
    mostraPagina('login')
    el('login-avviso').innerHTML = messaggio ? AC.avviso(tipo || 'info', esc(messaggio)) : ''
    var e = el('login-email'); if (e && !e.value) e.focus()
  }
  async function login(ev) {
    ev.preventDefault()
    var email = el('login-email').value.trim(), pw = el('login-password').value
    var av = el('login-avviso')
    av.innerHTML = ''
    if (!email) { av.innerHTML = AC.avviso('err', 'Scrivi la tua email.'); el('login-email').focus(); return }
    if (!pw) { av.innerHTML = AC.avviso('err', 'Scrivi la password.'); el('login-password').focus(); return }
    var b = el('login-entra'); b.disabled = true
    try {
      await AD.entra(email, pw)
      el('login-password').value = ''
      await dopoLogin()
    } catch (e) {
      var m = String(e.message || e)
      av.innerHTML = AC.avviso('err', /invalid login|invalid_credentials/i.test(m) ? 'Email o password non corretti.' : esc(m))
    } finally { b.disabled = false }
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
    el('utente').innerHTML = esc(utente.email) + ' <span class="ruolo">' + esc(utente.ruolo) + '</span>'
    mostraPagina('app')
    vai()
  }

  async function esci() {
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
    'nuovo-contatto-rubrica': { titolo: 'Contatti', menu: 'contatti' }
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
      if (sez.menu === 'commesse') return await CM.mostra(parti)
      if (sez.menu === 'persone') return await PS.mostra(parti, utente)
      if (sez.menu === 'contatti') {
        if (window.KT) return await KT.mostra(parti, utente)
        return inArrivo('Contatti',
          'Per ora i contatti si gestiscono nella Rubrica. Quando sarà pronta, la Rubrica entrerà qui.',
          '<a class="btn btn-secondario" href="riserva/">' + ico('contatti') + '<span>Apri la Rubrica</span></a>')
      }
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

  // ── Avvio ──────────────────────────────────────────────────────────────────
  function avvia() {
    // icone del menu e dei tasti fissi (sempre con la scritta)
    document.querySelectorAll('[data-ico]').forEach(function (x) { x.insertAdjacentHTML('afterbegin', ico(x.dataset.ico)) })
    el('versione').textContent = ANAG_CONFIG.VERSIONE
    el('login-form').addEventListener('submit', login)
    el('esci').addEventListener('click', esci)
    el('negato-esci').addEventListener('click', esci)
    window.addEventListener('hashchange', vai)
    CM.avvia(); PS.avvia(); if (window.KT) KT.avvia()
    AD.sb.auth.onAuthStateChange(function (evento) {
      if (evento === 'SIGNED_OUT' && utente) mostraLogin('Sessione chiusa: entra di nuovo.', 'warn')
    })
    dopoLogin().catch(function (e) { mostraLogin('Errore all\'avvio: ' + e.message, 'err') })
  }

  return { avvia: avvia, sessioneScaduta: sessioneScaduta }
})()

document.addEventListener('DOMContentLoaded', APP.avvia)
