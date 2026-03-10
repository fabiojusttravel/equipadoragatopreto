#!/usr/bin/env node
/**
 * batch_images.js — Busca e salva imagens em lote para os N primeiros produtos
 * Uso: node batch_images.js [quantidade] [offset]
 * Ex:  node batch_images.js 100 0
 */
const https  = require('https');
const http   = require('http');
const zlib   = require('zlib');
const { getDb } = require('./db/schema');

const LIMIT   = parseInt(process.argv[2] || '100');
const OFFSET  = parseInt(process.argv[3] || '0');
const DELAY   = 1200; // ms entre requests (evita rate-limit)

// ── HTTP helper ──────────────────────────────────────────────────────────────
function httpGet(url, extraHeaders = {}, redirects = 0) {
  return new Promise((resolve) => {
    if (redirects > 5) return resolve('');
    const lib = url.startsWith('https') ? https : http;
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        ...extraHeaders,
      },
    };
    const req = lib.get(url, opts, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        const loc = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        return resolve(httpGet(loc, extraHeaders, redirects + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'] || '';
        const decode = (b) => resolve(b.toString('utf8'));
        if (enc === 'br')      zlib.brotliDecompress(buf, (e,d) => e ? resolve('') : decode(d));
        else if (enc === 'gzip')   zlib.gunzip(buf,         (e,d) => e ? resolve('') : decode(d));
        else if (enc === 'deflate') zlib.inflate(buf,        (e,d) => e ? resolve('') : decode(d));
        else decode(buf);
      });
    });
    req.setTimeout(18000, () => { req.destroy(); resolve(''); });
    req.on('error', () => resolve(''));
  });
}

// ── DuckDuckGo (primário) ────────────────────────────────────────────────────
async function duckduckgoSearch(query) {
  try {
    const q = encodeURIComponent(query + ' autopeça');
    const html = await httpGet(
      `https://duckduckgo.com/?q=${q}&t=h_&iar=images&iax=images&ia=images`,
      { 'Referer': 'https://duckduckgo.com/' }
    );
    const m = html.match(/vqd="([^"]+)"/);
    if (!m) return [];

    const jsonStr = await httpGet(
      `https://duckduckgo.com/i.js?q=${q}&o=json&p=1&vqd=${encodeURIComponent(m[1])}&f=,,,,,&l=pt-br&s=0`,
      { 'Accept': 'application/json, text/javascript, */*; q=0.01',
        'x-requested-with': 'XMLHttpRequest',
        'Referer': 'https://duckduckgo.com/' }
    );
    const data = JSON.parse(jsonStr);
    return (data.results || []).filter(r => r.thumbnail).slice(0, 10).map(r => r.thumbnail);
  } catch { return []; }
}

// ── Google via allorigins.win (fallback) ─────────────────────────────────────
async function googleSearchProxy(query) {
  try {
    const q      = encodeURIComponent(query + ' autopeça');
    const target = encodeURIComponent(`https://www.google.com/search?q=${q}&tbm=isch&hl=pt-BR&gl=BR`);
    const json   = await httpGet(`https://api.allorigins.win/get?url=${target}`);
    const { contents = '' } = JSON.parse(json);
    const re = /https:\/\/encrypted-tbn0\.gstatic\.com\/images\?q=tbn:[A-Za-z0-9_:%-]+/g;
    return [...new Set(contents.match(re) || [])].slice(0, 10);
  } catch { return []; }
}

async function searchImages(query) {
  const [ddg, goog] = await Promise.allSettled([
    duckduckgoSearch(query),
    googleSearchProxy(query),
  ]);
  const ddgUrls  = ddg.status  === 'fulfilled' ? ddg.value  : [];
  const googUrls = goog.status === 'fulfilled' ? goog.value : [];
  if (ddgUrls.length >= 3) return ddgUrls;
  if (googUrls.length > 0) return googUrls;
  return ddgUrls;
}

// ── Sleep helper ─────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Barra de progresso ───────────────────────────────────────────────────────
function bar(done, total, width = 30) {
  const filled = Math.round((done / total) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const db = getDb();

  // Produtos sem imagens dentro do intervalo solicitado
  const products = db.prepare(`
    SELECT p.id, p.name FROM products p
    WHERE NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)
    ORDER BY p.id
    LIMIT ? OFFSET ?
  `).all(LIMIT, OFFSET);

  const total = products.length;
  if (!total) {
    console.log(`\n✅ Nenhum produto sem imagem nos primeiros ${LIMIT} itens (offset ${OFFSET}).\n`);
    return;
  }

  console.log(`\n🐱 Gato Preto — Atualização de Imagens em Lote`);
  console.log(`   Produtos a processar: ${total} | Delay: ${DELAY}ms entre itens\n`);

  const insertImg = db.prepare(
    'INSERT OR IGNORE INTO product_images (product_id, url, is_pinned) VALUES (?, ?, ?)'
  );
  const saveImages = db.transaction((productId, urls) =>
    urls.map((url, i) => {
      const r = insertImg.run(productId, url, i === 0 ? 1 : 0);
      return r.lastInsertRowid;
    })
  );

  let ok = 0, empty = 0, errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const pct = Math.round(((i + 1) / total) * 100);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const eta = i > 0
      ? Math.round(((Date.now() - startTime) / i) * (total - i) / 1000)
      : '—';

    process.stdout.write(
      `\r${bar(i + 1, total)} ${pct}% | ${i+1}/${total} | ✓${ok} ✗${empty} | ${elapsed}s | ETA ${eta}s   `
    );

    try {
      const urls = await searchImages(p.name);
      if (urls.length > 0) {
        saveImages(p.id, urls);
        ok++;
      } else {
        empty++;
      }
    } catch {
      errors++;
    }

    if (i < products.length - 1) await sleep(DELAY);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n📊 Resultado:`);
  console.log(`   ✅ Com imagens:      ${ok}`);
  console.log(`   ⚠️  Sem resultados:   ${empty}`);
  console.log(`   ❌ Erros:            ${errors}`);
  console.log(`   ⏱  Tempo total:      ${totalTime}s`);
  console.log(`\n✅ Concluído! Reinicie o servidor para ver as imagens no catálogo.\n`);
}

main().catch(err => { console.error('\n❌ Erro fatal:', err); process.exit(1); });
