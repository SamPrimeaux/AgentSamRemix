/**
 * Injected into storefront HTML when ?cms=1 — Shopify-style section pick / outline.
 * Speaks the cms:* postMessage contract with the dashboard ThemeStudio shell.
 */

export const CMS_EMBED_PICK_STYLE = `<style>
[data-section-key],[data-cms-section]{scroll-margin-top:24px;cursor:pointer}
[data-section-key]:hover,[data-cms-section]:hover{outline:2px dashed rgba(37,99,235,.55);outline-offset:-2px}
[data-cms-selected],[data-cms-section].iam-cms-section-focus{outline:2px solid #2563eb;outline-offset:-2px}
[data-cms-editable].iam-cms-field-focus,[data-cms-field].iam-cms-field-focus{outline:2px dashed #0d9488;outline-offset:2px}
.cms-action-pill{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);background:#fff;border:1px solid #e5e7eb;border-radius:24px;padding:6px 14px;display:flex;align-items:center;gap:8px;box-shadow:0 2px 8px rgba(0,0,0,.12);z-index:9999;white-space:nowrap;font:12px/1.2 system-ui,sans-serif;color:#374151}
.cms-action-pill button{background:none;border:none;cursor:pointer;padding:4px;font-size:13px;color:#374151}
.cms-action-pill button[data-action="delete"]{color:#ef4444}
</style>`;

export const CMS_EMBED_PICK_SCRIPT = `<script>(function(){
if(window.__iamCmsPickV2)return;window.__iamCmsPickV2=1;
function sectionKey(el){return el.getAttribute('data-section-key')||el.getAttribute('data-cms-section')||'';}
function ensureKeys(){
  document.querySelectorAll('[data-cms-section]:not([data-section-key])').forEach(function(el){
    el.setAttribute('data-section-key',el.getAttribute('data-cms-section')||'');
  });
}
function clearSelection(){
  document.querySelectorAll('[data-cms-selected],.iam-cms-section-focus').forEach(function(el){
    el.removeAttribute('data-cms-selected');
    el.classList.remove('iam-cms-section-focus');
    el.style.outline='';el.style.outlineOffset='';
    var pill=el.querySelector('.cms-action-pill');if(pill)pill.remove();
  });
}
function injectPill(el,key){
  var existing=el.querySelector('.cms-action-pill');if(existing)existing.remove();
  var pill=document.createElement('div');
  pill.className='cms-action-pill';
  pill.innerHTML='<span>Edit section</span><button type="button" data-action="duplicate" title="Duplicate">Dup</button><button type="button" data-action="hide" title="Hide">Hide</button><button type="button" data-action="delete" title="Delete">Del</button>';
  if(!el.style.position||el.style.position==='static')el.style.position='relative';
  el.appendChild(pill);
  pill.addEventListener('click',function(ev){
    ev.preventDefault();ev.stopPropagation();
    var t=ev.target;var action=t&&t.dataset&&t.dataset.action;
    if(action){try{parent.postMessage({type:'cms:section-action',sectionKey:key,action:action},'*');}catch(_){}}
  });
}
function selectKey(key){
  ensureKeys();
  clearSelection();
  if(!key)return;
  var el=document.querySelector('[data-section-key="'+CSS.escape(key)+'"]')||document.querySelector('[data-cms-section="'+CSS.escape(key)+'"]');
  if(!el)return;
  el.setAttribute('data-cms-selected','1');
  el.classList.add('iam-cms-section-focus');
  el.style.outline='2px solid #2563eb';
  el.style.outlineOffset='-2px';
  try{el.scrollIntoView({behavior:'smooth',block:'nearest'});}catch(_){}
  injectPill(el,key);
}
function reportSections(){
  ensureKeys();
  var sections=Array.from(document.querySelectorAll('[data-section-key]')).map(function(el){
    var r=el.getBoundingClientRect();
    return{key:sectionKey(el),rect:{top:r.top,left:r.left,width:r.width,height:r.height}};
  });
  try{parent.postMessage({type:'cms:sections-ready',sections:sections},'*');}catch(_){}
}
window.addEventListener('message',function(e){
  var d=e&&e.data;if(!d||typeof d!=='object')return;
  if(d.type==='cms:select-section')selectKey(d.sectionKey||'');
  if(d.type==='cms:deselect')clearSelection();
});
document.addEventListener('click',function(e){
  var el=e.target&&e.target.closest?e.target.closest('[data-section-key],[data-cms-section]'):null;
  if(!el)return;
  e.preventDefault();e.stopPropagation();
  var key=sectionKey(el);
  selectKey(key);
  try{parent.postMessage({type:'cms:section-clicked',sectionKey:key},'*');}catch(_){}
  try{parent.postMessage({type:'iam-cms-select-section',section_name:key,tag:el.tagName.toLowerCase(),text:(el.innerText||'').slice(0,500),src:null},'*');}catch(_){}
},true);
document.addEventListener('mouseover',function(e){
  var el=e.target&&e.target.closest?e.target.closest('[data-section-key],[data-cms-section]'):null;
  if(!el)return;
  try{parent.postMessage({type:'cms:section-hovered',sectionKey:sectionKey(el)},'*');}catch(_){}
});
if(document.readyState==='complete')reportSections();
else window.addEventListener('load',reportSections);
})();</script>`;
