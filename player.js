let videoIds = []; // <-- Asegúrate de que se llame videoIds (con i)
let videoTitles = {};
let crossfadeSec = 10;
let currentIndex = 0;

let playerA, playerB;
let activePlayer = 'A';
let isCrossfading = false;
let checkInterval = null;

const urlParams = new URLSearchParams(window.location.search);
const videosParam = urlParams.get('videos');
const fadeParam = urlParams.get('crossfade');

if (videosParam) {
    videoIds = videosParam.split(',').map(id => id.trim()).filter(id => id.length > 0);
}
if (fadeParam) {
    crossfadeSec = parseInt(fadeParam, 10) || 10;
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
