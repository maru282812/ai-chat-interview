import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProjectManagement, managementIdentity } from '../lib/projectManagement';
import { matchesProjectFilter, parseProjectListFilter } from '../lib/projectListFilter';

test('manual numbers accept zero padding and more than four digits', () => {
  assert.deepEqual(parseProjectManagement({confirmed_number:'0001', management_year:'2026', survey_purpose:'monitor'}),
    {confirmed_number:1, management_year:2026, survey_purpose:'monitor'});
  assert.equal(parseProjectManagement({confirmed_number:'10000'}).confirmed_number,10000);
  for (const n of ['0','-1','1.2','1e3','1x','2147483648']) assert.throws(() => parseProjectManagement({confirmed_number:n}));
  assert.throws(() => parseProjectManagement({survey_purpose:'public'}));
  assert.throws(() => parseProjectManagement({management_year:'99'}));
});
test('legacy callers preserve fields; explicit blanks clear them', () => {
  assert.deepEqual(parseProjectManagement({}), {});
  assert.deepEqual(parseProjectManagement({confirmed_number:'', survey_purpose:''}), {confirmed_number:null, survey_purpose:null});
});
test('exact number search combines client and year without substring collisions', () => {
  const p = {name:'2026-C0001-0001_水族館',client_id:'c1',survey_purpose:'monitor'};
  const f = parseProjectListFilter({confirmed_number:'1',client:'c1',management_year:'2026',company_code:'c0001',survey_purpose:'monitor'});
  assert.equal(matchesProjectFilter(p,f),true);
  assert.equal(matchesProjectFilter({...p,name:'2026-C0001-0010_水族館'},f),false);
  assert.equal(matchesProjectFilter({...p,client_id:'c2'},f),false);
  assert.equal(matchesProjectFilter(p,parseProjectListFilter({confirmed_number:'0001'})),true);
  assert.equal(matchesProjectFilter(p,parseProjectListFilter({confirmed_number:'1x'})),false);
});
test('structured identity takes precedence; unrelated names are not parsed', () => {
  assert.equal(managementIdentity({name:'2026-C0001-0001_旧',confirmed_number:2}).number,2);
  assert.equal(managementIdentity({name:'案件1'}).number,null);
  assert.equal(matchesProjectFilter({name:'旧案件'},parseProjectListFilter({survey_purpose:'none'})),true);
  assert.equal(matchesProjectFilter({name:'旧案件'},parseProjectListFilter({confirmed_number:'1'})),false);
});
