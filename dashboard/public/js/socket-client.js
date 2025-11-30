const socket = io();
socket.on('initialState', state=>{ updateList('#online-list', state.online||[]); updateList('#streaming-list', state.streaming||[]); });
socket.on('streamStart', d=> addToList('#streaming-list', d.displayName||d.username));
socket.on('streamStop', d=> removeFromList('#streaming-list', d.displayName||d.username));
function updateList(s,a){const e=document.querySelector(s); if(!e) return; e.innerHTML=a.map(x=>`<li>${x}</li>`).join('\n');}
function addToList(s,n){const e=document.querySelector(s); if(!e) return; if(!Array.from(e.children).some(li=>li.textContent===n)){const li=document.createElement('li'); li.textContent=n; e.appendChild(li);}}
function removeFromList(s,n){const e=document.querySelector(s); if(!e) return; Array.from(e.children).forEach(li=>{ if(li.textContent===n) li.remove(); });}
