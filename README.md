# ✌ GrooveBox — Vintage Hippie Music Player

A full-featured, aesthetic music player for your personal collection.  
Built with pure HTML/CSS/JS — no frameworks, no dependencies, no server required.  
Your music is **stored forever** in your browser's IndexedDB — it survives page refreshes and browser restarts.

---

<img width="1915" height="904" alt="Screenshot 2026-06-18 094321" src="https://github.com/user-attachments/assets/6fcee817-6083-450c-a040-45dd6307f044" />
<img width="1884" height="897" alt="Screenshot 2026-06-18 094306" src="https://github.com/user-attachments/assets/dace845c-3384-41ea-b097-d43bcf39ac5b" />
<img width="1914" height="910" alt="Screenshot 2026-06-18 094243" src="https://github.com/user-attachments/assets/aecf206f-327e-4895-86a4-8170db2557f5" />


## ✦ Features

| Feature | Description |
|---|---|
| 📁 Add Music | Drag & drop or click "Add Tracks" — supports MP3, WAV, OGG, FLAC, AAC, M4A |
| 💾 Persistent Library | All tracks stored in IndexedDB — your music stays forever |
| 🎨 Album Art | Auto-extracts cover art from ID3 tags; shows as rotating vinyl |
| 🎵 Full Playback | Play, Pause, Next, Previous, Seek |
| 🔀 Shuffle | Randomized playback |
| 🔁 Repeat | Repeat off / Repeat all / Repeat one |
| ✂ Trim | Trim any track to a specific start/end time with waveform preview |
| 📊 Equalizer | 5-band EQ (60Hz, 250Hz, 1kHz, 4kHz, 16kHz) + presets |
| 🎸 Bass Boost | One-click low-shelf bass enhancement |
| ⏩ Playback Speed | 0.5× to 3× with custom slider |
| 🔊 Volume | Smooth volume slider + mute toggle |
| 🔍 Search | Real-time search across track name and artist |
| ↕ Sort | Sort by Recently Added, Name, Artist, or Duration |
| ♥ Favorites | Heart any track to save it to your favorites |
| 📋 Queue | Drag-aware play queue — add/remove tracks |
| 🎶 Playlists | Create named playlists and add tracks |
| 📈 Visualizer | Real-time frequency visualizer (Web Audio API) |
| ⌨ Shortcuts | Keyboard controls (see below) |
| 🖱 Context Menu | Right-click any track for full actions menu |

---

## 🎹 Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `→` | Seek +5 seconds |
| `←` | Seek -5 seconds |
| `↑` | Volume up |
| `↓` | Volume down |
| `N` | Next track |
| `P` | Previous track |
| `S` | Toggle shuffle |
| `R` | Cycle repeat mode |
| `M` | Mute / unmute |

---

## 🚀 Running Locally

### Option 1 — Open directly (simplest)
Just open `index.html` in your browser.  
> ⚠️ Some browsers restrict `file://` audio loading. If you hit issues, use Option 2.

### Option 2 — Serve locally (recommended)
```bash
npm install
npm start
```
Then open: http://localhost:3000

### Option 3 — Python server
```bash
python3 -m http.server 3000
```
Then open: http://localhost:3000

---

## 🌐 Deploying

This is a **100% static site** — deploy anywhere:

### Netlify (drag & drop)
1. Go to [netlify.com/drop](https://app.netlify.com/drop)
2. Drag the entire `music-player/` folder onto the page
3. Done — live URL instantly!

### Vercel
```bash
npx vercel
```

### GitHub Pages
Push to GitHub, enable Pages from Settings → Pages → main branch.

### Any static host
Upload all files to any CDN, shared hosting, or object storage bucket.

---

## 🎨 Design

- **Aesthetic:** Psychedelic 70s, warm amber & plum, film grain
- **Fonts:** Special Elite (display), Playfair Display (body), Caveat (handwritten), DM Mono (data)
- **Colors:** Cream `#F5EDD8` · Amber `#C8873A` · Mauve `#8C5F6D` · Plum `#3D2645` · Gold `#D4A843`
- **Audio:** Web Audio API — MediaElementSource → EQ chain → BiquadFilter → GainNode → AnalyserNode
- **Storage:** IndexedDB (tracks as base64 blobs, playlists, favorites, settings)

---

## 🛠 Technical Notes

- **No server required** — everything runs in the browser
- **No external dependencies** — pure Web APIs only
- **Audio stored as base64** in IndexedDB for full persistence
- **ID3 tag parsing** — extracts embedded album art from MP3s
- **CORS-safe** — no external audio requests
- **Mobile-friendly** — responsive layout down to 380px

---

*✌ peace · love · music*
