/* ═══════════════════════════════════════════════════════════════════════════
   Anagrafiche — COMMESSE (tabella cantieri)

   Regole (FASE2_DISEGNO.md, approvato dal Direttore):
   - «Due padroni»: stato_commessa lo scrive SOLO Anagrafiche; cantieri.stato lo
     scrive SOLO l'App Cantieri. Alla CREAZIONE di una commessa Anagrafiche scrive
     stato = 'Completato' (così l'App Cantieri di oggi non la mostra fra i lavori),
     poi non lo tocca mai più. Un interno nuovo nasce 'Attivo' (deve essere visibile).
   - Il numero commessa lo dà il database (trigger anag_cantieri_numero): qui non si
     scrive mai, si mostra dopo il salvataggio.
   - Il nome non si cambia se la commessa ha già foto: l'App Cantieri salva le foto
     in una cartella col NOME del cantiere (index.html righe 5193, 6171, 9078).
     Si controlla nel database (foto, spese.foto_path); se il controllo non riesce,
     il nome resta bloccato lo stesso.
   - Il nome degli interni non si cambia mai (l'App Cantieri li riconosce ancora per nome).
   - Si ARCHIVIA con lo stato Conclusa o Persa (tasto «Archivia»). «Cancella» (v7): solo il titolare, con password,
     avviso e registro (js/cancella.js). I due interni di sistema (codice_interno) non si cancellano mai.
   - Il cliente si sceglie dalla Rubrica (tm_contatti); «committente» resta come
     copia del nome, perché App Cantieri e Pre-contabilità leggono quella.
   - Conto incassi (v11, funzioni dell'SQL CONT_104 della Contabilità): riquadro solo per il titolare. Il dato è lo storico
     in tm_conta_rubrica_assegnazioni, nessuna colonna su cantieri. Senza CONT_104: nessun riquadro, nessun errore.
   - Stampa scheda (v11): un documento per il cliente o il cantiere, niente costi, margini, note interne. Per ora l'IBAN lo
     stampa solo il titolare: per il responsabile non si chiama nemmeno la funzione, sul foglio c'è «lo stampa il titolare».
   ═══════════════════════════════════════════════════════════════════════════ */
var CM = (function () {
  'use strict'
  var esc = AC.esc, ico = AC.ico, el = AC.el

  // ── Stati della commessa: UNA lista sola, in quest'ordine (Persa sempre ultima) ──
  // 11.5 (ANAG_12, Umberto 10.11.2026): nel database le parole sono queste 7. Prima di ANAG_12 il database ha ancora le
  // parole vecchie («vecchia»): l'app le capisce e, finché ANAG_12 non c'è, scrive quelle (Rimandata e Lavoro da iniziare
  // allora non si possono scegliere). «nota»: la nota si chiama «Motivo». «richiamo»: data per richiamare il cliente.
  // «periodo»: il periodo previsto si mostra sempre nel modulo (per gli altri stati solo se è già scritto).
  var STATI = [
    { v: 'Offerta da fare',    i: '📝', cls: 'st-dafare',     vecchia: 'Da fare',  filtro: 'Offerte da fare',    aperta: true,  periodo: true },
    { v: 'Offerta inviata',    i: '📤', cls: 'st-inviata',    vecchia: 'Inviata',  filtro: 'Offerte inviate',    aperta: true,  periodo: true },
    { v: 'Rimandata',          i: '⏸️', cls: 'st-rimandata',  vecchia: null,       filtro: 'Rimandate',          aperta: true,  periodo: true, motivo: true, richiamo: true },
    { v: 'Lavoro da iniziare', i: '✅', cls: 'st-dainiziare', vecchia: null,       filtro: 'Lavori da iniziare', aperta: true,  periodo: true },
    { v: 'Lavoro in corso',    i: '🔨', cls: 'st-incorso',    vecchia: 'In corso', filtro: 'Lavori in corso',    aperta: true },
    { v: 'Lavoro finito',      i: '🏁', cls: 'st-conclusa',   vecchia: 'Conclusa', filtro: 'Lavori finiti',      aperta: false },
    { v: 'Persa',              i: '❌', cls: 'st-persa',      vecchia: 'Persa',    filtro: 'Perse',              aperta: false, motivo: true }
  ]
  function normaleStato(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase() }
  // Valore del database (parola nuova o vecchia, anche «Da iniziare») → voce della lista, oppure null (vuoto o sconosciuto).
  function statoDi(valore) {
    var n = normaleStato(valore)
    if (!n) return null
    if (n === 'da iniziare') n = 'lavoro da iniziare'
    return STATI.filter(function (s) { return normaleStato(s.v) === n || (s.vecchia && normaleStato(s.vecchia) === n) })[0] || null
  }
  function chiaveStato(c) { var s = statoDi(c && c.stato_commessa); return s ? s.v : null }
  function parolaStato(valore) { var s = statoDi(valore); return s ? s.i + ' ' + s.v : (valore ? '❔ ' + valore : '') }
  function htmlStato(valore) { var s = statoDi(valore); return s ? '<span aria-hidden="true">' + s.i + '</span> ' + esc(s.v) : '<span aria-hidden="true">❔</span> ' + esc(valore) }
  // Stati che si possono scegliere: senza ANAG_12 solo quelli che hanno una parola vecchia.
  function statiDaScegliere() { return STATI.filter(function (s) { return ST.stati12 || s.vecchia }) }
  // La parola da scrivere nel database (solo senza ANAG_12; con ANAG_12 si passa dalla funzione).
  function valoreDb(v) { var s = statoDi(v); return !s ? null : ST.stati12 ? s.v : s.vecchia }
  var FILTRI = [{ k: 'aperte', n: 'Aperte' }].concat(STATI.map(function (s) { return { k: s.v, n: s.filtro, s: s } }),
    [{ k: 'senza', n: 'Senza stato' }, { k: 'tutte', n: 'Tutte' }])
  var COL_STATO_12 = ',stato_nota,richiamo_il,periodo_previsto,mese_inizio_previsto'
  // codice_interno arriva con l'SQL ANAG_F2_03: se manca si legge senza (l'interno si riconosce dal tipo).
  var COL_CANTIERI_VECCHIE = 'id,nome,luogo,committente,stato,note,via,cap,citta,paese,numero_commessa,stato_commessa,tipo,cliente_id,created_at'
  var COL_CANTIERI = COL_CANTIERI_VECCHIE + ',codice_interno'
  var COL_CONTATTI = 'id,ragione_sociale,nome,cognome,citta,telefono,cellulare,email,attivo'
  var BOZZA_KEY = 'anag_bozza_commessa'

  var ST = {
    cantieri: [], contatti: [], caricato: false,
    filtro: 'aperte', cerca: '',
    foto: {},          // id → { stato: 'controllo' | 'si' | 'no' | 'errore', n }
    messaggio: null,   // avviso da mostrare una volta, in cima alla scheda
    form: null,        // la commessa che si sta scrivendo (nuova o modifica)
    salvaComunque: false
  }

  // ── Dati ───────────────────────────────────────────────────────────────────
  async function carica(forza) {
    if (ST.caricato && !forza) return
    var r = await Promise.all([
      leggiCantieri(),
      AD.leggi('tm_contatti', COL_CONTATTI)
    ])
    ST.colCantieri = r[0].colonne
    ST.stati12 = r[0].stati12
    r[0] = r[0].righe
    // Canarino: i due interni ci sono sempre. Zero righe = il database non dà i
    // dati a questo utente (o regole cambiate): niente elenchi vuoti che sembrano veri.
    if (r[0].length < 2) {
      throw new Error('Il database non mi dà le commesse (' + r[0].length + ' righe). L\'elenco NON è attendibile: esci, rientra e riprova.')
    }
    ST.cantieri = r[0]
    ST.contatti = r[1]
    ST.caricato = true
  }
  // 11.5: prima con le colonne di ANAG_12 (stato_nota, richiamo_il, periodo_previsto, mese_inizio_previsto).
  // Se mancano (42703: ANAG_12 non ancora applicato) si legge come prima e si scrivono le parole vecchie.
  async function leggiCantieri() {
    try { return { righe: await AD.leggi('cantieri', COL_CANTIERI + COL_STATO_12), colonne: COL_CANTIERI + COL_STATO_12, stati12: true } }
    catch (e) { if (!AD.colonnaMancante(e)) throw e }
    var r2 = await AD.leggiConRiserva('cantieri', COL_CANTIERI, COL_CANTIERI_VECCHIE)
    return { righe: r2.righe, colonne: r2.complete ? COL_CANTIERI : COL_CANTIERI_VECCHIE, stati12: false }
  }
  function scarta() { ST.form = null; ST.salvaComunque = false }
  function svuota() { ST.cantieri = []; ST.contatti = []; ST.caricato = false; ST.foto = {}; ST.form = null; ST.messaggio = null; CONTO.dati = null; CONTO.form = false; CONTO.giro++; puliziaStampa() }

  function perId(id) { return ST.cantieri.filter(function (c) { return c.id === id })[0] || null }
  function contatto(id) { return ST.contatti.filter(function (k) { return k.id === id })[0] || null }
  function eInterno(c) { return c && c.tipo === 'interno' }
  // «Spese ditta» si mostra «Lavori per la ditta» (QUADRO punto 4). Si riconosce
  // dal codice_interno, MAI dal nome. Dopo ANAG_F2_05 anche il nome nel database è quello.
  function nomeMostrato(c) { return c && c.codice_interno === 'ditta' ? 'Lavori per la ditta' : (c && c.nome) || '' }
  function nomeCliente(c) {
    var k = c && c.cliente_id ? contatto(c.cliente_id) : null
    if (k) return AC.nomeContatto(k)
    return (c && c.committente) || ''
  }
  // La cartella che l'App Cantieri userebbe per le foto (stessa trasformazione, riga 5189)
  function cartellaFoto(nome) { return String(nome || '').replace(/[^a-zA-Z0-9]/g, '_') }

  function ordinaCommesse(a, b) {
    var na = a.numero_commessa || '', nb = b.numero_commessa || ''
    if (na && nb && na !== nb) return na < nb ? 1 : -1
    if (na && !nb) return -1
    if (!na && nb) return 1
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  }
  function passaFiltro(c, f) {
    var s = statoDi(c.stato_commessa)
    if (f === 'tutte') return true
    if (f === 'senza') return !c.stato_commessa
    if (f === 'aperte') return !s || s.aperta   // vuoto o sconosciuto: fra le aperte (meglio visto in più che nascosto)
    return !!s && s.v === f
  }
  // Rimandate: prima chi va richiamato prima. Lavori da iniziare: per mese di inizio. Senza data in fondo.
  function ordinaPerData(col) {
    return function (a, b) {
      var x = a[col] || '', y = b[col] || ''
      if (x && y && x !== y) return x < y ? -1 : 1
      if (x && !y) return -1
      if (!x && y) return 1
      return ordinaCommesse(a, b)
    }
  }
  function dataCorta(iso) { return iso ? AC.data(iso) : '' }
  function meseParole(iso) {
    if (!iso) return ''
    var m = String(iso).match(/^(\d{4})-(\d{2})/)
    var MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
    return m ? MESI[Number(m[2]) - 1] + ' ' + m[1] : String(iso)
  }
  function richiamoPassato(c) { return !!c.richiamo_il && c.richiamo_il <= AC.oggiIso() }
  // La riga piccola sotto il nome, nell'elenco: quando richiamare, quando si pensa di partire.
  function sottoStato(c) {
    var s = statoDi(c.stato_commessa)
    if (!s) return ''
    if (s.richiamo && c.richiamo_il) return (richiamoPassato(c) ? '📞 Da richiamare dal ' : '📞 Richiamare il ') + dataCorta(c.richiamo_il)
    if (s.periodo && (c.periodo_previsto || c.mese_inizio_previsto)) return '🗓️ ' + (c.periodo_previsto || meseParole(c.mese_inizio_previsto))
    return ''
  }
  function passaRicerca(c) {
    if (!ST.cerca) return true
    var testo = AC.normale([c.numero_commessa, c.nome, nomeCliente(c), c.committente, c.luogo, c.citta].join(' '))
    return AC.normale(ST.cerca).split(' ').every(function (p) { return testo.indexOf(p) >= 0 })
  }

  // ── Pezzi di pagina ────────────────────────────────────────────────────────
  function badgeStato(c) {
    if (eInterno(c)) return '<span class="badge st-interno">Interno</span>'
    var s = statoDi(c.stato_commessa)
    if (!c.stato_commessa) return '<span class="badge st-senza">Senza stato</span>'
    return '<span class="badge ' + (s ? s.cls : 'st-senza') + '">' + htmlStato(c.stato_commessa) + '</span>'
  }
  function rigaCommessa(c, scelta) {
    var cli = nomeCliente(c)
    var luogo = c.luogo || c.citta || ''
    var extra = eInterno(c) ? '' : sottoStato(c)
    return '<button type="button" class="riga' + (scelta ? ' riga-scelta' : '') + '" data-apri="' + esc(c.id) + '">' +
             '<span class="riga-numero">' + (eInterno(c) ? ico('interni') : esc(c.numero_commessa || '—')) + '</span>' +
             '<span class="riga-testo"><span class="riga-nome">' + esc(nomeMostrato(c)) + '</span>' +
               (cli || luogo ? '<span class="riga-sotto">' + esc([cli, luogo].filter(Boolean).join(' · ')) + '</span>' : '') +
               (extra ? '<span class="riga-sotto riga-stato-extra' + (richiamoPassato(c) && statoDi(c.stato_commessa) && statoDi(c.stato_commessa).richiamo ? ' richiamo-passato' : '') + '">' + esc(extra) + '</span>' : '') +
             '</span>' + badgeStato(c) +
           '</button>'
  }

  // ── ELENCO ─────────────────────────────────────────────────────────────────
  function disegnaElenco(idScelto) {
    var pane = el('pane-elenco')
    var commesse = ST.cantieri.filter(function (c) { return !eInterno(c) })
    var interni = ST.cantieri.filter(eInterno).sort(function (a, b) { return nomeMostrato(a).localeCompare(nomeMostrato(b), 'it') })
    var conta = {}
    FILTRI.forEach(function (f) { conta[f.k] = commesse.filter(function (c) { return passaFiltro(c, f.k) }).length })
    var mostrate = commesse.filter(function (c) { return passaFiltro(c, ST.filtro) && passaRicerca(c) })
      .sort(ST.filtro === 'Rimandata' ? ordinaPerData('richiamo_il') : ST.filtro === 'Lavoro da iniziare' ? ordinaPerData('mese_inizio_previsto') : ordinaCommesse)
    // Senza ANAG_12 i due stati nuovi non esistono ancora: i loro filtri non si mostrano.
    var filtri = FILTRI.filter(function (f) { return !f.s || ST.stati12 || f.s.vecchia || conta[f.k] })

    var h = '<div class="barra-elenco">' +
        '<label class="cerca">' + ico('cerca') + '<span class="nascosto">Cerca</span>' +
          '<input id="cm-cerca" type="search" autocomplete="off" placeholder="Cerca numero, nome, cliente, località" value="' + esc(ST.cerca) + '"></label>' +
        '<button type="button" class="btn btn-primario" data-azione="nuova">' + ico('piu') + '<span>Nuova commessa</span></button>' +
      '</div>' +
      '<div class="filtri" role="group" aria-label="Filtra per stato">' +
        filtri.map(function (f) {
          var p = f.s
          return '<button type="button" class="filtro' + (ST.filtro === f.k ? ' filtro-attivo' : '') + '" data-filtro="' + esc(f.k) + '" aria-pressed="' + (ST.filtro === f.k) + '">' +
                 (p ? '<span class="pallino ' + p.cls + '" aria-hidden="true"></span><span aria-hidden="true">' + p.i + '</span> ' : '') +
                 esc(f.n) + ' <span class="filtro-n">' + conta[f.k] + '</span></button>'
        }).join('') +
      '</div>'

    h += '<div class="elenco" aria-live="polite">'
    if (!mostrate.length) {
      h += '<div class="vuoto">' + (ST.cerca ? 'Nessuna commessa trovata per «' + esc(ST.cerca) + '».' : 'Nessuna commessa in questo filtro.') + '</div>'
    } else {
      h += mostrate.map(function (c) { return rigaCommessa(c, c.id === idScelto) }).join('')
    }
    h += '</div>'

    h += '<h2 class="sezione-titolo">' + ico('interni') + 'Interni <span class="sezione-nota">ore e spese della ditta</span></h2>' +
         '<div class="elenco">' + interni.map(function (c) { return rigaCommessa(c, c.id === idScelto) }).join('') + '</div>' +
         '<button type="button" class="btn btn-secondario btn-largo" data-azione="nuovo-interno">' + ico('piu') + '<span>Nuovo interno</span></button>'

    pane.innerHTML = h
    var cerca = el('cm-cerca')
    cerca.addEventListener('input', function () {
      ST.cerca = cerca.value
      var pos = cerca.selectionStart
      disegnaElenco(idScelto)
      var c2 = el('cm-cerca'); c2.focus(); try { c2.setSelectionRange(pos, pos) } catch (_) {}
    })
  }

  // ── SCHEDA ─────────────────────────────────────────────────────────────────
  function campoLettura(etichetta, valoreHtml) {
    return '<div class="dato"><div class="dato-etichetta">' + esc(etichetta) + '</div><div class="dato-valore">' + (valoreHtml || '<span class="vuoto-inline">—</span>') + '</div></div>'
  }
  // 11.5: motivo / nota, data di richiamo, periodo e mese di inizio (solo se scritti). Senza ANAG_12 non ci sono.
  function datiStatoLettura(c) {
    var s = statoDi(c.stato_commessa), h = ''
    if (c.stato_nota) h += campoLettura(s && s.motivo ? 'Motivo' : 'Nota sullo stato', esc(c.stato_nota).replace(/\n/g, '<br>'))
    if (c.richiamo_il) {
      h += campoLettura('Richiamare il', '<span class="' + (richiamoPassato(c) ? 'richiamo-passato' : '') + '">📞 ' + esc(dataCorta(c.richiamo_il)) + '</span>' +
        (richiamoPassato(c) ? '<span class="dato-sotto">la data è arrivata: richiama il cliente</span>' : ''))
    }
    if (c.periodo_previsto) h += campoLettura('Periodo previsto', esc(c.periodo_previsto))
    if (c.mese_inizio_previsto) h += campoLettura('Mese di inizio', esc(meseParole(c.mese_inizio_previsto)))
    return h
  }
  function telLink(n) {
    var t = String(n || '').replace(/[^\d+]/g, '')
    return t ? '<a class="btn btn-secondario btn-piccolo" href="tel:' + esc(t) + '">' + ico('telefono') + '<span>Chiama</span></a>' : ''
  }

  function disegnaScheda(id) {
    var pane = el('pane-dettaglio')
    var c = perId(id)
    if (!c) { pane.innerHTML = AC.avviso('warn', 'Questa commessa non c\'è (o non è leggibile). <a href="#commesse">Torna all\'elenco</a>.'); return }
    var h = testataDettaglio(eInterno(c) ? nomeMostrato(c) : (c.numero_commessa || '—') + ' · ' + c.nome, badgeStato(c),
            eInterno(c) ? '' : '<button type="button" class="btn btn-primario" data-azione="modifica" data-id="' + esc(c.id) + '">' + ico('modifica') + '<span>Modifica</span></button>' +
              '<button type="button" class="btn btn-secondario" id="cm-stampa" data-azione="stampa">🖨️ <span>Stampa scheda commessa</span></button>')
    if (ST.messaggio) { h += AC.avviso(ST.messaggio.tipo, ST.messaggio.html); ST.messaggio = null }
    h += '<div id="cm-stampa-msg"></div>'

    // 11.5 (Umberto 10.11.2026): lo stato è uno solo. La colonna vecchia cantieri.stato (Attivo, In pausa, Completato)
    // non si mostra più: con ANAG_12 la calcola il database dallo stato della commessa.
    if (eInterno(c)) {
      h += '<div class="blocco">' +
        campoLettura('Tipo', 'Interno: ore e spese della ditta') +
        '</div>' +
        AC.avviso('info', 'Gli interni non hanno numero, stato commessa né cliente. Il nome non si cambia da qui.' +
          (c.codice_interno === 'ditta' && c.nome !== 'Lavori per la ditta' ? ' Nel database si chiama ancora «' + esc(c.nome) + '» (cambia con l\'SQL ANAG_F2_05).' : ''))
      h += htmlFine(c)
      pane.innerHTML = h
      return
    }

    var k = c.cliente_id ? contatto(c.cliente_id) : null
    var clienteHtml
    if (k) {
      clienteHtml = '<div class="cliente-scheda"><strong>' + esc(AC.nomeContatto(k)) + '</strong>' +
        (k.citta ? '<span class="dato-sotto">' + esc(k.citta) + '</span>' : '') +
        (k.attivo === false ? '<span class="badge st-senza">Archiviato in Rubrica</span>' : '') +
        '<div class="azioni-riga">' + telLink(k.cellulare || k.telefono) +
        (k.email ? '<a class="btn btn-secondario btn-piccolo" href="mailto:' + esc(k.email) + '">' + ico('email') + '<span>Email</span></a>' : '') +
        '</div></div>'
    } else if (c.cliente_id) {
      clienteHtml = AC.avviso('warn', 'Il cliente collegato non è leggibile dalla Rubrica.')
    } else if (c.committente) {
      clienteHtml = esc(c.committente) + '<span class="dato-sotto">scritto a mano, non collegato alla Rubrica: con «Modifica» puoi sceglierlo</span>'
    } else clienteHtml = ''

    var indirizzo = [c.via, [c.cap, c.citta].filter(Boolean).join(' '), c.paese && c.paese !== 'CH' ? AC.nomePaese(c.paese) || c.paese : ''].filter(Boolean).join(', ')
    h += '<div class="blocco">' +
      campoLettura('Numero commessa', esc(c.numero_commessa || '—')) +
      campoLettura('Stato commessa', c.stato_commessa ? htmlStato(c.stato_commessa) : '<span class="vuoto-inline">non ancora scelto</span>') +
      datiStatoLettura(c) +
      campoLettura('Cliente', clienteHtml) +
      campoLettura('Località', esc(c.luogo || '')) +
      campoLettura('Indirizzo', esc(indirizzo)) +
      campoLettura('Note', c.note ? esc(c.note).replace(/\n/g, '<br>') : '') +
      '</div>' +
      '<div class="blocco blocco-tenue">' +
      campoLettura('Creata il', esc(AC.data(c.created_at))) +
      '</div>'
    // Il posto del riquadro: resta vuoto finché il database non risponde. Titolare: tutto (vuoto senza CONT_104). Responsabile: solo IBAN e banca.
    if (eTitolare() || eResponsabile()) h += '<div id="cm-conto"></div>'
    h += '<div id="cm-foto-info"></div>'
    h += htmlFine(c)
    pane.innerHTML = h
    controllaFoto(c, function () { var x = el('cm-foto-info'); if (x) x.innerHTML = infoFoto(c) })
    CONTO.dati = null; CONTO.form = false
    caricaConto(c.id)
  }

  // ── Conto incassi (v11): il titolare sceglie, il responsabile vede IBAN e banca ──
  // Le funzioni sono della Contabilità (CONT_104). Qui si leggono e si chiamano, senza scrivere altro.
  var CONTO = { id: null, giro: 0, dati: null, form: false, messaggio: null, occupato: false }
  var PAROLE_TIPO = { principale: 'principale', uscite: 'uscite', cantiere: 'di cantiere' }

  function eTitolare() { return !!ST.utente && ST.utente.ruolo === 'titolare' }
  function eResponsabile() { return !!ST.utente && ST.utente.ruolo === 'responsabile' }
  // CONT_104 non c'è sul database: funzione (PGRST202, 42883) o tabella (PGRST205, 42P01) assente.
  function rubricaAssente(e) { return /^(PGRST202|PGRST205|42883|42P01)$/.test(String(e && e.codice || '')) }
  function testoErrore(e) { return (e && e.originale && e.originale.message) || (e && e.message) || String(e) }
  function ibanLeggibile(i) { return String(i || '').replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim() }
  function nomeCommessa(c) { return (c.numero_commessa ? c.numero_commessa + ' · ' : '') + nomeMostrato(c) }

  async function caricaConto(id) {
    if (eResponsabile()) return disegnaTastoIban(id)
    if (!eTitolare()) return
    var g = ++CONTO.giro, dati
    try {
      var at = await AD.rpc('tm_conta_conto_commessa', { p_cantiere: id })
      var r = await Promise.all([
        AD.leggi('tm_conta_rubrica_conti', 'id,nome,banca,valuta,tipo', function (q) { return q.eq('attivo', true).order('nome') }),
        AD.leggi('tm_conta_rubrica_assegnazioni', 'id,conto_id,dal,al,note,created_at,conto:tm_conta_rubrica_conti(nome,attivo)',
          function (q) { return q.eq('cantiere_id', id).order('dal', { ascending: false }).order('created_at', { ascending: false }) }),
        AD.leggi('tm_conta_rubrica_assegnazioni', 'conto_id,cantiere_id', function (q) { return q.is('al', null) })
      ])
      dati = { attuale: (at && at[0]) || null, conti: r[0], storico: r[1], aperte: r[2] }
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      if (g !== CONTO.giro) return
      var box = el('cm-conto')
      if (!box) return
      // Senza CONT_104, o se il database dice che non è titolare: niente riquadro e niente errore.
      if (rubricaAssente(e) || e.codice === '42501') { box.innerHTML = ''; return }
      box.innerHTML = '<div class="blocco" id="cm-conto-blocco">' + titoloConto() +
        AC.avviso('err', '<strong>Non riesco a leggere il conto incassi.</strong> ' + esc(testoErrore(e)) +
          '<div class="azioni-riga"><button type="button" class="btn btn-secondario btn-piccolo" data-azione="conto-riprova">Riprova</button></div>') + '</div>'
      return
    }
    if (g !== CONTO.giro) return
    CONTO.id = id; CONTO.dati = dati
    disegnaConto()
  }
  function titoloConto() { return '<h3 class="blocco-titolo"><span aria-hidden="true">🏦</span><span>Conto incassi</span></h3>' }

  // Responsabile (Umberto, 5.11 e 9.11): IBAN e banca del conto della commessa, solo dalla funzione tm_conta_iban_per_stampa.
  // La funzione non dà mai il nome del conto a chi non è titolare e scrive ogni lettura nel registro (lo legge il titolare).
  // 11.2 (Umberto, 9.11): aprire la scheda NON chiama la funzione; il registro segna solo «Mostra IBAN» e la stampa.
  // Niente nome, niente scelta, niente storico. Errore o conto mancante: sempre a parole, mai un riquadro vuoto.
  function disegnaTastoIban(id) {
    ++CONTO.giro
    CONTO.id = id
    var box = el('cm-conto')
    if (!box) return
    box.innerHTML = '<div class="blocco" id="cm-conto-blocco">' + titoloConto() +
      '<p class="nota" id="cm-conto-nota">L\'IBAN si vede solo quando lo chiedi: ogni lettura resta scritta nel registro.</p>' +
      '<div class="azioni-riga"><button type="button" class="btn btn-secondario" id="cm-conto-mostra" data-azione="conto-mostra"><span aria-hidden="true">👁️</span><span>Mostra IBAN</span></button></div></div>'
  }
  async function caricaContoResp(id) {
    var b = el('cm-conto-mostra')
    if (b) { if (b.disabled) return; b.disabled = true; b.lastChild.textContent = 'Leggo l\'IBAN…' }
    var g = ++CONTO.giro, ib = null, errore = null
    try { ib = await ibanPerStampa({ id: id }) }
    catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      errore = e
    }
    if (g !== CONTO.giro) return
    var box = el('cm-conto')
    if (!box) return
    CONTO.id = id
    var h = '<div class="blocco" id="cm-conto-blocco">' + titoloConto()
    if (errore) {
      h += AC.avviso('err', '<strong>Non riesco a leggere l\'IBAN.</strong> ' + esc(testoErrore(errore)) +
        '<div class="azioni-riga"><button type="button" class="btn btn-secondario btn-piccolo" data-azione="conto-riprova">Riprova</button></div>')
    } else if (ib.iban) {
      h += (ib.banca ? campoLettura('Banca', '<span id="cm-conto-banca">' + esc(ib.banca) + '</span>') : '') +
        campoLettura('IBAN', '<span class="cm-iban" id="cm-conto-iban">' + esc(ibanLeggibile(ib.iban)) + '</span>') +
        '<p class="nota" id="cm-conto-nota">Il conto lo sceglie il titolare. Ogni lettura dell\'IBAN resta scritta nel registro.</p>'
    } else {
      h += AC.avviso(ib.avviso ? 'warn' : 'info', ib.schermo)
    }
    box.innerHTML = h + '</div>'
  }

  function contoPrincipale() { return CONTO.dati.conti.filter(function (k) { return k.tipo === 'principale' })[0] || null }
  // Su quale altra commessa è adesso questo conto (solo i conti di cantiere si spostano da soli).
  function altraCommessa(idConto) {
    var a = CONTO.dati.aperte.filter(function (x) { return x.conto_id === idConto && x.cantiere_id !== CONTO.id })[0]
    return a ? (perId(a.cantiere_id) || { id: a.cantiere_id, nome: 'un\'altra commessa' }) : null
  }
  function voceConto(k) {
    var altra = k.tipo === 'cantiere' ? altraCommessa(k.id) : null
    var testo = [k.nome, k.banca, k.valuta].filter(Boolean).join(' · ') + ' (' + (PAROLE_TIPO[k.tipo] || k.tipo) + ')' + (altra ? ' — ora su ' + nomeCommessa(altra) : '')
    return '<option value="' + esc(k.id) + '">' + esc(testo) + '</option>'
  }

  function disegnaConto() {
    var box = el('cm-conto'), d = CONTO.dati
    if (!box || !d) return
    var a = d.attuale, h = '<div class="blocco" id="cm-conto-blocco">' + titoloConto()
    if (CONTO.messaggio) { h += AC.avviso(CONTO.messaggio.tipo, CONTO.messaggio.html); CONTO.messaggio = null }
    if (a) {
      h += campoLettura('Conto', esc(a.nome) + '<span class="dato-sotto" id="cm-conto-regola">' +
          (a.di_base ? 'di base: il principale' : 'scelto per questa commessa, dal ' + esc(AC.data(a.dal))) + '</span>') +
        (a.banca ? campoLettura('Banca', esc(a.banca)) : '') +
        campoLettura('IBAN', '<span class="cm-iban" id="cm-conto-iban">' + esc(ibanLeggibile(a.iban)) + '</span>') +
        campoLettura('Valuta', esc(a.valuta))
    } else {
      // Zero righe: non c'è un principale, o il database non dà la rubrica. Mai un riquadro vuoto che sembra a posto.
      h += AC.avviso('warn', '<strong>Nessun conto.</strong> Nella Rubrica dei conti (Contabilità) non c\'è un conto principale attivo: la stampa uscirà senza IBAN.')
    }
    h += CONTO.form ? htmlFormConto() :
      '<div class="azioni-riga"><button type="button" class="btn btn-secondario" id="cm-conto-cambia" data-azione="conto-cambia">' + ico('modifica') + '<span>Cambia conto</span></button></div>'
    h += '<h4 class="cm-storico-titolo">Storico</h4>' + htmlStorico() + '</div>'
    box.innerHTML = h
    if (CONTO.form) {
      el('cm-conto-scelta').addEventListener('change', aggiornaAvvisoConto)
      el('cm-conto-dal').addEventListener('change', aggiornaAvvisoConto)
      aggiornaAvvisoConto()
    }
    // Il riquadro aperto o chiuso è il nuovo punto di partenza per «modifiche non salvate».
    APP.rifirma()
  }

  function htmlStorico() {
    var righe = CONTO.dati.storico
    if (!righe.length) return '<p class="nota" id="cm-storico-vuoto">Nessun cambio finora: la commessa usa il conto principale.</p>'
    return '<ul class="cm-storico" id="cm-storico">' + righe.map(function (r) {
      var conto = r.conto || {}
      var periodo = 'dal ' + AC.data(r.dal) + (r.al ? ' al ' + AC.data(r.al) : ' · in corso' + (conto.attivo === false ? ' · conto spento: ora vale il principale' : ''))
      return '<li><strong>' + esc(conto.nome || 'Conto') + '</strong><span class="dato-sotto">' + esc(periodo) + '</span>' +
        (r.note ? '<span class="dato-sotto">' + esc(r.note) + '</span>' : '') + '</li>'
    }).join('') + '</ul><p class="nota">Fuori da questi periodi vale il conto principale.</p>'
  }

  function htmlFormConto() {
    var d = CONTO.dati, a = d.attuale, p = contoPrincipale()
    var altri = d.conti.filter(function (k) { return k.tipo !== 'principale' || (a && !a.di_base && a.conto_id === k.id) })
    var scelto = a && !a.di_base ? a.conto_id : ''
    var opz = '<option value="">Di base: il principale' + (p ? ' (' + esc(p.nome) + ')' : '') + '</option>' +
      altri.map(voceConto).join('').replace('value="' + esc(scelto) + '"', 'value="' + esc(scelto) + '" selected')
    return '<div class="cm-conto-form" id="cm-conto-form">' +
      campo('conto-scelta', 'Conto', '<select id="cm-conto-scelta">' + opz + '</select>') +
      campo('conto-dal', 'Dal giorno', '<input id="cm-conto-dal" type="date" value="' + esc(AC.oggiIso()) + '">') +
      '<div id="campo-conto-note-box">' + campo('conto-note', 'Nota (facoltativa)', input('conto-note', '', ' autocomplete="off" maxlength="200"')) + '</div>' +
      '<div id="cm-conto-avviso"></div>' +
      '<div class="azioni-riga">' +
        '<button type="button" class="btn btn-primario" id="cm-conto-salva" data-azione="conto-salva">' + ico('salva') + '<span>Salva il cambio</span></button>' +
        '<button type="button" class="btn btn-secondario" data-azione="conto-annulla">' + ico('chiudi') + '<span>Annulla</span></button>' +
      '</div></div>'
  }

  // Avvisi, non blocchi. Il database sposta un conto di cantiere dall'altra commessa senza chiedere: va detto prima.
  function aggiornaAvvisoConto() {
    var s = el('cm-conto-scelta'), box = el('cm-conto-avviso'), scelta = s.value, h = ''
    el('campo-conto-note-box').hidden = !scelta   // tornando al principale non si apre un periodo: la nota non andrebbe da nessuna parte
    var k = CONTO.dati.conti.filter(function (x) { return x.id === scelta })[0]
    var altra = k && k.tipo === 'cantiere' ? altraCommessa(k.id) : null
    if (altra) h += AC.avviso('warn', 'Questo conto ora è su <strong>' + esc(nomeCommessa(altra)) + '</strong>. Se salvi passa qui, e quella commessa torna al conto principale.')
    var dal = el('cm-conto-dal').value
    if (dal && dal > AC.oggiIso()) h += AC.avviso('warn', 'La data è nel futuro, ma il conto cambia già adesso: da subito le stampe useranno il conto nuovo.')
    box.innerHTML = h
  }

  async function salvaConto() {
    if (CONTO.occupato) return
    var id = CONTO.id, d = CONTO.dati, a = d.attuale, scelta = el('cm-conto-scelta').value || null, dal = el('cm-conto-dal').value
    var nota = scelta ? String(el('cm-conto-note').value || '').trim() : ''
    var box = el('cm-conto-avviso')
    if (!dal) { box.innerHTML = AC.avviso('err', 'Scrivi la data da cui vale il cambio.'); return }
    var periodoAperto = d.storico.some(function (r) { return !r.al })
    if ((scelta && a && !a.di_base && a.conto_id === scelta) || (!scelta && a && a.di_base && !periodoAperto)) {
      box.innerHTML = AC.avviso('info', 'È già questo conto: niente da cambiare.')
      return
    }
    CONTO.occupato = true
    var b = el('cm-conto-salva'); b.disabled = true
    try {
      await AD.rpc('tm_conta_assegna_conto', { p_cantiere: id, p_conto: scelta, p_dal: dal, p_note: nota || null })
    } catch (e) {
      CONTO.occupato = false
      if (e.sessioneAssente) return APP.sessioneScaduta()
      b.disabled = false
      box.innerHTML = AC.avviso('err', '<strong>NON salvato.</strong> ' + esc(testoErrore(e)))
      return
    }
    CONTO.occupato = false
    CONTO.form = false
    CONTO.messaggio = { tipo: 'ok', html: scelta ? 'Conto cambiato, dal ' + esc(AC.data(dal)) + '.' : 'La commessa è tornata al conto principale, dal ' + esc(AC.data(dal)) + '.' }
    await caricaConto(id)
    // Si rilegge e si controlla: una scrittura che non si ritrova non è una scrittura.
    var a2 = CONTO.dati && CONTO.dati.attuale
    if (CONTO.dati && (scelta ? (!a2 || a2.di_base || a2.conto_id !== scelta) : (a2 && !a2.di_base))) {
      CONTO.messaggio = { tipo: 'err', html: '<strong>Il cambio non risulta.</strong> Il database non mostra il conto scelto: controlla e riprova.' }
      disegnaConto()
    }
  }

  // ── Stampa scheda commessa (v11) ──────────────────────────────────────────
  // Una pagina, uguale per chi stampa tranne l'IBAN. Si rileggono i dati al momento: l'IBAN è quello di adesso, non di quando la scheda è stata aperta.
  // Dentro solo #stampa-commessa, fuori dal resto della pagina (css: @media print). Dopo la stampa il foglio si svuota: l'IBAN non resta nella pagina (primo tocco, o cambio di schermata).
  var titoloPrima = null
  function puliziaStampa() {
    var s = el('stampa-commessa'); if (s) s.innerHTML = ''
    document.body.classList.remove('stampa-attiva')
    if (titoloPrima !== null) { document.title = titoloPrima; titoloPrima = null }
  }
  var TESTO_IBAN = {
    assente: 'IBAN: non stampato, la Rubrica dei conti non è ancora attiva',
    manca: 'IBAN: manca il conto principale nella Rubrica dei conti',
    nonLetto: 'IBAN: non stampato, non è stato possibile leggerlo'
  }
  // Le stesse cose dette a schermo, nel riquadro del responsabile.
  var SCHERMO_IBAN = {
    assente: 'La Rubrica dei conti (Contabilità) non è ancora attiva: per ora niente IBAN, nemmeno sul foglio.',
    manca: '<strong>Nessun conto.</strong> Nella Rubrica dei conti (Contabilità) manca il conto principale: la stampa uscirà senza IBAN.'
  }
  // Titolare e responsabile stampano la scheda con l'IBAN (Umberto, 5.11.2026). La funzione del database scrive ogni lettura nel registro.
  // Torna IBAN e banca; il nome del conto non si usa (al responsabile la funzione non lo dà).
  async function ibanPerStampa(c) {
    try {
      var r = await AD.rpc('tm_conta_iban_per_stampa', { p_tipo: 'commessa', p_id: c.id })
      var riga = r && r[0]
      return riga && riga.iban ? { iban: riga.iban, banca: riga.banca || '' } : { testo: TESTO_IBAN.manca, schermo: SCHERMO_IBAN.manca, avviso: true }
    } catch (e) {
      if (e.sessioneAssente) throw e
      if (rubricaAssente(e)) return { testo: TESTO_IBAN.assente, schermo: SCHERMO_IBAN.assente }
      if (e.codice === 'P0002') return { testo: TESTO_IBAN.manca, schermo: SCHERMO_IBAN.manca, avviso: true }
      throw e
    }
  }
  function rigaFoglio(etichetta, valore) {
    return valore ? '<div class="sf-riga"><div class="sf-etichetta">' + esc(etichetta) + '</div><div class="sf-valore">' + esc(valore) + '</div></div>' : ''
  }
  function htmlFoglio(c, k, figure, ib) {
    var paese = c.paese && c.paese !== 'CH' ? AC.nomePaese(c.paese) || c.paese : ''
    var citta = [c.cap, c.citta].filter(Boolean).join(' ')
    var cittaK = k ? [k.cap, k.citta].filter(Boolean).join(' ') : ''
    var h = '<div class="sf-testa"><div class="sf-ditta">Carpenteria Ticinese Sagl</div><h1>Scheda commessa</h1></div>'
    h += '<div class="sf-gruppo">' +
      rigaFoglio('Numero commessa', c.numero_commessa) + rigaFoglio('Nome', nomeMostrato(c)) + rigaFoglio('Codice', c.codice_interno) +
      rigaFoglio('Tipo', eInterno(c) ? 'Interno' : 'Commessa') + rigaFoglio('Stato', c.stato_commessa ? parolaStato(c.stato_commessa) : 'non ancora scelto') +
      rigaFoglio('Periodo previsto', c.periodo_previsto || (c.mese_inizio_previsto ? meseParole(c.mese_inizio_previsto) : '')) + '</div>'
    h += '<h2>Cliente</h2><div class="sf-gruppo">' +
      rigaFoglio('Nome', k ? AC.nomeContatto(k) : c.committente || 'non indicato') +
      (k ? rigaFoglio('Referente', k.referente) + rigaFoglio('Indirizzo', [k.indirizzo, cittaK].filter(Boolean).join(', ')) +
           rigaFoglio('Telefono', [k.telefono, k.cellulare].filter(Boolean).join(' · ')) + rigaFoglio('Email', k.email)
         : rigaFoglio('Telefono', c.telefono_committente) + rigaFoglio('Email', c.email_committente)) + '</div>'
    h += '<h2>Cantiere</h2><div class="sf-gruppo">' +
      (rigaFoglio('Località', c.luogo) + rigaFoglio('Indirizzo', [c.via, citta, paese].filter(Boolean).join(', ')) || rigaFoglio('Indirizzo', 'non indicato')) + '</div>'
    if (figure === null) h += '<h2>Referenti</h2><div class="sf-gruppo"><p class="sf-nota">Elenco dei referenti non letto.</p></div>'
    else if (figure.length) {
      h += '<h2>Referenti</h2><div class="sf-gruppo">' + figure.map(function (f) {
        return rigaFoglio(f.ruolo || 'Referente', [[f.nome, f.cognome].filter(Boolean).join(' '), f.nome_impresa || f.azienda, f.nome_referente ? 'rif. ' + f.nome_referente : '', f.telefono, f.email].filter(Boolean).join(' · '))
      }).join('') + '</div>'
    }
    h += '<h2>Date</h2><div class="sf-gruppo">' + rigaFoglio('Creata il', AC.data(c.created_at)) + rigaFoglio('Stampata il', AC.data(AC.oggiIso())) + '</div>'
    h += ib.iban
      ? '<h2>Pagamenti</h2><div class="sf-gruppo">' + rigaFoglio('Banca', ib.banca) + '<div class="sf-riga"><div class="sf-etichetta">IBAN</div><div class="sf-valore sf-iban" id="sf-iban">' + esc(ibanLeggibile(ib.iban)) + '</div></div></div>'
      : '<h2>Pagamenti</h2><div class="sf-gruppo"><p class="sf-nota" id="sf-iban-testo">' + esc(ib.testo) + '</p></div>'
    return h
  }
  async function stampa(c, senzaIban) {
    var b = el('cm-stampa'), msg = el('cm-stampa-msg')
    if (!b || b.disabled) return
    b.disabled = true
    if (msg) msg.innerHTML = ''
    puliziaStampa()
    try {
      var righe = (await AD.leggiConRiserva('cantieri', ST.colCantieri + ',email_committente,telefono_committente', ST.colCantieri, function (q) { return q.eq('id', c.id) })).righe
      if (righe.length !== 1) throw new Error('Il database non mi dà questa commessa (' + righe.length + ' righe).')
      var fresca = righe[0], k = null, figure
      if (fresca.cliente_id) {
        k = (await AD.leggi('tm_contatti', 'id,ragione_sociale,nome,cognome,referente,indirizzo,cap,citta,telefono,cellulare,email', function (q) { return q.eq('id', fresca.cliente_id) }))[0] || contatto(fresca.cliente_id)
      }
      try { figure = await AD.leggi('cantiere_figure', 'ruolo,nome,cognome,telefono,email,azienda,nome_impresa,nome_referente', function (q) { return q.eq('cantiere_id', c.id).order('ruolo') }) }
      catch (eF) { if (eF.sessioneAssente) throw eF; figure = null }
      var ib = senzaIban ? { testo: TESTO_IBAN.nonLetto } : await ibanPerStampa(fresca)
      el('stampa-commessa').innerHTML = htmlFoglio(fresca, k, figure, ib)
      document.body.classList.add('stampa-attiva')
      titoloPrima = document.title
      document.title = 'Scheda commessa ' + (fresca.numero_commessa || fresca.nome || '')
      if (ib.avviso && msg) msg.innerHTML = AC.avviso('warn', 'Sul foglio non c\'è l\'IBAN: nella Rubrica dei conti (Contabilità) manca il conto principale.')
      b.disabled = false
      if (typeof window.print !== 'function') throw new Error('Questo telefono non sa stampare da qui: apri l\'app dal browser o da un computer.')
      window.print()
      // Sui telefoni print() torna subito e «afterprint» può arrivare prima che il foglio sia pronto: si svuota al primo tocco dopo la stampa.
      document.addEventListener('pointerdown', puliziaStampa, { once: true, capture: true })
    } catch (e) {
      b.disabled = false
      puliziaStampa()
      if (e.sessioneAssente) return APP.sessioneScaduta()
      if (msg) msg.innerHTML = AC.avviso('err', '<strong>Non ho stampato.</strong> ' + esc(testoErrore(e)) +
        '<div class="azioni-riga"><button type="button" class="btn btn-secondario btn-piccolo" data-azione="stampa">Riprova</button>' +
        (!senzaIban ? '<button type="button" class="btn btn-secondario btn-piccolo" data-azione="stampa-senza-iban">Stampa senza IBAN</button>' : '') + '</div>')
    }
  }

  // ── Archivia / Cancella (v7) ──────────────────────────────────────────────
  // Interni: riconosciuti da tipo e codice_interno, MAI dal nome. Senza la colonna codice_interno non si rischia.
  function internoProtetto(c) { return eInterno(c) && (c.codice_interno || ST.colCantieri !== COL_CANTIERI) }
  function archiviata(c) { var s = chiaveStato(c); return s === 'Lavoro finito' || s === 'Persa' }
  function htmlFine(c) {
    var tit = ST.utente && ST.utente.ruolo === 'titolare', az = '', h = ''
    if (!eInterno(c)) {
      if (archiviata(c)) h += '<p class="nota">' + ico('lucchetto') + '<span>Archiviata: stato «' + esc(parolaStato(c.stato_commessa)) + '». Per riaprirla: «Modifica» e cambia lo stato.</span></p>'
      else {
        h += '<p class="nota">Lavoro finito o non preso? Archivia: i dati restano tutti.</p>'
        az += '<button type="button" class="btn btn-primario" data-azione="archivia">' + ico('lucchetto') + '<span>Archivia</span></button>'
      }
    }
    if (tit) {
      if (internoProtetto(c)) h += '<p class="nota" id="cm-no-cancella">' + ico('lucchetto') + '<span>Interno di sistema: le app ci contano, non si cancella.</span></p>'
      else az += '<button type="button" class="btn btn-pericolo" data-azione="cancella">' + ico('togli') + '<span>Cancella</span></button>'
    }
    if (!az && !h) return ''
    return '<div class="blocco blocco-tenue" id="cm-fine"><h3 class="blocco-titolo">' + ico('lucchetto') + 'Archivia o cancella</h3>' + h +
      (az ? '<div class="azioni-riga">' + az + '</div>' : '') + '</div>'
  }
  // Scrive solo lo stato della commessa. Con ANAG_12 passa dalla funzione anag_commessa_cambia_stato (lo storico lo scrive
  // il database); senza, scrive la parola vecchia come prima. La colonna vecchia «stato» non si tocca.
  function apriArchivia(c) {
    var corpo = '<p>Archiviare non perde niente: sparisce dalle commesse aperte, i dati restano e si ritrova con i filtri «Lavori finiti» e «Perse».</p>' +
      (ST.stati12 ? '<div class="campo"><label for="cx-motivo">Motivo, se è persa <span class="sezione-nota">(facoltativo)</span></label>' +
        '<textarea id="cx-motivo" rows="2" maxlength="500" placeholder="es. prezzo troppo alto, ha scelto un\'altra ditta"></textarea></div>' : '') +
      '<div id="cx-archivia-msg"></div><div class="vela-azioni">' +
      CX.bottone('conclusa', '🏁 Lavoro finito', 'btn-primario', 'ok', 'cx-primo') +
      CX.bottone('persa', '❌ Persa: non l\'abbiamo presa', 'btn-primario', 'chiudi') +
      CX.bottone('chiudi', 'Annulla', 'btn-secondario', 'chiudi') + '</div>'
    function salva(stato) {
      return async function () {
        try {
          var m = el('cx-motivo')
          var s = await scriviStato(c, { stato: stato, nota: stato === 'Persa' && m ? m.value : null })
          ST.cantieri = ST.cantieri.map(function (x) { return x.id === s.id ? s : x })
          ST.messaggio = { tipo: 'ok', html: 'Archiviata: stato <strong>' + esc(parolaStato(stato)) + '</strong>. I dati restano tutti.' }
          await CX.chiudi()
          disegnaElenco(aperto); disegnaScheda(c.id)
        } catch (e) {
          if (e.sessioneAssente) return APP.sessioneScaduta()
          el('cx-archivia-msg').innerHTML = AC.avviso('err', '<strong>NON archiviata.</strong> ' + esc(spiega(e)))
        }
      }
    }
    CX.schermo('Archivia ' + (c.numero_commessa ? c.numero_commessa + ' · ' : '') + nomeMostrato(c), corpo, { conclusa: salva('Lavoro finito'), persa: salva('Persa') })
  }
  // Cambia lo stato (e con ANAG_12 anche nota, richiamo, periodo, mese) e torna la riga com'è ora nel database.
  // x = { stato, nota, richiamo, periodo, mese } con i nomi della lista (parole nuove).
  async function scriviStato(c, x) {
    if (!ST.stati12) {
      var vecchia = valoreDb(x.stato)
      if (!vecchia) throw new Error('lo stato «' + x.stato + '» arriva con l\'aggiornamento del database (ANAG_12), che non è ancora fatto.')
      return await AD.aggiorna('cantieri', c.id, { stato_commessa: vecchia }, ST.colCantieri)
    }
    var r = await AD.rpc('anag_commessa_cambia_stato', {
      p_cantiere: c.id, p_stato: x.stato, p_nota: vuotoNull(x.nota), p_richiamo: x.richiamo || null,
      p_periodo: vuotoNull(x.periodo), p_mese_inizio: x.mese || null
    })
    if (!r || r.ok !== true) throw new Error('il database non ha confermato il cambio di stato. Ricarica la pagina e controlla.')
    var righe = await AD.leggi('cantieri', ST.colCantieri, function (q) { return q.eq('id', c.id) })
    if (righe.length !== 1) throw new Error('stato cambiato, ma il database non mi ridà la commessa (' + righe.length + ' righe). Ricarica la pagina.')
    return righe[0]
  }
  function apriCancella(c) {
    if (internoProtetto(c)) return
    CX.cancella({
      tipo: 'commessa', id: c.id, nome: (c.numero_commessa ? c.numero_commessa + ' · ' : '') + nomeMostrato(c), elenco: '#commesse', utente: ST.utente,
      archivia: eInterno(c) || archiviata(c) ? null : function () { apriArchivia(c) },
      cosaArchivia: 'stato «Lavoro finito» o «Persa», i dati restano tutti',
      giaArchiviato: archiviata(c) ? 'È già archiviata: stato «' + parolaStato(c.stato_commessa) + '».' : null
    })
  }

  function testataDettaglio(titolo, badge, azioni) {
    return '<div class="testata-dettaglio">' +
      '<a class="btn btn-testo solo-telefono" href="#commesse">' + ico('indietro') + '<span>Indietro</span></a>' +
      '<div class="testata-dettaglio-riga"><h2 class="titolo-dettaglio">' + esc(titolo) + '</h2>' + (badge || '') + '</div>' +
      (azioni ? '<div class="azioni-testata">' + azioni + '</div>' : '') +
      '</div>'
  }

  // ── Foto: il nome si può cambiare? ────────────────────────────────────────
  async function controllaFoto(c, poi) {
    if (eInterno(c)) return
    var f = ST.foto[c.id]
    if (f && f.stato !== 'errore') { if (f.stato !== 'controllo') poi(); return }
    ST.foto[c.id] = { stato: 'controllo' }
    poi()
    try {
      var r = await Promise.all([
        AD.conta('foto', function (q) { return q.eq('cantiere_id', c.id) }),
        AD.conta('spese', function (q) { return q.eq('cantiere_id', c.id).not('foto_path', 'is', null) })
      ])
      var n = r[0] + r[1]
      ST.foto[c.id] = { stato: n > 0 ? 'si' : 'no', n: n }
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      ST.foto[c.id] = { stato: 'errore', msg: e.message }
    }
    poi()
  }
  function nomeBloccato(c) {
    if (!c) return false
    if (eInterno(c)) return true
    var f = ST.foto[c.id]
    return !f || f.stato !== 'no'   // in controllo, con foto, o controllo fallito: bloccato
  }
  function infoFoto(c) {
    var f = ST.foto[c.id] || {}
    if (f.stato === 'controllo') return '<p class="nota">' + ico('lucchetto') + 'Controllo se ci sono foto…</p>'
    if (f.stato === 'si') return AC.avviso('info', ico('lucchetto') + ' <strong>Il nome non si cambia</strong>: ' +
      (f.n === 1 ? 'c\'è già 1 foto salvata' : 'ci sono già ' + f.n + ' foto salvate') + ' con questo nome nell\'App Cantieri.')
    if (f.stato === 'errore') return AC.avviso('warn', ico('lucchetto') + ' <strong>Il nome resta bloccato</strong>: non sono riuscito a controllare le foto (' + esc(f.msg) + ').')
    return ''
  }

  // ── MODULO (nuova commessa / modifica / nuovo interno) ────────────────────
  function bozzaVuota(tipo) {
    return { id: null, tipo: tipo, nome: '', cliente_id: null, stato_commessa: tipo === 'interno' ? null : 'Offerta da fare',
             stato_nota: '', richiamo_il: '', periodo_previsto: '', mese_inizio_previsto: '',
             luogo: '', via: '', cap: '', citta: '', paese: AC.PAESE_PREDEFINITO, note: '', committente: null }
  }
  // Nel modulo lo stato è sempre la parola nuova (anche se nel database c'è ancora la vecchia). Sconosciuto: resta com'è.
  function bozzaDa(c) {
    return { id: c.id, tipo: c.tipo, nome: c.nome || '', cliente_id: c.cliente_id || null, stato_commessa: chiaveStato(c) || c.stato_commessa || null,
             stato_nota: c.stato_nota || '', richiamo_il: c.richiamo_il || '', periodo_previsto: c.periodo_previsto || '',
             mese_inizio_previsto: c.mese_inizio_previsto ? String(c.mese_inizio_previsto).slice(0, 7) : '',
             luogo: c.luogo || '', via: c.via || '', cap: c.cap || '', citta: c.citta || '', paese: c.paese || AC.PAESE_PREDEFINITO,
             note: c.note || '', committente: c.committente || null }
  }
  function salvaBozzaLocale() {
    try { if (ST.form && !ST.form.id) sessionStorage.setItem(BOZZA_KEY, JSON.stringify(ST.form)) } catch (_) { /* senza memoria si va avanti */ }
  }
  function leggiBozzaLocale() {
    try { var t = sessionStorage.getItem(BOZZA_KEY); return t ? JSON.parse(t) : null } catch (_) { return null }
  }
  function togliBozzaLocale() { try { sessionStorage.removeItem(BOZZA_KEY) } catch (_) {} }

  // Prende dal modulo a schermo i valori scritti finora (per non perderli ridisegnando)
  function leggiModulo() {
    var f = ST.form
    if (!f) return
    ;['nome', 'luogo', 'via', 'cap', 'citta', 'note'].forEach(function (k) { var x = el('cm-' + k); if (x && !x.readOnly) f[k] = x.value })
    var p = el('cm-paese'); if (p) f.paese = p.value
    var s = el('cm-stato'); if (s) f.stato_commessa = s.value || null
    ;[['stato-nota', 'stato_nota'], ['richiamo', 'richiamo_il'], ['periodo', 'periodo_previsto'], ['mese', 'mese_inizio_previsto']].forEach(function (p) {
      var x = el('cm-' + p[0]); if (x) f[p[1]] = x.value
    })
  }
  // «2027-03» (campo mese), «03.2027», «3/2027» → '2027-03-01'. Vuoto → null. Altro → false (errore sul campo).
  function meseDaModulo(t) {
    t = String(t || '').trim()
    if (!t) return null
    var m = t.match(/^(\d{4})-(\d{1,2})(-\d{1,2})?$/) || null
    if (m) return mese2(m[1], m[2])
    m = t.match(/^(\d{1,2})[.\/](\d{4})$/)
    return m ? mese2(m[2], m[1]) : false
    function mese2(a, b) { var n = Number(b); return n >= 1 && n <= 12 ? a + '-' + String(n).padStart(2, '0') + '-01' : false }
  }
  // Quali campi dello stato si vedono nel modulo, per lo stato scelto (e sempre se c'è già scritto qualcosa).
  function mostraCampiStato() {
    var sel = el('cm-stato'); if (!sel || !ST.stati12) return
    var s = statoDi(sel.value) || {}
    var vis = function (id, si) { var x = el('campo-' + id); if (x) x.hidden = !si }
    var pieno = function (id) { var x = el('cm-' + id); return !!(x && x.value) }
    vis('richiamo', !!s.richiamo)
    vis('periodo', !!s.periodo || pieno('periodo'))
    vis('mese', !!s.periodo || pieno('mese'))
    var lab = document.querySelector('label[for="cm-stato-nota"]')
    if (lab) lab.textContent = s.motivo ? 'Motivo' : 'Nota sullo stato'
    var aiuto = el('aiuto-stato-nota')
    if (aiuto) aiuto.textContent = s.v === 'Rimandata' ? 'Perché è rimandata (es. «aspetta il mutuo», «attesa licenza edilizia»).'
      : s.v === 'Persa' ? 'Perché non l\'abbiamo presa (es. «prezzo troppo alto»).' : 'Facoltativa (es. «attesa licenza edilizia»).'
  }

  function campo(id, etichetta, controllo, aiuto, obbligatorio) {
    return '<div class="campo" id="campo-' + id + '">' +
      '<label for="cm-' + id + '">' + esc(etichetta) + (obbligatorio ? ' <span class="obbl">obbligatorio</span>' : '') + '</label>' +
      controllo + (aiuto ? '<div class="campo-aiuto">' + aiuto + '</div>' : '') +
      '<div class="campo-errore" id="err-' + id + '" hidden></div></div>'
  }
  function input(id, valore, extra) {
    return '<input id="cm-' + id + '" type="text" value="' + esc(valore) + '"' + (extra || '') + '>'
  }

  function disegnaModulo() {
    var pane = el('pane-dettaglio')
    var f = ST.form
    var interno = f.tipo === 'interno'
    if (statoDi(f.stato_commessa)) f.stato_commessa = statoDi(f.stato_commessa).v   // bozza vecchia con «Da fare» → parola nuova
    var orig = f.id ? perId(f.id) : null
    var bloccato = orig ? nomeBloccato(orig) : false
    var titolo = interno ? 'Nuovo interno' : (f.id ? 'Modifica ' + (orig.numero_commessa || '') : 'Nuova commessa')

    var h = '<form id="cm-modulo" novalidate>' + testataDettaglio(titolo, '', '')
    if (f.ripresa) { h += AC.avviso('info', 'Ho ripreso la commessa che stavi scrivendo.'); f.ripresa = false }

    if (!f.id && !interno) {
      h += '<div class="blocco blocco-tenue"><div class="dato"><div class="dato-etichetta">Numero commessa</div>' +
           '<div class="dato-valore"><span class="vuoto-inline">arriva al salvataggio, lo dà il database</span></div></div></div>'
    }

    // Nome
    var aiutoNome = interno ? 'Ore e spese della ditta (es. «Officina», «Formazione»).' : 'Come la chiamate in ditta (es. «Rossi — tetto Camorino»).'
    var ctrlNome = input('nome', f.nome, ' autocomplete="off" maxlength="200"' + (bloccato ? ' readonly' : ''))
    h += '<div class="blocco">' + campo('nome', 'Nome', ctrlNome, bloccato ? '' : aiutoNome, !bloccato)
    if (orig && bloccato) h += '<div id="cm-foto-info">' + infoFoto(orig) + '</div>'

    if (interno) {
      h += AC.avviso('info', 'Un interno non ha numero, stato commessa né cliente. Nell\'App Cantieri sarà visibile da subito.') + '</div>'
    } else {
      // Stato commessa: le scelte vengono dalla lista unica, in ordine. Uno stato sconosciuto resta scelto, con ❔.
      var scelte = statiDaScegliere()
      var noto = scelte.some(function (s) { return s.v === f.stato_commessa })
      var opz = (f.stato_commessa ? '' : '<option value="" selected>— non ancora scelto —</option>') +
        (f.stato_commessa && !noto ? '<option value="' + esc(f.stato_commessa) + '" selected>' + esc(parolaStato(f.stato_commessa)) + '</option>' : '') +
        scelte.map(function (s) { return '<option value="' + esc(s.v) + '"' + (s.v === f.stato_commessa ? ' selected' : '') + '>' + esc(s.i + ' ' + s.v) + '</option>' }).join('')
      h += campo('stato', 'Stato commessa', '<select id="cm-stato">' + opz + '</select>',
        ST.stati12 ? 'Lo stato è uno solo: vale per tutte le app (Cantieri, Calendario).' : 'Lo stato è uno solo: vale per tutte le app. «Rimandata» e «Lavoro da iniziare» arrivano con l\'aggiornamento del database.')
      if (ST.stati12) {
        h += '<div class="stato-extra">' +
          '<div class="campo" id="campo-stato-nota"><label for="cm-stato-nota">Nota sullo stato</label>' +
            '<textarea id="cm-stato-nota" rows="2" maxlength="500">' + esc(f.stato_nota) + '</textarea>' +
            '<div class="campo-aiuto" id="aiuto-stato-nota"></div><div class="campo-errore" id="err-stato-nota" hidden></div></div>' +
          campo('richiamo', 'Richiamare il', '<input id="cm-richiamo" type="date" value="' + esc(f.richiamo_il) + '">', 'Il giorno in cui richiamare il cliente.') +
          campo('periodo', 'Periodo previsto', input('periodo', f.periodo_previsto, ' autocomplete="off" maxlength="200" placeholder="es. marzo 2027, dicembre o gennaio"'), 'A parole, come lo dice il cliente.') +
          campo('mese', 'Mese di inizio (per ordinare)', '<input id="cm-mese" type="month" value="' + esc(f.mese_inizio_previsto) + '" placeholder="2027-03">', 'Serve a mettere in fila i lavori da iniziare.') +
          '</div>'
      }
      h += '</div>'

      // Cliente
      h += '<div class="blocco"><h3 class="blocco-titolo">' + ico('cliente') + 'Cliente</h3><div id="cm-cliente">' + htmlCliente() + '</div></div>'

      // Dove
      h += '<div class="blocco"><h3 class="blocco-titolo">Dove</h3>' +
        campo('luogo', 'Località', input('luogo', f.luogo, ' autocomplete="off" maxlength="200"'), 'La parola corta che si vede negli elenchi (es. «Camorino»).') +
        campo('via', 'Via e numero', input('via', f.via, ' autocomplete="off" maxlength="200"')) +
        '<div class="campi-due">' +
          campo('cap', 'NPA', input('cap', f.cap, ' autocomplete="off" maxlength="10" inputmode="numeric" list="cm-cap-lista"') + '<datalist id="cm-cap-lista"></datalist>') +
          campo('citta', 'Città', input('citta', f.citta, ' autocomplete="off" maxlength="120" list="cm-loc-lista"') + '<datalist id="cm-loc-lista"></datalist>') +
        '</div><div id="cm-cap-aiuto" class="campo-aiuto"></div>' +
        campo('paese', 'Paese', '<select id="cm-paese">' + AC.opzioniPaese(f.paese) + '</select>') +
        '</div>'

      h += '<div class="blocco">' + campo('note', 'Note', '<textarea id="cm-note" rows="3" maxlength="2000">' + esc(f.note) + '</textarea>') + '</div>'
    }

    h += '<div id="cm-avvisi-salva"></div>' +
      '<div class="barra-salva">' +
        '<a class="btn btn-secondario" href="' + (f.id ? '#commessa/' + esc(f.id) : '#commesse') + '" data-azione="annulla" data-libera="1">' + ico('chiudi') + '<span>Annulla</span></a>' +
        '<button type="submit" class="btn btn-primario" id="cm-salva">' + ico('salva') + '<span>Salva</span></button>' +
      '</div></form>'
    pane.innerHTML = h

    el('cm-modulo').addEventListener('submit', function (ev) { ev.preventDefault(); salva() })
    if (el('cm-stato')) { el('cm-stato').addEventListener('change', mostraCampiStato); mostraCampiStato() }
    if (!interno) collegaCliente()
    if (!interno && window.CAP) CAP.collega('cm-cap', 'cm-citta', 'cm-cap-aiuto', 'cm-paese')
    if (orig && !eInterno(orig) && (!ST.foto[orig.id] || ST.foto[orig.id].stato === 'controllo')) {
      controllaFoto(orig, function () { if (ST.form && ST.form.id === orig.id && el('cm-modulo')) { leggiModulo(); disegnaModulo() } })
    }
    var primo = el('cm-nome'); if (primo && !primo.readOnly && !f.id) primo.focus()
  }

  // ── Cliente: scelto dalla Rubrica, oppure nuovo sul posto ─────────────────
  function htmlCliente() {
    var f = ST.form
    var k = f.cliente_id ? contatto(f.cliente_id) : null
    if (k) {
      return '<div class="cliente-scelto"><div><strong>' + esc(AC.nomeContatto(k)) + '</strong>' +
        (k.citta ? '<span class="dato-sotto">' + esc(k.citta) + '</span>' : '') + '</div>' +
        '<div class="azioni-riga"><button type="button" class="btn btn-secondario btn-piccolo" data-azione="cliente-cambia">' + ico('modifica') + '<span>Cambia</span></button>' +
        '<button type="button" class="btn btn-secondario btn-piccolo" data-azione="cliente-togli">' + ico('chiudi') + '<span>Togli</span></button></div></div>'
    }
    var vecchio = f.committente && !f.cliente_id
      ? '<p class="nota">Oggi c\'è scritto a mano: «' + esc(f.committente) + '». Scegli il contatto dalla Rubrica per collegarlo.</p>' : ''
    return vecchio +
      '<label class="cerca">' + ico('cerca') + '<span class="nascosto">Cerca il cliente</span>' +
      '<input id="cm-cliente-cerca" type="search" autocomplete="off" placeholder="Cerca nella Rubrica (nome, ditta, città)"></label>' +
      '<div id="cm-cliente-risultati" class="risultati"></div>' +
      '<button type="button" class="btn btn-secondario btn-largo" data-azione="nuovo-contatto">' + ico('piu') + '<span>Nuovo contatto</span></button>'
  }
  function collegaCliente() {
    var c = el('cm-cliente-cerca')
    if (!c) return
    c.addEventListener('input', function () { el('cm-cliente-risultati').innerHTML = risultatiCliente(c.value) })
  }
  function risultatiCliente(testo) {
    var t = AC.normale(testo)
    if (!t) return ''
    var parti = t.split(' ')
    var trovati = ST.contatti.filter(function (k) {
      var s = AC.normale(AC.nomeContatto(k) + ' ' + (k.nome || '') + ' ' + (k.cognome || '') + ' ' + (k.citta || ''))
      return parti.every(function (p) { return s.indexOf(p) >= 0 })
    }).sort(function (a, b) { return (a.attivo === false) - (b.attivo === false) || AC.nomeContatto(a).localeCompare(AC.nomeContatto(b), 'it') }).slice(0, 8)
    if (!trovati.length) return '<p class="nota">Nessun contatto con «' + esc(testo) + '». Usa «Nuovo contatto».</p>'
    return trovati.map(function (k) {
      return '<button type="button" class="riga riga-piccola" data-cliente="' + esc(k.id) + '"><span class="riga-testo"><span class="riga-nome">' +
        esc(AC.nomeContatto(k)) + '</span>' + (k.citta ? '<span class="riga-sotto">' + esc(k.citta) + '</span>' : '') + '</span>' +
        (k.attivo === false ? '<span class="badge st-senza">Archiviato</span>' : '') + '</button>'
    }).join('')
  }

  // ── NUOVO CONTATTO (sul posto, senza perdere la commessa) ─────────────────
  function disegnaNuovoContatto() {
    var pane = el('pane-dettaglio')
    var h = '<form id="ct-modulo" novalidate>' + testataDettaglio('Nuovo contatto', '', '') +
      AC.avviso('info', 'La commessa che stavi scrivendo resta lì: dopo il salvataggio ci torni con questo cliente già scelto.') +
      '<div class="blocco"><fieldset class="scelta"><legend>È una ditta o una persona?</legend>' +
        '<label class="scelta-voce"><input type="radio" name="ct-tipo" value="ditta" checked> <span>Ditta</span></label>' +
        '<label class="scelta-voce"><input type="radio" name="ct-tipo" value="persona"> <span>Persona</span></label></fieldset>' +
        '<div id="ct-ditta">' + campoCt('ragione', 'Nome della ditta', '', true) + '</div>' +
        '<div id="ct-persona" hidden><div class="campi-due">' + campoCt('nome', 'Nome', '', true) + campoCt('cognome', 'Cognome', '') + '</div></div>' +
      '</div>' +
      '<div class="blocco"><h3 class="blocco-titolo">Recapiti</h3>' +
        campoCt('telefono', 'Telefono', ' inputmode="tel"') + campoCt('email', 'Email', ' inputmode="email"') + '</div>' +
      '<div class="blocco"><h3 class="blocco-titolo">Indirizzo</h3>' + campoCt('indirizzo', 'Via e numero', '') +
        '<div class="campi-due">' + campoCt('cap', 'NPA', ' inputmode="numeric" maxlength="10" list="ct-cap-lista"') + campoCt('citta', 'Località', ' list="ct-citta-lista"') + '</div>' +
        '<datalist id="ct-cap-lista"></datalist><datalist id="ct-citta-lista"></datalist><div id="ct-cap-aiuto" class="campo-aiuto"></div>' +
        '<div class="campo"><label for="ct-paese">Paese</label><select id="ct-paese">' + AC.opzioniPaese(AC.PAESE_PREDEFINITO) + '</select></div></div>' +
      '<div id="ct-avvisi"></div>' +
      '<div class="barra-salva">' +
        '<button type="button" class="btn btn-secondario" data-azione="contatto-annulla">' + ico('chiudi') + '<span>Annulla</span></button>' +
        '<button type="submit" class="btn btn-primario">' + ico('salva') + '<span>Salva contatto</span></button>' +
      '</div></form>'
    pane.innerHTML = h
    pane.querySelectorAll('input[name="ct-tipo"]').forEach(function (r) {
      r.addEventListener('change', function () {
        var persona = pane.querySelector('input[name="ct-tipo"]:checked').value === 'persona'
        el('ct-ditta').hidden = persona; el('ct-persona').hidden = !persona
      })
    })
    el('ct-modulo').addEventListener('submit', function (ev) { ev.preventDefault(); salvaContatto() })
    if (window.CAP) CAP.collega('ct-cap', 'ct-citta', 'ct-cap-aiuto', 'ct-paese')
    el('ct-ragione').focus()
  }
  function campoCt(id, etichetta, extra, obbligatorio) {
    return '<div class="campo" id="campo-ct-' + id + '"><label for="ct-' + id + '">' + esc(etichetta) +
      (obbligatorio ? ' <span class="obbl">obbligatorio</span>' : '') + '</label>' +
      '<input id="ct-' + id + '" type="text" autocomplete="off"' + (extra || '') + '>' +
      '<div class="campo-errore" id="err-ct-' + id + '" hidden></div></div>'
  }

  var ctSalvaComunque = false
  async function salvaContatto() {
    var pane = el('pane-dettaglio')
    var persona = pane.querySelector('input[name="ct-tipo"]:checked').value === 'persona'
    var v = function (id) { var x = el('ct-' + id); return x ? x.value.trim() : '' }
    puliziaErrori(pane)
    var riga = {
      ragione_sociale: persona ? null : v('ragione') || null,
      nome: persona ? v('nome') || null : null,
      cognome: persona ? v('cognome') || null : null,
      telefono: v('telefono') || null, email: v('email') || null,
      indirizzo: v('indirizzo') || null, cap: v('cap') || null, citta: v('citta') || null,
      paese: el('ct-paese').value || AC.PAESE_PREDEFINITO,
      categoria: 'cliente', e_cliente: true, attivo: true
      // azienda_id non si manda: la mette il database (trigger anag_contatti_azienda, Fase 1)
    }
    if (!persona && !riga.ragione_sociale) return erroreCampo('ct-ragione', 'Scrivi il nome della ditta.')
    if (persona && !riga.nome) return erroreCampo('ct-nome', 'Scrivi il nome.')
    if (riga.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(riga.email)) return erroreCampo('ct-email', 'Questa email non sembra giusta.')

    // Omonimi: avviso, mai blocco (gli omonimi esistono)
    var nuovoNome = AC.normale(AC.nomeContatto(riga))
    var simile = ST.contatti.filter(function (k) { return AC.normale(AC.nomeContatto(k)) === nuovoNome })[0]
    if (simile && !ctSalvaComunque) {
      el('ct-avvisi').innerHTML = AC.avviso('warn', 'In Rubrica c\'è già <strong>' + esc(AC.nomeContatto(simile)) + '</strong>' +
        (simile.citta ? ' (' + esc(simile.citta) + ')' : '') + '. È lo stesso?' +
        '<div class="azioni-riga"><button type="button" class="btn btn-primario btn-piccolo" data-cliente-esistente="' + esc(simile.id) + '">Sì, usa quello</button>' +
        '<button type="button" class="btn btn-secondario btn-piccolo" data-azione="contatto-comunque">No, salva il nuovo</button></div>')
      return
    }
    var bottone = pane.querySelector('#ct-modulo button[type="submit"]')
    bottone.disabled = true
    try {
      var k = await AD.inserisci('tm_contatti', riga, COL_CONTATTI)
      ctSalvaComunque = false
      ST.contatti.push(k)
      ST.form.cliente_id = k.id
      ST.messaggioForm = { tipo: 'ok', html: 'Contatto <strong>' + esc(AC.nomeContatto(k)) + '</strong> salvato in Rubrica e scelto come cliente.' }
      salvaBozzaLocale()
      tornaAlModulo()
    } catch (e) {
      bottone.disabled = false
      if (e.sessioneAssente) return APP.sessioneScaduta()
      el('ct-avvisi').innerHTML = AC.avviso('err', 'Contatto NON salvato: ' + esc(e.message))
    }
  }
  function tornaAlModulo() {
    var f = ST.form
    APP.libera()
    location.hash = f && f.id ? '#commessa/' + f.id + '/modifica' : '#nuova-commessa'
  }

  // ── Errori sul campo ───────────────────────────────────────────────────────
  function puliziaErrori(radice) {
    radice.querySelectorAll('.campo-errore').forEach(function (x) { x.hidden = true; x.textContent = '' })
    radice.querySelectorAll('.campo-sbagliato').forEach(function (x) { x.classList.remove('campo-sbagliato') })
  }
  function erroreCampo(idControllo, testo) {
    var ctrl = el(idControllo)
    var errId = 'err-' + idControllo.replace(/^cm-/, '')
    var err = el(errId)
    if (ctrl) { ctrl.closest('.campo').classList.add('campo-sbagliato'); ctrl.setAttribute('aria-invalid', 'true') }
    if (err) { err.textContent = testo; err.hidden = false }
    if (ctrl) { ctrl.scrollIntoView({ behavior: 'smooth', block: 'center' }); ctrl.focus() }
    return false
  }

  // ── SALVA ──────────────────────────────────────────────────────────────────
  async function salva() {
    leggiModulo()
    var f = ST.form
    var pane = el('pane-dettaglio')
    puliziaErrori(pane)
    el('cm-avvisi-salva').innerHTML = ''
    var orig = f.id ? perId(f.id) : null
    var nome = String(f.nome || '').trim()
    if (!nome) return erroreCampo('cm-nome', f.tipo === 'interno' ? 'Scrivi il nome dell\'interno.' : 'Scrivi il nome della commessa.')

    // Avvisi non bloccanti: nome già usato, stessa cartella foto
    var cambiaNome = !orig || (nome !== orig.nome && !nomeBloccato(orig))
    if (cambiaNome && !ST.salvaComunque) {
      var altri = ST.cantieri.filter(function (c) { return !orig || c.id !== orig.id })
      var stesso = altri.filter(function (c) { return AC.normale(c.nome) === AC.normale(nome) })[0]
      var cartella = altri.filter(function (c) { return cartellaFoto(c.nome) === cartellaFoto(nome) })[0]
      var x = stesso || cartella
      if (x) {
        el('cm-avvisi-salva').innerHTML = AC.avviso('warn',
          (stesso ? 'C\'è già <strong>' + esc((x.numero_commessa ? x.numero_commessa + ' · ' : '') + x.nome) + '</strong> con lo stesso nome.'
                  : 'Il nome è quasi uguale a <strong>' + esc(x.nome) + '</strong>: nell\'App Cantieri le foto finirebbero nella stessa cartella.') +
          ' Vuoi salvare comunque?<div class="azioni-riga"><button type="button" class="btn btn-primario btn-piccolo" data-azione="salva-comunque">Sì, salva comunque</button></div>')
        el('cm-avvisi-salva').scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }

    // 11.5: i campi dello stato (con ANAG_12). Il mese si salva sempre al giorno 1.
    var statoX = null
    if (f.tipo !== 'interno') {
      var mese = ST.stati12 ? meseDaModulo(f.mese_inizio_previsto) : null
      if (mese === false) return erroreCampo('cm-mese', 'Scrivi il mese così: 03.2027 (mese e anno).')
      var sx = statoDi(f.stato_commessa)
      statoX = { stato: f.stato_commessa, nota: f.stato_nota, richiamo: sx && sx.richiamo ? f.richiamo_il || null : null, periodo: f.periodo_previsto, mese: mese }
      if (ST.stati12 && f.stato_commessa && !sx) return erroreCampo('cm-stato', 'Questo stato non c\'è più: scegline uno dall\'elenco.')
    }
    function statoCambiato(o) {
      if (!statoX || !statoX.stato) return false
      if (!ST.stati12) return statoX.stato !== (chiaveStato(o) || o.stato_commessa || null)
      return statoX.stato !== (chiaveStato(o) || o.stato_commessa || null) || (vuotoNull(statoX.nota) || null) !== (o.stato_nota || null) ||
        (statoX.richiamo || null) !== (o.richiamo_il || null) || (vuotoNull(statoX.periodo) || null) !== (o.periodo_previsto || null) ||
        (statoX.mese || null) !== (o.mese_inizio_previsto ? String(o.mese_inizio_previsto).slice(0, 10) : null)
    }

    var bottone = el('cm-salva')
    bottone.disabled = true
    var statoFatto = false
    try {
      var k = f.cliente_id ? contatto(f.cliente_id) : null
      var salvata
      if (!orig) {
        var riga = { nome: nome, tipo: f.tipo }
        if (f.tipo === 'interno') {
          riga.stato = 'Attivo'   // visibile nell'App Cantieri da subito
        } else if (ST.stati12) {
          // Con ANAG_12 la colonna vecchia «stato» la calcola il database dallo stato della commessa: non si manda.
          riga.stato_commessa = statoX.stato || 'Offerta da fare'
          riga.stato_nota = vuotoNull(statoX.nota); riga.richiamo_il = statoX.richiamo; riga.periodo_previsto = vuotoNull(statoX.periodo); riga.mese_inizio_previsto = statoX.mese
        } else {
          riga.stato = 'Completato'   // regola di passaggio (prima di ANAG_12): l'App Cantieri vecchia non la mostra fra i lavori
          riga.stato_commessa = valoreDb(statoX.stato) || 'Da fare'
        }
        if (f.tipo !== 'interno') {
          riga.cliente_id = f.cliente_id || null
          riga.committente = k ? AC.nomeContatto(k) : null
          riga.luogo = vuotoNull(f.luogo); riga.via = vuotoNull(f.via); riga.cap = vuotoNull(f.cap); riga.citta = vuotoNull(f.citta)
          riga.paese = f.paese || AC.PAESE_PREDEFINITO; riga.note = vuotoNull(f.note)
        }
        salvata = await AD.inserisci('cantieri', riga, ST.colCantieri)
        ST.cantieri.push(salvata)
        ST.foto[salvata.id] = { stato: 'no', n: 0 }
        ST.messaggio = salvata.tipo === 'interno'
          ? { tipo: 'ok', html: 'Interno <strong>' + esc(salvata.nome) + '</strong> creato.' }
          : { tipo: 'ok', html: '<span class="numero-grande">Commessa ' + esc(salvata.numero_commessa || '(numero non ricevuto)') + '</span> creata.' +
              (salvata.numero_commessa ? '' : ' Il database non ha restituito il numero: ricarica la pagina e controlla.') }
      } else {
        // Mai: stato (la colonna vecchia), tipo, numero_commessa. Lo stato della commessa: prima, e da solo (con ANAG_12
        // passa dalla funzione, che scrive anche lo storico); poi il resto. Se lo stato non va, non si salva niente.
        if (statoCambiato(orig)) {
          var dopoStato = await scriviStato(orig, statoX)
          statoFatto = true
          ST.cantieri = ST.cantieri.map(function (c) { return c.id === dopoStato.id ? dopoStato : c })
        }
        var campi = {
          cliente_id: f.cliente_id || null,
          luogo: vuotoNull(f.luogo), via: vuotoNull(f.via), cap: vuotoNull(f.cap), citta: vuotoNull(f.citta),
          paese: f.paese || AC.PAESE_PREDEFINITO, note: vuotoNull(f.note)
        }
        if (k && f.cliente_id !== orig.cliente_id) campi.committente = AC.nomeContatto(k)
        if (nome !== orig.nome) {
          if (nomeBloccato(orig)) throw new Error('il nome è bloccato (foto già salvate con questo nome)')
          campi.nome = nome
        }
        salvata = await AD.aggiorna('cantieri', orig.id, campi, ST.colCantieri)
        ST.cantieri = ST.cantieri.map(function (c) { return c.id === salvata.id ? salvata : c })
        ST.messaggio = { tipo: 'ok', html: 'Modifiche salvate.' }
      }
      ST.form = null; ST.salvaComunque = false
      togliBozzaLocale()
      APP.libera()
      location.hash = '#commessa/' + salvata.id
    } catch (e) {
      bottone.disabled = false
      if (e.sessioneAssente) return APP.sessioneScaduta()
      el('cm-avvisi-salva').innerHTML = AC.avviso('err', statoFatto
        ? '<strong>Stato salvato, il resto NON salvato.</strong> ' + esc(spiega(e)) + ' Premi di nuovo «Salva».'
        : '<strong>NON salvato.</strong> ' + esc(spiega(e)))
      el('cm-avvisi-salva').scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
  function vuotoNull(s) { s = String(s == null ? '' : s).trim(); return s || null }
  function spiega(e) {
    var m = String(e && e.message || e).replace(/^anag_commessa_cambia_stato: /, '')
    if (/solo il titolare e il responsabile/i.test(m)) return m
    if (/anag_cantieri_numero_uq|duplicate key/i.test(m)) return 'Questo numero commessa esiste già. Ricarica la pagina e riprova.'
    if (/row-level security|violates row-level|permission denied/i.test(m)) return 'il database non ti dà il permesso. Esci, rientra e riprova; se resta così, chiedi al titolare.'
    if (/check constraint/i.test(m)) return 'un valore non è accettato dal database (' + m + ').'
    return m
  }

  // ── Clic (un solo ascoltatore per tutta la sezione) ───────────────────────
  function clic(ev) {
    var t = ev.target.closest('[data-apri],[data-filtro],[data-azione],[data-cliente],[data-cliente-esistente]')
    if (!t) return
    if (t.dataset.apri) { location.hash = '#commessa/' + t.dataset.apri; return }
    if (t.dataset.filtro) { ST.filtro = t.dataset.filtro; disegnaElenco(idAperto()); return }
    if (t.dataset.cliente) {
      leggiModulo(); ST.form.cliente_id = t.dataset.cliente; salvaBozzaLocale()
      el('cm-cliente').innerHTML = htmlCliente(); collegaCliente(); return
    }
    if (t.dataset.clienteEsistente) {
      ST.form.cliente_id = t.dataset.clienteEsistente; ST.messaggioForm = { tipo: 'ok', html: 'Scelto il contatto che c\'era già in Rubrica.' }
      salvaBozzaLocale(); tornaAlModulo(); return
    }
    var a = t.dataset.azione
    if (a === 'nuova') { location.hash = '#nuova-commessa'; return }
    if (a === 'archivia') { var ca = perId(aperto); if (ca) apriArchivia(ca); return }
    if (a === 'cancella') { var cc = perId(aperto); if (cc) apriCancella(cc); return }
    if (a === 'stampa' || a === 'stampa-senza-iban') { var cs = perId(aperto); if (cs) stampa(cs, a === 'stampa-senza-iban'); return }
    // Cambiare il conto: solo il titolare (il database lo rifiuta comunque agli altri).
    if (a === 'conto-cambia') { if (eTitolare()) { CONTO.form = true; disegnaConto() } return }
    if (a === 'conto-annulla') { if (eTitolare()) { CONTO.form = false; disegnaConto() } return }
    if (a === 'conto-salva') { if (eTitolare()) salvaConto(); return }
    // Responsabile: «Mostra IBAN» e il suo Riprova sono le sole letture dal riquadro (una riga nel registro ciascuna).
    if (a === 'conto-mostra') { if (aperto && eResponsabile()) caricaContoResp(aperto); return }
    if (a === 'conto-riprova') { if (aperto) { if (eResponsabile()) caricaContoResp(aperto); else caricaConto(aperto) } return }
    if (a === 'nuovo-interno') { location.hash = '#nuovo-interno'; return }
    if (a === 'modifica') { location.hash = '#commessa/' + t.dataset.id + '/modifica'; return }
    if (a === 'cliente-cambia' || a === 'cliente-togli') {
      leggiModulo(); ST.form.cliente_id = null; salvaBozzaLocale()
      el('cm-cliente').innerHTML = htmlCliente(); collegaCliente()
      if (a === 'cliente-cambia') el('cm-cliente-cerca').focus()
      return
    }
    if (a === 'nuovo-contatto') { leggiModulo(); salvaBozzaLocale(); APP.libera(); location.hash = '#nuovo-contatto'; return }
    if (a === 'contatto-annulla') { tornaAlModulo(); return }
    if (a === 'contatto-comunque') { ctSalvaComunque = true; salvaContatto(); return }
    if (a === 'salva-comunque') { ST.salvaComunque = true; salva(); return }
    if (a === 'annulla') { ST.form = null; ST.salvaComunque = false; togliBozzaLocale() /* il link fa il resto */ }
  }
  var aperto = null
  function idAperto() { return aperto }

  // ── Ingresso dalla navigazione (app.js) ───────────────────────────────────
  // parti: ['commesse'] | ['commessa', id] | ['commessa', id, 'modifica'] | ['nuova-commessa'] | ['nuovo-interno'] | ['nuovo-contatto']
  async function mostra(parti, utente) {
    ST.utente = utente
    puliziaStampa()
    await carica()
    var v = parti[0], id = parti[1] || null
    aperto = v === 'commessa' ? id : null
    var conDettaglio = v !== 'commesse'
    document.body.classList.toggle('con-dettaglio', conDettaglio)
    disegnaElenco(aperto)

    if (v === 'commessa' && parti[2] === 'modifica') {
      var c = perId(id)
      if (!c || eInterno(c)) { location.hash = '#commessa/' + id; return }
      if (!ST.form || ST.form.id !== id) ST.form = bozzaDa(c)
      ST.salvaComunque = false
      disegnaModulo(); mostraMessaggioForm(); return
    }
    if (v === 'commessa') { ST.form = null; disegnaScheda(id); return }
    if (v === 'nuova-commessa' || v === 'nuovo-interno') {
      var tipo = v === 'nuovo-interno' ? 'interno' : 'commessa'
      if (!ST.form || ST.form.id || ST.form.tipo !== tipo) {
        var b = tipo === 'commessa' ? leggiBozzaLocale() : null
        ST.form = b && !b.id ? Object.assign(bozzaVuota('commessa'), b, { ripresa: true }) : bozzaVuota(tipo)
      }
      ST.salvaComunque = false
      disegnaModulo(); mostraMessaggioForm(); return
    }
    if (v === 'nuovo-contatto') {
      if (!ST.form) { var b2 = leggiBozzaLocale(); ST.form = b2 && !b2.id ? Object.assign(bozzaVuota('commessa'), b2) : null }
      if (!ST.form) { location.hash = '#nuova-commessa'; return }
      ctSalvaComunque = false
      disegnaNuovoContatto(); return
    }
    // elenco: a destra (schermo largo) un invito
    el('pane-dettaglio').innerHTML = '<div class="vuoto vuoto-grande">' + ico('commesse') + '<p>Scegli una commessa dall\'elenco,<br>oppure crea una «Nuova commessa».</p></div>'
  }
  function mostraMessaggioForm() {
    if (!ST.messaggioForm) return
    var x = el('cm-avvisi-salva')
    if (x) x.innerHTML = AC.avviso(ST.messaggioForm.tipo, ST.messaggioForm.html)
    ST.messaggioForm = null
  }

  function avvia() {
    el('pane-elenco').addEventListener('click', clic)
    el('pane-dettaglio').addEventListener('click', clic)
  }

  return { mostra: mostra, avvia: avvia, svuota: svuota, scarta: scarta, ricarica: function () { ST.caricato = false } }
})()
