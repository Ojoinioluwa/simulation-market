import * as THREE from 'three';
import Stats from 'stats';
// import MODEL_URL from "./Models/Man.glb"
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

// --- Three.js Setup ---
let scene, camera, renderer, ambientLight, pointLight, clock;
let floor, departments = [], agents = [];
let portalMeshes = []; // To keep track of portal visualization meshes
let controls;
let stats;

// --- Simulation Parameters ---
let speed = 1;
let agentCount = 25; // Reduced default count due to increased complexity
let isPaused = false;
let showTrails = false;

// --- Asset Loading ---
let loadedFont = null;
let loadedGltfModel = null; // Will store GLTF data including scene and animations
const fontLoader = new FontLoader();
const gltfLoader = new GLTFLoader();
const MODEL_URL = "./Models/Man.glb" // ADJUST PATH AS NEEDED
const MODEL_SCALE = 8;
let modelBaseHeightOffset = 0; // Calculated offset to place feet on floor

// --- Agent Behavior & Animation ---
const MIN_AGENT_SEPARATION = MODEL_SCALE * 1.5; // Base separation on model scale
const PORTAL_WIDTH_FACTOR = MODEL_SCALE * 1.8; // How wide portals are relative to scale
const PORTAL_THRESHOLD = MODEL_SCALE * 0.6; // How close agent needs to be to interact with portal center
const AGENT_MOVE_SPEED = 1.0 * MODEL_SCALE; // Base speed related to model size
const ANIMATION_FADE_DURATION = 0.2; // Seconds for animation crossfade
const VELOCITY_THRESHOLD_SQ = 0.01 * MODEL_SCALE * 0.01 * MODEL_SCALE; // Threshold to consider agent stopped (squared)

// --- Department Interaction ---
const IDLE_CHANCE = 0.002;      // Chance per second to start idling
const MIN_IDLE_TIME = 2.0;
const MAX_IDLE_TIME = 6.0;
const MIN_TIME_IN_DEPT = 8.0;
const MAX_TIME_IN_DEPT = 20.0;
const DEPT_VISIT_CHANCE = 0.05; // Chance per second for a wandering agent to pick a department

// --- Agent States (Expanded) ---
const AGENT_STATE = {
    WANDERING: 'WANDERING',         // Moving freely outside departments
    GOING_TO_DEPT: 'GOING_TO_DEPT', // Moving towards an entry portal
    WAITING_ENTRY: 'WAITING_ENTRY', // In queue outside an entry portal
    ENTERING: 'ENTERING',           // Crossing the entry portal threshold
    INSIDE_DEPT: 'INSIDE_DEPT',     // Moving freely inside a department
    GOING_TO_EXIT: 'GOING_TO_EXIT', // Moving towards an exit portal
    WAITING_EXIT: 'WAITING_EXIT',   // In queue inside an exit portal
    EXITING: 'EXITING',             // Crossing the exit portal threshold
    IDLE: 'IDLE',                   // Standing still (temporarily)
};

// --- Trail Settings ---
const trailLength = 30;
const agentColor = 0x555555;

// --- Camera Settings ---
const initialCameraPosition = new THREE.Vector3(0, 250, 400); // Adjusted initial view
const initialControlsTarget = new THREE.Vector3(0, 0, 0);

// --- Raycasting ---
const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0); // For potential future floor sticking if needed

//=============================================================================
// ASSET LOADING
//=============================================================================

function loadFont(url) {
    return new Promise((resolve, reject) => {
        fontLoader.load(url, resolve, undefined, reject);
    });
}

function loadGLTFModel(url) {
    return new Promise((resolve, reject) => {
        // Ensure animations are loaded with the model
        gltfLoader.load(url, (gltf) => {
            console.log("GLTF Loaded:", gltf);
             // Log available animations
             if (gltf.animations && gltf.animations.length > 0) {
                console.log(`Found ${gltf.animations.length} animations:`);
                gltf.animations.forEach(clip => console.log(`- ${clip.name}`));
            } else {
                console.warn("GLTF model contains no animations!");
            }
            resolve(gltf);
        }, undefined, reject);
    });
}

//=============================================================================
// INITIALIZATION
//=============================================================================

async function initScene() {
    clock = new THREE.Clock(); // Clock for animation updates
    scene = new THREE.Scene();
    scene.background = new THREE.Color("white");

    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 3000); // Increased far plane
    camera.position.copy(initialCameraPosition);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    // --- Lighting ---
    ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    pointLight = new THREE.PointLight(0xffffff, 1.0, 1500); // Increased intensity slightly, added decay distance
    pointLight.position.set(50, 300, 150);
    pointLight.castShadow = true;
    pointLight.shadow.mapSize.width = 1024;
    pointLight.shadow.mapSize.height = 1024;
    pointLight.shadow.camera.near = 10;
    pointLight.shadow.camera.far = 800;
    pointLight.shadow.bias = -0.005; // Adjust bias carefully if shadow acne occurs
    scene.add(pointLight);
    // const pointLightHelper = new THREE.PointLightHelper( pointLight, 10 );
    // scene.add( pointLightHelper );
     // Add a hemisphere light for softer ambient fill
     const hemiLight = new THREE.HemisphereLight( 0xffffff, 0xcccccc, 0.4 );
     scene.add( hemiLight );


    // --- Floor ---
    const floorGeometry = new THREE.PlaneGeometry(800, 500);
    const floorMaterial = new THREE.MeshStandardMaterial({
        color: "#cccccc", side: THREE.DoubleSide, roughness: 0.9, metalness: 0.1 // Less reflective floor
    });
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    // --- Load Assets ---
    try {
        console.log("Loading assets...");
        [loadedFont, loadedGltfModel] = await Promise.all([
            loadFont('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json'),
            loadGLTFModel(MODEL_URL)
        ]);
        console.log("Assets loaded successfully.");

        // Calculate model height offset (only needs scene)
        const tempMesh = loadedGltfModel.scene.clone();
        tempMesh.scale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
        const box = new THREE.Box3().setFromObject(tempMesh);
        modelBaseHeightOffset = -box.min.y; // Offset needed to bring model's lowest point to y=0

    } catch (error) {
        console.error("Error loading assets:", error);
        alert(`Failed to load critical assets (Font or GLTF Model: ${MODEL_URL}). Check console and file paths. Simulation cannot start.`);
        return; // Stop initialization
    }

    // --- Create Initial Departments ---
    createDepartments('baseline');

    // --- Stats.js ---
    stats = new Stats();
    const statsContainer = document.getElementById('stats-container');
    if (statsContainer) {
        statsContainer.appendChild(stats.dom);
    }

    // --- OrbitControls ---
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(initialControlsTarget);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07; // Adjust for desired coasting
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent looking straight down or below floor
    controls.minDistance = 50;
    controls.maxDistance = 1000;
    controls.update();

    // --- Event Listeners & UI Setup ---
    setupUIEventListeners();

    // --- Spawn Initial Agents ---
    spawnAgents(agentCount);
    updateUIDisplay();

    // --- Start Animation Loop ---
    animate();
}

//=============================================================================
// DEPARTMENT CREATION & PORTAL SETUP
//=============================================================================

function createDepartments(layout) {
    if (!loadedFont) return;

    // --- Clear Existing ---
    departments.forEach(dept => {
        scene.remove(dept.mesh);
        scene.remove(dept.wireframe);
        if (dept.label) scene.remove(dept.label);
    });
    departments = [];
    portalMeshes.forEach(mesh => scene.remove(mesh));
    portalMeshes = [];

    // --- Define Layouts with Separate Portals ---
    let layoutConfig;
    const portalWidth = PORTAL_WIDTH_FACTOR; // Use defined factor
    if (layout === 'baseline') {
        layoutConfig = [
            { name: 'Produce', size: [180, 80, 90], position: [-110, 40, 130], color: 0xaec6cf,
              entryPortal: { face: 'z-', width: portalWidth, offset: -40 }, // Offset along face edge
              exitPortal:  { face: 'z-', width: portalWidth, offset: 40 }
            },
            { name: 'Dairy', size: [180, 80, 90], position: [110, 40, 130], color: 0x98fb98,
              entryPortal: { face: 'x-', width: portalWidth, offset: 0 }, // Centered on face
              exitPortal:  { face: 'z-', width: portalWidth, offset: 0 }
            },
            { name: 'Bakery', size: [380, 80, 90], position: [0, 40, -130], color: 0xffe4c4,
              entryPortal: { face: 'x+', width: portalWidth, offset: -60 },
              exitPortal:  { face: 'x+', width: portalWidth, offset: 60 }
            }
        ];
    } else if (layout === 'alternate') {
        layoutConfig = [
             { name: 'Electronics', size: [230, 80, 90], position: [-180, 40, 0], color: 0xd8bfd8,
               entryPortal: { face: 'z+', width: portalWidth, offset: -50 },
               exitPortal:  { face: 'z+', width: portalWidth, offset: 50 }
             },
             { name: 'Apparel', size: [230, 80, 90], position: [180, 40, 0], color: 0xffdab9,
                entryPortal: { face: 'z-', width: portalWidth, offset: -50 },
                exitPortal:  { face: 'z-', width: portalWidth, offset: 50 }
             }
        ];
    }

    // --- Create Department Meshes and Portal Data ---
    layoutConfig.forEach(config => {
        const dept = createSingleDepartment(config);
        if (dept) {
            departments.push(dept);
        }
    });
}

function createSingleDepartment(config) {
    const { name, size, position, color, entryPortal, exitPortal } = config;
    const geometry = new THREE.BoxGeometry(...size);

    // Main mesh
    const fillMaterial = new THREE.MeshStandardMaterial({
        color: color, transparent: true, opacity: 0.3, roughness: 0.7, metalness: 0.1
    });
    const mesh = new THREE.Mesh(geometry, fillMaterial);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = false; // Interior shouldn't cast shadow outwards
    mesh.receiveShadow = true;
    mesh.userData.isDepartment = true;
    mesh.userData.config = config; // Store config for easy access
    scene.add(mesh);

    // Wireframe
    const edgesGeometry = new THREE.EdgesGeometry(geometry);
    const lineMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 1.5 }); // Linewidth > 1 might not work consistently
    const wireframe = new THREE.LineSegments(edgesGeometry, lineMaterial);
    wireframe.position.copy(mesh.position);
    scene.add(wireframe);

    // Label
    let textMesh = null;
    try {
        const textGeometry = new TextGeometry(name, { font: loadedFont, size: 15, depth: 1 });
        textGeometry.computeBoundingBox();
        const centerOffset = -0.5 * (textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x);
        const textMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 });
        textMesh = new THREE.Mesh(textGeometry, textMaterial);
        textMesh.position.set(position[0] + centerOffset, position[1] + size[1] / 2 + 15, position[2]); // Slightly higher
        textMesh.rotation.y = Math.PI / 20;
        scene.add(textMesh);
    } catch (e) {
        console.error("Error creating text geometry for:", name, e);
    }


    // --- Calculate and Store Portal Data ---
    const deptData = { name, mesh, wireframe, label: textMesh, config };
    const halfSize = { x: size[0] / 2, y: size[1] / 2, z: size[2] / 2 };

    // Entry Portal
    deptData.entryPortal = calculatePortalData(entryPortal, position, halfSize, modelBaseHeightOffset);
    visualizePortal(deptData.entryPortal, 0x00ff00); // Green for entry

    // Exit Portal
    deptData.exitPortal = calculatePortalData(exitPortal, position, halfSize, modelBaseHeightOffset);
    visualizePortal(deptData.exitPortal, 0xff0000); // Red for exit

    return deptData;
}

function calculatePortalData(portalConfig, deptPos, halfSize, floorY) {
    const { face, width, offset } = portalConfig;
    const center = new THREE.Vector3(deptPos[0], floorY, deptPos[2]); // Base center at floor level
    const worldPos = new THREE.Vector3(deptPos[0], floorY, deptPos[2]); // Portal position on the wall face
    const faceNormal = new THREE.Vector3();
    let offsetAxis = 'z'; // Default offset axis

    switch (face) {
        case 'x+':
            worldPos.x += halfSize.x;
            worldPos.z += offset;
            faceNormal.set(1, 0, 0);
            offsetAxis = 'z';
            break;
        case 'x-':
            worldPos.x -= halfSize.x;
            worldPos.z += offset;
            faceNormal.set(-1, 0, 0);
            offsetAxis = 'z';
            break;
        case 'z+':
            worldPos.z += halfSize.z;
            worldPos.x += offset;
            faceNormal.set(0, 0, 1);
            offsetAxis = 'x';
            break;
        case 'z-':
            worldPos.z -= halfSize.z;
            worldPos.x += offset;
            faceNormal.set(0, 0, -1);
            offsetAxis = 'x';
            break;
    }

    return {
        center: center,       // Department center (for internal targeting maybe)
        width: width,
        faceNormal: faceNormal,
        worldPos: worldPos,   // Center point of the portal line on the wall
        offsetAxis: offsetAxis, // Which axis (x or z) the portal extends along
        isOccupied: false,
        queue: [],
        config: portalConfig // Keep original config if needed
    };
}


function visualizePortal(portalData, color) {
    if (!portalData) return;
    const { worldPos, width, offsetAxis } = portalData;
    const halfWidth = width / 2;
    const portalY = worldPos.y + 1.0; // Visualize slightly above floor
    const points = [];

    if (offsetAxis === 'z') { // Portal runs along Z axis on an X face
        points.push(new THREE.Vector3(worldPos.x, portalY, worldPos.z - halfWidth));
        points.push(new THREE.Vector3(worldPos.x, portalY, worldPos.z + halfWidth));
    } else { // Portal runs along X axis on a Z face
        points.push(new THREE.Vector3(worldPos.x - halfWidth, portalY, worldPos.z));
        points.push(new THREE.Vector3(worldPos.x + halfWidth, portalY, worldPos.z));
    }

    const portalGeom = new THREE.BufferGeometry().setFromPoints(points);
    const portalMat = new THREE.LineBasicMaterial({ color: color, linewidth: 3 }); // Linewidth > 1 might not work consistently
    const portalLine = new THREE.Line(portalGeom, portalMat);
    scene.add(portalLine);
    portalMeshes.push(portalLine);
}

//=============================================================================
// AGENT SPAWNING & SETUP
//=============================================================================

function spawnAgents(n) {
    if (!loadedGltfModel || !loadedGltfModel.scene || !loadedGltfModel.animations) {
        console.error("GLTF Model, its scene, or animations not loaded properly. Cannot spawn agents.");
        return;
    }

    // --- Clear existing agents ---
    agents.forEach(agent => {
        if (agent.mesh) scene.remove(agent.mesh);
        if (agent.mixer) agent.mixer.stopAllAction(); // Stop animations
        removeTrail(agent);
    });
    agents = [];

    const spawnWidth = 780;
    const spawnDepth = 480;
    console.log("Animations in model:", loadedGltfModel.animations.map(a => a.name));

    // --- Find required animation clips ---
     // Use lowercase for case-insensitive matching
     const availableAnimations = loadedGltfModel.animations.map(a => a.name);
     console.log("Available animations:", availableAnimations);
     
     const walkClip = THREE.AnimationClip.findByName(loadedGltfModel.animations, 'HumanArmature|Man_Walk') 
                    ?? THREE.AnimationClip.findByName(loadedGltfModel.animations, 'HumanArmature|Man_Walk');
     
     const idleClip = THREE.AnimationClip.findByName(loadedGltfModel.animations, 'HumanArmature|Man_Standing') 
                    ?? THREE.AnimationClip.findByName(loadedGltfModel.animations, 'HumanArmature|Man_Standing');
                    
        
                    
     
     if (!walkClip) console.warn('⚠️ No "Walk" or "walk" animation found.');
     if (!idleClip) console.warn('⚠️ No "Idle" or "idle" animation found.');     
    if (!walkClip || !idleClip) {
         alert("Required animations ('Walk'/'walk' and 'Idle'/'idle') not found in the model. Agents will not animate.");
         // Allow simulation to continue without animation if clips aren't found
     }


    // --- Spawn Loop ---
    for (let i = 0; i < n; i++) {
        const x = THREE.MathUtils.randFloatSpread(spawnWidth);
        const z = THREE.MathUtils.randFloatSpread(spawnDepth);
        const y = modelBaseHeightOffset;
        const avatar = SkeletonUtils.clone(loadedGltfModel.scene);
        // const avatar = THREE.SkeletonUtils.clone(loadedGltfModel.scene); // Use SkeletonUtils for cloning animated models
        avatar.scale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
        avatar.position.set(x, y, z);

        // Apply shadows and potentially materials (careful with cloning materials if needed)
        avatar.traverse(function (object) {
            if (object.isMesh) {
                object.castShadow = true;
                object.receiveShadow = true; // Allow avatar parts to receive shadows
                // Optional: Assign material color if needed (ensure materials are cloned properly if modified)
                // if (object.material) { ... apply color ... }
            }
        });

        scene.add(avatar);

        // Initial velocity
        const vx = THREE.MathUtils.randFloatSpread(1);
        const vz = THREE.MathUtils.randFloatSpread(1);
        const velocity = new THREE.Vector3(vx, 0, vz).normalize().multiplyScalar(AGENT_MOVE_SPEED * THREE.MathUtils.randFloat(0.8, 1.2));

        // --- Animation Setup ---
        let mixer = null;
        let actions = {};
        let currentAction = null;

         if (walkClip && idleClip) { // Only setup animations if clips were found
             mixer = new THREE.AnimationMixer(avatar);
             actions.walk = mixer.clipAction(walkClip);
             actions.idle = mixer.clipAction(idleClip);

             // Set initial action
             actions.idle.play();
             currentAction = actions.idle;
         } else {
              console.warn(`Agent ${i} created without animations due to missing clips.`);
         }


        // --- Create Agent Object ---
        agents.push({
            id: i, // Simple ID for debugging
            mesh: avatar,
            velocity: velocity,
            baseHeight: y,
            state: AGENT_STATE.WANDERING,
            idleTimer: 0,
            timeInDepartment: 0,
            targetDepartment: null, // Reference to the department object
            portalTarget: null,     // Reference to the specific portal object (dept.entryPortal or dept.exitPortal)
            targetPosition: null,   // Specific world coordinate target (e.g., inside dept)
            previousState: null,    // For resuming after idle
            // Animation properties
            mixer: mixer,
            actions: actions,         // e.g., { walk: AnimationAction, idle: AnimationAction }
            currentAction: currentAction,
            // Trail properties
            trails: [],
            trail: null,
        });
    }
}

//=============================================================================
// AGENT UPDATE LOGIC (Core Loop)
//=============================================================================

function updateAgents(delta) {
    if (isPaused || departments.length === 0) return;

    const effectiveSpeedFactor = speed * delta; // Factor to scale base speed

    // --- Agent-Agent Collision (Simple Bounce) ---
    handleAgentAgentCollisions();

    // --- Update Each Agent ---
    agents.forEach(agent => {
        if (!agent.mesh) return;

        // 1. Update State Machine (Handles decisions, target changes, timers)
        updateAgentState(agent, delta);

        // 2. Handle Movement (Based on state and velocity)
        updateAgentMovement(agent, delta, effectiveSpeedFactor);

        // 3. Handle Collisions (Walls, Portals) - Modifies position/velocity if needed
        handleAgentEnvironmentCollisions(agent, delta, effectiveSpeedFactor);

        // 4. Update Animation (Based on final velocity)
        updateAgentAnimation(agent);

        // 5. Update Trail
        updateAgentTrail(agent);
    });

     // --- Process Portal Queues ---
     // (Could be done less frequently, but per frame is safest for now)
     processPortalQueues();

}

//-----------------------------------------------------------------------------
// Agent Update Helper Functions
//-----------------------------------------------------------------------------

function updateAgentState(agent, delta) {
    switch (agent.state) {
        case AGENT_STATE.IDLE:
            agent.idleTimer -= delta;
            if (agent.idleTimer <= 0) {
                agent.state = agent.previousState || AGENT_STATE.WANDERING;
                 // Restore velocity if applicable (e.g., if was heading to a portal)
                 if(agent.portalTarget) {
                     agent.velocity = agent.portalTarget.worldPos.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(AGENT_MOVE_SPEED);
                 } else if (agent.targetPosition) { // Or heading to internal point
                      agent.velocity = agent.targetPosition.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(AGENT_MOVE_SPEED * 0.7);
                 } else if (agent.state === AGENT_STATE.WANDERING) { // Or just start wandering again
                      agent.velocity.set(THREE.MathUtils.randFloatSpread(1), 0, THREE.MathUtils.randFloatSpread(1)).normalize().multiplyScalar(AGENT_MOVE_SPEED);
                 }
            }
            break;

        case AGENT_STATE.WANDERING:
            // Chance to visit a department?
            if (Math.random() < DEPT_VISIT_CHANCE * delta) {
                agent.targetDepartment = departments[Math.floor(Math.random() * departments.length)];
                if (agent.targetDepartment && agent.targetDepartment.entryPortal) {
                    agent.portalTarget = agent.targetDepartment.entryPortal; // Target the entry portal object
                    agent.state = AGENT_STATE.GOING_TO_DEPT;
                    agent.velocity = agent.portalTarget.worldPos.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(AGENT_MOVE_SPEED);
                } else {
                    agent.targetDepartment = null; // Invalid target
                }
            }
            // Chance to go idle?
            else if (Math.random() < IDLE_CHANCE * delta) {
                agent.previousState = AGENT_STATE.WANDERING;
                agent.state = AGENT_STATE.IDLE;
                agent.idleTimer = THREE.MathUtils.randFloat(MIN_IDLE_TIME, MAX_IDLE_TIME);
                agent.velocity.set(0, 0, 0);
            }
            break;

        case AGENT_STATE.GOING_TO_DEPT:
            if (!agent.portalTarget || !agent.targetDepartment) { agent.state = AGENT_STATE.WANDERING; break; } // Safety check
            // Check proximity to portal
            if (agent.mesh.position.distanceTo(agent.portalTarget.worldPos) < PORTAL_THRESHOLD) {
                if (!agent.portalTarget.isOccupied) {
                    // Portal is free, start entering
                    agent.portalTarget.isOccupied = true;
                    agent.state = AGENT_STATE.ENTERING;
                    // Velocity might slightly adjust to cross threshold directly
                    agent.velocity = agent.portalTarget.faceNormal.clone().negate().multiplyScalar(AGENT_MOVE_SPEED * 0.8); // Move into dept
                } else {
                    // Portal occupied, wait
                    agent.state = AGENT_STATE.WAITING_ENTRY;
                    agent.portalTarget.queue.push(agent); // Add to queue
                    agent.velocity.set(0, 0, 0); // Stop
                }
            } else {
                 // Still moving towards portal, ensure velocity points correctly
                  agent.velocity = agent.portalTarget.worldPos.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(AGENT_MOVE_SPEED);
            }
            break;

        case AGENT_STATE.ENTERING:
             if (!agent.portalTarget || !agent.targetDepartment) { agent.state = AGENT_STATE.WANDERING; break; }
             // Check if agent has crossed the portal threshold (based on position relative to portal plane)
             // Plane defined by portal normal and portal world position
              const distToPortalPlane = agent.mesh.position.clone().sub(agent.portalTarget.worldPos).dot(agent.portalTarget.faceNormal);
              // If dot product sign matches normal, agent is "outside", if opposite, agent is "inside"
             if (distToPortalPlane < -MODEL_SCALE * 0.5) { // Agent center is now sufficiently inside
                 // Finished entering
                 agent.state = AGENT_STATE.INSIDE_DEPT;
                 agent.portalTarget.isOccupied = false; // Free the portal
                 // processPortalQueues(); // Process queue immediately (or defer to main loop call)
                 agent.portalTarget = null; // No longer targeting this portal
                 agent.timeInDepartment = THREE.MathUtils.randFloat(MIN_TIME_IN_DEPT, MAX_TIME_IN_DEPT);
                 // Optional: pick a random internal target
                 agent.targetPosition = getRandomPointInDepartment(agent.targetDepartment);
                 if(agent.targetPosition) {
                      agent.velocity = agent.targetPosition.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(AGENT_MOVE_SPEED * 0.7); // Slower inside
                 } else { // Or just wander slowly
                     agent.velocity.set(THREE.MathUtils.randFloatSpread(1), 0, THREE.MathUtils.randFloatSpread(1)).normalize().multiplyScalar(AGENT_MOVE_SPEED * 0.5);
                 }
             }
             break;

        case AGENT_STATE.INSIDE_DEPT:
            agent.timeInDepartment -= delta;
             // Chance to go idle?
             if (agent.idleTimer <= 0 && Math.random() < IDLE_CHANCE * delta * 1.5) { // Slightly higher chance inside
                agent.previousState = AGENT_STATE.INSIDE_DEPT;
                agent.state = AGENT_STATE.IDLE;
                agent.idleTimer = THREE.MathUtils.randFloat(MIN_IDLE_TIME, MAX_IDLE_TIME);
                agent.velocity.set(0, 0, 0);
                break;
             }

            // Move towards internal target or wander
            if (agent.targetPosition) {
                if (agent.mesh.position.distanceTo(agent.targetPosition) < MODEL_SCALE) {
                    agent.targetPosition = getRandomPointInDepartment(agent.targetDepartment); // Pick new target
                }
                 // Update velocity if target exists
                 if(agent.targetPosition) agent.velocity = agent.targetPosition.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(AGENT_MOVE_SPEED * 0.7);
            } else {
                // If no target, velocity remains (will bounce off internal walls)
            }

            // Time to leave?
            if (agent.timeInDepartment <= 0 && agent.targetDepartment.exitPortal) {
                agent.portalTarget = agent.targetDepartment.exitPortal;
                agent.state = AGENT_STATE.GOING_TO_EXIT;
                agent.velocity = agent.portalTarget.worldPos.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(AGENT_MOVE_SPEED);
                agent.targetPosition = null; // Clear internal target
            }
            break;

         case AGENT_STATE.GOING_TO_EXIT:
             if (!agent.portalTarget || !agent.targetDepartment) { agent.state = AGENT_STATE.WANDERING; break; }
             // Check proximity
             if (agent.mesh.position.distanceTo(agent.portalTarget.worldPos) < PORTAL_THRESHOLD) {
                  if (!agent.portalTarget.isOccupied) {
                      // Portal free, start exiting
                     agent.portalTarget.isOccupied = true;
                     agent.state = AGENT_STATE.EXITING;
                     // Velocity should point out of department
                     agent.velocity = agent.portalTarget.faceNormal.clone().multiplyScalar(AGENT_MOVE_SPEED); // Move out along normal
                 } else {
                      // Portal occupied, wait
                     agent.state = AGENT_STATE.WAITING_EXIT;
                     agent.portalTarget.queue.push(agent);
                     agent.velocity.set(0, 0, 0);
                 }
             } else {
                 // Still moving towards portal
                  agent.velocity = agent.portalTarget.worldPos.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(AGENT_MOVE_SPEED);
             }
             break;

         case AGENT_STATE.EXITING:
             if (!agent.portalTarget || !agent.targetDepartment) { agent.state = AGENT_STATE.WANDERING; break; }
              // Check if agent has crossed the portal threshold (based on position relative to portal plane)
             const distToExitPortalPlane = agent.mesh.position.clone().sub(agent.portalTarget.worldPos).dot(agent.portalTarget.faceNormal);
              // Agent needs to be sufficiently outside (dot product positive and large enough)
             if (distToExitPortalPlane > MODEL_SCALE * 0.5) {
                  // Finished exiting
                 agent.state = AGENT_STATE.WANDERING;
                 agent.portalTarget.isOccupied = false; // Free the portal
                 // processPortalQueues(); // Process queue immediately
                 agent.portalTarget = null;
                 agent.targetDepartment = null;
                 // Assign new wandering velocity
                 agent.velocity.set(THREE.MathUtils.randFloatSpread(1), 0, THREE.MathUtils.randFloatSpread(1)).normalize().multiplyScalar(AGENT_MOVE_SPEED);
             }
             break;

         // WAITING states are handled by processPortalQueues() - no action needed here
         case AGENT_STATE.WAITING_ENTRY:
         case AGENT_STATE.WAITING_EXIT:
            agent.velocity.set(0,0,0); // Ensure they stay stopped
            break;

    }
}

function updateAgentMovement(agent, delta, effectiveSpeedFactor) {
    // Apply movement only if not waiting or idle
    if (agent.state !== AGENT_STATE.IDLE &&
        agent.state !== AGENT_STATE.WAITING_ENTRY &&
        agent.state !== AGENT_STATE.WAITING_EXIT)
    {
        const scaledVelocity = agent.velocity.clone().multiplyScalar(effectiveSpeedFactor);
        agent.mesh.position.add(scaledVelocity);
    }

     // Ensure correct height
     agent.mesh.position.y = agent.baseHeight;

     // Update orientation (Forward-Only Locomotion)
     // Only rotate if velocity is significant and agent is not idle/waiting
     if (agent.velocity.lengthSq() > VELOCITY_THRESHOLD_SQ &&
        agent.state !== AGENT_STATE.IDLE &&
        agent.state !== AGENT_STATE.WAITING_ENTRY &&
        agent.state !== AGENT_STATE.WAITING_EXIT)
     {
         const targetQuaternion = new THREE.Quaternion();
         // Look in the direction of velocity, keeping the model upright
         const lookAtPos = agent.mesh.position.clone().add(agent.velocity);
         const matrix = new THREE.Matrix4();
         matrix.lookAt(agent.mesh.position, lookAtPos, agent.mesh.up); // Use agent's current up vector
         targetQuaternion.setFromRotationMatrix(matrix);
         // Smooth rotation
         agent.mesh.quaternion.slerp(targetQuaternion, 0.15); // Adjust slerp factor for rotation speed
     }
}

function handleAgentEnvironmentCollisions(agent, delta, effectiveSpeedFactor) {
     const floorHalfWidth = 800 / 2;
     const floorHalfDepth = 500 / 2;
     const checkRadius = MODEL_SCALE * 0.5; // Agent's approximate radius

     // --- Floor Boundary Collision ---
     let bouncedOffFloor = false;
     if (Math.abs(agent.mesh.position.x) > floorHalfWidth - checkRadius) {
         agent.velocity.x *= -1;
         agent.mesh.position.x = Math.sign(agent.mesh.position.x) * (floorHalfWidth - checkRadius);
         bouncedOffFloor = true;
     }
     if (Math.abs(agent.mesh.position.z) > floorHalfDepth - checkRadius) {
         agent.velocity.z *= -1;
         agent.mesh.position.z = Math.sign(agent.mesh.position.z) * (floorHalfDepth - checkRadius);
         bouncedOffFloor = true;
     }
      // If bounced off floor while heading to/from dept, reset state
      if (bouncedOffFloor && (agent.state === AGENT_STATE.GOING_TO_DEPT || agent.state === AGENT_STATE.ENTERING || agent.state === AGENT_STATE.GOING_TO_EXIT || agent.state === AGENT_STATE.EXITING)) {
          // If portal was occupied, free it
         if (agent.portalTarget && agent.portalTarget.isOccupied && (agent.state === AGENT_STATE.ENTERING || agent.state === AGENT_STATE.EXITING)) {
             agent.portalTarget.isOccupied = false;
             // processPortalQueues(); // Check queue
         }
         agent.state = AGENT_STATE.WANDERING;
         agent.targetDepartment = null;
         agent.portalTarget = null;
         agent.targetPosition = null;
          console.log(`Agent ${agent.id} bounced off floor boundary, resetting state to WANDERING.`);
     }


     // --- Department Collision (Precise Walls & Portals) ---
     const currentPos = agent.mesh.position;
     // Calculate potential next position based only on this frame's velocity
     // We do collision check before actually moving the mesh in updateAgentMovement
     // Correction: Collision check should happen after potential move, to see if move is valid.
     // Let's use the current velocity direction for the raycast.

     if (agent.velocity.lengthSq() < VELOCITY_THRESHOLD_SQ) return; // Don't check collision if not moving

     const moveDirection = agent.velocity.clone().normalize();
     raycaster.set(currentPos, moveDirection);
     raycaster.far = agent.velocity.length() * effectiveSpeedFactor + checkRadius * 1.5; // Ray length based on speed + buffer

     departments.forEach(dept => {
         const intersections = raycaster.intersectObject(dept.mesh); // Check intersection with department box mesh

         if (intersections.length > 0) {
             const intersection = intersections[0]; // Closest intersection
             const hitPoint = intersection.point;
             const hitNormal = intersection.face.normal.clone(); // Normal of the face hit

             let allowPassage = false;
             let targetPortal = null;

             // Is the agent trying to enter THIS department?
             if (agent.state === AGENT_STATE.GOING_TO_DEPT || agent.state === AGENT_STATE.ENTERING || agent.state === AGENT_STATE.WAITING_ENTRY) {
                  if (agent.targetDepartment === dept) targetPortal = dept.entryPortal;
              }
             // Is the agent trying to exit THIS department?
             else if (agent.state === AGENT_STATE.GOING_TO_EXIT || agent.state === AGENT_STATE.EXITING || agent.state === AGENT_STATE.WAITING_EXIT) {
                 if (agent.targetDepartment === dept) targetPortal = dept.exitPortal;
             }


              // Check if hit point corresponds to the targeted portal
             if (targetPortal && hitNormal.equals(targetPortal.faceNormal)) { // Did we hit the correct face?
                 if (isPointOnPortal(hitPoint, targetPortal)) { // Is the hit point within the portal area?
                     allowPassage = true;
                     // State transitions (ENTERING, EXITING) are handled in updateAgentState based on proximity/plane crossing
                     // We just allow the movement calculation to proceed if allowPassage is true.
                 }
             }


             // --- Collision Response ---
             if (!allowPassage) {
                  // Hit a solid wall or the wrong portal face
                 // Project velocity onto the plane of the wall to slide along it
                 const wallPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(hitNormal, hitPoint);
                 const projectedVelocity = agent.velocity.clone().projectOnPlane(hitNormal); // Project velocity onto plane normal = 0

                  // Apply sliding velocity, but prevent entering the wall
                  agent.velocity.copy(projectedVelocity);


                 // Nudge the agent slightly away from the wall to prevent sticking
                 const nudgeDistance = 0.1; // Small nudge
                 agent.mesh.position.add(hitNormal.multiplyScalar(nudgeDistance));
                 agent.mesh.position.y = agent.baseHeight; // Correct height

                 // If agent was trying to enter/exit, hitting a wall should probably reset its goal?
                 if (targetPortal) {
                      // If portal was occupied, free it
                     if (agent.portalTarget && agent.portalTarget.isOccupied && (agent.state === AGENT_STATE.ENTERING || agent.state === AGENT_STATE.EXITING)) {
                          agent.portalTarget.isOccupied = false;
                     }
                     console.log(`Agent ${agent.id} hit wall while targeting portal, resetting to WANDERING.`);
                     agent.state = AGENT_STATE.WANDERING;
                     agent.targetDepartment = null;
                     agent.portalTarget = null;
                     agent.targetPosition = null;
                     // Give a slight velocity away from wall
                     agent.velocity.add(hitNormal.multiplyScalar(0.5)).normalize().multiplyScalar(AGENT_MOVE_SPEED * 0.5);
                 }

                 // Stop checking other departments for this agent this frame
                 return; // Exit departments.forEach for this agent
             }
             // Else: allowPassage is true, movement continues towards/through portal
         }
     }); // End department loop
}

function handleAgentAgentCollisions() {
    for (let i = 0; i < agents.length; i++) {
        const agentA = agents[i];
        if (!agentA.mesh) continue;

        for (let j = i + 1; j < agents.length; j++) {
            const agentB = agents[j];
            if (!agentB.mesh) continue;

             // Don't check collision if either agent is waiting (they should be stationary)
            if (agentA.state === AGENT_STATE.WAITING_ENTRY || agentA.state === AGENT_STATE.WAITING_EXIT ||
                agentB.state === AGENT_STATE.WAITING_ENTRY || agentB.state === AGENT_STATE.WAITING_EXIT) {
                 continue;
            }


            const distanceSq = agentA.mesh.position.distanceToSquared(agentB.mesh.position);
            const minSeparationSq = MIN_AGENT_SEPARATION * MIN_AGENT_SEPARATION;

            if (distanceSq < minSeparationSq) {
                const distance = Math.sqrt(distanceSq);
                const collisionNormal = agentA.mesh.position.clone().sub(agentB.mesh.position).normalize();

                // Simple reflection - might need refinement to prevent oscillations
                const velA = agentA.velocity.clone();
                // agentA.velocity.reflect(collisionNormal);
                // agentB.velocity.reflect(collisionNormal.negate());

                 // Alternative: Push apart based on overlap
                 const overlap = MIN_AGENT_SEPARATION - distance;
                 const pushFactor = overlap * 0.5; // How strongly to push

                 // Push A along normal, B along negative normal
                 agentA.velocity.add(collisionNormal.clone().multiplyScalar(pushFactor));
                 agentB.velocity.add(collisionNormal.negate().multiplyScalar(pushFactor));

                 // Limit maximum velocity increase from push?
                 agentA.velocity.clampLength(0, AGENT_MOVE_SPEED * 1.5);
                 agentB.velocity.clampLength(0, AGENT_MOVE_SPEED * 1.5);


                // Nudge apart position slightly to guarantee separation
                const nudgeAmount = overlap / 2 + 0.01; // Add tiny buffer
                agentA.mesh.position.add(collisionNormal.clone().multiplyScalar(nudgeAmount));
                agentB.mesh.position.add(collisionNormal.negate().multiplyScalar(nudgeAmount));

                // Correct Y position after nudge
                agentA.mesh.position.y = agentA.baseHeight;
                agentB.mesh.position.y = agentB.baseHeight;
            }
        }
    }
}

function updateAgentAnimation(agent) {
    if (!agent.mixer) return; // No animations for this agent

    const isMoving = agent.velocity.lengthSq() > VELOCITY_THRESHOLD_SQ &&
                     agent.state !== AGENT_STATE.IDLE &&
                     agent.state !== AGENT_STATE.WAITING_ENTRY &&
                     agent.state !== AGENT_STATE.WAITING_EXIT;

    const actionToPlay = isMoving ? agent.actions.walk : agent.actions.idle;

    if (agent.currentAction !== actionToPlay) {
        if (agent.currentAction) {
            agent.currentAction.fadeOut(ANIMATION_FADE_DURATION);
        }
        actionToPlay
            .reset()
            .setEffectiveTimeScale(1)
            .setEffectiveWeight(1)
            .fadeIn(ANIMATION_FADE_DURATION)
            .play();
        agent.currentAction = actionToPlay;
    }
}

function updateAgentTrail(agent) {
    if (showTrails) {
        agent.trails.push(agent.mesh.position.clone());
        if (agent.trails.length > trailLength) {
            agent.trails.shift();
        }
        // Update or create trail mesh
         if (agent.trails.length >= 2) {
            const points = agent.trails;
            const geometry = new THREE.BufferGeometry().setFromPoints(points);

             // Use a simple color for now
             const material = new THREE.LineBasicMaterial({ color: agentColor, linewidth: 1 });

             if (agent.trail) {
                 agent.trail.geometry.dispose(); // Dispose old geometry data
                 agent.trail.geometry = geometry;
             } else {
                 agent.trail = new THREE.Line(geometry, material);
                 scene.add(agent.trail);
             }
         }
    } else if (agent.trail) {
        removeTrail(agent); // Use helper
    }
}


//-----------------------------------------------------------------------------
// Portal & Queue Management
//-----------------------------------------------------------------------------

function processPortalQueues() {
    departments.forEach(dept => {
        // Check Entry Queue
        if (!dept.entryPortal.isOccupied && dept.entryPortal.queue.length > 0) {
            const nextAgent = dept.entryPortal.queue.shift(); // Get first agent
            if (nextAgent && nextAgent.state === AGENT_STATE.WAITING_ENTRY) {
                 console.log(`Agent ${nextAgent.id} leaving entry queue for ${dept.name}`);
                 dept.entryPortal.isOccupied = true;
                 nextAgent.state = AGENT_STATE.ENTERING;
                 // Give velocity into department
                 nextAgent.velocity = dept.entryPortal.faceNormal.clone().negate().multiplyScalar(AGENT_MOVE_SPEED * 0.8);
            } else if (nextAgent) {
                 console.warn(`Agent ${nextAgent.id} was in entry queue but not in WAITING_ENTRY state? State: ${nextAgent.state}`);
                 // Put agent back? Or just let them wander? For now, let them go.
                 // dept.entryPortal.queue.unshift(nextAgent); // Put back at front
                 nextAgent.state = AGENT_STATE.WANDERING; // Failsafe
            }
        }

        // Check Exit Queue
        if (!dept.exitPortal.isOccupied && dept.exitPortal.queue.length > 0) {
            const nextAgent = dept.exitPortal.queue.shift();
             if (nextAgent && nextAgent.state === AGENT_STATE.WAITING_EXIT) {
                 console.log(`Agent ${nextAgent.id} leaving exit queue for ${dept.name}`);
                 dept.exitPortal.isOccupied = true;
                 nextAgent.state = AGENT_STATE.EXITING;
                 // Give velocity out of department
                 nextAgent.velocity = dept.exitPortal.faceNormal.clone().multiplyScalar(AGENT_MOVE_SPEED);
             } else if (nextAgent) {
                 console.warn(`Agent ${nextAgent.id} was in exit queue but not in WAITING_EXIT state? State: ${nextAgent.state}`);
                 nextAgent.state = AGENT_STATE.WANDERING; // Failsafe
             }
        }
    });
}

//-----------------------------------------------------------------------------
// Helper Functions
//-----------------------------------------------------------------------------

// Checks if a world point lies on the portal line segment on a department face
function isPointOnPortal(point, portal) {
    // Project point onto the line defined by the portal's world position and its offset axis
    const portalLineDir = (portal.offsetAxis === 'z') ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const portalStart = portal.worldPos.clone().addScaledVector(portalLineDir, -portal.width / 2);
    const portalEnd = portal.worldPos.clone().addScaledVector(portalLineDir, portal.width / 2);

    // Project point onto the infinite line containing the portal segment
    const lineVec = portalEnd.clone().sub(portalStart);
    const pointVec = point.clone().sub(portalStart);
    const lineLenSq = lineVec.lengthSq();
    if (lineLenSq < 0.0001) return false; // Avoid division by zero

    const t = pointVec.dot(lineVec) / lineLenSq;

    // Check if the projected point is within the segment (0 <= t <= 1)
    // And also check if the point is very close to the line segment (distance check)
    const closestPointOnLine = portalStart.clone().addScaledVector(lineVec, t);
    const distSq = point.distanceToSquared(closestPointOnLine);

    const tolerance = 0.5; // How close the point needs to be to the portal line

    // Is projection within segment AND point close to the line?
    return (t >= 0 && t <= 1 && distSq < tolerance * tolerance);

}

function getRandomPointInDepartment(department) {
    const deptPos = department.mesh.position;
    const size = department.config.size;
    const padding = MODEL_SCALE * 1.5; // Ensure point is not too close to walls

    if (size[0] <= padding * 2 || size[2] <= padding * 2) return null; // Dept too small

    const x = deptPos.x + THREE.MathUtils.randFloatSpread(size[0] - padding * 2);
    const z = deptPos.z + THREE.MathUtils.randFloatSpread(size[2] - padding * 2);
    return new THREE.Vector3(x, modelBaseHeightOffset, z);
}

function removeTrail(agent) {
    if (agent.trail) {
        scene.remove(agent.trail);
        agent.trail.geometry.dispose();
        agent.trail.material.dispose();
        agent.trail = null;
        agent.trails = [];
    }
}

// Helper to get portal world position (now stored directly)
// function getPortalWorldPosition(department, portalType = 'entry') { ... } // No longer needed

//=============================================================================
// RENDERING & ANIMATION LOOP
//=============================================================================

function render() {
    renderer.render(scene, camera);
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta(); // Get time difference

    if (!isPaused) {
        // Update agents FIRST
        updateAgents(delta);

        // Update agent animations AFTER agent logic/physics
        agents.forEach(agent => {
            if (agent.mixer) {
                agent.mixer.update(delta);
            }
        });
    }

    controls.update(); // Update camera controls
    render();          // Render the scene
    if (stats) stats.update(); // Update performance stats
}

//=============================================================================
// UI & EVENT HANDLERS
//=============================================================================

function setupUIEventListeners() {
    window.addEventListener('resize', onWindowResize);
    document.getElementById('startPause').onclick = toggleSimulation;
    document.getElementById('reset').onclick = () => resetScene();
    document.getElementById('resetView').onclick = resetView;
    document.getElementById('speed').oninput = e => speed = +e.target.value;
    document.getElementById('count').onchange = e => resetScene(+e.target.value); // Pass new count directly
    document.getElementById('scenario').onchange = e => switchLayout(e.target.value);
    document.getElementById('trails').onchange = e => {
        showTrails = e.target.checked;
        if (!showTrails) {
            agents.forEach(agent => removeTrail(agent));
        }
    }
}

function updateUIDisplay() {
    const agentsCountEl = document.getElementById('agents-count');
    if (agentsCountEl) agentsCountEl.textContent = `Agents: ${agents.length}`;
    // Hide manual FPS counter if Stats.js is used
    const fpsEl = document.getElementById('fps');
    if (fpsEl && stats) fpsEl.style.display = 'none';
}

function resetScene(newCount) {
    // Stop animations and clear agents
    agents.forEach(agent => {
         if(agent.mixer) agent.mixer.stopAllAction();
         if (agent.mesh) scene.remove(agent.mesh);
         removeTrail(agent);
     });
    agents = [];

    // Clear department queues
    departments.forEach(dept => {
        if(dept.entryPortal) dept.entryPortal.queue = []; dept.entryPortal.isOccupied = false;
        if(dept.exitPortal) dept.exitPortal.queue = []; dept.exitPortal.isOccupied = false;
    });


    // Update agent count
    if (newCount !== undefined && !isNaN(newCount)) {
        agentCount = Math.max(1, newCount);
        const countInput = document.getElementById('count');
        if (countInput) countInput.value = agentCount;
    } else {
        const countInput = document.getElementById('count');
        agentCount = countInput ? parseInt(countInput.value, 10) || 25 : 25; // Use base 10 for parseInt
    }

    // Respawn agents
    if (loadedGltfModel) {
        spawnAgents(agentCount);
    } else {
        console.warn("Model not loaded yet, cannot respawn agents during reset.");
    }

    // Reset pause state
    isPaused = false;
    const startPauseButton = document.getElementById('startPause');
    if (startPauseButton) startPauseButton.textContent = '❚❚ Pause';

    updateUIDisplay();
}

function switchLayout(layout) {
    // Clear department queues before creating new ones
     departments.forEach(dept => {
        if(dept.entryPortal) dept.entryPortal.queue = []; dept.entryPortal.isOccupied = false;
        if(dept.exitPortal) dept.exitPortal.queue = []; dept.exitPortal.isOccupied = false;
     });
    createDepartments(layout);
    // Reset agents completely when layout changes
    resetScene(agentCount);
}


function toggleSimulation() {
    isPaused = !isPaused;
    const startPauseButton = document.getElementById('startPause');
    if (startPauseButton) startPauseButton.textContent = isPaused ? '▶ Resume' : '❚❚ Pause';
    // Pause/unpause animations
     agents.forEach(agent => {
        if(agent.mixer) {
            // How to pause/resume mixer? THREE.AnimationMixer doesn't have a direct pause.
            // We can set the timeScale to 0 or 1.
             agent.mixer.timeScale = isPaused ? 0 : 1;
         }
     });

}

function resetView() {
    // Smooth transition using GSAP or similar would be nicer, but basic lerp is ok
    const targetPos = initialCameraPosition.clone();
    const targetTarget = initialControlsTarget.clone();
    const duration = 0.8;
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    let elapsed = 0;
    const clock = new THREE.Clock(); // Use a local clock for the transition

    function transitionView() {
        elapsed += clock.getDelta();
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = 0.5 - 0.5 * Math.cos(progress * Math.PI);

        camera.position.lerpVectors(startPos, targetPos, easedProgress);
        controls.target.lerpVectors(startTarget, targetTarget, easedProgress);
        controls.update(); // Essential during transition

        if (progress < 1) {
            requestAnimationFrame(transitionView);
        }
    }
    requestAnimationFrame(transitionView);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

//=============================================================================
// START SIMULATION
//=============================================================================
initScene();