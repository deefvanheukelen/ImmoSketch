import { renderScene, getFaceMetrics } from './renderer.js';
import {
  appState,
  createShapeAt,
  deleteSelectedShape,
  duplicateSelectedShape,
  getSelectedShape,
  clearSelection,
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
const footerShell = document.getElementById('footerShell');
const toolButtons = [...document.querySelectorAll('.tool-btn')];
const actionButtons = [...document.querySelectorAll('.action-btn')];
const dimensionInputs = [widthInput, heightInput];
const dragIndicator = document.getElementById('dragIndicator');

const pointerState = new Map();
let pinchStart = null;
let dragState = null;
let toolbarDrag = null;
const TAP_PAN_THRESHOLD = 8;
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

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function getLineAngle(shape) {
  return normalizeDegrees((Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1) * 180) / Math.PI);
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

function getSvgPoint(clientX, clientY) {
  const rect = planCanvas.getBoundingClientRect();
  const baseX = ((clientX - rect.left) / rect.width) * appState.viewport.baseWidth;
  const baseY = ((clientY - rect.top) / rect.height) * appState.viewport.baseHeight;
  return {
    x: (baseX - appState.viewport.panX) / appState.viewport.zoom,
    y: (baseY - appState.viewport.panY) / appState.viewport.zoom,
  };
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

function getShapeSnapData(shape) {
  if (shape.type === 'line') {
    const centerX = (shape.x1 + shape.x2) / 2;
    const centerY = (shape.y1 + shape.y2) / 2;
    return {
      points: [
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y2 },
        { x: centerX, y: centerY },
      ],
      xValues: [shape.x1, shape.x2, centerX],
      yValues: [shape.y1, shape.y2, centerY],
      bounds: {
        left: Math.min(shape.x1, shape.x2),
        right: Math.max(shape.x1, shape.x2),
        top: Math.min(shape.y1, shape.y2),
        bottom: Math.max(shape.y1, shape.y2),
      },
    };
  }

  const corners = getFaceCorners(shape);
  const points = [corners.nw, corners.ne, corners.se, corners.sw, corners.center];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    points,
    xValues: [Math.min(...xs), corners.center.x, Math.max(...xs)],
    yValues: [Math.min(...ys), corners.center.y, Math.max(...ys)],
    bounds: {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    },
  };
}

function rangesOverlap(startA, endA, startB, endB, tolerance = 6) {
  return Math.min(endA, endB) >= Math.max(startA, startB) - tolerance;
}

function collectSnapTargets(excludeShapeId = null) {
  return appState.project.shapes
    .filter((shape) => shape.id !== excludeShapeId)
    .map((shape) => ({ shape, ...getShapeSnapData(shape) }));
}

function snapCoordinate(value, candidates, threshold) {
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

function getSnappedPoint(point, excludeShapeId = null) {
  const threshold = appState.project.settings.snapThresholdPx;
  const targets = collectSnapTargets(excludeShapeId);
  const xCandidates = targets.flatMap((target) => target.xValues);
  const yCandidates = targets.flatMap((target) => target.yValues);

  const snappedX = snapCoordinate(point.x, xCandidates, threshold);
  const snappedY = snapCoordinate(point.y, yCandidates, threshold);
  const lines = [];
  if (snappedX !== point.x) lines.push({ x1: snappedX, y1: -4000, x2: snappedX, y2: 4000 });
  if (snappedY !== point.y) lines.push({ x1: -4000, y1: snappedY, x2: 4000, y2: snappedY });

  return { x: snappedX, y: snappedY, lines };
}

function getBestDelta(sourceValues, candidateValues, threshold) {
  let bestDelta = 0;
  let bestDistance = threshold + 1;

  sourceValues.forEach((source) => {
    candidateValues.forEach((candidate) => {
      const delta = candidate - source;
      const distance = Math.abs(delta);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestDelta = delta;
      }
    });
  });

  return bestDistance <= threshold ? bestDelta : 0;
}

function addGuideLine(lines, orientation, value) {
  if (orientation === 'x') {
    lines.push({ x1: value, y1: -4000, x2: value, y2: 4000 });
    return;
  }
  lines.push({ x1: -4000, y1: value, x2: 4000, y2: value });
}

function getSnappedMoveDelta(shape, rawDeltaX, rawDeltaY) {
  const threshold = appState.project.settings.snapThresholdPx;
  const moving = getShapeSnapData(shape);
  const targets = collectSnapTargets(shape.id);

  const movedXValues = moving.xValues.map((value) => value + rawDeltaX);
  const movedYValues = moving.yValues.map((value) => value + rawDeltaY);
  let deltaX = rawDeltaX + getBestDelta(movedXValues, targets.flatMap((target) => target.xValues), threshold);
  let deltaY = rawDeltaY + getBestDelta(movedYValues, targets.flatMap((target) => target.yValues), threshold);

  const movedBounds = {
    left: moving.bounds.left + deltaX,
    right: moving.bounds.right + deltaX,
    top: moving.bounds.top + deltaY,
    bottom: moving.bounds.bottom + deltaY,
  };

  let bestXMagnet = null;
  let bestYMagnet = null;

  targets.forEach((target) => {
    if (rangesOverlap(movedBounds.top, movedBounds.bottom, target.bounds.top, target.bounds.bottom, threshold)) {
      [
        target.bounds.left - movedBounds.right,
        target.bounds.right - movedBounds.left,
      ].forEach((candidateDelta) => {
        if (Math.abs(candidateDelta) <= threshold && (bestXMagnet === null || Math.abs(candidateDelta) < Math.abs(bestXMagnet))) {
          bestXMagnet = candidateDelta;
        }
      });
    }

    if (rangesOverlap(movedBounds.left, movedBounds.right, target.bounds.left, target.bounds.right, threshold)) {
      [
        target.bounds.top - movedBounds.bottom,
        target.bounds.bottom - movedBounds.top,
      ].forEach((candidateDelta) => {
        if (Math.abs(candidateDelta) <= threshold && (bestYMagnet === null || Math.abs(candidateDelta) < Math.abs(bestYMagnet))) {
          bestYMagnet = candidateDelta;
        }
      });
    }
  });

  if (bestXMagnet !== null) deltaX += bestXMagnet;
  if (bestYMagnet !== null) deltaY += bestYMagnet;

  const finalBounds = {
    left: moving.bounds.left + deltaX,
    right: moving.bounds.right + deltaX,
    top: moving.bounds.top + deltaY,
    bottom: moving.bounds.bottom + deltaY,
  };

  const lines = [];
  targets.forEach((target) => {
    if (Math.abs(finalBounds.left - target.bounds.right) <= 0.01) addGuideLine(lines, 'x', target.bounds.right);
    if (Math.abs(finalBounds.right - target.bounds.left) <= 0.01) addGuideLine(lines, 'x', target.bounds.left);
    if (Math.abs(finalBounds.top - target.bounds.bottom) <= 0.01) addGuideLine(lines, 'y', target.bounds.bottom);
    if (Math.abs(finalBounds.bottom - target.bounds.top) <= 0.01) addGuideLine(lines, 'y', target.bounds.top);
  });

  moving.xValues.map((value) => value + deltaX).forEach((value) => {
    if (targets.some((target) => target.xValues.some((candidate) => Math.abs(candidate - value) <= 0.01))) {
      addGuideLine(lines, 'x', value);
    }
  });
  moving.yValues.map((value) => value + deltaY).forEach((value) => {
    if (targets.some((target) => target.yValues.some((candidate) => Math.abs(candidate - value) <= 0.01))) {
      addGuideLine(lines, 'y', value);
    }
  });

  return { deltaX, deltaY, lines };
}

function updateSelectionUI() {
  const shape = getSelectedShape();
  topbar.classList.toggle('hidden', !shape);
  footerShell?.classList.toggle('has-selection', Boolean(shape));

  if (!shape) return;

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

  updateSelectionUI();
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
        updateSelectionUI();
        renderScene();
        showToast(removed ? 'Element verwijderd' : 'Niets geselecteerd');
        return;
      }

      if (button.id === 'duplicateBtn') {
        const clone = duplicateSelectedShape();
        updateSelectionUI();
        renderScene();
        showToast(clone ? 'Element gedupliceerd' : 'Niets geselecteerd');
        return;
      }

      showToast(`${button.textContent} is nog een placeholder`);
    });
  });
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
    mode: 'pan-ready',
    startClientX: clientX,
    startClientY: clientY,
    lastClientX: clientX,
    lastClientY: clientY,
    moved: false,
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
    startPoint: point,
    original: structuredClone(shape),
    startAngle: Math.atan2(point.y - center.y, point.x - center.x),
    baseRotation: shape.type === 'line' ? getLineAngle(shape) : normalizeDegrees(shape.rotation ?? 0),
    rotateHandleClick: true,
  };
  setActiveHandle('rotate');
}

function startFaceResize(shape, corner, point) {
  const corners = getFaceCorners(shape);
  const grabbedCorner = corners[corner];
  dragState = {
    mode: 'resize-face',
    shapeId: shape.id,
    corner,
    original: structuredClone(shape),
    oppositeCorner: corners[OPPOSITE_CORNERS[corner]],
    pointerOffset: {
      x: point.x - grabbedCorner.x,
      y: point.y - grabbedCorner.y,
    },
  };
  setActiveHandle(`resize-${corner}`);
}

function startLineEndpointResize(shape, endpoint, point) {
  const endpointPoint = endpoint === 'start'
    ? { x: shape.x1, y: shape.y1 }
    : { x: shape.x2, y: shape.y2 };

  dragState = {
    mode: 'line-endpoint',
    shapeId: shape.id,
    endpoint,
    original: structuredClone(shape),
    pointerOffset: {
      x: point.x - endpointPoint.x,
      y: point.y - endpointPoint.y,
    },
    fixedPoint: endpoint === 'start'
      ? { x: shape.x2, y: shape.y2 }
      : { x: shape.x1, y: shape.y1 },
    originalAngleRad: Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1),
  };
  setActiveHandle(`line-${endpoint}`);
}

function applyAxisLock(rawPoint, fixedPoint, originalAngleRad) {
  const axisX = Math.cos(originalAngleRad);
  const axisY = Math.sin(originalAngleRad);
  const dx = rawPoint.x - fixedPoint.x;
  const dy = rawPoint.y - fixedPoint.y;
  const along = dx * axisX + dy * axisY;
  const perp = -dx * axisY + dy * axisX;
  const lockThreshold = 18;

  if (Math.abs(perp) <= lockThreshold) {
    return {
      x: fixedPoint.x + axisX * along,
      y: fixedPoint.y + axisY * along,
    };
  }

  const angleDeg = Math.abs((originalAngleRad * 180) / Math.PI) % 180;
  if ((angleDeg < 12 || angleDeg > 168) && Math.abs(dy) <= lockThreshold * 1.2) {
    return { x: rawPoint.x, y: fixedPoint.y };
  }
  if (Math.abs(angleDeg - 90) < 12 && Math.abs(dx) <= lockThreshold * 1.2) {
    return { x: fixedPoint.x, y: rawPoint.y };
  }

  return rawPoint;
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
  updateSelectionUI();
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
  updateSelectionUI();
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
        startFaceResize(shape, event.target.dataset.corner, point);
        return;
      }
    }

    if (event.target?.dataset?.handle === 'line-endpoint') {
      const shape = getShapeById(event.target.dataset.shapeId);
      if (shape) {
        startLineEndpointResize(shape, event.target.dataset.endpoint, point);
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

    if (dragState.mode === 'pan-ready' || dragState.mode === 'pan') {
      const distance = Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY);
      if (dragState.mode === 'pan-ready' && distance <= TAP_PAN_THRESHOLD) return;
      dragState.mode = 'pan';
      dragState.moved = true;
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
      updateSelectionUI();
      renderScene();
      return;
    }

    if (dragState.mode === 'rotate') {
      const currentAngle = Math.atan2(point.y - dragState.center.y, point.x - dragState.center.x);
      const dragDistance = Math.hypot(point.x - dragState.startPoint.x, point.y - dragState.startPoint.y);
      if (dragDistance > 6) dragState.rotateHandleClick = false;
      const deltaDeg = ((currentAngle - dragState.startAngle) * 180) / Math.PI;
      const targetDeg = snapAngle(dragState.baseRotation + deltaDeg);
      Object.assign(shape, structuredClone(dragState.original));
      if (shape.type === 'line') rotateLineTo(shape, targetDeg);
      else rotateFaceTo(shape, targetDeg);
      setSnapLines([]);
      updateSelectionUI();
      renderScene();
      return;
    }

    if (dragState.mode === 'line-endpoint') {
      Object.assign(shape, structuredClone(dragState.original));
      let rawPoint = {
        x: point.x - dragState.pointerOffset.x,
        y: point.y - dragState.pointerOffset.y,
      };
      rawPoint = applyAxisLock(rawPoint, dragState.fixedPoint, dragState.originalAngleRad);
      const snapped = getSnappedPoint(rawPoint, shape.id);
      updateLineEndpoint(shape, dragState.endpoint === 'start' ? 'start' : 'end', snapped.x, snapped.y);
      setSnapLines(snapped.lines);
      updateSelectionUI();
      renderScene();
      return;
    }

    if (dragState.mode === 'resize-face') {
      Object.assign(shape, structuredClone(dragState.original));
      const rawPoint = {
        x: point.x - dragState.pointerOffset.x,
        y: point.y - dragState.pointerOffset.y,
      };
      const snapped = getSnappedPoint(rawPoint, shape.id);
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
      updateSelectionUI();
      renderScene();
    }
  });

  function endPointer(event) {
    const finishedDrag = dragState ? { ...dragState } : null;
    pointerState.delete(event.pointerId);
    if (pointerState.size < 2) pinchStart = null;

    if (pointerState.size === 0) {
      if (finishedDrag?.mode === 'pan-ready' && !finishedDrag.moved) {
        clearSelection();
        updateSelectionUI();
      }

      if (finishedDrag?.mode === 'rotate' && finishedDrag.rotateHandleClick) {
        const shape = getShapeById(finishedDrag.shapeId);
        if (shape) {
          if (shape.type === 'line') rotateLineTo(shape, finishedDrag.baseRotation + 90);
          else rotateFaceTo(shape, finishedDrag.baseRotation + 90);
          updateSelectionUI();
        }
      }

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
updateSelectionUI();
renderScene();
