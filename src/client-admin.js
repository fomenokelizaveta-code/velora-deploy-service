'use strict';

// Only the explicitly reviewed campaign sites use this editor.
const CLIENT_ADMIN_SLUGS = new Set([
  'viola-beauty-simferopol', 'stcolor-simferopol',
  'nova-rostov', 'belyi-krolik-krasnodar'
]);

function renderClientAdmin(slug, token) {
  const asJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Редактирование сайта · VELORA</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f4ef;color:#29251f;font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.wrap{max-width:840px;margin:auto;padding:28px 20px 80px}h1{font:500 36px/1.15 Georgia,serif;margin:0 0 12px}h2{margin-top:34px}p{color:#625b53}label{display:block;font-weight:600;margin:16px 0 6px}input,textarea,button{font:inherit}input,textarea{width:100%;padding:12px;border:1px solid #bcb3a8;border-radius:10px;background:white}textarea{min-height:90px;resize:vertical}button{border:0;border-radius:10px;padding:12px 18px;min-height:46px;cursor:pointer;background:#302a24;color:white;margin-top:16px}button:disabled{opacity:.5;cursor:wait}.secondary{background:#e9e2d8;color:#302a24}.service{background:white;border:1px solid #d8cec2;border-radius:16px;padding:20px;margin:16px 0}.status{padding:16px 0;white-space:pre-line}.hint{font-size:14px}.photo{display:block;max-width:100%;max-height:180px;object-fit:contain;margin-top:12px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:600px){.grid{grid-template-columns:1fr;gap:0}.wrap{padding:22px 16px 60px}h1{font-size:30px}}
</style></head><body><main class="wrap">
<h1>Редактирование сайта</h1><p>Измените нужные поля и нажмите «Сохранить и опубликовать».</p>
<div id="fields"></div><h2>Услуги</h2><div id="services"></div>
<button type="button" class="secondary" id="add" disabled>Добавить услугу</button>
<p class="hint">Для фотографии укажите открытую ссылку на изображение. Используйте свои фотографии или изображения, на которые у вас есть разрешение.</p>
<button type="button" id="save" disabled>Сохранить и опубликовать</button>
<div id="status" class="status" role="status" aria-live="polite">Загружаю данные…</div>
</main><script>
'use strict';
const slug=${asJSON(slug)}, token=${asJSON(token)};
const $=id=>document.getElementById(id);
let loadedBrief=null, busy=false;
const fields=[
 ['business_name','Название бизнеса','input'],
 ['business_description','Описание бизнеса','textarea'],
 ['headline','Заголовок первого экрана','input'],
 ['subheadline','Подзаголовок','textarea'],
 ['hero_image','Ссылка на главное фото','input'],
 ['phone','Телефон','input'],['telegram','Telegram','input'],
 ['address','Адрес','input'],['working_hours','Режим работы','input'],
 ['primary_action_label','Текст основной кнопки','input'],
 ['primary_action_url','Ссылка основной кнопки: запись, телефон или чат','input'],
 ['secondary_action_label','Текст второй кнопки','input'],
 ['secondary_action_url','Ссылка второй кнопки','input']
];
function input(parent,key,label,type,value){
 const el=document.createElement(type);el.id=key;el.value=value||'';
 const lab=document.createElement('label');lab.htmlFor=key;lab.textContent=label;
 parent.append(lab,el);return el;
}
function addService(item={}){
 const card=document.createElement('section');card.className='service';card._original=item;
 const index=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
 for(const [key,label,type] of [['title','Название услуги','input'],['description','Описание','textarea'],['price','Стоимость (если хотите показать на сайте)','input'],['image_url','Ссылка на фотографию услуги','input']]){
  const el=input(card,index+'-'+key,label,type,item[key]||((key==='image_url')?(item.image||item.photo):''));el.dataset.field=key;
 }
 const picture=document.createElement('img');picture.className='photo';picture.alt='Предпросмотр фотографии услуги';picture.hidden=true;
 const imageField=card.querySelector('[data-field="image_url"]');
 function preview(){const url=imageField.value.trim();picture.hidden=!/^https?:\\/\\//i.test(url);if(!picture.hidden)picture.src=url;else picture.removeAttribute('src');}
 picture.onerror=()=>{picture.hidden=true;};imageField.addEventListener('change',preview);preview();card.append(picture);
 const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='Удалить услугу';
 remove.onclick=()=>{if(!busy)card.remove();};card.append(remove);$('services').append(card);
}
function validateUrl(value,image=false){return !value || (image ? /^https?:\\/\\/[^\\s]+$/i : /^(https?:\\/\\/|tel:|mailto:|tg:\\/\\/)[^\\s]+$/i).test(value);}
async function load(){
 try{
  const r=await fetch('/v1/site-brief?slug='+encodeURIComponent(slug),{cache:'no-store',headers:{'x-velora-site-token':token}});
  if(!r.ok)throw new Error('Не удалось загрузить сайт. Обновите страницу.');
  const data=await r.json(),b=data.brief;
  if(!b||!b.business_name||!Array.isArray(b.services))throw new Error('Данные сайта неполные. Сохранение остановлено.');
  loadedBrief=b;
  for(const [key,label,type] of fields)input($('fields'),key,label,type,b[key]||((key==='telegram')?b.telegram_url:''));
  for(const service of b.services)addService(service);
  $('save').disabled=false;$('add').disabled=false;$('status').textContent='Данные загружены.';
 }catch(e){$('status').textContent=e.message;}
}
$('add').onclick=()=>{if(loadedBrief&&!busy)addService();};
$('save').onclick=async()=>{
 if(!loadedBrief||busy)return;
 const brief={...loadedBrief};
 for(const [key] of fields)brief[key]=$(key).value.trim();
 if(!brief.business_name||!brief.headline){$('status').textContent='Укажите название бизнеса и заголовок.';return;}
 for(const key of ['primary_action_url','secondary_action_url','hero_image'])if(!validateUrl(brief[key],key==='hero_image')){$('status').textContent='Проверьте ссылку: '+fields.find(f=>f[0]===key)[1];return;}
 brief.services=[...$('services').children].map(card=>{
  const item={...card._original};
  for(const el of card.querySelectorAll('[data-field]'))item[el.dataset.field]=el.value.trim();
  // An explicitly removed photo must not revive a legacy alias.
  delete item.image;delete item.photo;return item;
 });
 if(brief.services.some(s=>!s.title||!validateUrl(s.image_url,true))){$('status').textContent='У каждой услуги должны быть название и корректная ссылка на фото.';return;}
 if(Object.hasOwn(brief,'telegram_url'))brief.telegram_url=brief.telegram;
 busy=true;$('save').disabled=true;$('add').disabled=true;$('status').textContent='Публикую изменения…';
 try{
  const r=await fetch('/v1/admin/update',{method:'POST',headers:{'Content-Type':'application/json','x-velora-site-token':token},body:JSON.stringify({site_slug:slug,site_build_brief:brief})});
  const data=await r.json();
  if(!r.ok||data.status!=='OK')throw new Error('Публикация не подтверждена. Обновите страницу и проверьте сайт перед повторным сохранением.');
  loadedBrief=brief;$('status').textContent='Сайт обновлён.';
  if(data.site_result_url&&/^https:\\/\\//.test(data.site_result_url)){const link=document.createElement('a');link.href=data.site_result_url;link.textContent=' Открыть сайт';link.target='_blank';link.rel='noopener';$('status').append(link);}
  busy=false;$('save').disabled=false;$('add').disabled=false;
 }catch(e){$('status').textContent='Не удалось подтвердить публикацию. Обновите страницу и проверьте сайт перед повторным сохранением.';}
};
load();
</script></body></html>`;
}

module.exports={CLIENT_ADMIN_SLUGS,renderClientAdmin};
