const express = require('express');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'Root123!', // <-- password yahan dal dena
  database: 'campus_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};


let pool;

async function seedIfEmpty() {
  const [r] = await pool.query('SELECT COUNT(*) as c FROM users');
  if (r[0].c > 0) return;
  const hp = await bcrypt.hash('password123', 10);
  await pool.query(
    `INSERT INTO users (email, password, role) VALUES (?, ?, 'admin'), (?, ?, 'organizer'), (?, ?, 'participant')`,
    ['admin@example.com', hp, 'organizer@example.com', hp, 'participant@example.com', hp]
  );
  const [u] = await pool.query('SELECT id FROM users WHERE role = ?', ['participant']);
  const pid = u[0]?.id;
  if (pid) {
    await pool.query('INSERT IGNORE INTO user_profiles (user_id, full_name, department, academic_year, profile_visibility) VALUES (?, ?, ?, ?, ?)',
      [pid, 'Demo Student', 'Computer Science', '3rd Year', 'internal']);
    const [c] = await pool.query('SELECT id FROM clubs LIMIT 2');
    for (const row of c) await pool.query('INSERT IGNORE INTO club_members (club_id, user_id, role) VALUES (?, ?, ?)', [row.id, pid, 'member']);
    await pool.query('INSERT IGNORE INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)',
      [pid, 'Welcome', 'Welcome to Campus Resource & Event Management. Explore events and book resources.', 'general']);
  }
  console.log('Seeded default users (admin/organizer/participant@example.com, password: password123)');
}

async function initDb() {
  try {
    pool = mysql.createPool(dbConfig);
    await pool.query('SELECT 1');
    console.log('Connected to MySQL database');
    await seedIfEmpty();
  } catch (err) {
    console.error('MySQL connection failed. Ensure MySQL is running and database "campus_db" exists. Run database.sql first.');
    console.error(err.message);
    process.exit(1);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Helper: get user id from header (in production use JWT/sessions)
const getUserId = (req) => {
  const id = req.headers['x-user-id'] || req.query.userId;
  return id ? parseInt(id, 10) : null;
};

// ==================== AUTH ====================

app.post('/register', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }
  const validRoles = ['admin', 'organizer', 'participant'];
  const userRole = role && validRoles.includes(role.toLowerCase()) ? role.toLowerCase() : 'participant';

  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (rows.length) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const [r] = await pool.query('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', [email, hashed, userRole]);
    const uid = r.insertId;
    await pool.query('INSERT INTO user_profiles (user_id, full_name) VALUES (?, ?)', [uid, email.split('@')[0]]);
    res.status(201).json({
      success: true,
      message: 'Account created successfully!',
      user: { id: uid, email, role: userRole }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    res.json({
      success: true,
      message: 'Login successful',
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== USER PROFILE ====================

app.get('/api/profile', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  try {
    const [u] = await pool.query('SELECT id, email, role FROM users WHERE id = ?', [uid]);
    if (!u.length) return res.status(404).json({ success: false });
    const [p] = await pool.query('SELECT * FROM user_profiles WHERE user_id = ?', [uid]);
    const profile = p[0] || {};
    res.json({ success: true, user: u[0], profile });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/profile', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const { full_name, department, academic_year, phone, bio, profile_visibility } = req.body;
  try {
    await pool.query(
      `INSERT INTO user_profiles (user_id, full_name, department, academic_year, phone, bio, profile_visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         full_name = COALESCE(?, full_name),
         department = COALESCE(?, department),
         academic_year = COALESCE(?, academic_year),
         phone = COALESCE(?, phone),
         bio = COALESCE(?, bio),
         profile_visibility = COALESCE(?, profile_visibility)`,
      [uid, full_name, department, academic_year, phone, bio, profile_visibility || 'internal',
       full_name, department, academic_year, phone, bio, profile_visibility || 'internal']
    );
    res.json({ success: true, message: 'Profile updated' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== CLUBS: user's memberships & heads ====================

app.get('/api/profile/clubs', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.name, c.slug, c.type, cm.role as membership_role
       FROM club_members cm
       JOIN clubs c ON c.id = cm.club_id
       WHERE cm.user_id = ?
       ORDER BY (cm.role = 'head' OR cm.role = 'coordinator') DESC, c.name`,
      [uid]
    );
    const memberOf = rows.filter(r => r.membership_role === 'member');
    const headsOrCoords = rows.filter(r => r.membership_role === 'head' || r.membership_role === 'coordinator');
    res.json({ success: true, memberOf, headsOrCoords, all: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== CLUBS: list & join ====================

app.get('/api/clubs', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, slug, description, type FROM clubs ORDER BY name');
    res.json({ success: true, clubs: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/clubs/join', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const { clubId } = req.body;
  if (!clubId) return res.status(400).json({ success: false, message: 'clubId required' });
  try {
    await pool.query('INSERT IGNORE INTO club_members (club_id, user_id, role) VALUES (?, ?, ?)', [clubId, uid, 'member']);
    res.json({ success: true, message: 'Joined club' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== EVENTS ====================

app.get('/api/events', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.id, e.title, e.description, e.status, e.start_date, e.end_date, e.start_time, e.end_time, e.venue, c.name as club_name
       FROM events e
       LEFT JOIN clubs c ON c.id = e.club_id
       WHERE e.status IN ('approved', 'completed')
       ORDER BY e.start_date DESC, e.start_time DESC
       LIMIT 50`
    );
    res.json({ success: true, events: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/events/registered', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  try {
    const [rows] = await pool.query(
      `SELECT e.id, e.title, e.start_date, e.end_date, e.start_time, e.venue, er.status as reg_status, c.name as club_name
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       LEFT JOIN clubs c ON c.id = e.club_id
       WHERE er.user_id = ? AND er.status != 'cancelled'
       ORDER BY e.start_date DESC
       LIMIT 50`,
      [uid]
    );
    res.json({ success: true, events: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/events/register', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const { eventId } = req.body;
  if (!eventId) return res.status(400).json({ success: false, message: 'eventId required' });
  try {
    await pool.query('INSERT IGNORE INTO event_registrations (event_id, user_id) VALUES (?, ?)', [eventId, uid]);
    res.json({ success: true, message: 'Registered for event' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== RESOURCES ====================

app.get('/api/resources', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, category, description, requires_approval FROM resources ORDER BY category, name');
    res.json({ success: true, resources: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/resources/bookings', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  try {
    const [rows] = await pool.query(
      `SELECT rb.id, rb.start_datetime, rb.end_datetime, rb.status, rb.purpose, r.name as resource_name, r.category
       FROM resource_bookings rb
       JOIN resources r ON r.id = rb.resource_id
       WHERE rb.user_id = ?
       ORDER BY rb.start_datetime DESC
       LIMIT 50`,
      [uid]
    );
    res.json({ success: true, bookings: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/resources/book', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const { resourceId, start_datetime, end_datetime, purpose } = req.body;
  if (!resourceId || !start_datetime || !end_datetime) {
    return res.status(400).json({ success: false, message: 'resourceId, start_datetime, end_datetime required' });
  }
  try {
    const [r] = await pool.query('SELECT requires_approval FROM resources WHERE id = ?', [resourceId]);
    if (!r.length) return res.status(404).json({ success: false, message: 'Resource not found' });
    const status = r[0].requires_approval ? 'pending' : 'approved';
    const [ins] = await pool.query(
      'INSERT INTO resource_bookings (resource_id, user_id, start_datetime, end_datetime, status, purpose) VALUES (?, ?, ?, ?, ?, ?)',
      [resourceId, uid, start_datetime, end_datetime, status, purpose || '']
    );
    res.json({ success: true, bookingId: ins.insertId, status, message: status === 'approved' ? 'Booking confirmed' : 'Booking pending approval' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== NOTIFICATIONS ====================

app.get('/api/notifications', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  try {
    const [rows] = await pool.query(
      'SELECT id, title, message, type, ref_type, ref_id, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [uid]
    );
    res.json({ success: true, notifications: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.patch('/api/notifications/:id/read', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false });
  try {
    await pool.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, uid]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// ==================== MESSAGES (thread list for sidebar) ====================

app.get('/api/messages/threads', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  try {
    const [rows] = await pool.query(
      `SELECT mt.id, mt.type, mt.ref_id, mt.created_at
       FROM message_participants mp
       JOIN message_threads mt ON mt.id = mp.thread_id
       WHERE mp.user_id = ?
       ORDER BY mt.created_at DESC
       LIMIT 30`,
      [uid]
    );
    res.json({ success: true, threads: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ROUTES & STATIC ====================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/student-home', (req, res) => res.sendFile(path.join(__dirname, 'student-home.html')));

// ==================== SERVER ====================

initDb().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});

process.on('SIGINT', async () => {
  if (pool) await pool.end();
  process.exit(0);
});
