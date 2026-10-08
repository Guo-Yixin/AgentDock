export const profileFields=['phone','email','gender','birthday','signature'];
export function validateProfile(input,previous={}){
 const value={};
 for(const key of profileFields){const raw=key in input?input[key]:previous[key]||'';if(typeof raw!=='string')throw new Error('个人资料格式无效');value[key]=raw.trim();}
 if(value.phone&&(!/^\+?[0-9 ()-]{5,32}$/.test(value.phone)||value.phone.replace(/\D/g,'').length<5))throw new Error('电话须为有效号码，可包含国家区号、空格和短横线');
 if(value.email&&(value.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)))throw new Error('请填写有效邮箱');
 if(!['','female','male','other','private'].includes(value.gender))throw new Error('请选择有效性别');
 if(value.birthday){const n=Date.parse(value.birthday+'T00:00:00Z'),today=new Date(Date.now()+28800000).toISOString().slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(value.birthday)||!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==value.birthday||value.birthday<'1900-01-01'||value.birthday>today)throw new Error('生日须为 1900 年至今天之间的有效日期');}
 if(value.signature.length>300)throw new Error('个人签名最多 300 个字符');
 return value;
}
