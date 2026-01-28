const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
require('dotenv').config();

let ExcelJS;
try {
  ExcelJS = require('exceljs');
} catch (_) {
  ExcelJS = null;
}

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (_) {
  nodemailer = null;
}

const app = express();
const PORT = process.env.PORT || 3001;
const publicDir = path.join(__dirname, 'public');
const isProduction = process.env.NODE_ENV === 'production';

// MySQL config - set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in env or use defaults.
// These values also work for hosted MySQL (Render, Railway, AWS RDS, etc.).
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'campus_db',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;

// Ensure target database exists before creating the pool (local development only).
// For hosted databases, DB_HOST will typically not be localhost and this will be skipped.
async function ensureDatabaseExists() {
  if (dbConfig.host !== 'localhost' && dbConfig.host !== '127.0.0.1') {
    // Do not attempt to CREATE DATABASE against hosted/remote MySQL instances.
    return;
  }
  const { database, ...baseConfig } = dbConfig;
  const conn = await mysql.createConnection({ ...baseConfig, multipleStatements: true });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
  await conn.end();
}

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
    // In local development, attempt to create the database automatically.
    // In production, prefer running database.sql manually during provisioning.
    if (!isProduction) {
      await ensureDatabaseExists();
    }
    pool = mysql.createPool(dbConfig);
    await pool.query('SELECT 1');
    console.log('Connected to MySQL database');
    await seedIfEmpty();
  } catch (err) {
    console.error('MySQL connection failed. Check that MySQL is running, credentials are correct, and the schema is loaded (database.sql).');
    console.error(`Tried config -> host:${dbConfig.host} user:${dbConfig.user} db:${dbConfig.database}`);
    console.error(err.message);
    process.exit(1);
  }
}

// Middleware
const corsOriginEnv = process.env.CORS_ORIGIN;
const corsOptions = {
  // If CORS_ORIGIN is set, use it (single origin or comma-separated list).
  // Otherwise, reflect the request origin (convenient for local development).
  origin: corsOriginEnv
    ? corsOriginEnv.split(',').map(o => o.trim()).filter(Boolean)
    : true,
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static(publicDir));

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

app.use(passport.initialize());

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
  if (req.session.role !== 'organizer' && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Organizer access required' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Helper: Log admin action
async function logAdminAction(adminId, adminEmail, action, targetType, targetId, details, ipAddress) {
  try {
    await pool.query(
      `INSERT INTO admin_logs (admin_id, admin_email, action, target_type, target_id, details, ip_address) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [adminId, adminEmail, action, targetType, targetId, JSON.stringify(details ?? {}), ipAddress]
    );
  } catch (e) {
    console.error('Failed to log admin action:', e);
  }
}

// Helper: Get system setting
async function getSetting(key) {
  try {
    const [rows] = await pool.query('SELECT setting_value, setting_type FROM system_settings WHERE setting_key = ?', [key]);
    if (!rows.length) return null;
    const { setting_value, setting_type } = rows[0];
    if (setting_type === 'boolean') return setting_value === 'true';
    if (setting_type === 'number') return parseInt(setting_value, 10);
    return setting_value;
  } catch (e) {
    console.error('Failed to get setting:', key, e);
    return null;
  }
}

// Helper: Get client IP
function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
}

// Helper: get user id from session
const getUserId = (req) => req.session.userId || null;

// Helper: parse local date/time strings like YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm:ss
function parseLocalDateTime(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0), 0);
  }
  const parsed = new Date(trimmed);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function toMySqlDateTimeLocal(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const dt = new Date(Number(y), Number(m) - 1, Number(d));
  return isNaN(dt.getTime()) ? null : dt;
}

const defaultRolePermissions = {
  admin: ['*'],
  organizer: ['event.create', 'event.update', 'event.publish', 'resource.book', 'message.send', 'analytics.view'],
  participant: ['resource.book', 'message.send']
};

async function hasPermission(userId, role, permKey) {
  if (!userId) return false;
  if (role === 'admin') return true;
  try {
    const [userOverride] = await pool.query(
      `SELECT up.allowed
       FROM user_permissions up
       JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = ? AND p.perm_key = ?
       LIMIT 1`,
      [userId, permKey]
    );
    if (userOverride.length) return userOverride[0].allowed === 1;

    const [roleRows] = await pool.query(
      `SELECT rp.allowed
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role = ? AND p.perm_key = ?
       LIMIT 1`,
      [role, permKey]
    );
    if (roleRows.length) return roleRows[0].allowed === 1;
  } catch (e) {
    console.warn('Permission lookup failed, falling back to defaults:', e.message);
  }

  const defaults = defaultRolePermissions[role] || [];
  if (defaults.includes('*')) return true;
  return defaults.includes(permKey);
}

const requirePermission = (permKey) => async (req, res, next) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Authentication required' });
  const allowed = await hasPermission(req.session.userId, req.session.role, permKey);
  if (!allowed) return res.status(403).json({ error: 'Permission denied' });
  next();
};

async function canManageEvent(eventId, userId, role) {
  if (!userId) return false;
  if (role === 'admin') return true;
  const [rows] = await pool.query('SELECT created_by FROM events WHERE id = ?', [eventId]);
  if (!rows.length) return false;
  if (rows[0].created_by === userId) return true;
  const [clubRows] = await pool.query(
    `SELECT 1
     FROM event_clubs ec
     JOIN club_members cm ON cm.club_id = ec.club_id
     WHERE ec.event_id = ? AND cm.user_id = ? AND cm.role IN ('head', 'coordinator')
     LIMIT 1`,
    [eventId, userId]
  );
  return clubRows.length > 0;
}

async function canDeleteEvent(eventId, userId, role) {
  if (!userId) return false;
  if (role === 'admin') return true;
  const [rows] = await pool.query('SELECT created_by FROM events WHERE id = ?', [eventId]);
  if (!rows.length) return false;
  return rows[0].created_by === userId;
}

const googleOAuthEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_CALLBACK_URL);

if (googleOAuthEnabled) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile?.emails?.[0]?.value;
      if (!email) return done(new Error('Google profile has no email'));
      const [existing] = await pool.query('SELECT id, email, role, is_active, deleted_at FROM users WHERE email = ?', [email]);
      let userId;
      if (!existing.length) {
        const hashed = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
        const [ins] = await pool.query(
          'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
          [email, hashed, 'participant']
        );
        userId = ins.insertId;
        await pool.query(
          'INSERT INTO user_profiles (user_id, full_name, profile_visibility) VALUES (?, ?, ?)',
          [userId, profile.displayName || email.split('@')[0], 'internal']
        );
      } else {
        const user = existing[0];
        if (!user.is_active || user.deleted_at) {
          return done(new Error('Account is disabled or deleted'));
        }
        userId = user.id;
      }

      await pool.query(
        'INSERT INTO oauth_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)',
        [userId, 'google', profile.id]
      );
      const [userRows] = await pool.query('SELECT id, email, role FROM users WHERE id = ?', [userId]);
      return done(null, userRows[0]);
    } catch (e) {
      return done(e);
    }
  }));
}

let mailerTransport = null;
function getMailer() {
  if (!nodemailer) return null;
  if (mailerTransport) return mailerTransport;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '0', 10);
  if (!host || !port) return null;
  mailerTransport = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  return mailerTransport;
}

async function sendOtpEmail(email, code) {
  const mailer = getMailer();
  if (!mailer) return false;
  const from = process.env.MAIL_FROM || 'no-reply@campus-hub.local';
  await mailer.sendMail({
    from,
    to: email,
    subject: 'Your Campus Hub OTP',
    text: `Your OTP code is ${code}. It expires in 10 minutes.`
  });
  return true;
}

// Maintenance mode: block non-admin write operations
app.use(async (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.path === '/login' || req.path === '/logout' || req.path === '/register' ||
      req.path.startsWith('/auth/')) return next();
  try {
    const maintenance = await getSetting('maintenance_mode');
    if (maintenance && req.session?.role !== 'admin') {
      return res.status(503).json({ success: false, message: 'System is in maintenance mode. Please try again later.' });
    }
  } catch (_) {
    // If settings lookup fails, fall through to avoid blocking all writes.
  }
  next();
});

// ==================== AUTH ====================

app.post('/auth/request-otp', async (req, res) => {
  const { email, purpose } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email required' });
  const otpPurpose = purpose === 'verify' ? 'verify' : 'login';
  try {
    const [users] = await pool.query('SELECT id, is_active, deleted_at FROM users WHERE email = ?', [email]);
    const userExists = users.length > 0;
    if (otpPurpose === 'login' && userExists) {
      if (!users[0].is_active || users[0].deleted_at) {
        return res.status(403).json({ success: false, message: 'Account is disabled or deleted' });
      }
    }
    const allowRegistrations = await getSetting('allow_new_registrations');
    if (otpPurpose === 'login' && !userExists && allowRegistrations === false) {
      return res.status(403).json({ success: false, message: 'New registrations are currently disabled' });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const hash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      'INSERT INTO otp_codes (email, code_hash, purpose, expires_at) VALUES (?, ?, ?, ?)',
      [email, hash, otpPurpose, toMySqlDateTimeLocal(expiresAt)]
    );

    const sent = await sendOtpEmail(email, code);
    if (!sent) {
      console.log(`[OTP] ${email} -> ${code}`);
    }

    const devEcho = process.env.OTP_DEV_ECHO === 'true';
    res.json({
      success: true,
      message: sent ? 'OTP sent to your email' : 'OTP generated',
      ...(devEcho ? { otp: code } : {})
    });
  } catch (e) {
    console.error('OTP request failed:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/auth/verify-otp', async (req, res) => {
  const { email, code, purpose } = req.body;
  if (!email || !code) return res.status(400).json({ success: false, message: 'Email and code required' });
  const otpPurpose = purpose === 'verify' ? 'verify' : 'login';
  try {
    const [rows] = await pool.query(
      `SELECT * FROM otp_codes 
       WHERE email = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, otpPurpose]
    );
    if (!rows.length) return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    const otpRow = rows[0];
    const ok = await bcrypt.compare(String(code), otpRow.code_hash);
    if (!ok) return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });

    await pool.query('UPDATE otp_codes SET consumed_at = NOW() WHERE id = ?', [otpRow.id]);

    let [users] = await pool.query('SELECT id, email, role, is_active, deleted_at FROM users WHERE email = ?', [email]);
    if (!users.length) {
      const allowRegistrations = await getSetting('allow_new_registrations');
      if (allowRegistrations === false) {
        return res.status(403).json({ success: false, message: 'New registrations are currently disabled' });
      }
      const hashed = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const [ins] = await pool.query(
        'INSERT INTO users (email, password, role) VALUES (?, ?, ?)',
        [email, hashed, 'participant']
      );
      const uid = ins.insertId;
      await pool.query('INSERT INTO user_profiles (user_id, full_name) VALUES (?, ?)', [uid, email.split('@')[0]]);
      users = [{ id: uid, email, role: 'participant', is_active: 1, deleted_at: null }];
    }
    const user = users[0];
    if (!user.is_active || user.deleted_at) {
      return res.status(403).json({ success: false, message: 'Account is disabled or deleted' });
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.email = user.email;
    res.json({ success: true, message: 'OTP verified', user: { id: user.id, email: user.email, role: user.role } });
  } catch (e) {
    console.error('OTP verify failed:', e);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.get('/auth/google', (req, res, next) => {
  if (!googleOAuthEnabled) {
    return res.status(503).json({ success: false, message: 'Google OAuth not configured' });
  }
  passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!googleOAuthEnabled) {
    return res.status(503).json({ success: false, message: 'Google OAuth not configured' });
  }
  passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) {
      console.error('Google OAuth failed:', err);
      return res.redirect('/');
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.email = user.email;
    if (user.role === 'admin') return res.redirect('/admin-home');
    if (user.role === 'organizer') return res.redirect('/organizer-home');
    return res.redirect('/student-home');
  })(req, res, next);
});

app.post('/register', async (req, res) => {
  // Check if registrations are allowed
  const allowRegistrations = await getSetting('allow_new_registrations');
  if (allowRegistrations === false) {
    return res.status(403).json({ success: false, message: 'New registrations are currently disabled' });
  }

  const { email, password, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }
  const requestedRole = role ? role.toLowerCase() : '';
  const allowAdminSignup = process.env.ALLOW_ADMIN_SIGNUP === 'true';
  const validRoles = allowAdminSignup ? ['admin', 'organizer', 'participant'] : ['organizer', 'participant'];
  const userRole = validRoles.includes(requestedRole) ? requestedRole : 'participant';

  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (rows.length) {
      return res.status(409).json({ success: false, message: 'Email already registered.' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const [r] = await pool.query('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', [email, hashed, userRole]);
    const uid = r.insertId;
    await pool.query('INSERT INTO user_profiles (user_id, full_name) VALUES (?, ?)', [uid, email.split('@')[0]]);
    // Auto-login newly registered users
    req.session.userId = uid;
    req.session.role = userRole;
    req.session.email = email;
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
    // Check if account is active
    if (!user.is_active || user.deleted_at) {
      return res.status(403).json({ success: false, message: 'Account is disabled or deleted' });
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

app.get('/api/profile', requireAuth, async (req, res) => {
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

// Public/Internal profile viewing with visibility rules
app.get('/api/profiles/:id', async (req, res) => {
  const viewerId = req.session?.userId || null;
  const viewerRole = req.session?.role || null;
  const targetId = parseInt(req.params.id, 10);
  if (!targetId) return res.status(400).json({ success: false, message: 'Invalid user id' });
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.role, up.full_name, up.department, up.academic_year, up.phone, up.bio, up.profile_visibility
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = ?`,
      [targetId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    const p = rows[0];
    const visibility = p.profile_visibility || 'internal';
    const isSelf = viewerId === p.id;
    const isAdmin = viewerRole === 'admin';

    if (visibility === 'private' && !isSelf && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Profile is private' });
    }
    if (visibility === 'internal' && !viewerId && !isAdmin) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const baseProfile = {
      id: p.id,
      full_name: p.full_name,
      department: p.department,
      academic_year: p.academic_year,
      role: p.role,
      profile_visibility: visibility
    };
    if (isSelf || isAdmin) {
      baseProfile.email = p.email;
      baseProfile.phone = p.phone;
      baseProfile.bio = p.bio;
    }

    res.json({ success: true, profile: baseProfile });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/profile', requireAuth, async (req, res) => {
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

app.get('/api/profile/clubs', requireAuth, async (req, res) => {
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

app.post('/api/clubs/join', requireAuth, async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const { clubId } = req.body;
  if (!clubId) return res.status(400).json({ success: false, message: 'clubId required' });
  try {
    await pool.query('INSERT IGNORE INTO club_members (club_id, user_id, role) VALUES (?, ?, ?)', [clubId, uid, 'member']);
    const [threads] = await pool.query('SELECT id FROM message_threads WHERE type = ? AND ref_id = ? LIMIT 1', ['club', clubId]);
    if (threads.length) {
      await pool.query('INSERT IGNORE INTO message_participants (thread_id, user_id, role) VALUES (?, ?, ?)', [threads[0].id, uid, 'member']);
    }
    res.json({ success: true, message: 'Joined club' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// User search (for messaging / directory)
app.get('/api/users/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ success: true, users: [] });
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.email, u.role, up.full_name, up.department, up.profile_visibility
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE (u.email LIKE ? OR up.full_name LIKE ?)
         AND u.is_active = 1 AND u.deleted_at IS NULL
       ORDER BY up.full_name, u.email
       LIMIT 20`,
      [`%${q}%`, `%${q}%`]
    );
    const viewerRole = req.session.role;
    const viewerId = req.session.userId;
    const users = rows.filter(r => {
      if (r.id === viewerId) return true;
      if (viewerRole === 'admin') return true;
      const visibility = r.profile_visibility || 'internal';
      if (visibility === 'private') return false;
      return true;
    }).map(r => ({
      id: r.id,
      full_name: r.full_name,
      department: r.department,
      role: r.role,
      email: r.profile_visibility === 'public' || r.profile_visibility === 'internal' || viewerRole === 'admin' ? r.email : undefined
    }));
    res.json({ success: true, users });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== EVENTS ====================

app.get('/api/events', async (req, res) => {
  const uid = req.session?.userId || null;
  const role = req.session?.role || null;
  try {
    let where = `e.status IN ('published', 'closed', 'completed')`;
    const params = [];
    if (!uid) {
      where += ` AND e.visibility = 'public'`;
    } else if (role !== 'admin') {
      where += ` AND (
        e.visibility = 'public' OR
        e.visibility = 'internal' OR
        (e.visibility = 'club' AND EXISTS (
          SELECT 1 FROM event_clubs ec
          JOIN club_members cm ON cm.club_id = ec.club_id
          WHERE ec.event_id = e.id AND cm.user_id = ?
        ))
      )`;
      params.push(uid);
    }

    const [rows] = await pool.query(
      `SELECT 
         e.id,
         e.title,
         e.description,
         e.status,
         e.event_date,
         e.end_date,
         e.start_time,
         e.end_time,
         e.location,
         e.online_link,
         e.max_participants,
         e.registration_deadline,
         e.visibility,
         (
           SELECT GROUP_CONCAT(c.name SEPARATOR ', ')
           FROM event_clubs ec
           JOIN clubs c ON c.id = ec.club_id
           WHERE ec.event_id = e.id
         ) AS club_name
       FROM events e
       WHERE ${where}
       ORDER BY e.event_date DESC, e.start_time DESC
       LIMIT 50`,
      params
    );
    res.json({ success: true, events: rows });
  } catch (e) {
    console.error('Error fetching events list:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/events/registered', requireAuth, async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  try {
    const [rows] = await pool.query(
      `SELECT 
         e.id,
         e.title,
         e.event_date,
         e.end_date,
         e.start_time,
         e.end_time,
         e.location,
         e.visibility,
         er.status as reg_status,
         (
           SELECT GROUP_CONCAT(c.name SEPARATOR ', ')
           FROM event_clubs ec
           JOIN clubs c ON c.id = ec.club_id
           WHERE ec.event_id = e.id
         ) AS club_name
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.user_id = ? AND er.status != 'cancelled'
       ORDER BY e.event_date DESC, e.start_time DESC
       LIMIT 50`,
      [uid]
    );
    res.json({ success: true, events: rows });
  } catch (e) {
    console.error('Error fetching registered events:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Organizer helper: list own events with success flag (used by modals)
app.get('/api/events/my-events', requireOrganizer, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, description, event_date, end_date, start_time, end_time, location, online_link,
              max_participants, registration_deadline, visibility, status, budget_total, budget_used, budget_currency, budget_notes,
              created_at, updated_at
       FROM events 
       WHERE created_by = ?
          OR EXISTS (
            SELECT 1 FROM event_clubs ec
            JOIN club_members cm ON cm.club_id = ec.club_id
            WHERE ec.event_id = events.id AND cm.user_id = ? AND cm.role IN ('head','coordinator')
          )
       ORDER BY event_date ASC, start_time ASC`,
      [req.session.userId, req.session.userId]
    );
    res.json({ success: true, events: rows });
  } catch (e) {
    console.error('Error fetching organizer my-events:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/events/register', requireAuth, async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const { eventId } = req.body;
  if (!eventId) return res.status(400).json({ success: false, message: 'eventId required' });
  try {
    const registrationsFrozen = await getSetting('registrations_frozen');
    if (registrationsFrozen) {
      return res.status(403).json({ success: false, message: 'Event registrations are currently frozen' });
    }
    const [events] = await pool.query('SELECT status, registration_deadline, max_participants, visibility FROM events WHERE id = ?', [eventId]);
    if (!events.length) return res.status(404).json({ success: false, message: 'Event not found' });
    if (events[0].status !== 'published') {
      return res.status(403).json({ success: false, message: 'Registrations are closed for this event' });
    }
    if (events[0].visibility === 'club') {
      const [allowed] = await pool.query(
        `SELECT 1 FROM event_clubs ec
         JOIN club_members cm ON cm.club_id = ec.club_id
         WHERE ec.event_id = ? AND cm.user_id = ?
         LIMIT 1`,
        [eventId, uid]
      );
      if (!allowed.length) {
        return res.status(403).json({ success: false, message: 'This event is restricted to club members' });
      }
    }
    const [existing] = await pool.query('SELECT status FROM event_registrations WHERE event_id = ? AND user_id = ?', [eventId, uid]);
    if (existing.length && existing[0].status !== 'cancelled') {
      return res.json({ success: true, message: 'Already registered' });
    }
    if (events[0].registration_deadline) {
      const deadline = parseLocalDateTime(events[0].registration_deadline);
      if (deadline && deadline.getTime() < Date.now()) {
        return res.status(403).json({ success: false, message: 'Registration deadline has passed' });
      }
    }
    const maxParticipants = parseInt(events[0].max_participants, 10);
    if (!isNaN(maxParticipants) && maxParticipants > 0) {
      const [countRows] = await pool.query(
        'SELECT COUNT(*) as c FROM event_registrations WHERE event_id = ? AND status != ?',
        [eventId, 'cancelled']
      );
      if (countRows[0].c >= maxParticipants) {
        return res.status(409).json({ success: false, message: 'Event is full' });
      }
    }
    if (existing.length && existing[0].status === 'cancelled') {
      await pool.query(
        'UPDATE event_registrations SET status = ?, registered_at = NOW() WHERE event_id = ? AND user_id = ?',
        ['registered', eventId, uid]
      );
      return res.json({ success: true, message: 'Registration restored' });
    }
    await pool.query('INSERT IGNORE INTO event_registrations (event_id, user_id) VALUES (?, ?)', [eventId, uid]);
    const [threads] = await pool.query('SELECT id FROM message_threads WHERE type = ? AND ref_id = ? LIMIT 1', ['event', eventId]);
    if (threads.length) {
      await pool.query('INSERT IGNORE INTO message_participants (thread_id, user_id, role) VALUES (?, ?, ?)', [threads[0].id, uid, 'member']);
    }
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
      `SELECT id, title, description, event_date, end_date, start_time, end_time, location, online_link, 
       max_participants, registration_deadline, visibility, status, budget_total, budget_used, budget_currency, budget_notes,
       created_at, updated_at
       FROM events
       WHERE created_by = ?
          OR EXISTS (
            SELECT 1 FROM event_clubs ec
            JOIN club_members cm ON cm.club_id = ec.club_id
            WHERE ec.event_id = events.id AND cm.user_id = ? AND cm.role IN ('head','coordinator')
          )
       ORDER BY event_date ASC, start_time ASC`,
      [req.session.userId, req.session.userId]
    );
    res.json({ success: true, events: rows });
  } catch (e) {
    console.error('Error fetching events:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/events - Create event (organizer only)
app.post('/api/events', requireOrganizer, requirePermission('event.create'), async (req, res) => {
  const { title, description, event_date, end_date, start_time, end_time, location, online_link, max_participants, registration_deadline, status, visibility, budget_total, budget_used, budget_currency, budget_notes, clubIds, clubRoles } = req.body;
  
  // Ensure session has userId
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  
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

  const startDate = parseDateOnly(event_date);
  if (!startDate) {
    return res.status(400).json({ error: 'Invalid event_date format' });
  }
  const endDate = end_date ? parseDateOnly(end_date) : startDate;
  if (!endDate) {
    return res.status(400).json({ error: 'Invalid end_date format' });
  }
  if (endDate < startDate) {
    return res.status(400).json({ error: 'end_date must be on or after event_date' });
  }
  const endDateValue = end_date || event_date;

  const visibilityValue = visibility ? String(visibility) : 'public';
  if (!['public', 'internal', 'club'].includes(visibilityValue)) {
    return res.status(400).json({ error: 'Invalid visibility value' });
  }

  const maxParts = parseInt(max_participants, 10);
  if (isNaN(maxParts) || maxParts < 0) {
    return res.status(400).json({ error: 'max_participants must be an integer >= 0' });
  }

  const budgetTotal = budget_total !== undefined && budget_total !== null && String(budget_total) !== ''
    ? parseFloat(budget_total) : 0;
  if (isNaN(budgetTotal) || budgetTotal < 0) {
    return res.status(400).json({ error: 'budget_total must be a number >= 0' });
  }
  const budgetUsed = budget_used !== undefined && budget_used !== null && String(budget_used) !== ''
    ? parseFloat(budget_used) : 0;
  if (isNaN(budgetUsed) || budgetUsed < 0) {
    return res.status(400).json({ error: 'budget_used must be a number >= 0' });
  }
  if (budgetUsed > budgetTotal) {
    return res.status(400).json({ error: 'budget_used cannot exceed budget_total' });
  }
  const budgetCurrency = (budget_currency || 'USD').toString().toUpperCase().slice(0, 3);

  const allowedCreateStatuses = ['draft', 'published'];
  const requestedStatus = status ? String(status) : 'draft';
  if (!allowedCreateStatuses.includes(requestedStatus)) {
    return res.status(400).json({ error: 'Invalid status for new event' });
  }

  const clubIdList = Array.isArray(clubIds) ? clubIds.map(id => parseInt(id, 10)).filter(Boolean) : [];
  if (visibilityValue === 'club' && clubIdList.length === 0) {
    return res.status(400).json({ error: 'Club visibility requires at least one club' });
  }
  
  // Validate and format registration_deadline
  let formattedDeadline = null;
  if (registration_deadline) {
    const deadline = parseLocalDateTime(registration_deadline);
    if (!deadline) {
      return res.status(400).json({ error: 'Invalid registration deadline format' });
    }
    const eventStart = parseLocalDateTime(`${event_date}T${start_time}`);
    if (eventStart && deadline >= eventStart) {
      return res.status(400).json({ error: 'registration_deadline must be before event start' });
    }
    // Format as MySQL DATETIME: YYYY-MM-DD HH:MM:SS
    formattedDeadline = toMySqlDateTimeLocal(deadline);
  }
  
  try {
    // Check if approval workflow is enabled
    const approvalRequired = await getSetting('event_approval_required');
    let initialStatus = requestedStatus;
    if (approvalRequired && requestedStatus === 'published') {
      initialStatus = 'pending_approval';
    }

    const maxEvents = await getSetting('max_events_per_organizer');
    if (Number.isFinite(maxEvents) && maxEvents > 0) {
      const [countRows] = await pool.query('SELECT COUNT(*) as c FROM events WHERE created_by = ?', [req.session.userId]);
      if (countRows[0].c >= maxEvents) {
        return res.status(403).json({ error: `Event limit reached (${maxEvents}).` });
      }
    }

    if (clubIdList.length && req.session.role !== 'admin') {
      const placeholders = clubIdList.map(() => '?').join(',');
      const [allowed] = await pool.query(
        `SELECT club_id FROM club_members 
         WHERE user_id = ? AND role IN ('head', 'coordinator') AND club_id IN (${placeholders})`,
        [req.session.userId, ...clubIdList]
      );
      if (allowed.length !== clubIdList.length) {
        return res.status(403).json({ error: 'You can only attach clubs you head or coordinate' });
      }
    }

    const [r] = await pool.query(
      `INSERT INTO events (title, description, event_date, end_date, start_time, end_time, location, online_link, 
       max_participants, registration_deadline, visibility, budget_total, budget_used, budget_currency, budget_notes,
       created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, event_date, endDateValue, start_time, end_time, location || null, online_link || null, 
       maxParts, formattedDeadline, visibilityValue, budgetTotal, budgetUsed, budgetCurrency, budget_notes || null,
       req.session.userId, initialStatus]
    );
    if (clubIdList.length) {
      for (const cid of clubIdList) {
        const roleValue = clubRoles && (clubRoles[cid] || clubRoles[String(cid)])
          ? String(clubRoles[cid] || clubRoles[String(cid)])
          : 'host';
        await pool.query(
          'INSERT IGNORE INTO event_clubs (event_id, club_id, role) VALUES (?, ?, ?)',
          [r.insertId, cid, roleValue]
        );
      }
    }
    let message = 'Event created successfully';
    if (initialStatus === 'pending_approval') message = 'Event created and submitted for approval';
    if (initialStatus === 'draft') message = 'Event saved as draft';
    res.json({
      message,
      eventId: r.insertId,
      status: initialStatus
    });
  } catch (e) {
    console.error('Error creating event:', e);
    console.error('Error code:', e.code);
    console.error('Error sqlMessage:', e.sqlMessage);
    console.error('Session userId:', req.session.userId);
    
    if (e.code === 'ER_CHECK_CONSTRAINT_VIOLATED') {
      return res.status(400).json({ error: 'Validation failed: end_time must be after start_time' });
    }
    if (e.code === 'ER_BAD_NULL_ERROR' || e.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ error: 'Invalid user session. Please log out and log in again.' });
    }
    res.status(500).json({ error: 'Database error: ' + (e.sqlMessage || e.message) });
  }
});

// PUT /api/events/:id - Update event (organizer only, own or collaborator)
app.put('/api/events/:id', requireOrganizer, requirePermission('event.update'), async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  const { title, description, event_date, end_date, start_time, end_time, location, online_link, max_participants, registration_deadline, status, visibility, budget_total, budget_used, budget_currency, budget_notes, clubIds, clubRoles } = req.body;
  
  try {
    // Check ownership or collaborator access
    const [check] = await pool.query(
      'SELECT created_by, event_date, end_date, start_time, visibility, budget_total, budget_used FROM events WHERE id = ?',
      [eventId]
    );
    if (!check.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const canManage = await canManageEvent(eventId, req.session.userId, req.session.role);
    if (!canManage) {
      return res.status(403).json({ error: 'Not authorized to update this event' });
    }
    const currentEvent = check[0];
    
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

    const effectiveEventDate = event_date || currentEvent.event_date;
    if (event_date !== undefined) {
      const startDate = parseDateOnly(event_date);
      if (!startDate) return res.status(400).json({ error: 'Invalid event_date format' });
    }
    if (end_date !== undefined) {
      const endDate = end_date ? parseDateOnly(end_date) : null;
      if (end_date && !endDate) return res.status(400).json({ error: 'Invalid end_date format' });
    }
    if (event_date !== undefined || end_date !== undefined) {
      const startDate = parseDateOnly(effectiveEventDate);
      const endDate = parseDateOnly(end_date || currentEvent.end_date || effectiveEventDate);
      if (startDate && endDate && endDate < startDate) {
        return res.status(400).json({ error: 'end_date must be on or after event_date' });
      }
    }

    const visibilityValue = visibility !== undefined ? String(visibility) : currentEvent.visibility;
    if (visibility !== undefined && !['public', 'internal', 'club'].includes(visibilityValue)) {
      return res.status(400).json({ error: 'Invalid visibility value' });
    }

    const newBudgetTotal = budget_total !== undefined ? parseFloat(budget_total) : Number(currentEvent.budget_total || 0);
    const newBudgetUsed = budget_used !== undefined ? parseFloat(budget_used) : Number(currentEvent.budget_used || 0);
    if (budget_total !== undefined && (isNaN(newBudgetTotal) || newBudgetTotal < 0)) {
      return res.status(400).json({ error: 'budget_total must be a number >= 0' });
    }
    if (budget_used !== undefined && (isNaN(newBudgetUsed) || newBudgetUsed < 0)) {
      return res.status(400).json({ error: 'budget_used must be a number >= 0' });
    }
    if (newBudgetUsed > newBudgetTotal) {
      return res.status(400).json({ error: 'budget_used cannot exceed budget_total' });
    }

    const clubIdList = Array.isArray(clubIds) ? clubIds.map(id => parseInt(id, 10)).filter(Boolean) : null;
    if (visibilityValue === 'club') {
      if (clubIdList && clubIdList.length === 0) {
        return res.status(400).json({ error: 'Club visibility requires at least one club' });
      }
      if (!clubIdList) {
        const [clubCount] = await pool.query('SELECT COUNT(*) as c FROM event_clubs WHERE event_id = ?', [eventId]);
        if (!clubCount[0]?.c) {
          return res.status(400).json({ error: 'Club visibility requires at least one club' });
        }
      }
    }
    if (clubIdList && clubIdList.length && req.session.role !== 'admin') {
      const placeholders = clubIdList.map(() => '?').join(',');
      const [allowed] = await pool.query(
        `SELECT club_id FROM club_members 
         WHERE user_id = ? AND role IN ('head', 'coordinator') AND club_id IN (${placeholders})`,
        [req.session.userId, ...clubIdList]
      );
      if (allowed.length !== clubIdList.length) {
        return res.status(403).json({ error: 'You can only attach clubs you head or coordinate' });
      }
    }
    
    // Validate and format registration_deadline if provided
    let formattedDeadline = undefined;
    if (registration_deadline !== undefined) {
      if (registration_deadline) {
        const deadline = parseLocalDateTime(registration_deadline);
        if (!deadline) {
          return res.status(400).json({ error: 'Invalid registration deadline format' });
        }
        const deadlineEventDate = event_date || currentEvent.event_date;
        const deadlineStartTime = start_time || currentEvent.start_time;
        if (deadlineEventDate && deadlineStartTime) {
          const eventStart = parseLocalDateTime(`${deadlineEventDate}T${deadlineStartTime}`);
          if (eventStart && deadline >= eventStart) {
            return res.status(400).json({ error: 'registration_deadline must be before event start' });
          }
        }
        // Format as MySQL DATETIME: YYYY-MM-DD HH:MM:SS
        formattedDeadline = toMySqlDateTimeLocal(deadline);
      } else {
        formattedDeadline = null;
      }
    }

    let normalizedStatus = status;
    if (status !== undefined) {
      const allowedStatuses = ['draft', 'pending_approval', 'published', 'closed', 'completed'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      const approvalRequired = await getSetting('event_approval_required');
      if (approvalRequired && status === 'published') {
        normalizedStatus = 'pending_approval';
      }
    }
    
    // Build update query
    const updates = [];
    const values = [];
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (event_date !== undefined) { updates.push('event_date = ?'); values.push(event_date); }
    if (end_date !== undefined) { updates.push('end_date = ?'); values.push(end_date || event_date || currentEvent.event_date); }
    if (start_time !== undefined) { updates.push('start_time = ?'); values.push(start_time); }
    if (end_time !== undefined) { updates.push('end_time = ?'); values.push(end_time); }
    if (location !== undefined) { updates.push('location = ?'); values.push(location); }
    if (online_link !== undefined) { updates.push('online_link = ?'); values.push(online_link); }
    if (max_participants !== undefined) { updates.push('max_participants = ?'); values.push(parseInt(max_participants, 10)); }
    if (formattedDeadline !== undefined) { updates.push('registration_deadline = ?'); values.push(formattedDeadline); }
    if (visibility !== undefined) { updates.push('visibility = ?'); values.push(visibilityValue); }
    if (budget_total !== undefined) { updates.push('budget_total = ?'); values.push(newBudgetTotal); }
    if (budget_used !== undefined) { updates.push('budget_used = ?'); values.push(newBudgetUsed); }
    if (budget_currency !== undefined) { updates.push('budget_currency = ?'); values.push(String(budget_currency || 'USD').toUpperCase().slice(0, 3)); }
    if (budget_notes !== undefined) { updates.push('budget_notes = ?'); values.push(budget_notes || null); }
    if (normalizedStatus !== undefined) { updates.push('status = ?'); values.push(normalizedStatus); }
    
    if (updates.length === 0) {
      return res.json({ message: 'No changes provided' });
    }
    
    values.push(eventId);
    const [result] = await pool.query(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`, values);

    if (clubIdList) {
      await pool.query('DELETE FROM event_clubs WHERE event_id = ?', [eventId]);
      for (const cid of clubIdList) {
        const roleValue = clubRoles && (clubRoles[cid] || clubRoles[String(cid)])
          ? String(clubRoles[cid] || clubRoles[String(cid)])
          : 'host';
        await pool.query(
          'INSERT IGNORE INTO event_clubs (event_id, club_id, role) VALUES (?, ?, ?)',
          [eventId, cid, roleValue]
        );
      }
    }
    
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

// DELETE /api/events/:id - Delete event (organizer only, owner or admin)
app.delete('/api/events/:id', requireOrganizer, requirePermission('event.update'), async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  
  try {
    const [check] = await pool.query('SELECT created_by, status FROM events WHERE id = ?', [eventId]);
    if (!check.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const allowed = await canDeleteEvent(eventId, req.session.userId, req.session.role);
    if (!allowed) return res.status(403).json({ error: 'Not authorized to delete this event' });
    
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
app.post('/api/events/:id/publish', requireOrganizer, requirePermission('event.publish'), async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  
  try {
    const [check] = await pool.query('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!check.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const canManage = await canManageEvent(eventId, req.session.userId, req.session.role);
    if (!canManage) return res.status(403).json({ error: 'Not authorized' });
    
    const approvalRequired = await getSetting('event_approval_required');
    const nextStatus = approvalRequired ? 'pending_approval' : 'published';
    await pool.query('UPDATE events SET status = ? WHERE id = ?', [nextStatus, eventId]);
    res.json({ message: approvalRequired ? 'Event submitted for approval' : 'Event published successfully', status: nextStatus });
  } catch (e) {
    console.error('Error publishing event:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/events/:id/close - Close event
app.post('/api/events/:id/close', requireOrganizer, requirePermission('event.update'), async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  
  try {
    const [check] = await pool.query('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!check.length) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const canManage = await canManageEvent(eventId, req.session.userId, req.session.role);
    if (!canManage) return res.status(403).json({ error: 'Not authorized' });
    
    await pool.query('UPDATE events SET status = ? WHERE id = ?', ['closed', eventId]);
    res.json({ message: 'Event closed successfully' });
  } catch (e) {
    console.error('Error closing event:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/events/:id/complete - Mark event completed
app.post('/api/events/:id/complete', requireOrganizer, requirePermission('event.update'), async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  try {
    const [check] = await pool.query('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!check.length) return res.status(404).json({ error: 'Event not found' });
    const canManage = await canManageEvent(eventId, req.session.userId, req.session.role);
    if (!canManage) return res.status(403).json({ error: 'Not authorized' });
    await pool.query('UPDATE events SET status = ?, completed_at = NOW() WHERE id = ?', ['completed', eventId]);
    res.json({ message: 'Event marked as completed' });
  } catch (e) {
    console.error('Error completing event:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/events/:id/registrations', requireOrganizer, async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const eventId = parseInt(req.params.id, 10);
  try {
    const [check] = await pool.query('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!check.length) return res.status(404).json({ success: false, message: 'Event not found' });
    const canManage = await canManageEvent(eventId, uid, req.session.role);
    if (!canManage) return res.status(403).json({ success: false, message: 'Not authorized' });
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

app.post('/api/events/:id/notify', requireOrganizer, requirePermission('event.update'), async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const eventId = parseInt(req.params.id, 10);
  const { title, message, type } = req.body;
  if (!title || !message) return res.status(400).json({ success: false, message: 'title and message required' });
  try {
    const [check] = await pool.query('SELECT id FROM events WHERE id = ?', [eventId]);
    if (!check.length) return res.status(404).json({ success: false, message: 'Event not found' });
    const canManage = await canManageEvent(eventId, uid, req.session.role);
    if (!canManage) return res.status(403).json({ success: false, message: 'Not authorized' });
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

app.get('/api/resources/bookings', requireAuth, async (req, res) => {
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

app.post('/api/resources/book', requireAuth, requirePermission('resource.book'), async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  const { resourceId, start_datetime, end_datetime, purpose } = req.body;
  if (!resourceId || !start_datetime || !end_datetime) {
    return res.status(400).json({ success: false, message: 'resourceId, start_datetime, end_datetime required' });
  }
  const start = parseLocalDateTime(start_datetime);
  const end = parseLocalDateTime(end_datetime);
  if (!start || !end) {
    return res.status(400).json({ success: false, message: 'Invalid start/end datetime format' });
  }
  if (end <= start) {
    return res.status(400).json({ success: false, message: 'end_datetime must be after start_datetime' });
  }
  try {
    const [r] = await pool.query('SELECT requires_approval FROM resources WHERE id = ?', [resourceId]);
    if (!r.length) return res.status(404).json({ success: false, message: 'Resource not found' });
    const [overlap] = await pool.query(
      `SELECT COUNT(*) as c
       FROM resource_bookings
       WHERE resource_id = ?
         AND status IN ('pending', 'approved')
         AND NOT (end_datetime <= ? OR start_datetime >= ?)`,
      [resourceId, start_datetime, end_datetime]
    );
    if (overlap[0].c > 0) {
      return res.status(409).json({ success: false, message: 'Resource is already booked for that time' });
    }
    const status = r[0].requires_approval ? 'pending' : 'approved';
    const [ins] = await pool.query(
      'INSERT INTO resource_bookings (resource_id, user_id, start_datetime, end_datetime, status, purpose) VALUES (?, ?, ?, ?, ?, ?)',
      [resourceId, uid, start_datetime, end_datetime, status, purpose || '']
    );
    await pool.query(
      'INSERT INTO resource_booking_logs (booking_id, action, actor_id, notes) VALUES (?, ?, ?, ?)',
      [ins.insertId, 'created', uid, 'Booking created']
    );
    res.json({ success: true, bookingId: ins.insertId, status, message: status === 'approved' ? 'Booking confirmed' : 'Booking pending approval' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== NOTIFICATIONS ====================

app.get('/api/notifications', requireAuth, async (req, res) => {
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

app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false });
  try {
    await pool.query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, uid]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// ==================== MESSAGES ====================

app.get('/api/messages/threads', requireAuth, async (req, res) => {
  const uid = getUserId(req);
  if (!uid) return res.status(401).json({ success: false, message: 'User ID required' });
  try {
    const [rows] = await pool.query(
      `SELECT mt.id, mt.type, mt.ref_id, mt.title, mt.created_at, mt.last_message_at,
              (SELECT m.body FROM messages m WHERE m.thread_id = mt.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT COUNT(*) FROM message_participants mp2 WHERE mp2.thread_id = mt.id) AS participant_count
       FROM message_participants mp
       JOIN message_threads mt ON mt.id = mp.thread_id
       WHERE mp.user_id = ?
       ORDER BY COALESCE(mt.last_message_at, mt.created_at) DESC
       LIMIT 30`,
      [uid]
    );
    res.json({ success: true, threads: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/messages/threads/:id', requireAuth, async (req, res) => {
  const uid = getUserId(req);
  const threadId = parseInt(req.params.id, 10);
  if (!threadId) return res.status(400).json({ success: false, message: 'Invalid thread id' });
  try {
    const [membership] = await pool.query('SELECT 1 FROM message_participants WHERE thread_id = ? AND user_id = ? LIMIT 1', [threadId, uid]);
    if (!membership.length) return res.status(403).json({ success: false, message: 'Not authorized' });
    const [threads] = await pool.query('SELECT id, type, ref_id, title, created_at, last_message_at FROM message_threads WHERE id = ?', [threadId]);
    if (!threads.length) return res.status(404).json({ success: false, message: 'Thread not found' });
    const [participants] = await pool.query(
      `SELECT u.id, u.email, up.full_name, mp.role
       FROM message_participants mp
       JOIN users u ON u.id = mp.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE mp.thread_id = ?
       ORDER BY up.full_name, u.email`,
      [threadId]
    );
    res.json({ success: true, thread: threads[0], participants });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/messages/threads/:id/messages', requireAuth, async (req, res) => {
  const uid = getUserId(req);
  const threadId = parseInt(req.params.id, 10);
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);
  if (!threadId) return res.status(400).json({ success: false, message: 'Invalid thread id' });
  try {
    const [membership] = await pool.query('SELECT 1 FROM message_participants WHERE thread_id = ? AND user_id = ? LIMIT 1', [threadId, uid]);
    if (!membership.length) return res.status(403).json({ success: false, message: 'Not authorized' });
    const [messages] = await pool.query(
      `SELECT m.id, m.body, m.created_at, m.sender_id, u.email, up.full_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE m.thread_id = ?
       ORDER BY m.created_at DESC
       LIMIT ?`,
      [threadId, limit]
    );
    res.json({ success: true, messages: messages.reverse() });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/messages/threads', requireAuth, requirePermission('message.send'), async (req, res) => {
  const uid = getUserId(req);
  const { type, userId, userIds, title, clubId, eventId, initialMessage } = req.body;
  const threadType = type || 'direct';
  try {
    if (threadType === 'direct') {
      if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
      const otherId = parseInt(userId, 10);
      const [existing] = await pool.query(
        `SELECT mt.id FROM message_threads mt
         JOIN message_participants mp1 ON mp1.thread_id = mt.id AND mp1.user_id = ?
         JOIN message_participants mp2 ON mp2.thread_id = mt.id AND mp2.user_id = ?
         WHERE mt.type = 'direct'
         LIMIT 1`,
        [uid, otherId]
      );
      if (existing.length) {
        return res.json({ success: true, threadId: existing[0].id, existing: true });
      }
      const [ins] = await pool.query('INSERT INTO message_threads (type, created_by, title) VALUES (?, ?, ?)', ['direct', uid, title || null]);
      await pool.query('INSERT IGNORE INTO message_participants (thread_id, user_id, role) VALUES (?, ?, ?), (?, ?, ?)', [ins.insertId, uid, 'owner', ins.insertId, otherId, 'member']);
      if (initialMessage) {
        await pool.query('INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?)', [ins.insertId, uid, initialMessage]);
        await pool.query('UPDATE message_threads SET last_message_at = NOW() WHERE id = ?', [ins.insertId]);
      }
      return res.json({ success: true, threadId: ins.insertId });
    }

    if (threadType === 'group') {
      const list = Array.isArray(userIds) ? userIds.map(id => parseInt(id, 10)).filter(Boolean) : [];
      if (!list.length) return res.status(400).json({ success: false, message: 'userIds required' });
      if (!list.includes(uid)) list.push(uid);
      const [ins] = await pool.query('INSERT INTO message_threads (type, created_by, title) VALUES (?, ?, ?)', ['group', uid, title || 'Group chat']);
      const values = [];
      list.forEach(id => {
        values.push([ins.insertId, id, id === uid ? 'owner' : 'member']);
      });
      await pool.query('INSERT IGNORE INTO message_participants (thread_id, user_id, role) VALUES ?', [values]);
      if (initialMessage) {
        await pool.query('INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?)', [ins.insertId, uid, initialMessage]);
        await pool.query('UPDATE message_threads SET last_message_at = NOW() WHERE id = ?', [ins.insertId]);
      }
      return res.json({ success: true, threadId: ins.insertId });
    }

    if (threadType === 'club') {
      if (!clubId) return res.status(400).json({ success: false, message: 'clubId required' });
      const clubInt = parseInt(clubId, 10);
      const [member] = await pool.query('SELECT 1 FROM club_members WHERE club_id = ? AND user_id = ? LIMIT 1', [clubInt, uid]);
      if (!member.length) return res.status(403).json({ success: false, message: 'Not a club member' });
      const [existing] = await pool.query('SELECT id FROM message_threads WHERE type = ? AND ref_id = ? LIMIT 1', ['club', clubInt]);
      const threadId = existing.length ? existing[0].id : null;
      if (threadId) {
        await pool.query('INSERT IGNORE INTO message_participants (thread_id, user_id, role) VALUES (?, ?, ?)', [threadId, uid, 'member']);
        return res.json({ success: true, threadId, existing: true });
      }
      const [ins] = await pool.query('INSERT INTO message_threads (type, ref_id, created_by, title) VALUES (?, ?, ?, ?)', ['club', clubInt, uid, title || 'Club chat']);
      const [members] = await pool.query('SELECT user_id FROM club_members WHERE club_id = ?', [clubInt]);
      const values = members.map(m => [ins.insertId, m.user_id, m.user_id === uid ? 'owner' : 'member']);
      if (values.length) {
        await pool.query('INSERT IGNORE INTO message_participants (thread_id, user_id, role) VALUES ?', [values]);
      }
      if (initialMessage) {
        await pool.query('INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?)', [ins.insertId, uid, initialMessage]);
        await pool.query('UPDATE message_threads SET last_message_at = NOW() WHERE id = ?', [ins.insertId]);
      }
      return res.json({ success: true, threadId: ins.insertId });
    }

    if (threadType === 'event') {
      if (!eventId) return res.status(400).json({ success: false, message: 'eventId required' });
      const eventInt = parseInt(eventId, 10);
      const [canView] = await pool.query(
        `SELECT 1 FROM events WHERE id = ? AND (created_by = ? OR EXISTS (
           SELECT 1 FROM event_registrations er WHERE er.event_id = ? AND er.user_id = ? AND er.status != 'cancelled'
         )) LIMIT 1`,
        [eventInt, uid, eventInt, uid]
      );
      if (!canView.length && req.session.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Not authorized for this event chat' });
      }
      const [existing] = await pool.query('SELECT id FROM message_threads WHERE type = ? AND ref_id = ? LIMIT 1', ['event', eventInt]);
      const threadId = existing.length ? existing[0].id : null;
      if (threadId) {
        await pool.query('INSERT IGNORE INTO message_participants (thread_id, user_id, role) VALUES (?, ?, ?)', [threadId, uid, 'member']);
        return res.json({ success: true, threadId, existing: true });
      }
      const [ins] = await pool.query('INSERT INTO message_threads (type, ref_id, created_by, title) VALUES (?, ?, ?, ?)', ['event', eventInt, uid, title || 'Event chat']);
      const [participants] = await pool.query(
        `SELECT user_id FROM event_registrations WHERE event_id = ? AND status != 'cancelled'`,
        [eventInt]
      );
      const [creatorRows] = await pool.query('SELECT created_by FROM events WHERE id = ?', [eventInt]);
      const creatorId = creatorRows[0]?.created_by;
      const values = participants.map(p => [ins.insertId, p.user_id, 'member']);
      if (creatorId) values.push([ins.insertId, creatorId, creatorId === uid ? 'owner' : 'member']);
      values.push([ins.insertId, uid, 'owner']);
      if (values.length) {
        await pool.query('INSERT IGNORE INTO message_participants (thread_id, user_id, role) VALUES ?', [values]);
      }
      if (initialMessage) {
        await pool.query('INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?)', [ins.insertId, uid, initialMessage]);
        await pool.query('UPDATE message_threads SET last_message_at = NOW() WHERE id = ?', [ins.insertId]);
      }
      return res.json({ success: true, threadId: ins.insertId });
    }

    res.status(400).json({ success: false, message: 'Invalid thread type' });
  } catch (e) {
    console.error('Create thread failed:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/messages/threads/:id/messages', requireAuth, requirePermission('message.send'), async (req, res) => {
  const uid = getUserId(req);
  const threadId = parseInt(req.params.id, 10);
  const { body } = req.body;
  if (!body) return res.status(400).json({ success: false, message: 'Message body required' });
  try {
    const [membership] = await pool.query('SELECT 1 FROM message_participants WHERE thread_id = ? AND user_id = ? LIMIT 1', [threadId, uid]);
    if (!membership.length) return res.status(403).json({ success: false, message: 'Not authorized' });
    await pool.query('INSERT INTO messages (thread_id, sender_id, body) VALUES (?, ?, ?)', [threadId, uid, body]);
    await pool.query('UPDATE message_threads SET last_message_at = NOW() WHERE id = ?', [threadId]);
    res.json({ success: true, message: 'Message sent' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ADMIN: USER MANAGEMENT ====================

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const { search, role, status } = req.query;
  try {
    let query = `SELECT u.id, u.email, u.role, u.is_active, u.deleted_at, u.created_at, up.full_name, up.department 
                 FROM users u LEFT JOIN user_profiles up ON u.id = up.user_id WHERE 1=1`;
    const params = [];
    if (search) {
      query += ' AND (u.email LIKE ? OR up.full_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (role) {
      query += ' AND u.role = ?';
      params.push(role);
    }
    if (status === 'active') {
      query += ' AND u.is_active = 1 AND u.deleted_at IS NULL';
    } else if (status === 'disabled') {
      query += ' AND (u.is_active = 0 OR u.deleted_at IS NOT NULL)';
    } else if (!status) {
      // Default: only show not-deleted users
      query += ' AND u.deleted_at IS NULL';
    }
    query += ' ORDER BY u.created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, users: rows });
  } catch (e) {
    console.error('Error fetching users:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { role } = req.body;
  if (!['admin', 'organizer', 'participant'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }
  try {
    const [user] = await pool.query('SELECT email, role FROM users WHERE id = ?', [userId]);
    if (!user.length) return res.status(404).json({ success: false, message: 'User not found' });
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
    await logAdminAction(req.session.userId, req.session.email, 'role_change', 'user', userId, 
      { old_role: user[0].role, new_role: role, target_email: user[0].email }, getClientIp(req));
    res.json({ success: true, message: 'Role updated' });
  } catch (e) {
    console.error('Error updating role:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/users/:id/status', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { is_active } = req.body;
  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ success: false, message: 'is_active must be boolean' });
  }
  try {
    const [user] = await pool.query('SELECT email FROM users WHERE id = ?', [userId]);
    if (!user.length) return res.status(404).json({ success: false, message: 'User not found' });
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [is_active ? 1 : 0, userId]);
    await logAdminAction(req.session.userId, req.session.email, is_active ? 'enable_user' : 'disable_user', 
      'user', userId, { target_email: user[0].email }, getClientIp(req));
    res.json({ success: true, message: `User ${is_active ? 'enabled' : 'disabled'}` });
  } catch (e) {
    console.error('Error updating user status:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/admin/users/:id/reset-password', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }
  try {
    const [user] = await pool.query('SELECT email FROM users WHERE id = ?', [userId]);
    if (!user.length) return res.status(404).json({ success: false, message: 'User not found' });
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
    await logAdminAction(req.session.userId, req.session.email, 'reset_password', 'user', userId, 
      { target_email: user[0].email }, getClientIp(req));
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (e) {
    console.error('Error resetting password:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (userId === req.session.userId) {
    return res.status(403).json({ success: false, message: 'Cannot delete yourself' });
  }
  try {
    const [user] = await pool.query('SELECT email FROM users WHERE id = ?', [userId]);
    if (!user.length) return res.status(404).json({ success: false, message: 'User not found' });
    await pool.query('UPDATE users SET deleted_at = NOW(), is_active = 0 WHERE id = ?', [userId]);
    await logAdminAction(req.session.userId, req.session.email, 'soft_delete_user', 'user', userId, 
      { target_email: user[0].email }, getClientIp(req));
    res.json({ success: true, message: 'User deleted' });
  } catch (e) {
    console.error('Error deleting user:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ADMIN: EVENT OVERSIGHT ====================

app.get('/api/admin/events', requireAdmin, async (req, res) => {
  const { status, search } = req.query;
  try {
    let query = `SELECT e.*, u.email as organizer_email, up.full_name as organizer_name 
                 FROM events e 
                 JOIN users u ON e.created_by = u.id 
                 LEFT JOIN user_profiles up ON u.id = up.user_id 
                 WHERE 1=1`;
    const params = [];
    if (status) {
      query += ' AND e.status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (e.title LIKE ? OR e.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY e.created_at DESC';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, events: rows });
  } catch (e) {
    console.error('Error fetching events:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/events/:id/approve', requireAdmin, requirePermission('event.approve'), async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  try {
    const [event] = await pool.query('SELECT title, created_by FROM events WHERE id = ?', [eventId]);
    if (!event.length) return res.status(404).json({ success: false, message: 'Event not found' });
    await pool.query('UPDATE events SET status = ? WHERE id = ?', ['published', eventId]);
    await pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)', 
      [event[0].created_by, 'Event Approved', `Your event "${event[0].title}" has been approved and published.`, 'event_approval']);
    await logAdminAction(req.session.userId, req.session.email, 'approve_event', 'event', eventId, 
      { event_title: event[0].title }, getClientIp(req));
    res.json({ success: true, message: 'Event approved' });
  } catch (e) {
    console.error('Error approving event:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/events/:id/reject', requireAdmin, requirePermission('event.approve'), async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  const { reason } = req.body;
  try {
    const [event] = await pool.query('SELECT title, created_by FROM events WHERE id = ?', [eventId]);
    if (!event.length) return res.status(404).json({ success: false, message: 'Event not found' });
    await pool.query('UPDATE events SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', reason || null, eventId]);
    await pool.query('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)', 
      [event[0].created_by, 'Event Rejected', `Your event "${event[0].title}" was rejected. ${reason ? 'Reason: ' + reason : ''}`, 'event_rejection']);
    await logAdminAction(req.session.userId, req.session.email, 'reject_event', 'event', eventId, 
      { event_title: event[0].title, reason }, getClientIp(req));
    res.json({ success: true, message: 'Event rejected' });
  } catch (e) {
    console.error('Error rejecting event:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/events/:id', requireAdmin, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  const { title, description, event_date, end_date, start_time, end_time, location, online_link, max_participants, status, visibility, budget_total, budget_used, budget_currency, budget_notes } = req.body;
  try {
    const updates = [];
    const values = [];
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (event_date !== undefined) { updates.push('event_date = ?'); values.push(event_date); }
    if (end_date !== undefined) { updates.push('end_date = ?'); values.push(end_date); }
    if (start_time !== undefined) { updates.push('start_time = ?'); values.push(start_time); }
    if (end_time !== undefined) { updates.push('end_time = ?'); values.push(end_time); }
    if (location !== undefined) { updates.push('location = ?'); values.push(location); }
    if (online_link !== undefined) { updates.push('online_link = ?'); values.push(online_link); }
    if (max_participants !== undefined) { updates.push('max_participants = ?'); values.push(max_participants); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (visibility !== undefined) { updates.push('visibility = ?'); values.push(visibility); }
    if (budget_total !== undefined) { updates.push('budget_total = ?'); values.push(budget_total); }
    if (budget_used !== undefined) { updates.push('budget_used = ?'); values.push(budget_used); }
    if (budget_currency !== undefined) { updates.push('budget_currency = ?'); values.push(budget_currency); }
    if (budget_notes !== undefined) { updates.push('budget_notes = ?'); values.push(budget_notes); }
    if (updates.length === 0) return res.json({ success: true, message: 'No changes' });
    values.push(eventId);
    await pool.query(`UPDATE events SET ${updates.join(', ')} WHERE id = ?`, values);
    await logAdminAction(req.session.userId, req.session.email, 'admin_edit_event', 'event', eventId, 
      { updates: Object.keys(req.body) }, getClientIp(req));
    res.json({ success: true, message: 'Event updated' });
  } catch (e) {
    console.error('Error updating event:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/admin/events/:id/force-close', requireAdmin, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  try {
    const [event] = await pool.query('SELECT title FROM events WHERE id = ?', [eventId]);
    if (!event.length) return res.status(404).json({ success: false, message: 'Event not found' });
    await pool.query('UPDATE events SET status = ? WHERE id = ?', ['closed', eventId]);
    await logAdminAction(req.session.userId, req.session.email, 'force_close_event', 'event', eventId, 
      { event_title: event[0].title }, getClientIp(req));
    res.json({ success: true, message: 'Event force-closed' });
  } catch (e) {
    console.error('Error force-closing event:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/admin/events/:id', requireAdmin, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  try {
    const [event] = await pool.query('SELECT title FROM events WHERE id = ?', [eventId]);
    if (!event.length) return res.status(404).json({ success: false, message: 'Event not found' });
    await pool.query('DELETE FROM events WHERE id = ?', [eventId]);
    await logAdminAction(req.session.userId, req.session.email, 'delete_event', 'event', eventId, 
      { event_title: event[0].title }, getClientIp(req));
    res.json({ success: true, message: 'Event deleted' });
  } catch (e) {
    console.error('Error deleting event:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// ==================== ADMIN: DASHBOARD ANALYTICS ====================

app.get('/api/admin/stats', requireAdmin, requirePermission('analytics.view'), async (req, res) => {
  try {
    const [userStats] = await pool.query(`
      SELECT role, COUNT(*) as count 
      FROM users 
      WHERE is_active = 1 AND deleted_at IS NULL 
      GROUP BY role
    `);
    const [eventStats] = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM events 
      GROUP BY status
    `);
    const [upcoming] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM events 
      WHERE status = 'published' AND event_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
    `);
    res.json({ 
      success: true, 
      stats: { usersByRole: userStats, eventsByStatus: eventStats, upcomingEvents: upcoming[0].count } 
    });
  } catch (e) {
    console.error('Error fetching stats:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/admin/recent', requireAdmin, requirePermission('analytics.view'), async (req, res) => {
  try {
    const [users] = await pool.query(`
      SELECT u.id, u.email, u.role, u.created_at, up.full_name 
      FROM users u 
      LEFT JOIN user_profiles up ON u.id = up.user_id 
      WHERE u.is_active = 1 AND u.deleted_at IS NULL 
      ORDER BY u.created_at DESC LIMIT 10
    `);
    const [events] = await pool.query(`
      SELECT e.id, e.title, e.status, e.created_at, u.email as organizer_email 
      FROM events e 
      JOIN users u ON e.created_by = u.id 
      ORDER BY e.created_at DESC LIMIT 10
    `);
    res.json({ success: true, recentUsers: users, recentEvents: events });
  } catch (e) {
    console.error('Error fetching recent data:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/admin/top-organizers', requireAdmin, requirePermission('analytics.view'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT u.id, u.email, up.full_name, COUNT(e.id) as event_count 
      FROM users u 
      JOIN events e ON u.id = e.created_by 
      LEFT JOIN user_profiles up ON u.id = up.user_id 
      WHERE u.role = 'organizer' 
      GROUP BY u.id 
      ORDER BY event_count DESC 
      LIMIT 10
    `);
    res.json({ success: true, organizers: rows });
  } catch (e) {
    console.error('Error fetching top organizers:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ADMIN: ADVANCED ANALYTICS ====================

app.get('/api/admin/analytics', requireAdmin, requirePermission('analytics.view'), async (req, res) => {
  try {
    const [participation] = await pool.query(`
      SELECT DATE_FORMAT(e.event_date, '%Y-%m') AS month, COUNT(er.id) AS registrations
      FROM events e
      LEFT JOIN event_registrations er ON er.event_id = e.id AND er.status != 'cancelled'
      WHERE e.event_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY month
      ORDER BY month
    `);

    const [clubActivity] = await pool.query(`
      SELECT c.id, c.name,
             COUNT(DISTINCT ec.event_id) AS events,
             COUNT(er.id) AS registrations
      FROM clubs c
      LEFT JOIN event_clubs ec ON ec.club_id = c.id
      LEFT JOIN event_registrations er ON er.event_id = ec.event_id AND er.status != 'cancelled'
      GROUP BY c.id
      ORDER BY events DESC, registrations DESC
    `);

    const [resourceUtilization] = await pool.query(`
      SELECT r.id, r.name, r.category,
             COALESCE(SUM(TIMESTAMPDIFF(MINUTE, rb.start_datetime, rb.end_datetime)), 0) / 60 AS hours_booked
      FROM resources r
      LEFT JOIN resource_bookings rb ON rb.resource_id = r.id
        AND rb.status IN ('approved', 'completed')
        AND rb.start_datetime >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY r.id
      ORDER BY hours_booked DESC
    `);

    const [budget] = await pool.query(`
      SELECT 
        COALESCE(SUM(budget_total), 0) AS total_budget,
        COALESCE(SUM(budget_used), 0) AS used_budget
      FROM events
      WHERE status IN ('published', 'completed', 'closed')
    `);

    res.json({
      success: true,
      analytics: {
        participation,
        clubActivity,
        resourceUtilization,
        budget: budget[0] || { total_budget: 0, used_budget: 0 }
      }
    });
  } catch (e) {
    console.error('Error fetching analytics:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

function toCsv(headers, rows) {
  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const out = [headers.join(',')];
  for (const row of rows) {
    out.push(headers.map(h => escape(row[h])).join(','));
  }
  return out.join('\n');
}

app.get('/api/admin/export/events.csv', requireAdmin, requirePermission('analytics.view'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, title, event_date, end_date, start_time, end_time, status, visibility, budget_total, budget_used
      FROM events
      ORDER BY event_date DESC
    `);
    const csv = toCsv(['id', 'title', 'event_date', 'end_date', 'start_time', 'end_time', 'status', 'visibility', 'budget_total', 'budget_used'], rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="events.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/admin/export/resources.csv', requireAdmin, requirePermission('analytics.view'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, name, category, requires_approval
      FROM resources
      ORDER BY category, name
    `);
    const csv = toCsv(['id', 'name', 'category', 'requires_approval'], rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="resources.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/admin/export/bookings.csv', requireAdmin, requirePermission('analytics.view'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT rb.id, r.name as resource_name, rb.start_datetime, rb.end_datetime, rb.status, rb.user_id
      FROM resource_bookings rb
      JOIN resources r ON r.id = rb.resource_id
      ORDER BY rb.start_datetime DESC
    `);
    const csv = toCsv(['id', 'resource_name', 'start_datetime', 'end_datetime', 'status', 'user_id'], rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="bookings.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/admin/export/analytics.xlsx', requireAdmin, requirePermission('analytics.view'), async (req, res) => {
  if (!ExcelJS) return res.status(500).json({ success: false, message: 'Excel export not configured' });
  try {
    const [participation] = await pool.query(`
      SELECT DATE_FORMAT(e.event_date, '%Y-%m') AS month, COUNT(er.id) AS registrations
      FROM events e
      LEFT JOIN event_registrations er ON er.event_id = e.id AND er.status != 'cancelled'
      WHERE e.event_date >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
      GROUP BY month
      ORDER BY month
    `);
    const [clubActivity] = await pool.query(`
      SELECT c.name, COUNT(DISTINCT ec.event_id) AS events, COUNT(er.id) AS registrations
      FROM clubs c
      LEFT JOIN event_clubs ec ON ec.club_id = c.id
      LEFT JOIN event_registrations er ON er.event_id = ec.event_id AND er.status != 'cancelled'
      GROUP BY c.id
      ORDER BY events DESC
    `);
    const [resourceUtilization] = await pool.query(`
      SELECT r.name, r.category,
             COALESCE(SUM(TIMESTAMPDIFF(MINUTE, rb.start_datetime, rb.end_datetime)), 0) / 60 AS hours_booked
      FROM resources r
      LEFT JOIN resource_bookings rb ON rb.resource_id = r.id
        AND rb.status IN ('approved', 'completed')
        AND rb.start_datetime >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY r.id
      ORDER BY hours_booked DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const ws1 = workbook.addWorksheet('Participation');
    ws1.addRow(['Month', 'Registrations']);
    participation.forEach(r => ws1.addRow([r.month, r.registrations]));

    const ws2 = workbook.addWorksheet('Club Activity');
    ws2.addRow(['Club', 'Events', 'Registrations']);
    clubActivity.forEach(r => ws2.addRow([r.name, r.events, r.registrations]));

    const ws3 = workbook.addWorksheet('Resource Utilization');
    ws3.addRow(['Resource', 'Category', 'Hours Booked']);
    resourceUtilization.forEach(r => ws3.addRow([r.name, r.category, r.hours_booked]));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="analytics.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ADMIN: AUDIT LOGS ====================

app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  const { page = 1, limit = 50, action, target_type } = req.query;
  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  try {
    let query = 'SELECT * FROM admin_logs WHERE 1=1';
    const params = [];
    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }
    if (target_type) {
      query += ' AND target_type = ?';
      params.push(target_type);
    }
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), offset);
    const [rows] = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) as total FROM admin_logs WHERE 1=1';
    const countParams = [];
    if (action) {
      countQuery += ' AND action = ?';
      countParams.push(action);
    }
    if (target_type) {
      countQuery += ' AND target_type = ?';
      countParams.push(target_type);
    }
    const [countResult] = await pool.query(countQuery, countParams);
    res.json({ success: true, logs: rows, total: countResult[0].total });
  } catch (e) {
    console.error('Error fetching logs:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ADMIN: SYSTEM SETTINGS ====================

app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM system_settings ORDER BY setting_key');
    res.json({ success: true, settings: rows });
  } catch (e) {
    console.error('Error fetching settings:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ success: false, message: 'Invalid settings format' });
  }
  try {
    for (const [key, value] of Object.entries(settings)) {
      await pool.query(
        'UPDATE system_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
        [String(value), req.session.userId, key]
      );
    }
    await logAdminAction(req.session.userId, req.session.email, 'update_settings', 'setting', null, 
      { settings }, getClientIp(req));
    res.json({ success: true, message: 'Settings updated' });
  } catch (e) {
    console.error('Error updating settings:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ADMIN: EMERGENCY CONTROLS ====================

app.post('/api/admin/emergency/force-logout-all', requireAdmin, async (req, res) => {
  try {
    // Note: Express sessions are stored in memory by default. For production, use express-session with a store.
    // This is a simplified implementation - in production, you'd clear the session store.
    await logAdminAction(req.session.userId, req.session.email, 'force_logout_all', 'system', null, 
      { note: 'All users will be logged out on next request' }, getClientIp(req));
    res.json({ success: true, message: 'Force logout initiated (requires session store cleanup)' });
  } catch (e) {
    console.error('Error forcing logout:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/admin/emergency/disable-all-events', requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE events SET status = ? WHERE status IN (?, ?)', ['closed', 'published', 'pending_approval']);
    await logAdminAction(req.session.userId, req.session.email, 'disable_all_events', 'system', null, 
      { affected_count: result.affectedRows }, getClientIp(req));
    res.json({ success: true, message: `${result.affectedRows} events closed` });
  } catch (e) {
    console.error('Error disabling events:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/admin/emergency/freeze-registrations', requireAdmin, async (req, res) => {
  const { freeze } = req.body;
  if (typeof freeze !== 'boolean') {
    return res.status(400).json({ success: false, message: 'freeze must be boolean' });
  }
  try {
    await pool.query(
      'UPDATE system_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?',
      [freeze ? 'true' : 'false', req.session.userId, 'registrations_frozen']
    );
    await logAdminAction(req.session.userId, req.session.email, freeze ? 'freeze_registrations' : 'unfreeze_registrations', 
      'system', null, {}, getClientIp(req));
    res.json({ success: true, message: `Registrations ${freeze ? 'frozen' : 'unfrozen'}` });
  } catch (e) {
    console.error('Error toggling registrations:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ROUTES & STATIC ====================

app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/student-home', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  if (req.session.role === 'organizer') return res.redirect('/organizer-home');
  if (req.session.role === 'admin') return res.redirect('/admin-home');
  return res.sendFile(path.join(publicDir, 'student-home.html'));
});
app.get('/organizer-home', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  if (req.session.role === 'participant') return res.redirect('/student-home');
  if (req.session.role === 'admin' || req.session.role === 'organizer') {
    return res.sendFile(path.join(publicDir, 'organizer-home.html'));
  }
  return res.redirect('/');
});
app.get('/admin-home', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  if (req.session.role !== 'admin') {
    if (req.session.role === 'organizer') return res.redirect('/organizer-home');
    return res.redirect('/student-home');
  }
  return res.sendFile(path.join(publicDir, 'admin-home.html'));
});

// ==================== NOTIFICATION JOBS ====================

let remindersRunning = false;
async function runReminderJobs() {
  if (remindersRunning || !pool) return;
  remindersRunning = true;
  try {
    // Upcoming events within 24 hours
    const [upcoming] = await pool.query(`
      SELECT e.id as event_id, e.title, e.event_date, e.start_time, er.user_id
      FROM events e
      JOIN event_registrations er ON er.event_id = e.id AND er.status = 'registered'
      WHERE e.status = 'published'
        AND TIMESTAMPDIFF(HOUR, NOW(), CONCAT(e.event_date, ' ', e.start_time)) BETWEEN 0 AND 24
    `);
    for (const row of upcoming) {
      const [ins] = await pool.query(
        'INSERT IGNORE INTO event_reminders (event_id, user_id, reminder_type) VALUES (?, ?, ?)',
        [row.event_id, row.user_id, 'upcoming_24h']
      );
      if (ins.affectedRows) {
        await pool.query(
          'INSERT INTO notifications (user_id, title, message, type, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
          [row.user_id, 'Upcoming Event', `Reminder: "${row.title}" starts within 24 hours.`, 'upcoming_event', 'event', row.event_id]
        );
      }
    }

    // Registration deadline within 24 hours (notify organizers)
    const [deadlines] = await pool.query(`
      SELECT e.id as event_id, e.title, e.registration_deadline, e.created_by
      FROM events e
      WHERE e.registration_deadline IS NOT NULL
        AND TIMESTAMPDIFF(HOUR, NOW(), e.registration_deadline) BETWEEN 0 AND 24
    `);
    for (const row of deadlines) {
      const [ins] = await pool.query(
        'INSERT IGNORE INTO event_reminders (event_id, user_id, reminder_type) VALUES (?, ?, ?)',
        [row.event_id, row.created_by, 'deadline_24h']
      );
      if (ins.affectedRows) {
        await pool.query(
          'INSERT INTO notifications (user_id, title, message, type, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
          [row.created_by, 'Registration Deadline', `Deadline approaching for "${row.title}".`, 'general', 'event', row.event_id]
        );
      }
    }

    // Booking reminders within 24 hours
    const [bookings] = await pool.query(`
      SELECT rb.id as booking_id, rb.user_id, r.name as resource_name
      FROM resource_bookings rb
      JOIN resources r ON r.id = rb.resource_id
      WHERE rb.status = 'approved'
        AND TIMESTAMPDIFF(HOUR, NOW(), rb.start_datetime) BETWEEN 0 AND 24
    `);
    for (const row of bookings) {
      const [ins] = await pool.query(
        'INSERT IGNORE INTO booking_reminders (booking_id, user_id, reminder_type) VALUES (?, ?, ?)',
        [row.booking_id, row.user_id, 'upcoming_24h']
      );
      if (ins.affectedRows) {
        await pool.query(
          'INSERT INTO notifications (user_id, title, message, type, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
          [row.user_id, 'Booking Reminder', `Reminder: Your booking for ${row.resource_name} starts within 24 hours.`, 'booking_reminder', 'booking', row.booking_id]
        );
      }
    }
  } catch (e) {
    console.error('Reminder job error:', e);
  } finally {
    remindersRunning = false;
  }
}

// ==================== SERVER ====================

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
    runReminderJobs();
    setInterval(runReminderJobs, 60 * 60 * 1000);
  })
  .catch((err) => {
    // If DB init fails, log the error and exit so the platform can restart the service.
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  if (pool) await pool.end();
  process.exit(0);
});

// Prevent the process from crashing on unexpected errors in production.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// ==================== ADMIN: RESOURCE MANAGEMENT ====================

app.get('/api/admin/resources', requireAdmin, requirePermission('resource.manage'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.*, rt.name as type_name
       FROM resources r
       LEFT JOIN resource_types rt ON rt.id = r.type_id
       ORDER BY r.category, r.name`
    );
    res.json({ success: true, resources: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/admin/resources', requireAdmin, requirePermission('resource.manage'), async (req, res) => {
  const { name, category, description, requires_approval, type_id } = req.body;
  if (!name || !category) return res.status(400).json({ success: false, message: 'name and category required' });
  try {
    const [ins] = await pool.query(
      'INSERT INTO resources (name, category, description, requires_approval, type_id) VALUES (?, ?, ?, ?, ?)',
      [name, category, description || null, requires_approval ? 1 : 0, type_id || null]
    );
    await logAdminAction(req.session.userId, req.session.email, 'create_resource', 'system', ins.insertId, { name, category }, getClientIp(req));
    res.json({ success: true, resourceId: ins.insertId });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/resources/:id', requireAdmin, requirePermission('resource.manage'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, category, description, requires_approval, type_id } = req.body;
  try {
    const updates = [];
    const values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (category !== undefined) { updates.push('category = ?'); values.push(category); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (requires_approval !== undefined) { updates.push('requires_approval = ?'); values.push(requires_approval ? 1 : 0); }
    if (type_id !== undefined) { updates.push('type_id = ?'); values.push(type_id || null); }
    if (!updates.length) return res.json({ success: true, message: 'No changes' });
    values.push(id);
    await pool.query(`UPDATE resources SET ${updates.join(', ')} WHERE id = ?`, values);
    await logAdminAction(req.session.userId, req.session.email, 'update_resource', 'system', id, { updates: Object.keys(req.body) }, getClientIp(req));
    res.json({ success: true, message: 'Resource updated' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/admin/resources/:id', requireAdmin, requirePermission('resource.manage'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM resources WHERE id = ?', [id]);
    await logAdminAction(req.session.userId, req.session.email, 'delete_resource', 'system', id, {}, getClientIp(req));
    res.json({ success: true, message: 'Resource deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ADMIN: RESOURCE BOOKINGS ====================

app.get('/api/admin/resource-bookings', requireAdmin, requirePermission('resource.approve'), async (req, res) => {
  const { status, resourceId, q } = req.query;
  try {
    let query = `
      SELECT rb.*, r.name as resource_name, r.category, u.email, up.full_name
      FROM resource_bookings rb
      JOIN resources r ON r.id = rb.resource_id
      JOIN users u ON u.id = rb.user_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE 1=1`;
    const params = [];
    if (status) { query += ' AND rb.status = ?'; params.push(status); }
    if (resourceId) { query += ' AND rb.resource_id = ?'; params.push(resourceId); }
    if (q) {
      query += ' AND (u.email LIKE ? OR up.full_name LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    query += ' ORDER BY rb.start_datetime DESC LIMIT 200';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, bookings: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

async function updateBookingStatus(bookingId, status, actorId, notes) {
  const timeField = status === 'approved' ? 'approved_at'
    : status === 'rejected' ? 'rejected_at'
    : status === 'cancelled' ? 'cancelled_at'
    : status === 'completed' ? 'completed_at'
    : null;
  const updates = timeField ? `status = ?, ${timeField} = NOW(), approved_by = ?` : `status = ?, approved_by = ?`;
  await pool.query(`UPDATE resource_bookings SET ${updates} WHERE id = ?`, [status, actorId, bookingId]);
  await pool.query(
    'INSERT INTO resource_booking_logs (booking_id, action, actor_id, notes) VALUES (?, ?, ?, ?)',
    [bookingId, status, actorId, notes || null]
  );
}

async function notifyBookingStatus(bookingId, userId, status, resourceName) {
  const titleMap = {
    approved: 'Booking Approved',
    rejected: 'Booking Rejected',
    cancelled: 'Booking Cancelled',
    completed: 'Booking Completed'
  };
  const typeMap = {
    approved: 'booking_approved',
    rejected: 'booking_rejected',
    cancelled: 'general',
    completed: 'general'
  };
  const title = titleMap[status] || 'Booking Update';
  const message = resourceName
    ? `Your booking for ${resourceName} was ${status}.`
    : `Your booking was ${status}.`;
  await pool.query(
    'INSERT INTO notifications (user_id, title, message, type, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, title, message, typeMap[status] || 'general', 'booking', bookingId]
  );
}

app.put('/api/admin/resource-bookings/:id/approve', requireAdmin, requirePermission('resource.approve'), async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  const { notes } = req.body;
  try {
    const [rows] = await pool.query(
      `SELECT rb.user_id, r.name as resource_name FROM resource_bookings rb
       JOIN resources r ON r.id = rb.resource_id
       WHERE rb.id = ?`,
      [bookingId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    await updateBookingStatus(bookingId, 'approved', req.session.userId, notes || 'Approved by admin');
    await notifyBookingStatus(bookingId, rows[0].user_id, 'approved', rows[0].resource_name);
    res.json({ success: true, message: 'Booking approved' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/resource-bookings/:id/reject', requireAdmin, requirePermission('resource.approve'), async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  const { reason } = req.body;
  try {
    const [rows] = await pool.query(
      `SELECT rb.user_id, r.name as resource_name FROM resource_bookings rb
       JOIN resources r ON r.id = rb.resource_id
       WHERE rb.id = ?`,
      [bookingId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    await updateBookingStatus(bookingId, 'rejected', req.session.userId, reason || 'Rejected by admin');
    await notifyBookingStatus(bookingId, rows[0].user_id, 'rejected', rows[0].resource_name);
    res.json({ success: true, message: 'Booking rejected' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/resource-bookings/:id/cancel', requireAdmin, requirePermission('resource.approve'), async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  const { reason } = req.body;
  try {
    const [rows] = await pool.query(
      `SELECT rb.user_id, r.name as resource_name FROM resource_bookings rb
       JOIN resources r ON r.id = rb.resource_id
       WHERE rb.id = ?`,
      [bookingId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    await updateBookingStatus(bookingId, 'cancelled', req.session.userId, reason || 'Cancelled by admin');
    await notifyBookingStatus(bookingId, rows[0].user_id, 'cancelled', rows[0].resource_name);
    res.json({ success: true, message: 'Booking cancelled' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/resource-bookings/:id/complete', requireAdmin, requirePermission('resource.approve'), async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  try {
    const [rows] = await pool.query(
      `SELECT rb.user_id, r.name as resource_name FROM resource_bookings rb
       JOIN resources r ON r.id = rb.resource_id
       WHERE rb.id = ?`,
      [bookingId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    await updateBookingStatus(bookingId, 'completed', req.session.userId, 'Marked as completed');
    await notifyBookingStatus(bookingId, rows[0].user_id, 'completed', rows[0].resource_name);
    res.json({ success: true, message: 'Booking completed' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ADMIN: CLUB MANAGEMENT ====================

app.get('/api/admin/clubs', requireAdmin, requirePermission('club.manage'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM club_members cm WHERE cm.club_id = c.id) as member_count
       FROM clubs c ORDER BY c.name`
    );
    res.json({ success: true, clubs: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'club';
}

app.post('/api/admin/clubs', requireAdmin, requirePermission('club.manage'), async (req, res) => {
  const { name, slug, description, type, logo_url } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'name required' });
  const finalSlug = slug ? slugify(slug) : slugify(name);
  try {
    const [ins] = await pool.query(
      'INSERT INTO clubs (name, slug, description, type, logo_url) VALUES (?, ?, ?, ?, ?)',
      [name, finalSlug, description || null, type || 'club', logo_url || null]
    );
    await logAdminAction(req.session.userId, req.session.email, 'create_club', 'system', ins.insertId, { name }, getClientIp(req));
    res.json({ success: true, clubId: ins.insertId });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/clubs/:id', requireAdmin, requirePermission('club.manage'), async (req, res) => {
  const clubId = parseInt(req.params.id, 10);
  const { name, slug, description, type, logo_url } = req.body;
  try {
    const updates = [];
    const values = [];
    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (slug !== undefined) { updates.push('slug = ?'); values.push(slugify(slug)); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (type !== undefined) { updates.push('type = ?'); values.push(type); }
    if (logo_url !== undefined) { updates.push('logo_url = ?'); values.push(logo_url); }
    if (!updates.length) return res.json({ success: true, message: 'No changes' });
    values.push(clubId);
    await pool.query(`UPDATE clubs SET ${updates.join(', ')} WHERE id = ?`, values);
    await logAdminAction(req.session.userId, req.session.email, 'update_club', 'system', clubId, { updates: Object.keys(req.body) }, getClientIp(req));
    res.json({ success: true, message: 'Club updated' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/admin/clubs/:id', requireAdmin, requirePermission('club.manage'), async (req, res) => {
  const clubId = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM clubs WHERE id = ?', [clubId]);
    await logAdminAction(req.session.userId, req.session.email, 'delete_club', 'system', clubId, {}, getClientIp(req));
    res.json({ success: true, message: 'Club deleted' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/admin/clubs/:id/members', requireAdmin, requirePermission('club.manage'), async (req, res) => {
  const clubId = parseInt(req.params.id, 10);
  try {
    const [rows] = await pool.query(
      `SELECT cm.user_id, cm.role, u.email, up.full_name
       FROM club_members cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE cm.club_id = ?
       ORDER BY cm.role DESC, up.full_name`,
      [clubId]
    );
    res.json({ success: true, members: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/admin/clubs/:id/members', requireAdmin, requirePermission('club.manage'), async (req, res) => {
  const clubId = parseInt(req.params.id, 10);
  const { userId, role } = req.body;
  if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
  try {
    await pool.query('INSERT IGNORE INTO club_members (club_id, user_id, role) VALUES (?, ?, ?)', [clubId, userId, role || 'member']);
    res.json({ success: true, message: 'Member added' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/clubs/:id/members/:userId', requireAdmin, requirePermission('club.manage'), async (req, res) => {
  const clubId = parseInt(req.params.id, 10);
  const userId = parseInt(req.params.userId, 10);
  const { role } = req.body;
  if (!role) return res.status(400).json({ success: false, message: 'role required' });
  try {
    await pool.query('UPDATE club_members SET role = ? WHERE club_id = ? AND user_id = ?', [role, clubId, userId]);
    res.json({ success: true, message: 'Member role updated' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/admin/clubs/:id/members/:userId', requireAdmin, requirePermission('club.manage'), async (req, res) => {
  const clubId = parseInt(req.params.id, 10);
  const userId = parseInt(req.params.userId, 10);
  try {
    await pool.query('DELETE FROM club_members WHERE club_id = ? AND user_id = ?', [clubId, userId]);
    res.json({ success: true, message: 'Member removed' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// Event collaborations (clubs)
app.get('/api/events/:id/clubs', requireOrganizer, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  try {
    const canManage = await canManageEvent(eventId, req.session.userId, req.session.role);
    if (!canManage) return res.status(403).json({ success: false, message: 'Not authorized' });
    const [rows] = await pool.query(
      `SELECT ec.club_id, ec.role, c.name, c.type
       FROM event_clubs ec
       JOIN clubs c ON c.id = ec.club_id
       WHERE ec.event_id = ?
       ORDER BY c.name`,
      [eventId]
    );
    res.json({ success: true, clubs: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/resources/bookings/:id/cancel', requireAuth, requirePermission('resource.book'), async (req, res) => {
  const uid = getUserId(req);
  const bookingId = parseInt(req.params.id, 10);
  if (!bookingId) return res.status(400).json({ success: false, message: 'Invalid booking id' });
  try {
    const [rows] = await pool.query('SELECT status FROM resource_bookings WHERE id = ? AND user_id = ?', [bookingId, uid]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    if (rows[0].status === 'cancelled') return res.json({ success: true, message: 'Already cancelled' });
    await pool.query('UPDATE resource_bookings SET status = ?, cancelled_at = NOW() WHERE id = ?', ['cancelled', bookingId]);
    await pool.query(
      'INSERT INTO resource_booking_logs (booking_id, action, actor_id, notes) VALUES (?, ?, ?, ?)',
      [bookingId, 'cancelled', uid, 'Booking cancelled by user']
    );
    res.json({ success: true, message: 'Booking cancelled' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/events/:id/clubs', requireOrganizer, requirePermission('event.update'), async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  const { clubId, role } = req.body;
  if (!clubId) return res.status(400).json({ success: false, message: 'clubId required' });
  try {
    const canManage = await canManageEvent(eventId, req.session.userId, req.session.role);
    if (!canManage) return res.status(403).json({ success: false, message: 'Not authorized' });
    if (req.session.role !== 'admin') {
      const [allowed] = await pool.query(
        `SELECT 1 FROM club_members WHERE user_id = ? AND club_id = ? AND role IN ('head','coordinator') LIMIT 1`,
        [req.session.userId, clubId]
      );
      if (!allowed.length) return res.status(403).json({ success: false, message: 'Not a head/coordinator of this club' });
    }
    await pool.query('INSERT IGNORE INTO event_clubs (event_id, club_id, role) VALUES (?, ?, ?)', [eventId, clubId, role || 'host']);
    res.json({ success: true, message: 'Club added to event' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/events/:id/clubs/:clubId', requireOrganizer, requirePermission('event.update'), async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  const clubId = parseInt(req.params.clubId, 10);
  const { role } = req.body;
  if (!role) return res.status(400).json({ success: false, message: 'role required' });
  try {
    const canManage = await canManageEvent(eventId, req.session.userId, req.session.role);
    if (!canManage) return res.status(403).json({ success: false, message: 'Not authorized' });
    await pool.query('UPDATE event_clubs SET role = ? WHERE event_id = ? AND club_id = ?', [role, eventId, clubId]);
    res.json({ success: true, message: 'Club role updated' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/events/:id/clubs/:clubId', requireOrganizer, requirePermission('event.update'), async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  const clubId = parseInt(req.params.clubId, 10);
  try {
    const canManage = await canManageEvent(eventId, req.session.userId, req.session.role);
    if (!canManage) return res.status(403).json({ success: false, message: 'Not authorized' });
    await pool.query('DELETE FROM event_clubs WHERE event_id = ? AND club_id = ?', [eventId, clubId]);
    res.json({ success: true, message: 'Club removed from event' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});
