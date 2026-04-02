export const SVG_WIDTH = 1200;
export const SVG_HEIGHT = 900;

let idCounter = 1;
function nextId(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

export const TOOL_DEFAULTS = {
  square: { widthCm: 400, heightCm: 300 },
  line: { lengthCm: 300 },
  door: { widthCm: 90, heightCm: 90 },
  window: { lengthCm: 120 },
  opening: { widthCm: 100, heightCm: 220 },
  note: { widthCm: 140, heightCm: 80 },
};

export const appState = {
  selectedTool: 'square',
  dragFromToolbar: null,
  view: {
    panX: 0,
    panY: 0,
    zoom: 1,
    minZoom: 0.35,
    maxZoom: 4,
  },
  pointer: {
    mode: 'idle',
    pointerId: null,
    startWorld: null,
    startScreen: null,
    targetId: null,
    handle: null,
    original: null,
    rotationClickCandidate: false,
    guides: null,
  },
  pinch: {
    active: false,
    pointerA: null,
    pointerB: null,
    startDistance: 0,
    startZoom: 1,
    startWorldMid: null,
  },
  project: {
    settings: {
      scalePxPerCm: 1.5,
      snapEnabled: true,
      snapThresholdPx: 34,
      guideThresholdPx: 24,
      rotateSnapDeg: 45,
      lineSnapDistancePx: 28,
      lineAxisBreakPx: 18,
    },
    selection: null,
    shapes: [],
    derivedFaces: [],
    activeGuides: [],
  },
};

export function setSelectedTool(tool) {
  appState.selectedTool = tool;
}

export function getShapeHandleSessionBaseAngle(shape) {
  if (!shape) return 0;
  if (shape.type === 'rect') return normalizeAngle(shape.rotation || 0);
  if (shape.type === 'line') return normalizeAngle((Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1) * 180) / Math.PI);
  return 0;
}

export function clearSelection() {
  appState.project.selection = null;
}

export function setSelection(selection) {
  if (!selection || selection.type !== 'shape') {
    appState.project.selection = selection;
    return;
  }
  const shape = appState.project.shapes.find((item) => item.id === selection.id) || null;
  appState.project.selection = {
    ...selection,
    handleBaseAngle: getShapeHandleSessionBaseAngle(shape),
  };
}

export function getSelectedShape() {
  const selected = appState.project.selection;
  if (!selected || selected.type !== 'shape') return null;
  return appState.project.shapes.find((shape) => shape.id === selected.id) || null;
}


export function getDefaultShapeMetrics(tool) {
  const scale = appState.project.settings.scalePxPerCm;
  if (tool === 'line' || tool === 'window') {
    const defaults = TOOL_DEFAULTS[tool] || TOOL_DEFAULTS.line;
    return { lengthPx: defaults.lengthCm * scale };
  }
  const fallback = TOOL_DEFAULTS[tool] || TOOL_DEFAULTS.square;
  if (tool === 'door') {
    const sizePx = fallback.widthCm * scale;
    return { widthPx: sizePx, heightPx: sizePx, sizePx };
  }
  return { widthPx: fallback.widthCm * scale, heightPx: fallback.heightCm * scale };
}

export function createShapeFromTool(tool, x, y) {
  const scale = appState.project.settings.scalePxPerCm;
  if (tool === 'line' || tool === 'window') {
    const defaults = TOOL_DEFAULTS[tool] || TOOL_DEFAULTS.line;
    const lengthPx = defaults.lengthCm * scale;
    const shape = {
      id: nextId(tool),
      type: 'line',
      tool,
      x1: x - lengthPx / 2,
      y1: y,
      x2: x + lengthPx / 2,
      y2: y,
    };
    appState.project.shapes.push(shape);
    setSelection({ type: 'shape', id: shape.id });
    return shape;
  }
  if (tool === 'door') {
    const sizePx = TOOL_DEFAULTS.door.widthCm * scale;
    const shape = {
      id: nextId('door'),
      type: 'rect',
      tool: 'door',
      x: x - sizePx / 2,
      y: y - sizePx / 2,
      widthPx: sizePx,
      heightPx: sizePx,
      rotation: 0,
    };
    appState.project.shapes.push(shape);
    setSelection({ type: 'shape', id: shape.id });
    return shape;
  }
  const fallback = TOOL_DEFAULTS[tool] || TOOL_DEFAULTS.square;
  const widthPx = fallback.widthCm * scale;
  const heightPx = fallback.heightCm * scale;
  const shape = {
    id: nextId(tool),
    type: 'rect',
    tool,
    x: x - widthPx / 2,
    y: y - heightPx / 2,
    widthPx,
    heightPx,
    rotation: 0,
  };
  appState.project.shapes.push(shape);
  setSelection({ type: 'shape', id: shape.id });
  return shape;
}


export function isRectQuarterTurn(shape) {
  const angle = normalizeAngle(shape.rotation || 0);
  return angle === 90 || angle === 270;
}


export function isDoorShape(shape) {
  return shape?.type === 'rect' && shape.tool === 'door';
}

export function isWindowShape(shape) {
  return shape?.type === 'line' && shape.tool === 'window';
}

export function updateSelectedDimensions(widthCm, heightCm) {
  const selected = getSelectedShape();
  const scale = appState.project.settings.scalePxPerCm;
  if (!selected) return;
  if (selected.type === 'rect') {
    const center = getRectCenter(selected);
    if (isDoorShape(selected)) {
      const sizePx = Math.max(1, widthCm * scale);
      selected.widthPx = sizePx;
      selected.heightPx = sizePx;
    } else {
      const widthPx = Math.max(1, widthCm * scale);
      const heightPx = Math.max(1, heightCm * scale);
      if (isRectQuarterTurn(selected)) {
        selected.widthPx = heightPx;
        selected.heightPx = widthPx;
      } else {
        selected.widthPx = widthPx;
        selected.heightPx = heightPx;
      }
    }
    selected.x = center.x - selected.widthPx / 2;
    selected.y = center.y - selected.heightPx / 2;
  }
  if (selected.type === 'line') {
    const target = Math.max(1, widthCm * scale);
    const angle = Math.atan2(selected.y2 - selected.y1, selected.x2 - selected.x1);
    const cx = (selected.x1 + selected.x2) / 2;
    const cy = (selected.y1 + selected.y2) / 2;
    const half = target / 2;
    selected.x1 = cx - Math.cos(angle) * half;
    selected.y1 = cy - Math.sin(angle) * half;
    selected.x2 = cx + Math.cos(angle) * half;
    selected.y2 = cy + Math.sin(angle) * half;
  }
}

export function deleteSelectedShape() {
  const selected = appState.project.selection;
  if (!selected || selected.type !== 'shape') return false;
  const index = appState.project.shapes.findIndex((shape) => shape.id === selected.id);
  if (index >= 0) {
    appState.project.shapes.splice(index, 1);
    clearSelection();
    return true;
  }
  return false;
}

export function duplicateSelectedShape() {
  const shape = getSelectedShape();
  if (!shape) return null;
  let clone;
  if (shape.type === 'rect') {
    clone = { ...shape, id: nextId(shape.tool || 'rect'), x: shape.x + 24, y: shape.y + 24 };
  } else {
    clone = { ...shape, id: nextId('line'), x1: shape.x1 + 24, y1: shape.y1 + 24, x2: shape.x2 + 24, y2: shape.y2 + 24 };
  }
  appState.project.shapes.push(clone);
  setSelection({ type: 'shape', id: clone.id });
  return clone;
}

export function getRectCenter(shape) {
  return { x: shape.x + shape.widthPx / 2, y: shape.y + shape.heightPx / 2 };
}

export function getLineLengthPx(shape) {
  return Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
}

export function pxToCm(px) { return px / appState.project.settings.scalePxPerCm; }
export function cmToPx(cm) { return cm * appState.project.settings.scalePxPerCm; }

export function rotatePoint(point, center, angleRad) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

export function getRectCorners(shape) {
  const center = getRectCenter(shape);
  const angle = ((shape.rotation || 0) * Math.PI) / 180;
  const local = [
    { x: shape.x, y: shape.y },
    { x: shape.x + shape.widthPx, y: shape.y },
    { x: shape.x + shape.widthPx, y: shape.y + shape.heightPx },
    { x: shape.x, y: shape.y + shape.heightPx },
  ];
  return local.map((point) => rotatePoint(point, center, angle));
}

export function getRectEdges(shape) {
  const corners = getRectCorners(shape);
  return [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
}

export function normalizeAngle(angle) {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

export function rotateSelectedBy90Clockwise() {
  const shape = getSelectedShape();
  if (!shape || shape.type !== 'rect') return;
  shape.rotation = normalizeAngle((shape.rotation || 0) + 90);
}

function quantizePoint(point, epsilon = 0.1) {
  return `${Math.round(point.x / epsilon) * epsilon}|${Math.round(point.y / epsilon) * epsilon}`;
}

function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function rebuildDerivedFaces() {
  const lines = appState.project.shapes.filter((shape) => shape.type === 'line');
  const adjacency = new Map();
  const pointMap = new Map();

  function registerPoint(point) {
    const key = quantizePoint(point);
    if (!pointMap.has(key)) pointMap.set(key, { x: point.x, y: point.y, key });
    return pointMap.get(key);
  }

  function addEdge(a, b, lineId) {
    if (a.key === b.key) return;
    if (!adjacency.has(a.key)) adjacency.set(a.key, []);
    if (!adjacency.has(b.key)) adjacency.set(b.key, []);
    adjacency.get(a.key).push({ to: b.key, lineId });
    adjacency.get(b.key).push({ to: a.key, lineId });
  }

  lines.forEach((line) => {
    const a = registerPoint({ x: line.x1, y: line.y1 });
    const b = registerPoint({ x: line.x2, y: line.y2 });
    addEdge(a, b, line.id);
  });

  const faces = [];
  const keys = [...pointMap.keys()];
  const pointByKey = (key) => pointMap.get(key);
  const seenCycles = new Set();

  for (const startKey of keys) {
    const stack = [[startKey, [startKey], new Set()]];
    while (stack.length) {
      const [currentKey, path, usedLines] = stack.pop();
      const neighbors = adjacency.get(currentKey) || [];
      for (const neighbor of neighbors) {
        if (usedLines.has(neighbor.lineId)) continue;
        if (neighbor.to === startKey && path.length >= 3) {
          const cycleKeys = [...path];
          const canonical = [...cycleKeys].sort().join('>');
          if (seenCycles.has(canonical)) continue;
          const polygon = cycleKeys.map(pointByKey);
          const area = polygonArea(polygon);
          if (Math.abs(area) > 200) {
            seenCycles.add(canonical);
            faces.push({ id: `derived-${faces.length + 1}`, type: 'derivedFace', points: area > 0 ? polygon : [...polygon].reverse() });
          }
          continue;
        }
        if (path.includes(neighbor.to) || path.length > 7) continue;
        const nextUsed = new Set(usedLines);
        nextUsed.add(neighbor.lineId);
        stack.push([neighbor.to, [...path, neighbor.to], nextUsed]);
      }
    }
  }

  const uniqueFaces = [];
  const usedSignatures = new Set();
  faces.forEach((face) => {
    const signature = face.points.map((p) => quantizePoint(p, 1)).sort().join('|');
    if (!usedSignatures.has(signature)) {
      usedSignatures.add(signature);
      uniqueFaces.push(face);
    }
  });
  appState.project.derivedFaces = uniqueFaces;
}
