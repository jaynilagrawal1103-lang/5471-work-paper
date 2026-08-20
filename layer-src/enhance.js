/* ===== WP UI Enhancement Layer (EN9) — reactive DOM augmentation =====
   Reacts to every state change (wp:state event fired by the store) and to
   DOM mutations from React re-renders. All operations are idempotent and
   additive: React-owned nodes are never removed, moved, or text-split. */
(function(){
"use strict";
var S = { q:"", sch:"ALL", multi:false, edited:false,
          openMeta:{}, collapsed:{}, logOpen:false,
          cf:{}, page:{}, pp:{} };
function tkey(tb){ return (tb.tHead && tb.tHead.rows[0] ? tb.tHead.rows[0].textContent : "t").replace(/\s+/g,"").slice(0,60); }
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
function mapTables(){
  var out=[], wraps=document.querySelectorAll(".wp-table:not(.rules-table)");
  for(var i=0;i<wraps.length;i++){
    var tb = wraps[i].querySelector("table"); if(!tb||!tb.tHead) continue;
    var h = tb.tHead.textContent||"";
    if(/Source caption/i.test(h)) out.push({wrap:wraps[i], table:tb, kind:"map"});
    else if(tb.tBodies[0] && tb.tBodies[0].rows.length>=10) out.push({wrap:wraps[i], table:tb, kind:"big"});
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
    var cons=(e.contributions[rk.key]||[]).filter(function(u){return u.field===rk.field && typeof u.value==="number";});
    var line=e.lines && e.lines[rk.key] ? e.lines[rk.key][rk.field] : null;
    if(cons.length && typeof line==="number"){
      var sum=cons.reduce(function(a,u){return a+u.value;},0);
      if(Math.abs(sum-line)>0.01){
        r.classList.add("en9-edited");
        var d=el("span","en9-edited-dot");
        d.title="Manually edited \u2014 extracted total was "+sum.toLocaleString()+", current value is "+line.toLocaleString();
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
}

/* ---------- grouping, subtotals, filtering ---------- */
function matches(r, key){
  if(S.q && (r.getAttribute("data-en9s")||"").indexOf(S.q)===-1) return false;
  var cf=key?S.cf[key]:null;
  if(cf) for(var ci in cf){ if(!cf[ci]) continue;
    var cell=r.cells[ci]; if(!cell) return false;
    if((cell.textContent||"").toLowerCase().indexOf(cf[ci])===-1) return false; }
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
    var ok = matches(rows[i2], key);
    rows[i2].classList.toggle("en9-hidden", !ok || (kind==="map" && !!S.collapsed[rows[i2].getAttribute("data-en9sch")]));
    if(ok) visTotal++;
  }
  if(kind==="map"){
    var cur=null, groupRows=[];
    function flush(){
      if(!cur||!groupRows.length) return;
      var vis=groupRows.filter(function(r){return matches(r, key);});
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
        var b=el("td","numeric", sum<0 ? "("+Math.abs(sum).toLocaleString()+")" : sum.toLocaleString());
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
  if(kind!=="map"){
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

/* ---------- per-column filter row (Task-Management style) ---------- */
function injectColFilters(item){
  var tb=item.table, head=tb.tHead; if(!head||!head.rows.length) return;
  var EN9r0=tb.tBodies[0]&&tb.tBodies[0].rows[0];
  if(EN9r0 && !EN9r0.hasAttribute("data-en9") && EN9r0.cells.length!==head.rows[0].cells.length) return;
  var key=tkey(tb);
  if(head.querySelector("tr[data-en9]")) {
    var ins=head.querySelectorAll("tr[data-en9] input");
    for(var r0=0;r0<ins.length;r0++){ var i0=ins[r0].getAttribute("data-en9c");
      ins[r0].value=(S.cf[key]&&S.cf[key][i0])||""; }
    return;
  }
  var ths=head.rows[0].cells, fr=el("tr","en9-cfrow");
  var EN9h0=Math.max(0, head.rows[0].getBoundingClientRect().height||0);
  for(var i=0;i<ths.length;i++){
    var td=el("th");
    var name=(ths[i].textContent||"").trim();
    if(name){
      var inp=el("input"); inp.type="search"; inp.placeholder=name;
      inp.setAttribute("data-en9c",String(i));
      inp.value=(S.cf[key]&&S.cf[key][i])||"";
      (function(k2,idx,box){ box.addEventListener("input",function(){
        S.cf[k2]=S.cf[k2]||{}; S.cf[k2][idx]=box.value.toLowerCase();
        S.page[k2]=0; rebuildAll(); }); })(key,i,inp);
      td.appendChild(inp);
    }
    td.style.top=EN9h0+"px";
    fr.appendChild(td);
  }
  head.appendChild(fr);
}
function fixSticky(tb){ /* re-measure every pass: header heights vary per table/view */
  var head=tb.tHead; if(!head||!head.rows.length) return;
  var h0=Math.max(0, head.rows[0].getBoundingClientRect().height||0);
  var fr=head.querySelector("tr[data-en9]");
  if(fr) for(var i=0;i<fr.cells.length;i++) fr.cells[i].style.top=h0+"px";
  var band=Math.max(0, head.getBoundingClientRect().height||0)||h0;
  var gs=tb.querySelectorAll("tr.en9-group td");
  for(var j=0;j<gs.length;j++) gs[j].style.top=band+"px";
}
/* ---------- pagination bar for long tables ---------- */
function injectPager(item){
  if(item.kind==="map") return;
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
function enhanceSettingsSources(){
  var stacks=document.querySelectorAll(".view-stack");
  for(var i=0;i<stacks.length;i++){
    var st2=stacks[i];
    if((st2.textContent||"").indexOf("Every methodology, rule set, model and limit")===-1) continue;
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
  if(oc) items.push({label:"OCR a scanned PDF (Tesseract, beta)", sec:"Tools", kbd:"", run:function(){ oc.scrollIntoView({behavior:"smooth",block:"center"}); }});
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



/* ---------- OCR for scanned PDFs (Tesseract.js, free & open source) ---------- */
var EN9OCR={busy:false, result:null, io:null, stats:{runs:0,pages:0,words:0,fails:0}};
function en9IsSandbox(){ try{ return /claudeusercontent\.com|claude\.ai/.test(location.hostname); }catch(e){ return false; } }
function en9OcrFriendly(e){ var m=String(e&&e.message||e||"");
  if(/Failed to construct 'Worker'|blob-request|cannot be accessed from origin|Worker is not defined/i.test(m))
    return "This preview sandbox blocks background workers, so the OCR engine cannot start here. It runs normally on your deployed site (Netlify) or when the file is opened directly in a browser.";
  if(/Could not download/i.test(m))
    return m+" \u2014 check your network or ad-blocker; the open-source engine loads from cdn.jsdelivr.net on first use.";
  return m; }
try{ window.__EN9OCR=EN9OCR; window.__en9OcrRun=function(){ return en9OcrRun.apply(null,arguments); }; }catch(e){}
function en9LoadScript(u){ return new Promise(function(res,rej){
  var sc=document.createElement("script"); sc.src=u; sc.async=true;
  sc.onload=function(){res()}; sc.onerror=function(){rej(new Error("Could not download "+u))};
  document.head.appendChild(sc); }); }
EN9OCR.realIO={
  loadEngines:function(st){ 
    var chain=Promise.resolve();
    if(!window.pdfjsLib){ st("Downloading PDF renderer\u2026");
      chain=chain.then(function(){return en9LoadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js")})
        .then(function(){ window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js"; }); }
    if(!window.Tesseract){ chain=chain.then(function(){ st("Downloading Tesseract OCR engine (open source)\u2026");
      return en9LoadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"); }); }
    if(!window.PDFLib){ chain=chain.then(function(){ st("Downloading PDF writer\u2026");
      return en9LoadScript("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"); }); }
    return chain;
  },
  openPdf:function(buf){ return window.pdfjsLib.getDocument({data:buf}).promise; },
  renderPage:function(pdf,n){ return pdf.getPage(n).then(function(page){
    var v1=page.getViewport({scale:1}), sc=2.4, vp=page.getViewport({scale:sc});
    var cv=document.createElement("canvas"); cv.width=Math.ceil(vp.width); cv.height=Math.ceil(vp.height);
    return page.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise.then(function(){
      return {png:cv.toDataURL("image/png"), canvas:cv, scale:sc, w:v1.width, h:v1.height}; }); }); },
  makeWorker:function(langs,st){ return window.Tesseract.createWorker(langs,1,{logger:function(m){
      if(m.status==="recognizing text") st("Reading text\u2026 "+Math.round((m.progress||0)*100)+"%"); }}); },
  recognize:function(worker,pageimg){ return worker.recognize(pageimg.canvas).then(function(r){return r.data;}); },
  buildPdf:function(pages){ var PL=window.PDFLib;
    return PL.PDFDocument.create().then(function(doc){
      return pages.reduce(function(p,pg){ return p.then(function(){
        return doc.embedPng(pg.png).then(function(img){
          var page=doc.addPage([pg.w,pg.h]);
          page.drawImage(img,{x:0,y:0,width:pg.w,height:pg.h});
          (pg.words||[]).forEach(function(wd){
            if(!wd.text||!wd.bbox) return;
            var x=wd.bbox.x0/pg.scale, y1=wd.bbox.y1/pg.scale, hh=(wd.bbox.y1-wd.bbox.y0)/pg.scale;
            var size=Math.max(4,Math.min(40,hh*0.92));
            try{ page.drawText(wd.text,{x:x,y:pg.h-y1,size:size,opacity:0}); }catch(e){} });
        }); }); }, Promise.resolve()).then(function(){ return doc.save(); });
    }); }
};
function en9OcrRun(file,entityId,langs,st,done){
  if(EN9OCR.busy) return;
  EN9OCR.busy=true; EN9OCR.result=null;
  var io=EN9OCR.io||EN9OCR.realIO, worker=null;
  st("Preparing\u2026");
  io.loadEngines(st)
  .then(function(){ return file.arrayBuffer(); })
  .then(function(buf){ return io.openPdf(buf); })
  .then(function(pdf){
    return io.makeWorker(langs,st).then(function(w){ worker=w;
      var pages=[], chain=Promise.resolve();
      for(var n=1;n<=pdf.numPages;n++)(function(n2){
        chain=chain.then(function(){ st("Rendering page "+n2+" of "+pdf.numPages+"\u2026");
          return io.renderPage(pdf,n2).then(function(pg){
            st("Recognizing page "+n2+" of "+pdf.numPages+"\u2026");
            return io.recognize(worker,pg).then(function(data){
              pg.words=(data&&data.words)||[]; pg.canvas=null; pages.push(pg); }); }); });
      })(n);
      return chain.then(function(){ return pages; });
    });
  })
  .then(function(pages){
    var tw=pages.reduce(function(a,p){return a+(p.words?p.words.length:0);},0);
    if(!tw) throw new Error("No text could be recognized \u2014 the scan may be too poor. Try a clearer copy.");
    st("Building searchable PDF\u2026");
    return io.buildPdf(pages).then(function(bytes){
      var nm=String(file.name||"document.pdf").replace(/\.pdf$/i,"")+" (OCR).pdf";
      var f=new File([bytes],nm,{type:"application/pdf"});
      EN9OCR.result={file:f, entityId:entityId, pages:pages.length, words:tw};
      EN9OCR.stats.runs++; EN9OCR.stats.pages+=pages.length; EN9OCR.stats.words+=tw;
      st("Done \u2014 "+pages.length+" page(s), "+tw+" word(s) recognized.");
      done&&done(EN9OCR.result);
    });
  })
  .catch(function(e){ EN9OCR.stats.fails++; st("OCR failed: "+en9OcrFriendly(e)); done&&done(null); })
  .then(function(){ EN9OCR.busy=false; if(worker&&worker.terminate)try{worker.terminate()}catch(e){} });
}

function en9OcrIntakePdfs(entityId){ var s=st(), out=[]; if(!s) return out;
  var e=(s.entities||[]).find(function(x){return x.id===entityId;});
  (e&&e.files||[]).forEach(function(f){
    if(/\.pdf$/i.test(f.name||"")&&f.blob&&!/\(OCR\)\.pdf$/i.test(f.name)) out.push(f); });
  return out; }

function enhanceOcrPanel(){
  var dz=document.querySelector(".dropzone");
  var old=document.querySelector(".en9-ocr");
  if(!dz){ if(old)old.remove(); return; }
  if(old) { var sel0=old.querySelector("select"); en9OcrFillEntities(sel0); old.EN9_fillSrc&&old.EN9_fillSrc(); return; }
  var host=dz.closest("section.panel")||dz.parentElement; if(!host||!host.parentElement) return;
  var card=el("section","panel en9-ocr");
  card.appendChild(el("strong",null,"OCR a scanned PDF (beta) \u2014 Tesseract, free & open source"));
  card.appendChild(el("p","en9-ocr-sub","For image-only PDFs the parser refuses (\u201Cno text layer\u201D). This reads them with the open-source Tesseract engine and produces a searchable copy you can add to intake. The engine (~a few MB) is downloaded from cdn.jsdelivr.net on first use \u2014 your document itself never leaves this browser. Every figure from an OCR\u2019d document must be verified against the original: recognition can misread digits."));
  var row=el("div","en9-ocr-row");
  var sel=document.createElement("select"); sel.setAttribute("data-en9",""); en9OcrFillEntities(sel);
  var src=document.createElement("select"); src.setAttribute("data-en9",""); src.className="en9-ocr-src";
  var fi=document.createElement("input"); fi.type="file"; fi.accept=".pdf"; fi.setAttribute("data-en9","");
  function fillSrc(){ var cur=src.value;
    while(src.firstChild)src.removeChild(src.firstChild);
    var o0=document.createElement("option"); o0.value=""; o0.textContent="— choose a file from this computer —"; src.appendChild(o0);
    en9OcrIntakePdfs(sel.value).forEach(function(f){ var o=document.createElement("option");
      o.value=f.id; o.textContent="Already attached: "+f.name; src.appendChild(o); });
    if([...src.options].some(function(o){return o.value===cur;})) src.value=cur;
    fi.style.display=src.value?"none":""; }
  src.addEventListener("change",fillSrc);
  sel.addEventListener("change",fillSrc);
  card.EN9_fillSrc=fillSrc;
  var lg=el("label","en9-ocr-lang"); var cb=document.createElement("input"); cb.type="checkbox"; cb.checked=true; cb.setAttribute("data-en9","");
  lg.appendChild(cb); lg.appendChild(document.createTextNode(" Dutch + English (untick for English only)"));
  var btn=el("button","button en9-ocr-btn","Run OCR"); btn.type="button";
  row.appendChild(sel); row.appendChild(src); row.appendChild(fi); row.appendChild(lg); row.appendChild(btn);
  fillSrc();
  card.appendChild(row);
  if(en9IsSandbox()) card.appendChild(el("div","en9-ocr-sandbox","\u26A0 You are viewing this inside the claude.ai preview, which blocks the background workers OCR needs. Everything else works here \u2014 but run OCR on your deployed site (or open the downloaded HTML directly in your browser)."));
  var stat=el("div","en9-ocr-status"); card.appendChild(stat);
  var acts=el("div","en9-ocr-acts"); acts.style.display="none";
  var addb=el("button","button primary","Add to intake"); addb.type="button";
  var dlb=el("button","button","Download searchable PDF"); dlb.type="button";
  acts.appendChild(addb); acts.appendChild(dlb); card.appendChild(acts);
  card.appendChild(el("div","en9-ocr-note","Documents added this way are named \u201C\u2026 (OCR).pdf\u201D so every caption\u2019s source chip shows OCR provenance. Treat all extracted figures as unverified until checked."));
  btn.addEventListener("click",function(){
    var f=null;
    if(src.value){ var att=en9OcrIntakePdfs(sel.value).find(function(x){return x.id===src.value;});
      f=att&&att.blob||null;
      if(!f){ stat.textContent="That attached document is no longer available — choose the file from this computer instead."; return; } }
    else f=fi.files&&fi.files[0];
    if(!f){ stat.textContent="Pick an already-attached PDF from the dropdown, or choose a file from this computer."; return; }
    if(!sel.value){ stat.textContent="Choose the entity this document belongs to."; return; }
    acts.style.display="none";
    en9OcrRun(f,sel.value,cb.checked?"eng+nld":"eng",function(m){stat.textContent=m;},function(res){
      if(res) acts.style.display="";
    });
  });
  addb.addEventListener("click",function(){
    var r=EN9OCR.result; if(!r) return;
    if(window.__WPACT&&window.__WPACT.addFiles){ window.__WPACT.addFiles(r.entityId,[r.file]);
      stat.textContent="Added \u201C"+r.file.name+"\u201D to intake \u2014 run processing, then verify every figure against the original scan."; }
    else stat.textContent="Could not reach the intake action \u2014 download the PDF and drop it on the entity instead.";
  });
  dlb.addEventListener("click",function(){
    var r=EN9OCR.result; if(!r) return;
    var u=URL.createObjectURL(r.file), a=document.createElement("a");
    a.href=u; a.download=r.file.name; a.click(); setTimeout(function(){URL.revokeObjectURL(u)},4000);
  });
  host.parentElement.insertBefore(card, host);
}
function en9OcrFillEntities(sel){
  if(!sel) return; var s=st(); if(!s) return;
  var want=(s.entities||[]).map(function(e){return e.id+"|"+e.name;}).join(";");
  if(sel.getAttribute("data-en9opts")===want) return;
  sel.setAttribute("data-en9opts",want);
  while(sel.firstChild)sel.removeChild(sel.firstChild);
  (s.entities||[]).forEach(function(e){ var o=document.createElement("option");
    o.value=e.id; o.textContent=e.name; sel.appendChild(o); });
  if(s.activeEntityId) sel.value=s.activeEntityId;
}


/* ---------- Settings: OCR engine details, usage & pending verification ---------- */
function en9OcrDocs(){ var s=st(), out=[]; if(!s) return out;
  (s.entities||[]).forEach(function(e){ (e.files||[]).forEach(function(f){
    if(/\(OCR\)\.pdf$/i.test(f.name||"")) out.push({entity:e.name,name:f.name}); }); });
  return out; }
function enhanceOcrSettings(){
  var stacks=document.querySelectorAll(".view-stack"), host=null;
  for(var i=0;i<stacks.length;i++)
    if((stacks[i].textContent||"").indexOf("Every methodology, rule set, model and limit")>-1){ host=stacks[i]; break; }
  var old=document.querySelector(".en9-ocrset");
  if(!host){ if(old)old.remove(); return; }
  var card=old;
  if(!card){ card=el("section","panel en9-ocrset");
    var anchor=host.querySelector(".en9-sources");
    anchor&&anchor.nextSibling?host.insertBefore(card,anchor.nextSibling):host.appendChild(card); }
  while(card.firstChild)card.removeChild(card.firstChild);
  card.appendChild(el("strong",null,"OCR engine \u2014 Tesseract.js (free & open source)"));
  /* engine facts */
  var facts=el("div","en9-os-grid");
  [["Engine","Tesseract.js v5 \u2014 browser build of Google\u2019s Tesseract OCR"],
   ["License","Apache-2.0 \u00B7 free forever \u00B7 no account, no API key"],
   ["Companions","pdf.js 3.11.174 (page rendering) \u00B7 pdf-lib 1.17.1 (searchable-PDF output)"],
   ["Languages","English + Dutch by default; English-only option on the intake card"],
   ["Privacy","Recognition runs entirely in this browser \u2014 the document never leaves it. Engine code (~a few MB) downloads once from cdn.jsdelivr.net on first use, then is cached."]
  ].forEach(function(p){ var r=el("div","en9-os-row");
    r.appendChild(el("span","en9-os-k",p[0])); r.appendChild(el("span","en9-os-v",p[1])); facts.appendChild(r); });
  card.appendChild(facts);
  /* usage & quota */
  var stq=EN9OCR.stats, docs=en9OcrDocs();
  card.appendChild(el("h4","en9-os-h","Usage"));
  var ug=el("div","en9-os-grid");
  [["This session",stq.runs+" document(s) \u00B7 "+stq.pages+" page(s) \u00B7 "+stq.words.toLocaleString()+" word(s) recognized"+(stq.fails?" \u00B7 "+stq.fails+" failed run(s)":"")],
   ["Quota","Unlimited \u2014 open-source engine, nothing metered, nothing pending to renew"],
   ["OCR documents in this workpaper",docs.length?docs.length+" file(s) \u2014 ALL pending manual verification until each figure is checked against the original scan":"none yet"]
  ].forEach(function(p){ var r=el("div","en9-os-row");
    r.appendChild(el("span","en9-os-k",p[0])); r.appendChild(el("span","en9-os-v",p[1])); ug.appendChild(r); });
  card.appendChild(ug);
  if(docs.length){ var dl=el("div","en9-os-pending");
    docs.forEach(function(d2){ dl.appendChild(el("div","en9-auth-src",d2.entity+" \u2192 "+d2.name+" \u2014 verification pending")); });
    card.appendChild(dl); }
  /* how it works */
  card.appendChild(el("h4","en9-os-h","How it works"));
  var steps=el("ol","en9-os-list");
  ["Each page of the scanned PDF is rendered to a high-resolution image (2.4\u00D7) with pdf.js.",
   "Tesseract reads the image and returns every word with its exact position and a confidence score.",
   "pdf-lib rebuilds the document: the original page image with an invisible, position-accurate text layer underneath \u2014 the same approach as OCRmyPDF.",
   "The result is named \u201C\u2026 (OCR).pdf\u201D and can be added to intake; the normal parser then reads it like any digital PDF, and every caption\u2019s source chip carries the OCR provenance."
  ].forEach(function(x){ var li=document.createElement("li"); li.textContent=x; li.setAttribute("data-en9",""); steps.appendChild(li); });
  card.appendChild(steps);
  /* accepted files */
  card.appendChild(el("h4","en9-os-h","Accepted input"));
  card.appendChild(el("p","en9-os-p","PDF files only (.pdf) \u2014 specifically image-only scans the parser refuses with \u201Cno text layer\u201D. Digital PDFs don\u2019t need OCR (they parse directly). Photos (JPG/PNG) must be converted to PDF first. Best results: flat 300\u00A0dpi scans, straight pages, dark text on light background, machine-printed type. Not suitable for handwriting."));
  /* pros & cons */
  card.appendChild(el("h4","en9-os-h","Strengths & limits"));
  var pc=el("div","en9-os-2col");
  var pros=el("div","en9-os-pros"); pros.appendChild(el("strong",null,"Strengths"));
  ["Free and unlimited \u2014 no quota, no key, no cost",
   "Private \u2014 the document never leaves this browser",
   "100+ language support in the engine family; Dutch included here",
   "Position-accurate output, so the tool\u2019s table reconstruction works normally"
  ].forEach(function(x){ pros.appendChild(el("div","en9-auth-fact","\u2713 "+x)); });
  var cons=el("div","en9-os-cons"); cons.appendChild(el("strong",null,"Limits"));
  ["Recognition is probabilistic \u2014 digits can be misread (8\u21943, 1\u21947); every figure must be verified",
   "Complex or borderless tables can come out misaligned",
   "Poor, skewed, or low-contrast scans may fail or produce noise",
   "Handwriting is not supported",
   "First use downloads the engine (~a few MB) \u2014 needs a network connection that once"
  ].forEach(function(x){ cons.appendChild(el("div","en9-auth-miss","\u2013 "+x)); });
  pc.appendChild(pros); pc.appendChild(cons); card.appendChild(pc);
  card.appendChild(el("p","en9-os-foot","Values booked from an OCR\u2019d document are never treated as verified: the \u201C(OCR)\u201D name follows them through every source chip, evidence trace and export until you confirm them against the original."));
}

/* ---------- master pass ---------- */
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
    enhanceCategoryAuthority();
    enhanceSettingsSources();
    enhanceOcrSettings();
    enhanceTopbarHint();
    enhanceOcrPanel();
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
    if(r.width>0&&r.height>0){ ev.preventDefault(); ins[i].focus(); ins[i].select(); return; } }
});
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",schedule);
else schedule();
})();
