'use client';
import {useEffect} from 'react';
import {useUser} from '@clerk/nextjs';
export default function IdentityObserver({onChange}:{onChange:(id:string|null)=>void}){
  const {isLoaded,user}=useUser();
  useEffect(()=>{if(isLoaded)onChange(user?.id||null);},[isLoaded,user?.id,onChange]);
  return null;
}
