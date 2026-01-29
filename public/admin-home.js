(function () {
  'use strict';

  const API = '';
  let currentUserId = null;
  let currentEventId = null;
  let currentPage = 1;
  let frozenRegistrations = false;

  // ===== Utility Functions =====
  function getUser() {
    try {
      const s = sessionStorage.getItem('user');
      if (!s) return null;
      return JSON.parse(s);
    } catch (_) { return null; }
  }

  function redirectLogin() {
    sessionStorage.removeItem('user');
    window.location.href = '/';
  }

  function $(id) { return document.getElementById(id); }
  function qs(s) { return document.querySelector(s); }
  function qsa(s) { return document.querySelectorAll(s); }

  function headers() {
    return { 'Content-Type': 'application/json' };
  }

  async function get(url) {
    const res = await fetch(API + url, { credentials: 'include', headers: headers() });
    if (!res.ok && res.status === 401) {
      redirectLogin();
      throw new Error('Unauthorized');
    }
    return res.json();
  }

  async function post(url, body) {
    const res = await fetch(API + url, { 
      method: 'POST', 
      credentials: 'include', 
      headers: headers(), 
      body: JSON.stringify(body) 
    });
    if (!res.ok && res.status === 401) {
      redirectLogin();
      throw new Error('Unauthorized');
    }
    return res.json();
  }

  async function put(url, body) {
    const res = await fetch(API + url, { 
      method: 'PUT', 
      credentials: 'include', 
      headers: headers(), 
      body: JSON.stringify(body) 
    });
    if (!res.ok && res.status === 401) {
      redirectLogin();
      throw new Error('Unauthorized');
    }
    return res.json();
  }

  async function del(url) {
    const res = await fetch(API + url, { 
      method: 'DELETE', 
      credentials: 'include', 
      headers: headers() 
    });
    if (!res.ok && res.status === 401) {
      redirectLogin();
      throw new Error('Unauthorized');
    }
    return res.json();
  }

  async function hydrateUser() {
    const cached = getUser();
    if (cached && cached.id) return cached;
    try {
      const r = await get('/api/profile');
      if (r && r.success && r.user) {
        sessionStorage.setItem('user', JSON.stringify(r.user));
        return r.user;
      }
    } catch (_) {}
    return null;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function formatDate(s) {
    if (!s) return '—';
    try {
      const raw = String(s);
      const value = raw.length === 10 ? raw + 'T00:00:00' : raw;
      return new Date(value).toLocaleDateString(undefined, { dateStyle: 'medium' });
    } catch (_) { return s; }
  }

  function formatDateTime(s) {
    if (!s) return '—';
    try {
      const d = new Date(s);
      if (isNaN(d.getTime())) return s;
      return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) { return s; }
  }

  function showMessage(el, msg, type = 'success') {
    el.textContent = msg;
    el.className = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  }

  // ===== Navigation =====
  function setSection(id) {
    qsa('.section').forEach(el => el.classList.remove('active'));
    qsa('.nav-item').forEach(el => el.classList.remove('active'));
    const sec = $(id);
    const nav = qs('.nav-item[href="#' + id + '"]');
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

  // ===== Sidebar & Menu =====
  $('menuBtn')?.addEventListener('click', function () {
    $('sidebar')?.classList.toggle('open');
    $('overlay')?.classList.toggle('open');
  });
  $('overlay')?.addEventListener('click', function () {
    $('sidebar')?.classList.remove('open');
    this.classList.remove('open');
  });

  $('userMenuBtn')?.addEventListener('click', function () {
    qs('.user-menu')?.classList.toggle('open');
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.user-menu')) qs('.user-menu')?.classList.remove('open');
  });

  async function logout() {
    try { await post('/logout', {}); } catch (_) {}
    redirectLogin();
  }
  $('logoutBtn')?.addEventListener('click', logout);

  // ===== Dashboard =====
  async function loadDashboard() {
    try {
      const stats = await get('/api/admin/stats');
      if (stats.success) {
        const { usersByRole, eventsByStatus, upcomingEvents } = stats.stats;
        let totalUsers = 0;
        const roleBreakdown = [];
        usersByRole.forEach(r => {
          totalUsers += r.count;
          roleBreakdown.push(`${r.role}: ${r.count}`);
        });
        $('statTotalUsers').textContent = totalUsers;
        $('statUsersByRole').textContent = roleBreakdown.join(' • ');

        let totalEvents = 0;
        const statusBreakdown = [];
        eventsByStatus.forEach(s => {
          totalEvents += s.count;
          statusBreakdown.push(`${s.status}: ${s.count}`);
          if (s.status === 'pending_approval') {
            $('statPendingApproval').textContent = s.count;
          }
        });
        $('statTotalEvents').textContent = totalEvents;
        $('statEventsByStatus').textContent = statusBreakdown.join(' • ');
        $('statUpcomingEvents').textContent = upcomingEvents;
      }

      const recent = await get('/api/admin/recent');
      if (recent.success) {
        const recentUsers = $('recentUsers');
        recentUsers.innerHTML = recent.recentUsers.length
          ? '<ul class="list">' + recent.recentUsers.map(u =>
            '<li>' + escapeHtml(u.email) + ' <span class="role-badge ' + u.role + '">' + u.role + '</span> <span class="muted">• ' + formatDate(u.created_at) + '</span></li>'
          ).join('') + '</ul>'
          : '<span class="empty">No recent users</span>';

        const recentEvents = $('recentEvents');
        recentEvents.innerHTML = recent.recentEvents.length
          ? '<ul class="list">' + recent.recentEvents.map(e =>
            '<li>' + escapeHtml(e.title) + ' <span class="status ' + e.status + '">' + e.status + '</span> <span class="muted">• ' + escapeHtml(e.organizer_email) + '</span></li>'
          ).join('') + '</ul>'
          : '<span class="empty">No recent events</span>';
      }

      const topOrg = await get('/api/admin/top-organizers');
      if (topOrg.success) {
        const topOrganizers = $('topOrganizers');
        topOrganizers.innerHTML = topOrg.organizers.length
          ? '<ul class="list">' + topOrg.organizers.map(o =>
            '<li>' + escapeHtml(o.full_name || o.email) + ' <span class="muted">• ' + o.event_count + ' events</span></li>'
          ).join('') + '</ul>'
          : '<span class="empty">No organizers yet</span>';
      }
    } catch (e) {
      console.error('Error loading dashboard:', e);
    }
  }

  // ===== User Management =====
  async function loadUsers() {
    const tbody = $('usersTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading users...</td></tr>';
    const search = $('userSearch').value.trim();
    const role = $('roleFilter').value;
    const status = $('statusFilter').value;
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (role) params.append('role', role);
    if (status) params.append('status', status);

    try {
      const res = await get('/api/admin/users?' + params.toString());
      if (res.success) {
        renderUsersTable(res.users || []);
      } else {
        renderUsersError(res.message || 'Could not load users.');
      }
    } catch (e) {
      console.error('Error loading users:', e);
      renderUsersError('Could not load users. Please refresh.');
    }
  }

  function renderUsersTable(users) {
    const tbody = $('usersTableBody');
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading">No users found</td></tr>';
      return;
    }
    tbody.innerHTML = users.map(u => {
      const status = u.is_active && !u.deleted_at ? 'active' : 'disabled';
      return `<tr data-user-row="${u.id}">
        <td>${escapeHtml(u.email)}</td>
        <td>${escapeHtml(u.full_name || '—')}</td>
        <td><span class="role-badge ${u.role}">${u.role}</span></td>
        <td><span class="status ${status}">${status}</span></td>
        <td>${formatDate(u.created_at)}</td>
        <td class="table-actions">
          <button type="button" class="btn btn-ghost" data-edit-user="${u.id}">Edit</button>
          <button type="button" class="btn btn-danger" data-delete-user="${u.id}">Delete</button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-edit-user]').forEach(btn => {
      btn.addEventListener('click', () => openEditUserModal(parseInt(btn.dataset.editUser, 10), users));
    });
    tbody.querySelectorAll('[data-delete-user]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = parseInt(btn.dataset.deleteUser, 10);
        if (!confirm('Delete this user? This will soft-delete their account.')) return;
        try {
          await del(`/api/admin/users/${userId}`);
          showMessage($('userMessage'), 'User deleted');
          // Remove row from table immediately
          const row = tbody.querySelector(`[data-user-row="${userId}"]`);
          if (row) row.remove();
        } catch (e) {
          showMessage($('userMessage'), 'Failed to delete user', 'error');
        }
      });
    });
  }

  function renderUsersError(message) {
    const tbody = $('usersTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(message)}</td></tr>`;
  }

  function openEditUserModal(userId, users) {
    const user = users.find(u => u.id === userId);
    if (!user) return;
    currentUserId = userId;
    $('editUserEmail').value = user.email;
    $('editUserRole').value = user.role;
    $('editUserStatus').value = user.is_active && !user.deleted_at ? '1' : '0';
    showModal('editUserModal');
  }

  $('saveUser')?.addEventListener('click', async function () {
    const role = $('editUserRole').value;
    const is_active = $('editUserStatus').value === '1';
    try {
      await put(`/api/admin/users/${currentUserId}/role`, { role });
      await put(`/api/admin/users/${currentUserId}/status`, { is_active });
      showMessage($('userMessage'), 'User updated successfully');
      closeModal('editUserModal');
      loadUsers();
    } catch (e) {
      showMessage($('userMessage'), 'Failed to update user', 'error');
    }
  });

  $('resetUserPassword')?.addEventListener('click', async function () {
    const newPassword = prompt('Enter new password (min. 6 characters):');
    if (!newPassword || newPassword.length < 6) {
      alert('Password must be at least 6 characters');
      return;
    }
    try {
      await post(`/api/admin/users/${currentUserId}/reset-password`, { newPassword });
      showMessage($('userMessage'), 'Password reset successfully');
      closeModal('editUserModal');
    } catch (e) {
      showMessage($('userMessage'), 'Failed to reset password', 'error');
    }
  });

  $('deleteUser')?.addEventListener('click', async function () {
    if (!confirm('Delete this user? This will soft-delete their account.')) return;
    try {
      await del(`/api/admin/users/${currentUserId}`);
      showMessage($('userMessage'), 'User deleted');
      closeModal('editUserModal');
      loadUsers();
    } catch (e) {
      showMessage($('userMessage'), 'Failed to delete user', 'error');
    }
  });

  $('refreshUsers')?.addEventListener('click', loadUsers);
  $('userSearch')?.addEventListener('input', debounce(loadUsers, 500));
  $('roleFilter')?.addEventListener('change', loadUsers);
  $('statusFilter')?.addEventListener('change', loadUsers);

  // ===== Event Management =====
  async function loadEvents() {
    const list = $('eventsList');
    if (list) list.innerHTML = '<p class="muted">Loading events...</p>';
    const search = $('eventSearch').value.trim();
    const status = $('eventStatusFilter').value;
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (status) params.append('status', status);

    try {
      const res = await get('/api/admin/events?' + params.toString());
      if (res.success) {
        renderEventsList(res.events || []);
      } else if (list) {
        list.innerHTML = '<p class="muted">Could not load events.</p>';
      }
    } catch (e) {
      console.error('Error loading events:', e);
      if (list) list.innerHTML = '<p class="muted">Could not load events.</p>';
    }
  }

  function renderEventsList(events) {
    const el = $('eventsList');
    if (!events.length) {
      el.innerHTML = '<p class="muted">No events found</p>';
      return;
    }
    el.innerHTML = events.map(e => {
      const actions = [];
      if (e.status === 'pending_approval') {
        actions.push(`<button type="button" class="btn btn-primary" data-approve="${e.id}">Approve</button>`);
        actions.push(`<button type="button" class="btn btn-danger" data-reject="${e.id}">Reject</button>`);
      }
      if (e.status === 'published') {
        actions.push(`<button type="button" class="btn btn-secondary" data-close="${e.id}">Force Close</button>`);
      }
      actions.push(`<button type="button" class="btn btn-ghost" data-view="${e.id}">View Details</button>`);
      actions.push(`<button type="button" class="btn btn-danger" data-delete="${e.id}">Delete</button>`);

      return `<div class="event-card">
        <div class="event-card-header">
          <h4>${escapeHtml(e.title)}</h4>
          <span class="status ${e.status}">${e.status}</span>
        </div>
        <p class="muted">${escapeHtml(e.description || '')}</p>
        <div class="event-card-meta">
          <div><strong>Organizer:</strong> ${escapeHtml(e.organizer_name || e.organizer_email)}</div>
          <div><strong>Date:</strong> ${formatDate(e.event_date)} ${e.start_time} - ${e.end_time}</div>
          <div><strong>Location:</strong> ${escapeHtml(e.location || e.online_link || 'TBD')}</div>
        </div>
        <div class="event-card-actions">${actions.join('')}</div>
      </div>`;
    }).join('');

    el.querySelectorAll('[data-approve]').forEach(btn => {
      btn.addEventListener('click', () => approveEvent(parseInt(btn.dataset.approve, 10)));
    });
    el.querySelectorAll('[data-reject]').forEach(btn => {
      btn.addEventListener('click', () => rejectEvent(parseInt(btn.dataset.reject, 10)));
    });
    el.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => forceCloseEvent(parseInt(btn.dataset.close, 10)));
    });
    el.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => viewEvent(parseInt(btn.dataset.view, 10), events));
    });
    el.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteEvent(parseInt(btn.dataset.delete, 10)));
    });
  }

  async function approveEvent(id) {
    try {
      await put(`/api/admin/events/${id}/approve`, {});
      showMessage($('eventMessage'), 'Event approved');
      loadEvents();
      loadDashboard();
    } catch (e) {
      showMessage($('eventMessage'), 'Failed to approve event', 'error');
    }
  }

  async function rejectEvent(id) {
    const reason = prompt('Rejection reason (optional):');
    try {
      await put(`/api/admin/events/${id}/reject`, { reason });
      showMessage($('eventMessage'), 'Event rejected');
      loadEvents();
      loadDashboard();
    } catch (e) {
      showMessage($('eventMessage'), 'Failed to reject event', 'error');
    }
  }

  async function forceCloseEvent(id) {
    if (!confirm('Force close this event? This cannot be undone.')) return;
    try {
      await post(`/api/admin/events/${id}/force-close`, {});
      showMessage($('eventMessage'), 'Event force-closed');
      loadEvents();
    } catch (e) {
      showMessage($('eventMessage'), 'Failed to close event', 'error');
    }
  }

  async function deleteEvent(id) {
    if (!confirm('Delete this event? This will permanently remove it and all registrations.')) return;
    try {
      await del(`/api/admin/events/${id}`);
      showMessage($('eventMessage'), 'Event deleted');
      loadEvents();
      loadDashboard();
    } catch (e) {
      showMessage($('eventMessage'), 'Failed to delete event', 'error');
    }
  }

  function viewEvent(id, events) {
    const event = events.find(e => e.id === id);
    if (!event) return;
    $('eventModalTitle').textContent = event.title;
    $('eventModalBody').innerHTML = `
      <div class="event-card-meta">
        <div><strong>Status:</strong> <span class="status ${event.status}">${event.status}</span></div>
        <div><strong>Organizer:</strong> ${escapeHtml(event.organizer_name || event.organizer_email)}</div>
        <div><strong>Date:</strong> ${formatDate(event.event_date)}</div>
        <div><strong>Time:</strong> ${event.start_time} - ${event.end_time}</div>
        <div><strong>Location:</strong> ${escapeHtml(event.location || event.online_link || 'TBD')}</div>
        <div><strong>Max Participants:</strong> ${event.max_participants === 0 ? 'Unlimited' : event.max_participants}</div>
      </div>
      <p class="muted" style="margin-top: 16px;">${escapeHtml(event.description || '')}</p>
      ${event.rejection_reason ? '<p class="muted" style="color: var(--error);"><strong>Rejection Reason:</strong> ' + escapeHtml(event.rejection_reason) + '</p>' : ''}
    `;
    showModal('eventModal');
  }

  $('refreshEvents')?.addEventListener('click', loadEvents);
  $('eventSearch')?.addEventListener('input', debounce(loadEvents, 500));
  $('eventStatusFilter')?.addEventListener('change', loadEvents);

  // ===== Settings =====
  async function loadSettings() {
    try {
      const res = await get('/api/admin/settings');
      if (res.success) {
        res.settings.forEach(s => {
          if (s.setting_key === 'event_approval_required') {
            $('settingApproval').checked = s.setting_value === 'true';
          } else if (s.setting_key === 'allow_new_registrations') {
            $('settingRegistrations').checked = s.setting_value === 'true';
          } else if (s.setting_key === 'maintenance_mode') {
            $('settingMaintenance').checked = s.setting_value === 'true';
          } else if (s.setting_key === 'max_events_per_organizer') {
            $('settingMaxEvents').value = s.setting_value;
          } else if (s.setting_key === 'registrations_frozen') {
            frozenRegistrations = s.setting_value === 'true';
          }
        });
      }
    } catch (e) {
      console.error('Error loading settings:', e);
    }
  }

  $('saveSettings')?.addEventListener('click', async function () {
    const settings = {
      event_approval_required: $('settingApproval').checked,
      allow_new_registrations: $('settingRegistrations').checked,
      maintenance_mode: $('settingMaintenance').checked,
      max_events_per_organizer: $('settingMaxEvents').value
    };
    try {
      await put('/api/admin/settings', { settings });
      showMessage($('settingsMessage'), 'Settings saved successfully');
      loadSettings();
    } catch (e) {
      showMessage($('settingsMessage'), 'Failed to save settings', 'error');
    }
  });

  // ===== Audit Logs =====
  async function loadLogs() {
    const tbody = $('logsTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading logs...</td></tr>';
    const action = $('logActionFilter').value;
    const targetType = $('logTargetFilter').value;
    const params = new URLSearchParams();
    if (action) params.append('action', action);
    if (targetType) params.append('target_type', targetType);
    params.append('page', currentPage);
    params.append('limit', 50);

    try {
      const res = await get('/api/admin/logs?' + params.toString());
      if (res.success) {
        renderLogsTable(res.logs || []);
        updateLogsPagination(res.total);
      } else {
        renderLogsError(res.message || 'Could not load logs.');
      }
    } catch (e) {
      console.error('Error loading logs:', e);
      renderLogsError('Could not load logs. Please refresh.');
    }
  }

  function renderLogsTable(logs) {
    const tbody = $('logsTableBody');
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="loading">No logs found</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => {
      let details = '—';
      try {
        const d = typeof l.details === 'string' ? JSON.parse(l.details) : l.details;
        if (d && typeof d === 'object') {
          details = Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(', ');
        }
      } catch (_) {}
      return `<tr>
        <td>${formatDateTime(l.created_at)}</td>
        <td>${escapeHtml(l.admin_email)}</td>
        <td>${escapeHtml(l.action)}</td>
        <td>${l.target_type} ${l.target_id ? '#' + l.target_id : ''}</td>
        <td>${escapeHtml(details)}</td>
        <td>${escapeHtml(l.ip_address || '—')}</td>
      </tr>`;
    }).join('');
  }

  function updateLogsPagination(total) {
    const totalPages = Math.max(1, Math.ceil((total || 0) / 50));
    $('logsPageInfo').textContent = `Page ${currentPage} of ${totalPages}`;
    $('logsPrev').disabled = currentPage === 1;
    $('logsNext').disabled = currentPage >= totalPages;
  }

  function renderLogsError(message) {
    const tbody = $('logsTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="loading">${escapeHtml(message)}</td></tr>`;
    $('logsPageInfo').textContent = 'Page 1 of 1';
    $('logsPrev').disabled = true;
    $('logsNext').disabled = true;
  }

  $('logsPrev')?.addEventListener('click', function () {
    if (currentPage > 1) {
      currentPage--;
      loadLogs();
    }
  });

  $('logsNext')?.addEventListener('click', function () {
    currentPage++;
    loadLogs();
  });

  $('refreshLogs')?.addEventListener('click', loadLogs);
  $('logActionFilter')?.addEventListener('change', () => { currentPage = 1; loadLogs(); });
  $('logTargetFilter')?.addEventListener('change', () => { currentPage = 1; loadLogs(); });

  // ===== Emergency Controls =====
  $('btnForceLogout')?.addEventListener('click', async function () {
    if (!confirm('Force logout all users? This will log out all active sessions.')) return;
    try {
      await post('/api/admin/emergency/force-logout-all', {});
      showMessage($('message'), 'Force logout initiated');
    } catch (e) {
      showMessage($('message'), 'Failed to force logout', 'error');
    }
  });

  $('btnDisableEvents')?.addEventListener('click', async function () {
    if (!confirm('Close all events? This will set all published/pending events to closed.')) return;
    try {
      const res = await post('/api/admin/emergency/disable-all-events', {});
      showMessage($('message'), res.message);
      loadEvents();
      loadDashboard();
    } catch (e) {
      showMessage($('message'), 'Failed to close events', 'error');
    }
  });

  $('btnFreezeReg')?.addEventListener('click', async function () {
    const action = frozenRegistrations ? 'Unfreeze' : 'Freeze';
    if (!confirm(`${action} all event registrations?`)) return;
    try {
      const res = await post('/api/admin/emergency/freeze-registrations', { freeze: !frozenRegistrations });
      frozenRegistrations = !frozenRegistrations;
      showMessage($('message'), res.message);
      loadSettings();
    } catch (e) {
      showMessage($('message'), 'Failed to toggle registrations', 'error');
    }
  });

  // ===== Chat Moderation =====
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
    searchMode: false
  };

  function roleLabel(role) {
    if (role === 'admin') return 'Admin';
    if (role === 'organizer') return 'Organizer';
    return 'Student';
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
    if (!msg.is_deleted) {
      actions.push(`<button type="button" class="btn btn-danger btn-sm" data-ban="${msg.sender_id}">Ban user</button>`);
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
    if (!threads.length) {
      el.innerHTML = '<p class="muted">No chats available.</p>';
      return;
    }
    el.innerHTML = threads.map(t => {
      const active = t.id === chatState.activeThreadId ? 'active' : '';
      const label = t.type === 'club' ? 'Club' : 'Event';
      const meta = t.last_message_at ? formatDateTime(t.last_message_at) : 'No messages yet';
      return `<div class="chat-thread-item ${active}" data-thread-id="${t.id}">
        <div class="chat-thread-title">${escapeHtml(t.title || `${label} chat`)}</div>
        <div class="chat-thread-meta">${label} • ${escapeHtml(meta)}</div>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-thread-id]').forEach(item => {
      item.addEventListener('click', () => {
        const id = parseInt(item.dataset.threadId, 10);
        if (!id) return;
        setActiveThread(id);
      });
    });
  }

  function setActiveThread(threadId) {
    chatState.activeThreadId = threadId;
    chatState.searchMode = false;
    renderChatThreads();
    loadChatThread(threadId);
  }

  async function loadChatThreads() {
    const el = $('chatThreads');
    if (!el) return;
    if (!chatState.threads.length) el.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const r = await get('/api/chat/threads');
      if (r.success) {
        chatState.threads = r.threads || [];
        renderChatThreads();
      }
    } catch (e) {
      el.innerHTML = '<p class="muted">Could not load chats.</p>';
    }
  }

  async function loadChatThread(threadId) {
    if (!threadId) return;
    const el = $('chatMessages');
    if (el) el.innerHTML = '<p class="muted">Loading messages…</p>';
    try {
      const r = await get('/api/chat/threads/' + threadId);
      if (!r.success) {
        if (el) el.innerHTML = '<p class="muted">Could not load messages.</p>';
        return;
      }
      chatState.permissions = r.permissions || {};
      chatState.messages = r.messages || [];
      chatState.pinned = r.pinned || [];
      chatState.ban = r.ban || null;

      const title = r.thread?.title || 'Chat';
      $('chatTitle').textContent = title;
      $('chatMeta').textContent = r.thread?.type === 'club' ? 'Club chat' : 'Event chat';

      const banNotice = $('chatBanNotice');
      if (chatState.ban && banNotice) {
        const until = chatState.ban.end_at ? `until ${formatDateTime(chatState.ban.end_at)}` : 'until an admin unbans you';
        banNotice.textContent = `Chat disabled ${until}.`;
        banNotice.style.display = 'block';
      } else if (banNotice) {
        banNotice.style.display = 'none';
      }

      const canPost = chatState.permissions.canPost && !chatState.ban;
      $('chatInput').disabled = !canPost;
      $('chatSendBtn').disabled = !canPost;

      const announceWrap = $('chatAnnouncementWrap');
      if (announceWrap) {
        announceWrap.style.display = chatState.permissions.canAnnounce ? 'inline-flex' : 'none';
      }
      if (!chatState.permissions.canAnnounce) {
        $('chatAnnouncement').checked = false;
      }

      const panelActions = $('chatPanelActions');
      if (panelActions) {
        panelActions.innerHTML = `<button type="button" class="btn btn-danger btn-sm" id="chatDeleteThread">Delete Thread</button>`;
        panelActions.querySelector('#chatDeleteThread')?.addEventListener('click', async () => {
          if (!confirm('Delete this entire thread?')) return;
          const res = await del(`/api/chat/threads/${threadId}`);
          if (!res.success) {
            alert(res.message || 'Could not delete thread.');
            return;
          }
          chatState.activeThreadId = null;
          $('chatTitle').textContent = 'Select a chat';
          $('chatMessages').innerHTML = '<p class="muted">No chat selected.</p>';
          loadChatThreads();
        });
      }

      renderPinnedMessages(chatState.pinned);
      renderChatMessages(chatState.messages);

      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    } catch (e) {
      if (el) el.innerHTML = '<p class="muted">Could not load messages.</p>';
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
      const res = await post(`/api/chat/threads/${chatState.activeThreadId}/messages`, {
        body,
        parentId: chatState.replyTo?.id || null,
        is_announcement: $('chatAnnouncement')?.checked || false
      });
      if (!res.success) {
        alert(res.message || 'Failed to send message.');
        if (res.ban) {
          loadChatThread(chatState.activeThreadId);
        }
        return;
      }
      input.value = '';
      $('chatAnnouncement').checked = false;
      clearReply();
      loadChatThread(chatState.activeThreadId);
    } catch (_) {
      alert('Request failed.');
    }
  }

  async function banUser(userId) {
    if (!userId) return;
    if (!confirm('Ban this user from chat?')) return;
    const duration = prompt('Ban duration in hours (leave blank for permanent):');
    let payload = { userId };
    if (duration && duration.trim()) {
      const hours = parseInt(duration, 10);
      if (isNaN(hours) || hours <= 0) {
        alert('Duration must be a positive number.');
        return;
      }
      payload.durationHours = hours;
    } else {
      payload.permanent = true;
    }
    const reason = prompt('Reason (optional):');
    if (reason) payload.reason = reason;
    const res = await post('/api/admin/chat/ban', payload);
    if (!res.success) {
      alert(res.message || 'Ban failed.');
      return;
    }
    loadChatBans();
  }

  function wireChatMessageActions() {
    const container = $('chatMessages');
    if (!container) return;
    container.querySelectorAll('[data-vote]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const vote = btn.dataset.vote;
        const messageId = parseInt(btn.dataset.messageId, 10);
        if (!messageId) return;
        const res = await post(`/api/chat/messages/${messageId}/vote`, { vote });
        if (!res.success) {
          alert(res.message || 'Could not vote.');
        }
        loadChatThread(chatState.activeThreadId);
      });
    });

    container.querySelectorAll('[data-reply]').forEach(btn => {
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
        loadChatThread(chatState.activeThreadId);
      });
    });

    container.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = parseInt(btn.dataset.delete, 10);
        if (!messageId) return;
        if (!confirm('Delete this message?')) return;
        const res = await del(`/api/chat/messages/${messageId}`);
        if (!res.success) {
          alert(res.message || 'Could not delete message.');
        }
        loadChatThread(chatState.activeThreadId);
      });
    });

    container.querySelectorAll('[data-pin]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = parseInt(btn.dataset.pin, 10);
        if (!messageId) return;
        const res = await post(`/api/chat/threads/${chatState.activeThreadId}/pins`, { messageId });
        if (!res.success) alert(res.message || 'Could not pin.');
        loadChatThread(chatState.activeThreadId);
      });
    });

    container.querySelectorAll('[data-unpin]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const messageId = parseInt(btn.dataset.unpin, 10);
        if (!messageId) return;
        const res = await del(`/api/chat/threads/${chatState.activeThreadId}/pins/${messageId}`);
        if (!res.success) alert(res.message || 'Could not unpin.');
        loadChatThread(chatState.activeThreadId);
      });
    });

    container.querySelectorAll('[data-ban]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = parseInt(btn.dataset.ban, 10);
        await banUser(userId);
      });
    });

    container.querySelectorAll('[data-toggle-replies]').forEach(btn => {
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
    const res = await get(`/api/chat/threads/${chatState.activeThreadId}/search?q=${encodeURIComponent(query)}`);
    if (!res.success) {
      alert(res.message || 'Search failed.');
      return;
    }
    chatState.searchMode = true;
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
    }
  }

  async function loadChatBans() {
    const el = $('chatBansList');
    if (!el) return;
    try {
      const res = await get('/api/admin/chat/bans');
      if (!res.success) {
        el.innerHTML = '<p class="muted">Could not load bans.</p>';
        return;
      }
      const bans = res.bans || [];
      if (!bans.length) {
        el.innerHTML = '<p class="muted">No active bans.</p>';
        return;
      }
      el.innerHTML = bans.map(b => {
        const name = b.full_name || b.email || 'User';
        const until = b.end_at ? formatDateTime(b.end_at) : 'Manual unban required';
        return `<div class="item-row">
          <div>
            <h4>${escapeHtml(name)}</h4>
            <p class="meta">Reason: ${escapeHtml(b.reason || '—')} • Until: ${escapeHtml(until)}</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-unban="${b.user_id}">Unban</button>
        </div>`;
      }).join('');
      el.querySelectorAll('[data-unban]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const userId = parseInt(btn.dataset.unban, 10);
          const res = await post('/api/admin/chat/unban', { userId });
          if (!res.success) {
            alert(res.message || 'Unban failed.');
            return;
          }
          loadChatBans();
        });
      });
    } catch (e) {
      el.innerHTML = '<p class="muted">Could not load bans.</p>';
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

  // ===== Modals =====
  function showModal(id) {
    $(id).style.display = 'flex';
  }

  function closeModal(id) {
    $(id).style.display = 'none';
  }

  qsa('.modal-close').forEach(btn => {
    btn.addEventListener('click', function () {
      const modal = this.dataset.modal;
      if (modal) closeModal(modal);
    });
  });

  qsa('.modal').forEach(modal => {
    modal.addEventListener('click', function (e) {
      if (e.target === this) closeModal(this.id);
    });
  });

  $('confirmNo')?.addEventListener('click', () => closeModal('confirmModal'));

  // ===== Helpers =====
  function debounce(fn, delay) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ===== Init =====
  async function init() {
    const u = await hydrateUser();
    if (!u || !u.id || u.role !== 'admin') {
      redirectLogin();
      return;
    }
    $('userName').textContent = u.email.split('@')[0];
    $('userAvatar').textContent = u.email[0].toUpperCase();

    loadDashboard();
    loadUsers();
    loadEvents();
    loadSettings();
    loadLogs();
    initChatUi();
    loadChatThreads();
    loadChatBans();
    setInterval(() => {
      if (chatState.activeThreadId && !chatState.searchMode) {
        loadChatThread(chatState.activeThreadId);
      }
    }, 15000);
    setInterval(() => {
      loadChatThreads();
      loadChatBans();
    }, 30000);
  }

  init();
})();
