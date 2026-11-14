import {isEditMatrix,mapPoint,resizeMap,type EditMatrix} from '../src/app/online/control/mapEdits';
import type {PlayerScene} from '../src/app/online/scene/sceneTypes';
type Point={x:number;y:number};
const HANDLES: [string,number,number][]=[['nw',0,0],['n',.5,0],['ne',1,0],['e',1,.5],['se',1,1],['s',.5,1],['sw',0,1],['w',0,.5]];
export class MapEditView {
  private readonly svg: SVGSVGElement;
  private readonly events=new AbortController();
  private scene: PlayerScene|null=null;
  private matrix: EditMatrix|null=null;
  private keyEditing=false;
  private connected=false;
  private enabled=false;
  private drag: {start:Point;matrix:EditMatrix;handle:string;pointer:number}|null=null;
  constructor(private readonly canvas:HTMLCanvasElement,private readonly button:HTMLButtonElement,private readonly world:(p:Point)=>Point,private readonly screen:(p:Point)=>Point,private readonly preview:(matrix:EditMatrix|null)=>void,private readonly send:(matrix:EditMatrix)=>boolean,private readonly zoom?:(point:Point,dy:number,mode:number)=>void){
    const doc=canvas.ownerDocument;this.svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');
    this.svg.setAttribute('aria-label','Alças de edição do mapa');this.svg.classList.add('map-edit-overlay');canvas.parentElement?.append(this.svg);
    const signal=this.events.signal;
    button.addEventListener('click',()=>this.setEnabled(!this.enabled),{signal});
    this.svg.addEventListener('pointerdown',event=>{
      const handle=(event.target as Element).getAttribute('data-handle');if(!handle||!this.enabled||this.drag||event.button!==0||!this.matrix)return;
      event.preventDefault();event.stopPropagation();const rect=canvas.getBoundingClientRect();
      this.drag={start:this.world({x:event.clientX-rect.left,y:event.clientY-rect.top}),matrix:[...this.matrix],handle,pointer:event.pointerId};
      this.svg.setPointerCapture(event.pointerId);
    },{signal});
    this.svg.addEventListener('pointermove',event=>{
      const drag=this.drag;if(!drag||event.pointerId!==drag.pointer)return;
      const rect=canvas.getBoundingClientRect();const next=resizeMap(drag.matrix,drag.handle,this.world({x:event.clientX-rect.left,y:event.clientY-rect.top}),drag.start);
      if(isEditMatrix(next)){this.matrix=next;this.preview(next);this.refresh();}
    },{signal});
    this.svg.addEventListener('pointerup',event=>{
      if(!this.drag||event.pointerId!==this.drag.pointer)return;
      this.drag=null;if(this.matrix&&!this.send(this.matrix))this.preview(null);
    },{signal});
    this.svg.addEventListener('wheel',event=>{if(!this.enabled)return;event.preventDefault();const box=canvas.getBoundingClientRect();this.zoom?.({x:event.clientX-box.left,y:event.clientY-box.top},event.deltaY,event.deltaMode);},{signal,passive:false});
    this.svg.addEventListener('keydown',event=>{
      const handle=(event.target as Element).getAttribute('data-handle');if(!this.enabled||!this.matrix||!handle||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();const step=event.shiftKey?10:1;
      const anchor=HANDLES.find(([name])=>name===handle);const start=mapPoint(this.matrix,anchor?.[1]??0,anchor?.[2]??0);
      const point={x:start.x+(event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0),y:start.y+(event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0)};
      const next=resizeMap(this.matrix,handle,point,start);if(isEditMatrix(next)){this.keyEditing=true;this.matrix=next;this.preview(next);this.refresh();}
    },{signal});
    this.svg.addEventListener('keyup',event=>{if(this.keyEditing&&event.key.startsWith('Arrow')){this.keyEditing=false;if(this.matrix&&!this.send(this.matrix))this.cancel();}},{signal});
    doc.defaultView?.addEventListener('blur',()=>{if(this.keyEditing)this.cancel();},{signal});
    this.svg.addEventListener('pointercancel',()=>this.cancel(),{signal});
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&this.enabled){this.setEnabled(false);event.preventDefault();}},{signal,capture:true});
    this.refresh();
  }
  private base():EditMatrix|null {const map=this.scene?.map;return map&&map.width>0&&map.height>0?[...(map.matrix??[map.width,0,0,map.height,0,0])] as EditMatrix:null;}
  private cancel():void {this.drag=null;this.keyEditing=false;this.matrix=this.base();this.preview(null);this.refresh();}
  private setEnabled(value:boolean):void {this.enabled=value&&this.connected&&!!this.scene?.map.asset;this.cancel();}
  setConnected(value:boolean):void {this.connected=value;if(!value)this.setEnabled(false);this.refresh();}
  setScene(scene:PlayerScene|null):void {if(scene?.sceneId!==this.scene?.sceneId||scene?.map.asset!==this.scene?.map.asset){this.enabled=false;this.drag=null;}this.scene=scene;if(!this.drag&&!this.keyEditing){this.matrix=this.base();this.preview(null);}this.refresh();}
  refresh():void {
    this.button.disabled=!this.connected||!this.scene?.map.asset;
    this.button.setAttribute('aria-pressed',String(this.enabled));this.button.textContent=this.enabled?'Concluir edição':'Editar mapa';
    this.svg.style.display=this.enabled?'block':'none';if(!this.enabled||!this.matrix)return;
    const box=this.canvas.getBoundingClientRect();Object.assign(this.svg.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
    const m=this.matrix;const doc=this.canvas.ownerDocument;const focused=this.svg.contains(doc.activeElement)?doc.activeElement?.getAttribute('data-handle'):null;const polygon=doc.createElementNS(this.svg.namespaceURI,'polygon');
    polygon.setAttribute('points',[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>{const p=this.screen(mapPoint(m,u!,v!));return `${p.x},${p.y}`;}).join(' '));
    polygon.setAttribute('data-handle','move');polygon.setAttribute('tabindex','0');polygon.setAttribute('role','button');polygon.setAttribute('aria-label','Mover mapa com as setas');polygon.setAttribute('class','map-edit-outline');this.svg.replaceChildren(polygon);
    for(const [name,u,v] of HANDLES){const p=this.screen(mapPoint(m,u,v));const handle=doc.createElementNS(this.svg.namespaceURI,'rect');
      for(const [key,value] of Object.entries({x:p.x-7,y:p.y-7,width:14,height:14,'data-handle':name,class:'map-edit-handle'}))handle.setAttribute(key,String(value));
      handle.setAttribute('tabindex','0');handle.setAttribute('role','button');
      handle.setAttribute('aria-label',`Redimensionar mapa ${name}`);this.svg.append(handle);
    }
    if(focused&&!this.drag)this.svg.querySelector<SVGElement>(`[data-handle="${focused}"]`)?.focus();
  }
  reject():void {this.setEnabled(false);}
  dispose():void {this.events.abort();this.svg.remove();}
}
