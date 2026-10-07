export function plain(value) {return String(value||'').replace(/```[\s\S]*?```/g,' ').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,' ').replace(/[#*`_]/g,'').replace(/\s+/g,' ').trim();}
export function compactTitle(title,goal='',project='') {
  const original=plain(title);if(original&&original!=='未命名会话'&&original.length<=28&&!/command-name|No response requested|Repo:/i.test(title))return original;
  const text=plain(title+' '+goal).slice(0,12000);
  const label=/PostgreSQL|postgres\d*/i.test(text)?'PostgreSQL':/MySQL/i.test(text)?'MySQL':/Redis/i.test(text)?'Redis':/DeerFlow|deer-flow/i.test(text)?'DeerFlow':/OpenShell/i.test(text)?'OpenShell':/TechSpar/i.test(text)?'TechSpar':/AgentDock/i.test(text)?'AgentDock':project&&!['ASUS','未归属项目','codex_pr','opensource_project'].includes(project)?project:'Agent';
  const action=/\bPR\b|pull request|contribut|开源贡献/i.test(text)?'PR 方案':/bug|fix|修复|错误|故障/i.test(text)?'问题修复':/review|审查|评审/i.test(text)?'代码审查':/plan|规划|计划|学习路线/i.test(text)?'工作规划':/模型|command-name|\/model/i.test(title)?'模型配置':'工作讨论';
  if(!text||(title==='未命名会话'&&!goal))return '未命名会话';
  return `${label.slice(0,20)} ${action}`;
}
export function compactSummary(value){const text=plain(value);if(/^No response requested\.?$/i.test(text))return '配置操作，暂无工作结论';return text.slice(0,120)+(text.length>120?'…':'');}
