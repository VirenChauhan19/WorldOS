import { describe, expect, it } from 'vitest';
import { furnitureMeshes, material, fixtureLightColor } from './furnitureGeometry';
import type { SceneMesh } from './furnitureGeometry';
import { FURNITURE_PRESETS, orientedSize } from './layout';
import type { FurnitureItem, FurniturePlacement } from './layout';
import { AR_CATALOG, createCatalogItem } from '../ar/catalog';

const placement = (item: FurnitureItem, rotation: 0 | 90 | 180 | 270 = 0): FurniturePlacement => ({ itemId: item.id, x: 3.2, z: -1.7, rotation });
const points = (meshes: SceneMesh[]) => meshes.flatMap(mesh => {
  const result: number[][] = [];
  for (let i = 0; i < mesh.vertices.length; i += 3) result.push(mesh.vertices.slice(i, i + 3));
  return result;
});

describe('shared furniture geometry', () => {
  it.each(FURNITURE_PRESETS.map(item => [item.kind, item] as const))('keeps %s at the exact measured bounds in all four orientations', (_, preset) => {
    // Include extreme aspect ratios so leg thickness cannot escape a shallow footprint.
    for (const [width, depth, height] of [[preset.width, preset.depth, preset.height], [3, .05, .4], [.05, 3, 2.5]]) {
      const item = { ...preset, width, depth, height };
      for (const rotation of [0, 90, 180, 270] as const) {
        const at = placement(item, rotation), size = orientedSize(item, rotation);
        const vertices = points(furnitureMeshes(item, at));
        expect(vertices.length).toBeGreaterThan(0);
        for (const [axis, min, max] of [[0, at.x, at.x + size.width], [1, 0, height], [2, at.z, at.z + size.depth]]) {
          const values = vertices.map(point => point[axis]);
          expect(Math.min(...values)).toBeCloseTo(min, 9);
          expect(Math.max(...values)).toBeCloseTo(max, 9);
        }
      }
    }
  });

  it('emits finite, nondegenerate triangles and normalized colors suitable for WebGL and WebXR', () => {
    for (const item of FURNITURE_PRESETS) {
      for (const mesh of furnitureMeshes(item, placement(item, 90))) {
        expect(mesh.vertices.length % 9).toBe(0);
        expect(mesh.vertices.every(Number.isFinite)).toBe(true);
        expect(mesh.color).toHaveLength(4);
        expect(mesh.color.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
        for (let i = 0; i < mesh.vertices.length; i += 9) {
          const [a, b, c] = [0, 3, 6].map(offset => mesh.vertices.slice(i + offset, i + offset + 3));
          const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
          const area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
          expect(area).toBeGreaterThan(1e-12);
        }
      }
    }
  });

  it('rotates an asymmetric bed around its new minimum footprint corner without changing its dimensions', () => {
    const bed = FURNITURE_PRESETS.find(item => item.kind === 'bed')!;
    const at = placement(bed, 90);
    const headboard = points(furnitureMeshes(bed, at)).filter(point => point[1] > bed.height * .8);
    expect(headboard.length).toBeGreaterThan(0);
    expect(Math.min(...headboard.map(point => point[0]))).toBeCloseTo(at.x + bed.depth * .955);
    expect(Math.max(...headboard.map(point => point[0]))).toBeCloseTo(at.x + bed.depth);
    expect(Math.min(...headboard.map(point => point[2]))).toBeCloseTo(at.z);
    expect(Math.max(...headboard.map(point => point[2]))).toBeCloseTo(at.z + bed.width);
  });

  it.each(['desk', 'table'] as const)('applies the selected %s finish to its visible top', kind => {
    const item = { ...FURNITURE_PRESETS.find(value => value.kind === kind)!, color: '#234567' };
    const meshes = furnitureMeshes(item, placement(item));
    const tops = meshes.filter(mesh => mesh.vertices.every((value, index) => index % 3 !== 1 || Math.abs(value - item.height) < 1e-9));
    expect(tops.some(mesh => mesh.color.every((value, index) => value === material(item.color)[index]))).toBe(true);
  });

  it('places wardrobe doors in front of the carcass and handles in front of the doors', () => {
    const item = FURNITURE_PRESETS.find(value => value.kind === 'wardrobe')!;
    const meshes = furnitureMeshes(item, { ...placement(item), x: 0, z: 0 });
    const front = (color: SceneMesh['color']) => Math.max(...points(meshes.filter(mesh => mesh.color.every((value, index) => Math.abs(value - color[index]) < 1e-9))).map(point => point[2]));
    // Every box uses the same directional shading on its forward face.
    const body = front(material('#b69a77', .83));
    const door = front(material(item.color, .83));
    const handle = front(material('#505343', .83));
    expect(door).toBeGreaterThan(body);
    expect(handle).toBeGreaterThan(door);
    expect(handle).toBeCloseTo(item.depth);
  });

  it('rejects invalid dimensions and placements instead of uploading corrupt geometry', () => {
    const item = FURNITURE_PRESETS[0], at = placement(item);
    for (const invalid of [NaN, Infinity, -1, 0]) {
      expect(furnitureMeshes({ ...item, width: invalid }, at)).toEqual([]);
      expect(furnitureMeshes({ ...item, depth: invalid }, at)).toEqual([]);
      expect(furnitureMeshes({ ...item, height: invalid }, at)).toEqual([]);
    }
    expect(furnitureMeshes(item, { ...at, x: NaN })).toEqual([]);
    expect(furnitureMeshes(item, { ...at, z: Infinity })).toEqual([]);
    expect(furnitureMeshes(item, { ...at, rotation: 45 as 0 })).toEqual([]);
  });

  it('preserves caller data and returns independent mesh arrays', () => {
    const item = { ...FURNITURE_PRESETS[0] }, at = placement(item), before = structuredClone({ item, at });
    const first = furnitureMeshes(item, at), second = furnitureMeshes(item, at);
    first[0].vertices[0] = 999;
    expect(second[0].vertices[0]).not.toBe(999);
    expect({ item, at }).toEqual(before);
  });

  it('keeps highlighted white upholstery within the color range accepted by WebXR', () => {
    const bed = { ...FURNITURE_PRESETS[0], color: '#ffffff' };
    const meshes = furnitureMeshes(bed, placement(bed));
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every(mesh => mesh.color.every(value => value >= 0 && value <= 1))).toBe(true);
  });

  it('raises a model onto a surface without changing its footprint or accepting corrupt elevations', () => {
    const item = FURNITURE_PRESETS[1], ground = furnitureMeshes(item, placement(item));
    const elevated = furnitureMeshes(item, { ...placement(item), elevation: .8 });
    expect(elevated).toHaveLength(ground.length);
    for (let mesh = 0; mesh < ground.length; mesh++) {
      expect(elevated[mesh].vertices).toEqual(ground[mesh].vertices.map((value, axis) => axis % 3 === 1 ? value + .8 : value));
    }
    for (const elevation of [-.1, 10.1, NaN, Infinity]) expect(furnitureMeshes(item, { ...placement(item), elevation })).toEqual([]);
  });

  it('keeps capsule-shaped sofa arms free of degenerate seams for solid-model export', () => {
    const sofa = { ...FURNITURE_PRESETS[0], kind: 'sofa' as const };
    for (const mesh of furnitureMeshes(sofa, placement(sofa))) {
      for (let index = 0; index < mesh.vertices.length; index += 9) {
        const [a, b, c] = [0, 3, 6].map(offset => mesh.vertices.slice(index + offset, index + offset + 3));
        const u = b.map((value, axis) => value - a[axis]), v = c.map((value, axis) => value - a[axis]);
        expect(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])).toBeGreaterThan(1e-15);
      }
    }
  });

  it('exports each detailed wall and ceiling concept as finite solids within editable bounds',()=>{
    for(const entry of AR_CATALOG.filter(entry=>entry.item.model)){
      for(const dimensions of [{width:entry.item.width,depth:entry.item.depth,height:entry.item.height},{width:2,depth:.02,height:.3},{width:.03,depth:1.5,height:2.5}]){
        const item={...entry.item,...dimensions};
        for(const rotation of [0,90,180,270] as const){
          const at={...placement(item,rotation),elevation:1.2},size=orientedSize(item,rotation),meshes=furnitureMeshes(item,at);
          expect(meshes.length,entry.id).toBeGreaterThan(6);
          const limits=[[at.x,at.x+size.width],[1.2,1.2+item.height],[at.z,at.z+size.depth]];
          for(const mesh of meshes){
            expect(mesh.vertices.every((value,index)=>Number.isFinite(value)&&value>=limits[index%3][0]-1e-9&&value<=limits[index%3][1]+1e-9),`${entry.id} ${rotation}`).toBe(true);
            expect(mesh.color.every(value=>Number.isFinite(value)&&value>=0&&value<=1)).toBe(true);
            for(let index=0;index<mesh.vertices.length;index+=9){
              const [a,b,c]=[0,3,6].map(offset=>mesh.vertices.slice(index+offset,index+offset+3));
              const u=b.map((value,axis)=>value-a[axis]),v=c.map((value,axis)=>value-a[axis]);
              expect(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]),entry.id).toBeGreaterThan(1e-15);
            }
          }
          expect(meshes.reduce((sum,mesh)=>sum+mesh.vertices.length/9,0)).toBeLessThan(5000);
        }
      }
    }
  });

  it('keeps wall backs on the mounting plane and ceiling canopies at the declared top',()=>{
    for(const id of ['wall-art','wall-mirror','wall-clock','wall-shelf','wall-sconce','curtains','wall-tv','pendant-light','ceiling-light']){
      const item=createCatalogItem(id),vertices=points(furnitureMeshes(item,{itemId:item.id,x:0,z:0,rotation:0}));
      expect(Math.min(...vertices.map(point=>point[1])),id).toBeCloseTo(0,9);
      expect(Math.max(...vertices.map(point=>point[1])),id).toBeCloseTo(item.height,9);
      expect(Math.min(...vertices.map(point=>point[2])),id).toBeCloseTo(0,9);
      expect(Math.max(...vertices.map(point=>point[2])),id).toBeCloseTo(item.depth,9);
    }
  });

  it('changes only fixture appearance when toggling, dimming, or choosing a light temperature',()=>{
    for(const id of ['floor-lamp','table-lamp','pendant-light','ceiling-light','wall-sconce']){
      const item=createCatalogItem(id),at={itemId:item.id,x:0,z:0,rotation:0 as const};
      const on=furnitureMeshes(item,at),off=furnitureMeshes({...item,light:{...item.light!,enabled:false}},at);
      expect(on.map(mesh=>mesh.vertices)).toEqual(off.map(mesh=>mesh.vertices));
      expect(on.map(mesh=>mesh.color)).not.toEqual(off.map(mesh=>mesh.color));
      const warm=fixtureLightColor({...item,light:{enabled:true,temperature:2700,brightness:100}}),cool=fixtureLightColor({...item,light:{enabled:true,temperature:6500,brightness:100}});
      expect(warm[0]).toBeGreaterThan(warm[2]);expect(cool[2]).toBeGreaterThan(cool[0]);
      expect(fixtureLightColor({...item,light:{enabled:true,temperature:2700,brightness:0}})).toEqual(fixtureLightColor({...item,light:{enabled:false,temperature:2700,brightness:100}}));
      const dim=fixtureLightColor({...item,light:{enabled:true,temperature:2700,brightness:20}});
      expect(dim[0]).toBeLessThan(warm[0]);
    }
  });
});
