const fs = require('fs'), vm = require('vm'), assert = require('assert');
const s=fs.readFileSync('main.js','utf8');
const start=s.indexOf('const QUICK_ASK_SUGGESTION_MARKER'); const end=s.indexOf('// A compact, independent explanation',start);
const ctx={}; vm.runInNewContext(s.slice(start,end)+';this.split=splitQuickAskOutput;',ctx);
const marker='\n<!--QA_SUGGESTIONS-->'; const content='这是回答。';
for(let i=0;i<marker.length;i++){const v=ctx.split(content+marker.slice(0,i),false);assert.equal(v.text,content);assert.equal(v.suggestions.length,0)}
const raw=content+marker+'["问题一？","问题二？","问题三？"]';
assert.equal(ctx.split(raw,false).text,content);assert.equal(ctx.split(raw,false).suggestions.length,0);
const complete=ctx.split(raw,true);assert.equal(complete.text,content);assert.deepEqual(Array.from(complete.suggestions),['问题一？','问题二？','问题三？']);
assert.equal(ctx.split(content+marker+'oops',true).suggestions.length,0);assert.equal(ctx.split(content,true).text,content);
console.log('PASS streaming marker concealment, generated suggestions, malformed fallback');
