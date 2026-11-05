const fs = require('fs'),vm = require('vm'), assert = require('assert');
const source = fs.readFileSync('main.js','utf8');
const a = source.indexOf('async function saveSelectionConversation('), b = source.indexOf('// A compact, independent explanation',a);
const context = {};vm.runInNewContext(source.slice(a,b)+'; this.save=saveSelectionConversation;',context);
const seen = new Map();let creates = 0;const vault={getAbstractFileByPath:p=>seen.has(p)?{}:null,async create(p,c){creates++;if(seen.has(p))throw Error('exists');seen.set(p,c)}};
(async()=>{
 const input=[{question:'初始\n选中',answer:'第一条',parentIndex:null,status:'complete'},{question:'问题',answer:'第二条',parentIndex:0,status:'running'},{question:'第三',answer:'',parentIndex:0,status:'stopped'}];
 const path=await context.save({app:{vault}},'folder/note.md',input);
 assert(path.startsWith('folder/note - AI解释 '));assert(path.endsWith('.md'));let contents=seen.get(path);
 assert(contents.includes('> 初始\n> 选中'));assert(contents.includes('上级解释：第 1 条'));assert(contents.includes('状态：生成中'));assert(contents.includes('状态：已停止'));assert(contents.includes('（暂无回答）'));
 const second=await context.save({app:{vault}},'folder/note.md',input);assert.notEqual(path,second);assert.equal(creates,2);
 await assert.rejects(()=>context.save({app:{vault}},'note.md',[{answer:''}]),/暂无/);
 let denies={getAbstractFileByPath:()=>null,create:async()=>{throw Error('permission')}};await assert.rejects(()=>context.save({app:{vault:denies}},'note.md',input),/permission/);
 assert(source.includes("save.addEventListener('click', async"));
 console.log('PASS save path, collision, branch metadata, incomplete status, errors');
})().catch(e=>{console.error(e);process.exitCode=1});
