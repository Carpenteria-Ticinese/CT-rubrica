-- ==============================================================================
-- SQL_RUBRICA_01_storage.sql — IL BUCKET «rubrica-foto» PER LE FOTO PROFILO
--
-- *** DA LANCIARE PRIMA DI CARICARE LA PRIMA FOTO. ***
-- Senza il bucket il contatto si salva lo stesso, ma la foto no: il programma
-- lo dice a schermo («il bucket rubrica-foto non esiste ancora»).
--
-- SI PUÒ LANCIARE DUE VOLTE senza danni: bucket ON CONFLICT, policy DROP+CREATE.
-- Supabase → SQL Editor → incolla → Run.
--
-- COME È FATTO
--   · bucket PUBBLICO in lettura: l'URL della foto va nell'attributo src di
--     un'immagine, e un URL pubblico non scade. Le foto sono avatar di
--     fornitori e clienti, non documenti riservati.
--   · scrittura (caricare, sostituire, cancellare) SOLO per utenti autenticati
--     e SOLO nella cartella di un contatto della PROPRIA azienda: il percorso
--     è <id_contatto>/<timestamp>.<ext>, e il primo pezzo deve essere l'id di
--     un contatto che la RLS di tm_contatti già lascia vedere all'utente.
--   · limite 5 MB per file e solo immagini: il programma le riduce a 800 px
--     prima di salirle, quindi in pratica pesano 50-150 KB.
-- ==============================================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('rubrica-foto', 'rubrica-foto', true, 5242880, ARRAY['image/*'])
ON CONFLICT (id) DO UPDATE
  SET public             = true,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Il contatto della cartella appartiene all'azienda dell'utente?
-- Si confronta come testo: se il primo pezzo del percorso non è un UUID il
-- confronto è semplicemente falso, senza errori di cast.
CREATE OR REPLACE FUNCTION public.rubrica_foto_cartella_mia(nome_file TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM tm_contatti c
     WHERE c.id::text = (storage.foldername(nome_file))[1]
       AND c.azienda_id IN (SELECT azienda_id FROM tm_utenti WHERE id = auth.uid())
  );
$$;

COMMENT ON FUNCTION public.rubrica_foto_cartella_mia(TEXT) IS
  'CT Rubrica: vero se il file sta nella cartella di un contatto dell azienda dell utente loggato. Usata dalle policy Storage del bucket rubrica-foto.';

-- Lettura: pubblica (il bucket è public, ma la policy serve a list() e alle
-- letture autenticate dall'app).
DROP POLICY IF EXISTS "rubrica_foto_lettura" ON storage.objects;
CREATE POLICY "rubrica_foto_lettura" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'rubrica-foto');

-- Caricamento.
DROP POLICY IF EXISTS "rubrica_foto_carica" ON storage.objects;
CREATE POLICY "rubrica_foto_carica" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'rubrica-foto' AND public.rubrica_foto_cartella_mia(name));

-- Sostituzione (upsert / move).
DROP POLICY IF EXISTS "rubrica_foto_aggiorna" ON storage.objects;
CREATE POLICY "rubrica_foto_aggiorna" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'rubrica-foto' AND public.rubrica_foto_cartella_mia(name))
  WITH CHECK (bucket_id = 'rubrica-foto' AND public.rubrica_foto_cartella_mia(name));

-- Cancellazione (quando si toglie o si cambia la foto, o si elimina il contatto).
-- Eliminando un contatto il programma cancella PRIMA la riga (così, se il
-- database rifiuta per una fattura collegata, nessuna foto va persa) e POI i
-- file. A quel punto il contatto non c'è più e la funzione qui sopra direbbe
-- «non tua»: per questo la cancellazione ammette anche le cartelle orfane,
-- cioè quelle il cui contatto non esiste più.
DROP POLICY IF EXISTS "rubrica_foto_cancella" ON storage.objects;
CREATE POLICY "rubrica_foto_cancella" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'rubrica-foto'
    AND (
      public.rubrica_foto_cartella_mia(name)
      OR NOT EXISTS (SELECT 1 FROM tm_contatti c WHERE c.id::text = (storage.foldername(name))[1])
    )
  );

COMMIT;


-- ── Verifica (facoltativa) ────────────────────────────────────────────────────
-- SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'rubrica-foto';
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'rubrica_foto%';
-- Devono uscire il bucket e quattro policy (SELECT, INSERT, UPDATE, DELETE).


-- ── Per tornare indietro ──────────────────────────────────────────────────────
-- (le foto già caricate restano nel bucket finché non lo si svuota dal pannello Storage)
-- BEGIN;
-- DROP POLICY IF EXISTS "rubrica_foto_lettura"  ON storage.objects;
-- DROP POLICY IF EXISTS "rubrica_foto_carica"   ON storage.objects;
-- DROP POLICY IF EXISTS "rubrica_foto_aggiorna" ON storage.objects;
-- DROP POLICY IF EXISTS "rubrica_foto_cancella" ON storage.objects;
-- DROP FUNCTION IF EXISTS public.rubrica_foto_cartella_mia(TEXT);
-- COMMIT;
