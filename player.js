let videoList = [];
let videoTitles = {};
let crossfadeSec = 10;
let currentIndex = 0;

let playerA, playerB;
let activePlayer = 'A';
let isCrossfading = false;
let checkInterval = null;

// Función robusta para extraer los parámetros de la URL en cualquier momento
function parseUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const videosParam = urlParams.get('videos');
    const fadeParam = urlParams.get('crossfade');

    if (videosParam) {
        videoList = videosParam.split(',').map(id => id.trim()).filter(id => id.length > 0);
    }
    if (fadeParam) {
        crossfadeSec = parseInt(fadeParam, 10) || 10;
    }
}

// Ejecutar inmediatamente
parseUrlParams();

function updateStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
}

function renderPlaylist() {
    // Vuelve a asegurar la lectura por si la URL tardó un instante en asentarse
    if (videoList.length === 0) {
        parseUrlParams();
    }

    let playlistEl = document.getElementById('playlist-container') || document.querySelector('.playlist-container');
    let countEl = document.getElementById('playlist-count') || document.querySelector('#playlist-btn, [id*="playlist"]');

    if (!playlistEl) {
        playlistEl = document.createElement('div');
        playlistEl.id = 'playlist-container';
        playlistEl.style.position = 'fixed';
        playlistEl.style.bottom = '20px';
        playlistEl.style.right = '20px';
        playlistEl.style.maxHeight = '300px';
        playlistEl.style.overflowY = 'auto';
        playlistEl.style.background = 'rgba(0,0,0,0.9)';
        playlistEl.style.padding = '12px';
        playlistEl.style.borderRadius = '8px';
        playlistEl.style.zIndex = '99999';
        playlistEl.style.width = '260px';
        playlistEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
        document.body.appendChild(playlistEl);
    }

    if (countEl) {
        countEl.textContent = `Playlist (${videoList.length})`;
    } else {
        const btnPlaylist = document.querySelector('button, [id*="Playlist"]');
        if (btnPlaylist) btnPlaylist.textContent = `≡ Playlist (${videoList.length})`;
    }
    
    playlistEl.innerHTML = '';
    
    if (videoList.length === 0) {
        playlistEl.innerHTML = '<div style="color: #ff2a00; font-size: 12px; text-align: center; padding: 10px; font-weight: bold;">Sin videos en la URL</div>';
        return;
    }

    videoList.forEach((id, index) => {
        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
        item.style.padding = '8px 10px';
        item.style.margin = '4px 0';
        item.style.background = index === currentIndex ? '#ff2a00' : '#222';
        item.style.color = '#fff';
        item.style.borderRadius = '4px';
        item.style.fontSize = '12px';
        item.style.cursor = 'pointer';
        item.textContent = videoTitles[id] || `Track ${index + 1}`;
        
        item.addEventListener('click', () => {
            currentIndex = index;
            if (playerA && playerA.loadVideoById) {
                playerA.loadVideoById(videoList[currentIndex]);
                playerA.playVideo();
                activePlayer = 'A';
                renderPlaylist();
                updateStatus(`Sonando: Track ${currentIndex + 1}`);
            }
        });

        playlistEl.appendChild(item);
    });
}

// Inicializar YouTube IFrame API
function onYouTubeIframeAPIReady() {
    parseUrlParams();

    if (videoList.length === 0) {
        updateStatus("Esperando videos de la extensión...");
        renderPlaylist();
        // Reintentar cada segundo por si la URL tardó en llegar
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
        fadeOutDiv.style.opacity = '0';
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
