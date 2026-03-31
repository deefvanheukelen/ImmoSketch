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

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function edgeLength(edge) {
  return Math.hypot(edge.end.x - edge.start.x, edge.end.y - edge.start.y);
}

function edgeAngleDeg(edge) {
  return (Math.atan2(edge.end.y - edge.start.y, edge.end.x - edge.start.x) * 180) / Math.PI;
}

function normalizeTextAngle(degrees) {
  let angle = ((degrees % 360) + 360) % 360;
  if (angle > 180) angle -= 360;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return angle;
}

function moveTowards(point, target, distance) {
  const dx = target.x - point.x;
  const dy = target.y - point.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: point.x + (dx / length) * distance,
    y: point.y + (dy / length) * distance,
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
  const corners = {
    nw: rotatePoint({ x: shape.x, y: shape.y }, center, rotation),
    ne: rotatePoint({ x: shape.x + widthPx, y: shape.y }, center, rotation),
    se: rotatePoint({ x: shape.x + widthPx, y: shape.y + heightPx }, center, rotation),
    sw: rotatePoint({ x: shape.x, y: shape.y + heightPx }, center, rotation),
  };
  return { ...corners, center };
}

function getLineMetrics(shape) {
  const centerX = (shape.x1 + shape.x2) / 2;
  const centerY = (shape.y1 + shape.y2) / 2;
  const length = Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1);
  return { centerX, centerY, length };
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

  drawGuides(guideLayer);
  drawShapes(shapeLayer);
  drawSelection(selectionLayer);
  drawToolPreview(toolPreviewLayer);
}

function drawGuides(layer) {
  appState.interaction.snapLines.forEach((snapLine) => {
    layer.appendChild(createSvgEl('line', { ...snapLine, class: 'snap-guide' }));
  });
}

function drawShapes(layer) {
  appState.project.shapes.forEach((shape) => {
    if (shape.type === 'face') {
      const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
      layer.appendChild(
        createSvgEl('rect', {
          x: shape.x,
          y: shape.y,
          width: widthPx,
          height: heightPx,
          class: 'face-shape',
          'data-shape-id': shape.id,
          transform: `rotate(${rotation} ${centerX} ${centerY})`,
        }),
      );
      return;
    }

    layer.appendChild(
      createSvgEl('line', {
        x1: shape.x1,
        y1: shape.y1,
        x2: shape.x2,
        y2: shape.y2,
        class: 'line-hit-area',
        'data-shape-id': shape.id,
      }),
    );
    layer.appendChild(
      createSvgEl('line', {
        x1: shape.x1,
        y1: shape.y1,
        x2: shape.x2,
        y2: shape.y2,
        class: 'generic-line',
        'data-shape-id': shape.id,
      }),
    );
  });
}

function drawFaceDimensions(layer, shape) {
  const corners = getFaceCorners(shape);
  const edges = [
    { start: corners.nw, end: corners.ne },
    { start: corners.ne, end: corners.se },
    { start: corners.se, end: corners.sw },
    { start: corners.sw, end: corners.nw },
  ].map((edge) => ({
    ...edge,
    mid: midpoint(edge.start, edge.end),
  }));

  const topEdge = edges.reduce((best, edge) => (edge.mid.y < best.mid.y ? edge : best), edges[0]);
  const rightEdge = edges.reduce((best, edge) => (edge.mid.x > best.mid.x ? edge : best), edges[0]);

  [topEdge, rightEdge].forEach((edge) => {
    const position = moveTowards(edge.mid, corners.center, 28);
    const angle = normalizeTextAngle(edgeAngleDeg(edge));
    const valueCm = Math.round(edgeLength(edge) / appState.project.settings.scalePxPerCm);

    layer.appendChild(
      createSvgEl('text', {
        x: position.x,
        y: position.y,
        class: 'dimension-text',
        transform: `rotate(${angle} ${position.x} ${position.y})`,
      }),
    ).textContent = `${valueCm} cm`;
  });
}

function drawLineDimension(layer, shape) {
  const { centerX, centerY, length } = getLineMetrics(shape);
  const angle = Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1);
  const offset = 28;
  const normalX = -Math.sin(angle) * offset;
  const normalY = Math.cos(angle) * offset;
  const lengthCm = Math.round(length / appState.project.settings.scalePxPerCm);

  layer.appendChild(
    createSvgEl('text', {
      x: centerX + normalX,
      y: centerY + normalY,
      class: 'line-dimension-text',
    }),
  ).textContent = `${lengthCm} cm`;
}

function drawSelection(layer) {
  const shape = getSelectedShape();
  if (!shape) return;

  if (shape.type === 'face') {
    const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
    const corners = getFaceCorners(shape);

    layer.appendChild(
      createSvgEl('rect', {
        x: shape.x,
        y: shape.y,
        width: widthPx,
        height: heightPx,
        class: 'selection-outline',
        transform: `rotate(${rotation} ${centerX} ${centerY})`,
      }),
    );

    ['nw', 'ne', 'se', 'sw'].forEach((handleName) => {
      const point = corners[handleName];
      layer.appendChild(
        createSvgEl('circle', {
          cx: point.x,
          cy: point.y,
          r: 14,
          class: 'resize-handle',
          'data-handle': 'resize-face',
          'data-corner': handleName,
          'data-shape-id': shape.id,
        }),
      );
    });

    const rotatePointWorld = rotatePoint({ x: centerX, y: shape.y - 34 }, { x: centerX, y: centerY }, rotation);
    layer.appendChild(
      createSvgEl('circle', {
        cx: rotatePointWorld.x,
        cy: rotatePointWorld.y,
        r: 12,
        class: 'rotate-handle',
        'data-handle': 'rotate',
        'data-shape-id': shape.id,
      }),
    );

    drawFaceDimensions(layer, shape);
    return;
  }

  const { centerX, centerY } = getLineMetrics(shape);
  layer.appendChild(
    createSvgEl('line', {
      x1: shape.x1,
      y1: shape.y1,
      x2: shape.x2,
      y2: shape.y2,
      class: 'selection-outline',
    }),
  );

  layer.appendChild(
    createSvgEl('circle', {
      cx: shape.x1,
      cy: shape.y1,
      r: 14,
      class: 'endpoint-handle',
      'data-handle': 'line-endpoint',
      'data-endpoint': 'start',
      'data-shape-id': shape.id,
    }),
  );

  layer.appendChild(
    createSvgEl('circle', {
      cx: shape.x2,
      cy: shape.y2,
      r: 14,
      class: 'endpoint-handle',
      'data-handle': 'line-endpoint',
      'data-endpoint': 'end',
      'data-shape-id': shape.id,
    }),
  );

  layer.appendChild(
    createSvgEl('circle', {
      cx: centerX,
      cy: centerY - 28,
      r: 12,
      class: 'rotate-handle',
      'data-handle': 'rotate',
      'data-shape-id': shape.id,
    }),
  );

  drawLineDimension(layer, shape);
}

function drawToolPreview(layer) {
  const drag = appState.interaction.toolDrag;
  if (!drag?.previewPoint) return;

  if (drag.tool === 'line') {
    layer.appendChild(
      createSvgEl('line', {
        x1: drag.previewPoint.x,
        y1: drag.previewPoint.y,
        x2: drag.previewPoint.x + 120,
        y2: drag.previewPoint.y,
        class: 'tool-preview',
      }),
    );
    return;
  }

  layer.appendChild(
    createSvgEl('rect', {
      x: drag.previewPoint.x,
      y: drag.previewPoint.y,
      width: 200,
      height: 200,
      class: 'tool-preview',
    }),
  );
}
