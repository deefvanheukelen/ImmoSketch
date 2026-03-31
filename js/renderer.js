import { appState, getSelectedShape } from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, String(value));
  });
  return el;
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

export function getFaceMetrics(shape) {
  const scale = appState.project.settings.scalePxPerCm;
  const widthPx = shape.widthCm * scale;
  const heightPx = shape.heightCm * scale;
  const centerX = shape.x + widthPx / 2;
  const centerY = shape.y + heightPx / 2;
  const rotation = shape.rotation ?? 0;
  return { scale, widthPx, heightPx, centerX, centerY, rotation };
}

function getFaceCorners(shape) {
  const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
  const center = { x: centerX, y: centerY };
  return {
    nw: rotatePoint({ x: shape.x, y: shape.y }, center, rotation),
    ne: rotatePoint({ x: shape.x + widthPx, y: shape.y }, center, rotation),
    se: rotatePoint({ x: shape.x + widthPx, y: shape.y + heightPx }, center, rotation),
    sw: rotatePoint({ x: shape.x, y: shape.y + heightPx }, center, rotation),
    center,
  };
}

function getLineMetrics(shape) {
  const centerX = (shape.x1 + shape.x2) / 2;
  const centerY = (shape.y1 + shape.y2) / 2;
  const length = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
  return { centerX, centerY, length };
}

function appendHandle(layer, attrs, visibleRadius = 16, hitRadius = 24) {
  const { cx, cy, class: className, ...rest } = attrs;
  layer.appendChild(createSvgEl('circle', { cx, cy, r: hitRadius, class: 'handle-hit-area', ...rest }));
  layer.appendChild(createSvgEl('circle', { cx, cy, r: visibleRadius, class: className, ...rest }));
}

function appendText(layer, x, y, className, text, rotation = null, centerX = 0, centerY = 0) {
  const attrs = { x, y, class: className };
  if (rotation !== null) attrs.transform = `rotate(${rotation} ${centerX} ${centerY})`;
  layer.appendChild(createSvgEl('text', attrs)).textContent = text;
}

function drawDoorShape(layer, shape, extraAttrs = {}) {
  const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
  const group = createSvgEl('g', {
    transform: `rotate(${rotation} ${centerX} ${centerY})`,
    ...extraAttrs,
  });
  group.appendChild(createSvgEl('rect', {
    x: shape.x - 18, y: shape.y - 18, width: widthPx + 36, height: heightPx + 36, class: 'door-hit-area', 'data-shape-id': shape.id,
  }));
  group.appendChild(createSvgEl('line', {
    x1: shape.x, y1: shape.y, x2: shape.x, y2: shape.y + heightPx, class: 'door-guide-line', 'data-shape-id': shape.id,
  }));
  group.appendChild(createSvgEl('line', {
    x1: shape.x, y1: shape.y, x2: shape.x + widthPx, y2: shape.y, class: 'door-guide-line', 'data-shape-id': shape.id,
  }));
  const path = `M ${shape.x + widthPx} ${shape.y} A ${widthPx} ${heightPx} 0 0 1 ${shape.x} ${shape.y + heightPx}`;
  group.appendChild(createSvgEl('path', { d: path, class: 'door-arc', 'data-shape-id': shape.id }));
  layer.appendChild(group);
}


function drawDoubleDoorShape(layer, shape, extraAttrs = {}) {
  const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
  const halfWidth = widthPx / 2;
  const midX = shape.x + halfWidth;
  const bottomY = shape.y + heightPx;
  const group = createSvgEl('g', {
    transform: `rotate(${rotation} ${centerX} ${centerY})`,
    ...extraAttrs,
  });
  group.appendChild(createSvgEl('rect', {
    x: shape.x - 18, y: shape.y - 18, width: widthPx + 36, height: heightPx + 52, class: 'door-hit-area', 'data-shape-id': shape.id,
  }));
  group.appendChild(createSvgEl('line', {
    x1: shape.x, y1: bottomY, x2: shape.x + widthPx, y2: bottomY, class: 'door-guide-line', 'data-shape-id': shape.id,
  }));
  group.appendChild(createSvgEl('line', {
    x1: shape.x, y1: shape.y, x2: shape.x, y2: bottomY, class: 'door-guide-line', 'data-shape-id': shape.id,
  }));
  group.appendChild(createSvgEl('line', {
    x1: shape.x + widthPx, y1: shape.y, x2: shape.x + widthPx, y2: bottomY, class: 'door-guide-line', 'data-shape-id': shape.id,
  }));
  const leftPath = `M ${shape.x} ${shape.y} A ${halfWidth} ${heightPx} 0 0 1 ${midX} ${bottomY}`;
  const rightPath = `M ${midX} ${bottomY} A ${halfWidth} ${heightPx} 0 0 1 ${shape.x + widthPx} ${shape.y}`;
  group.appendChild(createSvgEl('path', { d: leftPath, class: 'door-arc', 'data-shape-id': shape.id }));
  group.appendChild(createSvgEl('path', { d: rightPath, class: 'door-arc', 'data-shape-id': shape.id }));
  layer.appendChild(group);
}


function getReadableAngle(degrees) {
  let angle = ((degrees % 360) + 360) % 360;
  if (angle > 180) angle -= 360;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

function drawFaceDimensionLabels(layer, shape) {
  const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
  const inset = 18;
  const topCenterLocal = { x: centerX, y: shape.y + inset };
  const rightCenterLocal = { x: shape.x + widthPx - inset, y: centerY };
  const topCenter = rotatePoint(topCenterLocal, { x: centerX, y: centerY }, rotation);
  const rightCenter = rotatePoint(rightCenterLocal, { x: centerX, y: centerY }, rotation);
  const topAngle = getReadableAngle(rotation);
  const rightAngle = getReadableAngle(rotation + 90);
  appendText(layer, topCenter.x, topCenter.y, 'dimension-text', `${Math.round(shape.widthCm)}`, topAngle, topCenter.x, topCenter.y);
  appendText(layer, rightCenter.x, rightCenter.y, 'dimension-text', `${Math.round(shape.heightCm)}`, rightAngle, rightCenter.x, rightCenter.y);
}

export function renderScene() {
  const viewportLayer = document.getElementById('viewportLayer');
  const shapeLayer = document.getElementById('shapeLayer');
  const selectionLayer = document.getElementById('selectionLayer');
  const guideLayer = document.getElementById('guideLayer');
  const toolPreviewLayer = document.getElementById('toolPreviewLayer');
  const { zoom, panX, panY } = appState.viewport;

  viewportLayer.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`);

  shapeLayer.replaceChildren();
  selectionLayer.replaceChildren();
  guideLayer.replaceChildren();
  toolPreviewLayer.replaceChildren();

  appState.interaction.snapLines.forEach((snapLine) => guideLayer.appendChild(createSvgEl('line', { ...snapLine, class: 'snap-guide' })));

  appState.project.shapes.forEach((shape) => {
    if (shape.type === 'face') {
      if (shape.metaTool === 'door') {
        drawDoorShape(shapeLayer, shape);
        return;
      }
      if (shape.metaTool === 'double-door') {
        drawDoubleDoorShape(shapeLayer, shape);
        return;
      }
      const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
      shapeLayer.appendChild(createSvgEl('rect', {
        x: shape.x, y: shape.y, width: widthPx, height: heightPx, class: 'face-shape', 'data-shape-id': shape.id,
        transform: `rotate(${rotation} ${centerX} ${centerY})`,
      }));
      return;
    }
    shapeLayer.appendChild(createSvgEl('line', { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, class: 'line-hit-area', 'data-shape-id': shape.id }));
    shapeLayer.appendChild(createSvgEl('line', { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, class: 'generic-line', 'data-shape-id': shape.id }));
  });

  const shape = getSelectedShape();
  const drag = appState.interaction.toolDrag;
  if (!shape) {
    drawToolPreview(toolPreviewLayer);
    return;
  }

  if (shape.type === 'face') {
    const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
    const corners = getFaceCorners(shape);
    selectionLayer.appendChild(createSvgEl('rect', {
      x: shape.x, y: shape.y, width: widthPx, height: heightPx, class: 'selection-outline',
      transform: `rotate(${rotation} ${centerX} ${centerY})`,
    }));

    ['nw', 'ne', 'se', 'sw'].forEach((handleName) => {
      const point = corners[handleName];
      appendHandle(selectionLayer, {
        cx: point.x, cy: point.y, class: 'resize-handle', 'data-handle': 'resize-face', 'data-corner': handleName, 'data-shape-id': shape.id,
      });
    });

    const rotatePointWorld = rotatePoint({ x: centerX, y: shape.y - 42 }, { x: centerX, y: centerY }, rotation);
    appendHandle(selectionLayer, { cx: rotatePointWorld.x, cy: rotatePointWorld.y, class: 'rotate-handle', 'data-handle': 'rotate', 'data-shape-id': shape.id }, 15, 25);

    if (shape.metaTool === 'door' || shape.metaTool === 'double-door') {
      const proxyPoint = rotatePoint({ x: centerX, y: shape.y + heightPx + 42 }, { x: centerX, y: centerY }, rotation);
      selectionLayer.appendChild(createSvgEl('rect', {
        x: proxyPoint.x - 20,
        y: proxyPoint.y - 20,
        width: 40,
        height: 40,
        class: 'move-proxy-handle',
        'data-handle': 'move-proxy',
        'data-shape-id': shape.id,
      }));
      selectionLayer.appendChild(createSvgEl('text', {
        x: proxyPoint.x,
        y: proxyPoint.y + 1,
        class: 'move-proxy-handle-label',
      })).textContent = '□';
    }

    if (!['door', 'double-door'].includes(shape.metaTool)) {
      drawFaceDimensionLabels(selectionLayer, shape);
    }
    return;
  }

  const { centerX, centerY, length } = getLineMetrics(shape);
  selectionLayer.appendChild(createSvgEl('line', { x1: shape.x1, y1: shape.y1, x2: shape.x2, y2: shape.y2, class: 'selection-outline' }));
  appendHandle(selectionLayer, { cx: shape.x1, cy: shape.y1, class: 'endpoint-handle', 'data-handle': 'line-endpoint', 'data-endpoint': 'start', 'data-shape-id': shape.id });
  appendHandle(selectionLayer, { cx: shape.x2, cy: shape.y2, class: 'endpoint-handle', 'data-handle': 'line-endpoint', 'data-endpoint': 'end', 'data-shape-id': shape.id });
  appendHandle(selectionLayer, { cx: centerX, cy: centerY - 36, class: 'rotate-handle', 'data-handle': 'rotate', 'data-shape-id': shape.id }, 15, 25);
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
  const offset = 28;
  const normalX = -Math.sin(angle) * offset;
  const normalY = Math.cos(angle) * offset;
  const lengthCm = Math.round(length / appState.project.settings.scalePxPerCm);
  appendText(selectionLayer, centerX + normalX, centerY + normalY, 'line-dimension-text', `${lengthCm}`);

  drawToolPreview(toolPreviewLayer);
}


export function drawToolPreview(layer) {
  const drag = appState.interaction.toolDrag;
  if (!drag?.previewPoint) return;

  if (drag.tool === 'line') {
    layer.appendChild(createSvgEl('line', { x1: drag.previewPoint.x, y1: drag.previewPoint.y, x2: drag.previewPoint.x + 120, y2: drag.previewPoint.y, class: 'tool-preview' }));
    return;
  }

  if (drag.tool === 'door') {
    const previewShape = { type: 'face', metaTool: 'door', x: drag.previewPoint.x, y: drag.previewPoint.y, widthCm: 100, heightCm: 100, rotation: 0 };
    drawDoorShape(layer, previewShape, { class: 'tool-preview-group' });
    return;
  }

  if (drag.tool === 'double-door') {
    const previewShape = { type: 'face', metaTool: 'double-door', x: drag.previewPoint.x, y: drag.previewPoint.y, widthCm: 180, heightCm: 90, rotation: 0 };
    drawDoubleDoorShape(layer, previewShape, { class: 'tool-preview-group' });
    return;
  }

  layer.appendChild(createSvgEl('rect', { x: drag.previewPoint.x, y: drag.previewPoint.y, width: 200, height: 200, class: 'tool-preview' }));
}
