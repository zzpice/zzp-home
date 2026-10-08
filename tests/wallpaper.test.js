import {test} from 'node:test';
import assert from 'node:assert/strict';
import {dayNumber,dailyWallpaper,backgroundCandidates,validateIndex,preference} from '../web/wallpaper.js';
import {browseGroups,assertValid,clone} from '../web/model.js';
import fs from 'node:fs';
const item=(name,width=1920,height=1080,device='desktop')=>({path:`wallpapers/landscape/${width}x${height}/${name}.jpg`,title:name,width,height,device,sha:'a'.repeat(40),background:`app/previews/${name}-background-1234567890.webp`});
test('daily wallpaper changes at UTC+8 midnight and is independent of input order',()=>{
 const before=Date.parse('2026-10-09T15:59:59Z'), after=Date.parse('2026-10-09T16:00:00Z');
 assert.equal(dayNumber(before)+1,dayNumber(after));
 const items=[item('b'),item('a'),item('phone',1440,3120,'phone')];
 assert.equal(dailyWallpaper(items,before).path,dailyWallpaper([...items].reverse(),before).path);
 assert.notEqual(dailyWallpaper(items,before).path,dailyWallpaper(items,after).path);
 assert.equal(backgroundCandidates(items).length,2);
 assert.equal(dailyWallpaper([items[2]]),null);
});
test('index and fixed preference reject traversal, unknown modes, and arbitrary URLs',()=>{
 const valid=item('valid'), invalid={...valid,path:'wallpapers/../../secret.png'};
 assert.deepEqual(validateIndex({version:1,wallpapers:[invalid,valid,valid]}),[valid]);
 assert.equal(preference({mode:'fixed',path:'https://example.com/a.jpg'}).mode,'shared');
 assert.equal(preference({mode:'fixed',path:valid.path}).mode,'fixed');
 assert.throws(()=>validateIndex({version:2,wallpapers:[]}));
});
test('adult browsing filter protects cards and pins while preserving all editor data',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('fixtures/navigation.json',import.meta.url)));
 const adult={...clone(config.groups[0].sites[0]),id:'adult-example',icon:'icons/adult/example.png',pinned:true};
 config.groups.push({id:'adult',title:'成人内容',sites:[adult]});
 const moved={...adult,id:'adult-moved'};config.groups[0].sites.push(moved);
 const before=JSON.stringify(config), visible=browseGroups(config);
 assert.ok(!visible.some(group=>group.id==='adult'));
 assert.ok(!visible.flatMap(group=>group.sites).some(site=>site.id.startsWith('adult-')));
 assert.equal(JSON.stringify(config),before);
 assert.deepEqual(browseGroups(config,true),config.groups);
});
test('shared wallpaper is optional and keeps the existing GitHub settings schema compatible',()=>{
 const baseline=JSON.parse(fs.readFileSync(new URL('fixtures/navigation.json',import.meta.url)));
 assertValid(baseline);
 for(const mode of ['daily','fixed','bing','off']) {const config=clone(baseline);config.settings.wallpaper={mode,path:mode==='fixed'?item('test').path:''};assertValid(config);}
 for(const wallpaper of [null,{mode:'arbitrary',path:''},{mode:'fixed',path:'../bad.jpg'},{mode:'daily',path:'' ,token:'unsafe'}]){const config=clone(baseline);config.settings.wallpaper=wallpaper;assert.throws(()=>assertValid(config));}
});
