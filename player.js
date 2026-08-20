// ==========================================
// REPRODUCTOR DE PLAYLIST Y CONTROL DE CROSSFADE
// ==========================================

// Configuración general
const CROSSFADE_DURATION = 10; // Duración en segundos
let fadeTimeout = null;
let playlist = []; // Lista de canciones
let currentIndex = 0;
let dragSrcIndex = null;

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

        const saliendoTxt = acortarTexto(trackSaliendo.title || trackSaliendo, 40);
        const entrandoTxt = acortarTexto(trackEntrando.title || trackEntrando, 40);

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

            const actualTxt = acortarTexto(trackEntrando.title || trackEntrando, 40);
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
    
    // Limpia líneas rojas anteriores usando clases CSS
    document.querySelectorAll('.playlist-item').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    const targetIndex = parseInt(this.dataset.index, 10);
    if (dragSrcIndex === targetIndex) return;

    // Calcular si la línea roja va arriba o abajo del elemento
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

    // Reordenar la lista
    const [movedTrack] = playlist.splice(dragSrcIndex, 1);
    playlist.splice(newIndex, 0, movedTrack);

    // Ajustar el puntero de la canción que está sonando
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

// Abrir/cerrar panel de la playlist
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('playlist-btn');
    const container = document.getElementById('playlist-container');

    if (btn && container) {
        btn.addEventListener('click', () => {
            const visible = container.style.display === 'flex';
            container.style.display = visible ? 'none' : 'flex';
        });
    }
});

// Inicialización cuando carga la API de YouTube
function onYouTubeIframeAPIReady() {
    console.log("API de YouTube lista para reproducir.");
}
