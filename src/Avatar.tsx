import {useAccount} from './Auth';
export function AvatarContent(){const {user}=useAccount();return user?.avatar?<img src={user.avatar} alt="个人头像"/>:<>{(user?.displayName||'A').slice(0,1).toUpperCase()}</>;}
export async function avatarFromFile(file:File){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw new Error('请选择不超过 5 MiB 的 PNG、JPEG 或 WebP 图片');
  const url=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('无法读取图片，请重新选择文件'));reader.readAsDataURL(file);});try{const img=new Image();img.src=url;await img.decode();const canvas=document.createElement('canvas');canvas.width=canvas.height=128;const ctx=canvas.getContext('2d')!;const size=Math.min(img.naturalWidth,img.naturalHeight);ctx.drawImage(img,(img.naturalWidth-size)/2,(img.naturalHeight-size)/2,size,size,0,0,128,128);return canvas.toDataURL('image/png');}catch{throw new Error('图片无法解码，请选择有效的 PNG、JPEG 或 WebP 图片');}
}
