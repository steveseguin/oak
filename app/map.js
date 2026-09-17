'use strict';

// All geometry and imagery come from this loopback app. No tile service,
// geolocation permission, directory lookup, or radio command is used here.
class OakRadioMap {
  constructor() {
    this.map = null;
    this.markers = new Map();
    this.data = null;
    this.loading = null;
    this.renderKey = '';
    this.initialFit = false;
    this.routeSelection = null;
    this.relaySeen = new Map();
    this.pendingFocus = null;
    // Separate co-located roof/receiver symbols enough to expose their link.
    // This is a screen offset only; the private geographic reference is unchanged.
    this.receiverOffset = 72;
  }

  async open() {
    if (!this.map) {
      this.map = L.map('node-map', {attributionControl:false, minZoom:5, maxZoom:14, zoomSnap:0.25}).setView([43.65,-79.6],9);
      L.control.scale({imperial:false, maxWidth:160}).addTo(this.map);
      this.lines = L.layerGroup().addTo(this.map);
      $('map-line-mode').addEventListener('change',()=>this.renderRoutes());
      $('map-fit').addEventListener('click', () => this.fit());
      $('map-home').addEventListener('click', () => this.nearHome());
      $('map-labels').addEventListener('change', () => this.labels());
      this.resize = new ResizeObserver(() => this.resizeMap());
      this.resize.observe($('node-map'));
      this.map.on('moveend zoomend resize',()=>this.layoutLabels());
      this.map.on('zoomend',()=>this.renderRoutes());
      // The fixed regional images are downloaded at setup time, not from
      // the map's current bounds or the user's private coordinates.
      await (typeof OakConnection !== 'undefined' ? fetch(new URL('maps/basemap.json',location.href)).then(r=>r.json()) : api('/maps/basemap.json')).then(base => {
        for (const layer of base.layers) {
          L.imageOverlay(typeof OakConnection !== 'undefined' ? new URL(layer.image.replace(/^\//,''),location.href).href : layer.image,layer.bounds,{interactive:false}).addTo(this.map)
            .on('error', () => {$('map-attribution').textContent='A saved background image could not load. Radio markers still work.';});
        }
        $('map-attribution').textContent = 'Map: '+base.attribution+'. Map controls: Leaflet (BSD-2-Clause).';
      }).catch(() => {$('map-attribution').textContent='Saved map background unavailable. Radio positions are still shown.';});
    }
    this.resizeMap();
    await this.refresh();
    if (view !== 'map') return;
    this.resizeMap();
    this.initialView();
    if (selectedNode && selectedNode !== this.routeSelection) this.focusNode(selectedNode);
  }

  async refresh() {
    if (!this.map) return;
    if (this.loading) return this.loading;
    this.loading = this.load();
    try { await this.loading; } finally { this.loading = null; }
  }

  async load() {
    const data = await api('/api/map');
    const receiver=data.topology?.receiver;
    if(receiver?.position && !data.nodes.some(n=>n.id===receiver.id)) {
      data.nodes.push({...receiver,own:true,self:true,badges:['Ours','Receiver'],receiver:true,
        position_basis:receiver.position_basis,range_km:null,hops:null,last_heard:null});
      data.unlocated=data.unlocated.filter(n=>n.id!==receiver.id);
    }
    this.data = data;
    const key = JSON.stringify([data,state?.connection.phase,Math.floor(Date.now()/30000)]);
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.relaySeen.clear();
    for (const path of data.topology?.paths || []) {
      for (const step of path.steps) {
        if (step.id && step.match === 'prefix') this.relaySeen.set(step.id,Math.max(this.relaySeen.get(step.id) || 0,path.last_seen));
      }
    }
    const current = new Set(data.nodes.map(n => n.id));
    for (const [id, marker] of this.markers) {
      if (!current.has(id)) {marker.remove();this.markers.delete(id);}
    }
    for (const n of data.nodes) {
      let marker = this.markers.get(n.id);
      if (!marker) {
        const symbol = document.createElement('span');
        symbol.className = 'map-marker-symbol'+(n.own ? ' ours' : '');
        symbol.textContent = n.receiver ? 'R' : n.own ? '■' : '●';
        marker = L.marker(n.position, {
          icon:L.divIcon({className:'radio-map-marker',html:symbol,iconSize:[32,32],iconAnchor:n.receiver ? [16+this.receiverOffset,16] : [16,16]}),
          title:n.name+(n.own ? ' · Ours' : ''),alt:n.name,keyboard:true,riseOnHover:true,radioId:n.id
        }).addTo(this.map);
        marker.getElement().setAttribute('aria-label',n.name+(n.own ? ' · Ours' : ''));
        marker.on('mouseover',()=> {
          const label=marker.getTooltip()?.getElement();
          if(label) {label.style.visibility='visible';label.style.zIndex='1000';}
        });
        marker.on('mouseout',()=>this.layoutLabels());
        marker.bindPopup(() => this.popup(this.data.nodes.find(row => row.id === n.id) || n),
          {minWidth:120,maxWidth:240,maxHeight:this.popupHeight(),autoPan:false,className:'map-compact-popup'});
        marker.on('click',()=>this.selectNode(n.id));
        this.markers.set(n.id,marker);
      } else marker.setLatLng(n.position);
      const activity = this.activity(n), symbol = marker.getElement().querySelector('.map-marker-symbol');
      symbol.className = 'map-marker-symbol'+(n.own ? ' ours' : '')+' activity-'+activity.kind;
      symbol.textContent = n.receiver ? 'R' : activity.kind === 'unknown' ? '?' : n.own ? (activity.kind === 'inactive' ? '□' : '■') : (activity.kind === 'inactive' ? '○' : '●');
      const description = n.name+(n.own ? ' · Ours' : '')+' · '+activity.label;
      const markerLabel = n.name+(activity.shortAge ? ' · '+activity.shortAge : '');
      marker.getElement().setAttribute('aria-label',description);
      marker.getElement().setAttribute('title',markerLabel);
      if (marker.isPopupOpen()) {
        marker.getPopup().options.maxHeight=this.popupHeight();
        marker.setPopupContent(this.popup(n));
      }
      // Tooltip content uses DOM text nodes, never HTML from radio adverts.
      const label = document.createElement('span'); label.textContent=markerLabel;
      marker.unbindTooltip();
      marker.bindTooltip(label,{permanent:$('map-labels').checked,direction:n.receiver ? 'bottom' : 'top',offset:n.receiver ? [-this.receiverOffset,18] : [0,-12],className:'radio-map-label'});
    }
    const counts = {active:0,quiet:0,inactive:0,unknown:0};
    for (const n of data.nodes) counts[this.activity(n).kind]++;
    $('map-count').textContent = counts.active+' active · '+counts.quiet+' quiet · '+counts.inactive+' possibly inactive · '+counts.unknown+' unknown · '+data.unlocated.length+' unlocated';
    $('map-home').disabled = !data.nodes.some(n => n.position_basis === 'Private roof reference');
    $('map-missing-summary').textContent = 'Location unknown ('+data.unlocated.length+')';
    $('map-missing-list').replaceChildren(...data.unlocated.map(n => {
      const radio=state?.nodes.find(row=>row.id===n.id) || n;
      const item=node('li'),button=node('button','quiet',n.name+(n.own ? ' · Ours' : '')+' · '+this.activity(radio).label);
      button.type='button';button.addEventListener('click',()=>this.selectNode(n.id));item.append(button);return item;
    }));
    this.renderRoutes();
    this.renderSelection();
    // Data can arrive after an initially empty map; frame it only once.
    this.initialView();
    if (this.pendingFocus && view === 'map' && selectedNode === this.pendingFocus) this.focusNode(this.pendingFocus);
    requestAnimationFrame(()=>this.layoutLabels());
  }

  layoutLabels() {
    if (!this.map || !$('map-labels').checked) return;
    const placed=[], bounds=$('node-map').getBoundingClientRect();
    // Keep labels readable without hiding any marker. Owned markers are first.
    // A hidden overlapping label is revealed when the marker is hovered.
    const priority=(this.data?.nodes || []).slice().sort((a,b)=>Number(!!b.receiver)-Number(!!a.receiver) || Number(b.own)-Number(a.own));
    for (const entry of priority) {
      const marker=this.markers.get(entry.id);
      if(!marker) continue;
      const label=marker.getTooltip()?.getElement();
      if(!label) continue;
      label.style.visibility='visible';label.style.zIndex='';
      const rect=label.getBoundingClientRect();
      const overlap=rect.left<bounds.left || rect.right>bounds.right || rect.top<bounds.top || rect.bottom>bounds.bottom ||
        placed.some(p=>rect.left<p.right+4 && rect.right>p.left-4 && rect.top<p.bottom+4 && rect.bottom>p.top-4);
      if(overlap) label.style.visibility='hidden'; else placed.push(rect);
    }
  }

  labels() {
    this.renderKey='';
    this.refresh().catch(err=>showError('Map unavailable. '+err.message));
  }

  fit() {
    if (this.data?.nodes.length) this.map.fitBounds(this.data.nodes.map(n=>n.position),{padding:this.fitPadding(),maxZoom:11,animate:false});
  }

  initialView() {
    if (this.initialFit || view !== 'map' || !this.data?.nodes.length) return;
    this.resizeMap();
    if (selectedNode) this.focusNode(selectedNode);
    if (!selectedNode || !this.data.nodes.some(n=>n.id===selectedNode)) {
      if (!this.nearHome()) this.fit();
    }
    this.initialFit=true;
  }

  fitPadding() {
    const size=this.map.getSize();
    return [Math.max(12,Math.min(45,size.x*0.1)),Math.max(12,Math.min(65,size.y*0.12))];
  }

  nearHome() {
    const home=this.data?.nodes.find(n=>n.position_basis === 'Private roof reference');
    if (!home) return false;
    this.map.fitBounds(L.latLng(home.position).toBounds(50000),{padding:this.fitPadding(),maxZoom:11,animate:false});
    return true;
  }

  resizeMap() {
    if (!this.map || $('map-view').hidden) return;
    const center=this.map.getCenter(), zoom=this.map.getZoom();
    this.map.invalidateSize({animate:false,pan:false});
    this.map.setView(center,zoom,{animate:false});
  }

  activity(n) {
    if (n.self || n.receiver) return state?.connection.phase === 'connected'
      ? {kind:'active',label:'Connected receiver',detail:'Bluetooth connected on this computer.'}
      : {kind:'unknown',label:'Receiver disconnected',detail:'Live listening is paused.'};
    const now = Date.now()/1000;
    // Queued-message retrieval is not an RF timestamp. An unknown or ambiguous
    // relay step never contributes evidence for a named radio.
    let stamp = n.time_basis === 'Message retrieved from radio' ? null : n.last_heard;
    if (!Number.isFinite(stamp) || stamp <= 0 || stamp > now) stamp = null;
    let basis = 'Advert/message';
    const relay = this.relaySeen.get(n.id);
    if (relay && relay <= now && now-relay <= 86400 && (!stamp || relay > stamp)) {stamp=relay;basis='Relay ID (inferred)';}
    if (!stamp) return {kind:'unknown',label:'Activity unknown',detail:'No usable reception time. This does not mean the radio is off.'};
    const elapsed = now-stamp;
    const kind = elapsed < 3600 ? 'active' : elapsed < 7200 ? 'quiet' : 'inactive';
    const label = kind === 'active' ? 'Active · seen <1h' : kind === 'quiet' ? 'Quiet · seen 1–2h ago' : 'Possibly inactive · unseen 2h+';
    const shortAge = elapsed < 3600 ? '<1h' : elapsed < 86400 ? Math.floor(elapsed/3600)+'h' : Math.floor(elapsed/86400)+'d';
    return {kind,label,shortAge,detail:basis+' · '+age(elapsed)+' ago. Silence does not prove the radio is off.'};
  }

  selectNode(id) {
    const radio = state?.nodes.find(n=>n.id===id) || this.data?.nodes.find(n=>n.id===id);
    choose(radio?.conversation || 'node:'+id,id);
  }

  popupHeight() {
    // Keep the whole popup above a centered marker, even on a short map.
    return Math.max(80,Math.min(110,Math.floor(this.map.getSize().y/2)-65));
  }

  focusNode(id) {
    this.routeSelection=id;
    $('map-line-mode').value=id === this.data?.topology?.receiver.id ? 'mine' : 'node';
    this.renderSelection(); this.renderRoutes();
    const n=this.data?.nodes.find(n=>n.id===id), marker=this.markers.get(id);
    if (!this.map || !this.data) {this.pendingFocus=id;return;}
    this.pendingFocus=null;
    if (!n || !marker) {this.map.closePopup();return;}
    this.map.fitBounds(L.latLng(n.position).toBounds(10000),{padding:this.fitPadding(),maxZoom:12,animate:false});
    marker.getPopup().options.maxHeight=this.popupHeight();
    marker.openPopup();
  }

  renderSelection() {
    const id=this.routeSelection, n=this.data?.nodes.find(n=>n.id===id) || state?.nodes.find(n=>n.id===id);
    const panel=$('map-selection');
    panel.hidden=!n;
    const details=$('map-node-panel'), toggle=$('map-node-toggle');
    if (details.dataset.radioId !== (n?.id || '')) {
      details.dataset.radioId=n?.id || '';details.dataset.expanded='false';toggle.setAttribute('aria-expanded','false');
    }
    details.dataset.hasSelection=String(!!n);
    toggle.textContent=n ? n.name+' · Details' : 'Radio details';
    $('map-node-content').replaceChildren(n ? this.nodeDetails(n) : node('p','','Select a radio on the map to see its connections and details here.'));
    if (!n) return;
    const located=!!this.data?.nodes.some(row=>row.id===id);
    panel.textContent=n.name+' · '+this.activity(n).label+(located ? '' : ' · Location unknown; cannot center this radio.')+
      (n.conversation ? ' · Select Messages for this conversation.' : ' · Select Messages for radio details.');
  }

  popup(n) {
    const box=node('div','map-popup');
    const activity=this.activity(n);
    box.append(node('strong','',n.name),node('p','activity-'+activity.kind,activity.label));
    return box;
  }

  nodeDetails(n) {
    const box=node('div','map-popup');
    box.dataset.radioId=n.id;
    box.append(node('h3','',n.name));
    const badges=node('div','map-popup-badges');
    for (const badge of n.badges || []) badges.append(node('span','node-badge'+(badge==='Ours' ? ' owned' : ''),badge));
    if (n.type===2) badges.append(node('span','node-badge','Repeater'));
    const activity=this.activity(n);
    box.append(badges,node('p','map-activity activity-'+activity.kind,activity.label),node('p','',activity.detail),this.connectionDetails(n));
    const facts=node('dl','map-popup-facts');
    const fields=[['Last advert/message',n.last_heard ? heardLabel(n) : n.self ? 'This is your receiver' : 'None received'],['Observed hops',n.hops ?? 'Unknown'],
      ['Distance',n.position_basis==='Private roof reference' ? 'At your home reference' : rangeLabel(n)],['Position',n.position_basis || 'Location unknown']];
    if (n.position_basis!=='Private roof reference' && n.position_observed_at) fields.push(['Position received',new Date(n.position_observed_at*1000).toLocaleString()]);
    if (n.snr!=null) fields.push(['SNR',n.snr+' dB']);
    for (const [label,value] of fields) {const row=node('div');row.append(node('dt','',label),node('dd','',value));facts.append(row);}
    box.append(facts);
    if(n.conversation) box.append(node('p','','Select the Messages tab for this conversation.'));
    return box;
  }

  connectionDetails(n) {
    const section=node('section','map-popup-links');
    section.append(node('h4','','Observed connections'));
    const graph=this.data?.topology;
    if(!graph) {section.append(node('p','','No route information recorded yet.'));return section;}
    const neighbours=graph.edges.filter(e=>e.source===n.id || e.target===n.id);
    if(neighbours.length) {
      const list=node('ul');
      for(const e of neighbours) list.append(node('li','',this.nodeName(e.source)+' → '+this.nodeName(e.target)+' · '+
        (e.kind==='direct-reception' ? 'no relays' : 'inferred relay link')+' · '+age(Date.now()/1000-e.last_seen)+' ago'));
      section.append(list);
    } else section.append(node('p','','No adjacent relay identified yet.'));
    const reception=graph.receptions.find(r=>r.source===n.id);
    if(reception) section.append(node('p','','Heard by '+graph.receiver.name+' · '+(reception.hops==null ? 'hop count unknown' : reception.hops+' observed hops')+'. This does not prove a direct link or a reply path.'));
    if(n.id===graph.receiver.id) section.append(node('p','',graph.receptions.length+' radios heard in the last 24 hours. '+graph.receiver.position_basis+'.'));
    if(n.position_basis==='Private roof reference') section.append(node('p','',neighbours.length
      ? 'Your roof’s short ID appears in a captured path. Its map position is your private home reference.'
      : 'This marker is your roof reference. No captured path has identified it as a relay yet.'));
    const paths=graph.paths.filter(p=>p.steps.some(s=>s.id===n.id));
    if(paths.length) section.append(node('p','',paths.length+' recorded paths involve this node. Open Legend & details in the map corner for the route list, unknown relays and the full sequence.'));
    section.append(node('p','','One-way observations only. Relay names matched from short IDs can be wrong.'));
    return section;
  }

  nodeName(id) {
    return this.data.nodes.find(n=>n.id===id)?.name || this.data.unlocated.find(n=>n.id===id)?.name || id.slice(0,12);
  }

  renderRoutes() {
    if(!this.data?.topology || !this.lines) return;
    this.lines.clearLayers();
    const graph=this.data.topology, mode=$('map-line-mode').value;
    const selected=this.routeSelection || graph.receiver.id;
    const focus=mode==='mine' ? graph.receiver.id : selected;
    const paths=graph.paths.filter(p=>mode==='all' || p.steps.some(s=>s.id===focus));
    const relevant=mode==='all' ? graph.edges : graph.edges.filter(e=>e.source===focus || e.target===focus);
    let drawn=0;
    const line=(from,to,kind,label)=> {
      const a=this.data.nodes.find(n=>n.id===from),b=this.data.nodes.find(n=>n.id===to);
      if(!a || !b || from===to) return;
      if(kind!=='direct-reception' && kind!=='inferred-relay') return;
      const style=kind==='direct-reception' ? {color:'#17683e',weight:4,opacity:0.9} : {color:'#70459a',weight:4,dashArray:'8 6',opacity:0.85};
      const tip=node('span','map-link-label',this.nodeName(from)+' → '+this.nodeName(to)+' · '+label);
      const endpoint=n=>n.receiver ? this.map.layerPointToLatLng(this.map.latLngToLayerPoint(n.position).add([-this.receiverOffset,0])) : n.position;
      L.polyline([endpoint(a),endpoint(b)],style).bindTooltip(tip,{sticky:true}).addTo(this.lines);
      drawn++;
    };
    if(mode!=='off') {
      for(const e of relevant) line(e.source,e.target,e.kind,(e.kind==='direct-reception' ? 'received without relays' : 'inferred from a recorded path')+' · '+age(Date.now()/1000-e.last_seen)+' ago');
    }
    $('map-route-summary').textContent=(mode==='node' ? 'Adjacent links for '+this.nodeName(selected) : mode==='all' ? 'All observed adjacent links' : mode==='off' ? 'Lines hidden' : 'Adjacent links for '+graph.receiver.name)+
      ' · '+drawn+' mapped lines · '+paths.length+' saved paths';
    $('map-route-note').textContent='Last 24 hours. R marks your receiver. '+graph.receiver.position_basis+
      '. Lines connect consecutive radios in captured paths only. Unknown relays or locations leave gaps. Dashed links use short-ID matches, which can be ambiguous beyond our known radios. No return link is assumed.';
    const list=paths.slice().sort((a,b)=>b.last_seen-a.last_seen).slice(0,40).map(p=>node('li','',
      p.steps.map(s=>s.name+(s.match==='prefix' ? ' (ID match)' : '')).join(' → ')+' · '+age(Date.now()/1000-p.last_seen)+' ago'));
    if(!list.length) list.push(node('li','','No relay path recorded for this selection yet. New received adverts will fill this in automatically; older hop counts cannot reconstruct a path.'));
    if(paths.length>40) list.push(node('li','',String(paths.length-40)+' older paths omitted from this list.'));
    $('map-route-list').replaceChildren(...list);
  }
}
