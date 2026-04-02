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
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, String(value));
  });
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

  drawDerivedFaces(shapeLayer);
  drawShapes(shapeLayer);
  drawSelection(selectionLayer);
  drawDimensions(uiLayer);
}

function drawDerivedFaces(layer) {
  appState.project.derivedFaces.forEach((face) => {
    const points = face.points.map((p) => `${p.x},${p.y}`).join(' ');
    layer.appendChild(
      createSvgEl('polygon', {
        points,
        class: 'detected-face',
      }),
    );
  });
}

function drawShapes(layer) {
  appState.project.shapes.forEach((shape) => {
    if (shape.type === 'rect') {
      drawRectShape(layer, shape);
    }

    if (shape.type === 'line') {
      drawLineShape(layer, shape);
    }
  });
}

function drawRectShape(layer, shape) {
  const corners = getRectCorners(shape);
  const points = corners.map((p) => `${p.x},${p.y}`).join(' ');

  const polygon = createSvgEl('polygon', {
    points,
    class: 'shape-face',
    'data-shape-id': shape.id,
  });

  layer.appendChild(polygon);
}

function drawLineShape(layer, shape) {
  const hit = createSvgEl('line', {
    x1: shape.x1,
    y1: shape.y1,
    x2: shape.x2,
    y2: shape.y2,
    class: 'shape-hit-line',
    'data-shape-id': shape.id,
  });

  const line = createSvgEl('line', {
    x1: shape.x1,
    y1: shape.y1,
    x2: shape.x2,
    y2: shape.y2,
    class: 'shape-line',
    'data-shape-id': shape.id,
  });

  layer.append(hit, line);
}

function drawSelection(layer) {
  const selected = getSelectedShape();
  if (!selected) {
    return;
  }

  if (selected.type === 'rect') {
    drawRectSelection(layer, selected);
    return;
  }

  if (selected.type === 'line') {
    drawLineSelection(layer, selected);
  }
}

function drawRectSelection(layer, shape) {
  const corners = getRectCorners(shape);
  const center = getRectCenter(shape);
  const points = corners.map((p) => `${p.x},${p.y}`).join(' ');

  layer.appendChild(
    createSvgEl('polygon', {
      points,
      class: 'selection-outline',
    }),
  );

  corners.forEach((point, index) => {
    layer.appendChild(
      createSvgEl('circle', {
        cx: point.x,
        cy: point.y,
        r: 9,
        class: 'handle',
        'data-handle': `resize-${index}`,
      }),
    );
  });

  const rotatePoint = {
    x: center.x,
    y: Math.min(...corners.map((p) => p.y)) - 38,
  };

  layer.appendChild(
    createSvgEl('line', {
      x1: center.x,
      y1: center.y - shape.heightPx / 2,
      x2: rotatePoint.x,
      y2: rotatePoint.y,
      class: 'rotate-link',
    }),
  );

  layer.appendChild(
    createSvgEl('circle', {
      cx: rotatePoint.x,
      cy: rotatePoint.y,
      r: 10,
      class: 'rotate-handle',
      'data-handle': 'rotate',
    }),
  );
}

function drawLineSelection(layer, shape) {
  layer.appendChild(
    createSvgEl('line', {
      x1: shape.x1,
      y1: shape.y1,
      x2: shape.x2,
      y2: shape.y2,
      class: 'selection-line',
    }),
  );

  layer.appendChild(
    createSvgEl('circle', {
      cx: shape.x1,
      cy: shape.y1,
      r: 9,
      class: 'handle',
      'data-handle': 'line-start',
    }),
  );

  layer.appendChild(
    createSvgEl('circle', {
      cx: shape.x2,
      cy: shape.y2,
      r: 9,
      class: 'handle',
      'data-handle': 'line-end',
    }),
  );

  const cx = (shape.x1 + shape.x2) / 2;
  const cy = (shape.y1 + shape.y2) / 2;
  const rotateHandle = { x: cx, y: cy - 32 };

  layer.appendChild(
    createSvgEl('line', {
      x1: cx,
      y1: cy,
      x2: rotateHandle.x,
      y2: rotateHandle.y,
      class: 'rotate-link',
    }),
  );

  layer.appendChild(
    createSvgEl('circle', {
      cx: rotateHandle.x,
      cy: rotateHandle.y,
      r: 10,
      class: 'rotate-handle',
      'data-handle': 'rotate',
    }),
  );
}

function drawDimensions(layer) {
  const selected = getSelectedShape();
  if (!selected) {
    return;
  }

  if (selected.type === 'rect') {
    const center = getRectCenter(selected);
    const widthCm = Math.round(pxToCm(selected.widthPx));
    const heightCm = Math.round(pxToCm(selected.heightPx));

    layer.appendChild(
      createSvgEl('text', {
        x: center.x,
        y: center.y,
        class: 'dimension-text',
      }),
    ).textContent = `${widthCm} × ${heightCm}`;
  }

  if (selected.type === 'line') {
    const cx = (selected.x1 + selected.x2) / 2;
    const cy = (selected.y1 + selected.y2) / 2 + 28;
    const lengthCm = Math.round(pxToCm(getLineLengthPx(selected)));

    layer.appendChild(
      createSvgEl('text', {
        x: cx,
        y: cy,
        class: 'dimension-text',
      }),
    ).textContent = `${lengthCm} cm`;
  }
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