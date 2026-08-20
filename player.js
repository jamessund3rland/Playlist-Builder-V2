// ==========================================
// REPRODUCTOR DE PLAYLIST Y CONTROL DE CROSSFADE
// ==========================================

// Configuración general
const CROSSFADE_DURATION = 10; // Duración en segundos
let fadeTimeout = null;

// PLAYLIST: Agrega o edita tus IDs y títulos de YouTube aquí
let playlist = [
    { id: 'jfKfPfyJRdk', title: 'Lofi Hip Hop Radio - Beats to Relax/Study to' },
    { id: '5qap5aO4i9A', title: 'Lofi Girl - Sleep Radio' },
    { id: 'DWcU18jY44e', title: 'Relaxing Ambient Music' }
];

let currentIndex = 0;
let dragSrcIndex = null;

// Reproductores de YouTube
let playerA = null;
let playerB = null;
let activePlayer = 'A'; // 'A' o 'B'
let isCrossfading = false;
let checkInterval = null;

// Función para acortar texto a 40 caracteres con "..."
function acortarTexto(texto, max = 40) {
    if (!texto) return '';
    return texto.length > max ? texto.substring(0, max) + '...' : texto;
}

// Control del estado del reproductor, textos y vinilos (FadeOut unificado)
function actualizarEstado(trackSaliendo, trackEntrando, estaEnCrossfade = false) {
    const topStatusBar = document.getElementById('top-status-bar');
    const statusElem = document.getElementById('status');
    const vinylContainer = document.getElementById('vinyl-container');

    if (!statusElem || !topStatusBar) return;

    if (fadeTimeout) {
        clearTimeout(fadeTimeout);
        fadeTimeout = null;
    }

    if (estaEnCrossfade && trackSaliendo && trackEntrando) {
        // 1. Asegurar que esté visible al arrancar el crossfade
        topStatusBar.classList.remove('fade-out');

        const saliendoTxt = acortarTexto(trackSaliendo.title || trackSaliendo.id || trackSaliendo, 40);
        const entrandoTxt = acortarTexto(trackEntrando.title || trackEntrando.id || trackEntrando, 40);

        statusElem.innerHTML = `
            <div class="status-section cf-outgoing">▼ Saliendo: ${saliendoTxt}</div>
            <div class="status-section cf-incoming">▲ Entrando: ${entrandoTxt}</div>
        `;

        if (vinylContainer) {
            vinylContainer.classList.add('active');
        }

        // 2. Desvanecer TODO (cartel + discos) 1.2 segundos antes de terminar
        const tiempoOcultar = Math.max(0, (CROSSFADE_DURATION - 1.2) * 1000);
        fadeTimeout = setTimeout(() => {
            topStatusBar.classList.add('fade-out');
        }, tiempoOcultar);

    } else if (trackEntrando) {
        // 3. Cuando termina el crossfade, aseguramos el fade out
        topStatusBar.classList.add('fade-out');

        // 4. Esperamos 800ms a que esté 100% invisible para cambiar a "Sonando" sin saltos
        setTimeout(() => {
            if (vinylContainer) {
                vinylContainer.classList.remove('active');
            }

            const actualTxt = acortarTexto(trackEntrando.title || trackEntrando.id || trackEntrando, 40);
            statusElem.innerHTML = `<div class="status-section">▶ Sonando: ${actualTxt}</div>`;

            // Volvemos a mostrar la barra suavemente
            topStatusBar.classList.remove('fade-out');
        }, 800);
    }
}

// ==========================================
// RENDER DE PLAYLIST Y DRAG & DROP (LÍNEA ROJA)
// ==========================================

function renderPlaylist() {
    const container = document.getElementById('playlist-items');
    const btn = document.getElementById('playlist-btn');
    if (!container) return;

    container.innerHTML = '';
    if (btn) btn.innerText = `≡ Playlist (${playlist.length})`;

    playlist.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
        item.draggable = true;
        item.dataset.index = index;
        item.innerText = `${index + 1}. ${acortarTexto(track.title || track.id || 'Track', 35)}`;

        // Evento de clic para saltar directo a una canción
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('dragging')) return;
            if (index !== currentIndex) {
                reproducirPistaDirecta(index);
            }
        });

        // Eventos Drag & Drop
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);

        container.appendChild(item);
    });
}

// MANEJADORES DE ARRASTRE Y LÍNEA ROJA GUÍA
function handleDragStart(e) {
    dragSrcIndex = parseInt(this.dataset.index, 10);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    document.querySelectorAll('.playlist-item').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    const targetIndex = parseInt(this.dataset.index, 10);
    if (dragSrcIndex === targetIndex) return;

    const rect = this.getBoundingClientRect();
    const offset = e.clientY - rect.top;

    if (offset < rect.height / 2) {
        this.classList.add('drag-over-top');
    } else {
        this.classList.add('drag-over-bottom');
    }
}

function handleDragLeave() {
    this.classList.remove('drag-over-top', 'drag-over-bottom');
}

function handleDrop(e) {
    e.stopPropagation();
    e.preventDefault();

    const targetIndex = parseInt(this.dataset.index, 10);
    if (dragSrcIndex === null || dragSrcIndex === targetIndex) return;

    const rect = this.getBoundingClientRect();
    const offset = e.clientY - rect.top;
    let newIndex = offset < rect.height / 2 ? targetIndex : targetIndex + 1;

    if (dragSrcIndex < newIndex) newIndex--;

    const [movedTrack] = playlist.splice(dragSrcIndex, 1);
    playlist.splice(newIndex, 0, movedTrack);

    if (currentIndex === dragSrcIndex) {
        currentIndex = newIndex;
    } else if (dragSrcIndex < currentIndex && newIndex >= currentIndex) {
        currentIndex--;
    } else if (dragSrcIndex > currentIndex && newIndex <= currentIndex) {
        currentIndex++;
    }

    renderPlaylist();
}

function handleDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.playlist-item').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
}

// ==========================================
// LÓGICA DE REPRODUCCIÓN Y CROSSFADE (YouTube API)
// ==========================================

function initPlayers() {
    if (playlist.length === 0) return;

    playerA = new YT.Player('playerA', {
        height: '100%',
        width: '100%',
        videoId: playlist[0].id,
        playerVars: { 'autoplay': 1, 'controls': 0, 'enablejsapi': 1 },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
        }
    });

    playerB = new YT.Player('playerB', {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: { 'autoplay': 0, 'controls': 0, 'enablejsapi': 1 },
        events: {
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerReady(event) {
    event.target.playVideo();
    event.target.setVolume(100);
    actualizarEstado(null, playlist[currentIndex], false);
    renderPlaylist();
    iniciarMonitoreoTiempo();
}

function onPlayerStateChange(event) {
    // Si la canción termina manualmente o por error, pasar a la siguiente
    if (event.data === YT.PlayerState.ENDED && !isCrossfading) {
        siguientePista();
    }
}

function iniciarMonitoreoTiempo() {
    if (checkInterval) clearInterval(checkInterval);

    checkInterval = setInterval(() => {
        const curPlayer = activePlayer === 'A' ? playerA : playerB;
        if (!curPlayer || typeof curPlayer.getDuration !== 'function') return;

        const currentTime = curPlayer.getCurrentTime();
        const duration = curPlayer.getDuration();

        if (duration > 0 && (duration - currentTime) <= CROSSFADE_DURATION && !isCrossfading) {
            iniciarCrossfade();
        }
    }, 500);
}

function iniciarCrossfade() {
    if (isCrossfading || playlist.length <= 1) return;
    isCrossfading = true;

    const saliendoIndex = currentIndex;
    const entrandoIndex = (currentIndex + 1) % playlist.length;
    currentIndex = entrandoIndex;

    const curPlayer = activePlayer === 'A' ? playerA : playerB;
    const nextPlayer = activePlayer === 'A' ? playerB : playerA;

    nextPlayer.loadVideoById(playlist[entrandoIndex].id);
    nextPlayer.setVolume(0);
    nextPlayer.playVideo();

    actualizarEstado(playlist[saliendoIndex], playlist[entrandoIndex], true);
    renderPlaylist();

    let step = 0;
    const steps = 20;
    const intervalTime = (CROSSFADE_DURATION * 1000) / steps;

    const fadeInterval = setInterval(() => {
        step++;
        const volSaliendo = Math.max(0, Math.round(100 * (1 - step / steps)));
        const volEntrando = Math.min(100, Math.round(100 * (step / steps)));

        if (typeof curPlayer.setVolume === 'function') curPlayer.setVolume(volSaliendo);
        if (typeof nextPlayer.setVolume === 'function') nextPlayer.setVolume(volEntrando);

        if (step >= steps) {
            clearInterval(fadeInterval);
            curPlayer.stopVideo();
            activePlayer = activePlayer === 'A' ? 'B' : 'A';
            isCrossfading = false;
            actualizarEstado(null, playlist[currentIndex], false);
        }
    }, intervalTime);
}

function reproducirPistaDirecta(index) {
    currentIndex = index;
    const curPlayer = activePlayer === 'A' ? playerA : playerB;
    if (curPlayer && typeof curPlayer.loadVideoById === 'function') {
        curPlayer.loadVideoById(playlist[currentIndex].id);
        curPlayer.setVolume(100);
        actualizarEstado(null, playlist[currentIndex], false);
        renderPlaylist();
    }
}

function siguientePista() {
    const nextIdx = (currentIndex + 1) % playlist.length;
    reproducirPistaDirecta(nextIdx);
}

// ==========================================
// INICIALIZACIÓN Y EVENTOS DOM
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    // Abrir/cerrar panel de la playlist
    const btn = document.getElementById('playlist-btn');
    const container = document.getElementById('playlist-container');

    if (btn && container) {
        btn.addEventListener('click', () => {
            const visible = container.style.display === 'flex';
            container.style.display = visible ? 'none' : 'flex';
        });
    }

    // Botón Recargar Lista (⟳)
    const reloadBtn = document.querySelector('.reload-playlist-btn') || document.querySelector('[title="Recargar playlist"]');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
            renderPlaylist();
            console.log("Playlist re-renderizada correctamente.");
        });
    }
});

// Callback global llamado automáticamente por la API de YouTube
function onYouTubeIframeAPIReady() {
    console.log("API de YouTube lista para reproducir.");
    initPlayers();
}
