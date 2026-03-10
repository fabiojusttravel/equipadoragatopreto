const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));

// ── SPA Fallback ──────────────────────────────────────────────────────────
app.get('/admin*', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/conferente*', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'conferente.html')));
app.get('*', (_, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🐱 Gato Preto — Catálogo Online`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Admin: http://localhost:${PORT}/admin\n`);
});
