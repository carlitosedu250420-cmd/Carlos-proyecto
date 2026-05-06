-- Tabla principal de arrendatarios/marcas
CREATE TABLE IF NOT EXISTS arrendatarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item INTEGER,
  tipo TEXT,
  ubicacion TEXT,
  arrendatario TEXT NOT NULL,
  grupos_marcas TEXT,
  fecha_bomberos TEXT,
  status_bomberos TEXT,
  fecha_patente TEXT,
  status_patente TEXT,
  fecha_tasa_hab TEXT,
  status_th TEXT,
  fecha_turismo TEXT,
  status_turismo TEXT,
  fecha_lic_turismo TEXT,
  status_lic_turismo TEXT,
  fecha_trampa_grasa TEXT,
  status_trampa_grasa TEXT,
  arcsa_inicio TEXT,
  arcsa_fin TEXT,
  status_arcsa TEXT,
  cert_ambiental TEXT,
  reg_desechos TEXT,
  cert_gestion_residuos TEXT,
  manifiesto TEXT,
  soprofon TEXT,
  egeda TEXT,
  status_general TEXT,
  observaciones TEXT,
  registro_cartas TEXT,
  seguimiento TEXT,
  gestion_legal TEXT,
  fecha_avances TEXT,
  fecha_ingreso TEXT,
  ultima_categorizacion TEXT,
  primer_visita TEXT,
  -- Pólizas (del segundo Excel)
  poliza_inicio TEXT,
  poliza_caducidad TEXT,
  status_poliza TEXT,
  rubro_poliza TEXT,
  fecha_entrega_poliza TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de documentos subidos por arrendatario
CREATE TABLE IF NOT EXISTS documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arrendatario_id INTEGER NOT NULL,
  tipo_permiso TEXT NOT NULL,
  nombre_archivo TEXT NOT NULL,
  url_archivo TEXT NOT NULL,
  descripcion TEXT,
  fecha_subida DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (arrendatario_id) REFERENCES arrendatarios(id)
);

-- Tabla de visitas de campo
CREATE TABLE IF NOT EXISTS visitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arrendatario_id INTEGER NOT NULL,
  fecha_visita TEXT NOT NULL,
  entrego_documentos INTEGER DEFAULT 0,
  documentos_entregados TEXT,
  motivo_no_entrega TEXT,
  descripcion TEXT,
  observaciones TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (arrendatario_id) REFERENCES arrendatarios(id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_arrendatarios_nombre ON arrendatarios(arrendatario);
CREATE INDEX IF NOT EXISTS idx_arrendatarios_tipo ON arrendatarios(tipo);
CREATE INDEX IF NOT EXISTS idx_arrendatarios_ubicacion ON arrendatarios(ubicacion);
CREATE INDEX IF NOT EXISTS idx_documentos_arrendatario ON documentos(arrendatario_id);
CREATE INDEX IF NOT EXISTS idx_visitas_arrendatario ON visitas(arrendatario_id);
CREATE INDEX IF NOT EXISTS idx_visitas_fecha ON visitas(fecha_visita);
