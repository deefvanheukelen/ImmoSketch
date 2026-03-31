import { renderScene, getFaceMetrics } from './renderer.js';
import {
  appState,
  createShapeAt,
  deleteSelectedShape,
  duplicateSelectedShape,
  getSelectedShape,
  getShapeById,
  moveShapeBy,
  panViewport,
  rotateFaceTo,
  rotateLineTo,
  setActiveHandle,
  setSelectedTool,
  setSelection,
  setSnapLines,
  setToolDrag,
  setViewportZoom,
  updateFaceFromPx,
  updateLineEndpoint,
  updateSelectedShapeDimensions,
} from './state.js';

const toast = document.getElementById('toast');
const topbar = document.getElementById('topbar');
const widthInput = document.getElementById('widthInput');
const heightInput = document.getElementById('heightInput');
const widthUnit = document.getElementById('widthUnit');
const heightUnit = document.getElementById('heightUnit');
const applyDimensionsBtn = document.getElementById('applyDimensionsBtn');
const planCanvas = document.getElementById('planCanvas');
const canvasStage = document.getElementById('canvasStage');
const toolButtons = [...document.querySelectorAll('.tool-btn')];
const actionButtons = [...document.querySelectorAll('.action-btn')];
const dimensionInputs = [widthInput, heightInput];
const dragIndicator = document.getElementById('dragIndicator');

const pointerState = new Map();
let pinchStart = null;
let dragState = null;
let toolbarDrag = null;

const OPPOSITE_CORNERS = { nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' };

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.classList.remove('show');
  }, 1600);
}

function rotatePoint(point, center, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function inverseRotatePoint(point, center, degrees) {
  return rotatePoint(point, center, -degrees);
}

function getFaceCorners(shape) {
  const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
  const center = { x: centerX, y: centerY };
  return {
    center,
    nw: rotatePoint({ x: shape.x, y: shape.y }, center, rotation),
    ne: rotatePoint({ x: shape.x + widthPx, y: shape.y }, center, rotation),
    se: rotatePoint({ x: shape.x + widthPx, y: shape.y + heightPx }, center, rotation),
    sw: rotatePoint({ x: shape.x, y: shape.y + heightPx }, center, rotation),
  };
}

function syncTopbarWithSelection() {
  const shape = getSelectedShape();
  if (!shape) {
    topbar.classList.add('hidden');
    return;
  }

  topbar.classList.remove('hidden');

  if (shape.type === 'face') {
    widthInput.disabled = false;
    heightInput.disabled = false;
    widthInput.value = String(Math.round(shape.widthCm));
    heightInput.value = String(Math.round(shape.heightCm));
    widthUnit.textContent = 'cm';
    heightUnit.textContent = 'cm';
    return;
  }

  const lengthPx = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
  const lengthCm = Math.round(lengthPx / appState.project.settings.scalePxPerCm);
  widthInput.disabled = false;
  heightInput.disabled = true;
  widthInput.value = String(lengthCm);
  heightInput.value = '0';
  widthUnit.textContent = 'cm';
  heightUnit.textContent = '—';
}

function bindToolButtons() {
  toolButtons.forEach((button) => {
    button.addEventListener('click', () => {
      toolButtons.forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      setSelectedTool(button.dataset.tool);
      showToast(`Tool geselecteerd: ${button.dataset.tool}`);
    });

    button.addEventListener('pointerdown', (event) => {
      toolbarDrag = {
        pointerId: event.pointerId,
        tool: button.dataset.tool,
        startX: event.clientX,
        startY: event.clientY,
        hasMoved: false,
      };
      button.setPointerCapture(event.pointerId);
    });

    button.addEventListener('pointermove', (event) => {
      if (!toolbarDrag || toolbarDrag.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - toolbarDrag.startX, event.clientY - toolbarDrag.startY);
      if (distance > 10) {
        toolbarDrag.hasMoved = true;
        dragIndicator.classList.remove('hidden');
        updateToolPreview(event.clientX, event.clientY, toolbarDrag.tool);
      }
    });

    function endToolDrag(event) {
      if (!toolbarDrag || toolbarDrag.pointerId !== event.pointerId) return;
      const currentDrag = toolbarDrag;
      dragIndicator.classList.add('hidden');

      if (currentDrag.hasMoved) {
        const stageRect = canvasStage.getBoundingClientRect();
        if (
          event.clientX >= stageRect.left && event.clientX <= stageRect.right &&
          event.clientY >= stageRect.top && event.clientY <= stageRect.bottom
        ) {
          placeElement(currentDrag.tool, event.clientX, event.clientY);
        }
      }

      toolbarDrag = null;
      setToolDrag(null);
      renderScene();
    }

    button.addEventListener('pointerup', endToolDrag);
    button.addEventListener('pointercancel', endToolDrag);
  });
}

function applyDimensionChanges() {
  const width = Math.max(1, Number(widthInput.value) || 1);
  const height = Math.max(1, Number(heightInput.value) || 1);
  const updatedShape = updateSelectedShapeDimensions(width, height);

  if (!updatedShape) {
    showToast('Geen element geselecteerd');
    return;
  }

  syncTopbarWithSelection();
  renderScene();
  showToast('Afmetingen aangepast');
}

function bindDimensionControls() {
  applyDimensionsBtn.addEventListener('click', applyDimensionChanges);
  widthInput.addEventListener('change', applyDimensionChanges);
  heightInput.addEventListener('change', applyDimensionChanges);

  dimensionInputs.forEach((input) => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('click', () => input.select());
    input.addEventListener('pointerup', (event) => {
      event.preventDefault();
      input.select();
    });
  });
}

function bindActionButtons() {
  actionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.id === 'deleteBtn') {
        const removed = deleteSelectedShape();
        syncTopbarWithSelection();
        renderScene();
        showToast(removed ? 'Element verwijderd' : 'Niets geselecteerd');
        return;
      }

      if (button.id === 'duplicateBtn') {
        const clone = duplicateSelectedShape();
        syncTopbarWithSelection();
        renderScene();
        showToast(clone ? 'Element gedupliceerd' : 'Niets geselecteerd');
        return;
      }

      showToast(`${button.textContent} is nog een placeholder`);
    });
  });
}

function getSvgPoint(clientX, clientY) {
  const rect = planCanvas.getBoundingClientRect();
  const baseX = ((clientX - rect.left) / rect.width) * appState.viewport.baseWidth;
  const baseY = ((clientY - rect.top) / rect.height) * appState.viewport.baseHeight;
  return {
    x: (baseX - appState.viewport.panX) / appState.viewport.zoom,
    y: (baseY - appState.viewport.panY) / appState.viewport.zoom,
  };
}

function snapValue(value, candidates, threshold) {
  let best = value;
  let minDistance = threshold + 1;
  candidates.forEach((candidate) => {
    const distance = Math.abs(candidate - value);
    if (distance < minDistance) {
      minDistance = distance;
      best = candidate;
    }
  });
  return minDistance <= threshold ? best : value;
}

function collectSnapCandidates(excludeShapeId = null) {
  const candidatesX = [0, 600, 1200];
  const candidatesY = [0, 450, 900];

  appState.project.shapes.forEach((shape) => {
    if (shape.id === excludeShapeId) return;

    if (shape.type === 'face') {
      const { widthPx, heightPx, centerX, centerY } = getFaceMetrics(shape);
      candidatesX.push(shape.x, centerX, shape.x + widthPx);
      candidatesY.push(shape.y, centerY, shape.y + heightPx);
      return;
    }

    candidatesX.push(shape.x1, shape.x2, (shape.x1 + shape.x2) / 2);
    candidatesY.push(shape.y1, shape.y2, (shape.y1 + shape.y2) / 2);
  });

  return { candidatesX, candidatesY };
}

function getSnappedPoint(point, excludeShapeId = null) {
  const step = appState.project.settings.snapStepPx;
  const threshold = appState.project.settings.snapThresholdPx;
  const { candidatesX, candidatesY } = collectSnapCandidates(excludeShapeId);
  const gridX = Math.round(point.x / step) * step;
  const gridY = Math.round(point.y / step) * step;
  candidatesX.push(gridX);
  candidatesY.push(gridY);

  const snappedX = snapValue(point.x, candidatesX, threshold);
  const snappedY = snapValue(point.y, candidatesY, threshold);
  const lines = [];
  if (snappedX !== point.x) lines.push({ x1: snappedX, y1: 0, x2: snappedX, y2: 900 });
  if (snappedY !== point.y) lines.push({ x1: 0, y1: snappedY, x2: 1200, y2: snappedY });

  return { x: snappedX, y: snappedY, lines };
}

function getSnappedMoveDelta(shape, rawDeltaX, rawDeltaY) {
  if (shape.type === 'line') {
    const start = getSnappedPoint({ x: shape.x1 + rawDeltaX, y: shape.y1 + rawDeltaY }, shape.id);
    return { deltaX: start.x - shape.x1, deltaY: start.y - shape.y1, lines: start.lines };
  }

  const snappedTopLeft = getSnappedPoint({ x: shape.x + rawDeltaX, y: shape.y + rawDeltaY }, shape.id);
  return { deltaX: snappedTopLeft.x - shape.x, deltaY: snappedTopLeft.y - shape.y, lines: snappedTopLeft.lines };
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function snapAngle(degrees) {
  const step = appState.project.settings.rotateSnapDeg;
  const threshold = appState.project.settings.rotateSnapThresholdDeg;
  const normalized = normalizeDegrees(degrees);
  const snapped = Math.round(normalized / step) * step;
  const diff = Math.abs(snapped - normalized);
  const wrappedDiff = Math.min(diff, 360 - diff);
  return wrappedDiff <= threshold ? normalizeDegrees(snapped) : normalized;
}

function getLineAngle(shape) {
  return normalizeDegrees((Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1) * 180) / Math.PI);
}

function startMove(shape, point) {
  dragState = {
    mode: 'move',
    shapeId: shape.id,
    startPoint: point,
    original: structuredClone(shape),
  };
}

function startPan(clientX, clientY) {
  dragState = {
    mode: 'pan',
    lastClientX: clientX,
    lastClientY: clientY,
  };
}

function startRotate(shape, point) {
  const center = shape.type === 'line'
    ? { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 }
    : (() => {
        const geo = getFaceMetrics(shape);
        return { x: geo.centerX, y: geo.centerY };
      })();

  dragState = {
    mode: 'rotate',
    shapeId: shape.id,
    center,
    original: structuredClone(shape),
    startAngle: Math.atan2(point.y - center.y, point.x - center.x),
    baseRotation: shape.type === 'line' ? getLineAngle(shape) : normalizeDegrees(shape.rotation ?? 0),
  };
  setActiveHandle('rotate');
}

function startFaceResize(shape, corner) {
  dragState = {
    mode: 'resize-face',
    shapeId: shape.id,
    corner,
    original: structuredClone(shape),
    oppositeCorner: getFaceCorners(shape)[OPPOSITE_CORNERS[corner]],
  };
  setActiveHandle(`resize-${corner}`);
}

function startLineEndpointResize(shape, endpoint) {
  dragState = {
    mode: 'line-endpoint',
    shapeId: shape.id,
    endpoint,
    original: structuredClone(shape),
  };
  setActiveHandle(`line-${endpoint}`);
}

function updateToolPreview(clientX, clientY, tool) {
  const point = getSvgPoint(clientX, clientY);
  const snapped = getSnappedPoint(point);
  setSnapLines(snapped.lines);
  setToolDrag({ tool, previewPoint: { x: snapped.x, y: snapped.y } });
  renderScene();
}

function placeElement(tool, clientX, clientY) {
  const point = getSvgPoint(clientX, clientY);
  const snapped = getSnappedPoint(point);
  setSnapLines(snapped.lines);
  const shape = createShapeAt(tool, snapped.x, snapped.y);
  syncTopbarWithSelection();
  renderScene();
  showToast(`Element geplaatst: ${shape.type === 'line' ? 'lijn' : tool}`);
  window.setTimeout(() => {
    setSnapLines([]);
    renderScene();
  }, 220);
}

function trySelectShape(target) {
  const shapeId = target?.dataset?.shapeId;
  if (!shapeId) return null;
  const shape = getShapeById(shapeId);
  if (!shape) return null;
  setSelection({ type: shape.type, id: shape.id });
  syncTopbarWithSelection();
  renderScene();
  return shape;
}

function bindCanvasPointerEvents() {
  canvasStage.addEventListener('pointerdown', (event) => {
    canvasStage.setPointerCapture(event.pointerId);
    pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointerState.size === 2) {
      const values = [...pointerState.values()];
      pinchStart = {
        distance: Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y),
        zoom: appState.viewport.zoom,
        anchor: getSvgPoint((values[0].x + values[1].x) / 2, (values[0].y + values[1].y) / 2),
      };
      dragState = null;
      return;
    }

    const point = getSvgPoint(event.clientX, event.clientY);

    if (event.target?.dataset?.handle === 'rotate') {
      const shape = getShapeById(event.target.dataset.shapeId);
      if (shape) {
        startRotate(shape, point);
        return;
      }
    }

    if (event.target?.dataset?.handle === 'resize-face') {
      const shape = getShapeById(event.target.dataset.shapeId);
      if (shape) {
        startFaceResize(shape, event.target.dataset.corner);
        return;
      }
    }

    if (event.target?.dataset?.handle === 'line-endpoint') {
      const shape = getShapeById(event.target.dataset.shapeId);
      if (shape) {
        startLineEndpointResize(shape, event.target.dataset.endpoint);
        return;
      }
    }

    const shape = trySelectShape(event.target);
    if (shape) {
      startMove(shape, point);
      return;
    }

    startPan(event.clientX, event.clientY);
  });

  canvasStage.addEventListener('pointermove', (event) => {
    if (!pointerState.has(event.pointerId)) return;
    pointerState.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointerState.size === 2 && pinchStart) {
      const values = [...pointerState.values()];
      const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
      setViewportZoom(pinchStart.zoom * (distance / pinchStart.distance), pinchStart.anchor);
      renderScene();
      return;
    }

    if (!dragState) return;

    if (dragState.mode === 'pan') {
      const deltaX = event.clientX - dragState.lastClientX;
      const deltaY = event.clientY - dragState.lastClientY;
      panViewport(deltaX, deltaY);
      dragState.lastClientX = event.clientX;
      dragState.lastClientY = event.clientY;
      renderScene();
      return;
    }

    const shape = getShapeById(dragState.shapeId);
    if (!shape) return;
    const point = getSvgPoint(event.clientX, event.clientY);

    if (dragState.mode === 'move') {
      Object.assign(shape, structuredClone(dragState.original));
      const rawDeltaX = point.x - dragState.startPoint.x;
      const rawDeltaY = point.y - dragState.startPoint.y;
      const snapped = getSnappedMoveDelta(shape, rawDeltaX, rawDeltaY);
      moveShapeBy(shape, snapped.deltaX, snapped.deltaY);
      setSnapLines(snapped.lines);
      syncTopbarWithSelection();
      renderScene();
      return;
    }

    if (dragState.mode === 'rotate') {
      const currentAngle = Math.atan2(point.y - dragState.center.y, point.x - dragState.center.x);
      const deltaDeg = ((currentAngle - dragState.startAngle) * 180) / Math.PI;
      const targetDeg = snapAngle(dragState.baseRotation + deltaDeg);
      Object.assign(shape, structuredClone(dragState.original));
      if (shape.type === 'line') rotateLineTo(shape, targetDeg);
      else rotateFaceTo(shape, targetDeg);
      setSnapLines([]);
      syncTopbarWithSelection();
      renderScene();
      return;
    }

    if (dragState.mode === 'line-endpoint') {
      Object.assign(shape, structuredClone(dragState.original));
      const snapped = getSnappedPoint(point, shape.id);
      updateLineEndpoint(shape, dragState.endpoint === 'start' ? 'start' : 'end', snapped.x, snapped.y);
      setSnapLines(snapped.lines);
      syncTopbarWithSelection();
      renderScene();
      return;
    }

    if (dragState.mode === 'resize-face') {
      Object.assign(shape, structuredClone(dragState.original));
      const snapped = getSnappedPoint(point, shape.id);
      const rotation = shape.rotation ?? 0;
      const fixedCorner = dragState.oppositeCorner;
      const newCenter = {
        x: (fixedCorner.x + snapped.x) / 2,
        y: (fixedCorner.y + snapped.y) / 2,
      };
      const draggedLocal = inverseRotatePoint({ x: snapped.x, y: snapped.y }, newCenter, rotation);
      const fixedLocal = inverseRotatePoint(fixedCorner, newCenter, rotation);
      const widthPx = Math.max(20, Math.abs(draggedLocal.x - fixedLocal.x));
      const heightPx = Math.max(20, Math.abs(draggedLocal.y - fixedLocal.y));
      updateFaceFromPx(shape, newCenter.x - widthPx / 2, newCenter.y - heightPx / 2, widthPx, heightPx);
      setSnapLines(snapped.lines);
      syncTopbarWithSelection();
      renderScene();
    }
  });

  function endPointer(event) {
    pointerState.delete(event.pointerId);
    if (pointerState.size < 2) pinchStart = null;
    if (pointerState.size === 0) {
      dragState = null;
      setActiveHandle(null);
      setSnapLines([]);
      renderScene();
    }
  }

  canvasStage.addEventListener('pointerup', endPointer);
  canvasStage.addEventListener('pointercancel', endPointer);

  canvasStage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1.1 : 0.9;
    const anchor = getSvgPoint(event.clientX, event.clientY);
    setViewportZoom(appState.viewport.zoom * direction, anchor);
    renderScene();
  }, { passive: false });
}

bindToolButtons();
bindDimensionControls();
bindActionButtons();
bindCanvasPointerEvents();
syncTopbarWithSelection();
renderScene();
