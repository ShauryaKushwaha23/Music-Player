/**
 * GrooveBox — Main App
 * Wires up DB, AudioEngine, and UI
 */

const App = (() => {
  // State
  let tracks      = [];       // all tracks (from DB)
  let queue       = [];       // current play queue (array of track ids)
  let queueIdx    = 0;        // index in queue
  let playlists   = [];       // [{id, name, trackIds}]
  let favorites   = new Set();
  let shuffle     = false;
  let repeatMode  = 'none';   // 'none' | 'one' | 'all'
  let searchQuery = '';
  let sortBy      = 'added';
  let activeTrack = null;     // current track object
  let gridView    = false;
  let activePlaylistId = null;

  // Visualizer RAF
  let vizRaf = null;

  // DOM refs
  const $ = (id) => document.getElementById(id);
  const trackListEl  = $('trackList');
  const queueListEl  = $('queueList');
  const playlistListEl = $('playlistList');
  const favListEl    = $('favList');
  const emptyStateEl = $('emptyState');
  const albumArt     = $('albumArtContainer');
  const trackTitle   = $('trackTitle');
  const trackArtist  = $('trackArtist');
  const progressFill = $('progressFill');
  const progressThumb= $('progressThumb');
  const currentTime  = $('currentTime');
  const totalTime    = $('totalTime');
  const playBtn      = $('playBtn');
  const shuffleBtn   = $('shuffleBtn');
  const repeatBtn    = $('repeatBtn');
  const speedBtn     = $('speedBtn');
  const vizCanvas    = $('visualizer');

  // ========== INIT ==========
  async function init() {
    await DB.open();

    // Load persisted data
    tracks    = await DB.getAllTracks();
    playlists = await DB.getAllPlaylists();
    const savedFavs = await DB.getSetting('favorites', []);
    favorites = new Set(savedFavs);

    // Restore last settings
    const savedVol  = await DB.getSetting('volume', 0.8);
    const savedSpeed= await DB.getSetting('speed', 1.0);
    const savedShuf = await DB.getSetting('shuffle', false);
    const savedRep  = await DB.getSetting('repeat', 'none');

    shuffle    = savedShuf;
    repeatMode = savedRep;
    $('volumeSlider').value = savedVol;
    AudioEngine.setVolume(savedVol);
    AudioEngine.setSpeed(savedSpeed);
    speedBtn.textContent = savedSpeed + '×';
    shuffleBtn.classList.toggle('active', shuffle);
    updateRepeatBtn();

    // Set up AudioEngine callbacks
    AudioEngine.onProgress = onProgress;
    AudioEngine.onEnded    = onTrackEnded;
    AudioEngine.onLoaded   = onTrackLoaded;

    // Render
    renderTrackList();
    renderQueue();
    renderPlaylists();
    renderFavorites();
    startVisualizer();
    bindEvents();
    setupDropZone();
    resizeCanvas();

    // Restore active queue / track
    const savedQueue = await DB.getSetting('queue', []);
    const savedIdx   = await DB.getSetting('queueIdx', 0);
    if (savedQueue.length) {
      queue    = savedQueue.filter(id => tracks.find(t => t.id === id));
      queueIdx = Math.min(savedIdx, queue.length - 1);
      if (queue.length) {
        const t = tracks.find(t => t.id === queue[queueIdx]);
        if (t) setActiveTrack(t, false);
      }
    }
  }

  // ========== TRACK MANAGEMENT ==========
  async function addFiles(files) {
    const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|m4a|opus|weba)$/i.test(f.name));
    if (!audioFiles.length) { UI.toast('No audio files found', 'error'); return; }

    let added = 0;
    for (const file of audioFiles) {
      // Check duplicate by name + size
      const dup = tracks.find(t => t.originalName === file.name && t.size === file.size);
      if (dup) { UI.toast(`Already in library: ${file.name}`, 'info'); continue; }

      const meta = await DB.extractMetadata(file);
      const id   = DB.generateId();

      // Convert to base64 for storage
      const audioB64 = await DB.blobToBase64(file);

      // Try to extract cover art from ID3 tags using a lightweight approach
      let coverDataUrl = null;
      try {
        coverDataUrl = await extractCoverFromFile(file);
      } catch (e) {}

      const track = {
        id,
        name:         meta.name,
        artist:       meta.artist,
        album:        meta.album,
        duration:     meta.duration,
        audioData:    audioB64,
        coverDataUrl: coverDataUrl,
        originalName: file.name,
        size:         file.size,
        mimeType:     file.type || 'audio/mpeg',
        addedAt:      Date.now(),
        trimStart:    0,
        trimEnd:      null,
      };

      await DB.saveTrack(track);
      tracks.push(track);
      added++;

      // Add to end of queue
      queue.push(id);
    }

    if (added) {
      UI.toast(`✦ Added ${added} track${added > 1 ? 's' : ''} to your groove`, 'success');
      renderTrackList();
      renderQueue();
      await DB.setSetting('queue', queue);

      // Auto-play first added if nothing playing
      if (!activeTrack && queue.length > 0) {
        queueIdx = queue.length - added;
        const t = tracks.find(t => t.id === queue[queueIdx]);
        if (t) await playTrack(t);
      }
    }
  }

  // ========== COVER ART EXTRACTION (simple ID3v2 parser) ==========
  async function extractCoverFromFile(file) {
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);

    // ID3v2 check
    if (view.getUint8(0) === 0x49 && view.getUint8(1) === 0x44 && view.getUint8(2) === 0x33) {
      const size = ((view.getUint8(6) & 0x7F) << 21) | ((view.getUint8(7) & 0x7F) << 14) |
                   ((view.getUint8(8) & 0x7F) << 7)  | (view.getUint8(9) & 0x7F);
      const data = new Uint8Array(buf, 0, Math.min(size + 10, buf.byteLength));

      let pos = 10;
      const majorVersion = view.getUint8(3);

      while (pos < data.length - 10) {
        const frameId = String.fromCharCode(data[pos], data[pos+1], data[pos+2], data[pos+3]);
        const frameSize = majorVersion >= 4
          ? ((data[pos+4] & 0x7F) << 21) | ((data[pos+5] & 0x7F) << 14) | ((data[pos+6] & 0x7F) << 7) | (data[pos+7] & 0x7F)
          : (data[pos+4] << 24) | (data[pos+5] << 16) | (data[pos+6] << 8) | data[pos+7];

        if (frameSize <= 0 || frameSize > 15_000_000) break;

        if (frameId === 'APIC') {
          // Find the image data within the frame
          let imgStart = pos + 10 + 1; // skip encoding byte
          // Skip MIME type (null-terminated)
          while (imgStart < data.length && data[imgStart] !== 0) imgStart++;
          imgStart++; // skip null
          imgStart++; // skip picture type
          // Skip description (null-terminated)
          while (imgStart < data.length && data[imgStart] !== 0) imgStart++;
          imgStart++; // skip null

          const imgData = data.slice(imgStart, pos + 10 + frameSize);
          const mimeMatch = (() => {
            if (imgData[0] === 0xFF && imgData[1] === 0xD8) return 'image/jpeg';
            if (imgData[0] === 0x89 && imgData[1] === 0x50) return 'image/png';
            return 'image/jpeg';
          })();
          const blob = new Blob([imgData], { type: mimeMatch });
          return await DB.blobToBase64(blob);
        }

        pos += 10 + frameSize;
      }
    }
    return null;
  }

  // ========== PLAYBACK ==========
  async function playTrack(track, fromQueue = true) {
    if (!track) return;
    activeTrack = track;

    // Update queue position
    if (fromQueue) {
      const qi = queue.indexOf(track.id);
      if (qi !== -1) queueIdx = qi;
      else {
        queue.push(track.id);
        queueIdx = queue.length - 1;
      }
    }

    // Load audio
    const blob = await DB.base64ToBlob(track.audioData, track.mimeType || 'audio/mpeg');
    const startSec = track.trimStart || 0;

    // Set trim
    if (track.trimEnd) {
      AudioEngine.setTrim(track.trimStart || 0, track.trimEnd);
    } else {
      AudioEngine.clearTrim();
    }

    await AudioEngine.loadBlob(blob, startSec);
    await AudioEngine.play();

    // Update UI
    updateNowPlaying(track);
    renderTrackList();
    renderQueue();
    albumArt.querySelector('.album-art').classList.add('spinning');

    await DB.setSetting('queue', queue);
    await DB.setSetting('queueIdx', queueIdx);
  }

  function updateNowPlaying(track) {
    trackTitle.textContent  = track.name   || 'Unknown Track';
    trackArtist.textContent = track.artist || 'Unknown Artist';
    UI.setAlbumArt(track.coverDataUrl || null);
    playBtn.querySelector('.play-icon').textContent = '⏸';

    // Scrolling title if too long
    if (track.name && track.name.length > 25) {
      trackTitle.classList.add('scrolling');
    } else {
      trackTitle.classList.remove('scrolling');
    }
  }

  function onProgress() {
    const dur  = AudioEngine.duration;
    const cur  = AudioEngine.currentTime;
    const pct  = dur ? cur / dur : 0;

    progressFill.style.width = (pct * 100) + '%';
    progressThumb.style.left = (pct * 100) + '%';
    currentTime.textContent  = UI.formatTime(cur);
    totalTime.textContent    = UI.formatTime(dur);
  }

  function onTrackLoaded() {
    totalTime.textContent = UI.formatTime(AudioEngine.duration);
    if (activeTrack && !activeTrack.duration) {
      activeTrack.duration = AudioEngine.duration;
      DB.updateTrack(activeTrack.id, { duration: AudioEngine.duration });
      renderTrackList();
    }
  }

  function onTrackEnded() {
    albumArt.querySelector('.album-art').classList.remove('spinning');
    playBtn.querySelector('.play-icon').textContent = '▶';

    if (repeatMode === 'one') {
      playTrack(activeTrack);
    } else if (repeatMode === 'all' || queue.length > 1) {
      playNext();
    }
  }

  function playNext() {
    if (!queue.length) return;
    if (shuffle) {
      let idx = Math.floor(Math.random() * queue.length);
      if (idx === queueIdx && queue.length > 1) idx = (idx + 1) % queue.length;
      queueIdx = idx;
    } else {
      queueIdx = (queueIdx + 1) % queue.length;
    }
    const t = tracks.find(t => t.id === queue[queueIdx]);
    if (t) playTrack(t);
  }

  function playPrev() {
    if (!queue.length) return;
    // If past 3s, restart current track
    if (AudioEngine.currentTime > 3) {
      AudioEngine.seekTo(AudioEngine.trimStart || 0);
      return;
    }
    if (shuffle) {
      queueIdx = Math.floor(Math.random() * queue.length);
    } else {
      queueIdx = (queueIdx - 1 + queue.length) % queue.length;
    }
    const t = tracks.find(t => t.id === queue[queueIdx]);
    if (t) playTrack(t);
  }

  function setActiveTrack(track, autoplay = false) {
    activeTrack = track;
    updateNowPlaying(track);
    if (autoplay) AudioEngine.play().catch(() => {});
  }

  // ========== RENDER ==========
  function renderTrackList() {
    trackListEl.innerHTML = '';

    let list = [...tracks];

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(t =>
        t.name.toLowerCase().includes(q) ||
        (t.artist || '').toLowerCase().includes(q)
      );
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === 'name')     return a.name.localeCompare(b.name);
      if (sortBy === 'artist')   return (a.artist||'').localeCompare(b.artist||'');
      if (sortBy === 'duration') return (a.duration||0) - (b.duration||0);
      return b.addedAt - a.addedAt; // recently added
    });

    if (!list.length) {
      trackListEl.appendChild(emptyStateEl);
      return;
    }

    for (const track of list) {
      const isActive = activeTrack && activeTrack.id === track.id;
      const isFav    = favorites.has(track.id);
      const el = UI.createTrackItem(track, isActive, isFav, {
        onPlay:    (id) => { const t = tracks.find(t => t.id === id); if (t) playTrack(t); },
        onFav:     (id) => toggleFavorite(id),
        onDelete:  (id) => deleteTrack(id),
        onContext: (e, t) => showTrackContext(e, t),
      });
      trackListEl.appendChild(el);
    }
  }

  function renderQueue() {
    queueListEl.innerHTML = '';
    if (!queue.length) {
      queueListEl.innerHTML = `<div class="empty-state"><div class="empty-icon" style="font-size:2rem">♫</div><p>Your queue is empty</p></div>`;
      return;
    }
    queue.forEach((id, i) => {
      const t = tracks.find(t => t.id === id);
      if (!t) return;
      const isActive = i === queueIdx;
      const el = UI.createQueueItem(t, i, isActive,
        (tid) => {
          queueIdx = queue.indexOf(tid);
          const tr = tracks.find(t => t.id === tid);
          if (tr) playTrack(tr);
        },
        (idx) => {
          queue.splice(idx, 1);
          if (queueIdx >= queue.length) queueIdx = Math.max(0, queue.length - 1);
          renderQueue();
          DB.setSetting('queue', queue);
        }
      );
      queueListEl.appendChild(el);
    });
  }

  function renderPlaylists() {
    playlistListEl.innerHTML = '';
    if (!playlists.length) {
      playlistListEl.innerHTML = `<div class="empty-state"><p>No playlists yet</p></div>`;
      return;
    }
    for (const pl of playlists) {
      const el = UI.createPlaylistItem(pl, activePlaylistId === pl.id, {
        onPlay:   (id) => playPlaylist(id),
        onDelete: (id) => deletePlaylist(id),
        onSelect: (id) => { activePlaylistId = id; renderPlaylists(); },
      });
      playlistListEl.appendChild(el);
    }
  }

  function renderFavorites() {
    favListEl.innerHTML = '';
    const favTracks = tracks.filter(t => favorites.has(t.id));
    if (!favTracks.length) {
      favListEl.innerHTML = `<div class="empty-state"><div class="empty-icon" style="font-size:2rem">♡</div><p>No favorites yet<br/><em>Heart a track to save it</em></p></div>`;
      return;
    }
    for (const track of favTracks) {
      const el = UI.createQueueItem(track, favTracks.indexOf(track), activeTrack && activeTrack.id === track.id,
        (id) => { const t = tracks.find(t => t.id === id); if (t) playTrack(t); },
        (idx) => {
          const tid = favTracks[idx].id;
          favorites.delete(tid);
          DB.setSetting('favorites', [...favorites]);
          renderFavorites();
          renderTrackList();
        }
      );
      favListEl.appendChild(el);
    }
  }

  // ========== FAVORITES ==========
  async function toggleFavorite(id) {
    if (favorites.has(id)) {
      favorites.delete(id);
      UI.toast('Removed from favorites', 'info');
    } else {
      favorites.add(id);
      UI.toast('♥ Added to favorites', 'success');
    }
    await DB.setSetting('favorites', [...favorites]);
    renderTrackList();
    renderFavorites();
  }

  // ========== DELETE ==========
  async function deleteTrack(id) {
    if (!confirm('Remove this track from your library?')) return;
    await DB.deleteTrack(id);
    tracks = tracks.filter(t => t.id !== id);
    queue  = queue.filter(qid => qid !== id);
    favorites.delete(id);

    if (activeTrack && activeTrack.id === id) {
      AudioEngine.pause();
      activeTrack = null;
      trackTitle.textContent  = 'No Track Playing';
      trackArtist.textContent = '— select a groove —';
      UI.setAlbumArt(null);
      playBtn.querySelector('.play-icon').textContent = '▶';
    }
    renderTrackList();
    renderQueue();
    renderFavorites();
    await DB.setSetting('queue', queue);
    UI.toast('Track removed', 'info');
  }

  // ========== PLAYLISTS ==========
  async function createPlaylist(name) {
    if (!name.trim()) return;
    const pl = { id: DB.generatePlaylistId(), name: name.trim(), trackIds: [] };
    playlists.push(pl);
    await DB.savePlaylists(playlists);
    renderPlaylists();
    UI.toast(`♫ Playlist "${pl.name}" created`, 'success');
    return pl;
  }

  async function deletePlaylist(id) {
    playlists = playlists.filter(p => p.id !== id);
    await DB.savePlaylists(playlists);
    renderPlaylists();
    UI.toast('Playlist deleted', 'info');
  }

  async function addToPlaylist(trackId, playlistId) {
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return;
    if (pl.trackIds.includes(trackId)) { UI.toast('Already in playlist', 'info'); return; }
    pl.trackIds.push(trackId);
    await DB.savePlaylists(playlists);
    renderPlaylists();
    UI.toast(`Added to "${pl.name}"`, 'success');
  }

  function playPlaylist(id) {
    const pl = playlists.find(p => p.id === id);
    if (!pl || !pl.trackIds.length) { UI.toast('Playlist is empty', 'info'); return; }
    queue    = [...pl.trackIds];
    queueIdx = 0;
    const t  = tracks.find(t => t.id === queue[0]);
    if (t) playTrack(t);
  }

  // ========== VISUALIZER ==========
  function startVisualizer() {
    const canvas = vizCanvas;
    function resize() {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function draw() {
      vizRaf = requestAnimationFrame(draw);
      const data = AudioEngine.getVisualizerData();
      UI.drawVisualizer(canvas, data, AudioEngine.playing);
    }
    draw();
  }

  function resizeCanvas() {
    vizCanvas.width  = vizCanvas.offsetWidth;
    vizCanvas.height = vizCanvas.offsetHeight;
  }

  // ========== CONTEXT MENU ==========
  function showTrackContext(e, track) {
    const menuItems = [
      { icon: '▶', label: 'Play Now', action: () => playTrack(track) },
      { icon: '⊕', label: 'Add to Queue', action: () => {
        queue.push(track.id);
        renderQueue();
        DB.setSetting('queue', queue);
        UI.toast('Added to queue', 'success');
      }},
      'separator',
      { icon: '♥', label: favorites.has(track.id) ? 'Remove Favorite' : 'Add Favorite',
        action: () => toggleFavorite(track.id) },
      'separator',
      ...playlists.map(pl => ({
        icon: '♫',
        label: `Add to "${pl.name}"`,
        action: () => addToPlaylist(track.id, pl.id),
      })),
      ...(playlists.length ? ['separator'] : []),
      { icon: '✂', label: 'Trim Track', action: () => openTrimModal(track) },
      { icon: '✕', label: 'Remove', action: () => deleteTrack(track.id) },
    ];
    UI.showContextMenu(e, menuItems);
  }

  // ========== TRIM MODAL ==========
  async function openTrimModal(track) {
    activeTrack = track;
    const modal = $('trimModal');
    $('trimTrackName').textContent = `${track.name} — ${track.artist || 'Unknown'}`;

    const dur = track.duration || AudioEngine.duration;
    $('trimStartTime').value = track.trimStart || 0;
    $('trimStartTime').max   = dur;
    $('trimEndTime').value   = track.trimEnd   || dur;
    $('trimEndTime').max     = dur;

    // Draw waveform
    const trimCanvas = $('trimWaveform');
    trimCanvas.width  = trimCanvas.offsetWidth  || 380;
    trimCanvas.height = trimCanvas.offsetHeight || 80;
    try {
      const blob = await DB.base64ToBlob(track.audioData, track.mimeType);
      await AudioEngine.drawWaveformToCanvas(blob, trimCanvas);
    } catch (e) {}

    // Position handles
    updateTrimHandles(track.trimStart || 0, track.trimEnd || dur, dur);

    modal.hidden = false;
  }

  function updateTrimHandles(start, end, dur) {
    if (!dur) return;
    const startHandle = $('trimStartHandle');
    const endHandle   = $('trimEndHandle');
    const region      = $('trimRegionPreview');
    const containerW  = $('trimWaveform').offsetWidth || 380;

    const sp = (start / dur) * containerW;
    const ep = (end   / dur) * containerW;

    startHandle.style.left  = sp + 'px';
    endHandle.style.left    = ep + 'px';
    region.style.left  = sp + 'px';
    region.style.width = (ep - sp) + 'px';
  }

  function setupTrimHandleDrag() {
    let dragging = null;
    const handles = [$('trimStartHandle'), $('trimEndHandle')];
    const containerW = () => $('trimWaveform').offsetWidth || 380;

    handles.forEach((h, i) => {
      h.addEventListener('mousedown', (e) => {
        dragging = i;
        e.preventDefault();
      });
    });
    document.addEventListener('mousemove', (e) => {
      if (dragging === null) return;
      const rect = $('trimWaveform').getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur  = parseFloat($('trimEndTime').max) || AudioEngine.duration;
      const sec  = pct * dur;
      if (dragging === 0) {
        $('trimStartTime').value = sec.toFixed(1);
      } else {
        $('trimEndTime').value = sec.toFixed(1);
      }
      updateTrimHandles(
        parseFloat($('trimStartTime').value),
        parseFloat($('trimEndTime').value),
        dur
      );
    });
    document.addEventListener('mouseup', () => { dragging = null; });
  }

  // ========== EVENTS ==========
  function bindEvents() {
    // File input
    $('addMusicBtn').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

    // Play/Pause
    playBtn.addEventListener('click', async () => {
      if (!activeTrack) {
        if (tracks.length) { await playTrack(tracks[0]); } return;
      }
      if (AudioEngine.playing) {
        AudioEngine.pause();
        playBtn.querySelector('.play-icon').textContent = '▶';
        albumArt.querySelector('.album-art').classList.remove('spinning');
      } else {
        await AudioEngine.play();
        playBtn.querySelector('.play-icon').textContent = '⏸';
        albumArt.querySelector('.album-art').classList.add('spinning');
      }
    });

    // Prev / Next
    $('prevBtn').addEventListener('click', playPrev);
    $('nextBtn').addEventListener('click', playNext);

    // Shuffle
    shuffleBtn.addEventListener('click', async () => {
      shuffle = !shuffle;
      shuffleBtn.classList.toggle('active', shuffle);
      await DB.setSetting('shuffle', shuffle);
      UI.toast(shuffle ? '⇄ Shuffle on' : '⇄ Shuffle off', 'info', 1500);
    });

    // Repeat
    repeatBtn.addEventListener('click', async () => {
      const modes = ['none', 'all', 'one'];
      repeatMode = modes[(modes.indexOf(repeatMode) + 1) % 3];
      updateRepeatBtn();
      AudioEngine.setLoop(repeatMode === 'one');
      await DB.setSetting('repeat', repeatMode);
    });

    // Volume
    $('volumeSlider').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      AudioEngine.setVolume(v);
      DB.setSetting('volume', v);
      $('muteBtn').textContent = v === 0 ? '🔇' : v < 0.5 ? '🔉' : '🔊';
    });

    $('muteBtn').addEventListener('click', () => {
      const muted = AudioEngine.toggleMute();
      $('muteBtn').textContent = muted ? '🔇' : '🔊';
    });

    // Progress bar seek
    const progressWrap = $('progressBarWrap');
    let seeking = false;
    progressWrap.addEventListener('mousedown', (e) => {
      seeking = true;
      doSeek(e, progressWrap);
    });
    document.addEventListener('mousemove', (e) => { if (seeking) doSeek(e, progressWrap); });
    document.addEventListener('mouseup', () => { seeking = false; });
    progressWrap.addEventListener('touchstart', (e) => { doSeek(e.touches[0], progressWrap); }, { passive: true });
    progressWrap.addEventListener('touchmove', (e) => { doSeek(e.touches[0], progressWrap); }, { passive: true });

    function doSeek(e, wrap) {
      const rect = wrap.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      AudioEngine.seek(pct);
    }

    // Speed button
    speedBtn.addEventListener('click', () => { $('speedModal').hidden = false; });
    $('speedModalClose').addEventListener('click', () => { $('speedModal').hidden = true; });
    document.querySelectorAll('.speed-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-opt').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const s = parseFloat(btn.dataset.speed);
        AudioEngine.setSpeed(s);
        speedBtn.textContent = s + '×';
        $('speedCustom').value = s;
        $('speedCustomVal').textContent = s + '×';
        DB.setSetting('speed', s);
      });
    });
    $('speedCustom').addEventListener('input', (e) => {
      const s = parseFloat(e.target.value);
      AudioEngine.setSpeed(s);
      speedBtn.textContent = s.toFixed(2) + '×';
      $('speedCustomVal').textContent = s.toFixed(2) + '×';
      document.querySelectorAll('.speed-opt').forEach(b => b.classList.remove('active'));
      DB.setSetting('speed', s);
    });

    // Bass boost
    $('boostBtn').addEventListener('click', () => {
      const on = AudioEngine.toggleBassBoost();
      $('boostBtn').classList.toggle('active', on);
      UI.toast(on ? '🎸 Bass boost ON' : '🎸 Bass boost OFF', 'info', 1500);
    });

    // EQ
    $('eqToggle').addEventListener('click', () => {
      const btn = $('eqToggle');
      const on  = btn.textContent === 'ON';
      AudioEngine.toggleEQ(!on);
      btn.textContent = on ? 'OFF' : 'ON';
      btn.classList.toggle('off', on);
    });

    document.querySelectorAll('.eq-slider').forEach((slider, i) => {
      slider.addEventListener('input', (e) => {
        AudioEngine.setEQBand(i, parseFloat(e.target.value));
      });
    });

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const vals = AudioEngine.applyEQPreset(btn.dataset.preset);
        document.querySelectorAll('.eq-slider').forEach((sl, i) => { sl.value = vals[i]; });
      });
    });

    // Trim modal
    $('trimBtn').addEventListener('click', () => {
      if (!activeTrack) { UI.toast('No track selected', 'error'); return; }
      openTrimModal(activeTrack);
    });
    $('trimModalClose').addEventListener('click', () => { $('trimModal').hidden = true; });

    $('trimPreviewBtn').addEventListener('click', async () => {
      const s = parseFloat($('trimStartTime').value);
      const e = parseFloat($('trimEndTime').value);
      AudioEngine.setTrim(s, e);
      AudioEngine.seekTo(s);
      await AudioEngine.play();
    });

    $('trimApplyBtn').addEventListener('click', async () => {
      if (!activeTrack) return;
      const s = parseFloat($('trimStartTime').value) || 0;
      const e = parseFloat($('trimEndTime').value)   || activeTrack.duration;
      activeTrack.trimStart = s;
      activeTrack.trimEnd   = e;
      await DB.updateTrack(activeTrack.id, { trimStart: s, trimEnd: e });
      AudioEngine.setTrim(s, e);
      $('trimModal').hidden = true;
      UI.toast(`✂ Trim applied: ${UI.formatTime(s)} – ${UI.formatTime(e)}`, 'success');
    });

    $('trimStartTime').addEventListener('input', () => {
      const s = parseFloat($('trimStartTime').value);
      const e = parseFloat($('trimEndTime').value);
      const d = parseFloat($('trimEndTime').max);
      updateTrimHandles(s, e, d);
    });
    $('trimEndTime').addEventListener('input', () => {
      const s = parseFloat($('trimStartTime').value);
      const e = parseFloat($('trimEndTime').value);
      const d = parseFloat($('trimEndTime').max);
      updateTrimHandles(s, e, d);
    });

    setupTrimHandleDrag();

    // Search
    $('searchInput').addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderTrackList();
    });

    // Sort
    $('sortSelect').addEventListener('change', (e) => {
      sortBy = e.target.value;
      renderTrackList();
    });

    // View toggle
    $('viewToggle').addEventListener('click', () => {
      gridView = !gridView;
      $('viewToggle').textContent = gridView ? '≡' : '⊞';
      trackListEl.style.display = gridView ? 'grid' : '';
      trackListEl.style.gridTemplateColumns = gridView ? '1fr 1fr' : '';
      trackListEl.style.gap = gridView ? '6px' : '';
    });

    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
      });
    });

    // Playlist creation
    $('createPlaylistBtn').addEventListener('click', async () => {
      const name = $('newPlaylistInput').value.trim();
      if (!name) return;
      await createPlaylist(name);
      $('newPlaylistInput').value = '';
    });
    $('newPlaylistInput').addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const name = e.target.value.trim();
        if (!name) return;
        await createPlaylist(name);
        e.target.value = '';
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (e.code) {
        case 'Space':      e.preventDefault(); playBtn.click(); break;
        case 'ArrowRight': AudioEngine.seekTo(AudioEngine.currentTime + 5);  break;
        case 'ArrowLeft':  AudioEngine.seekTo(AudioEngine.currentTime - 5);  break;
        case 'ArrowUp':    { const v = Math.min(1, parseFloat($('volumeSlider').value) + 0.05); $('volumeSlider').value = v; AudioEngine.setVolume(v); break; }
        case 'ArrowDown':  { const v = Math.max(0, parseFloat($('volumeSlider').value) - 0.05); $('volumeSlider').value = v; AudioEngine.setVolume(v); break; }
        case 'KeyN':       playNext(); break;
        case 'KeyP':       playPrev(); break;
        case 'KeyS':       shuffleBtn.click(); break;
        case 'KeyR':       repeatBtn.click(); break;
        case 'KeyM':       $('muteBtn').click(); break;
      }
    });

    // Resize
    window.addEventListener('resize', resizeCanvas);
  }

  function updateRepeatBtn() {
    const icons = { none: '↻', all: '↻', one: '①' };
    const labels = { none: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
    repeatBtn.textContent = icons[repeatMode];
    repeatBtn.title  = labels[repeatMode];
    repeatBtn.classList.toggle('active', repeatMode !== 'none');
    if (repeatMode === 'one') repeatBtn.style.color = 'var(--sage)';
    else repeatBtn.style.color = '';
  }

  // ========== DROP ZONE ==========
  function setupDropZone() {
    const zone = $('dropZone');
    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      zone.hidden = false;
    });
    document.addEventListener('dragleave', () => {
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; zone.hidden = true; }
    });
    document.addEventListener('dragover', (e) => { e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      zone.hidden = true;
      const files = e.dataTransfer?.files;
      if (files) addFiles(files);
    });
  }

  return { init };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => {
  App.init().catch(console.error);
});
