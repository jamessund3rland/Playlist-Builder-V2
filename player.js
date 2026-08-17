let videoList = [];
let crossfadeSec = 10;
let currentIndex = 0;
let player;

// Obtener parámetros de la URL
const urlParams = new URLSearchParams(window.location.search);
const videosParam = urlParams.get('videos');
const fadeParam = urlParams.get('crossfade');

if (videosParam) {
    videoList = videosParam.split(',').filter(id => id.trim() !== '');
}
if (fadeParam) {
    crossfadeSec = parseInt(fadeParam, 10) || 10;
}

function updateStatus(text) {
    const el = document.getElementById('status');
    if (el) el.textContent = text;
}

// Función requerida automáticamente por la API de YouTube
function onYouTubeIframeAPIReady() {
    if (videoList.length === 0) {
        updateStatus("Error: No se recibieron videos en la URL.");
        return;
    }

    updateStatus(`Iniciando video 1 de ${videoList.length}...`);

    player = new YT.Player('player1', {
        height: '100%',
        width: '100%',
        videoId: videoList[0],
        playerVars: {
            'autoplay': 1,
            'controls': 1,
            'rel': 0,
            'playsinline': 1
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange,
            'onError': onPlayerError
        }
    });
}

function onPlayerReady(event) {
    event.target.playVideo();
    updateStatus(`Reproduciendo (1 / ${videoList.length})`);
}

function onPlayerStateChange(event) {
    // Cuando el video termina, pasa automáticamente al siguiente
    if (event.data === YT.PlayerState.ENDED) {
        nextVideo();
    }
}

function onPlayerError(e) {
    console.error("Error en video:", e);
    updateStatus("Error al cargar este video. Saltando al siguiente...");
    setTimeout(nextVideo, 2000);
}

function nextVideo() {
    currentIndex++;
    if (currentIndex < videoList.length) {
        updateStatus(`Reproduciendo (${currentIndex + 1} / ${videoList.length})`);
        player.loadVideoById(videoList[currentIndex]);
    } else {
        updateStatus("¡Fin de la lista de reproducción!");
    }
}
