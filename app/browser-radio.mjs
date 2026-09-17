import Connection from './vendor/meshcore/src/connection/connection.js';
import SerialConnection from './vendor/meshcore/src/connection/serial_connection.js';
import C from './vendor/meshcore/src/constants.js';

// Use the upstream protocol codec with explicit, awaited browser transport setup.
// No radio configuration, time synchronization, advert, or RF send on connection.
class BleTransport extends Connection {
  async connect(device) {
    this.device=device;
    device.addEventListener('gattserverdisconnected',()=>this.onDisconnected());
    try {
      this.gatt=await device.gatt.connect();
      const service=await this.gatt.getPrimaryService(C.Ble.ServiceUuid.toLowerCase());
      this.rx=await service.getCharacteristic(C.Ble.CharacteristicUuidRx.toLowerCase());
      this.tx=await service.getCharacteristic(C.Ble.CharacteristicUuidTx.toLowerCase());
      this.tx.addEventListener('characteristicvaluechanged',event=>{
        const v=event.target.value;this.onFrameReceived(new Uint8Array(v.buffer,v.byteOffset,v.byteLength));
      });
      await this.tx.startNotifications();
    } catch(error){await this.close();throw error;}
    return this;
  }
  async sendToRadioFrame(frame){await this.rx.writeValue(frame);}
  async close(){this.device?.gatt.disconnect();this.onDisconnected();}
}
class UsbTransport extends SerialConnection {
  async connect(port) {
    this.port=port;await port.open({baudRate:115200});
    this.reader=port.readable.getReader();this.reading=this.read();return this;
  }
  async read(){
    try {while(true){const {value,done}=await this.reader.read();if(done)break;await this.onDataReceived(value);}}
    catch(_){}finally{this.reader.releaseLock();this.onDisconnected();}
  }
  async write(bytes){const writer=this.port.writable.getWriter();try{await writer.write(bytes);}finally{writer.releaseLock();}}
  async close(){if(this.closing)return;this.closing=true;try{await this.reader?.cancel();await this.reading;await this.port?.close();}finally{this.onDisconnected();}}
}
export async function openRadio(mode){
  if(mode==='bluetooth'){
    if(!navigator.bluetooth)throw new Error('Bluetooth needs a supported browser, such as Chrome on Android or desktop.');
    const device=await navigator.bluetooth.requestDevice({filters:[{services:[C.Ble.ServiceUuid.toLowerCase()]}]});
    return new BleTransport().connect(device);
  }
  if(!navigator.serial)throw new Error('This browser has no USB Serial support. Use desktop Chrome/Edge, Bluetooth, or a server.');
  const port=await navigator.serial.requestPort();return new UsbTransport().connect(port);
}
export const hex=bytes=>Array.from(bytes||[],n=>n.toString(16).padStart(2,'0')).join('');
const bytes=key=>Uint8Array.from(key.match(/../g)||[],n=>Number.parseInt(n,16));
const now=()=>Date.now()/1000;
function point(lat,lon){return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90000000&&Math.abs(lon)<=180000000&&(lat||lon)?[lat/1e6,lon/1e6]:null;}
function openHistory(key){return new Promise((resolve,reject)=>{
  const request=indexedDB.open('oak-radio-'+key,1);
  request.onupgradeneeded=()=>request.result.createObjectStore('history');
  request.onerror=()=>reject(new Error('Browser storage is unavailable. Allow site storage to retain radio messages.'));
  request.onsuccess=()=>resolve(request.result);
});}
export class BrowserRadio {
  constructor(link,mode){
    this.link=link;this.mode=mode;this.phase='connected';this.contacts=[];this.channels=[];this.rows=[];this.nextId=1;this.stats={};this.queue=Promise.resolve();this.lastSend=0;this.draining=false;this.acks=new Map();
    link.on('disconnected',()=>{this.phase='disconnected';});
    link.on(C.PushCodes.SendConfirmed,p=>{this.acks.set(p.ackCode,now());for(const row of this.rows)if(row.ack===p.ackCode&&now()-row.received_at<300)row.status='Acknowledged by recipient';this.save().catch(e=>{this.error=e.message;});});
    link.on(C.PushCodes.MsgWaiting,()=>{if(this.ready)this.drain().catch(e=>{this.error=e.message;});});
  }
  async initialize(){
    const self=await this.command(()=>this.link.sendCommandAppStart(),[C.ResponseCodes.SelfInfo]);
    this.key=hex(self.publicKey);if(!/^[a-f0-9]{64}$/.test(this.key))throw new Error('The radio did not supply a valid identity.');
    this.info={name:self.name,public_key:this.key,radio_freq:self.radioFreq/1000,radio_bw:self.radioBw/1000,radio_sf:self.radioSf,radio_cr:self.radioCr,tx_power:self.txPower};
    this.position=point(self.advLat,self.advLon);
    this.db=await openHistory(this.key);
    const saved=await new Promise((resolve,reject)=>{const req=this.db.transaction('history').objectStore('history').get('messages');req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});
    this.rows=saved;this.nextId=Math.max(0,...saved.map(row=>row.id))+1;
    for(const row of this.rows)if(['Sending','Awaiting acknowledgement'].includes(row.status))row.status='Unconfirmed after reconnect';
    await this.refresh();this.ready=true;await this.drain();return this;
  }
  command(write,codes,collect){
    const run=()=>new Promise((resolve,reject)=>{
      if(this.phase!=='connected'){reject(new Error('Radio disconnected. Choose a connection again.'));return;}
      const handlers=[];let timer,finished=false;
      const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);for(const [code,fn]of handlers)this.link.off(code,fn);error?reject(error):resolve(value);};
      for(const code of codes){const fn=value=>finish(null,{...value,responseCode:code});handlers.push([code,fn]);this.link.on(code,fn);}
      if(collect){handlers.push([C.ResponseCodes.Contact,collect]);this.link.on(C.ResponseCodes.Contact,collect);}
      const failed=()=>finish(new Error('Radio rejected the command.'));handlers.push([C.ResponseCodes.Err,failed]);this.link.on(C.ResponseCodes.Err,failed);
      timer=setTimeout(()=>{this.phase='disconnected';this.link.close();finish(new Error('Radio response timed out. Nothing will be resent automatically.'));},12000);
      Promise.resolve().then(write).catch(error=>{this.phase='disconnected';this.link.close();finish(error);});
    });
    const result=this.queue.then(run);this.queue=result.catch(()=>{});return result;
  }
  async refresh(){
    const contacts=[];await this.command(()=>this.link.sendCommandGetContacts(),[C.ResponseCodes.EndOfContacts],c=>contacts.push(c));this.rawContacts=contacts;
    this.contacts=contacts.map(c=>({public_key:hex(c.publicKey),adv_name:c.advName,type:c.type,flags:c.flags,position:point(c.advLat,c.advLon)}));
    const channels=[];this.slots=[];
    // A missing slot is a normal explicit radio error; a timeout closes the link.
    for(let i=0;i<64;i++){
      let channel;try{channel=await this.command(()=>this.link.sendCommandGetChannel(i),[C.ResponseCodes.ChannelInfo]);}
      catch(error){if(this.phase!=='connected')throw error;break;}
      this.slots.push(channel);
      if(channel.name)channels.push({id:'channel:'+i,index:i,name:channel.name,private:i!==0&&!channel.name.startsWith('#')});
    }
    this.channels=channels;
    const voltage=await this.command(()=>this.link.sendCommandGetBatteryVoltage(),[C.ResponseCodes.BatteryVoltage]);
    this.stats.core={battery_mv:voltage.batteryMilliVolts};this.updated=now();
  }
  async drain(){
    if(this.draining||this.phase!=='connected')return;this.draining=true;
    try{for(let i=0;i<500;i++){
      const p=await this.command(()=>this.link.sendCommandSyncNextMessage(),[C.ResponseCodes.ContactMsgRecv,C.ResponseCodes.ChannelMsgRecv,C.ResponseCodes.NoMoreMessages,C.ResponseCodes.ChannelDataRecv]);
      if(p.responseCode===C.ResponseCodes.NoMoreMessages)break;
      if(p.responseCode===C.ResponseCodes.ChannelDataRecv||p.txtType!==0)continue;
      let conversation,sender,text=p.text;
      if(p.responseCode===C.ResponseCodes.ChannelMsgRecv){conversation='channel:'+p.channelIdx;const at=text.indexOf(': ');sender=at<0?'Channel member':text.slice(0,at);if(at>=0)text=text.slice(at+2);}
      else{const prefix=hex(p.pubKeyPrefix),matches=this.contacts.filter(c=>c.public_key.startsWith(prefix));sender=matches.length===1?matches[0].public_key:prefix;conversation='dm:'+sender;}
      const fingerprint=JSON.stringify([conversation,sender,p.senderTimestamp,text]);
      if(this.rows.some(r=>r.fingerprint===fingerprint))continue;
      this.rows.push({id:this.nextId++,conversation,sender,text,direction:'in',timestamp:p.senderTimestamp,received_at:now(),status:'Received',snr:p.snr,hops:p.pathLen===255?null:p.pathLen,provenance:'MeshCore RF',fingerprint});
      // Commit each drained message before asking the radio for another.
      await this.save();
    }}finally{this.draining=false;}
  }
  save(){
    if(!this.db)return Promise.resolve();
    return new Promise((resolve,reject)=>{const tx=this.db.transaction('history','readwrite');tx.objectStore('history').put(this.rows,'messages');tx.oncomplete=resolve;tx.onerror=()=>reject(new Error('Could not save radio history.'));});
  }
  nodes(){
    const latest=new Map();for(const r of this.rows)if(r.direction==='in')latest.set(r.sender,Math.max(latest.get(r.sender)||0,r.received_at));
    const result=this.contacts.map(c=>({id:c.public_key,public_key:c.public_key,name:c.adv_name||c.public_key.slice(0,12),type:c.type,own:c.public_key===this.key,self:c.public_key===this.key,can_message:c.type===1&&c.public_key!==this.key,conversation:c.type===1&&c.public_key!==this.key?'dm:'+c.public_key:null,identity:'Saved radio contact',badges:[],last_heard:latest.get(c.public_key)||null,time_basis:'Message retrieved from radio',hops:null,range_km:null,position:c.position}));
    if(!result.some(c=>c.id===this.key))result.unshift({id:this.key,name:this.info.name,type:1,own:true,self:true,identity:'Connected radio',badges:[],last_heard:now(),hops:0,range_km:null,position:this.position});
    for(const [name,stamp]of latest)if(!result.some(c=>c.id===name)){const row=this.rows.findLast(r=>r.sender===name&&r.direction==='in');result.push({id:'name:'+name,name,type:1,own:false,self:false,conversation:row.conversation,identity:row.conversation.startsWith('channel:')?'Channel name only':'Unresolved direct sender',badges:[],last_heard:stamp,time_basis:'Message retrieved from radio',hops:null,range_km:null});}
    return result;
  }
  state(){
    const conversations=new Map();for(const row of this.rows){if(row.status==='Awaiting acknowledgement'&&row.ack_deadline<now())row.status='No acknowledgement received';const c=conversations.get(row.conversation)||{conversation:row.conversation,count:0,latest_id:0,last_activity:0};c.count++;c.latest_id=Math.max(c.latest_id,row.id);c.last_activity=Math.max(c.last_activity,row.received_at);conversations.set(row.conversation,c);}
    return {connection:{phase:this.phase,desired:this.phase==='connected',error:this.error||'',transport:this.mode==='bluetooth'?'Bluetooth':'USB'},radio:this.info,stats:this.stats,updated_at:this.updated,channels:this.channels,contacts:this.contacts,nodes:this.nodes(),conversations:[...conversations.values()],max_message_bytes:140,server_time:now()};
  }
  async send(body){
    if(!body||typeof body.text!=='string'||!body.text.trim()||new TextEncoder().encode(body.text).length>140||body.text.includes('\0')||typeof body.request_id!=='string'||body.request_id.length<8)throw new Error('Enter a message of 1–140 bytes.');
    const previous=this.rows.find(r=>r.request_id===body.request_id);if(previous){if(previous.text!==body.text||previous.conversation!==body.conversation)throw new Error('This request ID belongs to a different message.');return previous;}
    if(this.phase!=='connected')throw new Error('Connect a radio first.');
    if(now()-this.lastSend<3)throw new Error('Give the radio a moment before sending again.');
    const channel=this.channels.find(c=>c.id===body.conversation),contact=this.contacts.find(c=>'dm:'+c.public_key===body.conversation&&c.type===1);
    if(!channel&&!contact)throw new Error('Choose a configured channel or messaging contact.');
    const row={id:this.nextId++,conversation:body.conversation,sender:this.key,text:body.text,direction:'out',timestamp:Math.floor(now()),received_at:now(),status:'Sending',provenance:'MeshCore RF',request_id:body.request_id,snr:null,hops:null};
    this.lastSend=now();this.rows.push(row);await this.save();
    try{
      const reply=await this.command(()=>channel?this.link.sendCommandSendChannelTxtMsg(0,channel.index,row.timestamp,row.text):this.link.sendCommandSendTxtMsg(0,0,row.timestamp,bytes(contact.public_key),row.text),[channel?C.ResponseCodes.Ok:C.ResponseCodes.Sent]);
      row.status=channel?'Accepted by radio · group delivery unconfirmed':'Awaiting acknowledgement';
      if(!channel){row.ack=reply.expectedAckCrc;row.ack_deadline=now()+Math.max(15,Math.min(120,(reply.estTimeout||30000)/1000*1.5));if((this.acks.get(row.ack)||0)>=row.received_at)row.status='Acknowledged by recipient';}
    }catch(_){row.status='Send unconfirmed · check before resending';}
    await this.save();return row;
  }
  async api(path,body){
    const url=new URL(path,'https://local.invalid');
    if(url.pathname==='/api/state'){if(this.ready&&this.phase==='connected')await this.drain();return this.state();}
    if(url.pathname==='/api/map'){
      const nodes=this.nodes();return {nodes:nodes.filter(n=>n.position).map(n=>({...n,position_basis:n.self?'Radio-reported position':'Saved advertised location'})),unlocated:nodes.filter(n=>!n.position),topology:{paths:[],edges:[],receiver:{id:this.key,name:this.info.name,position:this.position,position_basis:'Radio-reported position'}}};
    }
    if(url.pathname==='/api/messages'){
      if(body)return this.send(body);
      const before=Number(url.searchParams.get('before'))||Infinity,limit=Math.max(1,Math.min(500,Number(url.searchParams.get('limit'))||100)),query=(url.searchParams.get('q')||'').toLowerCase(),conversation=url.searchParams.get('conversation');
      return {messages:this.rows.filter(r=>(!conversation||r.conversation===conversation)&&r.id<before&&r.text.toLowerCase().includes(query)).slice(-limit)};
    }
    if(url.pathname==='/api/radio'){
      if(body?.action==='disconnect'){await this.close();return {accepted:true};}
      if(body?.action==='refresh'){await this.refresh();await this.drain();return {accepted:true};}
      throw new Error('Use Change connection to select your radio again.');
    }
    if(url.pathname==='/api/channels'){
      const name=body?.name;if(!/^#[a-z0-9][a-z0-9_-]{0,29}$/.test(name||''))throw new Error('Use a lowercase hashtag channel.');
      const exists=this.channels.find(c=>c.name===name);if(exists)return exists;
      const index=this.slots.findIndex((c,i)=>i>=2&&!c.name&&c.secret.every(n=>n===0));if(index<0)throw new Error('No unused channel slot. Existing channels were preserved.');
      const secret=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(name))).slice(0,16);
      await this.command(()=>this.link.sendCommandSetChannel(index,name,secret),[C.ResponseCodes.Ok]);
      const actual=await this.command(()=>this.link.sendCommandGetChannel(index),[C.ResponseCodes.ChannelInfo]);
      if(actual.name!==name||hex(actual.secret)!==hex(secret))throw new Error('Channel readback did not match. Refresh before trying again.');
      this.slots[index]=actual;const channel={id:'channel:'+index,index,name,private:false};this.channels.push(channel);return channel;
    }
    throw new Error('This operation is unavailable for the selected connection.');
  }
  async close(){this.ready=false;this.phase='disconnected';await this.link.close();await this.save();}
}
