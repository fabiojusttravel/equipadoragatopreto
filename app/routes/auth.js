const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../db/schema');
const { JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

  const ok = bcrypt.compareSync(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Credenciais inválidas' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// GET /api/auth/me  (verifica token)
router.get('/me', require('../middleware/auth').authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
