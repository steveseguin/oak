'use strict';
(() => {
  const $ = id => document.getElementById(id), core = window.MeshcastHeard;
  let data = null, map = null, layer = null, rendered = '', loading = false, failed = false;
  const gta = [43.75, -79.45];
  const startingCenter = [43.55576, -78.62509], startingZoom = 9;
  let initialFrameDone = false;
  let activityPeriod = '24h';
  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function ensureMap() {
    if (map) return;
    if (!window.L) { $('map-status').textContent = 'Map unavailable. Node names are listed below.'; return; }
    map = L.map('public-map', {minZoom: 2, maxZoom: 18, scrollWheelZoom: true}).setView(startingCenter, startingZoom);
    // An interaction before the first data load also cancels automatic framing.
    for (const event of ['pointerdown', 'wheel', 'keydown']) {
      $('public-map').addEventListener(event, () => { initialFrameDone = true; }, {passive:true});
    }
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).on('tileerror', () => { $('tiles-status').hidden = false; }).addTo(map);
    layer = L.layerGroup().addTo(map);
    new ResizeObserver(() => { if (!$('map-panel').hidden) map.invalidateSize({animate: false}); }).observe($('public-map'));
  }
  function frameInitialMap() {
    if (initialFrameDone || !map || $('map-panel').hidden || !data?.nodes.length) return;
    const size = map.getSize(), zoom = map.getZoom();
    if (size.x <= 48 || size.y <= 48) return;
    const center = core.bestMapCenter(data.nodes.map(n => map.project(n.position, zoom)),
      {x:size.x-48, y:size.y-48}, map.project(startingCenter, zoom));
    initialFrameDone = true;
    map.panTo(map.unproject([center.x, center.y], zoom), {animate:false});
  }
  function renderNodes() {
    if (!data) return;
    if (!$('map-panel').hidden) ensureMap();
    if (layer) layer.clearLayers();
    const query = $('node-search').value.trim().toLocaleLowerCase();
    const nodes = data.nodes.filter(n => n.name.toLocaleLowerCase().includes(query));
    $('node-count').textContent = nodes.length + (query ? ' matching nodes' : ' nodes');
    $('all-nodes').disabled = !nodes.length || !map;
    $('map-status').textContent = !nodes.length ? (query ? 'No matching nodes.' : 'No recently advertised locations.') : '';
    $('map-status').hidden = !!nodes.length;
    $('node-list').replaceChildren(...nodes.map(node => {
      let marker;
      if (layer) {
        const symbol = element('span', '', 'node-dot');
        marker = L.marker(node.position, {
          icon: L.divIcon({className: 'public-node', html: symbol, iconSize: [32, 32], iconAnchor: [16, 16]}),
          title: node.name, alt: node.name, keyboard: true
        }).addTo(layer);
        marker.bindTooltip(element('span', node.name), {direction: 'top', offset: [0, -12]});
        marker.bindPopup(element('strong', node.name));
      }
      const li = element('li'), button = element('button', node.name, 'node-link');
      button.type = 'button';
      button.disabled = !map;
      button.addEventListener('click', () => {
        map.setView(node.position, 12);
        marker.openPopup();
        $('public-map').scrollIntoView({block: 'nearest'});
      });
      li.append(button); return li;
    }));
    frameInitialMap();
  }
  function renderMessages() {
    if (!data) return;
    $('messages').replaceChildren(...data.messages.map(message => {
      const card = element('article', undefined, 'public-message');
      card.style.setProperty('--message-light', core.color(message.name));
      card.style.setProperty('--message-dark', core.color(message.name, true));
      const header = element('div', undefined, 'message-heading');
      const time = element('time', core.age(message.received_at));
      time.dateTime = new Date(message.received_at * 1000).toISOString();
      time.dataset.stamp = message.received_at;
      time.title = 'Retrieved locally: ' + new Date(message.received_at * 1000).toLocaleString();
      time.setAttribute('aria-label', 'Retrieved ' + (time.textContent === 'now' ? 'just now' : time.textContent + ' ago'));
      header.append(element('strong', message.name), time);
      card.append(header, element('p', message.text));
      return card;
    }));
    if (!data.messages.length) $('messages').append(element('p', 'No public messages in this snapshot.', 'note'));
  }
  function renderActivity() {
    const bins = core.activityBins(data?.activity, activityPeriod);
    const total = bins.reduce((sum,b) => sum + b.count, 0);
    const maximum = Math.max(1, ...bins.map(b => b.count));
    $('activity-total').textContent = bins.length ? total.toLocaleString() + ' messages' : 'History unavailable';
    $('activity-chart').setAttribute('aria-label', activityPeriod === '24h' ? 'Public messages by hour' : 'Public messages by day');
    $('activity-chart').replaceChildren(...bins.map(bin => {
      const label = bin.label + ': ' + (bin.known ? bin.count + ' messages' + (bin.partial ? ' · partial' : '') : 'no saved history');
      const button = element('button', undefined, 'activity-bar' + (!bin.known ? ' no-history' : ''));
      button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
      const fill = element('span');
      fill.style.height = bin.known ? (bin.count ? Math.max(3, bin.count / maximum * 100) : 1) + '%' : '100%';
      button.append(fill);
      const detail = () => { $('activity-detail').textContent = label; };
      button.addEventListener('click', detail); button.addEventListener('focus', detail);
      button.addEventListener('mouseenter', detail);
      return button;
    }));
    $('activity-start').textContent = activityPeriod === '24h' ? '24h ago' : activityPeriod === '7d' ? '6 days ago' : '29 days ago';
    $('activity-detail').textContent = 'Select a bar for details.';
    const since = data?.activity?.since;
    $('activity-history').textContent = since == null ? 'History builds as messages arrive.' : 'History since ' + new Intl.DateTimeFormat('en-CA',
      {timeZone:'America/Toronto', month:'short', day:'numeric'}).format(new Date(since * 1000)) + ' · Toronto time';
  }
  function renderInsights() {
    renderActivity();
    const counts = data.locations;
    $('mapped-total').textContent = counts ? counts.mapped.toLocaleString() : '—';
    $('unknown-total').textContent = counts ? counts.unknown.toLocaleString() : '—';
    $('mapped-ratio').style.width = counts && counts.mapped + counts.unknown ? (100 * counts.mapped / (counts.mapped + counts.unknown)) + '%' : '0%';
    $('arrivals-list').replaceChildren(...(data.arrivals || []).map(arrival => {
      const li = element('li'), button = element('button', undefined, 'arrival-link');
      button.type = 'button';
      const time = element('time', core.age(arrival.first_seen));
      time.dataset.stamp = arrival.first_seen; time.dataset.basis = 'First heard';
      time.dateTime = new Date(arrival.first_seen * 1000).toISOString();
      time.title = 'First heard here: ' + new Date(arrival.first_seen * 1000).toLocaleString();
      button.append(element('span', arrival.name), time);
      button.addEventListener('click', () => {
        $('node-search').value = ''; show('map');
        if (map) {
          map.setView(arrival.position, 12);
          L.popup().setLatLng(arrival.position).setContent(element('strong', arrival.name)).openOn(map);
          $('public-map').scrollIntoView({block:'nearest'});
        }
      });
      li.append(button); return li;
    }));
    if (!data.arrivals?.length) $('arrivals-list').append(element('li', 'No recent arrivals.', 'note'));
  }
  function freshness() {
    if (!data) return;
    const stale = Date.now() / 1000 - data.published_at > 3600;
    const age = core.age(data.published_at);
    $('freshness').textContent = 'Updated ' + (age === 'now' ? 'just now' : age + ' ago')
      + (failed ? ' · update unavailable' : stale ? ' · saved snapshot' : ' · about every 15m');
    $('freshness').title = new Date(data.published_at * 1000).toLocaleString();
    document.querySelectorAll('time[data-stamp]').forEach(el => {
      el.textContent = core.age(Number(el.dataset.stamp));
      el.setAttribute('aria-label', (el.dataset.basis || 'Retrieved') + ' ' + (el.textContent === 'now' ? 'just now' : el.textContent + ' ago'));
    });
  }
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    try {
      const response = await fetch('data/heard.json', {cache: 'no-cache'});
      if (!response.ok) throw Error('Snapshot unavailable');
      const next = core.validate(await response.json());
      const signature = JSON.stringify(next);
      data = next;
      failed = false;
      if (signature !== rendered) { renderNodes(); renderMessages(); renderInsights(); rendered = signature; }
      freshness();
    } catch (_) {
      failed = true;
      $('freshness').textContent = data ? 'Update unavailable · showing saved snapshot' : 'Snapshot temporarily unavailable';
      if (!data) $('messages').replaceChildren(element('p', 'Public messages could not load. Please try again later.', 'note'));
    } finally { loading = false; }
  }
  function show(mode) {
    for (const name of ['map', 'chat']) {
      const active = name === mode;
      $(name + '-tab').setAttribute('aria-selected', String(active));
      $(name + '-tab').tabIndex = active ? 0 : -1;
      $(name + '-panel').hidden = !active;
    }
    if (mode === 'map') { ensureMap(); if (map) map.invalidateSize({animate: false}); renderNodes(); }
    try { sessionStorage.setItem('meshcast-view', mode); } catch (_) {}
  }
  for (const name of ['map', 'chat']) {
    $(name + '-tab').addEventListener('click', () => show(name));
    $(name + '-tab').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const mode = event.key === 'Home' ? 'map' : event.key === 'End' ? 'chat' : name === 'map' ? 'chat' : 'map';
      show(mode); $(mode + '-tab').focus();
    });
  }
  $('node-search').addEventListener('input', renderNodes);
  document.querySelectorAll('[data-period]').forEach(button => button.addEventListener('click', () => {
    activityPeriod = button.dataset.period;
    document.querySelectorAll('[data-period]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    renderActivity();
  }));
  $('gta').addEventListener('click', () => { initialFrameDone = true; if (map) map.setView(gta, 9); });
  $('all-nodes').addEventListener('click', () => {
    const query = $('node-search').value.trim().toLocaleLowerCase();
    const nodes = data.nodes.filter(n => n.name.toLocaleLowerCase().includes(query));
    if (nodes.length && map) map.fitBounds(nodes.map(n => n.position), {padding: [36, 36], maxZoom: 12});
  });
  let initial = 'map';
  try { if (sessionStorage.getItem('meshcast-view') === 'chat') initial = 'chat'; } catch (_) {}
  show(initial);
  refresh();
  setInterval(refresh, 60000);
  setInterval(freshness, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
