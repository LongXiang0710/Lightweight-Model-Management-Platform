import { chooseFocusView, deriveRootBounds } from "./focus-view.js";

const {
  Cartesian2,
  Cartesian3,
  Cesium3DTileColorBlendMode,
  Cesium3DTileFeature,
  Cesium3DTileset,
  Color,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Matrix4,
  PlaneGeometry,
  PolylineCollection,
  Primitive,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Viewer
} = window.Cesium;

const $ = (selector) => document.querySelector(selector);
const backendOrigin = `${window.location.protocol}//${window.location.hostname}:4173`;
const weldingSourceUrl = "https://docs.qq.com/sheet/DU1pUYVV6QkJaVnZK?tab=000001";
const loadStartedAt = performance.now();
let viewer;
let tileset;
let selectedFeature;
let spinning = false;
let treeLoaded = false;
let modelIndex;
let selectedNodeId;
let pendingComponentId;
let selectedComponentIds = new Set();
const hiddenComponentIds = new Set();
const translucentComponentIds = new Set();
const allComponentIds = new Set();
const nodeById = new Map();
const treeElementByNodeId = new Map();
const weldingDateByKey = new Map();
const elementComponentIdsByKey = new Map();
const unweldedSeamComponentIds = new Set();
const weldedSeamComponentIds = new Set();
const weldedAdjacentComponentIds = new Set();
const contentColorRevision = new WeakMap();
const focusViewByNodeId = new Map();
let focusComponentNodes = [];
let focusRootBounds = null;
let weldingDataStatus = "loading";
let weldingSyncMode = "unknown";
let weldingSyncedAt = "";
let featureColorRevision = 0;
let viewTarget = new Cartesian3();
let dragMode = null;
let lastPointerPosition = null;
let groundPrimitive;
let groundGridPrimitive;
const featureColors = {
  selected: Color.fromCssColorString("#00e5ff"),
  unweldedSeam: Color.fromCssColorString("#2563eb"),
  weldedSeam: Color.fromCssColorString("#ff2d2d"),
  weldedAdjacent: Color.fromCssColorString("#ffb000"),
  component: Color.WHITE
};

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function updateClock() {
  $("#clock").textContent = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(new Date());
}

async function checkService() {
  try {
    const response = await fetch(`${backendOrigin}/api/health`, { cache: "no-store" });
    if (!response.ok) throw new Error("service unavailable");
    $("#serviceDot").classList.add("online");
    $("#serviceText").textContent = "局域网服务在线";
  } catch {
    $("#serviceText").textContent = "开发预览模式";
  }
}

function createViewer() {
  viewer = new Viewer("cesiumContainer", {
    animation: false,
    baseLayer: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    contextOptions: {
      webgl: { alpha: true, preserveDrawingBuffer: true }
    },
    navigationHelpButton: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    requestRenderMode: false,
    targetFrameRate: 60
  });
  window.__viewer = viewer;

  const scene = viewer.scene;
  scene.backgroundColor = Color.TRANSPARENT;
  scene.globe.show = false;
  scene.skyBox.show = false;
  scene.skyAtmosphere.show = false;
  scene.sun.show = false;
  scene.moon.show = false;
  scene.fog.enabled = false;
  scene.highDynamicRange = true;
  scene.postProcessStages.fxaa.enabled = true;
  scene.screenSpaceCameraController.enableCollisionDetection = false;
  scene.screenSpaceCameraController.minimumZoomDistance = 0.15;
  scene.screenSpaceCameraController.enableRotate = false;
  scene.screenSpaceCameraController.enableTranslate = false;
  scene.screenSpaceCameraController.enableTilt = false;
  scene.screenSpaceCameraController.enableLook = false;
  scene.screenSpaceCameraController.enableZoom = false;

  return viewer;
}

async function loadModel() {
  const detail = $("#loadingDetail");
  const progress = $("#progressBar");
  progress.style.width = "18%";
  detail.textContent = "读取 tileset.json…";

  try {
    tileset = await Cesium3DTileset.fromUrl(`${backendOrigin}/model/tileset.json`, {
      maximumScreenSpaceError: 12,
      dynamicScreenSpaceError: true,
      dynamicScreenSpaceErrorDensity: 0.00278,
      dynamicScreenSpaceErrorFactor: 4,
      skipLevelOfDetail: false,
      baseScreenSpaceError: 1024,
      skipScreenSpaceErrorFactor: 16,
      skipLevels: 1,
      immediatelyLoadDesiredLevelOfDetail: true,
      loadSiblings: false,
      cullWithChildrenBounds: true,
      preloadWhenHidden: false,
      preferLeaves: false,
      cacheBytes: 256 * 1024 * 1024,
      maximumCacheOverflowBytes: 128 * 1024 * 1024
    });
    window.__tileset = tileset;
    viewer.scene.primitives.add(tileset);
    tileset.imageBasedLighting.imageBasedLightingFactor = new Cartesian2(1.4, 1.4);
    tileset.colorBlendMode = Cesium3DTileColorBlendMode.REPLACE;
    tileset.colorBlendAmount = 1;
    tileset.tileVisible.addEventListener((tile) => applyFeatureColors(tile.content));
    updateTilesetSelectionStyle();
    createGroundPlane(tileset.boundingSphere);
    progress.style.width = "58%";
    detail.textContent = "装载轻量化瓦片…";

    setCameraToModel();
    progress.style.width = "84%";

    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 1800);
      const removeListener = tileset.initialTilesLoaded.addEventListener(() => {
        clearTimeout(timeout);
        removeListener();
        resolve();
      });
    });

    progress.style.width = "100%";
    const seconds = (performance.now() - loadStartedAt) / 1000;
    $("#loadTime").textContent = `首屏 ${seconds.toFixed(1)}s`;
    detail.textContent = "模型已就绪";
    setTimeout(() => $("#loadingScreen").classList.add("hidden"), 280);
  } catch (error) {
    console.error(error);
    detail.textContent = "模型加载失败，请确认后端服务已启动";
    $("#loadingScreen").classList.add("failed");
    showToast("无法读取 tileset.json");
  }
}

function createGroundPlane(sphere) {
  if (groundPrimitive) viewer.scene.primitives.remove(groundPrimitive);
  if (groundGridPrimitive) viewer.scene.primitives.remove(groundGridPrimitive);
  const groundCenter = new Cartesian3(
    sphere.center.x,
    sphere.center.y,
    sphere.center.z - sphere.radius * 0.82
  );
  const modelMatrix = Matrix4.fromTranslation(groundCenter);
  Matrix4.multiplyByUniformScale(modelMatrix, sphere.radius * 500, modelMatrix);

  groundPrimitive = viewer.scene.primitives.add(new Primitive({
    geometryInstances: new GeometryInstance({
      geometry: new PlaneGeometry({
        vertexFormat: MaterialAppearance.MaterialSupport.BASIC.vertexFormat
      }),
      modelMatrix
    }),
    appearance: new MaterialAppearance({
      material: Material.fromType("Color", {
        color: Color.fromCssColorString("#ffffff")
      }),
      faceForward: true,
      flat: true,
      translucent: false
    }),
    asynchronous: false
  }));

  groundGridPrimitive = viewer.scene.primitives.add(new PolylineCollection());
  const gridZ = groundCenter.z + sphere.radius * 0.006;
  const gridExtent = sphere.radius * 5;
  const gridStep = sphere.radius * 0.5;
  const gridMaterial = Material.fromType("Color", {
    color: Color.fromCssColorString("#aeb8bc").withAlpha(0.58)
  });
  for (let index = -10; index <= 10; index += 1) {
    const offset = index * gridStep;
    groundGridPrimitive.add({
      positions: [
        new Cartesian3(sphere.center.x - gridExtent, sphere.center.y + offset, gridZ),
        new Cartesian3(sphere.center.x + gridExtent, sphere.center.y + offset, gridZ)
      ],
      width: 1,
      material: gridMaterial
    });
    groundGridPrimitive.add({
      positions: [
        new Cartesian3(sphere.center.x + offset, sphere.center.y - gridExtent, gridZ),
        new Cartesian3(sphere.center.x + offset, sphere.center.y + gridExtent, gridZ)
      ],
      width: 1,
      material: gridMaterial
    });
  }
}

function resetView() {
  if (!tileset) return;
  setCameraToModel();
}

function setCameraToModel() {
  const sphere = tileset.boundingSphere;
  Cartesian3.clone(sphere.center, viewTarget);
  const radius = Math.max(sphere.radius, 1);
  const destination = new Cartesian3(
    sphere.center.x + radius * 1.1,
    sphere.center.y - radius * 1.6,
    sphere.center.z + radius * 0.8
  );
  const direction = Cartesian3.normalize(
    Cartesian3.subtract(sphere.center, destination, new Cartesian3()),
    new Cartesian3()
  );
  viewer.camera.frustum.near = 0.05;
  pointCameraAt(destination, sphere.center);
  setTimeout(() => {
    document.body.dataset.modelDebug = JSON.stringify({
      sphere: { center: sphere.center, radius: sphere.radius },
      camera: { position: viewer.camera.position, direction: viewer.camera.direction, up: viewer.camera.up },
      tilesLoaded: tileset.tilesLoaded,
      memory: tileset.totalMemoryUsageInBytes,
      selected: tileset._statistics?.selected,
      visited: tileset._statistics?.visited,
      numberOfCommands: viewer.scene.frameState?.commandList?.length
    });
  }, 2500);
}

function rotateVector(vector, axis, angle, result = new Cartesian3()) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const cross = Cartesian3.cross(axis, vector, new Cartesian3());
  const projection = Cartesian3.multiplyByScalar(axis, Cartesian3.dot(axis, vector) * (1 - cosine), new Cartesian3());
  Cartesian3.multiplyByScalar(vector, cosine, result);
  Cartesian3.add(result, Cartesian3.multiplyByScalar(cross, sine, cross), result);
  return Cartesian3.add(result, projection, result);
}

function pointCameraAt(position, target) {
  const direction = Cartesian3.normalize(Cartesian3.subtract(target, position, new Cartesian3()), new Cartesian3());
  let right = Cartesian3.cross(direction, Cartesian3.UNIT_Z, new Cartesian3());
  if (Cartesian3.magnitudeSquared(right) < 1e-8) right = Cartesian3.clone(viewer.camera.right, right);
  Cartesian3.normalize(right, right);
  const up = Cartesian3.normalize(Cartesian3.cross(right, direction, new Cartesian3()), new Cartesian3());
  viewer.camera.setView({ destination: position, orientation: { direction, up } });
}

function orbitCamera(deltaX, deltaY = 0) {
  if (!tileset) return;
  let relative = Cartesian3.subtract(viewer.camera.position, viewTarget, new Cartesian3());
  relative = rotateVector(relative, Cartesian3.UNIT_Z, -deltaX * 0.004, relative);
  if (deltaY) {
    const pitchAxis = Cartesian3.normalize(Cartesian3.clone(viewer.camera.right, new Cartesian3()), new Cartesian3());
    relative = rotateVector(relative, pitchAxis, -deltaY * 0.003, relative);
  }
  pointCameraAt(Cartesian3.add(viewTarget, relative, new Cartesian3()), viewTarget);
}

function panCamera(deltaX, deltaY) {
  if (!tileset) return;
  const distance = Cartesian3.distance(viewer.camera.position, viewTarget);
  const scale = Math.max(distance, 1) / Math.max(viewer.canvas.clientHeight, 1);
  const horizontal = Cartesian3.multiplyByScalar(viewer.camera.right, -deltaX * scale, new Cartesian3());
  const vertical = Cartesian3.multiplyByScalar(viewer.camera.up, deltaY * scale, new Cartesian3());
  const offset = Cartesian3.add(horizontal, vertical, new Cartesian3());
  Cartesian3.add(viewTarget, offset, viewTarget);
  pointCameraAt(Cartesian3.add(viewer.camera.position, offset, new Cartesian3()), viewTarget);
}

function zoomCamera(zoomIn, intensity = 1) {
  if (!tileset) return;
  const radius = Math.max(tileset.boundingSphere.radius, 1);
  const relative = Cartesian3.subtract(viewer.camera.position, viewTarget, new Cartesian3());
  const distance = Cartesian3.magnitude(relative);
  const maximumDistance = radius * 6;
  const safeIntensity = Math.min(Math.max(intensity, 0.04), 1.5);
  const factor = Math.pow(zoomIn ? 0.92 : 1.08, safeIntensity);
  const nextDistance = zoomIn ? distance * factor : Math.min(maximumDistance, distance * factor);
  if (!Number.isFinite(nextDistance) || nextDistance <= 0) return;
  viewer.camera.frustum.near = Math.min(0.05, Math.max(0.00001, nextDistance * 0.001));
  Cartesian3.normalize(relative, relative);
  const destination = Cartesian3.add(
    viewTarget,
    Cartesian3.multiplyByScalar(relative, nextDistance, relative),
    new Cartesian3()
  );
  pointCameraAt(destination, viewTarget);
}

function focusSphere(sphere) {
  Cartesian3.clone(sphere.center, viewTarget);
  const range = Math.max(sphere.radius * 2.5, 2);
  const destination = Cartesian3.subtract(viewTarget, Cartesian3.multiplyByScalar(viewer.camera.direction, range, new Cartesian3()), new Cartesian3());
  pointCameraAt(destination, viewTarget);
}

function focusBounds(bounds, offset = [1, -1, 0.85]) {
  if (!bounds || bounds.length !== 6) return;
  const center = new Cartesian3(
    (bounds[0] + bounds[3]) / 2,
    (bounds[1] + bounds[4]) / 2,
    (bounds[2] + bounds[5]) / 2
  );
  const radius = Math.max(Cartesian3.distance(center, new Cartesian3(bounds[3], bounds[4], bounds[5])), 0.05);
  const modelRadius = tileset?.boundingSphere.radius || 1;
  const viewOffset = Cartesian3.normalize(new Cartesian3(offset[0], offset[1], offset[2]), new Cartesian3());
  const range = Math.max(radius * 4, modelRadius * 0.055, 0.55);
  Cartesian3.clone(center, viewTarget);
  viewer.camera.frustum.near = Math.min(0.05, Math.max(0.00001, range * 0.001));
  const destination = Cartesian3.add(center, Cartesian3.multiplyByScalar(viewOffset, range, new Cartesian3()), new Cartesian3());
  pointCameraAt(destination, center);
}

function focusNode(node) {
  if (!node?.bounds) return false;
  let calibration = focusViewByNodeId.get(node.id);
  if (!calibration) {
    calibration = chooseFocusView(node, focusComponentNodes, focusRootBounds);
    focusViewByNodeId.set(node.id, calibration);
  }
  document.body.dataset.focusView = JSON.stringify({ nodeId: node.id, ...calibration });
  focusBounds(node.bounds, calibration.offset);
  return true;
}

function featureComponentId(feature) {
  const value = feature?.getProperty?.("componentId");
  return value === undefined || value === null ? "" : String(value);
}

function updateTilesetSelectionStyle() {
  if (!tileset) return;
  featureColorRevision += 1;
  viewer?.scene?.requestRender();
}

function featureStatusColor(componentId) {
  if (selectedComponentIds.has(componentId)) return featureColors.selected;
  if (weldedSeamComponentIds.has(componentId)) return featureColors.weldedSeam;
  if (weldedAdjacentComponentIds.has(componentId)) return featureColors.weldedAdjacent;
  if (unweldedSeamComponentIds.has(componentId)) return featureColors.unweldedSeam;
  return featureColors.component;
}

function featureIsVisible(componentId) {
  return !hiddenComponentIds.has(componentId);
}

function updateVisibilityControlState() {
  const currentSelection = [...selectedComponentIds];
  const selectionIsHidden = currentSelection.length > 0
    && currentSelection.every((componentId) => hiddenComponentIds.has(componentId));
  const visibleSelectedCount = currentSelection.filter((componentId) =>
    allComponentIds.has(componentId) && !hiddenComponentIds.has(componentId)).length;
  const selectionIsIsolated = currentSelection.length > 0
    && visibleSelectedCount === currentSelection.length
    && allComponentIds.size === hiddenComponentIds.size + visibleSelectedCount;
  const selectionIsTranslucent = currentSelection.length > 0
    && currentSelection.every((componentId) => translucentComponentIds.has(componentId));
  const hideButton = $("#hideSelected");
  if (hideButton) {
    hideButton.classList.toggle("active", selectionIsHidden);
    hideButton.title = selectionIsHidden ? "显示当前选定对象" : "隐藏当前选定对象";
    hideButton.querySelector("span").textContent = selectionIsHidden ? "◉" : "⊘";
    hideButton.querySelector("em").textContent = selectionIsHidden ? "显示对象" : "隐藏对象";
  }
  $("#isolateSelected")?.classList.toggle("active", selectionIsIsolated);
  $("#translucentSelected")?.classList.toggle("active", selectionIsTranslucent);
  document.body.dataset.modelVisibility = JSON.stringify({
    hidden: hiddenComponentIds.size,
    isolated: selectionIsIsolated ? currentSelection.length : 0,
    translucent: translucentComponentIds.size
  });
}

function applyFeatureColors(content) {
  if (!content) return;
  for (const innerContent of content.innerContents || []) applyFeatureColors(innerContent);
  if (contentColorRevision.get(content) === featureColorRevision) return;
  const featuresLength = Number(content.featuresLength || 0);
  for (let index = 0; index < featuresLength; index += 1) {
    const feature = content.getFeature(index);
    const componentId = featureComponentId(feature);
    const color = Color.clone(featureStatusColor(componentId), feature.color);
    if (translucentComponentIds.has(componentId)) color.alpha = 0.28;
    feature.color = color;
    feature.show = featureIsVisible(componentId);
  }
  contentColorRevision.set(content, featureColorRevision);
}

function collectComponentIds(nodeId, result = []) {
  const node = nodeById.get(nodeId);
  if (!node) return result;
  result.push(...(node.componentIds || []));
  for (const childId of node.children || []) collectComponentIds(childId, result);
  return result;
}

function setHighlightedComponents(componentIds, pickedFeature = null) {
  selectedComponentIds = new Set(componentIds.filter(Boolean));
  selectedFeature = pickedFeature;
  updateVisibilityControlState();
  updateTilesetSelectionStyle();
}

function requireSelectedComponents() {
  const componentIds = [...selectedComponentIds];
  if (componentIds.length) return componentIds;
  showToast("请先选择一个模型构件");
  return null;
}

function toggleSelectedVisibility() {
  const componentIds = requireSelectedComponents();
  if (!componentIds) return;
  const showSelection = componentIds.every((componentId) => hiddenComponentIds.has(componentId));
  for (const componentId of componentIds) {
    if (showSelection) hiddenComponentIds.delete(componentId);
    else hiddenComponentIds.add(componentId);
  }
  updateVisibilityControlState();
  updateTilesetSelectionStyle();
  showToast(showSelection
    ? `已显示选定对象（${componentIds.length} 个几何片段）`
    : `已隐藏选定对象（${componentIds.length} 个几何片段）`);
}

function isolateSelectedComponents() {
  const componentIds = requireSelectedComponents();
  if (!componentIds) return;
  if (!allComponentIds.size) {
    showToast("结构数据仍在加载，请稍后重试");
    return;
  }
  const selectedIds = new Set(componentIds);
  hiddenComponentIds.clear();
  for (const componentId of allComponentIds) {
    if (!selectedIds.has(componentId)) hiddenComponentIds.add(componentId);
  }
  updateVisibilityControlState();
  updateTilesetSelectionStyle();
  showToast("已隐藏未选定对象");
}

function toggleSelectedTransparency() {
  const componentIds = requireSelectedComponents();
  if (!componentIds) return;
  const makeTranslucent = !componentIds.every((componentId) => translucentComponentIds.has(componentId));
  for (const componentId of componentIds) {
    if (makeTranslucent) translucentComponentIds.add(componentId);
    else translucentComponentIds.delete(componentId);
  }
  updateVisibilityControlState();
  updateTilesetSelectionStyle();
  showToast(makeTranslucent ? "选定对象已设为半透明" : "选定对象已恢复不透明");
}

function showAllComponents() {
  hiddenComponentIds.clear();
  translucentComponentIds.clear();
  updateVisibilityControlState();
  updateTilesetSelectionStyle();
  showToast("已显示全部对象");
}

function pipelineNodeFor(node) {
  let current = node;
  while (current && current.depth > 4) current = current.parentId ? nodeById.get(current.parentId) : null;
  return current?.depth === 4 ? current : null;
}

function collapseOtherPipelines(activePipelineId) {
  for (const node of modelIndex?.nodes || []) {
    if (node.depth !== 4 || node.id === activePipelineId) continue;
    treeElementByNodeId.get(node.id)?.classList.remove("expanded");
  }
}

function setActiveTreeNode(nodeId, shouldScroll = false) {
  if (selectedNodeId) treeElementByNodeId.get(selectedNodeId)?.querySelector(":scope > .tree-row")?.classList.remove("active");
  selectedNodeId = nodeId;
  const activeNode = nodeById.get(nodeId);
  const activePipeline = pipelineNodeFor(activeNode);
  if (activePipeline) collapseOtherPipelines(activePipeline.id);
  let current = activeNode?.parentId ? nodeById.get(activeNode.parentId) : null;
  while (current) {
    treeElementByNodeId.get(current.id)?.classList.add("expanded");
    current = current.parentId ? nodeById.get(current.parentId) : null;
  }
  const element = treeElementByNodeId.get(nodeId);
  element?.querySelector(":scope > .tree-row")?.classList.add("active");
  if (shouldScroll) element?.scrollIntoView({ block: "center", behavior: "smooth" });
}

function propertyLabel(name) {
  const labels = {
    line_name: "管线名称",
    component_name: "构件类型",
    component_class: "构件分类"
  };
  return labels[name] || name.replace(/^EP3D_/, "").replace(/\s+/g, "");
}

function cleanStructureLabel(value) {
  return String(value ?? "").replace(/\[1\]/g, "");
}

function normalizeDataKey(value) {
  return String(value ?? "").replace(/^[\s\u3000]+|[\s\u3000]+$/g, "");
}

function normalizeWeldNumber(value) {
  const text = normalizeDataKey(value);
  return text.endsWith(".0") && /^\d+\.0$/.test(text) ? text.slice(0, -2) : text;
}

function weldingKey(lineNumber, weldNumber) {
  return `${normalizeDataKey(lineNumber)}\u0000${normalizeWeldNumber(weldNumber)}`;
}

function elementKey(lineNumber, elementNumber) {
  return `${normalizeDataKey(lineNumber)}\u0000${normalizeDataKey(elementNumber)}`;
}

function buildElementComponentIndex() {
  elementComponentIdsByKey.clear();
  for (const node of modelIndex?.nodes || []) {
    const properties = node.properties || {};
    const lineNumber = normalizeDataKey(properties["EP3D_管 线 号"]);
    const elementNumber = normalizeDataKey(properties["EP3D_元件编号"]);
    if (!lineNumber || !elementNumber) continue;
    const key = elementKey(lineNumber, elementNumber);
    if (!elementComponentIdsByKey.has(key)) elementComponentIdsByKey.set(key, new Set());
    for (const componentId of node.componentIds || []) elementComponentIdsByKey.get(key).add(componentId);
  }
}

function updateWeldingStatusColors() {
  unweldedSeamComponentIds.clear();
  weldedSeamComponentIds.clear();
  weldedAdjacentComponentIds.clear();
  let weldedWeldCount = 0;
  let unresolvedAdjacentElements = 0;
  for (const node of modelIndex?.nodes || []) {
    const properties = node.properties || {};
    const weldNumber = normalizeWeldNumber(properties["EP3D_焊点编号"]);
    if (weldNumber) {
      for (const componentId of node.componentIds || []) unweldedSeamComponentIds.add(componentId);
    }
    const record = getWeldingRecord(properties);
    if (!record || !normalizeDataKey(record.weldingDate)) continue;
    weldedWeldCount += 1;
    for (const componentId of node.componentIds || []) {
      unweldedSeamComponentIds.delete(componentId);
      weldedSeamComponentIds.add(componentId);
    }
    const lineNumber = normalizeDataKey(properties["EP3D_管 线 号"]);
    for (const fieldName of ["EP3D_元件1编号", "EP3D_元件2编号"]) {
      const elementNumber = normalizeDataKey(properties[fieldName]);
      if (!elementNumber || elementNumber === "-") continue;
      const matches = elementComponentIdsByKey.get(elementKey(lineNumber, elementNumber));
      if (!matches?.size) {
        unresolvedAdjacentElements += 1;
        continue;
      }
      for (const componentId of matches) weldedAdjacentComponentIds.add(componentId);
    }
  }
  document.body.dataset.weldingVisualization = JSON.stringify({
    weldedWelds: weldedWeldCount,
    unweldedSeamFeatures: unweldedSeamComponentIds.size,
    seamFeatures: weldedSeamComponentIds.size,
    adjacentFeatures: weldedAdjacentComponentIds.size,
    unresolvedAdjacentElements
  });
  updateTreeWeldingStates();
  updateTilesetSelectionStyle();
}

function getWeldingRecord(properties = {}) {
  const lineNumber = properties["EP3D_管 线 号"];
  const weldNumber = properties["EP3D_焊点编号"];
  if (lineNumber === undefined || weldNumber === undefined) return null;
  return weldingDateByKey.get(weldingKey(lineNumber, weldNumber)) || null;
}

function treeWeldingStateClass(node) {
  const weldNumber = normalizeWeldNumber(node?.properties?.["EP3D_焊点编号"]);
  if (!weldNumber) return "";
  const record = getWeldingRecord(node.properties);
  return record && normalizeDataKey(record.weldingDate) ? "tree-welded" : "tree-unwelded";
}

function updateTreeWeldingStates() {
  for (const node of modelIndex?.nodes || []) {
    const row = treeElementByNodeId.get(node.id)?.querySelector(":scope > .tree-row");
    if (!row) continue;
    row.classList.remove("tree-welded", "tree-unwelded");
    const stateClass = treeWeldingStateClass(node);
    if (stateClass) row.classList.add(stateClass);
  }
}

function renderCloudWeldingSection(properties = {}) {
  const lineNumber = properties["EP3D_管 线 号"];
  const weldNumber = properties["EP3D_焊点编号"];
  if (lineNumber === undefined || weldNumber === undefined) return "";
  const record = getWeldingRecord(properties);
  const sourceLink = `<a class="cloud-source-link" href="${weldingSourceUrl}" target="_blank" rel="noopener noreferrer">腾讯文档 · 动力站焊接数据库 ↗</a>`;
  if (weldingDataStatus === "loading") {
    return `<h3 class="property-section-title cloud">云端焊接数据 <small>同步中</small></h3>
      <p class="cloud-data-state">正在读取腾讯文档同步数据…</p>`;
  }
  if (!record) {
    return `<h3 class="property-section-title cloud">云端焊接数据 <small>未匹配</small></h3>
      <p class="cloud-data-state">未找到“${escapeHtml(String(lineNumber))} / 焊点 ${escapeHtml(String(weldNumber))}”的焊接记录。</p>
      ${sourceLink}`;
  }
  const isCloudLive = weldingSyncMode === "cloud-live";
  const isWelded = Boolean(normalizeDataKey(record.weldingDate));
  const syncLabel = isCloudLive ? "刷新已同步" : "同步失败";
  const syncDescription = isCloudLive
    ? `腾讯文档 · ${weldingSyncedAt ? new Date(weldingSyncedAt).toLocaleString("zh-CN", { hour12: false }) : "本次刷新"}`
    : "腾讯文档暂不可用；日期保持为空";
  return `<h3 class="property-section-title cloud">云端焊接数据 <small>${syncLabel}</small></h3>
    <div class="property-row welding-state-row"><span>焊接状态</span><strong class="${isWelded ? "welding-state-done" : "welding-state-pending"}">${isWelded ? "已焊接" : "未焊接"}</strong></div>
    <div class="property-row cloud-date-row"><span>焊接日期</span><strong>${escapeHtml(record.weldingDate || "")}</strong></div>
    <div class="property-row"><span>匹配字段</span><strong>${escapeHtml(record.lineNumber)} / 焊点 ${escapeHtml(record.weldNumber)}</strong></div>
    <div class="property-row"><span>云端源表行</span><strong>${escapeHtml(String(record.sourceRow))}</strong></div>
    <div class="property-row"><span>同步状态</span><strong>${escapeHtml(syncDescription)}</strong></div>
    ${sourceLink}`;
}

async function loadWeldingDates() {
  try {
    const response = await fetch(`${backendOrigin}/api/welding-sync?refresh=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("welding data unavailable");
    const payload = await response.json();
    if (!Array.isArray(payload.records)) throw new Error("invalid welding payload");
    weldingDateByKey.clear();
    for (const record of payload.records || []) {
      weldingDateByKey.set(weldingKey(record.lineNumber, record.weldNumber), record);
    }
    weldingSyncMode = payload.syncMode || "local-seed";
    weldingSyncedAt = payload.syncedAt || "";
    weldingDataStatus = "ready";
    document.body.dataset.weldingSync = JSON.stringify({
      mode: weldingSyncMode,
      syncedAt: weldingSyncedAt,
      records: weldingDateByKey.size
    });
  } catch (error) {
    console.warn("腾讯文档同步接口不可用，使用本地构件索引且日期保持为空。", error);
    try {
      const response = await fetch(`${backendOrigin}/model/welding-dates.json`, { cache: "no-store" });
      if (!response.ok) throw new Error("welding fallback unavailable");
      const payload = await response.json();
      weldingDateByKey.clear();
      for (const record of payload.records || []) {
        weldingDateByKey.set(weldingKey(record.lineNumber, record.weldNumber), { ...record, weldingDate: null, virtual: false });
      }
      weldingDataStatus = "ready";
      weldingSyncMode = "cloud-error";
      document.body.dataset.weldingSync = JSON.stringify({ mode: weldingSyncMode, syncedAt: "", records: weldingDateByKey.size });
    } catch (fallbackError) {
      console.error(fallbackError);
      weldingDataStatus = "error";
      weldingSyncMode = "error";
      document.body.dataset.weldingSync = JSON.stringify({ mode: weldingSyncMode, syncedAt: "", records: 0 });
    }
  }
  updateWeldingStatusColors();
  if (selectedNodeId && nodeById.has(selectedNodeId)) {
    displayNodeProperties(nodeById.get(selectedNodeId), selectedFeature);
  }
}

function displayNodeProperties(node, pickedFeature = null) {
  const sourceProperties = Object.entries(node?.properties || {})
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([name, value]) => ({
      sourceName: name,
      name: propertyLabel(name),
      value: name === "line_name" ? cleanStructureLabel(value) : String(value)
    }));
  const basicProperties = sourceProperties.filter(({ sourceName }) => !sourceName.startsWith("EP3D_"));
  const ep3dPriority = [
    "EP3D_焊点编号", "EP3D_元件编号", "EP3D_元件1编号", "EP3D_元件2编号",
    "EP3D_管 线 号", "EP3D_阀门位号", "EP3D_连接焊口编号", "EP3D_材料编码"
  ];
  const ep3dProperties = sourceProperties
    .filter(({ sourceName }) => sourceName.startsWith("EP3D_"))
    .sort((left, right) => {
      const leftIndex = ep3dPriority.indexOf(left.sourceName);
      const rightIndex = ep3dPriority.indexOf(right.sourceName);
      const leftRank = leftIndex === -1 ? ep3dPriority.length : leftIndex;
      const rightRank = rightIndex === -1 ? ep3dPriority.length : rightIndex;
      return leftRank - rightRank || left.name.localeCompare(right.name, "zh-CN");
    });
  const componentId = featureComponentId(pickedFeature) || node?.componentIds?.[0] || "";
  const lineNode = (() => {
    let current = node;
    while (current && current.depth > 4) current = nodeById.get(current.parentId);
    return current?.depth === 4 ? current : null;
  })();
  const componentCount = node ? collectComponentIds(node.id, []).length : selectedComponentIds.size;

  $("#selectedName").textContent = node?.depth === 5 && lineNode
    ? `${lineNode.name} / ${node.name}`
    : node?.name || "模型构件";
  $("#selectedId").textContent = componentId || node?.treeKey || "3D Tiles 构件";
  $("#selectedType").textContent = `${componentCount} 个几何片段 · ${ep3dProperties.length} 项 EP3D 属性`;
  const renderPropertyRows = (properties) => properties
    .map(({ name, value }) => `<div class="property-row"><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
  $("#propertyList").innerHTML = sourceProperties.length
    ? `${basicProperties.length ? `<h3 class="property-section-title">基本信息</h3>${renderPropertyRows(basicProperties)}` : ""}
       <h3 class="property-section-title">EP3D 属性 <small>${ep3dProperties.length} 项</small></h3>
       ${ep3dProperties.length ? renderPropertyRows(ep3dProperties) : '<p class="no-properties">该构件未提供 EP3D 属性。</p>'}
       ${renderCloudWeldingSection(node?.properties || {})}`
    : `<div><span>结构路径</span><strong>${escapeHtml(cleanStructureLabel(node?.treeKey || "未挂接"))}</strong></div><div><span>包含构件</span><strong>${componentCount}</strong></div>`;
  $("#selectionEmpty").classList.add("hidden");
  $("#propertyContent").classList.remove("hidden");
}

function selectTreeNode(nodeId, { focus = false, scroll = false, pickedFeature = null } = {}) {
  const node = nodeById.get(nodeId);
  if (!node) return false;
  const componentIds = collectComponentIds(nodeId, []);
  setHighlightedComponents(componentIds, pickedFeature);
  setActiveTreeNode(nodeId, scroll);
  displayNodeProperties(node, pickedFeature);
  if (focus) focusNode(node);
  return true;
}

function clearSelection() {
  setHighlightedComponents([]);
  if (selectedNodeId) treeElementByNodeId.get(selectedNodeId)?.querySelector(":scope > .tree-row")?.classList.remove("active");
  selectedNodeId = null;
  $("#selectionEmpty").classList.remove("hidden");
  $("#propertyContent").classList.add("hidden");
}

function displayProperties(feature) {
  const names = feature.getPropertyIds ? feature.getPropertyIds() : feature.getPropertyNames();
  const properties = names.map((name) => ({ name, value: feature.getProperty(name) }))
    .filter(({ value }) => value !== undefined && value !== null && String(value).trim() !== "");
  const identifier = featureComponentId(feature);
  $("#selectedName").textContent = "模型构件";
  $("#selectedId").textContent = identifier || "3D Tiles 构件";
  $("#selectedType").textContent = properties.length ? `${properties.length} 项属性` : "构件";
  $("#propertyList").innerHTML = properties.length
    ? properties.slice(0, 40).map(({ name, value }) => `<div><span>${escapeHtml(name)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join("")
    : "<p class=\"no-properties\">该构件未写入批次属性，可在属性文件中按编号检索。</p>";
  $("#selectionEmpty").classList.add("hidden");
  $("#propertyContent").classList.remove("hidden");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

function setupPicking() {
  const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
  handler.setInputAction((event) => {
    dragMode = "rotate";
    lastPointerPosition = Cartesian2.clone(event.position);
  }, ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction((event) => {
    dragMode = "pan";
    lastPointerPosition = Cartesian2.clone(event.position);
  }, ScreenSpaceEventType.MIDDLE_DOWN);
  handler.setInputAction((movement) => {
    if (!dragMode || !lastPointerPosition) return;
    const deltaX = movement.endPosition.x - lastPointerPosition.x;
    const deltaY = movement.endPosition.y - lastPointerPosition.y;
    if (dragMode === "rotate") orbitCamera(deltaX, deltaY);
    else panCamera(deltaX, deltaY);
    lastPointerPosition = Cartesian2.clone(movement.endPosition, lastPointerPosition);
  }, ScreenSpaceEventType.MOUSE_MOVE);
  handler.setInputAction(() => { dragMode = null; lastPointerPosition = null; }, ScreenSpaceEventType.LEFT_UP);
  handler.setInputAction(() => { dragMode = null; lastPointerPosition = null; }, ScreenSpaceEventType.MIDDLE_UP);
  handler.setInputAction((event) => {
    const picked = viewer.scene.pick(event.position);
    if (!(picked instanceof Cesium3DTileFeature)) {
      clearSelection();
      return;
    }
    const componentId = featureComponentId(picked);
    const nodeId = modelIndex?.componentToNode?.[componentId];
    if (nodeId && selectTreeNode(nodeId, { focus: false, scroll: true, pickedFeature: picked })) {
      showToast("已定位到结构树并挂接构件属性");
    } else {
      setHighlightedComponents(componentId ? [componentId] : [], picked);
      displayProperties(picked);
      pendingComponentId = componentId;
    }
  }, ScreenSpaceEventType.LEFT_CLICK);
}

function setupFpsMeter() {
  let frames = 0;
  let previous = performance.now();
  viewer.scene.postRender.addEventListener(() => {
    frames += 1;
    const now = performance.now();
    if (now - previous >= 1000) {
      $("#fpsMeter").textContent = `${Math.round(frames * 1000 / (now - previous))} FPS`;
      frames = 0;
      previous = now;
    }
  });
}

function renderTreeNode(nodeId) {
  const node = nodeById.get(nodeId);
  if (!node) return "";
  const hasChildren = node.children?.length > 0;
  const expanded = node.depth < 4 ? " expanded" : "";
  const weldNumber = normalizeWeldNumber(node.properties?.["EP3D_焊点编号"]);
  const displayName = weldNumber ? `${node.name} · ${weldNumber}号焊缝` : node.name;
  const weldingStateClass = treeWeldingStateClass(node);
  const detail = node.depth === 4
    ? `<em>${node.children.length} 项</em>`
    : node.depth === 5 && node.properties
      ? "<em>属性</em>"
      : "";
  const children = hasChildren
    ? `<div class="tree-children">${node.children.map(renderTreeNode).join("")}</div>`
    : "";
  return `<div class="tree-node${expanded}" data-node-id="${escapeHtml(node.id)}">
    <button class="tree-row${node.depth > 0 ? " child" : ""}${weldingStateClass ? ` ${weldingStateClass}` : ""}" data-node-id="${escapeHtml(node.id)}" data-depth="${node.depth}" style="--tree-depth:${node.depth}">
      <span class="chevron">${hasChildren ? "›" : "·"}</span>
      <span class="${node.depth === 5 ? "node-dot" : "cube-icon"}"></span>
      <span title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>${detail}
    </button>${children}
  </div>`;
}

async function loadStructure() {
  if (treeLoaded) return;
  const button = $("#loadTree");
  button.textContent = "加载中…";
  button.disabled = true;
  try {
    const response = await fetch(`${backendOrigin}/model/model-index.json`);
    if (!response.ok) throw new Error("model index unavailable");
    modelIndex = await response.json();
    nodeById.clear();
    allComponentIds.clear();
    for (const node of modelIndex.nodes || []) {
      nodeById.set(node.id, node);
      for (const componentId of node.componentIds || []) allComponentIds.add(componentId);
    }
    focusViewByNodeId.clear();
    focusComponentNodes = modelIndex.nodes.filter((node) => node.depth === 5 && Array.isArray(node.bounds));
    focusRootBounds = nodeById.get(modelIndex.roots?.[0])?.bounds || deriveRootBounds(focusComponentNodes);
    buildElementComponentIndex();
    updateWeldingStatusColors();
    const tree = $("#modelTree");
    tree.innerHTML = (modelIndex.roots || []).map(renderTreeNode).join("");
    treeElementByNodeId.clear();
    for (const element of tree.querySelectorAll(".tree-node")) {
      treeElementByNodeId.set(element.dataset.nodeId, element);
    }
    tree.addEventListener("click", (event) => {
      const row = event.target.closest(".tree-row[data-node-id]");
      if (!row) return;
      const node = nodeById.get(row.dataset.nodeId);
      const wrapper = treeElementByNodeId.get(row.dataset.nodeId);
      if (node?.children?.length) wrapper?.classList.toggle("expanded");
      const shouldFocus = node?.depth === 5;
      selectTreeNode(row.dataset.nodeId, { focus: shouldFocus });
      if (shouldFocus) showToast("已定位到对应管件");
    });
    const systemCount = modelIndex.nodes.filter((node) => node.depth === 4).length;
    button.textContent = `${systemCount} 个系统`;
    button.disabled = false;
    treeLoaded = true;
    if (pendingComponentId) {
      const nodeId = modelIndex.componentToNode?.[pendingComponentId];
      if (nodeId) selectTreeNode(nodeId, { focus: false, scroll: true, pickedFeature: selectedFeature });
      pendingComponentId = null;
    }
  } catch (error) {
    console.error(error);
    button.textContent = "重试";
    button.disabled = false;
    showToast("结构文件读取失败");
  }
}

function setupControls() {
  const viewerMenu = $("#viewerMenu");
  const viewerMenuToggle = $("#toggleViewerMenu");
  viewerMenuToggle.addEventListener("click", () => {
    const collapsed = viewerMenu.classList.toggle("collapsed");
    viewerMenuToggle.setAttribute("aria-expanded", String(!collapsed));
    viewerMenuToggle.title = collapsed ? "展开审阅菜单" : "收起审阅菜单";
    viewerMenuToggle.querySelector("span").textContent = collapsed ? "⌄" : "⌃";
    viewerMenuToggle.querySelector("em").textContent = collapsed ? "展开" : "收起";
  });
  $("#homeView").addEventListener("click", resetView);
  $("#zoomIn").addEventListener("click", () => zoomCamera(true));
  $("#zoomOut").addEventListener("click", () => zoomCamera(false));
  viewer.scene.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const intensity = Math.min(Math.abs(event.deltaY), 140) / 120;
    zoomCamera(event.deltaY < 0, intensity);
  }, { passive: false });
  const focusCurrentSelection = () => {
    const node = selectedNodeId ? nodeById.get(selectedNodeId) : null;
    if (focusNode(node)) return true;
    if (selectedFeature?.content?.tile?.boundingSphere) {
      focusSphere(selectedFeature.content.tile.boundingSphere);
      return true;
    }
    showToast("请先选择一个模型构件");
    return false;
  };
  $("#focusSelection").addEventListener("click", focusCurrentSelection);
  window.addEventListener("keydown", (event) => {
    const target = event.target;
    const isEditing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (isEditing || event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== "f") return;
    event.preventDefault();
    if (focusCurrentSelection()) showToast("已聚焦当前选中构件");
  });
  $("#toggleSpin").addEventListener("click", (event) => {
    spinning = !spinning;
    event.currentTarget.classList.toggle("active", spinning);
    showToast(spinning ? "自动旋转已开启" : "自动旋转已关闭");
  });
  $("#toggleFullscreen").addEventListener("click", async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  });
  $("#hideSelected").addEventListener("click", toggleSelectedVisibility);
  $("#isolateSelected").addEventListener("click", isolateSelectedComponents);
  $("#translucentSelected").addEventListener("click", toggleSelectedTransparency);
  $("#showAllObjects").addEventListener("click", showAllComponents);
  updateVisibilityControlState();
  $("#loadTree").addEventListener("click", loadStructure);
  $("#collapseLeft").addEventListener("click", () => document.body.classList.add("left-collapsed"));
  $("#collapseRight").addEventListener("click", () => document.body.classList.add("right-collapsed"));
  $("#reopenLeft").addEventListener("click", () => document.body.classList.remove("left-collapsed"));
  $("#reopenRight").addEventListener("click", () => document.body.classList.remove("right-collapsed"));
  viewer.clock.onTick.addEventListener(() => {
    if (spinning) orbitCamera(0.18, 0);
  });
}

async function init() {
  updateClock();
  setInterval(updateClock, 1000);
  checkService();
  createViewer();
  setupControls();
  setupPicking();
  setupFpsMeter();
  const weldingPromise = loadWeldingDates();
  const structurePromise = loadStructure();
  await loadModel();
  await Promise.all([structurePromise, weldingPromise]);
}

init();
