let videoList = [];
let videoTitles = {};
let crossfadeSec = 10;
let currentIndex = 0;

let playerA, playerB;
let activePlayer = 'A';
let isCrossfading = false;
let checkInterval = null;

// Capturar parámetros y títulos desde la URL
function parseUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const videosParam = urlParams.get('videos');
    const titlesParam = urlParams.get('titles');
    const fadeParam = urlParams.get('crossfade');

    if (videosParam) {
        videoList = videosParam.split(',').map(id => id.trim()).filter(id => id.length > 0);
    }
    
    if (titlesParam) {
        try {
            videoTitles = JSON.parse(decodeURIComponent(titlesParam));
        } catch (e) {
            console.error("Error al decodificar títulos:", e);
        }
    }

    if (fadeParam) {
        crossfadeSec = parseInt(fadeParam, 10) || 10;
    }
}

parseUrlParams();

function updateStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
}

// Configurar comportamiento del botón original para mostrar/ocultar
function setupPlaylistToggle() {
    const playlistBtn = document.getElementById('playlist-btn') || document.querySelector('.playlist-btn') || document.querySelector('button[id*="playlist"]');
    const playlistContainer = document.getElementById('playlist-container') || document.querySelector('.playlist-container');

    if (playlistBtn && playlistContainer) {
        playlistBtn.onclick = (e) => {
            e.preventDefault();
            if (playlistContainer.style.display === 'none' || playlistContainer.style.visibility === 'hidden') {
                playlistContainer.style.display = 'block';
                playlistContainer.style.visibility = 'visible';
            } else {
                playlistContainer.style.display = 'none';
            }
        };
    }
}

function renderPlaylist() {
    if (videoList.length === 0) parseUrlParams();

    const playlistEl = document.getElementById('playlist-container') || document.querySelector('.playlist-container');
    const countEl = document.getElementById('playlist-count') || document.querySelector('#playlist-btn');
    const fadeInfoEl = document.getElementById('fade-info') || document.getElementById('crossfade-duration');

    if (countEl) {
        if (countEl.tagName === 'BUTTON' || countEl.id === 'playlist-btn') {
            countEl.innerHTML = `≡ Playlist (${videoList.length})`;
        } else {
            countEl.textContent = `Playlist (${videoList.length})`;
        }
    }

    if (fadeInfoEl) {
        fadeInfoEl.textContent = `${crossfadeSec}s`;
    }

    if (!playlistEl) return;
    
    playlistEl.innerHTML = '';
    
    videoList.forEach((id, index) => {
        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
        item.style.cursor = 'pointer';
        
        // Mostrar el título real del marcador obtenido de YouTube
        const titleText = videoTitles[id] || `Track ${index + 1}`;
        item.textContent = titleText;
        
        item.addEventListener('click', () => {
            currentIndex = index;
            if (playerA && playerA.loadVideoById) {
                playerA.loadVideoById(videoList[currentIndex]);
                playerA.playVideo();
                activePlayer = 'A';
                renderPlaylist();
                updateStatus(`Sonando: ${titleText}`);
            }
        });

        playlistEl.appendChild(item);
    });

    setupPlaylistToggle();
}

// Inicializar YouTube IFrame API
function onYouTubeIframeAPIReady() {
    parseUrlParams();

    if (videoList.length === 0) {
        updateStatus("Esperando videos...");
        renderPlaylist();
        const waitInterval = setInterval(() => {
            parseUrlParams();
            if (videoList.length > 0) {
                clearInterval(waitInterval);
                onYouTubeIframeAPIReady();
            }
        }, 1000);
        return;
    }

    updateStatus("Cargando reproductor...");
    renderPlaylist();

    playerA = new YT.Player('playerA', {
        height: '100%',
        width: '100%',
        videoId: videoList[0],
        playerVars: { 'autoplay': 1, 'controls': 0, 'rel': 0, 'iv_load_policy': 3 },
        events: {
            'onReady': (e) => {
                e.target.setVolume(100);
                e.target.playVideo();
                startPlaybackMonitor();
                renderPlaylist();
                updateStatus(`Sonando: ${videoTitles[videoList[0]] || 'Track 1'}`);
            }
        }
    });

    playerB = new YT.Player('playerB', {
        height: '100%',
        width: '100%',
        playerVars: { 'autoplay': 0, 'controls': 0, 'rel': 0, 'iv_load_policy': 3 }
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

// CROSSFADE SUAVE
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
        fadeInDiv.style.opacity = '0';
    }

    if (fadeInPlayer && fadeInPlayer.loadVideoById) {
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
            if (fadeOutPlayer && fadeOutPlayer.stopVideo) fadeOutPlayer.stopVideo();
            activePlayer = activePlayer === 'A' ? 'B' : 'A';
            currentIndex = nextIndex;
            isCrossfading = false;
            renderPlaylist();
            updateStatus(`Sonando: ${videoTitles[videoList[currentIndex]] || `Track ${currentIndex + 1}`}`);
        } else {
            if (fadeOutPlayer && fadeOutPlayer.setVolume) {
                fadeOutPlayer.setVolume(Math.round((1 - progress) * 100));
            }
            if (fadeInPlayer && fadeInPlayer.setVolume) {
                fadeInPlayer.setVolume(Math.round(progress * 100));
            }
        }
    }, intervalMs);
}
