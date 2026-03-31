import { renderScene, getClosedLineLoops, getFaceMetrics, rotatePoint } from './renderer.js';
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

let toolbarDrag = null;
let dragState = null;
let pinchStart = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => toast.classList.remove('show'), 1500);
}

function syncTopbarWithSelection() {
  const selected = appState.project.selection;
  const shape = getSelectedShape();
  if (!selected || !shape) {
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
  widthInput.disabled = false;
  heightInput.disabled = true;
  widthInput.value = String(Math.round(lengthPx / appState.project.settings.scalePxPerCm));
  heightInput.value = '0';
  widthUnit.textContent = 'cm';
  heightUnit.textContent = '—';
}

function updateGhost(clientX, clientY) {
  dragGhost.style.left = `${clientX}px`;
  dragGhost.style.top = `${clientY}px`;
}

function resetToolbarDrag() {
  if (toolbarDrag?.button) toolbarDrag.button.classList.remove('dragging');
  toolbarDrag = null;
  dragGhost.classList.add('hidden');
}

function bindToolButtons() {
  toolButtons.forEach((button) => {
    button.addEventListener('pointerdown', (event) => {
      setSelectedTool(button.dataset.tool);
      toolButtons.forEach((btn) => btn.classList.toggle('active', btn === button));
      toolbarDrag = { pointerId: event.pointerId, tool: button.dataset.tool, button };
      button.classList.add('dragging');
      dragGhost.textContent = `Sleep ${button.dataset.tool} naar het canvas`;
      dragGhost.classList.remove('hidden');
      updateGhost(event.clientX, event.clientY);
    });
  });

  window.addEventListener('pointermove', (event) => {
    if (toolbarDrag && toolbarDrag.pointerId === event.pointerId) updateGhost(event.clientX, event.clientY);
  });

  window.addEventListener('pointerup', (event) => {
    if (!toolbarDrag || toolbarDrag.pointerId !== event.pointerId) return;
    if (pointInsideCanvas(event.clientX, event.clientY)) {
      placeElement(event.clientX, event.clientY, toolbarDrag.tool);
    }
    resetToolbarDrag();
  });
}

function bindDimensionControls() {
  const apply = () => {
    const width = Math.max(1, Number(widthInput.value) || 1);
    const height = Math.max(1, Number(heightInput.value) || 1);
    const shape = updateSelectedShapeDimensions(width, height);
    if (!shape) return;
    renderScene();
    syncTopbarWithSelection();
  };
  applyDimensionsBtn.addEventListener('click', apply);
  widthInput.addEventListener('change', apply);
  heightInput.addEventListener('change', apply);
}

function bindActionButtons() {
  actionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.id === 'deleteBtn') {
        const ok = deleteSelectedShape();
        renderScene();
        syncTopbarWithSelection();
        showToast(ok ? 'Element verwijderd' : 'Niets geselecteerd');
        return;
      }
      if (button.id === 'duplicateBtn') {
        const ok = duplicateSelectedShape();
        renderScene();
        syncTopbarWithSelection();
        showToast(ok ? 'Element gedupliceerd' : 'Niets geselecteerd');
        return;
      }
      showToast(`${button.textContent} is nog een placeholder`);
    });
  });
}

function pointInsideCanvas(clientX, clientY) {
  const rect = canvasStage.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
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

function clientDeltaToWorld(dx, dy) {
  const rect = planCanvas.getBoundingClientRect();
  return {
    x: (dx / rect.width) * appState.viewport.baseWidth / appState.viewport.zoom,
    y: (dy / rect.height) * appState.viewport.baseHeight / appState.viewport.zoom,
  };
}

function snapValue(value, candidates, threshold) {
  let best = value;
  let bestDistance = threshold + 1;
  candidates.forEach((candidate) => {
    const distance = Math.abs(candidate - value);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  });
  return bestDistance <= threshold ? best : value;
}

function collectSnapCandidates(excludeShapeId = null) {
  const candidatesX = [0, 600, 1200];
  const candidatesY = [0, 450, 900];

  appState.project.shapes.forEach((shape) => {
    if (shape.id === excludeShapeId) return;
    if (shape.type === 'face') {
      const metrics = getFaceMetrics(shape);
      const center = { x: metrics.centerX, y: metrics.centerY };
      [
        { x: shape.x, y: shape.y },
        { x: shape.x + metrics.widthPx, y: shape.y },
        { x: shape.x + metrics.widthPx, y: shape.y + metrics.heightPx },
        { x: shape.x, y: shape.y + metrics.heightPx },
      ].map((point) => rotatePoint(point, center, metrics.rotation)).forEach((point) => {
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
  const { snapStepPx, snapThresholdPx } = appState.project.settings;
  const { candidatesX, candidatesY } = collectSnapCandidates(excludeShapeId);
  candidatesX.push(Math.round(point.x / snapStepPx) * snapStepPx);
  candidatesY.push(Math.round(point.y / snapStepPx) * snapStepPx);

  const x = snapValue(point.x, candidatesX, snapThresholdPx);
  const y = snapValue(point.y, candidatesY, snapThresholdPx);
  const lines = [];
  if (x !== point.x) lines.push({ x1: x, y1: 0, x2: x, y2: 900 });
  if (y !== point.y) lines.push({ x1: 0, y1: y, x2: 1200, y2: y });
  return { x, y, lines };
}

function getSnappedMoveDelta(shape, rawDeltaX, rawDeltaY) {
  if (shape.type === 'line') {
    const start = getSnappedPoint({ x: shape.x1 + rawDeltaX, y: shape.y1 + rawDeltaY }, shape.id);
    return { deltaX: start.x - shape.x1, deltaY: start.y - shape.y1, lines: start.lines };
  }
  const start = getSnappedPoint({ x: shape.x + rawDeltaX, y: shape.y + rawDeltaY }, shape.id);
  return { deltaX: start.x - shape.x, deltaY: start.y - shape.y, lines: start.lines };
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function snapAngle(degrees) {
  const step = appState.project.settings.rotateSnapDeg;
  const threshold = appState.project.settings.rotateSnapThresholdDeg;
  const normalized = normalizeDegrees(degrees);
  const snapped = Math.round(normalized / step) * step;
  const diff = Math.min(Math.abs(snapped - normalized), 360 - Math.abs(snapped - normalized));
  return diff <= threshold ? normalizeDegrees(snapped) : normalized;
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

  const currentAngle = shape.type === 'line'
    ? Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1) * 180 / Math.PI
    : shape.rotation ?? 0;

  dragState = {
    mode: 'rotate',
    shapeId: shape.id,
    center,
    startPointerAngle: Math.atan2(point.y - center.y, point.x - center.x),
    baseRotation: currentAngle,
  };
  setActiveHandle('rotate');
}

function startFaceResize(shape, handleName) {
  dragState = {
    mode: 'resize-face',
    shapeId: shape.id,
    handleName,
    original: structuredClone(shape),
  };
  setActiveHandle(handleName);
}

function startLineEndpointDrag(shape, endpoint) {
  dragState = { mode: 'endpoint', shapeId: shape.id, endpoint };
  setActiveHandle(endpoint);
}

function placeElement(clientX, clientY, tool) {
  const point = getSvgPoint(clientX, clientY);
  const snapped = getSnappedPoint(point);
  setSnapLines(snapped.lines);
  createShapeAt(tool, snapped.x, snapped.y);
  renderScene();
  syncTopbarWithSelection();
  showToast(`Element geplaatst: ${tool}`);
  window.setTimeout(() => {
    setSnapLines([]);
    renderScene();
  }, 200);
}

function trySelectTarget(target) {
  const loopId = target?.dataset?.loopId;
  if (loopId) {
    setSelection({ type: 'loop', id: loopId });
    syncTopbarWithSelection();
    renderScene();
    return { kind: 'loop' };
  }
  const shapeId = target?.dataset?.shapeId;
  if (!shapeId) return null;
  const shape = getShapeById(shapeId);
  if (!shape) return null;
  setSelection({ type: shape.type, id: shape.id });
  syncTopbarWithSelection();
  renderScene();
  return { kind: 'shape', shape };
}

function beginCanvasPan(event) {
  dragState = {
    mode: 'pan',
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    moved: false,
  };
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

    const selected = trySelectTarget(event.target);
    if (selected?.kind === 'shape') {
      startMove(selected.shape, point);
      return;
    }

    beginCanvasPan(event);
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
    const point = getSvgPoint(event.clientX, event.clientY);

    if (dragState.mode === 'pan') {
      const delta = clientDeltaToWorld(event.clientX - dragState.lastClientX, event.clientY - dragState.lastClientY);
      panViewport(delta.x, delta.y);
      dragState.lastClientX = event.clientX;
      dragState.lastClientY = event.clientY;
      dragState.moved = dragState.moved || Math.abs(delta.x) > 0.1 || Math.abs(delta.y) > 0.1;
      renderScene();
      return;
    }

    const shape = getShapeById(dragState.shapeId);
    if (!shape) return;

    if (dragState.mode === 'move') {
      Object.assign(shape, structuredClone(dragState.original));
      const rawDeltaX = point.x - dragState.startPoint.x;
      const rawDeltaY = point.y - dragState.startPoint.y;
      const snapped = getSnappedMoveDelta(shape, rawDeltaX, rawDeltaY);
      moveShapeBy(shape, snapped.deltaX, snapped.deltaY);
      setSnapLines(snapped.lines);
      renderScene();
      syncTopbarWithSelection();
      return;
    }

    if (dragState.mode === 'endpoint') {
      const snapped = getSnappedPoint(point, shape.id);
      setLineEndpoint(shape, dragState.endpoint, snapped.x, snapped.y);
      setSnapLines(snapped.lines);
      renderScene();
      syncTopbarWithSelection();
      return;
    }

    if (dragState.mode === 'rotate') {
      const currentPointerAngle = Math.atan2(point.y - dragState.center.y, point.x - dragState.center.x);
      const deltaDeg = (currentPointerAngle - dragState.startPointerAngle) * 180 / Math.PI;
      const nextDeg = snapAngle(dragState.baseRotation + deltaDeg);
      if (shape.type === 'face') rotateFaceTo(shape, nextDeg);
      else rotateLineTo(shape, nextDeg);
      renderScene();
      syncTopbarWithSelection();
      return;
    }

    if (dragState.mode === 'resize-face') {
      const original = dragState.original;
      const metrics = getFaceMetrics(original);
      const center = { x: metrics.centerX, y: metrics.centerY };
      const local = rotatePoint(point, center, -(original.rotation ?? 0));
      const widthPx = Math.max(20, Math.abs(local.x - center.x) * 2);
      const heightPx = Math.max(20, Math.abs(local.y - center.y) * 2);
      updateFaceSizePx(shape, widthPx, heightPx);
      shape.x = center.x - (shape.widthCm * appState.project.settings.scalePxPerCm) / 2;
      shape.y = center.y - (shape.heightCm * appState.project.settings.scalePxPerCm) / 2;
      renderScene();
      syncTopbarWithSelection();
    }
  });

  function finishPointer(event) {
    pointerState.delete(event.pointerId);
    if (pointerState.size < 2) pinchStart = null;

    if (dragState?.mode === 'pan' && !dragState.moved) {
      clearSelection();
      syncTopbarWithSelection();
      renderScene();
    }

    dragState = null;
    setActiveHandle(null);
    setSnapLines([]);
    renderScene();
  }

  canvasStage.addEventListener('pointerup', finishPointer);
  canvasStage.addEventListener('pointercancel', finishPointer);

  canvasStage.addEventListener('wheel', (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 0.9;
    setViewportZoom(appState.viewport.zoom * factor, getSvgPoint(event.clientX, event.clientY));
    renderScene();
  }, { passive: false });
}

function seedDemo() {
  createShapeAt('square', 220, 180);
  clearSelection();
}

bindToolButtons();
bindDimensionControls();
bindActionButtons();
bindCanvasPointerEvents();
seedDemo();
renderScene();
