let videoList = [];
let videoTitles = {};
let crossfadeSec = 10;
let currentIndex = 0;

let playerA, playerB;
let activePlayer = 'A';
let isCrossfading = false;
let checkInterval = null;

// Obtener parámetros URL
const urlParams = new URLSearchParams(window.location.search);
const videosParam = urlParams.get('videos');
const titlesParam = urlParams.get('titles');
const fadeParam = urlParams.get('crossfade');

if (videosParam) {
    videoList = videosParam.split(',').map(id => id.trim()).filter(id => id.length > 0);
}
if (fadeParam) {
    crossfadeSec = parseInt(fadeParam, 10) || 10;
}

// Inicializar títulos desde marcadores si existen
if (titlesParam) {
    try {
        const parsedTitles = JSON.parse(decodeURIComponent(titlesParam));
        videoList.forEach((id, index) => {
            if (parsedTitles[index]) videoTitles[id] = parsedTitles[index];
        });
    } catch (e) {
        console.warn("No se pudieron parsear los títulos:", e);
    }
}

const fadeInfoEl = document.getElementById('fade-info');
if (fadeInfoEl) fadeInfoEl.textContent = `Crossfade: ${crossfadeSec}s`;

function updateStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
}

// Obtener título real vía noembed si no está definido
function fetchVideoTitle(id) {
    if (videoTitles[id] && !videoTitles[id].startsWith('Video ID:')) return;

    fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${id}`)
        .then(res => res.json())
        .then(data => {
            if (data && data.title) {
                videoTitles[id] = data.title;
                renderPlaylist();
            }
        })
        .catch(() => {
            if (!videoTitles[id]) videoTitles[id] = `Video ID: ${id}`;
        });
}

// Renderizar la lista e integrar Drag & Drop
function renderPlaylist() {
    const container = document.getElementById('playlist-items');
    const badge = document.getElementById('count-badge');
    if (badge) badge.textContent = videoList.length;
    if (!container) return;

    container.innerHTML = '';

    videoList.forEach((id, index) => {
        if (!videoTitles[id]) fetchVideoTitle(id);

        const titleText = videoTitles[id] || `Cargando título (${id})...`;
        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
        item.draggable = true;
        item.dataset.index = index;

        item.innerHTML = `
            <span class="drag-handle">⋮⋮</span>
            <span class="item-number">${index + 1}</span>
            <span class="item-title" title="${titleText}">${titleText}</span>
        `;

        // Click para reproducir
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('drag-handle')) return;
            playVideoAtIndex(index);
        });

        // Eventos Drag & Drop
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);

        container.appendChild(item);
    });
}

// Lógica de Reordenamiento (Drag & Drop)
let draggedIndex = null;

function handleDragStart(e) {
    draggedIndex = parseInt(this.dataset.index, 10);
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    const targetIndex = parseInt(this.dataset.index, 10);

    if (draggedIndex !== null && draggedIndex !== targetIndex) {
        // Guardar el id sonando actualmente
        const currentPlayingId = videoList[currentIndex];

        // Mover elemento en el array
        const movedItem = videoList.splice(draggedIndex, 1)[0];
        videoList.splice(targetIndex, 0, movedItem);

        // Actualizar el índice del video en reproducción
        currentIndex = videoList.indexOf(currentPlayingId);

        renderPlaylist();
    }
}

function handleDragEnd() {
    this.classList.remove('dragging');
    draggedIndex = null;
}

const toggleBtn = document.getElementById('toggle-playlist-btn');
if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
        const panel = document.getElementById('playlist-panel');
        if (panel) panel.classList.toggle('open');
    });
}

function onYouTubeIframeAPIReady() {
    if (!videoList || videoList.length === 0) {
        updateStatus("Error: No se recibieron videos.");
        return;
    }

    renderPlaylist();
    updateStatus(`Cargando ${videoList.length} videos...`);

    let readyCount = 0;
    function checkReady() {
        readyCount++;
        if (readyCount === 2) {
            playVideoAtIndex(0);
        }
    }

    playerA = new YT.Player('playerA', {
        height: '100%', width: '100%',
        videoId: videoList[0],
        playerVars: { 'autoplay': 1, 'controls': 1, 'rel': 0, 'playsinline': 1 },
        events: { 'onReady': checkReady, 'onStateChange': onStateChangeA }
    });

    const secondVideo = videoList.length > 1 ? videoList[1] : videoList[0];

    playerB = new YT.Player('playerB', {
        height: '100%', width: '100%',
        videoId: secondVideo,
        playerVars: { 'autoplay': 0, 'controls': 1, 'rel': 0, 'playsinline': 1 },
        events: { 'onReady': checkReady, 'onStateChange': onStateChangeB }
    });
}

function playVideoAtIndex(index) {
    if (index >= videoList.length) return;

    currentIndex = index;
    isCrossfading = false;
    renderPlaylist();

    const currPlayer = activePlayer === 'A' ? playerA : playerB;
    const currDiv = document.getElementById(activePlayer === 'A' ? 'playerA' : 'playerB');
    const nextDiv = document.getElementById(activePlayer === 'A' ? 'playerB' : 'playerA');

    if (currDiv && nextDiv) {
        currDiv.style.opacity = '1';
        currDiv.style.zIndex = '2';
        nextDiv.style.opacity = '0';
        nextDiv.style.zIndex = '1';
    }

    if (currPlayer && currPlayer.loadVideoById) {
        currPlayer.setVolume(100);
        currPlayer.loadVideoById(videoList[currentIndex]);
        currPlayer.playVideo();
    }

    const currentTitle = videoTitles[videoList[currentIndex]] || `Track ${currentIndex + 1}`;
    updateStatus(`Sonando: ${currentTitle}`);

    if (checkInterval) clearInterval(checkInterval);
    checkInterval = setInterval(checkTimeAndCrossfade, 500);
}

function checkTimeAndCrossfade() {
    if (isCrossfading) return;

    const currPlayer = activePlayer === 'A' ? playerA : playerB;

    if (currPlayer && currPlayer.getDuration && currPlayer.getCurrentTime) {
        const duration = currPlayer.getDuration();
        const currentTime = currPlayer.getCurrentTime();
        const timeLeft = duration - currentTime;

        if (duration > 0 && timeLeft <= crossfadeSec && currentIndex + 1 < videoList.length) {
            startCrossfade();
        }
    }
}

function startCrossfade() {
    isCrossfading = true;
    const nextIndex = currentIndex + 1;

    const fadeOutPlayer = activePlayer === 'A' ? playerA : playerB;
    const fadeInPlayer = activePlayer === 'A' ? playerB : playerA;

    const fadeOutDiv = document.getElementById(activePlayer === 'A' ? 'playerA' : 'playerB');
    const fadeInDiv = document.getElementById(activePlayer === 'A' ? 'playerB' : 'playerA');

    const nextTitle = videoTitles[videoList[nextIndex]] || `Track ${nextIndex + 1}`;
    updateStatus(`Crossfade hacia: ${nextTitle}...`);

    if (fadeOutDiv && fadeInDiv) {
        fadeInDiv.style.zIndex = '2';
        fadeOutDiv.style.zIndex = '1';
        fadeInDiv.style.opacity = '1';
        fadeOutDiv.style.opacity = '0';
    }

    if (fadeInPlayer && fadeInPlayer.loadVideoById) {
        fadeInPlayer.setVolume(0);
        fadeInPlayer.loadVideoById(videoList[nextIndex]);
        fadeInPlayer.playVideo();
    }

    let steps = crossfadeSec * 10;
    let currentStep = 0;

    let fadeInterval = setInterval(() => {
        currentStep++;
        let progress = currentStep / steps;

        if (progress >= 1) {
            clearInterval(fadeInterval);
            if (fadeOutPlayer && fadeOutPlayer.stopVideo) fadeOutPlayer.stopVideo();
            activePlayer = activePlayer === 'A' ? 'B' : 'A';
            currentIndex = nextIndex;
            isCrossfading = false;
            renderPlaylist();
            updateStatus(`Sonando: ${videoTitles[videoList[currentIndex]] || `Track ${currentIndex + 1}`}`);
        } else {
            if (fadeOutPlayer && fadeOutPlayer.setVolume) fadeOutPlayer.setVolume(Math.round((1 - progress) * 100));
            if (fadeInPlayer && fadeInPlayer.setVolume) fadeInPlayer.setVolume(Math.round(progress * 100));
        }
    }, 100);
}

function onStateChangeA(event) {
    if (event.data === YT.PlayerState.ENDED && activePlayer === 'A' && !isCrossfading) {
        playVideoAtIndex(currentIndex + 1);
    }
}

function onStateChangeB(event) {
    if (event.data === YT.PlayerState.ENDED && activePlayer === 'B' && !isCrossfading) {
        playVideoAtIndex(currentIndex + 1);
    }
}
