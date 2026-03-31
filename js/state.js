export const appState = {
  selectedTool: 'square',
  counters: {
    face: 0,
    line: 0,
  },
  interaction: {
    snapLines: [],
    activeHandle: null,
  },
  viewport: {
    baseWidth: 1200,
    baseHeight: 900,
    zoom: 1,
    minZoom: 0.5,
    maxZoom: 4,
    panX: 0,
    panY: 0,
  },
  project: {
    settings: {
      scalePxPerCm: 0.5,
      snapEnabled: true,
      snapStepPx: 20,
      snapThresholdPx: 12,
      rotateSnapDeg: 45,
      rotateSnapThresholdDeg: 7,
      gridEnabled: true,
    },
    selection: null,
    shapes: [],
  },
};

export function setSelectedTool(tool) {
  appState.selectedTool = tool;
}

export function setSelection(selection) {
  appState.project.selection = selection;
}

export function clearSelection() {
  appState.project.selection = null;
}

export function getSelectedShape() {
  const selected = appState.project.selection;
  if (!selected) return null;
  return appState.project.shapes.find((shape) => shape.id === selected.id) ?? null;
}

export function getShapeById(id) {
  return appState.project.shapes.find((shape) => shape.id === id) ?? null;
}

export function createShapeAt(tool, x, y) {
  if (tool === 'line') {
    appState.counters.line += 1;
    const line = {
      id: `line-${appState.counters.line}`,
      type: 'line',
      x1: x,
      y1: y,
      x2: x + 120,
      y2: y,
    };
    appState.project.shapes.push(line);
    setSelection({ type: 'line', id: line.id });
    return line;
  }

  appState.counters.face += 1;
  const face = {
    id: `face-${appState.counters.face}`,
    type: 'face',
    x,
    y,
    widthCm: 400,
    heightCm: 400,
    rotation: 0,
    metaTool: tool,
  };
  appState.project.shapes.push(face);
  setSelection({ type: 'face', id: face.id });
  return face;
}

export function updateSelectedShapeDimensions(widthValue, heightValue) {
  const shape = getSelectedShape();
  if (!shape) return null;

  if (shape.type === 'face') {
    shape.widthCm = Math.max(1, widthValue);
    shape.heightCm = Math.max(1, heightValue);
    return shape;
  }

  if (shape.type === 'line') {
    const lengthPx = Math.max(1, widthValue) * appState.project.settings.scalePxPerCm;
    const centerX = (shape.x1 + shape.x2) / 2;
    const centerY = (shape.y1 + shape.y2) / 2;
    const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
    const half = lengthPx / 2;
    shape.x1 = centerX - Math.cos(angle) * half;
    shape.y1 = centerY - Math.sin(angle) * half;
    shape.x2 = centerX + Math.cos(angle) * half;
    shape.y2 = centerY + Math.sin(angle) * half;
    return shape;
  }

  return null;
}

export function deleteSelectedShape() {
  const selected = appState.project.selection;
  if (!selected) return false;
  const before = appState.project.shapes.length;
  appState.project.shapes = appState.project.shapes.filter((shape) => shape.id !== selected.id);
  clearSelection();
  return appState.project.shapes.length !== before;
}

export function duplicateSelectedShape() {
  const shape = getSelectedShape();
  if (!shape) return null;

  if (shape.type === 'face') {
    appState.counters.face += 1;
    const clone = { ...shape, id: `face-${appState.counters.face}`, x: shape.x + 40, y: shape.y + 40 };
    appState.project.shapes.push(clone);
    setSelection({ type: 'face', id: clone.id });
    return clone;
  }

  if (shape.type === 'line') {
    appState.counters.line += 1;
    const clone = {
      ...shape,
      id: `line-${appState.counters.line}`,
      x1: shape.x1 + 40,
      y1: shape.y1 + 40,
      x2: shape.x2 + 40,
      y2: shape.y2 + 40,
    };
    appState.project.shapes.push(clone);
    setSelection({ type: 'line', id: clone.id });
    return clone;
  }

  return null;
}

export function moveShapeBy(shape, deltaX, deltaY) {
  if (!shape) return;
  if (shape.type === 'face') {
    shape.x += deltaX;
    shape.y += deltaY;
    return;
  }
  if (shape.type === 'line') {
    shape.x1 += deltaX;
    shape.y1 += deltaY;
    shape.x2 += deltaX;
    shape.y2 += deltaY;
  }
}

export function updateFaceSizePx(shape, widthPx, heightPx) {
  if (!shape || shape.type !== 'face') return;
  const scale = appState.project.settings.scalePxPerCm;
  shape.widthCm = Math.max(20, widthPx) / scale;
  shape.heightCm = Math.max(20, heightPx) / scale;
}

export function setLineEndpoint(shape, endpoint, x, y) {
  if (!shape || shape.type !== 'line') return;
  if (endpoint === 'start') {
    shape.x1 = x;
    shape.y1 = y;
    return;
  }
  shape.x2 = x;
  shape.y2 = y;
}

export function rotateFaceTo(shape, degrees) {
  if (!shape || shape.type !== 'face') return;
  shape.rotation = ((degrees % 360) + 360) % 360;
}

export function rotateLineTo(shape, degrees) {
  if (!shape || shape.type !== 'line') return;
  const centerX = (shape.x1 + shape.x2) / 2;
  const centerY = (shape.y1 + shape.y2) / 2;
  const length = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
  const radians = (degrees * Math.PI) / 180;
  const half = length / 2;
  shape.x1 = centerX - Math.cos(radians) * half;
  shape.y1 = centerY - Math.sin(radians) * half;
  shape.x2 = centerX + Math.cos(radians) * half;
  shape.y2 = centerY + Math.sin(radians) * half;
}

export function setViewportZoom(nextZoom, anchor = null) {
  const viewport = appState.viewport;
  const oldZoom = viewport.zoom;
  const clamped = Math.min(viewport.maxZoom, Math.max(viewport.minZoom, nextZoom));
  if (clamped === oldZoom) return;

  if (anchor) {
    viewport.panX = anchor.x - ((anchor.x - viewport.panX) * (clamped / oldZoom));
    viewport.panY = anchor.y - ((anchor.y - viewport.panY) * (clamped / oldZoom));
  }

  viewport.zoom = clamped;
}

export function panViewport(deltaX, deltaY) {
  appState.viewport.panX += deltaX;
  appState.viewport.panY += deltaY;
}

export function setSnapLines(lines) {
  appState.interaction.snapLines = lines;
}

export function setActiveHandle(handle) {
  appState.interaction.activeHandle = handle;
}
