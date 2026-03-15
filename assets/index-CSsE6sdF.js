(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var e=`user_glossary`,t=`user_trademarks`,n=`checks_history`,r=document.querySelector(`#app`);if(!r)throw Error(`Root element #app not found`);var i=r,a={dictionary:null,techAbbrev:null,glossaryBuiltIn:[],glossaryUser:Y(e,[]),trademarksBuiltIn:[],trademarksUser:Y(t,[]),norms:[],history:Y(n,[]),emailText:``,imageText:``,combinedViolations:[],correctedEmailText:``,correctedImageText:``};i.innerHTML=`
  <main class="layout">
    <nav class="tabs">
      <button data-tab-btn="checker" class="active">Проверка</button>
      <button data-tab-btn="glossary">Глоссарий</button>
      <button data-tab-btn="trademarks">Мои ТЗ</button>
      <button data-tab-btn="history">История</button>
    </nav>

    <section data-tab="checker" class="panel">
      <h1>Проверка текста email на соответствие 168-ФЗ</h1>
      <label class="field">
        <span>Текст письма / HTML</span>
        <textarea id="emailText" rows="9" placeholder="Вставьте текст или HTML-код письма..."></textarea>
      </label>
      <label class="field">
        <span>Текст с баннеров и изображений (необязательно)</span>
        <textarea id="imageText" rows="5" placeholder="Скопируйте текст с изображений..."></textarea>
      </label>
      <div class="actions">
        <label class="file">
          Загрузить .txt / .html
          <input id="sourceFile" type="file" accept=".txt,.html,text/plain,text/html" />
        </label>
        <button id="runCheckBtn">Проверить</button>
        <span id="charCount">0 / 50000</span>
      </div>
      <div id="statusBar" class="status hidden"></div>
      <div id="techHint" class="hint hidden"></div>
      <h2>Нарушения</h2>
      <ul id="violationsList" class="list"></ul>
    </section>

    <section data-tab="glossary" class="panel hidden">
      <h1>Глоссарий (пользовательские оверрайды)</h1>
      <div class="grid-form">
        <input id="glossaryOriginal" placeholder="original" />
        <input id="glossaryPreferred" placeholder="preferred" />
        <input id="glossaryReplacements" placeholder="replacements через запятую" />
        <select id="glossaryType">
          <option value="LAT_PROHIBITED">LAT_PROHIBITED</option>
          <option value="CYR_NOT_IN_DICT">CYR_NOT_IN_DICT</option>
        </select>
        <button id="addGlossaryBtn">Добавить / обновить</button>
      </div>
      <div class="actions">
        <button id="exportGlossaryCsvBtn">Экспорт CSV</button>
        <label class="file">
          Импорт CSV
          <input id="importGlossaryCsvInput" type="file" accept=".csv,text/csv" />
        </label>
      </div>
      <table>
        <thead>
          <tr><th>Original</th><th>Preferred</th><th>Replacements</th><th>Type</th><th></th></tr>
        </thead>
        <tbody id="glossaryRows"></tbody>
      </table>
    </section>

    <section data-tab="trademarks" class="panel hidden">
      <h1>Мои товарные знаки</h1>
      <div class="grid-form">
        <input id="tmName" placeholder="Название ТЗ" />
        <input id="tmRegistration" placeholder="Регистрационный номер" />
        <input id="tmNote" placeholder="Примечание" />
        <button id="addTmBtn">Добавить</button>
      </div>
      <ul id="tmRows" class="list"></ul>
    </section>

    <section data-tab="history" class="panel hidden">
      <h1>История проверок</h1>
      <ul id="historyRows" class="list"></ul>
    </section>
  </main>
`;var o=Q(`#emailText`),s=Q(`#imageText`),c=Q(`#sourceFile`),l=Q(`#runCheckBtn`),u=Q(`#charCount`),d=Q(`#statusBar`),f=Q(`#techHint`),p=Q(`#violationsList`),m=Q(`#glossaryOriginal`),h=Q(`#glossaryPreferred`),g=Q(`#glossaryReplacements`),ee=Q(`#glossaryType`),te=Q(`#addGlossaryBtn`),_=Q(`#glossaryRows`),v=Q(`#exportGlossaryCsvBtn`),y=Q(`#importGlossaryCsvInput`),b=Q(`#tmName`),x=Q(`#tmRegistration`),S=Q(`#tmNote`),ne=Q(`#addTmBtn`),C=Q(`#tmRows`),w=Q(`#historyRows`);T(),B(`warn`,`Загрузка справочников...`),re();async function re(){try{let[e,t,n,r,i]=await Promise.all([Z(`data/parsed_dictionary.json`),Z(`data/tech_abbrev.json`),Z(`data/glossary.json`),Z(`data/trademarks.json`),Z(`data/norms.json`)]);a.dictionary=e,a.techAbbrev=t,a.glossaryBuiltIn=n,a.trademarksBuiltIn=r,a.norms=i,z(),U(),W(),G()}catch(e){console.error(`Init failed:`,e),B(`error`,`✗ Не удалось загрузить справочники. Обновите страницу или проверьте публикацию data/*.json`)}}function T(){i.querySelectorAll(`[data-tab-btn]`).forEach(e=>{e.addEventListener(`click`,()=>q(e.dataset.tabBtn??`checker`))}),o.addEventListener(`input`,()=>{a.emailText=o.value,J()}),s.addEventListener(`input`,()=>{a.imageText=s.value,J()}),c.addEventListener(`change`,()=>{let e=c.files?.[0];if(!e)return;let t=new FileReader;t.onload=()=>{a.emailText=String(t.result??``),o.value=a.emailText,J()},t.readAsText(e)}),l.addEventListener(`click`,E),te.addEventListener(`click`,()=>{let t=m.value.trim().toLowerCase();if(!t)return;let n=h.value.trim(),r=g.value.split(`,`).map(e=>e.trim()).filter(Boolean),i=ee.value===`CYR_NOT_IN_DICT`?`CYR_NOT_IN_DICT`:`LAT_PROHIBITED`;a.glossaryUser=[...a.glossaryUser.filter(e=>e.original.toLowerCase()!==t),{original:t,preferred:n,replacements:r,type:i}],X(e,a.glossaryUser),m.value=``,h.value=``,g.value=``,U()}),v.addEventListener(`click`,()=>{fe(`user_glossary.csv`,de(a.glossaryUser.map(e=>({original:e.original,preferred:e.preferred,replacements:e.replacements.join(`|`),type:e.type}))))}),y.addEventListener(`change`,()=>{let t=y.files?.[0];if(!t)return;let n=new FileReader;n.onload=()=>{a.glossaryUser=ue(String(n.result??``)).map(e=>{let t=e.type===`CYR_NOT_IN_DICT`?`CYR_NOT_IN_DICT`:`LAT_PROHIBITED`;return{original:(e.original??``).toLowerCase(),preferred:e.preferred??``,replacements:(e.replacements??``).split(`|`).map(e=>e.trim()).filter(Boolean),type:t}}).filter(e=>e.original),X(e,a.glossaryUser),U()},n.readAsText(t)}),ne.addEventListener(`click`,()=>{let e=b.value.trim();e&&(a.trademarksUser=[...a.trademarksUser.filter(t=>t.name.toLowerCase()!==e.toLowerCase()),{name:e,type:`trademark`,registration:x.value.trim(),note:S.value.trim()}],X(t,a.trademarksUser),b.value=``,x.value=``,S.value=``,W())})}function E(){if(!a.dictionary||!a.techAbbrev)return;if(a.emailText.length+a.imageText.length>5e4){B(`error`,`✗ Превышен лимит 50 000 символов`);return}let e=ie([...a.glossaryBuiltIn,...a.glossaryUser]),t=[...a.trademarksBuiltIn,...a.trademarksUser],n=D(a.emailText,`email_text`,a.dictionary,a.techAbbrev,a.norms,e,t),r=D(a.imageText,`image_text`,a.dictionary,a.techAbbrev,a.norms,e,t);a.combinedViolations=[...n.violations,...r.violations],a.correctedEmailText=n.correctedText,a.correctedImageText=r.correctedText;let i=V(a.combinedViolations);B(i.level,i.label),a.combinedViolations.some(e=>e.type===`TECH_ABBREV`)?(f.classList.remove(`hidden`),f.textContent=`Технические аббревиатуры формально не выведены в исключения для рекламных текстов. Риск низкий, но не нулевой.`):(f.classList.add(`hidden`),f.textContent=``),R(),K()}function D(e,t,n,r,i,a,o){let s=oe(e)?se(e):e,c=O(s),l=k(c,[...Array.from(a.keys()).filter(e=>e.includes(` `)),...o.map(e=>e.name.toLowerCase()).filter(e=>e.includes(` `))]),u=new Set,d=[];for(let e of l){for(let t=e.startTokenIdx;t<=e.endTokenIdx;t+=1)u.add(t);let n=s.slice(e.start,e.end);if(A(e,c,o))continue;let l=P(n,r)?`TECH_ABBREV`:`LAT_PROHIBITED`,f=I(l,i);d.push({word:n,position:{start:e.start,end:e.end},source:t,type:l,risk:F(l),norm:f.norm,normUrl:f.url,replacements:L(n,a)})}return c.forEach((e,s)=>{if(!u.has(s)&&!j(e.normalized,o)){if(ce(e.normalized)){if(!M(e.normalized,n)){let n=I(`CYR_NOT_IN_DICT`,i);d.push({word:e.raw,position:{start:e.start,end:e.end},source:t,type:`CYR_NOT_IN_DICT`,risk:`MEDIUM`,norm:n.norm,normUrl:n.url,replacements:L(e.raw,a)})}return}if(le(e.normalized)){let n=P(e.raw,r)?`TECH_ABBREV`:`LAT_PROHIBITED`,o=I(n,i);d.push({word:e.raw,position:{start:e.start,end:e.end},source:t,type:n,risk:F(n),norm:o.norm,normUrl:o.url,replacements:L(e.raw,a)})}}}),{violations:d,correctedText:ae(s,d)}}function O(e){let t=/[A-Za-zА-Яа-яЁё]+(?:-[A-Za-zА-Яа-яЁё]+)*/g,n=[],r=t.exec(e);for(;r;){let i=r[0],a=r.index,o=a+i.length;n.push({raw:i,normalized:i.toLowerCase(),start:a,end:o}),r=t.exec(e)}return n}function k(e,t){let n=t.map(e=>e.trim().toLowerCase().split(/\s+/)).filter(e=>e.length>1).sort((e,t)=>t.length-e.length),r=[],i=0;for(;i<e.length;){let t=null;for(let r of n){let n=i+r.length-1;if(n>=e.length)continue;let a=!0;for(let t=0;t<r.length;t+=1)if(e[i+t].normalized!==r[t]){a=!1;break}if(a){t={phrase:r.join(` `),startTokenIdx:i,endTokenIdx:n,start:e[i].start,end:e[n].end};break}}t?(r.push(t),i=t.endTokenIdx+1):i+=1}return r}function A(e,t,n){let r=t.slice(e.startTokenIdx,e.endTokenIdx+1).map(e=>e.normalized).join(` `);return n.some(e=>e.name.toLowerCase()===r)}function j(e,t){return t.some(t=>{let n=t.name.toLowerCase();return n===e?!0:e.includes(`-`)?e.split(`-`).includes(n):!1})}function M(e,t){let n=e.toLowerCase();if(n in t.words)return!0;let r=N(n);return!!t.stems?.[r]}function N(e){for(let t of`иями.ями.ами.ого.ему.ому.ыми.ими.ая.яя.ой.ий.ый.ов.ев.ей.ам.ям.ах.ях.ом.ем.ы.и.а.я.е.о.у.ю.ь`.split(`.`))if(e.endsWith(t)&&e.length-t.length>=3)return e.slice(0,-t.length);return e}function P(e,t){let n=e.toLowerCase();return t.abbreviations.some(e=>e.toLowerCase()===n)}function F(e){return e===`LAT_PROHIBITED`?`HIGH`:e===`CYR_NOT_IN_DICT`?`MEDIUM`:`LOW`}function I(e,t){let n=t.find(t=>t.code===e);return n?{norm:n.norm,url:n.url}:{norm:`Норма не указана`}}function ie(e){let t=new Map;return e.forEach(e=>t.set(e.original.toLowerCase(),e)),t}function L(e,t){let n=t.get(e.toLowerCase());return n?(n.preferred?[n.preferred,...n.replacements.filter(e=>e.toLowerCase()!==n.preferred.toLowerCase())]:n.replacements).slice(0,3):[]}function ae(e,t){if(!t.length)return e;let n=[...t].sort((e,t)=>e.position.start-t.position.start),r=0,i=``;for(let t of n){let n=t.replacements[0];!n||t.position.start<r||(i+=e.slice(r,t.position.start),i+=n,r=t.position.end)}return i+=e.slice(r),i}function R(){if(p.innerHTML=``,!a.combinedViolations.length){p.innerHTML=`<li>Нарушений не найдено.</li>`;return}let e=document.createDocumentFragment();a.combinedViolations.forEach(t=>{let n=H(t),r=document.createElement(`li`);r.className=`violation-card`,r.innerHTML=`
      <div class="violation-title"><strong>${$(t.word)}</strong></div>
      <div><b>Проблема:</b> ${$(n.issueTitle)}</div>
      <div><b>Юридическая критичность:</b> ${$(n.legalSeverityLabel)}</div>
      <div><b>Уверенность автопроверки:</b> ${$(n.confidenceLabel)}</div>
      <div><b>Почему такая уверенность:</b> ${$(n.confidenceReason)}</div>
      <div><b>Где найдено:</b> ${$(n.sourceLabel)}</div>
      <div><b>Что это значит:</b> ${$(n.lawPlainText)}</div>
      <div><b>Норма закона:</b> ${t.normUrl?`<a href="${t.normUrl}" target="_blank" rel="noreferrer">${$(t.norm)}</a>`:$(t.norm)}</div>
      <div><b>Рекомендуемая замена:</b> ${$(t.replacements.join(` / `)||`нет`)}</div>
    `,e.appendChild(r)}),p.appendChild(e)}function z(){B(`ok`,`✓ Сервис готов к проверке`),J()}function B(e,t){d.className=`status ${e}`,d.textContent=t,d.classList.remove(`hidden`)}function V(e){return e.length?e.every(e=>e.type===`TECH_ABBREV`)?{level:`warn`,label:`⚠ Найдено ${e.length} спорных аббревиатур`}:{level:`error`,label:`✗ Найдено ${e.length} нарушений`}:{level:`ok`,label:`✓ Нарушений не найдено`}}function H(e){let t=e.source===`email_text`?`основной текст письма`:`текст с изображений`;return e.type===`LAT_PROHIBITED`?{issueTitle:`Иностранное слово на латинице в рекламном тексте.`,legalSeverityLabel:`высокая`,confidenceLabel:`высокая`,confidenceReason:`Правило почти однозначное: найдена латиница, это не товарный знак и не техническая аббревиатура.`,sourceLabel:t,lawPlainText:`Для потребительской рекламы требуется русский язык. Латиницу лучше заменить русским вариантом.`}:e.type===`CYR_NOT_IN_DICT`?{issueTitle:`Слово не найдено в нормативных словарях.`,legalSeverityLabel:`высокая`,confidenceLabel:`средняя`,confidenceReason:`Проверка зависит от полноты парсинга PDF-словарей и нормализации словоформ, поэтому бывают пограничные случаи.`,sourceLabel:t,lawPlainText:`Формулировки должны опираться на нормативную словарную форму. Лучше использовать более официальный вариант.`}:{issueTitle:`Техническая аббревиатура (спорная зона).`,legalSeverityLabel:`низкая`,confidenceLabel:`средняя`,confidenceReason:`Само обнаружение надёжное, но правоприменительная практика по таким сокращениям пока не до конца устоялась.`,sourceLabel:t,lawPlainText:`Такие сокращения обычно допустимы, но иногда безопаснее дать русский эквивалент рядом.`}}function U(){_.innerHTML=``,[...a.glossaryUser].forEach(e=>{let t=document.createElement(`tr`);t.innerHTML=`
      <td>${$(e.original)}</td>
      <td>${$(e.preferred)}</td>
      <td>${$(e.replacements.join(`, `))}</td>
      <td>${e.type}</td>
      <td><button data-remove-glossary="${$(e.original)}" class="danger">Удалить</button></td>
    `,_.appendChild(t)}),_.querySelectorAll(`[data-remove-glossary]`).forEach(t=>{t.addEventListener(`click`,()=>{let n=t.dataset.removeGlossary??``;a.glossaryUser=a.glossaryUser.filter(e=>e.original!==n),X(e,a.glossaryUser),U()})})}function W(){C.innerHTML=``,a.trademarksUser.forEach(e=>{let t=document.createElement(`li`);t.innerHTML=`
      <strong>${$(e.name)}</strong>
      ${e.registration?`<span>(${$(e.registration)})</span>`:``}
      ${e.note?`<span> — ${$(e.note)}</span>`:``}
      <button data-remove-tm="${$(e.name)}" class="danger">Удалить</button>
    `,C.appendChild(t)}),C.querySelectorAll(`[data-remove-tm]`).forEach(e=>{e.addEventListener(`click`,()=>{let n=e.dataset.removeTm??``;a.trademarksUser=a.trademarksUser.filter(e=>e.name!==n),X(t,a.trademarksUser),W()})})}function G(){w.innerHTML=``,a.history.forEach(e=>{let t=document.createElement(`li`);t.innerHTML=`
      <div><strong>${new Date(e.createdAt).toLocaleString()}</strong> — ${e.combinedViolations.length} наруш.</div>
      <button data-open-history="${e.id}">Открыть</button>
    `,w.appendChild(t)}),w.querySelectorAll(`[data-open-history]`).forEach(e=>{e.addEventListener(`click`,()=>{let t=e.dataset.openHistory??``,n=a.history.find(e=>e.id===t);if(!n)return;a.emailText=n.emailText,a.imageText=n.imageText,a.combinedViolations=n.combinedViolations,a.correctedEmailText=n.correctedEmailText,a.correctedImageText=n.correctedImageText,o.value=a.emailText,s.value=a.imageText,R();let r=V(a.combinedViolations);B(r.level,r.label),q(`checker`)})})}function K(){a.history=[{id:crypto.randomUUID(),createdAt:new Date().toISOString(),emailText:a.emailText,imageText:a.imageText,combinedViolations:a.combinedViolations,correctedEmailText:a.correctedEmailText,correctedImageText:a.correctedImageText},...a.history].slice(0,50),X(n,a.history),G()}function q(e){i.querySelectorAll(`[data-tab-btn]`).forEach(t=>{t.classList.toggle(`active`,t.dataset.tabBtn===e)}),i.querySelectorAll(`[data-tab]`).forEach(t=>{t.classList.toggle(`hidden`,t.dataset.tab!==e)})}function J(){u.textContent=`${a.emailText.length+a.imageText.length} / 50000`}function Y(e,t){let n=localStorage.getItem(e);if(!n)return t;try{return JSON.parse(n)}catch{return t}}function X(e,t){localStorage.setItem(e,JSON.stringify(t))}async function Z(e){let t=`/zozyaz/${e.replace(/^\/+/,``)}`,n=await fetch(t);if(!n.ok)throw Error(`Не удалось загрузить ${t}: ${n.status}`);return await n.json()}function Q(e){let t=i.querySelector(e);if(!t)throw Error(`Element not found: ${e}`);return t}function oe(e){return/<\/?[a-z][\s\S]*>/i.test(e)}function se(e){let t=new DOMParser().parseFromString(e,`text/html`);return t.querySelectorAll(`script, style`).forEach(e=>e.remove()),t.querySelectorAll(`[hidden], [aria-hidden='true']`).forEach(e=>e.remove()),t.querySelectorAll(`[style]`).forEach(e=>{let t=e.getAttribute(`style`)?.toLowerCase().replace(/\s+/g,``)??``;(t.includes(`display:none`)||t.includes(`font-size:0`)||t.includes(`max-height:0`))&&e.remove()}),(t.body.textContent??``).replace(/\s+/g,` `).trim()}function ce(e){return/^[а-яё-]+$/i.test(e)}function le(e){return/^[a-z-]+$/i.test(e)}function $(e){return e.replaceAll(`&`,`&amp;`).replaceAll(`<`,`&lt;`).replaceAll(`>`,`&gt;`).replaceAll(`"`,`&quot;`)}function ue(e){let t=e.split(/\r?\n/).filter(Boolean);if(!t.length)return[];let n=t[0].split(`,`).map(e=>e.trim().replace(/^"|"$/g,``));return t.slice(1).map(e=>{let t=e.split(`,`).map(e=>e.trim().replace(/^"|"$/g,``)),r={};return n.forEach((e,n)=>{r[e]=t[n]??``}),r})}function de(e){if(!e.length)return``;let t=Object.keys(e[0]),n=e=>`"${e.replace(/"/g,`""`)}"`,r=[t.join(`,`)];return e.forEach(e=>{r.push(t.map(t=>n(e[t]??``)).join(`,`))}),r.join(`
`)}function fe(e,t){let n=new Blob([t],{type:`text/plain;charset=utf-8`}),r=URL.createObjectURL(n),i=document.createElement(`a`);i.href=r,i.download=e,i.click(),URL.revokeObjectURL(r)}