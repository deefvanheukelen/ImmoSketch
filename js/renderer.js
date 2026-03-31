import { appState, getSelectedShape } from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, String(value));
  });
  return el;
}

function getFaceMetrics(shape) {
  const scale = appState.project.settings.scalePxPerCm;
  const widthPx = shape.widthCm * scale;
  const heightPx = shape.heightCm * scale;
  const centerX = shape.x + widthPx / 2;
  const centerY = shape.y + heightPx / 2;
  const rotation = shape.rotation ?? 0;
  return { scale, widthPx, heightPx, centerX, centerY, rotation };
}

function getLineMetrics(shape) {
  const centerX = (shape.x1 + shape.x2) / 2;
  const centerY = (shape.y1 + shape.y2) / 2;
  return { centerX, centerY };
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

    if (shape.type === 'line') {
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
    }
  });
}

function drawSelection(layer) {
  const shape = getSelectedShape();
  if (!shape) {
    return;
  }

  if (shape.type === 'face') {
    const { widthPx, heightPx, centerX, centerY, rotation } = getFaceMetrics(shape);
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

    layer.appendChild(
      createSvgEl('circle', {
        cx: centerX,
        cy: shape.y - 28,
        r: 10,
        class: 'rotate-handle',
        'data-handle': 'rotate',
        'data-shape-id': shape.id,
        transform: `rotate(${rotation} ${centerX} ${centerY})`,
      }),
    );
    return;
  }

  if (shape.type === 'line') {
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
        cx: centerX,
        cy: centerY - 28,
        r: 10,
        class: 'rotate-handle',
        'data-handle': 'rotate',
        'data-shape-id': shape.id,
      }),
    );
  }
}
