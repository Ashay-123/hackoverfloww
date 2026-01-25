const express = require('express');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Initialize SQLite database
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

// Initialize database schema
function initializeDatabase() {
    db.serialize(() => {
        // Create users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'organizer', 'participant')) DEFAULT 'participant',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => {
            if (err) {
                console.error('Error creating table:', err.message);
            } else {
                console.log('Users table ready');
                // Insert default users if they don't exist
                insertDefaultUsers();
            }
        });
    });
}

// Insert default users for testing
function insertDefaultUsers() {
    const defaultPassword = 'password123';
    const hashedPassword = bcrypt.hashSync(defaultPassword, 10);
    
    const users = [
        { email: 'admin@example.com', password: hashedPassword, role: 'admin' },
        { email: 'organizer@example.com', password: hashedPassword, role: 'organizer' },
        { email: 'participant@example.com', password: hashedPassword, role: 'participant' }
    ];

    users.forEach(user => {
        db.run(
            `INSERT OR IGNORE INTO users (email, password, role) VALUES (?, ?, ?)`,
            [user.email, user.password, user.role],
            (err) => {
                if (err) {
                    console.error(`Error inserting user ${user.email}:`, err.message);
                }
            }
        );
    });
}

// Login endpoint
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ 
            success: false, 
            message: 'Email and password are required' 
        });
    }

    // Find user by email
    db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
        async (err, user) => {
            if (err) {
                return res.status(500).json({ 
                    success: false, 
                    message: 'Database error' 
                });
            }

            if (!user) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid email or password' 
                });
            }

            // Verify password
            const isValidPassword = await bcrypt.compare(password, user.password);
            
            if (!isValidPassword) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid email or password' 
                });
            }

            // Successful login - return user info (excluding password)
            res.json({
                success: true,
                message: 'Login successful',
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role
                }
            });
        }
    );
});

// Protected route example - Admin only
app.get('/api/admin', (req, res) => {
    // In a real app, you'd verify JWT token here
    res.json({ message: 'Admin access granted' });
});

// Protected route example - Organizer only
app.get('/api/organizer', (req, res) => {
    res.json({ message: 'Organizer access granted' });
});

// Protected route example - Participant only
app.get('/api/participant', (req, res) => {
    res.json({ message: 'Participant access granted' });
});

// Serve login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('Database connection closed');
        process.exit(0);
    });
});
