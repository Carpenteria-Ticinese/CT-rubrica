/* Anagrafiche — NPA ↔ località per tutta la Svizzera (a schermo si dice «NPA», mai «CAP»; nel database la colonna resta «cap»).
   Elenco ufficiale gratuito di swisstopo (Ortschaftenverzeichnis, «AMTOVZ_CSV_LV95», località con il loro NPA),
   convertito una volta con prove/converti_cap.js nel file dati/cap_ch.json (creato il 2.11.2026) e SALVATO
   QUI: l'app non lo chiede mai a internet. Se il file manca, i campi funzionano
   lo stesso (si scrive a mano) e sotto l'NPA compare una riga che lo dice.
   Solo AIUTO, mai blocco: un NPA straniero o nuovo si salva lo stesso.
   11.3 (Umberto 9.11.2026): nei due sensi. NPA → località, località → NPA. Se ce n'è più d'uno: una lista di tasti
   da toccare. Da solo riempie SOLO un campo vuoto: quello che uno ha scritto non si sovrascrive mai. */
var CAP = (function () {
  'use strict'
  var dati = null, promessa = null, assente = false

  function carica() {
    if (dati || assente) return Promise.resolve(dati)
    if (!promessa) {
      promessa = fetch('dati/cap_ch.json?v=1', { cache: 'force-cache' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json() })
        .then(function (j) {
          // [[npa, località, cantone], …]
          dati = (j && j.righe) || []
          if (!dati.length) assente = true
          return dati
        })
        .catch(function () { assente = true; return null })
    }
    return promessa
  }
  function normale(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() }
  function unici(a) { return a.filter(function (v, i) { return a.indexOf(v) === i }) }
  function perCap(cap) {
    var c = String(cap || '').replace(/\D/g, '')
    if (!dati || c.length !== 4) return []
    var visti = {}
    return dati.filter(function (r) { var k = r[1]; if (r[0] !== c || visti[k]) return false; visti[k] = true; return true })
  }
  function perLocalita(testo) {
    var t = normale(testo)
    if (!dati || t.length < 2) return []
    return dati.filter(function (r) { return normale(r[1]).indexOf(t) === 0 }).slice(0, 15)
  }
  function npaDiLocalita(testo) {
    var t = normale(testo)
    if (!dati || !t) return []
    return unici(dati.filter(function (x) { return normale(x[1]) === t }).map(function (x) { return x[0] }))
  }

  // Collega due campi: NPA e località (+ la riga di aiuto, dove compaiono anche i tasti da scegliere).
  // Paese: se c'è un campo paese e non è CH, l'aiuto si spegne.
  function collega(idCap, idLoc, idAiuto, idPaese) {
    var c = document.getElementById(idCap), l = document.getElementById(idLoc)
    if (!c || !l || c.dataset.npaCollegato) return
    c.dataset.npaCollegato = '1'
    var aiuto = idAiuto ? document.getElementById(idAiuto) : null
    var listaL = document.getElementById(l.getAttribute('list') || '') || null
    var listaC = document.getElementById(c.getAttribute('list') || '') || null
    function svizzera() { var p = idPaese && document.getElementById(idPaese); return !p || !p.value || p.value === 'CH' }
    // testo semplice + eventuali tasti: [{ etichetta, campo, valore }]
    function scrivi(testo, scelte) {
      if (!aiuto) return
      aiuto.innerHTML = (testo ? '<span>' + AC.esc(testo) + '</span>' : '') +
        (scelte && scelte.length ? '<span class="npa-scelte">' + scelte.map(function (s, i) {
          return '<button type="button" class="btn btn-secondario btn-piccolo npa-scelta" data-i="' + i + '">' + AC.esc(s.etichetta) + '</button>'
        }).join('') + '</span>' : '')
      if (scelte) aiuto.querySelectorAll('.npa-scelta').forEach(function (b) {
        b.addEventListener('click', function () {
          var s = scelte[+b.dataset.i], campo = s.campo === 'npa' ? c : l
          campo.value = s.valore   // toccato a mano: è una scelta, non una sovrascrittura automatica
          campo.dispatchEvent(new Event('input', { bubbles: true }))
          campo.dispatchEvent(new Event('change', { bubbles: true }))
          campo.focus()
        })
      })
    }
    function opzioni(lista, valori) {
      if (!lista) return
      lista.innerHTML = valori.map(function (v) { return '<option value="' + AC.esc(v) + '">' }).join('')
    }
    // iniziale = all'apertura del modulo: si mostra solo l'aiuto, non si riempie niente (aprire non è cambiare).
    function suCap(iniziale) {
      if (!svizzera()) { scrivi(''); opzioni(listaL, []); return }
      carica().then(function () {
        if (assente) { scrivi('Elenco degli NPA non presente: scrivi la località a mano.'); return }
        var r = perCap(c.value)
        opzioni(listaL, r.map(function (x) { return x[1] }))
        if (String(c.value).replace(/\D/g, '').length !== 4) { scrivi(''); return }
        if (!r.length) { scrivi('NPA non trovato nell\'elenco svizzero: controllalo (si salva lo stesso).'); return }
        var loc = l.value.trim()
        if (!loc && r.length === 1 && iniziale !== true) { l.value = r[0][1]; scrivi('Località messa dall\'NPA: ' + r[0][1] + ' (' + r[0][2] + ').'); return }
        if (!loc) { scrivi(r.length === 1 ? 'Con l\'NPA ' + r[0][0] + ' l\'elenco dice:' : 'L\'NPA ' + r[0][0] + ' ha ' + r.length + ' località. Tocca quella giusta:', r.map(function (x) { return { etichetta: x[1], campo: 'loc', valore: x[1] } })); return }
        if (r.some(function (x) { return normale(x[1]) === normale(loc) })) { scrivi(''); return }
        // Scritta a mano e diversa: si lascia com'è, si dice cosa dice l'elenco.
        scrivi('Con l\'NPA ' + r[0][0] + ' l\'elenco dice:', r.map(function (x) { return { etichetta: x[1], campo: 'loc', valore: x[1] } }))
      })
    }
    function suLoc(iniziale) {
      if (!svizzera()) return
      carica().then(function () {
        if (assente) return
        opzioni(listaL, perLocalita(l.value).map(function (x) { return x[1] }))
        var npa = npaDiLocalita(l.value)
        opzioni(listaC, npa)
        if (!npa.length) return
        var scritto = String(c.value).replace(/\D/g, '')
        if (!scritto && npa.length === 1 && iniziale !== true) { c.value = npa[0]; scrivi('NPA messo dalla località: ' + npa[0] + '.'); return }
        if (!scritto) { scrivi(npa.length === 1 ? 'Per ' + l.value.trim() + ' l\'elenco dice:' : l.value.trim() + ' ha ' + npa.length + ' NPA. Tocca quello giusto:', npa.map(function (v) { return { etichetta: v, campo: 'npa', valore: v } })); return }
        if (npa.indexOf(scritto) >= 0) { scrivi(''); return }
        if (scritto.length === 4) scrivi('Per ' + l.value.trim() + ' l\'elenco dice:', npa.map(function (v) { return { etichetta: v, campo: 'npa', valore: v } }))
      })
    }
    c.addEventListener('input', function () { suCap() })
    l.addEventListener('input', function () { suLoc() })
    l.addEventListener('change', function () { suLoc() })
    if (idPaese && document.getElementById(idPaese)) document.getElementById(idPaese).addEventListener('change', function () { if (c.value) suCap(); else if (l.value) suLoc() })
    if (c.value) suCap(true)
    else if (l.value) suLoc(true)
  }

  return { collega: collega, carica: carica, perCap: perCap, perLocalita: perLocalita, npaDiLocalita: npaDiLocalita, _normale: normale }
})()
