const fs=require('fs'),vm=require('vm'),assert=require('assert');
const {normalizeSources}=require('../src/quick-ask/web-search');
const src=fs.readFileSync('main.js','utf8');const fn=src.slice(src.indexOf('function installPanelDrag('),src.indexOf('\nclass QuickAskSettingsTab',src.indexOf('function installSelectionAsk(')));
class El { constructor(){this.nodeType=1;this.value='';this.children=[];this.style={};this.listeners={};this.offsetWidth=200;this.offsetHeight=50;this.classList={contains:()=>false,add(){},remove(){}};} append(...es){for(const e of es){e.parent=this;this.children.push(e)}} appendChild(e){this.append(e)} replaceChildren(...es){this.children=[];this.append(...es)} remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)} getBoundingClientRect(){return {left:40,bottom:50,width:80,height:20}} setAttribute(){} addEventListener(k,f){this.listeners[k]=f} contains(e){return e===this||this.children.some(c=>c.contains(e))} closest(){return this.markdown?this:null} }
function setup(available) {
 let selectionNode=new El();selectionNode.markdown=true;let mouseup,ticks=[],jobs=[],sends=[],snap={},finish,listener,unsubscribed=false,rendered=[];
 const doc={body:new El(),defaultView:{innerWidth:1000,innerHeight:800},createElement(){const e=new El();e.ownerDocument=doc;return e},getSelection(){return {toString:()=> 'subject',rangeCount:1,getRangeAt:()=>({startContainer:selectionNode,endContainer:selectionNode,getBoundingClientRect:()=>({left:40,bottom:50,width:80,height:20})})}}};
 const plugin={settings:{values:()=>({quickAsk:{}})},app:{workspace:{iterateAllLeaves:cb=>cb({view:{getViewType:()=> 'markdown',file:{path:'note.md'},containerEl:{contains:n=>n===selectionNode}}})}},quickAsk:{environment:{ui:{renderMarkdown:async(e,t)=>{rendered.push(t);e.textContent=t},clear(){}}},isRegistered:()=>true,trackerFor:()=>({stageFile:()=>({staged:true}),mutationsForSend:async()=>[{kind:'file',path:'note.md',text:'note'}]}),sessionStore:{createSession:async()=>({id:'1'})},conversation:{load:async()=>{},validateSearchForSend:(_id,enabled)=>({valid:available&&enabled,route:{kind:available?'local':'invalid'}}),subscribe:(_id,cb)=>(listener=cb,()=>{unsubscribed=true}),snapshot:()=>snap,send:(_id,q,options)=>(sends.push({q,options}),new Promise(resolve=>{finish=resolve}))}},registerDomEvent:(_,name,f)=>{if(name==='mouseup')mouseup=f},register:()=>{}};
 const ctx={document:doc,window:{innerWidth:1000,innerHeight:800,setTimeout:f=>f()},AbortController,require:name=>name.endsWith('/web-search')?{normalizeSources}:{sessionConfigSnapshot:x=>x},setInterval:f=>(ticks.push(f),ticks.length),clearInterval(){},setTimeout:f=>(jobs.push(f),jobs.length),clearTimeout(){}};
 vm.runInNewContext(fn+';this.installSelectionAsk=installSelectionAsk',ctx);ctx.installSelectionAsk(plugin);
 const panel=()=>doc.body.children.find(e=>e.className==='quick-ask-selection-panel');
 return {open(){mouseup({target:selectionNode});doc.body.children.find(x=>x.className==='quick-ask-selection-toolbar').children[0].listeners.click()},panel,sends,setSnap:x=>snap=x,tick:()=>ticks[0](),finish:x=>finish(x),emit:x=>listener?.({projection:x}),flush:()=>{while(jobs.length)jobs.shift()()},get rendered(){return rendered},get unsubscribed(){return unsubscribed}};
}
const step=()=>new Promise(setImmediate);
(async()=>{
 const run=setup(true);run.open();await step();
 assert.equal(run.sends[0].options.webSearch,false);
 assert(run.sends[0].q.includes('1. 是什么'));
 assert(run.sends[0].q.includes('2. 为什么设计'));
 assert(run.sends[0].q.includes('3. 如何用'));
 assert(run.sends[0].q.includes('不要猜测或声称已联网查证'));
 const raw='答案\n<!--QA_SUGGESTIONS-->["甲？","乙？","丙？"]';
 run.setSnap({text:raw});run.tick();run.flush();await step();run.finish({status:'complete'});await step();run.flush();await step();
 assert(run.rendered.includes('答案'));
 assert.deepEqual(run.panel().children[1].children[0].children[2].children.map(x=>x.textContent),['甲？','乙？','丙？']);
 console.log('PASS structured popup answer, explicit web search off and suggestions');
})().catch(e=>{console.error(e);process.exitCode=1});
