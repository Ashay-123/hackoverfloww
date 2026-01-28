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
  }

  init();
})();
