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

// ─── Mapa: tipo_permiso → columna status ─────────────────────────────────────
const PERMISO_STATUS_MAP: Record<string, string> = {
  'Permiso Bomberos':   'status_bomberos',
  'Patente':            'status_patente',
  'Tasa Habilitación':  'status_th',
  'Registro Turismo':   'status_turismo',
  'Licencia Turismo':   'status_lic_turismo',
  'Trampa Grasa':       'status_trampa_grasa',
  'ARCSA':              'status_arcsa',
  'Póliza Seguro':      'status_poliza',
}

// ─── Auto-migración al iniciar ────────────────────────────────────────────────
async function autoMigrate(db: D1Database) {
  // Crear tablas si no existen
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

  // Crear tabla visitas con TODAS las columnas necesarias
  await db.prepare(`CREATE TABLE IF NOT EXISTS visitas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, arrendatario_id INTEGER NOT NULL,
    fecha_visita TEXT NOT NULL, encargado TEXT, entrego_documentos INTEGER DEFAULT 0,
    documentos_entregados TEXT, documentos_faltantes TEXT, motivo_no_entrega TEXT,
    descripcion TEXT, observaciones TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (arrendatario_id) REFERENCES arrendatarios(id)
  )`).run()

  // Agregar columnas nuevas si no existen (para BDs antiguas)
  const alterCols = [
    { table: 'visitas', col: 'encargado',            def: 'TEXT' },
    { table: 'visitas', col: 'documentos_faltantes', def: 'TEXT' },
  ]
  for (const { table, col, def } of alterCols) {
    try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run() } catch { /* ya existe */ }
  }
}

// ─── API: Setup DB ────────────────────────────────────────────────────────────
app.get('/api/setup', async (c) => {
  try {
    await autoMigrate(c.env.DB)
    const count = await c.env.DB.prepare('SELECT COUNT(*) as n FROM arrendatarios').first<{n:number}>()
    if (count && count.n > 0) {
      return c.json({ ok: true, message: `DB already has ${count.n} arrendatarios`, seeded: false })
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

// ─── Migración solo en /api/setup (NO en cada request) ──────────────────────
// Ejecutar autoMigrate en cada request causa timeouts en Cloudflare Workers

// ─── API: Arrendatarios ───────────────────────────────────────────────────────
app.get('/api/arrendatarios', async (c) => {
  const { tipo, ubicacion, status_poliza, status_bomberos, status_th, search } = c.req.query()
  let query = `SELECT a.*,
    (SELECT COUNT(*) FROM documentos d WHERE d.arrendatario_id = a.id) as docs_count,
    (SELECT GROUP_CONCAT(d.tipo_permiso, '||') FROM documentos d WHERE d.arrendatario_id = a.id) as docs_tipos
    FROM arrendatarios a WHERE 1=1`
  const params: string[] = []
  if (tipo)           { query += ' AND a.tipo = ?';               params.push(tipo) }
  if (ubicacion)      { query += ' AND a.ubicacion = ?';          params.push(ubicacion) }
  if (status_poliza)  { query += ' AND a.status_poliza = ?';      params.push(status_poliza) }
  if (status_bomberos){ query += ' AND a.status_bomberos = ?';    params.push(status_bomberos) }
  if (status_th)      { query += ' AND a.status_th = ?';          params.push(status_th) }
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

// ─── API: Documentos ──────────────────────────────────────────────────────────
app.post('/api/documentos', async (c) => {
  const body = await c.req.json()
  const { arrendatario_id, tipo_permiso, nombre_archivo, url_archivo, descripcion } = body
  if (!arrendatario_id || !tipo_permiso || !nombre_archivo || !url_archivo)
    return c.json({ error: 'Faltan campos requeridos' }, 400)

  const result = await c.env.DB.prepare(
    'INSERT INTO documentos (arrendatario_id,tipo_permiso,nombre_archivo,url_archivo,descripcion) VALUES (?,?,?,?,?)'
  ).bind(arrendatario_id, tipo_permiso, nombre_archivo, url_archivo, descripcion || null).run()

  // Actualizar status del permiso a "Recibido"
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

// ─── API: Visitas ──────────────────────────────────────────────────────────────
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

// ─── Export CSV Arrendatarios ─────────────────────────────────────────────────
app.get('/api/export/arrendatarios', async (c) => {
  const rows = (await c.env.DB.prepare(`
    SELECT item,tipo,ubicacion,arrendatario,
      status_bomberos,fecha_bomberos,status_patente,fecha_patente,
      status_th,fecha_tasa_hab,status_turismo,fecha_turismo,
      status_trampa_grasa,fecha_trampa_grasa,status_arcsa,arcsa_inicio,arcsa_fin,
      status_poliza,poliza_inicio,poliza_caducidad,rubro_poliza,observaciones
    FROM arrendatarios ORDER BY arrendatario
  `).all()).results as any[]
  const e = (v:any) => { const s=String(v??'').replace(/"/g,'""'); return `"${s}"` }
  const h = ['#','TIPO','UBICACIÓN','ARRENDATARIO',
    'STATUS BOMBEROS','FECHA BOMBEROS','STATUS PATENTE','FECHA PATENTE',
    'STATUS TH','FECHA TH','STATUS TURISMO','FECHA TURISMO',
    'STATUS TRAMPA GRASA','FECHA TRAMPA','STATUS ARCSA','ARCSA INICIO','ARCSA FIN',
    'STATUS PÓLIZA','PÓLIZA INICIO','PÓLIZA CADUCIDAD','RUBRO','OBSERVACIONES']
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

// ─── Export CSV Visitas ───────────────────────────────────────────────────────
app.get('/api/export/visitas', async (c) => {
  const rows = (await c.env.DB.prepare(`
    SELECT v.id, a.arrendatario, a.tipo, a.ubicacion,
           v.fecha_visita, v.encargado, v.entrego_documentos,
           v.documentos_entregados, v.documentos_faltantes,
           v.motivo_no_entrega, v.descripcion, v.created_at
    FROM visitas v JOIN arrendatarios a ON v.arrendatario_id=a.id
    ORDER BY v.fecha_visita DESC
  `).all()).results as any[]
  const e = (v:any) => { const s=String(v??'').replace(/"/g,'""'); return `"${s}"` }
  const h = ['ID','ARRENDATARIO','TIPO','UBICACIÓN','FECHA VISITA','ENCARGADO',
    'ENTREGÓ DOCS','DOCUMENTOS ENTREGADOS','DOCUMENTOS FALTANTES',
    'MOTIVO NO ENTREGA','DESCRIPCIÓN / NOTAS','FECHA REGISTRO']
  let csv = '\uFEFF' + h.map(e).join(',') + '\r\n'
  for (const r of rows)
    csv += [r.id, r.arrendatario, r.tipo, r.ubicacion,
      r.fecha_visita, r.encargado,
      r.entrego_documentos ? 'SÍ' : 'NO',
      r.documentos_entregados, r.documentos_faltantes,
      r.motivo_no_entrega, r.descripcion, r.created_at
    ].map(e).join(',') + '\r\n'
  return new Response(csv, { headers:{
    'Content-Type':'text/csv; charset=utf-8',
    'Content-Disposition':'attachment; filename="visitas_campo.csv"'
  }})
})

// ─── Frontend ─────────────────────────────────────────────────────────────────
app.get('/', (c) => c.html(HTML))
app.get('*', (c) => c.html(HTML))

const HTML = `<!DOCTYPE html>
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
/* status colors */
.sv{background:#dcfce7;color:#166534;}
.sp{background:#fef9c3;color:#854d0e;}
.sc{background:#fee2e2;color:#991b1b;}
.sco{background:#fed7aa;color:#9a3412;}
.sna{background:#f3f4f6;color:#6b7280;}
.sr{background:#bbf7d0;color:#065f46;}
.spp{background:#dbeafe;color:#1e40af;}
/* layout */
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
/* tabla visitas */
#visitasTableWrapper{overflow-x:auto;border-radius:.5rem;border:2px solid #1e3a8a;}
.vt{border-collapse:collapse;width:100%;font-size:12px;min-width:950px;}
.vt thead th{background:#1e3a8a;color:#fff;padding:9px 11px;text-align:left;border:1px solid #2563eb;font-size:11px;white-space:nowrap;}
.vt tbody td{padding:7px 11px;border:1px solid #e2e8f0;vertical-align:top;}
.vt tbody tr:nth-child(odd) td{background:#fff;}
.vt tbody tr:nth-child(even) td{background:#f8fafc;}
.vt tbody tr:hover td{background:#eff6ff;}
.bsi{background:#dcfce7;color:#166534;padding:2px 9px;border-radius:99px;font-weight:700;font-size:11px;}
.bno{background:#fee2e2;color:#991b1b;padding:2px 9px;border-radius:99px;font-weight:700;font-size:11px;}
/* badge docs en tarjeta */
.doc-badge{position:absolute;top:7px;right:7px;background:#065f46;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:99px;line-height:1.4;}
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
        <i class="fas fa-calendar-check"></i><span class="hidden sm:inline">Visitas</span>
      </button>
      <button onclick="exportData('arrendatarios')" class="bg-green-500 hover:bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">
        <i class="fas fa-file-excel"></i><span class="hidden sm:inline">Export</span>
      </button>
    </div>
  </div>
</header>

<!-- FILTROS -->
<div class="max-w-7xl mx-auto px-4 pt-4 pb-2">
  <div class="bg-white rounded-xl shadow p-4">
    <div class="flex flex-wrap gap-3 items-end">
      <!-- Buscar -->
      <div class="flex-1 min-w-[160px]">
        <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-search mr-1"></i>Buscar marca</label>
        <input id="searchInput" type="text" placeholder="Ej: Adidas, Zara..." oninput="debouncedLoad()"/>
      </div>
      <!-- Tipo -->
      <div class="w-44">
        <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-store mr-1"></i>Tipo local</label>
        <select id="filterTipo" onchange="loadArrendatarios()">
          <option value="">Todos los tipos</option>
        </select>
      </div>
      <!-- Ubicacion -->
      <div class="w-48">
        <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-map-marker-alt mr-1"></i>Ubicación</label>
        <select id="filterUbicacion" onchange="loadArrendatarios()">
          <option value="">Todas</option>
        </select>
      </div>
      <!-- Poliza -->
      <div class="w-44">
        <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-shield-alt mr-1"></i>Póliza</label>
        <select id="filterPoliza" onchange="loadArrendatarios()">
          <option value="">Todas</option>
          <option value="Vigente">Vigente</option>
          <option value="Pendiente">Pendiente</option>
          <option value="PRONTO A CADUCAR">Pronto a Caducar</option>
          <option value="CADUCADO">Caducado</option>
        </select>
      </div>
      <!-- Bomberos -->
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
      <!-- Tasa Hab -->
      <div class="w-44">
        <label class="block text-xs font-semibold text-gray-500 mb-1"><i class="fas fa-stamp mr-1 text-teal-500"></i>Tasa Hab.</label>
        <select id="filterTH" onchange="loadArrendatarios()">
          <option value="">Todos</option>
          <option value="Vigente">Vigente</option>
          <option value="Recibido">Recibido</option>
          <option value="Pendiente">Pendiente</option>
          <option value="CONDICIONADO">Condicionado</option>
          <option value="CADUCADO">Caducado</option>
          <option value="NO APLICA">No aplica</option>
        </select>
      </div>
      <button onclick="clearFilters()" class="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm font-semibold self-end">
        <i class="fas fa-times mr-1"></i>Limpiar
      </button>
    </div>
  </div>
</div>

<!-- STATS -->
<div class="max-w-7xl mx-auto px-4 pb-2">
  <div id="statsBar" class="flex flex-wrap gap-2 mt-2"></div>
</div>

<!-- LISTA -->
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

<!-- ══ MODAL DETALLE ══ -->
<div id="modalDetalle" class="modal-overlay hidden" onclick="if(event.target===this)closeModalDetalle()">
  <div class="modal-box p-0" onclick="event.stopPropagation()">
    <div id="modalContent"></div>
  </div>
</div>

<!-- ══ MODAL HISTORIAL VISITAS ══ -->
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
        <li>Abre Excel → selecciona celda <strong>A1</strong></li>
        <li>Pega con <strong>Ctrl + V</strong> — columnas separadas automáticamente</li>
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

<!-- ══ MODAL NUEVA VISITA ══ -->
<div id="modalNuevaVisita" class="modal-overlay hidden" onclick="if(event.target===this)this.classList.add('hidden')">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-plus-circle mr-2 text-green-600"></i>Registrar Visita</h2>
      <button onclick="document.getElementById('modalNuevaVisita').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <div class="space-y-4">
      <input type="hidden" id="visitaArrId"/>
      <!-- Fila 1 -->
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
      <!-- Fila 2 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">
            <i class="fas fa-calendar mr-1 text-green-500"></i>Fecha de Visita <span class="text-red-500">*</span>
          </label>
          <input id="visitaFecha" type="date"/>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-700 mb-1">¿Entregó documentos?</label>
          <select id="visitaEntrego" onchange="toggleMotivo()">
            <option value="1">✅ SÍ entregó</option>
            <option value="0">❌ NO entregó</option>
          </select>
        </div>
      </div>

      <!-- Docs entregados -->
      <div id="campoDocsEntregados" class="bg-green-50 border border-green-200 rounded-lg p-4">
        <label class="block text-sm font-semibold text-green-800 mb-2"><i class="fas fa-check-circle mr-1"></i>Documentos entregados</label>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Permiso Bomberos" class="dsi w-4 h-4 accent-green-600"> Permiso Bomberos</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Patente" class="dsi w-4 h-4 accent-green-600"> Patente</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Tasa Habilitación" class="dsi w-4 h-4 accent-green-600"> Tasa Habilitación</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Registro Turismo" class="dsi w-4 h-4 accent-green-600"> Registro Turismo</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Trampa Grasa" class="dsi w-4 h-4 accent-green-600"> Trampa Grasa</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="ARCSA" class="dsi w-4 h-4 accent-green-600"> ARCSA</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Póliza/Seguro" class="dsi w-4 h-4 accent-green-600"> Póliza / Seguro</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Otros" class="dsi w-4 h-4 accent-green-600"> Otros</label>
        </div>
        <textarea id="extraDocsEntregados" rows="2" placeholder="Detalle adicional..."></textarea>
      </div>

      <!-- Docs faltantes -->
      <div class="bg-red-50 border border-red-200 rounded-lg p-4">
        <label class="block text-sm font-semibold text-red-800 mb-2"><i class="fas fa-exclamation-triangle mr-1 text-red-500"></i>Documentos faltantes / pendientes</label>
        <div class="grid grid-cols-2 gap-2 mb-2">
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Permiso Bomberos" class="dno w-4 h-4 accent-red-600"> Permiso Bomberos</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Patente" class="dno w-4 h-4 accent-red-600"> Patente</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Tasa Habilitación" class="dno w-4 h-4 accent-red-600"> Tasa Habilitación</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Registro Turismo" class="dno w-4 h-4 accent-red-600"> Registro Turismo</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Trampa Grasa" class="dno w-4 h-4 accent-red-600"> Trampa Grasa</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="ARCSA" class="dno w-4 h-4 accent-red-600"> ARCSA</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Póliza/Seguro" class="dno w-4 h-4 accent-red-600"> Póliza / Seguro</label>
          <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" value="Otros" class="dno w-4 h-4 accent-red-600"> Otros</label>
        </div>
        <textarea id="extraDocsFaltantes" rows="1" placeholder="Detalle (ej: prometió enviar el lunes)..."></textarea>
      </div>

      <!-- Motivo no entregó -->
      <div id="campoMotivo" class="hidden bg-orange-50 border border-orange-200 rounded-lg p-4">
        <label class="block text-sm font-semibold text-orange-800 mb-1"><i class="fas fa-comment-alt mr-1"></i>Motivo de no entrega</label>
        <textarea id="visitaMotivo" rows="2" placeholder="Ej: No estaban en el local, prometió enviar..."></textarea>
      </div>

      <!-- Notas -->
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-sticky-note mr-1 text-gray-400"></i>Observaciones / Notas</label>
        <textarea id="visitaNotas" rows="2" placeholder="Notas adicionales..."></textarea>
      </div>

      <!-- Botones -->
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

<!-- ══ MODAL SUBIR DOCUMENTO ══ -->
<div id="modalSubirDoc" class="modal-overlay hidden" onclick="if(event.target===this)this.classList.add('hidden')">
  <div class="modal-box p-6" onclick="event.stopPropagation()">
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-upload mr-2 text-blue-600"></i>Subir Documento</h2>
      <button onclick="document.getElementById('modalSubirDoc').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
    </div>
    <div id="uploadInfo" class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-sm text-blue-700 font-semibold"></div>
    <div class="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
      <i class="fas fa-magic mr-1 text-green-600"></i>
      <strong>Actualización automática:</strong> Al subir el documento, el status del permiso cambiará a
      <span class="bg-green-200 text-green-900 px-1 rounded font-bold">✅ Recibido</span> y se verá en la tarjeta.
    </div>
    <div class="space-y-4">
      <input type="hidden" id="docArrId"/>
      <input type="hidden" id="docArrNombre"/>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Tipo de Permiso / Documento <span class="text-red-500">*</span></label>
        <select id="docTipo">
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
        <input id="docArchivo" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"/>
        <p class="text-xs text-gray-400 mt-1">Se guardará como: <strong id="docNombrePreview" class="text-blue-700">MARCA - Tipo.ext</strong></p>
      </div>
      <div>
        <label class="block text-sm font-semibold text-gray-700 mb-1">Descripción (opcional)</label>
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

<!-- ══ MODAL DOCUMENTOS GLOBALES ══ -->
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
        <option value="Permiso Bomberos">🔥 Permiso Bomberos</option>
        <option value="Patente">📋 Patente</option>
        <option value="Tasa Habilitación">🏛️ Tasa Habilitación</option>
        <option value="Registro Turismo">🌟 Registro Turismo</option>
        <option value="Licencia Turismo">🎫 Licencia Turismo</option>
        <option value="Trampa Grasa">🪣 Trampa Grasa</option>
        <option value="ARCSA">💊 ARCSA</option>
        <option value="Póliza Seguro">🛡️ Póliza Seguro</option>
        <option value="Otros">📎 Otros</option>
      </select>
    </div>
    <div id="docsGlobalContenido"></div>
  </div>
</div>

<script>
// ─── Estado global ────────────────────────────────────────────────────────────
var allData = [], allDocsGlobal = [], debTimer = null

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Llamar setup (crea tablas y hace seed si está vacío) — solo al cargar la página
  try {
    await axios.get('/api/setup')
  } catch(e) { console.log('setup:', e.message) }
  await Promise.all([loadFiltros(), loadArrendatarios()])
  document.getElementById('visitaFecha').value = hoy()
  document.getElementById('docTipo').addEventListener('change', updatePreview)
  document.getElementById('docArchivo').addEventListener('change', updatePreview)
}

function hoy() { return new Date().toISOString().split('T')[0] }
function esc(s) { return (s||'').replace(/'/g,"\\\\'").replace(/"/g,'&quot;') }

// ─── Filtros ──────────────────────────────────────────────────────────────────
async function loadFiltros() {
  const { data } = await axios.get('/api/filtros')
  const ts = document.getElementById('filterTipo')
  const us = document.getElementById('filterUbicacion')
  data.tipos.forEach(t => { const o=document.createElement('option'); o.value=t; o.textContent=t; ts.appendChild(o) })
  data.ubicaciones.forEach(u => { const o=document.createElement('option'); o.value=u; o.textContent=u; us.appendChild(o) })
}

function clearFilters() {
  ['searchInput','filterTipo','filterUbicacion','filterPoliza','filterBomberos','filterTH'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.value = ''
  })
  loadArrendatarios()
}

function debouncedLoad() {
  clearTimeout(debTimer)
  debTimer = setTimeout(loadArrendatarios, 350)
}

// ─── Cargar tarjetas ──────────────────────────────────────────────────────────
async function loadArrendatarios() {
  showLoading(true)
  const p = {}
  const s  = document.getElementById('searchInput').value
  const t  = document.getElementById('filterTipo').value
  const u  = document.getElementById('filterUbicacion').value
  const pl = document.getElementById('filterPoliza').value
  const bo = document.getElementById('filterBomberos').value
  const th = document.getElementById('filterTH').value
  if (s)  p.search = s
  if (t)  p.tipo = t
  if (u)  p.ubicacion = u
  if (pl) p.status_poliza = pl
  if (bo) p.status_bomberos = bo
  if (th) p.status_th = th
  try {
    const { data } = await axios.get('/api/arrendatarios', { params: p })
    allData = data
    renderCards(data)
    renderStats(data)
  } catch(e) {
    showToast('Error cargando datos: ' + e.message, 'error')
  }
  showLoading(false)
}

function showLoading(s) {
  document.getElementById('loadingEl').classList.toggle('hidden', !s)
  document.getElementById('arrendatariosList').classList.toggle('hidden', s)
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function renderStats(data) {
  const total   = data.length
  const vigB    = data.filter(r => (r.status_bomberos||'').toLowerCase()==='vigente').length
  const recB    = data.filter(r => (r.status_bomberos||'').toLowerCase()==='recibido').length
  const pendB   = data.filter(r => (r.status_bomberos||'').toLowerCase()==='pendiente' || !r.status_bomberos).length
  const vigTH   = data.filter(r => (r.status_th||'').toLowerCase()==='vigente').length
  const vigP    = data.filter(r => r.status_poliza==='Vigente').length
  const conDocs = data.filter(r => (r.docs_count||0) > 0).length
  document.getElementById('statsBar').innerHTML = [
    {icon:'fa-building',     label:'Total',           val:total,   cls:'bg-blue-100 text-blue-800'},
    {icon:'fa-fire',         label:'Bomberos Vigente', val:vigB,   cls:'bg-green-100 text-green-800'},
    {icon:'fa-check-circle', label:'Bomberos Recibido',val:recB,   cls:'bg-emerald-100 text-emerald-800'},
    {icon:'fa-clock',        label:'Bomberos Pendiente',val:pendB, cls:'bg-yellow-100 text-yellow-800'},
    {icon:'fa-stamp',        label:'T.Hab. Vigente',   val:vigTH,  cls:'bg-teal-100 text-teal-800'},
    {icon:'fa-shield-alt',   label:'Póliza Vigente',   val:vigP,   cls:'bg-indigo-100 text-indigo-800'},
    {icon:'fa-paperclip',    label:'Con Docs',         val:conDocs,cls:'bg-violet-100 text-violet-800'},
  ].map(s => '<div class="' + s.cls + ' rounded-lg px-3 py-2 flex items-center gap-2 text-xs font-semibold">' +
    '<i class="fas ' + s.icon + '"></i>' + s.label + ': <span class="font-bold">' + s.val + '</span></div>'
  ).join('')
}

// ─── Tarjetas ─────────────────────────────────────────────────────────────────
function renderCards(data) {
  const list  = document.getElementById('arrendatariosList')
  const empty = document.getElementById('emptyState')
  if (!data.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return }
  empty.classList.add('hidden')
  list.innerHTML = data.map(a => {
    const docsCount = a.docs_count || 0
    const docsTipos = a.docs_tipos ? a.docs_tipos.split('||') : []
    const haDoc = (k) => docsTipos.includes(k) ? ' 📎' : ''
    return '<div class="bg-white rounded-xl shadow card-hover cursor-pointer border border-gray-100 overflow-hidden relative" onclick="openDetalle(' + a.id + ')">' +
      (docsCount > 0 ? '<div class="doc-badge">📎 ' + docsCount + ' doc' + (docsCount > 1 ? 's' : '') + '</div>' : '') +
      '<div class="bg-gradient-to-r from-blue-800 to-blue-600 px-4 py-3">' +
        '<div class="flex justify-between items-start gap-2">' +
          '<h3 class="text-white font-bold text-sm leading-tight pr-6">' + a.arrendatario + '</h3>' +
          '<span class="text-blue-200 text-xs whitespace-nowrap">#' + (a.item||'-') + '</span>' +
        '</div>' +
        '<div class="flex gap-2 mt-1 flex-wrap">' +
          '<span class="text-blue-200 text-xs"><i class="fas fa-store mr-1"></i>' + (a.tipo||'-') + '</span>' +
          '<span class="text-blue-200 text-xs"><i class="fas fa-map-marker-alt mr-1"></i>' + (a.ubicacion||'-') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="p-3">' +
        '<div class="grid grid-cols-2 gap-1.5 mb-2">' +
          '<div class="perm-card ' + sc(a.status_bomberos) + '">' +
            '<i class="fas fa-fire mr-1"></i>Bomberos<br/><b>' + (a.status_bomberos||'Pendiente') + '</b>' + haDoc('Permiso Bomberos') +
          '</div>' +
          '<div class="perm-card ' + sc(a.status_th) + '">' +
            '<i class="fas fa-stamp mr-1"></i>T.Hab.<br/><b>' + (a.status_th||'Pendiente') + '</b>' + haDoc('Tasa Habilitación') +
          '</div>' +
          '<div class="perm-card ' + sc(a.status_patente) + '">' +
            '<i class="fas fa-file-alt mr-1"></i>Patente<br/><b>' + (a.status_patente||'Pendiente') + '</b>' + haDoc('Patente') +
          '</div>' +
          '<div class="perm-card ' + scPol(a.status_poliza) + '">' +
            '<i class="fas fa-shield-alt mr-1"></i>Póliza<br/><b>' + (a.status_poliza||'Pendiente') + '</b>' + haDoc('Póliza Seguro') +
          '</div>' +
        '</div>' +
        '<div class="flex gap-2 justify-end">' +
          '<button onclick="event.stopPropagation();openNuevaVisita(' + a.id + ',\'' + esc(a.arrendatario) + '\')" ' +
            'class="bg-green-100 hover:bg-green-200 text-green-700 px-2 py-1.5 rounded-lg text-xs font-semibold">' +
            '<i class="fas fa-calendar-plus mr-1"></i>Visita</button>' +
          '<button onclick="event.stopPropagation();openSubirDoc(' + a.id + ',\'' + esc(a.arrendatario) + '\')" ' +
            'class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1.5 rounded-lg text-xs font-semibold">' +
            '<i class="fas fa-upload mr-1"></i>Doc</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  }).join('')
}

function sc(s) {
  if (!s) return 'sp'
  const l = s.toLowerCase().trim()
  if (l === 'vigente')                         return 'sv'
  if (l === 'recibido')                        return 'sr'
  if (l === 'pendiente')                       return 'sp'
  if (l === 'caducado' || l === 'vencido')     return 'sc'
  if (l === 'condicionado')                    return 'sco'
  if (l === 'no aplica' || l === 'no aplica')  return 'sna'
  if (l === 'stand by')                        return 'sna'
  if (l === 'pronto a caducar')                return 'sco'
  return 'sp'
}
function scPol(s) {
  if (!s) return 'sp'
  const l = (s||'').toLowerCase().trim()
  if (l === 'vigente')          return 'spp'
  if (l === 'pendiente')        return 'sp'
  if (l === 'pronto a caducar') return 'sco'
  if (l === 'caducado')         return 'sc'
  return 'sp'
}
function dIcon(n) {
  const e = (n||'').split('.').pop().toLowerCase()
  if (['jpg','jpeg','png','gif','webp'].includes(e)) return '🖼️'
  if (e === 'pdf')                 return '📄'
  if (['doc','docx'].includes(e)) return '📝'
  if (['xls','xlsx'].includes(e)) return '📊'
  return '📎'
}

// ─── Modal Detalle ────────────────────────────────────────────────────────────
async function openDetalle(id) {
  const { data } = await axios.get('/api/arrendatarios/' + id)
  document.getElementById('modalContent').innerHTML = renderDetalle(data)
  document.getElementById('modalDetalle').classList.remove('hidden')
}

function closeModalDetalle() {
  document.getElementById('modalDetalle').classList.add('hidden')
}

function renderDetalle(a) {
  const docsTipos = (a.documentos||[]).map(d => d.tipo_permiso)
  const tieneDoc  = (k) => docsTipos.includes(k)
    ? '<span class="text-green-600 text-xs ml-1" title="Documento subido">📎</span>' : ''

  const perms = [
    {l:'Permiso Bomberos', k:'Permiso Bomberos', s:a.status_bomberos, f:a.fecha_bomberos},
    {l:'Patente',          k:'Patente',          s:a.status_patente,  f:a.fecha_patente},
    {l:'Tasa Habilitación',k:'Tasa Habilitación',s:a.status_th,       f:a.fecha_tasa_hab},
    {l:'Turismo',          k:'Registro Turismo', s:a.status_turismo,  f:a.fecha_turismo},
    {l:'Lic. Turismo',     k:'Licencia Turismo', s:a.status_lic_turismo, f:a.fecha_lic_turismo},
    {l:'Trampa Grasa',     k:'Trampa Grasa',     s:a.status_trampa_grasa, f:a.fecha_trampa_grasa},
    {l:'ARCSA',            k:'ARCSA',            s:a.status_arcsa,    f:a.arcsa_fin ? 'Fin: '+a.arcsa_fin : null},
    {l:'Póliza',           k:'Póliza Seguro',    s:a.status_poliza,   f:a.poliza_caducidad ? 'Vence: '+a.poliza_caducidad : null},
    {l:'Soprofon',         k:null,               s:a.soprofon,        f:null},
    {l:'EGEDA',            k:null,               s:a.egeda,           f:null},
  ]

  const docsHTML = !(a.documentos||[]).length
    ? '<p class="text-gray-400 text-sm text-center py-6"><i class="fas fa-folder-open text-3xl block mb-2"></i>Sin documentos subidos</p>'
    : '<div class="space-y-2">' + (a.documentos||[]).map(d =>
        '<div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">' +
          '<div class="text-2xl shrink-0">' + dIcon(d.nombre_archivo) + '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<p class="font-semibold text-sm text-gray-800 truncate">' + d.nombre_archivo + '</p>' +
            '<div class="flex gap-2 mt-1 flex-wrap">' +
              '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">' + d.tipo_permiso + '</span>' +
              '<span class="text-xs text-gray-400">' + (d.fecha_subida||'').split('T')[0] + '</span>' +
            '</div>' +
            (d.descripcion ? '<p class="text-xs text-gray-400 mt-1">' + d.descripcion + '</p>' : '') +
          '</div>' +
          '<div class="flex gap-2 shrink-0">' +
            '<a href="' + d.url_archivo + '" download="' + d.nombre_archivo + '" ' +
               'class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded text-xs font-semibold">' +
               '<i class="fas fa-download"></i></a>' +
            '<button onclick="eliminarDoc(' + d.id + ',' + a.id + ')" ' +
               'class="bg-red-100 hover:bg-red-200 text-red-600 px-2 py-1 rounded text-xs font-semibold">' +
               '<i class="fas fa-trash"></i></button>' +
          '</div>' +
        '</div>'
      ).join('') + '</div>'

  const visitasHTML = !(a.visitas||[]).length
    ? '<p class="text-gray-400 text-sm text-center py-6"><i class="fas fa-calendar-times text-3xl block mb-2"></i>Sin visitas</p>'
    : '<div class="space-y-3">' + (a.visitas||[]).map(v =>
        '<div class="p-3 border border-gray-200 rounded-lg">' +
          '<div class="flex justify-between items-start gap-2">' +
            '<div class="flex flex-wrap items-center gap-2">' +
              '<span class="text-sm font-bold text-gray-700"><i class="fas fa-calendar mr-1 text-blue-500"></i>' + v.fecha_visita + '</span>' +
              (v.encargado ? '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold"><i class="fas fa-user mr-1"></i>' + v.encargado + '</span>' : '') +
              '<span class="badge ' + (v.entrego_documentos ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') + '">' +
                (v.entrego_documentos ? '✅ Entregó' : '❌ No entregó') + '</span>' +
            '</div>' +
            '<button onclick="eliminarVisita(' + v.id + ',' + a.id + ')" class="text-red-400 hover:text-red-600 text-sm shrink-0"><i class="fas fa-trash"></i></button>' +
          '</div>' +
          (v.documentos_entregados ? '<p class="text-xs text-green-700 mt-1"><strong>✅ Entregó:</strong> ' + v.documentos_entregados + '</p>' : '') +
          (v.documentos_faltantes  ? '<p class="text-xs text-red-600 mt-1"><strong>⚠️ Faltantes:</strong> ' + v.documentos_faltantes + '</p>' : '') +
          (v.motivo_no_entrega     ? '<p class="text-xs text-orange-600 mt-1"><strong>Motivo:</strong> ' + v.motivo_no_entrega + '</p>' : '') +
          (v.descripcion           ? '<p class="text-xs text-gray-500 mt-1">' + v.descripcion + '</p>' : '') +
        '</div>'
      ).join('') + '</div>'

  return '<div class="bg-gradient-to-r from-blue-900 to-blue-700 px-6 py-5 rounded-t-xl">' +
      '<div class="flex justify-between items-start gap-4">' +
        '<div>' +
          '<h2 class="text-white text-xl font-bold">' + a.arrendatario + '</h2>' +
          '<div class="flex gap-3 mt-1 flex-wrap text-blue-200 text-sm">' +
            '<span><i class="fas fa-store mr-1"></i>' + (a.tipo||'-') + '</span>' +
            '<span><i class="fas fa-map-marker-alt mr-1"></i>' + (a.ubicacion||'-') + '</span>' +
            (a.primer_visita ? '<span><i class="fas fa-calendar mr-1"></i>1ª: ' + a.primer_visita + '</span>' : '') +
          '</div>' +
          ((a.documentos||[]).length > 0
            ? '<div class="mt-2"><span class="text-xs bg-white/20 text-white px-2 py-1 rounded-full">' +
              '<i class="fas fa-paperclip mr-1"></i>' + (a.documentos||[]).length + ' doc(s) subido(s)</span></div>' : '') +
        '</div>' +
        '<button onclick="closeModalDetalle()" class="text-white/70 hover:text-white text-3xl leading-none">&times;</button>' +
      '</div>' +
      '<div class="flex gap-2 mt-3 flex-wrap">' +
        '<button onclick="closeModalDetalle();openNuevaVisita(' + a.id + ',\'' + esc(a.arrendatario) + '\')" ' +
          'class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">' +
          '<i class="fas fa-calendar-plus"></i>Nueva Visita</button>' +
        '<button onclick="closeModalDetalle();openSubirDoc(' + a.id + ',\'' + esc(a.arrendatario) + '\')" ' +
          'class="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">' +
          '<i class="fas fa-upload"></i>Subir Doc</button>' +
      '</div>' +
    '</div>' +
    '<div class="p-5">' +
      '<div class="flex gap-2 mb-4 overflow-x-auto pb-1">' +
        '<button class="tab-btn active" onclick="swTab(this,\'tPermisos\')"><i class="fas fa-clipboard-list mr-1"></i>Permisos</button>' +
        '<button class="tab-btn" onclick="swTab(this,\'tDocs\')">' +
          '<i class="fas fa-folder mr-1"></i>Docs ' +
          '<span class="ml-1 ' + ((a.documentos||[]).length > 0 ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600') + ' text-xs px-1.5 py-0.5 rounded-full">' +
          (a.documentos||[]).length + '</span></button>' +
        '<button class="tab-btn" onclick="swTab(this,\'tVisitas\')"><i class="fas fa-calendar-check mr-1"></i>Visitas (' + (a.visitas||[]).length + ')</button>' +
        '<button class="tab-btn" onclick="swTab(this,\'tInfo\')"><i class="fas fa-info-circle mr-1"></i>Info</button>' +
      '</div>' +
      '<div id="tPermisos">' +
        '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">' +
          perms.map(p => {
            const cls = p.l === 'Póliza' ? scPol(p.s) : sc(p.s)
            return '<div class="perm-card ' + cls + ' flex flex-col gap-1 p-3">' +
              '<div class="flex justify-between"><span class="font-bold text-xs">' + p.l + '</span>' + tieneDoc(p.k) + '</div>' +
              '<span class="text-sm font-semibold">' + (p.s||'Pendiente') + '</span>' +
              (p.f && p.f !== 'NO APLICA' ? '<span class="text-xs opacity-75">' + p.f + '</span>' : '') +
            '</div>'
          }).join('') +
        '</div>' +
        (a.observaciones ? '<div class="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">' +
          '<p class="font-semibold text-yellow-800"><i class="fas fa-exclamation-triangle mr-1"></i>Observaciones</p>' +
          '<p class="text-yellow-700 mt-1">' + a.observaciones + '</p></div>' : '') +
      '</div>' +
      '<div id="tDocs" class="hidden">' + docsHTML + '</div>' +
      '<div id="tVisitas" class="hidden">' + visitasHTML + '</div>' +
      '<div id="tInfo" class="hidden">' +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">' +
          [['Grupo Marcas',a.grupos_marcas],['Status General',a.status_general],
           ['Seguimiento',a.seguimiento],['Gestión Legal',a.gestion_legal],
           ['Registro Cartas',a.registro_cartas],['Fecha Ingreso',a.fecha_ingreso],
           ['Última Categorización',a.ultima_categorizacion],['Cert. Ambiental',a.cert_ambiental],
           ['Manifiesto',a.manifiesto],['Rubro Póliza',a.rubro_poliza]]
          .filter(function(x){ return x[1] && x[1] !== 'null' && x[1] !== 'NO APLICA' })
          .map(function(x){ return '<div class="bg-gray-50 rounded-lg p-3"><span class="font-semibold text-gray-600">' + x[0] + ':</span> ' + x[1] + '</div>' })
          .join('') +
        '</div>' +
      '</div>' +
    '</div>'
}

function swTab(btn, tid) {
  var mc = document.getElementById('modalContent')
  mc.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active') })
  btn.classList.add('active')
  mc.querySelectorAll('[id^="t"]').forEach(function(t){ t.classList.add('hidden') })
  var el = mc.querySelector('#' + tid)
  if (el) el.classList.remove('hidden')
}

async function eliminarDoc(docId, arrId) {
  if (!confirm('¿Eliminar documento? El status volverá a Pendiente si no hay más docs del mismo tipo.')) return
  await axios.delete('/api/documentos/' + docId)
  showToast('Documento eliminado', 'success')
  await loadArrendatarios()
  openDetalle(arrId)
}

async function eliminarVisita(vid, arrId) {
  if (!confirm('¿Eliminar esta visita?')) return
  await axios.delete('/api/visitas/' + vid)
  showToast('Visita eliminada', 'success')
  openDetalle(arrId)
}

// ─── Nueva Visita ─────────────────────────────────────────────────────────────
function openNuevaVisita(id, nombre) {
  document.getElementById('visitaArrId').value     = id
  document.getElementById('visitaArrNombre').value = nombre
  document.getElementById('visitaFecha').value     = hoy()
  document.getElementById('visitaEncargado').value = ''
  document.getElementById('visitaEntrego').value   = '1'
  document.getElementById('visitaNotas').value     = ''
  document.getElementById('extraDocsEntregados').value = ''
  document.getElementById('extraDocsFaltantes').value  = ''
  document.getElementById('visitaMotivo').value    = ''
  document.querySelectorAll('.dsi, .dno').forEach(function(c){ c.checked = false })
  toggleMotivo()
  document.getElementById('modalNuevaVisita').classList.remove('hidden')
}

function toggleMotivo() {
  var si = document.getElementById('visitaEntrego').value === '1'
  document.getElementById('campoDocsEntregados').classList.toggle('hidden', !si)
  document.getElementById('campoMotivo').classList.toggle('hidden', si)
}

async function guardarVisita() {
  var id       = document.getElementById('visitaArrId').value
  var fecha    = document.getElementById('visitaFecha').value
  var encargado= document.getElementById('visitaEncargado').value.trim()
  var entrego  = document.getElementById('visitaEntrego').value === '1'

  // Validaciones
  if (!id || !fecha) { showToast('⚠️ Faltan datos obligatorios', 'error'); return }
  if (!encargado)    { showToast('⚠️ Ingresa el nombre del encargado', 'error'); return }

  var checksSi = Array.from(document.querySelectorAll('.dsi:checked')).map(function(c){ return c.value })
  var extraSi  = document.getElementById('extraDocsEntregados').value.trim()
  var checksNo = Array.from(document.querySelectorAll('.dno:checked')).map(function(c){ return c.value })
  var extraNo  = document.getElementById('extraDocsFaltantes').value.trim()
  var docsSi   = checksSi.concat(extraSi ? [extraSi] : []).join(', ')
  var docsNo   = checksNo.concat(extraNo ? [extraNo] : []).join(', ')
  var motivo   = document.getElementById('visitaMotivo').value.trim()
  var notas    = document.getElementById('visitaNotas').value.trim()

  var btn = document.getElementById('btnGuardarVisita')
  btn.disabled = true
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...'

  try {
    await axios.post('/api/visitas', {
      arrendatario_id:       parseInt(id),
      fecha_visita:          fecha,
      encargado:             encargado,
      entrego_documentos:    entrego,
      documentos_entregados: entrego ? (docsSi || null) : null,
      documentos_faltantes:  docsNo || null,
      motivo_no_entrega:     !entrego ? (motivo || null) : null,
      descripcion:           notas || null
    })
    document.getElementById('modalNuevaVisita').classList.add('hidden')
    showToast('✅ Visita registrada correctamente', 'success')
    await loadArrendatarios()
  } catch(e) {
    showToast('❌ Error al guardar: ' + (e.response?.data?.error || e.message), 'error')
  } finally {
    btn.disabled = false
    btn.innerHTML = '<i class="fas fa-save"></i> Guardar Visita'
  }
}

// ─── Historial Visitas ────────────────────────────────────────────────────────
async function openVisitasTab() {
  var { data } = await axios.get('/api/visitas')
  renderVisitasTable(data)
  document.getElementById('modalVisitas').classList.remove('hidden')
}

function renderVisitasTable(data) {
  var cont = document.getElementById('visitasHistorial')
  var countEl = document.getElementById('visitasCount')
  if (countEl) countEl.textContent = data.length + ' visita(s) registrada(s)'
  if (!data.length) {
    cont.innerHTML = '<p class="text-gray-400 text-center py-10"><i class="fas fa-calendar-times text-4xl block mb-2"></i>No hay visitas</p>'
    return
  }
  cont.innerHTML =
    '<div id="visitasTableWrapper">' +
      '<table id="visitasTable" class="vt">' +
        '<thead><tr>' +
          '<th>ARRENDATARIO</th><th>TIPO LOCAL</th><th>UBICACIÓN</th>' +
          '<th>FECHA VISITA</th><th>ENCARGADO</th><th>ENTREGÓ</th>' +
          '<th>DOCS ENTREGADOS</th><th>DOCS FALTANTES</th>' +
          '<th>MOTIVO NO ENTREGA</th><th>NOTAS</th><th style="background:#1e3a8a;border:1px solid #2563eb;width:36px"></th>' +
        '</tr></thead>' +
        '<tbody>' +
          data.map(function(v) {
            return '<tr>' +
              '<td style="font-weight:600;min-width:130px">' + (v.arrendatario||'') + '</td>' +
              '<td style="font-size:11px;color:#6b7280;min-width:90px">' + (v.tipo||'') + '</td>' +
              '<td style="font-size:11px;color:#6b7280;min-width:110px">' + (v.ubicacion||'') + '</td>' +
              '<td style="white-space:nowrap;font-weight:600">' + (v.fecha_visita||'') + '</td>' +
              '<td style="min-width:100px">' + (v.encargado||'-') + '</td>' +
              '<td style="text-align:center"><span class="' + (v.entrego_documentos ? 'bsi' : 'bno') + '">' + (v.entrego_documentos ? 'SÍ' : 'NO') + '</span></td>' +
              '<td style="color:#166534;min-width:150px;font-size:11px">' + (v.documentos_entregados||'-') + '</td>' +
              '<td style="color:#991b1b;min-width:150px;font-size:11px">' + (v.documentos_faltantes||'-') + '</td>' +
              '<td style="color:#9a3412;min-width:130px;font-size:11px">' + (v.motivo_no_entrega||'-') + '</td>' +
              '<td style="color:#6b7280;min-width:130px;font-size:11px">' + (v.descripcion||'-') + '</td>' +
              '<td style="text-align:center;background:#fff8f8">' +
                '<button onclick="eliminarVisitaGlobal(' + v.id + ')" style="color:#ef4444;border:none;background:none;cursor:pointer;font-size:13px">' +
                '<i class="fas fa-trash"></i></button></td>' +
            '</tr>'
          }).join('') +
        '</tbody>' +
      '</table>' +
    '</div>'
}

async function copyVisitasTable() {
  var table = document.getElementById('visitasTable')
  if (!table) { showToast('No hay datos para copiar', 'error'); return }
  // Clonar sin la columna de acciones (última)
  var clone = table.cloneNode(true)
  clone.querySelectorAll('tr').forEach(function(row) {
    if (row.lastElementChild) row.lastElementChild.remove()
  })
  var tmp = document.createElement('div')
  tmp.style.cssText = 'position:fixed;left:-9999px;top:0'
  tmp.appendChild(clone)
  document.body.appendChild(tmp)
  var range = document.createRange()
  range.selectNode(clone)
  window.getSelection().removeAllRanges()
  window.getSelection().addRange(range)
  var ok = false
  try { ok = document.execCommand('copy') } catch(e) {}
  window.getSelection().removeAllRanges()
  document.body.removeChild(tmp)
  if (ok) {
    showToast('✅ Tabla copiada — abre Excel, selecciona A1 y pega con Ctrl+V', 'success')
  } else {
    showToast('Selecciona la tabla con Ctrl+A y copia con Ctrl+C', 'info')
  }
}

async function eliminarVisitaGlobal(id) {
  if (!confirm('¿Eliminar esta visita?')) return
  await axios.delete('/api/visitas/' + id)
  showToast('Visita eliminada', 'success')
  openVisitasTab()
}

// ─── Subir Documento ──────────────────────────────────────────────────────────
function openSubirDoc(id, nombre) {
  document.getElementById('docArrId').value    = id
  document.getElementById('docArrNombre').value= nombre
  document.getElementById('uploadInfo').innerHTML = '<i class="fas fa-building mr-2"></i>Para: <strong>' + nombre + '</strong>'
  document.getElementById('docTipo').value     = ''
  document.getElementById('docArchivo').value  = ''
  document.getElementById('docDesc').value     = ''
  document.getElementById('docNombrePreview').textContent = nombre + ' - Tipo.ext'
  document.getElementById('modalSubirDoc').classList.remove('hidden')
}

function updatePreview() {
  var nombre = document.getElementById('docArrNombre').value || 'MARCA'
  var tipo   = document.getElementById('docTipo').value || 'Documento'
  var file   = document.getElementById('docArchivo').files[0]
  var ext    = file ? '.' + file.name.split('.').pop() : '.ext'
  document.getElementById('docNombrePreview').textContent = nombre + ' - ' + tipo + ext
}

async function subirDocumento() {
  var id     = document.getElementById('docArrId').value
  var nombre = document.getElementById('docArrNombre').value
  var tipo   = document.getElementById('docTipo').value
  var file   = document.getElementById('docArchivo').files[0]
  var desc   = document.getElementById('docDesc').value

  if (!tipo)  { showToast('⚠️ Selecciona el tipo de documento', 'error'); return }
  if (!file)  { showToast('⚠️ Selecciona un archivo', 'error'); return }

  var ext          = file.name.split('.').pop()
  var nombreArchivo= nombre + ' - ' + tipo + '.' + ext

  var reader = new FileReader()
  reader.onload = async function(ev) {
    var btn = document.getElementById('btnSubir')
    btn.disabled = true
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...'
    try {
      var res = await axios.post('/api/documentos', {
        arrendatario_id: parseInt(id),
        tipo_permiso:    tipo,
        nombre_archivo:  nombreArchivo,
        url_archivo:     ev.target.result,
        descripcion:     desc || null
      })
      document.getElementById('modalSubirDoc').classList.add('hidden')
      showToast('✅ ' + nombreArchivo + ' subido. Status actualizado a Recibido ✔', 'success')
      // Recargar tarjetas inmediatamente para mostrar el status actualizado
      await loadArrendatarios()
    } catch(e) {
      showToast('❌ Error al subir: ' + (e.response?.data?.error || e.message), 'error')
    } finally {
      btn.disabled = false
      btn.innerHTML = '<i class="fas fa-upload"></i> Subir Documento'
    }
  }
  reader.readAsDataURL(file)
}

// ─── Documentos Globales ──────────────────────────────────────────────────────
async function openDocsGlobal() {
  var { data } = await axios.get('/api/documentos')
  allDocsGlobal = data
  renderDocsGlobal(data)
  document.getElementById('modalDocsGlobal').classList.remove('hidden')
}

function filtrarDocsGlobal() {
  var s = document.getElementById('docsSearch').value.toLowerCase()
  var t = document.getElementById('docsTipo').value
  var f = allDocsGlobal.filter(function(d) {
    return (!s || (d.arrendatario||'').toLowerCase().includes(s) ||
                  (d.tipo_permiso||'').toLowerCase().includes(s) ||
                  (d.nombre_archivo||'').toLowerCase().includes(s)) &&
           (!t || d.tipo_permiso === t)
  })
  renderDocsGlobal(f)
}

function renderDocsGlobal(data) {
  var cont = document.getElementById('docsGlobalContenido')
  if (!data.length) {
    cont.innerHTML = '<p class="text-gray-400 text-center py-8"><i class="fas fa-folder-open text-4xl block mb-2"></i>Sin documentos subidos</p>'
    return
  }
  cont.innerHTML =
    '<p class="text-xs text-gray-500 mb-3 font-semibold"><i class="fas fa-paperclip mr-1"></i>' + data.length + ' documento(s)</p>' +
    '<div class="space-y-2">' +
      data.map(function(d) {
        return '<div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100 hover:border-blue-200">' +
          '<div class="text-2xl shrink-0">' + dIcon(d.nombre_archivo) + '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<p class="font-bold text-sm">' + d.arrendatario + '</p>' +
            '<p class="text-xs text-gray-600 truncate">' + d.nombre_archivo + '</p>' +
            '<div class="flex gap-2 mt-1 flex-wrap">' +
              '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">' + d.tipo_permiso + '</span>' +
              '<span class="text-xs text-gray-400">' + (d.fecha_subida||'').split('T')[0] + '</span>' +
            '</div>' +
            (d.descripcion ? '<p class="text-xs text-gray-400 mt-1">' + d.descripcion + '</p>' : '') +
          '</div>' +
          '<div class="flex gap-2 shrink-0">' +
            '<a href="' + d.url_archivo + '" download="' + d.nombre_archivo + '" ' +
               'class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1">' +
               '<i class="fas fa-download"></i> Descargar</a>' +
            '<button onclick="eliminarDocGlobal(' + d.id + ')" ' +
               'class="bg-red-100 hover:bg-red-200 text-red-600 px-2 py-1.5 rounded-lg text-xs font-semibold">' +
               '<i class="fas fa-trash"></i></button>' +
          '</div>' +
        '</div>'
      }).join('') +
    '</div>'
}

async function eliminarDocGlobal(id) {
  if (!confirm('¿Eliminar este documento? El status del permiso volverá a Pendiente.')) return
  await axios.delete('/api/documentos/' + id)
  showToast('Documento eliminado', 'success')
  await loadArrendatarios()
  openDocsGlobal()
}

// ─── Export ───────────────────────────────────────────────────────────────────
function exportData(type) { window.open('/api/export/' + type, '_blank') }

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type) {
  var t = document.createElement('div')
  var bg = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600'
  t.className = 'fixed bottom-5 right-5 z-[999] px-5 py-3 rounded-xl shadow-lg text-white font-semibold text-sm ' + bg
  t.innerHTML = msg
  document.body.appendChild(t)
  setTimeout(function(){ t.remove() }, 4500)
}

init()
</script>
</body>
</html>`

export default app
