/* ═══════════════════════════════════════════════════════════════════════════
   Anagrafiche — ACCESSO AI DATI (Supabase)

   LA TRAPPOLA (già pagata in altre app): con le regole del database (RLS) un
   accesso negato NON dà errore, restituisce zero righe in silenzio. Quindi:
   - ogni lettura e ogni scrittura controlla PRIMA che la sessione ci sia; senza
     sessione si lancia SessioneAssente e l'app torna al login, mai un elenco
     vuoto che sembra «tutto a posto»;
   - ogni scrittura chiede indietro le righe (.select()): zero righe = NON salvato;
   - chi entra lo decide app_ruolo() (tabella profili): solo titolare e
     responsabile. tm_utenti non si legge più.
   Stesso schema del Pianificatore (js/dati.js).
   ═══════════════════════════════════════════════════════════════════════════ */
var AD = (function () {
  'use strict'
  var sb = window.supabase.createClient(ANAG_CONFIG.SUPABASE_URL, ANAG_CONFIG.SUPABASE_KEY)

  function SessioneAssente(msg) {
    var e = new Error(msg || 'Sessione scaduta: entra di nuovo.')
    e.sessioneAssente = true
    return e
  }
  function errore(cosa, e) {
    var m = (e && (e.message || e.details || e.hint)) || String(e)
    var x = new Error(cosa + ': ' + m)
    x.originale = e
    x.codice = e && e.code
    // 23503 = rifiuto per dati collegati: il messaggio contiene numeri («giornate (401)»), non è una sessione scaduta.
    if (e && e.code !== '23503' && /JWT|token|not authenticated|401/i.test(m)) x.sessioneAssente = true
    return x
  }

  async function sessione() {
    try { return (await sb.auth.getSession()).data.session || null } catch (_) { return null }
  }
  async function richiediSessione() {
    var s = await sessione()
    if (!s || !s.user) throw SessioneAssente()
    return s
  }

  async function entra(email, password) {
    var r = await sb.auth.signInWithPassword({ email: email, password: password })
    if (r.error) throw errore('Accesso non riuscito', r.error)
    return r.data.session
  }
  // Riconferma della password (v7, prima di cancellare): stesso login, stessa email della sessione.
  // true = giusta · false = sbagliata (la sessione resta quella di prima) · eccezione = non si è potuto controllare.
  // La password passa solo da qui: non si salva, non si scrive nei messaggi, chi chiama svuota il campo.
  async function verificaPassword(password) {
    var s = await richiediSessione()
    var r = await sb.auth.signInWithPassword({ email: s.user.email, password: password })
    if (r.error) {
      var m = String(r.error.message || '')
      if (/invalid login|invalid_credentials/i.test(m) || r.error.code === 'invalid_credentials') return false
      if (r.error.status === 429 || /rate limit|too many/i.test(m)) throw new Error('troppi tentativi: aspetta qualche minuto e riprova.')
      throw new Error('non riesco a controllare la password (' + m + ').')
    }
    var u = r.data && (r.data.user || (r.data.session && r.data.session.user))
    if (!u || u.id !== s.user.id) throw new Error('il controllo della password ha risposto con un altro utente: esci e rientra.')
    return true
  }
  async function esci() { try { await sb.auth.signOut({ scope: 'local' }) } catch (_) { /* si esce comunque */ } }

  // Il ruolo dal database (profili, via app_ruolo). Senza profilo app_ruolo dice
  // «operaio»: per Anagrafiche vuol dire «non entri». Mai «entra lo stesso».
  async function ruolo() {
    var s = await richiediSessione()
    var r = await sb.rpc('app_ruolo')
    if (r.error) throw errore('Non riesco a sapere chi sei', r.error)
    return { ruolo: r.data || null, email: s.user.email || '', id: s.user.id }
  }

  // Lettura completa, a pagine da 1000 righe (il limite di Supabase)
  async function leggi(tabella, colonne, filtro) {
    await richiediSessione()
    var tutte = [], da = 0, PAG = 1000
    for (;;) {
      var q = sb.from(tabella).select(colonne || '*')
      if (filtro) q = filtro(q)
      var r = await q.range(da, da + PAG - 1)
      if (r.error) throw errore('Lettura ' + tabella, r.error)
      tutte = tutte.concat(r.data || [])
      if (!r.data || r.data.length < PAG) break
      da += PAG
    }
    return tutte
  }

  // Quante righe (senza leggerle). Errore = eccezione, mai «0».
  async function conta(tabella, filtro, colonna) {
    await richiediSessione()
    var q = sb.from(tabella).select(colonna || 'id', { count: 'exact', head: true })
    if (filtro) q = filtro(q)
    var r = await q
    if (r.error) throw errore('Conteggio ' + tabella, r.error)
    if (typeof r.count !== 'number') throw new Error('Conteggio ' + tabella + ': il database non ha risposto con un numero.')
    return r.count
  }

  async function inserisci(tabella, riga, colonne) {
    await richiediSessione()
    var r = await sb.from(tabella).insert(riga).select(colonne || '*')
    if (r.error) throw errore('Salvataggio ' + tabella, r.error)
    if (!r.data || r.data.length !== 1) {
      throw new Error('Salvataggio NON riuscito: il database ha salvato ' + ((r.data && r.data.length) || 0) + ' righe invece di 1. Esci, rientra e riprova.')
    }
    return r.data[0]
  }

  async function aggiorna(tabella, id, campi, colonne) {
    await richiediSessione()
    var r = await sb.from(tabella).update(campi).eq('id', id).select(colonne || '*')
    if (r.error) throw errore('Modifica ' + tabella, r.error)
    if (!r.data || r.data.length !== 1) throw new Error('Modifica NON salvata dal database (0 righe). Esci, rientra e riprova.')
    return r.data[0]
  }

  // Una colonna che non c'è ancora (SQL non applicato) dà l'errore 42703:
  // chi legge può riprovare con meno colonne e dirlo a schermo.
  function colonnaMancante(e) {
    var o = (e && e.originale) || e || {}
    return o.code === '42703' || /column .* does not exist|could not find the .* column/i.test(String(o.message || e && e.message || ''))
  }

  // Lettura con colonne «nuove»: se mancano, riprova con quelle di prima e lo segna.
  async function leggiConRiserva(tabella, colonne, colonneVecchie, filtro) {
    try { return { righe: await leggi(tabella, colonne, filtro), complete: true } } catch (e) {
      if (!colonnaMancante(e) || !colonneVecchie) throw e
      return { righe: await leggi(tabella, colonneVecchie, filtro), complete: false }
    }
  }

  async function aggiornaDove(tabella, filtro, campi, colonne) {
    await richiediSessione()
    var r = await filtro(sb.from(tabella).update(campi)).select(colonne || '*')
    if (r.error) throw errore('Modifica ' + tabella, r.error)
    if (!r.data || r.data.length !== 1) throw new Error('Modifica NON salvata dal database (' + ((r.data && r.data.length) || 0) + ' righe). Esci, rientra e riprova.')
    return r.data[0]
  }

  async function upsert(tabella, riga, conflitto, colonne) {
    await richiediSessione()
    var r = await sb.from(tabella).upsert(riga, { onConflict: conflitto }).select(colonne || '*')
    if (r.error) throw errore('Salvataggio ' + tabella, r.error)
    if (!r.data || r.data.length !== 1) throw new Error('Salvataggio NON riuscito (' + ((r.data && r.data.length) || 0) + ' righe). Esci, rientra e riprova.')
    return r.data[0]
  }

  // Cancellare: contatti d'emergenza, documenti (titolare) e, passando da js/cancella.js, persone, commesse, contatti (titolare).
  // 0 righe = non cancellato (la RLS nega in silenzio): mai un successo finto.
  async function cancella(tabella, id) {
    await richiediSessione()
    var r = await sb.from(tabella).delete().eq('id', id).select('id')
    if (r.error) throw errore('Cancellazione ' + tabella, r.error)
    if (!r.data || r.data.length !== 1) throw new Error('NON tolto: il database non ti dà il permesso (0 righe).')
    return true
  }

  async function rpc(nome, args) {
    await richiediSessione()
    var r = await sb.rpc(nome, args || {})
    if (r.error) throw errore(nome, r.error)
    return r.data
  }

  // Funzioni lato server (crea-collaboratore, gestisci-accesso, cambia-ruolo).
  // Il messaggio utile sta nel corpo della risposta, non in error.message.
  var NON_RAGGIUNGIBILE = 'non raggiungibile: è installata su Supabase?'
  async function funzione(nome, corpo) {
    await richiediSessione()
    var r
    try { r = await sb.functions.invoke(nome, { body: corpo }) } catch (e) { throw new Error('Funzione ' + nome + ' ' + NON_RAGGIUNGIBILE + ' (' + e.message + ')') }
    if (r.error) {
      var j = null
      try { j = r.error.context && r.error.context.json ? await r.error.context.json() : null } catch (_) { j = null }
      var x = new Error((j && (j.error || j.message)) || (/Failed to send|FunctionsFetchError|FunctionsRelayError/i.test(r.error.name + ' ' + r.error.message) ? 'Funzione ' + nome + ' ' + NON_RAGGIUNGIBILE : r.error.message))
      x.stato = r.error.context && r.error.context.status
      x.codice = j && j.codice
      throw x
    }
    if (r.data && r.data.error) { var y = new Error(r.data.error); y.codice = r.data.codice; throw y }
    return r.data || {}
  }

  async function caricaFile(bucket, percorso, file) {
    await richiediSessione()
    var r = await sb.storage.from(bucket).upload(percorso, file, { upsert: false, contentType: file.type || 'application/octet-stream' })
    if (r.error) throw errore('Caricamento del file', r.error)
    return percorso
  }
  async function linkFirmato(bucket, percorso, secondi) {
    await richiediSessione()
    var r = await sb.storage.from(bucket).createSignedUrl(percorso, secondi || 300)
    if (r.error) throw errore('Apertura del file', r.error)
    return r.data.signedUrl
  }
  async function togliFile(bucket, percorso) {
    try { await sb.storage.from(bucket).remove([percorso]) } catch (_) { /* resta un file senza riga: non è un danno */ }
  }
  // Tutti i file di una cartella (per es. le foto di un contatto cancellato). Non lancia mai: dice com'è andata.
  // Il database può negare in silenzio (0 tolti senza errore): per questo si contano.
  async function togliCartella(bucket, cartella) {
    try {
      var r = await sb.storage.from(bucket).list(cartella, { limit: 1000 })
      if (r && r.error) return { file: 0, tolti: 0, errore: r.error.message || 'lettura non riuscita' }
      var p = ((r && r.data) || []).map(function (f) { return cartella + '/' + f.name })
      if (!p.length) return { file: 0, tolti: 0 }
      var x = await sb.storage.from(bucket).remove(p)
      if (x && x.error) return { file: p.length, tolti: 0, errore: x.error.message || 'non tolti' }
      return { file: p.length, tolti: ((x && x.data) || []).length }
    } catch (e) { return { file: 0, tolti: 0, errore: e.message } }
  }

  return {
    sb: sb, sessione: sessione, richiediSessione: richiediSessione, entra: entra, esci: esci, ruolo: ruolo, verificaPassword: verificaPassword,
    leggi: leggi, conta: conta, inserisci: inserisci, aggiorna: aggiorna,
    colonnaMancante: colonnaMancante, leggiConRiserva: leggiConRiserva, aggiornaDove: aggiornaDove, upsert: upsert,
    cancella: cancella, rpc: rpc, funzione: funzione, caricaFile: caricaFile, linkFirmato: linkFirmato, togliFile: togliFile, togliCartella: togliCartella
  }
})()
