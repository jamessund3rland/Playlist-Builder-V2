let videoList = [];
let crossfadeSec = 10;
let currentIndex = 0;

let playerA, playerB;
let activePlayer = 'A';
let isCrossfading = false;
let checkInterval = null;

// Obtener parámetros de la URL
const urlParams = new URLSearchParams(window.location.search);
const videosParam = urlParams.get('videos');
const fadeParam = urlParams.get('crossfade');

if (videosParam) {
    videoList = videosParam.split(',').map(id => id.trim()).filter(id => id.length > 0);
}
if (fadeParam) {
    crossfadeSec = parseInt(fadeParam, 10) || 10;
}

const fadeInfoEl = document.getElementById('fade-info');
if (fadeInfoEl) fadeInfoEl.textContent = `Crossfade: ${crossfadeSec}s`;

function updateStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
}

function renderPlaylist() {
    const container = document.getElementById('playlist-items');
    const badge = document.getElementById('count-badge');
    if (badge) badge.textContent = videoList.length;
    if (!container) return;

    container.innerHTML = '';

    videoList.forEach((id, index) => {
        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
        item.onclick = () => playVideoAtIndex(index);

        item.innerHTML = `
            <span class="item-number">${index + 1}</span>
            <span class="item-title">Video ID: ${id}</span>
        `;
        container.appendChild(item);
    });
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
        updateStatus("Error: No se recibieron videos en la URL.");
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
        events: {
            'onReady': checkReady,
            'onStateChange': onStateChangeA
        }
    });

    const secondVideo = videoList.length > 1 ? videoList[1] : videoList[0];

    playerB = new YT.Player('playerB', {
        height: '100%', width: '100%',
        videoId: secondVideo,
        playerVars: { 'autoplay': 0, 'controls': 1, 'rel': 0, 'playsinline': 1 },
        events: {
            'onReady': checkReady,
            'onStateChange': onStateChangeB
        }
    });
}

function playVideoAtIndex(index) {
    if (index >= videoList.length) return;

    currentIndex = index;
    isCrossfading = false;
    renderPlaylist();

    const currPlayer = activePlayer === 'A' ? playerA : playerB;
    const nextPlayer = activePlayer === 'A' ? playerB : playerA;

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

    updateStatus(`Sonando: Track ${currentIndex + 1} de ${videoList.length}`);

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

    updateStatus(`Fundido cruzado hacia Track ${nextIndex + 1}...`);

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
            updateStatus(`Sonando: Track ${currentIndex + 1} de ${videoList.length}`);
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
