import crypto from 'node:crypto';

// Attach a server-generated correlation ID to each request. Never log request bodies,
// cookies, authorization headers, uploaded content, or query-string values here.
export function requestContext(req,res,next){
  const requestId=crypto.randomUUID();
  const started=process.hrtime.bigint();
  req.requestId=requestId;
  res.setHeader('X-Request-Id',requestId);
  res.on('finish',()=>{
    if(!req.path.startsWith('/api')&&req.path!=='/healthz'&&req.path!=='/readyz')return;
    const route=req.route?.path?String(req.baseUrl||'')+String(req.route.path):req.path;
    const durationMs=Number(process.hrtime.bigint()-started)/1e6;
    console.log(JSON.stringify({
      event:'http_request',requestId,method:req.method,route,
      statusCode:res.statusCode,durationMs:Math.round(durationMs*100)/100
    }));
  });
  next();
}
