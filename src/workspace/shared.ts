import { request, saveFile as download } from '../api';
import { useEffect, useRef, useState } from 'react';
import type { Evidence, Overview, Task, TaskPage, Todo } from '../types';
import { demoOverview, demoPage } from '../demo';
export async function api<T>(url: string, data?: unknown, method = 'POST'): Promise<T> {return request<T>(url,data===undefined?undefined:{method,body:JSON.stringify(data)});}
export const today = () => new Date(Date.now() + 28800000).toISOString().slice(0, 10);
export const datetime = (n: number) => new Date(n + 28800000).toISOString().slice(0, 16);
export const epoch = (s: string) => Date.parse(s.length===10?s+'T00:00:00+08:00':s+':00+08:00');
export interface ContextRef { type: 'task' | 'project' | 'report' | 'schedule' | 'goal' | 'memory' | 'workflow'; id: string; includeTranscript?: boolean; branchId?: string }
export interface Health { connected: boolean; message: string; configured: boolean; legacyAvailable: boolean }
export interface Discovery { id: string; name: string; root: string; executable: string; enabled: boolean; exists: boolean; discoveredBy: string }
export interface Settings { database: { host: string; port: number; user: string; database: string; tls: boolean; ca: string } | null; databaseFromEnv: boolean; hasKey: boolean; keyFromEnv: boolean; model: string; sources: Discovery[]; health: Health; issue: string }
export interface Fact { taskId: string; title: string; summary: string; confirmed: boolean; reported: boolean; blocked: boolean; evidence: Evidence; todos: Todo[] }
export interface Report { id: string; title: string; date: string; kind: string; facts: { items: Fact[]; activityCount: number; confirmed: number; reported: number; blocked: number }; userText: string; versions: { text: string; model: string }[] }
export interface Schedule { id?: string; title: string; note: string; start: number; end: number; allDay: boolean; done: boolean; reminderMinutes: number; taskId: string; projectId: string }
export interface Preview { id: string; text: string; characters: number; estimatedTokens: number; fingerprint: string; sources: (ContextRef & { number: number; title: string; evidence?: Evidence })[] }
export interface Chat { id: string; title: string; messages: { role: string; text: string; status?: string; error?: string; sources?: Preview['sources'] }[] }
export interface Props { demo: boolean; overview: Overview | null; refs: ContextRef[]; setRefs: (r: ContextRef[]) => void; openTask: (id: string) => void; notify: (s: string) => void; view: string; revision: number; questionDraft?: string; onRemember?: (d: {title:string;text:string;refs:ContextRef[]}) => void; draft?: {title: string;note: string}; onDraft: (draft: {title: string;note: string}) => void; onSource: (ref: ContextRef) => void; focus?: ContextRef }

export function useUnsavedChanges(dirty:boolean){useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[dirty]);}
