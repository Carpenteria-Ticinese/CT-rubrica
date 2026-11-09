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
     cancellare una persona il titolare vede QUANTE buste paga la bloccano (solo il numero, js/cancella.js).
   - «attivo» non si scrive a mano: attivo = fine rapporto vuota, oggi o futura
     (come App Cantieri e Calendario).
   - Dati personali: solo qui, mai in operai. «Niente dati sanitari».
   - Documenti: file nel bucket privato tm-documenti, percorso <id persona>/<ora>-<nome>,
     mai il nome della persona. Toglie un documento solo il titolare.
   - Accesso: «Dai accesso» = salva l'email nella scheda → anag_collega_account →
     (solo se serve) crea-collaboratore → anag_collega_account. Mai due account.
   - ARCHIVIO (v9, Umberto 4.11.2026): chi ha la fine rapporto passata (o attivo = false) va in Archivio: sparisce dagli
     elenchi, si vede solo con il filtro «Mostra archivio». Storico intatto. Tasto «Archivia» = scrive la fine rapporto (ultimo giorno).
   - ESISTE GIÀ → RIATTIVA (v9): inserendo una persona si controlla nome + cognome + nascita, email, telefono, anche in
     Archivio. Solo avviso: con «È un'altra persona» si salva. Omonimo senza conferma = avviso, senza «Riattiva».
     Riattiva = anag_riattiva_persona (SQL ANAG_10): il periodo vecchio va in anag_periodi_rapporto, nuova data di inizio,
     fine rapporto tolta, tutto o niente. L'account bloccato RESTA bloccato: lo si dice a schermo.
     Data di inizio futura: avviso, non blocco.
   - PERIODI SBAGLIATI (v9, Umberto 4.11.2026): li corregge o li toglie SOLO il titolare, dopo aver riscritto la password,
     con anag_correggi_periodo / anag_togli_periodo. Prima e dopo vanno in anag_registro_periodi, che vede solo lui (#registro).
     Il responsabile non vede i tasti e il database lo rifiuta. Il motivo di uscita lo vedono titolare e responsabile.
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
  var COL_PERIODI = 'id,operaio_id,data_inizio,data_fine,motivo_uscita,fatto_da,fatto_il'
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
    periodi: {}, periodiErrore: null, // per persona: periodi di rapporto chiusi (ANAG_10)
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
  function scarta() { ST.form = null; ST.salvaComunque = false; ST.confermaFine = false; ST.confermaTogliFine = false }
  function svuota() { ST.operai = []; ST.contatti = []; ST.documenti = []; ST.profili = []; ST.accessi = null; ST.caricato = false; ST.dp = {}; ST.ce = {}; ST.periodi = {}; ST.periodiErrore = null; ST.form = null; ST.esitoAccesso = null; ST.mostraEx = false; ST.cerca = '' }

  function perId(id) { return ST.operai.filter(function (o) { return o.id === id })[0] || null }
  function contatto(id) { return ST.contatti.filter(function (k) { return k.id === id })[0] || null }
  function nome(o) { return [o.nome, o.cognome].filter(Boolean).join(' ').trim() || '(senza nome)' }
  function eEsterno(o) { return o && o.rapporto === 'esterno' }
  function attiva(o, oggi) { return !AC.inArchivio(o, oggi) }
  // «in archivio dal …» = dal giorno dopo l'ultimo giorno di lavoro. Tolta con attivo = false senza data: niente data.
  function testoArchivio(o, maiuscola) {
    var t = o.data_fine_rapporto && o.data_fine_rapporto < AC.oggiIso() ? 'in archivio dal ' + AC.data(giornoDopo(o.data_fine_rapporto)) : 'in archivio'
    return maiuscola ? 'I' + t.slice(1) : t
  }
  function periodoTesto(inizio, fine) {
    return (inizio ? 'dal ' + AC.data(inizio) : 'inizio non scritto') + (fine ? ' al ' + AC.data(fine) : '')
  }
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
      '<span class="riga-badge">' + (attiva(o) ? '' : '<span class="badge st-senza">' + ico('lucchetto') + ' ' + esc(testoArchivio(o, true)) + '</span>') +
      (eEsterno(o) ? badgeRapporto(o) : '') + badgeAccesso(o) + badgeDocumenti(o) + '</span></span>' +
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

    // Archivio: solo con il filtro. Il numero c'è sempre, anche cercando: se la persona è lì, si vede subito.
    // In alto, sotto la ricerca (Umberto 5.11.2026: in fondo all'elenco non lo vedeva). Con 0 persone il tasto resta e lo dice.
    h += '<button type="button" class="btn btn-secondario btn-largo" data-ps-azione="ex" aria-expanded="' + ST.mostraEx + '">' +
         ico(ST.mostraEx ? 'chiudi' : 'lucchetto') + '<span>' + (ST.mostraEx ? 'Nascondi' : 'Mostra') + ' archivio (' + ex.length + ')</span></button>'
    if (ST.mostraEx) {
      h += '<h2 class="sezione-titolo">' + ico('lucchetto') + 'Archivio <span class="sezione-nota">non lavorano più con noi · ' + ex.length + '</span></h2>'
      h += '<div class="elenco elenco-ex">' + (ex.length ? ex.map(function (o) { return rigaPersona(o, o.id === idScelto) }).join('')
            : '<div class="vuoto">' + (ST.cerca ? 'Nessuno in archivio per «' + esc(ST.cerca) + '».' : 'Nessuno in archivio.') + '</div>') + '</div>'
    }

    h += '<h2 class="sezione-titolo">' + ico('persone') + 'Dipendenti <span class="sezione-nota">' + dip.length + '</span></h2>'
    h += '<div class="elenco" aria-live="polite">' + (dip.length ? dip.map(function (o) { return rigaPersona(o, o.id === idScelto) }).join('')
          : '<div class="vuoto">' + (ST.cerca ? 'Nessun dipendente per «' + esc(ST.cerca) + '».' : 'Nessun dipendente attivo.') + '</div>') + '</div>'

    h += '<h2 class="sezione-titolo">' + ico('ditta') + 'Esterni <span class="sezione-nota">ditte esterne, niente paga · ' + est.length + '</span></h2>'
    h += '<div class="elenco">' + (est.length ? est.map(function (o) { return rigaPersona(o, o.id === idScelto) }).join('')
          : '<div class="vuoto">' + (ST.cerca ? 'Nessun esterno per «' + esc(ST.cerca) + '».' : 'Nessun esterno. Con «Nuova persona» scegli «Esterno».') + '</div>') + '</div>'

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
    var h = testata(nome(o), badgeRapporto(o) + (attiva(o, oggi) ? '' : '<span class="badge st-senza">' + ico('lucchetto') + ' ' + esc(testoArchivio(o, true)) + '</span>'),
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

    h += '<div id="ps-periodi"></div>'
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
    await caricaPeriodi(o)
  }
  // Periodi di rapporto chiusi (ANAG_10). Tabella assente = SQL non applicato: nessun periodo da mostrare, Riattiva lo dirà.
  async function caricaPeriodi(o) {
    try {
      ST.periodi[o.id] = await AD.leggi('anag_periodi_rapporto', COL_PERIODI, function (q) { return q.eq('operaio_id', o.id) })
      ST.periodiErrore = null
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      ST.periodi[o.id] = []
      ST.periodiErrore = tabellaAssente(e) ? null : e.message
    }
    var x = el('ps-periodi'); if (x) x.innerHTML = htmlPeriodi(o)
  }
  function tabellaAssente(e) { return /^(PGRST205|42P01)$/.test(String(e && e.codice || '')) || /could not find the table|relation .* does not exist/i.test(String(e && e.message || '')) }
  function funzioneAssente(e) { return /^(PGRST202|42883)$/.test(String(e && e.codice || '')) || /could not find the function|function .* does not exist/i.test(String(e && e.message || '')) }
  function htmlPeriodi(o) {
    if (ST.periodiErrore) return AC.avviso('err', '<strong>Periodi di rapporto NON caricati.</strong> ' + esc(ST.periodiErrore))
    var lista = (ST.periodi[o.id] || []).slice().sort(function (a, b) { return String(b.fatto_il).localeCompare(String(a.fatto_il)) })
    if (!lista.length) return ''
    return '<div class="blocco" id="ps-periodi-box"><h3 class="blocco-titolo">' + ico('documento') + 'Periodi di rapporto</h3>' +
      dato(attiva(o) ? 'Periodo in corso' : 'Ultimo periodo', esc(periodoTesto(o.data_assunzione, o.data_fine_rapporto))) +
      lista.map(function (p) {
        var chi = p.fatto_da ? ((profilo(p.fatto_da) || {}).nome || 'account non più presente') : 'non segnato'
        return dato('Periodo vecchio', esc(periodoTesto(p.data_inizio, p.data_fine)) +
          (p.motivo_uscita ? '<span class="dato-sotto">Motivo uscita: ' + esc(p.motivo_uscita) + '</span>' : '') +
          '<span class="dato-sotto">Riattivato il ' + esc(AC.data(p.fatto_il)) + ' da ' + esc(chi) + '</span>' +
          (ST.utente && ST.utente.ruolo === 'titolare' ? '<div class="azioni-riga">' +
            '<button type="button" class="btn btn-secondario" data-ps-periodo-correggi="' + esc(p.id) + '">' + ico('modifica') + '<span>Correggi</span></button>' +
            '<button type="button" class="btn btn-secondario" data-ps-periodo-togli="' + esc(p.id) + '">' + ico('togli') + '<span>Togli</span></button></div>' : ''))
      }).join('') + '</div>'
  }

  // ── Periodo sbagliato: solo il titolare, con la password (come js/cancella.js) ──────────
  // La password passa solo da AD.verificaPassword: non si salva, il campo si svuota SEMPRE. Sta nella finestra, fuori dal modulo.
  function campoPasswordPeriodo() {
    return '<div class="campo cx-campo" id="campo-cx-password"><label for="cx-password">Riscrivi la tua password per confermare</label>' +
      '<div class="dato-sotto" id="cx-chi">Login in uso: ' + esc(ST.utente.email) + '</div>' +
      '<input id="cx-password" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false">' +
      '<div class="campo-aiuto">La password non viene salvata né mostrata.</div></div><div id="cx-errore"></div>'
  }
  function erroreFinestra(html) {
    var e = el('cx-errore'); if (!e) return
    e.innerHTML = AC.avviso('err', html)
    e.scrollIntoView({ block: 'center' })
  }
  function finestraOccupata(si) {
    var box = el('cx-scatola'); if (box) box.querySelectorAll('button,input').forEach(function (x) { x.disabled = si })
  }
  // Controlla la password e il ruolo, poi fa il lavoro. Se qualcosa non va non cambia niente e lo dice.
  async function conPasswordPeriodo(o, lavoro, fatto) {
    var inp = el('cx-password'); if (!inp) return
    var pw = inp.value
    inp.value = ''
    el('cx-errore').innerHTML = ''
    if (!pw) { erroreFinestra('Scrivi la password.'); inp.focus(); return }
    finestraOccupata(true)
    try {
      var giusta = await AD.verificaPassword(pw)
      pw = null
      if (!giusta) {
        finestraOccupata(false)
        erroreFinestra('<strong>Password sbagliata.</strong> Non ho cambiato niente.')
        var i2 = el('cx-password'); if (i2) i2.focus()
        return
      }
      var chi = await AD.ruolo()
      if (chi.ruolo !== 'titolare') throw new Error('Solo il titolare può correggere un periodo.')
      await lavoro()
    } catch (e) {
      pw = null
      if (e.sessioneAssente) return APP.sessioneScaduta()
      finestraOccupata(false)
      return erroreFinestra('<strong>Non ho cambiato niente.</strong> ' + esc(funzioneAssente(e) ? 'il database non è ancora aggiornato (manca l\'SQL ANAG_10).' : spiega(e)))
    }
    delete ST.periodi[o.id]
    ST.messaggio = { tipo: 'ok', html: fatto }
    await CX.chiudi()
    await ridisegnaPersona(o.id)
  }
  function apriCorreggiPeriodo(o, p) {
    var corpo = '<p>Di <strong>' + esc(nome(o)) + '</strong>. Oggi: ' + esc(periodoTesto(p.data_inizio, p.data_fine)) + '. Nel Registro resta com\'era e com\'è dopo.</p>' +
      '<div class="campi-due campi-pari">' + campo('cx-p-inizio', 'Inizio', input('cx-p-inizio', p.data_inizio, '', 'date')) + campo('cx-p-fine', 'Ultimo giorno', input('cx-p-fine', p.data_fine, '', 'date')) + '</div>' +
      campo('cx-p-motivo', 'Motivo uscita', input('cx-p-motivo', p.motivo_uscita, ' autocomplete="off" maxlength="200"')) +
      campoPasswordPeriodo() +
      '<div class="vela-azioni">' + CX.bottone('salva', 'Correggi il periodo', 'btn-primario', 'salva') + CX.bottone('chiudi', 'Annulla', 'btn-secondario', 'chiudi') + '</div>'
    CX.schermo('Correggi il periodo', corpo, {
      salva: function () {
        var ini = el('cx-p-inizio').value || null, fin = el('cx-p-fine').value || null, mot = el('cx-p-motivo').value.trim() || null
        if (ini && fin && fin < ini) { el('cx-password').value = ''; return erroreFinestra('L\'ultimo giorno viene prima dell\'inizio.') }
        if (ini === (p.data_inizio || null) && fin === (p.data_fine || null) && mot === (p.motivo_uscita || null)) { el('cx-password').value = ''; return erroreFinestra('Non hai cambiato niente.') }
        return conPasswordPeriodo(o, function () {
          return AD.rpc('anag_correggi_periodo', { p_periodo: p.id, p_inizio: ini, p_fine: fin, p_motivo: mot })
        }, 'Periodo corretto: ' + esc(periodoTesto(ini, fin)) + '. Com\'era prima è scritto nel Registro.')
      }
    })
  }
  function apriTogliPeriodo(o, p) {
    var corpo = AC.avviso('warn', '<strong>Il periodo ' + esc(periodoTesto(p.data_inizio, p.data_fine)) + ' sparisce dalla scheda di ' + esc(nome(o)) + '.</strong> Ore, buste paga e documenti non si toccano. Nel Registro resta com\'era.') +
      campoPasswordPeriodo() +
      '<div class="vela-azioni">' + CX.bottone('salva', 'Togli il periodo', 'btn-pericolo', 'togli') + CX.bottone('chiudi', 'Annulla', 'btn-secondario', 'chiudi') + '</div>'
    CX.schermo('Togli il periodo', corpo, {
      salva: function () {
        return conPasswordPeriodo(o, function () { return AD.rpc('anag_togli_periodo', { p_periodo: p.id }) },
          'Periodo tolto: ' + esc(periodoTesto(p.data_inizio, p.data_fine)) + '. Com\'era è scritto nel Registro.')
      }
    })
  }
  function periodoAperto(id) {
    var o = perId(aperto), p = o && (ST.periodi[o.id] || []).filter(function (x) { return x.id === id })[0]
    return o && p ? { o: o, p: p } : null
  }

  // Sezione del Registro (#registro), sotto le cancellazioni. Solo il titolare. Tabella assente = SQL non applicato: niente da mostrare.
  async function mostraRegistroPeriodi(utente) {
    if (!utente || utente.ruolo !== 'titolare' || !/^#registro/.test(location.hash)) return
    var righe, profili = []
    var titolo = '<h2 class="sezione-titolo" id="ps-reg-periodi">' + ico('documento') + 'Correzioni ai periodi di rapporto'
    function mostra(h) { var pane = el('pane-elenco'); if (pane && /^#registro/.test(location.hash)) pane.insertAdjacentHTML('beforeend', h) }
    try {
      righe = await AD.leggi('anag_registro_periodi', 'id,quando,chi,azione,nome,prima,dopo')
    } catch (e) {
      if (e.sessioneAssente) throw e
      if (tabellaAssente(e)) return
      return mostra(titolo + '</h2>' + AC.avviso('err', '<strong>Non riesco a leggere le correzioni.</strong> ' + esc(e.message)))
    }
    try { profili = await AD.leggi('profili', 'id,nome') } catch (e2) { if (e2.sessioneAssente) throw e2 /* senza nomi: «titolare» */ }
    function chiE(r) {
      if (r.chi === utente.id) return 'tu (' + utente.email + ')'
      var x = profili.filter(function (q) { return q.id === r.chi })[0]
      return (x && x.nome) || 'titolare'
    }
    function fotoPeriodo(j) {
      return j ? periodoTesto(j.data_inizio, j.data_fine) + (j.motivo_uscita ? ' · motivo: ' + j.motivo_uscita : '') : ''
    }
    function quando(iso) {
      var d = new Date(iso); if (isNaN(d)) return String(iso || '')
      var due = function (n) { return String(n).padStart(2, '0') }
      return due(d.getDate()) + '.' + due(d.getMonth() + 1) + '.' + d.getFullYear() + ' alle ' + due(d.getHours()) + ':' + due(d.getMinutes())
    }
    righe.sort(function (a, b) { return String(b.quando).localeCompare(String(a.quando)) })
    mostra(titolo + ' <span class="sezione-nota">' + righe.length + '</span></h2>' +
      (righe.length ? righe.map(function (r) {
        return '<div class="blocco ps-reg-riga"><h3 class="blocco-titolo">' + esc(r.azione === 'tolto' ? 'Periodo tolto' : 'Periodo corretto') + ': ' + esc(r.nome || '(senza nome)') + '</h3>' +
          dato('Quando', esc(quando(r.quando))) + dato('Chi', esc(chiE(r))) + dato('Com\'era prima', esc(fotoPeriodo(r.prima))) +
          dato('Com\'è dopo', r.dopo ? esc(fotoPeriodo(r.dopo)) : 'tolto') + '</div>'
      }).join('') : '<div class="vuoto" id="ps-reg-vuoto"><p>Nessuna correzione.</p></div>'))
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
      h += '<p class="nota">' + ico('lucchetto') + '<span>Archiviata: è in Archivio.' + (o.data_fine_rapporto ? ' Ultimo giorno ' + esc(AC.data(o.data_fine_rapporto)) + '.' : '') + ' Ore, buste paga e documenti restano. Se torna a lavorare: «Riattiva».</span></p>'
      az += '<button type="button" class="btn btn-primario" data-ps-riattiva="' + esc(o.id) + '">' + ico('persone') + '<span>Riattiva</span></button>'
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
    var corpo = '<p>Va in Archivio con tutti i suoi dati. Niente si perde: se torna, si riattiva.</p>' +
      campo('cx-fine', 'Ultimo giorno di lavoro', input('cx-fine', o.data_fine_rapporto || oggi, '', 'date'), 'Dal giorno dopo va in Archivio: sparisce dagli elenchi di lavoro.', true) +
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
          ST.messaggio = { tipo: 'ok', html: '<strong>' + esc(nome(o)) + '</strong> archiviato: ultimo giorno ' + esc(AC.data(d)) + '. I dati restano tutti. ' +
            (d < oggi ? 'È già in Archivio.' : 'Dal ' + esc(AC.data(giornoDopo(d))) + ' è in Archivio.') }
          await CX.chiudi()
          await ridisegnaPersona(o.id)
        } catch (e) {
          if (e.sessioneAssente) return APP.sessioneScaduta()
          msg.innerHTML = AC.avviso('err', '<strong>NON archiviato.</strong> ' + esc(spiega(e)))
        }
      }
    })
  }
  // Riattiva (v9): dalla scheda in Archivio o dal modulo («Esiste già»). da = { modulo: true, inizio: data scritta nel modulo }.
  // Tutto nel database, in una sola transazione (anag_riattiva_persona). L'account non si tocca mai.
  function apriRiattiva(o, da) {
    da = da || {}
    var s = statoAccesso(o), bloccato = !!o.user_id && s.tipo === 'bloccato'
    var corpo = '<p>Resta tutto: ore, buste paga, documenti. Il periodo vecchio (' + esc(periodoTesto(o.data_assunzione, o.data_fine_rapporto)) + ') resta scritto nella scheda.</p>' +
      campo('cx-inizio', 'Nuova data di inizio', input('cx-inizio', da.inizio || AC.oggiIso(), '', 'date'), '', true) +
      '<div id="cx-riattiva-futuro"></div>' +
      (bloccato ? AC.avviso('warn', testoAccessoBloccato()) : '') +
      (da.modulo ? '<p class="nota">' + ico('info') + '<span>Quello che hai scritto nel modulo non si salva: restano i dati della scheda vecchia. Dopo li controlli con «Modifica».</span></p>' : '') +
      '<div id="cx-riattiva-msg"></div><div class="vela-azioni">' + CX.bottone('salva', 'Riattiva', 'btn-primario', 'persone', 'cx-primo') + CX.bottone('chiudi', 'Annulla', 'btn-secondario', 'chiudi') + '</div>'
    CX.schermo('Riattiva ' + nome(o), corpo, {
      salva: async function (bottone) {
        var d = el('cx-inizio').value, msg = el('cx-riattiva-msg')
        msg.innerHTML = ''
        if (!d) { msg.innerHTML = AC.avviso('err', 'Scrivi la nuova data di inizio.'); return }
        if (o.data_fine_rapporto && d <= o.data_fine_rapporto) { msg.innerHTML = AC.avviso('err', 'La nuova data di inizio deve venire dopo l\'ultimo giorno del periodo vecchio (' + esc(AC.data(o.data_fine_rapporto)) + ').'); return }
        if (o.data_assunzione && d <= o.data_assunzione) { msg.innerHTML = AC.avviso('err', 'La nuova data di inizio deve venire dopo l\'inizio del periodo vecchio (' + esc(AC.data(o.data_assunzione)) + ').'); return }
        if (bottone) bottone.disabled = true
        try {
          var r = await AD.rpc('anag_riattiva_persona', { p_operaio: o.id, p_inizio: d })
          var fermo = r && r.account_bloccato === true
          ST.messaggio = { tipo: fermo ? 'warn' : 'ok', html: '<strong>' + esc(nome(o)) + '</strong> riattivato: nuova data di inizio ' + esc(AC.data(d)) + '. Ore, buste paga e documenti restano; il periodo vecchio è nella scheda.' +
            (d > AC.oggiIso() ? ' La data è nel futuro: risulta già fra gli attivi.' : '') +
            (fermo ? '<br>' + testoAccessoBloccato() : '') }
          delete ST.dp[o.id]; delete ST.periodi[o.id]
          if (da.modulo) scarta()
          await CX.chiudi()
          if (da.modulo) { ST.caricato = false; APP.libera(); location.hash = '#persona/' + o.id; return }
          await ridisegnaPersona(o.id)
        } catch (e) {
          if (e.sessioneAssente) return APP.sessioneScaduta()
          if (bottone) bottone.disabled = false
          msg.innerHTML = AC.avviso('err', '<strong>NON riattivato.</strong> ' + esc(funzioneAssente(e) ? 'il database non è ancora aggiornato (manca l\'SQL ANAG_10). Niente è cambiato.' : spiega(e)))
        }
      }
    })
    // Data futura: solo un avviso, si può riattivare lo stesso.
    var campoInizio = el('cx-inizio')
    function avvisoFuturo() {
      var box = el('cx-riattiva-futuro'); if (!box) return
      var d = campoInizio.value
      box.innerHTML = d && d > AC.oggiIso() ? AC.avviso('warn', '<strong>La data è nel futuro (' + esc(AC.data(d)) + ').</strong> La scheda torna fra gli attivi già da oggi, in tutte le app. Se è giusto, premi «Riattiva».') : ''
    }
    campoInizio.addEventListener('input', avvisoFuturo)
    campoInizio.addEventListener('change', avvisoFuturo)
    avvisoFuturo()
  }
  function testoAccessoBloccato() {
    return '<strong>Il suo accesso alle app resta bloccato.</strong> Riattivare la scheda non lo sblocca. Se deve rientrare nelle app: riquadro «Accesso alle app», tasto «Sblocca accesso» (al posto di «Blocca accesso»).'
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
      cosaArchivia: 'va in Archivio, con tutti i suoi dati',
      giaArchiviato: attiva(o) ? null : 'È già archiviata: è in Archivio.',
      avvisoAccesso: avvisoAccesso,
      notaFatto: o.user_id ? 'Il suo accesso è bloccato: l\'account resta, senza scheda.' : '',
      primaDi: o.user_id ? function () { return bloccaPrimaDiCancellare(o) } : null,
      idAccount: o.user_id || null
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
    m = m.replace(/^anag_(riattiva_persona|correggi_periodo|togli_periodo):\s*/, '')
    if (/row-level security|violates row-level|permission denied|0 righe/i.test(m)) return 'il database non ti dà il permesso. Esci, rientra e riprova; se resta così, chiedi al titolare.'
    return m
  }

  // ── MODULO PERSONA (nuova / modifica) ─────────────────────────────────────
  function bozzaVuota() {
    return { id: null, nome: '', cognome: '', data_nascita: '', rapporto: 'dipendente', ditta_id: null, ruolo: '', telefono: '', email: '',
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
    ;['nome', 'cognome', 'data_nascita', 'ruolo', 'telefono', 'email', 'data_assunzione', 'data_fine_rapporto', 'nome_agenzia'].forEach(function (k) {
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
      // Solo per le persone nuove: serve a capire se esiste già. Dopo si cambia in «Dati personali».
      (f.id ? '' : campo('ps-data_nascita', 'Data di nascita', input('ps-data_nascita', f.data_nascita, '', 'date'), 'Serve a capire se la persona esiste già. La vedono solo titolare e responsabile.')) +
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
      campo('ps-data_fine_rapporto', 'Fine rapporto', input('ps-data_fine_rapporto', f.data_fine_rapporto, '', 'date'), 'È l\'ultimo giorno di lavoro. Vuota = tempo indeterminato. Dal giorno dopo va in Archivio (sparisce dagli elenchi di lavoro) e l\'accesso alle app si blocca da solo.') +
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
        '<div class="campi-due">' + campo('ps-nd-cap', 'NPA', input('ps-nd-cap', '', ' autocomplete="off" inputmode="numeric" maxlength="10" list="ps-nd-cap-lista"') + '<datalist id="ps-nd-cap-lista"></datalist>') +
          campo('ps-nd-citta', 'Località', input('ps-nd-citta', '', ' autocomplete="off" maxlength="120" list="ps-nd-loc-lista"') + '<datalist id="ps-nd-loc-lista"></datalist>') + '</div>' +
        '<div id="ps-nd-cap-aiuto" class="campo-aiuto"></div>' +
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
    if (el('ps-nd-cap') && window.CAP) CAP.collega('ps-nd-cap', 'ps-nd-citta', 'ps-nd-cap-aiuto')   // ditta nuova: NPA ↔ località
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
        ragione_sociale: ragione, telefono: vuotoNull(v('ps-nd-telefono')), cap: vuotoNull(v('ps-nd-cap')), citta: vuotoNull(v('ps-nd-citta')),
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

  // ── Esiste già? (v9) ──────────────────────────────────────────────────────
  // Nome e cognome anche scambiati o con gli spazi diversi: «Gian Luca Rossi» = «Rossi Gianluca».
  function chiaveNome(n, c) { return AC.normale(n + ' ' + c).split(' ').filter(Boolean).sort().join('') }
  // Telefono: solo le ultime 9 cifre, così 079 111 11 11 = +41 79 111 11 11 = 0041791111111. Meno di 6 cifre non è un numero.
  function chiaveTelefono(t) { var d = String(t || '').replace(/\D/g, ''); return d.length < 6 ? '' : d.slice(-9) }
  // Rilegge dal database (nel frattempo un altro può aver inserito). Le date di nascita servono solo per il confronto.
  // forti = stessa persona quasi di certo (Esiste già). omonimi = solo il nome uguale (avviso, non si confonde).
  async function cercaDoppioni(f, email) {
    await carica(true)
    var nascite = null
    try {
      nascite = {}
      ;(await AD.leggi('operai_dati_personali', 'operaio_id,data_nascita')).forEach(function (d) { nascite[d.operaio_id] = d.data_nascita })
    } catch (e) {
      if (e.sessioneAssente) throw e
      nascite = null
    }
    var kn = chiaveNome(f.nome, f.cognome), kt = chiaveTelefono(f.telefono), esito = { forti: [], omonimi: [] }
    ST.operai.forEach(function (o) {
      var motivi = [], stessoNome = chiaveNome(o.nome, o.cognome) === kn, dn = nascite ? nascite[o.id] : null
      if (stessoNome && f.data_nascita && dn === f.data_nascita) motivi.push('nome, cognome e data di nascita (' + AC.data(dn) + ')')
      if (email && String(o.email || '').trim().toLowerCase() === email) motivi.push('email (' + o.email + ')')
      if (kt && chiaveTelefono(o.telefono) === kt) motivi.push('telefono (' + o.telefono + ')')
      if (motivi.length) { esito.forti.push({ o: o, motivi: motivi }); return }
      if (!stessoNome) return
      var perche = !nascite ? 'non riesco a leggere le date di nascita.'
        : (f.data_nascita && dn) ? 'la data di nascita è diversa (' + AC.data(dn) + ').'
        : dn ? 'nel modulo manca la data di nascita.'
        : f.data_nascita ? 'quella scheda non ha la data di nascita.'
        : 'manca la data di nascita.'
      esito.omonimi.push({ o: o, perche: perche })
    })
    return esito
  }
  function statoDoppione(o) {
    if (attiva(o)) return 'è fra gli attivi.'
    return testoArchivio(o) + '.'
  }
  function htmlDoppioni(t) {
    var h = t.forti.map(function (x) {
      var o = x.o, arch = !attiva(o)
      return AC.avviso('warn', '<div class="doppione"><strong>Esiste già ' + esc(nome(o)) + '</strong>, ' + esc(statoDoppione(o)) +
        (arch ? ' Riattivare la scheda vecchia?' : '') +
        '<span class="dato-sotto">Uguale: ' + esc(x.motivi.join(', ')) + '.' + (arch && o.data_fine_rapporto ? ' Ultimo giorno di lavoro: ' + esc(AC.data(o.data_fine_rapporto)) + '.' : '') + '</span>' +
        '<div class="azioni-riga">' + (arch
          ? '<button type="button" class="btn btn-primario" data-ps-riattiva="' + esc(o.id) + '">' + ico('persone') + '<span>Riattiva</span></button>'
          : '<a class="btn btn-primario" data-libera="1" href="#persona/' + esc(o.id) + '">' + ico('apri') + '<span>Apri la scheda</span></a>') + '</div></div>')
    }).join('')
    h += t.omonimi.map(function (x) {
      var o = x.o
      return AC.avviso('info', '<div class="doppione"><strong>C\'è già una persona con questo nome: ' + esc(nome(o)) + '</strong>, ' + esc(statoDoppione(o)) +
        '<span class="dato-sotto">Non posso dire che sia la stessa: ' + esc(x.perche) + '</span>' +
        '<div class="azioni-riga"><a class="btn btn-secondario" data-libera="1" href="#persona/' + esc(o.id) + '">' + ico('apri') + '<span>Apri quella scheda</span></a></div></div>')
    }).join('')
    return h + '<div class="azioni-riga"><button type="button" class="btn btn-secondario btn-largo" data-ps-azione="salva-comunque">' + ico('salva') + '<span>È un\'altra persona</span></button></div>'
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
    if (orig && email) {
      var doppia = ST.operai.filter(function (o) { return o.id !== f.id && String(o.email || '').trim().toLowerCase() === email })[0]
      if (doppia) return erroreCampo('ps-email', 'Questa email è già di ' + nome(doppia) + '. Ogni persona ha la sua.')
    }
    // Persona nuova: esiste già? Avviso, mai blocco (con «È un'altra persona» si salva).
    if (!orig && !ST.salvaComunque) {
      var bc = el('ps-salva'); bc.disabled = true
      var trovati
      try { trovati = await cercaDoppioni(f, email) } catch (e) {
        if (e.sessioneAssente) return APP.sessioneScaduta()
        bc.disabled = false
        el('ps-avvisi').innerHTML = AC.avviso('warn', '<strong>Non riesco a controllare se esiste già.</strong> ' + esc(spiega(e)) +
          '<div class="azioni-riga"><button type="button" class="btn btn-secondario" data-ps-azione="salva-comunque">' + ico('salva') + '<span>Salva senza controllo</span></button></div>')
        el('ps-avvisi').scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      bc.disabled = false
      if (trovati.forti.length || trovati.omonimi.length) {
        el('ps-avvisi').innerHTML = htmlDoppioni(trovati)
        el('ps-avvisi').scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }
    // «È un'altra persona» con la stessa email: si salva senza email. Ogni persona ha la sua, e il collegamento agli account passa da lì.
    var emailTolta = null
    if (!orig && email && ST.operai.some(function (o) { return String(o.email || '').trim().toLowerCase() === email })) { emailTolta = email; email = '' }

    // Fine rapporto che blocca l'accesso: avviso e conferma (mai un blocco per sbaglio)
    var fineNuova = vuotoNull(f.data_fine_rapporto)
    // Togliere a mano la fine rapporto di chi è in Archivio cancella l'ultimo giorno. Avviso: se torna a lavorare si usa Riattiva.
    if (orig && !attiva(orig) && orig.data_fine_rapporto && !fineNuova && !ST.confermaTogliFine) {
      el('ps-avvisi').innerHTML = AC.avviso('warn', '<strong>Stai togliendo la fine rapporto (' + esc(AC.data(orig.data_fine_rapporto)) + ').</strong> Così quella data si perde. Se è tornato a lavorare usa «Riattiva»: il periodo vecchio resta scritto.' +
        '<div class="azioni-riga"><button type="button" class="btn btn-primario" data-ps-riattiva="' + esc(orig.id) + '">' + ico('persone') + '<span>Riattiva</span></button>' +
        '<button type="button" class="btn btn-secondario" data-ps-azione="togli-fine-comunque">' + ico('salva') + '<span>Era un errore: salva così</span></button></div>')
      el('ps-avvisi').scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (orig && orig.user_id && fineNuova && fineNuova !== (orig.data_fine_rapporto || null) && !ST.confermaFine) {
      var pr = profilo(orig.user_id), mia = !!(ST.utente && orig.user_id === ST.utente.id), oggiS = AC.oggiIso()
      var testoConf = null
      if (pr && pr.ruolo === 'titolare') {
        if (mia) testoConf = '<strong>Stai mettendo la fine rapporto alla TUA scheda.</strong> Sei titolare: il tuo accesso NON si blocca da solo, ma dal ' +
          esc(AC.data(giornoDopo(fineNuova))) + ' risulterai in Archivio in tutte le app. Confermi?'
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
        if (emailTolta) {
          ST.messaggio.tipo = 'warn'
          ST.messaggio.html += '<br><strong>Salvato senza email:</strong> ' + esc(emailTolta) + ' è già di un\'altra persona, e ognuno ha la sua. Con «Modifica» scrivine un\'altra.'
        }
        if (f.data_nascita) {
          try {
            ST.dp[salvata.id] = await AD.upsert('operai_dati_personali', { operaio_id: salvata.id, data_nascita: f.data_nascita }, 'operaio_id', COL_DP)
          } catch (ex) {
            if (ex.sessioneAssente) throw ex
            ST.messaggio.tipo = 'warn'
            ST.messaggio.html += '<br><strong>La scheda è salvata, la data di nascita NO.</strong> Riscrivila in «Dati personali». ' + esc(spiega(ex))
          }
        }
      } else {
        salvata = await AD.aggiorna('operai', orig.id, riga, col)
        ST.operai = ST.operai.map(function (o) { return o.id === salvata.id ? salvata : o })
        ST.messaggio = { tipo: 'ok', html: 'Modifiche salvate.' }
        // la fine rapporto può aver bloccato l'accesso (lo fa il database): rileggo accessi e blocchi
        if (orig.user_id && (salvata.data_fine_rapporto || null) !== (orig.data_fine_rapporto || null)) ST.caricato = false
      }
      if (!salvata.rapporto) salvata.rapporto = 'dipendente'
      ST.form = null; ST.salvaComunque = false; ST.confermaFine = false; ST.confermaTogliFine = false
      APP.libera()
      location.hash = '#persona/' + salvata.id
    } catch (e) { ST.salvaComunque = false; ST.confermaTogliFine = false; erroreSalva(e) }
  }

  // ── MODULO DATI PERSONALI ─────────────────────────────────────────────────
  function disegnaDatiPersonali(o) {
    var d = ST.dp[o.id] || {}, indietro = '#persona/' + o.id
    var h = '<form id="ps-dp-modulo" novalidate>' + testata('Dati personali · ' + nome(o), '', '', indietro) +
      AC.avviso('warn', '<strong>Niente dati sanitari</strong> (malattie, allergie, farmaci, certificati medici). Li vedono solo titolare e responsabile.') +
      '<div class="blocco">' + campo('dp-data_nascita', 'Data di nascita', input('dp-data_nascita', d.data_nascita, '', 'date')) +
      campo('dp-via', 'Via e numero', input('dp-via', d.via, ' autocomplete="off" maxlength="160"')) +
      '<div class="campi-due">' + campo('dp-cap', 'NPA', input('dp-cap', d.cap, ' autocomplete="off" inputmode="numeric" maxlength="10" list="dp-cap-lista"') + '<datalist id="dp-cap-lista"></datalist>') +
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
    var t = ev.target.closest('[data-apri-persona],[data-ps-azione],[data-ps-ditta],[data-ps-file],[data-ps-riattiva],[data-ps-periodo-correggi],[data-ps-periodo-togli]')
    if (!t) return
    if (t.dataset.apriPersona) { location.hash = '#persona/' + t.dataset.apriPersona; return }
    if (t.dataset.psFile) { apriFile(t.dataset.psFile, t); return }
    if (t.dataset.psPeriodoCorreggi) { var pc = periodoAperto(t.dataset.psPeriodoCorreggi); if (pc) apriCorreggiPeriodo(pc.o, pc.p); return }
    if (t.dataset.psPeriodoTogli) { var pt = periodoAperto(t.dataset.psPeriodoTogli); if (pt) apriTogliPeriodo(pt.o, pt.p); return }
    if (t.dataset.psRiattiva) {
      var ori = perId(t.dataset.psRiattiva); if (!ori) return
      if (ST.form) leggiModulo()
      apriRiattiva(ori, ST.form ? { modulo: true, inizio: ST.form.id ? '' : ST.form.data_assunzione } : null)
      return
    }
    if (t.dataset.psDitta) {
      leggiModulo(); ST.form.ditta_id = t.dataset.psDitta; ST.form.nuovaDitta = false
      el('ps-ditta').innerHTML = htmlDitta(); collegaDitta(); return
    }
    var a = t.dataset.psAzione
    if (a === 'nuova') { location.hash = '#nuova-persona'; return }
    if (a === 'archivia') { var oa = perId(aperto); if (oa) apriArchivia(oa); return }
    if (a === 'cancella') { var oc = perId(aperto); if (oc) apriCancella(oc); return }
    if (a === 'ex') { ST.mostraEx = !ST.mostraEx; disegnaElenco(aperto); return }
    if (a === 'ditta-cambia') { leggiModulo(); ST.form.ditta_id = null; el('ps-ditta').innerHTML = htmlDitta(); collegaDitta(); el('ps-ditta-cerca').focus(); return }
    if (a === 'ditta-nuova') { leggiModulo(); ST.form.nuovaDitta = true; el('ps-ditta').innerHTML = htmlDitta(); collegaDitta(); el('ps-nd-ragione').focus(); return }
    if (a === 'ditta-annulla') { ST.form.nuovaDitta = false; el('ps-ditta').innerHTML = htmlDitta(); collegaDitta(); return }
    if (a === 'ditta-salva') { salvaNuovaDitta(); return }
    if (a === 'ditta-comunque') { ST.form.dittaComunque = true; salvaNuovaDitta(); return }
    if (a === 'salva-comunque') { ST.salvaComunque = true; salvaPersona(); return }
    if (a === 'fine-conferma') { ST.confermaFine = true; salvaPersona(); return }
    if (a === 'togli-fine-comunque') { ST.confermaTogliFine = true; salvaPersona(); return }
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
      if (sotto === 'modifica') { if (!ST.form || ST.form.id !== id) ST.form = bozzaDa(o); ST.salvaComunque = false; ST.confermaFine = false; ST.confermaTogliFine = false; return disegnaModulo() }
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

  return { mostra: mostra, avvia: avvia, svuota: svuota, scarta: scarta, ricarica: function () { ST.caricato = false }, mostraRegistroPeriodi: mostraRegistroPeriodi,
           // per le prove
           _st: ST, _attiva: attiva, _giornoDopo: giornoDopo, _chiaveNome: chiaveNome, _chiaveTelefono: chiaveTelefono }
})()
