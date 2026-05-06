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

// ─── API: Setup DB (init tables + seed on first run) ─────────────────────────

app.get('/api/setup', async (c) => {
  try {
    // Create tables
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
      fecha_visita TEXT NOT NULL, entrego_documentos INTEGER DEFAULT 0,
      documentos_entregados TEXT, motivo_no_entrega TEXT, descripcion TEXT, observaciones TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (arrendatario_id) REFERENCES arrendatarios(id)
    )`).run()

    // Check if already seeded
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM arrendatarios').first<{n:number}>()
    if (count && count.n > 0) {
      return c.json({ ok: true, message: `DB already has ${count.n} arrendatarios`, seeded: false })
    }

    // Seed data
    const seedBatch = SEED_DATA.map(row =>
      c.env.DB.prepare(`INSERT INTO arrendatarios (item,tipo,ubicacion,arrendatario,grupos_marcas,fecha_bomberos,status_bomberos,fecha_patente,status_patente,fecha_tasa_hab,status_th,fecha_turismo,status_turismo,fecha_lic_turismo,status_lic_turismo,fecha_trampa_grasa,status_trampa_grasa,arcsa_inicio,arcsa_fin,status_arcsa,cert_ambiental,reg_desechos,cert_gestion_residuos,manifiesto,soprofon,egeda,status_general,observaciones,registro_cartas,seguimiento,gestion_legal,fecha_avances,fecha_ingreso,ultima_categorizacion,primer_visita,poliza_inicio,poliza_caducidad,status_poliza,rubro_poliza,fecha_entrega_poliza)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(...row)
    )

    // Insert in chunks of 50
    for (let i = 0; i < seedBatch.length; i += 50) {
      await c.env.DB.batch(seedBatch.slice(i, i + 50))
    }

    return c.json({ ok: true, message: `Seeded ${seedBatch.length} arrendatarios`, seeded: true })
  } catch (e: any) {
    return c.json({ ok: false, error: e.message }, 500)
  }
})

// ─── API: Arrendatarios ───────────────────────────────────────────────────────

app.get('/api/arrendatarios', async (c) => {
  const { tipo, ubicacion, status_poliza, search } = c.req.query()
  let query = 'SELECT * FROM arrendatarios WHERE 1=1'
  const params: string[] = []
  if (tipo) { query += ' AND tipo = ?'; params.push(tipo) }
  if (ubicacion) { query += ' AND ubicacion = ?'; params.push(ubicacion) }
  if (status_poliza) { query += ' AND status_poliza = ?'; params.push(status_poliza) }
  if (search) { query += ' AND (arrendatario LIKE ? OR ubicacion LIKE ?)'; params.push(`%${search}%`, `%${search}%`) }
  query += ' ORDER BY arrendatario ASC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(result.results)
})

app.get('/api/arrendatarios/:id', async (c) => {
  const id = c.req.param('id')
  const arr = await c.env.DB.prepare('SELECT * FROM arrendatarios WHERE id = ?').bind(id).first()
  if (!arr) return c.json({ error: 'Not found' }, 404)
  const docs = await c.env.DB.prepare('SELECT * FROM documentos WHERE arrendatario_id = ? ORDER BY fecha_subida DESC').bind(id).all()
  const visitas = await c.env.DB.prepare('SELECT * FROM visitas WHERE arrendatario_id = ? ORDER BY fecha_visita DESC').bind(id).all()
  return c.json({ ...arr, documentos: docs.results, visitas: visitas.results })
})

app.get('/api/filtros', async (c) => {
  const tipos = await c.env.DB.prepare("SELECT DISTINCT tipo FROM arrendatarios WHERE tipo IS NOT NULL ORDER BY tipo").all()
  const ubicaciones = await c.env.DB.prepare("SELECT DISTINCT ubicacion FROM arrendatarios WHERE ubicacion IS NOT NULL ORDER BY ubicacion").all()
  return c.json({
    tipos: tipos.results.map((r: any) => r.tipo),
    ubicaciones: ubicaciones.results.map((r: any) => r.ubicacion)
  })
})

// ─── API: Documentos ─────────────────────────────────────────────────────────

app.post('/api/documentos', async (c) => {
  const body = await c.req.json()
  const { arrendatario_id, tipo_permiso, nombre_archivo, url_archivo, descripcion } = body
  if (!arrendatario_id || !tipo_permiso || !nombre_archivo || !url_archivo) {
    return c.json({ error: 'Faltan campos requeridos' }, 400)
  }
  const result = await c.env.DB.prepare(
    'INSERT INTO documentos (arrendatario_id, tipo_permiso, nombre_archivo, url_archivo, descripcion) VALUES (?,?,?,?,?)'
  ).bind(arrendatario_id, tipo_permiso, nombre_archivo, url_archivo, descripcion || null).run()
  return c.json({ id: result.meta.last_row_id, success: true })
})

app.delete('/api/documentos/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM documentos WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ─── API: Visitas ─────────────────────────────────────────────────────────────

app.get('/api/visitas', async (c) => {
  const { arrendatario_id } = c.req.query()
  let query = `
    SELECT v.*, a.arrendatario, a.tipo, a.ubicacion 
    FROM visitas v JOIN arrendatarios a ON v.arrendatario_id = a.id
  `
  const params: any[] = []
  if (arrendatario_id) {
    query += ' WHERE v.arrendatario_id = ?'
    params.push(arrendatario_id)
  }
  query += ' ORDER BY v.fecha_visita DESC, v.created_at DESC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(result.results)
})

app.post('/api/visitas', async (c) => {
  const body = await c.req.json()
  const { arrendatario_id, fecha_visita, entrego_documentos, documentos_entregados, motivo_no_entrega, descripcion, observaciones } = body
  if (!arrendatario_id || !fecha_visita) {
    return c.json({ error: 'Faltan campos requeridos' }, 400)
  }
  const result = await c.env.DB.prepare(
    'INSERT INTO visitas (arrendatario_id, fecha_visita, entrego_documentos, documentos_entregados, motivo_no_entrega, descripcion, observaciones) VALUES (?,?,?,?,?,?,?)'
  ).bind(arrendatario_id, fecha_visita, entrego_documentos ? 1 : 0, documentos_entregados || null, motivo_no_entrega || null, descripcion || null, observaciones || null).run()
  return c.json({ id: result.meta.last_row_id, success: true })
})

app.delete('/api/visitas/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM visitas WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ─── API: Export Excel (CSV) ──────────────────────────────────────────────────

app.get('/api/export/visitas', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT v.id, a.arrendatario, a.tipo, a.ubicacion,
           v.fecha_visita, v.entrego_documentos, v.documentos_entregados,
           v.motivo_no_entrega, v.descripcion, v.observaciones, v.created_at
    FROM visitas v JOIN arrendatarios a ON v.arrendatario_id = a.id
    ORDER BY v.fecha_visita DESC
  `).all()
  
  const rows = result.results as any[]
  const headers = ['ID','Arrendatario','Tipo','Ubicación','Fecha Visita','Entregó Documentos','Documentos Entregados','Motivo No Entrega','Descripción','Observaciones','Fecha Registro']
  
  const escape = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v).replace(/"/g, '""')
    return `"${s}"`
  }

  let csv = '\uFEFF' // BOM para Excel
  csv += headers.map(escape).join(',') + '\r\n'
  for (const row of rows) {
    csv += [
      escape(row.id), escape(row.arrendatario), escape(row.tipo), escape(row.ubicacion),
      escape(row.fecha_visita), escape(row.entrego_documentos ? 'SÍ' : 'NO'),
      escape(row.documentos_entregados), escape(row.motivo_no_entrega),
      escape(row.descripcion), escape(row.observaciones), escape(row.created_at)
    ].join(',') + '\r\n'
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="visitas_campo.csv"'
    }
  })
})

app.get('/api/export/arrendatarios', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT id, item, tipo, ubicacion, arrendatario,
           status_bomberos, fecha_bomberos,
           status_patente, fecha_patente,
           status_th, fecha_tasa_hab,
           status_turismo, fecha_turismo,
           status_trampa_grasa, fecha_trampa_grasa,
           status_arcsa, arcsa_inicio, arcsa_fin,
           status_poliza, poliza_inicio, poliza_caducidad, rubro_poliza,
           observaciones
    FROM arrendatarios ORDER BY arrendatario
  `).all()

  const rows = result.results as any[]
  const headers = [
    '#','TIPO','UBICACIÓN','ARRENDATARIO',
    'STATUS BOMBEROS','FECHA BOMBEROS',
    'STATUS PATENTE','FECHA PATENTE',
    'STATUS TH','FECHA TH',
    'STATUS TURISMO','FECHA TURISMO',
    'STATUS TRAMPA GRASA','FECHA TRAMPA GRASA',
    'STATUS ARCSA','ARCSA INICIO','ARCSA FIN',
    'STATUS PÓLIZA','PÓLIZA INICIO','PÓLIZA CADUCIDAD','RUBRO PÓLIZA',
    'OBSERVACIONES'
  ]

  const escape = (v: any) => {
    if (v === null || v === undefined) return ''
    const s = String(v).replace(/"/g, '""')
    return `"${s}"`
  }

  let csv = '\uFEFF'
  csv += headers.map(escape).join(',') + '\r\n'
  for (const row of rows) {
    csv += [
      escape(row.item), escape(row.tipo), escape(row.ubicacion), escape(row.arrendatario),
      escape(row.status_bomberos), escape(row.fecha_bomberos),
      escape(row.status_patente), escape(row.fecha_patente),
      escape(row.status_th), escape(row.fecha_tasa_hab),
      escape(row.status_turismo), escape(row.fecha_turismo),
      escape(row.status_trampa_grasa), escape(row.fecha_trampa_grasa),
      escape(row.status_arcsa), escape(row.arcsa_inicio), escape(row.arcsa_fin),
      escape(row.status_poliza), escape(row.poliza_inicio), escape(row.poliza_caducidad), escape(row.rubro_poliza),
      escape(row.observaciones)
    ].join(',') + '\r\n'
  }

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="arrendatarios_permisos.csv"'
    }
  })
})

// ─── Frontend HTML ────────────────────────────────────────────────────────────

app.get('/', (c) => {
  return c.html(getHTML())
})

app.get('*', (c) => {
  return c.html(getHTML())
})

function getHTML() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Gestión de Permisos - Carlos Alcivar</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"/>
  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <style>
    * { font-family: 'Segoe UI', system-ui, sans-serif; }
    .status-vigente { background:#dcfce7; color:#166534; }
    .status-pendiente { background:#fef9c3; color:#854d0e; }
    .status-caducado { background:#fee2e2; color:#991b1b; }
    .status-condicionado { background:#fed7aa; color:#9a3412; }
    .status-no-aplica { background:#f3f4f6; color:#6b7280; }
    .status-vigente-poliza { background:#dbeafe; color:#1e40af; }
    .card-hover { transition: all .2s; }
    .card-hover:hover { transform: translateY(-2px); box-shadow: 0 10px 25px rgba(0,0,0,.15); }
    .modal-overlay { position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;align-items:center;justify-content:center;padding:1rem; }
    .modal-box { background:#fff;border-radius:1rem;max-width:900px;width:100%;max-height:90vh;overflow-y:auto; }
    .tab-btn { padding:.5rem 1rem;border-radius:.5rem;font-weight:600;transition:all .2s;cursor:pointer; }
    .tab-btn.active { background:#1e40af;color:#fff; }
    .tab-btn:not(.active) { background:#f3f4f6;color:#374151; }
    .tab-btn:not(.active):hover { background:#e5e7eb; }
    .badge { display:inline-block;padding:.2rem .6rem;border-radius:9999px;font-size:.75rem;font-weight:700; }
    input,select,textarea { border:1px solid #d1d5db;border-radius:.5rem;padding:.5rem .75rem;width:100%;outline:none; }
    input:focus,select:focus,textarea:focus { border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15); }
    .perm-card { border-radius:.5rem;padding:.5rem;font-size:.75rem;font-weight:600;text-align:center; }
    ::-webkit-scrollbar { width:6px; }
    ::-webkit-scrollbar-thumb { background:#cbd5e1;border-radius:3px; }
    @media(max-width:640px) { .modal-box { max-height:95vh; } }
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
      <button onclick="exportData('arrendatarios')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-file-excel"></i><span class="hidden sm:inline">Export Arrendatarios</span>
      </button>
      <button onclick="exportData('visitas')" class="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-file-csv"></i><span class="hidden sm:inline">Export Visitas</span>
      </button>
      <button onclick="openVisitasTab()" class="bg-white/20 hover:bg-white/30 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-calendar-check"></i><span class="hidden sm:inline">Historial Visitas</span>
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

<!-- STATS BAR -->
<div class="max-w-7xl mx-auto px-4 pb-3">
  <div id="statsBar" class="flex flex-wrap gap-3 mt-2"></div>
</div>

<!-- MAIN CONTENT -->
<main class="max-w-7xl mx-auto px-4 pb-8" id="mainContent">
  <div id="arrendatariosList" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"></div>
  <div id="loading" class="hidden text-center py-20">
    <i class="fas fa-spinner fa-spin text-4xl text-blue-500"></i>
    <p class="text-gray-500 mt-3">Cargando...</p>
  </div>
  <div id="emptyState" class="hidden text-center py-20">
    <i class="fas fa-search text-5xl text-gray-300"></i>
    <p class="text-gray-400 mt-3 text-lg">No se encontraron resultados</p>
  </div>
</main>

<!-- ═══════════════════ MODAL DETALLE ═══════════════════ -->
<div id="modalDetalle" class="modal-overlay hidden" onclick="closeModal(event)">
  <div class="modal-box p-0" onclick="event.stopPropagation()">
    <div id="modalContent"></div>
  </div>
</div>

<!-- ═══════════════════ MODAL VISITAS ═══════════════════ -->
<div id="modalVisitas" class="modal-overlay hidden" onclick="closeModalVisitas(event)">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-calendar-check mr-2 text-blue-600"></i>Historial de Visitas</h2>
      <button onclick="document.getElementById('modalVisitas').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <div class="flex justify-end mb-4">
      <button onclick="exportData('visitas')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-file-excel"></i> Exportar Excel
      </button>
    </div>
    <div id="visitasHistorial"></div>
  </div>
</div>

<!-- ═══════════════════ MODAL NUEVA VISITA ═══════════════════ -->
<div id="modalNuevaVisita" class="modal-overlay hidden" onclick="closeModalNV(event)">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-plus-circle mr-2 text-green-600"></i>Registrar Visita</h2>
      <button onclick="document.getElementById('modalNuevaVisita').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <form id="formVisita" onsubmit="submitVisita(event)" class="space-y-4">
      <input type="hidden" id="visitaArrendatarioId"/>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Arrendatario</label>
        <input id="visitaArrendatarioNombre" type="text" readonly class="bg-gray-50 font-semibold"/>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Fecha de Visita *</label>
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
      <div id="campoDocumentosEntregados">
        <label class="block text-sm font-semibold text-gray-700 mb-1">¿Qué documentos entregó?</label>
        <div class="grid grid-cols-2 gap-2 mb-2" id="checkboxDocs">
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" value="Permiso Bomberos" class="doc-check"> Permiso Bomberos</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" value="Patente" class="doc-check"> Patente</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" value="Tasa Habilitación" class="doc-check"> Tasa Habilitación</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" value="Turismo" class="doc-check"> Registro Turismo</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" value="Trampa Grasa" class="doc-check"> Trampa Grasa</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" value="ARCSA" class="doc-check"> ARCSA</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" value="Póliza" class="doc-check"> Póliza/Seguro</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" value="Otros" class="doc-check"> Otros</label>
        </div>
        <textarea id="visitaDocEntregados" rows="2" placeholder="Detalles adicionales de los documentos entregados..."></textarea>
      </div>
      <div id="campoMotivo" class="hidden">
        <label class="block text-sm font-semibold text-gray-700 mb-1">Motivo de no entrega *</label>
        <textarea id="visitaMotivoNoEntrega" rows="2" placeholder="Ej: No estaban en el local, prometió enviar por correo..."></textarea>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Descripción / Notas</label>
        <textarea id="visitaDescripcion" rows="2" placeholder="Observaciones adicionales de la visita..."></textarea>
      </div>
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="document.getElementById('modalNuevaVisita').classList.add('hidden')" class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-5 py-2 rounded-lg font-semibold">Cancelar</button>
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold flex items-center gap-2">
          <i class="fas fa-save"></i> Guardar Visita
        </button>
      </div>
    </form>
  </div>
</div>

<!-- ═══════════════════ MODAL SUBIR DOCUMENTO ═══════════════════ -->
<div id="modalSubirDoc" class="modal-overlay hidden" onclick="closeModalDoc(event)">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-upload mr-2 text-blue-600"></i>Subir Documento</h2>
      <button onclick="document.getElementById('modalSubirDoc').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <div id="uploadInfo" class="bg-blue-50 rounded-lg p-3 mb-4 text-sm text-blue-700"></div>
    <form id="formSubirDoc" onsubmit="submitDocumento(event)" class="space-y-4">
      <input type="hidden" id="docArrendatarioId"/>
      <input type="hidden" id="docArrendatarioNombreHidden"/>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Tipo de Permiso / Documento *</label>
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
        <label class="block text-sm font-semibold text-gray-700 mb-1">Archivo (imagen, PDF, documento) *</label>
        <input id="docArchivo" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx" required class="text-sm"/>
        <p class="text-xs text-gray-400 mt-1">El archivo se guardará como: <strong id="docNombrePreview">MARCA - Tipo.ext</strong></p>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Descripción (opcional)</label>
        <textarea id="docDescripcion" rows="2" placeholder="Ej: Fecha de vencimiento, observaciones..."></textarea>
      </div>
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="document.getElementById('modalSubirDoc').classList.add('hidden')" class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-5 py-2 rounded-lg font-semibold">Cancelar</button>
        <button type="submit" id="btnSubir" class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold flex items-center gap-2">
          <i class="fas fa-upload"></i> Subir Documento
        </button>
      </div>
    </form>
  </div>
</div>

<script>
let allData = []
let currentArrendatarioId = null
let debounceTimer = null

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await loadFiltros()
  await loadArrendatarios()
  setTodayDate()
}

function setTodayDate() {
  const today = new Date().toISOString().split('T')[0]
  const el = document.getElementById('visitaFecha')
  if (el) el.value = today
}

// ─── Load Filtros ─────────────────────────────────────────────────────────────
async function loadFiltros() {
  const { data } = await axios.get('/api/filtros')
  const tipoSel = document.getElementById('filterTipo')
  const ubSel = document.getElementById('filterUbicacion')
  data.tipos.forEach(t => {
    const o = document.createElement('option'); o.value=t; o.textContent=t; tipoSel.appendChild(o)
  })
  data.ubicaciones.forEach(u => {
    const o = document.createElement('option'); o.value=u; o.textContent=u; ubSel.appendChild(o)
  })
}

// ─── Load Arrendatarios ───────────────────────────────────────────────────────
async function loadArrendatarios() {
  showLoading(true)
  const search = document.getElementById('searchInput').value
  const tipo = document.getElementById('filterTipo').value
  const ubicacion = document.getElementById('filterUbicacion').value
  const poliza = document.getElementById('filterPoliza').value
  const params = {}
  if (search) params.search = search
  if (tipo) params.tipo = tipo
  if (ubicacion) params.ubicacion = ubicacion
  if (poliza) params.status_poliza = poliza
  const { data } = await axios.get('/api/arrendatarios', { params })
  allData = data
  renderCards(data)
  renderStats(data)
  showLoading(false)
}

function debouncedLoad() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(loadArrendatarios, 350)
}

function clearFilters() {
  document.getElementById('searchInput').value = ''
  document.getElementById('filterTipo').value = ''
  document.getElementById('filterUbicacion').value = ''
  document.getElementById('filterPoliza').value = ''
  loadArrendatarios()
}

function showLoading(show) {
  document.getElementById('loading').classList.toggle('hidden', !show)
  document.getElementById('arrendatariosList').classList.toggle('hidden', show)
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function renderStats(data) {
  const bar = document.getElementById('statsBar')
  const total = data.length
  const vigBomb = data.filter(r => r.status_bomberos?.toLowerCase() === 'vigente').length
  const vigTH = data.filter(r => r.status_th?.toLowerCase() === 'vigente').length
  const vigPol = data.filter(r => r.status_poliza === 'Vigente').length
  const pendBomb = data.filter(r => r.status_bomberos?.toLowerCase() === 'pendiente').length

  bar.innerHTML = [
    { icon:'fa-building', label:'Total', val: total, cls:'bg-blue-100 text-blue-800' },
    { icon:'fa-fire', label:'Bomberos Vigente', val: vigBomb, cls:'bg-green-100 text-green-800' },
    { icon:'fa-fire', label:'Bomberos Pendiente', val: pendBomb, cls:'bg-yellow-100 text-yellow-800' },
    { icon:'fa-stamp', label:'TH Vigente', val: vigTH, cls:'bg-emerald-100 text-emerald-800' },
    { icon:'fa-shield-alt', label:'Póliza Vigente', val: vigPol, cls:'bg-blue-100 text-blue-800' },
  ].map(s => \`<div class="\${s.cls} rounded-lg px-3 py-2 flex items-center gap-2 text-sm font-semibold">
    <i class="fas \${s.icon}"></i>\${s.label}: <span class="font-bold">\${s.val}</span></div>\`).join('')
}

// ─── Render Cards ─────────────────────────────────────────────────────────────
function renderCards(data) {
  const list = document.getElementById('arrendatariosList')
  const empty = document.getElementById('emptyState')
  if (!data.length) {
    list.innerHTML = ''; empty.classList.remove('hidden'); return
  }
  empty.classList.add('hidden')
  list.innerHTML = data.map(a => {
    const bStatus = getStatusClass(a.status_bomberos)
    const thStatus = getStatusClass(a.status_th)
    const polStatus = getPolizaClass(a.status_poliza)
    const patStatus = getStatusClass(a.status_patente)
    return \`
    <div class="bg-white rounded-xl shadow card-hover cursor-pointer border border-gray-100 overflow-hidden"
         onclick="openDetalle(\${a.id})">
      <div class="bg-gradient-to-r from-blue-800 to-blue-600 px-4 py-3">
        <div class="flex justify-between items-start gap-2">
          <h3 class="text-white font-bold text-base leading-tight">\${a.arrendatario}</h3>
          <span class="text-blue-200 text-xs whitespace-nowrap">#\${a.item || '-'}</span>
        </div>
        <div class="flex gap-2 mt-1 flex-wrap">
          <span class="text-blue-200 text-xs"><i class="fas fa-store mr-1"></i>\${a.tipo || '-'}</span>
          <span class="text-blue-200 text-xs"><i class="fas fa-map-marker-alt mr-1"></i>\${a.ubicacion || '-'}</span>
        </div>
      </div>
      <div class="p-4">
        <div class="grid grid-cols-2 gap-2 mb-3">
          <div class="perm-card \${bStatus}"><i class="fas fa-fire mr-1"></i>Bomberos<br/>\${a.status_bomberos || 'Pendiente'}</div>
          <div class="perm-card \${thStatus}"><i class="fas fa-stamp mr-1"></i>T. Hab.<br/>\${a.status_th || 'Pendiente'}</div>
          <div class="perm-card \${patStatus}"><i class="fas fa-file-alt mr-1"></i>Patente<br/>\${a.status_patente || 'Pendiente'}</div>
          <div class="perm-card \${polStatus}"><i class="fas fa-shield-alt mr-1"></i>Póliza<br/>\${a.status_poliza || 'Pendiente'}</div>
        </div>
        <div class="flex gap-2 justify-end mt-2">
          <button onclick="event.stopPropagation(); openNuevaVisita(\${a.id}, '\${escJS(a.arrendatario)}')"
            class="bg-green-100 hover:bg-green-200 text-green-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1">
            <i class="fas fa-calendar-plus"></i>Visita
          </button>
          <button onclick="event.stopPropagation(); openSubirDoc(\${a.id}, '\${escJS(a.arrendatario)}')"
            class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1">
            <i class="fas fa-upload"></i>Subir Doc
          </button>
        </div>
      </div>
    </div>\`
  }).join('')
}

function escJS(s) { return (s||'').replace(/'/g,"\\\\'").replace(/"/g,'&quot;') }

function getStatusClass(s) {
  if (!s) return 'status-pendiente'
  const sl = s.toLowerCase()
  if (sl === 'vigente') return 'status-vigente'
  if (sl === 'pendiente') return 'status-pendiente'
  if (sl === 'caducado') return 'status-caducado'
  if (sl === 'condicionado') return 'status-condicionado'
  if (sl === 'no aplica') return 'status-no-aplica'
  return 'status-pendiente'
}

function getPolizaClass(s) {
  if (!s) return 'status-pendiente'
  if (s === 'Vigente') return 'status-vigente-poliza'
  if (s === 'Pronto a Caducar al 31/5/26') return 'status-condicionado'
  if (s === 'Pendiente por recibir') return 'status-pendiente'
  return 'status-pendiente'
}

// ─── Modal Detalle ────────────────────────────────────────────────────────────
async function openDetalle(id) {
  currentArrendatarioId = id
  const { data } = await axios.get(\`/api/arrendatarios/\${id}\`)
  const modal = document.getElementById('modalDetalle')
  const content = document.getElementById('modalContent')
  content.innerHTML = renderDetalle(data)
  modal.classList.remove('hidden')
}

function renderDetalle(a) {
  const permisos = [
    { label:'Permiso Bomberos', status: a.status_bomberos, fecha: a.fecha_bomberos },
    { label:'Patente', status: a.status_patente, fecha: a.fecha_patente },
    { label:'Tasa Habilitación', status: a.status_th, fecha: a.fecha_tasa_hab },
    { label:'Turismo', status: a.status_turismo, fecha: a.fecha_turismo },
    { label:'Lic. Turismo', status: a.status_lic_turismo, fecha: a.fecha_lic_turismo },
    { label:'Trampa Grasa', status: a.status_trampa_grasa, fecha: a.fecha_trampa_grasa },
    { label:'ARCSA', status: a.status_arcsa, fecha: a.arcsa_fin ? \`Fin: \${a.arcsa_fin}\` : null },
    { label:'Póliza', status: a.status_poliza, fecha: a.poliza_caducidad ? \`Vence: \${a.poliza_caducidad}\` : null },
    { label:'Soprofon', status: a.soprofon, fecha: null },
    { label:'EGEDA', status: a.egeda, fecha: null },
  ]

  const docsHTML = (a.documentos || []).length === 0
    ? '<p class="text-gray-400 text-sm text-center py-6"><i class="fas fa-folder-open text-3xl block mb-2"></i>Sin documentos subidos</p>'
    : (a.documentos || []).map(d => \`
      <div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
        <div class="text-2xl">\${getDocIcon(d.nombre_archivo)}</div>
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-sm text-gray-800 truncate">\${d.nombre_archivo}</p>
          <p class="text-xs text-gray-500">\${d.tipo_permiso} · \${d.fecha_subida ? d.fecha_subida.split('T')[0] : ''}</p>
          \${d.descripcion ? \`<p class="text-xs text-gray-400 mt-1">\${d.descripcion}</p>\` : ''}
        </div>
        <div class="flex gap-2 shrink-0">
          <a href="\${d.url_archivo}" download="\${d.nombre_archivo}" target="_blank"
             class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded text-xs font-semibold flex items-center gap-1">
            <i class="fas fa-download"></i>
          </a>
          <button onclick="deleteDoc(\${d.id}, \${a.id})"
            class="bg-red-100 hover:bg-red-200 text-red-600 px-2 py-1 rounded text-xs font-semibold">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>\`).join('')

  const visitasHTML = (a.visitas || []).length === 0
    ? '<p class="text-gray-400 text-sm text-center py-6"><i class="fas fa-calendar-times text-3xl block mb-2"></i>Sin visitas registradas</p>'
    : (a.visitas || []).map(v => \`
      <div class="p-3 border border-gray-200 rounded-lg">
        <div class="flex justify-between items-start gap-2">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold text-gray-700"><i class="fas fa-calendar mr-1 text-blue-500"></i>\${v.fecha_visita}</span>
            <span class="badge \${v.entrego_documentos ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
              \${v.entrego_documentos ? '✅ Entregó' : '❌ No entregó'}
            </span>
          </div>
          <button onclick="deleteVisita(\${v.id}, \${a.id})" class="text-red-400 hover:text-red-600 text-sm">
            <i class="fas fa-trash"></i>
          </button>
        </div>
        \${v.documentos_entregados ? \`<p class="text-xs text-gray-600 mt-1"><strong>Docs:</strong> \${v.documentos_entregados}</p>\` : ''}
        \${v.motivo_no_entrega ? \`<p class="text-xs text-red-500 mt-1"><strong>Motivo:</strong> \${v.motivo_no_entrega}</p>\` : ''}
        \${v.descripcion ? \`<p class="text-xs text-gray-500 mt-1">\${v.descripcion}</p>\` : ''}
      </div>\`).join('')

  return \`
  <div class="bg-gradient-to-r from-blue-900 to-blue-700 px-6 py-5 rounded-t-xl">
    <div class="flex justify-between items-start gap-4">
      <div>
        <h2 class="text-white text-2xl font-bold">\${a.arrendatario}</h2>
        <div class="flex gap-3 mt-1 flex-wrap">
          <span class="text-blue-200 text-sm"><i class="fas fa-store mr-1"></i>\${a.tipo || '-'}</span>
          <span class="text-blue-200 text-sm"><i class="fas fa-map-marker-alt mr-1"></i>\${a.ubicacion || '-'}</span>
          \${a.primer_visita ? \`<span class="text-blue-200 text-sm"><i class="fas fa-calendar mr-1"></i>1ª visita: \${a.primer_visita}</span>\` : ''}
        </div>
      </div>
      <button onclick="closeModal()" class="text-white/70 hover:text-white text-3xl leading-none mt-1">&times;</button>
    </div>
    <div class="flex gap-2 mt-3 flex-wrap">
      <button onclick="document.getElementById('modalDetalle').classList.add('hidden'); openNuevaVisita(\${a.id}, '\${escJS(a.arrendatario)}')"
        class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-calendar-plus"></i>Nueva Visita
      </button>
      <button onclick="document.getElementById('modalDetalle').classList.add('hidden'); openSubirDoc(\${a.id}, '\${escJS(a.arrendatario)}')"
        class="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-upload"></i>Subir Documento
      </button>
    </div>
  </div>
  <div class="p-6">
    <!-- TABS -->
    <div class="flex gap-2 mb-5 overflow-x-auto pb-1">
      <button class="tab-btn active" onclick="switchTab(this,'tabPermisos')"><i class="fas fa-clipboard-list mr-1"></i>Permisos</button>
      <button class="tab-btn" onclick="switchTab(this,'tabDocumentos')"><i class="fas fa-folder mr-1"></i>Documentos (\${(a.documentos||[]).length})</button>
      <button class="tab-btn" onclick="switchTab(this,'tabVisitas')"><i class="fas fa-calendar-check mr-1"></i>Visitas (\${(a.visitas||[]).length})</button>
      <button class="tab-btn" onclick="switchTab(this,'tabInfo')"><i class="fas fa-info-circle mr-1"></i>Info</button>
    </div>

    <!-- TAB PERMISOS -->
    <div id="tabPermisos">
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
        \${permisos.map(p => {
          const cls = p.label==='Póliza' ? getPolizaClass(p.status) : getStatusClass(p.status)
          return \`<div class="perm-card \${cls} flex flex-col gap-1 p-3">
            <span class="font-bold text-xs">\${p.label}</span>
            <span class="text-sm">\${p.status || 'Pendiente'}</span>
            \${p.fecha && p.fecha!=='NO APLICA' ? \`<span class="text-xs opacity-75">\${p.fecha}</span>\` : ''}
          </div>\`
        }).join('')}
      </div>
      \${a.observaciones ? \`<div class="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
        <p class="text-sm font-semibold text-yellow-800"><i class="fas fa-exclamation-triangle mr-1"></i>Observaciones</p>
        <p class="text-sm text-yellow-700 mt-1">\${a.observaciones}</p>
      </div>\` : ''}
    </div>

    <!-- TAB DOCUMENTOS -->
    <div id="tabDocumentos" class="hidden space-y-2">\${docsHTML}</div>

    <!-- TAB VISITAS -->
    <div id="tabVisitas" class="hidden space-y-3">\${visitasHTML}</div>

    <!-- TAB INFO -->
    <div id="tabInfo" class="hidden">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        \${[
          ['Grupo Marcas', a.grupos_marcas],
          ['Status General', a.status_general],
          ['Seguimiento', a.seguimiento],
          ['Gestión Legal', a.gestion_legal],
          ['Registro Cartas', a.registro_cartas],
          ['Fecha Ingreso', a.fecha_ingreso],
          ['Última Categorización', a.ultima_categorizacion],
          ['Cert. Ambiental', a.cert_ambiental],
          ['Manifiesto', a.manifiesto],
          ['Rubro Póliza', a.rubro_poliza],
        ].filter(([,v]) => v && v!=='null').map(([k,v]) =>
          \`<div class="bg-gray-50 rounded-lg p-3"><span class="font-semibold text-gray-600">\${k}:</span> <span class="text-gray-800">\${v}</span></div>\`
        ).join('')}
      </div>
    </div>
  </div>\`
}

function switchTab(btn, tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  const modal = document.getElementById('modalContent')
  modal.querySelectorAll('[id^="tab"]').forEach(t => t.classList.add('hidden'))
  modal.querySelector('#' + tabId)?.classList.remove('hidden')
}

function getDocIcon(nombre) {
  const ext = (nombre || '').split('.').pop()?.toLowerCase()
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return '🖼️'
  if (ext === 'pdf') return '📄'
  if (['doc','docx'].includes(ext)) return '📝'
  if (['xls','xlsx'].includes(ext)) return '📊'
  return '📎'
}

function closeModal(e) {
  if (!e || e.target === document.getElementById('modalDetalle')) {
    document.getElementById('modalDetalle').classList.add('hidden')
  }
}

async function deleteDoc(docId, arrId) {
  if (!confirm('¿Eliminar este documento?')) return
  await axios.delete(\`/api/documentos/\${docId}\`)
  openDetalle(arrId)
}

async function deleteVisita(visitaId, arrId) {
  if (!confirm('¿Eliminar esta visita?')) return
  await axios.delete(\`/api/visitas/\${visitaId}\`)
  openDetalle(arrId)
}

// ─── Nueva Visita ─────────────────────────────────────────────────────────────
function openNuevaVisita(id, nombre) {
  document.getElementById('visitaArrendatarioId').value = id
  document.getElementById('visitaArrendatarioNombre').value = nombre
  setTodayDate()
  document.getElementById('visitaEntrego').value = '1'
  document.getElementById('visitaDescripcion').value = ''
  document.getElementById('visitaDocEntregados').value = ''
  document.getElementById('visitaMotivoNoEntrega').value = ''
  document.querySelectorAll('.doc-check').forEach(c => c.checked = false)
  toggleMotivo()
  document.getElementById('modalNuevaVisita').classList.remove('hidden')
}

function toggleMotivo() {
  const entrego = document.getElementById('visitaEntrego').value === '1'
  document.getElementById('campoDocumentosEntregados').classList.toggle('hidden', !entrego)
  document.getElementById('campoMotivo').classList.toggle('hidden', entrego)
}

async function submitVisita(e) {
  e.preventDefault()
  const id = document.getElementById('visitaArrendatarioId').value
  const fecha = document.getElementById('visitaFecha').value
  const entrego = document.getElementById('visitaEntrego').value === '1'
  const checks = [...document.querySelectorAll('.doc-check:checked')].map(c => c.value)
  const extraDocs = document.getElementById('visitaDocEntregados').value
  const docsEntregados = [...checks, extraDocs].filter(Boolean).join(', ')
  const motivo = document.getElementById('visitaMotivoNoEntrega').value
  const desc = document.getElementById('visitaDescripcion').value

  await axios.post('/api/visitas', {
    arrendatario_id: parseInt(id),
    fecha_visita: fecha,
    entrego_documentos: entrego,
    documentos_entregados: entrego ? docsEntregados : null,
    motivo_no_entrega: !entrego ? motivo : null,
    descripcion: desc
  })
  document.getElementById('modalNuevaVisita').classList.add('hidden')
  showToast('✅ Visita registrada correctamente', 'success')
  loadArrendatarios()
}

function closeModalVisitas(e) {
  if (e.target === document.getElementById('modalVisitas')) document.getElementById('modalVisitas').classList.add('hidden')
}
function closeModalNV(e) {
  if (e.target === document.getElementById('modalNuevaVisita')) document.getElementById('modalNuevaVisita').classList.add('hidden')
}
function closeModalDoc(e) {
  if (e.target === document.getElementById('modalSubirDoc')) document.getElementById('modalSubirDoc').classList.add('hidden')
}

// ─── Historial Visitas ────────────────────────────────────────────────────────
async function openVisitasTab() {
  const { data } = await axios.get('/api/visitas')
  const cont = document.getElementById('visitasHistorial')
  if (!data.length) {
    cont.innerHTML = '<p class="text-gray-400 text-center py-10"><i class="fas fa-calendar-times text-4xl block mb-2"></i>No hay visitas registradas</p>'
  } else {
    cont.innerHTML = \`<div class="overflow-x-auto rounded-lg border border-gray-200">
      <table class="w-full text-sm">
        <thead class="bg-blue-900 text-white">
          <tr>
            <th class="px-4 py-3 text-left">Arrendatario</th>
            <th class="px-4 py-3 text-left">Tipo/Ubicación</th>
            <th class="px-4 py-3 text-left">Fecha</th>
            <th class="px-4 py-3 text-left">Resultado</th>
            <th class="px-4 py-3 text-left">Detalle</th>
            <th class="px-4 py-3 text-center">Acción</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          \${data.map((v, i) => \`<tr class="\${i%2===0?'bg-white':'bg-gray-50'}">
            <td class="px-4 py-3 font-semibold text-gray-800">\${v.arrendatario}</td>
            <td class="px-4 py-3 text-gray-500 text-xs">\${v.tipo || ''}<br/>\${v.ubicacion || ''}</td>
            <td class="px-4 py-3 text-gray-700 whitespace-nowrap">\${v.fecha_visita}</td>
            <td class="px-4 py-3">
              <span class="badge \${v.entrego_documentos ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                \${v.entrego_documentos ? '✅ Entregó' : '❌ No entregó'}
              </span>
            </td>
            <td class="px-4 py-3 text-xs text-gray-500 max-w-[200px]">
              \${v.documentos_entregados || v.motivo_no_entrega || v.descripcion || '-'}
            </td>
            <td class="px-4 py-3 text-center">
              <button onclick="deleteVisitaGlobal(\${v.id})" class="text-red-400 hover:text-red-600 text-sm">
                <i class="fas fa-trash"></i>
              </button>
            </td>
          </tr>\`).join('')}
        </tbody>
      </table>
    </div>\`
  }
  document.getElementById('modalVisitas').classList.remove('hidden')
}

async function deleteVisitaGlobal(id) {
  if (!confirm('¿Eliminar esta visita?')) return
  await axios.delete(\`/api/visitas/\${id}\`)
  showToast('Visita eliminada', 'success')
  openVisitasTab()
}

// ─── Subir Documento ──────────────────────────────────────────────────────────
function openSubirDoc(id, nombre) {
  document.getElementById('docArrendatarioId').value = id
  document.getElementById('docArrendatarioNombreHidden').value = nombre
  document.getElementById('uploadInfo').innerHTML = \`<i class="fas fa-building mr-1"></i> Subiendo documento para: <strong>\${nombre}</strong>\`
  document.getElementById('docTipoPermiso').value = ''
  document.getElementById('docArchivo').value = ''
  document.getElementById('docDescripcion').value = ''
  document.getElementById('docNombrePreview').textContent = nombre + ' - Tipo.ext'
  document.getElementById('modalSubirDoc').classList.remove('hidden')
}

document.addEventListener('DOMContentLoaded', () => {
  const tipoSel = document.getElementById('docTipoPermiso')
  const archivoInp = document.getElementById('docArchivo')
  function updatePreview() {
    const nombre = document.getElementById('docArrendatarioNombreHidden').value || 'MARCA'
    const tipo = tipoSel.value || 'Documento'
    const file = archivoInp.files?.[0]
    const ext = file ? '.' + file.name.split('.').pop() : '.ext'
    document.getElementById('docNombrePreview').textContent = nombre + ' - ' + tipo + ext
  }
  tipoSel?.addEventListener('change', updatePreview)
  archivoInp?.addEventListener('change', updatePreview)
})

async function submitDocumento(e) {
  e.preventDefault()
  const id = document.getElementById('docArrendatarioId').value
  const nombre = document.getElementById('docArrendatarioNombreHidden').value
  const tipo = document.getElementById('docTipoPermiso').value
  const file = document.getElementById('docArchivo').files[0]
  const desc = document.getElementById('docDescripcion').value
  if (!file || !tipo) return

  const ext = file.name.split('.').pop()
  const nombreArchivo = nombre + ' - ' + tipo + '.' + ext

  // Convert file to base64 URL for storage (cloud storage simulation)
  const reader = new FileReader()
  reader.onload = async (ev) => {
    const url = ev.target.result
    const btn = document.getElementById('btnSubir')
    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...'
    
    await axios.post('/api/documentos', {
      arrendatario_id: parseInt(id),
      tipo_permiso: tipo,
      nombre_archivo: nombreArchivo,
      url_archivo: url,
      descripcion: desc
    })
    
    btn.disabled = false
    btn.innerHTML = '<i class="fas fa-upload"></i> Subir Documento'
    document.getElementById('modalSubirDoc').classList.add('hidden')
    showToast('✅ Documento subido: ' + nombreArchivo, 'success')
    loadArrendatarios()
  }
  reader.readAsDataURL(file)
}

// ─── Export ───────────────────────────────────────────────────────────────────
function exportData(type) {
  window.open(\`/api/export/\${type}\`, '_blank')
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type) {
  const toast = document.createElement('div')
  toast.className = \`fixed bottom-5 right-5 z-50 px-5 py-3 rounded-xl shadow-lg text-white font-semibold text-sm transition-all \${type==='success' ? 'bg-green-600' : 'bg-red-600'}\`
  toast.textContent = msg
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 3500)
}

init()
</script>
</body>
</html>`
}

export default app
