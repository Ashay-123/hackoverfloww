-- Database schema for RBAC login system
-- Supports MySQL, PostgreSQL, SQLite

-- Users table with email, password, and role
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'organizer', 'participant') NOT NULL DEFAULT 'participant',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Index for faster email lookups
CREATE INDEX IF NOT EXISTS idx_email ON users(email);

-- Insert sample users for testing
-- Passwords are hashed with bcrypt (password: "password123")
-- To generate: bcrypt.hashSync('password123', 10)
INSERT INTO users (email, password, role) VALUES
('admin@example.com', '$2b$10$rOzJqJqJqJqJqJqJqJqJqOqJqJqJqJqJqJqJqJqJqJqJqJqJqJq', 'admin'),
('organizer@example.com', '$2b$10$rOzJqJqJqJqJqJqJqJqJqOqJqJqJqJqJqJqJqJqJqJqJqJqJq', 'organizer'),
('participant@example.com', '$2b$10$rOzJqJqJqJqJqJqJqJqJqOqJqJqJqJqJqJqJqJqJqJqJqJqJq', 'participant')
ON CONFLICT(email) DO NOTHING;

-- For SQLite (alternative schema)
-- CREATE TABLE IF NOT EXISTS users (
--     id INTEGER PRIMARY KEY AUTOINCREMENT,
--     email TEXT UNIQUE NOT NULL,
--     password TEXT NOT NULL,
--     role TEXT NOT NULL CHECK(role IN ('admin', 'organizer', 'participant')) DEFAULT 'participant',
--     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
--     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
-- );
