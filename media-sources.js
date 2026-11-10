// A browser name is not a website identity. Only matching, fresh media metadata earns a site logo.
const SOURCES = {
  spotify: ['Spotify', 'spotify'], youtube: ['YouTube', 'youtube'], 'youtube-music': ['YouTube Music', 'youtubemusic'],
  apple: ['Apple Music', 'applemusic'], soundcloud: ['SoundCloud', 'soundcloud'], vimeo: ['Vimeo', 'vimeo'],
  twitch: ['Twitch', 'twitch'], vlc: ['VLC', 'vlcmediaplayer'], chrome: ['Chrome', 'googlechrome'],
  opera: ['Opera GX', 'opera'], msedge: ['Edge', 'microsoftedge'], firefox: ['Firefox', 'firefoxbrowser'], brave: ['Brave', 'brave'],
};
const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function source(id) {
  const [name, icon] = SOURCES[id] || ['Media', 'media'];
  return { id, name, icon: `assets/media/${icon}.svg` };
}
function browserOf(app) {
  const id = String(app || '').toLowerCase();
  return ['opera', 'msedge', 'brave', 'chrome', 'firefox'].find(key => id.includes(key)) || (id === '308046b0af4a39cb' ? 'firefox' : '');
}
function siteOf(host) {
  return ({'open.spotify.com':'spotify', 'youtube.com':'youtube', 'www.youtube.com':'youtube', 'music.youtube.com':'youtube-music',
    'music.apple.com':'apple', 'soundcloud.com':'soundcloud', 'www.soundcloud.com':'soundcloud', 'vimeo.com':'vimeo',
    'www.vimeo.com':'vimeo', 'twitch.tv':'twitch', 'www.twitch.tv':'twitch'})[host] || '';
}
function resolve(media, reports = [], now = Date.now()) {
  if (!media?.has) return null;
  const app = String(media.app || '').toLowerCase();
  const browser = browserOf(app);
  if (!browser) return source(app.includes('spotify') ? 'spotify' : /applemusic/.test(app) ? 'apple' : app.includes('vlc') ? 'vlc' : 'media');
  const title = norm(media.title), artist = norm(media.artist);
  const matches = reports.filter(report => report.browser === browser && now - report.received < 35000 && now >= report.received)
    .flatMap(report => report.tabs).filter(tab => {
      if (!title || !siteOf(tab.host)) return false;
      if (norm(tab.title) === title) return !artist || !tab.artist || norm(tab.artist) === artist;
      return title.length >= 6 && norm(tab.pageTitle).includes(title);
    });
  const sites = new Set(matches.map(tab => siteOf(tab.host)));
  return source(sites.size === 1 ? [...sites][0] : browser);
}
module.exports = { source, resolve, browserOf, siteOf, norm };
