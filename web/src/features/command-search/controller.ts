import {useCallback,useEffect,useRef,useState} from 'react';
import {useLocation} from 'react-router-dom';
export function useCommandNavigation(){
 const location=useLocation();const [openedAt,setOpenedAt]=useState<string|null>(null);
 const invoker=useRef<HTMLElement|null>(null);const destination=useRef<'invoker'|'main'>('invoker');
 const visible=openedAt===location.key;
 const show=useCallback(()=>{
  if(document.querySelector('[aria-modal="true"]'))return;
  invoker.current=document.activeElement instanceof HTMLElement?document.activeElement:null;destination.current='invoker';setOpenedAt(location.key);
 },[location.key]);
 const close=useCallback((navigate=false)=>{destination.current=navigate?'main':'invoker';setOpenedAt(null);},[]);
 useEffect(()=>{if(openedAt!==null&&openedAt!==location.key)setOpenedAt(null);},[openedAt,location.key]);
 useEffect(()=>{
  if(visible)return;const target=destination.current==='main'?document.getElementById('main'):invoker.current;
  if(target?.isConnected)target.focus();
 },[visible]);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if(!shortcut(event))return;
   if(visible){event.preventDefault();document.querySelector<HTMLInputElement>('[data-command-input]')?.focus();return;}
   if(document.querySelector('[aria-modal="true"]'))return;
   event.preventDefault();show();
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[show,visible]);
 return {visible,show,close};
}
function shortcut(event:KeyboardEvent):boolean{
 return (event.key==='k'||event.key==='K')&&(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&!event.repeat&&!event.isComposing&&!event.defaultPrevented;
}
