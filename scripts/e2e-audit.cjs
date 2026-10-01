const BASE=process.env.E2E_BASE || 'http://localhost:8092';
async function req(path,{method='GET',token,body}={}){const headers={'User-Agent':'Yingto-E2E'};if(body!==undefined)headers['Content-Type']='application/json';if(token)headers.Authorization='Bearer '+token;const r=await fetch(BASE+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const text=await r.text();let data={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}};if(!r.ok){const e=new Error(method+' '+path+' -> '+r.status+' '+JSON.stringify(data));e.status=r.status;e.data=data;throw e;}return data;}
function assert(ok,msg){if(!ok)throw new Error('ASSERT: '+msg)}
(async()=>{
 const report={steps:[]};
 const phone='196'+String(Date.now()).slice(-8);const password='Audit1234';
 const reg=await req('/api/public/register',{method:'POST',body:{phone,password,name:'E2E最终测试',referralCode:'ET-804822'}});
 assert(reg.uid&&reg.token,'注册返回 UID 和 Token');report.steps.push({step:'注册并绑定邀请关系',uid:reg.uid,referrerId:reg.user.referrerId,ok:reg.user.referrerId===105});
 const userToken=reg.token;
 const user0=(await req('/api/public/user',{token:userToken})).user;
 assert(user0.uid===reg.uid,'用户接口 UID 与注册一致');
 await req('/api/public/kyc',{method:'POST',token:userToken,body:{realName:'E2E测试用户',idNumber:'ID'+Date.now(),kycType:'身份证'}});
 const admin=await req('/api/auth/login',{method:'POST',body:{username:'admin',password:'Admin@123456'}});const adminToken=admin.token;
 const kycs=await req('/api/kyc?status=pending',{token:adminToken});const kyc=kycs.find(k=>k.user_id===user0.id);assert(kyc,'找到待审核 KYC');
 const kycOut=await req('/api/kyc/'+kyc.id+'/review',{method:'PUT',token:adminToken,body:{action:'approve',remark:'E2E'}});assert(kycOut.ok,'KYC 审核通过');
 let kycSecondStatus=0;try{await req('/api/kyc/'+kyc.id+'/review',{method:'PUT',token:adminToken,body:{action:'approve'}})}catch(e){kycSecondStatus=e.status}assert(kycSecondStatus===409,'KYC 重复审核应返回 409');report.steps.push({step:'KYC 审核及幂等',kycId:kyc.id,secondStatus:kycSecondStatus,ok:true});
 const addr=await req('/api/public/deposit-address?network=TRC20&currency=USDT',{token:userToken});
 const dep=await req('/api/public/deposit',{method:'POST',token:userToken,body:{amount:1000,depositUid:reg.uid,currency:'USDT',network:'TRC20',address:addr.address}});
 const txns=await req('/api/public/transactions',{token:userToken});const depTx=txns.find(t=>t.txnId===dep.txn);assert(depTx,'找到充值订单');
 const beforeDep=(await req('/api/public/user',{token:userToken})).user;
 await req('/api/transactions/'+depTx.id+'/review',{method:'PUT',token:adminToken,body:{action:'approve',remark:'E2E'}});
 let depSecondStatus=0;try{await req('/api/transactions/'+depTx.id+'/review',{method:'PUT',token:adminToken,body:{action:'approve'}})}catch(e){depSecondStatus=e.status}assert(depSecondStatus===409,'充值重复审核应返回 409');
 const afterDep=(await req('/api/public/user',{token:userToken})).user;assert(Math.abs((afterDep.balance-beforeDep.balance)-1000)<0.001,'充值只入账一次');report.steps.push({step:'充值审核及幂等',txnId:depTx.txnId,credited:afterDep.balance-beforeDep.balance,secondStatus:depSecondStatus,ok:true});
 const followsBefore=await req('/api/public/follows',{token:userToken});
 try{await req('/api/public/follow',{method:'POST',token:userToken,body:{roomId:'vip-stable-arbitrage',amount:500,stopLoss:10}});}catch(e){throw new Error('跟单失败: '+e.message)}
 const follows=await req('/api/public/follows',{token:userToken});const follow=follows.find(f=>f.status==='active');assert(follow,'跟单记录已创建');
 const ref=await req('/api/public/referral',{token:userToken});
 const inviterLogin=await req('/api/public/login',{method:'POST',body:{account:'188373448610',password:'Test1234'}});const inviterRef=await req('/api/public/referral',{token:inviterLogin.token});assert(inviterRef.directMembers.some(m=>m.uid===reg.uid),'上级直推列表包含新用户');report.steps.push({step:'跟单与直推关系',followId:follow.id,inviterDirectCount:inviterRef.directMembers.length,newUserInDirectList:true,ok:true});
 const pointsBefore=(await req('/api/public/points',{token:userToken})).balance;
 await req('/api/admin/settle?force=1',{method:'POST',token:adminToken});
 const yields=await req('/api/public/yields',{token:userToken});const myYield=yields.find(y=>Number(y.follow_id)===Number(follow.id));assert(myYield,'结算生成日化收益');assert(Number(myYield.customer_share)>0,'客户收益大于 0');
 const pointsAfter=(await req('/api/public/points',{token:userToken})).balance;assert(pointsAfter>=pointsBefore+10,'跟单 500 USDT 获得积分');
 const userAfterYield=(await req('/api/public/user',{token:userToken})).user;assert(userAfterYield.balance>afterDep.balance,'收益进入账户余额');report.steps.push({step:'每日结算与积分',yieldRate:myYield.yield_rate,profit:myYield.customer_share,pointsAdded:pointsAfter-pointsBefore,balance:userAfterYield.balance,ok:true});
 let stopStatus=0;try{await req('/api/public/follows/'+follow.id+'/stop',{method:'PUT',token:userToken,body:{}})}catch(e){stopStatus=e.status}assert(stopStatus===423,'未满7天不能退出跟单');report.steps.push({step:'7天退出限制',status:stopStatus,ok:true});
 const withdrawAmount=Math.max(10,Math.floor(Number(userAfterYield.available||0)*0.7*100)/100);const withdraw1=await req('/api/public/withdraw',{method:'POST',token:userToken,body:{amount:withdrawAmount,network:'TRC20',address:'TE2EAddress111111111111111111111'}});let withdraw2Status=0;try{await req('/api/public/withdraw',{method:'POST',token:userToken,body:{amount:withdrawAmount,network:'TRC20',address:'TE2EAddress222222222222222222222'}})}catch(e){withdraw2Status=e.status}assert(withdraw2Status===400,'待审核提现不能重复占用同一余额');report.steps.push({step:'提现占用与风控',firstTxn:withdraw1.txn,secondStatus:withdraw2Status,ok:true});
 report.ok=true;report.user={uid:reg.uid,phone};console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.stack||e.message);process.exit(1)});
