const svg = document.getElementById('floorCanvas');
const wrapper = document.getElementById('canvasWrapper');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const deleteBtn = document.getElementById('deleteBtn');
const propertyBar = document.getElementById('propertyBar');
const propWidth = document.getElementById('propWidth');
const propHeight = document.getElementById('propHeight');
const propLength = document.getElementById('propLength');
const propRotation = document.getElementById('propRotation');
const lineLengthGroup = document.getElementById('lineLengthGroup');
const applyPropsBtn = document.getElementById('applyPropsBtn');

const MAX_HISTORY = 10;
const MM_TO_PX = 0.2;

let elements = [];
let selectedId = null;
let undoStack = [];
let redoStack = [];
let toolBeingDragged = null;
let pan = { x: 0, y: 0, scale: 1 };
let interaction = null;
let pinchInfo = null;
let nextId = 1;

function uid() {
  return `el-${nextId++}`;
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshot() {
  return JSON.stringify({ elements, selectedId, pan, nextId });
}

function restore(stateString) {
  const state = JSON.parse(stateString);
  elements = state.elements || [];
  selectedId = state.selectedId || null;
  pan = state.pan || { x: 0, y: 0, scale: 1 };
  nextId = state.nextId || 1;
  render();
}

function saveState() {
  undoStack.push(snapshot());
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  undoBtn.disabled = undoStack.length <= 1;
  redoBtn.disabled = redoStack.length === 0;
}

function undo() {
  if (undoStack.length <= 1) return;
  const current = undoStack.pop();
  redoStack.push(current);
  const previous = undoStack[undoStack.length - 1];
  restore(previous);
  updateUndoRedoButtons();
}

function redo() {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  undoStack.push(next);
  restore(next);
  updateUndoRedoButtons();
}

function getSelected() {
  return elements.find(el => el.id === selectedId) || null;
}

function createElement(type, x, y) {
  if (type === 'rect') {
    return { id: uid(), type, x, y, width: 2000, height: 1500, rotation: 0 };
  }
  if (type === 'line') {
    return { id: uid(), type, x1: x - 750, y1: y, x2: x + 750, y2: y, rotation: 0 };
  }
  if (type === 'door') {
    return { id: uid(), type, x, y, width: 900, height: 120, rotation: 0 };
  }
  return { id: uid(), type: 'doubleDoor', x, y, width: 1600, height: 120, rotation: 0 };
}

function mm(value) {
  return Math.round(value);
}

function toPx(mmValue) {
  return mmValue * MM_TO_PX;
}

function fromPx(pxValue) {
  return pxValue / MM_TO_PX;
}

function applyViewBox() {
  svg.setAttribute('viewBox', `${pan.x} ${pan.y} ${1400 / pan.scale} ${900 / pan.scale}`);
}

function worldPoint(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * (1400 / pan.scale) + pan.x;
  const y = ((clientY - rect.top) / rect.height) * (900 / pan.scale) + pan.y;
  return { x, y };
}

function elementBounds(el) {
  if (el.type === 'line') {
    const minX = Math.min(el.x1, el.x2);
    const minY = Math.min(el.y1, el.y2);
    return { x: minX, y: minY, width: Math.abs(el.x2 - el.x1), height: Math.abs(el.y2 - el.y1) || 1 };
  }
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

function setSelection(id) {
  selectedId = id;
  const selected = getSelected();
  deleteBtn.disabled = !selected;
  if (!selected) {
    propertyBar.classList.add('hidden');
    render();
    return;
  }

  propertyBar.classList.remove('hidden');
  if (selected.type === 'line') {
    lineLengthGroup.classList.remove('hidden');
    const len = Math.hypot(selected.x2 - selected.x1, selected.y2 - selected.y1);
    propLength.value = mm(fromPx(len));
    propWidth.value = mm(fromPx(selected.x2 - selected.x1));
    propHeight.value = mm(fromPx(selected.y2 - selected.y1));
    propRotation.value = Math.round(Math.atan2(selected.y2 - selected.y1, selected.x2 - selected.x1) * 180 / Math.PI);
  } else {
    lineLengthGroup.classList.add('hidden');
    propWidth.value = mm(selected.width);
    propHeight.value = mm(selected.height);
    propRotation.value = selected.rotation || 0;
  }
  render();
}

function bringSelectableOrder() {
  elements.sort((a, b) => {
    const aArea = (a.width || 0) * (a.height || 0);
    const bArea = (b.width || 0) * (b.height || 0);
    return bArea - aArea;
  });
}

function render() {
  applyViewBox();
  svg.innerHTML = '';
  bringSelectableOrder();

  elements.forEach(el => {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.dataset.id = el.id;
    group.classList.add('shape-group');

    if (el.type === 'line') {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', el.x1);
      line.setAttribute('y1', el.y1);
      line.setAttribute('x2', el.x2);
      line.setAttribute('y2', el.y2);
      line.setAttribute('class', 'line-stroke');
      group.appendChild(line);

      if (selectedId === el.id) {
        const outline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        outline.setAttribute('x1', el.x1);
        outline.setAttribute('y1', el.y1);
        outline.setAttribute('x2', el.x2);
        outline.setAttribute('y2', el.y2);
        outline.setAttribute('class', 'selected-outline');
        group.appendChild(outline);
      }

      const length = mm(fromPx(Math.hypot(el.x2 - el.x1, el.y2 - el.y1)));
      const tx = (el.x1 + el.x2) / 2;
      const ty = Math.max(el.y1, el.y2) + 28;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', tx);
      label.setAttribute('y', ty);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('class', 'dimension-text');
      label.textContent = `${length} mm`;
      group.appendChild(label);
    } else {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', el.x);
      rect.setAttribute('y', el.y);
      rect.setAttribute('width', toPx(el.width));
      rect.setAttribute('height', toPx(el.height));
      rect.setAttribute('class', el.type === 'rect' ? 'rect-fill' : 'door-fill');
      rect.setAttribute('transform', `rotate(${el.rotation || 0} ${el.x + toPx(el.width) / 2} ${el.y + toPx(el.height) / 2})`);
      group.appendChild(rect);

      if (el.type === 'door' || el.type === 'doubleDoor') {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const w = toPx(el.width);
        const h = toPx(el.height);
        const cx = el.x;
        const cy = el.y + h;
        if (el.type === 'door') {
          path.setAttribute('d', `M ${cx} ${cy} A ${w} ${w} 0 0 1 ${cx + w} ${cy - w}`);
        } else {
          const half = w / 2;
          path.setAttribute('d', `M ${cx + half} ${cy} A ${half} ${half} 0 0 0 ${cx} ${cy - half} M ${cx + half} ${cy} A ${half} ${half} 0 0 1 ${cx + w} ${cy - half}`);
        }
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#273647');
        path.setAttribute('stroke-width', '4');
        path.setAttribute('transform', `rotate(${el.rotation || 0} ${el.x + w / 2} ${el.y + h / 2})`);
        group.appendChild(path);
      }

      if (selectedId === el.id) {
        const outline = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        outline.setAttribute('x', el.x - 6);
        outline.setAttribute('y', el.y - 6);
        outline.setAttribute('width', toPx(el.width) + 12);
        outline.setAttribute('height', toPx(el.height) + 12);
        outline.setAttribute('class', 'selected-outline');
        outline.setAttribute('transform', `rotate(${el.rotation || 0} ${el.x + toPx(el.width) / 2} ${el.y + toPx(el.height) / 2})`);
        group.appendChild(outline);
      }

      if (selectedId === el.id && el.type === 'rect') {
        const topLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        topLabel.setAttribute('x', el.x + toPx(el.width) / 2);
        topLabel.setAttribute('y', el.y + 24);
        topLabel.setAttribute('text-anchor', 'middle');
        topLabel.setAttribute('class', 'dimension-text');
        topLabel.textContent = `${mm(el.width)} mm`;
        group.appendChild(topLabel);

        const rightLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        rightLabel.setAttribute('x', el.x + toPx(el.width) - 12);
        rightLabel.setAttribute('y', el.y + toPx(el.height) / 2);
        rightLabel.setAttribute('text-anchor', 'end');
        rightLabel.setAttribute('class', 'dimension-text');
        rightLabel.textContent = `${mm(el.height)} mm`;
        group.appendChild(rightLabel);
      }
    }

    svg.appendChild(group);
  });

  if (selectedId) drawHandles(getSelected());
}

function drawHandle(x, y, role, extraClass = '') {
  const handle = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  handle.setAttribute('x', x - 10);
  handle.setAttribute('y', y - 10);
  handle.setAttribute('width', 20);
  handle.setAttribute('height', 20);
  handle.setAttribute('rx', 2);
  handle.setAttribute('class', `handle ${extraClass}`.trim());
  handle.dataset.role = role;
  svg.appendChild(handle);
}

function drawHandles(el) {
  if (!el) return;
  if (el.type === 'line') {
    drawHandle(el.x1, el.y1, 'line-start');
    drawHandle(el.x2, el.y2, 'line-end');
    drawHandle((el.x1 + el.x2) / 2, (el.y1 + el.y2) / 2, 'line-mid');
    drawHandle(el.x2 + 24, el.y2 - 24, 'rotate', 'rotate');
    return;
  }

  const w = toPx(el.width);
  const h = toPx(el.height);
  drawHandle(el.x + w, el.y + h, 'resize-corner');
  drawHandle(el.x + w / 2, el.y, 'resize-top');
  drawHandle(el.x + w, el.y + h / 2, 'resize-right');
  drawHandle(el.x + w + 26, el.y + h / 2, 'rotate', 'rotate');
}

function selectFromPoint(point) {
  const groups = [...svg.querySelectorAll('.shape-group')].reverse();
  const hit = groups.find(group => {
    const id = group.dataset.id;
    const el = elements.find(item => item.id === id);
    if (!el) return false;
    if (el.type === 'line') {
      return distanceToSegment(point, { x: el.x1, y: el.y1 }, { x: el.x2, y: el.y2 }) < 12;
    }
    return point.x >= el.x && point.x <= el.x + toPx(el.width) && point.y >= el.y && point.y <= el.y + toPx(el.height);
  });

  setSelection(hit ? hit.dataset.id : null);
}

function distanceToSegment(p, a, b) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  return Math.hypot(p.x - proj.x, p.y - proj.y);
}

function startInteraction(pointer, point) {
  const targetRole = pointer.target?.dataset?.role;
  const selected = getSelected();

  if (targetRole && selected) {
    interaction = { kind: 'handle', role: targetRole, start: point, original: deepCopy(selected) };
    return;
  }

  const selectedNow = getSelected();
  if (selectedNow) {
    if (selectedNow.type === 'line' && distanceToSegment(point, { x: selectedNow.x1, y: selectedNow.y1 }, { x: selectedNow.x2, y: selectedNow.y2 }) < 14) {
      interaction = { kind: 'move-line', start: point, original: deepCopy(selectedNow) };
      return;
    }
    if (selectedNow.type !== 'line' && point.x >= selectedNow.x && point.x <= selectedNow.x + toPx(selectedNow.width) && point.y >= selectedNow.y && point.y <= selectedNow.y + toPx(selectedNow.height)) {
      interaction = { kind: 'move-rect', start: point, original: deepCopy(selectedNow) };
      return;
    }
  }

  interaction = { kind: 'pan', startClient: { x: pointer.clientX, y: pointer.clientY }, originalPan: { ...pan } };
}

function updateInteraction(pointer, point) {
  if (!interaction) return;
  const selected = getSelected();
  if (!selected && interaction.kind !== 'pan') return;

  if (interaction.kind === 'pan') {
    const dx = ((interaction.startClient.x - pointer.clientX) / svg.clientWidth) * (1400 / pan.scale);
    const dy = ((interaction.startClient.y - pointer.clientY) / svg.clientHeight) * (900 / pan.scale);
    pan.x = interaction.originalPan.x + dx;
    pan.y = interaction.originalPan.y + dy;
    render();
    return;
  }

  if (interaction.kind === 'move-rect') {
    const dx = point.x - interaction.start.x;
    const dy = point.y - interaction.start.y;
    selected.x = interaction.original.x + dx;
    selected.y = interaction.original.y + dy;
    render();
    return;
  }

  if (interaction.kind === 'move-line') {
    const dx = point.x - interaction.start.x;
    const dy = point.y - interaction.start.y;
    selected.x1 = interaction.original.x1 + dx;
    selected.y1 = interaction.original.y1 + dy;
    selected.x2 = interaction.original.x2 + dx;
    selected.y2 = interaction.original.y2 + dy;
    render();
    return;
  }

  if (interaction.kind === 'handle') {
    const role = interaction.role;
    if (selected.type === 'line') {
      if (role === 'line-start') {
        selected.x1 = point.x;
        selected.y1 = point.y;
      } else if (role === 'line-end') {
        selected.x2 = point.x;
        selected.y2 = point.y;
      } else if (role === 'line-mid') {
        const dx = point.x - interaction.start.x;
        const dy = point.y - interaction.start.y;
        selected.x1 = interaction.original.x1 + dx;
        selected.y1 = interaction.original.y1 + dy;
        selected.x2 = interaction.original.x2 + dx;
        selected.y2 = interaction.original.y2 + dy;
      } else if (role === 'rotate') {
        rotateLine90(selected, interaction.original);
      }
      render();
      return;
    }

    if (role === 'resize-corner') {
      selected.width = Math.max(100, fromPx(point.x - selected.x));
      selected.height = Math.max(100, fromPx(point.y - selected.y));
    } else if (role === 'resize-top') {
      const newY = Math.min(point.y, interaction.original.y + toPx(interaction.original.height) - 20);
      const bottomPx = interaction.original.y + toPx(interaction.original.height);
      selected.y = newY;
      selected.height = Math.max(100, fromPx(bottomPx - newY));
    } else if (role === 'resize-right') {
      selected.width = Math.max(100, fromPx(point.x - interaction.original.x));
    } else if (role === 'rotate') {
      selected.rotation = (((interaction.original.rotation || 0) + 90) % 360 + 360) % 360;
    }
    render();
  }
}

function rotateLine90(selected, original) {
  const cx = (original.x1 + original.x2) / 2;
  const cy = (original.y1 + original.y2) / 2;
  const dx = original.x2 - original.x1;
  const dy = original.y2 - original.y1;
  selected.x1 = cx + dy / 2;
  selected.y1 = cy - dx / 2;
  selected.x2 = cx - dy / 2;
  selected.y2 = cy + dx / 2;
}

function endInteraction() {
  if (!interaction) return;
  if (interaction.kind !== 'pan') {
    saveState();
    setSelection(selectedId);
  }
  interaction = null;
}

function applyProperties() {
  const selected = getSelected();
  if (!selected) return;

  if (selected.type === 'line') {
    const lengthMm = Math.max(1, Number(propLength.value || 1));
    const angleDeg = Number(propRotation.value || 0);
    const lengthPx = toPx(lengthMm);
    const angle = angleDeg * Math.PI / 180;
    const cx = (selected.x1 + selected.x2) / 2;
    const cy = (selected.y1 + selected.y2) / 2;
    const dx = Math.cos(angle) * lengthPx / 2;
    const dy = Math.sin(angle) * lengthPx / 2;
    selected.x1 = cx - dx;
    selected.y1 = cy - dy;
    selected.x2 = cx + dx;
    selected.y2 = cy + dy;
  } else {
    selected.width = Math.max(100, Number(propWidth.value || selected.width));
    selected.height = Math.max(100, Number(propHeight.value || selected.height));
    selected.rotation = Number(propRotation.value || 0);
  }

  saveState();
  setSelection(selected.id);
}

function deleteSelection() {
  if (!selectedId) return;
  elements = elements.filter(el => el.id !== selectedId);
  selectedId = null;
  saveState();
  setSelection(null);
}

function installDnD() {
  document.querySelectorAll('.tool-item').forEach(item => {
    item.addEventListener('dragstart', event => {
      toolBeingDragged = item.dataset.tool;
      event.dataTransfer.setData('text/plain', toolBeingDragged);
    });
  });

  wrapper.addEventListener('dragover', event => event.preventDefault());
  wrapper.addEventListener('drop', event => {
    event.preventDefault();
    const type = event.dataTransfer.getData('text/plain') || toolBeingDragged;
    if (!type) return;
    const point = worldPoint(event.clientX, event.clientY);
    const el = createElement(type, point.x, point.y);
    if (el.type !== 'line') {
      el.x -= toPx(el.width) / 2;
      el.y -= toPx(el.height) / 2;
    }
    elements.push(el);
    saveState();
    setSelection(el.id);
  });
}

function installPointerHandlers() {
  svg.addEventListener('pointerdown', event => {
    svg.setPointerCapture(event.pointerId);
    const point = worldPoint(event.clientX, event.clientY);
    const role = event.target?.dataset?.role;
    if (!role) {
      const before = selectedId;
      selectFromPoint(point);
      if (!selectedId && before) {
        interaction = null;
        return;
      }
    }
    startInteraction(event, point);
  });

  svg.addEventListener('pointermove', event => {
    const point = worldPoint(event.clientX, event.clientY);
    updateInteraction(event, point);
  });

  svg.addEventListener('pointerup', () => endInteraction());
  svg.addEventListener('pointercancel', () => endInteraction());

  svg.addEventListener('wheel', event => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    pan.scale = Math.max(0.4, Math.min(3, pan.scale * factor));
    render();
  }, { passive: false });

  wrapper.addEventListener('touchstart', event => {
    if (event.touches.length === 2) {
      event.preventDefault();
      const [a, b] = event.touches;
      pinchInfo = {
        startDistance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        startScale: pan.scale,
      };
    }
  }, { passive: false });

  wrapper.addEventListener('touchmove', event => {
    if (event.touches.length === 2 && pinchInfo) {
      event.preventDefault();
      const [a, b] = event.touches;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = distance / pinchInfo.startDistance;
      pan.scale = Math.max(0.4, Math.min(3, pinchInfo.startScale * ratio));
      render();
    }
  }, { passive: false });

  wrapper.addEventListener('touchend', () => {
    pinchInfo = null;
  });
}

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
deleteBtn.addEventListener('click', deleteSelection);
applyPropsBtn.addEventListener('click', applyProperties);

installDnD();
installPointerHandlers();
render();
saveState();
setSelection(null);
