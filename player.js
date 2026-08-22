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
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
        item.draggable = !filtroActivo;
        item.dataset.index = index;

        const titleSpan = document.createElement('span');
        titleSpan.className = 'playlist-item-title';
        const title = videoTitles[id] || `Track ${index + 1}`;
        titleSpan.textContent = `${index + 1}. ${title}`;

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
            const targetPlayer = activePlayer === 'A' ? playerA : playerB;
            if (targetPlayer && typeof targetPlayer.loadVideoById === 'function') {
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

function onYouTubeIframeAPIReady() {
    setupEvents();
    renderPlaylist();

    updateStatus("Cargando reproductor...");

    const origin = window.location.origin;

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
            'onError': (e) => {
                console.error("Error en Player A:", e.data);
                updateStatus("Error al cargar video de YouTube");
            }
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
        }
    });
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
                const nextIndex = decideNextIndex();
                if (nextIndex !== -1) {
                    startCrossfade(nextIndex);
                }
            } else if (timeLeft <= crossfadeSec + CROSSFADE_PREVIEW_LEAD) {
                showCrossfadeCountdown(Math.ceil(timeLeft - crossfadeSec));
            } else {
                hideCrossfadeCountdown();
            }
        }
    }, 1000);
}

function startCrossfade(nextIndex) {
    isCrossfading = true;

    const fadeOutPlayer = activePlayer === 'A' ? playerA : playerB;
    const fadeInPlayer = activePlayer === 'A' ? playerB : playerA;

    const fadeOutDiv = document.getElementById(activePlayer === 'A' ? 'playerA' : 'playerB');
    const fadeInDiv = document.getElementById(activePlayer === 'A' ? 'playerB' : 'playerA');

    const currentTitle = videoTitles[videoList[currentIndex]] || `Track ${currentIndex + 1}`;
    const nextTitle = videoTitles[videoList[nextIndex]] || `Track ${nextIndex + 1}`;

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
        fadeInPlayer.loadVideoById(videoList[nextIndex]);
        fadeInPlayer.playVideo();
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
            if (fadeOutPlayer && typeof fadeOutPlayer.setVolume === 'function') fadeOutPlayer.setVolume(Math.round((1 - progress) * 100));
            if (fadeInPlayer && typeof fadeInPlayer.setVolume === 'function') fadeInPlayer.setVolume(Math.round(progress * 100));
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
