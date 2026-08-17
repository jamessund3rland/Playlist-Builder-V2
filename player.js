const urlParams = new URLSearchParams(window.location.search);
const videos = urlParams.get('videos') ? urlParams.get('videos').split(',') : [];
const crossfadeTime = parseInt(urlParams.get('crossfade')) || 0;

let currentIndex = 0;
let playerA, playerB;
let activeDeck = 'A';
let checkInterval = null;
let isCrossfading = false;
let startRequested = false;
let isPlayerAReady = false;

function updateUI(text) {
    const el = document.getElementById('status');
    if (el) el.innerText = text;
}

const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(tag);

window.onYouTubeIframeAPIReady = function() {
    if (!videos || videos.length === 0) {
        updateUI("Error: No hay videos en la lista.");
        return;
    }

    playerA = new YT.Player('playerA', {
        height: '100%',
        width: '100%',
        videoId: videos[0],
        playerVars: { 'autoplay': 0, 'controls': 1, 'rel': 0 },
        events: {
            'onReady': () => {
                isPlayerAReady = true;
                if (startRequested) launchParty();
                else updateUI(`Listo (${videos.length} videos)`);
            }
        }
    });

    if (videos.length > 1) {
        playerB = new YT.Player('playerB', {
            height: '100%',
            width: '100%',
            videoId: videos[1],
            playerVars: { 'autoplay': 0, 'controls': 1, 'rel': 0 }
        });
    }
};

document.getElementById('start-btn').addEventListener('click', () => {
    document.getElementById('start-overlay').style.display = 'none';
    startRequested = true;
    if (isPlayerAReady) launchParty();
    else updateUI("Cargando primer video...");
});

function launchParty() {
    playerA.playVideo();
    updateUI(`Reproduciendo: 1 / ${videos.length} (Crossfade: ${crossfadeTime}s)`);
    startEngine();
}

function startEngine() {
    if (checkInterval) clearInterval(checkInterval);

    checkInterval = setInterval(() => {
        if (isCrossfading) return;

        let currentPlayer = activeDeck === 'A' ? playerA : playerB;
        let nextPlayer = activeDeck === 'A' ? playerB : playerA;

        if (currentPlayer && typeof currentPlayer.getPlayerState === 'function') {
            if (currentPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
                let currentTime = currentPlayer.getCurrentTime();
                let duration = currentPlayer.getDuration();

                if (duration > 0 && (duration - currentTime) <= crossfadeTime) {
                    if (currentIndex + 1 < videos.length) {
                        executeCrossfade(currentPlayer, nextPlayer);
                    } else {
                        clearInterval(checkInterval);
                        updateUI("Fin de la lista.");
                    }
                }
            }
        }
    }, 500);
}

function executeCrossfade(outgoingPlayer, incomingPlayer) {
    isCrossfading = true;
    currentIndex++;
    updateUI(`Reproduciendo: ${currentIndex + 1} / ${videos.length}`);

    if (incomingPlayer && typeof incomingPlayer.loadVideoById === 'function') {
        incomingPlayer.loadVideoById(videos[currentIndex]);
        incomingPlayer.setVolume(0);
        incomingPlayer.playVideo();
    }

    document.getElementById('playerA').classList.toggle('active');
    document.getElementById('playerB').classList.toggle('active');
    activeDeck = activeDeck === 'A' ? 'B' : 'A';

    let steps = 20;
    let intervalTime = Math.max(50, (crossfadeTime * 1000) / steps);
    let currentStep = 0;

    let fadeAudio = setInterval(() => {
        currentStep++;
        let outVol = 100 - (100 * (currentStep / steps));
        let inVol = (100 * (currentStep / steps));

        if (outgoingPlayer && typeof outgoingPlayer.setVolume === 'function') {
            outgoingPlayer.setVolume(Math.max(0, Math.round(outVol)));
        }
        if (incomingPlayer && typeof incomingPlayer.setVolume === 'function') {
            incomingPlayer.setVolume(Math.min(100, Math.round(inVol)));
        }

        if (currentStep >= steps) {
            clearInterval(fadeAudio);
            if (outgoingPlayer && typeof outgoingPlayer.stopVideo === 'function') {
                outgoingPlayer.stopVideo();
            }
            isCrossfading = false;
        }
    }, intervalTime);
}