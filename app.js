const mapCanvas = document.getElementById("map-canvas");
const mapCtx = mapCanvas.getContext("2d");
const chartCanvas = document.getElementById("chart-canvas");
const chartCtx = chartCanvas.getContext("2d");

const timeDisplay = document.getElementById("time-display");
const vehicleCount = document.getElementById("vehicle-count");
const toggleButton = document.getElementById("toggle-sim");
const stepButton = document.getElementById("step-sim");
const resetButton = document.getElementById("reset-sim");
const toggleVehicles = document.getElementById("toggle-vehicles");
const toggleCongestion = document.getElementById("toggle-congestion");
const edgeSelect = document.getElementById("edge-select");
const startSelect = document.getElementById("start-select");
const endSelect = document.getElementById("end-select");
const planRouteButton = document.getElementById("plan-route");

const simulation = {
  running: false,
  time: 0,
  lastTimestamp: 0,
  vehicles: [],
  vehiclesId: 0,
  selectedRoute: [],
  edgeHistory: new Map(),
};

const settings = {
  tickSeconds: 0.5,
  maxVehiclesPerTick: 6,
  congestionThreshold: 3,
  slowdownFactor: 0.35,
  stopFactor: 0.05,
};

const nodes = [];
const edges = [];
const adjacency = new Map();
const lights = [];

const entryNodes = [0, 1, 2, 3, 4];
const entryWeights = [0.28, 0.22, 0.18, 0.12, 0.2];
const exitNodes = [12, 13, 14, 15, 16, 17];
const exitWeights = [0.2, 0.2, 0.15, 0.15, 0.18, 0.12];

const congestionPalette = {
  low: "#2f9e44",
  mid: "#f4b400",
  high: "#e03131",
};

const buildGrid = () => {
  const padding = 80;
  const cols = 5;
  const rows = 4;
  const width = mapCanvas.width - padding * 2;
  const height = mapCanvas.height - padding * 2;
  const spacingX = width / (cols - 1);
  const spacingY = height / (rows - 1);

  let id = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      nodes.push({
        id,
        x: padding + col * spacingX,
        y: padding + row * spacingY,
      });
      id += 1;
    }
  }

  const addEdge = (from, to) => {
    const a = nodes[from];
    const b = nodes[to];
    const length = Math.hypot(a.x - b.x, a.y - b.y);
    edges.push({
      id: edges.length,
      from,
      to,
      length,
      speedLimit: 60 + Math.random() * 20,
    });
  };

  const connect = (from, to) => {
    addEdge(from, to);
    addEdge(to, from);
  };

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const current = row * cols + col;
      if (col < cols - 1) {
        connect(current, current + 1);
      }
      if (row < rows - 1) {
        connect(current, current + cols);
      }
    }
  }

  edges.forEach((edge) => {
    if (!adjacency.has(edge.from)) {
      adjacency.set(edge.from, []);
    }
    adjacency.get(edge.from).push(edge);
  });

  nodes.forEach(() => {
    lights.push({
      phaseIndex: 0,
      phaseTime: 0,
      duration: 6 + Math.random() * 4,
    });
  });
};

const movementCombos = [
  ["N->S", "S->N"],
  ["E->W", "W->E"],
  ["N->E", "S->W"],
  ["N->W", "S->E"],
  ["E->N", "W->S"],
  ["E->S", "W->N"],
  ["N->S", "N->E", "N->W"],
  ["S->N", "S->E", "S->W"],
  ["E->W", "E->N", "E->S"],
  ["W->E", "W->N", "W->S"],
  ["N->S", "E->W"],
  ["S->N", "W->E"],
];

const roulettePick = (items, weights) => {
  const total = weights.reduce((sum, value) => sum + value, 0);
  const target = Math.random() * total;
  let acc = 0;
  for (let i = 0; i < items.length; i += 1) {
    acc += weights[i];
    if (target <= acc) {
      return items[i];
    }
  }
  return items[items.length - 1];
};

const trafficCurve = (t) => {
  const day = (t % 86400) / 86400;
  const morning = Math.exp(-Math.pow((day - 0.28) / 0.08, 2));
  const evening = Math.exp(-Math.pow((day - 0.74) / 0.1, 2));
  return 0.3 + 0.7 * Math.min(1, morning + evening);
};

const directionLabel = (from, to) => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "E" : "W";
  }
  return dy > 0 ? "S" : "N";
};

const isMoveAllowed = (prevNode, node, nextNode) => {
  if (!prevNode || !nextNode) {
    return true;
  }
  const fromDir = directionLabel(node, prevNode);
  const toDir = directionLabel(node, nextNode);
  const label = `${fromDir}->${toDir}`;
  const light = lights[node.id];
  const allowed = movementCombos[light.phaseIndex % movementCombos.length];
  return allowed.includes(label);
};

const dijkstra = (start, end, weightFn) => {
  const dist = new Map();
  const prev = new Map();
  const queue = new Set(nodes.map((node) => node.id));

  nodes.forEach((node) => dist.set(node.id, Infinity));
  dist.set(start, 0);

  while (queue.size > 0) {
    let current = null;
    let currentDist = Infinity;
    queue.forEach((nodeId) => {
      const d = dist.get(nodeId);
      if (d < currentDist) {
        currentDist = d;
        current = nodeId;
      }
    });

    if (current === null) {
      break;
    }

    queue.delete(current);

    if (current === end) {
      break;
    }

    const neighbors = adjacency.get(current) || [];
    neighbors.forEach((edge) => {
      if (!queue.has(edge.to)) {
        return;
      }
      const weight = weightFn(edge);
      const alt = dist.get(current) + weight;
      if (alt < dist.get(edge.to)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, current);
      }
    });
  }

  const path = [];
  let current = end;
  while (current !== undefined) {
    path.unshift(current);
    if (current === start) {
      break;
    }
    current = prev.get(current);
  }

  return path;
};

const spawnVehicle = () => {
  const start = roulettePick(entryNodes, entryWeights);
  const end = roulettePick(exitNodes, exitWeights);
  if (start === end) {
    return;
  }

  const path = dijkstra(start, end, (edge) => edge.length);
  if (path.length < 2) {
    return;
  }

  const speed = 30 + Math.random() * 30;
  simulation.vehicles.push({
    id: simulation.vehiclesId++,
    path,
    currentIndex: 0,
    progress: 0,
    speed,
    color: "#f97316",
  });
};

const updateLights = (dt) => {
  lights.forEach((light) => {
    light.phaseTime += dt;
    if (light.phaseTime >= light.duration) {
      light.phaseIndex = (light.phaseIndex + 1) % movementCombos.length;
      light.phaseTime = 0;
    }
  });
};

const getEdgeVehicles = () => {
  const counts = new Map();
  simulation.vehicles.forEach((vehicle) => {
    const edge = getVehicleEdge(vehicle);
    if (!edge) {
      return;
    }
    const key = `${edge.from}-${edge.to}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return counts;
};

const recordEdgeHistory = (counts) => {
  edges.forEach((edge) => {
    const key = `${edge.from}-${edge.to}`;
    if (!simulation.edgeHistory.has(key)) {
      simulation.edgeHistory.set(key, []);
    }
    const history = simulation.edgeHistory.get(key);
    history.push({ time: simulation.time, value: counts.get(key) || 0 });
    if (history.length > 200) {
      history.shift();
    }
  });
};

const getVehicleEdge = (vehicle) => {
  const from = vehicle.path[vehicle.currentIndex];
  const to = vehicle.path[vehicle.currentIndex + 1];
  if (from === undefined || to === undefined) {
    return null;
  }
  return edges.find((edge) => edge.from === from && edge.to === to);
};

const updateVehicles = (dt) => {
  const edgeCounts = getEdgeVehicles();
  simulation.vehicles = simulation.vehicles.filter((vehicle) => {
    const edge = getVehicleEdge(vehicle);
    if (!edge) {
      return false;
    }

    const currentNode = nodes[vehicle.path[vehicle.currentIndex]];
    const nextNode = nodes[vehicle.path[vehicle.currentIndex + 1]];
    const afterNode = nodes[vehicle.path[vehicle.currentIndex + 2]];

    const key = `${edge.from}-${edge.to}`;
    const count = edgeCounts.get(key) || 0;

    let speedFactor = 1;
    if (count >= settings.congestionThreshold) {
      speedFactor = settings.slowdownFactor;
    }
    if (count >= settings.congestionThreshold + 2) {
      speedFactor = settings.stopFactor;
    }

    const canMove = isMoveAllowed(currentNode, nextNode, afterNode);
    if (!canMove) {
      speedFactor *= 0.1;
    }

    const distance = edge.length;
    const velocity = (vehicle.speed * speedFactor) / 3.6;
    vehicle.progress += (velocity * dt) / distance;

    if (vehicle.progress >= 1) {
      vehicle.currentIndex += 1;
      vehicle.progress = 0;
      if (vehicle.currentIndex >= vehicle.path.length - 1) {
        return false;
      }
    }
    return true;
  });

  recordEdgeHistory(edgeCounts);
};

const updateTimeDisplay = () => {
  const base = new Date("2025-10-29T00:00:00");
  const current = new Date(base.getTime() + simulation.time * 1000);
  timeDisplay.textContent = current.toLocaleString("zh-CN", {
    hour12: false,
  });
  vehicleCount.textContent = `车辆数：${simulation.vehicles.length}`;
};

const drawMap = () => {
  mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);

  const edgeCounts = getEdgeVehicles();
  edges.forEach((edge) => {
    const from = nodes[edge.from];
    const to = nodes[edge.to];
    const key = `${edge.from}-${edge.to}`;
    const count = edgeCounts.get(key) || 0;
    let color = congestionPalette.low;
    if (count >= 5) {
      color = congestionPalette.high;
    } else if (count >= 2) {
      color = congestionPalette.mid;
    }

    if (!toggleCongestion.checked) {
      color = "#cbd5f5";
    }

    mapCtx.strokeStyle = color;
    mapCtx.lineWidth = 4;
    mapCtx.beginPath();
    mapCtx.moveTo(from.x, from.y);
    mapCtx.lineTo(to.x, to.y);
    mapCtx.stroke();
  });

  if (simulation.selectedRoute.length > 1) {
    mapCtx.strokeStyle = "#2563eb";
    mapCtx.lineWidth = 6;
    mapCtx.beginPath();
    simulation.selectedRoute.forEach((nodeId, index) => {
      const node = nodes[nodeId];
      if (index === 0) {
        mapCtx.moveTo(node.x, node.y);
      } else {
        mapCtx.lineTo(node.x, node.y);
      }
    });
    mapCtx.stroke();
  }

  nodes.forEach((node) => {
    mapCtx.fillStyle = "#1f2937";
    mapCtx.beginPath();
    mapCtx.arc(node.x, node.y, 4, 0, Math.PI * 2);
    mapCtx.fill();
  });

  if (toggleVehicles.checked) {
    simulation.vehicles.forEach((vehicle) => {
      const from = nodes[vehicle.path[vehicle.currentIndex]];
      const to = nodes[vehicle.path[vehicle.currentIndex + 1]];
      if (!from || !to) {
        return;
      }
      const x = from.x + (to.x - from.x) * vehicle.progress;
      const y = from.y + (to.y - from.y) * vehicle.progress;
      mapCtx.fillStyle = vehicle.color;
      mapCtx.beginPath();
      mapCtx.arc(x, y, 3, 0, Math.PI * 2);
      mapCtx.fill();
    });
  }
};

const drawChart = () => {
  chartCtx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
  chartCtx.fillStyle = "#f8fafc";
  chartCtx.fillRect(0, 0, chartCanvas.width, chartCanvas.height);

  const key = edgeSelect.value;
  if (!key || !simulation.edgeHistory.has(key)) {
    return;
  }
  const history = simulation.edgeHistory.get(key);
  const padding = 20;
  const width = chartCanvas.width - padding * 2;
  const height = chartCanvas.height - padding * 2;

  const maxValue = Math.max(5, ...history.map((item) => item.value));

  chartCtx.strokeStyle = "#94a3b8";
  chartCtx.lineWidth = 1;
  chartCtx.beginPath();
  chartCtx.moveTo(padding, padding);
  chartCtx.lineTo(padding, padding + height);
  chartCtx.lineTo(padding + width, padding + height);
  chartCtx.stroke();

  chartCtx.strokeStyle = "#f97316";
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();
  history.forEach((item, index) => {
    const x = padding + (index / (history.length - 1 || 1)) * width;
    const y = padding + height - (item.value / maxValue) * height;
    if (index === 0) {
      chartCtx.moveTo(x, y);
    } else {
      chartCtx.lineTo(x, y);
    }
  });
  chartCtx.stroke();
};

const populateSelects = () => {
  const nodeOptions = nodes.map((node) => {
    const option = document.createElement("option");
    option.value = node.id;
    option.textContent = `路口 ${node.id}`;
    return option;
  });

  nodeOptions.forEach((option) => {
    startSelect.appendChild(option.cloneNode(true));
    endSelect.appendChild(option.cloneNode(true));
  });

  edges.forEach((edge) => {
    const option = document.createElement("option");
    option.value = `${edge.from}-${edge.to}`;
    option.textContent = `道路 ${edge.from} → ${edge.to}`;
    edgeSelect.appendChild(option);
  });

  startSelect.value = "0";
  endSelect.value = "12";
  edgeSelect.value = `${edges[0].from}-${edges[0].to}`;
};

const planRoute = () => {
  const start = Number(startSelect.value);
  const end = Number(endSelect.value);
  if (start === end) {
    simulation.selectedRoute = [start];
    return;
  }
  const edgeCounts = getEdgeVehicles();
  const route = dijkstra(start, end, (edge) => {
    const key = `${edge.from}-${edge.to}`;
    const count = edgeCounts.get(key) || 0;
    const congestionFactor = 1 + count * 0.15;
    return (edge.length / edge.speedLimit) * congestionFactor;
  });
  simulation.selectedRoute = route;
};

const stepSimulation = (dt) => {
  simulation.time += dt;
  const curveValue = trafficCurve(simulation.time);
  const spawnTarget = curveValue * settings.maxVehiclesPerTick;
  const spawnCount = Math.floor(spawnTarget);
  for (let i = 0; i < spawnCount; i += 1) {
    spawnVehicle();
  }
  if (Math.random() < spawnTarget - spawnCount) {
    spawnVehicle();
  }

  updateLights(dt);
  updateVehicles(dt);
  updateTimeDisplay();
  drawMap();
  drawChart();
};

const animate = (timestamp) => {
  if (!simulation.running) {
    simulation.lastTimestamp = timestamp;
    return;
  }
  const delta = (timestamp - simulation.lastTimestamp) / 1000;
  if (delta >= settings.tickSeconds) {
    stepSimulation(settings.tickSeconds);
    simulation.lastTimestamp = timestamp;
  }
  requestAnimationFrame(animate);
};

const resetSimulation = () => {
  simulation.time = 0;
  simulation.vehicles = [];
  simulation.vehiclesId = 0;
  simulation.selectedRoute = [];
  simulation.edgeHistory.clear();
  lights.forEach((light) => {
    light.phaseIndex = 0;
    light.phaseTime = 0;
  });
  updateTimeDisplay();
  drawMap();
  drawChart();
};

const setup = () => {
  buildGrid();
  populateSelects();
  updateTimeDisplay();
  drawMap();
  drawChart();
  requestAnimationFrame(animate);
};

edgeSelect.addEventListener("change", drawChart);
planRouteButton.addEventListener("click", () => {
  planRoute();
  drawMap();
});

toggleButton.addEventListener("click", () => {
  simulation.running = !simulation.running;
  toggleButton.textContent = simulation.running ? "暂停仿真" : "开始仿真";
  if (simulation.running) {
    simulation.lastTimestamp = performance.now();
    requestAnimationFrame(animate);
  }
});

stepButton.addEventListener("click", () => {
  stepSimulation(settings.tickSeconds);
});

resetButton.addEventListener("click", () => {
  resetSimulation();
});

setup();
