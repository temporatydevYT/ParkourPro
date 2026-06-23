import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { OctreeHelper } from 'three/addons/helpers/OctreeHelper.js';

// Level 1 Configuration
export const level1Config = {
  levelNumber: 1,
  playerSpeed: 95,
  airControl: 18,
  gravity: 38,
  jumpForce: 16,
  bobStrength: 0.04,
  bobSpeed: 17,
  ballLimit: 0,
  useBalls: false,
  mapScale: { x: 4.5, y: 4.5, z: 4.5 },
  mapPosition: { x: 0, y: -13, z: 0 },
  hdrPath: './skybox/skybox.hdr',
  
  // Player camera initial rotation (lookat direction)
  playerLookAt: {
    rotationY: Math.PI / 2,
    rotationX: 0
  },
  
  // Star mechanics - time thresholds in seconds
  starMechanics: {
    star1Time: 120,
    star2Time: 60,
    deathLimit: 5
  },
  
  // Missions descriptions
  missions: [
    { description: 'Complete under 2min', target: '120s', type: 'time' },
    { description: 'Complete under 1min', target: '60s', type: 'time' },
    { description: 'Die less than 5 times', target: '<5 deaths', type: 'deaths' }
  ],
  
  // Best time target for display
  bestTimeTarget: 45
};

export function loadLevel(scene, worldOctree, onProgress) {
  return new Promise((resolve, reject) => {
    let gltfLoaded = false;
    let hdrLoaded = false;
    
    const checkComplete = () => {
      if (gltfLoaded && hdrLoaded) {
        resolve();
      }
    };
    
    let glbProgress = 0;
    let hdrProgress = 0;
    const reportProgress = () => { if (onProgress) onProgress((glbProgress + hdrProgress) / 2); };

    const gltfLoader = new GLTFLoader().setPath('./models/gltf/');
    gltfLoader.load('level1.glb', 
      (gltf) => {
        gltf.scene.scale.set(level1Config.mapScale.x, level1Config.mapScale.y, level1Config.mapScale.z);
        gltf.scene.position.set(level1Config.mapPosition.x, level1Config.mapPosition.y, level1Config.mapPosition.z);
        
        scene.add(gltf.scene);
        worldOctree.fromGraphNode(gltf.scene);
        
        gltf.scene.traverse(child => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            
            child.material = new THREE.MeshStandardMaterial({
              map: child.material.map || null,
              color: child.material.color,
              roughness: 0.015,
              metalness: 0.6,
            });
            
            if (child.material.map) child.material.map.anisotropy = 4;
          }
        });
        
        const helper = new OctreeHelper(worldOctree);
        helper.visible = false;
        scene.add(helper);
        
        glbProgress = 1;
        gltfLoaded = true;
        reportProgress();
        checkComplete();
      },
      null,
      (error) => reject(error)
    );
    
    //checkered completion platform
    const platformGeometry = new THREE.BoxGeometry(3.55, 0.3, 3.55);
    
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const squareSize = 16;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#000000' : '#ffffff';
        ctx.fillRect(x * squareSize, y * squareSize, squareSize, squareSize);
      }
    }
    const checkeredTexture = new THREE.CanvasTexture(canvas);
    checkeredTexture.wrapS = THREE.RepeatWrapping;
    checkeredTexture.wrapT = THREE.RepeatWrapping;
    
    const platformMaterial = new THREE.MeshStandardMaterial({
      map: checkeredTexture,
      roughness: 0.3,
      metalness: 0.1
    });
    
    const completionPlatform = new THREE.Mesh(platformGeometry, platformMaterial);
    completionPlatform.position.set(-32.1, -6.73, 0.16);
    completionPlatform.castShadow = true;
    completionPlatform.receiveShadow = true;
    completionPlatform.userData.isCompletionPlatform = true;
    
    scene.add(completionPlatform);
    
    // Load HDR environment — skip for Low graphics (blue sky stays)
    if (window.graphicsQuality === 'low') {
      scene.background = new THREE.Color(0x87ceeb);
      hdrProgress = 1;
      hdrLoaded = true;
      reportProgress();
      checkComplete();
    } else {
      const rgbeLoader = new RGBELoader();
      rgbeLoader.load(level1Config.hdrPath, 
        (hdrTexture) => {
          hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
          scene.background = hdrTexture;
          scene.environment = hdrTexture;
          
          hdrProgress = 1;
          hdrLoaded = true;
          reportProgress();
          checkComplete();
        },
        null,
        (error) => reject(error)
      );
    }
  });
}

export function loadPlayerModel(scene, playerMixer, onProgress) {
  return new Promise((resolve) => {
    if (onProgress) onProgress(1.0);
    resolve(null);
  });
}
