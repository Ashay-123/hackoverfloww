(function () {
  'use strict';

  const API = '';
  let user = null;

  function getUser() {
    if (user) return user;
    try {
      const s = sessionStorage.getItem('user');
      if (!s) return null;
      user = JSON.parse(s);
      return user;
    } catch (_) { return null; }
  }

  function redirectLogin() {
    sessionStorage.removeItem('user');
    window.location.href = '/';
  }

  function redirectByRole(u) {
    if (!u || !u.role) return redirectLogin();
    if (u.role === 'admin') return (window.location.href = '/admin-home');
    if (u.role === 'organizer') return (window.location.href = '/organizer-home');
    if (u.role === 'participant') return;
    return redirectLogin();
  }

  function headers() {
    return { 'Content-Type': 'application/json' };
  }

  function get(url) {
    return fetch(API + url, { credentials: 'include', headers: headers() }).then(r => {
      if (!r.ok && r.status === 401) {
        redirectLogin();
        throw new Error('Unauthorized');
      }
      return r.json();
    });
  }

  function post(url, body) {
    return fetch(API + url, { method: 'POST', credentials: 'include', headers: headers(), body: JSON.stringify(body) }).then(r => {
      if (!r.ok && r.status === 401) {
        redirectLogin();
        throw new Error('Unauthorized');
      }
      return r.json();
    });
  }

  function put(url, body) {
    return fetch(API + url, { method: 'PUT', credentials: 'include', headers: headers(), body: JSON.stringify(body) }).then(r => {
      if (!r.ok && r.status === 401) {
        redirectLogin();
        throw new Error('Unauthorized');
      }
      return r.json();
    });
  }

  function patch(url) {
    return fetch(API + url, { method: 'PATCH', credentials: 'include', headers: headers() }).then(r => {
      if (!r.ok && r.status === 401) {
        redirectLogin();
        throw new Error('Unauthorized');
      }
      return r.json();
    });
  }

  async function hydrateUser() {
    const cached = getUser();
    if (cached && cached.id) return cached;
    try {
      const r = await get('/api/profile');
      if (r && r.success && r.user) {
        user = r.user;
        sessionStorage.setItem('user', JSON.stringify(r.user));
        return r.user;
      }
    } catch (_) {}
    return null;
  }

  // ---------- DOM ----------
  function $(id) { return document.getElementById(id); }
  function qs(s) { return document.querySelector(s); }
  function qsa(s) { return document.querySelectorAll(s); }

  // ---------- Nav & sections ----------
  function setSection(id) {
    qsa('.section').forEach(el => el.classList.remove('active'));
    qsa('.nav-item').forEach(el => el.classList.remove('active'));
    const sec = $(id);
    const nav = document.querySelector('.nav-item[href="#' + id + '"]');
    if (sec) sec.classList.add('active');
    if (nav) nav.classList.add('active');
  }

  function onHash() {
    const h = (window.location.hash || '#dashboard').slice(1);
    setSection(h || 'dashboard');
    const sidebar = $('sidebar');
    if (sidebar && sidebar.classList.contains('open')) {
      sidebar.classList.remove('open');
      $('overlay').classList.remove('open');
    }
  }

  window.addEventListener('hashchange', onHash);
  window.addEventListener('load', onHash);

  // ---------- Sidebar & menu ----------
  $('menuBtn')?.addEventListener('click', function () {
    $('sidebar')?.classList.toggle('open');
    $('overlay')?.classList.toggle('open');
  });
  $('overlay')?.addEventListener('click', function () {
    $('sidebar')?.classList.remove('open');
    this.classList.remove('open');
  });

  $('userMenuBtn')?.addEventListener('click', function () {
    document.querySelector('.user-menu')?.classList.toggle('open');
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.user-menu')) document.querySelector('.user-menu')?.classList.remove('open');
  });

  async function logout() {
    try { await post('/logout', {}); } catch (_) {}
    redirectLogin();
  }
  $('logoutBtn')?.addEventListener('click', logout);
  $('logoutBtn2')?.addEventListener('click', logout);

  // ---------- Tabs ----------
  qsa('.tab').forEach(t => {
    t.addEventListener('click', function () {
      const key = this.dataset.tab;
      const panel = document.querySelector('.tab-panel[data-panel="' + key + '"]');
      const group = this.closest('.section');
      if (!group) return;
      group.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      group.querySelectorAll('.tab-panel').forEach(x => x.classList.remove('active'));
      this.classList.add('active');
      if (panel) panel.classList.add('active');
      if (key === 'explore') loadEvents();
      if (key === 'registered') loadRegistered();
      if (key === 'catalog') loadResources();
      if (key === 'mybookings') loadBookings();
      if (key === 'bookform') loadResourceOptions();
      if (key === 'myclubs') loadMyClubs();
      if (key === 'exploreclubs') loadClubsExplore();
    });
  });

  // ---------- Profile ----------
  function renderProfile(u, p) {
    const name = p?.full_name || u?.email?.split('@')[0] || 'Student';
    const dept = p?.department || '—';
    const year = p?.academic_year || '—';
    const initial = (name[0] || 'S').toUpperCase();

    $('userName').textContent = name;
    $('userAvatar').textContent = initial;
    $('ppAvatar').textContent = initial;
    $('ppName').textContent = name;
    $('ppDept').textContent = dept;
    $('ppYear').textContent = year;

    $('pFullName').value = p?.full_name || '';
    $('pDepartment').value = p?.department || '';
    $('pYear').value = p?.academic_year || '';
    $('pPhone').value = p?.phone || '';
    $('pBio').value = p?.bio || '';
    $('pVisibility').value = p?.profile_visibility || 'internal';
    $('settingsVisibility').value = p?.profile_visibility || 'internal';
    $('settingsEmail').textContent = u?.email || '—';
  }

  function loadProfile() {
    get('/api/profile').then(r => {
      if (!r.success) return;
      renderProfile(r.user, r.profile);
    }).catch(() => {});
  }

  $('profileForm')?.addEventListener('submit', function (e) {
    e.preventDefault();
    put('/api/profile', {
      full_name: $('pFullName').value.trim() || null,
      department: $('pDepartment').value.trim() || null,
      academic_year: $('pYear').value.trim() || null,
      phone: $('pPhone').value.trim() || null,
      bio: $('pBio').value.trim() || null,
      profile_visibility: $('pVisibility').value
    }).then(r => {
      if (r.success) { loadProfile(); loadProfileClubs(); alert('Profile saved.'); }
      else alert(r.message || 'Failed to save.');
    }).catch(() => alert('Request failed.'));
  });

  $('settingsVisibility')?.addEventListener('change', function () {
    put('/api/profile', { profile_visibility: this.value }).then(r => {
      if (r.success) { loadProfile(); $('pVisibility').value = this.value; }
    });
  });

  // ---------- Clubs (profile section) ----------
  function loadProfileClubs() {
    get('/api/profile/clubs').then(r => {
      if (!r.success) return;
      const memberOf = r.memberOf || [];
      const heads = r.headsOrCoords || [];
      $('profileMemberOf').innerHTML = memberOf.length
        ? memberOf.map(c => '<li>' + escapeHtml(c.name) + ' <span class="muted">(' + (c.type || 'club') + ')</span></li>').join('')
        : '<li class="empty">None</li>';
      $('profileHeads').innerHTML = heads.length
        ? heads.map(c => '<li>' + escapeHtml(c.name) + ' — ' + (c.membership_role === 'head' ? 'Head' : 'Coordinator') + '</li>').join('')
        : '<li class="empty">None</li>';
    });
  }

  // ---------- Dashboard: My clubs ----------
  function loadMyClubsDashboard() {
    get('/api/profile/clubs').then(r => {
      const list = $('myClubsList');
      if (!list) return;
      const all = (r.all || []);
      if (!all.length) { list.innerHTML = '<span class="empty">Not in any club yet. <a href="#clubs">Explore</a></span>'; return; }
      list.innerHTML = '<ul class="list">' + all.slice(0, 5).map(c =>
        '<li>' + escapeHtml(c.name) + ' <span class="muted">' + (c.membership_role !== 'member' ? '• ' + c.membership_role : '') + '</span></li>'
      ).join('') + '</ul>';
    });
  }

  // ---------- Events ----------
  function loadEvents() {
    const el = $('eventsList');
    if (!el) return;
    el.innerHTML = '<p class="muted">Loading events...</p>';
    
    get('/api/events').then(r => {
      const arr = r.events || [];
      if (!arr.length) {
        el.innerHTML = '<div class="card"><p class="muted" style="text-align:center; padding:2rem;">📅 No events available at the moment.<br>Check back soon for upcoming events!</p></div>';
        return;
      }
      
      el.innerHTML = arr.map(e => {
        const date = formatDate(e.event_date);
        const timeRange = e.start_time && e.end_time ? `${e.start_time.slice(0, 5)} - ${e.end_time.slice(0, 5)}` : '';
        const locationType = e.online_link ? '🌐 Online' : '📍 In-person';
        const locationText = e.online_link ? 'Online Event' : (e.location || 'TBD');
        const maxParts = e.max_participants === 0 ? 'Unlimited' : e.max_participants + ' spots';
        const status = e.status || 'published';
        const deadlineText = e.registration_deadline ? '<div><strong>Registration Deadline:</strong> ' + formatDateTime(e.registration_deadline) + '</div>' : '';
        const deadline = e.registration_deadline ? new Date(e.registration_deadline) : null;
        const deadlinePassed = deadline && deadline.getTime() < Date.now();
        const isClosed = status === 'closed';
        const regStatus = e.reg_status || null;
        const isRegistered = regStatus && regStatus !== 'cancelled';
        const canRegister = !isRegistered && !isClosed && !deadlinePassed;
        const registerLabel = isRegistered
          ? (regStatus === 'attended' ? 'Attended' : 'Registered')
          : isClosed ? 'Event closed' : deadlinePassed ? 'Registration closed' : 'Register Now';
        const registerButton = isRegistered
          ? `<button type="button" class="btn btn-success btn-register" disabled>✓ ${registerLabel}</button>`
          : canRegister
            ? `<button type="button" class="btn btn-primary btn-register" data-event-id="${e.id}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                ${registerLabel}
              </button>`
            : `<button type="button" class="btn btn-primary btn-register" disabled>${registerLabel}</button>`;
        
        return `<div class="event-card">
          <div class="event-header">
            <div>
              <h3>${escapeHtml(e.title)}</h3>
              ${e.club_name ? '<span class="event-club">' + escapeHtml(e.club_name) + '</span>' : ''}
            </div>
            <span class="event-badge ${status}">${status}</span>
          </div>
          <div class="event-body">
            <p class="event-description">${escapeHtml(e.description || '')}</p>
            <div class="event-details">
              <div class="event-detail">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <span><strong>Date:</strong> ${date}</span>
              </div>
              <div class="event-detail">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span><strong>Time:</strong> ${timeRange}</span>
              </div>
              <div class="event-detail">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span><strong>${locationType}:</strong> ${escapeHtml(locationText)}</span>
              </div>
              <div class="event-detail">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span><strong>Capacity:</strong> ${maxParts}</span>
              </div>
              ${deadlineText}
            </div>
          </div>
          <div class="event-footer">
            ${registerButton}
            ${e.online_link ? '<a href="' + escapeHtml(e.online_link) + '" target="_blank" class="btn btn-ghost">View Link</a>' : ''}
          </div>
        </div>`;
      }).join('');
      
      el.querySelectorAll('[data-event-id]').forEach(btn => {
        btn.addEventListener('click', function () { registerEvent(parseInt(this.dataset.eventId, 10)); });
      });
    }).catch(() => { 
      el.innerHTML = '<div class="card"><p class="muted" style="text-align:center; padding:2rem;">❌ Could not load events.<br>Please refresh the page.</p></div>'; 
    });
  }

  function loadRegistered() {
    const el = $('registeredList');
    if (!el) return;
    el.innerHTML = '<p class="muted">Loading your registrations...</p>';
    
    get('/api/events/registered').then(r => {
      const arr = r.events || [];
      if (!arr.length) {
        el.innerHTML = '<div class="card"><p class="muted" style="text-align:center; padding:2rem;">📋 You haven\'t registered for any events yet.<br><a href="#events">Explore events</a> to get started!</p></div>';
        return;
      }
      
      el.innerHTML = arr.map(e => {
        const date = formatDate(e.event_date);
        const timeRange = e.start_time && e.end_time ? `${e.start_time.slice(0, 5)} - ${e.end_time.slice(0, 5)}` : '';
        const locationType = e.online_link ? '🌐 Online' : '📍';
        const locationText = e.location || 'Online Event';
        const regStatus = e.reg_status || 'registered';
        const statusColors = { registered: 'success', cancelled: 'danger', attended: 'info' };
        
        return `<div class="registered-event-card">
          <div class="event-status-indicator ${statusColors[regStatus] || 'success'}"></div>
          <div class="event-content">
            <div class="event-main">
              <h4>${escapeHtml(e.title)}</h4>
              ${e.club_name ? '<span class="event-club-small">' + escapeHtml(e.club_name) + '</span>' : ''}
              <div class="event-info">
                <span>📅 ${date}</span>
                <span>🕒 ${timeRange}</span>
                <span>${locationType} ${escapeHtml(locationText)}</span>
              </div>
            </div>
            <span class="status ${regStatus}">${regStatus}</span>
          </div>
        </div>`;
      }).join('');
    }).catch(() => { 
      el.innerHTML = '<div class="card"><p class="muted" style="text-align:center; padding:2rem;">❌ Could not load your registrations.<br>Please refresh the page.</p></div>'; 
    });
  }

  function registerEvent(id) {
    const btn = document.querySelector(`[data-event-id="${id}"]`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg> Registering...';
      btn.style.opacity = '0.6';
    }
    
    post('/api/events/register', { eventId: id }).then(r => {
      if (r.success) { 
        if (btn) {
          btn.innerHTML = '✓ Registered!';
          btn.classList.remove('btn-primary');
          btn.classList.add('btn-success');
        }
        setTimeout(() => {
          loadEvents();
          loadRegistered();
          loadUpcoming();
          showNotification('Successfully registered for the event!', 'success');
        }, 1000);
      } else {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> Register Now';
          btn.style.opacity = '1';
        }
        showNotification(r.message || 'Failed to register', 'error');
      }
    }).catch(() => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> Register Now';
        btn.style.opacity = '1';
      }
      showNotification('Request failed. Please try again.', 'error');
    });
  }
  
  function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `toast-notification ${type}`;
    notification.innerHTML = `
      <div class="toast-content">
        ${type === 'success' ? '✓' : '❌'} ${message}
      </div>
    `;
    document.body.appendChild(notification);
    
    setTimeout(() => notification.classList.add('show'), 10);
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  function loadUpcoming() {
    const el = $('upcomingEvents');
    if (!el) return;
    get('/api/events').then(r => {
      const arr = (r.events || []).slice(0, 4);
      el.innerHTML = arr.length ? '<ul class="list">' + arr.map(e =>
        '<li>' + escapeHtml(e.title) + ' <span class="muted">' + formatDate(e.event_date) + '</span></li>'
      ).join('') + '</ul>' : '<span class="empty">No upcoming events.</span>';
    });
  }

  // ---------- Resources ----------
  function loadResources() {
    const el = $('resourcesList');
    if (!el) return;
    get('/api/resources').then(r => {
      const arr = r.resources || [];
      el.innerHTML = arr.length ? arr.map(res =>
        '<div class="item-row"><div><h4>' + escapeHtml(res.name) + '</h4><p class="meta">' + (res.category || '') + (res.description ? ' • ' + escapeHtml(res.description) : '') + (res.requires_approval ? ' • Approval required' : '') + '</p></div></div>'
      ).join('') : '<p class="muted">No resources.</p>';
    });
  }

  function loadBookings() {
    const el = $('bookingsList');
    if (!el) return;
    get('/api/resources/bookings').then(r => {
      const arr = r.bookings || [];
      el.innerHTML = arr.length ? arr.map(b => {
        const start = formatDateTime(b.start_datetime);
        return '<div class="item-row"><div><h4>' + escapeHtml(b.resource_name) + '</h4><p class="meta">' + start + ' <span class="status ' + (b.status || 'pending') + '">' + (b.status || 'pending') + '</span></p></div></div>';
      }).join('') : '<p class="muted">No bookings.</p>';
    });
  }

  function loadResourceOptions() {
    const sel = $('bookResource');
    if (!sel) return;
    get('/api/resources').then(r => {
      const arr = r.resources || [];
      sel.innerHTML = '<option value="">Select resource</option>' + arr.map(res =>
        '<option value="' + res.id + '">' + escapeHtml(res.name) + ' (' + (res.category || '') + ')</option>'
      ).join('');
    });
  }

  $('bookForm')?.addEventListener('submit', function (e) {
    e.preventDefault();
    const resourceId = parseInt($('bookResource').value, 10);
    const start = $('bookStart').value;
    const end = $('bookEnd').value;
    if (!resourceId || !start || !end) { alert('Fill resource, start and end.'); return; }
    post('/api/resources/book', { resourceId, start_datetime: start, end_datetime: end, purpose: $('bookPurpose').value }).then(r => {
      if (r.success) { alert(r.message || 'Booking requested.'); loadBookings(); loadMyBookingsDashboard(); this.reset(); }
      else alert(r.message || 'Failed.');
    }).catch(() => alert('Request failed.'));
  });

  function loadMyBookingsDashboard() {
    const el = $('myBookings');
    if (!el) return;
    get('/api/resources/bookings').then(r => {
      const arr = (r.bookings || []).slice(0, 4);
      el.innerHTML = arr.length ? '<ul class="list">' + arr.map(b =>
        '<li>' + escapeHtml(b.resource_name) + ' <span class="muted">' + formatDateTime(b.start_datetime) + ' · ' + (b.status || 'pending') + '</span></li>'
      ).join('') + '</ul>' : '<span class="empty">No bookings.</span>';
    });
  }

  // ---------- Clubs (section) ----------
  function loadMyClubs() {
    const el = $('clubsMyList');
    if (!el) return;
    get('/api/profile/clubs').then(r => {
      const all = r.all || [];
      el.innerHTML = all.length ? all.map(c =>
        '<div class="item-row"><div><h4>' + escapeHtml(c.name) + '</h4><p class="meta">' + (c.type || 'club') + ' • ' + (c.membership_role || 'member') + '</p></div></div>'
      ).join('') : '<p class="muted">Not in any club. Explore and join below.</p>';
    });
  }

  function loadClubsExplore() {
    const el = $('clubsExploreList');
    if (!el) return;
    get('/api/clubs').then(r => {
      const arr = r.clubs || [];
      get('/api/profile/clubs').then(r2 => {
        const myIds = (r2.all || []).map(c => c.id);
        el.innerHTML = arr.map(c => {
          const joined = myIds.includes(c.id);
          const btn = joined ? '<span class="muted">Joined</span>' : '<button type="button" class="btn btn-ghost" style="margin:0" data-club-id="' + c.id + '">Join</button>';
          return '<div class="item-row"><div><h4>' + escapeHtml(c.name) + '</h4><p class="meta">' + (c.type || 'club') + ' — ' + escapeHtml(c.description || '') + '</p></div>' + btn + '</div>';
        }).join('');
        el.querySelectorAll('[data-club-id]').forEach(btn => {
          btn.addEventListener('click', function () {
            post('/api/clubs/join', { clubId: parseInt(this.dataset.clubId, 10) }).then(res => {
              if (res.success) { loadClubsExplore(); loadMyClubs(); loadMyClubsDashboard(); loadProfileClubs(); alert('Joined.'); }
              else alert(res.message || 'Failed.');
            });
          });
        });
      });
    });
  }

  // ---------- Notifications ----------
  function loadNotifications() {
    const el = $('notificationsList');
    if (el) {
      get('/api/notifications').then(r => {
        const arr = r.notifications || [];
        el.innerHTML = arr.length ? arr.map(n => {
          const cls = n.is_read ? '' : ' style="background:rgba(124,156,255,0.08)"';
          return '<div class="item-row" data-id="' + n.id + '"' + cls + '><div><h4>' + escapeHtml(n.title) + '</h4><p class="meta">' + escapeHtml(n.message || '') + ' · ' + formatDateTime(n.created_at) + '</p></div>' + (n.is_read ? '' : '<button type="button" class="btn btn-ghost" style="margin:0" data-read="' + n.id + '">Mark read</button>') + '</div>';
        }).join('') : '<p class="muted">No notifications.</p>';
        el.querySelectorAll('[data-read]').forEach(btn => {
          btn.addEventListener('click', function () {
            patch('/api/notifications/' + this.dataset.read + '/read').then(() => { loadNotifications(); updateNotifBadge(); });
          });
        });
      });
    }
  }

  function loadRecentNotifs() {
    const el = $('recentNotifs');
    if (!el) return;
    get('/api/notifications').then(r => {
      const arr = (r.notifications || []).slice(0, 4);
      el.innerHTML = arr.length ? '<ul class="list">' + arr.map(n =>
        '<li>' + escapeHtml(n.title) + ' <span class="muted">' + formatDateTime(n.created_at) + '</span></li>'
      ).join('') + '</ul>' : '<span class="empty">No notifications.</span>';
    });
  }

  function updateNotifBadge() {
    get('/api/notifications').then(r => {
      const n = (r.notifications || []).filter(x => !x.is_read).length;
      const b = $('notifBadge');
      if (b) { b.textContent = n; b.style.display = n ? 'flex' : 'none'; }
    });
  }

  // ---------- Messages (threads) ----------
  function loadMessageThreads() {
    const el = $('messageThreads');
    if (!el) return;
    get('/api/messages/threads').then(r => {
      const arr = r.threads || [];
      el.innerHTML = arr.length ? '<ul class="list">' + arr.map(t =>
        '<li>Thread #' + t.id + ' (' + (t.type || 'direct') + ')</li>'
      ).join('') + '</ul>' : 'No threads yet.';
    }).catch(() => { el.innerHTML = 'Could not load.'; });
  }

  // ---------- Helpers ----------
  function escapeHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function formatDate(s) {
    if (!s) return '—';
    try { return new Date(s + 'T00:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' }); } catch (_) { return s; }
  }

  function formatDateTime(s) {
    if (!s) return '—';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return s;
      return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) { return s; }
  }

  // ---------- Init ----------
  async function init() {
    const u = await hydrateUser();
    if (!u || !u.id) { redirectLogin(); return; }
    if (u.role !== 'participant') { redirectByRole(u); return; }
    loadProfile();
    loadProfileClubs();
    loadMyClubsDashboard();
    loadUpcoming();
    loadMyBookingsDashboard();
    loadRecentNotifs();
    loadNotifications();
    updateNotifBadge();
    loadMessageThreads();
    loadEvents();
    loadRegistered();
    loadResources();
    loadBookings();
    loadResourceOptions();
    loadMyClubs();
    loadClubsExplore();
  }

  init();
})();
