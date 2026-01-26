(function () {
  'use strict';

  const API = '';
  let user = null;
  let currentEventId = null;

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

  function headers() {
    const u = getUser();
    return { 'Content-Type': 'application/json', ...(u && u.id ? { 'x-user-id': String(u.id) } : {}) };
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
    return fetch(API + url, { method: 'PATCH', headers: headers() }).then(r => r.json());
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

  function logout() { redirectLogin(); }
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
    
    get('/api/organizer/events').then(events => {
      allEvents = Array.isArray(events) ? events : [];
      renderEvents();
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
      const date = formatDate(e.event_date);
      const timeRange = e.start_time && e.end_time ? `${e.start_time} - ${e.end_time}` : '';
      const location = e.location || e.online_link || 'TBD';
      const locationType = e.location ? '📍 In-person' : '🌐 Online';
      const maxParts = e.max_participants === 0 ? 'Unlimited' : e.max_participants;
      const status = e.status || 'draft';
      
      const actions = [];
      if (status === 'draft') {
        actions.push(`<button type="button" class="btn btn-sm btn-ghost" data-edit="${e.id}">Edit</button>`);
        actions.push(`<button type="button" class="btn btn-sm btn-danger" data-delete="${e.id}">Delete</button>`);
      }
      if (status === 'draft') {
        actions.push(`<button type="button" class="btn btn-sm btn-primary" data-publish="${e.id}">Publish</button>`);
      }
      if (status === 'published') {
        actions.push(`<button type="button" class="btn btn-sm btn-secondary" data-close="${e.id}">Close</button>`);
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
    el.querySelectorAll('[data-duplicate]').forEach(btn => {
      btn.addEventListener('click', () => duplicateEvent(parseInt(btn.dataset.duplicate, 10)));
    });
  }

  $('statusFilter')?.addEventListener('change', renderEvents);

  function loadEventsStats() {
    get('/api/organizer/events').then(events => {
      const arr = Array.isArray(events) ? events : [];
      const stats = { draft: 0, published: 0, closed: 0 };
      arr.forEach(e => {
        const s = e.status || 'draft';
        if (stats[s] !== undefined) stats[s]++;
      });
      if ($('statDraft')) $('statDraft').textContent = stats.draft;
      if ($('statPending')) $('statPending').textContent = stats.published;
      if ($('statApproved')) $('statApproved').textContent = stats.closed;
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
    qsa('input, textarea').forEach(el => el.classList.remove('error'));
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
    const data = {
      title: $('eTitle').value.trim(),
      description: $('eDescription').value.trim(),
      event_date: $('eDate').value,
      start_time: $('eStartTime').value,
      end_time: $('eEndTime').value,
      location: currentMode === 'inperson' ? $('eLocation').value.trim() : null,
      online_link: currentMode === 'online' ? $('eOnlineLink').value.trim() : null,
      max_participants: parseInt($('eMaxParticipants').value, 10) || 0,
      registration_deadline: $('eRegDeadline').value || null
    };
    
    const btn = $('saveDraftBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    
    const promise = eventId ? put(`/api/events/${eventId}`, data) : post('/api/events', data);
    
    promise.then(r => {
      if (r.error) {
        showMessage(r.error, 'error');
      } else {
        showMessage(eventId ? 'Event updated successfully' : 'Event created successfully', 'success');
        resetEventForm();
        loadMyEvents();
        loadEventsStats();
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
    const data = {
      title: $('eTitle').value.trim(),
      description: $('eDescription').value.trim(),
      event_date: $('eDate').value,
      start_time: $('eStartTime').value,
      end_time: $('eEndTime').value,
      location: currentMode === 'inperson' ? $('eLocation').value.trim() : null,
      online_link: currentMode === 'online' ? $('eOnlineLink').value.trim() : null,
      max_participants: parseInt($('eMaxParticipants').value, 10) || 0,
      registration_deadline: $('eRegDeadline').value || null,
      status: 'published'
    };
    
    const btn = this;
    btn.disabled = true;
    btn.textContent = 'Publishing...';
    
    const promise = eventId ? put(`/api/events/${eventId}`, data) : post('/api/events', data);
    
    promise.then(r => {
      if (r.error) {
        showMessage(r.error, 'error');
      } else {
        showMessage('Event published successfully', 'success');
        resetEventForm();
        loadMyEvents();
        loadEventsStats();
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
    $('eStartTime').value = event.start_time || '';
    $('eEndTime').value = event.end_time || '';
    $('eMaxParticipants').value = event.max_participants || 0;
    $('eRegDeadline').value = event.registration_deadline ? event.registration_deadline.slice(0, 16) : '';
    
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
    $('eStartTime').value = event.start_time || '';
    $('eEndTime').value = event.end_time || '';
    $('eMaxParticipants').value = event.max_participants || 0;
    
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
    try { return new Date(s + 'Z').toLocaleDateString(undefined, { dateStyle: 'medium' }); } catch (_) { return s; }
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
  function init() {
    const u = getUser();
    if (!u || !u.id) { redirectLogin(); return; }
    loadProfile();
    loadProfileClubs();
    loadMyClubsDashboard();
    loadEventsStats();
    loadMyBookingsDashboard();
    loadRecentNotifs();
    loadNotifications();
    updateNotifBadge();
    loadMessageThreads();
    loadMyEvents();
    loadEventsStats();
    loadResources();
    loadBookings();
    loadResourceOptions();
    loadMyClubs();
  }

  init();
})();
