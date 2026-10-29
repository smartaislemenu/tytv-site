/**
 * HLS / native playback with mixed-content and CORS detection.
 * No stream proxy — browsers that block http-on-https or CORS get a friendly message.
 */

let hls = null;
let videoEl = null;

export function attachVideo(el) {
  videoEl = el;
}

export function stop() {
  if (hls) {
    try {
      hls.destroy();
    } catch {
      /* ignore */
    }
    hls = null;
  }
  if (videoEl) {
    videoEl.removeAttribute('src');
    videoEl.load();
  }
}

function isMixedContent(url) {
  if (typeof location === 'undefined') return false;
  if (location.protocol !== 'https:') return false;
  try {
    const u = new URL(url, location.href);
    return u.protocol === 'http:';
  } catch {
    return false;
  }
}

function looksLikeHls(url) {
  const p = url.split('?')[0].toLowerCase();
  return p.endsWith('.m3u8') || p.includes('.m3u8');
}

/**
 * @returns {Promise<{ ok: boolean, error?: string, reason?: string }>}
 */
export function play(url, { userAgent } = {}) {
  stop();
  if (!videoEl) return Promise.resolve({ ok: false, error: 'No player element' });
  if (!url) return Promise.resolve({ ok: false, error: 'No stream URL' });

  if (isMixedContent(url)) {
    return Promise.resolve({
      ok: false,
      reason: 'mixed_content',
      error: "This stream can't play in a browser — use the TV app",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const onError = (msg, reason) => {
      stop();
      done({ ok: false, error: msg, reason });
    };

    videoEl.onerror = () => {
      onError("This stream can't play in a browser — use the TV app", 'media_error');
    };
    videoEl.onplaying = () => done({ ok: true });

    // Native HLS (Safari)
    if (videoEl.canPlayType('application/vnd.apple.mpegurl') && looksLikeHls(url)) {
      videoEl.src = url;
      videoEl.play().catch(() => {});
      setTimeout(() => {
        if (!settled && videoEl.readyState >= 2) done({ ok: true });
      }, 4000);
      return;
    }

    // hls.js
    if (window.Hls && window.Hls.isSupported() && looksLikeHls(url)) {
      hls = new window.Hls({
        enableWorker: true,
        maxBufferLength: 30,
        xhrSetup: userAgent
          ? (xhr) => {
              try {
                xhr.setRequestHeader('User-Agent', userAgent);
              } catch {
                /* browsers block UA override */
              }
            }
          : undefined,
      });
      hls.loadSource(url);
      hls.attachMedia(videoEl);
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch(() => {});
      });
      hls.on(window.Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        let reason = 'hls_error';
        let msg = "This stream can't play in a browser — use the TV app";
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          reason = 'cors_or_network';
          msg = "This stream can't play in a browser — use the TV app";
        }
        onError(msg, reason);
      });
      setTimeout(() => {
        if (!settled) done({ ok: true }); // may still be buffering
      }, 8000);
      return;
    }

    // Progressive / other
    videoEl.src = url;
    videoEl.play().catch(() => onError("This stream can't play in a browser — use the TV app", 'play_rejected'));
    setTimeout(() => {
      if (!settled && videoEl.error) {
        onError("This stream can't play in a browser — use the TV app", 'media_error');
      } else if (!settled) done({ ok: true });
    }, 5000);
  });
}

export function currentTime() {
  return videoEl ? videoEl.currentTime : 0;
}

export function setCurrentTime(t) {
  if (videoEl) videoEl.currentTime = t;
}

export function togglePause() {
  if (!videoEl) return;
  if (videoEl.paused) videoEl.play().catch(() => {});
  else videoEl.pause();
}

export function isPaused() {
  return !videoEl || videoEl.paused;
}
