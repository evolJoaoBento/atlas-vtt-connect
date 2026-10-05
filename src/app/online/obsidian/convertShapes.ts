/** The GM's fog, texts and drawings as Atlas records, field by field. */
import type { DrawingStroke, FogOperation, TextElement } from '@atlas-vtt/api-types';
import type { PlayerDrawing, PlayerFogOp, PlayerText, ScenePoint } from '../scene/sceneTypes';

const copyPoints = (points: readonly ScenePoint[]): Array<{ x: number; y: number }> => points.map(({ x, y }) => ({ x, y }));

/** The GM applied the operation's drag offset before sending it, so the record has none. */
export function atlasFog(id: string, op: PlayerFogOp): FogOperation {
  const base = { id, kind: 'fog' as const, timestamp: op.order, isErasing: op.erase };
  switch (op.type) {
    case 'brush':
      return { ...base, type: 'brush', brushRadius: op.radius, points: copyPoints(op.points) };
    case 'lasso':
      return { ...base, type: 'lasso', points: copyPoints(op.points) };
    case 'rectangle':
      return { ...base, type: 'rectangle', x: op.x, y: op.y, width: op.width, height: op.height };
  }
}

export function atlasText(id: string, text: PlayerText): TextElement {
  return {
    id,
    kind: 'text',
    x: text.x,
    y: text.y,
    text: text.text,
    fontSize: text.fontSize,
    fontFamily: text.fontFamily,
    color: text.color,
    ...(text.backgroundColor !== null ? { backgroundColor: text.backgroundColor } : {}),
    padding: text.padding,
    borderRadius: text.borderRadius,
    opacity: text.opacity,
    ...(text.width !== null ? { width: text.width } : {}),
    ...(text.height !== null ? { height: text.height } : {}),
    align: text.align,
    bold: text.bold,
    italic: text.italic,
    rotation: text.rotation,
    scale: text.scale,
  };
}

export function atlasDrawing(id: string, drawing: PlayerDrawing): DrawingStroke {
  return {
    id,
    kind: 'drawing',
    timestamp: drawing.order,
    type: drawing.type,
    points: copyPoints(drawing.points),
    color: drawing.color,
    width: drawing.width,
    opacity: drawing.opacity,
    ...(drawing.icon !== null ? { icon: drawing.icon } : {}),
  };
}
