# RBAC Login System

A complete Role-Based Access Control (RBAC) login system with email/password authentication, supporting three user roles: Admin, Organizer, and Participant.

## Features

- ✅ Email/password authentication
- ✅ Role-Based Access Control (RBAC) with three roles:
  - **Admin**: Full system access
  - **Organizer**: Event management access
  - **Participant**: Basic participant access
- ✅ Secure password hashing with bcrypt
- ✅ SQLite database for user storage
- ✅ Modern, responsive UI
- ✅ Role-specific dashboards

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js with Express
- **Database**: SQLite3
- **Security**: bcrypt for password hashing

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```
   
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

3. **Open your browser:**
   Navigate to `http://localhost:3000`

## Database Setup

The database is automatically created when you first run the server. The SQLite database file (`database.db`) will be created in the project root.

### Default Test Accounts

The system comes with three pre-configured test accounts (password: `password123`):

- **Admin**: `admin@example.com`
- **Organizer**: `organizer@example.com`
- **Participant**: `participant@example.com`

## Database Schema

The `database.sql` file contains the SQL schema that can be used with MySQL, PostgreSQL, or SQLite. The server uses SQLite by default.

### Users Table Structure

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'organizer', 'participant')) DEFAULT 'participant',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

### POST `/login`
Authenticate a user with email and password.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "role": "admin"
  }
}
```

**Error Response (401):**
```json
{
  "success": false,
  "message": "Invalid email or password"
}
```

## Project Structure

```
hackoverflow/
├── login.html          # Login page HTML
├── style.css           # Styling
├── script.js           # Frontend JavaScript
├── server.js           # Node.js backend server
├── database.sql        # SQL schema (for reference)
├── package.json        # Node.js dependencies
└── README.md          # This file
```

## Security Features

- Passwords are hashed using bcrypt (10 rounds)
- SQL injection protection via parameterized queries
- CORS enabled for cross-origin requests
- Input validation on both client and server side

## Customization

### Adding New Roles

1. Update the database schema to include the new role
2. Modify the `CHECK` constraint in the users table
3. Add role-specific content in `script.js` → `getRoleContent()` function
4. Update CSS for new role badge styles

### Using Different Database

To use MySQL or PostgreSQL instead of SQLite:

1. Install the appropriate database driver (`mysql2` or `pg`)
2. Update `server.js` to use the new database connection
3. Use the appropriate SQL syntax from `database.sql`

## Development

The project uses:
- **Express** for the web server
- **bcrypt** for password hashing
- **sqlite3** for database operations
- **cors** for handling cross-origin requests

## License

ISC
