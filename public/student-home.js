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

  function del(url) {
    return fetch(API + url, { method: 'DELETE', credentials: 'include', headers: headers() }).then(r => {
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

  // Auto-refresh notifications every 30 seconds
  setInterval(() => {
    if (window.location.hash === '#notifications') {
      loadNotifications();
    }
    updateNotifBadge();
    loadRecentNotifs();
  }, 30000);

  // ---------- Chat ----------
  const chatState = {
    threads: [],
    activeThreadId: null,
    permissions: {},
    messages: [],
    pinned: [],
    replyTo: null,
    filter: 'all',
    search: '',
    ban: null,
    searchMode: false,
    threadMeta: null,
    messageSignatures: null,
    pinnedSignature: ''
  };

  function roleLabel(role) {
    if (role === 'admin') return 'Admin';
    if (role === 'organizer') return 'Organizer';
    return 'Student';
  }

  function showChatComposer(show) {
    const form = $('chatForm');
    if (form) form.style.display = show ? 'flex' : 'none';
  }

  function setChatEmptyState(message, metaText) {
    const title = $('chatTitle');
    const meta = $('chatMeta');
    const list = $('chatMessages');
    if (title) title.textContent = 'Messages';
    if (meta) meta.textContent = metaText || '';
    if (list) list.innerHTML = `<p class="muted">${message}</p>`;
    const pins = $('chatPins');
    if (pins) pins.innerHTML = '';
    const notice = $('chatBanNotice');
    if (notice) notice.style.display = 'none';
    const actions = $('chatPanelActions');
    if (actions) actions.innerHTML = '';
    const searchRow = document.querySelector('.chat-search-row');
    if (searchRow) searchRow.style.display = 'none';
    chatState.messageSignatures = null;
    chatState.pinnedSignature = '';
    showChatComposer(false);
  }

  function formatMessageBody(text) {
    return escapeHtml(text || '').replace(/\n/g, '<br>');
  }

  function buildMessageTree(messages) {
    const map = new Map();
    const roots = [];
    messages.forEach(msg => {
      map.set(msg.id, { ...msg, replies: [] });
    });
    messages.forEach(msg => {
      const node = map.get(msg.id);
      if (msg.parent_id && map.has(msg.parent_id)) {
        map.get(msg.parent_id).replies.push(node);
      } else {
        roots.push(node);
      }
    });
    return roots;
  }

  function renderMessageNode(msg) {
    const role = msg.sender_role || 'participant';
    const roleClass = role === 'admin' ? 'admin' : role === 'organizer' ? 'organizer' : 'participant';
    const highlight = role === 'admin' ? 'chat-message--admin' : role === 'organizer' ? 'chat-message--organizer' : '';
    const deletedClass = msg.is_deleted ? 'chat-message--deleted' : '';
    const badges = [];
    if (msg.is_pinned) badges.push('<span class="role-badge pin">Pinned</span>');
    if (msg.is_announcement) badges.push('<span class="role-badge announce">Announcement</span>');
    const edited = msg.edited_at ? ' • edited' : '';
    const canPost = chatState.permissions.canPost && !chatState.ban;
    const canPin = chatState.permissions.canPin;
    const voteUpActive = msg.user_vote === 1 ? 'active' : '';
    const voteDownActive = msg.user_vote === -1 ? 'active' : '';
    const actions = [];

    actions.push(`<button type="button" class="vote-btn ${voteUpActive}" data-vote="up" data-message-id="${msg.id}">▲ ${msg.upvotes || 0}</button>`);
    actions.push(`<button type="button" class="vote-btn ${voteDownActive}" data-vote="down" data-message-id="${msg.id}">▼ ${msg.downvotes || 0}</button>`);

    if (canPost && !msg.is_deleted) {
      actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-reply="${msg.id}">Reply</button>`);
    }
    if (msg.can_edit) {
      actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-edit="${msg.id}">Edit</button>`);
    }
    if (msg.can_delete) {
      actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-delete="${msg.id}">Delete</button>`);
    }
    if (canPin && !msg.is_deleted) {
      actions.push(msg.is_pinned
        ? `<button type="button" class="btn btn-ghost btn-sm" data-unpin="${msg.id}">Unpin</button>`
        : `<button type="button" class="btn btn-ghost btn-sm" data-pin="${msg.id}">Pin</button>`);
    }

    const replies = msg.replies || [];
    const toggle = replies.length
      ? `<button type="button" class="chat-toggle" data-toggle-replies="${msg.id}">Collapse ${replies.length} repl${replies.length > 1 ? 'ies' : 'y'}</button>`
      : '';
    const repliesHtml = replies.length
      ? `<div class="chat-replies" data-replies-for="${msg.id}">${replies.map(renderMessageNode).join('')}</div>`
      : '';

    return `<div class="chat-message ${highlight} ${deletedClass}" data-message="${msg.id}">
      <div class="chat-header-line">
        <span class="chat-name">${escapeHtml(msg.sender_name || 'User')}</span>
        <span class="role-badge ${roleClass}">${roleLabel(role)}</span>
        ${badges.join('')}
        <span class="chat-meta">${formatDateTime(msg.created_at)}${edited}</span>
      </div>
      <div class="chat-body">${formatMessageBody(msg.display_body || '')}</div>
      ${toggle}
      <div class="chat-actions">${actions.join('')}</div>
      ${repliesHtml}
    </div>`;
  }

  function buildMessageSignature(msg) {
    return [
      msg.id,
      msg.parent_id || 0,
      msg.display_body || '',
      msg.is_deleted ? 1 : 0,
      msg.is_announcement ? 1 : 0,
      msg.is_pinned ? 1 : 0,
      msg.upvotes || 0,
      msg.downvotes || 0,
      msg.user_vote || 0,
      msg.edited_at || '',
      msg.deleted_at || '',
      msg.sender_role || '',
      msg.sender_name || ''
    ].join('|');
  }

  function computeReplyCounts(messages) {
    const counts = {};
    messages.forEach(msg => {
      if (msg.parent_id) {
        counts[msg.parent_id] = (counts[msg.parent_id] || 0) + 1;
      }
    });
    return counts;
  }

  function buildMessageHeaderHtml(msg) {
    const role = msg.sender_role || 'participant';
    const roleClass = role === 'admin' ? 'admin' : role === 'organizer' ? 'organizer' : 'participant';
    const badges = [];
    if (msg.is_pinned) badges.push('<span class="role-badge pin">Pinned</span>');
    if (msg.is_announcement) badges.push('<span class="role-badge announce">Announcement</span>');
    const edited = msg.edited_at ? ' • edited' : '';
    return `
      <span class="chat-name">${escapeHtml(msg.sender_name || 'User')}</span>
      <span class="role-badge ${roleClass}">${roleLabel(role)}</span>
      ${badges.join('')}
      <span class="chat-meta">${formatDateTime(msg.created_at)}${edited}</span>
    `;
  }

  function buildMessageActionsHtml(msg) {
    const canPost = chatState.permissions.canPost && !chatState.ban;
    const canPin = chatState.permissions.canPin;
    const voteUpActive = msg.user_vote === 1 ? 'active' : '';
    const voteDownActive = msg.user_vote === -1 ? 'active' : '';
    const actions = [];

    actions.push(`<button type="button" class="vote-btn ${voteUpActive}" data-vote="up" data-message-id="${msg.id}">▲ ${msg.upvotes || 0}</button>`);
    actions.push(`<button type="button" class="vote-btn ${voteDownActive}" data-vote="down" data-message-id="${msg.id}">▼ ${msg.downvotes || 0}</button>`);

    if (canPost && !msg.is_deleted) {
      actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-reply="${msg.id}">Reply</button>`);
    }
    if (msg.can_edit) {
      actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-edit="${msg.id}">Edit</button>`);
    }
    if (msg.can_delete) {
      actions.push(`<button type="button" class="btn btn-ghost btn-sm" data-delete="${msg.id}">Delete</button>`);
    }
    if (canPin && !msg.is_deleted) {
      actions.push(msg.is_pinned
        ? `<button type="button" class="btn btn-ghost btn-sm" data-unpin="${msg.id}">Unpin</button>`
        : `<button type="button" class="btn btn-ghost btn-sm" data-pin="${msg.id}">Pin</button>`);
    }
    return actions.join('');
  }

  function updateReplyToggle(messageEl, replyCount) {
    if (!messageEl) return;
    const repliesEl = messageEl.querySelector('.chat-replies');
    const toggle = messageEl.querySelector('.chat-toggle');
    if (!replyCount) {
      if (toggle) toggle.remove();
      return;
    }
    const label = repliesEl && repliesEl.style.display === 'none' ? 'Expand' : 'Collapse';
    const text = `${label} ${replyCount} repl${replyCount > 1 ? 'ies' : 'y'}`;
    if (toggle) {
      toggle.textContent = text;
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-toggle';
    btn.dataset.toggleReplies = messageEl.dataset.message;
    btn.textContent = text;
    const actions = messageEl.querySelector('.chat-actions');
    if (actions) {
      messageEl.insertBefore(btn, actions);
    } else {
      messageEl.appendChild(btn);
    }
  }

  function updateMessageElement(messageEl, msg, replyCount) {
    if (!messageEl) return;
    const role = msg.sender_role || 'participant';
    const highlight = role === 'admin' ? 'chat-message--admin' : role === 'organizer' ? 'chat-message--organizer' : '';
    const deletedClass = msg.is_deleted ? 'chat-message--deleted' : '';
    messageEl.className = `chat-message ${highlight} ${deletedClass}`.trim();

    let header = messageEl.querySelector('.chat-header-line');
    if (!header) {
      header = document.createElement('div');
      header.className = 'chat-header-line';
      messageEl.prepend(header);
    }
    header.innerHTML = buildMessageHeaderHtml(msg);

    let body = messageEl.querySelector('.chat-body');
    if (!body) {
      body = document.createElement('div');
      body.className = 'chat-body';
      messageEl.appendChild(body);
    }
    body.innerHTML = formatMessageBody(msg.display_body || '');

    let actions = messageEl.querySelector('.chat-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'chat-actions';
      messageEl.appendChild(actions);
    }
    actions.innerHTML = buildMessageActionsHtml(msg);

    if (replyCount > 0 && !messageEl.querySelector('.chat-replies')) {
      const repliesWrap = document.createElement('div');
      repliesWrap.className = 'chat-replies';
      repliesWrap.dataset.repliesFor = msg.id;
      messageEl.appendChild(repliesWrap);
    }
    updateReplyToggle(messageEl, replyCount || 0);
  }

  function htmlToElement(html) {
    const temp = document.createElement('div');
    temp.innerHTML = html.trim();
    return temp.firstElementChild;
  }

  function insertMessageElement(msg, replyCounts) {
    const container = $('chatMessages');
    if (!container) return;
    let target = container;
    if (msg.parent_id) {
      const parentEl = container.querySelector(`.chat-message[data-message="${msg.parent_id}"]`);
      if (parentEl) {
        let repliesEl = parentEl.querySelector(`.chat-replies[data-replies-for="${msg.parent_id}"]`);
        if (!repliesEl) {
          repliesEl = document.createElement('div');
          repliesEl.className = 'chat-replies';
          repliesEl.dataset.repliesFor = msg.parent_id;
          parentEl.appendChild(repliesEl);
        }
        updateReplyToggle(parentEl, replyCounts[msg.parent_id] || 0);
        target = repliesEl;
      }
    }
    target.appendChild(htmlToElement(renderMessageNode(msg)));
  }

  function syncPinnedMessages(pinned) {
    const sig = (pinned || []).map(buildMessageSignature).join('|');
    if (sig === chatState.pinnedSignature) return;
    renderPinnedMessages(pinned || []);
    chatState.pinnedSignature = sig;
  }

  function isNearBottom(el) {
    if (!el) return false;
    return (el.scrollHeight - el.scrollTop - el.clientHeight) < 120;
  }

  function syncChatMessages(nextMessages, options = {}) {
    const el = $('chatMessages');
    if (!el) return;
    const force = options.force || !chatState.messageSignatures;
    if (!nextMessages || nextMessages.length === 0) {
      el.innerHTML = '<p class="muted">No messages yet.</p>';
      chatState.messageSignatures = new Map();
      return;
    }
    if (force) {
      renderChatMessages(nextMessages);
      const map = new Map();
      nextMessages.forEach(msg => map.set(msg.id, buildMessageSignature(msg)));
      chatState.messageSignatures = map;
      return;
    }

    const replyCounts = computeReplyCounts(nextMessages);
    const nextMap = new Map();
    const added = [];
    const changed = [];
    nextMessages.forEach(msg => {
      const sig = buildMessageSignature(msg);
      nextMap.set(msg.id, sig);
      const prev = chatState.messageSignatures.get(msg.id);
      if (!prev) added.push(msg);
      else if (prev !== sig) changed.push(msg);
    });
    const removed = [];
    chatState.messageSignatures.forEach((_, id) => {
      if (!nextMap.has(id)) removed.push(id);
    });

    if (!added.length && !changed.length && !removed.length) {
      return;
    }

    const autoScroll = options.autoScroll || isNearBottom(el);

    removed.forEach(id => {
      el.querySelector(`.chat-message[data-message="${id}"]`)?.remove();
    });

    changed.forEach(msg => {
      const node = el.querySelector(`.chat-message[data-message="${msg.id}"]`);
      if (node) updateMessageElement(node, msg, replyCounts[msg.id] || 0);
    });

    added.forEach(msg => insertMessageElement(msg, replyCounts));

    chatState.messageSignatures = nextMap;
    wireChatMessageActions();

    if (autoScroll) {
      el.scrollTop = el.scrollHeight;
    }
  }

  function renderChatMessages(messages) {
    const el = $('chatMessages');
    if (!el) return;
    if (!messages.length) {
      el.innerHTML = '<p class="muted">No messages yet.</p>';
      return;
    }
    const tree = buildMessageTree(messages);
    el.innerHTML = tree.map(renderMessageNode).join('');
    wireChatMessageActions();
  }

  function renderPinnedMessages(pinned) {
    const el = $('chatPins');
    if (!el) return;
    if (!pinned.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = pinned.map(p => `
      <div class="chat-pin">
        <div class="chat-header-line">
          <span class="chat-name">${escapeHtml(p.sender_name || 'User')}</span>
          <span class="role-badge ${p.sender_role}">${roleLabel(p.sender_role)}</span>
          <span class="role-badge pin">Pinned</span>
          <span class="chat-meta">${formatDateTime(p.created_at)}</span>
        </div>
        <div class="chat-body">${formatMessageBody(p.display_body || '')}</div>
      </div>
    `).join('');
  }

  function renderChatThreads() {
    const el = $('chatThreads');
    if (!el) return;
    let threads = chatState.threads.slice();
    if (chatState.filter !== 'all') {
      threads = threads.filter(t => t.type === chatState.filter);
    }
    if (chatState.search) {
      const term = chatState.search.toLowerCase();
      threads = threads.filter(t => (t.title || '').toLowerCase().includes(term));
    }
    if (chatState.activeThreadId && !threads.some(t => t.id === chatState.activeThreadId)) {
      chatState.activeThreadId = null;
    }
    if (!threads.length) {
      const emptyMsg = chatState.search ? 'No chats match your search.' : 'No chats yet — join an event or club to start chatting.';
      el.innerHTML = `<p class="muted">${emptyMsg}</p>`;
      setChatEmptyState(emptyMsg);
      return;
    }
    el.innerHTML = threads.map(t => {
      const active = t.id === chatState.activeThreadId ? 'active' : '';
      const label = t.type === 'club' ? 'Club' : 'Event';
      const status = t.is_archived ? 'Archived' : t.is_closed ? 'Closed' : 'Active';
      const meta = t.last_message_at ? formatDateTime(t.last_message_at) : 'No messages yet';
      return `<div class="chat-thread-item ${active}" data-thread-id="${t.id}">
        <div class="chat-thread-title">${escapeHtml(t.title || `${label} chat`)}</div>
        <div class="chat-thread-meta">${label} • ${escapeHtml(meta)} • ${status}</div>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-thread-id]').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.threadId, 10);
        if (!id) return;
        setActiveThread(id);
      });
    });
    if (!chatState.activeThreadId) {
      setChatEmptyState('Select a chat to view messages.');
    }
  }

  function setActiveThread(threadId) {
    chatState.activeThreadId = threadId;
    chatState.searchMode = false;
    clearReply();
    chatState.messageSignatures = null;
    chatState.pinnedSignature = '';
    renderChatThreads();
    loadChatThread(threadId);
  }

  async function loadChatThreads() {
    const el = $('chatThreads');
    if (!el) return;
    if (!chatState.threads.length) el.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const r = await get('/api/chats');
      if (r.success) {
        chatState.threads = r.chats || [];
        renderChatThreads();
      }
    } catch (e) {
      el.innerHTML = '<p class="muted">Could not load chats.</p>';
    }
  }

  async function loadChatThread(threadId, options = {}) {
    if (!threadId) return;
    const el = $('chatMessages');
    const silent = options.silent === true;
    const forceScroll = options.forceScroll === true;
    if (el && !silent) el.innerHTML = '<p class="muted">Loading messages…</p>';
    try {
      const r = await get('/api/chats/' + threadId + '/messages');
      if (!r.success) {
        if (el && !silent) el.innerHTML = `<p class="muted">${escapeHtml(r.message || 'Could not load messages.')}</p>`;
        if (!silent) showChatComposer(false);
        return;
      }
      chatState.permissions = r.permissions || {};
      chatState.messages = r.messages || [];
      chatState.pinned = r.pinned || [];
      chatState.ban = r.ban || null;
      chatState.threadMeta = r.thread || null;
      chatState.searchMode = false;

      const title = r.thread?.title || 'Chat';
      $('chatTitle').textContent = title;
      const metaParts = [];
      if (r.thread?.type === 'club') metaParts.push('Club chat');
      if (r.thread?.type === 'event') metaParts.push('Event chat');
      if (r.thread?.is_archived) metaParts.push('Archived');
      if (r.thread?.is_closed) metaParts.push('Closed');
      $('chatMeta').textContent = metaParts.join(' • ') || 'Chat';
      const actions = $('chatPanelActions');
      if (actions) actions.innerHTML = '';
      const searchRow = document.querySelector('.chat-search-row');
      if (searchRow) searchRow.style.display = 'flex';

      const banNotice = $('chatBanNotice');
      if (banNotice) {
        let noticeText = '';
        if (r.thread?.is_archived) {
          noticeText = 'This chat has been archived.';
        } else if (r.thread?.is_closed) {
          noticeText = 'This chat is closed. You can read messages but cannot post.';
        } else if (chatState.ban) {
          const until = chatState.ban.end_at ? `until ${formatDateTime(chatState.ban.end_at)}` : 'until an admin unbans you';
          noticeText = `Chat disabled ${until}.`;
        }
        if (noticeText) {
          banNotice.textContent = noticeText;
          banNotice.style.display = 'block';
        } else {
          banNotice.style.display = 'none';
        }
      }

      const canPost = chatState.permissions.canPost && !chatState.ban && !r.thread?.is_archived;
      $('chatInput').disabled = !canPost;
      $('chatSendBtn').disabled = !canPost;
      showChatComposer(true);

      const announceWrap = $('chatAnnouncementWrap');
      if (announceWrap) {
        announceWrap.style.display = chatState.permissions.canAnnounce ? 'inline-flex' : 'none';
      }
      if (!chatState.permissions.canAnnounce) {
        $('chatAnnouncement').checked = false;
      }

      syncPinnedMessages(chatState.pinned);
      syncChatMessages(chatState.messages, {
        force: !chatState.messageSignatures,
        autoScroll: forceScroll || !silent
      });
    } catch (e) {
      if (el && !silent) el.innerHTML = '<p class="muted">Could not load messages.</p>';
    }
  }

  function showReplyBanner(msg) {
    const banner = $('chatReplyBanner');
    if (!banner) return;
    banner.style.display = 'flex';
    banner.innerHTML = `Replying to <strong>${escapeHtml(msg.sender_name || 'User')}</strong>
      <button type="button" class="btn btn-ghost btn-sm" id="chatCancelReply">Cancel</button>`;
    banner.querySelector('#chatCancelReply')?.addEventListener('click', clearReply);
  }

  function clearReply() {
    chatState.replyTo = null;
    const banner = $('chatReplyBanner');
    if (banner) {
      banner.style.display = 'none';
      banner.innerHTML = '';
    }
  }

  async function submitChatMessage(e) {
    e.preventDefault();
    if (!chatState.activeThreadId) return;
    const input = $('chatInput');
    const body = input.value.trim();
    if (!body) return;
    try {
      const res = await post(`/api/chats/${chatState.activeThreadId}/messages`, {
        body,
        parentId: chatState.replyTo?.id || null,
        is_announcement: $('chatAnnouncement')?.checked || false
      });
      if (!res.success) {
        alert(res.message || 'Failed to send message.');
        if (res.ban) {
          loadChatThread(chatState.activeThreadId, { silent: true });
        }
        return;
      }
      input.value = '';
      $('chatAnnouncement').checked = false;
      clearReply();
      loadChatThread(chatState.activeThreadId, { silent: true, forceScroll: true });
    } catch (_) {
      alert('Request failed.');
    }
  }

  function wireChatMessageActions() {
    const container = $('chatMessages');
    if (!container) return;
    container.querySelectorAll('[data-vote]').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const vote = btn.dataset.vote;
        const messageId = parseInt(btn.dataset.messageId, 10);
        if (!messageId) return;
        const res = await post(`/api/chat/messages/${messageId}/vote`, { vote });
        if (!res.success) {
          alert(res.message || 'Could not vote.');
        }
        loadChatThread(chatState.activeThreadId, { silent: true });
      });
    });

    container.querySelectorAll('[data-reply]').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        const messageId = parseInt(btn.dataset.reply, 10);
        const msg = chatState.messages.find(m => m.id === messageId);
        if (!msg) return;
        chatState.replyTo = msg;
        showReplyBanner(msg);
        $('chatInput')?.focus();
      });
    });

    container.querySelectorAll('[data-edit]').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const messageId = parseInt(btn.dataset.edit, 10);
        const msg = chatState.messages.find(m => m.id === messageId);
        if (!msg) return;
        const next = prompt('Edit message:', msg.body || msg.display_body || '');
        if (next === null) return;
        const res = await put(`/api/chat/messages/${messageId}`, { body: next });
        if (!res.success) {
          alert(res.message || 'Could not edit message.');
        }
        loadChatThread(chatState.activeThreadId, { silent: true });
      });
    });

    container.querySelectorAll('[data-delete]').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const messageId = parseInt(btn.dataset.delete, 10);
        if (!messageId) return;
        if (!confirm('Delete this message?')) return;
        const res = await del(`/api/chat/messages/${messageId}`);
        if (!res.success) {
          alert(res.message || 'Could not delete message.');
        }
        loadChatThread(chatState.activeThreadId, { silent: true });
      });
    });

    container.querySelectorAll('[data-pin]').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const messageId = parseInt(btn.dataset.pin, 10);
        if (!messageId) return;
        const res = await post(`/api/chat/threads/${chatState.activeThreadId}/pins`, { messageId });
        if (!res.success) alert(res.message || 'Could not pin.');
        loadChatThread(chatState.activeThreadId, { silent: true });
      });
    });

    container.querySelectorAll('[data-unpin]').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        const messageId = parseInt(btn.dataset.unpin, 10);
        if (!messageId) return;
        const res = await del(`/api/chat/threads/${chatState.activeThreadId}/pins/${messageId}`);
        if (!res.success) alert(res.message || 'Could not unpin.');
        loadChatThread(chatState.activeThreadId, { silent: true });
      });
    });

    container.querySelectorAll('[data-toggle-replies]').forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggleReplies;
        const replies = container.querySelector(`[data-replies-for="${id}"]`);
        if (!replies) return;
        const isHidden = replies.style.display === 'none';
        replies.style.display = isHidden ? 'flex' : 'none';
        btn.textContent = isHidden ? btn.textContent.replace('Expand', 'Collapse') : btn.textContent.replace('Collapse', 'Expand');
      });
    });
  }

  async function runChatSearch() {
    if (!chatState.activeThreadId) return;
    const query = $('chatMessageSearch').value.trim();
    if (!query) return;
    const res = await get(`/api/chats/${chatState.activeThreadId}/search?q=${encodeURIComponent(query)}`);
    if (!res.success) {
      alert(res.message || 'Search failed.');
      return;
    }
    chatState.searchMode = true;
    chatState.messageSignatures = null;
    const results = (res.results || []).map(r => ({
      id: r.id,
      parent_id: r.parent_id,
      sender_id: r.sender_id,
      sender_name: r.sender_name,
      sender_role: r.sender_role,
      display_body: r.display_body || r.body || '',
      is_deleted: !r.body,
      created_at: r.created_at,
      upvotes: 0,
      downvotes: 0,
      user_vote: null,
      is_announcement: false,
      is_pinned: false,
      can_edit: false,
      can_delete: false
    }));
    const el = $('chatMessages');
    if (!results.length) {
      el.innerHTML = `<p class="muted">No results for "${escapeHtml(query)}".</p>`;
      return;
    }
    el.innerHTML = results.map(renderMessageNode).join('');
    wireChatMessageActions();
  }

  function clearChatSearch() {
    chatState.searchMode = false;
    $('chatMessageSearch').value = '';
    if (chatState.activeThreadId) {
      loadChatThread(chatState.activeThreadId);
    } else {
      setChatEmptyState('Select a chat to view messages.');
    }
  }

  function initChatUi() {
    const searchInput = $('chatThreadSearch');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        chatState.search = searchInput.value.trim();
        renderChatThreads();
      });
    }
    document.querySelectorAll('[data-chat-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-chat-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        chatState.filter = btn.dataset.chatFilter || 'all';
        renderChatThreads();
      });
    });

    $('chatForm')?.addEventListener('submit', submitChatMessage);
    $('chatSearchBtn')?.addEventListener('click', runChatSearch);
    $('chatClearSearchBtn')?.addEventListener('click', clearChatSearch);
  }

  // ---------- Helpers ----------
  function escapeHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function parseDateValue(s, opts = {}) {
    if (!s) return null;
    if (s instanceof Date) return isNaN(s.getTime()) ? null : s;
    if (typeof s === 'string') {
      const trimmed = s.trim();
      if (!trimmed) return null;
      if (trimmed.includes('T') || trimmed.includes(' ')) {
        const normalized = trimmed.includes(' ') && !trimmed.includes('T')
          ? trimmed.replace(' ', 'T')
          : trimmed;
        const d = new Date(normalized);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(trimmed + 'T00:00:00');
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function formatDate(s) {
    const d = parseDateValue(s);
    if (!d) return s || '—';
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  function formatDateTime(s) {
    const d = parseDateValue(s);
    if (!d) return s || '—';
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
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
    initChatUi();
    loadChatThreads();
    setInterval(() => {
      if (chatState.activeThreadId && !chatState.searchMode) {
        loadChatThread(chatState.activeThreadId, { silent: true });
      }
    }, 15000);
    setInterval(() => {
      loadChatThreads();
    }, 30000);
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
