export async function issueTestInvite(origin,password,subject='data-structures'){
  const headers={'Content-Type':'application/json','X-Requested-With':'zhixu'};
  const login=await fetch(origin+'/api/admin/login',{method:'POST',headers,body:JSON.stringify({password})});
  if(!login.ok)throw new Error('测试管理员登录失败：'+login.status);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const invite=await fetch(origin+'/api/admin/invitations',{
    method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({subject})
  });
  if(!invite.ok)throw new Error('测试邀请码生成失败：'+invite.status);
  return (await invite.json()).code;
}
