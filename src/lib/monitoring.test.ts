import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {ACTIONS,CATEGORIES,MONITORING_BACKEND,monitoringEnabled,sanitizeEvent,classifyFailure,outcomeCategory,outage} from './monitoringPolicy';
const sdk=vi.hoisted(()=>({init:vi.fn(),capture:vi.fn(),send:vi.fn(),flush:vi.fn()}));
vi.mock('@sentry/react',()=>({init:sdk.init,captureEvent:sdk.capture,makeFetchTransport:()=>({send:sdk.send,flush:sdk.flush})}));
import {createReporter,safeEnvelope,monitored,initMonitoring,reportMonitoring,beginMonitoring} from './monitoring';
const fixtureDsn='https://public-test-key@o0.ingest.sentry.io/1'; // parser fixture only; SDK always mocked
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();});
afterEach(()=>{vi.useRealTimers();});
describe('staging telemetry policy',()=>{
 it('requires exact staging AND DSN; production/unknown/missing/malformed are fully off',()=>{
  expect(monitoringEnabled(MONITORING_BACKEND,fixtureDsn)).toBe(true);
  for(const [backend,dsn] of [['production',fixtureDsn],['',fixtureDsn],[MONITORING_BACKEND,''],[MONITORING_BACKEND,undefined],[MONITORING_BACKEND,'not a DSN'],[MONITORING_BACKEND,'https://key:secret@host/1']]){
   expect(monitoringEnabled(backend,dsn)).toBe(false);expect(initMonitoring(backend,dsn)).toBe(false);
  }
  expect(sdk.init).not.toHaveBeenCalled();
 });
 it('reconstructs an allowlist and drops identities, secrets, URLs, arbitrary messages/frames and future fields',()=>{
  const secret='DO_NOT_SEND';
  const dirty={event_id:'a'.repeat(32),timestamp:10,tags:{action:'join',category:'server',nickname:secret},extra:{status:503,duration:14.7,password:secret,bootstrap:secret,token:secret,email:secret,body:secret},user:{email:secret,id:secret},request:{url:`https://host/?token=${secret}#${secret}`,data:secret},exception:{values:[{value:secret,stacktrace:{frames:[{filename:secret}]}}]},breadcrumbs:[{message:secret}],contexts:{trace:{data:secret}},message:secret,release:secret,future:secret};
  expect(sanitizeEvent(dirty)).toEqual({type:undefined,event_id:'a'.repeat(32),timestamp:10,environment:'staging',platform:'javascript',message:'decks.join.server',level:'error',fingerprint:['decks','join','server'],tags:{action:'join',category:'server'},extra:{status:503,duration:15}});
  expect(JSON.stringify(sanitizeEvent(dirty))).not.toContain(secret);
  expect(sanitizeEvent({tags:{action:secret,category:'server'}})).toBeNull();
  expect(sanitizeEvent({tags:{action:'join',category:secret}})).toBeNull();
 });
 it('drops spans, transactions, attachments, replay, profiles, sessions, logs, metrics and envelope trace metadata',()=>{
  const envelope:Parameters<typeof safeEnvelope>[0]=[{trace:{transaction:'SECRET'},dsn:'SECRET'},[
   [{type:'event'},{tags:{action:'vote',category:'server'},extra:{status:500},user:{email:'SECRET'}}],
   [{type:'transaction'},{type:'transaction',transaction:'SECRET'}],
   [{type:'attachment'},new Uint8Array([1,2])],
   [{type:'span'},{items:[{name:'SECRET'}]}],
   [{type:'session'},{sid:'SECRET'}],
  ] as Parameters<typeof safeEnvelope>[0][1]];
  const clean=safeEnvelope(envelope);
  expect(clean[0]).toEqual({});expect(clean[1]).toHaveLength(1);expect(JSON.stringify(clean)).not.toContain('SECRET');
  expect(safeEnvelope([{},[[{type:'event'},{message:'arbitrary failure'}]]])).toEqual([{},[]]);
 });
 it.each(['cooldown','blocked','invalid_track','invalid_input','unavailable','duplicate','ended','event_ended','explicit_not_allowed','rate_limited'])('does not treat %s as an outage',code=>{
  expect(classifyFailure({code}).category).toBe('business_rejection');expect(outage(classifyFailure({code}).category)).toBe(false);
 });
 it.each([400,401,403,404,409,422,429])('excludes expected HTTP %s rejection',status=>expect(outage(classifyFailure({status}).category)).toBe(false));
 it('detects actual 5xx/transport even when a business code or arbitrary raw message exists',()=>{
  expect(classifyFailure({status:503,code:'cooldown',message:'private'})).toEqual({category:'server',status:503});
  expect(classifyFailure({context:new Response(null,{status:502})})).toEqual({category:'server',status:502});
  expect(classifyFailure({code:'57014'}).category).toBe('server');
  expect(classifyFailure(new TypeError('private')).category).toBe('transport');
  expect(classifyFailure({name:'RateLimitedError'})).toEqual({category:'business_rejection',status:429});
  expect(outcomeCategory('already_supported')).toBe('business_rejection');
  expect(outcomeCategory('created')).toBe('success');expect(outcomeCategory('error')).toBe('invalid_response');
 });
 it('does not read raw message/details/body getters',()=>{
  const error={status:503,get message(){throw Error('must not read');},get body(){throw Error('must not read');}};
  expect(classifyFailure(error)).toEqual({category:'server',status:503});
 });
});
describe('nonblocking and bounded reporting',()=>{
 it('is off by default and never sends when disabled',()=>{
  const send=vi.fn(),report=createReporter(send,false);report({action:'join',category:'server'});vi.runAllTimers();expect(send).not.toHaveBeenCalled();
 });
 it('bounds queue/rate and deduplicates storms without persistence or retries',()=>{
  const send=vi.fn(),report=createReporter(send,true);
  for(let i=0;i<1000;i++)report({action:'snapshot',category:'server'});
  for(const action of ACTIONS)for(const category of CATEGORIES)report({action,category});
  expect(send).not.toHaveBeenCalled();vi.runAllTimers();expect(send).toHaveBeenCalledTimes(10);
  report({action:'join',category:'server'});vi.runAllTimers();expect(send).toHaveBeenCalledTimes(10);
  vi.advanceTimersByTime(60000);report({action:'join',category:'server'});vi.runAllTimers();expect(send).toHaveBeenCalledTimes(11);
 });
 it('preserves return reference and thrown error identity; reporter throws have no impact',async()=>{
  const result={ok:true},error=new TypeError('private');
  await expect(monitored('join',async()=>result)).resolves.toBe(result);
  await expect(monitored('vote',async()=>{throw error;})).rejects.toBe(error);
  const send=vi.fn(()=>{throw Error('Sentry down');}),report=createReporter(send,true);report({action:'join',category:'server'});expect(()=>vi.runAllTimers()).not.toThrow();expect(send).toHaveBeenCalledTimes(1);
 });
 it('initializes only opted-in SDK with final privacy hooks and no automatic integrations',async()=>{
  expect(initMonitoring(MONITORING_BACKEND,fixtureDsn)).toBe(true);
  const options=sdk.init.mock.calls[0][0];
  expect(options).toMatchObject({environment:'staging',defaultIntegrations:false,integrations:[],sendDefaultPii:false,maxBreadcrumbs:0,tracesSampleRate:0,tracePropagationTargets:[],sendClientReports:false});
  expect(options.beforeBreadcrumb({message:'secret'})).toBeNull();expect(options.beforeSendTransaction({})).toBeNull();expect(options.beforeSend({message:'secret'})).toBeNull();
  const transport=options.transport({url:'mock-only'});await transport.send([{},[[{type:'attachment'},new Uint8Array()]]]);expect(sdk.send).not.toHaveBeenCalled();
  reportMonitoring('synthetic','server',10,503);expect(sdk.capture).not.toHaveBeenCalled();vi.runAllTimers();expect(sdk.capture).toHaveBeenCalledWith({tags:{action:'synthetic',category:'server'},extra:{status:503,duration:10}});
  sdk.capture.mockClear();const finish=beginMonitoring('vote');vi.advanceTimersByTime(4000);finish('business_rejection',429);vi.runAllTimers();expect(sdk.capture).not.toHaveBeenCalled();
 });
});