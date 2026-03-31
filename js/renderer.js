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
  return { widthPx, heightPx, centerX, centerY, rotation };
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

function pointKey(point) {
  return `${Math.round(point.x)}:${Math.round(point.y)}`;
}

export function getClosedLineLoops() {
  const lines = appState.project.shapes.filter((shape) => shape.type === 'line');
  const nodeMap = new Map();
  const lineById = new Map();

  lines.forEach((line) => {
    lineById.set(line.id, line);
    const a = { x: line.x1, y: line.y1 };
    const b = { x: line.x2, y: line.y2 };
    const keyA = pointKey(a);
    const keyB = pointKey(b);
    if (!nodeMap.has(keyA)) nodeMap.set(keyA, { point: a, edges: [] });
    if (!nodeMap.has(keyB)) nodeMap.set(keyB, { point: b, edges: [] });
    nodeMap.get(keyA).edges.push({ lineId: line.id, nextKey: keyB });
    nodeMap.get(keyB).edges.push({ lineId: line.id, nextKey: keyA });
  });

  const visitedLines = new Set();
  const loops = [];

  nodeMap.forEach((node, startKey) => {
    if (node.edges.length !== 2) return;

    node.edges.forEach((edge) => {
      if (visitedLines.has(edge.lineId)) return;

      const loopKeys = [startKey];
      const loopLineIds = [];
      let currentKey = startKey;
      let incomingLineId = null;
      let isValid = true;

      while (true) {
        const currentNode = nodeMap.get(currentKey);
        if (!currentNode || currentNode.edges.length !== 2) {
          isValid = false;
          break;
        }

        const nextEdge = currentNode.edges.find((candidate) => candidate.lineId !== incomingLineId) ?? currentNode.edges[0];
        if (!nextEdge) {
          isValid = false;
          break;
        }

        loopLineIds.push(nextEdge.lineId);
        currentKey = nextEdge.nextKey;
        if (currentKey === startKey) break;
        if (loopKeys.includes(currentKey)) {
          isValid = false;
          break;
        }
        loopKeys.push(currentKey);
        incomingLineId = nextEdge.lineId;
      }

      if (!isValid || loopKeys.length < 3) return;

      const signature = [...loopKeys].sort().join('|');
      if (loops.some((loop) => loop.signature === signature)) {
        loopLineIds.forEach((id) => visitedLines.add(id));
        return;
      }

      const points = loopKeys.map((key) => nodeMap.get(key).point);
      const area = points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length];
        return sum + (point.x * next.y - next.x * point.y);
      }, 0) / 2;
      if (Math.abs(area) < 1) return;

      loopLineIds.forEach((id) => visitedLines.add(id));
      loops.push({
        id: `loop-${loops.length + 1}`,
        signature,
        points,
        lineIds: [...new Set(loopLineIds)],
      });
    });
  });

  return loops;
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
  const loops = getClosedLineLoops();
  loops.forEach((loop) => {
    layer.appendChild(createSvgEl('polygon', {
      points: loop.points.map((point) => `${point.x},${point.y}`).join(' '),
      class: 'derived-loop',
      'data-loop-id': loop.id,
    }));
  });

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
        class: 'line-hit-area',
        'data-shape-id': shape.id,
      }));
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
  const selected = appState.project.selection;
  if (!selected) return;

  if (selected.type === 'loop') {
    const loop = getClosedLineLoops().find((item) => item.id === selected.id);
    if (!loop) return;
    layer.appendChild(createSvgEl('polygon', {
      points: loop.points.map((point) => `${point.x},${point.y}`).join(' '),
      class: 'selection-outline loop-selection',
    }));
    return;
  }

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

    const rotateHandle = { x: (corners.nw.x + corners.ne.x) / 2, y: (corners.nw.y + corners.ne.y) / 2 - 42 };
    layer.appendChild(createSvgEl('line', {
      x1: (corners.nw.x + corners.ne.x) / 2,
      y1: (corners.nw.y + corners.ne.y) / 2,
      x2: rotateHandle.x,
      y2: rotateHandle.y,
      class: 'handle-link',
    }));
    layer.appendChild(createSvgEl('circle', {
      cx: rotateHandle.x,
      cy: rotateHandle.y,
      r: 10,
      class: 'rotate-handle',
      'data-handle': 'rotate',
      'data-shape-id': shape.id,
    }));

    [
      ['resize-nw', corners.nw],
      ['resize-ne', corners.ne],
      ['resize-se', corners.se],
      ['resize-sw', corners.sw],
    ].forEach(([handle, point]) => {
      layer.appendChild(createSvgEl('circle', {
        cx: point.x,
        cy: point.y,
        r: 9,
        class: 'resize-handle',
        'data-handle': handle,
        'data-shape-id': shape.id,
      }));
    });
  }

  if (shape.type === 'line') {
    layer.appendChild(createSvgEl('line', {
      x1: shape.x1,
      y1: shape.y1,
      x2: shape.x2,
      y2: shape.y2,
      class: 'selection-outline',
    }));

    const centerX = (shape.x1 + shape.x2) / 2;
    const centerY = (shape.y1 + shape.y2) / 2;
    const dx = shape.x2 - shape.x1;
    const dy = shape.y2 - shape.y1;
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const rotateHandle = { x: centerX + nx * 42, y: centerY + ny * 42 };

    layer.appendChild(createSvgEl('line', {
      x1: centerX,
      y1: centerY,
      x2: rotateHandle.x,
      y2: rotateHandle.y,
      class: 'handle-link',
    }));
    layer.appendChild(createSvgEl('circle', {
      cx: rotateHandle.x,
      cy: rotateHandle.y,
      r: 10,
      class: 'rotate-handle',
      'data-handle': 'rotate',
      'data-shape-id': shape.id,
    }));

    [
      ['endpoint-start', { x: shape.x1, y: shape.y1 }],
      ['endpoint-end', { x: shape.x2, y: shape.y2 }],
    ].forEach(([handle, point]) => {
      layer.appendChild(createSvgEl('circle', {
        cx: point.x,
        cy: point.y,
        r: 9,
        class: 'line-end-handle',
        'data-handle': handle,
        'data-shape-id': shape.id,
      }));
    });
  }
}
