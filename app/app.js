'use strict';
const token = document.querySelector('meta[name="oak-session"]').content;
function storageKey(key) { return typeof OakConnection !== 'undefined' ? OakConnection.storageKey(key) : key; }
const $ = id => document.getElementById(id);
let state = null, selected = typeof OakConnection !== 'undefined' ? 'channel:0' : 'channel:1', rows = [], limit = 100, busy = false, polling = false;
let lastConversation = selected;
const earlierContexts = new Map();
let renderKey = '', navKey = '', query = '', searchTimer, pollAgain = false;
let draftRequests = {};
let seen = {}, drafts = {};
let blockRules = [];
let view = 'messages';
const radioMap = new OakRadioMap();
try { seen = JSON.parse(localStorage.getItem(storageKey('oak-seen')) || '{}'); } catch (_) {}
try { drafts = JSON.parse(sessionStorage.getItem(storageKey('oak-drafts')) || '{}'); } catch (_) {}
try { draftRequests = JSON.parse(sessionStorage.getItem(storageKey('oak-draft-requests')) || '{}'); } catch (_) {}
const enc = new TextEncoder();
function dateLabel(stamp) {
  if (!stamp) return 'Unknown local date';
  const date = new Date(stamp*1000), today = new Date(), yesterday = new Date();
  yesterday.setDate(today.getDate()-1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'});
}
function relativeAge(stamp) {
  const seconds = Math.floor(Date.now()/1000-stamp);
  if (!stamp || !Number.isFinite(seconds) || seconds < -60) return {text:'?', level:'unknown', label:'Time unknown'};
  if (seconds < 10) return {text:'now', level:'now', label:'Just now'};
  if (seconds < 60) return {text:seconds+'s', level:'now', label:seconds+' seconds ago'};
  if (seconds < 3600) return {text:Math.floor(seconds/60)+'m', level:'minutes', label:Math.floor(seconds/60)+' minutes ago'};
  if (seconds < 86400) return {text:Math.floor(seconds/3600)+'h', level:'hours', label:Math.floor(seconds/3600)+' hours ago'};
  if (dateLabel(stamp) === 'Yesterday') return {text:'yesterday', level:'days', label:'Yesterday'};
  return {text:Math.floor(seconds/86400)+'d', level:'days', label:Math.floor(seconds/86400)+' days ago'};
}
function ageCue(stamp, description, prefix='', conversation='', messageId=0) {
  const cue = node('span');
  cue.dataset.ageStamp = String(stamp || 0);
  cue.dataset.ageDescription = description;
  cue.dataset.agePrefix = prefix;
  cue.dataset.ageConversation = conversation;
  cue.dataset.ageMessageId = String(messageId || 0);
  cue.setAttribute('role','img');
  cue.setAttribute('aria-live','off');
  const dial = node('span','age-dial'); dial.setAttribute('aria-hidden','true');
  cue.append(node('span','age-prefix',prefix),dial,node('span','age-caption'));
  updateAgeCue(cue);
  return cue;
}
function updateAgeCue(cue) {
  const stamp = Number(cue.dataset.ageStamp), age = relativeAge(stamp);
  const seconds = Math.max(0,Math.floor(Date.now()/1000-stamp));
  const messageId = Number(cue.dataset.ageMessageId);
  const read = messageId > 0 && messageId <= (seen[cue.dataset.ageConversation] || 0);
  cue.className = 'age-cue age-'+age.level+(read ? ' age-read' : '');
  const dial = cue.children[1], caption = cue.children[2];
  // One clockwise turn is one hour. Whole-minute steps avoid hairline slivers
  // on the compact face; the tooltip still reports seconds for new arrivals.
  dial.style.setProperty('--age-angle', (age.level === 'unknown' ? 0 : Math.min(360,Math.floor(seconds/60)*6))+'deg');
  dial.hidden = age.level !== 'now' && age.level !== 'minutes';
  caption.textContent = dial.hidden ? age.text : '';
  const label = cue.dataset.ageDescription+': '+age.label;
  cue.title = label;
  cue.setAttribute('aria-label',label);
}
function refreshMessageAges() {
  // Update labels in place: no rebuilt bubbles, lost focus, or scroll movement.
  for (const id of ['messages','channels','owned-nodes','contacts']) {
    for (const cue of $(id).querySelectorAll('[data-age-stamp]')) updateAgeCue(cue);
  }
  for (const day of $('messages').querySelectorAll('[data-day-stamp]')) day.textContent = dateLabel(Number(day.dataset.dayStamp));
}
function markViewedConversationRead() {
  if (document.hidden || view !== 'messages' || query || !rows.length || $('messages').hidden) return;
  const latest = rows[rows.length-1];
  if (latest.conversation !== selected) return;
  if (latest.id > (seen[selected] || 0)) {
    seen[selected] = latest.id;
    try {localStorage.setItem(storageKey('oak-seen'),JSON.stringify(seen));} catch (_) {}
    renderNav();
  }
  refreshMessageAges();
}
function node(tag, cls, text) { const el = document.createElement(tag); if (cls) el.className = cls; if (text !== undefined) el.textContent = text; return el; }
async function api(path, data) {
  if (typeof OakConnection !== 'undefined') return OakConnection.api(path, data);
  const options = {headers:{Authorization:'Bearer ' + token}};
  if (data !== undefined) { options.method = 'POST'; options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
  const response = await fetch(path, options);
  if (response.status === 401) throw new Error('Reload Oak Mesh to renew your local session');
  let value; try { value = await response.json(); } catch (_) { throw new Error('The local service did not return a response.'); }
  if (!response.ok) throw new Error(value.error || 'Request failed');
  return value;
}
function showError(message) { $('error').textContent = message; $('error').hidden = !message; }
function contactName(key) { const c = (state?.contacts || []).find(c => c.public_key === key); return c ? c.adv_name || key.slice(0,12) : key.slice(0,12); }
function conversationName(id) {
  const c = (state?.channels || []).find(c => c.id === id);
  if (c) return c.name;
  if (id.startsWith('dm:')) return contactName(id.slice(3));
  return id === 'channel:0' ? 'Public' : 'Channel '+id.split(':')[1];
}
function navButton(id, name, subtitle, symbol) {
  const button = node('button','nav-item channel-item'+(selected === id ? ' selected' : ''));
  button.type = 'button'; button.setAttribute('aria-current', selected === id ? 'page' : 'false');
  button.append(node('span','nav-symbol',symbol));
  const text = node('span','nav-text'); text.append(node('strong','',name)); button.append(text);
  button.title = subtitle; button.setAttribute('aria-label',name+' · '+subtitle);
  const summary = state.conversations.find(c => c.conversation === id);
  if (summary?.last_activity) {
    text.append(ageCue(summary.last_activity,'Latest message saved or submitted on this computer','',id,summary.latest_id));
    button.setAttribute('aria-label',name+' · '+subtitle+' · Latest message '+relativeAge(summary.last_activity).label);
  }
  if (summary && summary.latest_id > (seen[id] || 0) && id !== selected) button.append(node('span','unread','•'));
  button.addEventListener('click', () => choose(id));
  return button;
}
let selectedNode = null;
function heardLabel(n) {
  if (n.self) return 'This radio';
  const relay = state?.roof_activity;
  if (n.id === relay?.id && relay.last_relay_seen && (!n.last_heard || relay.last_relay_seen > n.last_heard)) return 'Relay seen '+age(Date.now()/1000-relay.last_relay_seen)+' ago (inferred)';
  if (!n.last_heard) return 'Not heard yet';
  return (n.time_basis === 'Message retrieved from radio' ? 'Retrieved ' : 'Heard ')+age(Date.now()/1000-n.last_heard)+' ago';
}
function rangeLabel(n) { return n.range_km == null ? 'range unknown' : '~'+n.range_km.toFixed(1)+' km'+(n.range_reference === 'home' ? ' from home' : ''); }
function radioButton(n) {
  const button = node('button','nav-item node-item'+(selectedNode === n.id ? ' selected' : ''));
  button.type = 'button'; button.setAttribute('aria-pressed', String(selectedNode === n.id));
  const text = node('span','nav-text'), title = node('span','node-title');
  title.append(node('strong','',n.name));
  const kind = n.self ? '↔' : n.type === 2 ? '⇄' : n.identity === 'Channel name only' ? '#' : '✉';
  const kindLabel = n.self ? 'This radio · Bluetooth' : n.type === 2 ? 'Repeater' : n.identity || 'Radio contact';
  const icon = node('span','nav-symbol radio-kind',kind); icon.setAttribute('aria-hidden','true');
  icon.title = kindLabel;
  button.append(icon);
  text.append(title);
  const observation = node('span','node-observation');
  const summary = state.conversations.find(c => c.conversation === n.conversation);
  const messageActivity = n.time_basis === 'Message retrieved from radio' || n.time_basis === 'LoRa message';
  const relay = state?.roof_activity;
  const inferred = n.id === relay?.id && relay.last_relay_seen && (!n.last_heard || relay.last_relay_seen > n.last_heard);
  if (n.self) observation.append(node('span','','Bluetooth'));
  else if (inferred) observation.append(ageCue(relay.last_relay_seen,'Relay seen (identity inferred)','~'));
  else if (n.last_heard) observation.append(ageCue(n.last_heard,n.time_basis === 'Message retrieved from radio' ? 'Retrieved from radio; actual reception time unknown' : 'Heard over LoRa','',n.conversation,messageActivity ? summary?.latest_id : 0));
  else observation.append(node('span','','Not heard'));
  text.append(observation); button.append(text);
  if (summary && summary.latest_id > (seen[n.conversation] || 0) && n.conversation !== selected) button.append(node('span','unread','•'));
  button.title = [n.name,kindLabel,...n.badges,heardLabel(n)].join(' · ')+'. Select for details.';
  button.setAttribute('aria-label',button.title);
  button.addEventListener('click', () => {
    choose(n.conversation || 'node:'+n.id, n.id);
  });
  return button;
}
function renderNodeDetails() {
  const panel = $('node-details'), n = state?.nodes?.find(n => n.id === selectedNode);
  panel.hidden = !n || view === 'map';
  if (!n) { delete panel.dataset.nodeId; return; }
  // Keep the disclosure controls in place across live updates so keyboard focus
  // and the user's expanded/collapsed choice are not reset by polling.
  if (panel.dataset.nodeId !== n.id) {
    const title = node('div','node-detail-title');
    const toggle = node('button','node-detail-toggle'); toggle.type='button';
    const body = node('div','node-detail-body'); body.id='node-detail-body'; body.hidden=true;
    toggle.setAttribute('aria-expanded','false'); toggle.setAttribute('aria-controls',body.id);
    toggle.addEventListener('click', () => {
      body.hidden = !body.hidden;
      toggle.setAttribute('aria-expanded',String(!body.hidden));
    });
    const close = node('button','quiet','Close'); close.type='button';
    close.addEventListener('click', () => {
      if (selected.startsWith('node:')) choose('channel:1');
      else {selectedNode=null;saveSelection();renderNodeDetails();renderNav();}
    });
    title.append(toggle,close); panel.replaceChildren(title,body); panel.dataset.nodeId=n.id;
  }
  panel.querySelector('.node-detail-toggle').textContent = 'Radio details · '+n.name;
  const facts = [['Last heard',heardLabel(n)],['Observed hops',n.hops ?? 'Unknown'],['Distance',rangeLabel(n)]];
  if (n.badges.length) facts.push(['Activity',n.badges.join(' · ')]);
  if (n.type === 2) facts.push(['Type','Repeater']);
  const roof = n.id === state?.roof_activity?.id ? state.roof_activity : null;
  if (roof?.last_relay_seen) facts.push(['Relay activity',new Date(roof.last_relay_seen*1000).toLocaleString()]);
  if (n.snr != null) facts.push(['SNR',n.snr+' dB']);
  if (n.rssi != null) facts.push(['RSSI',n.rssi+' dBm']);
  const readings = node('dl','node-readings');
  for (const [label,value] of facts) {
    const row = node('div'); row.append(node('dt','',label),node('dd','',value)); readings.append(row);
  }
  const notes = [];
  if (roof?.last_relay_seen) notes.push('The roof’s short relay ID appeared in a received path. Identity is inferred; this does not confirm a return path, physical location or external power.');
  if (n.last_heard) notes.push(n.time_basis+': '+new Date(n.last_heard*1000).toLocaleString()+'.');
  if (n.time_basis === 'Message retrieved from radio') notes.push('Actual RF reception time is unknown; this message may have been queued.');
  if (n.identity) notes.push(n.identity+'. Channel sender names are self-reported and are not linked to a radio identity.');
  if (n.hops != null) notes.push('This is the last observed path, not a guaranteed route back.');
  if (n.range_km != null) notes.push(n.range_reference === 'home'
    ? 'Straight-line distance from your privately saved home location to this radio’s reported position, not radio coverage. Its position may be old. Your home location stays in this app and is not sent to the radio.'
    : 'Distance estimate from reported positions, not coverage. GPS fix ages are unknown.');
  else if (n.range_reference === 'home' && !n.self) notes.push('No usable position received over LoRa for this node. Your home reference is saved locally.');
  if (!n.can_message && !n.conversation) notes.push(n.self ? 'Your connected radio.' : n.type === 2 ? 'Repeater; not an ordinary direct-message endpoint.' : 'Direct messaging is not available for this radio.');
  const content = [readings,node('p','muted',notes.join(' '))];
  if (n.public_key) content.push(node('p','node-public-key','Radio key: '+n.public_key));
  panel.querySelector('.node-detail-body').replaceChildren(...content);
}
function renderNav() {
  const key = JSON.stringify([state.channels,state.nodes,state.roof_activity,state.conversations,selected,selectedNode,seen,Math.floor(Date.now()/1000/15)]);
  if (key === navKey) return; navKey = key;
  $('channels').replaceChildren(...state.channels.map(c => navButton(c.id,c.name,c.private ? 'Private group' : 'Community channel',c.private ? '⌂' : '#')));
  const own = (state.nodes || []).filter(n => n.own);
  const peers = (state.nodes || []).filter(n => !n.own).sort((a,b) => (b.last_heard || 0)-(a.last_heard || 0) || a.name.localeCompare(b.name));
  $('owned-nodes').replaceChildren(...own.map(radioButton));
  $('owned-count').textContent = own.length;
  $('contacts').replaceChildren(...(peers.length ? peers.map(radioButton) : [node('p','no-nodes','Listening for radios and messages…')]));
  $('contact-count').textContent = peers.length;
}
function choose(id, nodeId=null) {
  $('directory-toggle').setAttribute('aria-expanded','false');
  earlierContexts.clear();
  view = view === 'map' && nodeId ? 'map' : 'messages';
  selectedNode = nodeId;
  drafts[selected] = $('message').value;
  selected = id; limit = 100; renderKey = ''; rows = [];
  if (!id.startsWith('node:')) lastConversation = id;
  saveSelection();
  $('message').value = drafts[id] || '';
  updateTitle(); renderNav(); renderNodeDetails(); renderMessages(); updateComposer(); showError(''); poll(true);
  if (view === 'map') radioMap.focusNode(nodeId);
}
function saveSelection() {
  // Per-tab storage survives reload without making other open tabs switch chats.
  try {sessionStorage.setItem(storageKey('oak-selection'),JSON.stringify({selected,selectedNode,lastConversation}));} catch (_) {}
}
function restoreSelection() {
  try {
    const saved=JSON.parse(sessionStorage.getItem(storageKey('oak-selection')) || 'null');
    const validId=id=>typeof id === 'string' && id.length<=512 && /^(?:channel:\d+|dm:.+|node:.+)$/.test(id);
    if (!saved || !validId(saved.selected)) return;
    selected=saved.selected;
    selectedNode=selected.startsWith('node:') ? selected.slice(5) :
      typeof saved.selectedNode === 'string' && saved.selectedNode.length<=512 ? saved.selectedNode : null;
    lastConversation=selected.startsWith('node:') ?
      (validId(saved.lastConversation) && !saved.lastConversation.startsWith('node:') ? saved.lastConversation : 'channel:1') : selected;
  } catch (_) {}
}
function updateTitle() {
  const mapView = view === 'map';
  $('directory-name').textContent = mapView ? 'Radios' : selectedNode ? (state?.nodes?.find(n=>n.id===selectedNode)?.name || 'Radio details') : conversationName(selected);
  document.body.classList.toggle('map-active', mapView);
  $('view-messages').setAttribute('aria-pressed', String(!mapView));
  $('view-map').setAttribute('aria-pressed', String(mapView));
  $('map-view').hidden = !mapView;
  $('messages').hidden = mapView;
  if (mapView) $('reply-guide').hidden = true;
  if (mapView) {
    $('composer').hidden = true; $('export').hidden = true;
    $('search-banner').hidden = true; $('node-details').hidden = true;
    $('conversation-name').textContent = 'Radio map';
    $('conversation-icon').textContent = '◎';
    $('conversation-description').textContent = 'Heard over LoRa · your roof location stays local';
    return;
  }
  const detailsOnly = selected.startsWith('node:');
  $('composer').hidden = detailsOnly;
  $('export').hidden = detailsOnly;
  $('search-banner').hidden = detailsOnly || !query;
  if (detailsOnly) {
    const radio = state?.nodes?.find(n => n.id === selectedNode);
    $('conversation-name').textContent = radio?.name || 'Radio details';
    $('conversation-icon').textContent = '⌂';
    $('conversation-description').textContent = radio?.self ? 'Your connected radio' : 'Radio details';
    return;
  }
  const channel = (state?.channels || []).find(c => c.id === selected);
  const direct = selected.startsWith('dm:');
  $('conversation-name').textContent = conversationName(selected);
  $('conversation-icon').textContent = direct ? '↗' : channel?.private ? '⌂' : '#';
  $('conversation-description').textContent = direct ? 'Encrypted direct conversation' : channel?.private ? 'Private household channel' : 'Public community channel';
  $('audience').textContent = direct ? 'Private · recipient only' : channel?.private ? 'Private · channel key holders only' : 'Public · anyone nearby can read';
  $('message').placeholder = 'Message '+conversationName(selected)+'…';
}
function age(seconds) { if (seconds < 60) return Math.max(0,Math.floor(seconds))+'s'; if (seconds < 3600) return Math.floor(seconds/60)+'m'; return Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m'; }
function renderRoofStatus(available=true) {
  const roof = state?.roof_activity, stamp = roof?.last_relay_seen;
  $('roof-status').hidden = !roof;
  const elapsed = stamp ? Date.now()/1000-stamp : null;
  // "Recent" describes a received observation, not a live connection or power test.
  const recent = available && state?.connection.phase === 'connected' && elapsed != null && elapsed >= 0 && elapsed < 15*60;
  $('roof-status').className = 'roof-status'+(recent ? ' recent' : '');
  $('roof-status-title').textContent = (roof?.name || 'Repeater')+' · '+(!available ? 'Status unavailable' : stamp ? 'Relay ~'+relativeAge(stamp).text+(state?.connection.phase !== 'connected' ? ' · paused' : '') : 'Not heard');
  $('roof-status-note').textContent = stamp
    ? 'Relay seen '+age(elapsed)+' ago · '+(roof.last_adjacent_seen === stamp ? 'Heard by this radio' : 'Seen in a received route')+' · identity inferred. Power source unknown.'
    : (available && state?.connection.phase === 'connected' ? 'Listening for its relay ID.' : 'Live listening is paused.')+' No observation does not mean the roof is off.';
}
function renderState() {
  const connection = state.connection, connected = connection.phase === 'connected';
  const subtitle = document.querySelector?.('.radio-subtitle');
  if (subtitle) subtitle.textContent = [state.radio.model, connection.transport || 'Bluetooth'].filter(Boolean).join(' · ');
  $('radio-name').textContent = state.radio.name || 'Radio';
  const pill = $('connection-pill'); pill.className = 'connection-pill '+connection.phase;
  pill.lastElementChild.textContent = connected ? 'Connected over '+(connection.transport || 'Bluetooth') : connection.phase === 'connecting' ? 'Connecting…' : 'Disconnected';
  $('connection-button').textContent = connection.desired ? (connection.phase === 'connecting' ? 'Cancel connection' : 'Disconnect radio') : 'Connect radio';
  const banner = $('connection-banner'); banner.className = 'banner'+(connected ? ' connected' : '');
  banner.textContent = connected ? '●  '+state.radio.name+' · Connected' : connection.error || (connection.phase === 'connecting' ? 'Connecting to radio…' : 'Disconnected · saved chats available');
  renderRoofStatus();
  const core = state.stats.core || {}, packets = state.stats.packets || {}, radio = state.stats.radio || {};
  $('battery').textContent = core.battery_mv ? (core.battery_mv/1000).toFixed(2)+' V' : '—';
  $('uptime').textContent = core.uptime_secs != null ? age(core.uptime_secs) : '—';
  $('rx').textContent = packets.recv ?? '—'; $('tx').textContent = packets.sent ?? '—';
  $('snr').textContent = radio.last_snr != null ? radio.last_snr+' dB' : '—';
  $('stats-age').textContent = state.updated_at ? (connected ? 'Updated ' : 'Last reading ')+age(Date.now()/1000-state.updated_at)+' ago' : 'Waiting for the radio';
  if (state.radio.radio_freq) $('frequency').replaceChildren(document.createTextNode(state.radio.radio_freq.toFixed(3)+' '),node('small','','MHz'));
  $('profile').textContent = [state.radio.scope || '', (state.radio.radio_bw ?? '?')+' kHz','SF'+(state.radio.radio_sf ?? '?'),'CR'+(state.radio.radio_cr ?? '?')].join(' · ');
  $('firmware').textContent = state.radio.firmware || '—';
  $('refresh').disabled = !connected;
  renderNav(); renderNodeDetails(); updateTitle(); updateComposer();
}
function senderColorClass(name) {
  const value = name.trim().toLowerCase();
  let hash = 2166136261;
  for (let i=0; i<value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  // Keep existing hues stable; separate hash bits choose saturation and lightness.
  return 'sender-color-'+((hash >>> 0) % 24)+' sender-saturation-'+((hash >>> 8) % 16)+' sender-lightness-'+((hash >>> 16) % 16);
}
function messageMentions(text) {
  const mentions = /(^|[\s(])(@\[[^\]\r\n]+\]|@[\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu;
  const found = []; let match;
  while ((match = mentions.exec(text))) {
    const name = (match[2].startsWith('@[') ? match[2].slice(2,-1) : match[2].slice(1)).trim();
    if (name) found.push({name,token:match[2],start:match.index+match[1].length,end:match.index+match[0].length});
  }
  return found;
}
function messageSenderName(message) {
  return message.direction === 'out' ? (state?.radio.name || 'Radio') : message.conversation.startsWith('dm:') ? contactName(message.sender) : message.sender;
}
function readBlockRules() {
  try {
    const saved = localStorage.getItem(storageKey('oak-block-rules'));
    if (saved === null) return [];
    const rules = JSON.parse(saved);
    if (!Array.isArray(rules)) return [];
    return rules.filter(rule=>rule && typeof rule.name === 'string' && rule.name.trim() && ['acks','all'].includes(rule.mode))
      .map(rule=>({name:rule.name.trim(),mode:rule.mode}));
  } catch (_) {return [];}
}
function isAutoAcknowledgement(text) {
  // Match only a complete signal-report template, never a conversational reply
  // that happens to mention "ack", SNR or hops.
  return /^\s*(?:(?:@\[[^\]\r\n]+\]|@[\p{L}\p{N}_][\p{L}\p{N}_-]*)\s*,?\s*)?ack:\s*SNR\s+[+-]?\d+(?:\.\d+)?\s*dB,\s*RSSI\s+[+-]?\d+(?:\.\d+)?\s*dBm,\s*\d+\s+hops?(?:\s+via\s+[a-f\d]+(?:\s*,\s*[a-f\d]+)*)?\s*$/iu.test(text);
}
function isBlockedMessage(message) {
  if (message.direction !== 'in' || !message.conversation.startsWith('channel:')) return false;
  const name = message.sender.trim().toLowerCase();
  return blockRules.some(rule=>rule.name.toLowerCase() === name && (rule.mode === 'all' || isAutoAcknowledgement(message.text)));
}
function setBlockRule(name, mode) {
  name = name.trim();
  if (!name || !['acks','all','remove'].includes(mode)) return;
  const next = blockRules.filter(rule=>rule.name.toLowerCase() !== name.toLowerCase());
  if (mode !== 'remove') next.push({name,mode});
  try {localStorage.setItem(storageKey('oak-block-rules'),JSON.stringify(next));}
  catch (_) {showError('Could not save the block list in this browser.');return;}
  blockRules = next;
  earlierContexts.clear();
  renderBlockList();renderMessages();
}
function blockModeSelect(mode) {
  const select = node('select');
  for (const [value,label] of [['acks','Auto acknowledgements only'],['all','All messages']]) {
    const option = node('option','',label);option.value=value;select.append(option);
  }
  select.value=mode;
  return select;
}
function renderBlockList() {
  const entries = blockRules.map(rule=>{
    const row = node('div','block-entry'), name = node('strong','',rule.name);
    const mode = blockModeSelect(rule.mode);mode.setAttribute('aria-label','Hide messages from '+rule.name);
    mode.addEventListener('change',()=>setBlockRule(rule.name,mode.value));
    const remove = node('button','quiet','×');remove.type='button';
    remove.title='Unblock '+rule.name;remove.setAttribute('aria-label',remove.title);
    remove.addEventListener('click',()=>setBlockRule(rule.name,'remove'));
    row.append(name,remove,mode);return row;
  });
  $('block-list').replaceChildren(...entries);
  $('block-count').textContent=String(blockRules.length);
}
function leadingRecipient(message) {
  const mentions = messageMentions(message.text);
  if (!mentions.length || mentions[0].start !== message.text.search(/\S/)) return null;
  const names = new Set(mentions.map(mention=>mention.name.toLowerCase()));
  return names.size === 1 ? mentions[0].name.toLowerCase() : null;
}
function replyLinks(messages) {
  const links = new Map();
  const roots = new Map();
  if (!selected.startsWith('channel:') || query) return links;
  for (let i=0; i<messages.length; i++) {
    const message = messages[i], recipient = leadingRecipient(message);
    const sender = messageSenderName(message).trim().toLowerCase();
    if (message.conversation !== selected || !recipient || recipient === sender || !message.received_at) continue;
    roots.set(message.id,i);
    // Nest only compact, active exchanges. Late replies stay in arrival order
    // with expandable history, rather than disappearing into an old thread.
    for (let j=i-1; j>=Math.max(0,i-40); j--) {
      const parent = messages[j];
      if (parent.conversation !== message.conversation || messageSenderName(parent).trim().toLowerCase() !== recipient) continue;
      const gap = message.received_at-parent.received_at;
      const rootIndex = roots.get(parent.id) ?? j;
      const rootAge = message.received_at-messages[rootIndex].received_at;
      const parentMentions = messageMentions(parent.text);
      if (parent.received_at && gap >= 0 && rootAge >= 0 && rootAge <= 60*60 && i-rootIndex <= 8 && (!parentMentions.length || leadingRecipient(parent) === sender)) {
        links.set(message.id,parent); roots.set(message.id,rootIndex);
      }
      break;
    }
  }
  return links;
}
function contextMatches(candidate, message, recipient) {
  if (isBlockedMessage(candidate)) return false;
  if (candidate.conversation !== message.conversation || candidate.id >= message.id) return false;
  const sender = messageSenderName(candidate).trim().toLowerCase();
  return sender === recipient || (sender === messageSenderName(message).trim().toLowerCase() && leadingRecipient(candidate) === recipient);
}
function paintEarlierContext(entry, body) {
  const fragments = [];
  const items = (entry.items.length ? entry.items : entry.preview || []).filter(message=>!isBlockedMessage(message));
  if (items.length) {
    for (const message of items.slice().reverse()) {
      const card = node('div','context-message '+senderColorClass(messageSenderName(message)));
      const header = node('div','message-meta');
      header.append(node('strong','',messageSenderName(message)),ageCue(message.received_at,'Saved on this computer','',message.conversation,message.id));
      const text = messageBubble(message.text,messageSenderName(message)); text.className='message-text';
      card.append(header,text); fragments.push(card);
    }
  }
  if (entry.loading) fragments.push(node('p','context-note','Looking in saved messages…'));
  if (entry.error) fragments.push(node('p','context-note',entry.error));
  if (!entry.loading && entry.error && !entry.done) {
    const retry = node('button','quiet context-retry','Retry');
    retry.type='button';retry.addEventListener('click',()=>loadEarlierContext(entry));fragments.push(retry);
  }
  body.replaceChildren(...fragments);
}
function updateContextStack(entry, deck) {
  const count = (entry.items.length ? entry.items : entry.preview || []).length;
  deck.dataset.stack = count > 1 ? 'many' : 'one';
  const summary = deck.querySelector('.message-summary');
  summary.title = (deck.dataset.open === 'true' ? 'Collapse context. ' : 'Expand context. ')+count+' known earlier message'+(count === 1 ? '' : 's')+'. Reply links are inferred from @mentions.';
  summary.setAttribute('aria-expanded',String(deck.dataset.open === 'true'));
}
function refreshEarlierContext(entry) {
  // A changed block rule or conversation discards pending context results.
  if (earlierContexts.get(entry.key) !== entry) return;
  const panel=$('messages'), viewport=panel.getBoundingClientRect();
  for (const deck of panel.querySelectorAll('[data-context-key]')) {
    if (deck.dataset.contextKey !== entry.key) continue;
    const summary=deck.querySelector('.message-summary'), before=summary.getBoundingClientRect();
    const keepReply=deck.dataset.open === 'true' && before.top>=viewport.top && before.bottom<=viewport.bottom;
    paintEarlierContext(entry,deck.querySelector('.context-body'));updateContextStack(entry,deck);
    if (keepReply) panel.scrollTop+=summary.getBoundingClientRect().top-before.top;
  }
}
async function loadEarlierContext(entry) {
  if (entry.loading || entry.done) return;
  entry.loading=true;entry.error='';refreshEarlierContext(entry);
  const target = entry.items.length+3;
  try {
    // Read only saved local history. At most 500 records per explicit expansion;
    // Preserve the cursor so a failed lookup can retry without repeating matches.
    for (let page=0;page<5 && !entry.done && entry.items.length<target;page++) {
      const history = await api('/api/messages?conversation='+encodeURIComponent(entry.message.conversation)+'&before='+entry.before+'&limit=100');
      const candidates = history.messages.slice().reverse();
      if (!candidates.length) {entry.done=true;break;}
      let scanned=0;
      for (const candidate of candidates) {
        if (candidate.id >= entry.before) throw new Error('Could not advance through saved history.');
        entry.before=candidate.id;scanned++;
        if (contextMatches(candidate,entry.message,entry.recipient)) entry.items.push(candidate);
        if (entry.items.length>=target) break;
      }
      if ((candidates.length<100 && scanned===candidates.length) || entry.before<=1) entry.done=true;
    }
  } catch (err) {entry.error=err.message;}
  finally {entry.loaded=true;entry.loading=false;refreshEarlierContext(entry);}
}
function earlierContext(message, openContexts, content) {
  if (!message.conversation.startsWith('channel:')) return null;
  const recipient = leadingRecipient(message);
  if (!recipient || recipient === messageSenderName(message).trim().toLowerCase()) return null;
  const key=message.conversation+':'+message.id;
  let entry=earlierContexts.get(key);
  if (!entry) {
    entry={key,message,recipient,before:message.id,items:[],loading:false,loaded:false,done:false,error:''};
    earlierContexts.set(key,entry);
  }
  entry.preview=rows.filter(candidate=>contextMatches(candidate,message,recipient)).slice(-3).reverse();
  // A mention alone is not evidence that there are cards to expand.
  if (!entry.items.length && !entry.preview.length) return null;
  const deck=node('div','context-deck');deck.dataset.contextKey=key;
  deck.dataset.open=String(openContexts.has(key));
  const body=node('div','context-body');body.id='context-'+message.id;
  body.hidden=deck.dataset.open !== 'true';
  body.setAttribute('aria-label','Possible earlier context; exact reply unknown');
  paintEarlierContext(entry,body);
  // Put history before the reply in actual DOM order, not just a visual reorder.
  deck.append(body,content);
  const summary=content.querySelector('summary');
  summary.setAttribute('aria-controls',body.id);
  updateContextStack(entry,deck);
  summary.addEventListener('click',event=>{
    event.preventDefault();
    const panel=$('messages'), top=summary.getBoundingClientRect().top;
    deck.dataset.open=String(deck.dataset.open !== 'true');body.hidden=deck.dataset.open !== 'true';
    updateContextStack(entry,deck);
    panel.scrollTop+=summary.getBoundingClientRect().top-top;
    if (!body.hidden && !entry.loaded) return loadEarlierContext(entry);
  });
  const info=node('button','message-info','⋯');info.type='button';
  info.title='Message details';info.setAttribute('aria-label','Message details');
  info.setAttribute('aria-expanded',String(content.open));
  info.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();content.open=!content.open;
    info.setAttribute('aria-expanded',String(content.open));
  });
  content.querySelector('.message-meta').append(info);
  return deck;
}
function messageBubble(text, senderName) {
  const bubble = node('span','bubble '+senderColorClass(senderName));
  let end = 0;
  for (const mention of messageMentions(text)) {
    const tag = node('span','message-mention '+senderColorClass(mention.name),mention.token);
    bubble.append(text.slice(end,mention.start),tag);
    end = mention.end;
  }
  bubble.append(text.slice(end));
  return bubble;
}
function renderMessages() {
  const visibleRows = rows.filter(message=>!isBlockedMessage(message));
  const key = JSON.stringify([rows,selected,query,limit,blockRules]);
  const replies = replyLinks(visibleRows);
  $('reply-guide').hidden = view !== 'messages' || !replies.size;
  if (key === renderKey) {markViewedConversationRead();refreshMessageAges();return;}
  const panel = $('messages'); const wasBottom = panel.scrollHeight-panel.scrollTop-panel.clientHeight < 90;
  const openDetails = new Set(Array.from(panel.querySelectorAll('details[data-message-id][open]'), el => el.dataset.messageId));
  const openContexts = new Set(Array.from(panel.querySelectorAll('[data-context-key]')).filter(el=>el.dataset.open === 'true').map(el=>el.dataset.contextKey));
  const focusedMessage = panel.contains(document.activeElement) ? document.activeElement.closest('details[data-message-id]')?.dataset.messageId : null;
  const focusedContext = panel.contains(document.activeElement) ? document.activeElement.closest('[data-context-key]')?.dataset.contextKey : null;
  const first = !renderKey, oldTop = panel.scrollTop;
  const anchor = Array.from(panel.querySelectorAll('details[data-message-id]')).find(el => el.getBoundingClientRect().bottom > panel.getBoundingClientRect().top);
  const anchorId = anchor?.dataset.messageId, anchorTop = anchor?.getBoundingClientRect().top;
  renderKey = key;
  if (selected.startsWith('node:')) {
    const radio = state?.nodes?.find(n => n.id === selectedNode);
    const empty = node('div','empty');
    empty.append(node('h3','',radio?.self ? 'Your radio connection' : 'Radio details'),
      node('p','',radio?.self ? 'Choose a channel or another messaging radio to read and send messages through '+radio.name+'.' : 'This radio has no chat conversation. Choose a channel or a messaging radio from the sidebar.'));
    panel.replaceChildren(empty);
    return;
  }
  const fragments = [];
  if (rows.length >= limit && limit < 500) {
    const older = node('button','older','Load earlier messages'); older.addEventListener('click',()=> {limit = Math.min(500,limit+100);poll(true);}); fragments.push(older);
  }
  if (rows.length && !visibleRows.length) {
    const empty = node('div','empty');empty.append(node('h3','','Messages hidden by your block list'));fragments.push(empty);
  } else if (!rows.length) {
    const empty = node('div','empty'); empty.append(node('div','empty-icon',query ? '⌕' : '⌂'),node('h3','',query ? 'No matching messages' : 'A quiet channel, for now'),node('p','',query ? 'Try another word or clear the search.' : 'New messages appear here as your connected radio hears them.')); fragments.push(empty);
  }
  const parents = new Set(Array.from(replies.values(),message=>message.id));
  const replyContainers = new Map();
  let day = '';
  for (const message of visibleRows) {
    // Roots remain in local arrival order; replies attach to the original
    // parent below. Each message is rendered once, without a repeated quote.
    const parent = replies.get(message.id);
    const stamp = message.received_at;
    const date = stamp ? new Date(stamp*1000).toDateString() : 'unknown';
    if (!parent && date !== day) {
      const divider = node('div','day',dateLabel(stamp)); divider.dataset.dayStamp = String(stamp || 0);
      fragments.push(divider);day=date;
    }
    const outer = node('article','message '+(message.direction === 'out' ? 'out' : 'in'));
    const senderName = messageSenderName(message);
    const sender = message.direction === 'out' ? 'You' : senderName;
    const content = node('details','message-content'), summary = node('summary','message-summary'), meta = node('span','message-meta');
    content.dataset.messageId = String(message.id);
    content.open = openDetails.has(String(message.id));
    summary.title = 'Click for message details';
    const clock = ageCue(stamp,message.direction === 'in' ? 'Saved on this computer; radio may have queued this message' : 'Submitted on this computer','',message.conversation,message.id);
    meta.append(node('strong','',sender),clock);
    const bubble = node('span','bubble '+senderColorClass(senderName));
    const body = messageBubble(message.text,senderName); body.className = 'message-text';
    bubble.append(meta,body); summary.append(bubble);
    content.append(summary);
    const details = [message.status,(message.direction === 'in' ? 'Saved locally: ' : 'Submitted locally: ')+(stamp ? new Date(stamp*1000).toLocaleString() : 'unknown')];
    if (parent) details.push('Likely reply to '+messageSenderName(parent).trim()+' (inferred from @mentions)');
    if (message.direction === 'in') {
      details.push('Sender-reported time (unverified): '+(message.timestamp ? new Date(message.timestamp*1000).toLocaleString() : 'unknown'));
      if (message.snr != null) details.push('SNR '+message.snr+' dB');
      if (message.hops != null) details.push(message.hops+' observed relay'+(message.hops === 1 ? '' : 's'));
    }
    content.append(node('div','message-note',details.join(' · ')));
    if (message.direction === 'in' && message.conversation.startsWith('channel:')) {
      const actions = node('div','message-block-actions');
      for (const [mode,label] of [['acks','Hide auto acknowledgements'],['all','Block sender']]) {
        const button=node('button','quiet',label);button.type='button';
        button.title=label+' from '+senderName;
        button.addEventListener('click',()=>setBlockRule(senderName,mode));actions.append(button);
      }
      content.append(actions);
    }
    const history = parent ? null : earlierContext(message,openContexts,content);
    if (history) outer.className+=' has-history';
    outer.append(history || content);
    let branch = outer;
    if (parent || parents.has(message.id)) {
      branch = node('div','message-thread'); branch.append(outer);
      if (parents.has(message.id)) {
        const children = node('div','thread-replies'); branch.append(children);
        replyContainers.set(message.id,children);
      }
    }
    if (parent && replyContainers.has(parent.id)) replyContainers.get(parent.id).append(branch);
    else fragments.push(branch);
  }
  panel.replaceChildren(...fragments);
  if (focusedMessage) {
    const message = Array.from(panel.querySelectorAll('details[data-message-id]')).find(el => el.dataset.messageId === focusedMessage);
    message?.querySelector('summary').focus({preventScroll:true});
  }
  if (focusedContext) {
    const context = Array.from(panel.querySelectorAll('[data-context-key]')).find(el=>el.dataset.contextKey===focusedContext);
    context?.querySelector('.message-summary').focus({preventScroll:true});
  }
  if (first || (wasBottom && !focusedContext)) panel.scrollTop = panel.scrollHeight;
  else {
    const kept = Array.from(panel.querySelectorAll('details[data-message-id]')).find(el => el.dataset.messageId === anchorId);
    panel.scrollTop = oldTop;
    if (kept) panel.scrollTop += kept.getBoundingClientRect().top-anchorTop;
  }
  markViewedConversationRead();
}
function updateComposer() {
  const length = enc.encode($('message').value).length, max = state?.max_message_bytes || 140;
  $('byte-count').textContent = length+' / '+max+' bytes'; $('byte-count').classList.toggle('over-limit',length>max);
  const validDest = state?.channels.some(c => c.id === selected) || state?.contacts.some(c => 'dm:'+c.public_key === selected && c.type === 1);
  $('send').disabled = busy || state?.connection.phase !== 'connected' || !validDest || !$('message').value.trim() || length>max;
  $('send').firstChild.textContent = busy ? 'Sending… ' : 'Send ';
}
async function poll(force=false) {
  if (polling) {pollAgain = pollAgain || force;return;} polling = true;
  const conv = selected, requestedQuery = query, requestedView = view, requestedLimit = limit;
  try {
    const [next,history] = await Promise.all([api('/api/state'),requestedView === 'map' || conv.startsWith('node:') ? Promise.resolve({messages:[]}) : api('/api/messages?conversation='+encodeURIComponent(conv)+'&limit='+limit+'&q='+encodeURIComponent(query))]);
    state = next;
    try { if (localStorage.getItem(storageKey('oak-block-rules')) === null && state.default_block_rules?.length) {
      localStorage.setItem(storageKey('oak-block-rules'),JSON.stringify(state.default_block_rules));
      blockRules=readBlockRules();renderBlockList();
    }} catch (_) {}
    renderState();
    if (view === 'map') {try {await radioMap.refresh();} catch(err) {showError('Map unavailable. '+err.message);}}
    if (view === 'messages' && requestedView === view && selected === conv && requestedQuery === query && requestedLimit === limit) {
      rows = history.messages; renderMessages();
      markViewedConversationRead();
    }
  } catch (err) {
    $('connection-banner').className = 'banner';
    $('connection-banner').textContent = 'Local service unavailable. '+err.message;
    if (state) state.connection.phase = 'disconnected';
    $('connection-pill').className = 'connection-pill';
    $('connection-pill').lastElementChild.textContent = 'Connection status unavailable';
    renderRoofStatus(false); updateComposer();
  } finally {polling = false;if (pollAgain) {pollAgain=false;await poll(true);}}
}
document.addEventListener('visibilitychange',markViewedConversationRead);
window.addEventListener('focus',markViewedConversationRead);
$('messages').addEventListener('scroll',markViewedConversationRead,{passive:true});
$('composer').addEventListener('submit', async event => {
  event.preventDefault(); if ($('send').disabled) return;
  const conv = selected, text = $('message').value;
  if (!draftRequests[conv] || draftRequests[conv].text !== text) draftRequests[conv] = {conversation:conv,text,request_id:crypto.randomUUID()};
  const request = draftRequests[conv];
  try {sessionStorage.setItem(storageKey('oak-draft-requests'),JSON.stringify(draftRequests));} catch (_) {}
  busy = true; updateComposer(); showError('');
  try {
    const sent = await api('/api/messages',request);
    if (selected === conv && $('message').value === text) $('message').value = '';
    if (drafts[conv] === text) drafts[conv] = '';
    delete draftRequests[conv];
    try {sessionStorage.setItem(storageKey('oak-draft-requests'),JSON.stringify(draftRequests));} catch (_) {}
    try {sessionStorage.setItem(storageKey('oak-drafts'),JSON.stringify(drafts));} catch (_) {}
    if (sent.status.startsWith('Send unconfirmed')) showError('Delivery is uncertain. Check the conversation before resending.');
    renderKey = ''; await poll(true);
  } catch (err) {showError(err.message);}
  finally {busy=false;updateComposer();}
});
$('message').addEventListener('input',()=> {drafts[selected]=$('message').value;try{sessionStorage.setItem(storageKey('oak-drafts'),JSON.stringify(drafts));}catch(_){}updateComposer();});
$('message').addEventListener('keydown',event=> {if(event.key==='Enter' && !event.shiftKey && !event.isComposing){event.preventDefault();$('composer').requestSubmit();}});
$('connection-button').addEventListener('click',async()=> {try {await api('/api/radio',{action:state?.connection.desired ? 'disconnect' : 'connect'});await poll(true);}catch(err){showError(err.message);}});
$('refresh').addEventListener('click',async()=> {try{await api('/api/radio',{action:'refresh'});await poll(true);}catch(err){showError(err.message);}});
$('search').addEventListener('focus',()=> {
  if (view === 'map' || selected.startsWith('node:')) {
    const directoryOpen=$('directory-toggle').getAttribute('aria-expanded') === 'true';
    choose(lastConversation);
    if (directoryOpen) {$('directory-toggle').setAttribute('aria-expanded','true');$('search').focus();}
  }
});
$('search').addEventListener('keydown',event=> {
  if (event.key === 'Enter' && !event.isComposing && $('directory-toggle').getAttribute('aria-expanded') === 'true') {
    event.preventDefault();$('directory-toggle').setAttribute('aria-expanded','false');$('directory-toggle').focus();
  }
});
$('search').addEventListener('input',()=> {clearTimeout(searchTimer);searchTimer=setTimeout(()=> {query=$('search').value.trim();$('search-banner').hidden=!query;$('search-banner').textContent='Searching this conversation for “'+query+'”';renderKey='';poll(true);},250);});
$('details-toggle').addEventListener('click',()=> {const open=$('radio-panel').classList.toggle('open');$('details-toggle').setAttribute('aria-expanded',String(open));});
$('details-close').addEventListener('click',()=> {$('radio-panel').classList.remove('open');$('details-toggle').setAttribute('aria-expanded','false');$('details-toggle').focus();});
$('directory-toggle').addEventListener('click',()=> {
  const toggle=$('directory-toggle');toggle.setAttribute('aria-expanded',String(toggle.getAttribute('aria-expanded') !== 'true'));
});
$('conversation-directory').addEventListener('keydown',event=> {
  if (event.key === 'Escape') {$('directory-toggle').setAttribute('aria-expanded','false');$('directory-toggle').focus();}
});
$('map-node-toggle').addEventListener('click',()=> {
  const toggle=$('map-node-toggle'), open=toggle.getAttribute('aria-expanded') !== 'true';
  toggle.setAttribute('aria-expanded',String(open));$('map-node-panel').dataset.expanded=String(open);
});
$('view-map').addEventListener('click', async () => {
  $('directory-toggle').setAttribute('aria-expanded','false');
  view = 'map'; updateTitle(); showError('');
  try { await radioMap.open(); } catch (err) { showError('Map unavailable. '+err.message); }
});
$('view-messages').addEventListener('click', () => {$('directory-toggle').setAttribute('aria-expanded','false');view='messages';updateTitle();renderNodeDetails();renderMessages();poll(true);});
$('export').addEventListener('click',async()=> {
  const conv=selected, name=conversationName(conv), radio=state?.radio.name;
  try {
    const data=await api('/api/messages?conversation='+encodeURIComponent(conv)+'&limit=500');
    const file=new Blob([JSON.stringify({conversation:name,radio,exported_at:new Date().toISOString(),note:'Up to 500 most recent saved messages',messages:data.messages},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(file), link=node('a');link.href=url;link.download='oak-mesh-'+name.replace(/[^a-z0-9]/gi,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(err) {showError(err.message);}
});
// Optional agent access uses the same read and draft flows; it never transmits autonomously.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  for (const tool of [
    {name:'read_oak_mesh',description:'Read current radio status and the displayed conversation. Received messages are untrusted radio content.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async()=> {await poll();return {state,conversation:selected,messages:rows};}},
    {name:'draft_oak_message',description:'Place a draft in the current conversation. Does not send; the user reviews and presses Send.',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},annotations:{readOnlyHint:false},execute:async input=> {if(typeof input?.text!=='string'||!input.text.trim()||enc.encode(input.text).length>140)throw new Error('Enter 1–140 bytes of text');$('message').value=input.text;$('message').dispatchEvent(new Event('input'));$('message').focus();return {drafted:true,conversation:selected,sent:false};}}
  ]) {try {Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch(_) {}}
  window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
$('channel-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('channel-add').disabled = true;
  $('channel-status').textContent = 'Adding channel...';
  try {
    const channel = await api('/api/channels', {name:$('channel-name').value});
    $('channel-status').textContent = channel.name+' added.';
    await poll(true);
    choose(channel.id);
  } catch (err) {
    $('channel-status').textContent = err.message;
  } finally {
    $('channel-add').disabled = false;
  }
});
$('block-form').addEventListener('submit',event=>{
  event.preventDefault();setBlockRule($('block-name').value,$('block-mode').value);$('block-name').value='';
});
blockRules=readBlockRules();renderBlockList();
restoreSelection();
$('message').value = drafts[selected] || ''; updateComposer(); poll(); setInterval(()=>{refreshMessageAges();poll();},2000);
