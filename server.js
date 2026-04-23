'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'replace-me-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const DATABASE_URL = process.env.DATABASE_URL;
const NODE_ENV = process.env.NODE_ENV || 'development';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required.');
}

if (JWT_SECRET === 'replace-me-in-production') {
  // eslint-disable-next-line no-console
  console.warn('WARNING: JWT_SECRET is using default value. Set JWT_SECRET in production.');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined
});

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function authMiddleware(req, res, next) {
  const token = req.cookies.auth_token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

async function bootstrapDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id UUID PRIMARY KEY,
      date DATE NOT NULL,
      task TEXT NOT NULL,
      credits INTEGER NOT NULL CHECK (credits >= 0),
      person TEXT NOT NULL,
      proof TEXT NOT NULL CHECK (proof IN ('pending', 'approved')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION touch_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS entries_touch_updated_at ON entries;
    CREATE TRIGGER entries_touch_updated_at
      BEFORE UPDATE ON entries
      FOR EACH ROW
      EXECUTE FUNCTION touch_updated_at();
  `);

  const existing = await pool.query('SELECT id, username FROM users WHERE username = $1', [ADMIN_USERNAME]);
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  if (existing.rows.length === 0) {
    await pool.query(
      'INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)',
      [uuidv4(), ADMIN_USERNAME, hash]
    );
  } else {
    await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, ADMIN_USERNAME]);
  }
}

app.get('/healthz', asyncHandler(async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'db_unreachable' });
  }
}));

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.username });
});

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  const result = await pool.query('SELECT id, username, password_hash FROM users WHERE username = $1', [username]);
  const user = result.rows[0];

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  return res.json({ username: user.username });
}));

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('auth_token');
  res.status(204).end();
});

app.get('/api/entries', authMiddleware, asyncHandler(async (_req, res) => {
  const result = await pool.query(
    'SELECT id, date::TEXT AS date, task, credits, person, proof FROM entries ORDER BY date DESC, created_at DESC'
  );
  res.json(result.rows);
}));

app.post('/api/entries', authMiddleware, asyncHandler(async (req, res) => {
  const { date, task, credits, person, proof } = req.body || {};

  if (!date || !task || !Number.isInteger(credits) || !person || !proof) {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  if (!['Rozh', 'Barzan'].includes(person)) {
    return res.status(400).json({ error: 'Invalid person' });
  }

  if (!['pending', 'approved'].includes(proof)) {
    return res.status(400).json({ error: 'Invalid proof' });
  }

  const id = uuidv4();
  await pool.query(
    'INSERT INTO entries (id, date, task, credits, person, proof) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, date, task, credits, person, proof]
  );

  return res.status(201).json({ id, date, task, credits, person, proof });
}));

app.patch('/api/entries/:id/proof', authMiddleware, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const { proof } = req.body || {};

  if (!['pending', 'approved'].includes(proof)) {
    return res.status(400).json({ error: 'Invalid proof' });
  }

  const result = await pool.query(
    'UPDATE entries SET proof = $1 WHERE id = $2 RETURNING id, date::TEXT AS date, task, credits, person, proof',
    [proof, id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Entry not found' });
  }

  return res.json(result.rows[0]);
}));

app.delete('/api/entries/:id', authMiddleware, asyncHandler(async (req, res) => {
  const id = req.params.id;
  await pool.query('DELETE FROM entries WHERE id = $1', [id]);
  res.status(204).end();
}));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function main() {
  await bootstrapDatabase();

  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`chore-game listening on :${PORT}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', error);
  process.exit(1);
});
