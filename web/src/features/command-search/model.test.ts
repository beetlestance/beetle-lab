import {expect,it} from 'vitest';
import {searchContext,navigation,matching} from './model.js';
import {routes} from '../../app/routes.js';
const org='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const workspace='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
it('derives only exact validated route namespaces and never partially adopts a bad workspace',()=>{
 expect(searchContext(routes.workspace(org,workspace))).toEqual({organizationId:org,workspaceId:workspace});
 expect(searchContext(routes.runs(org.toUpperCase(),workspace.toUpperCase()))).toEqual({organizationId:org,workspaceId:workspace});
 expect(searchContext(routes.organization(org))).toEqual({organizationId:org});
 for(const value of [routes.workspace(org,'bad'),routes.workspace('bad',workspace),'/other'+routes.workspace(org,workspace),routes.reference])expect(searchContext(value)).toEqual({});
 expect(navigation({}).map(item=>item.path)).toEqual([routes.organizations,routes.settings,routes.reference]);
});
it('bounds result display and literal query work without hiding the full matching count',()=>{
 const items=Array.from({length:310},(_,index)=>({id:String(index),label:'Suite '+index,description:'Suite',path:'/suites/'+index}));
 expect(matching(items,'suite')).toMatchObject({total:310});expect(matching(items,'suite').items).toHaveLength(40);
 expect(matching(items,'[')).toEqual({items:[],total:0});expect(matching(items,'x'.repeat(10000))).toEqual({items:[],total:0});
});
