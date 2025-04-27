import * as THREE from 'three';
import Stats from 'https://cdnjs.cloudflare.com/ajax/libs/stats.js/r17/Stats.min.js';

        // --- Global Variables ---
        let scene, camera, renderer, ambientLight, pointLight;
        let floor, departments = [], agents = [];
        let speed = 1;
        let agentCount = 50;
        let isPaused = false;
        let showTrails = false;
        let stats;
        const agentRadius = 5;
        const trailLength = 20;

        // --- Initialize Scene ---

    function initScene() {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf0f0f0); // Light gray background

        // --- Camera ---
        camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 1000);
        camera.position.set(0, 400, 400);
        camera.lookAt(0, 0, 0);

        // --- Renderer ---
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        document.body.appendChild(renderer.domElement);

        // --- Lights ---
        ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        pointLight = new THREE.PointLight(0xffffff, 1);
        pointLight.position.set(0, 300, 0);
        scene.add(pointLight);

        // --- Floor ---
        const floorGeometry = new THREE.PlaneGeometry(800, 500);
        const floorMaterial = new THREE.MeshBasicMaterial({ color: 0xd3d3d3, side: THREE.DoubleSide });
        floor = new THREE.Mesh(floorGeometry, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -250;
        scene.add(floor);

        // --- Departments ---
        createDepartments('baseline');

        // --- Stats ---
        stats = new Stats();
        console.log(stats)
        const statsContainer = document.createElement('div'); // Create a container
        statsContainer.id = 'stats-container';
        statsContainer.appendChild(stats.dom); // Append stats.dom to the container
        document.body.appendChild(statsContainer); // Append the container to the body

        // --- Event Listeners ---
        window.addEventListener('resize', onWindowResize);

        // *Corrected section: Attach event listeners here*
        document.getElementById('startPause').onclick = toggleSimulation;
        document.getElementById('reset').onclick = resetScene;
        document.getElementById('speed').oninput = e => speed = +e.target.value;
        document.getElementById('count').onchange = e => resetScene(+e.target.value);
        document.getElementById('scenario').onchange = e => switchLayout(e.target.value);
        document.getElementById('trails').onchange = e => showTrails = e.target.checked;

        // --- Initial Spawn ---
        spawnAgents(agentCount);

        // --- Start Animation Loop ---
        animate();
    }

        // --- Create Departments ---
        function createDepartments(layout) {
            // Clear existing departments
            departments.forEach(dept => scene.remove(dept));
            departments = [];

            let layoutConfig;
            if (layout === 'baseline') {
                layoutConfig = [
                    { name: 'Front Left', size: [200, 150, 100], position: [-100, 0, 125], color: 0xff0000 },
                    { name: 'Front Right', size: [200, 150, 100], position: [100, 0, 125], color: 0x00ff00 },
                    { name: 'Back Center', size: [400, 150, 100], position: [0, 0, -125], color: 0x0000ff }
                ];
            } else if (layout === 'alternate') {
                layoutConfig = [
                    { name: 'Left', size: [250, 150, 100], position: [-175, 0, 0], color: 0xffa500 },
                    { name: 'Right', size: [250, 150, 100], position: [175, 0, 0], color: 0x800080 }
                ];
            }

            layoutConfig.forEach(config => {
                const { size, position, color } = config;
                const geometry = new THREE.BoxGeometry(...size);
                const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.set(...position);

                // Create outline
                const edgesGeometry = new THREE.EdgesGeometry(geometry);
                const lineMaterial = new THREE.LineBasicMaterial({ color: color });
                const wireframe = new THREE.LineSegments(edgesGeometry, lineMaterial);
                wireframe.position.copy(mesh.position);
                scene.add(wireframe);

                departments.push(mesh);
            });
        }

        // --- Switch Layout ---
        function switchLayout(layout) {
            createDepartments(layout);
            agents.forEach(agent => {
                scene.remove(agent.mesh);
                if (agent.trail) scene.remove(agent.trail);
            });
            agents = [];
            spawnAgents(agentCount);
        }

        // --- Spawn Agents ---
        function spawnAgents(n) {
            for (let i = 0; i < n; i++) {
                const x = THREE.MathUtils.randFloatSpread(780 / 2);
                const z = -250;
                const y = agentRadius;
                const position = new THREE.Vector3(x, y, z);
                const color = new THREE.Color(Math.random() * 0xffffff);
                const geometry = new THREE.SphereGeometry(agentRadius, 16, 16);
                const material = new THREE.MeshBasicMaterial({ color });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.copy(position);

                const vx = THREE.MathUtils.randFloatSpread(5);
                const vz = THREE.MathUtils.randFloatSpread(5);
                const velocity = new THREE.Vector3(vx, 0, vz);

                agents.push({ mesh, velocity, trails: [], inDepartment: null });
                scene.add(mesh);
            }
            // document.getElementById('stats').textContent = `Agents: ${agents.length} | FPS: ${stats ? stats.fps.toFixed(0) : 0}`;

        }

        // --- Update Agents ---
        function updateAgents(delta) {
            agents.forEach(agent => {
                const scaledVelocity = agent.velocity.clone().multiplyScalar(speed * delta * 60); // Adjust speed for frame rate independence
                agent.mesh.position.add(scaledVelocity);

                // Keep track of last positions for trails
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

                // Bounce off floor edges
                if (Math.abs(agent.mesh.position.x) > 400 - agentRadius) {
                    agent.velocity.x *= -1;
                    agent.mesh.position.x = Math.sign(agent.mesh.position.x) * (400 - agentRadius);
                }
                if (agent.mesh.position.z > 250 - agentRadius || agent.mesh.position.z < -250 + agentRadius) {
                    agent.velocity.z *= -1;
                    agent.mesh.position.z = Math.sign(agent.mesh.position.z) * (250 - agentRadius);
                }

                // Bounce off department walls
                departments.forEach(department => {
                    const box = new THREE.Box3().setFromObject(department);
                    const sphere = new THREE.Sphere(agent.mesh.position, agentRadius);

                    if (box.intersectsSphere(sphere)) {
                        const closestPoint = new THREE.Vector3();
                        // box.closestPointToPoint(agent.mesh.position, closestPoint);
                        const normal = agent.mesh.position.clone().sub(closestPoint).normalize();

                        // Approximate bounce by inverting velocity component along the normal
                        const dotProduct = agent.velocity.dot(normal);
                        const reflection = normal.clone().multiplyScalar(2 * dotProduct).sub(agent.velocity);
                        agent.velocity.copy(reflection);

                        // Nudge the agent out of collision to prevent sticking
                        const nudge = normal.multiplyScalar(0.1);
                        agent.mesh.position.add(nudge);
                    }
                });
            });
            // document.getElementById('stats').textContent = `Agents: ${agents.length} | FPS: ${stats ? stats.fps.toFixed(0) : 0}`;

        }

        // --- Update Trail ---
        function updateTrail(agent) {
            if (agent.trails.length < 2) return;

            const points = agent.trails.map(t => t.clone());
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ color: agent.mesh.material.color });

            if (agent.trail) {
                agent.trail.geometry.dispose();
                agent.trail.geometry = geometry;
            } else {
                agent.trail = new THREE.Line(geometry, material);
                scene.add(agent.trail);
            }
        }

        // --- Render ---
        function render() {
            renderer.render(scene, camera);
        }
        // TODO: check this out in case of error
        // --- Animate Loop ---
        // function animate() {
        //     requestAnimationFrame(animate);
        //     if (!isPaused) {
        //         const delta = 0.01666666666; // Approximate delta for 60 FPS
        //         updateAgents(delta);
        //     }
        //     render();
        //     stats.update();
        // }

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
                document.getElementById('stats').textContent = `Agents: ${agents.length} | FPS: ${fps}`;
            }

            if (!isPaused) {
                const delta = 0.01666666666;
                updateAgents(delta);
            }

            render();
            stats.update();
        }

        // --- Reset Scene ---
        function resetScene(newCount) {
            isPaused = false;
            document.getElementById('startPause').textContent = '▶/▌▌';

            // Remove old agents
            agents.forEach(agent => {
                scene.remove(agent.mesh);
                if (agent.trail) scene.remove(agent.trail);
            });
            agents = [];

            agentCount = newCount !== undefined ? newCount : parseInt(document.getElementById('count').value);
            spawnAgents(agentCount);
        }
        document.getElementById('startPause').onclick = toggleSimulation;

        // --- Toggle Simulation ---
        function toggleSimulation() {
            isPaused = !isPaused;
            document.getElementById('startPause').textContent = isPaused ? '▶' : '▌▌';
        }

        // --- Handle Window Resize ---
        function onWindowResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }

        // --- Initialize on Load ---
        initScene();