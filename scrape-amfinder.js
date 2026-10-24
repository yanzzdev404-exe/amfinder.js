#!/usr/bin/env node
"use strict";

/**
 * AM Preset Finder — KEREN EDITION
 * Creator : Yann (original) | UI Remake: Dragon
 * Source  : https://whatsapp.com/channel/0029Vb68541LNSa1fNymTW13
 * Base Web: https://amfinder.web.id
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const VERSION = "1.0.0-keren";
const BASE = "https://amfinder.web.id";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36";
const CHALLENGEKY = ["/api/v/2b51359f"];
const HANDSHAKE_TIMEOUT = 15000;
const SSE_MAX_MS = 150000;
const HTTP_RETRY_MAX = 3;
const TOP_DEFAULT = 5;
const DELAY_DEFAULT = 1500;

// ========== WARNA ANSI ==========
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clampN = (v) => Math.max(1, Math.min(10000, Math.floor(Number(v) || 1)));
let QUIET = false;

function log() {
  const s = Array.prototype.join.call(arguments, " ");
  if (!QUIET) process.stderr.write(s + "\n");
}
function prog(s) {
  if (!QUIET) process.stderr.write("\r" + s);
}

function fail(msg) {
  process.stderr.write(`${C.red}${C.bold}[✗] ERROR:${C.reset} ${msg}\n`);
  process.exitCode = 1;
}

// ========== BANNER ==========
function banner() {
  console.log(`
${C.cyan}${C.bold}╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   ${C.yellow}██████╗ ██████╗ ███████╗███████╗████████╗${C.cyan}           ║
║   ${C.yellow}██╔══██╗██╔══██╗██╔════╝██╔════╝╚══██╔══╝${C.cyan}           ║
║   ${C.yellow}██████╔╝██████╔╝█████╗  ███████╗   ██║${C.cyan}              ║
║   ${C.yellow}██╔═══╝ ██╔══██╗██╔══╝  ╚════██║   ██║${C.cyan}              ║
║   ${C.yellow}██║     ██║  ██║███████╗███████║   ██║${C.cyan}              ║
║   ${C.yellow}╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝${C.cyan}              ║
║                                                          ║
║   ${C.magenta}AM Preset Finder${C.cyan} ${C.dim}v${VERSION}${C.cyan}                          ║
║   ${C.green}Scraper by Yann${C.cyan} | ${C.green}UI by Dragon${C.cyan}                  ║
╚══════════════════════════════════════════════════════════╝${C.reset}
`);
}

// ========== SPINNER ==========
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerIdx = 0;
let spinnerTimer = null;

function startSpinner(msg) {
  if (QUIET) return;
  spinnerTimer = setInterval(() => {
    process.stderr.write(`\r${C.cyan}${SPINNER[spinnerIdx]}${C.reset} ${msg}...   `);
    spinnerIdx = (spinnerIdx + 1) % SPINNER.length;
  }, 80);
}
function stopSpinner() {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
    process.stderr.write("\r" + " ".repeat(80) + "\r");
  }
}

// ========== PROGRESS BAR ==========
function progressBar(current, total, width = 30) {
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(width * pct);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return `${C.green}${bar}${C.reset} ${C.yellow}${(pct * 100).toFixed(1)}%${C.reset}`;
}

// ========== DEVICE ID ==========
function deviceFile() {
  return path.join(__dirname, ".amfinder-device");
}
function readDevice() {
  try {
    const v = fs.readFileSync(deviceFile(), "utf8").trim();
    if (v.length >= 8) return v;
  } catch (_) {}
  return null;
}
function saveDevice(v) {
  try {
    fs.writeFileSync(deviceFile(), v, "utf8");
  } catch (_) {}
}
function newDevice() {
  const v = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  saveDevice(v);
  return v;
}

// ========== API ERROR ==========
class ApiError extends Error {
  constructor(msg, { status, retryable } = {}) {
    super(msg);
    this.name = "ApiError";
    this.status = status;
    this.retryable = Boolean(retryable);
  }
}
const RETRY_RE = /coba lagi|try again|429|terlalu banyak|too many|timed out|timeout|server|sebentar/i;
function retryableMsg(msg) {
  return RETRY_RE.test(String(msg || ""));
}

// ========== HANDSHAKE ==========
function postRaw(challengePath, body) {
  return axios({
    method: "POST",
    url: BASE + challengePath,
    data: body,
    timeout: HANDSHAKE_TIMEOUT,
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Origin": BASE,
      "Referer": BASE + "/",
    },
    validateStatus: () => true,
  })
    .then((r) => ({ status: r.status, json: r.data }))
    .catch((e) => {
      throw new ApiError(
        "handshake HTTP error: " + (e.code || e.message),
        { status: e.response ? e.response.status : 0, retryable: !(e.response && e.response.status < 400) }
      );
    });
}

async function subtleHmacRound(saltHex, payload) {
  const subtle = crypto.webcrypto ? crypto.webcrypto.subtle : globalThis.crypto.subtle;
  const key = await subtle.importKey(
    "raw",
    Buffer.from(saltHex, "hex"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return Buffer.from(await subtle.sign("HMAC", key, payload));
}

function proofOf(salt, cid, did, ts, rounds) {
  const n = clampN(rounds);
  let msg = Promise.resolve(Buffer.from(cid + "|" + did + "|" + ts));
  for (let i = 0; i < n; i++) msg = msg.then((buf) => subtleHmacRound(salt, buf));
  return msg.then((buf) => buf.toString("hex"));
}

async function handshakeOnce(challengePath) {
  const did = readDevice() || newDevice();
  const s1 = await postRaw(challengePath, { did });
  const j1 = s1.json || {};
  if (s1.status !== 200 || j1.ok !== true) {
    throw new ApiError(j1.error || "handshake gagal (HTTP " + s1.status + ")", {
      status: s1.status,
      retryable: s1.status === 403 || s1.status === 429 || s1.status >= 500,
    });
  }
  const proof = await proofOf(j1.salt, j1.cid, did, j1.ts, j1.rounds);
  const s2 = await postRaw(challengePath, {
    cid: j1.cid,
    did,
    ts: j1.ts,
    proof,
    score: 0,
    reasons: [],
  });
  const j2 = s2.json || {};
  if (s2.status !== 200 || j2.ok !== true || !j2.token) {
    throw new ApiError(j2.error || "handshake gagal (HTTP " + s2.status + ")", {
      status: s2.status,
      retryable: s2.status === 403 || s2.status === 429 || s2.status >= 500,
    });
  }
  return j2.token;
}

async function discoverChallenges() {
  const found = new Set(CHALLENGEKY);
  try {
    const home = await axios({
      method: "GET",
      url: BASE + "/",
      timeout: 12000,
      headers: { "User-Agent": UA },
      validateStatus: () => true,
    });
    const html = typeof home.data === "string" ? home.data : "";
    html.match(/\/_next\/static\/chunks\/[^"']+\.js/g)
      .slice(0, 12)
      .forEach((f) => {
        const p = f.startsWith("http") ? f : BASE + (f.startsWith("/") ? f : "/" + f);
        (async () => {
          try {
            const r = await axios({ url: p, timeout: 12000, headers: { "User-Agent": UA }, validateStatus: () => true });
            if (typeof r.data === "string") {
              (String(r.data).match(/\/api\/v\/[0-9a-f]{8}/g) || []).forEach((c) => found.add(c));
            }
          } catch (_) {}
        })();
      });
  } catch (_) {}
  return Array.from(found);
}

async function getHandshakeToken() {
  let list = CHALLENGEKY.slice();
  let last = null;
  for (let pass = 0; pass < 4; pass++) {
    for (const cpath of list) {
      try {
        startSpinner(`${C.cyan}Bot-check handshake${C.reset}`);
        const token = await handshakeOnce(cpath);
        stopSpinner();
        log(`${C.green}${C.bold}[✓]${C.reset} Handshake OK ${C.dim}(${cpath})${C.reset}`);
        return token;
      } catch (e) {
        stopSpinner();
        last = e;
        if (e && e.status === 403) {
          log(`${C.yellow}${C.bold}[!]${C.reset} Forbidden — ganti device ID...`);
          newDevice();
          await sleep(5000);
        } else if (e && e.status === 429) {
          log(`${C.yellow}${C.bold}[!]${C.reset} Rate limited — tunggu 8 detik...`);
          await sleep(8000);
        } else if (e && e.status >= 500) {
          log(`${C.yellow}${C.bold}[!]${C.reset} Server error — tunggu 3 detik...`);
          await sleep(3000);
        } else if (pass === 0 && list.length === CHALLENGEKY.length) {
          list = await discoverChallenges();
          if (!list.length) list = CHALLENGEKY.slice();
        } else break;
      }
    }
  }
  throw last || new ApiError("handshake gagal", {});
}

// ========== SSE STREAM ==========
function parseSseBlock(block) {
  let ev = "message";
  const datas = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) ev = line.slice(6).trim() || "message";
    else if (line.startsWith("data:")) datas.push(line.slice(5).trim());
  }
  return datas.length ? { event: ev, data: datas.join("\n") } : null;
}

function sseRun(ssePath) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let buf = "";
    let fulfilled = false;
    const acc = { logs: [], candidates: null, result: null, error: null };
    let killer = null;

    axios({
      method: "GET",
      url: BASE + ssePath,
      responseType: "stream",
      timeout: 0,
      headers: {
        "User-Agent": UA,
        "Accept": "text/event-stream",
        "Cache-Control": "no-cache",
        "Referer": BASE + "/",
      },
      validateStatus: () => true,
    })
      .then((res) => {
        if (res.status !== 200) {
          let txt = "";
          res.data.on("data", (c) => {
            txt += c.toString();
            if (txt.length > 400) res.data.destroy();
          });
          res.data.on("end", done);
          res.data.on("error", done);
          res.data.on("close", done);
          return;
        }
        let closed = false;
        function finish() {
          fulfilled = true;
          clearTimeout(killer);
          try { res.data.destroy(); } catch (_) {}
          resolve(acc);
        }
        function maybeTimeout() {
          killer = setTimeout(() => {
            fulfilled = true;
            clearTimeout(killer);
            try { res.data.destroy(); } catch (_) {}
            if (acc.result || acc.error) resolve(acc);
            else reject(new ApiError("timeout: server tidak selesai mengirim data dalam " + SSE_MAX_MS / 1000 + " detik", { retryable: true }));
          }, SSE_MAX_MS);
        }
        maybeTimeout();

        res.data.on("data", (chunk) => {
          buf += chunk.toString().replace(/\r\n/g, "\n");
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const e = parseSseBlock(block);
            if (!e) continue;
            if (e.event === "log") {
              acc.logs.push(e.data);
              prog(`   ${C.dim}· ${String(e.data).slice(0, 140)}${C.reset}`);
            } else if (e.event === "candidates") {
              try { acc.candidates = JSON.parse(e.data); } catch { acc.candidates = null; }
            } else if (e.event === "result") {
              try { acc.result = JSON.parse(e.data); } catch { acc.result = null; }
              return finish();
            } else if (e.event === "error") {
              let msg = "terjadi kesalahan dari server";
              try {
                const j = JSON.parse(e.data);
                msg = (j && j.message) || msg;
              } catch { msg = e.data || msg; }
              acc.error = { message: msg };
              return finish();
            }
            if (Date.now() - started > SSE_MAX_MS) return finish();
          }
        });

        function endHandler() {
          if (closed || fulfilled) return;
          closed = true;
          if (acc.result || acc.error) return finish();
          if (acc.result || acc.error) return finish();
          clearTimeout(killer);
          fulfilled = true;
          reject(new ApiError("koneksi SSE terputus sebelum selesai", { retryable: true }));
        }
        res.data.on("end", endHandler);
        res.data.on("error", endHandler);
        res.data.on("close", endHandler);
      })
      .catch((e) => {
        if (fulfilled) return;
        clearTimeout(killer);
        reject(new ApiError("gagal membuka koneksi SSE: " + (e.code || e.message), { retryable: true }));
      });
  });
}

// ========== API WRAPPERS ==========
function isVideoUrl(text) {
  return /(?:https?:\/\/)?(?:[\w-]*\.)*(?:tiktok\.com|youtu\.be|youtube\.com)/i.test(text || "");
}

async function apiFind(inputUrl) {
  let lastErr = null;
  for (let attempt = 1; attempt <= HTTP_RETRY_MAX; attempt++) {
    const token = await getHandshakeToken();
    const path_ = "/api/find?url=" + encodeURIComponent(inputUrl) + "&t=" + encodeURIComponent(token);
    log(`\n${C.blue}${C.bold}[${attempt}/${HTTP_RETRY_MAX}]${C.reset} ${C.cyan}Memindai video...${C.reset}`);
    prog("");
    const got = await sseRun(path_);
    if (got.error) {
      const msg = got.error.message;
      if (retryableMsg(msg) && attempt < HTTP_RETRY_MAX) {
        log(`${C.yellow}${C.bold}[!]${C.reset} ${msg} ${C.dim}— retry...${C.reset}`);
        await sleep(4000 + attempt * 1500);
        lastErr = new ApiError(msg, { retryable: true });
        continue;
      }
      throw new ApiError(msg);
    }
    if (got.result) {
      const r = got.result;
      if (r.ok === false) {
        const msg = r.error || "target tidak dapat memproses link ini";
        if (retryableMsg(msg) && attempt < HTTP_RETRY_MAX) {
          log(`${C.yellow}${C.bold}[!]${C.reset} ${msg} ${C.dim}— retry...${C.reset}`);
          await sleep(4000 + attempt * 1500);
          lastErr = new ApiError(msg, { retryable: true });
          continue;
        }
        throw new ApiError(msg);
      }
      r.logs = got.logs || [];
      return r;
    }
    lastErr = new ApiError("tidak ada data yang diterima dari server", { retryable: true });
    await sleep(3000);
  }
  throw lastErr || new ApiError("pemindaian gagal");
}

async function apiSearch(keyword) {
  let lastErr = null;
  for (let attempt = 1; attempt <= HTTP_RETRY_MAX; attempt++) {
    const token = await getHandshakeToken();
    const path_ = "/api/search?mode=pick&q=" + encodeURIComponent(keyword) + "&t=" + encodeURIComponent(token);
    log(`\n${C.blue}${C.bold}[${attempt}/${HTTP_RETRY_MAX}]${C.reset} ${C.cyan}Mencari keyword "${keyword}"...${C.reset}`);
    prog("");
    const got = await sseRun(path_);
    if (got.error) {
      const msg = got.error.message;
      if (retryableMsg(msg) && attempt < HTTP_RETRY_MAX) {
        log(`${C.yellow}${C.bold}[!]${C.reset} ${msg} ${C.dim}— retry...${C.reset}`);
        await sleep(4000 + attempt * 1500);
        lastErr = new ApiError(msg, { retryable: true });
        continue;
      }
      throw new ApiError(msg);
    }
    if (got.result || got.candidates) {
      return {
        items: (got.candidates && got.candidates.items) || [],
        fromCache: got.candidates ? got.candidates.fromCache : null,
        meta: got.result || null,
      };
    }
    lastErr = new ApiError("tidak ada data yang diterima dari server", { retryable: true });
    await sleep(3000);
  }
  throw lastErr || new ApiError("pencarian gagal");
}

// ========== MAPPING ==========
const YT_RE = /youtu\.be|youtube\.com/i;
function detectSsource(videoUrl) {
  return YT_RE.test(videoUrl || "") ? "youtube" : "tiktok";
}
function hashtagsOf(text) {
  const t = String(text || "");
  const set = [];
  const re = /#[\p{L}\p{N}_]+/gu;
  let m;
  while ((m = re.exec(t))) set.push(m[0]);
  return [...new Set(set)];
}
function isoTime(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { ms: null, iso: null };
  const ms = n < 1e12 ? n * 1000 : n;
  return { ms: Math.round(ms), iso: new Date(ms).toISOString() };
}
function fmtLink(l, idx) {
  return {
    no: idx + 1,
    tipe: l.type || null,
    judul: l.title || null,
    url: l.url,
    ukuran_file: l.size || null,
    rasio: l.ratio || null,
    thumbnail: l.thumb || null,
    thumbs: Array.isArray(l.thumbs) ? l.thumbs : [],
    diperoleh_dari: l.source || null,
    komentar: l.detail || null,
    dari_creator_video: l.byAuthor === true,
    disematkan: l.pinned === true,
    terverifikasi: l.verified === true,
  };
}
function mapFindResult(r) {
  const v = r.video || {};
  const st = v.stats || {};
  const ad = r.authorDetail || {};
  const src = detectSsource(r.videoUrl || v.url || "");
  const links = Array.isArray(r.presetLinks) ? r.presetLinks : [];
  const noDataMsg = (r.checked && r.checked.commentsDisabled)
    ? "Komentar video dinonaktifkan kreator. Link preset tidak dapat diperiksa."
    : "Video ini tidak mengandung preset!";

  const videoId = r.videoId || v.id || null;
  const shareUrl = videoId ? BASE + "/preset/" + src + "/" + videoId : null;

  return {
    success: r.found !== false && links.length > 0,
    mode: "link_video",
    input: r.input || "",
    sumber: src,
    nama_creator: ad.nickname || r.author || null,
    handle_creator: ad.uniqueId ? "@" + ad.uniqueId : (r.author || null),
    bio_creator: ad.bio || null,
    bio_link_creator: ad.bioLink || null,
    avatar_creator: ad.avatar || null,
    like: st.likes != null ? st.likes : null,
    comment: st.comments != null ? st.comments : null,
    favorite_video: st.favorite != null ? st.favorite : null,
    views: st.views != null ? st.views : null,
    jumlah_share: st.shares != null ? st.shares : null,
    tautan_share: shareUrl,
    tautan_video: r.videoUrl || v.url || null,
    video_id: videoId,
    judul_video: v.title || null,
    caption: v.description || null,
    hastag: hashtagsOf(v.description || ""),
    thumbnail: v.cover || null,
    diupload_at: isoTime(v.createTime).iso,
    musik: v.music
      ? {
          judul: v.music.title || null,
          author: v.music.author || null,
          original: v.music.original === true,
          cover: v.music.cover || null,
          audio_url: v.music.playUrl || null,
        }
      : null,
    link_preset: links.map((l) => l.url).filter(Boolean),
    preset: links.map(fmtLink),
    tautan_lain: Array.isArray(r.otherLinks) ? r.otherLinks : [],
    cakupan_pemindaian: {
      deskripsi: r.scanned ? Boolean(r.scanned.description) : null,
      bio: r.scanned ? Boolean(r.scanned.bio) : null,
      halaman_biolink: r.scanned ? Boolean(r.scanned.bioLinkPage) : null,
      komentar_dipindai: r.scanned && r.scanned.comments != null ? r.scanned.comments : null,
      balasan_komentar: r.scanned && r.scanned.replies != null ? r.scanned.replies : null,
      komentar_dinonaktifkan: (r.checked && r.checked.commentsDisabled) === true,
    },
    kata_kunci_konteks: Array.isArray((r.context || {}).matched) ? r.context.matched : [],
    pesan: links.length === 0 ? noDataMsg : null,
    log_proses: r.logs || [],
  };
}
function mapSearchItem(it) {
  const src = it.url && /youtube|youtu\.be/i.test(it.url) ? "youtube" : "tiktok";
  const idMatch = /\/video\/(\d+)|[?&]v=([A-Za-z0-9_-]{6,})|youtu\.be\/([A-Za-z0-9_-]{6,})/.exec(it.url || "");
  const vid = idMatch ? idMatch[1] || idMatch[2] || idMatch[3] : null;
  return {
    url_video: it.url,
    handle: it.handle || null,
    snippet_caption: it.snippet || null,
    hastag: hashtagsOf(it.snippet || ""),
    thumbnail: it.thumb || null,
    durasi_detik: it.duration != null ? it.duration : null,
    views: (it.stats && it.stats.playCount) || null,
    like: (it.stats && it.stats.likeCount) || null,
    tautan_share: vid ? BASE + "/preset/" + src + "/" + vid : null,
  };
}

// ========== TAMPILAN HASIL ==========
function printHasil(out) {
  if (!o
