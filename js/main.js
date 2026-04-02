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
  cmToPx,
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

function worldToScreen(worldX, worldY) {
  const { panX, panY, zoom } = appState.view;
  return {
    x: worldX * zoom + panX,
    y: worldY * zoom + panY,
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
  if (!appState.project.settings.snapEnabled) {
    return point;
  }

  const candidates = collectSnapCandidates();
  if (!candidates.length) {
    return point;
  }

  let best = null;
  for (const candidate of candidates) {
    const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (d <= appState.project.settings.snapThresholdPx && (!best || d < best.d)) {
      best = { x: candidate.x, y: candidate.y, d };
    }
  }

  return best ? { x: best.x, y: best.y } : point;
}

function collectSnapCandidates(excludeShapeId = null) {
  const points = [];

  appState.project.shapes.forEach((shape) => {
    if (shape.id === excludeShapeId) {
      return;
    }

    if (shape.type === 'line') {
      points.push({ x: shape.x1, y: shape.y1 });
      points.push({ x: shape.x2, y: shape.y2 });
      points.push({ x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 });
    }

    if (shape.type === 'rect') {
      const corners = getRectCorners(shape);
      corners.forEach((p) => points.push(p));
      points.push(getRectCenter(shape));

      getRectEdges(shape).forEach(([a, b]) => {
        points.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      });
    }
  });

  return points;
}

function snapPointToElements(point, excludeShapeId = null) {
  const candidates = collectSnapCandidates(excludeShapeId);
  if (!candidates.length) {
    return point;
  }

  let best = null;
  for (const candidate of candidates) {
    const d = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (d <= appState.project.settings.snapThresholdPx && (!best || d < best.d)) {
      best = { ...candidate, d };
    }
  }

  return best ? { x: best.x, y: best.y } : point;
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

  if (handlePinchStart(event, point)) {
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

function handlePinchStart(event, point) {
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
    appState.pinch.startPanX = appState.view.panX;
    appState.pinch.startPanY = appState.view.panY;

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
      const movedCenter = {
        x: original.x + original.widthPx / 2 + dx,
        y: original.y + original.heightPx / 2 + dy,
      };
      const snappedCenter = snapPointToElements(movedCenter, selected.id);

      selected.x = snappedCenter.x - original.widthPx / 2;
      selected.y = snappedCenter.y - original.heightPx / 2;
    }

    if (selected.type === 'line') {
      const dx = point.x - appState.pointer.startWorld.x;
      const dy = point.y - appState.pointer.startWorld.y;
      const center = {
        x: (original.x1 + original.x2) / 2 + dx,
        y: (original.y1 + original.y2) / 2 + dy,
      };
      const snappedCenter = snapPointToElements(center, selected.id);
      const offsetX = snappedCenter.x - center.x;
      const offsetY = snappedCenter.y - center.y;

      selected.x1 = original.x1 + dx + offsetX;
      selected.y1 = original.y1 + dy + offsetY;
      selected.x2 = original.x2 + dx + offsetX;
      selected.y2 = original.y2 + dy + offsetY;
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

  const movingWorld = snapPointToElements(point, shape.id);
  const fixed = corners[oppositeIndex];

  const center = {
    x: (fixed.x + movingWorld.x) / 2,
    y: (fixed.y + movingWorld.y) / 2,
  };

  const angle = ((original.rotation || 0) * Math.PI) / 180;
  const unrotFixed = rotatePoint(fixed, center, -angle);
  const unrotMoving = rotatePoint(movingWorld, center, -angle);

  const minSize = 12;
  const width = Math.max(minSize, Math.abs(unrotMoving.x - unrotFixed.x));
  const height = Math.max(minSize, Math.abs(unrotMoving.y - unrotFixed.y));

  shape.widthPx = width;
  shape.heightPx = height;
  shape.x = center.x - width / 2;
  shape.y = center.y - height / 2;
  shape.rotation = original.rotation || 0;
}

function moveLineEndpoint(shape, point) {
  const snapped = snapPointToElements(point, shape.id);

  if (appState.pointer.handle === 'line-start') {
    shape.x1 = snapped.x;
    shape.y1 = snapped.y;
  }

  if (appState.pointer.handle === 'line-end') {
    shape.x2 = snapped.x;
    shape.y2 = snapped.y;
  }
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
    refresh();
  });
}

function bindBottomBar() {
  deleteBtn.addEventListener('click', () => {
    if (deleteSelectedShape()) {
      refresh();
    }
  });

  duplicateBtn.addEventListener('click', () => {
    duplicateSelectedShape();
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