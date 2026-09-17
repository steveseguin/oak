import {openRadio,BrowserRadio} from './browser-radio.mjs';
const $=id=>document.getElementById(id);
let adapter=null,scope='',launching=false;
export function serverUrl(value){
  const url=new URL(value);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use only the server address and port, without credentials or a path.');
  const loopback=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw new Error('Use HTTPS for a remote server. HTTP is allowed only for localhost.');
  return url.origin;
}
export class ServerConnection {
  constructor(base,key){this.base=serverUrl(base);this.key=key;}
  async api(path,data){
    if(!/^\/api\/(state|map|messages|radio|channels)(\?|$)/.test(path))throw new Error('Unsupported server request.');
    const headers={Authorization:'Bearer '+this.key};const options={headers,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)};
    if(data!==undefined){options.method='POST';headers['Content-Type']='application/json';options.body=JSON.stringify(data);}
    let response;
    try{response=await fetch(this.base+path,options);}catch(_){throw new Error('Server unreachable. Check its address, website access key, and browser local-network permission.');}
    if(response.status===401||response.status===403)throw new Error('Access denied. Create a new website access key in the local Oak Mesh app.');
    let value;try{value=await response.json();}catch(_){throw new Error('The address did not return an Oak Mesh response.');}
    if(!response.ok)throw new Error(value.error||'Server request failed.');return value;
  }
  // Closing this browser must not disconnect the server's radio collector.
  async close(){}
}
async function boot(){
  window.OakConnection={api:(path,data)=>adapter.api(path,data),storageKey:key=>'oak-client:'+scope+':'+key};
  $('connection-setup').hidden=true;document.querySelector('.workspace').hidden=false;
  const script=document.createElement('script');script.src='app.js';script.onerror=()=>{$('connection-setup').hidden=false;$('setup-status').textContent='The app could not load. Reload to try again.';};document.body.append(script);
}
async function start(mode){
  if(launching)return;launching=true;$('setup-status').textContent=mode==='server'?'Connecting to server…':'Choose your companion radio…';
  let link;
  try{
    if(mode==='server'){
      adapter=new ServerConnection($('server-url').value.trim(),$('server-key').value.trim());
      if(!adapter.key)throw new Error('Enter the website access key from your server.');
      const state=await adapter.api('/api/state');if(!state?.radio||!Array.isArray(state.channels)||!Array.isArray(state.nodes))throw new Error('This is not a compatible Oak Mesh server.');
      scope='server:'+adapter.base+':'+(state.radio.public_key||'default');
      // Tab-scoped login survives refresh; it is never embedded in a URL or HTML asset.
      try{localStorage.setItem('oak-last-server',adapter.base);}catch(_){}
      try{sessionStorage.setItem('oak-active-server',JSON.stringify({base:adapter.base,key:adapter.key}));}catch(_){}
    }else{
      link=await openRadio(mode);$('setup-status').textContent='Reading radio and saved messages…';
      adapter=await new BrowserRadio(link,mode).initialize();scope='radio:'+adapter.key;
    }
    $('server-key').value='';await boot();
  }catch(error){if(link)await link.close().catch(()=>{});adapter=null;try{sessionStorage.removeItem('oak-active-server');}catch(_){}$('setup-status').textContent=error.name==='NotFoundError'?'No device selected.':error.message||'Could not connect.';}
  finally{launching=false;}
}
if(typeof document!=='undefined'&&$('connection-setup')){
  try{$('server-url').value=serverUrl(localStorage.getItem('oak-last-server')||'http://127.0.0.1:8765');}catch(_){}
  $('server-form').addEventListener('submit',event=>{event.preventDefault();start('server');});
  $('choose-bluetooth').addEventListener('click',()=>start('bluetooth'));
  $('choose-usb').addEventListener('click',()=>start('usb'));
  $('choose-bluetooth').disabled=!navigator.bluetooth;$('choose-usb').disabled=!navigator.serial;
  $('server-connect').disabled=false;$('setup-status').textContent='';
  if(!navigator.bluetooth)$('bluetooth-note').textContent='Bluetooth is unavailable in this browser. Android Chrome supports it; iPhone Safari does not.';
  if(!navigator.serial)$('usb-note').textContent='USB Serial is unavailable here. Use desktop Chrome/Edge, Bluetooth, or a server.';
  $('change-connection').addEventListener('click',async()=>{try{sessionStorage.removeItem('oak-active-server');}catch(_){}await adapter?.close();location.reload();});
  window.addEventListener('pagehide',()=>{adapter?.close().catch(()=>{});},{once:true});
  try{const saved=JSON.parse(sessionStorage.getItem('oak-active-server')||'null');if(saved&&typeof saved.key==='string'){ $('server-url').value=serverUrl(saved.base);$('server-key').value=saved.key;start('server');}}catch(_){}
}
