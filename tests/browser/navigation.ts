import {expect,type Page,type Locator} from '@playwright/test';

export async function section(page:Page,id:string,value:string){
 const select=page.locator('select').and(page.getByLabel(id,{exact:true}));
 await expect(select).toBeAttached();
 if(await select.isVisible())await select.selectOption(value);
 else {const label=await select.locator(`option[value="${value}"]`).textContent();await page.getByRole('navigation',{name:id,exact:true}).getByRole('button',{name:label!,exact:true}).click();}await expect(select).toHaveValue(value);
}

// Follow the same tabs and edit steps as a user, never force hidden inputs.
export async function reveal(page:Page,control:Locator){
 await control.waitFor({state:'attached'});
 for(let attempt=0;attempt<16&&!await control.isVisible();attempt++){
  const tab=await control.evaluate(el=>{
   let node:Element|null=el;const hidden:Element[]=[];
   while(node){if(node.matches('.screen-pane[hidden]'))hidden.unshift(node);node=node.parentElement;}
   if(!hidden.length)return null;
   const pane=hidden[0],select=pane.parentElement!.querySelector(':scope > .screen-switcher select') as HTMLSelectElement;
   return {id:select.getAttribute('aria-label')!,value:pane.getAttribute('aria-label')!};
  });
  if(tab){await section(page,tab.id,tab.value);continue;}
  const group=control.locator('xpath=ancestor::section[contains(@class,"nav-group")]');
  if(await group.count()){await group.locator('.nav-group-toggle').click();continue;}
  const steps=control.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " form-steps ")]').last();
  if(await steps.count()){const target=await control.evaluate(el=>el.closest('.step-field')!.getAttribute('data-step'));await steps.locator('.pagination input').fill(target!);await expect(control).toBeVisible();}
  else break;
 }
 await expect(control).toBeVisible();return control;
}
