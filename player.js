let videoList = [];
let videoTitles = {};
let crossfadeSec = 10;
let currentIndex = 0;

let playerA, playerB;
let activePlayer = 'A';
let isCrossfading = false;
let checkInterval = null;

const CROSSFADE_PREVIEW_LEAD = 10; // segundos antes del crossfade en que avisamos

// --- Preferencias persistentes (shuffle, repeat, notificaciones, favoritos) ---
let shuffleOn = false;
let repeatMode = 'off'; // 'off' | 'all' | 'one'
let shuffleBag = [];
let shuffleCycleStarted = false;
let notificationsOn = false;
let favoritos = {};
let mostrarSoloFavoritos = false;

try { shuffleOn = localStorage.getItem('pb_shuffle') === '1'; } catch (e) {}
try {
    const savedRepeat = localStorage.getItem('pb_repeat');
    if (savedRepeat === 'all' || savedRepeat === 'one') repeatMode = savedRepeat;
} catch (e) {}
try { notificationsOn = localStorage.getItem('pb_notify') === '1'; } catch (e) {}
try { favoritos = JSON.parse(localStorage.getItem('pb_favoritos') || '{}'); } catch (e) { favoritos = {}; }

// Parseo de parámetros URL
const urlParams = new URLSearchParams(window.location.search);
const videosParam = urlParams.get('videos');
const titlesParam = urlParams.get('titles');
const fadeParam = urlParams.get('crossfade');
const folderIdParam = urlParams.get('folderId');

// --- Cola de playlists / reproducción automática ---
// Cuando termina la última pista de la playlist, se pide a la extensión cuál
// es la próxima (primero la cola, y si está vacía una carpeta al azar) y se
// hace crossfade hacia su primera pista, igual que entre pistas normales.
const NEXT_PLAYLIST_LEAD = 60; // segundos de anticipación (además del crossfade) para ir a buscarla
let currentFolderId = folderIdParam;   // carpeta de la playlist que está sonando
let currentFolderName = '';
let nextPlaylist = null;               // { folderId, name, source, videos[], titles{} } ya descargada
let nextPlaylistInFlight = false;
let nextPlaylistTry = 0;
let nextPlaylistLastTry = 0;
let nextPlaylistError = false;
let queueInfo = null;                  // { queueLength, next[], auto, currentName }
let awaitingCommitThenRequest = false; // se descartó una playlist entera rota: pedir otra al confirmarse

// --- Pistas que YouTube no deja reproducir (bloqueadas por el dueño, privadas, eliminadas...) ---
// Se detectan ANTES de que les toque sonar (chequeo previo vía la extensión) o, si el chequeo no
// alcanza (p. ej. restricción por país), cuando el reproductor da error. En ambos casos el
// crossfade va directo a la siguiente pista que sí se puede reproducir.
const PRECHECK_AHEAD = 3;      // cuántas pistas por delante se revisan
const badVideos = {};          // id -> 'blocked' | 'missing' | 'error'
const verifiedOk = {};         // id -> true (el chequeo previo confirmó que se puede reproducir)
const precheckTries = {};      // id -> veces que se pidió revisarla (para no insistir sin fin)
let precheckInFlight = false;
let precheckToken = 0;
let lastPrecheckKey = '';
let nearPrecheckKey = '';
const playerVideoId = { A: null, B: null }; // qué video cargó cada reproductor (para saber cuál falló)
let currentFade = null;        // datos del crossfade en curso (para poder cancelarlo si falla la entrante)
let activeTrackFailed = false; // la pista que sonaba falló y hay que pasar a otra
let crossfadeRetry = false;    // se canceló un cruce por una pista rota: el próximo intento va con el tiempo que quede

if (videosParam) {
    videoList = videosParam.split(',').map(id => id.trim()).filter(id => id.length > 0);
}

// Fallback de demostración si la URL se abre vacía sin parámetros
if (videoList.length === 0) {
    videoList = ['jfKfPfyJRdk', '5qap5aO4i9A', 'DWuZBoX61XU'];
    videoTitles = {
        'jfKfPfyJRdk': 'Lofi Hip Hop Radio - Beats to Relax/Study',
        '5qap5aO4i9A': 'Lofi Chill Beats',
        'DWuZBoX61XU': 'Relaxing Jazz Music'
    };
}

if (titlesParam) {
    try {
        videoTitles = JSON.parse(decodeURIComponent(titlesParam));
    } catch (e) {
        console.error("Error al decodificar títulos", e);
    }
}
if (fadeParam) {
    crossfadeSec = parseInt(fadeParam, 10) || 10;
} else {
    try {
        const savedCrossfade = localStorage.getItem('pb_crossfade_sec');
        if (savedCrossfade) crossfadeSec = parseInt(savedCrossfade, 10) || crossfadeSec;
    } catch (e) {}
}

function updateStatus(content) {
    const el = document.getElementById('status');
    if (el) el.innerHTML = content;
}

// --- Puente con la extensión vía postMessage (content-bridge.js) ---
// No depende de ningún parámetro en la URL: si la extensión está activa
// y actualizada, content-bridge.js contesta "PB_BRIDGE_READY" apenas
// carga la página. Guardamos eso para saber si hay conexión disponible.
let bridgeDisponible = false;
let pedidoRefreshPendiente = null; // { resolve } del pedido en curso

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;

    if (event.data.type === 'PB_BRIDGE_READY') {
        bridgeDisponible = true;
        return;
    }

    if (event.data.type === 'PB_REFRESH_RESULT' && pedidoRefreshPendiente) {
        const { resolve } = pedidoRefreshPendiente;
        pedidoRefreshPendiente = null;
        resolve(event.data);
        return;
    }

    if (event.data.type === 'PB_NEXT_PLAYLIST_RESULT') {
        const d = event.data;
        nextPlaylistInFlight = false;
        nextPlaylistError = false;
        if (d.ok && Array.isArray(d.videos) && d.videos.length > 0) {
            nextPlaylist = {
                folderId: d.folderId,
                name: d.name || 'Próxima playlist',
                source: d.source,
                videos: d.videos,
                titles: d.titles || {}
            };
        } else {
            nextPlaylist = null;
            if (d.error) nextPlaylistError = true;
        }
        renderNextPlaylistInfo();
        return;
    }

    if (event.data.type === 'PB_QUEUE_INFO_RESULT') {
        queueInfo = event.data.error ? null : event.data;
        renderNextPlaylistInfo();
        return;
    }

    if (event.data.type === 'PB_CHECK_VIDEOS_RESULT') {
        precheckInFlight = false;
        const results = event.data.results || {};
        let foundBad = false;
        Object.keys(results).forEach((id) => {
            const r = results[id];
            if (r === 'ok') {
                verifiedOk[id] = true;
            } else if ((r === 'blocked' || r === 'missing') && !badVideos[id]) {
                badVideos[id] = r;
                foundBad = true;
            }
            // 'unknown' (sin internet, etc.): no se marca como rota, se reintenta más tarde.
        });
        if (foundBad) renderPlaylist();
        precheckUpcoming(); // por si quedan candidatos sin revisar (p. ej. tras descartar una bloqueada)
        return;
    }

    if (event.data.type === 'PB_COMMIT_RESULT') {
        if (awaitingCommitThenRequest) {
            awaitingCommitThenRequest = false;
            nextPlaylistLastTry = 0;
            requestNextPlaylist();
        }
    }
});

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Pide a la extensión cuál es la próxima playlist (cola o al azar), sin consumirla todavía.
function requestNextPlaylist() {
    if (nextPlaylistInFlight) return;
    nextPlaylistInFlight = true;
    nextPlaylistLastTry = Date.now();
    const thisTry = ++nextPlaylistTry;

    setTimeout(() => {
        if (nextPlaylistInFlight && thisTry === nextPlaylistTry) {
            nextPlaylistInFlight = false;
            nextPlaylistError = true;
            renderNextPlaylistInfo();
        }
    }, 6000);

    window.postMessage({ type: 'PB_REQUEST_NEXT_PLAYLIST', currentFolderId }, '*');
}

function requestQueueInfo() {
    window.postMessage({ type: 'PB_REQUEST_QUEUE_INFO', currentFolderId }, '*');
}

// Muestra en el panel qué playlist suena y cuál viene después.
function renderNextPlaylistInfo() {
    const currentEl = document.getElementById('current-folder-line');
    const nextEl = document.getElementById('next-playlist-line');

    if (currentEl) {
        const name = (queueInfo && queueInfo.currentName) || currentFolderName;
        currentEl.textContent = name ? `📁 ${name}` : '';
    }
    if (!nextEl) return;

    let text = '';
    if (repeatMode !== 'off') {
        text = '⏭ Próxima playlist: en pausa mientras 🔁 esté activado';
    } else if (nextPlaylist) {
        text = `⏭ Próxima: ${nextPlaylist.name} ${nextPlaylist.source === 'auto' ? '🎲 (al azar)' : '(de la cola)'}`;
    } else if (nextPlaylistError) {
        text = '⚠️ No se pudo consultar la cola (la extensión no responde). Probá recargar con F5.';
    } else if (queueInfo && queueInfo.queueLength > 0) {
        const extra = queueInfo.queueLength > 1 ? ` (+${queueInfo.queueLength - 1} más en cola)` : '';
        text = `⏭ Próxima: ${queueInfo.next[0] || 'carpeta de la cola'}${extra}`;
    } else if (queueInfo && queueInfo.auto) {
        text = '⏭ Próxima: una carpeta al azar 🎲';
    } else if (queueInfo) {
        text = '⏹ Sin cola ni modo automático: al terminar la playlist se detiene';
    }
    nextEl.textContent = text;
}

// ¿Es la última pista de esta playlist? (misma lógica que decideNextIndex, pero sin efectos secundarios)
function isLastTrackOfPlaylist() {
    if (repeatMode !== 'off') return false;
    if (videoList.length === 0) return false;

    const pool = getPlaybackPool();
    if (pool.length === 0) return true;

    // Las pistas que quedan por delante y están marcadas como rotas no cuentan:
    // si solo quedan de esas, esta es "la última" a todos los efectos.
    if (shuffleOn) {
        if (pool.length <= 1) return true;
        if (!shuffleCycleStarted) return false;
        return shuffleBag.every((id) => badVideos[id]);
    }

    const poolIndex = pool.indexOf(videoList[currentIndex]);
    if (poolIndex === -1) return false;
    return pool.slice(poolIndex + 1).every((id) => badVideos[id]);
}

// Cuando se acaba la playlist: crossfade hacia la primera pista de la próxima.
// Devuelve true si el cruce arrancó.
function tryAdvanceToNextPlaylist(timeLeft) {
    if (isCrossfading) return false;

    if (!nextPlaylist) {
        // Todavía no llegó (o no hay): se vuelve a pedir, sin saturar.
        if (!nextPlaylistInFlight && Date.now() - nextPlaylistLastTry > 8000) requestNextPlaylist();
        return false;
    }

    // Arranca por la primera pista que no esté marcada como rota.
    const startIndex = nextPlaylist.videos.findIndex((id) => !badVideos[id]);
    if (startIndex === -1) {
        // Todas las pistas de esa playlist están bloqueadas: se descarta (se consume) y se pide otra.
        const broken = nextPlaylist;
        nextPlaylist = null;
        awaitingCommitThenRequest = true;
        window.postMessage({
            type: 'PB_COMMIT_NEXT_PLAYLIST',
            folderId: broken.folderId,
            source: broken.source,
            previousFolderId: currentFolderId
        }, '*');
        return false;
    }

    // Si quedan menos segundos que el crossfade configurado, se acorta para que el cruce
    // termine antes de que la pista actual se acabe.
    const fadeSec = Math.max(1, Math.min(crossfadeSec, timeLeft));
    const np = nextPlaylist;
    np.startIndex = startIndex;
    nextPlaylist = null;
    startCrossfade(0, { newPlaylist: np, fadeSec });
    return true;
}

// Reemplaza la playlist en pantalla por la nueva (se llama cuando el cruce terminó).
function applyNewPlaylist(np) {
    videoList = np.videos.slice();
    videoTitles = { ...np.titles };
    currentIndex = np.startIndex || 0;
    currentFolderId = np.folderId;
    currentFolderName = np.name || '';
    shuffleBag = [];
    shuffleCycleStarted = false;
    nextPlaylist = null;
    nextPlaylistError = false;
    queueInfo = null;

    // Si el filtro de favoritos estaba activo y esta playlist no tiene ninguno, se apaga
    // para que no se quede sin temas.
    if (mostrarSoloFavoritos && !videoList.some(id => favoritos[id])) {
        mostrarSoloFavoritos = false;
        const favFilterBtn = document.getElementById('fav-filter-btn');
        if (favFilterBtn) {
            favFilterBtn.classList.remove('active');
            favFilterBtn.title = 'Mostrar solo favoritos';
        }
    }

    // Si se recarga la página (F5), que vuelva a arrancar desde esta playlist y no desde la original.
    // (mismo formato de URL que arma el popup de la extensión)
    try {
        let query = `?videos=${videoList.join(',')}`
            + `&titles=${encodeURIComponent(JSON.stringify(videoTitles))}`
            + `&crossfade=${crossfadeSec}`;
        if (currentFolderId) query += `&folderId=${currentFolderId}`;
        history.replaceState(null, '', `${window.location.pathname}${query}`);
    } catch (e) { /* no es crítico */ }
}

function syncCrossfadeUI() {
    const fadeInfo = document.getElementById('fade-info');
    if (fadeInfo) fadeInfo.textContent = `${crossfadeSec}s`;
    const slider = document.getElementById('crossfade-slider');
    if (slider && parseInt(slider.value, 10) !== crossfadeSec) slider.value = crossfadeSec;
}

function renderRepeatBtn() {
    const repeatBtn = document.getElementById('repeat-btn');
    if (!repeatBtn) return;
    repeatBtn.classList.toggle('active', repeatMode !== 'off');
    repeatBtn.textContent = repeatMode === 'one' ? '🔂' : '🔁';
    repeatBtn.title = repeatMode === 'off'
        ? 'Repetir: apagado'
        : repeatMode === 'all'
            ? 'Repetir: toda la playlist'
            : 'Repetir: este tema';
}

function notifyTrackIfNeeded(title) {
    if (!notificationsOn) return;
    // Se muestra siempre que esté activado, sin importar si la pestaña
    // está en foco o no — así aparece como notificación del sistema
    // aunque estés viendo otra cosa en pantalla.
    window.postMessage({ type: 'PB_NOTIFY_TRACK', title: 'Ahora suena', body: title }, '*');
}

function setupEvents() {
    const btn = document.getElementById('playlist-btn');
    const container = document.getElementById('playlist-container');

    if (btn && container) {
        btn.onclick = (e) => {
            e.stopPropagation();
            const isHidden = container.style.display === 'none' || container.style.display === '';
            container.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) requestQueueInfo(); // al abrir el panel, refresca qué viene después
        };
    }

    const refreshBtn = document.getElementById('refresh-playlist-btn');
    if (refreshBtn) {
        refreshBtn.onclick = (e) => {
            e.stopPropagation();
            recargarPlaylistDesdeMarcadores();
        };
    }

    // Slider de crossfade en vivo
    const crossfadeSlider = document.getElementById('crossfade-slider');
    if (crossfadeSlider) {
        crossfadeSlider.value = crossfadeSec;
        crossfadeSlider.addEventListener('click', (e) => e.stopPropagation());
        crossfadeSlider.addEventListener('input', () => {
            crossfadeSec = parseInt(crossfadeSlider.value, 10) || 10;
            syncCrossfadeUI();
            try { localStorage.setItem('pb_crossfade_sec', String(crossfadeSec)); } catch (e) {}
        });
    }

    // Shuffle
    const shuffleBtn = document.getElementById('shuffle-btn');
    if (shuffleBtn) {
        shuffleBtn.classList.toggle('active', shuffleOn);
        shuffleBtn.onclick = (e) => {
            e.stopPropagation();
            shuffleOn = !shuffleOn;
            shuffleBag = [];
            shuffleCycleStarted = false;
            shuffleBtn.classList.toggle('active', shuffleOn);
            try { localStorage.setItem('pb_shuffle', shuffleOn ? '1' : '0'); } catch (e) {}
        };
    }

    // Repeat (off -> all -> one -> off)
    const repeatBtn = document.getElementById('repeat-btn');
    if (repeatBtn) {
        renderRepeatBtn();
        repeatBtn.onclick = (e) => {
            e.stopPropagation();
            repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
            renderRepeatBtn();
            renderNextPlaylistInfo();
            try { localStorage.setItem('pb_repeat', repeatMode); } catch (e) {}
        };
    }

    // Notificaciones de escritorio
    const notifyBtn = document.getElementById('notify-btn');
    if (notifyBtn) {
        notifyBtn.classList.toggle('active', notificationsOn);
        notifyBtn.title = notificationsOn ? 'Notificaciones: activadas' : 'Notificaciones: desactivadas';
        notifyBtn.onclick = (e) => {
            e.stopPropagation();
            notificationsOn = !notificationsOn;
            notifyBtn.classList.toggle('active', notificationsOn);
            notifyBtn.title = notificationsOn ? 'Notificaciones: activadas' : 'Notificaciones: desactivadas';
            try { localStorage.setItem('pb_notify', notificationsOn ? '1' : '0'); } catch (e) {}
        };
    }

    // Filtro de favoritos
    const favFilterBtn = document.getElementById('fav-filter-btn');
    if (favFilterBtn) {
        favFilterBtn.classList.toggle('active', mostrarSoloFavoritos);
        favFilterBtn.title = mostrarSoloFavoritos ? 'Mostrando solo favoritos (tocá para ver todos)' : 'Mostrar solo favoritos';
        favFilterBtn.onclick = (e) => {
            e.stopPropagation();
            mostrarSoloFavoritos = !mostrarSoloFavoritos;
            favFilterBtn.classList.toggle('active', mostrarSoloFavoritos);
            favFilterBtn.title = mostrarSoloFavoritos ? 'Mostrando solo favoritos (tocá para ver todos)' : 'Mostrar solo favoritos';
            shuffleBag = [];
            shuffleCycleStarted = false;
            renderPlaylist();

            if (mostrarSoloFavoritos) {
                const cantidad = videoList.filter(id => favoritos[id]).length;
                updateStatus(cantidad > 0
                    ? `★ Reproduciendo solo favoritos (${cantidad})`
                    : '⚠️ No marcaste ningún favorito todavía.');
            } else {
                updateStatus('Volviendo a reproducir toda la playlist');
            }
        };
    }
}

// Vuelve a leer la carpeta de marcadores y agrega los temas nuevos
// que se hayan sumado, sin reiniciar la playlist ni el reproductor.
function recargarPlaylistDesdeMarcadores() {
    const refreshBtn = document.getElementById('refresh-playlist-btn');
    if (refreshBtn) refreshBtn.classList.add('spinning');

    const finish = () => {
        if (refreshBtn) setTimeout(() => refreshBtn.classList.remove('spinning'), 400);
    };

    if (pedidoRefreshPendiente) {
        // Ya hay un pedido en curso, no dupliques.
        finish();
        return;
    }

    const timeoutId = setTimeout(() => {
        if (!pedidoRefreshPendiente) return;
        pedidoRefreshPendiente = null;
        finish();
        updateStatus(
            bridgeDisponible
                ? '⚠️ No se pudo actualizar la playlist.'
                : '⚠️ La extensión no responde en esta pestaña. Recargá esta página una vez (F5) para reconectar — después no va a hacer falta de nuevo.'
        );
    }, 4000);

    pedidoRefreshPendiente = {
        resolve: (data) => {
            clearTimeout(timeoutId);
            finish();

            if (!data || data.error) {
                updateStatus('⚠️ No se pudo actualizar la playlist.');
                return;
            }

            aplicarActualizacionDeMarcadores(data.videos || [], data.titles || {});
        }
    };

    window.postMessage({ type: 'PB_REQUEST_REFRESH', folderId: currentFolderId }, '*');
}

function aplicarActualizacionDeMarcadores(freshIds, freshTitles) {
    if (!freshIds || freshIds.length === 0) {
        updateStatus('No se encontraron videos en la carpeta.');
        return;
    }

    const currentTrackId = videoList[currentIndex];

    // Mantenemos el orden que ya armaste a mano para los temas que siguen
    // en la carpeta, y agregamos al final los que sean nuevos, en el orden
    // en que aparecen en la carpeta de marcadores.
    const keptInOrder = videoList.filter(id => freshIds.includes(id));
    const added = freshIds.filter(id => !videoList.includes(id));

    videoList = [...keptInOrder, ...added];
    videoTitles = { ...videoTitles, ...freshTitles };

    shuffleBag = [];
    shuffleCycleStarted = false;

    currentIndex = videoList.indexOf(currentTrackId);
    if (currentIndex === -1) currentIndex = 0;

    renderPlaylist();

    if (added.length > 0) {
        updateStatus(`✅ ${added.length} tema${added.length > 1 ? 's' : ''} nuevo${added.length > 1 ? 's' : ''} agregado${added.length > 1 ? 's' : ''} a la playlist`);
    } else {
        updateStatus('Playlist actualizada — sin cambios');
    }
}



function toggleFavorito(id) {
    if (favoritos[id]) {
        delete favoritos[id];
    } else {
        favoritos[id] = true;
    }
    try { localStorage.setItem('pb_favoritos', JSON.stringify(favoritos)); } catch (e) {}

    if (mostrarSoloFavoritos) {
        shuffleBag = [];
        shuffleCycleStarted = false;
    }

    renderPlaylist();
}

function removeTrackFromSession(index) {
    if (index === currentIndex) {
        updateStatus('No podés quitar el tema que está sonando ahora mismo.');
        return;
    }
    if (videoList.length <= 1) {
        updateStatus('No podés vaciar la playlist completamente.');
        return;
    }

    const removedId = videoList[index];
    videoList.splice(index, 1);
    if (index < currentIndex) currentIndex--;

    shuffleBag = shuffleBag.filter(id => id !== removedId);

    renderPlaylist();
    updateStatus('Tema quitado de esta playlist (el marcador original sigue intacto).');
}

function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function getPlaybackPool() {
    if (!mostrarSoloFavoritos) return videoList;
    return videoList.filter(id => favoritos[id]);
}

function refillShuffleBag(pool) {
    const currentId = videoList[currentIndex];
    shuffleBag = shuffleArray(pool.filter(id => id !== currentId));
}

// Decide el próximo índice a reproducir según shuffle/repeat/favoritos.
// Devuelve -1 si no hay que seguir reproduciendo.
// (from = pista desde la que se cuenta "la siguiente"; por defecto la actual.)
function decideNextIndex(from = currentIndex, opts = {}) {
    if (videoList.length === 0) return -1;

    const pool = getPlaybackPool();
    if (pool.length === 0) return -1; // filtro de favoritos activo y no hay ninguno marcado

    if (repeatMode === 'one' && !opts.ignoreRepeatOne) return from;

    if (shuffleOn) {
        if (pool.length <= 1) return repeatMode === 'off' ? -1 : videoList.indexOf(pool[0]);

        if (shuffleBag.length === 0) {
            if (shuffleCycleStarted && repeatMode === 'off') return -1;
            refillShuffleBag(pool);
            shuffleCycleStarted = true;
        }

        const nextId = shuffleBag.pop();
        const idx = videoList.indexOf(nextId);
        if (idx === -1) return decideNextIndex(from, opts); // el track ya no existe, probamos con el siguiente
        return idx;
    }

    const currentId = videoList[from];
    const poolIndex = pool.indexOf(currentId);
    // Si el tema actual no está en el pool (ej: se activó el filtro a mitad de un track no favorito), arrancamos desde el principio del pool.
    const nextPoolIndex = poolIndex === -1 ? 0 : poolIndex + 1;

    if (nextPoolIndex < pool.length) {
        return videoList.indexOf(pool[nextPoolIndex]);
    }
    return repeatMode === 'all' ? videoList.indexOf(pool[0]) : -1;
}

// Igual que decideNextIndex, pero se salta las pistas marcadas como no reproducibles.
// Devuelve -1 si no queda ninguna reproducible por delante.
function decideNextPlayableIndex() {
    let from = currentIndex;
    for (let guard = 0; guard <= videoList.length; guard++) {
        // Si la pista actual es una rota, "repetir esta" no tiene sentido: se sigue de largo.
        const ignoreRepeatOne = guard > 0 || !!badVideos[videoList[from]];
        const idx = decideNextIndex(from, { ignoreRepeatOne });
        if (idx === -1) return -1;
        if (!badVideos[videoList[idx]]) return idx;
        from = idx;
    }
    return -1;
}

// --- Chequeo previo: ¿se van a poder reproducir las próximas pistas? ---
// Devuelve (sin consumir nada) los ids de las próximas PRECHECK_AHEAD pistas que se van a
// reproducir, más las primeras de la próxima playlist cuando ya está descargada.
function getUpcomingCandidateIds() {
    const ids = [];
    const push = (id) => { if (id && !badVideos[id] && !ids.includes(id)) ids.push(id); };

    if (repeatMode !== 'one') {
        const pool = getPlaybackPool();
        const currentId = videoList[currentIndex];

        if (shuffleOn) {
            // En aleatorio el orden se define al llenar la "bolsa": se llena ya para poder mirar adelante.
            if (!shuffleCycleStarted && pool.length > 1) {
                refillShuffleBag(pool);
                shuffleCycleStarted = true;
            }
            for (let i = shuffleBag.length - 1; i >= 0 && ids.length < PRECHECK_AHEAD; i--) push(shuffleBag[i]);
        } else if (pool.length > 0) {
            const poolIndex = pool.indexOf(currentId);
            for (let step = 1; step <= pool.length && ids.length < PRECHECK_AHEAD; step++) {
                let k = poolIndex === -1 ? step - 1 : poolIndex + step;
                if (k >= pool.length) {
                    if (repeatMode === 'all') k %= pool.length; else break;
                }
                if (pool[k] !== currentId) push(pool[k]);
            }
        }
    }

    if (nextPlaylist) {
        let added = 0;
        for (const id of nextPlaylist.videos) {
            if (added >= PRECHECK_AHEAD) break;
            if (badVideos[id]) continue;
            push(id);
            added++;
        }
    }
    return ids;
}

function precheckUpcoming() {
    if (precheckInFlight) return;

    const wanted = getUpcomingCandidateIds()
        .filter((id) => !verifiedOk[id] && !badVideos[id] && (precheckTries[id] || 0) < 2);
    if (wanted.length === 0) return;

    const ids = wanted.slice(0, 6);
    ids.forEach((id) => { precheckTries[id] = (precheckTries[id] || 0) + 1; });

    precheckInFlight = true;
    const thisToken = ++precheckToken;
    setTimeout(() => {
        if (precheckInFlight && thisToken === precheckToken) precheckInFlight = false;
    }, 8000);

    window.postMessage({ type: 'PB_CHECK_VIDEOS', ids }, '*');
}

function showCrossfadeCountdown(secsToFade) {
    const el = document.getElementById('crossfade-preview');
    const fill = document.getElementById('crossfade-preview-fill');
    const text = document.getElementById('crossfade-preview-text');
    if (!el || !fill || !text) return;

    el.classList.add('active');
    const progress = Math.max(0, Math.min(1, 1 - (secsToFade / CROSSFADE_PREVIEW_LEAD)));
    fill.style.width = `${Math.round(progress * 100)}%`;
    text.textContent = `🔀 Cruce en ${secsToFade}s`;
}

function hideCrossfadeCountdown() {
    const el = document.getElementById('crossfade-preview');
    if (el) el.classList.remove('active');
}

function clearIndicators() {
    document.querySelectorAll('.playlist-item').forEach(el => {
        el.classList.remove('drop-indicator-above', 'drop-indicator-below');
    });
}

function renderPlaylist() {
    const container = document.getElementById('playlist-items');
    const btn = document.getElementById('playlist-btn');

    if (btn) btn.textContent = `≡ Playlist (${videoList.length})`;
    syncCrossfadeUI();

    if (!container) return;
    container.innerHTML = '';

    let draggedIndex = null;
    const filtroActivo = mostrarSoloFavoritos;
    let visibleCount = 0;

    videoList.forEach((id, index) => {
        if (filtroActivo && !favoritos[id]) return;
        visibleCount++;

        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}${badVideos[id] ? ' unplayable' : ''}`;
        if (badVideos[id]) item.title = 'No se puede reproducir (bloqueada por el dueño, privada o eliminada): se saltea';
        item.draggable = !filtroActivo;
        item.dataset.index = index;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'playlist-item-title';
        const title = videoTitles[id] || `Track ${index + 1}`;
        titleSpan.textContent = `${badVideos[id] ? '⚠️ ' : ''}${index + 1}. ${title}`;

        const starBtn = document.createElement('button');
        starBtn.className = 'star-track-btn' + (favoritos[id] ? ' active' : '');
        starBtn.textContent = favoritos[id] ? '★' : '☆';
        starBtn.title = favoritos[id] ? 'Quitar de favoritos' : 'Marcar como favorito';
        starBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFavorito(id);
        };

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-track-btn';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Quitar de esta playlist (no borra el marcador)';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeTrackFromSession(index);
        };

        const actions = document.createElement('div');
        actions.className = 'playlist-item-actions';
        actions.appendChild(starBtn);
        actions.appendChild(removeBtn);

        item.appendChild(titleSpan);
        item.appendChild(actions);

        item.onclick = (e) => {
            if (item.classList.contains('dragging')) return;
            currentIndex = index;
            activeTrackFailed = false; // eligió otra pista a mano: se corta cualquier recuperación en curso
            const targetPlayer = activePlayer === 'A' ? playerA : playerB;
            if (targetPlayer && typeof targetPlayer.loadVideoById === 'function') {
                playerVideoId[activePlayer] = videoList[currentIndex];
                targetPlayer.loadVideoById(videoList[currentIndex]);
                targetPlayer.playVideo();
                renderPlaylist();
                updateStatus(`▶ Sonando: <strong>${title}</strong>`);
                notifyTrackIfNeeded(title);
            }
        };

        if (!filtroActivo) {
            // Arrastrar y soltar con línea roja
            item.addEventListener('dragstart', (e) => {
                draggedIndex = index;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                clearIndicators();
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                clearIndicators();

                const rect = item.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;

                if (e.clientY < midpoint) {
                    item.classList.add('drop-indicator-above');
                } else {
                    item.classList.add('drop-indicator-below');
                }
            });

            item.addEventListener('dragleave', () => {
                item.classList.remove('drop-indicator-above', 'drop-indicator-below');
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                clearIndicators();

                const targetIndex = parseInt(item.dataset.index, 10);
                if (draggedIndex === null || draggedIndex === targetIndex) return;

                const rect = item.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                let newIndex = e.clientY < midpoint ? targetIndex : targetIndex + 1;

                if (draggedIndex < newIndex) newIndex--;

                const currentTrackId = videoList[currentIndex];
                const movedItem = videoList.splice(draggedIndex, 1)[0];
                videoList.splice(newIndex, 0, movedItem);

                currentIndex = videoList.indexOf(currentTrackId);
                shuffleBag = [];
                shuffleCycleStarted = false;
                renderPlaylist();
            });
        }

        container.appendChild(item);
    });

    if (filtroActivo && visibleCount === 0) {
        const empty = document.createElement('div');
        empty.className = 'playlist-empty-msg';
        empty.textContent = 'No marcaste ningún favorito todavía. Tocá la ☆ de un tema para agregarlo.';
        container.appendChild(empty);
    }
}

// Red de seguridad: si una pista llega a su fin sin que el monitor (que mira cada 1 s)
// haya alcanzado a arrancar el cruce, se sigue igual en vez de quedar en silencio.
function onPlayerStateChange(which, e) {
    if (!e || e.data !== 0) return; // 0 = ENDED
    if (which !== activePlayer || isCrossfading) return;

    const nextIndex = decideNextPlayableIndex();
    if (nextIndex !== -1) {
        startCrossfade(nextIndex, { fadeSec: 1 });
    } else {
        tryAdvanceToNextPlaylist(0);
    }
}

// --- Errores de YouTube (video bloqueado, privado, eliminado, restringido en tu país...) ---
function onPlayerError(which, e) {
    const code = e && e.data;
    const failedId = playerVideoId[which];
    console.warn(`Error de YouTube (${code}) en el reproductor ${which} con el video ${failedId}`);

    // 1) Falló la pista que estaba ENTRANDO en un crossfade: se cancela el cruce (la actual
    //    sigue sonando) y se vuelve a intentar con la siguiente pista que sí se pueda reproducir.
    if (isCrossfading && which !== activePlayer) {
        abortCrossfade(failedId);
        return;
    }

    // 2) Falló la pista que SUENA (o que debía sonar): se marca y se pasa a otra enseguida.
    if (!isCrossfading && which === activePlayer) {
        if (failedId && !badVideos[failedId]) badVideos[failedId] = 'error';
        activeTrackFailed = true;
        renderPlaylist();
        recoverFromFailedTrack();
    }
    // Cualquier otro caso (reproductor inactivo, o la saliente durante un cruce) no necesita acción.
}

// Cancela el crossfade en curso porque la pista entrante falló, y deja todo como estaba
// (la saliente vuelve a su volumen). El monitor reintenta con la próxima pista reproducible.
function abortCrossfade(failedId) {
    const f = currentFade;
    if (!f) return;

    clearInterval(f.interval);
    currentFade = null;
    isCrossfading = false;
    if (failedId && !badVideos[failedId]) badVideos[failedId] = 'error';

    try { if (f.fadeInPlayer && f.fadeInPlayer.stopVideo) f.fadeInPlayer.stopVideo(); } catch (err) {}
    if (f.fadeOutPlayer && f.fadeOutPlayer.setVolume) f.fadeOutPlayer.setVolume(100);

    if (f.fadeOutDiv && f.fadeInDiv) {
        f.fadeOutDiv.style.zIndex = '2';
        f.fadeOutDiv.style.pointerEvents = 'auto';
        f.fadeOutDiv.style.opacity = '1';
        f.fadeInDiv.style.zIndex = '1';
        f.fadeInDiv.style.pointerEvents = 'none';
        f.fadeInDiv.style.opacity = '0';
    }
    const vinylContainer = document.getElementById('vinyl-container');
    if (vinylContainer) vinylContainer.classList.remove('active');

    // Si el cruce era hacia otra playlist, se deja lista para reintentar con su siguiente pista.
    if (f.newPlaylist) nextPlaylist = f.newPlaylist;

    crossfadeRetry = true; // el reintento tiene que terminar antes de que se acabe la pista actual

    const failedTitle = (f.newPlaylist ? f.newPlaylist.titles : videoTitles)[failedId] || 'una pista';
    updateStatus(`⚠️ <strong>${escapeHtml(failedTitle)}</strong> no se puede reproducir: se prueba con la siguiente`);
    renderPlaylist();
}

// La pista que sonaba falló: pasar YA a la siguiente reproducible (o a la próxima playlist).
// Se reintenta desde el monitor cada segundo mientras activeTrackFailed siga activo.
function recoverFromFailedTrack() {
    if (isCrossfading) return;

    const nextIndex = decideNextPlayableIndex();
    if (nextIndex !== -1) {
        startCrossfade(nextIndex, { fadeSec: 1, outgoingNote: '⚠️ no se puede reproducir' });
        return;
    }

    // No queda nada reproducible en esta playlist: se sigue con la próxima.
    if (nextPlaylist) {
        tryAdvanceToNextPlaylist(0);
    } else {
        if (!nextPlaylistInFlight && Date.now() - nextPlaylistLastTry > 8000) requestNextPlaylist();
        updateStatus('⚠️ La pista no se puede reproducir y no quedan más en esta playlist: buscando la próxima…');
    }
}

function onYouTubeIframeAPIReady() {
    setupEvents();
    renderPlaylist();
    setTimeout(requestQueueInfo, 1000);

    updateStatus("Cargando reproductor...");

    const origin = window.location.origin;
    playerVideoId.A = videoList[0];

    playerA = new YT.Player('playerA', {
        height: '100%',
        width: '100%',
        videoId: videoList[0],
        playerVars: { 
            'autoplay': 1, 
            'controls': 1, 
            'rel': 0, 
            'iv_load_policy': 3,
            'origin': origin 
        },
        events: {
            'onReady': (e) => {
                e.target.setVolume(100);
                e.target.playVideo();
                startPlaybackMonitor();
                const initialTitle = videoTitles[videoList[0]] || 'Track 1';
                updateStatus(`▶ Sonando: <strong>${initialTitle}</strong>`);
                notifyTrackIfNeeded(initialTitle);
            },
            'onStateChange': (e) => onPlayerStateChange('A', e),
            'onError': (e) => onPlayerError('A', e)
        }
    });

    playerB = new YT.Player('playerB', {
        height: '100%',
        width: '100%',
        playerVars: {
            'autoplay': 0,
            'controls': 1,
            'rel': 0,
            'iv_load_policy': 3,
            'origin': origin
        },
        events: {
            'onStateChange': (e) => onPlayerStateChange('B', e),
            'onError': (e) => onPlayerError('B', e)
        }
    });
}

function startPlaybackMonitor() {
    if (checkInterval) clearInterval(checkInterval);

    checkInterval = setInterval(() => {
        const currentPlayer = activePlayer === 'A' ? playerA : playerB;
        if (!currentPlayer || typeof currentPlayer.getCurrentTime !== 'function' || typeof currentPlayer.getDuration !== 'function') return;

        // La pista que sonaba falló (un video roto no reporta duración): seguir intentando pasar a otra.
        if (activeTrackFailed && !isCrossfading) {
            recoverFromFailedTrack();
            return;
        }

        const currentTime = currentPlayer.getCurrentTime();
        const duration = currentPlayer.getDuration();

        if (duration > 0 && !isCrossfading) {
            const timeLeft = duration - currentTime;

            // Chequeo previo: se revisa si las próximas pistas se pueden reproducir, apenas empieza
            // la actual (y de nuevo cerca del final), así el cruce ya sabe a dónde ir.
            const precheckKey = `${currentFolderId}|${currentIndex}|${videoList.length}|${nextPlaylist ? nextPlaylist.folderId : ''}|${shuffleOn}|${repeatMode}`;
            if (precheckKey !== lastPrecheckKey) {
                lastPrecheckKey = precheckKey;
                nearPrecheckKey = '';
                precheckUpcoming();
            }
            if (timeLeft <= crossfadeSec + 20 && nearPrecheckKey !== precheckKey) {
                nearPrecheckKey = precheckKey;
                precheckUpcoming();
            }

            // Última pista de la playlist: se va a buscar la próxima (cola o al azar) con anticipación.
            if (timeLeft <= crossfadeSec + NEXT_PLAYLIST_LEAD && isLastTrackOfPlaylist()) {
                if (!nextPlaylist && !nextPlaylistInFlight && Date.now() - nextPlaylistLastTry > 8000) {
                    requestNextPlaylist();
                }
            }

            if (timeLeft <= crossfadeSec) {
                hideCrossfadeCountdown();
                const nextIndex = decideNextPlayableIndex();
                if (nextIndex !== -1) {
                    // Si el cruce arranca tarde (p. ej. se reintenta tras una pista rota), se acorta para
                    // que termine antes de que se acabe la actual.
                    const late = crossfadeRetry || timeLeft < crossfadeSec - 1;
                    startCrossfade(nextIndex, late ? { fadeSec: Math.max(1, Math.min(crossfadeSec, timeLeft)) } : {});
                } else {
                    // La playlist se acabó: seguimos con la próxima en vez de quedar en silencio.
                    tryAdvanceToNextPlaylist(timeLeft);
                }
            } else if (timeLeft <= crossfadeSec + CROSSFADE_PREVIEW_LEAD) {
                showCrossfadeCountdown(Math.ceil(timeLeft - crossfadeSec));
            } else {
                hideCrossfadeCountdown();
            }
        }
    }, 1000);
}

// Cruza hacia la pista nextIndex de la playlist actual o, si options.newPlaylist está
// presente, hacia la PRIMERA pista de otra playlist (cola / modo automático).
// options.fadeSec permite acortar el cruce (por defecto usa el crossfade configurado).
function startCrossfade(nextIndex, options = {}) {
    isCrossfading = true;

    const newPlaylist = options.newPlaylist || null;
    const fadeSec = options.fadeSec || crossfadeSec;

    const fadeOutPlayer = activePlayer === 'A' ? playerA : playerB;
    const fadeInPlayer = activePlayer === 'A' ? playerB : playerA;

    const fadeOutDiv = document.getElementById(activePlayer === 'A' ? 'playerA' : 'playerB');
    const fadeInDiv = document.getElementById(activePlayer === 'A' ? 'playerB' : 'playerA');

    const startIdx = newPlaylist ? (newPlaylist.startIndex || 0) : nextIndex;
    const nextVideoId = newPlaylist ? newPlaylist.videos[startIdx] : videoList[nextIndex];
    const currentTitle = videoTitles[videoList[currentIndex]] || `Track ${currentIndex + 1}`;
    const nextTitle = newPlaylist
        ? (newPlaylist.titles[nextVideoId] || `Track ${startIdx + 1}`)
        : (videoTitles[videoList[nextIndex]] || `Track ${nextIndex + 1}`);
    const nextFolderBadge = newPlaylist ? ` <span style="opacity: 0.7;">· 📁 ${escapeHtml(newPlaylist.name)}</span>` : '';
    const outgoingNote = options.outgoingNote ? ` <span style="color: #ffb300;">(${options.outgoingNote})</span>` : '';

    // Qué video carga el reproductor entrante (para saber cuál falló si da error).
    playerVideoId[activePlayer === 'A' ? 'B' : 'A'] = nextVideoId;

    // Actualización de estado en tiempo real para indicar salida y entrada
    updateStatus(`
        <span class="cf-outgoing">🔻 Saliendo: <strong>${currentTitle}</strong>${outgoingNote}</span>
        <span style="margin: 0 8px; opacity: 0.4;">|</span>
        <span class="cf-incoming">🔺 Entrando: <strong>${nextTitle}</strong>${nextFolderBadge}</span>
    `);

    // Se avisa ya a la extensión que esta playlist empezó a sonar (la saca de la cola / del sorteo).
    if (newPlaylist) {
        window.postMessage({
            type: 'PB_COMMIT_NEXT_PLAYLIST',
            folderId: newPlaylist.folderId,
            source: newPlaylist.source,
            previousFolderId: currentFolderId
        }, '*');
    }

    // Mostrar animación de vinilos al iniciar el crossfade
    const vinylContainer = document.getElementById('vinyl-container');
    if (vinylContainer) {
        vinylContainer.classList.add('active');
    }

    if (fadeOutDiv && fadeInDiv) {
        fadeInDiv.style.zIndex = '2';
        fadeInDiv.style.pointerEvents = 'auto';
        
        fadeOutDiv.style.zIndex = '1';
        fadeOutDiv.style.pointerEvents = 'none';

        fadeInDiv.style.opacity = '1';
        fadeOutDiv.style.opacity = '0';
    }

    if (fadeInPlayer && typeof fadeInPlayer.loadVideoById === 'function') {
        fadeInPlayer.setVolume(0);
        fadeInPlayer.loadVideoById(nextVideoId);
        fadeInPlayer.playVideo();
    }

    const durationMs = fadeSec * 1000;
    const intervalMs = 50;
    const totalSteps = durationMs / intervalMs;
    let currentStep = 0;

    let fadeInterval = setInterval(() => {
        currentStep++;
        let progress = currentStep / totalSteps;

        if (progress >= 1) {
            clearInterval(fadeInterval);
            currentFade = null;
            if (fadeOutPlayer && typeof fadeOutPlayer.stopVideo === 'function') fadeOutPlayer.stopVideo();
            activePlayer = activePlayer === 'A' ? 'B' : 'A';

            if (newPlaylist) {
                applyNewPlaylist(newPlaylist); // reemplaza la lista y deja currentIndex en la pista de arranque
            } else {
                currentIndex = nextIndex;
            }
            isCrossfading = false;
            activeTrackFailed = false;
            crossfadeRetry = false;

            // Ocultar animación de vinilos al finalizar la transición
            if (vinylContainer) {
                vinylContainer.classList.remove('active');
            }

            renderPlaylist();
            const newTitle = videoTitles[videoList[currentIndex]] || `Track ${currentIndex + 1}`;
            const folderBadge = newPlaylist ? ` <span style="opacity: 0.7;">· 📁 ${escapeHtml(newPlaylist.name)}</span>` : '';
            updateStatus(`▶ Sonando: <strong>${newTitle}</strong>${folderBadge}`);
            notifyTrackIfNeeded(newTitle);

            if (newPlaylist) {
                requestQueueInfo(); // actualiza "Próxima playlist" en el panel
            }
        } else {
            if (fadeOutPlayer && typeof fadeOutPlayer.setVolume === 'function') fadeOutPlayer.setVolume(Math.round((1 - progress) * 100));
            if (fadeInPlayer && typeof fadeInPlayer.setVolume === 'function') fadeInPlayer.setVolume(Math.round(progress * 100));
        }
    }, intervalMs);

    // Se guarda lo necesario para poder cancelar el cruce si la pista entrante falla.
    currentFade = { interval: fadeInterval, fadeOutPlayer, fadeInPlayer, fadeOutDiv, fadeInDiv, newPlaylist };
}

// --- ESCUCHAR ACTUALIZACIONES EN TIEMPO REAL DESDE LA EXTENSIÓN ---
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === "UPDATE_PLAYLIST") {
            // Guardar el video que está sonando actualmente para mantener su posición activa
            const currentVideoId = videoList[currentIndex];

            // Actualizar arrays con la lista enviada por popup.js
            videoList = request.videos || [];
            videoTitles = request.titles || {};

            // Reajustar currentIndex para no perder de vista la pista en reproducción
            if (currentVideoId && videoList.includes(currentVideoId)) {
                currentIndex = videoList.indexOf(currentVideoId);
            } else if (currentIndex >= videoList.length) {
                currentIndex = Math.max(0, videoList.length - 1);
            }

            // Redibujar la lista desplegable en pantalla
            renderPlaylist();
        }
    });
}
