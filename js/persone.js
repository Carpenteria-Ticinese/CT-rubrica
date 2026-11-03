/* ═══════════════════════════════════════════════════════════════════════════
   Anagrafiche — PERSONE (tabella operai) con Accesso, Dati personali,
   Contatti d'emergenza e Documenti.

   Regole (FASE2_DISEGNO.md + decisioni del 2.11.2026):
   - RAPPORTO: «Dipendente» (busta paga) o «Esterno» (lavora per noi con la sua
     ditta, paghiamo la fattura). Colonna operai.rapporto (SQL ANAG_F2_01).
     · Esterno: la DITTA si sceglie dall'elenco dei contatti fornitori (mai scritta
       a mano) → operai.ditta_id. Niente paga, niente accesso alle app (il database
       lo impedisce: un Esterno non può avere user_id).
     · «agenzia» (interinali) è un'altra cosa: resta com'è, solo per i Dipendenti.
   - Anagrafiche NON legge e NON scrive paghe (tm_paghe_*): stanno in Paghe. Unica eccezione: prima di
     cancellare una persona il titolare vede QUANTE buste paga sparirebbero (solo il numero, js/cancella.js).
   - «attivo» non si scrive a mano: attivo = fine rapporto vuota, oggi o futura
     (come App Cantieri e Calendario).
   - Dati personali: solo qui, mai in operai. «Niente dati sanitari».
   - Documenti: file nel bucket privato tm-documenti, percorso <id persona>/<ora>-<nome>,
     mai il nome della persona. Toglie un documento solo il titolare.
   - Accesso: «Dai accesso» = salva l'email nella scheda → anag_collega_account →
     (solo se serve) crea-collaboratore → anag_collega_account. Mai due account.
   - Chi esce si ARCHIVIA: tasto «Archivia» = fine rapporto (ultimo giorno), resta tra «chi non lavora più con noi».
     «Cancella» (v7): solo il titolare, con password, avviso e registro (js/cancella.js). La scheda di un account
     titolare e la propria non si cancellano (si guarda user_id e ruolo, mai il nome). Chi ha un account:
     l'accesso si blocca PRIMA di cancellare, finché c'è il legame («Blocca accesso», stessa funzione).
   - FINE RAPPORTO = ultimo giorno di lavoro (v3, decisione di Umberto 3.11.2026):
     dal giorno DOPO l'accesso si blocca DA SOLO (database, SQL ANAG_F2_07: trigger
     su operai + job ogni ora). Data già passata = blocco subito. Titolari mai da soli.
     Data spostata o tolta DOPO il blocco: resta bloccato; la scheda avvisa «Accesso
     bloccato ma data spostata: sbloccare?» con il tasto «Sblocca accesso» (mai da solo).
     L'app avvisa e chiede conferma: fine rapporto sulla propria scheda, o data già
     passata per chi ha l'accesso (si blocca subito).
   ═══════════════════════════════════════════════════════════════════════════ */
var PS = (function () {
  'use strict'
  var esc = AC.esc, ico = AC.ico, el = AC.el

  var COL_OPERAI_VECCHIE = 'id,nome,cognome,ruolo,email,telefono,data_assunzione,data_fine_rapporto,agenzia,nome_agenzia,attivo,user_id,created_at'
  var COL_OPERAI = COL_OPERAI_VECCHIE + ',rapporto,ditta_id'
  var COL_CONTATTI = 'id,ragione_sociale,nome,cognome,citta,telefono,cellulare,email,attivo,categoria,categorie,e_fornitore'
  var COL_DOC_VECCHIE = 'id,operaio_id,tipo,scadenza,note,created_at'
  var COL_DOC = COL_DOC_VECCHIE + ',file_path'
  var COL_DP = 'operaio_id,data_nascita,via,cap,localita,numero_avs,permesso_tipo,permesso_scadenza,motivo_uscita,note_riservate'
  var COL_CE = 'id,operaio_id,nome,telefono,relazione,created_at'
  var BUCKET_DOC = 'tm-documenti'

  var MANSIONI = ['Carpentiere', 'Caposquadra', 'Responsabile cantiere', 'Operaio generico', 'Apprendista', 'Magazziniere', 'Lattoniere', 'Titolare']
  var TIPI_DOC = ['Permesso di lavoro', 'Carta d\'identità', 'Passaporto', 'Patente', 'Corso sicurezza (SUVA)', 'Corso piattaforma / PLE', 'Corso gru', 'Primo soccorso', 'Contratto', 'Altro']
  var RUOLI_APP = [{ v: 'operaio', n: 'Operaio' }, { v: 'caposquadra', n: 'Caposquadra' }, { v: 'magazziniere', n: 'Magazziniere' }, { v: 'responsabile', n: 'Responsabile (vice)' }]
  function nomeRuoloApp(r) { var x = RUOLI_APP.filter(function (a) { return a.v === r })[0]; return x ? x.n : (r === 'titolare' ? 'Titolare' : (r || '—')) }

  var ST = {
    operai: [], contatti: [], documenti: [], profili: [], accessi: null, accessiErrore: null,
    caricato: false, sqlEsterni: true, sqlDocFile: true,
    blocchi: [], sqlBlocchi: true,  // registro dei blocchi per fine rapporto (ANAG_F2_07)
    confermaFine: false,
    cerca: '', mostraEx: false,
    dp: {}, ce: {},                 // per persona: dati personali, contatti d'emergenza (caricati quando si apre la scheda)
    form: null, messaggio: null, utente: null,
    esitoAccesso: null               // email e password da comunicare (solo a schermo, una volta)
  }

  // ── Dati ───────────────────────────────────────────────────────────────────
  async function carica(forza) {
    if (ST.caricato && !forza) return
    var r = await Promise.all([
      AD.leggiConRiserva('operai', COL_OPERAI, COL_OPERAI_VECCHIE),
      AD.leggi('tm_contatti', COL_CONTATTI),
      AD.leggiConRiserva('documenti_operai', COL_DOC, COL_DOC_VECCHIE),
      AD.leggi('profili', 'id,ruolo,nome')
    ])
    if (!r[0].righe.length) throw new Error('Il database non mi dà le persone (0 righe). L\'elenco NON è attendibile: esci, rientra e riprova.')
    ST.operai = r[0].righe; ST.sqlEsterni = r[0].complete
    ST.operai.forEach(function (o) { if (!o.rapporto) o.rapporto = 'dipendente' })
    ST.contatti = r[1]
    ST.documenti = r[2].righe; ST.sqlDocFile = r[2].complete
    ST.profili = r[3]
    try { ST.accessi = await AD.rpc('anag_stato_accessi'); ST.accessiErrore = null } catch (e) {
      if (e.sessioneAssente) throw e
      ST.accessi = null; ST.accessiErrore = e.message
    }
    try {
      ST.blocchi = await AD.leggi('anag_blocchi_fine_rapporto', 'operaio_id,user_id,data_fine_rapporto,bloccato_il,come')
      ST.sqlBlocchi = true
    } catch (e) {
      if (e.sessioneAssente) throw e
      ST.blocchi = []
      // tabella assente = SQL ANAG_F2_07 non applicato: il blocco automatico non c'è
      ST.sqlBlocchi = !(/^(PGRST205|42P01)$/.test(String(e.codice || '')) || /does not exist|could not find the table/i.test(e.message))
    }
    ST.caricato = true
  }
  function scarta() { ST.form = null; ST.salvaComunque = false; ST.confermaFine = false }
  function svuota() { ST.operai = []; ST.contatti = []; ST.documenti = []; ST.profili = []; ST.accessi = null; ST.caricato = false; ST.dp = {}; ST.ce = {}; ST.form = null; ST.esitoAccesso = null }

  function perId(id) { return ST.operai.filter(function (o) { return o.id === id })[0] || null }
  function contatto(id) { return ST.contatti.filter(function (k) { return k.id === id })[0] || null }
  function nome(o) { return [o.nome, o.cognome].filter(Boolean).join(' ').trim() || '(senza nome)' }
  function eEsterno(o) { return o && o.rapporto === 'esterno' }
  function attiva(o, oggi) { return o.attivo !== false && (!o.data_fine_rapporto || o.data_fine_rapporto >= (oggi || AC.oggiIso())) }
  function profilo(uid) { return ST.profili.filter(function (p) { return p.id === uid })[0] || null }
  function statoAccesso(o) {
    if (!o.user_id) return { tipo: 'nessuno' }
    if (!ST.accessi) return { tipo: 'illeggibile' }
    var a = ST.accessi.filter(function (x) { return x.user_id === o.user_id })[0]
    if (!a) return { tipo: 'illeggibile' }
    return { tipo: a.bloccato ? 'bloccato' : 'attivo', ultimo: a.ultimo_accesso }
  }
  // Il giorno dopo una data «AAAA-MM-GG» (da quel giorno l'accesso è bloccato)
  function giornoDopo(iso) {
    var p = String(iso).slice(0, 10).split('-').map(Number)
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1)).toISOString().slice(0, 10)
  }
  // Ultimo blocco fatto dal database per fine rapporto su questo account
  function bloccoDi(o) {
    if (!o || !o.user_id) return null
    return ST.blocchi.filter(function (b) { return b.user_id === o.user_id })
      .sort(function (a, b) { return String(b.bloccato_il).localeCompare(String(a.bloccato_il)) })[0] || null
  }
  // Riquadro Accesso: cosa succede con la fine rapporto ('' = niente da dire)
  function notaFineRapporto(o, s, p) {
    var oggi = AC.oggiIso(), f = o.data_fine_rapporto, b = bloccoDi(o)
    if (p && p.ruolo === 'titolare') {
      return f ? '<p class="nota">' + ico('info') + '<span>' + 'Titolare: l\'accesso <strong>non</strong> si blocca da solo con la fine rapporto.</span></p>' : ''
    }
    if (s.tipo === 'bloccato' && b) {
      var h = '<p class="nota">' + ico('lucchetto') + '<span>' + 'Bloccato <strong>da solo per fine rapporto</strong> (' + esc(AC.data(b.data_fine_rapporto)) + ') il ' + esc(AC.data(b.bloccato_il)) + '.</span></p>'
      // Data spostata in avanti (o tolta) dopo il blocco: avviso e tasto Sblocca lì accanto.
      // Mai sbloccare da solo (Umberto, 3.11.2026): decide chi guarda la scheda.
      if (!f || f >= oggi) {
        var puo = !puoGestire(o)
        h += '<div id="ps-sblocca-data">' + AC.avviso('warn', '<strong>Accesso bloccato ma data spostata: sbloccare?</strong><br>' +
          'La fine rapporto ora è ' + (f ? '<strong>' + esc(AC.data(f)) + '</strong>' : '<strong>vuota</strong> (tempo indeterminato)') +
          ', ma l\'accesso è ancora bloccato dal ' + esc(AC.data(b.bloccato_il)) + '. Non si sblocca da solo.' +
          (puo ? '<div class="azioni-riga"><a class="btn btn-primario btn-largo" href="#persona/' + esc(o.id) + '/accesso/sblocca">' + ico('chiave') + '<span>Sblocca accesso</span></a></div>'
               : '<br>' + esc(puoGestire(o)))) + '</div>'
      }
      return h
    }
    if (!f) return ''
    if (f >= oggi) {
      return ST.sqlBlocchi
        ? '<p class="nota">' + ico('lucchetto') + '<span>' + 'Fine rapporto ' + esc(AC.data(f)) + ': l\'accesso si blocca <strong>da solo dal ' + esc(AC.data(giornoDopo(f))) + '</strong>.</span></p>'
        : AC.avviso('warn', 'Fine rapporto ' + esc(AC.data(f)) + '. Il blocco automatico non è ancora attivo (manca l\'SQL ANAG_F2_07): dal ' + esc(AC.data(giornoDopo(f))) + ' premi «Blocca accesso».')
    }
    if (s.tipo === 'attivo') {
      if (b && b.data_fine_rapporto === f) return '<p class="nota">' + ico('chiave') + '<span>' + 'Sbloccato a mano dopo la fine rapporto: il database non lo blocca di nuovo per questa data.</span></p>'
      return AC.avviso('warn', '<strong>La fine rapporto (' + esc(AC.data(f)) + ') è passata ma l\'accesso è ancora attivo.</strong> ' +
        (ST.sqlBlocchi ? 'Si blocca da solo entro un\'ora; per bloccarlo subito premi «Blocca accesso».' : 'Premi «Blocca accesso» (il blocco automatico non è ancora attivo: manca l\'SQL ANAG_F2_07).'))
    }
    return ''
  }

  function docDi(id) { return ST.documenti.filter(function (d) { return d.operaio_id === id }).sort(function (a, b) { return String(a.scadenza || '9999').localeCompare(String(b.scadenza || '9999')) }) }
  function nomeDitta(o) { var k = o && o.ditta_id ? contatto(o.ditta_id) : null; return k ? AC.nomeContatto(k) : '' }
  function fornitori() {
    return ST.contatti.filter(AC.eFornitore).sort(function (a, b) {
      return (a.attivo === false) - (b.attivo === false) || AC.nomeContatto(a).localeCompare(AC.nomeContatto(b), 'it')
    })
  }

  // ── Pezzi di pagina ────────────────────────────────────────────────────────
  function badgeRapporto(o) {
    return eEsterno(o) ? '<span class="badge st-esterno">' + ico('ditta') + ' Esterno</span>'
                       : '<span class="badge st-dipendente">Dipendente</span>'
  }
  function badgeAccesso(o) {
    if (eEsterno(o)) return ''
    var s = statoAccesso(o)
    if (s.tipo === 'attivo') return '<span class="badge st-incorso">' + ico('chiave') + ' Ha l\'accesso</span>'
    if (s.tipo === 'bloccato') return '<span class="badge st-persa">' + ico('lucchetto') + ' Bloccato</span>'
    if (s.tipo === 'illeggibile') return '<span class="badge st-senza">Accesso: non leggibile</span>'
    return ''
  }
  function badgeDocumenti(o) {
    var oggi = AC.oggiIso(), scad = 0, presto = 0
    docDi(o.id).forEach(function (d) { var s = AC.scadenza(d.scadenza, oggi).stato; if (s === 'scaduto') scad++; else if (s === 'presto') presto++ })
    var h = ''
    if (scad) h += '<span class="badge st-persa">' + ico('attenzione') + ' ' + scad + (scad === 1 ? ' documento scaduto' : ' documenti scaduti') + '</span>'
    if (presto) h += '<span class="badge st-presto">' + ico('attenzione') + ' ' + presto + ' in scadenza</span>'
    return h
  }
  function rigaPersona(o, scelta) {
    var sotto = eEsterno(o) ? [nomeDitta(o) || 'ditta non scelta', o.ruolo].filter(Boolean).join(' · ')
                            : [o.ruolo, o.agenzia ? 'agenzia ' + (o.nome_agenzia || '') : ''].filter(Boolean).join(' · ')
    return '<button type="button" class="riga' + (scelta ? ' riga-scelta' : '') + '" data-apri-persona="' + esc(o.id) + '">' +
      '<span class="riga-testo"><span class="riga-nome">' + esc(nome(o)) + '</span>' +
      (sotto ? '<span class="riga-sotto">' + esc(sotto) + '</span>' : '') +
      '<span class="riga-badge">' + (eEsterno(o) ? badgeRapporto(o) : '') + badgeAccesso(o) + badgeDocumenti(o) + '</span></span>' +
      '</button>'
  }

  // ── ELENCO ─────────────────────────────────────────────────────────────────
  function passaRicerca(o) {
    if (!ST.cerca) return true
    var t = AC.normale([o.nome, o.cognome, o.ruolo, nomeDitta(o), o.nome_agenzia].join(' '))
    return AC.normale(ST.cerca).split(' ').every(function (p) { return t.indexOf(p) >= 0 })
  }
  function ordina(a, b) { return String(a.cognome || '').localeCompare(String(b.cognome || ''), 'it') || String(a.nome || '').localeCompare(String(b.nome || ''), 'it') }

  function disegnaElenco(idScelto) {
    var oggi = AC.oggiIso()
    var tutte = ST.operai.filter(passaRicerca).sort(ordina)
    var dip = tutte.filter(function (o) { return attiva(o, oggi) && !eEsterno(o) })
    var est = tutte.filter(function (o) { return attiva(o, oggi) && eEsterno(o) })
    var ex = tutte.filter(function (o) { return !attiva(o, oggi) })

    var h = ''
    if (!ST.sqlEsterni) h += AC.avviso('warn', '<strong>Il database non è ancora aggiornato</strong> (manca l\'SQL ANAG_F2_01): il campo «Rapporto» (Dipendente / Esterno) non si può ancora salvare.')
    h += '<div class="barra-elenco">' +
      '<label class="cerca">' + ico('cerca') + '<span class="nascosto">Cerca</span>' +
        '<input id="ps-cerca" type="search" autocomplete="off" placeholder="Cerca nome, mansione, ditta" value="' + esc(ST.cerca) + '"></label>' +
      '<button type="button" class="btn btn-primario" data-ps-azione="nuova">' + ico('piu') + '<span>Nuova persona</span></button>' +
      '</div>'

    h += '<h2 class="sezione-titolo">' + ico('persone') + 'Dipendenti <span class="sezione-nota">' + dip.length + '</span></h2>'
    h += '<div class="elenco" aria-live="polite">' + (dip.length ? dip.map(function (o) { return rigaPersona(o, o.id === idScelto) }).join('')
          : '<div class="vuoto">' + (ST.cerca ? 'Nessun dipendente per «' + esc(ST.cerca) + '».' : 'Nessun dipendente attivo.') + '</div>') + '</div>'

    h += '<h2 class="sezione-titolo">' + ico('ditta') + 'Esterni <span class="sezione-nota">ditte esterne, niente paga · ' + est.length + '</span></h2>'
    h += '<div class="elenco">' + (est.length ? est.map(function (o) { return rigaPersona(o, o.id === idScelto) }).join('')
          : '<div class="vuoto">' + (ST.cerca ? 'Nessun esterno per «' + esc(ST.cerca) + '».' : 'Nessun esterno. Con «Nuova persona» scegli «Esterno».') + '</div>') + '</div>'

    if (ex.length) {
      h += '<button type="button" class="btn btn-secondario btn-largo btn-sezione" data-ps-azione="ex" aria-expanded="' + ST.mostraEx + '">' +
           ico(ST.mostraEx ? 'chiudi' : 'persone') + '<span>' + (ST.mostraEx ? 'Nascondi' : 'Mostra') + ' chi non lavora più con noi (' + ex.length + ')</span></button>'
      if (ST.mostraEx) h += '<div class="elenco elenco-ex">' + ex.map(function (o) { return rigaPersona(o, o.id === idScelto) }).join('') + '</div>'
    }
    el('pane-elenco').innerHTML = h
    var c = el('ps-cerca')
    c.addEventListener('input', function () {
      ST.cerca = c.value
      var pos = c.selectionStart
      disegnaElenco(idScelto)
      var c2 = el('ps-cerca'); c2.focus(); try { c2.setSelectionRange(pos, pos) } catch (_) {}
    })
  }

  // ── SCHEDA ─────────────────────────────────────────────────────────────────
  function dato(etichetta, valoreHtml) {
    return '<div class="dato"><div class="dato-etichetta">' + esc(etichetta) + '</div><div class="dato-valore">' + (valoreHtml || '<span class="vuoto-inline">—</span>') + '</div></div>'
  }
  function testata(titolo, badge, azioni, indietro) {
    return '<div class="testata-dettaglio">' +
      '<a class="btn btn-testo solo-telefono" href="' + esc(indietro || '#persone') + '">' + ico('indietro') + '<span>Indietro</span></a>' +
      '<div class="testata-dettaglio-riga"><h2 class="titolo-dettaglio">' + esc(titolo) + '</h2>' + (badge || '') + '</div>' +
      (azioni ? '<div class="azioni-testata">' + azioni + '</div>' : '') + '</div>'
  }

  async function disegnaScheda(id) {
    var pane = el('pane-dettaglio')
    var o = perId(id)
    if (!o) { pane.innerHTML = AC.avviso('warn', 'Questa persona non c\'è (o non è leggibile). <a href="#persone">Torna all\'elenco</a>.'); return }
    var oggi = AC.oggiIso()
    var h = testata(nome(o), badgeRapporto(o) + (attiva(o, oggi) ? '' : '<span class="badge st-senza">Non lavora più con noi</span>'),
      '<a class="btn btn-primario" href="#persona/' + esc(o.id) + '/modifica">' + ico('modifica') + '<span>Modifica</span></a>')
    if (ST.messaggio) { h += AC.avviso(ST.messaggio.tipo, ST.messaggio.html); ST.messaggio = null }

    // Rapporto
    if (eEsterno(o)) {
      var k = o.ditta_id ? contatto(o.ditta_id) : null
      h += '<div class="blocco blocco-esterno"><h3 class="blocco-titolo">' + ico('ditta') + 'Esterno</h3>' +
        dato('Ditta', k ? '<strong>' + esc(AC.nomeContatto(k)) + '</strong>' + (k.citta ? '<span class="dato-sotto">' + esc(k.citta) + '</span>' : '') +
          (k.attivo === false ? '<span class="badge st-senza">Ditta archiviata</span>' : '') +
          '<div class="azioni-riga">' + AC.telLink(k.cellulare || k.telefono, 'Chiama la ditta') + '</div>'
          : (o.ditta_id ? AC.avviso('warn', 'La ditta collegata non è leggibile dai contatti.') : AC.avviso('warn', '<strong>Ditta non scelta.</strong> Con «Modifica» scegli la ditta dall\'elenco dei fornitori.'))) +
        '<p class="nota">' + ico('info') + 'Lavora per noi con la sua ditta: niente busta paga (paghiamo la fattura della ditta), niente accesso alle app.</p></div>'
    }

    // Dati principali
    h += '<div class="blocco">' +
      dato('Mansione', esc(o.ruolo || '')) +
      dato('Telefono', o.telefono ? esc(o.telefono) + '<div class="azioni-riga">' + AC.telLink(o.telefono) + '</div>' : '') +
      dato('Email', o.email ? esc(o.email) : '') +
      dato(eEsterno(o) ? 'Lavora con noi dal' : 'Assunto il', esc(o.data_assunzione ? AC.data(o.data_assunzione) : '')) +
      dato('Fine rapporto', o.data_fine_rapporto ? esc(AC.data(o.data_fine_rapporto)) : '<span class="vuoto-inline">nessuna (tempo indeterminato)</span>') +
      (!eEsterno(o) && o.agenzia ? dato('Agenzia (interinale)', esc(o.nome_agenzia || 'sì')) : '') +
      '</div>'

    h += '<div id="ps-accesso">' + htmlAccesso(o) + '</div>'
    h += '<div id="ps-dp"><div class="blocco"><p class="nota">Carico i dati personali…</p></div></div>'
    h += '<div id="ps-ce"></div>'
    h += '<div id="ps-doc">' + htmlDocumenti(o) + '</div>'
    h += htmlFine(o)
    pane.innerHTML = h
    await caricaDettagli(o)
  }

  async function caricaDettagli(o) {
    try {
      var r = await Promise.all([
        AD.leggi('operai_dati_personali', COL_DP, function (q) { return q.eq('operaio_id', o.id) }),
        AD.leggi('operai_contatti_emergenza', COL_CE, function (q) { return q.eq('operaio_id', o.id).order('created_at') })
      ])
      ST.dp[o.id] = r[0][0] || null
      ST.ce[o.id] = r[1]
      var x = el('ps-dp'); if (x) x.innerHTML = htmlDatiPersonali(o)
      var y = el('ps-ce'); if (y) y.innerHTML = htmlEmergenza(o)
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      var z = el('ps-dp'); if (z) z.innerHTML = AC.avviso('err', 'Dati personali e contatti d\'emergenza NON caricati: ' + esc(e.message))
    }
  }

  // ── Archivia / Cancella (v7) ──────────────────────────────────────────────
  // Controllo da user_id e ruolo, MAI dal nome. null = si può cancellare, altrimenti il motivo.
  function noCancella(o) {
    if (!o.user_id) return null
    if (ST.utente && o.user_id === ST.utente.id) return 'È la tua scheda: non puoi cancellarla.'
    var p = profilo(o.user_id)
    if (!p) return 'Non riesco a leggere il ruolo del suo account: finché non si legge, la scheda non si cancella.'
    if (p.ruolo === 'titolare') return 'Scheda collegata a un account titolare: non si cancella.'
    return null
  }
  function schedaMiaOTitolare(o) {
    if (!o.user_id) return false
    var p = profilo(o.user_id)
    return (ST.utente && o.user_id === ST.utente.id) || (p && p.ruolo === 'titolare')
  }
  function htmlFine(o) {
    var h = '<div class="blocco blocco-tenue" id="ps-fine"><h3 class="blocco-titolo">' + ico('lucchetto') + 'Archivia o cancella</h3>'
    var az = ''
    if (attiva(o)) {
      if (!schedaMiaOTitolare(o)) {
        h += '<p class="nota">Non lavora più con noi? Archivia: i dati restano tutti (ore, buste paga, documenti).</p>'
        az += '<button type="button" class="btn btn-primario" data-ps-azione="archivia">' + ico('lucchetto') + '<span>Archivia</span></button>'
      }
    } else {
      h += '<p class="nota">' + ico('lucchetto') + '<span>Archiviata: è fra «chi non lavora più con noi».' + (o.data_fine_rapporto ? ' Ultimo giorno ' + esc(AC.data(o.data_fine_rapporto)) + '.' : '') + '</span></p>'
      if (o.attivo !== false) az += '<button type="button" class="btn btn-secondario" data-ps-azione="rimetti">' + ico('persone') + '<span>Rimetti fra gli attivi</span></button>'
    }
    if (ST.utente && ST.utente.ruolo === 'titolare') {
      var no = noCancella(o)
      if (no) h += '<p class="nota" id="ps-no-cancella">' + ico('lucchetto') + '<span>' + esc(no) + '</span></p>'
      else az += '<button type="button" class="btn btn-pericolo" data-ps-azione="cancella">' + ico('togli') + '<span>Cancella</span></button>'
    }
    if (az) h += '<div class="azioni-riga">' + az + '</div>'
    h += '<div id="ps-fine-msg"></div></div>'
    return az || h.indexOf('ps-no-cancella') >= 0 || !attiva(o) ? h : ''
  }
  // Dopo Archivia / Rimetti: si rilegge tutto (la fine rapporto può aver bloccato l'accesso).
  async function ridisegnaPersona(id) {
    ST.caricato = false
    try { await mostra(['persona', id], ST.utente) } catch (e) { if (e.sessioneAssente) return APP.sessioneScaduta(); el('pane-dettaglio').innerHTML = AC.avviso('err', esc(e.message)) }
  }
  function apriArchivia(o) {
    var oggi = AC.oggiIso(), acc = o.user_id && !schedaMiaOTitolare(o)
    var corpo = '<p>Resta fra «chi non lavora più con noi», con tutti i suoi dati. Niente si perde: si può rimettere fra gli attivi.</p>' +
      campo('cx-fine', 'Ultimo giorno di lavoro', input('cx-fine', o.data_fine_rapporto || oggi, '', 'date'), 'Dal giorno dopo non compare più negli elenchi di lavoro.', true) +
      (acc ? AC.avviso('warn', 'Ha un accesso alle app: si blocca da solo dal giorno dopo (se la data è già passata, subito).') : '') +
      '<div id="cx-archivia-msg"></div><div class="vela-azioni">' + CX.bottone('salva', 'Archivia', 'btn-primario', 'lucchetto', 'cx-primo') + CX.bottone('chiudi', 'Annulla', 'btn-secondario', 'chiudi') + '</div>'
    CX.schermo('Archivia ' + nome(o), corpo, {
      salva: async function () {
        var d = el('cx-fine').value, msg = el('cx-archivia-msg')
        msg.innerHTML = ''
        if (!d) { msg.innerHTML = AC.avviso('err', 'Scrivi l\'ultimo giorno di lavoro.'); return }
        if (o.data_assunzione && d < o.data_assunzione) { msg.innerHTML = AC.avviso('err', 'L\'ultimo giorno è prima dell\'inizio (' + esc(AC.data(o.data_assunzione)) + ').'); return }
        try {
          await AD.aggiorna('operai', o.id, { data_fine_rapporto: d }, ST.sqlEsterni ? COL_OPERAI : COL_OPERAI_VECCHIE)
          ST.messaggio = { tipo: 'ok', html: '<strong>' + esc(nome(o)) + '</strong> archiviato: ultimo giorno ' + esc(AC.data(d)) + '. I dati restano tutti.' }
          await CX.chiudi()
          await ridisegnaPersona(o.id)
        } catch (e) {
          if (e.sessioneAssente) return APP.sessioneScaduta()
          msg.innerHTML = AC.avviso('err', '<strong>NON archiviato.</strong> ' + esc(spiega(e)))
        }
      }
    })
  }
  async function rimetti(o) {
    var box = el('ps-fine-msg')
    try {
      await AD.aggiorna('operai', o.id, { data_fine_rapporto: null }, ST.sqlEsterni ? COL_OPERAI : COL_OPERAI_VECCHIE)
      ST.messaggio = { tipo: 'ok', html: 'Rimesso fra gli attivi.' }
      await ridisegnaPersona(o.id)
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      if (box) box.innerHTML = AC.avviso('err', '<strong>NON salvato.</strong> ' + esc(spiega(e)))
    }
  }
  function apriCancella(o) {
    if (noCancella(o)) return                     // il tasto non c'è: seconda difesa
    var s = statoAccesso(o), mail = o.email || ''
    var avvisoAccesso = null
    if (o.user_id) {
      avvisoAccesso = '<strong>Ha un accesso alle app' + (mail ? ' (' + esc(mail) + ')' : '') + '.</strong> ' +
        (s.tipo === 'bloccato' ? 'È già bloccato e resta bloccato.' : 'Prima di cancellare lo blocco: non potrà più entrare in nessuna app.') +
        ' L\'account resta, bloccato, senza scheda.'
    }
    CX.cancella({
      tipo: 'persona', id: o.id, nome: nome(o), elenco: '#persone', utente: ST.utente,
      archivia: attiva(o) && !schedaMiaOTitolare(o) ? function () { apriArchivia(o) } : null,
      cosaArchivia: 'resta fra «chi non lavora più con noi», con tutti i suoi dati',
      giaArchiviato: attiva(o) ? null : 'È già archiviata: è fra «chi non lavora più con noi».',
      avvisoAccesso: avvisoAccesso,
      notaFatto: o.user_id ? 'Il suo accesso è bloccato: l\'account resta, senza scheda.' : '',
      primaDi: o.user_id ? function () { return bloccaPrimaDiCancellare(o) } : null,
      file: { bucket: BUCKET_DOC, cartella: o.id, parole: 'I file dei documenti' }
    })
  }
  // Stesso meccanismo di «Blocca accesso», PRIMA di cancellare (la funzione trova l'account dalla scheda).
  // Restituisce la funzione per tornare indietro se poi la cancellazione non riesce.
  async function bloccaPrimaDiCancellare(o) {
    var stati = await AD.rpc('anag_stato_accessi')
    var a = (stati || []).filter(function (x) { return x.user_id === o.user_id })[0]
    if (!a) throw new Error('non riesco a leggere il suo accesso: non blocco e non cancello.')
    if (a.bloccato) return null
    await AD.funzione('gestisci-accesso', { azione: 'blocca', operaio_id: o.id })
    var sblocca = function () { return AD.funzione('gestisci-accesso', { azione: 'sblocca', operaio_id: o.id }) }
    var dopo = await AD.rpc('anag_stato_accessi')
    var b = (dopo || []).filter(function (x) { return x.user_id === o.user_id })[0]
    if (!b || !b.bloccato) {
      try { await sblocca() } catch (_) { /* si dice sotto */ }
      throw new Error('l\'accesso non risulta bloccato: non cancello. Controlla l\'email della scheda.')
    }
    return sblocca
  }

  // ── Accesso (riquadro) ────────────────────────────────────────────────────
  function puoGestire(o) {
    // ritorna null se si può, altrimenti il motivo
    var p = o.user_id ? profilo(o.user_id) : null
    if (p && p.ruolo === 'titolare') return 'I titolari si gestiscono solo dal dashboard di Supabase.'
    if (ST.utente && ST.utente.ruolo === 'responsabile' && p && ['caposquadra', 'operaio', 'magazziniere'].indexOf(p.ruolo) < 0)
      return 'Questo accesso lo gestisce solo il titolare.'
    if (o.user_id && ST.utente && o.user_id === ST.utente.id) return 'È il tuo accesso: non lo cambi da qui.'
    return null
  }
  function htmlAccesso(o) {
    var h = '<div class="blocco"><h3 class="blocco-titolo">' + ico('chiave') + 'Accesso alle app</h3>'
    if (eEsterno(o)) {
      return h + '<p class="nota">' + ico('lucchetto') + 'Esterno: per ora niente accesso alle app (deciso da Umberto). Il database non lo permette.</p></div>'
    }
    var s = statoAccesso(o)
    var p = o.user_id ? profilo(o.user_id) : null
    if (ST.esitoAccesso && ST.esitoAccesso.id === o.id) {
      h += AC.avviso('ok', '<strong>Accesso pronto.</strong> Comunica a ' + esc(nome(o)) + ':<br>Email: <strong>' + esc(ST.esitoAccesso.email) + '</strong>' +
        (ST.esitoAccesso.password ? '<br>Password: <strong>' + esc(ST.esitoAccesso.password) + '</strong><br><small>La password si vede solo adesso: annotala o dilla a voce.</small>' : '<br>(Aveva già un account: usa la sua password.)'))
      ST.esitoAccesso = null
    }
    if (s.tipo === 'nessuno') {
      h += dato('Stato', 'Nessun accesso') +
        '<div class="azioni-riga"><a class="btn btn-primario" href="#persona/' + esc(o.id) + '/accesso/dai">' + ico('chiave') + '<span>Dai accesso</span></a></div>'
      if (!ST.sqlEsterni) h += '<p class="nota">' + ico('info') + 'Serve l\'SQL ANAG_F2_02 per dare l\'accesso da qui.</p>'
      return h + '</div>'
    }
    var statoHtml = s.tipo === 'attivo' ? '<span class="badge st-incorso">' + ico('chiave') + ' Attivo</span>'
      : s.tipo === 'bloccato' ? '<span class="badge st-persa">' + ico('lucchetto') + ' Bloccato</span>'
      : '<span class="badge st-senza">Stato non leggibile</span>' + (ST.accessiErrore ? '<span class="dato-sotto">' + esc(ST.accessiErrore) + '</span>' : '')
    h += dato('Stato', statoHtml + (s.ultimo ? '<span class="dato-sotto">ultimo accesso ' + esc(AC.data(s.ultimo)) + '</span>' : '')) +
         dato('Ruolo nell\'app', esc(nomeRuoloApp(p && p.ruolo)) + '<span class="dato-sotto">non è la mansione: decide cosa vede nelle app</span>') +
         dato('Contabilità', '<span class="vuoto-inline">solo il titolare (per ora non si apre a nessun altro)</span>')
    h += notaFineRapporto(o, s, p)
    var no = puoGestire(o)
    if (no) return h + '<p class="nota">' + ico('lucchetto') + esc(no) + '</p></div>'
    h += '<div class="azioni-riga">' +
      (s.tipo === 'bloccato'
        ? '<a class="btn btn-primario" href="#persona/' + esc(o.id) + '/accesso/sblocca">' + ico('chiave') + '<span>Sblocca accesso</span></a>'
        : '<a class="btn btn-secondario" href="#persona/' + esc(o.id) + '/accesso/blocca">' + ico('lucchetto') + '<span>Blocca accesso</span></a>') +
      '<a class="btn btn-secondario" href="#persona/' + esc(o.id) + '/accesso/password">' + ico('chiave') + '<span>Nuova password</span></a>' +
      '<a class="btn btn-secondario" href="#persona/' + esc(o.id) + '/accesso/email">' + ico('email') + '<span>Cambia email</span></a>' +
      (ST.utente && ST.utente.ruolo === 'titolare' ? '<a class="btn btn-secondario" href="#persona/' + esc(o.id) + '/accesso/ruolo">' + ico('persone') + '<span>Cambia ruolo</span></a>' : '') +
      '</div></div>'
    return h
  }

  // ── Dati personali (riquadro) ─────────────────────────────────────────────
  function htmlDatiPersonali(o) {
    var d = ST.dp[o.id] || {}
    var perm = d.permesso_scadenza ? AC.scadenza(d.permesso_scadenza) : null
    var indirizzo = [d.via, [d.cap, d.localita].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    return '<div class="blocco"><h3 class="blocco-titolo">' + ico('documento') + 'Dati personali <span class="sezione-nota">solo titolare e responsabile</span></h3>' +
      dato('Data di nascita', esc(d.data_nascita ? AC.data(d.data_nascita) : '')) +
      dato('Indirizzo', esc(indirizzo)) +
      dato('Numero AVS', esc(d.numero_avs || '')) +
      dato('Permesso', esc(d.permesso_tipo || '') + (perm ? ' <span class="badge ' + classeScadenza(perm.stato) + '">' + esc(perm.testo) + '</span>' : '')) +
      (d.motivo_uscita ? dato('Motivo uscita', esc(d.motivo_uscita)) : '') +
      dato('Note riservate', d.note_riservate ? esc(d.note_riservate).replace(/\n/g, '<br>') : '') +
      '<div class="azioni-riga"><a class="btn btn-secondario" href="#persona/' + esc(o.id) + '/dati">' + ico('modifica') + '<span>Modifica dati personali</span></a></div></div>'
  }
  function classeScadenza(s) { return s === 'scaduto' ? 'st-persa' : s === 'presto' ? 'st-presto' : 'st-dafare' }

  // ── Contatti d'emergenza (riquadro) ───────────────────────────────────────
  function htmlEmergenza(o) {
    var lista = ST.ce[o.id] || []
    var h = '<div class="blocco"><h3 class="blocco-titolo">' + ico('emergenza') + 'Contatti d\'emergenza</h3>'
    if (!lista.length) h += '<p class="nota">' + ico('attenzione') + 'Nessun contatto d\'emergenza: aggiungine almeno uno.</p>'
    h += lista.map(function (c) {
      return '<div class="dato"><div class="dato-valore"><strong>' + esc(c.nome) + '</strong>' + (c.relazione ? ' <span class="dato-sotto">' + esc(c.relazione) + '</span>' : '') +
        '<span class="dato-sotto">' + esc(c.telefono) + '</span></div>' +
        '<div class="azioni-riga">' + AC.telLink(c.telefono) +
        '<a class="btn btn-secondario btn-piccolo" href="#persona/' + esc(o.id) + '/emergenza/' + esc(c.id) + '">' + ico('modifica') + '<span>Modifica</span></a></div></div>'
    }).join('')
    return h + '<div class="azioni-riga"><a class="btn btn-secondario" href="#persona/' + esc(o.id) + '/emergenza/nuovo">' + ico('piu') + '<span>Aggiungi contatto d\'emergenza</span></a></div></div>'
  }

  // ── Documenti (riquadro) ──────────────────────────────────────────────────
  function htmlDocumenti(o) {
    var oggi = AC.oggiIso(), lista = docDi(o.id)
    var h = '<div class="blocco"><h3 class="blocco-titolo">' + ico('documento') + 'Documenti</h3>'
    if (!lista.length) h += '<p class="nota">Nessun documento.</p>'
    h += lista.map(function (d) {
      var s = AC.scadenza(d.scadenza, oggi)
      return '<div class="dato doc-' + s.stato + '"><div class="dato-valore"><strong>' + esc(d.tipo) + '</strong> ' +
        '<span class="badge ' + classeScadenza(s.stato) + '">' + (s.stato === 'scaduto' || s.stato === 'presto' ? ico('attenzione') + ' ' : '') + esc(s.testo) + '</span>' +
        (d.note ? '<span class="dato-sotto">' + esc(d.note) + '</span>' : '') + '</div>' +
        '<div class="azioni-riga">' +
        (d.file_path ? '<button type="button" class="btn btn-secondario btn-piccolo" data-ps-file="' + esc(d.file_path) + '">' + ico('apri') + '<span>Apri il file</span></button>' : '') +
        '<a class="btn btn-secondario btn-piccolo" href="#persona/' + esc(o.id) + '/documento/' + esc(d.id) + '">' + ico('modifica') + '<span>Modifica</span></a></div></div>'
    }).join('')
    return h + '<div class="azioni-riga"><a class="btn btn-secondario" href="#persona/' + esc(o.id) + '/documento/nuovo">' + ico('piu') + '<span>Aggiungi documento</span></a></div></div>'
  }

  // ── Campi dei moduli ──────────────────────────────────────────────────────
  function campo(id, etichetta, controllo, aiuto, obbligatorio) {
    return '<div class="campo" id="campo-' + id + '">' +
      '<label for="' + id + '">' + esc(etichetta) + (obbligatorio ? ' <span class="obbl">obbligatorio</span>' : '') + '</label>' +
      controllo + (aiuto ? '<div class="campo-aiuto">' + aiuto + '</div>' : '') +
      '<div class="campo-errore" id="err-' + id + '" hidden></div></div>'
  }
  function input(id, valore, extra, tipo) {
    return '<input id="' + id + '" type="' + (tipo || 'text') + '" value="' + esc(valore == null ? '' : valore) + '"' + (extra || '') + '>'
  }
  function puliziaErrori(radice) {
    radice.querySelectorAll('.campo-errore').forEach(function (x) { x.hidden = true; x.textContent = '' })
    radice.querySelectorAll('.campo-sbagliato').forEach(function (x) { x.classList.remove('campo-sbagliato') })
  }
  function erroreCampo(id, testo) {
    var ctrl = el(id), err = el('err-' + id), box = el('campo-' + id)
    if (box) box.classList.add('campo-sbagliato')
    if (ctrl) ctrl.setAttribute('aria-invalid', 'true')
    if (err) { err.textContent = testo; err.hidden = false }
    var vai = ctrl || box
    if (vai) { vai.scrollIntoView({ behavior: 'smooth', block: 'center' }); if (vai.focus) vai.focus() }
    return false
  }
  function v(id) { var x = el(id); return x ? String(x.value || '').trim() : '' }
  function vuotoNull(s) { s = String(s == null ? '' : s).trim(); return s || null }
  function barraSalva(indietro, testo) {
    return '<div id="ps-avvisi"></div><div class="barra-salva">' +
      '<a class="btn btn-secondario" data-libera="1" href="' + esc(indietro) + '">' + ico('chiudi') + '<span>Annulla</span></a>' +
      '<button type="submit" class="btn btn-primario" id="ps-salva">' + ico('salva') + '<span>' + esc(testo || 'Salva') + '</span></button></div>'
  }
  function erroreSalva(e) {
    if (e.sessioneAssente) return APP.sessioneScaduta()
    var b = el('ps-salva'); if (b) b.disabled = false
    var x = el('ps-avvisi'); if (!x) return
    x.innerHTML = AC.avviso('err', '<strong>NON salvato.</strong> ' + esc(spiega(e)))
    x.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  function spiega(e) {
    var m = String(e && e.message || e)
    if (/anag_operai_esterno_senza_account_ck/.test(m)) return 'questa persona ha un accesso alle app: un Esterno non può averlo.'
    if (/anag_operai_ditta_fk/.test(m)) return 'la ditta scelta non c\'è più fra i contatti: scegline un\'altra.'
    if (/anag_operai_ditta_solo_esterni_ck/.test(m)) return 'la ditta si mette solo agli Esterni.'
    if (/anag_documenti_file_per_id_ck/.test(m)) return 'il file non è nella cartella della persona.'
    if (/rapporto|ditta_id/.test(m) && /column|colonna/i.test(m)) return 'il database non è ancora aggiornato (manca l\'SQL ANAG_F2_01).'
    if (/row-level security|violates row-level|permission denied|0 righe/i.test(m)) return 'il database non ti dà il permesso. Esci, rientra e riprova; se resta così, chiedi al titolare.'
    return m
  }

  // ── MODULO PERSONA (nuova / modifica) ─────────────────────────────────────
  function bozzaVuota() {
    return { id: null, nome: '', cognome: '', rapporto: 'dipendente', ditta_id: null, ruolo: '', telefono: '', email: '',
             data_assunzione: '', data_fine_rapporto: '', agenzia: false, nome_agenzia: '', nuovaDitta: false }
  }
  function bozzaDa(o) {
    return { id: o.id, nome: o.nome || '', cognome: o.cognome || '', rapporto: o.rapporto || 'dipendente', ditta_id: o.ditta_id || null,
             ruolo: o.ruolo || '', telefono: o.telefono || '', email: o.email || '', data_assunzione: o.data_assunzione || '',
             data_fine_rapporto: o.data_fine_rapporto || '', agenzia: !!o.agenzia, nome_agenzia: o.nome_agenzia || '', nuovaDitta: false,
             user_id: o.user_id || null, rapportoPrima: o.rapporto || 'dipendente' }
  }
  function leggiModulo() {
    var f = ST.form; if (!f) return
    ;['nome', 'cognome', 'ruolo', 'telefono', 'email', 'data_assunzione', 'data_fine_rapporto', 'nome_agenzia'].forEach(function (k) {
      var x = el('ps-' + k); if (x && !x.readOnly) f[k] = x.value
    })
    var r = document.querySelector('input[name="ps-rapporto"]:checked'); if (r) f.rapporto = r.value
    var a = el('ps-agenzia'); if (a) f.agenzia = a.checked
  }

  function disegnaModulo() {
    var f = ST.form, pane = el('pane-dettaglio')
    var orig = f.id ? perId(f.id) : null
    var esterno = f.rapporto === 'esterno'
    var indietro = f.id ? '#persona/' + f.id : '#persone'
    var h = '<form id="ps-modulo" novalidate>' + testata(f.id ? 'Modifica ' + nome(orig) : 'Nuova persona', '', '', indietro)

    // RAPPORTO, grande e chiaro, per primo
    h += '<div class="blocco"><fieldset class="scelta scelta-grande" id="campo-ps-rapporto"><legend>Rapporto <span class="obbl">obbligatorio</span></legend>' +
      '<label class="scelta-carta' + (!esterno ? ' scelta-carta-attiva' : '') + '"><input type="radio" name="ps-rapporto" value="dipendente"' + (!esterno ? ' checked' : '') + '>' +
        '<span><strong>Dipendente</strong><span class="dato-sotto">ha la busta paga</span></span></label>' +
      '<label class="scelta-carta' + (esterno ? ' scelta-carta-attiva' : '') + '"><input type="radio" name="ps-rapporto" value="esterno"' + (esterno ? ' checked' : '') + '>' +
        '<span><strong>' + ico('ditta') + ' Esterno</strong><span class="dato-sotto">lavora con la sua ditta, paghiamo la fattura</span></span></label>' +
      '<div class="campo-errore" id="err-ps-rapporto" hidden></div></fieldset>'
    if (!ST.sqlEsterni) h += AC.avviso('warn', 'Il database non ha ancora il campo «Rapporto» (SQL ANAG_F2_01): per ora si salva solo come Dipendente.')
    if (esterno && f.id && f.rapportoPrima !== 'esterno') {
      h += AC.avviso('info', 'Diventa <strong>Esterno</strong>: da ora Paghe e stipendi non lo mostrano più. I dati paga già salvati restano (non si cancella niente). Niente accesso alle app.')
    }
    if (esterno && f.user_id) {
      h += AC.avviso('err', '<strong>Ha un accesso alle app.</strong> Un Esterno non può averlo: prima va tolto l\'accesso (lo fa chi gestisce il database). Finché c\'è, resta Dipendente.')
    }
    if (esterno) h += '<div id="ps-ditta">' + htmlDitta() + '</div>'
    h += '</div>'

    // Chi è
    h += '<div class="blocco"><div class="campi-due campi-pari">' +
      campo('ps-nome', 'Nome', input('ps-nome', f.nome, ' autocomplete="off" maxlength="80"'), '', true) +
      campo('ps-cognome', 'Cognome', input('ps-cognome', f.cognome, ' autocomplete="off" maxlength="80"'), '', true) + '</div>' +
      campo('ps-ruolo', 'Mansione', input('ps-ruolo', f.ruolo, ' list="ps-mansioni" autocomplete="off" maxlength="80"') +
        '<datalist id="ps-mansioni">' + MANSIONI.map(function (m) { return '<option value="' + esc(m) + '">' }).join('') + '</datalist>',
        'Il lavoro che fa (es. Carpentiere, Lattoniere). Non è il ruolo nelle app.') +
      campo('ps-telefono', 'Telefono', input('ps-telefono', f.telefono, ' autocomplete="off" inputmode="tel" maxlength="40"')) +
      campo('ps-email', 'Email', input('ps-email', f.email, ' autocomplete="off" inputmode="email" maxlength="120"' + (f.user_id ? ' readonly' : '')),
        f.user_id ? 'Ha un accesso alle app: l\'email si cambia solo con «Cambia email» nel riquadro Accesso.' : '') +
      '</div>'

    // Date
    h += '<div class="blocco"><div class="campi-due campi-pari">' +
      campo('ps-data_assunzione', esterno ? 'Lavora con noi dal' : 'Assunto il', input('ps-data_assunzione', f.data_assunzione, '', 'date')) +
      campo('ps-data_fine_rapporto', 'Fine rapporto', input('ps-data_fine_rapporto', f.data_fine_rapporto, '', 'date'), 'È l\'ultimo giorno di lavoro. Vuota = tempo indeterminato. Dal giorno dopo non compare più negli elenchi di lavoro e l\'accesso alle app si blocca da solo.') +
      '</div></div>'

    // Agenzia: solo Dipendenti (interinali). Per un Esterno non si mostra e non si scrive.
    if (!esterno) {
      h += '<div class="blocco"><label class="scelta-voce"><input type="checkbox" id="ps-agenzia"' + (f.agenzia ? ' checked' : '') + '> <span>Lavora tramite un\'agenzia (interinale)</span></label>' +
        '<div id="ps-agenzia-nome"' + (f.agenzia ? '' : ' hidden') + '>' + campo('ps-nome_agenzia', 'Nome agenzia', input('ps-nome_agenzia', f.nome_agenzia, ' autocomplete="off" maxlength="120"')) + '</div></div>'
    }
    h += barraSalva(indietro) + '</form>'
    pane.innerHTML = h

    el('ps-modulo').addEventListener('submit', function (ev) { ev.preventDefault(); salvaPersona() })
    pane.querySelectorAll('input[name="ps-rapporto"]').forEach(function (r) {
      r.addEventListener('change', function () { leggiModulo(); disegnaModulo() })
    })
    var ag = el('ps-agenzia'); if (ag) ag.addEventListener('change', function () { el('ps-agenzia-nome').hidden = !ag.checked })
    collegaDitta()
    var primo = el('ps-nome'); if (primo && !f.id && !f.nome) primo.focus()
  }

  // Ditta dell'Esterno: SEMPRE da elenco dei contatti fornitori, o nuova sul posto
  function htmlDitta() {
    var f = ST.form
    var k = f.ditta_id ? contatto(f.ditta_id) : null
    var h = '<div class="campo" id="campo-ps-ditta"><label for="ps-ditta-cerca">Ditta <span class="obbl">obbligatorio</span></label>'
    if (k) {
      h += '<div class="cliente-scelto"><div><strong>' + esc(AC.nomeContatto(k)) + '</strong>' + (k.citta ? '<span class="dato-sotto">' + esc(k.citta) + '</span>' : '') +
        (k.attivo === false ? '<span class="badge st-senza">Archiviata</span>' : '') + '</div>' +
        '<div class="azioni-riga"><button type="button" class="btn btn-secondario btn-piccolo" data-ps-azione="ditta-cambia">' + ico('modifica') + '<span>Cambia ditta</span></button></div></div>'
    } else if (f.nuovaDitta) {
      h += '<div class="sotto-modulo"><p class="nota">' + ico('info') + 'La ditta nuova va nei Contatti come fornitore.</p>' +
        campo('ps-nd-ragione', 'Nome della ditta', input('ps-nd-ragione', '', ' autocomplete="off" maxlength="160"'), '', true) +
        campo('ps-nd-telefono', 'Telefono della ditta', input('ps-nd-telefono', '', ' autocomplete="off" inputmode="tel" maxlength="40"')) +
        campo('ps-nd-citta', 'Città', input('ps-nd-citta', '', ' autocomplete="off" maxlength="120"')) +
        '<div id="ps-nd-avvisi"></div><div class="azioni-riga">' +
        '<button type="button" class="btn btn-primario btn-piccolo" data-ps-azione="ditta-salva">' + ico('salva') + '<span>Salva la ditta</span></button>' +
        '<button type="button" class="btn btn-secondario btn-piccolo" data-ps-azione="ditta-annulla">' + ico('chiudi') + '<span>Annulla</span></button></div></div>'
    } else {
      var n = fornitori().length
      h += '<label class="cerca">' + ico('cerca') + '<span class="nascosto">Cerca la ditta</span>' +
        '<input id="ps-ditta-cerca" type="search" autocomplete="off" placeholder="Cerca fra i ' + n + ' fornitori"></label>' +
        '<div id="ps-ditta-risultati" class="risultati">' + risultatiDitta('') + '</div>' +
        '<button type="button" class="btn btn-secondario btn-largo" data-ps-azione="ditta-nuova">' + ico('piu') + '<span>Nuova ditta fornitore</span></button>'
    }
    return h + '<div class="campo-errore" id="err-ps-ditta" hidden></div></div>'
  }
  function risultatiDitta(testo) {
    var t = AC.normale(testo), parti = t ? t.split(' ') : []
    var lista = fornitori().filter(function (k) {
      var s = AC.normale(AC.nomeContatto(k) + ' ' + (k.citta || ''))
      return parti.every(function (p) { return s.indexOf(p) >= 0 })
    })
    if (!lista.length) return '<p class="nota">' + (t ? 'Nessun fornitore con «' + esc(testo) + '». ' : 'Nessun fornitore nei contatti. ') + 'Usa «Nuova ditta fornitore».</p>'
    return lista.slice(0, t ? 12 : 8).map(function (k) {
      return '<button type="button" class="riga riga-piccola" data-ps-ditta="' + esc(k.id) + '"><span class="riga-testo"><span class="riga-nome">' + esc(AC.nomeContatto(k)) + '</span>' +
        (k.citta ? '<span class="riga-sotto">' + esc(k.citta) + '</span>' : '') + '</span>' +
        (k.attivo === false ? '<span class="badge st-senza">Archiviata</span>' : '') + '</button>'
    }).join('') + (lista.length > (t ? 12 : 8) ? '<p class="nota">… scrivi qualche lettera per trovare le altre.</p>' : '')
  }
  function collegaDitta() {
    var c = el('ps-ditta-cerca'); if (!c) return
    c.addEventListener('input', function () { el('ps-ditta-risultati').innerHTML = risultatiDitta(c.value) })
  }
  async function salvaNuovaDitta() {
    var ragione = v('ps-nd-ragione'), box = el('ps-ditta')
    puliziaErrori(box)
    if (!ragione) return erroreCampo('ps-nd-ragione', 'Scrivi il nome della ditta.')
    var stesso = ST.contatti.filter(function (k) { return AC.normale(AC.nomeContatto(k)) === AC.normale(ragione) })[0]
    if (stesso && !ST.form.dittaComunque) {
      el('ps-nd-avvisi').innerHTML = AC.avviso('warn', 'Nei contatti c\'è già <strong>' + esc(AC.nomeContatto(stesso)) + '</strong>. È la stessa?' +
        '<div class="azioni-riga"><button type="button" class="btn btn-primario btn-piccolo" data-ps-ditta="' + esc(stesso.id) + '">Sì, usa quella</button>' +
        '<button type="button" class="btn btn-secondario btn-piccolo" data-ps-azione="ditta-comunque">No, salva la nuova</button></div>')
      return
    }
    try {
      var k = await AD.inserisci('tm_contatti', {
        ragione_sociale: ragione, telefono: vuotoNull(v('ps-nd-telefono')), citta: vuotoNull(v('ps-nd-citta')),
        paese: AC.PAESE_PREDEFINITO, categoria: 'fornitore', e_fornitore: true, categorie: ['fornitori'], attivo: true
        // azienda_id: la mette il database (trigger anag_contatti_azienda)
      }, COL_CONTATTI)
      ST.contatti.push(k)
      if (window.CM) CM.ricarica()
      if (window.KT) KT.ricarica()
      ST.form.ditta_id = k.id; ST.form.nuovaDitta = false; ST.form.dittaComunque = false
      el('ps-ditta').innerHTML = htmlDitta()
      el('ps-avvisi').innerHTML = AC.avviso('ok', 'Ditta <strong>' + esc(ragione) + '</strong> salvata nei contatti come fornitore e scelta.')
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      el('ps-nd-avvisi').innerHTML = AC.avviso('err', 'Ditta NON salvata: ' + esc(spiega(e)))
    }
  }

  async function salvaPersona() {
    leggiModulo()
    var f = ST.form, pane = el('pane-dettaglio')
    puliziaErrori(pane); el('ps-avvisi').innerHTML = ''
    var orig = f.id ? perId(f.id) : null
    var esterno = f.rapporto === 'esterno'
    if (!String(f.nome).trim()) return erroreCampo('ps-nome', 'Scrivi il nome.')
    if (!String(f.cognome).trim()) return erroreCampo('ps-cognome', 'Scrivi il cognome.')
    if (esterno && !ST.sqlEsterni) return erroreCampo('ps-rapporto', 'Il database non è ancora aggiornato: per ora non si può salvare un Esterno.')
    if (esterno && f.user_id) return erroreCampo('ps-rapporto', 'Ha un accesso alle app: un Esterno non può averlo. Resta Dipendente finché l\'accesso non è tolto.')
    if (esterno && !f.ditta_id) return erroreCampo('ps-ditta', f.nuovaDitta ? 'Salva prima la ditta nuova (tasto «Salva la ditta»).' : 'Scegli la ditta dall\'elenco dei fornitori (o «Nuova ditta fornitore»).')
    var email = String(f.email || '').trim().toLowerCase()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erroreCampo('ps-email', 'Questa email non sembra giusta.')
    if (f.data_assunzione && f.data_fine_rapporto && f.data_fine_rapporto < f.data_assunzione) return erroreCampo('ps-data_fine_rapporto', 'La fine rapporto è prima dell\'inizio.')
    if (email) {
      var doppia = ST.operai.filter(function (o) { return o.id !== f.id && String(o.email || '').trim().toLowerCase() === email })[0]
      if (doppia) return erroreCampo('ps-email', 'Questa email è già di ' + nome(doppia) + '. Ogni persona ha la sua.')
    }
    // Omonimi: avviso, mai blocco
    if (!orig && !ST.salvaComunque) {
      var omo = ST.operai.filter(function (o) { return AC.normale(nome(o)) === AC.normale(f.nome + ' ' + f.cognome) })[0]
      if (omo) {
        el('ps-avvisi').innerHTML = AC.avviso('warn', 'C\'è già <strong>' + esc(nome(omo)) + '</strong>' + (attiva(omo) ? '' : ' (non lavora più con noi)') + '. È la stessa persona?' +
          '<div class="azioni-riga"><a class="btn btn-primario btn-piccolo" href="#persona/' + esc(omo.id) + '">Sì, apri quella</a>' +
          '<button type="button" class="btn btn-secondario btn-piccolo" data-ps-azione="salva-comunque">No, è un\'altra: salva</button></div>')
        el('ps-avvisi').scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }

    // Fine rapporto che blocca l'accesso: avviso e conferma (mai un blocco per sbaglio)
    var fineNuova = vuotoNull(f.data_fine_rapporto)
    if (orig && orig.user_id && fineNuova && fineNuova !== (orig.data_fine_rapporto || null) && !ST.confermaFine) {
      var pr = profilo(orig.user_id), mia = !!(ST.utente && orig.user_id === ST.utente.id), oggiS = AC.oggiIso()
      var testoConf = null
      if (pr && pr.ruolo === 'titolare') {
        if (mia) testoConf = '<strong>Stai mettendo la fine rapporto alla TUA scheda.</strong> Sei titolare: il tuo accesso NON si blocca da solo, ma dal ' +
          esc(AC.data(giornoDopo(fineNuova))) + ' risulterai «non lavora più con noi» in tutte le app. Confermi?'
      } else if (mia) {
        testoConf = '<strong>Stai mettendo la fine rapporto alla TUA scheda.</strong> ' + (fineNuova < oggiS
          ? 'La data è passata: il tuo accesso si blocca SUBITO e non entri più in nessuna app, nemmeno qui.'
          : 'Dal ' + esc(AC.data(giornoDopo(fineNuova))) + ' il tuo accesso si blocca da solo: non entri più in nessuna app, nemmeno qui.') +
          ' Solo il titolare potrà sbloccarti. Confermi?'
      } else if (fineNuova < oggiS && statoAccesso(orig).tipo === 'attivo') {
        testoConf = 'La fine rapporto ' + esc(AC.data(fineNuova)) + ' è <strong>già passata</strong>: l\'accesso di <strong>' + esc(nome(orig)) +
          '</strong> si blocca SUBITO (non entra più in nessuna app). Confermi?'
      }
      if (testoConf) {
        el('ps-avvisi').innerHTML = AC.avviso('warn', testoConf +
          '<div class="azioni-riga"><button type="button" class="btn btn-primario btn-piccolo" data-ps-azione="fine-conferma">' + ico('salva') + '<span>Sì, salva</span></button>' +
          '<button type="button" class="btn btn-secondario btn-piccolo" data-ps-azione="fine-annulla">' + ico('chiudi') + '<span>No, correggo la data</span></button></div>')
        el('ps-avvisi').scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }

    var riga = {
      nome: String(f.nome).trim(), cognome: String(f.cognome).trim(), ruolo: vuotoNull(f.ruolo),
      telefono: vuotoNull(f.telefono), data_assunzione: vuotoNull(f.data_assunzione), data_fine_rapporto: vuotoNull(f.data_fine_rapporto)
    }
    if (!f.user_id) riga.email = email || null
    if (ST.sqlEsterni) { riga.rapporto = esterno ? 'esterno' : 'dipendente'; riga.ditta_id = esterno ? f.ditta_id : null }
    if (!esterno) { riga.agenzia = !!f.agenzia; riga.nome_agenzia = f.agenzia ? vuotoNull(f.nome_agenzia) : null }

    var b = el('ps-salva'); b.disabled = true
    try {
      var col = ST.sqlEsterni ? COL_OPERAI : COL_OPERAI_VECCHIE, salvata
      if (!orig) {
        salvata = await AD.inserisci('operai', riga, col)
        ST.operai.push(salvata)
        ST.messaggio = { tipo: 'ok', html: '<strong>' + esc(nome(salvata)) + '</strong> salvato' + (esterno ? ' come Esterno (' + esc(nomeDitta(salvata)) + ').' : '.') }
      } else {
        salvata = await AD.aggiorna('operai', orig.id, riga, col)
        ST.operai = ST.operai.map(function (o) { return o.id === salvata.id ? salvata : o })
        ST.messaggio = { tipo: 'ok', html: 'Modifiche salvate.' }
        // la fine rapporto può aver bloccato l'accesso (lo fa il database): rileggo accessi e blocchi
        if (orig.user_id && (salvata.data_fine_rapporto || null) !== (orig.data_fine_rapporto || null)) ST.caricato = false
      }
      if (!salvata.rapporto) salvata.rapporto = 'dipendente'
      ST.form = null; ST.salvaComunque = false; ST.confermaFine = false
      APP.libera()
      location.hash = '#persona/' + salvata.id
    } catch (e) { erroreSalva(e) }
  }

  // ── MODULO DATI PERSONALI ─────────────────────────────────────────────────
  function disegnaDatiPersonali(o) {
    var d = ST.dp[o.id] || {}, indietro = '#persona/' + o.id
    var h = '<form id="ps-dp-modulo" novalidate>' + testata('Dati personali · ' + nome(o), '', '', indietro) +
      AC.avviso('warn', '<strong>Niente dati sanitari</strong> (malattie, allergie, farmaci, certificati medici). Li vedono solo titolare e responsabile.') +
      '<div class="blocco">' + campo('dp-data_nascita', 'Data di nascita', input('dp-data_nascita', d.data_nascita, '', 'date')) +
      campo('dp-via', 'Via e numero', input('dp-via', d.via, ' autocomplete="off" maxlength="160"')) +
      '<div class="campi-due">' + campo('dp-cap', 'CAP', input('dp-cap', d.cap, ' autocomplete="off" inputmode="numeric" maxlength="10" list="dp-cap-lista"') + '<datalist id="dp-cap-lista"></datalist>') +
        campo('dp-localita', 'Località', input('dp-localita', d.localita, ' autocomplete="off" maxlength="120" list="dp-loc-lista"') + '<datalist id="dp-loc-lista"></datalist>') + '</div>' +
      '<div id="dp-cap-aiuto" class="campo-aiuto"></div>' +
      campo('dp-numero_avs', 'Numero AVS', input('dp-numero_avs', d.numero_avs, ' autocomplete="off" inputmode="numeric" maxlength="16" placeholder="756.1234.5678.97"')) + '</div>' +
      '<div class="blocco"><div class="campi-due campi-pari">' +
      campo('dp-permesso_tipo', 'Permesso', '<select id="dp-permesso_tipo">' + ['', 'Svizzero', 'B', 'C', 'G (frontaliere)', 'L', 'F', 'N', 'Altro'].map(function (p) {
        return '<option value="' + esc(p) + '"' + ((d.permesso_tipo || '') === p ? ' selected' : '') + '>' + esc(p || '— nessuno —') + '</option>' }).join('') +
        (d.permesso_tipo && ['Svizzero', 'B', 'C', 'G (frontaliere)', 'L', 'F', 'N', 'Altro'].indexOf(d.permesso_tipo) < 0 ? '<option selected value="' + esc(d.permesso_tipo) + '">' + esc(d.permesso_tipo) + '</option>' : '') + '</select>') +
      campo('dp-permesso_scadenza', 'Permesso valido fino al', input('dp-permesso_scadenza', d.permesso_scadenza, '', 'date')) + '</div></div>' +
      '<div class="blocco">' + campo('dp-motivo_uscita', 'Motivo uscita', input('dp-motivo_uscita', d.motivo_uscita, ' autocomplete="off" maxlength="200"'), 'Solo se non lavora più con noi.') +
      campo('dp-note_riservate', 'Note riservate', '<textarea id="dp-note_riservate" rows="3" maxlength="2000">' + esc(d.note_riservate || '') + '</textarea>', 'Niente dati sanitari.') + '</div>' +
      barraSalva(indietro) + '</form>'
    el('pane-dettaglio').innerHTML = h
    el('ps-dp-modulo').addEventListener('submit', function (ev) { ev.preventDefault(); salvaDatiPersonali(o) })
    if (window.CAP) CAP.collega('dp-cap', 'dp-localita', 'dp-cap-aiuto')
  }
  async function salvaDatiPersonali(o) {
    var pane = el('pane-dettaglio'); puliziaErrori(pane)
    var avs = v('dp-numero_avs')
    if (avs && !/^756\.?\d{4}\.?\d{4}\.?\d{2}$/.test(avs.replace(/\s/g, ''))) return erroreCampo('dp-numero_avs', 'Il numero AVS ha questa forma: 756.1234.5678.97')
    var riga = { operaio_id: o.id }
    ;['data_nascita', 'via', 'cap', 'localita', 'numero_avs', 'permesso_tipo', 'permesso_scadenza', 'motivo_uscita', 'note_riservate'].forEach(function (k) { riga[k] = vuotoNull(v('dp-' + k)) })
    if (riga.numero_avs) { var n = riga.numero_avs.replace(/\D/g, ''); riga.numero_avs = n.slice(0, 3) + '.' + n.slice(3, 7) + '.' + n.slice(7, 11) + '.' + n.slice(11) }
    var b = el('ps-salva'); b.disabled = true
    try {
      ST.dp[o.id] = await AD.upsert('operai_dati_personali', riga, 'operaio_id', COL_DP)
      ST.messaggio = { tipo: 'ok', html: 'Dati personali salvati.' }
      APP.libera()
      location.hash = '#persona/' + o.id
    } catch (e) { erroreSalva(e) }
  }

  // ── MODULO CONTATTO D'EMERGENZA ───────────────────────────────────────────
  function disegnaEmergenza(o, idCe) {
    var c = idCe === 'nuovo' ? {} : (ST.ce[o.id] || []).filter(function (x) { return x.id === idCe })[0]
    var indietro = '#persona/' + o.id
    if (!c) { el('pane-dettaglio').innerHTML = AC.avviso('warn', 'Contatto non trovato. <a href="' + indietro + '">Torna alla scheda</a>.'); return }
    var h = '<form id="ps-ce-modulo" novalidate>' + testata((c.id ? 'Modifica' : 'Nuovo') + ' contatto d\'emergenza', '', '', indietro) +
      '<p class="nota">' + ico('emergenza') + 'Per ' + esc(nome(o)) + '. Chi chiamare se gli succede qualcosa.</p>' +
      '<div class="blocco">' + campo('ce-nome', 'Nome e cognome', input('ce-nome', c.nome, ' autocomplete="off" maxlength="120"'), '', true) +
      campo('ce-telefono', 'Telefono', input('ce-telefono', c.telefono, ' autocomplete="off" inputmode="tel" maxlength="40"'), '', true) +
      campo('ce-relazione', 'Chi è', input('ce-relazione', c.relazione, ' autocomplete="off" maxlength="60" list="ce-rel"') +
        '<datalist id="ce-rel"><option value="Moglie"><option value="Marito"><option value="Compagna"><option value="Compagno"><option value="Madre"><option value="Padre"><option value="Figlio"><option value="Figlia"><option value="Fratello"><option value="Sorella"></datalist>') + '</div>'
    if (c.id) {
      h += '<div class="blocco blocco-tenue" id="ce-togli-box"><button type="button" class="btn btn-secondario" data-ps-azione="ce-togli">' + ico('togli') + '<span>Togli questo contatto</span></button></div>'
    }
    h += barraSalva(indietro) + '</form>'
    el('pane-dettaglio').innerHTML = h
    el('ps-ce-modulo').addEventListener('submit', function (ev) { ev.preventDefault(); salvaEmergenza(o, c) })
    ST.ceAperto = { o: o, c: c }
    if (!c.id) el('ce-nome').focus()
  }
  async function salvaEmergenza(o, c) {
    var pane = el('pane-dettaglio'); puliziaErrori(pane)
    var riga = { nome: v('ce-nome'), telefono: v('ce-telefono'), relazione: vuotoNull(v('ce-relazione')) }
    if (!riga.nome) return erroreCampo('ce-nome', 'Scrivi il nome.')
    if (!riga.telefono || riga.telefono.replace(/\D/g, '').length < 6) return erroreCampo('ce-telefono', 'Scrivi un numero di telefono.')
    var b = el('ps-salva'); b.disabled = true
    try {
      if (c.id) await AD.aggiorna('operai_contatti_emergenza', c.id, riga, COL_CE)
      else { riga.operaio_id = o.id; await AD.inserisci('operai_contatti_emergenza', riga, COL_CE) }
      delete ST.ce[o.id]
      ST.messaggio = { tipo: 'ok', html: 'Contatto d\'emergenza salvato.' }
      APP.libera()
      location.hash = '#persona/' + o.id
    } catch (e) { erroreSalva(e) }
  }
  async function togliEmergenza(conferma) {
    var x = ST.ceAperto; if (!x) return
    var box = el('ce-togli-box')
    if (!conferma) {
      box.innerHTML = AC.avviso('warn', 'Togliere <strong>' + esc(x.c.nome) + '</strong> dai contatti d\'emergenza?') +
        '<div class="azioni-riga"><button type="button" class="btn btn-primario" data-ps-azione="ce-togli-si">' + ico('togli') + '<span>Sì, togli</span></button>' +
        '<button type="button" class="btn btn-secondario" data-ps-azione="ce-togli-no">' + ico('chiudi') + '<span>Annulla</span></button></div>'
      APP.livello(function () { disegnaEmergenza(x.o, x.c.id) })
      return
    }
    try {
      await AD.cancella('operai_contatti_emergenza', x.c.id)
      delete ST.ce[x.o.id]
      ST.messaggio = { tipo: 'ok', html: 'Contatto d\'emergenza tolto.' }
      APP.libera()
      location.hash = '#persona/' + x.o.id
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      box.innerHTML = AC.avviso('err', 'NON tolto: ' + esc(spiega(e)))
    }
  }

  // ── MODULO DOCUMENTO ──────────────────────────────────────────────────────
  function disegnaDocumento(o, idDoc) {
    var d = idDoc === 'nuovo' ? {} : docDi(o.id).filter(function (x) { return x.id === idDoc })[0]
    var indietro = '#persona/' + o.id
    if (!d) { el('pane-dettaglio').innerHTML = AC.avviso('warn', 'Documento non trovato. <a href="' + indietro + '">Torna alla scheda</a>.'); return }
    var h = '<form id="ps-doc-modulo" novalidate>' + testata((d.id ? 'Modifica' : 'Nuovo') + ' documento', '', '', indietro) +
      '<p class="nota">' + ico('documento') + 'Di ' + esc(nome(o)) + '.</p>' +
      '<div class="blocco">' + campo('doc-tipo', 'Che documento è', input('doc-tipo', d.tipo, ' autocomplete="off" maxlength="80" list="doc-tipi"') +
        '<datalist id="doc-tipi">' + TIPI_DOC.map(function (t) { return '<option value="' + esc(t) + '">' }).join('') + '</datalist>', '', true) +
      campo('doc-scadenza', 'Scade il', input('doc-scadenza', d.scadenza, '', 'date'), 'Vuota = non scade. Avviso arancione 30 giorni prima, rosso quando è scaduto.') +
      campo('doc-note', 'Note', input('doc-note', d.note, ' autocomplete="off" maxlength="300"')) + '</div>'
    if (ST.sqlDocFile) {
      h += '<div class="blocco">' + (d.file_path ? '<p class="nota">' + ico('documento') + 'Ha già un file. Scegline uno nuovo solo per sostituirlo.</p>' : '') +
        campo('doc-file', d.file_path ? 'Nuovo file (sostituisce)' : 'File (foto o PDF)', '<input id="doc-file" type="file" accept="image/*,application/pdf">',
          'Il file va in un archivio privato, in una cartella con il codice della persona (mai il nome).') + '</div>'
    } else {
      h += AC.avviso('info', 'Per allegare il file serve l\'SQL ANAG_F2_02 (non ancora applicato).')
    }
    if (d.id && ST.utente && ST.utente.ruolo === 'titolare') {
      h += '<div class="blocco blocco-tenue" id="doc-togli-box"><button type="button" class="btn btn-secondario" data-ps-azione="doc-togli">' + ico('togli') + '<span>Togli questo documento</span></button></div>'
    }
    h += barraSalva(indietro) + '</form>'
    el('pane-dettaglio').innerHTML = h
    el('ps-doc-modulo').addEventListener('submit', function (ev) { ev.preventDefault(); salvaDocumento(o, d) })
    ST.docAperto = { o: o, d: d }
  }
  function nomeFilePulito(n) {
    var s = String(n || 'file').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+/, '')
    return (s || 'file').slice(-80)
  }
  async function salvaDocumento(o, d) {
    var pane = el('pane-dettaglio'); puliziaErrori(pane)
    var riga = { tipo: v('doc-tipo'), scadenza: vuotoNull(v('doc-scadenza')), note: vuotoNull(v('doc-note')) }
    if (!riga.tipo) return erroreCampo('doc-tipo', 'Scrivi che documento è.')
    var fi = el('doc-file'), file = fi && fi.files && fi.files[0]
    if (file && file.size > 15 * 1024 * 1024) return erroreCampo('doc-file', 'Il file è troppo grande (più di 15 MB).')
    var b = el('ps-salva'); b.disabled = true
    var caricato = null
    try {
      if (file) {
        caricato = o.id + '/' + Date.now() + '-' + nomeFilePulito(file.name)
        await AD.caricaFile(BUCKET_DOC, caricato, file)
        riga.file_path = caricato
      }
      var salvato
      if (d.id) salvato = await AD.aggiorna('documenti_operai', d.id, riga, ST.sqlDocFile ? COL_DOC : COL_DOC_VECCHIE)
      else { riga.operaio_id = o.id; salvato = await AD.inserisci('documenti_operai', riga, ST.sqlDocFile ? COL_DOC : COL_DOC_VECCHIE) }
      ST.documenti = ST.documenti.filter(function (x) { return x.id !== salvato.id }).concat([salvato])
      ST.messaggio = { tipo: 'ok', html: 'Documento salvato' + (file ? ' con il file.' : '.') }
      APP.libera()
      location.hash = '#persona/' + o.id
    } catch (e) {
      if (caricato) AD.togliFile(BUCKET_DOC, caricato)
      erroreSalva(e)
    }
  }
  async function togliDocumento(conferma) {
    var x = ST.docAperto; if (!x) return
    var box = el('doc-togli-box')
    if (!conferma) {
      box.innerHTML = AC.avviso('warn', 'Togliere il documento <strong>' + esc(x.d.tipo) + '</strong>?' + (x.d.file_path ? ' Anche il file.' : '')) +
        '<div class="azioni-riga"><button type="button" class="btn btn-primario" data-ps-azione="doc-togli-si">' + ico('togli') + '<span>Sì, togli</span></button>' +
        '<button type="button" class="btn btn-secondario" data-ps-azione="doc-togli-no">' + ico('chiudi') + '<span>Annulla</span></button></div>'
      APP.livello(function () { disegnaDocumento(x.o, x.d.id) })
      return
    }
    try {
      await AD.cancella('documenti_operai', x.d.id)
      if (x.d.file_path) await AD.togliFile(BUCKET_DOC, x.d.file_path)
      ST.documenti = ST.documenti.filter(function (y) { return y.id !== x.d.id })
      ST.messaggio = { tipo: 'ok', html: 'Documento tolto.' }
      APP.libera()
      location.hash = '#persona/' + x.o.id
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      box.innerHTML = AC.avviso('err', 'NON tolto: ' + esc(spiega(e)))
    }
  }
  async function apriFile(percorso, bottone) {
    if (bottone) bottone.disabled = true
    // la finestra si apre subito (il telefono blocca le finestre aperte dopo un'attesa)
    var w = null; try { w = window.open('', '_blank') } catch (_) { w = null }
    try {
      var url = await AD.linkFirmato(BUCKET_DOC, percorso, 300)
      if (w) w.location.href = url; else location.href = url
    } catch (e) {
      if (w) try { w.close() } catch (_) {}
      if (e.sessioneAssente) return APP.sessioneScaduta()
      var box = bottone && bottone.closest('.dato')
      if (box) box.insertAdjacentHTML('beforeend', AC.avviso('err', 'Il file non si apre: ' + esc(e.message)))
    } finally { if (bottone) bottone.disabled = false }
  }

  // ── ACCESSO: dai, blocca, sblocca, password, email, ruolo ─────────────────
  function ruoliPerMe() {
    return RUOLI_APP.filter(function (r) { return ST.utente && (ST.utente.ruolo === 'titolare' || r.v !== 'responsabile') })
  }
  function disegnaAccesso(o, azione) {
    var indietro = '#persona/' + o.id
    if (eEsterno(o)) { el('pane-dettaglio').innerHTML = testata('Accesso', '', '', indietro) + AC.avviso('warn', 'Esterno: per ora niente accesso alle app.'); return }
    var no = azione !== 'dai' ? puoGestire(o) : null
    if (no) { el('pane-dettaglio').innerHTML = testata('Accesso', '', '', indietro) + AC.avviso('warn', esc(no)); return }
    var h = '<form id="ps-acc-modulo" novalidate>', titolo, corpo = '', bottone = 'Conferma'
    if (azione === 'dai') {
      if (o.user_id) { location.hash = indietro; return }
      titolo = 'Dai accesso a ' + nome(o)
      corpo = '<p class="nota">' + ico('info') + 'Crea l\'accesso alle app (Cantiere, Calendario…) con l\'email della persona. Se esiste già un account con questa email, lo collega e basta.</p>' +
        '<div class="blocco">' + campo('acc-email', 'Email della persona', input('acc-email', o.email, ' autocomplete="off" inputmode="email" maxlength="120"'), 'La userà per entrare. Si salva anche nella scheda.', true) +
        campo('acc-ruolo', 'Ruolo nell\'app', '<select id="acc-ruolo">' + ruoliPerMe().map(function (r) { return '<option value="' + r.v + '"' + (r.v === 'operaio' ? ' selected' : '') + '>' + esc(r.n) + '</option>' }).join('') + '</select>',
          'Decide cosa vede nelle app. ' + (ST.utente.ruolo === 'responsabile' ? 'Il responsabile non può dare «Responsabile».' : '')) +
        campo('acc-password', 'Password', input('acc-password', '', ' autocomplete="new-password" minlength="8" maxlength="72"', 'password') +
          '<label class="scelta-voce"><input type="checkbox" id="acc-mostra"> <span>Mostra la password</span></label>', 'Almeno 8 caratteri. La scegli tu e la comunichi alla persona.', true) + '</div>'
      bottone = 'Dai accesso'
    } else if (azione === 'blocca' || azione === 'sblocca') {
      titolo = (azione === 'blocca' ? 'Blocca' : 'Sblocca') + ' l\'accesso'
      corpo = AC.avviso(azione === 'blocca' ? 'warn' : 'info', azione === 'blocca'
        ? '<strong>' + esc(nome(o)) + '</strong> non potrà più entrare in nessuna app. Le sessioni aperte si chiudono (al massimo entro 1 ora).'
        : '<strong>' + esc(nome(o)) + '</strong> potrà di nuovo entrare con la sua password.')
      bottone = azione === 'blocca' ? 'Sì, blocca' : 'Sì, sblocca'
    } else if (azione === 'password') {
      titolo = 'Nuova password'
      corpo = '<div class="blocco">' + campo('acc-password', 'Nuova password per ' + nome(o), input('acc-password', '', ' autocomplete="new-password" minlength="8" maxlength="72"', 'password') +
        '<label class="scelta-voce"><input type="checkbox" id="acc-mostra"> <span>Mostra la password</span></label>', 'Almeno 8 caratteri. La comunichi tu alla persona.', true) + '</div>'
      bottone = 'Salva la password'
    } else if (azione === 'email') {
      titolo = 'Cambia email'
      corpo = '<div class="blocco">' + dato('Email di oggi', esc(o.email || '')) +
        campo('acc-email', 'Nuova email', input('acc-email', '', ' autocomplete="off" inputmode="email" maxlength="120"'), 'Cambia insieme l\'accesso e la scheda.', true) + '</div>'
      bottone = 'Cambia email'
    } else if (azione === 'ruolo') {
      if (!ST.utente || ST.utente.ruolo !== 'titolare') { location.hash = indietro; return }
      var p = profilo(o.user_id)
      titolo = 'Cambia ruolo nell\'app'
      corpo = '<div class="blocco">' + dato('Ruolo di oggi', esc(nomeRuoloApp(p && p.ruolo))) +
        campo('acc-ruolo', 'Nuovo ruolo', '<select id="acc-ruolo">' + RUOLI_APP.map(function (r) { return '<option value="' + r.v + '"' + (p && p.ruolo === r.v ? ' selected' : '') + '>' + esc(r.n) + '</option>' }).join('') + '</select>') + '</div>'
      bottone = 'Cambia ruolo'
    } else { location.hash = indietro; return }
    h += testata(titolo, '', '', indietro) + corpo + barraSalva(indietro, bottone) + '</form>'
    el('pane-dettaglio').innerHTML = h
    var m = el('acc-mostra'); if (m) m.addEventListener('change', function () { el('acc-password').type = m.checked ? 'text' : 'password' })
    el('ps-acc-modulo').addEventListener('submit', function (ev) { ev.preventDefault(); eseguiAccesso(o, azione) })
  }

  async function eseguiAccesso(o, azione) {
    var pane = el('pane-dettaglio'); puliziaErrori(pane); el('ps-avvisi').innerHTML = ''
    var b = el('ps-salva')
    var fatto = function (html) {
      ST.messaggio = { tipo: 'ok', html: html }
      ST.caricato = false   // ricarica stato accessi e profili
      APP.libera()
      location.hash = '#persona/' + o.id
    }
    try {
      if (azione === 'dai') {
        var email = v('acc-email').toLowerCase(), pwd = el('acc-password').value, ruolo = el('acc-ruolo').value
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erroreCampo('acc-email', 'Scrivi un\'email giusta.')
        var doppia = ST.operai.filter(function (x) { return x.id !== o.id && String(x.email || '').trim().toLowerCase() === email })[0]
        if (doppia) return erroreCampo('acc-email', 'Questa email è già di ' + nome(doppia) + '.')
        if (pwd.length < 8) return erroreCampo('acc-password', 'La password deve avere almeno 8 caratteri.')
        if (ruoliPerMe().map(function (r) { return r.v }).indexOf(ruolo) < 0) return erroreCampo('acc-ruolo', 'Questo ruolo non lo puoi dare.')
        b.disabled = true
        // 1. l'email nella scheda (la stessa che userà la funzione)
        if (String(o.email || '').trim().toLowerCase() !== email) {
          var s = await AD.aggiorna('operai', o.id, { email: email }, 'id,email')
          o.email = s.email
        }
        // 2. c'è già un account con questa email? allora si collega e basta
        var uid = await AD.rpc('anag_collega_account', { p_operaio: o.id })
        if (uid) { ST.esitoAccesso = { id: o.id, email: email, password: null }; return fatto('Accesso collegato all\'account che c\'era già.') }
        // 3. crea l'account
        await AD.funzione('crea-collaboratore', { email: email, password: pwd, nome: o.nome, cognome: o.cognome, ruolo: ruolo })
        // 4. collega (se la funzione non l'ha già fatto)
        uid = await AD.rpc('anag_collega_account', { p_operaio: o.id })
        if (!uid) throw new Error('l\'account è stato creato ma non lo trovo per collegarlo. Riprova «Dai accesso»: lo collega senza crearne un altro.')
        ST.esitoAccesso = { id: o.id, email: email, password: pwd }
        return fatto('Accesso creato.')
      }
      if (azione === 'blocca' || azione === 'sblocca') {
        b.disabled = true
        await AD.funzione('gestisci-accesso', { azione: azione, operaio_id: o.id })
        return fatto(azione === 'blocca' ? 'Accesso bloccato.' : 'Accesso sbloccato.')
      }
      if (azione === 'password') {
        var p2 = el('acc-password').value
        if (p2.length < 8) return erroreCampo('acc-password', 'La password deve avere almeno 8 caratteri.')
        b.disabled = true
        await AD.funzione('gestisci-accesso', { azione: 'password', operaio_id: o.id, nuova_password: p2 })
        ST.esitoAccesso = { id: o.id, email: o.email, password: p2 }
        return fatto('Password cambiata.')
      }
      if (azione === 'email') {
        var e2 = v('acc-email').toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e2)) return erroreCampo('acc-email', 'Scrivi un\'email giusta.')
        b.disabled = true
        await AD.funzione('gestisci-accesso', { azione: 'cambia-email', operaio_id: o.id, nuova_email: e2 })
        return fatto('Email cambiata (accesso e scheda).')
      }
      if (azione === 'ruolo') {
        b.disabled = true
        await AD.funzione('cambia-ruolo', { azione: 'cambia', user_id: o.user_id, nuovo_ruolo: el('acc-ruolo').value })
        return fatto('Ruolo cambiato.')
      }
    } catch (e) {
      if (e.stato === 409) e = new Error('Questa email è già registrata: premi di nuovo «Dai accesso», la collego all\'account che c\'è.')
      erroreSalva(e)
    }
  }

  // ── Clic (un ascoltatore per sezione) ─────────────────────────────────────
  function clic(ev) {
    var t = ev.target.closest('[data-apri-persona],[data-ps-azione],[data-ps-ditta],[data-ps-file]')
    if (!t) return
    if (t.dataset.apriPersona) { location.hash = '#persona/' + t.dataset.apriPersona; return }
    if (t.dataset.psFile) { apriFile(t.dataset.psFile, t); return }
    if (t.dataset.psDitta) {
      leggiModulo(); ST.form.ditta_id = t.dataset.psDitta; ST.form.nuovaDitta = false
      el('ps-ditta').innerHTML = htmlDitta(); collegaDitta(); return
    }
    var a = t.dataset.psAzione
    if (a === 'nuova') { location.hash = '#nuova-persona'; return }
    if (a === 'archivia') { var oa = perId(aperto); if (oa) apriArchivia(oa); return }
    if (a === 'rimetti') { var or = perId(aperto); if (or) rimetti(or); return }
    if (a === 'cancella') { var oc = perId(aperto); if (oc) apriCancella(oc); return }
    if (a === 'ex') { ST.mostraEx = !ST.mostraEx; disegnaElenco(aperto); return }
    if (a === 'ditta-cambia') { leggiModulo(); ST.form.ditta_id = null; el('ps-ditta').innerHTML = htmlDitta(); collegaDitta(); el('ps-ditta-cerca').focus(); return }
    if (a === 'ditta-nuova') { leggiModulo(); ST.form.nuovaDitta = true; el('ps-ditta').innerHTML = htmlDitta(); el('ps-nd-ragione').focus(); return }
    if (a === 'ditta-annulla') { ST.form.nuovaDitta = false; el('ps-ditta').innerHTML = htmlDitta(); collegaDitta(); return }
    if (a === 'ditta-salva') { salvaNuovaDitta(); return }
    if (a === 'ditta-comunque') { ST.form.dittaComunque = true; salvaNuovaDitta(); return }
    if (a === 'salva-comunque') { ST.salvaComunque = true; salvaPersona(); return }
    if (a === 'fine-conferma') { ST.confermaFine = true; salvaPersona(); return }
    if (a === 'fine-annulla') { el('ps-avvisi').innerHTML = ''; var dfr = el('ps-data_fine_rapporto'); if (dfr) dfr.focus(); return }
    if (a === 'ce-togli') { togliEmergenza(false); return }
    if (a === 'ce-togli-si') { APP.chiudiLivello().then(function () { togliEmergenza(true) }); return }
    if (a === 'ce-togli-no') { APP.chiudiLivello().then(function () { disegnaEmergenza(ST.ceAperto.o, ST.ceAperto.c.id) }); return }
    if (a === 'doc-togli') { togliDocumento(false); return }
    if (a === 'doc-togli-si') { APP.chiudiLivello().then(function () { togliDocumento(true) }); return }
    if (a === 'doc-togli-no') { APP.chiudiLivello().then(function () { disegnaDocumento(ST.docAperto.o, ST.docAperto.d.id) }); return }
  }
  var aperto = null

  // ── Ingresso dalla navigazione (app.js) ───────────────────────────────────
  // parti: ['persone'] | ['nuova-persona'] | ['persona', id] | ['persona', id, 'modifica'|'dati'|'emergenza'|'documento'|'accesso', x]
  async function mostra(parti, utente) {
    ST.utente = utente
    await carica()
    var vista = parti[0], id = parti[1] || null, sotto = parti[2] || null, x = parti[3] || null
    aperto = vista === 'persona' ? id : null
    document.body.classList.toggle('con-dettaglio', vista !== 'persone')
    disegnaElenco(aperto)
    if (vista === 'nuova-persona') {
      if (!ST.form || ST.form.id) ST.form = bozzaVuota()
      ST.salvaComunque = false
      return disegnaModulo()
    }
    if (vista === 'persona') {
      var o = perId(id)
      if (!o) { el('pane-dettaglio').innerHTML = AC.avviso('warn', 'Questa persona non c\'è (o non è leggibile). <a href="#persone">Torna all\'elenco</a>.'); return }
      if (sotto === 'modifica') { if (!ST.form || ST.form.id !== id) ST.form = bozzaDa(o); ST.salvaComunque = false; ST.confermaFine = false; return disegnaModulo() }
      ST.form = null
      if (sotto === 'dati' || sotto === 'emergenza') {
        if (!(o.id in ST.dp) || !(o.id in ST.ce)) {
          var r = await Promise.all([
            AD.leggi('operai_dati_personali', COL_DP, function (q) { return q.eq('operaio_id', o.id) }),
            AD.leggi('operai_contatti_emergenza', COL_CE, function (q) { return q.eq('operaio_id', o.id).order('created_at') })
          ])
          ST.dp[o.id] = r[0][0] || null; ST.ce[o.id] = r[1]
        }
        return sotto === 'dati' ? disegnaDatiPersonali(o) : disegnaEmergenza(o, x || 'nuovo')
      }
      if (sotto === 'documento') return disegnaDocumento(o, x || 'nuovo')
      if (sotto === 'accesso') return disegnaAccesso(o, x)
      return disegnaScheda(id)
    }
    el('pane-dettaglio').innerHTML = '<div class="vuoto vuoto-grande">' + ico('persone') + '<p>Scegli una persona dall\'elenco,<br>oppure «Nuova persona».</p></div>'
  }

  function avvia() {
    el('pane-elenco').addEventListener('click', clic)
    el('pane-dettaglio').addEventListener('click', clic)
  }

  return { mostra: mostra, avvia: avvia, svuota: svuota, scarta: scarta, ricarica: function () { ST.caricato = false },
           // per le prove
           _st: ST, _attiva: attiva, _giornoDopo: giornoDopo }
})()
