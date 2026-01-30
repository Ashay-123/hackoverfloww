const express = require('express');
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const publicDir = path.join(__dirname, 'public');
const isProduction = process.env.NODE_ENV === 'production';
const CHAT_RATE_LIMIT_PER_MIN = Number.isFinite(parseInt(process.env.CHAT_RATE_LIMIT_PER_MIN, 10))
  ? parseInt(process.env.CHAT_RATE_LIMIT_PER_MIN, 10)
  : 6;
const CHAT_DUPLICATE_WINDOW_SEC = Number.isFinite(parseInt(process.env.CHAT_DUPLICATE_WINDOW_SEC, 10))
  ? parseInt(process.env.CHAT_DUPLICATE_WINDOW_SEC, 10)
  : 45;
const CHAT_EDIT_WINDOW_MIN = Number.isFinite(parseInt(process.env.CHAT_EDIT_WINDOW_MIN, 10))
  ? parseInt(process.env.CHAT_EDIT_WINDOW_MIN, 10)
  : 10;

// MySQL config - set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in env or use defaults.
// These values also work for hosted MySQL (Render, Railway, AWS RDS, etc.).
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
    await ensureChatSchema();
    await seedIfEmpty();
    await backfillChatThreads();
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
app.use(passport.session());

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

// ==================== CHAT HELPERS ====================
const bannedWordsCache = { words: null, loadedAt: 0 };
const BANNED_WORDS_CACHE_MS = 5 * 60 * 1000;

function normalizeChatBody(body) {
  return String(body || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getChatBannedWords() {
  const now = Date.now();
  if (bannedWordsCache.words && (now - bannedWordsCache.loadedAt) < BANNED_WORDS_CACHE_MS) {
    return bannedWordsCache.words;
  }
  let words = [];
  try {
    const [rows] = await pool.query('SELECT word FROM chat_banned_words');
    words = rows.map(r => String(r.word || '').trim()).filter(Boolean);
  } catch (e) {
    console.error('Failed to load banned words:', e.message);
  }
  if (!words.length && process.env.CHAT_BANNED_WORDS) {
    words = process.env.CHAT_BANNED_WORDS.split(',').map(w => w.trim()).filter(Boolean);
  }
  bannedWordsCache.words = words;
  bannedWordsCache.loadedAt = now;
  return words;
}

function findBannedWords(body, words) {
  const found = [];
  if (!body || !words || !words.length) return found;
  const text = String(body);
  const lower = text.toLowerCase();
  for (const w of words) {
    const word = String(w || '').trim();
    if (!word) continue;
    const lowerWord = word.toLowerCase();
    if (/^[a-z0-9]+$/i.test(word)) {
      const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i');
      if (regex.test(text)) found.push(word);
    } else if (lower.includes(lowerWord)) {
      found.push(word);
    }
  }
  return found;
}

async function getActiveChatBan(userId) {
  const [rows] = await pool.query(
    `SELECT * FROM user_bans 
     WHERE user_id = ? AND scope = 'chat' 
       AND revoked_at IS NULL 
       AND (end_at IS NULL OR end_at > NOW())
     ORDER BY start_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function recordChatOffenseAndBan(userId) {
  await pool.query(
    `INSERT INTO chat_user_offenses (user_id, offense_count, last_offense_at)
     VALUES (?, 1, NOW())
     ON DUPLICATE KEY UPDATE offense_count = offense_count + 1, last_offense_at = NOW()`,
    [userId]
  );
  const [rows] = await pool.query('SELECT offense_count FROM chat_user_offenses WHERE user_id = ?', [userId]);
  const offenseCount = rows[0]?.offense_count || 1;

  let endAt = null;
  let manualUnban = 0;
  if (offenseCount === 1) {
    endAt = new Date(Date.now() + 60 * 60 * 1000);
  } else if (offenseCount === 2) {
    endAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  } else {
    manualUnban = 1;
  }

  await pool.query(
    `INSERT INTO user_bans (user_id, scope, reason, offense_count, start_at, end_at, manual_unban_required)
     VALUES (?, 'chat', ?, ?, NOW(), ?, ?)`,
    [userId, 'bad_words', offenseCount, endAt ? toMySqlDateTimeLocal(endAt) : null, manualUnban]
  );

  return { offenseCount, endAt, manualUnban };
}

async function enforceChatPostingRules(userId, threadId, body) {
  const activeBan = await getActiveChatBan(userId);
  if (activeBan) {
    return { ok: false, error: 'You are currently banned from chat.', ban: activeBan };
  }

  const bannedWords = await getChatBannedWords();
  const found = findBannedWords(body, bannedWords);
  if (found.length) {
    const banInfo = await recordChatOffenseAndBan(userId);
    return { 
      ok: false, 
      error: 'Message contains banned words. You have been temporarily banned.', 
      ban: banInfo 
    };
  }

  if (CHAT_RATE_LIMIT_PER_MIN > 0) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) as c FROM chat_messages 
       WHERE sender_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)`,
      [userId]
    );
    if ((rows[0]?.c || 0) >= CHAT_RATE_LIMIT_PER_MIN) {
      return { ok: false, error: 'Rate limit exceeded. Please slow down.' };
    }
  }

  if (CHAT_DUPLICATE_WINDOW_SEC > 0) {
    const [rows] = await pool.query(
      `SELECT body, created_at FROM chat_messages 
       WHERE sender_id = ? AND thread_id = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [userId, threadId]
    );
    if (rows.length) {
      const lastBody = normalizeChatBody(rows[0].body);
      const nextBody = normalizeChatBody(body);
      const lastTime = new Date(rows[0].created_at).getTime();
      if (lastBody && nextBody && lastBody === nextBody) {
        const diffSec = (Date.now() - lastTime) / 1000;
        if (diffSec <= CHAT_DUPLICATE_WINDOW_SEC) {
          return { ok: false, error: 'Duplicate message blocked. Please wait before repeating.' };
        }
      }
    }
  }

  return { ok: true };
}

async function ensureChatThreads(type, ids) {
  if (!ids || !ids.length) return;
  const values = ids.map(() => '(?, ?)').join(', ');
  const params = [];
  ids.forEach(id => {
    params.push(type, id);
  });
  await pool.query(`INSERT IGNORE INTO chat_threads (type, ref_id) VALUES ${values}`, params);
}

async function ensureChatSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_threads (
        id INT PRIMARY KEY AUTO_INCREMENT,
        type ENUM('club', 'event') NOT NULL,
        ref_id INT NOT NULL,
        last_message_at TIMESTAMP NULL DEFAULT NULL,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_chat_thread (type, ref_id),
        INDEX idx_chat_threads_last_message (last_message_at)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id INT PRIMARY KEY AUTO_INCREMENT,
        thread_id INT NOT NULL,
        parent_id INT NULL,
        sender_id INT NOT NULL,
        body TEXT NOT NULL,
        is_announcement TINYINT(1) DEFAULT 0,
        is_deleted TINYINT(1) DEFAULT 0,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        deleted_by INT NULL,
        edited_at TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES chat_messages(id) ON DELETE SET NULL,
        FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_chat_messages_thread (thread_id),
        INDEX idx_chat_messages_parent (parent_id),
        INDEX idx_chat_messages_sender (sender_id),
        INDEX idx_chat_messages_created (created_at)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_votes (
        id INT PRIMARY KEY AUTO_INCREMENT,
        message_id INT NOT NULL,
        user_id INT NOT NULL,
        vote TINYINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_chat_vote (message_id, user_id),
        FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_chat_votes_message (message_id),
        INDEX idx_chat_votes_user (user_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_pins (
        id INT PRIMARY KEY AUTO_INCREMENT,
        thread_id INT NOT NULL,
        message_id INT NOT NULL,
        pinned_by INT NULL,
        pinned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_chat_pin (thread_id, message_id),
        FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE,
        FOREIGN KEY (pinned_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_chat_pins_thread (thread_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_banned_words (
        id INT PRIMARY KEY AUTO_INCREMENT,
        word VARCHAR(100) UNIQUE NOT NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_user_offenses (
        user_id INT PRIMARY KEY,
        offense_count INT DEFAULT 0,
        last_offense_at TIMESTAMP NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_bans (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        scope ENUM('chat', 'system') DEFAULT 'chat',
        reason VARCHAR(255) NOT NULL,
        offense_count INT DEFAULT 0,
        banned_by INT NULL,
        start_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_at TIMESTAMP NULL,
        manual_unban_required TINYINT(1) DEFAULT 0,
        revoked_at TIMESTAMP NULL,
        revoked_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (banned_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_user_bans_user (user_id, scope),
        INDEX idx_user_bans_active (scope, revoked_at, end_at)
      )
    `);
  } catch (e) {
    console.error('Failed to ensure chat schema:', e.message);
    throw e;
  }
}

async function backfillChatThreads() {
  try {
    const [clubRows] = await pool.query('SELECT id FROM clubs');
    const clubIds = clubRows.map(r => r.id);
    await ensureChatThreads('club', clubIds);

    const [eventRows] = await pool.query('SELECT id FROM events');
    const eventIds = eventRows.map(r => r.id);
    await ensureChatThreads('event', eventIds);
  } catch (e) {
    console.error('Failed to backfill chat threads:', e.message);
  }
}

async function getChatThreadAccess(threadId, userId, role) {
  const [rows] = await pool.query('SELECT * FROM chat_threads WHERE id = ?', [threadId]);
  if (!rows.length) return { ok: false, error: 'Thread not found' };
  const thread = rows[0];
  const isArchived = !!thread.deleted_at;

  if (isArchived && role !== 'admin') {
    return { ok: false, error: 'Chat has been archived' };
  }

  if (role === 'admin') {
    let title = '';
    let isClosed = false;
    if (thread.type === 'club') {
      const [club] = await pool.query('SELECT name FROM clubs WHERE id = ?', [thread.ref_id]);
      title = club[0]?.name || 'Archived club chat';
    } else {
      const [event] = await pool.query('SELECT title, status FROM events WHERE id = ?', [thread.ref_id]);
      title = event[0]?.title || 'Archived event chat';
      if (event[0]?.status && ['closed', 'rejected'].includes(event[0].status)) {
        isClosed = true;
      }
    }
    const canPost = !isClosed && !isArchived;
    return { ok: true, thread, title, canRead: true, canPost, canPin: canPost, canAnnounce: canPost, canModerate: true, isClosed, isArchived };
  }

  if (thread.type === 'club') {
    const [club] = await pool.query('SELECT name FROM clubs WHERE id = ?', [thread.ref_id]);
    if (!club.length) return { ok: false, error: 'Club not found' };
    const [membership] = await pool.query(
      'SELECT role FROM club_members WHERE club_id = ? AND user_id = ?',
      [thread.ref_id, userId]
    );
    if (!membership.length) return { ok: false, error: 'Club membership required' };
    const memberRole = membership[0].role;
    const isLeader = memberRole === 'head' || memberRole === 'coordinator';
    if (role === 'organizer' && !isLeader) {
      return { ok: false, error: 'Organizer access is limited to clubs you manage' };
    }
    return { 
      ok: true, 
      thread, 
      title: club[0].name, 
      canRead: true, 
      canPost: true, 
      canPin: isLeader, 
      canAnnounce: isLeader, 
      canModerate: isLeader,
      isClosed: false,
      isArchived: false
    };
  }

  if (thread.type === 'event') {
    const [events] = await pool.query('SELECT id, title, created_by, status FROM events WHERE id = ?', [thread.ref_id]);
    if (!events.length) return { ok: false, error: 'Event not found' };
    const event = events[0];
    const isClosed = ['closed', 'rejected'].includes(event.status);
    const isOrganizer = event.created_by === userId;
    if (isOrganizer) {
      return { 
        ok: true, 
        thread, 
        title: event.title, 
        canRead: true, 
        canPost: !isClosed, 
        canPin: !isClosed, 
        canAnnounce: !isClosed, 
        canModerate: true,
        isClosed,
        isArchived: false
      };
    }
    const [reg] = await pool.query(
      `SELECT status FROM event_registrations 
       WHERE event_id = ? AND user_id = ? AND status <> 'cancelled'`,
      [event.id, userId]
    );
    if (role === 'organizer' && !isOrganizer) {
      return { ok: false, error: 'Organizer access is limited to events you manage' };
    }
    if (!reg.length) return { ok: false, error: 'Event registration required' };
    return { 
      ok: true, 
      thread, 
      title: event.title, 
      canRead: true, 
      canPost: !isClosed, 
      canPin: false, 
      canAnnounce: false, 
      canModerate: false,
      isClosed,
      isArchived: false
    };
  }

  return { ok: false, error: 'Invalid thread type' };
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

function redirectPathForRole(role) {
  if (role === 'admin') return '/admin-home';
  if (role === 'organizer') return '/organizer-home';
  return '/student-home';
}

async function findOrLinkOAuthUser(profile) {
  const provider = 'google';
  const oauthId = profile?.id;
  const email = profile?.emails?.[0]?.value?.toLowerCase() || null;

  if (!oauthId) {
    throw new Error('Missing OAuth profile id');
  }

  const [byOauth] = await pool.query(
    'SELECT id, email, role, is_active, deleted_at, oauth_provider, oauth_id FROM users WHERE oauth_provider = ? AND oauth_id = ? LIMIT 1',
    [provider, oauthId]
  );
  if (byOauth.length) return byOauth[0];

  if (!email) {
    return null;
  }

  const [byEmail] = await pool.query(
    'SELECT id, email, role, is_active, deleted_at, oauth_provider, oauth_id FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  if (!byEmail.length) return null;

  const existing = byEmail[0];
  
  // BLOCK: User signed up manually with email+password, prevent OAuth login
  if (existing.oauth_provider === 'local') {
    throw new Error('Account already exists. Please log in using email and password.');
  }
  
  if (existing.oauth_provider && existing.oauth_provider !== provider) {
    throw new Error('Account is linked to a different OAuth provider');
  }
  if (existing.oauth_id && existing.oauth_id !== oauthId) {
    throw new Error('OAuth account mismatch for this email');
  }
  if (!existing.oauth_provider || !existing.oauth_id) {
    await pool.query('UPDATE users SET oauth_provider = ?, oauth_id = ? WHERE id = ?', [provider, oauthId, existing.id]);
    return { ...existing, oauth_provider: provider, oauth_id: oauthId };
  }
  return existing;
}

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await pool.query('SELECT id, email, role, is_active, deleted_at FROM users WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return done(null, false);
    return done(null, rows[0]);
  } catch (err) {
    return done(err);
  }
});

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
  state: true
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const user = await findOrLinkOAuthUser(profile);
    if (!user) {
      return done(null, false, { message: 'No account found. Please sign up first.' });
    }
    if (!user.is_active || user.deleted_at) {
      return done(null, false, { message: 'Account is disabled or deleted' });
    }
    return done(null, { id: user.id, email: user.email, role: user.role });
  } catch (err) {
    if (err && err.message) {
      return done(null, false, { message: err.message });
    }
    return done(err);
  }
}));

// Maintenance mode: block non-admin write operations
app.use(async (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.path === '/login' || req.path === '/logout') return next();
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
    const [r] = await pool.query('INSERT INTO users (email, password, role, oauth_provider) VALUES (?, ?, ?, ?)', [email, hashed, userRole, 'local']);
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
    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
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

// ==================== OAUTH: GOOGLE ====================

app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  prompt: 'select_account'
}));

app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: true }, (err, user, info) => {
    if (err || !user) {
      if (err) console.error('Google OAuth error:', err);
      const reason = info?.message || 'OAuth login failed. Please try again.';
      // Check if this is the "local account exists" error
      if (info?.message && info.message.includes('Account already exists with email and password')) {
        return res.redirect('/login?error=account_exists');
      }
      return res.redirect('/?oauth=failed&reason=' + encodeURIComponent(reason));
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.email = user.email;
      return res.redirect(redirectPathForRole(user.role));
    });
  })(req, res, next);
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
    res.json({ success: true, message: 'Joined club' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== EVENTS ====================

app.get('/api/events', async (req, res) => {
  try {
    const uid = getUserId(req) || -1;
    const [rows] = await pool.query(
      `SELECT 
         e.id,
         e.title,
         e.description,
         e.status,
         e.event_date,
         e.start_time,
         e.end_time,
         e.location,
         e.online_link,
         e.max_participants,
         e.registration_deadline,
         (
           SELECT GROUP_CONCAT(c.name SEPARATOR ', ')
           FROM event_clubs ec
           JOIN clubs c ON c.id = ec.club_id
           WHERE ec.event_id = e.id
         ) AS club_name,
         (
           SELECT er.status
           FROM event_registrations er
           WHERE er.event_id = e.id AND er.user_id = ?
           ORDER BY er.registered_at DESC
           LIMIT 1
         ) AS reg_status
       FROM events e
       WHERE e.status IN ('published', 'closed')
       ORDER BY e.event_date DESC, e.start_time DESC
       LIMIT 50`,
      [uid]
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
         e.start_time,
         e.end_time,
         e.location,
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
      `SELECT id, title, description, event_date, start_time, end_time, location, online_link,
              max_participants, registration_deadline, status, created_at, updated_at
       FROM events
       WHERE created_by = ?
       ORDER BY event_date ASC, start_time ASC`,
      [req.session.userId]
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
    const [events] = await pool.query('SELECT status, registration_deadline, max_participants FROM events WHERE id = ?', [eventId]);
    if (!events.length) return res.status(404).json({ success: false, message: 'Event not found' });
    if (events[0].status !== 'published') {
      return res.status(403).json({ success: false, message: 'Registrations are closed for this event' });
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
    res.json({ success: true, events: rows });
  } catch (e) {
    console.error('Error fetching events:', e);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/events - Create event (organizer only)
app.post('/api/events', requireOrganizer, async (req, res) => {
  const { title, description, event_date, start_time, end_time, location, online_link, max_participants, registration_deadline, status } = req.body;
  
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
  
  const maxParts = parseInt(max_participants, 10);
  if (isNaN(maxParts) || maxParts < 0) {
    return res.status(400).json({ error: 'max_participants must be an integer >= 0' });
  }

  const allowedCreateStatuses = ['draft', 'published'];
  const requestedStatus = status ? String(status) : 'draft';
  if (!allowedCreateStatuses.includes(requestedStatus)) {
    return res.status(400).json({ error: 'Invalid status for new event' });
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

    const [r] = await pool.query(
      `INSERT INTO events (title, description, event_date, start_time, end_time, location, online_link, 
       max_participants, registration_deadline, created_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description, event_date, start_time, end_time, location || null, online_link || null, 
       maxParts, formattedDeadline, req.session.userId, initialStatus]
    );
    await ensureChatThreads('event', [r.insertId]);
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
    
    // Validate and format registration_deadline if provided
    let formattedDeadline = undefined;
    if (registration_deadline !== undefined) {
      if (registration_deadline) {
        const deadline = parseLocalDateTime(registration_deadline);
        if (!deadline) {
          return res.status(400).json({ error: 'Invalid registration deadline format' });
        }
        if (event_date && start_time) {
          const eventStart = parseLocalDateTime(`${event_date}T${start_time}`);
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
      const allowedStatuses = ['draft', 'pending_approval', 'published', 'closed'];
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
    if (start_time !== undefined) { updates.push('start_time = ?'); values.push(start_time); }
    if (end_time !== undefined) { updates.push('end_time = ?'); values.push(end_time); }
    if (location !== undefined) { updates.push('location = ?'); values.push(location); }
    if (online_link !== undefined) { updates.push('online_link = ?'); values.push(online_link); }
    if (max_participants !== undefined) { updates.push('max_participants = ?'); values.push(parseInt(max_participants, 10)); }
    if (formattedDeadline !== undefined) { updates.push('registration_deadline = ?'); values.push(formattedDeadline); }
    if (normalizedStatus !== undefined) { updates.push('status = ?'); values.push(normalizedStatus); }
    
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
    await pool.query('UPDATE chat_threads SET deleted_at = NOW() WHERE type = ? AND ref_id = ?', ['event', eventId]);
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

app.get('/api/events/:id/registrations', requireAuth, async (req, res) => {
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

app.post('/api/events/:id/notify', requireAuth, async (req, res) => {
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

app.post('/api/resources/book', requireAuth, async (req, res) => {
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
    const status = 'pending';
    const [ins] = await pool.query(
      'INSERT INTO resource_bookings (resource_id, user_id, start_datetime, end_datetime, status, purpose) VALUES (?, ?, ?, ?, ?, ?)',
      [resourceId, uid, start_datetime, end_datetime, status, purpose || '']
    );
    res.json({ success: true, bookingId: ins.insertId, status, message: 'Booking pending approval' });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

// ==================== ADMIN: RESOURCE APPROVALS ====================

app.get('/api/admin/resource-bookings', requireAdmin, async (req, res) => {
  const { status, search } = req.query;
  try {
    let query = `
      SELECT rb.id, rb.resource_id, rb.user_id, rb.start_datetime, rb.end_datetime, rb.status, rb.purpose, rb.created_at,
             r.name AS resource_name, r.category,
             u.email AS user_email, up.full_name AS user_name
      FROM resource_bookings rb
      JOIN resources r ON r.id = rb.resource_id
      JOIN users u ON u.id = rb.user_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    if (status) {
      query += ' AND rb.status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (r.name LIKE ? OR u.email LIKE ? OR up.full_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY rb.created_at DESC LIMIT 200';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, bookings: rows });
  } catch (e) {
    console.error('Error fetching resource bookings:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/resource-bookings/:id/approve', requireAdmin, async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  try {
    const [rows] = await pool.query(
      `SELECT rb.id, rb.resource_id, rb.user_id, rb.start_datetime, rb.end_datetime, rb.status,
              r.name as resource_name
       FROM resource_bookings rb
       JOIN resources r ON r.id = rb.resource_id
       WHERE rb.id = ?`,
      [bookingId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    const booking = rows[0];
    if (booking.status === 'approved') {
      return res.json({ success: true, message: 'Booking already approved' });
    }
    if (booking.status === 'rejected' || booking.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Cannot approve a rejected/cancelled booking' });
    }

    const [overlap] = await pool.query(
      `SELECT COUNT(*) as c
       FROM resource_bookings
       WHERE resource_id = ?
         AND status = 'approved'
         AND id <> ?
         AND NOT (end_datetime <= ? OR start_datetime >= ?)`,
      [booking.resource_id, bookingId, booking.start_datetime, booking.end_datetime]
    );
    if (overlap[0].c > 0) {
      return res.status(409).json({ success: false, message: 'Resource is already booked for that time' });
    }

    await pool.query(
      'UPDATE resource_bookings SET status = ?, approved_by = ?, updated_at = NOW() WHERE id = ?',
      ['approved', req.session.userId, bookingId]
    );
    await pool.query(
      'INSERT INTO notifications (user_id, title, message, type, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
      [booking.user_id, 'Resource Booking Approved', `Your booking for "${booking.resource_name}" was approved.`, 'booking_approved', 'booking', bookingId]
    );
    res.json({ success: true, message: 'Booking approved' });
  } catch (e) {
    console.error('Error approving resource booking:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/resource-bookings/:id/reject', requireAdmin, async (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  try {
    const [rows] = await pool.query(
      `SELECT rb.id, rb.user_id, rb.status, r.name as resource_name
       FROM resource_bookings rb
       JOIN resources r ON r.id = rb.resource_id
       WHERE rb.id = ?`,
      [bookingId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Booking not found' });
    const booking = rows[0];
    if (booking.status === 'rejected') {
      return res.json({ success: true, message: 'Booking already rejected' });
    }
    if (booking.status === 'approved') {
      return res.status(400).json({ success: false, message: 'Approved bookings must be cancelled instead' });
    }
    await pool.query(
      'UPDATE resource_bookings SET status = ?, approved_by = ?, updated_at = NOW() WHERE id = ?',
      ['rejected', req.session.userId, bookingId]
    );
    await pool.query(
      'INSERT INTO notifications (user_id, title, message, type, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)',
      [booking.user_id, 'Resource Booking Rejected', `Your booking for "${booking.resource_name}" was rejected.`, 'booking_rejected', 'booking', bookingId]
    );
    res.json({ success: true, message: 'Booking rejected' });
  } catch (e) {
    console.error('Error rejecting resource booking:', e);
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

// ==================== EVENT NOTIFICATIONS (Organizer → Participants) ====================

// POST /organizer/events/:eventId/notifications
// Organizer sends a notification to all registered participants of an event
app.post('/organizer/events/:eventId/notifications', requireOrganizer, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { title, message } = req.body;
    const userId = req.session.userId;

    if (!title || !message) {
      return res.status(400).json({ success: false, error: 'Title and message required' });
    }

    // Verify organizer owns this event
    const [events] = await pool.query(
      'SELECT id FROM events WHERE id = ? AND created_by = ?',
      [eventId, userId]
    );

    if (events.length === 0) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Fetch all registered participants
    const [participants] = await pool.query(
      `SELECT user_id FROM event_registrations 
       WHERE event_id = ? AND status = 'registered'`,
      [eventId]
    );

    if (participants.length === 0) {
      return res.json({ success: true, message: 'No participants to notify' });
    }

    // Insert notification once
    const [notifResult] = await pool.query(
      `INSERT INTO event_notifications (event_id, sender_id, title, message) 
       VALUES (?, ?, ?, ?)`,
      [eventId, userId, title, message]
    );

    const notificationId = notifResult.insertId;

    // Build recipient data
    const recipientData = participants.map(p => [notificationId, p.user_id]);

    // Bulk insert all recipients with correct mysql2 syntax
    if (recipientData.length > 0) {
      await pool.query(
        `INSERT INTO event_notification_recipients (notification_id, user_id) 
         VALUES ${recipientData.map(() => '(?, ?)').join(', ')}`,
        recipientData.flat()
      );
    }

    await logAdminAction(userId, req.session.email, 'send_event_notification', 'event', eventId,
      { notification_id: notificationId, recipient_count: participants.length }, getClientIp(req));

    res.json({
      success: true,
      message: `Notification sent to ${participants.length} participants`,
      notification_id: notificationId
    });
  } catch (err) {
    console.error('POST /organizer/events/:eventId/notifications error:', err);
    res.status(500).json({ success: false, error: 'Failed to send notification' });
  }
});

// GET /participant/events/:eventId/notifications
app.get('/participant/events/:eventId/notifications', requireAuth, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.session.userId;

    // Verify user is registered for the event
    const [registered] = await pool.query(
      `SELECT id FROM event_registrations 
       WHERE event_id = ? AND user_id = ? AND status = 'registered'`,
      [eventId, userId]
    );

    if (registered.length === 0) {
      return res.status(403).json({ success: false, error: 'Not registered for this event' });
    }

    // Get notifications
    const [notifications] = await pool.query(
      `SELECT en.id, en.title, en.message, en.created_at, enr.is_read,
              u.email as sender_email,
              up.full_name as sender_name
       FROM event_notifications en
       JOIN event_notification_recipients enr ON en.id = enr.notification_id
       LEFT JOIN users u ON en.sender_id = u.id
       LEFT JOIN user_profiles up ON u.id = up.user_id
       WHERE en.event_id = ? AND enr.user_id = ?
       ORDER BY en.created_at DESC`,
      [eventId, userId]
    );

    res.json({ success: true, notifications });
  } catch (err) {
    console.error('GET /participant/events/:eventId/notifications error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
  }
});

// PATCH /participant/notifications/:notificationId/read
app.patch('/participant/notifications/:notificationId/read', requireAuth, async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.session.userId;

    // Verify user is a recipient of this notification
    const [recipient] = await pool.query(
      `SELECT id FROM event_notification_recipients 
       WHERE notification_id = ? AND user_id = ?`,
      [notificationId, userId]
    );

    if (recipient.length === 0) {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
    }

    // Mark as read
    await pool.query(
      `UPDATE event_notification_recipients 
       SET is_read = 1, read_at = NOW() 
       WHERE notification_id = ? AND user_id = ?`,
      [notificationId, userId]
    );

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (err) {
    console.error('PATCH /participant/notifications/:notificationId/read error:', err);
    res.status(500).json({ success: false, error: 'Failed to update notification' });
  }
});

// ==================== MESSAGES (thread list for sidebar) ====================

app.get('/api/messages/threads', requireAuth, async (req, res) => {
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

// ==================== CHAT (Event/Club threads) ====================

async function listChatsForUser(userId, role, search) {
  if (role === 'admin') {
    const [clubIdsRows] = await pool.query('SELECT id FROM clubs');
    const [eventIdsRows] = await pool.query('SELECT id FROM events');
    await ensureChatThreads('club', clubIdsRows.map(r => r.id));
    await ensureChatThreads('event', eventIdsRows.map(r => r.id));

    const params = [];
    let where = '1=1';
    if (search) {
      where += ' AND ((ct.type = \'club\' AND c.name LIKE ?) OR (ct.type = \'event\' AND e.title LIKE ?))';
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await pool.query(
      `SELECT ct.id, ct.type, ct.ref_id, ct.created_at, ct.last_message_at, ct.deleted_at,
              c.name as club_name,
              e.title as event_title, e.status as event_status
       FROM chat_threads ct
       LEFT JOIN clubs c ON ct.type = 'club' AND c.id = ct.ref_id
       LEFT JOIN events e ON ct.type = 'event' AND e.id = ct.ref_id
       WHERE ${where}
       ORDER BY COALESCE(ct.last_message_at, ct.created_at) DESC
       LIMIT 500`,
      params
    );

    return rows.map(t => {
      const title = t.type === 'club' ? t.club_name : t.event_title;
      const isArchived = !!t.deleted_at || !title;
      const isClosed = t.type === 'event' && ['closed', 'rejected'].includes(t.event_status);
      return {
        id: t.id,
        type: t.type,
        ref_id: t.ref_id,
        title: title || (t.type === 'club' ? 'Archived club chat' : 'Archived event chat'),
        last_message_at: t.last_message_at || t.created_at,
        is_closed: isClosed || isArchived,
        is_archived: isArchived
      };
    });
  }

  let clubs = [];
  let events = [];
  if (role === 'organizer') {
    const [clubRows] = await pool.query(
      `SELECT c.id, c.name
       FROM club_members cm
       JOIN clubs c ON c.id = cm.club_id
       WHERE cm.user_id = ? AND cm.role IN ('head', 'coordinator')`,
      [userId]
    );
    clubs = clubRows;
    const [eventRows] = await pool.query(
      `SELECT id, title, status
       FROM events
       WHERE created_by = ?
       ORDER BY event_date DESC, start_time DESC`,
      [userId]
    );
    events = eventRows;
  } else {
    const [clubRows] = await pool.query(
      `SELECT c.id, c.name
       FROM club_members cm
       JOIN clubs c ON c.id = cm.club_id
       WHERE cm.user_id = ?`,
      [userId]
    );
    clubs = clubRows;
    const [eventRows] = await pool.query(
      `SELECT e.id, e.title, e.status
       FROM event_registrations er
       JOIN events e ON e.id = er.event_id
       WHERE er.user_id = ? AND er.status <> 'cancelled'
       ORDER BY e.event_date DESC, e.start_time DESC`,
      [userId]
    );
    events = eventRows;
  }

  const clubIds = clubs.map(c => c.id);
  const eventIds = events.map(e => e.id);

  await ensureChatThreads('club', clubIds);
  await ensureChatThreads('event', eventIds);

  if (!clubIds.length && !eventIds.length) return [];

  const clauses = [];
  const params = [];
  if (clubIds.length) {
    clauses.push(`(ct.type = 'club' AND ct.ref_id IN (${clubIds.map(() => '?').join(',')}))`);
    params.push(...clubIds);
  }
  if (eventIds.length) {
    clauses.push(`(ct.type = 'event' AND ct.ref_id IN (${eventIds.map(() => '?').join(',')}))`);
    params.push(...eventIds);
  }
  const where = `(${clauses.join(' OR ')}) AND ct.deleted_at IS NULL`;

  const [threads] = await pool.query(
    `SELECT ct.id, ct.type, ct.ref_id, ct.created_at, ct.last_message_at,
            c.name as club_name,
            e.title as event_title, e.status as event_status
     FROM chat_threads ct
     LEFT JOIN clubs c ON ct.type = 'club' AND c.id = ct.ref_id
     LEFT JOIN events e ON ct.type = 'event' AND e.id = ct.ref_id
     WHERE ${where}
     ORDER BY COALESCE(ct.last_message_at, ct.created_at) DESC`,
    params
  );

  let result = threads.map(t => {
    const title = t.type === 'club' ? t.club_name : t.event_title;
    const isClosed = t.type === 'event' && ['closed', 'rejected'].includes(t.event_status);
    return {
      id: t.id,
      type: t.type,
      ref_id: t.ref_id,
      title: title || '',
      last_message_at: t.last_message_at || t.created_at,
      is_closed: isClosed,
      is_archived: false
    };
  });

  result = result.filter(r => r.title);
  if (search) {
    const term = search.toLowerCase();
    result = result.filter(r => (r.title || '').toLowerCase().includes(term));
  }
  return result;
}

async function handleListChats(req, res, responseKey) {
  const userId = getUserId(req);
  const role = req.session.role;
  const search = String(req.query.q || '').trim();
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  try {
    const chats = await listChatsForUser(userId, role, search);
    res.json({ success: true, [responseKey]: chats });
  } catch (e) {
    console.error('Error loading chats:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
}

async function buildChatMessagesPayload(threadId, userId, role) {
  const access = await getChatThreadAccess(threadId, userId, role);
  if (!access.ok) {
    return { ok: false, status: 403, message: access.error };
  }

  const activeBan = await getActiveChatBan(userId);
  const [pinRows] = await pool.query('SELECT message_id FROM chat_pins WHERE thread_id = ?', [threadId]);
  const pinnedIds = pinRows.map(r => r.message_id);

  const [rows] = await pool.query(
    `SELECT m.id, m.thread_id, m.parent_id, m.sender_id, m.body, m.is_announcement, m.is_deleted,
            m.deleted_at, m.deleted_by, m.edited_at, m.created_at,
            u.role as sender_role, u.email as sender_email,
            up.full_name as sender_name,
            uv.vote as user_vote,
            COALESCE(vs.upvotes, 0) as upvotes,
            COALESCE(vs.downvotes, 0) as downvotes
     FROM chat_messages m
     JOIN users u ON u.id = m.sender_id
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN (
       SELECT message_id,
         SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END) as upvotes,
         SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END) as downvotes
       FROM chat_votes
       GROUP BY message_id
     ) vs ON vs.message_id = m.id
     LEFT JOIN chat_votes uv ON uv.message_id = m.id AND uv.user_id = ?
     WHERE m.thread_id = ?
     ORDER BY m.created_at ASC`,
    [userId, threadId]
  );

  const now = Date.now();
  const isAdmin = role === 'admin';
  const messages = rows.map(r => {
    const created = new Date(r.created_at);
    const minutesAgo = (now - created.getTime()) / 60000;
    const canEdit = r.sender_id === userId && !r.is_deleted && minutesAgo <= CHAT_EDIT_WINDOW_MIN && !activeBan && access.canPost;
    const canDelete = isAdmin || access.canModerate || r.sender_id === userId;
    const name = r.sender_name || (r.sender_email ? r.sender_email.split('@')[0] : 'User');
    let body = r.body;
    let displayBody = r.body;
    if (r.is_deleted && !isAdmin) {
      body = null;
      displayBody = 'Message deleted';
    }
    return {
      id: r.id,
      thread_id: r.thread_id,
      parent_id: r.parent_id,
      sender_id: r.sender_id,
      sender_name: name,
      sender_role: r.sender_role,
      body,
      display_body: displayBody,
      is_announcement: !!r.is_announcement,
      is_deleted: !!r.is_deleted,
      deleted_at: r.deleted_at,
      deleted_by: r.deleted_by,
      edited_at: r.edited_at,
      created_at: r.created_at,
      upvotes: r.upvotes,
      downvotes: r.downvotes,
      user_vote: r.user_vote,
      can_edit: canEdit,
      can_delete: canDelete,
      is_pinned: pinnedIds.includes(r.id)
    };
  });

  const pinned = messages.filter(m => pinnedIds.includes(m.id));

  return {
    ok: true,
    payload: {
      success: true,
      thread: {
        id: access.thread.id,
        type: access.thread.type,
        ref_id: access.thread.ref_id,
        title: access.title,
        is_closed: access.isClosed,
        is_archived: access.isArchived
      },
      permissions: {
        canRead: access.canRead,
        canPost: access.canPost,
        canPin: access.canPin,
        canAnnounce: access.canAnnounce,
        canModerate: access.canModerate
      },
      ban: activeBan,
      pinned,
      messages
    }
  };
}

async function handleGetChatMessages(req, res) {
  const userId = getUserId(req);
  const role = req.session.role;
  const threadId = parseInt(req.params.threadId, 10);
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  if (!threadId) return res.status(400).json({ success: false, message: 'Invalid chat' });
  try {
    const result = await buildChatMessagesPayload(threadId, userId, role);
    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }
    res.json(result.payload);
  } catch (e) {
    console.error('Error loading chat messages:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
}

async function handlePostChatMessage(req, res) {
  const userId = getUserId(req);
  const role = req.session.role;
  const threadId = parseInt(req.params.threadId, 10);
  const { body, parentId, is_announcement } = req.body || {};
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  if (!threadId) return res.status(400).json({ success: false, message: 'Invalid chat' });
  const trimmed = String(body || '').trim();
  if (!trimmed) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

  try {
    const access = await getChatThreadAccess(threadId, userId, role);
    if (!access.ok) return res.status(403).json({ success: false, message: access.error });
    if (!access.canPost) {
      return res.status(403).json({ success: false, message: access.isClosed ? 'Chat is closed' : 'Posting not allowed' });
    }

    if (parentId) {
      const [parent] = await pool.query(
        'SELECT id FROM chat_messages WHERE id = ? AND thread_id = ?',
        [parentId, threadId]
      );
      if (!parent.length) {
        return res.status(400).json({ success: false, message: 'Invalid parent message' });
      }
    }

    const rules = await enforceChatPostingRules(userId, threadId, trimmed);
    if (!rules.ok) {
      return res.status(403).json({ success: false, message: rules.error, ban: rules.ban || null });
    }

    const announcement = access.canAnnounce && !!is_announcement ? 1 : 0;

    const [result] = await pool.query(
      `INSERT INTO chat_messages (thread_id, parent_id, sender_id, body, is_announcement)
       VALUES (?, ?, ?, ?, ?)`,
      [threadId, parentId || null, userId, trimmed, announcement]
    );
    await pool.query('UPDATE chat_threads SET last_message_at = NOW() WHERE id = ?', [threadId]);
    res.json({ success: true, messageId: result.insertId });
  } catch (e) {
    console.error('Error posting chat message:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
}

app.get('/api/chat/threads', requireAuth, (req, res) => handleListChats(req, res, 'threads'));
app.get('/api/chats', requireAuth, (req, res) => handleListChats(req, res, 'chats'));

app.get('/api/chat/threads/:threadId', requireAuth, handleGetChatMessages);
app.get('/api/chats/:threadId/messages', requireAuth, handleGetChatMessages);

app.post('/api/chat/threads/:threadId/messages', requireAuth, handlePostChatMessage);
app.post('/api/chats/:threadId/messages', requireAuth, handlePostChatMessage);

app.put('/api/chat/messages/:id', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const role = req.session.role;
  const messageId = parseInt(req.params.id, 10);
  const { body } = req.body || {};
  const trimmed = String(body || '').trim();
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  if (!messageId) return res.status(400).json({ success: false, message: 'Invalid message' });
  if (!trimmed) return res.status(400).json({ success: false, message: 'Message cannot be empty' });

  try {
    const [rows] = await pool.query(
      `SELECT m.id, m.thread_id, m.sender_id, m.is_deleted, m.created_at
       FROM chat_messages m WHERE m.id = ?`,
      [messageId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Message not found' });
    const msg = rows[0];
    const access = await getChatThreadAccess(msg.thread_id, userId, role);
    if (!access.ok) return res.status(403).json({ success: false, message: access.error });
    if (!access.canPost) {
      return res.status(403).json({ success: false, message: access.isClosed ? 'Chat is closed' : 'Editing not allowed' });
    }
    const activeBan = await getActiveChatBan(userId);
    if (activeBan) {
      return res.status(403).json({ success: false, message: 'You are currently banned from chat.' });
    }
    if (msg.sender_id !== userId) {
      return res.status(403).json({ success: false, message: 'Only the author can edit this message' });
    }
    if (msg.is_deleted) {
      return res.status(400).json({ success: false, message: 'Deleted messages cannot be edited' });
    }
    const minutesAgo = (Date.now() - new Date(msg.created_at).getTime()) / 60000;
    if (minutesAgo > CHAT_EDIT_WINDOW_MIN) {
      return res.status(403).json({ success: false, message: 'Edit window expired' });
    }
    await pool.query('UPDATE chat_messages SET body = ?, edited_at = NOW() WHERE id = ?', [trimmed, messageId]);
    res.json({ success: true, message: 'Message updated' });
  } catch (e) {
    console.error('Error editing chat message:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/chat/messages/:id', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const role = req.session.role;
  const messageId = parseInt(req.params.id, 10);
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  if (!messageId) return res.status(400).json({ success: false, message: 'Invalid message' });

  try {
    const [rows] = await pool.query(
      `SELECT m.id, m.thread_id, m.sender_id, m.is_deleted
       FROM chat_messages m WHERE m.id = ?`,
      [messageId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Message not found' });
    const msg = rows[0];
    const access = await getChatThreadAccess(msg.thread_id, userId, role);
    if (!access.ok) return res.status(403).json({ success: false, message: access.error });
    const canDelete = role === 'admin' || access.canModerate || msg.sender_id === userId;
    if (!canDelete) return res.status(403).json({ success: false, message: 'Not allowed to delete this message' });
    if (msg.is_deleted) return res.json({ success: true, message: 'Message already deleted' });
    await pool.query(
      `UPDATE chat_messages 
       SET is_deleted = 1, deleted_at = NOW(), deleted_by = ? 
       WHERE id = ?`,
      [userId, messageId]
    );
    res.json({ success: true, message: 'Message deleted' });
  } catch (e) {
    console.error('Error deleting chat message:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/chat/messages/:id/vote', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const role = req.session.role;
  const messageId = parseInt(req.params.id, 10);
  const { vote } = req.body || {};
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  if (!messageId) return res.status(400).json({ success: false, message: 'Invalid message' });
  const voteVal = vote === 'up' ? 1 : vote === 'down' ? -1 : 0;
  if (!voteVal) return res.status(400).json({ success: false, message: 'Vote must be up or down' });

  try {
    const [rows] = await pool.query('SELECT thread_id, is_deleted FROM chat_messages WHERE id = ?', [messageId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Message not found' });
    if (rows[0].is_deleted) return res.status(400).json({ success: false, message: 'Cannot vote on deleted message' });
    const access = await getChatThreadAccess(rows[0].thread_id, userId, role);
    if (!access.ok) return res.status(403).json({ success: false, message: access.error });

    const [existing] = await pool.query(
      'SELECT vote FROM chat_votes WHERE message_id = ? AND user_id = ?',
      [messageId, userId]
    );
    if (existing.length) {
      if (existing[0].vote === voteVal) {
        await pool.query('DELETE FROM chat_votes WHERE message_id = ? AND user_id = ?', [messageId, userId]);
        return res.json({ success: true, message: 'Vote removed', vote: 0 });
      }
      await pool.query(
        'UPDATE chat_votes SET vote = ? WHERE message_id = ? AND user_id = ?',
        [voteVal, messageId, userId]
      );
      return res.json({ success: true, message: 'Vote updated', vote: voteVal });
    }

    await pool.query(
      'INSERT INTO chat_votes (message_id, user_id, vote) VALUES (?, ?, ?)',
      [messageId, userId, voteVal]
    );
    res.json({ success: true, message: 'Vote recorded', vote: voteVal });
  } catch (e) {
    console.error('Error voting on chat message:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/chat/messages/:id/vote', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const messageId = parseInt(req.params.id, 10);
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  if (!messageId) return res.status(400).json({ success: false, message: 'Invalid message' });
  try {
    await pool.query('DELETE FROM chat_votes WHERE message_id = ? AND user_id = ?', [messageId, userId]);
    res.json({ success: true, message: 'Vote removed' });
  } catch (e) {
    console.error('Error removing vote:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/chat/threads/:threadId/pins', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const role = req.session.role;
  const threadId = parseInt(req.params.threadId, 10);
  const { messageId } = req.body || {};
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  if (!threadId || !messageId) return res.status(400).json({ success: false, message: 'Invalid request' });
  try {
    const access = await getChatThreadAccess(threadId, userId, role);
    if (!access.ok) return res.status(403).json({ success: false, message: access.error });
    if (!access.canPin) return res.status(403).json({ success: false, message: 'Pinning not allowed' });

    const [msg] = await pool.query('SELECT id FROM chat_messages WHERE id = ? AND thread_id = ?', [messageId, threadId]);
    if (!msg.length) return res.status(404).json({ success: false, message: 'Message not found' });

    await pool.query(
      'INSERT IGNORE INTO chat_pins (thread_id, message_id, pinned_by) VALUES (?, ?, ?)',
      [threadId, messageId, userId]
    );
    res.json({ success: true, message: 'Message pinned' });
  } catch (e) {
    console.error('Error pinning message:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/chat/threads/:threadId/pins/:messageId', requireAuth, async (req, res) => {
  const userId = getUserId(req);
  const role = req.session.role;
  const threadId = parseInt(req.params.threadId, 10);
  const messageId = parseInt(req.params.messageId, 10);
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  if (!threadId || !messageId) return res.status(400).json({ success: false, message: 'Invalid request' });
  try {
    const access = await getChatThreadAccess(threadId, userId, role);
    if (!access.ok) return res.status(403).json({ success: false, message: access.error });
    if (!access.canPin) return res.status(403).json({ success: false, message: 'Unpinning not allowed' });

    await pool.query('DELETE FROM chat_pins WHERE thread_id = ? AND message_id = ?', [threadId, messageId]);
    res.json({ success: true, message: 'Message unpinned' });
  } catch (e) {
    console.error('Error unpinning message:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

async function handleChatSearch(req, res) {
  const userId = getUserId(req);
  const role = req.session.role;
  const threadId = parseInt(req.params.threadId, 10);
  const q = String(req.query.q || '').trim();
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  if (!threadId) return res.status(400).json({ success: false, message: 'Invalid chat' });
  if (!q) return res.status(400).json({ success: false, message: 'Search query required' });
  try {
    const access = await getChatThreadAccess(threadId, userId, role);
    if (!access.ok) return res.status(403).json({ success: false, message: access.error });

    const [rows] = await pool.query(
      `SELECT m.id, m.thread_id, m.parent_id, m.sender_id, m.body, m.is_deleted, m.created_at,
              u.role as sender_role, u.email as sender_email, up.full_name as sender_name
       FROM chat_messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE m.thread_id = ? AND m.body LIKE ?
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [threadId, `%${q}%`]
    );

    const results = rows.map(r => {
      const name = r.sender_name || (r.sender_email ? r.sender_email.split('@')[0] : 'User');
      let body = r.body;
      let displayBody = r.body;
      if (r.is_deleted && role !== 'admin') {
        body = null;
        displayBody = 'Message deleted';
      }
      return {
        id: r.id,
        parent_id: r.parent_id,
        sender_id: r.sender_id,
        sender_name: name,
        sender_role: r.sender_role,
        body,
        display_body: displayBody,
        created_at: r.created_at
      };
    });

    res.json({ success: true, results });
  } catch (e) {
    console.error('Error searching chat messages:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
}

async function handleDeleteChatThread(req, res) {
  const userId = getUserId(req);
  const role = req.session.role;
  const threadId = parseInt(req.params.threadId, 10);
  if (!userId) return res.status(401).json({ success: false, message: 'User ID required' });
  if (!threadId) return res.status(400).json({ success: false, message: 'Invalid chat' });
  if (role !== 'admin') return res.status(403).json({ success: false, message: 'Admin access required' });
  try {
    await pool.query('UPDATE chat_threads SET deleted_at = NOW() WHERE id = ?', [threadId]);
    res.json({ success: true, message: 'Chat archived' });
  } catch (e) {
    console.error('Error deleting chat:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
}

app.get('/api/chat/threads/:threadId/search', requireAuth, handleChatSearch);
app.get('/api/chats/:threadId/search', requireAuth, handleChatSearch);

app.delete('/api/chat/threads/:threadId', requireAuth, handleDeleteChatThread);
app.delete('/api/chats/:threadId', requireAuth, handleDeleteChatThread);

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

// ==================== ADMIN: CHAT MODERATION ====================

app.get('/api/admin/chat/bans', requireAdmin, async (req, res) => {
  const { activeOnly } = req.query;
  try {
    let query = `
      SELECT b.*, u.email, up.full_name
      FROM user_bans b
      JOIN users u ON u.id = b.user_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE b.scope = 'chat'
    `;
    const params = [];
    if (activeOnly !== 'false') {
      query += ' AND b.revoked_at IS NULL AND (b.end_at IS NULL OR b.end_at > NOW())';
    }
    query += ' ORDER BY b.start_at DESC LIMIT 200';
    const [rows] = await pool.query(query, params);
    res.json({ success: true, bans: rows });
  } catch (e) {
    console.error('Error fetching chat bans:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/admin/chat/ban', requireAdmin, async (req, res) => {
  const { userId, durationHours, reason, permanent } = req.body || {};
  const targetId = parseInt(userId, 10);
  if (!targetId) return res.status(400).json({ success: false, message: 'userId required' });
  const hours = durationHours ? parseInt(durationHours, 10) : null;
  if (hours !== null && (isNaN(hours) || hours <= 0)) {
    return res.status(400).json({ success: false, message: 'durationHours must be a positive number' });
  }
  try {
    const [user] = await pool.query('SELECT email FROM users WHERE id = ?', [targetId]);
    if (!user.length) return res.status(404).json({ success: false, message: 'User not found' });

    let endAt = null;
    let manualUnban = 0;
    if (permanent) {
      manualUnban = 1;
    } else if (hours) {
      endAt = new Date(Date.now() + hours * 60 * 60 * 1000);
    }

    await pool.query(
      `INSERT INTO user_bans (user_id, scope, reason, offense_count, banned_by, start_at, end_at, manual_unban_required)
       VALUES (?, 'chat', ?, 0, ?, NOW(), ?, ?)`,
      [targetId, reason || 'manual_ban', req.session.userId, endAt ? toMySqlDateTimeLocal(endAt) : null, manualUnban]
    );

    await logAdminAction(req.session.userId, req.session.email, 'chat_ban', 'user', targetId, 
      { target_email: user[0].email, durationHours: hours, permanent: !!permanent, reason: reason || 'manual_ban' }, getClientIp(req));

    res.json({ success: true, message: 'User banned from chat' });
  } catch (e) {
    console.error('Error banning user:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/admin/chat/unban', requireAdmin, async (req, res) => {
  const { userId, reason } = req.body || {};
  const targetId = parseInt(userId, 10);
  if (!targetId) return res.status(400).json({ success: false, message: 'userId required' });
  try {
    const [user] = await pool.query('SELECT email FROM users WHERE id = ?', [targetId]);
    if (!user.length) return res.status(404).json({ success: false, message: 'User not found' });
    const [result] = await pool.query(
      `UPDATE user_bans 
       SET revoked_at = NOW(), revoked_by = ? 
       WHERE user_id = ? AND scope = 'chat' 
         AND revoked_at IS NULL AND (end_at IS NULL OR end_at > NOW())`,
      [req.session.userId, targetId]
    );

    await logAdminAction(req.session.userId, req.session.email, 'chat_unban', 'user', targetId, 
      { target_email: user[0].email, reason: reason || null, affected: result.affectedRows }, getClientIp(req));

    res.json({ success: true, message: result.affectedRows ? 'User unbanned' : 'No active ban found' });
  } catch (e) {
    console.error('Error unbanning user:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.get('/api/admin/chat/banned-words', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, word, created_at FROM chat_banned_words ORDER BY word');
    res.json({ success: true, words: rows });
  } catch (e) {
    console.error('Error loading banned words:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.post('/api/admin/chat/banned-words', requireAdmin, async (req, res) => {
  const wordRaw = String(req.body?.word || '').trim();
  if (!wordRaw) return res.status(400).json({ success: false, message: 'Word required' });
  const word = wordRaw.toLowerCase();
  try {
    await pool.query('INSERT INTO chat_banned_words (word, created_by) VALUES (?, ?)', [word, req.session.userId]);
    bannedWordsCache.words = null;
    res.json({ success: true, message: 'Word added' });
  } catch (e) {
    if (e?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Word already exists' });
    }
    console.error('Error adding banned word:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.delete('/api/admin/chat/banned-words/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ success: false, message: 'Invalid word id' });
  try {
    await pool.query('DELETE FROM chat_banned_words WHERE id = ?', [id]);
    bannedWordsCache.words = null;
    res.json({ success: true, message: 'Word removed' });
  } catch (e) {
    console.error('Error removing banned word:', e);
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

app.put('/api/admin/events/:id/approve', requireAdmin, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  try {
    const [event] = await pool.query('SELECT title, created_by, status FROM events WHERE id = ?', [eventId]);
    if (!event.length) return res.status(404).json({ success: false, message: 'Event not found' });
    if (event[0].status === 'published') {
      return res.json({ success: true, message: 'Event already approved' });
    }
    await pool.query('UPDATE events SET status = ? WHERE id = ?', ['published', eventId]);
    const [existing] = await pool.query(
      `SELECT id FROM notifications 
       WHERE user_id = ? AND type = 'event_approval' AND ref_type = 'event' AND ref_id = ? 
       LIMIT 1`,
      [event[0].created_by, eventId]
    );
    if (!existing.length) {
      await pool.query(
        'INSERT INTO notifications (user_id, title, message, type, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)', 
        [event[0].created_by, 'Event Approved', `Your event "${event[0].title}" has been approved and published.`, 'event_approval', 'event', eventId]
      );
    }
    await logAdminAction(req.session.userId, req.session.email, 'approve_event', 'event', eventId, 
      { event_title: event[0].title }, getClientIp(req));
    res.json({ success: true, message: 'Event approved' });
  } catch (e) {
    console.error('Error approving event:', e);
    res.status(500).json({ success: false, message: 'Database error' });
  }
});

app.put('/api/admin/events/:id/reject', requireAdmin, async (req, res) => {
  const eventId = parseInt(req.params.id, 10);
  const { reason } = req.body;
  try {
    const [event] = await pool.query('SELECT title, created_by, status FROM events WHERE id = ?', [eventId]);
    if (!event.length) return res.status(404).json({ success: false, message: 'Event not found' });
    if (event[0].status === 'rejected') {
      return res.json({ success: true, message: 'Event already rejected' });
    }
    await pool.query('UPDATE events SET status = ?, rejection_reason = ? WHERE id = ?', ['rejected', reason || null, eventId]);
    const [existing] = await pool.query(
      `SELECT id FROM notifications 
       WHERE user_id = ? AND type = 'event_rejection' AND ref_type = 'event' AND ref_id = ? 
       LIMIT 1`,
      [event[0].created_by, eventId]
    );
    if (!existing.length) {
      await pool.query(
        'INSERT INTO notifications (user_id, title, message, type, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?)', 
        [event[0].created_by, 'Event Rejected', `Your event "${event[0].title}" was rejected. ${reason ? 'Reason: ' + reason : ''}`, 'event_rejection', 'event', eventId]
      );
    }
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
  const { title, description, event_date, start_time, end_time, location, online_link, max_participants, status } = req.body;
  try {
    const updates = [];
    const values = [];
    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (event_date !== undefined) { updates.push('event_date = ?'); values.push(event_date); }
    if (start_time !== undefined) { updates.push('start_time = ?'); values.push(start_time); }
    if (end_time !== undefined) { updates.push('end_time = ?'); values.push(end_time); }
    if (location !== undefined) { updates.push('location = ?'); values.push(location); }
    if (online_link !== undefined) { updates.push('online_link = ?'); values.push(online_link); }
    if (max_participants !== undefined) { updates.push('max_participants = ?'); values.push(max_participants); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
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
    await pool.query('UPDATE chat_threads SET deleted_at = NOW() WHERE type = ? AND ref_id = ?', ['event', eventId]);
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

app.get('/api/admin/stats', requireAdmin, async (req, res) => {
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

app.get('/api/admin/recent', requireAdmin, async (req, res) => {
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

app.get('/api/admin/top-organizers', requireAdmin, async (req, res) => {
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

// ==================== SERVER ====================

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
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
