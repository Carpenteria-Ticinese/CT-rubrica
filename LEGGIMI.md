# Anagrafiche — leggimi

App unica per **Commesse**, **Persone** (con gli accessi) e **Contatti** di Carpenteria Ticinese Sagl.
Prenderà il posto della Rubrica, **allo stesso indirizzo** (`carpenteria-ticinese.github.io/CT-rubrica/`):
la card dell'Hub non si tocca. HTML/JS semplice + Supabase (stesso progetto delle altre app).

**Stato (3.11.2026): versione 5 online (CT-rubrica `2114c54`); versione 6 pronta in locale** (Contatti: foto e categorie anche qui, la Rubrica di riserva serve solo per rinominare/disattivare categorie).

v5: identità (nome Anagrafiche, viola `#6a3fa0`, icone, manifest), Invio = Entra, tasto Indietro.

**v5 — Tasto Indietro** (`js/app.js`): ogni schermata = una voce nella storia (`history.state.n`). Finestre e conferme (togli contatto d'emergenza, togli documento, elimina contatto) aprono un «livello» (`APP.livello`): Indietro le chiude senza cambiare schermata. Modulo con dati non salvati: Indietro, un clic su un altro elemento o «Esci» chiedono «Resta qui» / «Esci senza salvare»; dopo un salvataggio o col tasto Annulla (`data-libera`, `APP.libera()`) non chiedono. Prove: `prove/test_indietro.js` (TEST_INDIETRO). Nota per le prove: Chrome salta le voci di storia create senza un clic vero, quindi prima di provare Indietro serve un clic sulla pagina.
Disegno e regole: `..\Anagrafiche - ricognizione\FASE2_DISEGNO.md`. Dove siamo: `STATO.md`.

## È l'unica app che scrive
`operai`, `operai_dati_personali`, `operai_contatti_emergenza`, `documenti_operai` (con l'App Cantieri, che
scrive documenti senza file), `cantieri` (`stato_commessa`, `numero_commessa`, `tipo`, `cliente_id`,
`codice_interno`, nome e indirizzo), `tm_contatti`. Tabella sua (v3): `anag_blocchi_fine_rapporto` (la scrive solo
il database, l'app la legge). Gli accessi (`profili`, account) passano dalle funzioni
lato server `crea-collaboratore`, `gestisci-accesso`, `cambia-ruolo` (dell'App Cantieri) e da `anag_collega_account`.
**Non scrive mai** `cantieri.stato` dopo la creazione (è dell'App Cantieri) e non legge né scrive paghe (`tm_paghe_*`).

## Chi entra
Solo chi ha ruolo **titolare** o **responsabile** in `profili` (funzione `app_ruolo()`).
`tm_utenti` non si legge più. Gli altri vedono «Anagrafiche è per il titolare e il responsabile».
Contabilità: oggi solo il titolare, in nessun punto di Anagrafiche si apre ad altri.

## Commesse (tabella `cantieri`)
- Elenco con ricerca e filtri per stato (anche «Senza stato»); sezione **Interni** a parte.
- `stato_commessa` si sceglie anche sulle commesse vecchie che non ce l'hanno (il Calendario lo legge).
- Il **numero** lo dà il database (trigger). **Due padroni**: alla creazione `stato = 'Completato'`, poi mai più.
- Interni riconosciuti da `tipo` e `codice_interno` (`magazzino`, `ditta`), **mai dal nome**.
  L'interno `ditta` si mostra «Lavori per la ditta» (SQL ANAG_F2_05 cambia anche il nome nel database).
- Il nome si blocca se ci sono foto. **Nessun tasto Elimina.**

## Persone (tabella `operai`)
- **Rapporto**: «Dipendente» (busta paga) o «Esterno» (lavora con la sua ditta, paghiamo la fattura) → `operai.rapporto`.
  - Esterno: la **ditta** si sceglie dall'elenco dei contatti fornitori (o «Nuova ditta fornitore», che va nei
    Contatti) → `operai.ditta_id`. Niente paga, **niente accesso** (il database impedisce `user_id` su un Esterno).
  - `agenzia`/`nome_agenzia` (interinali) sono un'altra cosa: solo per i Dipendenti, non si toccano per gli Esterni.
- Elenco: Dipendenti · Esterni (con la ditta) · «chi non lavora più con noi» (fine rapporto passata, chiuso).
- Scheda: dati, **Accesso** (Dai accesso / Blocca / Sblocca / Nuova password / Cambia email / Cambia ruolo solo titolare),
  **Dati personali** («Niente dati sanitari»), **Contatti d'emergenza** (con «Chiama»), **Documenti** (scadenze rosse/arancioni,
  file nel bucket privato `tm-documenti`, percorso `<id persona>/<ora>-<nome>`, link firmato 5 minuti; toglie solo il titolare).
- «Dai accesso»: salva l'email nella scheda → `anag_collega_account` → solo se serve `crea-collaboratore` → di nuovo
  `anag_collega_account`. Mai un secondo account, anche se interrotto. Password scelta da chi crea (min. 8), mostrata una volta.
- `attivo` non si scrive a mano. Nessun tasto «Elimina persona» (dal 3.11 il database non lo permette: DIR_01).
- **Fine rapporto = ultimo giorno di lavoro** (v3). Dal giorno dopo l'accesso si blocca **da solo** (SQL ANAG_F2_07:
  trigger su `operai` = subito se la data è già passata; job pg_cron `anag-blocco-fine-rapporto` ogni ora al minuto 7,
  ora svizzera). Stesso blocco di «Blocca accesso» (`auth.users.banned_until` + sessioni chiuse). **Titolari mai da soli.**
  Ogni blocco è scritto in `anag_blocchi_fine_rapporto` (una volta per account e data): dopo «Sblocca accesso» a mano
  il database non riblocca per la stessa data. Data tolta o spostata in avanti dopo il blocco: resta bloccato; la scheda
  mostra «Accesso bloccato ma data spostata: sbloccare?» con il tasto «Sblocca accesso» (mai sbloccato da solo).
  L'app avvisa e chiede conferma per la fine rapporto sulla **propria** scheda e per una data **già passata** di chi ha
  l'accesso. Senza SQL 07 l'app lo dice e manda a «Blocca accesso».
- Esterni senza account anche lato server: SQL ANAG_F2_08 (trigger su `profili`): `crea-collaboratore` con l'email di
  un Esterno non riesce a scrivere il profilo e annulla da sola l'account appena creato.

## Contatti (tabella `tm_contatti`)
- **Gruppo predefinito (Pre-contabilità)** (v4): `tm_contatti.gruppo_default`, scelta da elenco `tm_conta_gruppi` (codice · nome; i
  disattivati non si offrono, ma quello già scritto resta). Vuoto ammesso (= NULL). Si scrive solo se cambia; se l'elenco non si
  legge (o un gruppo proprio non è visibile al responsabile) il campo non si tocca. La Pre-contabilità non lo scrive più.
- Elenco a lettere con «Chiama», ricerca, filtri Tutti / Fornitori / Clienti / Archiviati / categorie della Rubrica.
- **Fornitore in un solo modo**: il tasto «Fornitore» = `e_fornitore` (SQL ANAG_F2_04 allinea anche `categoria` e `categorie`).
- Archiviati: fuori dagli elenchi, si trovano cercando, «Rimetti fra gli attivi». «Elimina» solo titolare; se collegato
  (commessa, Esterno, Pre-contabilità, Radar) il database rifiuta e si propone «Archivia».
- Indirizzi `#contatto/<id>/fornitore` e `#nuovo-contatto-rubrica/fornitore`: per il tasto «Diventa fornitore» del Radar.
- **Foto del contatto** (v6, nessun SQL nuovo): nel modulo «Modifica»/«Nuovo contatto», blocco «Foto» con «Scegli foto» e «Togli foto».
  Bucket privato `rubrica-foto`, percorso `<id contatto>/<ora>.<est>`, in `tm_contatti.foto_url` solo il percorso (si capiscono anche
  i vecchi URL). La foto si riduce a 800 px (JPEG) e si carica **dopo** il salvataggio del contatto (per un contatto nuovo l'id c'è solo
  dopo); se la foto non va, il contatto è salvato lo stesso e la scheda lo dice. Foto cambiata o tolta = il file vecchio si toglie dal
  bucket. Contatto eliminato = anche le sue foto (best-effort). Si vede con link firmato di 1 ora (rinnovato dopo 40 minuti).
  Scrivere nel bucket: policy `anag_rubrica_foto_carica` / `_cancella` (titolare e responsabile, contatto della propria ditta).
- **Categorie** (v6, nessun SQL nuovo): nel modulo si spuntano/tolgono le categorie di `rubrica_categorie` (id in `tm_contatti.categorie`).
  Le categorie già sul contatto ma disattivate o non più in elenco restano spuntate (con la scritta) così si possono togliere; mai perse
  di nascosto. Le categorie si scrivono solo se cambiano. «Aggiungi categoria» crea una riga in `rubrica_categorie` (id dal nome,
  azienda letta dalle categorie, mai sovrascrive un id che c'è già). Rinominare/disattivare una categoria resta nella Rubrica di riserva.
  **«Fornitori» non si sceglie dalle categorie** (c'è la scritta nel modulo): solo il tasto «Fornitore» (`e_fornitore`); il trigger
  `anag_contatti_fornitore_unico` allinea il resto. Nei filtri dell'elenco «Fornitori» compare una volta sola.

## CAP ↔ località
`js/cap.js` legge `dati/cap_ch.json` (elenco ufficiale swisstopo, salvato qui, **mai** chiesto a internet).
Si crea con `node prove/converti_cap.js <AMTOVZ_CSV_LV95.csv>`. Senza il file l'app va lo stesso (si scrive a mano).
Solo aiuto, mai blocco.

## Sicurezza dei dati
- Prima di **ogni** lettura e scrittura si controlla la sessione: senza sessione si torna al login.
- Ogni scrittura chiede indietro la riga: **0 righe = «NON salvato»**, mai un successo finto.
- Elenchi a zero righe dove non possono esserlo (commesse, persone, contatti) = errore a schermo.
- Colonne nuove (SQL non ancora applicato): l'app lo dice e funziona con quelle vecchie (`AD.leggiConRiserva`).

## SQL (in `..\Anagrafiche - ricognizione\SQL eseguiti\`, ognuno con `_INDIETRO` e `_VERIFICA`)
`ANAG_F2_01_esterni` · `02_accessi_documenti` · `03_codice_interno` · `04_fornitore_unico` · `05_lavori_per_la_ditta` ·
`06_foto_rubrica_scrittura` — applicati sul vero il 2.11.
v3: `07_blocco_fine_rapporto` (+ `_ANTEPRIMA`) · `08_esterni_senza_account` — applicati sul vero il 3.11
(backup `backup-2026-11-03-1139`, VERIFICA 10/10 e 6/6). Il vecchio `SQL_FASE2_*` è in `scartati\`.

## Versioni
JS e CSS con `?v=N` in `index.html`; a ogni modifica si alza `N` e `VERSIONE` in `js/config.js`. Dopo il caricamento: **Ctrl+F5**.

## Riserva
`riserva/` = la Rubrica v4 online oggi (commit `d3f8e18`, uguale byte per byte, controllata il 2.11 con sha256).
Si aggiorna solo con una versione provata, controllando l'impronta dopo ogni copia.
**Se un giorno si aggiunge un service worker, deve ignorare `riserva/`.** Oggi non ce n'è.

## Prove (senza toccare il database vero)
- `prove/finto_supabase.js`: Supabase finto con dati **inventati** («PROVA …»), imita trigger, vincoli, funzioni, file.
- `node prove/prepara_prova.js` crea `prove/prova.html` da `index.html`. Server locale nella cartella `Anagrafiche`
  (es. `python -m http.server 8766`) → `http://localhost:8766/prove/prova.html`. Password di prova: `prova`.
- Parametri: `?ruolo=operaio|responsabile`, `?sessione=no`, `?rpc=errore`, `?lettura=vuota`, `?scrittura=zero`,
  `?foto=errore`, `?sql=vecchio` (database senza gli SQL ANAG_F2), `?funzioni=assenti`, `?blocchi=assenti` (senza SQL 07).
- Prove automatiche nel browser (console della pagina di prova appena caricata):
  `prove/test_persone.js` → `await TEST_PERSONE()`, `prove/test_contatti.js` → `await TEST_CONTATTI()`,
  `prove/test_fine_rapporto.js` → `await TEST_FINE()` (+ `TEST_FINE_RESP()` con `?ruolo=responsabile`,
  `TEST_FINE_SENZA07()` con `?blocchi=assenti`).
- `prove/dati/cap_ch.json` = poche righe di prova per il CAP.
- **La cartella `prove/` non va caricata su GitHub.**
