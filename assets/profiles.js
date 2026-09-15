'use strict';
const $ = id => document.getElementById(id);
const make = (tag,cls,text) => {const el=document.createElement(tag);el.className=cls || '';if(text!==undefined)el.textContent=text;return el;};
let lookupRun=0, proposed=null;
function card(profile) {
  const box=make('article','profile'), details=make('div');
  if (profile.avatar_url) {
    const image=make('img','avatar');image.src=MeshcastProfiles.https(profile.avatar_url);image.alt=profile.display_name+' profile image';image.referrerPolicy='no-referrer';image.loading='lazy';
    image.addEventListener('error',()=>image.remove());box.append(image);
  }
  details.append(make('h3','',profile.display_name),make('p','mono',profile.public_key));
  const maintained=profile.verification?.status==='site-maintained';
  details.append(make('span','badge',maintained ? 'Site-maintained · no automated verification' : 'Unverified profile'));
  if(profile.bio) details.append(make('p','',profile.bio));
  const links=make('div','profile-links');
  for (const entry of profile.links) {const link=make('a','',entry.label || new URL(entry.url).hostname);link.href=MeshcastProfiles.https(entry.url);link.target='_blank';link.rel='noopener noreferrer';links.append(link);}
  details.append(links);box.append(details);return box;
}
async function fetchProfile(key) {
  const response=await fetch('profiles/'+key+'.json');
  if(response.status===404) return null;
  if(!response.ok) throw new Error('The directory could not be loaded. Try again later.');
  return MeshcastProfiles.validate(await response.json(),key);
}
async function lookup() {
  const run=++lookupRun;$('lookup-result').replaceChildren();
  try {
    const key=MeshcastProfiles.key($('lookup-key').value);$('lookup-status').textContent='Looking up this public key…';
    const profile=await fetchProfile(key);if(run!==lookupRun)return;
    history.replaceState(null,'','#'+key);
    if(!profile) {$('lookup-status').textContent='No published profile for this key yet. You can create a submission below.';return;}
    $('lookup-result').append(card(profile));$('lookup-status').textContent='Profile found. The directory is opt-in, not a list of every radio.';
  } catch(error) {if(run===lookupRun)$('lookup-status').textContent=error.message;}
}
$('lookup-form').addEventListener('submit',event=>{event.preventDefault();lookup();});
$('lookup-key').addEventListener('input',()=>{lookupRun++;$('lookup-result').replaceChildren();$('lookup-status').textContent='';});
$('profile-form').addEventListener('input',()=>{proposed=null;$('profile-preview').hidden=true;$('profile-status').textContent='';});
$('profile-form').addEventListener('submit',event=>{
  event.preventDefault();proposed=null;$('profile-preview').hidden=true;
  try {
    if(!$('profile-consent').checked)throw new Error('Confirm that you have permission to submit this public profile.');
    proposed=MeshcastProfiles.create({key:$('profile-key').value,name:$('profile-name').value,bio:$('profile-bio').value,avatar:$('profile-avatar').value,links:$('profile-links').value});
    const json=JSON.stringify(proposed,null,2);
    $('profile-json').textContent=json;$('preview-card').replaceChildren(card(proposed));
    const body='Please review this opt-in profile submission.\n\nI confirm I control this node or have permission to submit it. I understand this record is public.\n\nOwnership evidence (public proof links only; never private keys):\n\n```json\n'+json+'\n```';
    const issue='https://github.com/steveseguin/oak/issues/new?title='+encodeURIComponent('Profile: '+proposed.display_name)+'&body='+encodeURIComponent(body);
    $('profile-submit').href=issue.length<7500 ? issue : 'https://github.com/steveseguin/oak/issues/new';
    $('profile-submit').textContent=issue.length<7500 ? 'Open GitHub submission' : 'Open GitHub and attach the downloaded JSON';
    $('profile-preview').hidden=false;$('profile-status').textContent='Preview ready. Nothing has been published.';
  } catch(error) {$('profile-status').textContent=error.message;}
});
$('profile-download').addEventListener('click',()=>{
  if(!proposed)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(proposed,null,2)+'\n'],{type:'application/json'}));
  const link=make('a');link.href=url;link.download=proposed.public_key+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
async function directory() {
  try {
    const response=await fetch('profiles/index.json');if(!response.ok)throw Error();
    const data=await response.json();if(data.schema_version!==1 || !Array.isArray(data.profiles))throw Error();
    const entries=data.profiles.map(entry=>{
      const key=MeshcastProfiles.key(entry.public_key), box=make('article','card'), link=make('a','text-link',entry.display_name || key);
      link.href='#'+key;link.addEventListener('click',event=>{event.preventDefault();$('lookup-key').value=key;lookup();$('lookup-form').scrollIntoView({block:'start'});});
      box.append(link,make('p','mono',key));return box;
    });
    $('directory').replaceChildren(...(entries.length ? entries : [make('p','','No profiles have been published yet.')]));
  } catch(_) {$('directory').textContent='The directory is unavailable. Please try again later.';}
}
function fromHash(){const value=location.hash.slice(1);if(/^[a-fA-F0-9]{64}$/.test(value)){$('lookup-key').value=value;lookup();}}
window.addEventListener('hashchange',fromHash);directory();fromHash();
