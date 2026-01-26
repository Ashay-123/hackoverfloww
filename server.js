const express = require('express');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// MySQL config - set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in env or use defaults
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'campus_db',
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
  const [o] = await pool.query('SELECT id FROM users WHERE role = ?', ['organizer']);
  const oid = o[0]?.id;
  if (oid) {
    await pool.query('INSERT IGNORE INTO user_profiles (user_id, full_name, profile_visibility) VALUES (?, ?, ?)',
      [oid, 'Demo Organizer', 'internal']);
    const [c] = await pool.query('SELECT id FROM clubs LIMIT 1');
    if (c.length) await pool.query('INSERT IGNORE INTO club_members (club_id, user_id, role) VALUES (?, ?, ?)', [c[0].id, oid, 'head']);
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
app.use(cors({
  origin: `http://localhost:${PORT}`,
  credentials: true
}));
app.use(express.json());
app.use(express.static(__dirname));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'campus-hub-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

const requireOrganizer = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.session.role !== 'organizer') {
    return res.status(403).json({ error: 'Organizer access required' });
  }
  next();
};

// Helper: get user id from session (backward compatibility with header for existing code)
const getUserId = (req) => {
  return req.session.userId || (req.headers['x-user-id'] ? parseInt(req.headers['x-user-id'], 10) : null);
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
    // Set session
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.email = user.email;
    res.json({
      success: true,
      message: 'Login successful',
      user: { id: user.id, email: user.email, role: user.role }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
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

// ==================== ORGANIZER: EVENT MANAGEMENT ====================

// GET /api/organizer/events - List events created by organizer
app.get('/api/organizer/events', requireOrganizer, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, description, event_date, start_time, end_time, location, online_link, 
       max_participants, registration_deadline, status, created_at, updated_at
       FROM events 
       WHERE created_by = ?
       ORDER BY event_date ASC, start_time ASC`,
      [req.session.userId]
    );
    res.json(rows);
  } catch (e) {
    console.error('Error fetching events:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/events - Create event (organizer only)
app.post('/api/events', requireOrganizer, async (req, res) => {
  const { title, description, event_date, start_time, end_time, location, online_link, max_participants, registration_deadline } = req.body;
  
  // Validation
  if (!title || !description || !event_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Title, description, event_date, start_time, and end_time are required' });
  }
  
  if (!location && !online_link) {
    return res.status(400).json({ error: 'Either location or online_link must be provided' });
  }
  
  if (end_time <= start_time) {
    return res.status(400).json({ error: 'end_time must be after start_time' });
  }
  
  const maxParts = parseInt(max_participants, 10);
  if (isNaN(maxParts) || maxParts < 0) {
    return res.status(400).json({ error: 'max_participants must be an integer >= 0' });
  }
  
  if (registration_deadline) {
    const eventStart = new Date(`${event_date}T${start_time}`);
    const deadline = new Date(registration_deadline);
    if (deadline >= eventStart) {
      return res.status(400).json({ error: 'registration_deadline must be before event start' });
    }
  }
  
  try {
    const [r] = await pool.query(
      `INSERT INTO events (title, description, event_date, start_time, end_time, location, online_link, 
       max_participants, registration_deadline, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
      [title, description, event_date, start_time, end_time, location || null, online_link || null, 
       maxParts, registration_deadline || null, req.session.userId]
    );
    res.json({ message: 'Event created successfully', eventId: r.insertId });
  } catch (e) {
    console.error('Error creating event:', e);
    if (e.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
      return res.status(400).json({ error: 'Validation failed: end_time must be after start_time' });
    }
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT /api/events/:id - Update event (organizer only, own events)
app.put('/api/events/:id', requireOrganizer, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  const { title, description, event_date, start_time, end_time, location, online_link, max_participants, registration_deadline, status } = req.body;
  
  try {
    // Check ownership
    const [check] = await pool.query('SELECT created_by FROM events WHERE id = ?', [eventId]);
    if (!check.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (check[0].created_by !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized to update this event' });
    }
    
    // Validation if fields are provided
    if (start_time && end_time && end_time <= start_time) {
      return res.status(400).json({ error: 'end_time must be after start_time' });
    }
    
    if (max_participants !== undefined) {
      const maxParts = parseInt(max_participants, 10);
      if (isNaN(maxParts) || maxParts < 0) {
        return res.status(400).json({ error: 'max_participants must be an integer >= 0' });
      }
    }
    
    if (registration_deadline && event_date && start_time) {
      const eventStart = new Date(`${event_date}T${start_time}`);
      const deadline = new Date(registration_deadline);
      if (deadline >= eventStart) {
        return res.status(400).json({ error: 'registration_deadline must be before event start' });
      }
    }
    
    // Build update query
    const updates = [];
    const values = [];
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (event_date !== undefined) { updates.push('event_date = ?'); values.push(event_date); }
    if (start_time !== undefined) { updates.push('start_time = ?'); values.push(start_time); }
    if (end_time !== undefined) { updates.push('end_time = ?'); values.push(end_time); }
    if (location !== undefined) { updates.push('location = ?'); values.push(location); }
    if (online_link !== undefined) { updates.push('online_link = ?'); values.push(online_link); }
    if (max_participants !== undefined) { updates.push('max_participants = ?'); values.push(parseInt(max_participants, 10)); }
    if (registration_deadline !== undefined) { updates.push('registration_deadline = ?'); values.push(registration_deadline || null); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    
    if (updates.length === 0) {
      return res.json({ message: 'No changes provided' });
    }
    
    values.push(eventId);
    const [result] = await pool.query(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`, values);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Event not found or no changes made' });
    }
    
    res.json({ message: 'Event updated successfully' });
  } catch (e) {
    console.error('Error updating event:', e);
    if (e.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
      return res.status(400).json({ error: 'Validation failed: end_time must be after start_time' });
    }
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE /api/events/:id - Delete event (organizer only, own events)
app.delete('/api/events/:id', requireOrganizer, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  
  try {
    const [check] = await pool.query('SELECT created_by, status FROM events WHERE id = ?', [eventId]);
    if (!check.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (check[0].created_by !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized to delete this event' });
    }
    
    // If published, soft-close instead of delete
    if (check[0].status === 'published') {
      await pool.query('UPDATE events SET status = ? WHERE id = ?', ['closed', eventId]);
      return res.json({ message: 'Published event closed instead of deleted' });
    }
    
    // Delete draft or closed events
    await pool.query('DELETE FROM events WHERE id = ?', [eventId]);
    res.json({ message: 'Event deleted successfully' });
  } catch (e) {
    console.error('Error deleting event:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/events/:id/publish - Publish event
app.post('/api/events/:id/publish', requireOrganizer, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  
  try {
    const [check] = await pool.query('SELECT created_by, status FROM events WHERE id = ?', [eventId]);
    if (!check.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (check[0].created_by !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await pool.query('UPDATE events SET status = ? WHERE id = ?', ['published', eventId]);
    res.json({ message: 'Event published successfully' });
  } catch (e) {
    console.error('Error publishing event:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/events/:id/close - Close event
app.post('/api/events/:id/close', requireOrganizer, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  
  try {
    const [check] = await pool.query('SELECT created_by FROM events WHERE id = ?', [eventId]);
    if (!check.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    if (check[0].created_by !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    
    await pool.query('UPDATE events SET status = ? WHERE id = ?', ['closed', eventId]);
    res.json({ message: 'Event closed successfully' });
  } catch (e) {
    console.error('Error closing event:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/events/:id/registrations', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const eventId = parseInt(req.params.id, 10);
  try {
    const [check] = await pool.query('SELECT created_by FROM events WHERE id = ?', [eventId]);
    if (!check.length) return res.status(404).json({ success: false, message: 'Event not found' });
    if (check[0].created_by !== uid) return res.status(403).json({ success: false, message: 'Not authorized' });
    const [rows] = await pool.query(
      `SELECT er.id, er.status, er.registered_at, u.id as user_id, u.email, up.full_name, up.department
       FROM event_registrations er
       JOIN users u ON u.id = er.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE er.event_id = ?
       ORDER BY er.registered_at DESC`,
      [eventId]
    );
    res.json({ success: true, registrations: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/events/:id/notify', async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const eventId = parseInt(req.params.id, 10);
  const { title, message, type } = req.body;
  if (!title || !message) return res.status(400).json({ success: false, message: 'title and message required' });
  try {
    const [check] = await pool.query('SELECT created_by FROM events WHERE id = ?', [eventId]);
    if (!check.length) return res.status(404).json({ success: false, message: 'Event not found' });
    if (check[0].created_by !== uid) return res.status(403).json({ success: false, message: 'Not authorized' });
    const [regs] = await pool.query('SELECT user_id FROM event_registrations WHERE event_id = ? AND status != ?', [eventId, 'cancelled']);
    const notifType = type || 'general';
    for (const reg of regs) {
      await pool.query('INSERT INTO notifications (user_id, title, message, type, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
        [reg.user_id, title, message, notifType, 'event', eventId]);
    }
    res.json({ success: true, message: `Notification sent to ${regs.length} participants` });
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
app.get('/organizer-home', (req, res) => res.sendFile(path.join(__dirname, 'organizer-home.html')));

// ==================== SERVER ====================

initDb().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});

process.on('SIGINT', async () => {
  if (pool) await pool.end();
  process.exit(0);
});
