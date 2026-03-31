import { appState, getSelectedShape } from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, String(value));
  });
  return el;
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

export function rotatePoint(point, center, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + (dx * cos) - (dy * sin),
    y: center.y + (dx * sin) + (dy * cos),
  };
}

export function getFaceCorners(shape) {
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
  const angleDeg = (Math.atan2(shape.y2 - shape.y1, shape.x2 - shape.x1) * 180) / Math.PI;
  return { centerX, centerY, angleDeg };
}

export function renderScene() {
  const viewportLayer = document.getElementById('viewportLayer');
  const shapeLayer = document.getElementById('shapeLayer');
  const selectionLayer = document.getElementById('selectionLayer');
  const guideLayer = document.getElementById('guideLayer');
  const { zoom, panX, panY } = appState.viewport;

  viewportLayer.setAttribute('transform', `translate(${panX} ${panY}) scale(${zoom})`);
  shapeLayer.replaceChildren();
  selectionLayer.replaceChildren();
  guideLayer.replaceChildren();

  drawGuides(guideLayer);
  drawShapes(shapeLayer);
  drawSelection(selectionLayer);
}

function drawGuides(layer) {
  layer.append(
    createSvgEl('line', { x1: 600, y1: 0, x2: 600, y2: 900, class: 'center-guide' }),
    createSvgEl('line', { x1: 0, y1: 450, x2: 1200, y2: 450, class: 'center-guide' }),
  );

  appState.interaction.snapLines.forEach((snapLine) => {
    layer.appendChild(createSvgEl('line', { ...snapLine, class: 'snap-guide' }));
  });
}

function drawShapes(layer) {
  appState.project.shapes.forEach((shape) => {
    if (shape.type === 'face') {
      const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
      layer.appendChild(createSvgEl('rect', {
        x: shape.x,
        y: shape.y,
        width: widthPx,
        height: heightPx,
        class: 'face-shape',
        'data-shape-id': shape.id,
        transform: `rotate(${rotation} ${centerX} ${centerY})`,
      }));
    }

    if (shape.type === 'line') {
      layer.appendChild(createSvgEl('line', {
        x1: shape.x1,
        y1: shape.y1,
        x2: shape.x2,
        y2: shape.y2,
        class: 'generic-line',
        'data-shape-id': shape.id,
      }));
    }
  });
}

function drawSelection(layer) {
  const shape = getSelectedShape();
  if (!shape) return;

  if (shape.type === 'face') {
    const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
    const corners = getFaceCorners(shape);

    layer.appendChild(createSvgEl('rect', {
      x: shape.x,
      y: shape.y,
      width: widthPx,
      height: heightPx,
      class: 'selection-outline',
      transform: `rotate(${rotation} ${centerX} ${centerY})`,
    }));

    layer.appendChild(createSvgEl('line', {
      x1: centerX,
      y1: centerY - (heightPx / 2),
      x2: centerX,
      y2: centerY - (heightPx / 2) - 28,
      class: 'handle-link',
      transform: `rotate(${rotation} ${centerX} ${centerY})`,
    }));

    layer.appendChild(createSvgEl('circle', {
      cx: centerX,
      cy: centerY - (heightPx / 2) - 28,
      r: 10,
      class: 'rotate-handle',
      'data-handle': 'rotate',
      'data-shape-id': shape.id,
      transform: `rotate(${rotation} ${centerX} ${centerY})`,
    }));

    ['nw', 'ne', 'se', 'sw'].forEach((name) => {
      const point = corners[name];
      layer.appendChild(createSvgEl('circle', {
        cx: point.x,
        cy: point.y,
        r: 8,
        class: 'resize-handle',
        'data-handle': `resize-${name}`,
        'data-shape-id': shape.id,
      }));
    });
  }

  if (shape.type === 'line') {
    const { centerX, centerY } = getLineMetrics(shape);
    layer.appendChild(createSvgEl('line', {
      x1: shape.x1,
      y1: shape.y1,
      x2: shape.x2,
      y2: shape.y2,
      class: 'selection-outline',
    }));

    layer.appendChild(createSvgEl('line', {
      x1: centerX,
      y1: centerY,
      x2: centerX,
      y2: centerY - 28,
      class: 'handle-link',
    }));

    layer.appendChild(createSvgEl('circle', {
      cx: centerX,
      cy: centerY - 28,
      r: 10,
      class: 'rotate-handle',
      'data-handle': 'rotate',
      'data-shape-id': shape.id,
    }));

    layer.appendChild(createSvgEl('circle', {
      cx: shape.x1,
      cy: shape.y1,
      r: 8,
      class: 'line-end-handle',
      'data-handle': 'endpoint-start',
      'data-shape-id': shape.id,
    }));

    layer.appendChild(createSvgEl('circle', {
      cx: shape.x2,
      cy: shape.y2,
      r: 8,
      class: 'line-end-handle',
      'data-handle': 'endpoint-end',
      'data-shape-id': shape.id,
    }));
  }
}
