import {crc32,inflateSync} from 'node:zlib';
export function validateAvatar(value) {
  if(value==='')return '';
  if(typeof value!=='string'||value.length>140000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw new Error('头像须为 PNG 图片，最大 100 KiB');
  const bytes=Buffer.from(value.split(',')[1],'base64');
  if(bytes.length>100*1024||bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.subarray(12,16).toString()!=='IHDR'||bytes.readUInt32BE(16)>256||bytes.readUInt32BE(20)>256||!bytes.readUInt32BE(16)||!bytes.readUInt32BE(20))throw new Error('头像尺寸最大 256 × 256');
  const compressed=[];let ended=false;
  for(let offset=8;offset<bytes.length;){
    if(offset+12>bytes.length)throw new Error('PNG 数据截断');const length=bytes.readUInt32BE(offset),end=offset+12+length;
    if(end>bytes.length||crc32(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))throw new Error('PNG 数据校验失败');
    const type=bytes.subarray(offset+4,offset+8).toString();if(type==='IDAT')compressed.push(bytes.subarray(offset+8,end-4));
    if(type==='IEND'){if(length||end!==bytes.length)throw new Error('PNG 尾部无效');ended=true;}offset=end;
  }
  if(!ended||!compressed.length)throw new Error('PNG 缺少图像内容');
  try{inflateSync(Buffer.concat(compressed),{maxOutputLength:256*256*9});}catch{throw new Error('PNG 图像无法解码或超过预算');}
  return value;
}
