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
  (appState.project.activeGuides || []).forEach((guide) => {
    if (guide.type === 'vertical') {
      layer.appendChild(createSvgEl('line', { x1: guide.x, y1: -4000, x2: guide.x, y2: 4000, class: 'guide-line' }));
    }
    if (guide.type === 'horizontal') {
      layer.appendChild(createSvgEl('line', { x1: -4000, y1: guide.y, x2: 4000, y2: guide.y, class: 'guide-line' }));
    }
  });
}

function drawDerivedFaces(layer) {
  appState.project.derivedFaces.forEach((face) => {
    const points = face.points.map((p) => `${p.x},${p.y}`).join(' ');
    layer.appendChild(createSvgEl('polygon', { points, class: 'detected-face' }));
  });
}

function drawShapes(layer) {
  appState.project.shapes.forEach((shape) => {
    if (shape.type === 'rect') {
      const corners = getRectCorners(shape);
      const points = corners.map((p) => `${p.x},${p.y}`).join(' ');
      layer.appendChild(createSvgEl('polygon', { points, class: 'shape-face', 'data-shape-id': shape.id }));
    }
    if (shape.type === 'line') {
      layer.appendChild(createSvgEl('line', {
        x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, class: 'shape-hit-line', 'data-shape-id': shape.id,
      }));
      layer.appendChild(createSvgEl('line', {
        x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, class: 'shape-line', 'data-shape-id': shape.id,
      }));
    }
  });
}

function drawSelection(layer) {
  const selected = getSelectedShape();
  if (!selected) return;
  const zoom = appState.view.zoom || 1;
  const handleRadius = Math.max(9 / zoom, 5.5);
  const handleHitRadius = Math.max(22 / zoom, handleRadius + 6 / zoom);
  const sideHandleRadius = Math.max(8 / zoom, 5);
  const sideHandleHitRadius = Math.max(20 / zoom, sideHandleRadius + 6 / zoom);
  const rotateRadius = Math.max(10 / zoom, 6);
  const rotateHitRadius = Math.max(22 / zoom, rotateRadius + 6 / zoom);
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
      layer.appendChild(createSvgEl('circle', { cx: point.x, cy: point.y, r: handleHitRadius, class: 'handle-hit', 'data-handle': `resize-${index}` }));
      layer.appendChild(createSvgEl('circle', { cx: point.x, cy: point.y, r: handleRadius, class: 'handle', 'data-handle': `resize-${index}` }));
    });
    edgeMids.forEach((point) => {
      layer.appendChild(createSvgEl('circle', { cx: point.x, cy: point.y, r: sideHandleHitRadius, class: 'handle-hit', 'data-handle': point.handle }));
      layer.appendChild(createSvgEl('circle', { cx: point.x, cy: point.y, r: sideHandleRadius, class: 'handle side-handle', 'data-handle': point.handle }));
    });
    const topY = Math.min(...corners.map((p) => p.y));
    const rotatePoint = { x: center.x, y: topY - 38 };
    layer.appendChild(createSvgEl('line', { x1: center.x, y1: topY, x2: rotatePoint.x, y2: rotatePoint.y, class: 'rotate-link' }));
    layer.appendChild(createSvgEl('circle', { cx: rotatePoint.x, cy: rotatePoint.y, r: rotateHitRadius, class: 'handle-hit', 'data-handle': 'rotate' }));
    layer.appendChild(createSvgEl('circle', { cx: rotatePoint.x, cy: rotatePoint.y, r: rotateRadius, class: 'rotate-handle', 'data-handle': 'rotate' }));
    return;
  }
  if (selected.type === 'line') {
    layer.appendChild(createSvgEl('line', { x1: selected.x1, y1: selected.y1, x2: selected.x2, y2: selected.y2, class: 'selection-line' }));
    layer.appendChild(createSvgEl('circle', { cx: selected.x1, cy: selected.y1, r: handleHitRadius, class: 'handle-hit', 'data-handle': 'line-start' }));
    layer.appendChild(createSvgEl('circle', { cx: selected.x1, cy: selected.y1, r: handleRadius, class: 'handle', 'data-handle': 'line-start' }));
    layer.appendChild(createSvgEl('circle', { cx: selected.x2, cy: selected.y2, r: handleHitRadius, class: 'handle-hit', 'data-handle': 'line-end' }));
    layer.appendChild(createSvgEl('circle', { cx: selected.x2, cy: selected.y2, r: handleRadius, class: 'handle', 'data-handle': 'line-end' }));
    const cx = (selected.x1 + selected.x2) / 2;
    const cy = (selected.y1 + selected.y2) / 2;
    layer.appendChild(createSvgEl('line', { x1: cx, y1: cy, x2: cx, y2: cy - 32, class: 'rotate-link' }));
    layer.appendChild(createSvgEl('circle', { cx, cy: cy - 32, r: rotateHitRadius, class: 'handle-hit', 'data-handle': 'rotate' }));
    layer.appendChild(createSvgEl('circle', { cx, cy: cy - 32, r: rotateRadius, class: 'rotate-handle', 'data-handle': 'rotate' }));
    const dx = selected.x2 - selected.x1;
    const dy = selected.y2 - selected.y1;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    if (ny < 0 || (Math.abs(ny) < 0.001 && nx < 0)) {
      nx *= -1;
      ny *= -1;
    }
    const handleCenter = { x: cx + nx * 42, y: cy + ny * 42 };
    const moveHandleSize = Math.max(20 / zoom, 12);
    const moveHandleHitSize = Math.max(34 / zoom, moveHandleSize + 8 / zoom);
    layer.appendChild(createSvgEl('rect', { x: handleCenter.x - moveHandleHitSize / 2, y: handleCenter.y - moveHandleHitSize / 2, width: moveHandleHitSize, height: moveHandleHitSize, rx: 4 / zoom, ry: 4 / zoom, class: 'handle-hit', 'data-handle': 'line-move' }));
    layer.appendChild(createSvgEl('rect', { x: handleCenter.x - moveHandleSize / 2, y: handleCenter.y - moveHandleSize / 2, width: moveHandleSize, height: moveHandleSize, rx: 2 / zoom, ry: 2 / zoom, class: 'handle move-handle', 'data-handle': 'line-move' }));
  }
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
  const selected = getSelectedShape();
  if (!selected || selected.type !== 'rect') return;

  const corners = getRectCorners(selected);
  const center = getRectCenter(selected);
  const edges = getRectEdges(selected);
  const edgeInset = 22;

  const topMid = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
  const rightMid = { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 };

  const topPos = movePointTowards(topMid, center, edgeInset);
  const rightPos = movePointTowards(rightMid, center, edgeInset);

  const topAngle = (Math.atan2(edges[0][1].y - edges[0][0].y, edges[0][1].x - edges[0][0].x) * 180) / Math.PI;
  const rightAngle = (Math.atan2(edges[1][1].y - edges[1][0].y, edges[1][1].x - edges[1][0].x) * 180) / Math.PI;

  appendAlignedDimensionText(layer, `${Math.round(pxToCm(selected.widthPx))} cm`, topPos, topAngle);
  appendAlignedDimensionText(layer, `${Math.round(pxToCm(selected.heightPx))} cm`, rightPos, rightAngle);
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
  const selected = getSelectedShape();
  if (!selected) {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  if (selected.type === 'rect') {
    widthInput.disabled = false;
    heightInput.disabled = false;
    widthInput.value = Math.round(pxToCm(selected.widthPx));
    heightInput.value = Math.round(pxToCm(selected.heightPx));
  } else {
    widthInput.disabled = false;
    heightInput.disabled = true;
    widthInput.value = Math.round(pxToCm(getLineLengthPx(selected)));
    heightInput.value = '';
  }
}

export function setCanvasViewBox() {
  const svg = document.getElementById('planCanvas');
  svg.setAttribute('viewBox', `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`);
}
