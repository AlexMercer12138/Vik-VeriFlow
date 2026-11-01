import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path'; import test from 'node:test';
import { newPhysicalBoard, physicalBoardFile, readPhysicalBoardFile, UserPhysicalBoardLibrary } from '../src/physical/boardLibrary';
test('board files are JSON-only with stable identities and conflict-safe library writes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vf-template-library-'));
 try{const file=path.join(root,'board.json'),configPath=path.join(root,'config.json');await writeFile(configPath,'{"custom":true}');
 const created=newPhysicalBoard('Carrier','board','.custom');assert.match(created.id,/^[0-9a-f-]{36}$/);
 created.model.pins={tx:'opaque {signal name} A1'};created.model.interfaces=[{id:'UART',signals:[{id:'tx',direction:'output',pins:['tx']}]}];
 await writeFile(file,JSON.stringify(physicalBoardFile(created)));assert.deepEqual(await readPhysicalBoardFile(file),created);
 await writeFile(path.join(root,'board.xdc'),'not a board');await assert.rejects(readPhysicalBoardFile(path.join(root,'board.xdc')),/JSON/i);
 const library=new UserPhysicalBoardLibrary({configPath});await library.importBoard(file);const before=library.get(created.id);library.saveBoard({...before,name:'Renamed'},before);assert.equal(library.get(created.id).id,created.id);assert.equal(JSON.parse(await readFile(configPath,'utf8')).custom,true);assert.equal(JSON.parse(await readFile(configPath+'.bak','utf8')).custom,true);
 assert.throws(()=>library.saveBoard({...before,name:'Stale'},before),/changed|outside/);await assert.rejects(library.importBoard(file),/exists/);
 }finally{await rm(root,{recursive:true,force:true});}
});
