import {epoch} from './shared';
import type {Schedule} from './shared';
export function calendarSuggestions(date:string):Schedule[]{
 const weekday=new Date(date+'T00:00:00Z').getUTCDay();
 const templates=weekday===0||weekday===6?[['周末整理','轻量整理待办，为下周留出空间。',10,30]]:[['每日计划','选出今天最重要的三件事，安排专注时段。',9,20],['午间休息','离开屏幕、走动片刻，留出恢复精力的时间。',12,60],['下班复盘','记录完成事项、阻塞与明天的第一步。',17,20],...(weekday===5?[['周五总结','回顾本周目标，整理经验和下周安排。',16,40]]:[])];
 return templates.map(([title,note,hour,minutes])=>({title:String(title),note:String(note),start:epoch(date)+Number(hour)*3600000,end:epoch(date)+Number(hour)*3600000+Number(minutes)*60000,allDay:false,done:false,reminderMinutes:15,taskId:'',projectId:''}));
}
