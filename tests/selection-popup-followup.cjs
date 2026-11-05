const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync('main.js','utf8'); const fn=src.slice(src.indexOf('function installPanelDrag('),src.indexOf('\nclass QuickAskSettingsTab',src.indexOf('function installSelectionAsk(')));
class El {constructor(){this.nodeType=1;this.value='';this.children=[];this.style={};this.listeners={};this.offsetWidth=200;this.offsetHeight=50;this.classList={contains:()=>false,add(){},remove(){}};} append(...es){for(const e of es){e.parent=this;this.children.push(e)}} appendChild(e){this.append(e)} replaceChildren(...es){this.children=[];this.append(...es)} remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)} getBoundingClientRect(){return {left:40,bottom:50,width:80,height:20}} setAttribute(){} addEventListener(k,f){this.listeners[k]=f} contains(e){return e===this||this.children.some(c=>c.contains(e))} closest(){return this.markdown?this:null} }
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

 let cols=getPanel().children[1].children; let form=cols[0].children[3], input=form.children[0], button=form.children[1];
 assert(input.disabled);assert(button.disabled);input.value='why';input.listeners.input();assert(button.disabled);
 snap={text:'ANSWER_A'};timers[0]();await step();assert(!input.disabled);assert(!button.disabled);
 input.value='   ';input.listeners.input();assert(button.disabled);button.listeners.click();await step();assert.equal(send.length,1);
 input.value='请解释原理';input.listeners.input();assert(!button.disabled);let prevented=false;
 input.listeners.keydown({key:'Enter',isComposing:true,preventDefault(){prevented=true}});assert(!prevented);assert.equal(send.length,1);
 input.listeners.keydown({key:'Enter',isComposing:false,preventDefault(){prevented=true}});await step();assert(prevented);assert.equal(send.length,2);
 assert(send[1].q.includes('请解释原理'));assert(send[1].q.includes('ANSWER_A'));assert(send[1].q.includes('600'));assert(send[0].options.signal.aborted);
 assert.equal(getPanel().children[1].children.length,2);
 getPanel().children[0].children[0].listeners.click();assert(send[1].options.signal.aborted);
 console.log('PASS follow-up input, disabled state, IME and parent context');
})().catch(e=>{console.error(e);process.exitCode=1});
