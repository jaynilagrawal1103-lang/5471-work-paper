/* ===== WP UI Enhancement Layer (EN9) — reactive DOM augmentation =====
   Reacts to every state change (wp:state event fired by the store) and to
   DOM mutations from React re-renders. All operations are idempotent and
   additive: React-owned nodes are never removed, moved, or text-split. */
(function(){
"use strict";
var S = { q:"", sch:"ALL", multi:false, edited:false,
          openMeta:{}, collapsed:{}, logOpen:false,
          cf:{}, page:{}, pp:{} };
/* A7. The old key led with the table's index in document.querySelectorAll("table"),
   so it changed whenever ANY earlier table mounted or unmounted: filter state,
   page and rows-per-page were silently lost and injectPager appended a second
   bar every time. The key is now derived from content only, and every node this
   layer injects is stripped out first -- otherwise the carets we add would
   themselves destabilise the key they are stored under. */
function thName(th){
  if(!th) return "";
  var c = th.cloneNode(true), junk = c.querySelectorAll("[data-en9]");
  for(var i=0;i<junk.length;i++) junk[i].remove();
  return (c.textContent||"").replace(/\s+/g," ").trim();
}
function tkey(tb){
  var h = tb.tHead && tb.tHead.rows[0] ? tb.tHead.rows[0] : null, names = [];
  if(h) for(var i=0;i<h.cells.length;i++) names.push(thName(h.cells[i]).replace(/\s+/g,""));
  var panel = tb.closest ? tb.closest(".panel") : null;
  var hd = panel ? panel.querySelector(".panel-heading h2, .panel-heading h1") : null;
  var title = (hd ? hd.textContent : "") || "";
  /* position among the panel's OWN tables: stable, unlike a document-wide index */
  var wrap = (tb.closest && tb.closest(".wp-table")) || tb.parentElement;
  var sibs = panel ? panel.querySelectorAll(".wp-table") : [];
  var pos = Array.prototype.indexOf.call(sibs, wrap);
  return title.replace(/\s+/g,"").slice(0,28) + "#" + (pos<0?0:pos) + "#"
       + names.join("|").slice(0,90) + "#" + (h ? h.cells.length : 0);
}
/* The Status cell holds a chip AND a select; the filter must read the chip,
   not every option in the dropdown. Buttons and our own nodes go too, and an
   input contributes its value rather than nothing. */
function cellText(td){
  if(!td) return "";
  var c = td.cloneNode(true), drop = c.querySelectorAll("[data-en9],select,option,button");
  for(var i=0;i<drop.length;i++) drop[i].remove();
  var live = td.querySelectorAll("input"), cl = c.querySelectorAll("input");
  for(var k=0;k<cl.length;k++){
    var v = live[k] ? (live[k].type==="checkbox" ? (live[k].checked?"yes":"no") : String(live[k].value||"")) : "";
    if(cl[k].parentNode) cl[k].parentNode.replaceChild(document.createTextNode(" "+v+" "), cl[k]);
  }
  var t = (c.textContent||"").replace(/\s+/g," ").trim();
  if(!t){ var sel = td.querySelector("select"); if(sel && sel.selectedIndex>=0 && sel.options[sel.selectedIndex])
    t = (sel.options[sel.selectedIndex].textContent||"").trim(); }
  return t;
}
var enhancing = false, timer = null;

function st(){ try{ return window.__WPGET && window.__WPGET(); }catch(e){ return null; } }
function ent(){ var s = st(); if(!s||!s.entities||!s.entities.length) return null;
  for(var i=0;i<s.entities.length;i++) if(s.entities[i].id===s.activeEntityId) return s.entities[i];
  return s.entities[0]; }
function num(t){ t = String(t==null?"":t).trim(); if(!t||t==="\u2014") return null;
  var neg = /^\(.*\)$/.test(t); var v = parseFloat(t.replace(/[^0-9.\-]/g,""));
  if(!isFinite(v)) return null; return neg ? -v : v; }
function el(tag, cls, txt){ var e=document.createElement(tag); if(cls)e.className=cls;
  if(txt!=null)e.textContent=txt; e.setAttribute("data-en9",""); return e; }
function isOurs(n){ return n && n.nodeType===1 && (n.hasAttribute("data-en9") || (n.closest && n.closest("[data-en9]"))); }

/* ---------- entity pills: live status dot + review badge ---------- */
function enhancePills(){
  var s = st(); if(!s) return;
  var pills = document.querySelectorAll(".entity-switch .chip-btn");
  for(var i=0;i<pills.length;i++){
    var p = pills[i], name = "";
    for(var c=0;c<p.childNodes.length;c++)
      if(p.childNodes[c].nodeType===3) name += p.childNodes[c].nodeValue;
    name = name.trim() || p.textContent.trim();
    var e = null;
    for(var j=0;j<s.entities.length;j++){
      var nm = s.entities[j].name || "";
      if(name.indexOf(nm)===0 || nm===name){ e=s.entities[j]; break; } }
    var old = p.querySelector(".en9-dot"); if(old) old.remove();
    var ob = p.querySelector(".en9-nbadge"); if(ob) ob.remove();
    if(!e) continue;
    var lines = e.lines ? Object.keys(e.lines).length : 0;
    var warns = (e.reviewItems||[]).filter(function(r){return !r.dismissed && (r.level==="warn"||r.level==="block");}).length;
    var dot = el("span","en9-dot");
    if(e.status==="processing") dot.classList.add("busy");
    else if(warns>0) dot.classList.add("warn");
    else if(lines>0) dot.classList.add("ok");
    p.insertBefore(dot, p.firstChild);
    if(warns>0){ var b = el("span","en9-nbadge", String(warns)); b.title = warns+" open review item(s)"; p.appendChild(b); } }
}

/* ---------- table detection ---------- */
/* A3. Every table in every tab, not just the two kinds the layer used to know
   about. "map" gets grouping and subtotals, "big" gets a pager, "plain" gets
   the same header filters as everything else and nothing more. */
function mapTables(){
  var out=[], tbs=document.querySelectorAll(".view-stack table, .wp-table table");
  for(var i=0;i<tbs.length;i++){
    var tb=tbs[i];
    if(!tb.tHead || !tb.tHead.rows.length) continue;
    if(isOurs(tb)) continue;
    var dup=false;
    for(var d=0;d<out.length;d++) if(out[d].table===tb){ dup=true; break; }
    if(dup) continue;
    var wrap = (tb.closest && tb.closest(".wp-table")) || tb.parentElement;
    if(!wrap) continue;
    var h = tb.tHead.textContent||"", rules = wrap.classList && wrap.classList.contains("rules-table");
    var kind = (!rules && /Source caption/i.test(h)) ? "map"
             : (!rules && tb.tBodies[0] && tb.tBodies[0].rows.length>=10) ? "big"
             : "plain";
    out.push({wrap:wrap, table:tb, kind:kind});
  }
  return out;
}
function dataRows(tb){ var rs=[], all=tb.tBodies[0]?tb.tBodies[0].rows:[];
  for(var i=0;i<all.length;i++) if(!all[i].hasAttribute("data-en9")) rs.push(all[i]);
  return rs; }
function rowKey(r){ /* "Sch C"+"F7" -> IS:7 ; "Sch F"+"D/F11" -> BS:11 */
  var sch=(r.cells[0]&&r.cells[0].textContent||"").trim();
  var cell=(r.cells[r.cells.length-1]&&r.cells[r.cells.length-1].textContent||"").trim();
  var m=cell.match(/(\d+)\s*$/); if(!m) return null;
  return { sch:sch, key:(sch==="Sch C"?"IS:":"BS:")+m[1], field:(sch==="Sch C"?"amount":"eoy") }; }

/* ---------- per-row decoration (caption chips, remap pencil, badges, edited) ---------- */
function decorateRow(r, kind){
  var e = ent();
  r.setAttribute("data-en9s", r.textContent.toLowerCase());
  var rk = kind==="map" ? rowKey(r) : null;
  if(rk) r.setAttribute("data-en9sch", rk.sch);
  /* responsive labels */
  var ths = r.closest("table").tHead.rows[0].cells;
  for(var c=0;c<r.cells.length && c<ths.length;c++)
    if(!r.cells[c].hasAttribute("data-en9l"))
      r.cells[c].setAttribute("data-en9l",(ths[c].textContent||"").trim());
  if(kind!=="map") return;
  var cap = r.cells[2]; if(!cap) return;
  /* caption meta -> chip */
  var smalls = cap.querySelectorAll("small");
  for(var i=0;i<smalls.length;i++){
    var sm = smalls[i], holder = sm.parentElement; if(!holder) continue;
    if(!holder.classList.contains("en9-metahide")){
      holder.classList.add("en9-metahide");
      var mtxt = sm.textContent||"", pm = mtxt.match(/p\.(\d+)/);
      var dm = mtxt.match(/\xB7\s*([^\xB7()]+\.(?:pdf|xlsx|xls|csv|xlsm))/i);
      var chip = el("button","en9-chip", pm ? ("\uD83D\uDCC4 p."+pm[1]) : "\uD83D\uDCC4 source");
      chip.type="button";
      chip.title=(dm?dm[1].trim()+" \u2014 ":"")+"show extracted amounts & source";
      var mkey=(rk?rk.key:"")+"|"+(holder.textContent||"").slice(0,40);
      chip.setAttribute("data-en9k",mkey);
      if(S.openMeta[mkey]) holder.classList.add("en9-open");
      holder.appendChild(chip);
    }
  }
  /* remap selects -> pencil */
  var sels = cap.querySelectorAll("select.stake-input");
  for(var i2=0;i2<sels.length;i2++){
    var sl = sels[i2];
    if(!sl.classList.contains("en9-hide") && !sl.hasAttribute("data-en9p")){
      sl.classList.add("en9-hide"); sl.setAttribute("data-en9p","1");
      var pen = el("button","en9-pencil","\u270E"); pen.type="button"; pen.title="Remap this caption";
      sl.parentElement && sl.parentElement.insertBefore(pen, sl);
    }
  }
  /* multi-source badge on template-line cell */
  var srcCount = cap.querySelectorAll(":scope > div").length;
  var tl = r.cells[1];
  var oldB = tl.querySelector(".en9-multi-badge"); if(oldB) oldB.remove();
  r.classList.toggle("en9-multi", srcCount>1);
  if(srcCount>1){ var bb=el("span","en9-multi-badge", srcCount+" sources");
    bb.title="This line sums "+srcCount+" source captions \u2014 expand \uD83D\uDCC4 chips to inspect each."; tl.appendChild(bb); }
  /* edited detection from live state: value differs from extracted sum */
  var oldD = tl.querySelector(".en9-edited-dot"); if(oldD) oldD.remove();
  r.classList.remove("en9-edited");
  if(e && rk && e.contributions){
    var EN9fields = rk.sch==="Sch C" ? [rk.field] : ["boy","eoy"];
    var EN9bad=false, sum=null, line=null;
    for(var EN9fi=0; EN9fi<EN9fields.length; EN9fi++){
      var EN9f=EN9fields[EN9fi];
      var consF=(e.contributions[rk.key]||[]).filter(function(u){return u.field===EN9f && typeof u.value==="number";});
      var lineF=e.lines && e.lines[rk.key] ? e.lines[rk.key][EN9f] : null;
      if(consF.length && typeof lineF==="number" && Math.abs(consF.reduce(function(a,u){return a+u.value;},0)-lineF)>0.01){
        EN9bad=true; sum=consF.reduce(function(a,u){return a+u.value;},0); line=lineF; }
    }
    var cons=(e.contributions[rk.key]||[]).filter(function(u){return u.field===rk.field && typeof u.value==="number";});
    if(EN9bad){
      {
        r.classList.add("en9-edited");
        var d=el("span","en9-edited-dot");
        d.title="Manually edited \u2014 extracted total was "+sum.toLocaleString("en-US")+", current value is "+line.toLocaleString("en-US");
        tl.appendChild(d);
      } } }
  /* AI provenance badge (via:"groq" contributions from this run) */
  var oldA = tl.querySelector(".en9-ai-badge"); if(oldA) oldA.remove();
  r.classList.remove("en9-ai");
  if(e && rk && e.contributions){
    var aic = (e.contributions[rk.key]||[]).some(function(u){ return u.via === "groq"; });
    if(aic){ r.classList.add("en9-ai");
      var ab = el("span","en9-ai-badge","AI");
      ab.title = "Mapped by the Groq model \u2014 provenance in the source chips; remap with the pencil.";
      tl.appendChild(ab); } }
  /* OCR provenance badge \u2014 the full OCR panel lives on Documents \u25b8 OCR;
     everywhere else a value from an "(OCR).pdf" document gets this flag only. */
  var oldO = tl.querySelector(".en9-ocr-flag"); if(oldO) oldO.remove();
  r.classList.remove("en9-ocrsrc");
  var EN9sm=cap.querySelectorAll("small"), EN9o=false;
  for(var oi=0;oi<EN9sm.length;oi++)
    if(/\(OCR\)\.pdf/i.test(EN9sm[oi].textContent||"")){ EN9o=true; break; }
  if(EN9o){ r.classList.add("en9-ocrsrc");
    var ob2=el("span","en9-ocr-flag","\u26a0 OCR \u2014 verify");
    ob2.title="This value came from an OCR-processed document \u2014 recognition can misread digits; verify against the original scan.";
    tl.appendChild(ob2); }
}

/* OCR flags outside the mapping table (Shareholders/Dividends smalls etc.):
   any .wp-table provenance small citing an "(OCR).pdf" document gets the
   verify badge appended once. */
function enhanceOcrBadges(){
  var sms=document.querySelectorAll(".wp-table small");
  for(var i=0;i<sms.length;i++){
    var sm=sms[i]; if(isOurs(sm)) continue;
    if(!/\(OCR\)\.pdf/i.test(sm.textContent||"")) continue;
    if(sm.nextElementSibling&&sm.nextElementSibling.classList&&sm.nextElementSibling.classList.contains("en9-ocr-flag")) continue;
    var row=sm.closest("tr");
    if(row&&row.querySelector(".en9-ocr-flag")) continue;  /* mapping rows already badged */
    var b=el("span","en9-ocr-flag","\u26a0 OCR \u2014 verify");
    b.title="Sourced from an OCR-processed document \u2014 verify against the original scan.";
    sm.parentElement.insertBefore(b, sm.nextSibling);
  }
}

/* ---------- grouping, subtotals, filtering ---------- */
function matches(r, key, kind){
  if(!rowPasses(r, key)) return false;
  if(kind!=="map") return true;      /* global map filters must not hide other views' tables */
  if(S.q && (r.getAttribute("data-en9s")||"").indexOf(S.q)===-1) return false;
  if(S.sch!=="ALL" && r.getAttribute("data-en9sch")!==S.sch) return false;
  if(S.multi && !r.classList.contains("en9-multi")) return false;
  if(S.edited && !r.classList.contains("en9-edited")) return false;
  return true; }
function groupName(sch){ return sch==="Sch C" ? "Schedule C \u2014 Income statement"
                       : sch==="Sch F" ? "Schedule F \u2014 Balance sheet" : sch; }
function rebuild(tb, kind){
  var body = tb.tBodies[0]; if(!body) return;
  var key = tkey(tb);
  var olds = body.querySelectorAll("tr.en9-x");
  for(var i=0;i<olds.length;i++) olds[i].remove();
  var rows = dataRows(tb), cols = tb.tHead.rows[0].cells.length, visTotal=0;
  for(var i2=0;i2<rows.length;i2++){
    var ok = matches(rows[i2], key, kind);
    rows[i2].classList.toggle("en9-hidden", !ok || (kind==="map" && !!S.collapsed[rows[i2].getAttribute("data-en9sch")]));
    if(ok) visTotal++;
  }
  if(kind==="map"){
    var cur=null, groupRows=[];
    function flush(){
      if(!cur||!groupRows.length) return;
      var vis=groupRows.filter(function(r){return matches(r, key, kind);});
      var head=el("tr","en9-x en9-group"+(S.collapsed[cur]?" en9-closed":""));
      var td=el("td"); td.colSpan=cols;
      td.appendChild(el("span","en9-chev","\u25BE"));
      td.appendChild(document.createTextNode(groupName(cur)+" ("+vis.length+(vis.length!==groupRows.length?" of "+groupRows.length:"")+" lines)"));
      head.appendChild(td);
      (function(sch){ head.addEventListener("click",function(){ S.collapsed[sch]=!S.collapsed[sch]; schedule(); }); })(cur);
      body.insertBefore(head, groupRows[0]);
      var sum=0, has=false;
      for(var v=0;v<vis.length;v++){ var n=num(vis[v].querySelector("td.numeric") && vis[v].querySelector("td.numeric").textContent);
        if(n!=null){ sum+=n; has=true; } }
      if(has && vis.length && !S.collapsed[cur]){
        var sub=el("tr","en9-x en9-subtotal");
        var a=el("td"); a.colSpan=cols-2; a.textContent="Subtotal \u2014 "+groupName(cur)+(vis.length!==groupRows.length?" (filtered)":"");
        var b=el("td","numeric", sum<0 ? "("+Math.abs(sum).toLocaleString("en-US")+")" : sum.toLocaleString("en-US"));
        var c2=el("td");
        sub.appendChild(a); sub.appendChild(b); sub.appendChild(c2);
        var last=vis[vis.length-1];
        if(last.nextSibling) body.insertBefore(sub,last.nextSibling); else body.appendChild(sub);
      }
    }
    for(var i3=0;i3<rows.length;i3++){
      var sch=rows[i3].getAttribute("data-en9sch");
      if(sch!==cur){ flush(); cur=sch; groupRows=[]; }
      groupRows.push(rows[i3]);
    }
    flush();
  }
  if(kind==="big"){
    var pp = S.pp[key]||25, pg = S.page[key]||0;
    if(pp!=="ALL"){
      var visRows=[]; for(var pv=0; pv<rows.length; pv++)
        if(!rows[pv].classList.contains("en9-hidden")) visRows.push(rows[pv]);
      var pages=Math.max(1, Math.ceil(visRows.length/pp));
      if(pg>=pages){ pg=pages-1; S.page[key]=pg; }
      for(var pr=0; pr<visRows.length; pr++)
        if(pr<pg*pp || pr>=(pg+1)*pp) visRows[pr].classList.add("en9-hidden");
      tb.setAttribute("data-en9pages", String(pages));
      tb.setAttribute("data-en9total", String(visRows.length));
      S.pgTotal=S.pgTotal||{}; S.pgTotal[key]={pages:pages,total:visRows.length};
    } else { tb.setAttribute("data-en9pages","1"); S.pgTotal=S.pgTotal||{}; S.pgTotal[key]={pages:1,total:rows.length}; }
  }
  if(!visTotal && rows.length){
    var nr=el("tr","en9-x en9-noresult"); var nt=el("td"); nt.colSpan=cols;
    nt.textContent="No lines match the current filters."; nr.appendChild(nt); body.appendChild(nr);
  }
}

/* ---------- A2/A4/A6: header carets, popups parented to <body> ----------
   The separate filter row is gone. Every filterable column carries a caret on
   its existing header, matching the Exception centre. The popup CANNOT live in
   the <th>: .wp-table sets overflow:auto and clips it, and a React rebuild tears
   the header down mid-keystroke. It is a single element on <body> instead. */
var EN9SKIPCOL = /^(remove|restore|use|open|delete|actions?|edit|\u2715|\+ ?policy)$/i;

function colFilterable(tb, idx){
  var th = tb.tHead.rows[0].cells[idx], name = thName(th);
  if(!name) return false;                       /* unlabelled column */
  if(EN9SKIPCOL.test(name)) return false;       /* action-only column */
  var rows = dataRows(tb), sampled = 0, withText = 0;
  for(var i=0;i<rows.length && sampled<40;i++){
    var td = rows[i].cells[idx]; if(!td) continue;
    sampled++; if(cellText(td)) withText++;
  }
  return sampled === 0 ? true : withText > 0;   /* buttons only -> not filterable */
}
function colFilter(key, idx){ return (S.cf[key]||{})[idx]||null; }
function colActive(key, idx){
  var f = colFilter(key, idx);
  return !!(f && (f.q || (f.ex && Object.keys(f.ex).length)));
}
function rowPasses(r, key, skipIdx){
  var cf = key ? S.cf[key] : null; if(!cf) return true;
  for(var ci in cf){
    if(skipIdx !== undefined && String(ci) === String(skipIdx)) continue;
    var f = cf[ci]; if(!f) continue;
    var td = r.cells[ci]; if(!td) return false;
    var v = cellText(td);
    if(f.q && v.toLowerCase().indexOf(f.q) === -1) return false;
    if(f.ex && f.ex[v]) return false;
  }
  return true;
}
/* Options narrow against the OTHER columns' filters, so the list never offers a
   value that would produce an empty table. */
function colOptions(tb, key, idx){
  var rows = dataRows(tb), seen = {}, out = [];
  for(var i=0;i<rows.length;i++){
    if(!rowPasses(rows[i], key, idx)) continue;
    var v = cellText(rows[i].cells[idx]);
    if(!(v in seen)){ seen[v] = 1; out.push(v); }
  }
  return out.sort(function(a,b){ return String(a).localeCompare(String(b), undefined, {numeric:true}); });
}

var POP = null, POPFOR = null, POPANCHOR = null, POPBOUND = false;
function popEl(){
  if(POP && POP.isConnected) return POP;
  POP = el("div","en9-fpop"); POP.hidden = true;
  document.body.appendChild(POP);                 /* A6: <body>, never the <th> */
  return POP;
}
/* A5: shared with the React filters so both behave identically. */
function place(rect, w, h){
  if(window.EN9popPlace) return window.EN9popPlace(rect, {w:w,h:h}, {w:innerWidth,h:innerHeight});
  var ww = Math.max(180, Math.min(w, innerWidth-16)),
      left = Math.max(8, Math.min(rect.left, innerWidth-ww-8)),
      below = innerHeight-rect.bottom-8, above = rect.top-8,
      flip = below < Math.min(h,160) && above > below,
      hh = Math.min(h, Math.max(120, flip?above:below)),
      top = flip ? Math.max(8, rect.top-hh-4) : Math.min(rect.bottom+4, Math.max(8, innerHeight-hh-8));
  return {left:Math.round(left), top:Math.round(top), width:Math.round(ww), maxHeight:Math.round(hh), flip:flip};
}
function popPosition(){
  if(!POP || POP.hidden || !POPANCHOR || !POPANCHOR.isConnected) return;
  var p = place(POPANCHOR.getBoundingClientRect(), 288, 320);
  POP.style.left = p.left+"px"; POP.style.top = p.top+"px";
  POP.style.width = p.width+"px"; POP.style.maxHeight = p.maxHeight+"px";
  POP.classList.toggle("en9-flip", !!p.flip);
}
function popClose(){ if(POP){ POP.hidden = true; } POPFOR = null; POPANCHOR = null; }
function popBind(){
  if(POPBOUND) return; POPBOUND = true;
  addEventListener("scroll", popPosition, true);
  addEventListener("resize", popPosition);
  document.addEventListener("mousedown", function(ev){
    if(!POP || POP.hidden) return;
    if(POP.contains(ev.target)) return;
    if(ev.target.closest && ev.target.closest(".en9-caret")) return;
    popClose();
  }, true);
  document.addEventListener("keydown", function(ev){ if(ev.key === "Escape") popClose(); });
}
function popOpen(tb, key, idx, caret){
  popBind();
  var p = popEl(), id = key+"::"+idx;
  if(POPFOR === id && !p.hidden){ popClose(); return; }
  POPFOR = id; POPANCHOR = caret; p.hidden = false;
  p.textContent = "";
  var name = thName(tb.tHead.rows[0].cells[idx]);
  var f = colFilter(key, idx) || {q:"", ex:{}};
  var save = function(next){
    S.cf[key] = S.cf[key] || {};
    if(!next.q && !Object.keys(next.ex||{}).length) delete S.cf[key][idx];
    else S.cf[key][idx] = next;
    S.page[key] = 0;
    rebuildAll();
  };
  var box = el("input","en9-search"); box.type = "search";
  box.placeholder = "Search "+name.toLowerCase()+"\u2026"; box.value = f.q||"";
  box.addEventListener("input", function(){
    /* keep the closed-over state in step: the value checkboxes below read `f`,
       and a stale q here would silently AND itself against every exclusion */
    f = {q:box.value.toLowerCase(), ex:f.ex||{}};
    save(f);
    popPosition();
  });
  p.appendChild(box);
  var acts = el("div","en9-fpop-acts");
  var all = el("button","en9-fchip","Select all"); all.type = "button";
  var none = el("button","en9-fchip","Clear"); none.type = "button";
  acts.appendChild(all); acts.appendChild(none); p.appendChild(acts);
  var listWrap = el("div","en9-fpop-list");
  var opts = colOptions(tb, key, idx);
  all.addEventListener("click", function(){ save({q:f.q||"", ex:{}}); popOpen(tb,key,idx,caret); });
  none.addEventListener("click", function(){
    var ex = {}; for(var i=0;i<opts.length;i++) ex[opts[i]] = true;
    save({q:f.q||"", ex:ex}); popOpen(tb,key,idx,caret);
  });
  if(!opts.length) listWrap.appendChild(el("div","en9-fpop-empty","No values in this column yet."));
  for(var i=0;i<opts.length;i++){
    (function(v){
      var lab = el("label","en9-fpop-opt");
      var cb = el("input"); cb.type = "checkbox"; cb.checked = !(f.ex && f.ex[v]);
      cb.addEventListener("change", function(){
        var ex = {}; for(var k in (f.ex||{})) ex[k] = f.ex[k];
        if(cb.checked) delete ex[v]; else ex[v] = true;
        f = {q:f.q||"", ex:ex};
        save(f);
      });
      var sp = el("span",null, v === "" ? "(blank)" : v); sp.title = v;
      lab.appendChild(cb); lab.appendChild(sp); listWrap.appendChild(lab);
    })(opts[i]);
  }
  p.appendChild(listWrap);
  popPosition();
  /* A1 ROOT CAUSE: focusing inside a scrollable ancestor scrolls it into view.
     preventScroll keeps the page exactly where the user left it. */
  if(window.EN9focusNoScroll) window.EN9focusNoScroll(box);
  else try{ box.focus({preventScroll:true}); }catch(e){}
}
function injectColFilters(item){
  var tb = item.table, head = tb.tHead;
  if(!head || !head.rows.length) return;
  if(head.querySelector("button:not([data-en9])")) return; /* React column filters already here */
  var r0 = tb.tBodies[0] && tb.tBodies[0].rows[0];
  if(r0 && !r0.hasAttribute("data-en9") && r0.cells.length !== head.rows[0].cells.length) return;
  var old = head.querySelector("tr.en9-cfrow"); if(old) old.remove();   /* A2: no separate row */
  var key = tkey(tb), ths = head.rows[0].cells;
  for(var i=0;i<ths.length;i++){
    var th = ths[i], has = th.querySelector(":scope > .en9-caret");
    if(!colFilterable(tb, i)){ if(has) has.remove(); continue; }
    if(!has){
      has = el("button","en9-caret","\u25BC"); has.type = "button";
      has.setAttribute("data-en9c", String(i));
      th.appendChild(has);
    }
    has.setAttribute("data-en9c", String(i));
    has.classList.toggle("on", colActive(key, i));
    has.title = colActive(key, i) ? "Filtered \u2014 click to change" : "Filter "+thName(th);
    has.setAttribute("aria-label", "Filter "+thName(th));
  }
}
function fixSticky(tb){ /* re-measure every pass: header heights vary per table/view */
  var head=tb.tHead; if(!head||!head.rows.length) return;
  var h0=Math.max(0, head.rows[0].getBoundingClientRect().height||0);
  var band=Math.max(0, head.getBoundingClientRect().height||0)||h0;
  var gs=tb.querySelectorAll("tr.en9-group td");
  for(var j=0;j<gs.length;j++) gs[j].style.top=band+"px";
}
/* ---------- pagination bar for long tables ---------- */
function injectPager(item){
  if(item.kind!=="big") return;
  var tb=item.table, wrap=item.wrap, parent=wrap.parentElement; if(!parent) return;
  var key=tkey(tb), rows=dataRows(tb);
  var bar=parent.querySelector(':scope > .en9-pager[data-en9t="'+key+'"]');
  if(rows.length<=10 && !bar){ return; }
  if(!bar){
    bar=el("div","en9-pager"); bar.setAttribute("data-en9t",key);
    var lab=el("span","en9-plabel","Rows per page"); bar.appendChild(lab);
    var sel=el("select");
    ["10","25","50","ALL"].forEach(function(v){ var o=document.createElement("option");
      o.value=v; o.textContent=v==="ALL"?"All":v; sel.appendChild(o); });
    sel.value=String(S.pp[key]||25);
    (function(k2,x){ x.addEventListener("change",function(){
      S.pp[k2]=x.value==="ALL"?"ALL":parseInt(x.value,10); S.page[k2]=0; rebuildAll(); }); })(key,sel);
    bar.appendChild(sel);
    var info=el("span","en9-pinfo"); bar.appendChild(info);
    [["\u00AB","first"],["\u2039","prev"],["\u203A","next"],["\u00BB","last"]].forEach(function(b){
      var bt=el("button","en9-pbtn",b[0]); bt.type="button"; bt.setAttribute("data-en9pg",b[1]);
      (function(k2,act){ bt.addEventListener("click",function(){
        var pages=(S.pgTotal&&S.pgTotal[k2]?S.pgTotal[k2].pages:1), p=S.page[k2]||0;
        if(act==="first")p=0; else if(act==="prev")p=Math.max(0,p-1);
        else if(act==="next")p=Math.min(pages-1,p+1); else p=pages-1;
        S.page[k2]=p; rebuildAll(); }); })(key,b[1]);
      bar.appendChild(bt);
    });
    if(wrap.nextSibling) parent.insertBefore(bar,wrap.nextSibling); else parent.appendChild(bar);
  }
  var pt=(S.pgTotal&&S.pgTotal[key])||{pages:1,total:rows.length};
  var pages=pt.pages, total=String(pt.total);
  var inf=bar.querySelector(".en9-pinfo");
  if(inf) inf.textContent="Page "+((S.page[key]||0)+1)+" of "+pages+" \u00B7 "+total+" rows";
  var sl=bar.querySelector("select"); if(sl) sl.value=String(S.pp[key]||25);
  bar.style.display = (S.pp[key]==="ALL" && rows.length<=10) ? "none" : "";
}
/* ---------- filter bar (re-injected if React removes it; state survives) ---------- */
function counts(tb){ var rs=dataRows(tb), m=0, ed=0;
  for(var i=0;i<rs.length;i++){ if(rs[i].classList.contains("en9-multi"))m++;
    if(rs[i].classList.contains("en9-edited"))ed++; } return {m:m,ed:ed}; }
function injectBar(item){
  if(item.kind!=="map") return; /* big tables use column filters + pager instead */
  var wrap=item.wrap, parent=wrap.parentElement; if(!parent) return;
  var bar=parent.querySelector(":scope > .en9-fb");
  if(!bar){
    bar=el("div","en9-fb");
    var inp=el("input"); inp.type="search"; inp.placeholder="Filter lines\u2026  ( / )"; inp.value=S.q;
    inp.className="en9-search"; inp.setAttribute("data-en9","");
    inp.addEventListener("input",function(){ S.q=inp.value.toLowerCase(); rebuildAll(); });
    bar.appendChild(inp);
    if(item.kind==="map"){
      var sel=el("select"); sel.setAttribute("data-en9","");
      [["ALL","All schedules"],["Sch C","Schedule C"],["Sch F","Schedule F"]].forEach(function(o){
        var op=document.createElement("option"); op.value=o[0]; op.textContent=o[1]; sel.appendChild(op); });
      sel.value=S.sch;
      sel.addEventListener("change",function(){ S.sch=sel.value; rebuildAll(); });
      bar.appendChild(sel);
      var cm=el("button","en9-fchip"); cm.type="button";
      var ce=el("button","en9-fchip"); ce.type="button";
      cm.addEventListener("click",function(){ S.multi=!S.multi; rebuildAll(); });
      ce.addEventListener("click",function(){ S.edited=!S.edited; rebuildAll(); });
      cm.setAttribute("data-en9r","multi"); ce.setAttribute("data-en9r","edited");
      bar.appendChild(cm); bar.appendChild(ce);
      var cl=el("button","en9-fchip","Clear"); cl.type="button";
      cl.addEventListener("click",function(){ S.q=""; S.sch="ALL"; S.multi=false; S.edited=false; rebuildAll(); syncBars(); });
      bar.appendChild(cl);
    }
    parent.insertBefore(bar, wrap);
  }
  var k=counts(item.table);
  var bm=bar.querySelector('[data-en9r="multi"]');
  if(bm){ bm.textContent=""; bm.appendChild(document.createTextNode("Multi-source"));
    bm.appendChild(el("span","en9-fcount",String(k.m))); bm.classList.toggle("on",S.multi); }
  var be=bar.querySelector('[data-en9r="edited"]');
  if(be){ be.textContent=""; be.appendChild(document.createTextNode("Edited"));
    be.appendChild(el("span","en9-fcount",String(k.ed))); be.classList.toggle("on",S.edited); }
}
function syncBars(){ var ins=document.querySelectorAll(".en9-fb .en9-search");
  for(var i=0;i<ins.length;i++) ins[i].value=S.q;
  var sels=document.querySelectorAll(".en9-fb select");
  for(var j=0;j<sels.length;j++) sels[j].value=S.sch; }

/* ---------- log drawer ---------- */
function enhanceLog(){
  var logs=document.querySelectorAll(".log-list");
  for(var i=0;i<logs.length;i++){
    var lg=logs[i];
    lg.classList.add("en9-clamp");
    lg.classList.toggle("en9-open", !!S.logOpen);
    var prev=lg.previousElementSibling;
    if(!(prev && prev.classList && prev.classList.contains("en9-logbtn"))){
      var btn=el("button","en9-logbtn"); btn.type="button";
      lg.parentElement && lg.parentElement.insertBefore(btn, lg);
      prev=btn;
    }
    prev.textContent=(S.logOpen?"Hide":"Show")+" processing log ("+lg.children.length+")";
  }
}


/* ---------- Filing-category authority panel (IRS i5471 = highest-priority source) ---------- */
var EN9_IRS_URL="https://www.irs.gov/instructions/i5471";
var EN9_IRS={
 "1a":{name:"U.S. shareholder of a section 965 SFC",anchor:"#en_US_202201_publink100057222",sec:"Categories of Filers \u2192 Category 1a Filer",
   crit:"A U.S. shareholder (10%+ of vote or value, counting direct, indirect and constructive ownership) of a section 965 specified foreign corporation, holding that stock on the last day of the year in which it was an SFC, and not within Category 1b or 1c.",
   needs:[["own10","10%+ ownership (vote or value)"],["sfc","Section 965 SFC status (not tracked by this tool \u2014 confirm against the instructions)"]]},
 "1b":{name:"Unrelated \u00A7958(a) shareholder of a foreign-controlled section 965 SFC",anchor:"#en_US_202201_publink100057223",sec:"Categories of Filers \u2192 Category 1b Filer",
   crit:"An unrelated section 958(a) U.S. shareholder of a foreign-controlled section 965 SFC.",
   needs:[["own10","10%+ ownership (vote or value)"],["sfc","Foreign-controlled section 965 SFC status (not tracked \u2014 confirm)"]]},
 "1c":{name:"Related constructive shareholder of a foreign-controlled section 965 SFC",anchor:"#en_US_202201_publink100057224",sec:"Categories of Filers \u2192 Category 1c Filer",
   crit:"A related constructive U.S. shareholder of a foreign-controlled section 965 SFC.",
   needs:[["sfc","Foreign-controlled section 965 SFC status and relatedness (not tracked \u2014 confirm)"]]},
 "2":{name:"Officer or director where a U.S. person acquired 10%",anchor:"#en_US_202201_publink1000277710",sec:"Categories of Filers \u2192 Category 2 Filer",
   crit:"A U.S. citizen or resident who is an officer or director of the foreign corporation in which a U.S. person acquired stock meeting the 10% threshold, or an additional 10%, of value or voting power.",
   needs:[["officer","Officer/director status"],["own10","10% stock ownership by a U.S. person"],["acq","A 10% acquisition event during the year (not tracked \u2014 confirm)"]]},
 "3":{name:"Acquisition or disposition crossing the 10% threshold",anchor:"#en_US_202201_publink1000277713",sec:"Categories of Filers \u2192 Category 3 Filer",
   crit:"A U.S. person whose acquisition brought holdings to the 10% threshold (or was itself 10%+), who became a U.S. person while holding 10%+, or who disposed of stock reducing holdings below 10% (section 6046).",
   needs:[["acq","Acquisition/disposition detail for the year (not tracked \u2014 confirm)"]]},
 "4":{name:"Control of the foreign corporation",anchor:"#id13",sec:"Categories of Filers \u2192 Category 4 Filer",
   crit:"A U.S. person that had control \u2014 more than 50% of total combined voting power or total value \u2014 of the foreign corporation at any time during its annual accounting period (section 6038).",
   needs:[["own50","Ownership above 50% (vote or value) at some point in the year"]]},
 "5a":{name:"U.S. shareholder of a CFC",anchor:"#en_US_202201_publink100057242",sec:"Categories of Filers \u2192 Category 5a Filer",
   crit:"A U.S. shareholder (10%+ of vote or value, counting direct, indirect and constructive ownership) of a controlled foreign corporation, holding the stock on the last day of the year in which it was a CFC, and not within Category 5b or 5c.",
   needs:[["own10","10%+ ownership (vote or value)"],["cfc","CFC status for the year"]]},
 "5b":{name:"Unrelated \u00A7958(a) shareholder of a foreign-controlled CFC",anchor:"#en_US_2023_publink1000115342",sec:"Categories of Filers \u2192 Category 5b Filer",
   crit:"An unrelated section 958(a) U.S. shareholder of a foreign-controlled CFC.",
   needs:[["own10","10%+ ownership (vote or value)"],["cfc","Foreign-controlled CFC status (confirm relatedness)"]]},
 "5c":{name:"Related constructive shareholder of a foreign-controlled CFC",anchor:"#en_US_2023_publink1000115345",sec:"Categories of Filers \u2192 Category 5c Filer",
   crit:"A related constructive U.S. shareholder of a foreign-controlled CFC.",
   needs:[["cfc","Foreign-controlled CFC status and relatedness (not tracked \u2014 confirm)"]]}
};
function EN9_pct(v){ var n=parseFloat(String(v==null?"":v).replace(/[^0-9.\-]/g,"")); return isFinite(n)?n:null; }
function EN9_fmtSrc(src){ if(!src||!src.doc&&!src.heading&&!src.label) return null;
  var parts=[]; if(src.doc)parts.push(src.doc); if(src.page!=null)parts.push("p."+src.page);
  if(src.heading)parts.push("Section: "+src.heading); if(src.label)parts.push("Row: \u201C"+src.label+"\u201D"+(src.value!=null?" = "+src.value:""));
  return parts.join(" \u2192 "); }
function EN9_catEval(code,e){
  var rule=EN9_IRS[code]; if(!rule) return null;
  var o=e.ownership||{}, det=e.detected||{};
  var os=EN9_pct(o.ownStart), oe=EN9_pct(o.ownEnd);
  var ownMax=Math.max(os==null?-1:os, oe==null?-1:oe); if(ownMax<0)ownMax=null;
  var facts=[], missing=[], contra=[];
  function fact(key,text){ var d=det[key];
    facts.push({text:text, src:d&&d.src||null, manual:!(d&&d.src)}); }
  rule.needs.forEach(function(n){
    var k=n[0];
    if(k==="own50"){ if(ownMax!=null&&ownMax>50) fact(oe!=null&&oe>50?"ownEnd":"ownStart","Recorded ownership "+ownMax+"% exceeds the 50% control threshold");
      else if(ownMax!=null) contra.push("Recorded ownership is "+ownMax+"% \u2014 the >50% direct test is not met on the facts on record (indirect or constructive control must be confirmed)");
      else missing.push(n[1]); }
    else if(k==="own10"){ if(ownMax!=null&&ownMax>=10) fact(oe!=null&&oe>=10?"ownEnd":"ownStart","Recorded ownership "+ownMax+"% meets the 10% shareholder threshold");
      else if((o.tenPct||"")==="Yes") fact("tenPct","10% shareholder status answered \u201CYes\u201D");
      else if(ownMax!=null) contra.push("Recorded ownership is "+ownMax+"% \u2014 below the 10% threshold");
      else missing.push(n[1]); }
    else if(k==="cfc"){ if((o.cfc||"")==="Yes"){ fact("cfc","CFC status answered \u201CYes\u201D"+(o.daysCfc?" ("+o.daysCfc+" days as a CFC)":"")); }
      else if((o.cfc||"")==="No") contra.push("CFC status is recorded as \u201CNo\u201D");
      else missing.push(n[1]); }
    else if(k==="officer"){ if((o.isOfficer||"")==="Yes") fact("isOfficer","Officer/director status answered \u201CYes\u201D");
      else if((o.isOfficer||"")==="No") contra.push("Officer/director status is recorded as \u201CNo\u201D");
      else missing.push(n[1]); }
    else missing.push(n[1]);
  });
  var explicit=det["cat:"+code]&&det["cat:"+code].src||null;
  var status = contra.length ? "review" : (missing.length ? (explicit ? "explicit" : "review") : "ok");
  return {rule:rule, facts:facts, missing:missing, contra:contra, explicit:explicit, status:status};
}
function enhanceCategoryAuthority(){
  var chip=document.querySelector(".cat-row"); 
  var host=chip&&chip.closest("section.panel");
  var old=document.querySelector(".en9-authority");
  if(!host){ if(old)old.remove(); return; }
  var e=ent(); if(!e){ if(old)old.remove(); return; }
  var codes=Object.keys(e.categories||{}).filter(function(c){return e.categories[c];}).sort();
  var panel=old;
  if(!panel){ panel=el("section","panel en9-authority"); host.parentElement&&host.parentElement.insertBefore(panel,host.nextSibling); }
  while(panel.firstChild)panel.removeChild(panel.firstChild);
  var hd=el("div","en9-auth-head");
  hd.appendChild(el("strong",null,"Filing-category authority & evidence"));
  var lk=el("a","en9-auth-link","IRS Instructions for Form 5471 (12/2025)"); lk.href=EN9_IRS_URL; lk.target="_blank"; lk.rel="noopener";
  var sp=el("span","en9-auth-sub","Highest-priority source for filing-category decisions: "); sp.appendChild(lk);
  hd.appendChild(sp); panel.appendChild(hd);
  if(!codes.length){ panel.appendChild(el("p","en9-auth-empty","No filing category selected yet \u2014 select categories above and the IRS basis plus your document evidence will appear here.")); return; }
  codes.forEach(function(code){
    var ev=EN9_catEval(code,e); if(!ev)return;
    var card=el("div","en9-auth-card "+(ev.status==="ok"?"ok":ev.status==="explicit"?"exp":"rev"));
    var h=el("div","en9-auth-title");
    h.appendChild(el("strong",null,"Category "+code+" \u2014 "+ev.rule.name));
    h.appendChild(el("span","en9-auth-pill "+(ev.status==="ok"?"ok":ev.status==="explicit"?"exp":"rev"),
      ev.status==="ok"?"Supported by recorded facts":ev.status==="explicit"?"On record \u2014 confirm untracked conditions":"Marked for review"));
    card.appendChild(h);
    var s1=el("div","en9-auth-row");
    s1.appendChild(el("span","en9-auth-k","Filing site source"));
    var v1=el("span","en9-auth-v");
    var a1=el("a",null,"Instructions for Form 5471 (12/2025) \u2192 "+ev.rule.sec);
    a1.href=EN9_IRS_URL+ev.rule.anchor; a1.target="_blank"; a1.rel="noopener";
    v1.appendChild(a1); v1.appendChild(el("div","en9-auth-form","Form 5471, page 1, Item B \u2014 check box "+code));
    s1.appendChild(v1); card.appendChild(s1);
    var s2=el("div","en9-auth-row");
    s2.appendChild(el("span","en9-auth-k","Reason for selection"));
    var v2=el("span","en9-auth-v"); v2.appendChild(el("div",null,ev.rule.crit));
    ev.facts.forEach(function(f){ v2.appendChild(el("div","en9-auth-fact","\u2022 "+f.text)); });
    ev.contra.forEach(function(c){ v2.appendChild(el("div","en9-auth-contra","\u26A0 "+c)); });
    ev.missing.forEach(function(m){ v2.appendChild(el("div","en9-auth-miss","\u25CB Not established: "+m)); });
    s2.appendChild(v2); card.appendChild(s2);
    var s3=el("div","en9-auth-row");
    s3.appendChild(el("span","en9-auth-k","Input file evidence"));
    var v3=el("span","en9-auth-v"); var any=false;
    if(ev.explicit){ var t=EN9_fmtSrc(ev.explicit); if(t){ any=true;
      v3.appendChild(el("div","en9-auth-src","Category selection: "+t)); } }
    ev.facts.forEach(function(f){ if(f.src){ var t2=EN9_fmtSrc(f.src); if(t2){ any=true;
        v3.appendChild(el("div","en9-auth-src",t2)); } }
      else if(!f.manual){} else { any=true;
        v3.appendChild(el("div","en9-auth-manual",f.text.replace(/^Recorded /,"")+" \u2014 entered manually in this tool (no document source)")); } });
    if(!any) v3.appendChild(el("div","en9-auth-none","No traceable source identified \u2014 marked for review. Add the questionnaire/prior-year 5471 that establishes this, or confirm manually."));
    s3.appendChild(v3); card.appendChild(s3);
    panel.appendChild(card);
  });
}
/* ---------- Settings: authoritative sources card ---------- */
/* The Settings description string is visible on EVERY tab — gate each layer
   card to its own tab or it duplicates across all seven. */
function en9SettingsTab(host){
  var b=host.querySelector(".tab-row .tab-button.active");
  return b?(b.textContent||"").trim():"";
}

function enhanceSettingsSources(){
  var stacks=document.querySelectorAll(".view-stack");
  for(var i=0;i<stacks.length;i++){
    var st2=stacks[i];
    if((st2.textContent||"").indexOf("Every methodology, rule set, model and limit")===-1) continue;
    if(en9SettingsTab(st2)!=="Methodologies"){
      var oldS=st2.querySelector(".en9-sources"); if(oldS)oldS.remove(); return; }
    if(st2.querySelector(".en9-sources")) return;
    var card=el("section","panel en9-sources");
    card.appendChild(el("strong",null,"Authoritative sources"));
    var p=el("p","en9-auth-sub","Filing-category decisions are governed first by the IRS instructions; document evidence shows what triggered each selection.");
    card.appendChild(p);
    var d=el("div","en9-auth-src");
    var a=el("a",null,"Instructions for Form 5471 (12/2025) \u2014 irs.gov/instructions/i5471");
    a.href=EN9_IRS_URL; a.target="_blank"; a.rel="noopener";
    d.appendChild(a); d.appendChild(document.createTextNode(" \u2014 highest-priority source for filing-category decisions (Categories of Filers; Item B)."));
    card.appendChild(d);
    st2.appendChild(card);
    return;
  }
}


/* ---------- Linear-inspired command palette (Ctrl/Cmd+K) — original implementation ---------- */
var EN9K={open:false,sel:0,items:[],box:null};
function en9kBuild(){
  var items=[];
  var navs=document.querySelectorAll(".nav-item");
  for(var i=0;i<navs.length;i++){
    var n=navs[i], num=n.querySelector("span"), label=n.textContent.replace(num?num.textContent:"","").trim();
    if(label) items.push({label:label, sec:"Navigate", kbd:num?num.textContent.trim():"", el:n});
  }
  var pills=document.querySelectorAll(".entity-switch .chip-btn");
  for(var j=0;j<pills.length;j++){
    var nm=pills[j].textContent.trim();
    if(nm) items.push({label:"Switch to "+nm, sec:"Entity", kbd:"", el:pills[j]});
  }
  var lb=document.querySelector(".en9-logbtn");
  if(lb) items.push({label:"Toggle processing log", sec:"View", kbd:"", el:lb});
  var oc=document.querySelector(".en9-ocr");
  if(oc) items.push({label:"OCR a scanned PDF (PaddleOCR service \u00b7 Tesseract.js fallback)", sec:"Tools", kbd:"", run:function(){ oc.scrollIntoView({behavior:"smooth",block:"center"}); }});
  return items;
}
function en9kEnsure(){
  if(EN9K.box) return EN9K.box;
  var wrap=el("div","en9-kbar"); wrap.hidden=true;
  var card=el("div","en9-kcard");
  var inp=el("input","en9-kin"); inp.type="text"; inp.placeholder="Jump to a view, entity, or action\u2026";
  var list=el("div","en9-klist");
  var foot=el("div","en9-kfoot");
  foot.innerHTML='<span><kbd>\u2191</kbd><kbd>\u2193</kbd> navigate</span><span><kbd>\u21B5</kbd> open</span><span><kbd>esc</kbd> close</span>';
  card.appendChild(inp); card.appendChild(list); card.appendChild(foot); wrap.appendChild(card);
  document.body.appendChild(wrap);
  wrap.addEventListener("mousedown",function(ev){ if(ev.target===wrap) en9kClose(); });
  inp.addEventListener("input",function(){ EN9K.sel=0; en9kRender(); });
  inp.addEventListener("keydown",function(ev){
    var vis=en9kFiltered();
    if(ev.key==="ArrowDown"){ ev.preventDefault(); EN9K.sel=Math.min(vis.length-1,EN9K.sel+1); en9kRender(); }
    else if(ev.key==="ArrowUp"){ ev.preventDefault(); EN9K.sel=Math.max(0,EN9K.sel-1); en9kRender(); }
    else if(ev.key==="Enter"){ ev.preventDefault(); var it=vis[EN9K.sel]; if(it) en9kRun(it); }
    else if(ev.key==="Escape"){ ev.preventDefault(); en9kClose(); }
  });
  list.addEventListener("click",function(ev){
    var row=ev.target.closest(".en9-kitem"); if(!row) return;
    var it=en9kFiltered()[Number(row.getAttribute("data-i"))]; if(it) en9kRun(it);
  });
  EN9K.box={wrap:wrap,inp:inp,list:list};
  return EN9K.box;
}
function en9kFiltered(){
  var q=(EN9K.box?EN9K.box.inp.value:"").trim().toLowerCase();
  if(!q) return EN9K.items;
  return EN9K.items.filter(function(it){
    var l=it.label.toLowerCase(); if(l.indexOf(q)>=0) return true;
    var qi=0; for(var i=0;i<l.length&&qi<q.length;i++) if(l[i]===q[qi]) qi++;
    return qi===q.length;
  });
}
function en9kRender(){
  var b=en9kEnsure(), vis=en9kFiltered();
  while(b.list.firstChild)b.list.removeChild(b.list.firstChild);
  if(!vis.length){ b.list.appendChild(el("div","en9-kempty","No matches \u2014 try a shorter query.")); return; }
  vis.forEach(function(it,i){
    var row=el("div","en9-kitem"+(i===EN9K.sel?" sel":"")); row.setAttribute("data-i",String(i));
    row.appendChild(el("span","en9-kk",it.kbd||"\u2192"));
    row.appendChild(el("span",null,it.label));
    row.appendChild(el("span","en9-ksec",it.sec));
    b.list.appendChild(row);
  });
}
function en9kOpen(){
  var b=en9kEnsure();
  EN9K.items=en9kBuild(); EN9K.sel=0; EN9K.open=true;
  b.inp.value=""; b.wrap.hidden=false; en9kRender(); b.inp.focus();
}
function en9kClose(){ if(EN9K.box){ EN9K.box.wrap.hidden=true; } EN9K.open=false; }
function en9kRun(it){ en9kClose(); try{ it.run?it.run():it.el.click(); }catch(e){} }
document.addEventListener("keydown",function(ev){
  if((ev.metaKey||ev.ctrlKey)&&(ev.key==="k"||ev.key==="K")){ ev.preventDefault(); EN9K.open?en9kClose():en9kOpen(); }
},true);
function enhanceTopbarHint(){
  var tb=document.querySelector(".topbar"); if(!tb||tb.querySelector(".en9-kbd-hint"))return;
  var b=el("button","en9-kbd-hint","\u2318K"); b.type="button"; b.title="Open the command palette (Ctrl/\u2318 K)";
  b.addEventListener("click",en9kOpen); tb.appendChild(b);
}



/* ---------- OCR for scanned PDFs ----------
   PaddleOCR (the ocr-service, reached through /api/ocr/* on this origin) is
   the primary engine; the service itself cross-checks with Surya or
   Tesseract. When no service answers, the in-browser Tesseract.js path below
   is the final fallback. Either way OCR runs at UPLOAD, before Process
   Entity: every PDF is probed for pages without a text layer, those pages
   are recognised, and the scanned file is replaced in intake by a searchable
   copy carrying a sidecar (engine, confidence, boxes, disputes) that the
   store turns into review items and Provenance rows. Processing waits on
   the gate below until the copy is in place. */
var EN9OCR={busy:false, result:null, io:null, stats:{runs:0,pages:0,words:0,fails:0}, jobs:{}, service:null};
/*EN9OCREXP*/try{window.EN9OCR=EN9OCR;window.en9OcrRun=function(){return en9OcrRun.apply(null,arguments)};}catch(EN9e){}

/* The gate the store's processEntity awaits: one promise per file being
   OCR'd, grouped by entity. `wait` resolves when every job for the entity has
   finished — or rejects with the first failure, so a run never starts on
   bytes OCR could not fix. */
var EN9OCRGATE=(function(){
  var open={};                                   /* entityId -> { fileId: {p, res, rej} } */
  function mark(eid,fid){ var e=open[eid]||(open[eid]={}); if(e[fid]) return e[fid].p;
    var h={}; h.p=new Promise(function(res,rej){ h.res=res; h.rej=rej; }); h.p.catch(function(){}); e[fid]=h; return h.p; }
  function done(eid,fid,err){ var e=open[eid]; if(!e||!e[fid]) return; var h=e[fid]; delete e[fid];
    if(!Object.keys(e).length) delete open[eid]; err?h.rej(err):h.res(); }
  function pending(eid){ var e=open[eid]; return !!(e&&Object.keys(e).length); }
  function wait(eid){ var e=open[eid]; if(!e) return Promise.resolve();
    return Promise.all(Object.keys(e).map(function(k){return e[k].p;})); }
  function list(eid){ var e=open[eid]||{}; return Object.keys(e); }
  return {mark:mark, done:done, pending:pending, wait:wait, list:list};
})();
try{ globalThis.EN9OCRGATE=EN9OCRGATE; }catch(e){}

function en9IsSandbox(){ try{ return /claudeusercontent\.com|claude\.ai/.test(location.hostname); }catch(e){ return false; } }
function en9OcrFriendly(e){ var m=String(e&&e.message||e||"");
  if(/Failed to construct 'Worker'|blob-request|cannot be accessed from origin|Worker is not defined/i.test(m))
    return "This preview sandbox blocks background workers, so the in-browser OCR engine cannot start here. It runs normally on your deployed site or when the file is opened directly in a browser.";
  if(/Could not download/i.test(m))
    return m+" — check your network or ad-blocker; the in-browser engine loads its runtime from cdn.jsdelivr.net and its models from github.com on first use.";
  return m; }
try{ window.__EN9OCR=EN9OCR; window.__en9OcrRun=function(){ return en9OcrRun.apply(null,arguments); }; }catch(e){}

/* ---- assets built into this file ----
   The offline build (npm run build:standalone) packs the OCR runtime, the
   PDF writer and the PP-OCRv5 weights into the page as gzipped base64, so a
   downloaded index.html reads scans with no network at all. Without that
   block every accessor reports "not here" and the code downloads as before. */
var EN9OCRASSET={
  has:function(name){ try{ var A=window.EN9OCRASSETS; return !!(A&&A.files&&A.files[name]); }catch(e){ return false; } },
  /* Model weights are float32, whose four bytes compress far better apart
     than interleaved, so the build stores them byte-plane by byte-plane.
     This puts the bytes back in their original order. */
  weave:function(a,s){ var n=a.length, m=Math.floor(n/s), body=m*s, out=new Uint8Array(n), pos=0, k, i;
    for(k=0;k<s;k++){ for(i=0;i<m;i++) out[i*s+k]=a[pos+i]; pos+=m; }
    for(i=body;i<n;i++) out[i]=a[i];
    return out; },
  raw:function(name){ var A=window.EN9OCRASSETS, b64=A.files[name], bin=atob(b64), arr=new Uint8Array(bin.length), self=this;
    for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    var s=(A.tr&&A.tr[name])||0;
    if(!A.gz) return Promise.resolve(s?self.weave(arr,s):arr);
    if(typeof DecompressionStream==="undefined") return Promise.reject(new Error("this browser cannot unpack the built-in OCR engine (no DecompressionStream)"));
    return new Response(new Blob([arr]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
      .then(function(b){ var u=new Uint8Array(b); return s?self.weave(u,s):u; }); },
  bytes:function(name){ return this.raw(name).then(function(a){ return a.buffer; }); },
  text:function(name){ return this.raw(name).then(function(a){ return new TextDecoder("utf-8").decode(a); }); },
  /* data: URLs import and execute from a file:// page; blob: URLs do not */
  dataUrl:function(name,type){ return this.raw(name).then(function(a){ var s="", C=0x8000;
    for(var i=0;i<a.length;i+=C) s+=String.fromCharCode.apply(null,a.subarray(i,i+C));
    return "data:"+(type||"application/octet-stream")+";base64,"+btoa(s); }); }
};
try{ window.EN9OCRASSET=EN9OCRASSET; }catch(e){}

/* A script from the page's own assets when it carries one, else from the CDN. */
function en9RunScript(src,inline){ return new Promise(function(res,rej){
  var sc=document.createElement("script");
  if(inline!=null){ sc.textContent=inline; document.head.appendChild(sc); res(); return; }
  sc.src=src; sc.async=true;
  sc.onload=function(){res()}; sc.onerror=function(){rej(new Error("Could not download "+src))};
  document.head.appendChild(sc); }); }
function en9LoadScript(u,asset){
  if(asset&&EN9OCRASSET.has(asset)) return EN9OCRASSET.text(asset).then(function(js){ return en9RunScript(null,js); });
  return en9RunScript(u,null); }

/* ---- the OCR service (PaddleOCR primary) ---- */
EN9OCR.service={
  /* Where the service may be. The page is often opened straight from disk
     or from a static host, where a same-origin /api/ocr cannot exist; the
     service itself listens on 8472 and answers cross-origin, so a local
     instance is tried directly. A URL the user typed (kept in localStorage)
     is always tried first. */
  DEFAULT_PORT:8472,
  userUrl:function(){ try{ var u=localStorage.getItem("en9OcrUrl"); return u?u.replace(/\/+$/,""):""; }catch(e){ return ""; } },
  setUserUrl:function(u){ u=String(u||"").trim().replace(/\/+$/,""); if(/^(off|none|browser)$/i.test(u)) u="off"; else if(u&&!/^https?:\/\//i.test(u)) u="http://"+u;
    try{ if(u) localStorage.setItem("en9OcrUrl",u); else localStorage.removeItem("en9OcrUrl"); }catch(e){}
    this._base=null; this._health=null; this._healthAt=0; return u; },
  /* "off" typed as the address: never look for a service, read in this browser */
  off:function(){ return /^(off|none|browser)$/i.test(this.userUrl()); },
  candidates:function(){ var out=[], u=this.userUrl(); if(this.off()) return out; if(u) out.push(u);
    var proto="", host=""; try{ proto=location.protocol; host=location.hostname; }catch(e){}
    if(proto==="http:"||proto==="https:") out.push("/api/ocr");
    var lp="http://127.0.0.1:"+this.DEFAULT_PORT, ll="http://localhost:"+this.DEFAULT_PORT;
    /* a page served from localhost:NNNN reaches its own machine's service either way */
    if(out.indexOf(lp)<0) out.push(lp); if(out.indexOf(ll)<0) out.push(ll);
    /* the page's own host on the service port: the app and the service on one LAN box */
    if(host&&host!=="localhost"&&host!=="127.0.0.1"&&proto!=="file:"){ var hp=proto+"//"+host+":"+this.DEFAULT_PORT; if(out.indexOf(hp)<0) out.push(hp); }
    return out; },
  /* the address that last answered; /api/ocr until something is known */
  _base:null,
  base:function(){ return this._base||(this.off()?"":this.userUrl())||"/api/ocr"; },
  _health:null, _healthAt:0,
  _probe:function(base){ var ctl=typeof AbortController!=="undefined"?new AbortController():null;
    if(ctl) setTimeout(function(){try{ctl.abort()}catch(e){}},4000);
    /* fetch may be missing or throw synchronously (a test DOM, a file:// page);
       that is "not reachable", never an exception out of the intake watcher */
    return Promise.resolve().then(function(){ return fetch(base+"/health",{signal:ctl&&ctl.signal,cache:"no-store",mode:"cors"}); })
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ j.reachable=r.ok&&j.reachable!==false; return j; }); })
      .catch(function(e){ return {reachable:false, ok:false, error:String(e&&e.message||e)}; })
      .then(function(j){ j.available=!!(j.reachable&&j.ok&&j.primary); j.base=base; return j; }); },
  /* Cached for a minute: the intake watcher asks on every state change.
     Each candidate is asked in turn; the first that answers with an engine
     wins and is remembered for the posts. */
  health:function(force){ var self=this, now=Date.now();
    if(!force&&self._health&&now-self._healthAt<60000) return Promise.resolve(self._health);
    var list=self.candidates(), tried=[];
    function next(i){ if(i>=list.length){
        var h={reachable:false, ok:false, available:false, tried:tried.slice(),
          error:tried.length?tried.map(function(t){ return t.base+": "+t.error; }).join("; "):"no address to try"};
        self._base=null; self._health=h; self._healthAt=Date.now(); return h; }
      return self._probe(list[i]).then(function(j){
        if(j.available){ self._base=j.base; j.tried=tried.slice(); self._health=j; self._healthAt=Date.now(); return j; }
        tried.push({base:j.base, error:j.reachable?(j.error||"no engine loaded"):(j.error||"no answer")});
        return next(i+1); }); }
    return next(0); },
  describe:function(){ var h=this._health; if(!h||!h.available) return null;
    var eng=h.engines||{}, p=eng[h.primary]||{}; var chain=(h.chain||[]).map(function(n){ return n+(eng[n]&&eng[n].backend?" ("+eng[n].backend+")":""); });
    return {primary:h.primary, backend:p.backend||"", chain:h.chain||[], base:h.base||this.base(), text:chain.join(" → ")}; },
  /* One line for the cards: never an error, always what to do next. */
  statusText:function(){ var h=this._health, d=this.describe();
    if(!h) return "Checking for the OCR service…";
    if(d) return "OCR service online at "+(d.base==="/api/ocr"?"this server":d.base)+" — "+d.text+". Figures are cross-checked by the second engine; disagreements are flagged, never auto-corrected.";
    var inBrowser=EN9OCRASSET.has("rec.onnx")
      ? "PaddleOCR (PP-OCRv5) runs in this browser, and the engine and its models are built into this file — no download, no internet, nothing to install. The document never leaves this browser."
      : "PaddleOCR (PP-OCRv5) runs in this browser: ONNX Runtime and the models (about 36 MB) download once from cdn.jsdelivr.net and github.com and are kept in this browser; the document itself never leaves it."
      +(EN9OCR.browserEngine==="tesseract.js"?" (PaddleOCR could not be loaded here — "+(EN9OCR.browserReason||"")+" — so Tesseract.js is reading instead.)":"");
    if(this.off()) return "OCR service turned off (address = off). "+inBrowser+" Clear the address and press Check to look for a service again.";
    var where=(h.tried||[]).map(function(t){ return t.base==="/api/ocr"?"this server":t.base; }).join(", ")||this.base();
    return "No OCR service found (looked at "+where+"). "+inBrowser+" A service reads faster and cross-checks every figure: start it with python -m ocr_service (in ocr-service/) on this computer, or enter its address below and press Check."; },
  post:function(path,blob,params,st){ var q=Object.keys(params||{}).filter(function(k){return params[k]!==undefined&&params[k]!==null&&params[k]!=="";})
      .map(function(k){return encodeURIComponent(k)+"="+encodeURIComponent(params[k]);}).join("&");
    var self=this;
    return Promise.resolve().then(function(){ return fetch(self.base()+path+(q?"?"+q:""),{method:"POST",mode:"cors",headers:{"content-type":blob.type||"application/pdf"},body:blob}); })
      .then(function(r){ return r.text().then(function(t){ var j={}; try{ j=JSON.parse(t); }catch(e){ j={error:t.slice(0,200)}; }
        if(!r.ok) throw new Error(j.error||j.detail&&(j.detail.error||JSON.stringify(j.detail))||("OCR service answered "+r.status)); return j; }); }); },
  detect:function(blob){ return this.post("/detect",blob,{},null); },
  ocr:function(blob,opts,st){ st&&st("Sending "+(opts.name||"the document")+" to the OCR service…");
    return this.post("/ocr",blob,{pages:opts.pages||"auto",langs:opts.langs||"eng",force:opts.force?"1":"",filename:opts.name||"",verify:"1",structure:"1",pdf:"1"},st); }
};

/* ---- in-browser PaddleOCR: PP-OCRv5 through ONNX Runtime Web ----
   The same PP-OCRv5 mobile models the Python service runs through ONNX
   (the `onnxocr` wheel's det/rec/cls weights, fetched from the project's
   GitHub LFS at a pinned commit and kept in IndexedDB), executed here by
   onnxruntime-web (WebAssembly, one thread, no cross-origin isolation
   needed). Detection is DB with the reference post-processing (threshold,
   connected regions, minimum-area rectangle, unclip, box score), recognition
   is CTC over the PP-OCRv5 dictionary, orientation of each line by the cls
   model. Nothing leaves the browser: the runtime and the weights are
   downloaded once, the document never is. Tesseract.js remains the last
   resort when the runtime or the models cannot be fetched. */
var EN9PPOCR={
  ORT_VERSION:"1.29.0",
  MODEL_COMMIT:"23b9798c261ea0a23ccf6823f1bf692e4bd4e98c",
  MODEL_SHA:{det:"4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae", rec:"5825fc7ebf84ae7a412be049820b4d86d77620f204a041697b0494669b1742c5", cls:"f4bb53707100c5f3d59ba834eb05bb400369f20aed35d4b26807b1bfadd2a70e"},
  params:{detSide:960, detThresh:0.3, boxThresh:0.6, unclip:1.5, minSize:3, recH:48, recW:320, recBatch:6, clsH:48, clsW:192, clsThresh:0.9, dropScore:0.5},
  backend:"PP-OCRv5 via ONNX Runtime Web (in this browser)",
  _ready:null, sessions:null, dict:null, error:null, status:null,
  urls:function(){ var ort="https://cdn.jsdelivr.net/npm/onnxruntime-web@"+this.ORT_VERSION+"/dist/";
    var models=""; try{ models=localStorage.getItem("en9OcrModelsUrl")||""; }catch(e){}
    models=(models||"https://media.githubusercontent.com/media/jingsongliujing/OnnxOCR/"+this.MODEL_COMMIT+"/onnxocr/models/ppocrv5").replace(/\/+$/,"")+"/";
    return {ortScript:ort+"ort.wasm.min.js", wasmPaths:ort, det:models+"det/det.onnx", rec:models+"rec/rec.onnx", cls:models+"cls/cls.onnx", dict:models+"ppocrv5_dict.txt"}; },
  say:function(m){ try{ if(this.status) this.status(m); }catch(e){} },
  /* ---- model store: IndexedDB, keyed by URL; silently absent where IndexedDB is ---- */
  _db:function(){ return new Promise(function(res,rej){ try{ var r=indexedDB.open("en9-ocr-models",1);
      r.onupgradeneeded=function(){ r.result.createObjectStore("files"); }; r.onsuccess=function(){ res(r.result); }; r.onerror=function(){ rej(r.error); }; r.onblocked=function(){ rej(new Error("blocked")); }; }catch(e){ rej(e); } }); },
  _dbGet:function(key){ return this._db().then(function(db){ return new Promise(function(res,rej){ var tx=db.transaction("files","readonly"), q=tx.objectStore("files").get(key);
      q.onsuccess=function(){ res(q.result||null); }; q.onerror=function(){ rej(q.error); }; }).then(function(v){ db.close(); return v; },function(e){ db.close(); throw e; }); }).catch(function(){ return null; }); },
  _dbPut:function(key,val){ return this._db().then(function(db){ return new Promise(function(res,rej){ var tx=db.transaction("files","readwrite"); tx.objectStore("files").put(val,key);
      tx.oncomplete=function(){ res(true); }; tx.onerror=function(){ rej(tx.error); }; }).then(function(v){ db.close(); return v; },function(e){ db.close(); throw e; }); }).catch(function(){ return false; }); },
  /* Built into this file → no network, no store. Otherwise: this browser's
     store, otherwise the download (once). */
  fetchFile:async function(url,label,asset){ var self=this;
    if(asset&&EN9OCRASSET.has(asset)){ self.say("Unpacking "+label+" (built into this file)…"); return await EN9OCRASSET.bytes(asset); }
    var hit=await self._dbGet(url); if(hit&&hit.byteLength){ self.say(label+": from this browser's store ("+(hit.byteLength/1048576).toFixed(1)+" MB)."); return hit; }
    self.say("Downloading "+label+"…");
    var r=await fetch(url,{mode:"cors"}); if(!r||!r.ok) throw new Error("Could not download "+url+(r?" ("+r.status+")":""));
    var buf;
    if(r.body&&r.body.getReader){ var total=+(r.headers.get("content-length")||0), reader=r.body.getReader(), chunks=[], got=0, lastSaid=0;
      for(;;){ var c=await reader.read(); if(c.done) break; chunks.push(c.value); got+=c.value.byteLength;
        if(got-lastSaid>524288){ lastSaid=got; self.say("Downloading "+label+"… "+(got/1048576).toFixed(1)+(total?" of "+(total/1048576).toFixed(1):"")+" MB"); } }
      buf=new Uint8Array(got); var off=0; chunks.forEach(function(ch){ buf.set(ch,off); off+=ch.byteLength; }); buf=buf.buffer; }
    else buf=await r.arrayBuffer();
    await self._dbPut(url,buf); return buf; },
  /* ---- load runtime + models once ---- */
  load:function(st){ var self=this; if(st) self.status=st; if(self._ready) return self._ready;
    self._ready=(async function(){ var u=self.urls();
      if(!window.ort){ self.say(EN9OCRASSET.has("ort.js")?"Starting the built-in OCR engine…":"Downloading ONNX Runtime (open source)…");
        await en9LoadScript(u.ortScript,"ort.js"); }
      var ort=window.ort; if(!ort||!ort.InferenceSession) throw new Error("ONNX Runtime did not load");
      if(EN9OCRASSET.has("ort.wasm")){
        /* the runtime's own two files, handed over without a fetch: the
           binary as bytes, the loader as a data: URL because a file:// page
           may import data: but not blob: */
        ort.env.wasm.wasmBinary=await EN9OCRASSET.bytes("ort.wasm");
        ort.env.wasm.wasmPaths={mjs:await EN9OCRASSET.dataUrl("ort.mjs","text/javascript")};
      } else ort.env.wasm.wasmPaths=u.wasmPaths;
      ort.env.wasm.numThreads=1; ort.env.wasm.proxy=false; try{ ort.env.logLevel="error"; }catch(e){}
      var det=await self.fetchFile(u.det,"the PP-OCRv5 detection model","det.onnx");
      var rec=await self.fetchFile(u.rec,"the PP-OCRv5 recognition model","rec.onnx");
      var cls=await self.fetchFile(u.cls,"the PP-OCRv5 orientation model","cls.onnx");
      var dictBuf=await self.fetchFile(u.dict,"the PP-OCRv5 dictionary","dict.txt");
      var lines=new TextDecoder("utf-8").decode(dictBuf).split(/\r?\n/); if(lines.length&&lines[lines.length-1]==="") lines.pop();
      self.dict=["blank"].concat(lines,[" "]);
      self.say("Starting the OCR engine…");
      var opt={executionProviders:["wasm"], graphOptimizationLevel:"all"};
      self.sessions={det:await ort.InferenceSession.create(new Uint8Array(det),opt), rec:await ort.InferenceSession.create(new Uint8Array(rec),opt), cls:await ort.InferenceSession.create(new Uint8Array(cls),opt)};
      self.error=null; return true; })();
    self._ready.catch(function(e){ self.error=String(e&&e.message||e); self._ready=null; });
    return self._ready; },
  /* ---- geometry: the DB post-processing without OpenCV ---- */
  hull:function(pts){ pts=pts.slice().sort(function(a,b){ return a[0]-b[0]||a[1]-b[1]; }); if(pts.length<3) return pts;
    function cross(o,a,b){ return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]); }
    var lo=[], up=[], i;
    for(i=0;i<pts.length;i++){ while(lo.length>=2&&cross(lo[lo.length-2],lo[lo.length-1],pts[i])<=0) lo.pop(); lo.push(pts[i]); }
    for(i=pts.length-1;i>=0;i--){ while(up.length>=2&&cross(up[up.length-2],up[up.length-1],pts[i])<=0) up.pop(); up.push(pts[i]); }
    lo.pop(); up.pop(); return lo.concat(up); },
  /* minimum-area rectangle of a point set: {cx,cy,w,h,angle} (angle in radians of the w axis) */
  minAreaRect:function(pts){ var h=this.hull(pts); if(h.length===1) return {cx:h[0][0],cy:h[0][1],w:0,h:0,angle:0};
    if(h.length===2){ var dx=h[1][0]-h[0][0], dy=h[1][1]-h[0][1]; return {cx:(h[0][0]+h[1][0])/2,cy:(h[0][1]+h[1][1])/2,w:Math.hypot(dx,dy),h:0,angle:Math.atan2(dy,dx)}; }
    var best=null;
    for(var i=0;i<h.length;i++){ var a=h[i], b=h[(i+1)%h.length], ex=b[0]-a[0], ey=b[1]-a[1], len=Math.hypot(ex,ey); if(!len) continue; ex/=len; ey/=len;
      var minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
      for(var j=0;j<h.length;j++){ var u=h[j][0]*ex+h[j][1]*ey, v=-h[j][0]*ey+h[j][1]*ex; if(u<minU)minU=u; if(u>maxU)maxU=u; if(v<minV)minV=v; if(v>maxV)maxV=v; }
      var area=(maxU-minU)*(maxV-minV);
      if(!best||area<best.area){ var cu=(minU+maxU)/2, cv=(minV+maxV)/2; best={area:area,w:maxU-minU,h:maxV-minV,angle:Math.atan2(ey,ex),cx:cu*ex-cv*ey,cy:cu*ey+cv*ex}; } }
    return best; },
  /* the four corners, ordered like PaddleOCR's get_mini_boxes: sorted by x, then top/bottom within each pair */
  rectPoints:function(r,grow){ grow=grow||0; var hw=r.w/2+grow, hh=r.h/2+grow, c=Math.cos(r.angle), s=Math.sin(r.angle);
    var p=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(function(q){ return [r.cx+q[0]*c-q[1]*s, r.cy+q[0]*s+q[1]*c]; });
    p.sort(function(a,b){ return a[0]-b[0]; });
    var i1=p[1][1]>p[0][1]?0:1, i4=p[1][1]>p[0][1]?1:0, i2=p[3][1]>p[2][1]?2:3, i3=p[3][1]>p[2][1]?3:2;
    return [p[i1],p[i2],p[i3],p[i4]]; },
  /* mean probability inside a quadrilateral (box_score_fast) */
  boxScore:function(prob,W,H,quad){ var xs=quad.map(function(p){return p[0];}), ys=quad.map(function(p){return p[1];});
    var xmin=Math.max(0,Math.floor(Math.min.apply(null,xs))), xmax=Math.min(W-1,Math.ceil(Math.max.apply(null,xs))), ymin=Math.max(0,Math.floor(Math.min.apply(null,ys))), ymax=Math.min(H-1,Math.ceil(Math.max.apply(null,ys)));
    var sum=0, n=0;
    for(var y=ymin;y<=ymax;y++) for(var x=xmin;x<=xmax;x++){ var inside=false;
      for(var i=0,j=3;i<4;j=i++){ var xi=quad[i][0],yi=quad[i][1],xj=quad[j][0],yj=quad[j][1];
        if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi)) inside=!inside; }
      if(inside){ sum+=prob[y*W+x]; n++; } }
    return n?sum/n:0; },
  /* boxes from the probability map: [[x,y]×4] in map pixels, with scores */
  boxesFromMap:function(prob,W,H){ var P=this.params, self=this, mask=new Uint8Array(W*H), i;
    for(i=0;i<W*H;i++) mask[i]=prob[i]>P.detThresh?1:0;
    var labels=new Int32Array(W*H), stack=new Int32Array(W*H), out=[], comp=0;
    for(var start=0;start<W*H;start++){ if(!mask[start]||labels[start]) continue; comp++;
      var sp=0, pts=[]; stack[sp++]=start; labels[start]=comp;
      while(sp){ var idx=stack[--sp], x=idx%W, y=(idx-x)/W; pts.push([x,y]);
        for(var dy=-1;dy<=1;dy++){ var yy=y+dy; if(yy<0||yy>=H) continue; for(var dx=-1;dx<=1;dx++){ var xx=x+dx; if(xx<0||xx>=W) continue; var k=yy*W+xx; if(mask[k]&&!labels[k]){ labels[k]=comp; stack[sp++]=k; } } } }
      if(out.length>=1000) continue;
      var r=self.minAreaRect(pts); if(Math.min(r.w,r.h)<P.minSize) continue;
      var quad=self.rectPoints(r,0), score=self.boxScore(prob,W,H,quad); if(score<P.boxThresh) continue;
      /* unclip: offset the rectangle by area·ratio/perimeter — for a rectangle
         the rounded offset's minimum-area rectangle is the rectangle grown by
         that distance on every side */
      var per=2*(r.w+r.h), d=per?r.w*r.h*P.unclip/per:0;
      if(Math.min(r.w,r.h)+2*d<P.minSize+2) continue;
      out.push({quad:self.rectPoints(r,d), score:score}); }
    return out; },
  /* order clockwise from top-left, clip to the image, drop slivers, sort top-to-bottom then left-to-right */
  tidyBoxes:function(boxes,W,H){ var out=[];
    boxes.forEach(function(b){ var pts=b.quad.map(function(p){ return [Math.min(Math.max(Math.round(p[0]),0),W-1), Math.min(Math.max(Math.round(p[1]),0),H-1)]; });
      var s=pts.map(function(p){return p[0]+p[1];}), df=pts.map(function(p){return p[1]-p[0];});
      var iMin=s.indexOf(Math.min.apply(null,s)), iMax=s.indexOf(Math.max.apply(null,s)); var rest=pts.filter(function(_,i){return i!==iMin&&i!==iMax;});
      var d0=rest[0][1]-rest[0][0], d1=rest[1][1]-rest[1][0]; var tr=d0<d1?rest[0]:rest[1], bl=d0<d1?rest[1]:rest[0];
      var q=[pts[iMin],tr,pts[iMax],bl]; var w=Math.hypot(q[0][0]-q[1][0],q[0][1]-q[1][1]), h=Math.hypot(q[0][0]-q[3][0],q[0][1]-q[3][1]);
      if(w<=3||h<=3) return; out.push({quad:q,score:b.score}); });
    out.sort(function(a,b){ return a.quad[0][1]-b.quad[0][1]||a.quad[0][0]-b.quad[0][0]; });
    for(var i=0;i<out.length-1;i++) for(var j=i;j>=0;j--){ if(Math.abs(out[j+1].quad[0][1]-out[j].quad[0][1])<10&&out[j+1].quad[0][0]<out[j].quad[0][0]){ var t=out[j]; out[j]=out[j+1]; out[j+1]=t; } else break; }
    return out; },
  /* ---- image plumbing ---- */
  canvas:function(w,h){ var c=document.createElement("canvas"); c.width=Math.max(1,Math.round(w)); c.height=Math.max(1,Math.round(h)); return c; },
  /* the text line straightened out of the page (get_rotate_crop_image): an affine map of the quad onto w×h, turned upright when tall */
  crop:function(src,q){ var w=Math.round(Math.max(Math.hypot(q[0][0]-q[1][0],q[0][1]-q[1][1]),Math.hypot(q[2][0]-q[3][0],q[2][1]-q[3][1])));
    var h=Math.round(Math.max(Math.hypot(q[0][0]-q[3][0],q[0][1]-q[3][1]),Math.hypot(q[1][0]-q[2][0],q[1][1]-q[2][1]))); if(w<1||h<1) return null;
    var ux=q[1][0]-q[0][0], uy=q[1][1]-q[0][1], vx=q[3][0]-q[0][0], vy=q[3][1]-q[0][1], det=ux*vy-uy*vx; if(!det) return null;
    /* M maps source→crop: M·u=(w,0), M·v=(0,h) */
    var a=w*vy/det, c=-w*vx/det, b=-h*uy/det, d=h*ux/det, e=-(a*q[0][0]+c*q[0][1]), f=-(b*q[0][0]+d*q[0][1]);
    var cv=this.canvas(w,h), ctx=cv.getContext("2d"); ctx.imageSmoothingEnabled=true; try{ ctx.imageSmoothingQuality="high"; }catch(x){}
    ctx.setTransform(a,b,c,d,e,f); ctx.drawImage(src,0,0); ctx.setTransform(1,0,0,1,0,0);
    if(h/w>=1.5){ var r=this.canvas(h,w), rc=r.getContext("2d"); rc.translate(0,w); rc.rotate(-Math.PI/2); rc.drawImage(cv,0,0); return r; }
    return cv; },
  rotate180:function(cv){ var r=this.canvas(cv.width,cv.height), rc=r.getContext("2d"); rc.translate(cv.width,cv.height); rc.rotate(Math.PI); rc.drawImage(cv,0,0); return r; },
  /* a crop resized to height H and at most W wide, normalised ((x/255-0.5)/0.5, BGR) into `dst` at batch slot `slot`; returns the width used */
  putNormalised:function(cv,H,W,dst,slot){ var ratio=cv.width/cv.height, rw=Math.min(W,Math.ceil(H*ratio)); var tmp=this.canvas(rw,H), tc=tmp.getContext("2d"); tc.imageSmoothingEnabled=true; tc.drawImage(cv,0,0,rw,H);
    var d=tc.getImageData(0,0,rw,H).data, base=slot*3*H*W, plane=H*W;
    for(var y=0;y<H;y++) for(var x=0;x<rw;x++){ var i=(y*rw+x)*4, o=base+y*W+x; dst[o]=d[i+2]/127.5-1; dst[o+plane]=d[i+1]/127.5-1; dst[o+2*plane]=d[i]/127.5-1; }
    return rw; },
  /* ---- the three models ---- */
  detect:async function(src){ var P=this.params, ort=window.ort, W0=src.width, H0=src.height;
    var ratio=Math.max(W0,H0)>P.detSide?P.detSide/Math.max(W0,H0):1;
    var rw=Math.max(32,Math.round(W0*ratio/32)*32), rh=Math.max(32,Math.round(H0*ratio/32)*32);
    var cv=this.canvas(rw,rh), ctx=cv.getContext("2d"); ctx.imageSmoothingEnabled=true; try{ ctx.imageSmoothingQuality="high"; }catch(x){} ctx.drawImage(src,0,0,rw,rh);
    var d=ctx.getImageData(0,0,rw,rh).data, n=rw*rh, t=new Float32Array(3*n);
    /* NormalizeImage mean/std as PaddleOCR applies them to a BGR array */
    for(var i=0;i<n;i++){ var j=i*4; t[i]=(d[j+2]/255-0.485)/0.229; t[i+n]=(d[j+1]/255-0.456)/0.224; t[i+2*n]=(d[j]/255-0.406)/0.225; }
    var out=await this.sessions.det.run({x:new ort.Tensor("float32",t,[1,3,rh,rw])});
    var prob=out[Object.keys(out)[0]].data;
    var boxes=this.boxesFromMap(prob,rw,rh).map(function(b){ return {quad:b.quad.map(function(p){ return [p[0]/rw*W0, p[1]/rh*H0]; }), score:b.score}; });
    return this.tidyBoxes(boxes,W0,H0); },
  classify:async function(crops){ var P=this.params, ort=window.ort, out=new Array(crops.length), self=this;
    for(var s=0;s<crops.length;s+=P.recBatch){ var batch=crops.slice(s,s+P.recBatch), t=new Float32Array(batch.length*3*P.clsH*P.clsW);
      batch.forEach(function(cv,k){ self.putNormalised(cv,P.clsH,P.clsW,t,k); });
      var r=await self.sessions.cls.run({x:new ort.Tensor("float32",t,[batch.length,3,P.clsH,P.clsW])}); var p=r[Object.keys(r)[0]].data;
      for(var k=0;k<batch.length;k++){ var p0=p[k*2], p1=p[k*2+1]; out[s+k]=(p1>p0&&p1>=P.clsThresh)?180:0; } }
    return out; },
  recognise:async function(crops){ var P=this.params, ort=window.ort, self=this, res=new Array(crops.length);
    var order=crops.map(function(c,i){ return i; }).sort(function(a,b){ return crops[a].width/crops[a].height-crops[b].width/crops[b].height; });
    for(var s=0;s<order.length;s+=P.recBatch){ var idx=order.slice(s,s+P.recBatch), maxRatio=P.recW/P.recH;
      idx.forEach(function(i){ maxRatio=Math.max(maxRatio,crops[i].width/crops[i].height); });
      var W=Math.floor(P.recH*maxRatio), t=new Float32Array(idx.length*3*P.recH*W);
      idx.forEach(function(i,k){ self.putNormalised(crops[i],P.recH,W,t,k); });
      var r=await self.sessions.rec.run({x:new ort.Tensor("float32",t,[idx.length,3,P.recH,W])}); var o=r[Object.keys(r)[0]], data=o.data, T=o.dims[1], C=o.dims[2];
      for(var k=0;k<idx.length;k++){ var text="", confs=[], prev=-1;
        for(var ti=0;ti<T;ti++){ var base=(k*T+ti)*C, bi=0, bv=data[base];
          for(var ci=1;ci<C;ci++){ var v=data[base+ci]; if(v>bv){ bv=v; bi=ci; } }
          if(bi!==0&&bi!==prev){ text+=self.dict[bi]||""; confs.push(bv); } prev=bi; }
        res[idx[k]]={text:text, conf:confs.length?confs.reduce(function(a,b){return a+b;},0)/confs.length:0}; }
      await new Promise(function(r2){ setTimeout(r2,0); }); }
    return res; },
  /* the page turned by `deg` (clockwise, canvas convention) about its centre; ±90 swaps the sides, small angles keep them */
  rotateCanvas:function(src,deg){ var quarter=Math.abs(Math.abs(deg)-90)<1e-6, out=this.canvas(quarter?src.height:src.width,quarter?src.width:src.height), ctx=out.getContext("2d");
    ctx.fillStyle="#fff"; ctx.fillRect(0,0,out.width,out.height); ctx.imageSmoothingEnabled=true; try{ ctx.imageSmoothingQuality="high"; }catch(x){}
    ctx.translate(out.width/2,out.height/2); ctx.rotate(deg*Math.PI/180); ctx.drawImage(src,-src.width/2,-src.height/2); return out; },
  /* ---- one page: canvas in → words in canvas pixels (Tesseract.js shape) ----
     A turned page (most lines tall) is put upright and a skewed one (the
     median line angle ≥ 0.5°) straightened before the lines are read, the
     way the service does, so captions and their amounts share a baseline;
     `page` then carries the corrected image for the searchable copy. */
  page:async function(src){ var P=this.params, self=this, work=src, fix={};
    await self.load();
    self.say("Detecting text lines…");
    var boxes=await self.detect(work); if(!boxes.length) return {words:[], lines:[], page:null};
    function tall(b){ var q=b.quad; return Math.hypot(q[0][0]-q[3][0],q[0][1]-q[3][1])>=1.5*Math.hypot(q[0][0]-q[1][0],q[0][1]-q[1][1]); }
    if(boxes.length>=3&&boxes.filter(tall).length>=0.6*boxes.length){
      /* tall lines: the page is on its side. The crops come out turned
         anticlockwise; the orientation model says whether that reads right
         (page turned anticlockwise, so turn it clockwise) or upside down. */
      var sample=boxes.filter(tall).slice(0,12).map(function(b){ return self.crop(work,b.quad); }).filter(Boolean);
      var votes=await self.classify(sample), n180=votes.filter(function(a){return a===180;}).length;
      fix.orientation=n180>votes.length/2?-90:90; self.say("Turning the page upright…");
      work=self.rotateCanvas(work,fix.orientation); boxes=await self.detect(work); }
    var angs=boxes.filter(function(b){ var q=b.quad; return Math.hypot(q[0][0]-q[1][0],q[0][1]-q[1][1])>=3*Math.hypot(q[0][0]-q[3][0],q[0][1]-q[3][1]); })
      .map(function(b){ var q=b.quad; return Math.atan2(q[1][1]-q[0][1],q[1][0]-q[0][0])*180/Math.PI; }).sort(function(a,b){return a-b;});
    if(angs.length>=3){ var med=angs[Math.floor(angs.length/2)];
      if(Math.abs(med)>=0.5&&Math.abs(med)<=15){ fix.deskew=+med.toFixed(2); self.say("Straightening the page ("+fix.deskew+"°)…");
        work=self.rotateCanvas(work,-med); boxes=await self.detect(work); } }
    var crops=[], kept=[];
    boxes.forEach(function(b){ var c=self.crop(work,b.quad); if(c){ crops.push(c); kept.push(b); } });
    self.say("Checking the orientation of "+crops.length+" line(s)…");
    var angles=await self.classify(crops);
    if(crops.length>=3&&angles.filter(function(a){return a===180;}).length>crops.length/2){
      /* the whole page is upside down: turn it, not every line */
      fix.orientation=((fix.orientation||0)+180)%360; self.say("Turning the page the right way up…");
      work=self.rotateCanvas(work,180); boxes=await self.detect(work); crops=[]; kept=[];
      boxes.forEach(function(b){ var c=self.crop(work,b.quad); if(c){ crops.push(c); kept.push(b); } });
      angles=await self.classify(crops); }
    crops=crops.map(function(c,i){ return angles[i]===180?self.rotate180(c):c; });
    self.say("Reading "+crops.length+" line(s)…");
    var read=await self.recognise(crops), words=[], lines=[];
    read.forEach(function(r,i){ if(!r||!r.text||r.conf<P.dropScore) return; var q=kept[i].quad;
      var x0=Math.min(q[0][0],q[3][0]), x1=Math.max(q[1][0],q[2][0]), y0=Math.min(q[0][1],q[1][1]), y1=Math.max(q[2][1],q[3][1]);
      lines.push({text:r.text, conf:r.conf, bbox:{x0:x0,y0:y0,x1:x1,y1:y1}, quad:q});
      var toks=r.text.trim().split(/\s+/).filter(Boolean); if(!toks.length) return;
      if(toks.length===1){ words.push({text:toks[0], bbox:{x0:x0,y0:y0,x1:x1,y1:y1}, confidence:r.conf*100}); return; }
      var units=toks.reduce(function(a,t){return a+t.length;},0)+0.5*(toks.length-1), per=(x1-x0)/Math.max(units,1e-6), cur=x0;
      toks.forEach(function(t){ var w=t.length*per; words.push({text:t, bbox:{x0:cur,y0:y0,x1:cur+w,y1:y1}, confidence:r.conf*100}); cur+=w+0.5*per; }); });
    return {words:words, lines:lines, page:work!==src?work:null, fix:fix}; }
};
try{ window.EN9PPOCR=EN9PPOCR; }catch(e){}

/* ---- in-browser engines: PaddleOCR (above) first, Tesseract.js last ---- */
EN9OCR.realIO={
  /* pdf.js and pdf-lib always; then PaddleOCR in the browser, and only when
     its runtime or models cannot be fetched, Tesseract.js. Which one is
     loaded is recorded on EN9OCR.browserEngine for the sidecar. */
  loadEngines:function(st){
    var chain=Promise.resolve();
    /* The app bundles pdf.js already (worker inlined, main thread), so the
       renderer is normally here before OCR asks; the download is only for a
       page that somehow lacks it. */
    if(!window.pdfjsLib){ st("Downloading PDF renderer…");
      chain=chain.then(function(){return en9LoadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js")})
        .then(function(){ window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"; }); }
    if(!window.PDFLib){ chain=chain.then(function(){ st(EN9OCRASSET.has("pdflib.js")?"Starting the built-in PDF writer…":"Downloading PDF writer…");
      return en9LoadScript("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js","pdflib.js"); }); }
    chain=chain.then(function(){ if(EN9OCR.forceTesseract) throw new Error("Tesseract.js requested");
      return EN9PPOCR.load(st).then(function(){ EN9OCR.browserEngine="ppocr"; }); })
      .catch(function(e){ EN9OCR.browserEngine="tesseract.js"; EN9OCR.browserReason=String(e&&e.message||e);
        try{ console.warn("[OCR] PaddleOCR in the browser unavailable: "+EN9OCR.browserReason); }catch(x){}
        if(!window.Tesseract){ st("PaddleOCR could not be loaded in this browser ("+EN9OCR.browserReason+") — downloading Tesseract OCR engine (open source)…");
          return en9LoadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"); } });
    return chain;
  },
  openPdf:function(buf){ return window.pdfjsLib.getDocument({data:buf}).promise; },
  renderPage:function(pdf,n){ return pdf.getPage(n).then(function(page){
    var v1=page.getViewport({scale:1}), sc=2.4, vp=page.getViewport({scale:sc});
    var cv=document.createElement("canvas"); cv.width=Math.ceil(vp.width); cv.height=Math.ceil(vp.height);
    return page.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise.then(function(){
      return {png:cv.toDataURL("image/png"), canvas:cv, scale:sc, w:v1.width, h:v1.height}; }); }); },
  makeWorker:function(langs,st){
    if(EN9OCR.browserEngine==="ppocr"){ EN9PPOCR.status=st; return Promise.resolve({ppocr:true, terminate:function(){}}); }
    return window.Tesseract.createWorker(langs,1,{logger:function(m){
      if(m.status==="recognizing text") st("Reading text… "+Math.round((m.progress||0)*100)+"%"); }}); },
  recognize:function(worker,pageimg){
    if(worker&&worker.ppocr) return EN9PPOCR.page(pageimg.canvas);
    return worker.recognize(pageimg.canvas).then(function(r){return r.data;}); },
  /* pages: [{n, copy:true}] keep the original page (its text layer intact);
     [{n, png, w, h, words}] embed the image with an invisible text layer. */
  buildPdf:function(pages,srcBuf){ var PL=window.PDFLib;
    return PL.PDFDocument.create().then(function(doc){
      var srcP=srcBuf&&pages.some(function(p){return p.copy;})?PL.PDFDocument.load(srcBuf):Promise.resolve(null);
      var fontP=doc.embedFont(PL.StandardFonts.Helvetica).catch(function(){ return null; });
      return Promise.all([srcP,fontP]).then(function(got){ var src=got[0], font=got[1];
        return pages.reduce(function(p,pg){ return p.then(function(){
          if(pg.copy&&src) return doc.copyPages(src,[pg.n-1]).then(function(cp){ doc.addPage(cp[0]); });
          return doc.embedPng(pg.png).then(function(img){
            var page=doc.addPage([pg.w,pg.h]);
            page.drawImage(img,{x:0,y:0,width:pg.w,height:pg.h});
            (pg.words||[]).forEach(function(wd){
              if(!wd.text||!wd.bbox) return;
              var x=wd.bbox.x0/pg.scale, y1=wd.bbox.y1/pg.scale, hh=(wd.bbox.y1-wd.bbox.y0)/pg.scale, ww=(wd.bbox.x1-wd.bbox.x0)/pg.scale;
              var size=Math.max(4,Math.min(40,hh*0.92));
              /* sized to the box height, then shrunk to its width — a long
                 caption must not run into the next word's box, or the text
                 extractor reads the two as one */
              if(font&&ww>0){ try{ var tw=font.widthOfTextAtSize(wd.text,size); if(tw>ww) size=Math.max(2.5,size*ww/tw); }catch(e){} }
              var opts={x:x,y:pg.h-y1,size:size,opacity:0}; if(font) opts.font=font;
              try{ page.drawText(wd.text,opts); }catch(e){ try{ page.drawText(wd.text.replace(/[^\x20-\x7e]/g,"?"),opts); }catch(e2){} } });
          }); }); }, Promise.resolve()).then(function(){ return doc.save(); });
      });
    }); }
};

/* Which pages of an attached PDF lack a text layer, read with the app's own
   pdf.js through the bridge. null when the reader could not open it. */
function EN9ocrProbe(blob){ try{ if(window.__WPACT&&window.__WPACT.EN9_probePdf) return window.__WPACT.EN9_probePdf(blob); }catch(e){} return Promise.resolve(null); }

/* A sidecar for the store from the service's answer. */
function EN9ocrSidecarFromService(resp,mode){ var d=resp.doc||{}, pages=resp.pages||[];
  var used=(d.engines_used&&d.engines_used[0])||d.primary||"paddle";
  var ver=null; pages.forEach(function(p){ if(!ver&&p.verify_engine) ver=p.verify_engine; });
  return {engine:used, backend:(d.backends&&d.backends[used])||"", verifyEngine:ver, chain:d.engine_chain||[], mode:mode, source:"service",
    at:new Date().toISOString(), verdict:d.verdict||"", ocrPages:d.ocr_pages||[],
    pages:pages.map(function(p){ return {page:p.page,status:p.status,engine:p.engine||null,confMean:p.conf_mean==null?null:p.conf_mean,
      words:(p.words||[]).map(function(w){return {text:w.text,bbox:w.bbox,conf:w.conf,engine:w.engine};}),
      flags:(p.flags||[]).map(function(f){return {page:f.page,kind:f.kind,level:f.level,text:f.text,bbox:f.bbox,conf:f.conf,engine:f.engine,message:f.message,alt:f.alt==null?null:f.alt,alt_engine:f.alt_engine||null,alt_conf:f.alt_conf==null?null:f.alt_conf};})}; }),
    stats:resp.stats||{}}; }

/* A sidecar from the in-browser engine: word boxes back to page points, and
   the one validation it can do — a figure read below the confidence floor. */
function EN9ocrLooksNumeric(t){ t=String(t||"").trim(); if(!/\d/.test(t)) return false; if(/^\d{1,2}[,.]$|^\d{4}[,.;:]?$/.test(t)) return false;
  var core=t.replace(/^\(?[-+−–]?\s?(?:[$€£¥₹]|USD|EUR|GBP|CHF|KYD)?\s?|\s?(?:%|USD|EUR|GBP|CHF|KYD|CR|DR)?\s?\)?[-+−–]?$/gi,"").trim();
  return !!core&&core.split(/\s+/).every(function(p){ return /^[\d()\[\],.\-+−–'OoIlSsB|]+$/.test(p); }); }
/* The grammar checks the service applies, for the in-browser engines: a
   well-formed amount (the grouping separator decides the decimal one), a
   date, and a digit run with a letter OCR swaps for a digit. */
var EN9ocrCUR="(?:[$€£¥₹]|USD|EUR|GBP|CHF|KYD|CAD|AUD|JPY|CNY|HKD|SGD|MXN|BRL|INR)";
var EN9ocrAMOUNT=new RegExp("^\\(?[-+−–]?\\s?"+EN9ocrCUR+"?\\s?[-+−–]?\\s?(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,4})?|\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d{1,3}(?:[ \\u00a0\\u202f']\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:\\.\\d{1,4}|,\\d{1,2})?)\\s?(?:%|"+EN9ocrCUR+"|CR|DR)?\\s?\\)?[-+−–]?$","i");
var EN9ocrDATE=/^(?:\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{2}|\d{4})|\d{4}[/.\-]\d{1,2}[/.\-]\d{1,2}|(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+(?:\d{1,2},?\s+)?\d{2,4})$/i;
var EN9ocrSWAPS={"O":"0","o":"0","I":"1","l":"1","|":"1","S":"5","s":"5","B":"8","Z":"2","z":"2"};
function EN9ocrGlyphFix(t){ t=String(t||"").trim(); if(!/\d/.test(t)) return null; var f=t.replace(/[OoIl|SsBZz]/g,function(ch){ return EN9ocrSWAPS[ch]||ch; });
  return f!==t&&EN9ocrAMOUNT.test(f)?f:null; }
function EN9ocrLocalFlags(page,text,bb,c,eng){ var flags=[], t=String(text).trim();
  if(!EN9ocrLooksNumeric(t)) return flags;
  var fix=EN9ocrGlyphFix(t);
  if(fix) flags.push({page:page,kind:"suspicious-glyph",level:"warn",text:t,bbox:bb,conf:c,engine:eng,message:"'"+t+"' mixes letters into a figure — probably '"+fix+"'. Verify against the scan.",alt:fix,alt_engine:"grammar",alt_conf:null});
  else if(!EN9ocrAMOUNT.test(t)&&!EN9ocrDATE.test(t)) flags.push({page:page,kind:"numeric-grammar",level:"warn",text:t,bbox:bb,conf:c,engine:eng,message:"'"+t+"' is not a well-formed amount or date (separators or decimals do not add up) — verify against the scan.",alt:null,alt_engine:null,alt_conf:null});
  if(c<0.9) flags.push({page:page,kind:"low-confidence",level:"warn",text:t,bbox:bb,conf:c,engine:eng,message:"'"+t+"' was read at "+Math.round(c*100)+"% confidence, below the 90% floor for figures — verify against the scan.",alt:null,alt_engine:null,alt_conf:null});
  return flags; }
function EN9ocrSidecarFromLocal(pages,targets,mode,langs){ var out=[];
  var pp=EN9OCR.browserEngine==="ppocr", eng=pp?"paddle":"tesseract.js";
  var backend=pp?EN9PPOCR.backend:"Tesseract.js 5 in this browser (fallback — "+(EN9OCR.browserReason?"PaddleOCR could not load: "+EN9OCR.browserReason:"no OCR service")+")";
  pages.forEach(function(pg){ if(pg.copy){ out.push({page:pg.n,status:"digital",engine:null,confMean:null,words:[],flags:[]}); return; }
    var words=[], confs=[], flags=[];
    (pg.words||[]).forEach(function(wd){ if(!wd.text||!wd.bbox) return; var c=(wd.confidence||0)/100; confs.push(c);
      var bb=[wd.bbox.x0/pg.scale,wd.bbox.y0/pg.scale,wd.bbox.x1/pg.scale,wd.bbox.y1/pg.scale];
      words.push({text:wd.text,bbox:bb,conf:c,engine:eng});
      flags.push.apply(flags,EN9ocrLocalFlags(pg.n,wd.text,bb,c,eng)); });
    var mean=confs.length?confs.reduce(function(a,b){return a+b;},0)/confs.length:null;
    out.push({page:pg.n,status:words.length?"ocr":"failed",engine:eng,confMean:mean,words:words,flags:words.length?flags:[{page:pg.n,kind:"page-failed",level:"block",text:"",bbox:[0,0,pg.w,pg.h],conf:0,engine:eng,message:"Page "+pg.n+" could not be read by the in-browser engine. Nothing on it should be trusted without checking the scan.",alt:null,alt_engine:null,alt_conf:null}]}); });
  return {engine:eng, backend:backend, verifyEngine:null, chain:[eng], mode:mode, source:"browser",
    at:new Date().toISOString(), verdict:targets.length===pages.length?"scanned":"mixed", ocrPages:targets.slice(), pages:out, stats:{langs:langs}}; }
EN9OCR.localFlags=EN9ocrLocalFlags; EN9OCR.sidecarFromLocal=EN9ocrSidecarFromLocal;

/*EN9AUTOOCR-BEGIN*/
/* A scan that the tool cannot read used to end the story: the file was
   reported unreadable and the preparer had to know that an OCR card existed,
   find it, pick the file again and choose a language. The engine was always
   there — only the decision to start it was manual.

   Two watchers now. EN9ocrIntakeTick runs at UPLOAD: every new PDF is probed
   for pages without a text layer and those pages are OCR'd before the entity
   can be processed (the store waits on EN9OCRGATE). EN9autoOcrTick is the
   safety net from before: a scan that somehow reached processing unread is
   OCR'd afterwards and the entity re-processed. Both run once per file, only
   while the app is idle, and announce themselves. The language is taken from
   what the OTHER documents already established about the entity (a prior-year
   US return names the country long before the scan is read). */
var EN9autoOcrTried = {};
var EN9ocrProbed = {};
function EN9ocrLangsFor(ent) {
  var c = ((ent && ent.profile && ent.profile.countryInc) || "").toLowerCase();
  var m = ((ent && ent.profile && ent.profile.currency) || "").toUpperCase();
  if (/switz|suisse|schweiz/.test(c) || m === "CHF") return "eng+fra+deu+ita";
  if (/france|belg|luxem|monaco/.test(c) || m === "XOF") return "eng+fra";
  if (/german|austria|deutsch/.test(c)) return "eng+deu";
  if (/netherland|holland/.test(c)) return "eng+nld";
  if (/ital/.test(c)) return "eng+ita";
  if (/brazil|brasil|portug/.test(c) || m === "BRL") return "eng+por";
  if (/spain|espa|chile|mexic|colomb|argentin|peru|uruguay|ecuador|bolivia|venezuel|paraguay|costa rica|panama|guatemala/.test(c)
      || ["CLP","COP","MXN","ARS","PEN","UYU","BOB","PYG","CRC","GTQ","DOP"].indexOf(m) >= 0) return "eng+spa";
  return "eng";
}
function EN9ocrSay(m, fileId) {
  try { window.__WPACT && window.__WPACT.__toast ? window.__WPACT.__toast(m) : 0; } catch (e) {}
  try { console.info("[OCR] " + m); } catch (e) {}
  var el = document.getElementById("en9-ocr-status"); if (el) el.textContent = m;
  if (fileId && EN9OCR.jobs[fileId]) EN9OCR.jobs[fileId].message = m;
  EN9ocrRenderJobs();
}
/* Upload-time detection: probe every new PDF, OCR the pages that need it. */
function EN9ocrIntakeTick() {
  try {
    if (!window.__WPGET || !window.__WPACT || !window.__WPACT.EN9_probePdf || !window.__WPACT.EN9_replaceFile) return;
    var st = window.__WPGET(); if (!st) return;
    /* OCR detection is deliberately scoped to the entity the preparer is
       currently working on.  The old all-entity sweep could surface another
       client's file/progress after switching clients. */
    (st.entities || []).filter(function (ent) { return ent.id === st.activeEntityId; }).forEach(function (ent) {
      (ent.files || []).forEach(function (f) {
        if (!f || EN9ocrProbed[f.id] || !f.blob || !/\.pdf$/i.test(f.name || "") || f.ocr || /\(OCR\)\.pdf$/i.test(f.name || "")) return;
        EN9ocrProbed[f.id] = 1;
        var eid = ent.id;
        EN9ocrProbe(f.blob).then(function (probe) {
          if (!probe || !probe.scanPages || !probe.scanPages.length) return;
          var cur = window.__WPGET(); var e2 = (cur.entities || []).find(function (x) { return x.id === eid; });
          var f2 = e2 && (e2.files || []).find(function (x) { return x.id === f.id; });
          if (!f2) return;                                   /* removed while probing */
          var what = probe.scanPages.length === probe.pageCount ? "a scan with no text layer" : "a mixed PDF — " + probe.scanPages.length + " of " + probe.pageCount + " page(s) have no text layer";
          EN9ocrSay("“" + f.name + "” is " + what + ". Reading it with OCR now; “Process entity” waits until it is done.");
          // The pages are named explicitly: the probe already knows them, and a
          // second detection inside the engine would only cost time.
          EN9ocrStart(eid, f.id, { pages: probe.scanPages.join(","), mode: "auto", langs: EN9ocrLangsFor(e2) });
        }).catch(function () {});
      });
    });
  } catch (e) { /* never let the watcher break the app */ }
}
/* After-the-fact safety net (a scan that reached processing unread). */
function EN9autoOcrTick() {
  try {
    if (EN9OCR.busy) return;
    if (!window.__WPGET || !window.__WPACT) return;
    var st = window.__WPGET();
    if (!st || st.busy) return;
    var queues = globalThis.EN9SCANS || {};
    for (var eid in queues) {
      var list = queues[eid] || [];
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        if (!f || EN9autoOcrTried[f.id] || EN9OCR.jobs[f.id]) continue;
        var ent = (st.entities || []).find(function (x) { return x.id === eid; });
        // Wait for the run to finish writing the profile: the language is
        // chosen from the country the OTHER documents established, and reading
        // it a moment too early gets "eng" for a French-language scan.
        if (!ent || !ent.processedAt) continue;
        var att = (ent.files || []).find(function (x) { return x.id === f.id; });
        if (!att || !att.blob) { EN9autoOcrTried[f.id] = 1; continue; }
        EN9autoOcrTried[f.id] = 1;
        var langs = EN9ocrLangsFor(ent);
        var say = function (m) { EN9ocrSay(m); };
        say("“" + f.name + "” is a scan with no text. Reading it with OCR (" + langs + ") — this can take a minute a page.");
        (function (entityId, fileId, name) {
          EN9ocrRunAny(att.blob, entityId, { pages: "auto", langs: langs, mode: "auto", name: name }, say).then(function (res) {
            if (!res || !res.file) { say("OCR could not read “" + name + "”. Add a text-based PDF or the source spreadsheet instead."); return; }
            try {
              var p = window.__WPACT.EN9_replaceFile ? window.__WPACT.EN9_replaceFile(entityId, fileId, res.file, res.sidecar) : null;
              if (!p) { window.__WPACT.addFiles(entityId, [res.file]); }
              Promise.resolve(p).then(function () {
                EN9OCR.result = null;
                say("Added “" + res.file.name + "”. Re-processing — every figure it produced is OCR-derived and must be checked against the scan.");
                setTimeout(function () { try { window.__WPACT.processEntity(entityId); } catch (e) {} }, 400);
              });
            } catch (e) { say("OCR finished but the result could not be attached — use the OCR card on Document intake."); }
          });
        })(eid, f.id, f.name);
        return;                                  // one file at a time
      }
    }
  } catch (e) { /* never let the watcher break the app */ }
}
if (typeof window !== "undefined") { setInterval(EN9autoOcrTick, 1500); setInterval(EN9ocrIntakeTick, 1200); window.addEventListener("wp:state", function () { setTimeout(EN9ocrIntakeTick, 50); }); }
/*EN9AUTOOCR-END*/

/* One OCR job on an attached file: mark the gate, run, replace the file,
   release the gate. Failures release the gate with the error so a waiting
   Process Entity stops rather than reads the wrong bytes. */
function EN9ocrStart(entityId, fileId, opts) {
  if (EN9OCR.jobs[fileId] && EN9OCR.jobs[fileId].status === "running") return EN9OCR.jobs[fileId].p;
  var st0 = window.__WPGET && window.__WPGET(); var ent = st0 && (st0.entities || []).find(function (x) { return x.id === entityId; });
  var att = ent && (ent.files || []).find(function (x) { return x.id === fileId; });
  if (!att || !att.blob) return Promise.resolve(null);
  EN9autoOcrTried[fileId] = 1;
  var gateP = EN9OCRGATE.mark(entityId, fileId);
  var job = EN9OCR.jobs[fileId] = { entityId: entityId, fileId: fileId, name: att.name, status: "running", mode: opts.mode || "manual", message: "Processing", startedAt: Date.now(), completedAt: null };
  var say = function (m) { EN9ocrSay(m, fileId); };
  job.p = EN9ocrRunAny(att.blob, entityId, { pages: opts.pages || "auto", langs: opts.langs || EN9ocrLangsFor(ent), force: !!opts.force, mode: opts.mode || "manual", name: att.name }, say)
    .then(function (res) {
      if (!res || !res.file) throw new Error(job.error || "no result");
      return Promise.resolve(window.__WPACT.EN9_replaceFile(entityId, fileId, res.file, res.sidecar)).then(function (newId) {
        if (!newId) throw new Error("the document is no longer attached");
        job.status = "done"; job.completedAt = Date.now(); job.newId = newId; job.engine = res.sidecar.backend || res.sidecar.engine;
        var flags = res.sidecar.pages.reduce(function (n, p) { return n + (p.flags || []).filter(function (x) { return x.level !== "info"; }).length; }, 0);
        say("“" + att.name + "” read by " + (res.sidecar.backend || res.sidecar.engine) + (res.sidecar.verifyEngine ? " (cross-checked by " + res.sidecar.verifyEngine + ")" : "") +
          " — " + res.sidecar.ocrPages.length + " page(s)" + (flags ? ", " + flags + " reading(s) flagged for review" : "") + ". Every figure from it is OCR-derived and must be checked against the scan.");
        EN9OCRGATE.done(entityId, fileId);
        EN9OCR.result = null;
        return newId;
      });
    })
    .catch(function (e) {
      job.status = "failed"; job.completedAt = Date.now(); job.error = String(e && e.message || e);
      say("OCR could not read “" + att.name + "”: " + en9OcrFriendly(e) + " The original file stays attached and unread — supply a clearer scan, a text PDF or the source spreadsheet.");
      EN9OCRGATE.done(entityId, fileId, new Error("OCR of “" + att.name + "” failed: " + en9OcrFriendly(e)));
      return null;
    })
    .then(function (r) { EN9ocrRenderJobs(); return r; });
  EN9ocrRenderJobs();
  return job.p;
}

/* Service first, in-browser engine last. Resolves {file, sidecar} or null. */
function EN9ocrRunAny(blob, entityId, opts, st) {
  var name = opts.name || blob.name || "document.pdf";
  return EN9OCR.service.health().then(function (h) {
    if (h.available) {
      st("OCR service: " + (EN9OCR.service.describe() || {}).text + ".");
      return EN9OCR.service.ocr(blob, { pages: opts.pages, langs: opts.langs, force: opts.force, name: name }, st).then(function (resp) {
        if (!resp || !resp.pdf_b64) throw new Error("the OCR service returned no document");
        var bin = atob(resp.pdf_b64), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        var nm = String(name).replace(/ \(OCR\)\.pdf$/i, ".pdf").replace(/\.pdf$/i, "") + " (OCR).pdf";
        var f = new File([arr], nm, { type: "application/pdf" });
        var sc = EN9ocrSidecarFromService(resp, opts.mode || "manual");
        EN9OCR.stats.runs++; EN9OCR.stats.pages += (sc.ocrPages || []).length; EN9OCR.stats.words += (resp.stats && resp.stats.words) || 0;
        if (resp.stats && resp.stats.failed_pages && resp.stats.failed_pages.length) EN9OCR.stats.fails++;
        return { file: f, sidecar: sc };
      });
    }
    st(EN9OCR.service.off() ? "OCR service turned off — reading with PaddleOCR in this browser." : "No OCR service found (" + (h.error || "no engine") + ") — reading with PaddleOCR in this browser instead.");
    return new Promise(function (resolve) {
      en9OcrRun(blob, entityId, opts.langs || "eng", st, function (res) { resolve(res); }, { pages: opts.pages, force: opts.force, mode: opts.mode, name: name });
    });
  });
}

/* In-browser engine. `opts.pages`: "auto" (probe for pages without text),
   "all", or "2,4-6"; pages not selected are copied from the original
   unchanged. done(result) with {file, sidecar, pages, words} or null. */
function en9OcrRun(file,entityId,langs,st,done,opts){
  opts=opts||{};
  if(EN9OCR.busy){ if(st) st("An OCR run is already in progress — wait for it to finish."); done&&done(null); return; }
  EN9OCR.busy=true; EN9OCR.result=null;
  var io=EN9OCR.io||EN9OCR.realIO, worker=null, srcBuf=null, targets=null;
  st("Preparing…");
  io.loadEngines(st)
  .then(function(){ return file.arrayBuffer(); })
  .then(function(buf){ srcBuf=buf.slice(0); return io.openPdf(buf); })
  .then(function(pdf){
    var total=pdf.numPages, spec=String(opts.pages||"auto").toLowerCase();
    var pick;
    if(spec==="all") pick=Promise.resolve(null);
    else if(spec==="auto"||spec==="detect"){ pick=EN9ocrProbe(new Blob([srcBuf],{type:"application/pdf"})).then(function(p){ return p&&p.scanPages&&p.scanPages.length<p.pageCount?p.scanPages:(p&&p.scanPages&&p.scanPages.length?p.scanPages:null); }); }
    else { var set=[]; spec.split(/[,\s]+/).forEach(function(part){ var m=/^(\d+)(?:-(\d+))?$/.exec(part); if(!m) return; var a=+m[1], b=+(m[2]||m[1]); for(var k=Math.min(a,b);k<=Math.max(a,b);k++) if(k>=1&&k<=total&&set.indexOf(k)<0) set.push(k); }); pick=Promise.resolve(set.sort(function(a,b){return a-b;})); }
    return pick.then(function(sel){
      if(sel&&!sel.length){
        if(opts.force) sel=null;                    /* forced: every page, text or not */
        else throw new Error("every page of this PDF already has a text layer, so there is nothing to OCR. Tick “also OCR pages that already have text” to read it anyway.");
      }
      targets=sel||Array.from({length:total},function(_,i){return i+1;});
      return io.makeWorker(langs,st).then(function(w){ worker=w;
        var pages=[], chain=Promise.resolve();
        for(var n=1;n<=total;n++)(function(n2){
          if(targets.indexOf(n2)<0){ pages.push({n:n2,copy:true}); return; }
          chain=chain.then(function(){ st("Rendering page "+n2+" of "+total+"…");
            return io.renderPage(pdf,n2).then(function(pg){
              st("Recognizing page "+n2+" of "+total+"…");
              return io.recognize(worker,pg).then(function(data){
                pg.n=n2; pg.words=(data&&data.words)||[];
                /* the engine turned or straightened the page: the copy shows
                   that upright image, and the words are in its frame */
                if(data&&data.page&&data.page.toDataURL){ pg.png=data.page.toDataURL("image/png"); pg.w=data.page.width/pg.scale; pg.h=data.page.height/pg.scale; pg.fix=data.fix||null; }
                pg.canvas=null; pages.push(pg); }); }); });
        })(n);
        return chain.then(function(){ pages.sort(function(a,b){return a.n-b.n;}); return pages; });
      });
    });
  })
  .then(function(pages){
    var tw=pages.reduce(function(a,p){return a+(p.words?p.words.length:0);},0);
    if(!tw) throw new Error("No text could be recognized — the scan may be too poor. Try a clearer copy.");
    st("Building searchable PDF…");
    return io.buildPdf(pages,srcBuf).then(function(bytes){
      var nm=String(file.name||"document.pdf").replace(/ \(OCR\)\.pdf$/i,".pdf").replace(/\.pdf$/i,"")+" (OCR).pdf";
      var f=new File([bytes],nm,{type:"application/pdf"});
      var sidecar=EN9ocrSidecarFromLocal(pages,targets,opts.mode||"manual",langs);
      EN9OCR.result={file:f, entityId:entityId, pages:targets.length, words:tw, sidecar:sidecar};
      EN9OCR.stats.runs++; EN9OCR.stats.pages+=targets.length; EN9OCR.stats.words+=tw;
      st("Done — "+targets.length+" page(s), "+tw+" word(s) recognized in this browser.");
      done&&done(EN9OCR.result);
    });
  })
  .catch(function(e){ EN9OCR.stats.fails++; st("OCR failed: "+en9OcrFriendly(e)); done&&done(null); })
  .then(function(){ EN9OCR.busy=false; if(worker&&worker.terminate)try{worker.terminate()}catch(e){} });
}

function en9OcrIntakePdfs(entityId){ var s=st(), out=[]; if(!s) return out;
  var e=(s.entities||[]).find(function(x){return x.id===entityId;});
  (e&&e.files||[]).forEach(function(f){ if(/\.pdf$/i.test(f.name||"")&&f.blob) out.push(f); });
  return out; }

/* Running / finished jobs, shown on the OCR card and beside the Process button. */
function EN9ocrRenderJobs(){
  /* One status word on the card, repainted wherever the jobs are. */
  try{ var pc=document.querySelector(".en9-ocr"); if(pc&&pc.EN9_pill) pc.EN9_pill(); }catch(e){}
  var host=document.getElementById("en9-ocr-jobs"); if(host){ while(host.firstChild) host.removeChild(host.firstChild);
    var s0=st(), activeId=s0&&s0.activeEntityId;
    /* Jobs are data owned by their entity.  Never show a previous client's
       filename, status or elapsed time in the active client's panel. */
    var jobs=Object.keys(EN9OCR.jobs).map(function(k){return EN9OCR.jobs[k];}).filter(function(j){return j.entityId===activeId;}).sort(function(a,b){return b.startedAt-a.startedAt;}).slice(0,8);
    jobs.forEach(function(j){ var row=el("div","en9-ocr-job "+j.status);
      var ended=j.completedAt||Date.now(), elapsed=Math.max(0,ended-j.startedAt), secs=Math.floor(elapsed/1000), clock=(secs<60?secs+"s":Math.floor(secs/60)+"m "+String(secs%60).padStart(2,"0")+"s");
      row.appendChild(el("span","en9-ocr-jobname",j.name)); row.appendChild(el("span","en9-ocr-jobstate",j.status==="detecting"?"Detection":j.status==="required"?"OCR required":j.status==="running"?"Processing · "+clock:j.status==="done"?"Completed · "+clock+(j.engine?" · "+j.engine:""):j.status==="not-required"?"OCR not required":"Failed · "+clock));
      row.appendChild(el("span","en9-ocr-jobmsg",j.message||"")); host.appendChild(row); }); }
  /* the run panel: say why Process entity is waiting */
  try{ var s=st(), active=s&&s.activeEntityId;
    var pend=Object.keys(EN9OCR.jobs).filter(function(k){var j=EN9OCR.jobs[k];return j.status==="running"&&(!active||j.entityId===active);}).map(function(k){return EN9OCR.jobs[k].name;});
    document.querySelectorAll(".run-panel").forEach(function(rp){
      var hint=rp.querySelector(".en9-ocr-wait");
      if(pend.length){ if(!hint){ hint=el("div","en9-ocr-wait"); rp.appendChild(hint); }
        hint.textContent="OCR is reading "+pend.join(", ")+" — “Process entity” waits until it finishes, so the run uses the recognised text."; }
      else if(hint) hint.remove(); }); }catch(e){}
}

/* The four words a preparer needs about OCR, from what the app already
   knows. No new detection: it reads the jobs the automatic pass created and
   the OCR sidecars the store holds. */
function en9OcrSummary(){
  try{
    var s0=st(), eid=s0&&s0.activeEntityId;
    var busy=Object.keys(EN9OCR.jobs).some(function(k){ var j=EN9OCR.jobs[k];
      return j&&(j.status==="running"||j.status==="detecting")&&(!eid||j.entityId===eid); });
    if(busy) return ["run","Processing"];
    var ent=((s0&&s0.entities)||[]).filter(function(e){return e.id===eid;})[0];
    var done=((ent&&ent.files)||[]).filter(function(f){return f&&f.ocr;});
    if(!done.length) return ["off","Not needed"];
    var needs=done.some(function(f){
      var pages=(f.ocr&&f.ocr.pages)||[];
      return pages.some(function(pg){
        if(pg.status==="failed") return true;
        return ((pg.flags||[]).some(function(x){ return x&&x.level==="warn"; }));
      });
    });
    return needs?["warn","Needs review"]:["ok","Completed"];
  }catch(e){ return ["off","Not needed"]; }
}

function enhanceOcrPanel(){
  var dz=document.querySelector(".dropzone");
  var old=document.querySelector(".en9-ocr");
  if(!dz||!dz.parentElement){ if(old)old.remove(); return; }
  if(old) {
    /* single card, always glued to the visible dropzone INSIDE the docs-tab
       content — a tab switch unmounts that container and the card with it,
       so the full OCR panel can never linger on Shareholders/Dividends. */
    if(old.parentElement!==dz.parentElement||old.previousElementSibling!==dz)
      dz.parentElement.insertBefore(old, dz.nextSibling);
    var sel0=old.querySelector("select"); en9OcrFillEntities(sel0);
    var activeNow=st()&&st().activeEntityId;
    if(old.getAttribute("data-en9-active")!==String(activeNow||"")){ old.setAttribute("data-en9-active",String(activeNow||"")); old.EN9_reset&&old.EN9_reset(); }
    old.EN9_fillSrc&&old.EN9_fillSrc(); old.EN9_engine&&old.EN9_engine(); old.EN9_pill&&old.EN9_pill(); return; }
  var card=el("section","panel en9-ocr");
  /* The card is a STATUS line first and a tool second. Detection and reading
     both happen on their own at upload (EN9ocrIntakeTick), so the normal user
     has nothing to do here: what they need is to see that it happened. The
     manual controls stay — they are a real fallback for a file detection did
     not catch, for specific pages, or for another language — but they belong
     behind a disclosure, not in front of the upload area they were competing
     with. Nothing was removed. */
  var chead=el("div","en9-ocr-head");
  chead.appendChild(el("strong","en9-ocr-title","Scanned pages"));
  var pill=el("span","en9-ocr-pill"); chead.appendChild(pill);
  card.appendChild(chead);
  card.appendChild(el("p","en9-ocr-sub","Every PDF you add is checked for pages with no text. Those pages are read automatically, and processing waits until the reading is done."));
  function paintPill(){
    var p2=en9OcrSummary();
    pill.className="en9-ocr-pill is-"+p2[0];
    pill.textContent=p2[1];
  }
  card.EN9_pill=paintPill; paintPill();
  var adv=document.createElement("details"); adv.className="en9-ocr-adv";
  var sum=document.createElement("summary"); sum.textContent="Advanced \u00b7 run OCR by hand"; adv.appendChild(sum);
  adv.appendChild(el("p","en9-ocr-advsub","Use this for a file the automatic check did not catch, for specific pages, or to read again in another language. Pages already read are never replaced unless you ask."));
  /* The engines and the privacy model belong to the preparer who opens this,
     not to the upload screen. Both the service and the in-browser engines are
     named here because which one read a page changes how far the document
     travelled: with PaddleOCR or Tesseract in the browser it never leaves
     this browser; with the service it reaches only your own server. */
  adv.appendChild(el("p","en9-ocr-advsub","Pages are read by the PaddleOCR service when one is running, otherwise by PaddleOCR (PP-OCRv5) in this browser, with Tesseract.js as the last resort. With the in-browser engines the document never leaves this browser; with the service it goes only to your own server. Every figure from an OCR’d document is flagged for verification against the original scan."));
  var eng=el("div","en9-ocr-engine","Checking for the OCR service…"); adv.appendChild(eng);
  /* where the service is: found automatically, or typed here */
  var urow=el("div","en9-ocr-url");
  var ul=el("label",null,"Service address "); var ui=document.createElement("input"); ui.type="text"; ui.setAttribute("data-en9","");
  ui.placeholder="auto (this server, then http://127.0.0.1:"+EN9OCR.service.DEFAULT_PORT+") · off = read in this browser"; ui.value=EN9OCR.service.userUrl(); ul.appendChild(ui);
  var ub=el("button","button en9-ocr-check","Check"); ub.type="button";
  urow.appendChild(ul); urow.appendChild(ub); adv.appendChild(urow);
  var checking=false;
  function showEngine(force){ if(checking&&!force) return;
    checking=true; eng.className="en9-ocr-engine"; if(force) eng.textContent="Checking for the OCR service…";
    EN9OCR.service.health(force).then(function(h){ checking=false;
      eng.textContent=EN9OCR.service.statusText(); eng.className="en9-ocr-engine"+(h&&h.available?"":" offline");
      try{ var hint=document.querySelector(".en9-ocrset"); if(hint&&hint.EN9_refresh) hint.EN9_refresh(); }catch(e){} },
      function(){ checking=false; }); }
  ub.addEventListener("click",function(){ EN9OCR.service.setUserUrl(ui.value); ui.value=EN9OCR.service.userUrl(); showEngine(true); });
  ui.addEventListener("keydown",function(ev){ if(ev.key==="Enter"){ ev.preventDefault(); ub.click(); } });
  card.EN9_engine=showEngine; showEngine();
  card.setAttribute("data-en9-active",String((st()&&st().activeEntityId)||""));
  var row=el("div","en9-ocr-row");
  var sel=document.createElement("select"); sel.setAttribute("data-en9",""); en9OcrFillEntities(sel);
  var src=document.createElement("select"); src.setAttribute("data-en9",""); src.className="en9-ocr-src";
  var fi=document.createElement("input"); fi.type="file"; fi.accept=".pdf,.png,.jpg,.jpeg"; fi.setAttribute("data-en9","");
  function fillSrc(){ var cur=src.value;
    while(src.firstChild)src.removeChild(src.firstChild);
    var o0=document.createElement("option"); o0.value=""; o0.textContent="— choose a file from this computer —"; src.appendChild(o0);
    en9OcrIntakePdfs(sel.value).forEach(function(f){ var o=document.createElement("option");
      o.value=f.id; o.textContent="Already attached: "+f.name+(f.ocr?" (already OCR’d)":""); src.appendChild(o); });
    if([...src.options].some(function(o){return o.value===cur;})) src.value=cur;
    fi.style.display=src.value?"none":""; }
  src.addEventListener("change",fillSrc);
  sel.addEventListener("change",function(){
    /* The picker changes the actual active entity, rather than becoming a
       second, unsynchronised OCR context. */
    if(window.__WPACT&&window.__WPACT.setActiveEntity) window.__WPACT.setActiveEntity(sel.value);
    fillSrc();
  });
  card.EN9_fillSrc=fillSrc;
  var pgl=el("label","en9-ocr-pages"); pgl.appendChild(document.createTextNode("Pages "));
  var pg=document.createElement("input"); pg.type="text"; pg.placeholder="auto (pages without text) · all · 2,4-6"; pg.setAttribute("data-en9",""); pgl.appendChild(pg);
  var fl=el("label","en9-ocr-force"); var fc=document.createElement("input"); fc.type="checkbox"; fc.setAttribute("data-en9","");
  fl.appendChild(fc); fl.appendChild(document.createTextNode(" also OCR pages that already have text (readings kept for comparison, the text layer is not replaced)"));
  var lg=el("label","en9-ocr-lang"); var cb=document.createElement("input"); cb.type="checkbox"; cb.checked=false; cb.setAttribute("data-en9","");
  lg.appendChild(cb); lg.appendChild(document.createTextNode(" also recognise Dutch (English and the entity’s country language are always on)"));
  var btn=el("button","button en9-ocr-btn","Run OCR now"); btn.type="button";
  row.appendChild(sel); row.appendChild(src); row.appendChild(fi); row.appendChild(pgl); row.appendChild(lg); row.appendChild(btn);
  fillSrc();
  adv.appendChild(row);
  var upload=el("div","en9-ocr-upload"); upload.tabIndex=0;
  upload.innerHTML='<strong>Drop a PDF here</strong><span>or choose a file from this computer</span><small class="en9-ocr-selected">No file selected</small>';
  function setLocalFile(file){
    if(!file) return; var transfer=new DataTransfer(); transfer.items.add(file); fi.files=transfer.files;
    var name=upload.querySelector(".en9-ocr-selected"); if(name) name.textContent=file.name;
    var eid=sel.value, job={entityId:eid,fileId:"manual:"+eid+":"+file.name+":"+file.lastModified,name:file.name,status:"detecting",message:"Detection in progress",startedAt:Date.now(),completedAt:null};
    EN9OCR.jobs[job.fileId]=job; stat.textContent="Detection — checking whether OCR is required for “"+file.name+"”…"; EN9ocrRenderJobs();
    EN9ocrProbe(file).then(function(probe){
      /* A selection can finish probing after a client switch. Keep its data
         private to its owner and do not change the newly active panel. */
      if(!EN9OCR.jobs[job.fileId]) return;
      job.completedAt=Date.now();
      if(probe&&probe.scanPages&&probe.scanPages.length){ job.status="required"; job.message="OCR required for "+probe.scanPages.length+" of "+probe.pageCount+" page(s)"; }
      else { job.status="not-required"; job.message="Text layer found — OCR is not required"; }
      if((st()&&st().activeEntityId)===eid) stat.textContent=job.message; EN9ocrRenderJobs();
    }).catch(function(){ job.completedAt=Date.now(); job.status="failed"; job.message="Detection failed — OCR can still be run manually."; if((st()&&st().activeEntityId)===eid) stat.textContent=job.message; EN9ocrRenderJobs(); });
  }
  fi.addEventListener("change",function(){ setLocalFile(fi.files&&fi.files[0]); });
  upload.addEventListener("click",function(){ fi.click(); });
  upload.addEventListener("keydown",function(ev){ if(ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); fi.click(); } });
  upload.addEventListener("dragover",function(ev){ ev.preventDefault(); upload.classList.add("is-dragging"); });
  upload.addEventListener("dragleave",function(){ upload.classList.remove("is-dragging"); });
  upload.addEventListener("drop",function(ev){ ev.preventDefault(); upload.classList.remove("is-dragging"); setLocalFile(ev.dataTransfer&&ev.dataTransfer.files&&ev.dataTransfer.files[0]); });
  adv.appendChild(upload); adv.appendChild(fl);
  if(en9IsSandbox()) adv.appendChild(el("div","en9-ocr-sandbox","⚠ You are viewing this inside the claude.ai preview, which blocks the background workers the in-browser engine needs. Everything else works here — but run OCR on your deployed site (or open the downloaded HTML directly in your browser)."));
  var jobs=el("div","en9-ocr-jobs"); jobs.id="en9-ocr-jobs"; card.appendChild(jobs);
  var stat=el("div","en9-ocr-status"); stat.id="en9-ocr-status"; card.appendChild(stat);
  card.appendChild(adv);
  var acts=el("div","en9-ocr-acts"); acts.style.display="none";
  var addb=el("button","button primary","Add to intake"); addb.type="button";
  var dlb=el("button","button","Download searchable PDF"); dlb.type="button";
  acts.appendChild(addb); acts.appendChild(dlb); adv.appendChild(acts);
  /* Reset only this presentation state on a client switch.  Stored files and
     OCR sidecars remain with their actual entity; no old transient result can
     bleed into the next client's screen. */
  card.EN9_reset=function(){ src.value=""; fi.value=""; pg.value=""; fc.checked=false; cb.checked=false; acts.style.display="none"; stat.textContent=""; };
  adv.appendChild(el("div","en9-ocr-note","Documents read by OCR are named “… (OCR).pdf” so every caption’s source chip shows OCR provenance; the Provenance sheet of the work paper lists the engine, confidence and page position of every figure they contribute. Treat all extracted figures as unverified until checked."));
  btn.addEventListener("click",function(){
    if(!sel.value){ stat.textContent="Choose the entity this document belongs to."; return; }
    var s2=st(), ent=s2&&(s2.entities||[]).find(function(x){return x.id===sel.value;});
    var langs=EN9ocrLangsFor(ent); if(cb.checked&&langs.indexOf("nld")<0) langs+="+nld";
    var pages=(pg.value||"auto").trim()||"auto";
    acts.style.display="none";
    if(src.value){ EN9ocrStart(sel.value, src.value, {pages:pages, force:fc.checked, mode:"manual", langs:langs}); return; }
    var f=fi.files&&fi.files[0];
    if(!f){ stat.textContent="Pick an already-attached PDF from the dropdown, or choose a file from this computer."; return; }
    EN9ocrRunAny(f, sel.value, {pages:pages, force:fc.checked, mode:"manual", langs:langs, name:f.name}, function(m){stat.textContent=m;}).then(function(res){
      if(res){ EN9OCR.result={file:res.file, entityId:sel.value, sidecar:res.sidecar}; acts.style.display=""; }
    });
  });
  addb.addEventListener("click",function(){
    var r=EN9OCR.result; if(!r) return;
    if(window.__WPACT&&window.__WPACT.addFiles){
      Promise.resolve(window.__WPACT.addFiles(r.entityId,[r.file])).then(function(){
        try{ var s3=st(), e3=(s3.entities||[]).find(function(x){return x.id===r.entityId;}); var nf=e3&&(e3.files||[]).slice().reverse().find(function(x){return x.name===r.file.name;});
          if(nf){ EN9ocrProbed[nf.id]=1; if(r.sidecar&&window.__WPACT.EN9_replaceFile) window.__WPACT.EN9_replaceFile(r.entityId,nf.id,r.file,r.sidecar); } }catch(e){}
      });
      stat.textContent="Added “"+r.file.name+"” to intake — process the entity, then verify every figure against the original scan.";
      EN9OCR.result=null; acts.style.display="none"; }   /* one-shot: no double intake */
    else stat.textContent="Could not reach the intake action — download the PDF and drop it on the entity instead.";
  });
  dlb.addEventListener("click",function(){
    var r=EN9OCR.result; if(!r) return;
    var u=URL.createObjectURL(r.file), a=document.createElement("a");
    a.href=u; a.download=r.file.name; a.click(); setTimeout(function(){URL.revokeObjectURL(u)},4000);
  });
  /* rebuilt after a tab switch: surface a still-pending OCR result */
  if(EN9OCR.result&&EN9OCR.result.entityId===sel.value){ stat.textContent="Completed — this client's OCR result is ready to add to intake."; acts.style.display=""; }
  dz.parentElement.insertBefore(card, dz.nextSibling);
  EN9ocrRenderJobs();
}

/* The shipped bundle predates the Exception Centre sign-off action in the
   source tree.  This control intentionally delegates to the existing React
   navigation button instead of rewriting URLs or duplicating navigation
   state: click → the app's own onNavigate("signoff") handler → sign-off view. */
function enhanceExceptionSignoff(){
  var heads=document.querySelectorAll(".section-header"), head=null;
  for(var i=0;i<heads.length;i++){ var h=heads[i].querySelector("h1"); if(h&&h.textContent.trim()==="Exception center"){ head=heads[i]; break; } }
  var prior=document.querySelector(".en9-exception-signoff"); if(!head){ if(prior) prior.remove(); return; }
  if(prior&&prior.parentElement!==head) prior.remove();
  if(prior) return;
  var actions=head.querySelector(".signoff-actions")||el("div","signoff-actions");
  if(!actions.parentElement) head.appendChild(actions);
  var button=el("button","button primary en9-exception-signoff","Review and sign off"); button.type="button";
  button.addEventListener("click",function(){
    var nav=document.querySelectorAll(".nav-item");
    for(var n=0;n<nav.length;n++) if(/review\s*&\s*sign-off/i.test(nav[n].textContent||"")){ nav[n].click(); return; }
    button.textContent="Sign-off navigation unavailable";
  });
  actions.appendChild(button);
}

/* Blocking exceptions have always required an audit note, but the React
   handlers used window.prompt().  On embedded/local browser surfaces that
   prompt can be hidden, making both actions appear inert.  Capture only those
   controls, collect the same required note in-page, then let the original
   handler perform the existing dismiss/sign-off action. */
function EN9exceptionNoteDialog(button){
  var prior=document.querySelector(".en9-signoff-dialog"); if(prior) prior.remove();
  var shade=el("div","en9-signoff-dialog"), box=el("section","en9-signoff-box");
  box.setAttribute("role","dialog"); box.setAttribute("aria-modal","true");
  box.appendChild(el("strong",null,"Document the sign-off"));
  box.appendChild(el("p",null,"This is a blocking exception. Add the preparer’s reason before it is acknowledged and unblocked."));
  var note=document.createElement("textarea"); note.placeholder="Reason for acknowledging this exception"; note.setAttribute("data-en9",""); box.appendChild(note);
  var actions=el("div","en9-signoff-dialog-actions"), cancel=el("button","button","Cancel"), confirm=el("button","button primary","Acknowledge & unblock"); cancel.type=confirm.type="button";
  cancel.addEventListener("click",function(){ shade.remove(); });
  confirm.addEventListener("click",function(){ var text=note.value.trim(); if(!text){ note.focus(); return; }
    shade.remove(); button.setAttribute("data-en9-note",text); button.setAttribute("data-en9-approved","1"); button.click(); });
  actions.appendChild(cancel); actions.appendChild(confirm); box.appendChild(actions); shade.appendChild(box); document.body.appendChild(shade); note.focus();
}
document.addEventListener("click",function(ev){
  var button=ev.target&&ev.target.closest&&ev.target.closest("button"); if(!button||isOurs(button)) return;
  var label=(button.textContent||"").trim();
  if(label!=="Acknowledge & unblock"&& !/^Sign off selected/.test(label)) return;
  if(button.getAttribute("data-en9-approved")==="1"){
    var savedPrompt=window.prompt, savedConfirm=window.confirm, note=button.getAttribute("data-en9-note")||"";
    button.removeAttribute("data-en9-approved"); button.removeAttribute("data-en9-note");
    window.prompt=function(){ return note; }; window.confirm=function(){ return true; };
    setTimeout(function(){ window.prompt=savedPrompt; window.confirm=savedConfirm; },0); return;
  }
  /* A single block always needs a note.  For a selected batch, inspect the
     visible selected rows; open the note dialog only when a block is included. */
  var needsNote=label==="Acknowledge & unblock";
  if(!needsNote&&/^Sign off selected/.test(label)){
    /* The React component already exposes this fact in its title.  Prefer it
       over DOM row inspection: virtualized/paginated tables need not retain
       every selected row in this panel. */
    needsNote=/\bblocking\b/i.test(button.title||"");
    if(!needsNote){ var table=button.closest(".panel")&&button.closest(".panel").querySelector("table");
      needsNote=!!(table&&Array.prototype.some.call(table.querySelectorAll("tbody tr"),function(row){ var check=row.querySelector('input[type="checkbox"]'); return check&&check.checked&&/\bBLOCK\b/i.test(row.textContent||""); })); }
  }
  if(needsNote){ ev.preventDefault(); ev.stopImmediatePropagation(); EN9exceptionNoteDialog(button); }
},true);
function en9OcrFillEntities(sel){
  if(!sel) return; var s=st(); if(!s) return;
  var want=(s.entities||[]).map(function(e){return e.id+"|"+e.name;}).join(";");
  if(sel.getAttribute("data-en9opts")===want){ if(s.activeEntityId && document.activeElement!==sel && sel.value!==s.activeEntityId) sel.value=s.activeEntityId; return; }
  sel.setAttribute("data-en9opts",want);
  while(sel.firstChild)sel.removeChild(sel.firstChild);
  (s.entities||[]).forEach(function(e){ var o=document.createElement("option");
    o.value=e.id; o.textContent=e.name; sel.appendChild(o); });
  if(s.activeEntityId) sel.value=s.activeEntityId;
}


/* ---------- Settings: OCR engine details, usage & pending verification ---------- */
function en9OcrDocs(){ var s=st(), out=[]; if(!s) return out;
  (s.entities||[]).forEach(function(e){ (e.files||[]).forEach(function(f){
    if(f.ocr||/\(OCR\)\.pdf$/i.test(f.name||"")) out.push({entity:e.name,name:f.name,engine:f.ocr&&(f.ocr.backend||f.ocr.engine)||"in-browser engine"}); }); });
  return out; }
function enhanceOcrSettings(){
  var stacks=document.querySelectorAll(".view-stack"), host=null;
  for(var i=0;i<stacks.length;i++)
    if((stacks[i].textContent||"").indexOf("Every methodology, rule set, model and limit")>-1){ host=stacks[i]; break; }
  var old=document.querySelector(".en9-ocrset");
  /* ONE OCR info card, at the bottom of Free services only. */
  if(!host||en9SettingsTab(host)!=="Free services"){ if(old)old.remove(); return; }
  var card=old;
  if(!card){ card=el("section","panel en9-ocrset");
    host.appendChild(card); }
  while(card.firstChild)card.removeChild(card.firstChild);
  card.appendChild(el("strong",null,"OCR engines — PaddleOCR first, Surya second, Tesseract last"));
  /* engine facts */
  var h=EN9OCR.service._health, d=EN9OCR.service.describe();
  card.EN9_refresh=enhanceOcrSettings;
  var facts=el("div","en9-os-grid");
  [["Service",d?"online at "+(d.base==="/api/ocr"?"this server (/api/ocr)":d.base)+" — "+d.text:
      (h?"not found — looked at "+(h.tried||[]).map(function(t){ return t.base==="/api/ocr"?"this server":t.base; }).join(", "):"not checked yet")+". Start ocr-service/ (python -m ocr_service) on this computer, or enter its address on the OCR card of the Documents tab"],
   ["Address",EN9OCR.service.userUrl()?EN9OCR.service.userUrl()+" (set on the OCR card)":"automatic — this server’s /api/ocr, then http://127.0.0.1:"+EN9OCR.service.DEFAULT_PORT+" and http://localhost:"+EN9OCR.service.DEFAULT_PORT],
   ["Primary","PaddleOCR 3.x — PP-OCRv6 (or PP-OCRv5) text detection and recognition, PP-StructureV3 for table pages; PP-OCRv5 through ONNX Runtime on hosts with no model download"],
   ["Second reading","Surya when installed; otherwise Tesseract re-reads every numeric token. A disagreement is flagged with both readings — the primary’s is kept, nothing is auto-corrected"],
   ["In this browser","PaddleOCR PP-OCRv5 through ONNX Runtime Web (Apache-2.0, no key) when no service answers — "+(EN9OCRASSET.has("rec.onnx")
     ? "the runtime and the det/rec/cls models are built into this file (offline build), so nothing is downloaded and no internet is needed"
     : "the runtime (~14 MB, cdn.jsdelivr.net) and the det/rec/cls models (~22 MB, the OnnxOCR project's GitHub, pinned commit "+EN9PPOCR.MODEL_COMMIT.slice(0,7)+") download once and stay in this browser's IndexedDB")+"; type “off” as the service address to always read here"],
   ["Final fallback","Tesseract.js v5 in this browser (Apache-2.0, free forever, no key), used only when neither a service nor the in-browser PaddleOCR can be loaded — engine ~a few MB from cdn.jsdelivr.net on first use"],
   ["Preprocessing","300 dpi render · orientation · deskew · denoise when grainy · contrast (CLAHE)"],
   ["Validation","amount/date/percentage/currency grammar, thousands and decimal separators, negatives in parentheses, letter-for-digit swaps (O/0, l/1, S/5), confidence floor 90% on figures"],
   ["Privacy","documents go to the OCR service on your own server or computer (this server’s /api/ocr/*, or the address you entered), never to a third party; the in-browser fallback never uploads anything"]
  ].forEach(function(p){ var r=el("div","en9-os-row");
    r.appendChild(el("span","en9-os-k",p[0])); r.appendChild(el("span","en9-os-v",p[1])); facts.appendChild(r); });
  card.appendChild(facts);
  /* usage */
  var stq=EN9OCR.stats, docs=en9OcrDocs();
  card.appendChild(el("h4","en9-os-h","Usage"));
  var ug=el("div","en9-os-grid");
  [["This session",stq.runs+" document(s) · "+stq.pages+" page(s) · "+stq.words.toLocaleString("en-US")+" word(s) recognized"+(stq.fails?" · "+stq.fails+" failed run(s)":"")],
   ["Quota","Unlimited — open-source engines on your own machine, nothing metered"],
   ["OCR documents in this workpaper",docs.length?docs.length+" file(s) — ALL pending manual verification until each figure is checked against the original scan":"none yet"]
  ].forEach(function(p){ var r=el("div","en9-os-row");
    r.appendChild(el("span","en9-os-k",p[0])); r.appendChild(el("span","en9-os-v",p[1])); ug.appendChild(r); });
  card.appendChild(ug);
  if(docs.length){ var dl=el("div","en9-os-pending");
    docs.forEach(function(d2){ dl.appendChild(el("div","en9-auth-src",d2.entity+" → "+d2.name+" — "+d2.engine+" — verification pending")); });
    card.appendChild(dl); }
  /* how it works */
  card.appendChild(el("h4","en9-os-h","How it works"));
  var steps=el("ol","en9-os-list");
  ["On upload every PDF is probed page by page with the app’s own PDF reader: pages with a text layer are left alone, pages without one are queued for OCR. Mixed documents are OCR’d only where needed.",
   "The queued pages go to the OCR service, which renders each at 300 dpi, straightens and cleans it, and reads it with PaddleOCR. A second engine re-reads the figures; anything they disagree on, anything malformed and anything below the confidence floor is flagged.",
   "The service writes the recognised words back into the PDF as an invisible, position-accurate text layer — the same approach as OCRmyPDF — leaving digital pages untouched. The scanned file is replaced in intake by this copy, named “… (OCR).pdf”, with a sidecar of engines, confidences and positions.",
   "“Process entity” waits for OCR to finish, then reads the copy like any digital PDF. Every flag becomes a review item; the Provenance sheet cites engine, confidence and page position for each OCR’d figure."
  ].forEach(function(x){ var li=document.createElement("li"); li.textContent=x; li.setAttribute("data-en9",""); steps.appendChild(li); });
  card.appendChild(steps);
  /* accepted files */
  card.appendChild(el("h4","en9-os-h","Accepted input"));
  card.appendChild(el("p","en9-os-p","PDF files only (.pdf) reach intake directly — scanned or mixed. A PNG/JPEG photo can be run through the OCR card, which wraps it as a one-page PDF. Best results: flat 300 dpi scans, dark text on light background, machine-printed type. Skew up to about 8° and pages on their side are corrected. Not suitable for handwriting."));
  /* pros & cons */
  card.appendChild(el("h4","en9-os-h","Strengths & limits"));
  var pc=el("div","en9-os-2col");
  var pros=el("div","en9-os-pros"); pros.appendChild(el("strong",null,"Strengths"));
  ["Free and unlimited — no quota, no key, no cost",
   "Private — documents stay on your own server or in this browser",
   "Two engines on every figure; disagreements surface as review items with both readings",
   "Position-accurate output, so the tool’s table reconstruction works normally"
  ].forEach(function(x){ pros.appendChild(el("div","en9-auth-fact","✓ "+x)); });
  var cons=el("div","en9-os-cons"); cons.appendChild(el("strong",null,"Limits"));
  ["Recognition is probabilistic — digits can be misread (8↔3, 1↔7); every figure must be verified",
   "Complex or borderless tables can come out misaligned",
   "Poor, heavily skewed or low-contrast scans may fail or produce noise",
   "Handwriting is not supported",
   "The in-browser fallback downloads its engine (~a few MB) on first use"
  ].forEach(function(x){ cons.appendChild(el("div","en9-auth-miss","– "+x)); });
  pc.appendChild(pros); pc.appendChild(cons); card.appendChild(pc);
  card.appendChild(el("p","en9-os-foot","Values booked from an OCR’d document are never treated as verified: the “(OCR)” name follows them through every source chip, evidence trace and export until you confirm them against the original."));
}

/* ---------- Entity workspace: AI Agent activity ----------
   What the agent did on this entity, in order, in plain words: what it read
   before mapping, what it translated, what it judged important and what
   happened to each one, what it suggested, what needs review, and anything it
   could not do -- with the page, the reason and the action. */
function en9AgentSeat(){
  /* Two homes, because the log lives in two places: the entity card's
     "Review & log" tab renders a "Processing log" panel outright, and the
     Entity workspace shows the entity with its own actions. Anchor on
     whichever is on screen, and on nothing when neither is. Returns where to
     put the card and how. */
  var heads=document.querySelectorAll(".panel-heading h2");
  for(var i=0;i<heads.length;i++)
    if((heads[i].textContent||"").trim()==="Processing log"){
      var p=heads[i].closest(".panel");
      if(p&&p.parentNode) return { node:p, how:"before" }; }
  var stacks=document.querySelectorAll(".view-stack");
  for(var j=0;j<stacks.length;j++)
    if((stacks[j].textContent||"").indexOf("Generate this entity")>-1) return { node:stacks[j], how:"append" };
  return null;
}
function en9AgRow(grid,k,v){ var r=el("div","en9-os-row");
  r.appendChild(el("span","en9-os-k",k)); r.appendChild(el("span","en9-os-v",v)); grid.appendChild(r); }
function en9AgStat(host,n,label){ var t=el("div","en9-ag-stat");
  t.appendChild(el("span","en9-ag-num",String(n))); t.appendChild(el("span","en9-ag-lab",label)); host.appendChild(t); }
function en9AgBadge(kind,text){ return el("span","en9-ag-badge en9-ag-"+kind,text); }
/* "AI Mapping & Review Agent: ..." on every line, and the evidence tail, are
   for the log. The card shows the sentence and the source separately. */
function en9AgParse(msg){
  var m=String(msg||"").replace(/^AI Mapping & Review Agent:\s*/,"");
  var src=null, ev=/\sEvidence:\s([^·]+?)(?:\sp\.(\d+))?\s·\s“([^”]*)”([\s\S]*)$/.exec(m);
  if(ev){ src={doc:ev[1].trim(), page:ev[2]||null, caption:ev[3], rest:(ev[4]||"").replace(/^[\s·]+/,"").replace(/\.$/,"")};
    m=m.slice(0,ev.index); }
  m=m.replace(/\s+/g," ").trim();
  return { text:m, src:src };
}
function en9AgShort(text,max){ var t=String(text||"");
  if(t.length<=max) return t;
  var cut=t.slice(0,max), dot=cut.lastIndexOf(". ");
  return (dot>60?cut.slice(0,dot+1):cut.trim()+"…"); }
var EN9AG_TITLES=[[/^agent-balance-/,"Balance sheet gap","Calculation"],
  [/^agent-period-/,"Period end","Review"],
  [/^agent-unused-/,"Important information not used","Mapping"],
  [/^agent-medium-/,"Mapped, medium confidence","Mapping"],
  [/^agent-ambiguous-/,"Needs a decision","Mapping"],
  [/^agent-conflict-/,"Conflicting suggestion","Mapping"],
  [/^agent-terminology-/,"Translation wording","Review"],
  [/^agent-missing-/,"Figure missing","Review"]];
function en9AgTitle(id){ for(var i=0;i<EN9AG_TITLES.length;i++) if(EN9AG_TITLES[i][0].test(id)) return EN9AG_TITLES[i];
  return [null,"Finding","Review"]; }
/* Open the source document at the page the finding came from. The file is
   held in the project, so this is the document itself, not a description of
   it: PDF viewers honour #page=. */
function en9AgOpenSource(docName,page){
  var e=ent(); if(!e) return false;
  var f=(e.files||[]).filter(function(x){ return x.name===docName||(docName&&x.name.indexOf(docName)===0); })[0];
  if(!f||!f.blob) return false;
  try{
    var u=URL.createObjectURL(f.blob)+(page?"#page="+page:"");
    window.open(u,"_blank","noopener");
    setTimeout(function(){ URL.revokeObjectURL(u); },60000);
    return true;
  }catch(x){ return false; }
}
function en9AgSourceBtn(row,docName,page,evidence){
  var wrap=el("div","en9-ag-acts");
  var b=el("button","button en9-ag-src","View source"); b.type="button";
  b.addEventListener("click",function(){
    if(!en9AgOpenSource(docName,page)) b.textContent="Source file not held — see evidence below";
  });
  wrap.appendChild(b);
  if(evidence){
    var t=el("button","button en9-ag-ev","Evidence"); t.type="button";
    var panel=el("div","en9-ag-evbody"); panel.style.display="none";
    Object.keys(evidence).forEach(function(k){
      if(evidence[k]===null||evidence[k]===undefined||evidence[k]==="") return;
      var r=el("div","en9-os-row"); r.appendChild(el("span","en9-os-k",k));
      r.appendChild(el("span","en9-os-v",String(evidence[k]))); panel.appendChild(r); });
    t.addEventListener("click",function(){
      var open=panel.style.display!=="none";
      panel.style.display=open?"none":""; t.textContent=open?"Evidence":"Hide evidence"; });
    wrap.appendChild(t); row.appendChild(wrap); row.appendChild(panel); return;
  }
  row.appendChild(wrap);
}
function enhanceAgentActivity(){
  var seat=en9AgentSeat();
  var old=document.querySelector(".en9-agentact");
  if(!seat){ if(old)old.remove(); return; }
  var e=ent(); if(!e){ if(old)old.remove(); return; }
  var info=null;
  try{ info=window.__WPACT&&window.__WPACT.EN9agentInfo&&window.__WPACT.EN9agentInfo(); }catch(x){ info=null; }
  var brief=e.EN9agentBrief||null;
  var s=st()||{};
  var last=(s.EN9agent||{}).lastRun||null;
  if(!info){ if(old)old.remove(); return; }
  var card=old;
  if(!card){ card=el("section","panel en9-agentact");
    if(seat.how==="before") seat.node.parentNode.insertBefore(card,seat.node);
    else seat.node.appendChild(card); }
  while(card.firstChild)card.removeChild(card.firstChild);
  card.EN9_refresh=enhanceAgentActivity;

  var items=(e.reviewItems||[]).filter(function(i){ return /^agent-/.test(i.id); });
  var fails=(brief&&brief.failures)||[];
  var open=items.filter(function(i){ return !i.dismissed&&!i.resolution; });
  var status = e.status==="processing" ? ["work","Working"]
    : (!brief&&!last) ? ["off","Not run"]
    : (fails.length||open.length) ? ["warn","Needs review"]
    : ["ok","Completed"];

  var head=el("div","en9-ag-head");
  head.appendChild(el("strong",null,"AI Agent"));
  head.appendChild(el("span","en9-ag-sub","Mapping & Review · "+info.framework+" · "+info.provider));
  head.appendChild(en9AgBadge(status[0],status[1]));
  if(!info.enabled) head.appendChild(en9AgBadge("off","Switched off"));
  card.appendChild(head);

  if(!brief&&!last){
    card.appendChild(el("p","en9-ag-empty","Process the entity and the agent's work appears here."));
    return;
  }

  /* numbers first */
  var read=0; (brief&&brief.docs||[]).forEach(function(d){ read+=d.rowsWithFigures||0; });
  var stats=el("div","en9-ag-stats");
  en9AgStat(stats,(brief&&brief.docs.length)||0,"Documents");
  en9AgStat(stats,read||(last?last.considered:0),"Items reviewed");
  en9AgStat(stats,items.length,"Issues found");
  en9AgStat(stats,last?last.exceptions:0,"Sent to Review");
  en9AgStat(stats,fails.length,"Could not process");
  card.appendChild(stats);

  /* what it did, as chips */
  var STEP={survey:"Read documents",yearCheck:"Checked tax year",spotlight:"Checked unmapped information",
    interpret:"Understood structure",handoff:"Passed to the rules",gather:"Collected leftovers",
    understand:"Read headings",suggest:"Suggested lines",terminology:"Checked translation",
    critique:"Checked its answers",route:"Split offer and review",reconcile:"Validated results"};
  var ran=[].concat(brief&&brief.steps||[],last&&last.nodes||[]);
  var seen={},chips=el("div","en9-ag-chips");
  if(brief&&brief.translated) ran.push("translated");
  STEP.translated="Translated content";
  ran.forEach(function(x){ if(seen[x]||!STEP[x])return; seen[x]=1; chips.appendChild(el("span","en9-ag-chip",STEP[x])); });
  if(chips.childNodes.length){ card.appendChild(el("h4","en9-ag-h","Agent activity")); card.appendChild(chips); }

  /* tax year check */
  if(brief&&brief.docs&&brief.docs.length){
    card.appendChild(el("h4","en9-ag-h","Tax year check"));
    /* Detected years, the year chosen, current and prior, and who chose. */
    var chain=el("div","en9-ag-chain");
    [["Detected", (brief.detectedYears&&brief.detectedYears.length?brief.detectedYears.join(", "):"none")],
     ["Work paper year", String(brief.requiredYear||"\u2014")],
     ["Current", String(brief.requiredYear||"\u2014")],
     ["Prior", brief.requiredYear?String(brief.requiredYear-1):"\u2014"],
     ["Chosen by", brief.yearSource==="selected"?"you, in Basic Information":brief.yearSource==="documents"?"the documents":"nobody yet"]
    ].forEach(function(p2,i){
      if(i) chain.appendChild(el("span","en9-ag-flowsep","\u203a"));
      var cs=el("span","en9-ag-chainstep");
      cs.appendChild(el("span","en9-ag-chainlab",p2[0]));
      cs.appendChild(el("span","en9-ag-chainval",p2[1]));
      chain.appendChild(cs);
    });
    card.appendChild(chain);
    var tb=el("div","en9-ag-table");
    var COLS=["Document","Identified","Required","Result","Role"];
    var hr=el("div","en9-ag-tr en9-ag-th");
    COLS.forEach(function(h){ hr.appendChild(el("span",null,h)); });
    tb.appendChild(hr);
    /* Each cell carries its column name. Wide enough, the names stay hidden
       and the grid reads as a table; too narrow for five columns, the same
       markup stacks into labelled rows instead of being cut off at the card
       edge. No font size changes, and nothing is hidden. */
    var label=function(node,i){ node.setAttribute("data-col",COLS[i]); return node; };
    var MATCH={match:["ok","Match"],mismatch:["bad","Mismatch"],unclear:["warn","Unclear"],unchecked:["off","Not year-bound"]};
    brief.docs.forEach(function(d){
      var r=el("div","en9-ag-tr");
      r.appendChild(label(el("span","en9-ag-doc",d.name),0));
      r.appendChild(label(el("span",null,(d.statementYear||"—")+(d.periodEnd?" · to "+d.periodEnd:"")+(d.periodStart?" (from "+d.periodStart+")":"")),1));
      r.appendChild(label(el("span",null,String(d.supportsYear||brief.requiredYear||"—")),2));
      var mm=MATCH[d.match||"unchecked"];
      var c=el("span"); c.setAttribute("data-en9",""); c.appendChild(en9AgBadge(mm[0],mm[1])); r.appendChild(label(c,3));
      r.appendChild(label(el("span",null,d.role==="current-year"?"Current year":d.role==="prior-year-input"?"Prior-year input":d.role==="comparative"?"Comparative column":d.role==="unclear"?"Unknown":"Reference"),4));
      tb.appendChild(r);
    });
    card.appendChild(tb);
  }

  /* documents understood */
  if(brief&&brief.docs&&brief.docs.length){
    card.appendChild(el("h4","en9-ag-h","Documents understood"));
    var dl=el("div","en9-ag-docs");
    brief.docs.forEach(function(d){
      var row=el("div","en9-ag-doccard");
      var top=el("div","en9-ag-docline");
      /* The filename is the heading and it is allowed to be long: it wraps,
         and the badge keeps its size rather than being squeezed out of the
         card by it. */
      top.appendChild(el("strong","en9-ag-docname",d.name));
      var bw=el("span","en9-ag-docbadge"); bw.appendChild(en9AgBadge(d.rowsWithFigures?"ok":"off",d.rowsWithFigures?"Reviewed":"No figures"));
      top.appendChild(bw);
      row.appendChild(top);
      /* One fact per chip, so the line can be scanned instead of read. */
      var meta=el("div","en9-ag-meta");
      [d.kind.replace(/-/g," "),d.pages+" page(s)",d.language,d.rowsWithFigures+" figure(s)",d.ocr?"OCR":""]
        .filter(Boolean).forEach(function(t){ meta.appendChild(el("span","en9-ag-metachip",t)); });
      row.appendChild(meta);
      var det=el("div","en9-ag-evbody"); det.style.display="none";
      [["Period",(d.periodStart?d.periodStart+" to ":"")+(d.periodEnd||"not stated")],
       ["Rows read",String(d.rowsRead)],["Dropped as totals",String(d.rowsDropped)],
       ["Sections",(d.sections||[]).join(", ")||"none named"],
       ["Supports work paper year",String(d.supportsYear||"—")]].forEach(function(pq){
        var rr=el("div","en9-os-row"); rr.appendChild(el("span","en9-os-k",pq[0]));
        rr.appendChild(el("span","en9-os-v",pq[1])); det.appendChild(rr); });
      var acts=el("div","en9-ag-acts");
      var vb=el("button","button en9-ag-ev","View details"); vb.type="button";
      vb.addEventListener("click",function(){ var o=det.style.display!=="none";
        det.style.display=o?"none":""; vb.textContent=o?"View details":"Hide details"; });
      acts.appendChild(vb);
      var ob=el("button","button en9-ag-src","Open document"); ob.type="button";
      ob.addEventListener("click",function(){ if(!en9AgOpenSource(d.name,null)) ob.textContent="File not held"; });
      acts.appendChild(ob);
      row.appendChild(acts); row.appendChild(det); dl.appendChild(row);
    });
    card.appendChild(dl);
  }

  /* findings */
  var unused=items.filter(function(i){ return /^agent-unused-/.test(i.id); });
  var rest=items.filter(function(i){ return !/^agent-unused-|^agent-failure-/.test(i.id); });
  var IMPACT={mapping:"Mapping","tie-out":"Calculation",consistency:"Review",process:"Review"};
  var drawFinding=function(host,it){
    var t=en9AgTitle(it.id), p=en9AgParse(it.message);
    var c=el("div","en9-ag-card");
    var h=el("div","en9-ag-cardhead");
    h.appendChild(el("strong",null,t[1]));
    h.appendChild(en9AgBadge(it.dismissed||it.resolution?"ok":"warn",it.dismissed||it.resolution?"Resolved":"Needs review"));
    c.appendChild(h);
    c.appendChild(el("p","en9-ag-text",en9AgShort(p.text,190)));
    var doc=(p.src&&p.src.doc)||it.source||"", page=p.src&&p.src.page;
    c.appendChild(el("div","en9-ag-meta",["Source: "+(doc||"—")+(page?" · page "+page:""),
      "Impact: "+(IMPACT[it.category]||"Review")].join(" · ")));
    en9AgSourceBtn(c,doc,page,p.src?{Document:doc,Page:page||"—",
      "Original text":p.src.caption,"What the agent understood":en9AgShort(p.text,140),
      "Figures":p.src.rest||"—",Confidence:/MEDIUM/.test(it.message)?"medium":/LOW/.test(it.message)?"low":"high"}:null);
    host.appendChild(c);
  };
  if(rest.length){ card.appendChild(el("h4","en9-ag-h","Findings"));
    var fl=el("div","en9-ag-cards"); rest.forEach(function(i){ drawFinding(fl,i); }); card.appendChild(fl); }

  /* the rule that matters most: nothing important is ignored quietly */
  if(unused.length){
    card.appendChild(el("h4","en9-ag-h en9-ag-alert","Important information not used"));
    var ul=el("div","en9-ag-cards"); unused.forEach(function(i){ drawFinding(ul,i); }); card.appendChild(ul);
  }

  /* what it could not process */
  if(fails.length){
    card.appendChild(el("h4","en9-ag-h","Could not process"));
    var xl=el("div","en9-ag-cards");
    fails.forEach(function(f){
      var c=el("div","en9-ag-card");
      var h=el("div","en9-ag-cardhead");
      h.appendChild(el("strong",null,en9AgShort(f.what,80)));
      h.appendChild(en9AgBadge("bad","Failed"));
      c.appendChild(h);
      c.appendChild(el("div","en9-ag-meta",[f.doc?"Source: "+f.doc+(f.page?" · page "+f.page:""):"",
        "Stage: "+f.stage].filter(Boolean).join(" · ")));
      c.appendChild(el("p","en9-ag-text","Reason: "+en9AgShort(f.reason,140)));
      c.appendChild(el("p","en9-ag-text en9-ag-action","Action: "+en9AgShort(f.action,140)));
      en9AgSourceBtn(c,f.doc||"",f.page,null);
      xl.appendChild(c);
    });
    card.appendChild(xl);
  }

  /* where the agent sat in the workflow */
  var flow=el("div","en9-ag-flow");
  ["Understood","Translated","Checked","Suggested","Validated","Flagged"].forEach(function(x,i){
    if(i) flow.appendChild(el("span","en9-ag-flowsep","›"));
    flow.appendChild(el("span","en9-ag-flowstep",x)); });
  card.appendChild(el("h4","en9-ag-h","How the agent helped"));
  card.appendChild(flow);
  card.appendChild(el("p","en9-ag-foot","It reads, translates, suggests and flags. The 5471 rules, the rates and the checks decide."));
}

/* ---------- Settings: the AI Agent card ----------
   Plain-language description of the agent, on the AI platform tab, beside the
   Groq key it shares. It never shows the key itself -- only whether one is
   present, which is all the preparer needs to know from here. */
function enhanceAgentSettings(){
  var stacks=document.querySelectorAll(".view-stack"), host=null;
  for(var i=0;i<stacks.length;i++)
    if((stacks[i].textContent||"").indexOf("Every methodology, rule set, model and limit")>-1){ host=stacks[i]; break; }
  var old=document.querySelector(".en9-agent");
  if(!host||en9SettingsTab(host)!=="AI platform"){ if(old)old.remove(); return; }
  var info=null;
  try{ info=window.__WPACT&&window.__WPACT.EN9agentInfo&&window.__WPACT.EN9agentInfo(); }catch(e){ info=null; }
  if(!info){ if(old)old.remove(); return; }
  var card=old;
  if(!card){ card=el("section","panel en9-agent"); host.appendChild(card); }
  while(card.firstChild)card.removeChild(card.firstChild);
  card.EN9_refresh=enhanceAgentSettings;

  var head=el("div","en9-ag-head");
  head.appendChild(el("strong",null,"AI Agent"));
  head.appendChild(el("span",info.connected?"en9-ag-pill en9-ag-on":"en9-ag-pill en9-ag-off",info.connected?"Connected":"Not connected"));
  card.appendChild(head);
  card.appendChild(el("p","en9-os-p","An assistant that reads the documents you uploaded and suggests where each figure belongs. It only suggests \u2014 the tool's own 5471 rules, exchange rates and checks still decide what goes into the work paper."));

  var facts=el("div","en9-os-grid");
  [["Agent",info.name],
   ["Where it works","Documents \u2014 reading and OCR \u2014 language \u2014 translation \u2014 understanding \u2014 the 5471 rules \u2014 checks \u2014 Review \u2014 work paper. It reads the documents BEFORE the rules run, and reads the result back after."],
   ["Framework",info.framework+" \u2014 the agent is a state graph: "+info.steps.join(", ")],
   ["AI provider",info.provider+(info.model?" \u00b7 "+info.model:"")],
   ["Status",info.connected?"Connected \u2014 using "+info.keySource:"Not connected \u2014 add a Groq key above and the agent starts suggesting; until then it still reports gaps it can find without a model"],
   ["API key","Shared with the Groq card above. There is no separate key for the agent, and the key is never displayed or exported \u2014 only its status is shown here."],
   ["Runs during processing",info.enabled?"Yes \u2014 twice: it reads the documents before mapping, and reads the booked result back afterwards":"No \u2014 switched off"],
   ["Where to watch it","Open an entity and look at Review & log \u2014 the AI Agent activity card lists every step, what it found and anything it could not do."]
  ].forEach(function(p){ var r=el("div","en9-os-row");
    r.appendChild(el("span","en9-os-k",p[0])); r.appendChild(el("span","en9-os-v",p[1])); facts.appendChild(r); });
  card.appendChild(facts);

  var act=el("div","review-actions");
  var btn=el("button","button",info.enabled?"Turn the agent off":"Turn the agent on");
  btn.type="button";
  btn.addEventListener("click",function(){
    try{ window.__WPACT.EN9setAgent({enabled:!info.enabled}); }catch(e){}
    setTimeout(enhanceAgentSettings,60);
  });
  act.appendChild(btn); card.appendChild(act);

  card.appendChild(el("h4","en9-os-h","What it can do"));
  var pc=el("div","en9-os-2col");
  var pros=el("div","en9-os-pros");
  info.can.forEach(function(x){ pros.appendChild(el("div","en9-auth-fact","\u2713 "+x)); });
  var cons=el("div","en9-os-cons"); cons.appendChild(el("strong",null,"What it cannot do"));
  info.cannot.forEach(function(x){ cons.appendChild(el("div","en9-auth-miss","\u2013 "+x)); });
  pc.appendChild(pros); pc.appendChild(cons); card.appendChild(pc);

  card.appendChild(el("h4","en9-os-h","How it works"));
  var steps=el("ol","en9-os-list");
  ["It starts from what the tool has already read \u2014 the text pulled out of your documents and any translations. Nothing is uploaded or read again.",
   "It works out what each caption means in accounting terms, using the headings it was printed under and the figures beside it.",
   "It suggests a work paper line for each caption the ordinary rules could not place, and says how sure it is and which page it read.",
   "It checks the English used for translated captions and queries any term that could mislead.",
   "Everything it is sure about is handed to the normal mapping rules, which can still refuse it. Everything else goes to Review & exceptions with the document, page and figures attached."
  ].forEach(function(x){ var li=document.createElement("li"); li.textContent=x; li.setAttribute("data-en9",""); steps.appendChild(li); });
  card.appendChild(steps);

  if(info.lastRun){
    card.appendChild(el("h4","en9-os-h","Last run"));
    var lg=el("div","en9-os-grid");
    [["When",info.lastRun.at+" \u00b7 "+info.lastRun.entity],
     ["Captions reviewed",String(info.lastRun.considered)],
     ["Accepted by the mapping rules",String(info.lastRun.accepted)],
     ["Sent to Review & exceptions",String(info.lastRun.exceptions)],
     ["Gaps and queries raised",String(info.lastRun.findings)]
    ].forEach(function(p){ var r=el("div","en9-os-row");
      r.appendChild(el("span","en9-os-k",p[0])); r.appendChild(el("span","en9-os-v",p[1])); lg.appendChild(r); });
    card.appendChild(lg);
  }
  card.appendChild(el("h4","en9-os-h","When it cannot do something"));
  card.appendChild(el("p","en9-os-p","It says so. Every thing it could not read, translate, understand or check is listed on the entity\u2019s Review & log tab with the document, the page, the reason and what you need to do. Nothing it fails at is dropped quietly."));
  card.appendChild(el("p","en9-os-foot","The agent never changes a figure, an exchange rate or a calculation, and it cannot sign anything off. Every suggestion it makes is recorded with its evidence so you can check it."));
}

/* ---------- master pass ---------- */
/* ---------- Overview: Preview format <-> Generate (state-dependent) ----------
   With nothing processed there is nothing to generate — the primary action
   becomes "Preview format", which downloads the untouched master template.
   The React button is hidden via a class (never text-mutated) and restored
   the moment any entity has extracted lines or a completed run. */
function en9Processed(){ var s=st(); if(!s||!s.entities) return false;
  return s.entities.some(function(e){
    return (e.lines&&Object.keys(e.lines).length>0)||e.status==="ready"; }); }
function en9BlankTemplate(){
  var node=document.getElementById("wp-template"); if(!node) return false;
  try{
    var bin=atob((node.textContent||"").trim());
    var arr=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    var blob=new Blob([arr],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
    var u=URL.createObjectURL(blob), a=document.createElement("a");
    a.href=u; a.download="5471_Workpaper_Blank_Format.xlsx"; a.click();
    setTimeout(function(){URL.revokeObjectURL(u)},4000); return true;
  }catch(e){ return false; }
}
function enhanceOverviewButton(){
  var h1=null, hs=document.querySelectorAll(".section-header h1");
  for(var i=0;i<hs.length;i++)
    if(hs[i].textContent.trim()==="Executive overview"){ h1=hs[i]; break; }
  var old=document.querySelector(".en9-pfbtn");
  function drop(){ if(old)old.remove();
    var g2=document.querySelector("button.en9-swapped"); if(g2)g2.classList.remove("en9-swapped"); }
  if(!h1){ drop(); return; }
  var head=h1.closest(".section-header");
  var acts=head&&head.querySelector(".signoff-actions"); if(!acts){ drop(); return; }
  var gen=null, bs=acts.querySelectorAll("button.primary");
  for(var j=0;j<bs.length;j++) if(!isOurs(bs[j])){ gen=bs[j]; break; }
  if(!gen){ drop(); return; }
  /* a rebuilt app renders the state-aware button itself — stand down */
  if((gen.textContent||"").indexOf("Preview format")>-1){ drop(); return; }
  var s=st(), busy=!!(s&&s.busy);
  if(en9Processed()){ gen.classList.remove("en9-swapped"); if(old)old.remove(); return; }
  gen.classList.add("en9-swapped");
  if(!old){
    old=el("button","button primary en9-pfbtn","Preview format"); old.type="button";
    old.title="Nothing has been processed yet — download the untouched master template to preview the output format.";
    old.addEventListener("click",function(){
      if(!en9BlankTemplate())
        old.textContent="Download blocked — open the deployed site directly";
    });
    acts.appendChild(old);
  }
  old.disabled=busy;
  if(old.previousElementSibling!==gen) gen.parentElement.insertBefore(old, gen.nextSibling);
}

function rebuildAll(){
  enhancing=true;
  try{
    var items=mapTables();
    for(var i=0;i<items.length;i++){
      var rs=dataRows(items[i].table);
      for(var j=0;j<rs.length;j++) decorateRow(rs[j], items[i].kind);
      injectColFilters(items[i]);
      rebuild(items[i].table, items[i].kind);
      injectBar(items[i]);
      injectPager(items[i]);
      fixSticky(items[i].table);
    }
    /* the popup lives on <body>, so a header rebuild cannot take it with it --
       but its anchor may have moved, so follow it */
    popPosition();
    /* wide tables scroll inside their panel instead of spilling off-screen */
    document.querySelectorAll(".view-stack table").forEach(function(tb){
      if(tb.closest(".wp-table")) return;
      var pa=tb.parentElement; if(!pa) return;
      if(tb.scrollWidth>pa.clientWidth+8 && !pa.getAttribute("data-en9xs")){ pa.setAttribute("data-en9xs","1"); pa.style.overflowX="auto"; }
    });
    enhanceCategoryAuthority();
    enhanceSettingsSources();
    enhanceOcrSettings();
    /* Isolated: an agent card that throws must not take the rest of the
       layer down with it — everything here shares one try/catch. */
    try{ enhanceAgentSettings(); }catch(e){ try{ window.__EN9AGERR="settings: "+(e&&e.message||e); }catch(x){} }
    try{ enhanceAgentActivity(); }catch(e){ try{ window.__EN9AGERR="activity: "+(e&&e.message||e); }catch(x){} }
    enhanceTopbarHint();
    enhanceOcrPanel();
    enhanceExceptionSignoff();
    enhanceOcrBadges();
    enhanceOverviewButton();
    enhancePills();
    enhanceLog();
  }catch(e){ /* never break the app */ }
  requestAnimationFrame(function(){ enhancing=false; });
}
function schedule(){ clearTimeout(timer); timer=setTimeout(rebuildAll,120); }

/* ---------- reactivity: state events + React re-renders + user input ---------- */
window.addEventListener("wp:state", schedule);
document.addEventListener("input", function(ev){ if(!isOurs(ev.target)) schedule(); }, true);
var mo=new MutationObserver(function(muts){
  if(enhancing) return;
  for(var i=0;i<muts.length;i++){
    var m=muts[i];
    if(isOurs(m.target)) continue;
    var ns=[].slice.call(m.addedNodes).concat([].slice.call(m.removedNodes));
    for(var j=0;j<ns.length;j++)
      if(ns[j].nodeType===1 && !isOurs(ns[j])){ schedule(); return; }
    if(m.type==="characterData"){ schedule(); return; }
  }
});
mo.observe(document.body,{childList:true,subtree:true,characterData:true});
/* delegated clicks: chips, pencils, log toggle survive any DOM churn */
document.addEventListener("click",function(ev){
  var t=ev.target && ev.target.closest ? ev.target : null; if(!t) return;
  var chip=t.closest(".en9-chip");
  if(chip){ ev.stopPropagation(); var h=chip.closest(".en9-metahide");
    if(h){ h.classList.toggle("en9-open");
      var k=chip.getAttribute("data-en9k"); if(k) S.openMeta[k]=h.classList.contains("en9-open"); } return; }
  var pen=t.closest(".en9-pencil");
  if(pen){ ev.stopPropagation(); var x=pen.nextElementSibling;
    if(x && x.tagName==="SELECT"){ x.classList.toggle("en9-hide");
      if(!x.classList.contains("en9-hide")) x.focus(); } return; }
  var ct=t.closest(".en9-caret");
  if(ct){ ev.preventDefault(); ev.stopPropagation();
    var tb2=ct.closest("table"), ix=parseInt(ct.getAttribute("data-en9c"),10);
    if(tb2 && isFinite(ix)) popOpen(tb2, tkey(tb2), ix, ct);
    return; }
  var lb=t.closest(".en9-logbtn");
  if(lb){ var l=lb.nextElementSibling;
    if(l && l.classList.contains("log-list")){ S.logOpen=!S.logOpen;
      l.classList.toggle("en9-open",S.logOpen);
      lb.textContent=(S.logOpen?"Hide":"Show")+" processing log ("+l.children.length+")"; } return; }
}, true);
/* keyboard: "/" focuses the visible filter */
document.addEventListener("keydown",function(ev){
  if(ev.key!=="/"||ev.metaKey||ev.ctrlKey||ev.altKey) return;
  var t=ev.target, tag=t&&t.tagName;
  if(tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT"||(t&&t.isContentEditable)) return;
  var ins=document.querySelectorAll(".en9-fb .en9-search");
  for(var i=0;i<ins.length;i++){ var r=ins[i].getBoundingClientRect();
    if(r.width>0&&r.height>0){ ev.preventDefault();
      if(window.EN9focusNoScroll) window.EN9focusNoScroll(ins[i]);
      else try{ ins[i].focus({preventScroll:true}); }catch(e){ ins[i].focus(); }
      ins[i].select(); return; } }
});
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",schedule);
else schedule();
})();
