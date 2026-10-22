import test from 'node:test';
import assert from 'node:assert/strict';
import {requestContext} from '../src/observability.js';

test('request context generates and returns a correlation ID',()=>{
  const headers={};const listeners={};const req={method:'GET',path:'/api/health'};
  const res={statusCode:200,setHeader:(k,v)=>headers[k]=v,on:(k,fn)=>listeners[k]=fn};
  let nextCalled=false;requestContext(req,res,()=>{nextCalled=true});
  assert.equal(nextCalled,true);
  assert.match(req.requestId,/^[0-9a-f-]{36}$/);
  assert.equal(headers['X-Request-Id'],req.requestId);
  assert.equal(typeof listeners.finish,'function');
});

test('request context logs route metadata without query values',()=>{
  const oldLog=console.log;const lines=[];console.log=(line)=>lines.push(line);
  try{
    const listeners={};const req={method:'GET',path:'/api/samples',query:{token:'do-not-log'},route:{path:'/samples'},baseUrl:'/api'};
    const res={statusCode:200,setHeader(){},on:(k,fn)=>listeners[k]=fn};
    requestContext(req,res,()=>{});listeners.finish();
    assert.equal(lines.length,1);
    const event=JSON.parse(lines[0]);
    assert.equal(event.event,'http_request');assert.equal(event.route,'/api/samples');
    assert.equal(event.statusCode,200);assert.ok(event.requestId);assert.ok(event.durationMs>=0);
    assert.equal(lines[0].includes('do-not-log'),false);
  }finally{console.log=oldLog}
});
