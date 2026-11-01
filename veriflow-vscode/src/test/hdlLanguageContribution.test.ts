import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for(const [id,extensions] of [
 ['verilog',['.v','.vh','.vl']],
 ['systemverilog',['.sv','.svh','.SV']],
 ['sdc',['.sdc']],
 ['xdc',['.xdc']],
] as const){
 const language=manifest.contributes.languages.find((item:any)=>item.id===id);assert.ok(language,`${id} is registered`);assert.deepEqual(language.extensions,extensions);
 const configuration=language.configuration ? JSON.parse(fs.readFileSync(path.join(root,language.configuration),'utf8')) : undefined;
 assert.ok(configuration);
 if (id === 'sdc' || id === 'xdc') assert.equal(configuration.comments.lineComment,'#');
 else { assert.equal(configuration.comments.lineComment,'//'); assert.deepEqual(configuration.comments.blockComment,['/*','*/']); }
 const grammar=manifest.contributes.grammars.find((item:any)=>item.language===id);assert.ok(grammar);
 const source=JSON.parse(fs.readFileSync(path.join(root,grammar.path),'utf8'));assert.equal(source.scopeName,grammar.scopeName);assert.ok(source.patterns.length);
}
for(const [language,pathName] of [['verilog','./snippets/verilog.json'],['systemverilog','./snippets/systemverilog.json']] as const){
 const snippet=manifest.contributes.snippets.find((item:any)=>item.language===language && item.path===pathName);
 assert.ok(snippet,`${language} snippets are registered`);
 const source=JSON.parse(fs.readFileSync(path.join(root,pathName),'utf8'));
 assert.ok(Object.keys(source).length > 0,`${language} snippets are not empty`);
}
console.log('HDL native language registration/configuration/grammar assets passed');
