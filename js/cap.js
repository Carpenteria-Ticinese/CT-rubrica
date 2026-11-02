/* Anagrafiche — CAP ↔ località per tutta la Svizzera.
   Elenco ufficiale gratuito di swisstopo (Ortschaftenverzeichnis, «AMTOVZ_CSV_LV95»),
   convertito una volta con prove/converti_cap.js nel file dati/cap_ch.json e SALVATO
   QUI: l'app non lo chiede mai a internet. Se il file manca, i campi funzionano
   lo stesso (si scrive a mano) e sotto il CAP compare una riga che lo dice.
   Solo AIUTO, mai blocco: un CAP straniero o nuovo si salva lo stesso. */
var CAP = (function () {
  'use strict'
  var dati = null, promessa = null, assente = false

  function carica() {
    if (dati || assente) return Promise.resolve(dati)
    if (!promessa) {
      promessa = fetch('dati/cap_ch.json?v=1', { cache: 'force-cache' })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json() })
        .then(function (j) {
          // [[cap, località, cantone], …]
          dati = (j && j.righe) || []
          if (!dati.length) assente = true
          return dati
        })
        .catch(function () { assente = true; return null })
    }
    return promessa
  }
  function normale(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() }
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

  // Collega due campi: CAP e località (+ una riga di aiuto, facoltativa).
  // Paese: se c'è un campo paese e non è CH, l'aiuto si spegne.
  function collega(idCap, idLoc, idAiuto, idPaese) {
    var c = document.getElementById(idCap), l = document.getElementById(idLoc)
    if (!c || !l) return
    var aiuto = idAiuto ? document.getElementById(idAiuto) : null
    var listaL = document.getElementById(l.getAttribute('list') || '') || null
    var listaC = document.getElementById(c.getAttribute('list') || '') || null
    function svizzera() { var p = idPaese && document.getElementById(idPaese); return !p || !p.value || p.value === 'CH' }
    function scrivi(t) { if (aiuto) aiuto.textContent = t || '' }
    function opzioni(lista, valori) {
      if (!lista) return
      lista.innerHTML = valori.map(function (v) { return '<option value="' + AC.esc(v) + '">' }).join('')
    }
    function suCap() {
      if (!svizzera()) { scrivi(''); opzioni(listaL, []); return }
      carica().then(function () {
        if (assente) { scrivi('Elenco dei CAP non presente: scrivi la località a mano.'); return }
        var r = perCap(c.value)
        opzioni(listaL, r.map(function (x) { return x[1] }))
        if (String(c.value).replace(/\D/g, '').length !== 4) { scrivi(''); return }
        if (!r.length) { scrivi('CAP non trovato nell\'elenco svizzero: controllalo (si salva lo stesso).'); return }
        if (r.length === 1 && !l.value.trim()) { l.value = r[0][1]; scrivi('Località messa dal CAP: ' + r[0][1] + ' (' + r[0][2] + ').') }
        else if (r.length > 1) scrivi('Questo CAP ha ' + r.length + ' località: ' + r.map(function (x) { return x[1] }).join(', ') + '.')
        else if (normale(l.value) !== normale(r[0][1])) scrivi('Con il CAP ' + r[0][0] + ' l\'elenco dice «' + r[0][1] + '».')
        else scrivi('')
      })
    }
    function suLoc() {
      if (!svizzera()) return
      carica().then(function () {
        if (assente) return
        var r = perLocalita(l.value)
        opzioni(listaL, r.map(function (x) { return x[1] }))
        var esatta = dati.filter(function (x) { return normale(x[1]) === normale(l.value) })
        opzioni(listaC, esatta.map(function (x) { return x[0] }))
        if (esatta.length && !c.value.trim()) {
          var capi = esatta.map(function (x) { return x[0] }).filter(function (v, i, a) { return a.indexOf(v) === i })
          if (capi.length === 1) { c.value = capi[0]; scrivi('CAP messo dalla località: ' + capi[0] + '.') }
          else scrivi(l.value + ' ha più CAP: ' + capi.join(', ') + '.')
        }
      })
    }
    c.addEventListener('input', suCap)
    l.addEventListener('input', suLoc)
    l.addEventListener('change', suLoc)
    if (c.value) suCap()
  }

  return { collega: collega, carica: carica, perCap: perCap, perLocalita: perLocalita, _normale: normale }
})()
