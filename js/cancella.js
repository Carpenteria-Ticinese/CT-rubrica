/* ═══════════════════════════════════════════════════════════════════════════
   Anagrafiche — CANCELLARE (v10, regole di Umberto del 4.11.2026)

   Solo il titolare, dopo aver riscritto la password, e va nel Registro. Una persona si cancella se non ha paghe, ore
   o altri dati da conservare per 10 anni (CO 958f): quelli bloccano (LEGAMI.legami), e si archivia. Documenti, dati
   personali, contatti d'emergenza, cantieri visibili, ore contrattuali, riga di blocco per fine rapporto (DIR_11: l'account
   resta bloccato) vanno via con la scheda (LEGAMI.viaCon): prima l'avviso con quei dati e «Archivia invece». Commesse e contatti: ogni riga collegata blocca, come prima.

   Il database fa la sua parte: DIR_02 (DELETE solo al titolare, il trigger scrive il registro) e DIR_10 (il trigger
   anag_blocca_con_dati conta anche le righe che le regole RLS nascondono e rifiuta con il codice 23503). Qui c'è il resto:
     1. conta dalle tabelle i dati collegati;
     2. se ne c'è anche uno che blocca: schermo di blocco, dice cosa c'è, niente password, «Archivia invece»;
     3. se una lettura è negata o dà errore: non si va avanti;
     4. altrimenti avviso con «Archivia invece» accanto a «Cancella» e riconferma: password del
        login in uso, signInWithPassword di verifica. La password non si salva, non si scrive da
        nessuna parte, il campo si svuota SEMPRE;
     5. cancella e controlla le righe restituite (0 righe = errore a schermo).
   L'app può vedere meno del database (RLS, tabella nuova non in LEGAMI): se il database rifiuta
   (23503) si mostra lo stesso schermo di blocco, a parole, e l'accesso bloccato prima si sblocca.

   I FILE della persona (Umberto, 4.11.2026): dentro un trigger Supabase non lascia togliere i file. Il database scrive l'elenco
   nel riepilogo del registro (chiave _file, DIR_10). Dopo la cancellazione l'app legge quell'elenco e li toglie con l'API di Storage.
   Se un file non si toglie lo dice col nome, il registro resta com'è, e si può riprovare qui o dal Registro.
   L'ultimo file tolto (o non più nell'archivio) si segna con anag_segna_file_tolti. Finché non è segnato, all'apertura il titolare ha un avviso.
   Le foto di cantiere restano, sono della ditta: il database scrive «ex collaboratore» al posto del nome. Un file usato anche da un'altra riga resta e lo dice.
   Delle commesse nessun file. Dei contatti solo le foto (o.file).

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
    anag_blocchi_fine_rapporto: ['nota del blocco di accesso', 'note del blocco di accesso'],
    anag_periodi_rapporto: ['periodo di rapporto passato', 'periodi di rapporto passati'],
    anag_file_persona: ['elenco dei file', 'elenco dei file'],
    tm_documenti: ['documento nell\'archivio vecchio', 'documenti nell\'archivio vecchio'],
    tm_operaio_documenti: ['documento nel vecchio elenco persone', 'documenti nel vecchio elenco persone'],
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
    rf_fornitori: ['fornitore in Materiali', 'fornitori in Materiali'],
    tm_conta_fatture: ['fattura di vendita', 'fatture di vendita'],
    tm_conta_fatture_acquisto: ['fattura d\'acquisto', 'fatture d\'acquisto'],
    tm_conta_movimenti_propri: ['movimento in Contabilità', 'movimenti in Contabilità'],
    tm_conta_offerte: ['offerta in Contabilità', 'offerte in Contabilità'],
    tm_conta_classificazioni: ['classificazione in Contabilità', 'classificazioni in Contabilità'],
    tm_conta_cantiere_contratto: ['contratto in Contabilità', 'contratti in Contabilità'],
    tm_conta_rubrica_assegnazioni: ['periodo nello storico del conto incassi', 'periodi nello storico del conto incassi'],
    anag_commessa_scheda: ['scheda commessa (accesso, ponteggio, permessi, rischi)', 'schede commessa'],
    anag_commessa_contratto: ['termine e penali', 'termini e penali'],
    anag_commessa_ruoli: ['ruolo del cantiere', 'ruoli del cantiere'],
    anag_commessa_storico: ['riga nello storico della scheda', 'righe nello storico della scheda'],
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

  // legami: ogni riga in una di queste tabelle BLOCCA la cancellazione. Le chiavi esterne (pg_constraint, 4.11.2026)
  // più le colonne senza chiave esterna che DIR_10 guarda a mano. Stesso elenco del database, che però lo legge dal catalogo.
  // viaCon: persone e (ANAG_11) commesse. Vanno via con la scheda o la commessa (chiave a cascata): si dicono nell'avviso e finiscono nel riepilogo del registro.
  // restano: solo persone, non bloccano e non vanno via (foto del cantiere): si dice soltanto quante sono.
  // somma: colonna da sommare e mostrare («… ore»).
  // ancheAccount: senza chiave esterna; il database confronta sia l'id della scheda sia l'id dell'account
  // (foto.operaio_id contiene l'id dell'account).
  var LEGAMI = {
    persona: {
      tabella: 'operai', cosa: 'la scheda',
      legami: [
        { t: 'giornate', c: 'operaio_id', somma: 'ore_totali' },
        { t: 'tm_paghe_periodo', c: 'operaio_id' }, { t: 'tm_paghe_anagrafica', c: 'operaio_id' },
        { t: 'assenze', c: 'operaio_id' },
        { t: 'regia', c: 'operaio_id' }, { t: 'spese', c: 'operaio_id' }, { t: 'bolle_consegna', c: 'operaio_id' },
        { t: 'piano_giorno', c: 'operaio_id' }, { t: 'mezzi', c: 'operaio_default_id' },
        { t: 'tm_documenti', c: 'operaio_id' },
        { t: 'anag_periodi_rapporto', c: 'operaio_id' },
        { t: 'tm_sicurezza_dpi', c: 'operaio_id', ancheAccount: true },
        { t: 'pl_assegnazioni', c: 'persona_id', ancheAccount: true },
        { t: 'pl_assegnazioni_previste', c: 'persona_id', ancheAccount: true },
        { t: 'pl_assenze', c: 'persona_id', ancheAccount: true },
        { t: 'tm_operaio_documenti', c: 'operaio_id', ancheAccount: true }
      ],
      viaCon: [
        { t: 'documenti_operai', c: 'operaio_id' }, { t: 'operai_dati_personali', c: 'operaio_id' }, { t: 'operai_contatti_emergenza', c: 'operaio_id' },
        { t: 'cantieri_visibili', c: 'operaio_id' }, { t: 'ore_contrattuali', c: 'operaio_id' }, { t: 'anag_blocchi_fine_rapporto', c: 'operaio_id' }
      ],
      restano: [{ t: 'foto', c: 'operaio_id', ancheAccount: true }]
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
        { t: 'tm_conta_offerte', c: 'cantiere_id' }, { t: 'tm_conta_cantiere_contratto', c: 'cantiere_id' },
        { t: 'tm_conta_rubrica_assegnazioni', c: 'cantiere_id' }   // CONT_104: RESTRICT. Senza CONT_104 la tabella manca e si salta.
      ],
      // ANAG_11 + DIR_15 (Umberto 9.11.2026): la scheda commessa va via con la commessa. Senza ANAG_11 le tabelle mancano e si saltano.
      viaCon: [
        { t: 'anag_commessa_scheda', c: 'cantiere_id' }, { t: 'anag_commessa_contratto', c: 'cantiere_id' },
        { t: 'anag_commessa_ruoli', c: 'cantiere_id' }, { t: 'anag_commessa_storico', c: 'cantiere_id' }
      ]
    },
    contatto: {
      tabella: 'tm_contatti', cosa: 'il contatto',
      legami: [
        { t: 'cantieri', c: 'cliente_id' }, { t: 'operai', c: 'ditta_id' }, { t: 'rf_fornitori', c: 'contatto_id' },
        { t: 'tm_conta_fatture', c: 'contatto_id' }, { t: 'tm_conta_fatture_acquisto', c: 'contatto_id' },
        { t: 'tm_conta_movimenti_propri', c: 'contatto_id' }, { t: 'tm_conta_offerte', c: 'contatto_id' }, { t: 'pv_offerte', c: 'cliente_id' },
        { t: 'anag_commessa_ruoli', c: 'contatto_id' }   // ANAG_11: RESTRICT, il contatto con un ruolo si archivia
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
    var L = LEGAMI[tipo], elenco = L.legami, esito = { dati: [], via: [], restano: [], errori: [], file: { da_togliere: [], condivisi: [] } }
    function conta(lista, dove, soloAvviso) {
      return Promise.all((lista || []).map(function (l) {
        return contaLegame(l, id, idAccount).then(function (r) {
          if (r.n > 0) dove.push({ t: l.t, n: r.n, somma: r.somma })
        }, function (e) {
          if (e.sessioneAssente) throw e
          if (!tabellaAssente(e) && !soloAvviso) esito.errori.push(l.t)
        })
      }))
    }
    await Promise.all([conta(elenco, esito.dati), conta(L.viaCon, esito.via), conta(L.restano, esito.restano, true)])
    // I file della persona: l'elenco lo fa il database. Funzione assente = DIR_10 non applicato: lì la scheda con documenti è bloccata comunque.
    if (tipo === 'persona') {
      try {
        var f = await AD.rpc('anag_file_persona', { p_operaio: id })
        esito.file = { da_togliere: (f && f.da_togliere) || [], condivisi: (f && f.condivisi) || [] }
      } catch (e3) {
        if (e3.sessioneAssente) throw e3
        if (!/^(PGRST202|42883)$/.test(String(e3.codice || ''))) esito.errori.push('anag_file_persona')
      }
    }
    // sempre nell'ordine dell'elenco, non in quello delle risposte
    var ordine = elenco.map(function (l) { return l.t })
    esito.dati.sort(function (a, b) { return ordine.indexOf(a.t) - ordine.indexOf(b.t) })
    return esito
  }
  function nomeFile(p) { return String(p).split('/').pop() }
  function listaFile(el) { return '<ul class="cx-lista cx-file">' + el.map(function (f) { return '<li>' + esc(nomeFile(f.percorso)) + '</li>' }).join('') + '</ul>' }
  function voce(x) {
    return '<li><strong>' + esc(parole(x.t, x.n)) + '</strong>' +
      (x.somma != null ? ' (' + esc(numeroOre(x.somma)) + ' ore)' : '') + '</li>'
  }
  function lista(voci) { return '<ul class="cx-lista">' + voci.map(voce).join('') + '</ul>' }

  // Il rifiuto del database, a parole. Due forme:
  //   trigger DIR_03: «Non si cancella: dati collegati: giornate (3), spese (1). Si archivia (conservazione 10 anni, CO 958f).»
  //   trigger DIR_10: uguale, con «dati da conservare:»
  //   chiave esterna: «… violates foreign key constraint "x" on table "spese"» (contatti)
  function vociRifiuto(messaggio) {
    var s = String(messaggio || ''), m = s.match(/dati (?:collegati|da conservare):\s*(.*)/i), voci = []
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
    schermoAvviso(o, an)
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

  function schermoAvviso(o, an) {
    var L = LEGAMI[o.tipo], h = '', fl = an.file
    o.an = an
    h += AC.avviso('warn', '<strong>Si cancella per sempre.</strong> Non si torna indietro.')
    if (an.via.length) h += AC.avviso('warn', '<strong>Vanno via con ' + esc(L.cosa) + ':</strong>' + lista(an.via))
    else if (!fl.da_togliere.length) h += '<p class="nota"><span>Solo ' + esc(L.cosa) + ': nessun dato collegato.</span></p>'
    if (fl.da_togliere.length) h += AC.avviso('warn', '<strong>' + (fl.da_togliere.length === 1 ? 'Si cancella anche 1 file' : 'Si cancellano anche ' + fl.da_togliere.length + ' file') + ' dall\'archivio:</strong>' + listaFile(fl.da_togliere))
    if (fl.condivisi.length) h += '<p class="nota">' + ico('info') + '<span>' + (fl.condivisi.length === 1 ? 'Resta nell\'archivio 1 file usato' : 'Restano nell\'archivio ' + fl.condivisi.length + ' file usati') + ' anche da un\'altra riga:</span></p>' + listaFile(fl.condivisi)
    if (an.restano.length) h += '<p class="nota">' + ico('info') + '<span>' + an.restano.map(function (x) { return esc(parole(x.t, x.n)) + ' di cantiere ' + (x.n === 1 ? 'resta' : 'restano') }).join(', ') + ': sono della ditta. Al posto del nome: «ex collaboratore».</span></p>'
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
    var registrata = false, elenco = null, idRiga = null
    try {
      var r = await AD.leggi('anag_registro_cancellazioni', 'id,riga_id,riepilogo', function (q) { return q.eq('riga_id', String(o.id)) })
      registrata = r.length > 0
      if (registrata) { elenco = r[r.length - 1].riepilogo && r[r.length - 1].riepilogo._file; idRiga = r[r.length - 1].id }
    } catch (e) { registrata = false }
    if (!registrata) { tipo = 'warn'; note += '<p class="nota">' + ico('attenzione') + '<span><strong>Non trovo la riga nel Registro cancellazioni.</strong> Controllalo e avvisa chi gestisce il database.</span></p>' }
    ricaricaTutto()
    // I file della persona: l'elenco del registro è quello scritto dal database. Se il registro non si legge, quello visto nell'avviso.
    var daTogliere = (elenco && elenco.da_togliere) || (o.an && o.an.file.da_togliere) || []
    var condivisi = (elenco && elenco.condivisi) || (o.an && o.an.file.condivisi) || []
    var esito = daTogliere.length ? await togliSenzaEccezioni(daTogliere) : { tolti: [], rimasti: [] }
    if (daTogliere.length && !esito.rimasti.length) await segnaFileTolti(idRiga)
    schermoFatto(o, { tipo: tipo, note: note, registrata: registrata, esito: esito, condivisi: condivisi, idRiga: idRiga })
    avvisoFilePendenti(o.utente)
  }
  // Scrive nel registro che i file sono tolti. Il database controlla nell'archivio: se ne trova uno, non scrive. Se non riesce, l'avviso all'apertura resta: non è un danno.
  async function segnaFileTolti(idRiga) {
    if (!idRiga) return false
    try { var x = await AD.rpc('anag_segna_file_tolti', { p_riga: idRiga }); return !!(x && x.fatto) } catch (e) { if (e.sessioneAssente) APP.sessioneScaduta(); return false }
  }
  function conFile(r) { var f = r.riepilogo && r.riepilogo._file; return !!(f && f.da_togliere && f.da_togliere.length) }
  // Cancellazioni con file ancora da togliere (per esempio: pagina chiusa subito dopo). Solo il titolare. Le righe senza file: niente avviso.
  async function avvisoFilePendenti(utente) {
    var box = el('avviso-file'); if (!box) return
    function nascondi2() { box.hidden = true; box.innerHTML = '' }
    if (!utente || utente.ruolo !== 'titolare') return nascondi2()
    var righe
    try {
      righe = (await AD.leggi('anag_registro_cancellazioni', 'id,quando,nome,riepilogo,file_tolti_il', function (q) { return q.is('file_tolti_il', null) })).filter(conFile)
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      if (AD.colonnaMancante(e) || tabellaAssente(e)) return nascondi2()   // DIR_10 non applicato: niente da guardare
      box.hidden = false
      box.innerHTML = AC.avviso('warn', 'Non riesco a controllare se ci sono file da togliere: ' + esc(e.message))
      return
    }
    if (!righe.length) return nascondi2()
    box.hidden = false
    box.innerHTML = AC.avviso('warn', '<strong>' + (righe.length === 1 ? 'C\'è 1 cancellazione' : 'Ci sono ' + righe.length + ' cancellazioni') + ' con file ancora nell\'archivio.</strong>' +
      '<ul class="cx-lista cx-file">' + righe.map(function (r) { return '<li>' + esc(r.nome || '(senza nome)') + ': ' + esc(r.riepilogo._file.da_togliere.map(function (f) { return nomeFile(f.percorso) }).join(', ')) + '</li>' }).join('') + '</ul>' +
      '<div id="avviso-file-esito"></div><div class="azioni-riga"><button type="button" class="btn btn-primario" id="avviso-file-togli">' + ico('togli') + '<span>Controlla e togli i file rimasti</span></button></div>')
    el('avviso-file-togli').addEventListener('click', async function () {
      this.disabled = true
      var rimasti = []
      for (var i = 0; i < righe.length; i++) {
        var di = await togliSenzaEccezioni(righe[i].riepilogo._file.da_togliere)
        if (di.rimasti.length) rimasti = rimasti.concat(di.rimasti)
        else await segnaFileTolti(righe[i].id)
      }
      if (!rimasti.length) { box.innerHTML = AC.avviso('ok', 'Nell\'archivio non resta nessuno di quei file.'); return }
      await avvisoFilePendenti(utente)
      var e2 = el('avviso-file-esito'); if (e2) e2.innerHTML = htmlEsitoFile({ tolti: [], rimasti: rimasti })
    })
  }
  async function togliSenzaEccezioni(l) {
    try { return await AD.togliFileElenco(l) } catch (e) {
      if (e.sessioneAssente) { APP.sessioneScaduta(); return { tolti: [], rimasti: [] } }
      return { tolti: [], rimasti: l.map(function (f) { return { bucket: f.bucket, percorso: f.percorso, motivo: e.message } }) }
    }
  }
  function htmlEsitoFile(esito, condivisi) {
    var h = ''
    if (esito.tolti.length) h += '<p class="nota" id="cx-file-tolti">' + ico('togli') + '<span>' + (esito.tolti.length === 1 ? 'Tolto dall\'archivio 1 file.' : 'Tolti dall\'archivio ' + esito.tolti.length + ' file.') + '</span></p>'
    if (esito.rimasti.length) h += '<div id="cx-file-rimasti">' + AC.avviso('err', '<strong>' + esito.rimasti.length + (esito.rimasti.length === 1 ? ' file NON tolto' : ' file NON tolti') + ' dall\'archivio:</strong>' +
      '<ul class="cx-lista cx-file">' + esito.rimasti.map(function (f) { return '<li>' + esc(nomeFile(f.percorso)) + ' <span class="dato-sotto">' + esc(f.motivo) + '</span></li>' }).join('') + '</ul>' +
      'La scheda è cancellata e l\'elenco è nel Registro. Puoi riprovare qui o dal Registro.') + '</div>'
    if (condivisi && condivisi.length) h += '<p class="nota" id="cx-file-condivisi">' + ico('info') + '<span>' + (condivisi.length === 1 ? 'Resta nell\'archivio perché usato' : 'Restano nell\'archivio perché usati') + ' anche da un\'altra riga:</span></p>' + listaFile(condivisi)
    return h
  }
  function schermoFatto(o, st) {
    var elenco = o.elenco, rimasti = st.esito.rimasti.length > 0
    schermo('Cancellato',
      AC.avviso(st.tipo === 'ok' && !rimasti ? 'ok' : 'warn', '<strong>' + esc(o.nome) + '</strong> è stato cancellato.' + (st.registrata ? ' È scritto nel Registro cancellazioni.' : '')) +
      (o.notaFatto ? '<p class="nota">' + ico('lucchetto') + '<span>' + esc(o.notaFatto) + '</span></p>' : '') + st.note + htmlEsitoFile(st.esito, st.condivisi) +
      '<div class="vela-azioni">' + (rimasti ? bottone('riprova-file', 'Riprova a togliere i file', 'btn-primario', 'togli', 'cx-primo') : '') +
      bottone('chiudi', 'Chiudi', rimasti ? 'btn-secondario' : 'btn-primario', 'chiudi', rimasti ? '' : 'cx-primo') + bottone('registro', 'Apri il Registro cancellazioni', 'btn-secondario', 'documento') + '</div>',
      {
        registro: function () { dopoChiusura = function () { location.hash = '#registro' }; chiudi() },
        'riprova-file': async function () {
          occupa(true)
          var di = await togliSenzaEccezioni(st.esito.rimasti.map(function (f) { return { bucket: f.bucket, percorso: f.percorso } }))
          st.esito = { tolti: st.esito.tolti.concat(di.tolti), rimasti: di.rimasti }
          if (!di.rimasti.length) { await segnaFileTolti(st.idRiga); avvisoFilePendenti(o.utente) }
          schermoFatto(o, st)
        }
      },
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
    var chiavi = Object.keys(r.riepilogo || {}).filter(function (k) { return k.charAt(0) !== '_' })   // _file: l'elenco dei file, a parte
    if (!chiavi.length) return 'Nessun dato collegato.'
    return chiavi.map(function (t) { return parole(t, r.riepilogo[t]) }).join(', ') + '.'
  }
  // Elenco dei file nel Registro, con il tasto per toglierli se qualcuno è rimasto. Il registro non si scrive: si guarda l'archivio.
  function htmlFileRegistro(r) {
    var f = r.riepilogo && r.riepilogo._file
    if (!f) return ''
    var h = '<div class="dato"><div class="dato-etichetta">File dell\'archivio</div><div class="dato-valore">'
    if (f.da_togliere && f.da_togliere.length) h += '<span class="dato-sotto">Da togliere alla cancellazione:</span>' + listaFile(f.da_togliere)
    if (f.condivisi && f.condivisi.length) h += '<span class="dato-sotto">Restati, perché usati anche da un\'altra riga:</span>' + listaFile(f.condivisi)
    if (f.non_trovati && f.non_trovati.length) h += '<span class="dato-sotto">Scritti nella scheda ma non nell\'archivio: ' + esc(f.non_trovati.map(nomeFile).join(', ')) + '</span>'
    h += '</div>'
    if (r.file_tolti_il) h += '<p class="nota">' + ico('togli') + '<span>Tolti dall\'archivio il ' + esc(quando(r.file_tolti_il)) + '.</span></p>'
    else if (f.da_togliere && f.da_togliere.length) h += '<div class="azioni-riga"><button type="button" class="btn btn-secondario" data-cx-reg-file="' + esc(r.id) + '">' + ico('togli') + '<span>Controlla e togli i file rimasti</span></button></div><div id="cx-reg-file-' + esc(r.id) + '"></div>'
    return h + '</div>'
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
      righe = await AD.leggiConRiserva('anag_registro_cancellazioni', 'id,quando,chi,chi_ruolo,cosa,riga_id,nome,riepilogo,riga,file_tolti_il', 'id,quando,chi,chi_ruolo,cosa,riga_id,nome,riepilogo,riga')
      righe = righe.righe
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
        htmlFileRegistro(r) +
        '<details class="cx-dettagli"><summary>Dati cancellati</summary>' + (datiRiga(r) || '<p class="nota">Nessun altro dato.</p>') + '</details></div>'
    }).join('')
    pane.innerHTML = h
    pane.querySelectorAll('[data-cx-reg-file]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var r = righe.filter(function (x) { return x.id === b.dataset.cxRegFile })[0], box = el('cx-reg-file-' + b.dataset.cxRegFile)
        b.disabled = true
        var di = await togliSenzaEccezioni(r.riepilogo._file.da_togliere)
        b.disabled = false
        if (!di.rimasti.length) { await segnaFileTolti(r.id); avvisoFilePendenti(utente) }
        box.innerHTML = di.rimasti.length ? htmlEsitoFile({ tolti: [], rimasti: di.rimasti }) : AC.avviso('ok', 'Nell\'archivio non resta nessuno di questi file.')
      })
    })
    el('pane-dettaglio').innerHTML = '<div class="vuoto vuoto-grande">' + ico('info') + '<p>Ogni riga dice cosa è stato cancellato, chi, quando e cosa c\'era collegato.</p></div>'
  }

  function avvia() {
    el('vela-cancella').addEventListener('click', clic)
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && aperta && !occupato) { ev.preventDefault(); chiudi() }
    })
  }

  return { avvisoFilePendenti: avvisoFilePendenti, avvia: avvia, cancella: cancella, schermo: schermo, chiudi: chiudi, chiudiSubito: chiudiSubito, bottone: bottone, mostraRegistro: mostraRegistro,
           aperta: function () { return aperta },
           // per le prove
           _LEGAMI: LEGAMI, _parole: parole }
})()
