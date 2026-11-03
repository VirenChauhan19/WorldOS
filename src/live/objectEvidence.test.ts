import {expect,it} from 'vitest';
import type {SceneObject} from '../types';
import {imageLocation,matchesRememberedObject} from './objectEvidence';

const remembered:SceneObject={id:'place-1-item-2',label:'Laptop',locked:false,box:{x:.2,y:.3,width:.2,height:.2}};

it('matches a nearby same-label candidate despite independent live and memory IDs',()=>{
  const live={...remembered,id:'device-9',box:{...remembered.box,x:.22,y:.31}};
  expect(matchesRememberedObject(live,remembered)).toBe(true);
  expect(matchesRememberedObject(remembered,live)).toBe(true);
});

it('requires the same normalized label, including case and whitespace normalization',()=>{
  expect(matchesRememberedObject({...remembered,label:'  LAPTOP  '},remembered)).toBe(true);
  expect(matchesRememberedObject({...remembered,label:'CELL   phone'},{...remembered,label:'cell phone'})).toBe(true);
  expect(matchesRememberedObject({...remembered,label:'Laptop computer'},remembered)).toBe(false);
  expect(matchesRememberedObject({...remembered,label:'Book'},remembered)).toBe(false);
  expect(matchesRememberedObject({...remembered,label:' '},{...remembered,label:''})).toBe(false);
});

it('rejects different positions and tiny overlaps even when IDs and labels are identical',()=>{
  expect(matchesRememberedObject({...remembered,box:{...remembered.box,x:.7}},remembered)).toBe(false);
  expect(matchesRememberedObject({...remembered,box:{...remembered.box,x:.39}},remembered)).toBe(false);
  expect(matchesRememberedObject({...remembered,box:{...remembered.box,x:.4}},remembered)).toBe(false);
});

it('requires substantial intersection over union rather than just containing a small detection',()=>{
  expect(matchesRememberedObject({...remembered,box:{x:.25,y:.35,width:.05,height:.05}},remembered)).toBe(false);
  expect(matchesRememberedObject({...remembered,box:{...remembered.box,x:.27}},remembered)).toBe(true);
  expect(matchesRememberedObject({...remembered,box:{...remembered.box,x:.28}},remembered)).toBe(false);
});

it('rejects invalid geometry instead of interpreting it as supporting evidence',()=>{
  for(const box of [{...remembered.box,width:0},{...remembered.box,height:-1},{...remembered.box,x:NaN},{...remembered.box,height:Infinity}]){
    expect(matchesRememberedObject({...remembered,box},remembered)).toBe(false);
    expect(matchesRememberedObject(remembered,{...remembered,box})).toBe(false);
  }
});

it('describes the center of an object in each image region',()=>{
  for(const [y,vertical] of [[.1,'Upper'],[.5,'Middle'],[.9,'Lower']] as const){
    for(const [x,horizontal] of [[.1,'left'],[.5,'center'],[.9,'right']] as const){
      expect(imageLocation({...remembered,box:{x:x-.05,y:y-.05,width:.1,height:.1}})).toBe(`${vertical} ${horizontal}`);
    }
  }
});
