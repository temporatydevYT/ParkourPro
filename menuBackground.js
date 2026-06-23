import * as THREE from 'three';

export class MenuBackground {
  constructor(containerElement) {
    this.container = containerElement;
    this.isRunning = false;
    this.animationId = null;
    
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0a0a, 0.02);
    
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 15, 40);
    this.camera.lookAt(0, 0, 0);
    
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x0a0a0a, 1);
    
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);
    
    this.clock = new THREE.Clock();
    this.cameraTime = 0;
    
    this.buildings = [];
    this.particles = [];
    this.gridMesh = null;
    
    this.initCityscape();
    this.initGrid();
    this.initParticles();
    
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
  }
  
  initCityscape() {
    const buildingGroup = new THREE.Group();
    
    const cityRadius = 100;
    const numBuildings = 50;
    
    for (let i = 0; i < numBuildings; i++) {
      const width = 3 + Math.random() * 4;
      const height = 8 + Math.random() * 35;
      const depth = 3 + Math.random() * 4;
      
      const geometry = new THREE.BoxGeometry(width, height, depth);
      
      const isGreen = Math.random() > 0.5;
      const emissiveColor = isGreen ? 0x00ff88 : 0x00ddff;
      const edgeColor = isGreen ? 0x00ff88 : 0x00ddff;
      
      const material = new THREE.MeshStandardMaterial({
        color: 0x0a0a0a,
        emissive: emissiveColor,
        emissiveIntensity: 0.3 + Math.random() * 0.3,
        metalness: 0.8,
        roughness: 0.2
      });
      
      const building = new THREE.Mesh(geometry, material);
      
      const angle = (i / numBuildings) * Math.PI * 2;
      const radius = cityRadius + Math.random() * 30;
      
      building.position.x = Math.cos(angle) * radius;
      building.position.z = Math.sin(angle) * radius;
      building.position.y = height / 2;
      
      const edges = new THREE.EdgesGeometry(geometry);
      const lineMaterial = new THREE.LineBasicMaterial({ 
        color: edgeColor,
        transparent: true,
        opacity: 0.6
      });
      const wireframe = new THREE.LineSegments(edges, lineMaterial);
      building.add(wireframe);
      
      buildingGroup.add(building);
      this.buildings.push(building);
    }
    
    this.scene.add(buildingGroup);
    
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(ambientLight);
    
    const greenLight = new THREE.PointLight(0x00ff88, 2, 100);
    greenLight.position.set(30, 20, 20);
    this.scene.add(greenLight);
    
    const cyanLight = new THREE.PointLight(0x00ddff, 2, 100);
    cyanLight.position.set(-30, 20, -20);
    this.scene.add(cyanLight);
  }
  
  initGrid() {
    const gridSize = 200;
    const divisions = 40;
    
    const vertices = [];
    const colors = [];
    
    const color1 = new THREE.Color(0x00ff88);
    const color2 = new THREE.Color(0x00ddff);
    
    for (let i = 0; i <= divisions; i++) {
      const pos = (i / divisions) * gridSize - gridSize / 2;
      
      vertices.push(-gridSize / 2, 0, pos);
      vertices.push(gridSize / 2, 0, pos);
      
      const color = i % 2 === 0 ? color1 : color2;
      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);
      
      vertices.push(pos, 0, -gridSize / 2);
      vertices.push(pos, 0, gridSize / 2);
      
      colors.push(color.r, color.g, color.b);
      colors.push(color.r, color.g, color.b);
    }
    
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    
    const material = new THREE.LineBasicMaterial({ 
      vertexColors: true,
      transparent: true,
      opacity: 0.3
    });
    
    this.gridMesh = new THREE.LineSegments(geometry, material);
    this.gridMesh.position.y = -0.1;
    this.scene.add(this.gridMesh);
  }
  
  initParticles() {
    const particleCount = 100;
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const velocities = [];
    
    for (let i = 0; i < particleCount; i++) {
      positions.push(
        (Math.random() - 0.5) * 200,
        Math.random() * 50,
        (Math.random() - 0.5) * 200
      );
      
      velocities.push(
        (Math.random() - 0.5) * 0.5,
        -0.2 - Math.random() * 0.3,
        (Math.random() - 0.5) * 0.5
      );
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
    const material = new THREE.PointsMaterial({
      color: 0x00ff88,
      size: 0.5,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending
    });
    
    const particles = new THREE.Points(geometry, material);
    this.scene.add(particles);
    this.particles.push({ mesh: particles, velocities });
    
    const material2 = new THREE.PointsMaterial({
      color: 0x00ddff,
      size: 0.4,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    });
    
    const particles2 = new THREE.Points(geometry.clone(), material2);
    this.scene.add(particles2);
    this.particles.push({ mesh: particles2, velocities: velocities.slice() });
  }
  
  handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }
  
  updateParticles(delta) {
    this.particles.forEach(({ mesh, velocities }) => {
      const positions = mesh.geometry.attributes.position.array;
      
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] += velocities[i] * delta * 10;
        positions[i + 1] += velocities[i + 1] * delta * 10;
        positions[i + 2] += velocities[i + 2] * delta * 10;
        
        if (positions[i + 1] < -10) {
          positions[i] = (Math.random() - 0.5) * 200;
          positions[i + 1] = 50;
          positions[i + 2] = (Math.random() - 0.5) * 200;
        }
        
        if (Math.abs(positions[i]) > 100 || Math.abs(positions[i + 2]) > 100) {
          positions[i] = (Math.random() - 0.5) * 200;
          positions[i + 1] = Math.random() * 50;
          positions[i + 2] = (Math.random() - 0.5) * 200;
        }
      }
      
      mesh.geometry.attributes.position.needsUpdate = true;
    });
  }
  
  animate() {
    if (!this.isRunning) return;
    
    const delta = Math.min(this.clock.getDelta(), 1/30);
    this.cameraTime += delta;
    
    this.camera.position.x = Math.sin(this.cameraTime * 0.1) * 5;
    this.camera.position.y = 15 + Math.sin(this.cameraTime * 0.15) * 2;
    this.camera.lookAt(0, 5, 0);
    
    if (this.gridMesh) {
      this.gridMesh.position.z = (this.cameraTime * 2) % 10 - 5;
    }
    
    this.buildings.forEach((building, i) => {
      const pulseSpeed = 0.5 + (i % 3) * 0.3;
      const intensity = 0.3 + Math.sin(this.cameraTime * pulseSpeed + i) * 0.2;
      building.material.emissiveIntensity = Math.max(0.1, intensity);
    });
    
    this.updateParticles(delta);
    
    this.renderer.render(this.scene, this.camera);
    
    this.animationId = requestAnimationFrame(() => this.animate());
  }
  
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.clock.start();
    this.animate();
  }
  
  stop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.clock.stop();
  }
  
  destroy() {
    this.stop();
    
    window.removeEventListener('resize', this.handleResize);
    
    this.scene.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose();
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(material => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
    
    this.renderer.dispose();
    
    if (this.container && this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
