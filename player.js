let videoList = [];
let videoTitles = {};
let crossfadeSec = 10;
let currentIndex = 0;

let playerA, playerB;
let activePlayer = 'A';
let isCrossfading = false;
let checkInterval = null;

// Parseo de parámetros URL
const urlParams = new URLSearchParams(window.location.search);
const videosParam = urlParams.get('videos');
const titlesParam = urlParams.get('titles');
const fadeParam = urlParams.get('crossfade');
const extIdParam = urlParams.get('extId');
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
}

function updateStatus(content) {
    const el = document.getElementById('status');
    if (el) el.innerHTML = content;
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
}

// Vuelve a leer la carpeta de marcadores y agrega los temas nuevos
// que se hayan sumado, sin reiniciar la playlist ni el reproductor.
function recargarPlaylistDesdeMarcadores() {
    const refreshBtn = document.getElementById('refresh-playlist-btn');
    if (refreshBtn) refreshBtn.classList.add('spinning');

    const finish = () => {
        if (refreshBtn) setTimeout(() => refreshBtn.classList.remove('spinning'), 400);
    };

    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage || !extIdParam) {
        updateStatus('⚠️ No se pudo conectar con la extensión para actualizar.');
        finish();
        return;
    }

    chrome.runtime.sendMessage(extIdParam, { type: 'RELOAD_BOOKMARKS', folderId: folderIdParam }, (response) => {
        finish();

        if (chrome.runtime.lastError || !response || response.error) {
            updateStatus('⚠️ No se pudo actualizar la playlist (¿está la extensión activa?).');
            return;
        }

        aplicarActualizacionDeMarcadores(response.videos || [], response.titles || {});
    });
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

    currentIndex = videoList.indexOf(currentTrackId);
    if (currentIndex === -1) currentIndex = 0;

    renderPlaylist();

    if (added.length > 0) {
        updateStatus(`✅ ${added.length} tema${added.length > 1 ? 's' : ''} nuevo${added.length > 1 ? 's' : ''} agregado${added.length > 1 ? 's' : ''} a la playlist`);
    } else {
        updateStatus('Playlist actualizada — sin cambios');
    }
}

function clearIndicators() {
    document.querySelectorAll('.playlist-item').forEach(el => {
        el.classList.remove('drop-indicator-above', 'drop-indicator-below');
    });
}

function renderPlaylist() {
    const container = document.getElementById('playlist-items');
    const btn = document.getElementById('playlist-btn');
    const fadeInfo = document.getElementById('fade-info');

    if (btn) btn.textContent = `≡ Playlist (${videoList.length})`;
    if (fadeInfo) fadeInfo.textContent = `${crossfadeSec}s`;

    if (!container) return;
    container.innerHTML = '';

    let draggedIndex = null;

    videoList.forEach((id, index) => {
        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
        item.textContent = `${index + 1}. ${videoTitles[id] || `Track ${index + 1}`}`;
        item.draggable = true;
        item.dataset.index = index;

        item.onclick = (e) => {
            if (item.classList.contains('dragging')) return;
            currentIndex = index;
            const targetPlayer = activePlayer === 'A' ? playerA : playerB;
            if (targetPlayer && typeof targetPlayer.loadVideoById === 'function') {
                targetPlayer.loadVideoById(videoList[currentIndex]);
                targetPlayer.playVideo();
                renderPlaylist();
                updateStatus(`▶ Sonando: <strong>${videoTitles[id] || `Track ${index + 1}`}</strong>`);
            }
        };

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
            renderPlaylist();
        });

        container.appendChild(item);
    });
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
                updateStatus(`▶ Sonando: <strong>${videoTitles[videoList[0]] || 'Track 1'}</strong>`);
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
            if (timeLeft <= crossfadeSec && currentIndex < videoList.length - 1) {
                startCrossfade();
            }
        }
    }, 1000);
}

function startCrossfade() {
    isCrossfading = true;
    const nextIndex = currentIndex + 1;

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
            updateStatus(`▶ Sonando: <strong>${videoTitles[videoList[currentIndex]] || `Track ${currentIndex + 1}`}</strong>`);
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
