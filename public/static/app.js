var allData = [], allDocsGlobal = [], debTimer = null;

function hoy() { return new Date().toISOString().split('T')[0]; }

function esc(s) {
  return (s || '').replace(/'/g, '').replace(/"/g, '');
}

function init() {
  axios.get('/api/setup').catch(function(e){ console.log('setup:', e.message); });
  loadFiltros();
  loadArrendatarios();
  document.getElementById('visitaFecha').value = hoy();
  document.getElementById('docTipo').addEventListener('change', updatePreview);
  document.getElementById('docArchivo').addEventListener('change', updatePreview);
}

function loadFiltros() {
  axios.get('/api/filtros').then(function(r) {
    var ts = document.getElementById('filterTipo');
    var us = document.getElementById('filterUbicacion');
    r.data.tipos.forEach(function(t) {
      var o = document.createElement('option'); o.value = t; o.textContent = t; ts.appendChild(o);
    });
    r.data.ubicaciones.forEach(function(u) {
      var o = document.createElement('option'); o.value = u; o.textContent = u; us.appendChild(o);
    });
  }).catch(function(e){ console.log('filtros err:', e.message); });
}

function clearFilters() {
  ['searchInput','filterTipo','filterUbicacion','filterBomberos'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  loadArrendatarios();
}

function debouncedLoad() {
  clearTimeout(debTimer);
  debTimer = setTimeout(loadArrendatarios, 350);
}

function loadArrendatarios() {
  showLoading(true);
  var p = {};
  var s  = document.getElementById('searchInput').value;
  var t  = document.getElementById('filterTipo').value;
  var u  = document.getElementById('filterUbicacion').value;
  var bo = document.getElementById('filterBomberos').value;
  if (s)  p.search = s;
  if (t)  p.tipo = t;
  if (u)  p.ubicacion = u;
  if (bo) p.status_bomberos = bo;
  axios.get('/api/arrendatarios', { params: p }).then(function(r) {
    allData = r.data;
    renderCards(r.data);
    renderStats(r.data);
    showLoading(false);
  }).catch(function(e) {
    showToast('Error cargando datos: ' + e.message, 'error');
    showLoading(false);
  });
}

function showLoading(s) {
  document.getElementById('loadingEl').classList.toggle('hidden', !s);
  document.getElementById('arrendatariosList').classList.toggle('hidden', s);
}

function renderStats(data) {
  var total   = data.length;
  var vigB    = data.filter(function(r){ return (r.status_bomberos||'').toLowerCase() === 'vigente'; }).length;
  var recB    = data.filter(function(r){ return (r.status_bomberos||'').toLowerCase() === 'recibido'; }).length;
  var pendB   = data.filter(function(r){ var s=(r.status_bomberos||'').toLowerCase(); return s==='pendiente'||!r.status_bomberos; }).length;
  var conDocs = data.filter(function(r){ return (r.docs_count||0) > 0; }).length;
  document.getElementById('statsBar').innerHTML = [
    {icon:'fa-building',      label:'Total',             val:total,   cls:'bg-blue-100 text-blue-800'},
    {icon:'fa-fire',          label:'Bomberos Vigente',  val:vigB,    cls:'bg-green-100 text-green-800'},
    {icon:'fa-check-circle',  label:'Bomberos Recibido', val:recB,    cls:'bg-emerald-100 text-emerald-800'},
    {icon:'fa-clock',         label:'Bomberos Pendiente',val:pendB,   cls:'bg-yellow-100 text-yellow-800'},
    {icon:'fa-paperclip',     label:'Con Docs',          val:conDocs, cls:'bg-violet-100 text-violet-800'}
  ].map(function(s) {
    return '<div class="' + s.cls + ' rounded-lg px-3 py-2 flex items-center gap-2 text-xs font-semibold">' +
      '<i class="fas ' + s.icon + '"></i>' + s.label + ': <span class="font-bold">' + s.val + '</span></div>';
  }).join('');
}

function sc(s) {
  if (!s) return 'sp';
  var l = s.toLowerCase().trim();
  if (l === 'vigente')           return 'sv';
  if (l === 'recibido')          return 'sr';
  if (l === 'pendiente')         return 'sp';
  if (l === 'caducado' || l === 'vencido') return 'sc';
  if (l === 'condicionado')      return 'sco';
  if (l === 'no aplica')         return 'sna';
  if (l === 'stand by')          return 'sna';
  if (l === 'pronto a caducar')  return 'sco';
  return 'sp';
}

function scPol(s) {
  if (!s) return 'sp';
  var l = (s || '').toLowerCase().trim();
  if (l === 'vigente')           return 'spp';
  if (l === 'pendiente')         return 'sp';
  if (l === 'pronto a caducar')  return 'sco';
  if (l === 'caducado')          return 'sc';
  return 'sp';
}

function dIcon(n) {
  var e = (n || '').split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp'].indexOf(e) >= 0) return '\uD83D\uDDBC\uFE0F';
  if (e === 'pdf') return '\uD83D\uDCC4';
  if (['doc','docx'].indexOf(e) >= 0) return '\uD83D\uDCDD';
  if (['xls','xlsx'].indexOf(e) >= 0) return '\uD83D\uDCCA';
  return '\uD83D\uDCCE';
}

function renderCards(data) {
  var list  = document.getElementById('arrendatariosList');
  var empty = document.getElementById('emptyState');
  if (!data.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  list.innerHTML = data.map(function(a) {
    var docsCount = a.docs_count || 0;
    var docsTipos = a.docs_tipos ? a.docs_tipos.split('||') : [];
    var haDoc = function(k) { return docsTipos.indexOf(k) >= 0 ? ' \uD83D\uDCCE' : ''; };
    var nombre = esc(a.arrendatario);
    return '<div class="bg-white rounded-xl shadow card-hover cursor-pointer border border-gray-100 overflow-hidden relative" onclick="openDetalle(' + a.id + ')">' +
      (docsCount > 0 ? '<div class="doc-badge">\uD83D\uDCCE ' + docsCount + ' doc' + (docsCount > 1 ? 's' : '') + '</div>' : '') +
      '<div class="bg-gradient-to-r from-blue-800 to-blue-600 px-4 py-3">' +
        '<div class="flex justify-between items-start gap-2">' +
          '<h3 class="text-white font-bold text-sm leading-tight pr-6">' + (a.arrendatario || '') + '</h3>' +
          '<span class="text-blue-200 text-xs whitespace-nowrap">#' + (a.item || '-') + '</span>' +
        '</div>' +
        '<div class="flex gap-2 mt-1 flex-wrap">' +
          '<span class="text-blue-200 text-xs"><i class="fas fa-store mr-1"></i>' + (a.tipo || '-') + '</span>' +
          '<span class="text-blue-200 text-xs"><i class="fas fa-map-marker-alt mr-1"></i>' + (a.ubicacion || '-') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="p-3">' +
        '<div class="grid grid-cols-2 gap-1.5 mb-2">' +
          '<div class="perm-card ' + sc(a.status_bomberos) + '">' +
            '<i class="fas fa-fire mr-1"></i>Bomberos<br/><b>' + (a.status_bomberos || 'Pendiente') + '</b>' + haDoc('Permiso Bomberos') +
          '</div>' +
          '<div class="perm-card ' + sc(a.status_patente) + '">' +
            '<i class="fas fa-file-alt mr-1"></i>Patente<br/><b>' + (a.status_patente || 'Pendiente') + '</b>' + haDoc('Patente') +
          '</div>' +
        '</div>' +
        '<div class="flex gap-2 justify-end">' +
          '<button onclick="event.stopPropagation();openNuevaVisita(' + a.id + ',\'' + nombre + '\')" ' +
            'class="bg-green-100 hover:bg-green-200 text-green-700 px-2 py-1.5 rounded-lg text-xs font-semibold">' +
            '<i class="fas fa-calendar-plus mr-1"></i>Visita</button>' +
          '<button onclick="event.stopPropagation();openSubirDoc(' + a.id + ',\'' + nombre + '\')" ' +
            'class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1.5 rounded-lg text-xs font-semibold">' +
            '<i class="fas fa-upload mr-1"></i>Doc</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function openDetalle(id) {
  axios.get('/api/arrendatarios/' + id).then(function(r) {
    document.getElementById('modalContent').innerHTML = renderDetalle(r.data);
    document.getElementById('modalDetalle').classList.remove('hidden');
  });
}

function closeModalDetalle() {
  document.getElementById('modalDetalle').classList.add('hidden');
}

function renderDetalle(a) {
  var docsTipos = (a.documentos || []).map(function(d){ return d.tipo_permiso; });
  var tieneDoc = function(k) {
    return docsTipos.indexOf(k) >= 0
      ? '<span class="text-green-600 text-xs ml-1" title="Documento subido">\uD83D\uDCCE</span>' : '';
  };

  var perms = [
    {l:'Permiso Bomberos', k:'Permiso Bomberos', s:a.status_bomberos,    f:a.fecha_bomberos},
    {l:'Patente',          k:'Patente',           s:a.status_patente,     f:a.fecha_patente},
    {l:'Tasa Habilitacion',k:'Tasa Habilitacion', s:a.status_th,          f:a.fecha_tasa_hab},
    {l:'Turismo',          k:'Registro Turismo',  s:a.status_turismo,     f:a.fecha_turismo},
    {l:'Trampa Grasa',     k:'Trampa Grasa',       s:a.status_trampa_grasa,f:a.fecha_trampa_grasa},
    {l:'ARCSA',            k:'ARCSA',              s:a.status_arcsa,       f:a.arcsa_fin ? 'Fin: '+a.arcsa_fin : null},
    {l:'Poliza',           k:'Poliza Seguro',      s:a.status_poliza,      f:a.poliza_caducidad ? 'Vence: '+a.poliza_caducidad : null},
    {l:'Soprofon',         k:null,                 s:a.soprofon,           f:null},
    {l:'EGEDA',            k:null,                 s:a.egeda,              f:null}
  ];

  var docsHTML = !(a.documentos || []).length
    ? '<p class="text-gray-400 text-sm text-center py-6"><i class="fas fa-folder-open text-3xl block mb-2"></i>Sin documentos subidos</p>'
    : '<div class="space-y-2">' + (a.documentos || []).map(function(d) {
        return '<div class="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">' +
          '<div class="text-2xl shrink-0">' + dIcon(d.nombre_archivo) + '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<p class="font-semibold text-sm text-gray-800 truncate">' + d.nombre_archivo + '</p>' +
            '<div class="flex gap-2 mt-1 flex-wrap">' +
              '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">' + d.tipo_permiso + '</span>' +
              '<span class="text-xs text-gray-400">' + (d.fecha_subida || '').split('T')[0] + '</span>' +
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
        '</div>';
      }).join('') + '</div>';

  var visitasHTML = !(a.visitas || []).length
    ? '<p class="text-gray-400 text-sm text-center py-6"><i class="fas fa-calendar-times text-3xl block mb-2"></i>Sin visitas</p>'
    : '<div class="space-y-3">' + (a.visitas || []).map(function(v) {
        return '<div class="p-3 border border-gray-200 rounded-lg">' +
          '<div class="flex justify-between items-start gap-2">' +
            '<div class="flex flex-wrap items-center gap-2">' +
              '<span class="text-sm font-bold text-gray-700"><i class="fas fa-calendar mr-1 text-blue-500"></i>' + v.fecha_visita + '</span>' +
              (v.encargado ? '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold"><i class="fas fa-user mr-1"></i>' + v.encargado + '</span>' : '') +
              '<span class="badge ' + (v.entrego_documentos ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700') + '">' +
                (v.entrego_documentos ? 'Entrego' : 'No entrego') + '</span>' +
            '</div>' +
            '<button onclick="eliminarVisita(' + v.id + ',' + a.id + ')" class="text-red-400 hover:text-red-600 text-sm shrink-0"><i class="fas fa-trash"></i></button>' +
          '</div>' +
          (v.documentos_entregados ? '<p class="text-xs text-green-700 mt-1"><strong>Entrego:</strong> ' + v.documentos_entregados + '</p>' : '') +
          (v.documentos_faltantes  ? '<p class="text-xs text-red-600 mt-1"><strong>Faltantes:</strong> ' + v.documentos_faltantes + '</p>' : '') +
          (v.motivo_no_entrega     ? '<p class="text-xs text-orange-600 mt-1"><strong>Motivo:</strong> ' + v.motivo_no_entrega + '</p>' : '') +
          (v.descripcion           ? '<p class="text-xs text-gray-500 mt-1">' + v.descripcion + '</p>' : '') +
        '</div>';
      }).join('') + '</div>';

  var nombre = esc(a.arrendatario);
  return '<div class="bg-gradient-to-r from-blue-900 to-blue-700 px-6 py-5 rounded-t-xl">' +
    '<div class="flex justify-between items-start gap-4">' +
      '<div>' +
        '<h2 class="text-white text-xl font-bold">' + (a.arrendatario || '') + '</h2>' +
        '<div class="flex gap-3 mt-1 flex-wrap text-blue-200 text-sm">' +
          '<span><i class="fas fa-store mr-1"></i>' + (a.tipo || '-') + '</span>' +
          '<span><i class="fas fa-map-marker-alt mr-1"></i>' + (a.ubicacion || '-') + '</span>' +
          (a.primer_visita ? '<span><i class="fas fa-calendar mr-1"></i>1a: ' + a.primer_visita + '</span>' : '') +
        '</div>' +
        ((a.documentos || []).length > 0
          ? '<div class="mt-2"><span class="text-xs bg-white/20 text-white px-2 py-1 rounded-full">' +
            '<i class="fas fa-paperclip mr-1"></i>' + (a.documentos || []).length + ' doc(s) subido(s)</span></div>' : '') +
      '</div>' +
      '<button onclick="closeModalDetalle()" class="text-white/70 hover:text-white text-3xl leading-none">&times;</button>' +
    '</div>' +
    '<div class="flex gap-2 mt-3 flex-wrap">' +
      '<button onclick="closeModalDetalle();openNuevaVisita(' + a.id + ',\'' + nombre + '\')" ' +
        'class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">' +
        '<i class="fas fa-calendar-plus"></i>Nueva Visita</button>' +
      '<button onclick="closeModalDetalle();openSubirDoc(' + a.id + ',\'' + nombre + '\')" ' +
        'class="bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2">' +
        '<i class="fas fa-upload"></i>Subir Doc</button>' +
    '</div>' +
  '</div>' +
  '<div class="p-5">' +
    '<div class="flex gap-2 mb-4 overflow-x-auto pb-1">' +
      '<button class="tab-btn active" onclick="swTab(this,\'tPermisos\')"><i class="fas fa-clipboard-list mr-1"></i>Permisos</button>' +
      '<button class="tab-btn" onclick="swTab(this,\'tDocs\')">' +
        '<i class="fas fa-folder mr-1"></i>Docs ' +
        '<span class="ml-1 ' + ((a.documentos || []).length > 0 ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600') + ' text-xs px-1.5 py-0.5 rounded-full">' +
        (a.documentos || []).length + '</span></button>' +
      '<button class="tab-btn" onclick="swTab(this,\'tVisitas\')"><i class="fas fa-calendar-check mr-1"></i>Visitas (' + (a.visitas || []).length + ')</button>' +
      '<button class="tab-btn" onclick="swTab(this,\'tInfo\')"><i class="fas fa-info-circle mr-1"></i>Info</button>' +
    '</div>' +
    '<div id="tPermisos">' +
      '<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">' +
        perms.map(function(p) {
          var cls = p.l === 'Poliza' ? scPol(p.s) : sc(p.s);
          return '<div class="perm-card ' + cls + ' flex flex-col gap-1 p-3">' +
            '<div class="flex justify-between"><span class="font-bold text-xs">' + p.l + '</span>' + (p.k ? tieneDoc(p.k) : '') + '</div>' +
            '<span class="text-sm font-semibold">' + (p.s || 'Pendiente') + '</span>' +
            (p.f && p.f !== 'NO APLICA' ? '<span class="text-xs opacity-75">' + p.f + '</span>' : '') +
          '</div>';
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
         ['Seguimiento',a.seguimiento],['Gestion Legal',a.gestion_legal],
         ['Registro Cartas',a.registro_cartas],['Fecha Ingreso',a.fecha_ingreso],
         ['Ultima Categorizacion',a.ultima_categorizacion],['Cert. Ambiental',a.cert_ambiental],
         ['Manifiesto',a.manifiesto],['Rubro Poliza',a.rubro_poliza]]
        .filter(function(x){ return x[1] && x[1] !== 'null' && x[1] !== 'NO APLICA'; })
        .map(function(x){ return '<div class="bg-gray-50 rounded-lg p-3"><span class="font-semibold text-gray-600">' + x[0] + ':</span> ' + x[1] + '</div>'; })
        .join('') +
      '</div>' +
    '</div>' +
  '</div>';
}

function swTab(btn, tid) {
  var mc = document.getElementById('modalContent');
  mc.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  mc.querySelectorAll('[id^="t"]').forEach(function(t){ t.classList.add('hidden'); });
  var el = mc.querySelector('#' + tid);
  if (el) el.classList.remove('hidden');
}

function eliminarDoc(docId, arrId) {
  if (!confirm('Eliminar documento? El status volvera a Pendiente si no hay mas docs del mismo tipo.')) return;
  axios.delete('/api/documentos/' + docId).then(function() {
    showToast('Documento eliminado', 'success');
    loadArrendatarios();
    openDetalle(arrId);
  });
}

function eliminarVisita(vid, arrId) {
  if (!confirm('Eliminar esta visita?')) return;
  axios.delete('/api/visitas/' + vid).then(function() {
    showToast('Visita eliminada', 'success');
    openDetalle(arrId);
  });
}

function openNuevaVisita(id, nombre) {
  document.getElementById('visitaArrId').value          = id;
  document.getElementById('visitaArrNombre').value      = nombre;
  document.getElementById('visitaFecha').value          = hoy();
  document.getElementById('visitaEncargado').value      = '';
  document.getElementById('visitaEntrego').value        = '1';
  document.getElementById('visitaNotas').value          = '';
  document.getElementById('extraDocsEntregados').value  = '';
  document.getElementById('extraDocsFaltantes').value   = '';
  document.getElementById('visitaMotivo').value         = '';
  document.querySelectorAll('.dsi, .dno').forEach(function(c){ c.checked = false; });
  toggleMotivo();
  document.getElementById('modalNuevaVisita').classList.remove('hidden');
}

function toggleMotivo() {
  var si = document.getElementById('visitaEntrego').value === '1';
  document.getElementById('campoDocsEntregados').classList.toggle('hidden', !si);
  document.getElementById('campoMotivo').classList.toggle('hidden', si);
}

function guardarVisita() {
  var id        = document.getElementById('visitaArrId').value;
  var fecha     = document.getElementById('visitaFecha').value;
  var encargado = document.getElementById('visitaEncargado').value.trim();
  var entrego   = document.getElementById('visitaEntrego').value === '1';

  if (!id || !fecha) { showToast('Faltan datos obligatorios', 'error'); return; }
  if (!encargado)    { showToast('Ingresa el nombre del encargado', 'error'); return; }

  var checksSi = Array.from(document.querySelectorAll('.dsi:checked')).map(function(c){ return c.value; });
  var extraSi  = document.getElementById('extraDocsEntregados').value.trim();
  var checksNo = Array.from(document.querySelectorAll('.dno:checked')).map(function(c){ return c.value; });
  var extraNo  = document.getElementById('extraDocsFaltantes').value.trim();
  var docsSi   = checksSi.concat(extraSi ? [extraSi] : []).join(', ');
  var docsNo   = checksNo.concat(extraNo ? [extraNo] : []).join(', ');
  var motivo   = document.getElementById('visitaMotivo').value.trim();
  var notas    = document.getElementById('visitaNotas').value.trim();

  var btn = document.getElementById('btnGuardarVisita');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Guardando...';

  axios.post('/api/visitas', {
    arrendatario_id:       parseInt(id),
    fecha_visita:          fecha,
    encargado:             encargado,
    entrego_documentos:    entrego,
    documentos_entregados: entrego ? (docsSi || null) : null,
    documentos_faltantes:  docsNo || null,
    motivo_no_entrega:     !entrego ? (motivo || null) : null,
    descripcion:           notas || null
  }).then(function() {
    document.getElementById('modalNuevaVisita').classList.add('hidden');
    showToast('Visita registrada correctamente', 'success');
    loadArrendatarios();
  }).catch(function(e) {
    showToast('Error al guardar: ' + ((e.response && e.response.data && e.response.data.error) || e.message), 'error');
  }).finally(function() {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Guardar Visita';
  });
}

function openVisitasTab() {
  axios.get('/api/visitas').then(function(r) {
    renderVisitasTable(r.data);
    document.getElementById('modalVisitas').classList.remove('hidden');
  });
}

function renderVisitasTable(data) {
  var cont    = document.getElementById('visitasHistorial');
  var countEl = document.getElementById('visitasCount');
  if (countEl) countEl.textContent = data.length + ' visita(s) registrada(s)';
  if (!data.length) {
    cont.innerHTML = '<p class="text-gray-400 text-center py-10"><i class="fas fa-calendar-times text-4xl block mb-2"></i>No hay visitas</p>';
    return;
  }
  cont.innerHTML =
    '<div id="visitasTableWrapper">' +
      '<table id="visitasTable" class="vt">' +
        '<thead><tr>' +
          '<th>ARRENDATARIO</th><th>TIPO LOCAL</th><th>UBICACION</th>' +
          '<th>FECHA VISITA</th><th>ENCARGADO</th><th>ENTREGO</th>' +
          '<th>DOCS ENTREGADOS</th><th>DOCS FALTANTES</th>' +
          '<th>MOTIVO NO ENTREGA</th><th>NOTAS</th>' +
          '<th style="background:#1e3a8a;border:1px solid #2563eb;width:36px"></th>' +
        '</tr></thead>' +
        '<tbody>' +
          data.map(function(v) {
            return '<tr>' +
              '<td style="font-weight:600;min-width:130px">' + (v.arrendatario || '') + '</td>' +
              '<td style="font-size:11px;color:#6b7280;min-width:90px">' + (v.tipo || '') + '</td>' +
              '<td style="font-size:11px;color:#6b7280;min-width:110px">' + (v.ubicacion || '') + '</td>' +
              '<td style="white-space:nowrap;font-weight:600">' + (v.fecha_visita || '') + '</td>' +
              '<td style="min-width:100px">' + (v.encargado || '-') + '</td>' +
              '<td style="text-align:center"><span class="' + (v.entrego_documentos ? 'bsi' : 'bno') + '">' + (v.entrego_documentos ? 'SI' : 'NO') + '</span></td>' +
              '<td style="color:#166534;min-width:150px;font-size:11px">' + (v.documentos_entregados || '-') + '</td>' +
              '<td style="color:#991b1b;min-width:150px;font-size:11px">' + (v.documentos_faltantes || '-') + '</td>' +
              '<td style="color:#9a3412;min-width:130px;font-size:11px">' + (v.motivo_no_entrega || '-') + '</td>' +
              '<td style="color:#6b7280;min-width:130px;font-size:11px">' + (v.descripcion || '-') + '</td>' +
              '<td style="text-align:center;background:#fff8f8">' +
                '<button onclick="eliminarVisitaGlobal(' + v.id + ')" style="color:#ef4444;border:none;background:none;cursor:pointer;font-size:13px">' +
                '<i class="fas fa-trash"></i></button></td>' +
            '</tr>';
          }).join('') +
        '</tbody>' +
      '</table>' +
    '</div>';
}

function copyVisitasTable() {
  var table = document.getElementById('visitasTable');
  if (!table) { showToast('No hay datos para copiar', 'error'); return; }
  var clone = table.cloneNode(true);
  clone.querySelectorAll('tr').forEach(function(row) {
    if (row.lastElementChild) row.lastElementChild.remove();
  });
  var tmp = document.createElement('div');
  tmp.style.cssText = 'position:fixed;left:-9999px;top:0';
  tmp.appendChild(clone);
  document.body.appendChild(tmp);
  var range = document.createRange();
  range.selectNode(clone);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  var ok = false;
  try { ok = document.execCommand('copy'); } catch(e) {}
  window.getSelection().removeAllRanges();
  document.body.removeChild(tmp);
  if (ok) {
    showToast('Tabla copiada - abre Excel, selecciona A1 y pega con Ctrl+V', 'success');
  } else {
    showToast('Selecciona la tabla con Ctrl+A y copia con Ctrl+C', 'info');
  }
}

function eliminarVisitaGlobal(id) {
  if (!confirm('Eliminar esta visita?')) return;
  axios.delete('/api/visitas/' + id).then(function() {
    showToast('Visita eliminada', 'success');
    openVisitasTab();
  });
}

function openSubirDoc(id, nombre) {
  document.getElementById('docArrId').value     = id;
  document.getElementById('docArrNombre').value = nombre;
  document.getElementById('uploadInfo').innerHTML = '<i class="fas fa-building mr-2"></i>Para: <strong>' + nombre + '</strong>';
  document.getElementById('docTipo').value      = '';
  document.getElementById('docArchivo').value   = '';
  document.getElementById('docDesc').value      = '';
  document.getElementById('docNombrePreview').textContent = nombre + ' - Tipo.ext';
  document.getElementById('modalSubirDoc').classList.remove('hidden');
}

function updatePreview() {
  var nombre = document.getElementById('docArrNombre').value || 'MARCA';
  var tipo   = document.getElementById('docTipo').value || 'Documento';
  var file   = document.getElementById('docArchivo').files[0];
  var ext    = file ? '.' + file.name.split('.').pop() : '.ext';
  document.getElementById('docNombrePreview').textContent = nombre + ' - ' + tipo + ext;
}

function subirDocumento() {
  var id     = document.getElementById('docArrId').value;
  var nombre = document.getElementById('docArrNombre').value;
  var tipo   = document.getElementById('docTipo').value;
  var file   = document.getElementById('docArchivo').files[0];
  var desc   = document.getElementById('docDesc').value;

  if (!tipo) { showToast('Selecciona el tipo de documento', 'error'); return; }
  if (!file) { showToast('Selecciona un archivo', 'error'); return; }

  var ext           = file.name.split('.').pop();
  var nombreArchivo = nombre + ' - ' + tipo + '.' + ext;

  var reader = new FileReader();
  reader.onload = function(ev) {
    var btn = document.getElementById('btnSubir');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Subiendo...';
    axios.post('/api/documentos', {
      arrendatario_id: parseInt(id),
      tipo_permiso:    tipo,
      nombre_archivo:  nombreArchivo,
      url_archivo:     ev.target.result,
      descripcion:     desc || null
    }).then(function() {
      document.getElementById('modalSubirDoc').classList.add('hidden');
      showToast(nombreArchivo + ' subido. Status actualizado a Recibido', 'success');
      loadArrendatarios();
    }).catch(function(e) {
      showToast('Error al subir: ' + ((e.response && e.response.data && e.response.data.error) || e.message), 'error');
    }).finally(function() {
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-upload"></i> Subir Documento';
    });
  };
  reader.readAsDataURL(file);
}

function openDocsGlobal() {
  axios.get('/api/documentos').then(function(r) {
    allDocsGlobal = r.data;
    renderDocsGlobal(r.data);
    document.getElementById('modalDocsGlobal').classList.remove('hidden');
  });
}

function filtrarDocsGlobal() {
  var s = document.getElementById('docsSearch').value.toLowerCase();
  var t = document.getElementById('docsTipo').value;
  var f = allDocsGlobal.filter(function(d) {
    return (!s || (d.arrendatario || '').toLowerCase().indexOf(s) >= 0 ||
                  (d.tipo_permiso || '').toLowerCase().indexOf(s) >= 0 ||
                  (d.nombre_archivo || '').toLowerCase().indexOf(s) >= 0) &&
           (!t || d.tipo_permiso === t);
  });
  renderDocsGlobal(f);
}

function renderDocsGlobal(data) {
  var cont = document.getElementById('docsGlobalContenido');
  if (!data.length) {
    cont.innerHTML = '<p class="text-gray-400 text-center py-8"><i class="fas fa-folder-open text-4xl block mb-2"></i>Sin documentos subidos</p>';
    return;
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
              '<span class="text-xs text-gray-400">' + (d.fecha_subida || '').split('T')[0] + '</span>' +
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
        '</div>';
      }).join('') +
    '</div>';
}

function eliminarDocGlobal(id) {
  if (!confirm('Eliminar este documento? El status del permiso volvera a Pendiente.')) return;
  axios.delete('/api/documentos/' + id).then(function() {
    showToast('Documento eliminado', 'success');
    loadArrendatarios();
    openDocsGlobal();
  });
}

function exportData(type) { window.open('/api/export/' + type, '_blank'); }

function showToast(msg, type) {
  var t  = document.createElement('div');
  var bg = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600';
  t.className = 'fixed bottom-5 right-5 z-[999] px-5 py-3 rounded-xl shadow-lg text-white font-semibold text-sm ' + bg;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function(){ t.remove(); }, 4500);
}

init();
