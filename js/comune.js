/* Anagrafiche — Carpenteria Ticinese | Cose comuni a tutte le sezioni
   Testo sicuro (esc), icone sempre con la loro scritta, paesi, date, avvisi. */
var AC = (function () {
  'use strict'

  // Tutto quello che arriva dal database passa da qui prima di finire in pagina.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }
  function el(id) { return document.getElementById(id) }

  // Icone (tratto semplice, 24×24). Si usano SEMPRE insieme a una scritta.
  var ICONE = {
    commesse:  '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>',
    persone:   '<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 12 0v1"/><path d="M16 4a4 4 0 0 1 0 8"/><path d="M22 21v-1a6 6 0 0 0-4-5.6"/>',
    contatti:  '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17a4 4 0 0 1 8 0"/>',
    cerca:     '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    piu:       '<path d="M12 5v14"/><path d="M5 12h14"/>',
    indietro:  '<path d="m15 18-6-6 6-6"/>',
    modifica:  '<path d="M21.2 6.8a1 1 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"/>',
    salva:     '<path d="M20 6 9 17l-5-5"/>',
    chiudi:    '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    telefono:  '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    email:     '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    lucchetto: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    attenzione:'<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    ok:        '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    errore:    '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    info:      '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    esci:      '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    interni:   '<path d="M3 9h18v12H3z"/><path d="M3 9l3-6h12l3 6"/><path d="M10 13h4"/>',
    cliente:   '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    ditta:     '<path d="M3 21h18"/><path d="M5 21V10l5-3v3l5-3v3l4-2v13"/><path d="M9 17h2"/><path d="M14 17h2"/>',
    documento: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
    chiave:    '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
    emergenza: '<path d="M12 21s-7-4.4-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.6-9.5 9-9.5 9z"/><path d="M12 10v4"/><path d="M10 12h4"/>',
    apri:      '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    foto:      '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    togli:     '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 15h10l1-15"/>'
  }
  function ico(nome) {
    return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" ' +
           'stroke-linecap="round" stroke-linejoin="round">' + (ICONE[nome] || '') + '</svg>'
  }

  // Avvisi in pagina: tipo ok | warn | err | info. Il testo è già HTML sicuro.
  function avviso(tipo, html) {
    var icona = { ok: 'ok', warn: 'attenzione', err: 'errore', info: 'info' }[tipo] || 'info'
    return '<div class="avviso avviso-' + tipo + '" role="' + (tipo === 'err' ? 'alert' : 'status') + '">' +
           ico(icona) + '<div>' + html + '</div></div>'
  }

  // ── Paesi (stesso elenco della Rubrica e di Pre-contabilità) ──────────────
  var PAESE_PREDEFINITO = 'CH'
  var PAESI_FREQUENTI = [
    { c: 'CH', n: 'Svizzera' }, { c: 'IT', n: 'Italia' }, { c: 'DE', n: 'Germania' },
    { c: 'FR', n: 'Francia' }, { c: 'AT', n: 'Austria' }, { c: 'LI', n: 'Liechtenstein' }
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
  function tuttiPaesi() { return PAESI_FREQUENTI.concat(PAESI_ALTRI) }
  function nomePaese(codice) {
    var c = String(codice == null ? '' : codice).trim().toUpperCase()
    var t = tuttiPaesi().filter(function (p) { return p.c === c })[0]
    return t ? t.n : ''
  }
  // Un codice vecchio che non sta in elenco non si cambia di nascosto: compare come «da correggere».
  function opzioniPaese(selezionato) {
    var sel = String(selezionato == null ? '' : selezionato).trim().toUpperCase() || PAESE_PREDEFINITO
    function voce(p) { return '<option value="' + esc(p.c) + '"' + (p.c === sel ? ' selected' : '') + '>' + esc(p.n) + '</option>' }
    var out = '<optgroup label="Più usati">' + PAESI_FREQUENTI.map(voce).join('') + '</optgroup>' +
              '<optgroup label="Tutti gli altri">' + PAESI_ALTRI.map(voce).join('') + '</optgroup>'
    if (!nomePaese(sel)) out += '<optgroup label="Da correggere"><option value="' + esc(sel) + '" selected>«' + esc(sel) + '» non è un paese valido: scegline uno</option></optgroup>'
    return out
  }

  // ── Date ───────────────────────────────────────────────────────────────────
  function data(iso) {
    if (!iso) return '—'
    var s = String(iso).slice(0, 10).split('-')
    return s.length === 3 ? s[2] + '.' + s[1] + '.' + s[0] : String(iso)
  }

  // ── Nomi ───────────────────────────────────────────────────────────────────
  // Il nome di un contatto della Rubrica: ragione sociale, altrimenti nome e cognome.
  function nomeContatto(k) {
    if (!k) return ''
    return (k.ragione_sociale && String(k.ragione_sociale).trim()) ||
           [k.nome, k.cognome].filter(Boolean).join(' ').trim() || '(senza nome)'
  }
  // Per confronti «somiglia a»: minuscole, senza accenti, senza punteggiatura.
  function normale(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim()
  }

  // Oggi, nel fuso del PC (non UTC): «2026-11-02»
  function oggiIso() {
    var d = new Date()
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  // Giorni da oggi a una data (negativo = passata). Solo date «AAAA-MM-GG».
  function giorniDaOggi(iso, oggi) {
    if (!iso) return null
    var a = Date.UTC.apply(null, String(oggi || oggiIso()).split('-').map(function (x, i) { return i === 1 ? x - 1 : +x }))
    var b = Date.UTC.apply(null, String(iso).slice(0, 10).split('-').map(function (x, i) { return i === 1 ? x - 1 : +x }))
    return Math.round((b - a) / 86400000)
  }
  // Scadenza di un documento o di un permesso: stessa regola dell'App Cantieri
  // (scaduto = rosso, entro 30 giorni = arancione). Sempre con la scritta.
  function scadenza(iso, oggi) {
    var g = giorniDaOggi(iso, oggi)
    if (g == null) return { stato: 'nessuna', testo: 'senza scadenza' }
    if (g < 0) return { stato: 'scaduto', testo: 'Scaduto il ' + data(iso) }
    if (g === 0) return { stato: 'presto', testo: 'Scade oggi' }
    if (g <= 30) return { stato: 'presto', testo: 'Scade fra ' + g + (g === 1 ? ' giorno' : ' giorni') + ' (' + data(iso) + ')' }
    return { stato: 'ok', testo: 'Scade il ' + data(iso) }
  }

  // In Archivio = tolta con attivo = false, o fine rapporto già passata. Oggi è l'ultimo giorno: non è ancora in Archivio.
  function inArchivio(o, oggi) { return !!o && (o.attivo === false || (!!o.data_fine_rapporto && o.data_fine_rapporto < (oggi || oggiIso()))) }

  function telLink(n, scritta) {
    var t = String(n || '').replace(/[^\d+]/g, '')
    return t ? '<a class="btn btn-secondario btn-piccolo" href="tel:' + esc(t) + '">' + ico('telefono') + '<span>' + esc(scritta || 'Chiama') + '</span></a>' : ''
  }

  // «È un fornitore?»: la risposta unica è e_fornitore (ANAG_F2_04). Finché quel
  // SQL non è applicato valgono anche i due modi vecchi (come fa il Radar).
  function eFornitore(k) {
    if (!k) return false
    return k.e_fornitore === true || k.categoria === 'fornitore' ||
           (Array.isArray(k.categorie) && k.categorie.indexOf('fornitori') >= 0)
  }

  return {
    esc: esc, el: el, ico: ico, avviso: avviso,
    opzioniPaese: opzioniPaese, nomePaese: nomePaese, PAESE_PREDEFINITO: PAESE_PREDEFINITO,
    data: data, nomeContatto: nomeContatto, normale: normale,
    oggiIso: oggiIso, giorniDaOggi: giorniDaOggi, inArchivio: inArchivio, scadenza: scadenza, telLink: telLink, eFornitore: eFornitore
  }
})()
