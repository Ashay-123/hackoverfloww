(function () {
  'use strict';

  const API = '';
  let currentUserId = null;
  let currentEventId = null;
  let currentResourceId = null;
  let currentClubId = null;
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
    if (h === 'resources') loadResources();
    if (h === 'bookings') loadBookings();
    if (h === 'clubs') loadClubs();
    if (h === 'analytics') loadAnalytics();
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
      const dateRange = e.end_date && e.end_date !== e.event_date
        ? `${formatDate(e.event_date)} - ${formatDate(e.end_date)}`
        : formatDate(e.event_date);
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
          <div><strong>Date:</strong> ${dateRange} ${e.start_time} - ${e.end_time}</div>
          <div><strong>Location:</strong> ${escapeHtml(e.location || e.online_link || 'TBD')}</div>
          <div><strong>Visibility:</strong> ${escapeHtml(e.visibility || 'public')}</div>
          <div><strong>Budget:</strong> ${e.budget_used || 0} / ${e.budget_total || 0} ${escapeHtml(e.budget_currency || '')}</div>
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
    const dateRange = event.end_date && event.end_date !== event.event_date
      ? `${formatDate(event.event_date)} - ${formatDate(event.end_date)}`
      : formatDate(event.event_date);
    $('eventModalTitle').textContent = event.title;
    $('eventModalBody').innerHTML = `
      <div class="event-card-meta">
        <div><strong>Status:</strong> <span class="status ${event.status}">${event.status}</span></div>
        <div><strong>Organizer:</strong> ${escapeHtml(event.organizer_name || event.organizer_email)}</div>
        <div><strong>Date:</strong> ${dateRange}</div>
        <div><strong>Time:</strong> ${event.start_time} - ${event.end_time}</div>
        <div><strong>Location:</strong> ${escapeHtml(event.location || event.online_link || 'TBD')}</div>
        <div><strong>Visibility:</strong> ${escapeHtml(event.visibility || 'public')}</div>
        <div><strong>Max Participants:</strong> ${event.max_participants === 0 ? 'Unlimited' : event.max_participants}</div>
        <div><strong>Budget:</strong> ${event.budget_used || 0} / ${event.budget_total || 0} ${escapeHtml(event.budget_currency || '')}</div>
      </div>
      <p class="muted" style="margin-top: 16px;">${escapeHtml(event.description || '')}</p>
      ${event.rejection_reason ? '<p class="muted" style="color: var(--error);"><strong>Rejection Reason:</strong> ' + escapeHtml(event.rejection_reason) + '</p>' : ''}
    `;
    showModal('eventModal');
  }

  $('refreshEvents')?.addEventListener('click', loadEvents);
  $('eventSearch')?.addEventListener('input', debounce(loadEvents, 500));
  $('eventStatusFilter')?.addEventListener('change', loadEvents);

  // ===== Resource Management =====
  async function loadResources() {
    const list = $('resourcesListAdmin');
    if (list) list.innerHTML = '<p class="muted">Loading resources...</p>';
    try {
      const res = await get('/api/admin/resources');
      if (!res.success) throw new Error(res.message || 'Failed');
      renderResources(res.resources || []);
    } catch (e) {
      if (list) list.innerHTML = '<p class="muted">Could not load resources.</p>';
      console.error('Error loading resources:', e);
    }
  }

  function renderResources(resources) {
    const list = $('resourcesListAdmin');
    if (!list) return;
    if (!resources.length) {
      list.innerHTML = '<p class="muted">No resources found.</p>';
      return;
    }
    list.innerHTML = resources.map(r => `
      <div class="item-row" data-resource-row="${r.id}">
        <div>
          <h4>${escapeHtml(r.name)}</h4>
          <p class="meta">${escapeHtml(r.category)} ${r.requires_approval ? '• approval required' : '• auto-approved'}</p>
        </div>
        <div class="item-actions">
          <button type="button" class="btn btn-ghost" data-resource-edit="${r.id}">Edit</button>
          <button type="button" class="btn btn-danger" data-resource-delete="${r.id}">Delete</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-resource-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = resources.find(x => x.id === parseInt(btn.dataset.resourceEdit, 10));
        if (!r) return;
        currentResourceId = r.id;
        $('resourceId').value = r.id;
        $('resourceName').value = r.name || '';
        $('resourceCategory').value = r.category || 'room';
        $('resourceDescription').value = r.description || '';
        $('resourceTypeId').value = r.type_id || '';
        $('resourceRequiresApproval').checked = !!r.requires_approval;
      });
    });
    list.querySelectorAll('[data-resource-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this resource?')) return;
        try {
          await del(`/api/admin/resources/${btn.dataset.resourceDelete}`);
          showMessage($('resourceMessage'), 'Resource deleted');
          loadResources();
        } catch (e) {
          showMessage($('resourceMessage'), 'Failed to delete resource', 'error');
        }
      });
    });
  }

  $('resourceForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const body = {
      name: $('resourceName').value.trim(),
      category: $('resourceCategory').value,
      description: $('resourceDescription').value.trim(),
      type_id: $('resourceTypeId').value ? parseInt($('resourceTypeId').value, 10) : null,
      requires_approval: $('resourceRequiresApproval').checked
    };
    try {
      if (currentResourceId) {
        await put(`/api/admin/resources/${currentResourceId}`, body);
        showMessage($('resourceMessage'), 'Resource updated');
      } else {
        await post('/api/admin/resources', body);
        showMessage($('resourceMessage'), 'Resource created');
      }
      this.reset();
      currentResourceId = null;
      $('resourceId').value = '';
      loadResources();
    } catch (e) {
      showMessage($('resourceMessage'), 'Failed to save resource', 'error');
    }
  });

  $('resourceReset')?.addEventListener('click', function () {
    currentResourceId = null;
    $('resourceForm')?.reset();
    $('resourceId').value = '';
  });

  // ===== Booking Approvals =====
  async function loadBookings() {
    const list = $('bookingList');
    if (list) list.innerHTML = '<p class="muted">Loading bookings...</p>';
    const params = new URLSearchParams();
    const q = $('bookingSearch')?.value.trim();
    const status = $('bookingStatusFilter')?.value;
    if (q) params.append('q', q);
    if (status) params.append('status', status);
    try {
      const res = await get('/api/admin/resource-bookings?' + params.toString());
      if (!res.success) throw new Error(res.message || 'Failed');
      renderBookings(res.bookings || []);
    } catch (e) {
      if (list) list.innerHTML = '<p class="muted">Could not load bookings.</p>';
      console.error('Error loading bookings:', e);
    }
  }

  function renderBookings(bookings) {
    const list = $('bookingList');
    if (!list) return;
    if (!bookings.length) {
      list.innerHTML = '<p class="muted">No bookings found.</p>';
      return;
    }
    list.innerHTML = bookings.map(b => {
      const actions = [];
      if (b.status === 'pending') {
        actions.push(`<button type="button" class="btn btn-primary" data-booking-approve="${b.id}">Approve</button>`);
        actions.push(`<button type="button" class="btn btn-danger" data-booking-reject="${b.id}">Reject</button>`);
      }
      if (b.status === 'approved') {
        actions.push(`<button type="button" class="btn btn-ghost" data-booking-complete="${b.id}">Complete</button>`);
        actions.push(`<button type="button" class="btn btn-danger" data-booking-cancel="${b.id}">Cancel</button>`);
      }
      return `<div class="item-row">
        <div>
          <h4>${escapeHtml(b.resource_name)} <span class="status ${b.status}">${b.status}</span></h4>
          <p class="meta">${escapeHtml(b.full_name || b.email || '')} • ${formatDateTime(b.start_datetime)} → ${formatDateTime(b.end_datetime)}</p>
        </div>
        <div class="item-actions">${actions.join('')}</div>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-booking-approve]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await put(`/api/admin/resource-bookings/${btn.dataset.bookingApprove}/approve`, {});
          showMessage($('bookingMessage'), 'Booking approved');
          loadBookings();
        } catch (e) {
          showMessage($('bookingMessage'), 'Failed to approve booking', 'error');
        }
      });
    });
    list.querySelectorAll('[data-booking-reject]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reason = prompt('Rejection reason (optional):');
        try {
          await put(`/api/admin/resource-bookings/${btn.dataset.bookingReject}/reject`, { reason });
          showMessage($('bookingMessage'), 'Booking rejected');
          loadBookings();
        } catch (e) {
          showMessage($('bookingMessage'), 'Failed to reject booking', 'error');
        }
      });
    });
    list.querySelectorAll('[data-booking-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Cancel this booking?')) return;
        try {
          await put(`/api/admin/resource-bookings/${btn.dataset.bookingCancel}/cancel`, {});
          showMessage($('bookingMessage'), 'Booking cancelled');
          loadBookings();
        } catch (e) {
          showMessage($('bookingMessage'), 'Failed to cancel booking', 'error');
        }
      });
    });
    list.querySelectorAll('[data-booking-complete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await put(`/api/admin/resource-bookings/${btn.dataset.bookingComplete}/complete`, {});
          showMessage($('bookingMessage'), 'Booking completed');
          loadBookings();
        } catch (e) {
          showMessage($('bookingMessage'), 'Failed to complete booking', 'error');
        }
      });
    });
  }

  $('refreshBookings')?.addEventListener('click', loadBookings);
  $('bookingSearch')?.addEventListener('input', debounce(loadBookings, 500));
  $('bookingStatusFilter')?.addEventListener('change', loadBookings);

  // ===== Clubs =====
  async function loadClubs() {
    const list = $('clubsListAdmin');
    if (list) list.innerHTML = '<p class="muted">Loading clubs...</p>';
    try {
      const res = await get('/api/admin/clubs');
      if (!res.success) throw new Error(res.message || 'Failed');
      renderClubs(res.clubs || []);
    } catch (e) {
      if (list) list.innerHTML = '<p class="muted">Could not load clubs.</p>';
      console.error('Error loading clubs:', e);
    }
  }

  function renderClubs(clubs) {
    const list = $('clubsListAdmin');
    if (!list) return;
    if (!clubs.length) {
      list.innerHTML = '<p class="muted">No clubs found.</p>';
      return;
    }
    list.innerHTML = clubs.map(c => `
      <div class="item-row" data-club-row="${c.id}">
        <div>
          <h4>${escapeHtml(c.name)} <span class="muted">(${c.type})</span></h4>
          <p class="meta">${escapeHtml(c.slug)} • ${c.member_count || 0} members</p>
        </div>
        <div class="item-actions">
          <button type="button" class="btn btn-ghost" data-club-members="${c.id}">Members</button>
          <button type="button" class="btn btn-ghost" data-club-edit="${c.id}">Edit</button>
          <button type="button" class="btn btn-danger" data-club-delete="${c.id}">Delete</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('[data-club-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = clubs.find(x => x.id === parseInt(btn.dataset.clubEdit, 10));
        if (!c) return;
        currentClubId = c.id;
        $('clubId').value = c.id;
        $('clubName').value = c.name || '';
        $('clubSlug').value = c.slug || '';
        $('clubType').value = c.type || 'club';
        $('clubDescription').value = c.description || '';
        $('clubLogo').value = c.logo_url || '';
      });
    });
    list.querySelectorAll('[data-club-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this club?')) return;
        try {
          await del(`/api/admin/clubs/${btn.dataset.clubDelete}`);
          showMessage($('clubMessage'), 'Club deleted');
          loadClubs();
        } catch (e) {
          showMessage($('clubMessage'), 'Failed to delete club', 'error');
        }
      });
    });
    list.querySelectorAll('[data-club-members]').forEach(btn => {
      btn.addEventListener('click', () => openClubMembers(parseInt(btn.dataset.clubMembers, 10)));
    });
  }

  $('clubForm')?.addEventListener('submit', async function (e) {
    e.preventDefault();
    const body = {
      name: $('clubName').value.trim(),
      slug: $('clubSlug').value.trim(),
      type: $('clubType').value,
      description: $('clubDescription').value.trim(),
      logo_url: $('clubLogo').value.trim()
    };
    try {
      if (currentClubId) {
        await put(`/api/admin/clubs/${currentClubId}`, body);
        showMessage($('clubMessage'), 'Club updated');
      } else {
        await post('/api/admin/clubs', body);
        showMessage($('clubMessage'), 'Club created');
      }
      this.reset();
      currentClubId = null;
      $('clubId').value = '';
      loadClubs();
    } catch (e) {
      showMessage($('clubMessage'), 'Failed to save club', 'error');
    }
  });

  $('clubReset')?.addEventListener('click', function () {
    currentClubId = null;
    $('clubForm')?.reset();
    $('clubId').value = '';
  });

  async function openClubMembers(clubId) {
    currentClubId = clubId;
    $('clubMembersTitle').textContent = `Club Members (#${clubId})`;
    showModal('clubMembersModal');
    await loadClubMembers(clubId);
  }

  async function loadClubMembers(clubId) {
    const list = $('clubMembersList');
    if (list) list.innerHTML = '<p class="muted">Loading members...</p>';
    try {
      const res = await get(`/api/admin/clubs/${clubId}/members`);
      if (!res.success) throw new Error(res.message || 'Failed');
      list.innerHTML = res.members.length ? res.members.map(m => `
        <div class="item-row">
          <div>
            <strong>${escapeHtml(m.full_name || m.email)}</strong>
            <span class="muted">• ${escapeHtml(m.role)}</span>
          </div>
          <div class="item-actions">
            <select data-member-role="${m.user_id}" class="filter-select">
              <option value="member" ${m.role === 'member' ? 'selected' : ''}>Member</option>
              <option value="coordinator" ${m.role === 'coordinator' ? 'selected' : ''}>Coordinator</option>
              <option value="head" ${m.role === 'head' ? 'selected' : ''}>Head</option>
            </select>
            <button type="button" class="btn btn-danger" data-member-remove="${m.user_id}">Remove</button>
          </div>
        </div>
      `).join('') : '<p class="muted">No members.</p>';

      list.querySelectorAll('[data-member-role]').forEach(sel => {
        sel.addEventListener('change', async () => {
          try {
            await put(`/api/admin/clubs/${clubId}/members/${sel.dataset.memberRole}`, { role: sel.value });
            showMessage($('clubMessage'), 'Member role updated');
          } catch (e) {
            showMessage($('clubMessage'), 'Failed to update role', 'error');
          }
        });
      });
      list.querySelectorAll('[data-member-remove]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Remove this member?')) return;
          try {
            await del(`/api/admin/clubs/${clubId}/members/${btn.dataset.memberRemove}`);
            showMessage($('clubMessage'), 'Member removed');
            loadClubMembers(clubId);
          } catch (e) {
            showMessage($('clubMessage'), 'Failed to remove member', 'error');
          }
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="muted">Could not load members.</p>';
    }
  }

  $('addClubMemberBtn')?.addEventListener('click', async () => {
    const userId = parseInt($('clubMemberUserId').value, 10);
    const role = $('clubMemberRole').value;
    if (!currentClubId || !userId) return alert('Enter a user ID');
    try {
      await post(`/api/admin/clubs/${currentClubId}/members`, { userId, role });
      $('clubMemberUserId').value = '';
      showMessage($('clubMessage'), 'Member added');
      loadClubMembers(currentClubId);
    } catch (e) {
      showMessage($('clubMessage'), 'Failed to add member', 'error');
    }
  });

  // ===== Analytics =====
  async function loadAnalytics() {
    try {
      const res = await get('/api/admin/analytics');
      if (!res.success) return;
      const { participation, clubActivity, resourceUtilization, budget } = res.analytics;
      $('analyticsParticipation').innerHTML = participation.length
        ? '<ul class="list">' + participation.map(p => `<li>${escapeHtml(p.month)} • ${p.registrations} registrations</li>`).join('') + '</ul>'
        : '<span class="empty">No data</span>';
      $('analyticsClubs').innerHTML = clubActivity.length
        ? '<ul class="list">' + clubActivity.map(c => `<li>${escapeHtml(c.name)} • ${c.events} events • ${c.registrations} regs</li>`).join('') + '</ul>'
        : '<span class="empty">No data</span>';
      $('analyticsResources').innerHTML = resourceUtilization.length
        ? '<ul class="list">' + resourceUtilization.map(r => `<li>${escapeHtml(r.name)} • ${Number(r.hours_booked).toFixed(1)} hrs</li>`).join('') + '</ul>'
        : '<span class="empty">No data</span>';
      $('analyticsBudget').innerHTML = `<p class="muted">Total budget: ${budget.total_budget} • Used: ${budget.used_budget}</p>`;
    } catch (e) {
      console.error('Error loading analytics:', e);
    }
  }

  qsa('[data-export]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const type = btn.dataset.export;
      const urlMap = {
        events: '/api/admin/export/events.csv',
        resources: '/api/admin/export/resources.csv',
        bookings: '/api/admin/export/bookings.csv',
        analytics: '/api/admin/export/analytics.xlsx'
      };
      const url = urlMap[type];
      if (!url) return;
      try {
        const res = await fetch(url, { credentials: 'include' });
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = window.URL.createObjectURL(blob);
        link.download = type === 'analytics' ? 'analytics.xlsx' : `${type}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } catch (e) {
        alert('Export failed');
      }
    });
  });

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
  function init() {
    const u = getUser();
    if (!u || !u.id || u.role !== 'admin') {
      redirectLogin();
      return;
    }
    $('userName').textContent = u.email.split('@')[0];
    $('userAvatar').textContent = u.email[0].toUpperCase();

    loadDashboard();
    loadUsers();
    loadEvents();
    loadResources();
    loadBookings();
    loadClubs();
    loadAnalytics();
    loadSettings();
    loadLogs();
  }

  init();
})();
