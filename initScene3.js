import * as THREE from 'three';
import Stats from 'stats';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';

let scene, camera, renderer, ambientLight, pointLight;
let floor, departments = [], agents = [];
let speed = 1;
let agentCount = 50;
let isPaused = false;
let showTrails = false;
let stats;
let controls;

const agentRadius = 5;
const trailLength = 50;
const agentColor = 0x555555; // Uniform agent color (mid-grey)
const initialCameraPosition = new THREE.Vector3(0, 300, 500);
const initialControlsTarget = new THREE.Vector3(0, 50, 0);


function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color("white"); // Kept white, consider skybox later

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 2000);
    camera.position.copy(initialCameraPosition);
    // camera.lookAt is handled by OrbitControls target

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; // Enable shadows
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
    document.body.appendChild(renderer.domElement);

    ambientLight = new THREE.AmbientLight(0xffffff, 0.8); // Slightly reduced ambient intensity
    scene.add(ambientLight);

    pointLight = new THREE.PointLight(0xffffff, 1.2); // Slightly increased point light intensity
    pointLight.position.set(0, 200, 0);
    pointLight.castShadow = true;
    // Improve shadow quality
    pointLight.shadow.mapSize.width = 1024; // Default 512
    pointLight.shadow.mapSize.height = 1024; // Default 512
    pointLight.shadow.camera.near = 10;
    pointLight.shadow.camera.far = 500;
    pointLight.shadow.bias = -0.001; // Adjust bias to prevent shadow acne/peter panning
    scene.add(pointLight);

    // Floor with better contrast
    const floorGeometry = new THREE.PlaneGeometry(800, 500);
    const floorMaterial = new THREE.MeshStandardMaterial({
        color: "#cccccc", // Light grey floor for better contrast
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.2
    });
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0; // Ensure floor is at y=0
    floor.receiveShadow = true; // Floor receives shadows
    scene.add(floor);

    createDepartments('baseline');

    stats = new Stats();
    // Make sure 'stats-container' exists in HTML
    const statsContainer = document.getElementById('stats-container');
    if (statsContainer) {
        statsContainer.appendChild(stats.dom);
    } else {
        console.warn("Stats container not found. FPS meter won't be displayed.");
    }


    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(initialControlsTarget);
    controls.enableDamping = true; // Enable smooth inertia/damping
    controls.dampingFactor = 0.1; // Adjust damping strength
    controls.update();

    window.addEventListener('resize', onWindowResize);
    document.getElementById('startPause').onclick = toggleSimulation;
    document.getElementById('reset').onclick = resetScene;
    document.getElementById('resetView').onclick = resetView; // Added Reset View listener
    document.getElementById('speed').oninput = e => speed = +e.target.value;
    document.getElementById('count').onchange = e => resetScene(+e.target.value);
    document.getElementById('scenario').onchange = e => switchLayout(e.target.value);
    document.getElementById('trails').onchange = e => {
        showTrails = e.target.checked;
        if (!showTrails) {
            // Immediately remove trails when checkbox is unchecked
            agents.forEach(agent => {
                if (agent.trail) {
                    scene.remove(agent.trail);
                    agent.trail.geometry.dispose();
                    agent.trail.material.dispose();
                    agent.trail = null;
                    agent.trails = []; // Clear trail history too
                }
            });
        }
    }

    spawnAgents(agentCount);
    animate();
}

function createDepartments(layout) {
    // Clean up previous departments thoroughly
    departments.forEach(dept => {
        if (dept.mesh) scene.remove(dept.mesh);
        if (dept.wireframe) scene.remove(dept.wireframe); // Remove old wireframe
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

    const loader = new FontLoader();
    // Ensure this font path is correct and accessible
    loader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json', function (font) {
        layoutConfig.forEach(config => {
            const { name, size, position, color } = config;
            const geometry = new THREE.BoxGeometry(...size);

            // Department Fill Material - Use color and increase opacity
            const fillMaterial = new THREE.MeshStandardMaterial({
                color: color,       // Use department color for fill
                transparent: true,
                opacity: 0.3,       // Increased opacity
                roughness: 0.7,
                metalness: 0.1
            });

            const mesh = new THREE.Mesh(geometry, fillMaterial);
            mesh.position.set(position[0], position[1], position[2]); // Position includes Y offset
            mesh.castShadow = false; // Department volumes probably shouldn't cast shadows
            mesh.receiveShadow = true; // But can receive shadows
            scene.add(mesh);

            // Department Wireframe
            const edgesGeometry = new THREE.EdgesGeometry(geometry);
            const lineMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 1.5 }); // Keep wireframe distinct
            const wireframe = new THREE.LineSegments(edgesGeometry, lineMaterial);
            wireframe.position.copy(mesh.position);
            scene.add(wireframe);

            // Department Label
            const textGeometry = new TextGeometry(name, {
                font: font,
                size: 15,
                height: 1,
            });
            const textMaterial = new THREE.MeshBasicMaterial({ color: 0x333333 }); // Darker label
            const textMesh = new THREE.Mesh(textGeometry, textMaterial);
            textGeometry.computeBoundingBox();
            const centerOffset = -0.5 * (textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x);
            // Position label above the department box
            textMesh.position.set(position[0] + centerOffset, position[1] + size[1] / 2 + 10, position[2]);
            textMesh.rotation.y = Math.PI / 20; // Slight rotation for better visibility
            scene.add(textMesh);

            // Store references for cleanup
            departments.push({ name, mesh, wireframe, label: textMesh, config });
        });
    });
}


function switchLayout(layout) {
    createDepartments(layout);
    // Reset agents when layout switches
    agents.forEach(agent => {
        scene.remove(agent.mesh);
        if (agent.trail) scene.remove(agent.trail);
    });
    agents = [];
    spawnAgents(agentCount); // Respawn agents in new layout
}

function spawnAgents(n) {
    // Adjust spawn area if needed, maybe keep them away from department centers initially
    const spawnWidth = 780;
    const spawnDepth = 480;
    const spawnHeightOffset = agentRadius + 1; // Ensure they spawn just above the floor

    for (let i = 0; i < n; i++) {
        const x = THREE.MathUtils.randFloatSpread(spawnWidth);
        const z = THREE.MathUtils.randFloatSpread(spawnDepth); // Spread across full depth
        const y = spawnHeightOffset; // Spawn agents just above the floor plane (y=0)

        const position = new THREE.Vector3(x, y, z);
        const geometry = new THREE.SphereGeometry(agentRadius, 16, 16); // Keep geometry simple
        const material = new THREE.MeshStandardMaterial({
            color: agentColor, // Use uniform color
            roughness: 0.7,
            metalness: 0.1
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        mesh.castShadow = true; // Agents cast shadows
        mesh.receiveShadow = false; // Agents don't need to receive shadows

        const vx = THREE.MathUtils.randFloatSpread(5); // Random initial velocity X
        const vz = THREE.MathUtils.randFloatSpread(5); // Random initial velocity Z
        const velocity = new THREE.Vector3(vx, 0, vz); // Keep velocity planar

        agents.push({ mesh, velocity, trails: [], inDepartment: null });
        scene.add(mesh);
    }
    // Update agent count display immediately after spawning
    updateUIDisplay();
}

function updateAgents(delta) {
    if (isPaused) return; // Skip updates if paused

    const effectiveSpeed = speed * delta * 60; // Scale speed by delta

    agents.forEach(agent => {
        const scaledVelocity = agent.velocity.clone().multiplyScalar(effectiveSpeed);
        agent.mesh.position.add(scaledVelocity);
        agent.mesh.position.y = agentRadius + 0.1; // Keep agents firmly on the ground plane

        // Trail management
        if (showTrails) {
            agent.trails.push(agent.mesh.position.clone());
            if (agent.trails.length > trailLength) {
                agent.trails.shift();
            }
            updateTrail(agent);
        } else if (agent.trail) {
            // Clean up trail if trails are turned off
            scene.remove(agent.trail);
            agent.trail.geometry.dispose();
            agent.trail.material.dispose();
            agent.trail = null;
            agent.trails = []; // Clear history
        }

        // Boundary collision (Floor Plane)
        const halfWidth = 800 / 2 - agentRadius;
        const halfDepth = 500 / 2 - agentRadius;

        if (Math.abs(agent.mesh.position.x) > halfWidth) {
            agent.velocity.x *= -1;
            agent.mesh.position.x = Math.sign(agent.mesh.position.x) * halfWidth;
        }
        if (Math.abs(agent.mesh.position.z) > halfDepth) {
            agent.velocity.z *= -1;
            agent.mesh.position.z = Math.sign(agent.mesh.position.z) * halfDepth;
        }

        // Department collision (Simple reflection)
        departments.forEach(department => {
            // Use department mesh for collision check
             if (!department.mesh) return; // Skip if department mesh not loaded yet

            const box = new THREE.Box3().setFromObject(department.mesh);
            // Inflate box slightly for better collision detection if needed
            // box.expandByScalar(agentRadius * 0.5);

            // Check if agent's *center* is inside the box (simpler check)
            if (box.containsPoint(agent.mesh.position)) {
                // More robust collision: Find closest point on box surface and reflect
                const closestPoint = new THREE.Vector3();
                box.clampPoint(agent.mesh.position, closestPoint); // Find closest point on box surface

                const normal = agent.mesh.position.clone().sub(closestPoint).normalize();

                // Ensure normal is valid (avoid zero vector if agent center is exactly on surface)
                 if (normal.lengthSq() > 0.0001) {
                     // Reflect velocity based on the surface normal
                     const dotProduct = agent.velocity.dot(normal);
                     const reflection = new THREE.Vector3().subVectors(agent.velocity, normal.multiplyScalar(2 * dotProduct));
                     agent.velocity.copy(reflection);

                    // Nudge the agent slightly out of the box along the normal to prevent sticking
                     const nudge = normal.clone().multiplyScalar(0.5); // Small nudge factor
                     agent.mesh.position.add(nudge);
                 } else {
                     // If somehow perfectly inside or normal is zero, just reverse velocity as fallback
                     agent.velocity.multiplyScalar(-1);
                 }
            }
        });
    });
}


function updateTrail(agent) {
    if (agent.trails.length < 2) return;

    const points = agent.trails; // Use the array directly
    const geometry = new THREE.BufferGeometry().setFromPoints(points);

    // Use the agent's base color for the trail
    const baseColor = new THREE.Color(agentColor); // Use the uniform agent color
    const colors = [];
    const trailStartColor = new THREE.Color(0x333333); // Dark grey for fade target

    for (let i = 0; i < points.length; i++) {
        const alpha = i / (points.length - 1); // Normalized position in trail (0=oldest, 1=newest)
        // Interpolate color from dark grey (oldest) to agent color (newest)
        const trailColor = trailStartColor.clone().lerp(baseColor, alpha);
        colors.push(trailColor.r, trailColor.g, trailColor.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Use LineBasicMaterial with vertex colors
    const material = new THREE.LineBasicMaterial({
        vertexColors: true,
        linewidth: 1 // Attempt thinner lines (may not work everywhere)
        // Opacity/transparency control would ideally use LineMaterial from examples/lines,
        // but LineBasicMaterial is simpler here. The color fade provides the visual cue.
    });

    if (agent.trail) {
        // Update existing trail
        agent.trail.geometry.dispose(); // Dispose old geometry
        agent.trail.geometry = geometry;
    } else {
        // Create new trail line
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

function updateUIDisplay() {
    // Use backticks for template literals
    document.getElementById('agents-count').textContent = `Agents: ${agents.length}`;
    // FPS is updated in the animate loop based on frame count
}


function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const delta = (now - lastTime) / 1000; // Delta time in seconds
    lastTime = now;
    frames++;

    // Update FPS counter every second
    if (now - lastFPSTime >= 1000) {
        const fps = frames;
        document.getElementById('fps').textContent = `FPS: ${fps}`;
        frames = 0;
        lastFPSTime = now;
        // Update agent count here too, in case it changes dynamically later
        updateUIDisplay();
    }


    if (!isPaused) {
        updateAgents(delta); // Pass delta time to agent updates
    }

    // OrbitControls damping requires update on each frame
    controls.update();

    render();
    if (stats) stats.update(); // Update stats panel if it exists
}


function resetScene(newCount) {
    // Don't pause if already paused by button
    // isPaused = true;
    // document.getElementById('startPause').textContent = '▶ Start';

    // Clear existing agents and trails
    agents.forEach(agent => {
        scene.remove(agent.mesh);
        if (agent.trail) {
            scene.remove(agent.trail);
            agent.trail.geometry.dispose();
            agent.trail.material.dispose();
        }
    });
    agents = [];

    // Determine new agent count
    if (newCount !== undefined && !isNaN(newCount)) {
        agentCount = newCount;
        document.getElementById('count').value = agentCount; // Update UI input
    } else {
        agentCount = parseInt(document.getElementById('count').value) || 50; // Fallback to 50
    }

    // Respawn agents
    spawnAgents(agentCount);

    // Reset simulation state if needed (e.g., time, specific counters)
    // ...

    // Update UI immediately
    updateUIDisplay();

    // Don't automatically unpause, let user control it
    // isPaused = false;
    // document.getElementById('startPause').textContent = '❚❚ Pause';
}


function toggleSimulation() {
    isPaused = !isPaused;
    document.getElementById('startPause').textContent = isPaused ? '▶ Resume' : '❚❚ Pause';
}

function resetView() {
    // Smoothly move camera back to initial position and target
    // camera.position.copy(initialCameraPosition); // Instant snap
    // controls.target.copy(initialControlsTarget); // Instant snap

    // For a smoother transition (requires Tween.js or similar, not included here)
    // new TWEEN.Tween(camera.position).to(initialCameraPosition, 500).easing(TWEEN.Easing.Quadratic.Out).start();
    // new TWEEN.Tween(controls.target).to(initialControlsTarget, 500).easing(TWEEN.Easing.Quadratic.Out).start();

    // Simple instant reset for now:
    camera.position.copy(initialCameraPosition);
    controls.target.copy(initialControlsTarget);
    controls.update(); // Required after manually changing camera/target
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start the simulation
initScene();

// Future Enhancements mentioned in critiques:
// - Use low-poly human avatars (GLTF models) instead of spheres.
// - Implement InstancedMesh for better performance with many avatars.
// - Add subtle gradient skybox or textured floor.
// - Add department highlight on agent entry/hover.
// - Implement dashed line material for trails.
// - Add a minimap or compass UI element.
// - Use post-processing for Ambient Occlusion.
// - Implement smooth camera reset using a tweening library.