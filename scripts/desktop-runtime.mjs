import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const spec=JSON.parse(await readFile(new URL('../desktop/runtime.json',import.meta.url)));
if(process.platform!=='win32')throw new Error('桌面安装包需要 Windows x64 构建环境');
const dir=path.resolve('artifacts/runtime');await mkdir(dir,{recursive:true});
const archive=path.join(dir,spec.archive);
let bytes;try{bytes=await readFile(archive);}catch{}
if(!bytes||createHash('sha256').update(bytes).digest('hex')!==spec.sha256){
 const download=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri $env:AD_URL -OutFile $env:AD_OUTPUT"],{env:{...process.env,AD_URL:`https://nodejs.org/dist/v${spec.version}/${spec.archive}`,AD_OUTPUT:archive},windowsHide:true,encoding:'utf8',timeout:180000});
 if(download.status!==0)throw new Error('Node.js 运行时下载失败');bytes=await readFile(archive);
 if(createHash('sha256').update(bytes).digest('hex')!==spec.sha256)throw new Error('Node.js 运行时校验失败');
 await writeFile(archive,bytes);
}
const target=path.resolve('desktop/runtime');await mkdir(target,{recursive:true});
const extract=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:AD_ARCHIVE); try { foreach($f in @('node.exe','LICENSE')) { $e=$z.GetEntry($env:AD_PREFIX+'/'+$f); [IO.Compression.ZipFileExtensions]::ExtractToFile($e,[IO.Path]::Combine($env:AD_DEST,$f),$true) } } finally { $z.Dispose() }"],{env:{...process.env,AD_ARCHIVE:archive,AD_DEST:target,AD_PREFIX:`node-v${spec.version}-win-x64`},windowsHide:true,encoding:'utf8',timeout:30000});
if(extract.status!==0)throw new Error('运行时解压失败');
const check=spawnSync(path.join(target,'node.exe'),['--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';import {zstdDecompressSync} from 'node:zlib';if(!DatabaseSync||!zstdDecompressSync)process.exit(1);console.log(process.version)"],{windowsHide:true,encoding:'utf8'});
if(check.status!==0||check.stdout.trim()!==`v${spec.version}`)throw new Error('运行时 SQLite / Zstandard 验证失败');
console.log('已校验并准备 Node.js '+spec.version);
