# CT Rubrica — leggimi

Rubrica contatti di Carpenteria Ticinese. HTML/JS vanilla + Supabase, **stesso progetto
Supabase e stessa tabella `tm_contatti` di Pre-contabilità**: un contatto salvato qui compare
anche là, e viceversa. Si entra con **gli stessi email e password** di Pre-contabilità (Supabase
Auth, `auth.users`): non esiste un secondo sistema di accesso.

## Cosa si carica su GitHub

Repo: `Carpenteria-Ticinese/CT-rubrica`. I file, con il loro percorso nel repo, stanno in
**`DA_CARICARE_SU_GITHUB.txt`**. Non spostarli e non rinominarli: i percorsi dentro il
programma sono relativi.

## Versioni

Ogni file JS/CSS è richiamato con `?v=N` da `index.html` (`css/style.css?v=1`, `js/app.js?v=1`).
Quando si cambia `app.js` o `style.css` si alza `N` in `index.html` (e `APP_VERSIONE` in
`app.js`, che è quello che si legge in fondo alla pagina). `index.html` non ha `?v=`: **dopo
ogni caricamento si apre con Ctrl+F5**.

## SQL

L'SQL non lo esegue il programma: Supabase → SQL Editor → incolla → Run.

- `sql/da_applicare/SQL_RUBRICA_00_colonne.sql` — le colonne `categorie`, `foto_url`, `referente`
  (già applicate; il file le aggiunge solo se mancano) e `cellulare`. Si può rilanciare.
- `sql/da_applicare/SQL_RUBRICA_01_storage.sql` — **il bucket `rubrica-foto`** e le sue policy.
  Va lanciato **prima della prima foto**: senza, il contatto si salva ma la foto no (il programma
  lo dice a schermo).

## Come funziona, in breve

- **Elenco**: ricerca in tempo reale su nome, cognome, ragione sociale e referente. I sette
  filtri (Fornitori, Collaboratori, Preventivi, Appalti presi, Appalti conclusi, Marketing e
  servizi, Altro) sono pulsanti: un contatto compare in **ogni** categoria che ha spuntata.
  Il filtro «Archiviati» compare solo se ce ne sono.
- **Telefono e cellulare** hanno un pulsante `tel:` accanto, sia in elenco sia nella scheda.
- **Paese**: SOLO tendina, nel database va il codice ISO a due lettere (`CH`, `IT`, …). In
  Pre-contabilità era testo libero e «Svizzera» digitato a mano diventava `SV` = El Salvador.
  Un codice vecchio non valido viene mostrato come «da correggere», mai sostituito di nascosto.
- **Foto**: ridotta a 800 px nel browser, caricata nel bucket `rubrica-foto` al percorso
  `<id_contatto>/<timestamp>.jpg`. Mai basata sul nome del contatto.
- **Salvataggio**: se c'è già un contatto con nome molto simile (forme societarie, accenti e
  punteggiatura ignorate) o con lo stesso UID, si avvisa e si può **salvare comunque**. Mai un
  blocco: gli omonimi esistono, e lo stesso soggetto con due IBAN si registra due volte.
- **Eliminazione**: pulsante «Elimina» nella scheda, una conferma inline («Sì, elimina») e via.
  Se il contatto è collegato a fatture o movimenti in Pre-contabilità il database rifiuta
  (vincolo di chiave esterna): allora si propone di **archiviarlo**, come fa Pre-contabilità.

## La categoria vecchia di Pre-contabilità

`tm_contatti.categoria` (una sola: cliente / fornitore / collaboratore / generico) resta per
Pre-contabilità. CT Rubrica la tiene allineata alle categorie nuove quando salva:
preventivi e appalti → `cliente`, fornitori → `fornitore`, collaboratori → `collaboratore`
(e `e_cliente` / `e_fornitore` quando un contatto è tutte e due le cose). Un contatto che
Pre-contabilità dice «cliente» ma che qui non ha ancora categorie compare senza etichetta:
aprendolo in modifica un avviso invita a spuntare Preventivi o Appalti.

## Colonne facoltative

`cellulare` (SQL_FASE29 di Pre-contabilità) ed `e_cliente`/`e_fornitore` (SQL_FASE17): il
programma controlla all'avvio se ci sono. Se `cellulare` manca, il campo si nasconde e tutto il
resto funziona.
