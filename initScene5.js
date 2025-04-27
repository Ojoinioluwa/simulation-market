import * as THREE from 'three';
import Stats from 'stats';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let scene, camera, renderer, ambientLight, pointLight;
let floor, departments = [], agents = [];
let portalMeshes = []; // To keep track of portal visualization meshes
let speed = 1;
let agentCount = 50;
let isPaused = false;
let showTrails = false;
let stats;
let controls;
let loadedFont = null;
let loadedGltfModel = null;

// --- Agent Behavior Constants ---
const MIN_AGENT_SEPARATION = 15; // Min distance before agents react (adjust based on MODEL_SCALE)
const IDLE_CHANCE = 0.003;      // Chance per update to start idling (lower is less frequent)
const MIN_IDLE_TIME = 2.0;      // Minimum seconds to idle
const MAX_IDLE_TIME = 6.0;      // Maximum seconds to idle
const MIN_TIME_IN_DEPT = 5.0;   // Min seconds agent stays in a department
const MAX_TIME_IN_DEPT = 15.0;  // Max seconds agent stays in a department
const DEPT_VISIT_CHANCE = 0.001;// Chance per update for a wandering agent to pick a department

// --- Agent States ---
const AGENT_STATE = {
    WANDERING: 'WANDERING',
    GOING_TO_DEPT: 'GOING_TO_DEPT',
    INSIDE_DEPT: 'INSIDE_DEPT',
    LEAVING_DEPT: 'LEAVING_DEPT',
    IDLE: 'IDLE',
};
// --------------------------

const agentRadius = 5; // Keep for reference
const trailLength = 50;
const agentColor = 0x555555;
const initialCameraPosition = new THREE.Vector3(0, 300, 500);
const initialControlsTarget = new THREE.Vector3(0, 50, 0);

const MODEL_URL = '/Models/low_poly_character.glb';
const MODEL_SCALE = 8;
let modelBaseHeightOffset = 0;

const fontLoader = new FontLoader();
const gltfLoader = new GLTFLoader();

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
    pointLight.position.set(0, 200, 100); // Adjusted light position slightly
    pointLight.castShadow = true;
    pointLight.shadow.mapSize.width = 1024;
    pointLight.shadow.mapSize.height = 1024;
    pointLight.shadow.camera.near = 10;
    pointLight.shadow.camera.far = 600; // Increased range slightly
    pointLight.shadow.bias = -0.001;
    scene.add(pointLight);
    // Optional: Add a PointLightHelper
    // const sphereSize = 10;
    // const pointLightHelper = new THREE.PointLightHelper( pointLight, sphereSize );
    // scene.add( pointLightHelper );

    const floorGeometry = new THREE.PlaneGeometry(800, 500);
    const floorMaterial = new THREE.MeshStandardMaterial({
        color: "#cccccc", side: THREE.DoubleSide, roughness: 0.8, metalness: 0.2
    });
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0;
    floor.receiveShadow = true;
    scene.add(floor);

    try {
        console.log("Loading assets...");
        [loadedFont, loadedGltfModel] = await Promise.all([
            loadFont('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json'),
            loadGLTFModel(MODEL_URL)
        ]);
        console.log("Assets loaded successfully.");

        const tempMesh = loadedGltfModel.scene.clone();
        tempMesh.scale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
        const box = new THREE.Box3().setFromObject(tempMesh);
        modelBaseHeightOffset = -box.min.y; // Offset needed to bring bottom (min y) to y=0

    } catch (error) {
        console.error("Error loading assets:", error);
        // alert(Failed to load assets. Check console and MODEL_URL (${MODEL_URL}). Simulation cannot start.);
        return;
    }

    createDepartments('baseline');

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
    // *** MODIFICATION: Reduced dampingFactor for more inertia ***
    controls.dampingFactor = 0.05; // Smaller value = less damping = more coasting
    // Note: Continuous slow spin needs custom logic beyond standard damping.
    controls.update();


    window.addEventListener('resize', onWindowResize);
    document.getElementById('startPause').onclick = toggleSimulation;
    document.getElementById('reset').onclick = () => resetScene();
    document.getElementById('resetView').onclick = resetView;
    document.getElementById('speed').oninput = e => speed = +e.target.value;
    document.getElementById('count').onchange = e => resetScene(+e.target.value);
    document.getElementById('scenario').onchange = e => switchLayout(e.target.value);
    document.getElementById('trails').onchange = e => {
        showTrails = e.target.checked;
        if (!showTrails) {
            agents.forEach(agent => removeTrail(agent));
        }
    }

    spawnAgents(agentCount);
    updateUIDisplay(); // Initial UI update
    animate();
}

function createDepartments(layout) {
    if (!loadedFont) {
        console.error("Font not loaded, cannot create departments.");
        return;
    }

    // Clear previous departments and portals
    departments.forEach(dept => {
        if (dept.mesh) scene.remove(dept.mesh);
        if (dept.wireframe) scene.remove(dept.wireframe);
        if (dept.label) scene.remove(dept.label);
    });
    departments = [];
    portalMeshes.forEach(mesh => scene.remove(mesh)); // Remove old portal visualizations
    portalMeshes = [];


    let layoutConfig;
    if (layout === 'baseline') {
        layoutConfig = [
             // *** MODIFICATION: Added portalCenter [x, z] and portalWidth ***
            { name: 'Produce', size: [180, 80, 90], position: [-110, 40, 130], color: 0xaec6cf, portalCenter: [-200, 130], portalWidth: 60, portalFace: 'x-' }, // Portal on the -X face
            { name: 'Dairy', size: [180, 80, 90], position: [110, 40, 130], color: 0x98fb98, portalCenter: [200, 130], portalWidth: 60, portalFace: 'x+' }, // Portal on the +X face
            { name: 'Bakery', size: [380, 80, 90], position: [0, 40, -130], color: 0xffe4c4, portalCenter: [0, -175], portalWidth: 80, portalFace: 'z-' } // Portal on the -Z face
        ];
    } else if (layout === 'alternate') {
        layoutConfig = [
            { name: 'Electronics', size: [230, 80, 90], position: [-180, 40, 0], color: 0xd8bfd8, portalCenter: [-295, 0], portalWidth: 70, portalFace: 'x-' }, // Portal on -X face
            { name: 'Apparel', size: [230, 80, 90], position: [180, 40, 0], color: 0xffdab9, portalCenter: [295, 0], portalWidth: 70, portalFace: 'x+' }   // Portal on +X face
        ];
    }

    layoutConfig.forEach(config => {
        const { name, size, position, color, portalCenter, portalWidth, portalFace } = config;
        const geometry = new THREE.BoxGeometry(...size);

        const fillMaterial = new THREE.MeshStandardMaterial({
            color: color, transparent: true, opacity: 0.3, roughness: 0.7, metalness: 0.1
        });
        const mesh = new THREE.Mesh(geometry, fillMaterial);
        mesh.position.set(position[0], position[1], position[2]);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.userData.isDepartment = true; // Mark for collision logic
        mesh.userData.config = config; // Store config for easy access
        scene.add(mesh);

        const edgesGeometry = new THREE.EdgesGeometry(geometry);
        const lineMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 1.5 });
        const wireframe = new THREE.LineSegments(edgesGeometry, lineMaterial);
        wireframe.position.copy(mesh.position);
        scene.add(wireframe);

        // --- Visualize Portal (Optional) ---
        const portalHeight = 5; // How high off the floor the line is
        const portalMat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 3 }); // Bright green
        let portalPoints = [];
        const halfWidth = portalWidth / 2;
        const portalY = position[1] - size[1] / 2 + portalHeight; // Place slightly above floor

        if (portalFace === 'x-') { // Left face
            portalPoints.push(new THREE.Vector3(position[0] - size[0] / 2, portalY, portalCenter[1] - halfWidth));
            portalPoints.push(new THREE.Vector3(position[0] - size[0] / 2, portalY, portalCenter[1] + halfWidth));
        } else if (portalFace === 'x+') { // Right face
             portalPoints.push(new THREE.Vector3(position[0] + size[0] / 2, portalY, portalCenter[1] - halfWidth));
             portalPoints.push(new THREE.Vector3(position[0] + size[0] / 2, portalY, portalCenter[1] + halfWidth));
        } else if (portalFace === 'z-') { // Back face
             portalPoints.push(new THREE.Vector3(portalCenter[0] - halfWidth, portalY, position[2] - size[2] / 2));
             portalPoints.push(new THREE.Vector3(portalCenter[0] + halfWidth, portalY, position[2] - size[2] / 2));
        } else if (portalFace === 'z+') { // Front face
            portalPoints.push(new THREE.Vector3(portalCenter[0] - halfWidth, portalY, position[2] + size[2] / 2));
            portalPoints.push(new THREE.Vector3(portalCenter[0] + halfWidth, portalY, position[2] + size[2] / 2));
        }
        if (portalPoints.length > 0) {
            const portalGeom = new THREE.BufferGeometry().setFromPoints(portalPoints);
            const portalLine = new THREE.Line(portalGeom, portalMat);
            scene.add(portalLine);
            portalMeshes.push(portalLine); // Keep track to remove later
        }
         // ----------------------------------

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
    // Reset agents completely when layout changes
    resetScene(agentCount);
}

function spawnAgents(n) {
    if (!loadedGltfModel) {
        console.error("GLTF Model not loaded, cannot spawn agents.");
        return;
    }

    // --- Clear existing agents before spawning new ones ---
    agents.forEach(agent => {
        if (agent.mesh) scene.remove(agent.mesh);
        removeTrail(agent); // Use helper to clean up trail
    });
    agents = [];
    // -----------------------------------------------------


    const spawnWidth = 780;
    const spawnDepth = 480;

    for (let i = 0; i < n; i++) {
        const x = THREE.MathUtils.randFloatSpread(spawnWidth);
        const z = THREE.MathUtils.randFloatSpread(spawnDepth);
        const y = modelBaseHeightOffset;

        const avatar = loadedGltfModel.scene.clone(true);
        avatar.scale.set(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
        avatar.position.set(x, y, z);

        avatar.traverse(function (object) {
            if (object.isMesh) {
                object.castShadow = true;
                object.receiveShadow = false;
                 if (object.material) {
                     const materials = Array.isArray(object.material) ? object.material : [object.material];
                     materials.forEach(mat => {
                         if (mat.isMeshStandardMaterial || mat.isMeshBasicMaterial) {
                            // Create a unique material instance for each agent part if needed
                            // This prevents all agents from sharing the exact same material reference
                            const newMat = mat.clone();
                            newMat.color.setHex(agentColor);
                            object.material = newMat;
                         }
                     });
                 }
            }
        });

        scene.add(avatar);

        const vx = THREE.MathUtils.randFloatSpread(2) + Math.sign(Math.random() - 0.5) * 0.5; // Initial velocity
        const vz = THREE.MathUtils.randFloatSpread(2) + Math.sign(Math.random() - 0.5) * 0.5;
        const velocity = new THREE.Vector3(vx, 0, vz).normalize().multiplyScalar(THREE.MathUtils.randFloat(0.8, 1.5)); // Normalize and give speed


        // *** MODIFICATION: Added agent state and related properties ***
        agents.push({
            mesh: avatar,
            velocity,
            trails: [],
            trail: null, // Add trail property explicitly
            baseHeight: y,
            state: AGENT_STATE.WANDERING,
            idleTimer: 0,
            targetDepartment: null, // Which department object they are going to/in
            targetPosition: null,   // Specific point (e.g., portal, point inside dept)
            timeInDepartment: 0,    // Timer for staying inside
            previousState: null     // To resume previous activity after idling
        });
    }
    // updateUIDisplay(); // Called in resetScene and initScene
}

function updateAgents(delta) {
    if (isPaused || departments.length === 0) return; // Don't update if paused or no departments exist

    const effectiveSpeed = speed * delta * 60; // Scale speed by delta
    const floorHalfWidth = 800 / 2;
    const floorHalfDepth = 500 / 2;

    // Agent-Agent Collision Check (Simple N-Body)
    for (let i = 0; i < agents.length; i++) {
        const agentA = agents[i];
        if (!agentA.mesh || agentA.state === AGENT_STATE.IDLE) continue; // Skip if no mesh or idle

        for (let j = i + 1; j < agents.length; j++) {
            const agentB = agents[j];
            if (!agentB.mesh || agentB.state === AGENT_STATE.IDLE) continue; // Skip if no mesh or idle

            const distance = agentA.mesh.position.distanceTo(agentB.mesh.position);

            if (distance < MIN_AGENT_SEPARATION) {
                // *** MODIFICATION: Simple Collision Response ***
                const collisionNormal = agentA.mesh.position.clone().sub(agentB.mesh.position).normalize();

                // Reflect velocities (basic bounce)
                const velA = agentA.velocity.clone();
                const velB = agentB.velocity.clone();

                agentA.velocity.reflect(collisionNormal);
                agentB.velocity.reflect(collisionNormal.negate()); // Reflect B off the opposite normal

                // Ensure minimum speed after reflection to prevent stopping dead
                agentA.velocity.normalize().multiplyScalar(Math.max(velA.length(), 0.5));
                agentB.velocity.normalize().multiplyScalar(Math.max(velB.length(), 0.5));


                // Nudge apart slightly to prevent sticking
                const nudgeAmount = (MIN_AGENT_SEPARATION - distance) / 2 + 0.1;
                agentA.mesh.position.add(collisionNormal.clone().multiplyScalar(nudgeAmount));
                agentB.mesh.position.add(collisionNormal.negate().multiplyScalar(nudgeAmount)); // Use negated normal for B

                 // Ensure they don't get nudged off the floor
                agentA.mesh.position.y = agentA.baseHeight;
                agentB.mesh.position.y = agentB.baseHeight;

                 // If nudged out of bounds, bring back
                agentA.mesh.position.x = THREE.MathUtils.clamp(agentA.mesh.position.x, -floorHalfWidth + MIN_AGENT_SEPARATION/2, floorHalfWidth - MIN_AGENT_SEPARATION/2);
                agentA.mesh.position.z = THREE.MathUtils.clamp(agentA.mesh.position.z, -floorHalfDepth + MIN_AGENT_SEPARATION/2, floorHalfDepth - MIN_AGENT_SEPARATION/2);
                agentB.mesh.position.x = THREE.MathUtils.clamp(agentB.mesh.position.x, -floorHalfWidth + MIN_AGENT_SEPARATION/2, floorHalfWidth - MIN_AGENT_SEPARATION/2);
                agentB.mesh.position.z = THREE.MathUtils.clamp(agentB.mesh.position.z, -floorHalfDepth + MIN_AGENT_SEPARATION/2, floorHalfDepth - MIN_AGENT_SEPARATION/2);

            }
        }
    }


    // Update individual agent logic
    agents.forEach(agent => {
        if (!agent.mesh) return;

        // --- State Machine Logic ---
        switch (agent.state) {
            case AGENT_STATE.IDLE:
                agent.idleTimer -= delta;
                if (agent.idleTimer <= 0) {
                    agent.state = agent.previousState || AGENT_STATE.WANDERING; // Resume previous state or wander
                     if (agent.state === AGENT_STATE.WANDERING || (agent.state === AGENT_STATE.INSIDE_DEPT && !agent.targetPosition)) {
                        // Assign a new random velocity if wandering or no target inside dept
                        const vx = THREE.MathUtils.randFloatSpread(1);
                        const vz = THREE.MathUtils.randFloatSpread(1);
                        agent.velocity.set(vx, 0, vz).normalize().multiplyScalar(THREE.MathUtils.randFloat(0.8, 1.5));
                    } else if (agent.targetPosition) {
                         // Re-calculate velocity towards target if resuming GOTO, INSIDE (with target), or LEAVING
                        agent.velocity = agent.targetPosition.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(THREE.MathUtils.randFloat(0.8, 1.5));
                    }
                }
                break; // No movement when idle

             case AGENT_STATE.WANDERING:
                 // Chance to decide to visit a department
                if (Math.random() < DEPT_VISIT_CHANCE * delta * 60) { // Scale chance by delta
                     agent.targetDepartment = departments[Math.floor(Math.random() * departments.length)];
                     if (agent.targetDepartment) {
                        const portalPos = getPortalWorldPosition(agent.targetDepartment);
                        agent.targetPosition = portalPos; // Target the center of the portal
                        agent.state = AGENT_STATE.GOING_TO_DEPT;
                        // Calculate velocity towards portal
                        agent.velocity = agent.targetPosition.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(THREE.MathUtils.randFloat(1.0, 1.8));
                        // console.log(Agent going to ${agent.targetDepartment.name});
                    }
                } else if (Math.random() < IDLE_CHANCE * delta * 60) { // Chance to go idle
                     agent.previousState = AGENT_STATE.WANDERING;
                     agent.state = AGENT_STATE.IDLE;
                     agent.idleTimer = THREE.MathUtils.randFloat(MIN_IDLE_TIME, MAX_IDLE_TIME);
                     agent.velocity.set(0, 0, 0); // Stop moving
                }
                break;

            case AGENT_STATE.GOING_TO_DEPT:
                if (!agent.targetPosition || !agent.targetDepartment) { // Safety check
                    agent.state = AGENT_STATE.WANDERING; break;
                }
                // Move towards portal
                agent.velocity = agent.targetPosition.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(agent.velocity.length()); // Maintain speed, update direction
                // Check if close enough to the portal target
                if (agent.mesh.position.distanceTo(agent.targetPosition) < agent.targetDepartment.config.portalWidth / 2 + 5) { // Increased tolerance slightly
                    // Simple check: Is agent roughly inside the department box now?
                    const deptBox = new THREE.Box3().setFromObject(agent.targetDepartment.mesh);
                    if (deptBox.containsPoint(agent.mesh.position)) {
                        agent.state = AGENT_STATE.INSIDE_DEPT;
                        agent.timeInDepartment = THREE.MathUtils.randFloat(MIN_TIME_IN_DEPT, MAX_TIME_IN_DEPT);
                        // Pick a random point inside the department to wander towards (optional)
                        const innerTarget = getRandomPointInDepartment(agent.targetDepartment);
                        agent.targetPosition = innerTarget;
                         agent.velocity = agent.targetPosition.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(THREE.MathUtils.randFloat(0.5, 1.0)); // Slow down inside
                         // console.log(Agent entered ${agent.targetDepartment.name});
                    }
                }
                break;

             case AGENT_STATE.INSIDE_DEPT:
                 agent.timeInDepartment -= delta;

                // Chance to go idle inside department
                if (agent.idleTimer <= 0 && Math.random() < IDLE_CHANCE * delta * 30) { // More likely to idle inside?
                     agent.previousState = AGENT_STATE.INSIDE_DEPT;
                     agent.state = AGENT_STATE.IDLE;
                     agent.idleTimer = THREE.MathUtils.randFloat(MIN_IDLE_TIME, MAX_IDLE_TIME * 1.5); // Potentially idle longer
                     agent.velocity.set(0, 0, 0);
                     break; // Exit switch for this frame
                 }


                // Wander towards internal target point, or just bounce off internal walls
                if (agent.targetPosition) {
                    agent.velocity = agent.targetPosition.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(agent.velocity.length());
                    if (agent.mesh.position.distanceTo(agent.targetPosition) < 10) { // Reached internal target
                         agent.targetPosition = getRandomPointInDepartment(agent.targetDepartment); // Pick new internal target
                     }
                 } else {
                    // If no specific target, just keep moving with current velocity (will bounce off walls)
                 }


                if (agent.timeInDepartment <= 0) {
                    // Time's up, leave
                    const portalPos = getPortalWorldPosition(agent.targetDepartment);
                    agent.targetPosition = portalPos;
                    agent.state = AGENT_STATE.LEAVING_DEPT;
                    agent.velocity = agent.targetPosition.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(THREE.MathUtils.randFloat(1.0, 1.8)); // Speed up to leave
                    // console.log(Agent leaving ${agent.targetDepartment.name});
                }
                break;

            case AGENT_STATE.LEAVING_DEPT:
                if (!agent.targetPosition || !agent.targetDepartment) { // Safety check
                    agent.state = AGENT_STATE.WANDERING; break;
                }
                // Move towards portal
                agent.velocity = agent.targetPosition.clone().sub(agent.mesh.position).setY(0).normalize().multiplyScalar(agent.velocity.length());

                // Check if close enough to portal AND outside the department box
                const deptBoxLeave = new THREE.Box3().setFromObject(agent.targetDepartment.mesh);
                 // Use a slightly expanded box check to ensure agent is truly clear
                 const exitCheckPos = agent.mesh.position.clone().add(agent.velocity.clone().normalize().multiplyScalar(MIN_AGENT_SEPARATION)); // Check slightly ahead

                if (agent.mesh.position.distanceTo(agent.targetPosition) < agent.targetDepartment.config.portalWidth / 2 + 5 &&
                    !deptBoxLeave.containsPoint(exitCheckPos)) {
                    // console.log(Agent exited ${agent.targetDepartment.name});
                    agent.state = AGENT_STATE.WANDERING;
                    agent.targetDepartment = null;
                    agent.targetPosition = null;
                    // Assign random outward velocity
                    const vx = THREE.MathUtils.randFloatSpread(1);
                    const vz = THREE.MathUtils.randFloatSpread(1);
                    agent.velocity.set(vx, 0, vz).normalize().multiplyScalar(THREE.MathUtils.randFloat(0.8, 1.5));

                }
                 break;
         }
        // --- End State Machine ---


        // --- Movement & General Boundary Collision ---
        if (agent.state !== AGENT_STATE.IDLE) {
            const scaledVelocity = agent.velocity.clone().multiplyScalar(effectiveSpeed);
            agent.mesh.position.add(scaledVelocity);
            agent.mesh.position.y = agent.baseHeight; // Ensure Y is correct

            // Rotate agent to face movement direction
            if (agent.velocity.lengthSq() > 0.01) { // Avoid tiny rotations
                const targetQuaternion = new THREE.Quaternion();
                const lookAtPos = agent.mesh.position.clone().add(agent.velocity);
                const matrix = new THREE.Matrix4();
                matrix.lookAt(agent.mesh.position, lookAtPos, agent.mesh.up); // Use agent's up vector
                targetQuaternion.setFromRotationMatrix(matrix);
                // Slerp for smoother rotation
                agent.mesh.quaternion.slerp(targetQuaternion, 0.1);
            }


             // Floor Boundary collision
             const checkRadius = MIN_AGENT_SEPARATION / 2; // Use approx radius for boundary check
             let bounced = false;
            if (Math.abs(agent.mesh.position.x) > floorHalfWidth - checkRadius) {
                agent.velocity.x *= -1;
                agent.mesh.position.x = Math.sign(agent.mesh.position.x) * (floorHalfWidth - checkRadius);
                bounced = true;
            }
            if (Math.abs(agent.mesh.position.z) > floorHalfDepth - checkRadius) {
                agent.velocity.z *= -1;
                agent.mesh.position.z = Math.sign(agent.mesh.position.z) * (floorHalfDepth - checkRadius);
                bounced = true;
            }
            // If bounced off floor boundary while heading to/leaving dept, cancel the action
            if (bounced && (agent.state === AGENT_STATE.GOING_TO_DEPT || agent.state === AGENT_STATE.LEAVING_DEPT)) {
                agent.state = AGENT_STATE.WANDERING;
                agent.targetDepartment = null;
                agent.targetPosition = null;
            }


            // --- Department Collision (Respecting Portals) ---
            departments.forEach(department => {
                if (!department.mesh || department === agent.targetDepartment) return; // Skip self or current target

                const box = new THREE.Box3().setFromObject(department.mesh);

                // Check if agent is about to enter or is inside THIS department
                if (box.containsPoint(agent.mesh.position)) {
                    // If agent is inside a department it wasn't targeting, bounce it out forcefully
                     if (agent.state !== AGENT_STATE.INSIDE_DEPT || agent.targetDepartment !== department) {
                        const closestPoint = new THREE.Vector3();
                        box.clampPoint(agent.mesh.position, closestPoint); // Find closest point on box surface
                        const normal = agent.mesh.position.clone().sub(closestPoint).normalize();

                        if (normal.lengthSq() > 0.0001) {
                            // Reflect velocity more strongly
                            const dotProduct = agent.velocity.dot(normal);
                            const reflection = new THREE.Vector3().subVectors(agent.velocity, normal.multiplyScalar(2.1 * dotProduct)); // Stronger reflection
                            agent.velocity.copy(reflection.normalize().multiplyScalar(agent.velocity.length() * 1.1)); // Ensure speed increase
                            // Nudge further out
                            const nudge = normal.clone().multiplyScalar(MIN_AGENT_SEPARATION * 0.6);
                            agent.mesh.position.add(nudge);
                            agent.mesh.position.y = agent.baseHeight; // Correct height after nudge
                         } else { // Agent is exactly at center? Eject randomly.
                             agent.velocity.set(THREE.MathUtils.randFloatSpread(1), 0, THREE.MathUtils.randFloatSpread(1)).normalize().multiplyScalar(agent.velocity.length() * 1.2);
                         }
                        // Force wandering state if ejected
                        agent.state = AGENT_STATE.WANDERING;
                        agent.targetDepartment = null;
                        agent.targetPosition = null;
                     } else {
                         // Agent IS supposed to be inside this department (agent.targetDepartment === department)
                         // Check internal walls ONLY
                        const deptConfig = department.config;
                        const deptPos = department.mesh.position;
                        const halfSize = { x: deptConfig.size[0]/2, y: deptConfig.size[1]/2, z: deptConfig.size[2]/2 };
                        let hitInternalWall = false;

                        // Check X walls (excluding portal face if applicable)
                        if (deptConfig.portalFace !== 'x-' && agent.mesh.position.x < deptPos.x - halfSize.x + checkRadius) {
                            agent.mesh.position.x = deptPos.x - halfSize.x + checkRadius; agent.velocity.x *= -1; hitInternalWall = true;
                        } else if (deptConfig.portalFace !== 'x+' && agent.mesh.position.x > deptPos.x + halfSize.x - checkRadius) {
                            agent.mesh.position.x = deptPos.x + halfSize.x - checkRadius; agent.velocity.x *= -1; hitInternalWall = true;
                        }
                        // Check Z walls (excluding portal face if applicable)
                         if (deptConfig.portalFace !== 'z-' && agent.mesh.position.z < deptPos.z - halfSize.z + checkRadius) {
                            agent.mesh.position.z = deptPos.z - halfSize.z + checkRadius; agent.velocity.z *= -1; hitInternalWall = true;
                        } else if (deptConfig.portalFace !== 'z+' && agent.mesh.position.z > deptPos.z + halfSize.z - checkRadius) {
                             agent.mesh.position.z = deptPos.z + halfSize.z - checkRadius; agent.velocity.z *= -1; hitInternalWall = true;
                         }

                         // If hit an internal wall and had a target, clear the target to allow wandering
                         if (hitInternalWall && agent.targetPosition) {
                             agent.targetPosition = null;
                         }
                     }
                 }
            });
            // --- End Department Collision ---

        } // End if (!IDLE)


        // Trail management
        if (showTrails) {
            agent.trails.push(agent.mesh.position.clone());
            if (agent.trails.length > trailLength) {
                agent.trails.shift();
            }
            updateTrail(agent);
        } else if (agent.trail) {
            removeTrail(agent); // Use helper
        }
    }); // End agent loop
}

// Helper function to get portal position in world space
function getPortalWorldPosition(department) {
    const config = department.config;
    const deptPos = department.mesh.position;
    const portalLocalX = config.portalCenter[0] - deptPos.x;
    const portalLocalZ = config.portalCenter[1] - deptPos.z;

    // Assuming portal center coords were given relative to world origin, adjust if needed.
    // If portalCenter was relative to department center, calculation would be simpler:
    // return new THREE.Vector3(deptPos.x + portalLocalX, agent.baseHeight, deptPos.z + portalLocalZ);

    // Using the provided portalCenter coords directly (assuming they are world coords on the boundary)
    return new THREE.Vector3(config.portalCenter[0], modelBaseHeightOffset, config.portalCenter[1]);
}

// Helper function to get a random point strictly inside a department
function getRandomPointInDepartment(department) {
    const deptPos = department.mesh.position;
    const size = department.config.size;
    const padding = MIN_AGENT_SEPARATION; // Ensure point is not too close to walls

    const x = deptPos.x + THREE.MathUtils.randFloatSpread(size[0] - padding * 2);
    const z = deptPos.z + THREE.MathUtils.randFloatSpread(size[2] - padding * 2);
    return new THREE.Vector3(x, modelBaseHeightOffset, z);
}


function updateTrail(agent) {
    if (agent.trails.length < 2 || !agent.mesh) return;

    const points = agent.trails;
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    const baseColor = new THREE.Color(agentColor);
    const colors = [];
    const trailStartColor = new THREE.Color(0x333333); // Darker start

    for (let i = 0; i < points.length; i++) {
        const alpha = i / (points.length - 1); // Fade from startColor to baseColor
        const trailColor = trailStartColor.clone().lerp(baseColor, alpha);
        colors.push(trailColor.r, trailColor.g, trailColor.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        linewidth: 1 // Note: linewidth > 1 may not work on all platforms/drivers
    });

    if (agent.trail) {
        // Efficiently update existing trail
        agent.trail.geometry.dispose(); // Dispose old geometry data
        agent.trail.geometry = geometry;
    } else {
        // Create new trail mesh
        agent.trail = new THREE.Line(geometry, material);
        scene.add(agent.trail);
    }
}

// Helper function to remove an agent's trail completely
function removeTrail(agent) {
    if (agent.trail) {
        scene.remove(agent.trail);
        agent.trail.geometry.dispose();
        agent.trail.material.dispose();
        agent.trail = null;
        agent.trails = [];
    }
}


function render() {
    renderer.render(scene, camera);
}

let lastTime = performance.now();
// Removed FPS counter from here, using Stats.js

function updateUIDisplay() {
    // Check if elements exist before updating
    const agentsCountEl = document.getElementById('agents-count');
    if (agentsCountEl) {
        //  agentsCountEl.textContent = Agents: ${agents.length};
    }
    // FPS display is handled by Stats.js library now
    const fpsEl = document.getElementById('fps');
     if (fpsEl) {
         fpsEl.style.display = 'none'; // Hide the manual FPS counter
     }
}

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = (now - lastTime) / 1000;
    lastTime = now;

    // No manual FPS calculation needed if Stats.js is used

    if (!isPaused) {
        updateAgents(delta);
    }

    controls.update(); // REQUIRED for damping to work correctly
    render();
    if (stats) stats.update(); // Update Stats.js display
}


function resetScene(newCount) {
    // Clear existing agents and trails
    agents.forEach(agent => {
        if (agent.mesh) scene.remove(agent.mesh);
        removeTrail(agent); // Use helper
    });
    agents = []; // Reset the array

    // Update agent count from input or argument
    if (newCount !== undefined && !isNaN(newCount)) {
        agentCount = Math.max(1, newCount); // Ensure at least 1
        const countInput = document.getElementById('count');
         if(countInput) countInput.value = agentCount;
    } else {
        const countInput = document.getElementById('count');
        agentCount = countInput ? parseInt(countInput.value) || 50 : 50;
    }


    // Respawn agents (requires loaded model)
    if(loadedGltfModel) {
        spawnAgents(agentCount);
    } else {
        console.warn("Model not loaded yet, cannot respawn agents during reset.");
    }

     // Reset pause state visually and functionally
     isPaused = false;
     const startPauseButton = document.getElementById('startPause');
     if (startPauseButton) startPauseButton.textContent = '❚❚ Pause';


    updateUIDisplay(); // Update agent count display
}


function toggleSimulation() {
    isPaused = !isPaused;
     const startPauseButton = document.getElementById('startPause');
     if (startPauseButton) startPauseButton.textContent = isPaused ? '▶ Resume' : '❚❚ Pause';
}

function resetView() {
    // Instantly move camera and target
    // camera.position.copy(initialCameraPosition);
    // controls.target.copy(initialControlsTarget);

    // Smoothly move camera and target back (optional, feels nicer)
    const targetPos = initialCameraPosition.clone();
    const targetTarget = initialControlsTarget.clone();
    const duration = 0.8; // seconds

    // Simple Lerp animation (could use a library like GSAP or TWEEN for more control)
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    let elapsed = 0;

    function transitionView() {
        elapsed += 1/60; // Assume 60fps for delta approximation
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = 0.5 - 0.5 * Math.cos(progress * Math.PI); // Ease out

        camera.position.lerpVectors(startPos, targetPos, easedProgress);
        controls.target.lerpVectors(startTarget, targetTarget, easedProgress);
        controls.update(); // Essential during transition

        if (progress < 1) {
            requestAnimationFrame(transitionView);
        }
    }
    requestAnimationFrame(transitionView);


    controls.update(); // Required after manually changing camera/target
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start the simulation initialization
initScene();