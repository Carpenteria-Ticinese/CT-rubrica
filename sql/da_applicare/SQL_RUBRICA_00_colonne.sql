-- ==============================================================================
-- SQL_RUBRICA_00_colonne.sql — LE COLONNE DI CT RUBRICA SU tm_contatti
--
-- Le tre colonne nuove (categorie, foto_url, referente) risultano GIÀ
-- APPLICATE. Questo file esiste per due motivi:
--   1. è la memoria scritta di cosa si aspetta il programma;
--   2. se una colonna mancasse (database ripristinato, progetto nuovo) la
--      aggiunge senza toccare le altre.
--
-- SI PUÒ LANCIARE QUANTE VOLTE SI VUOLE: tutto è IF NOT EXISTS, nessun UPDATE
-- sui dati, nessuna vista toccata. Supabase → SQL Editor → incolla → Run.
-- ==============================================================================

BEGIN;

-- Le categorie: un contatto ne ha zero, una o più. Chiavi usate dal programma:
--   fornitori · collaboratori · preventivi · appalti_presi · appalti_conclusi
--   marketing_servizi · altro
-- NULL = contatto mai aperto in CT Rubrica (creato da Pre-contabilità): il
-- programma ricava quello che può dalla colonna vecchia `categoria`.
-- '{}' (vuoto) = aperto in CT Rubrica e lasciato senza spunte, apposta.
ALTER TABLE tm_contatti ADD COLUMN IF NOT EXISTS categorie TEXT[];

COMMENT ON COLUMN tm_contatti.categorie IS
  'CT Rubrica: categorie multiple (fornitori, collaboratori, preventivi, appalti_presi, appalti_conclusi, marketing_servizi, altro). NULL = mai impostata; {} = nessuna, scelta esplicita. La colonna `categoria` (singola) resta per Pre-contabilita e viene tenuta allineata dal programma.';

-- La foto profilo: URL pubblico del file nel bucket Storage «rubrica-foto»,
-- percorso <id_contatto>/<timestamp>.<estensione>. Mai basato sul nome.
ALTER TABLE tm_contatti ADD COLUMN IF NOT EXISTS foto_url TEXT;

COMMENT ON COLUMN tm_contatti.foto_url IS
  'CT Rubrica: URL della foto nel bucket rubrica-foto (<id_contatto>/<timestamp>.<ext>). NULL = nessuna foto.';

-- La persona di riferimento quando il contatto è un'azienda o uno studio.
ALTER TABLE tm_contatti ADD COLUMN IF NOT EXISTS referente TEXT;

COMMENT ON COLUMN tm_contatti.referente IS
  'CT Rubrica: persona di riferimento presso l azienda/studio. Testo libero.';

-- Il cellulare arriva con SQL_FASE29 di Pre-contabilità. Se quello è già stato
-- lanciato questa riga non fa nulla; se non lo è ancora, la aggiunge uguale
-- (stesso nome, stesso tipo) e FASE29 poi la troverà già pronta.
ALTER TABLE tm_contatti ADD COLUMN IF NOT EXISTS cellulare TEXT;

-- Indice per i filtri per categoria («tutti i fornitori»): GIN sull'array.
CREATE INDEX IF NOT EXISTS idx_contatti_categorie
  ON tm_contatti USING GIN (categorie);

COMMIT;


-- ── Verifica (facoltativa) ────────────────────────────────────────────────────
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'tm_contatti'
--    AND column_name IN ('categorie', 'foto_url', 'referente', 'cellulare');
-- Devono uscire quattro righe.
