import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function Dialog({open,onClose,title,children}:{open:boolean;onClose:()=>void;title:string;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null),close=useRef(onClose),id=useId();close.current=onClose;
  useEffect(()=>{
    if(!open)return;
    const dialog=ref.current!,previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');
    (dialog.querySelector<HTMLElement>('[autofocus], input, select, button')??dialog).focus();
    return()=>{if(dialog.close)dialog.close();else dialog.removeAttribute('open');document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[open]);
  if(!open)return null;
  return createPortal(<dialog ref={ref} className="worldos-dialog" aria-labelledby={id} tabIndex={-1}
    onCancel={event=>{event.preventDefault();close.current();}}
    onClick={event=>{if(event.target===event.currentTarget){const box=event.currentTarget.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close.current();}}}
    onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();close.current();}
      if(event.key!=='Tab')return;
      const items=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex]')).filter(item=>!item.matches(':disabled')&&!item.closest('[hidden]')&&item.tabIndex>=0);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }}>
    <header><h2 id={id}>{title}</h2><button className="icon-button" aria-label={`Close ${title}`} onClick={onClose}><X size={20}/></button></header>
    {children}
  </dialog>,document.body);
}
