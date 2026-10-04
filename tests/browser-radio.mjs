// Offline direct-radio regression tests. No device, RF transmission, or network.
import assert from 'node:assert/strict';
import {BrowserRadio} from '../app/browser-radio.mjs';
import Connection from '../app/vendor/meshcore/src/connection/connection.js';
import C from '../app/vendor/meshcore/src/constants.js';

class RadioFixture extends Connection {
  constructor(){super();this.sent=[];this.incoming=[];this.syncs=0;}
  async sendCommandSendChannelTxtMsg(...args){this.sent.push(args);this.emit(C.ResponseCodes.Ok,{});}
  async sendCommandSyncNextMessage(){
    this.syncs++;
    const message=this.incoming.shift();
    this.emit(message?C.ResponseCodes.ChannelMsgRecv:C.ResponseCodes.NoMoreMessages,message||{});
  }
  async close(){this.onDisconnected();}
}
function historyFixture(){
  return {
    failWrites:0,rows:[],
    transaction(){
      const history=this,tx={};
      tx.objectStore=()=>({put(rows){
        const saved=structuredClone(rows),fail=history.failWrites>0;
        if(fail)history.failWrites--;
        queueMicrotask(()=>{if(fail)tx.onerror();else{history.rows=saved;tx.oncomplete();}});
      }});
      return tx;
    }
  };
}
function fixture(){
  const link=new RadioFixture(),radio=new BrowserRadio(link,'usb');
  radio.key='11'.repeat(32);
  radio.channels=[{id:'channel:0',index:0,name:'Public'}];
  radio.db=historyFixture();
  return {radio,link};
}

// The composer retains the same request ID after an API error. Retrying after
// a failed pre-send history write must transmit, not return an unsent cache row.
{
  const {radio,link}=fixture();
  const request={conversation:'channel:0',text:'Synthetic retry',request_id:'synthetic-retry'};
  radio.db.failWrites=1;
  await assert.rejects(radio.api('/api/messages',request),/save radio history/);
  assert.equal(link.sent.length,0);
  assert.equal(radio.db.rows.length,0);
  assert.equal(radio.rows.length,0,'An unsent request must not remain in the success cache');
  const sent=await radio.api('/api/messages',request);
  assert.equal(link.sent.length,1);
  assert.equal(sent.status,'Accepted by radio · group delivery unconfirmed');
  assert.equal(radio.db.rows.length,1);
  assert.equal(radio.db.rows[0].status,sent.status);
  assert.equal(await radio.api('/api/messages',request),sent);
  assert.equal(link.sent.length,1,'A completed request must still be idempotent');
}

// If the post-send write fails, RF may already have happened. A retry must
// never transmit the message again just because its final status was not saved.
{
  const {radio,link}=fixture();
  const request={conversation:'channel:0',text:'Already sent',request_id:'synthetic-sent'};
  const send=link.sendCommandSendChannelTxtMsg.bind(link);
  link.sendCommandSendChannelTxtMsg=async(...args)=>{radio.db.failWrites=1;await send(...args);};
  await assert.rejects(radio.api('/api/messages',request),/save radio history/);
  const sent=await radio.api('/api/messages',request);
  assert.equal(link.sent.length,1);
  assert.equal(sent.status,'Accepted by radio · group delivery unconfirmed');
}

// SyncNextMessage consumes queued messages. After a storage error, subsequent
// state polls must save the pending message before consuming any more of them.
{
  const {radio,link}=fixture();
  radio.ready=true;
  radio.info={name:'Synthetic radio'};
  link.incoming=[1,2].map(n=>({channelIdx:0,pathLen:0,txtType:0,senderTimestamp:n,text:'Peer: Message '+n}));
  radio.db.failWrites=3;
  for(let i=0;i<3;i++)await assert.rejects(radio.api('/api/state'),/save radio history/);
  assert.equal(link.syncs,1,'Polling must not consume more messages while storage is failing');
  assert.equal(link.incoming.length,1);
  assert.equal(radio.rows.length,1);
  assert.equal(radio.db.rows.length,0);
  await radio.api('/api/state');
  assert.equal(link.syncs,3);
  assert.equal(link.incoming.length,0);
  assert.deepEqual(radio.db.rows.map(row=>row.text),['Message 1','Message 2']);
  assert.deepEqual(radio.rows.map(row=>row.id),[1,2]);
}
// A disconnect cannot discard a failed save or transfer it into a different
// radio adapter. Closing rejects until its own history can be persisted.
{
  const first=fixture(),second=fixture();
  first.radio.ready=true;
  first.link.incoming=[{channelIdx:0,pathLen:0,txtType:0,senderTimestamp:1,text:'Peer: First radio only'}];
  first.radio.db.failWrites=2;
  await assert.rejects(first.radio.drain(),/save radio history/);
  await assert.rejects(first.radio.close(),/save radio history/);
  assert.equal(first.radio.phase,'disconnected');
  assert.equal(first.radio.ready,false);
  assert.equal(first.radio.rows.length,1,'Failed close must retain the pending message');
  await first.radio.drain();
  assert.equal(first.link.syncs,1,'A disconnected adapter must not consume any more messages');
  second.radio.key='22'.repeat(32);
  second.link.incoming=[{channelIdx:0,pathLen:0,txtType:0,senderTimestamp:2,text:'Peer: Second radio only'}];
  await second.radio.drain();
  assert.deepEqual(second.radio.db.rows.map(row=>row.text),['Second radio only']);
  await first.radio.close();
  assert.deepEqual(first.radio.db.rows.map(row=>row.text),['First radio only']);
  assert.deepEqual(second.radio.db.rows.map(row=>row.text),['Second radio only']);
}
console.log('Passed direct-radio persistence failures, safe send retry, post-send idempotency, incoming drain recovery, and disconnect/device isolation.');
