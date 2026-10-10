import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync,existsSync,rmSync} from 'node:fs';
rmSync('dist',{recursive:true,force:true});
for(const args of [['tsc','--noEmit'],['vite','build','--config','vite.hosting.config.ts']]){
 const r=spawnSync('npx',args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status??1);
}
// Sites consumes the Worker ESM entry and separate client assets.
mkdirSync('dist/.openai',{recursive:true});cpSync('.openai/hosting.json','dist/.openai/hosting.json');
if(!existsSync('dist/server/index.js'))throw Error('Missing deployable Worker entry');
