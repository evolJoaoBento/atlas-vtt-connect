export type EditMatrix = [number,number,number,number,number,number];
export function isEditMatrix(value: unknown): value is EditMatrix {
  if (!Array.isArray(value) || value.length !== 6 || !value.every(n=>typeof n==='number' && Number.isFinite(n) && Math.abs(n)<=200000)) return false;
  const [a,b,c,d]=value as number[];const width=Math.hypot(a!,b!),height=Math.hypot(c!,d!);
  return width>=8 && height>=8 && width<=200000 && height<=200000 && a!*d!-b!*c!>1;
}
export function mapPoint(m: readonly number[],u:number,v:number): {x:number;y:number} { return {x:m[0]!*u+m[2]!*v+m[4]!,y:m[1]!*u+m[3]!*v+m[5]!}; }
export function resizeMap(m: EditMatrix,handle:string,point:{x:number;y:number},start:{x:number;y:number}): EditMatrix {
  const [a,b,c,d,e,f]=m;
  if(handle==='move')return [a,b,c,d,e+point.x-start.x,f+point.y-start.y];
  const det=a*d-b*c;const dx=point.x-e,dy=point.y-f;
  const u=(d*dx-c*dy)/det,v=(-b*dx+a*dy)/det;
  const minU=8/Math.hypot(a,b),minV=8/Math.hypot(c,d);
  const left=handle.includes('w')?Math.min(u,1-minU):0,right=handle.includes('e')?Math.max(u,minU):1;
  const top=handle.includes('n')?Math.min(v,1-minV):0,bottom=handle.includes('s')?Math.max(v,minV):1;
  return [a*(right-left),b*(right-left),c*(bottom-top),d*(bottom-top),e+a*left+c*top,f+b*left+d*top];
}

export function matrixBounds(m: readonly number[]): {x:number;y:number;width:number;height:number} {
  const points=[mapPoint(m,0,0),mapPoint(m,1,0),mapPoint(m,1,1),mapPoint(m,0,1)];
  const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
  return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
}
