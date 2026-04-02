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
  clearGuides,
  setGuides,
  SVG_WIDTH,
  SVG_HEIGHT,
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

function bindToolbar() {
  toolButtons.forEach((button) => {
    button.addEventListener('click', () => {
      toolButtons.forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      setSelectedTool(button.dataset.tool);
    });

    button.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      const tool = button.dataset.tool;
      appState.dragFromToolbar = {
        tool,
        pointerId: event.pointerId,
      };

      dragGhost.textContent = button.querySelector('.tool-label')?.textContent || tool;
      dragGhost.classList.remove('hidden');
      dragGhost.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;

      button.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    button.addEventListener('pointermove', (event) => {
      if (!appState.dragFromToolbar || appState.dragFromToolbar.pointerId !== event.pointerId) {
        return;
      }

      dragGhost.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;
    });

    button.addEventListener('pointerup', (event) => {
      if (!appState.dragFromToolbar || appState.dragFromToolbar.pointerId !== event.pointerId) {
        return;
      }

      const tool = appState.dragFromToolbar.tool;
      dragGhost.classList.add('hidden');

      const stageRect = canvasStage.getBoundingClientRect();
      const inside =
        event.clientX >= stageRect.left &&
        event.clientX <= stageRect.right &&
        event.clientY >= stageRect.top &&
        event.clientY <= stageRect.bottom;

      if (inside) {
        const point = getCanvasPointFromClient(event.clientX, event.clientY);
        const snapped = snapNewShapePlacement(tool, point);
        createShapeFromTool(tool, snapped.x, snapped.y);
        clearGuides();
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

function snapNewShapePlacement(tool, point) {
  const preview = buildPlacementPreview(tool, point);
  const magnet = computeMagneticPlacement(preview, null);
  return magnet.point;
}

function buildPlacementPreview(tool, point) {
  const scale = appState.project.settings.scalePxPerCm;

  if (tool === 'line') {
    const lengthPx = 300 * scale;
    return {
      type: 'line',
      x1: point.x - lengthPx / 2,
      y1: point.y,
      x2: point.x + lengthPx / 2,
      y2: point.y,
      center: { x: point.x, y: point.y },
    };
  }

  const defaults = {
    square: { widthCm: 400, heightCm: 300 },
    door: { widthCm: 90, heightCm: 210 },
    window: { widthCm: 120, heightCm: 120 },
    opening: { widthCm: 100, heightCm: 220 },
    note: { widthCm: 140, heightCm: 80 },
  }[tool] || { widthCm: 400, heightCm: 300 };

  const widthPx = defaults.widthCm * scale;
  const heightPx = defaults.heightCm * scale;
  return {
    type: 'rect',
    x: point.x - widthPx / 2,
    y: point.y - heightPx / 2,
    widthPx,
    heightPx,
    rotation: 0,
    center: { x: point.x, y: point.y },
  };
}

function collectSnapTargets(excludeShapeId = null) {
  const targets = [];

  for (const shape of appState.project.shapes) {
    if (shape.id === excludeShapeId) continue;

    if (shape.type === 'line') {
      const cx = (shape.x1 + shape.x2) / 2;
      const cy = (shape.y1 + shape.y2) / 2;
      targets.push({ x: shape.x1, y: shape.y1, kind: 'point' });
      targets.push({ x: shape.x2, y: shape.y2, kind: 'point' });
      targets.push({ x: cx, y: cy, kind: 'point' });
      targets.push({ x: shape.x1, y: null, kind: 'vline' });
      targets.push({ x: shape.x2, y: null, kind: 'vline' });
      targets.push({ x: cx, y: null, kind: 'vline' });
      targets.push({ x: null, y: shape.y1, kind: 'hline' });
      targets.push({ x: null, y: shape.y2, kind: 'hline' });
      targets.push({ x: null, y: cy, kind: 'hline' });
    } else if (shape.type === 'rect') {
      const center = getRectCenter(shape);
      const corners = getRectCorners(shape);
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      corners.forEach((p) => targets.push({ x: p.x, y: p.y, kind: 'point' }));
      targets.push({ x: center.x, y: center.y, kind: 'point' });
      targets.push({ x: minX, y: null, kind: 'vline' });
      targets.push({ x: center.x, y: null, kind: 'vline' });
      targets.push({ x: maxX, y: null, kind: 'vline' });
      targets.push({ x: null, y: minY, kind: 'hline' });
      targets.push({ x: null, y: center.y, kind: 'hline' });
      targets.push({ x: null, y: maxY, kind: 'hline' });
    }
  }

  return targets;
}

function getMovingAnchors(shape) {
  if (shape.type === 'line') {
    const cx = (shape.x1 + shape.x2) / 2;
    const cy = (shape.y1 + shape.y2) / 2;
    return {
      points: [
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y2 },
        { x: cx, y: cy },
      ],
      xs: [shape.x1, cx, shape.x2],
      ys: [shape.y1, cy, shape.y2],
    };
  }

  const center = getRectCenter(shape);
  const corners = getRectCorners(shape);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    points: [...corners, center],
    xs: [Math.min(...xs), center.x, Math.max(...xs)],
    ys: [Math.min(...ys), center.y, Math.max(...ys)],
  };
}

function computeMagneticPlacement(shape, excludeShapeId = null) {
  const settings = appState.project.settings;
  const anchors = getMovingAnchors(shape);
  const targets = collectSnapTargets(excludeShapeId);

  let bestPointShift = null;
  let bestXShift = null;
  let bestYShift = null;

  for (const target of targets) {
    if (target.kind === 'point') {
      for (const point of anchors.points) {
        const dx = target.x - point.x;
        const dy = target.y - point.y;
        const distance = Math.hypot(dx, dy);

        if (distance <= settings.magnetStrengthPx) {
          const score = distance;
          if (!bestPointShift || score < bestPointShift.score) {
            bestPointShift = { dx, dy, score, x: target.x, y: target.y };
          }
        }
      }
    }

    if (target.kind === 'vline') {
      for (const x of anchors.xs) {
        const dx = target.x - x;
        const distance = Math.abs(dx);
        if (distance <= settings.magnetStrengthPx) {
          const score = distance;
          if (!bestXShift || score < bestXShift.score) {
            bestXShift = { dx, score, guide: target.x };
          }
        }
      }
    }

    if (target.kind === 'hline') {
      for (const y of anchors.ys) {
        const dy = target.y - y;
        const distance = Math.abs(dy);
        if (distance <= settings.magnetStrengthPx) {
          const score = distance;
          if (!bestYShift || score < bestYShift.score) {
            bestYShift = { dy, score, guide: target.y };
          }
        }
      }
    }
  }

  let dx = 0;
  let dy = 0;
  let vertical = null;
  let horizontal = null;

  if (bestPointShift && bestPointShift.score <= settings.snapThresholdPx) {
    dx = bestPointShift.dx;
    dy = bestPointShift.dy;
    vertical = bestPointShift.x;
    horizontal = bestPointShift.y;
  } else {
    if (bestXShift) {
      dx = applyMagnetCurve(bestXShift.dx, settings);
      if (Math.abs(bestXShift.dx) <= settings.snapThresholdPx) {
        dx = bestXShift.dx;
      }
      vertical = bestXShift.guide;
    }

    if (bestYShift) {
      dy = applyMagnetCurve(bestYShift.dy, settings);
      if (Math.abs(bestYShift.dy) <= settings.snapThresholdPx) {
        dy = bestYShift.dy;
      }
      horizontal = bestYShift.guide;
    }
  }

  setGuides({ vertical, horizontal });

  return {
    point: translateShapeCenter(shape, dx, dy),
    dx,
    dy,
  };
}

function applyMagnetCurve(delta, settings) {
  const abs = Math.abs(delta);
  if (abs > settings.magnetStrengthPx) {
    return 0;
  }

  const factor = 1 - abs / settings.magnetStrengthPx;
  return delta * (0.22 + factor * 0.78);
}

function translateShapeCenter(shape, dx, dy) {
  if (shape.type === 'line') {
    return {
      x: shape.center.x + dx,
      y: shape.center.y + dy,
    };
  }

  return {
    x: shape.center.x + dx,
    y: shape.center.y + dy,
  };
}

function bindCanvas() {
  planCanvas.addEventListener('pointerdown', onCanvasPointerDown);
  planCanvas.addEventListener('pointermove', onCanvasPointerMove);
  planCanvas.addEventListener('pointerup', onCanvasPointerUp);
  planCanvas.addEventListener('pointercancel', onCanvasPointerUp);

  planCanvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();

      const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
      zoomAroundClientPoint(event.clientX, event.clientY, zoomFactor);
      refresh();
    },
    { passive: false },
  );
}

function onCanvasPointerDown(event) {
  if (appState.dragFromToolbar) {
    return;
  }

  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }

  const point = getCanvasPointFromClient(event.clientX, event.clientY);

  if (handlePinchStart(event)) {
    return;
  }

  const handle = event.target.closest('[data-handle]')?.getAttribute('data-handle');
  const shapeId = event.target.closest('[data-shape-id]')?.getAttribute('data-shape-id');

  if (handle) {
    startHandleInteraction(event, point, handle);
    return;
  }

  if (shapeId) {
    setSelection({ type: 'shape', id: shapeId });
    const shape = getSelectedShape();
    if (!shape) {
      refresh();
      return;
    }

    appState.pointer = {
      mode: 'move-shape',
      pointerId: event.pointerId,
      startWorld: point,
      startScreen: { x: event.clientX, y: event.clientY },
      targetId: shape.id,
      handle: null,
      original: structuredClone(shape),
      rotationMode: null,
      rotationClickCandidate: false,
    };

    planCanvas.setPointerCapture(event.pointerId);
    refresh();
    return;
  }

  clearSelection();
  clearGuides();
  appState.pointer = {
    mode: 'pan',
    pointerId: event.pointerId,
    startWorld: point,
    startScreen: { x: event.clientX, y: event.clientY },
    targetId: null,
    handle: null,
    original: {
      panX: appState.view.panX,
      panY: appState.view.panY,
    },
    rotationMode: null,
    rotationClickCandidate: false,
  };

  planCanvas.setPointerCapture(event.pointerId);
  refresh();
}

function handlePinchStart(event) {
  if (!planCanvas.hasPointerCapture(event.pointerId)) {
    planCanvas.setPointerCapture(event.pointerId);
  }

  if (!appState.pinch.pointerA) {
    appState.pinch.pointerA = {
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    return false;
  }

  if (!appState.pinch.pointerB && appState.pinch.pointerA.id !== event.pointerId) {
    appState.pinch.pointerB = {
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };

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
    appState.pinch.pointerA.clientX = event.clientX;
    appState.pinch.pointerA.clientY = event.clientY;
    return true;
  }
  if (appState.pinch.pointerB?.id === event.pointerId) {
    appState.pinch.pointerB.clientX = event.clientX;
    appState.pinch.pointerB.clientY = event.clientY;
    return true;
  }
  return false;
}

function removePinchPointer(pointerId) {
  if (appState.pinch.pointerA?.id === pointerId) {
    appState.pinch.pointerA = null;
  }
  if (appState.pinch.pointerB?.id === pointerId) {
    appState.pinch.pointerB = null;
  }

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

      const midClientX = (a.clientX + b.clientX) / 2;
      const midClientY = (a.clientY + b.clientY) / 2;
      const rect = planCanvas.getBoundingClientRect();
      const svgX = ((midClientX - rect.left) / rect.width) * SVG_WIDTH;
      const svgY = ((midClientY - rect.top) / rect.height) * SVG_HEIGHT;

      appState.view.zoom = nextZoom;
      appState.view.panX = svgX - appState.pinch.startWorldMid.x * nextZoom;
      appState.view.panY = svgY - appState.pinch.startWorldMid.y * nextZoom;
      refresh();
    }
    return;
  }

  if (appState.pointer.pointerId !== event.pointerId) {
    return;
  }

  const point = getCanvasPointFromClient(event.clientX, event.clientY);
  const selected = getSelectedShape();

  if (appState.pointer.mode === 'pan') {
    clearGuides();
    const dx = event.clientX - appState.pointer.startScreen.x;
    const dy = event.clientY - appState.pointer.startScreen.y;

    const rect = planCanvas.getBoundingClientRect();
    const scaleX = SVG_WIDTH / rect.width;
    const scaleY = SVG_HEIGHT / rect.height;

    appState.view.panX = appState.pointer.original.panX + dx * scaleX;
    appState.view.panY = appState.pointer.original.panY + dy * scaleY;
    refresh();
    return;
  }

  if (appState.pointer.mode === 'move-shape' && selected) {
    const original = appState.pointer.original;

    if (selected.type === 'rect') {
      const dx = point.x - appState.pointer.startWorld.x;
      const dy = point.y - appState.pointer.startWorld.y;
      const preview = {
        ...original,
        x: original.x + dx,
        y: original.y + dy,
      };
      const magnet = computeMagneticPlacement(preview, selected.id);
      selected.x = preview.x + magnet.dx;
      selected.y = preview.y + magnet.dy;
    }

    if (selected.type === 'line') {
      const dx = point.x - appState.pointer.startWorld.x;
      const dy = point.y - appState.pointer.startWorld.y;
      const preview = {
        ...original,
        x1: original.x1 + dx,
        y1: original.y1 + dy,
        x2: original.x2 + dx,
        y2: original.y2 + dy,
        center: {
          x: (original.x1 + original.x2) / 2 + dx,
          y: (original.y1 + original.y2) / 2 + dy,
        },
      };
      const magnet = computeMagneticPlacement(preview, selected.id);
      selected.x1 = preview.x1 + magnet.dx;
      selected.y1 = preview.y1 + magnet.dy;
      selected.x2 = preview.x2 + magnet.dx;
      selected.y2 = preview.y2 + magnet.dy;
    }

    refresh();
    return;
  }

  if (appState.pointer.mode === 'resize-rect' && selected?.type === 'rect') {
    resizeRectFromHandle(selected, point);
    refresh();
    return;
  }

  if (appState.pointer.mode === 'move-line-end' && selected?.type === 'line') {
    moveLineEndpoint(selected, point);
    refresh();
    return;
  }

  if (appState.pointer.mode === 'rotate' && selected) {
    clearGuides();
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

    if (
      appState.pointer.mode === 'rotate' &&
      appState.pointer.rotationClickCandidate &&
      selected
    ) {
      if (selected.type === 'rect') {
        rotateSelectedBy90Clockwise();
      } else if (selected.type === 'line') {
        rotateLineBy90Clockwise(selected);
      }
    }

    clearGuides();
    appState.pointer = {
      mode: 'idle',
      pointerId: null,
      startWorld: null,
      startScreen: null,
      targetId: null,
      handle: null,
      original: null,
      rotationMode: null,
      rotationClickCandidate: false,
    };

    refresh();
  }
}

function startHandleInteraction(event, point, handle) {
  const shape = getSelectedShape();
  if (!shape) {
    return;
  }

  let mode = 'idle';

  if (handle.startsWith('resize-') && shape.type === 'rect') {
    mode = 'resize-rect';
  } else if ((handle === 'line-start' || handle === 'line-end') && shape.type === 'line') {
    mode = 'move-line-end';
  } else if (handle === 'rotate') {
    mode = 'rotate';
  }

  appState.pointer = {
    mode,
    pointerId: event.pointerId,
    startWorld: point,
    startScreen: { x: event.clientX, y: event.clientY },
    targetId: shape.id,
    handle,
    original: structuredClone(shape),
    rotationMode: mode === 'rotate' ? shape.type : null,
    rotationClickCandidate: mode === 'rotate',
  };

  planCanvas.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function resizeRectFromHandle(shape, point) {
  const original = appState.pointer.original;
  const corners = getRectCorners(original);
  const handleIndex = Number(appState.pointer.handle.replace('resize-', ''));
  const oppositeIndex = (handleIndex + 2) % 4;

  const fixed = corners[oppositeIndex];
  const center = {
    x: (fixed.x + point.x) / 2,
    y: (fixed.y + point.y) / 2,
  };

  const angle = ((original.rotation || 0) * Math.PI) / 180;
  const unrotFixed = rotatePoint(fixed, center, -angle);
  const unrotMoving = rotatePoint(point, center, -angle);

  const minSize = 12;
  const width = Math.max(minSize, Math.abs(unrotMoving.x - unrotFixed.x));
  const height = Math.max(minSize, Math.abs(unrotMoving.y - unrotFixed.y));

  shape.widthPx = width;
  shape.heightPx = height;
  shape.x = center.x - width / 2;
  shape.y = center.y - height / 2;
  shape.rotation = original.rotation || 0;

  const magnet = computeMagneticPlacement(shape, shape.id);
  shape.x += magnet.dx;
  shape.y += magnet.dy;
}

function moveLineEndpoint(shape, point) {
  const snapped = snapLineEndpointWithMagnet(shape, point);

  if (appState.pointer.handle === 'line-start') {
    shape.x1 = snapped.x;
    shape.y1 = snapped.y;
  }

  if (appState.pointer.handle === 'line-end') {
    shape.x2 = snapped.x;
    shape.y2 = snapped.y;
  }
}

function snapLineEndpointWithMagnet(shape, point) {
  const settings = appState.project.settings;
  const targets = collectSnapTargets(shape.id).filter((target) => target.kind === 'point');
  let best = null;

  for (const target of targets) {
    const dx = target.x - point.x;
    const dy = target.y - point.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= settings.magnetStrengthPx && (!best || distance < best.distance)) {
      best = { x: target.x, y: target.y, distance };
    }
  }

  if (!best) {
    clearGuides();
    return point;
  }

  setGuides({ vertical: best.x, horizontal: best.y });

  if (best.distance <= settings.snapThresholdPx) {
    return { x: best.x, y: best.y };
  }

  const factor = 1 - best.distance / settings.magnetStrengthPx;
  return {
    x: point.x + (best.x - point.x) * (0.22 + factor * 0.78),
    y: point.y + (best.y - point.y) * (0.22 + factor * 0.78),
  };
}

function rotateSelectedFromPointer(shape, point) {
  const origin = shape.type === 'rect'
    ? getRectCenter(shape)
    : { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 };

  const dx = point.x - origin.x;
  const dy = point.y - origin.y;

  if (Math.hypot(dx, dy) > 8) {
    appState.pointer.rotationClickCandidate = false;
  }

  let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  angleDeg = snapRotationAngle(angleDeg);

  if (shape.type === 'rect') {
    shape.rotation = normalizeAngle(angleDeg);
    return;
  }

  if (shape.type === 'line') {
    const length = getLineLengthPx(shape);
    const rad = (angleDeg * Math.PI) / 180;
    const half = length / 2;
    const cx = origin.x;
    const cy = origin.y;
    shape.x1 = cx - Math.sin(rad) * half;
    shape.y1 = cy + Math.cos(rad) * half;
    shape.x2 = cx + Math.sin(rad) * half;
    shape.y2 = cy - Math.cos(rad) * half;
  }
}

function snapRotationAngle(angleDeg) {
  const step = appState.project.settings.rotateSnapDeg || 45;
  return Math.round(angleDeg / step) * step;
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
  const nextZoom = Math.max(
    appState.view.minZoom,
    Math.min(appState.view.maxZoom, appState.view.zoom * factor),
  );

  appState.view.zoom = nextZoom;

  const rect = planCanvas.getBoundingClientRect();
  const svgX = ((clientX - rect.left) / rect.width) * SVG_WIDTH;
  const svgY = ((clientY - rect.top) / rect.height) * SVG_HEIGHT;

  appState.view.panX = svgX - pointBefore.x * nextZoom;
  appState.view.panY = svgY - pointBefore.y * nextZoom;
}

function bindDimensions() {
  [widthInput, heightInput].forEach((input) => {
    input.addEventListener('focus', () => {
      input.select();
    });

    input.addEventListener('click', () => {
      input.select();
    });
  });

  applyDimensionsBtn.addEventListener('click', () => {
    const widthCm = Math.max(1, Number(widthInput.value) || 1);
    const heightCm = Math.max(1, Number(heightInput.value) || 1);
    updateSelectedDimensions(widthCm, heightCm);
    clearGuides();
    refresh();
  });
}

function bindBottomBar() {
  deleteBtn.addEventListener('click', () => {
    if (deleteSelectedShape()) {
      clearGuides();
      refresh();
    }
  });

  duplicateBtn.addEventListener('click', () => {
    duplicateSelectedShape();
    clearGuides();
    refresh();
  });

  [undoBtn, redoBtn, saveBtn, exportBtn, settingsBtn].forEach((button) => {
    button.addEventListener('click', () => {
      showToast(`${button.textContent} is nog niet uitgewerkt`);
    });
  });
}

setCanvasViewBox();
bindToolbar();
bindCanvas();
bindDimensions();
bindBottomBar();
refresh();
