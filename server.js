/**
 * KasirKu Backend API + Frontend Server
 * Jalankan: npm install && npm start
 * Buka: http://localhost:3000
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

// ============ DATABASE ============
const db = new Database(path.join(__dirname, 'kasirku.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    pin TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'kasir',
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    barcode TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Lainnya',
    price INTEGER NOT NULL,
    cost INTEGER NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    min_stock INTEGER NOT NULL DEFAULT 5,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    subtotal INTEGER NOT NULL,
    discount INTEGER NOT NULL DEFAULT 0,
    discount_type TEXT,
    discount_value INTEGER,
    total INTEGER NOT NULL,
    pay INTEGER NOT NULL,
    change INTEGER NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS transaction_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id TEXT NOT NULL,
    product_id TEXT,
    product_name TEXT NOT NULL,
    product_barcode TEXT NOT NULL,
    price INTEGER NOT NULL,
    qty INTEGER NOT NULL,
    subtotal INTEGER NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at);
`);

// Seed admin
if (db.prepare('SELECT COUNT(*) as c FROM users').get().c === 0) {
  const hash = bcrypt.hashSync('1234', 10);
  db.prepare('INSERT INTO users (username, pin, role, name) VALUES (?, ?, ?, ?)')
    .run('admin', hash, 'admin', 'Administrator');
  console.log('✅ Admin default: username=admin, PIN=1234');
}

// Seed produk contoh
if (db.prepare('SELECT COUNT(*) as c FROM products').get().c === 0) {
  const seed = [
    ['p1', '8998866200019', 'Indomie Goreng', 'Makanan', 3500, 2800, 50, 10],
    ['p2', '8998866200026', 'Aqua 600ml', 'Minuman', 4000, 3000, 80, 20],
    ['p3', '8998866200033', 'Chitato Sapi', 'Snack', 12000, 9500, 25, 5],
    ['p4', '8998866200040', 'Beras 5kg', 'Sembako', 65000, 58000, 15, 5],
    ['p5', '8998866200057', 'Sabun Lifebuoy', 'Kebersihan', 5500, 4200, 3, 10]
  ];
  const insert = db.prepare('INSERT INTO products (id, barcode, name, category, price, cost, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => { for (const p of seed) insert.run(...p); })();
  console.log('✅ Seed 5 produk contoh');
}

// ============ EXPRESS ============
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`${req.method} ${req.path} → ${res.statusCode} (${Date.now() - start}ms)`);
    }
  });
  next();
});

// ============ API ROUTES ============

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// LOGIN
app.post('/api/login', (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) return res.status(400).json({ error: 'Username dan PIN wajib diisi' });
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user) return res.status(401).json({ error: 'User tidak ditemukan' });
  if (!bcrypt.compareSync(pin, user.pin)) return res.status(401).json({ error: 'PIN salah' });
  const { pin: _, ...userData } = user;
  res.json({ success: true, user: userData });
});

// PRODUCTS
app.get('/api/products', (req, res) => {
  const { q = '', category = '', low_stock = '' } = req.query;
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (q) { query += ' AND (name LIKE ? OR barcode LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (category) { query += ' AND category = ?'; params.push(category); }
  if (low_stock === '1') { query += ' AND stock <= min_stock'; }
  query += ' ORDER BY name ASC';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/products/barcode/:barcode', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE barcode = ?').get(req.params.barcode);
  if (!p) return res.status(404).json({ error: 'Produk tidak ditemukan', barcode: req.params.barcode });
  res.json(p);
});

app.get('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  res.json(p);
});

app.post('/api/products', (req, res) => {
  const { barcode, name, category = 'Lainnya', price, cost = 0, stock = 0, min_stock = 5 } = req.body;
  if (!barcode || !name || !price) return res.status(400).json({ error: 'Barcode, nama, harga wajib diisi' });
  const id = 'p' + Date.now() + Math.random().toString(36).substr(2, 5);
  try {
    db.prepare('INSERT INTO products (id, barcode, name, category, price, cost, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, barcode, name, category, price, cost, stock, min_stock);
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Barcode sudah terdaftar' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/products/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  const { barcode, name, category, price, cost, stock, min_stock } = req.body;
  try {
    db.prepare(`UPDATE products SET
      barcode = COALESCE(?, barcode), name = COALESCE(?, name), category = COALESCE(?, category),
      price = COALESCE(?, price), cost = COALESCE(?, cost), stock = COALESCE(?, stock),
      min_stock = COALESCE(?, min_stock), updated_at = datetime('now')
      WHERE id = ?`).run(barcode, name, category, price, cost, stock, min_stock, req.params.id);
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Barcode sudah dipakai' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/products/:id', (req, res) => {
  const result = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  res.json({ success: true });
});

app.post('/api/products/:id/restock', (req, res) => {
  const { qty } = req.body;
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Qty harus > 0' });
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  db.prepare("UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ?").run(qty, req.params.id);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id));
});

// TRANSACTIONS
app.get('/api/transactions', (req, res) => {
  const { from, to, limit = 100, offset = 0 } = req.query;
  let query = 'SELECT * FROM transactions WHERE 1=1';
  const params = [];
  if (from) { query += ' AND created_at >= ?'; params.push(from); }
  if (to) { query += ' AND created_at <= ?'; params.push(to); }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  const trx = db.prepare(query).all(...params);
  const getItems = db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?');
  res.json(trx.map(t => ({ ...t, items: getItems.all(t.id) })));
});

app.get('/api/transactions/:id', (req, res) => {
  const trx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!trx) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
  const items = db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(req.params.id);
  res.json({ ...trx, items });
});

app.post('/api/transactions', (req, res) => {
  const { items, subtotal, discount = 0, discount_type, discount_value, total, pay, change, payment_method = 'cash' } = req.body;
  if (!items || !items.length) return res.status(400).json({ error: 'Items wajib diisi' });
  if (!total || !pay) return res.status(400).json({ error: 'Total dan pay wajib diisi' });
  if (pay < total) return res.status(400).json({ error: 'Pembayaran kurang' });
  const trxId = 'TRX' + Date.now();
  for (const item of items) {
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
    if (!p) return res.status(404).json({ error: 'Produk ' + item.product_name + ' tidak ditemukan' });
    if (p.stock < item.qty) return res.status(400).json({ error: 'Stok ' + p.name + ' tidak cukup' });
  }
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO transactions (id, subtotal, discount, discount_type, discount_value, total, pay, change, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(trxId, subtotal, discount, discount_type || null, discount_value || null, total, pay, change, payment_method);
    for (const item of items) {
      db.prepare('INSERT INTO transaction_items (transaction_id, product_id, product_name, product_barcode, price, qty, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(trxId, item.product_id, item.product_name, item.product_barcode, item.price, item.qty, item.subtotal);
      db.prepare("UPDATE products SET stock = stock - ?, updated_at = datetime('now') WHERE id = ?").run(item.qty, item.product_id);
    }
  });
  try {
    tx();
    const trx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(trxId);
    const trxItems = db.prepare('SELECT * FROM transaction_items WHERE transaction_id = ?').all(trxId);
    res.status(201).json({ ...trx, items: trxItems });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// REPORTS
app.get('/api/reports/summary', (req, res) => {
  const { from, to } = req.query;
  let df = '', params = [];
  if (from) { df += ' AND created_at >= ?'; params.push(from); }
  if (to) { df += ' AND created_at <= ?'; params.push(to); }
  const summary = db.prepare(`SELECT COUNT(*) as total_transactions, COALESCE(SUM(total), 0) as total_sales, COALESCE(AVG(total), 0) as avg_transaction, COALESCE(SUM(discount), 0) as total_discount FROM transactions WHERE 1=1 ${df}`).get(...params);
  const items = db.prepare(`SELECT COALESCE(SUM(ti.qty), 0) as total FROM transaction_items ti JOIN transactions t ON ti.transaction_id = t.id WHERE 1=1 ${df.replace(/created_at/g, 't.created_at')}`).get(...params);
  res.json({ ...summary, total_items: items.total });
});

app.get('/api/reports/daily', (req, res) => {
  const days = parseInt(req.query.days) || 7;
  res.json(db.prepare(`SELECT date(created_at) as date, COUNT(*) as transactions, COALESCE(SUM(total), 0) as total FROM transactions WHERE created_at >= date('now', '-${days} days') GROUP BY date(created_at) ORDER BY date ASC`).all());
});

app.get('/api/reports/top-products', (req, res) => {
  const limit = parseInt(req.query.limit) || 5;
  res.json(db.prepare(`SELECT product_name as name, product_barcode as barcode, SUM(qty) as total_qty, SUM(subtotal) as total_revenue FROM transaction_items GROUP BY product_name, product_barcode ORDER BY total_qty DESC LIMIT ?`).all(limit));
});

// ============ SERVE FRONTEND ============
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌', err.message);
  res.status(err.status || 500).json({ error: err.message });
});

// Start
app.listen(PORT, HOST, () => {
  console.log('');
  console.log('🚀 KasirKu berjalan!');
  console.log('   → http://localhost:' + PORT);
  console.log('   → http://' + getLocalIP() + ':' + PORT + ' (HP lain di WiFi sama)');
  console.log('   Login: admin / 1234');
  console.log('');
});

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
}