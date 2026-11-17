export function connectCaptions(translate, overlay) {
  let enabled = false;
  let current = '';
  let translated = '';
  let video;
  let timer;
  let epoch = 0;

  async function read() {
    if (document.hidden) return;
    if (!video?.isConnected || video.paused) {
      const candidates = [...document.querySelectorAll('video')];
      video = candidates.find(item => !item.paused && item.getBoundingClientRect().width > 0) ||
        candidates.find(item => item.getBoundingClientRect().width > 0);
    }
    const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    const container = video && (video.closest('.html5-video-player') || video.parentElement);
    const youtube = container?.querySelectorAll('.ytp-caption-segment');
    const cues = video ? [...video.textTracks].flatMap(track =>
      track.mode === 'showing' ? Array.from(track.activeCues || [], cue => cue.text || '') : []) : [];
    const text = (youtube?.length ? [...youtube].map(node => node.textContent) : cues).join('\n').trim();
    if (text !== current) {
      current = text;
      translated = '';
      overlay.caption(null, '', fullscreen);
      if (!text) return;
      try {
        const version = epoch;
        const result = await translate(text);
        if (!enabled || version !== epoch || text !== current) return;
        if (result.trim() !== text) translated = result;
      } catch {
        // The player keeps showing its own caption while the API is unavailable.
      }
    }
    if (translated && video) {
      const rect = video.getBoundingClientRect();
      const visible = rect.top < innerHeight && rect.bottom > 0;
      overlay.caption(rect, visible ? translated : '', fullscreen);
    }
  }

  return state => {
    if (state === enabled) return;
    enabled = state;
    epoch++;
    current = translated = '';
    clearInterval(timer);
    if (enabled) {
      timer = setInterval(read, 350);
      read();
    } else {
      overlay.caption(null, '', null);
    }
  };
}
