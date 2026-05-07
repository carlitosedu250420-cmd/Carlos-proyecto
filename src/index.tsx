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

const PERMISO_STATUS_MAP: Record<string, string> = {
  'Permiso Bomberos':   'status_bomberos',
  'Patente':            'status_patente',
  'Tasa Habilitacion':  'status_th',
  'Registro Turismo':   'status_turismo',
  'Licencia Turismo':   'status_lic_turismo',
  'Trampa Grasa':       'status_trampa_grasa',
  'ARCSA':              'status_arcsa',
  'Poliza Seguro':      'status_poliza',
}

async function autoMigrate(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS arrendatarios (
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

  await db.prepare(`CREATE TABLE IF NOT EXISTS documentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, arrendatario_id INTEGER NOT NULL,
    tipo_permiso TEXT NOT NULL, nombre_archivo TEXT NOT NULL, url_archivo TEXT NOT NULL,
    descripcion TEXT, fecha_subida DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (arrendatario_id) REFERENCES arrendatarios(id)
  )`).run()

  await db.prepare(`CREATE TABLE IF NOT EXISTS visitas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, arrendatario_id INTEGER NOT NULL,
    fecha_visita TEXT NOT NULL, encargado TEXT, entrego_documentos INTEGER DEFAULT 0,
    documentos_entregados TEXT, documentos_faltantes TEXT, motivo_no_entrega TEXT,
    descripcion TEXT, observaciones TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (arrendatario_id) REFERENCES arrendatarios(id)
  )`).run()

  const cols = [
    { table: 'visitas', col: 'encargado',            def: 'TEXT' },
    { table: 'visitas', col: 'documentos_faltantes', def: 'TEXT' },
  ]
  for (const { table, col, def } of cols) {
    try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run() } catch { /* ya existe */ }
  }
}

// Setup: crear tablas + seed si vacio
app.get('/api/setup', async (c) => {
  try {
    await autoMigrate(c.env.DB)
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM arrendatarios').first<{n:number}>()
    if (count && count.n > 0) {
      return c.json({ ok: true, message: `DB has ${count.n} arrendatarios`, seeded: false })
    }
    const seedBatch = SEED_DATA.map(row =>
      c.env.DB.prepare(`INSERT INTO arrendatarios
        (item,tipo,ubicacion,arrendatario,grupos_marcas,fecha_bomberos,status_bomberos,
         fecha_patente,status_patente,fecha_tasa_hab,status_th,fecha_turismo,status_turismo,
         fecha_lic_turismo,status_lic_turismo,fecha_trampa_grasa,status_trampa_grasa,
         arcsa_inicio,arcsa_fin,status_arcsa,cert_ambiental,reg_desechos,cert_gestion_residuos,
         manifiesto,soprofon,egeda,status_general,observaciones,registro_cartas,seguimiento,
         gestion_legal,fecha_avances,fecha_ingreso,ultima_categorizacion,primer_visita,
         poliza_inicio,poliza_caducidad,status_poliza,rubro_poliza,fecha_entrega_poliza)
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

// Arrendatarios list con filtros
app.get('/api/arrendatarios', async (c) => {
  const { tipo, ubicacion, status_bomberos, search } = c.req.query()
  let query = `SELECT a.*,
    (SELECT COUNT(*) FROM documentos d WHERE d.arrendatario_id = a.id) as docs_count,
    (SELECT GROUP_CONCAT(d.tipo_permiso, '||') FROM documentos d WHERE d.arrendatario_id = a.id) as docs_tipos
    FROM arrendatarios a WHERE 1=1`
  const params: string[] = []
  if (tipo)           { query += ' AND a.tipo = ?';               params.push(tipo) }
  if (ubicacion)      { query += ' AND a.ubicacion = ?';          params.push(ubicacion) }
  if (status_bomberos){ query += ' AND a.status_bomberos = ?';    params.push(status_bomberos) }
  if (search)         { query += ' AND (a.arrendatario LIKE ? OR a.ubicacion LIKE ?)'; params.push(`%${search}%`, `%${search}%`) }
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
  const tipos      = await c.env.DB.prepare('SELECT DISTINCT tipo FROM arrendatarios WHERE tipo IS NOT NULL ORDER BY tipo').all()
  const ubicaciones= await c.env.DB.prepare('SELECT DISTINCT ubicacion FROM arrendatarios WHERE ubicacion IS NOT NULL ORDER BY ubicacion').all()
  return c.json({
    tipos:      tipos.results.map((r: any) => r.tipo),
    ubicaciones:ubicaciones.results.map((r: any) => r.ubicacion)
  })
})

// Documentos
app.post('/api/documentos', async (c) => {
  const body = await c.req.json()
  const { arrendatario_id, tipo_permiso, nombre_archivo, url_archivo, descripcion } = body
  if (!arrendatario_id || !tipo_permiso || !nombre_archivo || !url_archivo)
    return c.json({ error: 'Faltan campos requeridos' }, 400)
  const result = await c.env.DB.prepare(
    'INSERT INTO documentos (arrendatario_id,tipo_permiso,nombre_archivo,url_archivo,descripcion) VALUES (?,?,?,?,?)'
  ).bind(arrendatario_id, tipo_permiso, nombre_archivo, url_archivo, descripcion || null).run()
  const colStatus = PERMISO_STATUS_MAP[tipo_permiso]
  if (colStatus) {
    await c.env.DB.prepare(
      `UPDATE arrendatarios SET ${colStatus}='Recibido', updated_at=CURRENT_TIMESTAMP WHERE id=?`
    ).bind(arrendatario_id).run()
  }
  return c.json({ id: result.meta.last_row_id, success: true, statusUpdated: colStatus || null })
})

app.delete('/api/documentos/:id', async (c) => {
  const id = c.req.param('id')
  const doc = await c.env.DB.prepare('SELECT * FROM documentos WHERE id=?').bind(id).first<any>()
  await c.env.DB.prepare('DELETE FROM documentos WHERE id=?').bind(id).run()
  if (doc) {
    const rem = await c.env.DB.prepare(
      'SELECT COUNT(*) as n FROM documentos WHERE arrendatario_id=? AND tipo_permiso=?'
    ).bind(doc.arrendatario_id, doc.tipo_permiso).first<{n:number}>()
    if (rem && rem.n === 0) {
      const col = PERMISO_STATUS_MAP[doc.tipo_permiso]
      if (col) {
        await c.env.DB.prepare(`UPDATE arrendatarios SET ${col}='Pendiente', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(doc.arrendatario_id).run()
      }
    }
  }
  return c.json({ success: true })
})

app.get('/api/documentos', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT d.*, a.arrendatario, a.tipo, a.ubicacion
    FROM documentos d JOIN arrendatarios a ON d.arrendatario_id=a.id
    ORDER BY d.fecha_subida DESC
  `).all()
  return c.json(result.results)
})

// Visitas
app.get('/api/visitas', async (c) => {
  const { arrendatario_id } = c.req.query()
  let query = `SELECT v.*, a.arrendatario, a.tipo, a.ubicacion
    FROM visitas v JOIN arrendatarios a ON v.arrendatario_id=a.id`
  const params: any[] = []
  if (arrendatario_id) { query += ' WHERE v.arrendatario_id=?'; params.push(arrendatario_id) }
  query += ' ORDER BY v.fecha_visita DESC, v.created_at DESC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(result.results)
})

app.post('/api/visitas', async (c) => {
  const body = await c.req.json()
  const { arrendatario_id, fecha_visita, encargado, entrego_documentos,
          documentos_entregados, documentos_faltantes, motivo_no_entrega, descripcion } = body
  if (!arrendatario_id || !fecha_visita)
    return c.json({ error: 'Faltan campos requeridos' }, 400)
  const result = await c.env.DB.prepare(
    `INSERT INTO visitas
     (arrendatario_id,fecha_visita,encargado,entrego_documentos,
      documentos_entregados,documentos_faltantes,motivo_no_entrega,descripcion)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    arrendatario_id, fecha_visita, encargado || null,
    entrego_documentos ? 1 : 0,
    documentos_entregados || null, documentos_faltantes || null,
    motivo_no_entrega || null, descripcion || null
  ).run()
  return c.json({ id: result.meta.last_row_id, success: true })
})

app.delete('/api/visitas/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM visitas WHERE id=?').bind(c.req.param('id')).run()
  return c.json({ success: true })
})

// Export CSV
app.get('/api/export/arrendatarios', async (c) => {
  const rows = (await c.env.DB.prepare(`
    SELECT item,tipo,ubicacion,arrendatario,
      status_bomberos,fecha_bomberos,status_patente,fecha_patente,
      status_th,fecha_tasa_hab,status_turismo,fecha_turismo,
      status_trampa_grasa,fecha_trampa_grasa,status_arcsa,arcsa_inicio,arcsa_fin,
      status_poliza,poliza_inicio,poliza_caducidad,rubro_poliza,observaciones
    FROM arrendatarios ORDER BY arrendatario
  `).all()).results as any[]
  const e = (v:any) => { const s=String(v??'').replace(/"/g,'""'); return '"'+s+'"' }
  const h = ['#','TIPO','UBICACION','ARRENDATARIO',
    'STATUS BOMBEROS','FECHA BOMBEROS','STATUS PATENTE','FECHA PATENTE',
    'STATUS TH','FECHA TH','STATUS TURISMO','FECHA TURISMO',
    'STATUS TRAMPA GRASA','FECHA TRAMPA','STATUS ARCSA','ARCSA INICIO','ARCSA FIN',
    'STATUS POLIZA','POLIZA INICIO','POLIZA CADUCIDAD','RUBRO','OBSERVACIONES']
  let csv = '\uFEFF' + h.map(e).join(',') + '\r\n'
  for (const r of rows)
    csv += [r.item,r.tipo,r.ubicacion,r.arrendatario,
      r.status_bomberos,r.fecha_bomberos,r.status_patente,r.fecha_patente,
      r.status_th,r.fecha_tasa_hab,r.status_turismo,r.fecha_turismo,
      r.status_trampa_grasa,r.fecha_trampa_grasa,r.status_arcsa,r.arcsa_inicio,r.arcsa_fin,
      r.status_poliza,r.poliza_inicio,r.poliza_caducidad,r.rubro_poliza,r.observaciones
    ].map(e).join(',') + '\r\n'
  return new Response(csv, { headers:{
    'Content-Type':'text/csv; charset=utf-8',
    'Content-Disposition':'attachment; filename="arrendatarios_permisos.csv"'
  }})
})

app.get('/api/export/visitas', async (c) => {
  const rows = (await c.env.DB.prepare(`
    SELECT v.id, a.arrendatario, a.tipo, a.ubicacion,
           v.fecha_visita, v.encargado, v.entrego_documentos,
           v.documentos_entregados, v.documentos_faltantes,
           v.motivo_no_entrega, v.descripcion, v.created_at
    FROM visitas v JOIN arrendatarios a ON v.arrendatario_id=a.id
    ORDER BY v.fecha_visita DESC
  `).all()).results as any[]
  const e = (v:any) => { const s=String(v??'').replace(/"/g,'""'); return '"'+s+'"' }
  const h = ['ID','ARRENDATARIO','TIPO','UBICACION','FECHA VISITA','ENCARGADO',
    'ENTREGO DOCS','DOCUMENTOS ENTREGADOS','DOCUMENTOS FALTANTES',
    'MOTIVO NO ENTREGA','DESCRIPCION / NOTAS','FECHA REGISTRO']
  let csv = '\uFEFF' + h.map(e).join(',') + '\r\n'
  for (const r of rows)
    csv += [r.id, r.arrendatario, r.tipo, r.ubicacion,
      r.fecha_visita, r.encargado,
      r.entrego_documentos ? 'SI' : 'NO',
      r.documentos_entregados, r.documentos_faltantes,
      r.motivo_no_entrega, r.descripcion, r.created_at
    ].map(e).join(',') + '\r\n'
  return new Response(csv, { headers:{
    'Content-Type':'text/csv; charset=utf-8',
    'Content-Disposition':'attachment; filename="visitas_campo.csv"'
  }})
})

// Frontend
app.get('/', (c) => c.html(HTML))
app.get('*', (c) => c.html(HTML))

const HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Gestion de Permisos - Carlos Alcivar</title>
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
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:50;display:flex;align-items:center;justify-content:center;padding:1rem;}
.modal-box{background:#fff;border-radius:1rem;max-width:960px;width:100%;max-height:90vh;overflow-y:auto;}
.tab-btn{padding:.5rem 1rem;border-radius:.5rem;font-weight:600;transition:all .2s;cursor:pointer;white-space:nowrap;border:none;outline:none;}
.tab-btn.active{background:#1e40af;color:#fff;}
.tab-btn:not(.active){background:#f3f4f6;color:#374151;}
.tab-btn:not(.active):hover{background:#e5e7eb;}
.badge{display:inline-block;padding:.2rem .6rem;border-radius:9999px;font-size:.75rem;font-weight:700;}
input,select,textarea{border:1px solid #d1d5db;border-radius:.5rem;padding:.5rem .75rem;width:100%;outline:none;font-family:inherit;}
input:focus,select:focus,textarea:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15);}
.perm-card{border-radius:.5rem;padding:.5rem .4rem;font-size:.7rem;font-weight:600;text-align:center;}
::-webkit-scrollbar{width:6px;}
::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:3px;}
@media(max-width:640px){.modal-box{max-height:95vh;}}
#visitasTableWrapper{overflow-x:auto;border-radius:.5rem;border:2px solid #1e3a8a;}
.vt{border-collapse:collapse;width:100%;font-size:12px;min-width:900px;}
.vt thead th{background:#1e3a8a;color:#fff;padding:9px 11px;text-align:left;border:1px solid #2563eb;font-size:11px;white-space:nowrap;}
.vt tbody td{padding:7px 11px;border:1px solid #e2e8f0;vertical-align:top;}
.vt tbody tr:nth-child(odd) td{background:#fff;}
.vt tbody tr:nth-child(even) td{background:#f8fafc;}
.vt tbody tr:hover td{background:#eff6ff;}
.bsi{background:#dcfce7;color:#166534;padding:2px 9px;border-radius:99px;font-weight:700;font-size:11px;}
.bno{background:#fee2e2;color:#991b1b;padding:2px 9px;border-radius:99px;font-weight:700;font-size:11px;}
.doc-badge{position:absolute;top:7px;right:7px;background:#065f46;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:99px;line-height:1.4;}
</style>
</head>
<body class="bg-gray-100 min-h-screen">

<header class="bg-gradient-to-r from-blue-900 to-blue-700 text-white shadow-lg sticky top-0 z-40">
  <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
    <div class="flex items-center gap-3">
      <div class="bg-white/20 rounded-xl p-2"><i class="fas fa-building text-xl"></i></div>
      <div>
        <h1 class="text-lg font-bold leading-tight">Gestion de Permisos</h1>
        <p class="text-blue-200 text-xs">Carlos Alcivar - Operaciones</p>
      </div>
    </div>
    <div class="flex gap-2 flex-wrap">
      <button onclick="openDocsGlobal()" class="bg-violet-500 hover:bg-violet-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-folder-open"></i><span class="hidden sm:inline">Documentos</span>
      </button>
      <button onclick="openVisitasTab()" class="bg-white/20 hover:bg-white/30 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-calendar-check"></i><span class="hidden sm:inline">Visitas</span>
      </button>
      <button onclick="exportData('arrendatarios')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-file-excel"></i><span class="hidden sm:inline">Export</span>
      </button>
    </div>
  </div>
</header>

<div class="max-w-7xl mx-auto px-4 pt-4 pb-2">
  <div class="bg-white rounded-xl shadow p-4">
    <div class="flex flex-wrap gap-3 items-end">
      <div class="flex-1 min-w-[160px]">
        <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-search mr-1"></i>Buscar marca</label>
        <input id="searchInput" type="text" placeholder="Ej: Adidas, Zara..." oninput="debouncedLoad()"/>
      </div>
      <div class="w-44">
        <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-store mr-1"></i>Tipo local</label>
        <select id="filterTipo" onchange="loadArrendatarios()">
          <option value="">Todos los tipos</option>
        </select>
      </div>
      <div class="w-48">
        <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-map-marker-alt mr-1"></i>Ubicacion</label>
        <select id="filterUbicacion" onchange="loadArrendatarios()">
          <option value="">Todas</option>
        </select>
      </div>
      <div class="w-44">
        <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-fire mr-1 text-orange-500"></i>Bomberos</label>
        <select id="filterBomberos" onchange="loadArrendatarios()">
          <option value="">Todos</option>
          <option value="Vigente">Vigente</option>
          <option value="Recibido">Recibido</option>
          <option value="Pendiente">Pendiente</option>
          <option value="CONDICIONADO">Condicionado</option>
          <option value="CADUCADO">Caducado</option>
        </select>
      </div>
      <button onclick="clearFilters()" class="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm font-semibold self-end flex items-center gap-1">
        <i class="fas fa-times"></i>Limpiar
      </button>
    </div>
  </div>
</div>

<div class="max-w-7xl mx-auto px-4 pb-2">
  <div id="statsBar" class="flex flex-wrap gap-2 mt-2"></div>
</div>

<main class="max-w-7xl mx-auto px-4 pb-8">
  <div id="arrendatariosList" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"></div>
  <div id="loadingEl" class="hidden text-center py-20">
    <i class="fas fa-spinner fa-spin text-4xl text-blue-500"></i>
    <p class="text-gray-500 mt-3">Cargando...</p>
  </div>
  <div id="emptyState" class="hidden text-center py-20">
    <i class="fas fa-search text-5xl text-gray-300"></i>
    <p class="text-gray-400 mt-3 text-lg">Sin resultados</p>
  </div>
</main>

<!-- MODAL DETALLE -->
<div id="modalDetalle" class="modal-overlay hidden" onclick="if(event.target===this)closeModalDetalle()">
  <div class="modal-box p-0" onclick="event.stopPropagation()">
    <div id="modalContent"></div>
  </div>
</div>

<!-- MODAL HISTORIAL VISITAS -->
<div id="modalVisitas" class="modal-overlay hidden" onclick="if(event.target===this)this.classList.add('hidden')">
  <div class="modal-box p-6" style="max-width:1100px" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-3">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-calendar-check mr-2 text-blue-600"></i>Historial de Visitas</h2>
      <button onclick="document.getElementById('modalVisitas').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 text-sm text-blue-800">
      <p class="font-bold mb-1"><i class="fas fa-lightbulb mr-1 text-yellow-500"></i>Para pegar en Excel:</p>
      <ol class="list-decimal list-inside space-y-0.5 text-xs">
        <li>Haz clic en <strong>"Copiar tabla"</strong></li>
        <li>Abre Excel, selecciona celda <strong>A1</strong></li>
        <li>Pega con <strong>Ctrl + V</strong> — columnas separadas automaticamente</li>
      </ol>
    </div>
    <div class="flex gap-2 justify-between items-center mb-4 flex-wrap">
      <span id="visitasCount" class="text-sm text-gray-500 font-semibold"></span>
      <div class="flex gap-2 flex-wrap">
        <button onclick="copyVisitasTable()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
          <i class="fas fa-copy"></i>Copiar tabla
        </button>
        <button onclick="exportData('visitas')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
          <i class="fas fa-file-csv"></i>Descargar CSV
        </button>
      </div>
    </div>
    <div id="visitasHistorial"></div>
  </div>
</div>

<!-- MODAL NUEVA VISITA -->
<div id="modalNuevaVisita" class="modal-overlay hidden" onclick="if(event.target===this)this.classList.add('hidden')">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-plus-circle mr-2 text-green-600"></i>Registrar Visita</h2>
      <button onclick="document.getElementById('modalNuevaVisita').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <div class="space-y-4">
      <input type="hidden" id="visitaArrId"/>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Arrendatario</label>
          <input id="visitaArrNombre" type="text" readonly class="bg-gray-50 font-semibold text-blue-800"/>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">
            <i class="fas fa-user mr-1 text-blue-500"></i>Nombre del encargado <span class="text-red-500">*</span>
          </label>
          <input id="visitaEncargado" type="text" placeholder="Ej: Carlos Alcivar"/>
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">
            <i class="fas fa-calendar mr-1 text-green-500"></i>Fecha de Visita <span class="text-red-500">*</span>
          </label>
          <input id="visitaFecha" type="date"/>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">Entrego documentos?</label>
          <select id="visitaEntrego" onchange="toggleMotivo()">
            <option value="1">SI entrego</option>
            <option value="0">NO entrego</option>
          </select>
        </div>
      </div>
      <div id="campoDocsEntregados" class="bg-green-50 border border-green-200 rounded-lg p-4">
        <label class="block text-sm font-semibold text-green-800 mb-2"><i class="fas fa-check-circle mr-1"></i>Documentos entregados</label>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Permiso Bomberos" class="dsi w-4 h-4 accent-green-600"> Permiso Bomberos</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Patente" class="dsi w-4 h-4 accent-green-600"> Patente</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Tasa Habilitacion" class="dsi w-4 h-4 accent-green-600"> Tasa Habilitacion</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Registro Turismo" class="dsi w-4 h-4 accent-green-600"> Registro Turismo</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Trampa Grasa" class="dsi w-4 h-4 accent-green-600"> Trampa Grasa</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="ARCSA" class="dsi w-4 h-4 accent-green-600"> ARCSA</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Poliza/Seguro" class="dsi w-4 h-4 accent-green-600"> Poliza / Seguro</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Otros" class="dsi w-4 h-4 accent-green-600"> Otros</label>
        </div>
        <textarea id="extraDocsEntregados" rows="2" placeholder="Detalle adicional..."></textarea>
      </div>
      <div class="bg-red-50 border border-red-200 rounded-lg p-4">
        <label class="block text-sm font-semibold text-red-800 mb-2"><i class="fas fa-exclamation-triangle mr-1 text-red-500"></i>Documentos faltantes / pendientes</label>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Permiso Bomberos" class="dno w-4 h-4 accent-red-600"> Permiso Bomberos</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Patente" class="dno w-4 h-4 accent-red-600"> Patente</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Tasa Habilitacion" class="dno w-4 h-4 accent-red-600"> Tasa Habilitacion</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Registro Turismo" class="dno w-4 h-4 accent-red-600"> Registro Turismo</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Trampa Grasa" class="dno w-4 h-4 accent-red-600"> Trampa Grasa</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="ARCSA" class="dno w-4 h-4 accent-red-600"> ARCSA</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Poliza/Seguro" class="dno w-4 h-4 accent-red-600"> Poliza / Seguro</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Otros" class="dno w-4 h-4 accent-red-600"> Otros</label>
        </div>
        <textarea id="extraDocsFaltantes" rows="1" placeholder="Detalle (ej: prometio enviar el lunes)..."></textarea>
      </div>
      <div id="campoMotivo" class="hidden bg-orange-50 border border-orange-200 rounded-lg p-4">
        <label class="block text-sm font-semibold text-orange-800 mb-1"><i class="fas fa-comment-alt mr-1"></i>Motivo de no entrega</label>
        <textarea id="visitaMotivo" rows="2" placeholder="Ej: No estaban en el local, prometio enviar..."></textarea>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-sticky-note mr-1 text-gray-400"></i>Observaciones / Notas</label>
        <textarea id="visitaNotas" rows="2" placeholder="Notas adicionales..."></textarea>
      </div>
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="document.getElementById('modalNuevaVisita').classList.add('hidden')"
          class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-5 py-2 rounded-lg font-semibold">Cancelar</button>
        <button type="button" onclick="guardarVisita()"
          id="btnGuardarVisita"
          class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold flex items-center gap-2">
          <i class="fas fa-save"></i>Guardar Visita
        </button>
      </div>
    </div>
  </div>
</div>

<!-- MODAL SUBIR DOCUMENTO -->
<div id="modalSubirDoc" class="modal-overlay hidden" onclick="if(event.target===this)this.classList.add('hidden')">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-upload mr-2 text-blue-600"></i>Subir Documento</h2>
      <button onclick="document.getElementById('modalSubirDoc').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <div id="uploadInfo" class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-sm text-blue-700 font-semibold"></div>
    <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
      <i class="fas fa-magic mr-1 text-green-600"></i>
      <strong>Actualizacion automatica:</strong> Al subir el documento, el status del permiso cambiara a
      <span class="bg-green-200 text-green-900 px-1 rounded font-bold">Recibido</span> y se vera en la tarjeta.
    </div>
    <div class="space-y-4">
      <input type="hidden" id="docArrId"/>
      <input type="hidden" id="docArrNombre"/>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Tipo de Permiso / Documento <span class="text-red-500">*</span></label>
        <select id="docTipo">
          <option value="">Seleccionar tipo...</option>
          <option value="Permiso Bomberos">Permiso de Bomberos</option>
          <option value="Patente">Patente Municipal</option>
          <option value="Tasa Habilitacion">Tasa de Habilitacion</option>
          <option value="Registro Turismo">Registro Ministerio Turismo</option>
          <option value="Licencia Turismo">Licencia Turismo Municipio</option>
          <option value="Trampa Grasa">Trampa de Grasas</option>
          <option value="ARCSA">ARCSA</option>
          <option value="Certificado Ambiental">Certificado Ambiental</option>
          <option value="Poliza Seguro">Poliza y Seguro</option>
          <option value="Soprofon/Sayce">Soprofon/Sayce</option>
          <option value="EGEDA">EGEDA</option>
          <option value="Otros">Otros</option>
        </select>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Archivo (imagen, PDF, doc...) <span class="text-red-500">*</span></label>
        <input id="docArchivo" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"/>
        <p class="text-xs text-gray-400 mt-1">Se guardara como: <strong id="docNombrePreview" class="text-blue-700">MARCA - Tipo.ext</strong></p>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Descripcion (opcional)</label>
        <textarea id="docDesc" rows="2" placeholder="Fecha de vencimiento, observaciones..."></textarea>
      </div>
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" onclick="document.getElementById('modalSubirDoc').classList.add('hidden')"
          class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-5 py-2 rounded-lg font-semibold">Cancelar</button>
        <button type="button" onclick="subirDocumento()" id="btnSubir"
          class="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2 rounded-lg font-semibold flex items-center gap-2">
          <i class="fas fa-upload"></i>Subir Documento
        </button>
      </div>
    </div>
  </div>
</div>

<!-- MODAL DOCUMENTOS GLOBALES -->
<div id="modalDocsGlobal" class="modal-overlay hidden" onclick="if(event.target===this)this.classList.add('hidden')">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-folder-open mr-2 text-violet-600"></i>Registro Global de Documentos</h2>
      <button onclick="document.getElementById('modalDocsGlobal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <div class="mb-4 flex gap-2 flex-wrap">
      <input id="docsSearch" type="text" placeholder="Buscar por marca o tipo..." oninput="filtrarDocsGlobal()" class="text-sm flex-1 min-w-[180px]"/>
      <select id="docsTipo" onchange="filtrarDocsGlobal()" class="text-sm w-48">
        <option value="">Todos los tipos</option>
        <option value="Permiso Bomberos">Permiso Bomberos</option>
        <option value="Patente">Patente</option>
        <option value="Tasa Habilitacion">Tasa Habilitacion</option>
        <option value="Registro Turismo">Registro Turismo</option>
        <option value="Trampa Grasa">Trampa Grasa</option>
        <option value="ARCSA">ARCSA</option>
        <option value="Poliza Seguro">Poliza Seguro</option>
        <option value="Otros">Otros</option>
      </select>
    </div>
    <div id="docsGlobalContenido"></div>
  </div>
</div>

<script src="/static/app.js"></script>
</body>
</html>`

export default app
