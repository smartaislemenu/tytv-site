/**
 * HLS / MPEG-TS / native playback with mixed-content and CORS detection.
 * No stream proxy — browsers that block http-on-https or CORS get a friendly message.
 */

let hls = null;
let mpegtsPlayer = null;
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
  if (mpegtsPlayer) {
    try {
      mpegtsPlayer.pause();
      mpegtsPlayer.unload();
      mpegtsPlayer.detachMediaElement();
      mpegtsPlayer.destroy();
    } catch {
      /* ignore */
    }
    mpegtsPlayer = null;
  }
  if (videoEl) {
    videoEl.removeAttribute('src');
    try {
      videoEl.load();
    } catch {
      /* ignore */
    }
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

function looksLikeMpegTs(url) {
  const p = url.split('?')[0].toLowerCase();
  // raw .ts segment playlists are HLS; lone .ts / mpegts paths often need mpegts.js
  if (p.endsWith('.m3u8')) return false;
  return p.endsWith('.ts') || p.includes('mpegts') || p.includes('/ts/') || /[?&]format=ts\b/i.test(url);
}

const BROWSER_MSG = "This stream can't play in a browser — use the TV app";

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
      error: BROWSER_MSG,
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
      onError(BROWSER_MSG, 'media_error');
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
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          reason = 'cors_or_network';
        }
        onError(BROWSER_MSG, reason);
      });
      setTimeout(() => {
        if (!settled) done({ ok: true }); // may still be buffering
      }, 8000);
      return;
    }

    // mpegts.js for MPEG-TS / raw .ts live-style URLs
    if (
      looksLikeMpegTs(url) &&
      window.mpegts &&
      window.mpegts.getFeatureList &&
      window.mpegts.getFeatureList().mseLivePlayback
    ) {
      try {
        mpegtsPlayer = window.mpegts.createPlayer(
          { type: 'mse', isLive: true, url },
          { enableWorker: true, stashInitialSize: 128 }
        );
        mpegtsPlayer.attachMediaElement(videoEl);
        mpegtsPlayer.load();
        mpegtsPlayer.play().catch(() => {});
        mpegtsPlayer.on(window.mpegts.Events.ERROR, () => {
          onError(BROWSER_MSG, 'mpegts_error');
        });
        setTimeout(() => {
          if (!settled) done({ ok: true });
        }, 8000);
        return;
      } catch {
        /* fall through */
      }
    }

    // Progressive MP4 / other
    videoEl.src = url;
    videoEl.play().catch(() => onError(BROWSER_MSG, 'play_rejected'));
    setTimeout(() => {
      if (!settled && videoEl.error) {
        onError(BROWSER_MSG, 'media_error');
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
