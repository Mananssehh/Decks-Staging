import {describe,it,expect,vi} from 'vitest';
import {createRequestVisibility} from './requestVisibility';
import {recordSnapshotStart,snapshotReadStarted} from './snapshotEvidence';
describe('evidence-only request observation',()=>{
 it('never infers delivery or health from quiet rooms, network success or pre-ack/coalesced reads',()=>{
  let now=100;const report=vi.fn(),tracker=createRequestVisibility(()=>now,report);
  tracker.observe([],200);expect(report).not.toHaveBeenCalled();
  tracker.acknowledge('request','created');now=10000;tracker.observe([{id:'request'}],99);tracker.observe([],99);expect(report).not.toHaveBeenCalled();
  const snapshot=recordSnapshotStart({songs:[{id:'request'}]},99);expect(snapshotReadStarted(snapshot)).toBe(99);expect(snapshotReadStarted({})).toBe(0);
  tracker.observe(snapshot.songs,snapshotReadStarted(snapshot));expect(report).not.toHaveBeenCalled();
  tracker.observe([{id:'request'}],101);expect(report).toHaveBeenCalledExactlyOnceWith('request_visibility','snapshot_observed',9900);
  expect(JSON.stringify(report.mock.calls)).not.toContain('"request"');
 });
 it('reports only a relevant post-ack snapshot missing after delay, not a timer, and clears on end',()=>{
  let now=100;const report=vi.fn(),tracker=createRequestVisibility(()=>now,report);
  tracker.acknowledge('saved','created');now=5000;tracker.observe([],101);expect(report).not.toHaveBeenCalled();
  now=5100;tracker.observe([],101);expect(report).toHaveBeenCalledExactlyOnceWith('request_visibility','snapshot_missing',5000);
  now=6000;tracker.observe([],101);expect(report).toHaveBeenCalledTimes(1);
  tracker.observe([{id:'saved'}],101,true);expect(report).toHaveBeenCalledTimes(1);
 });
 it('rejects unsuccessful/missing acknowledgements and expires bounded page-local state',()=>{
  let now=100;const report=vi.fn(),tracker=createRequestVisibility(()=>now,report);
  tracker.acknowledge('bad','cooldown');tracker.acknowledge(null,'created');tracker.observe([{id:'bad'}],101);expect(report).not.toHaveBeenCalled();
  tracker.acknowledge('old','created');now=30200;tracker.observe([{id:'old'}],200);expect(report).not.toHaveBeenCalled();
  tracker.acknowledge('new','created');tracker.clear();tracker.observe([{id:'new'}],30300);expect(report).not.toHaveBeenCalled();
 });
});