// nova-helpers — the three local helper services Nova's tools depend on.
//  - :9045  utilities  (weather, translate, qr, tts, define, lyrics, quote, bible)
//  - :9042  YouTube    (search via yt-dlp, download video/audio)
//  - :9043  social     (tiktok, instagram via yt-dlp)
// Each port is an independent Express app so one crash can't take down the rest.
import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

const run = promisify(execFile);
const DL_DIR = '/home/nova/downloads';
fs.mkdirSync(DL_DIR, { recursive: true });
const MAX_BYTES = 60 * 1024 * 1024; // WA media limit headroom

const j = (res, code, obj) => res.status(code).json(obj);

// ── :9045 utilities ─────────────────────────────────────────────
const util = express(); util.use(express.json({ limit: '1mb' }));

util.get('/weather', async (req, res) => {
  const loc = String(req.query.loc || '').slice(0, 80);
  if (!loc) return j(res, 400, { error: 'pass ?loc=' });
  try {
    const { stdout } = await run('curl', ['-s', '--max-time', '15', `https://wttr.in/${encodeURIComponent(loc)}?format=j1`]);
    const d = JSON.parse(stdout);
    const cur = d.current_condition?.[0]; if (!cur) throw new Error('no data');
    const lines = [
      `Now: ${cur.temp_C}°C (feels ${cur.FeelsLikeC}°C), ${cur.weatherDesc[0].value}, humidity ${cur.humidity}%, wind ${cur.windspeedKmph} km/h`,
      ...d.weather.slice(0, 3).map((w) => `${w.date}: ${w.mintempC}–${w.maxtempC}°C, ${w.hourly[4]?.weatherDesc[0].value || ''}`),
    ];
    j(res, 200, { location: d.nearest_area?.[0]?.areaName?.[0]?.value || loc, text: lines.join('\n') });
  } catch (e) { j(res, 502, { error: e.message.slice(0, 200) }); }
});

util.post('/translate', async (req, res) => {
  const { text, to = 'en', from } = req.body || {};
  if (!text) return j(res, 400, { error: 'pass text + to' });
  try {
    // MyMemory free API: from optional (auto-detects)
    const src = from ? `${from}|${to}` : `autodetect|${to}`;
    const { stdout } = await run('curl', ['-s', '--max-time', '20',
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(String(text).slice(0, 480))}&langpair=${src}`]);
    const d = JSON.parse(stdout);
    if (d.responseStatus !== 200) throw new Error(d.responseDetails || 'translate failed');
    j(res, 200, { from: from || 'auto', to, translated: d.responseData.translatedText, extra: d.matches?.[0]?.translation || 'none' });
  } catch (e) { j(res, 502, { error: e.message.slice(0, 200) }); }
});

util.post('/qr', async (req, res) => {
  const data = String(req.body?.data || '').slice(0, 1000);
  if (!data) return j(res, 400, { error: 'pass data' });
  try {
    const file = path.join(DL_DIR, `qr-${Date.now()}.png`);
    await QRCode.toFile(file, data, { width: 512, margin: 2 });
    j(res, 200, { file });
  } catch (e) { j(res, 500, { error: e.message.slice(0, 200) }); }
});

util.post('/tts', async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 180);
  const lang = String(req.body?.lang || 'en').slice(0, 5);
  if (!text) return j(res, 400, { error: 'pass text' });
  try {
    // Google Translate TTS endpoint (free, no key)
    const file = path.join(DL_DIR, `tts-${Date.now()}.mp3`);
    await run('curl', ['-s', '-o', file, '--max-time', '30',
      `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`]);
    const size = fs.statSync(file).size;
    if (size < 500) { fs.unlinkSync(file); throw new Error('TTS backend returned no audio (rate-limited?)'); }
    j(res, 200, { file, size });
  } catch (e) { j(res, 502, { error: e.message.slice(0, 200) }); }
});

util.get('/define', async (req, res) => {
  const word = String(req.query.word || '').slice(0, 40);
  if (!word) return j(res, 400, { error: 'pass ?word=' });
  try {
    const { stdout } = await run('curl', ['-s', '--max-time', '15', `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`]);
    const d = JSON.parse(stdout);
    if (!Array.isArray(d)) throw new Error(d.title || 'not found');
    const e0 = d[0];
    const out = [
      `${e0.word}${e0.phonetic ? '  ' + e0.phonetic : ''}`,
      ...e0.meanings.slice(0, 3).flatMap((m) => m.definitions.slice(0, 2).map((def) => `- (${m.partOfSpeech}) ${def.definition}${def.example ? ` — e.g. "${def.example}"` : ''}`)),
    ];
    j(res, 200, { text: out.join('\n') });
  } catch (e) { j(res, 404, { error: e.message.slice(0, 200) }); }
});

util.post('/lyrics', async (req, res) => {
  const { artist, track } = req.body || {};
  if (!artist || !track) return j(res, 400, { error: 'pass artist + track' });
  try {
    const { stdout } = await run('curl', ['-s', '--max-time', '20',
      `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(track)}`]);
    const d = JSON.parse(stdout);
    if (!d.plainLyrics) throw new Error('no lyrics found');
    j(res, 200, { artist, track: d.trackName || track, text: String(d.plainLyrics).slice(0, 3500) });
  } catch (e) { j(res, 404, { error: e.message.slice(0, 200) }); }
});

util.get('/quote', async (_req, res) => {
  try {
    const { stdout } = await run('curl', ['-s', '--max-time', '15', 'https://zenquotes.io/api/random']);
    const d = JSON.parse(stdout);
    j(res, 200, { text: `"${d[0].q}" — ${d[0].a}` });
  } catch (e) { j(res, 502, { error: e.message.slice(0, 200) }); }
});

util.get('/bible', async (req, res) => {
  const ref = String(req.query.ref || '').slice(0, 60);
  if (!ref) return j(res, 400, { error: 'pass ?ref=' });
  try {
    const { stdout } = await run('curl', ['-s', '--max-time', '15', `https://bible-api.com/${encodeURIComponent(ref)}?translation=kjv`]);
    const d = JSON.parse(stdout);
    if (d.error) throw new Error(d.error);
    j(res, 200, { text: `${d.reference} (KJV): ${d.text.trim().slice(0, 1200)}` });
  } catch (e) { j(res, 404, { error: e.message.slice(0, 200) }); }
});

// ── yt-dlp shared core (:9042 and :9043) ────────────────────────
async function ytdlpSearch(query, limit = 5) {
  const { stdout } = await run('yt-dlp', ['--dump-json', '--no-warnings', '--flat-playlist',
    `ytsearch${limit}:${query}`], { maxBuffer: 20 * 1024 * 1024, timeout: 60000 });
  return stdout.trim().split('\n').filter(Boolean).map((l, i) => {
    const d = JSON.parse(l);
    return { n: i + 1, title: d.title, url: d.url || d.webpage_url, duration: d.duration_string || (d.duration ? Math.round(d.duration / 60) + 'min' : '?'), channel: d.channel || d.uploader, views: d.view_count ? d.view_count.toLocaleString() : '', published: d.release_timestamp ? new Date(d.release_timestamp * 1000).toISOString().slice(0, 10) : '' };
  });
}

const COOKIES_FILE = '/home/nova/yt-cookies.txt'; // owner can drop cookies here to unlock downloads
function ytdlpArgs(extra) {
  const args = ['--no-warnings', '--no-playlist'];
  if (fs.existsSync(COOKIES_FILE)) args.push('--cookies', COOKIES_FILE);
  else args.push('--extractor-args', 'youtube:player_client=android,web_safari,tv');
  return [...args, ...extra];
}
async function ytdlpDownload(url, want) {
  const stamp = Date.now();
  const outTpl = path.join(DL_DIR, `dl-${stamp}.%(ext)s`);
  const format = want === 'audio'
    ? 'bestaudio[ext=m4a]/bestaudio/best[ext=mp4]/best'
    : 'best[height<=720][ext=mp4]/best[height<=720]/best';
  const { stdout } = await run('yt-dlp', ytdlpArgs(['-f', format,
    '--max-filesize', String(MAX_BYTES), '-o', outTpl, url]), { timeout: 280000, maxBuffer: 10 * 1024 * 1024 });
  const files = fs.readdirSync(DL_DIR).filter((f) => f.startsWith(`dl-${stamp}.`)).map((f) => path.join(DL_DIR, f));
  if (!files.length) return { error: 'download failed or file too big (60MB cap) — try audio instead' };
  const file = files[0];
  const size = fs.statSync(file).size;
  if (size > MAX_BYTES) { fs.unlinkSync(file); return { error: 'file too big to send in chat — get the link instead' }; }
  return { file, bytes: size, size, title: (stdout.match(/Destination.*|\[download\]/) ? undefined : undefined) || undefined };
}

// ── :9042 YouTube ───────────────────────────────────────────────
const yt = express(); yt.use(express.json({ limit: '1mb' }));
yt.get('/search', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 120);
  if (!q) return j(res, 400, { error: 'pass ?q=' });
  try { j(res, 200, { results: await ytdlpSearch(q, Math.min(parseInt(req.query.limit) || 5, 10)) }); }
  catch (e) { j(res, 502, { error: e.stderr?.slice(0, 200) || e.message.slice(0, 200) }); }
});
yt.post('/download', async (req, res) => {
  const { url, want = 'video' } = req.body || {};
  if (!/^https?:\/\//.test(String(url))) return j(res, 400, { error: 'pass url' });
  try {
    const r = await ytdlpDownload(url, want === 'audio' ? 'audio' : 'video');
    if (r.error) return j(res, 502, r);
    const meta = await run('yt-dlp', ['--dump-json', '--no-warnings', '--no-playlist', String(url)], { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }).catch(() => null);
    const title = meta ? JSON.parse(meta.stdout).title : undefined;
    j(res, 200, { ...r, title, filename: path.basename(r.file), tooBig: false });
  } catch (e) {
    const raw = (e.stderr || e.message || '').slice(0, 300);
    if (/not a bot|sign in/i.test(raw)) return j(res, 502, { error: 'YouTube is blocking downloads from this server (bot check). Search still works — give the user the link instead, or ask the owner to add YouTube cookies.' });
    j(res, 502, { error: raw });
  }
});

// ── :9043 tiktok / instagram ────────────────────────────────────
const social = express(); social.use(express.json({ limit: '1mb' }));
social.post('/tiktok', async (req, res) => {
  const { url, want = 'video' } = req.body || {};
  if (!/^https?:\/\//.test(String(url))) return j(res, 400, { error: 'pass url' });
  try { j(res, 200, { ...(await ytdlpDownload(url, want === 'audio' ? 'audio' : 'video')), tooBig: false }); }
  catch (e) { j(res, 502, { error: (e.stderr || e.message).slice(0, 200) }); }
});
social.post('/instagram', async (req, res) => {
  const { url, want = 'video' } = req.body || {};
  if (!/^https?:\/\//.test(String(url))) return j(res, 400, { error: 'pass url' });
  try { j(res, 200, { ...(await ytdlpDownload(url, want === 'audio' ? 'audio' : 'video')), tooBig: false }); }
  catch (e) { j(res, 502, { error: (e.stderr || e.message).slice(0, 200) }); }
});

const start = (app, port, name) => app.listen(port, () => console.log(`[nova-helpers] ${name} on :${port}`));
start(util, 9045, 'utilities');
start(yt, 9042, 'youtube');
start(social, 9043, 'social');
