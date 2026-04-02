import {
  appState,
  setSelectedTool,
  createShapeFromTool,
  clearSelection,
  setSelection,
  getSelectedShape,
  updateSelectedDimensions,
  deleteSelectedShape,
  duplicateSelectedShape,
  getRectCenter,
  getRectCorners,
  getRectEdges,
  rotatePoint,
  normalizeAngle,
  rotateSelectedBy90Clockwise,
  getLineLengthPx,
  SVG_WIDTH,
  SVG_HEIGHT,
  getDefaultShapeMetrics,
} from './state.js';
import {
  renderScene,
  updateTopbarVisibility,
  setCanvasViewBox,
} from './renderer.js';

const toast = document.getElementById('toast');
const dragGhost = document.getElementById('dragGhost');
const planCanvas = document.getElementById('planCanvas');
const canvasStage = document.getElementById('canvasStage');
const toolButtons = [...document.querySelectorAll('.tool-btn')];

const widthInput = document.getElementById('widthInput');
const heightInput = document.getElementById('heightInput');
const applyDimensionsBtn = document.getElementById('applyDimensionsBtn');

const deleteBtn = document.getElementById('deleteBtn');
const duplicateBtn = document.getElementById('duplicateBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const saveBtn = document.getElementById('saveBtn');
const exportBtn = document.getElementById('exportBtn');
const settingsBtn = document.getElementById('settingsBtn');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.classList.remove('show');
  }, 1600);
}

function refresh() {
  renderScene();
  updateTopbarVisibility();
}

function getCanvasPointFromClient(clientX, clientY) {
  const rect = planCanvas.getBoundingClientRect();
  const svgX = ((clientX - rect.left) / rect.width) * SVG_WIDTH;
  const svgY = ((clientY - rect.top) / rect.height) * SVG_HEIGHT;
  return screenToWorld(svgX, svgY);
}

function screenToWorld(svgX, svgY) {
  const { panX, panY, zoom } = appState.view;
  return {
    x: (svgX - panX) / zoom,
    y: (svgY - panY) / zoom,
  };
}

function getPointerDistance(a, b) {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}


function getHandleWorldThreshold(screenPx = 28) {
  return screenPx / Math.max(appState.view.zoom || 1, 0.01);
}

function getSelectedHandleAnchors(shape) {
  if (!shape) return [];
  if (shape.type === 'rect') {
    const corners = getRectCorners(shape);
    const center = getRectCenter(shape);
    const topY = Math.min(...corners.map((p) => p.y));
    const rotatePoint = { x: center.x, y: topY - 38 };
    return [
      ...corners.map((point, index) => ({ name: `resize-${index}`, point, threshold: 30 })),
      { name: 'side-top', point: { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }, threshold: 30 },
      { name: 'side-right', point: { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 }, threshold: 30 },
      { name: 'side-bottom', point: { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 }, threshold: 30 },
      { name: 'side-left', point: { x: (corners[3].x + corners[0].x) / 2, y: (corners[3].y + corners[0].y) / 2 }, threshold: 30 },
      { name: 'rotate', point: rotatePoint, threshold: 34 },
    ];
  }
  if (shape.type === 'line') {
    const cx = (shape.x1 + shape.x2) / 2;
    const cy = (shape.y1 + shape.y2) / 2;
    const dx = shape.x2 - shape.x1;
    const dy = shape.y2 - shape.y1;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    if (ny < 0 || (Math.abs(ny) < 0.001 && nx < 0)) {
      nx *= -1; ny *= -1;
    }
    return [
      { name: 'line-start', point: { x: shape.x1, y: shape.y1 }, threshold: 30 },
      { name: 'line-end', point: { x: shape.x2, y: shape.y2 }, threshold: 30 },
      { name: 'rotate', point: { x: cx, y: cy - 32 }, threshold: 34 },
      { name: 'line-move', point: { x: cx + nx * 38, y: cy + ny * 38 }, threshold: 34 },
    ];
  }
  return [];
}

function findNearestHandle(point) {
  const selected = getSelectedShape();
  if (!selected) return null;
  const anchors = getSelectedHandleAnchors(selected);
  let best = null;
  anchors.forEach((anchor) => {
    const dist = Math.hypot(point.x - anchor.point.x, point.y - anchor.point.y);
    const limit = getHandleWorldThreshold(anchor.threshold);
    if (dist <= limit && (!best || dist < best.dist)) {
      best = { name: anchor.name, dist };
    }
  });
  return best?.name || null;
}

function bindToolbar() {
  toolButtons.forEach((button) => {
    button.addEventListener('click', () => {
      toolButtons.forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      setSelectedTool(button.dataset.tool);
    });

    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const tool = button.dataset.tool;
      appState.dragFromToolbar = { tool, pointerId: event.pointerId };
      dragGhost.textContent = button.querySelector('.tool-label')?.textContent || tool;
      dragGhost.classList.remove('hidden');
      dragGhost.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;
      button.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    button.addEventListener('pointermove', (event) => {
      if (!appState.dragFromToolbar || appState.dragFromToolbar.pointerId !== event.pointerId) return;
      dragGhost.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;
    });

    button.addEventListener('pointerup', (event) => {
      if (!appState.dragFromToolbar || appState.dragFromToolbar.pointerId !== event.pointerId) return;
      const tool = appState.dragFromToolbar.tool;
      dragGhost.classList.add('hidden');
      const stageRect = canvasStage.getBoundingClientRect();
      const inside = event.clientX >= stageRect.left && event.clientX <= stageRect.right && event.clientY >= stageRect.top && event.clientY <= stageRect.bottom;
      if (inside) {
        const point = getCanvasPointFromClient(event.clientX, event.clientY);
        const snapped = snapNewShapePlacement(tool, point);
        createShapeFromTool(tool, snapped.x, snapped.y);
        refresh();
      }
      appState.dragFromToolbar = null;
      event.preventDefault();
    });

    button.addEventListener('pointercancel', () => {
      appState.dragFromToolbar = null;
      dragGhost.classList.add('hidden');
    });
  });
}

function bindCanvas() {
  planCanvas.addEventListener('pointerdown', onCanvasPointerDown);
  planCanvas.addEventListener('pointermove', onCanvasPointerMove);
  planCanvas.addEventListener('pointerup', onCanvasPointerUp);
  planCanvas.addEventListener('pointercancel', onCanvasPointerUp);
  planCanvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
    zoomAroundClientPoint(event.clientX, event.clientY, zoomFactor);
    refresh();
  }, { passive: false });
}

function onCanvasPointerDown(event) {
  if (appState.dragFromToolbar) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  const point = getCanvasPointFromClient(event.clientX, event.clientY);
  if (handlePinchStart(event)) return;

  const eventHandle = event.target.closest('[data-handle]')?.getAttribute('data-handle');
  const handle = eventHandle || findNearestHandle(point);
  const shapeId = event.target.closest('[data-shape-id]')?.getAttribute('data-shape-id');

  if (handle) {
    startHandleInteraction(event, point, handle);
    return;
  }

  if (shapeId) {
    setSelection({ type: 'shape', id: shapeId });
    const shape = getSelectedShape();
    appState.pointer = {
      mode: 'move-shape',
      pointerId: event.pointerId,
      startWorld: point,
      startScreen: { x: event.clientX, y: event.clientY },
      targetId: shape.id,
      handle: null,
      original: structuredClone(shape),
      rotationClickCandidate: false,
      guides: null,
    };
    planCanvas.setPointerCapture(event.pointerId);
    refresh();
    return;
  }

  clearSelection();
  appState.project.activeGuides = [];
  appState.pointer = {
    mode: 'pan',
    pointerId: event.pointerId,
    startWorld: point,
    startScreen: { x: event.clientX, y: event.clientY },
    targetId: null,
    handle: null,
    original: { panX: appState.view.panX, panY: appState.view.panY },
    rotationClickCandidate: false,
    guides: null,
  };
  planCanvas.setPointerCapture(event.pointerId);
  refresh();
}

function handlePinchStart(event) {
  if (!planCanvas.hasPointerCapture(event.pointerId)) planCanvas.setPointerCapture(event.pointerId);
  if (!appState.pinch.pointerA) {
    appState.pinch.pointerA = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    return false;
  }
  if (!appState.pinch.pointerB && appState.pinch.pointerA.id !== event.pointerId) {
    appState.pinch.pointerB = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    const a = appState.pinch.pointerA;
    const b = appState.pinch.pointerB;
    appState.pinch.active = true;
    appState.pinch.startDistance = getPointerDistance(a, b);
    appState.pinch.startZoom = appState.view.zoom;
    const midClientX = (a.clientX + b.clientX) / 2;
    const midClientY = (a.clientY + b.clientY) / 2;
    appState.pinch.startWorldMid = getCanvasPointFromClient(midClientX, midClientY);
    appState.pointer.mode = 'idle';
    return true;
  }
  return appState.pinch.active;
}

function updatePinchPointer(event) {
  if (appState.pinch.pointerA?.id === event.pointerId) {
    appState.pinch.pointerA.clientX = event.clientX; appState.pinch.pointerA.clientY = event.clientY; return true;
  }
  if (appState.pinch.pointerB?.id === event.pointerId) {
    appState.pinch.pointerB.clientX = event.clientX; appState.pinch.pointerB.clientY = event.clientY; return true;
  }
  return false;
}

function removePinchPointer(pointerId) {
  if (appState.pinch.pointerA?.id === pointerId) appState.pinch.pointerA = null;
  if (appState.pinch.pointerB?.id === pointerId) appState.pinch.pointerB = null;
  if (!appState.pinch.pointerA || !appState.pinch.pointerB) {
    appState.pinch.active = false;
    appState.pinch.startDistance = 0;
  }
}

function onCanvasPointerMove(event) {
  if (appState.pinch.active && updatePinchPointer(event)) {
    const a = appState.pinch.pointerA;
    const b = appState.pinch.pointerB;
    const currentDistance = getPointerDistance(a, b);
    if (appState.pinch.startDistance > 0) {
      let nextZoom = appState.pinch.startZoom * (currentDistance / appState.pinch.startDistance);
      nextZoom = Math.max(appState.view.minZoom, Math.min(appState.view.maxZoom, nextZoom));
      const rect = planCanvas.getBoundingClientRect();
      const midClientX = (a.clientX + b.clientX) / 2;
      const midClientY = (a.clientY + b.clientY) / 2;
      const svgX = ((midClientX - rect.left) / rect.width) * SVG_WIDTH;
      const svgY = ((midClientY - rect.top) / rect.height) * SVG_HEIGHT;
      appState.view.zoom = nextZoom;
      appState.view.panX = svgX - appState.pinch.startWorldMid.x * nextZoom;
      appState.view.panY = svgY - appState.pinch.startWorldMid.y * nextZoom;
      refresh();
    }
    return;
  }

  if (appState.pointer.pointerId !== event.pointerId) return;
  const point = getCanvasPointFromClient(event.clientX, event.clientY);
  const selected = getSelectedShape();

  if (appState.pointer.mode === 'pan') {
    const dx = event.clientX - appState.pointer.startScreen.x;
    const dy = event.clientY - appState.pointer.startScreen.y;
    const rect = planCanvas.getBoundingClientRect();
    appState.view.panX = appState.pointer.original.panX + dx * (SVG_WIDTH / rect.width);
    appState.view.panY = appState.pointer.original.panY + dy * (SVG_HEIGHT / rect.height);
    refresh();
    return;
  }

  if (appState.pointer.mode === 'move-shape' && selected) {
    if (selected.type === 'rect') moveRectWithSnap(selected, point);
    if (selected.type === 'line') moveLineWithSnap(selected, point);
    refresh();
    return;
  }

  if (appState.pointer.mode === 'resize-rect' && selected?.type === 'rect') {
    resizeRectFromHandle(selected, point);
    refresh();
    return;
  }

  if ((appState.pointer.mode === 'move-line-end' || appState.pointer.mode === 'move-line-body') && selected?.type === 'line') {
    if (appState.pointer.mode === 'move-line-end') moveLineEndpoint(selected, point);
    else moveLineBodyWithSnap(selected, point);
    refresh();
    return;
  }

  if (appState.pointer.mode === 'rotate' && selected) {
    rotateSelectedFromPointer(selected, point);
    refresh();
  }
}

function onCanvasPointerUp(event) {
  if (updatePinchPointer(event)) {
    removePinchPointer(event.pointerId);
    return;
  }
  if (appState.pointer.pointerId === event.pointerId) {
    const selected = getSelectedShape();
    if (appState.pointer.mode === 'rotate' && appState.pointer.rotationClickCandidate && selected) {
      if (selected.type === 'rect') rotateSelectedBy90Clockwise();
      if (selected.type === 'line') rotateLineBy90Clockwise(selected);
    }
    appState.project.activeGuides = [];
    appState.pointer = {
      mode: 'idle', pointerId: null, startWorld: null, startScreen: null, targetId: null, handle: null, original: null, rotationClickCandidate: false, guides: null,
    };
    refresh();
  }
}

function startHandleInteraction(event, point, handle) {
  const shape = getSelectedShape();
  if (!shape) return;
  let mode = 'idle';
  if ((handle.startsWith('resize-') || handle.startsWith('side-')) && shape.type === 'rect') mode = 'resize-rect';
  else if ((handle === 'line-start' || handle === 'line-end') && shape.type === 'line') mode = 'move-line-end';
  else if (handle === 'line-move' && shape.type === 'line') mode = 'move-line-body';
  else if (handle === 'rotate') mode = 'rotate';
  appState.pointer = {
    mode,
    pointerId: event.pointerId,
    startWorld: point,
    startScreen: { x: event.clientX, y: event.clientY },
    targetId: shape.id,
    handle,
    original: structuredClone(shape),
    rotationClickCandidate: mode === 'rotate',
    guides: null,
  };
  planCanvas.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function collectSnapCandidates(excludeShapeId = null) {
  const points = [];
  const lines = [];
  const axisXs = [];
  const axisYs = [];

  appState.project.shapes.forEach((shape) => {
    if (shape.id === excludeShapeId) return;

    if (shape.type === 'line') {
      const start = { x: shape.x1, y: shape.y1 };
      const end = { x: shape.x2, y: shape.y2 };
      const mid = { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 };
      points.push(start, end, mid);
      lines.push([start, end]);
      axisXs.push(start.x, end.x, mid.x);
      axisYs.push(start.y, end.y, mid.y);
      if (Math.abs(start.x - end.x) < 0.5) axisXs.push(start.x);
      if (Math.abs(start.y - end.y) < 0.5) axisYs.push(start.y);
    }

    if (shape.type === 'rect') {
      const corners = getRectCorners(shape);
      const edges = getRectEdges(shape);
      const center = getRectCenter(shape);
      corners.forEach((p) => points.push(p));
      points.push(center);
      edges.forEach(([a, b]) => {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        points.push(mid);
        lines.push([a, b]);
        axisXs.push(a.x, b.x, mid.x);
        axisYs.push(a.y, b.y, mid.y);
        if (Math.abs(a.x - b.x) < 0.5) axisXs.push(a.x);
        if (Math.abs(a.y - b.y) < 0.5) axisYs.push(a.y);
      });
    }
  });

  return { points, lines, axisXs, axisYs };
}

function closestPointOnSegment(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) return { x: a.x, y: a.y, t: 0 };
  let t = ((point.x - a.x) * abx + (point.y - a.y) * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + abx * t, y: a.y + aby * t, t };
}

function makeGuide(type, value) {
  return type === 'vertical' ? { type, x: value } : { type, y: value };
}

function dedupeGuides(guides) {
  const seen = new Set();
  return guides.filter((guide) => {
    const key = guide.type === 'vertical' ? `v:${Math.round(guide.x)}` : `h:${Math.round(guide.y)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getRectSnapPoints(shape) {
  const corners = getRectCorners(shape);
  const center = getRectCenter(shape);
  const points = [...corners, center];
  getRectEdges(shape).forEach(([a, b]) => points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
  return points;
}

function getProspectivePlacementPoints(tool, centerPoint) {
  if (tool === 'line') {
    const { lengthPx } = getDefaultShapeMetrics('line');
    const half = lengthPx / 2;
    return [
      { x: centerPoint.x - half, y: centerPoint.y },
      { x: centerPoint.x + half, y: centerPoint.y },
      { x: centerPoint.x, y: centerPoint.y },
    ];
  }
  const { widthPx, heightPx } = getDefaultShapeMetrics(tool);
  const temp = {
    type: 'rect',
    x: centerPoint.x - widthPx / 2,
    y: centerPoint.y - heightPx / 2,
    widthPx,
    heightPx,
    rotation: 0,
  };
  return getRectSnapPoints(temp);
}


function getRectBoundsPoints(shape) {
  const corners = getRectCorners(shape);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    centerX: (Math.min(...xs) + Math.max(...xs)) / 2,
    centerY: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function getRectAxisSnap(shape, excludeShapeId = null) {
  const threshold = appState.project.settings.snapThresholdPx;
  const { axisXs, axisYs, points } = collectSnapCandidates(excludeShapeId);
  const candidateXs = [...axisXs, ...points.map((p) => p.x)];
  const candidateYs = [...axisYs, ...points.map((p) => p.y)];
  const bounds = getRectBoundsPoints(shape);
  const anchorsX = [bounds.minX, bounds.centerX, bounds.maxX];
  const anchorsY = [bounds.minY, bounds.centerY, bounds.maxY];
  let dx = 0;
  let dy = 0;
  let bestX = Infinity;
  let bestY = Infinity;
  let guideX = null;
  let guideY = null;

  for (const anchor of anchorsX) {
    for (const x of candidateXs) {
      const diff = x - anchor;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < bestX) {
        bestX = Math.abs(diff);
        dx = diff;
        guideX = makeGuide('vertical', x);
      }
    }
  }
  for (const anchor of anchorsY) {
    for (const y of candidateYs) {
      const diff = y - anchor;
      if (Math.abs(diff) <= threshold && Math.abs(diff) < bestY) {
        bestY = Math.abs(diff);
        dy = diff;
        guideY = makeGuide('horizontal', y);
      }
    }
  }

  return { dx, dy, guides: [guideX, guideY].filter(Boolean) };
}

function getLineAxisLockPoint(original, rawPoint) {
  const handle = appState.pointer.handle;
  const fixed = handle === 'line-start' ? { x: original.x2, y: original.y2 } : { x: original.x1, y: original.y1 };
  const movingOriginal = handle === 'line-start' ? { x: original.x1, y: original.y1 } : { x: original.x2, y: original.y2 };
  const axis = { x: movingOriginal.x - fixed.x, y: movingOriginal.y - fixed.y };
  const axisLen = Math.hypot(axis.x, axis.y) || 1;
  const ux = axis.x / axisLen;
  const uy = axis.y / axisLen;
  const vx = rawPoint.x - fixed.x;
  const vy = rawPoint.y - fixed.y;
  const parallel = vx * ux + vy * uy;
  const perp = vx * (-uy) + vy * ux;
  const breakPx = appState.project.settings.lineAxisBreakPx || 18;
  if (Math.abs(perp) <= breakPx) {
    return { x: fixed.x + ux * parallel, y: fixed.y + uy * parallel, axisLocked: true };
  }
  return { ...rawPoint, axisLocked: false };
}

function applyMagneticSnap(movingPoints, excludeShapeId = null) {
  const threshold = appState.project.settings.snapThresholdPx;
  const guideThreshold = appState.project.settings.guideThresholdPx;
  const lineThreshold = appState.project.settings.lineSnapDistancePx;
  const { points, lines, axisXs, axisYs } = collectSnapCandidates(excludeShapeId);
  const candidateXs = [...axisXs];
  const candidateYs = [...axisYs];
  points.forEach((p) => { candidateXs.push(p.x); candidateYs.push(p.y); });
  let bestDx = 0;
  let bestDy = 0;
  let bestDistX = Infinity;
  let bestDistY = Infinity;
  const guides = [];

  for (const mp of movingPoints) {
    for (const x of candidateXs) {
      const dx = x - mp.x;
      if (Math.abs(dx) <= threshold && Math.abs(dx) < bestDistX) {
        bestDistX = Math.abs(dx);
        bestDx = dx;
        guides[0] = makeGuide('vertical', x);
      }
    }
    for (const y of candidateYs) {
      const dy = y - mp.y;
      if (Math.abs(dy) <= threshold && Math.abs(dy) < bestDistY) {
        bestDistY = Math.abs(dy);
        bestDy = dy;
        guides[1] = makeGuide('horizontal', y);
      }
    }

    for (const tp of points) {
      const dx = tp.x - mp.x;
      const dy = tp.y - mp.y;
      if (Math.abs(dx) <= threshold && Math.abs(dx) < bestDistX) {
        bestDistX = Math.abs(dx);
        bestDx = dx;
        guides[0] = makeGuide('vertical', tp.x);
      }
      if (Math.abs(dy) <= threshold && Math.abs(dy) < bestDistY) {
        bestDistY = Math.abs(dy);
        bestDy = dy;
        guides[1] = makeGuide('horizontal', tp.y);
      }
    }

    for (const [a, b] of lines) {
      const cp = closestPointOnSegment(mp, a, b);
      const dx = cp.x - mp.x;
      const dy = cp.y - mp.y;
      if (Math.abs(dx) <= lineThreshold && Math.abs(dx) < bestDistX) {
        bestDistX = Math.abs(dx);
        bestDx = dx;
        guides[0] = makeGuide('vertical', cp.x);
      }
      if (Math.abs(dy) <= lineThreshold && Math.abs(dy) < bestDistY) {
        bestDistY = Math.abs(dy);
        bestDy = dy;
        guides[1] = makeGuide('horizontal', cp.y);
      }
    }
  }

  const result = {
    dx: bestDistX <= Math.max(threshold, lineThreshold) ? bestDx : 0,
    dy: bestDistY <= Math.max(threshold, lineThreshold) ? bestDy : 0,
    guides: guides.filter(Boolean),
  };

  if (result.guides.length === 0) {
    for (const mp of movingPoints) {
      candidateXs.forEach((x) => { if (Math.abs(x - mp.x) <= guideThreshold) result.guides.push(makeGuide('vertical', x)); });
      candidateYs.forEach((y) => { if (Math.abs(y - mp.y) <= guideThreshold) result.guides.push(makeGuide('horizontal', y)); });
    }
    result.guides = dedupeGuides(result.guides);
  }

  return result;
}

function snapNewShapePlacement(tool, point) {
  const movingPoints = getProspectivePlacementPoints(tool, point);
  const result = applyMagneticSnap(movingPoints, null);
  let finalDx = result.dx;
  let finalDy = result.dy;
  let finalGuides = [...result.guides];

  if (tool !== 'line') {
    const { widthPx, heightPx } = getDefaultShapeMetrics(tool);
    const tempRect = {
      type: 'rect',
      x: point.x - widthPx / 2 + finalDx,
      y: point.y - heightPx / 2 + finalDy,
      widthPx,
      heightPx,
      rotation: 0,
    };
    const axisSnap = getRectAxisSnap(tempRect, null);
    finalDx += axisSnap.dx;
    finalDy += axisSnap.dy;
    finalGuides = dedupeGuides([...finalGuides, ...axisSnap.guides]);
  }

  appState.project.activeGuides = finalGuides;
  return { x: point.x + finalDx, y: point.y + finalDy };
}

function moveRectWithSnap(selected, point) {
  const original = appState.pointer.original;
  const dx = point.x - appState.pointer.startWorld.x;
  const dy = point.y - appState.pointer.startWorld.y;
  const temp = { ...original, x: original.x + dx, y: original.y + dy };
  const movingPoints = getRectSnapPoints(temp);
  const snap = applyMagneticSnap(movingPoints, selected.id);
  const axisSnap = getRectAxisSnap({ ...temp, x: temp.x + snap.dx, y: temp.y + snap.dy }, selected.id);
  selected.x = temp.x + snap.dx + axisSnap.dx;
  selected.y = temp.y + snap.dy + axisSnap.dy;
  appState.project.activeGuides = dedupeGuides([...(snap.guides || []), ...(axisSnap.guides || [])]);
}

function moveLineWithSnap(selected, point) {
  const original = appState.pointer.original;
  const dx = point.x - appState.pointer.startWorld.x;
  const dy = point.y - appState.pointer.startWorld.y;
  const movingStart = { x: original.x1 + dx, y: original.y1 + dy };
  const movingEnd = { x: original.x2 + dx, y: original.y2 + dy };
  const movingMid = { x: (movingStart.x + movingEnd.x) / 2, y: (movingStart.y + movingEnd.y) / 2 };
  const snap = applyMagneticSnap([movingStart, movingEnd, movingMid], selected.id);
  selected.x1 = movingStart.x + snap.dx;
  selected.y1 = movingStart.y + snap.dy;
  selected.x2 = movingEnd.x + snap.dx;
  selected.y2 = movingEnd.y + snap.dy;
  appState.project.activeGuides = snap.guides;
}

function resizeRectFromHandle(shape, point) {
  const original = appState.pointer.original;
  const corners = getRectCorners(original);
  const centerOriginal = getRectCenter(original);
  const handle = appState.pointer.handle;
  const angle = ((original.rotation || 0) * Math.PI) / 180;
  const minSize = 12;

  if (handle.startsWith('resize-')) {
    const handleIndex = Number(handle.replace('resize-', ''));
    const oppositeIndex = (handleIndex + 2) % 4;
    const fixed = corners[oppositeIndex];
    const snap = applyMagneticSnap([point], shape.id);
    const movingWorld = { x: point.x + snap.dx, y: point.y + snap.dy };
    const center = { x: (fixed.x + movingWorld.x) / 2, y: (fixed.y + movingWorld.y) / 2 };
    const unrotFixed = rotatePoint(fixed, center, -angle);
    const unrotMoving = rotatePoint(movingWorld, center, -angle);
    shape.widthPx = Math.max(minSize, Math.abs(unrotMoving.x - unrotFixed.x));
    shape.heightPx = Math.max(minSize, Math.abs(unrotMoving.y - unrotFixed.y));
    shape.x = center.x - shape.widthPx / 2;
    shape.y = center.y - shape.heightPx / 2;
    shape.rotation = original.rotation || 0;
    appState.project.activeGuides = snap.guides;
    return;
  }

  const localPoint = rotatePoint(point, centerOriginal, -angle);
  const snap = applyMagneticSnap([point], shape.id);
  const snappedLocal = rotatePoint({ x: point.x + snap.dx, y: point.y + snap.dy }, centerOriginal, -angle);

  if (handle === 'side-top' || handle === 'side-bottom') {
    const fixedLocalY = handle === 'side-top' ? original.y + original.heightPx : original.y;
    const movingY = snappedLocal.y;
    const height = Math.max(minSize, Math.abs(movingY - fixedLocalY));
    const centerLocalY = (movingY + fixedLocalY) / 2;
    const centerWorld = rotatePoint({ x: centerOriginal.x, y: centerLocalY }, centerOriginal, angle);
    shape.heightPx = height;
    shape.widthPx = original.widthPx;
    shape.x = centerWorld.x - shape.widthPx / 2;
    shape.y = centerWorld.y - shape.heightPx / 2;
  } else {
    const fixedLocalX = handle === 'side-left' ? original.x + original.widthPx : original.x;
    const movingX = snappedLocal.x;
    const width = Math.max(minSize, Math.abs(movingX - fixedLocalX));
    const centerLocalX = (movingX + fixedLocalX) / 2;
    const centerWorld = rotatePoint({ x: centerLocalX, y: centerOriginal.y }, centerOriginal, angle);
    shape.widthPx = width;
    shape.heightPx = original.heightPx;
    shape.x = centerWorld.x - shape.widthPx / 2;
    shape.y = centerWorld.y - shape.heightPx / 2;
  }

  shape.rotation = original.rotation || 0;
  appState.project.activeGuides = snap.guides;
}

function moveLineEndpoint(shape, point) {
  const original = appState.pointer.original;
  const lockedPoint = getLineAxisLockPoint(original, point);
  const snap = applyMagneticSnap([lockedPoint], shape.id);
  const snapped = { x: lockedPoint.x + snap.dx, y: lockedPoint.y + snap.dy };
  if (appState.pointer.handle === 'line-start') {
    shape.x1 = snapped.x; shape.y1 = snapped.y;
    if (lockedPoint.axisLocked) { shape.x2 = original.x2; shape.y2 = original.y2; }
  }
  if (appState.pointer.handle === 'line-end') {
    shape.x2 = snapped.x; shape.y2 = snapped.y;
    if (lockedPoint.axisLocked) { shape.x1 = original.x1; shape.y1 = original.y1; }
  }
  appState.project.activeGuides = snap.guides;
}

function moveLineBodyWithSnap(selected, point) {
  const original = appState.pointer.original;
  const dx = point.x - appState.pointer.startWorld.x;
  const dy = point.y - appState.pointer.startWorld.y;
  const movingStart = { x: original.x1 + dx, y: original.y1 + dy };
  const movingEnd = { x: original.x2 + dx, y: original.y2 + dy };
  const movingMid = { x: (movingStart.x + movingEnd.x) / 2, y: (movingStart.y + movingEnd.y) / 2 };
  const snap = applyMagneticSnap([movingStart, movingEnd, movingMid], selected.id);
  selected.x1 = movingStart.x + snap.dx;
  selected.y1 = movingStart.y + snap.dy;
  selected.x2 = movingEnd.x + snap.dx;
  selected.y2 = movingEnd.y + snap.dy;
  appState.project.activeGuides = snap.guides;
}

function rotateSelectedFromPointer(shape, point) {
  const origin = shape.type === 'rect' ? getRectCenter(shape) : { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 };
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  if (Math.hypot(dx, dy) > 8) appState.pointer.rotationClickCandidate = false;
  let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  const step = appState.project.settings.rotateSnapDeg || 45;
  angleDeg = Math.round(angleDeg / step) * step;
  if (shape.type === 'rect') {
    shape.rotation = normalizeAngle(angleDeg);
    return;
  }
  const length = getLineLengthPx(shape);
  const rad = (angleDeg * Math.PI) / 180;
  const half = length / 2;
  shape.x1 = origin.x - Math.sin(rad) * half;
  shape.y1 = origin.y + Math.cos(rad) * half;
  shape.x2 = origin.x + Math.sin(rad) * half;
  shape.y2 = origin.y - Math.cos(rad) * half;
}

function rotateLineBy90Clockwise(shape) {
  const cx = (shape.x1 + shape.x2) / 2;
  const cy = (shape.y1 + shape.y2) / 2;
  const half = getLineLengthPx(shape) / 2;
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1) + Math.PI / 2;
  shape.x1 = cx - Math.cos(angle) * half;
  shape.y1 = cy - Math.sin(angle) * half;
  shape.x2 = cx + Math.cos(angle) * half;
  shape.y2 = cy + Math.sin(angle) * half;
}

function zoomAroundClientPoint(clientX, clientY, factor) {
  const pointBefore = getCanvasPointFromClient(clientX, clientY);
  const nextZoom = Math.max(appState.view.minZoom, Math.min(appState.view.maxZoom, appState.view.zoom * factor));
  appState.view.zoom = nextZoom;
  const rect = planCanvas.getBoundingClientRect();
  const svgX = ((clientX - rect.left) / rect.width) * SVG_WIDTH;
  const svgY = ((clientY - rect.top) / rect.height) * SVG_HEIGHT;
  appState.view.panX = svgX - pointBefore.x * nextZoom;
  appState.view.panY = svgY - pointBefore.y * nextZoom;
}

function bindDimensions() {
  [widthInput, heightInput].forEach((input) => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('click', () => input.select());
  });
  applyDimensionsBtn.addEventListener('click', () => {
    const widthCm = Math.max(1, Number(widthInput.value) || 1);
    const heightCm = Math.max(1, Number(heightInput.value) || 1);
    updateSelectedDimensions(widthCm, heightCm);
    refresh();
  });
}

function bindBottomBar() {
  deleteBtn.addEventListener('click', () => { if (deleteSelectedShape()) refresh(); });
  duplicateBtn.addEventListener('click', () => { duplicateSelectedShape(); refresh(); });
  [undoBtn, redoBtn, saveBtn, exportBtn, settingsBtn].forEach((button) => {
    button.addEventListener('click', () => showToast(`${button.textContent} is nog niet uitgewerkt`));
  });
}

setCanvasViewBox();
bindToolbar();
bindCanvas();
bindDimensions();
bindBottomBar();
refresh();
