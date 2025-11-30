(function(){const sel=document.getElementById('theme-select');function apply(name){document.body.classList.remove('theme-dark','theme-light','theme-neon','theme-purple');document.body.classList.add(name);try{localStorage.setItem('theme',name)}catch(e){}}
if(sel){sel.addEventListener('change',e=>apply(e.target.value));}
const saved=localStorage.getItem('theme')||'theme-dark';apply(saved);if(sel)sel.value=saved;})();
