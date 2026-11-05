const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('main.js','utf8'); const fn=src.slice(src.indexOf('function installPanelDrag('),src.indexOf('\nclass QuickAskSettingsTab',src.indexOf('function installSelectionAsk(')));
class El {constructor(){this.nodeType=1;this.children=[];this.style={};this.listeners={};this.offsetWidth=200;this.offsetHeight=50;this.classList={contains:()=>false,add(){},remove(){}};} append(...es){for(const e of es){e.parent=this;this.children.push(e)}} appendChild(e){this.append(e)} replaceChildren(...es){this.children=[];this.append(...es)} remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)} setAttribute(){} addEventListener(k,f){this.listeners[k]=f} contains(e){return e===this||this.children.some(c=>c.contains(e))} closest(){return this.markdown?this:null} }
let selectionNode=new El();selectionNode.markdown=true; let selected='first', file='first.md';
const doc={body:new El(),defaultView:{innerWidth:1000,innerHeight:800},createElement(){const e=new El();e.ownerDocument=doc;return e},getSelection(){let n=selectionNode;return {toString:()=>selected,rangeCount:1,getRangeAt:()=>({startContainer:n,endContainer:n,getBoundingClientRect:()=>({left:40,bottom:50,width:80,height:20})})}}};
let mouseup,send=[],finish=[],timers=[], snap={};const staged=[];
const plugin={settings:{values:()=>({quickAsk:{}})},app:{workspace:{iterateAllLeaves:cb=>cb({view:{getViewType:()=> 'markdown',file:{path:file},containerEl:{contains:n=>n===selectionNode}}})}},quickAsk:{environment:{ui:{renderMarkdown:async(e,t)=>{e.textContent=t},clear(){}}},isRegistered:()=>true,trackerFor:id=>({stageFile:path=>(staged.push(path),{staged:true}),mutationsForSend:async()=>[{kind:'file',path:file,text:'note'}]}),sessionStore:{createSession:async()=>({id:String(send.length+1)})},conversation:{load:async()=>{},snapshot:()=>snap,send:(id,q,options)=>{send.push({id,q,options});return new Promise(r=>finish.push(r))}}},registerDomEvent:(_,name,f)=>{if(name==='mouseup')mouseup=f},register:()=>{}};
const ctx={document:doc,window:{innerWidth:1000,innerHeight:800,setTimeout:f=>f()},AbortController,require:()=>({sessionConfigSnapshot:x=>x}),setInterval:f=>(timers.push(f),timers.length),clearInterval(){},setTimeout:f=>{f();return 1},clearTimeout(){}};
vm.runInNewContext(fn+';this.installSelectionAsk=installSelectionAsk',ctx);ctx.installSelectionAsk(plugin);
const clickToolbar=()=>doc.body.children.find(x=>x.className==='quick-ask-selection-toolbar').children[0].listeners.click();const getPanel=()=>doc.body.children.find(x=>x.className==='quick-ask-selection-panel');
(async()=>{
 const step=()=>new Promise(setImmediate);
 mouseup({target:selectionNode});clickToolbar();await step();
 snap={text:'ANSWER_A'};timers[0]();await step();
 let cols=getPanel().children[1].children;
 selected='a-child';selectionNode=cols[0].children[1];mouseup({target:selectionNode});clickToolbar();await step();
 assert(send[1].q.includes('ANSWER_A'));snap={text:'ANSWER_B'};timers[1]();await step();
 cols=getPanel().children[1].children;selected='b-child';selectionNode=cols[1].children[1];mouseup({target:selectionNode});clickToolbar();await step();
 assert(send[2].q.includes('ANSWER_B'));snap={text:'ANSWER_C'};timers[2]();await step();
 cols=getPanel().children[1].children;assert.equal(cols.length,3);selected='a-again';selectionNode=cols[0].children[1];mouseup({target:selectionNode});clickToolbar();await step();
 cols=getPanel().children[1].children;assert.equal(cols.length,4);assert.deepEqual(cols.slice(0,3).map(c=>c.children[1].children[0].textContent),['ANSWER_A','ANSWER_B','ANSWER_C']);assert(send[3].q.includes('ANSWER_A'));assert(!send[3].q.includes('ANSWER_B'));assert(!send[3].q.includes('ANSWER_C'));
 snap={text:'ANSWER_D'};timers[3]();await step();cols=getPanel().children[1].children;selected='b-again';selectionNode=cols[1].children[1];mouseup({target:selectionNode});clickToolbar();await step();
 assert.equal(getPanel().children[1].children.length,5);assert(send[4].q.includes('ANSWER_B'));assert(!send[4].q.includes('ANSWER_D'));assert(send[3].options.signal.aborted);
 finish[3]({status:'complete'});await step();assert.equal(getPanel().children[1].children.length,5);
 getPanel().children[0].children[0].listeners.click();assert(send[4].options.signal.aborted);assert(!getPanel());
 console.log('PASS appended branches, parent context, cancellation and stale completion');
})().catch(e=>{console.error(e);process.exitCode=1});
