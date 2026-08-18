const { JSDOM } = require('jsdom');
const fs = require('fs');

// Build a harness mimicking the app's mapping view
const html = `<!doctype html><body>
<aside class="sidebar"><nav class="nav-list">
 <button class="nav-item"><span>03</span>Portfolio dashboard</button>
 <button class="nav-item active"><span>08</span>Ownership &amp; category</button>
 <button class="nav-item"><span>13</span>Exception center</button>
</nav></aside>
<header class="topbar"><span class="eyebrow">Workspace</span></header>
<div class="entity-switch"><span>Entity</span>
  <button class="chip-btn active">Keystone Byron Bay Pty Ltd</button>
  <button class="chip-btn">Shaka Traders Pty Ltd</button>
  <button class="chip-btn">Hope Dealers Pty Ltd</button></div>
<section class="panel">
 <div class="wp-table"><table><thead><tr>
   <th>Sch</th><th>Template line</th><th>Source caption</th><th class="numeric">Value (LC)</th><th>Cell</th>
 </tr></thead><tbody>
  <tr><td class="ref-cell">Sch C</td><td><strong>Gross receipts</strong></td>
      <td><div><span>Sales <small>(amount 2,290,116 · 2024 · Keystone FS.pdf p.5)</small></span>
          <select class="stake-input"><option value="IS:7">Sch C · Gross receipts</option></select></div></td>
      <td class="numeric">2,290,116</td><td class="ref-cell">F7</td></tr>
  <tr><td class="ref-cell">Sch C</td><td><strong>Purchases</strong></td>
      <td><div><span>Purchases <small>(amount 228,705 · 2024 · Keystone FS.pdf p.5)</small></span>
          <select class="stake-input"><option value="IS:11">Sch C · Purchases</option></select></div>
          <div><span>Purchases (Food) <small>(amount 200,667 · 2024 · Keystone FS.pdf p.6)</small></span>
          <select class="stake-input"><option value="IS:11">Sch C · Purchases</option></select></div></td>
      <td class="numeric">429,372</td><td class="ref-cell">F11</td></tr>
  <tr><td class="ref-cell">Sch F</td><td><strong>Cash</strong></td>
      <td><div><span>Cash at bank <small>(eoy 55,574 · 2024 · Keystone FS.pdf p.9)</small></span>
          <select class="stake-input"><option value="BS:10">Sch F · Cash</option></select></div></td>
      <td class="numeric">60,000</td><td class="ref-cell">D/F10</td></tr>
 </tbody></table></div>
</section>
<section class="panel"><div class="wp-table"><table id="ev"><thead><tr>
  <th>Caption in the document</th><th>Language</th><th>English</th><th class="numeric">Value (current year)</th><th>Bound to</th>
</tr></thead><tbody>
${Array.from({length:14},(_,i)=>`<tr><td>Caption ${i} ${i%2?'Verkauf':'Sales'}</td><td>${i%2?'German':'English'}</td><td>${i%2?'Sales':''}</td><td class="numeric">${(i+1)*1000}</td><td>IS:${i}</td></tr>`).join('')}
</tbody></table></div></section>
<section class="panel"><div class="wp-table"><table id="exc"><thead><tr>
  <th></th><th>Level</th><th>Entity</th><th>Category</th><th>Finding</th><th>Target</th><th></th>
</tr></thead><tbody>
${Array.from({length:12},(_,i)=>`<tr><td><input type=checkbox></td><td>WARN</td><td>Keystone Byron Bay Pty Ltd</td><td>carry-forward</td><td>Beginning-of-year item ${i}: compare against computed G${i+10}.</td><td>Balance Sheet!G${i+10}</td><td><button>Sign off</button></td></tr>`).join('')}
</tbody></table></div></section>
<section class="panel"><div class="wp-table"><table id="span"><thead><tr>
  <th>A</th><th>B</th><th>C</th>
</tr></thead><tbody>
${Array.from({length:12},(_,i)=>`<tr><td colspan=2>wide ${i}</td><td>x</td></tr>`).join('')}
</tbody></table></div></section>
<div class="view-stack"><section class="panel"><div class="panel-heading"><div><span class="section-kicker">3 selected</span><h2>Filing categories</h2></div></div>
<div class="cat-row"><label class="cat-chip on"><input type="checkbox" checked>Category 4</label></div></section></div>
<div class="view-stack"><p>Every methodology, rule set, model and limit this tool applies, in one place</p></div>
<section class="panel"><div class="dropzone"><strong>Drop documents</strong></div></section>
<div class="log-list"><div>entry 1</div><div>entry 2</div></div>
</body>`;

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://www.claudeusercontent.com/artifact/x' });
const { window } = dom;
global.window = window; global.document = window.document;
global.MutationObserver = window.MutationObserver;
global.CustomEvent = window.CustomEvent;
global.requestAnimationFrame = cb => setTimeout(cb, 0);

// Fake store: Cash edited by hand (60,000 vs extracted 55,574); Purchases matches sum
const __state = ({
  activeEntityId: 'K',
  entities: [
    { id:'K', name:'Keystone Byron Bay Pty Ltd', status:'idle',
      lines:{ 'IS:7':{amount:2290116}, 'IS:11':{amount:429372}, 'BS:10':{eoy:60000} },
      contributions:{
        'IS:7':[{label:'Sales',field:'amount',value:2290116}],
        'IS:11':[{label:'Purchases',field:'amount',value:228705},{label:'Purchases (Food)',field:'amount',value:200667}],
        'BS:10':[{label:'Cash at bank',field:'eoy',value:55574}] },
      reviewItems:[{level:'warn',dismissed:false},{level:'info',dismissed:false}],
      categories:{'4':true,'5a':true,'2':true},
      files:[{id:'kf1',name:'Scanned_Statement_2024.pdf',blob:{name:'Scanned_Statement_2024.pdf',arrayBuffer:()=>Promise.resolve(new ArrayBuffer(3))}}],
      ownership:{ownEnd:'35', cfc:'Yes', daysCfc:'365'},
      detected:{
        'ownEnd':{key:'ownEnd',value:'35',sourceLabel:'Ownership % at end of year',src:{doc:'Questionnaire.xlsx',page:null,heading:'Ownership facts',label:'Ownership % at end of year',value:'35'}},
        'cfc':{key:'cfc',value:'Yes',sourceLabel:'CFC?',src:{doc:'Questionnaire.xlsx',page:null,heading:'Ownership facts',label:'CFC?',value:'Yes'}},
        'cat:4':{key:'cat:4',value:'Yes',sourceLabel:'1a 1b 1c 2 3 4 5a 5b 5c',src:{doc:'ZUNO0002 - 2023 Federal Tax Return.pdf',page:31,heading:'Prior-year Form 5471 \u2014 Item B (Category of filer)',label:'Category 4 box checked'}}
      } },
    { id:'S', name:'Shaka Traders Pty Ltd', status:'idle', lines:{}, contributions:{}, reviewItems:[], files:[{id:'f1',name:'Mark_Wendorf-Annual_Statement_2024 (OCR).pdf'},{id:'f2',name:'TB.xlsx'}] },
    { id:'H', name:'Hope Dealers Pty Ltd', status:'processing', lines:{}, contributions:{}, reviewItems:[] },
  ]
});
window.__WPGET = () => __state;

window.matchMedia = window.matchMedia || (q => ({matches:false, media:q, addListener(){}, removeListener(){}}));
window.eval(fs.readFileSync('layer-src/enhance.js','utf8'));

const run = () => new Promise(r => setTimeout(r, 250));
(async () => {
  await run();
  const d = window.document;
  const assert = (c,m)=>{ if(!c){ console.error('FAIL:',m); process.exitCode=1; } else console.log('ok:',m); };

  // 1. caption compaction
  assert(d.querySelectorAll('.en9-chip').length===4, '4 source chips created');
  assert(d.querySelector('.en9-metahide') && !d.querySelector('.en9-metahide.en9-open'), 'metadata collapsed by default');
  assert(d.querySelector('.en9-chip').textContent.includes('p.5'), 'chip shows page number');
  d.querySelector('.en9-chip').click();
  assert(d.querySelector('.en9-metahide.en9-open'), 'chip click expands metadata');

  // 2. remap pencils
  assert(d.querySelectorAll('select.stake-input.en9-hide').length===4, 'all selects hidden behind pencils');
  const pen=d.querySelector('.en9-pencil'); pen.click();
  assert(d.querySelectorAll('select.stake-input.en9-hide').length===3, 'pencil reveals its select');

  // 3. multi-source + edited markers
  assert(d.querySelectorAll('.en9-multi-badge').length===1, 'one multi-source badge (Purchases)');
  assert(d.querySelector('.en9-multi-badge').textContent.includes('2'), 'badge says 2 sources');
  const edited=[...d.querySelectorAll('tr.en9-edited')];
  assert(edited.length===1 && edited[0].textContent.includes('Cash'), 'Cash row flagged as edited (60,000 vs 55,574)');
  assert(d.querySelector('.en9-edited-dot').title.includes('55,574'), 'edited tooltip shows extracted total');

  // 4. grouping + subtotals
  const groups=[...d.querySelectorAll('tr.en9-group')];
  assert(groups.length===2, 'two group headers (Sch C / Sch F)');
  assert(groups[0].textContent.includes('Income statement')&&groups[0].textContent.includes('2'), 'Sch C header with count');
  const subs=[...d.querySelectorAll('tr.en9-subtotal')];
  assert(subs.length===2, 'two subtotal rows');
  assert(subs[0].textContent.replace(/\u00a0/g,' ').includes((2290116+429372).toLocaleString('en-US')), 'Sch C subtotal correct: '+subs[0].textContent);

  // 5. filter bar + filtering
  const bar=d.querySelector('.en9-fb');
  assert(bar, 'filter bar injected');
  assert(bar.querySelector('[data-en9r="multi"]').textContent.includes('1'), 'multi chip count = 1');
  assert(bar.querySelector('[data-en9r="edited"]').textContent.includes('1'), 'edited chip count = 1');
  const inp=bar.querySelector('.en9-search');
  inp.value='purchases'; inp.dispatchEvent(new window.Event('input',{bubbles:true}));
  await run();
  const vis=[...d.querySelectorAll('tbody tr')].filter(r=>!r.classList.contains('en9-hidden')&&!r.hasAttribute('data-en9'));
  assert(vis.length===1 && vis[0].textContent.includes('Purchases'), 'search filters to Purchases row');
  assert([...d.querySelectorAll('tr.en9-group')].some(g=>/1 of 2/.test(g.textContent)), 'group count shows "1 of 2" when filtered');
  // schedule filter
  bar.querySelector('.en9-fchip:last-child').click(); await run(); // Clear
  const sel=bar.querySelector('select'); sel.value='Sch F'; sel.dispatchEvent(new window.Event('change',{bubbles:true}));
  await run();
  const vis2=[...d.querySelectorAll('tbody tr')].filter(r=>!r.classList.contains('en9-hidden')&&!r.hasAttribute('data-en9'));
  assert(vis2.length===1 && vis2[0].textContent.includes('Cash'), 'schedule filter isolates Sch F');
  sel.value='ALL'; sel.dispatchEvent(new window.Event('change',{bubbles:true})); await run();

  // 6. group collapse persists across re-render
  d.querySelectorAll('tr.en9-group')[0].click(); await run();
  assert([...d.querySelectorAll('tbody tr')].filter(r=>r.getAttribute('data-en9sch')==='Sch C').every(r=>r.classList.contains('en9-hidden')), 'clicking group collapses its rows');

  // 7. entity pills
  const pills=[...d.querySelectorAll('.chip-btn')];
  assert(pills[0].querySelector('.en9-dot.warn') && pills[0].querySelector('.en9-nbadge').textContent==='1', 'Keystone pill: amber dot + 1 warn badge');
  assert(pills[2].querySelector('.en9-dot.busy'), 'Hope pill: busy dot while processing');

  // 8. log drawer
  assert(d.querySelector('.log-list.en9-clamp') && d.querySelector('.en9-logbtn').textContent.includes('Show processing log (2)'), 'log collapsed with toggle');
  d.querySelector('.en9-logbtn').click();
  assert(d.querySelector('.log-list.en9-open'), 'log toggle opens drawer');

  // re-expand Sch C before re-render simulation
  d.querySelectorAll('tr.en9-group')[0].click(); await run();

  // 9. REACTIVITY: simulate a React re-render replacing tbody content (user remapped -> new value)
  const body=d.querySelector('tbody');
  [...body.querySelectorAll('tr[data-en9]')].forEach(r=>r.remove());
  body.innerHTML = body.innerHTML.replace(/429,372/g,'993,558'); // React swaps the rows
  window.dispatchEvent(new window.CustomEvent('wp:state'));
  await run(); await run();
  assert([...d.querySelectorAll('tr.en9-group')].length===2, 'groups rebuilt after simulated React re-render');
  assert(d.querySelectorAll('.en9-chip').length>=4, 'chips re-created after re-render');
  const sub2=[...d.querySelectorAll('tr.en9-subtotal')];
  assert(sub2.some(s2=>s2.textContent.includes((2290116+993558).toLocaleString('en-US'))), 'subtotal recomputed with new user value');
  assert(d.querySelectorAll('.en9-fb').length===1, 'exactly one filter bar (idempotent re-injection)');
  // regression: search index refreshed -> searching the NEW value finds the row
  const inp2=d.querySelector('.en9-fb .en9-search');
  inp2.value='993,558'; inp2.dispatchEvent(new window.Event('input',{bubbles:true})); await run();
  const vf=[...d.querySelectorAll('tbody tr')].filter(r=>!r.classList.contains('en9-hidden')&&!r.hasAttribute('data-en9'));
  assert(vf.length===1 && vf[0].textContent.includes('Purchases'), 'search finds row by its NEW user-edited value');
  inp2.value=''; inp2.dispatchEvent(new window.Event('input',{bubbles:true})); await run();

  // 10. idempotency: run 3 more passes, nothing duplicates
  window.dispatchEvent(new window.CustomEvent('wp:state')); await run();
  window.dispatchEvent(new window.CustomEvent('wp:state')); await run();
  assert(d.querySelectorAll('.en9-fb').length===1 && d.querySelectorAll('tr.en9-group').length===2 && d.querySelectorAll('.en9-logbtn').length===1, 'no duplication after repeated passes');

  // 11. delegation: even a serialized (listener-less) chip clone still toggles via delegation
  const anyChip=d.querySelector('.en9-chip');
  const holder=anyChip.closest('.en9-metahide'); const was=holder.classList.contains('en9-open');
  anyChip.click();
  assert(holder.classList.contains('en9-open')!==was, 'delegated chip click works on re-serialized nodes');
  const anyPen=d.querySelector('.en9-pencil');
  const psel=anyPen.nextElementSibling; const pwas=psel.classList.contains('en9-hide');
  anyPen.click();
  assert(psel.classList.contains('en9-hide')!==pwas, 'delegated pencil click works on re-serialized nodes');

  // 12. per-column filter row (Task-Management style)
  const ev=d.getElementById('ev');
  const cf=[...ev.tHead.querySelectorAll('tr[data-en9] input')];
  assert(cf.length===5, 'column filter inputs for all 5 columns');
  assert(cf[1].placeholder==='Language', 'column input placeholder = header name');
  cf[1].value='german'; cf[1].dispatchEvent(new window.Event('input',{bubbles:true})); await run();
  let evVis=[...ev.tBodies[0].rows].filter(r=>!r.classList.contains('en9-hidden')&&!r.hasAttribute('data-en9'));
  assert(evVis.length===7 && evVis.every(r=>r.textContent.includes('German')), 'Language column filter isolates German rows');
  cf[0].value='caption 3'; cf[0].dispatchEvent(new window.Event('input',{bubbles:true})); await run();
  evVis=[...ev.tBodies[0].rows].filter(r=>!r.classList.contains('en9-hidden')&&!r.hasAttribute('data-en9'));
  assert(evVis.length===1 && evVis[0].textContent.includes('Caption 3'), 'column filters combine (AND)');
  cf[0].value=''; cf[0].dispatchEvent(new window.Event('input',{bubbles:true}));
  cf[1].value=''; cf[1].dispatchEvent(new window.Event('input',{bubbles:true})); await run();

  // 13. pagination
  const pager=d.querySelector('.en9-pager');
  assert(pager, 'pagination bar injected for long table');
  const pgsel=pager.querySelector('select'); pgsel.value='10';
  pgsel.dispatchEvent(new window.Event('change',{bubbles:true})); await run();
  evVis=[...ev.tBodies[0].rows].filter(r=>!r.classList.contains('en9-hidden')&&!r.hasAttribute('data-en9'));
  assert(evVis.length===10, 'rows-per-page=10 limits visible rows');
  assert(pager.querySelector('.en9-pinfo').textContent.includes('Page 1 of 2'), 'pager info correct: '+pager.querySelector('.en9-pinfo').textContent);
  pager.querySelector('[data-en9pg="next"]').click(); await run();
  evVis=[...ev.tBodies[0].rows].filter(r=>!r.classList.contains('en9-hidden')&&!r.hasAttribute('data-en9'));
  assert(evVis.length===4 && pager.querySelector('.en9-pinfo').textContent.includes('Page 2 of 2'), 'next page shows remaining 4 rows');
  // filtering resets to page 1 and recounts
  cf[1].value='german'; cf[1].dispatchEvent(new window.Event('input',{bubbles:true})); await run();
  assert(pager.querySelector('.en9-pinfo').textContent.includes('Page 1 of 1') && pager.querySelector('.en9-pinfo').textContent.includes('7 rows'), 'filter resets pagination and recounts');
  cf[1].value=''; cf[1].dispatchEvent(new window.Event('input',{bubbles:true})); await run();

  // 14. mapping table unaffected by pagination, still grouped
  assert(!d.querySelector('.en9-pager[data-en9t*="Sch"]') , 'no pager on grouped mapping table');
  assert(d.querySelectorAll('tr.en9-group').length===2, 'mapping groups intact alongside new features');
  // idempotency with new features
  window.dispatchEvent(new window.CustomEvent('wp:state')); await run();
  window.dispatchEvent(new window.CustomEvent('wp:state')); await run();
  const pagerKeys=[...d.querySelectorAll('.en9-pager')].map(p=>p.getAttribute('data-en9t'));
  assert(new Set(pagerKeys).size===pagerKeys.length, 'exactly one pager per table (no duplicates)');
  assert([...d.querySelectorAll('table')].every(tb=>!tb.tHead||tb.tHead.querySelectorAll('tr[data-en9]').length<=1), 'at most one filter row per table');

  // 15. exception-center-style table: filter row present, offsets measured not hard-coded
  const exc=d.getElementById('exc');
  const excFr=exc.tHead.querySelector('tr[data-en9]');
  assert(excFr, 'filter row injected on exception-style table');
  assert(excFr.cells.length===7, 'filter row matches 7 columns (empty cols get no input)');
  assert([...excFr.cells].filter(c=>c.querySelector('input')).length===5, 'inputs only for the 5 labeled columns');
  assert([...excFr.cells].every(c=>c.style.top!==''), 'sticky offsets are JS-measured per table (style.top set)');
  const excCf=[...excFr.querySelectorAll('input')];
  excCf.find(i2=>i2.placeholder==='Finding').value='item 3';
  excCf.find(i2=>i2.placeholder==='Finding').dispatchEvent(new window.Event('input',{bubbles:true})); await run();
  const excVis=[...exc.tBodies[0].rows].filter(r=>!r.classList.contains('en9-hidden')&&!r.hasAttribute('data-en9'));
  assert(excVis.length===1 && excVis[0].textContent.includes('item 3'), 'Finding column filter works on exception table');
  excCf.find(i2=>i2.placeholder==='Finding').value='';
  excCf.find(i2=>i2.placeholder==='Finding').dispatchEvent(new window.Event('input',{bubbles:true})); await run();

  // 16. colspan-mismatch table gets NO filter row (guard) but still gets a pager
  const sp=d.getElementById('span');
  assert(!sp.tHead.querySelector('tr[data-en9]'), 'colspan-mismatched table skipped by filter-row guard');
  assert(d.querySelectorAll('.en9-pager').length>=2, 'pager still provided for long colspan table');

  // 17. group sticky offsets also measured
  const gtd=d.querySelector('tr.en9-group td');
  assert(gtd && gtd.style.top!=='', 'group header sticky offset measured via JS');

  // 18. filing-category authority panel
  const auth=d.querySelector('.en9-authority');
  assert(auth, 'authority panel injected after category section');
  const cards=[...auth.querySelectorAll('.en9-auth-card')];
  assert(cards.length===3, 'one card per selected category (2, 4, 5a)');
  const c4=cards.find(c=>c.textContent.includes('Category 4'));
  assert(c4.querySelector('a').href.includes('irs.gov/instructions/i5471#id13'), 'Cat 4 links to the exact IRS instructions anchor');
  assert(c4.textContent.includes('Item B \u2014 check box 4') || c4.textContent.includes('Item B — check box 4'), 'form location shown (Item B box)');
  assert(c4.textContent.includes('35%') && c4.querySelector('.en9-auth-contra'), 'Cat 4 flags contradiction: recorded 35% does not establish >50% control');
  assert(c4.querySelector('.en9-auth-pill.rev'), 'Cat 4 marked for review despite explicit prior-year evidence (facts contradict)');
  assert(c4.textContent.includes('ZUNO0002') && c4.textContent.includes('p.31') && c4.textContent.includes('Item B'), 'Cat 4 evidence traces File \u2192 Page \u2192 Heading');
  const c5=cards.find(c=>c.textContent.includes('Category 5a'));
  assert(c5.querySelector('.en9-auth-pill.ok'), 'Cat 5a supported: CFC Yes + 35% \u2265 10%');
  assert(c5.textContent.includes('Questionnaire.xlsx') && c5.textContent.includes('Ownership facts'), 'Cat 5a evidence shows questionnaire source with section heading');
  const c2=cards.find(c=>/Category 2 /.test(c.textContent));
  assert(c2.querySelector('.en9-auth-pill.rev'), 'Cat 2 marked for review (officer + acquisition facts missing)');
  assert([...c2.querySelectorAll('.en9-auth-miss')].some(m=>m.textContent.includes('Officer')), 'Cat 2 lists the specific missing condition');
  assert([...c2.querySelectorAll('.en9-auth-src')].every(x=>x.textContent.includes('Questionnaire.xlsx')), 'Cat 2 shows only real sources, nothing invented');
  // reactivity: user unticks Category 2 in the app \u2192 state change re-renders panel
  const st=window.__WPGET(); delete st.entities[0].categories['2'];
  window.dispatchEvent(new window.CustomEvent('wp:state')); await run();
  assert(d.querySelectorAll('.en9-auth-card').length===2, 'panel reacts to category toggle (card removed)');

  // 19. settings authoritative-sources card
  const src=d.querySelector('.en9-sources');
  assert(src && src.querySelector('a').href.includes('irs.gov/instructions/i5471'), 'Settings shows the IRS instructions as authoritative source');
  assert(src.textContent.includes('highest-priority source'), 'Settings card states the priority rule');
  window.dispatchEvent(new window.CustomEvent('wp:state')); await run();
  assert(d.querySelectorAll('.en9-sources').length===1, 'settings card idempotent');

  // 20. command palette (Linear-inspired)
  assert(d.querySelector('.topbar .en9-kbd-hint'), 'topbar shows the \u2318K hint');
  d.dispatchEvent(new window.KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));
  await run();
  const kbar=d.querySelector('.en9-kbar');
  assert(kbar && !kbar.hidden, 'Ctrl+K opens the palette');
  let rows=[...kbar.querySelectorAll('.en9-kitem')];
  assert(rows.some(r=>r.textContent.includes('Exception center')) && rows.some(r=>r.textContent.includes('Switch to Shaka Traders Pty Ltd')), 'palette lists nav views and entity switches');
  const kin=kbar.querySelector('.en9-kin');
  kin.value='excep'; kin.dispatchEvent(new window.Event('input',{bubbles:true}));
  rows=[...kbar.querySelectorAll('.en9-kitem')];
  assert(rows.length===1 && rows[0].textContent.includes('Exception center'), 'typing filters the palette');
  let clicked=false; d.querySelectorAll('.nav-item')[2].addEventListener('click',()=>clicked=true);
  kin.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  assert(clicked, 'Enter runs the selected action (navigates)');
  assert(kbar.hidden, 'palette closes after running an action');
  d.dispatchEvent(new window.KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));
  kin.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  assert(kbar.hidden, 'Escape closes the palette');
  assert(d.querySelectorAll('.en9-kbar').length===1, 'palette is a singleton (idempotent)');

  // 21. OCR panel injection + entity options
  const ocr=d.querySelector('.en9-ocr');
  assert(ocr, 'OCR card injected before the intake panel');
  assert(ocr.textContent.includes('Tesseract') && ocr.textContent.includes('never leaves this browser'), 'card names the free engine and the privacy model');
  const osel=ocr.querySelector('select');
  assert(osel.options.length===3 && osel.value==='K', 'entity selector lists all entities, defaults to active');
  window.dispatchEvent(new window.CustomEvent('wp:state')); await run();
  assert(d.querySelectorAll('.en9-ocr').length===1, 'OCR card is a singleton');

  // 22. validation + attached-file picker + mocked end-to-end run
  const btn=ocr.querySelector('.en9-ocr-btn'), stat=ocr.querySelector('.en9-ocr-status');
  const srcSel=ocr.querySelector('.en9-ocr-src');
  assert(srcSel, 'source dropdown present');
  assert([...srcSel.options].some(o=>o.textContent.includes('Already attached: Scanned_Statement_2024.pdf')), 'already-attached intake PDFs listed for the selected entity');
  btn.click();
  assert(stat.textContent.includes('Pick an already-attached PDF'), 'run without any source shows the two-option validation message');
  // choosing the attached file hides the disk picker
  srcSel.value=[...srcSel.options].find(o=>o.value!=='').value;
  srcSel.dispatchEvent(new window.Event('change',{bubbles:true}));
  assert(ocr.querySelector('input[type=file]').style.display==='none', 'disk picker hidden when an attached file is chosen');
  // mock IO seam + intake action, drive the orchestration
  let added=null; window.__WPACT={addFiles:(eid,files)=>{added={eid,files};}};
  window.__EN9TEST_OCR = async (file, eid) => new Promise(resolve=>{
    // reach into the layer through the palette-safe globals: run via the same function the button uses
    // (we call en9OcrRun indirectly by stubbing EN9OCR.io inside the page context)
    resolve(null);
  });
  window.__EN9OCR.io={
    loadEngines:(st)=>Promise.resolve(),
    openPdf:(buf)=>Promise.resolve({numPages:2}),
    renderPage:(pdf,n)=>Promise.resolve({png:'data:image/png;base64,AAAA',scale:2.4,w:595,h:842,canvas:{}}),
    makeWorker:(langs,st)=>{ window.__ocrLangs=langs; return Promise.resolve({terminate(){}}); },
    recognize:(w,pg)=>Promise.resolve({words:[{text:'Omzet',bbox:{x0:10,y0:10,x1:60,y1:24}},{text:'9.703',bbox:{x0:400,y0:10,x1:460,y1:24}}]}),
    buildPdf:(pages)=>Promise.resolve(new Uint8Array([37,80,68,70]))
  };
  const fakeFile=new window.File([new Uint8Array([1,2,3])],'Mark_Wendorf-Annual_Statement_2024.pdf',{type:'application/pdf'});
  window.__en9OcrRun(fakeFile,'S','eng+nld', m=>{window.__lastStatus=m;}, r=>{window.__ocrRes=r;});
  await new Promise(r=>setTimeout(r,80));
  assert(window.__ocrRes && window.__ocrRes.pages===2 && window.__ocrRes.words===4, 'mocked run processes both pages and counts words: '+JSON.stringify(window.__ocrRes&&{p:window.__ocrRes.pages,w:window.__ocrRes.words}));
  assert(window.__ocrRes.file.name==='Mark_Wendorf-Annual_Statement_2024 (OCR).pdf', 'output named with (OCR) provenance suffix');
  assert(window.__ocrLangs==='eng+nld', 'language selection passed to the engine');
  assert(String(window.__lastStatus).includes('Done'), 'status reports completion');

  // 23. add-to-intake hand-off + palette entry
  window.__EN9OCR.result=window.__ocrRes;
  ocr.querySelector('.en9-ocr-acts').style.display='';
  ocr.querySelector('.en9-ocr-acts .primary').click();
  assert(added && added.eid==='S' && added.files[0].name.includes('(OCR)'), 'Add to intake calls the store action with the chosen entity');
  assert(stat.textContent.includes('verify every figure'), 'post-add message mandates verification');
  d.dispatchEvent(new window.KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true,cancelable:true}));
  const kinO=d.querySelector('.en9-kin');
  kinO.value='ocr'; kinO.dispatchEvent(new window.Event('input',{bubbles:true}));
  assert([...d.querySelectorAll('.en9-kitem')].some(r=>r.textContent.includes('OCR a scanned PDF')), 'command palette exposes the OCR tool');
  kinO.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));

  // 24. OCR settings card: details, usage, pending verification
  window.dispatchEvent(new window.CustomEvent('wp:state')); await run();
  const oset=d.querySelector('.en9-ocrset');
  assert(oset, 'OCR settings card injected into Settings');
  assert(oset.textContent.includes('Tesseract.js v5') && oset.textContent.includes('Apache-2.0'), 'engine + license details shown');
  assert(oset.textContent.includes('Unlimited') && oset.textContent.includes('nothing metered'), 'quota shown as unlimited (free engine)');
  assert(oset.textContent.includes('1 document(s)') && oset.textContent.includes('2 page(s)') && oset.textContent.includes('4 word(s)'), 'session usage counters reflect the earlier mocked run: '+(oset.textContent.match(/This session[^\n]*/)||[''])[0].slice(0,120));
  assert(oset.textContent.includes('1 file(s)') && oset.textContent.includes('pending manual verification'), 'pending verification counts (OCR) files from state');
  assert(oset.textContent.includes('Shaka Traders Pty Ltd') && oset.textContent.includes('(OCR).pdf'), 'pending list names the entity and file');
  assert(oset.textContent.includes('How it works') && oset.textContent.includes('OCRmyPDF'), 'how-it-works steps present');
  assert(oset.textContent.includes('PDF files only') && oset.textContent.includes('handwriting'), 'accepted-input guidance present');
  assert(oset.querySelectorAll('.en9-auth-fact').length>=4 && oset.querySelectorAll('.en9-auth-miss').length>=5, 'pros and cons listed');
  window.dispatchEvent(new window.CustomEvent('wp:state')); await run();
  assert(d.querySelectorAll('.en9-ocrset').length===1, 'settings card idempotent with live re-render');

  // 25. sandbox handling: upfront notice + friendly worker-error mapping
  assert(ocr.querySelector('.en9-ocr-sandbox') && ocr.querySelector('.en9-ocr-sandbox').textContent.includes('deployed site'), 'preview-sandbox notice shown upfront');
  window.__EN9OCR.io={
    loadEngines:()=>Promise.resolve(),
    openPdf:()=>Promise.resolve({numPages:1}),
    renderPage:()=>Promise.resolve({png:'x',scale:2.4,w:595,h:842,canvas:{}}),
    makeWorker:()=>Promise.reject(new Error("Failed to construct 'Worker': Script at 'blob-request://blob-1' cannot be accessed from origin 'https://www.claudeusercontent.com'.")),
    recognize:()=>Promise.resolve({words:[]}),
    buildPdf:()=>Promise.resolve(new Uint8Array([1]))
  };
  const ff2=new window.File([new Uint8Array([1])],'scan.pdf',{type:'application/pdf'});
  window.__en9OcrRun(ff2,'S','eng', m=>{window.__lastStatus2=m;}, ()=>{});
  await new Promise(r=>setTimeout(r,60));
  assert(String(window.__lastStatus2).includes('preview sandbox blocks background workers') && !String(window.__lastStatus2).includes('blob-request'), 'raw Worker error replaced with the friendly explanation');

  // 26. pager survives table re-creation (stale-reference fix)
  const ev3=d.getElementById('ev');
  const pager3=[...d.querySelectorAll('.en9-pager')].find(p=>p.getAttribute('data-en9t')===((ev3.tHead.rows[0].textContent||'').replace(/\s+/g,'').slice(0,60)));
  const pg10=pager3.querySelector('select'); pg10.value='10'; pg10.dispatchEvent(new window.Event('change',{bubbles:true})); await run();
  // simulate React re-creating the table element in place
  const clone=ev3.cloneNode(true); clone.querySelectorAll('[data-en9]').forEach(x=>x.remove());
  ev3.parentElement.replaceChild(clone, ev3); clone.id='ev';
  window.dispatchEvent(new window.CustomEvent('wp:state')); await run(); await run();
  pager3.querySelector('[data-en9pg="next"]').click(); await run();
  const vis3=[...clone.tBodies[0].rows].filter(r=>!r.classList.contains('en9-hidden')&&!r.hasAttribute('data-en9'));
  assert(vis3.length===4 && pager3.querySelector('.en9-pinfo').textContent.includes('Page 2 of 2'), 'pager pages correctly after the table node was re-created: '+pager3.querySelector('.en9-pinfo').textContent);
  pg10.value='ALL'; pg10.dispatchEvent(new window.Event('change',{bubbles:true})); await run();

  console.log(process.exitCode? 'TESTS FAILED':'ALL 26 TEST GROUPS PASSED');
})();
