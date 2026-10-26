import assert from 'node:assert/strict';
import { test, before, afterEach } from 'node:test';
import type { Request, Response } from 'express';
let controller: typeof import('../controllers/adminController').adminController;
let clients: typeof import('../repositories/clientRepository').clientRepository;
let stores: typeof import('../repositories/storeRepository').storeRepository;
let provisioning: typeof import('../services/storeProvisioningService').storeProvisioningService;
let originals: any;
before(async () => {
  ({adminController:controller} = await import('../controllers/adminController'));
  ({clientRepository:clients} = await import('../repositories/clientRepository'));
  ({storeRepository:stores} = await import('../repositories/storeRepository'));
  ({storeProvisioningService:provisioning} = await import('../services/storeProvisioningService'));
  originals={get:clients.getById,list:clients.list,createClient:clients.create,createStore:stores.create,provision:provisioning.provisionStore};
});
afterEach(() => {clients.getById=originals.get;clients.list=originals.list;clients.create=originals.createClient;stores.create=originals.createStore;provisioning.provisionStore=originals.provision;});
function response() { let url='';return {res:{redirect:(s:string)=>{url=s;}} as Response,url:()=>url}; }
test('store registration does not need an industry and does not generate surveys', async()=>{
  clients.getById=async()=>({id:'client',name:'Client',contact:null,created_at:''});
  let inserted:any;
  stores.create=async(input)=>{inserted=input;return {id:'store',...input} as any;};
  provisioning.provisionStore=async()=>{throw new Error('must not generate ABC');};
  const out=response();
  await controller.createStore({body:{creation_mode:'register',client_id:'client',name:'施設',code_slug:'facility'}} as Request,out.res);
  assert.equal(inserted.industry_template_id,null);
  assert.equal(inserted.client_id,'client');
  assert.match(out.url(),/\?msg=/);
});
test('ABC generation still requires its template',async()=>{
  let called=false; provisioning.provisionStore=async()=>{called=true;return {} as any;};
  const out=response();await controller.createStore({body:{creation_mode:'abc',client_id:'client',name:'施設',code_slug:'facility'}} as Request,out.res);
  assert.equal(called,false);assert.match(out.url(),/\?err=/);
});
test('client-only registration stores code without requiring a store',async()=>{
  clients.list=async()=>[];let inserted:any;
  clients.create=async(input)=>{inserted=input;return {id:'client',...input} as any;};
  const out=response();await controller.createClient({body:{name:'依頼元',company_code:'c0001',return_to:'/admin/stores'}} as Request,out.res);
  assert.equal(inserted.company_code,'C0001');assert.match(out.url(),/^\/admin\/stores\?msg=/);
});
test('duplicate client names are reported without creating another',async()=>{
  clients.list=async()=>[{id:'client',name:'依頼元',contact:null,created_at:''}];
  clients.create=async()=>{throw new Error('must not duplicate');};
  const out=response();await controller.createClient({body:{name:'依頼元',return_to:'https://example.com'}} as Request,out.res);
  assert.match(out.url(),/^\/admin\/store-surveys\?err=/);
});
