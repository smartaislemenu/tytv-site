/** Local persistence for playlists, favorites, profiles, settings (browser). */
const KEY = 'tytv_watch_v1';

const defaults = () => ({
  playlists: [],
  favorites: [],
  profiles: [{ id: 'default', name: 'You', color: 0x3b82ff, kids: false }],
  activeProfileId: 'default',
  theme: 'Neon Blue',
  homeLayout: 'featured', // featured | classic
  lastChannelKey: '',
  resume: [], // { key, title, url, pos, updated }
});

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    return defaults();
  }
}

export function save(state) {
  const slim = {
    playlists: state.playlists,
    favorites: state.favorites,
    profiles: state.profiles,
    activeProfileId: state.activeProfileId,
    theme: state.theme,
    homeLayout: state.homeLayout,
    lastChannelKey: state.lastChannelKey,
    resume: (state.resume || []).slice(0, 20),
  };
  localStorage.setItem(KEY, JSON.stringify(slim));
}

export function uid(prefix = 'p') {
  return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
