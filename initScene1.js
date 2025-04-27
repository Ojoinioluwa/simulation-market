import * as THREE from 'three';
import Stats from 'stats';
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
// import { FontLoader } from 'three/addons/loaders/FontLoader.js';
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
const agentRadius = 5; // Adjusted agent radius
const trailLength = 50; // Increased trail length
const agentColor = "#FF0000"; // Neutral agent color

function initScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color("white");

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 2000); // Increased far plane
    camera.position.set(0, 300, 500); // Adjusted initial camera position
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true; // Enable shadows
    document.body.appendChild(renderer.domElement);

    ambientLight = new THREE.AmbientLight(0xffffff, 1); // Slightly reduced intensity
    scene.add(ambientLight);

    pointLight = new THREE.PointLight(0xffffff, 1); // Slightly reduced intensity
    pointLight.position.set(0, 200, 0);
    pointLight.castShadow = true; // Enable shadow casting for the light
    scene.add(pointLight);

    const floorGeometry = new THREE.PlaneGeometry(800, 500);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: "#ADD8E6", side: THREE.DoubleSide, roughness: 0.8, metalness: 0.2 }); // Using MeshStandardMaterial
    floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true; // Enable shadow receiving for the floor
    scene.add(floor);

    createDepartments('baseline');

    stats = new Stats();
    document.getElementById('stats-container').appendChild(stats.dom);

    controls = new OrbitControls(camera, renderer.domElement); // Initialize OrbitControls
    controls.target.set(0, 50, 0); // Set the orbit target slightly above the floor
    controls.update();

    window.addEventListener('resize', onWindowResize);
    document.getElementById('startPause').onclick = toggleSimulation;
    document.getElementById('reset').onclick = resetScene;
    document.getElementById('speed').oninput = e => speed = +e.target.value;
    document.getElementById('count').onchange = e => resetScene(+e.target.value);
    document.getElementById('scenario').onchange = e => switchLayout(e.target.value);
    document.getElementById('trails').onchange = e => showTrails = e.target.checked;

    spawnAgents(agentCount);
    animate();
}

function createDepartments(layout) {
    departments.forEach(dept => {
        scene.remove(dept.mesh);
        if (dept.label) scene.remove(dept.label);
    });
    departments = [];
    let layoutConfig;
    if (layout === 'baseline') {
        layoutConfig = [
            { name: 'Produce', size: [180, 80, 90], position: [-110, 40, 130], color: 0xaec6cf }, // Pastel blue
            { name: 'Dairy', size: [180, 80, 90], position: [110, 40, 130], color: 0x98fb98 },   // Pastel green
            { name: 'Bakery', size: [380, 80, 90], position: [0, 40, -130], color: 0xffe4c4 }    // Pastel peach
        ];
    } else if (layout === 'alternate') {
        layoutConfig = [
            { name: 'Electronics', size: [230, 80, 90], position: [-180, 40, 0], color: 0xd8bfd8 }, // Pastel lavender
            { name: 'Apparel', size: [230, 80, 90], position: [180, 40, 0], color: 0xffdab9 }    // Pastel light orange
        ];
    }

    const departmentMaterial = new THREE.MeshStandardMaterial({ color: "white", transparent: true, opacity: 0.2, roughness: 0.7, metalness: 0.1 }); // Semi-transparent fill

    const loader = new FontLoader();
    loader.load('https://cdn.jsdelivr.net/npm/three@0.158.0/examples/fonts/helvetiker_regular.typeface.json', (font) => {
        layoutConfig.forEach(config => {
            const { name, size, position, color } = config;
            const geometry = new THREE.BoxGeometry(...size);
            const mesh = new THREE.Mesh(geometry, departmentMaterial);
            mesh.position.set(...position);
            mesh.receiveShadow = true; // Departments can receive shadows
            departments.push({ name, mesh });
            scene.add(mesh);

            const edgesGeometry = new THREE.EdgesGeometry(geometry);
            const lineMaterial = new THREE.LineBasicMaterial({ color: color });
            const wireframe = new THREE.LineSegments(edgesGeometry, lineMaterial);
            wireframe.position.copy(mesh.position);
            scene.add(wireframe);

            // Create text label
            const textGeometry = new TextGeometry(name, {
                font: font,
                size: 15,
                height: 1,
            });
            const textMaterial = new THREE.MeshBasicMaterial({ color: "#FF0000" });
            const textMesh = new THREE.Mesh(textGeometry, textMaterial);
            textGeometry.computeBoundingBox();
            const centerOffset = -0.5 * (textGeometry.boundingBox.max.x - textGeometry.boundingBox.min.x);
            textMesh.position.set(position[0] + centerOffset, position[1] + size[1] / 2 + 10, position[2]);
            textMesh.rotation.y = Math.PI / 20; // Slight tilt for better visibility
            scene.add(textMesh);
            departments.push({ name, mesh, label: textMesh });
        });
    });
}

function switchLayout(layout) {
    createDepartments(layout);
    agents.forEach(agent => {
        scene.remove(agent.mesh);
        if (agent.trail) scene.remove(agent.trail);
    });
    agents = [];
    spawnAgents(agentCount);
}

// TODO: uhuhnjm,
function spawnAgents(n) {
    for (let i = 0; i < n; i++) {
        const x = THREE.MathUtils.randFloatSpread(760 / 2); // Adjusted spawn area
        const z = THREE.MathUtils.randFloatSpread(480 / 2) - 250; // Adjusted spawn area
        const y = agentRadius;
        const color = new THREE.Color(Math.random() * 0xffffff);
        const position = new THREE.Vector3(x, y, z);
        const geometry = new THREE.SphereGeometry(agentRadius, 16, 16);
        const material = new THREE.MeshStandardMaterial({ color: color, roughness: 0.7, metalness: 0.1 }); // Using neutral color and MeshStandardMaterial
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(position);
        mesh.castShadow = true; // Agents can cast shadows
        const vx = THREE.MathUtils.randFloatSpread(5);
        const vz = THREE.MathUtils.randFloatSpread(5);
        const velocity = new THREE.Vector3(vx, 0, vz);
        agents.push({ mesh, velocity, trails: [], inDepartment: null });
        scene.add(mesh);
    }
}

function updateAgents(delta) {
    agents.forEach(agent => {
        const scaledVelocity = agent.velocity.clone().multiplyScalar(speed * delta * 60);
        agent.mesh.position.add(scaledVelocity);

        if (showTrails) {
            agent.trails.push(agent.mesh.position.clone());
            if (agent.trails.length > trailLength) {
                agent.trails.shift();
            }
            updateTrail(agent);
        } else if (agent.trail) {
            scene.remove(agent.trail);
            agent.trail = null;
        }

        // Boundary collision
        if (Math.abs(agent.mesh.position.x) > 400 - agentRadius) {
            agent.velocity.x *= -1;
            agent.mesh.position.x = Math.sign(agent.mesh.position.x) * (400 - agentRadius);
        }
        if (agent.mesh.position.z > 250 - agentRadius || agent.mesh.position.z < -250 + agentRadius) {
            agent.velocity.z *= -1;
            agent.mesh.position.z = Math.sign(agent.mesh.position.z) * (250 - agentRadius);
        }

        // Department collision and basic "interaction" (crude reflection)
        departments.forEach(department => {
            const box = new THREE.Box3().setFromObject(department.mesh);
            const sphere = new THREE.Sphere(agent.mesh.position, agentRadius);
            if (box.intersectsSphere(sphere)) {
                const closestPoint = new THREE.Vector3();
                // box.getClosestPointToPoint(agent.mesh.position, closestPoint);
                const normal = agent.mesh.position.clone().sub(closestPoint).normalize();
                const dotProduct = agent.velocity.dot(normal);
                const reflection = new THREE.Vector3().subVectors(agent.velocity, normal.multiplyScalar(2 * dotProduct));
                agent.velocity.copy(reflection);
                const nudge = normal.multiplyScalar(0.1);
                agent.mesh.position.add(nudge);
            }
        });
    });
}

function updateTrail(agent) {
    if (agent.trails.length < 2) return;
    const points = agent.trails.map(t => t.clone());
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const color = new THREE.Color(agent.mesh.material.color);
    const colors = [];
    for (let i = 0; i < points.length; i++) {
        const alpha = i / (points.length - 1); // Opacity fades over the trail
        const trailColor = new THREE.Color(color.r, color.g, color.b);
        trailColor.multiplyScalar(0.5 + 0.5 * alpha); // Make newer segments brighter
        colors.push(trailColor.r, trailColor.g, trailColor.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, linewidth: 2 }); // Enable vertex colors

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
let frames = 0;
let fps = 0;

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    frames++;
    if (now - lastTime >= 1000) {
        fps = frames;
        frames = 0;
        lastTime = now;
        document.getElementById('agents-count').textContent = `Agents: ${agents.length}`;
        document.getElementById('fps').textContent = `FPS: ${fps}`;
    }

    if (!isPaused) {
        const delta = (now - lastTime) / 1000; // Use actual delta time for smoother animation
        updateAgents(delta);
    }
    controls.update(); // Update OrbitControls in the animation loop
    render();
    stats.update();
}

function resetScene(newCount) {
    isPaused = true; // Pause while resetting
    document.getElementById('startPause').textContent = '▶ Start';
    agents.forEach(agent => {
        scene.remove(agent.mesh);
        if (agent.trail) scene.remove(agent.trail);
    });
    agents = [];
    agentCount = newCount !== undefined ? newCount : parseInt(document.getElementById('count').value);
    spawnAgents(agentCount);
    isPaused = false; // Resume after reset
}

function toggleSimulation() {
    isPaused = !isPaused;
    document.getElementById('startPause').textContent = isPaused ? '▶ Resume' : '❚❚ Pause';
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

initScene();