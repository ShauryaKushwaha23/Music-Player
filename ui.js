/**
 * GrooveBox UI Helpers
 */

const UI = {
  // ---- FORMAT TIME ----
  formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  },

  // ---- TOAST ----
  toast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      el.style.transition = 'all 0.3s';
      setTimeout(() => el.remove(), 300);
    }, duration);
  },

  // ---- TRACK ITEM ----
  createTrackItem(track, isActive, isFav, callbacks) {
    const el = document.createElement('div');
    el.className = `track-item${isActive ? ' active' : ''}`;
    el.dataset.id = track.id;

    const thumbHtml = track.coverDataUrl
      ? `<div class="track-thumb"><img src="${track.coverDataUrl}" alt="cover"/></div>`
      : `<div class="track-thumb">${this.randomMusicEmoji()}</div>`;

    const barsHtml = isActive
      ? `<div class="track-equalizer-bars">
           <div class="track-eq-bar" style="height:${this.randH()}px"></div>
           <div class="track-eq-bar" style="height:${this.randH()}px"></div>
           <div class="track-eq-bar" style="height:${this.randH()}px"></div>
         </div>`
      : '';

    el.innerHTML = `
      ${thumbHtml}
      <div class="track-info-mini">
        <div class="track-name-mini" title="${this.esc(track.name)}">${this.esc(track.name)}</div>
        <div class="track-artist-mini">${this.esc(track.artist || 'Unknown')}</div>
      </div>
      ${barsHtml}
      <span class="track-dur">${this.formatTime(track.duration)}</span>
      <div class="track-actions">
        <button class="track-action-btn fav-btn${isFav ? ' fav-active' : ''}" title="${isFav ? 'Unfav' : 'Favorite'}">♥</button>
        <button class="track-action-btn del-btn" title="Remove">✕</button>
      </div>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('fav-btn')) {
        callbacks.onFav(track.id);
      } else if (e.target.classList.contains('del-btn')) {
        callbacks.onDelete(track.id);
      } else {
        callbacks.onPlay(track.id);
      }
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      callbacks.onContext(e, track);
    });

    return el;
  },

  // ---- QUEUE ITEM ----
  createQueueItem(track, index, isActive, onPlay, onRemove) {
    const el = document.createElement('div');
    el.className = `queue-item${isActive ? ' active' : ''}`;
    el.dataset.id = track.id;
    el.innerHTML = `
      <span class="queue-num">${index + 1}</span>
      <span class="queue-name" title="${this.esc(track.name)}">${this.esc(track.name)}</span>
      <button class="queue-remove" title="Remove from queue">✕</button>
    `;
    el.querySelector('.queue-name').addEventListener('click', () => onPlay(track.id));
    el.querySelector('.queue-remove').addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove(index);
    });
    return el;
  },

  // ---- PLAYLIST ITEM ----
  createPlaylistItem(pl, isActive, callbacks) {
    const el = document.createElement('div');
    el.className = `playlist-item${isActive ? ' active' : ''}`;
    el.dataset.id = pl.id;
    el.innerHTML = `
      <div class="playlist-name">${this.esc(pl.name)}</div>
      <div class="playlist-count">${pl.trackIds.length} tracks</div>
      <div class="playlist-actions">
        <button class="pl-action-btn pl-play-btn">▶ Play</button>
        <button class="pl-action-btn pl-del-btn">✕ Delete</button>
      </div>
    `;
    el.querySelector('.pl-play-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onPlay(pl.id);
    });
    el.querySelector('.pl-del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks.onDelete(pl.id);
    });
    el.addEventListener('click', () => callbacks.onSelect(pl.id));
    return el;
  },

  // ---- CONTEXT MENU ----
  showContextMenu(e, items) {
    this.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.id = 'contextMenu';
    for (const item of items) {
      if (item === 'separator') {
        const sep = document.createElement('div');
        sep.className = 'context-separator';
        menu.appendChild(sep);
      } else {
        const el = document.createElement('div');
        el.className = 'context-item';
        el.innerHTML = `<span>${item.icon || ''}</span> ${item.label}`;
        el.addEventListener('click', () => { item.action(); this.closeContextMenu(); });
        menu.appendChild(el);
      }
    }
    document.body.appendChild(menu);
    // Position
    let x = e.clientX, y = e.clientY;
    const mw = 180, mh = items.length * 36;
    if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
    if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    setTimeout(() => document.addEventListener('click', () => this.closeContextMenu(), { once: true }), 0);
  },

  closeContextMenu() {
    document.getElementById('contextMenu')?.remove();
  },

  // ---- ALBUM ART ----
  setAlbumArt(src) {
    const img = document.getElementById('albumArtImg');
    const def = document.querySelector('.default-art');
    if (src) {
      img.src = src;
      img.hidden = false;
      def.style.display = 'none';
    } else {
      img.hidden = true;
      def.style.display = '';
    }
  },

  // ---- VISUALIZER DRAW ----
  drawVisualizer(canvas, data, isPlaying) {
    const ctx = canvas.getContext('2d');
    const W   = canvas.width;
    const H   = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!isPlaying || !data) {
      // Draw idle flat line
      ctx.strokeStyle = 'rgba(200,135,58,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();
      return;
    }

    const barW  = W / data.length * 2;
    const gap   = 1;

    for (let i = 0; i < data.length; i++) {
      const pct = data[i] / 255;
      const h   = pct * H;
      const x   = i * (barW + gap);
      const hue = 30 + pct * 60; // amber → gold
      ctx.fillStyle = `hsla(${hue}, 80%, 55%, ${0.4 + pct * 0.6})`;
      ctx.beginPath();
      ctx.roundRect(x, H - h, barW, h, 2);
      ctx.fill();
    }
  },

  // ---- UTILS ----
  esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },

  randomMusicEmoji() {
    const emojis = ['🎵','🎶','🎸','🎹','🥁','🎷','🎺','🎻','🪕','🪗'];
    return emojis[Math.floor(Math.random() * emojis.length)];
  },

  randH() { return 4 + Math.floor(Math.random() * 10); },

  // ---- ALBUM ART FROM CANVAS COLOR ----
  getAverageColor(imgEl) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 10;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgEl, 0, 0, 10, 10);
      const d = ctx.getImageData(0, 0, 10, 10).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
      const px = d.length / 4;
      return `rgb(${r/px|0},${g/px|0},${b/px|0})`;
    } catch { return null; }
  }
};
