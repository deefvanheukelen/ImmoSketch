import {
  appState,
  getSelectedShape,
  getRectCenter,
  getRectCorners,
  getRectEdges,
  getLineLengthPx,
  pxToCm,
  rebuildDerivedFaces,
  SVG_WIDTH,
  SVG_HEIGHT,
  isRectQuarterTurn,
  isDoorShape,
  isWindowShape,
  normalizeAngle,
  getShapeHandleSessionBaseAngle,
} from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

export function renderScene() {
  rebuildDerivedFaces();
  const viewport = document.getElementById('viewport');
  const shapeLayer = document.getElementById('shapeLayer');
  const selectionLayer = document.getElementById('selectionLayer');
  const guideLayer = document.getElementById('guideLayer');
  const uiLayer = document.getElementById('uiLayer');
  const { panX, panY, zoom } = appState.view;
  viewport.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`);
  shapeLayer.replaceChildren();
  selectionLayer.replaceChildren();
  guideLayer.replaceChildren();
  uiLayer.replaceChildren();
  drawGuides(guideLayer);
  drawDerivedFaces(shapeLayer);
  drawShapes(shapeLayer);
  drawSelection(selectionLayer);
  drawDimensions(uiLayer);
}

function drawGuides(layer) {
}

function drawDerivedFaces(layer) {
  appState.project.derivedFaces.forEach((face) => {
    const points = face.points.map((p) => `${p.x},${p.y}`).join(' ');
    layer.appendChild(createSvgEl('polygon', { points, class: 'detected-face' }));
  });
}

function getDoorGeometry(shape) {
  const corners = getRectCorners(shape);
  const start = corners[3];
  const end = corners[1];
  const radius = Math.hypot(end.x - start.x, end.y - start.y);
  return {
    corners,
    rightEdge: [corners[1], corners[2]],
    bottomEdge: [corners[2], corners[3]],
    arcPath: `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`,
  };
}

function appendDoorShape(layer, shape) {
  const { corners, rightEdge, bottomEdge, arcPath } = getDoorGeometry(shape);
  layer.appendChild(createSvgEl('polygon', {
    points: corners.map((p) => `${p.x},${p.y}`).join(' '),
    class: 'door-hit-area',
    'data-shape-id': shape.id,
  }));
  layer.appendChild(createSvgEl('line', {
    x1: bottomEdge[0].x, y1: bottomEdge[0].y, x2: bottomEdge[1].x, y2: bottomEdge[1].y, class: 'shape-line', 'data-shape-id': shape.id,
  }));
  layer.appendChild(createSvgEl('line', {
    x1: rightEdge[0].x, y1: rightEdge[0].y, x2: rightEdge[1].x, y2: rightEdge[1].y, class: 'shape-line', 'data-shape-id': shape.id,
  }));
  layer.appendChild(createSvgEl('path', { d: arcPath, class: 'shape-line', 'data-shape-id': shape.id, fill: 'none' }));
}


function getLineMidpoint(shape) {
  return { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 };
}

function getWindowGeometry(shape) {
  const dx = shape.x2 - shape.x1;
  const dy = shape.y2 - shape.y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const halfThickness = 5;
  return {
    a1: { x: shape.x1 + nx * halfThickness, y: shape.y1 + ny * halfThickness },
    a2: { x: shape.x2 + nx * halfThickness, y: shape.y2 + ny * halfThickness },
    b1: { x: shape.x1 - nx * halfThickness, y: shape.y1 - ny * halfThickness },
    b2: { x: shape.x2 - nx * halfThickness, y: shape.y2 - ny * halfThickness },
  };
}

function appendWindowShape(layer, shape) {
  const geometry = getWindowGeometry(shape);
  layer.appendChild(createSvgEl('polygon', {
    points: [geometry.a1, geometry.a2, geometry.b2, geometry.b1].map((p) => `${p.x},${p.y}`).join(' '),
    class: 'window-face',
    'data-shape-id': shape.id,
  }));
  layer.appendChild(createSvgEl('line', {
    x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, class: 'shape-hit-line', 'data-shape-id': shape.id,
  }));
  layer.appendChild(createSvgEl('line', {
    x1: geometry.a1.x, y1: geometry.a1.y, x2: geometry.a2.x, y2: geometry.a2.y, class: 'shape-line', 'data-shape-id': shape.id,
  }));
  layer.appendChild(createSvgEl('line', {
    x1: geometry.b1.x, y1: geometry.b1.y, x2: geometry.b2.x, y2: geometry.b2.y, class: 'shape-line', 'data-shape-id': shape.id,
  }));
  layer.appendChild(createSvgEl('line', {
    x1: shape.x1, y1: shape.y1, x2: geometry.a1.x, y2: geometry.a1.y, class: 'shape-line', 'data-shape-id': shape.id,
  }));
  layer.appendChild(createSvgEl('line', {
    x1: shape.x1, y1: shape.y1, x2: geometry.b1.x, y2: geometry.b1.y, class: 'shape-line', 'data-shape-id': shape.id,
  }));
  layer.appendChild(createSvgEl('line', {
    x1: shape.x2, y1: shape.y2, x2: geometry.a2.x, y2: geometry.a2.y, class: 'shape-line', 'data-shape-id': shape.id,
  }));
  layer.appendChild(createSvgEl('line', {
    x1: shape.x2, y1: shape.y2, x2: geometry.b2.x, y2: geometry.b2.y, class: 'shape-line', 'data-shape-id': shape.id,
  }));
}

function getAdaptiveHandleOffsetPx(basePx = 54, maxPx = 110) {
  const zoom = Math.max(appState.view.zoom || 1, 0.01);
  const zoomOutBoost = zoom < 1 ? (1 - zoom) * 0.95 : 0;
  return Math.min(maxPx, basePx * (1 + zoomOutBoost));
}

function getSelectionHandleAngleDeg(shape) {
  const currentAngle = getShapeHandleSessionBaseAngle(shape);
  if (shape?.type === 'line') return currentAngle;
  const selected = appState.project.selection;
  const baseAngle = selected?.handleBaseAngle ?? currentAngle;
  return normalizeAngle(currentAngle - baseAngle);
}

function rotateVector(x, y, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function getRectTopBottomHandlePoints(shape) {
  const corners = getRectCorners(shape);
  const center = getRectCenter(shape);
  const direction = rotateVector(0, -1, getSelectionHandleAngleDeg(shape));
  const projections = corners.map((point) => ((point.x - center.x) * direction.x) + ((point.y - center.y) * direction.y));
  const halfExtent = Math.max(...projections);
  const offset = getAdaptiveHandleOffsetPx() / Math.max(appState.view.zoom || 1, 0.01);
  return {
    top: { x: center.x + direction.x * (halfExtent + offset), y: center.y + direction.y * (halfExtent + offset) },
    bottom: { x: center.x - direction.x * (halfExtent + offset), y: center.y - direction.y * (halfExtent + offset) },
  };
}

function getDoorMoveHandlePoint(shape) {
  return getRectTopBottomHandlePoints(shape).bottom;
}

function getRectHandleConnectorPoints(shape) {
  const corners = getRectCorners(shape);
  const center = getRectCenter(shape);
  const direction = rotateVector(0, -1, getSelectionHandleAngleDeg(shape));
  const projections = corners.map((point) => ((point.x - center.x) * direction.x) + ((point.y - center.y) * direction.y));
  const halfExtent = Math.max(...projections);
  return {
    top: { x: center.x + direction.x * halfExtent, y: center.y + direction.y * halfExtent },
    bottom: { x: center.x - direction.x * halfExtent, y: center.y - direction.y * halfExtent },
  };
}

function drawShapes(layer) {
  const sortedShapes = [...appState.project.shapes].sort((a, b) => getShapeDrawOrder(a) - getShapeDrawOrder(b));
  sortedShapes.forEach((shape) => {
    if (shape.type === 'rect') {
      if (isDoorShape(shape)) {
        appendDoorShape(layer, shape);
      } else {
        const corners = getRectCorners(shape);
        const points = corners.map((p) => `${p.x},${p.y}`).join(' ');
        layer.appendChild(createSvgEl('polygon', { points, class: 'shape-face', 'data-shape-id': shape.id }));
      }
    }
    if (shape.type === 'line') {
      if (isWindowShape(shape)) {
        appendWindowShape(layer, shape);
      } else {
        layer.appendChild(createSvgEl('line', {
          x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, class: 'shape-hit-line', 'data-shape-id': shape.id,
        }));
        layer.appendChild(createSvgEl('line', {
          x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, class: 'shape-line', 'data-shape-id': shape.id,
        }));
      }
    }
  });
}


function getShapeDrawOrder(shape) {
  if (shape.type === 'line') return -1;
  return -(shape.widthPx * shape.heightPx);
}

function getHandleScale() {
  const zoom = Math.max(appState.view.zoom || 1, 0.01);
  return 1 / zoom;
}

function appendHandleCircle(layer, point, handleName, { visibleRadius = 9, hitRadius = 22, className = 'handle' } = {}) {
  const scale = getHandleScale();
  layer.appendChild(createSvgEl('circle', {
    cx: point.x, cy: point.y, r: hitRadius * scale, class: 'handle-hit', 'data-handle': handleName,
  }));
  layer.appendChild(createSvgEl('circle', {
    cx: point.x, cy: point.y, r: visibleRadius * scale, class: className, 'data-handle': handleName,
  }));
}

function appendHandleRect(layer, center, handleName, { visibleSize = 20, hitSize = 44, className = 'handle move-handle' } = {}) {
  const scale = getHandleScale();
  const hitHalf = (hitSize * scale) / 2;
  const visibleHalf = (visibleSize * scale) / 2;
  layer.appendChild(createSvgEl('rect', {
    x: center.x - hitHalf, y: center.y - hitHalf, width: hitHalf * 2, height: hitHalf * 2, class: 'handle-hit', 'data-handle': handleName,
  }));
  layer.appendChild(createSvgEl('rect', {
    x: center.x - visibleHalf, y: center.y - visibleHalf, width: visibleHalf * 2, height: visibleHalf * 2, rx: 2 * scale, ry: 2 * scale, class: className, 'data-handle': handleName,
  }));
}

function drawSelection(layer) {
  const selected = getSelectedShape();
  if (!selected) return;
  if (selected.type === 'rect') {
    const corners = getRectCorners(selected);
    const center = getRectCenter(selected);
    const edgeMids = [
      { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2, handle: 'side-top' },
      { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2, handle: 'side-right' },
      { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2, handle: 'side-bottom' },
      { x: (corners[3].x + corners[0].x) / 2, y: (corners[3].y + corners[0].y) / 2, handle: 'side-left' },
    ];

    layer.appendChild(createSvgEl('polygon', {
      points: corners.map((p) => `${p.x},${p.y}`).join(' '), class: 'selection-outline',
    }));
    corners.forEach((point, index) => {
      appendHandleCircle(layer, point, `resize-${index}`);
    });
    if (!isDoorShape(selected)) {
      edgeMids.forEach((point) => {
        appendHandleCircle(layer, point, point.handle, { visibleRadius: 8, hitRadius: 22, className: 'handle side-handle' });
      });
    }
    const handlePoints = getRectTopBottomHandlePoints(selected);
    const connectorPoints = getRectHandleConnectorPoints(selected);
    layer.appendChild(createSvgEl('line', { x1: connectorPoints.top.x, y1: connectorPoints.top.y, x2: handlePoints.top.x, y2: handlePoints.top.y, class: 'rotate-link' }));
    appendHandleCircle(layer, handlePoints.top, 'rotate', { visibleRadius: 10, hitRadius: 26, className: 'rotate-handle' });
    if (isDoorShape(selected)) {
      layer.appendChild(createSvgEl('line', { x1: connectorPoints.bottom.x, y1: connectorPoints.bottom.y, x2: handlePoints.bottom.x, y2: handlePoints.bottom.y, class: 'rotate-link' }));
      appendHandleRect(layer, getDoorMoveHandlePoint(selected), 'door-move');
    }
    return;
  }
  if (selected.type === 'line') {
    layer.appendChild(createSvgEl('line', { x1: selected.x1, y1: selected.y1, x2: selected.x2, y2: selected.y2, class: 'selection-line' }));
    appendHandleCircle(layer, { x: selected.x1, y: selected.y1 }, 'line-start');
    appendHandleCircle(layer, { x: selected.x2, y: selected.y2 }, 'line-end');
    const cx = (selected.x1 + selected.x2) / 2;
    const cy = (selected.y1 + selected.y2) / 2;
    const direction = rotateVector(0, -1, getSelectionHandleAngleDeg(selected));
    const projections = [
      ((selected.x1 - cx) * direction.x) + ((selected.y1 - cy) * direction.y),
      ((selected.x2 - cx) * direction.x) + ((selected.y2 - cy) * direction.y),
    ];
    const halfExtent = Math.max(...projections);
    const offset = getAdaptiveHandleOffsetPx() / Math.max(appState.view.zoom || 1, 0.01);
    const connectorTop = { x: cx + direction.x * halfExtent, y: cy + direction.y * halfExtent };
    const connectorBottom = { x: cx - direction.x * halfExtent, y: cy - direction.y * halfExtent };
    const rotatePoint = { x: cx + direction.x * (halfExtent + offset), y: cy + direction.y * (halfExtent + offset) };
    const movePoint = { x: cx - direction.x * (halfExtent + offset), y: cy - direction.y * (halfExtent + offset) };
    layer.appendChild(createSvgEl('line', { x1: connectorTop.x, y1: connectorTop.y, x2: rotatePoint.x, y2: rotatePoint.y, class: 'rotate-link' }));
    appendHandleCircle(layer, rotatePoint, 'rotate', { visibleRadius: 10, hitRadius: 26, className: 'rotate-handle' });
    layer.appendChild(createSvgEl('line', { x1: connectorBottom.x, y1: connectorBottom.y, x2: movePoint.x, y2: movePoint.y, class: 'rotate-link' }));
    appendHandleRect(layer, movePoint, 'line-move');
  }
}


function appendWindowDimensionText(layer, shape) {
  const mid = getLineMidpoint(shape);
  const dx = shape.x2 - shape.x1;
  const dy = shape.y2 - shape.y1;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  if (ny < 0 || (Math.abs(ny) < 0.001 && nx < 0)) {
    nx *= -1;
    ny *= -1;
  }
  const offset = 18;
  const pos = { x: mid.x + nx * offset, y: mid.y + ny * offset };
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const textEl = createSvgEl('text', {
    x: pos.x,
    y: pos.y,
    class: 'window-dimension-text',
    transform: `rotate(${normalizeReadableAngle(angle)} ${pos.x} ${pos.y})`,
  });
  textEl.textContent = `${Math.round(pxToCm(getLineLengthPx(shape)))}`;
  layer.appendChild(textEl);
}

function normalizeReadableAngle(angleDeg) {
  let angle = angleDeg % 360;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

function appendAlignedDimensionText(layer, textValue, position, angleDeg) {
  const textEl = createSvgEl('text', {
    x: position.x,
    y: position.y,
    class: 'dimension-text edge-dimension-text',
    transform: `rotate(${normalizeReadableAngle(angleDeg)} ${position.x} ${position.y})`,
  });
  textEl.textContent = textValue;
  layer.appendChild(textEl);
}

function drawDimensions(layer) {
  appState.project.shapes.forEach((shape) => {
    if (isWindowShape(shape)) appendWindowDimensionText(layer, shape);
  });

  const selected = getSelectedShape();
  if (!selected) return;
  if (selected.type !== 'rect') return;

  const corners = getRectCorners(selected);
  const center = getRectCenter(selected);
  const edges = getRectEdges(selected);
  const edgeInset = 22;

  const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
  const topPos = movePointTowards(topMid, center, edgeInset);
  const topAngle = (Math.atan2(edges[0][1].y - edges[0][0].y, edges[0][1].x - edges[0][0].x) * 180) / Math.PI;
  appendAlignedDimensionText(layer, `${Math.round(pxToCm(selected.widthPx))}`, topPos, topAngle);

  if (isDoorShape(selected)) return;

  const rightMid = { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 };
  const rightPos = movePointTowards(rightMid, center, edgeInset);
  const rightAngle = (Math.atan2(edges[1][1].y - edges[1][0].y, edges[1][1].x - edges[1][0].x) * 180) / Math.PI;
  appendAlignedDimensionText(layer, `${Math.round(pxToCm(selected.heightPx))}`, rightPos, rightAngle);
}

function movePointTowards(from, to, distance) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: from.x + (dx / len) * distance,
    y: from.y + (dy / len) * distance,
  };
}

export function updateTopbarVisibility() {
  const overlay = document.getElementById('topbarOverlay');
  const widthInput = document.getElementById('widthInput');
  const heightInput = document.getElementById('heightInput');
  const heightGroup = document.getElementById('heightGroup');
  const selected = getSelectedShape();
  if (!selected) {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  if (selected.type === 'rect') {
    widthInput.disabled = false;
    if (isDoorShape(selected)) {
      heightInput.disabled = true;
      heightInput.value = '';
      heightGroup?.classList.add('hidden');
      widthInput.value = Math.round(pxToCm(selected.widthPx));
    } else {
      heightInput.disabled = false;
      heightGroup?.classList.remove('hidden');
      if (isRectQuarterTurn(selected)) {
        widthInput.value = Math.round(pxToCm(selected.heightPx));
        heightInput.value = Math.round(pxToCm(selected.widthPx));
      } else {
        widthInput.value = Math.round(pxToCm(selected.widthPx));
        heightInput.value = Math.round(pxToCm(selected.heightPx));
      }
    }
  } else {
    widthInput.disabled = false;
    heightInput.disabled = true;
    widthInput.value = Math.round(pxToCm(getLineLengthPx(selected)));
    heightInput.value = '';
    heightGroup?.classList.add('hidden');
  }
}

export function setCanvasViewBox() {
  const svg = document.getElementById('planCanvas');
  svg.setAttribute('viewBox', `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
}
