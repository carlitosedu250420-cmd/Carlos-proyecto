-- Agregar campos encargado y documentos_faltantes a visitas
ALTER TABLE visitas ADD COLUMN encargado TEXT;
ALTER TABLE visitas ADD COLUMN documentos_faltantes TEXT;
