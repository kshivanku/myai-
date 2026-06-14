import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.querySelector("#webcam");
const puzzleStage = document.querySelector("#puzzleStage");
const puzzleBackground = document.querySelector("#puzzleBackground");
const puzzleBackgroundCtx = puzzleBackground.getContext("2d");
const slotLayer = document.querySelector("#slotLayer");
const piecesLayer = document.querySelector("#piecesLayer");
const smileCanvas = document.querySelector("#smileCanvas");
const smileCtx = smileCanvas.getContext("2d");
const statusText = document.querySelector("#statusText");
const titleScreen = document.querySelector("#titleScreen");
const launchButton = document.querySelector("#launchButton");

let stream;
let animationFrame;
let pieces = [];
let slots = [];
let board = { x: 0, y: 0, width: 0, height: 0 };
let puzzleMaskBounds;
let puzzleMaskRadius = 0;
let puzzleMaskPoints = [];
let draggedPiece;
let dragOffset = { x: 0, y: 0 };
let activePointerId;
let roundIndex = 0;
let finalComplete = false;
let faceLandmarker;
let lastFaceVideoTime = -1;
let lastSmileLandmarks;
let pendingFacePuzzle = false;
const smileSourceCanvas = document.createElement("canvas");
const smileSourceCtx = smileSourceCanvas.getContext("2d", { willReadFrequently: true });
const faceOval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const rounds = [
  { rows: 4, cols: 8, shape: "jigsaw" }
];

loadFaceModel();

async function loadFaceModel() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numFaces: 1
    });
  } catch (error) {
    console.error(error);
  }
}

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
  puzzleMaskBounds = undefined;
  puzzleMaskRadius = 0;
  puzzleMaskPoints = [];
  piecesLayer.innerHTML = "";
  slotLayer.innerHTML = "";
  slotLayer.style.clipPath = "";

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
  pendingFacePuzzle = false;
  const faceLayout = getFacePuzzleLayout();
  if (!faceLayout) {
    pieces = [];
    slots = [];
    slotLayer.innerHTML = "";
    piecesLayer.innerHTML = "";
    puzzleMaskPoints = [];
    slotLayer.style.clipPath = "";
    pendingFacePuzzle = true;
    statusText.textContent = "Looking for face...";
    return;
  }

  board = faceLayout?.board || getBoardRect();
  puzzleMaskBounds = faceLayout?.board;
  puzzleMaskRadius = faceLayout ? Math.min(board.width, board.height) * 0.12 : 0;
  puzzleMaskPoints = faceLayout?.maskPoints || [];
  pieces = [];
  slots = [];
  slotLayer.innerHTML = "";
  piecesLayer.innerHTML = "";
  updateSlotLayerClip();

  const colTracks = createUniformTracks(cols, board.width);
  const rowTracks = createUniformTracks(rows, board.height);
  const edges = createEdges(rows, cols);
  const sourceCells = createOrderedSourceCells(rows, cols);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const sourceCell = sourceCells[row * cols + col];
      const pieceWidth = colTracks[col].size;
      const pieceHeight = rowTracks[row].size;
      const tabSize = isRectRound ? 0 : Math.min(pieceWidth, pieceHeight) * 0.18;
      const targetX = board.x + colTracks[col].start;
      const targetY = board.y + rowTracks[row].start;
      const targetRect = { x: targetX, y: targetY, width: pieceWidth, height: pieceHeight };
      if (puzzleMaskPoints.length >= 3 && !rectIntersectsPolygon(targetRect, puzzleMaskPoints)) {
        continue;
      }

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
        maskPointsLocal: getPieceMaskPointsLocal(targetX - tabSize, targetY - tabSize),
        sourceBounds: getPieceSourceBounds(
          sourceCell.row,
          sourceCell.col,
          rows,
          cols,
          faceLayout?.source,
          tabSize,
          pieceWidth,
          pieceHeight,
          rowTracks,
          colTracks
        ),
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
    arrangePiecesInTray();
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

function createUniformTracks(count, totalSize) {
  const size = totalSize / count;
  return Array.from({ length: count }, (_, index) => ({
    start: index * size,
    size
  }));
}

function createOrderedSourceCells(rows, cols) {
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({ row, col });
    }
  }

  return cells;
}

function scramblePieces() {
  if (!pieces.length) return;

  for (const piece of pieces) {
    piece.placed = false;
    if (piece.assignedSlot) piece.assignedSlot.occupiedBy = undefined;
    piece.slot.classList.remove("is-filled");
    piece.canvas.classList.remove("is-placed");

    let x;
    let y;
    let attempts = 0;
    do {
      ({ x, y } = getLoosePiecePosition(piece));
      attempts += 1;
    } while (isNearTarget(piece, x, y) && attempts < 20);

    movePiece(piece, x, y);
  }

  shuffleZOrder();
  statusText.textContent = "Puzzle scrambled";
  updateStats();
}

function arrangePiecesInTray() {
  if (!pieces.length) return;

  const trayBounds = getTrayBounds();
  const gap = 0;

  for (const piece of pieces) {
    piece.placed = false;
    if (piece.assignedSlot) piece.assignedSlot.occupiedBy = undefined;
    piece.slot.classList.remove("is-filled");
    piece.canvas.classList.remove("is-placed");
    piece.canvas.style.zIndex = "2";

    const x = trayBounds.x + piece.col * (piece.pieceWidth + gap);
    const y = trayBounds.y + piece.row * (piece.pieceHeight + gap);
    movePiece(piece, x, y);
  }

  statusText.textContent = "Pieces ready";
  updateStats();
}

function getTrayBounds() {
  const margin = 24;
  const { rows, cols } = rounds[roundIndex];
  const pieceWidth = board.width / cols;
  const pieceHeight = board.height / rows;
  const gap = 0;
  const width = cols * pieceWidth + (cols - 1) * gap;

  return {
    x: Math.max(margin, puzzleStage.clientWidth - width - margin),
    y: margin,
    width,
    height: rows * pieceHeight + (rows - 1) * gap
  };
}

function getLoosePiecePosition(piece) {
  const stageWidth = puzzleStage.clientWidth;
  const stageHeight = puzzleStage.clientHeight;
  const videoFrame = getVideoFrameRect();
  const pieceWidth = piece.pieceWidth + piece.tabSize * 2;
  const pieceHeight = piece.pieceHeight + piece.tabSize * 2;
  const framePad = Math.min(44, Math.max(18, Math.min(videoFrame.width, videoFrame.height) * 0.08));
  const blockedRect = {
    x: videoFrame.x - framePad,
    y: videoFrame.y - framePad,
    width: videoFrame.width + framePad * 2,
    height: videoFrame.height + framePad * 2
  };

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const x = randomBetween(18, stageWidth - pieceWidth - 18);
    const y = randomBetween(18, stageHeight - pieceHeight - 18);
    const pieceRect = { x, y, width: pieceWidth, height: pieceHeight };

    if (!rectsOverlap(pieceRect, blockedRect)) {
      return { x, y };
    }
  }

  return {
    x: randomBetween(18, stageWidth - pieceWidth - 18),
    y: randomBetween(18, stageHeight - pieceHeight - 18)
  };
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
  const snapDistance = Math.min(draggedPiece.pieceWidth, draggedPiece.pieceHeight) * 0.65;
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
  const pieceCenterX = piece.x + piece.pieceWidth / 2;
  const pieceCenterY = piece.y + piece.pieceHeight / 2;
  for (const slot of slots) {
    const slotCenterX = slot.x + piece.pieceWidth / 2;
    const slotCenterY = slot.y + piece.pieceHeight / 2;
    const distance = Math.hypot(pieceCenterX - slotCenterX, pieceCenterY - slotCenterY);
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

  drawPuzzleBackground();
  updateFaceLandmarks();
  drawSmilePreview();
  if (pendingFacePuzzle && lastSmileLandmarks) {
    createPuzzle();
  }

  for (const piece of pieces) {
    drawPiece(piece);
  }

  animationFrame = requestAnimationFrame(drawLoop);
}

function drawPuzzleBackground() {
  const width = puzzleStage.clientWidth;
  const height = puzzleStage.clientHeight;
  const videoFrame = getVideoFrameRect();
  const dpr = window.devicePixelRatio || 1;
  const neededWidth = Math.round(width * dpr);
  const neededHeight = Math.round(height * dpr);

  if (puzzleBackground.width !== neededWidth || puzzleBackground.height !== neededHeight) {
    puzzleBackground.width = neededWidth;
    puzzleBackground.height = neededHeight;
    puzzleBackgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  puzzleBackgroundCtx.clearRect(0, 0, width, height);
  puzzleBackgroundCtx.fillStyle = "#EBEAE4";
  puzzleBackgroundCtx.fillRect(0, 0, width, height);
  if (!video.videoWidth || !video.videoHeight) return;

  puzzleBackgroundCtx.save();
  roundedRectPath(puzzleBackgroundCtx, videoFrame.x, videoFrame.y, videoFrame.width, videoFrame.height, videoFrame.radius);
  puzzleBackgroundCtx.clip();
  drawVideoCoverAt(
    puzzleBackgroundCtx,
    videoFrame.x,
    videoFrame.y,
    videoFrame.width,
    videoFrame.height,
    getActiveVideoSource(videoFrame.width, videoFrame.height)
  );
  puzzleBackgroundCtx.restore();

  if (puzzleMaskBounds) {
    puzzleBackgroundCtx.fillStyle = "#000";
    drawPuzzleMaskPath(puzzleBackgroundCtx);
    puzzleBackgroundCtx.fill();
  }
}

function updateFaceLandmarks() {
  if (!faceLandmarker || !video.videoWidth || !video.videoHeight) return;
  if (video.currentTime === lastFaceVideoTime) return;

  lastFaceVideoTime = video.currentTime;
  lastSmileLandmarks = faceLandmarker.detectForVideo(video, performance.now()).faceLandmarks?.[0];
}

function drawSmilePreview() {
  const width = smileCanvas.clientWidth;
  const height = smileCanvas.clientHeight;
  if (!width || !height) return;

  if (smileCanvas.width !== width || smileCanvas.height !== height) {
    smileCanvas.width = width;
    smileCanvas.height = height;
    smileCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  smileCtx.clearRect(0, 0, width, height);
  smileCtx.fillStyle = "#050607";
  smileCtx.fillRect(0, 0, width, height);
  if (!video.videoWidth || !video.videoHeight) return;

  drawVideoCover(smileCtx, width, height);
  smileSourceCanvas.width = Math.round(width);
  smileSourceCanvas.height = Math.round(height);
  smileSourceCtx.clearRect(0, 0, width, height);
  drawVideoCover(smileSourceCtx, width, height);

  if (lastSmileLandmarks) {
    applySmileWarp(width, height, lastSmileLandmarks);
  } else {
    smileCtx.fillStyle = "rgba(255, 255, 255, 0.72)";
    smileCtx.font = "600 14px Inter, system-ui, sans-serif";
    smileCtx.fillText("Looking for face", 18, 28);
  }
}

function drawVideoCover(targetCtx, width, height, source = getVideoCoverSource(width, height)) {
  targetCtx.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, width, height);
}

function drawVideoCoverAt(targetCtx, x, y, width, height, source = getVideoCoverSource(width, height)) {
  targetCtx.drawImage(video, source.x, source.y, source.width, source.height, x, y, width, height);
}

function applySmileWarp(width, height, landmarks) {
  const leftCorner = mapVideoPointToSmile(landmarks[61], width, height);
  const rightCorner = mapVideoPointToSmile(landmarks[291], width, height);
  const upperLip = mapVideoPointToSmile(landmarks[13], width, height);
  const lowerLip = mapVideoPointToSmile(landmarks[14], width, height);
  const mouthCenter = {
    x: (leftCorner.x + rightCorner.x) / 2,
    y: (upperLip.y + lowerLip.y) / 2
  };
  const mouthWidth = Math.max(40, Math.abs(rightCorner.x - leftCorner.x));
  const radiusX = mouthWidth * 1.45;
  const radiusY = mouthWidth * 0.94;
  const lift = mouthWidth * 0.58;
  const source = smileSourceCtx.getImageData(0, 0, width, height);
  const output = smileCtx.getImageData(0, 0, width, height);

  for (let y = Math.max(0, Math.floor(mouthCenter.y - radiusY)); y < Math.min(height, Math.ceil(mouthCenter.y + radiusY)); y += 1) {
    for (let x = Math.max(0, Math.floor(mouthCenter.x - radiusX)); x < Math.min(width, Math.ceil(mouthCenter.x + radiusX)); x += 1) {
      const nx = (x - mouthCenter.x) / radiusX;
      const ny = (y - mouthCenter.y) / radiusY;
      const falloff = Math.max(0, 1 - nx * nx - ny * ny);
      if (falloff <= 0) continue;

      const cornerBias = Math.abs(nx) ** 1.08;
      const centerBias = Math.max(0, 1 - Math.abs(nx) * 1.25);
      const verticalWarp = (-lift * cornerBias + lift * 0.26 * centerBias) * falloff;
      const horizontalWarp = -Math.sign(nx) * mouthWidth * 0.14 * falloff;
      const sx = clamp(Math.round(x - horizontalWarp), 0, width - 1);
      const sy = clamp(Math.round(y - verticalWarp), 0, height - 1);
      const sourceIndex = (sy * width + sx) * 4;
      const targetIndex = (y * width + x) * 4;

      output.data[targetIndex] = source.data[sourceIndex];
      output.data[targetIndex + 1] = source.data[sourceIndex + 1];
      output.data[targetIndex + 2] = source.data[sourceIndex + 2];
      output.data[targetIndex + 3] = 255;
    }
  }

  smileCtx.putImageData(output, 0, 0);
}

function drawSmileGuide(leftCorner, rightCorner, mouthCenter, mouthWidth) {
  smileCtx.save();
  smileCtx.strokeStyle = "rgba(112, 214, 165, 0.72)";
  smileCtx.lineWidth = Math.max(2, mouthWidth * 0.025);
  smileCtx.lineCap = "round";
  smileCtx.shadowColor = "rgba(112, 214, 165, 0.6)";
  smileCtx.shadowBlur = 8;
  smileCtx.beginPath();
  smileCtx.moveTo(leftCorner.x, leftCorner.y - mouthWidth * 0.06);
  smileCtx.quadraticCurveTo(mouthCenter.x, mouthCenter.y + mouthWidth * 0.15, rightCorner.x, rightCorner.y - mouthWidth * 0.06);
  smileCtx.stroke();
  smileCtx.restore();
}

function mapVideoPointToSmile(point, width, height) {
  const source = getVideoCoverSource(width, height);
  const videoX = point.x * video.videoWidth;
  const videoY = point.y * video.videoHeight;

  return {
    x: ((videoX - source.x) / source.width) * width,
    y: ((videoY - source.y) / source.height) * height
  };
}

function getVideoCoverSource(width, height) {
  const videoRatio = video.videoWidth / video.videoHeight;
  const canvasRatio = width / height;
  let sourceWidth = video.videoWidth;
  let sourceHeight = video.videoHeight;
  let sourceX = 0;
  let sourceY = 0;

  if (videoRatio > canvasRatio) {
    sourceWidth = video.videoHeight * canvasRatio;
    sourceX = (video.videoWidth - sourceWidth) / 2;
  } else {
    sourceHeight = video.videoWidth / canvasRatio;
    sourceY = (video.videoHeight - sourceHeight) / 2;
  }

  return {
    x: sourceX,
    y: sourceY,
    width: sourceWidth,
    height: sourceHeight
  };
}

function getActiveVideoSource(width, height) {
  if (!lastSmileLandmarks || !video.videoWidth || !video.videoHeight) {
    return getVideoCoverSource(width, height);
  }

  const facePoints = getFaceVideoPoints();
  if (facePoints.length < 8) return getVideoCoverSource(width, height);

  const faceBounds = getBounds(facePoints);
  const faceCenter = {
    x: faceBounds.x + faceBounds.width / 2,
    y: faceBounds.y + faceBounds.height / 2
  };
  const targetFaceCoverage = 0.5;
  const canvasRatio = width / height;
  let sourceHeight = Math.max(faceBounds.height / targetFaceCoverage, faceBounds.width / canvasRatio / targetFaceCoverage);
  let sourceWidth = sourceHeight * canvasRatio;

  if (sourceWidth > video.videoWidth) {
    sourceWidth = video.videoWidth;
    sourceHeight = sourceWidth / canvasRatio;
  }

  if (sourceHeight > video.videoHeight) {
    sourceHeight = video.videoHeight;
    sourceWidth = sourceHeight * canvasRatio;
  }

  return clampSourceAroundCenter(faceCenter, sourceWidth, sourceHeight);
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
  clipPieceToLocalMask(ctx, piece);
  drawVideoCrop(ctx, piece, cssWidth, cssHeight);
  drawPieceMaterial(ctx, piece, tabSize, cssWidth, cssHeight);
  ctx.restore();

}

function drawPieceMaterial(targetCtx, piece, tabSize, drawWidth, drawHeight) {
  const edgeScale = Math.min(piece.pieceWidth, piece.pieceHeight);
  targetCtx.save();
  drawPiecePath(targetCtx, piece, tabSize, tabSize);
  targetCtx.clip();
  clipPieceToLocalMask(targetCtx, piece);

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
  const source = piece.sourceBounds || getPieceSourceBounds(piece.row, piece.col, piece.rows, piece.cols);

  targetCtx.save();
  targetCtx.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, drawWidth, drawHeight);
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

function getFacePuzzleLayout() {
  if (!lastSmileLandmarks || !video.videoWidth || !video.videoHeight) return undefined;

  const videoFrame = getVideoFrameRect();
  if (!videoFrame.width || !videoFrame.height) return undefined;

  const videoSource = getActiveVideoSource(videoFrame.width, videoFrame.height);
  const videoPoints = getFaceVideoPoints();

  if (videoPoints.length < 8) return undefined;

  const visiblePoints = videoPoints.map((point) => ({
    x: videoFrame.x + ((point.x - videoSource.x) / videoSource.width) * videoFrame.width,
    y: videoFrame.y + ((point.y - videoSource.y) / videoSource.height) * videoFrame.height
  }));
  const maskPoints = clampPointsToRect(expandPointsFromCenter(visiblePoints, 1.08, 1.06), videoFrame);

  const displayBounds = expandBounds(getBounds(maskPoints), 0.08, 0.06);
  const displayBoard = clampBoundsToRect(displayBounds, videoFrame);
  const localBoard = {
    x: displayBoard.x - videoFrame.x,
    y: displayBoard.y - videoFrame.y,
    width: displayBoard.width,
    height: displayBoard.height
  };
  const sourceBounds = mapStageBoundsToVideo(localBoard, videoSource, videoFrame.width, videoFrame.height);

  return {
    board: displayBoard,
    maskPoints,
    source: clampBounds(sourceBounds, video.videoWidth, video.videoHeight)
  };
}

function getVideoFrameRect() {
  const margin = 32;
  const size = Math.min(400, Math.max(160, puzzleStage.clientWidth - margin), Math.max(160, puzzleStage.clientHeight - margin));

  return {
    x: (puzzleStage.clientWidth - size) / 2,
    y: (puzzleStage.clientHeight - size) / 2,
    width: size,
    height: size,
    radius: 28
  };
}

function mapStageBoundsToVideo(bounds, videoSource, stageWidth, stageHeight) {
  return {
    x: videoSource.x + (bounds.x / stageWidth) * videoSource.width,
    y: videoSource.y + (bounds.y / stageHeight) * videoSource.height,
    width: (bounds.width / stageWidth) * videoSource.width,
    height: (bounds.height / stageHeight) * videoSource.height
  };
}

function getFaceVideoPoints() {
  if (!lastSmileLandmarks) return [];

  return faceOval
    .map((index) => lastSmileLandmarks[index])
    .filter(Boolean)
    .map((point) => ({
      x: point.x * video.videoWidth,
      y: point.y * video.videoHeight
    }));
}

function clampSourceAroundCenter(center, width, height) {
  const x = clamp(center.x - width / 2, 0, Math.max(0, video.videoWidth - width));
  const y = clamp(center.y - height / 2, 0, Math.max(0, video.videoHeight - height));

  return { x, y, width, height };
}

function getPieceSourceBounds(row, col, rows, cols, sourceBounds, tabSize = 0, pieceWidth = 1, pieceHeight = 1, rowTracks, colTracks) {
  const source = sourceBounds || {
    x: 0,
    y: 0,
    width: video.videoWidth,
    height: video.videoHeight
  };
  const colTrack = colTracks?.[col];
  const rowTrack = rowTracks?.[row];
  const totalTrackWidth = colTracks ? colTracks[colTracks.length - 1].start + colTracks[colTracks.length - 1].size : 1;
  const totalTrackHeight = rowTracks ? rowTracks[rowTracks.length - 1].start + rowTracks[rowTracks.length - 1].size : 1;
  const cellX = colTrack ? source.x + (colTrack.start / totalTrackWidth) * source.width : source.x + col * (source.width / cols);
  const cellY = rowTrack ? source.y + (rowTrack.start / totalTrackHeight) * source.height : source.y + row * (source.height / rows);
  const cellWidth = colTrack ? (colTrack.size / totalTrackWidth) * source.width : source.width / cols;
  const cellHeight = rowTrack ? (rowTrack.size / totalTrackHeight) * source.height : source.height / rows;
  const sourceTabX = cellWidth * (tabSize / pieceWidth);
  const sourceTabY = cellHeight * (tabSize / pieceHeight);
  const x = clamp(cellX - sourceTabX, source.x, source.x + source.width);
  const y = clamp(cellY - sourceTabY, source.y, source.y + source.height);
  const right = clamp(cellX + cellWidth + sourceTabX, x, source.x + source.width);
  const bottom = clamp(cellY + cellHeight + sourceTabY, y, source.y + source.height);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y
  };
}

function updateSlotLayerClip() {
  if (puzzleMaskPoints.length >= 3) {
    slotLayer.style.clipPath = `polygon(${puzzleMaskPoints.map((point) => `${point.x}px ${point.y}px`).join(", ")})`;
    return;
  }

  if (!puzzleMaskBounds) {
    slotLayer.style.clipPath = "";
    return;
  }

  const right = puzzleStage.clientWidth - puzzleMaskBounds.x - puzzleMaskBounds.width;
  const bottom = puzzleStage.clientHeight - puzzleMaskBounds.y - puzzleMaskBounds.height;
  slotLayer.style.clipPath = `inset(${puzzleMaskBounds.y}px ${right}px ${bottom}px ${puzzleMaskBounds.x}px round ${puzzleMaskRadius}px)`;
}

function drawPuzzleMaskPath(targetCtx) {
  if (puzzleMaskPoints.length >= 3) {
    targetCtx.beginPath();
    targetCtx.moveTo(puzzleMaskPoints[0].x, puzzleMaskPoints[0].y);
    for (let index = 1; index < puzzleMaskPoints.length; index += 1) {
      targetCtx.lineTo(puzzleMaskPoints[index].x, puzzleMaskPoints[index].y);
    }
    targetCtx.closePath();
    return;
  }

  roundedRectPath(targetCtx, puzzleMaskBounds.x, puzzleMaskBounds.y, puzzleMaskBounds.width, puzzleMaskBounds.height, puzzleMaskRadius);
}

function getPieceMaskPointsLocal(pieceX, pieceY) {
  if (puzzleMaskPoints.length < 3) return [];

  return puzzleMaskPoints.map((point) => ({
    x: point.x - pieceX,
    y: point.y - pieceY
  }));
}

function clipPieceToLocalMask(targetCtx, piece) {
  if (!piece.maskPointsLocal?.length) return;

  targetCtx.beginPath();
  targetCtx.moveTo(piece.maskPointsLocal[0].x, piece.maskPointsLocal[0].y);
  for (let index = 1; index < piece.maskPointsLocal.length; index += 1) {
    targetCtx.lineTo(piece.maskPointsLocal[index].x, piece.maskPointsLocal[index].y);
  }
  targetCtx.closePath();
  targetCtx.clip();
}

function clipPieceToPuzzleMask(targetCtx, piece) {
  if (puzzleMaskPoints.length >= 3) {
    targetCtx.beginPath();
    targetCtx.moveTo(puzzleMaskPoints[0].x - piece.x, puzzleMaskPoints[0].y - piece.y);
    for (let index = 1; index < puzzleMaskPoints.length; index += 1) {
      targetCtx.lineTo(puzzleMaskPoints[index].x - piece.x, puzzleMaskPoints[index].y - piece.y);
    }
    targetCtx.closePath();
    targetCtx.clip();
    return;
  }

  if (puzzleMaskBounds) {
    roundedRectPath(
      targetCtx,
      puzzleMaskBounds.x - piece.x,
      puzzleMaskBounds.y - piece.y,
      puzzleMaskBounds.width,
      puzzleMaskBounds.height,
      puzzleMaskRadius
    );
    targetCtx.clip();
  }
}

function roundedRectPath(targetCtx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  targetCtx.beginPath();
  targetCtx.moveTo(x + r, y);
  targetCtx.lineTo(x + width - r, y);
  targetCtx.quadraticCurveTo(x + width, y, x + width, y + r);
  targetCtx.lineTo(x + width, y + height - r);
  targetCtx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  targetCtx.lineTo(x + r, y + height);
  targetCtx.quadraticCurveTo(x, y + height, x, y + height - r);
  targetCtx.lineTo(x, y + r);
  targetCtx.quadraticCurveTo(x, y, x + r, y);
  targetCtx.closePath();
}

function getBounds(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function expandBounds(bounds, xPaddingRatio, yPaddingRatio) {
  const xPadding = bounds.width * xPaddingRatio;
  const yPadding = bounds.height * yPaddingRatio;

  return {
    x: bounds.x - xPadding,
    y: bounds.y - yPadding,
    width: bounds.width + xPadding * 2,
    height: bounds.height + yPadding * 2
  };
}

function expandPointsFromCenter(points, scaleX, scaleY) {
  const bounds = getBounds(points);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;

  return points.map((point) => ({
    x: centerX + (point.x - centerX) * scaleX,
    y: centerY + (point.y - centerY) * scaleY
  }));
}

function clampBounds(bounds, maxWidth, maxHeight) {
  const x = clamp(bounds.x, 0, maxWidth);
  const y = clamp(bounds.y, 0, maxHeight);
  const right = clamp(bounds.x + bounds.width, x, maxWidth);
  const bottom = clamp(bounds.y + bounds.height, y, maxHeight);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
}

function clampPointsToRect(points, rect) {
  return points.map((point) => ({
    x: clamp(point.x, rect.x, rect.x + rect.width),
    y: clamp(point.y, rect.y, rect.y + rect.height)
  }));
}

function clampBoundsToRect(bounds, rect) {
  const x = clamp(bounds.x, rect.x, rect.x + rect.width);
  const y = clamp(bounds.y, rect.y, rect.y + rect.height);
  const right = clamp(bounds.x + bounds.width, x, rect.x + rect.width);
  const bottom = clamp(bounds.y + bounds.height, y, rect.y + rect.height);

  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function rectIntersectsPolygon(rect, polygon) {
  const rectPoints = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  ];

  if (rectPoints.some((point) => pointInPolygon(point, polygon))) return true;
  if (polygon.some((point) => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height)) return true;

  for (let index = 0; index < polygon.length; index += 1) {
    const nextIndex = (index + 1) % polygon.length;
    for (let rectIndex = 0; rectIndex < 4; rectIndex += 1) {
      const rectNextIndex = (rectIndex + 1) % 4;
      if (segmentsIntersect(polygon[index], polygon[nextIndex], rectPoints[rectIndex], rectPoints[rectNextIndex])) {
        return true;
      }
    }
  }

  return false;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let index = 0, prev = polygon.length - 1; index < polygon.length; prev = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[prev];
    const crosses = currentPoint.y > point.y !== previousPoint.y > point.y;
    if (crosses) {
      const xAtY = ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x;
      if (point.x < xAtY) inside = !inside;
    }
  }

  return inside;
}

function segmentsIntersect(a, b, c, d) {
  const denominator = (d.y - c.y) * (b.x - a.x) - (d.x - c.x) * (b.y - a.y);
  if (denominator === 0) return false;

  const ua = ((d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)) / denominator;
  const ub = ((b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x)) / denominator;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
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
