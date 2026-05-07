import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'
import { SEED_DATA } from './seed_data'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())
app.use('/static/*', serveStatic({ root: './' }))

// ─── Mapa: tipo_permiso → columna status en arrendatarios ────────────────────
const PERMISO_STATUS_MAP: Record<string, string> = {
  'Permiso Bomberos':     'status_bomberos',
  'Patente':              'status_patente',
  'Tasa Habilitación':    'status_th',
  'Registro Turismo':     'status_turismo',
  'Licencia Turismo':     'status_lic_turismo',
  'Trampa Grasa':         'status_trampa_grasa',
  'ARCSA':                'status_arcsa',
  'Póliza Seguro':        'status_poliza',
}

// ─── API: Setup DB ────────────────────────────────────────────────────────────
app.get('/api/setup', async (c) => {
  try {
    await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS arrendatarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT, item INTEGER, tipo TEXT, ubicacion TEXT,
      arrendatario TEXT NOT NULL, grupos_marcas TEXT,
      fecha_bomberos TEXT, status_bomberos TEXT, fecha_patente TEXT, status_patente TEXT,
      fecha_tasa_hab TEXT, status_th TEXT, fecha_turismo TEXT, status_turismo TEXT,
      fecha_lic_turismo TEXT, status_lic_turismo TEXT, fecha_trampa_grasa TEXT, status_trampa_grasa TEXT,
      arcsa_inicio TEXT, arcsa_fin TEXT, status_arcsa TEXT, cert_ambiental TEXT,
      reg_desechos TEXT, cert_gestion_residuos TEXT, manifiesto TEXT, soprofon TEXT, egeda TEXT,
      status_general TEXT, observaciones TEXT, registro_cartas TEXT, seguimiento TEXT,
      gestion_legal TEXT, fecha_avances TEXT, fecha_ingreso TEXT, ultima_categorizacion TEXT,
      primer_visita TEXT, poliza_inicio TEXT, poliza_caducidad TEXT, status_poliza TEXT,
      rubro_poliza TEXT, fecha_entrega_poliza TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run()

    await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS documentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, arrendatario_id INTEGER NOT NULL,
      tipo_permiso TEXT NOT NULL, nombre_archivo TEXT NOT NULL, url_archivo TEXT NOT NULL,
      descripcion TEXT, fecha_subida DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (arrendatario_id) REFERENCES arrendatarios(id)
    )`).run()

    await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS visitas (
      id INTEGER PRIMARY KEY AUTOINCREMENT, arrendatario_id INTEGER NOT NULL,
      fecha_visita TEXT NOT NULL, encargado TEXT, entrego_documentos INTEGER DEFAULT 0,
      documentos_entregados TEXT, documentos_faltantes TEXT, motivo_no_entrega TEXT,
      descripcion TEXT, observaciones TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (arrendatario_id) REFERENCES arrendatarios(id)
    )`).run()

    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM arrendatarios').first<{n:number}>()
    if (count && count.n > 0) {
      return c.json({ ok: true, message: `DB already has ${count.n} arrendatarios`, seeded: false })
    }

    const seedBatch = SEED_DATA.map(row =>
      c.env.DB.prepare(`INSERT INTO arrendatarios (item,tipo,ubicacion,arrendatario,grupos_marcas,fecha_bomberos,status_bomberos,fecha_patente,status_patente,fecha_tasa_hab,status_th,fecha_turismo,status_turismo,fecha_lic_turismo,status_lic_turismo,fecha_trampa_grasa,status_trampa_grasa,arcsa_inicio,arcsa_fin,status_arcsa,cert_ambiental,reg_desechos,cert_gestion_residuos,manifiesto,soprofon,egeda,status_general,observaciones,registro_cartas,seguimiento,gestion_legal,fecha_avances,fecha_ingreso,ultima_categorizacion,primer_visita,poliza_inicio,poliza_caducidad,status_poliza,rubro_poliza,fecha_entrega_poliza)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(...row)
    )
    for (let i = 0; i < seedBatch.length; i += 50) {
      await c.env.DB.batch(seedBatch.slice(i, i + 50))
    }
    return c.json({ ok: true, message: `Seeded ${seedBatch.length} arrendatarios`, seeded: true })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// Migración para agregar columnas nuevas si no existen
app.get('/api/migrate', async (c) => {
  const results: string[] = []
  const cols = [
    { table: 'visitas', col: 'encargado',             def: 'TEXT' },
    { table: 'visitas', col: 'documentos_faltantes',  def: 'TEXT' },
  ]
  for (const { table, col, def } of cols) {
    try {
      await c.env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run()
      results.push(`Added ${table}.${col}`)
    } catch {
      results.push(`Skip ${table}.${col} (already exists)`)
    }
  }
  return c.json({ ok: true, results })
})

// ─── API: Arrendatarios ───────────────────────────────────────────────────────
app.get('/api/arrendatarios', async (c) => {
  const { tipo, ubicacion, status_poliza, search } = c.req.query()
  let query = `SELECT a.*, 
    (SELECT COUNT(*) FROM documentos d WHERE d.arrendatario_id = a.id) as docs_count,
    (SELECT GROUP_CONCAT(d.tipo_permiso, '||') FROM documentos d WHERE d.arrendatario_id = a.id) as docs_tipos
    FROM arrendatarios a WHERE 1=1`
  const params: string[] = []
  if (tipo)         { query += ' AND a.tipo = ?';                                              params.push(tipo) }
  if (ubicacion)    { query += ' AND a.ubicacion = ?';                                         params.push(ubicacion) }
  if (status_poliza){ query += ' AND a.status_poliza = ?';                                     params.push(status_poliza) }
  if (search)       { query += ' AND (a.arrendatario LIKE ? OR a.ubicacion LIKE ?)';           params.push(`%${search}%`, `%${search}%`) }
  query += ' ORDER BY a.arrendatario ASC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(result.results)
})

app.get('/api/arrendatarios/:id', async (c) => {
  const id = c.req.param('id')
  const arr = await c.env.DB.prepare('SELECT * FROM arrendatarios WHERE id = ?').bind(id).first()
  if (!arr) return c.json({ error: 'Not found' }, 404)
  const docs    = await c.env.DB.prepare('SELECT * FROM documentos WHERE arrendatario_id = ? ORDER BY fecha_subida DESC').bind(id).all()
  const visitas = await c.env.DB.prepare('SELECT * FROM visitas WHERE arrendatario_id = ? ORDER BY fecha_visita DESC').bind(id).all()
  return c.json({ ...arr, documentos: docs.results, visitas: visitas.results })
})

app.get('/api/filtros', async (c) => {
  const tipos      = await c.env.DB.prepare("SELECT DISTINCT tipo FROM arrendatarios WHERE tipo IS NOT NULL ORDER BY tipo").all()
  const ubicaciones= await c.env.DB.prepare("SELECT DISTINCT ubicacion FROM arrendatarios WHERE ubicacion IS NOT NULL ORDER BY ubicacion").all()
  return c.json({
    tipos:      tipos.results.map((r: any) => r.tipo),
    ubicaciones:ubicaciones.results.map((r: any) => r.ubicacion)
  })
})

// ─── API: Documentos ──────────────────────────────────────────────────────────
app.post('/api/documentos', async (c) => {
  const body = await c.req.json()
  const { arrendatario_id, tipo_permiso, nombre_archivo, url_archivo, descripcion } = body
  if (!arrendatario_id || !tipo_permiso || !nombre_archivo || !url_archivo)
    return c.json({ error: 'Faltan campos requeridos' }, 400)

  const result = await c.env.DB.prepare(
    'INSERT INTO documentos (arrendatario_id, tipo_permiso, nombre_archivo, url_archivo, descripcion) VALUES (?,?,?,?,?)'
  ).bind(arrendatario_id, tipo_permiso, nombre_archivo, url_archivo, descripcion || null).run()

  // ✅ Actualizar status del permiso correspondiente a "Recibido"
  const colStatus = PERMISO_STATUS_MAP[tipo_permiso]
  if (colStatus) {
    await c.env.DB.prepare(
      `UPDATE arrendatarios SET ${colStatus} = 'Recibido', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(arrendatario_id).run()
  }

  return c.json({ id: result.meta.last_row_id, success: true, colStatus: colStatus || null })
})

app.delete('/api/documentos/:id', async (c) => {
  const id = c.req.param('id')
  // Obtener info del documento antes de borrar para revertir status si no hay más docs del mismo tipo
  const doc = await c.env.DB.prepare('SELECT * FROM documentos WHERE id = ?').bind(id).first<any>()
  await c.env.DB.prepare('DELETE FROM documentos WHERE id = ?').bind(id).run()
  if (doc) {
    const remaining = await c.env.DB.prepare(
      'SELECT COUNT(*) as n FROM documentos WHERE arrendatario_id = ? AND tipo_permiso = ?'
    ).bind(doc.arrendatario_id, doc.tipo_permiso).first<{n:number}>()
    if (remaining && remaining.n === 0) {
      const colStatus = PERMISO_STATUS_MAP[doc.tipo_permiso]
      if (colStatus) {
        await c.env.DB.prepare(
          `UPDATE arrendatarios SET ${colStatus} = 'Pendiente', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(doc.arrendatario_id).run()
      }
    }
  }
  return c.json({ success: true })
})

// Todos los documentos (registro global)
app.get('/api/documentos', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT d.*, a.arrendatario, a.tipo, a.ubicacion
    FROM documentos d
    JOIN arrendatarios a ON d.arrendatario_id = a.id
    ORDER BY d.fecha_subida DESC
  `).all()
  return c.json(result.results)
})

// ─── API: Visitas ──────────────────────────────────────────────────────────────
app.get('/api/visitas', async (c) => {
  const { arrendatario_id } = c.req.query()
  let query = `SELECT v.*, a.arrendatario, a.tipo, a.ubicacion
    FROM visitas v JOIN arrendatarios a ON v.arrendatario_id = a.id`
  const params: any[] = []
  if (arrendatario_id) { query += ' WHERE v.arrendatario_id = ?'; params.push(arrendatario_id) }
  query += ' ORDER BY v.fecha_visita DESC, v.created_at DESC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(result.results)
})

app.post('/api/visitas', async (c) => {
  const body = await c.req.json()
  const { arrendatario_id, fecha_visita, encargado, entrego_documentos,
          documentos_entregados, documentos_faltantes, motivo_no_entrega, descripcion, observaciones } = body
  if (!arrendatario_id || !fecha_visita)
    return c.json({ error: 'Faltan campos requeridos' }, 400)

  const result = await c.env.DB.prepare(
    `INSERT INTO visitas (arrendatario_id, fecha_visita, encargado, entrego_documentos,
     documentos_entregados, documentos_faltantes, motivo_no_entrega, descripcion, observaciones)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    arrendatario_id, fecha_visita, encargado || null,
    entrego_documentos ? 1 : 0,
    documentos_entregados || null, documentos_faltantes || null,
    motivo_no_entrega || null, descripcion || null, observaciones || null
  ).run()
  return c.json({ id: result.meta.last_row_id, success: true })
})

app.delete('/api/visitas/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM visitas WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ─── API: Export Arrendatarios CSV ────────────────────────────────────────────
app.get('/api/export/arrendatarios', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT id, item, tipo, ubicacion, arrendatario,
           status_bomberos, fecha_bomberos, status_patente, fecha_patente,
           status_th, fecha_tasa_hab, status_turismo, fecha_turismo,
           status_trampa_grasa, fecha_trampa_grasa, status_arcsa, arcsa_inicio, arcsa_fin,
           status_poliza, poliza_inicio, poliza_caducidad, rubro_poliza, observaciones
    FROM arrendatarios ORDER BY arrendatario
  `).all()
  const rows = result.results as any[]
  const esc = (v: any) => { const s = String(v??'').replace(/"/g,'""'); return `"${s}"` }
  const headers = ['#','TIPO','UBICACIÓN','ARRENDATARIO','STATUS BOMBEROS','FECHA BOMBEROS',
    'STATUS PATENTE','FECHA PATENTE','STATUS TH','FECHA TH','STATUS TURISMO','FECHA TURISMO',
    'STATUS TRAMPA GRASA','FECHA TRAMPA GRASA','STATUS ARCSA','ARCSA INICIO','ARCSA FIN',
    'STATUS PÓLIZA','PÓLIZA INICIO','PÓLIZA CADUCIDAD','RUBRO PÓLIZA','OBSERVACIONES']
  let csv = '\uFEFF' + headers.map(esc).join(',') + '\r\n'
  for (const r of rows) {
    csv += [r.item,r.tipo,r.ubicacion,r.arrendatario,r.status_bomberos,r.fecha_bomberos,
      r.status_patente,r.fecha_patente,r.status_th,r.fecha_tasa_hab,r.status_turismo,r.fecha_turismo,
      r.status_trampa_grasa,r.fecha_trampa_grasa,r.status_arcsa,r.arcsa_inicio,r.arcsa_fin,
      r.status_poliza,r.poliza_inicio,r.poliza_caducidad,r.rubro_poliza,r.observaciones
    ].map(esc).join(',') + '\r\n'
  }
  return new Response(csv, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="arrendatarios_permisos.csv"'
  }})
})

// ─── API: Export Visitas CSV ──────────────────────────────────────────────────
app.get('/api/export/visitas', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT v.id, a.arrendatario, a.tipo, a.ubicacion, v.fecha_visita, v.encargado,
           v.entrego_documentos, v.documentos_entregados, v.documentos_faltantes,
           v.motivo_no_entrega, v.descripcion, v.observaciones, v.created_at
    FROM visitas v JOIN arrendatarios a ON v.arrendatario_id = a.id
    ORDER BY v.fecha_visita DESC
  `).all()
  const rows = result.results as any[]
  const esc = (v: any) => { const s = String(v??'').replace(/"/g,'""'); return `"${s}"` }
  const headers = ['ID','ARRENDATARIO','TIPO','UBICACIÓN','FECHA VISITA','ENCARGADO',
    'ENTREGÓ DOCS','DOCUMENTOS ENTREGADOS','DOCUMENTOS FALTANTES',
    'MOTIVO NO ENTREGA','DESCRIPCIÓN / NOTAS','FECHA REGISTRO']
  let csv = '\uFEFF' + headers.map(esc).join(',') + '\r\n'
  for (const r of rows) {
    csv += [r.id, r.arrendatario, r.tipo, r.ubicacion, r.fecha_visita, r.encargado,
      r.entrego_documentos ? 'SÍ' : 'NO',
      r.documentos_entregados, r.documentos_faltantes,
      r.motivo_no_entrega, r.descripcion || r.observaciones, r.created_at
    ].map(esc).join(',') + '\r\n'
  }
  return new Response(csv, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="visitas_campo.csv"'
  }})
})

// ─── Frontend HTML ─────────────────────────────────────────────────────────────
app.get('/', (c) => c.html(getHTML()))
app.get('*', (c) => c.html(getHTML()))

function getHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Gestión de Permisos · Carlos Alcivar</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <style>
    *{font-family:'Segoe UI',system-ui,sans-serif;}
    .sv{background:#dcfce7;color:#166534;}
    .sp{background:#fef9c3;color:#854d0e;}
    .sc{background:#fee2e2;color:#991b1b;}
    .sco{background:#fed7aa;color:#9a3412;}
    .sna{background:#f3f4f6;color:#6b7280;}
    .sr{background:#bbf7d0;color:#065f46;}
    .spp{background:#dbeafe;color:#1e40af;}
    .card-hover{transition:all .2s;}
    .card-hover:hover{transform:translateY(-2px);box-shadow:0 10px 25px rgba(0,0,0,.15);}
    .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;align-items:center;justify-content:center;padding:1rem;}
    .modal-box{background:#fff;border-radius:1rem;max-width:960px;width:100%;max-height:90vh;overflow-y:auto;}
    .tab-btn{padding:.5rem 1rem;border-radius:.5rem;font-weight:600;transition:all .2s;cursor:pointer;white-space:nowrap;}
    .tab-btn.active{background:#1e40af;color:#fff;}
    .tab-btn:not(.active){background:#f3f4f6;color:#374151;}
    .tab-btn:not(.active):hover{background:#e5e7eb;}
    .badge{display:inline-block;padding:.2rem .6rem;border-radius:9999px;font-size:.75rem;font-weight:700;}
    input,select,textarea{border:1px solid #d1d5db;border-radius:.5rem;padding:.5rem .75rem;width:100%;outline:none;}
    input:focus,select:focus,textarea:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15);}
    .perm-card{border-radius:.5rem;padding:.5rem;font-size:.75rem;font-weight:600;text-align:center;}
    ::-webkit-scrollbar{width:6px;}
    ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px;}
    @media(max-width:640px){.modal-box{max-height:95vh;}}
    /* ─── Tabla de visitas optimizada para copiar/pegar en Excel ─── */
    #visitasTableWrapper{overflow-x:auto;border-radius:.5rem;border:2px solid #1e3a8a;}
    .copy-table{border-collapse:collapse;width:100%;font-size:12px;min-width:900px;}
    .copy-table thead tr th{background:#1e3a8a;color:#fff;padding:9px 12px;text-align:left;border:1px solid #2563eb;font-size:11px;font-weight:700;white-space:nowrap;}
    .copy-table tbody tr td{padding:8px 12px;border:1px solid #e2e8f0;vertical-align:top;font-size:12px;}
    .copy-table tbody tr:nth-child(odd) td{background:#ffffff;}
    .copy-table tbody tr:nth-child(even) td{background:#f8fafc;}
    .copy-table tbody tr:hover td{background:#eff6ff;}
    .badge-si{background:#dcfce7;color:#166534;padding:3px 10px;border-radius:99px;font-weight:700;font-size:11px;display:inline-block;}
    .badge-no{background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:99px;font-weight:700;font-size:11px;display:inline-block;}
    /* docs badge en tarjeta */
    .doc-uploaded-badge{position:absolute;top:8px;right:8px;background:#065f46;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;}
    /* indicador de docs subidos en permiso */
    .has-doc::after{content:'📎';font-size:10px;margin-left:3px;}
  </style>
</head>
<body class="bg-gray-100 min-h-screen">

<!-- HEADER -->
<header class="bg-gradient-to-r from-blue-900 to-blue-700 text-white shadow-lg sticky top-0 z-40">
  <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
    <div class="flex items-center gap-3">
      <div class="bg-white/20 rounded-xl p-2"><i class="fas fa-building text-xl"></i></div>
      <div>
        <h1 class="text-lg font-bold leading-tight">Gestión de Permisos</h1>
        <p class="text-blue-200 text-xs">Carlos Alcivar · Operaciones</p>
      </div>
    </div>
    <div class="flex gap-2 flex-wrap">
      <button onclick="openDocsGlobal()" class="bg-violet-500 hover:bg-violet-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-folder-open"></i><span class="hidden sm:inline">Documentos</span>
      </button>
      <button onclick="openVisitasTab()" class="bg-white/20 hover:bg-white/30 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-calendar-check"></i><span class="hidden sm:inline">Historial Visitas</span>
      </button>
      <button onclick="exportData('arrendatarios')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-file-excel"></i><span class="hidden sm:inline">Export</span>
      </button>
    </div>
  </div>
</header>

<!-- FILTROS -->
<div class="max-w-7xl mx-auto px-4 pt-4 pb-2">
  <div class="bg-white rounded-xl shadow p-4 flex flex-wrap gap-3 items-end">
    <div class="flex-1 min-w-[180px]">
      <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-search mr-1"></i>Buscar marca</label>
      <input id="searchInput" type="text" placeholder="Ej: Adidas, Zara..." onkeyup="debouncedLoad()" class="text-sm"/>
    </div>
    <div class="w-48">
      <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-store mr-1"></i>Tipo</label>
      <select id="filterTipo" onchange="loadArrendatarios()" class="text-sm">
        <option value="">Todos los tipos</option>
      </select>
    </div>
    <div class="w-52">
      <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-map-marker-alt mr-1"></i>Ubicación</label>
      <select id="filterUbicacion" onchange="loadArrendatarios()" class="text-sm">
        <option value="">Todas las ubicaciones</option>
      </select>
    </div>
    <div class="w-44">
      <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-shield-alt mr-1"></i>Póliza</label>
      <select id="filterPoliza" onchange="loadArrendatarios()" class="text-sm">
        <option value="">Todas</option>
        <option value="Vigente">Vigente</option>
        <option value="Pendiente por recibir">Pendiente</option>
        <option value="Pronto a Caducar al 31/5/26">Pronto a Caducar</option>
      </select>
    </div>
    <button onclick="clearFilters()" class="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm font-semibold">
      <i class="fas fa-times mr-1"></i>Limpiar
    </button>
  </div>
</div>

<!-- STATS -->
<div class="max-w-7xl mx-auto px-4 pb-3">
  <div id="statsBar" class="flex flex-wrap gap-2 mt-2"></div>
</div>

<!-- LISTA -->
<main class="max-w-7xl mx-auto px-4 pb-8">
  <div id="arrendatariosList" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"></div>
  <div id="loading" class="hidden text-center py-20"><i class="fas fa-spinner fa-spin text-4xl text-blue-500"></i><p class="text-gray-500 mt-3">Cargando...</p></div>
  <div id="emptyState" class="hidden text-center py-20"><i class="fas fa-search text-5xl text-gray-300"></i><p class="text-gray-400 mt-3 text-lg">Sin resultados</p></div>
</main>

<!-- ══ MODAL DETALLE ══ -->
<div id="modalDetalle" class="modal-overlay hidden" onclick="closeModal(event)">
  <div class="modal-box p-0" onclick="event.stopPropagation()"><div id="modalContent"></div></div>
</div>

<!-- ══ MODAL HISTORIAL VISITAS ══ -->
<div id="modalVisitas" class="modal-overlay hidden" onclick="if(event.target===this)this.classList.add('hidden')">
  <div class="modal-box p-6" style="max-width:1100px" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-calendar-check mr-2 text-blue-600"></i>Historial de Visitas</h2>
      <button onclick="document.getElementById('modalVisitas').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>

    <!-- Instrucciones copiar/pegar -->
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
      <p class="font-bold mb-1"><i class="fas fa-lightbulb mr-1 text-yellow-500"></i>Para pegar en Excel:</p>
      <ol class="list-decimal list-inside space-y-1 text-xs">
        <li>Haz clic en <strong>"Copiar tabla"</strong> abajo</li>
        <li>Abre Excel → selecciona la celda <strong>A1</strong></li>
        <li>Pega con <strong>Ctrl + V</strong> — las columnas quedarán separadas automáticamente</li>
      </ol>
    </div>

    <div class="flex gap-2 justify-between mb-4 flex-wrap items-center">
      <span id="visitasCount" class="text-sm text-gray-500"></span>
      <div class="flex gap-2 flex-wrap">
        <button onclick="copyVisitasTable()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
          <i class="fas fa-copy"></i> Copiar tabla (para Excel)
        </button>
        <button onclick="exportData('visitas')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
          <i class="fas fa-file-csv"></i> Descargar CSV
        </button>
      </div>
    </div>
    <div id="visitasHistorial"></div>
  </div>
</div>

<!-- ══ MODAL NUEVA VISITA ══ -->
<div id="modalNuevaVisita" class="modal-overlay hidden" onclick="if(event.target===this)this.classList.add('hidden')">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-plus-circle mr-2 text-green-600"></i>Registrar Visita</h2>
      <button onclick="document.getElementById('modalNuevaVisita').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <form id="formVisita" onsubmit="submitVisita(event)" class="space-y-4">
      <input type="hidden" id="visitaArrendatarioId"/>

      <!-- Fila 1: Arrendatario + Encargado -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Arrendatario</label>
          <input id="visitaArrendatarioNombre" type="text" readonly class="bg-gray-50 font-semibold text-blue-800"/>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">
            <i class="fas fa-user mr-1 text-blue-500"></i>Nombre del encargado <span class="text-red-500">*</span>
          </label>
          <input id="visitaEncargado" type="text" placeholder="Ej: Carlos Alcivar" required
            class="border-blue-300 focus:border-blue-500"/>
        </div>
      </div>

      <!-- Fila 2: Fecha + Entregó -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">
            <i class="fas fa-calendar mr-1 text-green-500"></i>Fecha de Visita <span class="text-red-500">*</span>
          </label>
          <input id="visitaFecha" type="date" required/>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">¿Entregó documentos?</label>
          <select id="visitaEntrego" onchange="toggleMotivo()">
            <option value="1">✅ SÍ entregó</option>
            <option value="0">❌ NO entregó</option>
          </select>
        </div>
      </div>

      <!-- SI ENTREGÓ: docs entregados -->
      <div id="campoDocumentosEntregados" class="bg-green-50 border border-green-200 rounded-lg p-4">
        <label class="block text-sm font-semibold text-green-800 mb-2">
          <i class="fas fa-check-circle mr-1"></i>Documentos entregados
        </label>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Permiso Bomberos" class="doc-check-si w-4 h-4"> Permiso Bomberos</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Patente" class="doc-check-si w-4 h-4"> Patente</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Tasa Habilitación" class="doc-check-si w-4 h-4"> Tasa Habilitación</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Registro Turismo" class="doc-check-si w-4 h-4"> Registro Turismo</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Trampa Grasa" class="doc-check-si w-4 h-4"> Trampa Grasa</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="ARCSA" class="doc-check-si w-4 h-4"> ARCSA</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Póliza/Seguro" class="doc-check-si w-4 h-4"> Póliza / Seguro</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Otros" class="doc-check-si w-4 h-4"> Otros</label>
        </div>
        <textarea id="visitaDocEntregados" rows="2" placeholder="Detalle adicional de lo entregado..."></textarea>
      </div>

      <!-- DOCUMENTOS FALTANTES (siempre visible) -->
      <div class="bg-red-50 border border-red-200 rounded-lg p-4">
        <label class="block text-sm font-semibold text-red-800 mb-2">
          <i class="fas fa-exclamation-triangle mr-1 text-red-500"></i>Documentos faltantes / pendientes
        </label>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Permiso Bomberos" class="doc-check-no w-4 h-4"> Permiso Bomberos</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Patente" class="doc-check-no w-4 h-4"> Patente</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Tasa Habilitación" class="doc-check-no w-4 h-4"> Tasa Habilitación</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Registro Turismo" class="doc-check-no w-4 h-4"> Registro Turismo</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Trampa Grasa" class="doc-check-no w-4 h-4"> Trampa Grasa</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="ARCSA" class="doc-check-no w-4 h-4"> ARCSA</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Póliza/Seguro" class="doc-check-no w-4 h-4"> Póliza / Seguro</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Otros" class="doc-check-no w-4 h-4"> Otros</label>
        </div>
        <textarea id="visitaDocFaltantes" rows="1" placeholder="Detalle de pendientes (ej: prometió enviar el lunes)..."></textarea>
      </div>

      <!-- NO ENTREGÓ: motivo -->
      <div id="campoMotivo" class="hidden bg-orange-50 border border-orange-200 rounded-lg p-4">
        <label class="block text-sm font-semibold text-orange-800 mb-1">
          <i class="fas fa-comment-alt mr-1"></i>Motivo de no entrega
        </label>
        <textarea id="visitaMotivoNoEntrega" rows="2" placeholder="Ej: No estaban en el local, prometió enviar el viernes..."></textarea>
      </div>

      <!-- Notas adicionales -->
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">
          <i class="fas fa-sticky-note mr-1 text-gray-400"></i>Observaciones / Notas adicionales
        </label>
        <textarea id="visitaDescripcion" rows="2" placeholder="Notas adicionales de la visita..."></textarea>
      </div>

      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="document.getElementById('modalNuevaVisita').classList.add('hidden')"
          class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-5 py-2 rounded-lg font-semibold">Cancelar</button>
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold flex items-center gap-2">
          <i class="fas fa-save"></i> Guardar Visita
        </button>
      </div>
    </form>
  </div>
</div>

<!-- ══ MODAL SUBIR DOCUMENTO ══ -->
<div id="modalSubirDoc" class="modal-overlay hidden" onclick="if(event.target===this)this.classList.add('hidden')">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-upload mr-2 text-blue-600"></i>Subir Documento</h2>
      <button onclick="document.getElementById('modalSubirDoc').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <div id="uploadInfo" class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-700 font-semibold"></div>

    <!-- Aviso de actualización automática de status -->
    <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
      <i class="fas fa-magic mr-1 text-green-600"></i>
      <strong>Actualización automática:</strong> Al subir el documento, el status del permiso correspondiente
      cambiará de <span class="bg-yellow-100 text-yellow-800 px-1 rounded font-bold">Pendiente</span>
      a <span class="bg-green-100 text-green-800 px-1 rounded font-bold">✅ Recibido</span> automáticamente.
    </div>

    <form id="formSubirDoc" onsubmit="submitDocumento(event)" class="space-y-4">
      <input type="hidden" id="docArrendatarioId"/>
      <input type="hidden" id="docArrendatarioNombreHidden"/>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Tipo de Permiso / Documento <span class="text-red-500">*</span></label>
        <select id="docTipoPermiso" required>
          <option value="">Seleccionar tipo...</option>
          <option value="Permiso Bomberos">🔥 Permiso de Bomberos</option>
          <option value="Patente">📋 Patente Municipal</option>
          <option value="Tasa Habilitación">🏛️ Tasa de Habilitación</option>
          <option value="Registro Turismo">🌟 Registro Ministerio Turismo</option>
          <option value="Licencia Turismo">🎫 Licencia Turismo Municipio</option>
          <option value="Trampa Grasa">🪣 Trampa de Grasas</option>
          <option value="ARCSA">💊 ARCSA</option>
          <option value="Certificado Ambiental">🌿 Certificado Ambiental</option>
          <option value="Póliza Seguro">🛡️ Póliza y Seguro</option>
          <option value="Soprofon/Sayce">🎵 Soprofon/Sayce</option>
          <option value="EGEDA">🎬 EGEDA</option>
          <option value="Otros">📎 Otros</option>
        </select>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Archivo (imagen, PDF, doc...) <span class="text-red-500">*</span></label>
        <input id="docArchivo" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" required class="text-sm"/>
        <p class="text-xs text-gray-400 mt-1">Se guardará como: <strong id="docNombrePreview" class="text-blue-700">MARCA - Tipo.ext</strong></p>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Descripción (opcional)</label>
        <textarea id="docDescripcion" rows="2" placeholder="Fecha de vencimiento, observaciones..."></textarea>
      </div>
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="document.getElementById('modalSubirDoc').classList.add('hidden')"
          class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-5 py-2 rounded-lg font-semibold">Cancelar</button>
        <button type="submit" id="btnSubir" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold flex items-center gap-2">
          <i class="fas fa-upload"></i> Subir Documento
        </button>
      </div>
    </form>
  </div>
</div>

<!-- ══ MODAL DOCUMENTOS GLOBALES ══ -->
<div id="modalDocsGlobal" class="modal-overlay hidden" onclick="if(event.target===this)this.classList.add('hidden')">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-folder-open mr-2 text-violet-600"></i>Registro Global de Documentos Subidos</h2>
      <button onclick="document.getElementById('modalDocsGlobal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <div id="docsGlobalFiltro" class="mb-4 flex gap-2 flex-wrap">
      <input id="docsGlobalSearch" type="text" placeholder="Buscar por marca o tipo..." onkeyup="filterDocsGlobal()" class="text-sm flex-1 min-w-[180px]"/>
      <select id="docsGlobalTipo" onchange="filterDocsGlobal()" class="text-sm w-48">
        <option value="">Todos los tipos</option>
        <option value="Permiso Bomberos">🔥 Permiso Bomberos</option>
        <option value="Patente">📋 Patente</option>
        <option value="Tasa Habilitación">🏛️ Tasa Habilitación</option>
        <option value="Registro Turismo">🌟 Registro Turismo</option>
        <option value="Licencia Turismo">🎫 Licencia Turismo</option>
        <option value="Trampa Grasa">🪣 Trampa Grasa</option>
        <option value="ARCSA">💊 ARCSA</option>
        <option value="Certificado Ambiental">🌿 Cert. Ambiental</option>
        <option value="Póliza Seguro">🛡️ Póliza Seguro</option>
        <option value="Otros">📎 Otros</option>
      </select>
    </div>
    <div id="docsGlobalContenido"></div>
  </div>
</div>

<script>
let allData = [], allDocsGlobal = [], debounceTimer = null

async function init() {
  await loadFiltros()
  await loadArrendatarios()
  document.getElementById('visitaFecha').value = todayStr()
  document.getElementById('docTipoPermiso').addEventListener('change', updateDocPreview)
  document.getElementById('docArchivo').addEventListener('change', updateDocPreview)
}

function todayStr() { return new Date().toISOString().split('T')[0] }

// ── Filtros ──────────────────────────────────────────────────────────────────
async function loadFiltros() {
  const { data } = await axios.get('/api/filtros')
  const ts = document.getElementById('filterTipo'), us = document.getElementById('filterUbicacion')
  data.tipos.forEach(t => { const o=document.createElement('option');o.value=t;o.textContent=t;ts.appendChild(o) })
  data.ubicaciones.forEach(u => { const o=document.createElement('option');o.value=u;o.textContent=u;us.appendChild(o) })
}

// ── Cargar tarjetas ───────────────────────────────────────────────────────────
async function loadArrendatarios() {
  showLoading(true)
  const p = {}
  const s = document.getElementById('searchInput').value
  const t = document.getElementById('filterTipo').value
  const u = document.getElementById('filterUbicacion').value
  const pl = document.getElementById('filterPoliza').value
  if (s) p.search = s; if (t) p.tipo = t; if (u) p.ubicacion = u; if (pl) p.status_poliza = pl
  const { data } = await axios.get('/api/arrendatarios', { params: p })
  allData = data; renderCards(data); renderStats(data); showLoading(false)
}
function debouncedLoad() { clearTimeout(debounceTimer); debounceTimer = setTimeout(loadArrendatarios, 350) }
function clearFilters() {
  ['searchInput','filterTipo','filterUbicacion','filterPoliza'].forEach(id => {
    const el = document.getElementById(id); if (el.tagName==='INPUT') el.value=''; else el.value=''
  })
  loadArrendatarios()
}
function showLoading(s) {
  document.getElementById('loading').classList.toggle('hidden',!s)
  document.getElementById('arrendatariosList').classList.toggle('hidden',s)
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function renderStats(data) {
  const bar = document.getElementById('statsBar')
  const total = data.length
  const vigB  = data.filter(r => r.status_bomberos?.toLowerCase()==='vigente').length
  const recB  = data.filter(r => r.status_bomberos?.toLowerCase()==='recibido').length
  const vigTH = data.filter(r => r.status_th?.toLowerCase()==='vigente').length
  const vigP  = data.filter(r => r.status_poliza==='Vigente').length
  const pend  = data.filter(r => !r.status_bomberos || r.status_bomberos.toLowerCase()==='pendiente').length
  const conDocs = data.filter(r => (r.docs_count||0) > 0).length
  bar.innerHTML = [
    {icon:'fa-building',label:'Total',val:total,cls:'bg-blue-100 text-blue-800'},
    {icon:'fa-fire',label:'Bomberos Vigente',val:vigB,cls:'bg-green-100 text-green-800'},
    {icon:'fa-check-circle',label:'Bomberos Recibido',val:recB,cls:'bg-emerald-100 text-emerald-800'},
    {icon:'fa-clock',label:'Bomberos Pendiente',val:pend,cls:'bg-yellow-100 text-yellow-800'},
    {icon:'fa-stamp',label:'TH Vigente',val:vigTH,cls:'bg-teal-100 text-teal-800'},
    {icon:'fa-shield-alt',label:'Póliza Vigente',val:vigP,cls:'bg-indigo-100 text-indigo-800'},
    {icon:'fa-paperclip',label:'Con Docs Subidos',val:conDocs,cls:'bg-violet-100 text-violet-800'},
  ].map(s=>\`<div class="\${s.cls} rounded-lg px-3 py-2 flex items-center gap-2 text-xs font-semibold">
    <i class="fas \${s.icon}"></i>\${s.label}: <span class="font-bold">\${s.val}</span></div>\`).join('')
}

// ── Tarjetas ──────────────────────────────────────────────────────────────────
function renderCards(data) {
  const list = document.getElementById('arrendatariosList')
  const empty = document.getElementById('emptyState')
  if (!data.length) { list.innerHTML=''; empty.classList.remove('hidden'); return }
  empty.classList.add('hidden')
  list.innerHTML = data.map(a => {
    const bCls  = sc2(a.status_bomberos)
    const tCls  = sc2(a.status_th)
    const pCls  = scPol(a.status_poliza)
    const ptCls = sc2(a.status_patente)
    const docsCount = a.docs_count || 0
    // Lista de tipos de docs subidos para mostrar checkmarks
    const docsTipos = a.docs_tipos ? a.docs_tipos.split('||') : []

    // Badge de bomberos: si ya tiene doc subido, mostrar "Recibido"
    const bLabel = a.status_bomberos || 'Pendiente'
    const tLabel = a.status_th || 'Pendiente'
    const ptLabel = a.status_patente || 'Pendiente'
    const pLabel = a.status_poliza || 'Pendiente'

    return \`<div class="bg-white rounded-xl shadow card-hover cursor-pointer border border-gray-100 overflow-hidden relative" onclick="openDetalle(\${a.id})">
      \${docsCount>0 ? \`<div class="doc-uploaded-badge"><i class="fas fa-paperclip mr-1"></i>\${docsCount} doc\${docsCount>1?'s':''}</div>\` : ''}
      <div class="bg-gradient-to-r from-blue-800 to-blue-600 px-4 py-3">
        <div class="flex justify-between items-start gap-2">
          <h3 class="text-white font-bold text-base leading-tight pr-6">\${a.arrendatario}</h3>
          <span class="text-blue-200 text-xs whitespace-nowrap">#\${a.item||'-'}</span>
        </div>
        <div class="flex gap-2 mt-1 flex-wrap">
          <span class="text-blue-200 text-xs"><i class="fas fa-store mr-1"></i>\${a.tipo||'-'}</span>
          <span class="text-blue-200 text-xs"><i class="fas fa-map-marker-alt mr-1"></i>\${a.ubicacion||'-'}</span>
        </div>
      </div>
      <div class="p-4">
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div class="perm-card \${bCls}\${docsTipos.includes('Permiso Bomberos')?' has-doc':''}">
            <i class="fas fa-fire mr-1"></i>Bomberos<br/>\${bLabel}
          </div>
          <div class="perm-card \${tCls}\${docsTipos.includes('Tasa Habilitación')?' has-doc':''}">
            <i class="fas fa-stamp mr-1"></i>T.Hab.<br/>\${tLabel}
          </div>
          <div class="perm-card \${ptCls}\${docsTipos.includes('Patente')?' has-doc':''}">
            <i class="fas fa-file-alt mr-1"></i>Patente<br/>\${ptLabel}
          </div>
          <div class="perm-card \${pCls}\${docsTipos.includes('Póliza Seguro')?' has-doc':''}">
            <i class="fas fa-shield-alt mr-1"></i>Póliza<br/>\${pLabel}
          </div>
        </div>
        <div class="flex gap-2 justify-end">
          <button onclick="event.stopPropagation();openNuevaVisita(\${a.id},'\${ej(a.arrendatario)}')"
            class="bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1">
            <i class="fas fa-calendar-plus"></i>Visita
          </button>
          <button onclick="event.stopPropagation();openSubirDoc(\${a.id},'\${ej(a.arrendatario)}')"
            class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1">
            <i class="fas fa-upload"></i>Doc
          </button>
        </div>
      </div>
    </div>\`
  }).join('')
}

function ej(s) { return (s||'').replace(/'/g,"\\\\'").replace(/"/g,'&quot;') }
function sc2(s) {
  if (!s) return 'sp'
  const sl = s.toLowerCase()
  if (sl==='vigente')    return 'sv'
  if (sl==='recibido')   return 'sr'
  if (sl==='pendiente')  return 'sp'
  if (sl==='caducado' || sl==='vencido') return 'sc'
  if (sl==='condicionado') return 'sco'
  if (sl==='no aplica') return 'sna'
  return 'sp'
}
function scPol(s) {
  if (!s) return 'sp'
  if (s==='Vigente')                      return 'spp'
  if (s==='Pronto a Caducar al 31/5/26')  return 'sco'
  if (s==='Pendiente por recibir')        return 'sp'
  return 'sp'
}

// ── Modal Detalle ─────────────────────────────────────────────────────────────
async function openDetalle(id) {
  const { data } = await axios.get(\`/api/arrendatarios/\${id}\`)
  document.getElementById('modalContent').innerHTML = renderDetalle(data)
  document.getElementById('modalDetalle').classList.remove('hidden')
}

function renderDetalle(a) {
  const docsTipos = (a.documentos||[]).map(d => d.tipo_permiso)
  const tieneDoc  = (t) => docsTipos.includes(t)

  const permisos = [
    {label:'Permiso Bomberos', key:'Permiso Bomberos', status:a.status_bomberos, fecha:a.fecha_bomberos},
    {label:'Patente',          key:'Patente',          status:a.status_patente,  fecha:a.fecha_patente},
    {label:'Tasa Habilitación',key:'Tasa Habilitación',status:a.status_th,       fecha:a.fecha_tasa_hab},
    {label:'Turismo',          key:'Registro Turismo', status:a.status_turismo,  fecha:a.fecha_turismo},
    {label:'Lic. Turismo',     key:'Licencia Turismo', status:a.status_lic_turismo, fecha:a.fecha_lic_turismo},
    {label:'Trampa Grasa',     key:'Trampa Grasa',     status:a.status_trampa_grasa, fecha:a.fecha_trampa_grasa},
    {label:'ARCSA',            key:'ARCSA',            status:a.status_arcsa,    fecha:a.arcsa_fin?'Fin: '+a.arcsa_fin:null},
    {label:'Póliza',           key:'Póliza Seguro',    status:a.status_poliza,   fecha:a.poliza_caducidad?'Vence: '+a.poliza_caducidad:null},
    {label:'Soprofon',         key:null,               status:a.soprofon,        fecha:null},
    {label:'EGEDA',            key:null,               status:a.egeda,           fecha:null},
  ]

  const docsHTML = !(a.documentos||[]).length
    ? '<p class="text-gray-400 text-sm text-center py-6"><i class="fas fa-folder-open text-3xl block mb-2"></i>Sin documentos subidos aún</p>'
    : \`<div class="space-y-2">
        \${(a.documentos||[]).map(d=>\`
        <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div class="text-2xl shrink-0">\${dIcon(d.nombre_archivo)}</div>
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-sm text-gray-800 truncate">\${d.nombre_archivo}</p>
            <div class="flex gap-2 flex-wrap mt-1">
              <span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">\${d.tipo_permiso}</span>
              <span class="text-xs text-gray-400">\${(d.fecha_subida||'').split('T')[0]}</span>
            </div>
            \${d.descripcion?\`<p class="text-xs text-gray-400 mt-1">\${d.descripcion}</p>\`:''}
          </div>
          <div class="flex gap-2 shrink-0">
            <a href="\${d.url_archivo}" download="\${d.nombre_archivo}" target="_blank"
               class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded text-xs font-semibold">
              <i class="fas fa-download"></i>
            </a>
            <button onclick="deleteDoc(\${d.id},\${a.id})"
              class="bg-red-100 hover:bg-red-200 text-red-600 px-2 py-1 rounded text-xs font-semibold">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>\`).join('')}
      </div>\`

  const visitasHTML = !(a.visitas||[]).length
    ? '<p class="text-gray-400 text-sm text-center py-6"><i class="fas fa-calendar-times text-3xl block mb-2"></i>Sin visitas registradas</p>'
    : (a.visitas||[]).map(v=>\`
      <div class="p-3 border border-gray-200 rounded-lg">
        <div class="flex justify-between items-start gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-bold text-gray-700"><i class="fas fa-calendar mr-1 text-blue-500"></i>\${v.fecha_visita}</span>
            \${v.encargado?\`<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold"><i class="fas fa-user mr-1"></i>\${v.encargado}</span>\`:''}
            <span class="badge \${v.entrego_documentos?'bg-green-100 text-green-700':'bg-red-100 text-red-700'}">
              \${v.entrego_documentos?'✅ Entregó':'❌ No entregó'}
            </span>
          </div>
          <button onclick="deleteVisita(\${v.id},\${a.id})" class="text-red-400 hover:text-red-600 text-sm shrink-0"><i class="fas fa-trash"></i></button>
        </div>
        \${v.documentos_entregados?\`<p class="text-xs text-green-700 mt-1"><strong>✅ Entregó:</strong> \${v.documentos_entregados}</p>\`:''}
        \${v.documentos_faltantes?\`<p class="text-xs text-red-600 mt-1"><strong>⚠️ Faltantes:</strong> \${v.documentos_faltantes}</p>\`:''}
        \${v.motivo_no_entrega?\`<p class="text-xs text-orange-600 mt-1"><strong>Motivo:</strong> \${v.motivo_no_entrega}</p>\`:''}
        \${v.descripcion?\`<p class="text-xs text-gray-500 mt-1">\${v.descripcion}</p>\`:''}
      </div>\`).join('')

  return \`
  <div class="bg-gradient-to-r from-blue-900 to-blue-700 px-6 py-5 rounded-t-xl">
    <div class="flex justify-between items-start gap-4">
      <div>
        <h2 class="text-white text-xl font-bold">\${a.arrendatario}</h2>
        <div class="flex gap-3 mt-1 flex-wrap text-blue-200 text-sm">
          <span><i class="fas fa-store mr-1"></i>\${a.tipo||'-'}</span>
          <span><i class="fas fa-map-marker-alt mr-1"></i>\${a.ubicacion||'-'}</span>
          \${a.primer_visita?\`<span><i class="fas fa-calendar mr-1"></i>1ª visita: \${a.primer_visita}</span>\`:''}
        </div>
        \${(a.documentos||[]).length>0?\`
        <div class="mt-2">
          <span class="text-xs bg-white/20 text-white px-2 py-1 rounded-full">
            <i class="fas fa-paperclip mr-1"></i>\${(a.documentos||[]).length} documento(s) subido(s)
          </span>
        </div>\`:''}
      </div>
      <button onclick="document.getElementById('modalDetalle').classList.add('hidden')" class="text-white/70 hover:text-white text-3xl leading-none">&times;</button>
    </div>
    <div class="flex gap-2 mt-3 flex-wrap">
      <button onclick="document.getElementById('modalDetalle').classList.add('hidden');openNuevaVisita(\${a.id},'\${ej(a.arrendatario)}')"
        class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-calendar-plus"></i>Nueva Visita
      </button>
      <button onclick="document.getElementById('modalDetalle').classList.add('hidden');openSubirDoc(\${a.id},'\${ej(a.arrendatario)}')"
        class="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-upload"></i>Subir Doc
      </button>
    </div>
  </div>
  <div class="p-5">
    <div class="flex gap-2 mb-4 overflow-x-auto pb-1">
      <button class="tab-btn active" onclick="swTab(this,'tPermisos')"><i class="fas fa-clipboard-list mr-1"></i>Permisos</button>
      <button class="tab-btn" onclick="swTab(this,'tDocs')">
        <i class="fas fa-folder mr-1"></i>Docs
        <span class="ml-1 \${(a.documentos||[]).length>0?'bg-green-500 text-white':'bg-gray-300 text-gray-600'} text-xs px-1.5 py-0.5 rounded-full">
          \${(a.documentos||[]).length}
        </span>
      </button>
      <button class="tab-btn" onclick="swTab(this,'tVisitas')"><i class="fas fa-calendar-check mr-1"></i>Visitas (\${(a.visitas||[]).length})</button>
      <button class="tab-btn" onclick="swTab(this,'tInfo')"><i class="fas fa-info-circle mr-1"></i>Info</button>
    </div>
    <div id="tPermisos">
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        \${permisos.map(p=>{
          const cls = p.label==='Póliza'?scPol(p.status):sc2(p.status)
          const hasDoc = p.key && tieneDoc(p.key)
          return \`<div class="perm-card \${cls} flex flex-col gap-1 p-3 relative">
            <div class="flex justify-between items-start">
              <span class="font-bold text-xs">\${p.label}</span>
              \${hasDoc?\`<span title="Documento subido" class="text-green-600 text-xs">📎</span>\`:''}
            </div>
            <span class="text-sm">\${p.status||'Pendiente'}</span>
            \${p.fecha&&p.fecha!=='NO APLICA'?\`<span class="text-xs opacity-75">\${p.fecha}</span>\`:''}
          </div>\`
        }).join('')}
      </div>
      \${a.observaciones?\`<div class="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
        <p class="font-semibold text-yellow-800"><i class="fas fa-exclamation-triangle mr-1"></i>Observaciones</p>
        <p class="text-yellow-700 mt-1">\${a.observaciones}</p>
      </div>\`:''}
    </div>
    <div id="tDocs" class="hidden">\${docsHTML}</div>
    <div id="tVisitas" class="hidden space-y-3">\${visitasHTML}</div>
    <div id="tInfo" class="hidden">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        \${[['Grupo Marcas',a.grupos_marcas],['Status General',a.status_general],
           ['Seguimiento',a.seguimiento],['Gestión Legal',a.gestion_legal],
           ['Registro Cartas',a.registro_cartas],['Fecha Ingreso',a.fecha_ingreso],
           ['Última Categorización',a.ultima_categorizacion],['Cert. Ambiental',a.cert_ambiental],
           ['Manifiesto',a.manifiesto],['Rubro Póliza',a.rubro_poliza],
          ].filter(([,v])=>v&&v!=='null'&&v!='NO APLICA').map(([k,v])=>
          \`<div class="bg-gray-50 rounded-lg p-3"><span class="font-semibold text-gray-600">\${k}:</span> \${v}</div>\`
        ).join('')}
      </div>
    </div>
  </div>\`
}

function swTab(btn, tid) {
  const mc = document.getElementById('modalContent')
  mc.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'))
  btn.classList.add('active')
  mc.querySelectorAll('[id^="t"]').forEach(t=>t.classList.add('hidden'))
  mc.querySelector('#'+tid)?.classList.remove('hidden')
}
function dIcon(n) {
  const e=(n||'').split('.').pop()?.toLowerCase()
  if(['jpg','jpeg','png','gif','webp'].includes(e)) return '🖼️'
  if(e==='pdf') return '📄'
  if(['doc','docx'].includes(e)) return '📝'
  if(['xls','xlsx'].includes(e)) return '📊'
  return '📎'
}
function closeModal(e) { if(!e||e.target===document.getElementById('modalDetalle')) document.getElementById('modalDetalle').classList.add('hidden') }
async function deleteDoc(docId,arrId) { if(!confirm('¿Eliminar documento? Esto revertirá el status a Pendiente si no hay más documentos del mismo tipo.')) return; await axios.delete('/api/documentos/'+docId); openDetalle(arrId); loadArrendatarios() }
async function deleteVisita(vid,arrId) { if(!confirm('¿Eliminar visita?')) return; await axios.delete('/api/visitas/'+vid); openDetalle(arrId) }

// ── Nueva Visita ──────────────────────────────────────────────────────────────
function openNuevaVisita(id, nombre) {
  document.getElementById('visitaArrendatarioId').value = id
  document.getElementById('visitaArrendatarioNombre').value = nombre
  document.getElementById('visitaFecha').value = todayStr()
  document.getElementById('visitaEncargado').value = ''
  document.getElementById('visitaEntrego').value = '1'
  document.getElementById('visitaDescripcion').value = ''
  document.getElementById('visitaDocEntregados').value = ''
  document.getElementById('visitaDocFaltantes').value = ''
  document.getElementById('visitaMotivoNoEntrega').value = ''
  document.querySelectorAll('.doc-check-si,.doc-check-no').forEach(c=>c.checked=false)
  toggleMotivo()
  document.getElementById('modalNuevaVisita').classList.remove('hidden')
}
function toggleMotivo() {
  const e = document.getElementById('visitaEntrego').value==='1'
  document.getElementById('campoDocumentosEntregados').classList.toggle('hidden',!e)
  document.getElementById('campoMotivo').classList.toggle('hidden',e)
}
async function submitVisita(e) {
  e.preventDefault()
  const id       = document.getElementById('visitaArrendatarioId').value
  const fecha    = document.getElementById('visitaFecha').value
  const encargado= document.getElementById('visitaEncargado').value.trim()
  const entrego  = document.getElementById('visitaEntrego').value==='1'
  const checksSi = [...document.querySelectorAll('.doc-check-si:checked')].map(c=>c.value)
  const extraSi  = document.getElementById('visitaDocEntregados').value.trim()
  const checksNo = [...document.querySelectorAll('.doc-check-no:checked')].map(c=>c.value)
  const extraNo  = document.getElementById('visitaDocFaltantes').value.trim()
  const docsSi   = [...checksSi, extraSi].filter(Boolean).join(', ')
  const docsNo   = [...checksNo, extraNo].filter(Boolean).join(', ')
  const motivo   = document.getElementById('visitaMotivoNoEntrega').value.trim()
  const desc     = document.getElementById('visitaDescripcion').value.trim()

  if (!encargado) { showToast('⚠️ Ingresa el nombre del encargado','info'); return }

  await axios.post('/api/visitas', {
    arrendatario_id: parseInt(id),
    fecha_visita: fecha,
    encargado,
    entrego_documentos: entrego,
    documentos_entregados: entrego ? docsSi : null,
    documentos_faltantes: docsNo || null,
    motivo_no_entrega: !entrego ? motivo : null,
    descripcion: desc
  })
  document.getElementById('modalNuevaVisita').classList.add('hidden')
  showToast('✅ Visita registrada correctamente','success')
  loadArrendatarios()
}

// ── Historial Visitas ─────────────────────────────────────────────────────────
async function openVisitasTab() {
  const { data } = await axios.get('/api/visitas')
  renderVisitasTable(data)
  document.getElementById('modalVisitas').classList.remove('hidden')
}

function renderVisitasTable(data) {
  const cont = document.getElementById('visitasHistorial')
  document.getElementById('visitasCount').textContent = data.length + ' visita(s) registrada(s)'
  if (!data.length) {
    cont.innerHTML = '<p class="text-gray-400 text-center py-10"><i class="fas fa-calendar-times text-4xl block mb-2"></i>No hay visitas registradas</p>'
    return
  }
  cont.innerHTML = \`
  <div id="visitasTableWrapper">
    <table id="visitasTable" class="copy-table">
      <thead>
        <tr>
          <th>ARRENDATARIO</th>
          <th>TIPO LOCAL</th>
          <th>UBICACIÓN</th>
          <th>FECHA VISITA</th>
          <th>ENCARGADO</th>
          <th>ENTREGÓ DOCS</th>
          <th>DOCUMENTOS ENTREGADOS</th>
          <th>DOCUMENTOS FALTANTES</th>
          <th>MOTIVO NO ENTREGA</th>
          <th>NOTAS / OBSERVACIONES</th>
          <th style="width:40px;background:#1e3a8a;border:1px solid #2563eb"></th>
        </tr>
      </thead>
      <tbody>
      \${data.map(v=>\`<tr>
        <td style="font-weight:600;min-width:140px">\${v.arrendatario||''}</td>
        <td style="font-size:11px;color:#6b7280;min-width:100px">\${v.tipo||''}</td>
        <td style="font-size:11px;color:#6b7280;min-width:120px">\${v.ubicacion||''}</td>
        <td style="white-space:nowrap;font-weight:600">\${v.fecha_visita||''}</td>
        <td style="min-width:110px">\${v.encargado||'-'}</td>
        <td style="text-align:center"><span class="\${v.entrego_documentos?'badge-si':'badge-no'}">\${v.entrego_documentos?'SÍ':'NO'}</span></td>
        <td style="color:#166534;min-width:160px;font-size:11px">\${v.documentos_entregados||'-'}</td>
        <td style="color:#991b1b;min-width:160px;font-size:11px">\${v.documentos_faltantes||'-'}</td>
        <td style="color:#9a3412;min-width:140px;font-size:11px">\${v.motivo_no_entrega||'-'}</td>
        <td style="color:#6b7280;min-width:160px;font-size:11px">\${v.descripcion||v.observaciones||'-'}</td>
        <td style="background:#fff8f8;text-align:center">
          <button onclick="deleteVisitaGlobal(\${v.id})" style="color:#ef4444;cursor:pointer;border:none;background:none;font-size:13px" title="Eliminar">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>\`).join('')}
      </tbody>
    </table>
  </div>\`
}

async function copyVisitasTable() {
  const table = document.getElementById('visitasTable')
  if (!table) { showToast('No hay datos que copiar','info'); return }
  // Clonar sin la columna de eliminar (última columna)
  const clone = table.cloneNode(true)
  // Remover última columna de cada fila
  clone.querySelectorAll('tr').forEach(row => {
    const lastCell = row.lastElementChild
    if (lastCell) lastCell.remove()
  })
  const tempDiv = document.createElement('div')
  tempDiv.style.position = 'fixed'
  tempDiv.style.left = '-9999px'
  tempDiv.appendChild(clone)
  document.body.appendChild(tempDiv)
  const range = document.createRange()
  range.selectNode(clone)
  window.getSelection().removeAllRanges()
  window.getSelection().addRange(range)
  try {
    const success = document.execCommand('copy')
    if (success) {
      showToast('✅ Tabla copiada — abre Excel, selecciona A1 y pega con Ctrl+V','success')
    } else {
      showToast('Selecciona la tabla manualmente con Ctrl+A y copia','info')
    }
  } catch {
    showToast('Usa Ctrl+A en la tabla para seleccionar y luego Ctrl+C','info')
  }
  window.getSelection().removeAllRanges()
  document.body.removeChild(tempDiv)
}

async function deleteVisitaGlobal(id) {
  if (!confirm('¿Eliminar esta visita?')) return
  await axios.delete('/api/visitas/'+id)
  showToast('Visita eliminada','success')
  openVisitasTab()
}

// ── Subir Documento ───────────────────────────────────────────────────────────
function openSubirDoc(id, nombre) {
  document.getElementById('docArrendatarioId').value = id
  document.getElementById('docArrendatarioNombreHidden').value = nombre
  document.getElementById('uploadInfo').innerHTML = \`<i class="fas fa-building mr-2"></i>Subiendo documento para: <strong>\${nombre}</strong>\`
  document.getElementById('docTipoPermiso').value = ''
  document.getElementById('docArchivo').value = ''
  document.getElementById('docDescripcion').value = ''
  document.getElementById('docNombrePreview').textContent = nombre + ' - Tipo.ext'
  document.getElementById('modalSubirDoc').classList.remove('hidden')
}
function updateDocPreview() {
  const nombre = document.getElementById('docArrendatarioNombreHidden').value || 'MARCA'
  const tipo   = document.getElementById('docTipoPermiso').value || 'Documento'
  const file   = document.getElementById('docArchivo').files?.[0]
  const ext    = file ? '.'+file.name.split('.').pop() : '.ext'
  document.getElementById('docNombrePreview').textContent = nombre + ' - ' + tipo + ext
}
async function submitDocumento(e) {
  e.preventDefault()
  const id     = document.getElementById('docArrendatarioId').value
  const nombre = document.getElementById('docArrendatarioNombreHidden').value
  const tipo   = document.getElementById('docTipoPermiso').value
  const file   = document.getElementById('docArchivo').files[0]
  const desc   = document.getElementById('docDescripcion').value
  if (!file || !tipo) return
  const ext = file.name.split('.').pop()
  const nombreArchivo = nombre + ' - ' + tipo + '.' + ext
  const reader = new FileReader()
  reader.onload = async (ev) => {
    const btn = document.getElementById('btnSubir')
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...'
    try {
      await axios.post('/api/documentos', {
        arrendatario_id: parseInt(id), tipo_permiso: tipo,
        nombre_archivo: nombreArchivo, url_archivo: ev.target.result, descripcion: desc
      })
      document.getElementById('modalSubirDoc').classList.add('hidden')
      showToast('✅ ' + nombreArchivo + ' subido — status actualizado a Recibido', 'success')
      loadArrendatarios()
    } catch(err) {
      showToast('❌ Error al subir el documento', 'info')
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fas fa-upload"></i> Subir Documento'
    }
  }
  reader.readAsDataURL(file)
}

// ── Registro Global Documentos ────────────────────────────────────────────────
async function openDocsGlobal() {
  const { data } = await axios.get('/api/documentos')
  allDocsGlobal = data
  renderDocsGlobal(data)
  document.getElementById('modalDocsGlobal').classList.remove('hidden')
}
function filterDocsGlobal() {
  const s = document.getElementById('docsGlobalSearch').value.toLowerCase()
  const t = document.getElementById('docsGlobalTipo').value
  const filtered = allDocsGlobal.filter(d =>
    (!s || d.arrendatario?.toLowerCase().includes(s) || d.tipo_permiso?.toLowerCase().includes(s) || d.nombre_archivo?.toLowerCase().includes(s)) &&
    (!t || d.tipo_permiso === t)
  )
  renderDocsGlobal(filtered)
}
function renderDocsGlobal(data) {
  const cont = document.getElementById('docsGlobalContenido')
  if (!data.length) {
    cont.innerHTML = '<p class="text-gray-400 text-center py-8"><i class="fas fa-folder-open text-4xl block mb-2"></i>Sin documentos subidos</p>'
    return
  }
  cont.innerHTML = \`<p class="text-xs text-gray-500 mb-3 font-semibold"><i class="fas fa-paperclip mr-1"></i>Mostrando \${data.length} documento(s) subidos</p>
  <div class="space-y-2">
    \${data.map(d=>\`
    <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-blue-200 transition-colors">
      <div class="text-2xl shrink-0">\${dIcon(d.nombre_archivo)}</div>
      <div class="flex-1 min-w-0">
        <p class="font-bold text-sm text-gray-800">\${d.arrendatario}</p>
        <p class="text-xs text-gray-600 truncate">\${d.nombre_archivo}</p>
        <div class="flex gap-2 mt-1 flex-wrap">
          <span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">\${d.tipo_permiso}</span>
          <span class="text-xs text-gray-400">\${d.tipo||''} · \${d.ubicacion||''}</span>
          <span class="text-xs text-gray-400"><i class="fas fa-clock mr-1"></i>\${(d.fecha_subida||'').split('T')[0]}</span>
        </div>
        \${d.descripcion?\`<p class="text-xs text-gray-400 mt-1">\${d.descripcion}</p>\`:''}
      </div>
      <div class="flex gap-2 shrink-0">
        <a href="\${d.url_archivo}" download="\${d.nombre_archivo}" target="_blank"
           class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1">
          <i class="fas fa-download"></i> Descargar
        </a>
        <button onclick="deleteDocGlobal(\${d.id})"
          class="bg-red-100 hover:bg-red-200 text-red-600 px-2 py-1.5 rounded-lg text-xs font-semibold">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>\`).join('')}
  </div>\`
}
async function deleteDocGlobal(id) {
  if (!confirm('¿Eliminar este documento? El status del permiso volverá a Pendiente.')) return
  await axios.delete('/api/documentos/'+id)
  showToast('Documento eliminado','success')
  openDocsGlobal()
  loadArrendatarios()
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportData(type) { window.open('/api/export/'+type,'_blank') }

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg, type) {
  const t = document.createElement('div')
  t.className = \`fixed bottom-5 right-5 z-[999] px-5 py-3 rounded-xl shadow-lg text-white font-semibold text-sm \${type==='success'?'bg-green-600':'bg-blue-600'}\`
  t.innerHTML = msg
  document.body.appendChild(t)
  setTimeout(()=>t.remove(), 4500)
}

init()
</script>
</body>
</html>`
}

export default app
