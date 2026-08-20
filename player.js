// ==========================================
// REPRODUCTOR DE PLAYLIST Y CONTROL DE CROSSFADE
// ==========================================

const CROSSFADE_DURATION = 10; // Duración en segundos
let fadeTimeout = null;

let playlist = []; // Se llena automáticamente desde Chrome Bookmarks / Storage
let currentIndex = 0;
let dragSrcIndex = null;

let playerA = null;
let playerB = null;
let activePlayer = 'A';
let isCrossfading = false;
let checkInterval = null;

// Extractor de ID de YouTube desde URLs
function obtenerYouTubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function acortarTexto(texto, max = 40) {
    if (!texto) return '';
    return texto.length > max ? texto.substring(0, max) + '...' : texto;
}

// Carga de marcadores/favoritos de Chrome
function cargarPlaylistDesdeChrome() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['youtubePlaylist', 'playlist'], (result) => {
            const listaGuardada = result.youtubePlaylist || result.playlist || [];
            if (listaGuardada.length > 0) {
                procesarLista(listaGuardada);
            } else {
                pedirMarcadoresAExtension();
            }
        });
    } else {
        pedirMarcadoresAExtension();
    }
}

function pedirMarcadoresAExtension() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'getPlaylist' }, (response) => {
            if (response && response.playlist) {
                procesarLista(response.playlist);
            }
        });
    }
}

function procesarLista(items) {
    playlist = items.map(item => {
        const id = item.id || obtenerYouTubeId(item.url);
        return {
            id: id,
            title: item.title || item.name || 'Video de YouTube',
            url: item.url || `https://www.youtube.com/watch?v=${id}`
        };
    }).filter(item => item.id);

    renderPlaylist();

    // Si los reproductores ya están listos y no hay canción sonando, arrancar
    if (playerA && playlist.length > 0 && !isCrossfading) {
        reproducirPistaDirecta(0);
    }
}

// Control del estado del reproductor, textos y vinilos
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
        topStatusBar.classList.remove('fade-out');

        const saliendoTxt = acortarTexto(trackSaliendo.title, 40);
        const entrandoTxt = acortarTexto(trackEntrando.title, 40);

        statusElem.innerHTML = `
            <div class="status-section cf-outgoing">▼ Saliendo: ${saliendoTxt}</div>
            <div class="status-section cf-incoming">▲ Entrando: ${entrandoTxt}</div>
        `;

        if (vinylContainer) vinylContainer.classList.add('active');

        const tiempoOcultar = Math.max(0, (CROSSFADE_DURATION - 1.2) * 1000);
        fadeTimeout = setTimeout(() => {
            topStatusBar.classList.add('fade-out');
        }, tiempoOcultar);

    } else if (trackEntrando) {
        topStatusBar.classList.add('fade-out');

        setTimeout(() => {
            if (vinylContainer) vinylContainer.classList.remove('active');

            const actualTxt = acortarTexto(trackEntrando.title, 40);
            statusElem.innerHTML = `<div class="status-section">▶ Sonando: ${actualTxt}</div>`;

            topStatusBar.classList.remove('fade-out');
        }, 800);
    }
}

// ==========================================
// RENDER DE PLAYLIST Y DRAG & DROP
// ==========================================

function renderPlaylist() {
    const container = document.getElementById('playlist-items');
    const btn = document.getElementById('playlist-btn');
    if (!container) return;

    container.innerHTML = '';
    if (btn) btn.innerText = `≡ Playlist (${playlist.length})`;

    if (playlist.length === 0) {
        container.innerHTML = '<div style="padding:10px; font-size:12px; color:#888;">No se encontraron links de YouTube en Favoritos.</div>';
        return;
    }

    playlist.forEach((track, index) => {
        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
        item.draggable = true;
        item.dataset.index = index;
        item.innerText = `${index + 1}. ${acortarTexto(track.title, 35)}`;

        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('dragging')) return;
            if (index !== currentIndex) {
                reproducirPistaDirecta(index);
            }
        });

        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);

        container.appendChild(item);
    });
}

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
// REPRODUCCIÓN Y CROSSFADE
// ==========================================

function initPlayers() {
    const initialId = playlist.length > 0 ? playlist[0].id : '';

    playerA = new YT.Player('playerA', {
        height: '100%',
        width: '100%',
        videoId: initialId,
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
    if (playlist.length > 0) {
        event.target.playVideo();
        event.target.setVolume(100);
        actualizarEstado(null, playlist[currentIndex], false);
    }
    iniciarMonitoreoTiempo();
}

function onPlayerStateChange(event) {
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
    if (!playlist[index]) return;
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
    if (playlist.length === 0) return;
    const nextIdx = (currentIndex + 1) % playlist.length;
    reproducirPistaDirecta(nextIdx);
}

// ==========================================
// EVENTOS DOM
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    cargarPlaylistDesdeChrome();

    const btn = document.getElementById('playlist-btn');
    const container = document.getElementById('playlist-container');

    if (btn && container) {
        btn.addEventListener('click', () => {
            const visible = container.style.display === 'flex';
            container.style.display = visible ? 'none' : 'flex';
        });
    }

    const refreshBtn = document.getElementById('refresh-playlist-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            cargarPlaylistDesdeChrome();
        });
    }
});

function onYouTubeIframeAPIReady() {
    initPlayers();
}
