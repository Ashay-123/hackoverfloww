# Google OAuth + Local Account Conflict Prevention

## Problem
If a user signs up manually using email + password, and later tries to log in via Google OAuth with the same email, the system should reject the OAuth login and force them to use their email+password credentials.

## Solution Overview
The implementation distinguishes authentication methods using the `oauth_provider` column in the `users` table:
- **Local signup** → `oauth_provider = 'local'`
- **Google OAuth signup** → `oauth_provider = 'google'`

## Backend Changes

### 1. **Modified `/register` endpoint** (Line 336)
**File:** `server.js`

```javascript
// BEFORE
const [r] = await pool.query('INSERT INTO users (email, password, role) VALUES (?, ?, ?)', [email, hashed, userRole]);

// AFTER
const [r] = await pool.query('INSERT INTO users (email, password, role, oauth_provider) VALUES (?, ?, ?, ?)', [email, hashed, userRole, 'local']);
```

**Why:** Mark all manual signups with `oauth_provider = 'local'` for later validation.

---

### 2. **Modified `findOrLinkOAuthUser()` function** (Lines 249-275)
**File:** `server.js`

Added blocking logic before linking/creating accounts:

```javascript
// BLOCK: User signed up manually with email+password, prevent OAuth login
if (existing.oauth_provider === 'local') {
  throw new Error('Account already exists. Please log in using email and password.');
}
```

**Why:** When a user with same email exists and has `oauth_provider = 'local'`, throw an error with a user-friendly message.

---

### 3. **Modified `/auth/google/callback` route** (Lines 363-381)
**File:** `server.js`

```javascript
// NEW: Check if this is the "local account exists" error
if (info?.message === 'Account already exists. Please log in using email and password.') {
  return res.redirect('/login?error=account_exists');
}
```

**Why:** Route the specific error to `/login?error=account_exists` instead of generic OAuth failure page.

---

## Frontend Changes

### **Modified `script.js` DOMContentLoaded handler** (Lines 210-244)
**File:** `public/script.js`

```javascript
// NEW: Handle account_exists error (local account blocking OAuth)
if (errorCode === "account_exists") {
  if (messageDiv) {
    messageDiv.className = "message error";
    messageDiv.textContent = "Account already exists. Please log in using email and password.";
    messageDiv.style.display = "block";
  }
  // Clean up URL
  window.history.replaceState({}, document.title, "/login");
}
```

**Why:** Read the `?error=account_exists` URL parameter and display the error message to the user.

---

## User Experience Flow

### Scenario: User tries OAuth with existing local account

1. User signs up manually: `john@example.com` + password123
   - ✅ Account created with `oauth_provider = 'local'`

2. Later, user clicks "Continue with Google" using `john@example.com`
   - 🔍 OAuth callback finds matching email
   - ✅ Detects `oauth_provider = 'local'`
   - ❌ Throws error: "Account already exists. Please log in using email and password."
   - 🔄 Redirects to `/login?error=account_exists`
   - ✅ Frontend displays error message in red on login page

3. User now must log in via email + password
   - ✅ Login succeeds
   - ✅ No account merging or data loss

---

## Preserved Behavior

✅ **Google-only users** continue to work normally
- If user signs up via Google first (no local password)
- Later OAuth logins work fine
- `oauth_provider = 'google'` remains unchanged

✅ **Password hashes** never modified
- No auto-linking happens
- No account merging

✅ **New Google signups** still allowed
- Users who've never signed up locally can use Google OAuth

---

## Database Schema Requirement

Your `users` table already has:
```sql
oauth_provider VARCHAR(50) NULL
oauth_id VARCHAR(255) NULL
```

No migrations needed! The existing schema supports this.

---

## Testing Checklist

- [ ] User signs up manually with email+password → `oauth_provider = 'local'`
- [ ] Same user tries Google OAuth → Blocked with error message
- [ ] Error message displays on login page
- [ ] User can still log in with email+password
- [ ] New user can still sign up via Google OAuth
- [ ] Existing Google-only users unaffected

---

## Error Message

**Default:** "Account already exists. Please log in using email and password."

Customize in:
- **Backend:** `server.js` line 258
- **Frontend:** `public/script.js` line 224
