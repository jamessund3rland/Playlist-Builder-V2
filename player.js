function renderPlaylist() {
    const playlistEl = document.getElementById('playlist-container');
    const countEl = document.getElementById('playlist-count');
    
    if (countEl) {
        countEl.textContent = `Playlist (${videoList.length})`;
    }
    
    if (!playlistEl) return;
    playlistEl.innerHTML = '';
    
    videoList.forEach((id, index) => {
        const item = document.createElement('div');
        item.className = `playlist-item ${index === currentIndex ? 'active' : ''}`;
        item.style.padding = '8px';
        item.style.margin = '4px 0';
        item.style.background = index === currentIndex ? '#ff2a00' : '#222';
        item.style.borderRadius = '4px';
        item.style.cursor = 'pointer';
        item.textContent = videoTitles[id] || `Track ${index + 1}`;
        playlistEl.appendChild(item);
    });
}
