-- Unified Campus Resource & Event Management System
-- MySQL Schema
-- Run: mysql -u root -p < database.sql
-- Or: create DB first: CREATE DATABASE IF NOT EXISTS campus_db; USE campus_db; then run the rest.

CREATE DATABASE IF NOT EXISTS campus_db;
USE campus_db;

-- ==================== AUTH & USERS ====================
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'organizer', 'participant') NOT NULL DEFAULT 'participant',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);

-- ==================== USER PROFILES ====================
CREATE TABLE IF NOT EXISTS user_profiles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL UNIQUE,
    full_name VARCHAR(255),
    department VARCHAR(255),
    academic_year VARCHAR(50),
    phone VARCHAR(20),
    avatar_url VARCHAR(500),
    profile_visibility ENUM('public', 'internal', 'private') DEFAULT 'internal',
    bio TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_profiles_user ON user_profiles(user_id);

-- ==================== CLUBS / COMMITTEES ====================
CREATE TABLE IF NOT EXISTS clubs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    type ENUM('club', 'committee', 'community') DEFAULT 'club',
    logo_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ==================== CLUB MEMBERSHIPS ====================
CREATE TABLE IF NOT EXISTS club_members (
    id INT PRIMARY KEY AUTO_INCREMENT,
    club_id INT NOT NULL,
    user_id INT NOT NULL,
    role ENUM('member', 'coordinator', 'head') DEFAULT 'member',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_membership (club_id, user_id),
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_club_members_club ON club_members(club_id);
CREATE INDEX idx_club_members_user ON club_members(user_id);

-- ==================== EVENTS ====================
-- Drop existing events table if it exists (migration)
DROP TABLE IF EXISTS event_clubs;
DROP TABLE IF EXISTS event_registrations;
DROP TABLE IF EXISTS events;

CREATE TABLE IF NOT EXISTS events (
    id INT PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    event_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    location VARCHAR(255) NULL,
    online_link VARCHAR(255) NULL,
    max_participants INT DEFAULT 0 NOT NULL,
    registration_deadline DATETIME NULL,
    status ENUM('draft', 'published', 'closed') DEFAULT 'draft' NOT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_end_after_start CHECK (end_time > start_time),
    CONSTRAINT chk_max_participants CHECK (max_participants >= 0)
);

CREATE INDEX idx_events_organizer_date ON events(created_by, event_date);
CREATE INDEX idx_events_status ON events(status);

-- Joint events: multiple clubs per event
CREATE TABLE IF NOT EXISTS event_clubs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id INT NOT NULL,
    club_id INT NOT NULL,
    role VARCHAR(100),
    UNIQUE KEY unique_event_club (event_id, club_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- ==================== EVENT REGISTRATIONS ====================
CREATE TABLE IF NOT EXISTS event_registrations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    status ENUM('registered', 'cancelled', 'attended') DEFAULT 'registered',
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_registration (event_id, user_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_registrations_user ON event_registrations(user_id);
CREATE INDEX idx_registrations_event ON event_registrations(event_id);

-- ==================== RESOURCES (Rooms, Equipment) ====================
CREATE TABLE IF NOT EXISTS resource_types (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    category ENUM('room', 'hall', 'lab', 'equipment') NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    type_id INT,
    category ENUM('room', 'hall', 'lab', 'equipment') NOT NULL,
    description TEXT,
    requires_approval TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (type_id) REFERENCES resource_types(id) ON DELETE SET NULL
);

CREATE INDEX idx_resources_category ON resources(category);

-- ==================== RESOURCE BOOKINGS ====================
CREATE TABLE IF NOT EXISTS resource_bookings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    resource_id INT NOT NULL,
    user_id INT NOT NULL,
    start_datetime DATETIME NOT NULL,
    end_datetime DATETIME NOT NULL,
    status ENUM('pending', 'approved', 'rejected', 'cancelled', 'completed') DEFAULT 'pending',
    purpose TEXT,
    approved_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_bookings_resource ON resource_bookings(resource_id);
CREATE INDEX idx_bookings_user ON resource_bookings(user_id);
CREATE INDEX idx_bookings_datetime ON resource_bookings(start_datetime, end_datetime);

-- ==================== NOTIFICATIONS ====================
CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    type ENUM('event_approval', 'event_rejection', 'upcoming_event', 'booking_approved', 'booking_rejected', 'booking_reminder', 'general') DEFAULT 'general',
    ref_type ENUM('event', 'booking', 'club', 'message', 'none') DEFAULT 'none',
    ref_id INT,
    is_read TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(user_id, is_read);

-- ==================== MESSAGES (1:1 and context) ====================
CREATE TABLE IF NOT EXISTS message_threads (
    id INT PRIMARY KEY AUTO_INCREMENT,
    type ENUM('direct', 'club', 'event') DEFAULT 'direct',
    ref_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_participants (
    id INT PRIMARY KEY AUTO_INCREMENT,
    thread_id INT NOT NULL,
    user_id INT NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_participant (thread_id, user_id),
    FOREIGN KEY (thread_id) REFERENCES message_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    thread_id INT NOT NULL,
    sender_id INT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (thread_id) REFERENCES message_threads(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_thread ON messages(thread_id);

-- ==================== SEED DATA ====================
-- Default users: run app once to bcrypt-hash; or use: node -e "require('bcrypt').hash('password123',10).then(h=>console.log(h))"
-- Then: INSERT INTO users (email, password, role) VALUES ('admin@example.com', '<hash>', 'admin'), ...
-- Or register via the app.

INSERT INTO resource_types (name, category) VALUES
('Seminar Hall', 'hall'), ('Meeting Room', 'room'), ('Computer Lab', 'lab'),
('Projector', 'equipment'), ('Sound System', 'equipment'), ('Camera', 'equipment');

INSERT INTO resources (name, type_id, category, description, requires_approval) VALUES
('Main Auditorium', 1, 'hall', 'Capacity 500', 1),
('Room 101', 2, 'room', 'Seats 20', 0),
('Lab A', 3, 'lab', '40 PCs', 1),
('Projector 1', 4, 'equipment', 'HD Projector', 0),
('PA System', 5, 'equipment', 'Portable', 0);

INSERT INTO clubs (name, slug, description, type) VALUES
('Tech Club', 'tech-club', 'Technology and coding enthusiasts', 'club'),
('Cultural Committee', 'cultural-committee', 'Events and cultural activities', 'committee'),
('Sports Club', 'sports-club', 'Sports and fitness', 'club');

-- Sample event for organizer (1 week from now)
-- Note: This will only work if organizer user exists
INSERT INTO events (title, description, event_date, start_time, end_time, location, max_participants, status, created_by)
SELECT 
    'Tech Talk 2024',
    'Monthly tech meetup and coding discussion. Join us for an evening of learning and networking.',
    DATE_ADD(CURDATE(), INTERVAL 7 DAY),
    '18:00:00',
    '20:00:00',
    'Main Hall',
    50,
    'published',
    id
FROM users WHERE role = 'organizer' LIMIT 1;
