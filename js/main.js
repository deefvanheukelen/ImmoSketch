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
const footerShell = document.querySelector('.footer-shell');
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

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
  const hasSelection = Boolean(shape);

  topbar.classList.toggle('hidden', !hasSelection);
  if (footerShell) {
    footerShell.classList.toggle('has-selection', hasSelection);
  }

  if (!shape) {
    return;
  }

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

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function projectPointOnSegment(point, line) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) {
    return { x: line.x1, y: line.y1, t: 0 };
  }
  const t = ((point.x - line.x1) * dx + (point.y - line.y1) * dy) / lengthSq;
  const clampedT = Math.max(0, Math.min(1, t));
  return {
    x: line.x1 + dx * clampedT,
    y: line.y1 + dy * clampedT,
    t: clampedT,
  };
}

function pointToGuideLine(point, snappedPoint) {
  if (distanceBetween(point, snappedPoint) < 0.001) return [];
  return [{ x1: point.x, y1: point.y, x2: snappedPoint.x, y2: snappedPoint.y }];
}

function getShapeSnapGeometry(shape) {
  if (shape.type === 'face') {
    const corners = getFaceCorners(shape);
    const topMid = midpoint(corners.nw, corners.ne);
    const rightMid = midpoint(corners.ne, corners.se);
    const bottomMid = midpoint(corners.sw, corners.se);
    const leftMid = midpoint(corners.nw, corners.sw);
    return {
      points: [corners.nw, corners.ne, corners.se, corners.sw, topMid, rightMid, bottomMid, leftMid, corners.center],
      lines: [
        { x1: corners.nw.x, y1: corners.nw.y, x2: corners.ne.x, y2: corners.ne.y },
        { x1: corners.ne.x, y1: corners.ne.y, x2: corners.se.x, y2: corners.se.y },
        { x1: corners.se.x, y1: corners.se.y, x2: corners.sw.x, y2: corners.sw.y },
        { x1: corners.sw.x, y1: corners.sw.y, x2: corners.nw.x, y2: corners.nw.y },
      ],
    };
  }

  const start = { x: shape.x1, y: shape.y1 };
  const end = { x: shape.x2, y: shape.y2 };
  const center = midpoint(start, end);
  return {
    points: [start, end, center],
    lines: [{ x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2 }],
  };
}

function collectSnapGeometry(excludeShapeId = null) {
  const points = [];
  const lines = [];

  appState.project.shapes.forEach((shape) => {
    if (shape.id === excludeShapeId) return;
    const geometry = getShapeSnapGeometry(shape);
    points.push(...geometry.points);
    lines.push(...geometry.lines);
  });

  return { points, lines };
}

function getBestSnapForPoint(point, excludeShapeId = null, threshold = appState.project.settings.snapThresholdPx) {
  const { points, lines } = collectSnapGeometry(excludeShapeId);
  let best = {
    snappedPoint: point,
    distance: threshold + 1,
    lines: [],
  };

  points.forEach((candidate) => {
    const distance = distanceBetween(point, candidate);
    if (distance < best.distance) {
      best = {
        snappedPoint: { x: candidate.x, y: candidate.y },
        distance,
        lines: pointToGuideLine(point, candidate),
      };
    }
  });

  lines.forEach((candidate) => {
    const projected = projectPointOnSegment(point, candidate);
    const distance = distanceBetween(point, projected);
    if (distance < best.distance) {
      best = {
        snappedPoint: { x: projected.x, y: projected.y },
        distance,
        lines: [candidate, ...pointToGuideLine(point, projected)],
      };
    }
  });

  if (best.distance <= threshold) {
    return {
      x: best.snappedPoint.x,
      y: best.snappedPoint.y,
      lines: best.lines,
    };
  }

  return { x: point.x, y: point.y, lines: [] };
}

function getSnappedPoint(point, excludeShapeId = null) {
  return getBestSnapForPoint(point, excludeShapeId);
}

function getMovedAnchorPoints(shape, deltaX, deltaY) {
  const geometry = getShapeSnapGeometry(shape);
  return geometry.points.map((point) => ({ x: point.x + deltaX, y: point.y + deltaY }));
}

function getProjectedRangeOnAxis(line, axis) {
  const start = line.x1 * axis.x + line.y1 * axis.y;
  const end = line.x2 * axis.x + line.y2 * axis.y;
  return { min: Math.min(start, end), max: Math.max(start, end) };
}

function getParallelLineSnap(lineA, lineB, threshold) {
  const dxA = lineA.x2 - lineA.x1;
  const dyA = lineA.y2 - lineA.y1;
  const dxB = lineB.x2 - lineB.x1;
  const dyB = lineB.y2 - lineB.y1;
  const lengthA = Math.hypot(dxA, dyA);
  const lengthB = Math.hypot(dxB, dyB);

  if (!lengthA || !lengthB) return null;

  const axisA = { x: dxA / lengthA, y: dyA / lengthA };
  const axisB = { x: dxB / lengthB, y: dyB / lengthB };
  const cross = Math.abs(axisA.x * axisB.y - axisA.y * axisB.x);
  if (cross > 0.18) return null;

  const normal = { x: -axisB.y, y: axisB.x };
  const midpointA = { x: (lineA.x1 + lineA.x2) / 2, y: (lineA.y1 + lineA.y2) / 2 };
  const midpointB = { x: (lineB.x1 + lineB.x2) / 2, y: (lineB.y1 + lineB.y2) / 2 };
  const perpendicularOffset = ((midpointA.x - midpointB.x) * normal.x) + ((midpointA.y - midpointB.y) * normal.y);
  const distance = Math.abs(perpendicularOffset);
  if (distance > threshold) return null;

  const rangeA = getProjectedRangeOnAxis(lineA, axisB);
  const rangeB = getProjectedRangeOnAxis(lineB, axisB);
  const overlap = Math.min(rangeA.max, rangeB.max) - Math.max(rangeA.min, rangeB.min);
  if (overlap < -threshold) return null;

  const delta = {
    x: -normal.x * perpendicularOffset,
    y: -normal.y * perpendicularOffset,
  };

  return {
    deltaX: delta.x,
    deltaY: delta.y,
    distance,
    lines: [lineB, { x1: midpointA.x, y1: midpointA.y, x2: midpointA.x + delta.x, y2: midpointA.y + delta.y }],
  };
}

function getMagneticMoveSnap(shape, rawDeltaX, rawDeltaY) {
  const threshold = appState.project.settings.moveSnapThresholdPx ?? appState.project.settings.snapThresholdPx;
  const anchors = getMovedAnchorPoints(shape, rawDeltaX, rawDeltaY);
  const movedGeometry = getShapeSnapGeometry(shape);
  const movedLines = movedGeometry.lines.map((line) => ({
    x1: line.x1 + rawDeltaX,
    y1: line.y1 + rawDeltaY,
    x2: line.x2 + rawDeltaX,
    y2: line.y2 + rawDeltaY,
  }));
  const staticGeometry = collectSnapGeometry(shape.id);

  let best = {
    deltaX: rawDeltaX,
    deltaY: rawDeltaY,
    distance: threshold + 1,
    lines: [],
  };

  anchors.forEach((anchor) => {
    const snapped = getBestSnapForPoint(anchor, shape.id, threshold);
    const distance = distanceBetween(anchor, { x: snapped.x, y: snapped.y });
    if (distance < best.distance) {
      best = {
        deltaX: rawDeltaX + (snapped.x - anchor.x),
        deltaY: rawDeltaY + (snapped.y - anchor.y),
        distance,
        lines: snapped.lines,
      };
    }
  });

  movedLines.forEach((movedLine) => {
    staticGeometry.lines.forEach((candidateLine) => {
      const lineSnap = getParallelLineSnap(movedLine, candidateLine, threshold);
      if (lineSnap && lineSnap.distance < best.distance) {
        best = {
          deltaX: rawDeltaX + lineSnap.deltaX,
          deltaY: rawDeltaY + lineSnap.deltaY,
          distance: lineSnap.distance,
          lines: lineSnap.lines,
        };
      }
    });
  });

  if (best.distance <= threshold) {
    return { deltaX: best.deltaX, deltaY: best.deltaY, lines: best.lines };
  }

  return { deltaX: rawDeltaX, deltaY: rawDeltaY, lines: [] };
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
  const fixedPoint = endpoint === 'start'
    ? { x: shape.x2, y: shape.y2 }
    : { x: shape.x1, y: shape.y1 };
  const axis = (() => {
    const dx = shape.x2 - shape.x1;
    const dy = shape.y2 - shape.y1;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  })();

  dragState = {
    mode: 'line-endpoint',
    shapeId: shape.id,
    endpoint,
    original: structuredClone(shape),
    fixedPoint,
    axis,
  };
  setActiveHandle(`line-${endpoint}`);
}

function getAxisLockedPoint(rawPoint, fixedPoint, axis) {
  const dx = rawPoint.x - fixedPoint.x;
  const dy = rawPoint.y - fixedPoint.y;
  const parallel = dx * axis.x + dy * axis.y;
  const perpendicular = dx * (-axis.y) + dy * axis.x;
  const perpendicularAbs = Math.abs(perpendicular);
  const parallelAbs = Math.abs(parallel);
  const hardThreshold = appState.project.settings.lineAxisLockThresholdPx ?? 18;
  const releaseFactor = 0.42;

  if (perpendicularAbs <= hardThreshold || perpendicularAbs <= parallelAbs * releaseFactor) {
    return {
      x: fixedPoint.x + axis.x * parallel,
      y: fixedPoint.y + axis.y * parallel,
      locked: true,
    };
  }

  return {
    x: rawPoint.x,
    y: rawPoint.y,
    locked: false,
  };
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

    if (dragState.mode === 'pan-ready' || dragState.mode === 'pan') {
      const distance = Math.hypot(event.clientX - dragState.startClientX, event.clientY - dragState.startClientY);
      if (dragState.mode === 'pan-ready' && distance <= TAP_PAN_THRESHOLD) {
        return;
      }
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
      const snapped = getMagneticMoveSnap(shape, rawDeltaX, rawDeltaY);
      moveShapeBy(shape, snapped.deltaX, snapped.deltaY);
      setSnapLines(snapped.lines);
      syncTopbarWithSelection();
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
      syncTopbarWithSelection();
      renderScene();
      return;
    }

    if (dragState.mode === 'line-endpoint') {
      Object.assign(shape, structuredClone(dragState.original));
      const axisLocked = getAxisLockedPoint(point, dragState.fixedPoint, dragState.axis);
      const snapped = getSnappedPoint({ x: axisLocked.x, y: axisLocked.y }, shape.id);
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
    const finishedDrag = dragState ? { ...dragState } : null;
    pointerState.delete(event.pointerId);
    if (pointerState.size < 2) pinchStart = null;

    if (pointerState.size === 0) {
      if (finishedDrag?.mode === 'pan-ready' && !finishedDrag.moved) {
        clearSelection();
        syncTopbarWithSelection();
      }

      if (finishedDrag?.mode === 'rotate' && finishedDrag.rotateHandleClick) {
        const shape = getShapeById(finishedDrag.shapeId);
        if (shape) {
          Object.assign(shape, structuredClone(finishedDrag.original));
          if (shape.type === 'line') {
            rotateLineTo(shape, finishedDrag.baseRotation + 90);
          } else {
            rotateFaceTo(shape, finishedDrag.baseRotation + 90);
          }
          syncTopbarWithSelection();
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
syncTopbarWithSelection();
renderScene();
