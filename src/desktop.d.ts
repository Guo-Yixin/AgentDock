interface DesktopPreferences {autoStart:boolean;notifications:boolean}
interface Window {agentdock?:{
 preferences():Promise<DesktopPreferences>;
 setPreferences(p:Partial<DesktopPreferences>):Promise<DesktopPreferences>;
 chooseSource(id:string):Promise<string|null>;
 importSettings():Promise<{cancelled?:boolean;ok?:boolean}>;
 checkUpdate():Promise<{current:string;latest:string|null}>;
 openDownloads():Promise<void>;
 retry():Promise<boolean>;
}}
