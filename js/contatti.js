/* ═══════════════════════════════════════════════════════════════════════════
   Anagrafiche — CONTATTI (tabella tm_contatti, la rubrica di tutte le app)

   Regole (FASE2_DISEGNO.md §5 + decisioni del 2.11.2026):
   - «È un fornitore?» in UN solo modo: il tasto «Fornitore» = e_fornitore
     (SQL ANAG_F2_04 tiene allineati anche categoria e categorie per le app vecchie).
   - Archiviati (attivo = false): non negli elenchi; compaiono nella ricerca e nel
     filtro «Archiviati», con la scritta e «Rimetti fra gli attivi».
   - Niente si cancella, tranne: «Elimina» solo per il titolare, e il database
     rifiuta se il contatto è collegato (commessa, Esterno, Pre-contabilità, Radar):
     allora si propone «Archivia».
   - Omonimi: avviso, mai blocco. CAP ↔ località: aiuto, mai blocco.
   - Categorie multiple (rubrica_categorie) come nella Rubrica. Foto: si vedono qui
     (link firmato); caricarle/cambiarle per ora nella Rubrica (riserva/).
   - azienda_id non si manda: la mette il database (trigger anag_contatti_azienda).
   ═══════════════════════════════════════════════════════════════════════════ */
var KT = (function () {
  'use strict'
  var esc = AC.esc, ico = AC.ico, el = AC.el

  var COL = 'id,categoria,categorie,ragione_sociale,nome,cognome,referente,indirizzo,cap,citta,paese,telefono,cellulare,email,sito_web,' +
            'uid_partita_iva,iban,giorni_pagamento,gruppo_default,note,attivo,e_cliente,e_fornitore,foto_url,created_at'
  var CAT_CLIENTE = ['preventivi', 'appalti_presi', 'appalti_conclusi']
  var PREFISSI = { CH: '41', IT: '39', DE: '49', FR: '33', AT: '43', LI: '423' }

  var ST = {
    contatti: [], categorie: null, catErrore: null, gruppi: null, gruppiErrore: null, cantieri: [], operai: [],
    caricato: false, cerca: '', filtro: 'tutti', form: null, messaggio: null, utente: null, foto: {}
  }

  async function carica(forza) {
    if (ST.caricato && !forza) return
    var r = await Promise.all([
      AD.leggi('tm_contatti', COL),
      AD.leggi('cantieri', 'id,nome,numero_commessa,cliente_id,tipo'),
      AD.leggiConRiserva('operai', 'id,nome,cognome,ditta_id,rapporto', 'id,nome,cognome')
    ])
    if (!r[0].length) throw new Error('Il database non mi dà i contatti (0 righe). L\'elenco NON è attendibile: esci, rientra e riprova.')
    ST.contatti = r[0]; ST.cantieri = r[1]; ST.operai = r[2].righe
    try {
      ST.categorie = (await AD.leggi('rubrica_categorie', 'id,nome,ordine,attiva')).sort(function (a, b) { return (a.ordine || 0) - (b.ordine || 0) })
      ST.catErrore = null
    } catch (e) { if (e.sessioneAssente) throw e; ST.categorie = null; ST.catErrore = e.message }
    // Gruppi per il «Gruppo predefinito» (Pre-contabilità): stessa fonte della Pre-contabilità, tm_conta_gruppi.
    // Se non si leggono, il campo non si offre e il gruppo di ogni contatto resta com'è (mai un gruppo cancellato per sbaglio).
    try {
      var g = await AD.leggiConRiserva('tm_conta_gruppi', 'codice,nome,ordine,attivo,tipo,azienda_id', 'codice,nome,ordine,attivo')
      ST.gruppi = g.righe.sort(function (a, b) { return (a.ordine || 0) - (b.ordine || 0) })
      ST.gruppiErrore = ST.gruppi.length ? null : 'Il database non mi dà nessun gruppo (0 righe).'
      if (!ST.gruppi.length) ST.gruppi = null
    } catch (e) { if (e.sessioneAssente) throw e; ST.gruppi = null; ST.gruppiErrore = e.message }
    ST.caricato = true
  }
  function svuota() { ST.contatti = []; ST.cantieri = []; ST.operai = []; ST.categorie = null; ST.gruppi = null; ST.gruppiErrore = null; ST.caricato = false; ST.form = null; ST.foto = {} }
  function perId(id) { return ST.contatti.filter(function (k) { return k.id === id })[0] || null }
  function nome(k) { return AC.nomeContatto(k) }
  function eCliente(k) { return k.e_cliente === true || k.categoria === 'cliente' || (Array.isArray(k.categorie) && k.categorie.some(function (c) { return CAT_CLIENTE.indexOf(c) >= 0 })) }
  function nomeCat(id) { var c = (ST.categorie || []).filter(function (x) { return x.id === id })[0]; return c ? c.nome : id }
  // «MAT · Materiali»; un codice che non si legge (gruppo di un'altra azienda o elenco non leggibile) si mostra com'è.
  function etichettaGruppo(cod) {
    var g = (ST.gruppi || []).filter(function (x) { return x.codice === cod })[0]
    return g ? g.codice + ' · ' + g.nome + (g.attivo === false ? ' (disattivato)' : '') : cod
  }
  function opzioniGruppo(scelto) {
    var h = '<option value="">— nessun gruppo —</option>', trovato = false
    ;(ST.gruppi || []).forEach(function (g) {
      var gia = g.codice === scelto
      if (gia) trovato = true
      if (g.attivo === false && !gia) return                 // un gruppo disattivato non si sceglie più, ma quello già scritto resta
      h += '<option value="' + esc(g.codice) + '"' + (gia ? ' selected' : '') + '>' + esc(g.codice + ' · ' + g.nome) + (g.attivo === false ? ' (disattivato)' : '') + '</option>'
    })
    if (scelto && !trovato) h += '<option value="' + esc(scelto) + '" selected>' + esc(scelto) + ' (gruppo non leggibile da qui)</option>'
    return h
  }
  function collegamenti(k) {
    return {
      commesse: ST.cantieri.filter(function (c) { return c.cliente_id === k.id }),
      esterni: ST.operai.filter(function (o) { return o.ditta_id === k.id })
    }
  }

  // ── Link per le azioni rapide ─────────────────────────────────────────────
  function cifre(n) { return String(n || '').replace(/[^\d+]/g, '') }
  function whatsapp(numero, paese) {
    var s = String(numero || '').trim().replace(/\(0\)/g, ''), c = s.replace(/[^0-9]/g, '')
    if (!c) return ''
    if (s.charAt(0) === '+') return 'https://wa.me/' + c
    if (c.indexOf('00') === 0) return 'https://wa.me/' + c.slice(2)
    var p = PREFISSI[String(paese || 'CH').toUpperCase()]
    if (!p) return ''
    return 'https://wa.me/' + p + (p === '39' ? c : c.replace(/^0/, ''))
  }
  function mappa(k) {
    var q = [k.indirizzo, [k.cap, k.citta].filter(Boolean).join(' '), AC.nomePaese(k.paese)].filter(Boolean).join(', ')
    return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : ''
  }
  function sito(u) { u = String(u || '').trim(); if (!u) return ''; return /^https?:\/\//i.test(u) ? u : 'https://' + u }

  // ── ELENCO ─────────────────────────────────────────────────────────────────
  var FILTRI = [{ k: 'tutti', n: 'Tutti' }, { k: 'fornitori', n: 'Fornitori' }, { k: 'clienti', n: 'Clienti' }, { k: 'archiviati', n: 'Archiviati' }]
  function passa(k) {
    var f = ST.filtro
    if (f === 'archiviati') return k.attivo === false
    if (k.attivo === false && !ST.cerca) return false     // gli archiviati solo cercando
    if (f === 'fornitori') return AC.eFornitore(k)
    if (f === 'clienti') return eCliente(k)
    if (f.indexOf('cat:') === 0) return Array.isArray(k.categorie) && k.categorie.indexOf(f.slice(4)) >= 0
    return true
  }
  function trovato(k) {
    if (!ST.cerca) return true
    var t = AC.normale([nome(k), k.nome, k.cognome, k.referente, k.citta, k.telefono, k.cellulare, k.email].join(' '))
    return AC.normale(ST.cerca).split(' ').every(function (p) { return t.indexOf(p) >= 0 })
  }
  function badges(k) {
    var h = ''
    if (k.attivo === false) h += '<span class="badge st-senza">Archiviato</span>'
    if (AC.eFornitore(k)) h += '<span class="badge st-fornitore">' + ico('ditta') + ' Fornitore</span>'
    if (eCliente(k)) h += '<span class="badge st-cliente">' + ico('cliente') + ' Cliente</span>'
    return h
  }
  function riga(k, scelto) {
    var sotto = [k.referente, k.citta, k.cellulare || k.telefono].filter(Boolean).join(' · ')
    return '<div class="riga-contatto' + (scelto ? ' riga-scelta' : '') + '">' +
      '<button type="button" class="riga" data-apri-contatto="' + esc(k.id) + '"><span class="riga-testo"><span class="riga-nome">' + esc(nome(k)) + '</span>' +
      (sotto ? '<span class="riga-sotto">' + esc(sotto) + '</span>' : '') + '<span class="riga-badge">' + badges(k) + '</span></span></button>' +
      ((k.cellulare || k.telefono) ? '<a class="btn btn-secondario btn-chiama" href="tel:' + esc(cifre(k.cellulare || k.telefono)) + '" aria-label="Chiama ' + esc(nome(k)) + '">' + ico('telefono') + '<span>Chiama</span></a>' : '') +
      '</div>'
  }
  function disegnaElenco(idScelto) {
    var lista = ST.contatti.filter(function (k) { return passa(k) && trovato(k) })
      .sort(function (a, b) { return nome(a).localeCompare(nome(b), 'it', { sensitivity: 'base' }) })
    var h = '<div class="barra-elenco"><label class="cerca">' + ico('cerca') + '<span class="nascosto">Cerca</span>' +
      '<input id="kt-cerca" type="search" autocomplete="off" placeholder="Cerca nome, città, telefono" value="' + esc(ST.cerca) + '"></label>' +
      '<button type="button" class="btn btn-primario" data-kt-azione="nuovo">' + ico('piu') + '<span>Nuovo contatto</span></button></div>'
    var cats = (ST.categorie || []).filter(function (c) { return c.attiva !== false })
    h += '<div class="filtri" role="group" aria-label="Filtra">' + FILTRI.concat(cats.map(function (c) { return { k: 'cat:' + c.id, n: c.nome } })).map(function (f) {
      return '<button type="button" class="filtro' + (ST.filtro === f.k ? ' filtro-attivo' : '') + '" data-kt-filtro="' + esc(f.k) + '" aria-pressed="' + (ST.filtro === f.k) + '">' + esc(f.n) + '</button>'
    }).join('') + '</div>'
    if (ST.catErrore) h += AC.avviso('warn', 'Categorie non leggibili: ' + esc(ST.catErrore))
    h += '<p class="nota">' + lista.length + ' contatti' + (ST.cerca ? ' trovati' : '') + (ST.filtro !== 'archiviati' && !ST.cerca ? ' (gli archiviati si trovano cercando)' : '') + '</p>'
    var lettera = '', righe = ''
    lista.forEach(function (k) {
      var l = AC.normale(nome(k)).charAt(0).toUpperCase() || '#'
      if (!/[A-Z]/.test(l)) l = '#'
      if (l !== lettera) { lettera = l; righe += '<div class="lettera">' + esc(l) + '</div>' }
      righe += riga(k, k.id === idScelto)
    })
    h += '<div class="elenco" aria-live="polite">' + (righe || '<div class="vuoto">' + (ST.cerca ? 'Nessun contatto per «' + esc(ST.cerca) + '».' : 'Nessun contatto in questo filtro.') + '</div>') + '</div>'
    el('pane-elenco').innerHTML = h
    var c = el('kt-cerca')
    c.addEventListener('input', function () {
      ST.cerca = c.value; var pos = c.selectionStart
      disegnaElenco(idScelto)
      var c2 = el('kt-cerca'); c2.focus(); try { c2.setSelectionRange(pos, pos) } catch (_) {}
    })
  }

  // ── SCHEDA ─────────────────────────────────────────────────────────────────
  function dato(et, v) { return '<div class="dato"><div class="dato-etichetta">' + esc(et) + '</div><div class="dato-valore">' + (v || '<span class="vuoto-inline">—</span>') + '</div></div>' }
  function testata(titolo, badge, azioni, indietro) {
    return '<div class="testata-dettaglio"><a class="btn btn-testo solo-telefono" href="' + esc(indietro || '#contatti') + '">' + ico('indietro') + '<span>Indietro</span></a>' +
      '<div class="testata-dettaglio-riga"><h2 class="titolo-dettaglio">' + esc(titolo) + '</h2>' + (badge || '') + '</div>' +
      (azioni ? '<div class="azioni-testata">' + azioni + '</div>' : '') + '</div>'
  }
  function bottoneLink(href, icona, scritta, esterno) {
    return href ? '<a class="btn btn-secondario" href="' + esc(href) + '"' + (esterno ? ' target="_blank" rel="noopener"' : '') + '>' + ico(icona) + '<span>' + esc(scritta) + '</span></a>' : ''
  }
  function disegnaScheda(id) {
    var k = perId(id), pane = el('pane-dettaglio')
    if (!k) { pane.innerHTML = AC.avviso('warn', 'Questo contatto non c\'è (o non è leggibile). <a href="#contatti">Torna all\'elenco</a>.'); return }
    var h = testata(nome(k), badges(k), '<a class="btn btn-primario" href="#contatto/' + esc(k.id) + '/modifica">' + ico('modifica') + '<span>Modifica</span></a>')
    if (ST.messaggio) { h += AC.avviso(ST.messaggio.tipo, ST.messaggio.html); ST.messaggio = null }
    if (k.attivo === false) h += AC.avviso('warn', '<strong>Archiviato.</strong> Non compare negli elenchi delle app.<div class="azioni-riga"><button type="button" class="btn btn-primario btn-piccolo" data-kt-azione="riattiva">Rimetti fra gli attivi</button></div>')
    h += '<div id="kt-foto"></div>'
    h += '<div class="azioni-contatto">' +
      bottoneLink(k.cellulare ? 'tel:' + cifre(k.cellulare) : '', 'telefono', 'Cellulare') +
      bottoneLink(k.telefono ? 'tel:' + cifre(k.telefono) : '', 'telefono', 'Chiama') +
      bottoneLink(whatsapp(k.cellulare, k.paese), 'email', 'WhatsApp', true) +
      bottoneLink(k.email ? 'mailto:' + k.email : '', 'email', 'Email') +
      bottoneLink(mappa(k), 'apri', 'Mappa', true) +
      bottoneLink(sito(k.sito_web), 'apri', 'Sito', true) + '</div>'
    var ind = [k.indirizzo, [k.cap, k.citta].filter(Boolean).join(' '), k.paese && k.paese !== 'CH' ? AC.nomePaese(k.paese) || k.paese : ''].filter(Boolean).join(', ')
    h += '<div class="blocco">' +
      (k.ragione_sociale && (k.nome || k.cognome) ? dato('Persona', esc([k.nome, k.cognome].filter(Boolean).join(' '))) : '') +
      dato('Referente', esc(k.referente || '')) + dato('Cellulare', esc(k.cellulare || '')) + dato('Telefono', esc(k.telefono || '')) +
      dato('Email', esc(k.email || '')) + dato('Indirizzo', esc(ind)) +
      (Array.isArray(k.categorie) && k.categorie.length ? dato('Categorie', k.categorie.map(function (c) { return '<span class="badge st-dafare">' + esc(nomeCat(c)) + '</span>' }).join(' ')) : '') +
      dato('Note', k.note ? esc(k.note).replace(/\n/g, '<br>') : '') + '</div>'
    h += '<div class="blocco blocco-tenue">' + dato('UID / partita IVA', esc(k.uid_partita_iva || '')) + dato('IBAN', esc(k.iban || '')) +
      dato('Giorni di pagamento', k.giorni_pagamento != null ? esc(k.giorni_pagamento) : '') +
      dato('Gruppo predefinito (Pre-contabilità)', k.gruppo_default ? esc(etichettaGruppo(k.gruppo_default)) : '') + '</div>'
    var col = collegamenti(k)
    if (col.commesse.length || col.esterni.length) {
      h += '<div class="blocco"><h3 class="blocco-titolo">' + ico('info') + 'Collegato a</h3>' +
        col.commesse.map(function (c) { return dato('Cliente della commessa', '<a href="#commessa/' + esc(c.id) + '">' + esc((c.numero_commessa ? c.numero_commessa + ' · ' : '') + c.nome) + '</a>') }).join('') +
        col.esterni.map(function (o) { return dato('Ditta dell\'Esterno', '<a href="#persona/' + esc(o.id) + '">' + esc([o.nome, o.cognome].join(' ')) + '</a>') }).join('') + '</div>'
    }
    h += '<div class="blocco blocco-tenue" id="kt-fine">' +
      (k.attivo !== false ? '<button type="button" class="btn btn-secondario" data-kt-azione="archivia">' + ico('lucchetto') + '<span>Archivia</span></button>' : '') +
      (ST.utente && ST.utente.ruolo === 'titolare' ? ' <button type="button" class="btn btn-secondario" data-kt-azione="elimina">' + ico('togli') + '<span>Elimina</span></button>' : '') + '</div>'
    pane.innerHTML = h
    mostraFoto(k)
  }
  async function mostraFoto(k) {
    if (!k.foto_url) return
    var box = el('kt-foto'); if (!box) return
    var url = /^https?:/.test(k.foto_url) ? null : k.foto_url
    var p = url
    if (!p) { var m = String(k.foto_url).match(/rubrica-foto\/(.+)$/); p = m ? decodeURIComponent(m[1]) : null }
    if (!p) return
    try {
      var s = ST.foto[p] || (ST.foto[p] = await AD.linkFirmato('rubrica-foto', p, 3600))
      if (el('kt-foto') === box) box.innerHTML = '<img class="foto-contatto" src="' + esc(s) + '" alt="Foto di ' + esc(nome(k)) + '">'
    } catch (_) { /* senza foto si va avanti */ }
  }

  // ── MODULO ─────────────────────────────────────────────────────────────────
  function campo(id, et, ctrl, aiuto, obbl) {
    return '<div class="campo" id="campo-' + id + '"><label for="' + id + '">' + esc(et) + (obbl ? ' <span class="obbl">obbligatorio</span>' : '') + '</label>' + ctrl +
      (aiuto ? '<div class="campo-aiuto" id="aiuto-' + id + '">' + aiuto + '</div>' : '') + '<div class="campo-errore" id="err-' + id + '" hidden></div></div>'
  }
  function inp(id, v, extra) { return '<input id="' + id + '" type="text" value="' + esc(v == null ? '' : v) + '" autocomplete="off"' + (extra || '') + '>' }
  function bozzaDa(k) {
    return { id: k ? k.id : null, persona: k ? !k.ragione_sociale : false, ragione_sociale: k && k.ragione_sociale || '', nome: k && k.nome || '', cognome: k && k.cognome || '',
      referente: k && k.referente || '', telefono: k && k.telefono || '', cellulare: k && k.cellulare || '', email: k && k.email || '', sito_web: k && k.sito_web || '',
      indirizzo: k && k.indirizzo || '', cap: k && k.cap || '', citta: k && k.citta || '', paese: k && k.paese || 'CH', uid_partita_iva: k && k.uid_partita_iva || '',
      iban: k && k.iban || '', gruppo: k && k.gruppo_default || '', giorni_pagamento: k && k.giorni_pagamento != null ? String(k.giorni_pagamento) : '', note: k && k.note || '',
      fornitore: k ? AC.eFornitore(k) : false, cliente: k ? eCliente(k) : false,
      categorie: k && Array.isArray(k.categorie) ? k.categorie.slice() : null }
  }
  function disegnaModulo() {
    var f = ST.form, indietro = f.id ? '#contatto/' + f.id : '#contatti'
    var cats = (ST.categorie || []).filter(function (c) { return c.attiva !== false && c.id !== 'fornitori' })
    var h = '<form id="kt-modulo" novalidate>' + testata(f.id ? 'Modifica ' + (f.ragione_sociale || (f.nome + ' ' + f.cognome)) : 'Nuovo contatto', '', '', indietro)
    h += '<div class="blocco"><fieldset class="scelta"><legend>È una ditta o una persona?</legend>' +
      '<label class="scelta-voce"><input type="radio" name="kt-tipo" value="ditta"' + (!f.persona ? ' checked' : '') + '> <span>Ditta</span></label>' +
      '<label class="scelta-voce"><input type="radio" name="kt-tipo" value="persona"' + (f.persona ? ' checked' : '') + '> <span>Persona</span></label></fieldset>' +
      '<div id="kt-ditta"' + (f.persona ? ' hidden' : '') + '>' + campo('kt-ragione_sociale', 'Nome della ditta', inp('kt-ragione_sociale', f.ragione_sociale, ' maxlength="160"'), '', true) +
        campo('kt-referente', 'Referente (persona da cercare in ditta)', inp('kt-referente', f.referente, ' maxlength="120"')) + '</div>' +
      '<div class="campi-due campi-pari">' + campo('kt-nome', f.persona ? 'Nome' : 'Nome (facoltativo)', inp('kt-nome', f.nome, ' maxlength="80"'), '', f.persona) +
        campo('kt-cognome', 'Cognome', inp('kt-cognome', f.cognome, ' maxlength="80"')) + '</div></div>'
    h += '<div class="blocco"><h3 class="blocco-titolo">Che cos\'è per noi</h3>' +
      '<label class="scelta-carta' + (f.fornitore ? ' scelta-carta-attiva' : '') + '"><input type="checkbox" id="kt-fornitore"' + (f.fornitore ? ' checked' : '') + '>' +
        '<span><strong>' + ico('ditta') + ' Fornitore</strong><span class="dato-sotto">ci vende materiale o lavori (anche la ditta di un Esterno)</span></span></label>' +
      '<label class="scelta-carta' + (f.cliente ? ' scelta-carta-attiva' : '') + '"><input type="checkbox" id="kt-cliente"' + (f.cliente ? ' checked' : '') + '>' +
        '<span><strong>' + ico('cliente') + ' Cliente</strong><span class="dato-sotto">gli facciamo lavori</span></span></label>'
    if (cats.length) {
      h += '<fieldset class="scelta"><legend>Altre categorie</legend>' + cats.map(function (c) {
        return '<label class="scelta-voce"><input type="checkbox" name="kt-cat" value="' + esc(c.id) + '"' + (f.categorie && f.categorie.indexOf(c.id) >= 0 ? ' checked' : '') + '> <span>' + esc(c.nome) + '</span></label>'
      }).join('') + '</fieldset>'
    }
    h += '</div>'
    h += '<div class="blocco"><h3 class="blocco-titolo">Recapiti</h3>' +
      campo('kt-cellulare', 'Cellulare', inp('kt-cellulare', f.cellulare, ' inputmode="tel" maxlength="40"')) +
      campo('kt-telefono', 'Telefono fisso', inp('kt-telefono', f.telefono, ' inputmode="tel" maxlength="40"')) +
      campo('kt-email', 'Email', inp('kt-email', f.email, ' inputmode="email" maxlength="120"')) +
      campo('kt-sito_web', 'Sito', inp('kt-sito_web', f.sito_web, ' inputmode="url" maxlength="160"')) + '</div>'
    h += '<div class="blocco"><h3 class="blocco-titolo">Indirizzo</h3>' + campo('kt-indirizzo', 'Via e numero', inp('kt-indirizzo', f.indirizzo, ' maxlength="160"')) +
      '<div class="campi-due">' + campo('kt-cap', 'CAP', inp('kt-cap', f.cap, ' inputmode="numeric" maxlength="10" list="kt-cap-lista"') + '<datalist id="kt-cap-lista"></datalist>') +
        campo('kt-citta', 'Località', inp('kt-citta', f.citta, ' maxlength="120" list="kt-loc-lista"') + '<datalist id="kt-loc-lista"></datalist>') + '</div>' +
      '<div id="kt-cap-aiuto" class="campo-aiuto"></div>' +
      campo('kt-paese', 'Paese', '<select id="kt-paese">' + AC.opzioniPaese(f.paese) + '</select>') + '</div>'
    h += '<div class="blocco blocco-tenue"><h3 class="blocco-titolo">Per le fatture</h3>' +
      campo('kt-uid_partita_iva', 'UID / partita IVA', inp('kt-uid_partita_iva', f.uid_partita_iva, ' maxlength="40"')) +
      campo('kt-iban', 'IBAN', inp('kt-iban', f.iban, ' maxlength="42"')) +
      campo('kt-giorni_pagamento', 'Giorni di pagamento', inp('kt-giorni_pagamento', f.giorni_pagamento, ' inputmode="numeric" maxlength="4"')) +
      (ST.gruppi
        ? campo('kt-gruppo', 'Gruppo predefinito (Pre-contabilità)', '<select id="kt-gruppo">' + opzioniGruppo(f.gruppo) + '</select>', 'La Pre-contabilità lo propone quando registra una fattura di questo contatto. Vuoto = nessun gruppo.')
        : campo('kt-gruppo', 'Gruppo predefinito (Pre-contabilità)', '<div class="dato-valore">' + (f.gruppo ? esc(f.gruppo) : '<span class="vuoto-inline">—</span>') + '</div>', 'Elenco dei gruppi non leggibile: qui il gruppo non si cambia e resta com\'è. ' + esc(ST.gruppiErrore || ''))) + '</div>'
    h += '<div class="blocco">' + campo('kt-note', 'Note', '<textarea id="kt-note" rows="3" maxlength="2000">' + esc(f.note) + '</textarea>') + '</div>'
    h += '<div id="kt-avvisi"></div><div class="barra-salva"><a class="btn btn-secondario" href="' + esc(indietro) + '">' + ico('chiudi') + '<span>Annulla</span></a>' +
      '<button type="submit" class="btn btn-primario" id="kt-salva">' + ico('salva') + '<span>Salva</span></button></div></form>'
    el('pane-dettaglio').innerHTML = h
    var pane = el('pane-dettaglio')
    pane.querySelectorAll('input[name="kt-tipo"]').forEach(function (r) { r.addEventListener('change', function () { leggiModulo(); disegnaModulo() }) })
    ;['kt-fornitore', 'kt-cliente'].forEach(function (id) { el(id).addEventListener('change', function () { el(id).closest('.scelta-carta').classList.toggle('scelta-carta-attiva', el(id).checked) }) })
    el('kt-modulo').addEventListener('submit', function (ev) { ev.preventDefault(); salva() })
    if (window.CAP) CAP.collega('kt-cap', 'kt-citta', 'kt-cap-aiuto', 'kt-paese')
    var p = el(f.persona ? 'kt-nome' : 'kt-ragione_sociale'); if (p && !f.id) p.focus()
  }
  var CAMPI = ['ragione_sociale', 'nome', 'cognome', 'referente', 'telefono', 'cellulare', 'email', 'sito_web', 'indirizzo', 'cap', 'citta', 'uid_partita_iva', 'iban', 'giorni_pagamento', 'note']
  function leggiModulo() {
    var f = ST.form; if (!f) return
    CAMPI.forEach(function (c) { var x = el('kt-' + c); if (x) f[c] = x.value })
    var t = document.querySelector('input[name="kt-tipo"]:checked'); if (t) f.persona = t.value === 'persona'
    var p = el('kt-paese'); if (p) f.paese = p.value
    var gr = el('kt-gruppo'); if (gr && gr.tagName === 'SELECT') f.gruppo = gr.value
    f.fornitore = el('kt-fornitore') ? el('kt-fornitore').checked : f.fornitore
    f.cliente = el('kt-cliente') ? el('kt-cliente').checked : f.cliente
    var boxes = document.querySelectorAll('input[name="kt-cat"]')
    if (boxes.length) {
      var scelte = [].filter.call(boxes, function (b) { return b.checked }).map(function (b) { return b.value })
      var altre = (f.categorie || []).filter(function (c) { return c === 'fornitori' || ![].some.call(boxes, function (b) { return b.value === c }) })
      f.categorieScelte = altre.filter(function (c) { return c !== 'fornitori' }).concat(scelte)
    }
  }
  function errore(id, testo) {
    var c = el(id), e = el('err-' + id), b = el('campo-' + id)
    if (b) b.classList.add('campo-sbagliato'); if (e) { e.textContent = testo; e.hidden = false }
    if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c.focus() }
    return false
  }
  function vn(s) { s = String(s == null ? '' : s).trim(); return s || null }
  function normaleNome(s) { return AC.normale(s).replace(/\b(sa|sagl|srl|sarl|ag|gmbh|spa|snc|sas)\b/g, ' ').replace(/\s+/g, ' ').trim() }

  async function salva() {
    leggiModulo()
    var f = ST.form, pane = el('pane-dettaglio')
    pane.querySelectorAll('.campo-errore').forEach(function (x) { x.hidden = true })
    pane.querySelectorAll('.campo-sbagliato').forEach(function (x) { x.classList.remove('campo-sbagliato') })
    el('kt-avvisi').innerHTML = ''
    if (!f.persona && !String(f.ragione_sociale).trim()) return errore('kt-ragione_sociale', 'Scrivi il nome della ditta.')
    if (f.persona && !String(f.nome).trim() && !String(f.cognome).trim()) return errore('kt-nome', 'Scrivi nome o cognome.')
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f.email).trim())) return errore('kt-email', 'Questa email non sembra giusta.')
    if (f.giorni_pagamento && !/^\d{1,3}$/.test(String(f.giorni_pagamento).trim())) return errore('kt-giorni_pagamento', 'Solo un numero di giorni (es. 30).')
    var riga = {}
    CAMPI.forEach(function (c) { riga[c] = vn(f[c]) })
    if (f.persona) riga.ragione_sociale = null
    if (riga.iban) riga.iban = riga.iban.replace(/\s+/g, '').toUpperCase()
    riga.giorni_pagamento = riga.giorni_pagamento ? parseInt(riga.giorni_pagamento, 10) : null
    riga.paese = f.paese || 'CH'
    // Gruppo predefinito: si scrive SOLO se l'elenco si legge e il valore è cambiato (vuoto = nessun gruppo = NULL)
    var orig0 = f.id ? perId(f.id) : null
    if (ST.gruppi && (f.gruppo || '') !== ((orig0 && orig0.gruppo_default) || '')) riga.gruppo_default = vn(f.gruppo)
    // Categorie: si scrivono SOLO se cambiate (un contatto vecchio senza categorie resta com'era)
    var orig = f.id ? perId(f.id) : null
    var cambioTipo = !orig || f.fornitore !== AC.eFornitore(orig) || f.cliente !== eCliente(orig) || !!f.categorieScelte
    if (cambioTipo) {
      var cats = (f.categorieScelte || (orig && Array.isArray(orig.categorie) ? orig.categorie : [])).filter(function (c) { return c !== 'fornitori' })
      if (f.fornitore) cats.push('fornitori')
      var clienteCat = cats.some(function (c) { return CAT_CLIENTE.indexOf(c) >= 0 })
      var categoria = (f.cliente || clienteCat) ? 'cliente' : f.fornitore ? 'fornitore' : cats.indexOf('collaboratori') >= 0 ? 'collaboratore' : 'generico'
      riga.categorie = cats
      riga.categoria = categoria
      riga.e_fornitore = !!f.fornitore                 // la risposta unica (ANAG_F2_04)
      riga.e_cliente = !!(f.cliente || clienteCat) && categoria !== 'cliente'
    }
    // Omonimi: avviso, mai blocco
    if (!ST.salvaComunque) {
      var n = normaleNome(f.persona ? f.nome + ' ' + f.cognome : f.ragione_sociale)
      var simile = ST.contatti.filter(function (k) { return k.id !== f.id && normaleNome(nome(k)) === n })[0]
      if (simile) {
        el('kt-avvisi').innerHTML = AC.avviso('warn', 'C\'è già <strong>' + esc(nome(simile)) + '</strong>' + (simile.citta ? ' (' + esc(simile.citta) + ')' : '') + (simile.attivo === false ? ', archiviato' : '') + '. È lo stesso?' +
          '<div class="azioni-riga"><a class="btn btn-primario btn-piccolo" href="#contatto/' + esc(simile.id) + '">Sì, apri quello</a>' +
          '<button type="button" class="btn btn-secondario btn-piccolo" data-kt-azione="salva-comunque">No, salva</button></div>')
        el('kt-avvisi').scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
    }
    var b = el('kt-salva'); b.disabled = true
    try {
      var k
      if (orig) { k = await AD.aggiorna('tm_contatti', orig.id, riga, COL); ST.contatti = ST.contatti.map(function (x) { return x.id === k.id ? k : x }) }
      else { riga.attivo = true; k = await AD.inserisci('tm_contatti', riga, COL); ST.contatti.push(k) }
      ST.salvaComunque = false; ST.form = null
      if (window.CM) CM.ricarica(); if (window.PS) PS.ricarica()
      ST.messaggio = { tipo: 'ok', html: orig ? 'Modifiche salvate.' : 'Contatto <strong>' + esc(nome(k)) + '</strong> salvato.' }
      location.hash = '#contatto/' + k.id
    } catch (e) {
      b.disabled = false
      if (e.sessioneAssente) return APP.sessioneScaduta()
      el('kt-avvisi').innerHTML = AC.avviso('err', '<strong>NON salvato.</strong> ' + esc(spiega(e)))
    }
  }
  function spiega(e) {
    var m = String(e && e.message || e)
    if (/anag_cantieri_cliente_fk/.test(m)) return 'è il cliente di una commessa.'
    if (/anag_operai_ditta_fk/.test(m)) return 'è la ditta di un Esterno (Persone).'
    if (/tm_conta_/.test(m)) return 'ha fatture o movimenti in Pre-contabilità.'
    if (/rf_/.test(m)) return 'è un fornitore nel Radar.'
    if (/gruppo_default/.test(m) && /foreign key/i.test(m)) return 'il gruppo scelto non esiste più. Riapri il menu «Gruppo predefinito» e scegline un altro.'
    if (/foreign key/i.test(m)) return 'è collegato ad altri dati.'
    if (/row-level|permission denied|0 righe/i.test(m)) return 'il database non ti dà il permesso. Esci, rientra e riprova.'
    return m
  }

  // ── Archivia / Rimetti / Elimina ──────────────────────────────────────────
  async function archivia(id, attivo) {
    try {
      var k = await AD.aggiorna('tm_contatti', id, { attivo: attivo }, COL)
      ST.contatti = ST.contatti.map(function (x) { return x.id === k.id ? k : x })
      if (window.CM) CM.ricarica(); if (window.PS) PS.ricarica()
      ST.messaggio = { tipo: 'ok', html: attivo ? 'Rimesso fra gli attivi.' : 'Archiviato: non compare più negli elenchi, si trova cercando.' }
      disegnaElenco(id); disegnaScheda(id)
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      el('kt-fine').innerHTML = AC.avviso('err', 'NON salvato: ' + esc(spiega(e)))
    }
  }
  function chiediElimina(id) {
    var k = perId(id), col = collegamenti(k)
    var box = el('kt-fine')
    if (col.commesse.length || col.esterni.length) {
      box.innerHTML = AC.avviso('warn', '<strong>Non si può eliminare:</strong> ' + esc(col.commesse.length ? 'è il cliente della commessa ' + (col.commesse[0].numero_commessa || col.commesse[0].nome) + '.' : 'è la ditta di un Esterno.') + ' Vuoi archiviarlo?' +
        '<div class="azioni-riga"><button type="button" class="btn btn-primario" data-kt-azione="archivia">Sì, archivia</button><button type="button" class="btn btn-secondario" data-kt-azione="annulla-fine">Annulla</button></div>')
      return
    }
    box.innerHTML = AC.avviso('warn', 'Eliminare <strong>' + esc(nome(k)) + '</strong> per sempre? Di solito basta <strong>Archivia</strong>.' +
      '<div class="azioni-riga"><button type="button" class="btn btn-primario" data-kt-azione="elimina-si">' + ico('togli') + '<span>Sì, elimina</span></button>' +
      '<button type="button" class="btn btn-secondario" data-kt-azione="archivia">Archivia invece</button><button type="button" class="btn btn-secondario" data-kt-azione="annulla-fine">Annulla</button></div>')
  }
  async function elimina(id) {
    try {
      await AD.cancella('tm_contatti', id)
      ST.contatti = ST.contatti.filter(function (x) { return x.id !== id })
      if (window.CM) CM.ricarica(); if (window.PS) PS.ricarica()
      location.hash = '#contatti'
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      el('kt-fine').innerHTML = AC.avviso('err', '<strong>Non eliminato:</strong> ' + esc(spiega(e)) + ' Vuoi archiviarlo?' +
        '<div class="azioni-riga"><button type="button" class="btn btn-primario" data-kt-azione="archivia">Sì, archivia</button><button type="button" class="btn btn-secondario" data-kt-azione="annulla-fine">Annulla</button></div>')
    }
  }

  var aperto = null
  function clic(ev) {
    var t = ev.target.closest('[data-apri-contatto],[data-kt-azione],[data-kt-filtro]')
    if (!t) return
    if (t.dataset.apriContatto) { location.hash = '#contatto/' + t.dataset.apriContatto; return }
    if (t.dataset.ktFiltro) { ST.filtro = t.dataset.ktFiltro; disegnaElenco(aperto); return }
    var a = t.dataset.ktAzione
    if (a === 'nuovo') { location.hash = '#nuovo-contatto-rubrica'; return }
    if (a === 'salva-comunque') { ST.salvaComunque = true; salva(); return }
    if (a === 'archivia') return archivia(aperto, false)
    if (a === 'riattiva') return archivia(aperto, true)
    if (a === 'elimina') return chiediElimina(aperto)
    if (a === 'elimina-si') return elimina(aperto)
    if (a === 'annulla-fine') return disegnaScheda(aperto)
  }

  // parti: ['contatti'] | ['contatto', id] | ['contatto', id, 'modifica'|'fornitore'] | ['nuovo-contatto-rubrica', 'fornitore'?]
  async function mostra(parti, utente) {
    ST.utente = utente
    await carica()
    var v = parti[0], id = parti[1] || null
    aperto = v === 'contatto' ? id : null
    document.body.classList.toggle('con-dettaglio', v !== 'contatti')
    disegnaElenco(aperto)
    if (v === 'nuovo-contatto-rubrica') {
      if (!ST.form || ST.form.id) { ST.form = bozzaDa(null); if (parti[1] === 'fornitore') ST.form.fornitore = true }
      ST.salvaComunque = false
      return disegnaModulo()
    }
    if (v === 'contatto') {
      var k = perId(id)
      if (!k) { el('pane-dettaglio').innerHTML = AC.avviso('warn', 'Questo contatto non c\'è. <a href="#contatti">Torna all\'elenco</a>.'); return }
      if (parti[2] === 'modifica' || parti[2] === 'fornitore') {
        if (!ST.form || ST.form.id !== id) ST.form = bozzaDa(k)
        if (parti[2] === 'fornitore') ST.form.fornitore = true      // «Diventa fornitore» (dal Radar)
        ST.salvaComunque = false
        return disegnaModulo()
      }
      ST.form = null
      return disegnaScheda(id)
    }
    el('pane-dettaglio').innerHTML = '<div class="vuoto vuoto-grande">' + ico('contatti') + '<p>Scegli un contatto dall\'elenco,<br>oppure «Nuovo contatto».</p>' +
      '<p class="nota">Foto e categorie si cambiano ancora nella <a href="riserva/">Rubrica di riserva</a>.</p></div>'
  }
  function avvia() { el('pane-elenco').addEventListener('click', clic); el('pane-dettaglio').addEventListener('click', clic) }

  return { mostra: mostra, avvia: avvia, svuota: svuota, ricarica: function () { ST.caricato = false }, _st: ST, _whatsapp: whatsapp }
})()
