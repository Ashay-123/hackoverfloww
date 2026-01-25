# Campus Resource & Event Management System

A full-stack web platform for managing campus resources, student clubs/committees, and events — with role-based access (Admin, Organizer, Participant) and a dedicated **Student Home** for participants.

## Features

- **Authentication**: Email/password, RBAC (admin, organizer, participant)
- **Student Home** (participant):
  - **Profile**: name, department, year, phone, bio, **visibility** (public / internal / private)
  - **Clubs & committees**: member of, heads/coordinates; explore and join
  - **Events**: explore approved events, register, view my registered
  - **Resources**: catalog (rooms, halls, labs, equipment), **my bookings**, request bookings (approval-based or auto)
  - **Notifications**: approvals, rejections, reminders, booking updates; mark as read
  - **Messages**: placeholder for 1:1 and group threads
  - **Settings**: profile visibility, account
- **Backend**: MySQL for users, profiles, clubs, events, resources, bookings, notifications, messages

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript (vanilla)
- **Backend**: Node.js, Express
- **Database**: MySQL (via `mysql2`)

## Setup

### 1. MySQL

- Install and start MySQL.
- Create DB and schema (from project root):

  ```bash
  mysql -u root -p < database.sql
  ```

  Or in MySQL:

  ```sql
  CREATE DATABASE IF NOT EXISTS campus_db;
  USE campus_db;
  -- then paste/run the rest of database.sql
  ```

### 2. Dependencies

  ```bash
  npm install
  ```

### 3. Configure DB (optional)

By default the app uses:

- Host: `localhost`
- User: `root`
- Password: `''`
- Database: `campus_db`

Override with env:

- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`

### 4. Run

  ```bash
  npm start
  ```

  Open: `http://localhost:3000`

### 5. Test accounts

If the `users` table is empty, the server seeds:

- **Admin**: `admin@example.com` / `password123`
- **Organizer**: `organizer@example.com` / `password123`
- **Participant**: `participant@example.com` / `password123`

**Participant** login redirects to **Student Home** (`/student-home`).

## Project structure

```
├── login.html         # Login / sign-up
├── script.js          # Login, redirect participants → student-home
├── style.css          # Login styles
├── student-home.html  # Student (participant) home
├── student-home.css   # Student home styles
├── student-home.js    # Student home logic & API calls
├── server.js          # Express + MySQL, auth & API
├── database.sql       # MySQL schema + seed (clubs, resources)
├── package.json
└── README.md
```

## API (overview)

- `POST /login`, `POST /register`
- `GET /api/profile`, `PUT /api/profile`
- `GET /api/profile/clubs`
- `GET /api/clubs`, `POST /api/clubs/join`
- `GET /api/events`, `GET /api/events/registered`, `POST /api/events/register`
- `GET /api/resources`, `GET /api/resources/bookings`, `POST /api/resources/book`
- `GET /api/notifications`, `PATCH /api/notifications/:id/read`
- `GET /api/messages/threads`

Requests that need the current user must send:

`x-user-id: <user_id>`

(The student home sets this from the logged-in user in `sessionStorage`.)

## License

ISC
