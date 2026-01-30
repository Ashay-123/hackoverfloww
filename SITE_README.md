# SITE_README

This document describes the Campus Resource and Event Management site.

## Deployed link

http://hackoverflow.duckdns.org:3001/

## Demo accounts

- Admin: admin@example.com / password123
- Organizer: organizer@example.com / password123
- Participant: participant@example.com / password123

## Purpose

A role-based campus platform for managing events, resources, clubs, and communication between organizers and participants, with an admin console for moderation and system oversight.

## Roles and access

- Admin
  - Full access to admin console
  - Approve/reject events and resource requests
  - Manage users (role changes, enable/disable, delete)
  - Chat moderation (bans, banned words)
  - System settings and audit logs

- Organizer
  - Create and manage events (draft, publish, close)
  - Notify registered participants
  - View event registrations
  - Manage clubs they lead
  - Book resources
  - Use event/club chat threads

- Participant
  - Browse and register for events
  - View registered events
  - Join clubs and view memberships
  - Book resources
  - Receive notifications
  - Use event/club chat threads

## Core user flows

### Authentication
- Login and registration live on the landing page (/)
- Registration supports organizer or participant roles by default
- Admin signup can be enabled or disabled by configuration
- Google OAuth login defaults new users to the participant role

### Events
- Organizer creates events with date, time, mode, capacity, and optional registration deadline
- Events can be published directly or routed to pending approval (if enabled)
- Participants can register for published events if not closed and before the deadline
- Capacity is enforced at registration time

### Event approvals (admin)
- Admin can approve or reject organizer submissions
- Admin can force close or delete events

### Resources
- Catalog of rooms, labs, and equipment
- Participants and organizers can request bookings
- Admin can approve or reject requests

### Clubs
- Participants can browse and join clubs
- Organizers who lead clubs see management-focused views

### Notifications
- System and event notifications appear in the Notifications section
- Notifications can be marked as read

### Chat
- Event and club chats appear as threads
- Replies, message edits (time-limited), deletions, and pinned messages are supported
- Voting supports upvote, downvote, and toggle/remove
- Admins can ban users and manage banned words

## Pages and routes

- / (login and registration)
- /student-home (participant)
- /organizer-home (organizer)
- /admin-home (admin)

## Backend API overview

- Auth: POST /register, POST /login, POST /logout
- Profile: GET /api/profile, PUT /api/profile
- Clubs: GET /api/clubs, POST /api/clubs/join, GET /api/profile/clubs
- Events: GET /api/events, GET /api/events/registered, POST /api/events/register
- Organizer events: GET /api/organizer/events, POST /api/events, PUT /api/events/:id, DELETE /api/events/:id
- Event actions: POST /api/events/:id/publish, POST /api/events/:id/close, GET /api/events/:id/registrations
- Resources: GET /api/resources, GET /api/resources/bookings, POST /api/resources/book
- Notifications: GET /api/notifications, PATCH /api/notifications/:id/read
- Chat: GET /api/chats, GET /api/chats/:threadId/messages, POST /api/chats/:threadId/messages,
  POST /api/chat/messages/:id/vote, DELETE /api/chat/messages/:id,
  POST /api/chat/threads/:threadId/pins
- Admin: /api/admin/* (users, events, resource approvals, chat moderation, settings, logs)
