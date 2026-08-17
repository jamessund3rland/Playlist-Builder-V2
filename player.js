let videoList = [];
let videoTitles = {};
let crossfadeSec = 10;
let currentIndex = 0;

let playerA, playerB;
let activePlayer = 'A';
let isCrossfading = false;
let checkInterval = null;

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
        console.error("Error al decodificar títulos", e);
    }
}
if (fadeParam) {
    crossfadeSec = parseInt(fadeParam, 10) || 10;
}

function updateStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
}

function setupEvents() {
    const btn = document.getElementById('playlist-btn');
    const container = document.getElementById('playlist-container');

    if (btn && container) {
        btn.onclick = () => {
            if (container.style.display === 'none' || container.style.display === '') {
                container.style.display = 'flex';
            } else {
                container.style.display = 'none';
            }
        };
    }
}

function renderPlaylist() {
    const container = document.getElementById('playlist-items');
    const btn = document.getElementById('playlist-btn');
    const fadeInfo = document.getElementById('fade-info');

    if (btn) btn.textContent = `≡ Playlist (${videoList.length})`;
    if (fadeInfo) fadeInfo.textContent = `${crossfadeSec}s`;

    if (!container) return;
    container.innerHTML = '';

    videoList.forEach((id, index) => {
        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
        item.textContent = videoTitles[id] || `Track ${index + 1}`;
        
        item.onclick = () => {
            currentIndex = index;
            const targetPlayer = activePlayer === 'A' ? playerA : playerB;
            if (targetPlayer && targetPlayer.loadVideoById) {
                targetPlayer.loadVideoById(videoList[currentIndex]);
                targetPlayer.playVideo();
                renderPlaylist();
                updateStatus(`Sonando: ${videoTitles[id] || `Track ${index + 1}`}`);
            }
        };

        container.appendChild(item);
    });
}

function onYouTubeIframeAPIReady() {
    setupEvents();
    renderPlaylist();

    if (videoList.length === 0) {
        updateStatus("No se recibieron videos.");
        return;
    }

    updateStatus("Cargando reproductor...");

    playerA = new YT.Player('playerA', {
        height: '100%',
        width: '100%',
        videoId: videoList[0],
        playerVars: { 'autoplay': 1, 'controls': 1, 'rel': 0, 'iv_load_policy': 3 },
        events: {
            'onReady': (e) => {
                e.target.setVolume(100);
                e.target.playVideo();
                startPlaybackMonitor();
                updateStatus(`Sonando: ${videoTitles[videoList[0]] || 'Track 1'}`);
            }
        }
    });

    playerB = new YT.Player('playerB', {
        height: '100%',
        width: '100%',
        playerVars: { 'autoplay': 0, 'controls': 1, 'rel': 0, 'iv_load_policy': 3 }
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
            if (fadeOutPlayer && fadeOutPlayer.setVolume) fadeOutPlayer.setVolume(Math.round((1 - progress) * 100));
            if (fadeInPlayer && fadeInPlayer.setVolume) fadeInPlayer.setVolume(Math.round(progress * 100));
        }
    }, intervalMs);
}
