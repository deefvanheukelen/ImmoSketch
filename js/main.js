import { renderScene, getFaceMetrics, getFaceCorners, rotatePoint } from './renderer.js';
import {
  appState,
  clearSelection,
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
  setLineEndpoint,
  setSelectedTool,
  setSelection,
  setSnapLines,
  setViewportZoom,
  updateFaceSizePx,
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

const pointerState = new Map();
const dragGhost = document.createElement('div');
dragGhost.className = 'drag-ghost hidden';
document.body.appendChild(dragGhost);

let pinchStart = null;
let dragState = null;
let toolbarDrag = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.classList.remove('show');
  }, 1600);
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
  }

  if (shape.type === 'line') {
    const lengthPx = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
    const lengthCm = Math.round(lengthPx / appState.project.settings.scalePxPerCm);
    widthInput.disabled = false;
    heightInput.disabled = true;
    widthInput.value = String(lengthCm);
    heightInput.value = '0';
    widthUnit.textContent = 'cm';
    heightUnit.textContent = '—';
  }
}

function setActiveToolButton(tool) {
  toolButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.tool === tool));
}

function bindToolButtons() {
  toolButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setSelectedTool(button.dataset.tool);
      setActiveToolButton(button.dataset.tool);
      showToast(`Tool geselecteerd: ${button.dataset.tool}`);
    });

    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      setSelectedTool(button.dataset.tool);
      setActiveToolButton(button.dataset.tool);
      toolbarDrag = {
        pointerId: event.pointerId,
        tool: button.dataset.tool,
        button,
      };
      button.classList.add('dragging');
      dragGhost.textContent = `Sleep ${button.dataset.tool} naar het canvas`;
      dragGhost.classList.remove('hidden');
      updateGhost(event.clientX, event.clientY);
    });
  });
}

function updateGhost(clientX, clientY) {
  dragGhost.style.left = `${clientX}px`;
  dragGhost.style.top = `${clientY}px`;
}

function resetToolbarDrag() {
  if (toolbarDrag?.button) {
    toolbarDrag.button.classList.remove('dragging');
  }
  toolbarDrag = null;
  dragGhost.classList.add('hidden');
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

function pointInsideCanvas(clientX, clientY) {
  const rect = canvasStage.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
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
      const corners = getFaceCorners(shape);
      Object.values(corners).forEach((point) => {
        candidatesX.push(point.x);
        candidatesY.push(point.y);
      });
    }

    if (shape.type === 'line') {
      candidatesX.push(shape.x1, shape.x2, (shape.x1 + shape.x2) / 2);
      candidatesY.push(shape.y1, shape.y2, (shape.y1 + shape.y2) / 2);
    }
  });

  return { candidatesX, candidatesY };
}

function getSnappedPoint(point, excludeShapeId = null) {
  const step = appState.project.settings.snapStepPx;
  const threshold = appState.project.settings.snapThresholdPx;
  const { candidatesX, candidatesY } = collectSnapCandidates(excludeShapeId);
  candidatesX.push(Math.round(point.x / step) * step);
  candidatesY.push(Math.round(point.y / step) * step);

  const snappedX = snapValue(point.x, candidatesX, threshold);
  const snappedY = snapValue(point.y, candidatesY, threshold);
  const lines = [];
  if (snappedX !== point.x) lines.push({ x1: snappedX, y1: 0, x2: snappedX, y2: 900 });
  if (snappedY !== point.y) lines.push({ x1: 0, y1: snappedY, x2: 1200, y2: snappedY });

  return { x: snappedX, y: snappedY, lines };
}

function getSnappedMoveDelta(shape, rawDeltaX, rawDeltaY) {
  if (shape.type === 'line') {
    const snappedStart = getSnappedPoint({ x: shape.x1 + rawDeltaX, y: shape.y1 + rawDeltaY }, shape.id);
    return {
      deltaX: snappedStart.x - shape.x1,
      deltaY: snappedStart.y - shape.y1,
      lines: snappedStart.lines,
    };
  }

  const snappedTopLeft = getSnappedPoint({ x: shape.x + rawDeltaX, y: shape.y + rawDeltaY }, shape.id);
  return {
    deltaX: snappedTopLeft.x - shape.x,
    deltaY: snappedTopLeft.y - shape.y,
    lines: snappedTopLeft.lines,
  };
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

function toLocal(point, center, rotationDeg) {
  return rotatePoint(point, center, -rotationDeg);
}

function startMove(shape, point) {
  dragState = { mode: 'move', shapeId: shape.id, startPoint: point, original: structuredClone(shape) };
}

function startRotate(shape, point) {
  const center = shape.type === 'line'
    ? { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 }
    : (() => {
        const metrics = getFaceMetrics(shape);
        return { x: metrics.centerX, y: metrics.centerY };
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

function startFaceResize(shape, handleName) {
  const metrics = getFaceMetrics(shape);
  dragState = {
    mode: 'resize-face',
    shapeId: shape.id,
    handleName,
    center: { x: metrics.centerX, y: metrics.centerY },
    original: structuredClone(shape),
  };
  setActiveHandle(handleName);
}

function startLineEndpointDrag(shape, endpoint) {
  dragState = {
    mode: 'endpoint',
    shapeId: shape.id,
    endpoint,
    original: structuredClone(shape),
  };
  setActiveHandle(endpoint);
}

function placeElement(clientX, clientY, tool) {
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
    if (toolbarDrag) return;

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
    const handle = event.target?.dataset?.handle;

    if (handle === 'rotate') {
      const shape = getShapeById(event.target.dataset.shapeId);
      if (shape) startRotate(shape, point);
      return;
    }

    if (handle?.startsWith('resize-')) {
      const shape = getShapeById(event.target.dataset.shapeId);
      if (shape?.type === 'face') startFaceResize(shape, handle.replace('resize-', ''));
      return;
    }

    if (handle?.startsWith('endpoint-')) {
      const shape = getShapeById(event.target.dataset.shapeId);
      if (shape?.type === 'line') startLineEndpointDrag(shape, handle.replace('endpoint-', ''));
      return;
    }

    const shape = trySelectShape(event.target);
    if (shape) {
      startMove(shape, point);
      return;
    }

    clearSelection();
    syncTopbarWithSelection();
    renderScene();
  });

  canvasStage.addEventListener('pointermove', (event) => {
    if (toolbarDrag && toolbarDrag.pointerId === event.pointerId) {
      updateGhost(event.clientX, event.clientY);
      return;
    }

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
      if (shape.type === 'face') rotateFaceTo(shape, targetDeg);
      setSnapLines([]);
      syncTopbarWithSelection();
      renderScene();
      return;
    }

    if (dragState.mode === 'resize-face' && shape.type === 'face') {
      Object.assign(shape, structuredClone(dragState.original));
      const snapped = getSnappedPoint(point, shape.id);
      const local = toLocal({ x: snapped.x, y: snapped.y }, dragState.center, shape.rotation ?? 0);
      const centerLocal = toLocal(dragState.center, dragState.center, shape.rotation ?? 0);
      const widthPx = Math.max(20, Math.abs(local.x - centerLocal.x) * 2);
      const heightPx = Math.max(20, Math.abs(local.y - centerLocal.y) * 2);
      updateFaceSizePx(shape, widthPx, heightPx);
      const metrics = getFaceMetrics(shape);
      shape.x = dragState.center.x - (metrics.widthPx / 2);
      shape.y = dragState.center.y - (metrics.heightPx / 2);
      setSnapLines(snapped.lines);
      syncTopbarWithSelection();
      renderScene();
      return;
    }

    if (dragState.mode === 'endpoint' && shape.type === 'line') {
      Object.assign(shape, structuredClone(dragState.original));
      const snapped = getSnappedPoint(point, shape.id);
      setLineEndpoint(shape, dragState.endpoint, snapped.x, snapped.y);
      setSnapLines(snapped.lines);
      syncTopbarWithSelection();
      renderScene();
    }
  });

  function endPointer(event) {
    if (toolbarDrag && toolbarDrag.pointerId === event.pointerId) {
      if (pointInsideCanvas(event.clientX, event.clientY)) {
        placeElement(event.clientX, event.clientY, toolbarDrag.tool);
      }
      resetToolbarDrag();
      return;
    }

    pointerState.delete(event.pointerId);
    if (pointerState.size < 2) pinchStart = null;
    if (pointerState.size === 0) {
      dragState = null;
      setActiveHandle(null);
      setSnapLines([]);
      renderScene();
    }
  }

  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  canvasStage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1.1 : 0.9;
    const anchor = getSvgPoint(event.clientX, event.clientY);
    setViewportZoom(appState.viewport.zoom * direction, anchor);
    renderScene();
  }, { passive: false });

  let panStart = null;
  canvasStage.addEventListener('contextmenu', (event) => event.preventDefault());
  canvasStage.addEventListener('mousedown', (event) => {
    if (event.button !== 1 && event.button !== 2) return;
    panStart = { x: event.clientX, y: event.clientY };
  });

  window.addEventListener('mousemove', (event) => {
    if (!panStart) return;
    const deltaX = event.clientX - panStart.x;
    const deltaY = event.clientY - panStart.y;
    panViewport(deltaX, deltaY);
    panStart = { x: event.clientX, y: event.clientY };
    renderScene();
  });

  window.addEventListener('mouseup', () => {
    panStart = null;
  });
}

bindToolButtons();
bindDimensionControls();
bindActionButtons();
bindCanvasPointerEvents();
syncTopbarWithSelection();
renderScene();
