/* ═══════════════════════════════════════════════════════════════════════════
   Anagrafiche — CONTATTI (tabella tm_contatti, la rubrica di tutte le app)

   Regole (FASE2_DISEGNO.md §5 + decisioni del 2.11.2026):
   - «È un fornitore?» in UN solo modo: il tasto «Fornitore» = e_fornitore
     (SQL ANAG_F2_04 tiene allineati anche categoria e categorie per le app vecchie).
   - Archiviati (attivo = false): non negli elenchi; compaiono nella ricerca e nel
     filtro «Archiviati», con la scritta e «Rimetti fra gli attivi».
   - «Archivia» = attivo false, i dati restano. «Cancella» (v7): solo il titolare, con password, avviso e registro
     (js/cancella.js); se il contatto è collegato (commessa, Esterno, Contabilità, Materiali, Preventivi) il database
     rifiuta: si spiega cosa blocca e si propone «Archivia invece».
   - Omonimi: avviso, mai blocco. CAP ↔ località: aiuto, mai blocco.
   - Categorie multiple (rubrica_categorie) come nella Rubrica: si assegnano e si tolgono nel modulo,
     si crea una categoria nuova (la tabella permette leggere/aggiungere/modificare, mai cancellare).
     v7: «Gestisci categorie» (#categorie) rinomina e disattiva: tocca solo nome e attiva, l'id non cambia mai;
     «fornitori» non si rinomina né disattiva.
     «Fornitori» NON si sceglie dalle categorie: c'è solo il tasto «Fornitore» (e_fornitore, ANAG_F2_04).
   - Foto (v6): bucket privato rubrica-foto, percorso <id contatto>/<ora>.<est>, in tm_contatti.foto_url
     solo il percorso; si vede con link firmato (1 ora). Si carica / cambia / toglie nel modulo, al «Salva».
     Contatto cancellato = anche le sue foto (se non riesce, lo dice).
   - azienda_id non si manda: la mette il database (trigger anag_contatti_azienda).
   ═══════════════════════════════════════════════════════════════════════════ */
var KT = (function () {
  'use strict'
  var esc = AC.esc, ico = AC.ico, el = AC.el

  var COL = 'id,categoria,categorie,ragione_sociale,nome,cognome,referente,indirizzo,cap,citta,paese,telefono,cellulare,email,sito_web,' +
            'uid_partita_iva,iban,giorni_pagamento,gruppo_default,note,attivo,e_cliente,e_fornitore,foto_url,azienda_id,created_at'
  var CAT_CLIENTE = ['preventivi', 'appalti_presi', 'appalti_conclusi']
  var PREFISSI = { CH: '41', IT: '39', DE: '49', FR: '33', AT: '43', LI: '423' }

  var ST = {
    contatti: [], categorie: null, catErrore: null, gruppi: null, gruppiErrore: null, cantieri: [], operai: [],
    caricato: false, cerca: '', filtro: 'tutti', form: null, messaggio: null, utente: null, foto: {}, azienda: null
  }
  var BUCKET_FOTO = 'rubrica-foto'
  var FOTO_SECONDI = 3600, FOTO_RINNOVA_MS = 40 * 60 * 1000

  async function carica(forza) {
    if (ST.caricato && !forza) return
    var r = await Promise.all([
      AD.leggi('tm_contatti', COL),
      AD.leggi('cantieri', 'id,nome,numero_commessa,cliente_id,tipo'),
      AD.leggiConRiserva('operai', 'id,nome,cognome,ditta_id,rapporto,attivo,data_fine_rapporto', 'id,nome,cognome')
    ])
    if (!r[0].length) throw new Error('Il database non mi dà i contatti (0 righe). L\'elenco NON è attendibile: esci, rientra e riprova.')
    ST.contatti = r[0]; ST.cantieri = r[1]; ST.operai = r[2].righe
    try {
      var cr = (await AD.leggi('rubrica_categorie', 'id,nome,ordine,attiva,azienda_id')).sort(function (a, b) { return (a.ordine || 0) - (b.ordine || 0) })
      if (!cr.length) throw new Error('Il database non mi dà nessuna categoria (0 righe): l\'elenco NON è attendibile.')   // le categorie di partenza sono 9: zero = permessi, non «niente»
      ST.categorie = cr
      ST.catErrore = null
    } catch (e) { if (e.sessioneAssente) throw e; ST.categorie = null; ST.catErrore = e.message }
    // L'azienda serve per creare una categoria (la tabella non la mette da sola): dalle categorie lette, o da un contatto.
    ST.azienda = ((ST.categorie || []).filter(function (c) { return c.azienda_id })[0] || ST.contatti.filter(function (k) { return k.azienda_id })[0] || {}).azienda_id || null
    // Gruppi per il «Gruppo predefinito» (Pre-contabilità): stessa fonte della Pre-contabilità, tm_conta_gruppi.
    // Se non si leggono, il campo non si offre e il gruppo di ogni contatto resta com'è (mai un gruppo cancellato per sbaglio).
    // Solo il titolare lo vede e lo cambia (tm_conta_* solo titolare, Umberto 4.11.2026). Per gli altri non si legge nemmeno:
    // darebbe zero righe. ST.gruppi resta null, quindi il campo non si scrive mai (vedi salvataggio).
    if (!vedeGruppi()) { ST.gruppi = null; ST.gruppiErrore = null } else try {
      var g = await AD.leggiConRiserva('tm_conta_gruppi', 'codice,nome,ordine,attivo,tipo,azienda_id', 'codice,nome,ordine,attivo')
      ST.gruppi = g.righe.sort(function (a, b) { return (a.ordine || 0) - (b.ordine || 0) })
      ST.gruppiErrore = ST.gruppi.length ? null : 'Il database non mi dà nessun gruppo (0 righe).'
      if (!ST.gruppi.length) ST.gruppi = null
    } catch (e) { if (e.sessioneAssente) throw e; ST.gruppi = null; ST.gruppiErrore = e.message }
    ST.caricato = true
  }
  function scarta() { ST.form = null; ST.salvaComunque = false }
  function svuota() { ST.contatti = []; ST.cantieri = []; ST.operai = []; ST.categorie = null; ST.gruppi = null; ST.gruppiErrore = null; ST.caricato = false; ST.form = null; ST.foto = {}; ST.azienda = null }
  function perId(id) { return ST.contatti.filter(function (k) { return k.id === id })[0] || null }
  function nome(k) { return AC.nomeContatto(k) }
  function eCliente(k) { return k.e_cliente === true || k.categoria === 'cliente' || (Array.isArray(k.categorie) && k.categorie.some(function (c) { return CAT_CLIENTE.indexOf(c) >= 0 })) }
  function nomeCat(id) { var c = (ST.categorie || []).filter(function (x) { return x.id === id })[0]; return c ? c.nome : id }
  // «MAT · Materiali»; un codice che non si legge (gruppo di un'altra azienda o elenco non leggibile) si mostra com'è.
  function vedeGruppi() { return !!ST.utente && ST.utente.ruolo === 'titolare' }
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

  // ── Foto (bucket privato rubrica-foto) ────────────────────────────────────
  // In tm_contatti.foto_url sta il PERCORSO «<id contatto>/<ora>.<est>». Dal percorso si ricava il link firmato.
  // Capisce anche i formati vecchi (URL pubblico/firmato dentro foto_url). Vuoto o rotto: null (niente foto).
  function pathDaFotoUrl(url) {
    var s = String(url == null ? '' : url).trim()
    if (!s) return null
    var p = null, m = s.match(/\/object\/(?:public|sign|authenticated)\/rubrica-foto\/([^?#]+)/)
    if (m) p = m[1]
    else if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^\/\//.test(s)) p = s.replace(/^\/+/, '').replace(/^rubrica-foto\//, '')
    if (!p) return null
    try { p = decodeURIComponent(p) } catch (_) { return null }
    var pezzi = p.split('/')
    if (pezzi.length < 2 || pezzi.some(function (x) { return !x || x === '.' || x === '..' })) return null
    if (/[?#\\]/.test(p)) return null
    return p
  }
  // Link firmato valido 1 ora; dopo 40 minuti se ne chiede uno nuovo.
  async function linkFoto(percorso) {
    var c = ST.foto[percorso]
    if (c && Date.now() - c.t < FOTO_RINNOVA_MS) return c.url
    var url = await AD.linkFirmato(BUCKET_FOTO, percorso, FOTO_SECONDI)
    ST.foto[percorso] = { url: url, t: Date.now() }
    return url
  }
  // La foto da telefono pesa 3-5 MB: per questa bastano 800 px. Se la riduzione non riesce si carica il file com'è.
  function ridimensiona(file, maxLato) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image()
      function originale() {
        var ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
        return { blob: file, ext: ext }
      }
      img.onload = function () {
        try {
          var w = img.naturalWidth, h = img.naturalHeight, sc = Math.min(1, maxLato / Math.max(w, h))
          var cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * sc)); cv.height = Math.max(1, Math.round(h * sc))
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height)
          cv.toBlob(function (blob) { URL.revokeObjectURL(url); resolve(blob ? { blob: blob, ext: 'jpg' } : originale()) }, 'image/jpeg', 0.85)
        } catch (_) { URL.revokeObjectURL(url); resolve(originale()) }
      }
      img.onerror = function () { URL.revokeObjectURL(url); resolve(originale()) }
      img.src = url
    })
  }
  // Si carica DOPO aver salvato il contatto: il percorso vuole l'id, e per un contatto nuovo c'è solo dopo.
  async function caricaFoto(contattoId, file) {
    var f = await ridimensiona(file, 800)
    if (f.blob.size > 10 * 1024 * 1024) throw new Error('il file è troppo grande (oltre 10 MB)')
    var percorso = contattoId + '/' + Date.now() + '.' + f.ext
    await AD.caricaFile(BUCKET_FOTO, percorso, f.blob)
    return percorso
  }
  function spiegaFoto(e) {
    var m = String(e && e.message || e)
    if (/row-level|policy|unauthorized|403|not allowed/i.test(m)) return 'il database non ti lascia caricare la foto (permessi). Esci, rientra e riprova.'
    if (/bucket not found/i.test(m)) return 'il contenitore delle foto (rubrica-foto) non esiste.'
    if (/too large|payload|troppo grande/i.test(m)) return 'il file è troppo grande.'
    if (/Failed to fetch|network/i.test(m)) return 'non riesco a raggiungere il server: controlla la connessione.'
    return m
  }

  // ── Categorie (rubrica_categorie) ──────────────────────────────────────────
  // L'id è la chiave che finisce in tm_contatti.categorie e non cambia mai. Un id nuovo si ricava dal nome:
  // «Appalti presi» → appalti_presi, «Caffè & Bar» → caffe_bar. Mai sovrascrivere un id che c'è già.
  function slugCategoria(nome) {
    return String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40).replace(/_+$/, '')
  }
  function stessoInsieme(a, b) {
    return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0 })
  }
  // Le categorie che il contatto ha adesso (senza «fornitori», che è il tasto Fornitore). Se la colonna è NULL
  // (contatto creato altrove) si ricava dalla categoria vecchia: un «collaboratore» ha «collaboratori».
  function categorieDi(k) {
    if (!k) return []
    var c = Array.isArray(k.categorie) ? k.categorie : (k.categoria === 'collaboratore' ? ['collaboratori'] : [])
    return c.filter(function (x) { return x !== 'fornitori' })
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
    var cats = (ST.categorie || []).filter(function (c) { return c.attiva !== false && c.id !== 'fornitori' })   // «Fornitori» c'è già come filtro (e_fornitore)
    h += '<div class="filtri" role="group" aria-label="Filtra">' + FILTRI.concat(cats.map(function (c) { return { k: 'cat:' + c.id, n: c.nome } })).map(function (f) {
      return '<button type="button" class="filtro' + (ST.filtro === f.k ? ' filtro-attivo' : '') + '" data-kt-filtro="' + esc(f.k) + '" aria-pressed="' + (ST.filtro === f.k) + '">' + esc(f.n) + '</button>'
    }).join('') + '</div>'
    if (ST.catErrore) h += AC.avviso('warn', 'Categorie non leggibili: ' + esc(ST.catErrore))
    if (!ST.catErrore) h += '<div class="azioni-riga"><a class="btn btn-secondario btn-piccolo" id="kt-gestisci-cat" href="#categorie">' + ico('modifica') + '<span>Gestisci categorie</span></a></div>'
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
      (vedeGruppi() ? dato('Gruppo predefinito (Pre-contabilità)', k.gruppo_default ? esc(etichettaGruppo(k.gruppo_default)) : '') : '') + '</div>'
    var col = collegamenti(k)
    if (col.commesse.length || col.esterni.length) {
      h += '<div class="blocco"><h3 class="blocco-titolo">' + ico('info') + 'Collegato a</h3>' +
        col.commesse.map(function (c) { return dato('Cliente della commessa', '<a href="#commessa/' + esc(c.id) + '">' + esc((c.numero_commessa ? c.numero_commessa + ' · ' : '') + c.nome) + '</a>') }).join('') +
        col.esterni.map(function (o) { return dato('Ditta dell\'Esterno', '<a href="#persona/' + esc(o.id) + '">' + esc([o.nome, o.cognome].join(' ')) + '</a>' + (AC.inArchivio(o) ? ' <span class="badge st-senza">In archivio</span>' : '')) }).join('') + '</div>'
    }
    h += '<div class="blocco blocco-tenue" id="kt-fine">' +
      (k.attivo !== false ? '<button type="button" class="btn btn-primario" data-kt-azione="archivia">' + ico('lucchetto') + '<span>Archivia</span></button>' : '') +
      (ST.utente && ST.utente.ruolo === 'titolare' ? ' <button type="button" class="btn btn-pericolo" data-kt-azione="cancella">' + ico('togli') + '<span>Cancella</span></button>' : '') + '</div>'
    pane.innerHTML = h
    mostraFoto(k)
  }
  async function mostraFoto(k) {
    var p = pathDaFotoUrl(k.foto_url)
    var box = el('kt-foto'); if (!p || !box) return
    try {
      var url = await linkFoto(p)
      if (el('kt-foto') === box) box.innerHTML = '<img class="foto-contatto" src="' + esc(url) + '" alt="Foto di ' + esc(nome(k)) + '">'
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
      catIniziali: categorieDi(k), catSel: null,
      fotoPercorso: k ? pathDaFotoUrl(k.foto_url) : null, fotoLink: null, fotoFile: null, fotoAnteprima: null, fotoTogli: false }
  }
  // ── Foto nel modulo ───────────────────────────────────────────────────────
  function statoFoto(f) { return f.fotoFile ? 'nuova:' + f.fotoFile.name + ':' + f.fotoFile.size : (f.fotoTogli ? 'togli' : '') }
  function disegnaFotoModulo() {
    var f = ST.form, box = el('kt-foto-anteprima'); if (!f || !box) return
    var src = f.fotoFile ? f.fotoAnteprima : (f.fotoTogli ? null : f.fotoLink)
    var avere = !!f.fotoFile || (!!f.fotoPercorso && !f.fotoTogli)
    box.innerHTML = src ? '<img class="foto-contatto" src="' + esc(src) + '" alt="Foto del contatto">'
      : '<div class="foto-vuota">' + ico('foto') + '<span>' + (avere ? 'Carico la foto…' : (f.fotoTogli ? 'Foto tolta: si toglie con «Salva»' : 'Nessuna foto')) + '</span></div>'
    var t = el('kt-foto-togli'); if (t) t.hidden = !avere
    var st = el('kt-foto-stato'); if (st) st.value = statoFoto(f)
  }
  async function caricaLinkFotoModulo() {
    var f = ST.form; if (!f || !f.fotoPercorso || f.fotoLink) return
    try {
      var url = await linkFoto(f.fotoPercorso)
      if (ST.form === f) { f.fotoLink = url; disegnaFotoModulo() }
    } catch (e) {
      var a = el('kt-foto-avviso'); if (a && ST.form === f) a.innerHTML = AC.avviso('warn', 'Non riesco a mostrare la foto di adesso: ' + esc(spiegaFoto(e)))
    }
  }
  function fotoScelta(input) {
    var f = ST.form, file = input.files && input.files[0]; if (!f || !file) return
    var av = el('kt-foto-avviso'); av.innerHTML = ''
    if (!/^image\//.test(file.type)) { av.innerHTML = AC.avviso('err', 'Il file scelto non è un\'immagine.'); input.value = ''; return }
    f.fotoFile = file; f.fotoTogli = false; f.fotoAnteprima = null
    disegnaFotoModulo()
    var r = new FileReader()
    r.onload = function (ev) { if (ST.form === f && f.fotoFile === file) { f.fotoAnteprima = ev.target.result; disegnaFotoModulo() } }
    r.readAsDataURL(file)
  }
  function fotoTogli() {
    var f = ST.form; if (!f) return
    f.fotoFile = null; f.fotoAnteprima = null; f.fotoTogli = !!f.fotoPercorso
    var i = el('kt-foto-file'); if (i) i.value = ''
    disegnaFotoModulo()
  }

  // ── Categorie nel modulo ──────────────────────────────────────────────────
  // Spunte: le categorie attive (senza «fornitori») + quelle che il contatto ha già ma non sono più attive o in elenco
  // (restano spuntate, così si possono togliere; mai tolte di nascosto).
  function disegnaChipCategorie(sel) {
    var cats = ST.categorie || []
    var voci = cats.filter(function (c) { return c.attiva !== false && c.id !== 'fornitori' })
    sel.forEach(function (id) {
      if (id === 'fornitori' || voci.some(function (v) { return v.id === id })) return
      voci.push(cats.filter(function (c) { return c.id === id })[0] || { id: id, nome: id, attiva: false, fuori: true })
    })
    var box = el('kt-cat-chip'); if (!box) return
    box.innerHTML = voci.length ? voci.map(function (c) {
      return '<label class="scelta-voce"><input type="checkbox" name="kt-cat" value="' + esc(c.id) + '"' + (sel.indexOf(c.id) >= 0 ? ' checked' : '') + '> <span>' + esc(c.nome) +
        (c.attiva === false ? ' <span class="cat-spenta">(' + (c.fuori ? 'non più in elenco' : 'disattivata') + ')</span>' : '') + '</span></label>'
    }).join('') : '<div class="campo-aiuto">Nessuna categoria da scegliere.</div>'
  }
  function categorieSpuntate() {
    return [].filter.call(document.querySelectorAll('input[name="kt-cat"]'), function (b) { return b.checked }).map(function (b) { return b.value })
  }
  function msgCat(tipo, testo) { var m = el('kt-cat-msg'); if (m) m.innerHTML = testo ? AC.avviso(tipo, testo) : '' }
  var creandoCategoria = false
  async function creaCategoria() {
    if (creandoCategoria) return
    var inp = el('kt-cat-nuova'); if (!inp) return
    var nomeNuovo = inp.value.trim().replace(/\s+/g, ' ')
    var id = slugCategoria(nomeNuovo), cats = ST.categorie || []
    if (!nomeNuovo) return msgCat('err', 'Scrivi il nome della categoria nuova.')
    if (!id) return msgCat('err', 'Il nome deve avere almeno una lettera o una cifra.')
    var stessoId = cats.filter(function (c) { return c.id === id })[0]
    if (stessoId) {
      return msgCat('warn', 'C\'è già «' + esc(stessoId.nome) + '»' + (stessoId.attiva === false ? ', ma è disattivata (si riattiva da «Gestisci categorie»)' : ': la trovi nell\'elenco qui sopra') + '. Non la creo due volte.')
    }
    var stessoNome = cats.filter(function (c) { return AC.normale(c.nome) === AC.normale(nomeNuovo) })[0]
    if (stessoNome) return msgCat('warn', 'C\'è già una categoria che si chiama «' + esc(stessoNome.nome) + '». Scegli un nome diverso.')
    if (!ST.azienda) return msgCat('err', 'Non so a quale ditta appartiene la categoria: ricarica la pagina.')
    var ordine = cats.reduce(function (m, c) { return c.ordine != null && c.ordine > m ? c.ordine : m }, 0) + 1
    creandoCategoria = true
    var b = document.querySelector('[data-kt-azione="cat-crea"]'); if (b) b.disabled = true
    try {
      var riga = await AD.inserisci('rubrica_categorie', { id: id, azienda_id: ST.azienda, nome: nomeNuovo, ordine: ordine, attiva: true }, 'id,nome,ordine,attiva,azienda_id')
      leggiModulo()
      ST.categorie = cats.concat([riga]).sort(function (a, c2) { return (a.ordine || 0) - (c2.ordine || 0) })
      var sel = (ST.form && ST.form.catSel ? ST.form.catSel : categorieSpuntate()).concat([id])
      if (ST.form) ST.form.catSel = sel
      disegnaChipCategorie(sel)
      inp.value = ''
      disegnaElenco(aperto)
      if (el('kt-gestione')) disegnaCategorie()
      msgCat('ok', el('kt-gestione') ? 'Categoria <strong>' + esc(nomeNuovo) + '</strong> creata.' : 'Categoria <strong>' + esc(nomeNuovo) + '</strong> creata e spuntata. Va sul contatto quando premi «Salva».')
    } catch (e) {
      if (e.sessioneAssente) return APP.sessioneScaduta()
      var m = String(e.message || e)
      msgCat('err', /duplicate key|unique|23505/i.test(m + (e.codice || '')) ? 'Esiste già una categoria con questo codice («' + esc(id) + '»). Scegli un nome diverso.'
        : /row-level|permission denied|0 righe|NON riuscito/i.test(m) ? '<strong>NON creata:</strong> il database non ti dà il permesso.' : '<strong>NON creata:</strong> ' + esc(m))
    } finally {
      creandoCategoria = false
      var b2 = document.querySelector('[data-kt-azione="cat-crea"]'); if (b2) b2.disabled = false
    }
  }
  function disegnaModulo() {
    var f = ST.form, indietro = f.id ? '#contatto/' + f.id : '#contatti'
    var h = '<form id="kt-modulo" novalidate>' + testata(f.id ? 'Modifica ' + (f.ragione_sociale || (f.nome + ' ' + f.cognome)) : 'Nuovo contatto', '', '', indietro)
    h += '<div class="blocco"><fieldset class="scelta"><legend>È una ditta o una persona?</legend>' +
      '<label class="scelta-voce"><input type="radio" name="kt-tipo" value="ditta"' + (!f.persona ? ' checked' : '') + '> <span>Ditta</span></label>' +
      '<label class="scelta-voce"><input type="radio" name="kt-tipo" value="persona"' + (f.persona ? ' checked' : '') + '> <span>Persona</span></label></fieldset>' +
      '<div id="kt-ditta"' + (f.persona ? ' hidden' : '') + '>' + campo('kt-ragione_sociale', 'Nome della ditta', inp('kt-ragione_sociale', f.ragione_sociale, ' maxlength="160"'), '', true) +
        campo('kt-referente', 'Referente (persona da cercare in ditta)', inp('kt-referente', f.referente, ' maxlength="120"')) + '</div>' +
      '<div class="campi-due campi-pari">' + campo('kt-nome', f.persona ? 'Nome' : 'Nome (facoltativo)', inp('kt-nome', f.nome, ' maxlength="80"'), '', f.persona) +
        campo('kt-cognome', 'Cognome', inp('kt-cognome', f.cognome, ' maxlength="80"')) + '</div></div>'
    h += '<div class="blocco" id="kt-blocco-foto"><h3 class="blocco-titolo">' + ico('foto') + 'Foto</h3>' +
      '<div class="foto-riga"><div id="kt-foto-anteprima" class="foto-anteprima"></div><div class="foto-comandi">' +
        '<label class="btn btn-secondario">' + ico('foto') + '<span>Scegli foto</span><input type="file" id="kt-foto-file" class="nascosto" accept="image/*"></label>' +
        '<button type="button" class="btn btn-secondario" id="kt-foto-togli" data-kt-azione="foto-togli" hidden>' + ico('togli') + '<span>Togli foto</span></button></div></div>' +
      '<input type="hidden" id="kt-foto-stato" value="">' +
      '<div class="campo-aiuto">La foto si salva quando premi «Salva». La vedono solo titolare e responsabile.</div><div id="kt-foto-avviso"></div></div>'
    h += '<div class="blocco"><h3 class="blocco-titolo">Che cos\'è per noi</h3>' +
      '<label class="scelta-carta' + (f.fornitore ? ' scelta-carta-attiva' : '') + '"><input type="checkbox" id="kt-fornitore"' + (f.fornitore ? ' checked' : '') + '>' +
        '<span><strong>' + ico('ditta') + ' Fornitore</strong><span class="dato-sotto">ci vende materiale o lavori (anche la ditta di un Esterno)</span></span></label>' +
      '<label class="scelta-carta' + (f.cliente ? ' scelta-carta-attiva' : '') + '"><input type="checkbox" id="kt-cliente"' + (f.cliente ? ' checked' : '') + '>' +
        '<span><strong>' + ico('cliente') + ' Cliente</strong><span class="dato-sotto">gli facciamo lavori</span></span></label>'
    h += '<fieldset class="scelta" id="kt-cat-box"><legend>Altre categorie</legend><div id="kt-cat-chip"></div>' +
      (ST.categorie ? '' : AC.avviso('warn', 'Non riesco a leggere l\'elenco delle categorie' + (ST.catErrore ? ' (' + esc(ST.catErrore) + ')' : '') + ': qui si vedono solo quelle che il contatto ha già, e non se ne creano di nuove.')) +
      '<div class="campo-aiuto" id="kt-cat-aiuto"><strong>«Fornitori» non si sceglie da qui:</strong> si usa il tasto grande «Fornitore» qui sopra. Così un contatto è fornitore in un solo modo, uguale in tutte le app.</div>' +
      (ST.categorie ? '<div class="campo campo-nuova-cat" id="campo-kt-cat-nuova"><label for="kt-cat-nuova">Una categoria che non c\'è? Creala</label>' +
        '<div class="riga-aggiungi"><input id="kt-cat-nuova" type="text" maxlength="60" autocomplete="off" placeholder="Es. Geometri">' +
        '<button type="button" class="btn btn-secondario" data-kt-azione="cat-crea">' + ico('piu') + '<span>Aggiungi categoria</span></button></div>' +
        '<div class="campo-aiuto">La vedono tutti i contatti. Per rinominarla o disattivarla: <a href="#categorie">Gestisci categorie</a>.</div></div>' : '') +
      '<div id="kt-cat-msg"></div></fieldset></div>'
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
      (!vedeGruppi() ? '' : ST.gruppi
        ? campo('kt-gruppo', 'Gruppo predefinito (Pre-contabilità)', '<select id="kt-gruppo">' + opzioniGruppo(f.gruppo) + '</select>', 'La Pre-contabilità lo propone quando registra una fattura di questo contatto. Vuoto = nessun gruppo.')
        : campo('kt-gruppo', 'Gruppo predefinito (Pre-contabilità)', '<div class="dato-valore">' + (f.gruppo ? esc(f.gruppo) : '<span class="vuoto-inline">—</span>') + '</div>', 'Elenco dei gruppi non leggibile: qui il gruppo non si cambia e resta com\'è. ' + esc(ST.gruppiErrore || ''))) + '</div>'
    h += '<div class="blocco">' + campo('kt-note', 'Note', '<textarea id="kt-note" rows="3" maxlength="2000">' + esc(f.note) + '</textarea>') + '</div>'
    h += '<div id="kt-avvisi"></div><div class="barra-salva"><a class="btn btn-secondario" data-libera="1" href="' + esc(indietro) + '">' + ico('chiudi') + '<span>Annulla</span></a>' +
      '<button type="submit" class="btn btn-primario" id="kt-salva">' + ico('salva') + '<span>Salva</span></button></div></form>'
    el('pane-dettaglio').innerHTML = h
    var pane = el('pane-dettaglio')
    pane.querySelectorAll('input[name="kt-tipo"]').forEach(function (r) { r.addEventListener('change', function () { leggiModulo(); disegnaModulo() }) })
    ;['kt-fornitore', 'kt-cliente'].forEach(function (id) { el(id).addEventListener('change', function () { el(id).closest('.scelta-carta').classList.toggle('scelta-carta-attiva', el(id).checked) }) })
    el('kt-modulo').addEventListener('submit', function (ev) { ev.preventDefault(); salva() })
    disegnaChipCategorie(f.catSel || f.catIniziali)
    disegnaFotoModulo(); caricaLinkFotoModulo()
    el('kt-foto-file').addEventListener('change', function () { fotoScelta(this) })
    var cn = el('kt-cat-nuova'); if (cn) cn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); creaCategoria() } })
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
    if (el('kt-cat-chip')) f.catSel = categorieSpuntate()
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
    var catOra = f.catSel || f.catIniziali, catCambiate = !stessoInsieme(catOra, f.catIniziali)
    var cambioTipo = !orig || f.fornitore !== AC.eFornitore(orig) || f.cliente !== eCliente(orig) || catCambiate
    if (cambioTipo) {
      var cats = catOra.filter(function (c) { return c !== 'fornitori' })
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
    // Foto tolta (senza una nuova): il percorso si svuota nella stessa scrittura; il file si toglie dopo.
    if (orig && f.fotoTogli && !f.fotoFile && orig.foto_url) riga.foto_url = null
    var b = el('kt-salva'); b.disabled = true
    try {
      var k
      if (orig) { k = await AD.aggiorna('tm_contatti', orig.id, riga, COL); ST.contatti = ST.contatti.map(function (x) { return x.id === k.id ? k : x }) }
      else { riga.attivo = true; k = await AD.inserisci('tm_contatti', riga, COL); ST.contatti.push(k) }
      // La foto dopo il contatto (il percorso vuole l'id). Se la foto non va, il contatto è salvato lo stesso e lo si dice.
      var avvisoFoto = ''
      var vecchiaFoto = orig ? pathDaFotoUrl(orig.foto_url) : null
      if (f.fotoFile) {
        var nuovoPercorso = null
        try {
          nuovoPercorso = await caricaFoto(k.id, f.fotoFile)
          var k2 = await AD.aggiorna('tm_contatti', k.id, { foto_url: nuovoPercorso }, COL)
          k = k2; ST.contatti = ST.contatti.map(function (x) { return x.id === k2.id ? k2 : x })
          if (vecchiaFoto && vecchiaFoto !== nuovoPercorso) AD.togliFile(BUCKET_FOTO, vecchiaFoto)
        } catch (ef) {
          if (ef.sessioneAssente) return APP.sessioneScaduta()
          if (nuovoPercorso) AD.togliFile(BUCKET_FOTO, nuovoPercorso)   // file senza riga: via
          avvisoFoto = ' <strong>La foto però NON è stata caricata:</strong> ' + esc(spiegaFoto(ef)) + (vecchiaFoto ? ' (resta quella di prima)' : '')
        }
      } else if (orig && f.fotoTogli && vecchiaFoto) {
        AD.togliFile(BUCKET_FOTO, vecchiaFoto)
      }
      ST.salvaComunque = false; ST.form = null
      if (window.CM) CM.ricarica(); if (window.PS) PS.ricarica()
      ST.messaggio = { tipo: avvisoFoto ? 'warn' : 'ok', html: (orig ? 'Modifiche salvate.' : 'Contatto <strong>' + esc(nome(k)) + '</strong> salvato.') + avvisoFoto }
      APP.libera()
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

  // ── Gestisci categorie (v7) ───────────────────────────────────────────────
  // Rinomina = solo nome; disattiva = solo attiva. L'id è la chiave scritta sui contatti: non cambia mai.
  // «fornitori» è il tasto Fornitore: non si rinomina né si disattiva (si guarda l'id, non il nome).
  function contaConCategoria(id) {
    if (id === 'fornitori') return ST.contatti.filter(AC.eFornitore).length
    return ST.contatti.filter(function (k) { return categorieDi(k).indexOf(id) >= 0 }).length
  }
  function paroleContatti(n) { return n === 1 ? '1 contatto' : n + ' contatti' }
  function disegnaCategorie() {
    var pane = el('pane-dettaglio')
    var h = '<div id="kt-gestione">' + testata('Gestisci categorie', '', '', '#contatti')
    if (!ST.categorie) {
      pane.innerHTML = h + AC.avviso('err', '<strong>Non riesco a leggere le categorie.</strong> ' + esc(ST.catErrore || '')) + '</div>'
      return
    }
    h += '<p class="nota">Il nome cambia dappertutto, i contatti restano agganciati. Disattivare: non si offre più ai contatti, chi ce l\'ha la tiene.</p><div id="kt-cat-msg"></div><div class="blocco">'
    h += ST.categorie.map(function (c) {
      var n = contaConCategoria(c.id)
      if (c.id === 'fornitori') {
        return '<div class="cat-riga" data-cat-riga="fornitori"><strong>' + esc(c.nome) + '</strong><div class="cat-meta">' + paroleContatti(n) +
          ' · non si rinomina né si disattiva: è il tasto «Fornitore» del contatto.</div></div>'
      }
      return '<div class="cat-riga" data-cat-riga="' + esc(c.id) + '"><label for="kt-catn-' + esc(c.id) + '" class="nascosto">Nome della categoria</label>' +
        '<input id="kt-catn-' + esc(c.id) + '" data-cat-nome="' + esc(c.id) + '" type="text" maxlength="60" autocomplete="off" value="' + esc(c.nome) + '">' +
        '<div class="cat-meta">' + paroleContatti(n) + (c.attiva === false ? ' · <span class="cat-spenta">disattivata</span>' : '') + '</div>' +
        '<div class="azioni-riga"><button type="button" class="btn btn-secondario btn-piccolo" data-kt-azione="cat-rinomina" data-cat="' + esc(c.id) + '">' + ico('salva') + '<span>Salva nome</span></button>' +
        (c.attiva === false
          ? '<button type="button" class="btn btn-secondario btn-piccolo" data-kt-azione="cat-riattiva" data-cat="' + esc(c.id) + '">' + ico('ok') + '<span>Riattiva</span></button>'
          : '<button type="button" class="btn btn-secondario btn-piccolo" data-kt-azione="cat-disattiva" data-cat="' + esc(c.id) + '">' + ico('chiudi') + '<span>Disattiva</span></button>') +
        '</div></div>'
    }).join('')
    h += '</div><div class="blocco"><div class="campo" id="campo-kt-cat-nuova"><label for="kt-cat-nuova">Categoria nuova</label>' +
      '<div class="riga-aggiungi"><input id="kt-cat-nuova" type="text" maxlength="60" autocomplete="off" placeholder="Es. Geometri">' +
      '<button type="button" class="btn btn-secondario" data-kt-azione="cat-crea">' + ico('piu') + '<span>Aggiungi categoria</span></button></div></div></div></div>'
    pane.innerHTML = h
    pane.querySelectorAll('[data-cat-nome]').forEach(function (i) {
      i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); rinominaCategoria(i.dataset.catNome) } })
    })
    var cn = el('kt-cat-nuova'); if (cn) cn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); creaCategoria() } })
    APP.rifirma()
  }
  function categoriaDa(id) { return (ST.categorie || []).filter(function (c) { return c.id === id })[0] || null }
  // 0 righe = la RLS ha negato in silenzio: aggiornaDove lo fa diventare un errore.
  async function scriviCategoria(c, campi) {
    var r = await AD.aggiornaDove('rubrica_categorie', function (q) { return q.eq('id', c.id).eq('azienda_id', c.azienda_id) }, campi, 'id,nome,ordine,attiva,azienda_id')
    ST.categorie = ST.categorie.map(function (x) { return x.id === r.id ? r : x })
    return r
  }
  function erroreCategoria(cosa, e) {
    if (e.sessioneAssente) return APP.sessioneScaduta()
    var m = String(e.message || e)
    msgCat('err', '<strong>' + cosa + '</strong> ' + (/row-level|permission denied|0 righe/i.test(m) ? 'il database non ti dà il permesso.' : esc(m)))
  }
  async function rinominaCategoria(id) {
    var c = categoriaDa(id), inp = el('kt-catn-' + id)
    if (!c || !inp || id === 'fornitori') return
    var nuovo = inp.value.trim().replace(/\s+/g, ' ')
    if (!nuovo) { inp.value = c.nome; return msgCat('err', 'Il nome non può essere vuoto.') }
    if (nuovo === c.nome) return msgCat('info', 'Il nome è già «' + esc(nuovo) + '»: niente da salvare.')
    var doppia = ST.categorie.filter(function (x) { return x.id !== id && AC.normale(x.nome) === AC.normale(nuovo) })[0]
    if (doppia) return msgCat('warn', 'C\'è già una categoria che si chiama «' + esc(doppia.nome) + '»' + (doppia.attiva === false ? ' (disattivata)' : '') + ': scegli un nome diverso.')
    var vecchio = c.nome
    try {
      await scriviCategoria(c, { nome: nuovo })
      var n = contaConCategoria(id)
      disegnaElenco(aperto); disegnaCategorie()
      msgCat('ok', 'Rinominata: «' + esc(vecchio) + '» → «' + esc(nuovo) + '». ' + (n ? paroleContatti(n) + ' la mostra' + (n === 1 ? '' : 'no') + ' già col nome nuovo.' : 'Nessun contatto la usa ancora.'))
    } catch (e) { erroreCategoria('Non rinominata:', e) }
  }
  async function attivaCategoria(id, attiva) {
    var c = categoriaDa(id)
    if (!c || id === 'fornitori') return
    try {
      var r = await scriviCategoria(c, { attiva: attiva })
      if (!attiva && ST.filtro === 'cat:' + id) ST.filtro = 'tutti'
      var n = contaConCategoria(id)
      disegnaElenco(aperto); disegnaCategorie()
      msgCat('ok', attiva ? '«' + esc(r.nome) + '» è di nuovo attiva: torna fra i filtri e nelle spunte.'
        : '«' + esc(r.nome) + '» disattivata: non si offre più ai contatti.' + (n ? ' ' + paroleContatti(n) + ' la tiene' + (n === 1 ? '' : 'no') + '.' : ''))
    } catch (e) { erroreCategoria('Non modificata:', e) }
  }

  // ── Archivia / Rimetti / Cancella ─────────────────────────────────────────
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
  function apriCancella(id) {
    var k = perId(id); if (!k) return
    CX.cancella({
      tipo: 'contatto', id: id, nome: nome(k), elenco: '#contatti', utente: ST.utente,
      archivia: k.attivo !== false ? function () { return CX.chiudi().then(function () { return archivia(id, false) }) } : null,
      cosaArchivia: 'non compare più negli elenchi, si trova cercando',
      giaArchiviato: k.attivo === false ? 'È già archiviato: non compare negli elenchi.' : null,
      file: { bucket: BUCKET_FOTO, cartella: id, parole: 'Le foto del contatto' }
    })
  }

  var aperto = null
  function clic(ev) {
    var t = ev.target.closest('[data-apri-contatto],[data-kt-azione],[data-kt-filtro]')
    if (!t) return
    if (t.dataset.apriContatto) { location.hash = '#contatto/' + t.dataset.apriContatto; return }
    if (t.dataset.ktFiltro) { ST.filtro = t.dataset.ktFiltro; disegnaElenco(aperto); return }
    var a = t.dataset.ktAzione
    if (a === 'nuovo') { location.hash = '#nuovo-contatto-rubrica'; return }
    if (a === 'cat-crea') return creaCategoria()
    if (a === 'foto-togli') return fotoTogli()
    if (a === 'salva-comunque') { ST.salvaComunque = true; salva(); return }
    if (a === 'archivia') return archivia(aperto, false)
    if (a === 'riattiva') return archivia(aperto, true)
    if (a === 'cancella') return apriCancella(aperto)
    if (a === 'cat-rinomina') return rinominaCategoria(t.dataset.cat)
    if (a === 'cat-disattiva') return attivaCategoria(t.dataset.cat, false)
    if (a === 'cat-riattiva') return attivaCategoria(t.dataset.cat, true)
  }

  // parti: ['contatti'] | ['contatto', id] | ['contatto', id, 'modifica'|'fornitore'] | ['nuovo-contatto-rubrica', 'fornitore'?]
  async function mostra(parti, utente) {
    ST.utente = utente
    await carica()
    var v = parti[0], id = parti[1] || null
    aperto = v === 'contatto' ? id : null
    document.body.classList.toggle('con-dettaglio', v !== 'contatti')
    disegnaElenco(aperto)
    if (v === 'categorie') {
      ST.form = null
      // si rilegge: qualcun altro può averle cambiate nel frattempo
      try {
        var cr = (await AD.leggi('rubrica_categorie', 'id,nome,ordine,attiva,azienda_id')).sort(function (a, b) { return (a.ordine || 0) - (b.ordine || 0) })
        if (!cr.length) throw new Error('Il database non mi dà nessuna categoria (0 righe): l\'elenco NON è attendibile.')
        ST.categorie = cr; ST.catErrore = null
      } catch (e) { if (e.sessioneAssente) throw e; ST.categorie = null; ST.catErrore = e.message }
      disegnaElenco(aperto)
      return disegnaCategorie()
    }
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
      '<p class="nota">Foto e categorie del contatto si cambiano dentro «Modifica». I nomi delle categorie: «Gestisci categorie».</p></div>'
  }
  function avvia() { el('pane-elenco').addEventListener('click', clic); el('pane-dettaglio').addEventListener('click', clic) }

  return { mostra: mostra, avvia: avvia, svuota: svuota, scarta: scarta, ricarica: function () { ST.caricato = false }, _st: ST, _whatsapp: whatsapp }
})()
