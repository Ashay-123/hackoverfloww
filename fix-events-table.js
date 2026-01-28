// Fix events table structure
const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'campus_db',
};

async function fixEventsTable() {
  let conn;
  try {
    console.log('Connecting to database...');
    conn = await mysql.createConnection(dbConfig);
    console.log('✓ Connected successfully\n');

    console.log('Dropping old tables...');
    await conn.query('DROP TABLE IF EXISTS event_clubs');
    await conn.query('DROP TABLE IF EXISTS event_registrations');
    await conn.query('DROP TABLE IF EXISTS events');
    console.log('✓ Old tables dropped\n');

    console.log('Creating new events table with correct structure...');
    await conn.query(`
      CREATE TABLE events (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        event_date DATE NOT NULL,
        end_date DATE NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        location VARCHAR(255) NULL,
        online_link VARCHAR(255) NULL,
        max_participants INT DEFAULT 0 NOT NULL,
        registration_deadline DATETIME NULL,
        visibility ENUM('public', 'internal', 'club') DEFAULT 'public' NOT NULL,
        status ENUM('draft', 'pending_approval', 'published', 'rejected', 'closed', 'completed') DEFAULT 'draft' NOT NULL,
        rejection_reason TEXT NULL,
        budget_total DECIMAL(10,2) DEFAULT 0.00 NOT NULL,
        budget_used DECIMAL(10,2) DEFAULT 0.00 NOT NULL,
        budget_currency CHAR(3) DEFAULT 'USD' NOT NULL,
        budget_notes TEXT NULL,
        completed_at DATETIME NULL,
        created_by INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT chk_end_after_start CHECK (end_time > start_time),
        CONSTRAINT chk_max_participants CHECK (max_participants >= 0)
      )
    `);
    console.log('✓ Events table created\n');

    console.log('Creating indexes...');
    await conn.query('CREATE INDEX idx_events_organizer_date ON events(created_by, event_date)');
    await conn.query('CREATE INDEX idx_events_status ON events(status)');
    await conn.query('CREATE INDEX idx_events_visibility ON events(visibility)');
    console.log('✓ Indexes created\n');

    console.log('Creating event_registrations table...');
    await conn.query(`
      CREATE TABLE event_registrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        event_id INT NOT NULL,
        user_id INT NOT NULL,
        status ENUM('registered', 'cancelled', 'attended') DEFAULT 'registered',
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_registration (event_id, user_id),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('✓ Event registrations table created\n');

    console.log('Creating indexes for event_registrations...');
    await conn.query('CREATE INDEX idx_registrations_user ON event_registrations(user_id)');
    await conn.query('CREATE INDEX idx_registrations_event ON event_registrations(event_id)');
    console.log('✓ Indexes created\n');

    console.log('Creating event_clubs table...');
    await conn.query(`
      CREATE TABLE event_clubs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        event_id INT NOT NULL,
        club_id INT NOT NULL,
        role VARCHAR(100),
        UNIQUE KEY unique_event_club (event_id, club_id),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
      )
    `);
    console.log('✓ Event clubs table created\n');

    console.log('✅ All tables fixed successfully!');
    console.log('\nYou can now create events through the organizer interface.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Error code:', error.code);
    console.error('SQL:', error.sql);
  } finally {
    if (conn) await conn.end();
  }
}

fixEventsTable();
