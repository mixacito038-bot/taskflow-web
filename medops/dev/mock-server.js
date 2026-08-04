/* =========================================================================
   急救设备巡检 · mock 后端（仅供 H5 自验证，node 原生 http，无依赖）
   按 docs/api-contract.md v1 实现内存版：
   auth(login/refresh/logout/login-state/me) time depts devices members
   records(GET/PUT/sign) weeksigns monthsigns files stats/unsigned
   同时把同目录 index.html 托管在 /，方便 Playwright 同源联调。
   用法：node mock-server.js [port]   （默认 3300）
   ========================================================================= */
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=+(process.argv[2]||process.env.PORT||3300);

/* ---------- 业务日期：Asia/Shanghai（+8 偏移后用 UTC 方法读） ---------- */
const pad=n=>String(n).padStart(2,'0');
const shNow=()=>new Date(Date.now()+8*3600e3);
const fmt=d=>`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
const today=()=>fmt(shNow());
const nowStr=()=>{const d=shNow();return `${fmt(d)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`};
const D=s=>new Date(s+'T00:00:00Z');
const addDay=(s,n)=>{const d=D(s);d.setUTCDate(d.getUTCDate()+n);return fmt(d)};
const wkOf=s=>{const d=D(s);const off=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-off);return fmt(d)};
const moOf=s=>s.slice(0,7);
const wksOfMonth=m=>{const out=[];let w=wkOf(m+'-01');if(moOf(w)!==m)w=addDay(w,7);
  while(moOf(w)===m){if(w<=today())out.push(w);w=addDay(w,7)}return out};

/* ---------- 内存库 ---------- */
let seq=1;const nid=()=>String(seq++);
const db={depts:[],devices:[],members:[],users:[],records:[],weeksigns:[],monthsigns:[],files:new Map()};
function addFile(buf){const id=nid();
  db.files.set(id,{buf,sha:crypto.createHash('sha256').update(buf).digest('hex')});
  return '/api/files/'+id}
/* 1x1 透明 PNG，做演示签名图 */
const PNG1=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

/* ---------- 演示数据：3 科室 × 8 台设备；上周全签+周签(留一科室)、本周今天之前全日签 ---------- */
function seed(){
  const t=today(),curW=wkOf(t),lastW=addDay(curW,-7);
  const DEPTS=[['重症医学科','ICU'],['急诊科','JZ'],['心血管内科','XN']];
  const CATS=[['监护仪',4],['除颤仪',2],['输液泵',2]];
  const MODEL={'监护仪':'迈瑞 uMEC12','除颤仪':'飞利浦 HeartStart','输液泵':'迈瑞 SK-600II'};
  const CAB={'监护仪':'JHY','除颤仪':'CCY','输液泵':'SYB'};
  const NM=['张敏','李慧','王芳','陈静','刘洋','赵霞','孙婷','周颖','吴倩'];
  DEPTS.forEach(([name,code],di)=>{
    const dep={id:nid(),name,code,sort:di,status:'on'};db.depts.push(dep);
    CATS.forEach(([cn,n])=>{for(let i=1;i<=n;i++)
      db.devices.push({id:nid(),deptId:dep.id,catName:cn,code:`PD-${code}-${CAB[cn]}-${pad(i)}`,
        name:cn,model:MODEL[cn],location:`${i}号床`,status:'in_use'})});
    for(let i=0;i<3;i++)db.members.push({id:nid(),deptId:dep.id,name:NM[di*3+i],
      title:i?'主管护师':'护士长',status:'on'});
  });
  const [d1,d2,d3]=db.depts.map(x=>x.id);
  const U=(username,displayName,role,deptId,deptIds,status)=>{
    const u={id:nid(),username,password:'123456',displayName,role,deptId:deptId||null,
      deptIds:deptIds||(deptId?[deptId]:[]),status:status||'on',mustChange:false};
    db.users.push(u);return u};
  U('gh01','王建国','inspector',null,[d1,d2]);
  U('gh02','李强','inspector',null,[d3]);
  U('icu','重症医学科','dept',d1);
  U('jz','急诊科','dept',d2);
  U('xn','心血管内科','dept',d3);
  U('sbk','设备科','equip',null,[]);
  U('gh03','李明（已离职）','inspector',null,[d3],'off');

  const insp={[d1]:'王建国',[d2]:'王建国',[d3]:'李强'};
  const days=[];
  for(let i=0;i<7;i++)days.push(addDay(lastW,i));
  for(let d=curW;d<t;d=addDay(d,1))days.push(d);       // 本周只签到昨天，今天留给 H5 演示
  db.depts.forEach(dep=>{
    const devs=db.devices.filter(x=>x.deptId===dep.id);
    days.forEach(date=>{
      const checks={};devs.forEach(dv=>checks[dv.id]='ok');
      db.records.push({id:nid(),deptId:dep.id,date,checks,notes:{},
        inspectorId:'0',inspectorName:insp[dep.id],
        sign:{name:insp[dep.id],title:'巡检员',url:addFile(PNG1),opinion:'',at:date+' 09:30'},
        createdAt:date+' 09:00',updatedAt:date+' 09:30'});
    });
    /* 上周周签：心血管内科刻意留白，触发「未周签」提醒 */
    if(dep.id!==d3){
      const m=db.members.find(x=>x.deptId===dep.id);
      db.weeksigns.push({id:nid(),deptId:dep.id,week:lastW,
        sign:{name:m.name,title:m.title,url:addFile(PNG1),opinion:'',at:addDay(lastW,7)+' 09:10'},
        stat:{checked:devs.length*7,ng:0,days:7},at:addDay(lastW,7)+' 09:10'});
    }
  });
}
seed();

/* ---------- 认证状态 ---------- */
const access=new Map();    // accessToken -> {uid,exp}
const refreshT=new Map();  // refreshToken -> {uid,dev,revoked}
const sids=new Map();      // sid cookie -> uid
const fails=new Map();     // username -> {n,round,until}
const probes=new Map();    // dev|ip -> {n,win,until}
const known=new Map();     // dev -> Set(username) 成功登录过才回真实 disabled
const rnd=n=>crypto.randomBytes(n).toString('base64url');
const pubUser=u=>({id:u.id,username:u.username,displayName:u.displayName,role:u.role,
  deptId:u.deptId,deptIds:u.deptIds||[],mustChange:!!u.mustChange});
function issue(u,dev,res){
  const at=rnd(24),rt=rnd(32),sid=rnd(18);
  access.set(at,{uid:u.id,exp:Date.now()+30*60000});
  refreshT.set(rt,{uid:u.id,dev,revoked:false});
  sids.set(sid,u.id);
  res.setHeader('Set-Cookie',`sid=${sid}; Path=/api; HttpOnly; SameSite=Lax`);
  return {accessToken:at,refreshToken:rt,user:pubUser(u)};
}

/* ---------- 响应工具 ---------- */
function send(res,code,obj){const s=JSON.stringify(obj);
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(s)}
function fail(res,code,c,m,retryAfter){
  send(res,code,{error:Object.assign({code:c,message:m},retryAfter?{retryAfter}:{})})}

/* ---------- 鉴权与范围 ---------- */
function bearerUser(req){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer '))return null;
  const o=access.get(h.slice(7));
  if(!o||o.exp<Date.now())return null;
  return db.users.find(u=>u.id===o.uid)||null;
}
function cookieUser(req){
  const m=/(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie||'');
  if(!m)return null;
  const uid=sids.get(m[1]);
  return uid?db.users.find(u=>u.id===uid)||null:null;
}
function auth(req,res){
  const u=bearerUser(req);
  if(!u){fail(res,401,'UNAUTHORIZED','未登录或登录已过期');return null}
  if(u.status==='off'){fail(res,401,'KICKED','您的账户已被禁用，请联系设备科');return null}
  return u;
}
function scopeIds(u){
  if(u.role==='equip'||u.role==='admin')return db.depts.map(d=>d.id);
  if(u.role==='dept')return u.deptId?[u.deptId]:[];
  return u.deptIds||[];
}
const inScope=(u,deptId)=>scopeIds(u).includes(deptId);

/* ---------- 签名图入库：PNG magic + 解码 ≤1MB ---------- */
function saveSig(dataUrl){
  if(typeof dataUrl!=='string'||!dataUrl.startsWith('data:image/png;base64,'))return null;
  let buf;try{buf=Buffer.from(dataUrl.slice(22),'base64')}catch(e){return null}
  if(buf.length>1024*1024)return null;
  if(buf.length<8||buf.readUInt32BE(0)!==0x89504e47)return null;
  return addFile(buf);
}
/* 日记录锁定检查：日签/周签/月签任一存在即锁 */
function dayLock(deptId,date){
  if(db.weeksigns.find(x=>x.deptId===deptId&&x.week===wkOf(date)))return '该周已周签，记录已锁定';
  if(db.monthsigns.find(x=>x.deptId===deptId&&x.month===moOf(date)))return '该月已月签，记录已锁定';
  return null;
}

/* ---------- 业务处理 ---------- */
function handleLogin(res,body,dev,ip){
  const key=dev+'|'+ip,now=Date.now();
  const pb=probes.get(key);
  if(pb&&pb.until&&pb.until>now)
    return fail(res,429,'PROBE_COOLDOWN','尝试过于频繁，请稍后再试',Math.ceil((pb.until-now)/1000));
  const bump=()=>{let o=probes.get(key);
    if(!o||now-o.win>120000)o={n:0,win:now,until:0};
    o.n++;if(o.n>=8){o.until=now+120000;o.n=0;o.win=now}
    probes.set(key,o)};
  const un=String(body.username||'').trim();
  const u=db.users.find(x=>x.username===un);
  if(!u){bump();return fail(res,401,'UNAUTHORIZED','账号或密码不正确')}
  const fl=fails.get(un);
  if(fl&&fl.until>now)
    return fail(res,423,'FROZEN','账号已冻结，请稍后再试',Math.ceil((fl.until-now)/1000));
  if(u.status==='off')return fail(res,403,'KICKED','您的账户已被禁用，请联系设备科');
  if(String(body.password||'')!==u.password){
    bump();
    const o=fails.get(un)||{n:0,round:0,until:0};
    o.n++;
    if(o.n>=5){o.round++;o.n=0;o.until=now+o.round*5*60000;fails.set(un,o);
      return fail(res,423,'FROZEN',`密码连续输错 5 次，账号冻结 ${o.round*5} 分钟`,o.round*300)}
    fails.set(un,o);
    return fail(res,401,'UNAUTHORIZED','账号或密码不正确');
  }
  fails.delete(un);probes.delete(key);
  if(!known.has(dev))known.set(dev,new Set());
  known.get(dev).add(un);
  send(res,200,issue(u,dev,res));
}
function handleRefresh(res,body,dev){
  const rt=String(body.refreshToken||'');
  const o=refreshT.get(rt);
  if(!o)return fail(res,401,'UNAUTHORIZED','登录已过期，请重新登录');
  if(o.revoked){ /* 已轮换 token 被重放 → 吊销该用户该设备全部 */
    for(const v of refreshT.values())if(v.uid===o.uid&&v.dev===o.dev)v.revoked=true;
    return fail(res,401,'UNAUTHORIZED','登录已过期，请重新登录');
  }
  const u=db.users.find(x=>x.id===o.uid);
  if(!u)return fail(res,401,'UNAUTHORIZED','登录已过期，请重新登录');
  if(u.status==='off')return fail(res,401,'KICKED','您的账户已被禁用，请联系设备科');
  o.revoked=true;
  send(res,200,issue(u,dev,res));
}

/* ---------- 主路由 ---------- */
async function handle(req,res){
  const u=new URL(req.url,'http://x');
  const p=u.pathname,q=u.searchParams;
  const dev=String(req.headers['x-device-id']||'');
  const ip=req.socket.remoteAddress||'';
  let body={};
  if(req.method==='POST'||req.method==='PUT'){
    const chunks=[];let size=0;
    await new Promise((ok,bad)=>{
      req.on('data',c=>{size+=c.length;if(size>4e6){bad(new Error('too large'))}else chunks.push(c)});
      req.on('end',ok);req.on('error',bad);
    });
    try{body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch(e){body={}}
  }

  /* 静态页（Playwright 同源联调） */
  if(req.method==='GET'&&(p==='/'||p==='/index.html')){
    const html=fs.readFileSync(path.join(__dirname,'index.html'));
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});
    return res.end(html);
  }
  if(p==='/favicon.ico'){res.writeHead(204);return res.end()}
  if(!p.startsWith('/api/'))return fail(res,404,'NOT_FOUND','not found');

  /* ---- 匿名端点 ---- */
  if(p==='/api/health')return send(res,200,{ok:true});
  if(p==='/api/auth/login'&&req.method==='POST')return handleLogin(res,body,dev,ip);
  if(p==='/api/auth/refresh'&&req.method==='POST')return handleRefresh(res,body,dev);
  if(p==='/api/auth/login-state'&&req.method==='GET'){
    const un=String(q.get('username')||'').trim(),now=Date.now();
    const fl=fails.get(un);
    const frozen=!!(fl&&fl.until>now);
    const usr=db.users.find(x=>x.username===un);
    const disabled=!!(usr&&usr.status==='off'&&known.has(dev)&&known.get(dev).has(un));
    const out={frozen,disabled};
    if(frozen)out.retryAfter=Math.ceil((fl.until-now)/1000);
    return send(res,200,out);
  }
  /* 文件：Bearer 或 Cookie 均可（<img> 场景） */
  {
    const m=p.match(/^\/api\/files\/(\w+)$/);
    if(m&&req.method==='GET'){
      if(!bearerUser(req)&&!cookieUser(req))return fail(res,401,'UNAUTHORIZED','未登录');
      const f=db.files.get(m[1]);
      if(!f)return fail(res,404,'NOT_FOUND','文件不存在');
      res.writeHead(200,{'Content-Type':'image/png','ETag':f.sha,'Cache-Control':'private,max-age=86400'});
      return res.end(f.buf);
    }
  }

  /* ---- 以下需要登录 ---- */
  const user=auth(req,res);if(!user)return;

  if(p==='/api/auth/logout'&&req.method==='POST'){
    const o=refreshT.get(String(body.refreshToken||''));if(o)o.revoked=true;
    res.setHeader('Set-Cookie','sid=; Path=/api; Max-Age=0');
    return send(res,200,{ok:true});
  }
  if(p==='/api/auth/me')return send(res,200,pubUser(user));
  if(p==='/api/time'){
    const t=today();
    return send(res,200,{now:nowStr(),date:t,week:wkOf(t),month:moOf(t)});
  }
  if(p==='/api/depts'&&req.method==='GET')
    return send(res,200,db.depts.filter(d=>inScope(user,d.id)));
  {
    const m=p.match(/^\/api\/depts\/(\w+)$/);
    if(m){
      if(!inScope(user,m[1]))return fail(res,403,'FORBIDDEN','无权访问该科室');
      const d=db.depts.find(x=>x.id===m[1]);
      return d?send(res,200,d):fail(res,404,'NOT_FOUND','科室不存在');
    }
  }
  if(p==='/api/devices'||p==='/api/members'){
    const deptId=q.get('deptId')||'';
    if(!inScope(user,deptId))return fail(res,403,'FORBIDDEN','无权访问该科室');
    return send(res,200,(p==='/api/devices'?db.devices:db.members).filter(x=>x.deptId===deptId));
  }

  /* 记录列表 */
  if(p==='/api/records'&&req.method==='GET'){
    const deptId=q.get('deptId'),from=q.get('from')||'0000',to=q.get('to')||'9999';
    if(deptId&&!inScope(user,deptId))return fail(res,403,'FORBIDDEN','无权访问该科室');
    const ids=deptId?[deptId]:scopeIds(user);
    return send(res,200,db.records.filter(r=>ids.includes(r.deptId)&&r.date>=from&&r.date<=to));
  }
  /* 单日记录：GET / PUT / sign */
  {
    const m=p.match(/^\/api\/records\/(\w+)\/(\d{4}-\d{2}-\d{2})(\/sign)?$/);
    if(m){
      const [,deptId,date,isSign]=m;
      if(!inScope(user,deptId))return fail(res,403,'FORBIDDEN','无权访问该科室');
      let r=db.records.find(x=>x.deptId===deptId&&x.date===date);
      if(req.method==='GET'&&!isSign)
        return r?send(res,200,r):fail(res,404,'NOT_FOUND','无记录');
      if(user.role!=='inspector')return fail(res,403,'FORBIDDEN','仅巡检员可操作巡检记录');
      if(date>today())return fail(res,400,'EARLY','还没到这一天，不能提前操作');
      if(r&&r.sign)return fail(res,423,'LOCKED','该日已签字，记录已锁定');
      const lk=dayLock(deptId,date);if(lk)return fail(res,423,'LOCKED',lk);
      if(req.method==='PUT'&&!isSign){
        if(!r){r={id:nid(),deptId,date,checks:{},notes:{},sign:null,inspectorId:user.id,
          inspectorName:user.displayName,createdAt:nowStr(),updatedAt:nowStr()};db.records.push(r)}
        r.checks=body.checks||{};r.notes=body.notes||{};r.updatedAt=nowStr();
        return send(res,200,r);
      }
      if(req.method==='POST'&&isSign){
        if(!r||!Object.keys(r.checks||{}).length)
          return fail(res,400,'BAD_INPUT','还没有巡检记录，请先勾选设备');
        const url=saveSig(body.dataUrl);
        if(!url)return fail(res,400,'BAD_INPUT','签名图无效（须为 PNG 且不超过 1MB）');
        r.sign={name:String(body.name||''),title:String(body.title||''),url,
          opinion:String(body.opinion||''),at:nowStr()};
        r.updatedAt=nowStr();
        return send(res,200,r);
      }
    }
  }

  /* 周签 */
  if(p==='/api/weeksigns'&&req.method==='GET'){
    const deptId=q.get('deptId'),from=q.get('from')||'0000',to=q.get('to')||'9999';
    if(deptId&&!inScope(user,deptId))return fail(res,403,'FORBIDDEN','无权访问该科室');
    const ids=deptId?[deptId]:scopeIds(user);
    return send(res,200,db.weeksigns.filter(x=>ids.includes(x.deptId)&&x.week>=from&&x.week<=to));
  }
  {
    const m=p.match(/^\/api\/weeksigns\/(\w+)\/(\d{4}-\d{2}-\d{2})\/sign$/);
    if(m&&req.method==='POST'){
      const [,deptId,week]=m;
      if(user.role!=='dept')return fail(res,403,'FORBIDDEN','仅科室账号可周签');
      if(!inScope(user,deptId))return fail(res,403,'FORBIDDEN','无权操作该科室');
      if(wkOf(week)!==week)return fail(res,400,'BAD_INPUT','week 必须是周一日期');
      if(week>today())return fail(res,400,'EARLY','这一周还没开始，不能提前签字');
      if(db.weeksigns.find(x=>x.deptId===deptId&&x.week===week))
        return fail(res,423,'LOCKED','本周已签字');
      const days=[];for(let i=0;i<7;i++){const d=addDay(week,i);if(d<=today())days.push(d)}
      const recs=db.records.filter(r=>r.deptId===deptId&&r.date>=week&&r.date<=addDay(week,6));
      const miss=days.filter(d=>{const r=recs.find(x=>x.date===d);return !(r&&r.sign)});
      if(miss.length)return fail(res,409,'NOT_READY',`还有 ${miss.length} 天未完成日签`);
      const url=saveSig(body.dataUrl);
      if(!url)return fail(res,400,'BAD_INPUT','签名图无效（须为 PNG 且不超过 1MB）');
      let checked=0,ng=0;
      recs.forEach(r=>{const v=Object.values(r.checks||{});checked+=v.length;ng+=v.filter(x=>x==='ng').length});
      const w={id:nid(),deptId,week,
        sign:{name:String(body.name||''),title:String(body.title||''),url,
          opinion:String(body.opinion||''),at:nowStr()},
        stat:{checked,ng,days:days.length},at:nowStr()};
      db.weeksigns.push(w);
      return send(res,200,w);
    }
  }

  /* 月签 */
  if(p==='/api/monthsigns'&&req.method==='GET'){
    const deptId=q.get('deptId'),year=q.get('year');
    if(deptId&&!inScope(user,deptId))return fail(res,403,'FORBIDDEN','无权访问该科室');
    const ids=deptId?[deptId]:scopeIds(user);
    return send(res,200,db.monthsigns.filter(x=>ids.includes(x.deptId)&&(!year||x.month.slice(0,4)===year)));
  }
  {
    const m=p.match(/^\/api\/monthsigns\/(\w+)\/(\d{4}-\d{2})\/sign$/);
    if(m&&req.method==='POST'){
      const [,deptId,month]=m;
      if(user.role!=='equip'&&user.role!=='admin')return fail(res,403,'FORBIDDEN','仅设备科可月签');
      if(!inScope(user,deptId))return fail(res,403,'FORBIDDEN','无权操作该科室');
      if(month>moOf(today()))return fail(res,400,'EARLY','这个月还没开始，不能提前签字');
      if(db.monthsigns.find(x=>x.deptId===deptId&&x.month===month))
        return fail(res,423,'LOCKED','本月已签字');
      const wks=wksOfMonth(month);
      const miss=wks.filter(w=>!db.weeksigns.find(x=>x.deptId===deptId&&x.week===w));
      if(!wks.length||miss.length)
        return fail(res,409,'NOT_READY',`还有 ${miss.length||1} 周未完成周签`);
      const url=saveSig(body.dataUrl);
      if(!url)return fail(res,400,'BAD_INPUT','签名图无效（须为 PNG 且不超过 1MB）');
      const recs=db.records.filter(r=>r.deptId===deptId&&moOf(r.date)===month);
      let checked=0,ng=0;
      recs.forEach(r=>{const v=Object.values(r.checks||{});checked+=v.length;ng+=v.filter(x=>x==='ng').length});
      const ms={id:nid(),deptId,month,
        sign:{name:String(body.name||''),title:String(body.title||''),url,
          opinion:String(body.opinion||''),at:nowStr()},
        stat:{checked,ng,weeks:wks.length},at:nowStr()};
      db.monthsigns.push(ms);
      return send(res,200,ms);
    }
  }

  /* 未签统计 */
  if(p==='/api/stats/unsigned'){
    const ids=scopeIds(user),t=today();
    const out={days:[],weeks:[],months:[]};
    for(let i=1;i<=7;i++){const d=addDay(t,-i);
      ids.forEach(dp=>{const r=db.records.find(x=>x.deptId===dp&&x.date===d);
        if(!(r&&r.sign))out.days.push({deptId:dp,date:d})})}
    const seen=new Set();
    db.records.forEach(r=>seen.add(r.deptId+'|'+wkOf(r.date)));
    [...seen].sort().forEach(k=>{const [dp,w]=k.split('|');
      if(ids.includes(dp)&&addDay(w,6)<t&&!db.weeksigns.find(x=>x.deptId===dp&&x.week===w))
        out.weeks.push({deptId:dp,week:w})});
    const lmD=D(moOf(t)+'-01');lmD.setUTCDate(0);const lm=moOf(fmt(lmD));
    ids.forEach(dp=>{
      if(db.records.some(r=>r.deptId===dp&&moOf(r.date)===lm)&&
        !db.monthsigns.find(x=>x.deptId===dp&&x.month===lm))out.months.push({deptId:dp,month:lm})});
    return send(res,200,out);
  }

  fail(res,404,'NOT_FOUND','not found');
}

http.createServer((req,res)=>{
  handle(req,res).catch(e=>{try{fail(res,500,'ERR',e.message||'server error')}catch(x){}});
}).listen(PORT,'127.0.0.1',()=>console.log('mock server on http://127.0.0.1:'+PORT));
