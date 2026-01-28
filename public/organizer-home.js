(function () {
  'use strict';

  const API = '';
  let user = null;
  let currentEventId = null;
  let clubRoleMap = {};
  let selectedThreadId = null;
  let clubOptions = [];

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
    if (u.role === 'participant') return (window.location.href = '/student-home');
    if (u.role === 'organizer') return;
    return redirectLogin();
  }

  function headers() {
    return { 'Content-Type': 'application/json' };
  }

  function get(url) {
    return fetch(API + url, { 
      credentials: 'include',
      headers: headers() 
    }).then(r => {
      if (!r.ok && r.status === 401) {
        redirectLogin();
        throw new Error('Unauthorized');
      }
      return r.json();
    });
  }

  function post(url, body) {
    return fetch(API + url, { 
      method: 'POST', 
      credentials: 'include',
      headers: headers(), 
      body: JSON.stringify(body) 
    }).then(r => {
      if (!r.ok && r.status === 401) {
        redirectLogin();
        throw new Error('Unauthorized');
      }
      return r.json();
    });
  }

  function put(url, body) {
    return fetch(API + url, { 
      method: 'PUT', 
      credentials: 'include',
      headers: headers(), 
      body: JSON.stringify(body) 
    }).then(r => {
      if (!r.ok && r.status === 401) {
        redirectLogin();
        throw new Error('Unauthorized');
      }
      return r.json();
    });
  }

  function del(url) {
    return fetch(API + url, { 
      method: 'DELETE', 
      credentials: 'include',
      headers: headers() 
    }).then(r => {
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
      if (key === 'myevents') loadMyEvents();
      if (key === 'create') resetEventForm();
      if (key === 'catalog') loadResources();
      if (key === 'mybookings') loadBookings();
      if (key === 'bookform') loadResourceOptions();
    });
  });

  // ---------- Profile ----------
  function renderProfile(u, p) {
    const name = p?.full_name || u?.email?.split('@')[0] || 'Organizer';
    const dept = p?.department || '—';
    const initial = (name[0] || 'O').toUpperCase();

    $('userName').textContent = name;
    $('userAvatar').textContent = initial;
    $('ppAvatar').textContent = initial;
    $('ppName').textContent = name;
    $('ppDept').textContent = dept;

    $('pFullName').value = p?.full_name || '';
    $('pDepartment').value = p?.department || '';
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
      const heads = r.headsOrCoords || [];
      const el = $('profileHeads');
      if (el) {
        el.innerHTML = heads.length
          ? '<ul class="list">' + heads.map(c => '<li>' + escapeHtml(c.name) + ' — ' + (c.membership_role === 'head' ? 'Head' : 'Coordinator') + '</li>').join('') + '</ul>'
          : '<span class="empty">Not head/coordinator of any club.</span>';
      }
    });
  }

  function loadClubOptions() {
    get('/api/profile/clubs').then(r => {
      if (!r.success) return;
      clubOptions = r.headsOrCoords || [];
      const select = $('eClubs');
      const chatSelect = $('clubChatSelect');
      if (select) {
        select.innerHTML = clubOptions.length
          ? clubOptions.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.type})</option>`).join('')
          : '<option value="">No clubs available</option>';
      }
      if (chatSelect) {
        chatSelect.innerHTML = clubOptions.length
          ? '<option value="">Select club</option>' + clubOptions.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
          : '<option value="">No clubs</option>';
      }
      renderClubRoles();
    });
  }

  function loadEventChatOptions() {
    const select = $('eventChatSelect');
    if (!select) return;
    get('/api/organizer/events').then(r => {
      const arr = r.events || [];
      select.innerHTML = arr.length
        ? '<option value="">Select event</option>' + arr.map(e => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join('')
        : '<option value="">No events</option>';
    });
  }

  function renderClubRoles() {
    const list = $('clubRoleList');
    if (!list) return;
    const selectedIds = Array.from($('eClubs')?.selectedOptions || []).map(o => parseInt(o.value, 10)).filter(Boolean);
    if (!selectedIds.length) {
      list.innerHTML = '<span class="empty">No collaborating clubs selected.</span>';
      return;
    }
    list.innerHTML = selectedIds.map(id => {
      const club = clubOptions.find(c => c.id === id);
      const currentRole = clubRoleMap[id] || 'host';
      return `<div class="item-row" style="align-items:center;">
        <div><strong>${escapeHtml(club?.name || 'Club')}</strong></div>
        <div>
          <select data-club-role="${id}" class="filter-select">
            <option value="host" ${currentRole === 'host' ? 'selected' : ''}>Host</option>
            <option value="co-host" ${currentRole === 'co-host' ? 'selected' : ''}>Co-host</option>
            <option value="partner" ${currentRole === 'partner' ? 'selected' : ''}>Partner</option>
          </select>
        </div>
      </div>`;
    }).join('');

    list.querySelectorAll('[data-club-role]').forEach(sel => {
      sel.addEventListener('change', function () {
        const cid = parseInt(this.dataset.clubRole, 10);
        clubRoleMap[cid] = this.value;
      });
    });
  }

  // ---------- Dashboard: My clubs ----------
  function loadMyClubsDashboard() {
    get('/api/profile/clubs').then(r => {
      const list = $('myClubsList');
      if (!list) return;
      const heads = (r.headsOrCoords || []);
      if (!heads.length) { list.innerHTML = '<span class="empty">Not head/coordinator of any club.</span>'; return; }
      list.innerHTML = '<ul class="list">' + heads.slice(0, 5).map(c =>
        '<li>' + escapeHtml(c.name) + ' <span class="muted">• ' + (c.membership_role === 'head' ? 'Head' : 'Coordinator') + '</span></li>'
      ).join('') + '</ul>';
    });
  }

  // ---------- Events: My events ----------
  let allEvents = [];
  let currentMode = 'inperson';

  function loadMyEvents() {
    const el = $('myEventsList');
    if (!el) return;
    el.innerHTML = '<p class="muted">Loading events...</p>';
    
    get('/api/organizer/events').then(r => {
      allEvents = Array.isArray(r.events) ? r.events : [];
      renderEvents();
      loadEventChatOptions();
    }).catch(err => {
      console.error('Error loading events:', err);
      showMessage('Failed to load events. Please refresh.', 'error');
      el.innerHTML = '<p class="muted">Could not load events.</p>';
    });
  }

  function renderEvents() {
    const el = $('myEventsList');
    if (!el) return;
    
    const filter = $('statusFilter')?.value || '';
    let filtered = allEvents;
    if (filter) {
      filtered = allEvents.filter(e => e.status === filter);
    }
    
    if (!filtered.length) {
      el.innerHTML = '<p class="muted">No events found. Create your first event!</p>';
      return;
    }
    
    el.innerHTML = filtered.map(e => {
      const date = e.end_date && e.end_date !== e.event_date
        ? `${formatDate(e.event_date)} - ${formatDate(e.end_date)}`
        : formatDate(e.event_date);
      const timeRange = e.start_time && e.end_time ? `${e.start_time} - ${e.end_time}` : '';
      const location = e.location || e.online_link || 'TBD';
      const locationType = e.location ? '📍 In-person' : '🌐 Online';
      const maxParts = e.max_participants === 0 ? 'Unlimited' : e.max_participants;
      const status = e.status || 'draft';
      
      const actions = [];
      if (status === 'draft' || status === 'rejected') {
        actions.push(`<button type="button" class="btn btn-sm btn-ghost" data-edit="${e.id}">Edit</button>`);
        actions.push(`<button type="button" class="btn btn-sm btn-danger" data-delete="${e.id}">Delete</button>`);
        actions.push(`<button type="button" class="btn btn-sm btn-primary" data-publish="${e.id}">Publish</button>`);
      }
      if (status === 'pending_approval') {
        actions.push(`<button type="button" class="btn btn-sm btn-ghost" data-edit="${e.id}">Edit</button>`);
        actions.push(`<button type="button" class="btn btn-sm btn-danger" data-delete="${e.id}">Delete</button>`);
      }
      if (status === 'published') {
        actions.push(`<button type="button" class="btn btn-sm btn-secondary" data-close="${e.id}">Close</button>`);
        actions.push(`<button type="button" class="btn btn-sm btn-ghost" data-complete="${e.id}">Complete</button>`);
      }
      if (status === 'closed') {
        actions.push(`<button type="button" class="btn btn-sm btn-ghost" data-complete="${e.id}">Complete</button>`);
      }
      actions.push(`<button type="button" class="btn btn-sm btn-ghost" data-duplicate="${e.id}">Duplicate</button>`);
      
      return `<div class="event-card">
        <div class="event-header">
          <h4>${escapeHtml(e.title)}</h4>
          <span class="status ${status}">${status}</span>
        </div>
        <div class="event-body">
          <p class="event-desc">${escapeHtml(e.description || '')}</p>
          <div class="event-meta">
            <div><strong>Date:</strong> ${date}</div>
            <div><strong>Time:</strong> ${timeRange}</div>
            <div><strong>Mode:</strong> ${locationType}</div>
            <div><strong>Location:</strong> ${escapeHtml(location)}</div>
            <div><strong>Max Participants:</strong> ${maxParts}</div>
            <div><strong>Visibility:</strong> ${escapeHtml(e.visibility || 'public')}</div>
            <div><strong>Budget:</strong> ${e.budget_used || 0} / ${e.budget_total || 0} ${escapeHtml(e.budget_currency || '')}</div>
            ${e.registration_deadline ? `<div><strong>Reg. Deadline:</strong> ${formatDateTime(e.registration_deadline)}</div>` : ''}
          </div>
        </div>
        <div class="event-actions">${actions.join('')}</div>
      </div>`;
    }).join('');
    
    // Attach event listeners
    el.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => editEvent(parseInt(btn.dataset.edit, 10)));
    });
    el.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteEvent(parseInt(btn.dataset.delete, 10)));
    });
    el.querySelectorAll('[data-publish]').forEach(btn => {
      btn.addEventListener('click', () => publishEvent(parseInt(btn.dataset.publish, 10)));
    });
    el.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => closeEvent(parseInt(btn.dataset.close, 10)));
    });
    el.querySelectorAll('[data-complete]').forEach(btn => {
      btn.addEventListener('click', () => completeEvent(parseInt(btn.dataset.complete, 10)));
    });
    el.querySelectorAll('[data-duplicate]').forEach(btn => {
      btn.addEventListener('click', () => duplicateEvent(parseInt(btn.dataset.duplicate, 10)));
    });
  }

  $('statusFilter')?.addEventListener('change', renderEvents);

  function loadEventsStats() {
    get('/api/organizer/events').then(r => {
      const arr = Array.isArray(r.events) ? r.events : [];
      const stats = { draft: 0, pending_approval: 0, published: 0, closed: 0, rejected: 0, completed: 0 };
      arr.forEach(e => {
        const s = e.status || 'draft';
        if (stats[s] !== undefined) stats[s]++;
      });
      if ($('statDraft')) $('statDraft').textContent = stats.draft;
      if ($('statPending')) $('statPending').textContent = stats.pending_approval;
      if ($('statApproved')) $('statApproved').textContent = stats.published;
      if ($('statCompleted')) $('statCompleted').textContent = stats.closed + stats.rejected + stats.completed;
    });
  }

  // ---------- Events: Form handling ----------
  function resetEventForm() {
    $('eventForm')?.reset();
    $('eventId').value = '';
    $('formTitle').textContent = 'Create New Event';
    $('cancelBtn').style.display = 'none';
    $('saveDraftBtn').textContent = 'Save Draft';
    $('publishBtn').style.display = 'inline-flex';
    currentMode = 'inperson';
    updateModeFields();
    $('eVisibility').value = 'public';
    if ($('eClubs')) Array.from($('eClubs').options || []).forEach(o => { o.selected = false; });
    clubRoleMap = {};
    renderClubRoles();
    clearErrors();
  }

  function updateModeFields() {
    const locationField = $('locationField');
    const onlineField = $('onlineField');
    if (currentMode === 'inperson') {
      locationField.style.display = 'block';
      onlineField.style.display = 'none';
      $('eLocation').required = true;
      $('eOnlineLink').required = false;
      $('eOnlineLink').value = '';
    } else {
      locationField.style.display = 'none';
      onlineField.style.display = 'block';
      $('eLocation').required = false;
      $('eOnlineLink').required = true;
      $('eLocation').value = '';
    }
  }

  qsa('.mode-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      qsa('.mode-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      currentMode = this.dataset.mode;
      updateModeFields();
    });
  });

  $('eClubs')?.addEventListener('change', renderClubRoles);

  function validateEventForm() {
    clearErrors();
    let valid = true;
    
    if (!$('eTitle').value.trim()) {
      showFieldError('eTitle', 'Title is required');
      valid = false;
    }
    
    if (!$('eDescription').value.trim()) {
      showFieldError('eDescription', 'Description is required');
      valid = false;
    }
    
    if (!$('eDate').value) {
      showFieldError('eDate', 'Date is required');
      valid = false;
    }

    if ($('eEndDate').value && $('eDate').value) {
      if ($('eEndDate').value < $('eDate').value) {
        showFieldError('eDate', 'End date must be on/after start date');
        valid = false;
      }
    }
    
    if (!$('eStartTime').value) {
      showFieldError('eStartTime', 'Start time is required');
      valid = false;
    }
    
    if (!$('eEndTime').value) {
      showFieldError('eEndTime', 'End time is required');
      valid = false;
    }
    
    if ($('eStartTime').value && $('eEndTime').value) {
      if ($('eEndTime').value <= $('eStartTime').value) {
        showFieldError('eEndTime', 'End time must be after start time');
        valid = false;
      }
    }
    
    if (currentMode === 'inperson' && !$('eLocation').value.trim()) {
      showFieldError('eLocation', 'Location is required for in-person events');
      valid = false;
    }
    
    if (currentMode === 'online' && !$('eOnlineLink').value.trim()) {
      showFieldError('eOnlineLink', 'Online link is required for online events');
      valid = false;
    }

    if ($('eVisibility').value === 'club') {
      const selected = Array.from($('eClubs').selectedOptions || []);
      if (!selected.length) {
        showMessage('Select at least one club for club-only visibility', 'error');
        valid = false;
      }
    }

    const budgetTotal = parseFloat($('eBudgetTotal').value || '0');
    const budgetUsed = parseFloat($('eBudgetUsed').value || '0');
    if (budgetUsed > budgetTotal) {
      showMessage('Budget used cannot exceed budget total', 'error');
      valid = false;
    }
    
    if ($('eRegDeadline').value && $('eDate').value && $('eStartTime').value) {
      const eventStart = new Date(`${$('eDate').value}T${$('eStartTime').value}`);
      const deadline = new Date($('eRegDeadline').value);
      if (deadline >= eventStart) {
        showFieldError('eRegDeadline', 'Registration deadline must be before event start');
        valid = false;
      }
    }
    
    return valid;
  }

  function showFieldError(fieldId, message) {
    const field = $(fieldId);
    const errorEl = $(fieldId + 'Error');
    if (field) field.classList.add('error');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  }

  function clearErrors() {
    qsa('.field-error').forEach(el => {
      el.textContent = '';
      el.style.display = 'none';
    });
    qsa('input, textarea, select').forEach(el => el.classList.remove('error'));
  }

  function showMessage(msg, type = 'success') {
    const el = $('eventMessage');
    if (!el) return;
    el.textContent = msg;
    el.className = `message ${type}`;
    el.style.display = 'block';
    setTimeout(() => {
      el.style.display = 'none';
    }, 5000);
  }

  $('eventForm')?.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!validateEventForm()) {
      showMessage('Please fix the errors in the form', 'error');
      return;
    }
    
    const eventId = $('eventId').value;
    
    // Prepare registration deadline - only include if it has a valid value
    const regDeadlineValue = $('eRegDeadline').value.trim();
    const regDeadline = regDeadlineValue ? regDeadlineValue : null;
    
    const data = {
      title: $('eTitle').value.trim(),
      description: $('eDescription').value.trim(),
      event_date: $('eDate').value,
      end_date: $('eEndDate').value || null,
      start_time: $('eStartTime').value,
      end_time: $('eEndTime').value,
      location: currentMode === 'inperson' ? $('eLocation').value.trim() : null,
      online_link: currentMode === 'online' ? $('eOnlineLink').value.trim() : null,
      max_participants: parseInt($('eMaxParticipants').value, 10) || 0,
      registration_deadline: regDeadline,
      visibility: $('eVisibility').value,
      budget_total: $('eBudgetTotal').value || 0,
      budget_used: $('eBudgetUsed').value || 0,
      budget_currency: $('eBudgetCurrency').value.trim() || 'USD',
      budget_notes: $('eBudgetNotes').value.trim()
    };
    const clubIds = Array.from($('eClubs')?.selectedOptions || []).map(o => parseInt(o.value, 10)).filter(Boolean);
    if (clubIds.length) {
      const clubRoles = {};
      clubIds.forEach(id => { clubRoles[id] = clubRoleMap[id] || 'host'; });
      data.clubIds = clubIds;
      data.clubRoles = clubRoles;
    }
    
    const btn = $('saveDraftBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    
    const promise = eventId ? put(`/api/events/${eventId}`, data) : post('/api/events', data);
    
    promise.then(r => {
      if (r.error) {
        showMessage(r.error, 'error');
      } else {
        const msg = r.message || (eventId ? 'Event updated successfully' : 'Event created successfully');
        showMessage(msg, 'success');
        resetEventForm();
        loadMyEvents();
        loadEventsStats();
        loadEventChatOptions();
        const tabs = this.closest('.section').querySelectorAll('.tab');
        tabs.forEach(t => { if (t.dataset.tab === 'myevents') t.click(); });
      }
    }).catch(err => {
      console.error('Error saving event:', err);
      showMessage('Failed to save event. Please try again.', 'error');
    }).finally(() => {
      btn.disabled = false;
      btn.textContent = eventId ? 'Update' : 'Save Draft';
    });
  });

  $('publishBtn')?.addEventListener('click', function () {
    if (!validateEventForm()) {
      showMessage('Please fix the errors in the form', 'error');
      return;
    }
    
    const eventId = $('eventId').value;
    
    // Prepare registration deadline - only include if it has a valid value
    const regDeadlineValue = $('eRegDeadline').value.trim();
    const regDeadline = regDeadlineValue ? regDeadlineValue : null;
    
    const data = {
      title: $('eTitle').value.trim(),
      description: $('eDescription').value.trim(),
      event_date: $('eDate').value,
      end_date: $('eEndDate').value || null,
      start_time: $('eStartTime').value,
      end_time: $('eEndTime').value,
      location: currentMode === 'inperson' ? $('eLocation').value.trim() : null,
      online_link: currentMode === 'online' ? $('eOnlineLink').value.trim() : null,
      max_participants: parseInt($('eMaxParticipants').value, 10) || 0,
      registration_deadline: regDeadline,
      status: 'published',
      visibility: $('eVisibility').value,
      budget_total: $('eBudgetTotal').value || 0,
      budget_used: $('eBudgetUsed').value || 0,
      budget_currency: $('eBudgetCurrency').value.trim() || 'USD',
      budget_notes: $('eBudgetNotes').value.trim()
    };
    const clubIds = Array.from($('eClubs')?.selectedOptions || []).map(o => parseInt(o.value, 10)).filter(Boolean);
    if (clubIds.length) {
      const clubRoles = {};
      clubIds.forEach(id => { clubRoles[id] = clubRoleMap[id] || 'host'; });
      data.clubIds = clubIds;
      data.clubRoles = clubRoles;
    }
    
    const btn = this;
    btn.disabled = true;
    btn.textContent = 'Publishing...';
    
    const promise = eventId ? put(`/api/events/${eventId}`, data) : post('/api/events', data);
    
    promise.then(r => {
      if (r.error) {
        showMessage(r.error, 'error');
      } else {
        const msg = r.message || (r.status === 'pending_approval' ? 'Event submitted for approval' : 'Event published successfully');
        showMessage(msg, 'success');
        resetEventForm();
        loadMyEvents();
        loadEventsStats();
        loadEventChatOptions();
        const tabs = this.closest('.section').querySelectorAll('.tab');
        tabs.forEach(t => { if (t.dataset.tab === 'myevents') t.click(); });
      }
    }).catch(err => {
      console.error('Error publishing event:', err);
      showMessage('Failed to publish event. Please try again.', 'error');
    }).finally(() => {
      btn.disabled = false;
      btn.textContent = 'Publish';
    });
  });

  $('cancelBtn')?.addEventListener('click', resetEventForm);

  // ---------- Events: Edit ----------
  function editEvent(id) {
    const event = allEvents.find(e => e.id === id);
    if (!event) {
      showMessage('Event not found', 'error');
      return;
    }
    
    $('eventId').value = event.id;
    $('formTitle').textContent = 'Edit Event';
    $('cancelBtn').style.display = 'inline-flex';
    $('saveDraftBtn').textContent = 'Update';
    $('publishBtn').style.display = event.status === 'draft' ? 'inline-flex' : 'none';
    
    $('eTitle').value = event.title || '';
    $('eDescription').value = event.description || '';
    $('eDate').value = event.event_date || '';
    $('eEndDate').value = event.end_date || '';
    $('eStartTime').value = event.start_time || '';
    $('eEndTime').value = event.end_time || '';
    $('eMaxParticipants').value = event.max_participants || 0;
    $('eRegDeadline').value = toDateTimeLocalValue(event.registration_deadline);
    $('eVisibility').value = event.visibility || 'public';
    $('eBudgetTotal').value = event.budget_total || 0;
    $('eBudgetUsed').value = event.budget_used || 0;
    $('eBudgetCurrency').value = event.budget_currency || 'USD';
    $('eBudgetNotes').value = event.budget_notes || '';
    
    if (event.location) {
      currentMode = 'inperson';
      $('eLocation').value = event.location;
      qsa('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === 'inperson');
      });
    } else if (event.online_link) {
      currentMode = 'online';
      $('eOnlineLink').value = event.online_link;
      qsa('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === 'online');
      });
    }
    updateModeFields();

    get('/api/events/' + event.id + '/clubs').then(r => {
      if (!r.success) return;
      const ids = (r.clubs || []).map(c => c.club_id);
      Array.from($('eClubs')?.options || []).forEach(opt => {
        opt.selected = ids.includes(parseInt(opt.value, 10));
      });
      clubRoleMap = {};
      (r.clubs || []).forEach(c => { clubRoleMap[c.club_id] = c.role || 'host'; });
      renderClubRoles();
    });
    
    // Switch to create tab
    const createTab = document.querySelector('.tab[data-tab="create"]');
    if (createTab) createTab.click();
  }

  function deleteEvent(id) {
    if (!confirm('Delete this event? This cannot be undone.')) return;
    
    del(`/api/events/${id}`).then(r => {
      if (r.error) {
        showMessage(r.error, 'error');
      } else {
        showMessage(r.message || 'Event deleted successfully', 'success');
        loadMyEvents();
        loadEventsStats();
      }
    }).catch(err => {
      console.error('Error deleting event:', err);
      showMessage('Failed to delete event', 'error');
    });
  }

  function publishEvent(id) {
    post(`/api/events/${id}/publish`).then(r => {
      if (r.error) {
        showMessage(r.error, 'error');
      } else {
        showMessage(r.message || 'Event published successfully', 'success');
        loadMyEvents();
        loadEventsStats();
      }
    }).catch(err => {
      console.error('Error publishing event:', err);
      showMessage('Failed to publish event', 'error');
    });
  }

  function closeEvent(id) {
    if (!confirm('Close this event? It will no longer accept registrations.')) return;
    
    post(`/api/events/${id}/close`).then(r => {
      if (r.error) {
        showMessage(r.error, 'error');
      } else {
        showMessage(r.message || 'Event closed successfully', 'success');
        loadMyEvents();
        loadEventsStats();
      }
    }).catch(err => {
      console.error('Error closing event:', err);
      showMessage('Failed to close event', 'error');
    });
  }

  function completeEvent(id) {
    if (!confirm('Mark this event as completed?')) return;
    post(`/api/events/${id}/complete`).then(r => {
      if (r.error) {
        showMessage(r.error, 'error');
      } else {
        showMessage(r.message || 'Event completed', 'success');
        loadMyEvents();
        loadEventsStats();
      }
    }).catch(err => {
      console.error('Error completing event:', err);
      showMessage('Failed to complete event', 'error');
    });
  }

  function duplicateEvent(id) {
    const event = allEvents.find(e => e.id === id);
    if (!event) {
      showMessage('Event not found', 'error');
      return;
    }
    
    resetEventForm();
    $('eTitle').value = event.title + ' (Copy)';
    $('eDescription').value = event.description || '';
    $('eDate').value = event.event_date || '';
    $('eEndDate').value = event.end_date || '';
    $('eStartTime').value = event.start_time || '';
    $('eEndTime').value = event.end_time || '';
    $('eMaxParticipants').value = event.max_participants || 0;
    $('eVisibility').value = event.visibility || 'public';
    $('eBudgetTotal').value = event.budget_total || 0;
    $('eBudgetUsed').value = event.budget_used || 0;
    $('eBudgetCurrency').value = event.budget_currency || 'USD';
    $('eBudgetNotes').value = event.budget_notes || '';
    
    if (event.location) {
      currentMode = 'inperson';
      $('eLocation').value = event.location;
      qsa('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === 'inperson');
      });
    } else if (event.online_link) {
      currentMode = 'online';
      $('eOnlineLink').value = event.online_link;
      qsa('.mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === 'online');
      });
    }
    updateModeFields();

    get('/api/events/' + event.id + '/clubs').then(r => {
      if (!r.success) return;
      const ids = (r.clubs || []).map(c => c.club_id);
      Array.from($('eClubs')?.options || []).forEach(opt => {
        opt.selected = ids.includes(parseInt(opt.value, 10));
      });
      clubRoleMap = {};
      (r.clubs || []).forEach(c => { clubRoleMap[c.club_id] = c.role || 'host'; });
      renderClubRoles();
    });
    
    const createTab = document.querySelector('.tab[data-tab="create"]');
    if (createTab) createTab.click();
  }

  // ---------- Events: Registrations (modal) ----------
  function showRegistrations(id) {
    currentEventId = id;
    get('/api/events/' + id + '/registrations').then(r => {
      if (!r.success) { alert(r.message || 'Failed to load registrations.'); return; }
      const regs = r.registrations || [];
      get('/api/events/my-events').then(r2 => {
        const event = (r2.events || []).find(e => e.id === id);
        $('modalEventTitle').textContent = 'Registrations: ' + (event ? escapeHtml(event.title) : 'Event');
        $('modalBody').innerHTML = regs.length
          ? '<div class="list-compact"><ul class="list">' + regs.map(reg =>
            '<li><strong>' + escapeHtml(reg.full_name || reg.email) + '</strong> ' +
            (reg.department ? '<span class="muted">• ' + escapeHtml(reg.department) + '</span>' : '') +
            ' <span class="muted">• ' + formatDateTime(reg.registered_at) + '</span> <span class="status ' + (reg.status || 'registered') + '">' + (reg.status || 'registered') + '</span></li>'
          ).join('') + '</ul></div>'
          : '<p class="muted">No registrations yet.</p>';
        $('eventModal').style.display = 'flex';
      });
    });
  }

  // ---------- Events: Notify participants (modal) ----------
  function showNotifyModal(id) {
    currentEventId = id;
    get('/api/events/my-events').then(r => {
      const event = (r.events || []).find(e => e.id === id);
      $('modalEventTitle').textContent = 'Notify participants: ' + (event ? escapeHtml(event.title) : 'Event');
      $('modalBody').innerHTML = '<form id="notifyForm" class="form">' +
        '<div class="field"><label>Title</label><input type="text" id="nTitle" value="Update: ' + escapeHtml(event?.title || 'Event') + '" required></div>' +
        '<div class="field"><label>Message</label><textarea id="nMessage" rows="4" required placeholder="Message to send to all registered participants"></textarea></div>' +
        '<div class="field"><label>Type</label><select id="nType"><option value="general">General</option><option value="upcoming_event">Upcoming event</option><option value="event_approval">Event approval</option></select></div>' +
        '<button type="submit" class="btn btn-primary">Send notification</button></form>';
      $('eventModal').style.display = 'flex';
      $('notifyForm').addEventListener('submit', function (e) {
        e.preventDefault();
        post('/api/events/' + currentEventId + '/notify', {
          title: $('nTitle').value.trim(),
          message: $('nMessage').value.trim(),
          type: $('nType').value
        }).then(r => {
          if (r.success) { alert(r.message || 'Notification sent.'); closeModal(); }
          else alert(r.message || 'Failed to send.');
        });
      });
    });
  }

  function closeModal() {
    $('eventModal').style.display = 'none';
    currentEventId = null;
  }
  $('modalClose')?.addEventListener('click', closeModal);
  $('eventModal')?.addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

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
        const canCancel = b.status === 'pending' || b.status === 'approved';
        return `<div class="item-row" data-booking-row="${b.id}">
          <div>
            <h4>${escapeHtml(b.resource_name)}</h4>
            <p class="meta">${start} <span class="status ${b.status || 'pending'}">${b.status || 'pending'}</span></p>
          </div>
          ${canCancel ? `<button type="button" class="btn btn-ghost" data-booking-cancel="${b.id}">Cancel</button>` : ''}
        </div>`;
      }).join('') : '<p class="muted">No bookings.</p>';
      el.querySelectorAll('[data-booking-cancel]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!confirm('Cancel this booking?')) return;
          put(`/api/resources/bookings/${btn.dataset.bookingCancel}/cancel`, {}).then(r2 => {
            if (r2.success) { loadBookings(); loadMyBookingsDashboard(); }
            else alert(r2.message || 'Failed.');
          });
        });
      });
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

  // ---------- Clubs ----------
  function loadMyClubs() {
    const el = $('clubsMyList');
    if (!el) return;
    get('/api/profile/clubs').then(r => {
      const heads = r.headsOrCoords || [];
      el.innerHTML = heads.length ? heads.map(c =>
        '<div class="item-row"><div><h4>' + escapeHtml(c.name) + '</h4><p class="meta">' + (c.type || 'club') + ' • ' + (c.membership_role || 'head') + '</p></div></div>'
      ).join('') : '<p class="muted">Not head/coordinator of any club.</p>';
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

  // ---------- Messages ----------
  let threadsCache = [];
  function loadMessageThreads() {
    const el = $('messageThreads');
    if (!el) return;
    get('/api/messages/threads').then(r => {
      threadsCache = r.threads || [];
      renderThreadList();
    }).catch(() => { el.innerHTML = 'Could not load.'; });
  }

  function renderThreadList() {
    const el = $('messageThreads');
    if (!el) return;
    if (!threadsCache.length) {
      el.innerHTML = '<span class="empty">No threads yet.</span>';
      return;
    }
    el.innerHTML = threadsCache.map(t => `
      <div class="message-thread-item ${selectedThreadId === t.id ? 'active' : ''}" data-thread-id="${t.id}">
        <strong>${escapeHtml(t.title || `#${t.id} ${t.type}`)}</strong>
        <div class="meta">${escapeHtml(t.last_message || 'No messages yet')}</div>
      </div>
    `).join('');
    el.querySelectorAll('[data-thread-id]').forEach(btn => {
      btn.addEventListener('click', () => openThread(parseInt(btn.dataset.threadId, 10)));
    });
  }

  function openThread(threadId) {
    selectedThreadId = threadId;
    renderThreadList();
    $('messageThreadHeader').textContent = 'Loading...';
    get(`/api/messages/threads/${threadId}`).then(r => {
      if (!r.success) return;
      $('messageThreadHeader').textContent = r.thread.title || `Thread #${r.thread.id}`;
    });
    get(`/api/messages/threads/${threadId}/messages`).then(r => {
      if (!r.success) return;
      renderMessages(r.messages || []);
    });
  }

  function renderMessages(messages) {
    const el = $('messageList');
    if (!el) return;
    if (!messages.length) {
      el.innerHTML = '<p class="muted">No messages yet.</p>';
      return;
    }
    el.innerHTML = messages.map(m => `
      <div class="message-bubble ${m.sender_id === user.id ? 'me' : ''}">
        <div><strong>${escapeHtml(m.full_name || m.email)}</strong></div>
        <div>${escapeHtml(m.body)}</div>
        <div class="meta">${formatDateTime(m.created_at)}</div>
      </div>
    `).join('');
    el.scrollTop = el.scrollHeight;
  }

  $('messageSendForm')?.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!selectedThreadId) return alert('Select a thread first.');
    const body = $('messageInput').value.trim();
    if (!body) return;
    post(`/api/messages/threads/${selectedThreadId}/messages`, { body }).then(r => {
      if (!r.success) return alert(r.message || 'Failed to send');
      $('messageInput').value = '';
      openThread(selectedThreadId);
      loadMessageThreads();
    });
  });

  $('dmSearch')?.addEventListener('input', debounce(function () {
    const q = $('dmSearch').value.trim();
    const results = $('dmResults');
    if (!q) { results.innerHTML = ''; return; }
    get('/api/users/search?q=' + encodeURIComponent(q)).then(r => {
      const arr = r.users || [];
      results.innerHTML = arr.length ? arr.map(u =>
        `<div class="item-row"><div><strong>${escapeHtml(u.full_name || u.email)}</strong><span class="muted"> • ${escapeHtml(u.email || '')}</span></div>
         <button type="button" class="btn btn-ghost" data-dm-user="${u.id}">Start</button></div>`
      ).join('') : '<span class="empty">No users found.</span>';
      results.querySelectorAll('[data-dm-user]').forEach(btn => {
        btn.addEventListener('click', () => createDirectThread(parseInt(btn.dataset.dmUser, 10)));
      });
    });
  }, 400));

  function createDirectThread(userId) {
    post('/api/messages/threads', { type: 'direct', userId }).then(r => {
      if (!r.success) return alert(r.message || 'Failed to create thread');
      loadMessageThreads();
      openThread(r.threadId);
    });
  }

  $('createClubChat')?.addEventListener('click', () => {
    const clubId = $('clubChatSelect').value;
    if (!clubId) return alert('Select a club');
    post('/api/messages/threads', { type: 'club', clubId }).then(r => {
      if (!r.success) return alert(r.message || 'Failed');
      loadMessageThreads();
      openThread(r.threadId);
    });
  });

  $('createEventChat')?.addEventListener('click', () => {
    const eventId = $('eventChatSelect').value;
    if (!eventId) return alert('Select an event');
    post('/api/messages/threads', { type: 'event', eventId }).then(r => {
      if (!r.success) return alert(r.message || 'Failed');
      loadMessageThreads();
      openThread(r.threadId);
    });
  });

  // ---------- Helpers ----------
  function escapeHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function toDateTimeLocalValue(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) {
      return String(value).replace(' ', 'T').slice(0, 16);
    }
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

  function debounce(fn, delay) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ---------- Init ----------
  function init() {
    const u = getUser();
    if (!u || !u.id) { redirectLogin(); return; }
    if (u.role !== 'organizer' && u.role !== 'admin') { redirectByRole(u); return; }
    loadProfile();
    loadProfileClubs();
    loadMyClubsDashboard();
    loadEventsStats();
    loadMyBookingsDashboard();
    loadRecentNotifs();
    loadNotifications();
    updateNotifBadge();
    loadMessageThreads();
    loadResources();
    loadBookings();
    loadResourceOptions();
    loadMyClubs();
    loadClubOptions();
    loadEventChatOptions();
  }

  init();
})();
