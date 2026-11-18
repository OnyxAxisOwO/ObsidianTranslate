function findVideo() {
  const videos = [...document.querySelectorAll('video')].filter(video => video.getBoundingClientRect().width > 0);
  return videos.find(video => !video.paused) || videos[0];
}

function subtitleTrack(video) {
  return [...video.textTracks].find(track =>
    ['captions', 'subtitles'].includes(track.kind) && track.mode === 'showing');
}

const captionNodes = '.ytp-caption-window-container,.caption-window,.ytp-caption-segment';

function touchesCaptions(records, player) {
  return records.some(record => {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest(captionNodes) || (record.type === 'attributes' && target === player)) return true;
    if (record.type !== 'childList') return false;
    return [...record.addedNodes, ...record.removedNodes].some(node =>
      node instanceof Element && (node.matches(captionNodes) || node.querySelector(captionNodes)));
  });
}

function playerCaption(container) {
  const lines = [];
  let bounds = null;
  for (const segment of container?.querySelectorAll('.ytp-caption-segment') || []) {
    const { top, bottom, left, right, width, height } = segment.getBoundingClientRect();
    const text = segment.textContent.trim();
    if (!text || !width || !height || getComputedStyle(segment).visibility === 'hidden') continue;
    lines.push(text);
    if (!bounds) bounds = { top, bottom, left, right };
    else {
      bounds.top = Math.min(bounds.top, top);
      bounds.bottom = Math.max(bounds.bottom, bottom);
      bounds.left = Math.min(bounds.left, left);
      bounds.right = Math.max(bounds.right, right);
    }
  }
  return { text: lines.join('\n'), bounds };
}

function plainCue(text) {
  return text.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|nbsp);/g, entity =>
    ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[entity]).trim();
}

function nextCues(track, time) {
  const cues = track.cues || [];
  let low = 0;
  let high = cues.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cues[middle].startTime <= time) low = middle + 1;
    else high = middle;
  }
  return Array.from({ length: Math.min(3, cues.length - low) }, (_, i) => plainCue(cues[low + i].text || ''))
    .filter(Boolean);
}

function stamp(seconds) {
  const millis = Math.max(0, Math.round(seconds * 1000));
  const fields = [Math.floor(millis / 3600000), Math.floor(millis / 60000) % 60, Math.floor(millis / 1000) % 60];
  return fields.map(value => String(value).padStart(2, '0')).join(':') + ',' + String(millis % 1000).padStart(3, '0');
}

export function formatSrt(cues, translations) {
  return cues.map(({ start, end, text }, index) => {
    const translated = translations[index];
    const lines = translated && translated !== text ? text + '\n' + translated : text;
    return (index + 1) + '\n' + stamp(start) + ' --> ' + stamp(end) + '\n' + lines.replace(/\n{2,}/g, '\n') + '\n';
  }).join('\n');
}

export function connectCaptions(translate, overlay) {
  let enabled = false;
  let timer;
  let video;
  let player;
  let track;
  let originalBounds;
  let events;
  let mediaEvents;
  let current = [];
  let result = '';
  let collected = new Map();
  let observedCue;
  let previousTime;
  let loaded = new Map();
  let pending = new Map();
  const observer = new MutationObserver(records => {
    if (touchesCaptions(records, player)) read();
  });

  function reset() {
    current = [];
    result = '';
    observedCue = undefined;
    previousTime = undefined;
    collected = new Map();
    loaded = new Map();
    pending = new Map();
  }

  function translateCues(texts) {
    const cache = loaded;
    const requests = pending;
    const missing = [...new Set(texts)].filter(text => !cache.has(text) && !requests.has(text));
    if (missing.length) {
      const task = Promise.resolve().then(() => translate(missing)).catch(error => missing.map(() => ({ error: error.message })));
      missing.forEach((text, index) => requests.set(text, task.then(outcomes => {
        requests.delete(text);
        const outcome = outcomes[index] || { error: '没有收到该条字幕的译文。' };
        if (!outcome.error) {
          if (cache.size >= 5000) cache.delete(cache.keys().next().value);
          cache.set(text, outcome);
        }
        return outcome;
      })));
    }
    return Promise.all(texts.map(text => cache.get(text) || requests.get(text)));
  }

  function observe(text, time) {
    const progressed = previousTime === undefined || (time >= previousTime - .25 && time <= previousTime + 2);
    if (!progressed || observedCue?.text !== text) {
      if (observedCue && progressed && time > observedCue.start) observedCue.end = time;
      observedCue = undefined;
      if (text && Number.isFinite(time) && collected.size < 5000) {
        const key = Math.round(time * 10) + ':' + text;
        observedCue = collected.get(key) || { start: time, end: time + .35, text };
        collected.set(key, observedCue);
      }
    }
    if (observedCue) observedCue.end = Math.max(observedCue.end, time + .25);
    previousTime = time;
  }

  function draw(fullscreen) {
    if (!result || !video) {
      overlay.caption(null, '', fullscreen);
      return;
    }
    const rect = video.getBoundingClientRect();
    const visible = rect.top < innerHeight && rect.bottom > 0;
    overlay.caption(rect, visible ? result : '', fullscreen, originalBounds);
  }

  function watchVideo(found) {
    if (found !== video) {
      mediaEvents?.abort();
      track?.removeEventListener('cuechange', read);
      track = undefined;
      video = found;
      reset();
      if (video) {
        mediaEvents = new AbortController();
        const { signal } = mediaEvents;
        for (const event of ['seeking', 'seeked', 'loadedmetadata', 'emptied']) {
          video.addEventListener(event, read, { signal });
        }
        for (const event of ['change', 'addtrack', 'removetrack']) {
          video.textTracks.addEventListener(event, read, { signal });
        }
      }
    }
    const container = video?.closest('.html5-video-player');
    if (container === player) return;
    observer.disconnect();
    player = container;
    if (player) observer.observe(player, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
  }

  function read() {
    if (!enabled) return;
    const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (document.hidden) {
      if (current.length) {
        current = [];
        result = '';
        overlay.caption(null, '', fullscreen);
      }
      return;
    }
    const found = video?.isConnected && !video.paused ? video : findVideo();
    watchVideo(found);
    const selectedTrack = video && subtitleTrack(video);
    if (selectedTrack !== track) {
      track?.removeEventListener('cuechange', read);
      track = selectedTrack;
      track?.addEventListener('cuechange', read);
    }
    const original = playerCaption(video?.seeking ? null : player || video?.parentElement);
    originalBounds = original.bounds;
    const active = track?.activeCues ? Array.from(track.activeCues, cue => plainCue(cue.text || '')).filter(Boolean) : [];
    const visible = original.text;
    const texts = video?.seeking ? [] : active.length ? active : visible ? [visible] : [];
    if (video && !track?.cues?.length) observe(visible, video.currentTime);
    if (texts.length !== current.length || texts.some((text, i) => text !== current[i])) {
      current = texts;
      result = '';
      if (texts.length) {
        const inView = texts;
        translateCues(texts).then(outcomes => {
          if (!enabled || document.hidden || current !== inView) return;
          read();
          if (current !== inView) return;
          result = outcomes.map((outcome, i) => outcome.text !== inView[i] ? outcome.text : '').filter(Boolean).join('\n');
          draw(document.fullscreenElement || document.webkitFullscreenElement);
          if (track && video) translateCues(nextCues(track, video.currentTime)).catch(() => {});
        }).catch(() => {});
      }
    }
    draw(fullscreen);
  }

  function setEnabled(state) {
    if (state === enabled) return;
    enabled = state;
    clearInterval(timer);
    if (enabled) {
      reset();
      events = new AbortController();
      const { signal } = events;
      window.addEventListener('resize', read, { signal });
      window.addEventListener('scroll', read, { capture: true, passive: true, signal });
      for (const event of ['fullscreenchange', 'webkitfullscreenchange', 'visibilitychange']) {
        document.addEventListener(event, read, { signal });
      }
      timer = setInterval(read, 350);
      read();
    } else {
      events.abort();
      watchVideo(undefined);
      originalBounds = null;
      overlay.caption(null, '', null);
    }
  }

  async function exportSrt(progress) {
    const player = video?.isConnected ? video : findVideo();
    if (!player) throw new Error('当前网页中找不到可见的视频。');
    const track = subtitleTrack(player);
    const full = !!track?.cues?.length;
    const cues = full ? Array.from(track.cues, cue => ({
      start: cue.startTime, end: cue.endTime, text: plainCue(cue.text || ''),
    })) : [...collected.values()].sort((a, b) => a.start - b.start);
    const usable = cues.filter(cue => cue.text && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start);
    if (!usable.length) throw new Error('请先打开视频原字幕。没有可读取的字幕轨时，开启双语字幕并播放一段后再导出。');
    if (usable.length > 5000) throw new Error('字幕轨超过 5000 条，请分段处理。');
    const cache = loaded;
    const translations = [];
    for (let offset = 0; offset < usable.length; offset += 8) {
      if (cache !== loaded) throw new Error('视频或翻译设置已更改，请重新导出。');
      progress(offset, usable.length);
      const items = usable.slice(offset, offset + 8);
      const outcomes = await translateCues(items.map(item => item.text));
      for (const outcome of outcomes) {
        if (outcome.error) throw new Error(outcome.error);
        translations.push(outcome.text);
      }
    }
    if (cache !== loaded) throw new Error('视频或翻译设置已更改，请重新导出。');
    return { text: formatSrt(usable, translations), full, count: usable.length };
  }

  return { setEnabled, exportSrt };
}
