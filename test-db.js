// Test database connection and check events table structure
const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'campus_db'
};

async function testDatabase() {
  let conn;
  try {
    console.log('Connecting to database...');
    conn = await mysql.createConnection(dbConfig);
    console.log('✓ Connected successfully\n');

    // Check events table structure
    console.log('Events table structure:');
    const [columns] = await conn.query('DESCRIBE events');
    columns.forEach(col => {
      console.log(`  ${col.Field}: ${col.Type} ${col.Null === 'NO' ? 'NOT NULL' : 'NULL'} ${col.Key ? `(${col.Key})` : ''}`);
    });
    console.log('');

    // Check if there are any users with organizer role
    const [organizers] = await conn.query('SELECT id, email, role FROM users WHERE role = ?', ['organizer']);
    console.log(`Found ${organizers.length} organizer(s):`);
    organizers.forEach(org => {
      console.log(`  ID: ${org.id}, Email: ${org.email}, Role: ${org.role}`);
    });
    console.log('');

    // Check constraints
    console.log('Checking constraints on events table:');
    const [constraints] = await conn.query(`
      SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE 
      FROM information_schema.TABLE_CONSTRAINTS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'events'
    `, [dbConfig.database]);
    constraints.forEach(c => {
      console.log(`  ${c.CONSTRAINT_NAME}: ${c.CONSTRAINT_TYPE}`);
    });

  } catch (error) {
    console.error('Error:', error.message);
    console.error('Error code:', error.code);
  } finally {
    if (conn) await conn.end();
  }
}

testDatabase();
