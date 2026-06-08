const video = document.querySelector("#webcam");
const puzzleStage = document.querySelector("#puzzleStage");
const slotLayer = document.querySelector("#slotLayer");
const piecesLayer = document.querySelector("#piecesLayer");
const statusText = document.querySelector("#statusText");
const titleScreen = document.querySelector("#titleScreen");
const launchButton = document.querySelector("#launchButton");

let stream;
let animationFrame;
let pieces = [];
let slots = [];
let board = { x: 0, y: 0, width: 0, height: 0 };
let draggedPiece;
let dragOffset = { x: 0, y: 0 };
let activePointerId;
let roundIndex = 0;
let finalComplete = false;
const rounds = [
  // { rows: 3, cols: 4, shape: "jigsaw" },
  { rows: 10, cols: 10, shape: "rect" }
];

async function startWebcam() {
  try {
    launchButton.disabled = true;
    statusText.textContent = "Requesting camera...";
    statusText.classList.remove("is-hidden");
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();
    roundIndex = 0;
    finalComplete = false;
    launchCurrentRound();
  } catch (error) {
    statusText.textContent = "Camera permission needed. Refresh to try again.";
    launchButton.disabled = false;
    console.error(error);
  }
}

function stopWebcam() {
  cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
  activePointerId = undefined;
  draggedPiece = undefined;
  finalComplete = false;
  pieces = [];
  slots = [];
  piecesLayer.innerHTML = "";
  slotLayer.innerHTML = "";

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = undefined;
  }

  video.srcObject = null;
  showTitleScreen("Practice");
  statusText.textContent = "Ready";
}

function launchCurrentRound() {
  titleScreen.classList.add("is-hidden");
  statusText.classList.remove("is-hidden");
  launchButton.disabled = false;
  statusText.textContent = roundLabel();
  cancelAnimationFrame(animationFrame);
  createPuzzle();
  drawLoop();
}

function createPuzzle() {
  const { rows, cols } = rounds[roundIndex];
  const isRectRound = rounds[roundIndex].shape === "rect";
  board = getBoardRect();
  pieces = [];
  slots = [];
  slotLayer.innerHTML = "";
  piecesLayer.innerHTML = "";

  const pieceWidth = board.width / cols;
  const pieceHeight = board.height / rows;
  const tabSize = isRectRound ? 0 : Math.min(pieceWidth, pieceHeight) * 0.18;
  const edges = createEdges(rows, cols);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const targetX = board.x + col * pieceWidth;
      const targetY = board.y + row * pieceHeight;
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.style.left = `${targetX}px`;
      slot.style.top = `${targetY}px`;
      slot.style.width = `${pieceWidth}px`;
      slot.style.height = `${pieceHeight}px`;
      slotLayer.append(slot);
      const slotData = {
        element: slot,
        row,
        col,
        x: targetX - tabSize,
        y: targetY - tabSize,
        occupiedBy: undefined
      };
      slots.push(slotData);

      const canvas = document.createElement("canvas");
      canvas.className = "piece";
      canvas.width = Math.round(pieceWidth + tabSize * 2);
      canvas.height = Math.round(pieceHeight + tabSize * 2);
      canvas.style.width = `${pieceWidth + tabSize * 2}px`;
      canvas.style.height = `${pieceHeight + tabSize * 2}px`;
      piecesLayer.append(canvas);

      const piece = {
        canvas,
        ctx: canvas.getContext("2d"),
        row,
        col,
        rows,
        cols,
        edges: {
          top: edges.horizontal[row][col],
          right: edges.vertical[row][col + 1],
          bottom: edges.horizontal[row + 1][col],
          left: edges.vertical[row][col]
        },
        pieceWidth,
        pieceHeight,
        tabSize,
        targetX: targetX - tabSize,
        targetY: targetY - tabSize,
        assignedSlot: slotData,
        x: 0,
        y: 0,
        placed: false,
        slot
      };

      pieces.push(piece);
      canvas.addEventListener("pointerdown", (event) => startDrag(event, piece));
    }
  }

  if (isRectRound) {
    assignPiecesToRandomSlots();
  } else {
    scramblePieces();
  }
  updateStats();
}

function createEdges(rows, cols) {
  const horizontal = Array.from({ length: rows + 1 }, () => Array(cols).fill(0));
  const vertical = Array.from({ length: rows }, () => Array(cols + 1).fill(0));

  for (let row = 1; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      horizontal[row][col] = hash(row * 17.17 + col * 31.31) > 0.5 ? 1 : -1;
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 1; col < cols; col += 1) {
      vertical[row][col] = hash(row * 23.23 + col * 43.43) > 0.5 ? 1 : -1;
    }
  }

  return { horizontal, vertical };
}

function scramblePieces() {
  if (!pieces.length) return;

  const stageRect = puzzleStage.getBoundingClientRect();
  for (const piece of pieces) {
    piece.placed = false;
    if (piece.assignedSlot) piece.assignedSlot.occupiedBy = undefined;
    piece.slot.classList.remove("is-filled");
    piece.canvas.classList.remove("is-placed");

    let x;
    let y;
    let attempts = 0;
    do {
      x = randomBetween(18, stageRect.width - piece.pieceWidth - piece.tabSize * 2 - 18);
      y = randomBetween(18, stageRect.height - piece.pieceHeight - piece.tabSize * 2 - 18);
      attempts += 1;
    } while (isNearTarget(piece, x, y) && attempts < 20);

    movePiece(piece, x, y);
  }

  shuffleZOrder();
  statusText.textContent = "Puzzle scrambled";
  updateStats();
}

function assignPiecesToRandomSlots() {
  const shuffledSlots = [...slots].sort(() => Math.random() - 0.5);

  pieces.forEach((piece, index) => {
    const slot = shuffledSlots[index];
    piece.placed = true;
    piece.assignedSlot = slot;
    slot.occupiedBy = piece;
    slot.element.classList.add("is-filled");
    piece.canvas.classList.add("is-placed");
    piece.canvas.style.zIndex = "2";
    movePiece(piece, slot.x, slot.y);
  });

  statusText.textContent = "Swap pieces to remix the grid";
}

function shuffleZOrder() {
  const shuffled = [...pieces].sort(() => Math.random() - 0.5);
  shuffled.forEach((piece, index) => {
    piece.canvas.style.zIndex = String(index + 2);
  });
}

function startDrag(event, piece) {
  if (!stream) return;
  if (piece.placed && rounds[roundIndex].shape === "jigsaw") return;

  event.preventDefault();
  piece.dragOriginSlot = piece.assignedSlot;
  if (piece.placed && rounds[roundIndex].shape !== "rect") {
    piece.placed = false;
    if (piece.assignedSlot) {
      piece.assignedSlot.occupiedBy = undefined;
      piece.assignedSlot.element.classList.remove("is-filled");
    }
    piece.canvas.classList.remove("is-placed");
  }

  activePointerId = event.pointerId;
  draggedPiece = piece;
  piece.canvas.setPointerCapture(event.pointerId);
  piece.canvas.classList.add("is-dragging");
  piece.canvas.style.zIndex = "80";

  const stageRect = puzzleStage.getBoundingClientRect();
  dragOffset = {
    x: event.clientX - stageRect.left - piece.x,
    y: event.clientY - stageRect.top - piece.y
  };

  window.addEventListener("pointermove", dragPiece);
  window.addEventListener("pointerup", endDrag);
}

function dragPiece(event) {
  if (!draggedPiece || event.pointerId !== activePointerId) return;

  const stageRect = puzzleStage.getBoundingClientRect();
  const x = event.clientX - stageRect.left - dragOffset.x;
  const y = event.clientY - stageRect.top - dragOffset.y;
  movePiece(draggedPiece, x, y);
}

function endDrag(event) {
  if (!draggedPiece || event.pointerId !== activePointerId) return;

  draggedPiece.canvas.classList.remove("is-dragging");
  const snapDistance = Math.min(draggedPiece.pieceWidth, draggedPiece.pieceHeight) * 0.33;
  const targetSlot = getSnapSlot(draggedPiece, snapDistance);

  if (targetSlot) {
    if (rounds[roundIndex].shape === "rect") {
      swapRectPieceIntoSlot(draggedPiece, targetSlot);
    } else {
      movePiece(draggedPiece, targetSlot.x, targetSlot.y);
      draggedPiece.placed = true;
      draggedPiece.assignedSlot = targetSlot;
      targetSlot.occupiedBy = draggedPiece;
      draggedPiece.canvas.classList.add("is-placed");
      targetSlot.element.classList.add("is-filled");
      draggedPiece.canvas.style.zIndex = "1";
      statusText.textContent = "Piece locked";
    }
  } else if (rounds[roundIndex].shape === "rect" && draggedPiece.dragOriginSlot) {
    movePiece(draggedPiece, draggedPiece.dragOriginSlot.x, draggedPiece.dragOriginSlot.y);
    draggedPiece.placed = true;
    draggedPiece.canvas.classList.add("is-placed");
    draggedPiece.canvas.style.zIndex = "2";
    draggedPiece.dragOriginSlot = undefined;
  }

  updateStats();
  if (rounds[roundIndex].shape === "jigsaw" && pieces.every((piece) => piece.placed)) {
    completeRound();
  }

  draggedPiece = undefined;
  activePointerId = undefined;
  window.removeEventListener("pointermove", dragPiece);
  window.removeEventListener("pointerup", endDrag);
}

function swapRectPieceIntoSlot(piece, targetSlot) {
  const originSlot = piece.dragOriginSlot || piece.assignedSlot;
  const displacedPiece = targetSlot.occupiedBy === piece ? undefined : targetSlot.occupiedBy;

  if (displacedPiece && originSlot && originSlot !== targetSlot) {
    displacedPiece.assignedSlot = originSlot;
    originSlot.occupiedBy = displacedPiece;
    originSlot.element.classList.add("is-filled");
    movePiece(displacedPiece, originSlot.x, originSlot.y);
    displacedPiece.canvas.classList.add("is-placed");
    displacedPiece.canvas.style.zIndex = "2";
  }

  if (originSlot && originSlot !== targetSlot && !displacedPiece) {
    originSlot.occupiedBy = undefined;
    originSlot.element.classList.remove("is-filled");
  }

  targetSlot.occupiedBy = piece;
  targetSlot.element.classList.add("is-filled");
  piece.assignedSlot = targetSlot;
  piece.placed = true;
  piece.dragOriginSlot = undefined;
  piece.canvas.classList.add("is-placed");
  piece.canvas.style.zIndex = "2";
  movePiece(piece, targetSlot.x, targetSlot.y);
  statusText.textContent = "Pieces swapped";
}

function movePiece(piece, x, y) {
  piece.x = clamp(x, -piece.tabSize, puzzleStage.clientWidth - piece.pieceWidth - piece.tabSize);
  piece.y = clamp(y, -piece.tabSize, puzzleStage.clientHeight - piece.pieceHeight - piece.tabSize);
  piece.canvas.style.left = `${piece.x}px`;
  piece.canvas.style.top = `${piece.y}px`;
}

function getSnapSlot(piece, snapDistance) {
  if (rounds[roundIndex].shape === "jigsaw") {
    const distance = Math.hypot(piece.x - piece.targetX, piece.y - piece.targetY);
    return distance < snapDistance ? piece.assignedSlot : undefined;
  }

  let bestSlot;
  let bestDistance = Infinity;
  for (const slot of slots) {
    const distance = Math.hypot(piece.x - slot.x, piece.y - slot.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestSlot = slot;
    }
  }

  return bestDistance < snapDistance ? bestSlot : undefined;
}

function drawLoop() {
  if (!stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    animationFrame = requestAnimationFrame(drawLoop);
    return;
  }

  for (const piece of pieces) {
    drawPiece(piece);
  }

  animationFrame = requestAnimationFrame(drawLoop);
}

function drawPiece(piece) {
  const { ctx, canvas, pieceWidth, pieceHeight, tabSize } = piece;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = pieceWidth + tabSize * 2;
  const cssHeight = pieceHeight + tabSize * 2;
  const neededWidth = Math.round(cssWidth * dpr);
  const neededHeight = Math.round(cssHeight * dpr);

  if (canvas.width !== neededWidth || canvas.height !== neededHeight) {
    canvas.width = neededWidth;
    canvas.height = neededHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.save();
  drawPiecePath(ctx, piece, tabSize, tabSize);
  ctx.clip();
  drawVideoCrop(ctx, piece, cssWidth, cssHeight);
  drawPieceMaterial(ctx, piece, tabSize, cssWidth, cssHeight);
  ctx.restore();

}

function drawPieceMaterial(targetCtx, piece, tabSize, drawWidth, drawHeight) {
  const edgeScale = Math.min(piece.pieceWidth, piece.pieceHeight);
  targetCtx.save();
  drawPiecePath(targetCtx, piece, tabSize, tabSize);
  targetCtx.clip();

  const bevel = targetCtx.createLinearGradient(0, 0, drawWidth, drawHeight);
  bevel.addColorStop(0, "rgba(255, 255, 255, 0.34)");
  bevel.addColorStop(0.28, "rgba(255, 255, 255, 0.08)");
  bevel.addColorStop(0.62, "rgba(0, 0, 0, 0)");
  bevel.addColorStop(1, "rgba(0, 0, 0, 0.36)");
  targetCtx.globalCompositeOperation = "soft-light";
  targetCtx.fillStyle = bevel;
  targetCtx.fillRect(0, 0, drawWidth, drawHeight);

  const sheen = targetCtx.createLinearGradient(0, 0, drawWidth, 0);
  sheen.addColorStop(0, "rgba(255, 255, 255, 0)");
  sheen.addColorStop(0.5, "rgba(255, 255, 255, 0.16)");
  sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
  targetCtx.globalCompositeOperation = "screen";
  targetCtx.fillStyle = sheen;
  targetCtx.fillRect(drawWidth * 0.1, 0, drawWidth * 0.32, drawHeight);

  targetCtx.globalCompositeOperation = "source-over";
  targetCtx.lineJoin = "round";
  targetCtx.lineCap = "round";
  targetCtx.shadowColor = "rgba(0, 0, 0, 0.76)";
  targetCtx.shadowBlur = Math.max(8, edgeScale * 0.13);
  targetCtx.shadowOffsetX = Math.max(2, piece.pieceWidth * 0.035);
  targetCtx.shadowOffsetY = Math.max(3, piece.pieceHeight * 0.045);
  targetCtx.strokeStyle = "rgba(0, 0, 0, 0.18)";
  targetCtx.lineWidth = Math.max(1, edgeScale * 0.018);
  drawPiecePath(targetCtx, piece, tabSize, tabSize);
  targetCtx.stroke();

  targetCtx.shadowColor = "rgba(255, 255, 255, 0.56)";
  targetCtx.shadowBlur = Math.max(5, edgeScale * 0.07);
  targetCtx.shadowOffsetX = -Math.max(1, piece.pieceWidth * 0.02);
  targetCtx.shadowOffsetY = -Math.max(1, piece.pieceHeight * 0.02);
  targetCtx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  drawPiecePath(targetCtx, piece, tabSize, tabSize);
  targetCtx.stroke();

  drawUnevenEdgeDefinition(targetCtx, piece, tabSize, edgeScale);
  targetCtx.restore();
}

function drawUnevenEdgeDefinition(targetCtx, piece, tabSize, edgeScale) {
  targetCtx.save();
  targetCtx.lineCap = "round";
  targetCtx.lineJoin = "round";

  for (let pass = 0; pass < 3; pass += 1) {
    const offset = pass - 1;
    targetCtx.save();
    targetCtx.translate(
      sketchNoise(piece.row * 11 + piece.col * 17, pass, 3) * 0.9 + offset * 0.45,
      sketchNoise(piece.row * 13 + piece.col * 19, pass, 7) * 0.9 + offset * 0.35
    );
    targetCtx.strokeStyle = pass === 0 ? "rgba(0, 0, 0, 0.48)" : "rgba(255, 255, 255, 0.16)";
    targetCtx.lineWidth = Math.max(0.8, edgeScale * (pass === 0 ? 0.014 : 0.008));
    targetCtx.shadowColor = pass === 0 ? "rgba(0, 0, 0, 0.72)" : "rgba(255, 255, 255, 0.32)";
    targetCtx.shadowBlur = pass === 0 ? Math.max(4, edgeScale * 0.055) : Math.max(2, edgeScale * 0.025);
    targetCtx.shadowOffsetX = pass === 0 ? 1.4 : -0.8;
    targetCtx.shadowOffsetY = pass === 0 ? 1.8 : -0.8;
    drawPiecePath(targetCtx, piece, tabSize, tabSize);
    targetCtx.stroke();
    targetCtx.restore();
  }

  targetCtx.restore();
}

function drawVideoCrop(targetCtx, piece, drawWidth, drawHeight) {
  const sourcePieceWidth = video.videoWidth / piece.cols;
  const sourcePieceHeight = video.videoHeight / piece.rows;
  const sourceTabX = sourcePieceWidth * (piece.tabSize / piece.pieceWidth);
  const sourceTabY = sourcePieceHeight * (piece.tabSize / piece.pieceHeight);
  const sourceX = clamp(piece.col * sourcePieceWidth - sourceTabX, 0, video.videoWidth - 1);
  const sourceY = clamp(piece.row * sourcePieceHeight - sourceTabY, 0, video.videoHeight - 1);
  const sourceWidth = clamp(sourcePieceWidth + sourceTabX * 2, 1, video.videoWidth - sourceX);
  const sourceHeight = clamp(sourcePieceHeight + sourceTabY * 2, 1, video.videoHeight - sourceY);

  targetCtx.save();
  targetCtx.filter = "grayscale(1) contrast(1.08)";
  targetCtx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, drawWidth, drawHeight);
  targetCtx.restore();
}

function drawPiecePath(targetCtx, piece, offsetX, offsetY) {
  const w = piece.pieceWidth;
  const h = piece.pieceHeight;
  const t = piece.tabSize;
  targetCtx.beginPath();
  if (rounds[roundIndex].shape === "rect") {
    const uneven = Math.min(w, h) * 0.018;
    targetCtx.moveTo(offsetX + sketchNoise(piece.row, piece.col, 1) * uneven, offsetY);
    targetCtx.lineTo(offsetX + w, offsetY + sketchNoise(piece.row, piece.col, 2) * uneven);
    targetCtx.lineTo(offsetX + w + sketchNoise(piece.row, piece.col, 3) * uneven, offsetY + h);
    targetCtx.lineTo(offsetX + sketchNoise(piece.row, piece.col, 4) * uneven, offsetY + h + sketchNoise(piece.row, piece.col, 5) * uneven);
    targetCtx.closePath();
    return;
  }
  targetCtx.moveTo(offsetX, offsetY);
  drawEdge(targetCtx, offsetX, offsetY, offsetX + w, offsetY, piece.edges.top, t, "horizontal");
  drawEdge(targetCtx, offsetX + w, offsetY, offsetX + w, offsetY + h, piece.edges.right, t, "vertical");
  drawEdge(targetCtx, offsetX + w, offsetY + h, offsetX, offsetY + h, piece.edges.bottom, t, "horizontal");
  drawEdge(targetCtx, offsetX, offsetY + h, offsetX, offsetY, piece.edges.left, t, "vertical");
  targetCtx.closePath();
}

function drawEdge(targetCtx, x1, y1, x2, y2, tab, tabSize, orientation) {
  if (tab === 0) {
    targetCtx.lineTo(x2, y2);
    return;
  }

  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const normalSign = orientation === "horizontal" ? (dx > 0 ? -1 : 1) : (dy > 0 ? 1 : -1);
  const nx = -uy * tab * normalSign;
  const ny = ux * tab * normalSign;
  const start = 0.34;
  const end = 0.66;
  const p1 = pointOnLine(x1, y1, ux, uy, length * start);
  const p2 = pointOnLine(x1, y1, ux, uy, length * end);
  const mid = pointOnLine(x1, y1, ux, uy, length * 0.5);

  targetCtx.lineTo(p1.x, p1.y);
  targetCtx.bezierCurveTo(
    p1.x + ux * tabSize * 0.45,
    p1.y + uy * tabSize * 0.45,
    mid.x + nx * tabSize,
    mid.y + ny * tabSize,
    mid.x + nx * tabSize,
    mid.y + ny * tabSize
  );
  targetCtx.bezierCurveTo(
    mid.x + nx * tabSize,
    mid.y + ny * tabSize,
    p2.x - ux * tabSize * 0.45,
    p2.y - uy * tabSize * 0.45,
    p2.x,
    p2.y
  );
  targetCtx.lineTo(x2, y2);
}

function pointOnLine(x, y, ux, uy, distance) {
  return {
    x: x + ux * distance,
    y: y + uy * distance
  };
}

function getBoardRect() {
  const stageRect = puzzleStage.getBoundingClientRect();
  const videoRatio = video.videoWidth / video.videoHeight || 16 / 9;
  let width = stageRect.width * 0.72;
  let height = width / videoRatio;

  if (height > stageRect.height * 0.72) {
    height = stageRect.height * 0.72;
    width = height * videoRatio;
  }

  return {
    x: (stageRect.width - width) / 2,
    y: (stageRect.height - height) / 2,
    width,
    height
  };
}

function isNearTarget(piece, x, y) {
  return Math.hypot(x - piece.targetX, y - piece.targetY) < Math.min(piece.pieceWidth, piece.pieceHeight) * 0.45;
}

function updateStats() {
  const placed = pieces.filter((piece) => piece.placed).length;
  statusText.textContent = `${roundLabel()} · ${placed} / ${pieces.length} placed`;
}

function rebuildIfRunning() {
  if (!stream || finalComplete || !titleScreen.classList.contains("is-hidden")) return;
  cancelAnimationFrame(animationFrame);
  createPuzzle();
  drawLoop();
}

function completeRound() {
  if (roundIndex >= rounds.length - 1) {
    finalComplete = true;
    statusText.textContent = "Final puzzle complete";
    return;
  }

  roundIndex += 1;
  cancelAnimationFrame(animationFrame);
  statusText.classList.add("is-hidden");
  showTitleScreen("Create");
}

function roundLabel() {
  const round = rounds[roundIndex];
  return `Round ${roundIndex + 1}/${rounds.length} · ${round.rows} x ${round.cols}`;
}

function randomBetween(min, max) {
  return min + Math.random() * Math.max(0, max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hash(value) {
  return fract(Math.sin(value) * 43758.5453);
}

function fract(value) {
  return value - Math.floor(value);
}

function sketchNoise(index, pass, salt) {
  return (hash(index * 19.19 + pass * 53.53 + salt * 7.17) - 0.5) * 2;
}

function showTitleScreen(label) {
  launchButton.textContent = label;
  launchButton.disabled = false;
  titleScreen.classList.remove("is-hidden");
  const poster = titleScreen.querySelector(".poster");
  poster.style.animation = "none";
  void poster.offsetWidth;
  poster.style.animation = "";
  for (const animated of titleScreen.querySelectorAll(".poster span, .launch-button")) {
    animated.style.animation = "none";
    void animated.offsetWidth;
    animated.style.animation = "";
  }
  titleScreen.classList.remove("is-hidden");
}

function handleLaunch() {
  if (stream) {
    launchCurrentRound();
  } else {
    startWebcam();
  }
}

window.addEventListener("resize", rebuildIfRunning);
launchButton.addEventListener("click", handleLaunch);
