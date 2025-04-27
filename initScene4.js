import * as THREE from 'three';
import Stats from 'stats';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'; // Import GLTFLoader

let scene, camera, renderer, ambientLight, pointLight;
let floor, departments = [], agents = [];
let speed = 1;
let agentCount = 50;
let isPaused = false;
let showTrails = false;
let stats;
let controls;
let loadedFont = null; // To store loaded font
let loadedGltfModel = null; // To store loaded GLTF model

const agentRadius = 5; // Keep for reference, but model size is now primary
const trailLength = 50;
const agentColor = 0x555555; // Uniform agent color (mid-grey)
const initialCameraPosition = new THREE.Vector3(0, 300, 500);
const initialControlsTarget = new THREE.Vector3(0, 50, 0);

// --- Configuration for Avatar Model ---
// !!! IMPORTANT: Replace this with the actual path/URL to your model !!!
const MODEL_URL = '/Models/low_poly_character.glb'; // e.g., 'models/human_lowpoly.glb' or a web URL
const MODEL_SCALE = 8; // !!! Adjust this scale based on your model's original size !!!
let modelBaseHeightOffset = 0; // Calculated offset to place feet on floor

// --- Loader Instances ---
const fontLoader = new FontLoader();
const gltfLoader = new GLTFLoader();

// --- Async Loading Functions ---
function loadFont(url) {
    return new Promise((resolve, reject) => {
        fontLoader.load(url, resolve, undefined, reject);
    });
}

function loadGLTFModel(url) {
    return new Promise((resolve, reject) => {
        gltfLoader.load(url, resolve, undefined, reject);
    });
}


async function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color("white");

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 2000);
    camera.position.copy(initialCameraPosition);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    pointLight = new THREE.PointLight(0xffffff, 1.2);
    pointLight.position.set(0, 200, 0);
    pointLight.castShadow = true;
    pointLight.shadow.mapSize.width = 1024;
    pointLight.shadow.mapSize.height = 1024;
    pointLight.shadow.camera.near = 10;
    pointLight.shadow.camera.far = 500;
    pointLight.shadow.bias = -0.001; // Note: Corrected variable name from pointlight to pointLight
    scene.add(pointLight);

    const floorGeometry = new THREE.PlaneGeometry(800, 500);
    const floorMaterial = new THREE.MeshStandardMaterial({
        color: "#cccccc", side: THREE.DoubleSide, roughness: 0.8, metalness: 0.2
    });
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    // --- Load Assets Asynchronously ---
    try {
        console.log("Loading assets...");
        [loadedFont, loadedGltfModel] = await Promise.all([
            loadFont('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json'),
            loadGLTFModel(MODEL_URL)
        ]);
        console.log("Assets loaded successfully.");

        // Pre-calculate model height offset after loading and scaling
        const tempMesh = loadedGltfModel.scene.clone();
        tempMesh.scale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
        const box = new THREE.Box3().setFromObject(tempMesh);
        modelBaseHeightOffset = -box.min.y; // Offset needed to bring bottom to y=0

    } catch (error) {
        console.error("Error loading assets:", error);
        // Handle loading errors (e.g., display a message)
        // alert(Failed to load assets. Check console and MODEL_URL (${MODEL_URL}). Simulation cannot start.);
        return; // Stop initialization
    }
     // -------------------------------- //

    createDepartments('baseline'); // Now uses loadedFont

    stats = new Stats();
    const statsContainer = document.getElementById('stats-container');
    if (statsContainer) {
        statsContainer.appendChild(stats.dom);
    } else {
        console.warn("Stats container not found.");
    }

    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(initialControlsTarget);
    controls.enableDamping = true;
    controls.dampingFactor = 0.15; // Increased damping factor for quicker stop
    controls.update();

    // --- Event Listeners ---
    window.addEventListener('resize', onWindowResize);
    document.getElementById('startPause').onclick = toggleSimulation;
    document.getElementById('reset').onclick = () => resetScene(); // Use arrow func to ensure correct context if needed
    document.getElementById('resetView').onclick = resetView;
    document.getElementById('speed').oninput = e => speed = +e.target.value;
    document.getElementById('count').onchange = e => resetScene(+e.target.value); // Pass new count directly
    document.getElementById('scenario').onchange = e => switchLayout(e.target.value);
    document.getElementById('trails').onchange = e => {
        showTrails = e.target.checked;
        if (!showTrails) {
            agents.forEach(agent => {
                if (agent.trail) {
                    scene.remove(agent.trail);
                    agent.trail.geometry.dispose();
                    agent.trail.material.dispose();
                    agent.trail = null;
                    agent.trails = [];
                }
            });
        }
    }
    // ----------------------- //


    spawnAgents(agentCount); // Now uses loadedGltfModel
    animate();
}

function createDepartments(layout) {
    // Ensure font is loaded before creating departments with text
    if (!loadedFont) {
        console.error("Font not loaded, cannot create departments.");
        return;
    }

    departments.forEach(dept => {
        if (dept.mesh) scene.remove(dept.mesh);
        if (dept.wireframe) scene.remove(dept.wireframe);
        if (dept.label) scene.remove(dept.label);
    });
    departments = [];

    let layoutConfig;
     if (layout === 'baseline') {
        layoutConfig = [
            { name: 'Produce', size: [180, 80, 90], position: [-110, 40, 130], color: 0xaec6cf }, // Pastel Blue
            { name: 'Dairy', size: [180, 80, 90], position: [110, 40, 130], color: 0x98fb98 },   // Pale Green
            { name: 'Bakery', size: [380, 80, 90], position: [0, 40, -130], color: 0xffe4c4 }    // Peach
        ];
    } else if (layout === 'alternate') {
        layoutConfig = [
            { name: 'Electronics', size: [230, 80, 90], position: [-180, 40, 0], color: 0xd8bfd8 }, // Lavender
            { name: 'Apparel', size: [230, 80, 90], position: [180, 40, 0], color: 0xffdab9 }   // Light Orange
        ];
    }

    layoutConfig.forEach(config => {
        const { name, size, position, color } = config;
        const geometry = new THREE.BoxGeometry(...size);

        const fillMaterial = new THREE.MeshStandardMaterial({
            color: color, transparent: true, opacity: 0.3, roughness: 0.7, metalness: 0.1
        });
        const mesh = new THREE.Mesh(geometry, fillMaterial);
        mesh.position.set(position[0], position[1], position[2]);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        scene.add(mesh);

        const edgesGeometry = new THREE.EdgesGeometry(geometry);
        const lineMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 1.5 });
        const wireframe = new THREE.LineSegments(edgesGeometry, lineMaterial);
        wireframe.position.copy(mesh.position);
        scene.add(wireframe);

        const textGeometry = new TextGeometry(name, {
            font: loadedFont, size: 15, depth: 1,
        });
        const textMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
        const textMesh = new THREE.Mesh(textGeometry, textMaterial);
        textGeometry.computeBoundingBox();
        const centerOffset = -0.5 * (textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x);
        textMesh.position.set(position[0] + centerOffset, position[1] + size[1] / 2 + 10, position[2]);
        textMesh.rotation.y = Math.PI / 20;
        scene.add(textMesh);

        departments.push({ name, mesh, wireframe, label: textMesh, config });
    });
}


function switchLayout(layout) {
    createDepartments(layout);
    agents.forEach(agent => {
        if (agent.mesh) scene.remove(agent.mesh); // Remove avatar model
        if (agent.trail) scene.remove(agent.trail);
    });
    agents = [];
    spawnAgents(agentCount); // Respawn avatars
}

function spawnAgents(n) {
    // Ensure model is loaded before spawning agents
    if (!loadedGltfModel) {
        console.error("GLTF Model not loaded, cannot spawn agents.");
        return;
    }

    const spawnWidth = 780;
    const spawnDepth = 480;

    for (let i = 0; i < n; i++) {
        const x = THREE.MathUtils.randFloatSpread(spawnWidth);
        const z = THREE.MathUtils.randFloatSpread(spawnDepth);
        const y = modelBaseHeightOffset; // Place feet at y=0 based on pre-calculated offset

        // --- Create Agent using GLTF Model ---
        const avatar = loadedGltfModel.scene.clone(true); // Deep clone the model scene graph
        avatar.scale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE); // Apply scaling

        // Set position after scaling and calculating offset
        avatar.position.set(x, y, z);

        // Traverse the loaded model to apply settings
        avatar.traverse(function (object) {
            if (object.isMesh) {
                object.castShadow = true; // Make all parts of the model cast shadows
                object.receiveShadow = false;

                // Apply uniform color (optional: could keep original materials)
                if (object.material) {
                     if (Array.isArray(object.material)) {
                        object.material.forEach(mat => {
                            if (mat.isMeshStandardMaterial || mat.isMeshBasicMaterial) {
                                mat.color.setHex(agentColor);
                            }
                        });
                    } else if (object.material.isMeshStandardMaterial || object.material.isMeshBasicMaterial) {
                        object.material.color.setHex(agentColor);
                    }
                 }
            }
        });
        // -------------------------------------

        scene.add(avatar); // Add the avatar group to the scene

        const vx = THREE.MathUtils.randFloatSpread(5);
        const vz = THREE.MathUtils.randFloatSpread(5);
        const velocity = new THREE.Vector3(vx, 0, vz); // Velocity remains planar

        // Store the avatar group as the agent's mesh
        agents.push({ mesh: avatar, velocity, trails: [], inDepartment: null, baseHeight: y });
    }
    // updateUIDisplay();
}

function updateAgents(delta) {
    if (isPaused) return;

    const effectiveSpeed = speed * delta * 60;

    agents.forEach(agent => {
        if (!agent.mesh) return; // Skip if mesh somehow doesn't exist

        const scaledVelocity = agent.velocity.clone().multiplyScalar(effectiveSpeed);
        agent.mesh.position.add(scaledVelocity);
        // Ensure Y position remains correct (especially important for avatars)
        agent.mesh.position.y = agent.baseHeight;

        // Trail management (position based on agent's root position)
        if (showTrails) {
            agent.trails.push(agent.mesh.position.clone());
            if (agent.trails.length > trailLength) {
                agent.trails.shift();
            }
            updateTrail(agent);
        } else if (agent.trail) {
            scene.remove(agent.trail);
            agent.trail.geometry.dispose();
            agent.trail.material.dispose();
            agent.trail = null;
            agent.trails = [];
        }

        // Boundary collision (using agent's position)
        // Use a slightly larger boundary check if needed based on avatar size? For now, position based.
        const avatarRadiusApprox = MODEL_SCALE * 0.5; // Rough approximation
        const halfWidth = 800 / 2 - avatarRadiusApprox; // Use approx radius
        const halfDepth = 500 / 2 - avatarRadiusApprox; // Use approx radius


        if (Math.abs(agent.mesh.position.x) > halfWidth) {
            agent.velocity.x *= -1;
            agent.mesh.position.x = Math.sign(agent.mesh.position.x) * halfWidth;
        }
        if (Math.abs(agent.mesh.position.z) > halfDepth) {
            agent.velocity.z *= -1;
            agent.mesh.position.z = Math.sign(agent.mesh.position.z) * halfDepth;
        }

        // Department collision
        departments.forEach(department => {
            if (!department.mesh) return;
            const box = new THREE.Box3().setFromObject(department.mesh);

            // Use agent's position for containment check
            if (box.containsPoint(agent.mesh.position)) {
                const closestPoint = new THREE.Vector3();
                box.clampPoint(agent.mesh.position, closestPoint);
                const normal = agent.mesh.position.clone().sub(closestPoint).normalize();

                if (normal.lengthSq() > 0.0001) {
                    const dotProduct = agent.velocity.dot(normal);
                    const reflection = new THREE.Vector3().subVectors(agent.velocity, normal.multiplyScalar(2 * dotProduct));
                    agent.velocity.copy(reflection);
                    const nudge = normal.clone().multiplyScalar(0.5); // Nudge slightly more for potentially larger models
                    agent.mesh.position.add(nudge);
                } else {
                    agent.velocity.multiplyScalar(-1);
                }
            }
        });
    });
}


function updateTrail(agent) {
    if (agent.trails.length < 2) return;
    if (!agent.mesh) return; // Need mesh to exist

    const points = agent.trails;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    // Use the uniform agent color for the trail base color
    const baseColor = new THREE.Color(agentColor);
    const colors = [];
    const trailStartColor = new THREE.Color(0x333333);

    for (let i = 0; i < points.length; i++) {
        const alpha = i / (points.length - 1);
        const trailColor = trailStartColor.clone().lerp(baseColor, alpha);
        colors.push(trailColor.r, trailColor.g, trailColor.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        linewidth: 1
    });

    if (agent.trail) {
        agent.trail.geometry.dispose();
        agent.trail.geometry = geometry;
    } else {
        agent.trail = new THREE.Line(geometry, material);
        scene.add(agent.trail);
    }
}

function render() {
    renderer.render(scene, camera);
}

let lastTime = performance.now();
let lastFPSTime = performance.now();
let frames = 0;

// function updateUIDisplay() {
//     document.getElementById('agents-count').textContent = Agents: ${agents.length};
// }


function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;
    frames++;

    if (now - lastFPSTime >= 1000) {
        const fps = frames;
        // document.getElementById('fps').textContent = FPS: ${fps};
        frames = 0;
        lastFPSTime = now;
        // updateUIDisplay();
    }

    if (!isPaused) {
        updateAgents(delta);
    }

    controls.update(); // REQUIRED for damping to work correctly
    render();
    if (stats) stats.update();
}


function resetScene(newCount) {
    // Clear existing agents and trails
    agents.forEach(agent => {
        if (agent.mesh) scene.remove(agent.mesh); // Ensure avatar model is removed
        if (agent.trail) {
            scene.remove(agent.trail);
            agent.trail.geometry.dispose();
            agent.trail.material.dispose();
        }
    });
    agents = [];

    if (newCount !== undefined && !isNaN(newCount)) {
        agentCount = newCount;
        document.getElementById('count').value = agentCount;
    } else {
        agentCount = parseInt(document.getElementById('count').value) || 50;
    }

    // Respawn agents (requires loaded model)
    if(loadedGltfModel) {
        spawnAgents(agentCount);
    } else {
        console.warn("Model not loaded yet, cannot respawn agents during reset.");
    }

    updateUIDisplay();
}


function toggleSimulation() {
    isPaused = !isPaused;
    document.getElementById('startPause').textContent = isPaused ? '▶ Resume' : '❚❚ Pause';
}

function resetView() {
    camera.position.copy(initialCameraPosition);
    controls.target.copy(initialControlsTarget);
    controls.update(); // Required after manually changing camera/target
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start the simulation initialization
initScene();