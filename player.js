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
let masterVolume = 100;
let fontScale = 1;
let highContrastOn = false;

try { shuffleOn = localStorage.getItem('pb_shuffle') === '1'; } catch (e) {}
try {
    const savedRepeat = localStorage.getItem('pb_repeat');
    if (savedRepeat === 'all' || savedRepeat === 'one') repeatMode = savedRepeat;
} catch (e) {}
try { notificationsOn = localStorage.getItem('pb_notify') === '1'; } catch (e) {}
try { favoritos = JSON.parse(localStorage.getItem('pb_favoritos') || '{}'); } catch (e) { favoritos = {}; }
try {
    const savedVol = localStorage.getItem('pb_master_volume');
    if (savedVol !== null) masterVolume = parseInt(savedVol, 10);
} catch (e) {}
if (isNaN(masterVolume) || masterVolume < 0 || masterVolume > 100) masterVolume = 100;
try {
    const savedFontScale = localStorage.getItem('pb_font_scale');
    if (savedFontScale !== null) fontScale = parseFloat(savedFontScale);
} catch (e) {}
if (isNaN(fontScale) || fontScale < 0.7 || fontScale > 1.6) fontScale = 1;
try { highContrastOn = localStorage.getItem('pb_high_contrast') === '1'; } catch (e) {}

// --- Feature 23/24: precarga y vista previa del siguiente tema ---
let nextIndexCache = null;
let preloadedTrackId = null;
let pendingIdByPlayer = { A: null, B: null };

// --- Feature 28: links rotos ---
let brokenTrackIds = new Set();

// Parseo de parámetros URL
const urlParams = new URLSearchParams(window.location.search);
const videosParam = urlParams.get('videos');
const titlesParam = urlParams.get('titles');
const fadeParam = urlParams.get('crossfade');
const folderIdParam = urlParams.get('folderId');

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
    }
});

// --- Feature 35: sincronizar preferencias entre pestañas de la misma carpeta ---
// 'storage' solo dispara en OTRAS pestañas del mismo origen, no en la que hizo el cambio.
window.addEventListener('storage', (event) => {
    if (!event.key) return;

    switch (event.key) {
        case 'pb_favoritos':
            try { favoritos = JSON.parse(event.newValue || '{}'); } catch (e) { favoritos = {}; }
            renderPlaylist();
            break;

        case 'pb_shuffle': {
            shuffleOn = event.newValue === '1';
            shuffleBag = [];
            shuffleCycleStarted = false;
            nextIndexCache = null;
            const shuffleBtn = document.getElementById('shuffle-btn');
            if (shuffleBtn) shuffleBtn.classList.toggle('active', shuffleOn);
            break;
        }

        case 'pb_repeat':
            repeatMode = (event.newValue === 'all' || event.newValue === 'one') ? event.newValue : 'off';
            nextIndexCache = null;
            renderRepeatBtn();
            break;

        case 'pb_crossfade_sec':
            crossfadeSec = parseInt(event.newValue, 10) || crossfadeSec;
            syncCrossfadeUI();
            break;

        case 'pb_master_volume':
            masterVolume = parseInt(event.newValue, 10);
            if (isNaN(masterVolume)) masterVolume = 100;
            syncVolumeUI();
            break;

        case 'pb_notify': {
            notificationsOn = event.newValue === '1';
            const notifyBtn = document.getElementById('notify-btn');
            if (notifyBtn) {
                notifyBtn.classList.toggle('active', notificationsOn);
                notifyBtn.title = notificationsOn ? 'Notificaciones: activadas' : 'Notificaciones: desactivadas';
            }
            break;
        }

        case 'pb_font_scale':
            fontScale = parseFloat(event.newValue);
            if (isNaN(fontScale)) fontScale = 1;
            applyFontScale();
            break;

        case 'pb_high_contrast':
            highContrastOn = event.newValue === '1';
            applyHighContrast();
            break;
    }
});

function syncCrossfadeUI() {
    const fadeInfo = document.getElementById('fade-info');
    if (fadeInfo) fadeInfo.textContent = `${crossfadeSec}s`;
    const slider = document.getElementById('crossfade-slider');
    if (slider && parseInt(slider.value, 10) !== crossfadeSec) slider.value = crossfadeSec;
}

function syncVolumeUI() {
    const volumeInfo = document.getElementById('volume-info');
    if (volumeInfo) volumeInfo.textContent = `${masterVolume}%`;
    const slider = document.getElementById('master-volume-slider');
    if (slider && parseInt(slider.value, 10) !== masterVolume) slider.value = masterVolume;
}

function applyFontScale() {
    document.documentElement.style.setProperty('--pb-font-scale', fontScale);
}

function applyHighContrast() {
    document.body.classList.toggle('high-contrast', highContrastOn);
    const contrastBtn = document.getElementById('contrast-btn');
    if (contrastBtn) contrastBtn.classList.toggle('active', highContrastOn);
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
    applyFontScale();
    applyHighContrast();

    const btn = document.getElementById('playlist-btn');
    const container = document.getElementById('playlist-container');

    if (btn && container) {
        btn.onclick = (e) => {
            e.stopPropagation();
            const isHidden = container.style.display === 'none' || container.style.display === '';
            container.style.display = isHidden ? 'flex' : 'none';
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
            nextIndexCache = null;
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
            nextIndexCache = null;
            renderRepeatBtn();
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

    // Volumen maestro
    const volumeSlider = document.getElementById('master-volume-slider');
    if (volumeSlider) {
        syncVolumeUI();
        volumeSlider.addEventListener('click', (e) => e.stopPropagation());
        volumeSlider.addEventListener('input', () => {
            masterVolume = parseInt(volumeSlider.value, 10);
            syncVolumeUI();
            try { localStorage.setItem('pb_master_volume', String(masterVolume)); } catch (e) {}

            if (!isCrossfading) {
                const activePlayerObj = activePlayer === 'A' ? playerA : playerB;
                if (activePlayerObj && typeof activePlayerObj.setVolume === 'function') {
                    activePlayerObj.setVolume(masterVolume);
                }
            }
        });
    }

    // Tamaño de letra
    const fontDecBtn = document.getElementById('font-decrease-btn');
    const fontIncBtn = document.getElementById('font-increase-btn');
    if (fontDecBtn) {
        fontDecBtn.onclick = (e) => {
            e.stopPropagation();
            fontScale = Math.max(0.7, Math.round((fontScale - 0.1) * 10) / 10);
            applyFontScale();
            try { localStorage.setItem('pb_font_scale', String(fontScale)); } catch (e) {}
        };
    }
    if (fontIncBtn) {
        fontIncBtn.onclick = (e) => {
            e.stopPropagation();
            fontScale = Math.min(1.6, Math.round((fontScale + 0.1) * 10) / 10);
            applyFontScale();
            try { localStorage.setItem('pb_font_scale', String(fontScale)); } catch (e) {}
        };
    }

    // Alto contraste
    const contrastBtn = document.getElementById('contrast-btn');
    if (contrastBtn) {
        contrastBtn.onclick = (e) => {
            e.stopPropagation();
            highContrastOn = !highContrastOn;
            applyHighContrast();
            try { localStorage.setItem('pb_high_contrast', highContrastOn ? '1' : '0'); } catch (e) {}
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
            nextIndexCache = null;
            preloadedTrackId = null;
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

    window.postMessage({ type: 'PB_REQUEST_REFRESH', folderId: folderIdParam }, '*');
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
    nextIndexCache = null;
    preloadedTrackId = null;
    brokenTrackIds.clear();

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
        nextIndexCache = null;
    }

    renderPlaylist();
}

// Salta directamente a un track (click manual o recuperación tras un link roto).
function saltarATrack(index) {
    currentIndex = index;
    const targetPlayer = activePlayer === 'A' ? playerA : playerB;
    if (targetPlayer && typeof targetPlayer.loadVideoById === 'function') {
        pendingIdByPlayer[activePlayer] = videoList[currentIndex];
        targetPlayer.loadVideoById(videoList[currentIndex]);
        targetPlayer.setVolume(masterVolume);
        targetPlayer.playVideo();
        nextIndexCache = null;
        preloadedTrackId = null;
        renderPlaylist();
        const title = videoTitles[videoList[currentIndex]] || `Track ${currentIndex + 1}`;
        updateStatus(`▶ Sonando: <strong>${title}</strong>`);
        notifyTrackIfNeeded(title);
    }
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
    nextIndexCache = null;
    preloadedTrackId = null;

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
function decideNextIndex() {
    if (videoList.length === 0) return -1;

    const pool = getPlaybackPool();
    if (pool.length === 0) return -1; // filtro de favoritos activo y no hay ninguno marcado

    if (repeatMode === 'one') return currentIndex;

    if (shuffleOn) {
        if (pool.length <= 1) return repeatMode === 'off' ? -1 : videoList.indexOf(pool[0]);

        if (shuffleBag.length === 0) {
            if (shuffleCycleStarted && repeatMode === 'off') return -1;
            refillShuffleBag(pool);
            shuffleCycleStarted = true;
        }

        const nextId = shuffleBag.pop();
        const idx = videoList.indexOf(nextId);
        if (idx === -1) return decideNextIndex(); // el track ya no existe, probamos con el siguiente
        return idx;
    }

    const currentId = videoList[currentIndex];
    const poolIndex = pool.indexOf(currentId);
    // Si el tema actual no está en el pool (ej: se activó el filtro a mitad de un track no favorito), arrancamos desde el principio del pool.
    const nextPoolIndex = poolIndex === -1 ? 0 : poolIndex + 1;

    if (nextPoolIndex < pool.length) {
        return videoList.indexOf(pool[nextPoolIndex]);
    }
    return repeatMode === 'all' ? videoList.indexOf(pool[0]) : -1;
}

// Envuelve decideNextIndex() en una caché: shuffle "consume" de la bolsa
// cada vez que se llama, así que decidimos una sola vez por ciclo y
// reusamos el resultado para precarga, vista previa y el crossfade real.
function getUpcomingIndex() {
    if (nextIndexCache === null) {
        nextIndexCache = decideNextIndex();
    }
    return nextIndexCache;
}

// --- Feature 23: precarga silenciosa del próximo tema ---
function preloadNextTrack(nextIndex) {
    if (nextIndex === -1) return;
    const nextId = videoList[nextIndex];
    if (preloadedTrackId === nextId) return; // ya está precargado

    const idleLabel = activePlayer === 'A' ? 'B' : 'A';
    const idlePlayer = idleLabel === 'A' ? playerA : playerB;

    if (idlePlayer && typeof idlePlayer.cueVideoById === 'function') {
        try {
            idlePlayer.cueVideoById(nextId);
            idlePlayer.setVolume(0);
            preloadedTrackId = nextId;
            pendingIdByPlayer[idleLabel] = nextId;
        } catch (e) {
            preloadedTrackId = null;
        }
    }
}

// --- Feature 24: vista previa del próximo tema (nombre + miniatura) ---
function updateNextTrackPreview(nextIndex) {
    const el = document.getElementById('next-track-preview');
    const thumb = document.getElementById('next-track-thumb');
    const titleEl = document.getElementById('next-track-title');
    if (!el || !thumb || !titleEl) return;

    if (nextIndex === -1) {
        el.classList.remove('active');
        return;
    }

    const nextId = videoList[nextIndex];
    thumb.src = `https://img.youtube.com/vi/${nextId}/mqdefault.jpg`;
    titleEl.textContent = videoTitles[nextId] || `Track ${nextIndex + 1}`;
    el.classList.add('active');
}

function hideNextTrackPreview() {
    const el = document.getElementById('next-track-preview');
    if (el) el.classList.remove('active');
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
    syncVolumeUI();

    if (!container) return;

    // Feature 40: no perder la posición de scroll al reordenar/refrescar/actualizar favoritos
    const previousScrollTop = container.scrollTop;

    container.innerHTML = '';

    let draggedIndex = null;
    const filtroActivo = mostrarSoloFavoritos;
    let visibleCount = 0;

    videoList.forEach((id, index) => {
        if (filtroActivo && !favoritos[id]) return;
        visibleCount++;

        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}${brokenTrackIds.has(id) ? ' broken-track' : ''}`;
        item.draggable = !filtroActivo;
        item.dataset.index = index;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'playlist-item-title';
        const title = videoTitles[id] || `Track ${index + 1}`;
        titleSpan.textContent = `${index + 1}. ${title}${brokenTrackIds.has(id) ? ' ⚠️' : ''}`;

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
            saltarATrack(index);
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
                nextIndexCache = null;
                preloadedTrackId = null;
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

    container.scrollTop = previousScrollTop;
}

function onYouTubeIframeAPIReady() {
    setupEvents();
    renderPlaylist();

    updateStatus("Cargando reproductor...");

    const origin = window.location.origin;
    pendingIdByPlayer.A = videoList[0];

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
                e.target.setVolume(masterVolume);
                e.target.playVideo();
                startPlaybackMonitor();
                const initialTitle = videoTitles[videoList[0]] || 'Track 1';
                updateStatus(`▶ Sonando: <strong>${initialTitle}</strong>`);
                notifyTrackIfNeeded(initialTitle);
            },
            'onError': (e) => handlePlayerError('A', e.data)
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
            'onError': (e) => handlePlayerError('B', e.data)
        }
    });
}

// --- Feature 28: detectar links rotos y saltarlos automáticamente ---
function handlePlayerError(playerLabel, errorCode) {
    const videoId = pendingIdByPlayer[playerLabel];
    if (!videoId) return;

    const errorMessages = {
        2: 'ID de video inválido',
        5: 'Error de reproducción',
        100: 'video no encontrado o eliminado',
        101: 'el dueño no permite reproducirlo embebido',
        150: 'el dueño no permite reproducirlo embebido'
    };
    const reason = errorMessages[errorCode] || 'error desconocido';

    brokenTrackIds.add(videoId);
    const brokenIndex = videoList.indexOf(videoId);
    const brokenTitle = videoTitles[videoId] || (brokenIndex !== -1 ? `Track ${brokenIndex + 1}` : 'este tema');

    console.error(`Playlist Builder: no se pudo reproducir "${brokenTitle}" (${videoId}) — ${reason}`);
    renderPlaylist();

    // Solo saltamos automáticamente si el error ocurrió en el reproductor
    // que está activo en este momento (si fue el de precarga, ya lo
    // resolvemos de nuevo al llegar el turno real del crossfade).
    if (playerLabel !== activePlayer) return;

    updateStatus(`⚠️ No se pudo reproducir "<strong>${brokenTitle}</strong>" (${reason}). Saltando al siguiente...`);

    nextIndexCache = null;
    const nextIndex = decideNextIndex();

    if (nextIndex === -1) {
        updateStatus('⚠️ No se pudo reproducir el tema y no hay más para seguir.');
        return;
    }

    const nextId = videoList[nextIndex];
    if (brokenTrackIds.has(nextId) && brokenTrackIds.size >= videoList.length) {
        updateStatus('⚠️ Ningún tema de esta playlist se pudo reproducir. Revisá los marcadores.');
        return;
    }

    setTimeout(() => saltarATrack(nextIndex), 1200);
}


function startPlaybackMonitor() {
    if (checkInterval) clearInterval(checkInterval);

    checkInterval = setInterval(() => {
        const currentPlayer = activePlayer === 'A' ? playerA : playerB;
        if (!currentPlayer || typeof currentPlayer.getCurrentTime !== 'function' || typeof currentPlayer.getDuration !== 'function') return;

        const currentTime = currentPlayer.getCurrentTime();
        const duration = currentPlayer.getDuration();

        if (duration > 0 && !isCrossfading) {
            const timeLeft = duration - currentTime;

            if (timeLeft <= crossfadeSec) {
                hideCrossfadeCountdown();
                hideNextTrackPreview();
                const nextIndex = getUpcomingIndex();
                nextIndexCache = null; // se reinicia para el próximo ciclo
                if (nextIndex !== -1) {
                    startCrossfade(nextIndex);
                }
            } else if (timeLeft <= crossfadeSec + CROSSFADE_PREVIEW_LEAD) {
                showCrossfadeCountdown(Math.ceil(timeLeft - crossfadeSec));
                const nextIndex = getUpcomingIndex();
                updateNextTrackPreview(nextIndex);
                preloadNextTrack(nextIndex);
            } else {
                hideCrossfadeCountdown();
                hideNextTrackPreview();
            }
        }
    }, 1000);
}

function startCrossfade(nextIndex) {
    isCrossfading = true;

    const fadeOutPlayer = activePlayer === 'A' ? playerA : playerB;
    const fadeInPlayer = activePlayer === 'A' ? playerB : playerA;
    const fadeInLabel = activePlayer === 'A' ? 'B' : 'A';

    const fadeOutDiv = document.getElementById(activePlayer === 'A' ? 'playerA' : 'playerB');
    const fadeInDiv = document.getElementById(activePlayer === 'A' ? 'playerB' : 'playerA');

    const currentTitle = videoTitles[videoList[currentIndex]] || `Track ${currentIndex + 1}`;
    const nextTitle = videoTitles[videoList[nextIndex]] || `Track ${nextIndex + 1}`;
    const nextId = videoList[nextIndex];

    // Actualización de estado en tiempo real para indicar salida y entrada
    updateStatus(`
        <span class="cf-outgoing">🔻 Saliendo: <strong>${currentTitle}</strong></span>
        <span style="margin: 0 8px; opacity: 0.4;">|</span>
        <span class="cf-incoming">🔺 Entrando: <strong>${nextTitle}</strong></span>
    `);

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
        pendingIdByPlayer[fadeInLabel] = nextId;

        // Feature 23: si ya lo precargamos (cueVideoById), evitamos volver a
        // pedirlo — arranca más rápido y sin el pequeño salto de carga.
        if (preloadedTrackId === nextId) {
            fadeInPlayer.playVideo();
        } else {
            fadeInPlayer.loadVideoById(nextId);
            fadeInPlayer.playVideo();
        }
        preloadedTrackId = null;
    }

    const durationMs = crossfadeSec * 1000;
    const intervalMs = 50;
    const totalSteps = durationMs / intervalMs;
    let currentStep = 0;

    let fadeInterval = setInterval(() => {
        currentStep++;
        let progress = currentStep / totalSteps;

        if (progress >= 1) {
            clearInterval(fadeInterval);
            if (fadeOutPlayer && typeof fadeOutPlayer.stopVideo === 'function') fadeOutPlayer.stopVideo();
            activePlayer = activePlayer === 'A' ? 'B' : 'A';
            currentIndex = nextIndex;
            isCrossfading = false;

            // Ocultar animación de vinilos al finalizar la transición
            if (vinylContainer) {
                vinylContainer.classList.remove('active');
            }

            renderPlaylist();
            const newTitle = videoTitles[videoList[currentIndex]] || `Track ${currentIndex + 1}`;
            updateStatus(`▶ Sonando: <strong>${newTitle}</strong>`);
            notifyTrackIfNeeded(newTitle);
        } else {
            if (fadeOutPlayer && typeof fadeOutPlayer.setVolume === 'function') fadeOutPlayer.setVolume(Math.round((1 - progress) * masterVolume));
            if (fadeInPlayer && typeof fadeInPlayer.setVolume === 'function') fadeInPlayer.setVolume(Math.round(progress * masterVolume));
        }
    }, intervalMs);
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
