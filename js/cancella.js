/* ═══════════════════════════════════════════════════════════════════════════
   Anagrafiche — CANCELLARE (v8, regola di Umberto del 4.11.2026, sostituisce la v7)

   «Una persona o una commessa con QUALUNQUE dato collegato non si cancella: si archivia.
   Si conserva per 10 anni (CO 958f). Si cancella solo quello inserito per errore, senza
   nessun dato. Solo il titolare, dopo aver riscritto la password, e va nel Registro.»

   Il database fa la sua parte: DIR_02 (DELETE solo al titolare, il trigger scrive il registro)
   e DIR_03 (il trigger anag_blocca_con_dati conta tutto, anche le righe che le regole RLS
   nascondono, e rifiuta con il codice 23503). Qui c'è il resto, uguale per Persone, Contatti e Commesse:
     1. conta dalle tabelle i dati collegati (LEGAMI);
     2. se c'è ANCHE UNA SOLA riga: schermo di blocco, dice cosa c'è, niente password, «Archivia invece»;
     3. se una lettura è negata o dà errore: non si va avanti;
     4. altrimenti avviso con «Archivia invece» accanto a «Cancella» e riconferma: password del
        login in uso, signInWithPassword di verifica. La password non si salva, non si scrive da
        nessuna parte, il campo si svuota SEMPRE;
     5. cancella e controlla le righe restituite (0 righe = errore a schermo).
   L'app può vedere meno del database (RLS, tabella nuova non in LEGAMI): se il database rifiuta
   (23503) si mostra lo stesso schermo di blocco, a parole, e l'accesso bloccato prima si sblocca.

   Niente file da togliere per persone e commesse: senza dati collegati non ce ne sono, e i file
   delle foto di cantiere non si toccano. Restano solo le foto dei contatti (o.file).

   Finestra: #vela-cancella (fuori dal modulo, così la password non entra mai nella
   «firma» dei campi di app.js) e un livello di APP: Indietro la chiude.
   ═══════════════════════════════════════════════════════════════════════════ */
var CX = (function () {
  'use strict'
  var esc = AC.esc, ico = AC.ico, el = AC.el

  // Le tabelle a parole. Serve anche per leggere il registro (riepilogo = { tabella: quante }).
  var PAROLE = {
    giornate: ['giornata registrata', 'giornate registrate'],
    tm_paghe_periodo: ['busta paga', 'buste paga'],
    tm_paghe_anagrafica: ['scheda paga', 'schede paga'],
    tm_paghe_voce: ['voce di busta paga', 'voci di busta paga'],
    assenze: ['assenza', 'assenze'],
    documenti_operai: ['documento', 'documenti'],
    operai_dati_personali: ['scheda di dati personali', 'schede di dati personali'],
    operai_contatti_emergenza: ['contatto d\'emergenza', 'contatti d\'emergenza'],
    ore_contrattuali: ['riga di ore contrattuali', 'righe di ore contrattuali'],
    cantieri_visibili: ['permesso di vedere un cantiere', 'permessi di vedere un cantiere'],
    regia: ['riga di regia', 'righe di regia'],
    spese: ['spesa', 'spese'],
    bolle_consegna: ['bolla di consegna', 'bolle di consegna'],
    piano_giorno: ['riga nel piano del giorno', 'righe nel piano del giorno'],
    mezzi: ['mezzo assegnato', 'mezzi assegnati'],
    anag_blocchi_fine_rapporto: ['blocco di accesso per fine rapporto', 'blocchi di accesso per fine rapporto'],
    tm_documenti: ['documento nell\'archivio vecchio', 'documenti nell\'archivio vecchio'],
    foto: ['foto', 'foto'],
    lavorazioni: ['lavorazione', 'lavorazioni'],
    voci_lavoro: ['voce di lavoro', 'voci di lavoro'],
    materiali: ['materiale', 'materiali'],
    materiali_cantiere: ['materiale di cantiere', 'materiali di cantiere'],
    preventivi_cantiere: ['preventivo di cantiere', 'preventivi di cantiere'],
    cantiere_figure: ['figura di cantiere', 'figure di cantiere'],
    pagamenti_ricevuti: ['pagamento ricevuto', 'pagamenti ricevuti'],
    pl_commesse: ['piano del Calendario', 'piani del Calendario'],
    pv_offerte: ['offerta in Preventivi', 'offerte in Preventivi'],
    tiri_gru: ['tiro gru', 'tiri gru'],
    cantieri: ['commessa', 'commesse'],
    operai: ['persona Esterna', 'persone Esterne'],
    rf_fornitori: ['fornitore in Acquisti', 'fornitori in Acquisti'],
    tm_conta_fatture: ['fattura di vendita', 'fatture di vendita'],
    tm_conta_fatture_acquisto: ['fattura d\'acquisto', 'fatture d\'acquisto'],
    tm_conta_movimenti_propri: ['movimento in Contabilità', 'movimenti in Contabilità'],
    tm_conta_offerte: ['offerta in Contabilità', 'offerte in Contabilità'],
    tm_conta_classificazioni: ['classificazione in Contabilità', 'classificazioni in Contabilità'],
    tm_conta_cantiere_contratto: ['contratto in Contabilità', 'contratti in Contabilità'],
    tm_sicurezza_dpi: ['dotazione di sicurezza', 'dotazioni di sicurezza'],
    pl_assegnazioni: ['assegnazione nel Calendario', 'assegnazioni nel Calendario'],
    pl_assegnazioni_previste: ['assegnazione prevista nel Calendario', 'assegnazioni previste nel Calendario'],
    pl_assenze: ['assenza nel Calendario', 'assenze nel Calendario']
  }
  // Senza numero (n assente): solo il nome al plurale. Una tabella non in elenco si legge senza i trattini.
  function parole(tabella, n) {
    var k = String(tabella).replace(/^public\./, ''), p = PAROLE[k], nome = p ? (n === 1 ? p[0] : p[1]) : k.replace(/_/g, ' ')
    return n == null ? nome : n + ' ' + nome
  }

  // Ogni riga in una di queste tabelle BLOCCA la cancellazione. Elenco: le 41 chiavi esterne (pg_constraint, 4.11.2026)
  // più le colonne senza chiave esterna che DIR_03 guarda a mano. Stesso elenco del database, che però lo legge dal catalogo.
  // somma: colonna da sommare e mostrare («… ore»).
  // ancheAccount: senza chiave esterna; DIR_03 confronta sia l'id della scheda sia l'id dell'account
  // (foto.operaio_id contiene l'id dell'account).
  var LEGAMI = {
    persona: {
      tabella: 'operai', cosa: 'la scheda',
      legami: [
        { t: 'giornate', c: 'operaio_id', somma: 'ore_totali' },
        { t: 'tm_paghe_periodo', c: 'operaio_id' }, { t: 'tm_paghe_anagrafica', c: 'operaio_id' },
        { t: 'assenze', c: 'operaio_id' }, { t: 'documenti_operai', c: 'operaio_id' },
        { t: 'operai_dati_personali', c: 'operaio_id' }, { t: 'operai_contatti_emergenza', c: 'operaio_id' },
        { t: 'ore_contrattuali', c: 'operaio_id' }, { t: 'cantieri_visibili', c: 'operaio_id' },
        { t: 'regia', c: 'operaio_id' }, { t: 'spese', c: 'operaio_id' }, { t: 'bolle_consegna', c: 'operaio_id' },
        { t: 'piano_giorno', c: 'operaio_id' }, { t: 'mezzi', c: 'operaio_default_id' },
        { t: 'anag_blocchi_fine_rapporto', c: 'operaio_id' }, { t: 'tm_documenti', c: 'operaio_id' },
        { t: 'tm_sicurezza_dpi', c: 'operaio_id', ancheAccount: true },
        { t: 'pl_assegnazioni', c: 'persona_id', ancheAccount: true },
        { t: 'pl_assegnazioni_previste', c: 'persona_id', ancheAccount: true },
        { t: 'pl_assenze', c: 'persona_id', ancheAccount: true },
        { t: 'foto', c: 'operaio_id', ancheAccount: true }
      ]
    },
    commessa: {
      tabella: 'cantieri', cosa: 'la commessa',
      legami: [
        { t: 'giornate', c: 'cantiere_id', somma: 'ore_totali' },
        { t: 'regia', c: 'cantiere_id' }, { t: 'spese', c: 'cantiere_id' }, { t: 'foto', c: 'cantiere_id' },
        { t: 'lavorazioni', c: 'cantiere_id' }, { t: 'materiali', c: 'cantiere_id' }, { t: 'materiali_cantiere', c: 'cantiere_id' },
        { t: 'preventivi_cantiere', c: 'cantiere_id' }, { t: 'cantiere_figure', c: 'cantiere_id' }, { t: 'cantieri_visibili', c: 'cantiere_id' },
        { t: 'pl_commesse', c: 'cantiere_id' }, { t: 'piano_giorno', c: 'cantiere_id' }, { t: 'assenze', c: 'cantiere_id' },
        { t: 'bolle_consegna', c: 'cantiere_id' }, { t: 'pagamenti_ricevuti', c: 'cantiere_id' }, { t: 'pv_offerte', c: 'cantiere_id' },
        { t: 'tiri_gru', c: 'cantiere_id' },
        { t: 'tm_conta_classificazioni', c: 'cantiere_id' }, { t: 'tm_conta_movimenti_propri', c: 'cantiere_id' },
        { t: 'tm_conta_fatture_acquisto', c: 'cantiere_id' }, { t: 'tm_conta_fatture', c: 'cantiere_id' },
        { t: 'tm_conta_offerte', c: 'cantiere_id' }, { t: 'tm_conta_cantiere_contratto', c: 'cantiere_id' }
      ]
    },
    contatto: {
      tabella: 'tm_contatti', cosa: 'il contatto',
      legami: [
        { t: 'cantieri', c: 'cliente_id' }, { t: 'operai', c: 'ditta_id' }, { t: 'rf_fornitori', c: 'contatto_id' },
        { t: 'tm_conta_fatture', c: 'contatto_id' }, { t: 'tm_conta_fatture_acquisto', c: 'contatto_id' },
        { t: 'tm_conta_movimenti_propri', c: 'contatto_id' }, { t: 'tm_conta_offerte', c: 'contatto_id' }, { t: 'pv_offerte', c: 'cliente_id' }
      ]
    }
  }

  // ── Conteggi ──────────────────────────────────────────────────────────────
  // Solo la TABELLA assente si salta. Una colonna assente (42703) è un errore: non si sa cosa c'è, non si va avanti.
  function tabellaAssente(e) { return /^(PGRST205|42P01)$/.test(String(e && e.codice || '')) || /could not find the table|relation .* does not exist/i.test(String(e && e.message || '')) }
  function numeroOre(x) { return Number(x).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[’']/g, '\'').replace('.', ',') }

  // Una tabella che sul database non c'è (Preventivi non ancora online) non ha dati: si salta.
  // Si conta sulla colonna del legame: non tutte le tabelle hanno una colonna «id».
  async function contaLegame(l, id, idAccount) {
    var filtro = function (q) { return l.ancheAccount && idAccount ? q.in(l.c, [id, idAccount]) : q.eq(l.c, id) }
    if (l.somma) {
      try {
        var righe = await AD.leggi(l.t, l.c + ',' + l.somma, filtro)
        return { n: righe.length, somma: righe.reduce(function (s, r) { return s + (Number(r[l.somma]) || 0) }, 0) }
      } catch (e) { if (e.sessioneAssente || tabellaAssente(e)) throw e /* la somma non è essenziale: sotto si conta e basta */ }
    }
    return { n: await AD.conta(l.t, filtro, l.c) }
  }
  async function analizza(tipo, id, idAccount) {
    var elenco = LEGAMI[tipo].legami, esito = { dati: [], errori: [] }
    await Promise.all(elenco.map(function (l) {
      return contaLegame(l, id, idAccount).then(function (r) {
        if (r.n > 0) esito.dati.push({ t: l.t, n: r.n, somma: r.somma })
      }, function (e) {
        if (e.sessioneAssente) throw e
        if (!tabellaAssente(e)) esito.errori.push(l.t)
      })
    }))
    // sempre nell'ordine dell'elenco, non in quello delle risposte
    var ordine = elenco.map(function (l) { return l.t })
    esito.dati.sort(function (a, b) { return ordine.indexOf(a.t) - ordine.indexOf(b.t) })
    return esito
  }
  function voce(x) {
    return '<li><strong>' + esc(parole(x.t, x.n)) + '</strong>' +
      (x.somma != null ? ' (' + esc(numeroOre(x.somma)) + ' ore)' : '') + '</li>'
  }
  function lista(voci) { return '<ul class="cx-lista">' + voci.map(voce).join('') + '</ul>' }

  // Il rifiuto del database, a parole. Due forme:
  //   trigger DIR_03: «Non si cancella: dati collegati: giornate (3), spese (1). Si archivia (conservazione 10 anni, CO 958f).»
  //   chiave esterna: «… violates foreign key constraint "x" on table "spese"» (contatti)
  function vociRifiuto(messaggio) {
    var s = String(messaggio || ''), m = s.match(/dati collegati:\s*(.*)/i), voci = []
    if (m) {
      var re = /([\w.]+)\s*\((\d+)\)/g, parte = m[1].split(/\.\s/)[0], x
      while ((x = re.exec(parte))) voci.push({ t: x[1], n: Number(x[2]) })
      return voci
    }
    m = s.match(/on table "([^"]+)"[^"]*$/)
    return m ? [{ t: m[1] }] : []
  }

  // ── Finestra ──────────────────────────────────────────────────────────────
  var aperta = false, azioni = {}, dopoChiusura = null, giro = 0, occupato = false

  function nascondi() {
    var v = el('vela-cancella')
    if (v) v.hidden = true
    var s = el('cx-scatola'); if (s) s.innerHTML = ''   // password compresa: non resta niente
    aperta = false; azioni = {}; occupato = false; giro++
  }
  function apri() {
    if (aperta) return
    aperta = true
    el('vela-cancella').hidden = false
    APP.livello(function () { var d = dopoChiusura; dopoChiusura = null; nascondi(); if (d) d() })   // Indietro
  }
  function chiudi() {
    if (!aperta) return Promise.resolve()
    var d = dopoChiusura; dopoChiusura = null
    nascondi()
    return APP.chiudiLivello().then(function () { if (d) d() })
  }
  // Sessione scaduta o uscita: si chiude senza toccare la storia.
  function chiudiSubito() { dopoChiusura = null; if (aperta) nascondi() }

  function schermo(titolo, corpo, az, poi) {
    apri()
    occupato = false
    azioni = az || {}; dopoChiusura = poi || null
    el('cx-scatola').innerHTML = '<h2 id="cx-titolo">' + esc(titolo) + '</h2>' + corpo
    var f = el('cx-password') || el('cx-primo'); if (f) f.focus()
    var sc = el('vela-cancella'); if (sc) sc.scrollTop = 0
  }
  function bottone(azione, scritta, classe, icona, id) {
    return '<button type="button"' + (id ? ' id="' + id + '"' : '') + ' class="btn ' + (classe || 'btn-secondario') + ' btn-largo" data-cx="' + azione + '">' + (icona ? ico(icona) : '') + '<span>' + esc(scritta) + '</span></button>'
  }
  function clic(ev) {
    var t = ev.target.closest && ev.target.closest('[data-cx]')
    if (!t || occupato) return
    var f = azioni[t.dataset.cx]
    if (t.dataset.cx === 'chiudi' && !f) return chiudi()
    if (f) f(t)
  }
  function occupa(si) {
    occupato = si
    var box = el('cx-scatola'); if (!box) return
    box.querySelectorAll('button,input').forEach(function (x) { x.disabled = si })
  }

  // ── Il percorso della cancellazione ───────────────────────────────────────
  // o = { tipo, id, nome, elenco:'#persone', archivia: fn | null, giaArchiviato: 'testo' | null,
  //       avvisoAccesso: html | null, primaDi: async fn → funzione per tornare indietro | null,
  //       file: { bucket, cartella, parole } | null (solo le foto dei contatti), idAccount: per le colonne ancheAccount, utente }
  function pulsanteArchivia(o) {
    return o.archivia ? bottone('archivia', 'Archivia invece', 'btn-primario', 'lucchetto', 'cx-primo') : ''
  }
  function notaArchivia(o) { return o.giaArchiviato ? '<p class="nota">' + ico('lucchetto') + '<span>' + esc(o.giaArchiviato) + '</span></p>' : '' }
  function archiviaDa(o) {
    return function () { return o.archivia() }
  }

  async function cancella(o) {
    if (!o.utente || o.utente.ruolo !== 'titolare') return   // il tasto non si vede, e il database rifiuterebbe
    schermo('Cancellare ' + o.nome + '?', '<p class="nota">' + ico('info') + '<span>Controllo i dati collegati…</span></p>', {})
    var g = giro, an
    try { an = await analizza(o.tipo, o.id, o.idAccount) } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      if (g !== giro) return
      return schermo('Cancellare ' + o.nome + '?', AC.avviso('err', '<strong>Non riesco a contare i dati collegati.</strong> ' + esc(e.message)) +
        '<div class="vela-azioni">' + bottone('chiudi', 'Chiudi', 'btn-secondario', 'chiudi', 'cx-primo') + '</div>', {})
    }
    if (g !== giro) return
    if (an.errori.length) return schermoErrori(o, an)
    if (an.dati.length) return schermoBlocco(o, an.dati)
    schermoAvviso(o)
  }

  // Non si sa cosa c'è collegato: non si va avanti.
  function schermoErrori(o, an) {
    schermo('Non posso mostrarti i dati collegati',
      AC.avviso('err', '<strong>Non riesco a leggere:</strong> ' + esc(an.errori.map(function (t) { return parole(t) }).join(', ')) +
        '. Senza sapere cosa c\'è collegato non cancello. Niente è cambiato.') + notaArchivia(o) +
      '<div class="vela-azioni">' + bottone('riprova', 'Riprova', 'btn-secondario', '', 'cx-primo') + pulsanteArchivia(o) + bottone('chiudi', 'Chiudi', 'btn-secondario', 'chiudi') + '</div>',
      { riprova: function () { cancella(o) }, archivia: archiviaDa(o) })
  }

  // Con dati collegati non si cancella: niente campo password, si propone Archivia.
  // voci può essere vuoto se il database rifiuta senza dire cosa. extra: quel che si deve aggiungere sull'accesso.
  function schermoBlocco(o, voci, extra) {
    schermo('Non si può cancellare ' + o.nome,
      AC.avviso('warn', (voci.length ? '<strong>Ha dei dati collegati:</strong>' + lista(voci) : '<strong>Ha dei dati collegati.</strong> ') + 'Si conserva per 10 anni (CO 958f).') +
      (extra ? AC.avviso('warn', extra) : '') +
      (o.archivia ? '<p class="nota">' + ico('lucchetto') + '<span>Archiviare non perde niente: ' + esc(o.cosaArchivia || 'sparisce dagli elenchi, i dati restano') + '.</span></p>' : notaArchivia(o)) +
      '<div class="vela-azioni">' + pulsanteArchivia(o) + bottone('chiudi', 'Chiudi', o.archivia ? 'btn-secondario' : 'btn-primario', 'chiudi', o.archivia ? '' : 'cx-primo') + '</div>',
      { archivia: archiviaDa(o) })
  }

  function schermoAvviso(o) {
    var L = LEGAMI[o.tipo], h = ''
    h += AC.avviso('warn', '<strong>Si cancella per sempre.</strong> Non si torna indietro.')
    h += '<p class="nota"><span>Solo ' + esc(L.cosa) + ': nessun dato collegato.</span></p>'
    if (o.avvisoAccesso) h += AC.avviso('warn', o.avvisoAccesso)
    h += notaArchivia(o)
    h += '<div class="campo cx-campo" id="campo-cx-password"><label for="cx-password">Riscrivi la tua password per confermare</label>' +
      '<div class="dato-sotto" id="cx-chi">Login in uso: ' + esc(o.utente.email) + '</div>' +
      '<input id="cx-password" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false">' +
      '<div class="campo-aiuto">La password non viene salvata né mostrata.</div></div>' +
      '<div id="cx-errore"></div>'
    h += '<div class="cx-azioni">' + (o.archivia ? bottone('archivia', 'Archivia invece', 'btn-primario', 'lucchetto') : '') +
      bottone('conferma', 'Cancella', 'btn-pericolo', 'togli', 'cx-cancella') + '</div>' +
      '<div class="vela-azioni">' + bottone('chiudi', 'Annulla', 'btn-secondario', 'chiudi') + '</div>'
    schermo('Cancellare ' + o.nome + '?', h, { archivia: archiviaDa(o), conferma: function () { conferma(o) } })
    var p = el('cx-password')
    if (p) p.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); conferma(o) } })
  }
  function mostraErrore(html) {
    var e = el('cx-errore'); if (!e) return
    e.innerHTML = AC.avviso('err', html)
    e.scrollIntoView({ block: 'center' })
  }

  async function conferma(o) {
    if (occupato) return
    var inp = el('cx-password'); if (!inp) return
    var pw = inp.value
    inp.value = ''                        // svuotato SEMPRE, qualunque cosa succeda dopo
    el('cx-errore').innerHTML = ''
    if (!pw) { mostraErrore('Scrivi la password.'); inp.focus(); return }
    var g = giro
    occupa(true)
    var giusta = false
    try {
      giusta = await AD.verificaPassword(pw)
    } catch (e) {
      pw = null
      if (e.sessioneAssente) return APP.sessioneScaduta()
      occupa(false)
      return mostraErrore('<strong>Non cancello:</strong> ' + esc(e.message))
    }
    pw = null
    if (g !== giro) return                // finestra chiusa nel frattempo: non si fa niente
    if (!giusta) {
      occupa(false)
      mostraErrore('<strong>Password sbagliata.</strong> Non ho cancellato niente.')
      var i2 = el('cx-password'); if (i2) i2.focus()
      return
    }
    var indietro = null
    try {
      var chi = await AD.ruolo()
      if (chi.ruolo !== 'titolare') throw new Error('Solo il titolare può cancellare.')
      if (o.primaDi) indietro = await o.primaDi()
    } catch (e1) {
      if (e1.sessioneAssente) return APP.sessioneScaduta()
      occupa(false)
      return mostraErrore('<strong>Non cancellato:</strong> ' + esc(e1.message))
    }
    try {
      await AD.cancella(LEGAMI[o.tipo].tabella, o.id)
    } catch (e2) {
      var sbloccato = false, sbloccoFallito = false
      if (indietro) {
        try { await indietro(); sbloccato = true } catch (_) { sbloccoFallito = true }
        ricaricaTutto()
      }
      if (e2.sessioneAssente) return APP.sessioneScaduta()
      occupa(false)
      var notaAccesso = sbloccoFallito ? '<strong>Attenzione: l\'accesso è rimasto bloccato.</strong> Si sblocca dalla scheda con «Sblocca accesso».'
                                       : (sbloccato ? 'L\'accesso è tornato com\'era.' : '')
      if (String(e2.codice || '') === '23503' || /foreign key/i.test(e2.message)) {
        return schermoBlocco(o, vociRifiuto(e2.message), (sbloccoFallito ? '' : 'Non è cambiato niente. ') + notaAccesso)
      }
      return mostraErrore('<strong>NON cancellato.</strong> ' + esc(e2.message) + (notaAccesso ? ' ' + notaAccesso : ''))
    }
    await fatto(o)
  }

  async function fatto(o) {
    var note = '', tipo = 'ok'
    if (o.file) {
      var f = await AD.togliCartella(o.file.bucket, o.file.cartella)
      if (f.file > f.tolti || f.errore) {
        tipo = 'warn'
        note += '<p class="nota">' + ico('attenzione') + '<span><strong>' + esc(o.file.parole) + ': ' + (f.errore ? 'non sono riuscito a toglierli' : (f.file - f.tolti) + ' non tolti') + ' dall\'archivio privato.</strong> Avvisa chi gestisce il database.</span></p>'
      }
    }
    var registrata = false
    try {
      var r = await AD.leggi('anag_registro_cancellazioni', 'id,riga_id', function (q) { return q.eq('riga_id', String(o.id)) })
      registrata = r.length > 0
    } catch (e) { registrata = false }
    if (!registrata) { tipo = 'warn'; note += '<p class="nota">' + ico('attenzione') + '<span><strong>Non trovo la riga nel Registro cancellazioni.</strong> Controllalo e avvisa chi gestisce il database.</span></p>' }
    ricaricaTutto()
    var elenco = o.elenco
    schermo('Cancellato',
      AC.avviso(tipo, '<strong>' + esc(o.nome) + '</strong> è stato cancellato.' + (registrata ? ' È scritto nel Registro cancellazioni.' : '')) +
      (o.notaFatto ? '<p class="nota">' + ico('lucchetto') + '<span>' + esc(o.notaFatto) + '</span></p>' : '') + note +
      '<div class="vela-azioni">' + bottone('chiudi', 'Chiudi', 'btn-primario', 'chiudi', 'cx-primo') + bottone('registro', 'Apri il Registro cancellazioni', 'btn-secondario', 'documento') + '</div>',
      { registro: function () { dopoChiusura = function () { location.hash = '#registro' }; chiudi() } },
      function () { location.hash = elenco })
  }
  function ricaricaTutto() { CM.ricarica(); PS.ricarica(); if (window.KT) KT.ricarica() }

  // ── Registro cancellazioni (solo titolare) ────────────────────────────────
  function quando(iso) {
    var d = new Date(iso); if (isNaN(d)) return String(iso || '')
    var due = function (n) { return String(n).padStart(2, '0') }
    return due(d.getDate()) + '.' + due(d.getMonth() + 1) + '.' + d.getFullYear() + ' alle ' + due(d.getHours()) + ':' + due(d.getMinutes())
  }
  function cosaA(r) {
    if (r.cosa === 'operai') return 'Persona'
    if (r.cosa === 'tm_contatti') return 'Contatto'
    if (r.cosa === 'cantieri') return r.riga && r.riga.tipo === 'interno' ? 'Interno' : 'Commessa'
    return r.cosa
  }
  function nomeRiga(r) {
    var x = r.riga || {}
    if (r.cosa === 'tm_contatti') return AC.nomeContatto(x) || r.nome || '(senza nome)'
    if (r.cosa === 'cantieri') return [x.numero_commessa, x.nome].filter(Boolean).join(' · ') || r.nome || '(senza nome)'
    return r.nome || '(senza nome)'
  }
  function riepilogoA(r) {
    var chiavi = Object.keys(r.riepilogo || {})
    if (!chiavi.length) return 'Nessun dato collegato.'
    return chiavi.map(function (t) { return parole(t, r.riepilogo[t]) }).join(', ') + '.'
  }
  function datiRiga(r) {
    var x = r.riga || {}
    return Object.keys(x).filter(function (k) {
      return x[k] != null && x[k] !== '' && !/(^id$|_id$|^created_at$|^updated_at$|^foto_url$)/.test(k) && !(Array.isArray(x[k]) && !x[k].length) && x[k] !== false
    }).map(function (k) {
      return '<div class="dato"><div class="dato-etichetta">' + esc(k.replace(/_/g, ' ')) + '</div><div class="dato-valore">' + esc(Array.isArray(x[k]) ? x[k].join(', ') : x[k]) + '</div></div>'
    }).join('')
  }
  async function mostraRegistro(utente) {
    document.body.classList.remove('con-dettaglio')
    el('pane-dettaglio').innerHTML = ''
    var pane = el('pane-elenco')
    if (!utente || utente.ruolo !== 'titolare') {
      pane.innerHTML = AC.avviso('warn', '<strong>Il Registro cancellazioni lo vede solo il titolare.</strong>')
      return
    }
    pane.innerHTML = '<h2 class="sezione-titolo">' + ico('documento') + 'Registro cancellazioni</h2><p class="nota">Carico il registro…</p>'
    var righe, profili = []
    try {
      righe = await AD.leggi('anag_registro_cancellazioni', 'id,quando,chi,chi_ruolo,cosa,riga_id,nome,riepilogo,riga')
    } catch (e) {
      if (e.sessioneAssente) throw e
      pane.innerHTML = '<h2 class="sezione-titolo">' + ico('documento') + 'Registro cancellazioni</h2>' +
        AC.avviso('err', '<strong>Non riesco a leggere il registro.</strong> ' + esc(e.message)) +
        '<div class="azioni-riga"><button type="button" class="btn btn-secondario" id="cx-reg-riprova">Riprova</button></div>'
      el('cx-reg-riprova').addEventListener('click', function () { mostraRegistro(utente).catch(function (e2) { if (e2.sessioneAssente) APP.sessioneScaduta() }) })
      return
    }
    try { profili = await AD.leggi('profili', 'id,nome,ruolo') } catch (e3) { if (e3.sessioneAssente) throw e3 /* senza nomi si mostra il ruolo */ }
    function chiE(r) {
      if (!r.chi) return 'dal server'
      var p = profili.filter(function (x) { return x.id === r.chi })[0]
      if (r.chi === utente.id) return 'tu (' + utente.email + ')'
      return (p && p.nome) || r.chi_ruolo || 'account non più presente'
    }
    righe.sort(function (a, b) { return String(b.quando).localeCompare(String(a.quando)) })
    var h = '<h2 class="sezione-titolo">' + ico('documento') + 'Registro cancellazioni <span class="sezione-nota">' + righe.length + '</span></h2>' +
      '<p class="nota">Lo vedi solo tu. Lo scrive il database a ogni cancellazione: non si può saltare né modificare.</p>'
    if (!righe.length) h += '<div class="vuoto vuoto-grande" id="cx-reg-vuoto"><p>Nessuna cancellazione.</p></div>'
    h += righe.map(function (r) {
      return '<div class="blocco cx-reg-riga"><h3 class="blocco-titolo">' + esc(cosaA(r)) + ': ' + esc(nomeRiga(r)) + '</h3>' +
        '<div class="dato"><div class="dato-etichetta">Quando</div><div class="dato-valore">' + esc(quando(r.quando)) + '</div></div>' +
        '<div class="dato"><div class="dato-etichetta">Chi</div><div class="dato-valore">' + esc(chiE(r)) + '</div></div>' +
        '<div class="dato"><div class="dato-etichetta">Dati collegati al momento di cancellare</div><div class="dato-valore">' + esc(riepilogoA(r)) + '</div></div>' +
        '<details class="cx-dettagli"><summary>Dati cancellati</summary>' + (datiRiga(r) || '<p class="nota">Nessun altro dato.</p>') + '</details></div>'
    }).join('')
    pane.innerHTML = h
    el('pane-dettaglio').innerHTML = '<div class="vuoto vuoto-grande">' + ico('info') + '<p>Ogni riga dice cosa è stato cancellato, chi, quando e cosa c\'era collegato.</p></div>'
  }

  function avvia() {
    el('vela-cancella').addEventListener('click', clic)
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && aperta && !occupato) { ev.preventDefault(); chiudi() }
    })
  }

  return { avvia: avvia, cancella: cancella, schermo: schermo, chiudi: chiudi, chiudiSubito: chiudiSubito, bottone: bottone, mostraRegistro: mostraRegistro,
           aperta: function () { return aperta },
           // per le prove
           _LEGAMI: LEGAMI, _parole: parole }
})()
