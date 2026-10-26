import type {Rectangle} from 'electron';
/** All inputs are Electron screen DIP coordinates, including negative monitors. */
export function fitWindow(bounds:Rectangle|undefined,area:Rectangle):Rectangle{const width=Math.min(area.width,Math.max(420,bounds?.width||960)),height=Math.min(area.height,Math.max(360,bounds?.height||680));return {width,height,x:Math.max(area.x,Math.min(bounds?.x??area.x+Math.round((area.width-width)/2),area.x+area.width-width)),y:Math.max(area.y,Math.min(bounds?.y??area.y+Math.round((area.height-height)/2),area.y+area.height-height))};}
